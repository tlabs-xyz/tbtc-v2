// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title Mock AccountControl contract for testing
/// @notice Minimal implementation for SPV security tests
contract MockAccountControl {
    /// @notice Mock implementation of redeemTBTC function
    /// @param amount The amount of TBTC being redeemed
    /// @dev This is a no-op implementation for testing purposes
    /// @return success True if redemption was successful
    function redeemTBTC(uint256 amount) external returns (bool success) {
        // No-op: just emit an event for testing purposes
        emit TBTCRedeemed(msg.sender, amount);
        return true;
    }

    /// @notice Event emitted when TBTC is redeemed
    event TBTCRedeemed(address indexed redeemer, uint256 amount);
}