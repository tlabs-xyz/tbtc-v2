import { ethers, helpers } from "hardhat"
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { spvTestConfig } from "./test-data"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

/**
 * Common test environment setup utilities
 * Provides standardized patterns for test initialization
 */

/**
 * Common signer setup for account-control tests
 */
export interface TestSigners {
  deployer: SignerWithAddress
  governance: SignerWithAddress
  watchdog: SignerWithAddress
  user: SignerWithAddress
  liquidator: SignerWithAddress
  qcAddress: SignerWithAddress
  thirdParty: SignerWithAddress
}

/**
 * Sets up standard test signers with predictable roles
 */
export async function setupTestSigners(): Promise<TestSigners> {
  const [
    deployer,
    governance,
    watchdog,
    user,
    liquidator,
    qcAddress,
    thirdParty,
  ] = await ethers.getSigners()

  return {
    deployer,
    governance,
    watchdog,
    user,
    liquidator,
    qcAddress,
    thirdParty,
  }
}

/**
 * Standard test environment configuration
 */
export interface TestEnvironment {
  signers: TestSigners
  blockNumber: number
  timestamp: number
}

/**
 * Initializes a standard test environment
 */
export async function setupTestEnvironment(): Promise<TestEnvironment> {
  const signers = await setupTestSigners()
  const latestBlock = await ethers.provider.getBlock("latest")

  return {
    signers,
    blockNumber: latestBlock.number,
    timestamp: latestBlock.timestamp,
  }
}

/**
 * Common relay setup patterns
 */
export async function setupRelayForTesting(
  relay: any,
  difficulty: number = spvTestConfig.chainDifficulty
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
 * Enhanced test environment with hybrid snapshot/cleanup pattern
 */
export interface EnhancedTestEnvironment extends TestEnvironment {
  contractStates: Map<string, any>
  cleanupActions: Array<() => Promise<void>>
  addCleanupAction: (action: () => Promise<void>) => void
  cleanup: () => Promise<void>
}

/**
 * Creates a standardized test environment with snapshot management
 * This function should be used in beforeEach hooks for consistent setup
 */
export async function createBaseTestEnvironment(): Promise<TestEnvironment> {
  await createSnapshot()
  return setupTestEnvironment()
}

/**
 * Enhanced test environment with hybrid cleanup pattern
 * Combines snapshots for expensive deployment with explicit cleanup for state changes
 */
export async function createEnhancedTestEnvironment(): Promise<EnhancedTestEnvironment> {
  await createSnapshot()
  const baseEnv = await setupTestEnvironment()
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
      } catch (error) {
        console.warn("Cleanup action failed:", error.message)
      }
    }

    // Clear tracked states
    contractStates.clear()
    cleanupActions.length = 0

    // Restore snapshot last
    await restoreSnapshot()
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
 * This function should be used in afterEach hooks for consistent cleanup
 */
export async function restoreBaseTestEnvironment(): Promise<void> {
  await restoreSnapshot()
}

/**
 * Standard test cleanup patterns
 */
export async function cleanupTestEnvironment(): Promise<void> {
  // Reset any global state if needed
  // This can be expanded as patterns emerge
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
  address: string,
  customChecks: Record<string, () => Promise<any>> = {}
): Promise<ContractStateSnapshot> {
  const state: ContractStateSnapshot = { address }

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
        } catch (error) {
          console.warn(`Custom check ${key} failed:`, error.message)
        }
      }
    }
  } catch (error) {
    console.warn(`State capture failed for ${address}:`, error.message)
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
  } catch (error) {
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
    const state = await captureContractState(
      contract,
      contract.address,
      customChecks
    )

    this.preTestStates.set(contractName, state)
  }

  async capturePostTestState(
    contractName: string,
    contract: any,
    customChecks: Record<string, () => Promise<any>> = {}
  ): Promise<void> {
    const state = await captureContractState(
      contract,
      contract.address,
      customChecks
    )

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
 * Common test data validation helpers
 */
export function validateTestData(data: any): boolean {
  if (!data || typeof data !== "object") {
    return false
  }

  // Add common validation logic
  return true
}

/**
 * Standard error handling for test setup
 */
export function handleTestSetupError(error: unknown, context: string): never {
  const message = error instanceof Error ? error.message : String(error)
  throw new Error(`Test setup failed in ${context}: ${message}`)
}
