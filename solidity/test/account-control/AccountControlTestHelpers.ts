import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  ProtocolRegistry,
  QCData,
  QCManager,
  SystemState,
  QCMinter,
  QCRedeemer,
  QCReserveLedger,
  BasicMintingPolicy,
  BasicRedemptionPolicy,
  SingleWatchdog,
  TBTC,
  SPVValidator,
} from "../../typechain"

/**
 * Account Control Test Helpers
 *
 * This module provides utility functions and test fixtures for Account Control testing.
 * It includes deployment helpers, mock creation utilities, and common test patterns.
 */

// Service key constants
export const SERVICE_KEYS = {
  QC_DATA: ethers.utils.id("QC_DATA"),
  QC_MANAGER: ethers.utils.id("QC_MANAGER"),
  SYSTEM_STATE: ethers.utils.id("SYSTEM_STATE"),
  QC_MINTER: ethers.utils.id("QC_MINTER"),
  QC_REDEEMER: ethers.utils.id("QC_REDEEMER"),
  QC_RESERVE_LEDGER: ethers.utils.id("QC_RESERVE_LEDGER"),
  MINTING_POLICY: ethers.utils.id("MINTING_POLICY"),
  REDEMPTION_POLICY: ethers.utils.id("REDEMPTION_POLICY"),
  SINGLE_WATCHDOG: ethers.utils.id("SINGLE_WATCHDOG"),
  TBTC_TOKEN: ethers.utils.id("TBTC_TOKEN"),
  SPV_VALIDATOR: ethers.utils.id("SPV_VALIDATOR"),
}

// Role constants
export const ROLES = {
  DEFAULT_ADMIN_ROLE: ethers.constants.HashZero,
  QC_ADMIN_ROLE: ethers.utils.id("QC_ADMIN_ROLE"),
  QC_MANAGER_ROLE: ethers.utils.id("QC_MANAGER_ROLE"),
  ATTESTER_ROLE: ethers.utils.id("ATTESTER_ROLE"),
  REGISTRAR_ROLE: ethers.utils.id("REGISTRAR_ROLE"),
  ARBITER_ROLE: ethers.utils.id("ARBITER_ROLE"),
  PAUSER_ROLE: ethers.utils.id("PAUSER_ROLE"),
  PARAMETER_ADMIN_ROLE: ethers.utils.id("PARAMETER_ADMIN_ROLE"),
  POLICY_ADMIN_ROLE: ethers.utils.id("POLICY_ADMIN_ROLE"),
  WATCHDOG_OPERATOR_ROLE: ethers.utils.id("WATCHDOG_OPERATOR_ROLE"),
}

// Test data constants
export const TEST_DATA = {
  BTC_ADDRESSES: {
    LEGACY: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    SEGWIT: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    TEST: "bc1qtest123456789",
  },
  AMOUNTS: {
    MIN_MINT: ethers.utils.parseEther("0.01"),
    NORMAL_MINT: ethers.utils.parseEther("5"),
    MAX_MINT: ethers.utils.parseEther("1000"),
    RESERVE_BALANCE: ethers.utils.parseEther("10"),
  },
  TIMEOUTS: {
    REDEMPTION: 604800, // 7 days
    STALE_THRESHOLD: 86400, // 24 hours
  },
  REASONS: {
    UNDERCOLLATERALIZED: ethers.utils.id("UNDERCOLLATERALIZED"),
    TIMEOUT: ethers.utils.id("TIMEOUT"),
    FRAUD: ethers.utils.id("FRAUD"),
  },
}

// QC and Wallet status enums
export enum QCStatus {
  Active = 0,
  UnderReview = 1,
  Revoked = 2,
}

export enum WalletStatus {
  Inactive = 0,
  Active = 1,
  PendingDeRegistration = 2,
  Deregistered = 3,
}

export enum RedemptionStatus {
  NeverInitiated = 0,
  Pending = 1,
  Fulfilled = 2,
  Defaulted = 3,
}

/**
 * Test fixture for deploying a complete Account Control system
 */
export interface AccountControlFixture {
  // Core contracts
  protocolRegistry: ProtocolRegistry
  qcData: QCData
  qcManager: QCManager
  systemState: SystemState
  qcMinter: QCMinter
  qcRedeemer: QCRedeemer
  qcReserveLedger: QCReserveLedger
  basicMintingPolicy: BasicMintingPolicy
  basicRedemptionPolicy: BasicRedemptionPolicy
  singleWatchdog: SingleWatchdog

  // TBTC token
  tbtc: TBTC

  // Test accounts
  deployer: SignerWithAddress
  governance: SignerWithAddress
  qcAddress: SignerWithAddress
  user: SignerWithAddress
  watchdog: SignerWithAddress
}

/**
 * Security test fixture with mock TBTC for attack scenario testing
 */
export interface SecurityTestFixture
  extends Omit<AccountControlFixture, "tbtc"> {
  // Mock TBTC token for security tests
  tbtc: FakeContract<TBTC>
  // Mock SPV validator for security tests
  mockSpvValidator: FakeContract<SPVValidator>
}

/**
 * Deploy a complete Account Control system for testing
 */
export async function deployAccountControlFixture(): Promise<AccountControlFixture> {
  const [deployer, governance, qcAddress, user, watchdog] =
    await ethers.getSigners()

  // Deploy ProtocolRegistry
  const ProtocolRegistryFactory = await ethers.getContractFactory(
    "ProtocolRegistry"
  )
  const protocolRegistry = await ProtocolRegistryFactory.deploy()
  await protocolRegistry.deployed()

  // Deploy core contracts
  const QCDataFactory = await ethers.getContractFactory("QCData")
  const qcData = await QCDataFactory.deploy()
  await qcData.deployed()

  const SystemStateFactory = await ethers.getContractFactory("SystemState")
  const systemState = await SystemStateFactory.deploy()
  await systemState.deployed()

  const QCManagerFactory = await ethers.getContractFactory("QCManager")
  const qcManager = await QCManagerFactory.deploy(protocolRegistry.address)
  await qcManager.deployed()

  const QCMinterFactory = await ethers.getContractFactory("QCMinter")
  const qcMinter = await QCMinterFactory.deploy(protocolRegistry.address)
  await qcMinter.deployed()

  const QCRedeemerFactory = await ethers.getContractFactory("QCRedeemer")
  const qcRedeemer = await QCRedeemerFactory.deploy(protocolRegistry.address)
  await qcRedeemer.deployed()

  const QCReserveLedgerFactory = await ethers.getContractFactory(
    "QCReserveLedger"
  )
  const qcReserveLedger = await QCReserveLedgerFactory.deploy(
    protocolRegistry.address
  )
  await qcReserveLedger.deployed()

  // Deploy policy contracts
  const BasicMintingPolicyFactory = await ethers.getContractFactory(
    "BasicMintingPolicy"
  )
  const basicMintingPolicy = await BasicMintingPolicyFactory.deploy(
    protocolRegistry.address
  )
  await basicMintingPolicy.deployed()

  const BasicRedemptionPolicyFactory = await ethers.getContractFactory(
    "BasicRedemptionPolicy"
  )
  const basicRedemptionPolicy = await BasicRedemptionPolicyFactory.deploy(
    protocolRegistry.address
  )
  await basicRedemptionPolicy.deployed()

  // Deploy SingleWatchdog
  const SingleWatchdogFactory = await ethers.getContractFactory(
    "SingleWatchdog"
  )
  const singleWatchdog = await SingleWatchdogFactory.deploy(
    protocolRegistry.address
  )
  await singleWatchdog.deployed()

  // Deploy real TBTC token (same as integration test)
  const TBTCFactory = await ethers.getContractFactory("TBTC")
  const tbtc = await TBTCFactory.deploy()
  await tbtc.deployed()

  // Register all services in ProtocolRegistry
  await protocolRegistry.setService(SERVICE_KEYS.QC_DATA, qcData.address)
  await protocolRegistry.setService(SERVICE_KEYS.QC_MANAGER, qcManager.address)
  await protocolRegistry.setService(
    SERVICE_KEYS.SYSTEM_STATE,
    systemState.address
  )
  await protocolRegistry.setService(SERVICE_KEYS.QC_MINTER, qcMinter.address)
  await protocolRegistry.setService(
    SERVICE_KEYS.QC_REDEEMER,
    qcRedeemer.address
  )
  await protocolRegistry.setService(
    SERVICE_KEYS.QC_RESERVE_LEDGER,
    qcReserveLedger.address
  )
  await protocolRegistry.setService(
    SERVICE_KEYS.MINTING_POLICY,
    basicMintingPolicy.address
  )
  await protocolRegistry.setService(
    SERVICE_KEYS.REDEMPTION_POLICY,
    basicRedemptionPolicy.address
  )
  await protocolRegistry.setService(
    SERVICE_KEYS.SINGLE_WATCHDOG,
    singleWatchdog.address
  )
  await protocolRegistry.setService(SERVICE_KEYS.TBTC_TOKEN, tbtc.address)

  // Grant necessary roles
  await qcData.grantQCManagerRole(qcManager.address)
  await qcManager.grantRole(ROLES.REGISTRAR_ROLE, watchdog.address)
  await qcManager.grantRole(ROLES.ARBITER_ROLE, watchdog.address)
  await qcManager.grantRole(ROLES.QC_ADMIN_ROLE, basicMintingPolicy.address) // Grant role to policy for minting
  await qcReserveLedger.grantRole(ROLES.ATTESTER_ROLE, watchdog.address)
  await singleWatchdog.grantRole(ROLES.WATCHDOG_OPERATOR_ROLE, watchdog.address)

  // Transfer ownership of TBTC to the BasicMintingPolicy for minting
  await tbtc.transferOwnership(basicMintingPolicy.address)

  return {
    protocolRegistry,
    qcData,
    qcManager,
    systemState,
    qcMinter,
    qcRedeemer,
    qcReserveLedger,
    basicMintingPolicy,
    basicRedemptionPolicy,
    singleWatchdog,
    tbtc,
    deployer,
    governance,
    qcAddress,
    user,
    watchdog,
  }
}

/**
 * Deploy a complete Account Control system with mock TBTC for security testing
 */
export async function deploySecurityTestFixture(): Promise<SecurityTestFixture> {
  const [deployer, governance, qcAddress, user, watchdog] =
    await ethers.getSigners()

  // Deploy ProtocolRegistry
  const ProtocolRegistryFactory = await ethers.getContractFactory(
    "ProtocolRegistry"
  )
  const protocolRegistry = await ProtocolRegistryFactory.deploy()
  await protocolRegistry.deployed()

  // Deploy core contracts
  const QCDataFactory = await ethers.getContractFactory("QCData")
  const qcData = await QCDataFactory.deploy()
  await qcData.deployed()

  const SystemStateFactory = await ethers.getContractFactory("SystemState")
  const systemState = await SystemStateFactory.deploy()
  await systemState.deployed()

  const QCManagerFactory = await ethers.getContractFactory("QCManager")
  const qcManager = await QCManagerFactory.deploy(protocolRegistry.address)
  await qcManager.deployed()

  const QCMinterFactory = await ethers.getContractFactory("QCMinter")
  const qcMinter = await QCMinterFactory.deploy(protocolRegistry.address)
  await qcMinter.deployed()

  const QCRedeemerFactory = await ethers.getContractFactory("QCRedeemer")
  const qcRedeemer = await QCRedeemerFactory.deploy(protocolRegistry.address)
  await qcRedeemer.deployed()

  const QCReserveLedgerFactory = await ethers.getContractFactory(
    "QCReserveLedger"
  )
  const qcReserveLedger = await QCReserveLedgerFactory.deploy(
    protocolRegistry.address
  )
  await qcReserveLedger.deployed()

  // Deploy policy contracts
  const BasicMintingPolicyFactory = await ethers.getContractFactory(
    "BasicMintingPolicy"
  )
  const basicMintingPolicy = await BasicMintingPolicyFactory.deploy(
    protocolRegistry.address
  )
  await basicMintingPolicy.deployed()

  const BasicRedemptionPolicyFactory = await ethers.getContractFactory(
    "BasicRedemptionPolicy"
  )
  const basicRedemptionPolicy = await BasicRedemptionPolicyFactory.deploy(
    protocolRegistry.address
  )
  await basicRedemptionPolicy.deployed()

  // Deploy SingleWatchdog
  const SingleWatchdogFactory = await ethers.getContractFactory(
    "SingleWatchdog"
  )
  const singleWatchdog = await SingleWatchdogFactory.deploy(
    protocolRegistry.address
  )
  await singleWatchdog.deployed()

  // Create mock TBTC token for security tests
  const tbtc = await smock.fake<TBTC>("TBTC")

  // Create mock SPV validator for security tests
  const mockSpvValidator = await smock.fake<SPVValidator>("SPVValidator")

  // Configure SPV validator to return true for wallet control verification
  mockSpvValidator.verifyWalletControl.returns(true)

  // Configure SPV validator to return true for redemption fulfillment verification
  mockSpvValidator.verifyRedemptionFulfillment.returns(true)

  // Register all services in ProtocolRegistry
  await protocolRegistry.setService(SERVICE_KEYS.QC_DATA, qcData.address)
  await protocolRegistry.setService(SERVICE_KEYS.QC_MANAGER, qcManager.address)
  await protocolRegistry.setService(
    SERVICE_KEYS.SYSTEM_STATE,
    systemState.address
  )
  await protocolRegistry.setService(SERVICE_KEYS.QC_MINTER, qcMinter.address)
  await protocolRegistry.setService(
    SERVICE_KEYS.QC_REDEEMER,
    qcRedeemer.address
  )
  await protocolRegistry.setService(
    SERVICE_KEYS.QC_RESERVE_LEDGER,
    qcReserveLedger.address
  )
  await protocolRegistry.setService(
    SERVICE_KEYS.MINTING_POLICY,
    basicMintingPolicy.address
  )
  await protocolRegistry.setService(
    SERVICE_KEYS.REDEMPTION_POLICY,
    basicRedemptionPolicy.address
  )
  await protocolRegistry.setService(
    SERVICE_KEYS.SINGLE_WATCHDOG,
    singleWatchdog.address
  )
  await protocolRegistry.setService(SERVICE_KEYS.TBTC_TOKEN, tbtc.address)

  // Grant necessary roles
  await qcData.grantQCManagerRole(qcManager.address)
  await qcManager.grantRole(ROLES.REGISTRAR_ROLE, watchdog.address)
  await qcManager.grantRole(ROLES.ARBITER_ROLE, watchdog.address)
  await qcManager.grantRole(ROLES.QC_ADMIN_ROLE, basicMintingPolicy.address) // Grant role to policy for minting
  await qcReserveLedger.grantRole(ROLES.ATTESTER_ROLE, watchdog.address)
  await singleWatchdog.grantRole(ROLES.WATCHDOG_OPERATOR_ROLE, watchdog.address)

  // Grant roles to SingleWatchdog contract so it can call other contracts
  await qcManager.grantRole(ROLES.REGISTRAR_ROLE, singleWatchdog.address)
  await qcManager.grantRole(ROLES.ARBITER_ROLE, singleWatchdog.address)
  await qcReserveLedger.grantRole(ROLES.ATTESTER_ROLE, singleWatchdog.address)

  // Grant QCManager the ATTESTER_ROLE so it can update reserves during wallet deregistration
  await qcReserveLedger.grantRole(ROLES.ATTESTER_ROLE, qcManager.address)

  // Register SPV validator in protocol registry
  await protocolRegistry.setService(
    SERVICE_KEYS.SPV_VALIDATOR,
    mockSpvValidator.address
  )

  // Note: No need to transfer ownership of mock TBTC

  return {
    protocolRegistry,
    qcData,
    qcManager,
    systemState,
    qcMinter,
    qcRedeemer,
    qcReserveLedger,
    basicMintingPolicy,
    basicRedemptionPolicy,
    singleWatchdog,
    tbtc,
    mockSpvValidator,
    deployer,
    governance,
    qcAddress,
    user,
    watchdog,
  }
}

/**
 * Setup a QC with wallets and reserves for testing
 */
export async function setupQCWithWallets(
  fixture: AccountControlFixture,
  qcAddress: string,
  walletAddresses: string[] = [TEST_DATA.BTC_ADDRESSES.TEST],
  reserveBalance: typeof ethers.BigNumber = TEST_DATA.AMOUNTS.RESERVE_BALANCE
) {
  const { qcManager, qcReserveLedger, watchdog } = fixture

  // Register QC
  await qcManager.registerQC(qcAddress)

  // Register wallets
  await walletAddresses.reduce(async (prev, walletAddress) => {
    await prev
    const { challenge, txInfo, proof } = createMockSpvData(
      `setup_${walletAddress}`
    )
    await qcManager
      .connect(watchdog)
      .registerWallet(qcAddress, walletAddress, challenge, txInfo, proof)
  }, Promise.resolve())

  // Submit reserve attestation
  await qcReserveLedger
    .connect(watchdog)
    .submitReserveAttestation(qcAddress, reserveBalance)
}

/**
 * Generate a unique redemption ID for testing
 */
export function generateRedemptionId(
  user: string,
  qc: string,
  amount: typeof ethers.BigNumber,
  nonce: number = Date.now()
): string {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "address", "uint256", "uint256"],
      [user, qc, amount, nonce]
    )
  )
}

/**
 * Generate a unique mint ID for testing
 */
export function generateMintId(
  user: string,
  qc: string,
  amount: typeof ethers.BigNumber,
  nonce: number = Date.now()
): string {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "address", "uint256", "uint256"],
      [user, qc, amount, nonce]
    )
  )
}

/**
 * Create mock SPV proof for testing
 */
export function createMockSpvProof(identifier = "default"): Uint8Array {
  return ethers.utils.toUtf8Bytes(`mock_spv_proof_${identifier}_${Date.now()}`)
}

/**
 * Create mock SPV challenge, transaction info, and proof structures for testing
 */
export function createMockSpvData(identifier = "default") {
  const challenge = ethers.utils.id(`CHALLENGE_${identifier}`)

  const txInfo = {
    version: "0x01000000",
    inputVector:
      "0x011746bd867400f3494b8f44c24b83e1aa58c4f0ff25b4a61cffeffd4bc0f9ba3000000000ffffffff",
    outputVector:
      "0x024897070000000000220020a4333e5612ab1a1043b25755c89b16d51800",
    locktime: "0x00000000",
  }

  const proof = {
    merkleProof:
      "0xe35a0d6de94b656694589964a252957e4673a9fb1d2f8b4a92e3f0a7bb000000fddb",
    txIndexInBlock: 281,
    bitcoinHeaders:
      "0x0000002073bd2184edd9c4fc76642ea6754ee40136970efc10c4190000000000",
    coinbasePreimage:
      "0x77b98a5e6643973bba49dda18a75140306d2d8694b66f2dcb3561ad5aff00000",
    coinbaseProof:
      "0xdc20dadef477faab2852f2f8ae0c826aa7e05c4de0d36f0e636304295540000003",
  }

  return { challenge, txInfo, proof }
}

/**
 * Wait for a specific number of blocks to pass
 */
export async function waitBlocks(blockCount: number) {
  const blocks = Array.from({ length: blockCount }, (_, i) => i)
  await blocks.reduce(async (prev) => {
    await prev
    await ethers.provider.send("evm_mine", [])
  }, Promise.resolve())
}

/**
 * Setup mocks for successful minting scenario
 * @dev This helper configures TBTC token mocks for minting operations.
 *      Note: Minting scenarios don't involve burning tokens, only minting.
 * @param fixture The test fixture containing mock contracts
 * @param qcAddress The QC address for the minting operation
 * @param amount The amount to be minted (defaults to NORMAL_MINT)
 */
export function setupSuccessfulMintingMocks(
  fixture: AccountControlFixture,
  qcAddress: string,
  amount: typeof ethers.BigNumber = TEST_DATA.AMOUNTS.NORMAL_MINT
) {
  const { tbtc } = fixture

  // Setup TBTC token mocks for minting operations
  tbtc.balanceOf.returns(amount)
  tbtc.mint.returns()

  // Explicitly verify no burning operations are configured
  // This helps catch test setup errors where burn mocks are incorrectly added
  if (tbtc.burn && tbtc.burn.reset) {
    tbtc.burn.reset()
  }
  if (tbtc.burnFrom && tbtc.burnFrom.reset) {
    tbtc.burnFrom.reset()
  }
}

/**
 * Setup mocks for successful redemption scenario
 * @dev This helper configures TBTC token mocks for redemption operations.
 *      Redemptions use burnFrom (not burn) to allow the contract to burn on behalf of users.
 * @param fixture The test fixture containing mock contracts
 * @param userAddress The user address requesting redemption
 * @param amount The amount to be redeemed (defaults to NORMAL_MINT)
 */
export function setupSuccessfulRedemptionMocks(
  fixture: AccountControlFixture,
  userAddress: string,
  amount: typeof ethers.BigNumber = TEST_DATA.AMOUNTS.NORMAL_MINT
) {
  const { tbtc } = fixture

  // Setup TBTC token mocks for redemption operations
  tbtc.balanceOf.whenCalledWith(userAddress).returns(amount)
  tbtc.burnFrom.whenCalledWith(userAddress, amount).returns()

  // Ensure regular burn is not configured to catch test setup errors
  if (tbtc.burn && tbtc.burn.reset) {
    tbtc.burn.reset()
  }
}

/**
 * Assert that an address has the expected role
 */
export async function assertHasRole(
  contract: any,
  role: string,
  account: string,
  expected = true
) {
  const hasRole = await contract.hasRole(role, account)
  if (hasRole !== expected) {
    throw new Error(
      `Expected account ${account} to ${
        expected ? "have" : "not have"
      } role ${role}`
    )
  }
}

/**
 * Assert QC status
 */
export async function assertQCStatus(
  qcData: QCData,
  qcAddress: string,
  expectedStatus: QCStatus
) {
  const status = await qcData.getQCStatus(qcAddress)
  if (status !== expectedStatus) {
    throw new Error(
      `Expected QC ${qcAddress} to have status ${expectedStatus}, but got ${status}`
    )
  }
}

/**
 * Assert wallet status
 */
export async function assertWalletStatus(
  qcData: QCData,
  walletAddress: string,
  expectedStatus: WalletStatus
) {
  const status = await qcData.getWalletStatus(walletAddress)
  if (status !== expectedStatus) {
    throw new Error(
      `Expected wallet ${walletAddress} to have status ${expectedStatus}, but got ${status}`
    )
  }
}

/**
 * Test constants for common scenarios
 */
export const COMMON_TEST_SCENARIOS = {
  INVALID_ADDRESSES: [
    ethers.constants.AddressZero,
    "0x0000000000000000000000000000000000000001", // Invalid but not zero
  ],
  INVALID_AMOUNTS: [0, -1],
  VALID_BTC_ADDRESSES: [
    TEST_DATA.BTC_ADDRESSES.LEGACY,
    TEST_DATA.BTC_ADDRESSES.SEGWIT,
    "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", // Another valid bech32
  ],
  INVALID_BTC_ADDRESSES: ["", "invalid", "bc1q", "1"],
}

/**
 * Error message patterns for common validations
 */
export const ERROR_MESSAGES = {
  INVALID_QC_ADDRESS: "Invalid QC address",
  INVALID_USER_ADDRESS: "Invalid user address",
  INVALID_WALLET_ADDRESS: "Invalid wallet address",
  INVALID_BITCOIN_ADDRESS: "Invalid Bitcoin address",
  AMOUNT_ZERO: "Amount must be greater than zero",
  QC_NOT_REGISTERED: "QC not registered",
  QC_NOT_ACTIVE: "QC not active",
  WALLET_NOT_REGISTERED: "Wallet not registered",
  WALLET_NOT_ACTIVE: "Wallet not active",
  INSUFFICIENT_BALANCE: "Insufficient balance",
  INSUFFICIENT_CAPACITY: "Insufficient minting capacity",
  MINTING_PAUSED: "Minting is paused",
  REDEMPTION_PAUSED: "Redemption is paused",
  REGISTRY_PAUSED: "Registry is paused",
  SPV_PROOF_REQUIRED: "SPV proof required",
  SERVICE_NOT_AVAILABLE: (serviceName: string) =>
    `${serviceName} not available`,
}

/**
 * Utility to create a test QC profile
 */
export interface TestQCProfile {
  address: string
  wallets: string[]
  reserveBalance: typeof ethers.BigNumber
  mintedAmount: typeof ethers.BigNumber
  status: QCStatus
}

export function createTestQCProfile(
  overrides: Partial<TestQCProfile> = {}
): TestQCProfile {
  return {
    address: ethers.Wallet.createRandom().address,
    wallets: [TEST_DATA.BTC_ADDRESSES.TEST],
    reserveBalance: TEST_DATA.AMOUNTS.RESERVE_BALANCE,
    mintedAmount: ethers.utils.parseEther("5"),
    status: QCStatus.Active,
    ...overrides,
  }
}

/**
 * Utility to validate test fixture setup
 * @dev This function performs basic validation on the test fixture to catch common setup errors
 * @param fixture The test fixture to validate
 * @throws Error if the fixture is not properly configured
 */
export function validateTestFixture(fixture: AccountControlFixture): void {
  const requiredContracts = [
    "protocolRegistry",
    "qcData",
    "qcManager",
    "systemState",
    "qcMinter",
    "qcRedeemer",
    "qcReserveLedger",
    "basicMintingPolicy",
    "basicRedemptionPolicy",
    "singleWatchdog",
    "tbtc",
  ]

  // eslint-disable-next-line no-restricted-syntax
  for (const contractName of requiredContracts) {
    if (!fixture[contractName as keyof AccountControlFixture]) {
      throw new Error(`Test fixture missing required contract: ${contractName}`)
    }
  }

  const requiredSigners = [
    "deployer",
    "governance",
    "qcAddress",
    "user",
    "watchdog",
  ]
  // eslint-disable-next-line no-restricted-syntax
  for (const signerName of requiredSigners) {
    if (!fixture[signerName as keyof AccountControlFixture]) {
      throw new Error(`Test fixture missing required signer: ${signerName}`)
    }
  }
}

/**
 * Create a comprehensive test scenario for edge case testing
 * @dev This utility generates test data for boundary condition testing
 * @param scenario The type of edge case scenario to create
 * @returns Test data appropriate for the scenario
 */
export function createEdgeCaseScenario(
  scenario: "min" | "max" | "zero" | "overflow"
) {
  switch (scenario) {
    case "min":
      return {
        amount: ethers.utils.parseEther("0.01"), // Minimum mint amount
        description: "minimum valid amount",
      }
    case "max":
      return {
        amount: ethers.constants.MaxUint256.div(2), // Safe maximum to avoid overflow
        description: "maximum safe amount",
      }
    case "zero":
      return {
        amount: ethers.constants.Zero,
        description: "zero amount (should fail)",
      }
    case "overflow":
      return {
        amount: ethers.constants.MaxUint256,
        description: "overflow amount (should fail)",
      }
    default:
      throw new Error(`Unknown edge case scenario: ${scenario}`)
  }
}
