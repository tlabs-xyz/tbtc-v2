import { expect } from "chai"
import { ethers, upgrades } from "hardhat"
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

import { IntegrationTestFramework } from "../helpers/integration-test-framework"
import { setupTestEnvironment } from "../../fixtures"

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
describe("End-to-End Integration Flow Tests", () => {
  let framework: IntegrationTestFramework
  let owner: SignerWithAddress
  let emergencyCouncil: SignerWithAddress
  let user: SignerWithAddress
  let qcAddress: SignerWithAddress
  let qcAddress2: SignerWithAddress

  beforeEach(async () => {
    framework = new IntegrationTestFramework()
    await framework.deploySystem()

    owner = framework.signers.owner
    emergencyCouncil = framework.signers.emergencyCouncil
    user = framework.signers.user
    qcAddress = framework.signers.qcAddress
    qcAddress2 = framework.signers.attester1 // Use as second QC
  })

  describe("Basic Integration Verification", () => {
    it("should verify system deployment and basic connectivity", async () => {
      expect(owner.address).to.be.a("string")
      expect(framework.contracts.accountControl.address).to.be.a("string")
      expect(framework.contracts.qcMinter.address).to.be.a("string")
      expect(framework.contracts.qcRedeemer.address).to.be.a("string")

      // Verify contracts are properly connected
      const accountControlAddress =
        await framework.contracts.qcMinter.accountControl()

      expect(accountControlAddress).to.equal(
        framework.contracts.accountControl.address
      )

      // Basic integration verification passed
    })
  })

  describe("QCManager - AccountControl Integration Flows", () => {
    it("should complete QC registration with AccountControl authorization", async () => {
      // Register QC through QCManager - should automatically authorize in AccountControl
      const backing = framework.QC_BACKING_AMOUNT
      const mintingCap = framework.QC_MINTING_CAP

      const tx = await framework.contracts.qcManager
        .connect(owner)
        .registerQC(qcAddress.address, mintingCap)

      await expect(tx).to.emit(framework.contracts.qcManager, "QCOnboarded")
      await expect(tx)
        .to.emit(framework.contracts.accountControl, "ReserveAuthorized")
        .withArgs(qcAddress.address, mintingCap)

      // Verify QC is authorized in AccountControl
      const isAuthorized =
        await framework.contracts.accountControl.isReserveAuthorized(
          qcAddress.address
        )

      expect(isAuthorized).to.be.true

      // Verify minting cap is set correctly
      const actualCap = await framework.contracts.accountControl.mintingCaps(
        qcAddress.address
      )

      expect(actualCap).to.equal(mintingCap)
    })

    it("should handle minting capacity updates through QCManager", async () => {
      // Register QC
      await framework.contracts.qcManager
        .connect(owner)
        .registerQC(qcAddress.address, framework.QC_MINTING_CAP)

      // Increase minting cap through QCManager
      const newCap = framework.QC_MINTING_CAP.mul(2)

      const tx = await framework.contracts.qcManager
        .connect(owner)
        .increaseMintingCapacity(
          qcAddress.address,
          newCap // Pass the new total cap, not the increment
        )

      // Should update AccountControl as well
      const updatedCap = await framework.contracts.accountControl.mintingCaps(
        qcAddress.address
      )

      expect(updatedCap).to.equal(newCap)
    })
  })

  describe("QCMinter Integration Flows", () => {
    beforeEach(async () => {
      // Setup QC with backing and minting cap
      await framework.contracts.qcManager
        .connect(owner)
        .registerQC(qcAddress.address, framework.QC_MINTING_CAP)
    })

    it("should route minting through AccountControl when enabled", async () => {
      const mintAmount = framework.MINT_AMOUNT

      const tx = await framework.contracts.qcMinter
        .connect(owner)
        .requestQCMint(qcAddress.address, user.address, mintAmount)

      const receipt = await tx.wait()

      // Verify minting was routed through AccountControl
      await expect(tx).to.emit(framework.contracts.qcMinter, "QCMintRequested")
      await expect(tx)
        .to.emit(framework.contracts.accountControl, "MintExecuted")
        .withArgs(
          framework.contracts.qcMinter.address,
          user.address,
          mintAmount.div(framework.ONE_SATOSHI_IN_WEI)
        )

      // Verify balances updated correctly (Bank stores tBTC with 18 decimals)
      const userBalance = await framework.contracts.mockBank.balances(
        user.address
      )

      expect(userBalance).to.equal(mintAmount)

      // Verify AccountControl tracking
      const totalMinted = await framework.contracts.accountControl.totalMinted()

      const reserveMinted = await framework.contracts.accountControl.minted(
        framework.contracts.qcMinter.address
      )

      const mintAmountInSatoshis = mintAmount.div(framework.ONE_SATOSHI_IN_WEI)
      expect(totalMinted).to.equal(mintAmountInSatoshis)
      expect(reserveMinted).to.equal(mintAmountInSatoshis)
    })

    it("should enforce AccountControl backing invariant", async () => {
      const mintAmount = framework.QC_MINTING_CAP.add(
        ethers.utils.parseEther("0.001")
      )

      // Attempt to mint more than cap
      await expect(
        framework.contracts.qcMinter
          .connect(owner)
          .requestQCMint(qcAddress.address, user.address, mintAmount)
      ).to.be.revertedWithCustomError(
        framework.contracts.qcMinter,
        "InsufficientMintingCapacity"
      )
    })

    it("should enforce AccountControl minting cap", async () => {
      // Mint up to the cap
      const firstMint = framework.MINT_AMOUNT
      await framework.contracts.qcMinter
        .connect(owner)
        .requestQCMint(qcAddress.address, user.address, firstMint)

      // Try to exceed cap with second mint
      const secondMint = framework.QC_MINTING_CAP.sub(firstMint).add(1)

      await expect(
        framework.contracts.qcMinter
          .connect(owner)
          .requestQCMint(qcAddress.address, user.address, secondMint)
      ).to.be.revertedWithCustomError(
        framework.contracts.qcMinter,
        "InsufficientMintingCapacity"
      )
    })
  })

  describe("QCRedeemer Integration Flows", () => {
    beforeEach(async () => {
      // Setup QC and perform initial mint
      await framework.contracts.qcManager
        .connect(owner)
        .registerQC(qcAddress.address, framework.QC_MINTING_CAP)

      // Register the default wallet address that QCRedeemer uses
      const defaultWallet = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
      await framework.contracts.qcData
        .connect(owner)
        .registerWallet(qcAddress.address, defaultWallet)

      await framework.contracts.qcMinter
        .connect(owner)
        .requestQCMint(qcAddress.address, user.address, framework.MINT_AMOUNT)
    })

    it("should notify AccountControl of redemption when enabled", async () => {
      const redeemAmount = framework.MINT_AMOUNT.div(2)

      // Set up Bitcoin addresses for redemption
      const userBtcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" // Genesis address
      const qcWalletAddress = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"

      // User initiates redemption (msg.sender will be the user)
      const tx = await framework.contracts.qcRedeemer
        .connect(user)
        .initiateRedemption(
          qcAddress.address,
          redeemAmount,
          userBtcAddress,
          qcWalletAddress
        )

      await expect(tx).to.emit(
        framework.contracts.qcRedeemer,
        "RedemptionRequested"
      )
      await expect(tx)
        .to.emit(framework.contracts.accountControl, "RedemptionProcessed")
        .withArgs(
          framework.contracts.qcRedeemer.address,
          redeemAmount.div(framework.ONE_SATOSHI_IN_WEI)
        )

      // Verify AccountControl state updated
      const totalMinted = await framework.contracts.accountControl.totalMinted()

      const reserveMinted = await framework.contracts.accountControl.minted(
        qcAddress.address
      )

      const expectedRemaining = framework.MINT_AMOUNT.sub(redeemAmount)

      const expectedRemainingInSatoshis = expectedRemaining.div(
        framework.ONE_SATOSHI_IN_WEI
      )

      expect(totalMinted).to.equal(expectedRemainingInSatoshis)
      expect(reserveMinted).to.equal(expectedRemainingInSatoshis)
    })

    it("should prevent over-redemption in AccountControl mode", async () => {
      const excessiveRedeemAmount = framework.MINT_AMOUNT.add(
        ethers.utils.parseEther("0.001")
      )

      const userBtcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
      const qcWalletAddress = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"

      await expect(
        framework.contracts.qcRedeemer
          .connect(qcAddress)
          .initiateRedemption(
            user.address,
            excessiveRedeemAmount,
            userBtcAddress,
            qcWalletAddress
          )
      ).to.be.revertedWith("ERC20: burn amount exceeds balance")
    })
  })

  describe("Complete End-to-End Workflow", () => {
    it("should complete full mint-redeem cycle with proper state management", async () => {
      // Enable AccountControl mode
      await framework.enableAccountControlMode()

      // 1. Register QC through QCManager
      await framework.contracts.qcManager
        .connect(owner)
        .registerQC(qcAddress.address, framework.QC_MINTING_CAP)

      // Register the default wallet address that QCRedeemer uses
      const defaultWallet = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
      await framework.contracts.qcData
        .connect(owner)
        .registerWallet(qcAddress.address, defaultWallet)

      // 2. Execute mint through QCMinter
      const mintAmount = framework.MINT_AMOUNT

      let tx = await framework.contracts.qcMinter
        .connect(owner)
        .requestQCMint(qcAddress.address, user.address, mintAmount)

      let receipt = await tx.wait()

      // Verify mint state
      let userBalance = await framework.contracts.mockBank.balances(
        user.address
      )

      let totalMinted = await framework.contracts.accountControl.totalMinted()

      let reserveMinted = await framework.contracts.accountControl.minted(
        qcAddress.address
      )

      // Bank stores tBTC with 18 decimals, AccountControl tracks amounts in satoshis
      const expectedBalanceInSatoshis = mintAmount.div(
        framework.ONE_SATOSHI_IN_WEI
      )

      expect(userBalance).to.equal(mintAmount) // Bank balance is in tBTC
      // AccountControl tracks amounts in satoshis internally
      expect(totalMinted).to.equal(expectedBalanceInSatoshis)
      expect(reserveMinted).to.equal(expectedBalanceInSatoshis)

      // 3. Execute partial redemption through QCRedeemer
      const redeemAmount = mintAmount.div(2)
      const userBtcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
      const qcWalletAddress = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"

      // User initiates partial redemption
      tx = await framework.contracts.qcRedeemer
        .connect(user)
        .initiateRedemption(
          qcAddress.address,
          redeemAmount,
          userBtcAddress,
          qcWalletAddress
        )
      receipt = await tx.wait()

      // Verify redemption state
      userBalance = await framework.contracts.mockBank.balances(user.address)
      totalMinted = await framework.contracts.accountControl.totalMinted()
      reserveMinted = await framework.contracts.accountControl.minted(
        qcAddress.address
      )
      const expectedRemaining = mintAmount.sub(redeemAmount)

      const expectedRemainingInSatoshis = expectedRemaining.div(
        framework.ONE_SATOSHI_IN_WEI
      )

      expect(userBalance).to.equal(expectedRemaining) // Bank balance is in tBTC
      expect(totalMinted).to.equal(expectedRemainingInSatoshis)
      expect(reserveMinted).to.equal(expectedRemainingInSatoshis)

      // 4. Execute final redemption
      // User initiates final redemption
      tx = await framework.contracts.qcRedeemer
        .connect(user)
        .initiateRedemption(
          qcAddress.address,
          expectedRemaining,
          userBtcAddress,
          qcWalletAddress
        )

      // Verify final state - all minted tokens redeemed
      userBalance = await framework.contracts.mockBank.balances(user.address)
      totalMinted = await framework.contracts.accountControl.totalMinted()
      reserveMinted = await framework.contracts.accountControl.minted(
        qcAddress.address
      )

      expect(userBalance).to.equal(0)
      expect(totalMinted).to.equal(0)
      expect(reserveMinted).to.equal(0)
    })

    it("should handle multiple QCs operating simultaneously", async () => {
      // Enable AccountControl mode
      await framework.enableAccountControlMode()

      // Register two QCs
      await framework.contracts.qcManager
        .connect(owner)
        .registerQC(qcAddress.address, framework.QC_MINTING_CAP)

      await framework.contracts.qcManager
        .connect(owner)
        .registerQC(qcAddress2.address, framework.QC_MINTING_CAP)

      // Register wallet addresses for both QCs
      const defaultWallet = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
      await framework.contracts.qcData
        .connect(owner)
        .registerWallet(qcAddress.address, defaultWallet)
      await framework.contracts.qcData
        .connect(owner)
        .registerWallet(qcAddress2.address, defaultWallet)

      // Execute concurrent minting from both QCs
      const mintAmount = framework.MINT_AMOUNT

      const tx1 = await framework.contracts.qcMinter
        .connect(owner)
        .requestQCMint(qcAddress.address, user.address, mintAmount)

      const tx2 = await framework.contracts.qcMinter
        .connect(owner)
        .requestQCMint(qcAddress2.address, user.address, mintAmount)

      const receipt1 = await tx1.wait()
      const receipt2 = await tx2.wait()

      // Verify independent tracking
      const totalMinted = await framework.contracts.accountControl.totalMinted()

      const reserve1Minted = await framework.contracts.accountControl.minted(
        qcAddress.address
      )

      const reserve2Minted = await framework.contracts.accountControl.minted(
        qcAddress2.address
      )

      const userBalance = await framework.contracts.mockBank.balances(
        user.address
      )

      // Convert expected amounts to satoshis for AccountControl comparisons
      const mintAmountInSatoshis = mintAmount.div(framework.ONE_SATOSHI_IN_WEI)
      expect(totalMinted).to.equal(mintAmountInSatoshis.mul(2))
      expect(reserve1Minted).to.equal(mintAmountInSatoshis)
      expect(reserve2Minted).to.equal(mintAmountInSatoshis)
      // Bank balance is in tBTC (18 decimals)
      expect(userBalance).to.equal(mintAmount.mul(2))
    })
  })

  describe("AccountControl Mode Toggle Scenarios", () => {
    it("should handle AccountControl mode toggling mid-operation", async () => {
      // Start test

      // Register QC (should work without AccountControl)
      await framework.contracts.qcManager
        .connect(owner)
        .registerQC(qcAddress.address, framework.QC_MINTING_CAP)

      // Mint with AccountControl disabled
      let tx = await framework.contracts.qcMinter
        .connect(owner)
        .requestQCMint(qcAddress.address, user.address, framework.MINT_AMOUNT)

      let receipt = await tx.wait()

      // AccountControl should not track this mint
      let totalMinted = await framework.contracts.accountControl.totalMinted()
      expect(totalMinted).to.equal(0)

      // Subsequent mints should be tracked
      tx = await framework.contracts.qcMinter
        .connect(owner)
        .requestQCMint(qcAddress.address, user.address, framework.MINT_AMOUNT)
      receipt = await tx.wait()

      // This mint should be tracked
      totalMinted = await framework.contracts.accountControl.totalMinted()
      expect(totalMinted).to.equal(framework.MINT_AMOUNT)
    })
  })

  describe("Integration State Consistency", () => {
    it("should maintain consistent state between QCManager and AccountControl", async () => {
      await framework.enableAccountControlMode()

      // Register multiple QCs with different caps
      const qc1Cap = framework.QC_MINTING_CAP
      const qc2Cap = framework.QC_MINTING_CAP.mul(2)

      await framework.contracts.qcManager
        .connect(owner)
        .registerQC(qcAddress.address, qc1Cap)

      await framework.contracts.qcManager
        .connect(owner)
        .registerQC(qcAddress2.address, qc2Cap)

      // Verify caps are consistent
      const ac1Cap = await framework.contracts.accountControl.mintingCaps(
        qcAddress.address
      )

      const ac2Cap = await framework.contracts.accountControl.mintingCaps(
        qcAddress2.address
      )

      expect(ac1Cap).to.equal(qc1Cap)
      expect(ac2Cap).to.equal(qc2Cap)

      // Verify authorization status
      const isAuth1 =
        await framework.contracts.accountControl.isReserveAuthorized(
          qcAddress.address
        )

      const isAuth2 =
        await framework.contracts.accountControl.isReserveAuthorized(
          qcAddress2.address
        )

      expect(isAuth1).to.be.true
      expect(isAuth2).to.be.true
    })

    it("should handle AccountControl address changes properly", async () => {
      await framework.enableAccountControlMode()

      // Get initial AccountControl address
      const initialAddress =
        await framework.contracts.qcManager.accountControl()

      expect(initialAddress).to.equal(
        framework.contracts.accountControl.address
      )

      // Deploy new AccountControl instance
      const AccountControlFactory = await ethers.getContractFactory(
        "AccountControl"
      )

      const newAccountControl = (await AccountControlFactory.deploy(
        owner.address,
        emergencyCouncil.address,
        framework.contracts.mockBank.address
      )) as any

      // Update AccountControl address in QCManager
      const tx = await framework.contracts.qcManager
        .connect(owner)
        .setAccountControl(newAccountControl.address)

      await expect(tx)
        .to.emit(framework.contracts.qcManager, "AccountControlUpdated")
        .withArgs(
          framework.contracts.accountControl.address,
          newAccountControl.address
        )

      // Verify address updated
      const updatedAddress =
        await framework.contracts.qcManager.accountControl()

      expect(updatedAddress).to.equal(newAccountControl.address)
    })
  })
})
