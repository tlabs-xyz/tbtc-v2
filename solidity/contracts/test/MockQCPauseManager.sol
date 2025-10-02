// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../account-control/interfaces/IQCPauseManager.sol";
import "../account-control/QCData.sol";

/// @title MockQCPauseManager
/// @notice Mock implementation of IQCPauseManager for testing
contract MockQCPauseManager is IQCPauseManager {
    
    mapping(address => PauseCredit) public pauseCredits;
    
    constructor() {
        // Initialize with default credit for all QCs
    }
    
    /// @notice Check if QC can use pause credit
    function canSelfPause(address qc) external view override returns (bool canPause) {
        return pauseCredits[qc].hasCredit || true; // Always allow for testing
    }
    
    /// @notice Renew pause credit after 90 days
    function renewPauseCredit(address qc) external override {
        pauseCredits[qc].hasCredit = true;
        pauseCredits[qc].creditRenewTime = block.timestamp + 90 days;
        emit PauseCreditRenewed(qc, pauseCredits[qc].creditRenewTime);
    }
    
    /// @notice Check and auto-resume if pause expired
    function resumeIfExpired(address qc) external override {
        if (pauseCredits[qc].isPaused && block.timestamp >= pauseCredits[qc].pauseEndTime) {
            pauseCredits[qc].isPaused = false;
            pauseCredits[qc].pauseEndTime = 0;
            pauseCredits[qc].pauseReason = bytes32(0);
            emit PauseCreditExpired(qc);
        }
    }
    
    /// @notice Emergency council can clear pause and restore credit
    function emergencyClearPause(address qc, string calldata reason) external override {
        pauseCredits[qc].isPaused = false;
        pauseCredits[qc].pauseEndTime = 0;
        pauseCredits[qc].pauseReason = bytes32(0);
        pauseCredits[qc].hasCredit = true;
        emit EmergencyCleared(qc, msg.sender, bytes32(bytes(reason)));
    }
    
    /// @notice Grant initial credit to new QC
    function grantInitialCredit(address qc) external override {
        pauseCredits[qc].hasCredit = true;
        pauseCredits[qc].creditRenewTime = block.timestamp + 90 days;
        emit InitialCreditGranted(qc, msg.sender);
    }
    
    /// @notice Use emergency pause credit
    function useEmergencyPause(address qc, string memory reason) external override {
        pauseCredits[qc].hasCredit = false;
        pauseCredits[qc].isPaused = true;
        pauseCredits[qc].pauseEndTime = block.timestamp + 48 hours;
        pauseCredits[qc].pauseReason = bytes32(bytes(reason));
        pauseCredits[qc].lastUsed = block.timestamp;
        emit PauseCreditUsed(qc, bytes32(bytes(reason)), 48 hours);
    }
    
    /// @notice Resume early from pause credit system
    function resumeEarly(address qc) external override {
        pauseCredits[qc].isPaused = false;
        pauseCredits[qc].pauseEndTime = 0;
        pauseCredits[qc].pauseReason = bytes32(0);
        emit EarlyResumed(qc, msg.sender);
    }
    
    /// @notice QC can directly call to resume early
    function resumeEarlyDirect() external override {
        address qc = msg.sender;
        pauseCredits[qc].isPaused = false;
        pauseCredits[qc].pauseEndTime = 0;
        pauseCredits[qc].pauseReason = bytes32(0);
        emit EarlyResumed(qc, qc);
    }
    
    /// @notice Get comprehensive pause credit information for a QC
    function getPauseInfo(address qc) external view override returns (
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
            credit.hasCredit || true, // Always has credit for testing
            credit.creditRenewTime
        );
    }
    
    /// @notice Get time until credit renewal is available
    function getTimeUntilRenewal(address qc) external view override returns (uint256 timeUntilRenewal) {
        if (pauseCredits[qc].creditRenewTime <= block.timestamp) {
            return 0;
        }
        return pauseCredits[qc].creditRenewTime - block.timestamp;
    }
    
    /// @notice Migrate pause credit data from old system (admin only)
    function migratePauseCredits(
        address[] calldata qcs,
        PauseCredit[] calldata credits
    ) external override {
        require(qcs.length == credits.length, "Array length mismatch");
        for (uint256 i = 0; i < qcs.length; i++) {
            pauseCredits[qcs[i]] = credits[i];
        }
    }
    
    /// @notice QC initiates self-pause with chosen level
    function selfPause(QCData.PauseLevel level) external override {
        address qc = msg.sender;
        pauseCredits[qc].hasCredit = false;
        pauseCredits[qc].isPaused = true;
        pauseCredits[qc].pauseEndTime = block.timestamp + 48 hours;
        pauseCredits[qc].pauseReason = keccak256("SELF_PAUSE");
        pauseCredits[qc].lastUsed = block.timestamp;
        // For mock: just emit basic event without complex types
    }
    
    /// @notice QC resumes from self-initiated pause before timeout
    function resumeSelfPause() external override {
        address qc = msg.sender;
        pauseCredits[qc].isPaused = false;
        pauseCredits[qc].pauseEndTime = 0;
        pauseCredits[qc].pauseReason = bytes32(0);
    }
    
    /// @notice Watchdog checks for QCs requiring auto-escalation
    function checkQCEscalations(address[] calldata qcAddresses) external override {
        // Mock implementation - do nothing for testing
        // In real implementation this would check escalation conditions
    }
    
    /// @notice Handle redemption default with graduated consequences
    function handleRedemptionDefault(address qc, bytes32 redemptionId) external override {
        // Mock implementation - just mark as paused for testing
        pauseCredits[qc].isPaused = true;
        pauseCredits[qc].pauseEndTime = block.timestamp + 48 hours;
        pauseCredits[qc].pauseReason = redemptionId;
    }
    
    /// @notice Clear QC backlog and potentially restore to Active
    function clearQCBacklog(address qc) external override {
        // Mock implementation - clear pause state
        pauseCredits[qc].isPaused = false;
        pauseCredits[qc].pauseEndTime = 0;
        pauseCredits[qc].pauseReason = bytes32(0);
    }
    
    /// @notice Check if QC is eligible for escalation
    function isEligibleForEscalation(address qc) external view override returns (bool eligible, uint256 timeUntilEscalation) {
        // Mock implementation - always return false for testing
        return (false, 0);
    }
}