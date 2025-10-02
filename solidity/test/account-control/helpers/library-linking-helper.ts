import { ethers } from "hardhat"
import { Contract, ContractFactory } from "ethers"

interface LibraryLinks {
  [libraryName: string]: string
}

/**
 * Enhanced library deployment and linking helper with global caching
 * Ensures proper deployment order and linking for Manager libraries
 *
 * PERFORMANCE OPTIMIZATION:
 * - Libraries are cached globally across tests for speed
 * - Only deploys once per test run, not per test
 * - Can be reset manually for isolation if needed
 */
export class LibraryLinkingHelper {
  private static deployedLibraries: Map<string, string> = new Map()
  private static globalLibraryCache: LibraryLinks | null = null
  private static isDeploying: boolean = false

  /**
   * Deploy all required libraries in correct dependency order
   * Uses global caching for performance - libraries persist across tests
   * Returns library addresses for contract linking
   */
  static async deployAllLibraries(
    useCache: boolean = true
  ): Promise<LibraryLinks> {
    // ✅ PERFORMANCE: Return cached libraries if available
    if (useCache && this.globalLibraryCache) {
      return this.globalLibraryCache
    }

    // ✅ PERFORMANCE: Prevent duplicate deployments during parallel execution
    if (this.isDeploying) {
      while (this.isDeploying) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      if (this.globalLibraryCache) {
        return this.globalLibraryCache
      }
    }

    this.isDeploying = true

    try {
      // Clear session cache for fresh deployment
      this.deployedLibraries.clear()

      // 1. Deploy BitcoinAddressUtils (no dependencies)
      const bitcoinAddressUtils = await this.deployLibrary(
        "BitcoinAddressUtils"
      )

      // 2. Deploy QCManagerLib (no dependencies)
      const qcManagerLib = await this.deployLibrary("QCManagerLib")

      const libraries = {
        BitcoinAddressUtils: bitcoinAddressUtils,
        QCManagerLib: qcManagerLib,
      }

      // ✅ PERFORMANCE: Cache libraries globally for reuse
      this.globalLibraryCache = libraries

      return libraries
    } finally {
      this.isDeploying = false
    }
  }

  /**
   * Deploy a single library with optional dependencies
   */
  private static async deployLibrary(
    libraryName: string,
    libraries: LibraryLinks = {}
  ): Promise<string> {
    // Check if already deployed
    if (this.deployedLibraries.has(libraryName)) {
      return this.deployedLibraries.get(libraryName)
    }

    try {
      const LibraryFactory = await ethers.getContractFactory(libraryName, {
        libraries,
      })

      const library = await LibraryFactory.deploy()
      await library.deployed()

      this.deployedLibraries.set(libraryName, library.address)

      return library.address
    } catch (error) {
      console.error(`❌ Failed to deploy ${libraryName}:`, error)
      throw error
    }
  }

  /**
   * Get cached libraries or deploy if not available
   * ✅ PERFORMANCE: Uses global cache for speed
   */
  static async getCachedLibraries(): Promise<LibraryLinks> {
    return this.deployAllLibraries(true) // Use cache by default
  }

  /**
   * Force fresh deployment of libraries (bypasses cache)
   * Use when you need completely fresh libraries for testing
   */
  static async deployFreshLibraries(): Promise<LibraryLinks> {
    return this.deployAllLibraries(false) // Force fresh deployment
  }

  /**
   * Get contract factory with proper library linking for QCRedeemer
   * ✅ PERFORMANCE: Uses cached libraries by default
   */
  static async getQCRedeemerFactory(
    libraries?: LibraryLinks
  ): Promise<ContractFactory> {
    const libs = libraries || (await this.getCachedLibraries())

    return ethers.getContractFactory("QCRedeemer")
  }

  /**
   * Get contract factory with proper library linking for QCManager
   * ✅ PERFORMANCE: Uses cached libraries by default
   */
  static async getQCManagerFactory(
    libraries?: LibraryLinks
  ): Promise<ContractFactory> {
    const libs = libraries || (await this.getCachedLibraries())

    return ethers.getContractFactory("QCManager", {
      libraries: {
        QCManagerLib: libs.QCManagerLib,
      },
    })
  }

  /**
   * Deploy QCRedeemer with all required libraries
   * ✅ PERFORMANCE: Uses cached libraries by default
   */
  static async deployQCRedeemer(
    tbtcAddress: string,
    qcDataAddress: string,
    systemStateAddress: string,
    accountControlAddress: string,
    libraries?: LibraryLinks
  ): Promise<Contract> {
    const factory = await this.getQCRedeemerFactory(libraries)

    const qcRedeemer = await factory.deploy(
      tbtcAddress,
      qcDataAddress,
      systemStateAddress,
      accountControlAddress
    )

    await qcRedeemer.deployed()

    return qcRedeemer
  }

  /**
   * Deploy QCWalletManager contract with library linking
   * ✅ PERFORMANCE: Uses cached libraries by default
   */
  static async deployQCWalletManager(
    qcDataAddress: string,
    systemStateAddress: string,
    reserveOracleAddress: string,
    libraries?: LibraryLinks
  ): Promise<Contract> {
    const libs = libraries || (await this.getCachedLibraries())

    const QCWalletManagerFactory = await ethers.getContractFactory(
      "QCWalletManager",
      {
        libraries: {
          QCManagerLib: libs.QCManagerLib,
        },
      }
    )

    const walletManager = await QCWalletManagerFactory.deploy(
      qcDataAddress,
      systemStateAddress,
      reserveOracleAddress
    )

    await walletManager.deployed()

    return walletManager
  }

  /**
   * Deploy QCManager with all required libraries (now requires walletManager)
   * ✅ PERFORMANCE: Uses cached libraries by default
   */
  static async deployQCManager(
    qcDataAddress: string,
    systemStateAddress: string,
    reserveOracleAddress: string,
    pauseManagerAddress: string,
    walletManagerAddress: string,
    libraries?: LibraryLinks
  ): Promise<Contract> {
    const factory = await this.getQCManagerFactory(libraries)

    const qcManager = await factory.deploy(
      qcDataAddress,
      systemStateAddress,
      reserveOracleAddress,
      pauseManagerAddress,
      walletManagerAddress
    )

    await qcManager.deployed()

    return qcManager
  }

  /**
   * Reset deployed libraries cache (useful for test isolation)
   * ✅ PERFORMANCE: Can reset both session and global caches
   */
  static reset(clearGlobalCache: boolean = false): void {
    this.deployedLibraries.clear()
    if (clearGlobalCache) {
      this.globalLibraryCache = null
    }
  }

  /**
   * Get cache status for debugging
   */
  static getCacheStatus(): {
    hasGlobalCache: boolean
    sessionCacheSize: number
    isDeploying: boolean
  } {
    return {
      hasGlobalCache: this.globalLibraryCache !== null,
      sessionCacheSize: this.deployedLibraries.size,
      isDeploying: this.isDeploying,
    }
  }

  /**
   * Get deployed library addresses
   */
  static getDeployedLibraries(): LibraryLinks {
    return Object.fromEntries(this.deployedLibraries)
  }
}

/**
 * Convenience function for tests - get cached libraries (fast)
 * ✅ PERFORMANCE: Uses global cache for speed
 */
export async function setupLibraryLinking(): Promise<LibraryLinks> {
  return LibraryLinkingHelper.getCachedLibraries()
}

/**
 * Convenience function for tests - get QCRedeemer factory with cached libraries
 * ✅ PERFORMANCE: Uses cached libraries by default
 */
export async function getQCRedeemerWithLibraries(): Promise<ContractFactory> {
  return LibraryLinkingHelper.getQCRedeemerFactory()
}

/**
 * Convenience function for tests - get QCManager factory with cached libraries
 * ✅ PERFORMANCE: Uses cached libraries by default
 */
export async function getQCManagerWithLibraries(): Promise<ContractFactory> {
  return LibraryLinkingHelper.getQCManagerFactory()
}

/**
 * Convenience function for tests - deploy fresh libraries (bypass cache)
 * Use when you need completely fresh libraries for specific test scenarios
 */
export async function setupFreshLibraryLinking(): Promise<LibraryLinks> {
  return LibraryLinkingHelper.deployFreshLibraries()
}
