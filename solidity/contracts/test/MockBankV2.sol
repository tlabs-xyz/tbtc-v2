// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title MockBankV2
 * @notice Mock implementation of Bank for testing AccountControl V2
 * @dev Extends the existing IBank interface with increaseBalance for minting
 */
contract MockBankV2 {
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    event BalanceIncreased(address indexed account, uint256 amount);
    event BalanceDecreased(address indexed account, uint256 amount);

    /**
     * @notice Increase balance (mint operation)
     * @param account The account to increase balance for
     * @param amount The amount to increase
     */
    function increaseBalance(address account, uint256 amount) external {
        balanceOf[account] += amount;
        totalSupply += amount;
        emit BalanceIncreased(account, amount);
    }

    /**
     * @notice Decrease balance (burn operation)
     * @param account The account to decrease balance for
     * @param amount The amount to decrease
     */
    function decreaseBalance(address account, uint256 amount) external {
        require(balanceOf[account] >= amount, "Insufficient balance");
        balanceOf[account] -= amount;
        totalSupply -= amount;
        emit BalanceDecreased(account, amount);
    }

    /**
     * @notice Get available balance
     * @param account The account to check
     * @return The available balance
     */
    function balanceAvailable(address account) external view returns (uint256) {
        return balanceOf[account];
    }

    // Test helper functions
    function setTotalSupply(uint256 _totalSupply) external {
        totalSupply = _totalSupply;
    }

    function setBalance(address account, uint256 amount) external {
        balanceOf[account] = amount;
    }
}