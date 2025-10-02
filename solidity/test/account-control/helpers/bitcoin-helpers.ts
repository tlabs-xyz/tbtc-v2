import { ethers } from "hardhat"
import type { BytesLike } from "ethers"
import { bitcoinTestAddresses, TEST_CONSTANTS } from "../fixtures/test-data"

/**
 * Bitcoin address and transaction utilities for testing
 * Provides standardized methods for Bitcoin-related operations
 */

/**
 * Creates a Bitcoin address from a public key hash for testing
 */
export function createP2PKHAddress(pubKeyHash: string): string {
  // Remove 0x prefix if present
  const cleanHash = pubKeyHash.startsWith("0x")
    ? pubKeyHash.slice(2)
    : pubKeyHash

  // For testnet, use prefix 'tb1' for witness addresses or 'm/n' for legacy
  // For mainnet, use 'bc1' for witness or '1' for legacy
  // This is a simplified version - real implementation would use proper encoding
  return `bc1q${cleanHash}`
}

/**
 * Validates if a string is a properly formatted Bitcoin address
 */
export function isValidBitcoinAddress(address: string): boolean {
  if (!address || typeof address !== "string") {
    return false
  }

  // Basic validation patterns for different address types
  const patterns = {
    legacy: /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
    segwit: /^bc1[a-z0-9]{39,59}$/,
    testnet: /^[2mn][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
    testnetSegwit: /^tb1[a-z0-9]{39,59}$/,
  }

  return Object.values(patterns).some((pattern) => pattern.test(address))
}

/**
 * Gets test Bitcoin addresses for different formats
 */
export function getTestBitcoinAddresses() {
  return bitcoinTestAddresses
}

/**
 * Creates a deterministic Bitcoin address for testing
 */
export function createTestBitcoinAddress(
  seed: string,
  type: "legacy" | "segwit" = "legacy"
): string {
  const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(seed))
  const shortHash = hash.slice(2, 42) // 20 bytes

  if (type === "segwit") {
    return `bc1q${shortHash}`
  }
  // Simplified legacy address generation (not real Base58Check)
  return `1${shortHash.substring(0, 33)}`
}

/**
 * Extracts address type from Bitcoin address
 */
export function getBitcoinAddressType(
  address: string
): "legacy" | "p2sh" | "segwit" | "unknown" {
  if (!address) return "unknown"

  if (address.startsWith("1")) return "legacy"
  if (address.startsWith("3")) return "p2sh"
  if (address.startsWith("bc1")) return "segwit"

  return "unknown"
}

/**
 * Creates mock Bitcoin transaction output script
 */
export function createBitcoinOutputScript(
  address: string,
  amount: number
): string {
  const addressType = getBitcoinAddressType(address)

  switch (addressType) {
    case "legacy":
      // P2PKH script: OP_DUP OP_HASH160 <pubkey_hash> OP_EQUALVERIFY OP_CHECKSIG
      return `76a914${address.slice(1, 41)}88ac`
    case "p2sh":
      // P2SH script: OP_HASH160 <script_hash> OP_EQUAL
      return `a914${address.slice(1, 41)}87`
    case "segwit":
      // P2WPKH script: OP_0 <pubkey_hash>
      return `0014${address.slice(4, 44)}`
    default:
      return "00" // Empty script for unknown types
  }
}

/**
 * Creates a complete Bitcoin output for testing
 */
export function createBitcoinOutput(
  address: string,
  amount: number
): {
  value: string
  script: string
} {
  // Convert amount to 8-byte little-endian hex
  const valueHex = ethers.utils.hexZeroPad(
    ethers.BigNumber.from(amount).toHexString(),
    8
  )

  // Reverse bytes for little-endian
  const reversedValue = valueHex.match(/../g).reverse().join("")

  return {
    value: reversedValue,
    script: createBitcoinOutputScript(address, amount),
  }
}

/**
 * Creates a Bitcoin output vector for multiple outputs
 */
export function createBitcoinOutputVector(
  outputs: Array<{ address: string; amount: number }>
): string {
  const outputCount = ethers.utils
    .hexZeroPad(ethers.BigNumber.from(outputs.length).toHexString(), 1)
    .slice(2) // Remove 0x prefix

  const outputData = outputs
    .map((output) => {
      const { value, script } = createBitcoinOutput(
        output.address,
        output.amount
      )

      const scriptLength = ethers.utils
        .hexZeroPad(ethers.BigNumber.from(script.length / 2).toHexString(), 1)
        .slice(2)

      return value + scriptLength + script
    })
    .join("")

  return `0x${outputCount}${outputData}`
}

/**
 * Parses a Bitcoin output vector into individual outputs
 */
export function parseBitcoinOutputVector(outputVector: string): Array<{
  value: bigint
  script: string
  address?: string
}> {
  // Remove 0x prefix
  let data = outputVector.startsWith("0x")
    ? outputVector.slice(2)
    : outputVector

  // First byte is output count
  const outputCount = parseInt(data.slice(0, 2), 16)
  data = data.slice(2)

  const outputs = []
  for (let i = 0; i < outputCount; i++) {
    // 8 bytes for value (little-endian)
    const valueHex = data.slice(0, 16)
    const value = BigInt(`0x${valueHex.match(/../g).reverse().join("")}`)
    data = data.slice(16)

    // 1 byte for script length
    const scriptLen = parseInt(data.slice(0, 2), 16) * 2
    data = data.slice(2)

    // Script bytes
    const script = data.slice(0, scriptLen)
    data = data.slice(scriptLen)

    // Try to extract address from script (simplified)
    let address: string | undefined
    if (script.startsWith("76a914") && script.endsWith("88ac")) {
      // P2PKH
      const pubkeyHash = script.slice(6, 46)
      address = `1${pubkeyHash}`
    } else if (script.startsWith("a914") && script.endsWith("87")) {
      // P2SH
      const scriptHash = script.slice(4, 44)
      address = `3${scriptHash}`
    } else if (script.startsWith("0014")) {
      // P2WPKH
      const pubkeyHash = script.slice(4, 44)
      address = `bc1q${pubkeyHash}`
    }

    outputs.push({ value, script, address })
  }

  return outputs
}

/**
 * Validates Bitcoin transaction structure
 */
export function validateBitcoinTx(txInfo: {
  version: BytesLike
  inputVector: BytesLike
  outputVector: BytesLike
  locktime: BytesLike
}): boolean {
  try {
    // Basic validation - check that all fields are present and non-empty
    if (
      !txInfo.version ||
      !txInfo.inputVector ||
      !txInfo.outputVector ||
      !txInfo.locktime
    ) {
      return false
    }

    // Parse output vector to validate structure
    const outputs = parseBitcoinOutputVector(txInfo.outputVector.toString())
    return outputs.length > 0
  } catch {
    return false
  }
}

/**
 * Legacy exports for backward compatibility
 */
export const bitcoinAddressUtils = {
  createP2PKHAddress,
  isValidBitcoinAddress,
  getTestBitcoinAddresses,
  createTestBitcoinAddress,
  getBitcoinAddressType,
  createBitcoinOutputScript,
  createBitcoinOutput,
  createBitcoinOutputVector,
  parseBitcoinOutputVector,
  validateBitcoinTx,
}
