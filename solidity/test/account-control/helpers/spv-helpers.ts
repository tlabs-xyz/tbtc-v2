import { ethers } from "hardhat"
import type { ContractTransaction } from "ethers"
import type {
  SPVValidator,
  LightRelayStub,
  SystemTestRelay,
} from "../../../typechain"
import { assertGasUsed } from "../../integration/utils/gas"
import type { SPVProofTestData } from "../../data/bitcoin/spv/valid-spv-proofs"
import type { BitcoinTxInfo, BitcoinTxProof } from "../../../typechain/BitcoinTx"
import { spvTestConfig } from "../fixtures/test-data"

/**
 * SPV (Simplified Payment Verification) testing helper utilities
 * Provides standardized methods for SPV validation testing
 */

/**
 * Sets up the relay with appropriate difficulty for the given SPV proof
 */
export async function setupRelayDifficulty(
  relay: LightRelayStub | SystemTestRelay,
  spvProof: SPVProofTestData
): Promise<void> {
  if ("setCurrentEpochDifficultyFromHeaders" in relay) {
    // SystemTestRelay
    await relay.setCurrentEpochDifficultyFromHeaders(
      spvProof.proof.bitcoinHeaders
    )
  } else if ("setCurrentEpochDifficulty" in relay) {
    // LightRelayStub - set a default difficulty
    const defaultDifficulty = spvProof.chainDifficulty || spvTestConfig.chainDifficulty
    await relay.setCurrentEpochDifficulty(defaultDifficulty)
    await relay.setPrevEpochDifficulty(defaultDifficulty)
  }
}

/**
 * Executes validateProof and captures gas usage
 */
export async function validateProofWithGas(
  spvValidator: SPVValidator,
  spvProof: SPVProofTestData,
  expectedGasRange?: { min: number; max: number }
): Promise<{
  tx: ContractTransaction
  txHash: string
  gasUsed: number
}> {
  const tx = await spvValidator.validateProof(spvProof.txInfo, spvProof.proof)

  const receipt = await tx.wait()
  const gasUsed = receipt.gasUsed.toNumber()

  // Calculate transaction hash from the transaction data
  const txHash = ethers.utils.keccak256(
    ethers.utils.solidityPack(
      ["bytes", "bytes", "bytes", "bytes"],
      [
        spvProof.txInfo.version,
        spvProof.txInfo.inputVector,
        spvProof.txInfo.outputVector,
        spvProof.txInfo.locktime,
      ]
    )
  )

  if (expectedGasRange) {
    assertGasUsed(gasUsed, expectedGasRange.min, expectedGasRange.max)
  }

  return { tx, txHash, gasUsed }
}

/**
 * Creates mock wallet control proof data
 */
export function createWalletControlProof(
  qcAddress: string,
  btcAddress: string,
  txInfo: BitcoinTxInfo,
  proof: BitcoinTxProof
) {
  return {
    qc: qcAddress,
    btcAddress,
    txInfo,
    proof,
  }
}

/**
 * Creates mock redemption fulfillment proof data
 */
export function createRedemptionFulfillmentProof(
  redemptionId: string,
  txInfo: BitcoinTxInfo,
  proof: BitcoinTxProof
) {
  return {
    redemptionId: ethers.utils.id(redemptionId),
    txInfo,
    proof,
  }
}

/**
 * Generates a tampered merkle proof for security testing
 */
export function tamperMerkleProof(originalProof: string, position: number): string {
  // Convert hex string to bytes
  const proofBytes = ethers.utils.arrayify(originalProof)

  // Tamper with bytes at the specified position
  for (let i = 0; i < 32 && position + i < proofBytes.length; i++) {
    proofBytes[position + i] = 0xff
  }

  return ethers.utils.hexlify(proofBytes)
}

/**
 * Truncates headers to simulate insufficient proof of work
 */
export function truncateHeaders(headers: string, keepHeaders: number): string {
  // Each header is 80 bytes
  const headerSize = 80 * 2 // 160 hex characters
  const prefixLength = headers.startsWith("0x") ? 2 : 0
  const totalLength = prefixLength + keepHeaders * headerSize

  return headers.slice(0, totalLength)
}

/**
 * Creates malformed transaction data for security testing
 */
export function createMalformedTxInfo() {
  return {
    // Empty input vector (invalid)
    emptyInputs: {
      version: "0x02000000",
      inputVector: "0x00",
      outputVector: `${"0x0100e1f505000000001976a914"}${"a".repeat(40)}88ac`,
      locktime: "0x00000000",
    },

    // Empty output vector (invalid)
    emptyOutputs: {
      version: "0x02000000",
      inputVector: `0x01${"a".repeat(72)}ffffffff`,
      outputVector: "0x00",
      locktime: "0x00000000",
    },

    // Invalid version
    invalidVersion: {
      version: "0x00000000", // Version 0 is invalid
      inputVector: `0x01${"a".repeat(72)}ffffffff`,
      outputVector: `${"0x0100e1f505000000001976a914"}${"a".repeat(40)}88ac`,
      locktime: "0x00000000",
    },
  }
}

/**
 * Helper to extract outputs from outputVector for wallet verification
 */
export function parseOutputVector(outputVector: string): Array<{
  value: bigint
  script: string
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
    const value = BigInt(`0x${valueHex.match(/../g)!.reverse().join("")}`)
    data = data.slice(16)

    // 1 byte for script length
    const scriptLen = parseInt(data.slice(0, 2), 16) * 2
    data = data.slice(2)

    // Script bytes
    const script = data.slice(0, scriptLen)
    data = data.slice(scriptLen)

    outputs.push({ value, script })
  }

  return outputs
}

/**
 * Profile gas usage across multiple SPV validations
 */
export async function profileGasUsage(
  spvValidator: SPVValidator,
  testCases: SPVProofTestData[]
): Promise<
  {
    testName: string
    gasUsed: number
    txHash: string
  }[]
> {
  const results = await Promise.all(
    testCases.map(async (testCase) => {
      const { gasUsed, txHash } = await validateProofWithGas(
        spvValidator,
        testCase
      )

      return {
        testName: testCase.name,
        gasUsed,
        txHash,
      }
    })
  )

  return results
}

/**
 * Legacy class wrapper for backward compatibility
 * @deprecated Use individual functions instead
 */
export class SPVTestHelpers {
  static setupRelayDifficulty = setupRelayDifficulty
  static validateProofWithGas = validateProofWithGas
  static createWalletControlProof = createWalletControlProof
  static createRedemptionFulfillmentProof = createRedemptionFulfillmentProof
  static tamperMerkleProof = tamperMerkleProof
  static truncateHeaders = truncateHeaders
  static createMalformedTxInfo = createMalformedTxInfo
  static parseOutputVector = parseOutputVector
  static profileGasUsage = profileGasUsage
}

// Default export for backward compatibility
export default SPVTestHelpers