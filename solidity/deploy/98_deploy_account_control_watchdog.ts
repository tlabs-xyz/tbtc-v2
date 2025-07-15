import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployAccountControlWatchdog(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log, get } = deployments

  log("Deploying Account Control Watchdog Integration (V1.1 Quorum)...")

  // Phase 4: V1.1 Watchdog Quorum System
  log("Phase 4: Deploying V1.1 Optimistic Watchdog Quorum System")

  const protocolRegistry = await get("ProtocolRegistry")

  // Deploy OptimisticWatchdogConsensus - Core N-of-M consensus mechanism
  const optimisticConsensus = await deploy("OptimisticWatchdogConsensus", {
    from: deployer,
    args: [protocolRegistry.address],
    log: true,
    waitConfirmations: helpers.network?.confirmations || 1,
  })

  // Deploy WatchdogAdapter - Backward compatibility with SingleWatchdog interface
  const watchdogAdapter = await deploy("WatchdogAdapter", {
    from: deployer,
    args: [protocolRegistry.address, optimisticConsensus.address],
    log: true,
    waitConfirmations: helpers.network?.confirmations || 1,
  })

  log("Phase 4 completed: V1.1 Watchdog Quorum System deployed")
  log(`OptimisticWatchdogConsensus: ${optimisticConsensus.address}`)
  log(`WatchdogAdapter: ${watchdogAdapter.address}`)
  log("")
  log("V1.1 Features:")
  log("- Optimistic execution with challenge periods")
  log("- MEV-resistant primary validator selection")
  log("- Escalating consensus (1h→4h→12h→24h)")
  log("- Approval mechanism for disputed operations")
  log("- Backward compatibility with SingleWatchdog interface")
}

export default func
func.tags = ["AccountControlWatchdog", "OptimisticWatchdogConsensus", "WatchdogAdapter"]
func.dependencies = ["AccountControlPolicies"]
