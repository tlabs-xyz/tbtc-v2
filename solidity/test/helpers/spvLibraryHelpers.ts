import { ethers } from "hardhat"
import { LibraryLinkingHelper } from "./libraryLinkingHelper"

/**
 * Helper function to deploy SPV libraries in correct dependency order
 * Returns deployed library instances for linking
 */
export async function deploySPVLibraries() {
  const libraries = await LibraryLinkingHelper.deployAllLibraries()
  
  // Get deployed library contracts for backward compatibility
  const sharedSPVCore = await ethers.getContractAt("SharedSPVCore", libraries.SharedSPVCore)
  const qcRedeemerSPV = await ethers.getContractAt("QCRedeemerSPV", libraries.QCRedeemerSPV)
  const bitcoinAddressUtils = await ethers.getContractAt("BitcoinAddressUtils", libraries.BitcoinAddressUtils)

  return {
    sharedSPVCore,
    qcRedeemerSPV,
    bitcoinAddressUtils,
  }
}

/**
 * Helper function to deploy QCManager libraries
 */
export async function deployQCManagerLib() {
  // Deploy QCManagerLib (no linking needed - it's a library)
  const QCManagerLibFactory = await ethers.getContractFactory("QCManagerLib")
  const qcManagerLib = await QCManagerLibFactory.deploy()
  await qcManagerLib.deployed()

  // Deploy QCManagerPauseLib (no linking needed - it's a library)
  const QCManagerPauseLibFactory = await ethers.getContractFactory("QCManagerPauseLib")
  const qcManagerPauseLib = await QCManagerPauseLibFactory.deploy()
  await qcManagerPauseLib.deployed()

  return { qcManagerLib, qcManagerPauseLib }
}

/**
 * Helper function to get library linking configuration for QCRedeemer
 * @deprecated Use LibraryLinkingHelper.getQCRedeemerFactory() instead
 */
export async function getQCRedeemerLinkingConfig() {
  const libraries = await LibraryLinkingHelper.deployAllLibraries()
  return {
    QCRedeemerSPV: libraries.QCRedeemerSPV,
    SharedSPVCore: libraries.SharedSPVCore,
  }
}

/**
 * Enhanced helper to get QCRedeemer factory with proper library linking
 */
export async function getQCRedeemerFactory() {
  return LibraryLinkingHelper.getQCRedeemerFactory()
}
export function getQCRedeemerLibraries(libraries: {
  qcRedeemerSPV: any
  sharedSPVCore: any
}) {
  return {
    libraries: {
      QCRedeemerSPV: libraries.qcRedeemerSPV.address,
      SharedSPVCore: libraries.sharedSPVCore.address,
    },
  }
}

/**
 * Helper function to get library linking configuration for QCManager
 */
export function getQCManagerLibraries(libraries: {
  qcManagerLib: any
  qcManagerPauseLib?: any
}) {
  return {
    libraries: {
      QCManagerLib: libraries.qcManagerLib.address,
      ...(libraries.qcManagerPauseLib && {
        QCManagerPauseLib: libraries.qcManagerPauseLib.address,
      }),
    },
  }
}