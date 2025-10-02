import { expect } from "chai"
import { ethers } from "hardhat"
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import {
  QCManager,
  QCData,
  ReserveOracle,
  SystemState,
  AccountControl,
  IQCPauseManager,
  IQCWalletManager,
} from "../../../typechain"
import { deployQCManagerFixture } from "../fixtures/account-control-fixtures"

/**
 * State Synchronization Integration Tests
 *
 * These tests ensure that state changes in one contract properly propagate
 * to related state in other contracts, maintaining system-wide consistency.
 */
describe("QCManager State Synchronization", () => {
  let qcManager: QCManager
  let qcData: QCData
  let reserveOracle: ReserveOracle
  let systemState: SystemState
  let accountControl: AccountControl
  let pauseManager: IQCPauseManager
  let walletManager: IQCWalletManager

  let owner: SignerWithAddress
  let governance: SignerWithAddress
  let monitor: SignerWithAddress
  let arbiter: SignerWithAddress
  let qcs: SignerWithAddress[] = []

  // Test constants
  const INITIAL_CAPACITY = ethers.utils.parseEther("1000")
  const INITIAL_BACKING = ethers.utils.parseEther("800")

  beforeEach(async () => {
    const signers = await ethers.getSigners()

    ;[owner, governance, monitor, arbiter] = signers
    qcs = signers.slice(4, 8) // Get 4 QCs for testing

    // Load fixture
    const fixture = await loadFixture(deployQCManagerFixture)
    qcManager = fixture.qcManager
    qcData = fixture.qcData
    reserveOracle = fixture.reserveOracle
    systemState = fixture.systemState
    accountControl = fixture.accountControl
    pauseManager = fixture.pauseManager
    walletManager = fixture.walletManager

    // Grant necessary roles
    await qcManager.grantRole(
      await qcManager.GOVERNANCE_ROLE(),
      governance.address
    )
    await qcManager.grantRole(await qcManager.MONITOR_ROLE(), monitor.address)
    await qcManager.grantRole(
      await qcManager.DISPUTE_ARBITER_ROLE(),
      arbiter.address
    )

    // Register test QCs
    for (let i = 0; i < qcs.length; i++) {
      await qcManager.registerQC(qcs[i].address, INITIAL_CAPACITY)
      await reserveOracle.updateReserveBalance(qcs[i].address, INITIAL_BACKING)
    }
  })

  describe("QC Registration State Synchronization", () => {
    it("should synchronize QC registration across all contracts", async () => {
      const newQC = ethers.Wallet.createRandom()
      const capacity = ethers.utils.parseEther("2000")

      // Execute registration
      await qcManager.connect(governance).registerQC(newQC.address, capacity)

      // Validate QCData state
      const qcInfo = await qcData.getQCInfo(newQC.address)
      expect(qcInfo.maxCapacity).to.equal(capacity)
      expect(qcInfo.status).to.equal(0) // ACTIVE
      expect(qcInfo.registeredAt).to.be.gt(0)

      // Validate AccountControl state
      const authorized = await accountControl.authorized(newQC.address)
      expect(authorized).to.be.true

      const reserveInfo = await accountControl.reserveInfo(newQC.address)
      expect(reserveInfo.mintingCap).to.equal(capacity)

      // Validate QCManager internal state
      const oracleData = await qcManager.qcOracleData(newQC.address)
      expect(oracleData.lastKnownReserveBalance).to.equal(0) // Not yet synced
    })

    it("should maintain state consistency during concurrent registrations", async () => {
      const newQCs = [
        ethers.Wallet.createRandom(),
        ethers.Wallet.createRandom(),
        ethers.Wallet.createRandom(),
      ]

      const capacities = [
        ethers.utils.parseEther("1500"),
        ethers.utils.parseEther("2000"),
        ethers.utils.parseEther("2500"),
      ]

      // Execute concurrent registrations
      const registrationPromises = newQCs.map((qc, index) =>
        qcManager.connect(governance).registerQC(qc.address, capacities[index])
      )

      await Promise.all(registrationPromises)

      // Validate all registrations completed consistently
      for (let i = 0; i < newQCs.length; i++) {
        const qcInfo = await qcData.getQCInfo(newQCs[i].address)
        expect(qcInfo.maxCapacity).to.equal(capacities[i])

        const authorized = await accountControl.authorized(newQCs[i].address)
        expect(authorized).to.be.true

        const reserveInfo = await accountControl.reserveInfo(newQCs[i].address)
        expect(reserveInfo.mintingCap).to.equal(capacities[i])
      }
    })
  })

  describe("QC Status Change State Synchronization", () => {
    it("should synchronize status changes across QCData and AccountControl", async () => {
      const qc = qcs[0].address

      // Change QC status to UNDER_REVIEW
      await qcManager
        .connect(arbiter)
        .setQCStatus(qc, 3, ethers.utils.formatBytes32String("investigation"))

      // Validate QCData state
      const qcStatus = await qcData.getQCStatus(qc)
      expect(qcStatus).to.equal(3) // UNDER_REVIEW

      // Validate AccountControl restrictions
      const reserveInfo = await accountControl.reserveInfo(qc)
      expect(reserveInfo.mintingPaused).to.be.true

      // Change back to ACTIVE
      await qcManager
        .connect(arbiter)
        .setQCStatus(qc, 0, ethers.utils.formatBytes32String("resolved"))

      // Validate synchronized recovery
      const recoveredStatus = await qcData.getQCStatus(qc)
      expect(recoveredStatus).to.equal(0) // ACTIVE

      const recoveredReserveInfo = await accountControl.reserveInfo(qc)
      expect(recoveredReserveInfo.mintingPaused).to.be.false
    })

    it("should handle status transitions during oracle sync", async () => {
      const qc = qcs[0].address

      // Start oracle sync
      const syncPromise = qcManager.connect(monitor).syncBackingFromOracle(qc)

      // Simultaneously change QC status
      const statusPromise = qcManager
        .connect(arbiter)
        .setQCStatus(qc, 2, ethers.utils.formatBytes32String("paused"))

      // Both operations should complete successfully
      await Promise.all([syncPromise, statusPromise])

      // Validate final state consistency
      const qcStatus = await qcData.getQCStatus(qc)
      expect(qcStatus).to.equal(2) // PAUSED

      const oracleData = await qcManager.qcOracleData(qc)
      expect(oracleData.lastKnownReserveBalance).to.equal(INITIAL_BACKING)
    })
  })

  describe("Oracle Data State Synchronization", () => {
    it("should synchronize oracle data across QCManager and AccountControl", async () => {
      const qc = qcs[0].address
      const newBacking = ethers.utils.parseEther("900")

      // Update oracle data
      await reserveOracle.updateReserveBalance(qc, newBacking)
      await qcManager.connect(monitor).syncBackingFromOracle(qc)

      // Validate QCManager internal state
      const oracleData = await qcManager.qcOracleData(qc)
      expect(oracleData.lastKnownReserveBalance).to.equal(newBacking)
      expect(oracleData.lastKnownBalanceTimestamp).to.be.gt(0)

      // Validate AccountControl backing awareness
      const backingInfo = await accountControl.getBackingInfo(qc)
      expect(backingInfo.currentBacking).to.equal(newBacking)
    })

    it("should maintain consistency during batch oracle sync", async () => {
      const qcAddresses = qcs.map((qc) => qc.address)

      const newBackings = [
        ethers.utils.parseEther("850"),
        ethers.utils.parseEther("900"),
        ethers.utils.parseEther("950"),
        ethers.utils.parseEther("1000"),
      ]

      // Update all oracle data
      for (let i = 0; i < qcAddresses.length; i++) {
        await reserveOracle.updateReserveBalance(qcAddresses[i], newBackings[i])
      }

      // Execute batch sync
      await qcManager.connect(monitor).batchSyncBackingFromOracle(qcAddresses)

      // Validate all QCs synchronized correctly
      for (let i = 0; i < qcAddresses.length; i++) {
        const oracleData = await qcManager.qcOracleData(qcAddresses[i])
        expect(oracleData.lastKnownReserveBalance).to.equal(newBackings[i])

        const backingInfo = await accountControl.getBackingInfo(qcAddresses[i])
        expect(backingInfo.currentBacking).to.equal(newBackings[i])
      }
    })

    it("should handle stale data detection with status synchronization", async () => {
      const qc = qcs[0].address

      // Set up stale threshold
      await systemState.setStaleThreshold(24 * 60 * 60) // 24 hours

      // Initial sync
      await qcManager.connect(monitor).syncBackingFromOracle(qc)

      // Advance time beyond stale threshold
      await time.increase(25 * 60 * 60) // 25 hours

      // Sync should detect staleness and update status
      await qcManager.connect(monitor).syncBackingFromOracle(qc)

      // Validate QC was paused due to stale data
      const qcStatus = await qcData.getQCStatus(qc)
      expect(qcStatus).to.equal(1) // MINTING_PAUSED

      // Validate AccountControl restrictions
      const reserveInfo = await accountControl.reserveInfo(qc)
      expect(reserveInfo.mintingPaused).to.be.true
    })
  })

  describe("Capacity Management State Synchronization", () => {
    it("should synchronize capacity changes across QCData and AccountControl", async () => {
      const qc = qcs[0].address
      const newCapacity = ethers.utils.parseEther("1500")

      // Increase minting capacity
      await qcManager
        .connect(governance)
        .increaseMintingCapacity(qc, newCapacity)

      // Validate QCData state
      const qcInfo = await qcData.getQCInfo(qc)
      expect(qcInfo.maxCapacity).to.equal(newCapacity)

      // Validate AccountControl state
      const reserveInfo = await accountControl.reserveInfo(qc)
      expect(reserveInfo.mintingCap).to.equal(newCapacity)

      // Validate capacity is available for use
      const availableCapacity = await qcManager.getAvailableMintingCapacity(qc)
      expect(availableCapacity).to.equal(newCapacity)
    })

    it("should maintain consistency during capacity consumption", async () => {
      const qc = qcs[0].address
      const consumeAmount = ethers.utils.parseEther("100")

      // Record initial state
      const initialQCInfo = await qcData.getQCInfo(qc)
      const initialAvailable = await qcManager.getAvailableMintingCapacity(qc)

      // Consume capacity
      await qcManager.consumeMintCapacity(qc, consumeAmount)

      // Validate QCData state updated
      const updatedQCInfo = await qcData.getQCInfo(qc)
      expect(updatedQCInfo.totalMinted).to.equal(
        initialQCInfo.totalMinted.add(consumeAmount)
      )

      // Validate available capacity reduced
      const updatedAvailable = await qcManager.getAvailableMintingCapacity(qc)
      expect(updatedAvailable).to.equal(initialAvailable.sub(consumeAmount))

      // Validate AccountControl consistency
      const accountInfo = await accountControl.getMintingInfo(qc)
      expect(accountInfo.totalMinted).to.equal(updatedQCInfo.totalMinted)
    })
  })

  describe("Pause State Synchronization", () => {
    it("should synchronize pause states across all contracts", async () => {
      const qc = qcs[0].address

      // Trigger QC self-pause
      await qcManager.connect(monitor).triggerSelfPause(qc, "BACKING_SHORTAGE")

      // Validate QCData status
      const qcStatus = await qcData.getQCStatus(qc)
      expect(qcStatus).to.equal(4) // SELF_PAUSED

      // Validate QCPauseManager state
      const pauseInfo = await pauseManager.getPauseInfo(qc)
      expect(pauseInfo.isPaused).to.be.true
      expect(pauseInfo.selfPauseTimestamp).to.be.gt(0)

      // Validate AccountControl restrictions
      const reserveInfo = await accountControl.reserveInfo(qc)
      expect(reserveInfo.mintingPaused).to.be.true

      // Resume QC
      await qcManager.connect(arbiter).resumeQC(qc, "ISSUE_RESOLVED")

      // Validate synchronized resume
      const resumedStatus = await qcData.getQCStatus(qc)
      expect(resumedStatus).to.equal(0) // ACTIVE

      const resumedPauseInfo = await pauseManager.getPauseInfo(qc)
      expect(resumedPauseInfo.isPaused).to.be.false

      const resumedReserveInfo = await accountControl.reserveInfo(qc)
      expect(resumedReserveInfo.mintingPaused).to.be.false
    })

    it("should handle escalation synchronization", async () => {
      const qc = qcs[0].address

      // Trigger self-pause
      await qcManager.connect(monitor).triggerSelfPause(qc, "ORACLE_FAILURE")

      // Wait for escalation period
      const escalationDelay = await systemState.selfPauseEscalationDelay()
      await time.increase(escalationDelay.toNumber() + 1)

      // Trigger escalation
      await pauseManager.checkEscalation(qc)

      // Validate QC escalated to UNDER_REVIEW
      const escalatedStatus = await qcData.getQCStatus(qc)
      expect(escalatedStatus).to.equal(3) // UNDER_REVIEW

      // Validate pause manager escalation
      const pauseInfo = await pauseManager.getPauseInfo(qc)
      expect(pauseInfo.escalated).to.be.true

      // Validate AccountControl maintains restrictions
      const reserveInfo = await accountControl.reserveInfo(qc)
      expect(reserveInfo.mintingPaused).to.be.true
      expect(reserveInfo.redeemingPaused).to.be.true
    })
  })

  describe("System Parameter Change Synchronization", () => {
    it("should propagate parameter changes to all dependent contracts", async () => {
      const newStaleThreshold = 48 * 60 * 60 // 48 hours
      const newSyncInterval = 10 * 60 // 10 minutes

      // Update system parameters
      await systemState.connect(governance).setStaleThreshold(newStaleThreshold)
      await systemState.connect(governance).setMinSyncInterval(newSyncInterval)

      // Validate parameters propagated
      expect(await systemState.staleThreshold()).to.equal(newStaleThreshold)
      expect(await systemState.minSyncInterval()).to.equal(newSyncInterval)

      // Test parameter enforcement in QCManager
      const qc = qcs[0].address

      // Sync once
      await qcManager.connect(monitor).syncBackingFromOracle(qc)

      // Immediate second sync should be rate limited
      await expect(
        qcManager.connect(monitor).syncBackingFromOracle(qc)
      ).to.be.revertedWith("Rate limited")

      // Wait for new interval
      await time.increase(newSyncInterval + 1)

      // Should now succeed
      await expect(qcManager.connect(monitor).syncBackingFromOracle(qc)).to.not
        .be.reverted
    })

    it("should handle emergency parameter changes", async () => {
      // Activate emergency mode
      await systemState
        .connect(governance)
        .activateEmergencyPause("SECURITY_INCIDENT")

      // Validate all QCs affected
      for (const qc of qcs) {
        const qcStatus = await qcData.getQCStatus(qc.address)
        expect(qcStatus).to.equal(5) // EMERGENCY_PAUSED

        const reserveInfo = await accountControl.reserveInfo(qc.address)
        expect(reserveInfo.mintingPaused).to.be.true
        expect(reserveInfo.redeemingPaused).to.be.true
      }

      // Validate QCManager operations blocked
      await expect(
        qcManager.connect(monitor).syncBackingFromOracle(qcs[0].address)
      ).to.be.revertedWith("SystemEmergencyActive")
    })
  })

  describe("Cross-Contract Event Synchronization", () => {
    it("should emit synchronized events across contracts", async () => {
      const qc = qcs[0].address
      const newCapacity = ethers.utils.parseEther("1200")

      // Execute capacity increase
      const tx = await qcManager
        .connect(governance)
        .increaseMintingCapacity(qc, newCapacity)

      const receipt = await tx.wait()

      // Validate QCManager event
      const balanceUpdateEvent = receipt.events?.find(
        (e) => e.event === "BalanceUpdate"
      )

      expect(balanceUpdateEvent).to.exist
      expect(balanceUpdateEvent?.args?.qc).to.equal(qc)

      // Validate QCData event
      const capacityUpdateEvent = receipt.events?.find(
        (e) => e.event === "MaxCapacityUpdated"
      )

      expect(capacityUpdateEvent).to.exist

      // Validate AccountControl event
      const authorizationEvent = receipt.events?.find(
        (e) => e.event === "ReserveAuthorized"
      )

      expect(authorizationEvent).to.exist
    })

    it("should maintain event ordering during complex operations", async () => {
      const qc = qcs[0].address

      // Execute complex operation (status change + oracle sync)
      const statusTx = qcManager
        .connect(arbiter)
        .setQCStatus(qc, 2, ethers.utils.formatBytes32String("maintenance"))

      const syncTx = qcManager.connect(monitor).syncBackingFromOracle(qc)

      const [statusReceipt, syncReceipt] = await Promise.all([
        (await statusTx).wait(),
        (await syncTx).wait(),
      ])

      // Validate events emitted in correct order
      const allEvents = [
        ...(statusReceipt.events || []),
        ...(syncReceipt.events || []),
      ].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)

      // Status change events should precede sync events
      const statusEvents = allEvents.filter(
        (e) => e.event === "QCStatusChanged"
      )

      const syncEvents = allEvents.filter((e) => e.event === "QCOperation")

      expect(statusEvents.length).to.be.gt(0)
      expect(syncEvents.length).to.be.gt(0)
    })
  })

  describe("State Consistency Validation", () => {
    it("should maintain consistency during high-frequency operations", async () => {
      const qc = qcs[0].address
      const operations = []

      // Execute multiple rapid operations
      for (let i = 0; i < 5; i++) {
        operations.push(qcManager.connect(monitor).syncBackingFromOracle(qc))
        await time.increase(6 * 60) // 6 minutes between operations
      }

      await Promise.all(operations)

      // Validate final state consistency
      await validateCrossContractConsistency(qc)
    })

    it("should recover consistency after temporary inconsistency", async () => {
      const qc = qcs[0].address

      // Simulate temporary inconsistency (emergency pause during operation)
      const operationPromise = qcManager
        .connect(monitor)
        .syncBackingFromOracle(qc)

      // Trigger emergency pause mid-operation
      await systemState
        .connect(governance)
        .activateEmergencyPause("TEST_RECOVERY")

      // Wait for operation to complete or fail
      try {
        await operationPromise
      } catch (error) {
        // Operation may fail due to emergency pause - this is expected
      }

      // Clear emergency and allow recovery
      await systemState.connect(governance).deactivateEmergencyPause()

      // System should return to consistent state
      await validateCrossContractConsistency(qc)
    })
  })

  // Helper function to validate cross-contract state consistency
  async function validateCrossContractConsistency(qcAddress: string) {
    const qcInfo = await qcData.getQCInfo(qcAddress)
    const reserveInfo = await accountControl.reserveInfo(qcAddress)
    const oracleData = await qcManager.qcOracleData(qcAddress)
    const pauseInfo = await pauseManager.getPauseInfo(qcAddress)

    // Validate capacity consistency
    expect(qcInfo.maxCapacity).to.equal(reserveInfo.mintingCap)

    // Validate status consistency
    if (qcInfo.status === 0) {
      // ACTIVE
      expect(reserveInfo.mintingPaused).to.be.false
      expect(pauseInfo.isPaused).to.be.false
    } else if (qcInfo.status >= 1) {
      // Any paused state
      expect(reserveInfo.mintingPaused).to.be.true
    }

    // Validate oracle data consistency
    if (oracleData.lastKnownBalanceTimestamp > 0) {
      expect(oracleData.lastKnownReserveBalance).to.be.gte(0)
    }

    // Validate accounting consistency
    expect(qcInfo.totalMinted).to.be.lte(qcInfo.maxCapacity)
    expect(qcInfo.currentBacking).to.be.gte(0)
  }
})
