import { expect } from "chai"
import { ethers } from "hardhat"
import { BaseAccountControlIntegration } from "./BaseAccountControlIntegration.test"

describe("Complete Account Control Integration Flow", () => {
  let integration: CompleteFlowIntegration

  beforeEach(async () => {
    integration = new CompleteFlowIntegration()
    await integration.setupBase()
  })

  it("should complete full end-to-end flow", async () => {
    await integration.runTest()
  })

  it("should handle policy upgrade flow", async () => {
    await integration.runPolicyUpgradeTest()
  })

  it("should handle emergency scenarios", async () => {
    await integration.runEmergencyScenarios()
  })

  it("should handle system stress test", async () => {
    await integration.runStressTest()
  })
})

class CompleteFlowIntegration extends BaseAccountControlIntegration {
  async runTest(): Promise<void> {
    console.log("🚀 Starting Complete End-to-End Integration Test")

    // Phase 1: QC Onboarding
    console.log("\n=== PHASE 1: QC ONBOARDING ===")
    await this.runQCOnboarding()

    // Phase 2: Reserve Attestation
    console.log("\n=== PHASE 2: RESERVE ATTESTATION ===")
    await this.runReserveAttestation()

    // Phase 3: User Minting
    console.log("\n=== PHASE 3: USER MINTING ===")
    await this.runUserMinting()

    // Phase 4: User Redemption
    console.log("\n=== PHASE 4: USER REDEMPTION ===")
    await this.runUserRedemption()

    // Phase 5: System Verification
    console.log("\n=== PHASE 5: SYSTEM VERIFICATION ===")
    await this.runSystemVerification()

    console.log(
      "\n🎉 Complete End-to-End Integration Test completed successfully"
    )
  }

  async runPolicyUpgradeTest(): Promise<void> {
    console.log("🚀 Starting Policy Upgrade Test")

    // Setup initial system
    await this.runQCOnboarding()
    await this.runReserveAttestation()

    // Test minting with original policy
    console.log("Step 1: Testing with original policy...")
    const mintAmount = ethers.utils.parseEther("2")

    await this.qcMinter
      .connect(this.user)
      .requestQCMint(this.qc.address, mintAmount)
    console.log("✅ Original policy minting works")

    // Deploy new policy
    console.log("Step 2: Deploying new policy...")
    const NewMintingPolicy = await ethers.getContractFactory(
      "BasicMintingPolicy"
    )
    const newMintingPolicy = await NewMintingPolicy.deploy(
      this.protocolRegistry.address
    )
    await newMintingPolicy.deployed()

    // Initialize new policy with different parameters
    await newMintingPolicy.setMinMintAmount(ethers.utils.parseEther("0.5"))
    await newMintingPolicy.setMaxMintAmount(ethers.utils.parseEther("5"))
    await newMintingPolicy.setAttestationStaleThreshold(7200) // 2 hours
    console.log("✅ New policy deployed")

    // Update registry
    console.log("Step 3: Updating registry...")
    await this.protocolRegistry
      .connect(this.deployer)
      .setService(this.SERVICE_KEYS.MINTING_POLICY, newMintingPolicy.address)
    console.log("✅ Registry updated")

    // Test minting with new policy
    console.log("Step 4: Testing with new policy...")
    const newMintAmount = ethers.utils.parseEther("0.5") // Should work with new min

    await this.qcMinter
      .connect(this.user)
      .requestQCMint(this.qc.address, newMintAmount)
    console.log("✅ New policy minting works")

    // Verify old limits don't apply
    console.log("Step 5: Verifying policy switch...")
    const oldMinAmount = this.TEST_PARAMS.MIN_MINT_AMOUNT // 0.1 ETH

    if (oldMinAmount.lt(ethers.utils.parseEther("0.5"))) {
      // This should now fail with new policy
      await expect(
        this.qcMinter
          .connect(this.user)
          .requestQCMint(this.qc.address, oldMinAmount)
      ).to.be.revertedWith("Amount too small")
    }

    console.log("✅ Policy upgrade completed successfully")
  }

  async runEmergencyScenarios(): Promise<void> {
    console.log("🚀 Starting Emergency Scenarios Test")

    await this.runQCOnboarding()
    await this.runReserveAttestation()

    // Test 1: Emergency pause
    console.log("Test 1: Emergency pause...")

    await this.systemState.connect(this.emergencyCouncil).pauseSystem()

    // Verify all operations are paused
    await expect(
      this.qcMinter
        .connect(this.user)
        .requestQCMint(this.qc.address, ethers.utils.parseEther("1"))
    ).to.be.revertedWith("System paused")

    await expect(
      this.qcRedeemer
        .connect(this.user)
        .initiateRedemption(
          this.qc.address,
          ethers.utils.parseEther("1"),
          "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
        )
    ).to.be.revertedWith("System paused")

    console.log("✅ Emergency pause working correctly")

    // Test 2: Emergency unpause
    console.log("Test 2: Emergency unpause...")

    await this.systemState.connect(this.emergencyCouncil).unpauseSystem()

    // Verify operations resume
    await expect(
      this.qcMinter
        .connect(this.user)
        .requestQCMint(this.qc.address, ethers.utils.parseEther("1"))
    ).to.not.be.reverted

    console.log("✅ Emergency unpause working correctly")

    // Test 3: QC emergency revocation
    console.log("Test 3: QC emergency revocation...")

    await this.qcManager.connect(this.watchdog).setQCStatus(this.qc.address, 3) // Revoked

    // Verify QC cannot mint
    await expect(
      this.qcMinter
        .connect(this.user)
        .requestQCMint(this.qc.address, ethers.utils.parseEther("1"))
    ).to.be.revertedWith("QC not active")

    console.log("✅ QC revocation working correctly")

    console.log("🎉 Emergency scenarios test completed")
  }

  async runStressTest(): Promise<void> {
    console.log("🚀 Starting System Stress Test")

    await this.runQCOnboarding()
    await this.runReserveAttestation()

    // Test 1: High volume minting
    console.log("Test 1: High volume minting...")

    const users = await ethers.getSigners()
    const mintAmount = ethers.utils.parseEther("1")
    const mintPromises = []

    for (let i = 3; i < 10; i++) {
      // Use signers 3-9 (skip deployer, governance, qc)
      mintPromises.push(
        this.qcMinter
          .connect(users[i])
          .requestQCMint(this.qc.address, mintAmount)
      )
    }

    const results = await Promise.allSettled(mintPromises)
    const successful = results.filter((r) => r.status === "fulfilled").length
    const failed = results.filter((r) => r.status === "rejected").length

    console.log(
      `✅ High volume minting: ${successful} successful, ${failed} failed`
    )

    // Test 2: Capacity exhaustion
    console.log("Test 2: Capacity exhaustion...")

    const availableCapacity = await this.qcManager.getAvailableMintingCapacity(
      this.qc.address
    )
    console.log(
      `Available capacity: ${ethers.utils.formatEther(availableCapacity)} tBTC`
    )

    if (availableCapacity.gt(0)) {
      // Try to mint more than available
      const excessiveAmount = availableCapacity.add(
        ethers.utils.parseEther("1")
      )

      await expect(
        this.qcMinter
          .connect(users[10])
          .requestQCMint(this.qc.address, excessiveAmount)
      ).to.be.revertedWith("Insufficient capacity")
    }

    console.log("✅ Capacity exhaustion handled correctly")

    // Test 3: Rapid attestation updates
    console.log("Test 3: Rapid attestation updates...")

    for (let i = 0; i < 5; i++) {
      const reserves = ethers.utils.parseEther(`${100 + i * 10}`)
      const timestamp = await this.getBlockTimestamp()

      await this.qcQCReserveLedger
        .connect(this.watchdog)
        .submitAttestation(this.qc.address, reserves, timestamp)

      await this.advanceTime(60) // 1 minute between attestations
    }

    console.log("✅ Rapid attestation updates handled correctly")

    console.log("🎉 Stress test completed")
  }

  private async runQCOnboarding(): Promise<void> {
    console.log("Running QC Onboarding...")

    // Queue QC onboarding
    await this.qcManager
      .connect(this.governance)
      .registerQC(this.qc.address, this.TEST_PARAMS.MAX_MINTING_CAP)

    // Wait for timelock
    await this.advanceTime(this.TEST_PARAMS.GOVERNANCE_DELAY)

    // Execute onboarding
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

    // Verify QC is active
    const qcStatus = await this.qcManager.getQCStatus(this.qc.address)
    expect(qcStatus).to.equal(1) // Active

    console.log("✅ QC Onboarding completed")
  }

  private async runReserveAttestation(): Promise<void> {
    console.log("Running Reserve Attestation...")

    const totalReserves = ethers.utils.parseEther("200")
    const currentTimestamp = await this.getBlockTimestamp()

    await this.qcQCReserveLedger
      .connect(this.watchdog)
      .submitAttestation(this.qc.address, totalReserves, currentTimestamp)

    // Verify attestation stored
    const lastAttestationTime =
      await this.qcQCReserveLedger.getLastAttestationTime(this.qc.address)
    expect(lastAttestationTime).to.equal(currentTimestamp)

    console.log("✅ Reserve Attestation completed")
  }

  private async runUserMinting(): Promise<void> {
    console.log("Running User Minting...")

    const mintAmount = ethers.utils.parseEther("10")
    const userInitialBalance = await this.tbtc.balanceOf(this.user.address)

    await this.qcMinter
      .connect(this.user)
      .requestQCMint(this.qc.address, mintAmount)

    // Verify minting completed
    const userFinalBalance = await this.tbtc.balanceOf(this.user.address)
    expect(userFinalBalance.sub(userInitialBalance)).to.equal(mintAmount)

    // Verify QC minted amount updated
    const qcData = await this.qcManager.getQCData(this.qc.address)
    expect(qcData.mintedAmount).to.equal(mintAmount)

    console.log("✅ User Minting completed")
  }

  private async runUserRedemption(): Promise<void> {
    console.log("Running User Redemption...")

    const redeemAmount = ethers.utils.parseEther("5")
    const btcAddress = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"

    const userInitialBalance = await this.tbtc.balanceOf(this.user.address)

    // Initiate redemption
    const redeemTx = await this.qcRedeemer
      .connect(this.user)
      .initiateRedemption(this.qc.address, redeemAmount, btcAddress)

    const redeemReceipt = await redeemTx.wait()
    const redemptionEvent = redeemReceipt.events?.find(
      (e) => e.event === "RedemptionRequested"
    )
    const redemptionId = redemptionEvent.args?.redemptionId

    // Verify tokens were burned
    const userFinalBalance = await this.tbtc.balanceOf(this.user.address)
    expect(userInitialBalance.sub(userFinalBalance)).to.equal(redeemAmount)

    // Fulfill redemption
    const fulfillmentProof = this.generateFulfillmentProof(
      redemptionId,
      btcAddress,
      redeemAmount
    )
    await this.basicRedemptionPolicy
      .connect(this.watchdog)
      .recordFulfillment(redemptionId, fulfillmentProof)

    // Verify redemption fulfilled
    const redemption = await this.qcRedeemer.getRedemption(redemptionId)
    expect(redemption.status).to.equal(2) // Fulfilled

    console.log("✅ User Redemption completed")
  }

  private async runSystemVerification(): Promise<void> {
    console.log("Running System Verification...")

    // Verify QC state
    const qcData = await this.qcManager.getQCData(this.qc.address)
    expect(qcData.status).to.equal(1) // Active
    expect(qcData.mintedAmount).to.equal(ethers.utils.parseEther("10"))
    expect(qcData.redeemedAmount).to.equal(ethers.utils.parseEther("5"))

    // Verify available capacity
    const availableCapacity = await this.qcManager.getAvailableMintingCapacity(
      this.qc.address
    )
    expect(availableCapacity).to.be.greaterThan(0)

    // Verify attestation is fresh
    const lastAttestationTime =
      await this.qcQCReserveLedger.getLastAttestationTime(this.qc.address)
    const currentTime = await this.getBlockTimestamp()
    expect(currentTime - lastAttestationTime).to.be.lte(
      this.TEST_PARAMS.ATTESTATION_STALE_THRESHOLD
    )

    // Verify system is not paused
    const systemPaused = await this.systemState.isSystemPaused()
    expect(systemPaused).to.be.false

    console.log("✅ System Verification completed")
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
