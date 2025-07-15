// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../../bridge/BitcoinTx.sol";

/// @title IOptimisticWatchdogConsensus
/// @notice Interface for the optimistic N-of-M watchdog consensus system
/// @dev This interface defines the core functionality for v1.1 watchdog quorum
///      implementation, enabling multiple watchdogs to participate in consensus
///      decisions with optimistic execution and challenge mechanisms.
interface IOptimisticWatchdogConsensus {
    // =================== DATA STRUCTURES ===================

    /// @notice Represents an operation submitted for consensus
    /// @dev Operations are executed optimistically after a challenge period
    struct WatchdogOperation {
        bytes32 operationType;      // Type of operation (ATTESTATION, REGISTRATION, etc.)
        bytes operationData;        // Encoded operation parameters
        address primaryValidator;   // Watchdog who submitted the operation
        uint64 submittedAt;        // Timestamp of submission
        uint64 finalizedAt;        // Timestamp when operation can be executed
        uint8 objectionCount;      // Number of objections raised
        bool executed;             // Whether operation has been executed
        bool challenged;           // Whether operation has been challenged
    }

    /// @notice Consensus state for tracking system parameters
    struct ConsensusState {
        uint8 activeWatchdogs;      // Number of active watchdogs
        uint8 consensusThreshold;   // Required signatures for consensus
        uint32 baseChallengePeriod; // Base challenge period in seconds
        bool emergencyPause;        // Emergency pause state
    }

    /// @notice Challenge details for disputed operations
    struct Challenge {
        address challenger;         // Watchdog who raised the challenge
        bytes evidence;            // Evidence supporting the challenge
        uint64 challengedAt;       // Timestamp of challenge
    }

    // =================== EVENTS ===================

    /// @notice Emitted when a new operation is submitted optimistically
    /// @param operationId Unique identifier for the operation
    /// @param operationType Type of operation submitted
    /// @param primaryValidator Address of the submitting watchdog
    /// @param finalizeAt Timestamp when operation can be executed
    event OperationSubmitted(
        bytes32 indexed operationId,
        bytes32 indexed operationType,
        address indexed primaryValidator,
        uint64 finalizeAt
    );

    /// @notice Emitted when an operation is challenged
    /// @param operationId Unique identifier for the operation
    /// @param challenger Address of the challenging watchdog
    /// @param objectionCount Total objections after this challenge
    /// @param newFinalizeAt Updated finalization timestamp after escalation
    event OperationChallenged(
        bytes32 indexed operationId,
        address indexed challenger,
        uint8 objectionCount,
        uint64 newFinalizeAt
    );

    /// @notice Emitted when consensus requirements escalate
    /// @param operationId Unique identifier for the operation
    /// @param escalationLevel New escalation level (1, 2, 3)
    /// @param requiredConsensus Number of signatures now required
    /// @param additionalDelay Additional delay added in seconds
    event ConsensusEscalated(
        bytes32 indexed operationId,
        uint8 indexed escalationLevel,
        uint8 requiredConsensus,
        uint32 additionalDelay
    );

    /// @notice Emitted when an operation is executed
    /// @param operationId Unique identifier for the operation
    /// @param executor Address that triggered execution
    /// @param success Whether the operation succeeded
    event OperationExecuted(
        bytes32 indexed operationId,
        address indexed executor,
        bool success
    );

    /// @notice Emitted when emergency override is used
    /// @param operationId Unique identifier for the operation
    /// @param overrider Address with emergency powers
    /// @param reason Reason for emergency action
    event EmergencyOverride(
        bytes32 indexed operationId,
        address indexed overrider,
        bytes32 reason
    );

    /// @notice Emitted when a watchdog is added to the active set
    /// @param watchdog Address of the new watchdog
    /// @param addedBy Address that added the watchdog
    event WatchdogAdded(
        address indexed watchdog,
        address indexed addedBy
    );

    /// @notice Emitted when a watchdog is removed from the active set
    /// @param watchdog Address of the removed watchdog
    /// @param removedBy Address that removed the watchdog
    /// @param reason Reason for removal
    event WatchdogRemoved(
        address indexed watchdog,
        address indexed removedBy,
        bytes32 reason
    );

    /// @notice Emitted when primary validator is selected for an operation
    /// @param operationType Type of operation
    /// @param primaryValidator Selected validator address
    /// @param blockNumber Block number used for selection
    /// @param blockHash Block hash used for randomness
    event PrimaryValidatorSelected(
        bytes32 indexed operationType,
        address indexed primaryValidator,
        uint256 blockNumber,
        bytes32 blockHash
    );

    /// @notice Emitted when a watchdog approves a disputed operation
    /// @param operationId The operation being approved
    /// @param approver Address of the approving watchdog
    /// @param totalApprovals Total number of approvals after this approval
    event OperationApproved(
        bytes32 indexed operationId,
        address indexed approver,
        uint256 totalApprovals
    );

    // =================== ERRORS ===================

    /// @notice Thrown when caller is not an active watchdog
    error NotActiveWatchdog();
    
    /// @notice Thrown when caller is not the designated primary validator
    error NotPrimaryValidator();
    
    /// @notice Thrown when operation doesn't exist
    error OperationNotFound();
    
    /// @notice Thrown when operation is already executed
    error OperationAlreadyExecuted();
    
    /// @notice Thrown when challenge period hasn't expired
    error ChallengePeriodActive();
    
    /// @notice Thrown when consensus requirements not met
    error InsufficientConsensus();
    
    /// @notice Thrown when watchdog has already objected
    error AlreadyObjected();
    
    /// @notice Thrown when operation type is invalid
    error InvalidOperationType();
    
    /// @notice Thrown when system is paused
    error SystemPaused();
    
    /// @notice Thrown when trying to add duplicate watchdog
    error WatchdogAlreadyActive();
    
    /// @notice Thrown when removing would break minimum watchdog count
    error InsufficientWatchdogs();

    // =================== CORE FUNCTIONS ===================

    /// @notice Submit an operation for optimistic execution
    /// @param operationType Type of operation (ATTESTATION, REGISTRATION, etc.)
    /// @param operationData Encoded parameters for the operation
    /// @return operationId Unique identifier for the submitted operation
    function submitOptimisticOperation(
        bytes32 operationType,
        bytes calldata operationData
    ) external returns (bytes32 operationId);

    /// @notice Challenge a pending operation with evidence
    /// @param operationId The operation to challenge
    /// @param evidence Data supporting the challenge
    function challengeOperation(
        bytes32 operationId,
        bytes calldata evidence
    ) external;

    /// @notice Execute an operation after challenge period expires
    /// @param operationId The operation to execute
    function executeOperation(bytes32 operationId) external;

    /// @notice Emergency override by authorized role
    /// @param operationId The operation to override
    /// @param reason Reason for emergency action
    function emergencyOverride(
        bytes32 operationId,
        bytes32 reason
    ) external;

    /// @notice Approve a disputed operation for execution
    /// @param operationId The operation to approve
    function approveOperation(bytes32 operationId) external;

    // =================== CONSENSUS MANAGEMENT ===================

    /// @notice Add a new watchdog to the active set
    /// @param watchdog Address to add as active watchdog
    function addWatchdog(address watchdog) external;

    /// @notice Remove a watchdog from the active set
    /// @param watchdog Address to remove from active set
    /// @param reason Reason for removal
    function removeWatchdog(address watchdog, bytes32 reason) external;

    /// @notice Update consensus parameters
    /// @param newThreshold New consensus threshold
    /// @param newChallengePeriod New base challenge period
    function updateConsensusParameters(
        uint8 newThreshold,
        uint32 newChallengePeriod
    ) external;

    // =================== VIEW FUNCTIONS ===================

    /// @notice Get operation details
    /// @param operationId The operation to query
    /// @return operation The operation details
    function getOperation(bytes32 operationId) 
        external 
        view 
        returns (WatchdogOperation memory operation);

    /// @notice Check if address is active watchdog
    /// @param watchdog Address to check
    /// @return isActive Whether address is active watchdog
    function isActiveWatchdog(address watchdog) 
        external 
        view 
        returns (bool isActive);

    /// @notice Get current consensus state
    /// @return state Current consensus parameters
    function getConsensusState() 
        external 
        view 
        returns (ConsensusState memory state);

    /// @notice Get list of active watchdogs
    /// @return watchdogs Array of active watchdog addresses
    function getActiveWatchdogs() 
        external 
        view 
        returns (address[] memory watchdogs);

    /// @notice Calculate primary validator for an operation
    /// @param operationType Type of operation
    /// @param operationData Operation parameters
    /// @return primaryValidator Address of designated primary validator
    function calculatePrimaryValidator(
        bytes32 operationType,
        bytes calldata operationData
    ) external view returns (address primaryValidator);

    /// @notice Check if operation can be executed
    /// @param operationId The operation to check
    /// @return canExecute Whether operation can be executed now
    function canExecuteOperation(bytes32 operationId) 
        external 
        view 
        returns (bool canExecute);

    /// @notice Get challenges for an operation
    /// @param operationId The operation to query
    /// @return challenges Array of challenges raised
    function getOperationChallenges(bytes32 operationId)
        external
        view
        returns (Challenge[] memory challenges);

    // =================== OPERATION TYPE CONSTANTS ===================

    /// @notice Operation type for reserve attestation
    function RESERVE_ATTESTATION() external pure returns (bytes32);
    
    /// @notice Operation type for wallet registration
    function WALLET_REGISTRATION() external pure returns (bytes32);
    
    /// @notice Operation type for QC status change
    function STATUS_CHANGE() external pure returns (bytes32);
    
    /// @notice Operation type for redemption fulfillment
    function REDEMPTION_FULFILLMENT() external pure returns (bytes32);
}