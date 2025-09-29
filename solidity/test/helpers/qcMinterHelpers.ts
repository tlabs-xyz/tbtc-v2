/**
 * Test helper functions for QCMinter
 */

import { ethers } from "hardhat"

// Direct helper functions for QCMinter tests
export async function deployQCMinter() {
  const QCMinter = await ethers.getContractFactory("QCMinter")
  return QCMinter.deploy()
}

export const defaultMintAmount = ethers.utils.parseEther("1.0")
export const defaultMaxCapacity = ethers.utils.parseEther("1000.0")
