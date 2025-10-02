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
  QCManagerLib,
  IQCPauseManager,
  IQCWalletManager,
} from "../../../typechain"
import { deployQCManagerFixture } from "../fixtures/account-control-fixtures"
import * as LibraryLinkingHelper from "../helpers/library-linking-helper"
import {
  QC_OPERATION_TYPES,
  timestampToBytes32,
  addressToBytes32,
  booleanToBytes32,
} from "../helpers/event-constants"

describe("QCManager - Oracle Fallback System", () => {
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
  let qc1: SignerWithAddress
  let qc2: SignerWithAddress
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

  const ORACLE_ATTESTOR_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("ORACLE_ATTESTOR_ROLE")
  )

  const MINTER_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("MINTER_ROLE")
  )

  beforeEach(async () => {
    ;[owner, monitor, governance, qc1, qc2, user] = await ethers.getSigners()

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
    await reserveOracle.grantRole(ORACLE_ATTESTOR_ROLE, owner.address)

    // Register QCs
    await qcManager.registerQC(qc1.address, ethers.utils.parseEther("1000"))
    await qcManager.registerQC(qc2.address, ethers.utils.parseEther("2000"))

    // Set initial oracle balances
    await reserveOracle.updateReserveBalance(
      qc1.address,
      ethers.utils.parseEther("500")
    )
    await reserveOracle.updateReserveBalance(
      qc2.address,
      ethers.utils.parseEther("1500")
    )
  })

  describe("Graceful Degradation Configuration", () => {
    it("should enable graceful degradation", async () => {
      expect(await qcManager.gracefulDegradationEnabled()).to.be.false

      await qcManager.connect(governance).setGracefulDegradation(true)

      expect(await qcManager.gracefulDegradationEnabled()).to.be.true
    })

    it("should disable graceful degradation", async () => {
      await qcManager.connect(governance).setGracefulDegradation(true)
      expect(await qcManager.gracefulDegradationEnabled()).to.be.true

      await qcManager.connect(governance).setGracefulDegradation(false)

      expect(await qcManager.gracefulDegradationEnabled()).to.be.false
    })

    // gracefulDegradationTimeout is now managed in SystemState contract

    it("should emit event when setting graceful degradation", async () => {
      await expect(qcManager.connect(governance).setGracefulDegradation(true))
        .to.emit(qcManager, "QCOperation")
        .withArgs(
          ethers.constants.AddressZero, // System-wide operation
          QC_OPERATION_TYPES.GRACEFUL_DEGRADATION,
          1, // enabled = true
          addressToBytes32(governance.address)
        )
    })

    it("should enforce access control for configuration", async () => {
      await expect(
        qcManager.connect(user).setGracefulDegradation(true)
      ).to.be.revertedWith("AccessControl:")

      // gracefulDegradationTimeout is now managed in SystemState contract
    })

    // gracefulDegradationTimeout event tests moved to SystemState tests
  })

  describe("Fallback Data Caching", () => {
    beforeEach(async () => {
      // Enable graceful degradation
      await qcManager.connect(governance).setGracefulDegradation(true)
    })

    it("should cache balance on successful oracle sync", async () => {
      // Initial cache should be empty
      expect(await qcManager.lastKnownReserveBalance(qc1.address)).to.equal(0)
      expect(await qcManager.lastKnownBalanceTimestamp(qc1.address)).to.equal(0)

      // Sync from oracle
      await qcManager.connect(monitor).syncBackingFromOracle(qc1.address)

      // Check cache was updated
      expect(await qcManager.lastKnownReserveBalance(qc1.address)).to.equal(
        ethers.utils.parseEther("500")
      )
      const timestamp = await time.latest()
      expect(await qcManager.lastKnownBalanceTimestamp(qc1.address)).to.equal(
        timestamp
      )
    })

    it("should update cache on each successful sync", async () => {
      // First sync
      await qcManager.connect(monitor).syncBackingFromOracle(qc1.address)
      const firstBalance = await qcManager.lastKnownReserveBalance(qc1.address)

      const firstTimestamp = await qcManager.lastKnownBalanceTimestamp(
        qc1.address
      )

      // Update oracle and wait
      await time.increase(5 * 60 + 1) // Wait for min sync interval
      await reserveOracle.updateReserveBalance(
        qc1.address,
        ethers.utils.parseEther("600")
      )

      // Second sync
      await qcManager.connect(monitor).syncBackingFromOracle(qc1.address)

      // Check cache was updated
      expect(await qcManager.lastKnownReserveBalance(qc1.address)).to.equal(
        ethers.utils.parseEther("600")
      )
      expect(await qcManager.lastKnownBalanceTimestamp(qc1.address)).to.be.gt(
        firstTimestamp
      )
    })

    it("should track oracle failure state", async () => {
      // Initially no failure
      const oracleData = await qcManager.qcOracleData(qc1.address)
      expect(oracleData.oracleFailureDetected).to.be.false

      // Mock oracle failure
      const mockOracle = await smock.fake<ReserveOracle>("ReserveOracle")
      mockOracle.getReserveBalanceAndStaleness.reverts("Oracle unavailable")

      // Deploy new QCManager with mock oracle
      const libraries = await LibraryLinkingHelper.deployAllLibraries()

      const newQCManager = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        mockOracle.address,
        pauseManager.address,
        walletManager.address,
        libraries
      )

      // Enable graceful degradation and set required roles
      await newQCManager.grantRole(GOVERNANCE_ROLE, governance.address)
      await newQCManager.grantRole(MONITOR_ROLE, monitor.address)
      await newQCManager.connect(governance).setGracefulDegradation(true)
      await newQCManager.setAccountControl(accountControl.address)

      // Try to sync - should fail and mark failure
      const tx = await newQCManager
        .connect(monitor)
        .syncBackingFromOracle(qc1.address)

      const receipt = await tx.wait()

      // Check for sync failed event
      const syncFailedEvent = receipt.events?.find(
        (e) => e.event === "SyncFailed"
      )

      expect(syncFailedEvent).to.exist

      const oracleDataNew = await newQCManager.qcOracleData(qc1.address)
      expect(oracleDataNew.oracleFailureDetected).to.be.true
    })
  })

  describe("Oracle Fallback Logic", () => {
    let mockOracle: any
    let fallbackQCManager: QCManager

    beforeEach(async () => {
      // Create mock oracle that we can control
      mockOracle = await smock.fake<ReserveOracle>("ReserveOracle")

      // Deploy QCManager with mock oracle
      const libraries = await LibraryLinkingHelper.deployAllLibraries()
      fallbackQCManager = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        mockOracle.address,
        pauseManager.address,
        walletManager.address,
        libraries
      )

      // Setup roles and enable graceful degradation
      await fallbackQCManager.grantRole(GOVERNANCE_ROLE, governance.address)
      await fallbackQCManager.grantRole(MONITOR_ROLE, monitor.address)
      await fallbackQCManager.connect(governance).setGracefulDegradation(true)
      await fallbackQCManager.setAccountControl(accountControl.address)
    })

    it("should sync successfully when oracle is available", async () => {
      // Oracle returns fresh data
      mockOracle.getReserveBalanceAndStaleness.returns([
        ethers.utils.parseEther("500"),
        false,
      ])

      await expect(
        fallbackQCManager.connect(monitor).syncBackingFromOracle(qc1.address)
      )
        .to.emit(fallbackQCManager, "QCOperation")
        .withArgs(
          qc1.address,
          QC_OPERATION_TYPES.SYNC_SUCCESS,
          ethers.utils.parseEther("500"),
          booleanToBytes32(false) // isStale = false
        )

      // Verify cache was updated
      const oracleData = await fallbackQCManager.qcOracleData(qc1.address)
      expect(oracleData.lastKnownReserveBalance).to.equal(
        ethers.utils.parseEther("500")
      )
    })

    it("should emit sync failed event when oracle fails and no fallback", async () => {
      // Oracle fails
      mockOracle.getReserveBalanceAndStaleness.reverts("Oracle error")

      await expect(
        fallbackQCManager.connect(monitor).syncBackingFromOracle(qc1.address)
      )
        .to.emit(fallbackQCManager, "QCOperation")
        .withArgs(
          qc1.address,
          QC_OPERATION_TYPES.SYNC_FAILED,
          0,
          timestampToBytes32((await time.latest()) + 1) // approximate timestamp
        )

      // Should mark oracle failure
      const oracleData = await fallbackQCManager.qcOracleData(qc1.address)
      expect(oracleData.oracleFailureDetected).to.be.true
    })

    it("should use fallback data when oracle fails with cached data", async () => {
      // First successful sync to cache data
      mockOracle.getReserveBalanceAndStaleness.returns([
        ethers.utils.parseEther("450"),
        false,
      ])
      await fallbackQCManager
        .connect(monitor)
        .syncBackingFromOracle(qc1.address)

      // Wait for sync interval
      await time.increase(5 * 60 + 1)

      // Now oracle fails
      mockOracle.getReserveBalanceAndStaleness.reverts("Oracle error")

      const tx = await fallbackQCManager
        .connect(monitor)
        .syncBackingFromOracle(qc1.address)

      const receipt = await tx.wait()

      // Should emit sync event with fallback value
      const syncEvent = receipt.events?.find(
        (e) =>
          e.event === "QCOperation" &&
          e.args?.operation === QC_OPERATION_TYPES.SYNC_SUCCESS
      )

      expect(syncEvent).to.exist
      // Check the value parameter
      expect(syncEvent?.args?.value).to.equal(ethers.utils.parseEther("450"))

      // Should also emit fallback used event
      const fallbackEvent = receipt.events?.find(
        (e) =>
          e.event === "QCOperation" &&
          e.args?.operation === QC_OPERATION_TYPES.FALLBACK_USED
      )

      expect(fallbackEvent).to.exist
    })

    it("should detect when fallback data is expired", async () => {
      // Cache data
      mockOracle.getReserveBalanceAndStaleness.returns([
        ethers.utils.parseEther("450"),
        false,
      ])
      await fallbackQCManager
        .connect(monitor)
        .syncBackingFromOracle(qc1.address)

      // Advance time beyond timeout
      await time.increase(49 * 60 * 60) // 49 hours (beyond 48 hour default)

      // Oracle fails
      mockOracle.getReserveBalanceAndStaleness.reverts("Oracle error")

      // Should fail due to expired fallback
      await expect(
        fallbackQCManager.connect(monitor).syncBackingFromOracle(qc1.address)
      )
        .to.emit(fallbackQCManager, "SyncFailed")
        .withArgs(qc1.address, "Fallback data expired", monitor.address)
    })

    it("should revert if graceful degradation is disabled", async () => {
      // Cache some data first
      mockOracle.getReserveBalanceAndStaleness.returns([
        ethers.utils.parseEther("450"),
        false,
      ])
      await fallbackQCManager
        .connect(monitor)
        .syncBackingFromOracle(qc1.address)

      // Disable graceful degradation
      await fallbackQCManager.connect(governance).setGracefulDegradation(false)

      // Wait for sync interval
      await time.increase(5 * 60 + 1)

      // Oracle fails
      mockOracle.getReserveBalanceAndStaleness.reverts("Oracle error")

      // Should fail without attempting fallback
      await expect(
        fallbackQCManager.connect(monitor).syncBackingFromOracle(qc1.address)
      )
        .to.emit(fallbackQCManager, "SyncFailed")
        .withArgs(qc1.address, "Oracle failure", monitor.address)
    })
  })

  describe("Oracle Recovery", () => {
    let mockOracle: any
    let fallbackQCManager: QCManager

    beforeEach(async () => {
      // Setup mock oracle and QCManager
      mockOracle = await smock.fake<ReserveOracle>("ReserveOracle")

      const libraries = await LibraryLinkingHelper.deployAllLibraries()
      fallbackQCManager = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        mockOracle.address,
        pauseManager.address,
        walletManager.address,
        libraries
      )

      await fallbackQCManager.grantRole(GOVERNANCE_ROLE, governance.address)
      await fallbackQCManager.grantRole(MONITOR_ROLE, monitor.address)
      await fallbackQCManager.connect(governance).setGracefulDegradation(true)
      await fallbackQCManager.setAccountControl(accountControl.address)

      // Cache data with successful sync
      mockOracle.getReserveBalanceAndStaleness.returns([
        ethers.utils.parseEther("450"),
        false,
      ])
      await fallbackQCManager
        .connect(monitor)
        .syncBackingFromOracle(qc1.address)

      // Wait for sync interval
      await time.increase(5 * 60 + 1)

      // Force oracle failure detection
      mockOracle.getReserveBalanceAndStaleness.reverts("Oracle error")
      await fallbackQCManager
        .connect(monitor)
        .syncBackingFromOracle(qc1.address)

      const oracleData = await fallbackQCManager.qcOracleData(qc1.address)
      expect(oracleData.oracleFailureDetected).to.be.true
    })

    it("should clear failure flag when oracle recovers", async () => {
      // Wait for sync interval
      await time.increase(5 * 60 + 1)

      // Oracle recovers
      mockOracle.getReserveBalanceAndStaleness.returns([
        ethers.utils.parseEther("500"),
        false,
      ])

      await expect(
        fallbackQCManager.connect(monitor).syncBackingFromOracle(qc1.address)
      )
        .to.emit(fallbackQCManager, "QCOperation")
        .withArgs(
          qc1.address,
          QC_OPERATION_TYPES.ORACLE_RECOVERED,
          0,
          timestampToBytes32((await time.latest()) + 1)
        )

      // Failure flag should be cleared
      const oracleData = await fallbackQCManager.qcOracleData(qc1.address)
      expect(oracleData.oracleFailureDetected).to.be.false
    })

    it("should update cache when oracle recovers", async () => {
      // Wait for sync interval
      await time.increase(5 * 60 + 1)

      // Oracle recovers with new data
      mockOracle.getReserveBalanceAndStaleness.returns([
        ethers.utils.parseEther("600"),
        false,
      ])

      await fallbackQCManager
        .connect(monitor)
        .syncBackingFromOracle(qc1.address)

      // Cache should be updated
      const oracleData = await fallbackQCManager.qcOracleData(qc1.address)
      expect(oracleData.lastKnownReserveBalance).to.equal(
        ethers.utils.parseEther("600")
      )
      const timestamp = await time.latest()
      expect(oracleData.lastKnownBalanceTimestamp).to.equal(timestamp)
    })

    it("should detect repeated oracle failures", async () => {
      // Clear previous failure by successful sync
      await time.increase(5 * 60 + 1)
      mockOracle.getReserveBalanceAndStaleness.returns([
        ethers.utils.parseEther("500"),
        false,
      ])
      await fallbackQCManager
        .connect(monitor)
        .syncBackingFromOracle(qc1.address)
      const oracleData1 = await fallbackQCManager.qcOracleData(qc1.address)
      expect(oracleData1.oracleFailureDetected).to.be.false

      // Wait and make oracle fail again
      await time.increase(5 * 60 + 1)
      mockOracle.getReserveBalanceAndStaleness.reverts("Oracle error again")

      await expect(
        fallbackQCManager.connect(monitor).syncBackingFromOracle(qc1.address)
      )
        .to.emit(fallbackQCManager, "QCOperation")
        .withArgs(
          qc1.address,
          QC_OPERATION_TYPES.ORACLE_FAILED,
          0,
          timestampToBytes32((await time.latest()) + 1)
        )

      const oracleData2 = await fallbackQCManager.qcOracleData(qc1.address)
      expect(oracleData2.oracleFailureDetected).to.be.true
    })
  })

  describe("Integration with Status Changes", () => {
    it("should pause QC when oracle data is stale", async () => {
      // Set stale threshold to 6 hours
      await systemState.connect(owner).setStaleThreshold(6 * 60 * 60)

      // Update reserve balance
      await reserveOracle.updateReserveBalance(
        qc1.address,
        ethers.utils.parseEther("500")
      )

      // Advance time beyond stale threshold
      await time.increase(6 * 60 * 60 + 1)

      // Sync should detect staleness and pause
      await qcManager.connect(monitor).syncBackingFromOracle(qc1.address)

      // QC should be paused
      const status = await qcData.getQCStatus(qc1.address)
      expect(status).to.equal(1) // MintingPaused
    })

    it("should prevent minting when using fallback data", async () => {
      // Enable graceful degradation
      await qcManager.connect(governance).setGracefulDegradation(true)

      // Cache some data
      await qcManager.connect(monitor).syncBackingFromOracle(qc1.address)

      // Wait for sync interval
      await time.increase(5 * 60 + 1)

      // Create mock oracle that fails
      const mockOracle = await smock.fake<ReserveOracle>("ReserveOracle")
      mockOracle.getReserveBalanceAndStaleness.reverts("Oracle error")

      // Deploy new manager with failing oracle
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
      await testManager.grantRole(MINTER_ROLE, owner.address)
      await testManager.connect(governance).setGracefulDegradation(true)
      await testManager.setAccountControl(accountControl.address)

      // Sync will use fallback
      await testManager.connect(monitor).syncBackingFromOracle(qc1.address)

      // Minting should be denied when using fallback data
      await expect(
        testManager.consumeMintCapacity(
          qc1.address,
          ethers.utils.parseEther("100")
        )
      )
        .to.emit(testManager, "QCOperation")
        .withArgs(
          qc1.address,
          QC_OPERATION_TYPES.MINTING_DENIED_FALLBACK,
          ethers.utils.parseEther("100"),
          ethers.utils.hexZeroPad(ethers.utils.parseEther("450"), 32) // Reserve balance as bytes32
        )
    })
  })

  describe("Batch Operations with Fallback", () => {
    it("should handle mixed oracle/fallback in batch sync", async () => {
      // Enable graceful degradation
      await qcManager.connect(governance).setGracefulDegradation(true)

      // Set up: qc1 has fresh data, qc2 will use fallback
      await reserveOracle.updateReserveBalance(
        qc1.address,
        ethers.utils.parseEther("600")
      )

      // Cache data for qc2
      await qcManager.connect(monitor).syncBackingFromOracle(qc2.address)

      // Wait for sync interval
      await time.increase(5 * 60 + 1)

      // Mock partial oracle failure
      const mockOracle = await smock.fake<ReserveOracle>("ReserveOracle")

      // qc1 succeeds, qc2 fails
      mockOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qc1.address)
        .returns([ethers.utils.parseEther("600"), false])
      mockOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qc2.address)
        .reverts("Oracle error for qc2")

      // Deploy new manager with mock
      const libraries = await LibraryLinkingHelper.deployAllLibraries()

      const batchQCManager = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        mockOracle.address,
        pauseManager.address,
        walletManager.address,
        libraries
      )

      await batchQCManager.grantRole(MONITOR_ROLE, monitor.address)
      await batchQCManager.grantRole(GOVERNANCE_ROLE, governance.address)
      await batchQCManager.connect(governance).setGracefulDegradation(true)
      await batchQCManager.setAccountControl(accountControl.address)

      // Copy cached data to new manager (simulate state transfer)
      // In real deployment, this would be part of migration
      const oracleData = await qcManager.qcOracleData(qc2.address)
      const cachedBalance = oracleData.lastKnownReserveBalance
      const cachedTimestamp = oracleData.lastKnownBalanceTimestamp

      // First sync qc2 with working oracle to cache data
      const workingOracle = await smock.fake<ReserveOracle>("ReserveOracle")
      workingOracle.getReserveBalanceAndStaleness.returns([
        cachedBalance,
        false,
      ])

      // Temporarily set working oracle
      const tempManager = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        workingOracle.address,
        pauseManager.address,
        walletManager.address,
        libraries
      )

      await tempManager.grantRole(MONITOR_ROLE, monitor.address)
      await tempManager.setAccountControl(accountControl.address)
      await tempManager.connect(monitor).syncBackingFromOracle(qc2.address)

      // Now test batch with mixed results
      const tx = await batchQCManager
        .connect(monitor)
        .batchSyncBackingFromOracle([qc1.address, qc2.address])

      const receipt = await tx.wait()

      // Check events
      const syncEvents =
        receipt.events?.filter(
          (e) =>
            e.event === "QCOperation" &&
            e.args?.operation === QC_OPERATION_TYPES.SYNC_SUCCESS
        ) || []

      const batchEvent = receipt.events?.find(
        (e) =>
          e.event === "BatchOperation" &&
          e.args?.operation === QC_OPERATION_TYPES.BATCH_SYNC
      )

      expect(syncEvents.length).to.equal(1) // Only qc1 succeeded
      expect(batchEvent).to.exist

      // Check for sync failed events
      const failEvents =
        receipt.events?.filter(
          (e) =>
            e.event === "QCOperation" &&
            e.args?.operation === QC_OPERATION_TYPES.SYNC_FAILED
        ) || []

      expect(failEvents.length).to.equal(1) // qc2 failed

      // qc1 should have oracle data, qc2 should be marked as having oracle failure
      const oracleData1 = await batchQCManager.qcOracleData(qc1.address)
      const oracleData2 = await batchQCManager.qcOracleData(qc2.address)
      expect(oracleData1.oracleFailureDetected).to.be.false
      expect(oracleData2.oracleFailureDetected).to.be.true
    })
  })

  describe("Oracle Health Monitoring", () => {
    it("should check oracle health for multiple QCs", async () => {
      // Enable graceful degradation
      await qcManager.connect(governance).setGracefulDegradation(true)

      // Mock some oracle failures
      const mockOracle = await smock.fake<ReserveOracle>("ReserveOracle")

      // qc1 succeeds, qc2 fails
      mockOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qc1.address)
        .returns([ethers.utils.parseEther("500"), false])
      mockOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qc2.address)
        .reverts("Oracle error")

      // Deploy manager with mock
      const libraries = await LibraryLinkingHelper.deployAllLibraries()

      const healthManager = await LibraryLinkingHelper.deployQCManager(
        qcData.address,
        systemState.address,
        mockOracle.address,
        pauseManager.address,
        walletManager.address,
        libraries
      )

      await healthManager.grantRole(MONITOR_ROLE, monitor.address)

      // Check oracle health
      const tx = await healthManager
        .connect(monitor)
        .checkOracleHealth([qc1.address, qc2.address])

      const receipt = await tx.wait()

      // Should emit health check events
      const healthEvent = receipt.events?.find(
        (e) => e.event === "BatchHealthCheckCompleted"
      )

      expect(healthEvent).to.exist
      expect(healthEvent?.args?.healthy).to.equal(1) // Only qc1 is healthy
      expect(healthEvent?.args?.failed).to.equal(1) // qc2 failed
    })

    it("should use batch operation gas limits", async () => {
      const allQCs = [qc1.address, qc2.address]

      // Use batchCheckOracleHealth with gas limit
      const tx = await qcManager
        .connect(monitor)
        .batchCheckOracleHealth(allQCs, { gasLimit: 500000 })

      const receipt = await tx.wait()

      // Should complete within gas limit
      expect(receipt.status).to.equal(1)
    })
  })
})
