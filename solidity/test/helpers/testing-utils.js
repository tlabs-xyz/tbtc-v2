const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

/**
 * Get contract constants dynamically to prevent hardcoded value bugs
 */
const getContractConstants = async (accountControl) => ({
  MIN_MINT_AMOUNT: await accountControl.MIN_MINT_AMOUNT(),
  MAX_SINGLE_MINT: await accountControl.MAX_SINGLE_MINT(),
  MAX_BATCH_SIZE: await accountControl.MAX_BATCH_SIZE(),
});

/**
 * Test balance changes from operations
 * Prevents state contamination by checking relative changes
 */
const expectBalanceChange = async (token, user, expectedChange, operation) => {
  const balanceBefore = await token.balanceAvailable(user);
  await operation();
  const balanceAfter = await token.balanceAvailable(user);
  expect(balanceAfter).to.equal(balanceBefore.add(expectedChange));
};

/**
 * Get common test amounts based on contract constants
 * Prevents hardcoded 1000000, 500000, 2000000 across tests
 */
const getTestAmounts = async (accountControl) => {
  const constants = await getContractConstants(accountControl);
  return {
    // Common caps used across tests
    SMALL_CAP: constants.MIN_MINT_AMOUNT.mul(100),  // 1M satoshis = 0.01 BTC
    MEDIUM_CAP: constants.MIN_MINT_AMOUNT.mul(200), // 2M satoshis = 0.02 BTC
    // Common mint amounts used across tests
    SMALL_MINT: constants.MIN_MINT_AMOUNT.mul(50),  // 500K satoshis = 0.005 BTC
    MEDIUM_MINT: constants.MIN_MINT_AMOUNT.mul(10), // 100K satoshis = 0.001 BTC
    TINY_MINT: constants.MIN_MINT_AMOUNT,           // 10K satoshis = MIN_MINT
    // Include all constants
    ...constants
  };
};

/**
 * Deploy AccountControl for testing with standard setup
 * Eliminates duplicate deployment code across 8+ files
 */
const deployAccountControlForTest = async (owner, emergencyCouncil, mockBank) => {
  const AccountControlFactory = await ethers.getContractFactory("AccountControl");
  return await upgrades.deployProxy(
    AccountControlFactory,
    [owner.address, emergencyCouncil.address, mockBank.address],
    { initializer: "initialize" }
  );
};

module.exports = {
  getContractConstants,
  expectBalanceChange,
  getTestAmounts,
  deployAccountControlForTest,
};