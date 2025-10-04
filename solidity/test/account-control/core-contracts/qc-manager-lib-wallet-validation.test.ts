import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { QCManagerLib, QCData } from "../../../typechain"

describe("QCManagerLib - Wallet Registration Validation (External Functions)", () => {
  let qcManagerLib: QCManagerLib
  let qcData: QCData

  let owner: SignerWithAddress
  let qc1: SignerWithAddress
  let qc2: SignerWithAddress
  let unregisteredQC: SignerWithAddress

  // Test constants
  const STANDARD_CAP = ethers.utils.parseUnits("1000", 8)
  const VALID_BTC_ADDRESS = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
  const INVALID_BTC_ADDRESS = "invalid_address"

  // Sample signature components for testing
  const SAMPLE_CHALLENGE = ethers.utils.formatBytes32String("test_challenge")
  const SAMPLE_WALLET_PUBKEY = `0x${"04".repeat(32)}` // 64 bytes (32 repeated 0x04)

  const SAMPLE_SIGNATURE = {
    v: 27,
    r: ethers.utils.formatBytes32String("sample_r"),
    s: ethers.utils.formatBytes32String("sample_s"),
  }

  beforeEach(async () => {
    ;[owner, qc1, qc2, unregisteredQC] = await ethers.getSigners()

    // Deploy QCManagerLib for direct function testing
    const QCManagerLibFactory = await ethers.getContractFactory("QCManagerLib")
    qcManagerLib = await QCManagerLibFactory.deploy()

    // Deploy QCData for testing
    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy()

    // Register test QCs
    await qcData.registerQC(qc1.address, STANDARD_CAP)
    await qcData.registerQC(qc2.address, STANDARD_CAP)

    // Set QCs to active status (status 0)
    await qcData.setQCStatus(
      qc1.address,
      0,
      ethers.utils.formatBytes32String("active")
    )
    await qcData.setQCStatus(
      qc2.address,
      0,
      ethers.utils.formatBytes32String("active")
    )
  })

  describe("validateWalletRegistrationFull Function", () => {
    describe("Successful Validation Cases", () => {
      it("should validate successfully with all valid parameters", async () => {
        // This should not revert if all validation passes
        await expect(
          qcManagerLib.validateWalletRegistrationFull(
            qcData,
            qc1.address,
            VALID_BTC_ADDRESS,
            SAMPLE_CHALLENGE,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
        ).to.not.be.reverted
      })

      it("should validate with different valid Bitcoin address formats", async () => {
        const validAddresses = [
          "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // P2PKH
          "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // P2SH
          "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Bech32
        ]

        for (const address of validAddresses) {
          await expect(
            qcManagerLib.validateWalletRegistrationFull(
              qcData,
              qc1.address,
              address,
              SAMPLE_CHALLENGE,
              SAMPLE_WALLET_PUBKEY,
              SAMPLE_SIGNATURE.v,
              SAMPLE_SIGNATURE.r,
              SAMPLE_SIGNATURE.s
            )
          ).to.not.be.reverted
        }
      })
    })

    describe("Invalid Bitcoin Address Cases", () => {
      it("should revert with InvalidWalletAddress for empty address", async () => {
        await expect(
          qcManagerLib.validateWalletRegistrationFull(
            qcData,
            qc1.address,
            "", // Empty address
            SAMPLE_CHALLENGE,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
        ).to.be.revertedWithCustomError(qcManagerLib, "InvalidWalletAddress")
      })

      it("should revert with InvalidWalletAddress for malformed address", async () => {
        await expect(
          qcManagerLib.validateWalletRegistrationFull(
            qcData,
            qc1.address,
            INVALID_BTC_ADDRESS,
            SAMPLE_CHALLENGE,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
        ).to.be.revertedWithCustomError(qcManagerLib, "InvalidWalletAddress")
      })

      it("should revert with InvalidWalletAddress for Ethereum address", async () => {
        await expect(
          qcManagerLib.validateWalletRegistrationFull(
            qcData,
            qc1.address,
            "0x1234567890123456789012345678901234567890",
            SAMPLE_CHALLENGE,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
        ).to.be.revertedWithCustomError(qcManagerLib, "InvalidWalletAddress")
      })
    })

    describe("QC Registration and Status Validation", () => {
      it("should revert with QCNotRegistered for unregistered QC", async () => {
        await expect(
          qcManagerLib.validateWalletRegistrationFull(
            qcData,
            unregisteredQC.address, // Not registered
            VALID_BTC_ADDRESS,
            SAMPLE_CHALLENGE,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
        ).to.be.revertedWithCustomError(qcManagerLib, "QCNotRegistered")
      })

      it("should revert with QCNotActive for inactive QC", async () => {
        // Set QC to paused status
        await qcData.setQCStatus(
          qc2.address,
          1,
          ethers.utils.formatBytes32String("paused")
        )

        await expect(
          qcManagerLib.validateWalletRegistrationFull(
            qcData,
            qc2.address,
            VALID_BTC_ADDRESS,
            SAMPLE_CHALLENGE,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
        ).to.be.revertedWithCustomError(qcManagerLib, "QCNotActive")
      })

      it("should revert with QCNotActive for revoked QC", async () => {
        // Set QC to revoked status
        await qcData.setQCStatus(
          qc2.address,
          4,
          ethers.utils.formatBytes32String("revoked")
        )

        await expect(
          qcManagerLib.validateWalletRegistrationFull(
            qcData,
            qc2.address,
            VALID_BTC_ADDRESS,
            SAMPLE_CHALLENGE,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
        ).to.be.revertedWithCustomError(qcManagerLib, "QCNotActive")
      })
    })

    describe("Signature Validation", () => {
      it("should revert with SignatureVerificationFailed for invalid signature", async () => {
        await expect(
          qcManagerLib.validateWalletRegistrationFull(
            qcData,
            qc1.address,
            VALID_BTC_ADDRESS,
            SAMPLE_CHALLENGE,
            SAMPLE_WALLET_PUBKEY,
            0, // Invalid v
            ethers.constants.HashZero, // Invalid r
            ethers.constants.HashZero // Invalid s
          )
        ).to.be.revertedWithCustomError(
          qcManagerLib,
          "SignatureVerificationFailed"
        )
      })

      it("should revert with SignatureVerificationFailed for wrong public key length", async () => {
        const wrongLengthPubkey = `0x${"04".repeat(30)}` // 60 bytes instead of 64

        await expect(
          qcManagerLib.validateWalletRegistrationFull(
            qcData,
            qc1.address,
            VALID_BTC_ADDRESS,
            SAMPLE_CHALLENGE,
            wrongLengthPubkey,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
        ).to.be.revertedWithCustomError(
          qcManagerLib,
          "SignatureVerificationFailed"
        )
      })
    })

    describe("Edge Cases", () => {
      it("should handle different challenge values", async () => {
        const challenges = [
          ethers.utils.formatBytes32String("challenge1"),
          ethers.utils.formatBytes32String("challenge2"),
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("complex challenge")),
          ethers.constants.HashZero,
        ]

        for (const challenge of challenges) {
          await expect(
            qcManagerLib.validateWalletRegistrationFull(
              qcData,
              qc1.address,
              VALID_BTC_ADDRESS,
              challenge,
              SAMPLE_WALLET_PUBKEY,
              SAMPLE_SIGNATURE.v,
              SAMPLE_SIGNATURE.r,
              SAMPLE_SIGNATURE.s
            )
          ).to.not.be.reverted
        }
      })

      it("should handle maximum length Bitcoin addresses", async () => {
        const maxLengthAddress = `bc1${"q".repeat(59)}` // 62 chars total (maximum)

        await expect(
          qcManagerLib.validateWalletRegistrationFull(
            qcData,
            qc1.address,
            maxLengthAddress,
            SAMPLE_CHALLENGE,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
        ).to.not.be.reverted
      })
    })
  })

  describe("validateDirectWalletRegistration Function", () => {
    describe("Successful Validation Cases", () => {
      it("should validate successfully and return challenge", async () => {
        const nonce = 12345

        const result = await qcManagerLib.validateDirectWalletRegistration(
          qcData,
          qc1.address,
          VALID_BTC_ADDRESS,
          nonce,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s,
          1 // chainId
        )

        // Should return a valid challenge
        expect(result).to.not.equal(ethers.constants.HashZero)
        expect(result).to.be.a("string")
      })

      it("should generate deterministic challenges", async () => {
        const nonce = 54321

        const result1 = await qcManagerLib.validateDirectWalletRegistration(
          qcData,
          qc1.address,
          VALID_BTC_ADDRESS,
          nonce,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s,
          1
        )

        const result2 = await qcManagerLib.validateDirectWalletRegistration(
          qcData,
          qc1.address,
          VALID_BTC_ADDRESS,
          nonce, // Same nonce
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s,
          1
        )

        // Same inputs should produce same challenge
        expect(result1).to.equal(result2)
      })

      it("should generate different challenges for different inputs", async () => {
        const baseNonce = 99999

        const challenge1 = await qcManagerLib.validateDirectWalletRegistration(
          qcData,
          qc1.address,
          VALID_BTC_ADDRESS,
          baseNonce,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s,
          1
        )

        const challenge2 = await qcManagerLib.validateDirectWalletRegistration(
          qcData,
          qc1.address,
          VALID_BTC_ADDRESS,
          baseNonce + 1, // Different nonce
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s,
          1
        )

        expect(challenge1).to.not.equal(challenge2)
      })

      it("should handle different Bitcoin address formats", async () => {
        const validAddresses = [
          "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // P2PKH
          "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // P2SH
          "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Bech32
        ]

        const nonce = 77777
        const challenges = []

        for (const address of validAddresses) {
          const challenge = await qcManagerLib.validateDirectWalletRegistration(
            qcData,
            qc1.address,
            address,
            nonce,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s,
            1
          )

          challenges.push(challenge)
        }

        // All should be different challenges
        expect(challenges[0]).to.not.equal(challenges[1])
        expect(challenges[1]).to.not.equal(challenges[2])
        expect(challenges[0]).to.not.equal(challenges[2])
      })
    })

    describe("QC Registration and Status Validation", () => {
      it("should revert with QCNotRegistered for unregistered QC", async () => {
        await expect(
          qcManagerLib.validateDirectWalletRegistration(
            qcData,
            unregisteredQC.address,
            VALID_BTC_ADDRESS,
            12345,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s,
            1
          )
        ).to.be.revertedWithCustomError(qcManagerLib, "QCNotRegistered")
      })

      it("should revert with QCNotActive for inactive QC", async () => {
        await qcData.setQCStatus(
          qc2.address,
          2,
          ethers.utils.formatBytes32String("paused")
        )

        await expect(
          qcManagerLib.validateDirectWalletRegistration(
            qcData,
            qc2.address,
            VALID_BTC_ADDRESS,
            12345,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s,
            1
          )
        ).to.be.revertedWithCustomError(qcManagerLib, "QCNotActive")
      })
    })

    describe("Bitcoin Address Validation", () => {
      it("should revert with InvalidWalletAddress for empty address", async () => {
        await expect(
          qcManagerLib.validateDirectWalletRegistration(
            qcData,
            qc1.address,
            "",
            12345,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s,
            1
          )
        ).to.be.revertedWithCustomError(qcManagerLib, "InvalidWalletAddress")
      })

      it("should revert with InvalidWalletAddress for invalid format", async () => {
        await expect(
          qcManagerLib.validateDirectWalletRegistration(
            qcData,
            qc1.address,
            "invalid_bitcoin_address",
            12345,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s,
            1
          )
        ).to.be.revertedWithCustomError(qcManagerLib, "InvalidWalletAddress")
      })
    })

    describe("Signature and Public Key Validation", () => {
      it("should revert with SignatureVerificationFailed for invalid signature", async () => {
        await expect(
          qcManagerLib.validateDirectWalletRegistration(
            qcData,
            qc1.address,
            VALID_BTC_ADDRESS,
            12345,
            SAMPLE_WALLET_PUBKEY,
            0, // Invalid v
            ethers.constants.HashZero,
            ethers.constants.HashZero,
            1
          )
        ).to.be.revertedWithCustomError(
          qcManagerLib,
          "SignatureVerificationFailed"
        )
      })

      it("should revert with SignatureVerificationFailed for wrong pubkey length", async () => {
        const wrongLengthPubkey = `0x${"04".repeat(30)}` // Wrong length

        await expect(
          qcManagerLib.validateDirectWalletRegistration(
            qcData,
            qc1.address,
            VALID_BTC_ADDRESS,
            12345,
            wrongLengthPubkey,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s,
            1
          )
        ).to.be.revertedWithCustomError(
          qcManagerLib,
          "SignatureVerificationFailed"
        )
      })
    })

    describe("Challenge Generation Logic", () => {
      it("should generate challenges with expected format", async () => {
        const nonce = 42

        const challenge = await qcManagerLib.validateDirectWalletRegistration(
          qcData,
          qc1.address,
          VALID_BTC_ADDRESS,
          nonce,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s,
          1
        )

        // Challenge should be keccak256 hash of packed data
        const expectedChallenge = ethers.utils.keccak256(
          ethers.utils.solidityPack(
            ["string", "address", "string", "uint256"],
            ["TBTC_DIRECT:", qc1.address, VALID_BTC_ADDRESS, nonce]
          )
        )

        expect(challenge).to.equal(expectedChallenge)
      })

      it("should handle edge case nonce values", async () => {
        const edgeNonces = [
          0, // Minimum
          1, // Small value
          ethers.constants.MaxUint256, // Maximum
        ]

        for (const nonce of edgeNonces) {
          const challenge = await qcManagerLib.validateDirectWalletRegistration(
            qcData,
            qc1.address,
            VALID_BTC_ADDRESS,
            nonce,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s,
            1
          )

          expect(challenge).to.not.equal(ethers.constants.HashZero)
        }
      })
    })
  })

  describe("Cross-Function Consistency", () => {
    it("should have consistent validation logic between both functions", async () => {
      // Both functions should reject the same invalid inputs
      const invalidAddress = "invalid_address"

      await expect(
        qcManagerLib.validateWalletRegistrationFull(
          qcData,
          qc1.address,
          invalidAddress,
          SAMPLE_CHALLENGE,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )
      ).to.be.revertedWithCustomError(qcManagerLib, "InvalidWalletAddress")

      await expect(
        qcManagerLib.validateDirectWalletRegistration(
          qcData,
          qc1.address,
          invalidAddress,
          12345,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s,
          1
        )
      ).to.be.revertedWithCustomError(qcManagerLib, "InvalidWalletAddress")
    })

    it("should consistently validate QC status", async () => {
      await qcData.setQCStatus(
        qc2.address,
        3,
        ethers.utils.formatBytes32String("under_review")
      )

      await expect(
        qcManagerLib.validateWalletRegistrationFull(
          qcData,
          qc2.address,
          VALID_BTC_ADDRESS,
          SAMPLE_CHALLENGE,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )
      ).to.be.revertedWithCustomError(qcManagerLib, "QCNotActive")

      await expect(
        qcManagerLib.validateDirectWalletRegistration(
          qcData,
          qc2.address,
          VALID_BTC_ADDRESS,
          12345,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s,
          1
        )
      ).to.be.revertedWithCustomError(qcManagerLib, "QCNotActive")
    })
  })
})
