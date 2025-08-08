import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  WatchdogEnforcer,
  QCReserveLedger,
  QCManager,
  QCData,
  SystemState,
} from "../../typechain"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("WatchdogEnforcer Escalation", () => {
  let deployer: SignerWithAddress
  let watchdog: SignerWithAddress
  let qcAddress: SignerWithAddress
  let pauser: SignerWithAddress
  let thirdParty: SignerWithAddress

  let watchdogEnforcer: WatchdogEnforcer
  let systemState: SystemState

  // Mock contracts
  let mockReserveLedger: FakeContract<QCReserveLedger>
  let mockQcManager: FakeContract<QCManager>
  let mockQcData: FakeContract<QCData>

  // Role constants
  let PAUSER_ROLE: string
  let ARBITER_ROLE: string

  // Reason codes
  let INSUFFICIENT_RESERVES: string
  let STALE_ATTESTATIONS: string
  let SUSTAINED_RESERVE_VIOLATION: string

  // Test constants
  const ESCALATION_DELAY = 45 * 60 // 45 minutes in seconds
  const RESERVE_AMOUNT = ethers.utils.parseEther("10")
  const REQUIRED_AMOUNT = ethers.utils.parseEther("12")

  before(async () => {
    const signers = await ethers.getSigners()
    deployer = signers[0]
    watchdog = signers[1]
    qcAddress = signers[2]
    pauser = signers[3]
    thirdParty = signers[4]

    // Generate role constants
    PAUSER_ROLE = ethers.utils.id("PAUSER_ROLE")
    ARBITER_ROLE = ethers.utils.id("ARBITER_ROLE")

    // Generate reason codes
    INSUFFICIENT_RESERVES = ethers.utils.id("INSUFFICIENT_RESERVES")
    STALE_ATTESTATIONS = ethers.utils.id("STALE_ATTESTATIONS")
    SUSTAINED_RESERVE_VIOLATION = ethers.utils.id("SUSTAINED_RESERVE_VIOLATION")
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy SystemState
    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy()
    await systemState.deployed()

    // Grant PAUSER_ROLE to pauser
    await systemState.grantRole(PAUSER_ROLE, pauser.address)

    // Create mock contracts
    mockReserveLedger = await smock.fake<QCReserveLedger>("QCReserveLedger")
    mockQcManager = await smock.fake<QCManager>("QCManager")
    mockQcData = await smock.fake<QCData>("QCData")

    // Deploy WatchdogEnforcer
    const WatchdogEnforcerFactory = await ethers.getContractFactory(
      "WatchdogEnforcer"
    )
    watchdogEnforcer = await WatchdogEnforcerFactory.deploy(
      mockReserveLedger.address,
      mockQcManager.address,
      mockQcData.address,
      systemState.address
    )
    await watchdogEnforcer.deployed()

    // Grant roles
    await systemState.grantRole(PAUSER_ROLE, watchdogEnforcer.address)
    await watchdogEnforcer.grantRole(ARBITER_ROLE, deployer.address)

    // Set up basic mock responses
    mockQcData.isQCRegistered.returns(true)
    mockQcData.getQCStatus.returns(0) // Active
    mockReserveLedger.getLatestReserves.returns(RESERVE_AMOUNT)
    mockReserveLedger.getRequiredReserves.returns(REQUIRED_AMOUNT)
    mockReserveLedger.getLastAttestationTime.returns(
      Math.floor(Date.now() / 1000)
    )
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Escalation Timer Mechanism", () => {
    it("should start escalation timer for INSUFFICIENT_RESERVES violations", async () => {
      // Set up insufficient reserves
      mockReserveLedger.getLatestReserves.returns(RESERVE_AMOUNT)
      mockReserveLedger.getRequiredReserves.returns(REQUIRED_AMOUNT)

      const tx = await watchdogEnforcer.enforceObjectiveViolation(
        qcAddress.address,
        INSUFFICIENT_RESERVES
      )
      const receipt = await tx.wait()
      const timestamp = (await ethers.provider.getBlock(receipt.blockNumber))
        .timestamp

      // Should start escalation timer
      expect(
        await watchdogEnforcer.criticalViolationTimestamps(qcAddress.address)
      ).to.equal(timestamp)

      // Should emit CriticalViolationDetected event
      await expect(tx)
        .to.emit(watchdogEnforcer, "CriticalViolationDetected")
        .withArgs(
          qcAddress.address,
          INSUFFICIENT_RESERVES,
          deployer.address,
          timestamp,
          timestamp + ESCALATION_DELAY
        )
    })

    it("should NOT start escalation timer for STALE_ATTESTATIONS violations", async () => {
      // Set up stale attestations
      mockReserveLedger.getLastAttestationTime.returns(
        Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60
      ) // 8 days old

      const tx = await watchdogEnforcer.enforceObjectiveViolation(
        qcAddress.address,
        STALE_ATTESTATIONS
      )

      // Should NOT start escalation timer
      expect(
        await watchdogEnforcer.criticalViolationTimestamps(qcAddress.address)
      ).to.equal(0)

      // Should NOT emit CriticalViolationDetected event
      await expect(tx).to.not.emit(
        watchdogEnforcer,
        "CriticalViolationDetected"
      )
    })

    it("should set QC to UnderReview for both violation types", async () => {
      // Test INSUFFICIENT_RESERVES
      await watchdogEnforcer.enforceObjectiveViolation(
        qcAddress.address,
        INSUFFICIENT_RESERVES
      )
      expect(mockQcManager.requestStatusChange).to.have.been.calledWith(
        qcAddress.address,
        1, // UnderReview
        INSUFFICIENT_RESERVES
      )

      // Reset and test STALE_ATTESTATIONS
      mockQcManager.requestStatusChange.reset()
      mockReserveLedger.getLastAttestationTime.returns(
        Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60
      )

      await watchdogEnforcer.enforceObjectiveViolation(
        qcAddress.address,
        STALE_ATTESTATIONS
      )
      expect(mockQcManager.requestStatusChange).to.have.been.calledWith(
        qcAddress.address,
        1, // UnderReview
        STALE_ATTESTATIONS
      )
    })
  })

  describe("checkEscalation Function", () => {
    beforeEach(async () => {
      // Set up insufficient reserves and trigger violation
      await watchdogEnforcer.enforceObjectiveViolation(
        qcAddress.address,
        INSUFFICIENT_RESERVES
      )
      // Set QC status to UnderReview
      mockQcData.getQCStatus.returns(1) // UnderReview
    })

    it("should revert if no escalation timer exists", async () => {
      await expect(
        watchdogEnforcer.checkEscalation(thirdParty.address) // QC with no timer
      ).to.be.revertedWith("ViolationNotFound")
    })

    it("should revert if escalation delay not reached", async () => {
      // Try to escalate immediately
      await expect(
        watchdogEnforcer.checkEscalation(qcAddress.address)
      ).to.be.revertedWith("Escalation delay not yet reached")
    })

    it("should escalate to emergency pause after delay", async () => {
      // Fast-forward time past escalation delay
      await helpers.time.increase(ESCALATION_DELAY + 1)

      const tx = await watchdogEnforcer
        .connect(watchdog)
        .checkEscalation(qcAddress.address)

      // Should trigger emergency pause
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be
        .true

      // Should emit ViolationEscalated event
      await expect(tx)
        .to.emit(watchdogEnforcer, "ViolationEscalated")
        .withArgs(
          qcAddress.address,
          SUSTAINED_RESERVE_VIOLATION,
          watchdog.address,
          await helpers.time.latest()
        )

      // Should clear the escalation timer
      expect(
        await watchdogEnforcer.criticalViolationTimestamps(qcAddress.address)
      ).to.equal(0)
    })

    it("should clear timer if QC status changed to Active", async () => {
      // Change QC status back to Active
      mockQcData.getQCStatus.returns(0) // Active

      // Fast-forward time past escalation delay
      await helpers.time.increase(ESCALATION_DELAY + 1)

      const tx = await watchdogEnforcer.checkEscalation(qcAddress.address)

      // Should NOT trigger emergency pause
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be
        .false

      // Should emit EscalationTimerCleared event
      await expect(tx)
        .to.emit(watchdogEnforcer, "EscalationTimerCleared")
        .withArgs(
          qcAddress.address,
          deployer.address,
          await helpers.time.latest()
        )

      // Should clear the escalation timer
      expect(
        await watchdogEnforcer.criticalViolationTimestamps(qcAddress.address)
      ).to.equal(0)
    })

    it("should allow anyone to call checkEscalation", async () => {
      // Fast-forward time past escalation delay
      await helpers.time.increase(ESCALATION_DELAY + 1)

      // Third party should be able to escalate
      await expect(
        watchdogEnforcer.connect(thirdParty).checkEscalation(qcAddress.address)
      ).to.not.be.reverted
    })
  })

  describe("clearEscalationTimer Function", () => {
    beforeEach(async () => {
      // Set up insufficient reserves and trigger violation
      await watchdogEnforcer.enforceObjectiveViolation(
        qcAddress.address,
        INSUFFICIENT_RESERVES
      )
    })

    it("should clear timer when QC returns to Active status", async () => {
      // Change QC status back to Active
      mockQcData.getQCStatus.returns(0) // Active

      const tx = await watchdogEnforcer
        .connect(watchdog)
        .clearEscalationTimer(qcAddress.address)

      // Should clear the escalation timer
      expect(
        await watchdogEnforcer.criticalViolationTimestamps(qcAddress.address)
      ).to.equal(0)

      // Should emit EscalationTimerCleared event
      await expect(tx)
        .to.emit(watchdogEnforcer, "EscalationTimerCleared")
        .withArgs(
          qcAddress.address,
          watchdog.address,
          await helpers.time.latest()
        )
    })

    it("should NOT clear timer if QC is still UnderReview", async () => {
      // Keep QC status as UnderReview
      mockQcData.getQCStatus.returns(1) // UnderReview

      await watchdogEnforcer.clearEscalationTimer(qcAddress.address)

      // Should NOT clear the escalation timer
      expect(
        await watchdogEnforcer.criticalViolationTimestamps(qcAddress.address)
      ).to.not.equal(0)
    })

    it("should NOT clear timer if no timer exists", async () => {
      // Try to clear timer for QC with no violation
      await watchdogEnforcer.clearEscalationTimer(thirdParty.address)

      // Should not revert, but no event should be emitted
      expect(
        await watchdogEnforcer.criticalViolationTimestamps(thirdParty.address)
      ).to.equal(0)
    })

    it("should allow anyone to call clearEscalationTimer", async () => {
      // Change QC status back to Active
      mockQcData.getQCStatus.returns(0) // Active

      // Third party should be able to clear timer
      await expect(
        watchdogEnforcer
          .connect(thirdParty)
          .clearEscalationTimer(qcAddress.address)
      ).to.not.be.reverted
    })
  })

  describe("Integration with Emergency Pause System", () => {
    it("should successfully emergency pause QC through escalation", async () => {
      // Set up violation and wait for escalation
      await watchdogEnforcer.enforceObjectiveViolation(
        qcAddress.address,
        INSUFFICIENT_RESERVES
      )
      mockQcData.getQCStatus.returns(1) // UnderReview
      await helpers.time.increase(ESCALATION_DELAY + 1)

      // Escalate
      await watchdogEnforcer.checkEscalation(qcAddress.address)

      // Verify emergency pause state
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be
        .true
      expect(await systemState.getQCPauseTimestamp(qcAddress.address)).to.be.gt(
        0
      )
    })

    it("should use SUSTAINED_RESERVE_VIOLATION reason code", async () => {
      // Set up violation and escalate
      await watchdogEnforcer.enforceObjectiveViolation(
        qcAddress.address,
        INSUFFICIENT_RESERVES
      )
      mockQcData.getQCStatus.returns(1) // UnderReview
      await helpers.time.increase(ESCALATION_DELAY + 1)

      const tx = await watchdogEnforcer.checkEscalation(qcAddress.address)

      // Should emit ViolationEscalated with SUSTAINED_RESERVE_VIOLATION
      await expect(tx)
        .to.emit(watchdogEnforcer, "ViolationEscalated")
        .withArgs(
          qcAddress.address,
          SUSTAINED_RESERVE_VIOLATION,
          deployer.address,
          await helpers.time.latest()
        )
    })

    it("should require PAUSER_ROLE for escalation to work", async () => {
      // Remove PAUSER_ROLE from WatchdogEnforcer
      await systemState.revokeRole(PAUSER_ROLE, watchdogEnforcer.address)

      // Set up violation and try to escalate
      await watchdogEnforcer.enforceObjectiveViolation(
        qcAddress.address,
        INSUFFICIENT_RESERVES
      )
      mockQcData.getQCStatus.returns(1) // UnderReview
      await helpers.time.increase(ESCALATION_DELAY + 1)

      // Should revert due to lack of PAUSER_ROLE
      await expect(
        watchdogEnforcer.checkEscalation(qcAddress.address)
      ).to.be.revertedWith(
        `AccessControl: account ${watchdogEnforcer.address.toLowerCase()} is missing role ${PAUSER_ROLE}`
      )
    })
  })

  describe("Edge Cases and Error Conditions", () => {
    it("should handle multiple QCs with different escalation timers", async () => {
      const [, , , qc2, qc3] = await ethers.getSigners()

      // Set up violations for multiple QCs at different times
      await watchdogEnforcer.enforceObjectiveViolation(
        qcAddress.address,
        INSUFFICIENT_RESERVES
      )

      await helpers.time.increase(10 * 60) // 10 minutes later
      await watchdogEnforcer.enforceObjectiveViolation(
        qc2.address,
        INSUFFICIENT_RESERVES
      )

      await helpers.time.increase(10 * 60) // 10 minutes later
      await watchdogEnforcer.enforceObjectiveViolation(
        qc3.address,
        INSUFFICIENT_RESERVES
      )

      // Verify different timestamps
      const timestamp1 = await watchdogEnforcer.criticalViolationTimestamps(
        qcAddress.address
      )
      const timestamp2 = await watchdogEnforcer.criticalViolationTimestamps(
        qc2.address
      )
      const timestamp3 = await watchdogEnforcer.criticalViolationTimestamps(
        qc3.address
      )

      expect(timestamp2).to.be.gt(timestamp1)
      expect(timestamp3).to.be.gt(timestamp2)
    })

    it("should handle re-triggering violation for same QC", async () => {
      // Trigger initial violation
      const tx1 = await watchdogEnforcer.enforceObjectiveViolation(
        qcAddress.address,
        INSUFFICIENT_RESERVES
      )
      const receipt1 = await tx1.wait()
      const initialTimestamp = (
        await ethers.provider.getBlock(receipt1.blockNumber)
      ).timestamp

      // Wait some time and trigger again
      await helpers.time.increase(10 * 60) // 10 minutes
      const tx2 = await watchdogEnforcer.enforceObjectiveViolation(
        qcAddress.address,
        INSUFFICIENT_RESERVES
      )
      const receipt2 = await tx2.wait()
      const newTimestamp = (
        await ethers.provider.getBlock(receipt2.blockNumber)
      ).timestamp

      // Should update the timestamp
      expect(
        await watchdogEnforcer.criticalViolationTimestamps(qcAddress.address)
      ).to.equal(newTimestamp)
      expect(newTimestamp).to.be.gt(initialTimestamp)
    })

    it("should handle QC status changing to Revoked", async () => {
      // Set up violation
      await watchdogEnforcer.enforceObjectiveViolation(
        qcAddress.address,
        INSUFFICIENT_RESERVES
      )
      mockQcData.getQCStatus.returns(2) // Revoked
      await helpers.time.increase(ESCALATION_DELAY + 1)

      // Should clear timer instead of escalating
      const tx = await watchdogEnforcer.checkEscalation(qcAddress.address)

      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be
        .false
      expect(
        await watchdogEnforcer.criticalViolationTimestamps(qcAddress.address)
      ).to.equal(0)

      await expect(tx).to.emit(watchdogEnforcer, "EscalationTimerCleared")
    })
  })

  describe("Constants and Configuration", () => {
    it("should have correct ESCALATION_DELAY constant", async () => {
      expect(await watchdogEnforcer.ESCALATION_DELAY()).to.equal(45 * 60) // 45 minutes
    })

    it("should have correct reason codes", async () => {
      expect(await watchdogEnforcer.INSUFFICIENT_RESERVES()).to.equal(
        INSUFFICIENT_RESERVES
      )
      expect(await watchdogEnforcer.STALE_ATTESTATIONS()).to.equal(
        STALE_ATTESTATIONS
      )
      expect(await watchdogEnforcer.SUSTAINED_RESERVE_VIOLATION()).to.equal(
        SUSTAINED_RESERVE_VIOLATION
      )
    })
  })
})
