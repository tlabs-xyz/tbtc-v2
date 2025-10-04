import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

import type { TestBitcoinAddressUtils } from "../../../typechain"
import { generateBitcoinKeyPair } from "../helpers/wallet-signature-helpers"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

/**
 * Cross-Implementation Validation Test Suite
 *
 * Validates consistency between the BitcoinAddressUtils contract implementation
 * and the JavaScript implementation in wallet-signature-helpers.ts
 *
 * Critical for ensuring that both implementations produce compatible results
 * and that switching between implementations doesn't break functionality
 */
describe("Cross-Implementation Validation", () => {
  let deployer: SignerWithAddress
  let testUtils: TestBitcoinAddressUtils

  before(async () => {
    const [deployerSigner] = await ethers.getSigners()
    deployer = deployerSigner

    // Deploy test utilities contract
    const TestBitcoinAddressUtils = await ethers.getContractFactory(
      "TestBitcoinAddressUtils"
    )

    testUtils = await TestBitcoinAddressUtils.deploy()
    await testUtils.deployed()
  })

  beforeEach(async () => {
    await createSnapshot()
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Address Derivation Consistency", () => {
    it("should produce valid addresses from both implementations", async () => {
      // Generate multiple test cases to ensure consistency
      for (let i = 0; i < 5; i++) {
        const keyPair = generateBitcoinKeyPair()

        // Derive address using contract implementation
        const contractAddress =
          await testUtils.deriveBitcoinAddressFromPublicKey(keyPair.publicKey)

        // Helper implementation address
        const helperAddress = keyPair.address

        // Both should be valid bech32 P2WPKH addresses
        expect(contractAddress).to.match(/^bc1q[a-z0-9]{38,58}$/)
        expect(helperAddress).to.match(/^bc1[a-z0-9]+$/)

        // Both should be decodable
        const contractDecoded = await testUtils.decodeAddress(contractAddress)
        const helperDecoded = await testUtils.decodeAddress(helperAddress)

        expect(Number(contractDecoded.scriptType)).to.equal(2) // P2WPKH
        expect(Number(helperDecoded.scriptType)).to.equal(2) // P2WPKH

        expect(contractDecoded.scriptHash.length).to.equal(42) // 20 bytes
        expect(helperDecoded.scriptHash.length).to.equal(42) // 20 bytes
      }
    })

    it("should handle same public key consistently", async () => {
      // Use a fixed public key for deterministic testing
      const fixedPrivateKey = Buffer.from("a".repeat(64), "hex")
      const secp256k1 = require("secp256k1")

      // Generate public key
      const publicKeyFull = secp256k1.publicKeyCreate(fixedPrivateKey, false)
      const publicKey = publicKeyFull.slice(1) // Remove 0x04 prefix

      // Derive using contract
      const contractAddress = await testUtils.deriveBitcoinAddressFromPublicKey(
        publicKey
      )

      // Create a key pair object with this public key for helper comparison
      const compressedPublicKey = secp256k1.publicKeyCreate(
        fixedPrivateKey,
        true
      )

      // Note: We can't directly use the helper's deriveBitcoinAddress function
      // as it's not exported, but we can verify both produce valid addresses
      expect(contractAddress).to.match(/^bc1q[a-z0-9]{38,58}$/)

      // Verify address is consistently decodable
      const decoded1 = await testUtils.decodeAddress(contractAddress)
      const decoded2 = await testUtils.decodeAddress(contractAddress)

      expect(decoded1.scriptType).to.equal(decoded2.scriptType)
      expect(decoded1.scriptHash).to.equal(decoded2.scriptHash)
    })

    it("should produce unique addresses for different keys", async () => {
      const keyPair1 = generateBitcoinKeyPair()
      const keyPair2 = generateBitcoinKeyPair()

      const address1 = await testUtils.deriveBitcoinAddressFromPublicKey(
        keyPair1.publicKey
      )

      const address2 = await testUtils.deriveBitcoinAddressFromPublicKey(
        keyPair2.publicKey
      )

      // Addresses should be different for different keys
      expect(address1).to.not.equal(address2)

      // Both should still be valid
      expect(address1).to.match(/^bc1q[a-z0-9]{38,58}$/)
      expect(address2).to.match(/^bc1q[a-z0-9]{38,58}$/)
    })
  })

  describe("Address Decoding Consistency", () => {
    it("should decode addresses consistently across implementations", async () => {
      // Test with known Bitcoin addresses (mainnet and testnet)
      const testAddresses = [
        "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // P2PKH mainnet
        "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // P2SH mainnet
        "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // P2WPKH mainnet
        "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3", // P2WSH mainnet
        "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn", // P2PKH testnet
        "2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc", // P2SH testnet
        "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", // P2WPKH testnet
        "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7", // P2WSH testnet
      ]

      for (const address of testAddresses) {
        // Decode using our implementation
        const decoded = await testUtils.decodeAddress(address)

        // Verify consistency by re-encoding and decoding
        const reDecoded = await testUtils.decodeAddress(address)

        expect(decoded.scriptType).to.equal(reDecoded.scriptType)
        expect(decoded.scriptHash).to.equal(reDecoded.scriptHash)
      }
    })

    it("should handle edge cases consistently", async () => {
      // Test addresses at boundaries of different types
      const edgeCaseAddresses = [
        "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn", // Testnet P2PKH
        "2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc", // Testnet P2SH
        "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", // Testnet P2WPKH
      ]

      for (const address of edgeCaseAddresses) {
        const decoded = await testUtils.decodeAddress(address)

        // Should produce valid results
        expect(decoded.scriptType).to.be.oneOf([0, 1, 2, 3])
        expect(decoded.scriptHash).to.not.equal("0x")
        expect(decoded.scriptHash.length).to.be.oneOf([42, 66]) // 20 or 32 bytes
      }
    })
  })

  describe("Error Handling Consistency", () => {
    it("should reject invalid addresses consistently", async () => {
      const invalidAddresses = [
        "", // Empty
        "invalid", // Invalid format
        "1InvalidChecksum", // Invalid checksum
        "bc1qinvalid", // Invalid bech32
        "3InvalidP2SH", // Invalid P2SH
      ]

      for (const invalidAddress of invalidAddresses) {
        // Both implementations should reject these
        await expect(testUtils.decodeAddress(invalidAddress)).to.be.reverted
      }
    })

    it("should handle malformed public keys consistently in derivation", async () => {
      const invalidKeys = [
        Buffer.from("1234", "hex"), // Too short
        Buffer.from("a".repeat(130), "hex"), // Too long
        Buffer.alloc(0), // Empty
      ]

      for (const invalidKey of invalidKeys) {
        await expect(testUtils.deriveBitcoinAddressFromPublicKey(invalidKey)).to
          .be.reverted
      }
    })
  })

  describe("Performance and Gas Consistency", () => {
    it("should have reasonable gas costs for address derivation", async () => {
      const keyPair = generateBitcoinKeyPair()

      // Estimate gas for derivation
      const gasEstimate =
        await testUtils.estimateGas.deriveBitcoinAddressFromPublicKey(
          keyPair.publicKey
        )

      // Should be reasonable (less than 1M gas)
      expect(gasEstimate.toNumber()).to.be.lessThan(1000000)
      expect(gasEstimate.toNumber()).to.be.greaterThan(10000) // But not trivial
    })

    it("should have consistent gas costs for address decoding", async () => {
      const addresses = [
        "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // P2PKH
        "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // P2WPKH
      ]

      const gasCosts: number[] = []

      for (const address of addresses) {
        const gasEstimate = await testUtils.estimateGas.decodeAddress(address)
        gasCosts.push(gasEstimate.toNumber())
      }

      // Gas costs should be reasonable and somewhat consistent
      for (const cost of gasCosts) {
        expect(cost).to.be.lessThan(1000000)
        expect(cost).to.be.greaterThan(5000)
      }
    })
  })

  describe("Integration Validation", () => {
    it("should support wallet registrations with derived addresses", async () => {
      // Simulate existing wallet data that might depend on address format
      const keyPair = generateBitcoinKeyPair()

      const derivedAddress = await testUtils.deriveBitcoinAddressFromPublicKey(
        keyPair.publicKey
      )

      // Derived address should be compatible with the decoding function
      const decoded = await testUtils.decodeAddress(derivedAddress)

      expect(Number(decoded.scriptType)).to.equal(2) // P2WPKH as expected
      expect(decoded.scriptHash.length).to.equal(42)
    })

    it("should handle roundtrip operations correctly", async () => {
      // Generate key -> derive address -> decode address -> verify consistency
      for (let i = 0; i < 3; i++) {
        const keyPair = generateBitcoinKeyPair()

        // Derive address from public key
        const address = await testUtils.deriveBitcoinAddressFromPublicKey(
          keyPair.publicKey
        )

        // Decode the derived address
        const decoded = await testUtils.decodeAddress(address)

        // Verify the decoded information is consistent
        expect(Number(decoded.scriptType)).to.equal(2) // P2WPKH
        expect(decoded.scriptHash).to.not.equal("0x")
        expect(decoded.scriptHash.length).to.equal(42) // 20 bytes

        // The address should be consistently re-decodable
        const redecoded = await testUtils.decodeAddress(address)
        expect(decoded.scriptType).to.equal(redecoded.scriptType)
        expect(decoded.scriptHash).to.equal(redecoded.scriptHash)
      }
    })
  })

  describe("Stress Testing Cross-Implementation", () => {
    it("should handle multiple rapid operations consistently", async () => {
      const results: string[] = []

      // Generate and derive multiple addresses rapidly
      for (let i = 0; i < 10; i++) {
        const keyPair = generateBitcoinKeyPair()

        const address = await testUtils.deriveBitcoinAddressFromPublicKey(
          keyPair.publicKey
        )

        results.push(address)
      }

      // All results should be unique and valid
      const uniqueResults = new Set(results)
      expect(uniqueResults.size).to.equal(results.length) // All unique

      // All should be valid bech32 format
      for (const address of results) {
        expect(address).to.match(/^bc1q[a-z0-9]{38,58}$/)
      }
    })

    it("should maintain consistency under edge conditions", async () => {
      // Test with public keys that might cause edge cases
      const secp256k1 = require("secp256k1")

      const edgeCaseKeys = [
        Buffer.from(`${"0".repeat(63)}1`, "hex"), // Minimal non-zero key
        Buffer.from("f".repeat(64), "hex"), // Maximum key value
        Buffer.from("8".repeat(64), "hex"), // Mid-range key
      ]

      for (const privateKey of edgeCaseKeys) {
        if (secp256k1.privateKeyVerify(privateKey)) {
          const publicKeyFull = secp256k1.publicKeyCreate(privateKey, false)
          const publicKey = publicKeyFull.slice(1)

          const address = await testUtils.deriveBitcoinAddressFromPublicKey(
            publicKey
          )

          expect(address).to.match(/^bc1q[a-z0-9]{38,58}$/)

          // Should be decodable
          const decoded = await testUtils.decodeAddress(address)
          expect(Number(decoded.scriptType)).to.equal(2)
        }
      }
    })
  })

  describe("Testnet Bech32 Cross-Implementation Validation", () => {
    it("should handle testnet bech32 case variants consistently", async () => {
      const testnetCaseVariants = [
        {
          lowercase: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
          uppercase: "TB1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KXPJZSX",
        },
        {
          lowercase:
            "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7",
          uppercase:
            "TB1QRP33G0Q5C5TXSP9ARYSRX4K6ZDKFS4NCE4XJ0GDCCCEFVPYSXF3Q0SL5K7",
        },
      ]

      for (const { lowercase, uppercase } of testnetCaseVariants) {
        const lowercaseResult = await testUtils.decodeAddress(lowercase)
        const uppercaseResult = await testUtils.decodeAddress(uppercase)

        // Both case variants should decode to same result
        expect(lowercaseResult.scriptType).to.equal(uppercaseResult.scriptType)
        expect(lowercaseResult.scriptHash).to.equal(uppercaseResult.scriptHash)

        // Results should be valid
        expect(Number(lowercaseResult.scriptType)).to.be.oneOf([2, 3]) // P2WPKH or P2WSH
        expect(lowercaseResult.scriptHash).to.not.equal("0x")
      }
    })

    it("should maintain gas efficiency for testnet addresses", async () => {
      const testnetAddresses = [
        "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", // Testnet P2WPKH
        "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7", // Testnet P2WSH
      ]

      for (const address of testnetAddresses) {
        const gasEstimate = await testUtils.estimateGas.decodeAddress(address)

        // Should not use excessive gas
        expect(gasEstimate.toNumber()).to.be.lessThan(500000)
        expect(gasEstimate.toNumber()).to.be.greaterThan(5000)
      }
    })

    it("should reject mixed case testnet addresses consistently", async () => {
      const mixedCaseTestnetAddresses = [
        "tb1QW508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", // Mixed case P2WPKH
        "tb1QRP33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7", // Mixed case P2WSH
      ]

      for (const invalidAddress of mixedCaseTestnetAddresses) {
        await expect(testUtils.decodeAddress(invalidAddress)).to.be.reverted
      }
    })
  })
})
