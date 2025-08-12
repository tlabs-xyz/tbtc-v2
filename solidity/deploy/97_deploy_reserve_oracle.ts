import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployReserveOracle(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log } = deployments

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
func.dependencies = ["QCData", "SystemState"] // Basic dependencies only

export default func
