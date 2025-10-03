import { expect } from "chai"
import { ethers } from "hardhat"
import { QCData } from "../../../../typechain"
import {
  setupAccountControlTestSigners,
  createBaseTestEnvironment,
  restoreBaseTestEnvironment,
  AccountControlTestSigners,
} from "../../fixtures"

describe("QCData - Bitcoin Address Validation", () => {
  let signers: AccountControlTestSigners
  let qcData: QCData
  let qcManager: any

  // Test QC setup
  const testQCAddress = "0x1234567890123456789012345678901234567890"
  const maxMintingCapacity = ethers.utils.parseEther("100")

  // Valid Bitcoin address test vectors
  const validAddresses = {
    p2pkh: [
      "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Genesis block coinbase
      "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", // Random valid P2PKH
      "12cbQLTFMXRnSzktFkuoG3eHoMeFtpTu3S", // Another valid P2PKH
      "1dice8EMZmqKvrGE4Qc9bUFf9PX3xaYDp", // Dice address
    ],
    p2sh: [
      "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // Valid P2SH
      "3QJmV3qfvL9SuYo34YihAf3sRCW3qSinyC", // Another valid P2SH
      "3CMNFxN1oHBc4R9EpP5Q8MF1C3xpLNPj6o", // Valid P2SH
      "35PBEaofpUeH8VjdNJFDD6VzqWJ7eLMyD5", // Valid P2SH
    ],
    bech32: [
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Valid native segwit
      "bc1qrp33g0q4c70anx3rw5hqzz5e5r6nh3p0mx8t9j", // Valid native segwit
      "bc1q5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr", // Long Bech32
      "bc1qc7slrfxkknqcq2jevvvkdgvrt8080852dfjewde450xdlk4ugp7szw5tk9", // Another long Bech32
    ],
    taproot: [
      "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0", // Valid Taproot
      "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr", // Valid Taproot
      "bc1paar5c8jfx8nqylh5dcqq3jwm7nrqht96dhd6f8wnlwz0pshqmz8q2e6r4x", // Valid Taproot
    ],
  }

  // Invalid Bitcoin address test vectors
  const invalidAddresses = {
    invalidFormat: [
      "0A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Starts with 0
      "2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Starts with 2
      "4A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Starts with 4
      "bc2qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // bc2 instead of bc1
      "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7km34m8y", // testnet address (tb1)
      "ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty", // litecoin address
    ],
    invalidLength: [
      "", // Empty address
      "1", // Too short
      "1A", // Too short
      "1A1zP1eP5QGefi2DMPTfTL5SLmv", // Too short for P2PKH
      "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNaTooLong123456", // Too long for P2PKH
      "bc1qw508d6qejxtdg4y5r3zarvary0c5", // Too short for Bech32
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4toolongforvalidbech32address123456789", // Too long
      "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj", // Taproot too short
      "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0extra", // Taproot too long
    ],
    invalidCharacters: [
      "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNO", // Contains 'O' (forbidden in Base58)
      "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNI", // Contains 'I' (forbidden in Base58)
      "1A1zP1eP5QGefi2DMPTfTL5SLmv7Divfnl", // Contains 'l' (forbidden in Base58)
      "1A1zP1eP5QGefi2DMPTfTL5SLmv7Divfn0", // Contains '0' (forbidden in Base58)
      "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLO", // P2SH with forbidden 'O'
      "bc1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4", // Bech32 with uppercase (should be lowercase)
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3T4", // Mixed case in Bech32
    ],
  }

  before(async () => {
    signers = await setupAccountControlTestSigners()
    qcManager = signers.deployer
  })

  beforeEach(async () => {
    await createBaseTestEnvironment()

    // Deploy QCData
    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy()
    await qcData.deployed()

    // Register a test QC for wallet registration tests
    await qcData
      .connect(qcManager)
      .registerQC(testQCAddress, maxMintingCapacity)
  })

  afterEach(async () => {
    await restoreBaseTestEnvironment()
  })

  describe("Valid Bitcoin Address Validation", () => {
    describe("P2PKH Addresses (1...)", () => {
      validAddresses.p2pkh.forEach((address, index) => {
        it(`should accept valid P2PKH address #${
          index + 1
        }: ${address}`, async () => {
          await expect(
            qcData.connect(qcManager).registerWallet(testQCAddress, address)
          ).to.not.be.reverted

          // Verify wallet was registered
          expect(await qcData.isWalletRegistered(address)).to.be.true
        })
      })
    })

    describe("P2SH Addresses (3...)", () => {
      validAddresses.p2sh.forEach((address, index) => {
        it(`should accept valid P2SH address #${
          index + 1
        }: ${address}`, async () => {
          await expect(
            qcData.connect(qcManager).registerWallet(testQCAddress, address)
          ).to.not.be.reverted

          // Verify wallet was registered
          expect(await qcData.isWalletRegistered(address)).to.be.true
        })
      })
    })

    describe("Bech32 Addresses (bc1...)", () => {
      validAddresses.bech32.forEach((address, index) => {
        it(`should accept valid Bech32 address #${
          index + 1
        }: ${address}`, async () => {
          await expect(
            qcData.connect(qcManager).registerWallet(testQCAddress, address)
          ).to.not.be.reverted

          // Verify wallet was registered
          expect(await qcData.isWalletRegistered(address)).to.be.true
        })
      })
    })

    describe("Taproot Addresses (bc1p...)", () => {
      validAddresses.taproot.forEach((address, index) => {
        it(`should accept valid Taproot address #${
          index + 1
        }: ${address}`, async () => {
          await expect(
            qcData.connect(qcManager).registerWallet(testQCAddress, address)
          ).to.not.be.reverted

          // Verify wallet was registered
          expect(await qcData.isWalletRegistered(address)).to.be.true
        })
      })
    })
  })

  describe("Invalid Bitcoin Address Validation", () => {
    describe("Invalid Format Addresses", () => {
      invalidAddresses.invalidFormat.forEach((address, index) => {
        it(`should reject invalid format address #${
          index + 1
        }: ${address}`, async () => {
          await expect(
            qcData.connect(qcManager).registerWallet(testQCAddress, address)
          )
            .to.be.revertedWithCustomError(
              qcData,
              "InvalidBitcoinAddressFormat"
            )
            .withArgs(address)
        })
      })
    })

    describe("Invalid Length Addresses", () => {
      invalidAddresses.invalidLength.forEach((address, index) => {
        it(`should reject invalid length address #${
          index + 1
        }: "${address}"`, async () => {
          if (address === "") {
            // Empty address triggers InvalidWalletAddress
            await expect(
              qcData.connect(qcManager).registerWallet(testQCAddress, address)
            ).to.be.revertedWithCustomError(qcData, "InvalidWalletAddress")
          } else {
            await expect(
              qcData.connect(qcManager).registerWallet(testQCAddress, address)
            )
              .to.be.revertedWithCustomError(
                qcData,
                "InvalidBitcoinAddressLength"
              )
              .withArgs(address, address.length)
          }
        })
      })
    })

    describe("Invalid Character Addresses", () => {
      invalidAddresses.invalidCharacters.forEach((address, index) => {
        it(`should reject invalid characters address #${
          index + 1
        }: ${address}`, async () => {
          await expect(
            qcData.connect(qcManager).registerWallet(testQCAddress, address)
          )
            .to.be.revertedWithCustomError(
              qcData,
              "InvalidBitcoinAddressFormat"
            )
            .withArgs(address)
        })
      })
    })
  })

  describe("Edge Cases", () => {
    it("should reject address with exactly forbidden Base58 characters", async () => {
      const addressWithZero = "1A1zP1eP5QGefi2DMPTfTL5SLmv7Divfn0" // Contains '0'
      const addressWithO = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNO" // Contains 'O'
      const addressWithI = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNI" // Contains 'I'
      const addressWithL = "1A1zP1eP5QGefi2DMPTfTL5SLmv7Divfnl" // Contains 'l'

      await expect(
        qcData.connect(qcManager).registerWallet(testQCAddress, addressWithZero)
      ).to.be.revertedWithCustomError(qcData, "InvalidBitcoinAddressFormat")

      await expect(
        qcData.connect(qcManager).registerWallet(testQCAddress, addressWithO)
      ).to.be.revertedWithCustomError(qcData, "InvalidBitcoinAddressFormat")

      await expect(
        qcData.connect(qcManager).registerWallet(testQCAddress, addressWithI)
      ).to.be.revertedWithCustomError(qcData, "InvalidBitcoinAddressFormat")

      await expect(
        qcData.connect(qcManager).registerWallet(testQCAddress, addressWithL)
      ).to.be.revertedWithCustomError(qcData, "InvalidBitcoinAddressFormat")
    })

    it("should reject Bech32 with uppercase characters", async () => {
      const mixedCaseAddress = "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4"

      await expect(
        qcData
          .connect(qcManager)
          .registerWallet(testQCAddress, mixedCaseAddress)
      )
        .to.be.revertedWithCustomError(qcData, "InvalidBitcoinAddressFormat")
        .withArgs(mixedCaseAddress)
    })

    it("should validate address length boundaries precisely", async () => {
      // Test exact boundary conditions for different address types
      const tooShort = "1A" // 2 chars - way too short
      const tooLong = `1${"A".repeat(100)}` // Too long for any type

      await expect(
        qcData.connect(qcManager).registerWallet(testQCAddress, tooShort)
      )
        .to.be.revertedWithCustomError(qcData, "InvalidBitcoinAddressLength")
        .withArgs(tooShort, tooShort.length)

      await expect(
        qcData.connect(qcManager).registerWallet(testQCAddress, tooLong)
      )
        .to.be.revertedWithCustomError(qcData, "InvalidBitcoinAddressLength")
        .withArgs(tooLong, tooLong.length)
    })

    it("should handle extremely long invalid addresses", async () => {
      const veryLongAddress = `1${"A".repeat(200)}` // Much longer than any valid Bitcoin address

      await expect(
        qcData.connect(qcManager).registerWallet(testQCAddress, veryLongAddress)
      )
        .to.be.revertedWithCustomError(qcData, "InvalidBitcoinAddressLength")
        .withArgs(veryLongAddress, veryLongAddress.length)
    })
  })

  describe("Integration with Wallet Registration", () => {
    it("should integrate validation with complete wallet registration flow", async () => {
      const validAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"

      // Register wallet (should validate address)
      const tx = await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validAddress)

      // Check for event emission (without exact timestamp match)
      await expect(tx)
        .to.emit(qcData, "WalletRegistered")
        .withArgs(
          testQCAddress,
          validAddress,
          qcManager.address,
          await getLatestBlockTimestamp()
        )

      // Verify wallet is registered and has correct initial state
      expect(await qcData.isWalletRegistered(validAddress)).to.be.true
      expect(await qcData.getWalletStatus(validAddress)).to.equal(0) // WalletStatus.Inactive
      expect(await qcData.getWalletOwner(validAddress)).to.equal(testQCAddress)
    })

    it("should prevent registration of invalid address even with valid QC", async () => {
      const invalidAddress = "invalidaddress"

      // Verify QC is valid
      expect(await qcData.isQCRegistered(testQCAddress)).to.be.true

      // Should fail due to invalid address (length check happens first)
      await expect(
        qcData.connect(qcManager).registerWallet(testQCAddress, invalidAddress)
      )
        .to.be.revertedWithCustomError(qcData, "InvalidBitcoinAddressLength")
        .withArgs(invalidAddress, invalidAddress.length)

      // Verify wallet was not registered
      expect(await qcData.isWalletRegistered(invalidAddress)).to.be.false
    })
  })
})

// Helper function to get current block timestamp
async function getBlockTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest")
  return block.timestamp
}

// Helper function to get latest block timestamp (for use in event assertions)
async function getLatestBlockTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest")
  return block.timestamp
}
