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
    log(
      "Please configure a governance account in hardhat config before running this script."
    )
    return
  }

  log(
    `Transferring roles from deployer (${deployer}) to governance (${governance})...`
  )
  log("")

  // Step 1: Transfer GOVERNANCE_ROLE in QCManager
  log("Step 1: Transferring GOVERNANCE_ROLE in QCManager...")
  const GOVERNANCE_ROLE = ethers.utils.id("GOVERNANCE_ROLE")

  // First check if governance already has the role
  const qcManager = await get("QCManager")
  const qcManagerContract = await ethers.getContractAt(
    "QCManager",
    qcManager.address
  )
  const governanceHasRole = await qcManagerContract.hasRole(
    GOVERNANCE_ROLE,
    governance
  )

  if (!governanceHasRole) {
    await execute(
      "QCManager",
      { from: deployer, log: true },
      "grantRole",
      GOVERNANCE_ROLE,
      governance
    )
    log("✓ Granted GOVERNANCE_ROLE to governance")
  } else {
    log("✓ Governance already has GOVERNANCE_ROLE")
  }

  // Optionally revoke from deployer
  const deployerHasRole = await qcManagerContract.hasRole(
    GOVERNANCE_ROLE,
    deployer
  )
  if (deployerHasRole && deployer !== governance) {
    log("Revoking GOVERNANCE_ROLE from deployer...")
    await execute(
      "QCManager",
      { from: deployer, log: true },
      "revokeRole",
      GOVERNANCE_ROLE,
      deployer
    )
    log("✓ Revoked GOVERNANCE_ROLE from deployer")
  }

  // Step 2: Transfer DEFAULT_ADMIN_ROLE in all contracts
  log("")
  log("Step 2: Transferring DEFAULT_ADMIN_ROLE in all contracts...")

  const contracts = [
    "QCManager",
    "QCData",
    "ReserveOracle",
    "QCRedeemer",
    "SystemState",
    "WatchdogEnforcer",
    "QCMinter",
  ]

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000"

  // Process contracts sequentially to avoid race conditions in deployment
  // eslint-disable-next-line no-restricted-syntax
  for (let i = 0; i < contracts.length; i++) {
    const contractName = contracts[i]
    try {
      // eslint-disable-next-line no-await-in-loop
      const contractDeployment = await get(contractName)
      // eslint-disable-next-line no-await-in-loop
      const contract = await ethers.getContractAt(
        contractName,
        contractDeployment.address
      )
      // eslint-disable-next-line no-await-in-loop
      const governanceIsAdmin = await contract.hasRole(
        DEFAULT_ADMIN_ROLE,
        governance
      )

      if (!governanceIsAdmin) {
        log(`Granting DEFAULT_ADMIN_ROLE to governance in ${contractName}...`)
        // eslint-disable-next-line no-await-in-loop
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

  // Step 3: Transfer EMERGENCY_ROLE in SystemState
  log("")
  log("Step 3: Transferring EMERGENCY_ROLE in SystemState...")
  const EMERGENCY_ROLE = ethers.utils.id("EMERGENCY_ROLE")
  const systemStateDeployment = await get("SystemState")
  const systemState = await ethers.getContractAt(
    "SystemState",
    systemStateDeployment.address
  )
  const governanceHasEmergencyRole = await systemState.hasRole(
    EMERGENCY_ROLE,
    governance
  )

  if (!governanceHasEmergencyRole) {
    await execute(
      "SystemState",
      { from: deployer, log: true },
      "grantRole",
      EMERGENCY_ROLE,
      governance
    )
    log("✓ Granted EMERGENCY_ROLE to governance")
  } else {
    log("✓ Governance already has EMERGENCY_ROLE")
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
  log("- GOVERNANCE_ROLE in QCManager (can register QCs)")
  log("- DEFAULT_ADMIN_ROLE in all contracts (can manage roles)")
  log("- EMERGENCY_ROLE in SystemState (can pause operations)")
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
func.dependencies = ["AccountControl"]
func.skip = async (hre: HardhatRuntimeEnvironment) => {
  // Skip this in test/development environments
  const { getNamedAccounts } = hre
  const { governance, deployer } = await getNamedAccounts()

  // Skip if no separate governance account
  if (!governance || governance === deployer) {
    return true
  }

  // Only run this script manually in production
  return process.env.TRANSFER_ROLES_TO_GOVERNANCE !== "true"
}
