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
  const optimisticConsensus = await get("OptimisticWatchdogConsensus")
  const watchdogAdapter = await get("WatchdogAdapter")
  const tbtc = await get("TBTC")

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
  // V1.1 Watchdog Quorum System keys
  const WATCHDOG_CONSENSUS_KEY = ethers.utils.id("WATCHDOG_CONSENSUS")
  const OPERATION_EXECUTOR_KEY = ethers.utils.id("OPERATION_EXECUTOR")

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

  // Register V1.1 Watchdog Quorum System services
  await execute(
    "ProtocolRegistry",
    { from: deployer, log: true },
    "setService",
    WATCHDOG_CONSENSUS_KEY,
    optimisticConsensus.address
  )

  await execute(
    "ProtocolRegistry",
    { from: deployer, log: true },
    "setService",
    OPERATION_EXECUTOR_KEY,
    watchdogAdapter.address
  )

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

  log("Step 3: Setting up V1.1 Watchdog Quorum System roles...")

  // Grant roles to WatchdogAdapter in other contracts (maintains backward compatibility)
  const watchdogAdapterDeployment = await deployments.get("WatchdogAdapter")

  // Grant ATTESTER_ROLE to WatchdogAdapter in QCReserveLedger
  const ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE")
  await execute(
    "QCReserveLedger",
    { from: deployer, log: true },
    "grantRole",
    ATTESTER_ROLE,
    watchdogAdapterDeployment.address
  )

  // Grant REGISTRAR_ROLE to WatchdogAdapter in QCManager
  const REGISTRAR_ROLE = ethers.utils.id("REGISTRAR_ROLE")
  await execute(
    "QCManager",
    { from: deployer, log: true },
    "grantRole",
    REGISTRAR_ROLE,
    watchdogAdapterDeployment.address
  )

  // Grant ARBITER_ROLE to WatchdogAdapter in QCManager
  const ARBITER_ROLE = ethers.utils.id("ARBITER_ROLE")
  await execute(
    "QCManager",
    { from: deployer, log: true },
    "grantRole",
    ARBITER_ROLE,
    watchdogAdapterDeployment.address
  )

  // Grant ARBITER_ROLE to WatchdogAdapter in QCRedeemer
  await execute(
    "QCRedeemer",
    { from: deployer, log: true },
    "grantRole",
    ARBITER_ROLE,
    watchdogAdapterDeployment.address
  )

  // Configure consensus system roles
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
  const EMERGENCY_ROLE = ethers.utils.id("EMERGENCY_ROLE")
  const MANAGER_ROLE = ethers.utils.id("MANAGER_ROLE")

  // Grant emergency and manager roles to deployer (should be transferred to governance later)
  await execute(
    "OptimisticWatchdogConsensus",
    { from: deployer, log: true },
    "grantRole",
    EMERGENCY_ROLE,
    deployer
  )

  await execute(
    "OptimisticWatchdogConsensus",
    { from: deployer, log: true },
    "grantRole",
    MANAGER_ROLE,
    deployer
  )

  log("Step 3.1: Setting up initial watchdog set...")
  
  // Add initial watchdogs to the consensus system
  // These should be replaced with actual watchdog addresses in production
  const { governance } = await getNamedAccounts()
  
  // Add deployer as initial watchdog for testing (remove in production)
  await execute(
    "OptimisticWatchdogConsensus",
    { from: deployer, log: true },
    "addWatchdog",
    deployer
  )

  // Add governance as initial watchdog if different from deployer
  if (governance && governance !== deployer) {
    await execute(
      "OptimisticWatchdogConsensus",
      { from: deployer, log: true },
      "addWatchdog",
      governance
    )
  }

  log("⚠️  Initial watchdog set configured for testing. Update with production watchdogs before mainnet deployment!")

  log("Step 4: Configuring system parameters...")

  // Set initial system parameters (optional - using defaults)
  // These can be adjusted later by governance
  log("Using default system parameters (can be adjusted by governance)")

  log("Step 5: Verifying system configuration...")

  // Verify WatchdogAdapter is operational
  const watchdogAdapterContract = await ethers.getContractAt(
    "WatchdogAdapter",
    watchdogAdapterDeployment.address
  )
  const isOperational = await watchdogAdapterContract.isWatchdogOperational()

  if (isOperational) {
    log("✅ WatchdogAdapter is operational with all required roles")
  } else {
    log(
      "⚠️  WatchdogAdapter may not have all required roles - check configuration"
    )
  }

  // Verify OptimisticWatchdogConsensus state
  const consensusContract = await ethers.getContractAt(
    "OptimisticWatchdogConsensus",
    optimisticConsensus.address
  )
  const consensusState = await consensusContract.getConsensusState()
  const activeWatchdogs = await consensusContract.getActiveWatchdogs()

  log(`✅ OptimisticWatchdogConsensus state:`)
  log(`   - Active watchdogs: ${consensusState.activeWatchdogs}`)
  log(`   - Consensus threshold: ${consensusState.consensusThreshold}`)
  log(`   - Base challenge period: ${consensusState.baseChallengePeriod}s`)
  log(`   - Emergency pause: ${consensusState.emergencyPause}`)
  log(`   - Watchdog addresses: ${activeWatchdogs.join(", ")}`)

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
  log("=== V1.1 WATCHDOG QUORUM SYSTEM ===")
  log(`OptimisticWatchdogConsensus: ${optimisticConsensus.address}`)
  log(`WatchdogAdapter: ${watchdogAdapter.address}`)
  log("")
  log("System is ready for:")
  log("1. QC registration via QCManager")
  log("2. Policy upgrades via ProtocolRegistry")
  log("3. V1.1 Optimistic Watchdog Quorum operations")
  log("4. Backward compatibility with SingleWatchdog interface")
  log("5. Integration with existing tBTC v2")
  log("")
  log("V1.1 Features:")
  log("- Optimistic execution with challenge periods")
  log("- MEV-resistant primary validator selection")
  log("- Escalating consensus delays (1h→4h→12h→24h)")
  log("- Approval mechanism for disputed operations")
  log("- Emergency override capabilities")
  log("- Comprehensive security protections")
}

export default func
func.tags = ["AccountControlConfig", "SystemConfiguration", "V1.1Configuration"]
func.dependencies = ["AccountControlWatchdog"]
