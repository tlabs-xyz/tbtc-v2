import { BigNumber } from "ethers"
import { QCReserveLedger, SystemState } from "../../typechain"

/**
 * Test helper functions for QCReserveLedger
 * These replace the removed on-chain functions with off-chain calculations
 */

/**
 * Calculate time until attestation becomes stale
 * Replaces the removed getTimeUntilStale() function
 */
export async function getTimeUntilStale(
  qcReserveLedger: QCReserveLedger,
  systemState: SystemState,
  qcAddress: string,
  currentTimestamp: number
): Promise<BigNumber> {
  const attestation = await qcReserveLedger.getCurrentAttestation(qcAddress)
  
  if (!attestation.isValid || attestation.timestamp.eq(0)) {
    return BigNumber.from(0)
  }

  const staleThreshold = await systemState.staleThreshold()
  const staleTime = attestation.timestamp.add(staleThreshold)

  if (currentTimestamp >= staleTime.toNumber()) {
    return BigNumber.from(0)
  }

  return staleTime.sub(currentTimestamp)
}

/**
 * Get attestation history count for a QC
 * Replaces the removed getAttestationHistoryCount() function
 */
export async function getAttestationHistoryCount(
  qcReserveLedger: QCReserveLedger,
  qcAddress: string
): Promise<number> {
  // Get the full attestation history array
  const history = await qcReserveLedger.getAttestationHistory(qcAddress)
  return history.length
}

/**
 * Get paginated attestation history
 * Replaces the removed getAttestationHistoryPaginated() function
 */
export async function getAttestationHistoryPaginated(
  qcReserveLedger: QCReserveLedger,
  qcAddress: string,
  offset: number,
  limit: number
): Promise<any[]> {
  // Get the full attestation history array
  const fullHistory = await qcReserveLedger.getAttestationHistory(qcAddress)
  
  if (offset >= fullHistory.length) {
    return []
  }

  const end = Math.min(offset + limit, fullHistory.length)
  return fullHistory.slice(offset, end)
}

/**
 * Get all attested QCs
 * Replaces the removed getAttestedQCs() function
 * Note: This requires reading the attestedQCs array which is still public
 */
export async function getAttestedQCs(
  qcReserveLedger: QCReserveLedger
): Promise<string[]> {
  const qcs: string[] = []
  let index = 0
  
  try {
    while (true) {
      const qc = await qcReserveLedger.attestedQCs(index)
      qcs.push(qc)
      index++
    }
  } catch (error) {
    // Expected when we reach the end of the array
  }
  
  return qcs
}

/**
 * Get attestation summary statistics
 * Replaces the removed getAttestationSummary() function
 */
export async function getAttestationSummary(
  qcReserveLedger: QCReserveLedger,
  systemState: SystemState,
  currentTimestamp: number
): Promise<{
  totalQCs: number
  totalBalance: BigNumber
  staleCount: number
}> {
  const qcs = await getAttestedQCs(qcReserveLedger)
  const staleThreshold = await systemState.staleThreshold()
  
  let totalBalance = BigNumber.from(0)
  let staleCount = 0
  
  for (const qc of qcs) {
    const attestation = await qcReserveLedger.getCurrentAttestation(qc)
    
    if (attestation.isValid && !attestation.timestamp.eq(0)) {
      totalBalance = totalBalance.add(attestation.balance)
      
      if (currentTimestamp > attestation.timestamp.add(staleThreshold).toNumber()) {
        staleCount++
      }
    } else {
      staleCount++
    }
  }
  
  return {
    totalQCs: qcs.length,
    totalBalance,
    staleCount,
  }
}

/**
 * Get latest attestation timestamps for multiple QCs
 * Replaces the removed getLatestAttestationTimestamps() function
 */
export async function getLatestAttestationTimestamps(
  qcReserveLedger: QCReserveLedger,
  qcs: string[]
): Promise<BigNumber[]> {
  const timestamps = []
  
  for (const qc of qcs) {
    const attestation = await qcReserveLedger.getCurrentAttestation(qc)
    timestamps.push(attestation.timestamp)
  }
  
  return timestamps
}

/**
 * Check if multiple QCs have stale attestations
 * Replaces the removed checkMultipleStaleAttestations() function
 */
export async function checkMultipleStaleAttestations(
  qcReserveLedger: QCReserveLedger,
  systemState: SystemState,
  qcs: string[],
  currentTimestamp: number
): Promise<boolean[]> {
  const staleFlags = []
  const staleThreshold = await systemState.staleThreshold()
  
  for (const qc of qcs) {
    const attestation = await qcReserveLedger.getCurrentAttestation(qc)
    
    if (!attestation.isValid || attestation.timestamp.eq(0)) {
      staleFlags.push(true)
    } else {
      const isStale = currentTimestamp > attestation.timestamp.add(staleThreshold).toNumber()
      staleFlags.push(isStale)
    }
  }
  
  return staleFlags
}