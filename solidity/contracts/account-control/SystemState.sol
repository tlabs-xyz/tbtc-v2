// SPDX-License-Identifier: GPL-3.0-only

// ██████████████     ▐████▌     ██████████████
// ██████████████     ▐████▌     ██████████████
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
// ██████████████     ▐████▌     ██████████████
// ██████████████     ▐████▌     ██████████████
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌

pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./QCErrors.sol";

/// @title SystemState
/// @dev Global system state and emergency controls for the tBTC Account Control system.
///
/// This contract serves as the central control plane for emergency response and system-wide
/// parameters. It provides both granular function-level pauses and QC-specific emergency
/// controls to enable surgical responses to threats while minimizing system-wide impact.
///
/// ## Emergency Control Architecture
///
/// ### Global Pause Mechanisms
/// - **Function-Specific Pauses**: Can pause minting, redemption, wallet registration independently
/// - **Time-Limited Duration**: All pauses expire automatically after emergencyPauseDuration (default 7 days)
/// - **No Global Kill Switch**: Intentional design to prevent single points of failure
///
/// ### QC-Specific Emergency Controls
/// - **Individual QC Pausing**: Target specific qualified custodians without affecting others
/// - **Reason Code Tracking**: Machine-readable reason codes for automated integration
/// - **Reversible Operations**: Both pause and unpause functions for incident response
/// - **Integration Ready**: Provides modifier for other contracts to check pause status
///
/// ### Integration with Watchdog System
/// - **Automated Triggering**: WatchdogEnforcer calls emergencyPauseQC() for violations
/// - **Threshold Monitoring**: Automated systems monitor collateral ratios and attestation staleness
/// - **Event-Driven Monitoring**: Comprehensive event logging for off-chain monitoring systems
///
/// ## Role Definitions
/// - **DEFAULT_ADMIN_ROLE**: Can grant/revoke roles and set emergency council
/// - **OPERATIONS_ROLE**: Can update all system parameters within bounds
/// - **EMERGENCY_ROLE**: Can pause/unpause system functions and individual QCs
///
/// ## Security Features
/// - **Role-Based Access Control**: All emergency functions protected by OpenZeppelin AccessControl
/// - **Parameter Bounds Validation**: Hard-coded limits prevent malicious parameter changes
/// - **Comprehensive Event Logging**: Full audit trail for all emergency actions
/// - **Expiry Mechanisms**: Automatic recovery from time-limited emergency states
contract SystemState is AccessControl, QCErrors {
    bytes32 public constant OPERATIONS_ROLE =
        keccak256("OPERATIONS_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    // Action constants for emergency events
    bytes32 public constant ACTION_QC_EMERGENCY_PAUSE = keccak256("QC_EMERGENCY_PAUSE");
    bytes32 public constant ACTION_QC_EMERGENCY_UNPAUSE = keccak256("QC_EMERGENCY_UNPAUSE");
    
    // Pause key constants for gas efficiency and security
    bytes32 private constant PAUSE_KEY_MINTING = keccak256("minting");
    bytes32 private constant PAUSE_KEY_REDEMPTION = keccak256("redemption");
    bytes32 private constant PAUSE_KEY_WALLET_REGISTRATION = keccak256("wallet_registration");

    /// @dev Global pause flags for granular emergency controls
    bool public isMintingPaused;
    bool public isRedemptionPaused;
    bool public isWalletRegistrationPaused;

    /// @dev Global system parameters
    uint256 public staleThreshold; // Time after which reserve attestations are stale
    uint256 public redemptionTimeout; // Maximum time for redemption fulfillment
    uint256 public minMintAmount; // Minimum amount for minting operations
    uint256 public maxMintAmount; // Maximum amount for single minting operation

    /// @dev Oracle system parameters
    uint256 public oracleConsensusThreshold; // Number of attestations required for consensus
    uint256 public oracleAttestationTimeout; // Time window for attestations to be considered valid
    uint256 public oracleMaxStaleness; // Maximum time before reserve data is considered stale
    uint256 public oracleRetryInterval; // Retry interval for oracle operations

    /// @dev Automated enforcement parameters
    uint256 public minCollateralRatio; // Minimum collateral ratio percentage (e.g., 90 for 90%)
    uint256 public failureThreshold; // Number of failures before enforcement action
    uint256 public failureWindow; // Time window for counting failures

    /// @dev QC sync parameters
    uint256 public minSyncInterval = 5 minutes;

    // Parameter bounds for safety
    uint256 public constant MAX_SYNC_INTERVAL = 1 hours;
    uint256 public constant MIN_SYNC_INTERVAL_BOUND = 1 minutes;
    
    // Oracle parameter bounds
    uint256 public constant MIN_CONSENSUS_THRESHOLD = 1;
    uint256 public constant MAX_CONSENSUS_THRESHOLD = 10;
    uint256 public constant MIN_ATTESTATION_TIMEOUT = 1 hours;
    uint256 public constant MAX_ATTESTATION_TIMEOUT = 24 hours;
    uint256 public constant MIN_ORACLE_STALENESS = 6 hours;
    uint256 public constant MAX_ORACLE_STALENESS = 7 days;
    uint256 public constant MIN_ORACLE_RETRY_INTERVAL = 30 minutes;
    uint256 public constant MAX_ORACLE_RETRY_INTERVAL = 12 hours;

    /// @dev Emergency parameters
    address public emergencyCouncil; // Emergency council address
    uint256 public emergencyPauseDuration; // Maximum duration for emergency pauses
    mapping(bytes32 => uint256) public pauseTimestamps; // Tracks when pauses were activated
    mapping(address => bool) public qcEmergencyPauses; // Tracks QC-specific emergency pauses
    mapping(address => uint256) public qcPauseTimestamps; // Tracks when QCs were emergency paused

    // =================== STANDARDIZED EVENTS ===================

    /// @dev Emitted when system parameters are updated
    event MinMintAmountUpdated(
        uint256 indexed oldAmount,
        uint256 indexed newAmount,
        address indexed updatedBy,
        uint256 timestamp
    );

    event MaxMintAmountUpdated(
        uint256 indexed oldAmount,
        uint256 indexed newAmount,
        address indexed updatedBy,
        uint256 timestamp
    );

    event RedemptionTimeoutUpdated(
        uint256 indexed oldTimeout,
        uint256 indexed newTimeout,
        address indexed updatedBy,
        uint256 timestamp
    );

    event StaleThresholdUpdated(
        uint256 indexed oldThreshold,
        uint256 indexed newThreshold,
        address indexed updatedBy,
        uint256 timestamp
    );


    event EmergencyPauseDurationUpdated(
        uint256 indexed oldDuration,
        uint256 indexed newDuration,
        address indexed updatedBy,
        uint256 timestamp
    );

    /// @dev Emitted when specific function types are paused/unpaused
    event MintingPaused(address indexed pausedBy, uint256 indexed timestamp);

    event MintingUnpaused(
        address indexed unpausedBy,
        uint256 indexed timestamp
    );

    event RedemptionPaused(
        address indexed pausedBy,
        uint256 indexed timestamp
    );

    event RedemptionUnpaused(
        address indexed unpausedBy,
        uint256 indexed timestamp
    );


    event WalletRegistrationPaused(
        address indexed pausedBy,
        uint256 indexed timestamp
    );

    event WalletRegistrationUnpaused(
        address indexed unpausedBy,
        uint256 indexed timestamp
    );

    /// @dev Emitted when emergency council is updated
    event EmergencyCouncilUpdated(
        address indexed oldCouncil,
        address indexed newCouncil,
        address indexed updatedBy
    );

    /// @dev Emitted when automated enforcement parameters are updated
    event MinCollateralRatioUpdated(
        uint256 indexed oldRatio,
        uint256 indexed newRatio,
        address indexed updatedBy
    );

    event FailureThresholdUpdated(
        uint256 indexed oldThreshold,
        uint256 indexed newThreshold,
        address indexed updatedBy
    );

    event FailureWindowUpdated(
        uint256 indexed oldWindow,
        uint256 indexed newWindow,
        address indexed updatedBy
    );

    /// @dev Emitted when oracle parameters are updated
    event OracleConsensusThresholdUpdated(
        uint256 indexed oldThreshold,
        uint256 indexed newThreshold,
        address indexed updatedBy
    );

    event OracleAttestationTimeoutUpdated(
        uint256 indexed oldTimeout,
        uint256 indexed newTimeout,
        address indexed updatedBy
    );

    event OracleMaxStalenessUpdated(
        uint256 indexed oldStaleness,
        uint256 indexed newStaleness,
        address indexed updatedBy
    );


    event OracleRetryIntervalUpdated(
        uint256 indexed oldInterval,
        uint256 indexed newInterval,
        address indexed updatedBy
    );

    event MinSyncIntervalUpdated(uint256 oldInterval, uint256 newInterval);
    
    /// @dev Events for role management are inherited from AccessControl

    // =================== MODIFIERS ===================

    modifier notPaused(string memory functionName) {
        bytes32 pauseKey = keccak256(abi.encodePacked(functionName));
        _clearExpiredPause(pauseKey);
        if (pauseKey == PAUSE_KEY_MINTING) {
            if (isMintingPaused) revert MintingIsPaused();
        } else if (pauseKey == PAUSE_KEY_REDEMPTION) {
            if (isRedemptionPaused) revert RedemptionIsPaused();
        } else if (pauseKey == PAUSE_KEY_WALLET_REGISTRATION) {
            if (isWalletRegistrationPaused) revert WalletRegistrationIsPaused();
        } else {
            // CRITICAL SECURITY FIX: Reject unknown pause keys to prevent bypass
            revert InvalidPauseKey(functionName);
        }
        _;
    }

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATIONS_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);

        // Set default parameters
        staleThreshold = 24 hours; // Reserve attestations stale after 24 hours
        redemptionTimeout = 7 days; // 7 days to fulfill redemptions
        minMintAmount = 0.001 ether; // Minimum 0.001 tBTC for minting operations
        maxMintAmount = 1000 ether; // Maximum 1000 tBTC per transaction
        emergencyPauseDuration = 7 days; // Emergency pauses last max 7 days

        // Set automated enforcement defaults
        minCollateralRatio = 100; // 100% minimum collateral ratio
        failureThreshold = 3; // 3 failures trigger enforcement
        failureWindow = 7 days; // Count failures over 7 days

        // Set oracle system defaults
        oracleConsensusThreshold = 3; // 3 attestations required for consensus
        oracleAttestationTimeout = 6 hours; // 6 hour window for attestations
        oracleMaxStaleness = 24 hours; // Max 24 hours before data is stale
        oracleRetryInterval = 1 hours; // 1 hour retry interval
    }

    // =================== PAUSE FUNCTIONS ===================

    /// @notice Pause minting operations
    /// @dev Activates emergency pause for all minting operations system-wide.
    ///      Automatically expires after emergencyPauseDuration. Clears any existing
    ///      expired pause before setting new pause state.
    function pauseMinting() external onlyRole(EMERGENCY_ROLE) {
        bytes32 pauseKey = keccak256("minting");
        _clearExpiredPause(pauseKey);
        if (isMintingPaused) revert MintingAlreadyPaused();
        isMintingPaused = true;
        pauseTimestamps[pauseKey] = block.timestamp;
        emit MintingPaused(msg.sender, block.timestamp);
    }

    /// @notice Unpause minting operations
    /// @dev Manually clears emergency pause for minting operations, allowing
    ///      normal minting to resume immediately. Also cleans up pause timestamp.
    function unpauseMinting() external onlyRole(EMERGENCY_ROLE) {
        if (!isMintingPaused) revert MintingNotPaused();
        isMintingPaused = false;
        delete pauseTimestamps[keccak256("minting")];
        emit MintingUnpaused(msg.sender, block.timestamp);
    }

    /// @notice Pause redemption operations
    /// @dev Activates emergency pause for all redemption operations system-wide.
    ///      Automatically expires after emergencyPauseDuration. Clears any existing
    ///      expired pause before setting new pause state.
    function pauseRedemption() external onlyRole(EMERGENCY_ROLE) {
        bytes32 pauseKey = keccak256("redemption");
        _clearExpiredPause(pauseKey);
        if (isRedemptionPaused) revert RedemptionAlreadyPaused();
        isRedemptionPaused = true;
        pauseTimestamps[pauseKey] = block.timestamp;
        emit RedemptionPaused(msg.sender, block.timestamp);
    }

    /// @notice Unpause redemption operations
    /// @dev Manually clears emergency pause for redemption operations, allowing
    ///      normal redemptions to resume immediately. Also cleans up pause timestamp.
    function unpauseRedemption() external onlyRole(EMERGENCY_ROLE) {
        if (!isRedemptionPaused) revert RedemptionNotPaused();
        isRedemptionPaused = false;
        delete pauseTimestamps[keccak256("redemption")];
        emit RedemptionUnpaused(msg.sender, block.timestamp);
    }


    /// @notice Pause wallet registration operations
    /// @dev Activates emergency pause for all wallet registration operations system-wide.
    ///      Automatically expires after emergencyPauseDuration. Clears any existing
    ///      expired pause before setting new pause state.
    function pauseWalletRegistration() external onlyRole(EMERGENCY_ROLE) {
        bytes32 pauseKey = keccak256("wallet_registration");
        _clearExpiredPause(pauseKey);
        if (isWalletRegistrationPaused)
            revert WalletRegistrationAlreadyPaused();
        isWalletRegistrationPaused = true;
        pauseTimestamps[pauseKey] = block.timestamp;
        emit WalletRegistrationPaused(msg.sender, block.timestamp);
    }

    /// @notice Unpause wallet registration operations
    /// @dev Manually clears emergency pause for wallet registration operations, allowing
    ///      normal wallet registrations to resume immediately. Also cleans up pause timestamp.
    function unpauseWalletRegistration() external onlyRole(EMERGENCY_ROLE) {
        if (!isWalletRegistrationPaused) revert WalletRegistrationNotPaused();
        isWalletRegistrationPaused = false;
        delete pauseTimestamps[keccak256("wallet_registration")];
        emit WalletRegistrationUnpaused(msg.sender, block.timestamp);
    }

    // =================== PARAMETER FUNCTIONS ===================

    /// @notice Update minimum mint amount
    /// @dev Sets the minimum amount required for minting operations to prevent dust transactions
    ///      and maintain economic viability. Must be non-zero and cannot exceed maxMintAmount
    ///      to maintain valid mint range constraints.
    /// @param newAmount The new minimum amount (must be > 0 and <= maxMintAmount)
    function setMinMintAmount(uint256 newAmount)
        external
        onlyRole(OPERATIONS_ROLE)
    {
        if (newAmount == 0) revert InvalidAmount();
        if (newAmount > maxMintAmount)
            revert MinAmountExceedsMax(newAmount, maxMintAmount);

        uint256 oldAmount = minMintAmount;
        minMintAmount = newAmount;

        emit MinMintAmountUpdated(oldAmount, newAmount, msg.sender, block.timestamp);
    }

    /// @notice Update maximum mint amount
    /// @dev Sets the maximum amount allowed for single minting operations to limit exposure
    ///      and manage liquidity constraints. Must be at least equal to minMintAmount
    ///      to maintain valid mint range. Used for risk management and operational limits.
    /// @param newAmount The new maximum amount (must be >= minMintAmount)
    function setMaxMintAmount(uint256 newAmount)
        external
        onlyRole(OPERATIONS_ROLE)
    {
        if (newAmount < minMintAmount)
            revert MaxAmountBelowMin(newAmount, minMintAmount);

        uint256 oldAmount = maxMintAmount;
        maxMintAmount = newAmount;

        emit MaxMintAmountUpdated(oldAmount, newAmount, msg.sender, block.timestamp);
    }

    /// @notice Update redemption timeout
    /// @param newTimeout The new timeout in seconds
    function setRedemptionTimeout(uint256 newTimeout)
        external
        onlyRole(OPERATIONS_ROLE)
    {
        if (newTimeout == 0) revert InvalidTimeout();
        if (newTimeout > 30 days) revert TimeoutTooLong(newTimeout, 30 days);

        uint256 oldTimeout = redemptionTimeout;
        redemptionTimeout = newTimeout;

        emit RedemptionTimeoutUpdated(oldTimeout, newTimeout, msg.sender, block.timestamp);
    }

    /// @notice Update stale threshold
    /// @param newThreshold The new threshold in seconds
    function setStaleThreshold(uint256 newThreshold)
        external
        onlyRole(OPERATIONS_ROLE)
    {
        if (newThreshold == 0) revert InvalidThreshold();
        if (newThreshold > 7 days)
            revert ThresholdTooLong(newThreshold, 7 days);

        uint256 oldThreshold = staleThreshold;
        staleThreshold = newThreshold;

        emit StaleThresholdUpdated(oldThreshold, newThreshold, msg.sender, block.timestamp);
    }


    /// @notice Update emergency pause duration
    /// @param newDuration The new duration in seconds
    function setEmergencyPauseDuration(uint256 newDuration)
        external
        onlyRole(OPERATIONS_ROLE)
    {
        if (newDuration == 0) revert InvalidDuration();
        if (newDuration > 30 days) revert DurationTooLong(newDuration, 30 days);

        uint256 oldDuration = emergencyPauseDuration;
        emergencyPauseDuration = newDuration;

        emit EmergencyPauseDurationUpdated(
            oldDuration,
            newDuration,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Update emergency council
    /// @param newCouncil The new emergency council address
    function setEmergencyCouncil(address newCouncil)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (newCouncil == address(0)) revert InvalidCouncilAddress();

        address oldCouncil = emergencyCouncil;
        emergencyCouncil = newCouncil;

        // Grant and revoke EMERGENCY_ROLE
        if (oldCouncil != address(0)) {
            _revokeRole(EMERGENCY_ROLE, oldCouncil);
        }
        _grantRole(EMERGENCY_ROLE, newCouncil);

        emit EmergencyCouncilUpdated(oldCouncil, newCouncil, msg.sender);
    }

    // =================== AUTOMATED ENFORCEMENT PARAMETERS ===================

    /// @notice Update minimum collateral ratio
    /// @dev Sets the minimum collateral ratio threshold for automated enforcement.
    ///      Ratios below 100% indicate undercollateralization. Used by watchdog systems
    ///      to trigger emergency actions when QC reserves fall below this threshold.
    ///      Range: 100-200% (100% = fully backed, 200% = 2x overcollateralized).
    /// @param newRatio The new minimum collateral ratio percentage (100-200, e.g., 150 for 150%)
    function setMinCollateralRatio(uint256 newRatio)
        external
        onlyRole(OPERATIONS_ROLE)
    {
        if (newRatio < 100 || newRatio > 200) revert InvalidAmount(); // Min 100%, Max 200%

        uint256 oldRatio = minCollateralRatio;
        minCollateralRatio = newRatio;

        emit MinCollateralRatioUpdated(oldRatio, newRatio, msg.sender);
    }

    /// @notice Update failure threshold
    /// @param newThreshold The new failure threshold count
    function setFailureThreshold(uint256 newThreshold)
        external
        onlyRole(OPERATIONS_ROLE)
    {
        if (newThreshold == 0 || newThreshold > 10) revert InvalidThreshold();

        uint256 oldThreshold = failureThreshold;
        failureThreshold = newThreshold;

        emit FailureThresholdUpdated(oldThreshold, newThreshold, msg.sender);
    }

    /// @notice Update failure counting window
    /// @param newWindow The new failure counting window in seconds
    function setFailureWindow(uint256 newWindow)
        external
        onlyRole(OPERATIONS_ROLE)
    {
        if (newWindow == 0) revert InvalidDuration();
        if (newWindow > 30 days) revert DurationTooLong(newWindow, 30 days);

        uint256 oldWindow = failureWindow;
        failureWindow = newWindow;

        emit FailureWindowUpdated(oldWindow, newWindow, msg.sender);
    }

    // =================== QC PARAMETER UPDATES ===================


    /// @notice Update minimum sync interval
    /// @param newInterval New interval in seconds
    function setMinSyncInterval(uint256 newInterval) 
        external 
        onlyRole(OPERATIONS_ROLE) 
    {
        if (newInterval < MIN_SYNC_INTERVAL_BOUND || newInterval > MAX_SYNC_INTERVAL) {
            revert DurationOutOfBounds(newInterval, MIN_SYNC_INTERVAL_BOUND, MAX_SYNC_INTERVAL);
        }
        
        uint256 oldInterval = minSyncInterval;
        minSyncInterval = newInterval;
        emit MinSyncIntervalUpdated(oldInterval, newInterval);
    }

    // =================== ORACLE PARAMETER UPDATES ===================

    /// @notice Update oracle consensus threshold
    /// @dev Sets the minimum number of oracle attestations required to reach consensus
    ///      on reserve data. Higher values increase security but may reduce availability.
    ///      Must balance between decentralization (higher) and system responsiveness (lower).
    ///      Works with oracleAttestationTimeout to define consensus requirements.
    /// @param newThreshold New consensus threshold (1-10 attestations)
    function setOracleConsensusThreshold(uint256 newThreshold)
        external
        onlyRole(OPERATIONS_ROLE)
    {
        if (newThreshold < MIN_CONSENSUS_THRESHOLD || newThreshold > MAX_CONSENSUS_THRESHOLD) {
            revert DurationOutOfBounds(newThreshold, MIN_CONSENSUS_THRESHOLD, MAX_CONSENSUS_THRESHOLD);
        }
        
        uint256 oldThreshold = oracleConsensusThreshold;
        oracleConsensusThreshold = newThreshold;
        emit OracleConsensusThresholdUpdated(oldThreshold, newThreshold, msg.sender);
    }

    /// @notice Update oracle attestation timeout
    /// @dev Sets the time window during which oracle attestations are collected for consensus.
    ///      Shorter timeouts provide faster responses but may miss slow oracles.
    ///      Must coordinate with oracleConsensusThreshold to ensure enough oracles
    ///      can respond within the timeout period. Affects system responsiveness vs. reliability.
    /// @param newTimeout New attestation timeout in seconds (1-24 hours)
    function setOracleAttestationTimeout(uint256 newTimeout)
        external
        onlyRole(OPERATIONS_ROLE)
    {
        if (newTimeout < MIN_ATTESTATION_TIMEOUT || newTimeout > MAX_ATTESTATION_TIMEOUT) {
            revert DurationOutOfBounds(newTimeout, MIN_ATTESTATION_TIMEOUT, MAX_ATTESTATION_TIMEOUT);
        }
        
        uint256 oldTimeout = oracleAttestationTimeout;
        oracleAttestationTimeout = newTimeout;
        emit OracleAttestationTimeoutUpdated(oldTimeout, newTimeout, msg.sender);
    }

    /// @notice Update oracle maximum staleness
    /// @param newStaleness New maximum staleness in seconds
    function setOracleMaxStaleness(uint256 newStaleness)
        external
        onlyRole(OPERATIONS_ROLE)
    {
        if (newStaleness < MIN_ORACLE_STALENESS || newStaleness > MAX_ORACLE_STALENESS) {
            revert DurationOutOfBounds(newStaleness, MIN_ORACLE_STALENESS, MAX_ORACLE_STALENESS);
        }
        
        uint256 oldStaleness = oracleMaxStaleness;
        oracleMaxStaleness = newStaleness;
        emit OracleMaxStalenessUpdated(oldStaleness, newStaleness, msg.sender);
    }


    /// @notice Update oracle retry interval
    /// @param newInterval New oracle retry interval in seconds
    function setOracleRetryInterval(uint256 newInterval)
        external
        onlyRole(OPERATIONS_ROLE)
    {
        if (newInterval < MIN_ORACLE_RETRY_INTERVAL || newInterval > MAX_ORACLE_RETRY_INTERVAL) {
            revert DurationOutOfBounds(newInterval, MIN_ORACLE_RETRY_INTERVAL, MAX_ORACLE_RETRY_INTERVAL);
        }
        
        uint256 oldInterval = oracleRetryInterval;
        oracleRetryInterval = newInterval;
        emit OracleRetryIntervalUpdated(oldInterval, newInterval, msg.sender);
    }

    /// @notice Emergency pause for a specific QC (called by automated systems)
    /// @dev This function provides granular emergency control for individual QCs without
    ///      affecting the entire system. It's designed to be called by:
    ///      - WatchdogEnforcer contracts for automated violation detection
    ///      - Emergency council for manual incident response
    ///      - Threshold monitoring contracts for automated risk management
    ///
    /// @param qc The QC address to pause - must be a valid non-zero address
    /// @param reason Machine-readable reason code for the pause. Common codes:
    ///               - keccak256("INSUFFICIENT_COLLATERAL") - Below minimum ratio
    ///               - keccak256("STALE_ATTESTATIONS") - Reserve data too old
    ///               - keccak256("COMPLIANCE_VIOLATION") - Regulatory issue
    ///               - keccak256("SECURITY_INCIDENT") - Security breach
    ///               - keccak256("TECHNICAL_FAILURE") - System malfunction
    ///
    /// @custom:security Only callable by EMERGENCY_ROLE holders (emergency council)
    /// @custom:events Emits QCEmergencyPaused and EmergencyActionTaken events
    /// @custom:integration Other contracts should check qcNotEmergencyPaused modifier
    ///
    /// Example usage in WatchdogEnforcer:
    /// ```solidity
    /// if (reserves < minCollateral) {
    ///     systemState.emergencyPauseQC(qc, keccak256("INSUFFICIENT_COLLATERAL"));
    /// }
    /// ```
    function emergencyPauseQC(address qc, bytes32 reason)
        external
        onlyRole(EMERGENCY_ROLE)
    {
        if (qc == address(0)) revert InvalidCouncilAddress();
        if (qcEmergencyPauses[qc]) revert QCIsEmergencyPaused(qc);

        qcEmergencyPauses[qc] = true;
        qcPauseTimestamps[qc] = block.timestamp;

        emit QCEmergencyPaused(qc, msg.sender, block.timestamp, reason);
        emit EmergencyActionTaken(
            qc,
            ACTION_QC_EMERGENCY_PAUSE,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Remove emergency pause from a specific QC
    /// @dev This function allows recovery from emergency situations by unpausing a QC.
    ///      Should be called after:
    ///      - The underlying issue has been resolved
    ///      - QC has been validated as safe to resume operations
    ///      - Appropriate monitoring has been restored
    ///
    /// @param qc The QC address to unpause - must be currently paused
    ///
    /// @custom:security Only callable by EMERGENCY_ROLE holders (emergency council)
    /// @custom:validation Reverts if QC is not currently emergency paused
    /// @custom:events Emits QCEmergencyUnpaused and EmergencyActionTaken events
    /// @custom:cleanup Removes pause timestamp to prevent stale data
    ///
    /// Example recovery procedure:
    /// ```solidity
    /// // After verifying QC has fixed compliance issues
    /// systemState.emergencyUnpauseQC(problematicQC);
    /// // QC can now resume normal operations
    /// ```
    function emergencyUnpauseQC(address qc) external onlyRole(EMERGENCY_ROLE) {
        if (!qcEmergencyPauses[qc]) revert QCNotEmergencyPaused(qc);

        qcEmergencyPauses[qc] = false;
        delete qcPauseTimestamps[qc];

        emit QCEmergencyUnpaused(qc, msg.sender, block.timestamp);
        emit EmergencyActionTaken(
            qc,
            ACTION_QC_EMERGENCY_UNPAUSE,
            msg.sender,
            block.timestamp
        );
    }

    /// @dev Emergency action events
    event EmergencyActionTaken(
        address indexed target,
        bytes32 indexed action,
        address indexed actionBy,
        uint256 timestamp
    );

    event QCEmergencyPaused(
        address indexed qc,
        address indexed pausedBy,
        uint256 indexed timestamp,
        bytes32 reason
    );

    event QCEmergencyUnpaused(
        address indexed qc,
        address indexed unpausedBy,
        uint256 indexed timestamp
    );

    // =================== VIEW FUNCTIONS ===================

    /// @notice Check if function is paused
    /// @param functionName The name of the function to check
    /// @return paused True if the function is paused
    function isFunctionPaused(string calldata functionName)
        external
        view
        returns (bool paused)
    {
        bytes32 pauseKey = keccak256(abi.encodePacked(functionName));
        if (pauseKey == keccak256("minting")) {
            return isMintingPaused;
        } else if (pauseKey == keccak256("redemption")) {
            return isRedemptionPaused;
        } else if (pauseKey == keccak256("wallet_registration")) {
            return isWalletRegistrationPaused;
        }
        return false;
    }

    /// @notice Get pause timestamp for a function
    /// @param functionName The name of the function
    /// @return timestamp When the function was paused (0 if not paused)
    function getPauseTimestamp(string calldata functionName)
        external
        view
        returns (uint256 timestamp)
    {
        bytes32 pauseKey = keccak256(abi.encodePacked(functionName));
        return pauseTimestamps[pauseKey];
    }

    /// @notice Check if emergency pause has expired
    /// @param functionName The name of the function
    /// @return expired True if the emergency pause has expired
    function isEmergencyPauseExpired(string calldata functionName)
        external
        view
        returns (bool expired)
    {
        bytes32 pauseKey = keccak256(abi.encodePacked(functionName));
        uint256 pauseTime = pauseTimestamps[pauseKey];
        if (pauseTime == 0) return false;
        return block.timestamp > pauseTime + emergencyPauseDuration;
    }

    /// @notice Check if a QC is currently emergency paused
    /// @param qc The QC address to check
    /// @return paused True if the QC is emergency paused
    function isQCEmergencyPaused(address qc)
        external
        view
        returns (bool paused)
    {
        return qcEmergencyPauses[qc];
    }

    /// @notice Check if a QC's emergency pause has expired
    /// @param qc The QC address to check
    /// @return expired True if the QC's emergency pause has expired
    function isQCEmergencyPauseExpired(address qc)
        external
        view
        returns (bool expired)
    {
        uint256 pauseTime = qcPauseTimestamps[qc];
        if (pauseTime == 0) return false;
        return block.timestamp > pauseTime + emergencyPauseDuration;
    }

    /// @notice Get QC pause timestamp
    /// @param qc The QC address
    /// @return timestamp When the QC was paused (0 if not paused)
    function getQCPauseTimestamp(address qc)
        external
        view
        returns (uint256 timestamp)
    {
        return qcPauseTimestamps[qc];
    }

    /// @notice Check if minting is not paused
    /// @dev This function allows testing the minting pause modifier behavior.
    ///      Auto-clears expired pauses.
    /// @custom:error Reverts with MintingIsPaused if minting is currently paused
    function requireMintingNotPaused() external {
        _clearExpiredPause(keccak256("minting"));
        if (isMintingPaused) revert MintingIsPaused();
    }

    /// @dev Automatically clears expired emergency pauses to enable system recovery.
    ///      Checks if the pause duration has exceeded emergencyPauseDuration and
    ///      automatically resets the pause state. Called by pause modifiers and
    ///      direct pause checking functions to ensure automatic cleanup.
    ///      Prevents indefinite system lockdown from forgotten emergency pauses.
    /// @param pauseKey The keccak256 hash of the function name being checked
    function _clearExpiredPause(bytes32 pauseKey) internal {
        uint256 pausedAt = pauseTimestamps[pauseKey];
        if (pausedAt != 0 && block.timestamp > pausedAt + emergencyPauseDuration) {
            if (pauseKey == keccak256("minting")) {
                isMintingPaused = false;
            } else if (pauseKey == keccak256("redemption")) {
                isRedemptionPaused = false;
            } else if (pauseKey == keccak256("wallet_registration")) {
                isWalletRegistrationPaused = false;
            }
            delete pauseTimestamps[pauseKey];
        }
    }

    /// @notice Modifier to check if QC operations are allowed
    /// @dev This modifier should be used by all contracts that perform QC-specific operations
    ///      to ensure they respect emergency pause states. It integrates seamlessly with
    ///      existing access control patterns.
    ///
    /// @param qc The QC address to check for emergency pause status
    ///
    /// @custom:integration Add this modifier to QC-specific functions:
    /// ```solidity
    /// function mintFromQC(address qc, uint256 amount)
    ///     external
    ///     qcNotEmergencyPaused(qc)
    ///     onlyRole(MINTER_ROLE)
    /// {
    ///     // Minting logic here - will revert if QC is emergency paused
    /// }
    /// ```
    ///
    /// @custom:error Reverts with QCIsEmergencyPaused(qc) if QC is paused
    /// @custom:gas Low gas cost check - just reads from storage mapping
    modifier qcNotEmergencyPaused(address qc) {
        if (qcEmergencyPauses[qc]) {
            uint256 pauseTime = qcPauseTimestamps[qc];
            if (pauseTime != 0 && block.timestamp > pauseTime + emergencyPauseDuration) {
                qcEmergencyPauses[qc] = false;
                delete qcPauseTimestamps[qc];
            } else {
                revert QCIsEmergencyPaused(qc);
            }
        }
        _;
    }
}
