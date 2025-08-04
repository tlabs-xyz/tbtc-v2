import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployAccountControlWatchdog(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log, get } = deployments

  log("Deploying Account Control Watchdog System...")

  // Phase 4: Watchdog System
  log("Phase 4: Deploying Watchdog System")

  const qcManager = await get("QCManager")
  const qcRedeemer = await get("QCRedeemer")
  const qcData = await get("QCData")

  // Deploy WatchdogConsensusManager - M-of-N consensus for critical operations
  const watchdogConsensusManager = await deploy("WatchdogConsensusManager", {
    from: deployer,
    args: [qcManager.address, qcRedeemer.address, qcData.address],
    log: true,
    waitConfirmations: helpers.network?.confirmations || 1,
  })

  // Deploy WatchdogMonitor - Coordinates multiple QCWatchdog instances
  const watchdogMonitor = await deploy("WatchdogMonitor", {
    from: deployer,
    args: [watchdogConsensusManager.address, qcData.address],
    log: true,
    waitConfirmations: helpers.network?.confirmations || 1,
  })

  log("Phase 4 completed: Watchdog System deployed")
  log(`WatchdogConsensusManager: ${watchdogConsensusManager.address}`)
  log(`WatchdogMonitor: ${watchdogMonitor.address}`)
  log("")
  log("Features:")
  log("- Configurable M-of-N consensus (default: 2-of-5)")
  log("- Multiple independent QCWatchdog instances")
  log("- Emergency pause with 3-report threshold")
  log("- Clean separation of monitoring vs consensus")
  log("")
  log("Note: Automated Decision Framework will be deployed in script 100-101")
}

export default func
func.tags = ["AccountControlWatchdog", "WatchdogConsensus"]
func.dependencies = ["AccountControlPolicies"]
