import { ethers } from "hardhat"
import { expect } from "chai"
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers"

import type { TestBitcoinAddressUtils } from "../../typechain"

describe("BitcoinAddressUtils", () => {
  let deployer: HardhatEthersSigner
  let testContract: TestBitcoinAddressUtils

  before(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;[deployer] = await ethers.getSigners()

    // Deploy test contract wrapper
    const TestBitcoinAddressUtils = await ethers.getContractFactory("TestBitcoinAddressUtils")
    testContract = await TestBitcoinAddressUtils.deploy()
    await testContract.deployed()
  })

  describe("P2PKH Address Decoding", () => {
    it("should decode valid P2PKH mainnet address", async () => {
      const address = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" // Bitcoin genesis address
      
      const result = await testContract.decodeAddress(address)
      expect(result.scriptType).to.equal(0) // P2PKH
      expect(result.scriptHash.length).to.equal(42) // 20 bytes = 40 hex chars + 0x prefix
    })

    it("should decode valid P2PKH testnet address", async () => {
      const address = "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn" // Example testnet P2PKH
      
      const result = await testContract.decodeAddress(address)
      expect(result.scriptType).to.equal(0) // P2PKH
      expect(result.scriptHash.length).to.equal(42) // 20 bytes
    })

    it("should reject invalid P2PKH address", async () => {
      const invalidAddress = "1InvalidAddress"
      
      await expect(testContract.decodeAddress(invalidAddress)).to.be.reverted
    })
  })

  describe("P2SH Address Decoding", () => {
    it("should decode valid P2SH mainnet address", async () => {
      const address = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy" // Example P2SH address
      
      const result = await testContract.decodeAddress(address)
      expect(result.scriptType).to.equal(1) // P2SH
      expect(result.scriptHash.length).to.equal(42) // 20 bytes
    })

    it("should decode valid P2SH testnet address", async () => {
      const address = "2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc" // Example testnet P2SH
      
      const result = await testContract.decodeAddress(address)
      expect(result.scriptType).to.equal(1) // P2SH
      expect(result.scriptHash.length).to.equal(42) // 20 bytes
    })
  })

  describe("P2WPKH Address Decoding", () => {
    it("should decode valid P2WPKH address", async () => {
      const address = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" // Example P2WPKH
      
      const result = await testContract.decodeAddress(address)
      expect(result.scriptType).to.equal(2) // P2WPKH
      expect(result.scriptHash.length).to.equal(42) // 20 bytes
    })

    it("should reject invalid bech32 address", async () => {
      const invalidAddress = "bc1qinvalid"
      
      await expect(testContract.decodeAddress(invalidAddress)).to.be.reverted
    })
  })

  describe("P2WSH Address Decoding", () => {
    it("should decode valid P2WSH address", async () => {
      const address = "bc1qrp33g0qq4aspd6gpgq2c5xqe8a9q3rq82l6j0pf3ywq5jjpzj5p6j5r2wjm" // Example P2WSH
      
      const result = await testContract.decodeAddress(address)
      expect(result.scriptType).to.equal(3) // P2WSH
      expect(result.scriptHash.length).to.equal(66) // 32 bytes = 64 hex chars + 0x prefix
    })
  })

  describe("Error Cases", () => {
    it("should reject empty address", async () => {
      await expect(testContract.decodeAddress("")).to.be.reverted
    })

    it("should reject unsupported address format", async () => {
      const unsupportedAddress = "unsupported_format"
      
      await expect(testContract.decodeAddress(unsupportedAddress)).to.be.reverted
    })

    it("should reject address with invalid length", async () => {
      const shortAddress = "bc1q"
      
      await expect(testContract.decodeAddress(shortAddress)).to.be.reverted
    })
  })

  describe("Script Generation", () => {
    it("should handle P2PKH script generation correctly", async () => {
      const address = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
      
      // This test verifies that the address decoding works for script comparison
      const result = await testContract.decodeAddress(address)
      expect(result.scriptType).to.equal(0)
      expect(result.scriptHash).to.not.equal("0x")
    })

    it("should handle P2WPKH script generation correctly", async () => {
      const address = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
      
      const result = await testContract.decodeAddress(address)
      expect(result.scriptType).to.equal(2)
      expect(result.scriptHash).to.not.equal("0x")
    })
  })
})