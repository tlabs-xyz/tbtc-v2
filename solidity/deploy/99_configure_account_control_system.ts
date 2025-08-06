import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers } from "hardhat"

const func: DeployFunction = async function ConfigureAccountControlSystem(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { log, get, execute } = deployments

  log("Configuring Account Control System with Simplified Watchdog...")

  // Get all deployed contracts
  const protocolRegistry = await get("ProtocolRegistry")
  const qcMinter = await get("QCMinter")
  const qcRedeemer = await get("QCRedeemer")
  const qcData = await get("QCData")
  const systemState = await get("SystemState")
  const qcManager = await get("QCManager")
  const qcReserveLedger = await get("QCReserveLedger")
  const basicMintingPolicy = await get("BasicMintingPolicy")
  const basicRedemptionPolicy = await get("BasicRedemptionPolicy")
  const tbtc = await get("TBTC")

  // Get simplified watchdog contracts
  const reserveOracle = await get("ReserveOracle")
  const subjectiveReporting = await get("WatchdogSubjectiveReporting")
  const watchdogEnforcer = await get("WatchdogEnforcer")

  // Generate service keys
  const QC_DATA_KEY = ethers.utils.id("QC_DATA")
  const SYSTEM_STATE_KEY = ethers.utils.id("SYSTEM_STATE")
  const QC_MANAGER_KEY = ethers.utils.id("QC_MANAGER")
  const QC_RESERVE_LEDGER_KEY = ethers.utils.id("QC_RESERVE_LEDGER")
  const MINTING_POLICY_KEY = ethers.utils.id("MINTING_POLICY")
  const REDEMPTION_POLICY_KEY = ethers.utils.id("REDEMPTION_POLICY")
  const RESERVE_ORACLE_KEY = ethers.utils.id("RESERVE_ORACLE")
  const SUBJECTIVE_REPORTING_KEY = ethers.utils.id("SUBJECTIVE_REPORTING")
  const WATCHDOG_ENFORCER_KEY = ethers.utils.id("WATCHDOG_ENFORCER")

  // Step 1: Register all services in ProtocolRegistry
  log("Step 1: Registering services in ProtocolRegistry...")
  
  const services = [
    { key: QC_DATA_KEY, address: qcData.address, name: "QCData" },
    { key: SYSTEM_STATE_KEY, address: systemState.address, name: "SystemState" },
    { key: QC_MANAGER_KEY, address: qcManager.address, name: "QCManager" },
    { key: QC_RESERVE_LEDGER_KEY, address: qcReserveLedger.address, name: "QCReserveLedger" },
    { key: MINTING_POLICY_KEY, address: basicMintingPolicy.address, name: "BasicMintingPolicy" },
    { key: REDEMPTION_POLICY_KEY, address: basicRedemptionPolicy.address, name: "BasicRedemptionPolicy" },
    { key: RESERVE_ORACLE_KEY, address: reserveOracle.address, name: "ReserveOracle" },
    { key: SUBJECTIVE_REPORTING_KEY, address: subjectiveReporting.address, name: "WatchdogSubjectiveReporting" },
    { key: WATCHDOG_ENFORCER_KEY, address: watchdogEnforcer.address, name: "WatchdogEnforcer" },
  ]

  for (const service of services) {
    await execute(
      "ProtocolRegistry",
      { from: deployer, log: true },
      "setService",
      service.key,
      service.address
    )
    log(`  ✅ Registered ${service.name}`)
  }

  // Step 2: Configure Oracle and Reserve Ledger integration
  log("Step 2: Configuring Oracle integration with Reserve Ledger...")
  
  // Set oracle address in QCReserveLedger
  await execute(
    "QCReserveLedger",
    { from: deployer, log: true },
    "setReserveOracle",
    reserveOracle.address
  )
  log("  ✅ Oracle address set in QCReserveLedger")

  // Grant ATTESTER_ROLE to oracle for consensus attestations
  const ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE")
  await execute(
    "QCReserveLedger",
    { from: deployer, log: true },
    "grantRole",
    ATTESTER_ROLE,
    reserveOracle.address
  )
  log("  ✅ ATTESTER_ROLE granted to ReserveOracle")

  // Step 3: Configure QCManager roles
  log("Step 3: Configuring QCManager roles...")
  
  // Grant QC_MANAGER_ROLE to QCData
  const QC_MANAGER_ROLE = ethers.utils.id("QC_MANAGER_ROLE")
  await execute(
    "QCData",
    { from: deployer, log: true },
    "grantRole",
    QC_MANAGER_ROLE,
    qcManager.address
  )
  log("  ✅ QC_MANAGER_ROLE granted to QCManager in QCData")

  // Grant MINTER_ROLE to QCMinter
  const MINTER_ROLE = ethers.utils.id("MINTER_ROLE")
  await execute(
    "TBTC",
    { from: deployer, log: true },
    "grantRole",
    MINTER_ROLE,
    qcMinter.address
  )
  log("  ✅ MINTER_ROLE granted to QCMinter in TBTC")

  // Grant BURNER_ROLE to QCRedeemer
  const BURNER_ROLE = ethers.utils.id("BURNER_ROLE")
  await execute(
    "TBTC",
    { from: deployer, log: true },
    "grantRole",
    BURNER_ROLE,
    qcRedeemer.address
  )
  log("  ✅ BURNER_ROLE granted to QCRedeemer in TBTC")

  // Step 4: Configure Watchdog Enforcer permissions
  log("Step 4: Configuring Watchdog Enforcer permissions...")
  
  // Grant ARBITER_ROLE to WatchdogEnforcer for setting QC status
  const ARBITER_ROLE = ethers.utils.id("ARBITER_ROLE")
  await execute(
    "QCManager",
    { from: deployer, log: true },
    "grantRole",
    ARBITER_ROLE,
    watchdogEnforcer.address
  )
  log("  ✅ ARBITER_ROLE granted to WatchdogEnforcer")

  // Step 5: Set initial system parameters
  log("Step 5: Setting initial system parameters...")
  
  // Set staleness threshold (7 days)
  await execute(
    "SystemState",
    { from: deployer, log: true },
    "setStaleThreshold",
    7 * 24 * 60 * 60 // 7 days in seconds
  )
  log("  ✅ Stale threshold set to 7 days")
  
  // Set redemption timeout (48 hours)
  await execute(
    "SystemState",
    { from: deployer, log: true },
    "setRedemptionTimeout",
    48 * 60 * 60 // 48 hours in seconds
  )
  log("  ✅ Redemption timeout set to 48 hours")
  
  // Set minting amounts
  await execute(
    "SystemState",
    { from: deployer, log: true },
    "setMinMintAmount",
    ethers.utils.parseUnits("0.01", 18) // 0.01 tBTC minimum
  )
  log("  ✅ Min mint amount set to 0.01 tBTC")
  
  await execute(
    "SystemState",
    { from: deployer, log: true },
    "setMaxMintAmount",
    ethers.utils.parseUnits("100", 18) // 100 tBTC maximum
  )
  log("  ✅ Max mint amount set to 100 tBTC")

  // Set collateral ratio (90%)
  await execute(
    "SystemState",
    { from: deployer, log: true },
    "setMinCollateralRatio",
    90 // 90% minimum collateral
  )
  log("  ✅ Min collateral ratio set to 90%")

  log("")
  log("✨ Account Control System configuration complete!")
  log("")
  log("System Overview:")
  log("  Core Components:")
  log(`    - ProtocolRegistry: ${protocolRegistry.address}`)
  log(`    - QCManager: ${qcManager.address}`)
  log(`    - QCData: ${qcData.address}`)
  log(`    - QCMinter: ${qcMinter.address}`)
  log(`    - QCRedeemer: ${qcRedeemer.address}`)
  log("")
  log("  Watchdog Components:")
  log(`    - ReserveOracle: ${reserveOracle.address}`)
  log(`    - SubjectiveReporting: ${subjectiveReporting.address}`)
  log(`    - WatchdogEnforcer: ${watchdogEnforcer.address}`)
  log("")
  log("  Policies:")
  log(`    - MintingPolicy: ${basicMintingPolicy.address}`)
  log(`    - RedemptionPolicy: ${basicRedemptionPolicy.address}`)
  log("")
  log("Next steps:")
  log("  1. Grant WATCHDOG_ROLE to authorized watchdog addresses")
  log("  2. Grant ATTESTER_ROLE to oracle attesters")
  log("  3. Register initial QCs via QCManager")
}

func.tags = ["ConfigureSystem", "Configuration"]
func.dependencies = ["SimplifiedWatchdog", "QCManager", "QCData", "QCMinter", "QCRedeemer", "SystemState", "ProtocolRegistry"]

export default func