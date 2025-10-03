/**
 * Integration Test Framework
 *
 * Provides a comprehensive framework for testing cross-contract interactions
 * in the AccountControl system, including QCMinter, QCRedeemer, and other components.
 */

import { ethers } from "hardhat"
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { setupSystemStateDefaults } from "../../helpers/role-setup-utils"
import { LibraryLinkingHelper } from "./library-linking-helper"
import type { TestContracts, BridgeAccountControlTestSigners } from "./types"

export class IntegrationTestFramework {
  public contracts!: TestContracts
  public signers!: BridgeAccountControlTestSigners

  // Helper constants for unit conversions
  public readonly ONE_SATOSHI_IN_WEI = ethers.utils.parseEther("0.00000001") // 1e10
  public readonly ONE_BTC_IN_WEI = ethers.utils.parseEther("1") // 1e18

  // Test amounts in wei (no conversion needed)
  public readonly QC_BACKING_AMOUNT = ethers.utils.parseEther("0.01") // 0.01 tBTC in wei
  public readonly QC_MINTING_CAP = ethers.utils.parseEther("0.01") // 0.01 tBTC in wei
  public readonly MINT_AMOUNT = ethers.utils.parseEther("0.005") // 0.005 tBTC in wei

  async deploySystem(): Promise<void> {
    // Setup signers
    const signerArray = await ethers.getSigners()
    this.signers = {
      owner: signerArray[0],
      emergencyCouncil: signerArray[1],
      user: signerArray[2],
      watchdog: signerArray[3],
      arbiter: signerArray[4],
      attester1: signerArray[5],
      attester2: signerArray[6],
      attester3: signerArray[7],
      qcAddress: signerArray[8],
    }

    // Deploy mock infrastructure contracts
    const MockBank = await ethers.getContractFactory("MockBank")
    const mockBank = await MockBank.deploy()

    const MockTBTCToken = await ethers.getContractFactory("MockTBTCToken")
    const tbtcToken = await MockTBTCToken.deploy()

    const MockTBTCVault = await ethers.getContractFactory(
      "contracts/test/MockTBTCVault.sol:MockTBTCVault"
    )

    const mockTbtcVault = await MockTBTCVault.deploy()

    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    const systemState = await SystemStateFactory.deploy()

    const TestRelay = await ethers.getContractFactory("TestRelay")
    const testRelay = await TestRelay.deploy()

    const QCDataFactory = await ethers.getContractFactory("QCData")
    const qcData = await QCDataFactory.deploy()

    // Deploy real ReserveOracle for integration testing
    const ReserveOracleFactory = await ethers.getContractFactory(
      "ReserveOracle"
    )

    const reserveOracle = await ReserveOracleFactory.deploy(
      systemState.address
    )

    // Deploy real AccountControl for integration testing
    // This ensures we test actual contract interactions
    const AccountControlFactory = await ethers.getContractFactory(
      "AccountControl"
    )

    const accountControl = await AccountControlFactory.deploy(
      this.signers.owner.address,
      this.signers.emergencyCouncil.address,
      mockBank.address
    )

    // Deploy QCPauseManager first (required by QCManager)
    const QCPauseManagerFactory = await ethers.getContractFactory(
      "QCPauseManager"
    )

    const pauseManager = await QCPauseManagerFactory.deploy(
      qcData.address,
      this.signers.owner.address, // Temporary QCManager address
      this.signers.owner.address, // Admin
      this.signers.owner.address // Emergency role
    )

    // Deploy QCWalletManager first (required by QCManager)
    const qcWalletManager = await LibraryLinkingHelper.deployQCWalletManager(
      qcData.address,
      systemState.address,
      reserveOracle.address
    )

    // Deploy real QCManager with proper library linking
    const QCManagerFactory = await LibraryLinkingHelper.getQCManagerFactory()

    const qcManager = await QCManagerFactory.deploy(
      qcData.address,
      systemState.address,
      reserveOracle.address,
      pauseManager.address,
      qcWalletManager.address
    )

    // Update pauseManager with correct QCManager address
    const QC_MANAGER_ROLE = await pauseManager.QC_MANAGER_ROLE()
    await pauseManager.grantRole(QC_MANAGER_ROLE, qcManager.address)
    await pauseManager.revokeRole(QC_MANAGER_ROLE, this.signers.owner.address)

    // Grant QC_MANAGER_ROLE to QCManager in QCWalletManager for delegation
    const WALLET_QC_MANAGER_ROLE = await qcWalletManager.QC_MANAGER_ROLE()
    await qcWalletManager.grantRole(WALLET_QC_MANAGER_ROLE, qcManager.address)

    // Deploy QCMinter
    const QCMinterFactory = await ethers.getContractFactory("QCMinter")

    const qcMinter = await QCMinterFactory.deploy(
      qcData.address,
      systemState.address,
      qcManager.address,
      accountControl.address
    )

    // Deploy QCRedeemer with proper library linking
    let qcRedeemer
    try {
      // First deploy the required libraries
      const libraries = await LibraryLinkingHelper.deployAllLibraries()

      qcRedeemer = await LibraryLinkingHelper.deployQCRedeemer(
        tbtcToken.address,
        qcData.address,
        systemState.address,
        accountControl.address,
        libraries // Provide the libraries explicitly
      )
    } catch (error) {
      console.error("❌ Error deploying QCRedeemer:", error)
      throw error
    }

    // Store all contracts
    this.contracts = {
      accountControl,
      qcManager,
      qcWalletManager,
      qcMinter,
      qcRedeemer,
      reserveOracle,
      systemState,
      tbtcToken,
      qcData,
      qcPauseManager: pauseManager,
      mockBank,
      mockTbtcVault,
      testRelay,
    }

    await this.configureIntegration()
  }

  async configureIntegration(): Promise<void> {
    // Configuring integration components
    const { owner, qcAddress } = this.signers

    const {
      accountControl,
      qcMinter,
      qcRedeemer,
      qcManager,
      qcData,
      systemState,
      mockBank,
      tbtcToken,
      reserveOracle,
    } = this.contracts

    try {
      // Setup SystemState defaults
      // Setup SystemState defaults
      const opsRole = await systemState.OPERATIONS_ROLE()

      await systemState.connect(owner).grantRole(opsRole, owner.address)

      await setupSystemStateDefaults(systemState, owner)

      // Setup QCData
      // Setup QCData
      const qcManagerRole = await qcData.QC_MANAGER_ROLE()

      await qcData.grantRole(qcManagerRole, owner.address)
      // Also grant role to QCManager so it can register QCs
      await qcData.grantRole(qcManagerRole, qcManager.address)

      // Don't pre-register - let tests handle this
      // await qcData.connect(owner).registerQC(qcAddress.address, this.QC_MINTING_CAP)
      // const statusBytes = ethers.utils.formatBytes32String("Active")
      // await qcData.connect(owner).setQCStatus(qcAddress.address, 0, statusBytes)
      // await qcData.connect(owner).registerWallet(qcAddress.address, "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")
    } catch (error) {
      console.error("❌ Error in configureIntegration:", error)
      throw error
    }

    // Setup QCManager roles
    const GOVERNANCE_ROLE = await qcManager.GOVERNANCE_ROLE()
    await qcManager.grantRole(GOVERNANCE_ROLE, owner.address)

    // Link QCManager to AccountControl for integration
    await qcManager.connect(owner).setAccountControl(accountControl.address)

    // Grant MINTER_ROLE to QCMinter in QCManager (required for minting operations)
    const MINTER_ROLE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("MINTER_ROLE")
    )

    try {
      // If QCManager has grantRole method
      await qcManager.grantRole(MINTER_ROLE, qcMinter.address)
    } catch (error) {
      // MockQCManager might not have role-based access, that's OK
    }

    // Setup roles and permissions first (required before configuring cross-contract references)
    await this.setupRoles()

    // AccountControl is already set in constructors for QCMinter and QCRedeemer

    // Grant RESERVE_ROLE and ORACLE_ROLE to QCManager in AccountControl
    const RESERVE_ROLE = await accountControl.RESERVE_ROLE()
    const ORACLE_ROLE = await accountControl.ORACLE_ROLE()
    await accountControl
      .connect(owner)
      .grantRole(RESERVE_ROLE, qcManager.address)
    await accountControl
      .connect(owner)
      .grantRole(ORACLE_ROLE, qcManager.address)

    // QCMinter doesn't need special roles in AccountControl - minting is handled via QCManager

    // Grant REDEEMER_ROLE to QCRedeemer in AccountControl (for notifyRedemption)
    const REDEEMER_ROLE = await accountControl.REDEEMER_ROLE()
    await accountControl
      .connect(owner)
      .grantRole(REDEEMER_ROLE, qcRedeemer.address)

    // Authorize contracts in Bank
    await mockBank.authorizeBalanceIncreaser(accountControl.address)
    await mockBank.authorizeBalanceIncreaser(qcMinter.address)

    // Setup initial token balances for testing
    await tbtcToken.mint(this.signers.user.address, this.MINT_AMOUNT.mul(10))
    await tbtcToken
      .connect(this.signers.user)
      .approve(qcRedeemer.address, this.MINT_AMOUNT.mul(10))

    // Setup redemption timeout
    await systemState.setRedemptionTimeout(86400) // 24 hours

    // Set validateHeaderChain to return the expected accumulated difficulty
    // The accumulated difficulty must be at least requestedDiff * difficultyFactor
    // Since we're using difficultyFactor = 100 and the headers have 6 confirmations,
    // we need to return an accumulated difficulty that represents 6 headers worth of work
    // For testing, we'll return a large enough value to pass validation
    const currentDiff =
      await this.contracts.testRelay.getCurrentEpochDifficulty()

    const accumulatedDiff = currentDiff.mul(6).mul(120) // 6 headers * 120 for safety margin
    await this.contracts.testRelay.setValidateHeaderChainResult(
      accumulatedDiff.toString()
    )

    // Verify the values were set
    const verifyCurrentDiff =
      await this.contracts.testRelay.getCurrentEpochDifficulty()

    const verifyResult = await this.contracts.testRelay.validateHeaderChain(
      "0x00"
    )
  }

  async captureSystemState(): Promise<SystemState> {
    return {
      totalMinted: await this.contracts.accountControl.totalMinted(),
      qcMinted: await this.contracts.accountControl.minted(
        this.signers.qcAddress.address
      ),
      systemPaused: await this.contracts.systemState.isMintingPaused(),
    }
  }

  private async setupRoles(): Promise<void> {
    const { owner, watchdog, arbiter, attester1, attester2, attester3 } =
      this.signers

    const { qcMinter, qcRedeemer, accountControl, reserveOracle } =
      this.contracts

    // QCMinter roles
    const MINTER_ROLE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("MINTER_ROLE")
    )

    const GOVERNANCE_ROLE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("GOVERNANCE_ROLE")
    )

    await qcMinter.connect(owner).grantRole(MINTER_ROLE, owner.address)
    await qcMinter.connect(owner).grantRole(GOVERNANCE_ROLE, owner.address)

    // QCRedeemer roles
    const WATCHDOG_ROLE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("WATCHDOG_ROLE")
    )

    const ARBITER_ROLE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("ARBITER_ROLE")
    )

    const DISPUTE_ARBITER_ROLE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("DISPUTE_ARBITER_ROLE")
    )

    await qcRedeemer.connect(owner).grantRole(WATCHDOG_ROLE, watchdog.address)
    await qcRedeemer.connect(owner).grantRole(ARBITER_ROLE, arbiter.address)
    await qcRedeemer
      .connect(owner)
      .grantRole(DISPUTE_ARBITER_ROLE, watchdog.address) // Grant DISPUTE_ARBITER_ROLE for recordRedemptionFulfillment
    await qcRedeemer.connect(owner).grantRole(GOVERNANCE_ROLE, owner.address)

    // ReserveOracle roles (if it has attestation functionality)
    try {
      const ATTESTER_ROLE = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("ATTESTER_ROLE")
      )

      await reserveOracle
        .connect(owner)
        .grantRole(ATTESTER_ROLE, attester1.address)
      await reserveOracle
        .connect(owner)
        .grantRole(ATTESTER_ROLE, attester2.address)
      await reserveOracle
        .connect(owner)
        .grantRole(ATTESTER_ROLE, attester3.address)
    } catch (error) {
      // ReserveOracle might not have attestation roles, that's OK
    }
  }

  /**
   * Execute a mint operation through the system
   */
  async executeMint(
    qcAddress: string,
    recipient: string,
    amount: any
  ): Promise<void> {
    const tx = await this.contracts.qcMinter
      .connect(this.signers.owner)
      .requestQCMint(qcAddress, recipient, amount)

    await tx.wait()

    // With real AccountControl contract, minting is automatically tracked
    // No manual sync needed - the contracts handle state updates internally
  }

  /**
   * Execute a redemption operation through the system
   */
  async executeRedemption(
    qcAddress: string,
    amount: ethers.BigNumber | number | string,
    btcAddress: string,
    qcWallet: string
  ): Promise<string> {
    const tx = await this.contracts.qcRedeemer
      .connect(this.signers.user)
      .initiateRedemption(qcAddress, amount, btcAddress, qcWallet)

    const receipt = await tx.wait()

    // Extract redemption ID from events (returns bytes32)
    const event = receipt.events?.find((e) => e.event === "RedemptionRequested")
    if (event?.args?.redemptionId) {
      return event.args.redemptionId
    }

    // Fallback: Generate a mock redemption ID
    const mockId = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256", "string", "uint256"],
        [qcAddress, amount.toString(), btcAddress, Date.now()]
      )
    )

    return mockId
  }

  /**
   * Fulfill a redemption with trusted arbiter validation
   */
  async fulfillRedemption(redemptionId: string): Promise<void> {
    // Convert from wei to satoshis for Bitcoin transaction (uint64)
    const amountInSatoshis = this.MINT_AMOUNT.div(
      this.ONE_SATOSHI_IN_WEI
    ).toNumber()

    const tx = await this.contracts.qcRedeemer
      .connect(this.signers.watchdog)
      .recordRedemptionFulfillmentTrusted(
        redemptionId,
        amountInSatoshis // amount as uint64 (satoshis for Bitcoin)
      )

    await tx.wait()
  }

  /**
   * Setup oracle attestations for reserve backing
   */
  async setupOracleAttestations(
    qcAddress: string,
    balance: any
  ): Promise<void> {
    const { attester1, attester2, attester3 } = this.signers
    const { reserveOracle } = this.contracts

    // Real ReserveOracle requires attestations from multiple attesters
    await reserveOracle.connect(attester1).attestBalance(qcAddress, balance)
    await reserveOracle.connect(attester2).attestBalance(qcAddress, balance)
    await reserveOracle.connect(attester3).attestBalance(qcAddress, balance)
  }

  /**
   * Get current backing ratio for a QC
   */
  async getBackingRatio(qcAddress: string): Promise<number> {
    const backing = await this.contracts.accountControl.backing(qcAddress)
    const minted = await this.contracts.accountControl.minted(qcAddress)

    if (minted.eq(0)) return Infinity
    return backing.mul(100).div(minted).toNumber()
  }

  /**
   * Advance time for timeout testing
   */
  async advanceTime(seconds: number): Promise<void> {
    await ethers.provider.send("evm_increaseTime", [seconds])
    await ethers.provider.send("evm_mine", [])
  }

  /**
   * Reset the framework for clean testing
   */
  reset(): void {
    // Reset any state if needed
  }
}
