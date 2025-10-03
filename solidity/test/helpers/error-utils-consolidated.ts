import { expect } from "chai"
import type { ContractTransaction } from "ethers"

/**
 * Consolidated error testing utilities for all test suites
 * Combines functionality from error-utils.ts and error-helpers.ts
 */

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

  // Wallet control errors
  WALLET_NOT_REGISTERED: "Wallet not registered",
  UNAUTHORIZED_WALLET_ACCESS: "Unauthorized wallet access",
  INVALID_WALLET_CONTROL_PROOF: "Invalid wallet control proof",

  // Redemption errors
  REDEMPTION_ALREADY_FULFILLED: "Redemption already fulfilled",
  PAYMENT_VERIFICATION_FAILED: "Payment verification failed",
  INSUFFICIENT_REDEMPTION_AMOUNT: "Insufficient redemption amount",

  // Access control errors
  NOT_AUTHORIZED: "Not authorized",
  ONLY_GOVERNANCE: "Only governance",
  ONLY_WATCHDOG: "Only watchdog",

  // General validation errors
  INVALID_ADDRESS: "Invalid address",
  ZERO_ADDRESS: "Zero address",
  INVALID_AMOUNT: "Invalid amount",
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
 * Advanced version of expectCustomError that supports contract factory and arguments
 */
export async function expectCustomErrorWithArgs(
  txPromise: Promise<any>,
  contractFactory: any,
  errorName: string,
  ...errorArgs: any[]
): Promise<void> {
  if (errorArgs.length > 0) {
    await expect(txPromise)
      .to.be.revertedWithCustomError(contractFactory, errorName)
      .withArgs(...errorArgs)
  } else {
    await expect(txPromise).to.be.revertedWithCustomError(
      contractFactory,
      errorName
    )
  }
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

/**
 * Extracts error message from various error types
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === "string") {
    return error
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as any).message)
  }
  return String(error)
}

/**
 * Checks if an error message contains expected text
 */
export function containsErrorMessage(
  error: unknown,
  expectedMessage: string
): boolean {
  const errorMessage = extractErrorMessage(error)
  return errorMessage.includes(expectedMessage)
}

/**
 * Validates that an error contains one of several possible messages
 */
export function validateErrorMessage(
  error: unknown,
  possibleMessages: string[]
): boolean {
  const errorMessage = extractErrorMessage(error)
  return possibleMessages.some((msg) => errorMessage.includes(msg))
}

/**
 * Creates a helper for testing access control errors
 */
export function createAccessControlTester(contract: any) {
  return {
    /**
     * Tests that only governance can call a function
     */
    async testOnlyGovernance(
      functionName: string,
      args: any[] = [],
      nonGovernanceSigner: any
    ): Promise<void> {
      await expectCustomError(
        contract.connect(nonGovernanceSigner)[functionName](...args),
        ERROR_MESSAGES.ONLY_GOVERNANCE
      )
    },

    /**
     * Tests that only watchdog can call a function
     */
    async testOnlyWatchdog(
      functionName: string,
      args: any[] = [],
      nonWatchdogSigner: any
    ): Promise<void> {
      await expectCustomError(
        contract.connect(nonWatchdogSigner)[functionName](...args),
        ERROR_MESSAGES.ONLY_WATCHDOG
      )
    },

    /**
     * Tests that unauthorized users cannot call a function
     */
    async testUnauthorized(
      functionName: string,
      args: any[] = [],
      unauthorizedSigner: any
    ): Promise<void> {
      await expectCustomError(
        contract.connect(unauthorizedSigner)[functionName](...args),
        ERROR_MESSAGES.NOT_AUTHORIZED
      )
    },
  }
}

/**
 * Creates a helper for testing parameter validation errors
 */
export function createParameterValidationTester(contract: any) {
  return {
    /**
     * Tests zero address validation
     */
    async testZeroAddress(
      functionName: string,
      parameterIndex: number,
      otherArgs: any[] = []
    ): Promise<void> {
      const args = [...otherArgs]
      args[parameterIndex] = "0x0000000000000000000000000000000000000000"

      await expectCustomError(
        contract[functionName](...args),
        ERROR_MESSAGES.ZERO_ADDRESS
      )
    },

    /**
     * Tests invalid amount validation
     */
    async testInvalidAmount(
      functionName: string,
      parameterIndex: number,
      otherArgs: any[] = []
    ): Promise<void> {
      const args = [...otherArgs]
      args[parameterIndex] = 0

      await expectCustomError(
        contract[functionName](...args),
        ERROR_MESSAGES.INVALID_AMOUNT
      )
    },
  }
}

/**
 * Wraps a function call to catch and analyze errors
 */
export async function safeCall<T>(
  fn: () => Promise<T>
): Promise<{ success: boolean; result?: T; error?: string }> {
  try {
    const result = await fn()
    return { success: true, result }
  } catch (error) {
    return { success: false, error: extractErrorMessage(error) }
  }
}

/**
 * Tests that a function behaves correctly with various invalid inputs
 */
export async function testInvalidInputs(
  contract: any,
  functionName: string,
  validArgs: any[],
  invalidInputTests: Array<{
    name: string
    args: any[]
    expectedError: ErrorMessage
  }>
): Promise<void> {
  for (const test of invalidInputTests) {
    try {
      await expectCustomError(
        contract[functionName](...test.args),
        test.expectedError
      )
    } catch (error) {
      throw new Error(
        `Test "${test.name}" failed: ${extractErrorMessage(error)}`
      )
    }
  }
}

/**
 * Legacy compatibility export
 */
export const errorTestUtils = {
  expectRevert,
  expectRevertAny: expectRevert, // Alias for compatibility
  expectCustomError,
  expectCustomErrorWithArgs,
  expectCustomErrorName,
  containsErrorMessage,
  extractErrorMessage,
  validateErrorMessage,
  createAccessControlTester,
  createParameterValidationTester,
  safeCall,
  testInvalidInputs,
  expectErrorPropagation,
  expectConsistentError,
  testIntegrationErrorScenario,
  ERROR_MESSAGES,
}