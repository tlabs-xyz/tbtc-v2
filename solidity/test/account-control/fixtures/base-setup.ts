import { ethers } from "hardhat"
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { spvTestConfig } from "./test-data"

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
}

/**
 * Sets up standard test signers with predictable roles
 */
export async function setupTestSigners(): Promise<TestSigners> {
  const [deployer, governance, watchdog, user, liquidator] = await ethers.getSigners()

  return {
    deployer,
    governance,
    watchdog,
    user,
    liquidator,
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
 * Standard test cleanup patterns
 */
export async function cleanupTestEnvironment(): Promise<void> {
  // Reset any global state if needed
  // This can be expanded as patterns emerge
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