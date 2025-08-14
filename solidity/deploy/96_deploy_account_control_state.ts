import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployAccountControlState(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, network } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log, get } = deployments

  log("Deploying Account Control State Management Layer...")

  // Phase 2: State Management Layer
  log("Phase 2: Deploying State Management Layer")

  // Deploy QCData - Storage layer with 5-state models
  const qcData = await deploy("QCData", {
    from: deployer,
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })

  // Deploy SystemState - Global configuration and emergency controls
  const systemState = await deploy("SystemState", {
    from: deployer,
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })

  // Get dependencies for QCManager
  const reserveOracle = await get("ReserveOracle")

  // Deploy QCManager - Unified business logic with state management and pause credits, message signing support
  const qcManager = await deploy("QCManager", {
    from: deployer,
    args: [
      qcData.address,
      systemState.address,
      reserveOracle.address,
    ],
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })

  log("Phase 2 completed: State management layer deployed")
  log(`QCData: ${qcData.address}`)
  log(`SystemState: ${systemState.address}`)
  log(`QCManager: ${qcManager.address}`)
}

export default func
func.tags = ["AccountControlState", "QCData", "SystemState", "QCManager"]
func.dependencies = ["ReserveOracle", "AccountControlCore"]
