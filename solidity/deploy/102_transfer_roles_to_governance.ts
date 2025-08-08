import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function TransferRolesToGovernance(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, ethers } = hre
  const { deployer, governance } = await getNamedAccounts()
  const { execute, get, log } = deployments

  log("=== TRANSFERRING ROLES TO GOVERNANCE ===")
  log("")

  // Check if governance is configured
  if (!governance || governance === deployer) {
    log("ERROR: No separate governance account configured!")
    log("Please configure a governance account in hardhat config before running this script.")
    return
  }

  log(`Transferring roles from deployer (${deployer}) to governance (${governance})...`)
  log("")

  // Step 1: Transfer QC_GOVERNANCE_ROLE in QCManager
  log("Step 1: Transferring QC_GOVERNANCE_ROLE in QCManager...")
  const QC_GOVERNANCE_ROLE = ethers.utils.id("QC_GOVERNANCE_ROLE")
  
  // First check if governance already has the role
  const qcManager = await ethers.getContract("QCManager")
  const governanceHasRole = await qcManager.hasRole(QC_GOVERNANCE_ROLE, governance)
  
  if (!governanceHasRole) {
    await execute(
      "QCManager",
      { from: deployer, log: true },
      "grantRole",
      QC_GOVERNANCE_ROLE,
      governance
    )
    log("✓ Granted QC_GOVERNANCE_ROLE to governance")
  } else {
    log("✓ Governance already has QC_GOVERNANCE_ROLE")
  }

  // Optionally revoke from deployer
  const deployerHasRole = await qcManager.hasRole(QC_GOVERNANCE_ROLE, deployer)
  if (deployerHasRole && deployer !== governance) {
    log("Revoking QC_GOVERNANCE_ROLE from deployer...")
    await execute(
      "QCManager",
      { from: deployer, log: true },
      "revokeRole",
      QC_GOVERNANCE_ROLE,
      deployer
    )
    log("✓ Revoked QC_GOVERNANCE_ROLE from deployer")
  }

  // Step 2: Transfer DEFAULT_ADMIN_ROLE in all contracts
  log("")
  log("Step 2: Transferring DEFAULT_ADMIN_ROLE in all contracts...")
  
  const contracts = [
    "QCManager",
    "QCData",
    "QCReserveLedger",
    "QCRedeemer",
    "SystemState",
    "BasicMintingPolicy",
    "BasicRedemptionPolicy",
    "WatchdogConsensus",
    "ProtocolRegistry",
    "QCMinter"
  ]

  const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000"

  for (const contractName of contracts) {
    try {
      const contract = await ethers.getContract(contractName)
      const governanceIsAdmin = await contract.hasRole(DEFAULT_ADMIN_ROLE, governance)
      
      if (!governanceIsAdmin) {
        log(`Granting DEFAULT_ADMIN_ROLE to governance in ${contractName}...`)
        await execute(
          contractName,
          { from: deployer, log: true },
          "grantRole",
          DEFAULT_ADMIN_ROLE,
          governance
        )
        log(`✓ Granted DEFAULT_ADMIN_ROLE to governance in ${contractName}`)
      } else {
        log(`✓ Governance already has DEFAULT_ADMIN_ROLE in ${contractName}`)
      }
    } catch (error) {
      log(`Warning: Could not process ${contractName}: ${error.message}`)
    }
  }

  // Step 3: Transfer PAUSER_ROLE in SystemState
  log("")
  log("Step 3: Transferring PAUSER_ROLE in SystemState...")
  const PAUSER_ROLE = ethers.utils.id("PAUSER_ROLE")
  const systemState = await ethers.getContract("SystemState")
  const governanceHasPauserRole = await systemState.hasRole(PAUSER_ROLE, governance)
  
  if (!governanceHasPauserRole) {
    await execute(
      "SystemState",
      { from: deployer, log: true },
      "grantRole",
      PAUSER_ROLE,
      governance
    )
    log("✓ Granted PAUSER_ROLE to governance")
  } else {
    log("✓ Governance already has PAUSER_ROLE")
  }

  // Step 4: Remind about watchdog configuration
  log("")
  log("Step 4: Watchdog Configuration Reminder")
  log("Remember to:")
  log("- Remove test watchdogs (deployer) from WatchdogConsensus")
  log("- Add production watchdog operator addresses")
  log("- Use WatchdogConsensus.addWatchdog() and removeWatchdog()")

  // Step 5: Remind about QC minter roles
  log("")
  log("Step 5: QC Minter Role Reminder")
  log("After registering QCs, grant them MINTER_ROLE in QCMinter:")
  log("- Use QCMinter.grantRole(MINTER_ROLE, qcAddress)")

  log("")
  log("=== ROLE TRANSFER SUMMARY ===")
  log("")
  log("Roles transferred to governance:")
  log("- QC_GOVERNANCE_ROLE in QCManager (can register QCs)")
  log("- DEFAULT_ADMIN_ROLE in all contracts (can manage roles)")
  log("- PAUSER_ROLE in SystemState (can pause operations)")
  log("")
  log("Next steps:")
  log("1. Governance should now revoke DEFAULT_ADMIN_ROLE from deployer")
  log("2. Configure production watchdogs")
  log("3. Register QCs and grant them MINTER_ROLE")
  log("")
  log("IMPORTANT: The deployer still has DEFAULT_ADMIN_ROLE!")
  log("Governance must revoke this role from deployer for full DAO control.")
}

export default func
func.tags = ["TransferRolesToGovernance", "ProductionSetup"]
func.dependencies = ["AccountControlConfig"]
func.skip = async (hre: HardhatRuntimeEnvironment) => {
  // Skip this in test/development environments
  const { getNamedAccounts } = hre
  const { governance, deployer } = await getNamedAccounts()
  
  // Skip if no separate governance account
  if (!governance || governance === deployer) {
    console.log("Skipping role transfer: No separate governance account configured")
    return true
  }
  
  // Only run this script manually in production
  return process.env.TRANSFER_ROLES_TO_GOVERNANCE !== "true"
}