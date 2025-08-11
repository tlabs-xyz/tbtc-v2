// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title IQCData
/// @notice Interface for QCData contract with 5-state model
interface IQCData {
    /// @dev QC status enumeration - enhanced 5-state model
    enum QCStatus {
        Active,         // 0 - Full operations
        MintingPaused,  // 1 - Can fulfill only
        Paused,         // 2 - Complete halt
        UnderReview,    // 3 - Under governance review
        Revoked         // 4 - Terminal state
    }

    /// @dev Wallet status enumeration
    enum WalletStatus {
        Inactive,
        Active,
        PendingDeRegistration,
        Deregistered
    }

    function getQCStatus(address qc) external view returns (QCStatus);
    function setQCStatus(address qc, QCStatus newStatus, bytes32 reason) external;
    function setQCSelfPaused(address qc, bool selfPaused) external;
    function isQCRegistered(address qc) external view returns (bool);
    function canQCMint(address qc) external view returns (bool);
    function canQCFulfill(address qc) external view returns (bool);
    function getQCInfo(address qc) external view returns (
        QCStatus status,
        uint256 totalMinted,
        uint256 maxCapacity,
        uint256 registeredAt,
        bool selfPaused
    );
}