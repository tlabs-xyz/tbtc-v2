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

  // Get all deployed contracts
  const qcMinter = await get("QCMinter")
  const qcRedeemer = await get("QCRedeemer")
  const qcData = await get("QCData")
  const systemState = await get("SystemState")
  const qcManager = await get("QCManager")
  const reserveOracle = await get("ReserveOracle")
  const watchdogEnforcer = await get("WatchdogEnforcer")
  const qcMintHelper = await get("QCMintHelper")
  const tbtc = await get("TBTC")
  const bank = await get("Bank")
  const bridge = await get("Bridge") // Need Bridge to check Bank ownership

  // Define role constants (updated with new role structure)
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero // OpenZeppelin standard admin
  const QC_MANAGER_ROLE = ethers.utils.id("QC_MANAGER_ROLE") // Internal storage access
  const MINTER_ROLE = ethers.utils.id("MINTER_ROLE") // Grant only to QCMinter contract
  const DISPUTE_ARBITER_ROLE = ethers.utils.id("DISPUTE_ARBITER_ROLE") // Handle disputes and enforcement
  const ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE") // Reserve attestations
  const EMERGENCY_ROLE = ethers.utils.id("EMERGENCY_ROLE") // Emergency pause/unpause
  const OPERATIONS_ROLE = ethers.utils.id("OPERATIONS_ROLE") // Non-critical parameter updates
  const ENFORCEMENT_ROLE = ethers.utils.id("ENFORCEMENT_ROLE") // Automated enforcement (WatchdogEnforcer)

  // Step 1: Configure QCData permissions
  log("Step 1: Configuring QCData permissions...")
  await execute(
    "QCData",
    { from: deployer, log: true },
    "grantRole",
    QC_MANAGER_ROLE,
    qcManager.address
  )
  log("✅ QCManager granted QC_MANAGER_ROLE in QCData")

  // Step 2: Configure SystemState permissions
  log("Step 2: Configuring SystemState permissions...")
  await execute(
    "SystemState",
    { from: deployer, log: true },
    "grantRole",
    EMERGENCY_ROLE,
    watchdogEnforcer.address
  )
  log("✅ WatchdogEnforcer granted EMERGENCY_ROLE in SystemState")

  // Step 3: Configure QCManager permissions
  log("Step 3: Configuring QCManager permissions...")
  await execute(
    "QCManager",
    { from: deployer, log: true },
    "grantRole",
    ENFORCEMENT_ROLE,
    watchdogEnforcer.address
  )
  log("✅ WatchdogEnforcer granted ENFORCEMENT_ROLE in QCManager")

  // Step 4: Configure ReserveOracle permissions
  log("Step 4: Configuring ReserveOracle permissions...")
  await execute(
    "ReserveOracle",
    { from: deployer, log: true },
    "grantRole",
    ATTESTER_ROLE,
    deployer // Initial attester, should be replaced with actual attesters
  )
  log("✅ Deployer granted initial ATTESTER_ROLE in ReserveOracle")

  // Step 5: Configure Bank authorization for QCMinter
  log("Step 5: Configuring Bank authorization...")
  try {
    // Get Bank contract instance
    const bankContract = await ethers.getContractAt("Bank", bank.address)
    
    // Check if QCMinter is already authorized
    const isAuthorized = await bankContract.authorizedBalanceIncreasers(
      qcMinter.address
    )

    if (!isAuthorized) {
      log("QCMinter not yet authorized in Bank")
      
      // Check who owns Bank to determine authorization approach
      const bankOwner = await bankContract.owner()
      log(`Bank owner: ${bankOwner}`)
      
      // Get Bridge address to check if it owns Bank
      const bridgeAddress = bridge.address
      log(`Bridge address: ${bridgeAddress}`)
      
      if (bankOwner === bridgeAddress) {
        log("Bank is owned by Bridge - governance action required")
        log("")
        log("⚠️  CRITICAL: Manual governance action required!")
        log("Submit governance proposal with the following transaction:")
        log(`  Contract: Bank (${bank.address})`)
        log(`  Function: setAuthorizedBalanceIncreaser`)
        log(`  Parameters: ${qcMinter.address}, true`)
        log("")
        log("Without this authorization, QCMinter cannot create Bank balances!")
      } else if (bankOwner === deployer) {
        // In test/development environment, deployer might own Bank
        log("Bank owned by deployer - attempting direct authorization...")
        await execute(
          "Bank",
          { from: deployer, log: true },
          "setAuthorizedBalanceIncreaser",
          qcMinter.address,
          true
        )
        log("✅ QCMinter authorized in Bank")
      } else {
        log(`Bank owned by: ${bankOwner}`)
        log("Manual authorization required from Bank owner")
        log(`Execute: bank.setAuthorizedBalanceIncreaser(${qcMinter.address}, true)`)
      }
    } else {
      log("✅ QCMinter already authorized in Bank")
    }
  } catch (error) {
    log("Error checking Bank authorization:")
    log(error.message || error)
    log("Manual verification and authorization required")
  }

  // Step 6: Configure TBTC token permissions for QCRedeemer
  log("Step 6: Checking TBTC burn permissions...")
  log("Note: QCRedeemer needs users to approve TBTC spending before redemption")

  // Step 7: Set initial system parameters
  log("Step 7: Setting initial system parameters...")
  await execute(
    "SystemState",
    { from: deployer, log: true },
    "setMinMintAmount",
    ethers.utils.parseEther("0.01") // 0.01 tBTC minimum
  )
  await execute(
    "SystemState",
    { from: deployer, log: true },
    "setMaxMintAmount",
    ethers.utils.parseEther("1000") // 1000 tBTC maximum
  )
  await execute(
    "SystemState",
    { from: deployer, log: true },
    "setRedemptionTimeout",
    48 * 60 * 60 // 48 hours
  )

  // Step 8: Configure reserve attestation consensus parameters
  log("Step 8: Configuring reserve attestation parameters...")
  await execute(
    "ReserveOracle",
    { from: deployer, log: true },
    "setConsensusThreshold",
    3 // Require 3 attester confirmations for reserve balance attestations
  )
  log(
    "✅ Reserve attestation consensus parameters configured (threshold: 3 attesters)"
  )

  // Step 9: Configure QCMintHelper in QCMinter
  log("Step 9: Configuring QCMintHelper integration...")
  await execute(
    "QCMinter",
    { from: deployer, log: true },
    "setMintHelper",
    qcMintHelper.address
  )
  log(`✅ QCMintHelper configured in QCMinter: ${qcMintHelper.address}`)

  log("✅ System parameters configured")

  log("")
  log("==============================================")
  log("✅ Account Control System Configuration Complete!")
  log("==============================================")
  log("")
  log("System is ready for:")
  log("  1. QC registration via QCManager")
  log("  2. Minting via QCMinter (manual and automated)")
  log("  3. Redemption via QCRedeemer")
  log("  4. Reserve attestation via ReserveOracle")
  log("  5. Enforcement via WatchdogEnforcer")
  log("  6. Automated minting via QCMintHelper")
  log(
    "  7. Direct on-chain Bitcoin signature verification for wallet ownership"
  )
  log("")
  log("Important next steps:")
  log("  - Grant actual attester addresses ATTESTER_ROLE in ReserveOracle")
  log("  - Submit governance proposal to authorize QCMinter in Bank")
  log("  - Configure actual watchdog operators")
  log("")
}

export default func
func.tags = ["ConfigureAccountControl"]
func.dependencies = [
  "AccountControlCore",
  "AccountControlState", 
  "ReserveOracle",
  "WatchdogEnforcer",
  "QCMintHelper",
]
