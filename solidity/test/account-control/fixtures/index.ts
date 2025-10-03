/**
 * Account Control Test Fixtures
 *
 * This barrel file exports all test constants, factory functions, and utilities
 * for account-control testing. Import from this file for easy access to all
 * test data and utilities.
 *
 * @example
 * ```typescript
 * import {
 *   ROLE_CONSTANTS,
 *   BITCOIN_ADDRESSES,
 *   createMintingScenario,
 *   createRedemptionScenario
 * } from "../fixtures"
 * ```
 *
 * @example New centralized constants usage
 * ```typescript
 * import {
 *   TIMEOUTS,
 *   AMOUNTS,
 *   BTC_ADDRESSES,
 *   ETH_ADDRESSES,
 *   ROLES
 * } from "../fixtures"
 *
 * const timeout = TIMEOUTS.REDEMPTION_24H
 * const amount = AMOUNTS.STANDARD_100_ETH
 * const address = BTC_ADDRESSES.BECH32_STANDARD
 * ```
 */

// =============================================================================
// NEW CENTRALIZED CONSTANTS (RECOMMENDED)
// =============================================================================

// Re-export centralized constants from main fixtures
export {
  // Primary constant groups
  TIMEOUTS,
  AMOUNTS,
  BTC_ADDRESSES,
  ETH_ADDRESSES,
  ROLES,
  GAS_LIMITS,
  ERROR_MESSAGES,
  BLOCKCHAIN,
  PERCENTAGES,
  // Convenience aliases
  TIME,
  MONEY,
  BITCOIN,
  ETHEREUM,
  ACCESS,
  ERRORS,
  GAS,
  CHAIN,
  PERCENT,
  // Common values and scenarios
  COMMON_TEST_VALUES,
  TEST_SCENARIOS,
  VALIDATION,
  // Default export
  default as Constants,
} from "../../fixtures/constants"

// =============================================================================
// BACKWARD COMPATIBLE EXPORTS (LEGACY)
// =============================================================================

// Export all constants and utilities from test-data (backward compatibility)
export {
  // SPV configuration
  spvTestConfig,
  SPV_CONSTANTS,
  bitcoinTestAddresses,
  // Basic factory functions
  createTestWalletRegistration,
  createTestRedemptionScenario,
  createMockBitcoinTxInfo,
  createMockBitcoinTxProof,
  generateTestId,
  createRoleConfiguration,
  // Legacy exports (for backward compatibility)
  TEST_CONSTANTS,
} from "./test-data"

// Map legacy constants to new ones for backward compatibility
export {
  ROLES as ROLE_CONSTANTS,
  BTC_ADDRESSES as BITCOIN_ADDRESSES,
  ETH_ADDRESSES as ETHEREUM_ADDRESSES,
  AMOUNTS as AMOUNT_CONSTANTS,
  TIMEOUTS as TIMING_CONSTANTS,
  BLOCKCHAIN as BLOCKCHAIN_CONSTANTS,
  GAS_LIMITS as GAS_CONSTANTS,
} from "../../fixtures/constants"

// Export all advanced factory functions from test-factories
export {
  // Advanced scenario factories
  createQCRegistrationScenario,
  createMintingScenario,
  createRedemptionScenario,
  createUndercollateralizationScenario,
  createReserveOracleScenario,
  createDisputeScenario,
  createWalletManagementScenario,
  createSystemStateScenario,
  // Utility functions
  createQCBatch,
  createTimeBasedScenario,
  createIntegrationTestScenario,
} from "./test-factories"

// Re-export base setup utilities from main fixtures
export {
  setupTestSigners,
  createBaseTestEnvironment,
  createEnhancedTestEnvironment,
  restoreTestEnvironment,
  setupRelayForTesting,
  captureContractState,
  validateContractState,
  TestIsolationVerifier,
  handleTestSetupError,
  // Types
  type BaseTestSigners,
  type BridgeTestSigners,
  type AccountControlTestSigners,
  type BaseTestEnvironment,
  type BridgeTestEnvironment,
  type EnhancedTestEnvironment,
  type ContractStateSnapshot,
} from "../../fixtures/base-setup"

// Re-export mock factory utilities from main fixtures  
export {
  TestMockFactory,
  createMockRelay,
  createMockTransactionReceipt,
  createMockContract,
  createMockSigner,
  createMockBitcoinTx,
  type MockConfiguration,
} from "../../fixtures/mock-factory"

// For backward compatibility, re-export TestSigners as AccountControlTestSigners
export { type AccountControlTestSigners as TestSigners } from "../../fixtures/base-setup"

// =============================================================================
// CONVENIENCE IMPORTS
// =============================================================================

/**
 * Most commonly used constants grouped for convenience
 */
export const COMMON_TEST_DATA = {
  // Most used roles
  GOVERNANCE_ROLE:
    "0x71840dc4906352362b0cdaf79870196c8e42acafade72d5d5a6d59291253ceb1",
  DISPUTE_ARBITER_ROLE:
    "0x4c42c6eb7a0c1a6a8f1e4b4d0c5e9e8e2e6e4f8f4c4e8e2e6e4f8f4c4e8e2e6",

  // Most used addresses
  VALID_BTC_ADDRESS: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
  TEST_QC_ADDRESS: "0x1234567890123456789012345678901234567890",

  // Most used amounts
  STANDARD_MINT: "1000000000000000000", // 1 ETH in wei
  REDEMPTION_AMOUNT: "5000000000000000000", // 5 ETH in wei
} as const

/**
 * Quick factory function that creates a minimal test setup
 */
export function createQuickTestSetup() {
  return {
    qcAddress: COMMON_TEST_DATA.TEST_QC_ADDRESS,
    btcAddress: COMMON_TEST_DATA.VALID_BTC_ADDRESS,
    amount: COMMON_TEST_DATA.STANDARD_MINT,
    roles: {
      governance: "0x0000000000000000000000000000000000000001",
      arbiter: "0x0000000000000000000000000000000000000002",
    },
  }
}
