import { expect } from "chai"
import { ethers } from "hardhat"
import { BaseAccountControlIntegration } from "./BaseAccountControlIntegration.test"

describe("QC Onboarding Integration Flow (QC-ONBOARD-001)", () => {
  let integration: QCOnboardingIntegration

  beforeEach(async () => {
    integration = new QCOnboardingIntegration()
    await integration.setupBase()
  })

  it("should complete full QC onboarding flow", async () => {
    await integration.runTest()
  })

  it("should handle QC onboarding with multiple wallets", async () => {
    await integration.runMultipleWalletTest()
  })

  it("should handle onboarding errors gracefully", async () => {
    await integration.runErrorScenarios()
  })
})

class QCOnboardingIntegration extends BaseAccountControlIntegration {
  async runTest(): Promise<void> {
    console.log("🚀 Starting QC Onboarding Integration Test")

    // Step 1: Queue QC Onboarding (Time-locked)
    console.log("Step 1: Queueing QC onboarding...")
    
    const queueTx = await this.qcManager
      .connect(this.governance)
      .registerQC(this.qc.address, this.TEST_PARAMS.MAX_MINTING_CAP)
    
    const queueReceipt = await queueTx.wait()
    console.log("✅ QC onboarding queued")

    // Verify queued event
    const queueEvent = queueReceipt.events?.find(e => e.event === "QCOnboardingQueued")
    expect(queueEvent).to.exist
    expect(queueEvent.args?.qc).to.equal(this.qc.address)
    expect(queueEvent.args?.maxMintingCap).to.equal(this.TEST_PARAMS.MAX_MINTING_CAP)

    // Step 2: Wait for time-lock period
    console.log("Step 2: Waiting for time-lock period...")
    await this.advanceTime(this.TEST_PARAMS.GOVERNANCE_DELAY)
    console.log("✅ Time-lock period elapsed")

    // Step 3: Execute QC Onboarding
    console.log("Step 3: Executing QC onboarding...")
    
    const executeTx = await this.qcManager
      .connect(this.governance)
      .registerQC(this.qc.address, this.TEST_PARAMS.MAX_MINTING_CAP)
    
    const executeReceipt = await executeTx.wait()
    console.log("✅ QC onboarding executed")

    // Verify execution event
    const executeEvent = executeReceipt.events?.find(e => e.event === "QCOnboarded")
    expect(executeEvent).to.exist
    expect(executeEvent.args?.qc).to.equal(this.qc.address)

    // Verify QC status is now Active
    const qcStatus = await this.qcManager.getQCStatus(this.qc.address)
    expect(qcStatus).to.equal(1) // Active
    console.log("✅ QC status set to Active")

    // Step 4: Register first Bitcoin wallet
    console.log("Step 4: Registering first Bitcoin wallet...")
    
    const btcAddress1 = this.generateBitcoinAddress()
    const proof1 = this.generateMockSPVProof()

    // QC requests wallet registration
    const requestTx = await this.qcManager
      .connect(this.qc)
      .requestWalletRegistration(btcAddress1, proof1)
    
    const requestReceipt = await requestTx.wait()
    console.log("✅ Wallet registration requested")

    // Verify request event
    const requestEvent = requestReceipt.events?.find(e => e.event === "WalletRegistrationRequested")
    expect(requestEvent).to.exist
    expect(requestEvent.args?.qc).to.equal(this.qc.address)
    expect(requestEvent.args?.btcAddress).to.equal(btcAddress1)

    // Watchdog finalizes registration
    const finalizeTx = await this.qcManager
      .connect(this.watchdog)
      .finalizeWalletRegistration(this.qc.address, btcAddress1)
    
    const finalizeReceipt = await finalizeTx.wait()
    console.log("✅ Wallet registration finalized")

    // Verify finalization event
    const finalizeEvent = finalizeReceipt.events?.find(e => e.event === "WalletRegistered")
    expect(finalizeEvent).to.exist
    expect(finalizeEvent.args?.qc).to.equal(this.qc.address)
    expect(finalizeEvent.args?.btcAddress).to.equal(btcAddress1)

    // Verify wallet status is Active
    const walletStatus = await this.qcManager.getWalletStatus(this.qc.address, btcAddress1)
    expect(walletStatus).to.equal(1) // Active
    console.log("✅ Bitcoin wallet registered successfully")

    // Step 5: Verify QC can now participate in system
    console.log("Step 5: Verifying QC system participation...")
    
    // Check QC data
    const qcData = await this.qcManager.getQCData(this.qc.address)
    expect(qcData.status).to.equal(1) // Active
    expect(qcData.maxMintingCap).to.equal(this.TEST_PARAMS.MAX_MINTING_CAP)
    expect(qcData.mintedAmount).to.equal(0)

    // Verify wallet is in the QC's wallet list
    const wallets = await this.qcManager.getQCWallets(this.qc.address)
    expect(wallets).to.include(btcAddress1)

    console.log("🎉 QC Onboarding Integration Test completed successfully")
  }

  async runMultipleWalletTest(): Promise<void> {
    console.log("🚀 Starting Multiple Wallet Registration Test")

    // First complete basic onboarding
    await this.basicOnboarding()

    // Register additional wallets
    const btcAddress2 = this.generateBitcoinAddress()
    const btcAddress3 = this.generateBitcoinAddress()

    // Register second wallet
    await this.qcManager
      .connect(this.qc)
      .requestWalletRegistration(btcAddress2, this.generateMockSPVProof())
    
    await this.qcManager
      .connect(this.watchdog)
      .finalizeWalletRegistration(this.qc.address, btcAddress2)

    // Register third wallet
    await this.qcManager
      .connect(this.qc)
      .requestWalletRegistration(btcAddress3, this.generateMockSPVProof())
    
    await this.qcManager
      .connect(this.watchdog)
      .finalizeWalletRegistration(this.qc.address, btcAddress3)

    // Verify all wallets are registered
    const wallets = await this.qcManager.getQCWallets(this.qc.address)
    expect(wallets).to.have.length(3)
    expect(wallets).to.include(btcAddress2)
    expect(wallets).to.include(btcAddress3)

    console.log("✅ Multiple wallet registration test completed")
  }

  async runErrorScenarios(): Promise<void> {
    console.log("🚀 Starting Error Scenarios Test")

    // Test 1: Attempt to execute before time-lock
    await this.qcManager
      .connect(this.governance)
      .registerQC(this.qc.address, this.TEST_PARAMS.MAX_MINTING_CAP)

    await expect(
      this.qcManager
        .connect(this.governance)
        .registerQC(this.qc.address, this.TEST_PARAMS.MAX_MINTING_CAP)
    ).to.be.revertedWith("Time-lock not expired")

    // Test 2: Attempt to onboard same QC twice
    await this.advanceTime(this.TEST_PARAMS.GOVERNANCE_DELAY)
    await this.qcManager
      .connect(this.governance)
      .registerQC(this.qc.address, this.TEST_PARAMS.MAX_MINTING_CAP)

    await expect(
      this.qcManager
        .connect(this.governance)
        .registerQC(this.qc.address, this.TEST_PARAMS.MAX_MINTING_CAP)
    ).to.be.revertedWith("QC already exists")

    // Test 3: Unauthorized wallet registration
    const btcAddress = this.generateBitcoinAddress()
    await expect(
      this.qcManager
        .connect(this.user)
        .requestWalletRegistration(btcAddress, this.generateMockSPVProof())
    ).to.be.revertedWith("Only QC can request wallet registration")

    // Test 4: Unauthorized wallet finalization
    await this.qcManager
      .connect(this.qc)
      .requestWalletRegistration(btcAddress, this.generateMockSPVProof())

    await expect(
      this.qcManager
        .connect(this.user)
        .finalizeWalletRegistration(this.qc.address, btcAddress)
    ).to.be.revertedWith("Only watchdog can finalize registration")

    console.log("✅ Error scenarios test completed")
  }

  private async basicOnboarding(): Promise<void> {
    // Queue and execute QC onboarding
    await this.qcManager
      .connect(this.governance)
      .registerQC(this.qc.address, this.TEST_PARAMS.MAX_MINTING_CAP)
    
    await this.advanceTime(this.TEST_PARAMS.GOVERNANCE_DELAY)
    
    await this.qcManager
      .connect(this.governance)
      .registerQC(this.qc.address, this.TEST_PARAMS.MAX_MINTING_CAP)

    // Register first wallet
    const btcAddress = this.generateBitcoinAddress()
    await this.qcManager
      .connect(this.qc)
      .requestWalletRegistration(btcAddress, this.generateMockSPVProof())
    
    await this.qcManager
      .connect(this.watchdog)
      .finalizeWalletRegistration(this.qc.address, btcAddress)
  }
}