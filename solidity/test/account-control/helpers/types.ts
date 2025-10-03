import type { BigNumber, ContractTransaction, ContractReceipt } from "ethers"
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import type {
  AccountControl,
  QCManager,
  QCMinter,
  QCRedeemer,
  ReserveOracle,
  SystemState,
  TBTC,
  QCData,
  QCWalletManager,
  QCPauseManager,
  MockBank,
  MockTBTCVault,
  TestRelay,
} from "../../../typechain"

/**
 * System state interface for tracking contract states
 */
export interface SystemStateData {
  qcStatus: number
  maxCapacity: BigNumber
  totalMinted: BigNumber
  currentBacking: BigNumber
  registeredAt: BigNumber
  authorized: boolean
  mintingCap: BigNumber
  mintingPaused: boolean
  redeemingPaused: boolean
  lastKnownReserveBalance: BigNumber
  lastKnownBalanceTimestamp: BigNumber
  oracleFailureDetected: boolean
  isPaused: boolean
  selfPauseTimestamp: BigNumber
  escalated?: boolean
}

/**
 * Test contracts interface for integration testing
 */
export interface TestContracts {
  accountControl: AccountControl
  qcManager: QCManager
  qcWalletManager: QCWalletManager
  qcMinter: QCMinter
  qcRedeemer: QCRedeemer
  reserveOracle: ReserveOracle
  systemState: SystemState
  tbtcToken: TBTC
  qcData: QCData
  qcPauseManager: QCPauseManager
  mockBank: MockBank
  mockTbtcVault: MockTBTCVault
  testRelay: TestRelay
}

/**
 * Standard test signers configuration
 */
export interface BridgeAccountControlTestSigners {
  owner: SignerWithAddress
  emergencyCouncil: SignerWithAddress
  user: SignerWithAddress
  watchdog: SignerWithAddress
  arbiter: SignerWithAddress
  attester1: SignerWithAddress
  attester2: SignerWithAddress
  attester3: SignerWithAddress
  qcAddress: SignerWithAddress
}

/**
 * Gas measurement result
 */
export interface GasUsageResult {
  gasUsed: number
  txHash: string
  functionName: string
  timestamp: number
}

/**
 * Gas comparison result
 */
export interface GasComparisonResult {
  baseline: GasUsageResult
  current: GasUsageResult
  difference: number
  percentageChange: number
  improved: boolean
}

/**
 * Validation result for system state checks
 */
export interface ValidationResult {
  success: boolean
  issues: ValidationIssue[]
  metrics: ValidationMetrics
}

export interface ValidationIssue {
  severity: "ERROR" | "WARNING" | "INFO"
  contract: string
  issue: string
  details: string
}

export interface ValidationMetrics {
  checksPerformed: number
  timeElapsed: number
  gasUsed: BigNumber
}

/**
 * Bitcoin address test case structure
 */
export interface ValidBitcoinAddressTestCase {
  address: string
  type: "P2PKH" | "P2SH" | "P2WPKH" | "P2WSH" | "INVALID"
  network?: "mainnet" | "testnet"
  expected: boolean
  description?: string
}

/**
 * Redemption test case structure
 */
export interface RedemptionTestCase {
  amount: number | BigNumber
  userBtcAddress?: string
  walletAddress?: string
  user?: SignerWithAddress
  description?: string
}

/**
 * Redemption scenario for complex testing
 */
export interface RedemptionScenario {
  name: string
  setup: () => Promise<void>
  execute: () => Promise<string> // Returns redemption ID
  verify: (redemptionId: string) => Promise<void>
  cleanup?: () => Promise<void>
}

/**
 * Library deployment links
 */
export interface LibraryLinks {
  [libraryName: string]: string
}

/**
 * Bitcoin key pair for testing
 */
export interface BitcoinKeyPair {
  privateKey: Buffer
  publicKey: Buffer
  compressedPublicKey: Buffer
  address: string
}

/**
 * Wallet registration data
 */
export interface WalletRegistrationData {
  btcAddress: string
  publicKey: Uint8Array
  signature: {
    v: number
    r: string
    s: string
  }
  challenge: string
}

/**
 * Attestation setup for ReserveOracle testing
 */
export interface AttesterSetup {
  deployer: SignerWithAddress
  attesters: SignerWithAddress[]
  arbiter: SignerWithAddress
  qcAddress: SignerWithAddress
}

/**
 * Consensus test setup
 */
export interface ConsensusTestSetup {
  reserveOracle: ReserveOracle
  systemState: SystemState
  attesters: SignerWithAddress[]
  qcAddress: string
  balance: BigNumber
}

/**
 * Failure scenario for testing
 */
export interface FailureScenario {
  name: string
  description: string
  setup: () => Promise<void>
  trigger: () => Promise<void>
  validate: () => Promise<ValidationResult>
  cleanup: () => Promise<void>
}

/**
 * Recovery plan structure
 */
export interface RecoveryPlan {
  phases: RecoveryPhase[]
  rollbackEnabled: boolean
  timeoutPeriod: number
}

export interface RecoveryPhase {
  name: string
  description: string
  actions: (() => Promise<void>)[]
  validations: (() => Promise<boolean>)[]
  timeout: number
}

/**
 * Workflow step for complex operations
 */
export interface WorkflowStep {
  id: number
  name: string
  description: string
  dependencies: number[]
  execute: () => Promise<void>
  validate: () => Promise<boolean>
  rollback: () => Promise<void>
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  gasUsed: BigNumber
  executionTime: number
  blockHeight: number
  timestamp: number
}