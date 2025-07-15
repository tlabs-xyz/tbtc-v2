import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers } from "hardhat"

const func: DeployFunction = async function ConfigureWatchdogOperators(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments } = hre
  const { deployer, governance } = await getNamedAccounts()
  const { log, execute } = deployments

  log("Configuring V1.1 Watchdog Operators...")

  // Get deployed contracts
  const watchdogAdapter = await deployments.get("WatchdogAdapter")

  // Define role constants
  const WATCHDOG_OPERATOR_ROLE = ethers.utils.id("WATCHDOG_OPERATOR_ROLE")
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero

  log("Step 1: Setting up WatchdogAdapter roles...")

  // Grant WATCHDOG_OPERATOR_ROLE to deployer for testing
  await execute(
    "WatchdogAdapter",
    { from: deployer, log: true },
    "grantRole",
    WATCHDOG_OPERATOR_ROLE,
    deployer
  )

  // Grant WATCHDOG_OPERATOR_ROLE to governance if different from deployer
  if (governance && governance !== deployer) {
    await execute(
      "WatchdogAdapter",
      { from: deployer, log: true },
      "grantRole",
      WATCHDOG_OPERATOR_ROLE,
      governance
    )
  }

  log("Step 2: Setting up system contract roles...")

  // Setup watchdog roles in system contracts
  await execute(
    "WatchdogAdapter",
    { from: deployer, log: true },
    "setupWatchdogRoles"
  )

  log("Step 3: Verifying operator configuration...")

  // Verify configuration
  const watchdogAdapterContract = await ethers.getContractAt(
    "WatchdogAdapter",
    watchdogAdapter.address
  )

  const hasOperatorRole = await watchdogAdapterContract.hasRole(
    WATCHDOG_OPERATOR_ROLE,
    deployer
  )
  const hasAdminRole = await watchdogAdapterContract.hasRole(
    DEFAULT_ADMIN_ROLE,
    deployer
  )

  if (hasOperatorRole && hasAdminRole) {
    log("✅ WatchdogAdapter roles configured successfully")
  } else {
    log("⚠️  WatchdogAdapter role configuration may be incomplete")
  }

  log("Configuration completed!")
  log("")
  log("⚠️  IMPORTANT NOTES:")
  log("1. Current watchdog operators are configured for testing")
  log("2. Before mainnet deployment, replace with production watchdog addresses")
  log("3. Consider using a multisig for governance roles")
  log("4. Test all watchdog operations before production deployment")
  log("")
  log("Next steps:")
  log("1. Add production watchdog addresses to OptimisticWatchdogConsensus")
  log("2. Grant WATCHDOG_OPERATOR_ROLE to production operators")
  log("3. Transfer admin roles to governance multisig")
  log("4. Test reserve attestations and redemption operations")
}

export default func
func.tags = ["WatchdogOperators", "V1.1Operators"]
func.dependencies = ["AccountControlConfig"]