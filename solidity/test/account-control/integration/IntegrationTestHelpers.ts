import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  QCManager,
  QCData,
  QCMinter,
  QCRedeemer,
  QCReserveLedger,
  BasicMintingPolicy,
  BasicRedemptionPolicy,
  QCWatchdog,
  WatchdogMonitor,
  WatchdogConsensusManager,
  SystemState,
  ProtocolRegistry,
  TBTC,
  SPVValidator,
  Bank,
  TBTCVault,
  Bridge,
} from "../../../typechain"
import {
  SERVICE_KEYS,
  ROLES,
  TEST_DATA,
  QCStatus,
  createMockSpvData,
  deployAccountControlFixture,
  setupQCWithWallets,
} from "../AccountControlTestHelpers"

export interface IntegrationTestContext {
  // Signers
  deployer: SignerWithAddress
  governance: SignerWithAddress
  qcAddress: SignerWithAddress
  user1: SignerWithAddress
  user2: SignerWithAddress
  watchdog1: SignerWithAddress
  watchdog2: SignerWithAddress
  watchdog3: SignerWithAddress
  
  // Core contracts
  protocolRegistry: ProtocolRegistry
  qcManager: QCManager
  qcData: QCData
  qcMinter: QCMinter
  qcRedeemer: QCRedeemer
  qcReserveLedger: QCReserveLedger
  basicMintingPolicy: BasicMintingPolicy
  basicRedemptionPolicy: BasicRedemptionPolicy
  qcWatchdog: QCWatchdog
  systemState: SystemState
  tbtc: TBTC
  mockSpvValidator: FakeContract<SPVValidator>
  
  // V1 contracts
  watchdogMonitor: WatchdogMonitor
  watchdogConsensusManager: WatchdogConsensusManager
  
  // V2 contracts (optional)
  bank?: Bank
  vault?: TBTCVault
  bridge?: Bridge
}

export async function setupIntegrationTest(
  includeV2Contracts: boolean = false
): Promise<IntegrationTestContext> {
  // Get signers
  const [
    deployer,
    governance,
    qcAddress,
    user1,
    user2,
    watchdog1,
    watchdog2,
    watchdog3,
  ] = await ethers.getSigners()

  // Deploy base fixture
  const fixture = await deployAccountControlFixture()
  
  // Deploy V1 consensus contracts
  const WatchdogConsensusManagerFactory = await ethers.getContractFactory(
    "WatchdogConsensusManager"
  )
  const watchdogConsensusManager = await WatchdogConsensusManagerFactory.deploy(
    fixture.qcManager.address,
    fixture.qcRedeemer.address,
    fixture.qcData.address
  )
  await watchdogConsensusManager.deployed()

  const WatchdogMonitorFactory = await ethers.getContractFactory(
    "WatchdogMonitor"
  )
  const watchdogMonitor = await WatchdogMonitorFactory.deploy(
    watchdogConsensusManager.address,
    fixture.qcData.address
  )
  await watchdogMonitor.deployed()

  // Setup SPV validator
  const mockSpvValidator = await smock.fake<SPVValidator>("SPVValidator")
  mockSpvValidator.verifyWalletControl.returns(true)
  mockSpvValidator.verifyRedemptionFulfillment.returns(true)
  
  await fixture.protocolRegistry.setService(
    SERVICE_KEYS.SPV_VALIDATOR,
    mockSpvValidator.address
  )

  // Setup roles
  await setupWatchdogRoles(
    watchdogConsensusManager,
    watchdogMonitor,
    governance,
    [watchdog1, watchdog2, watchdog3]
  )

  await fixture.qcRedeemer.grantRole(ROLES.REDEEMER_ROLE, user1.address)
  await fixture.qcRedeemer.grantRole(ROLES.REDEEMER_ROLE, user2.address)

  const context: IntegrationTestContext = {
    deployer,
    governance,
    qcAddress,
    user1,
    user2,
    watchdog1,
    watchdog2,
    watchdog3,
    protocolRegistry: fixture.protocolRegistry,
    qcManager: fixture.qcManager,
    qcData: fixture.qcData,
    qcMinter: fixture.qcMinter,
    qcRedeemer: fixture.qcRedeemer,
    qcReserveLedger: fixture.qcReserveLedger,
    basicMintingPolicy: fixture.basicMintingPolicy,
    basicRedemptionPolicy: fixture.basicRedemptionPolicy,
    qcWatchdog: fixture.qcWatchdog,
    systemState: fixture.systemState,
    tbtc: fixture.tbtc,
    mockSpvValidator,
    watchdogMonitor,
    watchdogConsensusManager,
  }

  // Deploy V2 contracts if requested
  if (includeV2Contracts) {
    const v2Contracts = await deployV2Contracts(governance)
    context.bank = v2Contracts.bank
    context.vault = v2Contracts.vault
    context.bridge = v2Contracts.bridge
  }

  return context
}

async function setupWatchdogRoles(
  watchdogConsensusManager: WatchdogConsensusManager,
  watchdogMonitor: WatchdogMonitor,
  governance: SignerWithAddress,
  watchdogs: SignerWithAddress[]
) {
  // Setup consensus manager roles
  await watchdogConsensusManager.grantRole(
    await watchdogConsensusManager.MANAGER_ROLE(),
    governance.address
  )
  
  for (const watchdog of watchdogs) {
    await watchdogConsensusManager
      .connect(governance)
      .grantRole(
        await watchdogConsensusManager.WATCHDOG_ROLE(),
        watchdog.address
      )
  }

  // Setup monitor roles
  await watchdogMonitor.grantRole(
    await watchdogMonitor.MANAGER_ROLE(),
    governance.address
  )

  for (let i = 0; i < watchdogs.length; i++) {
    const mockWatchdog = await smock.fake("QCWatchdog")
    await watchdogMonitor
      .connect(governance)
      .registerWatchdog(
        mockWatchdog.address,
        watchdogs[i].address,
        `Watchdog${i + 1}`
      )
    
    await watchdogMonitor
      .connect(governance)
      .grantRole(
        await watchdogMonitor.WATCHDOG_OPERATOR_ROLE(),
        watchdogs[i].address
      )
  }
}

async function deployV2Contracts(governance: SignerWithAddress) {
  // Deploy Bank
  const BankFactory = await ethers.getContractFactory("Bank")
  const bank = await BankFactory.deploy()
  await bank.deployed()

  // Deploy TBTCVault
  const VaultFactory = await ethers.getContractFactory("TBTCVault")
  const vault = await VaultFactory.deploy(bank.address)
  await vault.deployed()

  // Deploy Bridge
  const BridgeFactory = await ethers.getContractFactory("Bridge")
  const bridge = await BridgeFactory.deploy()
  await bridge.deployed()

  return { bank, vault, bridge }
}

export async function setupQCForTesting(
  context: IntegrationTestContext,
  qcAddress: string,
  initialCapacity: string,
  reserveBalance: string
) {
  // Register QC
  await context.qcData.registerQC(qcAddress, ethers.utils.parseEther(initialCapacity))
  
  // Register wallet with SPV proof
  const { challenge, txInfo, proof } = createMockSpvData()
  const encodedProof = ethers.utils.defaultAbiCoder.encode(
    [
      "tuple(bytes4 version, bytes inputVector, bytes outputVector, bytes4 locktime)",
      "tuple(bytes merkleProof, uint256 txIndexInBlock, bytes bitcoinHeaders, bytes32 coinbasePreimage, bytes coinbaseProof)",
    ],
    [txInfo, proof]
  )

  await context.qcWatchdog
    .connect(context.watchdog1)
    .registerWalletWithProof(
      qcAddress,
      TEST_DATA.BTC_ADDRESSES.TEST,
      encodedProof,
      challenge
    )

  // Submit reserve attestation
  await context.qcReserveLedger
    .connect(context.watchdog1)
    .submitReserveAttestation(qcAddress, ethers.utils.parseEther(reserveBalance))
}

export async function createAndExecuteProposal(
  context: IntegrationTestContext,
  proposalData: string,
  description: string,
  voters: SignerWithAddress[]
) {
  // Create proposal
  const tx = await context.watchdogConsensusManager
    .connect(voters[0])
    .createProposal(0, proposalData, description)

  const receipt = await tx.wait()
  const event = receipt.events?.find((e) => e.event === "ProposalCreated")
  const proposalId = event?.args?.proposalId

  // Vote on proposal
  for (const voter of voters) {
    await context.watchdogConsensusManager.connect(voter).vote(proposalId)
  }

  // Execute proposal
  await context.watchdogConsensusManager.connect(voters[0]).executeProposal(proposalId)

  return proposalId
}

export async function triggerEmergencyPause(
  context: IntegrationTestContext,
  qcAddress: string,
  reporters: SignerWithAddress[]
) {
  for (let i = 0; i < reporters.length; i++) {
    await context.watchdogMonitor
      .connect(reporters[i])
      .submitCriticalReport(qcAddress, `Critical issue ${i + 1}`)
  }
}

export const TEST_AMOUNTS = {
  LARGE: ethers.utils.parseEther("1000"),
  MEDIUM: ethers.utils.parseEther("100"),
  SMALL: ethers.utils.parseEther("10"),
  TINY: ethers.utils.parseEther("1"),
}