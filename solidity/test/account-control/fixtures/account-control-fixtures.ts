import { ethers } from "hardhat"
import { BigNumber } from "ethers"
import * as LibraryLinkingHelper from "../helpers/library-linking-helper"
import { ROLES, BTC_ADDRESSES } from "../../fixtures/constants"

/**
 * Bitcoin amounts in satoshis for QC testing
 * These are specific to account control tests and use Bitcoin units
 */
const BTC_AMOUNTS = {
  MIN_MINT: 10000, // 0.0001 BTC
  SMALL_MINT: 500000, // 0.005 BTC
  MEDIUM_MINT: 1000000, // 0.01 BTC
  LARGE_MINT: 10000000, // 0.1 BTC
  SMALL_CAP: 1000000, // 0.01 BTC
  MEDIUM_CAP: 10000000, // 0.1 BTC
  LARGE_CAP: 100000000, // 1 BTC
  MAX_CAP: ethers.utils.parseUnits("100", 8), // 100 BTC
} as const

/**
 * Fixture for QCManager with minimal real contracts
 * Reduces mock usage by deploying actual contracts where practical
 */
export async function deployQCManagerFixture() {
  const [
    deployer,
    governance,
    qcAddress,
    arbiter,
    watchdog,
    registrar,
    pauser,
    user,
  ] = await ethers.getSigners()

  // Deploy real contracts instead of mocks where practical
  const QCDataFactory = await ethers.getContractFactory("QCData")
  const qcData = await QCDataFactory.deploy()

  const SystemStateFactory = await ethers.getContractFactory("SystemState")
  const systemState = await SystemStateFactory.deploy()

  const ReserveOracleFactory = await ethers.getContractFactory("ReserveOracle")
  const reserveOracle = await ReserveOracleFactory.deploy(systemState.address)

  // Deploy libraries using the helper
  const libraries = await LibraryLinkingHelper.setupLibraryLinking()

  // Deploy QCPauseManager first with deployer as temporary QCManager
  const QCPauseManagerFactory = await ethers.getContractFactory(
    "QCPauseManager"
  )

  const pauseManager = await QCPauseManagerFactory.deploy(
    qcData.address,
    deployer.address, // Temporary QCManager address
    deployer.address, // Admin
    deployer.address // Emergency role
  )

  // Deploy MockQCWalletManager
  const MockQCWalletManagerFactory = await ethers.getContractFactory(
    "MockQCWalletManager"
  )

  const walletManager = await MockQCWalletManagerFactory.deploy()

  // Deploy MockBank for AccountControl first
  const MockBankFactory = await ethers.getContractFactory("MockBank")
  const mockBank = await MockBankFactory.deploy()

  // Deploy AccountControl first
  const AccountControlFactory = await ethers.getContractFactory(
    "AccountControl"
  )

  const accountControl = await AccountControlFactory.deploy(
    governance.address,
    pauser.address,
    mockBank.address
  )

  await accountControl.deployed()

  // Now deploy QCManager with AccountControl address
  const qcManager = await LibraryLinkingHelper.LibraryLinkingHelper.deployQCManager(
    qcData.address,
    systemState.address,
    reserveOracle.address,
    accountControl.address,
    pauseManager.address,
    walletManager.address,
    libraries
  )

  // Grant QC_MANAGER_ROLE to the real QCManager and revoke from deployer
  const QC_MANAGER_ROLE = await pauseManager.QC_MANAGER_ROLE()
  await pauseManager.grantRole(QC_MANAGER_ROLE, qcManager.address)
  await pauseManager.revokeRole(QC_MANAGER_ROLE, deployer.address)

  // Setup basic roles
  await qcData.grantRole(ROLES.QC_MANAGER, qcManager.address)
  await systemState.grantRole(
    ROLES.QC_MANAGER,
    qcManager.address
  )
  await qcManager.grantRole(ROLES.GOVERNANCE, governance.address)
  await qcManager.grantRole(ROLES.REGISTRAR, registrar.address)
  await qcManager.grantRole(
    ROLES.DISPUTE_ARBITER,
    arbiter.address
  )
  await qcManager.grantRole(
    ROLES.DISPUTE_ARBITER,
    governance.address
  ) // Allow governance to set status in tests
  await qcManager.grantRole(ROLES.ENFORCEMENT, watchdog.address)

  // Grant RESERVE_ROLE and ORACLE_ROLE to QCManager in AccountControl
  await accountControl.connect(governance).grantReserveRole(qcManager.address)
  await accountControl.connect(governance).grantOracleRole(qcManager.address)

  return {
    // Contracts
    qcManager,
    qcData,
    systemState,
    reserveOracle,
    accountControl,
    pauseManager,
    walletManager,
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
    constants: BTC_AMOUNTS,
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

  // Deploy all required libraries using the helper
  const libraries = await LibraryLinkingHelper.deployAllLibraries()

  // Deploy MockBank first for MockAccountControl dependency
  const MockBankFactory = await ethers.getContractFactory("MockBank")
  const mockBank = await MockBankFactory.deploy()

  // Deploy MockAccountControl for redemption tests
  const MockAccountControlFactory = await ethers.getContractFactory(
    "MockAccountControl"
  )

  const mockAccountControl = await MockAccountControlFactory.deploy(
    mockBank.address
  )

  // Deploy QCRedeemer using the helper with proper AccountControl address
  const qcRedeemer = await LibraryLinkingHelper.LibraryLinkingHelper.deployQCRedeemer(
    tbtc.address,
    qcData.address,
    systemState.address,
    mockAccountControl.address,
    libraries
  )

  // Setup basic configuration
  await qcRedeemer.grantRole(
    ROLES.DISPUTE_ARBITER,
    watchdog.address
  )
  await qcData.grantRole(ROLES.QC_MANAGER, qcRedeemer.address)
  // Grant QC_MANAGER role to deployer for test setup
  await qcData.grantRole(ROLES.QC_MANAGER, deployer.address)

  // Set reasonable defaults for testing
  await mockAccountControl.setTotalMintedForTesting(
    ethers.BigNumber.from("100000000000") // 1000 BTC in satoshis
  )

  // Authorize QCRedeemer contract and set minted balance for redemptions
  await mockAccountControl.authorizeReserve(
    qcRedeemer.address,
    ethers.BigNumber.from("100000000000"), // 1000 BTC minting cap
    1 // ReserveType.QC_PERMISSIONED
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
    mockAccountControl,
    // Signers
    deployer,
    governance,
    user,
    qcAddress,
    watchdog,
    thirdParty,
    // Constants
    constants: BTC_AMOUNTS,
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

  // Deploy AccountControl with direct deployment (not upgradeable)
  const AccountControlFactory = await ethers.getContractFactory(
    "AccountControl"
  )

  const accountControl = await AccountControlFactory.deploy(
    owner.address,
    emergencyCouncil.address,
    mockBank.address
  )

  // Authorize reserve with default cap
  await accountControl
    .connect(owner)
    .authorizeReserve(reserve.address, BTC_AMOUNTS.SMALL_CAP, 1) // ReserveType.QC_PERMISSIONED

  return {
    accountControl,
    mockBank,
    owner,
    emergencyCouncil,
    reserve,
    user,
    constants: BTC_AMOUNTS,
  }
}

/**
 * Helper to setup a QC for testing
 */
export async function setupTestQC(
  fixture: Awaited<ReturnType<typeof deployQCManagerFixture>>,
  options: {
    mintingCap?: BigNumber
    activate?: boolean
  } = {}
) {
  const { qcManager, governance, qcAddress, constants } = fixture
  const mintingCap = options.mintingCap || ethers.BigNumber.from(constants.MEDIUM_CAP)

  // Register QC (automatically sets status to Active)
  await qcManager.connect(governance).registerQC(qcAddress.address, mintingCap)

  // Note: QC is already Active after registration, no need to set status again

  return qcAddress
}

/**
 * Helper to create a redemption request with enhanced configuration
 */
export async function createTestRedemption(
  fixture: Awaited<ReturnType<typeof deployQCRedeemerFixture>>,
  options: {
    amount?: number
    btcAddress?: string
    walletAddress?: string
    user?: any
    qcAddress?: any
  } = {}
) {
  const {
    qcRedeemer,
    qcAddress: defaultQC,
    user: defaultUser,
    constants,
    tbtc,
  } = fixture

  const amountSatoshis = options.amount || BTC_AMOUNTS.MEDIUM_MINT
  const user = options.user || defaultUser
  const qcAddress = options.qcAddress || defaultQC

  const amount = ethers.BigNumber.from(amountSatoshis).mul(
    ethers.BigNumber.from(10).pow(10)
  ) // Convert to tBTC Wei

  const btcAddress = options.btcAddress || BTC_ADDRESSES.GENESIS_BLOCK
  const walletAddress = options.walletAddress || BTC_ADDRESSES.P2SH_STANDARD

  // Setup QC and wallet in QCData
  const isRegistered = await fixture.qcData.isQCRegistered(
    qcAddress.address || qcAddress
  )

  if (!isRegistered) {
    await fixture.qcData.registerQC(
      qcAddress.address || qcAddress,
      BTC_AMOUNTS.LARGE_CAP
    )
  }
  const qcWalletAddress = walletAddress

  // Register QC's wallet address (the wallet that will handle the redemption)
  const isQcWalletRegistered = await fixture.qcData.isWalletRegistered(
    qcWalletAddress
  )

  if (!isQcWalletRegistered) {
    await fixture.qcData.registerWallet(
      qcAddress.address || qcAddress,
      qcWalletAddress
    )
    // Activate the wallet since it starts as Inactive
    await fixture.qcData.activateWallet(qcWalletAddress)
  }

  // Setup minted balance for the QC in MockAccountControl to avoid InsufficientMinted errors
  const { mockAccountControl } = fixture
  if (mockAccountControl && mockAccountControl.setMintedForTesting) {
    // Set a large minted balance for the QC
    await mockAccountControl.setMintedForTesting(
      qcAddress.address || qcAddress,
      ethers.utils.parseUnits("1000", 8) // 1000 BTC in satoshis
    )
  }

  // Always mint tBTC for user (each test has fresh state via loadFixture)
  await tbtc.mint(user.address, amount.mul(2)) // Mint 2x to ensure sufficient balance
  await tbtc.connect(user).approve(qcRedeemer.address, amount.mul(2))

  // Create redemption (new API)
  const tx = await qcRedeemer
    .connect(user)
    .initiateRedemption(
      qcAddress.address || qcAddress,
      amount,
      btcAddress,
      qcWalletAddress
    )

  const receipt = await tx.wait()
  const event = receipt.events?.find((e) => e.event === "RedemptionRequested")
  const redemptionId = event?.args?.[0]

  return {
    redemptionId,
    amount,
    btcAddress,
    walletAddress: qcWalletAddress,
    user,
    qcAddress: qcAddress.address || qcAddress,
  }
}

/**
 * Helper to create multiple redemptions in batch
 */
export async function createTestRedemptionBatch(
  fixture: Awaited<ReturnType<typeof deployQCRedeemerFixture>>,
  count: number,
  baseOptions: {
    amount?: number
    btcAddress?: string
    walletAddress?: string
    user?: any
    qcAddress?: any
  } = {}
) {
  const redemptions = []

  for (let i = 0; i < count; i++) {
    // Slightly vary amounts to avoid identical transactions
    const options = {
      ...baseOptions,
      amount: (baseOptions.amount || BTC_AMOUNTS.MEDIUM_MINT) + i * 10000,
    }

    const result = await createTestRedemption(fixture, options)
    redemptions.push(result)
  }

  return redemptions
}

/**
 * Helper to setup complex test scenario with multiple QCs and users
 */
export async function setupComplexTestScenario(
  fixture: Awaited<ReturnType<typeof deployQCRedeemerFixture>>,
  config: {
    qcCount?: number
    userCount?: number
    walletsPerQC?: number
  } = {}
) {
  const { qcCount = 2, userCount = 3, walletsPerQC = 2 } = config
  const allSigners = await ethers.getSigners()

  // Setup additional QCs
  const qcs = [fixture.qcAddress.address]
  for (let i = 1; i < qcCount; i++) {
    const qcAddr = allSigners[10 + i].address // Start from signer index 10
    await fixture.qcData.registerQC(qcAddr, BTC_AMOUNTS.LARGE_CAP)
    qcs.push(qcAddr)
  }

  // Setup additional users
  const users = [fixture.user]
  for (let i = 1; i < userCount; i++) {
    users.push(allSigners[15 + i]) // Start from signer index 15
  }

  // Setup wallets for each QC
  const walletsByQC: Record<string, string[]> = {}

  const allWallets = [
    BTC_ADDRESSES.GENESIS_BLOCK,
    "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
    "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
    "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    "1JfbZRwdDHKZmuiZgYArJZhcuuzuw2HuMu",
    "3QJmV3qfvL9SuYo34YihAf3sRCW3qSinyC",
  ]

  for (let i = 0; i < qcs.length; i++) {
    const qcAddr = qcs[i]
    const wallets = []

    for (let j = 0; j < walletsPerQC; j++) {
      const walletAddr = allWallets[i * walletsPerQC + j]
      await fixture.qcData.registerWallet(qcAddr, walletAddr)
      await fixture.qcData.activateWallet(walletAddr)
      wallets.push(walletAddr)
    }

    walletsByQC[qcAddr] = wallets
  }

  // Mint tBTC for all users
  const userBalance = ethers.utils.parseEther("100") // 100 tBTC
  for (const user of users) {
    await fixture.tbtc.mint(user.address, userBalance)
  }

  return {
    qcs,
    users,
    walletsByQC,
  }
}

/**
 * Helper to verify redemption state comprehensively
 */
export async function verifyRedemptionState(
  qcRedeemer: any,
  redemptionId: string,
  expected: {
    status?: number
    isFulfilled?: boolean
    isDefaulted?: boolean
    isTimedOut?: boolean
    user?: string
    qc?: string
    amount?: BigNumber
  }
) {
  const redemption = await qcRedeemer.redemptions(redemptionId)

  if (expected.status !== undefined) {
    expect(redemption.status).to.equal(
      expected.status,
      `Status mismatch for redemption ${redemptionId}`
    )
  }

  if (expected.isFulfilled !== undefined) {
    const isFulfilled = await qcRedeemer.isRedemptionFulfilled(redemptionId)
    expect(isFulfilled).to.equal(
      expected.isFulfilled,
      `Fulfillment status mismatch for redemption ${redemptionId}`
    )
  }

  if (expected.isDefaulted !== undefined) {
    const [isDefaulted] = await qcRedeemer.isRedemptionDefaulted(redemptionId)
    expect(isDefaulted).to.equal(
      expected.isDefaulted,
      `Default status mismatch for redemption ${redemptionId}`
    )
  }

  if (expected.isTimedOut !== undefined) {
    const isTimedOut = await qcRedeemer.isRedemptionTimedOut(redemptionId)
    expect(isTimedOut).to.equal(
      expected.isTimedOut,
      `Timeout status mismatch for redemption ${redemptionId}`
    )
  }

  if (expected.user) {
    expect(redemption.user).to.equal(
      expected.user,
      `User mismatch for redemption ${redemptionId}`
    )
  }

  if (expected.qc) {
    expect(redemption.qc).to.equal(
      expected.qc,
      `QC mismatch for redemption ${redemptionId}`
    )
  }

  if (expected.amount) {
    expect(redemption.amount).to.equal(
      expected.amount,
      `Amount mismatch for redemption ${redemptionId}`
    )
  }
}

/**
 * Helper to fulfill a redemption with standard parameters
 */
export async function fulfillTestRedemption(
  qcRedeemer: any,
  watchdog: any,
  redemptionId: string,
  amount: BigNumber,
  actualAmountSatoshis?: BigNumber
) {
  const satoshiAmount =
    actualAmountSatoshis || amount.div(ethers.BigNumber.from(10).pow(10))

  return await qcRedeemer
    .connect(watchdog)
    .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)
}

/**
 * Helper to default a redemption with standard parameters
 */
export async function defaultTestRedemption(
  qcRedeemer: any,
  watchdog: any,
  redemptionId: string,
  reason: string = "TEST_DEFAULT"
) {
  const reasonBytes32 = ethers.utils.formatBytes32String(reason)
  return await qcRedeemer
    .connect(watchdog)
    .flagDefaultedRedemption(redemptionId, reasonBytes32)
}
