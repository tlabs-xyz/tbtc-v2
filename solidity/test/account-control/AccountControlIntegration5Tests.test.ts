/**
 * AccountControl Integration Tests - Agent 5 Implementation
 * 
 * Implements Tests 1-5 covering complex cross-contract integration scenarios
 * as specified in the parallel implementation plan.
 */

import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

import { IntegrationTestFramework } from "../helpers/IntegrationTestFramework"

describe("AccountControl Integration Tests (Agent 5 - Tests 1-5)", () => {
  let framework: IntegrationTestFramework
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let watchdog: SignerWithAddress
  let arbiter: SignerWithAddress
  let attester1: SignerWithAddress
  let attester2: SignerWithAddress
  let attester3: SignerWithAddress
  let qcAddress: SignerWithAddress
  
  let qcWallet: string
  let btcAddress: string
  let redemptionAmount: any
  let deadline: number
  
  beforeEach(async () => {
    framework = new IntegrationTestFramework()
    await framework.deploySystem()
    
    // Extract signers for convenience
    const signers = framework.signers
    owner = signers.owner
    user = signers.user
    watchdog = signers.watchdog
    arbiter = signers.arbiter
    attester1 = signers.attester1
    attester2 = signers.attester2
    attester3 = signers.attester3
    qcAddress = signers.qcAddress
    
    // Setup test data
    qcWallet = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
    btcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
    redemptionAmount = framework.MINT_AMOUNT
    
    const block = await ethers.provider.getBlock("latest")
    deadline = block.timestamp + 86400 // 24 hours
  })

  describe("QCRedeemer Integration", () => {
    it("1) should notify AccountControl of redemption when enabled", async () => {
      // Setup: Enable AccountControl mode
      await framework.enableAccountControlMode()
      
      // Setup: Create initial mint to have tokens to redeem
      await framework.executeMint(qcAddress.address, user.address, redemptionAmount)
      const initialMinted = await framework.contracts.accountControl.totalMinted()
      
      // Action: Create redemption
      const redemptionId = await framework.executeRedemption(
        qcAddress.address,
        redemptionAmount,
        btcAddress,
        qcWallet
      )
      
      // Action: Fulfill redemption with SPV proof
      const validProof = framework.generateValidSPVProof()
      // Convert amount to uint64 (satoshis)
      const amountInSatoshis = redemptionAmount.div(framework.SATOSHI_MULTIPLIER).toNumber()
      
      const tx2 = await framework.contracts.qcRedeemer.connect(watchdog).recordRedemptionFulfillment(
        redemptionId, 
        btcAddress, 
        amountInSatoshis, // amount as uint64
        validProof.txInfo, 
        validProof.proof
      )
      
      // Verify: AccountControl was notified and state updated
      const finalMinted = await framework.contracts.accountControl.totalMinted()
      const redemptionSatoshis = redemptionAmount.div(framework.SATOSHI_MULTIPLIER)
      expect(finalMinted).to.equal(initialMinted.sub(redemptionSatoshis))
      
      // Verify: Proper event emission
      await expect(tx2).to.emit(framework.contracts.accountControl, "RedemptionProcessed")
        .withArgs(qcAddress.address, redemptionSatoshis)
    })

    it("2) should bypass AccountControl when disabled", async () => {
      // Setup: Disable AccountControl mode
      await framework.disableAccountControlMode()
      
      // Setup: Create initial state (mint through direct method to bypass AccountControl)
      const initialMinted = await framework.contracts.accountControl.totalMinted()
      
      // Action: Create redemption request (should work without AccountControl tracking)
      const redemptionId = await framework.executeRedemption(
        qcAddress.address,
        redemptionAmount,
        btcAddress,
        qcWallet
      )
      
      // Action: Fulfill redemption
      const validProof = framework.generateValidSPVProof()
      const amountInSatoshis = redemptionAmount.div(framework.SATOSHI_MULTIPLIER).toNumber()
      await framework.contracts.qcRedeemer.connect(watchdog).recordRedemptionFulfillment(
        redemptionId,
        btcAddress,
        amountInSatoshis, // amount as uint64 in satoshis
        validProof.txInfo,
        validProof.proof
      )
      
      // Verify: AccountControl was NOT called (minted amount unchanged)
      const finalMinted = await framework.contracts.accountControl.totalMinted()
      expect(finalMinted).to.equal(initialMinted) // Should be unchanged
      
      // Verify: Direct redemption was processed
      const redemption = await framework.contracts.qcRedeemer.redemptions(redemptionId)
      expect(redemption.status).to.equal(2) // RedemptionStatus.Fulfilled
    })

    it("3) should handle AccountControl mode toggling mid-operation", async () => {
      // Setup: Start with AccountControl enabled
      await framework.enableAccountControlMode()
      
      // Setup: Create initial mint
      await framework.executeMint(qcAddress.address, user.address, redemptionAmount)
      
      // Action: Create redemption while mode is enabled
      const redemptionId = await framework.executeRedemption(
        qcAddress.address,
        redemptionAmount,
        btcAddress,
        qcWallet
      )
      
      // Store initial state
      const initialState = await framework.captureSystemState()
      
      // Action: Toggle mode while redemption is pending
      await framework.disableAccountControlMode()
      
      // Action: Complete redemption (should use mode that was active when created)
      const validProof = framework.generateValidSPVProof()
      const amountInSatoshis = redemptionAmount.div(framework.SATOSHI_MULTIPLIER).toNumber()
      await framework.contracts.qcRedeemer.connect(watchdog).recordRedemptionFulfillment(
        redemptionId,
        btcAddress,
        amountInSatoshis, // amount as uint64 in satoshis
        validProof.txInfo,
        validProof.proof
      )
      
      // Verify: System handled mode change gracefully
      const finalState = await framework.captureSystemState()
      
      // The redemption should have been processed according to the mode
      // that was active when it was created (AccountControl enabled)
      const redemptionSatoshis = redemptionAmount.div(framework.SATOSHI_MULTIPLIER)
      expect(finalState.totalMinted).to.equal(initialState.totalMinted.sub(redemptionSatoshis))
      
      // Verify redemption completed successfully
      const redemption = await framework.contracts.qcRedeemer.redemptions(redemptionId)
      expect(redemption.status).to.equal(2) // RedemptionStatus.Fulfilled
    })
  })

  describe("Cross-Contract Interaction Validation", () => {
    it("4) should maintain consistent state across all contracts", async () => {
      // Setup: Complex multi-contract state
      await framework.enableAccountControlMode()
      
      const mintAmount1 = ethers.utils.parseEther("0.003") // 0.003 tBTC
      const mintAmount2 = ethers.utils.parseEther("0.002") // 0.002 tBTC
      const redemptionAmount = ethers.utils.parseEther("0.001") // 0.001 tBTC
      
      // Action: Perform multiple operations across contracts
      
      // 1. Mint operations through different calls
      await framework.executeMint(qcAddress.address, user.address, mintAmount1)
      await framework.executeMint(qcAddress.address, user.address, mintAmount2)
      
      // 2. Oracle attestation (setup backing)
      await framework.setupOracleAttestations(
        qcAddress.address, 
        ethers.utils.parseEther("0.02") // 0.02 BTC backing
      )
      
      // 3. Redemption operation
      const redemptionId = await framework.executeRedemption(
        qcAddress.address,
        redemptionAmount,
        btcAddress,
        qcWallet
      )
      
      const validProof = framework.generateValidSPVProof()
      const amountInSatoshis = redemptionAmount.div(framework.SATOSHI_MULTIPLIER).toNumber()
      await framework.contracts.qcRedeemer.connect(watchdog).recordRedemptionFulfillment(
        redemptionId,
        btcAddress,
        amountInSatoshis, // amount as uint64 in satoshis
        validProof.txInfo,
        validProof.proof
      )
      
      // Verify: State consistency across all contracts
      const accountControlMinted = await framework.contracts.accountControl.totalMinted()
      
      const expectedMinted = mintAmount1.add(mintAmount2).sub(redemptionAmount)
      const expectedSatoshis = expectedMinted.div(framework.SATOSHI_MULTIPLIER)
      
      expect(accountControlMinted).to.equal(expectedSatoshis)
      
      // Verify: All invariants maintained
      const backing = await framework.contracts.accountControl.backing(qcAddress.address)
      expect(accountControlMinted).to.be.lte(backing) // Backing >= minted
    })

    it("5) should complete full mint-redeem cycle with proper state management", async () => {
      // Setup: Full system deployment with AccountControl enabled
      await framework.enableAccountControlMode()
      
      const cycleAmount = framework.MINT_AMOUNT
      
      // Capture initial state
      const initialState = await framework.captureSystemState()
      
      // === MINT PHASE ===
      
      // Setup oracle backing
      await framework.setupOracleAttestations(
        qcAddress.address, 
        cycleAmount.mul(3) // 3x backing for safety
      )
      
      // Execute mint
      const mintTx = await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address, 
        user.address, 
        cycleAmount
      )
      await expect(mintTx).to.emit(framework.contracts.accountControl, "MintExecuted")
      
      // Capture post-mint state
      const postMintState = await framework.captureSystemState()
      
      // === REDEEM PHASE ===
      
      // Create redemption request
      const redemptionId = await framework.executeRedemption(
        qcAddress.address,
        cycleAmount,
        btcAddress,
        qcWallet
      )
      
      // Fulfill redemption
      const validProof = framework.generateValidSPVProof()
      const amountInSatoshis = cycleAmount.div(framework.SATOSHI_MULTIPLIER).toNumber()
      const redeemTx = await framework.contracts.qcRedeemer.connect(watchdog).recordRedemptionFulfillment(
        redemptionId,
        btcAddress,
        amountInSatoshis, // amount as uint64 in satoshis
        validProof.txInfo,
        validProof.proof
      )
      await expect(redeemTx).to.emit(framework.contracts.accountControl, "RedemptionProcessed")
      
      // Capture final state
      const finalState = await framework.captureSystemState()
      
      // === VERIFICATION ===
      
      const cycleSatoshis = cycleAmount.div(framework.SATOSHI_MULTIPLIER)
      
      // Verify mint phase state transitions
      expect(postMintState.totalMinted).to.equal(initialState.totalMinted.add(cycleSatoshis))
      
      // Verify redeem phase state transitions
      expect(finalState.totalMinted).to.equal(postMintState.totalMinted.sub(cycleSatoshis))
      
      // Verify full cycle returns to initial state
      expect(finalState.totalMinted).to.equal(initialState.totalMinted)
      
      // Verify redemption was completed
      const redemption = await framework.contracts.qcRedeemer.redemptions(redemptionId)
      expect(redemption.status).to.equal(2) // RedemptionStatus.Fulfilled
      
      // Verify system state consistency
      expect(finalState.accountControlMode).to.equal(initialState.accountControlMode)
      expect(finalState.systemPaused).to.equal(initialState.systemPaused)
      
      // Verify no unexpected side effects
      const backing = await framework.contracts.accountControl.backing(qcAddress.address)
      expect(finalState.totalMinted).to.be.lte(backing) // Backing constraint maintained
    })
  })
})