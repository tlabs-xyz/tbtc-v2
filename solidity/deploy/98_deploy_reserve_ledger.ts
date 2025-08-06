import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployQCReserveLedger(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log, get } = deployments

  log("Deploying QCReserveLedger System...")

  // Get required contracts
  const qcManager = await get("QCManager")
  const qcData = await get("QCData")
  const systemState = await get("SystemState")

  // Deploy QCReserveLedger (unified oracle + ledger)
  log("Deploying QCReserveLedger...")
  const reserveLedger = await deploy("QCReserveLedger", {
    from: deployer,
    args: [],
    log: true,
  })
  log(`✅ QCReserveLedger deployed at ${reserveLedger.address}`)

  // Deploy WatchdogReporting
  log("Deploying WatchdogReporting...")
  const watchdogReporting = await deploy("WatchdogReporting", {
    from: deployer,
    log: true,
  })
  log(`✅ WatchdogReporting deployed at ${watchdogReporting.address}`)

  // Deploy WatchdogEnforcer (reason codes now inlined, no library needed)
  log("Deploying WatchdogEnforcer...")
  const watchdogEnforcer = await deploy("WatchdogEnforcer", {
    from: deployer,
    args: [
      reserveLedger.address,
      qcManager.address,
      qcData.address,
      systemState.address,
    ],
    log: true,
  })
  log(`✅ WatchdogEnforcer deployed at ${watchdogEnforcer.address}`)

  log("✨ QCReserveLedger System deployment complete!")
  log("")
  log("Deployed contracts:")
  log(`  - QCReserveLedger: ${reserveLedger.address}`)
  log(`  - WatchdogReporting: ${watchdogReporting.address}`)
  log(`  - WatchdogEnforcer: ${watchdogEnforcer.address}`)
  log("  - Note: WatchdogReasonCodes library removed - reason codes now inlined")
  log("")
  log("Next steps: Run 99_configure_account_control_system.ts to configure roles and connections")
}

func.tags = ["QCReserveLedger", "Watchdog"]
func.dependencies = ["QCManager", "QCData", "SystemState"]

export default func