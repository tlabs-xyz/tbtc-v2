// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./QCData.sol";
import "./QCManagerErrors.sol";
import "./libraries/QCManagerPauseLib.sol";

/// @notice Interface for QCManager callbacks
interface IQCManager {
    function getEarliestRedemptionDeadline(address qc) external view returns (uint256);
    function hasUnfulfilledRedemptions(address qc) external view returns (bool);
}

/// @title QCPauseManager
/// @notice Manages pause credit system for Qualified Custodians
/// @dev Extracted from QCManagerPauseLib to improve architecture and enable direct event emission
contract QCPauseManager is AccessControl {
    
    // =================== CONSTANTS ===================
    
    uint256 public constant PAUSE_DURATION = 48 hours;
    uint256 public constant RENEWAL_PERIOD = 90 days;
    uint256 public constant MIN_REDEMPTION_BUFFER = 8 hours;
    
    // =================== ROLES ===================
    
    bytes32 public constant QC_MANAGER_ROLE = keccak256("QC_MANAGER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    // =================== STRUCTS ===================
    
    /// @dev Pause credit information for each QC
    struct PauseCredit {
        bool hasCredit;              // Can QC pause themselves?
        uint256 lastUsed;            // When last used (0 = never)
        uint256 creditRenewTime;     // When credit can be renewed
        bool isPaused;               // Currently paused?
        uint256 pauseEndTime;        // When pause expires
        bytes32 pauseReason;         // Why paused
    }
    
    // =================== STATE VARIABLES ===================
    
    /// @notice QCData contract reference
    QCData public immutable qcData;
    
    /// @notice QCManager contract address for callback integration
    address public immutable qcManager;
    
    /// @notice Pause credit storage for each QC
    mapping(address => PauseCredit) private pauseCredits;
    
    // =================== EVENTS ===================
    
    /// @notice Emitted when a QC uses their pause credit
    event PauseCreditUsed(
        address indexed qc,
        bytes32 reason,
        uint256 duration
    );
    
    /// @notice Emitted when a QC renews their pause credit
    event PauseCreditRenewed(
        address indexed qc,
        uint256 nextRenewalTime
    );
    
    /// @notice Emitted when a pause expires automatically
    event PauseCreditExpired(
        address indexed qc
    );
    
    /// @notice Emitted when emergency council clears a pause
    event EmergencyCleared(
        address indexed qc,
        address indexed clearedBy,
        bytes32 reason
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
    
    // =================== ERRORS ===================
    
    /// @notice Thrown when no pause credit is available
    error NoPauseCredit();
    
    /// @notice Thrown when already paused
    error AlreadyPaused();
    
    /// @notice Thrown when not currently paused
    error NotPaused();
    
    /// @notice Thrown when pause not expired
    error PauseNotExpired();
    
    /// @notice Thrown when credit already available
    error CreditAlreadyAvailable();
    
    /// @notice Thrown when never used credit
    error NeverUsedCredit();
    
    /// @notice Thrown when renewal period not met
    error RenewalPeriodNotMet();
    
    /// @notice Thrown when QC already initialized
    error QCAlreadyInitialized();
    
    /// @notice Thrown when reason is required but not provided
    error ReasonRequired();
    
    /// @notice Thrown when pause would breach redemption deadline
    error WouldBreachRedemptionDeadline();
    
    /// @notice Thrown when not self-paused
    error NotSelfPaused();
    
    /// @notice Thrown when cannot early resume
    error CannotEarlyResume();
    
    /// @notice Thrown when has pending redemptions
    error HasPendingRedemptions();
    
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
    
    // =================== PAUSE CREDIT MANAGEMENT FUNCTIONS ===================
    
    /// @notice Check if QC can use pause credit
    /// @param qc QC address
    /// @return canPause Whether QC can self-pause
    function canSelfPause(address qc) external view returns (bool canPause) {
        PauseCredit memory credit = pauseCredits[qc];
        
        // Must have credit and not be currently paused
        if (!credit.hasCredit || credit.isPaused) {
            return false;
        }
        
        // Check QC is active
        try qcData.getQCStatus(qc) returns (QCData.QCStatus status) {
            if (status != QCData.QCStatus.Active) {
                return false;
            }
        } catch {
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
    
    /// @notice Renew pause credit after 90 days
    /// @param qc QC address
    function renewPauseCredit(address qc) external onlyQCManager {
        PauseCredit storage credit = pauseCredits[qc];
        
        // Validate conditions
        QCData.QCStatus status = qcData.getQCStatus(qc);
        if (status != QCData.QCStatus.Active) revert QCManagerErrors.QCNotActive(qc);
        if (credit.hasCredit) revert CreditAlreadyAvailable();
        if (credit.lastUsed == 0) revert NeverUsedCredit();
        if (block.timestamp < credit.creditRenewTime) revert RenewalPeriodNotMet();
        
        // Renew credit
        credit.hasCredit = true;
        credit.creditRenewTime = 0;
        
        emit PauseCreditRenewed(qc, block.timestamp + RENEWAL_PERIOD);
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
            revert QCManagerErrors.QCNotRegistered(qc);
        }
        
        if (pauseCredits[qc].lastUsed != 0) revert QCAlreadyInitialized();
        
        pauseCredits[qc].hasCredit = true;
        
        emit InitialCreditGranted(qc, msg.sender);
    }
    
    /// @notice Use emergency pause credit
    /// @param qc QC address
    /// @param reason Reason for pause
    function useEmergencyPause(address qc, string memory reason) external onlyQCManager {
        PauseCredit storage credit = pauseCredits[qc];
        
        // Validate conditions
        if (!credit.hasCredit) revert NoPauseCredit();
        if (credit.isPaused) revert AlreadyPaused();
        if (bytes(reason).length == 0) revert ReasonRequired();
        
        // Check QC status
        QCData.QCStatus status = qcData.getQCStatus(qc);
        if (status != QCData.QCStatus.Active) revert QCManagerErrors.QCNotActive(qc);
        
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
    function resumeEarly(address qc) external onlyQCManager {
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
            revert QCManagerErrors.QCNotRegistered(qc);
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
    
    // =================== VIEW FUNCTIONS ===================
    
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
    
    // =================== MIGRATION FUNCTIONS ===================
    
    /// @notice Migrate pause credit data from old system (admin only)
    /// @param qcs Array of QC addresses
    /// @param credits Array of pause credit data
    function migratePauseCredits(
        address[] calldata qcs,
        PauseCredit[] calldata credits
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(qcs.length == credits.length, "QCPauseManager: array length mismatch");
        
        for (uint256 i = 0; i < qcs.length; i++) {
            pauseCredits[qcs[i]] = credits[i];
        }
    }
}