import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import {
  ProtocolRegistry,
  QCMinter,
  QCRedeemer,
  QCData,
  SystemState,
  QCManager,
  QCReserveLedger,
  BasicMintingPolicy,
  BasicRedemptionPolicy,
  TBTC,
  SPVValidator,
} from "../../typechain"
import { ValidMainnetProof } from "../data/bitcoin/spv/valid-spv-proofs"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

/**
 * Cross-Contract Real Integration Tests - Advanced Scenarios
 * 
 * This test suite focuses on complex cross-contract interactions that can only
 * be properly tested with real contract deployments. These tests verify:
 * 
 * - State synchronization across multiple contracts
 * - Complex transaction ordering scenarios  
 * - Real gas cost implications for multi-contract operations
 * - Edge cases in cross-contract communication
 * - System behavior under stress conditions
 */
describe("Cross-Contract Real Integration - Advanced Scenarios", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qc1: SignerWithAddress
  let qc2: SignerWithAddress
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let watchdog: SignerWithAddress
  let maliciousActor: SignerWithAddress

  // Real contract instances - no mocks
  let protocolRegistry: ProtocolRegistry
  let qcMinter: QCMinter
  let qcRedeemer: QCRedeemer
  let qcData: QCData
  let systemState: SystemState
  let qcManager: QCManager
  let qcReserveLedger: QCReserveLedger
  let basicMintingPolicy: BasicMintingPolicy
  let basicRedemptionPolicy: BasicRedemptionPolicy
  let tbtc: TBTC
  let spvValidator: SPVValidator

  // Service and role constants
  let QC_DATA_KEY: string
  let SYSTEM_STATE_KEY: string
  let QC_MANAGER_KEY: string
  let QC_RESERVE_LEDGER_KEY: string
  let MINTING_POLICY_KEY: string
  let REDEMPTION_POLICY_KEY: string
  let TBTC_TOKEN_KEY: string
  let SPV_VALIDATOR_KEY: string

  let MINTER_ROLE: string
  let REDEEMER_ROLE: string
  let ARBITER_ROLE: string
  let PAUSER_ROLE: string
  let QC_ADMIN_ROLE: string
  let QC_MANAGER_ROLE: string
  let ATTESTER_ROLE: string

  const TEST_AMOUNTS = {
    SMALL: ethers.utils.parseEther("1"),
    MEDIUM: ethers.utils.parseEther("10"),
    LARGE: ethers.utils.parseEther("50"),
    RESERVE: ethers.utils.parseEther("200"),
  }

  const TEST_BTC_ADDRESSES = {
    QC1: "bc1qtest123456789",
    QC2: "bc1qtest987654321", 
    USER1: "bc1quser111111111",
    USER2: "bc1quser222222222",
  }

  before(async () => {
    ;[deployer, governance, qc1, qc2, user1, user2, watchdog, maliciousActor] = 
      await ethers.getSigners()

    // Initialize keys and roles
    QC_DATA_KEY = ethers.utils.id("QC_DATA")
    SYSTEM_STATE_KEY = ethers.utils.id("SYSTEM_STATE")
    QC_MANAGER_KEY = ethers.utils.id("QC_MANAGER")
    QC_RESERVE_LEDGER_KEY = ethers.utils.id("QC_RESERVE_LEDGER")
    MINTING_POLICY_KEY = ethers.utils.id("MINTING_POLICY")
    REDEMPTION_POLICY_KEY = ethers.utils.id("REDEMPTION_POLICY")
    TBTC_TOKEN_KEY = ethers.utils.id("TBTC_TOKEN")
    SPV_VALIDATOR_KEY = ethers.utils.id("SPV_VALIDATOR")

    MINTER_ROLE = ethers.utils.id("MINTER_ROLE")
    REDEEMER_ROLE = ethers.utils.id("REDEEMER_ROLE")
    ARBITER_ROLE = ethers.utils.id("ARBITER_ROLE")
    PAUSER_ROLE = ethers.utils.id("PAUSER_ROLE")
    QC_ADMIN_ROLE = ethers.utils.id("QC_ADMIN_ROLE")
    QC_MANAGER_ROLE = ethers.utils.id("QC_MANAGER_ROLE")
    ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE")
  })

  beforeEach(async () => {
    await createSnapshot()
    await deployAndConfigureRealContracts()
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  async function deployAndConfigureRealContracts() {
    // Deploy all contracts
    protocolRegistry = await (await ethers.getContractFactory("ProtocolRegistry")).deploy()
    systemState = await (await ethers.getContractFactory("SystemState")).deploy()
    qcData = await (await ethers.getContractFactory("QCData")).deploy()
    qcReserveLedger = await (await ethers.getContractFactory("QCReserveLedger")).deploy()
    tbtc = await (await ethers.getContractFactory("TBTC")).deploy()
    spvValidator = await (await ethers.getContractFactory("SPVValidator")).deploy()
    
    qcManager = await (await ethers.getContractFactory("QCManager")).deploy(
      protocolRegistry.address,
      systemState.address,
      qcData.address,
      qcReserveLedger.address
    )
    
    basicMintingPolicy = await (await ethers.getContractFactory("BasicMintingPolicy")).deploy(protocolRegistry.address)
    basicRedemptionPolicy = await (await ethers.getContractFactory("BasicRedemptionPolicy")).deploy(protocolRegistry.address)
    qcMinter = await (await ethers.getContractFactory("QCMinter")).deploy(protocolRegistry.address)
    qcRedeemer = await (await ethers.getContractFactory("QCRedeemer")).deploy(protocolRegistry.address)

    // Register services
    await protocolRegistry.setService(QC_DATA_KEY, qcData.address)
    await protocolRegistry.setService(SYSTEM_STATE_KEY, systemState.address)
    await protocolRegistry.setService(QC_MANAGER_KEY, qcManager.address)
    await protocolRegistry.setService(QC_RESERVE_LEDGER_KEY, qcReserveLedger.address)
    await protocolRegistry.setService(MINTING_POLICY_KEY, basicMintingPolicy.address)
    await protocolRegistry.setService(REDEMPTION_POLICY_KEY, basicRedemptionPolicy.address)
    await protocolRegistry.setService(TBTC_TOKEN_KEY, tbtc.address)
    await protocolRegistry.setService(SPV_VALIDATOR_KEY, spvValidator.address)

    // Configure roles
    await qcData.grantRole(QC_MANAGER_ROLE, qcManager.address)
    await qcData.grantRole(QC_MANAGER_ROLE, deployer.address)
    await systemState.grantRole(PAUSER_ROLE, watchdog.address)
    await qcManager.grantRole(QC_ADMIN_ROLE, deployer.address)
    await qcManager.grantRole(ARBITER_ROLE, watchdog.address)
    await qcReserveLedger.grantRole(ATTESTER_ROLE, watchdog.address)
    await basicMintingPolicy.grantRole(MINTER_ROLE, qcMinter.address)
    await basicRedemptionPolicy.grantRole(REDEEMER_ROLE, qcRedeemer.address)
    await basicRedemptionPolicy.grantRole(ARBITER_ROLE, deployer.address)
    await qcMinter.grantRole(MINTER_ROLE, user1.address)
    await qcMinter.grantRole(MINTER_ROLE, user2.address)
    await qcRedeemer.grantRole(ARBITER_ROLE, deployer.address)
    
    const MINTER_ROLE_TBTC = await tbtc.MINTER_ROLE()
    await tbtc.grantRole(MINTER_ROLE_TBTC, qcMinter.address)
  }

  async function setupQCWithReserves(qcAddress: string, btcAddress: string, reserveAmount = TEST_AMOUNTS.RESERVE) {
    await qcData.registerQC(qcAddress)
    await qcManager.registerWallet(qcAddress, btcAddress)
    await qcReserveLedger.connect(watchdog).submitAttestation(qcAddress, reserveAmount)
    await qcManager.setQCStatus(qcAddress, 0, ethers.utils.id("SETUP"))
  }

  // =================== ADVANCED CROSS-CONTRACT SCENARIOS ===================

  describe("State Synchronization Stress Tests", () => {
    beforeEach(async () => {
      await setupQCWithReserves(qc1.address, TEST_BTC_ADDRESSES.QC1)
      await setupQCWithReserves(qc2.address, TEST_BTC_ADDRESSES.QC2)
    })

    it("should maintain state consistency during rapid status changes", async () => {
      console.log("Testing rapid state changes across multiple contracts...")
      
      // Initial state verification
      expect(await qcData.getQCStatus(qc1.address)).to.equal(0) // Active
      expect(await basicMintingPolicy.getAvailableMintingCapacity(qc1.address)).to.be.gt(0)
      
      // Rapid status changes
      const statusChanges = [
        () => qcManager.connect(watchdog).setQCStatus(qc1.address, 1, ethers.utils.id("REVIEW_1")), // UnderReview
        () => qcManager.connect(watchdog).setQCStatus(qc1.address, 0, ethers.utils.id("ACTIVE_1")), // Back to Active  
        () => qcManager.connect(watchdog).setQCStatus(qc1.address, 1, ethers.utils.id("REVIEW_2")), // UnderReview again
        () => qcManager.connect(watchdog).setQCStatus(qc1.address, 2, ethers.utils.id("REVOKE_1")), // Revoked
      ]
      
      // Execute rapid changes
      for (const change of statusChanges) {
        await change()
        
        // Verify state consistency across all contracts after each change
        const status = await qcData.getQCStatus(qc1.address)
        const capacity = await basicMintingPolicy.getAvailableMintingCapacity(qc1.address)
        
        if (status === 0) { // Active
          expect(capacity).to.be.gt(0)
        } else { // UnderReview or Revoked
          expect(capacity).to.equal(0)
        }
      }
      
      // Final verification - QC should be revoked
      expect(await qcData.getQCStatus(qc1.address)).to.equal(2)
      expect(await basicMintingPolicy.getAvailableMintingCapacity(qc1.address)).to.equal(0)
    })

    it("should handle reserve updates affecting multiple contract states", async () => {
      // Initial capacity check
      const initialCapacity = await basicMintingPolicy.getAvailableMintingCapacity(qc1.address)
      expect(initialCapacity).to.be.gt(0)
      
      // Drastically reduce reserves
      const lowReserves = ethers.utils.parseEther("1") // Very low
      await qcReserveLedger.connect(watchdog).submitAttestation(qc1.address, lowReserves)
      
      // Verify capacity updated across system
      const newCapacity = await basicMintingPolicy.getAvailableMintingCapacity(qc1.address)
      expect(newCapacity).to.be.lt(initialCapacity)
      expect(newCapacity).to.be.lte(lowReserves)
      
      // Attempt large mint (should fail due to insufficient capacity)
      await expect(
        qcMinter.connect(user1).requestQCMint(qc1.address, TEST_AMOUNTS.LARGE)
      ).to.be.reverted
      
      // Small mint should still work
      await expect(
        qcMinter.connect(user1).requestQCMint(qc1.address, TEST_AMOUNTS.SMALL)
      ).to.not.be.reverted
    })
  })

  describe("Complex Transaction Ordering", () => {
    beforeEach(async () => {
      await setupQCWithReserves(qc1.address, TEST_BTC_ADDRESSES.QC1, TEST_AMOUNTS.MEDIUM.mul(3))
    })

    it("should handle interleaved mint and emergency pause operations", async () => {
      console.log("Testing interleaved operations with emergency pause...")
      
      // Start a mint transaction
      const mintPromise = qcMinter.connect(user1).requestQCMint(qc1.address, TEST_AMOUNTS.MEDIUM)
      
      // Immediately pause the QC (this should not affect the ongoing mint if it's already committed)
      const pausePromise = systemState.connect(watchdog).emergencyPauseQC(qc1.address, ethers.utils.id("EMERGENCY"))
      
      // Wait for both transactions to complete
      const results = await Promise.allSettled([mintPromise, pausePromise])
      
      // Both should succeed
      expect(results[0].status).to.equal('fulfilled')
      expect(results[1].status).to.equal('fulfilled')
      
      // Verify final state
      expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.true
      expect(await tbtc.balanceOf(user1.address)).to.equal(TEST_AMOUNTS.MEDIUM) // Mint completed
      
      // Subsequent mints should fail
      await expect(
        qcMinter.connect(user2).requestQCMint(qc1.address, TEST_AMOUNTS.SMALL)
      ).to.be.revertedWith("QCIsEmergencyPaused")
    })

    it("should handle concurrent capacity exhaustion scenarios", async () => {
      // Setup QC with exactly enough capacity for 2 medium mints
      const exactCapacity = TEST_AMOUNTS.MEDIUM.mul(2)
      await qcReserveLedger.connect(watchdog).submitAttestation(qc1.address, exactCapacity)
      
      console.log("Testing concurrent capacity exhaustion...")
      
      // Two users try to mint simultaneously - should use up all capacity
      const mintPromises = [
        qcMinter.connect(user1).requestQCMint(qc1.address, TEST_AMOUNTS.MEDIUM),
        qcMinter.connect(user2).requestQCMint(qc1.address, TEST_AMOUNTS.MEDIUM),
      ]
      
      await Promise.all(mintPromises)
      
      // Verify both mints succeeded
      expect(await tbtc.balanceOf(user1.address)).to.equal(TEST_AMOUNTS.MEDIUM)
      expect(await tbtc.balanceOf(user2.address)).to.equal(TEST_AMOUNTS.MEDIUM)
      
      // Capacity should be exhausted
      expect(await basicMintingPolicy.getAvailableMintingCapacity(qc1.address)).to.equal(0)
      
      // Third mint should fail
      await expect(
        qcMinter.connect(user1).requestQCMint(qc1.address, TEST_AMOUNTS.SMALL)
      ).to.be.reverted
    })
  })

  describe("Gas Cost Analysis for Complex Operations", () => {
    beforeEach(async () => {
      await setupQCWithReserves(qc1.address, TEST_BTC_ADDRESSES.QC1)
    })

    it("should measure gas costs for complete mint-to-redemption cycle", async () => {
      console.log("Analyzing gas costs for complete cycle...")
      
      const gasResults: { [key: string]: number } = {}
      
      // === MINT PHASE ===
      const mintTx = await qcMinter.connect(user1).requestQCMint(qc1.address, TEST_AMOUNTS.MEDIUM)
      gasResults.mint = (await mintTx.wait()).gasUsed.toNumber()
      
      // === REDEMPTION INITIATION ===
      await tbtc.connect(user1).approve(qcRedeemer.address, TEST_AMOUNTS.MEDIUM)
      const redemptionTx = await qcRedeemer.connect(user1).initiateRedemption(
        qc1.address,
        TEST_AMOUNTS.MEDIUM,
        TEST_BTC_ADDRESSES.USER1
      )
      gasResults.redemptionInitiation = (await redemptionTx.wait()).gasUsed.toNumber()
      
      // Extract redemption ID
      const redemptionReceipt = await redemptionTx.wait()
      const redemptionEvent = redemptionReceipt.events?.find(e => e.event === 'RedemptionRequested')
      const redemptionId = redemptionEvent?.args?.redemptionId
      
      // === REDEMPTION FULFILLMENT ===
      const spvData = ValidMainnetProof
      const fulfillmentTx = await qcRedeemer.recordRedemptionFulfillment(
        redemptionId,
        TEST_BTC_ADDRESSES.USER1,
        100000,
        spvData.txInfo,
        spvData.proof
      )
      gasResults.redemptionFulfillment = (await fulfillmentTx.wait()).gasUsed.toNumber()
      
      // Log gas usage analysis
      console.log("Gas Usage Analysis:")
      console.log(`Mint: ${gasResults.mint.toLocaleString()} gas`)
      console.log(`Redemption Initiation: ${gasResults.redemptionInitiation.toLocaleString()} gas`)
      console.log(`Redemption Fulfillment: ${gasResults.redemptionFulfillment.toLocaleString()} gas`)
      console.log(`Total Cycle: ${Object.values(gasResults).reduce((a, b) => a + b, 0).toLocaleString()} gas`)
      
      // Verify reasonable gas limits
      expect(gasResults.mint).to.be.lt(400000)
      expect(gasResults.redemptionInitiation).to.be.lt(300000)
      expect(gasResults.redemptionFulfillment).to.be.lt(500000)
      
      const totalGas = Object.values(gasResults).reduce((a, b) => a + b, 0)
      expect(totalGas).to.be.lt(1200000) // Total cycle under 1.2M gas
    })

    it("should verify gas costs don't increase with system complexity", async () => {
      // Setup additional QCs to increase system complexity
      await setupQCWithReserves(qc2.address, TEST_BTC_ADDRESSES.QC2)
      
      // Measure mint gas with 1 QC
      const mint1 = await qcMinter.connect(user1).requestQCMint(qc1.address, TEST_AMOUNTS.SMALL)
      const gas1QC = (await mint1.wait()).gasUsed
      
      // Add more operations to increase state complexity
      await qcMinter.connect(user2).requestQCMint(qc2.address, TEST_AMOUNTS.SMALL)
      await systemState.connect(watchdog).emergencyPauseQC(qc2.address, ethers.utils.id("TEST"))
      await systemState.connect(watchdog).emergencyUnpauseQC(qc2.address)
      
      // Measure mint gas with complex system state
      const mint2 = await qcMinter.connect(user1).requestQCMint(qc1.address, TEST_AMOUNTS.SMALL)
      const gasComplexState = (await mint2.wait()).gasUsed
      
      // Gas should not increase significantly (within 10%)
      expect(gasComplexState).to.be.lte(gas1QC.mul(110).div(100))
      
      console.log(`Simple state gas: ${gas1QC.toNumber()}`)
      console.log(`Complex state gas: ${gasComplexState.toNumber()}`)
      console.log(`Increase: ${((gasComplexState.toNumber() / gas1QC.toNumber() - 1) * 100).toFixed(1)}%`)
    })
  })

  describe("System Recovery and Resilience", () => {
    beforeEach(async () => {
      await setupQCWithReserves(qc1.address, TEST_BTC_ADDRESSES.QC1)
      await setupQCWithReserves(qc2.address, TEST_BTC_ADDRESSES.QC2)
    })

    it("should recover gracefully from multiple simultaneous emergencies", async () => {
      console.log("Testing recovery from multiple emergencies...")
      
      // Users mint tokens from both QCs
      await qcMinter.connect(user1).requestQCMint(qc1.address, TEST_AMOUNTS.MEDIUM)
      await qcMinter.connect(user2).requestQCMint(qc2.address, TEST_AMOUNTS.MEDIUM)
      
      // Simultaneous emergencies
      const emergencyPromises = [
        systemState.connect(watchdog).emergencyPauseQC(qc1.address, ethers.utils.id("EMERGENCY_1")),
        systemState.connect(watchdog).emergencyPauseQC(qc2.address, ethers.utils.id("EMERGENCY_2")),
      ]
      
      await Promise.all(emergencyPromises)
      
      // Verify both QCs are paused
      expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.true
      expect(await systemState.isQCEmergencyPaused(qc2.address)).to.be.true
      
      // System-wide minting should be blocked
      await expect(qcMinter.connect(user1).requestQCMint(qc1.address, TEST_AMOUNTS.SMALL)).to.be.reverted
      await expect(qcMinter.connect(user2).requestQCMint(qc2.address, TEST_AMOUNTS.SMALL)).to.be.reverted
      
      // Gradual recovery - unpause one QC at a time
      await systemState.connect(watchdog).emergencyUnpauseQC(qc1.address)
      
      // Verify partial recovery
      expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.false
      expect(await systemState.isQCEmergencyPaused(qc2.address)).to.be.true
      
      await expect(qcMinter.connect(user1).requestQCMint(qc1.address, TEST_AMOUNTS.SMALL)).to.not.be.reverted
      await expect(qcMinter.connect(user2).requestQCMint(qc2.address, TEST_AMOUNTS.SMALL)).to.be.reverted
      
      // Complete recovery
      await systemState.connect(watchdog).emergencyUnpauseQC(qc2.address)
      
      // Verify full recovery
      expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.false
      expect(await systemState.isQCEmergencyPaused(qc2.address)).to.be.false
      
      await expect(qcMinter.connect(user1).requestQCMint(qc1.address, TEST_AMOUNTS.SMALL)).to.not.be.reverted
      await expect(qcMinter.connect(user2).requestQCMint(qc2.address, TEST_AMOUNTS.SMALL)).to.not.be.reverted
      
      console.log("Multi-emergency recovery completed successfully!")
    })

    it("should maintain data integrity during system stress", async () => {
      console.log("Testing data integrity under stress...")
      
      // Create system stress with rapid operations
      const stressOperations = []
      
      // Multiple users performing various operations simultaneously
      for (let i = 0; i < 5; i++) {
        stressOperations.push(
          qcMinter.connect(user1).requestQCMint(qc1.address, TEST_AMOUNTS.SMALL),
          qcMinter.connect(user2).requestQCMint(qc2.address, TEST_AMOUNTS.SMALL),
          qcReserveLedger.connect(watchdog).submitAttestation(qc1.address, TEST_AMOUNTS.RESERVE.add(i)),
          qcReserveLedger.connect(watchdog).submitAttestation(qc2.address, TEST_AMOUNTS.RESERVE.add(i * 2)),
        )
      }
      
      // Execute all operations
      await Promise.all(stressOperations)
      
      // Verify data integrity across all contracts
      const qc1Balance = await tbtc.balanceOf(user1.address)
      const qc2Balance = await tbtc.balanceOf(user2.address)
      const totalSupply = await tbtc.totalSupply()
      
      // User balances should equal total supply
      expect(qc1Balance.add(qc2Balance)).to.equal(totalSupply)
      
      // QC states should be consistent
      expect(await qcData.getQCStatus(qc1.address)).to.equal(0) // Still Active
      expect(await qcData.getQCStatus(qc2.address)).to.equal(0) // Still Active
      
      // Capacities should still be positive
      expect(await basicMintingPolicy.getAvailableMintingCapacity(qc1.address)).to.be.gt(0)
      expect(await basicMintingPolicy.getAvailableMintingCapacity(qc2.address)).to.be.gt(0)
      
      console.log(`Final user1 balance: ${ethers.utils.formatEther(qc1Balance)} tBTC`)
      console.log(`Final user2 balance: ${ethers.utils.formatEther(qc2Balance)} tBTC`)
      console.log(`Total supply: ${ethers.utils.formatEther(totalSupply)} tBTC`)
    })
  })
})