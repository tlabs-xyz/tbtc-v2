/**
 * Test helper functions for QCRedeemer
 */

import { ethers } from "hardhat"

// Direct helper functions for QCRedeemer tests
export const validLegacyBtc = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
export const validBech32Btc = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"

export async function deployQCRedeemer(
  tbtcToken: string,
  qcData: string,
  systemState: string,
  lightRelay: string,
  txProofDifficultyFactor: number = 100
) {
  // Deploy SharedSPVCore library first
  const SharedSPVCore = await ethers.getContractFactory("SharedSPVCore")
  const sharedSPVCore = await SharedSPVCore.deploy()

  // Deploy QCRedeemerSPV library with SharedSPVCore linked
  const QCRedeemerSPV = await ethers.getContractFactory("QCRedeemerSPV", {
    libraries: {
      SharedSPVCore: sharedSPVCore.address,
    },
  })
  const qcRedeemerSPV = await QCRedeemerSPV.deploy()

  // Deploy QCRedeemer with library linked
  const QCRedeemer = await ethers.getContractFactory("QCRedeemer", {
    libraries: {
      QCRedeemerSPV: qcRedeemerSPV.address,
    },
  })

  return QCRedeemer.deploy(
    tbtcToken,
    qcData,
    systemState,
    lightRelay,
    txProofDifficultyFactor
  )
}
