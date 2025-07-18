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
  BasicMintingPolicy,
  QCReserveLedger,
  SingleWatchdog,
  Bank,
  TBTCVault,
  TBTC,
} from "../../../typechain"

describe("Simple Account Control Integration Test", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qc: SignerWithAddress
  let user: SignerWithAddress
  let watchdog: SignerWithAddress

  let protocolRegistry: ProtocolRegistry
  let qcManager: QCManager
  let qcData: QCData
  let systemState: SystemState
  let qcMinter: QCMinter
  let basicMintingPolicy: BasicMintingPolicy
  let qcReserveLedger: QCReserveLedger
  let singleWatchdog: SingleWatchdog

  // Mock contracts
  let mockBank: FakeContract<Bank>
  let mockTbtcVault: FakeContract<TBTCVault>
  let mockTbtc: FakeContract<TBTC>

  const SERVICE_KEYS = {
    QC_DATA: ethers.utils.id("QC_DATA"),
    SYSTEM_STATE: ethers.utils.id("SYSTEM_STATE"),
    QC_MANAGER: ethers.utils.id("QC_MANAGER"),
    MINTING_POLICY: ethers.utils.id("MINTING_POLICY"),
    QC_RESERVE_LEDGER: ethers.utils.id("QC_RESERVE_LEDGER"),
    WATCHDOG: ethers.utils.id("WATCHDOG"),
  }

  const ROLES = {
    ATTESTER_ROLE: ethers.utils.id("ATTESTER_ROLE"),
    REGISTRAR_ROLE: ethers.utils.id("REGISTRAR_ROLE"),
    ARBITER_ROLE: ethers.utils.id("ARBITER_ROLE"),
    DEFAULT_ADMIN_ROLE: ethers.constants.HashZero,
    QC_GOVERNANCE_ROLE: ethers.utils.id("QC_GOVERNANCE_ROLE"),
  }

  beforeEach(async () => {
    // Get signers
    ;[deployer, governance, qc, user, watchdog] = await ethers.getSigners()

    // Deploy mock contracts
    mockBank = await smock.fake<Bank>("Bank")
    mockTbtcVault = await smock.fake<TBTCVault>("TBTCVault")
    mockTbtc = await smock.fake<TBTC>("TBTC")

    // Configure mocks
    mockTbtcVault.tbtcToken.returns(mockTbtc.address)
    mockTbtcVault.receiveBalanceIncrease.returns()
    mockBank.increaseBalanceAndCall.returns()
    mockBank.authorizedBalanceIncreasers.returns(true)

    // Deploy real contracts
    const ProtocolRegistry = await ethers.getContractFactory("ProtocolRegistry")
    protocolRegistry = await ProtocolRegistry.deploy()
    await protocolRegistry.deployed()

    const QCData = await ethers.getContractFactory("QCData")
    qcData = await QCData.deploy()
    await qcData.deployed()

    const SystemState = await ethers.getContractFactory("SystemState")
    systemState = await SystemState.deploy()
    await systemState.deployed()

    const QCManager = await ethers.getContractFactory("QCManager")
    qcManager = await QCManager.deploy(protocolRegistry.address)
    await qcManager.deployed()

    const QCMinter = await ethers.getContractFactory("QCMinter")
    qcMinter = await QCMinter.deploy(protocolRegistry.address)
    await qcMinter.deployed()

    const BasicMintingPolicy = await ethers.getContractFactory(
      "BasicMintingPolicy"
    )
    basicMintingPolicy = await BasicMintingPolicy.deploy(
      protocolRegistry.address
    )
    await basicMintingPolicy.deployed()

    const QCReserveLedger = await ethers.getContractFactory("QCReserveLedger")
    qcReserveLedger = await QCReserveLedger.deploy(protocolRegistry.address)
    await qcReserveLedger.deployed()

    const SingleWatchdog = await ethers.getContractFactory("SingleWatchdog")
    singleWatchdog = await SingleWatchdog.deploy(protocolRegistry.address)
    await singleWatchdog.deployed()

    // Register services
    await protocolRegistry.setService(SERVICE_KEYS.QC_DATA, qcData.address)
    await protocolRegistry.setService(
      SERVICE_KEYS.SYSTEM_STATE,
      systemState.address
    )
    await protocolRegistry.setService(
      SERVICE_KEYS.QC_MANAGER,
      qcManager.address
    )
    await protocolRegistry.setService(
      SERVICE_KEYS.MINTING_POLICY,
      basicMintingPolicy.address
    )
    await protocolRegistry.setService(
      SERVICE_KEYS.QC_RESERVE_LEDGER,
      qcReserveLedger.address
    )
    await protocolRegistry.setService(
      SERVICE_KEYS.WATCHDOG,
      singleWatchdog.address
    )

    // Set up roles
    await qcReserveLedger.grantRole(ROLES.ATTESTER_ROLE, watchdog.address)
    await qcManager.grantRole(ROLES.REGISTRAR_ROLE, watchdog.address)
    await qcManager.grantRole(ROLES.ARBITER_ROLE, watchdog.address)
    await qcManager.grantRole(ROLES.DEFAULT_ADMIN_ROLE, governance.address)
    await qcManager.grantRole(ROLES.QC_GOVERNANCE_ROLE, governance.address)

    // Grant QCManager access to QCData
    await qcData.grantQCManagerRole(qcManager.address)
  })

  it("should deploy and configure all contracts correctly", async () => {
    // Verify registry services
    expect(await protocolRegistry.getService(SERVICE_KEYS.QC_DATA)).to.equal(
      qcData.address
    )
    expect(await protocolRegistry.getService(SERVICE_KEYS.QC_MANAGER)).to.equal(
      qcManager.address
    )
    expect(
      await protocolRegistry.getService(SERVICE_KEYS.MINTING_POLICY)
    ).to.equal(basicMintingPolicy.address)

    // Verify roles
    expect(await qcReserveLedger.hasRole(ROLES.ATTESTER_ROLE, watchdog.address))
      .to.be.true
    expect(await qcManager.hasRole(ROLES.REGISTRAR_ROLE, watchdog.address)).to
      .be.true

    console.log("✅ Basic setup test completed successfully")
  })

  it("should handle basic QC operations", async () => {
    const maxMintingCap = ethers.utils.parseEther("1000")

    // Register QC (instant operation)
    await qcManager.connect(governance).registerQC(qc.address, maxMintingCap)

    // Verify QC is registered
    const isRegistered = await qcData.isQCRegistered(qc.address)
    expect(isRegistered).to.be.true

    console.log("✅ Basic QC operations test completed")
  })

  it("should handle reserve attestation", async () => {
    const reserves = ethers.utils.parseEther("100")

    // Onboard QC first
    const maxMintingCap = ethers.utils.parseEther("1000")
    await qcManager.connect(governance).registerQC(qc.address, maxMintingCap)

    // Submit attestation (correct method signature - only qc and balance)
    await qcReserveLedger
      .connect(watchdog)
      .submitReserveAttestation(qc.address, reserves)

    // Verify attestation exists
    const attestation = await qcReserveLedger.getCurrentAttestation(qc.address)
    expect(attestation.balance).to.equal(reserves)

    console.log("✅ Reserve attestation test completed")
  })
})
