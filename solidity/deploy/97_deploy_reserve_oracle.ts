import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployReserveOracle(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, network } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log } = deployments

  // Skip for test networks
  if (network.name === "hardhat" || network.name === "localhost") {
    log("Skipping Reserve Oracle deployment for test network")
    return
  }

  log("Deploying ReserveOracle...")

  // Deploy ReserveOracle (Byzantine fault-tolerant consensus oracle)
  const reserveOracle = await deploy("ReserveOracle", {
    from: deployer,
    args: [],
    log: true,
  })

  log(`✅ ReserveOracle deployed at ${reserveOracle.address}`)
}

func.tags = ["ReserveOracle"]
func.dependencies = [] // Fixed: ReserveOracle is standalone, no dependencies

export default func
