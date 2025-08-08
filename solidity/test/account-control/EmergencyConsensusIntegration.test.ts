import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  QCReserveLedger,
  QCManager,
  QCData,
  BasicMintingPolicy,
  BasicRedemptionPolicy,
  ProtocolRegistry,
  SystemState,
  WatchdogEnforcer,
} from "../../typechain"

describe("Emergency Consensus Integration", () => {
  let deployer: SignerWithAddress
  let arbiter: SignerWithAddress
  let attester1: SignerWithAddress
  let attester2: SignerWithAddress
  let attester3: SignerWithAddress
  let qc: SignerWithAddress
  let user: SignerWithAddress
  let anyUser: SignerWithAddress

  let protocolRegistry: ProtocolRegistry
  let qcReserveLedger: QCReserveLedger
  let qcManager: QCManager
  let qcData: QCData
  let systemState: SystemState
  let watchdogEnforcer: WatchdogEnforcer
  // let mockMintingPolicy: FakeContract<BasicMintingPolicy>
  // let mockRedemptionPolicy: FakeContract<BasicRedemptionPolicy>

  // Service keys
  const QC_DATA_KEY = ethers.utils.id("QC_DATA")
  const SYSTEM_STATE_KEY = ethers.utils.id("SYSTEM_STATE")
  const QC_RESERVE_LEDGER_KEY = ethers.utils.id("QC_RESERVE_LEDGER")

  // Roles
  const ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE")
  const ARBITER_ROLE = ethers.utils.id("ARBITER_ROLE")
  const QC_MANAGER_ROLE = ethers.utils.id("QC_MANAGER_ROLE")
  const WATCHDOG_ENFORCER_ROLE = ethers.utils.id("WATCHDOG_ENFORCER_ROLE")
  const QC_GOVERNANCE_ROLE = ethers.utils.id("QC_GOVERNANCE_ROLE")

  // Reason codes
  const STALE_ATTESTATIONS = ethers.utils.id("STALE_ATTESTATIONS")
  const RESERVES_RESTORED = ethers.utils.id("RESERVES_RESTORED")

  const initialCapacity = ethers.utils.parseEther("1000")
  const reserveBalance = ethers.utils.parseEther("500")

  beforeEach(async () => {
    ;[deployer, arbiter, attester1, attester2, attester3, qc, user, anyUser] =
      await ethers.getSigners()

    // Deploy ProtocolRegistry
    const ProtocolRegistryFactory = await ethers.getContractFactory(
      "ProtocolRegistry"
    )
    protocolRegistry = await ProtocolRegistryFactory.deploy()

    // Deploy SystemState
    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy()

    // Deploy QCData
    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy()

    // Deploy QCReserveLedger
    const QCReserveLedgerFactory = await ethers.getContractFactory(
      "QCReserveLedger"
    )
    qcReserveLedger = await QCReserveLedgerFactory.deploy()

    // Deploy QCManager
    const QCManagerFactory = await ethers.getContractFactory("QCManager")
    qcManager = await QCManagerFactory.deploy(protocolRegistry.address)

    // Deploy WatchdogEnforcer
    const WatchdogEnforcerFactory = await ethers.getContractFactory(
      "WatchdogEnforcer"
    )
    watchdogEnforcer = await WatchdogEnforcerFactory.deploy(
      qcReserveLedger.address,
      qcManager.address,
      qcData.address,
      systemState.address
    )

    // No additional mocks needed for this test

    // Register services
    await protocolRegistry.setService(QC_DATA_KEY, qcData.address)
    await protocolRegistry.setService(SYSTEM_STATE_KEY, systemState.address)
    await protocolRegistry.setService(
      QC_RESERVE_LEDGER_KEY,
      qcReserveLedger.address
    )

    // Grant roles
    await qcReserveLedger.grantRole(ATTESTER_ROLE, attester1.address)
    await qcReserveLedger.grantRole(ATTESTER_ROLE, attester2.address)
    await qcReserveLedger.grantRole(ATTESTER_ROLE, attester3.address)
    await qcReserveLedger.grantRole(ARBITER_ROLE, arbiter.address)

    await qcData.grantRole(QC_MANAGER_ROLE, qcManager.address)
    await qcManager.grantRole(ARBITER_ROLE, arbiter.address)
    await qcManager.grantRole(QC_GOVERNANCE_ROLE, deployer.address)
    await qcManager.grantRole(WATCHDOG_ENFORCER_ROLE, watchdogEnforcer.address)

    // Register QC
    await qcManager.registerQC(qc.address, initialCapacity)

    // Setup initial consensus
    await qcReserveLedger
      .connect(attester1)
      .submitAttestation(qc.address, reserveBalance)
    await qcReserveLedger
      .connect(attester2)
      .submitAttestation(qc.address, reserveBalance)
    await qcReserveLedger
      .connect(attester3)
      .submitAttestation(qc.address, reserveBalance)

    // Verify initial state
    const [balance, isStale] =
      await qcReserveLedger.getReserveBalanceAndStaleness(qc.address)
    expect(balance).to.equal(reserveBalance)
    expect(isStale).to.be.false
  })

  describe("Complete Emergency Consensus Workflow", () => {
    it("should handle stale reserves → enforcement → forced consensus → recovery", async () => {
      // 1. Advance time to make reserves stale (> 24 hours)
      const maxStaleness = await qcReserveLedger.maxStaleness()
      await ethers.provider.send("evm_increaseTime", [
        maxStaleness.toNumber() + 1,
      ])
      await ethers.provider.send("evm_mine", [])

      // Verify reserves are now stale
      let [balance, isStale] =
        await qcReserveLedger.getReserveBalanceAndStaleness(qc.address)
      expect(isStale).to.be.true
      expect(balance).to.equal(reserveBalance) // Still has old balance

      // 2. Anyone can trigger enforcement for stale attestations
      await expect(
        watchdogEnforcer
          .connect(anyUser)
          .enforceObjectiveViolation(qc.address, STALE_ATTESTATIONS)
      ).to.emit(watchdogEnforcer, "ObjectiveViolationEnforced")

      // Verify QC is now UnderReview
      const qcStatus = await qcData.getQCStatus(qc.address)
      expect(qcStatus).to.equal(1) // UnderReview

      // 3. Submit fresh attestations (but only 2, below threshold of 3)
      const newReserveBalance = ethers.utils.parseEther("600")
      await qcReserveLedger
        .connect(attester1)
        .submitAttestation(qc.address, newReserveBalance)
      await qcReserveLedger
        .connect(attester2)
        .submitAttestation(qc.address, newReserveBalance)

      // Verify consensus was NOT reached (need 3 attestations)
      ;[balance, isStale] = await qcReserveLedger.getReserveBalanceAndStaleness(
        qc.address
      )
      expect(balance).to.equal(reserveBalance) // Still old balance
      expect(isStale).to.be.true // Still stale

      // 4. Arbiter forces consensus with available attestations
      const tx = await qcReserveLedger
        .connect(arbiter)
        .forceConsensus(qc.address)

      // Verify ForcedConsensusReached event
      await expect(tx)
        .to.emit(qcReserveLedger, "ForcedConsensusReached")
        .withArgs(
          qc.address,
          newReserveBalance,
          2,
          arbiter.address,
          [attester1.address, attester2.address],
          [newReserveBalance, newReserveBalance]
        )

      // 5. Verify reserves are updated and no longer stale
      ;[balance, isStale] = await qcReserveLedger.getReserveBalanceAndStaleness(
        qc.address
      )
      expect(balance).to.equal(newReserveBalance)
      expect(isStale).to.be.false

      // 6. Arbiter moves QC back to Active status
      await expect(
        qcManager.connect(arbiter).setQCStatus(qc.address, 0, RESERVES_RESTORED)
      ).to.emit(qcManager, "QCStatusChanged")

      // Verify QC is Active again
      const finalStatus = await qcData.getQCStatus(qc.address)
      expect(finalStatus).to.equal(0) // Active
    })

    it("should allow attestations to continue during UnderReview", async () => {
      // Make reserves stale
      const maxStaleness = await qcReserveLedger.maxStaleness()
      await ethers.provider.send("evm_increaseTime", [
        maxStaleness.toNumber() + 1,
      ])
      await ethers.provider.send("evm_mine", [])

      // Trigger enforcement
      await watchdogEnforcer.enforceObjectiveViolation(
        qc.address,
        STALE_ATTESTATIONS
      )

      // Verify QC is UnderReview
      expect(await qcData.getQCStatus(qc.address)).to.equal(1)

      // Submit attestations while QC is UnderReview
      const newBalance1 = ethers.utils.parseEther("700")
      const newBalance2 = ethers.utils.parseEther("750")
      const newBalance3 = ethers.utils.parseEther("800")

      await qcReserveLedger
        .connect(attester1)
        .submitAttestation(qc.address, newBalance1)
      await qcReserveLedger
        .connect(attester2)
        .submitAttestation(qc.address, newBalance2)

      // Force consensus with partial attestations
      await qcReserveLedger.connect(arbiter).forceConsensus(qc.address)

      // Verify median was used (median of 700, 750 is 725)
      const [balance1] = await qcReserveLedger.getReserveBalanceAndStaleness(
        qc.address
      )
      expect(balance1).to.equal(ethers.utils.parseEther("725"))

      // Submit another attestation after forced consensus
      await qcReserveLedger
        .connect(attester3)
        .submitAttestation(qc.address, newBalance3)

      // Now regular consensus should work with fresh attestations
      await qcReserveLedger
        .connect(attester1)
        .submitAttestation(qc.address, newBalance3)
      await qcReserveLedger
        .connect(attester2)
        .submitAttestation(qc.address, newBalance3)

      // Verify consensus was reached normally
      const [balance2, isStale] =
        await qcReserveLedger.getReserveBalanceAndStaleness(qc.address)
      expect(balance2).to.equal(newBalance3)
      expect(isStale).to.be.false
    })

    it("should handle multiple QCs independently", async () => {
      // Register second QC
      const qc2 = (await ethers.getSigners())[8]
      await qcManager.registerQC(qc2.address, initialCapacity)

      // Set up initial consensus for QC2
      const qc2Balance = ethers.utils.parseEther("1000")
      await qcReserveLedger
        .connect(attester1)
        .submitAttestation(qc2.address, qc2Balance)
      await qcReserveLedger
        .connect(attester2)
        .submitAttestation(qc2.address, qc2Balance)
      await qcReserveLedger
        .connect(attester3)
        .submitAttestation(qc2.address, qc2Balance)

      // Make both QCs stale
      const maxStaleness = await qcReserveLedger.maxStaleness()
      await ethers.provider.send("evm_increaseTime", [
        maxStaleness.toNumber() + 1,
      ])
      await ethers.provider.send("evm_mine", [])

      // Both QCs should be stale now
      let [balance1, isStale1] =
        await qcReserveLedger.getReserveBalanceAndStaleness(qc.address)
      let [balance2, isStale2] =
        await qcReserveLedger.getReserveBalanceAndStaleness(qc2.address)
      expect(isStale1).to.be.true
      expect(isStale2).to.be.true

      // Enforce only for QC1
      await watchdogEnforcer.enforceObjectiveViolation(
        qc.address,
        STALE_ATTESTATIONS
      )
      expect(await qcData.getQCStatus(qc.address)).to.equal(1) // UnderReview
      expect(await qcData.getQCStatus(qc2.address)).to.equal(0) // Still Active

      // Force consensus only for QC1
      await qcReserveLedger
        .connect(attester1)
        .submitAttestation(qc.address, ethers.utils.parseEther("550"))
      await qcReserveLedger.connect(arbiter).forceConsensus(qc.address)

      // QC1 should be fresh, QC2 still stale
      ;[balance1, isStale1] =
        await qcReserveLedger.getReserveBalanceAndStaleness(qc.address)
      ;[balance2, isStale2] =
        await qcReserveLedger.getReserveBalanceAndStaleness(qc2.address)
      expect(isStale1).to.be.false
      expect(isStale2).to.be.true
      expect(balance1).to.equal(ethers.utils.parseEther("550"))
      expect(balance2).to.equal(qc2Balance)
    })

    it("should prevent forced consensus without any valid attestations", async () => {
      // Make reserves stale
      const maxStaleness = await qcReserveLedger.maxStaleness()
      await ethers.provider.send("evm_increaseTime", [
        maxStaleness.toNumber() + 1,
      ])
      await ethers.provider.send("evm_mine", [])

      // Trigger enforcement
      await watchdogEnforcer.enforceObjectiveViolation(
        qc.address,
        STALE_ATTESTATIONS
      )

      // Try to force consensus without any new attestations
      await expect(
        qcReserveLedger.connect(arbiter).forceConsensus(qc.address)
      ).to.be.revertedWith("No valid attestations to force consensus")
    })

    it("should reject forced consensus from non-arbiter", async () => {
      // Submit attestation
      await qcReserveLedger
        .connect(attester1)
        .submitAttestation(qc.address, ethers.utils.parseEther("100"))

      // Try to force consensus without ARBITER_ROLE
      await expect(
        qcReserveLedger.connect(user).forceConsensus(qc.address)
      ).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role ${ARBITER_ROLE}`
      )
    })
  })
})
