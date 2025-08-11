// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title IQCRenewablePause
/// @notice Interface for QCRenewablePause contract
interface IQCRenewablePause {
    function canSelfPause(address qc) external view returns (bool);
    function useEmergencyPause(address qc, string calldata reason) external;
    function resumeEarly(address qc) external;
    function renewPauseCredit() external;
    function resumeIfExpired(address qc) external;
    function emergencyClearPause(address qc, string calldata reason) external;
    function grantInitialCredit(address qc) external;
    function isSelfPaused(address qc) external view returns (bool);
    function getPauseInfo(address qc) external view returns (
        bool isPaused,
        uint256 pauseEndTime,
        bytes32 pauseReason,
        bool hasCredit,
        uint256 creditRenewTime
    );
    function getEarliestRedemptionDeadline(address qc) external view returns (uint256);
}