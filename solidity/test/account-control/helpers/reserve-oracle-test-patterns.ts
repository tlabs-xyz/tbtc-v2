import { ethers } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ReserveOracle, SystemState } from "../../../typechain"

/**
 * Reusable test patterns for ReserveOracle testing
 */

export interface AttesterSetup {
  deployer: SignerWithAddress
  attesters: SignerWithAddress[]
  arbiter: SignerWithAddress
  qcAddress: SignerWithAddress
}

export interface ConsensusTestSetup {
  reserveOracle: ReserveOracle
  systemState: SystemState
  attesters: SignerWithAddress[]
  qcAddress: string
  balance: ethers.BigNumber
}

/**
 * Common test pattern: Submit attestations until consensus is reached
 */
export async function submitAttestationsForConsensus(
  setup: ConsensusTestSetup,
  options: {
    expectedMedian?: ethers.BigNumber
    shouldReachConsensus?: boolean
    balanceVariations?: ethers.BigNumber[]
  } = {}
): Promise<{
  consensusReached: boolean
  finalBalance: ethers.BigNumber
  attestationCount: number
}> {
  const { reserveOracle, attesters, qcAddress, balance } = setup

  const {
    shouldReachConsensus = true,
    balanceVariations = [],
    expectedMedian = balance,
  } = options

  const threshold = await setup.systemState.oracleConsensusThreshold()
  const requiredAttesters = Math.min(threshold.toNumber(), attesters.length)

  let consensusReached = false
  let finalBalance = ethers.BigNumber.from(0)
  let attestationCount = 0

  // Submit attestations
  for (let i = 0; i < requiredAttesters; i++) {
    const attestationBalance = balanceVariations[i] || balance

    const tx = await reserveOracle
      .connect(attesters[i])
      .batchAttestBalances([qcAddress], [attestationBalance])

    attestationCount++

    // Check if consensus was reached on the last required attestation
    if (i === requiredAttesters - 1 && shouldReachConsensus) {
      await expect(tx).to.emit(reserveOracle, "ConsensusReached")
      consensusReached = true

      const [resultBalance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress
      )

      finalBalance = resultBalance

      if (expectedMedian) {
        expect(finalBalance).to.equal(expectedMedian)
      }
    } else if (i < requiredAttesters - 1) {
      await expect(tx).to.not.emit(reserveOracle, "ConsensusReached")
    }
  }

  return {
    consensusReached,
    finalBalance,
    attestationCount,
  }
}

/**
 * Common test pattern: Setup roles for ReserveOracle testing
 */
export async function setupReserveOracleRoles(
  reserveOracle: ReserveOracle,
  setup: AttesterSetup
): Promise<void> {
  const ATTESTER_ROLE = await reserveOracle.ATTESTER_ROLE()
  const DISPUTE_ARBITER_ROLE = await reserveOracle.DISPUTE_ARBITER_ROLE()

  // Grant attester roles
  for (const attester of setup.attesters) {
    await reserveOracle
      .connect(setup.deployer)
      .grantRole(ATTESTER_ROLE, attester.address)
  }

  // Grant arbiter role
  await reserveOracle
    .connect(setup.deployer)
    .grantRole(DISPUTE_ARBITER_ROLE, setup.arbiter.address)
}

/**
 * Common test pattern: Test median calculation with various inputs
 */
export async function testMedianCalculation(
  reserveOracle: ReserveOracle,
  systemState: SystemState,
  attesters: SignerWithAddress[],
  qcAddress: string,
  balances: ethers.BigNumber[],
  expectedMedian: ethers.BigNumber
): Promise<void> {
  const requiredAttesters = Math.min(balances.length, attesters.length)

  // Submit attestations with different balances
  for (let i = 0; i < requiredAttesters; i++) {
    await reserveOracle
      .connect(attesters[i])
      .batchAttestBalances([qcAddress], [balances[i]])
  }

  // Verify median was calculated correctly
  const [finalBalance] = await reserveOracle.getReserveBalanceAndStaleness(
    qcAddress
  )

  expect(finalBalance).to.equal(expectedMedian)
}

/**
 * Common test pattern: Test attestation expiry
 */
export async function testAttestationExpiry(
  reserveOracle: ReserveOracle,
  systemState: SystemState,
  attester: SignerWithAddress,
  qcAddress: string,
  balance: ethers.BigNumber
): Promise<void> {
  // Submit attestation
  await reserveOracle.connect(attester).batchAttestBalances([qcAddress], [balance])

  // Verify attestation is pending
  const beforeCount = await reserveOracle.getPendingAttestationCount(qcAddress)
  expect(beforeCount).to.be.gt(0)

  // Advance time beyond attestation timeout
  const timeout = await systemState.oracleAttestationTimeout()
  await ethers.provider.send("evm_increaseTime", [timeout.add(1).toNumber()])
  await ethers.provider.send("evm_mine", [])

  // Submit another attestation to trigger cleanup
  await reserveOracle.connect(attester).batchAttestBalances([qcAddress], [balance])

  // Should emit AttestationExpired event during cleanup
  // Note: The specific event checking would need to be done in the calling test
}

/**
 * Common test pattern: Test emergency functions
 */
export async function testEmergencyFunction(
  reserveOracle: ReserveOracle,
  arbiter: SignerWithAddress,
  qcAddress: string,
  functionName: "emergencySetReserve" | "resetConsensus",
  args: any[] = []
): Promise<void> {
  let tx: any

  switch (functionName) {
    case "emergencySetReserve":
      const [newBalance] = args
      tx = await reserveOracle
        .connect(arbiter)
        .emergencySetReserve(qcAddress, newBalance)
      await expect(tx).to.emit(reserveOracle, "ReserveBalanceUpdated")
      break

    case "resetConsensus":
      tx = await reserveOracle.connect(arbiter).resetConsensus(qcAddress)
      // Verify pending attestations were cleared
      const count = await reserveOracle.getPendingAttestationCount(qcAddress)
      expect(count).to.equal(0)
      break
  }
}

/**
 * Common test pattern: Setup batch attestation scenario
 */
export async function setupBatchAttestationScenario(
  reserveOracle: ReserveOracle,
  attester: SignerWithAddress,
  qcAddresses: string[],
  balances: ethers.BigNumber[]
): Promise<void> {
  if (qcAddresses.length !== balances.length) {
    throw new Error("QC addresses and balances arrays must have same length")
  }

  await reserveOracle
    .connect(attester)
    .batchAttestBalances(qcAddresses, balances)
}

/**
 * Common test pattern: Verify attestation state
 */
export async function verifyAttestationState(
  reserveOracle: ReserveOracle,
  qcAddress: string,
  expected: {
    balance?: ethers.BigNumber
    isStale?: boolean
    pendingCount?: number
    hasPendingAttestations?: boolean
  }
): Promise<void> {
  if (expected.balance !== undefined || expected.isStale !== undefined) {
    const [balance, isStale] =
      await reserveOracle.getReserveBalanceAndStaleness(qcAddress)

    if (expected.balance !== undefined) {
      expect(balance).to.equal(expected.balance)
    }

    if (expected.isStale !== undefined) {
      expect(isStale).to.equal(expected.isStale)
    }
  }

  if (expected.pendingCount !== undefined) {
    const pendingCount = await reserveOracle.getPendingAttestationCount(
      qcAddress
    )

    expect(pendingCount).to.equal(expected.pendingCount)
  }

  if (expected.hasPendingAttestations !== undefined) {
    const [pending] = await reserveOracle.getAttestation(qcAddress)
    expect(pending).to.equal(expected.hasPendingAttestations)
  }
}

/**
 * Common test pattern: Generate test balances for median testing
 */
export function generateMedianTestCases(): Array<{
  balances: ethers.BigNumber[]
  expectedMedian: ethers.BigNumber
  description: string
}> {
  return [
    {
      balances: [
        ethers.utils.parseEther("90"),
        ethers.utils.parseEther("100"),
        ethers.utils.parseEther("110"),
      ],
      expectedMedian: ethers.utils.parseEther("100"),
      description: "odd number of values",
    },
    {
      balances: [
        ethers.utils.parseEther("80"),
        ethers.utils.parseEther("90"),
        ethers.utils.parseEther("100"),
        ethers.utils.parseEther("110"),
      ],
      expectedMedian: ethers.utils.parseEther("95"), // (90 + 100) / 2
      description: "even number of values",
    },
    {
      balances: [
        ethers.BigNumber.from(0),
        ethers.utils.parseEther("50"),
        ethers.utils.parseEther("100"),
      ],
      expectedMedian: ethers.utils.parseEther("50"),
      description: "mix of zero and non-zero values",
    },
  ]
}
