// SPDX-License-Identifier: GPL-3.0-only

pragma solidity ^0.8.17;

import "../account-control/AccountControl.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockReserve
/// @notice A mock reserve implementation for testing AccountControl integration
/// @dev Implements direct backing updates (federated model) without oracle complexity
contract MockReserve is Ownable {
    // ========== STATE VARIABLES ==========

    AccountControl public immutable accountControl;

    // Reserve state
    uint256 public reserveBacking;
    mapping(address => uint256) public userBalances;
    uint256 public totalUserBalances;

    // Test controls
    bool public failOnNext;
    uint256 public updateCount;
    bool public simulateReentrancy;

    // ========== EVENTS ==========

    event BackingChanged(uint256 oldBacking, uint256 newBacking);
    event TokensMinted(address indexed recipient, uint256 amount);
    event TokensRedeemed(address indexed user, uint256 amount);
    event BatchMintExecuted(uint256 totalAmount, uint256 recipientCount);

    // ========== ERRORS ==========

    error SimulatedFailure();
    error InsufficientUserBalance(address user, uint256 requested, uint256 available);
    error InvalidArrayLengths();
    error InvalidAccountControlAddress();
    error InsufficientBacking(uint256 current, uint256 required);
    error InvalidRecipient();

    // ========== CONSTRUCTOR ==========

    constructor(address _accountControl) {
        if (_accountControl == address(0)) {
            revert InvalidAccountControlAddress();
        }
        accountControl = AccountControl(_accountControl);
        _transferOwnership(msg.sender);
    }

    // ========== BACKING MANAGEMENT ==========

    /// @notice Update reserve backing directly (federated model)
    /// @param newBacking The new backing amount in satoshis
    function setBacking(uint256 newBacking) external {
        _setBacking(newBacking);
    }

    /// @notice Increase backing by a specific amount
    /// @param amount The amount to increase backing by
    function increaseBacking(uint256 amount) external {
        uint256 newBacking = reserveBacking + amount;
        _setBacking(newBacking);
    }

    /// @notice Decrease backing by a specific amount
    /// @param amount The amount to decrease backing by
    function decreaseBacking(uint256 amount) external {
        if (reserveBacking < amount) {
            revert InsufficientBacking(reserveBacking, amount);
        }
        uint256 newBacking = reserveBacking - amount;
        _setBacking(newBacking);
    }

    /// @notice Internal function to update backing (prevents reentrancy)
    /// @param newBacking The new backing amount in satoshis
    function _setBacking(uint256 newBacking) internal {
        if (failOnNext) {
            failOnNext = false;
            revert SimulatedFailure();
        }

        uint256 oldBacking = reserveBacking;
        reserveBacking = newBacking;
        updateCount++;

        // Reserve directly updates its backing in AccountControl
        accountControl.updateBacking(newBacking);

        emit BackingChanged(oldBacking, newBacking);
    }

    // ========== MINTING OPERATIONS ==========

    /// @notice Mint tokens to a recipient
    /// @param recipient The address to mint tokens to
    /// @param amount The amount of tokens to mint (in satoshis)
    function mintTokens(address recipient, uint256 amount) external {
        if (recipient == address(0)) {
            revert InvalidRecipient();
        }

        // Test reentrancy if enabled
        if (simulateReentrancy) {
            simulateReentrancy = false;
            // Attempt reentrant call - should be blocked by AccountControl's ReentrancyGuard
            accountControl.mint(recipient, amount);
        }

        // Update state before external call (CEI pattern)
        userBalances[recipient] += amount;
        totalUserBalances += amount;

        // AccountControl checks backing >= minted + amount
        accountControl.mint(recipient, amount);

        emit TokensMinted(recipient, amount);
    }

    /// @notice Batch mint tokens to multiple recipients
    /// @param recipients Array of recipient addresses
    /// @param amounts Array of amounts to mint
    function batchMint(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        if (recipients.length != amounts.length) {
            revert InvalidArrayLengths();
        }

        // Update state before external calls (CEI pattern)
        uint256 total = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (recipients[i] == address(0)) {
                revert InvalidRecipient();
            }
            total += amounts[i];
            userBalances[recipients[i]] += amounts[i];
        }

        totalUserBalances += total;

        // Batch mint through AccountControl if it supports it
        // For now, we'll do individual mints as AccountControl may not have batch yet
        for (uint256 i = 0; i < recipients.length; i++) {
            accountControl.mint(recipients[i], amounts[i]);
        }

        emit BatchMintExecuted(total, recipients.length);
    }

    // ========== REDEMPTION OPERATIONS ==========

    /// @notice Redeem tokens for a user
    /// @param user The user redeeming tokens
    /// @param amount The amount to redeem
    function redeemTokens(address user, uint256 amount) external {
        if (userBalances[user] < amount) {
            revert InsufficientUserBalance(user, amount, userBalances[user]);
        }

        userBalances[user] -= amount;
        totalUserBalances -= amount;

        // Update AccountControl's minted tracking
        accountControl.redeem(amount);

        // In real implementation: transfer BTC to user
        emit TokensRedeemed(user, amount);
    }

    // ========== VIEW FUNCTIONS ==========

    /// @notice Get the current accounting status from AccountControl
    /// @return backing The current backing amount
    /// @return minted The current minted amount
    /// @return canMint Whether the reserve can currently mint
    function getAccountingStatus() external view returns (
        uint256 backing,
        uint256 minted,
        bool canMint
    ) {
        backing = accountControl.backing(address(this));
        minted = accountControl.minted(address(this));
        canMint = accountControl.canOperate(address(this));
    }

    /// @notice Check if the reserve is authorized
    /// @return Whether the reserve is authorized in AccountControl
    function isAuthorized() external view returns (bool) {
        return accountControl.authorized(address(this));
    }

    /// @notice Get available minting capacity
    /// @return The amount that can still be minted
    function getAvailableCapacity() external view returns (uint256) {
        uint256 backing = accountControl.backing(address(this));
        uint256 minted = accountControl.minted(address(this));

        if (backing > minted) {
            return backing - minted;
        }
        return 0;
    }

    // ========== TEST HELPERS ==========

    /// @notice Set whether the next operation should fail
    /// @dev Used to test error handling paths in integration tests
    /// @param shouldFail Whether to simulate a failure on next backing update
    function simulateFailure(bool shouldFail) external onlyOwner {
        failOnNext = shouldFail;
    }

    /// @notice Enable reentrancy simulation for testing
    /// @dev Will attempt a reentrant mint call to test AccountControl's ReentrancyGuard
    function enableReentrancyTest() external onlyOwner {
        simulateReentrancy = true;
    }

    /// @notice Reset all test controls
    /// @dev Clears all test flags to default state
    function resetTestControls() external onlyOwner {
        failOnNext = false;
        simulateReentrancy = false;
    }

    /// @notice Emergency function to directly set user balance (testing only)
    /// @dev Bypasses normal minting flow for test setup - DO NOT use in production
    /// @param user The user address whose balance to modify
    /// @param balance The new balance value to set
    function setUserBalance(address user, uint256 balance) external onlyOwner {
        uint256 oldBalance = userBalances[user];
        userBalances[user] = balance;

        if (balance > oldBalance) {
            totalUserBalances += (balance - oldBalance);
        } else {
            totalUserBalances -= (oldBalance - balance);
        }
    }
}