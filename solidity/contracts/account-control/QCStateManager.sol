// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./QCData.sol";
import "./QCRenewablePause.sol";
import "./QCRedeemer.sol";

/// @title QCStateManager
/// @notice Manages the 5-state QC operational model with self-pause capability and auto-escalation
/// @dev Implements graduated consequences, watchdog integration, and renewable pause credits
contract QCStateManager is 
    Initializable, 
    AccessControlUpgradeable, 
    ReentrancyGuardUpgradeable 
{
    // =================== CONSTANTS ===================
    
    uint256 public constant SELF_PAUSE_TIMEOUT = 48 hours;
    uint256 public constant ESCALATION_WARNING_PERIOD = 1 hours;
    
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    bytes32 public constant WATCHDOG_ROLE = keccak256("WATCHDOG_ROLE");
    
    // Reason codes for state changes
    bytes32 public constant SELF_PAUSE = keccak256("SELF_PAUSE");
    bytes32 public constant EARLY_RESUME = keccak256("EARLY_RESUME");
    bytes32 public constant AUTO_ESCALATION = keccak256("AUTO_ESCALATION");
    bytes32 public constant DEFAULT_ESCALATION = keccak256("DEFAULT_ESCALATION");
    bytes32 public constant BACKLOG_CLEARED = keccak256("BACKLOG_CLEARED");
    
    // =================== CUSTOM ERRORS ===================
    
    error QCNotActive();
    error NoPauseCredit();
    error AlreadyPaused();
    error NotSelfPaused();
    error CannotEarlyResume();
    error InvalidPauseLevel();
    error HasPendingRedemptions();
    error InvalidStatus();
    error NotEligibleForEscalation();
    
    // =================== ENUMS ===================
    
    /// @dev Pause level selection for QC self-pause
    enum PauseLevel {
        MintingOnly,    // Pause minting but allow fulfillment
        Complete        // Pause all operations
    }
    
    // QCStatus enum is defined in QCData contract
    // enum QCStatus { Active, MintingPaused, Paused, UnderReview, Revoked }
    
    // =================== STATE VARIABLES ===================
    
    QCData public qcData;
    QCRenewablePause public renewablePause;
    QCRedeemer public qcRedeemer;
    
    /// @dev Track QC self-pause timeouts for auto-escalation
    mapping(address => uint256) public qcPauseTimestamp;
    
    /// @dev Track if QC can early resume (only for self-initiated pauses)
    mapping(address => bool) public qcCanEarlyResume;
    
    /// @dev Track if escalation warning has been emitted
    mapping(address => bool) public escalationWarningEmitted;
    
    // =================== EVENTS ===================
    
    event QCSelfPaused(
        address indexed qc,
        PauseLevel level,
        QCData.QCStatus newStatus,
        uint256 timeout
    );
    
    event QCEarlyResumed(
        address indexed qc,
        address indexed resumedBy
    );
    
    event ApproachingEscalation(
        address indexed qc,
        uint256 timeRemaining
    );
    
    event AutoEscalated(
        address indexed qc,
        QCData.QCStatus fromStatus,
        QCData.QCStatus toStatus
    );
    
    event DefaultProcessed(
        address indexed qc,
        bytes32 redemptionId,
        QCData.QCStatus oldStatus,
        QCData.QCStatus newStatus
    );
    
    event BacklogCleared(
        address indexed qc,
        QCData.QCStatus newStatus
    );
    
    // =================== INITIALIZATION ===================
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }
    
    function initialize(
        address _qcData,
        address _renewablePause,
        address _qcRedeemer
    ) external initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        
        qcData = QCData(_qcData);
        renewablePause = QCRenewablePause(_renewablePause);
        qcRedeemer = QCRedeemer(_qcRedeemer);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }
    
    // =================== QC SELF-PAUSE FUNCTIONS ===================
    
    /// @notice QC initiates self-pause with chosen level
    /// @param level PauseLevel.MintingOnly or PauseLevel.Complete
    function selfPause(PauseLevel level) external nonReentrant {
        address qc = msg.sender;
        
        // Validate QC status
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        if (currentStatus != QCData.QCStatus.Active) {
            revert QCNotActive();
        }
        
        // Check pause credit availability
        if (!renewablePause.canSelfPause(qc)) {
            revert NoPauseCredit();
        }
        
        // Use renewable pause credit
        renewablePause.useEmergencyPause(qc, "SELF_MAINTENANCE");
        
        // Set appropriate state based on pause level
        QCData.QCStatus newStatus = (level == PauseLevel.MintingOnly) ? 
            QCData.QCStatus.MintingPaused : 
            QCData.QCStatus.Paused;
        
        // Update QC status
        qcData.setQCStatus(qc, newStatus, SELF_PAUSE);
        qcData.setQCSelfPaused(qc, true);
        
        // Track timeout for auto-escalation
        qcPauseTimestamp[qc] = block.timestamp;
        qcCanEarlyResume[qc] = true;
        escalationWarningEmitted[qc] = false;
        
        emit QCSelfPaused(qc, level, newStatus, block.timestamp + SELF_PAUSE_TIMEOUT);
    }
    
    /// @notice QC resumes from self-initiated pause before timeout
    function resumeSelfPause() external nonReentrant {
        address qc = msg.sender;
        
        if (!qcCanEarlyResume[qc]) {
            revert CannotEarlyResume();
        }
        
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        if (currentStatus != QCData.QCStatus.MintingPaused && 
            currentStatus != QCData.QCStatus.Paused) {
            revert NotSelfPaused();
        }
        
        // Clear pause tracking
        delete qcPauseTimestamp[qc];
        delete qcCanEarlyResume[qc];
        delete escalationWarningEmitted[qc];
        
        // Return to Active status
        qcData.setQCStatus(qc, QCData.QCStatus.Active, EARLY_RESUME);
        qcData.setQCSelfPaused(qc, false);
        
        // Notify renewable pause system
        renewablePause.resumeEarly(qc);
        
        emit QCEarlyResumed(qc, qc);
    }
    
    // =================== WATCHDOG INTEGRATION ===================
    
    /// @notice Watchdog checks for QCs requiring auto-escalation
    /// @param qcAddresses Array of QC addresses to check
    function checkQCEscalations(address[] calldata qcAddresses) 
        external 
        onlyRole(WATCHDOG_ROLE) 
        nonReentrant 
    {
        for (uint256 i = 0; i < qcAddresses.length; i++) {
            address qc = qcAddresses[i];
            
            // Skip if no pause timestamp
            if (qcPauseTimestamp[qc] == 0) continue;
            
            uint256 timeElapsed = block.timestamp - qcPauseTimestamp[qc];
            
            // Check for warning period (1 hour before escalation)
            if (timeElapsed >= SELF_PAUSE_TIMEOUT - ESCALATION_WARNING_PERIOD && 
                !escalationWarningEmitted[qc]) {
                uint256 timeRemaining = SELF_PAUSE_TIMEOUT - timeElapsed;
                emit ApproachingEscalation(qc, timeRemaining);
                escalationWarningEmitted[qc] = true;
            }
            
            // Check for auto-escalation after 48h
            if (timeElapsed >= SELF_PAUSE_TIMEOUT) {
                _performAutoEscalation(qc);
            }
        }
    }
    
    /// @dev Internal function to perform auto-escalation
    function _performAutoEscalation(address qc) private {
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        
        // Auto-escalate based on current state
        if (currentStatus == QCData.QCStatus.MintingPaused || 
            currentStatus == QCData.QCStatus.Paused) {
            
            // Escalate to UnderReview
            qcData.setQCStatus(qc, QCData.QCStatus.UnderReview, AUTO_ESCALATION);
            
            // Clear early resume capability
            delete qcCanEarlyResume[qc];
            delete qcPauseTimestamp[qc];
            qcData.setQCSelfPaused(qc, false);
            
            emit AutoEscalated(qc, currentStatus, QCData.QCStatus.UnderReview);
        }
    }
    
    // =================== REDEMPTION DEFAULT HANDLING ===================
    
    /// @notice Handle redemption default with graduated consequences
    /// @param qc QC that defaulted
    /// @param redemptionId ID of the defaulted redemption
    function handleRedemptionDefault(address qc, bytes32 redemptionId)
        external
        onlyRole(ARBITER_ROLE)
        nonReentrant
    {
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        QCData.QCStatus newStatus = currentStatus;
        
        // Progressive escalation logic
        if (currentStatus == QCData.QCStatus.Active || 
            currentStatus == QCData.QCStatus.MintingPaused) {
            // First default → UnderReview
            newStatus = QCData.QCStatus.UnderReview;
        } else if (currentStatus == QCData.QCStatus.UnderReview || 
                   currentStatus == QCData.QCStatus.Paused) {
            // Second default → Revoked
            newStatus = QCData.QCStatus.Revoked;
        }
        // Revoked QCs remain revoked
        
        if (newStatus != currentStatus) {
            qcData.setQCStatus(qc, newStatus, DEFAULT_ESCALATION);
            
            // Clear any self-pause tracking if escalating
            if (qcCanEarlyResume[qc]) {
                delete qcCanEarlyResume[qc];
                delete qcPauseTimestamp[qc];
                qcData.setQCSelfPaused(qc, false);
            }
        }
        
        emit DefaultProcessed(qc, redemptionId, currentStatus, newStatus);
    }
    
    // =================== RECOVERY FUNCTIONS ===================
    
    /// @notice Clear QC backlog and potentially restore to Active
    /// @param qc QC address to clear
    function clearQCBacklog(address qc) 
        external 
        onlyRole(ARBITER_ROLE) 
        nonReentrant 
    {
        // Check for pending redemptions
        if (hasUnfulfilledRedemptions(qc)) {
            revert HasPendingRedemptions();
        }
        
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        
        // Only UnderReview QCs can be cleared back to Active
        if (currentStatus == QCData.QCStatus.UnderReview) {
            qcData.setQCStatus(qc, QCData.QCStatus.Active, BACKLOG_CLEARED);
            
            // Clear any remaining timeout tracking
            delete qcPauseTimestamp[qc];
            delete qcCanEarlyResume[qc];
            delete escalationWarningEmitted[qc];
            qcData.setQCSelfPaused(qc, false);
            
            emit BacklogCleared(qc, QCData.QCStatus.Active);
        } else {
            revert InvalidStatus();
        }
    }
    
    // =================== VIEW FUNCTIONS ===================
    
    /// @notice Get QC pause information
    /// @param qc QC address
    /// @return pauseTimestamp When the pause started (0 if not paused)
    /// @return canEarlyResume Whether QC can resume early
    /// @return escalationDeadline When auto-escalation will occur
    function getQCPauseInfo(address qc) external view returns (
        uint256 pauseTimestamp,
        bool canEarlyResume,
        uint256 escalationDeadline
    ) {
        pauseTimestamp = qcPauseTimestamp[qc];
        canEarlyResume = qcCanEarlyResume[qc];
        escalationDeadline = pauseTimestamp > 0 ? 
            pauseTimestamp + SELF_PAUSE_TIMEOUT : 0;
    }
    
    /// @notice Check if QC has unfulfilled redemptions
    /// @param qc QC address
    /// @return hasUnfulfilled Whether QC has pending redemptions
    function hasUnfulfilledRedemptions(address qc) public view returns (bool) {
        return qcRedeemer.hasUnfulfilledRedemptions(qc);
    }
    
    /// @notice Check if QC is eligible for escalation
    /// @param qc QC address
    /// @return eligible Whether QC can be escalated
    /// @return timeUntilEscalation Seconds until escalation (0 if ready)
    function isEligibleForEscalation(address qc) external view returns (
        bool eligible,
        uint256 timeUntilEscalation
    ) {
        if (qcPauseTimestamp[qc] == 0) {
            return (false, 0);
        }
        
        uint256 timeElapsed = block.timestamp - qcPauseTimestamp[qc];
        
        if (timeElapsed >= SELF_PAUSE_TIMEOUT) {
            return (true, 0);
        } else {
            return (false, SELF_PAUSE_TIMEOUT - timeElapsed);
        }
    }
}