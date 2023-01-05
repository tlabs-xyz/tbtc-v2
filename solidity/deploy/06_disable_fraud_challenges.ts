import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments, ethers, getNamedAccounts } = hre
  const { execute, read } = deployments
  const { deployer } = await getNamedAccounts()

  deployments.log("disabling fraud challenges in the Bridge")

  // To disable the fraud challenge mechanism, we need to make the fraud
  // challenge deposit extremely high. The deposit value is determined by the
  // fraudChallengeDepositAmount governance parameter. This parameter is uint96.
  // The maximum value for the uint96 is 2^96-1 = 79228162514264337593543950335.
  const fraudChallengeDepositAmount = ethers.BigNumber.from(
    "79228162514264337593543950335"
  )

  // To emphasize the fact that frauds are disabled, we set the
  // fraudChallengeDefeatTimeout to uint32 max value (2^32-1 = 4294967295) and
  // fraudSlashingAmount to zero.
  const fraudChallengeDefeatTimeout = ethers.BigNumber.from("4294967295")
  const fraudSlashingAmount = ethers.BigNumber.from("0")

  // Fetch the current values of other fraud parameters to keep them unchanged.
  const fraudParameters = await read("Bridge", "fraudParameters")

  await execute(
    "Bridge",
    { from: deployer, log: true, waitConfirmations: 1 },
    "updateFraudParameters",
    fraudChallengeDepositAmount,
    fraudChallengeDefeatTimeout,
    fraudSlashingAmount,
    fraudParameters.fraudNotifierRewardMultiplier
  )
}

export default func

func.tags = ["DisableFraudChallenges"]
func.dependencies = ["Bridge"]

func.skip = async (hre: HardhatRuntimeEnvironment): Promise<boolean> =>
  hre.network.name !== "mainnet"
