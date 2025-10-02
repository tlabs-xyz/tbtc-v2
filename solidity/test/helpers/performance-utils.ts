import { ContractTransaction } from "ethers"
import { expect } from "chai"
import { ethers } from "hardhat"

export interface GasProfile {
  operation: string
  gasUsed: number
  timestamp: number
  blockNumber?: number
}

export interface PerformanceMetrics {
  totalGasUsed: number
  averageGasPerOperation: number
  maxGasOperation: GasProfile
  minGasOperation: GasProfile
  operationCount: number
}

export class PerformanceProfiler {
  private profiles: GasProfile[] = []
  private startTime: number = 0
  private baselines: Map<string, number> = new Map()

  constructor() {
    this.reset()
  }

  /**
   * Start profiling session
   */
  startSession(): void {
    this.startTime = Date.now()
    this.profiles = []
  }

  /**
   * Profile a transaction and store the gas usage
   */
  async profileTransaction(
    operation: string,
    transaction: ContractTransaction
  ): Promise<GasProfile> {
    const receipt = await transaction.wait()

    const profile: GasProfile = {
      operation,
      gasUsed: receipt.gasUsed.toNumber(),
      timestamp: Date.now(),
      blockNumber: receipt.blockNumber,
    }

    this.profiles.push(profile)
    return profile
  }

  /**
   * Profile an async operation (measures time, not gas)
   */
  async profileOperation<T>(
    operation: string,
    operationFn: () => Promise<T>
  ): Promise<{ result: T; duration: number }> {
    const startTime = Date.now()
    const result = await operationFn()
    const duration = Date.now() - startTime

    // Store as a special profile entry
    this.profiles.push({
      operation: `${operation} (time)`,
      gasUsed: duration, // Store duration instead of gas
      timestamp: Date.now(),
    })

    return { result, duration }
  }

  /**
   * Set performance baseline for an operation
   */
  setBaseline(operation: string, expectedGas: number): void {
    this.baselines.set(operation, expectedGas)
  }

  /**
   * Check if operation is within acceptable gas limit
   */
  assertGasWithinLimit(
    operation: string,
    actualGas: number,
    tolerance: number = 0.1
  ): void {
    const baseline = this.baselines.get(operation)
    if (baseline) {
      const maxAllowed = baseline * (1 + tolerance)
      expect(actualGas).to.be.lessThanOrEqual(
        maxAllowed,
        `Gas usage for ${operation} exceeded baseline by more than ${
          tolerance * 100
        }%`
      )
    }
  }

  /**
   * Get performance metrics for the current session
   */
  getMetrics(): PerformanceMetrics {
    if (this.profiles.length === 0) {
      return {
        totalGasUsed: 0,
        averageGasPerOperation: 0,
        maxGasOperation: { operation: "none", gasUsed: 0, timestamp: 0 },
        minGasOperation: { operation: "none", gasUsed: 0, timestamp: 0 },
        operationCount: 0,
      }
    }

    const gasProfiles = this.profiles.filter(
      (p) => !p.operation.includes("(time)")
    )

    const totalGas = gasProfiles.reduce((sum, p) => sum + p.gasUsed, 0)

    const maxGas = gasProfiles.reduce((max, p) =>
      p.gasUsed > max.gasUsed ? p : max
    )

    const minGas = gasProfiles.reduce((min, p) =>
      p.gasUsed < min.gasUsed ? p : min
    )

    return {
      totalGasUsed: totalGas,
      averageGasPerOperation:
        gasProfiles.length > 0 ? totalGas / gasProfiles.length : 0,
      maxGasOperation: maxGas,
      minGasOperation: minGas,
      operationCount: gasProfiles.length,
    }
  }

  /**
   * Get all profiles from current session
   */
  getAllProfiles(): GasProfile[] {
    return [...this.profiles]
  }

  /**
   * Reset profiler state
   */
  reset(): void {
    this.profiles = []
    this.startTime = Date.now()
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const metrics = this.getMetrics()
    const duration = Date.now() - this.startTime

    let report = "\n=== Performance Report ===\n"
    report += `Session Duration: ${duration}ms\n`
    report += `Total Operations: ${metrics.operationCount}\n`
    report += `Total Gas Used: ${metrics.totalGasUsed.toLocaleString()}\n`
    report += `Average Gas per Operation: ${Math.round(
      metrics.averageGasPerOperation
    ).toLocaleString()}\n`
    report += `Most Expensive: ${
      metrics.maxGasOperation.operation
    } (${metrics.maxGasOperation.gasUsed.toLocaleString()} gas)\n`
    report += `Least Expensive: ${
      metrics.minGasOperation.operation
    } (${metrics.minGasOperation.gasUsed.toLocaleString()} gas)\n`

    report += "\n=== Operation Details ===\n"
    this.profiles.forEach((profile) => {
      const gasDisplay = profile.operation.includes("(time)")
        ? `${profile.gasUsed}ms`
        : `${profile.gasUsed.toLocaleString()} gas`

      report += `${profile.operation}: ${gasDisplay}\n`
    })

    return report
  }
}

/**
 * Global profiler instance for integration tests
 */
export const integrationProfiler = new PerformanceProfiler()

/**
 * Decorator to automatically profile contract calls
 */
export function profileGas(operation: string) {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor
  ) {
    const method = descriptor.value
    descriptor.value = async function (...args: any[]) {
      const result = await method.apply(this, args)
      if (result && result.wait) {
        await integrationProfiler.profileTransaction(operation, result)
      }
      return result
    }
  }
}

/**
 * Set standard baselines for tBTC operations
 */
export function setStandardBaselines(): void {
  integrationProfiler.setBaseline("Bridge.requestNewWallet", 94_000)
  integrationProfiler.setBaseline("WalletRegistry.approveDkgResult", 341_000)
  integrationProfiler.setBaseline("Bridge.revealDeposit", 150_000)
  integrationProfiler.setBaseline("Bridge.submitDepositSweepProof", 200_000)
  integrationProfiler.setBaseline("TBTCVault.requestRedemption", 100_000)
  integrationProfiler.setBaseline("Bridge.submitRedemptionProof", 180_000)
}

/**
 * Profile cross-contract interaction costs
 */
export async function profileCrossContractFlow(
  operations: Array<{
    name: string
    operation: () => Promise<ContractTransaction>
  }>
): Promise<PerformanceMetrics> {
  integrationProfiler.startSession()

  for (const { name, operation } of operations) {
    const tx = await operation()
    await integrationProfiler.profileTransaction(name, tx)
  }

  return integrationProfiler.getMetrics()
}

/**
 * Test Performance Monitor
 *
 * Monitors gas usage and execution time for performance testing
 */
export class TestPerformanceMonitor {
  private measurements: Map<
    string,
    {
      gasUsed: number[]
      executionTime: number[]
    }
  > = new Map()

  /**
   * Start monitoring a test operation
   */
  async monitor<T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now()
    const startGasUsed = await this.getGasUsed()

    const result = await operation()

    const endTime = Date.now()
    const endGasUsed = await this.getGasUsed()

    const executionTime = endTime - startTime
    const gasUsed = endGasUsed - startGasUsed

    this.recordMeasurement(operationName, gasUsed, executionTime)

    return result
  }

  /**
   * Get performance report for all monitored operations
   */
  getReport(): string {
    let report = "\n📊 Performance Report\n"
    report += `${"=".repeat(50)}\n`

    for (const [operation, measurements] of this.measurements) {
      const avgGas =
        measurements.gasUsed.reduce((a, b) => a + b, 0) /
        measurements.gasUsed.length

      const avgTime =
        measurements.executionTime.reduce((a, b) => a + b, 0) /
        measurements.executionTime.length

      report += `${operation}:\n`
      report += `  Average Gas: ${Math.round(avgGas).toLocaleString()}\n`
      report += `  Average Time: ${Math.round(avgTime)}ms\n`
      report += `  Samples: ${measurements.gasUsed.length}\n\n`
    }

    return report
  }

  /**
   * Clear all measurements
   */
  reset(): void {
    this.measurements.clear()
  }

  private recordMeasurement(
    operation: string,
    gasUsed: number,
    executionTime: number
  ): void {
    if (!this.measurements.has(operation)) {
      this.measurements.set(operation, { gasUsed: [], executionTime: [] })
    }

    const measurements = this.measurements.get(operation)
    measurements.gasUsed.push(gasUsed)
    measurements.executionTime.push(executionTime)
  }

  private async getGasUsed(): Promise<number> {
    const block = await ethers.provider.getBlock("latest")
    return block.gasUsed.toNumber
      ? block.gasUsed.toNumber()
      : Number(block.gasUsed)
  }
}

// Export singleton instance for easy access
export const testPerformanceMonitor = new TestPerformanceMonitor()
