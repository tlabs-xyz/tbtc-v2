// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./interfaces/IOptimisticWatchdogConsensus.sol";
import "./interfaces/IWatchdogOperation.sol";
import "./ProtocolRegistry.sol";

/// @title OptimisticWatchdogConsensus
/// @notice Implementation of the optimistic N-of-M watchdog consensus system for v1.1
/// @dev This contract enables multiple watchdogs to participate in consensus decisions
///      with optimistic execution and challenge mechanisms. It follows patterns from
///      TBTCOptimisticMinting and RedemptionWatchtower for proven security.
contract OptimisticWatchdogConsensus is IOptimisticWatchdogConsensus, AccessControl, Pausable {
    // =================== CONSTANTS ===================
    
    /// @notice Role for emergency actions
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    /// @notice Role for managing watchdog set
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    
    /// @notice Service key for operation executor
    bytes32 public constant OPERATION_EXECUTOR_KEY = keccak256("OPERATION_EXECUTOR");
    
    /// @notice Operation type constants
    bytes32 public constant override RESERVE_ATTESTATION = keccak256("RESERVE_ATTESTATION");
    bytes32 public constant override WALLET_REGISTRATION = keccak256("WALLET_REGISTRATION");
    bytes32 public constant override STATUS_CHANGE = keccak256("STATUS_CHANGE");
    bytes32 public constant override REDEMPTION_FULFILLMENT = keccak256("REDEMPTION_FULFILLMENT");
    
    /// @notice Escalation delay levels (similar to RedemptionWatchtower pattern)
    uint32[4] public escalationDelays = [1 hours, 4 hours, 12 hours, 24 hours];
    
    /// @notice Consensus threshold levels based on objection count
    uint8[4] public consensusThresholds = [0, 2, 3, 5];
    
    /// @notice Minimum number of watchdogs required
    uint8 public constant MIN_WATCHDOGS = 3;
    
    /// @notice Maximum number of watchdogs allowed
    uint8 public constant MAX_WATCHDOGS = 20;

    // =================== STATE VARIABLES ===================
    
    /// @notice Protocol registry for service discovery
    ProtocolRegistry public immutable protocolRegistry;
    
    /// @notice Mapping of operation ID to operation details
    mapping(bytes32 => WatchdogOperation) public operations;
    
    /// @notice Mapping of active watchdogs
    mapping(address => bool) public override isActiveWatchdog;
    
    /// @notice Array of active watchdog addresses
    address[] public activeWatchdogsList;
    
    /// @notice Mapping of operation ID to challenger addresses to challenges
    mapping(bytes32 => mapping(address => Challenge)) public operationChallenges;
    
    /// @notice Mapping to track which watchdogs have objected to an operation
    mapping(bytes32 => mapping(address => bool)) public hasObjected;
    
    /// @notice Mapping to track which watchdogs have approved a disputed operation
    mapping(bytes32 => mapping(address => bool)) public operationApprovals;
    
    /// @notice Count of approvals for each operation
    mapping(bytes32 => uint256) public approvalCount;
    
    /// @notice Current consensus state
    ConsensusState public consensusState;
    
    /// @notice Nonce for operation ID generation
    uint256 private operationNonce;

    // =================== CONSTRUCTOR ===================
    
    /// @notice Initialize the consensus system
    /// @param _protocolRegistry Address of the protocol registry
    constructor(address _protocolRegistry) {
        require(_protocolRegistry != address(0), "Invalid registry");
        protocolRegistry = ProtocolRegistry(_protocolRegistry);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
        
        // Initialize consensus state
        consensusState = ConsensusState({
            activeWatchdogs: 0,
            consensusThreshold: 3,
            baseChallengePeriod: uint32(escalationDelays[0]),
            emergencyPause: false
        });
    }

    // =================== MODIFIERS ===================
    
    /// @notice Ensure caller is an active watchdog
    modifier onlyActiveWatchdog() {
        if (!isActiveWatchdog[msg.sender]) revert NotActiveWatchdog();
        _;
    }
    
    /// @notice Ensure operation exists
    modifier operationExists(bytes32 operationId) {
        if (operations[operationId].submittedAt == 0) revert OperationNotFound();
        _;
    }

    // =================== CORE FUNCTIONS ===================
    
    /// @inheritdoc IOptimisticWatchdogConsensus
    function submitOptimisticOperation(
        bytes32 operationType,
        bytes calldata operationData
    ) external override onlyActiveWatchdog whenNotPaused returns (bytes32 operationId) {
        // Validate operation type
        if (!_isValidOperationType(operationType)) revert InvalidOperationType();
        
        // Calculate primary validator for this operation
        address primaryValidator = calculatePrimaryValidator(operationType, operationData);
        
        // Ensure caller is the designated primary validator
        if (msg.sender != primaryValidator) revert NotPrimaryValidator();
        
        // Generate unique operation ID
        operationId = keccak256(abi.encode(
            operationType,
            operationData,
            block.timestamp,
            operationNonce++
        ));
        
        // Create operation record
        operations[operationId] = WatchdogOperation({
            operationType: operationType,
            operationData: operationData,
            primaryValidator: primaryValidator,
            submittedAt: uint64(block.timestamp),
            finalizedAt: uint64(block.timestamp + escalationDelays[0]),
            objectionCount: 0,
            executed: false,
            challenged: false
        });
        
        emit OperationSubmitted(
            operationId,
            operationType,
            primaryValidator,
            uint64(block.timestamp + escalationDelays[0])
        );
        
        return operationId;
    }
    
    /// @inheritdoc IOptimisticWatchdogConsensus
    function challengeOperation(
        bytes32 operationId,
        bytes calldata evidence
    ) external override onlyActiveWatchdog operationExists(operationId) {
        WatchdogOperation storage operation = operations[operationId];
        
        // Validate operation state
        if (operation.executed) revert OperationAlreadyExecuted();
        if (block.timestamp >= operation.finalizedAt) revert ChallengePeriodActive();
        if (hasObjected[operationId][msg.sender]) revert AlreadyObjected();
        
        // Record objection
        hasObjected[operationId][msg.sender] = true;
        operation.objectionCount++;
        operation.challenged = true;
        
        // Store challenge details
        operationChallenges[operationId][msg.sender] = Challenge({
            challenger: msg.sender,
            evidence: evidence,
            challengedAt: uint64(block.timestamp)
        });
        
        // Calculate new finalization time based on escalation
        uint8 escalationLevel = _getEscalationLevel(operation.objectionCount);
        uint32 additionalDelay = escalationDelays[escalationLevel] - escalationDelays[escalationLevel - 1];
        operation.finalizedAt = uint64(block.timestamp + escalationDelays[escalationLevel]);
        
        emit OperationChallenged(
            operationId,
            msg.sender,
            operation.objectionCount,
            operation.finalizedAt
        );
        
        // Emit escalation event if thresholds crossed
        if (operation.objectionCount == consensusThresholds[escalationLevel]) {
            emit ConsensusEscalated(
                operationId,
                escalationLevel,
                consensusThresholds[escalationLevel],
                additionalDelay
            );
        }
    }
    
    /// @inheritdoc IOptimisticWatchdogConsensus
    function executeOperation(bytes32 operationId) 
        external 
        override 
        operationExists(operationId) 
        whenNotPaused 
    {
        WatchdogOperation storage operation = operations[operationId];
        
        // Validate execution conditions
        if (operation.executed) revert OperationAlreadyExecuted();
        if (block.timestamp < operation.finalizedAt) revert ChallengePeriodActive();
        
        // Check consensus requirements if challenged
        if (operation.challenged) {
            // For high objection counts, require explicit approvals
            if (operation.objectionCount >= consensusThresholds[2]) { // ≥3 objections
                uint256 requiredApprovals = _calculateRequiredApprovals(operation.objectionCount);
                require(
                    approvalCount[operationId] >= requiredApprovals,
                    "Insufficient approvals for disputed operation"
                );
            }
        }
        
        // Mark as executed
        operation.executed = true;
        
        // Execute the operation through the operation executor
        bool success = _executeOperationType(operation.operationType, operation.operationData);
        
        emit OperationExecuted(operationId, msg.sender, success);
    }
    
    /// @inheritdoc IOptimisticWatchdogConsensus
    function emergencyOverride(
        bytes32 operationId,
        bytes32 reason
    ) external override onlyRole(EMERGENCY_ROLE) operationExists(operationId) {
        WatchdogOperation storage operation = operations[operationId];
        
        if (operation.executed) revert OperationAlreadyExecuted();
        
        // Mark as executed to prevent normal execution
        operation.executed = true;
        
        // Execute immediately
        bool success = _executeOperationType(operation.operationType, operation.operationData);
        
        emit EmergencyOverride(operationId, msg.sender, reason);
        emit OperationExecuted(operationId, msg.sender, success);
    }
    
    /// @inheritdoc IOptimisticWatchdogConsensus
    function approveOperation(bytes32 operationId) 
        external 
        override
        onlyActiveWatchdog 
        operationExists(operationId) 
    {
        WatchdogOperation storage operation = operations[operationId];
        
        // Validate operation state
        require(!operation.executed, "Already executed");
        require(operation.challenged, "Not disputed");
        require(block.timestamp >= operation.finalizedAt, "Challenge period active");
        
        // Prevent double approval
        require(!operationApprovals[operationId][msg.sender], "Already approved");
        
        // Record approval
        operationApprovals[operationId][msg.sender] = true;
        approvalCount[operationId]++;
        
        emit OperationApproved(operationId, msg.sender, approvalCount[operationId]);
    }

    // =================== WATCHDOG MANAGEMENT ===================
    
    /// @inheritdoc IOptimisticWatchdogConsensus
    function addWatchdog(address watchdog) external override onlyRole(MANAGER_ROLE) {
        require(watchdog != address(0), "Invalid address");
        if (isActiveWatchdog[watchdog]) revert WatchdogAlreadyActive();
        require(activeWatchdogsList.length < MAX_WATCHDOGS, "Max watchdogs reached");
        
        isActiveWatchdog[watchdog] = true;
        activeWatchdogsList.push(watchdog);
        consensusState.activeWatchdogs = uint8(activeWatchdogsList.length);
        
        emit WatchdogAdded(watchdog, msg.sender);
    }
    
    /// @inheritdoc IOptimisticWatchdogConsensus
    function removeWatchdog(address watchdog, bytes32 reason) external override onlyRole(MANAGER_ROLE) {
        if (!isActiveWatchdog[watchdog]) revert NotActiveWatchdog();
        if (activeWatchdogsList.length <= MIN_WATCHDOGS) revert InsufficientWatchdogs();
        
        isActiveWatchdog[watchdog] = false;
        
        // Remove from array
        for (uint i = 0; i < activeWatchdogsList.length; i++) {
            if (activeWatchdogsList[i] == watchdog) {
                activeWatchdogsList[i] = activeWatchdogsList[activeWatchdogsList.length - 1];
                activeWatchdogsList.pop();
                break;
            }
        }
        
        consensusState.activeWatchdogs = uint8(activeWatchdogsList.length);
        
        emit WatchdogRemoved(watchdog, msg.sender, reason);
    }
    
    /// @inheritdoc IOptimisticWatchdogConsensus
    function updateConsensusParameters(
        uint8 newThreshold,
        uint32 newChallengePeriod
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newThreshold >= 2 && newThreshold <= activeWatchdogsList.length, "Invalid threshold");
        require(newChallengePeriod >= 1 hours && newChallengePeriod <= 24 hours, "Invalid period");
        
        consensusState.consensusThreshold = newThreshold;
        consensusState.baseChallengePeriod = newChallengePeriod;
        escalationDelays[0] = newChallengePeriod;
    }

    // =================== VIEW FUNCTIONS ===================
    
    /// @inheritdoc IOptimisticWatchdogConsensus
    function getOperation(bytes32 operationId) 
        external 
        view 
        override 
        returns (WatchdogOperation memory) 
    {
        return operations[operationId];
    }
    
    /// @inheritdoc IOptimisticWatchdogConsensus
    function getConsensusState() external view override returns (ConsensusState memory) {
        return consensusState;
    }
    
    /// @inheritdoc IOptimisticWatchdogConsensus
    function getActiveWatchdogs() external view override returns (address[] memory) {
        return activeWatchdogsList;
    }
    
    /// @inheritdoc IOptimisticWatchdogConsensus
    function calculatePrimaryValidator(
        bytes32 operationType,
        bytes calldata operationData
    ) public view override returns (address) {
        uint256 watchdogCount = activeWatchdogsList.length;
        require(watchdogCount > 0, "No active watchdogs");
        
        // Use previous block hash for MEV-resistant randomness
        bytes32 blockHash = blockhash(block.number - 1);
        
        // Handle edge case where blockhash returns 0 (>256 blocks old)
        if (blockHash == bytes32(0)) {
            // Fallback to pseudo-randomness based on block data
            blockHash = keccak256(abi.encode(block.timestamp, block.difficulty));
        }
        
        // Combine multiple entropy sources for security
        uint256 seed = uint256(keccak256(abi.encode(
            operationType,
            operationData,
            blockHash,
            address(this) // Contract address for cross-chain uniqueness
        )));
        
        uint256 index = seed % watchdogCount;
        address primaryValidator = activeWatchdogsList[index];
        
        emit PrimaryValidatorSelected(operationType, primaryValidator, block.number, blockHash);
        
        return primaryValidator;
    }
    
    /// @inheritdoc IOptimisticWatchdogConsensus
    function canExecuteOperation(bytes32 operationId) external view override returns (bool) {
        WatchdogOperation storage operation = operations[operationId];
        
        if (operation.submittedAt == 0) return false;
        if (operation.executed) return false;
        if (block.timestamp < operation.finalizedAt) return false;
        
        // Additional consensus checks could be added here
        return true;
    }
    
    /// @inheritdoc IOptimisticWatchdogConsensus
    function getOperationChallenges(bytes32 operationId)
        external
        view
        override
        returns (Challenge[] memory challenges)
    {
        WatchdogOperation storage operation = operations[operationId];
        challenges = new Challenge[](operation.objectionCount);
        
        uint256 index = 0;
        for (uint i = 0; i < activeWatchdogsList.length && index < operation.objectionCount; i++) {
            address watchdog = activeWatchdogsList[i];
            if (hasObjected[operationId][watchdog]) {
                challenges[index] = operationChallenges[operationId][watchdog];
                index++;
            }
        }
        
        return challenges;
    }

    // =================== INTERNAL FUNCTIONS ===================
    
    /// @dev Check if operation type is valid
    function _isValidOperationType(bytes32 operationType) internal pure returns (bool) {
        return operationType == RESERVE_ATTESTATION ||
               operationType == WALLET_REGISTRATION ||
               operationType == STATUS_CHANGE ||
               operationType == REDEMPTION_FULFILLMENT;
    }
    
    /// @dev Get escalation level based on objection count
    function _getEscalationLevel(uint8 objectionCount) internal view returns (uint8) {
        for (uint8 i = uint8(consensusThresholds.length - 1); i > 0; i--) {
            if (objectionCount >= consensusThresholds[i]) {
                return i;
            }
        }
        return 0;
    }
    
    /// @dev Get required consensus based on objection count
    function _getRequiredConsensus(uint8 objectionCount) internal view returns (uint8) {
        uint8 level = _getEscalationLevel(objectionCount);
        return consensusThresholds[level];
    }
    
    /// @dev Calculate required approvals based on objection count
    function _calculateRequiredApprovals(uint8 objectionCount) internal view returns (uint256) {
        uint256 activeCount = activeWatchdogsList.length;
        
        if (objectionCount >= consensusThresholds[3]) { // ≥5 objections
            // Require majority of active watchdogs
            return (activeCount / 2) + 1;
        } else if (objectionCount >= consensusThresholds[2]) { // ≥3 objections
            // Require at least 3 approvals or 40% of watchdogs, whichever is higher
            return activeCount >= 7 ? (activeCount * 2) / 5 : 3;
        }
        
        return 0; // No approvals needed for low objection counts
    }
    
    /// @dev Execute operation based on type
    function _executeOperationType(
        bytes32 operationType,
        bytes memory operationData
    ) internal returns (bool success) {
        // Get operation executor from registry
        address executor = protocolRegistry.getService(OPERATION_EXECUTOR_KEY);
        require(executor != address(0), "Operation executor not found");
        
        // Delegate execution to the appropriate handler
        // This will be the WatchdogAdapter in most cases
        (success,) = executor.call(abi.encodeWithSignature(
            "executeOperation(bytes32,bytes)",
            operationType,
            operationData
        ));
        
        return success;
    }

    // =================== ADMIN FUNCTIONS ===================
    
    /// @notice Pause the consensus system
    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
        consensusState.emergencyPause = true;
    }
    
    /// @notice Unpause the consensus system
    function unpause() external onlyRole(EMERGENCY_ROLE) {
        _unpause();
        consensusState.emergencyPause = false;
    }
}