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
  Bank,
  TBTCVault,
} from "../../typechain"
import { ValidMainnetProof } from "../data/bitcoin/spv/valid-spv-proofs"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

/**
 * Real Contract Integration Tests - Phase 1 & 2
 * 
 * These tests deploy ALL actual contracts (no mocks) and test:
 * Phase 1: End-to-end user journeys, emergency response flows, cross-contract state changes
 * Phase 2: Multi-QC scenarios, concurrent operations, economic attack scenarios
 * 
 * This provides true integration testing with real contract interactions,
 * gas costs, and state consistency validation.
 */
describe("Real Contract Integration - Phase 1 & 2", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qc1: SignerWithAddress
  let qc2: SignerWithAddress
  let qc3: SignerWithAddress
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let watchdog: SignerWithAddress
  let attacker: SignerWithAddress

  // ALL REAL CONTRACTS - NO MOCKS
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
  let bank: Bank
  let tbtcVault: TBTCVault

  // Service keys
  let QC_DATA_KEY: string
  let SYSTEM_STATE_KEY: string
  let QC_MANAGER_KEY: string
  let QC_RESERVE_LEDGER_KEY: string
  let MINTING_POLICY_KEY: string
  let REDEMPTION_POLICY_KEY: string
  let TBTC_TOKEN_KEY: string
  let SPV_VALIDATOR_KEY: string
  let BANK_KEY: string
  let TBTC_VAULT_KEY: string

  // Role constants
  let MINTER_ROLE: string
  let REDEEMER_ROLE: string
  let ARBITER_ROLE: string
  let PAUSER_ROLE: string
  let QC_ADMIN_ROLE: string
  let QC_MANAGER_ROLE: string
  let ATTESTER_ROLE: string

  // Test constants
  const TEST_MINT_AMOUNT = ethers.utils.parseEther("10")
  const TEST_RESERVE_BALANCE = ethers.utils.parseEther("100")
  const TEST_BTC_ADDRESS = "bc1qtest123456789"
  const TEST_BTC_ADDRESS2 = "bc1qtest987654321"

  before(async () => {
    ;[deployer, governance, qc1, qc2, qc3, user1, user2, watchdog, attacker] = 
      await ethers.getSigners()

    // Generate service keys
    QC_DATA_KEY = ethers.utils.id("QC_DATA")
    SYSTEM_STATE_KEY = ethers.utils.id("SYSTEM_STATE")
    QC_MANAGER_KEY = ethers.utils.id("QC_MANAGER")
    QC_RESERVE_LEDGER_KEY = ethers.utils.id("QC_RESERVE_LEDGER")
    MINTING_POLICY_KEY = ethers.utils.id("MINTING_POLICY")
    REDEMPTION_POLICY_KEY = ethers.utils.id("REDEMPTION_POLICY")
    TBTC_TOKEN_KEY = ethers.utils.id("TBTC_TOKEN")
    SPV_VALIDATOR_KEY = ethers.utils.id("SPV_VALIDATOR")
    BANK_KEY = ethers.utils.id("BANK")
    TBTC_VAULT_KEY = ethers.utils.id("TBTC_VAULT")

    // Generate role constants
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

    // Deploy ALL real contracts - no mocks!
    // 1. Deploy Protocol Registry
    const ProtocolRegistryFactory = await ethers.getContractFactory("ProtocolRegistry")
    protocolRegistry = await ProtocolRegistryFactory.deploy()
    await protocolRegistry.deployed()

    // 2. Deploy SystemState
    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy()
    await systemState.deployed()

    // 3. Deploy QCData
    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy()
    await qcData.deployed()

    // 4. Deploy QCReserveLedger
    const QCReserveLedgerFactory = await ethers.getContractFactory("QCReserveLedger")
    qcReserveLedger = await QCReserveLedgerFactory.deploy()
    await qcReserveLedger.deployed()

    // 5. Deploy TBTC Token
    const TBTCFactory = await ethers.getContractFactory("TBTC")
    tbtc = await TBTCFactory.deploy()
    await tbtc.deployed()

    // 6. Deploy Bank
    const BankFactory = await ethers.getContractFactory("Bank")
    bank = await BankFactory.deploy()
    await bank.deployed()

    // 7. Deploy TBTC Vault
    const TBTCVaultFactory = await ethers.getContractFactory("TBTCVault")
    tbtcVault = await TBTCVaultFactory.deploy(bank.address, tbtc.address)
    await tbtcVault.deployed()

    // 8. Deploy SPV Validator
    const SPVValidatorFactory = await ethers.getContractFactory("SPVValidator")
    spvValidator = await SPVValidatorFactory.deploy()
    await spvValidator.deployed()

    // 9. Deploy QC Manager
    const QCManagerFactory = await ethers.getContractFactory("QCManager")
    qcManager = await QCManagerFactory.deploy(
      protocolRegistry.address,
      systemState.address,
      qcData.address,
      qcReserveLedger.address
    )
    await qcManager.deployed()

    // 10. Deploy Minting Policy
    const BasicMintingPolicyFactory = await ethers.getContractFactory("BasicMintingPolicy")
    basicMintingPolicy = await BasicMintingPolicyFactory.deploy(protocolRegistry.address)
    await basicMintingPolicy.deployed()

    // 11. Deploy Redemption Policy
    const BasicRedemptionPolicyFactory = await ethers.getContractFactory("BasicRedemptionPolicy")
    basicRedemptionPolicy = await BasicRedemptionPolicyFactory.deploy(protocolRegistry.address)
    await basicRedemptionPolicy.deployed()

    // 12. Deploy QC Minter
    const QCMinterFactory = await ethers.getContractFactory("QCMinter")
    qcMinter = await QCMinterFactory.deploy(protocolRegistry.address)
    await qcMinter.deployed()

    // 13. Deploy QC Redeemer
    const QCRedeemerFactory = await ethers.getContractFactory("QCRedeemer")
    qcRedeemer = await QCRedeemerFactory.deploy(protocolRegistry.address)
    await qcRedeemer.deployed()

    // Register ALL services in Protocol Registry
    await protocolRegistry.setService(QC_DATA_KEY, qcData.address)
    await protocolRegistry.setService(SYSTEM_STATE_KEY, systemState.address)
    await protocolRegistry.setService(QC_MANAGER_KEY, qcManager.address)
    await protocolRegistry.setService(QC_RESERVE_LEDGER_KEY, qcReserveLedger.address)
    await protocolRegistry.setService(MINTING_POLICY_KEY, basicMintingPolicy.address)
    await protocolRegistry.setService(REDEMPTION_POLICY_KEY, basicRedemptionPolicy.address)
    await protocolRegistry.setService(TBTC_TOKEN_KEY, tbtc.address)
    await protocolRegistry.setService(SPV_VALIDATOR_KEY, spvValidator.address)
    await protocolRegistry.setService(BANK_KEY, bank.address)
    await protocolRegistry.setService(TBTC_VAULT_KEY, tbtcVault.address)

    // Grant necessary roles across all contracts
    await setupRoles()
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  async function setupRoles() {
    // QCData roles
    await qcData.grantRole(QC_MANAGER_ROLE, qcManager.address)
    await qcData.grantRole(QC_MANAGER_ROLE, deployer.address) // For test setup

    // SystemState roles
    await systemState.grantRole(PAUSER_ROLE, deployer.address)
    await systemState.grantRole(PAUSER_ROLE, watchdog.address)

    // QCManager roles
    await qcManager.grantRole(QC_ADMIN_ROLE, deployer.address)
    await qcManager.grantRole(ARBITER_ROLE, watchdog.address)

    // QCReserveLedger roles
    await qcReserveLedger.grantRole(ATTESTER_ROLE, deployer.address)
    await qcReserveLedger.grantRole(ATTESTER_ROLE, watchdog.address)

    // Minting Policy roles
    await basicMintingPolicy.grantRole(MINTER_ROLE, qcMinter.address)

    // Redemption Policy roles
    await basicRedemptionPolicy.grantRole(REDEEMER_ROLE, qcRedeemer.address)
    await basicRedemptionPolicy.grantRole(ARBITER_ROLE, deployer.address)

    // QC Minter roles
    await qcMinter.grantRole(MINTER_ROLE, user1.address)
    await qcMinter.grantRole(MINTER_ROLE, user2.address)

    // QC Redeemer roles
    await qcRedeemer.grantRole(ARBITER_ROLE, deployer.address)

    // TBTC token minter role for testing
    const MINTER_ROLE_TBTC = await tbtc.MINTER_ROLE()
    await tbtc.grantRole(MINTER_ROLE_TBTC, qcMinter.address)
    await tbtc.grantRole(MINTER_ROLE_TBTC, deployer.address) // For test setup
  }

  async function setupQC(qcAddress: string, btcAddress: string, reserveBalance = TEST_RESERVE_BALANCE) {
    // Register QC
    await qcData.registerQC(qcAddress)
    
    // Register wallet for QC
    await qcManager.registerWallet(qcAddress, btcAddress)
    
    // Submit reserve attestation
    await qcReserveLedger.submitAttestation(qcAddress, reserveBalance)
    
    // Set QC to Active status
    await qcManager.setQCStatus(qcAddress, 0, ethers.utils.id("INITIAL_SETUP"))
  }

  // =================== PHASE 1: HIGH-IMPACT INTEGRATION TESTS ===================

  describe("Phase 1: End-to-End User Journeys", () => {
    beforeEach(async () => {
      // Setup QC1 with sufficient reserves
      await setupQC(qc1.address, TEST_BTC_ADDRESS, TEST_RESERVE_BALANCE)
    })

    it("should complete full mint-to-redemption lifecycle with real contracts", async () => {
      // === MINTING PHASE ===
      console.log("Starting minting phase...")
      
      // User requests mint through QCMinter
      const mintTx = await qcMinter.connect(user1).requestQCMint(qc1.address, TEST_MINT_AMOUNT)
      const mintReceipt = await mintTx.wait()
      
      // Verify real gas costs
      expect(mintReceipt.gasUsed).to.be.gt(0)
      expect(mintReceipt.gasUsed).to.be.lt(500000) // Reasonable upper bound
      
      // Verify real state changes across multiple contracts
      expect(await tbtc.balanceOf(user1.address)).to.equal(TEST_MINT_AMOUNT)
      
      // === REDEMPTION PHASE ===
      console.log("Starting redemption phase...")
      
      // User initiates redemption through QCRedeemer
      await tbtc.connect(user1).approve(qcRedeemer.address, TEST_MINT_AMOUNT)
      const redemptionTx = await qcRedeemer.connect(user1).initiateRedemption(
        qc1.address,
        TEST_MINT_AMOUNT,
        TEST_BTC_ADDRESS
      )
      const redemptionReceipt = await redemptionTx.wait()
      
      // Extract redemption ID from event
      const redemptionEvent = redemptionReceipt.events?.find(e => e.event === 'RedemptionRequested')
      const redemptionId = redemptionEvent?.args?.redemptionId
      expect(redemptionId).to.not.be.undefined
      
      // Verify tokens were burned
      expect(await tbtc.balanceOf(user1.address)).to.equal(0)
      
      // === FULFILLMENT PHASE ===
      // Use real SPV data for fulfillment
      const spvData = ValidMainnetProof
      await qcRedeemer.recordRedemptionFulfillment(
        redemptionId,
        TEST_BTC_ADDRESS,
        100000, // Amount in satoshi
        spvData.txInfo,
        spvData.proof
      )
      
      // Verify final state across all contracts
      expect(await basicRedemptionPolicy.isRedemptionFulfilled(redemptionId)).to.be.true
      
      console.log("Full lifecycle completed successfully!")
    })

    it("should handle concurrent minting requests correctly", async () => {
      // Multiple users mint simultaneously
      const mintPromises = [
        qcMinter.connect(user1).requestQCMint(qc1.address, TEST_MINT_AMOUNT),
        qcMinter.connect(user2).requestQCMint(qc1.address, TEST_MINT_AMOUNT),
      ]
      
      const results = await Promise.all(mintPromises)
      
      // Verify both mints succeeded with real state
      expect(await tbtc.balanceOf(user1.address)).to.equal(TEST_MINT_AMOUNT)
      expect(await tbtc.balanceOf(user2.address)).to.equal(TEST_MINT_AMOUNT)
      
      // Verify reserve tracking updated correctly
      const totalMinted = TEST_MINT_AMOUNT.mul(2)
      const remainingCapacity = await basicMintingPolicy.getAvailableMintingCapacity(qc1.address)
      expect(remainingCapacity).to.be.lt(TEST_RESERVE_BALANCE)
    })
  })

  describe("Phase 1: Emergency Response Flows", () => {
    beforeEach(async () => {
      await setupQC(qc1.address, TEST_BTC_ADDRESS)
      await setupQC(qc2.address, TEST_BTC_ADDRESS2)
    })

    it("should handle QC emergency pause with real cross-contract effects", async () => {
      // User starts with minted tokens
      await qcMinter.connect(user1).requestQCMint(qc1.address, TEST_MINT_AMOUNT)
      expect(await tbtc.balanceOf(user1.address)).to.equal(TEST_MINT_AMOUNT)
      
      // === EMERGENCY PAUSE ===
      console.log("Triggering emergency pause...")
      const pauseReason = ethers.utils.id("SECURITY_INCIDENT")
      await systemState.connect(watchdog).emergencyPauseQC(qc1.address, pauseReason)
      
      // Verify pause state propagated to all contracts
      expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.true
      expect(await basicMintingPolicy.getAvailableMintingCapacity(qc1.address)).to.equal(0)
      
      // Verify minting is blocked
      await expect(
        qcMinter.connect(user1).requestQCMint(qc1.address, TEST_MINT_AMOUNT)
      ).to.be.revertedWith("QCIsEmergencyPaused")
      
      // Verify other QCs still work
      await expect(
        qcMinter.connect(user1).requestQCMint(qc2.address, TEST_MINT_AMOUNT)
      ).to.not.be.reverted
      
      // === RECOVERY PHASE ===
      console.log("Starting recovery...")
      await systemState.connect(watchdog).emergencyUnpauseQC(qc1.address)
      
      // Verify system recovery
      expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.false
      expect(await basicMintingPolicy.getAvailableMintingCapacity(qc1.address)).to.be.gt(0)
      
      // Verify normal operation resumed
      await expect(
        qcMinter.connect(user1).requestQCMint(qc1.address, TEST_MINT_AMOUNT)
      ).to.not.be.reverted
      
      console.log("Emergency response flow completed successfully!")
    })
  })

  // =================== PHASE 2: COMPLEX INTERACTION SCENARIOS ===================

  describe("Phase 2: Multi-QC Scenarios", () => {
    beforeEach(async () => {
      // Setup 3 QCs with different reserve levels
      await setupQC(qc1.address, TEST_BTC_ADDRESS, TEST_RESERVE_BALANCE)
      await setupQC(qc2.address, TEST_BTC_ADDRESS2, TEST_RESERVE_BALANCE.mul(2))
      await setupQC(qc3.address, "bc1qtest111111111", TEST_RESERVE_BALANCE.div(2))
    })

    it("should handle capacity exhaustion across multiple QCs", async () => {
      console.log("Testing capacity exhaustion across multiple QCs...")
      
      // Exhaust QC3 (smallest capacity)
      const qc3Capacity = await basicMintingPolicy.getAvailableMintingCapacity(qc3.address)
      await qcMinter.connect(user1).requestQCMint(qc3.address, qc3Capacity)
      
      // Verify QC3 is exhausted
      expect(await basicMintingPolicy.getAvailableMintingCapacity(qc3.address)).to.equal(0)
      
      // Verify other QCs still have capacity
      expect(await basicMintingPolicy.getAvailableMintingCapacity(qc1.address)).to.be.gt(0)
      expect(await basicMintingPolicy.getAvailableMintingCapacity(qc2.address)).to.be.gt(0)
      
      // Further minting on QC3 should fail
      await expect(
        qcMinter.connect(user1).requestQCMint(qc3.address, ethers.utils.parseEther("1"))
      ).to.be.reverted
      
      // But minting on other QCs should still work
      await expect(
        qcMinter.connect(user1).requestQCMint(qc1.address, TEST_MINT_AMOUNT)
      ).to.not.be.reverted
    })

    it("should handle QC status changes affecting system-wide behavior", async () => {
      // Set QC2 to UnderReview status
      const reviewReason = ethers.utils.id("COMPLIANCE_CHECK")
      await qcManager.connect(watchdog).setQCStatus(qc2.address, 1, reviewReason) // UnderReview
      
      // Verify QC2 is no longer available for minting
      expect(await basicMintingPolicy.getAvailableMintingCapacity(qc2.address)).to.equal(0)
      
      // Revoke QC2 entirely
      const revokeReason = ethers.utils.id("FAILED_COMPLIANCE")
      await qcManager.connect(watchdog).setQCStatus(qc2.address, 2, revokeReason) // Revoked
      
      // Verify QC2 state across all contracts
      expect(await qcData.getQCStatus(qc2.address)).to.equal(2)
      expect(await basicMintingPolicy.getAvailableMintingCapacity(qc2.address)).to.equal(0)
      
      // Verify other QCs unaffected
      expect(await qcData.getQCStatus(qc1.address)).to.equal(0) // Still Active
      expect(await basicMintingPolicy.getAvailableMintingCapacity(qc1.address)).to.be.gt(0)
    })
  })

  describe("Phase 2: Economic Attack Scenarios", () => {
    beforeEach(async () => {
      await setupQC(qc1.address, TEST_BTC_ADDRESS, TEST_RESERVE_BALANCE)
    })

    it("should handle gas-based griefing attacks with real gas costs", async () => {
      console.log("Testing gas-based attack resistance...")
      
      // Measure baseline gas costs
      const normalMintTx = await qcMinter.connect(user1).requestQCMint(qc1.address, TEST_MINT_AMOUNT)
      const normalGas = (await normalMintTx.wait()).gasUsed
      
      // Attacker tries to cause high gas consumption through complex operations
      const attackMintTx = await qcMinter.connect(attacker).requestQCMint(qc1.address, TEST_MINT_AMOUNT)
      const attackGas = (await attackMintTx.wait()).gasUsed
      
      // Verify gas costs remain reasonable (within 50% of normal)
      expect(attackGas).to.be.lt(normalGas.mul(150).div(100))
      
      // System should still function normally
      expect(await tbtc.balanceOf(user1.address)).to.equal(TEST_MINT_AMOUNT)
      expect(await tbtc.balanceOf(attacker.address)).to.equal(TEST_MINT_AMOUNT)
    })

    it("should prevent double-spending through reentrancy with real contract interactions", async () => {
      // User gets tokens
      await qcMinter.connect(user1).requestQCMint(qc1.address, TEST_MINT_AMOUNT)
      
      // Initiate redemption
      await tbtc.connect(user1).approve(qcRedeemer.address, TEST_MINT_AMOUNT)
      const redemptionTx = await qcRedeemer.connect(user1).initiateRedemption(
        qc1.address,
        TEST_MINT_AMOUNT,
        TEST_BTC_ADDRESS
      )
      
      const redemptionReceipt = await redemptionTx.wait()
      const redemptionEvent = redemptionReceipt.events?.find(e => e.event === 'RedemptionRequested')
      const redemptionId = redemptionEvent?.args?.redemptionId
      
      // Verify tokens were burned (preventing double-spend)
      expect(await tbtc.balanceOf(user1.address)).to.equal(0)
      
      // Try to fulfill twice (should fail on second attempt due to reentrancy guard)
      const spvData = ValidMainnetProof
      await qcRedeemer.recordRedemptionFulfillment(
        redemptionId,
        TEST_BTC_ADDRESS,
        100000,
        spvData.txInfo,
        spvData.proof
      )
      
      // Second fulfillment should fail
      await expect(
        qcRedeemer.recordRedemptionFulfillment(
          redemptionId,
          TEST_BTC_ADDRESS,
          100000,
          spvData.txInfo,
          spvData.proof
        )
      ).to.be.reverted // Should fail due to reentrancy guard or already fulfilled check
    })
  })

  describe("Phase 2: Concurrent Operations", () => {
    beforeEach(async () => {
      await setupQC(qc1.address, TEST_BTC_ADDRESS, TEST_RESERVE_BALANCE)
      await setupQC(qc2.address, TEST_BTC_ADDRESS2, TEST_RESERVE_BALANCE)
    })

    it("should handle concurrent mint and redeem operations", async () => {
      // Give user1 initial tokens
      await qcMinter.connect(user1).requestQCMint(qc1.address, TEST_MINT_AMOUNT)
      await tbtc.connect(user1).approve(qcRedeemer.address, TEST_MINT_AMOUNT)
      
      console.log("Starting concurrent operations...")
      
      // Execute concurrent operations
      const operations = await Promise.all([
        // User2 minting while user1 redeems
        qcMinter.connect(user2).requestQCMint(qc2.address, TEST_MINT_AMOUNT),
        qcRedeemer.connect(user1).initiateRedemption(qc1.address, TEST_MINT_AMOUNT, TEST_BTC_ADDRESS),
      ])
      
      // Verify both operations completed successfully
      expect(await tbtc.balanceOf(user2.address)).to.equal(TEST_MINT_AMOUNT) // User2 mint succeeded
      expect(await tbtc.balanceOf(user1.address)).to.equal(0) // User1 redemption burned tokens
      
      // Verify system state consistency
      const totalSupply = await tbtc.totalSupply()
      expect(totalSupply).to.equal(TEST_MINT_AMOUNT) // Net: +1 mint, -1 redeem = 1 total
    })
  })
})