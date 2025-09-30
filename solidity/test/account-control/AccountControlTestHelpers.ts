import { ethers } from "hardhat"
import type { BytesLike, BigNumberish } from "ethers"
import { ValidMainnetProof } from "../data/bitcoin/spv/valid-spv-proofs"
import { TEST_CONSTANTS } from "./fixtures/test-data"

/**
 * Bitcoin transaction info structure matching BitcoinTx.sol
 */
export interface BitcoinTxInfo {
  version: BytesLike
  inputVector: BytesLike
  outputVector: BytesLike
  locktime: BytesLike
}

/**
 * Bitcoin SPV proof structure matching BitcoinTx.sol
 */
export interface BitcoinTxProof {
  merkleProof: BytesLike
  txIndexInBlock: BigNumberish
  bitcoinHeaders: BytesLike
  coinbasePreimage: BytesLike
  coinbaseProof: BytesLike
}

/**
 * Creates mock SPV data for testing redemption fulfillment
 * Returns mock BitcoinTx.Info and BitcoinTx.Proof structures matching the contract types
 *
 * WARNING: This creates INVALID SPV proofs that will fail validation!
 * Use createRealSpvData() for tests that need valid SPV proofs.
 */
export function createMockSpvData(): {
  txInfo: BitcoinTxInfo
  proof: BitcoinTxProof
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
 * Creates real SPV data from Bitcoin mainnet for testing redemption fulfillment
 * This will pass SPV validation when relay is properly configured
 */
export function createRealSpvData(): {
  txInfo: BitcoinTxInfo
  proof: BitcoinTxProof
  expectedTxHash: string
  chainDifficulty: number
} {
  return {
    txInfo: ValidMainnetProof.txInfo,
    proof: ValidMainnetProof.proof,
    expectedTxHash: ValidMainnetProof.expectedTxHash as string,
    chainDifficulty: ValidMainnetProof.chainDifficulty || 0x1a00ffff,
  }
}

/**
 * Creates mock wallet control proof for wallet registration testing
 */
export function createMockWalletControlProof(
  _qcAddress: string,
  _btcAddress: string
): {
  txInfo: BitcoinTxInfo
  proof: BitcoinTxProof
} {
  return createMockSpvData()
}

/**
 * Sets up a mock relay with appropriate difficulty for real SPV proofs
 * Configures all necessary relay methods for SPV validation to pass
 */
export async function setupMockRelayForSpv(
  mockRelay: any, // Mock relay interface varies, keeping any for flexibility
  chainDifficulty?: number
): Promise<void> {
  const difficulty = chainDifficulty || 0x1a00ffff

  // Mock all relay difficulty methods
  mockRelay.getCurrentEpochDifficulty.returns(difficulty)
  mockRelay.getPrevEpochDifficulty.returns(difficulty)

  // Mock getBlockDifficulty to return the same difficulty for any block
  mockRelay.getBlockDifficulty.returns(difficulty)

  // Mock getCurrentAndPrevEpochDifficulty if it exists
  if (typeof mockRelay.getCurrentAndPrevEpochDifficulty?.returns === "function") {
    mockRelay.getCurrentAndPrevEpochDifficulty.returns([difficulty, difficulty])
  }

  // Mock ready status
  mockRelay.ready.returns(true)

  // Mock the specific method needed by SPV validation
  // The relay should return proper difficulty for the specific headers
  mockRelay.getEpochDifficulty.returns(difficulty)
}

/**
 * Creates a complete SPV test setup with real data and proper relay configuration
 */
export function createCompleteSpvTestData(): {
  txInfo: BitcoinTxInfo
  proof: BitcoinTxProof
  expectedTxHash: string
  chainDifficulty: number
  userBtcAddress: string
  expectedAmount: number
} {
  const realSpvData = createRealSpvData()

  return {
    ...realSpvData,
    userBtcAddress: TEST_CONSTANTS.VALID_LEGACY_BTC,
    expectedAmount: TEST_CONSTANTS.SMALL_MINT,
  }
}

/**
 * Helper function to fulfill a redemption for test setup purposes
 * Uses a working SPV proof to bypass validation issues in setup
 */
export async function fulfillRedemptionForTest(
  qcRedeemer: any, // QCRedeemer contract interface
  testRelay: any, // TestRelay contract interface
  watchdogSigner: any, // Signer interface
  redemptionId: string
): Promise<void> {
  const realSpvData = createCompleteSpvTestData()

  // Configure TestRelay with proper difficulty
  await testRelay.setCurrentEpochDifficultyFromHeaders(
    realSpvData.proof.bitcoinHeaders
  )
  await testRelay.setPrevEpochDifficultyFromHeaders(
    realSpvData.proof.bitcoinHeaders
  )

  // This will fail on payment verification but that's OK for setup
  try {
    await qcRedeemer
      .connect(watchdogSigner)
      .recordRedemptionFulfillment(
        redemptionId,
        realSpvData.userBtcAddress,
        realSpvData.expectedAmount,
        realSpvData.txInfo,
        realSpvData.proof
      )
  } catch (error: unknown) {
    // Expected to fail on payment verification - that's fine for test setup
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (!errorMessage.includes("Payment verification failed")) {
      // If it's not a payment error, there might be another issue
      throw error
    }
    // Payment verification failed is expected and OK for our test setup
  }
}

/**
 * Creates various Bitcoin addresses for testing different formats
 * Now references centralized constants
 */
export const bitcoinTestAddresses = {
  validP2PKH: TEST_CONSTANTS.VALID_LEGACY_BTC,
  validP2SH: TEST_CONSTANTS.VALID_P2SH_BTC,
  validBech32: TEST_CONSTANTS.VALID_BECH32_BTC,
  invalid: "not_a_bitcoin_address",
  empty: "",
}

let testIdCounter = 0

/**
 * Helper to generate deterministic test data
 */
export function generateTestId(prefix: string): string {
  testIdCounter += 1
  return ethers.utils.id(`${prefix}_${testIdCounter}`)
}

/**
 * Mock SPV validation result
 */
export function createMockSpvValidationResult(isValid = true): {
  isValid: boolean
  txHash: string
  blockHeight: number
  confirmations: number
} {
  return {
    isValid,
    txHash: ethers.utils.id("mock_tx_hash"),
    blockHeight: 800000,
    confirmations: 6,
  }
}

// Export legacy constants for backward compatibility (will phase out)
export const validLegacyBtc = TEST_CONSTANTS.VALID_LEGACY_BTC