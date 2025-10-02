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

import "../QCData.sol";

/// @title IQCPauseManager
/// @notice Interface for QCPauseManager contract
/// @dev Used by QCManager to interact with the pause management system
interface IQCPauseManager {
    
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
    
    // =================== PAUSE MANAGEMENT FUNCTIONS ===================
    
    /// @notice Check if QC can use pause credit
    /// @param qc QC address
    /// @return canPause Whether QC can self-pause
    function canSelfPause(address qc) external view returns (bool canPause);
    
    /// @notice Renew pause credit after 90 days
    /// @param qc QC address
    function renewPauseCredit(address qc) external;
    
    /// @notice Check and auto-resume if pause expired
    /// @param qc QC address
    function resumeIfExpired(address qc) external;
    
    /// @notice Emergency council can clear pause and restore credit
    /// @param qc QC address
    /// @param reason Reason for clearing
    function emergencyClearPause(address qc, string calldata reason) external;
    
    /// @notice Grant initial credit to new QC
    /// @param qc QC address
    function grantInitialCredit(address qc) external;
    
    /// @notice Use emergency pause credit
    /// @param qc QC address
    /// @param reason Reason for pause
    function useEmergencyPause(address qc, string memory reason) external;
    
    /// @notice Resume early from pause credit system
    /// @param qc QC address
    function resumeEarly(address qc) external;
    
    /// @notice QC can directly call to resume early
    function resumeEarlyDirect() external;
    
    // =================== SELF-PAUSE FUNCTIONS ===================
    
    /// @notice QC initiates self-pause with chosen level
    /// @param level PauseLevel.MintingOnly or PauseLevel.Complete
    function selfPause(QCData.PauseLevel level) external;
    
    /// @notice QC resumes from self-initiated pause before timeout
    function resumeSelfPause() external;
    
    // =================== ESCALATION FUNCTIONS ===================
    
    /// @notice Watchdog checks for QCs requiring auto-escalation
    /// @param qcAddresses Array of QC addresses to check
    function checkQCEscalations(address[] calldata qcAddresses) external;
    
    /// @notice Handle redemption default with graduated consequences
    /// @param qc QC that defaulted
    /// @param redemptionId ID of the defaulted redemption
    function handleRedemptionDefault(address qc, bytes32 redemptionId) external;
    
    /// @notice Clear QC backlog and potentially restore to Active
    /// @param qc QC address
    function clearQCBacklog(address qc) external;
    
    /// @notice Check if QC is eligible for escalation
    /// @param qc QC address
    /// @return eligible Whether QC is eligible for escalation
    /// @return timeUntilEscalation Time until escalation in seconds
    function isEligibleForEscalation(address qc) external view returns (bool eligible, uint256 timeUntilEscalation);
    
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
    );
    
    /// @notice Get time until credit renewal is available
    /// @param qc QC address
    /// @return timeUntilRenewal Seconds until renewal (0 if available now)
    function getTimeUntilRenewal(address qc) external view returns (uint256 timeUntilRenewal);
    
    // =================== MIGRATION FUNCTIONS ===================
    
    /// @notice Migrate pause credit data from old system (admin only)
    /// @param qcs Array of QC addresses
    /// @param credits Array of pause credit data
    function migratePauseCredits(
        address[] calldata qcs,
        PauseCredit[] calldata credits
    ) external;
}