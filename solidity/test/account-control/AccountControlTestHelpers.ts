import { ethers } from "hardhat"

/**
 * Helper utilities for Account Control testing
 */

/**
 * Creates mock SPV data for testing redemption fulfillment
 * Returns mock BitcoinTx.Info and BitcoinTx.Proof structures matching the contract types
 */
export function createMockSpvData(): {
  txInfo: any
  proof: any
} {
  // Mock BitcoinTx.Info structure - matches struct in BitcoinTx.sol with valid Bitcoin format
  const txInfo = {
    version: "0x01000000", // bytes4 - Version 1 (little endian)
    inputVector: `0x01${"00".repeat(36)}00${"00".repeat(4)}`, // bytes - 1 input: 36 byte outpoint + 0 script length + 4 byte sequence
    outputVector: `0x01${"00".repeat(8)}00`, // bytes - 1 output: 8 byte value + 0 script length
    locktime: "0x00000000", // bytes4 - No locktime
  }

  // Mock BitcoinTx.Proof structure - matches struct in BitcoinTx.sol
  const proof = {
    merkleProof: ethers.utils.hexlify(new Uint8Array(32).fill(0xcc)), // bytes - Mock 32-byte merkle proof
    txIndexInBlock: 0, // uint256 - Transaction index
    bitcoinHeaders: ethers.utils.hexlify(new Uint8Array(80).fill(0xdd)), // bytes - Mock 80-byte header
    coinbasePreimage: ethers.utils.hexZeroPad("0xaabbcc", 32), // bytes32 - Mock coinbase preimage
    coinbaseProof: ethers.utils.hexlify(new Uint8Array(32).fill(0xee)), // bytes - Mock coinbase proof
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
