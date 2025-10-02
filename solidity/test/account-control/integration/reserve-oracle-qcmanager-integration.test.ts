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

describe("ReserveOracle - QCManager Integration", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let attester1: SignerWithAddress
  let attester2: SignerWithAddress
  let attester3: SignerWithAddress
  let qcAddress: SignerWithAddress
  let arbiter: SignerWithAddress
  let monitor: SignerWithAddress
  let user: SignerWithAddress

  let reserveOracle: ReserveOracle
  let qcManager: QCManager
  let qcData: QCData
  let systemState: SystemState
  let accountControl: AccountControl
  let pauseManager: QCPauseManager
  let walletManager: QCWalletManager

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
    qcAddress = signers[5]
    arbiter = signers[6]
    monitor = signers[7]
    user = signers[8]
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

    // Deploy mock AccountControl and other dependencies
    const MockAccountControlFactory = await ethers.getContractFactory(
      "MockAccountControl"
    )

    accountControl = await MockAccountControlFactory.deploy()
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

    // Deploy QCManager with library linking
    const QCManagerFactory = await LibraryLinkingHelper.getQCManagerFactory()
    qcManager = (await QCManagerFactory.deploy(
      qcData.address,
      systemState.address,
      reserveOracle.address,
      pauseManager.address,
      walletManager.address
    )) as QCManager

    await qcManager.deployed()

    // Initialize QCManager
    await qcManager.initialize(accountControl.address)

    // Set QCManager address in ReserveOracle for integration
    await reserveOracle.setQCManager(qcManager.address)

    // Setup roles
    await setupReserveOracleRoles(reserveOracle, {
      deployer,
      attesters: [attester1, attester2, attester3],
      arbiter,
      qcAddress,
    })

    await qcManager.grantRole(GOVERNANCE_ROLE, governance.address)
    await qcManager.grantRole(MONITOR_ROLE, monitor.address)
    await qcManager.grantRole(MONITOR_ROLE, reserveOracle.address) // Allow oracle to call sync

    // Register QC in QCManager for testing
    await qcData.grantRole(await qcData.QC_REGISTRAR_ROLE(), deployer.address)
    await qcData.registerQC(
      qcAddress.address,
      "Test QC",
      ethers.utils.parseEther("100"), // maxMintingCap
      0, // reserveType
      "QC for testing oracle integration"
    )
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Automatic Backing Synchronization", () => {
    it("should automatically sync backing when consensus is reached", async () => {
      const attestedBalance = ethers.utils.parseEther("100")

      // Verify initial state - no backing set
      const initialBacking = await accountControl.getBacking(qcAddress.address)
      expect(initialBacking).to.equal(0)

      // Submit attestations to reach consensus
      await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance: attestedBalance,
      })

      // Verify backing was automatically synced
      const finalBacking = await accountControl.getBacking(qcAddress.address)
      expect(finalBacking).to.equal(attestedBalance)
    })

    it("should sync backing when using direct updateReserveBalance function", async () => {
      const newBalance = ethers.utils.parseEther("200")

      // Use direct update function (bypasses consensus)
      await reserveOracle
        .connect(attester1)
        .updateReserveBalance(qcAddress.address, newBalance)

      // Verify backing was automatically synced
      const backing = await accountControl.getBacking(qcAddress.address)
      expect(backing).to.equal(newBalance)
    })

    it("should sync backing when arbiter overrides attestation", async () => {
      // First establish a consensus balance
      const consensusBalance = ethers.utils.parseEther("100")
      await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance: consensusBalance,
      })

      // Arbiter overrides with new balance
      const overrideBalance = ethers.utils.parseEther("150")
      await reserveOracle
        .connect(arbiter)
        .overrideAttestation(
          qcAddress.address,
          overrideBalance,
          "Correction needed"
        )

      // Verify backing was synced to override amount
      const backing = await accountControl.getBacking(qcAddress.address)
      expect(backing).to.equal(overrideBalance)
    })

    it("should handle sync failures gracefully", async () => {
      // Remove QCManager from ReserveOracle to simulate sync failure
      await reserveOracle.setQCManager(ethers.constants.AddressZero)

      const attestedBalance = ethers.utils.parseEther("100")

      // Consensus should still be reached even if sync fails
      const tx = await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance: attestedBalance,
      })

      // Verify consensus was reached despite sync failure
      expect(tx.consensusReached).to.be.true
      expect(tx.finalBalance).to.equal(attestedBalance)

      // Verify backing was not updated (since sync failed)
      const backing = await accountControl.getBacking(qcAddress.address)
      expect(backing).to.equal(0)
    })
  })

  describe("Manual Sync Operations", () => {
    beforeEach(async () => {
      // Set up a reserve balance first
      const reserveBalance = ethers.utils.parseEther("100")
      await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance: reserveBalance,
      })
    })

    it("should allow manual sync by monitor role", async () => {
      // Reset backing to simulate desync
      await accountControl.setBacking(qcAddress.address, 0)

      // Manually sync
      await qcManager.connect(monitor).syncBackingFromOracle(qcAddress.address)

      // Verify backing was synced
      const backing = await accountControl.getBacking(qcAddress.address)
      expect(backing).to.equal(ethers.utils.parseEther("100"))
    })

    it("should enforce rate limiting on manual sync", async () => {
      // First sync
      await qcManager.connect(monitor).syncBackingFromOracle(qcAddress.address)

      // Immediate second sync should be rate limited
      await expect(
        qcManager.connect(monitor).syncBackingFromOracle(qcAddress.address)
      ).to.be.revertedWith("OracleRetryTooSoon")
    })

    it("should revert manual sync for invalid QC", async () => {
      const invalidQC = user.address // Not a registered QC

      await expect(
        qcManager.connect(monitor).syncBackingFromOracle(invalidQC)
      ).to.be.revertedWith("Invalid QC")
    })

    it("should revert manual sync if caller lacks monitor role", async () => {
      await expect(
        qcManager.connect(user).syncBackingFromOracle(qcAddress.address)
      ).to.be.revertedWith("AccessControl")
    })
  })

  describe("Stale Data Handling", () => {
    it("should handle stale oracle data in sync operations", async () => {
      // Establish initial balance
      const initialBalance = ethers.utils.parseEther("100")
      await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance: initialBalance,
      })

      // Advance time to make data stale
      const maxStaleness = await systemState.oracleMaxStaleness()
      await ethers.provider.send("evm_increaseTime", [
        maxStaleness.add(1).toNumber(),
      ])
      await ethers.provider.send("evm_mine", [])

      // Verify data is now stale
      const [, isStale] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )

      expect(isStale).to.be.true

      // Reset backing to simulate desync
      await accountControl.setBacking(qcAddress.address, 0)

      // Manual sync should still work with stale data but might handle differently
      await qcManager.connect(monitor).syncBackingFromOracle(qcAddress.address)

      // Backing should still be synced even with stale data
      const backing = await accountControl.getBacking(qcAddress.address)
      expect(backing).to.equal(initialBalance)
    })
  })

  describe("Multi-QC Synchronization", () => {
    let qc2Address: SignerWithAddress
    let qc3Address: SignerWithAddress

    beforeEach(async () => {
      qc2Address = user // Reuse as second QC
      qc3Address = arbiter // Reuse as third QC

      // Register additional QCs
      await qcData.registerQC(
        qc2Address.address,
        "Test QC 2",
        ethers.utils.parseEther("200"),
        0,
        "Second QC for testing"
      )
      await qcData.registerQC(
        qc3Address.address,
        "Test QC 3",
        ethers.utils.parseEther("300"),
        0,
        "Third QC for testing"
      )
    })

    it("should handle batch attestations with automatic sync", async () => {
      const qcs = [qcAddress.address, qc2Address.address, qc3Address.address]

      const balances = [
        ethers.utils.parseEther("100"),
        ethers.utils.parseEther("200"),
        ethers.utils.parseEther("300"),
      ]

      // Submit batch attestations for all QCs
      await reserveOracle.connect(attester1).batchAttestBalances(qcs, balances)
      await reserveOracle.connect(attester2).batchAttestBalances(qcs, balances)

      // Third batch should trigger consensus for all
      const tx = await reserveOracle
        .connect(attester3)
        .batchAttestBalances(qcs, balances)

      // Verify all reached consensus
      const receipt = await tx.wait()

      const consensusEvents = receipt.events?.filter(
        (e) => e.event === "ConsensusReached"
      )

      expect(consensusEvents).to.have.length(3)

      // Verify all backing amounts were synced
      for (let i = 0; i < qcs.length; i++) {
        const backing = await accountControl.getBacking(qcs[i])
        expect(backing).to.equal(balances[i])
      }
    })

    it("should handle mixed consensus scenarios", async () => {
      // First QC reaches consensus
      await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance: ethers.utils.parseEther("100"),
      })

      // Second QC only has partial attestations (no consensus)
      await reserveOracle
        .connect(attester1)
        .attestBalance(qc2Address.address, ethers.utils.parseEther("200"))
      await reserveOracle
        .connect(attester2)
        .attestBalance(qc2Address.address, ethers.utils.parseEther("200"))
      // Missing third attestation

      // Verify first QC was synced
      const backing1 = await accountControl.getBacking(qcAddress.address)
      expect(backing1).to.equal(ethers.utils.parseEther("100"))

      // Verify second QC was not synced (no consensus)
      const backing2 = await accountControl.getBacking(qc2Address.address)
      expect(backing2).to.equal(0)
    })
  })

  describe("Error Recovery and Resilience", () => {
    it("should recover from failed automatic sync during consensus", async () => {
      // Set up a scenario where automatic sync might fail
      const attestedBalance = ethers.utils.parseEther("100")

      // Temporarily remove QC registration to cause sync failure
      await qcData.suspendQC(
        qcAddress.address,
        "Temporary suspension for testing"
      )

      // Consensus should still be reached
      await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance: attestedBalance,
      })

      // Verify oracle balance was set despite sync failure
      const [oracleBalance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )

      expect(oracleBalance).to.equal(attestedBalance)

      // Restore QC and manually sync
      await qcData.unsuspendQC(qcAddress.address, "Restored for testing")
      await qcManager.connect(monitor).syncBackingFromOracle(qcAddress.address)

      // Verify sync now works
      const backing = await accountControl.getBacking(qcAddress.address)
      expect(backing).to.equal(attestedBalance)
    })

    it("should handle rapid consecutive updates properly", async () => {
      const balances = [
        ethers.utils.parseEther("100"),
        ethers.utils.parseEther("150"),
        ethers.utils.parseEther("200"),
      ]

      // Rapid succession of consensus changes
      for (const balance of balances) {
        await reserveOracle.connect(arbiter).resetConsensus(qcAddress.address)

        await submitAttestationsForConsensus({
          reserveOracle,
          systemState,
          attesters: [attester1, attester2, attester3],
          qcAddress: qcAddress.address,
          balance,
        })

        // Verify each update synced correctly
        const backing = await accountControl.getBacking(qcAddress.address)
        expect(backing).to.equal(balance)
      }
    })
  })

  describe("Integration Edge Cases", () => {
    it("should handle zero balance consensus and sync", async () => {
      const zeroBalance = ethers.BigNumber.from(0)

      await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance: zeroBalance,
      })

      // Verify zero balance was synced
      const backing = await accountControl.getBacking(qcAddress.address)
      expect(backing).to.equal(0)
    })

    it("should handle very large balance values", async () => {
      const largeBalance = ethers.BigNumber.from(2).pow(128).sub(1) // Max uint128

      await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance: largeBalance,
      })

      // Verify large balance was synced correctly
      const backing = await accountControl.getBacking(qcAddress.address)
      expect(backing).to.equal(largeBalance)
    })

    it("should maintain sync consistency across QCManager reinitialization", async () => {
      // Establish initial state
      const initialBalance = ethers.utils.parseEther("100")
      await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: [attester1, attester2, attester3],
        qcAddress: qcAddress.address,
        balance: initialBalance,
      })

      // Simulate QCManager reinitialization
      await qcManager.initialize(accountControl.address)

      // Verify sync still works after reinitialization
      const newBalance = ethers.utils.parseEther("150")
      await reserveOracle
        .connect(attester1)
        .updateReserveBalance(qcAddress.address, newBalance)

      const backing = await accountControl.getBacking(qcAddress.address)
      expect(backing).to.equal(newBalance)
    })
  })
})
