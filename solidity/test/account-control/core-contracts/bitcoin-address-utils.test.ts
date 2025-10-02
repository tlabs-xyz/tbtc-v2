import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

import type { TestBitcoinAddressUtilsInternals } from "../../../typechain"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

/**
 * BitcoinAddressUtils Internal Functions Test Suite
 *
 * Comprehensive testing of internal utility functions in BitcoinAddressUtils library
 * Tests individual components: base58 decoding, bech32 operations, bit conversion, etc.
 *
 * Critical for ensuring security and correctness of address validation logic
 */
describe("BitcoinAddressUtils Internal Functions", () => {
  let deployer: SignerWithAddress
  let testInternals: TestBitcoinAddressUtilsInternals

  before(async () => {
    const [deployerSigner] = await ethers.getSigners()
    deployer = deployerSigner

    // Deploy test contract
    const TestBitcoinAddressUtilsInternals = await ethers.getContractFactory(
      "TestBitcoinAddressUtilsInternals"
    )

    testInternals = await TestBitcoinAddressUtilsInternals.deploy()
    await testInternals.deployed()
  })

  beforeEach(async () => {
    await createSnapshot()
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Base58 Decoding", () => {
    const base58TestVectors = {
      valid: {
        simple: {
          input: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Bitcoin genesis address
          expectedLength: 25, // 1 version + 20 hash + 4 checksum
        },
        leadingZeros: {
          input: "111111111111111111114oLvT2", // Address with leading 1s (zeros)
          hasLeadingZeros: true,
        },
        multiByte: {
          input: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // P2SH address
          expectedLength: 25,
        },
      },
      invalid: {
        invalidCharacter: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfN0", // Contains '0' which is not in base58
        empty: "",
        singleChar: "1",
      },
    }

    describe("Valid Base58 Decoding", () => {
      it("should decode valid base58 address correctly", async () => {
        const inputBytes = ethers.utils.toUtf8Bytes(
          base58TestVectors.valid.simple.input
        )

        const decoded = await testInternals.testBase58Decode(inputBytes)

        expect(ethers.utils.arrayify(decoded).length).to.equal(
          base58TestVectors.valid.simple.expectedLength
        )
        expect(decoded).to.not.equal("0x")
      })

      it("should handle leading zeros correctly", async () => {
        const inputBytes = ethers.utils.toUtf8Bytes(
          base58TestVectors.valid.leadingZeros.input
        )

        const decoded = await testInternals.testBase58Decode(inputBytes)

        // Should start with zero bytes for leading 1s
        expect(ethers.utils.arrayify(decoded)[0]).to.equal(0x00)
        expect(ethers.utils.arrayify(decoded).length).to.be.greaterThan(0)
      })

      it("should decode P2SH addresses correctly", async () => {
        const inputBytes = ethers.utils.toUtf8Bytes(
          base58TestVectors.valid.multiByte.input
        )

        const decoded = await testInternals.testBase58Decode(inputBytes)

        expect(ethers.utils.arrayify(decoded).length).to.equal(
          base58TestVectors.valid.multiByte.expectedLength
        )
      })
    })

    describe("Invalid Base58 Handling", () => {
      it("should reject base58 with invalid characters", async () => {
        const inputBytes = ethers.utils.toUtf8Bytes(
          base58TestVectors.invalid.invalidCharacter
        )

        await expect(
          testInternals.testBase58Decode(inputBytes)
        ).to.be.revertedWithCustomError(testInternals, "InvalidAddressPrefix")
      })

      it("should handle empty input", async () => {
        const inputBytes = ethers.utils.toUtf8Bytes(
          base58TestVectors.invalid.empty
        )

        const decoded = await testInternals.testBase58Decode(inputBytes)
        expect(ethers.utils.arrayify(decoded).length).to.equal(0)
      })
    })

    describe("Base58 Character Conversion", () => {
      const base58Alphabet =
        "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

      it("should convert valid base58 characters correctly", async () => {
        for (let i = 0; i < base58Alphabet.length; i++) {
          const char = base58Alphabet[i]
          const charByte = ethers.utils.toUtf8Bytes(char)[0]

          const result = await testInternals.testBase58CharToValue(
            ethers.utils.hexlify([charByte])
          )

          expect(result).to.equal(i)
        }
      })

      it("should reject invalid base58 characters", async () => {
        const invalidChars = ["0", "O", "I", "l"] // Not in base58 alphabet

        for (const char of invalidChars) {
          const charByte = ethers.utils.toUtf8Bytes(char)[0]
          await expect(
            testInternals.testBase58CharToValue(
              ethers.utils.hexlify([charByte])
            )
          ).to.be.revertedWithCustomError(testInternals, "InvalidAddressPrefix")
        }
      })
    })
  })

  describe("Bech32 Operations", () => {
    const bech32TestVectors = {
      validAddresses: {
        p2wpkh: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        p2wsh: "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3",
        testnet: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
      },
      invalidAddresses: {
        mixedCase: "bc1QW508D6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        wrongPrefix: "xyz1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        noSeparator: "bc2qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        tooShort: "bc1q",
      },
    }

    describe("Bech32 Address Detection", () => {
      it("should detect valid bech32 addresses", async () => {
        for (const [type, address] of Object.entries(
          bech32TestVectors.validAddresses
        )) {
          const addressBytes = ethers.utils.toUtf8Bytes(address)
          const result = await testInternals.testIsBech32Address(addressBytes)
          expect(result).to.be.true, `Failed for ${type}: ${address}`
        }
      })

      it("should reject mixed case bech32 addresses", async () => {
        const addressBytes = ethers.utils.toUtf8Bytes(
          bech32TestVectors.invalidAddresses.mixedCase
        )

        const result = await testInternals.testIsBech32Address(addressBytes)
        expect(result).to.be.false
      })

      it("should reject addresses with wrong prefix", async () => {
        const addressBytes = ethers.utils.toUtf8Bytes(
          bech32TestVectors.invalidAddresses.wrongPrefix
        )

        const result = await testInternals.testIsBech32Address(addressBytes)
        expect(result).to.be.false
      })

      it("should reject addresses without proper separator", async () => {
        const addressBytes = ethers.utils.toUtf8Bytes(
          bech32TestVectors.invalidAddresses.noSeparator
        )

        const result = await testInternals.testIsBech32Address(addressBytes)
        expect(result).to.be.false
      })
    })

    describe("Mixed Case Detection", () => {
      it("should detect mixed case in addresses", async () => {
        const mixedCaseBytes = ethers.utils.toUtf8Bytes("bc1QW508d6qejxtdg")

        const result = await testInternals.testHasMixedCaseInAddress(
          mixedCaseBytes
        )

        expect(result).to.be.true
      })

      it("should pass for all lowercase", async () => {
        const lowercaseBytes = ethers.utils.toUtf8Bytes("bc1qw508d6qejxtdg")

        const result = await testInternals.testHasMixedCaseInAddress(
          lowercaseBytes
        )

        expect(result).to.be.false
      })

      it("should pass for all uppercase", async () => {
        const uppercaseBytes = ethers.utils.toUtf8Bytes("BC1QW508D6QEJXTDG")

        const result = await testInternals.testHasMixedCaseInAddress(
          uppercaseBytes
        )

        expect(result).to.be.false
      })

      it("should pass for numbers and special chars", async () => {
        const numbersBytes = ethers.utils.toUtf8Bytes("bc1q1234567890")

        const result = await testInternals.testHasMixedCaseInAddress(
          numbersBytes
        )

        expect(result).to.be.false
      })
    })

    describe("Bech32 Prefix Validation", () => {
      it("should validate mainnet prefixes", async () => {
        const mainnetLower = ethers.utils.toUtf8Bytes("bc1")
        const mainnetUpper = ethers.utils.toUtf8Bytes("BC1")

        expect(await testInternals.testIsBech32Prefix(mainnetLower)).to.be.true
        expect(await testInternals.testIsBech32Prefix(mainnetUpper)).to.be.true
      })

      it("should validate testnet prefixes", async () => {
        const testnetLower = ethers.utils.toUtf8Bytes("tb1")
        const testnetUpper = ethers.utils.toUtf8Bytes("TB1")

        expect(await testInternals.testIsBech32Prefix(testnetLower)).to.be.true
        expect(await testInternals.testIsBech32Prefix(testnetUpper)).to.be.true
      })

      it("should reject invalid prefixes", async () => {
        const invalidPrefixes = ["xyz", "bc2", "bt1", "tc1"]

        for (const prefix of invalidPrefixes) {
          const prefixBytes = ethers.utils.toUtf8Bytes(prefix)
          const result = await testInternals.testIsBech32Prefix(prefixBytes)
          expect(result).to.be.false, `Should reject prefix: ${prefix}`
        }
      })
    })

    describe("Bech32 Character Conversion", () => {
      const bech32Charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

      it("should convert valid bech32 characters correctly", async () => {
        for (let i = 0; i < bech32Charset.length; i++) {
          const char = bech32Charset[i]
          const charByte = ethers.utils.toUtf8Bytes(char)[0]

          const result = await testInternals.testBech32CharToValue(
            ethers.utils.hexlify([charByte])
          )

          expect(result).to.equal(i)
        }
      })

      it("should reject invalid bech32 characters", async () => {
        const invalidChars = ["1", "b", "i", "o"] // Not in bech32 charset

        for (const char of invalidChars) {
          const charByte = ethers.utils.toUtf8Bytes(char)[0]
          await expect(
            testInternals.testBech32CharToValue(
              ethers.utils.hexlify([charByte])
            )
          ).to.be.revertedWithCustomError(testInternals, "InvalidAddressPrefix")
        }
      })
    })

    describe("Bech32 Polymod Function", () => {
      it("should compute polymod correctly for known values", async () => {
        // Test with known values from bech32 specification
        const testCases = [
          { input: 1, expected: 32 }, // 1 << 5
          { input: 0, expected: 0 },
          { input: 32, expected: 1024 }, // 32 << 5
        ]

        for (const { input, expected } of testCases) {
          const result = await testInternals.testBech32PolymodStep(input)
          expect(result).to.equal(expected)
        }
      })

      it("should handle large values correctly", async () => {
        const largeValue = 0x1ffffff // Maximum 25-bit value
        const result = await testInternals.testBech32PolymodStep(largeValue)
        expect(ethers.BigNumber.isBigNumber(result)).to.be.true
        expect(result).to.not.equal(0)
      })
    })
  })

  describe("Bit Conversion", () => {
    describe("5-bit to 8-bit Conversion", () => {
      it("should convert 5-bit groups to 8-bit correctly", async () => {
        // Test vector: [15, 15, 15, 15] in 5-bit should convert to specific 8-bit pattern
        const input5bit = [15, 15, 15, 15] // Each value is < 32 (5 bits)

        const result = await testInternals.testConvertBits(
          input5bit,
          0,
          input5bit.length,
          5,
          8,
          false
        )

        expect(ethers.utils.arrayify(result).length).to.be.greaterThan(0)
        expect(result).to.not.equal("0x")
      })

      it("should handle padding correctly", async () => {
        const input5bit = [1, 2, 3] // Incomplete group

        const resultWithPad = await testInternals.testConvertBits(
          input5bit,
          0,
          input5bit.length,
          5,
          8,
          true
        )

        const resultWithoutPad = await testInternals.testConvertBits(
          input5bit,
          0,
          input5bit.length,
          5,
          8,
          false
        )

        // With padding should potentially be longer
        expect(
          ethers.utils.arrayify(resultWithPad).length
        ).to.be.greaterThanOrEqual(
          ethers.utils.arrayify(resultWithoutPad).length
        )
      })

      it("should handle empty input", async () => {
        const emptyInput: number[] = []

        const result = await testInternals.testConvertBits(
          emptyInput,
          0,
          0,
          5,
          8,
          false
        )

        expect(ethers.utils.arrayify(result).length).to.equal(0)
      })
    })

    describe("8-bit to 5-bit Conversion", () => {
      it("should convert 8-bit data to 5-bit groups", async () => {
        const input8bit = [255, 128, 64] // Test with known 8-bit values

        const result = await testInternals.testConvertBits(
          input8bit,
          0,
          input8bit.length,
          8,
          5,
          true
        )

        expect(ethers.utils.arrayify(result).length).to.be.greaterThan(
          input8bit.length
        ) // More 5-bit groups than 8-bit bytes
      })
    })

    describe("Boundary Cases", () => {
      it("should handle start/end indices correctly", async () => {
        const input = [1, 2, 3, 4, 5]

        const result = await testInternals.testConvertBits(
          input,
          1, // Start at index 1
          4, // End at index 4 (exclusive)
          5,
          8,
          false
        )

        // Should process elements [2, 3] only
        expect(result).to.not.equal("0x")
      })

      it("should handle single element conversion", async () => {
        const input = [31] // Maximum 5-bit value

        const result = await testInternals.testConvertBits(
          input,
          0,
          1,
          5,
          8,
          true
        )

        expect(ethers.utils.arrayify(result).length).to.be.greaterThan(0)
      })
    })
  })

  describe("Address Decoding Components", () => {
    describe("Base58 Address Decoding", () => {
      it("should decode P2PKH address correctly", async () => {
        const p2pkhAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
        const addressBytes = ethers.utils.toUtf8Bytes(p2pkhAddress)

        const result = await testInternals.testDecodeBase58Address(addressBytes)
        expect(Number(result.scriptType)).to.equal(0) // P2PKH
        expect(result.scriptHash.length).to.equal(42) // 20 bytes = 40 hex chars + 0x
      })

      it("should decode P2SH address correctly", async () => {
        const p2shAddress = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"
        const addressBytes = ethers.utils.toUtf8Bytes(p2shAddress)

        const result = await testInternals.testDecodeBase58Address(addressBytes)
        expect(Number(result.scriptType)).to.equal(1) // P2SH
        expect(result.scriptHash.length).to.equal(42) // 20 bytes
      })

      it("should reject invalid base58 address", async () => {
        const invalidAddress = "InvalidAddress123"
        const addressBytes = ethers.utils.toUtf8Bytes(invalidAddress)

        await expect(testInternals.testDecodeBase58Address(addressBytes)).to.be
          .reverted
      })
    })

    describe("Bech32 Address Decoding", () => {
      it("should decode P2WPKH address correctly", async () => {
        const p2wpkhAddress = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
        const addressBytes = ethers.utils.toUtf8Bytes(p2wpkhAddress)

        const result = await testInternals.testDecodeBech32Address(addressBytes)
        expect(Number(result.scriptType)).to.equal(2) // P2WPKH
        expect(result.scriptHash.length).to.equal(42) // 20 bytes
      })

      it("should decode P2WSH address correctly", async () => {
        const p2wshAddress =
          "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3"

        const addressBytes = ethers.utils.toUtf8Bytes(p2wshAddress)

        const result = await testInternals.testDecodeBech32Address(addressBytes)
        expect(Number(result.scriptType)).to.equal(3) // P2WSH
        expect(result.scriptHash.length).to.equal(66) // 32 bytes = 64 hex chars + 0x
      })

      it("should reject invalid bech32 address", async () => {
        const invalidAddress = "bc1qinvalid"
        const addressBytes = ethers.utils.toUtf8Bytes(invalidAddress)

        await expect(testInternals.testDecodeBech32Address(addressBytes)).to.be
          .reverted
      })
    })
  })

  describe("Checksum Functions", () => {
    describe("Bech32 Checksum Calculation", () => {
      it("should calculate checksum for derivation correctly", async () => {
        const hrp = "bc"

        const testData = [
          0, 14, 20, 15, 7, 13, 26, 0, 25, 18, 6, 11, 13, 7, 21, 16, 10, 29, 3,
          6, 27, 15, 14, 26, 12, 10, 11, 15, 7,
        ]

        const checksum = await testInternals.testBech32ChecksumForDerivation(
          hrp,
          testData,
          testData.length
        )

        expect(ethers.BigNumber.isBigNumber(checksum)).to.be.true
        expect(checksum).to.not.equal(0)
      })

      it("should produce different checksums for different data", async () => {
        const hrp = "bc"
        const data1 = [0, 1, 2, 3, 4]
        const data2 = [0, 1, 2, 3, 5] // Different last element

        const checksum1 = await testInternals.testBech32ChecksumForDerivation(
          hrp,
          data1,
          data1.length
        )

        const checksum2 = await testInternals.testBech32ChecksumForDerivation(
          hrp,
          data2,
          data2.length
        )

        expect(checksum1).to.not.equal(checksum2)
      })

      it("should produce different checksums for different HRP", async () => {
        const data = [0, 1, 2, 3, 4]

        const checksumBC = await testInternals.testBech32ChecksumForDerivation(
          "bc",
          data,
          data.length
        )

        const checksumTB = await testInternals.testBech32ChecksumForDerivation(
          "tb",
          data,
          data.length
        )

        expect(checksumBC).to.not.equal(checksumTB)
      })
    })
  })
})
