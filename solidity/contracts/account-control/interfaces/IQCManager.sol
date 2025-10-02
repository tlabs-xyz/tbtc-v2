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

/**
 * @title IQCManager
 * @notice Interface for QCManager contract interactions
 * @dev Used by QCPauseManager and other contracts for QC management operations
 */
interface IQCManager {
    /**
     * @notice Get the earliest redemption deadline for a QC
     * @dev Used for determining escalation timing and grace periods
     * @param qc Address of the Qualified Custodian
     * @return Timestamp of earliest redemption deadline (0 if no redemptions)
     */
    function getEarliestRedemptionDeadline(address qc) external view returns (uint256);

    /**
     * @notice Check if a QC has any unfulfilled redemption requests
     * @dev Used by QCPauseManager for status escalation and pause decisions
     * @param qc Address of the Qualified Custodian
     * @return True if QC has pending redemptions, false otherwise
     */
    function hasUnfulfilledRedemptions(address qc) external view returns (bool);

    /**
     * @notice Sync account control system with QC status changes
     * @dev Called when QC status changes to maintain system consistency
     * @param qc Address of the Qualified Custodian
     * @param oldStatus Previous QC status
     * @param newStatus New QC status
     */
    function syncAccountControlWithStatus(address qc, QCData.QCStatus oldStatus, QCData.QCStatus newStatus) external;
}