import { ethers } from "hardhat"

/**
 * Centralized Test Constants for Account Control Tests
 *
 * This file consolidates all commonly used constants across the test suite
 * to reduce duplication and improve maintainability.
 *
 * Usage:
 * ```typescript
 * import { TIMEOUTS, AMOUNTS, BTC_ADDRESSES } from "../fixtures/constants"
 *
 * const timeout = TIMEOUTS.REDEMPTION_24H
 * const amount = AMOUNTS.STANDARD_100_ETH
 * const address = BTC_ADDRESSES.GENESIS_BLOCK
 * ```
 */

// =============================================================================
// TIMEOUT CONSTANTS (in seconds)
// =============================================================================

/**
 * Standardized timeout values used across tests
 * All values in seconds for consistency
 */
export const TIMEOUTS = {
  // Common time intervals
  MINUTE_1: 60,
  MINUTES_30: 1800,
  HOUR_1: 3600,
  HOURS_2: 7200,
  HOURS_6: 21600,
  HOURS_7: 25200,
  DAY_1: 86400,
  DAYS_7: 604800,

  // Redemption specific timeouts
  REDEMPTION_SHORT: 3600, // 1 hour - for quick tests
  REDEMPTION_24H: 86400, // 24 hours - standard test timeout
  REDEMPTION_DEFAULT: 604800, // 7 days - production default

  // Oracle and attestation timeouts
  ORACLE_ATTESTATION: 21600, // 6 hours
  ORACLE_STALE_SHORT: 1800, // 30 minutes
  ORACLE_STALE_STANDARD: 3600, // 1 hour
  ORACLE_STALE_DEFAULT: 86400, // 24 hours

  // System timeouts
  PAUSE_TIMEOUT: 86400, // 24 hours
  SELF_PAUSE_TIMEOUT: 172800, // 48 hours

  // Test advancement values
  ADVANCE_SMALL: 3700, // Just over 1 hour
  ADVANCE_LARGE: 25200, // 7 hours
} as const

// =============================================================================
// AMOUNT CONSTANTS (in wei/gwei)
// =============================================================================

/**
 * Standardized amount values used across tests
 * All ETH amounts in wei for precision
 */
export const AMOUNTS = {
  // Zero and minimal amounts
  ZERO: ethers.constants.Zero,
  WEI_1: ethers.BigNumber.from(1),
  GWEI_1: ethers.utils.parseUnits("1", "gwei"),

  // Small amounts (< 1 ETH)
  ETH_0_001: ethers.utils.parseEther("0.001"), // Micro amount
  ETH_0_01: ethers.utils.parseEther("0.01"), // Small test amount
  ETH_0_1: ethers.utils.parseEther("0.1"), // Tenth of ETH

  // Standard amounts (1-10 ETH)
  ETH_1: ethers.utils.parseEther("1"), // Standard unit
  ETH_5: ethers.utils.parseEther("5"), // Common test amount
  ETH_10: ethers.utils.parseEther("10"), // Medium capacity

  // Large amounts (10-1000 ETH)
  ETH_30: ethers.utils.parseEther("30"), // Available capacity test
  ETH_100: ethers.utils.parseEther("100"), // Standard large amount
  ETH_200: ethers.utils.parseEther("200"), // Balance test amount
  ETH_500: ethers.utils.parseEther("500"), // High balance test
  ETH_1000: ethers.utils.parseEther("1000"), // Maximum test amount

  // Very large amounts (> 1000 ETH)
  ETH_2000: ethers.utils.parseEther("2000"), // Updated capacity
  ETH_10000: ethers.utils.parseEther("10000"), // Stress test amount
  ETH_1000000: ethers.utils.parseEther("1000000"), // Maximum possible

  // Commonly used specific amounts
  STANDARD_100_ETH: ethers.utils.parseEther("100"), // Most common test amount
  REDEMPTION_5_ETH: ethers.utils.parseEther("5"), // Standard redemption
  MINTING_CAP_100: ethers.utils.parseEther("100"), // Initial minting capacity
  MINTING_CAP_2000: ethers.utils.parseEther("2000"), // Updated capacity

  // Reserve balance test amounts
  RESERVE_LOW: ethers.utils.parseEther("9"), // Below threshold
  RESERVE_STANDARD: ethers.utils.parseEther("10"), // At threshold
  RESERVE_HIGH: ethers.utils.parseEther("100"), // Well above threshold
} as const

// =============================================================================
// BITCOIN ADDRESS CONSTANTS
// =============================================================================

/**
 * Standardized Bitcoin addresses for different test scenarios
 * Includes valid addresses of different types and invalid addresses for negative testing
 */
export const BTC_ADDRESSES = {
  // Valid mainnet addresses
  GENESIS_BLOCK: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Genesis block coinbase
  BECH32_STANDARD: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Standard P2WPKH
  BECH32_P2WSH:
    "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3", // P2WSH
  P2SH_STANDARD: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // Standard P2SH

  // Test addresses
  TEST_ADDRESS_1: "bc1qtest123456789", // Short test address
  TEST_ADDRESS_2: "bc1qtest987654321", // Alternative test address
  TEST_LONG: `bc1q${"a".repeat(60)}`, // Very long valid format

  // Invalid addresses for negative testing
  INVALID_FORMAT: "not_a_bitcoin_address", // Completely invalid format
  INVALID_SHORT: "bc1q", // Too short
  INVALID_BECH32: "bc1qinvalid", // Invalid bech32
  INVALID_P2PKH: "1InvalidAddress", // Invalid P2PKH format
  EMPTY: "", // Empty string
} as const

// =============================================================================
// ETHEREUM ADDRESS CONSTANTS
// =============================================================================

/**
 * Standardized Ethereum addresses for test scenarios
 */
export const ETH_ADDRESSES = {
  // Zero address
  ZERO: ethers.constants.AddressZero,

  // Test QC addresses
  QC_1: "0x1234567890123456789012345678901234567890",
  QC_2: "0x9876543210987654321098765432109876543210",
  QC_3: "0x0000000000000000000000000000000000000001",
  QC_4: "0x0000000000000000000000000000000000000002",
  QC_5: "0x0000000000000000000000000000000000000003",

  // Role-specific test addresses
  GOVERNANCE: "0x0000000000000000000000000000000000000001",
  ARBITER: "0x0000000000000000000000000000000000000002",
  REGISTRAR: "0x0000000000000000000000000000000000000003",
  WATCHDOG: "0x0000000000000000000000000000000000000004",
  MONITOR: "0x0000000000000000000000000000000000000005",
} as const

// =============================================================================
// ACCESS CONTROL ROLES
// =============================================================================

/**
 * Standardized role constants using consistent hashing
 */
export const ROLES = {
  // OpenZeppelin standard
  DEFAULT_ADMIN: ethers.constants.HashZero,

  // System governance roles
  GOVERNANCE: ethers.utils.id("GOVERNANCE_ROLE"),
  EMERGENCY: ethers.utils.id("EMERGENCY_ROLE"),
  OPERATIONS: ethers.utils.id("OPERATIONS_ROLE"),

  // Functional roles
  DISPUTE_ARBITER: ethers.utils.id("DISPUTE_ARBITER_ROLE"),
  REGISTRAR: ethers.utils.id("REGISTRAR_ROLE"),
  ENFORCEMENT: ethers.utils.id("ENFORCEMENT_ROLE"),
  MONITOR: ethers.utils.id("MONITOR_ROLE"),
  ATTESTER: ethers.utils.id("ATTESTER_ROLE"),

  // Contract-specific roles
  MINTER: ethers.utils.id("MINTER_ROLE"),
  QC_MANAGER: ethers.utils.id("QC_MANAGER_ROLE"),
  PAUSER: ethers.utils.id("PAUSER_ROLE"),
} as const

// =============================================================================
// GAS CONSTANTS
// =============================================================================

/**
 * Standardized gas limits for different operation types
 */
export const GAS_LIMITS = {
  // Basic operations
  SIMPLE_TX: 100000,
  COMPLEX_TX: 500000,
  DEPLOYMENT: 3000000,

  // SPV operations
  SPV_VALIDATION: 1000000,
  SPV_MIN: 200000,
  SPV_MAX: 800000,

  // Contract interactions
  MINT_OPERATION: 300000,
  REDEEM_OPERATION: 400000,
  WALLET_REGISTRATION: 250000,
} as const

// =============================================================================
// ERROR MESSAGES
// =============================================================================

/**
 * Standardized error messages used across tests
 */
export const ERROR_MESSAGES = {
  // Access control
  NOT_AUTHORIZED: "Not authorized",
  ONLY_GOVERNANCE: "Only governance",
  ONLY_WATCHDOG: "Only watchdog",
  ONLY_ARBITER: "Only arbiter",

  // Parameter validation
  ZERO_ADDRESS: "Zero address",
  INVALID_ADDRESS: "Invalid address",
  INVALID_AMOUNT: "Invalid amount",
  INSUFFICIENT_AMOUNT: "Insufficient amount",

  // Wallet management
  WALLET_NOT_REGISTERED: "Wallet not registered",
  WALLET_ALREADY_REGISTERED: "Wallet already registered",
  UNAUTHORIZED_WALLET_ACCESS: "Unauthorized wallet access",
  INVALID_WALLET_PROOF: "Invalid wallet control proof",

  // Redemption operations
  REDEMPTION_NOT_FOUND: "Redemption not found",
  REDEMPTION_ALREADY_FULFILLED: "Redemption already fulfilled",
  REDEMPTION_TIMEOUT: "Redemption timed out",
  PAYMENT_VERIFICATION_FAILED: "Payment verification failed",

  // System state
  SYSTEM_PAUSED: "System is paused",
  ORACLE_STALE: "Oracle data is stale",
  INSUFFICIENT_RESERVES: "Insufficient reserves",
} as const

// =============================================================================
// BLOCKCHAIN CONSTANTS
// =============================================================================

/**
 * Blockchain-specific constants
 */
export const BLOCKCHAIN = {
  // Bitcoin difficulty for testing
  DEFAULT_DIFFICULTY: 1000000,
  TEST_DIFFICULTY: 100000,

  // Block advancement
  BLOCKS_PER_HOUR: 6, // Approximation for Ethereum
  BLOCKS_PER_DAY: 144, // Approximation for Bitcoin

  // Chain IDs for testing
  ETHEREUM_MAINNET: 1,
  ETHEREUM_GOERLI: 5,
  ETHEREUM_SEPOLIA: 11155111,

  // SPV test values
  TEST_BLOCK_HEIGHT: 700000, // Typical Bitcoin mainnet height for testing
  MOCK_TX_HASH: `0x${"a".repeat(64)}`, // Mock transaction hash
} as const

// =============================================================================
// PERCENTAGE CONSTANTS
// =============================================================================

/**
 * Percentage values for various calculations
 */
export const PERCENTAGES = {
  // Common percentages as basis points (10000 = 100%)
  PERCENT_1: 100, // 1%
  PERCENT_5: 500, // 5%
  PERCENT_10: 1000, // 10%
  PERCENT_25: 2500, // 25%
  PERCENT_50: 5000, // 50%
  PERCENT_100: 10000, // 100%

  // Reserve ratios
  RESERVE_RATIO_LOW: 900, // 9%
  RESERVE_RATIO_STANDARD: 1000, // 10%
  RESERVE_RATIO_HIGH: 1500, // 15%
} as const

// =============================================================================
// CONVENIENCE GROUPINGS
// =============================================================================

/**
 * Grouped constants for common test scenarios
 */
export const COMMON_TEST_VALUES = {
  // Most frequently used timeout
  DEFAULT_TIMEOUT: TIMEOUTS.DAY_1,

  // Most frequently used amount
  DEFAULT_AMOUNT: AMOUNTS.STANDARD_100_ETH,

  // Most frequently used Bitcoin address
  DEFAULT_BTC_ADDRESS: BTC_ADDRESSES.BECH32_STANDARD,

  // Most frequently used Ethereum address
  DEFAULT_ETH_ADDRESS: ETH_ADDRESSES.QC_1,

  // Most frequently used role
  DEFAULT_ROLE: ROLES.GOVERNANCE,
} as const

// =============================================================================
// TEST SCENARIO PRESETS
// =============================================================================

/**
 * Pre-configured test scenarios with commonly used combinations
 */
export const TEST_SCENARIOS = {
  MINIMAL_REDEMPTION: {
    amount: AMOUNTS.ETH_1,
    timeout: TIMEOUTS.REDEMPTION_SHORT,
    btcAddress: BTC_ADDRESSES.BECH32_STANDARD,
  },

  STANDARD_REDEMPTION: {
    amount: AMOUNTS.REDEMPTION_5_ETH,
    timeout: TIMEOUTS.REDEMPTION_24H,
    btcAddress: BTC_ADDRESSES.BECH32_STANDARD,
  },

  LARGE_REDEMPTION: {
    amount: AMOUNTS.ETH_100,
    timeout: TIMEOUTS.REDEMPTION_DEFAULT,
    btcAddress: BTC_ADDRESSES.BECH32_STANDARD,
  },

  QC_REGISTRATION: {
    capacity: AMOUNTS.MINTING_CAP_100,
    qcAddress: ETH_ADDRESSES.QC_1,
    btcAddress: BTC_ADDRESSES.BECH32_STANDARD,
  },

  HIGH_CAPACITY_QC: {
    capacity: AMOUNTS.MINTING_CAP_2000,
    qcAddress: ETH_ADDRESSES.QC_1,
    btcAddress: BTC_ADDRESSES.BECH32_STANDARD,
  },
} as const

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Helper functions for common validations
 */
export const VALIDATION = {
  /**
   * Check if an amount is within expected ranges
   */
  isValidAmount: (amount: any) => {
    const bn = ethers.BigNumber.from(amount)
    return bn.gt(0) && bn.lte(AMOUNTS.ETH_1000000)
  },

  /**
   * Check if timeout is within reasonable bounds
   */
  isValidTimeout: (timeout: number) =>
    timeout >= TIMEOUTS.MINUTE_1 && timeout <= TIMEOUTS.DAYS_7,

  /**
   * Check if address looks like a valid Bitcoin address
   */
  isValidBitcoinAddressFormat: (address: string) =>
    (address.startsWith("1") ||
      address.startsWith("3") ||
      address.startsWith("bc1")) &&
    address.length >= 26,
} as const

// =============================================================================
// EXPORT GROUPS FOR CONVENIENCE
// =============================================================================

/**
 * Export common constant groups for easier importing
 */
export const TIME = TIMEOUTS
export const MONEY = AMOUNTS
export const BITCOIN = BTC_ADDRESSES
export const ETHEREUM = ETH_ADDRESSES
export const ACCESS = ROLES
export const ERRORS = ERROR_MESSAGES
export const GAS = GAS_LIMITS
export const CHAIN = BLOCKCHAIN
export const PERCENT = PERCENTAGES
export const COMMON = COMMON_TEST_VALUES
export const SCENARIOS = TEST_SCENARIOS

/**
 * Default exports for backward compatibility
 */
export default {
  TIMEOUTS,
  AMOUNTS,
  BTC_ADDRESSES,
  ETH_ADDRESSES,
  ROLES,
  GAS_LIMITS,
  ERROR_MESSAGES,
  BLOCKCHAIN,
  PERCENTAGES,
  COMMON_TEST_VALUES,
  TEST_SCENARIOS,
  VALIDATION,
}
