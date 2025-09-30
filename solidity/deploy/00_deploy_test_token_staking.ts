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
    log("Skipping test TokenStaking deployment for non-test network")
    return
  }

  // Deploy a simple mock TokenStaking for tests
  await deploy("TokenStaking", {
    from: deployer,
    contract: "MockTokenStaking",
    args: [],
    log: true,
    waitConfirmations: 1,
  })

  log("Deployed test TokenStaking")
}

export default func

func.tags = ["TokenStaking"]
func.id = "deploy_test_token_staking" // unique ID to prevent conflicts
func.skip = async (hre: HardhatRuntimeEnvironment) => {
  // Skip if not a test network
  return hre.network.name !== "hardhat" &&
         hre.network.name !== "localhost" &&
         hre.network.name !== "development"
}