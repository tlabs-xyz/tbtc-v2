import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { smock } from "@defi-wonderland/smock"

import type { QCRedeemer } from "../../typechain"
import { LibraryLinkingHelper } from "../helpers/libraryLinkingHelper"

describe("Bitcoin Address Validation Integration", () => {
  let deployer: SignerWithAddress
  let qcRedeemer: QCRedeemer
  let tbtc: any
  let systemState: any
  let relay: any
  let qcRedeemerSPV: any

  // Test Bitcoin addresses (real mainnet addresses)
  const validP2PKHAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" // Genesis block coinbase
  const validP2SHAddress = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"
  const validP2WPKHAddress = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
  const validP2WSHAddress =
    "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3"

  before(async () => {
    const signers = await ethers.getSigners()
    ;[deployer] = signers

    // Deploy mock dependencies for QCRedeemer
    const MockTBTC = await ethers.getContractFactory("MockTBTCToken")
    tbtc = await MockTBTC.deploy()

    const QCData = await ethers.getContractFactory("QCData")
    const qcData = await QCData.deploy()

    const SystemState = await ethers.getContractFactory("SystemState")
    systemState = await SystemState.deploy()

    // Deploy TestRelay for SPV validation
    const TestRelay = await ethers.getContractFactory("TestRelay")
    relay = await TestRelay.deploy()

    // Deploy all required libraries using the helper
    const libraries = await LibraryLinkingHelper.deployAllLibraries()

    // Deploy QCRedeemerSPV for testing
    const QCRedeemerSPVLib = await ethers.getContractFactory("QCRedeemerSPV", {
      libraries: {
        SharedSPVCore: libraries.SharedSPVCore,
      },
    })
    qcRedeemerSPV = await QCRedeemerSPVLib.deploy()

    // Deploy QCRedeemer using the helper
    qcRedeemer = await LibraryLinkingHelper.deployQCRedeemer(
      tbtc.address,
      qcData.address,
      systemState.address,
      relay.address,
      1, // txProofDifficultyFactor
      libraries
    )
  })

  describe("Real Bitcoin Address Validation", () => {
    beforeEach(async () => {
      // Deploy a mock QCData contract
      const mockQCData = await smock.fake("QCData")

      // Mock wallet registration for the valid addresses
      mockQCData.getWalletOwner.whenCalledWith(validP2PKHAddress).returns(deployer.address)
      mockQCData.getWalletOwner.whenCalledWith(validP2SHAddress).returns(deployer.address)
      mockQCData.getWalletOwner.whenCalledWith(validP2WPKHAddress).returns(deployer.address)
      mockQCData.getWalletOwner.whenCalledWith(validP2WSHAddress).returns(deployer.address)

      // Mock wallet status as active
      mockQCData.getWalletStatus.returns(1) // Active status

      // Deploy new QCRedeemer with mocked QCData using library helper
      qcRedeemer = await LibraryLinkingHelper.deployQCRedeemer(
        tbtc.address,
        mockQCData.address, // Use mocked QCData
        systemState.address,
        relay.address,
        1 // txProofDifficultyFactor
      )
    })

    it("should validate P2PKH address through redemption initiation", async () => {
      // This tests the integrated address validation in QCRedeemer
      // The address validation happens inside initiateRedemption

      // The test will fail at later QC validation, but we can check the error message
      // to confirm Bitcoin address validation passed

      await expect(
        qcRedeemer.initiateRedemption(
          deployer.address, // qc (will fail at later validation)
          ethers.utils.parseEther("1"), // amount
          validP2PKHAddress, // userBtcAddress - this should pass validation
          validP2PKHAddress // qcWalletAddress - reuse same address for simplicity
        )
      ).to.be.revertedWith("ValidationFailed")

      // The fact that we get ValidationFailed (not InvalidBitcoinAddressFormat)
      // means the Bitcoin address validation passed
    })

    it("should validate P2SH address", async () => {
      await expect(
        qcRedeemer.initiateRedemption(
          deployer.address,
          ethers.utils.parseEther("1"),
          validP2SHAddress,
          validP2SHAddress // qcWalletAddress
        )
      ).to.be.revertedWith("ValidationFailed")
      // P2SH validation passed (error is from QC validation, not address)
    })

    it("should validate P2WPKH address", async () => {
      await expect(
        qcRedeemer.initiateRedemption(
          deployer.address,
          ethers.utils.parseEther("1"),
          validP2WPKHAddress,
          validP2WPKHAddress // qcWalletAddress
        )
      ).to.be.revertedWith("ValidationFailed")
      // Bech32 validation passed
    })

    it("should reject invalid Bitcoin address format", async () => {
      await expect(
        qcRedeemer.initiateRedemption(
          deployer.address,
          ethers.utils.parseEther("1"),
          "invalid_address_format",
          validP2PKHAddress // qcWalletAddress (use valid address)
        )
      ).to.be.revertedWith("InvalidBitcoinAddressFormat")
      // Address validation correctly failed
    })

    it("should reject empty Bitcoin address", async () => {
      await expect(
        qcRedeemer.initiateRedemption(
          deployer.address,
          ethers.utils.parseEther("1"),
          "",
          validP2PKHAddress // qcWalletAddress
        )
      ).to.be.revertedWith("BitcoinAddressRequired")
    })

    it("should reject address with wrong prefix", async () => {
      await expect(
        qcRedeemer.initiateRedemption(
          deployer.address,
          ethers.utils.parseEther("1"),
          "xyz123invalid", // Wrong prefix
          validP2PKHAddress // qcWalletAddress
        )
      ).to.be.revertedWith("InvalidBitcoinAddressFormat")
    })
  })

  describe("Address Decoding Integration", () => {
    it("should handle P2WSH addresses (32-byte hashes)", async () => {
      // P2WSH addresses have 32-byte script hashes vs 20-byte for others
      await expect(
        qcRedeemer.initiateRedemption(
          deployer.address,
          ethers.utils.parseEther("1"),
          validP2WSHAddress,
          validP2WSHAddress // qcWalletAddress
        )
      ).to.be.revertedWith("ValidationFailed")
      // P2WSH validation passed (32-byte hash handled correctly)
    })
  })
})
