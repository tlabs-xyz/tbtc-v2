const { expect } = require("chai");

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

module.exports = {
  getContractConstants,
  expectBalanceChange,
};