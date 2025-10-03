import { expect } from "chai"
import { ethers } from "hardhat"
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { smock } from "@defi-wonderland/smock"
import {
  QCManager,
  QCData,
  ReserveOracle,
  SystemState,
  AccountControl,
  IQCPauseManager,
  IQCWalletManager,
} from "../../../typechain"
import { deployQCManagerFixture } from "../../fixtures"
import * as LibraryLinkingHelper from "../helpers/library-linking-helper"

describe("QCManager - Feature Integration Tests", () => {
  let qcManager: QCManager
  let qcData: QCData
  let reserveOracle: ReserveOracle
  let systemState: SystemState
  let accountControl: AccountControl
  let pauseManager: IQCPauseManager
  let walletManager: IQCWalletManager

  let owner: SignerWithAddress
  let monitor: SignerWithAddress
  let governance: SignerWithAddress
  let operations: SignerWithAddress
  let arbiter: SignerWithAddress
  let qcs: SignerWithAddress[] = []
  let user: SignerWithAddress

  // Role constants
  const MONITOR_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("MONITOR_ROLE")
  )

  const GOVERNANCE_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("GOVERNANCE_ROLE")
  )

  const REGISTRAR_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("REGISTRAR_ROLE")
  )

  const OPERATIONS_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("OPERATIONS_ROLE")
  )

  const DISPUTE_ARBITER_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("DISPUTE_ARBITER_ROLE")
  )

  const ORACLE_ATTESTOR_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("ORACLE_ATTESTOR_ROLE")
  )

  beforeEach(async () => {
    const signers = await ethers.getSigners()

    ;[owner, monitor, governance, operations, arbiter, user] = signers
    qcs = signers.slice(6, 12) // Get 6 QCs

    // Load fixture
    const fixture = await loadFixture(deployQCManagerFixture)
    qcManager = fixture.qcManager
    qcData = fixture.qcData
    reserveOracle = fixture.reserveOracle
    systemState = fixture.systemState
    accountControl = fixture.accountControl
    pauseManager = fixture.pauseManager
    walletManager = fixture.walletManager

    // Grant all necessary roles
    await qcManager.grantRole(MONITOR_ROLE, monitor.address)
    await qcManager.grantRole(GOVERNANCE_ROLE, governance.address)
    await qcManager.grantRole(REGISTRAR_ROLE, owner.address)
    await qcManager.grantRole(DISPUTE_ARBITER_ROLE, arbiter.address)
    await systemState.grantRole(OPERATIONS_ROLE, operations.address)
    await reserveOracle.grantRole(ORACLE_ATTESTOR_ROLE, owner.address)

    // Enable graceful degradation
    await qcManager.connect(governance).setGracefulDegradation(true)

    // Register QCs
    for (let i = 0; i < qcs.length; i++) {
      await qcManager.registerQC(
        qcs[i].address,
        ethers.utils.parseEther((1000 * (i + 1)).toString())
      )
      await reserveOracle.updateReserveBalance(
        qcs[i].address,
        ethers.utils.parseEther((500 * (i + 1)).toString())
      )
    }
  })

  describe("Oracle Fallback + Configurable Parameters", () => {
    it("should use configurable timeout for fallback data expiry", async () => {
      // Set graceful degradation timeout to 24 hours
      await qcManager
        .connect(governance)
        .setGracefulDegradationTimeout(24 * 60 * 60)

      // Cache some data
      await qcManager.connect(monitor).syncBackingFromOracle(qcs[0].address)

      // Mock oracle failure
      const mockOracle = await smock.fake<ReserveOracle>("ReserveOracle")
      mockOracle.getReserveBalanceAndStaleness.reverts("Oracle down")

      // Deploy new manager with mock
      const libraries = await LibraryLinkingHelper.deployAllLibraries()

      const testManager = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        mockOracle.address,
        pauseManager.address,
        walletManager.address,
        libraries
      )

      await testManager.grantRole(GOVERNANCE_ROLE, governance.address)
      await testManager.connect(governance).setGracefulDegradation(true)
      await testManager
        .connect(governance)
        .setGracefulDegradationTimeout(24 * 60 * 60)

      // First sync to cache data
      const currentTime = await time.latest()

      // Need to set up a successful sync first to cache data
      // Since the mock oracle is failing, we need to temporarily use real oracle
      await reserveOracle.updateReserveBalance(
        qcs[0].address,
        ethers.utils.parseEther("500")
      )

      // Deploy a temp manager with real oracle to cache data
      const tempManager = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        reserveOracle.address, // Use real oracle
        pauseManager.address,
        walletManager.address,
        libraries
      )

      await tempManager.grantRole(MONITOR_ROLE, monitor.address)
      await tempManager.setAccountControl(accountControl.address)
      await tempManager.connect(monitor).syncBackingFromOracle(qcs[0].address)

      // Should work within 24 hours with fallback
      await time.increase(23 * 60 * 60)

      // Now testManager (with failing oracle) should use cached data
      const tx1 = await testManager
        .connect(monitor)
        .syncBackingFromOracle(qcs[0].address)

      const receipt1 = await tx1.wait()

      const syncEvent = receipt1.events?.find(
        (e) => e.event === "BackingSyncedFromOracle"
      )

      expect(syncEvent).to.exist

      // Should fail after 24 hours
      await time.increase(2 * 60 * 60 + 5 * 60 + 1) // Total 25+ hours + sync interval

      await expect(
        testManager.connect(monitor).syncBackingFromOracle(qcs[0].address)
      )
        .to.emit(testManager, "SyncFailed")
        .withArgs(qcs[0].address, "Fallback data expired", monitor.address)
    })

    it("should respect min sync interval when using fallback", async () => {
      // Update min sync interval
      await systemState.connect(operations).setMinSyncInterval(10 * 60) // 10 minutes

      // First sync
      await qcManager.connect(monitor).syncBackingFromOracle(qcs[0].address)

      // Mock oracle to use fallback
      const mockOracle = await smock.fake<ReserveOracle>("ReserveOracle")
      mockOracle.getReserveBalanceAndStaleness.reverts("Oracle error")

      // Should still respect sync interval even with fallback
      await expect(
        qcManager.connect(monitor).syncBackingFromOracle(qcs[0].address)
      ).to.be.revertedWithCustomError(qcManager, "SyncTooFrequent")
    })

    it("should use fallback during self-pause escalation check", async () => {
      // Configure shorter self-pause timeout
      await systemState.connect(operations).setSelfPauseTimeout(24 * 60 * 60)

      // Self-pause a QC
      await qcManager.connect(qcs[0].address).selfPause()

      // Cache balance data
      const currentBalance = ethers.utils.parseEther("600")
      await reserveOracle.updateReserveBalance(qcs[0].address, currentBalance)
      await qcManager.connect(monitor).syncBackingFromOracle(qcs[0].address)

      // Advance time near escalation
      await time.increase(23 * 60 * 60)

      // Mock oracle failure
      const mockOracle = await smock.fake<ReserveOracle>("ReserveOracle")
      mockOracle.getReserveBalanceAndStaleness.reverts("Oracle unavailable")

      // Deploy test manager
      const libraries = await LibraryLinkingHelper.deployAllLibraries()

      const testManager = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        mockOracle.address,
        pauseManager.address,
        walletManager.address,
        libraries
      )

      await testManager.grantRole(GOVERNANCE_ROLE, governance.address)
      await testManager.grantRole(MONITOR_ROLE, monitor.address)
      await testManager.connect(governance).setGracefulDegradation(true)
      await testManager.setAccountControl(accountControl.address)

      // Cache data by doing a successful sync with working oracle first
      const tempOracle = await smock.fake<ReserveOracle>("ReserveOracle")
      tempOracle.getReserveBalanceAndStaleness.returns([currentBalance, false])

      const tempManager = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        tempOracle.address,
        pauseManager.address,
        walletManager.address,
        libraries
      )

      await tempManager.grantRole(MONITOR_ROLE, monitor.address)
      await tempManager.setAccountControl(accountControl.address)
      await tempManager.connect(monitor).syncBackingFromOracle(qcs[0].address)

      // Should still be able to check escalation eligibility
      const [eligible, timeUntil] = await testManager.isEligibleForEscalation(
        qcs[0].address
      )

      expect(eligible).to.be.false
      expect(timeUntil).to.be.closeTo(60 * 60, 60) // About 1 hour left
    })
  })

  describe("Batch Operations + Oracle Fallback", () => {
    let mockOracle: any
    let testManager: QCManager

    beforeEach(async () => {
      // Create mock oracle with mixed success/failure
      mockOracle = await smock.fake<ReserveOracle>("ReserveOracle")

      // QCs 0,2,4 succeed, QCs 1,3,5 fail
      for (let i = 0; i < qcs.length; i++) {
        if (i % 2 === 0) {
          mockOracle.getReserveBalanceAndStaleness
            .whenCalledWith(qcs[i].address)
            .returns([
              ethers.utils.parseEther((600 * (i + 1)).toString()),
              false,
            ])
        } else {
          mockOracle.getReserveBalanceAndStaleness
            .whenCalledWith(qcs[i].address)
            .reverts(`Oracle error for QC ${i}`)
        }
      }

      // Deploy test manager
      const libraries = await LibraryLinkingHelper.deployAllLibraries()
      testManager = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        mockOracle.address,
        pauseManager.address,
        walletManager.address,
        libraries
      )

      await testManager.grantRole(GOVERNANCE_ROLE, governance.address)
      await testManager.grantRole(MONITOR_ROLE, monitor.address)
      await testManager.connect(governance).setGracefulDegradation(true)
      await testManager.setAccountControl(accountControl.address)

      // Cache data for odd QCs by syncing with a working oracle first
      const tempOracle2 = await smock.fake<ReserveOracle>("ReserveOracle")

      for (let i = 1; i < qcs.length; i += 2) {
        tempOracle2.getReserveBalanceAndStaleness
          .whenCalledWith(qcs[i].address)
          .returns([ethers.utils.parseEther((500 * (i + 1)).toString()), false])
      }

      const tempManager2 = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        tempOracle2.address,
        pauseManager.address,
        walletManager.address,
        libraries
      )

      await tempManager2.grantRole(MONITOR_ROLE, monitor.address)
      await tempManager2.setAccountControl(accountControl.address)

      // Sync odd QCs to cache data
      for (let i = 1; i < qcs.length; i += 2) {
        await tempManager2
          .connect(monitor)
          .syncBackingFromOracle(qcs[i].address)
      }
    })

    it("should handle mixed oracle/fallback in batch with circuit breaker", async () => {
      const allQCs = qcs.map((qc) => qc.address)

      // Batch sync with limited gas
      const tx = await testManager
        .connect(monitor)
        .batchSyncBackingFromOracle(allQCs, { gasLimit: 800000 })

      const receipt = await tx.wait()

      // Should process some QCs
      const syncEvents =
        receipt.events?.filter((e) => e.event === "OracleSyncCompleted") || []

      expect(syncEvents.length).to.be.gt(0)
      expect(syncEvents.length).to.be.lte(allQCs.length)

      // Check which ones used fallback
      const fallbackEvents =
        receipt.events?.filter((e) => e.event === "FallbackDataUsed") || []

      expect(fallbackEvents.length).to.be.gt(0)
    })

    it("should mark oracle failures during batch operations", async () => {
      const failingQCs = [qcs[1].address, qcs[3].address]

      await testManager.connect(monitor).batchSyncBackingFromOracle(failingQCs)

      // Should mark oracle failures
      expect(await testManager.oracleFailureDetected(qcs[1].address)).to.be.true
      expect(await testManager.oracleFailureDetected(qcs[3].address)).to.be.true

      // Should not mark successful ones
      expect(await testManager.oracleFailureDetected(qcs[0].address)).to.be
        .false
    })
  })

  describe("Configurable Parameters + Batch Operations", () => {
    it("should respect sync interval in batch operations", async () => {
      // Set longer sync interval
      await systemState.connect(operations).setMinSyncInterval(15 * 60) // 15 minutes

      const batchQCs = qcs.slice(0, 3).map((qc) => qc.address)

      // First batch sync
      await qcManager.connect(monitor).batchSyncBackingFromOracle(batchQCs)

      // Try immediate re-sync
      const tx = await qcManager
        .connect(monitor)
        .batchSyncBackingFromOracle(batchQCs)

      const receipt = await tx.wait()

      // Should skip all due to sync interval
      const syncEvents =
        receipt.events?.filter((e) => e.event === "OracleSyncCompleted") || []

      expect(syncEvents.length).to.equal(0)

      // Batch should still complete successfully
      const batchEvent = receipt.events?.find(
        (e) => e.event === "BatchOperationCompleted"
      )

      expect(batchEvent?.args?.processed).to.equal(0) // None processed due to interval
    })

    it("should use escalation parameters in batch status monitoring", async () => {
      // Configure parameters
      await systemState.connect(operations).setSelfPauseTimeout(24 * 60 * 60) // 24 hours
      await systemState
        .connect(operations)
        .setEscalationWarningPeriod(2 * 60 * 60) // 2 hours

      // Self-pause multiple QCs
      for (let i = 0; i < 3; i++) {
        await qcManager.connect(qcs[i].address).selfPause()
      }

      // Advance to warning period
      await time.increase(22 * 60 * 60) // 22 hours (24 - 2)

      // Batch check escalation eligibility
      const qcAddresses = qcs.slice(0, 3).map((qc) => qc.address)

      for (const qc of qcAddresses) {
        const [eligible, timeUntil] = await qcManager.isEligibleForEscalation(
          qc
        )

        expect(eligible).to.be.false
        expect(timeUntil).to.be.closeTo(2 * 60 * 60, 60)
      }
    })
  })

  describe("All Features Combined", () => {
    it("should handle complex scenario with all features", async () => {
      // Configure all parameters
      await systemState.connect(operations).setSelfPauseTimeout(36 * 60 * 60) // 36 hours
      await systemState.connect(operations).setMinSyncInterval(10 * 60) // 10 minutes
      await qcManager
        .connect(governance)
        .setGracefulDegradationTimeout(48 * 60 * 60) // 48 hours

      // Setup: Mix of QCs with different states
      // QC0: Normal operation
      // QC1: Self-paused
      // QC2: Has minted tBTC (check solvency)
      // QC3: Will have oracle failure

      // Self-pause QC1
      await qcManager.connect(qcs[1].address).selfPause()

      // Mint with QC2
      await accountControl
        .connect(qcs[2].address)
        .mint(user.address, ethers.utils.parseEther("300"))

      // Initial sync to cache data
      await qcManager
        .connect(monitor)
        .batchSyncBackingFromOracle(qcs.slice(0, 4).map((qc) => qc.address))

      // Create mixed oracle scenario
      const mockOracle = await smock.fake<ReserveOracle>("ReserveOracle")

      // QC0,1,2 succeed, QC3 fails
      mockOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qcs[0].address)
        .returns([ethers.utils.parseEther("600"), false])
      mockOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qcs[1].address)
        .returns([ethers.utils.parseEther("1200"), false])
      mockOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qcs[2].address)
        .returns([ethers.utils.parseEther("1800"), false])
      mockOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qcs[3].address)
        .reverts("Oracle failure for QC3")

      // Deploy final test manager
      const libraries = await LibraryLinkingHelper.deployAllLibraries()

      const finalManager = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        mockOracle.address,
        pauseManager.address,
        walletManager.address,
        libraries
      )

      await finalManager.grantRole(GOVERNANCE_ROLE, governance.address)
      await finalManager.grantRole(MONITOR_ROLE, monitor.address)
      await finalManager.grantRole(DISPUTE_ARBITER_ROLE, arbiter.address)
      await finalManager.connect(governance).setGracefulDegradation(true)
      await finalManager.setAccountControl(accountControl.address)

      // Cache fallback data for QC3 by syncing with working oracle
      const cacheOracle = await smock.fake<ReserveOracle>("ReserveOracle")
      cacheOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qcs[3].address)
        .returns([ethers.utils.parseEther("2000"), false])

      const cacheManager = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        cacheOracle.address,
        pauseManager.address,
        walletManager.address,
        libraries
      )

      await cacheManager.grantRole(MONITOR_ROLE, monitor.address)
      await cacheManager.setAccountControl(accountControl.address)
      await cacheManager.connect(monitor).syncBackingFromOracle(qcs[3].address)

      // Wait for sync interval
      await time.increase(10 * 60 + 1)

      // Execute batch operations with circuit breaker
      const batchAddresses = qcs.slice(0, 4).map((qc) => qc.address)

      // 1. Batch sync (will use fallback for QC3)
      const syncTx = await finalManager
        .connect(monitor)
        .batchSyncBackingFromOracle(batchAddresses, { gasLimit: 1000000 })

      const syncReceipt = await syncTx.wait()

      // Check results
      const syncEvents =
        syncReceipt.events?.filter((e) => e.event === "OracleSyncCompleted") ||
        []

      const fallbackEvents =
        syncReceipt.events?.filter((e) => e.event === "FallbackDataUsed") || []

      expect(syncEvents.length).to.equal(4) // All synced
      expect(fallbackEvents.length).to.equal(1) // QC3 used fallback
      expect(await finalManager.oracleFailureDetected(qcs[3].address)).to.be
        .true

      // 2. Individual solvency checks (no batch function exists)
      for (const qc of batchAddresses) {
        const tx = await finalManager.connect(arbiter).verifyQCSolvency(qc)
        const receipt = await tx.wait()

        const solvencyEvent = receipt.events?.find(
          (e) => e.event === "SolvencyCheckPerformed"
        )

        expect(solvencyEvent).to.exist
        expect(solvencyEvent?.args?.isSolvent).to.be.true
      }

      // 3. Check escalation status for self-paused QC
      const [eligible, timeUntil] = await finalManager.isEligibleForEscalation(
        qcs[1].address
      )

      expect(eligible).to.be.false
      expect(timeUntil).to.be.closeTo(36 * 60 * 60 - 10 * 60, 60) // ~36 hours minus elapsed time

      // 4. Advance time and trigger escalation
      await time.increase(36 * 60 * 60)

      const [eligibleNow] = await finalManager.isEligibleForEscalation(
        qcs[1].address
      )

      expect(eligibleNow).to.be.true

      // Status change (no batch function exists)
      await expect(
        finalManager.connect(governance).setQCStatus(
          qcs[1].address,
          3, // UnderReview
          ethers.utils.formatBytes32String("AUTO_ESCALATION")
        )
      ).to.not.be.reverted

      expect(await qcData.getQCStatus(qcs[1].address)).to.equal(3) // UnderReview
    })

    it("should maintain data consistency across all features", async () => {
      // This test ensures data consistency when all features interact

      // Setup parameters
      await systemState.connect(operations).setMinSyncInterval(5 * 60)
      await qcManager
        .connect(governance)
        .setGracefulDegradationTimeout(24 * 60 * 60)

      // Cache initial data
      await qcManager.connect(monitor).syncBackingFromOracle(qcs[0].address)

      const initialBalance = await qcManager.lastKnownReserveBalance(
        qcs[0].address
      )

      const initialTimestamp = await qcManager.lastKnownBalanceTimestamp(
        qcs[0].address
      )

      // Update oracle
      await reserveOracle.updateReserveBalance(
        qcs[0].address,
        ethers.utils.parseEther("700")
      )

      // Wait and sync again
      await time.increase(5 * 60 + 1)
      await qcManager.connect(monitor).syncBackingFromOracle(qcs[0].address)

      // Verify cache was updated
      const newBalance = await qcManager.lastKnownReserveBalance(qcs[0].address)

      const newTimestamp = await qcManager.lastKnownBalanceTimestamp(
        qcs[0].address
      )

      expect(newBalance).to.not.equal(initialBalance)
      expect(newBalance).to.equal(ethers.utils.parseEther("700"))
      expect(newTimestamp).to.be.gt(initialTimestamp)

      // Verify no oracle failure marked
      expect(await qcManager.oracleFailureDetected(qcs[0].address)).to.be.false
    })
  })

  describe("Performance and Gas Usage", () => {
    it("should demonstrate gas savings with combined features", async () => {
      // Measure gas for individual operations
      let individualGas = ethers.BigNumber.from(0)

      // Individual syncs
      for (let i = 0; i < 3; i++) {
        await time.increase(5 * 60 + 1)

        const tx = await qcManager
          .connect(monitor)
          .syncBackingFromOracle(qcs[i].address)

        const receipt = await tx.wait()
        individualGas = individualGas.add(receipt.gasUsed)
      }

      // Individual solvency checks
      for (let i = 0; i < 3; i++) {
        const tx = await qcManager
          .connect(arbiter)
          .verifySolvency(qcs[i].address)

        const receipt = await tx.wait()
        individualGas = individualGas.add(receipt.gasUsed)
      }

      // Reset and use batch operations
      await time.increase(5 * 60 + 1)

      // Batch sync
      const batchSyncTx = await qcManager
        .connect(monitor)
        .batchSyncBackingFromOracle(qcs.slice(3, 6).map((qc) => qc.address))

      const batchSyncReceipt = await batchSyncTx.wait()

      // Individual solvency checks (no batch function)
      let totalSolvencyGas = ethers.BigNumber.from(0)
      for (const qc of qcs.slice(3, 6)) {
        const tx = await qcManager.connect(arbiter).verifyQCSolvency(qc.address)
        const receipt = await tx.wait()
        totalSolvencyGas = totalSolvencyGas.add(receipt.gasUsed)
      }
      const batchSolvencyGas = totalSolvencyGas // For comparison below

      const batchGas = batchSyncReceipt.gasUsed.add(batchSolvencyGas)

      // Batch sync should be more efficient than individual syncs
      // Compare only the sync operations (3 individual vs 3 batch)
      const individualSyncAverage = individualGas.div(6) // 6 operations total
      const batchSyncAverage = batchSyncReceipt.gasUsed.div(3) // 3 syncs in batch

      expect(batchSyncAverage).to.be.lt(individualSyncAverage)

      // Log savings for documentation
      const savings = individualAverage
        .sub(batchAverage)
        .mul(100)
        .div(individualAverage)

      console.log(`Gas savings with batch operations: ${savings.toString()}%`)
    })
  })
})
