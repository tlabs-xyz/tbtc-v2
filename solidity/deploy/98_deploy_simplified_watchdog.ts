import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeploySimplifiedWatchdog(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log, get } = deployments

  log("Deploying Simplified Watchdog System...")

  // Get required contracts
  const qcManager = await get("QCManager")
  const qcData = await get("QCData")
  const qcReserveLedger = await get("QCReserveLedger")
  const systemState = await get("SystemState")

  // Deploy WatchdogReasonCodes library
  log("Deploying WatchdogReasonCodes library...")
  const watchdogReasonCodes = await deploy("WatchdogReasonCodes", {
    from: deployer,
    log: true,
  })
  log(`✅ WatchdogReasonCodes deployed at ${watchdogReasonCodes.address}`)

  // Deploy ReserveOracle
  log("Deploying ReserveOracle...")
  const reserveOracle = await deploy("ReserveOracle", {
    from: deployer,
    args: [qcReserveLedger.address],
    log: true,
  })
  log(`✅ ReserveOracle deployed at ${reserveOracle.address}`)

  // Deploy WatchdogSubjectiveReporting
  log("Deploying WatchdogSubjectiveReporting...")
  const subjectiveReporting = await deploy("WatchdogSubjectiveReporting", {
    from: deployer,
    log: true,
  })
  log(`✅ WatchdogSubjectiveReporting deployed at ${subjectiveReporting.address}`)

  // Deploy WatchdogEnforcer with library link
  log("Deploying WatchdogEnforcer...")
  const watchdogEnforcer = await deploy("WatchdogEnforcer", {
    from: deployer,
    args: [
      qcManager.address,
      qcData.address,
      qcReserveLedger.address,
      systemState.address,
    ],
    libraries: {
      WatchdogReasonCodes: watchdogReasonCodes.address,
    },
    log: true,
  })
  log(`✅ WatchdogEnforcer deployed at ${watchdogEnforcer.address}`)

  log("✨ Simplified Watchdog System deployment complete!")
  log("")
  log("Deployed contracts:")
  log(`  - WatchdogReasonCodes: ${watchdogReasonCodes.address}`)
  log(`  - ReserveOracle: ${reserveOracle.address}`)
  log(`  - WatchdogSubjectiveReporting: ${subjectiveReporting.address}`)
  log(`  - WatchdogEnforcer: ${watchdogEnforcer.address}`)
  log("")
  log("Next steps: Run 99_configure_simplified_watchdog.ts to configure roles and connections")
}

func.tags = ["SimplifiedWatchdog", "Watchdog"]
func.dependencies = ["QCManager", "QCData", "QCReserveLedger", "SystemState"]

export default func