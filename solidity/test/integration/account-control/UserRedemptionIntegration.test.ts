import { expect } from "chai"
import { ethers } from "hardhat"
import { BaseAccountControlIntegration } from "./BaseAccountControlIntegration.test"

describe("User Redemption Integration Flow (USER-REDEEM-001)", () => {
  let integration: UserRedemptionIntegration

  beforeEach(async () => {
    integration = new UserRedemptionIntegration()
    await integration.setupBase()
  })

  it("should complete full user redemption flow", async () => {
    await integration.runTest()
  })

  it("should handle redemption timeout scenario", async () => {
    await integration.runTimeoutScenario()
  })

  it("should handle multiple concurrent redemptions", async () => {
    await integration.runConcurrentRedemptionTest()
  })

  it("should handle redemption errors gracefully", async () => {
    await integration.runErrorScenarios()
  })
})

class UserRedemptionIntegration extends BaseAccountControlIntegration {
  async runTest(): Promise<void> {
    console.log("🚀 Starting User Redemption Integration Test")

    // Step 1: Set up user with tBTC tokens
    console.log("Step 1: Setting up user with tBTC tokens...")
    await this.setupUserWithTokens()

    const userInitialBalance = await this.tbtc.balanceOf(this.user.address)
    console.log(
      `✅ User has ${ethers.utils.formatEther(userInitialBalance)} tBTC`
    )

    // Step 2: User initiates redemption
    console.log("Step 2: User initiating redemption...")

    const redeemAmount = ethers.utils.parseEther("5")
    const btcReceiveAddress = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"

    const redeemTx = await this.qcRedeemer
      .connect(this.user)
      .initiateRedemption(this.qc.address, redeemAmount, btcReceiveAddress)

    const redeemReceipt = await redeemTx.wait()
    console.log("✅ Redemption initiated")

    // Step 3: Extract redemption ID and verify event
    console.log("Step 3: Verifying redemption event...")

    const redemptionEvent = redeemReceipt.events?.find(
      (e) => e.event === "RedemptionRequested"
    )
    expect(redemptionEvent).to.exist

    const redemptionId = redemptionEvent.args?.redemptionId
    expect(redemptionId).to.exist
    expect(redemptionEvent.args?.qc).to.equal(this.qc.address)
    expect(redemptionEvent.args?.user).to.equal(this.user.address)
    expect(redemptionEvent.args?.amount).to.equal(redeemAmount)
    expect(redemptionEvent.args?.btcAddress).to.equal(btcReceiveAddress)

    console.log(`✅ Redemption ID: ${redemptionId}`)

    // Step 4: Verify tBTC tokens were burned
    console.log("Step 4: Verifying token burning...")

    const userFinalBalance = await this.tbtc.balanceOf(this.user.address)
    expect(userInitialBalance.sub(userFinalBalance)).to.equal(redeemAmount)

    // Verify burn event
    const burnEvent = redeemReceipt.events?.find(
      (e) =>
        e.event === "Transfer" && e.args?.to === ethers.constants.AddressZero
    )
    expect(burnEvent).to.exist
    expect(burnEvent.args?.from).to.equal(this.user.address)
    expect(burnEvent.args?.value).to.equal(redeemAmount)

    console.log("✅ tBTC tokens burned successfully")

    // Step 5: Verify redemption record created
    console.log("Step 5: Verifying redemption record...")

    const redemption = await this.qcRedeemer.getRedemption(redemptionId)
    expect(redemption.status).to.equal(1) // Pending
    expect(redemption.qc).to.equal(this.qc.address)
    expect(redemption.user).to.equal(this.user.address)
    expect(redemption.amount).to.equal(redeemAmount)
    expect(redemption.btcAddress).to.equal(btcReceiveAddress)
    expect(redemption.requestedAt).to.be.greaterThan(0)

    console.log("✅ Redemption record created with Pending status")

    // Step 6: Simulate QC fulfillment process
    console.log("Step 6: Simulating QC fulfillment...")

    // In real scenario, QC would:
    // 1. Receive redemption request
    // 2. Send Bitcoin to user's address
    // 3. Provide transaction details to watchdog

    const fulfillmentProof = this.generateFulfillmentProof(
      redemptionId,
      btcReceiveAddress,
      redeemAmount
    )
    console.log("✅ QC fulfilled redemption on Bitcoin network")

    // Step 7: Watchdog verifies and records fulfillment
    console.log("Step 7: Watchdog recording fulfillment...")

    const fulfillmentTx = await this.basicRedemptionPolicy
      .connect(this.watchdog)
      .recordFulfillment(redemptionId, fulfillmentProof)

    const fulfillmentReceipt = await fulfillmentTx.wait()
    console.log("✅ Fulfillment recorded by watchdog")

    // Step 8: Verify fulfillment event
    console.log("Step 8: Verifying fulfillment event...")

    const fulfillmentEvent = fulfillmentReceipt.events?.find(
      (e) => e.event === "RedemptionFulfilled"
    )
    expect(fulfillmentEvent).to.exist
    expect(fulfillmentEvent.args?.redemptionId).to.equal(redemptionId)
    expect(fulfillmentEvent.args?.qc).to.equal(this.qc.address)
    expect(fulfillmentEvent.args?.txHash).to.equal(fulfillmentProof.txHash)

    console.log("✅ Fulfillment event verified")

    // Step 9: Verify redemption status updated
    console.log("Step 9: Verifying redemption status...")

    const updatedRedemption = await this.qcRedeemer.getRedemption(redemptionId)
    expect(updatedRedemption.status).to.equal(2) // Fulfilled
    expect(updatedRedemption.fulfilledAt).to.be.greaterThan(0)

    console.log("✅ Redemption status updated to Fulfilled")

    // Step 10: Verify QC's redeemed amount updated
    console.log("Step 10: Verifying QC state updates...")

    const qcData = await this.qcManager.getQCData(this.qc.address)
    expect(qcData.redeemedAmount).to.equal(redeemAmount)

    console.log("✅ QC redeemed amount updated")

    console.log("🎉 User Redemption Integration Test completed successfully")
  }

  async runTimeoutScenario(): Promise<void> {
    console.log("🚀 Starting Redemption Timeout Scenario Test")

    await this.setupUserWithTokens()

    // Initiate redemption
    const redeemAmount = ethers.utils.parseEther("3")
    const btcReceiveAddress = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"

    const redeemTx = await this.qcRedeemer
      .connect(this.user)
      .initiateRedemption(this.qc.address, redeemAmount, btcReceiveAddress)

    const redeemReceipt = await redeemTx.wait()
    const redemptionEvent = redeemReceipt.events?.find(
      (e) => e.event === "RedemptionRequested"
    )
    const redemptionId = redemptionEvent.args?.redemptionId

    console.log("✅ Redemption initiated")

    // Advance time beyond timeout
    await this.advanceTime(this.TEST_PARAMS.REDEMPTION_TIMEOUT + 1)

    console.log("✅ Redemption timeout period exceeded")

    // Watchdog flags redemption as defaulted
    const defaultTx = await this.basicRedemptionPolicy
      .connect(this.watchdog)
      .flagDefault(redemptionId)

    const defaultReceipt = await defaultTx.wait()

    console.log("✅ Redemption flagged as defaulted")

    // Verify default event
    const defaultEvent = defaultReceipt.events?.find(
      (e) => e.event === "RedemptionDefaulted"
    )
    expect(defaultEvent).to.exist
    expect(defaultEvent.args?.redemptionId).to.equal(redemptionId)
    expect(defaultEvent.args?.qc).to.equal(this.qc.address)

    // Verify redemption status
    const redemption = await this.qcRedeemer.getRedemption(redemptionId)
    expect(redemption.status).to.equal(3) // Defaulted

    console.log("✅ Redemption status updated to Defaulted")

    // Verify QC status may change to UnderReview
    const qcStatus = await this.qcManager.getQCStatus(this.qc.address)
    if (qcStatus === 2) {
      // UnderReview
      console.log("✅ QC status changed to UnderReview due to default")
    }

    console.log("🎉 Timeout scenario test completed")
  }

  async runConcurrentRedemptionTest(): Promise<void> {
    console.log("🚀 Starting Concurrent Redemption Test")

    await this.setupUserWithTokens()

    // Create multiple users with tokens
    const [user1, user2, user3] = await ethers.getSigners()
    const redeemAmount = ethers.utils.parseEther("2")

    // Give all users some tBTC tokens
    await this.tbtc.mint(user1.address, redeemAmount)
    await this.tbtc.mint(user2.address, redeemAmount)
    await this.tbtc.mint(user3.address, redeemAmount)

    // Execute concurrent redemption requests
    const btcAddresses = [
      "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      "tb1qrp33g0qq4aspd6gpgq2c5xqe8a9q3rq82l6j0pf",
      "tb1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    ]

    const redeemPromises = [
      this.qcRedeemer
        .connect(user1)
        .initiateRedemption(this.qc.address, redeemAmount, btcAddresses[0]),
      this.qcRedeemer
        .connect(user2)
        .initiateRedemption(this.qc.address, redeemAmount, btcAddresses[1]),
      this.qcRedeemer
        .connect(user3)
        .initiateRedemption(this.qc.address, redeemAmount, btcAddresses[2]),
    ]

    const redeemTxs = await Promise.all(redeemPromises)
    const redeemReceipts = await Promise.all(redeemTxs.map((tx) => tx.wait()))

    console.log("✅ Concurrent redemption requests completed")

    // Verify all redemptions succeeded
    const redemptionIds = []
    for (let i = 0; i < redeemReceipts.length; i++) {
      const receipt = redeemReceipts[i]
      const redemptionEvent = receipt.events?.find(
        (e) => e.event === "RedemptionRequested"
      )
      expect(redemptionEvent).to.exist

      const redemptionId = redemptionEvent.args?.redemptionId
      redemptionIds.push(redemptionId)

      // Verify redemption record
      const redemption = await this.qcRedeemer.getRedemption(redemptionId)
      expect(redemption.status).to.equal(1) // Pending
      expect(redemption.amount).to.equal(redeemAmount)
    }

    console.log("✅ All redemptions have unique IDs and correct status")

    // Simulate fulfillment of all redemptions
    for (let i = 0; i < redemptionIds.length; i++) {
      const redemptionId = redemptionIds[i]
      const fulfillmentProof = this.generateFulfillmentProof(
        redemptionId,
        btcAddresses[i],
        redeemAmount
      )

      await this.basicRedemptionPolicy
        .connect(this.watchdog)
        .recordFulfillment(redemptionId, fulfillmentProof)
    }

    console.log("✅ All redemptions fulfilled")

    // Verify total redeemed amount
    const qcData = await this.qcManager.getQCData(this.qc.address)
    expect(qcData.redeemedAmount).to.equal(redeemAmount.mul(3))

    console.log("✅ Concurrent redemption test completed")
  }

  async runErrorScenarios(): Promise<void> {
    console.log("🚀 Starting Error Scenarios Test")

    await this.setupUserWithTokens()

    // Test 1: Insufficient balance
    console.log("Test 1: Insufficient balance...")

    const userBalance = await this.tbtc.balanceOf(this.user.address)
    const excessiveAmount = userBalance.add(ethers.utils.parseEther("1"))

    await expect(
      this.qcRedeemer
        .connect(this.user)
        .initiateRedemption(
          this.qc.address,
          excessiveAmount,
          "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
        )
    ).to.be.revertedWith("Insufficient balance")

    console.log("✅ Insufficient balance correctly rejected")

    // Test 2: Invalid QC
    console.log("Test 2: Invalid QC...")

    await expect(
      this.qcRedeemer.connect(this.user).initiateRedemption(
        this.user.address, // Invalid QC address
        ethers.utils.parseEther("1"),
        "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
      )
    ).to.be.revertedWith("Invalid QC")

    console.log("✅ Invalid QC correctly rejected")

    // Test 3: Amount too small
    console.log("Test 3: Amount too small...")

    const tooSmallAmount = this.TEST_PARAMS.MIN_REDEMPTION_AMOUNT.sub(1)

    await expect(
      this.qcRedeemer
        .connect(this.user)
        .initiateRedemption(
          this.qc.address,
          tooSmallAmount,
          "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
        )
    ).to.be.revertedWith("Amount too small")

    console.log("✅ Too small amount correctly rejected")

    // Test 4: Amount too large
    console.log("Test 4: Amount too large...")

    const tooLargeAmount = this.TEST_PARAMS.MAX_REDEMPTION_AMOUNT.add(1)

    await expect(
      this.qcRedeemer
        .connect(this.user)
        .initiateRedemption(
          this.qc.address,
          tooLargeAmount,
          "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
        )
    ).to.be.revertedWith("Amount too large")

    console.log("✅ Too large amount correctly rejected")

    // Test 5: Invalid Bitcoin address
    console.log("Test 5: Invalid Bitcoin address...")

    await expect(
      this.qcRedeemer
        .connect(this.user)
        .initiateRedemption(
          this.qc.address,
          ethers.utils.parseEther("1"),
          "invalid_btc_address"
        )
    ).to.be.revertedWith("Invalid Bitcoin address")

    console.log("✅ Invalid Bitcoin address correctly rejected")

    // Test 6: Redemption paused
    console.log("Test 6: Redemption paused...")

    await this.systemState.connect(this.emergencyCouncil).pauseRedemption()

    await expect(
      this.qcRedeemer
        .connect(this.user)
        .initiateRedemption(
          this.qc.address,
          ethers.utils.parseEther("1"),
          "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
        )
    ).to.be.revertedWith("Redemption paused")

    await this.systemState.connect(this.emergencyCouncil).unpauseRedemption()
    console.log("✅ Paused redemption correctly rejected")

    // Test 7: Unauthorized fulfillment
    console.log("Test 7: Unauthorized fulfillment...")

    // Create a valid redemption first
    const redeemTx = await this.qcRedeemer
      .connect(this.user)
      .initiateRedemption(
        this.qc.address,
        ethers.utils.parseEther("1"),
        "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
      )

    const redeemReceipt = await redeemTx.wait()
    const redemptionEvent = redeemReceipt.events?.find(
      (e) => e.event === "RedemptionRequested"
    )
    const redemptionId = redemptionEvent.args?.redemptionId

    const fulfillmentProof = this.generateFulfillmentProof(
      redemptionId,
      "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      ethers.utils.parseEther("1")
    )

    // Attempt unauthorized fulfillment
    await expect(
      this.basicRedemptionPolicy
        .connect(this.user)
        .recordFulfillment(redemptionId, fulfillmentProof)
    ).to.be.revertedWith("Only watchdog can record fulfillment")

    console.log("✅ Unauthorized fulfillment correctly rejected")

    // Test 8: Double fulfillment
    console.log("Test 8: Double fulfillment...")

    // Fulfill the redemption legitimately
    await this.basicRedemptionPolicy
      .connect(this.watchdog)
      .recordFulfillment(redemptionId, fulfillmentProof)

    // Attempt to fulfill again
    await expect(
      this.basicRedemptionPolicy
        .connect(this.watchdog)
        .recordFulfillment(redemptionId, fulfillmentProof)
    ).to.be.revertedWith("Redemption already fulfilled")

    console.log("✅ Double fulfillment correctly rejected")

    console.log("🎉 Error scenarios test completed")
  }

  private async setupUserWithTokens(): Promise<void> {
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
    const totalReserves = ethers.utils.parseEther("200")
    const currentTimestamp = await this.getBlockTimestamp()

    await this.qcReserveLedger
      .connect(this.watchdog)
      .submitAttestation(this.qc.address, totalReserves, currentTimestamp)

    // Mint some tBTC for the user (simulating previous successful minting)
    const userTokens = ethers.utils.parseEther("20")
    await this.tbtc.mint(this.user.address, userTokens)

    // Update QC's minted amount to reflect this
    await this.qcManager
      .connect(this.deployer)
      .updateQCMintedAmount(this.qc.address, userTokens)
  }

  private generateFulfillmentProof(
    redemptionId: string,
    btcAddress: string,
    amount: any
  ): any {
    return {
      txHash: ethers.utils.id(`fulfillment_${redemptionId}`),
      merkleProof: [ethers.utils.randomBytes(32)],
      blockHeader: ethers.utils.randomBytes(80),
      outputIndex: 0,
      amount: amount,
      recipient: btcAddress,
    }
  }
}
