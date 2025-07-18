import { ethers } from "ethers"
import { QCData, QCManager } from "../../typechain"

/**
 * Test helper functions for QCManager
 * These replace the removed superficial functions with direct calls
 */

/**
 * Get QC status directly from QCData
 * Replaces the removed getQCStatus() function
 */
export async function getQCStatusDirect(
  qcData: QCData,
  qc: string
): Promise<number> {
  return await qcData.getQCStatus(qc)
}

/**
 * Get QC wallets directly from QCData
 * Replaces the removed getQCWallets() function
 */
export async function getQCWalletsDirect(
  qcData: QCData,
  qc: string
): Promise<string[]> {
  return await qcData.getQCWallets(qc)
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