import { expect } from "chai"
import { ethers } from "hardhat"
import { BaseAccountControlIntegration } from "./BaseAccountControlIntegration.test"

describe("Reserve Attestation Integration Flow (RESERVE-ATTEST-001)", () => {
  let integration: ReserveAttestationIntegration

  beforeEach(async () => {
    integration = new ReserveAttestationIntegration()
    await integration.setupBase()
  })

  it("should complete full reserve attestation flow", async () => {
    await integration.runTest()
  })

  it("should handle undercollateralization scenario", async () => {
    await integration.runUndercollateralizedTest()
  })

  it("should handle stale attestation scenarios", async () => {
    await integration.runStaleAttestationTest()
  })

  it("should handle attestation errors gracefully", async () => {
    await integration.runErrorScenarios()
  })
})

class ReserveAttestationIntegration extends BaseAccountControlIntegration {
  async runTest(): Promise<void> {
    console.log("🚀 Starting Reserve Attestation Integration Test")

    // Step 1: Set up QC with onboarded status
    console.log("Step 1: Setting up onboarded QC...")
    await this.setupOnboardedQC()
    console.log("✅ QC onboarded with wallets")

    // Step 2: Watchdog monitors QC addresses (simulated)
    console.log("Step 2: Simulating Bitcoin address monitoring...")
    
    const qcWallets = await this.qcManager.getQCWallets(this.qc.address)
    expect(qcWallets).to.have.length.greaterThan(0)
    
    // Simulate monitoring result: QC has sufficient reserves
    const totalReserves = ethers.utils.parseEther("100") // 100 BTC in reserves
    const currentTimestamp = await this.getBlockTimestamp()
    
    console.log(`✅ Monitored ${qcWallets.length} wallets, found ${ethers.utils.formatEther(totalReserves)} BTC`)

    // Step 3: Watchdog submits attestation
    console.log("Step 3: Submitting reserve attestation...")
    
    const attestationTx = await this.qcReserveLedger
      .connect(this.watchdog)
      .submitAttestation(this.qc.address, totalReserves, currentTimestamp)
    
    const attestationReceipt = await attestationTx.wait()
    console.log("✅ Reserve attestation submitted")

    // Verify attestation event
    const attestationEvent = attestationReceipt.events?.find(e => e.event === "ReserveAttestationSubmitted")
    expect(attestationEvent).to.exist
    expect(attestationEvent.args?.qc).to.equal(this.qc.address)
    expect(attestationEvent.args?.totalReserves).to.equal(totalReserves)
    expect(attestationEvent.args?.timestamp).to.equal(currentTimestamp)

    // Step 4: Verify solvency check
    console.log("Step 4: Verifying solvency...")
    
    const qcData = await this.qcManager.getQCData(this.qc.address)
    const mintedAmount = qcData.mintedAmount
    const solvencyRatio = totalReserves.mul(100).div(mintedAmount.add(ethers.utils.parseEther("1"))) // Avoid division by zero
    
    expect(solvencyRatio).to.be.greaterThan(100) // Should be over-collateralized
    console.log(`✅ QC is solvent with ${solvencyRatio.toString()}% collateralization`)

    // Step 5: Verify QC remains active
    console.log("Step 5: Verifying QC status...")
    
    const qcStatus = await this.qcManager.getQCStatus(this.qc.address)
    expect(qcStatus).to.equal(1) // Active
    console.log("✅ QC status remains Active")

    // Step 6: Verify attestation data storage
    console.log("Step 6: Verifying attestation storage...")
    
    const lastAttestationTime = await this.qcReserveLedger.getLastAttestationTime(this.qc.address)
    expect(lastAttestationTime).to.equal(currentTimestamp)
    
    const lastAttestationAmount = await this.qcReserveLedger.getLastAttestationAmount(this.qc.address)
    expect(lastAttestationAmount).to.equal(totalReserves)
    
    console.log("✅ Attestation data stored correctly")

    // Step 7: Verify minting capacity is available
    console.log("Step 7: Verifying minting capacity...")
    
    const availableCapacity = await this.qcManager.getAvailableMintingCapacity(this.qc.address)
    expect(availableCapacity).to.be.greaterThan(0)
    console.log(`✅ Available minting capacity: ${ethers.utils.formatEther(availableCapacity)} tBTC`)

    console.log("🎉 Reserve Attestation Integration Test completed successfully")
  }

  async runUndercollateralizedTest(): Promise<void> {
    console.log("🚀 Starting Undercollateralized Scenario Test")

    // Setup QC with some minted amount
    await this.setupOnboardedQC()
    
    // Simulate some minting to create obligation
    const mintedAmount = ethers.utils.parseEther("50")
    await this.qcManager.connect(this.deployer).updateQCMintedAmount(this.qc.address, mintedAmount)
    
    // Submit attestation with insufficient reserves
    const insufficientReserves = ethers.utils.parseEther("40") // Less than minted amount
    const currentTimestamp = await this.getBlockTimestamp()
    
    const attestationTx = await this.qcReserveLedger
      .connect(this.watchdog)
      .submitAttestation(this.qc.address, insufficientReserves, currentTimestamp)
    
    const attestationReceipt = await attestationTx.wait()
    
    // Verify QC status changed to UnderReview
    const qcStatus = await this.qcManager.getQCStatus(this.qc.address)
    expect(qcStatus).to.equal(2) // UnderReview
    
    // Verify status change event
    const statusChangeEvent = attestationReceipt.events?.find(e => e.event === "QCStatusChanged")
    expect(statusChangeEvent).to.exist
    expect(statusChangeEvent.args?.qc).to.equal(this.qc.address)
    expect(statusChangeEvent.args?.oldStatus).to.equal(1) // Active
    expect(statusChangeEvent.args?.newStatus).to.equal(2) // UnderReview
    
    console.log("✅ Undercollateralized QC correctly moved to UnderReview")

    // Verify minting is now blocked
    const availableCapacity = await this.qcManager.getAvailableMintingCapacity(this.qc.address)
    expect(availableCapacity).to.equal(0)
    
    console.log("✅ Minting capacity correctly set to zero")
    console.log("🎉 Undercollateralized scenario test completed")
  }

  async runStaleAttestationTest(): Promise<void> {
    console.log("🚀 Starting Stale Attestation Test")

    await this.setupOnboardedQC()
    
    // Submit initial attestation
    const totalReserves = ethers.utils.parseEther("100")
    const oldTimestamp = await this.getBlockTimestamp()
    
    await this.qcReserveLedger
      .connect(this.watchdog)
      .submitAttestation(this.qc.address, totalReserves, oldTimestamp)
    
    // Advance time beyond stale threshold
    await this.advanceTime(this.TEST_PARAMS.ATTESTATION_STALE_THRESHOLD + 1)
    
    // Verify attestation is now stale
    const currentTimestamp = await this.getBlockTimestamp()
    const isStale = currentTimestamp - oldTimestamp > this.TEST_PARAMS.ATTESTATION_STALE_THRESHOLD
    expect(isStale).to.be.true
    
    console.log("✅ Attestation is now stale")

    // Attempt minting - should fail due to stale attestation
    const mintAmount = ethers.utils.parseEther("1")
    
    await expect(
      this.qcMinter.connect(this.user).requestQCMint(this.qc.address, mintAmount)
    ).to.be.revertedWith("Stale reserves")
    
    console.log("✅ Minting correctly blocked due to stale attestation")

    // Submit fresh attestation
    const freshTimestamp = await this.getBlockTimestamp()
    await this.qcReserveLedger
      .connect(this.watchdog)
      .submitAttestation(this.qc.address, totalReserves, freshTimestamp)
    
    // Verify minting now works
    // This would need the full minting flow to be implemented
    console.log("✅ Fresh attestation submitted, minting should work again")
    
    console.log("🎉 Stale attestation test completed")
  }

  async runErrorScenarios(): Promise<void> {
    console.log("🚀 Starting Error Scenarios Test")

    await this.setupOnboardedQC()
    
    // Test 1: Unauthorized attestation submission
    const totalReserves = ethers.utils.parseEther("100")
    const currentTimestamp = await this.getBlockTimestamp()
    
    await expect(
      this.qcReserveLedger
        .connect(this.user)
        .submitAttestation(this.qc.address, totalReserves, currentTimestamp)
    ).to.be.revertedWith("Only attester can submit attestation")
    
    console.log("✅ Unauthorized attestation correctly rejected")

    // Test 2: Attestation for non-existent QC
    await expect(
      this.qcReserveLedger
        .connect(this.watchdog)
        .submitAttestation(this.user.address, totalReserves, currentTimestamp)
    ).to.be.revertedWith("QC does not exist")
    
    console.log("✅ Non-existent QC attestation correctly rejected")

    // Test 3: Attestation with future timestamp
    const futureTimestamp = currentTimestamp + 3600
    
    await expect(
      this.qcReserveLedger
        .connect(this.watchdog)
        .submitAttestation(this.qc.address, totalReserves, futureTimestamp)
    ).to.be.revertedWith("Future timestamp not allowed")
    
    console.log("✅ Future timestamp attestation correctly rejected")

    // Test 4: Attestation with very old timestamp
    const veryOldTimestamp = currentTimestamp - (30 * 24 * 60 * 60) // 30 days ago
    
    await expect(
      this.qcReserveLedger
        .connect(this.watchdog)
        .submitAttestation(this.qc.address, totalReserves, veryOldTimestamp)
    ).to.be.revertedWith("Attestation too old")
    
    console.log("✅ Very old attestation correctly rejected")

    console.log("🎉 Error scenarios test completed")
  }

  private async setupOnboardedQC(): Promise<void> {
    // Queue and execute QC onboarding
    await this.qcManager
      .connect(this.governance)
      .queueQCOnboarding(this.qc.address, this.TEST_PARAMS.MAX_MINTING_CAP)
    
    await this.advanceTime(this.TEST_PARAMS.GOVERNANCE_DELAY)
    
    await this.qcManager
      .connect(this.governance)
      .executeQCOnboarding(this.qc.address, this.TEST_PARAMS.MAX_MINTING_CAP)

    // Register multiple Bitcoin wallets
    const btcAddresses = [
      this.generateBitcoinAddress(),
      this.generateBitcoinAddress(),
      this.generateBitcoinAddress()
    ]

    for (const btcAddress of btcAddresses) {
      await this.qcManager
        .connect(this.qc)
        .requestWalletRegistration(btcAddress, this.generateMockSPVProof())
      
      await this.qcManager
        .connect(this.watchdog)
        .finalizeWalletRegistration(this.qc.address, btcAddress)
    }
  }
}