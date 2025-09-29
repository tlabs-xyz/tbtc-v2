import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, log } = deployments
  const { deployer } = await getNamedAccounts()

  // Only deploy for test networks
  if (hre.network.name !== "hardhat" &&
      hre.network.name !== "localhost" &&
      hre.network.name !== "development") {
    log("Skipping test ReimbursementPool deployment for non-test network")
    return
  }

  // Deploy a simple mock ReimbursementPool for tests
  await deploy("ReimbursementPool", {
    from: deployer,
    contract: "MockReimbursementPool",
    args: [],
    log: true,
    waitConfirmations: 1,
  })

  log("Deployed test ReimbursementPool")
}

export default func

func.tags = ["TestReimbursementPool"]
func.skip = async (hre: HardhatRuntimeEnvironment) => {
  // Skip if not a test network
  return hre.network.name !== "hardhat" &&
         hre.network.name !== "localhost" &&
         hre.network.name !== "development"
}