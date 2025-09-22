import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployAccountControlUnified(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, network, ethers } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log, get } = deployments

  // Handle test networks with mock deployments
  const TEST_NETWORKS = ["hardhat", "localhost", "sepolia", "goerli", "holesky", "development"]
  const isTestNetwork = TEST_NETWORKS.includes(network.name)

  if (isTestNetwork) {
    log("=== Deploying Account Control for Test Network ===")
    log("Using mock/minimal infrastructure for testing")
  }

  log("=== Starting Account Control Unified Deployment ===")
  log(`Network: ${network.name}`)
  log(`Deployer: ${deployer}`)

  // Check for existing tBTC infrastructure
  let bank, tbtcVault, tbtc, lightRelay

  if (isTestNetwork) {
    // For test networks, use mock contracts that should be deployed by test infrastructure
    try {
      // Try to use mock contracts first
      bank = await get("Bank")
      tbtcVault = await get("TBTCVault")
      tbtc = await get("TBTC")
      lightRelay = await get("LightRelay")

      log("Using existing test infrastructure:")
      log(`  Bank: ${bank.address}`)
      log(`  TBTCVault: ${tbtcVault.address}`)
      log(`  TBTC: ${tbtc.address}`)
      log(`  LightRelay: ${lightRelay.address}`)
    } catch (error) {
      // If mocks don't exist, deploy minimal mocks for testing
      log("WARNING: tBTC contracts not found. Deploying minimal mocks for testing...")

      // Deploy minimal mock contracts
      bank = await deploy("MockBank", {
        from: deployer,
        args: [],
        log: true,
      })

      tbtcVault = await deploy("MockTBTCVault", {
        from: deployer,
        contract: "contracts/test/MockTBTCVault.sol:MockTBTCVault",
        args: [],
        log: true,
      })

      tbtc = await deploy("MockTBTCToken", {
        from: deployer,
        args: [],
        log: true,
      })

      lightRelay = await deploy("LightRelayStub", {
        from: deployer,
        args: [],
        log: true,
      })

      log("Deployed mock infrastructure:")
      log(`  MockBank: ${bank.address}`)
      log(`  MockTBTCVault: ${tbtcVault.address}`)
      log(`  MockTBTCToken: ${tbtc.address}`)
      log(`  LightRelayStub: ${lightRelay.address}`)
    }
  } else if (network.name === "sepolia" && process.env.BANK_ADDRESS) {
    // Use environment variables for Sepolia deployment
    bank = { address: process.env.BANK_ADDRESS }
    tbtcVault = { address: process.env.TBTC_VAULT_ADDRESS }
    tbtc = { address: process.env.TBTC_ADDRESS }
    lightRelay = { address: process.env.LIGHT_RELAY_ADDRESS }

    log("Using tBTC infrastructure from environment variables:")
    log(`  Bank: ${bank.address}`)
    log(`  TBTCVault: ${tbtcVault.address}`)
    log(`  TBTC: ${tbtc.address}`)
    log(`  LightRelay: ${lightRelay.address}`)
  } else {
    try {
      // Try to use the existing contracts from hardhat-deploy cache
      bank = await get("Bank")
      tbtcVault = await get("TBTCVault")
      tbtc = await get("TBTC")
      lightRelay = await get("LightRelay")

      log("Found existing tBTC infrastructure in deployment cache:")
      log(`  Bank: ${bank.address}`)
      log(`  TBTCVault: ${tbtcVault.address}`)
      log(`  TBTC: ${tbtc.address}`)
      log(`  LightRelay: ${lightRelay.address}`)
    } catch (error) {
      log("ERROR: tBTC contracts not found and not in test environment.")
      throw new Error("Core tBTC contracts must be deployed first. Set environment variables for production networks.")
    }
  }

  // Phase 1: Deploy storage contracts (no dependencies)
  log("\n=== Phase 1: Storage Layer ===")
  
  const qcData = await deploy("QCData", {
    from: deployer,
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  log(`QCData deployed at: ${qcData.address}`)

  // Deploy SystemState (no constructor arguments - uses defaults)
  const systemState = await deploy("SystemState", {
    from: deployer,
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

  const qcManagerLib = await deploy("QCManagerLib", {
    from: deployer,
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  log(`QCManagerLib library deployed at: ${qcManagerLib.address}`)

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
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  log(`ReserveOracle deployed at: ${reserveOracle.address}`)

  // Phase 5: Deploy QCManager (depends on QCData, SystemState, ReserveOracle)
  log("\n=== Phase 5: Business Logic (QCManager) ===")

  // Ensure MessageSigning library is available
  if (!messageSigning.address) {
    throw new Error("MessageSigning library not deployed")
  }
  log(`Using MessageSigning library at: ${messageSigning.address}`)

  let qcManager
  try {
    qcManager = await deploy("QCManager", {
      from: deployer,
      args: [
        qcData.address,
        systemState.address,
        reserveOracle.address,
      ],
      libraries: {
        MessageSigning: messageSigning.address,
        QCManagerLib: qcManagerLib.address,
      },
      log: true,
      waitConfirmations: network.live ? 5 : 1,
      skipIfAlreadyDeployed: false,
    })
    log(`QCManager deployed at: ${qcManager.address}`)
  } catch (error: any) {
    log(`Error deploying QCManager: ${error.message}`)
    if (process.env.DEBUG) {
      log(`Stack trace: ${error.stack}`)
    }
    // Try alternative deployment method for large contracts
    log("Attempting alternative deployment method...")
    const QCManagerFactory = await ethers.getContractFactory("QCManager", {
      libraries: {
        MessageSigning: messageSigning.address,
        QCManagerLib: qcManagerLib.address,
      },
    })
    const qcManagerContract = await QCManagerFactory.deploy(
      qcData.address,
      systemState.address,
      reserveOracle.address
    )
    await qcManagerContract.deployed()
    log(`QCManager deployed at: ${qcManagerContract.address}`)

    // Save deployment for hardhat-deploy
    await deployments.save("QCManager", {
      address: qcManagerContract.address,
      abi: QCManagerFactory.interface.format("json") as any,
    })
    qcManager = { address: qcManagerContract.address }
  }

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
      reserveOracle.address,  // _reserveLedger (ReserveOracle)
      qcManager.address,      // _qcManager
      qcData.address,         // _qcData
      systemState.address,    // _systemState
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
    try {
      await qcMinterContract.grantRole(GOVERNANCE_ROLE, deployer)
      log(`Granted GOVERNANCE_ROLE to deployer`)

      await qcMinterContract.setAutoMintEnabled(true)
      log(`Enabled auto-minting in QCMinter`)
    } catch (roleError) {
      log(`Warning: Could not configure QCMinter auto-mint: ${roleError.message}`)
      log(`This can be configured manually later`)
    }

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
  log(`  QCRedeemer:       ${qcRedeemer.address}`)
  log(`  WatchdogEnforcer: ${watchdogEnforcer.address}`)
  log("\nLibraries:")
  log(`  MessageSigning:      ${messageSigning.address}`)
  log(`  BitcoinAddressUtils: ${bitcoinAddressUtils.address}`)
  log(`  QCManagerLib:        ${qcManagerLib.address}`)
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
func.id = "DeployAccountControlUnified"
func.tags = ["AccountControlUnified"]
// Dependencies: Optional for test networks, will use mocks if not available
func.dependencies = []
// Note: Dependencies are handled conditionally in the script for test networks