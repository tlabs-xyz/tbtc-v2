import { ethers } from "hardhat"

/**
 * Centralized Test Constants for Account Control Tests
 *
 * This file consolidates commonly used constants across the test suite
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
  // Time interval boundaries for validation
  MINUTE_1: 60,
  DAYS_7: 604800,
  DAY_1: 86400,

  // Redemption specific timeouts
  REDEMPTION_SHORT: 3600, // 1 hour - for quick tests
  REDEMPTION_24H: 86400, // 24 hours - standard test timeout
  REDEMPTION_DEFAULT: 604800, // 7 days - production default

  // Oracle and attestation timeouts
  ORACLE_ATTESTATION: 21600, // 6 hours
  ORACLE_STALE_SHORT: 1800, // 30 minutes
  ORACLE_STALE_STANDARD: 3600, // 1 hour
  ORACLE_STALE_DEFAULT: 86400, // 24 hours

} as const

// =============================================================================
// AMOUNT CONSTANTS (in wei)
// =============================================================================

/**
 * Standardized amount values used across tests
 * All ETH amounts in wei for precision
 */
export const AMOUNTS = {
  // Small amounts for specific test cases
  ETH_0_001: ethers.utils.parseEther("0.001"), // Micro amount
  ETH_0_1: ethers.utils.parseEther("0.1"), // Tenth of ETH

  // Standard test amounts
  ETH_1: ethers.utils.parseEther("1"), // Standard unit
  ETH_100: ethers.utils.parseEther("100"), // Standard large amount
  ETH_1000000: ethers.utils.parseEther("1000000"), // Maximum validation bound

  // Commonly used specific amounts
  STANDARD_100_ETH: ethers.utils.parseEther("100"), // Most common test amount
  REDEMPTION_5_ETH: ethers.utils.parseEther("5"), // Standard redemption
  MINTING_CAP_100: ethers.utils.parseEther("100"), // Initial minting capacity
  MINTING_CAP_2000: ethers.utils.parseEther("2000"), // Updated capacity

} as const

// =============================================================================
// BITCOIN ADDRESS CONSTANTS
// =============================================================================

/**
 * Standardized Bitcoin addresses for different test scenarios
 * Includes valid addresses of different types for testing
 */
export const BTC_ADDRESSES = {
  // Valid mainnet addresses
  GENESIS_BLOCK: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Genesis block coinbase
  BECH32_STANDARD: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Standard P2WPKH
  BECH32_P2WSH:
    "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3", // P2WSH
  P2SH_STANDARD: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // Standard P2SH

} as const

// =============================================================================
// ETHEREUM ADDRESS CONSTANTS
// =============================================================================

/**
 * Standardized Ethereum addresses for test scenarios
 */
export const ETH_ADDRESSES = {
  // Test QC addresses
  QC_1: "0x1234567890123456789012345678901234567890",
  QC_2: "0x9876543210987654321098765432109876543210",
  QC_3: "0x0000000000000000000000000000000000000001",
  QC_4: "0x0000000000000000000000000000000000000002",
  QC_5: "0x0000000000000000000000000000000000000003",

} as const

// =============================================================================
// ACCESS CONTROL ROLES
// =============================================================================

/**
 * Standardized role constants using consistent hashing
 */
export const ROLES = {
  // System governance roles
  GOVERNANCE_ROLE: ethers.utils.id("GOVERNANCE_ROLE"),

  // Functional roles
  DISPUTE_ARBITER_ROLE: ethers.utils.id("DISPUTE_ARBITER_ROLE"),
  REGISTRAR_ROLE: ethers.utils.id("REGISTRAR_ROLE"),
  ENFORCEMENT_ROLE: ethers.utils.id("ENFORCEMENT_ROLE"),
  MONITOR_ROLE: ethers.utils.id("MONITOR_ROLE"),
  EMERGENCY_ROLE: ethers.utils.id("EMERGENCY_ROLE"),
  OPERATIONS_ROLE: ethers.utils.id("OPERATIONS_ROLE"),
  MINTER_ROLE: ethers.utils.id("MINTER_ROLE"),
  QC_MANAGER_ROLE: ethers.utils.id("QC_MANAGER_ROLE"),
  ATTESTER_ROLE: ethers.utils.id("ATTESTER_ROLE"),
} as const

// =============================================================================
// GAS CONSTANTS
// =============================================================================

/**
 * Standardized gas limits for different operation types
 */
export const GAS_LIMITS = {
  // Deployment
  DEPLOYMENT: 3000000,

  // SPV operations
  SPV_VALIDATION: 1000000,
  SPV_MIN: 200000,
  SPV_MAX: 800000,

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

  // SPV test values
  MOCK_TX_HASH: `0x${"a".repeat(64)}`, // Mock transaction hash
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