/**
 * Bitcoin Transaction Utilities
 * 
 * Provides utilities for creating, parsing, and manipulating Bitcoin transactions
 * in test environments. These utilities help generate realistic transaction data
 * for testing SPV functionality.
 */

import { ParsedTransaction, ParsedInput, ParsedOutput, TxInfo } from "./SPVTestData"

/**
 * Bitcoin Transaction Utilities Class
 * 
 * This class provides static methods for working with Bitcoin transactions
 * in the test environment, including parsing, creation, and validation.
 */
export class BitcoinTransactionUtils {
  // Bitcoin network constants
  static readonly MAINNET_P2PKH_PREFIX = 0x00
  static readonly TESTNET_P2PKH_PREFIX = 0x6f
  static readonly MAINNET_P2SH_PREFIX = 0x05
  static readonly TESTNET_P2SH_PREFIX = 0xc4

  // Transaction constants
  static readonly MIN_TX_SIZE = 60 // Minimum transaction size in bytes
  static readonly MAX_TX_SIZE = 100000 // Maximum standard transaction size
  static readonly DUST_THRESHOLD = 546 // Dust threshold in satoshis
  static readonly SATOSHIS_PER_BTC = 100000000

  /**
   * Parse a raw Bitcoin transaction hex into structured data
   * This is a simplified parser for testing purposes
   */
  static parseTransaction(txHex: string): ParsedTransaction {
    const hex = txHex.replace('0x', '')
    let offset = 0

    // Parse version (4 bytes, little endian)
    const version = parseInt(this.reverseBytes(hex.substr(offset, 8)), 16)
    offset += 8

    // Parse input count (variable length)
    const { value: inputCount, length: inputCountLength } = this.parseVarInt(hex.substr(offset))
    offset += inputCountLength

    // Parse inputs
    const inputs: ParsedInput[] = []
    for (let i = 0; i < inputCount; i++) {
      const input = this.parseInput(hex.substr(offset))
      inputs.push(input.input)
      offset += input.length
    }

    // Parse output count (variable length)
    const { value: outputCount, length: outputCountLength } = this.parseVarInt(hex.substr(offset))
    offset += outputCountLength

    // Parse outputs
    const outputs: ParsedOutput[] = []
    for (let i = 0; i < outputCount; i++) {
      const output = this.parseOutput(hex.substr(offset))
      outputs.push(output.output)
      offset += output.length
    }

    // Parse locktime (4 bytes, little endian)
    const locktime = parseInt(this.reverseBytes(hex.substr(offset, 8)), 16)

    // Calculate transaction hash (double SHA256)
    const hash = this.calculateTxHash(txHex)

    return {
      hash,
      version,
      inputs,
      outputs,
      locktime
    }
  }

  /**
   * Generate a valid Bitcoin address for testing
   * Creates addresses that would pass basic validation checks
   */
  static generateValidBitcoinAddress(type: 'p2pkh' | 'p2sh' | 'bech32' = 'p2pkh'): string {
    switch (type) {
      case 'p2pkh':
        return this.generateP2PKHAddress()
      case 'p2sh':
        return this.generateP2SHAddress()
      case 'bech32':
        return this.generateBech32Address()
      default:
        return this.generateP2PKHAddress()
    }
  }

  /**
   * Create a redemption transaction with specified parameters
   * This generates a realistic Bitcoin transaction for redemption testing
   */
  static createRedemptionTransaction(
    fromAddress: string,
    toAddress: string,
    amount: number,
    fee: number = 1000
  ): string {
    // Input: Previous transaction output being spent
    const prevTxHash = "aa".repeat(32) // Mock previous transaction hash
    const prevTxIndex = "00000000" // Output index 0
    const scriptSig = "00" // Empty script sig for simplicity
    const sequence = "ffffffff"

    const input = "01" + // Input count: 1
                 prevTxHash + prevTxIndex + scriptSig + sequence

    // Output: Payment to target address
    const outputValue = amount - fee
    const valueHex = this.numberToLittleEndianHex(outputValue, 8)
    const scriptPubKey = this.addressToScriptPubKey(toAddress)
    const scriptLength = (scriptPubKey.length / 2).toString(16).padStart(2, '0')

    const output = "01" + // Output count: 1  
                  valueHex + scriptLength + scriptPubKey

    // Complete transaction
    const version = "01000000"
    const locktime = "00000000"

    return "0x" + version + input + output + locktime
  }

  /**
   * Validate if a string represents a valid Bitcoin transaction
   */
  static isValidTransaction(txHex: string): boolean {
    try {
      const hex = txHex.replace('0x', '')
      
      // Check minimum length
      if (hex.length < this.MIN_TX_SIZE * 2) {
        return false
      }
      
      // Check maximum length
      if (hex.length > this.MAX_TX_SIZE * 2) {
        return false
      }

      // Try to parse the transaction
      const parsed = this.parseTransaction(txHex)
      
      // Basic validation checks
      if (parsed.inputs.length === 0) {
        return false
      }
      
      if (parsed.outputs.length === 0) {
        return false
      }

      // Check for dust outputs
      for (const output of parsed.outputs) {
        if (output.value < this.DUST_THRESHOLD) {
          return false
        }
      }

      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Convert satoshis to BTC
   */
  static satoshisToBTC(satoshis: number): number {
    return satoshis / this.SATOSHIS_PER_BTC
  }

  /**
   * Convert BTC to satoshis
   */
  static btcToSatoshis(btc: number): number {
    return Math.round(btc * this.SATOSHIS_PER_BTC)
  }

  /**
   * Create a TxInfo object from raw transaction hex
   */
  static txHexToTxInfo(txHex: string): TxInfo {
    const hex = txHex.replace('0x', '')
    let offset = 0

    // Version (4 bytes)
    const version = "0x" + hex.substr(offset, 8)
    offset += 8

    // Find input vector
    const inputStart = offset
    const { value: inputCount, length: inputCountLength } = this.parseVarInt(hex.substr(offset))
    offset += inputCountLength

    // Skip inputs to find input vector length
    let inputLength = inputCountLength
    for (let i = 0; i < inputCount; i++) {
      // Previous output hash (32 bytes) + index (4 bytes)
      offset += 72
      inputLength += 72

      // Script length + script
      const { value: scriptLength, length: scriptLengthBytes } = this.parseVarInt(hex.substr(offset))
      offset += scriptLengthBytes + (scriptLength * 2)
      inputLength += scriptLengthBytes + (scriptLength * 2)

      // Sequence (4 bytes)
      offset += 8
      inputLength += 8
    }

    const inputVector = "0x" + hex.substr(inputStart, inputLength)

    // Find output vector
    const outputStart = offset
    const { value: outputCount, length: outputCountLength } = this.parseVarInt(hex.substr(offset))
    offset += outputCountLength

    // Skip outputs to find output vector length
    let outputLength = outputCountLength
    for (let i = 0; i < outputCount; i++) {
      // Value (8 bytes)
      offset += 16
      outputLength += 16

      // Script length + script
      const { value: scriptLength, length: scriptLengthBytes } = this.parseVarInt(hex.substr(offset))
      offset += scriptLengthBytes + (scriptLength * 2)
      outputLength += scriptLengthBytes + (scriptLength * 2)
    }

    const outputVector = "0x" + hex.substr(outputStart, outputLength)

    // Locktime (4 bytes)
    const locktime = "0x" + hex.substr(offset, 8)

    return {
      version,
      inputVector,
      outputVector,
      locktime
    }
  }

  // Private helper methods

  private static parseVarInt(hex: string): { value: number; length: number } {
    const firstByte = parseInt(hex.substr(0, 2), 16)
    
    if (firstByte < 0xfd) {
      return { value: firstByte, length: 2 }
    } else if (firstByte === 0xfd) {
      const value = parseInt(this.reverseBytes(hex.substr(2, 4)), 16)
      return { value, length: 6 }
    } else if (firstByte === 0xfe) {
      const value = parseInt(this.reverseBytes(hex.substr(2, 8)), 16)
      return { value, length: 10 }
    } else {
      const value = parseInt(this.reverseBytes(hex.substr(2, 16)), 16)
      return { value, length: 18 }
    }
  }

  private static parseInput(hex: string): { input: ParsedInput; length: number } {
    let offset = 0

    // Previous output hash (32 bytes)
    const outpointHash = "0x" + hex.substr(offset, 64)
    offset += 64

    // Previous output index (4 bytes, little endian)
    const outpointIndex = parseInt(this.reverseBytes(hex.substr(offset, 8)), 16)
    offset += 8

    // Script sig length
    const { value: scriptLength, length: scriptLengthBytes } = this.parseVarInt(hex.substr(offset))
    offset += scriptLengthBytes

    // Script sig
    const scriptSig = "0x" + hex.substr(offset, scriptLength * 2)
    offset += scriptLength * 2

    // Sequence (4 bytes, little endian)
    const sequence = parseInt(this.reverseBytes(hex.substr(offset, 8)), 16)
    offset += 8

    return {
      input: {
        outpointHash,
        outpointIndex,
        scriptSig,
        sequence
      },
      length: offset
    }
  }

  private static parseOutput(hex: string): { output: ParsedOutput; length: number } {
    let offset = 0

    // Value (8 bytes, little endian)
    const value = parseInt(this.reverseBytes(hex.substr(offset, 16)), 16)
    offset += 16

    // Script pubkey length
    const { value: scriptLength, length: scriptLengthBytes } = this.parseVarInt(hex.substr(offset))
    offset += scriptLengthBytes

    // Script pubkey
    const scriptPubkey = "0x" + hex.substr(offset, scriptLength * 2)
    offset += scriptLength * 2

    // Try to extract address from script (basic P2PKH detection)
    let address: string | undefined
    if (scriptLength === 25 && hex.substr(offset - 50, 6) === "76a914" && hex.substr(offset - 4, 4) === "88ac") {
      // P2PKH script detected - could decode address here
      address = undefined // Simplified for now
    }

    return {
      output: {
        value,
        scriptPubkey,
        address
      },
      length: offset
    }
  }

  private static reverseBytes(hex: string): string {
    return hex.match(/.{2}/g)?.reverse().join('') || hex
  }

  private static numberToLittleEndianHex(num: number, bytes: number): string {
    const hex = num.toString(16).padStart(bytes * 2, '0')
    return this.reverseBytes(hex)
  }

  private static generateP2PKHAddress(): string {
    // Generate a mock P2PKH address (starts with '1')
    const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    let result = "1"
    for (let i = 0; i < 33; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  private static generateP2SHAddress(): string {
    // Generate a mock P2SH address (starts with '3')
    const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    let result = "3"
    for (let i = 0; i < 33; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  private static generateBech32Address(): string {
    // Generate a mock Bech32 address (starts with 'bc1')
    const chars = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
    let result = "bc1q"
    for (let i = 0; i < 56; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  private static addressToScriptPubKey(address: string): string {
    // Simplified script creation - assumes P2PKH for testing
    if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
      // P2PKH script: OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
      return "76a914" + "bb".repeat(20) + "88ac" // Mock hash160
    } else if (address.startsWith('3') || address.startsWith('2')) {
      // P2SH script: OP_HASH160 <scriptHash> OP_EQUAL
      return "a914" + "cc".repeat(20) + "87" // Mock script hash
    } else if (address.startsWith('bc1') || address.startsWith('tb1')) {
      // Bech32 (P2WPKH/P2WSH) - simplified
      return "0014" + "dd".repeat(20) // Mock witness script
    } else {
      // Default to P2PKH
      return "76a914" + "ee".repeat(20) + "88ac"
    }
  }

  private static calculateTxHash(txHex: string): string {
    // Simplified hash calculation for testing
    // In real implementation, this would be double SHA256
    const hex = txHex.replace('0x', '')
    let hash = 0
    for (let i = 0; i < hex.length; i += 2) {
      hash = (hash + parseInt(hex.substr(i, 2), 16)) % 0xffffffff
    }
    return "0x" + hash.toString(16).padStart(64, '0')
  }
}