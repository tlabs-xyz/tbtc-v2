import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

import type { QCRedeemer } from "../../typechain"

describe("Bitcoin Address Validation Integration", () => {
  let deployer: SignerWithAddress
  let qcRedeemer: QCRedeemer

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
    const mockTBTC = await MockTBTC.deploy()

    const QCData = await ethers.getContractFactory("QCData")
    const qcData = await QCData.deploy()

    const SystemState = await ethers.getContractFactory("SystemState")
    const systemState = await SystemState.deploy()

    // Deploy TestRelay for SPV validation
    const TestRelay = await ethers.getContractFactory("TestRelay")
    const testRelay = await TestRelay.deploy()

    // Deploy SPV libraries for QCRedeemer
    const SharedSPVCoreLib = await ethers.getContractFactory("SharedSPVCore")
    const sharedSPVCoreLib = await SharedSPVCoreLib.deploy()

    const QCRedeemerSPVLib = await ethers.getContractFactory("QCRedeemerSPV", {
      libraries: {
        SharedSPVCore: sharedSPVCoreLib.address,
      },
    })
    const qcRedeemerSPVLib = await QCRedeemerSPVLib.deploy()

    // Deploy QCRedeemer with BitcoinAddressUtils integration and SPV library linking
    const QCRedeemer = await ethers.getContractFactory("QCRedeemer", {
      libraries: {
        QCRedeemerSPV: qcRedeemerSPVLib.address,
      },
    })
    qcRedeemer = await QCRedeemer.deploy(
      mockTBTC.address,
      qcData.address,
      systemState.address,
      testRelay.address, // relay for SPV validation
      1 // txProofDifficultyFactor
    )
  })

  describe("Real Bitcoin Address Validation", () => {
    it("should validate P2PKH address through redemption initiation", async () => {
      // This tests the integrated address validation in QCRedeemer
      // The address validation happens inside initiateRedemption

      // First set up a valid QC in the system
      // (This would normally be done through QCManager registration)
      // For this test, we'll verify the address validation occurs

      // The test will fail at QC validation, but we can check the error message
      // to confirm Bitcoin address validation passed

      await expect(
        qcRedeemer.initiateRedemption(
          deployer.address, // qc (will fail QC validation)
          ethers.utils.parseEther("1"), // amount
          validP2PKHAddress // userBtcAddress - this should pass validation
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
          validP2SHAddress
        )
      ).to.be.revertedWith("ValidationFailed")
      // P2SH validation passed (error is from QC validation, not address)
    })

    it("should validate P2WPKH address", async () => {
      await expect(
        qcRedeemer.initiateRedemption(
          deployer.address,
          ethers.utils.parseEther("1"),
          validP2WPKHAddress
        )
      ).to.be.revertedWith("ValidationFailed")
      // Bech32 validation passed
    })

    it("should reject invalid Bitcoin address format", async () => {
      await expect(
        qcRedeemer.initiateRedemption(
          deployer.address,
          ethers.utils.parseEther("1"),
          "invalid_address_format"
        )
      ).to.be.revertedWith("InvalidBitcoinAddressFormat")
      // Address validation correctly failed
    })

    it("should reject empty Bitcoin address", async () => {
      await expect(
        qcRedeemer.initiateRedemption(
          deployer.address,
          ethers.utils.parseEther("1"),
          ""
        )
      ).to.be.revertedWith("BitcoinAddressRequired")
    })

    it("should reject address with wrong prefix", async () => {
      await expect(
        qcRedeemer.initiateRedemption(
          deployer.address,
          ethers.utils.parseEther("1"),
          "xyz123invalid" // Wrong prefix
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
          validP2WSHAddress
        )
      ).to.be.revertedWith("ValidationFailed")
      // P2WSH validation passed (32-byte hash handled correctly)
    })
  })
})
