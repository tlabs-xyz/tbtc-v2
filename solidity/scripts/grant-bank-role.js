// Script to grant BALANCE_INCREASER_ROLE to QCMinter using Bank owner key
// Run after Account Control deployment is complete

const { ethers } = require("hardhat")

async function main() {
  console.log("=== Bank Authorization Script ===")

  // Configuration - Update these after deployment
  const { BANK_ADDRESS } = process.env // require explicit address per environment
  const QC_MINTER_ADDRESS = process.env.QC_MINTER_ADDRESS || "" // Will be set after deployment
  const BANK_OWNER_PRIVATE_KEY = process.env.BANK_OWNER_PRIVATE_KEY || "" // Set this securely

  // Basic format validation (ethers version agnostic)
  const isValidAddress = (a) => /^0x[a-fA-F0-9]{40}$/.test(a)
  const isValidPrivateKey = (k) => /^0x[0-9a-fA-F]{64}$/.test(k)

  if (!BANK_ADDRESS) {
    console.error("ERROR: BANK_ADDRESS not set in environment.")
    process.exit(1)
  }
  if (!isValidAddress(BANK_ADDRESS)) {
    console.error("ERROR: BANK_ADDRESS is not a valid hex address.")
    process.exit(1)
  }
  if (BANK_ADDRESS === "0x0000000000000000000000000000000000000000") {
    console.error("ERROR: BANK_ADDRESS cannot be the zero address.")
    process.exit(1)
  }
  if (!QC_MINTER_ADDRESS) {
    console.error(
      "ERROR: QC_MINTER_ADDRESS not set. Deploy Account Control first."
    )
    process.exit(1)
  }
  if (
    !isValidAddress(QC_MINTER_ADDRESS) ||
    QC_MINTER_ADDRESS === "0x0000000000000000000000000000000000000000"
  ) {
    console.error("ERROR: QC_MINTER_ADDRESS is invalid or zero address.")
    process.exit(1)
  }

  if (!BANK_OWNER_PRIVATE_KEY) {
    console.error("ERROR: BANK_OWNER_PRIVATE_KEY not set in environment.")
    console.error("Set it with: export BANK_OWNER_PRIVATE_KEY=0x...")
    process.exit(1)
  }
  if (!isValidPrivateKey(BANK_OWNER_PRIVATE_KEY)) {
    console.error(
      "ERROR: BANK_OWNER_PRIVATE_KEY format invalid. Expected 0x + 64 hex chars."
    )
    process.exit(1)
  }

  // Create signer with Bank owner key
  const { provider } = ethers
  const bankOwnerWallet = new ethers.Wallet(BANK_OWNER_PRIVATE_KEY, provider)

  console.log(`Using Bank owner address: ${bankOwnerWallet.address}`)
  console.log(`Bank contract: ${BANK_ADDRESS}`)
  console.log(`QCMinter to authorize: ${QC_MINTER_ADDRESS}`)

  // Get Bank contract ABI (simplified for the functions we need)
  const bankABI = [
    "function owner() view returns (address)",
    "function grantRole(bytes32 role, address account)",
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function BALANCE_INCREASER_ROLE() view returns (bytes32)",
  ]

  // Connect to Bank contract
  const bank = new ethers.Contract(BANK_ADDRESS, bankABI, bankOwnerWallet)

  try {
    // Verify we're using the correct owner
    const currentOwner = await bank.owner()
    console.log(`Current Bank owner: ${currentOwner}`)

    if (currentOwner.toLowerCase() !== bankOwnerWallet.address.toLowerCase()) {
      console.error("ERROR: Provided key does not match Bank owner!")
      console.error(`Expected: ${currentOwner}`)
      console.error(`Got: ${bankOwnerWallet.address}`)
      process.exit(1)
    }

    // Get the BALANCE_INCREASER_ROLE
    const BALANCE_INCREASER_ROLE = await bank.BALANCE_INCREASER_ROLE()
    console.log(`BALANCE_INCREASER_ROLE: ${BALANCE_INCREASER_ROLE}`)

    // Check if already authorized
    const hasRole = await bank.hasRole(
      BALANCE_INCREASER_ROLE,
      QC_MINTER_ADDRESS
    )

    if (hasRole) {
      console.log("✅ QCMinter already has BALANCE_INCREASER_ROLE!")
      return
    }

    // Grant the role
    console.log("Granting BALANCE_INCREASER_ROLE to QCMinter...")
    const tx = await bank.grantRole(BALANCE_INCREASER_ROLE, QC_MINTER_ADDRESS)
    console.log(`Transaction hash: ${tx.hash}`)

    // Wait for confirmation
    console.log("Waiting for confirmation...")
    const receipt = await tx.wait()
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`)

    // Verify the role was granted
    const hasRoleAfter = await bank.hasRole(
      BALANCE_INCREASER_ROLE,
      QC_MINTER_ADDRESS
    )

    if (hasRoleAfter) {
      console.log("✅ SUCCESS: QCMinter now has BALANCE_INCREASER_ROLE!")
    } else {
      console.error("❌ ERROR: Role grant failed!")
      process.exit(1)
    }
  } catch (error) {
    console.error("Error granting role:", error.message)
    process.exit(1)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
