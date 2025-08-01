import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployAccountControlWatchdog(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log, get } = deployments

  log("Deploying Account Control Watchdog Consensus...")

  // Phase 4: Watchdog Consensus System
  log("Phase 4: Deploying Watchdog Consensus System")

  const protocolRegistry = await get("ProtocolRegistry")

  // Deploy WatchdogConsensus - Core N-of-M consensus mechanism
  const watchdogConsensus = await deploy("WatchdogConsensus", {
    from: deployer,
    args: [protocolRegistry.address],
    log: true,
    waitConfirmations: helpers.network?.confirmations || 1,
  })

  log("Phase 4 completed: Watchdog Consensus System deployed")
  log(`WatchdogConsensus: ${watchdogConsensus.address}`)
  log("")
  log("Features:")
  log("- Simple majority voting (N/2+1)")
  log("- Fixed 2-hour challenge period")
  log("- Single execution path")
  log("- Clean architecture with no unnecessary complexity")
}

export default func
func.tags = ["AccountControlWatchdog", "WatchdogConsensus"]
func.dependencies = ["AccountControlPolicies"]
