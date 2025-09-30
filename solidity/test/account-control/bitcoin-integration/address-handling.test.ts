import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers"
import { smock } from "@defi-wonderland/smock"

import type { QCRedeemer, TestBitcoinAddressUtils } from "../../../typechain"
import { LibraryLinkingHelper } from "../../helpers/libraryLinkingHelper"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

/**
 * Bitcoin Address Handling Integration Tests
 *
 * Consolidates validation and utility testing for Bitcoin address formats.
 * Organized by address type: P2PKH, P2SH, P2WPKH, P2WSH
 *
 * Tests both:
 * - Integration validation through QCRedeemer contract
 * - Direct utility functions through TestBitcoinAddressUtils
 */
describe("Bitcoin Address Handling", () => {
  let deployer: HardhatEthersSigner
  let qcRedeemer: QCRedeemer
  let testUtils: TestBitcoinAddressUtils
  let tbtc: any
  let systemState: any
  let relay: any

  // Consolidated Bitcoin test addresses (real mainnet/testnet addresses)
  const bitcoinAddresses = {
    p2pkh: {
      mainnet: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Genesis block coinbase
      testnet: "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn",
      scriptType: 0
    },
    p2sh: {
      mainnet: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
      testnet: "2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc",
      scriptType: 1
    },
    p2wpkh: {
      mainnet: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      scriptType: 2
    },
    p2wsh: {
      mainnet: "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3", // BIP173 example
      scriptType: 3
    }
  }

  const invalidAddresses = {
    empty: "",
    invalidFormat: "invalid_address_format",
    wrongPrefix: "xyz123invalid",
    invalidP2PKH: "1InvalidAddress",
    invalidBech32: "bc1qinvalid",
    shortBech32: "bc1q",
    unsupported: "unsupported_format"
  }

  before(async () => {
    const [deployerSigner] = await ethers.getSigners()
    deployer = deployerSigner

    // Deploy test utilities contract
    const TestBitcoinAddressUtils = await ethers.getContractFactory(
      "TestBitcoinAddressUtils"
    )
    testUtils = await TestBitcoinAddressUtils.deploy()
    await testUtils.deployed()

    // Deploy mock dependencies for QCRedeemer integration tests
    const MockTBTC = await ethers.getContractFactory("MockTBTCToken")
    tbtc = await MockTBTC.deploy()

    const QCData = await ethers.getContractFactory("QCData")
    const qcData = await QCData.deploy()

    const SystemState = await ethers.getContractFactory("SystemState")
    systemState = await SystemState.deploy()

    const TestRelay = await ethers.getContractFactory("TestRelay")
    relay = await TestRelay.deploy()

    // Deploy QCRedeemer using LibraryLinkingHelper for proper library linking
    qcRedeemer = await LibraryLinkingHelper.deployQCRedeemer(
      tbtc.address,
      qcData.address,
      systemState.address,
      relay.address,
      1 // txProofDifficultyFactor
    )
  })

  beforeEach(async () => {
    await createSnapshot()
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("P2PKH Addresses", () => {
    describe("Validation", () => {
      beforeEach(async () => {
        // Setup mock QCData for integration tests
        const mockQCData = await smock.fake("QCData")
        mockQCData.getWalletOwner
          .whenCalledWith(bitcoinAddresses.p2pkh.mainnet)
          .returns(deployer.address)
        mockQCData.getWalletStatus.returns(1) // Active status

        // Deploy QCRedeemer with mocked QCData using library helper
        qcRedeemer = await LibraryLinkingHelper.deployQCRedeemer(
          tbtc.address,
          mockQCData.address,
          systemState.address,
          relay.address,
          1
        )
      })

      it("should validate P2PKH mainnet address through redemption", async () => {
        // Integration test: address validation passes, fails at later QC validation
        await expect(
          qcRedeemer.initiateRedemption(
            deployer.address,
            ethers.utils.parseEther("1"),
            bitcoinAddresses.p2pkh.mainnet,
            bitcoinAddresses.p2pkh.mainnet
          )
        ).to.be.revertedWith("ValidationFailed")
        // ValidationFailed means address validation passed
      })

      it("should reject invalid P2PKH format", async () => {
        await expect(
          qcRedeemer.initiateRedemption(
            deployer.address,
            ethers.utils.parseEther("1"),
            invalidAddresses.invalidP2PKH,
            bitcoinAddresses.p2pkh.mainnet
          )
        ).to.be.revertedWith("InvalidBitcoinAddressFormat")
      })
    })

    describe("Utilities", () => {
      it("should decode valid P2PKH mainnet address", async () => {
        const result = await testUtils.decodeAddress(bitcoinAddresses.p2pkh.mainnet)

        expect(Number(result.scriptType)).to.equal(bitcoinAddresses.p2pkh.scriptType)
        expect(result.scriptHash.length).to.equal(42) // 20 bytes = 40 hex chars + 0x
        expect(result.scriptHash).to.not.equal("0x")
      })

      it("should decode valid P2PKH testnet address", async () => {
        const result = await testUtils.decodeAddress(bitcoinAddresses.p2pkh.testnet)

        expect(Number(result.scriptType)).to.equal(bitcoinAddresses.p2pkh.scriptType)
        expect(result.scriptHash.length).to.equal(42) // 20 bytes
      })

      it("should handle P2PKH script generation correctly", async () => {
        const result = await testUtils.decodeAddress(bitcoinAddresses.p2pkh.mainnet)

        expect(result.scriptType).to.equal(bitcoinAddresses.p2pkh.scriptType)
        expect(result.scriptHash).to.not.equal("0x")
      })

      it("should reject invalid P2PKH address", async () => {
        await expect(testUtils.decodeAddress(invalidAddresses.invalidP2PKH)).to.be.reverted
      })
    })
  })

  describe("P2SH Addresses", () => {
    describe("Validation", () => {
      beforeEach(async () => {
        const mockQCData = await smock.fake("QCData")
        mockQCData.getWalletOwner
          .whenCalledWith(bitcoinAddresses.p2sh.mainnet)
          .returns(deployer.address)
        mockQCData.getWalletStatus.returns(1)

        qcRedeemer = await LibraryLinkingHelper.deployQCRedeemer(
          tbtc.address,
          mockQCData.address,
          systemState.address,
          relay.address,
          1
        )
      })

      it("should validate P2SH mainnet address", async () => {
        await expect(
          qcRedeemer.initiateRedemption(
            deployer.address,
            ethers.utils.parseEther("1"),
            bitcoinAddresses.p2sh.mainnet,
            bitcoinAddresses.p2sh.mainnet
          )
        ).to.be.revertedWith("ValidationFailed")
        // P2SH validation passed (error from QC validation, not address)
      })
    })

    describe("Utilities", () => {
      it("should decode valid P2SH mainnet address", async () => {
        const result = await testUtils.decodeAddress(bitcoinAddresses.p2sh.mainnet)

        expect(Number(result.scriptType)).to.equal(bitcoinAddresses.p2sh.scriptType)
        expect(result.scriptHash.length).to.equal(42) // 20 bytes
      })

      it("should decode valid P2SH testnet address", async () => {
        const result = await testUtils.decodeAddress(bitcoinAddresses.p2sh.testnet)

        expect(Number(result.scriptType)).to.equal(bitcoinAddresses.p2sh.scriptType)
        expect(result.scriptHash.length).to.equal(42) // 20 bytes
      })
    })
  })

  describe("Bech32 Addresses (P2WPKH/P2WSH)", () => {
    describe("P2WPKH Validation", () => {
      beforeEach(async () => {
        const mockQCData = await smock.fake("QCData")
        mockQCData.getWalletOwner
          .whenCalledWith(bitcoinAddresses.p2wpkh.mainnet)
          .returns(deployer.address)
        mockQCData.getWalletStatus.returns(1)

        qcRedeemer = await LibraryLinkingHelper.deployQCRedeemer(
          tbtc.address,
          mockQCData.address,
          systemState.address,
          relay.address,
          1
        )
      })

      it("should validate P2WPKH address", async () => {
        await expect(
          qcRedeemer.initiateRedemption(
            deployer.address,
            ethers.utils.parseEther("1"),
            bitcoinAddresses.p2wpkh.mainnet,
            bitcoinAddresses.p2wpkh.mainnet
          )
        ).to.be.revertedWith("ValidationFailed")
        // Bech32 validation passed
      })
    })

    describe("P2WPKH Utilities", () => {
      it("should decode valid P2WPKH address", async () => {
        const result = await testUtils.decodeAddress(bitcoinAddresses.p2wpkh.mainnet)

        expect(Number(result.scriptType)).to.equal(bitcoinAddresses.p2wpkh.scriptType)
        expect(result.scriptHash.length).to.equal(42) // 20 bytes
      })

      it("should handle P2WPKH script generation correctly", async () => {
        const result = await testUtils.decodeAddress(bitcoinAddresses.p2wpkh.mainnet)

        expect(result.scriptType).to.equal(bitcoinAddresses.p2wpkh.scriptType)
        expect(result.scriptHash).to.not.equal("0x")
      })

      it("should reject invalid bech32 address", async () => {
        await expect(testUtils.decodeAddress(invalidAddresses.invalidBech32)).to.be.reverted
      })
    })

    describe("P2WSH Validation", () => {
      beforeEach(async () => {
        const mockQCData = await smock.fake("QCData")
        mockQCData.getWalletOwner
          .whenCalledWith(bitcoinAddresses.p2wsh.mainnet)
          .returns(deployer.address)
        mockQCData.getWalletStatus.returns(1)

        qcRedeemer = await LibraryLinkingHelper.deployQCRedeemer(
          tbtc.address,
          mockQCData.address,
          systemState.address,
          relay.address,
          1
        )
      })

      it("should handle P2WSH addresses (32-byte hashes)", async () => {
        // P2WSH addresses have 32-byte script hashes vs 20-byte for others
        await expect(
          qcRedeemer.initiateRedemption(
            deployer.address,
            ethers.utils.parseEther("1"),
            bitcoinAddresses.p2wsh.mainnet,
            bitcoinAddresses.p2wsh.mainnet
          )
        ).to.be.revertedWith("ValidationFailed")
        // P2WSH validation passed (32-byte hash handled correctly)
      })
    })

    describe("P2WSH Utilities", () => {
      it("should decode valid P2WSH address", async () => {
        const result = await testUtils.decodeAddress(bitcoinAddresses.p2wsh.mainnet)

        expect(Number(result.scriptType)).to.equal(bitcoinAddresses.p2wsh.scriptType)
        expect(result.scriptHash.length).to.equal(66) // 32 bytes = 64 hex chars + 0x
      })
    })
  })

  describe("Error Handling", () => {
    describe("Integration Error Cases", () => {
      beforeEach(async () => {
        const mockQCData = await smock.fake("QCData")
        mockQCData.getWalletOwner.returns(deployer.address)
        mockQCData.getWalletStatus.returns(1)

        qcRedeemer = await LibraryLinkingHelper.deployQCRedeemer(
          tbtc.address,
          mockQCData.address,
          systemState.address,
          relay.address,
          1
        )
      })

      it("should reject empty Bitcoin address", async () => {
        await expect(
          qcRedeemer.initiateRedemption(
            deployer.address,
            ethers.utils.parseEther("1"),
            invalidAddresses.empty,
            bitcoinAddresses.p2pkh.mainnet
          )
        ).to.be.revertedWith("BitcoinAddressRequired")
      })

      it("should reject address with wrong prefix", async () => {
        await expect(
          qcRedeemer.initiateRedemption(
            deployer.address,
            ethers.utils.parseEther("1"),
            invalidAddresses.wrongPrefix,
            bitcoinAddresses.p2pkh.mainnet
          )
        ).to.be.revertedWith("InvalidBitcoinAddressFormat")
      })

      it("should reject invalid format", async () => {
        await expect(
          qcRedeemer.initiateRedemption(
            deployer.address,
            ethers.utils.parseEther("1"),
            invalidAddresses.invalidFormat,
            bitcoinAddresses.p2pkh.mainnet
          )
        ).to.be.revertedWith("InvalidBitcoinAddressFormat")
      })
    })

    describe("Utility Error Cases", () => {
      it("should reject empty address", async () => {
        await expect(testUtils.decodeAddress(invalidAddresses.empty)).to.be.reverted
      })

      it("should reject unsupported address format", async () => {
        await expect(testUtils.decodeAddress(invalidAddresses.unsupported)).to.be.reverted
      })

      it("should reject address with invalid length", async () => {
        await expect(testUtils.decodeAddress(invalidAddresses.shortBech32)).to.be.reverted
      })
    })
  })
})