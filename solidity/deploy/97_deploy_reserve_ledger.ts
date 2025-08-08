import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function DeployQCReserveLedger(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy, log } = deployments

  log("Deploying QCReserveLedger...")

  // Deploy QCReserveLedger (unified oracle + ledger)
  const reserveLedger = await deploy("QCReserveLedger", {
    from: deployer,
    args: [],
    log: true,
  })
  
  log(`✅ QCReserveLedger deployed at ${reserveLedger.address}`)
}

func.tags = ["QCReserveLedger"]
func.dependencies = ["QCData", "SystemState"] // Basic dependencies only

export default func