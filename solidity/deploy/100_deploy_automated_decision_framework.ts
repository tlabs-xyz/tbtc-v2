import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, log } = deployments

  const { deployer, governance } = await getNamedAccounts()

  log("=== Deploying Automated Decision Framework ===")

  // Get required contract addresses
  const qcManager = await deployments.get("QCManager")
  const qcRedeemer = await deployments.get("QCRedeemer") 
  const qcData = await deployments.get("QCData")
  const systemState = await deployments.get("SystemState")
  
  // Check if ReserveLedger exists (it might be deployed separately)
  let reserveLedger
  try {
    reserveLedger = await deployments.get("ReserveLedger")
  } catch (e) {
    log("ReserveLedger not found, deploying placeholder...")
    // Deploy a simple placeholder for ReserveLedger
    reserveLedger = await deploy("ReserveLedger", {
      from: deployer,
      args: [],
      log: true,
      skipIfAlreadyDeployed: true,
    })
  }

  // 1. Deploy WatchdogAutomatedEnforcement (Layer 1)
  log("Deploying WatchdogAutomatedEnforcement...")
  const automatedEnforcement = await deploy("WatchdogAutomatedEnforcement", {
    from: deployer,
    args: [
      qcManager.address,
      qcRedeemer.address,
      qcData.address,
      systemState.address,
      reserveLedger.address,
    ],
    log: true,
    skipIfAlreadyDeployed: true,
  })

  // 2. Deploy WatchdogThresholdActions (Layer 2)
  log("Deploying WatchdogThresholdActions...")
  const thresholdActions = await deploy("WatchdogThresholdActions", {
    from: deployer,
    args: [
      qcManager.address,
      qcData.address,
      systemState.address,
    ],
    log: true,
    skipIfAlreadyDeployed: true,
  })

  // 3. Deploy WatchdogDAOEscalation (Layer 3)
  log("Deploying WatchdogDAOEscalation...")
  
  // Check if DAO/Governor exists
  let daoAddress = governance // Default to governance address
  try {
    const governor = await deployments.get("BridgeGovernance")
    daoAddress = governor.address
    log(`Using existing BridgeGovernance at ${daoAddress}`)
  } catch (e) {
    log(`Using governance address ${daoAddress} as DAO`)
  }

  const daoEscalation = await deploy("WatchdogDAOEscalation", {
    from: deployer,
    args: [
      qcManager.address,
      qcData.address,
      systemState.address,
      daoAddress,
    ],
    log: true,
    skipIfAlreadyDeployed: true,
  })

  log("=== Automated Decision Framework Deployed ===")
  log(`WatchdogAutomatedEnforcement: ${automatedEnforcement.address}`)
  log(`WatchdogThresholdActions: ${thresholdActions.address}`)
  log(`WatchdogDAOEscalation: ${daoEscalation.address}`)

  // Configuration and integration will be done in the next script
  log("Note: Configuration and role assignments will be done in script 101")
}

func.tags = ["AutomatedDecisionFramework", "WatchdogAutomatedEnforcement", "WatchdogThresholdActions", "WatchdogDAOEscalation"]
func.dependencies = ["QCManager", "QCRedeemer", "QCData", "SystemState"]

export default func