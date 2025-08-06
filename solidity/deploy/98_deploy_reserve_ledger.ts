import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployReserveLedger(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log, get } = deployments

  log("Deploying ReserveLedger System...")

  // Get required contracts
  const qcManager = await get("QCManager")
  const qcData = await get("QCData")
  const systemState = await get("SystemState")

  // Deploy WatchdogReasonCodes library
  log("Deploying WatchdogReasonCodes library...")
  const watchdogReasonCodes = await deploy("WatchdogReasonCodes", {
    from: deployer,
    log: true,
  })
  log(`✅ WatchdogReasonCodes deployed at ${watchdogReasonCodes.address}`)

  // Deploy ReserveLedger (unified oracle + ledger)
  log("Deploying ReserveLedger...")
  const reserveLedger = await deploy("ReserveLedger", {
    from: deployer,
    args: [],
    log: true,
  })
  log(`✅ ReserveLedger deployed at ${reserveLedger.address}`)

  // Deploy WatchdogSubjectiveReporting
  log("Deploying WatchdogSubjectiveReporting...")
  const watchdogReporting = await deploy("WatchdogSubjectiveReporting", {
    from: deployer,
    log: true,
  })
  log(`✅ WatchdogSubjectiveReporting deployed at ${watchdogReporting.address}`)

  // Deploy WatchdogEnforcer with library link
  log("Deploying WatchdogEnforcer...")
  const watchdogEnforcer = await deploy("WatchdogEnforcer", {
    from: deployer,
    args: [
      reserveLedger.address,
      qcManager.address,
      qcData.address,
      systemState.address,
    ],
    libraries: {
      WatchdogReasonCodes: watchdogReasonCodes.address,
    },
    log: true,
  })
  log(`✅ WatchdogEnforcer deployed at ${watchdogEnforcer.address}`)

  log("✨ ReserveLedger System deployment complete!")
  log("")
  log("Deployed contracts:")
  log(`  - WatchdogReasonCodes: ${watchdogReasonCodes.address}`)
  log(`  - ReserveLedger: ${reserveLedger.address}`)
  log(`  - WatchdogSubjectiveReporting: ${watchdogReporting.address}`)
  log(`  - WatchdogEnforcer: ${watchdogEnforcer.address}`)
  log("")
  log("Next steps: Run 99_configure_account_control_system.ts to configure roles and connections")
}

func.tags = ["ReserveLedger", "Watchdog"]
func.dependencies = ["QCManager", "QCData", "SystemState"]

export default func