import { ethers } from "hardhat"
import { QCData, QCManager } from "../../typechain"

/**
 * Contract deployment and utility helpers
 * Consolidated from qc-manager-helpers, qc-minter-helpers, qc-redeemer-helpers
 */

// =============================================================================
// QCManager Helpers
// =============================================================================

/**
 * Get QC status directly from QCData
 * Replaces the removed getQCStatus() function
 */
export async function getQCStatusDirect(
  qcData: QCData,
  qc: string
): Promise<number> {
  return qcData.getQCStatus(qc)
}

/**
 * Get QC wallets directly from QCData
 * Replaces the removed getQCWallets() function
 */
export async function getQCWalletsDirect(
  qcData: QCData,
  qc: string
): Promise<string[]> {
  return qcData.getQCWallets(qc)
}

/**
 * Emergency pause QC using setQCStatus
 * Replaces the removed emergencyPauseQC() function
 */
export async function emergencyPauseQCDirect(
  qcManager: QCManager,
  qc: string,
  reason: string
): Promise<void> {
  const reasonBytes32 = ethers.utils.id(reason)
  await qcManager.setQCStatus(qc, 1, reasonBytes32) // 1 = UnderReview status
}

// =============================================================================
// QCMinter Helpers
// =============================================================================

/**
 * Deploy QCMinter contract
 */
export async function deployQCMinter() {
  const QCMinter = await ethers.getContractFactory("QCMinter")
  return QCMinter.deploy()
}

/**
 * Default mint amount for testing
 */
export const defaultMintAmount = ethers.utils.parseEther("1.0")

/**
 * Default maximum capacity for testing
 */
export const defaultMaxCapacity = ethers.utils.parseEther("1000.0")

// =============================================================================
// QCRedeemer Helpers
// =============================================================================

/**
 * Valid legacy Bitcoin address for testing
 */
export const validLegacyBtc = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"

/**
 * Valid Bech32 Bitcoin address for testing
 */
export const validBech32Btc = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"

/**
 * Deploy QCRedeemer contract
 */
export async function deployQCRedeemer(
  tbtcToken: string,
  qcData: string,
  systemState: string
) {
  const QCRedeemer = await ethers.getContractFactory("QCRedeemer")
  return QCRedeemer.deploy(tbtcToken, qcData, systemState)
}
