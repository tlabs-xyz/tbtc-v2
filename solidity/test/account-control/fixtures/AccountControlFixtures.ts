import { ethers, upgrades } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import {
  QCManager,
  QCData,
  SystemState,
  ReserveOracle,
  AccountControl,
  QCRedeemer,
  TBTC,
  TestRelay,
  MockBank,
  MockAccountControl,
} from "../../../typechain"
import { ValidMainnetProof } from "../../data/bitcoin/spv/valid-spv-proofs"
import { LibraryLinkingHelper } from "../../helpers/libraryLinkingHelper"

/**
 * Common test constants
 */
export const TEST_CONSTANTS = {
  // Amounts in satoshis (Bitcoin units)
  MIN_MINT: 10000, // 0.0001 BTC
  SMALL_MINT: 500000, // 0.005 BTC
  MEDIUM_MINT: 1000000, // 0.01 BTC
  LARGE_MINT: 10000000, // 0.1 BTC
  SMALL_CAP: 1000000, // 0.01 BTC
  MEDIUM_CAP: 10000000, // 0.1 BTC
  LARGE_CAP: 100000000, // 1 BTC
  MAX_CAP: ethers.utils.parseUnits("100", 8), // 100 BTC

  // Bitcoin addresses
  VALID_LEGACY_BTC: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  VALID_P2SH_BTC: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
  VALID_BECH32_BTC: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",

  // Role hashes (computed once)
  ROLES: {
    DEFAULT_ADMIN: ethers.constants.HashZero,
    GOVERNANCE: ethers.utils.id("GOVERNANCE_ROLE"),
    REGISTRAR: ethers.utils.id("REGISTRAR_ROLE"),
    DISPUTE_ARBITER: ethers.utils.id("DISPUTE_ARBITER_ROLE"),
    ENFORCEMENT: ethers.utils.id("ENFORCEMENT_ROLE"),
    MONITOR: ethers.utils.id("MONITOR_ROLE"),
    EMERGENCY: ethers.utils.id("EMERGENCY_ROLE"),
    QC_MANAGER: ethers.utils.id("QC_MANAGER_ROLE"),
  },
}

/**
 * Fixture for QCManager with minimal real contracts
 * Reduces mock usage by deploying actual contracts where practical
 */
export async function deployQCManagerFixture() {
  const [deployer, governance, qcAddress, arbiter, watchdog, registrar, pauser, user] =
    await ethers.getSigners()

  // Deploy real contracts instead of mocks where practical
  const QCDataFactory = await ethers.getContractFactory("QCData")
  const qcData = await QCDataFactory.deploy()

  const SystemStateFactory = await ethers.getContractFactory("SystemState")
  const systemState = await SystemStateFactory.deploy()

  const ReserveOracleFactory = await ethers.getContractFactory("ReserveOracle")
  const reserveOracle = await ReserveOracleFactory.deploy()

  // Deploy libraries using the helper
  const libraries = await LibraryLinkingHelper.deployAllLibraries()

  // Deploy QCManager using the helper
  const qcManager = await LibraryLinkingHelper.deployQCManager(
    qcData.address,
    systemState.address,
    reserveOracle.address,
    libraries
  )

  // Deploy MockBank for AccountControl
  const MockBankFactory = await ethers.getContractFactory("MockBank")
  const mockBank = await MockBankFactory.deploy()

  // Deploy AccountControl
  const AccountControlFactory = await ethers.getContractFactory("AccountControl")
  const accountControl = (await upgrades.deployProxy(
    AccountControlFactory,
    [governance.address, pauser.address, mockBank.address],
    { initializer: "initialize" }
  )) as AccountControl

  // Setup AccountControl in QCManager
  await qcManager.setAccountControl(accountControl.address)

  // Setup basic roles
  await qcData.grantRole(TEST_CONSTANTS.ROLES.QC_MANAGER, qcManager.address)
  await systemState.grantRole(TEST_CONSTANTS.ROLES.QC_MANAGER, qcManager.address)
  await qcManager.grantRole(TEST_CONSTANTS.ROLES.GOVERNANCE, governance.address)
  await qcManager.grantRole(TEST_CONSTANTS.ROLES.REGISTRAR, registrar.address)
  await qcManager.grantRole(TEST_CONSTANTS.ROLES.DISPUTE_ARBITER, arbiter.address)
  await qcManager.grantRole(TEST_CONSTANTS.ROLES.DISPUTE_ARBITER, governance.address) // Allow governance to set status in tests
  await qcManager.grantRole(TEST_CONSTANTS.ROLES.ENFORCEMENT, watchdog.address)

  // Transfer ownership of AccountControl to QCManager so it can authorize QCs
  await accountControl.connect(governance).transferOwnership(qcManager.address)

  return {
    // Contracts
    qcManager,
    qcData,
    systemState,
    reserveOracle,
    accountControl,
    mockBank,
    // Signers
    deployer,
    governance,
    qcAddress,
    arbiter,
    watchdog,
    registrar,
    pauser,
    user,
    // Constants
    constants: TEST_CONSTANTS,
  }
}

/**
 * Fixture for QCRedeemer with minimal mocking
 */
export async function deployQCRedeemerFixture() {
  const [deployer, governance, user, qcAddress, watchdog, thirdParty] =
    await ethers.getSigners()

  // Deploy real contracts
  const TBTCFactory = await ethers.getContractFactory("TBTC")
  const tbtc = await TBTCFactory.deploy()

  const QCDataFactory = await ethers.getContractFactory("QCData")
  const qcData = await QCDataFactory.deploy()

  const SystemStateFactory = await ethers.getContractFactory("SystemState")
  const systemState = await SystemStateFactory.deploy()

  const TestRelayFactory = await ethers.getContractFactory("TestRelay")
  const testRelay = await TestRelayFactory.deploy()
  
  // Configure TestRelay with difficulty from ValidMainnetProof
  // This ensures SPV validation works correctly with mainnet proofs
  await testRelay.setCurrentEpochDifficultyFromHeaders(ValidMainnetProof.proof.bitcoinHeaders)
  await testRelay.setPrevEpochDifficultyFromHeaders(ValidMainnetProof.proof.bitcoinHeaders)

  // Deploy all required libraries using the helper
  const libraries = await LibraryLinkingHelper.deployAllLibraries()

  // Deploy QCRedeemer using the helper
  const qcRedeemer = await LibraryLinkingHelper.deployQCRedeemer(
    tbtc.address,
    qcData.address,
    systemState.address,
    testRelay.address,
    1, // Low difficulty factor for testing
    libraries
  )

  // Deploy MockBank first for MockAccountControl dependency
  const MockBankFactory = await ethers.getContractFactory("MockBank")
  const mockBank = await MockBankFactory.deploy()

  // Deploy MockAccountControl for redemption tests
  const MockAccountControlFactory = await ethers.getContractFactory("MockAccountControl")
  const mockAccountControl = await MockAccountControlFactory.deploy(mockBank.address)
  await qcRedeemer.setAccountControl(mockAccountControl.address)

  // Setup basic configuration
  await qcRedeemer.grantRole(TEST_CONSTANTS.ROLES.DISPUTE_ARBITER, watchdog.address)
  await qcData.grantRole(TEST_CONSTANTS.ROLES.QC_MANAGER, qcRedeemer.address)

  // Set reasonable defaults for testing
  await mockAccountControl.setTotalMintedForTesting(
    ethers.BigNumber.from("100000000000") // 1000 BTC in satoshis
  )
  
  // Authorize QCRedeemer contract and set minted balance for redemptions
  await mockAccountControl.authorizeReserve(
    qcRedeemer.address,
    ethers.BigNumber.from("100000000000") // 1000 BTC minting cap
  )
  await mockAccountControl.setMintedForTesting(
    qcRedeemer.address,
    ethers.BigNumber.from("100000000000") // 1000 BTC in satoshis
  )

  return {
    // Contracts
    qcRedeemer,
    tbtc,
    qcData,
    systemState,
    testRelay,
    mockAccountControl,
    // Signers
    deployer,
    governance,
    user,
    qcAddress,
    watchdog,
    thirdParty,
    // Constants
    constants: TEST_CONSTANTS,
  }
}

/**
 * Fixture for AccountControl tests
 */
export async function deployAccountControlFixture() {
  const [owner, emergencyCouncil, reserve, user] = await ethers.getSigners()

  // Deploy MockBank
  const MockBankFactory = await ethers.getContractFactory("MockBank")
  const mockBank = await MockBankFactory.deploy()

  // Deploy AccountControl using upgrades proxy
  const AccountControlFactory = await ethers.getContractFactory("AccountControl")
  const accountControl = (await upgrades.deployProxy(
    AccountControlFactory,
    [owner.address, emergencyCouncil.address, mockBank.address],
    { initializer: "initialize" }
  )) as AccountControl

  // Authorize reserve with default cap
  await accountControl.connect(owner).authorizeReserve(reserve.address, TEST_CONSTANTS.SMALL_CAP)

  return {
    accountControl,
    mockBank,
    owner,
    emergencyCouncil,
    reserve,
    user,
    constants: TEST_CONSTANTS,
  }
}

/**
 * Simple SPV data for tests that don't require validation
 */
export function getSimpleSpvData() {
  return {
    txInfo: {
      version: "0x01000000",
      inputVector: `0x01${"00".repeat(36)}00${"00".repeat(4)}`,
      outputVector: `0x01${"00".repeat(8)}00`,
      locktime: "0x00000000",
    },
    proof: {
      merkleProof: ethers.utils.hexlify(new Uint8Array(32)),
      txIndexInBlock: 0,
      bitcoinHeaders: ethers.utils.hexlify(new Uint8Array(80)),
      coinbasePreimage: ethers.utils.hexZeroPad("0x00", 32),
      coinbaseProof: ethers.utils.hexlify(new Uint8Array(32)),
    },
  }
}

/**
 * Get valid SPV data from tBTC v2 test suite for QCRedeemer tests
 * This adapts the ValidMainnetProof to the format expected by QCRedeemer
 */
export function getValidSpvData() {
  return {
    txInfo: {
      version: ValidMainnetProof.txInfo.version,
      inputVector: ValidMainnetProof.txInfo.inputVector,
      outputVector: ValidMainnetProof.txInfo.outputVector,
      locktime: ValidMainnetProof.txInfo.locktime,
    },
    proof: {
      merkleProof: ValidMainnetProof.proof.merkleProof,
      txIndexInBlock: ValidMainnetProof.proof.txIndexInBlock,
      bitcoinHeaders: ValidMainnetProof.proof.bitcoinHeaders,
      coinbasePreimage: ValidMainnetProof.proof.coinbasePreimage,
      coinbaseProof: ValidMainnetProof.proof.coinbaseProof,
    },
  }
}

/**
 * Helper to setup a QC for testing
 */
export async function setupTestQC(
  fixture: Awaited<ReturnType<typeof deployQCManagerFixture>>,
  options: {
    mintingCap?: ethers.BigNumber
    activate?: boolean
  } = {}
) {
  const { qcManager, governance, qcAddress, constants } = fixture
  const mintingCap = options.mintingCap || constants.MEDIUM_CAP

  // Register QC (automatically sets status to Active)
  await qcManager.connect(governance).registerQC(qcAddress.address, mintingCap)

  // Note: QC is already Active after registration, no need to set status again

  return qcAddress
}

/**
 * Helper to create a redemption request
 */
export async function createTestRedemption(
  fixture: Awaited<ReturnType<typeof deployQCRedeemerFixture>>,
  options: {
    amount?: number
    btcAddress?: string
    walletAddress?: string
  } = {}
) {
  const { qcRedeemer, qcAddress, user, constants, tbtc } = fixture
  const amountSatoshis = options.amount || constants.MEDIUM_MINT // Use MEDIUM_MINT as default (meets minimum requirement)
  const amount = ethers.BigNumber.from(amountSatoshis).mul(ethers.BigNumber.from(10).pow(10)) // Convert to tBTC Wei
  const btcAddress = options.btcAddress || constants.VALID_LEGACY_BTC
  const walletAddress = options.walletAddress || constants.VALID_P2SH_BTC

  // Setup QC and wallet in QCData
  const isRegistered = await fixture.qcData.isQCRegistered(qcAddress.address)
  if (!isRegistered) {
    await fixture.qcData.registerQC(qcAddress.address, constants.LARGE_CAP)
  }
  const qcWalletAddress = walletAddress
  
  // Register QC's wallet address (the wallet that will handle the redemption)
  const isQcWalletRegistered = await fixture.qcData.isWalletRegistered(qcWalletAddress)
  if (!isQcWalletRegistered) {
    await fixture.qcData.registerWallet(
      qcAddress.address,
      qcWalletAddress
    )
  }

  // Always mint tBTC for user (each test has fresh state via loadFixture)
  await tbtc.mint(user.address, amount.mul(2)) // Mint 2x to ensure sufficient balance
  await tbtc.connect(user).approve(qcRedeemer.address, amount.mul(2))

  // Create redemption (new API)
  const tx = await qcRedeemer.connect(user).initiateRedemption(
    qcAddress.address,
    amount,
    btcAddress,
    qcWalletAddress
  )

  const receipt = await tx.wait()
  const event = receipt.events?.find(e => e.event === "RedemptionRequested")
  const redemptionId = event?.args?.[0]

  return { redemptionId, amount, btcAddress, walletAddress: qcWalletAddress }
}