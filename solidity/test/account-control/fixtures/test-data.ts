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
 * SPV test configuration for backward compatibility
 * @deprecated Import BLOCKCHAIN, GAS_LIMITS, and TIMEOUTS directly from constants.ts
 */
export const spvTestConfig = {
  chainDifficulty: BLOCKCHAIN.DEFAULT_DIFFICULTY,
} as const

/**
 * SPV constants for backward compatibility
 * @deprecated Import BLOCKCHAIN and GAS_LIMITS directly from constants.ts
 */
export const SPV_CONSTANTS = {
  DEFAULT_BLOCK_HEIGHT: BLOCKCHAIN.DEFAULT_DIFFICULTY,
  TEST_BLOCK_HEIGHT: BLOCKCHAIN.TEST_BLOCK_HEIGHT,
  MOCK_TX_HASH: BLOCKCHAIN.MOCK_TX_HASH,
} as const

/**
 * Bitcoin test addresses for backward compatibility
 * @deprecated Import BTC_ADDRESSES directly from constants.ts
 */
export const bitcoinTestAddresses = BTC_ADDRESSES

/**
 * Minimal backward compatibility exports
 * @deprecated Import directly from constants.ts instead
 * These exports will be removed in the next major version
 */
export const TEST_CONSTANTS = {
  // Role constants
  GOVERNANCE_ROLE: ROLES.GOVERNANCE,
  
  // Bitcoin addresses
  VALID_LEGACY_BTC: BTC_ADDRESSES.GENESIS_BLOCK,
  VALID_BECH32_BTC: BTC_ADDRESSES.BECH32_STANDARD,
  
  // Amounts
  SMALL_MINT: AMOUNTS.ETH_0_1,
  
  // Re-export ROLES for compatibility
  ROLES,
} as const

