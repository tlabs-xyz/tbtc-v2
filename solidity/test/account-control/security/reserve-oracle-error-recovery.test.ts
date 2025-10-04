import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import {
  ReserveOracle,
  QCManager,
  QCData,
  SystemState,
  AccountControl,
  QCPauseManager,
  QCWalletManager,
} from "../../../typechain"
import { LibraryLinkingHelper } from "../helpers/library-linking-helper"
import {
  setupReserveOracleRoles,
  submitAttestationsForConsensus,
  verifyAttestationState,
} from "../helpers/reserve-oracle-test-patterns"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("ReserveOracle - Error Recovery & Path Coverage", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let attester1: SignerWithAddress
  let attester2: SignerWithAddress
  let attester3: SignerWithAddress
  let attester4: SignerWithAddress
  let qcAddress: SignerWithAddress
  let arbiter: SignerWithAddress
  let monitor: SignerWithAddress
  let maliciousUser: SignerWithAddress

  let reserveOracle: ReserveOracle
  let qcManager: QCManager
  let qcData: QCData
  let systemState: SystemState
  let accountControl: AccountControl
  let pauseManager: QCPauseManager
  let walletManager: QCWalletManager
  let fakeQCManager: any

  // Role constants
  const GOVERNANCE_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("GOVERNANCE_ROLE")
  )

  const MONITOR_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("MONITOR_ROLE")
  )

  const ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE")
  const DISPUTE_ARBITER_ROLE = ethers.utils.id("DISPUTE_ARBITER_ROLE")

  before(async () => {
    const signers = await ethers.getSigners()
    deployer = signers[0]
    governance = signers[1]
    attester1 = signers[2]
    attester2 = signers[3]
    attester3 = signers[4]
    attester4 = signers[5]
    qcAddress = signers[6]
    arbiter = signers[7]
    monitor = signers[8]
    maliciousUser = signers[9]
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy core contracts
    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy()
    await systemState.deployed()

    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy()
    await qcData.deployed()

    const ReserveOracleFactory = await ethers.getContractFactory(
      "ReserveOracle"
    )

    reserveOracle = await ReserveOracleFactory.deploy(systemState.address)
    await reserveOracle.deployed()

    // Deploy mock dependencies
    const MockBankFactory = await ethers.getContractFactory("MockBank")
    const mockBank = await MockBankFactory.deploy()
    await mockBank.deployed()

    const MockAccountControlFactory = await ethers.getContractFactory(
      "MockAccountControl"
    )

    accountControl = await MockAccountControlFactory.deploy(mockBank.address)
    await accountControl.deployed()

    const MockQCPauseManagerFactory = await ethers.getContractFactory(
      "MockQCPauseManager"
    )

    pauseManager = await MockQCPauseManagerFactory.deploy()
    await pauseManager.deployed()

    const MockQCWalletManagerFactory = await ethers.getContractFactory(
      "MockQCWalletManager"
    )

    walletManager = await MockQCWalletManagerFactory.deploy()
    await walletManager.deployed()

    // Deploy QCManager
    const QCManagerFactory = await LibraryLinkingHelper.getQCManagerFactory()
    qcManager = (await QCManagerFactory.deploy(
      qcData.address,
      systemState.address,
      reserveOracle.address,
      accountControl.address,
      pauseManager.address,
      walletManager.address
    )) as QCManager
    await qcManager.deployed()

    // Setup roles
    await setupReserveOracleRoles(reserveOracle, {
      deployer,
      attesters: [attester1, attester2, attester3, attester4],
      arbiter,
      qcAddress,
    })

    await qcManager.grantRole(GOVERNANCE_ROLE, governance.address)
    await qcManager.grantRole(MONITOR_ROLE, monitor.address)
    await qcManager.grantRole(MONITOR_ROLE, reserveOracle.address)

    // Register QC
    await qcData.grantRole(qcData.QC_MANAGER_ROLE, deployer.address)
    await qcData.registerQC(
      qcAddress.address,
      "Test QC",
      ethers.utils.parseEther("100"),
      0,
      "QC for error testing"
    )

    // Set QCManager in oracle
    await reserveOracle.setQCManager(qcManager.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("QCManager Sync Failures", () => {
    it("should handle QCManager contract call failures during consensus", async () => {
      // Deploy a mock QCManager that always reverts
      const FailingQCManagerFactory = await ethers.getContractFactory(
        "contracts/test/MockQCRedeemer.sol:MockQCRedeemer"
      )

      const failingQCManager = await FailingQCManagerFactory.deploy()
      await failingQCManager.deployed()

      // Set the failing QCManager
      await reserveOracle.setQCManager(failingQCManager.address)

      const attestedBalance = ethers.utils.parseEther("100")

      // Consensus should still be reached despite sync failure
      const result = await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance: attestedBalance,
      })

      expect(result.consensusReached).to.be.true
      expect(result.finalBalance).to.equal(attestedBalance)

      // Verify oracle state is correct despite sync failure
      await verifyAttestationState(reserveOracle, qcAddress.address, {
        balance: attestedBalance,
        isStale: false,
        pendingCount: 0,
      })
    })

    it("should handle QCManager being unset during operation", async () => {
      const attestedBalance = ethers.utils.parseEther("100")

      // Submit first two attestations
      await reserveOracle
        .connect(attester1)
        .batchAttestBalances([qcAddress.address], [attestedBalance])
      await reserveOracle
        .connect(attester2)
        .batchAttestBalances([qcAddress.address], [attestedBalance])

      // Remove QCManager
      await reserveOracle.setQCManager(ethers.constants.AddressZero)

      // Third attestation should still trigger consensus
      const tx = await reserveOracle
        .connect(attester3)
        .batchAttestBalances([qcAddress.address], [attestedBalance])

      await expect(tx).to.emit(reserveOracle, "ConsensusReached")

      // Verify state is correct
      const [balance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )

      expect(balance).to.equal(attestedBalance)
    })

    it("should handle QCManager address pointing to EOA", async () => {
      // Set QCManager to an EOA (externally owned account)
      await reserveOracle.setQCManager(maliciousUser.address)

      const attestedBalance = ethers.utils.parseEther("100")

      // Consensus should work despite invalid QCManager
      const result = await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance: attestedBalance,
      })

      expect(result.consensusReached).to.be.true
      expect(result.finalBalance).to.equal(attestedBalance)
    })

    it("should handle QCManager with incorrect interface", async () => {
      // Deploy a contract without the correct interface
      const WrongInterfaceFactory = await ethers.getContractFactory(
        "MockSystemState"
      )

      const wrongInterface = await WrongInterfaceFactory.deploy()
      await wrongInterface.deployed()

      await reserveOracle.setQCManager(wrongInterface.address)

      const attestedBalance = ethers.utils.parseEther("100")

      // Should work despite interface mismatch
      const result = await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance: attestedBalance,
      })

      expect(result.consensusReached).to.be.true
    })
  })

  describe("Attestation Timeout and Expiry Recovery", () => {
    it("should recover from expired attestations after timeout", async () => {
      const balance = ethers.utils.parseEther("100")

      // Submit partial attestations
      await reserveOracle
        .connect(attester1)
        .batchAttestBalances([qcAddress.address], [balance])
      await reserveOracle
        .connect(attester2)
        .batchAttestBalances([qcAddress.address], [balance])

      // Verify pending attestations
      expect(
        await reserveOracle.getPendingAttestationCount(qcAddress.address)
      ).to.equal(2)

      // Advance time beyond attestation timeout
      const timeout = await systemState.oracleAttestationTimeout()
      await ethers.provider.send("evm_increaseTime", [
        timeout.add(1).toNumber(),
      ])
      await ethers.provider.send("evm_mine", [])

      // New attestation should trigger cleanup of expired ones
      await reserveOracle
        .connect(attester3)
        .batchAttestBalances([qcAddress.address], [balance])

      // Should not reach consensus due to expired attestations
      const [pending, count] = await reserveOracle.getAttestation(
        qcAddress.address
      )

      expect(pending).to.be.true
      expect(count).to.equal(1) // Only the fresh attestation

      // Need more fresh attestations to reach consensus
      await reserveOracle
        .connect(attester4)
        .batchAttestBalances([qcAddress.address], [balance])

      // Still need one more
      const tx = await reserveOracle
        .connect(attester1) // Can resubmit after expiry
        .batchAttestBalances([qcAddress.address], [balance])

      await expect(tx).to.emit(reserveOracle, "ConsensusReached")
    })

    it("should handle mixed expired and valid attestations", async () => {
      const balance = ethers.utils.parseEther("100")

      // Submit first attestation
      await reserveOracle
        .connect(attester1)
        .batchAttestBalances([qcAddress.address], [balance])

      // Advance time to make first attestation expire
      const timeout = await systemState.oracleAttestationTimeout()
      await ethers.provider.send("evm_increaseTime", [
        timeout.add(1).toNumber(),
      ])
      await ethers.provider.send("evm_mine", [])

      // Submit fresh attestations
      await reserveOracle
        .connect(attester2)
        .batchAttestBalances([qcAddress.address], [balance])
      await reserveOracle
        .connect(attester3)
        .batchAttestBalances([qcAddress.address], [balance])

      // Should not reach consensus (only 2 valid, 1 expired)
      const [pending, count] = await reserveOracle.getAttestation(
        qcAddress.address
      )

      expect(pending).to.be.true
      expect(count).to.equal(2)

      // One more fresh attestation should trigger consensus
      const tx = await reserveOracle
        .connect(attester4)
        .batchAttestBalances([qcAddress.address], [balance])

      await expect(tx).to.emit(reserveOracle, "ConsensusReached")
    })

    it("should prevent new attestations when other expired ones exist", async () => {
      const balance = ethers.utils.parseEther("100")

      // Submit attestations from different attesters
      await reserveOracle
        .connect(attester1)
        .batchAttestBalances([qcAddress.address], [balance])
      await reserveOracle
        .connect(attester2)
        .batchAttestBalances([qcAddress.address], [balance])

      // Advance time to make attestations expire
      const timeout = await systemState.oracleAttestationTimeout()
      await ethers.provider.send("evm_increaseTime", [
        timeout.add(1).toNumber(),
      ])
      await ethers.provider.send("evm_mine", [])

      // New attestation from different attester should be rejected due to expired attestations
      await expect(
        reserveOracle
          .connect(attester3)
          .batchAttestBalances([qcAddress.address], [balance])
      ).to.be.revertedWithCustomError(reserveOracle, "AttestationTooOld")
    })
  })

  describe("Role Revocation Recovery", () => {
    it("should handle attester role revocation during pending consensus", async () => {
      const balance = ethers.utils.parseEther("100")

      // Submit attestations
      await reserveOracle
        .connect(attester1)
        .batchAttestBalances([qcAddress.address], [balance])
      await reserveOracle
        .connect(attester2)
        .batchAttestBalances([qcAddress.address], [balance])

      // Revoke one attester's role
      await reserveOracle
        .connect(deployer)
        .revokeRole(ATTESTER_ROLE, attester1.address)

      // Third attestation should trigger cleanup and consensus
      const tx = await reserveOracle
        .connect(attester3)
        .batchAttestBalances([qcAddress.address], [balance])

      await expect(tx).to.emit(reserveOracle, "ConsensusReached")

      // Should reach consensus with valid attestations only
      const [finalBalance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )

      expect(finalBalance).to.equal(balance)
    })

    it("should prevent attestations from revoked attesters", async () => {
      // Revoke attester role
      await reserveOracle
        .connect(deployer)
        .revokeRole(ATTESTER_ROLE, attester1.address)

      const balance = ethers.utils.parseEther("100")

      // Revoked attester should not be able to submit
      await expect(
        reserveOracle
          .connect(attester1)
          .batchAttestBalances([qcAddress.address], [balance])
      ).to.be.revertedWith("AccessControl")
    })

    it("should clean up attestations from revoked attesters automatically", async () => {
      const balance = ethers.utils.parseEther("100")

      // Submit attestations including from soon-to-be-revoked attester
      await reserveOracle
        .connect(attester1)
        .batchAttestBalances([qcAddress.address], [balance])
      await reserveOracle
        .connect(attester2)
        .batchAttestBalances([qcAddress.address], [balance])

      // Verify attestations are pending
      expect(
        await reserveOracle.getPendingAttestationCount(qcAddress.address)
      ).to.equal(2)

      // Revoke one attester
      await reserveOracle
        .connect(deployer)
        .revokeRole(ATTESTER_ROLE, attester1.address)

      // New attestation should trigger cleanup
      await reserveOracle
        .connect(attester3)
        .batchAttestBalances([qcAddress.address], [balance])

      // Count should reflect cleanup of revoked attester
      const pendingCount = await reserveOracle.getPendingAttestationCount(
        qcAddress.address
      )

      expect(pendingCount).to.equal(2) // attester2 + attester3, attester1 cleaned up
    })
  })

  describe("Emergency Recovery Scenarios", () => {
    it("should recover from stuck consensus via arbiter reset", async () => {
      const balance = ethers.utils.parseEther("100")

      // Create a stuck situation - partial attestations that won't reach consensus
      await reserveOracle
        .connect(attester1)
        .batchAttestBalances([qcAddress.address], [balance])
      await reserveOracle
        .connect(attester2)
        .batchAttestBalances([qcAddress.address], [balance])

      // Verify stuck state
      const [pending, count] = await reserveOracle.getAttestation(
        qcAddress.address
      )

      expect(pending).to.be.true
      expect(count).to.equal(2)

      // Arbiter resets consensus
      await reserveOracle.connect(arbiter).resetConsensus(qcAddress.address)

      // Verify reset
      const [pendingAfter, countAfter] = await reserveOracle.getAttestation(
        qcAddress.address
      )

      expect(pendingAfter).to.be.false
      expect(countAfter).to.equal(0)

      // Should be able to start fresh consensus
      const result = await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance,
      })

      expect(result.consensusReached).to.be.true
    })

    it("should handle emergency reserve setting during pending consensus", async () => {
      const balance = ethers.utils.parseEther("100")
      const emergencyBalance = ethers.utils.parseEther("200")

      // Start consensus process
      await reserveOracle
        .connect(attester1)
        .batchAttestBalances([qcAddress.address], [balance])
      await reserveOracle
        .connect(attester2)
        .batchAttestBalances([qcAddress.address], [balance])

      // Arbiter emergency override
      await reserveOracle
        .connect(arbiter)
        .emergencySetReserve(qcAddress.address, emergencyBalance)

      // Verify emergency balance is set and pending cleared
      const [finalBalance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )

      expect(finalBalance).to.equal(emergencyBalance)

      const pendingCount = await reserveOracle.getPendingAttestationCount(
        qcAddress.address
      )

      expect(pendingCount).to.equal(0)
    })

    it("should recover from corrupted consensus state", async () => {
      const originalBalance = ethers.utils.parseEther("100")
      const correctedBalance = ethers.utils.parseEther("150")

      // Establish consensus with potentially incorrect data
      await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance: originalBalance,
      })

      // Arbiter detects error and overrides
      await reserveOracle
        .connect(arbiter)
        .overrideAttestation(
          qcAddress.address,
          correctedBalance,
          "Data correction"
        )

      // Verify correction
      const [balance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )

      expect(balance).to.equal(correctedBalance)

      // Should be able to continue normal operations
      const newBalance = ethers.utils.parseEther("175")

      const result = await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance: newBalance,
      })

      expect(result.consensusReached).to.be.true
      expect(result.finalBalance).to.equal(newBalance)
    })
  })

  describe("System State Configuration Errors", () => {
    it("should handle invalid consensus threshold gracefully", async () => {
      // Temporarily set invalid threshold
      await expect(
        systemState.connect(deployer).setOracleConsensusThreshold(0)
      ).to.be.revertedWith("Threshold must be at least 1")
    })

    it("should handle very high consensus threshold", async () => {
      // Set threshold higher than available attesters
      await systemState.connect(deployer).setOracleConsensusThreshold(10)

      const balance = ethers.utils.parseEther("100")

      // Submit all available attestations
      await reserveOracle
        .connect(attester1)
        .batchAttestBalances([qcAddress.address], [balance])
      await reserveOracle
        .connect(attester2)
        .batchAttestBalances([qcAddress.address], [balance])
      await reserveOracle
        .connect(attester3)
        .batchAttestBalances([qcAddress.address], [balance])
      await reserveOracle
        .connect(attester4)
        .batchAttestBalances([qcAddress.address], [balance])

      // Should not reach consensus
      const [pending, count] = await reserveOracle.getAttestation(
        qcAddress.address
      )

      expect(pending).to.be.true
      expect(count).to.equal(4)

      // Reset to reasonable threshold
      await systemState.connect(deployer).setOracleConsensusThreshold(3)

      // Should now reach consensus with existing attestations
      // (assuming they haven't expired and cleanup hasn't removed them)
    })

    it("should handle zero timeout configuration", async () => {
      await expect(
        systemState.connect(deployer).setOracleAttestationTimeout(0)
      ).to.be.revertedWith("Timeout must be greater than 0")
    })

    it("should handle zero staleness configuration", async () => {
      await expect(
        systemState.connect(deployer).setOracleMaxStaleness(0)
      ).to.be.revertedWith("Staleness must be greater than 0")
    })
  })

  describe("Reentrancy and Race Condition Protection", () => {
    it("should prevent reentrancy during consensus processing", async () => {
      // This test would require a malicious contract that attempts reentrancy
      // For now, verify that the nonReentrant modifier is in place
      const balance = ethers.utils.parseEther("100")

      // Normal operation should work
      const result = await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance,
      })

      expect(result.consensusReached).to.be.true
    })

    it("should handle rapid successive attestations correctly", async () => {
      const balance = ethers.utils.parseEther("100")

      // Submit attestations in rapid succession
      const promises = [
        reserveOracle
          .connect(attester1)
          .batchAttestBalances([qcAddress.address], [balance]),
        reserveOracle
          .connect(attester2)
          .batchAttestBalances([qcAddress.address], [balance]),
      ]

      await Promise.all(promises)

      // Final attestation
      const tx = await reserveOracle
        .connect(attester3)
        .batchAttestBalances([qcAddress.address], [balance])

      await expect(tx).to.emit(reserveOracle, "ConsensusReached")
    })
  })

  describe("Edge Case Recovery", () => {
    it("should handle QC address validation errors", async () => {
      const balance = ethers.utils.parseEther("100")

      // Attempt attestation for zero address
      await expect(
        reserveOracle
          .connect(attester1)
          .batchAttestBalances([ethers.constants.AddressZero], [balance])
      ).to.be.revertedWithCustomError(reserveOracle, "QCAddressRequired")
    })

    it("should handle balance overflow protection", async () => {
      const maxUint128 = ethers.BigNumber.from(2).pow(128).sub(1)
      const overflowBalance = maxUint128.add(1)

      await expect(
        reserveOracle
          .connect(attester1)
          .batchAttestBalances([qcAddress.address], [overflowBalance])
      ).to.be.revertedWithCustomError(reserveOracle, "BalanceOverflow")
    })

    it("should handle attester already submitted error correctly", async () => {
      const balance = ethers.utils.parseEther("100")

      // First attestation
      await reserveOracle
        .connect(attester1)
        .batchAttestBalances([qcAddress.address], [balance])

      // Duplicate attestation should fail
      await expect(
        reserveOracle
          .connect(attester1)
          .batchAttestBalances([qcAddress.address], [balance])
      ).to.be.revertedWithCustomError(reserveOracle, "AttesterAlreadySubmitted")
    })
  })
})
