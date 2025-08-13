import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployAccountControlCore(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, network } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log } = deployments

  log("Deploying Account Control Core Components...")

  // Phase 1: Core Contract Layer with Direct Injection
  log("Phase 1: Deploying Core Contract Layer")

  // Deploy SPV libraries first
  log("Deploying SPV libraries...")
  
  const sharedSPVCore = await deploy("SharedSPVCore", {
    from: deployer,
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  
  const qcManagerSPV = await deploy("QCManagerSPV", {
    from: deployer,
    libraries: {
      SharedSPVCore: sharedSPVCore.address,
    },
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })
  
  const qcRedeemerSPV = await deploy("QCRedeemerSPV", {
    from: deployer,
    libraries: {
      SharedSPVCore: sharedSPVCore.address,
    },
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })

  // Get dependencies from previously deployed state contracts
  const qcData = await deployments.get("QCData")
  const systemState = await deployments.get("SystemState")
  const qcManager = await deployments.get("QCManager")

  // Get existing tBTC infrastructure for direct injection
  const bank = await deployments.get("Bank")
  const tbtcVault = await deployments.get("TBTCVault")
  const tbtc = await deployments.get("TBTC")
  const lightRelay = await deployments.get("LightRelay")

  // Configure SPV parameters based on network
  const txProofDifficultyFactor =
    network.name === "hardhat" ||
    network.name === "development" ||
    network.name === "system_tests"
      ? 1 // Lower requirement for testing
      : 6 // Production requirement (6 confirmations)

  // Deploy QCMinter - Direct injection pattern
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

  // Deploy QCRedeemer - Direct injection pattern with SPV support
  const qcRedeemer = await deploy("QCRedeemer", {
    from: deployer,
    libraries: {
      QCRedeemerSPV: qcRedeemerSPV.address,
    },
    args: [
      tbtc.address,
      qcData.address,
      systemState.address,
      lightRelay.address,
      txProofDifficultyFactor,
    ],
    log: true,
    waitConfirmations: network.live ? 5 : 1,
  })

  log("Phase 1 completed: Core contract layer deployed with direct injection")
  log(`QCMinter: ${qcMinter.address}`)
  log(`QCRedeemer: ${qcRedeemer.address}`)
}

export default func
func.tags = ["AccountControlCore", "QCMinter", "QCRedeemer"]
func.dependencies = [
  "Bank",
  "TBTCVault",
  "TBTC",
  "LightRelay",
  "AccountControlState",
] // Depends on existing tBTC infrastructure, light relay, and state contracts
