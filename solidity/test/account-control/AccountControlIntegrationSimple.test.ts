/**
 * AccountControl Integration Tests - Simple Version (Agent 5)
 * 
 * Simplified integration tests that focus on AccountControl functionality
 * without dependencies on complex library compilation issues.
 */

import chai, { expect } from "chai"
import { ethers, upgrades } from "hardhat"
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers"

import type { AccountControl, QCMinter, SystemState, QCData, TBTC } from "../../typechain"
import { deploySPVLibraries, getQCRedeemerLibraries } from "../helpers/spvLibraryHelpers"
import { setupSystemStateDefaults } from "../helpers/testSetupHelpers"

describe("AccountControl Integration Tests (Agent 5 - Tests 1-5)", () => {
  let accountControl: AccountControl
  let qcMinter: QCMinter
  let qcRedeemer: any // Use any to avoid complex QCRedeemer compilation
  let qcData: QCData
  let systemState: SystemState
  let tbtcToken: TBTC
  let mockBank: any
  let mockTbtcVault: any
  let mockQCManager: any
  let testRelay: any

  let owner: HardhatEthersSigner
  let emergencyCouncil: HardhatEthersSigner
  let user: HardhatEthersSigner
  let watchdog: HardhatEthersSigner
  let qcAddress: HardhatEthersSigner

  const SATOSHI_MULTIPLIER = ethers.utils.parseEther("0.00000001") // 1e10
  const QC_BACKING_AMOUNT = 1000000 // 0.01 BTC in satoshis
  const QC_MINTING_CAP = ethers.utils.parseEther("0.01") // 0.01 tBTC
  const MINT_AMOUNT = ethers.utils.parseEther("0.005") // 0.005 tBTC
  
  beforeEach(async () => {
    const signers = await ethers.getSigners()
    ;[owner, emergencyCouncil, user, watchdog, qcAddress] = signers

    // Deploy infrastructure
    const MockBank = await ethers.getContractFactory("MockBank")
    mockBank = await MockBank.deploy()
    
    const MockTBTCToken = await ethers.getContractFactory("MockTBTCToken")
    tbtcToken = await MockTBTCToken.deploy() as TBTC
    
    const MockTBTCVault = await ethers.getContractFactory("contracts/test/MockTBTCVault.sol:MockTBTCVault")
    mockTbtcVault = await MockTBTCVault.deploy()

    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy() as SystemState
    
    const TestRelay = await ethers.getContractFactory("TestRelay")
    testRelay = await TestRelay.deploy()

    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy() as QCData

    const MockQCManagerFactory = await ethers.getContractFactory("MockQCManager")
    mockQCManager = await MockQCManagerFactory.deploy()

    // Deploy AccountControl
    const AccountControlFactory = await ethers.getContractFactory("AccountControl")
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [owner.address, emergencyCouncil.address, mockBank.address],
      { initializer: "initialize" }
    ) as AccountControl

    // Deploy QCMinter 
    const QCMinterFactory = await ethers.getContractFactory("QCMinter")
    qcMinter = await QCMinterFactory.deploy(
      mockBank.address,
      mockTbtcVault.address,
      tbtcToken.address,
      qcData.address,
      systemState.address,
      mockQCManager.address
    ) as QCMinter

    // Setup basic configurations
    await setupBasicConfiguration()
  })

  async function setupBasicConfiguration() {
    // SystemState setup
    await systemState.connect(owner).grantRole(await systemState.OPERATIONS_ROLE(), owner.address)
    await setupSystemStateDefaults(systemState, owner)

    // QCData setup
    await qcData.grantRole(await qcData.QC_MANAGER_ROLE(), owner.address)
    await qcData.connect(owner).registerQC(qcAddress.address, QC_MINTING_CAP)
    await qcData.connect(owner).setQCStatus(qcAddress.address, 0, ethers.utils.formatBytes32String("Active"))

    // MockQCManager setup - register QC first, then set capacity
    await mockQCManager.registerQC(qcAddress.address, QC_MINTING_CAP)

    // Grant roles
    const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"))
    const GOVERNANCE_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("GOVERNANCE_ROLE"))
    await qcMinter.connect(owner).grantRole(MINTER_ROLE, owner.address)
    await qcMinter.connect(owner).grantRole(GOVERNANCE_ROLE, owner.address)

    // Setup AccountControl integration
    await qcMinter.connect(owner).setAccountControl(accountControl.address)
    await accountControl.connect(owner).authorizeReserve(qcAddress.address, QC_BACKING_AMOUNT)
    await accountControl.connect(owner).authorizeReserve(qcMinter.address, QC_BACKING_AMOUNT * 3)
    await accountControl.connect(qcAddress).updateBacking(QC_BACKING_AMOUNT)
    await accountControl.connect(owner).setBacking(qcMinter.address, QC_BACKING_AMOUNT * 3)
    await accountControl.connect(owner).grantQCManagerRole(owner.address)

    // Setup Bank authorizations
    await mockBank.authorizeBalanceIncreaser(accountControl.address)
    await mockBank.authorizeBalanceIncreaser(qcMinter.address)

    // AccountControl integration is enabled by default in this setup

    // Setup token balances
    await tbtcToken.mint(user.address, MINT_AMOUNT.mul(10))
  }

  describe("QCMinter Integration", () => {
    it("1) should notify AccountControl of minting when enabled", async () => {
      // Setup initial state
      const initialMinted = await accountControl.totalMinted()
      
      // Action: Execute mint through QCMinter (should route through AccountControl)
      const tx = await qcMinter.connect(owner).requestQCMint(qcAddress.address, user.address, MINT_AMOUNT)
      
      // Verify: AccountControl was notified and state updated
      const finalMinted = await accountControl.totalMinted()
      const expectedSatoshis = MINT_AMOUNT.div(SATOSHI_MULTIPLIER)
      expect(finalMinted).to.equal(initialMinted.add(expectedSatoshis))
      
      // Verify: Proper event emission
      await expect(tx).to.emit(accountControl, "MintExecuted")

      // Verify: Bank balance was created correctly
      expect(await mockBank.balances(user.address)).to.equal(expectedSatoshis)
    })

    it("2) should enforce backing constraints through AccountControl", async () => {
      // Setup: Reduce backing to an amount that would cause insufficient backing
      const smallBacking = 100000 // Very small amount in satoshis
      await accountControl.connect(owner).setBacking(qcMinter.address, smallBacking)
      
      // Setup initial state
      const initialMinted = await accountControl.totalMinted()
      
      // Action: Try to execute mint (should fail due to insufficient backing)
      await expect(
        qcMinter.connect(owner).requestQCMint(qcAddress.address, user.address, MINT_AMOUNT)
      ).to.be.revertedWith("InsufficientBacking")
      
      // Verify: AccountControl prevented the mint
      const finalMinted = await accountControl.totalMinted()
      expect(finalMinted).to.equal(initialMinted) // Should be unchanged
      
      // Verify: No bank balance was created
      expect(await mockBank.balances(user.address)).to.equal(0)
    })

    it("3) should handle multiple sequential mints correctly", async () => {
      // Setup: Start with sufficient backing
      const initialMinted = await accountControl.totalMinted()
      
      // Action: Perform multiple mints
      const mintAmount = ethers.utils.parseEther("0.002") // Smaller amount to fit in backing
      await qcMinter.connect(owner).requestQCMint(qcAddress.address, user.address, mintAmount)
      const firstMinted = await accountControl.totalMinted()
      
      await qcMinter.connect(owner).requestQCMint(qcAddress.address, user.address, mintAmount)
      const finalMinted = await accountControl.totalMinted()
      
      // Verify: Both mints went through AccountControl properly
      const expectedFirstSatoshis = mintAmount.div(SATOSHI_MULTIPLIER)
      const expectedTotalSatoshis = mintAmount.mul(2).div(SATOSHI_MULTIPLIER)
      
      expect(firstMinted).to.equal(initialMinted.add(expectedFirstSatoshis))
      expect(finalMinted).to.equal(initialMinted.add(expectedTotalSatoshis))
      
      // Verify: Bank balances reflect both mints
      expect(await mockBank.balances(user.address)).to.equal(expectedTotalSatoshis)
    })

    it("4) should maintain consistent state across contracts", async () => {
      // Setup: AccountControl is enabled by default
      
      // Action: Perform multiple mint operations
      const mintAmount1 = ethers.utils.parseEther("0.003")
      const mintAmount2 = ethers.utils.parseEther("0.002")
      
      await qcMinter.connect(owner).requestQCMint(qcAddress.address, user.address, mintAmount1)
      await qcMinter.connect(owner).requestQCMint(qcAddress.address, user.address, mintAmount2)
      
      // Verify: State consistency across contracts
      const accountControlMinted = await accountControl.totalMinted()
      const expectedSatoshis = mintAmount1.add(mintAmount2).div(SATOSHI_MULTIPLIER)
      
      expect(accountControlMinted).to.equal(expectedSatoshis)
      
      // Verify: Bank balance reflects all operations
      expect(await mockBank.balances(user.address)).to.equal(expectedSatoshis)
      
      // Verify: Backing invariants maintained
      const backing = await accountControl.backing(qcAddress.address)
      expect(accountControlMinted).to.be.lte(backing) // Backing >= minted
    })

    it("5) should complete full mint cycle with proper state management", async () => {
      // Setup: AccountControl is enabled by default
      
      // Capture initial state
      const initialMinted = await accountControl.totalMinted()
      const initialSupply = await tbtcToken.totalSupply()
      
      // === MINT PHASE ===
      const cycleAmount = MINT_AMOUNT
      
      // Execute mint
      const mintTx = await qcMinter.connect(owner).requestQCMint(qcAddress.address, user.address, cycleAmount)
      await expect(mintTx).to.emit(accountControl, "MintExecuted")
      
      // Capture post-mint state
      const postMintMinted = await accountControl.totalMinted()
      const cycleSatoshis = cycleAmount.div(SATOSHI_MULTIPLIER)
      
      // === VERIFICATION ===
      
      // Verify mint phase state transitions
      expect(postMintMinted).to.equal(initialMinted.add(cycleSatoshis))
      
      // Verify Bank balance was created
      expect(await mockBank.balances(user.address)).to.equal(cycleSatoshis)
      
      // Verify system state consistency (check individual pause states instead)
      const isMintingPaused = await systemState.isMintingPaused()
      expect(isMintingPaused).to.be.false
      
      // Verify backing constraint maintained
      const backing = await accountControl.backing(qcAddress.address)
      expect(postMintMinted).to.be.lte(backing) // Backing >= minted
      
      // Verify reserve is properly configured - check that backing exists
      const qcBacking = await accountControl.backing(qcAddress.address)
      expect(qcBacking).to.be.gt(0) // Should have positive backing
    })
  })
})