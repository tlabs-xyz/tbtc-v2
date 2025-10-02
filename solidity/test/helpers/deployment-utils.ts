import { expect } from "chai"
import { ethers, upgrades } from "hardhat"
import { BigNumber, Contract } from "ethers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { AccountControl } from "../../typechain"

/**
 * Deployment lock manager to prevent concurrent proxy deployments
 * OpenZeppelin upgrades plugin uses lock files - we need to serialize access
 */
class DeploymentManager {
  private static deploying = false
  private static queue: Array<() => Promise<any>> = []

  static async safeDeployProxy<T>(
    deployFunction: () => Promise<T>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await deployFunction()
          resolve(result)
        } catch (error) {
          reject(error)
        }
      })
      this.processQueue()
    })
  }

  private static async processQueue() {
    if (this.deploying || this.queue.length === 0) {
      return
    }

    this.deploying = true
    const nextDeployment = this.queue.shift()

    try {
      await nextDeployment()
    } finally {
      this.deploying = false
      // Process next deployment if any
      setTimeout(() => this.processQueue(), 50) // Small delay to ensure lock file cleanup
    }
  }

  static async cleanup() {
    // Wait for any pending deployments to complete
    while (this.deploying || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

/**
 * Contract constants interface for type safety
 */
interface ContractConstants {
  MIN_MINT_AMOUNT: BigNumber
  MAX_SINGLE_MINT: BigNumber
}

/**
 * Test amounts interface for common values
 */
interface TestAmounts extends ContractConstants {
  SMALL_CAP: BigNumber
  MEDIUM_CAP: BigNumber
  SMALL_MINT: BigNumber
  MEDIUM_MINT: BigNumber
  TINY_MINT: BigNumber
}

/**
 * Get contract constants dynamically to prevent hardcoded value bugs
 * @param accountControl The deployed AccountControl contract
 * @returns Object containing all contract constants
 */
export const getContractConstants = async (
  accountControl: AccountControl
): Promise<ContractConstants> => ({
  MIN_MINT_AMOUNT: await accountControl.MIN_MINT_AMOUNT(),
  MAX_SINGLE_MINT: await accountControl.MAX_SINGLE_MINT(),
})

/**
 * Test balance changes from operations
 * Prevents state contamination by checking relative changes
 * @param token The token contract with balanceAvailable method
 * @param user The user address to check balance for
 * @param expectedChange The expected change in balance
 * @param operation The async operation to execute
 */
export const expectBalanceChange = async (
  token: Contract,
  user: string,
  expectedChange: BigNumber,
  operation: () => Promise<any>
): Promise<void> => {
  const balanceBefore = await token.balanceAvailable(user)
  await operation()
  const balanceAfter = await token.balanceAvailable(user)
  expect(balanceAfter).to.equal(balanceBefore.add(expectedChange))
}

/**
 * Get common test amounts based on contract constants
 * Prevents hardcoded 1000000, 500000, 2000000 across tests
 * @param accountControl The deployed AccountControl contract
 * @returns Object containing common test amounts
 */
export const getTestAmounts = async (
  accountControl: AccountControl
): Promise<TestAmounts> => {
  const constants = await getContractConstants(accountControl)
  return {
    // Common caps used across tests
    SMALL_CAP: constants.MIN_MINT_AMOUNT.mul(100), // 1M satoshis = 0.01 BTC
    MEDIUM_CAP: constants.MIN_MINT_AMOUNT.mul(200), // 2M satoshis = 0.02 BTC
    // Common mint amounts used across tests
    SMALL_MINT: constants.MIN_MINT_AMOUNT.mul(50), // 500K satoshis = 0.005 BTC
    MEDIUM_MINT: constants.MIN_MINT_AMOUNT.mul(10), // 100K satoshis = 0.001 BTC
    TINY_MINT: constants.MIN_MINT_AMOUNT, // 10K satoshis = MIN_MINT
    // Include all constants
    ...constants,
  }
}

/**
 * Deploy AccountControl for testing with standard setup
 * Eliminates duplicate deployment code across 8+ files
 * @param owner The owner signer
 * @param emergencyCouncil The emergency council signer
 * @param mockBank The mock bank contract
 * @returns Deployed and initialized AccountControl contract
 */
export const deployAccountControlForTest = async (
  owner: SignerWithAddress,
  emergencyCouncil: SignerWithAddress,
  mockBank: Contract
): Promise<AccountControl> => {
  const AccountControlFactory = await ethers.getContractFactory(
    "AccountControl"
  )

  const accountControl = await AccountControlFactory.deploy(
    owner.address,
    emergencyCouncil.address,
    mockBank.address
  )

  await accountControl.deployed()

  // Authorize AccountControl to call MockBank functions
  await mockBank.authorizeBalanceIncreaser(accountControl.address)

  return accountControl
}

/**
 * Safe wrapper for direct upgrades.deployProxy calls
 * Use this in test files instead of calling upgrades.deployProxy directly
 */
export const safeDeployProxy = async <T>(
  factory: any,
  initArgs: any[],
  options: any = {}
): Promise<T> =>
  DeploymentManager.safeDeployProxy(
    async () => (await upgrades.deployProxy(factory, initArgs, options)) as T
  )

/**
 * Call this in afterEach hooks to ensure clean deployment state
 */
export const cleanupDeployments = async (): Promise<void> => {
  await DeploymentManager.cleanup()
}

/**
 * Helper to get library linking configuration for contracts using BitcoinAddressUtils
 */
export function getBitcoinAddressUtilsLibraries(libraries: {
  bitcoinAddressUtils: any
}) {
  return {
    libraries: {
      BitcoinAddressUtils: libraries.bitcoinAddressUtils.address,
    },
  }
}
