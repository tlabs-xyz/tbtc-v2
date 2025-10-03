import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, helpers } = hre
  const { log } = deployments

  // Skip WalletRegistry check for test networks
  if (hre.network.name === "hardhat" || 
      hre.network.name === "localhost" ||
      hre.network.name === "development") {
    log("Skipping WalletRegistry resolution for test network")
    return
  }

  const WalletRegistry = await deployments.getOrNull("WalletRegistry")

  if (WalletRegistry && helpers.address.isValid(WalletRegistry.address)) {
    log(`using existing WalletRegistry at ${WalletRegistry.address}`)
  } else {
    throw new Error("deployed WalletRegistry contract not found")
  }
}

export default func

func.tags = ["WalletRegistry"]
