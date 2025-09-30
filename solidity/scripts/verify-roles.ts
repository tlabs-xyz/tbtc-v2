import { ethers } from "hardhat"
import { Contract } from "ethers"
import fs from "fs"

// Role definitions (updated for Account Control v2.0)
const ROLES = {
  DEFAULT_ADMIN_ROLE:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  GOVERNANCE_ROLE: ethers.utils.id("GOVERNANCE_ROLE"),
  OPERATIONS_ROLE: ethers.utils.id("OPERATIONS_ROLE"),
  EMERGENCY_ROLE: ethers.utils.id("EMERGENCY_ROLE"),
  MINTER_ROLE: ethers.utils.id("MINTER_ROLE"),
  DISPUTE_ARBITER_ROLE: ethers.utils.id("DISPUTE_ARBITER_ROLE"),
  ATTESTER_ROLE: ethers.utils.id("ATTESTER_ROLE"),
  REGISTRAR_ROLE: ethers.utils.id("REGISTRAR_ROLE"),
  MONITOR_ROLE: ethers.utils.id("MONITOR_ROLE"),
  QC_MANAGER_ROLE: ethers.utils.id("QC_MANAGER_ROLE"),
  ENFORCEMENT_ROLE: ethers.utils.id("ENFORCEMENT_ROLE"),
}

// Expected role assignments
interface RoleAssignment {
  contract: string
  role: string
  expectedHolders: string[] // Can be "deployer", "governance", or contract names
  critical: boolean // If true, missing this role is a critical error
}

// Contract role requirements (updated for v2.0 simplified architecture)
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
    role: "OPERATIONS_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "SystemState",
    role: "EMERGENCY_ROLE",
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
    role: "GOVERNANCE_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "QCManager",
    role: "REGISTRAR_ROLE",
    expectedHolders: ["governance"],
    critical: false,
  },
  {
    contract: "QCManager",
    role: "DISPUTE_ARBITER_ROLE",
    expectedHolders: ["WatchdogEnforcer"],
    critical: true,
  },
  {
    contract: "QCManager",
    role: "MONITOR_ROLE",
    expectedHolders: ["governance"],
    critical: false,
  },
  {
    contract: "QCManager",
    role: "ENFORCEMENT_ROLE",
    expectedHolders: ["WatchdogEnforcer"],
    critical: true,
  },
  {
    contract: "QCManager",
    role: "EMERGENCY_ROLE",
    expectedHolders: ["governance"],
    critical: false,
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
    role: "DISPUTE_ARBITER_ROLE",
    expectedHolders: ["WatchdogEnforcer"],
    critical: true,
  },

  // ReserveOracle (replaced QCReserveLedger)
  {
    contract: "ReserveOracle",
    role: "DEFAULT_ADMIN_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "ReserveOracle",
    role: "ATTESTER_ROLE",
    expectedHolders: ["governance"],
    critical: false,
  },

  // WatchdogEnforcer (simplified from complex watchdog system)
  {
    contract: "WatchdogEnforcer",
    role: "DEFAULT_ADMIN_ROLE",
    expectedHolders: ["governance"],
    critical: true,
  },
  {
    contract: "WatchdogEnforcer",
    role: "ENFORCEMENT_ROLE",
    expectedHolders: ["governance"],
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
    const count = typeof memberCount === 'bigint' ? Number(memberCount) : (memberCount.toNumber ? memberCount.toNumber() : memberCount)

    if (count > 0) {
      // Use getRoleMember to enumerate
      for (let i = 0; i < count; i++) {
        const member = await contract.getRoleMember(role, i)
        holders.push(member)
      }
    } else {
      // Fallback: check known addresses
      const [deployer, governance] = await ethers.getSigners()
      const addresses = [deployer.address, governance.address]

      // Check common contract addresses (updated for v2.0)
      const contractsToCheck = [
        "QCManager",
        "QCMinter",
        "QCRedeemer",
        "QCData",
        "SystemState",
        "ReserveOracle",
        "WatchdogEnforcer",
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

  // Check v2.0 simplified architecture roles
  console.log("Checking v2.0 Account Control contracts...")
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
