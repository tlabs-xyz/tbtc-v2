import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  const Bridge = await deployments.get("Bridge")

  const BridgeGovernanceParameters = await deployments.deploy(
    "BridgeGovernanceParameters",
    {
      from: deployer,
      log: true,
      waitConfirmations: 1,
    }
  )

  const GOVERNANCE_DELAY = 604800 // 1 week

  const BridgeGovernance = await deploy("BridgeGovernance", {
    from: deployer,
    args: [Bridge.address, GOVERNANCE_DELAY],
    log: true,
    libraries: {
      BridgeGovernanceParameters: BridgeGovernanceParameters.address,
    },
    waitConfirmations: 1,
  })

  if (hre.network.tags.tenderly) {
    await hre.tenderly.verify({
      name: "BridgeGovernance",
      address: BridgeGovernance.address,
    })
  }
}

export default func

func.tags = ["BridgeGovernance"]
