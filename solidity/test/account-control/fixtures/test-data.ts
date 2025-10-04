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
} from "../../fixtures/constants"

/**
 * Test factory functions for account-control tests
 * 
 * This file provides factory functions to create test data objects.
 * All constants have been moved to ./constants.ts
 */

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
    capacity?: BigNumberish
  } = {}
) {
  return {
    qcAddress: overrides.qcAddress || ETH_ADDRESSES.QC_1,
    btcAddress: overrides.btcAddress || BTC_ADDRESSES.BECH32_STANDARD,
    capacity: overrides.capacity || AMOUNTS.MINTING_CAP_100,
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
    amount?: BigNumberish
    redemptionId?: string
  } = {}
) {
  return {
    qcAddress: overrides.qcAddress || ETH_ADDRESSES.QC_1,
    userAddress: overrides.userAddress || ETH_ADDRESSES.QC_2,
    btcAddress: overrides.btcAddress || BTC_ADDRESSES.BECH32_STANDARD,
    amount: overrides.amount || AMOUNTS.REDEMPTION_5_ETH,
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
    governance: overrides.governance || ETH_ADDRESSES.QC_1,
    arbiter: overrides.arbiter || ETH_ADDRESSES.QC_2,
    registrar: overrides.registrar || ETH_ADDRESSES.QC_3,
    watchdog: overrides.watchdog || ETH_ADDRESSES.QC_4,
    pauser: overrides.pauser || ETH_ADDRESSES.QC_5,
    monitor: overrides.monitor || ETH_ADDRESSES.QC_1,
  }
}

/**
 * SPV test configuration
 */
export const spvTestConfig = {
  chainDifficulty: BLOCKCHAIN.DEFAULT_DIFFICULTY,
} as const

/**
 * SPV constants
 */
export const SPV_CONSTANTS = {
  DEFAULT_BLOCK_HEIGHT: BLOCKCHAIN.DEFAULT_DIFFICULTY,
  TEST_BLOCK_HEIGHT: BLOCKCHAIN.TEST_BLOCK_HEIGHT,
  MOCK_TX_HASH: BLOCKCHAIN.MOCK_TX_HASH,
} as const

/**
 * Bitcoin test addresses
 */
export const bitcoinTestAddresses = BTC_ADDRESSES

/**
 * Test constants mapping for validation tests
 * Maps centralized constants to test-specific names
 */
export const TEST_CONSTANTS = {
  // Role constants
  GOVERNANCE_ROLE: ROLES.GOVERNANCE_ROLE,
  DISPUTE_ARBITER_ROLE: ROLES.DISPUTE_ARBITER_ROLE,
  REGISTRAR_ROLE: ROLES.REGISTRAR_ROLE,
  ENFORCEMENT_ROLE: ROLES.ENFORCEMENT_ROLE || ethers.utils.id("ENFORCEMENT_ROLE"),
  MONITOR_ROLE: ROLES.MONITOR_ROLE || ethers.utils.id("MONITOR_ROLE"),
  EMERGENCY_ROLE: ROLES.EMERGENCY_ROLE || ethers.utils.id("EMERGENCY_ROLE"),
  OPERATIONS_ROLE: ROLES.OPERATIONS_ROLE || ethers.utils.id("OPERATIONS_ROLE"),
  MINTER_ROLE: ROLES.MINTER_ROLE || ethers.utils.id("MINTER_ROLE"),
  QC_MANAGER_ROLE: ROLES.QC_MANAGER_ROLE || ethers.utils.id("QC_MANAGER_ROLE"),
  ATTESTER_ROLE: ROLES.ATTESTER_ROLE || ethers.utils.id("ATTESTER_ROLE"),

  // Bitcoin addresses
  VALID_LEGACY_BTC: BTC_ADDRESSES.GENESIS_BLOCK,
  VALID_P2SH_BTC: BTC_ADDRESSES.P2SH_STANDARD,
  VALID_BECH32_BTC: BTC_ADDRESSES.BECH32_STANDARD,
  VALID_P2WSH_BTC: BTC_ADDRESSES.BECH32_P2WSH,

  // Ethereum addresses
  QC_ADDRESS_1: ETH_ADDRESSES.QC_1,
  QC_ADDRESS_2: ETH_ADDRESSES.QC_2,
  QC_ADDRESS_3: ETH_ADDRESSES.QC_3,
  ZERO_ADDRESS: "0x0000000000000000000000000000000000000000",

  // Amounts
  MIN_MINT_AMOUNT: AMOUNTS.ETH_0_001,
  SMALL_MINT_AMOUNT: AMOUNTS.ETH_0_1,
  STANDARD_MINT_AMOUNT: AMOUNTS.ETH_1,
  MEDIUM_CAP: AMOUNTS.ETH_100, // Medium capacity for testing
  LARGE_MINT_AMOUNT: AMOUNTS.ETH_100,
  REDEMPTION_AMOUNT: AMOUNTS.REDEMPTION_5_ETH,
  INITIAL_MINTING_CAPACITY: AMOUNTS.MINTING_CAP_100,

  // Timeouts
  REDEMPTION_TIMEOUT_DEFAULT: TIMEOUTS.REDEMPTION_DEFAULT,
  REDEMPTION_TIMEOUT_SHORT: TIMEOUTS.REDEMPTION_SHORT,
  REDEMPTION_TIMEOUT_TEST: TIMEOUTS.REDEMPTION_24H,
  STALE_THRESHOLD_DEFAULT: TIMEOUTS.ORACLE_STALE_DEFAULT,
  STALE_THRESHOLD_SHORT: TIMEOUTS.ORACLE_STALE_SHORT,
  STALE_THRESHOLD_TEST: TIMEOUTS.ORACLE_STALE_STANDARD,
  ATTESTATION_TIMEOUT: TIMEOUTS.ORACLE_ATTESTATION,

  // Gas limits
  DEPLOYMENT_GAS: GAS_LIMITS.DEPLOYMENT,
  SPV_VALIDATION_GAS: GAS_LIMITS.SPV_VALIDATION,
  SPV_GAS_RANGE: {
    min: GAS_LIMITS.SPV_MIN,
    max: GAS_LIMITS.SPV_MAX,
  },

  // Test aliases
  SMALL_MINT: AMOUNTS.ETH_0_1,
  MEDIUM_MINT: AMOUNTS.ETH_1,
  MEDIUM_CAP: AMOUNTS.ETH_100,
  LARGE_CAP: AMOUNTS.ETH_100,

  // Re-export ROLES
  ROLES,
} as const

