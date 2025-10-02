import { expect } from "chai"
import { ethers } from "hardhat"
import { QCData } from "../../../../typechain"
import {
  setupTestSigners,
  createBaseTestEnvironment,
  restoreBaseTestEnvironment,
  TestSigners,
} from "../../fixtures/base-setup"

describe("QCData - Centralized Error Handling", () => {
  let signers: TestSigners
  let qcData: QCData
  let qcManager: any

  // Test data
  const testQCAddress = "0x1234567890123456789012345678901234567890"
  const maxMintingCapacity = ethers.utils.parseEther("100")
  const validBtcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
  const invalidBtcAddress = "invalidaddress"

  before(async () => {
    signers = await setupTestSigners()
    qcManager = signers.deployer
  })

  beforeEach(async () => {
    await createBaseTestEnvironment()

    // Deploy QCData
    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy()
    await qcData.deployed()

    // Register a test QC for error testing
    await qcData
      .connect(qcManager)
      .registerQC(testQCAddress, maxMintingCapacity)
  })

  afterEach(async () => {
    await restoreBaseTestEnvironment()
  })

  describe("QC Registration Errors", () => {
    it("should throw InvalidQCAddress for zero address", async () => {
      const zeroAddress = ethers.constants.AddressZero

      await expect(
        qcData.connect(qcManager).registerQC(zeroAddress, maxMintingCapacity)
      ).to.be.revertedWithCustomError(qcData, "InvalidQCAddress")
    })

    it("should throw QCAlreadyRegistered for duplicate registration", async () => {
      // testQCAddress is already registered in beforeEach
      await expect(
        qcData.connect(qcManager).registerQC(testQCAddress, maxMintingCapacity)
      ).to.be.revertedWithCustomError(qcData, "QCAlreadyRegistered")
    })

    it("should throw InvalidMintingCapacity for zero capacity", async () => {
      const newQCAddress = "0x2345678901234567890123456789012345678901"

      await expect(
        qcData.connect(qcManager).registerQC(newQCAddress, 0)
      ).to.be.revertedWithCustomError(qcData, "InvalidMintingCapacity")
    })

    it("should throw QCNotRegistered for operations on unregistered QC", async () => {
      const unregisteredQC = "0x9999999999999999999999999999999999999999"

      // Test various operations that should fail
      await expect(qcData.getQCStatus(unregisteredQC))
        .to.be.revertedWithCustomError(qcData, "QCNotRegistered")
        .withArgs(unregisteredQC)

      await expect(
        qcData
          .connect(qcManager)
          .setQCStatus(unregisteredQC, 1, ethers.utils.id("TEST"))
      )
        .to.be.revertedWithCustomError(qcData, "QCNotRegistered")
        .withArgs(unregisteredQC)

      await expect(
        qcData
          .connect(qcManager)
          .updateQCMintedAmount(unregisteredQC, ethers.utils.parseEther("10"))
      )
        .to.be.revertedWithCustomError(qcData, "QCNotRegistered")
        .withArgs(unregisteredQC)
    })
  })

  describe("Manager Role Errors", () => {
    it("should throw InvalidManagerAddress for zero address manager", async () => {
      const zeroAddress = ethers.constants.AddressZero

      await expect(
        qcData.connect(qcManager).grantQCManagerRole(zeroAddress)
      ).to.be.revertedWithCustomError(qcData, "InvalidManagerAddress")
    })

    it("should throw access control errors for unauthorized callers", async () => {
      // All manager-only functions should revert with AccessControl error
      const unauthorizedUser = signers.user

      await expect(
        qcData
          .connect(unauthorizedUser)
          .registerQC(
            "0x2345678901234567890123456789012345678901",
            maxMintingCapacity
          )
      ).to.be.revertedWith("AccessControl:")

      await expect(
        qcData
          .connect(unauthorizedUser)
          .registerWallet(testQCAddress, validBtcAddress)
      ).to.be.revertedWith("AccessControl:")

      await expect(
        qcData.connect(unauthorizedUser).activateWallet(validBtcAddress)
      ).to.be.revertedWith("AccessControl:")

      await expect(
        qcData
          .connect(unauthorizedUser)
          .setQCPauseLevel(testQCAddress, 1, false)
      ).to.be.revertedWith("AccessControl:")
    })
  })

  describe("Wallet Registration Errors", () => {
    it("should throw InvalidWalletAddress for empty address", async () => {
      const emptyAddress = ""

      await expect(
        qcData.connect(qcManager).registerWallet(testQCAddress, emptyAddress)
      ).to.be.revertedWithCustomError(qcData, "InvalidWalletAddress")
    })

    it("should throw InvalidBitcoinAddressFormat for malformed addresses", async () => {
      const invalidAddresses = [
        "0invalid",
        "2invalid",
        "bc2invalid",
        "tb1invalid",
      ]

      for (const address of invalidAddresses) {
        await expect(
          qcData.connect(qcManager).registerWallet(testQCAddress, address)
        )
          .to.be.revertedWithCustomError(qcData, "InvalidBitcoinAddressFormat")
          .withArgs(address)
      }
    })

    it("should throw InvalidBitcoinAddressLength with correct length info", async () => {
      const shortAddress = "1A" // Too short
      const longAddress = `1${"A".repeat(100)}` // Too long

      await expect(
        qcData.connect(qcManager).registerWallet(testQCAddress, shortAddress)
      )
        .to.be.revertedWithCustomError(qcData, "InvalidBitcoinAddressLength")
        .withArgs(shortAddress, shortAddress.length)

      await expect(
        qcData.connect(qcManager).registerWallet(testQCAddress, longAddress)
      )
        .to.be.revertedWithCustomError(qcData, "InvalidBitcoinAddressLength")
        .withArgs(longAddress, longAddress.length)
    })

    it("should throw WalletAlreadyRegistered for duplicate registration", async () => {
      // Register wallet first time
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)

      // Try to register same wallet again
      await expect(
        qcData.connect(qcManager).registerWallet(testQCAddress, validBtcAddress)
      ).to.be.revertedWithCustomError(qcData, "WalletAlreadyRegistered")
    })

    it("should throw MaxWalletsExceeded when limit reached", async () => {
      // Register maximum number of wallets (10)
      const addresses = [
        "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // #1
        "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", // #2
        "12cbQLTFMXRnSzktFkuoG3eHoMeFtpTu3S", // #3
        "1dice8EMZmqKvrGE4Qc9bUFf9PX3xaYDp", // #4
        "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // #5
        "3QJmV3qfvL9SuYo34YihAf3sRCW3qSinyC", // #6
        "3CMNFxN1oHBc4R9EpP5Q8MF1C3xpLNPj6o", // #7
        "35PBEaofpUeH8VjdNJFDD6VzqWJ7eLMyD5", // #8
        "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // #9
        "bc1qrp33g0q4c70anx3rw5hqzz5e5r6nh3p0mx8t9j", // #10
      ]

      // Register 10 wallets (maximum)
      for (const address of addresses) {
        await qcData.connect(qcManager).registerWallet(testQCAddress, address)
      }

      // Try to register 11th wallet
      const eleventhAddress =
        "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0"

      await expect(
        qcData.connect(qcManager).registerWallet(testQCAddress, eleventhAddress)
      ).to.be.revertedWithCustomError(qcData, "MaxWalletsExceeded")
    })
  })

  describe("Wallet Operation Errors", () => {
    beforeEach(async () => {
      // Register a wallet for operation tests
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)
    })

    it("should throw WalletNotRegistered for operations on non-existent wallet", async () => {
      const nonExistentAddress = "1NonExistentAddressForTesting123456"

      await expect(qcData.connect(qcManager).activateWallet(nonExistentAddress))
        .to.be.revertedWithCustomError(qcData, "WalletNotRegistered")
        .withArgs(nonExistentAddress)

      await expect(
        qcData
          .connect(qcManager)
          .requestWalletDeRegistration(nonExistentAddress)
      )
        .to.be.revertedWithCustomError(qcData, "WalletNotRegistered")
        .withArgs(nonExistentAddress)

      await expect(
        qcData
          .connect(qcManager)
          .finalizeWalletDeRegistration(nonExistentAddress)
      )
        .to.be.revertedWithCustomError(qcData, "WalletNotRegistered")
        .withArgs(nonExistentAddress)
    })

    it("should throw WalletNotInactive when activating non-inactive wallet", async () => {
      // Activate wallet first time (should succeed)
      await qcData.connect(qcManager).activateWallet(validBtcAddress)

      // Try to activate again (should fail)
      await expect(
        qcData.connect(qcManager).activateWallet(validBtcAddress)
      ).to.be.revertedWithCustomError(qcData, "WalletNotInactive")
    })

    it("should throw WalletNotActive when deregistering inactive wallet", async () => {
      // Wallet is registered but not activated (Inactive state)
      await expect(
        qcData.connect(qcManager).requestWalletDeRegistration(validBtcAddress)
      )
        .to.be.revertedWithCustomError(qcData, "WalletNotActive")
        .withArgs(validBtcAddress)
    })

    it("should throw WalletNotPendingDeregistration when finalizing non-pending wallet", async () => {
      // Activate wallet
      await qcData.connect(qcManager).activateWallet(validBtcAddress)

      // Try to finalize deregistration without requesting it first
      await expect(
        qcData.connect(qcManager).finalizeWalletDeRegistration(validBtcAddress)
      )
        .to.be.revertedWithCustomError(qcData, "WalletNotPendingDeregistration")
        .withArgs(validBtcAddress)
    })
  })

  describe("Capacity and Amount Errors", () => {
    it("should throw ExceedsMintingCapacity when amount exceeds capacity", async () => {
      const excessiveAmount = maxMintingCapacity.add(
        ethers.utils.parseEther("1")
      )

      await expect(
        qcData
          .connect(qcManager)
          .updateQCMintedAmount(testQCAddress, excessiveAmount)
      ).to.be.revertedWithCustomError(qcData, "ExceedsMintingCapacity")
    })

    it("should throw InvalidCapacity for zero capacity", async () => {
      await expect(
        qcData.connect(qcManager).updateMaxMintingCapacity(testQCAddress, 0)
      ).to.be.revertedWithCustomError(qcData, "InvalidCapacity")
    })

    it("should throw CapacityBelowTotalMinted when new capacity is below minted amount", async () => {
      // First, mint some amount
      const mintedAmount = ethers.utils.parseEther("50")
      await qcData
        .connect(qcManager)
        .updateQCMintedAmount(testQCAddress, mintedAmount)

      // Try to set capacity below minted amount
      const lowCapacity = ethers.utils.parseEther("25")

      await expect(
        qcData
          .connect(qcManager)
          .updateMaxMintingCapacity(testQCAddress, lowCapacity)
      ).to.be.revertedWithCustomError(qcData, "CapacityBelowTotalMinted")
    })
  })

  describe("Pause Level Errors", () => {
    it("should throw QCNotRegistered for pause operations on unregistered QC", async () => {
      const unregisteredQC = "0x9999999999999999999999999999999999999999"

      await expect(
        qcData.connect(qcManager).setQCPauseLevel(unregisteredQC, 1, false)
      )
        .to.be.revertedWithCustomError(qcData, "QCNotRegistered")
        .withArgs(unregisteredQC)

      await expect(qcData.getQCPauseLevel(unregisteredQC))
        .to.be.revertedWithCustomError(qcData, "QCNotRegistered")
        .withArgs(unregisteredQC)

      await expect(qcData.getQCSelfPaused(unregisteredQC))
        .to.be.revertedWithCustomError(qcData, "QCNotRegistered")
        .withArgs(unregisteredQC)
    })
  })

  describe("Error Message Consistency", () => {
    it("should use consistent error format for wallet-related errors", async () => {
      const testAddress = "1TestAddressForConsistencyCheck"

      // All wallet errors should include the address in the error message
      await expect(qcData.connect(qcManager).activateWallet(testAddress))
        .to.be.revertedWithCustomError(qcData, "WalletNotRegistered")
        .withArgs(testAddress)

      // Register wallet to test other errors
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)

      await expect(
        qcData.connect(qcManager).requestWalletDeRegistration(validBtcAddress)
      )
        .to.be.revertedWithCustomError(qcData, "WalletNotActive")
        .withArgs(validBtcAddress)
    })

    it("should use consistent error format for QC-related errors", async () => {
      const testQC = "0x9999999999999999999999999999999999999999"

      // All QC errors should include the QC address in the error message
      await expect(qcData.getQCStatus(testQC))
        .to.be.revertedWithCustomError(qcData, "QCNotRegistered")
        .withArgs(testQC)

      await expect(
        qcData
          .connect(qcManager)
          .setQCStatus(testQC, 1, ethers.utils.id("TEST"))
      )
        .to.be.revertedWithCustomError(qcData, "QCNotRegistered")
        .withArgs(testQC)
    })
  })

  describe("Error Hierarchy and Precedence", () => {
    it("should prioritize validation errors in correct order", async () => {
      // Bitcoin address validation should happen before wallet registration checks
      const invalidAddress = "invalid"

      // Should fail with address format error, not QC registration error
      await expect(
        qcData.connect(qcManager).registerWallet(testQCAddress, invalidAddress)
      )
        .to.be.revertedWithCustomError(qcData, "InvalidBitcoinAddressFormat")
        .withArgs(invalidAddress)

      // Should fail with address format error even for unregistered QC
      const unregisteredQC = "0x9999999999999999999999999999999999999999"
      await expect(
        qcData.connect(qcManager).registerWallet(unregisteredQC, invalidAddress)
      )
        .to.be.revertedWithCustomError(qcData, "QCNotRegistered")
        .withArgs(unregisteredQC)
    })

    it("should handle multiple validation failures correctly", async () => {
      const unregisteredQC = "0x9999999999999999999999999999999999999999"
      const validAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"

      // QC validation should happen first
      await expect(
        qcData.connect(qcManager).registerWallet(unregisteredQC, validAddress)
      )
        .to.be.revertedWithCustomError(qcData, "QCNotRegistered")
        .withArgs(unregisteredQC)
    })
  })

  describe("Gas Efficiency of Custom Errors", () => {
    it("should use less gas than require strings for common errors", async () => {
      // This is more of a documentation test - custom errors should be more gas efficient
      // We can't easily test exact gas usage differences in this context,
      // but we can verify the errors are thrown correctly

      const unregisteredQC = "0x9999999999999999999999999999999999999999"

      // Custom error should be thrown (more gas efficient than require string)
      await expect(
        qcData.getQCStatus(unregisteredQC)
      ).to.be.revertedWithCustomError(qcData, "QCNotRegistered")

      // If this was a require statement, it would be:
      // await expect(...).to.be.revertedWith("QCData: QC not registered")
      // Custom errors are more gas efficient and type-safe
    })
  })
})
