import { ethers } from "hardhat"
import type { BytesLike, BigNumberish } from "ethers"
import {
  ROLES,
  BTC_ADDRESSES,
  ETH_ADDRESSES,
  AMOUNTS,
  TIMEOUTS,
  GAS_LIMITS,
  BLOCKCHAIN,
} from "./constants"

/**
 * Centralized test constants and data for account-control tests
 * This consolidates common test values used across multiple test files
 *
 * Note: This file now uses the centralized constants from ./constants.ts
 * while maintaining backward compatibility with existing exports.
 */

// =============================================================================
// ROLE CONSTANTS
// =============================================================================

/**
 * Access control roles used throughout the system
 * @deprecated Use ROLES from constants.ts instead
 */
export const ROLE_CONSTANTS = {
  // Standard OpenZeppelin role
  DEFAULT_ADMIN_ROLE: ROLES.DEFAULT_ADMIN,

  // System-specific roles
  GOVERNANCE_ROLE: ROLES.GOVERNANCE,
  DISPUTE_ARBITER_ROLE: ROLES.DISPUTE_ARBITER,
  REGISTRAR_ROLE: ROLES.REGISTRAR,
  ENFORCEMENT_ROLE: ROLES.ENFORCEMENT,
  MONITOR_ROLE: ROLES.MONITOR,
  EMERGENCY_ROLE: ROLES.EMERGENCY,
  OPERATIONS_ROLE: ROLES.OPERATIONS,

  // Contract-specific roles
  MINTER_ROLE: ROLES.MINTER,
  QC_MANAGER_ROLE: ROLES.QC_MANAGER,
  ATTESTER_ROLE: ROLES.ATTESTER,
} as const

// =============================================================================
// BITCOIN ADDRESSES
// =============================================================================

/**
 * Test Bitcoin addresses for various formats and scenarios
 * @deprecated Use BTC_ADDRESSES from constants.ts instead
 */
export const BITCOIN_ADDRESSES = {
  // Valid addresses for different formats
  VALID_LEGACY_BTC: BTC_ADDRESSES.GENESIS_BLOCK,
  VALID_P2SH_BTC: BTC_ADDRESSES.P2SH_STANDARD,
  VALID_BECH32_BTC: BTC_ADDRESSES.BECH32_STANDARD,
  VALID_P2WSH_BTC: BTC_ADDRESSES.BECH32_P2WSH,

  // Test-specific addresses
  TEST_BTC_ADDRESS_1: BTC_ADDRESSES.TEST_ADDRESS_1,
  TEST_BTC_ADDRESS_2: BTC_ADDRESSES.TEST_ADDRESS_2,
  TEST_BTC_LONG: BTC_ADDRESSES.TEST_LONG,

  // Invalid addresses for negative testing
  INVALID_BTC: BTC_ADDRESSES.INVALID_FORMAT,
  INVALID_SHORT: BTC_ADDRESSES.INVALID_SHORT,
  EMPTY: BTC_ADDRESSES.EMPTY,
} as const

// =============================================================================
// ETHEREUM ADDRESSES
// =============================================================================

/**
 * Test Ethereum addresses for QC and other accounts
 * @deprecated Use ETH_ADDRESSES from constants.ts instead
 */
export const ETHEREUM_ADDRESSES = {
  QC_ADDRESS_1: ETH_ADDRESSES.QC_1,
  QC_ADDRESS_2: ETH_ADDRESSES.QC_2,
  QC_ADDRESS_3: ETH_ADDRESSES.QC_3,
  QC_ADDRESS_4: ETH_ADDRESSES.QC_4,
  QC_ADDRESS_5: ETH_ADDRESSES.QC_5,

  // Special addresses
  ZERO_ADDRESS: ETH_ADDRESSES.ZERO,
} as const

// =============================================================================
// AMOUNT CONSTANTS
// =============================================================================

/**
 * Common amounts used in testing (all in wei/satoshi equivalents)
 * @deprecated Use AMOUNTS from constants.ts instead
 */
export const AMOUNT_CONSTANTS = {
  // Minting amounts
  MIN_MINT_AMOUNT: AMOUNTS.ETH_0_001,
  TEST_MIN_MINT_AMOUNT: AMOUNTS.ETH_0_01,
  SMALL_MINT_AMOUNT: AMOUNTS.ETH_0_1,
  STANDARD_MINT_AMOUNT: AMOUNTS.ETH_1,
  LARGE_MINT_AMOUNT: AMOUNTS.ETH_5,

  // Maximum amounts
  MAX_MINT_AMOUNT: AMOUNTS.ETH_1000,
  TEST_MAX_MINT_AMOUNT: AMOUNTS.ETH_100,
  VERY_LARGE_AMOUNT: AMOUNTS.ETH_1000000,

  // Capacity amounts
  INITIAL_MINTING_CAPACITY: AMOUNTS.MINTING_CAP_100,
  UPDATED_CAPACITY: AMOUNTS.MINTING_CAP_2000,

  // Reserve balances
  RESERVE_BALANCE_LOW: AMOUNTS.RESERVE_LOW,
  RESERVE_BALANCE_STANDARD: AMOUNTS.RESERVE_STANDARD,
  RESERVE_BALANCE_HIGH: AMOUNTS.RESERVE_HIGH,

  // Specific test amounts
  REDEMPTION_AMOUNT: AMOUNTS.REDEMPTION_5_ETH,
  AVAILABLE_CAPACITY: AMOUNTS.ETH_30,
  BALANCE_100: AMOUNTS.ETH_100,
  BALANCE_200: AMOUNTS.ETH_200,
  BALANCE_500: AMOUNTS.ETH_500,
} as const

// =============================================================================
// TIMEOUT AND TIMING CONSTANTS
// =============================================================================

/**
 * Timeout and timing values used in tests
 * @deprecated Use TIMEOUTS from constants.ts instead
 */
export const TIMING_CONSTANTS = {
  // Redemption timeouts
  REDEMPTION_TIMEOUT_DEFAULT: TIMEOUTS.REDEMPTION_DEFAULT,
  REDEMPTION_TIMEOUT_TEST: TIMEOUTS.REDEMPTION_24H,
  REDEMPTION_TIMEOUT_SHORT: TIMEOUTS.REDEMPTION_SHORT,

  // Stale thresholds
  STALE_THRESHOLD_DEFAULT: TIMEOUTS.ORACLE_STALE_DEFAULT,
  STALE_THRESHOLD_TEST: TIMEOUTS.ORACLE_STALE_STANDARD,
  STALE_THRESHOLD_SHORT: TIMEOUTS.ORACLE_STALE_SHORT,

  // Attestation timeouts
  ATTESTATION_TIMEOUT: TIMEOUTS.ORACLE_ATTESTATION,

  // Block advancement for time-based tests
  TIME_ADVANCE_SMALL: TIMEOUTS.ADVANCE_SMALL,
  TIME_ADVANCE_LARGE: TIMEOUTS.ADVANCE_LARGE,
} as const

// =============================================================================
// GAS LIMIT CONSTANTS
// =============================================================================

/**
 * Gas limits for various operations
 * @deprecated Use GAS_LIMITS from constants.ts instead
 */
export const GAS_CONSTANTS = {
  // Standard gas limits for different operations
  DEPLOYMENT_GAS: GAS_LIMITS.DEPLOYMENT,
  SIMPLE_TX_GAS: GAS_LIMITS.SIMPLE_TX,
  COMPLEX_TX_GAS: GAS_LIMITS.COMPLEX_TX,
  SPV_VALIDATION_GAS: GAS_LIMITS.SPV_VALIDATION,

  // Gas ranges for testing
  SPV_GAS_RANGE: {
    min: GAS_LIMITS.SPV_MIN,
    max: GAS_LIMITS.SPV_MAX,
  },
} as const

// =============================================================================
// BLOCKCHAIN CONSTANTS
// =============================================================================

/**
 * Blockchain related constants
 * @deprecated Use BLOCKCHAIN from constants.ts instead
 */
export const BLOCKCHAIN_CONSTANTS = {
  // Bitcoin blockchain difficulty for testing
  DEFAULT_CHAIN_DIFFICULTY: BLOCKCHAIN.DEFAULT_DIFFICULTY,
} as const

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Factory function to create test wallet registration data
 */
export function createTestWalletRegistration(
  overrides: {
    qcAddress?: string
    btcAddress?: string
    capacity?: typeof AMOUNT_CONSTANTS.INITIAL_MINTING_CAPACITY
  } = {}
) {
  return {
    qcAddress: overrides.qcAddress || ETHEREUM_ADDRESSES.QC_ADDRESS_1,
    btcAddress: overrides.btcAddress || BITCOIN_ADDRESSES.VALID_BECH32_BTC,
    capacity: overrides.capacity || AMOUNT_CONSTANTS.INITIAL_MINTING_CAPACITY,
  }
}

/**
 * Factory function to create test redemption scenario data
 */
export function createTestRedemptionScenario(
  overrides: {
    qcAddress?: string
    userAddress?: string
    btcAddress?: string
    amount?: typeof AMOUNT_CONSTANTS.REDEMPTION_AMOUNT
    redemptionId?: string
  } = {}
) {
  return {
    qcAddress: overrides.qcAddress || ETHEREUM_ADDRESSES.QC_ADDRESS_1,
    userAddress: overrides.userAddress || ETHEREUM_ADDRESSES.QC_ADDRESS_2,
    btcAddress: overrides.btcAddress || BITCOIN_ADDRESSES.VALID_BECH32_BTC,
    amount: overrides.amount || AMOUNT_CONSTANTS.REDEMPTION_AMOUNT,
    redemptionId: overrides.redemptionId || ethers.utils.id("test_redemption"),
  }
}

/**
 * Factory function to create mock Bitcoin transaction info
 */
export function createMockBitcoinTxInfo(
  overrides: {
    version?: BytesLike
    inputVector?: BytesLike
    outputVector?: BytesLike
    locktime?: BytesLike
  } = {}
) {
  return {
    version: overrides.version || "0x01000000",
    inputVector:
      overrides.inputVector || `0x01${"00".repeat(36)}00${"00".repeat(4)}`,
    outputVector: overrides.outputVector || `0x01${"00".repeat(8)}00`,
    locktime: overrides.locktime || "0x00000000",
  }
}

/**
 * Factory function to create mock Bitcoin transaction proof
 */
export function createMockBitcoinTxProof(
  overrides: {
    merkleProof?: BytesLike
    txIndexInBlock?: BigNumberish
    bitcoinHeaders?: BytesLike
    coinbasePreimage?: BytesLike
    coinbaseProof?: BytesLike
  } = {}
) {
  return {
    merkleProof:
      overrides.merkleProof ||
      ethers.utils.hexlify(new Uint8Array(32).fill(0xcc)),
    txIndexInBlock: overrides.txIndexInBlock || 0,
    bitcoinHeaders:
      overrides.bitcoinHeaders ||
      ethers.utils.hexlify(new Uint8Array(80).fill(0xdd)),
    coinbasePreimage:
      overrides.coinbasePreimage || ethers.utils.hexZeroPad("0xaabbcc", 32),
    coinbaseProof:
      overrides.coinbaseProof ||
      ethers.utils.hexlify(new Uint8Array(32).fill(0xee)),
  }
}

/**
 * Factory function to generate deterministic test IDs
 */
let testIdCounter = 0
export function generateTestId(prefix: string): string {
  testIdCounter += 1
  return ethers.utils.id(`${prefix}_${testIdCounter}`)
}

/**
 * Factory function to create role grant configuration
 */
export function createRoleConfiguration(
  overrides: {
    governance?: string
    arbiter?: string
    registrar?: string
    watchdog?: string
    pauser?: string
    monitor?: string
  } = {}
) {
  return {
    governance: overrides.governance || ETHEREUM_ADDRESSES.QC_ADDRESS_1,
    arbiter: overrides.arbiter || ETHEREUM_ADDRESSES.QC_ADDRESS_2,
    registrar: overrides.registrar || ETHEREUM_ADDRESSES.QC_ADDRESS_3,
    watchdog: overrides.watchdog || ETHEREUM_ADDRESSES.QC_ADDRESS_4,
    pauser: overrides.pauser || ETHEREUM_ADDRESSES.QC_ADDRESS_5,
    monitor: overrides.monitor || ETHEREUM_ADDRESSES.QC_ADDRESS_1,
  }
}

// =============================================================================
// SPV CONFIGURATION
// =============================================================================

/**
 * SPV test configuration for testing SPV proof validation
 * @deprecated Use BLOCKCHAIN, GAS_LIMITS, and TIMEOUTS from constants.ts instead
 */
export const spvTestConfig = {
  defaultBlockHeight: BLOCKCHAIN.DEFAULT_DIFFICULTY,
  gasLimits: {
    min: GAS_LIMITS.SPV_MIN,
    max: GAS_LIMITS.SPV_MAX,
  },
  timeout: TIMEOUTS.REDEMPTION_24H,
  chainDifficulty: BLOCKCHAIN.DEFAULT_DIFFICULTY, // Add for backward compatibility
} as const

/**
 * SPV constants for testing
 * @deprecated Use BLOCKCHAIN and GAS_LIMITS from constants.ts instead
 */
export const SPV_CONSTANTS = {
  DEFAULT_BLOCK_HEIGHT: BLOCKCHAIN.DEFAULT_DIFFICULTY,
  TEST_BLOCK_HEIGHT: BLOCKCHAIN.TEST_BLOCK_HEIGHT,
  MOCK_TX_HASH: BLOCKCHAIN.MOCK_TX_HASH,
  DEPLOYMENT_GAS: GAS_LIMITS.DEPLOYMENT,
  SIMPLE_TX_GAS: GAS_LIMITS.SIMPLE_TX,
  COMPLEX_TX_GAS: GAS_LIMITS.COMPLEX_TX,
  SPV_VALIDATION_GAS: GAS_LIMITS.SPV_VALIDATION,
  SPV_GAS_RANGE: {
    min: GAS_LIMITS.SPV_MIN,
    max: GAS_LIMITS.SPV_MAX,
  },
} as const

/**
 * Bitcoin test addresses collection
 * @deprecated Use BTC_ADDRESSES from constants.ts instead
 */
export const bitcoinTestAddresses = BTC_ADDRESSES

// =============================================================================
// LEGACY EXPORTS (for backward compatibility)
// =============================================================================

/**
 * Backward compatibility exports
 * These will be phased out in Phase 2
 */
export const TEST_CONSTANTS = {
  // Legacy role constants
  ...ROLE_CONSTANTS,

  // Legacy address constants
  VALID_LEGACY_BTC: BITCOIN_ADDRESSES.VALID_LEGACY_BTC,
  VALID_P2SH_BTC: BITCOIN_ADDRESSES.VALID_P2SH_BTC,
  VALID_BECH32_BTC: BITCOIN_ADDRESSES.VALID_BECH32_BTC,

  // Legacy amount constants
  SMALL_MINT: AMOUNT_CONSTANTS.SMALL_MINT_AMOUNT,
  STANDARD_MINT: AMOUNT_CONSTANTS.STANDARD_MINT_AMOUNT,
  LARGE_MINT: AMOUNT_CONSTANTS.LARGE_MINT_AMOUNT,

  // Legacy blockchain constants
  DEFAULT_CHAIN_DIFFICULTY: BLOCKCHAIN_CONSTANTS.DEFAULT_CHAIN_DIFFICULTY,
  DEFAULT_BLOCK_HEIGHT: BLOCKCHAIN_CONSTANTS.DEFAULT_CHAIN_DIFFICULTY,
} as const
