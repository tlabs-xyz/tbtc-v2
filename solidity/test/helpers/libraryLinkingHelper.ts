import { ethers } from "hardhat"
import { Contract, ContractFactory } from "ethers"

interface LibraryLinks {
  [libraryName: string]: string
}

/**
 * Enhanced library deployment and linking helper
 * Ensures proper deployment order and linking for all SPV and Manager libraries
 */
export class LibraryLinkingHelper {
  private static deployedLibraries: Map<string, string> = new Map()

  /**
   * Deploy all required libraries in correct dependency order
   * Returns library addresses for contract linking
   */
  static async deployAllLibraries(): Promise<LibraryLinks> {
    console.log("📚 Deploying libraries in dependency order...")

    // Clear previous deployments for fresh test runs
    this.deployedLibraries.clear()

    // 1. Deploy BitcoinAddressUtils (no dependencies)
    const bitcoinAddressUtils = await this.deployLibrary("BitcoinAddressUtils")

    // 2. Deploy SharedSPVCore (no dependencies)
    const sharedSPVCore = await this.deployLibrary("SharedSPVCore")

    // 3. Deploy QCRedeemerSPV (depends on SharedSPVCore)
    const qcRedeemerSPV = await this.deployLibrary("QCRedeemerSPV", {
      SharedSPVCore: sharedSPVCore,
    })

    // 4. Deploy QCManagerLib (no dependencies)
    const qcManagerLib = await this.deployLibrary("QCManagerLib")

    const libraries = {
      BitcoinAddressUtils: bitcoinAddressUtils,
      SharedSPVCore: sharedSPVCore,
      QCRedeemerSPV: qcRedeemerSPV,
      QCManagerLib: qcManagerLib,
    }

    console.log("✅ All libraries deployed successfully:")
    console.log(libraries)

    return libraries
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
      return this.deployedLibraries.get(libraryName)!
    }

    try {
      const LibraryFactory = await ethers.getContractFactory(libraryName, {
        libraries,
      })
      const library = await LibraryFactory.deploy()
      await library.deployed()

      this.deployedLibraries.set(libraryName, library.address)
      console.log(`  ✅ ${libraryName}: ${library.address}`)

      return library.address
    } catch (error) {
      console.error(`❌ Failed to deploy ${libraryName}:`, error)
      throw error
    }
  }

  /**
   * Get contract factory with proper library linking for QCRedeemer
   */
  static async getQCRedeemerFactory(libraries?: LibraryLinks): Promise<ContractFactory> {
    const libs = libraries || (await this.deployAllLibraries())
    
    return ethers.getContractFactory("QCRedeemer", {
      libraries: {
        QCRedeemerSPV: libs.QCRedeemerSPV,
        SharedSPVCore: libs.SharedSPVCore,
      },
    })
  }

  /**
   * Get contract factory with proper library linking for QCManager
   */
  static async getQCManagerFactory(libraries?: LibraryLinks): Promise<ContractFactory> {
    const libs = libraries || (await this.deployAllLibraries())
    
    return ethers.getContractFactory("QCManager", {
      libraries: {
        QCManagerLib: libs.QCManagerLib,
      },
    })
  }

  /**
   * Get contract factory with proper library linking for QCRedeemerSPV
   */
  static async getQCRedeemerSPVFactory(libraries?: LibraryLinks): Promise<ContractFactory> {
    const libs = libraries || (await this.deployAllLibraries())
    
    return ethers.getContractFactory("QCRedeemerSPV", {
      libraries: {
        SharedSPVCore: libs.SharedSPVCore,
      },
    })
  }

  /**
   * Deploy QCRedeemer with all required libraries
   */
  static async deployQCRedeemer(
    tbtcAddress: string,
    qcDataAddress: string,
    systemStateAddress: string,
    lightRelayAddress: string,
    txProofDifficultyFactor: number = 1,
    libraries?: LibraryLinks
  ): Promise<Contract> {
    const factory = await this.getQCRedeemerFactory(libraries)
    
    const qcRedeemer = await factory.deploy(
      tbtcAddress,
      qcDataAddress,
      systemStateAddress,
      lightRelayAddress,
      txProofDifficultyFactor
    )
    await qcRedeemer.deployed()

    console.log(`✅ QCRedeemer deployed: ${qcRedeemer.address}`)
    return qcRedeemer
  }

  /**
   * Deploy QCManager with all required libraries
   */
  static async deployQCManager(
    qcDataAddress: string,
    systemStateAddress: string,
    reserveOracleAddress: string,
    libraries?: LibraryLinks
  ): Promise<Contract> {
    const factory = await this.getQCManagerFactory(libraries)
    
    const qcManager = await factory.deploy(
      qcDataAddress,
      systemStateAddress,
      reserveOracleAddress
    )
    await qcManager.deployed()

    console.log(`✅ QCManager deployed: ${qcManager.address}`)
    return qcManager
  }

  /**
   * Reset deployed libraries cache (useful for test isolation)
   */
  static reset(): void {
    this.deployedLibraries.clear()
  }

  /**
   * Get deployed library addresses
   */
  static getDeployedLibraries(): LibraryLinks {
    return Object.fromEntries(this.deployedLibraries)
  }
}

/**
 * Convenience function for tests - deploy all libraries and return linking configuration
 */
export async function setupLibraryLinking(): Promise<LibraryLinks> {
  return LibraryLinkingHelper.deployAllLibraries()
}

/**
 * Convenience function for tests - get QCRedeemer factory with libraries
 */
export async function getQCRedeemerWithLibraries(): Promise<ContractFactory> {
  return LibraryLinkingHelper.getQCRedeemerFactory()
}

/**
 * Convenience function for tests - get QCManager factory with libraries
 */
export async function getQCManagerWithLibraries(): Promise<ContractFactory> {
  return LibraryLinkingHelper.getQCManagerFactory()
}