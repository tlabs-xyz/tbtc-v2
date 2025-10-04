import { expect } from "chai"
import { ethers } from "hardhat"
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import {
  SystemState,
  QCManager,
  QCData,
  ReserveOracle,
  AccountControl,
  IQCPauseManager,
  IQCWalletManager,
} from "../../../typechain"
import { deployQCManagerFixture } from "../fixtures/account-control-fixtures"
import * as LibraryLinkingHelper from "../helpers/library-linking-helper"

describe("SystemState - Governance Configurable Parameters", () => {
  let systemState: SystemState
  let qcManager: QCManager
  let qcData: QCData

  let owner: SignerWithAddress
  let operations: SignerWithAddress
  let governance: SignerWithAddress
  let user: SignerWithAddress
  let qc1: SignerWithAddress

  // Role constants
  const OPERATIONS_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("OPERATIONS_ROLE")
  )

  const GOVERNANCE_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("GOVERNANCE_ROLE")
  )

  const REGISTRAR_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("REGISTRAR_ROLE")
  )

  beforeEach(async () => {
    ;[owner, operations, , user, qc1] = await ethers.getSigners()

    // Load fixture
    const fixture = await loadFixture(deployQCManagerFixture)
    systemState = fixture.systemState
    qcManager = fixture.qcManager
    qcData = fixture.qcData
    governance = fixture.governance // Use fixture's governance account

    // Grant roles
    await systemState.grantRole(OPERATIONS_ROLE, operations.address)
    // QCManager already has governance role set up in the fixture
    await qcManager.grantRole(REGISTRAR_ROLE, owner.address)
  })

  describe("Self-Pause Timeout Configuration", () => {
    it("should have correct default value", async () => {
      expect(await systemState.selfPauseTimeout()).to.equal(48 * 60 * 60) // 48 hours
    })

    it("should allow updating within bounds", async () => {
      const newTimeout = 36 * 60 * 60 // 36 hours

      await systemState.connect(operations).setSelfPauseTimeout(newTimeout)

      expect(await systemState.selfPauseTimeout()).to.equal(newTimeout)
    })

    it("should emit event on update", async () => {
      const oldTimeout = await systemState.selfPauseTimeout()
      const newTimeout = 72 * 60 * 60 // 72 hours

      await expect(
        systemState.connect(operations).setSelfPauseTimeout(newTimeout)
      )
        .to.emit(systemState, "SelfPauseTimeoutUpdated")
        .withArgs(oldTimeout, newTimeout)
    })

    it("should enforce minimum bound", async () => {
      const tooShort = 24 * 60 * 60 - 1 // < 24 hours

      await expect(
        systemState.connect(operations).setSelfPauseTimeout(tooShort)
      ).to.be.revertedWith("DurationOutOfBounds")
    })

    it("should enforce maximum bound", async () => {
      const tooLong = 7 * 24 * 60 * 60 + 1 // > 7 days

      await expect(
        systemState.connect(operations).setSelfPauseTimeout(tooLong)
      ).to.be.revertedWith("DurationOutOfBounds")
    })

    it("should enforce access control", async () => {
      await expect(
        systemState.connect(user).setSelfPauseTimeout(48 * 60 * 60)
      ).to.be.revertedWith("AccessControl:")
    })

    it("should have immutable bounds", async () => {
      expect(await systemState.MIN_SELF_PAUSE_TIMEOUT()).to.equal(24 * 60 * 60)
      expect(await systemState.MAX_SELF_PAUSE_TIMEOUT()).to.equal(
        7 * 24 * 60 * 60
      )
    })
  })

  describe("Escalation Warning Period Configuration", () => {
    it("should have correct default value", async () => {
      expect(await systemState.escalationWarningPeriod()).to.equal(1 * 60 * 60) // 1 hour
    })

    it("should allow updating within bounds", async () => {
      const newPeriod = 2 * 60 * 60 // 2 hours

      await systemState
        .connect(operations)
        .setEscalationWarningPeriod(newPeriod)

      expect(await systemState.escalationWarningPeriod()).to.equal(newPeriod)
    })

    it("should emit event on update", async () => {
      const oldPeriod = await systemState.escalationWarningPeriod()
      const newPeriod = 4 * 60 * 60 // 4 hours

      await expect(
        systemState.connect(operations).setEscalationWarningPeriod(newPeriod)
      )
        .to.emit(systemState, "EscalationWarningPeriodUpdated")
        .withArgs(oldPeriod, newPeriod)
    })

    it("should enforce minimum bound", async () => {
      const tooShort = 30 * 60 - 1 // < 30 minutes

      await expect(
        systemState.connect(operations).setEscalationWarningPeriod(tooShort)
      ).to.be.revertedWith("DurationOutOfBounds")
    })

    it("should enforce maximum bound", async () => {
      const tooLong = 24 * 60 * 60 + 1 // > 24 hours

      await expect(
        systemState.connect(operations).setEscalationWarningPeriod(tooLong)
      ).to.be.revertedWith("DurationOutOfBounds")
    })

    it("should have immutable bounds", async () => {
      expect(await systemState.MIN_ESCALATION_WARNING()).to.equal(30 * 60)
      expect(await systemState.MAX_ESCALATION_WARNING()).to.equal(24 * 60 * 60)
    })
  })

  describe("Min Sync Interval Configuration", () => {
    it("should have correct default value", async () => {
      expect(await systemState.minSyncInterval()).to.equal(5 * 60) // 5 minutes
    })

    it("should allow updating within bounds", async () => {
      const newInterval = 10 * 60 // 10 minutes

      await systemState.connect(operations).setMinSyncInterval(newInterval)

      expect(await systemState.minSyncInterval()).to.equal(newInterval)
    })

    it("should emit event on update", async () => {
      const oldInterval = await systemState.minSyncInterval()
      const newInterval = 30 * 60 // 30 minutes

      await expect(
        systemState.connect(operations).setMinSyncInterval(newInterval)
      )
        .to.emit(systemState, "MinSyncIntervalUpdated")
        .withArgs(oldInterval, newInterval)
    })

    it("should enforce minimum bound", async () => {
      const tooShort = 60 - 1 // < 1 minute

      await expect(
        systemState.connect(operations).setMinSyncInterval(tooShort)
      ).to.be.revertedWith("DurationOutOfBounds")
    })

    it("should enforce maximum bound", async () => {
      const tooLong = 60 * 60 + 1 // > 1 hour

      await expect(
        systemState.connect(operations).setMinSyncInterval(tooLong)
      ).to.be.revertedWith("DurationOutOfBounds")
    })

    it("should have immutable bounds", async () => {
      expect(await systemState.MIN_SYNC_INTERVAL_BOUND()).to.equal(60)
      expect(await systemState.MAX_SYNC_INTERVAL()).to.equal(60 * 60)
    })
  })

  describe("Integration with QCManager", () => {
    beforeEach(async () => {
      // Register a QC
      await qcManager
        .connect(governance)
        .registerQC(qc1.address, ethers.utils.parseEther("1000"))

      // Self-pause the QC
      await qcManager.connect(qc1).selfPause(1) // PauseLevel.WARNING = 1
    })

    it("should use configured self-pause timeout for escalation", async () => {
      // Update timeout to 24 hours
      await systemState.connect(operations).setSelfPauseTimeout(24 * 60 * 60)

      // Check escalation eligibility before timeout
      const pauseTime = await qcManager.qcPauseTimestamp(qc1.address)
      expect(pauseTime).to.be.gt(0)

      // Not eligible yet
      const [eligible1, timeUntil1] = await qcManager.isQCEligibleForEscalation(
        qc1.address
      )

      expect(eligible1).to.be.false
      expect(timeUntil1).to.be.closeTo(24 * 60 * 60, 5)

      // Advance time past new timeout
      await time.increase(24 * 60 * 60 + 1)

      // Now eligible
      const [eligible2, timeUntil2] = await qcManager.isQCEligibleForEscalation(
        qc1.address
      )

      expect(eligible2).to.be.true
      expect(timeUntil2).to.equal(0)
    })

    it("should use configured warning period for escalation warnings", async () => {
      // Update warning period to 2 hours
      await systemState
        .connect(operations)
        .setEscalationWarningPeriod(2 * 60 * 60)

      // Update self-pause timeout to 24 hours for testing
      await systemState.connect(operations).setSelfPauseTimeout(24 * 60 * 60)

      // Advance time to warning period (24 - 2 = 22 hours)
      await time.increase(22 * 60 * 60)

      // Should be within warning period
      const [eligible, timeUntil] = await qcManager.isQCEligibleForEscalation(
        qc1.address
      )

      expect(eligible).to.be.false
      expect(timeUntil).to.be.closeTo(2 * 60 * 60, 5)

      // Try to emit warning
      await expect(
        qcManager.checkAndEmitEscalationWarning(qc1.address)
      ).to.emit(qcManager, "QCEscalationWarning")
    })

    it("should respect min sync interval", async () => {
      // Update min sync interval to 10 minutes
      await systemState.connect(operations).setMinSyncInterval(10 * 60)

      // Grant monitor role
      const MONITOR_ROLE = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("MONITOR_ROLE")
      )

      await qcManager.grantRole(MONITOR_ROLE, operations.address)

      // First sync should succeed
      await qcManager
        .connect(operations)
        .syncOracleToAccountControl(qc1.address)

      // Immediate second sync should fail
      await expect(
        qcManager.connect(operations).syncOracleToAccountControl(qc1.address)
      ).to.be.revertedWith("SyncTooFrequent")

      // Advance time past interval
      await time.increase(10 * 60 + 1)

      // Now sync should succeed
      await expect(
        qcManager.connect(operations).syncOracleToAccountControl(qc1.address)
      ).to.not.be.reverted
    })
  })

  describe("Parameter Validation", () => {
    it("should validate all parameters are within reasonable bounds", async () => {
      // Self-pause timeout
      const selfPause = await systemState.selfPauseTimeout()
      expect(selfPause).to.be.gte(24 * 60 * 60) // >= 24 hours
      expect(selfPause).to.be.lte(7 * 24 * 60 * 60) // <= 7 days

      // Escalation warning period
      const warning = await systemState.escalationWarningPeriod()
      expect(warning).to.be.gte(30 * 60) // >= 30 minutes
      expect(warning).to.be.lte(24 * 60 * 60) // <= 24 hours

      // Min sync interval
      const sync = await systemState.minSyncInterval()
      expect(sync).to.be.gte(60) // >= 1 minute
      expect(sync).to.be.lte(60 * 60) // <= 1 hour
    })

    it("should ensure warning period is less than self-pause timeout", async () => {
      // This is a business logic test - warning should come before escalation
      const selfPause = await systemState.selfPauseTimeout()
      const warning = await systemState.escalationWarningPeriod()

      expect(warning).to.be.lt(selfPause)
    })
  })

  describe("Multi-Parameter Updates", () => {
    it("should allow updating multiple parameters in sequence", async () => {
      // Update all three parameters
      await systemState.connect(operations).setSelfPauseTimeout(36 * 60 * 60)
      await systemState
        .connect(operations)
        .setEscalationWarningPeriod(2 * 60 * 60)
      await systemState.connect(operations).setMinSyncInterval(10 * 60)

      // Verify all updates
      expect(await systemState.selfPauseTimeout()).to.equal(36 * 60 * 60)
      expect(await systemState.escalationWarningPeriod()).to.equal(2 * 60 * 60)
      expect(await systemState.minSyncInterval()).to.equal(10 * 60)
    })

    it("should maintain parameter consistency", async () => {
      // Set self-pause to minimum
      await systemState.connect(operations).setSelfPauseTimeout(24 * 60 * 60)

      // Warning period should still be less than timeout
      const warning = await systemState.escalationWarningPeriod()
      const timeout = await systemState.selfPauseTimeout()
      expect(warning).to.be.lt(timeout)
    })
  })

  describe("Access Control", () => {
    it("should only allow OPERATIONS_ROLE to update parameters", async () => {
      // Test with unauthorized users
      const unauthorizedUsers = [user, governance]

      for (const unauthorizedUser of unauthorizedUsers) {
        await expect(
          systemState
            .connect(unauthorizedUser)
            .setSelfPauseTimeout(48 * 60 * 60)
        ).to.be.revertedWith("AccessControl:")

        await expect(
          systemState
            .connect(unauthorizedUser)
            .setEscalationWarningPeriod(1 * 60 * 60)
        ).to.be.revertedWith("AccessControl:")

        await expect(
          systemState.connect(unauthorizedUser).setMinSyncInterval(5 * 60)
        ).to.be.revertedWith("AccessControl:")
      }
    })

    it("should allow owner to grant OPERATIONS_ROLE", async () => {
      // Grant role to new operator
      await systemState.grantRole(OPERATIONS_ROLE, user.address)

      // New operator should be able to update
      await expect(systemState.connect(user).setSelfPauseTimeout(48 * 60 * 60))
        .to.not.be.reverted
    })
  })
})
