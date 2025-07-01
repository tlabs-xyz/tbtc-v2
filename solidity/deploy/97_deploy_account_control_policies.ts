import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployAccountControlPolicies(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log, get } = deployments

  log("Deploying Account Control Policy Contract Layer...")

  // Phase 3: Policy Contract Layer
  log("Phase 3: Deploying Policy Contract Layer")

  const protocolRegistry = await get("ProtocolRegistry")

  // Deploy QCReserveLedger - Reserve attestation system
  const qcReserveLedger = await deploy("QCReserveLedger", {
    from: deployer,
    args: [protocolRegistry.address],
    log: true,
    waitConfirmations: helpers.network?.confirmations || 1,
  })

  // Deploy BasicMintingPolicy - Upgradeable minting policy
  const basicMintingPolicy = await deploy("BasicMintingPolicy", {
    from: deployer,
    args: [protocolRegistry.address],
    log: true,
    waitConfirmations: helpers.network?.confirmations || 1,
  })

  // Deploy BasicRedemptionPolicy - Upgradeable redemption policy
  const basicRedemptionPolicy = await deploy("BasicRedemptionPolicy", {
    from: deployer,
    args: [protocolRegistry.address],
    log: true,
    waitConfirmations: helpers.network?.confirmations || 1,
  })

  log("Phase 3 completed: Policy contract layer deployed")
  log(`QCReserveLedger: ${qcReserveLedger.address}`)
  log(`BasicMintingPolicy: ${basicMintingPolicy.address}`)
  log(`BasicRedemptionPolicy: ${basicRedemptionPolicy.address}`)
}

export default func
func.tags = [
  "AccountControlPolicies",
  "QCReserveLedger",
  "BasicMintingPolicy",
  "BasicRedemptionPolicy",
]
func.dependencies = ["AccountControlState"]
