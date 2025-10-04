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
import "./QCData.sol";
import "./QCErrors.sol";
import "./SystemState.sol";
import "./interfaces/IQCManager.sol";
import "./interfaces/IQCRedeemer.sol";


/// @title QCPauseManager
/// @notice Manages pause credit system for Qualified Custodians
/// @dev Extracted from QCManagerPauseLib to improve architecture and enable direct event emission
contract QCPauseManager is AccessControl, QCErrors {
    
    // =================== CONSTANTS ===================
    
    uint256 public constant PAUSE_DURATION = 48 hours;
    uint256 public constant RENEWAL_PERIOD = 90 days;
    uint256 public constant MIN_REDEMPTION_BUFFER = 8 hours;
    
    // =================== ROLES ===================
    
    bytes32 public constant QC_MANAGER_ROLE = keccak256("QC_MANAGER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    // =================== STRUCTS ===================
    
    /// @dev Pause credit information for each QC
    /// Pause credits allow QCs to temporarily pause their operations during emergencies
    /// or maintenance. Each QC gets one credit per 90-day period to self-pause for 48 hours.
    /// This system prevents abuse while allowing legitimate operational flexibility.
    struct PauseCredit {
        bool hasCredit;              // Can QC pause themselves?
        uint256 lastUsed;            // When last used (0 = never)
        uint256 creditRenewTime;     // When credit can be renewed
        bool isPaused;               // Currently paused?
        uint256 pauseEndTime;        // When pause expires
        bytes32 pauseReason;         // Why paused
    }
    
    // =================== STATE VARIABLES ===================
    
    /// @notice QCData contract reference - manages QC registration, status, and core data
    /// This contract stores fundamental QC information including status, registration details,
    /// and pause levels. QCPauseManager queries and updates QC status through this interface.
    QCData public immutable qcData;
    
    /// @notice QCManager contract address for callback integration
    address public qcManager;
    
    /// @notice Pause credit storage for each QC
    mapping(address => PauseCredit) private pauseCredits;
    
    /// @notice QCRedeemer contract reference - handles redemption operations and validation
    /// Used to check for unfulfilled redemptions before allowing early resume from pause.
    /// QCs cannot resume early if they have pending redemption obligations.
    IQCRedeemer public qcRedeemer;
    
    /// @notice Track QC pause timestamps for timeout enforcement
    /// Records when QCs entered pause state to enforce maximum pause durations
    /// and prevent indefinite pausing that could harm system operations.
    mapping(address => uint256) public qcPauseTimestamp;
    
    /// @notice Track whether QCs can resume early from pause
    /// Controls early resume eligibility based on redemption obligations and system state.
    /// QCs can only resume early if they have no pending redemptions and meet safety criteria.
    mapping(address => bool) public qcCanEarlyResume;
    
    /// @notice Track whether escalation warnings have been emitted for QCs
    /// Prevents duplicate warning events during graduated enforcement actions.
    /// Used in the progressive discipline system (Active → UnderReview → Revoked).
    mapping(address => bool) public escalationWarningEmitted;
    
    // =================== EVENTS ===================
    
    event DefaultProcessed(
        address indexed qc,
        bytes32 redemptionId,
        QCData.QCStatus oldStatus,
        QCData.QCStatus newStatus
    );
    
    event BacklogCleared(address indexed qc, QCData.QCStatus newStatus);
    
    /// @notice Emitted when a QC uses their pause credit
    event PauseCreditUsed(
        address indexed qc,
        bytes32 indexed reason,
        uint256 duration
    );
    
    /// @notice Emitted when a QC renews their pause credit
    event PauseCreditRenewed(
        address indexed qc,
        uint256 nextRenewalTime,
        address indexed renewedBy,
        uint256 timestamp
    );
    
    /// @notice Emitted when a pause expires automatically
    event PauseCreditExpired(
        address indexed qc
    );
    
    /// @notice Emitted when emergency council clears a pause
    event EmergencyCleared(
        address indexed qc,
        address indexed clearedBy,
        bytes32 indexed reason
    );
    
    /// @notice Emitted when a QC resumes early from pause
    event EarlyResumed(
        address indexed qc,
        address indexed resumedBy
    );
    
    /// @notice Emitted when initial credit is granted to a new QC
    event InitialCreditGranted(
        address indexed qc,
        address indexed grantedBy
    );
    // =================== MODIFIERS ===================
    
    /// @dev Only QCManager can call certain functions
    modifier onlyQCManager() {
        require(hasRole(QC_MANAGER_ROLE, msg.sender), "QCPauseManager: caller is not QCManager");
        _;
    }
    
    /// @dev Only emergency role can call certain functions
    modifier onlyEmergencyRole() {
        require(hasRole(EMERGENCY_ROLE, msg.sender), "QCPauseManager: caller is not emergency role");
        _;
    }
    
    // =================== CONSTRUCTOR ===================
    
    /// @notice Initialize QCPauseManager
    /// @param _qcData QCData contract address
    /// @param _qcManager QCManager contract address
    /// @param _admin Admin address for access control
    /// @param _emergencyRole Emergency role address
    constructor(
        address _qcData,
        address _qcManager,
        address _admin,
        address _emergencyRole
    ) {
        require(_qcData != address(0), "QCPauseManager: qcData cannot be zero");
        require(_qcManager != address(0), "QCPauseManager: qcManager cannot be zero");
        require(_admin != address(0), "QCPauseManager: admin cannot be zero");
        require(_emergencyRole != address(0), "QCPauseManager: emergencyRole cannot be zero");
        
        qcData = QCData(_qcData);
        qcManager = _qcManager;
        
        // Set up access control
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(QC_MANAGER_ROLE, _qcManager);
        _grantRole(EMERGENCY_ROLE, _emergencyRole);
    }
    
    // =================== ADMIN FUNCTIONS ===================
    
    /// @notice Set QCManager address
    /// @param _qcManager New QCManager address
    function setQCManager(address _qcManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_qcManager != address(0), "QCPauseManager: qcManager cannot be zero");
        qcManager = _qcManager;
        
        // Grant QCManager role to new address
        _grantRole(QC_MANAGER_ROLE, _qcManager);
    }
    
    /// @notice Set QCRedeemer address
    /// @param _qcRedeemer New QCRedeemer address
    function setQCRedeemer(address _qcRedeemer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        qcRedeemer = IQCRedeemer(_qcRedeemer);
    }
    
    // =================== PAUSE CREDIT MANAGEMENT FUNCTIONS ===================
    
    
    /// @notice Renew pause credit after 90 days
    /// @param qc QC address
    function renewPauseCredit(address qc) external onlyQCManager {
        PauseCredit storage credit = pauseCredits[qc];
        
        // Validate conditions
        QCData.QCStatus status = qcData.getQCStatus(qc);
        if (status != QCData.QCStatus.Active) revert QCErrors.QCNotActive(qc);
        if (credit.hasCredit) revert CreditAlreadyAvailable();
        if (credit.lastUsed == 0) revert NeverUsedCredit();
        if (block.timestamp < credit.creditRenewTime) revert RenewalPeriodNotMet();
        
        // Renew credit
        credit.hasCredit = true;
        credit.creditRenewTime = 0;
        
        emit PauseCreditRenewed(qc, block.timestamp + RENEWAL_PERIOD, msg.sender, block.timestamp);
    }
    
    /// @notice Check and auto-resume if pause expired
    /// @param qc QC address
    function resumeIfExpired(address qc) external onlyQCManager {
        PauseCredit storage credit = pauseCredits[qc];
        
        if (!credit.isPaused) revert NotPaused();
        if (block.timestamp < credit.pauseEndTime) revert PauseNotExpired();
        
        // Clear pause state
        credit.isPaused = false;
        credit.pauseEndTime = 0;
        credit.pauseReason = bytes32(0);
        
        emit PauseCreditExpired(qc);
    }
    
    /// @notice Emergency council can clear pause and restore credit
    /// @param qc QC address
    /// @param reason Reason for clearing
    function emergencyClearPause(address qc, string calldata reason) external onlyEmergencyRole {
        PauseCredit storage credit = pauseCredits[qc];
        
        // Clear pause state
        credit.isPaused = false;
        credit.pauseEndTime = 0;
        credit.pauseReason = bytes32(0);
        
        // Optionally restore credit if it was consumed
        if (!credit.hasCredit && credit.lastUsed > 0) {
            credit.hasCredit = true;
            credit.creditRenewTime = 0;
        }
        
        bytes32 reasonHash = keccak256(bytes(reason));
        emit EmergencyCleared(qc, msg.sender, reasonHash);
    }
    
    /// @notice Grant initial credit to new QC
    /// @param qc QC address
    function grantInitialCredit(address qc) external onlyEmergencyRole {
        // Verify QC is registered
        if (!qcData.isQCRegistered(qc)) {
            revert QCErrors.QCNotRegistered(qc);
        }
        
        if (pauseCredits[qc].hasCredit || pauseCredits[qc].lastUsed != 0) revert QCAlreadyInitialized();
        
        pauseCredits[qc].hasCredit = true;
        
        emit InitialCreditGranted(qc, msg.sender);
    }
    
    /// @notice Use emergency pause credit
    /// @param qc QC address
    /// @param reason Reason for pause
    function useEmergencyPause(address qc, string memory reason) public onlyQCManager {
        PauseCredit storage credit = pauseCredits[qc];
        
        // Validate conditions
        if (!credit.hasCredit) revert NoPauseCredit();
        if (credit.isPaused) revert AlreadyPaused();
        if (bytes(reason).length == 0) revert ReasonRequired();
        
        // Check QC status
        QCData.QCStatus status = qcData.getQCStatus(qc);
        if (status != QCData.QCStatus.Active) revert QCErrors.QCNotActive(qc);
        
        // Deadline protection
        uint256 earliestDeadline = IQCManager(qcManager).getEarliestRedemptionDeadline(qc);
        if (earliestDeadline > 0 && 
            earliestDeadline < block.timestamp + PAUSE_DURATION + MIN_REDEMPTION_BUFFER) {
            revert WouldBreachRedemptionDeadline();
        }
        
        // Consume credit and set pause
        credit.hasCredit = false;
        credit.lastUsed = block.timestamp;
        credit.creditRenewTime = block.timestamp + RENEWAL_PERIOD;
        credit.isPaused = true;
        credit.pauseEndTime = block.timestamp + PAUSE_DURATION;
        bytes32 reasonHash = keccak256(bytes(reason));
        credit.pauseReason = reasonHash;
        
        emit PauseCreditUsed(qc, reasonHash, PAUSE_DURATION);
    }
    
    /// @notice Resume early from pause credit system (with validation)
    /// @param qc QC address
    function resumeEarly(address qc) public onlyQCManager {
        PauseCredit storage credit = pauseCredits[qc];
        
        // Validate QC can early resume and has no pending redemptions
        if (IQCManager(qcManager).hasUnfulfilledRedemptions(qc)) {
            revert HasPendingRedemptions();
        }
        
        // Clear pause state
        credit.isPaused = false;
        credit.pauseEndTime = 0;
        credit.pauseReason = bytes32(0);
        
        emit EarlyResumed(qc, msg.sender);
    }
    
    /// @notice QC can directly call to resume early (convenience function)
    /// @dev This allows QCs to directly resume without going through QCManager
    function resumeEarlyDirect() external {
        address qc = msg.sender;
        
        // Validate QC is registered
        if (!qcData.isQCRegistered(qc)) {
            revert QCErrors.QCNotRegistered(qc);
        }
        
        PauseCredit storage credit = pauseCredits[qc];
        
        // Must be currently paused
        if (!credit.isPaused) revert NotPaused();
        
        // Check for pending redemptions
        if (IQCManager(qcManager).hasUnfulfilledRedemptions(qc)) {
            revert HasPendingRedemptions();
        }
        
        // Clear pause state
        credit.isPaused = false;
        credit.pauseEndTime = 0;
        credit.pauseReason = bytes32(0);
        
        emit EarlyResumed(qc, qc);
    }
    
    // =================== SELF-PAUSE FUNCTIONS ===================
    
    /// @notice QC initiates self-pause with chosen level
    /// @param level PauseLevel.MintingOnly or PauseLevel.Complete
    function selfPause(QCData.PauseLevel level) external {
        address qc = msg.sender;
        
        // Validate QC is registered and active
        if (!qcData.isQCRegistered(qc)) {
            revert QCErrors.QCNotRegistered(qc);
        }
        
        QCData.QCStatus status = qcData.getQCStatus(qc);
        if (status != QCData.QCStatus.Active) revert QCErrors.QCNotActive(qc);
        
        // Set pause level in QCData (self-initiated)
        qcData.setQCPauseLevel(qc, level, true);
        
        // Track pause timestamp for timeout enforcement
        qcPauseTimestamp[qc] = block.timestamp;
        
        // QCs can resume early from self-pause if no pending redemptions
        qcCanEarlyResume[qc] = true;
    }
    
    /// @notice QC resumes from self-initiated pause before timeout
    function resumeSelfPause() external {
        address qc = msg.sender;
        
        // Validate QC is registered
        if (!qcData.isQCRegistered(qc)) {
            revert QCErrors.QCNotRegistered(qc);
        }
        
        // Check if QC can resume early
        if (!qcCanEarlyResume[qc]) {
            revert QCErrors.InvalidStatus();
        }
        
        // Can only resume if no pending redemptions
        if (IQCManager(qcManager).hasUnfulfilledRedemptions(qc)) {
            revert HasPendingRedemptions();
        }
        
        // Resume to MintingOnly level (allow fulfillment but not minting)
        qcData.setQCPauseLevel(qc, QCData.PauseLevel.MintingOnly, false);
        
        // Clear tracking
        delete qcPauseTimestamp[qc];
        delete qcCanEarlyResume[qc];
    }
    
    // =================== VIEW FUNCTIONS ===================
    
    /// @notice Check if QC can use pause credit
    /// @param qc QC address
    /// @return canPause Whether QC can self-pause
    function canSelfPause(address qc) external view returns (bool canPause) {
        PauseCredit memory credit = pauseCredits[qc];
        
        // Must have credit and not be paused
        if (!credit.hasCredit || credit.isPaused) {
            return false;
        }
        
        // Check QC status
        QCData.QCStatus status = qcData.getQCStatus(qc);
        if (status != QCData.QCStatus.Active) {
            return false;
        }
        
        // Check redemption deadline protection
        uint256 earliestDeadline = IQCManager(qcManager).getEarliestRedemptionDeadline(qc);
        if (earliestDeadline > 0 && 
            earliestDeadline < block.timestamp + PAUSE_DURATION + MIN_REDEMPTION_BUFFER) {
            return false;
        }
        
        return true;
    }
    
    /// @notice Get comprehensive pause credit information for a QC
    /// @param qc QC address
    /// @return isPaused Whether currently paused
    /// @return pauseEndTime When pause expires
    /// @return pauseReason Reason for pause
    /// @return hasCredit Whether credit is available
    /// @return creditRenewTime When credit can be renewed
    function getPauseInfo(address qc) external view returns (
        bool isPaused,
        uint256 pauseEndTime,
        bytes32 pauseReason,
        bool hasCredit,
        uint256 creditRenewTime
    ) {
        PauseCredit memory credit = pauseCredits[qc];
        return (
            credit.isPaused,
            credit.pauseEndTime,
            credit.pauseReason,
            credit.hasCredit,
            credit.creditRenewTime
        );
    }
    
    /// @notice Calculate time until pause credit renewal
    /// @param hasCredit Whether QC has available pause credit
    /// @param lastUsed Timestamp of last pause credit usage
    /// @param creditRenewTime When credit becomes available again
    /// @return timeUntilRenewal Time in seconds until credit renewal (0 if available)
    function calculateTimeUntilRenewal(
        bool hasCredit,
        uint256 lastUsed,
        uint256 creditRenewTime
    ) public view returns (uint256 timeUntilRenewal) {
        if (hasCredit || lastUsed == 0) {
            return 0;
        }

        if (block.timestamp >= creditRenewTime) {
            return 0;
        }

        return creditRenewTime - block.timestamp;
    }
    
    /// @notice Get time until credit renewal is available
    /// @param qc QC address
    /// @return timeUntilRenewal Seconds until renewal (0 if available now)
    function getTimeUntilRenewal(address qc) external view returns (uint256 timeUntilRenewal) {
        PauseCredit memory credit = pauseCredits[qc];
        return calculateTimeUntilRenewal(
            credit.hasCredit,
            credit.lastUsed,
            credit.creditRenewTime
        );
    }
    
    // =================== ESCALATION FUNCTIONS ===================
    
    /// @notice Watchdog checks for QCs requiring auto-escalation
    /// @param qcAddresses Array of QC addresses to check
    function checkQCEscalations(address[] calldata qcAddresses) external onlyQCManager {
        for (uint256 i = 0; i < qcAddresses.length; i++) {
            address qc = qcAddresses[i];
            
            (bool eligible, ) = _isEligibleForEscalationInternal(qc);
            if (eligible) {
                _escalateQC(qc);
            }
        }
    }
    
    /// @notice Check if QC is eligible for escalation
    /// @param qc QC address
    /// @return eligible Whether QC is eligible for escalation
    /// @return timeUntilEscalation Time until escalation in seconds
    function isEligibleForEscalation(address qc) external view returns (bool eligible, uint256 timeUntilEscalation) {
        return _isEligibleForEscalationInternal(qc);
    }
    
    /// @notice Internal function to check if QC is eligible for escalation
    /// @param qc QC address
    /// @return eligible Whether QC is eligible for escalation
    /// @return timeUntilEscalation Time until escalation in seconds
    function _isEligibleForEscalationInternal(address qc) internal view returns (bool eligible, uint256 timeUntilEscalation) {
        QCData.QCStatus status = qcData.getQCStatus(qc);
        
        // Only paused QCs can be escalated
        if (status != QCData.QCStatus.Paused) {
            return (false, 0);
        }
        
        uint256 pauseTime = qcPauseTimestamp[qc];
        if (pauseTime == 0) {
            return (false, 0);
        }
        
        // Escalation after 72 hours of pause
        uint256 escalationThreshold = 72 hours;
        uint256 timeInPause = block.timestamp - pauseTime;
        
        if (timeInPause >= escalationThreshold) {
            return (true, 0);
        } else {
            return (false, escalationThreshold - timeInPause);
        }
    }
    
    /// @notice Internal function to escalate a QC's status
    /// @param qc QC address to escalate
    function _escalateQC(address qc) internal {
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        QCData.QCStatus newStatus;
        
        if (currentStatus == QCData.QCStatus.Paused) {
            newStatus = QCData.QCStatus.UnderReview;
        } else if (currentStatus == QCData.QCStatus.UnderReview) {
            newStatus = QCData.QCStatus.Revoked;
        } else {
            return; // No escalation needed
        }
        
        bytes32 escalationReason = keccak256("AUTO_ESCALATION_TIMEOUT");
        qcData.setQCStatus(qc, newStatus, escalationReason);
        
        // Sync with QCManager
        IQCManager(qcManager).syncAccountControlWithStatus(qc, currentStatus, newStatus);
        
        // Clear pause tracking since QC is now under review/revoked
        delete qcPauseTimestamp[qc];
        delete qcCanEarlyResume[qc];
        delete escalationWarningEmitted[qc];
    }
    
    /// @notice Handle redemption default with graduated consequences
    /// @param qc QC that defaulted
    /// @param redemptionId ID of the defaulted redemption
    function handleRedemptionDefault(address qc, bytes32 redemptionId) external onlyQCManager {
        QCData.QCStatus oldStatus = qcData.getQCStatus(qc);
        QCData.QCStatus newStatus = oldStatus;
        
        // Progressive escalation logic
        if (
            oldStatus == QCData.QCStatus.Active ||
            oldStatus == QCData.QCStatus.MintingPaused
        ) {
            // First default → UnderReview
            newStatus = QCData.QCStatus.UnderReview;
        } else if (
            oldStatus == QCData.QCStatus.UnderReview ||
            oldStatus == QCData.QCStatus.Paused
        ) {
            // Second default → Revoked
            newStatus = QCData.QCStatus.Revoked;
        }
        // Revoked QCs remain revoked
        
        if (newStatus != oldStatus) {
            bytes32 defaultEscalationReason = keccak256("DEFAULT_ESCALATION");
            qcData.setQCStatus(qc, newStatus, defaultEscalationReason);
            IQCManager(qcManager).syncAccountControlWithStatus(qc, oldStatus, newStatus);
            
        }
        
        emit DefaultProcessed(qc, redemptionId, oldStatus, newStatus);
    }
    
    /// @notice Clear QC backlog and potentially restore to Active
    /// @param qc QC address to clear
    function clearQCBacklog(address qc) external onlyQCManager {
        if (address(qcRedeemer) != address(0) && qcRedeemer.hasUnfulfilledRedemptions(qc)) {
            revert HasPendingRedemptions();
        }
        
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        
        if (currentStatus == QCData.QCStatus.UnderReview) {
            QCData.QCStatus oldStatus = currentStatus;
            bytes32 backlogClearedReason = keccak256("BACKLOG_CLEARED");
            qcData.setQCStatus(qc, QCData.QCStatus.Active, backlogClearedReason);
            IQCManager(qcManager).syncAccountControlWithStatus(
                qc,
                oldStatus,
                QCData.QCStatus.Active
            );
            
            // Clear any remaining timeout tracking
            delete qcPauseTimestamp[qc];
            delete qcCanEarlyResume[qc];
            delete escalationWarningEmitted[qc];
            qcData.setQCPauseLevel(qc, QCData.PauseLevel.MintingOnly, false);
            
            emit BacklogCleared(qc, QCData.QCStatus.Active);
        } else {
            revert QCErrors.InvalidStatus();
        }
    }
    
    
    
    
    // =================== INTERNAL HELPER FUNCTIONS ===================
    
    /// @notice Internal helper to validate QC status for operations
    /// @param qc QC address
    /// @return isValid Whether QC is in valid state for operations
    function _isValidQCForOperation(address qc) internal view returns (bool isValid) {
        if (!qcData.isQCRegistered(qc)) {
            return false;
        }
        
        QCData.QCStatus status = qcData.getQCStatus(qc);
        return status == QCData.QCStatus.Active || status == QCData.QCStatus.MintingPaused;
    }
}