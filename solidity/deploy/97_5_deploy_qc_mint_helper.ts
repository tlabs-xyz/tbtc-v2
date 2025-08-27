import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, helpers } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()

  console.log("Deploying QCMintHelper...")

  // Get required contract addresses
  const bank = await get("Bank")
  const tbtcVault = await get("TBTCVault") 
  const tbtc = await get("TBTC")
  const qcMinter = await get("QCMinter")

  console.log("Contract addresses:")
  console.log(`  Bank: ${bank.address}`)
  console.log(`  TBTCVault: ${tbtcVault.address}`)
  console.log(`  TBTC: ${tbtc.address}`)
  console.log(`  QCMinter: ${qcMinter.address}`)

  // Deploy QCMintHelper
  const qcMintHelper = await deploy("QCMintHelper", {
    contract: "QCMintHelper",
    from: deployer,
    args: [
      bank.address,
      tbtcVault.address, 
      tbtc.address,
      qcMinter.address
    ],
    log: true,
    waitConfirmations: 1,
  })

  console.log(`✅ QCMintHelper deployed at: ${qcMintHelper.address}`)

  // Verify on Etherscan if configured
  if (hre.network.tags.etherscan) {
    console.log("Verifying QCMintHelper on Etherscan...")
    await helpers.etherscan.verify(qcMintHelper)
    console.log("✅ QCMintHelper verified on Etherscan")
  }

  // Verify on Tenderly if configured
  if (hre.network.tags.tenderly) {
    console.log("Verifying QCMintHelper on Tenderly...")
    await hre.tenderly.verify({
      name: "QCMintHelper",
      address: qcMintHelper.address,
    })
    console.log("✅ QCMintHelper verified on Tenderly")
  }

  console.log("")
  console.log("==============================================")
  console.log("✅ QCMintHelper Deployment Complete!")
  console.log("==============================================")
  console.log("")
  console.log("Next steps:")
  console.log("  1. Configure QCMintHelper address in QCMinter")
  console.log("  2. Authorize QCMinter in Bank (governance action)")
  console.log("  3. Test end-to-end minting flows")
  console.log("")
}

export default func

func.tags = ["QCMintHelper"]
func.dependencies = [
  "Bank",
  "TBTCVault", 
  "TBTC",
  "QCMinter"
]