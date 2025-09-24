// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title Mock AccountControl contract for testing
/// @notice Mock implementation that tracks global minted amount for all users
/// @dev In the real system, QCs mint on behalf of users, not for themselves
contract MockAccountControl {
    /// @notice Track total minted amount globally (in satoshis)
    /// @dev This represents the total tBTC minted through the AccountControl system
    uint256 public totalMinted;

    /// @notice Track whether AccountControl integration is enabled
    bool public accountControlEnabled = true;

    /// @notice Track backing amounts for reserves (for testing)
    mapping(address => uint256) public backing;

    /// @notice Custom error for insufficient minted balance
    error InsufficientMinted(uint256 available, uint256 requested);

    /// @notice Enable or disable AccountControl mode for testing
    /// @param enabled True to enable AccountControl integration, false to disable
    function setAccountControlEnabled(bool enabled) external {
        accountControlEnabled = enabled;
    }

    /// @notice Set totalMinted for testing purposes
    /// @param amount The amount to set as totalMinted (in satoshis)
    function setTotalMintedForTesting(uint256 amount) external {
        totalMinted = amount;
    }

    /// @notice Set backing for a reserve for testing purposes
    /// @param reserve The reserve address
    /// @param amount The backing amount to set
    function setBackingForTesting(address reserve, uint256 amount) external {
        backing[reserve] = amount;
    }
    /// @notice Mock implementation of mintTBTC function
    /// @param user The user receiving minted TBTC
    /// @param amount The amount of TBTC being minted
    /// @dev Tracks total minted amount globally, not per-caller
    /// @return satoshis The amount in satoshis (converted from tBTC)
    function mintTBTC(address user, uint256 amount) external returns (uint256 satoshis) {
        // Convert tBTC (18 decimals) to satoshis (8 decimals)
        satoshis = amount / 1e10;

        // Track total minted amount globally when AccountControl is enabled
        if (accountControlEnabled) {
            totalMinted += satoshis;
        }

        emit TBTCMinted(user, amount, satoshis);
        return satoshis;
    }

    /// @notice Mock implementation of redeemTBTC function
    /// @param amount The amount of TBTC being redeemed (in tBTC wei)
    /// @dev Checks against global totalMinted, as users redeem what was minted for them
    /// @return success True if redemption was successful
    function redeemTBTC(uint256 amount) external returns (bool success) {
        // Convert tBTC amount to satoshis for comparison
        uint256 satoshis = amount / 1e10;

        // Only enforce limits when AccountControl is enabled
        if (accountControlEnabled) {
            // Check if system has sufficient total minted balance
            if (totalMinted < satoshis) {
                revert InsufficientMinted(totalMinted, satoshis);
            }

            // Update global minted balance
            totalMinted -= satoshis;
        }

        emit TBTCRedeemed(msg.sender, amount);
        return true;
    }

    /// @notice Event emitted when TBTC is minted
    event TBTCMinted(address indexed user, uint256 amount, uint256 satoshis);

    /// @notice Event emitted when TBTC is redeemed
    event TBTCRedeemed(address indexed redeemer, uint256 amount);
}