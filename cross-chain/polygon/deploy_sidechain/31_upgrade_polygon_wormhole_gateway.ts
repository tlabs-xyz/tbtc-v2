import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { ethers, getNamedAccounts, helpers, deployments } = hre
  const { deployer } = await getNamedAccounts()

  const PolygonTokenBridge = await deployments.get("PolygonTokenBridge")
  const PolygonWormholeTBTC = await deployments.get("PolygonWormholeTBTC")
  const PolygonTBTC = await deployments.get("PolygonTBTC")

  await helpers.upgrades.upgradeProxy(
    "PolygonWormholeGateway",
    "PolygonWormholeGateway",
    {
      contractName:
        "@keep-network/tbtc-v2/contracts/l2/L2WormholeGateway.sol:L2WormholeGateway",
      initializerArgs: [
        PolygonTokenBridge.address,
        PolygonWormholeTBTC.address,
        PolygonTBTC.address,
      ],
      factoryOpts: { signer: await ethers.getSigner(deployer) },
      proxyOpts: {
        kind: "transparent",
      },
    }
  )
}

export default func

func.tags = ["UpgradePolygonWormholeGateway"]

// Comment this line when running an upgrade.
// yarn deploy --tags UpgradePolygonWormholeGateway --network <network>
func.skip = async () => true
