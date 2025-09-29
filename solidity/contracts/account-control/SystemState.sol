// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";



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
contract SystemState is AccessControl {
    bytes32 public constant OPERATIONS_ROLE =
        keccak256("OPERATIONS_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    // Action constants for emergency events
    bytes32 public constant ACTION_QC_EMERGENCY_PAUSE = keccak256("QC_EMERGENCY_PAUSE");
    bytes32 public constant ACTION_QC_EMERGENCY_UNPAUSE = keccak256("QC_EMERGENCY_UNPAUSE");

    // Custom errors for gas-efficient reverts
    error MintingAlreadyPaused();
    error MintingNotPaused();
    error RedemptionAlreadyPaused();
    error RedemptionNotPaused();
    error WalletRegistrationAlreadyPaused();
    error WalletRegistrationNotPaused();
    error InvalidAmount();
    error MinAmountExceedsMax(uint256 minAmount, uint256 maxAmount);
    error MaxAmountBelowMin(uint256 maxAmount, uint256 minAmount);
    error InvalidTimeout();
    error TimeoutTooLong(uint256 timeout, uint256 maxTimeout);
    error DelayTooLong(uint256 delay, uint256 maxDelay);
    error InvalidThreshold();
    error ThresholdTooLong(uint256 threshold, uint256 maxThreshold);
    error InvalidDuration();
    error DurationTooLong(uint256 duration, uint256 maxDuration);
    error InvalidCouncilAddress();
    error MintingIsPaused();
    error RedemptionIsPaused();
    error WalletRegistrationIsPaused();
    error QCIsEmergencyPaused(address qc);
    error QCNotEmergencyPaused(address qc);
    error QCEmergencyPauseExpired(address qc);



    /// @dev Global pause flags for granular emergency controls
    bool public isMintingPaused;
    bool public isRedemptionPaused;
    bool public isWalletRegistrationPaused;

    /// @dev Global system parameters
    uint256 public staleThreshold; // Time after which reserve attestations are stale
    uint256 public redemptionTimeout; // Maximum time for redemption fulfillment
    uint256 public minMintAmount; // Minimum amount for minting operations
    uint256 public maxMintAmount; // Maximum amount for single minting operation
    uint256 public walletRegistrationDelay; // Delay between wallet registration and activation

    /// @dev Automated enforcement parameters
    uint256 public minCollateralRatio; // Minimum collateral ratio percentage (e.g., 90 for 90%)
    uint256 public failureThreshold; // Number of failures before enforcement action
    uint256 public failureWindow; // Time window for counting failures

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
        address indexed updatedBy
    );

    event MaxMintAmountUpdated(
        uint256 indexed oldAmount,
        uint256 indexed newAmount,
        address indexed updatedBy
    );

    event RedemptionTimeoutUpdated(
        uint256 indexed oldTimeout,
        uint256 indexed newTimeout,
        address indexed updatedBy
    );
    event WalletRegistrationDelayUpdated(
        uint256 indexed oldDelay,
        uint256 indexed newDelay,
        address indexed updatedBy
    );

    event StaleThresholdUpdated(
        uint256 indexed oldThreshold,
        uint256 indexed newThreshold,
        address indexed updatedBy
    );


    event EmergencyPauseDurationUpdated(
        uint256 indexed oldDuration,
        uint256 indexed newDuration,
        address indexed updatedBy
    );

    /// @dev Emitted when specific function types are paused/unpaused
    event MintingPaused(address indexed triggeredBy, uint256 indexed timestamp);

    event MintingUnpaused(
        address indexed triggeredBy,
        uint256 indexed timestamp
    );

    event RedemptionPaused(
        address indexed triggeredBy,
        uint256 indexed timestamp
    );

    event RedemptionUnpaused(
        address indexed triggeredBy,
        uint256 indexed timestamp
    );


    event WalletRegistrationPaused(
        address indexed triggeredBy,
        uint256 indexed timestamp
    );

    event WalletRegistrationUnpaused(
        address indexed triggeredBy,
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
    


    /// @dev Events for role management are inherited from AccessControl

    // =================== MODIFIERS ===================

    modifier notPaused(string memory functionName) {
        bytes32 pauseKey = keccak256(abi.encodePacked(functionName));
        _clearExpiredPause(pauseKey);
        if (pauseKey == keccak256("minting")) {
            if (isMintingPaused) revert MintingIsPaused();
        } else if (pauseKey == keccak256("redemption")) {
            if (isRedemptionPaused) revert RedemptionIsPaused();
        } else if (pauseKey == keccak256("wallet_registration")) {
            if (isWalletRegistrationPaused) revert WalletRegistrationIsPaused();
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
        minMintAmount = 0.01 ether; // Minimum 0.01 tBTC
        maxMintAmount = 1000 ether; // Maximum 1000 tBTC per transaction
        emergencyPauseDuration = 7 days; // Emergency pauses last max 7 days

        // Set automated enforcement defaults
        minCollateralRatio = 100; // 100% minimum collateral ratio
        failureThreshold = 3; // 3 failures trigger enforcement
        failureWindow = 7 days; // Count failures over 7 days
        

    }

    // =================== PAUSE FUNCTIONS ===================

    /// @notice Pause minting operations
    function pauseMinting() external onlyRole(EMERGENCY_ROLE) {
        bytes32 pauseKey = keccak256("minting");
        _clearExpiredPause(pauseKey);
        if (isMintingPaused) revert MintingAlreadyPaused();
        isMintingPaused = true;
        pauseTimestamps[pauseKey] = block.timestamp;
        emit MintingPaused(msg.sender, block.timestamp);
    }

    /// @notice Unpause minting operations
    function unpauseMinting() external onlyRole(EMERGENCY_ROLE) {
        if (!isMintingPaused) revert MintingNotPaused();
        isMintingPaused = false;
        delete pauseTimestamps[keccak256("minting")];
        emit MintingUnpaused(msg.sender, block.timestamp);
    }

    /// @notice Pause redemption operations
    function pauseRedemption() external onlyRole(EMERGENCY_ROLE) {
        bytes32 pauseKey = keccak256("redemption");
        _clearExpiredPause(pauseKey);
        if (isRedemptionPaused) revert RedemptionAlreadyPaused();
        isRedemptionPaused = true;
        pauseTimestamps[pauseKey] = block.timestamp;
        emit RedemptionPaused(msg.sender, block.timestamp);
    }

    /// @notice Unpause redemption operations
    function unpauseRedemption() external onlyRole(EMERGENCY_ROLE) {
        if (!isRedemptionPaused) revert RedemptionNotPaused();
        isRedemptionPaused = false;
        delete pauseTimestamps[keccak256("redemption")];
        emit RedemptionUnpaused(msg.sender, block.timestamp);
    }


    /// @notice Pause wallet registration operations
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
    function unpauseWalletRegistration() external onlyRole(EMERGENCY_ROLE) {
        if (!isWalletRegistrationPaused) revert WalletRegistrationNotPaused();
        isWalletRegistrationPaused = false;
        delete pauseTimestamps[keccak256("wallet_registration")];
        emit WalletRegistrationUnpaused(msg.sender, block.timestamp);
    }

    // =================== PARAMETER FUNCTIONS ===================

    /// @notice Update minimum mint amount
    /// @param newAmount The new minimum amount
    function setMinMintAmount(uint256 newAmount)
        external
        onlyRole(OPERATIONS_ROLE)
    {
        if (newAmount == 0) revert InvalidAmount();
        if (newAmount > maxMintAmount)
            revert MinAmountExceedsMax(newAmount, maxMintAmount);

        uint256 oldAmount = minMintAmount;
        minMintAmount = newAmount;

        emit MinMintAmountUpdated(oldAmount, newAmount, msg.sender);
    }

    /// @notice Update maximum mint amount
    /// @param newAmount The new maximum amount
    function setMaxMintAmount(uint256 newAmount)
        external
        onlyRole(OPERATIONS_ROLE)
    {
        if (newAmount < minMintAmount)
            revert MaxAmountBelowMin(newAmount, minMintAmount);

        uint256 oldAmount = maxMintAmount;
        maxMintAmount = newAmount;

        emit MaxMintAmountUpdated(oldAmount, newAmount, msg.sender);
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

        emit RedemptionTimeoutUpdated(oldTimeout, newTimeout, msg.sender);
    }

    /// @notice Update wallet registration delay
    /// @param newDelay The new delay in seconds
    function setWalletRegistrationDelay(uint256 newDelay)
        external
        onlyRole(OPERATIONS_ROLE)
    {
        if (newDelay > 30 days) revert DelayTooLong(newDelay, 30 days);

        uint256 oldDelay = walletRegistrationDelay;
        walletRegistrationDelay = newDelay;

        emit WalletRegistrationDelayUpdated(oldDelay, newDelay, msg.sender);
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

        emit StaleThresholdUpdated(oldThreshold, newThreshold, msg.sender);
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
            msg.sender
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
    /// @param newRatio The new minimum collateral ratio percentage (e.g., 90 for 90%)
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
        address indexed triggeredBy,
        uint256 timestamp
    );

    event QCEmergencyPaused(
        address indexed qc,
        address indexed triggeredBy,
        uint256 indexed timestamp,
        bytes32 reason
    );

    event QCEmergencyUnpaused(
        address indexed qc,
        address indexed triggeredBy,
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
