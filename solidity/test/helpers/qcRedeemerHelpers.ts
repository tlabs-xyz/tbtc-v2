/**
 * Test helper functions for QCRedeemer
 */

import { ethers } from "hardhat"

// Direct helper functions for QCRedeemer tests
export const validLegacyBtc = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
export const validBech32Btc = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"

export async function deployQCRedeemer() {
  const QCRedeemer = await ethers.getContractFactory("QCRedeemer")
  return QCRedeemer.deploy()
}
