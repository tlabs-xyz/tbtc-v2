import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, execute, get, log } = deployments
  const { deployer, governance } = await getNamedAccounts()

  // Deploy BasicMintingPolicy with direct Bank integration
  log("Deploying BasicMintingPolicy with direct Bank integration...")
  
  const protocolRegistry = await get("ProtocolRegistry")
  
  const basicMintingPolicy = await deploy("BasicMintingPolicy", {
    from: deployer,
    args: [protocolRegistry.address],
    log: true,
    waitConfirmations: 1,
  })

  // Register services in ProtocolRegistry
  log("Registering services in ProtocolRegistry...")
  
  // Get existing contract addresses
  const bank = await get("Bank")
  const tbtcVault = await get("TBTCVault")
  const qcManager = await get("QCManager")
  const qcData = await get("QCData")
  const systemState = await get("SystemState")
  const qcReserveLedger = await get("QCReserveLedger")

  // Register Bank and TBTCVault in ProtocolRegistry for BasicMintingPolicy
  await execute(
    "ProtocolRegistry",
    { from: deployer, log: true },
    "setService",
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BANK")),
    bank.address
  )

  await execute(
    "ProtocolRegistry",
    { from: deployer, log: true },
    "setService",
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TBTC_VAULT")),
    tbtcVault.address
  )

  // Register BasicMintingPolicy
  await execute(
    "ProtocolRegistry",
    { from: deployer, log: true },
    "setService",
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BASIC_MINTING_POLICY")),
    basicMintingPolicy.address
  )

  // Grant BasicMintingPolicy authorization to increase Bank balances
  log("Authorizing BasicMintingPolicy in Bank...")
  
  // First, we need to ensure governance owns the Bank
  const bankContract = await ethers.getContractAt("Bank", bank.address)
  const bankOwner = await bankContract.owner()
  
  if (bankOwner.toLowerCase() === governance.toLowerCase()) {
    // Governance owns Bank, can authorize directly
    await execute(
      "Bank",
      { from: governance, log: true },
      "setAuthorizedBalanceIncreaser",
      basicMintingPolicy.address,
      true
    )
  } else if (bankOwner.toLowerCase() === deployer.toLowerCase()) {
    // Deployer owns Bank, authorize then transfer ownership
    await execute(
      "Bank",
      { from: deployer, log: true },
      "setAuthorizedBalanceIncreaser",
      basicMintingPolicy.address,
      true
    )
    log("Note: Bank ownership should be transferred to governance")
  } else {
    log(`WARNING: Cannot authorize BasicMintingPolicy - Bank is owned by ${bankOwner}`)
    log("Manual authorization required")
  }

  // Grant BasicMintingPolicy the MINTER_ROLE in QCMinter
  try {
    const qcMinter = await get("QCMinter")
    const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"))
    
    await execute(
      "QCMinter",
      { from: deployer, log: true },
      "grantRole",
      MINTER_ROLE,
      basicMintingPolicy.address
    )
  } catch (error) {
    log("QCMinter not found or role grant failed - may need manual setup")
  }

  // Update QCMinter to use BasicMintingPolicy
  try {
    const qcMinter = await get("QCMinter")
    await execute(
      "QCMinter",
      { from: deployer, log: true },
      "setMintingPolicy",
      basicMintingPolicy.address
    )
  } catch (error) {
    log("Could not update QCMinter minting policy - may need manual update")
  }

  log("Direct QC integration deployment complete!")
  log("")
  log("Summary:")
  log("========")
  log(`BasicMintingPolicy: ${basicMintingPolicy.address}`)
  log("")
  log("Next steps:")
  log("1. Verify BasicMintingPolicy is authorized in Bank")
  log("2. Ensure QCMinter uses BasicMintingPolicy")
  log("3. Test minting flow with direct Bank integration")
}

export default func
func.tags = ["DirectQCIntegration", "AccountControl"]
func.dependencies = [
  "Bank",
  "TBTCVault", 
  "ProtocolRegistry",
  "QCManager",
  "QCData",
  "SystemState",
  "QCReserveLedger"
]