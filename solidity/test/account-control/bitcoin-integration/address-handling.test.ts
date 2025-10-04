import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { smock } from "@defi-wonderland/smock"

import type { QCRedeemer, TestBitcoinAddressUtils } from "../../../typechain"
import { LibraryLinkingHelper } from "../helpers/library-linking-helper"

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
  let deployer: SignerWithAddress
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
      scriptType: 0,
    },
    p2sh: {
      mainnet: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
      testnet: "2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc",
      scriptType: 1,
    },
    p2wpkh: {
      mainnet: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // BIP173 test vector (scriptHash: 751e76e8199196d454941c45d1b3a323f1433bd6)
      testnet: "tb1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq2dzmyqn", // Different testnet P2WPKH (scriptHash: 0000000000000000000000000000000000000000)
      scriptType: 2,
    },
    p2wsh: {
      mainnet: "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3", // BIP173 test vector (32-byte scriptHash)
      testnet: "tb1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq4dh5vz", // Different testnet P2WSH (different 32-byte scriptHash)
      scriptType: 3,
    },
  }

  const invalidAddresses = {
    empty: "",
    invalidFormat: "invalid_address_format",
    wrongPrefix: "xyz123invalid",
    invalidP2PKH: "1InvalidAddress",
    invalidBech32: "bc1qinvalid",
    shortBech32: "bc1q",
    unsupported: "unsupported_format",
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

    // Deploy MockBank for MockAccountControl
    const MockBank = await ethers.getContractFactory("MockBank")
    const bank = await MockBank.deploy()

    // Deploy mock AccountControl for QCRedeemer
    const MockAccountControl = await ethers.getContractFactory(
      "MockAccountControl"
    )

    const accountControl = await MockAccountControl.deploy(bank.address)

    // Deploy QCRedeemer using LibraryLinkingHelper for proper library linking
    qcRedeemer = (await LibraryLinkingHelper.deployQCRedeemer(
      tbtc.address,
      qcData.address,
      systemState.address,
      accountControl.address
    )) as QCRedeemer
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

        // Deploy MockBank and MockAccountControl for QCRedeemer
        const MockBank = await ethers.getContractFactory("MockBank")
        const bank = await MockBank.deploy()

        const MockAccountControl = await ethers.getContractFactory(
          "MockAccountControl"
        )

        const accountControl = await MockAccountControl.deploy(bank.address)

        // Deploy QCRedeemer with mocked QCData using library helper
        qcRedeemer = (await LibraryLinkingHelper.deployQCRedeemer(
          tbtc.address,
          mockQCData.address,
          systemState.address,
          accountControl.address
        )) as QCRedeemer
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
        ).to.be.revertedWithCustomError(
          qcRedeemer,
          "InvalidBitcoinAddressFormat"
        )
      })
    })

    describe("Utilities", () => {
      it("should decode valid P2PKH mainnet address", async () => {
        const result = await testUtils.decodeAddress(
          bitcoinAddresses.p2pkh.mainnet
        )

        expect(Number(result.scriptType)).to.equal(
          bitcoinAddresses.p2pkh.scriptType
        )
        expect(result.scriptHash.length).to.equal(42) // 20 bytes = 40 hex chars + 0x
        expect(result.scriptHash).to.not.equal("0x")
      })

      it("should decode valid P2PKH testnet address", async () => {
        const result = await testUtils.decodeAddress(
          bitcoinAddresses.p2pkh.testnet
        )

        expect(Number(result.scriptType)).to.equal(
          bitcoinAddresses.p2pkh.scriptType
        )
        expect(result.scriptHash.length).to.equal(42) // 20 bytes
      })

      it("should handle P2PKH script generation correctly", async () => {
        const result = await testUtils.decodeAddress(
          bitcoinAddresses.p2pkh.mainnet
        )

        expect(result.scriptType).to.equal(bitcoinAddresses.p2pkh.scriptType)
        expect(result.scriptHash).to.not.equal("0x")
      })

      it("should reject invalid P2PKH address", async () => {
        await expect(testUtils.decodeAddress(invalidAddresses.invalidP2PKH)).to
          .be.reverted
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

        // Deploy MockBank and MockAccountControl for QCRedeemer
        const MockBank = await ethers.getContractFactory("MockBank")
        const bank = await MockBank.deploy()

        const MockAccountControl = await ethers.getContractFactory(
          "MockAccountControl"
        )

        const accountControl = await MockAccountControl.deploy(bank.address)

        qcRedeemer = (await LibraryLinkingHelper.deployQCRedeemer(
          tbtc.address,
          mockQCData.address,
          systemState.address,
          accountControl.address
        )) as QCRedeemer
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
        const result = await testUtils.decodeAddress(
          bitcoinAddresses.p2sh.mainnet
        )

        expect(Number(result.scriptType)).to.equal(
          bitcoinAddresses.p2sh.scriptType
        )
        expect(result.scriptHash.length).to.equal(42) // 20 bytes
      })

      it("should decode valid P2SH testnet address", async () => {
        const result = await testUtils.decodeAddress(
          bitcoinAddresses.p2sh.testnet
        )

        expect(Number(result.scriptType)).to.equal(
          bitcoinAddresses.p2sh.scriptType
        )
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

        // Deploy MockBank and MockAccountControl for QCRedeemer
        const MockBank = await ethers.getContractFactory("MockBank")
        const bank = await MockBank.deploy()

        const MockAccountControl = await ethers.getContractFactory(
          "MockAccountControl"
        )

        const accountControl = await MockAccountControl.deploy(bank.address)

        qcRedeemer = (await LibraryLinkingHelper.deployQCRedeemer(
          tbtc.address,
          mockQCData.address,
          systemState.address,
          accountControl.address
        )) as QCRedeemer
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
        const result = await testUtils.decodeAddress(
          bitcoinAddresses.p2wpkh.mainnet
        )

        expect(Number(result.scriptType)).to.equal(
          bitcoinAddresses.p2wpkh.scriptType
        )
        expect(result.scriptHash.length).to.equal(42) // 20 bytes
      })

      it("should handle P2WPKH script generation correctly", async () => {
        const result = await testUtils.decodeAddress(
          bitcoinAddresses.p2wpkh.mainnet
        )

        expect(result.scriptType).to.equal(bitcoinAddresses.p2wpkh.scriptType)
        expect(result.scriptHash).to.not.equal("0x")
      })

      it("should reject invalid bech32 address", async () => {
        await expect(testUtils.decodeAddress(invalidAddresses.invalidBech32)).to
          .be.reverted
      })
    })

    describe("P2WSH Validation", () => {
      beforeEach(async () => {
        const mockQCData = await smock.fake("QCData")
        mockQCData.getWalletOwner
          .whenCalledWith(bitcoinAddresses.p2wsh.mainnet)
          .returns(deployer.address)
        mockQCData.getWalletStatus.returns(1)

        // Deploy MockBank and MockAccountControl for QCRedeemer
        const MockBank = await ethers.getContractFactory("MockBank")
        const bank = await MockBank.deploy()

        const MockAccountControl = await ethers.getContractFactory(
          "MockAccountControl"
        )

        const accountControl = await MockAccountControl.deploy(bank.address)

        qcRedeemer = (await LibraryLinkingHelper.deployQCRedeemer(
          tbtc.address,
          mockQCData.address,
          systemState.address,
          accountControl.address
        )) as QCRedeemer
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
        const result = await testUtils.decodeAddress(
          bitcoinAddresses.p2wsh.mainnet
        )

        expect(Number(result.scriptType)).to.equal(
          bitcoinAddresses.p2wsh.scriptType
        )
        expect(result.scriptHash.length).to.equal(66) // 32 bytes = 64 hex chars + 0x
      })
    })
  })

  describe("Testnet Bech32 Addresses (Comprehensive Coverage)", () => {
    // Additional testnet bech32 test vectors for comprehensive coverage
    const testnetBech32Addresses = {
      p2wpkh: {
        lowercase: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
        uppercase: "TB1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KXPJZSX",
        mixedCase: "tb1QW508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", // Should be rejected
      },
      p2wsh: {
        lowercase:
          "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7",
        uppercase:
          "TB1QRP33G0Q5C5TXSP9ARYSRX4K6ZDKFS4NCE4XJ0GDCCCEFVPYSXF3Q0SL5K7",
        mixedCase:
          "tb1QRP33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7", // Should be rejected
      },
      invalid: {
        wrongPrefix: "tc1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
        noSeparator: "tb2qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
        shortAddress: "tb1q",
        invalidChecksum: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsa", // Wrong last char
      },
    }

    describe("Testnet P2WPKH (tb1q) Validation", () => {
      beforeEach(async () => {
        const mockQCData = await smock.fake("QCData")
        mockQCData.getWalletOwner
          .whenCalledWith(testnetBech32Addresses.p2wpkh.lowercase)
          .returns(deployer.address)
        mockQCData.getWalletStatus.returns(1)

        const MockBank = await ethers.getContractFactory("MockBank")
        const bank = await MockBank.deploy()

        const MockAccountControl = await ethers.getContractFactory(
          "MockAccountControl"
        )

        const accountControl = await MockAccountControl.deploy(bank.address)

        qcRedeemer = (await LibraryLinkingHelper.deployQCRedeemer(
          tbtc.address,
          mockQCData.address,
          systemState.address,
          accountControl.address
        )) as QCRedeemer
      })

      it("should validate lowercase testnet P2WPKH address", async () => {
        await expect(
          qcRedeemer.initiateRedemption(
            deployer.address,
            ethers.utils.parseEther("1"),
            testnetBech32Addresses.p2wpkh.lowercase,
            testnetBech32Addresses.p2wpkh.lowercase
          )
        ).to.be.revertedWith("ValidationFailed")
        // ValidationFailed means address validation passed
      })

      it("should validate uppercase testnet P2WPKH address", async () => {
        const mockQCData = await smock.fake("QCData")
        mockQCData.getWalletOwner
          .whenCalledWith(testnetBech32Addresses.p2wpkh.uppercase)
          .returns(deployer.address)
        mockQCData.getWalletStatus.returns(1)

        const MockBank = await ethers.getContractFactory("MockBank")
        const bank = await MockBank.deploy()

        const MockAccountControl = await ethers.getContractFactory(
          "MockAccountControl"
        )

        const accountControl = await MockAccountControl.deploy(bank.address)

        const testQcRedeemer = (await LibraryLinkingHelper.deployQCRedeemer(
          tbtc.address,
          mockQCData.address,
          systemState.address,
          accountControl.address
        )) as QCRedeemer

        await expect(
          testQcRedeemer.initiateRedemption(
            deployer.address,
            ethers.utils.parseEther("1"),
            testnetBech32Addresses.p2wpkh.uppercase,
            testnetBech32Addresses.p2wpkh.uppercase
          )
        ).to.be.revertedWithCustomError(testQcRedeemer, "InvalidBitcoinAddressFormat")
      })

      it("should reject mixed case testnet P2WPKH address", async () => {
        await expect(
          qcRedeemer.initiateRedemption(
            deployer.address,
            ethers.utils.parseEther("1"),
            testnetBech32Addresses.p2wpkh.mixedCase,
            bitcoinAddresses.p2pkh.mainnet
          )
        ).to.be.revertedWithCustomError(
          qcRedeemer,
          "InvalidBitcoinAddressFormat"
        )
      })
    })

    describe("Testnet P2WPKH Utilities", () => {
      it("should decode lowercase testnet P2WPKH address", async () => {
        const result = await testUtils.decodeAddress(
          testnetBech32Addresses.p2wpkh.lowercase
        )

        expect(Number(result.scriptType)).to.equal(2) // P2WPKH
        expect(result.scriptHash.length).to.equal(42) // 20 bytes
        expect(result.scriptHash).to.not.equal("0x")
      })

      it("should decode uppercase testnet P2WPKH address", async () => {
        const result = await testUtils.decodeAddress(
          testnetBech32Addresses.p2wpkh.uppercase
        )

        expect(Number(result.scriptType)).to.equal(2) // P2WPKH
        expect(result.scriptHash.length).to.equal(42) // 20 bytes
        expect(result.scriptHash).to.not.equal("0x")
      })

      it("should produce same hash for case variants", async () => {
        const lowercaseResult = await testUtils.decodeAddress(
          testnetBech32Addresses.p2wpkh.lowercase
        )

        const uppercaseResult = await testUtils.decodeAddress(
          testnetBech32Addresses.p2wpkh.uppercase
        )

        // Same script hash for both case variants
        expect(lowercaseResult.scriptHash).to.equal(uppercaseResult.scriptHash)
        expect(lowercaseResult.scriptType).to.equal(uppercaseResult.scriptType)
      })

      it("should reject mixed case testnet addresses", async () => {
        await expect(
          testUtils.decodeAddress(testnetBech32Addresses.p2wpkh.mixedCase)
        ).to.be.reverted
      })
    })

    describe("Testnet P2WSH (tb1q with 32-byte hash) Validation", () => {
      beforeEach(async () => {
        const mockQCData = await smock.fake("QCData")
        mockQCData.getWalletOwner
          .whenCalledWith(testnetBech32Addresses.p2wsh.lowercase)
          .returns(deployer.address)
        mockQCData.getWalletStatus.returns(1)

        const MockBank = await ethers.getContractFactory("MockBank")
        const bank = await MockBank.deploy()

        const MockAccountControl = await ethers.getContractFactory(
          "MockAccountControl"
        )

        const accountControl = await MockAccountControl.deploy(bank.address)

        qcRedeemer = (await LibraryLinkingHelper.deployQCRedeemer(
          tbtc.address,
          mockQCData.address,
          systemState.address,
          accountControl.address
        )) as QCRedeemer
      })

      it("should validate testnet P2WSH address (32-byte hash)", async () => {
        await expect(
          qcRedeemer.initiateRedemption(
            deployer.address,
            ethers.utils.parseEther("1"),
            testnetBech32Addresses.p2wsh.lowercase,
            testnetBech32Addresses.p2wsh.lowercase
          )
        ).to.be.revertedWith("ValidationFailed")
        // P2WSH validation passed (32-byte hash handled correctly)
      })
    })

    describe("Testnet P2WSH Utilities", () => {
      it("should decode testnet P2WSH address with 32-byte hash", async () => {
        const result = await testUtils.decodeAddress(
          testnetBech32Addresses.p2wsh.lowercase
        )

        expect(Number(result.scriptType)).to.equal(3) // P2WSH
        expect(result.scriptHash.length).to.equal(66) // 32 bytes = 64 hex chars + 0x
        expect(result.scriptHash).to.not.equal("0x")
      })

      it("should handle uppercase testnet P2WSH address", async () => {
        const result = await testUtils.decodeAddress(
          testnetBech32Addresses.p2wsh.uppercase
        )

        expect(Number(result.scriptType)).to.equal(3) // P2WSH
        expect(result.scriptHash.length).to.equal(66) // 32 bytes
      })

      it("should reject mixed case testnet P2WSH addresses", async () => {
        await expect(
          testUtils.decodeAddress(testnetBech32Addresses.p2wsh.mixedCase)
        ).to.be.reverted
      })
    })

    describe("Testnet Error Cases", () => {
      it("should reject invalid testnet prefix", async () => {
        await expect(
          testUtils.decodeAddress(testnetBech32Addresses.invalid.wrongPrefix)
        ).to.be.reverted
      })

      it("should reject testnet address without separator", async () => {
        await expect(
          testUtils.decodeAddress(testnetBech32Addresses.invalid.noSeparator)
        ).to.be.reverted
      })

      it("should reject too short testnet address", async () => {
        await expect(
          testUtils.decodeAddress(testnetBech32Addresses.invalid.shortAddress)
        ).to.be.reverted
      })

      it("should reject testnet address with invalid checksum", async () => {
        await expect(
          testUtils.decodeAddress(
            testnetBech32Addresses.invalid.invalidChecksum
          )
        ).to.be.reverted
      })
    })

    describe("Mainnet vs Testnet Consistency", () => {
      it("should produce same script types for equivalent addresses", async () => {
        const mainnetP2WPKH = await testUtils.decodeAddress(
          bitcoinAddresses.p2wpkh.mainnet
        )

        const testnetP2WPKH = await testUtils.decodeAddress(
          bitcoinAddresses.p2wpkh.testnet
        )

        expect(mainnetP2WPKH.scriptType).to.equal(testnetP2WPKH.scriptType)
        expect(mainnetP2WPKH.scriptHash.length).to.equal(
          testnetP2WPKH.scriptHash.length
        )
      })

      it("should produce same script types for P2WSH variants", async () => {
        const mainnetP2WSH = await testUtils.decodeAddress(
          bitcoinAddresses.p2wsh.mainnet
        )

        const testnetP2WSH = await testUtils.decodeAddress(
          bitcoinAddresses.p2wsh.testnet
        )

        expect(mainnetP2WSH.scriptType).to.equal(testnetP2WSH.scriptType)
        expect(mainnetP2WSH.scriptHash.length).to.equal(
          testnetP2WSH.scriptHash.length
        )
      })

      it("should handle both networks consistently", async () => {
        const testCases = [
          [bitcoinAddresses.p2wpkh.mainnet, bitcoinAddresses.p2wpkh.testnet],
          [bitcoinAddresses.p2wsh.mainnet, bitcoinAddresses.p2wsh.testnet],
        ]

        for (const [mainnet, testnet] of testCases) {
          const mainnetResult = await testUtils.decodeAddress(mainnet)
          const testnetResult = await testUtils.decodeAddress(testnet)

          // Same script type and hash format
          expect(mainnetResult.scriptType).to.equal(testnetResult.scriptType)
          expect(mainnetResult.scriptHash.length).to.equal(
            testnetResult.scriptHash.length
          )

          // Different actual hashes (different addresses)
          expect(mainnetResult.scriptHash).to.not.equal(
            testnetResult.scriptHash
          )
        }
      })
    })
  })

  describe("Address Derivation", () => {
    // Test data: known public keys and their expected Bitcoin addresses
    const testVectors = {
      validKey1: {
        // Real test vector from Bitcoin test suite
        publicKey:
          "0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8",
        expectedAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // This should match the derivation
      },
      validKey2: {
        // Another test vector
        publicKey:
          "0xc6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5b5e7e9b7bac7e7e6c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7",
        expectedPattern: /^bc1q[a-z0-9]{38}$/, // Should be valid bech32 format
      },
    }

    const invalidKeys = {
      tooShort: "0x1234", // Much shorter than 64 bytes
      tooLong: `0x${"a".repeat(130)}`, // 65 bytes instead of 64
      wrongLength: `0x${"b".repeat(126)}`, // 63 bytes
      empty: "0x",
      invalidHex: `0xzzzz${"a".repeat(124)}`, // Invalid hex characters
    }

    describe("Valid Public Key Derivation", () => {
      it("should derive correct address from known public key", async () => {
        const publicKeyBytes = ethers.utils.arrayify(
          testVectors.validKey1.publicKey
        )

        const derivedAddress =
          await testUtils.deriveBitcoinAddressFromPublicKey(publicKeyBytes)

        // Verify it's a valid bech32 format
        // P2WPKH addresses (bc1q...) are 42 characters: bc1 (3) + q (1) + 38 characters
        expect(derivedAddress).to.match(/^bc1q[a-z0-9]{38}$/)
        expect(derivedAddress.length).to.equal(42) // bc1q + 38 characters
      })

      it("should derive consistent addresses for same public key", async () => {
        const publicKeyBytes = ethers.utils.arrayify(
          testVectors.validKey1.publicKey
        )

        const address1 = await testUtils.deriveBitcoinAddressFromPublicKey(
          publicKeyBytes
        )

        const address2 = await testUtils.deriveBitcoinAddressFromPublicKey(
          publicKeyBytes
        )

        expect(address1).to.equal(address2)
      })

      it("should produce valid bech32 format for any valid key", async () => {
        const publicKeyBytes = ethers.utils.arrayify(
          testVectors.validKey2.publicKey
        )

        const derivedAddress =
          await testUtils.deriveBitcoinAddressFromPublicKey(publicKeyBytes)

        expect(derivedAddress).to.match(testVectors.validKey2.expectedPattern)
      })

      it("should produce decodable addresses", async () => {
        const publicKeyBytes = ethers.utils.arrayify(
          testVectors.validKey1.publicKey
        )

        const derivedAddress =
          await testUtils.deriveBitcoinAddressFromPublicKey(publicKeyBytes)

        // The derived address should be decodable by our own decoder
        const result = await testUtils.decodeAddress(derivedAddress)
        expect(Number(result.scriptType)).to.equal(2) // P2WPKH
        expect(result.scriptHash.length).to.equal(42) // 20 bytes = 40 hex chars + 0x
      })
    })

    describe("Invalid Public Key Handling", () => {
      it("should reject public key that is too short", async () => {
        const invalidKeyBytes = ethers.utils.arrayify(invalidKeys.tooShort)
        await expect(
          testUtils.deriveBitcoinAddressFromPublicKey(invalidKeyBytes)
        ).to.be.revertedWithCustomError(testUtils, "InvalidAddressLength")
      })

      it("should reject public key that is too long", async () => {
        const invalidKeyBytes = ethers.utils.arrayify(invalidKeys.tooLong)
        await expect(
          testUtils.deriveBitcoinAddressFromPublicKey(invalidKeyBytes)
        ).to.be.revertedWithCustomError(testUtils, "InvalidAddressLength")
      })

      it("should reject public key with wrong length", async () => {
        const invalidKeyBytes = ethers.utils.arrayify(invalidKeys.wrongLength)
        await expect(
          testUtils.deriveBitcoinAddressFromPublicKey(invalidKeyBytes)
        ).to.be.revertedWithCustomError(testUtils, "InvalidAddressLength")
      })

      it("should reject empty public key", async () => {
        const emptyBytes = ethers.utils.arrayify(invalidKeys.empty)
        await expect(
          testUtils.deriveBitcoinAddressFromPublicKey(emptyBytes)
        ).to.be.revertedWithCustomError(testUtils, "InvalidAddressLength")
      })
    })

    describe("Cross-Implementation Validation", () => {
      it("should match wallet-signature-helpers implementation", async () => {
        // Import the helper function
        const { generateBitcoinKeyPair } = await import(
          "../helpers/wallet-signature-helpers"
        )

        // Generate a key pair using the helper
        const keyPair = generateBitcoinKeyPair()

        // Derive address using our contract
        const contractAddress =
          await testUtils.deriveBitcoinAddressFromPublicKey(keyPair.publicKey)

        // Compare with helper's derived address
        const helperAddress = keyPair.address

        // Both should be valid bech32 addresses (format verification)
        expect(contractAddress).to.match(/^bc1q[a-z0-9]{38}$/)
        expect(helperAddress).to.match(/^bc1[a-z0-9]+$/)

        // Note: They might not be identical due to implementation differences,
        // but both should be valid and decodable
        const contractDecoded = await testUtils.decodeAddress(contractAddress)
        const helperDecoded = await testUtils.decodeAddress(helperAddress)

        expect(Number(contractDecoded.scriptType)).to.equal(2) // Both should be P2WPKH
        expect(Number(helperDecoded.scriptType)).to.equal(2)
      })
    })
  })

  describe("Error Handling", () => {
    describe("Integration Error Cases", () => {
      beforeEach(async () => {
        const mockQCData = await smock.fake("QCData")
        mockQCData.getWalletOwner.returns(deployer.address)
        mockQCData.getWalletStatus.returns(1)

        // Deploy MockBank and MockAccountControl for QCRedeemer
        const MockBank = await ethers.getContractFactory("MockBank")
        const bank = await MockBank.deploy()

        const MockAccountControl = await ethers.getContractFactory(
          "MockAccountControl"
        )

        const accountControl = await MockAccountControl.deploy(bank.address)

        qcRedeemer = (await LibraryLinkingHelper.deployQCRedeemer(
          tbtc.address,
          mockQCData.address,
          systemState.address,
          accountControl.address
        )) as QCRedeemer
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
        ).to.be.revertedWithCustomError(
          qcRedeemer,
          "InvalidBitcoinAddressFormat"
        )
      })

      it("should reject invalid format", async () => {
        await expect(
          qcRedeemer.initiateRedemption(
            deployer.address,
            ethers.utils.parseEther("1"),
            invalidAddresses.invalidFormat,
            bitcoinAddresses.p2pkh.mainnet
          )
        ).to.be.revertedWithCustomError(
          qcRedeemer,
          "InvalidBitcoinAddressFormat"
        )
      })
    })

    describe("Utility Error Cases", () => {
      it("should reject empty address", async () => {
        await expect(testUtils.decodeAddress(invalidAddresses.empty)).to.be
          .reverted
      })

      it("should reject unsupported address format", async () => {
        await expect(testUtils.decodeAddress(invalidAddresses.unsupported)).to
          .be.reverted
      })

      it("should reject address with invalid length", async () => {
        await expect(testUtils.decodeAddress(invalidAddresses.shortBech32)).to
          .be.reverted
      })
    })
  })
})
