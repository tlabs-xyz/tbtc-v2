import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function ConfigureAccountControlSystem(
  hre: HardhatRuntimeEnvironment
) {
  const { deployments } = hre
  const { log } = deployments

  log("✅ Account Control configuration is now integrated into 95_deploy_account_control.ts")
  log("   This script is kept for backward compatibility only.")
}

export default func
func.tags = ["ConfigureAccountControl"]
func.dependencies = [
  "AccountControl",  // Main deployment from 95_deploy_account_control.ts
]

// Skip deployment if USE_EXTERNAL_DEPLOY=true and we're not explicitly running AccountControl tests
func.skip = async (hre: HardhatRuntimeEnvironment) => {
  // Skip if we're using external deployment and not explicitly deploying account control
  if (process.env.USE_EXTERNAL_DEPLOY === "true" && !process.env.DEPLOY_ACCOUNT_CONTROL) {
    return true
  }
  return false
}