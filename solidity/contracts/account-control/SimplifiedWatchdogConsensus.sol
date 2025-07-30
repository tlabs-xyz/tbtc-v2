// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./ProtocolRegistry.sol";

/// @title SimplifiedWatchdogConsensus
/// @notice N-of-M watchdog consensus using majority voting
contract SimplifiedWatchdogConsensus is AccessControl, Pausable, ReentrancyGuard {
    // =================== CONSTANTS ===================
    
    /// @notice Role for managing watchdog set
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    
    /// @notice Service key for operation executor
    bytes32 public constant OPERATION_EXECUTOR_KEY = keccak256("OPERATION_EXECUTOR");
    
    /// @notice Fixed challenge period for all operations
    uint32 public constant CHALLENGE_PERIOD = 2 hours;
    
    /// @notice Minimum number of watchdogs required
    uint8 public constant MIN_WATCHDOGS = 3;
    
    /// @notice Maximum number of watchdogs allowed
    uint8 public constant MAX_WATCHDOGS = 20;
    
    /// @notice Operation type constants
    bytes32 public constant RESERVE_ATTESTATION = keccak256("RESERVE_ATTESTATION");
    bytes32 public constant WALLET_REGISTRATION = keccak256("WALLET_REGISTRATION");
    bytes32 public constant STATUS_CHANGE = keccak256("STATUS_CHANGE");
    bytes32 public constant REDEMPTION_FULFILLMENT = keccak256("REDEMPTION_FULFILLMENT");

    // =================== STRUCTS ===================
    
    /// @notice Simplified operation structure
    struct Operation {
        bytes32 operationType;      // Type of operation
        bytes operationData;        // Encoded operation parameters
        address proposer;           // Watchdog who proposed
        uint64 submittedAt;        // Timestamp of submission
        uint64 executeAfter;       // Timestamp when executable
        uint256 forVotes;          // Number of votes in favor
        uint256 againstVotes;      // Number of votes against
        bool executed;             // Whether operation has been executed
    }

    // =================== STATE VARIABLES ===================
    
    /// @notice Protocol registry for service discovery
    ProtocolRegistry public immutable protocolRegistry;
    
    /// @notice Mapping of operation ID to operation details
    mapping(bytes32 => Operation) public operations;
    
    /// @notice Mapping of active watchdogs
    mapping(address => bool) public isActiveWatchdog;
    
    /// @notice Array of active watchdog addresses
    address[] public activeWatchdogs;
    
    /// @notice Mapping to track votes (operationId => watchdog => hasVoted)
    mapping(bytes32 => mapping(address => bool)) public hasVoted;
    
    /// @notice Mapping to track vote direction (operationId => watchdog => votedFor)
    mapping(bytes32 => mapping(address => bool)) public voteDirection;
    
    /// @notice Nonce for operation ID generation
    uint256 private operationNonce;

    // =================== EVENTS ===================
    
    event OperationProposed(
        bytes32 indexed operationId,
        bytes32 indexed operationType,
        address indexed proposer,
        uint64 executeAfter
    );
    
    event VoteCast(
        bytes32 indexed operationId,
        address indexed voter,
        bool voteFor,
        uint256 forVotes,
        uint256 againstVotes
    );
    
    event OperationExecuted(
        bytes32 indexed operationId,
        address indexed executor,
        bool success
    );
    
    event OperationRejected(
        bytes32 indexed operationId,
        uint256 forVotes,
        uint256 againstVotes
    );
    
    event WatchdogAdded(address indexed watchdog);
    event WatchdogRemoved(address indexed watchdog);

    // =================== ERRORS ===================
    
    error NotActiveWatchdog();
    error InvalidOperationType();
    error OperationNotFound();
    error AlreadyVoted();
    error VotingPeriodActive();
    error InsufficientVotes();
    error OperationAlreadyExecuted();
    error InsufficientWatchdogs();
    error WatchdogAlreadyActive();
    error MaxWatchdogsReached();

    // =================== MODIFIERS ===================
    
    modifier onlyActiveWatchdog() {
        if (!isActiveWatchdog[msg.sender]) revert NotActiveWatchdog();
        _;
    }
    
    modifier operationExists(bytes32 operationId) {
        if (operations[operationId].submittedAt == 0) revert OperationNotFound();
        _;
    }

    // =================== CONSTRUCTOR ===================
    
    constructor(address _protocolRegistry) {
        require(_protocolRegistry != address(0), "Invalid registry");
        protocolRegistry = ProtocolRegistry(_protocolRegistry);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
    }

    // =================== CORE FUNCTIONS ===================
    
    /// @notice Propose a new operation for consensus
    /// @param operationType Type of operation
    /// @param operationData Encoded operation parameters
    /// @return operationId Unique identifier for the operation
    function proposeOperation(
        bytes32 operationType,
        bytes calldata operationData
    ) external onlyActiveWatchdog whenNotPaused returns (bytes32 operationId) {
        // Validate operation type
        if (!_isValidOperationType(operationType)) revert InvalidOperationType();
        
        // Generate unique operation ID
        operationId = keccak256(abi.encode(
            operationType,
            operationData,
            msg.sender,
            block.timestamp,
            operationNonce++
        ));
        
        // Create operation
        operations[operationId] = Operation({
            operationType: operationType,
            operationData: operationData,
            proposer: msg.sender,
            submittedAt: uint64(block.timestamp),
            executeAfter: uint64(block.timestamp + CHALLENGE_PERIOD),
            forVotes: 1, // Proposer implicitly votes for
            againstVotes: 0,
            executed: false
        });
        
        // Record proposer's vote
        hasVoted[operationId][msg.sender] = true;
        voteDirection[operationId][msg.sender] = true;
        
        emit OperationProposed(
            operationId,
            operationType,
            msg.sender,
            uint64(block.timestamp + CHALLENGE_PERIOD)
        );
        
        return operationId;
    }
    
    /// @notice Vote on a proposed operation
    /// @param operationId The operation to vote on
    /// @param voteFor True to vote for, false to vote against
    function voteOnOperation(
        bytes32 operationId,
        bool voteFor
    ) external onlyActiveWatchdog operationExists(operationId) {
        Operation storage operation = operations[operationId];
        
        // Check if already executed
        if (operation.executed) revert OperationAlreadyExecuted();
        
        // Check if already voted
        if (hasVoted[operationId][msg.sender]) revert AlreadyVoted();
        
        // Record vote
        hasVoted[operationId][msg.sender] = true;
        voteDirection[operationId][msg.sender] = voteFor;
        
        if (voteFor) {
            operation.forVotes++;
        } else {
            operation.againstVotes++;
        }
        
        emit VoteCast(
            operationId,
            msg.sender,
            voteFor,
            operation.forVotes,
            operation.againstVotes
        );
        
        // Check if operation should be rejected early (majority against)
        uint256 requiredVotes = getRequiredVotes();
        if (operation.againstVotes >= requiredVotes) {
            operation.executed = true; // Mark as handled
            emit OperationRejected(
                operationId,
                operation.forVotes,
                operation.againstVotes
            );
        }
    }
    
    /// @notice Execute an operation after voting period
    /// @param operationId The operation to execute
    function executeOperation(
        bytes32 operationId
    ) external operationExists(operationId) whenNotPaused nonReentrant {
        Operation storage operation = operations[operationId];
        
        // Validate execution conditions
        if (operation.executed) revert OperationAlreadyExecuted();
        if (block.timestamp < operation.executeAfter) revert VotingPeriodActive();
        
        // Check if sufficient votes
        uint256 requiredVotes = getRequiredVotes();
        if (operation.forVotes < requiredVotes) revert InsufficientVotes();
        
        // Mark as executed
        operation.executed = true;
        
        // Execute the operation
        bool success = _executeOperationType(operation.operationType, operation.operationData);
        
        emit OperationExecuted(operationId, msg.sender, success);
    }

    // =================== WATCHDOG MANAGEMENT ===================
    
    /// @notice Add a new watchdog
    /// @param watchdog Address to add
    function addWatchdog(address watchdog) external onlyRole(MANAGER_ROLE) {
        require(watchdog != address(0), "Invalid address");
        if (isActiveWatchdog[watchdog]) revert WatchdogAlreadyActive();
        if (activeWatchdogs.length >= MAX_WATCHDOGS) revert MaxWatchdogsReached();
        
        isActiveWatchdog[watchdog] = true;
        activeWatchdogs.push(watchdog);
        
        emit WatchdogAdded(watchdog);
    }
    
    /// @notice Remove a watchdog
    /// @param watchdog Address to remove
    function removeWatchdog(address watchdog) external onlyRole(MANAGER_ROLE) {
        if (!isActiveWatchdog[watchdog]) revert NotActiveWatchdog();
        if (activeWatchdogs.length <= MIN_WATCHDOGS) revert InsufficientWatchdogs();
        
        isActiveWatchdog[watchdog] = false;
        
        // Remove from array (order doesn't matter)
        for (uint i = 0; i < activeWatchdogs.length; i++) {
            if (activeWatchdogs[i] == watchdog) {
                activeWatchdogs[i] = activeWatchdogs[activeWatchdogs.length - 1];
                activeWatchdogs.pop();
                break;
            }
        }
        
        emit WatchdogRemoved(watchdog);
    }

    // =================== VIEW FUNCTIONS ===================
    
    /// @notice Get the required number of votes (simple majority)
    /// @return votes Required number of votes
    function getRequiredVotes() public view returns (uint256 votes) {
        return (activeWatchdogs.length / 2) + 1;
    }
    
    /// @notice Get operation details
    /// @param operationId The operation to query
    /// @return operation The operation details
    function getOperation(bytes32 operationId) external view returns (Operation memory) {
        return operations[operationId];
    }
    
    /// @notice Get active watchdog count
    /// @return count Number of active watchdogs
    function getActiveWatchdogCount() external view returns (uint256) {
        return activeWatchdogs.length;
    }
    
    /// @notice Get all active watchdogs
    /// @return Array of active watchdog addresses
    function getActiveWatchdogs() external view returns (address[] memory) {
        return activeWatchdogs;
    }
    
    /// @notice Check if operation can be executed
    /// @param operationId The operation to check
    /// @return canExecute Whether operation can be executed
    function canExecuteOperation(bytes32 operationId) external view returns (bool) {
        Operation storage operation = operations[operationId];
        
        if (operation.submittedAt == 0) return false;
        if (operation.executed) return false;
        if (block.timestamp < operation.executeAfter) return false;
        if (operation.forVotes < getRequiredVotes()) return false;
        
        return true;
    }

    // =================== INTERNAL FUNCTIONS ===================
    
    /// @dev Check if operation type is valid
    function _isValidOperationType(bytes32 operationType) internal pure returns (bool) {
        return operationType == RESERVE_ATTESTATION ||
               operationType == WALLET_REGISTRATION ||
               operationType == STATUS_CHANGE ||
               operationType == REDEMPTION_FULFILLMENT;
    }
    
    /// @dev Execute operation based on type
    function _executeOperationType(
        bytes32 operationType,
        bytes memory operationData
    ) internal returns (bool success) {
        // Get operation executor from registry
        address executor = protocolRegistry.getService(OPERATION_EXECUTOR_KEY);
        require(executor != address(0), "Operation executor not found");
        
        // Delegate to executor
        (success,) = executor.call(
            abi.encodeWithSignature(
                "executeOperation(bytes32,bytes)",
                operationType,
                operationData
            )
        );
        
        return success;
    }

    // =================== ADMIN FUNCTIONS ===================
    
    /// @notice Pause the contract
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }
    
    /// @notice Unpause the contract
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}