import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployAccountControlUnified(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, network, ethers } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log, get } = deployments

  log("=== Starting Account Control Unified Deployment ===")
  log(`Network: ${network.name}`)
  log(`Deployer: ${deployer}`)

  // Check for existing tBTC infrastructure
  let bank, tbtcVault, tbtc, lightRelay
  
  try {
    // Use the existing Bank contract
    bank = await get("Bank")
    
    tbtcVault = await get("TBTCVault")  
    tbtc = await get("TBTC")
    lightRelay = await get("LightRelay")
    
    log("Found existing tBTC infrastructure:")
    log(`  Bank: ${bank.address}`)
    log(`  TBTCVault: ${tbtcVault.address}`)
    log(`  TBTC: ${tbtc.address}`)
    log(`  LightRelay: ${lightRelay.address}`)
  } catch (error) {
    log("WARNING: Some tBTC contracts not found. Deploying mocks for testing...")
    // For testing, we can deploy mock contracts if needed
    // But for now, we'll require the core contracts to exist
    throw new Error("Core tBTC contracts must be deployed first")
  }

  // Phase 1: Deploy storage contracts (no dependencies)
  log("\n=== Phase 1: Storage Layer ===")
  
  const qcData = await deploy("QCData", {
    from: deployer,
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  log(`QCData deployed at: ${qcData.address}`)

  // Deploy SystemState with initial parameters
  const systemState = await deploy("SystemState", {
    from: deployer,
    args: [
      ethers.utils.parseUnits("0.001", 8), // minMintAmount: 0.001 BTC
      ethers.utils.parseUnits("100", 8),   // maxMintAmount: 100 BTC  
      259200,                               // redemptionTimeout: 72 hours
      500,                                  // defaultPenaltyBps: 5%
    ],
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  log(`SystemState deployed at: ${systemState.address}`)

  // Phase 2: Deploy libraries
  log("\n=== Phase 2: Libraries ===")
  
  const messageSigning = await deploy("MessageSigning", {
    from: deployer,
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  log(`MessageSigning library deployed at: ${messageSigning.address}`)

  const bitcoinAddressUtils = await deploy("BitcoinAddressUtils", {
    from: deployer,
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  log(`BitcoinAddressUtils library deployed at: ${bitcoinAddressUtils.address}`)

  // Phase 3: Deploy SPV libraries if needed
  log("\n=== Phase 3: SPV Libraries ===")
  
  const sharedSPVCore = await deploy("SharedSPVCore", {
    from: deployer,
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  log(`SharedSPVCore library deployed at: ${sharedSPVCore.address}`)

  const qcRedeemerSPV = await deploy("QCRedeemerSPV", {
    from: deployer,
    libraries: {
      SharedSPVCore: sharedSPVCore.address,
    },
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  log(`QCRedeemerSPV library deployed at: ${qcRedeemerSPV.address}`)

  // Phase 4: Deploy ReserveOracle (depends on QCData only)
  log("\n=== Phase 4: Reserve Oracle ===")
  
  const reserveOracle = await deploy("ReserveOracle", {
    from: deployer,
    args: [
      qcData.address,
      21600, // attestationWindow: 6 hours
      86400, // stalenessThreshold: 24 hours
    ],
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  log(`ReserveOracle deployed at: ${reserveOracle.address}`)

  // Phase 5: Deploy QCManager (depends on QCData, SystemState, ReserveOracle)
  log("\n=== Phase 5: Business Logic (QCManager) ===")
  
  const qcManager = await deploy("QCManager", {
    from: deployer,
    args: [
      qcData.address,
      systemState.address,
      reserveOracle.address,
    ],
    libraries: {
      MessageSigning: messageSigning.address,
    },
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  log(`QCManager deployed at: ${qcManager.address}`)

  // Phase 6: Deploy operational contracts
  log("\n=== Phase 6: Operational Contracts ===")
  
  const qcMinter = await deploy("QCMinter", {
    from: deployer,
    args: [
      bank.address,
      tbtcVault.address,
      tbtc.address,
      qcData.address,
      systemState.address,
      qcManager.address,
    ],
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  log(`QCMinter deployed at: ${qcMinter.address}`)

  // Note: QCMintHelper functionality now integrated into QCMinter
  // Auto-minting can be enabled via setAutoMintEnabled() governance call

  // Configure SPV parameters for QCRedeemer
  const txProofDifficultyFactor =
    network.name === "hardhat" ||
    network.name === "localhost" ||
    network.name === "development"
      ? 1 // Lower requirement for testing
      : 6 // Production requirement (6 confirmations)

  const qcRedeemer = await deploy("QCRedeemer", {
    from: deployer,
    args: [
      tbtc.address,
      qcData.address,
      systemState.address,
      lightRelay.address,
      txProofDifficultyFactor,
    ],
    libraries: {
      QCRedeemerSPV: qcRedeemerSPV.address,
    },
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  log(`QCRedeemer deployed at: ${qcRedeemer.address}`)

  // Phase 7: Deploy enforcement
  log("\n=== Phase 7: Enforcement (WatchdogEnforcer) ===")
  
  const watchdogEnforcer = await deploy("WatchdogEnforcer", {
    from: deployer,
    args: [
      qcManager.address,
      reserveOracle.address,
      2700, // violationDelay: 45 minutes
    ],
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  log(`WatchdogEnforcer deployed at: ${watchdogEnforcer.address}`)

  // Phase 8: Initial role configuration
  log("\n=== Phase 8: Role Configuration ===")
  
  try {
    // Grant QC_MANAGER_ROLE to QCManager for storage access
    const qcDataContract = await ethers.getContractAt("QCData", qcData.address)
    const QC_MANAGER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_MANAGER_ROLE"))
    await qcDataContract.grantRole(QC_MANAGER_ROLE, qcManager.address)
    log(`Granted QC_MANAGER_ROLE to QCManager`)

    // Grant storage access roles to operational contracts
    await qcDataContract.grantRole(QC_MANAGER_ROLE, qcMinter.address)
    await qcDataContract.grantRole(QC_MANAGER_ROLE, qcRedeemer.address)
    log(`Granted storage access to QCMinter and QCRedeemer`)

    // Enable auto-minting in QCMinter (consolidated functionality)
    const qcMinterContract = await ethers.getContractAt("QCMinter", qcMinter.address)
    const GOVERNANCE_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("GOVERNANCE_ROLE"))
    
    // Grant GOVERNANCE_ROLE to deployer temporarily for configuration
    await qcMinterContract.grantRole(GOVERNANCE_ROLE, deployer)
    await qcMinterContract.setAutoMintEnabled(true)
    log(`Enabled auto-minting in QCMinter`)

    // Authorize QCMinter in Bank (for testnet only)
    if (network.name !== "mainnet") {
      const bankContract = await ethers.getContractAt("Bank", bank.address)
      const bankOwner = await bankContract.owner()
      
      if (bankOwner.toLowerCase() === deployer.toLowerCase()) {
        await bankContract.setAuthorizedBalanceIncreaser(qcMinter.address, true)
        log(`Authorized QCMinter to increase Bank balances`)
      } else {
        log(`WARNING: Bank owned by ${bankOwner}, manual authorization required`)
      }
    }

  } catch (error) {
    log(`Warning: Could not configure roles automatically: ${error.message}`)
    log("Roles will need to be configured manually")
  }

  log("\n=== Account Control Deployment Complete ===")
  log("\nDeployed Contracts Summary:")
  log(`  QCData:           ${qcData.address}`)
  log(`  SystemState:      ${systemState.address}`)
  log(`  ReserveOracle:    ${reserveOracle.address}`)
  log(`  QCManager:        ${qcManager.address}`)
  log(`  QCMinter:         ${qcMinter.address}`)
  log(`  QCMintHelper:     ${qcMintHelper.address}`)
  log(`  QCRedeemer:       ${qcRedeemer.address}`)
  log(`  WatchdogEnforcer: ${watchdogEnforcer.address}`)
  log("\nLibraries:")
  log(`  MessageSigning:      ${messageSigning.address}`)
  log(`  BitcoinAddressUtils: ${bitcoinAddressUtils.address}`)
  log(`  SharedSPVCore:       ${sharedSPVCore.address}`)
  log(`  QCRedeemerSPV:       ${qcRedeemerSPV.address}`)
  
  log("\n✅ Deployment successful! Next steps:")
  log("1. Configure remaining roles using 99_configure_account_control_system.ts")
  log("2. Register qualified custodians")
  log("3. Set up attesters for ReserveOracle")
  log("4. Run integration tests")
  
  return true
}

export default func
func.tags = ["AccountControlUnified"]
// Dependencies: Requires either BankV2 or Bank, plus other core contracts
func.dependencies = ["TBTC", "TBTCVault", "LightRelay"]
// Note: Bank/BankV2 dependency is handled conditionally in the script