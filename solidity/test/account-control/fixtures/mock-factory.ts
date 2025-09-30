import { ethers } from "hardhat"
import type { BytesLike, BigNumberish } from "ethers"
import { TEST_CONSTANTS } from "./test-data"

/**
 * Standardized mock creation patterns using smock library
 * Provides consistent mock objects for testing
 */

/**
 * Creates a standardized mock relay with common methods
 */
export function createMockRelay(difficulty: number = TEST_CONSTANTS.DEFAULT_CHAIN_DIFFICULTY) {
  return {
    getCurrentEpochDifficulty: () => difficulty,
    getPrevEpochDifficulty: () => difficulty,
    getBlockDifficulty: () => difficulty,
    getCurrentAndPrevEpochDifficulty: () => [difficulty, difficulty],
    getEpochDifficulty: () => difficulty,
    ready: () => true,
    setCurrentEpochDifficulty: () => Promise.resolve(),
    setPrevEpochDifficulty: () => Promise.resolve(),
    setReady: () => Promise.resolve(),
  }
}

/**
 * Creates mock SPV validation results
 */
export function createMockSpvValidationResult(overrides: Partial<{
  isValid: boolean
  txHash: string
  blockHeight: number
  confirmations: number
}> = {}) {
  return {
    isValid: overrides.isValid ?? true,
    txHash: overrides.txHash ?? ethers.utils.id("mock_tx_hash"),
    blockHeight: overrides.blockHeight ?? TEST_CONSTANTS.DEFAULT_BLOCK_HEIGHT,
    confirmations: overrides.confirmations ?? TEST_CONSTANTS.DEFAULT_CONFIRMATIONS,
  }
}

/**
 * Creates mock contract transaction receipt
 */
export function createMockTransactionReceipt(overrides: Partial<{
  gasUsed: BigNumberish
  status: number
  blockNumber: number
}> = {}) {
  return {
    gasUsed: ethers.BigNumber.from(overrides.gasUsed ?? 100000),
    status: overrides.status ?? 1,
    blockNumber: overrides.blockNumber ?? TEST_CONSTANTS.DEFAULT_BLOCK_HEIGHT,
    wait: () => Promise.resolve(this),
  }
}

/**
 * Creates mock contract with common patterns
 */
export function createMockContract(methods: Record<string, any> = {}) {
  const defaultMethods = {
    connect: () => this,
    deployed: () => Promise.resolve(this),
    interface: {
      encodeFunctionData: () => "0x",
      decodeFunctionResult: () => [],
    },
  }

  return {
    ...defaultMethods,
    ...methods,
  }
}

/**
 * Creates mock signer with standard properties
 */
export function createMockSigner(address?: string) {
  return {
    address: address ?? ethers.Wallet.createRandom().address,
    getAddress: async () => this.address,
    signMessage: async () => "0x",
    connect: () => this,
  }
}

/**
 * Creates mock Bitcoin transaction data
 */
export function createMockBitcoinTx(overrides: Partial<{
  version: BytesLike
  inputVector: BytesLike
  outputVector: BytesLike
  locktime: BytesLike
}> = {}) {
  return {
    version: overrides.version ?? "0x01000000",
    inputVector: overrides.inputVector ?? `0x01${"00".repeat(36)}00${"00".repeat(4)}`,
    outputVector: overrides.outputVector ?? `0x01${"00".repeat(8)}00`,
    locktime: overrides.locktime ?? "0x00000000",
  }
}

/**
 * Creates mock Bitcoin SPV proof data
 */
export function createMockBitcoinProof(overrides: Partial<{
  merkleProof: BytesLike
  txIndexInBlock: BigNumberish
  bitcoinHeaders: BytesLike
  coinbasePreimage: BytesLike
  coinbaseProof: BytesLike
}> = {}) {
  return {
    merkleProof: overrides.merkleProof ?? ethers.utils.hexlify(new Uint8Array(32).fill(0xcc)),
    txIndexInBlock: overrides.txIndexInBlock ?? 0,
    bitcoinHeaders: overrides.bitcoinHeaders ?? ethers.utils.hexlify(new Uint8Array(80).fill(0xdd)),
    coinbasePreimage: overrides.coinbasePreimage ?? ethers.utils.hexZeroPad("0xaabbcc", 32),
    coinbaseProof: overrides.coinbaseProof ?? ethers.utils.hexlify(new Uint8Array(32).fill(0xee)),
  }
}

/**
 * Creates complete mock SPV test data
 */
export function createMockSpvTestData(overrides: {
  txInfo?: Partial<ReturnType<typeof createMockBitcoinTx>>
  proof?: Partial<ReturnType<typeof createMockBitcoinProof>>
} = {}) {
  return {
    txInfo: createMockBitcoinTx(overrides.txInfo),
    proof: createMockBitcoinProof(overrides.proof),
  }
}

/**
 * Creates mock wallet control proof
 */
export function createMockWalletControlProof(
  qcAddress: string,
  btcAddress: string = TEST_CONSTANTS.VALID_LEGACY_BTC
) {
  const { txInfo, proof } = createMockSpvTestData()
  return {
    qc: qcAddress,
    btcAddress,
    txInfo,
    proof,
  }
}

/**
 * Creates mock redemption fulfillment proof
 */
export function createMockRedemptionFulfillmentProof(redemptionId: string) {
  const { txInfo, proof } = createMockSpvTestData()
  return {
    redemptionId: ethers.utils.id(redemptionId),
    txInfo,
    proof,
  }
}