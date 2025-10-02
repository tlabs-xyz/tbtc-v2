import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, execute, log } = deployments
  const { deployer, governance } = await getNamedAccounts()

  // Only deploy for test networks
  if (
    hre.network.name !== "hardhat" &&
    hre.network.name !== "localhost" &&
    hre.network.name !== "development"
  ) {
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

  // Transfer ownership to governance account for proper authorization flow
  await execute(
    "ReimbursementPool",
    { from: deployer, log: true, waitConfirmations: 1 },
    "transferOwnership",
    governance
  )

  log("Deployed test ReimbursementPool and transferred ownership to governance")
}

export default func

func.tags = ["ReimbursementPool"]
func.id = "deploy_test_reimbursement_pool" // unique ID to prevent conflicts
func.skip = async (hre: HardhatRuntimeEnvironment) =>
  // Skip if not a test network
  hre.network.name !== "hardhat" &&
  hre.network.name !== "localhost" &&
  hre.network.name !== "development"
