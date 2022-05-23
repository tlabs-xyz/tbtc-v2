import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  // TODO: validate proxy bridge vs bridge implementation
  const Bridge = await deployments.get("Bridge")
  const BridgeGovernanceParameters = await deployments.deploy(
    "BridgeGovernanceParameters",
    {
      from: deployer,
      log: true,
    }
  )

  const GOVERNANCE_DELAY = 604800 // 1 week

  const BridgeGovernance = await deploy("BridgeGovernance", {
    contract:
      deployments.getNetworkName() === "hardhat"
        ? "BridgeGovernance"
        : undefined,
    from: deployer,
    args: [Bridge.address, GOVERNANCE_DELAY],
    log: true,
    libraries: {
      BridgeGovernanceParameters: BridgeGovernanceParameters.address,
    },
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
