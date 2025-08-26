import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

/**
 * Deploy BankV2 for Account Control Testing
 * 
 * This deploys a separate Bank instance with the increaseBalanceAndCall
 * function required by Account Control. This is for testnet only - mainnet
 * will require governance upgrade of the existing Bank.
 * 
 * The BankV2 is isolated from the main tBTC system to allow testing
 * without affecting existing operations.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, helpers, ethers } = hre
  const { deploy, log } = deployments
  const { deployer } = await getNamedAccounts()

  // Only deploy on testnet
  if (hre.network.name === "mainnet") {
    log("Skipping BankV2 deployment on mainnet - governance upgrade required")
    return
  }

  log("Deploying BankV2 for Account Control testing...")

  // Deploy modified Bank as BankV2
  const bankV2 = await deploy("BankV2", {
    contract: "Bank", // Uses the modified Bank.sol with increaseBalanceAndCall
    from: deployer,
    args: [],
    log: true,
    waitConfirmations: 1,
  })

  log(`BankV2 deployed at: ${bankV2.address}`)

  // Note: We don't connect it to existing Bridge or TBTCVault yet
  // Account Control deployment will handle the connections

  if (hre.network.tags.etherscan) {
    await helpers.etherscan.verify(bankV2)
  }

  if (hre.network.tags.tenderly) {
    await hre.tenderly.verify({
      name: "BankV2",
      address: bankV2.address,
    })
  }

  // Log important information
  log("")
  log("========================================")
  log("BankV2 Deployment Summary")
  log("========================================")
  log(`Network: ${hre.network.name}`)
  log(`BankV2 Address: ${bankV2.address}`)
  log(`Deployer: ${deployer}`)
  log("")
  log("IMPORTANT: This is a separate Bank instance for Account Control testing.")
  log("It is NOT connected to the existing tBTC system.")
  log("Account Control contracts will use this BankV2 for minting operations.")
  log("========================================")
}

export default func

func.tags = ["BankV2", "AccountControlInfra"]
func.dependencies = []