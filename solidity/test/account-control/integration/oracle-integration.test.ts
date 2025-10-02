import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { LibraryLinkingHelper } from "../helpers/library-linking-helper"
import { setupSystemStateDefaults } from "../../helpers/role-setup-utils"

import {
  AccountControl,
  QCManager,
  ReserveOracle,
  QCData,
  SystemState,
} from "../../../typechain"

/**
 * Oracle Integration Tests
 *
 * Tests ReserveOracle integration with AccountControl system,
 * including attester roles, consensus mechanisms, and oracle-based reserve validation.
 *
 * Consolidated from:
 * - AccountControlOracleIntegration.test.ts (complete oracle integration scenarios)
 */
describe("Oracle Integration Tests", () => {
  let accountControl: AccountControl
  let qcManager: QCManager
  let reserveOracle: ReserveOracle
  let qcData: QCData
  let systemState: SystemState
  let mockBank: any

  // Constants
  const SATOSHI_MULTIPLIER = ethers.BigNumber.from("10000000000") // 1e10 - converts satoshis to tBTC
  let pauseManager: any

  let owner: SignerWithAddress
  let emergencyCouncil: SignerWithAddress
  let qc: SignerWithAddress
  let attester1: SignerWithAddress
  let attester2: SignerWithAddress
  let attester3: SignerWithAddress
  let user: SignerWithAddress

  // Helper constants for wei amounts
  const ONE_SATOSHI_IN_WEI = ethers.BigNumber.from("10000000000") // 1e10 wei per satoshi
  const ONE_BTC_IN_SATOSHIS = ethers.BigNumber.from("100000000") // 1e8 satoshis per BTC
  const ONE_TBTC = ethers.utils.parseEther("1") // 1e18 wei (1 tBTC)

  const QC_MINTING_CAP = ethers.utils.parseEther("10") // 10 tBTC cap

  beforeEach(async () => {
    ;[owner, emergencyCouncil, qc, attester1, attester2, attester3, user] =
      await ethers.getSigners()

    // Deploy mock Bank
    const MockBankFactory = await ethers.getContractFactory("MockBank")
    mockBank = await MockBankFactory.deploy()

    // Deploy QCData
    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy()

    // Deploy SystemState
    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy()

    // Deploy ReserveOracle (uses constructor, not upgradeable)
    const ReserveOracleFactory = await ethers.getContractFactory(
      "ReserveOracle"
    )

    reserveOracle = await ReserveOracleFactory.deploy(systemState.address)

    // Configure ReserveOracle after deployment
    // First grant DISPUTE_ARBITER_ROLE to owner to set configuration
    const DISPUTE_ARBITER_ROLE = await reserveOracle.DISPUTE_ARBITER_ROLE()
    await reserveOracle.grantRole(DISPUTE_ARBITER_ROLE, owner.address)

    // Set consensus threshold to 3 (minimum odd number)
    await reserveOracle.setConsensusThreshold(3)
    await reserveOracle.setAttestationTimeout(3600) // 1 hour

    // Grant attester roles
    const ATTESTER_ROLE = await reserveOracle.ATTESTER_ROLE()
    await reserveOracle.grantRole(ATTESTER_ROLE, attester1.address)
    await reserveOracle.grantRole(ATTESTER_ROLE, attester2.address)
    await reserveOracle.grantRole(ATTESTER_ROLE, attester3.address)

    // Deploy AccountControl
    const AccountControlFactory = await ethers.getContractFactory(
      "AccountControl"
    )

    accountControl = await AccountControlFactory.deploy(
      owner.address,
      emergencyCouncil.address,
      mockBank.address
    )

    // Deploy QCPauseManager with temporary addresses (circular dependency workaround for testing)
    const QCPauseManagerFactory = await ethers.getContractFactory(
      "QCPauseManager"
    )

    pauseManager = await QCPauseManagerFactory.deploy(
      qcData.address, // _qcData
      owner.address, // _qcManager (temporary - will be QCManager later)
      owner.address, // _admin
      emergencyCouncil.address // _emergencyRole
    )
    await pauseManager.deployed()

    // Deploy MockQCWalletManager
    const MockQCWalletManagerFactory = await ethers.getContractFactory(
      "MockQCWalletManager"
    )

    const walletManager = await MockQCWalletManagerFactory.deploy()
    await walletManager.deployed()

    // Deploy QCManager using LibraryLinkingHelper
    qcManager = await LibraryLinkingHelper.deployQCManager(
      qcData.address,
      systemState.address,
      reserveOracle.address,
      pauseManager.address,
      walletManager.address
    )

    // Update QCPauseManager to point to actual QCManager
    await pauseManager.connect(owner).setQCManager(qcManager.address)

    // Set QCManager in ReserveOracle for automatic backing synchronization
    await reserveOracle.connect(owner).setQCManager(qcManager.address)

    // Setup default system state
    await setupSystemStateDefaults(systemState, owner)

    // Set AccountControl address in QCManager
    await qcManager.connect(owner).setAccountControl(accountControl.address)

    // Grant GOVERNANCE_ROLE to owner for QCManager operations
    const GOVERNANCE_ROLE = await qcManager.GOVERNANCE_ROLE()
    await qcManager.connect(owner).grantRole(GOVERNANCE_ROLE, owner.address)

    // Grant MONITOR_ROLE to owner for syncBackingFromOracle operations
    const MONITOR_ROLE = await qcManager.MONITOR_ROLE()
    await qcManager.connect(owner).grantRole(MONITOR_ROLE, owner.address)

    // Grant RESERVE_ROLE and ORACLE_ROLE to QCManager in AccountControl
    const RESERVE_ROLE = await accountControl.RESERVE_ROLE()
    const ORACLE_ROLE = await accountControl.ORACLE_ROLE()
    await accountControl
      .connect(owner)
      .grantRole(RESERVE_ROLE, qcManager.address)
    await accountControl
      .connect(owner)
      .grantRole(ORACLE_ROLE, qcManager.address)

    // Grant QC_MANAGER_ROLE to QCManager in QCData
    const QC_MANAGER_ROLE_QCDATA = await qcData.QC_MANAGER_ROLE()
    await qcData
      .connect(owner)
      .grantRole(QC_MANAGER_ROLE_QCDATA, qcManager.address)
  })

  describe("Oracle Setup and Configuration", () => {
    it("should properly configure ReserveOracle with attesters", async () => {
      // Verify attester roles are granted
      const ATTESTER_ROLE = await reserveOracle.ATTESTER_ROLE()

      expect(await reserveOracle.hasRole(ATTESTER_ROLE, attester1.address)).to
        .be.true
      expect(await reserveOracle.hasRole(ATTESTER_ROLE, attester2.address)).to
        .be.true
      expect(await reserveOracle.hasRole(ATTESTER_ROLE, attester3.address)).to
        .be.true

      // Verify consensus threshold
      expect(await reserveOracle.consensusThreshold()).to.equal(3)

      // Verify attestation timeout
      expect(await reserveOracle.attestationTimeout()).to.equal(3600)
    })

    it("should handle attester role management", async () => {
      const newAttester = user
      const ATTESTER_ROLE = await reserveOracle.ATTESTER_ROLE()

      // Grant new attester role
      await reserveOracle
        .connect(owner)
        .grantRole(ATTESTER_ROLE, newAttester.address)
      expect(await reserveOracle.hasRole(ATTESTER_ROLE, newAttester.address)).to
        .be.true

      // Revoke attester role
      await reserveOracle
        .connect(owner)
        .revokeRole(ATTESTER_ROLE, newAttester.address)
      expect(await reserveOracle.hasRole(ATTESTER_ROLE, newAttester.address)).to
        .be.false
    })
  })

  describe("Reserve Attestation Workflows", () => {
    beforeEach(async () => {
      // Register QC first
      await qcManager.connect(owner).registerQC(qc.address, QC_MINTING_CAP)

      // Set initial oracle backing to 5 BTC for integration tests
      const initialBacking = ONE_BTC_IN_SATOSHIS.mul(5) // 5 BTC
      await reserveOracle
        .connect(owner)
        .emergencySetReserve(qc.address, initialBacking)

      // Sync the backing to AccountControl
      await qcManager.connect(owner).syncBackingFromOracle(qc.address)
    })

    it("should handle single attester reserve submission", async () => {
      const reserveAmount = ONE_BTC_IN_SATOSHIS.mul(3) // 3 BTC

      const attestationData = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["address", "uint256", "uint256"],
          [qc.address, reserveAmount, await ethers.provider.getBlockNumber()]
        )
      )

      // Submit attestation from first attester
      const tx = await reserveOracle
        .connect(attester1)
        .submitAttestation(qc.address, reserveAmount, attestationData)

      await expect(tx)
        .to.emit(reserveOracle, "AttestationSubmitted")
        .withArgs(attester1.address, qc.address, reserveAmount)

      // Verify attestation is recorded but not yet finalized (needs consensus)
      const attestation = await reserveOracle.getAttestation(qc.address)
      expect(attestation.pending).to.be.true
      expect(attestation.attestations).to.equal(1)
    })

    it("should achieve consensus with multiple attesters", async () => {
      const reserveAmount = ONE_BTC_IN_SATOSHIS.mul(4) // 4 BTC
      const blockNumber = await ethers.provider.getBlockNumber()

      const attestationData = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["address", "uint256", "uint256"],
          [qc.address, reserveAmount, blockNumber]
        )
      )

      // Submit attestations from all three attesters
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qc.address, reserveAmount, attestationData)

      await reserveOracle
        .connect(attester2)
        .submitAttestation(qc.address, reserveAmount, attestationData)

      // Third attestation should trigger consensus
      const tx = await reserveOracle
        .connect(attester3)
        .submitAttestation(qc.address, reserveAmount, attestationData)

      await expect(tx)
        .to.emit(reserveOracle, "ConsensusReached")
        .withArgs(qc.address, reserveAmount)

      // Should also trigger backing update in AccountControl
      await expect(tx)
        .to.emit(accountControl, "BackingUpdated")
        .withArgs(qc.address, ONE_BTC_IN_SATOSHIS.mul(5), reserveAmount)

      // Verify attestation is finalized
      const attestation = await reserveOracle.getAttestation(qc.address)
      expect(attestation.pending).to.be.false
      expect(attestation.finalizedAmount).to.equal(reserveAmount)

      // Verify AccountControl backing is updated
      const backing = await accountControl.backing(qc.address)
      expect(backing).to.equal(reserveAmount)
    })

    it("should handle conflicting attestations", async () => {
      const reserveAmount1 = ONE_BTC_IN_SATOSHIS.mul(3)
      const reserveAmount2 = ONE_BTC_IN_SATOSHIS.mul(4)
      const blockNumber = await ethers.provider.getBlockNumber()

      const attestationData1 = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["address", "uint256", "uint256"],
          [qc.address, reserveAmount1, blockNumber]
        )
      )

      const attestationData2 = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["address", "uint256", "uint256"],
          [qc.address, reserveAmount2, blockNumber]
        )
      )

      // Submit conflicting attestations
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qc.address, reserveAmount1, attestationData1)

      await reserveOracle
        .connect(attester2)
        .submitAttestation(qc.address, reserveAmount2, attestationData2)

      // Third attester agrees with first
      await reserveOracle
        .connect(attester3)
        .submitAttestation(qc.address, reserveAmount1, attestationData1)

      // Should reach consensus on the majority opinion (reserveAmount1)
      const attestation = await reserveOracle.getAttestation(qc.address)
      expect(attestation.finalizedAmount).to.equal(reserveAmount1)
    })
  })

  describe("Oracle-AccountControl Integration", () => {
    beforeEach(async () => {
      await qcManager.connect(owner).registerQC(qc.address, QC_MINTING_CAP)

      // Set initial oracle backing to 5 BTC for integration tests
      const initialBacking = ONE_BTC_IN_SATOSHIS.mul(5) // 5 BTC
      await reserveOracle
        .connect(owner)
        .emergencySetReserve(qc.address, initialBacking)

      // Sync the backing to AccountControl
      await qcManager.connect(owner).syncBackingFromOracle(qc.address)
    })

    it("should automatically update AccountControl backing on consensus", async () => {
      const initialBacking = await accountControl.backing(qc.address)
      expect(initialBacking).to.equal(ONE_BTC_IN_SATOSHIS.mul(5))

      const newReserveAmount = ONE_BTC_IN_SATOSHIS.mul(7)
      const blockNumber = await ethers.provider.getBlockNumber()

      const attestationData = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["address", "uint256", "uint256"],
          [qc.address, newReserveAmount, blockNumber]
        )
      )

      // Achieve consensus
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qc.address, newReserveAmount, attestationData)
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qc.address, newReserveAmount, attestationData)

      const tx = await reserveOracle
        .connect(attester3)
        .submitAttestation(qc.address, newReserveAmount, attestationData)

      // Verify backing was automatically updated
      const updatedBacking = await accountControl.backing(qc.address)
      expect(updatedBacking).to.equal(newReserveAmount)

      await expect(tx)
        .to.emit(accountControl, "BackingUpdated")
        .withArgs(qc.address, initialBacking, newReserveAmount)
    })

    it("should respect minting constraints with oracle-updated backing", async () => {
      // Update backing through oracle to a lower amount
      const reducedBacking = ONE_BTC_IN_SATOSHIS.mul(2)
      const blockNumber = await ethers.provider.getBlockNumber()

      const attestationData = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["address", "uint256", "uint256"],
          [qc.address, reducedBacking, blockNumber]
        )
      )

      // Achieve consensus on reduced backing
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qc.address, reducedBacking, attestationData)
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qc.address, reducedBacking, attestationData)
      await reserveOracle
        .connect(attester3)
        .submitAttestation(qc.address, reducedBacking, attestationData)

      // Verify backing is reduced
      const backing = await accountControl.backing(qc.address)
      expect(backing).to.equal(reducedBacking)

      // Try to mint more than the reduced backing - should fail
      const excessiveMintAmount = reducedBacking.add(1) // Add 1 satoshi over backing

      // Test backing constraint using AccountControl directly
      // since it's simpler and focuses on the core oracle integration
      await expect(
        accountControl
          .connect(qc)
          .mintTBTC(user.address, excessiveMintAmount.mul(SATOSHI_MULTIPLIER))
      ).to.be.revertedWith("InsufficientBacking")
    })
  })

  describe("Attestation Timeout Scenarios", () => {
    beforeEach(async () => {
      await qcManager.connect(owner).registerQC(qc.address, QC_MINTING_CAP)
    })

    it("should handle attestation timeout properly", async () => {
      const reserveAmount = ONE_BTC_IN_SATOSHIS.mul(3)

      const attestationData = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["address", "uint256", "uint256"],
          [qc.address, reserveAmount, await ethers.provider.getBlockNumber()]
        )
      )

      // Submit one attestation
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qc.address, reserveAmount, attestationData)

      // Fast forward time beyond timeout (set to 1 hour in beforeEach)
      await ethers.provider.send("evm_increaseTime", [3700]) // 1 hour + 100 seconds
      await ethers.provider.send("evm_mine", [])

      // Try to submit another attestation - should succeed as expired attestations are cleaned up
      await expect(
        reserveOracle
          .connect(attester2)
          .submitAttestation(qc.address, reserveAmount, attestationData)
      ).to.emit(reserveOracle, "AttestationSubmitted")
    })

    it("should allow new attestation round after timeout", async () => {
      const reserveAmount1 = ONE_BTC_IN_SATOSHIS.mul(3)
      const reserveAmount2 = ONE_BTC_IN_SATOSHIS.mul(4)

      // First round - incomplete
      let attestationData = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["address", "uint256", "uint256"],
          [qc.address, reserveAmount1, await ethers.provider.getBlockNumber()]
        )
      )

      await reserveOracle
        .connect(attester1)
        .submitAttestation(qc.address, reserveAmount1, attestationData)

      // Fast forward beyond timeout
      await ethers.provider.send("evm_increaseTime", [3700])
      await ethers.provider.send("evm_mine", [])

      // Start new attestation round with different data
      attestationData = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["address", "uint256", "uint256"],
          [qc.address, reserveAmount2, await ethers.provider.getBlockNumber()]
        )
      )

      // Should be able to start fresh attestation round
      await expect(
        reserveOracle
          .connect(attester1)
          .submitAttestation(qc.address, reserveAmount2, attestationData)
      ).to.not.be.reverted

      // Complete the new round
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qc.address, reserveAmount2, attestationData)
      await reserveOracle
        .connect(attester3)
        .submitAttestation(qc.address, reserveAmount2, attestationData)

      // Verify consensus was reached on the new amount
      const attestation = await reserveOracle.getAttestation(qc.address)
      expect(attestation.finalizedAmount).to.equal(reserveAmount2)
    })
  })

  describe("Dispute and Arbitration", () => {
    beforeEach(async () => {
      await qcManager.connect(owner).registerQC(qc.address, QC_MINTING_CAP)
    })

    it("should allow dispute arbiter to override consensus", async () => {
      const reserveAmount = ONE_BTC_IN_SATOSHIS.mul(3)
      const correctAmount = ONE_BTC_IN_SATOSHIS.mul(6)
      const blockNumber = await ethers.provider.getBlockNumber()

      const attestationData = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["address", "uint256", "uint256"],
          [qc.address, reserveAmount, blockNumber]
        )
      )

      // Achieve consensus on incorrect amount
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qc.address, reserveAmount, attestationData)
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qc.address, reserveAmount, attestationData)
      await reserveOracle
        .connect(attester3)
        .submitAttestation(qc.address, reserveAmount, attestationData)

      // Verify wrong consensus was reached
      let attestation = await reserveOracle.getAttestation(qc.address)
      expect(attestation.finalizedAmount).to.equal(reserveAmount)

      // Dispute arbiter overrides with correct amount
      const DISPUTE_ARBITER_ROLE = await reserveOracle.DISPUTE_ARBITER_ROLE()

      const tx = await reserveOracle
        .connect(owner)
        .overrideAttestation(
          qc.address,
          correctAmount,
          "Incorrect consensus - manual verification shows higher reserve"
        )

      await expect(tx)
        .to.emit(reserveOracle, "AttestationOverridden")
        .withArgs(qc.address, reserveAmount, correctAmount)

      // Verify override took effect
      attestation = await reserveOracle.getAttestation(qc.address)
      expect(attestation.finalizedAmount).to.equal(correctAmount)

      // Verify AccountControl was updated
      const backing = await accountControl.backing(qc.address)
      expect(backing).to.equal(correctAmount)
    })
  })
})
