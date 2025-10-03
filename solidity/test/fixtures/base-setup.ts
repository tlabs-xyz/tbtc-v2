import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ethers, helpers } from "hardhat"
import type {
  TBTC,
  Bridge,
  Bank,
  TBTCVault,
  IRelay,
  IRandomBeacon,
  WalletRegistry,
  BridgeGovernance,
} from "../../typechain"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

/**
 * Base test signers interface that can be extended for domain-specific needs
 */
export interface BaseTestSigners {
  deployer: SignerWithAddress
  governance: SignerWithAddress
  [key: string]: SignerWithAddress
}

/**
 * Extended test signers for Bridge-specific tests
 */
export interface BridgeTestSigners extends BaseTestSigners {
  spvMaintainer: SignerWithAddress
  treasury?: SignerWithAddress
  redemptionWatchtowerManager?: SignerWithAddress
  user1?: SignerWithAddress
  user2?: SignerWithAddress
  user3?: SignerWithAddress
}

/**
 * Extended test signers for Account Control tests
 */
export interface AccountControlTestSigners extends BaseTestSigners {
  watchdog: SignerWithAddress
  user: SignerWithAddress
  liquidator: SignerWithAddress
  qcAddress: SignerWithAddress
  thirdParty: SignerWithAddress
  arbiter?: SignerWithAddress
  registrar?: SignerWithAddress
}

/**
 * Base test environment interface
 */
export interface BaseTestEnvironment {
  signers: BaseTestSigners
  blockNumber: number
  timestamp: number
  snapshot?: string
}

/**
 * Extended test environment for Bridge tests
 */
export interface BridgeTestEnvironment extends BaseTestEnvironment {
  signers: BridgeTestSigners
  tbtc: TBTC
  bridge: Bridge
  bridgeGovernance: BridgeGovernance
  bank: Bank
  tbtcVault: TBTCVault
  walletRegistry: WalletRegistry
  randomBeacon: any
  relay: any
}

/**
 * Enhanced test environment with cleanup capabilities
 */
export interface EnhancedTestEnvironment extends BaseTestEnvironment {
  contractStates: Map<string, any>
  cleanupActions: Array<() => Promise<void>>
  addCleanupAction: (action: () => Promise<void>) => void
  cleanup: () => Promise<void>
}

/**
 * Sets up standard test signers based on the requested configuration
 */
export async function setupTestSigners<T extends BaseTestSigners = BaseTestSigners>(
  config: {
    type?: "base" | "bridge" | "account-control"
    customSigners?: string[]
  } = {}
): Promise<T> {
  const allSigners = await ethers.getSigners()
  const [deployer, governance, ...others] = allSigners

  let signers: any = {
    deployer,
    governance,
  }

  switch (config.type) {
    case "bridge":
      signers.spvMaintainer = others[0]
      signers.treasury = others[1]
      signers.redemptionWatchtowerManager = others[2]
      signers.user1 = others[3]
      signers.user2 = others[4]
      signers.user3 = others[5]
      break

    case "account-control":
      signers.watchdog = others[0]
      signers.user = others[1]
      signers.liquidator = others[2]
      signers.qcAddress = others[3]
      signers.thirdParty = others[4]
      signers.arbiter = others[5]
      signers.registrar = others[6]
      break

    default:
      // Add any custom signers requested
      config.customSigners?.forEach((name, index) => {
        if (others[index]) {
          signers[name] = others[index]
        }
      })
  }

  return signers as T
}

/**
 * Creates a base test environment with common setup
 */
export async function createBaseTestEnvironment(
  config: {
    type?: "base" | "bridge" | "account-control"
    customSigners?: string[]
  } = {}
): Promise<BaseTestEnvironment> {
  const signers = await setupTestSigners(config)
  const latestBlock = await ethers.provider.getBlock("latest")
  const snapshot = await createSnapshot()

  return {
    signers,
    blockNumber: latestBlock.number,
    timestamp: latestBlock.timestamp,
    snapshot,
  }
}

/**
 * Creates an enhanced test environment with cleanup capabilities
 */
export async function createEnhancedTestEnvironment(
  config: {
    type?: "base" | "bridge" | "account-control"
    customSigners?: string[]
  } = {}
): Promise<EnhancedTestEnvironment> {
  const baseEnv = await createBaseTestEnvironment(config)
  const contractStates = new Map<string, any>()
  const cleanupActions: Array<() => Promise<void>> = []

  const addCleanupAction = (action: () => Promise<void>) => {
    cleanupActions.push(action)
  }

  const cleanup = async () => {
    // Execute explicit cleanup actions first
    for (const action of cleanupActions.reverse()) {
      try {
        await action()
      } catch (error: any) {
        console.warn("Cleanup action failed:", error.message)
      }
    }

    // Clear tracked states
    contractStates.clear()
    cleanupActions.length = 0

    // Restore snapshot if available
    if (baseEnv.snapshot) {
      await restoreSnapshot(baseEnv.snapshot)
    }
  }

  return {
    ...baseEnv,
    contractStates,
    cleanupActions,
    addCleanupAction,
    cleanup,
  }
}

/**
 * Restores test environment from snapshot
 */
export async function restoreTestEnvironment(snapshot?: string): Promise<void> {
  if (snapshot) {
    await restoreSnapshot(snapshot)
  } else {
    await restoreSnapshot()
  }
}

/**
 * Common relay setup patterns
 */
export async function setupRelayForTesting(
  relay: any,
  difficulty: number = 1000000
): Promise<void> {
  // Configure relay with appropriate difficulty
  if ("setCurrentEpochDifficulty" in relay) {
    await relay.setCurrentEpochDifficulty(difficulty)
    await relay.setPrevEpochDifficulty(difficulty)
  }

  if ("setReady" in relay) {
    await relay.setReady(true)
  }
}

/**
 * State validation utilities for test isolation verification
 */
export interface ContractStateSnapshot {
  address: string
  owner?: string
  balances?: Record<string, any>
  authorizations?: string[]
  customChecks?: Record<string, any>
}

/**
 * Captures current state of a contract for later validation
 */
export async function captureContractState(
  contract: any,
  customChecks: Record<string, () => Promise<any>> = {}
): Promise<ContractStateSnapshot> {
  const state: ContractStateSnapshot = { address: contract.address }

  try {
    // Common state checks
    if ("owner" in contract) {
      state.owner = await contract.owner()
    }

    // Custom state checks
    if (Object.keys(customChecks).length > 0) {
      state.customChecks = {}
      for (const [key, check] of Object.entries(customChecks)) {
        try {
          state.customChecks[key] = await check()
        } catch (error: any) {
          console.warn(`Custom check ${key} failed:`, error.message)
        }
      }
    }
  } catch (error: any) {
    console.warn(`State capture failed for ${contract.address}:`, error.message)
  }

  return state
}

/**
 * Validates that contract state matches expected snapshot
 */
export async function validateContractState(
  contract: any,
  expectedState: ContractStateSnapshot,
  customChecks: Record<string, () => Promise<any>> = {}
): Promise<boolean> {
  try {
    // Validate owner if captured
    if (expectedState.owner && "owner" in contract) {
      const currentOwner = await contract.owner()
      if (currentOwner !== expectedState.owner) {
        console.warn(
          `Owner mismatch: expected ${expectedState.owner}, got ${currentOwner}`
        )
        return false
      }
    }

    // Validate custom checks if captured
    if (expectedState.customChecks) {
      for (const [key, expectedValue] of Object.entries(
        expectedState.customChecks
      )) {
        if (customChecks[key]) {
          const currentValue = await customChecks[key]()
          if (JSON.stringify(currentValue) !== JSON.stringify(expectedValue)) {
            console.warn(`Custom check ${key} mismatch:`, {
              expected: expectedValue,
              current: currentValue,
            })
            return false
          }
        }
      }
    }

    return true
  } catch (error: any) {
    console.warn("State validation failed:", error.message)
    return false
  }
}

/**
 * Test isolation verification suite
 */
export class TestIsolationVerifier {
  private preTestStates: Map<string, ContractStateSnapshot> = new Map()
  private postTestStates: Map<string, ContractStateSnapshot> = new Map()

  async capturePreTestState(
    contractName: string,
    contract: any,
    customChecks: Record<string, () => Promise<any>> = {}
  ): Promise<void> {
    const state = await captureContractState(contract, customChecks)
    this.preTestStates.set(contractName, state)
  }

  async capturePostTestState(
    contractName: string,
    contract: any,
    customChecks: Record<string, () => Promise<any>> = {}
  ): Promise<void> {
    const state = await captureContractState(contract, customChecks)
    this.postTestStates.set(contractName, state)
  }

  async verifyIsolation(): Promise<boolean> {
    let allIsolated = true

    for (const [contractName, preState] of this.preTestStates.entries()) {
      const postState = this.postTestStates.get(contractName)
      if (!postState) {
        console.warn(`No post-test state captured for ${contractName}`)
        continue
      }

      // Simple state comparison (can be enhanced)
      const preStateStr = JSON.stringify(preState)
      const postStateStr = JSON.stringify(postState)

      if (preStateStr !== postStateStr) {
        console.warn(`Test isolation violation detected in ${contractName}:`, {
          pre: preState,
          post: postState,
        })
        allIsolated = false
      }
    }

    return allIsolated
  }

  reset(): void {
    this.preTestStates.clear()
    this.postTestStates.clear()
  }
}

/**
 * Standard error handling for test setup
 */
export function handleTestSetupError(error: unknown, context: string): never {
  const message = error instanceof Error ? error.message : String(error)
  throw new Error(`Test setup failed in ${context}: ${message}`)
}
