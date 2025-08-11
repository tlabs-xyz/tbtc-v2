// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./QCData.sol";
import "./QCRedeemer.sol";

/// @title QCRenewablePause
/// @notice Manages renewable pause credits for QC self-management
/// @dev Implements 90-day renewable credits with redemption deadline protection
contract QCRenewablePause is Initializable, AccessControlUpgradeable {
    // =================== CONSTANTS ===================
    
    uint256 public constant PAUSE_DURATION = 48 hours;
    uint256 public constant RENEWAL_PERIOD = 90 days;
    uint256 public constant MIN_REDEMPTION_BUFFER = 8 hours;
    
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant STATE_MANAGER_ROLE = keccak256("STATE_MANAGER_ROLE");
    
    // =================== CUSTOM ERRORS ===================
    
    error QCNotActive();
    error NoPauseCreditAvailable();
    error AlreadyPaused();
    error ReasonRequired();
    error WouldBreachRedemptionDeadline();
    error NotPaused();
    error PauseNotExpired();
    error CreditAlreadyAvailable();
    error NeverUsedCredit();
    error RenewalPeriodNotMet();
    error QCAlreadyInitialized();
    error OnlyStateManager();
    
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
    
    mapping(address => PauseCredit) public pauseCredits;
    QCData public qcData;
    QCRedeemer public qcRedeemer;
    address public qcStateManager;
    
    // =================== EVENTS ===================
    
    event PauseCreditUsed(
        address indexed qc,
        bytes32 reason,
        uint256 duration
    );
    
    event PauseCreditRenewed(
        address indexed qc,
        uint256 nextRenewalTime
    );
    
    event PauseExpired(
        address indexed qc
    );
    
    event EmergencyCleared(
        address indexed qc,
        address indexed clearedBy,
        bytes32 reason
    );
    
    event EarlyResumed(
        address indexed qc
    );
    
    event InitialCreditGranted(
        address indexed qc,
        address indexed grantedBy
    );
    
    // =================== INITIALIZATION ===================
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }
    
    function initialize(
        address _qcData,
        address _qcRedeemer
    ) external initializer {
        __AccessControl_init();
        
        qcData = QCData(_qcData);
        qcRedeemer = QCRedeemer(_qcRedeemer);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }
    
    /// @notice Set the QCStateManager contract address
    /// @param _qcStateManager Address of the QCStateManager contract
    function setQCStateManager(address _qcStateManager) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        qcStateManager = _qcStateManager;
        _grantRole(STATE_MANAGER_ROLE, _qcStateManager);
    }
    
    // =================== PAUSE CREDIT MANAGEMENT ===================
    
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
        uint256 earliestDeadline = getEarliestRedemptionDeadline(qc);
        if (earliestDeadline > 0 && 
            earliestDeadline < block.timestamp + PAUSE_DURATION + MIN_REDEMPTION_BUFFER) {
            return false;
        }
        
        return true;
    }
    
    /// @notice Use emergency pause credit (called by QCStateManager)
    /// @param qc QC address
    /// @param reason Reason for pause
    function useEmergencyPause(address qc, string calldata reason) external {
        // Only QCStateManager can call this
        if (msg.sender != qcStateManager) {
            revert OnlyStateManager();
        }
        
        PauseCredit storage credit = pauseCredits[qc];
        
        // Validate conditions
        if (!credit.hasCredit) revert NoPauseCreditAvailable();
        if (credit.isPaused) revert AlreadyPaused();
        if (bytes(reason).length == 0) revert ReasonRequired();
        
        // Check QC status
        QCData.QCStatus status = qcData.getQCStatus(qc);
        if (status != QCData.QCStatus.Active) revert QCNotActive();
        
        // Deadline protection
        uint256 earliestDeadline = getEarliestRedemptionDeadline(qc);
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
        credit.pauseReason = keccak256(bytes(reason));
        
        emit PauseCreditUsed(qc, credit.pauseReason, PAUSE_DURATION);
    }
    
    /// @notice Renew pause credit after 90 days
    function renewPauseCredit() external {
        address qc = msg.sender;
        PauseCredit storage credit = pauseCredits[qc];
        
        // Validate conditions
        QCData.QCStatus status = qcData.getQCStatus(qc);
        if (status != QCData.QCStatus.Active) revert QCNotActive();
        if (credit.hasCredit) revert CreditAlreadyAvailable();
        if (credit.lastUsed == 0) revert NeverUsedCredit();
        if (block.timestamp < credit.creditRenewTime) revert RenewalPeriodNotMet();
        
        // Renew credit
        credit.hasCredit = true;
        credit.creditRenewTime = 0;
        
        emit PauseCreditRenewed(qc, block.timestamp + RENEWAL_PERIOD);
    }
    
    // =================== PAUSE MANAGEMENT ===================
    
    /// @notice Check and auto-resume if pause expired
    /// @param qc QC address
    function resumeIfExpired(address qc) external {
        PauseCredit storage credit = pauseCredits[qc];
        
        if (!credit.isPaused) revert NotPaused();
        if (block.timestamp < credit.pauseEndTime) revert PauseNotExpired();
        
        // Clear pause state
        credit.isPaused = false;
        credit.pauseEndTime = 0;
        credit.pauseReason = bytes32(0);
        
        emit PauseExpired(qc);
    }
    
    /// @notice QC early resume (called by QCStateManager)
    /// @param qc QC address
    function resumeEarly(address qc) external {
        // Only QCStateManager can call this
        if (msg.sender != qcStateManager) {
            revert OnlyStateManager();
        }
        
        PauseCredit storage credit = pauseCredits[qc];
        
        // Clear pause state
        credit.isPaused = false;
        credit.pauseEndTime = 0;
        credit.pauseReason = bytes32(0);
        
        emit EarlyResumed(qc);
    }
    
    // =================== EMERGENCY FUNCTIONS ===================
    
    /// @notice Emergency council can clear pause and restore credit
    /// @param qc QC address
    /// @param reason Reason for clearing
    function emergencyClearPause(address qc, string calldata reason) 
        external 
        onlyRole(PAUSER_ROLE) 
    {
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
        
        emit EmergencyCleared(qc, msg.sender, keccak256(bytes(reason)));
    }
    
    // =================== ADMIN FUNCTIONS ===================
    
    /// @notice Grant initial credit to new QC
    /// @param qc QC address
    function grantInitialCredit(address qc) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        if (pauseCredits[qc].lastUsed != 0) revert QCAlreadyInitialized();
        
        pauseCredits[qc].hasCredit = true;
        
        emit InitialCreditGranted(qc, msg.sender);
    }
    
    // =================== VIEW FUNCTIONS ===================
    
    /// @notice Get earliest redemption deadline for a QC
    /// @param qc QC address
    /// @return deadline Earliest redemption deadline (0 if none)
    function getEarliestRedemptionDeadline(address qc) 
        public 
        view 
        returns (uint256 deadline) 
    {
        try qcRedeemer.getEarliestRedemptionDeadline(qc) returns (uint256 deadline) {
            return deadline;
        } catch {
            return 0;
        }
    }
    
    /// @notice Check if QC is currently self-paused
    /// @param qc QC address
    /// @return isPaused Whether QC is paused
    function isSelfPaused(address qc) external view returns (bool isPaused) {
        return pauseCredits[qc].isPaused;
    }
    
    /// @notice Get comprehensive pause information for a QC
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
    
    /// @notice Get time until credit renewal is available
    /// @param qc QC address
    /// @return timeUntilRenewal Seconds until renewal (0 if available now)
    function getTimeUntilRenewal(address qc) 
        external 
        view 
        returns (uint256 timeUntilRenewal) 
    {
        PauseCredit memory credit = pauseCredits[qc];
        
        if (credit.hasCredit || credit.lastUsed == 0) {
            return 0;
        }
        
        if (block.timestamp >= credit.creditRenewTime) {
            return 0;
        }
        
        return credit.creditRenewTime - block.timestamp;
    }
}