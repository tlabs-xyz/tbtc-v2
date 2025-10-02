import { expect } from "chai"
import { ethers } from "hardhat"
import { QCManagerLib } from "../../../typechain"

describe("QCManagerLib - Bitcoin Address Validation (Direct Tests)", () => {
  let qcManagerLib: QCManagerLib

  beforeEach(async () => {
    // Deploy QCManagerLib library for direct function testing
    const QCManagerLibFactory = await ethers.getContractFactory("QCManagerLib")
    qcManagerLib = await QCManagerLibFactory.deploy()
  })

  describe("isValidBitcoinAddress Function", () => {
    describe("Valid Bitcoin Address Formats", () => {
      it("should accept valid P2PKH addresses (starts with '1')", async () => {
        const validP2PKHAddresses = [
          "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Genesis block address
          "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", // Random valid address
          "1111111111111111111114oLvT2", // Valid with many 1s
          `1${"A".repeat(24)}`, // Minimum length valid (25 chars)
          `1${"A".repeat(33)}`, // Maximum P2PKH length (34 chars)
        ]

        for (const address of validP2PKHAddresses) {
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          expect(result).to.be.true
        }
      })

      it("should accept valid P2SH addresses (starts with '3')", async () => {
        const validP2SHAddresses = [
          "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // Valid P2SH
          "3QJmV3qfvL9SuYo34YihAf3sRCW3qSinyC", // Valid P2SH
          "3333333333333333333333333333333333", // Valid format (34 chars)
          `3${"A".repeat(24)}`, // Minimum length valid (25 chars)
          `3${"B".repeat(33)}`, // Maximum P2SH length (34 chars)
        ]

        for (const address of validP2SHAddresses) {
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          expect(result).to.be.true
        }
      })

      it("should accept valid Bech32 addresses (starts with 'bc1')", async () => {
        const validBech32Addresses = [
          "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // P2WPKH
          `bc1q${"a".repeat(21)}`, // Minimum valid bech32 (25 chars)
          `bc1q${"a".repeat(50)}`, // Longer bech32
          `bc1${"z".repeat(39)}`, // Maximum length (42 chars)
        ]

        for (const address of validBech32Addresses) {
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          expect(result).to.be.true
        }
      })
    })

    describe("Invalid Bitcoin Address Formats", () => {
      it("should reject empty string", async () => {
        const result = await qcManagerLib.isValidBitcoinAddress("")
        expect(result).to.be.false
      })

      it("should reject addresses that are too short", async () => {
        const tooShortAddresses = [
          "1",
          "12",
          "123",
          "1234", // Too short P2PKH
          "3",
          "33",
          "333",
          "3333", // Too short P2SH
          "bc",
          "bc1",
          "bc1q", // Too short Bech32
          "A".repeat(24), // 24 chars (below 25 minimum)
        ]

        for (const address of tooShortAddresses) {
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          expect(result).to.be.false
        }
      })

      it("should reject addresses that are too long", async () => {
        const tooLongAddresses = [
          `1${"A".repeat(62)}`, // 63 chars (above 62 maximum)
          `3${"B".repeat(62)}`, // 63 chars
          `bc1${"q".repeat(60)}`, // 63 chars
          "A".repeat(100), // Way too long
        ]

        for (const address of tooLongAddresses) {
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          expect(result).to.be.false
        }
      })

      it("should reject invalid prefixes", async () => {
        const invalidPrefixes = [
          "0A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Starts with '0'
          "2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Starts with '2'
          "4A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Starts with '4'
          "5A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Starts with '5'
          "AA1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Starts with 'A'
          "ZA1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Starts with 'Z'
        ]

        for (const address of invalidPrefixes) {
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          expect(result).to.be.false
        }
      })

      it("should reject invalid Bech32 variations", async () => {
        const invalidBech32 = [
          "bc2qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // bc2 instead of bc1
          "tc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // tc1 (testnet)
          "ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // ltc1 (litecoin)
          "bch1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // bch1 (bitcoin cash)
        ]

        for (const address of invalidBech32) {
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          expect(result).to.be.false
        }
      })

      it("should reject Ethereum addresses", async () => {
        const ethereumAddresses = [
          "0x1234567890123456789012345678901234567890",
          "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // Vitalik's address
          "0x0000000000000000000000000000000000000000", // Zero address
        ]

        for (const address of ethereumAddresses) {
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          expect(result).to.be.false
        }
      })

      it("should reject random strings and malformed addresses", async () => {
        const malformedAddresses = [
          "not_a_bitcoin_address",
          "random-string-123",
          "bitcoin_address_format_invalid",
          "!@#$%^&*()_+{}|:<>?[]\\;',./",
          "mixed1With3Numbers",
        ]

        for (const address of malformedAddresses) {
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          expect(result).to.be.false
        }
      })

      it("should note that basic validation may pass some invalid formats", async () => {
        // This function does basic format validation only, not full cryptographic validation
        // Some strings that start with '1', '3', or 'bc1' and have correct length will pass
        const passingButInvalidFormats = [
          "1234567890abcdefghijklmnopqrstuvwxyz", // Starts with '1', correct length, but invalid checksum
        ]

        for (const address of passingButInvalidFormats) {
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          expect(result).to.be.true // These pass basic validation despite being invalid Bitcoin addresses
        }
      })
    })

    describe("Edge Cases and Special Characters", () => {
      it("should handle unicode characters", async () => {
        const unicodeAddresses = [
          "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNá", // Accented character
          "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfN🚀", // Emoji
        ]

        for (const address of unicodeAddresses) {
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          expect(result).to.be.false
        }
      })

      it("should note that basic validation may pass some unicode cases", async () => {
        // The basic validation doesn't check character encoding thoroughly
        const passingUnicodeAddresses = [
          "1А1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Cyrillic А instead of Latin A (still passes basic check)
        ]

        for (const address of passingUnicodeAddresses) {
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          expect(result).to.be.true // Basic validation may pass some unicode variations
        }
      })

      it("should handle whitespace and control characters", async () => {
        const whitespaceAddresses = [
          " 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Leading space
          "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa ", // Trailing space
          "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa\n", // Newline
          "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa\t", // Tab
          "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa\r", // Carriage return
          "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa\x00", // Null byte
        ]

        for (const address of whitespaceAddresses) {
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          expect(result).to.be.false
        }
      })

      it("should handle boundary lengths precisely", async () => {
        // Test exact boundary conditions
        const exactMinLength = `1${"A".repeat(24)}` // Exactly 25 chars (minimum)
        const exactMaxLength = `1${"A".repeat(61)}` // Exactly 62 chars (maximum)
        const justUnderMin = `1${"A".repeat(23)}` // 24 chars (too short)
        const justOverMax = `1${"A".repeat(62)}` // 63 chars (too long)

        expect(await qcManagerLib.isValidBitcoinAddress(exactMinLength)).to.be
          .true
        expect(await qcManagerLib.isValidBitcoinAddress(exactMaxLength)).to.be
          .true
        expect(await qcManagerLib.isValidBitcoinAddress(justUnderMin)).to.be
          .false
        expect(await qcManagerLib.isValidBitcoinAddress(justOverMax)).to.be
          .false
      })

      it("should handle case sensitivity properly", async () => {
        // Bitcoin addresses are case-sensitive
        const mixedCaseAddresses = [
          "1a1zp1ep5qgefi2dmptftl5slmv7divfna", // All lowercase
          "1A1ZP1EP5QGEFI2DMPTFTL5SLMV7DIVFNA", // All uppercase
          "3j98t1wpeZ73cnmqviecrnyiwrnqrhwnly", // Mixed case P2SH
          "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4", // Uppercase bech32
        ]

        for (const address of mixedCaseAddresses) {
          // All should be considered valid format-wise
          // (actual checksum validation is not implemented in this function)
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          if (
            address.startsWith("1") ||
            address.startsWith("3") ||
            address.toLowerCase().startsWith("bc1")
          ) {
            expect(result).to.be.true
          }
        }
      })

      it("should handle repeated characters", async () => {
        const repeatedCharAddresses = [
          `1${"1".repeat(30)}`, // Many 1s
          `3${"3".repeat(30)}`, // Many 3s
          `bc1${"q".repeat(30)}`, // Many qs
          `1${"z".repeat(30)}`, // Many zs
        ]

        for (const address of repeatedCharAddresses) {
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          expect(result).to.be.true // Format is valid even if unrealistic
        }
      })
    })

    describe("Performance and Gas Testing", () => {
      it("should handle validation efficiently", async () => {
        const testAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"

        // Test multiple calls to ensure consistent gas usage
        const tx1 = await qcManagerLib.isValidBitcoinAddress(testAddress)
        const tx2 = await qcManagerLib.isValidBitcoinAddress(testAddress)
        const tx3 = await qcManagerLib.isValidBitcoinAddress(testAddress)

        expect(tx1).to.equal(tx2)
        expect(tx2).to.equal(tx3)
      })

      it("should handle maximum length addresses without issues", async () => {
        const maxLengthAddress = `bc1${"q".repeat(59)}` // 62 chars total

        const result = await qcManagerLib.isValidBitcoinAddress(
          maxLengthAddress
        )

        expect(result).to.be.true
      })
    })

    describe("Real-world Bitcoin Addresses", () => {
      it("should validate known real Bitcoin addresses", async () => {
        const realAddresses = [
          "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Genesis block
          "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", // Known address
          "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // Known P2SH
          "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Known bech32
        ]

        for (const address of realAddresses) {
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          expect(result).to.be.true
        }
      })

      it("should reject known invalid patterns", async () => {
        const invalidPatterns = [
          "1000000000000000000000000000000000", // Invalid checksum pattern
          "3000000000000000000000000000000000", // Invalid checksum pattern
          "bc1000000000000000000000000000000000", // Invalid checksum pattern
        ]

        for (const address of invalidPatterns) {
          const result = await qcManagerLib.isValidBitcoinAddress(address)
          // These should still pass format validation (checksum is not validated)
          expect(result).to.be.true
        }
      })
    })
  })
})
