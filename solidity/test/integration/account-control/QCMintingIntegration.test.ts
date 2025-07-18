import { expect } from "chai"
import { ethers } from "hardhat"
import { BaseAccountControlIntegration } from "./BaseAccountControlIntegration.test"

describe("QC Minting Integration Flow (QC-MINT-001)", () => {
  let integration: QCMintingIntegration

  beforeEach(async () => {
    integration = new QCMintingIntegration()
    await integration.setupBase()
  })

  it("should complete full QC minting flow", async () => {
    await integration.runTest()
  })

  it("should handle multiple concurrent minting requests", async () => {
    await integration.runConcurrentMintingTest()
  })

  it("should handle minting edge cases", async () => {
    await integration.runEdgeCasesTest()
  })

  it("should handle minting errors gracefully", async () => {
    await integration.runErrorScenarios()
  })
})

class QCMintingIntegration extends BaseAccountControlIntegration {
  async runTest(): Promise<void> {
    console.log("🚀 Starting QC Minting Integration Test")

    // Step 1: Set up QC with fresh reserves
    console.log("Step 1: Setting up QC with fresh reserves...")
    await this.setupQCWithFreshReserves()
    console.log("✅ QC ready for minting")

    // Step 2: User requests QC minting
    console.log("Step 2: User requesting QC mint...")

    const mintAmount = ethers.utils.parseEther("5") // 5 tBTC
    const userInitialBalance = await this.tbtc.balanceOf(this.user.address)

    const mintTx = await this.qcMinter
      .connect(this.user)
      .requestQCMint(this.qc.address, mintAmount)

    const mintReceipt = await mintTx.wait()
    console.log("✅ Mint request submitted")

    // Step 3: Verify QCMinter validation
    console.log("Step 3: Verifying QCMinter validation...")

    const mintRequestEvent = mintReceipt.events?.find(
      (e) => e.event === "QCMintRequested"
    )
    expect(mintRequestEvent).to.exist
    expect(mintRequestEvent.args?.qc).to.equal(this.qc.address)
    expect(mintRequestEvent.args?.user).to.equal(this.user.address)
    expect(mintRequestEvent.args?.amount).to.equal(mintAmount)

    console.log("✅ QCMinter validation passed")

    // Step 4: Verify BasicMintingPolicy validation
    console.log("Step 4: Verifying policy validation...")

    // Check QC status was validated (should be Active)
    const qcStatus = await this.qcManager.getQCStatus(this.qc.address)
    expect(qcStatus).to.equal(1) // Active

    // Check minting not paused
    const mintingPaused = await this.systemState.isMintingPaused()
    expect(mintingPaused).to.be.false

    // Check amount bounds
    expect(mintAmount).to.be.gte(this.TEST_PARAMS.MIN_MINT_AMOUNT)
    expect(mintAmount).to.be.lte(this.TEST_PARAMS.MAX_MINT_AMOUNT)

    // Check reserve freshness
    const lastAttestationTime =
      await this.qcReserveLedger.getLastAttestationTime(this.qc.address)
    const currentTime = await this.getBlockTimestamp()
    expect(currentTime - lastAttestationTime).to.be.lte(
      this.TEST_PARAMS.ATTESTATION_STALE_THRESHOLD
    )

    // Check available capacity
    const availableCapacity = await this.qcManager.getAvailableMintingCapacity(
      this.qc.address
    )
    expect(availableCapacity).to.be.gte(mintAmount)

    console.log("✅ Policy validation completed")

    // Step 5: Verify QCBridge integration
    console.log("Step 5: Verifying QCBridge integration...")

    // Convert tBTC to satoshis for bridge
    const satoshis = mintAmount.div(ethers.utils.parseUnits("1", 10)) // 1 tBTC = 10^8 satoshis

    // Verify QCBridge.creditQCBackedDeposit was called
    expect(this.qcBridge.creditQCBackedDeposit).to.have.been.calledWith(
      this.user.address,
      satoshis,
      this.qc.address,
      sinon.match.any, // mintId
      true // auto-mint enabled
    )

    console.log("✅ QCBridge integration verified")

    // Step 6: Verify Bank balance creation
    console.log("Step 6: Verifying Bank balance creation...")

    // Verify Bank.increaseBalanceAndCall was called
    expect(this.bank.increaseBalanceAndCall).to.have.been.calledWith(
      this.tbtcVault.address,
      [this.user.address],
      [satoshis]
    )

    console.log("✅ Bank balance created")

    // Step 7: Verify TBTCVault auto-minting
    console.log("Step 7: Verifying TBTCVault auto-minting...")

    // Verify TBTCVault.receiveBalanceIncrease was called
    expect(this.tbtcVault.receiveBalanceIncrease).to.have.been.calledWith(
      this.user.address,
      satoshis
    )

    // Verify TBTC tokens were minted to user
    expect(this.tbtc.mint).to.have.been.calledWith(
      this.user.address,
      mintAmount
    )

    console.log("✅ Auto-minting completed")

    // Step 8: Verify state updates
    console.log("Step 8: Verifying state updates...")

    // Verify QC's minted amount was updated
    const qcData = await this.qcManager.getQCData(this.qc.address)
    expect(qcData.mintedAmount).to.equal(mintAmount)

    // Verify user's tBTC balance increased
    const userFinalBalance = await this.tbtc.balanceOf(this.user.address)
    expect(userFinalBalance.sub(userInitialBalance)).to.equal(mintAmount)

    console.log("✅ State updates verified")

    // Step 9: Verify events were emitted
    console.log("Step 9: Verifying event emissions...")

    // QCMintRequested event already verified in step 3

    // Verify BalanceIncreased event from Bank
    const balanceIncreasedEvent = mintReceipt.events?.find(
      (e) => e.event === "BalanceIncreased"
    )
    expect(balanceIncreasedEvent).to.exist
    expect(balanceIncreasedEvent.args?.recipient).to.equal(this.user.address)
    expect(balanceIncreasedEvent.args?.amount).to.equal(satoshis)

    // Verify Transfer event from TBTC token
    const transferEvent = mintReceipt.events?.find(
      (e) => e.event === "Transfer"
    )
    expect(transferEvent).to.exist
    expect(transferEvent.args?.from).to.equal(ethers.constants.AddressZero)
    expect(transferEvent.args?.to).to.equal(this.user.address)
    expect(transferEvent.args?.value).to.equal(mintAmount)

    console.log("✅ Events verified")

    console.log("🎉 QC Minting Integration Test completed successfully")
  }

  async runConcurrentMintingTest(): Promise<void> {
    console.log("🚀 Starting Concurrent Minting Test")

    await this.setupQCWithFreshReserves()

    // Create multiple users
    const [user1, user2, user3] = await ethers.getSigners()
    const mintAmount = ethers.utils.parseEther("2")

    // Execute concurrent minting requests
    const mintPromises = [
      this.qcMinter.connect(user1).requestQCMint(this.qc.address, mintAmount),
      this.qcMinter.connect(user2).requestQCMint(this.qc.address, mintAmount),
      this.qcMinter.connect(user3).requestQCMint(this.qc.address, mintAmount),
    ]

    const mintTxs = await Promise.all(mintPromises)
    const mintReceipts = await Promise.all(mintTxs.map((tx) => tx.wait()))

    console.log("✅ Concurrent minting requests completed")

    // Verify all mints succeeded
    for (let i = 0; i < mintReceipts.length; i++) {
      const receipt = mintReceipts[i]
      const mintEvent = receipt.events?.find(
        (e) => e.event === "QCMintRequested"
      )
      expect(mintEvent).to.exist
      expect(mintEvent.args?.amount).to.equal(mintAmount)
    }

    // Verify total minted amount
    const qcData = await this.qcManager.getQCData(this.qc.address)
    expect(qcData.mintedAmount).to.equal(mintAmount.mul(3))

    console.log("✅ Concurrent minting test completed")
  }

  async runEdgeCasesTest(): Promise<void> {
    console.log("🚀 Starting Edge Cases Test")

    await this.setupQCWithFreshReserves()

    // Test 1: Minimum mint amount
    console.log("Test 1: Minimum mint amount...")
    const minAmount = this.TEST_PARAMS.MIN_MINT_AMOUNT

    await expect(
      this.qcMinter.connect(this.user).requestQCMint(this.qc.address, minAmount)
    ).to.not.be.reverted

    console.log("✅ Minimum mint amount works")

    // Test 2: Maximum mint amount
    console.log("Test 2: Maximum mint amount...")
    const maxAmount = this.TEST_PARAMS.MAX_MINT_AMOUNT

    await expect(
      this.qcMinter.connect(this.user).requestQCMint(this.qc.address, maxAmount)
    ).to.not.be.reverted

    console.log("✅ Maximum mint amount works")

    // Test 3: Minting near capacity limit
    console.log("Test 3: Minting near capacity limit...")

    // Get current available capacity
    const availableCapacity = await this.qcManager.getAvailableMintingCapacity(
      this.qc.address
    )

    // Mint most of the available capacity
    const nearCapacityAmount = availableCapacity.sub(
      ethers.utils.parseEther("1")
    )

    await expect(
      this.qcMinter
        .connect(this.user)
        .requestQCMint(this.qc.address, nearCapacityAmount)
    ).to.not.be.reverted

    console.log("✅ Near capacity minting works")

    // Test 4: Minting with exactly zero remaining capacity
    console.log("Test 4: Minting with remaining capacity...")

    const remainingCapacity = await this.qcManager.getAvailableMintingCapacity(
      this.qc.address
    )

    if (remainingCapacity.gt(0)) {
      await expect(
        this.qcMinter
          .connect(this.user)
          .requestQCMint(this.qc.address, remainingCapacity)
      ).to.not.be.reverted
    }

    console.log("✅ Exact capacity minting works")

    console.log("🎉 Edge cases test completed")
  }

  async runErrorScenarios(): Promise<void> {
    console.log("🚀 Starting Error Scenarios Test")

    await this.setupQCWithFreshReserves()

    // Test 1: Inactive QC
    console.log("Test 1: Inactive QC...")

    // Change QC status to UnderReview
    await this.qcManager.connect(this.watchdog).setQCStatus(this.qc.address, 2) // UnderReview

    await expect(
      this.qcMinter
        .connect(this.user)
        .requestQCMint(this.qc.address, ethers.utils.parseEther("1"))
    ).to.be.revertedWith("QC not active")

    // Reset to Active
    await this.qcManager.connect(this.watchdog).setQCStatus(this.qc.address, 1) // Active
    console.log("✅ Inactive QC correctly rejected")

    // Test 2: Minting paused
    console.log("Test 2: Minting paused...")

    await this.systemState.connect(this.emergencyCouncil).pauseMinting()

    await expect(
      this.qcMinter
        .connect(this.user)
        .requestQCMint(this.qc.address, ethers.utils.parseEther("1"))
    ).to.be.revertedWith("Minting paused")

    await this.systemState.connect(this.emergencyCouncil).unpauseMinting()
    console.log("✅ Paused minting correctly rejected")

    // Test 3: Amount too small
    console.log("Test 3: Amount too small...")

    const tooSmallAmount = this.TEST_PARAMS.MIN_MINT_AMOUNT.sub(1)

    await expect(
      this.qcMinter
        .connect(this.user)
        .requestQCMint(this.qc.address, tooSmallAmount)
    ).to.be.revertedWith("Amount too small")

    console.log("✅ Too small amount correctly rejected")

    // Test 4: Amount too large
    console.log("Test 4: Amount too large...")

    const tooLargeAmount = this.TEST_PARAMS.MAX_MINT_AMOUNT.add(1)

    await expect(
      this.qcMinter
        .connect(this.user)
        .requestQCMint(this.qc.address, tooLargeAmount)
    ).to.be.revertedWith("Amount too large")

    console.log("✅ Too large amount correctly rejected")

    // Test 5: Stale reserves
    console.log("Test 5: Stale reserves...")

    // Advance time to make reserves stale
    await this.advanceTime(this.TEST_PARAMS.ATTESTATION_STALE_THRESHOLD + 1)

    await expect(
      this.qcMinter
        .connect(this.user)
        .requestQCMint(this.qc.address, ethers.utils.parseEther("1"))
    ).to.be.revertedWith("Stale reserves")

    console.log("✅ Stale reserves correctly rejected")

    // Test 6: Insufficient capacity
    console.log("Test 6: Insufficient capacity...")

    // Submit fresh attestation but with low reserves
    const lowReserves = ethers.utils.parseEther("0.5")
    const currentTimestamp = await this.getBlockTimestamp()

    await this.qcReserveLedger
      .connect(this.watchdog)
      .submitAttestation(this.qc.address, lowReserves, currentTimestamp)

    const excessiveAmount = ethers.utils.parseEther("1")

    await expect(
      this.qcMinter
        .connect(this.user)
        .requestQCMint(this.qc.address, excessiveAmount)
    ).to.be.revertedWith("Insufficient capacity")

    console.log("✅ Insufficient capacity correctly rejected")

    // Test 7: Zero amount
    console.log("Test 7: Zero amount...")

    await expect(
      this.qcMinter.connect(this.user).requestQCMint(this.qc.address, 0)
    ).to.be.revertedWith("Amount must be greater than zero")

    console.log("✅ Zero amount correctly rejected")

    console.log("🎉 Error scenarios test completed")
  }

  private async setupQCWithFreshReserves(): Promise<void> {
    // Complete QC onboarding
    await this.qcManager
      .connect(this.governance)
      .registerQC(this.qc.address, this.TEST_PARAMS.MAX_MINTING_CAP)

    await this.advanceTime(this.TEST_PARAMS.GOVERNANCE_DELAY)

    await this.qcManager
      .connect(this.governance)
      .registerQC(this.qc.address, this.TEST_PARAMS.MAX_MINTING_CAP)

    // Register Bitcoin wallet
    const btcAddress = this.generateBitcoinAddress()
    await this.qcManager
      .connect(this.qc)
      .requestWalletRegistration(btcAddress, this.generateMockSPVProof())

    await this.qcManager
      .connect(this.watchdog)
      .finalizeWalletRegistration(this.qc.address, btcAddress)

    // Submit fresh reserve attestation
    const totalReserves = ethers.utils.parseEther("200") // 200 BTC - plenty for testing
    const currentTimestamp = await this.getBlockTimestamp()

    await this.qcReserveLedger
      .connect(this.watchdog)
      .submitAttestation(this.qc.address, totalReserves, currentTimestamp)
  }
}
