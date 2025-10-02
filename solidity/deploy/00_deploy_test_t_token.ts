import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, log } = deployments
  const { deployer } = await getNamedAccounts()

  // Only deploy for test networks
  if (
    hre.network.name !== "hardhat" &&
    hre.network.name !== "localhost" &&
    hre.network.name !== "development"
  ) {
    log("Skipping test T token deployment for non-test network")
    return
  }

  // Deploy a simple mock T token for tests
  await deploy("T", {
    from: deployer,
    contract: "MockT",
    args: [],
    log: true,
    waitConfirmations: 1,
  })

  log("Deployed test T token")
}

export default func

func.tags = ["T"]
func.id = "deploy_test_t_token" // unique ID to prevent conflicts
func.skip = async (hre: HardhatRuntimeEnvironment) =>
  // Skip if not a test network
  hre.network.name !== "hardhat" &&
  hre.network.name !== "localhost" &&
  hre.network.name !== "development"
