import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // @ts-ignore - These properties are augmented by hardhat plugins
  const { deployments, getNamedAccounts, ethers, network } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()

  // Get the existing proxy deployment
  const proxyDeployment = await get("OptimismMintableUpgradableERC20")
  console.log("Existing proxy address:", proxyDeployment.address)

  // Deploy the new implementation
  const newImplementation = await deploy("OptimismMintableUpgradableTBTC_Implementation", {
    contract: "OptimismMintableUpgradableTBTC",
    from: deployer,
    log: true,
  })

  console.log("New implementation deployed at:", newImplementation.address)

  // Note: The actual upgrade must be performed by the proxy admin/governance
  console.log("\n========================================")
  console.log("MANUAL UPGRADE STEPS:")
  console.log("========================================")
  console.log("1. The ProxyAdmin owner needs to call:")
  console.log(`   ProxyAdmin.upgradeTo${newImplementation.address})`)
  console.log("\n2. After upgrade, call initializeV2 on the proxy:")
  console.log(`   OptimismMintableUpgradableTBTC(${proxyDeployment.address}).initializeV2("your_value")`)
  console.log("\n3. Verify the upgrade by checking:")
  console.log("   - newVar() returns the initialized value")
  console.log("   - All existing state (name, symbol, decimals, etc.) is preserved")
  console.log("========================================\n")

  // If on a network with etherscan verification
  // @ts-ignore - network.tags is augmented by hardhat
  if (network.tags?.bobscan) {
    await hre.run("verify:verify", {
      address: newImplementation.address,
      constructorArguments: [],
    })
  }
}

export default func

func.tags = ["OptimismMintableUpgradableTBTC_Upgrade"]
func.dependencies = ["OptimismMintableUpgradableERC20"]

// Set to true to skip this deployment by default
// Remove or set to false when ready to deploy
func.skip = async () => true 