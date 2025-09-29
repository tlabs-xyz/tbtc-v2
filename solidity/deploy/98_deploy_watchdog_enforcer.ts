import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployWatchdogEnforcer(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log, get } = deployments

  log("Deploying WatchdogEnforcer...")

  // Get required contracts
  const qcManager = await get("QCManager")
  const qcData = await get("QCData")
  const systemState = await get("SystemState")
  const reserveOracle = await get("ReserveOracle")

  // Deploy WatchdogEnforcer
  const watchdogEnforcer = await deploy("WatchdogEnforcer", {
    from: deployer,
    args: [
      reserveOracle.address,
      qcManager.address,
      qcData.address,
      systemState.address,
    ],
    log: true,
  })

  log(`✅ WatchdogEnforcer deployed at ${watchdogEnforcer.address}`)
  log("")
  log("Watchdog System deployment complete!")
  log(
    "Next steps: Run 99_configure_account_control_system.ts to configure roles and connections"
  )
}

func.tags = ["WatchdogEnforcer", "Watchdog"]
func.dependencies = ["QCManager", "ReserveOracle"]

export default func
