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

/**
 * @title IQCRedeemer
 * @notice Interface for QCRedeemer contract managing tBTC redemption lifecycle
 * @dev Used by QCManager and QCWalletManager for redemption state tracking
 *
 * @custom:security-notes
 * - Functions are view-only for safe external querying
 * - Used for wallet obligation tracking and QC status management
 * - Part of the Wallet Obligation Tracking System (WOTS)
 */
interface IQCRedeemer {
    /**
     * @notice Check if a QC has any unfulfilled redemption requests
     * @dev Used by QCManager for status escalation and pause decisions
     * @param qc Address of the Qualified Custodian
     * @return True if QC has pending redemptions, false otherwise
     */
    function hasUnfulfilledRedemptions(address qc) external view returns (bool);

    /**
     * @notice Get the earliest redemption deadline for a QC
     * @dev Used for determining escalation timing and grace periods
     * @param qc Address of the Qualified Custodian
     * @return Timestamp of earliest redemption deadline (0 if no redemptions)
     */
    function getEarliestRedemptionDeadline(address qc) external view returns (uint256);

    /**
     * @notice Check if a wallet has any pending redemption obligations
     * @dev Part of WOTS - prevents wallet deregistration while obligations exist
     * @param walletAddress Bitcoin address of the wallet to check
     * @return True if wallet has pending obligations, false otherwise
     */
    function hasWalletObligations(string calldata walletAddress) external view returns (bool);

    /**
     * @notice Get count of pending redemptions for a specific wallet
     * @dev Used for wallet management and obligation tracking
     * @param walletAddress Bitcoin address of the wallet
     * @return Number of pending redemptions assigned to this wallet
     */
    function getWalletPendingRedemptionCount(string calldata walletAddress) external view returns (uint256);

    /**
     * @notice Get earliest redemption deadline for a specific wallet
     * @dev Used for wallet-specific deadline tracking and prioritization
     * @param walletAddress Bitcoin address of the wallet
     * @return Timestamp of earliest redemption deadline for this wallet (0 if none)
     */
    function getWalletEarliestRedemptionDeadline(string calldata walletAddress) external view returns (uint256);
}