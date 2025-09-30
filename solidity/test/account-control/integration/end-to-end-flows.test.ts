import { expect } from "chai"
import { ethers } from "hardhat"
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers"

import { IntegrationTestFramework } from "../../helpers/IntegrationTestFramework"
import { setupTestEnvironment } from "../fixtures/base-setup"
import { deployQCManagerLib, getQCManagerLibraries } from "../helpers/spv-helpers"

/**
 * End-to-End Integration Flow Tests
 *
 * Tests complete user journeys through the AccountControl system,
 * including QCMinter, QCRedeemer, and QCManager integration flows.
 *
 * Consolidated from:
 * - AccountControlIntegration.test.ts (QCMinter/QCRedeemer Integration, End-to-End Workflow)
 * - QCManagerAccountControlIntegration.test.ts (Reserve Authorization, State Consistency)
 * - AccountControlIntegrationSimple.test.ts (Basic integration verification)
 */
describe("End-to-End Integration Flow Tests", function () {
  let framework: IntegrationTestFramework
  let owner: HardhatEthersSigner
  let emergencyCouncil: HardhatEthersSigner
  let user: HardhatEthersSigner
  let qcAddress: HardhatEthersSigner
  let qcAddress2: HardhatEthersSigner

  beforeEach(async function () {
    framework = new IntegrationTestFramework()
    await framework.deploySystem()

    owner = framework.signers.owner
    emergencyCouncil = framework.signers.emergencyCouncil
    user = framework.signers.user
    qcAddress = framework.signers.qcAddress
    qcAddress2 = framework.signers.attester1 // Use as second QC
  })

  describe("Basic Integration Verification", function () {
    it("should verify system deployment and basic connectivity", async function () {
      expect(owner.address).to.be.a("string")
      expect(framework.contracts.accountControl.address).to.be.a("string")
      expect(framework.contracts.qcMinter.address).to.be.a("string")
      expect(framework.contracts.qcRedeemer.address).to.be.a("string")

      // Verify contracts are properly connected
      const accountControlAddress = await framework.contracts.qcMinter.accountControl()
      expect(accountControlAddress).to.equal(framework.contracts.accountControl.address)

      // Basic integration verification passed
    })
  })

  describe("QCManager - AccountControl Integration Flows", function () {
    it("should complete QC registration with AccountControl authorization", async function () {
      // Enable AccountControl mode
      await framework.enableAccountControlMode()

      // Register QC through QCManager - should automatically authorize in AccountControl
      const backing = framework.QC_BACKING_AMOUNT
      const mintingCap = framework.QC_MINTING_CAP

      const tx = await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress.address,
        backing,
        mintingCap
      )

      await expect(tx).to.emit(framework.contracts.qcManager, "QCOnboarded")
      await expect(tx).to.emit(framework.contracts.accountControl, "ReserveAuthorized")
        .withArgs(qcAddress.address, mintingCap)

      // Verify QC is authorized in AccountControl
      const isAuthorized = await framework.contracts.accountControl.isReserveAuthorized(qcAddress.address)
      expect(isAuthorized).to.be.true

      // Verify minting cap is set correctly
      const actualCap = await framework.contracts.accountControl.mintingCaps(qcAddress.address)
      expect(actualCap).to.equal(mintingCap)
    })

    it("should handle minting capacity updates through QCManager", async function () {
      // Enable AccountControl mode and register QC
      await framework.enableAccountControlMode()
      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress.address,
        framework.QC_BACKING_AMOUNT,
        framework.QC_MINTING_CAP
      )

      // Increase minting cap through QCManager
      const newCap = framework.QC_MINTING_CAP.mul(2)
      const tx = await framework.contracts.qcManager.connect(owner).increaseMintingCapacity(
        qcAddress.address,
        newCap.sub(framework.QC_MINTING_CAP)
      )

      // Should update AccountControl as well
      const updatedCap = await framework.contracts.accountControl.mintingCaps(qcAddress.address)
      expect(updatedCap).to.equal(newCap)
    })
  })

  describe("QCMinter Integration Flows", function () {
    beforeEach(async function () {
      // Setup QC with backing and minting cap
      await framework.enableAccountControlMode()
      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress.address,
        framework.QC_BACKING_AMOUNT,
        framework.QC_MINTING_CAP
      )
    })

    it("should route minting through AccountControl when enabled", async function () {
      const mintAmount = framework.MINT_AMOUNT

      const tx = await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        mintAmount
      )

      const receipt = await tx.wait()

      // Verify minting was routed through AccountControl
      await expect(tx).to.emit(framework.contracts.qcMinter, "QCMintRequested")
      await expect(tx).to.emit(framework.contracts.accountControl, "MintExecuted")
        .withArgs(qcAddress.address, user.address, mintAmount)

      // Verify balances updated correctly
      const userBalance = await framework.contracts.mockBank.balances(user.address)
      expect(userBalance).to.equal(mintAmount)

      // Verify AccountControl tracking
      const totalMinted = await framework.contracts.accountControl.totalMinted()
      const reserveMinted = await framework.contracts.accountControl.reserveMinted(qcAddress.address)
      expect(totalMinted).to.equal(mintAmount)
      expect(reserveMinted).to.equal(mintAmount)
    })

    it("should enforce AccountControl backing invariant", async function () {
      const mintAmount = framework.QC_MINTING_CAP.add(ethers.utils.parseEther("0.001"))

      // Attempt to mint more than cap
      await expect(
        framework.contracts.qcMinter.connect(owner).requestQCMint(
          qcAddress.address,
          user.address,
          mintAmount
        )
      ).to.be.revertedWith("Minting cap exceeded")
    })

    it("should enforce AccountControl minting cap", async function () {
      // Mint up to the cap
      const firstMint = framework.MINT_AMOUNT
      await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        firstMint
      )

      // Try to exceed cap with second mint
      const secondMint = framework.QC_MINTING_CAP.sub(firstMint).add(1)

      await expect(
        framework.contracts.qcMinter.connect(owner).requestQCMint(
          qcAddress.address,
          user.address,
          secondMint
        )
      ).to.be.revertedWith("Minting cap exceeded")
    })
  })

  describe("QCRedeemer Integration Flows", function () {
    beforeEach(async function () {
      // Setup QC and perform initial mint
      await framework.enableAccountControlMode()
      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress.address,
        framework.QC_BACKING_AMOUNT,
        framework.QC_MINTING_CAP
      )

      await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        framework.MINT_AMOUNT
      )
    })

    it("should notify AccountControl of redemption when enabled", async function () {
      const redeemAmount = framework.MINT_AMOUNT.div(2)

      // Mock SPV proof for redemption
      const spvProof = {
        merkleProof: "0x",
        txIndexInBlock: 0,
        bitcoinHeaders: "0x"
      }

      const tx = await framework.contracts.qcRedeemer.connect(qcAddress).requestRedemption(
        user.address,
        redeemAmount,
        spvProof
      )

      await expect(tx).to.emit(framework.contracts.qcRedeemer, "RedemptionRequested")
      await expect(tx).to.emit(framework.contracts.accountControl, "RedemptionExecuted")
        .withArgs(qcAddress.address, user.address, redeemAmount)

      // Verify AccountControl state updated
      const totalMinted = await framework.contracts.accountControl.totalMinted()
      const reserveMinted = await framework.contracts.accountControl.reserveMinted(qcAddress.address)
      const expectedRemaining = framework.MINT_AMOUNT.sub(redeemAmount)

      expect(totalMinted).to.equal(expectedRemaining)
      expect(reserveMinted).to.equal(expectedRemaining)
    })

    it("should prevent over-redemption in AccountControl mode", async function () {
      const excessiveRedeemAmount = framework.MINT_AMOUNT.add(ethers.utils.parseEther("0.001"))

      const spvProof = {
        merkleProof: "0x",
        txIndexInBlock: 0,
        bitcoinHeaders: "0x"
      }

      await expect(
        framework.contracts.qcRedeemer.connect(qcAddress).requestRedemption(
          user.address,
          excessiveRedeemAmount,
          spvProof
        )
      ).to.be.revertedWith("Insufficient minted amount for redemption")
    })
  })

  describe("Complete End-to-End Workflow", function () {
    it("should complete full mint-redeem cycle with proper state management", async function () {
      // Enable AccountControl mode
      await framework.enableAccountControlMode()

      // 1. Register QC through QCManager
      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress.address,
        framework.QC_BACKING_AMOUNT,
        framework.QC_MINTING_CAP
      )

      // 2. Execute mint through QCMinter
      const mintAmount = framework.MINT_AMOUNT
      let tx = await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        mintAmount
      )
      let receipt = await tx.wait()

      // Verify mint state
      let userBalance = await framework.contracts.mockBank.balances(user.address)
      let totalMinted = await framework.contracts.accountControl.totalMinted()
      let reserveMinted = await framework.contracts.accountControl.reserveMinted(qcAddress.address)

      expect(userBalance).to.equal(mintAmount)
      expect(totalMinted).to.equal(mintAmount)
      expect(reserveMinted).to.equal(mintAmount)

      // 3. Execute partial redemption through QCRedeemer
      const redeemAmount = mintAmount.div(2)
      const spvProof = {
        merkleProof: "0x",
        txIndexInBlock: 0,
        bitcoinHeaders: "0x"
      }

      tx = await framework.contracts.qcRedeemer.connect(qcAddress).requestRedemption(
        user.address,
        redeemAmount,
        spvProof
      )
      receipt = await tx.wait()

      // Verify redemption state
      userBalance = await framework.contracts.mockBank.balances(user.address)
      totalMinted = await framework.contracts.accountControl.totalMinted()
      reserveMinted = await framework.contracts.accountControl.reserveMinted(qcAddress.address)
      const expectedRemaining = mintAmount.sub(redeemAmount)

      expect(userBalance).to.equal(expectedRemaining)
      expect(totalMinted).to.equal(expectedRemaining)
      expect(reserveMinted).to.equal(expectedRemaining)

      // 4. Execute final redemption
      tx = await framework.contracts.qcRedeemer.connect(qcAddress).requestRedemption(
        user.address,
        expectedRemaining,
        spvProof
      )

      // Verify final state - all minted tokens redeemed
      userBalance = await framework.contracts.mockBank.balances(user.address)
      totalMinted = await framework.contracts.accountControl.totalMinted()
      reserveMinted = await framework.contracts.accountControl.reserveMinted(qcAddress.address)

      expect(userBalance).to.equal(0)
      expect(totalMinted).to.equal(0)
      expect(reserveMinted).to.equal(0)
    })

    it("should handle multiple QCs operating simultaneously", async function () {
      // Enable AccountControl mode
      await framework.enableAccountControlMode()

      // Register two QCs
      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress.address,
        framework.QC_BACKING_AMOUNT,
        framework.QC_MINTING_CAP
      )

      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress2.address,
        framework.QC_BACKING_AMOUNT,
        framework.QC_MINTING_CAP
      )

      // Execute concurrent minting from both QCs
      const mintAmount = framework.MINT_AMOUNT
      const tx1 = await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        mintAmount
      )

      const tx2 = await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress2.address,
        user.address,
        mintAmount
      )

      let receipt1 = await tx1.wait()
      let receipt2 = await tx2.wait()

      // Verify independent tracking
      const totalMinted = await framework.contracts.accountControl.totalMinted()
      const reserve1Minted = await framework.contracts.accountControl.reserveMinted(qcAddress.address)
      const reserve2Minted = await framework.contracts.accountControl.reserveMinted(qcAddress2.address)
      const userBalance = await framework.contracts.mockBank.balances(user.address)

      expect(totalMinted).to.equal(mintAmount.mul(2))
      expect(reserve1Minted).to.equal(mintAmount)
      expect(reserve2Minted).to.equal(mintAmount)
      expect(userBalance).to.equal(mintAmount.mul(2))
    })
  })

  describe("AccountControl Mode Toggle Scenarios", function () {
    it("should handle AccountControl mode toggling mid-operation", async function () {
      // Start with AccountControl disabled
      await framework.disableAccountControlMode()

      // Register QC (should work without AccountControl)
      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress.address,
        framework.QC_BACKING_AMOUNT,
        framework.QC_MINTING_CAP
      )

      // Mint with AccountControl disabled
      let tx = await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        framework.MINT_AMOUNT
      )
      let receipt = await tx.wait()

      // AccountControl should not track this mint
      let totalMinted = await framework.contracts.accountControl.totalMinted()
      expect(totalMinted).to.equal(0)

      // Enable AccountControl mode
      await framework.enableAccountControlMode()

      // Subsequent mints should be tracked
      tx = await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        framework.MINT_AMOUNT
      )
      receipt = await tx.wait()

      // This mint should be tracked
      totalMinted = await framework.contracts.accountControl.totalMinted()
      expect(totalMinted).to.equal(framework.MINT_AMOUNT)
    })
  })

  describe("Integration State Consistency", function () {
    it("should maintain consistent state between QCManager and AccountControl", async function () {
      await framework.enableAccountControlMode()

      // Register multiple QCs with different caps
      const qc1Cap = framework.QC_MINTING_CAP
      const qc2Cap = framework.QC_MINTING_CAP.mul(2)

      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress.address,
        framework.QC_BACKING_AMOUNT,
        qc1Cap
      )

      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress2.address,
        framework.QC_BACKING_AMOUNT.mul(2),
        qc2Cap
      )

      // Verify caps are consistent
      const ac1Cap = await framework.contracts.accountControl.mintingCaps(qcAddress.address)
      const ac2Cap = await framework.contracts.accountControl.mintingCaps(qcAddress2.address)

      expect(ac1Cap).to.equal(qc1Cap)
      expect(ac2Cap).to.equal(qc2Cap)

      // Verify authorization status
      const isAuth1 = await framework.contracts.accountControl.isReserveAuthorized(qcAddress.address)
      const isAuth2 = await framework.contracts.accountControl.isReserveAuthorized(qcAddress2.address)

      expect(isAuth1).to.be.true
      expect(isAuth2).to.be.true
    })

    it("should handle AccountControl address changes properly", async function () {
      await framework.enableAccountControlMode()

      // Get initial AccountControl address
      const initialAddress = await framework.contracts.qcManager.accountControl()
      expect(initialAddress).to.equal(framework.contracts.accountControl.address)

      // Deploy new AccountControl instance
      const AccountControlFactory = await ethers.getContractFactory("AccountControl")
      const newAccountControl = await AccountControlFactory.deploy()
      await newAccountControl.initialize(
        owner.address,
        emergencyCouncil.address,
        framework.contracts.mockBank.address
      )

      // Update AccountControl address in QCManager
      const tx = await framework.contracts.qcManager.connect(owner).setAccountControl(newAccountControl.address)

      await expect(tx).to.emit(framework.contracts.qcManager, "AccountControlUpdated")
        .withArgs(framework.contracts.accountControl.address, newAccountControl.address)

      // Verify address updated
      const updatedAddress = await framework.contracts.qcManager.accountControl()
      expect(updatedAddress).to.equal(newAccountControl.address)
    })
  })
})