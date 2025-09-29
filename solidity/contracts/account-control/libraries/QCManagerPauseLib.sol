// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../QCData.sol";
import "../QCManagerErrors.sol";

/// @title QCManagerPauseLib
/// @dev Library containing pause credit management logic extracted from QCManager to reduce contract size
/// @notice This library implements the renewable 90-day pause credit system for QCs
library QCManagerPauseLib {
    
    // =================== PAUSE CREDIT CONSTANTS ===================
    
    uint256 public constant PAUSE_DURATION = 48 hours;
    uint256 public constant RENEWAL_PERIOD = 90 days;
    uint256 public constant MIN_REDEMPTION_BUFFER = 8 hours;
    
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
    
    // =================== EVENTS ===================
    // Note: Since libraries cannot emit events directly, these events must be defined 
    // in the calling contract and emitted there
    
    // event PauseCreditUsed(address indexed qc, bytes32 reason, uint256 duration);
    // event PauseCreditRenewed(address indexed qc, uint256 nextRenewalTime);
    // event PauseCreditExpired(address indexed qc);
    // event EmergencyCleared(address indexed qc, address indexed clearedBy, bytes32 reason);
    // event EarlyResumed(address indexed qc, address indexed resumedBy);
    // event InitialCreditGranted(address indexed qc, address indexed grantedBy);
    
    // =================== PAUSE CREDIT MANAGEMENT FUNCTIONS ===================
    
    /// @notice Check if QC can use pause credit
    /// @param pauseCredits The pause credits mapping
    /// @param qcData QCData contract instance
    /// @param qc QC address
    /// @param getEarliestRedemptionDeadlineFn Function to get earliest redemption deadline
    /// @return canPause Whether QC can self-pause
    function canSelfPause(
        mapping(address => PauseCredit) storage pauseCredits,
        QCData qcData,
        address qc,
        function(address) external view returns (uint256) getEarliestRedemptionDeadlineFn
    ) external view returns (bool canPause) {
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
        uint256 earliestDeadline = getEarliestRedemptionDeadlineFn(qc);
        if (earliestDeadline > 0 && 
            earliestDeadline < block.timestamp + PAUSE_DURATION + MIN_REDEMPTION_BUFFER) {
            return false;
        }
        
        return true;
    }
    
    /// @notice Renew pause credit after 90 days
    /// @param pauseCredits The pause credits mapping
    /// @param qcData QCData contract instance
    /// @param qc QC address
    function renewPauseCredit(
        mapping(address => PauseCredit) storage pauseCredits,
        QCData qcData,
        address qc
    ) external {
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
        
        // Note: PauseCreditRenewed event must be emitted by calling contract
        // emit PauseCreditRenewed(qc, block.timestamp + RENEWAL_PERIOD);
    }
    
    /// @notice Check and auto-resume if pause expired
    /// @param pauseCredits The pause credits mapping
    /// @param qc QC address
    function resumeIfExpired(
        mapping(address => PauseCredit) storage pauseCredits,
        address qc
    ) external {
        PauseCredit storage credit = pauseCredits[qc];
        
        if (!credit.isPaused) revert NotPaused();
        if (block.timestamp < credit.pauseEndTime) revert PauseNotExpired();
        
        // Clear pause state
        credit.isPaused = false;
        credit.pauseEndTime = 0;
        credit.pauseReason = bytes32(0);
        
        // Note: PauseCreditExpired event must be emitted by calling contract
        // emit PauseCreditExpired(qc);
    }
    
    /// @notice Emergency council can clear pause and restore credit
    /// @param pauseCredits The pause credits mapping
    /// @param qc QC address
    /// @param reason Reason for clearing
    /// @return reasonHash The hash of the reason for event emission
    function emergencyClearPause(
        mapping(address => PauseCredit) storage pauseCredits,
        address qc,
        string calldata reason
    ) external returns (bytes32 reasonHash) {
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
        
        reasonHash = keccak256(bytes(reason));
        
        // Note: EmergencyCleared event must be emitted by calling contract
        // emit EmergencyCleared(qc, msg.sender, reasonHash);
    }
    
    /// @notice Grant initial credit to new QC
    /// @param pauseCredits The pause credits mapping
    /// @param qcData QCData contract instance
    /// @param qc QC address
    function grantInitialCredit(
        mapping(address => PauseCredit) storage pauseCredits,
        QCData qcData,
        address qc
    ) external {
        // Verify QC is registered
        if (!qcData.isQCRegistered(qc)) {
            revert QCManagerErrors.QCNotRegistered(qc);
        }
        
        if (pauseCredits[qc].lastUsed != 0) revert QCAlreadyInitialized();
        
        pauseCredits[qc].hasCredit = true;
        
        // Note: InitialCreditGranted event must be emitted by calling contract
        // emit InitialCreditGranted(qc, msg.sender);
    }
    
    /// @notice Use emergency pause credit
    /// @param pauseCredits The pause credits mapping
    /// @param qcData QCData contract instance
    /// @param qc QC address
    /// @param reason Reason for pause
    /// @param getEarliestRedemptionDeadlineFn Function to get earliest redemption deadline
    /// @return reasonHash The hash of the reason for event emission
    function useEmergencyPause(
        mapping(address => PauseCredit) storage pauseCredits,
        QCData qcData,
        address qc,
        string memory reason,
        function(address) external view returns (uint256) getEarliestRedemptionDeadlineFn
    ) external returns (bytes32 reasonHash) {
        PauseCredit storage credit = pauseCredits[qc];
        
        // Validate conditions
        if (!credit.hasCredit) revert NoPauseCredit();
        if (credit.isPaused) revert AlreadyPaused();
        if (bytes(reason).length == 0) revert ReasonRequired();
        
        // Check QC status
        QCData.QCStatus status = qcData.getQCStatus(qc);
        if (status != QCData.QCStatus.Active) revert QCManagerErrors.QCNotActive(qc);
        
        // Deadline protection
        uint256 earliestDeadline = getEarliestRedemptionDeadlineFn(qc);
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
        reasonHash = keccak256(bytes(reason));
        credit.pauseReason = reasonHash;
        
        // Note: PauseCreditUsed event must be emitted by calling contract
        // emit PauseCreditUsed(qc, reasonHash, PAUSE_DURATION);
    }
    
    /// @notice Resume early from pause credit system
    /// @param pauseCredits The pause credits mapping
    /// @param qc QC address
    function resumeEarly(
        mapping(address => PauseCredit) storage pauseCredits,
        address qc
    ) external {
        PauseCredit storage credit = pauseCredits[qc];
        
        // Clear pause state
        credit.isPaused = false;
        credit.pauseEndTime = 0;
        credit.pauseReason = bytes32(0);
        
        // Note: EarlyResumed event must be emitted by calling contract
        // emit EarlyResumed(qc, msg.sender);
    }
    
    // =================== VIEW FUNCTIONS ===================
    
    /// @notice Get comprehensive pause credit information for a QC
    /// @param pauseCredits The pause credits mapping
    /// @param qc QC address
    /// @return isPaused Whether currently paused
    /// @return pauseEndTime When pause expires
    /// @return pauseReason Reason for pause
    /// @return hasCredit Whether credit is available
    /// @return creditRenewTime When credit can be renewed
    function getPauseInfo(
        mapping(address => PauseCredit) storage pauseCredits,
        address qc
    ) external view returns (
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
    ) internal view returns (uint256 timeUntilRenewal) {
        if (hasCredit || lastUsed == 0) {
            return 0;
        }

        if (block.timestamp >= creditRenewTime) {
            return 0;
        }

        return creditRenewTime - block.timestamp;
    }
    
    /// @notice Get time until credit renewal is available
    /// @param pauseCredits The pause credits mapping
    /// @param qc QC address
    /// @return timeUntilRenewal Seconds until renewal (0 if available now)
    function getTimeUntilRenewal(
        mapping(address => PauseCredit) storage pauseCredits,
        address qc
    ) external view returns (uint256 timeUntilRenewal) {
        PauseCredit memory credit = pauseCredits[qc];
        return calculateTimeUntilRenewal(
            credit.hasCredit,
            credit.lastUsed,
            credit.creditRenewTime
        );
    }
}