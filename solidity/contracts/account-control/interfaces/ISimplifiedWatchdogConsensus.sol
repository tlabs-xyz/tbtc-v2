// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title ISimplifiedWatchdogConsensus
/// @notice Interface for the simplified watchdog consensus system
/// @dev Simple majority voting without MEV resistance or complex escalation
interface ISimplifiedWatchdogConsensus {
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

    // =================== EVENTS ===================
    
    /// @notice Emitted when a new operation is proposed
    event OperationProposed(
        bytes32 indexed operationId,
        bytes32 indexed operationType,
        address indexed proposer,
        uint64 executeAfter
    );
    
    /// @notice Emitted when a vote is cast
    event VoteCast(
        bytes32 indexed operationId,
        address indexed voter,
        bool voteFor,
        uint256 forVotes,
        uint256 againstVotes
    );
    
    /// @notice Emitted when an operation is executed
    event OperationExecuted(
        bytes32 indexed operationId,
        address indexed executor,
        bool success
    );
    
    /// @notice Emitted when an operation is rejected
    event OperationRejected(
        bytes32 indexed operationId,
        uint256 forVotes,
        uint256 againstVotes
    );
    
    /// @notice Emitted when a watchdog is added
    event WatchdogAdded(address indexed watchdog);
    
    /// @notice Emitted when a watchdog is removed
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

    // =================== CORE FUNCTIONS ===================
    
    /// @notice Propose a new operation for consensus
    /// @param operationType Type of operation
    /// @param operationData Encoded operation parameters
    /// @return operationId Unique identifier for the operation
    function proposeOperation(
        bytes32 operationType,
        bytes calldata operationData
    ) external returns (bytes32 operationId);
    
    /// @notice Vote on a proposed operation
    /// @param operationId The operation to vote on
    /// @param voteFor True to vote for, false to vote against
    function voteOnOperation(
        bytes32 operationId,
        bool voteFor
    ) external;
    
    /// @notice Execute an operation after voting period
    /// @param operationId The operation to execute
    function executeOperation(bytes32 operationId) external;

    // =================== WATCHDOG MANAGEMENT ===================
    
    /// @notice Add a new watchdog
    /// @param watchdog Address to add
    function addWatchdog(address watchdog) external;
    
    /// @notice Remove a watchdog
    /// @param watchdog Address to remove
    function removeWatchdog(address watchdog) external;

    // =================== VIEW FUNCTIONS ===================
    
    /// @notice Get the required number of votes (simple majority)
    /// @return votes Required number of votes
    function getRequiredVotes() external view returns (uint256 votes);
    
    /// @notice Get operation details
    /// @param operationId The operation to query
    /// @return operation The operation details
    function getOperation(bytes32 operationId) external view returns (Operation memory operation);
    
    /// @notice Check if address is active watchdog
    /// @param watchdog Address to check
    /// @return isActive Whether address is active watchdog
    function isActiveWatchdog(address watchdog) external view returns (bool isActive);
    
    /// @notice Get active watchdog count
    /// @return count Number of active watchdogs
    function getActiveWatchdogCount() external view returns (uint256 count);
    
    /// @notice Get all active watchdogs
    /// @return Array of active watchdog addresses
    function getActiveWatchdogs() external view returns (address[] memory);
    
    /// @notice Check if operation can be executed
    /// @param operationId The operation to check
    /// @return canExecute Whether operation can be executed
    function canExecuteOperation(bytes32 operationId) external view returns (bool canExecute);

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