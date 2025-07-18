import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { ethers, getNamedAccounts, helpers } = hre
  const { deployer } = await getNamedAccounts()

  // TODO: waiting for the addresses to be defined
  const L2_BRIDGE = "0x9fc3da866e7df3a1c57ade1a97c9f00a70f010c8"
  const L1_TBTC = "0x3151c5547d1dbcd52076bd3cbe56c79abd55b42f"

  const [, proxyDeployment] = await helpers.upgrades.deployProxy(
    "OptimismMintableUpgradableERC20",
    {
      contractName: "OptimismMintableUpgradableERC20",
      initializerArgs: [
        L2_BRIDGE,
        L1_TBTC,
        "BOB tBTC v2", // name
        "tBTC", // symbol
        18, // decimals
      ],
      factoryOpts: { signer: await ethers.getSigner(deployer) },
      proxyOpts: {
        kind: "transparent",
      },
    }
  )

  // TODO: Investigate the possibility of adding Tenderly verification for
  // L2 and upgradable proxy.

  // Contracts can be verified on L2 Bobscan in a similar way as we do it on
  // L1 Etherscan
  if (hre.network.tags.bobscan) {
    // We use `verify` instead of `verify:verify` as the `verify` task is defined
    // in "@openzeppelin/hardhat-upgrades" to verify the proxy’s implementation
    // contract, the proxy itself and any proxy-related contracts, as well as
    // link the proxy to the implementation contract’s ABI on (Ether)scan.
    await hre.run("verify", {
      address: proxyDeployment.address,
      constructorArgsParams: proxyDeployment.args,
    })
  }
}

export default func

func.tags = ["OptimismMintableUpgradableERC20"]
