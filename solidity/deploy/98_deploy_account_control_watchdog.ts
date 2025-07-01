import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployAccountControlWatchdog(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log, get } = deployments

  log("Deploying Account Control Watchdog Integration...")

  // Phase 4: Watchdog Integration
  log("Phase 4: Deploying Single Watchdog Service")

  const protocolRegistry = await get("ProtocolRegistry")

  // Deploy SingleWatchdog - Integrated service with multiple roles
  const singleWatchdog = await deploy("SingleWatchdog", {
    from: deployer,
    args: [protocolRegistry.address],
    log: true,
    waitConfirmations: helpers.network?.confirmations || 1,
  })

  log("Phase 4 completed: Single Watchdog service deployed")
  log(`SingleWatchdog: ${singleWatchdog.address}`)
}

export default func
func.tags = ["AccountControlWatchdog", "SingleWatchdog"]
func.dependencies = ["AccountControlPolicies"]
