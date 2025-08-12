import { ethers } from "hardhat"
import { Contract } from "ethers"
import fs from "fs"

// Role definitions
const ROLES = {
  DEFAULT_ADMIN_ROLE:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  PARAMETER_ADMIN_ROLE: ethers.utils.id("PARAMETER_ADMIN_ROLE"),
  PAUSER_ROLE: ethers.utils.id("PAUSER_ROLE"),
  MANAGER_ROLE: ethers.utils.id("MANAGER_ROLE"),
  MINTER_ROLE: ethers.utils.id("MINTER_ROLE"),
  REDEEMER_ROLE: ethers.utils.id("REDEEMER_ROLE"),
  ARBITER_ROLE: ethers.utils.id("ARBITER_ROLE"),
  ATTESTER_ROLE: ethers.utils.id("ATTESTER_ROLE"),
  REGISTRAR_ROLE: ethers.utils.id("REGISTRAR_ROLE"),
  WATCHDOG_ROLE: ethers.utils.id("WATCHDOG_ROLE"),
  WATCHDOG_OPERATOR_ROLE: ethers.utils.id("WATCHDOG_OPERATOR_ROLE"),
  QC_ADMIN_ROLE: ethers.utils.id("QC_ADMIN_ROLE"),
  QC_MANAGER_ROLE: ethers.utils.id("QC_MANAGER_ROLE"),
  QC_GOVERNANCE_ROLE: ethers.utils.id("QC_GOVERNANCE_ROLE"),
  ESCALATOR_ROLE: ethers.utils.id("ESCALATOR_ROLE"),
}

// Expected role assignments
interface RoleAssignment {
  contract: string
  role: string
  expectedHolders: string[] // Can be "deployer", "governance", or contract names
  critical: boolean // If true, missing this role is a critical error
}

// Contract role requirements
const EXPECTED_ROLES: RoleAssignment[] = [
  // SystemState
  {
    contract: "SystemState",
    role: "DEFAULT_ADMIN_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "SystemState",
    role: "PARAMETER_ADMIN_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "SystemState",
    role: "PAUSER_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },

  // QCManager
  {
    contract: "QCManager",
    role: "DEFAULT_ADMIN_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "QCManager",
    role: "QC_ADMIN_ROLE",
    expectedHolders: ["BasicMintingPolicy"],
    critical: true,
  },
  {
    contract: "QCManager",
    role: "REGISTRAR_ROLE",
    expectedHolders: ["QCWatchdog"],
    critical: false,
  }, // Individual instances
  {
    contract: "QCManager",
    role: "ARBITER_ROLE",
    expectedHolders: [
      "WatchdogConsensusManager",
      "WatchdogAutomatedEnforcement",
    ],
    critical: true,
  },

  // QCData
  {
    contract: "QCData",
    role: "DEFAULT_ADMIN_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "QCData",
    role: "QC_MANAGER_ROLE",
    expectedHolders: ["QCManager"],
    critical: true,
  },

  // QCMinter
  {
    contract: "QCMinter",
    role: "DEFAULT_ADMIN_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "QCMinter",
    role: "MINTER_ROLE",
    expectedHolders: ["BasicMintingPolicy"],
    critical: false,
  }, // QCMinter has this on BasicMintingPolicy

  // QCRedeemer
  {
    contract: "QCRedeemer",
    role: "DEFAULT_ADMIN_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "QCRedeemer",
    role: "ARBITER_ROLE",
    expectedHolders: [
      "WatchdogConsensusManager",
      "WatchdogAutomatedEnforcement",
    ],
    critical: true,
  },

  // QCReserveLedger
  {
    contract: "QCReserveLedger",
    role: "DEFAULT_ADMIN_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "QCReserveLedger",
    role: "ATTESTER_ROLE",
    expectedHolders: ["QCWatchdog"],
    critical: false,
  }, // Individual instances

  // BasicMintingPolicy
  {
    contract: "BasicMintingPolicy",
    role: "DEFAULT_ADMIN_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "BasicMintingPolicy",
    role: "MINTER_ROLE",
    expectedHolders: ["QCMinter"],
    critical: true,
  },

  // BasicRedemptionPolicy
  {
    contract: "BasicRedemptionPolicy",
    role: "DEFAULT_ADMIN_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "BasicRedemptionPolicy",
    role: "REDEEMER_ROLE",
    expectedHolders: ["QCRedeemer"],
    critical: true,
  },

  // WatchdogConsensusManager
  {
    contract: "WatchdogConsensusManager",
    role: "DEFAULT_ADMIN_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "WatchdogConsensusManager",
    role: "MANAGER_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "WatchdogConsensusManager",
    role: "WATCHDOG_ROLE",
    expectedHolders: [],
    critical: false,
  }, // Added by operators

  // WatchdogMonitor
  {
    contract: "WatchdogMonitor",
    role: "DEFAULT_ADMIN_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "WatchdogMonitor",
    role: "MANAGER_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "WatchdogMonitor",
    role: "WATCHDOG_OPERATOR_ROLE",
    expectedHolders: [],
    critical: false,
  }, // Added by operators

  // WatchdogAutomatedEnforcement
  {
    contract: "WatchdogAutomatedEnforcement",
    role: "DEFAULT_ADMIN_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "WatchdogAutomatedEnforcement",
    role: "MANAGER_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },

  // WatchdogThresholdActions
  {
    contract: "WatchdogThresholdActions",
    role: "DEFAULT_ADMIN_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "WatchdogThresholdActions",
    role: "MANAGER_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },

  // WatchdogDAOEscalation
  {
    contract: "WatchdogDAOEscalation",
    role: "DEFAULT_ADMIN_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "WatchdogDAOEscalation",
    role: "MANAGER_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "WatchdogDAOEscalation",
    role: "ESCALATOR_ROLE",
    expectedHolders: ["WatchdogThresholdActions"],
    critical: true,
  },
]

interface VerificationResult {
  contract: string
  role: string
  roleName: string
  expected: string[]
  actual: string[]
  status: "✅ OK" | "⚠️ WARNING" | "❌ ERROR"
  message: string
}

async function getContractAddress(name: string): Promise<string | null> {
  try {
    const contract = await ethers.getContract(name)
    return contract.address
  } catch {
    return null
  }
}

async function resolveExpectedHolders(
  holders: string[],
  deployer: string,
  governance: string
): Promise<string[]> {
  const resolved: string[] = []

  for (const holder of holders) {
    if (holder === "deployer") {
      resolved.push(deployer)
    } else if (holder === "governance") {
      resolved.push(governance)
    } else {
      // It's a contract name, try to get its address
      const address = await getContractAddress(holder)
      if (address) {
        resolved.push(address)
      }
    }
  }

  return resolved
}

async function getRoleHolders(
  contract: Contract,
  role: string
): Promise<string[]> {
  const holders: string[] = []

  try {
    // Get role member count if available
    const memberCount = contract.getRoleMemberCount
      ? await contract.getRoleMemberCount(role)
      : 0

    if (memberCount > 0) {
      // Use getRoleMember to enumerate
      for (let i = 0; i < memberCount; i++) {
        const member = await contract.getRoleMember(role, i)
        holders.push(member)
      }
    } else {
      // Fallback: check known addresses
      const [deployer, governance] = await ethers.getSigners()
      const addresses = [deployer.address, governance.address]

      // Check common contract addresses
      const contractsToCheck = [
        "QCManager",
        "QCMinter",
        "QCRedeemer",
        "BasicMintingPolicy",
        "BasicRedemptionPolicy",
        "WatchdogConsensusManager",
        "WatchdogMonitor",
        "WatchdogAutomatedEnforcement",
        "WatchdogThresholdActions",
      ]

      for (const contractName of contractsToCheck) {
        const addr = await getContractAddress(contractName)
        if (addr) addresses.push(addr)
      }

      // Check each address
      for (const addr of addresses) {
        try {
          if (await contract.hasRole(role, addr)) {
            holders.push(addr)
          }
        } catch {
          // Ignore errors for invalid addresses
        }
      }
    }
  } catch (error) {
    console.error(`Error getting role holders: ${error.message}`)
  }

  return holders
}

function getRoleName(roleHash: string): string {
  for (const [name, hash] of Object.entries(ROLES)) {
    if (hash === roleHash) return name
  }
  return "UNKNOWN_ROLE"
}

async function verifyRoles(): Promise<void> {
  console.log("🔍 Account Control Role Verification Script")
  console.log("==========================================\n")

  const [deployer, governance] = await ethers.getSigners()
  console.log(`Deployer: ${deployer.address}`)
  console.log(`Governance: ${governance?.address || "Not configured"}\n`)

  const results: VerificationResult[] = []
  const criticalErrors: string[] = []
  const warnings: string[] = []
  const deployerPrivileges: string[] = []

  // Check v1 roles
  console.log("Checking v1 contracts...")
  for (const assignment of EXPECTED_ROLES) {
    const contract = await getContractAddress(assignment.contract)
    if (!contract) {
      console.log(`⏭️  Skipping ${assignment.contract} (not deployed)`)
      continue
    }

    const contractInstance = await ethers.getContractAt(
      assignment.contract,
      contract
    )
    const actualHolders = await getRoleHolders(
      contractInstance,
      ROLES[assignment.role]
    )
    const expectedHolders = await resolveExpectedHolders(
      assignment.expectedHolders,
      deployer.address,
      governance?.address || deployer.address
    )

    // Check if deployer still has admin roles
    if (
      assignment.role === "DEFAULT_ADMIN_ROLE" &&
      actualHolders.includes(deployer.address)
    ) {
      deployerPrivileges.push(
        `${assignment.contract} still has deployer as admin`
      )
    }

    // Analyze results
    let status: "✅ OK" | "⚠️ WARNING" | "❌ ERROR" = "✅ OK"
    let message = ""

    const missingHolders = expectedHolders.filter(
      (e) => !actualHolders.includes(e)
    )
    const unexpectedHolders = actualHolders.filter(
      (a) => !expectedHolders.includes(a) && a !== deployer.address
    )

    if (missingHolders.length > 0) {
      if (assignment.critical) {
        status = "❌ ERROR"
        message = `Missing critical role holders: ${missingHolders.join(", ")}`
        criticalErrors.push(
          `${assignment.contract}.${getRoleName(assignment.role)}: ${message}`
        )
      } else {
        status = "⚠️ WARNING"
        message = `Missing optional role holders: ${missingHolders.join(", ")}`
        warnings.push(
          `${assignment.contract}.${getRoleName(assignment.role)}: ${message}`
        )
      }
    }

    if (unexpectedHolders.length > 0) {
      status = status === "✅ OK" ? "⚠️ WARNING" : status
      message += message ? "; " : ""
      message += `Unexpected holders: ${unexpectedHolders.join(", ")}`
      warnings.push(
        `${assignment.contract}.${getRoleName(
          assignment.role
        )}: Unexpected holders`
      )
    }

    results.push({
      contract: assignment.contract,
      role: assignment.role,
      roleName: getRoleName(assignment.role),
      expected: expectedHolders,
      actual: actualHolders,
      status,
      message: message || "All expected holders present",
    })
  }

  // Generate report
  console.log("\n📊 VERIFICATION REPORT")
  console.log("====================\n")

  // Summary
  const okCount = results.filter((r) => r.status === "✅ OK").length
  const warningCount = results.filter((r) => r.status === "⚠️ WARNING").length
  const errorCount = results.filter((r) => r.status === "❌ ERROR").length

  console.log("Summary:")
  console.log(`✅ OK: ${okCount}`)
  console.log(`⚠️  WARNING: ${warningCount}`)
  console.log(`❌ ERROR: ${errorCount}`)
  console.log(`🚨 Deployer Privileges: ${deployerPrivileges.length}\n`)

  // Critical errors
  if (criticalErrors.length > 0) {
    console.log("❌ CRITICAL ERRORS:")
    criticalErrors.forEach((error) => console.log(`  - ${error}`))
    console.log("")
  }

  // Warnings
  if (warnings.length > 0) {
    console.log("⚠️  WARNINGS:")
    warnings.forEach((warning) => console.log(`  - ${warning}`))
    console.log("")
  }

  // Deployer privileges
  if (deployerPrivileges.length > 0) {
    console.log("🚨 DEPLOYER STILL HAS ADMIN ROLES:")
    deployerPrivileges.forEach((priv) => console.log(`  - ${priv}`))
    console.log("")
  }

  // Detailed results
  console.log("\n📋 DETAILED RESULTS:")
  console.log("===================\n")

  for (const result of results) {
    console.log(`${result.status} ${result.contract}.${result.roleName}`)
    console.log(
      `   Expected: ${
        result.expected.length > 0 ? result.expected.join(", ") : "None"
      }`
    )
    console.log(
      `   Actual: ${
        result.actual.length > 0 ? result.actual.join(", ") : "None"
      }`
    )
    if (result.message !== "All expected holders present") {
      console.log(`   Note: ${result.message}`)
    }
    console.log("")
  }

  // Save detailed report
  const report = {
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    governance: governance?.address || "Not configured",
    summary: {
      ok: okCount,
      warnings: warningCount,
      errors: errorCount,
      deployerPrivileges: deployerPrivileges.length,
    },
    criticalErrors,
    warnings,
    deployerPrivileges,
    results,
  }

  const reportPath = `./role-verification-report-${Date.now()}.json`
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\n📁 Detailed report saved to: ${reportPath}`)

  // Exit code
  if (errorCount > 0 || deployerPrivileges.length > 0) {
    console.log("\n❌ Verification failed! Critical issues found.")
    process.exit(1)
  } else if (warningCount > 0) {
    console.log("\n⚠️  Verification completed with warnings.")
  } else {
    console.log("\n✅ All roles verified successfully!")
  }
}

// Run verification
verifyRoles()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Verification failed:", error)
    process.exit(1)
  })
