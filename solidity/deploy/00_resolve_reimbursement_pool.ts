import type {
  HardhatRuntimeEnvironment,
  HardhatNetworkConfig,
} from "hardhat/types"
import type { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, helpers, getNamedAccounts } = hre
  const { deploy, log } = deployments
  const { deployer } = await getNamedAccounts()

  const ReimbursementPool = await deployments.getOrNull("ReimbursementPool")

  if (ReimbursementPool && helpers.address.isValid(ReimbursementPool.address)) {
    log(`using existing ReimbursementPool at ${ReimbursementPool.address}`)
  } else if (
    !hre.network.tags.allowStubs ||
    (hre.network.config as HardhatNetworkConfig)?.forking?.enabled
  ) {
    throw new Error("deployed ReimbursementPool contract not found")
  } else {
    log("deploying ReimbursementPool stub")
    await deploy("ReimbursementPool", {
      contract: "ReimbursementPool",
      from: deployer,
      args: [100000, 1000000000000], // _staticGas: 100k, _maxGasPrice: 1000 gwei
      log: true,
      waitConfirmations: helpers.network?.confirmations || 1,
    })
  }
}

export default func

func.tags = ["ReimbursementPool"]
