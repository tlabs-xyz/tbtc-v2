import { expect } from "chai"
import type { ContractTransaction } from "ethers"

export const ERROR_MESSAGES = {
  // Bridge errors
  DEPOSIT_ALREADY_REVEALED: "Deposit already revealed",
  DEPOSIT_NOT_FOUND: "Deposit not found",
  INVALID_DEPOSIT_PROOF: "Invalid deposit proof",
  WALLET_NOT_FOUND: "Wallet not found",
  INVALID_WALLET_STATE: "Invalid wallet state",
  UNAUTHORIZED_CALLER: "Unauthorized caller",
  INSUFFICIENT_WALLET_FUNDS: "Insufficient wallet funds",

  // Vault errors
  INSUFFICIENT_BALANCE: "Insufficient balance",
  TRANSFER_FAILED: "Transfer failed",
  INVALID_REDEMPTION_REQUEST: "Invalid redemption request",
  REDEMPTION_NOT_FOUND: "Redemption not found",

  // Bank errors
  BALANCE_OVERFLOW: "Balance overflow",
  INSUFFICIENT_BANK_BALANCE: "Insufficient bank balance",

  // Governance errors
  GOVERNANCE_DELAY_NOT_PASSED: "Governance delay has not passed",
  CHANGE_NOT_INITIATED: "Change not initiated",
  INVALID_PARAMETER: "Invalid parameter",

  // SPV errors
  INVALID_MERKLE_PROOF: "Invalid merkle proof",
  INSUFFICIENT_WORK: "Insufficient work",
  INVALID_TRANSACTION: "Invalid transaction",

  // QC (Account Control) errors
  INSUFFICIENT_COLLATERAL: "Insufficient collateral",
  ORACLE_PRICE_STALE: "Oracle price is stale",
  LIQUIDATION_THRESHOLD_EXCEEDED: "Liquidation threshold exceeded",
  UNAUTHORIZED_QC_OPERATION: "Unauthorized QC operation",
  INVALID_RESERVE_RATIO: "Invalid reserve ratio",
} as const

export type ErrorMessage = typeof ERROR_MESSAGES[keyof typeof ERROR_MESSAGES]

/**
 * Expect a transaction to revert with a specific custom error
 */
export async function expectCustomError(
  transactionPromise: Promise<ContractTransaction>,
  expectedError: ErrorMessage
): Promise<void> {
  await expect(transactionPromise).to.be.revertedWith(expectedError)
}

/**
 * Expect a transaction to revert with any error (when specific error is unknown)
 */
export async function expectRevert(
  transactionPromise: Promise<ContractTransaction>
): Promise<void> {
  await expect(transactionPromise).to.be.reverted
}

/**
 * Expect a transaction to revert with a specific custom error name (for custom errors)
 */
export async function expectCustomErrorName(
  transactionPromise: Promise<ContractTransaction>,
  errorName: string
): Promise<void> {
  await expect(transactionPromise).to.be.revertedWithCustomError(
    await transactionPromise,
    errorName
  )
}

/**
 * Helper to verify error propagation across multiple contracts
 */
export async function expectErrorPropagation(
  transactions: Promise<ContractTransaction>[],
  expectedErrors: ErrorMessage[]
): Promise<void> {
  for (let i = 0; i < transactions.length; i++) {
    await expectCustomError(transactions[i], expectedErrors[i])
  }
}

/**
 * Verify that multiple operations fail with the same error
 */
export async function expectConsistentError(
  transactions: Promise<ContractTransaction>[],
  expectedError: ErrorMessage
): Promise<void> {
  for (const transaction of transactions) {
    await expectCustomError(transaction, expectedError)
  }
}

/**
 * Test error scenarios in integration contexts
 */
export async function testIntegrationErrorScenario(
  scenarioName: string,
  setupFn: () => Promise<void>,
  errorOperations: Array<{
    operation: () => Promise<ContractTransaction>
    expectedError: ErrorMessage
    description: string
  }>
): Promise<void> {
  describe(`Integration Error Scenario: ${scenarioName}`, () => {
    before(async () => {
      await setupFn()
    })

    for (const { operation, expectedError, description } of errorOperations) {
      it(`should revert with "${expectedError}" when ${description}`, async () => {
        await expectCustomError(operation(), expectedError)
      })
    }
  })
}
