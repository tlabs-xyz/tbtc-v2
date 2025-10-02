import { expect } from "chai"
import { ethers } from "hardhat"
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { smock } from "@defi-wonderland/smock"
import { BigNumber } from "ethers"
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
import * as LibraryLinkingHelper from "../helpers/library-linking-helper"

describe("QCManager - Batch Operation Safety", () => {
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

  const DISPUTE_ARBITER_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("DISPUTE_ARBITER_ROLE")
  )

  const ORACLE_ATTESTOR_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("ORACLE_ATTESTOR_ROLE")
  )

  beforeEach(async () => {
    const signers = await ethers.getSigners()

    ;[owner, monitor, governance, arbiter, user] = signers

    // Get 10 QC addresses for testing
    qcs = signers.slice(5, 15)

    // Load fixture
    const fixture = await loadFixture(deployQCManagerFixture)
    qcManager = fixture.qcManager
    qcData = fixture.qcData
    reserveOracle = fixture.reserveOracle
    systemState = fixture.systemState
    accountControl = fixture.accountControl
    pauseManager = fixture.pauseManager
    walletManager = fixture.walletManager

    // Grant roles
    await qcManager.grantRole(MONITOR_ROLE, monitor.address)
    await qcManager.grantRole(GOVERNANCE_ROLE, governance.address)
    await qcManager.grantRole(REGISTRAR_ROLE, owner.address)
    await qcManager.grantRole(DISPUTE_ARBITER_ROLE, arbiter.address)
    await reserveOracle.grantRole(ORACLE_ATTESTOR_ROLE, owner.address)

    // Register multiple QCs
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

  describe("Circuit Breaker Constants", () => {
    it("should have correct circuit breaker thresholds", async () => {
      expect(await qcManager.MIN_GAS_PER_OPERATION()).to.equal(50000)
      expect(await qcManager.CIRCUIT_BREAKER_THRESHOLD()).to.equal(100000)
    })
  })

  describe("Batch Sync Operations", () => {
    it("should process all QCs when sufficient gas", async () => {
      const qcAddresses = qcs.slice(0, 5).map((qc) => qc.address)

      const tx = await qcManager.connect(monitor).batchSyncBackingFromOracle(
        qcAddresses,
        { gasLimit: 5000000 } // High gas limit
      )

      const receipt = await tx.wait()

      // Check all QCs were synced (by checking events)
      const syncEvents =
        receipt.events?.filter((e) => e.event === "BackingSyncedFromOracle") ||
        []

      expect(syncEvents.length).to.equal(5)
    })

    it("should emit batch completion event", async () => {
      const qcAddresses = qcs.slice(0, 3).map((qc) => qc.address)

      await expect(
        qcManager.connect(monitor).batchSyncBackingFromOracle(qcAddresses)
      )
        .to.emit(qcManager, "BatchOperationCompleted")
        .withArgs(3, qcAddresses.length, monitor.address)
    })

    it("should handle partial completion with circuit breaker", async () => {
      // Use many QCs to trigger circuit breaker
      const qcAddresses = qcs.map((qc) => qc.address) // All 10 QCs

      // Use lower gas limit to trigger circuit breaker
      const tx = await qcManager.connect(monitor).batchSyncBackingFromOracle(
        qcAddresses,
        { gasLimit: 500000 } // Limited gas
      )

      const receipt = await tx.wait()

      // Should complete some but not all
      const syncEvents =
        receipt.events?.filter((e) => e.event === "BackingSyncedFromOracle") ||
        []

      expect(syncEvents.length).to.be.gt(0)
      expect(syncEvents.length).to.be.lt(10)

      // Should emit partial completion event
      const batchEvent = receipt.events?.find(
        (e) => e.event === "BatchOperationCompleted"
      )

      expect(batchEvent).to.exist
      expect(batchEvent?.args?.processed).to.be.lt(10)
    })

    it("should skip already synced QCs", async () => {
      const qcAddresses = qcs.slice(0, 3).map((qc) => qc.address)

      // First sync
      await qcManager.connect(monitor).batchSyncBackingFromOracle(qcAddresses)

      // Try immediate re-sync
      const tx = await qcManager
        .connect(monitor)
        .batchSyncBackingFromOracle(qcAddresses)

      const receipt = await tx.wait()

      // Should skip all (too frequent)
      const syncEvents =
        receipt.events?.filter((e) => e.event === "BackingSyncedFromOracle") ||
        []

      expect(syncEvents.length).to.equal(0)
    })

    it("should continue after individual sync failure", async () => {
      // Mock oracle to fail for specific QC
      const mockOracle = await smock.fake<ReserveOracle>("ReserveOracle")

      // First QC fails, others succeed
      mockOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qcs[0].address)
        .reverts("Oracle error")

      for (let i = 1; i < 3; i++) {
        mockOracle.getReserveBalanceAndStaleness
          .whenCalledWith(qcs[i].address)
          .returns([ethers.utils.parseEther((500 * (i + 1)).toString()), false])
      }

      // Deploy new manager with mock oracle
      const libraries = await LibraryLinkingHelper.deployAllLibraries()

      const testQCManager = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        mockOracle.address,
        pauseManager.address,
        walletManager.address,
        libraries
      )

      await testQCManager.grantRole(MONITOR_ROLE, monitor.address)
      await testQCManager.setAccountControl(accountControl.address)

      const qcAddresses = qcs.slice(0, 3).map((qc) => qc.address)

      // Should not revert entire batch
      const tx = await testQCManager
        .connect(monitor)
        .batchSyncBackingFromOracle(qcAddresses)

      const receipt = await tx.wait()

      // Should process 2 out of 3
      const batchEvent = receipt.events?.find(
        (e) => e.event === "BatchOperationCompleted"
      )

      expect(batchEvent?.args?.processed).to.equal(2)
      expect(batchEvent?.args?.total).to.equal(3)
    })
  })

  describe("Batch Health Checks", () => {
    it("should check oracle health for multiple QCs", async () => {
      const qcAddresses = qcs.slice(0, 3).map((qc) => qc.address)

      const tx = await qcManager.connect(monitor).checkOracleHealth(qcAddresses)
      const receipt = await tx.wait()

      // Should emit health check completion event
      const healthEvent = receipt.events?.find(
        (e) => e.event === "BatchHealthCheckCompleted"
      )

      expect(healthEvent).to.exist
      expect(healthEvent?.args?.total).to.equal(3)
    })

    it("should enforce circuit breaker on batch health checks", async () => {
      // Try to check many QCs with limited gas
      const qcAddresses = qcs.map((qc) => qc.address)

      const tx = await qcManager
        .connect(monitor)
        .batchCheckOracleHealth(qcAddresses, { gasLimit: 500000 })

      const receipt = await tx.wait()

      // Should complete some but potentially not all
      const healthEvent = receipt.events?.find(
        (e) =>
          e.event === "BatchHealthCheckCompleted" ||
          e.event === "BatchHealthCheckIncomplete"
      )

      expect(healthEvent).to.exist
    })

    it("should handle individual failures in batch health check", async () => {
      // Mock oracle to fail for specific QC
      const mockOracle = await smock.fake<ReserveOracle>("ReserveOracle")

      // First QC fails, others succeed
      mockOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qcs[0].address)
        .reverts("Oracle error")

      for (let i = 1; i < 3; i++) {
        mockOracle.getReserveBalanceAndStaleness
          .whenCalledWith(qcs[i].address)
          .returns([ethers.utils.parseEther((500 * (i + 1)).toString()), false])
      }

      // Deploy new manager with mock oracle
      const libraries = await LibraryLinkingHelper.deployAllLibraries()

      const testQCManager = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        mockOracle.address,
        pauseManager.address,
        walletManager.address,
        libraries
      )

      await testQCManager.grantRole(MONITOR_ROLE, monitor.address)

      const qcAddresses = qcs.slice(0, 3).map((qc) => qc.address)

      // Should not revert entire batch
      const tx = await testQCManager
        .connect(monitor)
        .checkOracleHealth(qcAddresses)

      const receipt = await tx.wait()

      // Should show mixed results
      const healthEvent = receipt.events?.find(
        (e) => e.event === "BatchHealthCheckCompleted"
      )

      expect(healthEvent?.args?.healthy).to.equal(2)
      expect(healthEvent?.args?.failed).to.equal(1)
    })
  })

  describe("Individual Solvency Checks with Batch Sync", () => {
    beforeEach(async () => {
      // Mint some tBTC for QCs to create obligations
      for (let i = 0; i < 3; i++) {
        const mintAmount = ethers.utils.parseEther((100 * (i + 1)).toString())
        await accountControl
          .connect(qcs[i].address)
          .mint(user.address, mintAmount)
      }
    })

    it("should verify solvency after batch sync", async () => {
      const qcAddresses = qcs.slice(0, 3).map((qc) => qc.address)

      // Batch sync first
      await qcManager.connect(monitor).batchSyncBackingFromOracle(qcAddresses)

      // Check solvency individually
      for (const qc of qcAddresses) {
        await expect(qcManager.connect(arbiter).verifyQCSolvency(qc)).to.emit(
          qcManager,
          "SolvencyCheckPerformed"
        )
      }
    })

    it("should detect insolvency after sync", async () => {
      // Make QC insolvent by reducing backing below obligations
      await reserveOracle.updateReserveBalance(
        qcs[0].address,
        ethers.utils.parseEther("50")
      ) // Less than minted 100

      // Sync to update balance
      await qcManager.connect(monitor).syncBackingFromOracle(qcs[0].address)

      // Check solvency
      const tx = await qcManager
        .connect(arbiter)
        .verifyQCSolvency(qcs[0].address)

      const receipt = await tx.wait()

      const solvencyEvent = receipt.events?.find(
        (e) => e.event === "SolvencyCheckPerformed"
      )

      expect(solvencyEvent?.args?.isSolvent).to.be.false
      expect(solvencyEvent?.args?.deficit).to.equal(
        ethers.utils.parseEther("50")
      )
    })

    it("should handle batch sync with solvency implications", async () => {
      // Update some balances to make QCs potentially insolvent
      await reserveOracle.updateReserveBalance(
        qcs[0].address,
        ethers.utils.parseEther("50")
      ) // Insolvent
      await reserveOracle.updateReserveBalance(
        qcs[1].address,
        ethers.utils.parseEther("250")
      ) // Solvent

      const qcAddresses = [qcs[0].address, qcs[1].address]

      // Batch sync
      const tx = await qcManager
        .connect(monitor)
        .batchSyncBackingFromOracle(qcAddresses)

      const receipt = await tx.wait()

      // Check sync events
      const syncEvents =
        receipt.events?.filter((e) => e.event === "BackingSyncedFromOracle") ||
        []

      expect(syncEvents.length).to.equal(2)

      // QC0 should be paused due to insolvency
      const status0 = await qcData.getQCStatus(qcs[0].address)
      expect(status0).to.equal(1) // MintingPaused

      // QC1 should remain active
      const status1 = await qcData.getQCStatus(qcs[1].address)
      expect(status1).to.equal(0) // Active
    })
  })

  describe("Gas Optimization", () => {
    it("should estimate gas correctly for batch operations", async () => {
      const qcAddresses = qcs.slice(0, 5).map((qc) => qc.address)

      // Estimate gas for batch sync
      const estimatedGas = await qcManager
        .connect(monitor)
        .estimateGas.batchSyncBackingFromOracle(qcAddresses)

      // Execute and compare
      const tx = await qcManager
        .connect(monitor)
        .batchSyncBackingFromOracle(qcAddresses)

      const receipt = await tx.wait()

      // Actual gas should be close to estimate
      expect(receipt.gasUsed).to.be.closeTo(estimatedGas, estimatedGas.div(10)) // Within 10%
    })

    it("should use less gas per operation in batch vs individual", async () => {
      const qcAddresses = qcs.slice(0, 3).map((qc) => qc.address)

      // Measure individual operations
      let individualGasTotal = BigNumber.from(0)
      for (const qc of qcAddresses) {
        // Wait for min sync interval
        await time.increase(5 * 60 + 1)

        const tx = await qcManager.connect(monitor).syncBackingFromOracle(qc)
        const receipt = await tx.wait()
        individualGasTotal = individualGasTotal.add(receipt.gasUsed)
      }

      // Reset sync timestamps
      await time.increase(5 * 60 + 1)

      // Measure batch operation
      const batchTx = await qcManager
        .connect(monitor)
        .batchSyncBackingFromOracle(qcAddresses)

      const batchReceipt = await batchTx.wait()

      // Batch should be more efficient
      const gasPerOpIndividual = individualGasTotal.div(3)
      const gasPerOpBatch = batchReceipt.gasUsed.div(3)

      expect(gasPerOpBatch).to.be.lt(gasPerOpIndividual)
    })
  })

  describe("Error Recovery", () => {
    it("should allow retrying failed operations", async () => {
      const qcAddresses = qcs.slice(0, 3).map((qc) => qc.address)

      // First attempt with very low gas (will fail some)
      const tx1 = await qcManager
        .connect(monitor)
        .batchSyncBackingFromOracle(qcAddresses, { gasLimit: 200000 })

      const receipt1 = await tx1.wait()

      const batchEvent1 = receipt1.events?.find(
        (e) => e.event === "BatchOperationCompleted"
      )

      const processed1 = batchEvent1?.args?.processed.toNumber() || 0

      // Should have processed some but not all
      expect(processed1).to.be.gt(0)
      expect(processed1).to.be.lt(3)

      // Wait for sync interval
      await time.increase(5 * 60 + 1)

      // Retry with adequate gas
      const tx2 = await qcManager
        .connect(monitor)
        .batchSyncBackingFromOracle(qcAddresses, { gasLimit: 1000000 })

      const receipt2 = await tx2.wait()

      // Should complete remaining operations
      const syncEvents =
        receipt2.events?.filter((e) => e.event === "BackingSyncedFromOracle") ||
        []

      expect(syncEvents.length).to.be.gte(3 - processed1)
    })

    it("should emit gas limited event when circuit breaker triggers", async () => {
      // Create very large batch
      const allQCs = qcs.map((qc) => qc.address)

      // Use minimal gas to trigger circuit breaker
      await expect(
        qcManager
          .connect(monitor)
          .batchSyncBackingFromOracle(allQCs, { gasLimit: 300000 })
      ).to.emit(qcManager, "BatchOperationGasLimited")
    })
  })

  describe("Access Control for Batch Operations", () => {
    it("should enforce role requirements for batch sync", async () => {
      await expect(
        qcManager.connect(user).batchSyncBackingFromOracle([qcs[0].address])
      ).to.be.revertedWith("AccessControl:")
    })

    it("should enforce role requirements for batch health check", async () => {
      await expect(
        qcManager.connect(user).batchCheckOracleHealth([qcs[0].address])
      ).to.be.revertedWith("AccessControl:")
    })

    it("should enforce role requirements for oracle health monitoring", async () => {
      await expect(
        qcManager.connect(user).checkOracleHealth([qcs[0].address])
      ).to.be.revertedWith("AccessControl:")
    })
  })

  describe("Edge Cases", () => {
    it("should handle empty arrays", async () => {
      await expect(qcManager.connect(monitor).batchSyncBackingFromOracle([]))
        .to.emit(qcManager, "BatchOperationCompleted")
        .withArgs(0, 0, monitor.address)
    })

    it("should handle oracle health check with no healthy oracles", async () => {
      // Mock all oracles failing
      const mockOracle = await smock.fake<ReserveOracle>("ReserveOracle")
      mockOracle.getReserveBalanceAndStaleness.reverts("Oracle down")

      const libraries = await LibraryLinkingHelper.deployAllLibraries()

      const testManager = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        mockOracle.address,
        pauseManager.address,
        walletManager.address,
        libraries
      )

      await testManager.grantRole(MONITOR_ROLE, monitor.address)

      const tx = await testManager
        .connect(monitor)
        .checkOracleHealth([qcs[0].address, qcs[1].address])

      const receipt = await tx.wait()

      const healthEvent = receipt.events?.find(
        (e) => e.event === "BatchHealthCheckCompleted"
      )

      expect(healthEvent?.args?.healthy).to.equal(0)
      expect(healthEvent?.args?.failed).to.equal(2)
    })

    it("should handle duplicate QCs in batch", async () => {
      const duplicates = [qcs[0].address, qcs[0].address, qcs[1].address]

      const tx = await qcManager
        .connect(monitor)
        .batchSyncBackingFromOracle(duplicates)

      const receipt = await tx.wait()

      // Should process each unique QC only once
      const syncEvents =
        receipt.events?.filter((e) => e.event === "BackingSyncedFromOracle") ||
        []

      // First duplicate will sync, second will be skipped (too frequent)
      expect(syncEvents.length).to.equal(2)
    })

    it("should handle maximum batch size", async () => {
      // Test with documented maximum
      const maxBatchSize = 50
      const signers = await ethers.getSigners()

      // Register many QCs if needed
      const manyQCs: string[] = []
      for (let i = 0; i < maxBatchSize && i < signers.length - 5; i++) {
        const qc = signers[i + 5]
        if (i >= qcs.length) {
          await qcManager.registerQC(
            qc.address,
            ethers.utils.parseEther("1000")
          )
          await reserveOracle.updateReserveBalance(
            qc.address,
            ethers.utils.parseEther("500")
          )
        }
        manyQCs.push(qc.address)
      }

      // Should handle maximum batch size
      const tx = await qcManager
        .connect(monitor)
        .batchSyncBackingFromOracle(
          manyQCs.slice(0, Math.min(maxBatchSize, manyQCs.length)),
          { gasLimit: 5000000 }
        )

      const receipt = await tx.wait()

      const batchEvent = receipt.events?.find(
        (e) => e.event === "BatchOperationCompleted"
      )

      expect(batchEvent).to.exist
    })
  })
})
