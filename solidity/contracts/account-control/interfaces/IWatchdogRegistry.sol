// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title IWatchdogRegistry
/// @notice Interface for managing watchdog registration and performance tracking
/// @dev This interface defines functionality for v1.1 watchdog registry
///      including registration, performance metrics, and stake management
interface IWatchdogRegistry {
    // =================== DATA STRUCTURES ===================

    /// @notice Information about a registered watchdog
    struct WatchdogInfo {
        address watchdogAddress;    // Address of the watchdog
        bool isActive;             // Whether currently active in consensus
        uint64 registeredAt;       // Registration timestamp
        uint64 lastActiveAt;       // Last activity timestamp
        string jurisdiction;       // Operating jurisdiction
        uint256 performanceScore;  // Performance metric (0-10000)
        uint256 totalOperations;   // Total operations participated in
        uint256 successfulOps;     // Successful operations
        uint256 challengesRaised;  // Number of challenges raised
        uint256 challengesWon;     // Successful challenges
    }

    /// @notice Stake information for a watchdog
    struct StakeInfo {
        uint256 tTokenStake;       // Amount of T tokens staked
        uint256 stakedAt;          // Staking timestamp
        uint256 lockupUntil;       // Lockup period end
        bool slashed;              // Whether stake has been slashed
    }

    // =================== EVENTS ===================

    /// @notice Emitted when a new watchdog is registered
    /// @param watchdog Address of the registered watchdog
    /// @param jurisdiction Operating jurisdiction
    /// @param registeredBy Who registered the watchdog
    event WatchdogRegistered(
        address indexed watchdog,
        string jurisdiction,
        address indexed registeredBy
    );

    /// @notice Emitted when watchdog status changes
    /// @param watchdog Address of the watchdog
    /// @param isActive New active status
    /// @param changedBy Who changed the status
    event WatchdogStatusChanged(
        address indexed watchdog,
        bool indexed isActive,
        address indexed changedBy
    );

    /// @notice Emitted when watchdog performance is updated
    /// @param watchdog Address of the watchdog
    /// @param newScore New performance score
    /// @param totalOps Total operations count
    event PerformanceUpdated(
        address indexed watchdog,
        uint256 newScore,
        uint256 totalOps
    );

    /// @notice Emitted when stake is added or updated
    /// @param watchdog Address of the watchdog
    /// @param amount Amount staked
    /// @param lockupUntil Lockup period end
    event StakeUpdated(
        address indexed watchdog,
        uint256 amount,
        uint256 lockupUntil
    );

    /// @notice Emitted when stake is slashed
    /// @param watchdog Address of the watchdog
    /// @param amount Amount slashed
    /// @param reason Reason for slashing
    event StakeSlashed(
        address indexed watchdog,
        uint256 amount,
        bytes32 reason
    );

    // =================== ERRORS ===================

    /// @notice Thrown when watchdog is already registered
    error WatchdogAlreadyRegistered();
    
    /// @notice Thrown when watchdog is not registered
    error WatchdogNotRegistered();
    
    /// @notice Thrown when jurisdiction is invalid
    error InvalidJurisdiction();
    
    /// @notice Thrown when stake amount is insufficient
    error InsufficientStake();
    
    /// @notice Thrown when stake is locked
    error StakeLocked();
    
    /// @notice Thrown when performance score is invalid
    error InvalidPerformanceScore();

    // =================== REGISTRATION FUNCTIONS ===================

    /// @notice Register a new watchdog
    /// @param watchdog Address to register
    /// @param jurisdiction Operating jurisdiction code
    function registerWatchdog(
        address watchdog,
        string calldata jurisdiction
    ) external;

    /// @notice Update watchdog active status
    /// @param watchdog Address of the watchdog
    /// @param isActive New active status
    function setWatchdogStatus(
        address watchdog,
        bool isActive
    ) external;

    /// @notice Remove a watchdog from registry
    /// @param watchdog Address to remove
    /// @param reason Reason for removal
    function removeWatchdog(
        address watchdog,
        bytes32 reason
    ) external;

    // =================== PERFORMANCE FUNCTIONS ===================

    /// @notice Record operation participation
    /// @param watchdog Address of the watchdog
    /// @param wasSuccessful Whether operation was successful
    function recordOperation(
        address watchdog,
        bool wasSuccessful
    ) external;

    /// @notice Record challenge raised
    /// @param watchdog Address of the watchdog
    /// @param wasValid Whether challenge was valid
    function recordChallenge(
        address watchdog,
        bool wasValid
    ) external;

    /// @notice Update performance score
    /// @param watchdog Address of the watchdog
    function updatePerformanceScore(address watchdog) external;

    // =================== STAKE FUNCTIONS ===================

    /// @notice Add or update T token stake
    /// @param watchdog Address of the watchdog
    /// @param amount Amount to stake
    /// @param lockupPeriod Lockup duration in seconds
    function updateStake(
        address watchdog,
        uint256 amount,
        uint256 lockupPeriod
    ) external;

    /// @notice Slash watchdog stake
    /// @param watchdog Address to slash
    /// @param amount Amount to slash
    /// @param reason Reason for slashing
    function slashStake(
        address watchdog,
        uint256 amount,
        bytes32 reason
    ) external;

    /// @notice Withdraw unlocked stake
    /// @param watchdog Address of the watchdog
    function withdrawStake(address watchdog) external;

    // =================== VIEW FUNCTIONS ===================

    /// @notice Get watchdog information
    /// @param watchdog Address to query
    /// @return info Watchdog information
    function getWatchdogInfo(address watchdog)
        external
        view
        returns (WatchdogInfo memory info);

    /// @notice Get stake information
    /// @param watchdog Address to query
    /// @return stake Stake information
    function getStakeInfo(address watchdog)
        external
        view
        returns (StakeInfo memory stake);

    /// @notice Get all active watchdogs
    /// @return watchdogs Array of active watchdog addresses
    function getActiveWatchdogs()
        external
        view
        returns (address[] memory watchdogs);

    /// @notice Get watchdogs by jurisdiction
    /// @param jurisdiction Jurisdiction code
    /// @return watchdogs Array of watchdog addresses
    function getWatchdogsByJurisdiction(string calldata jurisdiction)
        external
        view
        returns (address[] memory watchdogs);

    /// @notice Get top performing watchdogs
    /// @param count Number of watchdogs to return
    /// @return watchdogs Array of top performing addresses
    function getTopPerformers(uint256 count)
        external
        view
        returns (address[] memory watchdogs);

    /// @notice Check if address is registered watchdog
    /// @param watchdog Address to check
    /// @return isRegistered Whether address is registered
    function isRegisteredWatchdog(address watchdog)
        external
        view
        returns (bool isRegistered);

    /// @notice Get total number of active watchdogs
    /// @return count Number of active watchdogs
    function getActiveWatchdogCount()
        external
        view
        returns (uint256 count);

    /// @notice Get minimum stake requirement
    /// @return minStake Minimum stake amount
    function getMinimumStake()
        external
        view
        returns (uint256 minStake);

    /// @notice Calculate weighted random selection
    /// @param seed Random seed for selection
    /// @return selected Address of selected watchdog
    function selectWeightedRandom(uint256 seed)
        external
        view
        returns (address selected);
}