import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployAccountControlCore(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log } = deployments

  log("Deploying Account Control Core Components...")

  // Phase 1: Core Contract Layer
  log("Phase 1: Deploying Core Contract Layer")

  // Deploy ProtocolRegistry - Central dynamic address book
  const protocolRegistry = await deploy("ProtocolRegistry", {
    from: deployer,
    log: true,
    waitConfirmations: helpers.network?.confirmations || 1,
  })

  // Deploy QCMinter - Stable entry point for minting
  const qcMinter = await deploy("QCMinter", {
    from: deployer,
    args: [protocolRegistry.address],
    log: true,
    waitConfirmations: helpers.network?.confirmations || 1,
  })

  // Deploy QCRedeemer - Stable entry point for redemption
  const qcRedeemer = await deploy("QCRedeemer", {
    from: deployer,
    args: [protocolRegistry.address],
    log: true,
    waitConfirmations: helpers.network?.confirmations || 1,
  })

  log("Phase 1 completed: Core contract layer deployed")
  log(`ProtocolRegistry: ${protocolRegistry.address}`)
  log(`QCMinter: ${qcMinter.address}`)
  log(`QCRedeemer: ${qcRedeemer.address}`)
}

export default func
func.tags = ["AccountControlCore", "ProtocolRegistry", "QCMinter", "QCRedeemer"]
func.dependencies = ["TBTC"] // Depends on existing tBTC token
