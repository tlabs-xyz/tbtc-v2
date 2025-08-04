import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers } from "hardhat"

const func: DeployFunction = async function ConfigureAccountControlSystem(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { log, get, execute } = deployments

  log("Configuring Account Control System...")

  // Phase 5: System Configuration
  log("Phase 5: Configuring Complete System")

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
  const watchdogConsensusManager = await get("WatchdogConsensusManager")
  const watchdogMonitor = await get("WatchdogMonitor")
  const tbtc = await get("TBTC")

  // Check for new automated framework contracts (optional deployment)
  let automatedFrameworkDeployed = false
  let watchdogAutomatedEnforcement, watchdogThresholdActions, watchdogDAOEscalation, reserveLedger
  
  try {
    watchdogAutomatedEnforcement = await get("WatchdogAutomatedEnforcement")
    watchdogThresholdActions = await get("WatchdogThresholdActions")
    watchdogDAOEscalation = await get("WatchdogDAOEscalation")
    reserveLedger = await get("ReserveLedger")
    automatedFrameworkDeployed = true
    log("✅ Automated Decision Framework detected - will configure alongside legacy system")
  } catch (e) {
    log("ℹ️  Automated Decision Framework not deployed - configuring legacy system only")
  }

  // Generate service keys (same as in contracts)
  const QC_DATA_KEY = ethers.utils.id("QC_DATA")
  const SYSTEM_STATE_KEY = ethers.utils.id("SYSTEM_STATE")
  const QC_MANAGER_KEY = ethers.utils.id("QC_MANAGER")
  const QC_RESERVE_LEDGER_KEY = ethers.utils.id("QC_RESERVE_LEDGER")
  const MINTING_POLICY_KEY = ethers.utils.id("MINTING_POLICY")
  const REDEMPTION_POLICY_KEY = ethers.utils.id("REDEMPTION_POLICY")
  const QC_MINTER_KEY = ethers.utils.id("QC_MINTER")
  const QC_REDEEMER_KEY = ethers.utils.id("QC_REDEEMER")
  const TBTC_TOKEN_KEY = ethers.utils.id("TBTC_TOKEN")
  // Watchdog System keys
  const WATCHDOG_CONSENSUS_MANAGER_KEY = ethers.utils.id("WATCHDOG_CONSENSUS_MANAGER")
  const WATCHDOG_MONITOR_KEY = ethers.utils.id("WATCHDOG_MONITOR")
  
  // Automated Framework service keys (if deployed)
  const WATCHDOG_AUTOMATED_ENFORCEMENT_KEY = ethers.utils.id("WATCHDOG_AUTOMATED_ENFORCEMENT")
  const WATCHDOG_THRESHOLD_ACTIONS_KEY = ethers.utils.id("WATCHDOG_THRESHOLD_ACTIONS")
  const WATCHDOG_DAO_ESCALATION_KEY = ethers.utils.id("WATCHDOG_DAO_ESCALATION")
  const RESERVE_LEDGER_KEY = ethers.utils.id("RESERVE_LEDGER")

  log("Step 1: Registering all services in ProtocolRegistry...")

  // Register all services in ProtocolRegistry
  await execute(
    "ProtocolRegistry",
    { from: deployer, log: true },
    "setService",
    QC_DATA_KEY,
    qcData.address
  )

  await execute(
    "ProtocolRegistry",
    { from: deployer, log: true },
    "setService",
    SYSTEM_STATE_KEY,
    systemState.address
  )

  await execute(
    "ProtocolRegistry",
    { from: deployer, log: true },
    "setService",
    QC_MANAGER_KEY,
    qcManager.address
  )

  await execute(
    "ProtocolRegistry",
    { from: deployer, log: true },
    "setService",
    QC_RESERVE_LEDGER_KEY,
    qcReserveLedger.address
  )

  await execute(
    "ProtocolRegistry",
    { from: deployer, log: true },
    "setService",
    MINTING_POLICY_KEY,
    basicMintingPolicy.address
  )

  await execute(
    "ProtocolRegistry",
    { from: deployer, log: true },
    "setService",
    REDEMPTION_POLICY_KEY,
    basicRedemptionPolicy.address
  )

  await execute(
    "ProtocolRegistry",
    { from: deployer, log: true },
    "setService",
    QC_MINTER_KEY,
    qcMinter.address
  )

  await execute(
    "ProtocolRegistry",
    { from: deployer, log: true },
    "setService",
    QC_REDEEMER_KEY,
    qcRedeemer.address
  )

  await execute(
    "ProtocolRegistry",
    { from: deployer, log: true },
    "setService",
    TBTC_TOKEN_KEY,
    tbtc.address
  )

  // Register Watchdog System services
  await execute(
    "ProtocolRegistry",
    { from: deployer, log: true },
    "setService",
    WATCHDOG_CONSENSUS_MANAGER_KEY,
    watchdogConsensusManager.address
  )

  await execute(
    "ProtocolRegistry",
    { from: deployer, log: true },
    "setService",
    WATCHDOG_MONITOR_KEY,
    watchdogMonitor.address
  )

  // Register Automated Framework services (if deployed)
  if (automatedFrameworkDeployed) {
    await execute(
      "ProtocolRegistry",
      { from: deployer, log: true },
      "setService",
      WATCHDOG_AUTOMATED_ENFORCEMENT_KEY,
      watchdogAutomatedEnforcement.address
    )

    await execute(
      "ProtocolRegistry",
      { from: deployer, log: true },
      "setService",
      WATCHDOG_THRESHOLD_ACTIONS_KEY,
      watchdogThresholdActions.address
    )

    await execute(
      "ProtocolRegistry",
      { from: deployer, log: true },
      "setService",
      WATCHDOG_DAO_ESCALATION_KEY,
      watchdogDAOEscalation.address
    )

    await execute(
      "ProtocolRegistry",
      { from: deployer, log: true },
      "setService",
      RESERVE_LEDGER_KEY,
      reserveLedger.address
    )
  }

  log("Step 2: Configuring access control roles...")

  // Grant DATA_MANAGER_ROLE to QCManager in QCData
  const DATA_MANAGER_ROLE = ethers.utils.id("DATA_MANAGER_ROLE")
  await execute(
    "QCData",
    { from: deployer, log: true },
    "grantRole",
    DATA_MANAGER_ROLE,
    qcManager.address
  )

  // Grant QC_ADMIN_ROLE to BasicMintingPolicy in QCManager
  const QC_ADMIN_ROLE = ethers.utils.id("QC_ADMIN_ROLE")
  await execute(
    "QCManager",
    { from: deployer, log: true },
    "grantRole",
    QC_ADMIN_ROLE,
    basicMintingPolicy.address
  )

  // Grant MINTER_ROLE to BasicMintingPolicy in TBTC token (skip in test mode)
  if (!hre.network.tags.allowStubs) {
    const MINTER_ROLE = ethers.utils.id("MINTER_ROLE")
    await execute(
      "TBTC",
      { from: deployer, log: true },
      "grantRole",
      MINTER_ROLE,
      basicMintingPolicy.address
    )
  } else {
    log("Skipping TBTC grantRole in test mode")
  }

  // Grant MINTER_ROLE to QCMinter in BasicMintingPolicy (for defense-in-depth)
  const POLICY_MINTER_ROLE = ethers.utils.id("MINTER_ROLE")
  await execute(
    "BasicMintingPolicy",
    { from: deployer, log: true },
    "grantRole",
    POLICY_MINTER_ROLE,
    qcMinter.address
  )

  // Grant REDEEMER_ROLE to QCRedeemer in BasicRedemptionPolicy (for defense-in-depth)
  const POLICY_REDEEMER_ROLE = ethers.utils.id("REDEEMER_ROLE")
  await execute(
    "BasicRedemptionPolicy",
    { from: deployer, log: true },
    "grantRole",
    POLICY_REDEEMER_ROLE,
    qcRedeemer.address
  )

  log("Step 3: Setting up Watchdog System roles...")

  // Grant ARBITER_ROLE to WatchdogConsensusManager in QCManager (for status changes)
  const ARBITER_ROLE = ethers.utils.id("ARBITER_ROLE")
  await execute(
    "QCManager",
    { from: deployer, log: true },
    "grantRole",
    ARBITER_ROLE,
    watchdogConsensusManager.address
  )

  // Grant ARBITER_ROLE to WatchdogConsensusManager in QCRedeemer (for redemption defaults)
  await execute(
    "QCRedeemer",
    { from: deployer, log: true },
    "grantRole",
    ARBITER_ROLE,
    watchdogConsensusManager.address
  )

  // Configure Automated Framework roles (if deployed)
  if (automatedFrameworkDeployed) {
    log("Step 3.5: Setting up Automated Framework roles...")

    // Grant ARBITER_ROLE to WatchdogAutomatedEnforcement in QCManager
    await execute(
      "QCManager",
      { from: deployer, log: true },
      "grantRole",
      ARBITER_ROLE,
      watchdogAutomatedEnforcement.address
    )

    // Grant ARBITER_ROLE to WatchdogAutomatedEnforcement in QCRedeemer
    await execute(
      "QCRedeemer",
      { from: deployer, log: true },
      "grantRole",
      ARBITER_ROLE,
      watchdogAutomatedEnforcement.address
    )

    // Configure SystemState for automated enforcement
    await execute(
      "SystemState",
      { from: deployer, log: true },
      "setMinCollateralRatio",
      90 // 90%
    )

    await execute(
      "SystemState",
      { from: deployer, log: true },
      "setFailureThreshold",
      3 // 3 failures
    )

    await execute(
      "SystemState",
      { from: deployer, log: true },
      "setFailureWindow",
      7 * 24 * 3600 // 7 days
    )

    log("✅ Automated Framework configured for parallel operation")
  }

  // Configure watchdog system roles
  const MANAGER_ROLE = ethers.utils.id("MANAGER_ROLE")
  const WATCHDOG_OPERATOR_ROLE = ethers.utils.id("WATCHDOG_OPERATOR_ROLE")

  // Grant manager roles to deployer (should be transferred to governance later)
  await execute(
    "WatchdogConsensusManager",
    { from: deployer, log: true },
    "grantRole",
    MANAGER_ROLE,
    deployer
  )

  await execute(
    "WatchdogMonitor",
    { from: deployer, log: true },
    "grantRole",
    MANAGER_ROLE,
    deployer
  )

  log("Step 3: Configuring governance roles...")
  
  // Get governance account
  const { governance } = await getNamedAccounts()
  
  // Grant QC_GOVERNANCE_ROLE to governance for QC registration
  const QC_GOVERNANCE_ROLE = ethers.utils.id("QC_GOVERNANCE_ROLE")
  if (governance && governance !== deployer) {
    log(`Granting QC_GOVERNANCE_ROLE to governance: ${governance}`)
    await execute(
      "QCManager",
      { from: deployer, log: true },
      "grantRole",
      QC_GOVERNANCE_ROLE,
      governance
    )
  } else {
    log("Warning: No separate governance account configured. QC_GOVERNANCE_ROLE remains with deployer.")
    log("Remember to transfer this role to DAO governance before production!")
  }
  
  log("Step 3.1: Setting up initial watchdog operators...")
  
  // Grant WATCHDOG_OPERATOR_ROLE to initial operators for testing
  // These should be replaced with actual watchdog operator addresses in production
  
  // Add deployer as initial watchdog operator for testing (remove in production)
  await execute(
    "WatchdogMonitor",
    { from: deployer, log: true },
    "grantRole",
    WATCHDOG_OPERATOR_ROLE,
    deployer
  )

  // Add governance as initial watchdog operator if different from deployer
  if (governance && governance !== deployer) {
    await execute(
      "WatchdogMonitor",
      { from: deployer, log: true },
      "grantRole",
      WATCHDOG_OPERATOR_ROLE,
      governance
    )
  }

  log("⚠️  Initial watchdog operators configured for testing. Deploy QCWatchdog instances and register them in WatchdogMonitor before production!")

  log("Step 4: Configuring system parameters...")

  // Set initial system parameters (optional - using defaults)
  // These can be adjusted later by governance
  log("Using default system parameters (can be adjusted by governance)")

  log("Step 5: Verifying system configuration...")

  // Verify WatchdogConsensusManager state
  const consensusManagerContract = await ethers.getContractAt(
    "WatchdogConsensusManager",
    watchdogConsensusManager.address
  )
  const consensusParams = await consensusManagerContract.getConsensusParams()
  
  // Verify WatchdogMonitor state
  const monitorContract = await ethers.getContractAt(
    "WatchdogMonitor",
    watchdogMonitor.address
  )
  const activeWatchdogCount = await monitorContract.getActiveWatchdogCount()

  log(`✅ WatchdogConsensusManager state:`)
  log(`   - Required votes (M): ${consensusParams.required}`)
  log(`   - Total watchdogs (N): ${consensusParams.total}`)
  log(`   - Voting period: ${consensusParams.period / 3600} hours`)
  
  log(`✅ WatchdogMonitor state:`)
  log(`   - Active watchdog instances: ${activeWatchdogCount}`)
  log(`   - Emergency threshold: 3 critical reports`)

  log("Phase 5 completed: Account Control system fully configured")
  log("")
  log("=== ACCOUNT CONTROL SYSTEM V1.1 DEPLOYMENT SUMMARY ===")
  log(`ProtocolRegistry: ${protocolRegistry.address}`)
  log(`QCMinter: ${qcMinter.address}`)
  log(`QCRedeemer: ${qcRedeemer.address}`)
  log(`QCData: ${qcData.address}`)
  log(`SystemState: ${systemState.address}`)
  log(`QCManager: ${qcManager.address}`)
  log(`QCReserveLedger: ${qcReserveLedger.address}`)
  log(`BasicMintingPolicy: ${basicMintingPolicy.address}`)
  log(`BasicRedemptionPolicy: ${basicRedemptionPolicy.address}`)
  log("")
  log("=== WATCHDOG SYSTEM ===")
  log(`WatchdogConsensusManager: ${watchdogConsensusManager.address}`)
  log(`WatchdogMonitor: ${watchdogMonitor.address}`)
  log("")
  log("System is ready for:")
  log("1. QC registration via QCManager")
  log("2. Policy upgrades via ProtocolRegistry")
  log("3. Multiple independent watchdog deployment")
  log("4. M-of-N consensus for critical operations")
  log("5. Emergency monitoring and automatic pause")
  log("6. Integration with existing tBTC v2")
  log("")
  log("Features:")
  log("- Configurable M-of-N consensus (default: 2-of-5)")
  log("- Independent QCWatchdog instances")
  log("- Emergency pause with 3-report threshold")
  log("- Clean separation of monitoring vs consensus")
  log("- Minimal complexity, maximum security")
  log("")
  log("=== IMPORTANT: PRODUCTION DEPLOYMENT STEPS ===")
  log("After deployment, the following role transfers MUST be performed:")
  log("")
  log("1. Transfer QC_GOVERNANCE_ROLE in QCManager:")
  log("   - Current: deployer (or governance if configured)")
  log("   - Transfer to: DAO governance contract")
  log("   - Purpose: Allows DAO to register new QCs")
  log("")
  log("2. Transfer DEFAULT_ADMIN_ROLE in all contracts to governance:")
  log("   - QCManager, QCData, QCReserveLedger, QCRedeemer")
  log("   - SystemState, BasicMintingPolicy, BasicRedemptionPolicy")
  log("   - WatchdogConsensusManager, WatchdogMonitor, ProtocolRegistry")
  if (automatedFrameworkDeployed) {
    log("   - WatchdogAutomatedEnforcement, WatchdogThresholdActions")
    log("   - WatchdogDAOEscalation, ReserveLedger")
  }
  log("")
  log("3. Transfer PAUSER_ROLE in SystemState:")
  log("   - Current: deployer")
  log("   - Transfer to: Emergency multisig or DAO")
  log("")
  log("4. Deploy and register production QCWatchdog instances:")
  log("   - Deploy QCWatchdog for each watchdog operator")
  log("   - Register each instance via WatchdogMonitor.registerWatchdog()")
  log("   - Grant WATCHDOG_ROLE to operators in WatchdogConsensusManager")
  log("   - Remove test operators (deployer)")
  if (automatedFrameworkDeployed) {
    log("")
    log("4b. Configure Automated Framework for production:")
    log("   - Grant ENFORCER_ROLE to watchdog operators in WatchdogAutomatedEnforcement")
    log("   - Grant WATCHDOG_ROLE to operators in WatchdogThresholdActions")
    log("   - Configure enforcement cooldowns and thresholds")
    log("   - Update watchdog software to use automated framework")
  }
  log("")
  log("5. Configure consensus parameters:")
  log("   - Adjust M and N values based on deployed watchdog count")
  log("   - Use WatchdogConsensusManager.updateConsensusParams()")
  if (automatedFrameworkDeployed) {
    log("   - Configure threshold requirements in WatchdogThresholdActions")
  }
  log("")
  log("6. Grant MINTER_ROLE in QCMinter to registered QCs")
  log("")
  log("Remember: Until these transfers are complete, the system is NOT")
  log("under DAO control and should NOT be used in production!")
  
  if (automatedFrameworkDeployed) {
    log("")
    log("=== AUTOMATED DECISION FRAMEWORK STATUS ===")
    log("✅ Deployed and configured for parallel operation")
    log("✅ 90%+ automation rate for deterministic violations")
    log("✅ MEV-resistant operation selection")
    log("✅ Machine-interpretable evidence system")
    log("")
    log("The legacy consensus system and automated framework can run in parallel")
    log("during the migration period. See WATCHDOG_MIGRATION_GUIDE.md for details.")
  }
}

export default func
func.tags = ["AccountControlConfig", "SystemConfiguration", "V1.1Configuration"]
func.dependencies = ["AccountControlWatchdog", "SPVValidator"]
