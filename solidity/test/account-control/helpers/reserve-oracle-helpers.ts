import { BigNumber } from "ethers"
import { ReserveOracle, SystemState } from "../../../typechain"

/**
 * Test helper functions for ReserveOracle
 * Updated to match actual contract API
 */

/**
 * Calculate time until reserve data becomes stale
 */
export async function getTimeUntilStale(
  reserveOracle: ReserveOracle,
  systemState: SystemState,
  qcAddress: string,
  currentTimestamp: number
): Promise<BigNumber> {
  const reserveData = await reserveOracle.reserves(qcAddress)

  if (reserveData.lastUpdateTimestamp.eq(0)) {
    return BigNumber.from(0)
  }

  const maxStaleness = await systemState.oracleMaxStaleness()
  const staleTime = reserveData.lastUpdateTimestamp.add(maxStaleness)

  if (currentTimestamp >= staleTime.toNumber()) {
    return BigNumber.from(0)
  }

  return staleTime.sub(currentTimestamp)
}

/**
 * Get pending attestation count for a QC
 */
export async function getPendingAttestationCount(
  reserveOracle: ReserveOracle,
  qcAddress: string
): Promise<number> {
  return reserveOracle.getPendingAttestationCount(qcAddress)
}

/**
 * Get all pending attesters for a QC
 */
export async function getPendingAttesters(
  reserveOracle: ReserveOracle,
  qcAddress: string
): Promise<string[]> {
  return reserveOracle.getPendingAttesters(qcAddress)
}

/**
 * Get detailed attestation information for a QC
 */
export async function getAttestationInfo(
  reserveOracle: ReserveOracle,
  qcAddress: string
): Promise<{
  pending: boolean
  attestations: number
  finalizedAmount: BigNumber
}> {
  const [pending, attestations, finalizedAmount] =
    await reserveOracle.getAttestation(qcAddress)

  return {
    pending,
    attestations: attestations.toNumber(),
    finalizedAmount,
  }
}

/**
 * Check if reserve data is stale
 */
export async function isReserveStale(
  reserveOracle: ReserveOracle,
  qcAddress: string
): Promise<boolean> {
  const [, isStale] = await reserveOracle.getReserveBalanceAndStaleness(
    qcAddress
  )

  return isStale
}

/**
 * Get reserve balance without staleness check
 */
export async function getReserveBalance(
  reserveOracle: ReserveOracle,
  qcAddress: string
): Promise<BigNumber> {
  return reserveOracle.getReserveBalance(qcAddress)
}

/**
 * Get pending attestation details for a specific attester
 */
export async function getPendingAttestationDetails(
  reserveOracle: ReserveOracle,
  qcAddress: string,
  attester: string
): Promise<{
  balance: BigNumber
  timestamp: BigNumber
}> {
  const [balance, timestamp] = await reserveOracle.getPendingAttestation(
    qcAddress,
    attester
  )

  return { balance, timestamp }
}

/**
 * Check if multiple QCs have stale attestations
 */
export async function checkMultipleStaleAttestations(
  reserveOracle: ReserveOracle,
  qcs: string[]
): Promise<boolean[]> {
  const staleFlags = []

  for (const qc of qcs) {
    const [, isStale] = await reserveOracle.getReserveBalanceAndStaleness(qc)
    staleFlags.push(isStale)
  }

  return staleFlags
}

/**
 * Get oracle configuration from SystemState
 */
export async function getOracleConfig(systemState: SystemState): Promise<{
  consensusThreshold: BigNumber
  attestationTimeout: BigNumber
  maxStaleness: BigNumber
}> {
  const [consensusThreshold, attestationTimeout, maxStaleness] =
    await Promise.all([
      systemState.oracleConsensusThreshold(),
      systemState.oracleAttestationTimeout(),
      systemState.oracleMaxStaleness(),
    ])

  return {
    consensusThreshold,
    attestationTimeout,
    maxStaleness,
  }
}

/**
 * Get comprehensive reserve status for a QC
 */
export async function getReserveStatus(
  reserveOracle: ReserveOracle,
  systemState: SystemState,
  qcAddress: string
): Promise<{
  balance: BigNumber
  isStale: boolean
  pending: boolean
  pendingCount: number
  lastUpdate: BigNumber
}> {
  const [balance, isStale] = await reserveOracle.getReserveBalanceAndStaleness(
    qcAddress
  )

  const [pending, pendingCount] = await reserveOracle.getAttestation(qcAddress)
  const reserveData = await reserveOracle.reserves(qcAddress)

  return {
    balance,
    isStale,
    pending,
    pendingCount: pendingCount.toNumber(),
    lastUpdate: reserveData.lastUpdateTimestamp,
  }
}
