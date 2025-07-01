import type {
  HardhatRuntimeEnvironment,
  HardhatNetworkConfig,
} from "hardhat/types"
import type { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function ResolveWalletRegistry(
  hre: HardhatRuntimeEnvironment
) {
  const { deployments, helpers, getNamedAccounts } = hre
  const { deploy, log } = deployments
  const { deployer } = await getNamedAccounts()

  const WalletRegistry = await deployments.getOrNull("WalletRegistry")

  if (WalletRegistry && helpers.address.isValid(WalletRegistry.address)) {
    log(`using existing WalletRegistry at ${WalletRegistry.address}`)
  } else if (
    !hre.network.tags.allowStubs ||
    (hre.network.config as HardhatNetworkConfig)?.forking?.enabled
  ) {
    throw new Error("deployed WalletRegistry contract not found")
  } else {
    log("deploying WalletRegistry stub")
    // In test mode, we don't need a full WalletRegistry implementation
    // since bridge.ts fixture creates smock fakes. Just deploy a minimal stub.
    await deploy("WalletRegistry", {
      contract: "TestERC20", // Use a simple contract as placeholder
      from: deployer,
      args: ["WalletRegistryStub", "WRS"],
      log: true,
      waitConfirmations: helpers.network?.confirmations || 1,
    })
  }
}

export default func

func.tags = ["WalletRegistry"]
