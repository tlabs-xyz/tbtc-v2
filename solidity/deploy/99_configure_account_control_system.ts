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
  const tbtc = await get("TBTC")
  const bank = await get("Bank")




  // Define role constants
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
  const QC_MANAGER_ROLE = ethers.utils.id("QC_MANAGER_ROLE")
  const MINTER_ROLE = ethers.utils.id("MINTER_ROLE")
  const REDEEMER_ROLE = ethers.utils.id("REDEEMER_ROLE")
  const ARBITER_ROLE = ethers.utils.id("ARBITER_ROLE")
  const ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE")
  const PAUSER_ROLE = ethers.utils.id("PAUSER_ROLE")
  const PARAMETER_ADMIN_ROLE = ethers.utils.id("PARAMETER_ADMIN_ROLE")
  const WATCHDOG_ENFORCER_ROLE = ethers.utils.id("WATCHDOG_ENFORCER_ROLE")

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
    PAUSER_ROLE,
    watchdogEnforcer.address
  )
  log("✅ WatchdogEnforcer granted PAUSER_ROLE in SystemState")

  // Step 3: Configure QCManager permissions
  log("Step 3: Configuring QCManager permissions...")
  await execute(
    "QCManager",
    { from: deployer, log: true },
    "grantRole",
    ARBITER_ROLE,
    watchdogEnforcer.address
  )
  log("✅ WatchdogEnforcer granted ARBITER_ROLE in QCManager")

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
    // Check if QCMinter is already authorized
    const isAuthorized = await hre.ethers.provider.call({
      to: bank.address,
      data: ethers.utils.defaultAbiCoder.encode(
        ["bytes4", "address"],
        [
          ethers.utils.id("authorizedBalanceIncreasers(address)").slice(0, 10),
          qcMinter.address,
        ]
      ),
    })

    if (
      !isAuthorized ||
      isAuthorized ===
        "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      log("QCMinter not yet authorized in Bank, requires governance action")
      log("TODO: Submit governance proposal to authorize QCMinter in Bank")
    } else {
      log("✅ QCMinter already authorized in Bank")
    }
  } catch (error) {
    log("Could not check Bank authorization, manual verification needed")
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
  log("✅ Reserve attestation consensus parameters configured (threshold: 3 attesters)")

  log("✅ System parameters configured")

  log("")
  log("==============================================")
  log("✅ Account Control System Configuration Complete!")
  log("==============================================")
  log("")
  log("System is ready for:")
  log("  1. QC registration via QCManager")
  log("  2. Minting via QCMinter")
  log("  3. Redemption via QCRedeemer")
  log("  4. Reserve attestation via ReserveOracle")
  log("  5. Enforcement via WatchdogEnforcer")
  log("  6. Direct on-chain Bitcoin signature verification for wallet ownership")
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
]
