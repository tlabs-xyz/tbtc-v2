import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployAccountControl(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, network, ethers } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log, get } = deployments

  // Handle test networks with mock deployments
  // Note: sepolia removed from TEST_NETWORKS to allow environment variable configuration
  const TEST_NETWORKS = ["hardhat", "localhost", "goerli", "holesky", "development"]
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
    // Use environment variables for Sepolia deployment with validation
    const requiredEnvVars = [
      { name: "BANK_ADDRESS", value: process.env.BANK_ADDRESS },
      { name: "TBTC_VAULT_ADDRESS", value: process.env.TBTC_VAULT_ADDRESS },
      { name: "TBTC_ADDRESS", value: process.env.TBTC_ADDRESS },
      { name: "LIGHT_RELAY_ADDRESS", value: process.env.LIGHT_RELAY_ADDRESS }
    ]

    // Validate all required environment variables
    for (const envVar of requiredEnvVars) {
      if (!envVar.value || !ethers.utils.isAddress(envVar.value)) {
        throw new Error(`Invalid or missing environment variable ${envVar.name}: ${envVar.value}`)
      }
    }

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

  // Phase 5: Deploy QCPauseManager first, then QCManager
  log("\n=== Phase 5: Business Logic (QCPauseManager & QCManager) ===")

  // Deploy QCPauseManager first
  const qcPauseManager = await deploy("QCPauseManager", {
    from: deployer,
    args: [
      qcData.address,
      deployer, // Temporary QCManager address, will be updated after QCManager deployment
      deployer, // Admin address
      deployer  // Emergency role address
    ],
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  log(`QCPauseManager deployed at: ${qcPauseManager.address}`)

  // Ensure QCManagerLib library is available
  if (!qcManagerLib.address) {
    throw new Error("QCManagerLib library not deployed")
  }
  log(`Using QCManagerLib library at: ${qcManagerLib.address}`)

  let qcManager
  try {
    qcManager = await deploy("QCManager", {
      from: deployer,
      args: [
        qcData.address,
        systemState.address,
        reserveOracle.address,
        qcPauseManager.address,
      ],
      libraries: {
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
        QCManagerLib: qcManagerLib.address,
      },
    })
    const qcManagerContract = await QCManagerFactory.deploy(
      qcData.address,
      systemState.address,
      reserveOracle.address,
      qcPauseManager.address
    )
    await qcManagerContract.deployed()

    // Verify deployment was successful
    const deployedCode = await ethers.provider.getCode(qcManagerContract.address)
    if (deployedCode === "0x") {
      throw new Error("Alternative deployment failed - no code at deployed address")
    }

    log(`QCManager deployed at: ${qcManagerContract.address}`)

    // Save deployment for hardhat-deploy
    await deployments.save("QCManager", {
      address: qcManagerContract.address,
      abi: QCManagerFactory.interface.format("json") as any,
    })
    qcManager = { address: qcManagerContract.address }
  }

  // Setup access control between QCManager and QCPauseManager
  log("\n=== Setting up QCPauseManager Access Control ===")
  const pauseManagerContract = await ethers.getContractAt("QCPauseManager", qcPauseManager.address)
  
  // Grant QC_MANAGER_ROLE to the deployed QCManager
  const QC_MANAGER_ROLE = await pauseManagerContract.QC_MANAGER_ROLE()
  await pauseManagerContract.grantRole(QC_MANAGER_ROLE, qcManager.address)
  log(`Granted QC_MANAGER_ROLE to QCManager: ${qcManager.address}`)
  
  // Revoke temporary QC_MANAGER_ROLE from deployer
  await pauseManagerContract.revokeRole(QC_MANAGER_ROLE, deployer)
  log(`Revoked temporary QC_MANAGER_ROLE from deployer: ${deployer}`)

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
      SharedSPVCore: sharedSPVCore.address,
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
      reserveOracle.address,  // _reserveOracle (renamed for clarity in Phase 1)
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
    let governanceGranted = false
    try {
      await qcMinterContract.grantRole(GOVERNANCE_ROLE, deployer)
      log(`Granted GOVERNANCE_ROLE to deployer`)
      governanceGranted = true

      await qcMinterContract.setAutoMintEnabled(true)
      log(`Enabled auto-minting in QCMinter`)

      // SECURITY: Revoke temporary governance role from deployer
      await qcMinterContract.revokeRole(GOVERNANCE_ROLE, deployer)
      log(`Revoked temporary GOVERNANCE_ROLE from deployer`)
      governanceGranted = false
    } catch (roleError) {
      log(`Warning: Could not configure QCMinter auto-mint: ${roleError.message}`)
      log(`This can be configured manually later`)

      // Ensure cleanup even if configuration fails
      if (governanceGranted) {
        try {
          await qcMinterContract.revokeRole(GOVERNANCE_ROLE, deployer)
          log(`Cleaned up temporary GOVERNANCE_ROLE from deployer`)
        } catch (cleanupError) {
          log(`Warning: Could not revoke temporary GOVERNANCE_ROLE: ${cleanupError.message}`)
          log(`Manual revocation required for security`)
        }
      }
    }

    // Authorize QCMinter in Bank (for testnet only)
    // Additional protection: verify we're not on mainnet or mainnet fork
    const chainId = await ethers.provider.getNetwork().then(n => n.chainId)
    if (network.name !== "mainnet" && chainId !== 1) {
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

  // Phase 9: System Configuration 
  log("\n=== Phase 9: System Configuration ===")

  // Define role constants (updated with new role structure)
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero // OpenZeppelin standard admin
  const QC_MANAGER_ROLE = ethers.utils.id("QC_MANAGER_ROLE") // Internal storage access
  const MINTER_ROLE = ethers.utils.id("MINTER_ROLE") // Grant only to QCMinter contract
  const DISPUTE_ARBITER_ROLE = ethers.utils.id("DISPUTE_ARBITER_ROLE") // Handle disputes and enforcement
  const ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE") // Reserve attestations
  const EMERGENCY_ROLE = ethers.utils.id("EMERGENCY_ROLE") // Emergency pause/unpause
  const OPERATIONS_ROLE = ethers.utils.id("OPERATIONS_ROLE") // Non-critical parameter updates
  const ENFORCEMENT_ROLE = ethers.utils.id("ENFORCEMENT_ROLE") // Automated enforcement (WatchdogEnforcer)

  try {
    // Configure SystemState permissions
    const systemStateContract = await ethers.getContractAt("SystemState", systemState.address)
    await systemStateContract.grantRole(EMERGENCY_ROLE, watchdogEnforcer.address)
    log("✅ WatchdogEnforcer granted EMERGENCY_ROLE in SystemState")

    // Configure QCManager permissions
    const qcManagerContract = await ethers.getContractAt("QCManager", qcManager.address)
    await qcManagerContract.grantRole(ENFORCEMENT_ROLE, watchdogEnforcer.address)
    log("✅ WatchdogEnforcer granted ENFORCEMENT_ROLE in QCManager")

    // Configure ReserveOracle permissions
    const reserveOracleContract = await ethers.getContractAt("ReserveOracle", reserveOracle.address)
    await reserveOracleContract.grantRole(ATTESTER_ROLE, deployer)
    log("✅ Deployer granted initial ATTESTER_ROLE in ReserveOracle")

    // Set initial system parameters
    await systemStateContract.setMinMintAmount(ethers.utils.parseEther("0.01")) // 0.01 tBTC minimum
    await systemStateContract.setMaxMintAmount(ethers.utils.parseEther("1000")) // 1000 tBTC maximum
    await systemStateContract.setRedemptionTimeout(48 * 60 * 60) // 48 hours
    log("✅ System parameters configured")

    // Configure reserve attestation consensus parameters
    await reserveOracleContract.setConsensusThreshold(1) // Start with 1 attester
    log("✅ Reserve attestation consensus parameters configured (threshold: 1 attester)")
    log("⚠️  IMPORTANT: Increase threshold to 3 after granting ATTESTER_ROLE to all attesters")

  } catch (configError) {
    log(`Warning: Could not configure system automatically: ${configError.message}`)
    log("System configuration will need to be done manually")
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
  log(`  BitcoinAddressUtils: ${bitcoinAddressUtils.address}`)
  log(`  QCManagerLib:        ${qcManagerLib.address}`)
  log(`  SharedSPVCore:       ${sharedSPVCore.address}`)
  log(`  QCRedeemerSPV:       ${qcRedeemerSPV.address}`)
  
  log("\n==============================================")
  log("✅ Account Control Deployment and Configuration Complete!")
  log("==============================================")
  log("")
  log("System is ready for:")
  log("  1. QC registration via QCManager")
  log("  2. Minting via QCMinter (manual and automated)")
  log("  3. Redemption via QCRedeemer")
  log("  4. Reserve attestation via ReserveOracle")
  log("  5. Enforcement via WatchdogEnforcer")
  log("  6. Automated minting integrated in QCMinter")
  log("  7. Direct on-chain Bitcoin signature verification for wallet ownership")
  log("")
  log("Important next steps:")
  log("  - Grant actual attester addresses ATTESTER_ROLE in ReserveOracle")
  log("  - Submit governance proposal to authorize QCMinter in Bank (if needed)")
  log("  - Configure actual watchdog operators")
  log("  - Register qualified custodians")
  
  return true
}

export default func
func.id = "DeployAccountControl"
func.tags = ["AccountControl"]
// Dependencies: Optional for test networks, will use mocks if not available
func.dependencies = []
// Note: Dependencies are handled conditionally in the script for test networks

// Skip deployment if USE_EXTERNAL_DEPLOY=true and we're not explicitly running AccountControl tests
func.skip = async (hre: HardhatRuntimeEnvironment) => {
  // Skip if we're using external deployment and not explicitly deploying account control
  if (process.env.USE_EXTERNAL_DEPLOY === "true" && !process.env.DEPLOY_ACCOUNT_CONTROL) {
    return true
  }
  return false
}