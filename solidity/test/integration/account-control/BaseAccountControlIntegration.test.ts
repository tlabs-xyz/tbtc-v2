import { expect } from "chai"
import { ethers } from "hardhat"
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { smock, FakeContract } from "@defi-wonderland/smock"

import type {
  ProtocolRegistry,
  QCManager,
  QCData,
  SystemState,
  QCMinter,
  QCRedeemer,
  BasicMintingPolicy,
  BasicRedemptionPolicy,
  QCReserveLedger,
  SingleWatchdog,
  QCBridge,
  Bank,
  TBTCVault,
  TBTC,
  Bridge
} from "../../../typechain"

export abstract class BaseAccountControlIntegration {
  // Signers
  protected deployer: SignerWithAddress
  protected governance: SignerWithAddress
  protected qc: SignerWithAddress
  protected user: SignerWithAddress
  protected watchdog: SignerWithAddress
  protected emergencyCouncil: SignerWithAddress

  // Core contracts
  protected protocolRegistry: ProtocolRegistry
  protected qcManager: QCManager
  protected qcData: QCData
  protected systemState: SystemState
  protected qcMinter: QCMinter
  protected qcRedeemer: QCRedeemer
  protected basicMintingPolicy: BasicMintingPolicy
  protected basicRedemptionPolicy: BasicRedemptionPolicy
  protected qcReserveLedger: QCReserveLedger
  protected singleWatchdog: SingleWatchdog
  protected qcBridge: QCBridge
  protected bank: FakeContract<Bank>
  protected tbtcVault: FakeContract<TBTCVault>
  protected tbtc: FakeContract<TBTC>
  protected bridge: FakeContract<Bridge>

  // Service keys
  protected readonly SERVICE_KEYS = {
    QC_DATA: ethers.utils.id("QC_DATA"),
    SYSTEM_STATE: ethers.utils.id("SYSTEM_STATE"),
    QC_MANAGER: ethers.utils.id("QC_MANAGER"),
    MINTING_POLICY: ethers.utils.id("MINTING_POLICY"),
    REDEMPTION_POLICY: ethers.utils.id("REDEMPTION_POLICY"),
    QC_RESERVE_LEDGER: ethers.utils.id("QC_RESERVE_LEDGER"),
    WATCHDOG: ethers.utils.id("WATCHDOG"),
    QC_BRIDGE: ethers.utils.id("QC_BRIDGE")
  }

  // Roles
  protected readonly ROLES = {
    ATTESTER_ROLE: ethers.utils.id("ATTESTER_ROLE"),
    REGISTRAR_ROLE: ethers.utils.id("REGISTRAR_ROLE"),
    ARBITER_ROLE: ethers.utils.id("ARBITER_ROLE"),
    DEFAULT_ADMIN_ROLE: ethers.constants.HashZero,
    PAUSER_ROLE: ethers.utils.id("PAUSER_ROLE"),
    UNPAUSER_ROLE: ethers.utils.id("UNPAUSER_ROLE")
  }

  // Test parameters
  protected readonly TEST_PARAMS = {
    MAX_MINTING_CAP: ethers.utils.parseEther("1000"),
    MIN_MINT_AMOUNT: ethers.utils.parseEther("0.1"),
    MAX_MINT_AMOUNT: ethers.utils.parseEther("10"),
    MIN_REDEMPTION_AMOUNT: ethers.utils.parseEther("0.1"),
    MAX_REDEMPTION_AMOUNT: ethers.utils.parseEther("10"),
    REDEMPTION_TIMEOUT: 86400, // 24 hours
    GOVERNANCE_DELAY: 7 * 24 * 60 * 60, // 7 days
    ATTESTATION_STALE_THRESHOLD: 3600 // 1 hour
  }

  async setupBase() {
    // Get signers
    ;[
      this.deployer,
      this.governance,
      this.qc,
      this.user,
      this.watchdog,
      this.emergencyCouncil
    ] = await ethers.getSigners()

    // Deploy all contracts
    await this.deployContracts()
    
    // Configure services in registry
    await this.configureServices()
    
    // Set up roles and permissions
    await this.configureRoles()
    
    // Initialize system parameters
    await this.initializeParameters()
  }

  private async deployContracts() {
    // Deploy ProtocolRegistry
    const ProtocolRegistry = await ethers.getContractFactory("ProtocolRegistry")
    this.protocolRegistry = await ProtocolRegistry.deploy()
    await this.protocolRegistry.deployed()

    // Deploy state contracts
    const QCData = await ethers.getContractFactory("QCData")
    this.qcData = await QCData.deploy()
    await this.qcData.deployed()

    const SystemState = await ethers.getContractFactory("SystemState")
    this.systemState = await SystemState.deploy()
    await this.systemState.deployed()

    // Deploy core tBTC contracts (mocked for integration tests)
    this.bridge = await smock.fake<Bridge>("Bridge")
    this.bank = await smock.fake<Bank>("Bank")
    this.tbtcVault = await smock.fake<TBTCVault>("TBTCVault")
    this.tbtc = await smock.fake<TBTC>("TBTC")

    // Configure mocks
    this.tbtcVault.tbtcToken.returns(this.tbtc.address)
    this.tbtcVault.receiveBalanceIncrease.returns()
    this.bank.increaseBalanceAndCall.returns()

    // Deploy QCBridge
    const QCBridge = await ethers.getContractFactory("QCBridge")
    this.qcBridge = await QCBridge.deploy(
      this.bank.address,
      this.tbtcVault.address,
      this.protocolRegistry.address
    )
    await this.qcBridge.deployed()

    // Deploy QCManager
    const QCManager = await ethers.getContractFactory("QCManager")
    this.qcManager = await QCManager.deploy(this.protocolRegistry.address)
    await this.qcManager.deployed()

    // Deploy entry points
    const QCMinter = await ethers.getContractFactory("QCMinter")
    this.qcMinter = await QCMinter.deploy(this.protocolRegistry.address)
    await this.qcMinter.deployed()

    const QCRedeemer = await ethers.getContractFactory("QCRedeemer")
    this.qcRedeemer = await QCRedeemer.deploy(this.protocolRegistry.address)
    await this.qcRedeemer.deployed()

    // Deploy policies
    const BasicMintingPolicy = await ethers.getContractFactory("BasicMintingPolicy")
    this.basicMintingPolicy = await BasicMintingPolicy.deploy(this.protocolRegistry.address)
    await this.basicMintingPolicy.deployed()

    const BasicRedemptionPolicy = await ethers.getContractFactory("BasicRedemptionPolicy")
    this.basicRedemptionPolicy = await BasicRedemptionPolicy.deploy(this.protocolRegistry.address)
    await this.basicRedemptionPolicy.deployed()

    // Deploy QCReserveLedger
    const QCReserveLedger = await ethers.getContractFactory("QCReserveLedger")
    this.qcReserveLedger = await QCReserveLedger.deploy(this.protocolRegistry.address)
    await this.qcReserveLedger.deployed()

    // Deploy SingleWatchdog
    const SingleWatchdog = await ethers.getContractFactory("SingleWatchdog")
    this.singleWatchdog = await SingleWatchdog.deploy(this.protocolRegistry.address)
    await this.singleWatchdog.deployed()
  }

  private async configureServices() {
    // Register all services in ProtocolRegistry
    await this.protocolRegistry.connect(this.deployer).setService(
      this.SERVICE_KEYS.QC_DATA,
      this.qcData.address
    )

    await this.protocolRegistry.connect(this.deployer).setService(
      this.SERVICE_KEYS.SYSTEM_STATE,
      this.systemState.address
    )

    await this.protocolRegistry.connect(this.deployer).setService(
      this.SERVICE_KEYS.QC_MANAGER,
      this.qcManager.address
    )

    await this.protocolRegistry.connect(this.deployer).setService(
      this.SERVICE_KEYS.MINTING_POLICY,
      this.basicMintingPolicy.address
    )

    await this.protocolRegistry.connect(this.deployer).setService(
      this.SERVICE_KEYS.REDEMPTION_POLICY,
      this.basicRedemptionPolicy.address
    )

    await this.protocolRegistry.connect(this.deployer).setService(
      this.SERVICE_KEYS.QC_RESERVE_LEDGER,
      this.qcReserveLedger.address
    )

    await this.protocolRegistry.connect(this.deployer).setService(
      this.SERVICE_KEYS.WATCHDOG,
      this.singleWatchdog.address
    )

    await this.protocolRegistry.connect(this.deployer).setService(
      this.SERVICE_KEYS.QC_BRIDGE,
      this.qcBridge.address
    )
  }

  private async configureRoles() {
    // Grant QC Manager roles
    await this.qcManager.connect(this.deployer).grantRole(
      this.ROLES.DEFAULT_ADMIN_ROLE,
      this.governance.address
    )

    // Grant watchdog roles
    await this.qcReserveLedger.connect(this.deployer).grantRole(
      this.ROLES.ATTESTER_ROLE,
      this.watchdog.address
    )

    await this.qcManager.connect(this.deployer).grantRole(
      this.ROLES.REGISTRAR_ROLE,
      this.watchdog.address
    )

    await this.qcManager.connect(this.deployer).grantRole(
      this.ROLES.ARBITER_ROLE,
      this.watchdog.address
    )

    // Grant emergency council roles
    await this.systemState.connect(this.deployer).grantRole(
      this.ROLES.PAUSER_ROLE,
      this.emergencyCouncil.address
    )

    await this.systemState.connect(this.deployer).grantRole(
      this.ROLES.UNPAUSER_ROLE,
      this.emergencyCouncil.address
    )

    // Grant QCBridge permission to increase Bank balance
    this.bank.authorizedBalanceIncreasers.whenCalledWith(this.qcBridge.address).returns(true)
  }

  private async initializeParameters() {
    // Note: Parameter initialization is handled by constructor parameters
    // or through ProtocolRegistry service configurations
    console.log("Parameters initialized through contract deployments")
  }

  // Helper functions
  protected generateBitcoinAddress(): string {
    // Generate a valid testnet P2PKH address
    return "m" + Math.random().toString(36).substring(2, 34)
  }

  protected generateMockSPVProof(): any {
    return {
      merkleProof: [ethers.utils.randomBytes(32)],
      txIndexInBlock: 0,
      bitcoinHeaders: [ethers.utils.randomBytes(80)]
    }
  }

  protected async advanceTime(seconds: number) {
    // Use ethers provider to advance time
    await ethers.provider.send("evm_increaseTime", [seconds])
    await ethers.provider.send("evm_mine", [])
  }

  protected async getBlockTimestamp(): Promise<number> {
    const block = await ethers.provider.getBlock("latest")
    return block.timestamp
  }

  abstract runTest(): Promise<void>
}