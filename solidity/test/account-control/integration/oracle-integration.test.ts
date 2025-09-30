import { expect } from "chai"
import { ethers, upgrades } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { deployQCManagerLib, getQCManagerLibraries } from "../helpers/spv-helpers"

import {
  AccountControl,
  QCManager,
  ReserveOracle,
  QCData,
  SystemState
} from "../../../typechain"
import { setupSystemStateDefaults } from "../helpers"

/**
 * Oracle Integration Tests
 *
 * Tests ReserveOracle integration with AccountControl system,
 * including attester roles, consensus mechanisms, and oracle-based reserve validation.
 *
 * Consolidated from:
 * - AccountControlOracleIntegration.test.ts (complete oracle integration scenarios)
 */
describe("Oracle Integration Tests", function () {
  let accountControl: AccountControl
  let qcManager: QCManager
  let reserveOracle: ReserveOracle
  let qcData: QCData
  let systemState: SystemState
  let mockBank: any
  let pauseManager: any

  let owner: SignerWithAddress
  let emergencyCouncil: SignerWithAddress
  let qc: SignerWithAddress
  let attester1: SignerWithAddress
  let attester2: SignerWithAddress
  let attester3: SignerWithAddress
  let user: SignerWithAddress

  const ONE_BTC_IN_SATOSHIS = ethers.BigNumber.from("100000000") // 1e8
  const SATOSHI_MULTIPLIER = ethers.BigNumber.from("10000000000") // 1e10
  const ONE_TBTC = ONE_BTC_IN_SATOSHIS.mul(SATOSHI_MULTIPLIER) // 1e18

  const QC_MINTING_CAP = ONE_BTC_IN_SATOSHIS.mul(10) // 10 BTC cap

  beforeEach(async function () {
    [owner, emergencyCouncil, qc, attester1, attester2, attester3, user] = await ethers.getSigners()

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
    const ReserveOracleFactory = await ethers.getContractFactory("ReserveOracle")
    reserveOracle = await ReserveOracleFactory.deploy()

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
    const AccountControlFactory = await ethers.getContractFactory("AccountControl")
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [owner.address, emergencyCouncil.address, mockBank.address],
      { initializer: "initialize" }
    ) as AccountControl

    // Deploy QCManager libraries
    const { qcManagerLib, qcManagerPauseLib } = await deployQCManagerLib()

    // Deploy QCPauseManager with temporary addresses (circular dependency workaround for testing)
    const QCPauseManagerFactory = await ethers.getContractFactory("QCPauseManager")
    pauseManager = await QCPauseManagerFactory.deploy(
      qcData.address,        // _qcData
      owner.address,         // _qcManager (temporary - will be QCManager later)
      owner.address,         // _admin
      emergencyCouncil.address // _emergencyRole
    )
    await pauseManager.deployed()

    // Deploy QCManager with libraries
    const QCManagerFactory = await ethers.getContractFactory(
      "QCManager",
      getQCManagerLibraries({ qcManagerLib, qcManagerPauseLib })
    )
    qcManager = await QCManagerFactory.deploy(
      qcData.address,
      systemState.address,
      accountControl.address,
      pauseManager.address,
      reserveOracle.address
    )

    // Update QCPauseManager to point to actual QCManager
    await pauseManager.connect(owner).setQCManager(qcManager.address)

    // Setup default system state
    await setupSystemStateDefaults(systemState, owner)

    // Enable AccountControl mode
    await systemState.connect(owner).setAccountControlMode(true)

    // Authorize QCManager in AccountControl
    const ADMIN_ROLE = await accountControl.DEFAULT_ADMIN_ROLE()
    await accountControl.connect(owner).grantRole(ADMIN_ROLE, qcManager.address)
  })

  describe("Oracle Setup and Configuration", function () {
    it("should properly configure ReserveOracle with attesters", async function () {
      // Verify attester roles are granted
      const ATTESTER_ROLE = await reserveOracle.ATTESTER_ROLE()

      expect(await reserveOracle.hasRole(ATTESTER_ROLE, attester1.address)).to.be.true
      expect(await reserveOracle.hasRole(ATTESTER_ROLE, attester2.address)).to.be.true
      expect(await reserveOracle.hasRole(ATTESTER_ROLE, attester3.address)).to.be.true

      // Verify consensus threshold
      expect(await reserveOracle.consensusThreshold()).to.equal(3)

      // Verify attestation timeout
      expect(await reserveOracle.attestationTimeout()).to.equal(3600)
    })

    it("should handle attester role management", async function () {
      const newAttester = user
      const ATTESTER_ROLE = await reserveOracle.ATTESTER_ROLE()

      // Grant new attester role
      await reserveOracle.connect(owner).grantRole(ATTESTER_ROLE, newAttester.address)
      expect(await reserveOracle.hasRole(ATTESTER_ROLE, newAttester.address)).to.be.true

      // Revoke attester role
      await reserveOracle.connect(owner).revokeRole(ATTESTER_ROLE, newAttester.address)
      expect(await reserveOracle.hasRole(ATTESTER_ROLE, newAttester.address)).to.be.false
    })
  })

  describe("Reserve Attestation Workflows", function () {
    beforeEach(async function () {
      // Register QC first
      await qcManager.connect(owner).onboardQC(
        qc.address,
        ONE_BTC_IN_SATOSHIS.mul(5), // 5 BTC backing
        QC_MINTING_CAP
      )
    })

    it("should handle single attester reserve submission", async function () {
      const reserveAmount = ONE_BTC_IN_SATOSHIS.mul(3) // 3 BTC
      const attestationData = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["address", "uint256", "uint256"],
          [qc.address, reserveAmount, await ethers.provider.getBlockNumber()]
        )
      )

      // Submit attestation from first attester
      const tx = await reserveOracle.connect(attester1).submitAttestation(
        qc.address,
        reserveAmount,
        attestationData
      )

      await expect(tx).to.emit(reserveOracle, "AttestationSubmitted")
        .withArgs(attester1.address, qc.address, reserveAmount)

      // Verify attestation is recorded but not yet finalized (needs consensus)
      const attestation = await reserveOracle.getAttestation(qc.address)
      expect(attestation.pending).to.be.true
      expect(attestation.attestations).to.equal(1)
    })

    it("should achieve consensus with multiple attesters", async function () {
      const reserveAmount = ONE_BTC_IN_SATOSHIS.mul(4) // 4 BTC
      const blockNumber = await ethers.provider.getBlockNumber()
      const attestationData = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["address", "uint256", "uint256"],
          [qc.address, reserveAmount, blockNumber]
        )
      )

      // Submit attestations from all three attesters
      await reserveOracle.connect(attester1).submitAttestation(
        qc.address,
        reserveAmount,
        attestationData
      )

      await reserveOracle.connect(attester2).submitAttestation(
        qc.address,
        reserveAmount,
        attestationData
      )

      // Third attestation should trigger consensus
      const tx = await reserveOracle.connect(attester3).submitAttestation(
        qc.address,
        reserveAmount,
        attestationData
      )

      await expect(tx).to.emit(reserveOracle, "ConsensusReached")
        .withArgs(qc.address, reserveAmount)

      // Should also trigger backing update in AccountControl
      await expect(tx).to.emit(accountControl, "BackingUpdated")
        .withArgs(qc.address, ONE_BTC_IN_SATOSHIS.mul(5), reserveAmount)

      // Verify attestation is finalized
      const attestation = await reserveOracle.getAttestation(qc.address)
      expect(attestation.pending).to.be.false
      expect(attestation.finalizedAmount).to.equal(reserveAmount)

      // Verify AccountControl backing is updated
      const backing = await accountControl.backing(qc.address)
      expect(backing).to.equal(reserveAmount)
    })

    it("should handle conflicting attestations", async function () {
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
      await reserveOracle.connect(attester1).submitAttestation(
        qc.address,
        reserveAmount1,
        attestationData1
      )

      await reserveOracle.connect(attester2).submitAttestation(
        qc.address,
        reserveAmount2,
        attestationData2
      )

      // Third attester agrees with first
      await reserveOracle.connect(attester3).submitAttestation(
        qc.address,
        reserveAmount1,
        attestationData1
      )

      // Should reach consensus on the majority opinion (reserveAmount1)
      const attestation = await reserveOracle.getAttestation(qc.address)
      expect(attestation.finalizedAmount).to.equal(reserveAmount1)
    })
  })

  describe("Oracle-AccountControl Integration", function () {
    beforeEach(async function () {
      await qcManager.connect(owner).onboardQC(
        qc.address,
        ONE_BTC_IN_SATOSHIS.mul(5),
        QC_MINTING_CAP
      )
    })

    it("should automatically update AccountControl backing on consensus", async function () {
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
      await reserveOracle.connect(attester1).submitAttestation(
        qc.address,
        newReserveAmount,
        attestationData
      )
      await reserveOracle.connect(attester2).submitAttestation(
        qc.address,
        newReserveAmount,
        attestationData
      )
      const tx = await reserveOracle.connect(attester3).submitAttestation(
        qc.address,
        newReserveAmount,
        attestationData
      )

      // Verify backing was automatically updated
      const updatedBacking = await accountControl.backing(qc.address)
      expect(updatedBacking).to.equal(newReserveAmount)

      await expect(tx).to.emit(accountControl, "BackingUpdated")
        .withArgs(qc.address, initialBacking, newReserveAmount)
    })

    it("should respect minting constraints with oracle-updated backing", async function () {
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
      await reserveOracle.connect(attester1).submitAttestation(
        qc.address,
        reducedBacking,
        attestationData
      )
      await reserveOracle.connect(attester2).submitAttestation(
        qc.address,
        reducedBacking,
        attestationData
      )
      await reserveOracle.connect(attester3).submitAttestation(
        qc.address,
        reducedBacking,
        attestationData
      )

      // Verify backing is reduced
      const backing = await accountControl.backing(qc.address)
      expect(backing).to.equal(reducedBacking)

      // Try to mint more than the reduced backing - should fail
      const excessiveMintAmount = reducedBacking.add(ONE_BTC_IN_SATOSHIS)

      // Deploy QCMinter for testing
      const QCMinterFactory = await ethers.getContractFactory("QCMinter")
      const qcMinter = await QCMinterFactory.deploy(accountControl.address, systemState.address)

      await expect(
        qcMinter.connect(owner).requestQCMint(
          qc.address,
          user.address,
          excessiveMintAmount
        )
      ).to.be.revertedWith("Insufficient backing")
    })
  })

  describe("Attestation Timeout Scenarios", function () {
    beforeEach(async function () {
      await qcManager.connect(owner).onboardQC(
        qc.address,
        ONE_BTC_IN_SATOSHIS.mul(5),
        QC_MINTING_CAP
      )
    })

    it("should handle attestation timeout properly", async function () {
      const reserveAmount = ONE_BTC_IN_SATOSHIS.mul(3)
      const attestationData = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["address", "uint256", "uint256"],
          [qc.address, reserveAmount, await ethers.provider.getBlockNumber()]
        )
      )

      // Submit one attestation
      await reserveOracle.connect(attester1).submitAttestation(
        qc.address,
        reserveAmount,
        attestationData
      )

      // Fast forward time beyond timeout
      await ethers.provider.send("evm_increaseTime", [3700]) // 1 hour + 100 seconds
      await ethers.provider.send("evm_mine", [])

      // Try to submit another attestation - should be rejected due to timeout
      await expect(
        reserveOracle.connect(attester2).submitAttestation(
          qc.address,
          reserveAmount,
          attestationData
        )
      ).to.be.revertedWith("Attestation timeout exceeded")
    })

    it("should allow new attestation round after timeout", async function () {
      const reserveAmount1 = ONE_BTC_IN_SATOSHIS.mul(3)
      const reserveAmount2 = ONE_BTC_IN_SATOSHIS.mul(4)

      // First round - incomplete
      let attestationData = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["address", "uint256", "uint256"],
          [qc.address, reserveAmount1, await ethers.provider.getBlockNumber()]
        )
      )

      await reserveOracle.connect(attester1).submitAttestation(
        qc.address,
        reserveAmount1,
        attestationData
      )

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
        reserveOracle.connect(attester1).submitAttestation(
          qc.address,
          reserveAmount2,
          attestationData
        )
      ).to.not.be.reverted

      // Complete the new round
      await reserveOracle.connect(attester2).submitAttestation(
        qc.address,
        reserveAmount2,
        attestationData
      )
      await reserveOracle.connect(attester3).submitAttestation(
        qc.address,
        reserveAmount2,
        attestationData
      )

      // Verify consensus was reached on the new amount
      const attestation = await reserveOracle.getAttestation(qc.address)
      expect(attestation.finalizedAmount).to.equal(reserveAmount2)
    })
  })

  describe("Dispute and Arbitration", function () {
    beforeEach(async function () {
      await qcManager.connect(owner).onboardQC(
        qc.address,
        ONE_BTC_IN_SATOSHIS.mul(5),
        QC_MINTING_CAP
      )
    })

    it("should allow dispute arbiter to override consensus", async function () {
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
      await reserveOracle.connect(attester1).submitAttestation(
        qc.address,
        reserveAmount,
        attestationData
      )
      await reserveOracle.connect(attester2).submitAttestation(
        qc.address,
        reserveAmount,
        attestationData
      )
      await reserveOracle.connect(attester3).submitAttestation(
        qc.address,
        reserveAmount,
        attestationData
      )

      // Verify wrong consensus was reached
      let attestation = await reserveOracle.getAttestation(qc.address)
      expect(attestation.finalizedAmount).to.equal(reserveAmount)

      // Dispute arbiter overrides with correct amount
      const DISPUTE_ARBITER_ROLE = await reserveOracle.DISPUTE_ARBITER_ROLE()
      const tx = await reserveOracle.connect(owner).overrideAttestation(
        qc.address,
        correctAmount,
        "Incorrect consensus - manual verification shows higher reserve"
      )

      await expect(tx).to.emit(reserveOracle, "AttestationOverridden")
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