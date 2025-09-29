import { exec } from "child_process"
import { promisify } from "util"
import chalk from "chalk"

const execAsync = promisify(exec)

interface TestResult {
  name: string
  passed: boolean
  duration: number
  error?: string
}

class IntegrationTestRunner {
  private results: TestResult[] = []

  async runAllTests(): Promise<void> {
    console.log(chalk.blue("🚀 Starting Account Control Integration Tests"))
    console.log(chalk.blue("=".repeat(60)))

    const testFiles = [
      "SPVIntegrationFlows.test.ts", 
      "SPVLibraryIntegration.test.ts",
    ]

    for (const testFile of testFiles) {
      await this.runTest(testFile)
    }

    this.printSummary()
  }

  public async runTest(testFile: string): Promise<void> {
    const testName = testFile.replace(".test.ts", "")
    const testPath = `test/integration/account-control/${testFile}`

    console.log(chalk.yellow(`\n📋 Running ${testName}...`))

    const startTime = Date.now()

    try {
      const { stdout, stderr } = await execAsync(
        `npx hardhat test ${testPath} --network hardhat`,
        { timeout: 300000 } // 5 minutes timeout
      )

      const duration = Date.now() - startTime

      if (stderr && stderr.includes("Error") && !stderr.includes("Warning")) {
        throw new Error(stderr)
      }

      // Parse output for test results
      const passed = stdout.includes("passing") && !stdout.includes("failing")

      this.results.push({
        name: testName,
        passed,
        duration,
      })

      console.log(chalk.green(`✅ ${testName} - PASSED (${duration}ms)`))

      // Show test details
      if (stdout.includes("passing")) {
        const passingMatch = stdout.match(/(\d+) passing/)
        if (passingMatch) {
          console.log(chalk.gray(`   ${passingMatch[1]} tests passed`))
        }
      }
    } catch (error) {
      const duration = Date.now() - startTime

      this.results.push({
        name: testName,
        passed: false,
        duration,
        error: error.message,
      })

      console.log(chalk.red(`❌ ${testName} - FAILED (${duration}ms)`))
      console.log(chalk.red(`   Error: ${error.message.split("\n")[0]}`))
    }
  }

  private printSummary(): void {
    console.log(chalk.blue(`\n${"=".repeat(60)}`))
    console.log(chalk.blue("📊 Integration Test Summary"))
    console.log(chalk.blue("=".repeat(60)))

    const totalTests = this.results.length
    const passedTests = this.results.filter((r) => r.passed).length
    const failedTests = totalTests - passedTests
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0)

    console.log(chalk.white(`Total Tests: ${totalTests}`))
    console.log(chalk.green(`Passed: ${passedTests}`))
    console.log(chalk.red(`Failed: ${failedTests}`))
    console.log(chalk.white(`Total Duration: ${totalDuration}ms`))
    console.log(
      chalk.white(
        `Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`
      )
    )

    console.log(chalk.blue("\n📋 Detailed Results:"))

    this.results.forEach((result) => {
      const status = result.passed
        ? chalk.green("✅ PASS")
        : chalk.red("❌ FAIL")
      const duration = chalk.gray(`(${result.duration}ms)`)

      console.log(`${status} ${result.name} ${duration}`)

      if (!result.passed && result.error) {
        console.log(chalk.red(`   Error: ${result.error.split("\n")[0]}`))
      }
    })

    if (failedTests > 0) {
      console.log(
        chalk.red("\n⚠️  Some tests failed. Please review the errors above.")
      )
      process.exit(1)
    } else {
      console.log(
        chalk.green("\n🎉 All integration tests passed successfully!")
      )
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2)

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Account Control Integration Test Runner

Usage:
  npm run test:integration              # Run all integration tests
  npm run test:integration -- --test=QCOnboarding  # Run specific test
  npm run test:integration -- --help    # Show this help

Available Tests:
  - QCOnboarding: QC onboarding flow with wallet registration
  - ReserveAttestation: Reserve attestation and solvency checks
  - QCMinting: Complete minting flow from user to tBTC tokens
  - UserRedemption: Redemption flow with fulfillment
  - CompleteFlow: End-to-end system integration test

Options:
  --test=<name>     Run specific test only
  --verbose         Show detailed test output
  --help, -h        Show this help message
`)
    return
  }

  const runner = new IntegrationTestRunner()

  const specificTest = args.find((arg) => arg.startsWith("--test="))
  if (specificTest) {
    const testName = specificTest.split("=")[1]
    const testFile = `${testName}Integration.test.ts`
    await runner.runTest(testFile)
  } else {
    await runner.runAllTests()
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error)
}

export { IntegrationTestRunner }
