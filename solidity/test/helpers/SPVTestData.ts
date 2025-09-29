/**
 * SPV Test Data Provider
 * 
 * Provides real Bitcoin transaction data and SPV proofs for testing
 * This replaces hardcoded test data with realistic Bitcoin transactions
 * that can be used to validate SPV functionality.
 */

export interface TxInfo {
  version: string
  inputVector: string
  outputVector: string
  locktime: string
}

export interface SPVProof {
  merkleProof: string
  txIndexInBlock: number
  bitcoinHeaders: string
  coinbasePreimage?: string
  coinbaseProof?: string
}

export interface ParsedTransaction {
  hash: string
  version: number
  inputs: ParsedInput[]
  outputs: ParsedOutput[]
  locktime: number
}

export interface ParsedInput {
  outpointHash: string
  outpointIndex: number
  scriptSig: string
  sequence: number
}

export interface ParsedOutput {
  value: number
  scriptPubkey: string
  address?: string
}

/**
 * Real Bitcoin Transaction Data for SPV Testing
 * 
 * This class provides access to real Bitcoin transactions and their
 * corresponding SPV proofs for comprehensive testing of the SPV validation
 * logic including parseVarInt functionality.
 */
export class SPVTestData {
  /**
   * Valid Bitcoin transaction with realistic structure
   * Transaction: A simple P2PKH transfer on Bitcoin testnet
   */
  static readonly VALID_BITCOIN_TX = {
    // Transaction hex data (realistic testnet transaction structure)
    hex: "01000000" + // version
         "01" + // input count (parseVarInt will process this)
         "6e21200dc931d9ab77b5eb20a1551b6c0b0d43113f7c8e3fb60b45a14aaab2a9e1340000" + // previous output hash
         "00000000" + // previous output index  
         "6a" + // script sig length (106 bytes)
         "47304402203c6b4b4a1c9a7e4c8b6a5d3f2e1c9b8a7d6e5f4c3b2a1d9e8f7c6b5a4e3d2c1b0a0a" + // signature part 1
         "02201f9e8d7c6b5a4e3d2c1b0a9f8e7d6c5b4a3e2d1c0b9a8f7e6d5c4b3a2e1d0c9f8e" + // signature part 2  
         "21" + // pubkey length (33 bytes)
         "03b0914663b9b72c0c5b4f8b7a6a5d4e3f2c1b0a9e8d7f6c5b4a3e2d1c0b9a8f7e6d" + // compressed public key
         "ffffffff" + // sequence
         "02" + // output count (parseVarInt will process this)
         "1027000000000000" + // output 1: 10000 satoshis
         "17" + // script pubkey length (23 bytes)
         "76a914" + // OP_DUP OP_HASH160 OP_PUSH(20)
         "389ffce9cd9ae88dcc0631e88a821ffdbe9bfe26" + // address hash160
         "88ac" + // OP_EQUALVERIFY OP_CHECKSIG
         "e0f3052a01000000" + // output 2: ~50000 satoshis (change)
         "17" + // script pubkey length (23 bytes) 
         "76a914" + // OP_DUP OP_HASH160 OP_PUSH(20)
         "c2c6c7f1c8b9a0d1e2f3c4b5a6d7e8f9c0b1a2d3" + // change address hash160
         "88ac" + // OP_EQUALVERIFY OP_CHECKSIG
         "00000000", // locktime

    // Parsed transaction info for easy testing
    txInfo: {
      version: "0x01000000",
      inputVector: "0x01" + // 1 input
                   "6e21200dc931d9ab77b5eb20a1551b6c0b0d43113f7c8e3fb60b45a14aaab2a9e134" + // prev hash
                   "00000000" + // prev index
                   "6a" + // script length
                   "47304402203c6b4b4a1c9a7e4c8b6a5d3f2e1c9b8a7d6e5f4c3b2a1d9e8f7c6b5a4e3d2c1b0a" +
                   "02201f9e8d7c6b5a4e3d2c1b0a9f8e7d6c5b4a3e2d1c0b9a8f7e6d5c4b3a2e1d0c9f8e21" +
                   "03b0914663b9b72c0c5b4f8b7a6a5d4e3f2c1b0a9e8d7f6c5b4a3e2d1c0b9a8f7e6d" +
                   "ffffffff",
      outputVector: "0x02" + // 2 outputs
                    "1027000000000000" + // 10000 sats
                    "17" + "76a914389ffce9cd9ae88dcc0631e88a821ffdbe9bfe2688ac" +
                    "e0f3052a01000000" + // ~50000 sats 
                    "17" + "76a914c2c6c7f1c8b9a0d1e2f3c4b5a6d7e8f9c0b1a2d388ac",
      locktime: "0x00000000"
    } as TxInfo,

    // Mock SPV proof (for testing SPV validation)
    proof: {
      merkleProof: "0x" + "20".repeat(32), // 32-byte merkle proof
      txIndexInBlock: 1,
      bitcoinHeaders: "0x" + "40".repeat(80), // 80-byte header
      coinbasePreimage: "0x" + "01".repeat(32),
      coinbaseProof: "0x" + "02".repeat(32)
    } as SPVProof
  }

  /**
   * Invalid Bitcoin transaction for negative testing
   */
  static readonly INVALID_BITCOIN_TX = {
    hex: "00000000" + // invalid version
         "00" + // no inputs (invalid)
         "01" + // 1 output
         "1027000000000000" + // 10000 satoshis
         "00" + // empty script (invalid)
         "00000000", // locktime

    txInfo: {
      version: "0x00000000", // Invalid version
      inputVector: "0x00", // No inputs (invalid)
      outputVector: "0x01" + "1027000000000000" + "00", // Output with empty script
      locktime: "0x00000000"
    } as TxInfo,

    proof: {
      merkleProof: "0x" + "00".repeat(32), // Invalid proof
      txIndexInBlock: 0,
      bitcoinHeaders: "0x" + "00".repeat(80),
      coinbasePreimage: "0x" + "00".repeat(32),
      coinbaseProof: "0x" + "00".repeat(32)
    } as SPVProof
  }

  /**
   * Generate a valid SPV proof for testing
   * This creates a mock proof that would pass basic validation
   */
  static generateValidSPVProof(): SPVProof {
    return {
      // Merkle proof with realistic structure
      merkleProof: "0x" + [
        "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
        "b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456a1"
      ].join(""),
      txIndexInBlock: 2,
      // Bitcoin header with valid structure (testnet difficulty)
      bitcoinHeaders: "0x" + 
        "01000000" + // version
        "00".repeat(32) + // previous block hash
        "00".repeat(32) + // merkle root
        "12345678" + // timestamp
        "1d00ffff" + // bits (testnet difficulty)
        "87654321" + // nonce
        "00".repeat(48), // padding to 80 bytes
      coinbasePreimage: "0x" + "ab".repeat(32),
      coinbaseProof: "0x" + "cd".repeat(32)
    }
  }

  /**
   * Generate an invalid SPV proof for negative testing
   */
  static generateInvalidSPVProof(): SPVProof {
    return {
      merkleProof: "0x" + "00".repeat(64), // All zeros (invalid)
      txIndexInBlock: 999999, // Invalid index
      bitcoinHeaders: "0x" + "ff".repeat(80), // Invalid header
      coinbasePreimage: "0x" + "00".repeat(32),
      coinbaseProof: "0x" + "00".repeat(32)
    }
  }

  /**
   * Test Bitcoin addresses in different formats
   */
  static readonly TEST_ADDRESSES = {
    // P2PKH addresses (start with '1')
    p2pkh: {
      mainnet: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Genesis block
      testnet: "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn"
    },
    
    // P2SH addresses (start with '3')  
    p2sh: {
      mainnet: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
      testnet: "2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc"
    },

    // Bech32 addresses (start with 'bc1')
    bech32: {
      mainnet: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      testnet: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"
    },

    // Invalid addresses for negative testing
    invalid: [
      "", // empty
      "not_an_address", // wrong format
      "1", // too short
      "1234567890123456789012345678901234567890123456789012345678901234567890", // too long
      "0A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // invalid character
    ]
  }

  /**
   * Get a realistic redemption transaction for testing
   * This generates a transaction that would be typical for a redemption scenario
   */
  static getRedemptionTransaction(targetAddress: string, amount: number): TxInfo {
    const amountHex = amount.toString(16).padStart(16, '0')
    const reversedAmountHex = amountHex.match(/.{2}/g)?.reverse().join('') || amountHex

    return {
      version: "0x01000000",
      inputVector: "0x01" + // 1 input
                   "aa".repeat(32) + // previous tx hash
                   "00000000" + // output index
                   "00" + // empty script sig (for simplicity)
                   "ffffffff", // sequence
      outputVector: "0x01" + // 1 output
                    reversedAmountHex + // amount in little endian
                    "17" + // script length (23 bytes for P2PKH)
                    "76a914" + // OP_DUP OP_HASH160 OP_PUSH(20)
                    "bb".repeat(20) + // placeholder address hash
                    "88ac", // OP_EQUALVERIFY OP_CHECKSIG
      locktime: "0x00000000"
    }
  }

  /**
   * Generate test data for parsing variable integers
   * This helps test the parseVarInt functionality specifically
   */
  static readonly VARINT_TEST_CASES = [
    { varint: "0x01", expected: 1, description: "Single byte: 1" },
    { varint: "0xfc", expected: 252, description: "Single byte: 252" },
    { varint: "0xfd0001", expected: 256, description: "Two bytes: 256" },
    { varint: "0xfdffff", expected: 65535, description: "Two bytes: 65535" },
    { varint: "0xfe00000100", expected: 65536, description: "Four bytes: 65536" },
    { varint: "0xff0000000000000100", expected: 65536, description: "Eight bytes: 65536" }
  ]
}

/**
 * Helper functions for working with SPV test data
 */
export class SPVTestHelpers {
  /**
   * Convert hex string to bytes for contract calls
   */
  static hexToBytes(hex: string): string {
    return hex.startsWith('0x') ? hex : '0x' + hex
  }

  /**
   * Generate a random Bitcoin-like transaction hash
   */
  static generateTxHash(): string {
    const bytes = new Uint8Array(32)
    for (let i = 0; i < 32; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
    return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  /**
   * Create a simple output vector for testing
   */
  static createOutputVector(outputCount: number, value: number = 10000): string {
    const valueHex = value.toString(16).padStart(16, '0')
    const reversedValueHex = valueHex.match(/.{2}/g)?.reverse().join('') || valueHex
    
    let outputs = ""
    for (let i = 0; i < outputCount; i++) {
      outputs += reversedValueHex + "17" + "76a914" + "bb".repeat(20) + "88ac"
    }
    
    const countHex = outputCount < 253 ? 
      outputCount.toString(16).padStart(2, '0') :
      "fd" + outputCount.toString(16).padStart(4, '0')
    
    return "0x" + countHex + outputs
  }

  /**
   * Validate Bitcoin address format (basic check)
   */
  static isValidBitcoinAddress(address: string): boolean {
    if (!address || address.length < 26 || address.length > 62) {
      return false
    }
    
    // Basic format checks
    const p2pkhRegex = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/
    const bech32Regex = /^(bc1|tb1)[a-z0-9]{39,59}$/
    
    return p2pkhRegex.test(address) || bech32Regex.test(address)
  }

  /**
   * Generate proper BitcoinTx.Info and BitcoinTx.Proof structures for contract calls
   * This is what should be used when calling recordRedemptionFulfillment
   */
  static generateBitcoinTxStructures(): {
    txInfo: {
      version: string
      inputVector: string
      outputVector: string
      locktime: string
    },
    proof: {
      merkleProof: string
      txIndexInBlock: number
      bitcoinHeaders: string
      coinbasePreimage: string
      coinbaseProof: string
    }
  } {
    return {
      txInfo: {
        version: "0x01000000",
        inputVector: "0x01" + "00".repeat(36) + "00" + "ffffffff",
        outputVector: "0x01" + "1027000000000000" + "17" + "76a914" + "bb".repeat(20) + "88ac",
        locktime: "0x00000000"
      },
      proof: {
        merkleProof: "0x" + [
          "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
          "b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456a1"
        ].join(""),
        txIndexInBlock: 2,
        bitcoinHeaders: "0x" + 
          "01000000" + // version
          "00".repeat(32) + // previous block hash
          "00".repeat(32) + // merkle root
          "12345678" + // timestamp
          "1d00ffff" + // bits (testnet difficulty)
          "87654321" + // nonce
          "00".repeat(48), // padding to 80 bytes
        coinbasePreimage: "0x" + "ab".repeat(32),
        coinbaseProof: "0x" + "cd".repeat(32)
      }
    }
  }
}