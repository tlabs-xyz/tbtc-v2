import { ethers } from "hardhat"

/**
 * Helper utilities for Account Control testing
 */

/**
 * Creates mock SPV data for testing redemption fulfillment
 * Returns mock BitcoinTx.Info and BitcoinTx.Proof structures
 */
export function createMockSpvData(): {
  txInfo: any
  proof: any
} {
  // Mock BitcoinTx.Info structure
  const txInfo = {
    version: "0x02000000", // Version 2
    inputVector: `0x01${"a".repeat(72)}ffffffff`, // 1 input with mock data
    outputVector: `0x01${"00e1f50500000000"}${"1976a914"}${"b".repeat(40)}88ac`, // 1 output with mock P2PKH script
    locktime: "0x00000000", // No locktime
  }

  // Mock BitcoinTx.Proof structure
  const proof = {
    merkleProof: `0x${"c".repeat(128)}`, // Mock 64-byte merkle proof
    txIndexInBlock: 0,
    bitcoinHeaders: `0x${"d".repeat(160)}`, // Mock 80-byte header
    coinbasePreimage: ethers.utils.id("mock_coinbase"), // Mock coinbase preimage
  }

  return { txInfo, proof }
}

/**
 * Creates a valid Bitcoin address for testing purposes
 */
export const validLegacyBtc = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"

/**
 * Creates mock wallet control proof for wallet registration testing
 */
export function createMockWalletControlProof(
  qcAddress: string,
  btcAddress: string
): {
  txInfo: any
  proof: any
} {
  return createMockSpvData()
}

/**
 * Creates various Bitcoin addresses for testing different formats
 */
export const bitcoinTestAddresses = {
  validP2PKH: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Starts with '1'
  validP2SH: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // Starts with '3'
  validBech32: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Starts with 'bc1'
  invalid: "not_a_bitcoin_address",
  empty: "",
}

/**
 * Helper to generate deterministic test data
 */
export function generateTestId(prefix: string): string {
  return ethers.utils.id(`${prefix}_${Date.now()}`)
}

/**
 * Mock SPV validation result
 */
export function createMockSpvValidationResult(isValid = true) {
  return {
    isValid,
    txHash: ethers.utils.id("mock_tx_hash"),
    blockHeight: 800000,
    confirmations: 6,
  }
}