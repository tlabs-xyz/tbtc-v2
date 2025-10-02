import { expect } from "chai"

/**
 * Error testing utilities for account-control tests
 * Provides standardized methods for error handling and validation
 */

/**
 * Common error messages used across account-control tests
 */
export const ERROR_MESSAGES = {
  // Wallet control errors
  WALLET_NOT_REGISTERED: "Wallet not registered",
  UNAUTHORIZED_WALLET_ACCESS: "Unauthorized wallet access",
  INVALID_WALLET_CONTROL_PROOF: "Invalid wallet control proof",

  // Redemption errors
  REDEMPTION_NOT_FOUND: "Redemption not found",
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

/**
 * Asserts that a transaction reverts with a specific error message
 */
export async function expectRevert(
  txPromise: Promise<any>,
  expectedError: string
): Promise<void> {
  await expect(txPromise).to.be.revertedWith(expectedError)
}

/**
 * Asserts that a transaction reverts with any error
 */
export async function expectRevertAny(txPromise: Promise<any>): Promise<void> {
  await expect(txPromise).to.be.reverted
}

/**
 * Asserts that a transaction reverts with a specific custom error
 */
export async function expectCustomError(
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
 * Checks if an error message contains expected text
 */
export function containsErrorMessage(
  error: unknown,
  expectedMessage: string
): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error)
  return errorMessage.includes(expectedMessage)
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
      await expectRevert(
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
      await expectRevert(
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
      await expectRevert(
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

      await expectRevert(
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

      await expectRevert(
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
    expectedError: string
  }>
): Promise<void> {
  for (const test of invalidInputTests) {
    try {
      await expectRevert(
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
 * Legacy error testing utilities
 */
export const errorTestUtils = {
  expectRevert,
  expectRevertAny,
  expectCustomError,
  containsErrorMessage,
  extractErrorMessage,
  validateErrorMessage,
  createAccessControlTester,
  createParameterValidationTester,
  safeCall,
  testInvalidInputs,
  ERROR_MESSAGES,
}
