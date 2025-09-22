import { ethers } from "hardhat"

/**
 * Helper function to deploy SPV libraries in correct dependency order
 * Returns deployed library instances for linking
 */
export async function deploySPVLibraries() {
  // Deploy base library first
  const SharedSPVCoreFactory = await ethers.getContractFactory("SharedSPVCore")
  const sharedSPVCore = await SharedSPVCoreFactory.deploy()
  await sharedSPVCore.deployed()

  // Deploy QCRedeemerSPV library (depends on SharedSPVCore)
  const QCRedeemerSPVFactory = await ethers.getContractFactory("QCRedeemerSPV", {
    libraries: {
      SharedSPVCore: sharedSPVCore.address,
    },
  })
  const qcRedeemerSPV = await QCRedeemerSPVFactory.deploy()
  await qcRedeemerSPV.deployed()

  // Note: QCManagerSPV library doesn't exist in this codebase
  // Only QCRedeemerSPV is available

  // Deploy BitcoinAddressUtils (utility library)
  const BitcoinAddressUtilsFactory = await ethers.getContractFactory("BitcoinAddressUtils")
  const bitcoinAddressUtils = await BitcoinAddressUtilsFactory.deploy()
  await bitcoinAddressUtils.deployed()

  return {
    sharedSPVCore,
    qcRedeemerSPV,
    bitcoinAddressUtils,
  }
}

/**
 * Helper function to deploy MessageSigning library
 */
export async function deployMessageSigning() {
  const MessageSigningFactory = await ethers.getContractFactory("MessageSigning")
  const messageSigning = await MessageSigningFactory.deploy()
  await messageSigning.deployed()
  return messageSigning
}

/**
 * Helper function to deploy QCManagerLib library
 */
export async function deployQCManagerLib() {
  // Deploy MessageSigning separately as QCManager needs it
  const messageSigning = await deployMessageSigning()

  // Deploy QCManagerLib (no linking needed - it's a library)
  const QCManagerLibFactory = await ethers.getContractFactory("QCManagerLib")
  const qcManagerLib = await QCManagerLibFactory.deploy()
  await qcManagerLib.deployed()

  return { qcManagerLib, messageSigning }
}

/**
 * Helper function to get library linking configuration for QCRedeemer
 */
export function getQCRedeemerLibraries(libraries: {
  qcRedeemerSPV: any
}) {
  return {
    libraries: {
      QCRedeemerSPV: libraries.qcRedeemerSPV.address,
    },
  }
}

/**
 * Helper function to get library linking configuration for QCManager
 */
export function getQCManagerLibraries(libraries: {
  messageSigning: any
  qcManagerLib?: any
}) {
  const libs: any = {
    MessageSigning: libraries.messageSigning.address,
  }

  if (libraries.qcManagerLib) {
    libs.QCManagerLib = libraries.qcManagerLib.address
  }

  return {
    libraries: libs,
  }
}