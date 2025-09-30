import { ethers } from "hardhat"
import type { BytesLike, BigNumberish } from "ethers"

/**
 * Centralized test constants and data for account-control tests
 * This consolidates common test values used across multiple test files
 */

// =============================================================================
// ROLE CONSTANTS
// =============================================================================

/**
 * Access control roles used throughout the system
 */
export const ROLE_CONSTANTS = {
  // Standard OpenZeppelin role
  DEFAULT_ADMIN_ROLE: ethers.constants.HashZero,

  // System-specific roles
  GOVERNANCE_ROLE: ethers.utils.id("GOVERNANCE_ROLE"),
  DISPUTE_ARBITER_ROLE: ethers.utils.id("DISPUTE_ARBITER_ROLE"),
  REGISTRAR_ROLE: ethers.utils.id("REGISTRAR_ROLE"),
  ENFORCEMENT_ROLE: ethers.utils.id("ENFORCEMENT_ROLE"),
  MONITOR_ROLE: ethers.utils.id("MONITOR_ROLE"),
  EMERGENCY_ROLE: ethers.utils.id("EMERGENCY_ROLE"),
  OPERATIONS_ROLE: ethers.utils.id("OPERATIONS_ROLE"),

  // Contract-specific roles
  MINTER_ROLE: ethers.utils.id("MINTER_ROLE"),
  QC_MANAGER_ROLE: ethers.utils.id("QC_MANAGER_ROLE"),
  ATTESTER_ROLE: ethers.utils.id("ATTESTER_ROLE"),
} as const

// =============================================================================
// BITCOIN ADDRESSES
// =============================================================================

/**
 * Test Bitcoin addresses for various formats and scenarios
 */
export const BITCOIN_ADDRESSES = {
  // Valid addresses for different formats
  VALID_LEGACY_BTC: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Genesis block address
  VALID_P2SH_BTC: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // P2SH address
  VALID_BECH32_BTC: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Common test bech32
  VALID_P2WSH_BTC: "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3", // P2WSH from BIP173

  // Test-specific addresses
  TEST_BTC_ADDRESS_1: "bc1qtest123456789",
  TEST_BTC_ADDRESS_2: "bc1qtest987654321",
  TEST_BTC_LONG: "bc1q" + "a".repeat(60), // Very long but valid format

  // Invalid addresses for negative testing
  INVALID_BTC: "not_a_bitcoin_address",
  INVALID_SHORT: "bc1q",
  EMPTY: "",
} as const

// =============================================================================
// ETHEREUM ADDRESSES
// =============================================================================

/**
 * Test Ethereum addresses for QC and other accounts
 */
export const ETHEREUM_ADDRESSES = {
  QC_ADDRESS_1: "0x1234567890123456789012345678901234567890",
  QC_ADDRESS_2: "0x9876543210987654321098765432109876543210",
  QC_ADDRESS_3: "0x0000000000000000000000000000000000000001",
  QC_ADDRESS_4: "0x0000000000000000000000000000000000000002",
  QC_ADDRESS_5: "0x0000000000000000000000000000000000000003",

  // Special addresses
  ZERO_ADDRESS: ethers.constants.AddressZero,
} as const

// =============================================================================
// AMOUNT CONSTANTS
// =============================================================================

/**
 * Common amounts used in testing (all in wei/satoshi equivalents)
 */
export const AMOUNT_CONSTANTS = {
  // Minting amounts
  MIN_MINT_AMOUNT: ethers.utils.parseEther("0.001"), // Default minimum
  TEST_MIN_MINT_AMOUNT: ethers.utils.parseEther("0.01"), // Test minimum
  SMALL_MINT_AMOUNT: ethers.utils.parseEther("0.1"),
  STANDARD_MINT_AMOUNT: ethers.utils.parseEther("1"),
  LARGE_MINT_AMOUNT: ethers.utils.parseEther("5"),

  // Maximum amounts
  MAX_MINT_AMOUNT: ethers.utils.parseEther("1000"), // Default maximum
  TEST_MAX_MINT_AMOUNT: ethers.utils.parseEther("100"), // Test maximum
  VERY_LARGE_AMOUNT: ethers.utils.parseEther("1000000"),

  // Capacity amounts
  INITIAL_MINTING_CAPACITY: ethers.utils.parseEther("100"),
  UPDATED_CAPACITY: ethers.utils.parseEther("2000"),

  // Reserve balances
  RESERVE_BALANCE_LOW: ethers.utils.parseEther("9"),
  RESERVE_BALANCE_STANDARD: ethers.utils.parseEther("10"),
  RESERVE_BALANCE_HIGH: ethers.utils.parseEther("100"),

  // Specific test amounts
  REDEMPTION_AMOUNT: ethers.utils.parseEther("5"),
  AVAILABLE_CAPACITY: ethers.utils.parseEther("30"),
  BALANCE_100: ethers.utils.parseEther("100"),
  BALANCE_200: ethers.utils.parseEther("200"),
  BALANCE_500: ethers.utils.parseEther("500"),
} as const

// =============================================================================
// TIMEOUT AND TIMING CONSTANTS
// =============================================================================

/**
 * Timeout and timing values used in tests
 */
export const TIMING_CONSTANTS = {
  // Redemption timeouts
  REDEMPTION_TIMEOUT_DEFAULT: 604800, // 7 days in seconds
  REDEMPTION_TIMEOUT_TEST: 86400, // 24 hours in seconds
  REDEMPTION_TIMEOUT_SHORT: 3600, // 1 hour in seconds

  // Stale thresholds
  STALE_THRESHOLD_DEFAULT: 86400, // 24 hours in seconds
  STALE_THRESHOLD_TEST: 3600, // 1 hour in seconds
  STALE_THRESHOLD_SHORT: 1800, // 30 minutes in seconds

  // Attestation timeouts
  ATTESTATION_TIMEOUT: 21600, // 6 hours in seconds

  // Block advancement for time-based tests
  TIME_ADVANCE_SMALL: 3700, // Just over 1 hour
  TIME_ADVANCE_LARGE: 25200, // 7 hours
} as const

// =============================================================================
// SPV AND PROOF CONSTANTS
// =============================================================================

/**
 * SPV-related constants and test data
 */
export const SPV_CONSTANTS = {
  // Chain difficulty values
  DEFAULT_CHAIN_DIFFICULTY: 0x1a00ffff,
  TEST_CHAIN_DIFFICULTY: 0x1a00ffff,

  // Block heights and confirmations
  TEST_BLOCK_HEIGHT: 800000,
  TEST_CONFIRMATIONS: 6,

  // Mock hash values (32 bytes each)
  MOCK_TX_HASH: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  MOCK_TX_HASH_2: "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe",
  MOCK_TX_HASH_3: "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd",

  // Test reason hashes
  TEST_REASON: ethers.utils.id("TEST_REASON"),
} as const

// =============================================================================
// GAS LIMIT CONSTANTS
// =============================================================================

/**
 * Gas limits for various operations
 */
export const GAS_CONSTANTS = {
  // Standard gas limits for different operations
  DEPLOYMENT_GAS: 3000000,
  SIMPLE_TX_GAS: 100000,
  COMPLEX_TX_GAS: 500000,
  SPV_VALIDATION_GAS: 1000000,

  // Gas ranges for testing
  SPV_GAS_RANGE: {
    min: 200000,
    max: 800000,
  },
} as const

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Factory function to create test wallet registration data
 */
export function createTestWalletRegistration(overrides: {
  qcAddress?: string
  btcAddress?: string
  capacity?: typeof AMOUNT_CONSTANTS.INITIAL_MINTING_CAPACITY
} = {}) {
  return {
    qcAddress: overrides.qcAddress || ETHEREUM_ADDRESSES.QC_ADDRESS_1,
    btcAddress: overrides.btcAddress || BITCOIN_ADDRESSES.VALID_BECH32_BTC,
    capacity: overrides.capacity || AMOUNT_CONSTANTS.INITIAL_MINTING_CAPACITY,
  }
}

/**
 * Factory function to create test redemption scenario data
 */
export function createTestRedemptionScenario(overrides: {
  qcAddress?: string
  userAddress?: string
  btcAddress?: string
  amount?: typeof AMOUNT_CONSTANTS.REDEMPTION_AMOUNT
  redemptionId?: string
} = {}) {
  return {
    qcAddress: overrides.qcAddress || ETHEREUM_ADDRESSES.QC_ADDRESS_1,
    userAddress: overrides.userAddress || ETHEREUM_ADDRESSES.QC_ADDRESS_2,
    btcAddress: overrides.btcAddress || BITCOIN_ADDRESSES.VALID_BECH32_BTC,
    amount: overrides.amount || AMOUNT_CONSTANTS.REDEMPTION_AMOUNT,
    redemptionId: overrides.redemptionId || ethers.utils.id("test_redemption"),
  }
}

/**
 * Factory function to create test SPV proof structure
 */
export function createTestSPVProof(overrides: {
  isValid?: boolean
  txHash?: string
  blockHeight?: number
  confirmations?: number
} = {}) {
  return {
    isValid: overrides.isValid ?? true,
    txHash: overrides.txHash || SPV_CONSTANTS.MOCK_TX_HASH,
    blockHeight: overrides.blockHeight || SPV_CONSTANTS.TEST_BLOCK_HEIGHT,
    confirmations: overrides.confirmations || SPV_CONSTANTS.TEST_CONFIRMATIONS,
  }
}

/**
 * Factory function to create mock Bitcoin transaction info
 */
export function createMockBitcoinTxInfo(overrides: {
  version?: BytesLike
  inputVector?: BytesLike
  outputVector?: BytesLike
  locktime?: BytesLike
} = {}) {
  return {
    version: overrides.version || "0x01000000",
    inputVector: overrides.inputVector || `0x01${"00".repeat(36)}00${"00".repeat(4)}`,
    outputVector: overrides.outputVector || `0x01${"00".repeat(8)}00`,
    locktime: overrides.locktime || "0x00000000",
  }
}

/**
 * Factory function to create mock Bitcoin transaction proof
 */
export function createMockBitcoinTxProof(overrides: {
  merkleProof?: BytesLike
  txIndexInBlock?: BigNumberish
  bitcoinHeaders?: BytesLike
  coinbasePreimage?: BytesLike
  coinbaseProof?: BytesLike
} = {}) {
  return {
    merkleProof: overrides.merkleProof || ethers.utils.hexlify(new Uint8Array(32).fill(0xcc)),
    txIndexInBlock: overrides.txIndexInBlock || 0,
    bitcoinHeaders: overrides.bitcoinHeaders || ethers.utils.hexlify(new Uint8Array(80).fill(0xdd)),
    coinbasePreimage: overrides.coinbasePreimage || ethers.utils.hexZeroPad("0xaabbcc", 32),
    coinbaseProof: overrides.coinbaseProof || ethers.utils.hexlify(new Uint8Array(32).fill(0xee)),
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
export function createRoleConfiguration(overrides: {
  governance?: string
  arbiter?: string
  registrar?: string
  watchdog?: string
  pauser?: string
  monitor?: string
} = {}) {
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
} as const

// All constants are already exported above, no need to re-export