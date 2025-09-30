import { task } from "hardhat/config"
import { ethers } from "hardhat"
import { HDNodeWallet, formatEther, parseEther } from "ethers"
import * as fs from "fs"
import * as path from "path"

// Account derivation configuration
const DERIVATION_PATH_BASE = "m/44'/60'/0'/0/"
const ACCOUNT_COUNT = 11 // Total number of accounts to derive

// Actor type mapping to account indices
const ACTOR_ACCOUNTS = {
  DEPLOYER: 0,
  GOVERNANCE: 1,
  EMERGENCY_COUNCIL: 2,
  WATCHDOG: 3,
  QC: 4,
  USER: 5,
  USER_2: 6,
  QC_2: 7,
  ATTACKER: 8,
  UNAUTHORIZED_USER: 9,
  THIRD_PARTY: 10,
}

// Ultra-scaled funding amounts for 0.02 ETH budget (in ETH)
// Total needed: exactly 0.02 ETH across all accounts
const FUNDING_AMOUNTS = {
  DEPLOYER: "0.007", // For contract deployment (most expensive)
  GOVERNANCE: "0.002", // For governance transactions
  EMERGENCY_COUNCIL: "0.001", // For emergency actions
  WATCHDOG: "0.002", // For monitoring transactions
  QC: "0.002", // For QC operations
  USER: "0.002", // For minting/redemption testing
  USER_2: "0.001", // Secondary user
  QC_2: "0.001", // Secondary QC
  ATTACKER: "0.001", // For attack scenarios
  UNAUTHORIZED_USER: "0.0005", // For access control testing
  THIRD_PARTY: "0.0005", // Generic third party
}

// Minimum balance threshold (in ETH) - ultra low for 0.02 ETH budget
const MIN_BALANCE_THRESHOLD = "0.0005"

interface DerivedAccount {
  name: string
  index: number
  address: string
  privateKey: string
  wallet: HDNodeWallet
  targetBalance: string
  currentBalance?: string
}

task("setup-accounts", "Setup accounts from seed phrase and balance ETH")
  .addParam("seed", "The seed phrase to derive accounts from")
  .setAction(async (taskArgs, hre) => {
    const { ethers } = hre
    const seedPhrase = taskArgs.seed

    console.log("🚀 Account Control - Account Setup Script")
    console.log("=".repeat(50))

    // Validate seed phrase
    try {
      HDNodeWallet.fromPhrase(seedPhrase)
    } catch (error) {
      console.log("❌ Error: Invalid seed phrase")
      console.log("Please provide a valid 12 or 24 word BIP39 seed phrase")
      return
    }

    console.log(`🌱 Using seed phrase (${seedPhrase.split(" ").length} words)`)
    console.log(`🌐 Network: ${hre.network.name}`)

    // Calculate and show total funding needed
    const totalFunding = Object.values(FUNDING_AMOUNTS).reduce(
      (sum, amount) => sum + parseFloat(amount),
      0
    )
    console.log(
      `💰 Total funding needed: ${totalFunding.toFixed(
        6
      )} ETH (fits in 0.02 ETH budget!)`
    )
    console.log("")

    // Derive accounts
    console.log("🔑 Deriving accounts from seed phrase...")
    console.log(`📊 Deriving ${ACCOUNT_COUNT} accounts\n`)

    const masterNode = HDNodeWallet.fromPhrase(seedPhrase)
    const accounts: DerivedAccount[] = []
    const actorNames = Object.keys(ACTOR_ACCOUNTS) as Array<
      keyof typeof ACTOR_ACCOUNTS
    >

    for (let i = 0; i < ACCOUNT_COUNT; i++) {
      const derivationPath = `${DERIVATION_PATH_BASE}${i}`
      const wallet = masterNode.derivePath(derivationPath).connect(ethers.provider)

      const actorName = actorNames[i]
      const targetBalance = FUNDING_AMOUNTS[actorName]

      const account: DerivedAccount = {
        name: actorName,
        index: i,
        address: wallet.address,
        privateKey: wallet.privateKey,
        wallet,
        targetBalance,
      }

      accounts.push(account)

      console.log(
        `${i.toString().padStart(2, "0")}. ${actorName.padEnd(18)} | ${
          wallet.address
        } | Target: ${targetBalance} ETH`
      )
    }

    console.log("")

    // Check current balances
    console.log("💰 Checking current balances...")

    for (const account of accounts) {
      try {
        const balance = await account.wallet.getBalance()
        account.currentBalance = formatEther(balance)

        const balanceNum = parseFloat(account.currentBalance)
        const targetNum = parseFloat(account.targetBalance)
        const status = balanceNum >= targetNum ? "✅" : "❌"

        console.log(
          `${status} ${account.name.padEnd(18)} | ${formatEther(
            balance
          ).padStart(10)} ETH | Target: ${account.targetBalance} ETH`
        )
      } catch (error) {
        console.log(`❌ ${account.name.padEnd(18)} | ERROR: ${error.message}`)
        account.currentBalance = "0"
      }
    }
    console.log("")

    // Calculate funding needs
    let totalNeeded = 0
    let totalAvailable = 0

    for (const account of accounts) {
      const current = parseFloat(account.currentBalance || "0")
      const target = parseFloat(account.targetBalance)

      if (current < target) {
        totalNeeded += target - current
      }

      totalAvailable += current
    }

    console.log("⚖️  Balancing ETH between accounts...\n")
    console.log("📊 Funding Analysis:")
    console.log(`   Total needed: ${totalNeeded.toFixed(6)} ETH`)
    console.log(`   Total available: ${totalAvailable.toFixed(6)} ETH`)

    if (totalNeeded > totalAvailable) {
      const deficit = totalNeeded - totalAvailable
      console.log(`   ❌ Deficit: ${deficit.toFixed(6)} ETH`)
      console.log(
        "   ⚠️  You need to add more ETH to the accounts before balancing.\n"
      )
      return
    }
    console.log("   ✅ Sufficient funds available\n")

    // Find funding source
    let bestAccount: DerivedAccount | null = null
    let maxBalance = 0

    for (const account of accounts) {
      if (!account.currentBalance) continue

      const balance = parseFloat(account.currentBalance)
      const target = parseFloat(account.targetBalance)
      const surplus = balance - target

      // Only consider accounts with surplus above minimum threshold
      if (surplus > parseFloat(MIN_BALANCE_THRESHOLD) && balance > maxBalance) {
        maxBalance = balance
        bestAccount = account
      }
    }

    if (!bestAccount) {
      console.log("❌ No account found with sufficient surplus to fund others")
      return
    }

    console.log(
      `💳 Using ${bestAccount.name} (${bestAccount.address}) as funding source`
    )
    console.log(`   Current balance: ${bestAccount.currentBalance} ETH\n`)

    let totalTransferred = 0
    const transactions: any[] = []

    // Fund each account that needs ETH
    for (const account of accounts) {
      if (account.address === bestAccount.address) continue

      const current = parseFloat(account.currentBalance || "0")
      const target = parseFloat(account.targetBalance)

      if (current < target) {
        const needed = target - current
        const amount = parseEther(needed.toFixed(6))

        console.log(`💸 Funding ${account.name}: ${needed.toFixed(6)} ETH`)

        try {
          const tx = await bestAccount.wallet.sendTransaction({
            to: account.address,
            value: amount,
            gasLimit: 21000, // Standard ETH transfer
          })

          console.log(`   📄 Transaction: ${tx.hash}`)
          transactions.push({
            account: account.name,
            amount: needed,
            hash: tx.hash,
          })
          totalTransferred += needed

          // Wait for transaction confirmation
          await tx.wait()
          console.log("   ✅ Confirmed\n")
        } catch (error) {
          console.log(`   ❌ Failed: ${error.message}\n`)
        }
      }
    }

    console.log("🎉 Balancing complete!")
    console.log(`   Total transferred: ${totalTransferred.toFixed(6)} ETH`)
    console.log(`   Transactions: ${transactions.length}\n`)

    // Generate .env file
    console.log("📄 Generating .env file with derived private keys...")

    const envContent = [
      "# =============================================================================",
      "# Account Control Flows - Auto-Generated Environment Configuration",
      "# =============================================================================",
      "# Generated by setup-accounts task from seed phrase",
      `# Derivation path: ${DERIVATION_PATH_BASE}N (N = 0 to ${
        ACCOUNT_COUNT - 1
      })`,
      "# All accounts derived using standard BIP44 derivation path",
      "# Funding amounts ultra-scaled for 0.02 ETH budget",
      "# =============================================================================\n",

      "# -----------------------------------------------------------------------------",
      "# Derived Actor Private Keys",
      "# -----------------------------------------------------------------------------",
    ]

    // Add each account's private key with address and index info
    for (const account of accounts) {
      envContent.push(
        `# ${account.name} - ${account.address} (Index ${account.index})`
      )
      envContent.push(`${account.name}_PRIVATE_KEY=${account.privateKey}`)
      envContent.push("")
    }

    envContent.push(
      "# -----------------------------------------------------------------------------",
      "# Network Configuration",
      "# -----------------------------------------------------------------------------",
      "SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID",
      "CHAIN_API_URL=https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID",
      "",
      "# Test network configuration",
      "TEST_NETWORK=sepolia",
      "AUTO_FUND_ACCOUNTS=true",
      "MIN_BALANCE_THRESHOLD=0.0005",
      "",
      "# -----------------------------------------------------------------------------",
      "# Actor Funding Amounts (ultra-scaled for 0.02 ETH budget)",
      "# -----------------------------------------------------------------------------",
      ...Object.entries(FUNDING_AMOUNTS).map(
        ([actor, amount]) => `${actor}_FUNDING_AMOUNT=${amount}`
      ),
      "",
      "# -----------------------------------------------------------------------------",
      "# Testing Configuration",
      "# -----------------------------------------------------------------------------",
      "FLOW_EXECUTION_TIMEOUT=600000",
      "FLOW_RETRY_ATTEMPTS=3",
      "LOG_LEVEL=INFO",
      "LOG_TRANSACTIONS=true",
      "LOG_GAS_USAGE=true",
      "",
      "# =============================================================================",
      "# Usage Instructions",
      "# =============================================================================",
      "#",
      "# 1. Set your Infura/Alchemy project ID in SEPOLIA_RPC_URL above",
      "# 2. Ensure all accounts are funded with Sepolia ETH",
      "# 3. Run flows using: npm run flows:run",
      "# 4. To re-balance accounts, run: npx hardhat setup-accounts --seed 'your seed phrase'",
      "#",
      `# Account derivation: ${DERIVATION_PATH_BASE}N where N = 0 to ${
        ACCOUNT_COUNT - 1
      }`,
      `# Total accounts: ${ACCOUNT_COUNT}`,
      "# Funding ultra-scaled: 0.0005-0.007 ETH per account (exactly 0.02 ETH total)",
      "#",
      "# ============================================================================="
    )

    const envPath = path.join(__dirname, "../.env")
    fs.writeFileSync(envPath, envContent.join("\n"))

    console.log(`✅ .env file generated at: ${envPath}`)
    console.log("🔧 Remember to set your Sepolia RPC URL in the .env file\n")

    // Final summary
    console.log("📋 Final Account Summary:")
    console.log("=".repeat(80))

    // Check balances again
    for (const account of accounts) {
      try {
        const balance = await account.wallet.getBalance()
        const current = formatEther(balance)
        const target = parseFloat(account.targetBalance)
        const status = parseFloat(current) >= target ? "✅" : "❌"

        console.log(
          `${status} ${account.name.padEnd(18)} | ${current.padStart(
            10
          )} ETH | Target: ${account.targetBalance} ETH`
        )
      } catch (error) {
        console.log(`❌ ${account.name.padEnd(18)} | ERROR: ${error.message}`)
      }
    }

    // Calculate final totals
    let finalTotal = 0
    for (const account of accounts) {
      try {
        const balance = await account.wallet.getBalance()
        finalTotal += parseFloat(formatEther(balance))
      } catch (error) {
        // Skip errored accounts
      }
    }

    console.log(
      `\n💰 Total ETH across all accounts: ${finalTotal.toFixed(6)} ETH`
    )

    if (finalTotal < totalFunding) {
      const stillNeeded = totalFunding - finalTotal
      console.log(
        `⚠️  Still need: ${stillNeeded.toFixed(6)} ETH to meet all targets`
      )
    } else {
      console.log("✅ All accounts sufficiently funded!")
    }

    console.log("\n🎯 Next steps:")
    console.log("1. Update RPC URLs in the generated .env file")
    console.log("2. Run flows using the configured accounts")
    console.log("3. Re-run this task anytime to rebalance accounts")

    console.log("\n🎉 Account setup complete!")
  })

export default {}
