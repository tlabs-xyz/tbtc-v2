// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title IQCRedeemer
/// @notice Interface for QCRedeemer contract
interface IQCRedeemer {
    function hasUnfulfilledRedemptions(address qc) external view returns (bool);
    function getEarliestRedemptionDeadline(address qc) external view returns (uint256);
    function getPendingRedemptionCount(address qc) external view returns (uint256);
}