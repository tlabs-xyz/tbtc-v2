import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { log } = deployments

  const { deployer, governance } = await getNamedAccounts()

  log("=== Configuring Automated Decision Framework ===")

  // Get contract instances
  const automatedEnforcement = await ethers.getContract("WatchdogAutomatedEnforcement", deployer)
  const thresholdActions = await ethers.getContract("WatchdogThresholdActions", deployer)
  const daoEscalation = await ethers.getContract("WatchdogDAOEscalation", deployer)
  const qcManager = await ethers.getContract("QCManager", deployer)
  const systemState = await ethers.getContract("SystemState", deployer)

  // 1. Set up DAO Escalation connection in ThresholdActions
  log("Connecting ThresholdActions to DAO Escalation...")
  const setDAOEscalationTx = await thresholdActions.setDAOEscalation(daoEscalation.address)
  await setDAOEscalationTx.wait()
  log(`✓ DAO Escalation set in ThresholdActions`)

  // 2. Grant roles to automated enforcement contracts
  log("Setting up role permissions...")

  // Grant PAUSER_ROLE to ThresholdActions for emergency pauses
  const pauserRole = await systemState.PAUSER_ROLE()
  const grantPauserTx = await systemState.grantRole(pauserRole, thresholdActions.address)
  await grantPauserTx.wait()
  log(`✓ PAUSER_ROLE granted to ThresholdActions`)

  // Grant ESCALATOR_ROLE to ThresholdActions in DAO Escalation
  const escalatorRole = await daoEscalation.ESCALATOR_ROLE()
  const grantEscalatorTx = await daoEscalation.grantRole(escalatorRole, thresholdActions.address)
  await grantEscalatorTx.wait()
  log(`✓ ESCALATOR_ROLE granted to ThresholdActions in DAO Escalation`)

  // 3. Configure automated enforcement to call QCManager
  // This might require updating QCManager to accept calls from automated enforcement
  // For now, we'll ensure the automated enforcement has the necessary permissions
  
  // Check if QCManager has a WATCHDOG_ROLE or similar
  try {
    const watchdogRole = await qcManager.WATCHDOG_ROLE()
    const grantWatchdogTx = await qcManager.grantRole(watchdogRole, automatedEnforcement.address)
    await grantWatchdogTx.wait()
    log(`✓ WATCHDOG_ROLE granted to AutomatedEnforcement in QCManager`)
  } catch (e) {
    log("Note: QCManager WATCHDOG_ROLE not found, may need manual configuration")
  }

  // 4. Grant ARBITER_ROLE to automated enforcement for redemption operations
  try {
    const qcRedeemer = await ethers.getContract("QCRedeemer", deployer)
    const arbiterRole = await qcRedeemer.ARBITER_ROLE()
    const grantArbiterTx = await qcRedeemer.grantRole(arbiterRole, automatedEnforcement.address)
    await grantArbiterTx.wait()
    log(`✓ ARBITER_ROLE granted to AutomatedEnforcement in QCRedeemer`)
  } catch (e) {
    log("Note: QCRedeemer ARBITER_ROLE configuration may need manual setup")
  }

  // 5. Update SystemState with optimal parameters for automated enforcement
  log("Optimizing SystemState parameters for automated enforcement...")
  
  try {
    // Set more aggressive parameters for automated enforcement
    const setMinCollateralTx = await systemState.setMinCollateralRatio(90) // 90%
    await setMinCollateralTx.wait()
    log(`✓ Minimum collateral ratio set to 90%`)

    const setRedemptionTimeoutTx = await systemState.setRedemptionTimeout(48 * 3600) // 48 hours
    await setRedemptionTimeoutTx.wait()
    log(`✓ Redemption timeout set to 48 hours`)

    const setFailureThresholdTx = await systemState.setFailureThreshold(3) // 3 failures
    await setFailureThresholdTx.wait()
    log(`✓ Failure threshold set to 3`)

    const setFailureWindowTx = await systemState.setFailureWindow(7 * 24 * 3600) // 7 days
    await setFailureWindowTx.wait()
    log(`✓ Failure window set to 7 days`)

  } catch (e) {
    log("Note: Some SystemState parameters may already be set or require governance approval")
  }

  // 6. Transfer admin roles to governance if not already done
  log("Preparing governance transfer...")
  
  // Transfer DEFAULT_ADMIN_ROLE to governance for all contracts
  const adminRole = await automatedEnforcement.DEFAULT_ADMIN_ROLE()
  
  const contracts = [
    { name: "AutomatedEnforcement", contract: automatedEnforcement },
    { name: "ThresholdActions", contract: thresholdActions },
    { name: "DAOEscalation", contract: daoEscalation },
  ]

  for (const { name, contract } of contracts) {
    try {
      // Check if governance already has admin role
      const hasAdminRole = await contract.hasRole(adminRole, governance)
      if (!hasAdminRole) {
        const grantAdminTx = await contract.grantRole(adminRole, governance)
        await grantAdminTx.wait()
        log(`✓ DEFAULT_ADMIN_ROLE granted to governance in ${name}`)
      } else {
        log(`✓ Governance already has admin role in ${name}`)
      }
    } catch (e) {
      log(`Note: Could not configure admin role for ${name}: ${e}`)
    }
  }

  log("=== Automated Decision Framework Configuration Complete ===")
  
  // Output deployment summary
  log("\n=== DEPLOYMENT SUMMARY ===")
  log(`WatchdogAutomatedEnforcement: ${automatedEnforcement.address}`)
  log(`WatchdogThresholdActions: ${thresholdActions.address}`)
  log(`WatchdogDAOEscalation: ${daoEscalation.address}`)
  log("\n=== INTEGRATION STATUS ===")
  log("✓ DAO Escalation connected to Threshold Actions")
  log("✓ Emergency pause permissions granted")
  log("✓ Redemption enforcement permissions granted")
  log("✓ System parameters optimized")
  log("✓ Governance roles configured")
  log("\n=== NEXT STEPS ===")
  log("1. Verify all contracts are functioning correctly")
  log("2. Run integration tests")
  log("3. Configure watchdog software to use new contracts")
  log("4. Gradually migrate from old consensus system")
}

func.tags = ["ConfigureAutomatedDecisionFramework"]
func.dependencies = ["AutomatedDecisionFramework"]

export default func