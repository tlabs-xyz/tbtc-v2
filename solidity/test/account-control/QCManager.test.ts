import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import {
  deployQCManagerFixture,
  setupTestQC,
  TEST_CONSTANTS,
} from "./fixtures/AccountControlFixtures"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCManager", () => {
  describe("Deployment", () => {
    it("should set correct dependencies", async () => {
      const { qcManager } = await loadFixture(deployQCManagerFixture)
      expect(qcManager.address).to.not.equal(ethers.constants.AddressZero)
    })

    it("should grant deployer admin role", async () => {
      const { qcManager, deployer, constants } = await loadFixture(deployQCManagerFixture)
      expect(await qcManager.hasRole(constants.ROLES.DEFAULT_ADMIN, deployer.address)).to.be.true
    })

    it("should have correct role constants", async () => {
      const { qcManager, constants } = await loadFixture(deployQCManagerFixture)
      expect(await qcManager.GOVERNANCE_ROLE()).to.equal(constants.ROLES.GOVERNANCE)
      expect(await qcManager.REGISTRAR_ROLE()).to.equal(constants.ROLES.REGISTRAR)
      expect(await qcManager.DISPUTE_ARBITER_ROLE()).to.equal(constants.ROLES.DISPUTE_ARBITER)
      expect(await qcManager.ENFORCEMENT_ROLE()).to.equal(constants.ROLES.ENFORCEMENT)
      expect(await qcManager.MONITOR_ROLE()).to.equal(constants.ROLES.MONITOR)
      expect(await qcManager.EMERGENCY_ROLE()).to.equal(constants.ROLES.EMERGENCY)
    })
  })

  describe("QC Registration", () => {
    it("should register QC successfully when called by governance", async () => {
      const fixture = await loadFixture(deployQCManagerFixture)
      const { qcManager, governance, qcAddress, constants } = fixture

      const tx = await qcManager
        .connect(governance)
        .registerQC(qcAddress.address, constants.MEDIUM_CAP)

      await expect(tx)
        .to.emit(qcManager, "QCRegistrationInitiated")
        .withArgs(qcAddress.address, constants.MEDIUM_CAP)

      // Verify QC was registered in QCData
      const qcInfo = await fixture.qcData.getQC(qcAddress.address)
      expect(qcInfo.isRegistered).to.be.true
      expect(qcInfo.maxMintingCap).to.equal(constants.MEDIUM_CAP)
    })

    it("should prevent duplicate QC registration", async () => {
      const fixture = await loadFixture(deployQCManagerFixture)
      const { qcManager, governance, qcAddress, constants } = fixture

      // Register QC first time
      await qcManager.connect(governance).registerQC(qcAddress.address, constants.MEDIUM_CAP)

      // Try to register again
      await expect(
        qcManager.connect(governance).registerQC(qcAddress.address, constants.LARGE_CAP)
      ).to.be.revertedWithCustomError(qcManager, "QCAlreadyRegistered")
        .withArgs(qcAddress.address)
    })

    it("should prevent registration with invalid parameters", async () => {
      const { qcManager, governance, constants } = await loadFixture(deployQCManagerFixture)

      // Zero address
      await expect(
        qcManager.connect(governance).registerQC(ethers.constants.AddressZero, constants.MEDIUM_CAP)
      ).to.be.revertedWith("InvalidQCAddress")

      // Zero capacity
      const validAddress = ethers.Wallet.createRandom().address
      await expect(
        qcManager.connect(governance).registerQC(validAddress, 0)
      ).to.be.revertedWith("InvalidMintingCapacity")
    })

    it("should enforce governance role for registration", async () => {
      const { qcManager, user, qcAddress, constants } = await loadFixture(deployQCManagerFixture)

      await expect(
        qcManager.connect(user).registerQC(qcAddress.address, constants.MEDIUM_CAP)
      ).to.be.revertedWith(/AccessControl: account .* is missing role/)
    })
  })

  describe("Minting Capacity Management", () => {
    it("should increase minting capacity for registered QC", async () => {
      const fixture = await loadFixture(deployQCManagerFixture)
      const { qcManager, governance, constants } = fixture

      // Setup QC with initial capacity
      const qc = await setupTestQC(fixture, { mintingCap: constants.MEDIUM_CAP })

      // Increase capacity
      const newCapacity = constants.LARGE_CAP
      const tx = await qcManager
        .connect(governance)
        .increaseMintingCapacity(qc.address, newCapacity)

      await expect(tx)
        .to.emit(qcManager, "MintingCapIncreased")
        .withArgs(qc.address, constants.MEDIUM_CAP, newCapacity)

      // Verify new capacity
      const qcInfo = await fixture.qcData.getQC(qc.address)
      expect(qcInfo.maxMintingCap).to.equal(newCapacity)
    })

    it("should prevent decreasing minting capacity", async () => {
      const fixture = await loadFixture(deployQCManagerFixture)
      const { qcManager, governance, constants } = fixture

      // Setup QC with initial capacity
      const qc = await setupTestQC(fixture, { mintingCap: constants.LARGE_CAP })

      // Try to decrease capacity
      await expect(
        qcManager.connect(governance).increaseMintingCapacity(qc.address, constants.MEDIUM_CAP)
      ).to.be.revertedWithCustomError(qcManager, "NewCapMustBeHigher")
        .withArgs(constants.LARGE_CAP, constants.MEDIUM_CAP)
    })

    it("should prevent capacity increase for unregistered QC", async () => {
      const { qcManager, governance, constants } = await loadFixture(deployQCManagerFixture)
      const unregisteredQC = ethers.Wallet.createRandom().address

      await expect(
        qcManager.connect(governance).increaseMintingCapacity(unregisteredQC, constants.LARGE_CAP)
      ).to.be.revertedWithCustomError(qcManager, "QCNotRegistered")
        .withArgs(unregisteredQC)
    })
  })

  describe("QC Status Management", () => {
    it("should update QC status through valid transitions", async () => {
      const fixture = await loadFixture(deployQCManagerFixture)
      const { qcManager, governance } = fixture

      // Register QC (starts in REGISTERED status = 0)
      const qc = await setupTestQC(fixture)

      // Transition to ACTIVE (1)
      await expect(
        qcManager.connect(governance).updateQCStatus(qc.address, 1)
      ).to.emit(qcManager, "QCStatusUpdated")
        .withArgs(qc.address, 0, 1)

      // Transition to PAUSED (2)
      await expect(
        qcManager.connect(governance).updateQCStatus(qc.address, 2)
      ).to.emit(qcManager, "QCStatusUpdated")
        .withArgs(qc.address, 1, 2)

      // Can transition back to ACTIVE
      await expect(
        qcManager.connect(governance).updateQCStatus(qc.address, 1)
      ).to.emit(qcManager, "QCStatusUpdated")
        .withArgs(qc.address, 2, 1)
    })

    it("should prevent invalid status transitions", async () => {
      const fixture = await loadFixture(deployQCManagerFixture)
      const { qcManager, governance } = fixture

      // Register QC (starts in REGISTERED status = 0)
      const qc = await setupTestQC(fixture)

      // Cannot jump directly to REMOVED (3)
      await expect(
        qcManager.connect(governance).updateQCStatus(qc.address, 3)
      ).to.be.revertedWithCustomError(qcManager, "InvalidStatusTransition")
        .withArgs(0, 3)
    })
  })

  describe("Wallet Registration", () => {
    it("should validate Bitcoin address format", async () => {
      const fixture = await loadFixture(deployQCManagerFixture)
      const { qcManager, registrar, constants } = fixture

      // Setup active QC
      const qc = await setupTestQC(fixture, { activate: true })

      const challenge = ethers.utils.id("test_challenge")
      const mockWalletPublicKey = `0x${"aa".repeat(64)}`
      const mockSignature = {
        v: 27,
        r: ethers.utils.formatBytes32String("mock_r"),
        s: ethers.utils.formatBytes32String("mock_s"),
      }

      // Should reject invalid Bitcoin address format
      await expect(
        qcManager.connect(registrar).registerWallet(
          qc.address,
          "invalid_bitcoin_address",
          challenge,
          mockWalletPublicKey,
          mockSignature.v,
          mockSignature.r,
          mockSignature.s
        )
      ).to.be.revertedWith("InvalidWalletAddress")

      // Should reject empty address
      await expect(
        qcManager.connect(registrar).registerWallet(
          qc.address,
          "",
          challenge,
          mockWalletPublicKey,
          mockSignature.v,
          mockSignature.r,
          mockSignature.s
        )
      ).to.be.revertedWith("InvalidWalletAddress")

      // Should reject malformed address with invalid prefix
      await expect(
        qcManager.connect(registrar).registerWallet(
          qc.address,
          "4InvalidBitcoinAddressFormat",
          challenge,
          mockWalletPublicKey,
          mockSignature.v,
          mockSignature.r,
          mockSignature.s
        )
      ).to.be.revertedWith("InvalidWalletAddress")
    })

    it("should enforce registrar role for wallet registration", async () => {
      const fixture = await loadFixture(deployQCManagerFixture)
      const { qcManager, user, constants } = fixture

      const qc = await setupTestQC(fixture, { activate: true })

      const challenge = ethers.utils.id("test_challenge")
      const mockWalletPublicKey = `0x${"aa".repeat(64)}`

      await expect(
        qcManager.connect(user).registerWallet(
          qc.address,
          constants.VALID_LEGACY_BTC,
          challenge,
          mockWalletPublicKey,
          27,
          ethers.utils.formatBytes32String("r"),
          ethers.utils.formatBytes32String("s")
        )
      ).to.be.revertedWith(/AccessControl: account .* is missing role/)
    })
  })

  describe("Wallet Ownership Verification", () => {
    it("should generate challenge for registered QC", async () => {
      const fixture = await loadFixture(deployQCManagerFixture)
      const { qcManager, qcAddress, constants } = fixture

      // Register the QC first
      await setupTestQC(fixture)

      const nonce = 12345
      const tx = await qcManager
        .connect(qcAddress)
        .requestWalletOwnershipVerification(constants.VALID_LEGACY_BTC, nonce)

      await expect(tx).to.emit(qcManager, "WalletOwnershipVerificationRequested")

      // Verify challenge is generated
      const challenge = await qcManager
        .connect(qcAddress)
        .callStatic.requestWalletOwnershipVerification(constants.VALID_LEGACY_BTC, nonce)

      expect(challenge).to.not.equal(ethers.constants.HashZero)
    })

    it("should validate wallet address in verification request", async () => {
      const fixture = await loadFixture(deployQCManagerFixture)
      const { qcManager, qcAddress } = fixture

      await setupTestQC(fixture)

      await expect(
        qcManager.connect(qcAddress).requestWalletOwnershipVerification("", 12345)
      ).to.be.revertedWith("InvalidWalletAddress")
    })

    it("should prevent registrar from requesting verification", async () => {
      const { qcManager, registrar, constants } = await loadFixture(deployQCManagerFixture)

      await expect(
        qcManager.connect(registrar).requestWalletOwnershipVerification(
          constants.VALID_LEGACY_BTC,
          12345
        )
      ).to.be.revertedWith("REGISTRAR_MUST_USE_REGISTER_WALLET")
    })
  })

  describe("Emergency Actions", () => {
    it("should allow dispute arbiter to freeze QC operations", async () => {
      const fixture = await loadFixture(deployQCManagerFixture)
      const { qcManager, arbiter } = fixture

      // Setup active QC
      const qc = await setupTestQC(fixture, { activate: true })

      // Arbiter can pause the QC
      await expect(
        qcManager.connect(arbiter).updateQCStatus(qc.address, 2) // PAUSED
      ).to.emit(qcManager, "QCStatusUpdated")
        .withArgs(qc.address, 1, 2) // From ACTIVE to PAUSED
    })

    it("should restrict critical operations to proper roles", async () => {
      const fixture = await loadFixture(deployQCManagerFixture)
      const { qcManager, user } = fixture

      const qc = await setupTestQC(fixture)

      // Regular users cannot change QC status
      await expect(
        qcManager.connect(user).updateQCStatus(qc.address, 1)
      ).to.be.reverted
    })
  })
})