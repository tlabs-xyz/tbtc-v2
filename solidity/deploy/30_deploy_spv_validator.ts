import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, log, get } = deployments
  const { deployer } = await getNamedAccounts()

  // DESIGN NOTE: We deploy SPVValidator instead of modifying Bridge to avoid
  // the risk of redeploying a critical production system. SPVValidator reuses
  // Bridge's exact SPV parameters and logic while providing Account Control
  // with the SPV verification capabilities it needs.

  // Get Bridge contract to read relay and difficulty factor
  const bridgeDeployment = await get("Bridge")
  const bridge = await hre.ethers.getContractAt(
    "Bridge",
    bridgeDeployment.address
  )

  // Read relay and difficulty factor from Bridge to ensure consistency
  const contractRefs = await bridge.contractReferences()
  const { relay } = contractRefs
  const txProofDifficultyFactor = await bridge.txProofDifficultyFactor()

  log(
    `Deploying SPVValidator with relay: ${relay}, difficulty factor: ${txProofDifficultyFactor}`
  )

  const spvValidator = await deploy("SPVValidator", {
    from: deployer,
    args: [relay, txProofDifficultyFactor],
    log: true,
    waitConfirmations: 1,
  })

  // Register with ProtocolRegistry if available
  try {
    const protocolRegistryDeployment = await get("ProtocolRegistry")
    const protocolRegistryContract = await hre.ethers.getContractAt(
      "ProtocolRegistry",
      protocolRegistryDeployment.address
    )

    const SPV_VALIDATOR_KEY = hre.ethers.utils.keccak256(
      hre.ethers.utils.toUtf8Bytes("SPV_VALIDATOR")
    )

    // Check if already registered
    const currentService = await protocolRegistryContract.getService(
      SPV_VALIDATOR_KEY
    )
    if (currentService === hre.ethers.constants.AddressZero) {
      log("Registering SPVValidator with ProtocolRegistry...")

      // Get deployer signer
      const deployerSigner = await hre.ethers.getSigner(deployer)
      const registryWithSigner =
        protocolRegistryContract.connect(deployerSigner)

      const tx = await registryWithSigner.registerService(
        SPV_VALIDATOR_KEY,
        spvValidator.address
      )
      await tx.wait()

      log("SPVValidator registered with ProtocolRegistry")
    } else {
      log(
        `SPVValidator already registered in ProtocolRegistry at: ${currentService}`
      )
    }
  } catch (error) {
    log("ProtocolRegistry not found or registration failed:", error)
  }

  // Transfer admin role to governance if available
  try {
    const governanceDeployment = await get("Governance")
    const spvValidatorContract = await hre.ethers.getContractAt(
      "SPVValidator",
      spvValidator.address
    )

    const deployerSigner = await hre.ethers.getSigner(deployer)
    const spvValidatorWithSigner = spvValidatorContract.connect(deployerSigner)

    const DEFAULT_ADMIN_ROLE = await spvValidatorContract.DEFAULT_ADMIN_ROLE()

    log("Transferring SPVValidator admin role to governance...")
    const tx = await spvValidatorWithSigner.grantRole(
      DEFAULT_ADMIN_ROLE,
      governanceDeployment.address
    )
    await tx.wait()

    // Renounce deployer admin role
    const tx2 = await spvValidatorWithSigner.renounceRole(
      DEFAULT_ADMIN_ROLE,
      deployer
    )
    await tx2.wait()

    log("SPVValidator admin role transferred to governance")
  } catch (error) {
    log("Governance transfer failed or not needed:", error)
  }
}

export default func
func.tags = ["SPVValidator"]
func.dependencies = ["Bridge", "ProtocolRegistry"]
