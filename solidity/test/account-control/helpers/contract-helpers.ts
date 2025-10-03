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
 * Default mint amount for testing
 */
export const defaultMintAmount = ethers.utils.parseEther("1.0")

/**
 * Default maximum capacity for testing
 */
export const defaultMaxCapacity = ethers.utils.parseEther("1000.0")
