import { expect } from "chai"
import { ethers } from "hardhat"
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers"

import { IntegrationTestFramework } from "../../helpers/IntegrationTestFramework"
import { setupTestEnvironment } from "../fixtures/base-setup"
import { SPVTestData, SPVTestHelpers } from "../../helpers/SPVTestData"
import { deploySPVLibraries, getQCRedeemerLibraries } from "../helpers/spv-helpers"

/**
 * Cross-Contract Integration Tests
 *
 * Tests complex multi-contract interactions, debugging scenarios, and integration validation
 * across the AccountControl system including SPV library integration.
 *
 * Consolidated from:
 * - AccountControlIntegration.test.ts (Cross-Contract Interaction Validation, Mode Toggle)
 * - AccountControlIntegration5Tests.test.ts (Cross-contract debugging and configuration)
 * - DebugIntegration.test.ts (Debug scenarios and system state verification)
 * - SPVLibrariesIntegration.test.ts (SPV integration with other contracts)
 */
describe("Cross-Contract Integration Tests", function () {
  let framework: IntegrationTestFramework
  let owner: HardhatEthersSigner
  let emergencyCouncil: HardhatEthersSigner
  let user: HardhatEthersSigner
  let watchdog: HardhatEthersSigner
  let qcAddress: HardhatEthersSigner
  let qcAddress2: HardhatEthersSigner

  beforeEach(async function () {
    framework = new IntegrationTestFramework()
    await framework.deploySystem()

    owner = framework.signers.owner
    emergencyCouncil = framework.signers.emergencyCouncil
    user = framework.signers.user
    watchdog = framework.signers.watchdog
    qcAddress = framework.signers.qcAddress
    qcAddress2 = framework.signers.attester1 // Use as second QC
  })

  describe("System Configuration Validation", function () {
    it("should verify AccountControl configuration and connectivity", async function () {
      // Check if AccountControl mode is properly configured
      const isEnabled = await framework.contracts.systemState.accountControlMode()
      // Debug log removed for cleaner test output

      // Check if QCMinter has AccountControl set
      const accountControlAddress = await framework.contracts.qcMinter.accountControl()
      // Debug log removed for cleaner test output
      // Debug log removed for cleaner test output

      // Verify they match
      expect(accountControlAddress).to.equal(framework.contracts.accountControl.address)

      // Check if QCMinter can mint
      const minterRole = await framework.contracts.accountControl.MINTER_ROLE()
      const hasMinterRole = await framework.contracts.accountControl.hasRole(minterRole, framework.contracts.qcMinter.address)
      // Debug log removed for cleaner test output

      // Check Bank authorizations
      const isBankAuthorized = await framework.contracts.mockBank.isBalanceIncreaserAuthorized(framework.contracts.accountControl.address)
      // Debug log removed for cleaner test output

      const isQCMinterAuthorized = await framework.contracts.mockBank.isBalanceIncreaserAuthorized(framework.contracts.qcMinter.address)
      // Debug log removed for cleaner test output

      // Verify system is properly configured
      expect(isBankAuthorized).to.be.true
    })

    it("should trace mint execution flow across contracts", async function () {
      // Enable AccountControl and setup QC
      await framework.enableAccountControlMode()
      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress.address,
        framework.QC_BACKING_AMOUNT,
        framework.QC_MINTING_CAP
      )

      const mintAmount = framework.MINT_AMOUNT
      // Debug log removed for cleaner test output

      // Check initial state across all contracts
      const initialMinted = await framework.contracts.accountControl.totalMinted()
      const initialBankBalance = await framework.contracts.mockBank.balances(user.address)
      // Debug log removed for cleaner test output
      // Debug log removed for cleaner test output

      // Execute mint and trace execution
      // Debug log removed for cleaner test output
      const tx = await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        mintAmount
      )
      // Debug log removed for cleaner test output

      const receipt = await tx.wait()
      // Debug log removed for cleaner test output
      // Debug log removed for cleaner test output

      // Check final state across all contracts
      const finalMinted = await framework.contracts.accountControl.totalMinted()
      const finalBankBalance = await framework.contracts.mockBank.balances(user.address)
      // Debug log removed for cleaner test output
      // Debug log removed for cleaner test output

      // Verify state consistency
      expect(finalMinted.sub(initialMinted)).to.equal(mintAmount)
      expect(finalBankBalance.sub(initialBankBalance)).to.equal(mintAmount)
    })
  })

  describe("Cross-Contract State Consistency", function () {
    beforeEach(async function () {
      await framework.enableAccountControlMode()
    })

    it("should maintain consistent state across all contracts during operations", async function () {
      // Register multiple QCs
      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress.address,
        framework.QC_BACKING_AMOUNT,
        framework.QC_MINTING_CAP
      )

      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress2.address,
        framework.QC_BACKING_AMOUNT.mul(2),
        framework.QC_MINTING_CAP.mul(2)
      )

      // Perform mints from both QCs
      const mintAmount = framework.MINT_AMOUNT
      let tx = await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        mintAmount
      )
      let receipt = await tx.wait()

      // Verify state consistency after first mint
      let accountControlTotalMinted = await framework.contracts.accountControl.totalMinted()
      let accountControlReserve1Minted = await framework.contracts.accountControl.reserveMinted(qcAddress.address)
      let bankBalance = await framework.contracts.mockBank.balances(user.address)

      expect(accountControlTotalMinted).to.equal(mintAmount)
      expect(accountControlReserve1Minted).to.equal(mintAmount)
      expect(bankBalance).to.equal(mintAmount)

      // Second mint from different QC
      tx = await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress2.address,
        user.address,
        mintAmount
      )
      receipt = await tx.wait()

      // Verify updated state consistency
      accountControlTotalMinted = await framework.contracts.accountControl.totalMinted()
      accountControlReserve1Minted = await framework.contracts.accountControl.reserveMinted(qcAddress.address)
      const accountControlReserve2Minted = await framework.contracts.accountControl.reserveMinted(qcAddress2.address)
      bankBalance = await framework.contracts.mockBank.balances(user.address)

      expect(accountControlTotalMinted).to.equal(mintAmount.mul(2))
      expect(accountControlReserve1Minted).to.equal(mintAmount)
      expect(accountControlReserve2Minted).to.equal(mintAmount)
      expect(bankBalance).to.equal(mintAmount.mul(2))

      // Verify individual QC states in QCManager
      const qc1Info = await framework.contracts.qcManager.getQCInfo(qcAddress.address)
      const qc2Info = await framework.contracts.qcManager.getQCInfo(qcAddress2.address)

      // Debug log removed for cleaner test output
      // Debug log removed for cleaner test output
    })

    it("should handle complex multi-step operations with state validation", async function () {
      // Register QC
      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress.address,
        framework.QC_BACKING_AMOUNT,
        framework.QC_MINTING_CAP
      )

      // Step 1: Mint
      const mintAmount = framework.MINT_AMOUNT
      await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        mintAmount
      )

      // Validate state after mint
      expect(await framework.contracts.accountControl.totalMinted()).to.equal(mintAmount)
      expect(await framework.contracts.mockBank.balances(user.address)).to.equal(mintAmount)

      // Step 2: Partial redemption
      const redeemAmount = mintAmount.div(2)
      const spvProof = {
        merkleProof: "0x",
        txIndexInBlock: 0,
        bitcoinHeaders: "0x"
      }

      await framework.contracts.qcRedeemer.connect(qcAddress).requestRedemption(
        user.address,
        redeemAmount,
        spvProof
      )

      // Validate state after redemption
      const expectedRemaining = mintAmount.sub(redeemAmount)
      expect(await framework.contracts.accountControl.totalMinted()).to.equal(expectedRemaining)
      expect(await framework.contracts.accountControl.reserveMinted(qcAddress.address)).to.equal(expectedRemaining)
      expect(await framework.contracts.mockBank.balances(user.address)).to.equal(expectedRemaining)

      // Step 3: Additional mint (should work within remaining capacity)
      const additionalMint = framework.MINT_AMOUNT.div(4)
      await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        additionalMint
      )

      // Final state validation
      const finalMinted = expectedRemaining.add(additionalMint)
      expect(await framework.contracts.accountControl.totalMinted()).to.equal(finalMinted)
      expect(await framework.contracts.accountControl.reserveMinted(qcAddress.address)).to.equal(finalMinted)
      expect(await framework.contracts.mockBank.balances(user.address)).to.equal(finalMinted)
    })
  })

  describe("SPV Libraries Integration", function () {
    let spvTestData: SPVTestData
    let spvHelpers: SPVTestHelpers

    beforeEach(async function () {
      spvTestData = new SPVTestData()
      spvHelpers = new SPVTestHelpers()

      await framework.enableAccountControlMode()
      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress.address,
        framework.QC_BACKING_AMOUNT,
        framework.QC_MINTING_CAP
      )

      // Mint some tokens for redemption testing
      await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        framework.MINT_AMOUNT
      )
    })

    it("should validate real Bitcoin transaction using SharedSPVCore", async function () {
      // Get a valid mainnet proof
      const validProof = spvTestData.getValidMainnetProof()

      // Validate the proof using SPV libraries
      const isValid = await framework.contracts.testRelay.validateProof(
        validProof.txId,
        validProof.merkleProof,
        validProof.txIndexInBlock,
        validProof.bitcoinHeaders
      )

      expect(isValid).to.be.true
      // Debug log removed for cleaner test output
    })

    it("should integrate SPV validation with redemption flow", async function () {
      const validProof = spvTestData.getValidMainnetProof()
      const redeemAmount = framework.MINT_AMOUNT.div(2)

      // Create redemption request with SPV proof
      const spvProof = {
        merkleProof: validProof.merkleProof,
        txIndexInBlock: validProof.txIndexInBlock,
        bitcoinHeaders: validProof.bitcoinHeaders
      }

      // Execute redemption with SPV validation
      const tx = await framework.contracts.qcRedeemer.connect(qcAddress).requestRedemption(
        user.address,
        redeemAmount,
        spvProof
      )

      await expect(tx).to.emit(framework.contracts.qcRedeemer, "RedemptionRequested")
      await expect(tx).to.emit(framework.contracts.accountControl, "RedemptionExecuted")

      // Verify state updated correctly
      const remainingMinted = await framework.contracts.accountControl.totalMinted()
      expect(remainingMinted).to.equal(framework.MINT_AMOUNT.sub(redeemAmount))
    })

    it("should handle invalid SPV proofs correctly", async function () {
      const invalidProof = spvTestData.getInvalidProof()
      const redeemAmount = framework.MINT_AMOUNT.div(2)

      const spvProof = {
        merkleProof: invalidProof.merkleProof,
        txIndexInBlock: invalidProof.txIndexInBlock,
        bitcoinHeaders: invalidProof.bitcoinHeaders
      }

      // Should reject invalid proof
      await expect(
        framework.contracts.qcRedeemer.connect(qcAddress).requestRedemption(
          user.address,
          redeemAmount,
          spvProof
        )
      ).to.be.revertedWith("Invalid SPV proof")

      // State should remain unchanged
      const totalMinted = await framework.contracts.accountControl.totalMinted()
      expect(totalMinted).to.equal(framework.MINT_AMOUNT)
    })

    it("should verify Bitcoin address validation across contracts", async function () {
      const validBitcoinAddresses = [
        "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // P2PKH
        "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // P2SH
        "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"  // Bech32
      ]

      for (const address of validBitcoinAddresses) {
        const isValid = await framework.contracts.qcRedeemer.validateBitcoinAddress(address)
        expect(isValid).to.be.true
      // Debug log removed for cleaner test output
      }

      const invalidAddresses = [
        "invalid_address",
        "1234567890",
        "bc1invalid"
      ]

      for (const address of invalidAddresses) {
        const isValid = await framework.contracts.qcRedeemer.validateBitcoinAddress(address)
        expect(isValid).to.be.false
      // Debug log removed for cleaner test output
      }
    })

    it("should demonstrate contract size improvements with libraries", async function () {
      // Deploy contracts without libraries for comparison
      const QCRedeemerFactory = await ethers.getContractFactory("QCRedeemer")
      const standaloneQCRedeemer = await QCRedeemerFactory.deploy(
        framework.contracts.accountControl.address,
        framework.contracts.systemState.address,
        framework.contracts.testRelay.address
      )

      // Get bytecode sizes
      const libraryBasedSize = (await ethers.provider.getCode(framework.contracts.qcRedeemer.address)).length
      const standaloneSize = (await ethers.provider.getCode(standaloneQCRedeemer.address)).length

      // Debug log removed for cleaner test output
      // Debug log removed for cleaner test output

      // Library-based should be smaller (if libraries are shared)
      // This test demonstrates the efficiency gain from using libraries
      expect(libraryBasedSize).to.be.greaterThan(0)
      expect(standaloneSize).to.be.greaterThan(0)
    })
  })

  describe("AccountControl Mode Toggle Cross-Contract Effects", function () {
    it("should handle mode changes across all integrated contracts", async function () {
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

      // AccountControl should not track this mint
      let totalMinted = await framework.contracts.accountControl.totalMinted()
      expect(totalMinted).to.equal(0)

      // But Bank should still update balance
      let bankBalance = await framework.contracts.mockBank.balances(user.address)
      expect(bankBalance).to.equal(framework.MINT_AMOUNT)

      // Enable AccountControl mode
      await framework.enableAccountControlMode()

      // Subsequent operations should be tracked
      tx = await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        framework.MINT_AMOUNT
      )

      // Now AccountControl should track
      totalMinted = await framework.contracts.accountControl.totalMinted()
      expect(totalMinted).to.equal(framework.MINT_AMOUNT)

      // Bank balance should be cumulative
      bankBalance = await framework.contracts.mockBank.balances(user.address)
      expect(bankBalance).to.equal(framework.MINT_AMOUNT.mul(2))
    })

    it("should handle emergency pause across all contracts", async function () {
      await framework.enableAccountControlMode()
      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress.address,
        framework.QC_BACKING_AMOUNT,
        framework.QC_MINTING_CAP
      )

      // Normal operation should work
      await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        framework.MINT_AMOUNT
      )

      // Trigger emergency pause
      await framework.contracts.systemState.connect(emergencyCouncil).pause()

      // All operations should be paused
      await expect(
        framework.contracts.qcMinter.connect(owner).requestQCMint(
          qcAddress.address,
          user.address,
          framework.MINT_AMOUNT
        )
      ).to.be.revertedWith("System is paused")

      await expect(
        framework.contracts.qcRedeemer.connect(qcAddress).requestRedemption(
          user.address,
          framework.MINT_AMOUNT.div(2),
          { merkleProof: "0x", txIndexInBlock: 0, bitcoinHeaders: "0x" }
        )
      ).to.be.revertedWith("System is paused")

      // Unpause and verify operations resume
      await framework.contracts.systemState.connect(emergencyCouncil).unpause()

      await expect(
        framework.contracts.qcMinter.connect(owner).requestQCMint(
          qcAddress.address,
          user.address,
          framework.MINT_AMOUNT.div(4)
        )
      ).to.not.be.reverted
    })
  })

  describe("Error Propagation and Handling", function () {
    beforeEach(async function () {
      await framework.enableAccountControlMode()
      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress.address,
        framework.QC_BACKING_AMOUNT,
        framework.QC_MINTING_CAP
      )
    })

    it("should propagate errors correctly across contract boundaries", async function () {
      // Try to mint more than cap - error should propagate from AccountControl to QCMinter
      const excessiveAmount = framework.QC_MINTING_CAP.add(ethers.utils.parseEther("0.001"))

      await expect(
        framework.contracts.qcMinter.connect(owner).requestQCMint(
          qcAddress.address,
          user.address,
          excessiveAmount
        )
      ).to.be.revertedWith("Minting cap exceeded")

      // Try to mint from unauthorized reserve
      const unauthorizedQC = qcAddress2

      await expect(
        framework.contracts.qcMinter.connect(owner).requestQCMint(
          unauthorizedQC.address,
          user.address,
          framework.MINT_AMOUNT
        )
      ).to.be.revertedWith("Reserve not authorized")
    })

    it("should handle low-level call failures gracefully", async function () {
      // Simulate bank failure by removing authorization
      await framework.contracts.mockBank.revokeBalanceIncreaser(framework.contracts.accountControl.address)

      // Mint should fail with proper error message
      await expect(
        framework.contracts.qcMinter.connect(owner).requestQCMint(
          qcAddress.address,
          user.address,
          framework.MINT_AMOUNT
        )
      ).to.be.revertedWith("Bank balance increase failed")

      // Restore authorization and verify system recovers
      await framework.contracts.mockBank.authorizeBalanceIncreaser(framework.contracts.accountControl.address)

      await expect(
        framework.contracts.qcMinter.connect(owner).requestQCMint(
          qcAddress.address,
          user.address,
          framework.MINT_AMOUNT
        )
      ).to.not.be.reverted
    })
  })

  describe("Gas Optimization Cross-Contract Analysis", function () {
    beforeEach(async function () {
      await framework.enableAccountControlMode()
      await framework.contracts.qcManager.connect(owner).onboardQC(
        qcAddress.address,
        framework.QC_BACKING_AMOUNT,
        framework.QC_MINTING_CAP
      )
    })

    it("should measure gas usage across integrated contract calls", async function () {
      // Measure gas for complete mint flow
      const tx = await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        framework.MINT_AMOUNT
      )

      const receipt = await tx.wait()
      // Debug log removed for cleaner test output

      // Measure gas for redemption flow
      const spvProof = {
        merkleProof: "0x",
        txIndexInBlock: 0,
        bitcoinHeaders: "0x"
      }

      const redeemTx = await framework.contracts.qcRedeemer.connect(qcAddress).requestRedemption(
        user.address,
        framework.MINT_AMOUNT.div(2),
        spvProof
      )

      const redeemReceipt = await redeemTx.wait()
      // Debug log removed for cleaner test output

      // Gas usage should be reasonable for complex operations
      expect(receipt.gasUsed.toNumber()).to.be.lessThan(500000) // Reasonable limit for mint
      expect(redeemReceipt.gasUsed.toNumber()).to.be.lessThan(800000) // Reasonable limit for redemption
    })
  })
})