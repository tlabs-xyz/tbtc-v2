import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, helpers } = hre
  const { log } = deployments

  // Skip ReimbursementPool check for test networks
  if (
    hre.network.name === "hardhat" ||
    hre.network.name === "localhost" ||
    hre.network.name === "development"
  ) {
    log("Skipping ReimbursementPool resolution for test network")
    return
  }

  const ReimbursementPool = await deployments.getOrNull("ReimbursementPool")

  if (ReimbursementPool && helpers.address.isValid(ReimbursementPool.address)) {
    log(`using existing ReimbursementPool at ${ReimbursementPool.address}`)
  } else {
    throw new Error("deployed ReimbursementPool contract not found")
  }
}

export default func

func.tags = ["ReimbursementPool"]
