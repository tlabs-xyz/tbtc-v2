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
    log("Skipping test WalletRegistry deployment for non-test network")
    return
  }

  // Deploy a simple mock WalletRegistry for tests
  await deploy("WalletRegistry", {
    from: deployer,
    contract: "MockWalletRegistry",
    args: [],
    log: true,
    waitConfirmations: 1,
  })

  log("Deployed test WalletRegistry")
}

export default func

func.tags = ["WalletRegistry"]
func.id = "deploy_test_wallet_registry" // unique ID to prevent conflicts
func.skip = async (hre: HardhatRuntimeEnvironment) =>
  // Skip if not a test network
  hre.network.name !== "hardhat" &&
  hre.network.name !== "localhost" &&
  hre.network.name !== "development"
