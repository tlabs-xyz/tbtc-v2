import { expect } from "chai"
import type { ContractTransaction, ContractReceipt } from "ethers"
import { spvTestConfig } from "../fixtures/test-data"

/**
 * Gas measurement and analysis utilities for account-control tests
 * Provides standardized methods for gas testing and optimization
 */

/**
 * Gas usage result structure
 */
export interface GasUsageResult {
  gasUsed: number
  txHash: string
  functionName: string
  timestamp: number
}

/**
 * Gas comparison result
 */
export interface GasComparisonResult {
  baseline: GasUsageResult
  current: GasUsageResult
  difference: number
  percentageChange: number
  improved: boolean
}

/**
 * Measures gas usage for a transaction
 */
export async function measureGasUsage(
  tx: ContractTransaction,
  functionName: string = "unknown"
): Promise<GasUsageResult> {
  const receipt = await tx.wait()

  return {
    gasUsed: receipt.gasUsed.toNumber(),
    txHash: tx.hash,
    functionName,
    timestamp: Date.now(),
  }
}

/**
 * Executes a function and measures its gas usage
 */
export async function executeAndMeasureGas<T>(
  contractFunction: () => Promise<ContractTransaction>,
  functionName: string
): Promise<{ result: ContractReceipt; gasUsage: GasUsageResult }> {
  const tx = await contractFunction()
  const receipt = await tx.wait()

  const gasUsage: GasUsageResult = {
    gasUsed: receipt.gasUsed.toNumber(),
    txHash: tx.hash,
    functionName,
    timestamp: Date.now(),
  }

  return { result: receipt, gasUsage }
}

/**
 * Asserts that gas usage is within expected range
 */
export function assertGasUsed(
  actualGas: number,
  minExpected: number,
  maxExpected: number,
  functionName?: string
): void {
  const context = functionName ? ` for ${functionName}` : ""
  expect(actualGas).to.be.gte(
    minExpected,
    `Gas usage${context} is too low: ${actualGas} < ${minExpected}`
  )
  expect(actualGas).to.be.lte(
    maxExpected,
    `Gas usage${context} is too high: ${actualGas} > ${maxExpected}`
  )
}

/**
 * Asserts that gas usage is within a percentage of expected value
 */
export function assertGasWithinPercentage(
  actualGas: number,
  expectedGas: number,
  tolerancePercent: number,
  functionName?: string
): void {
  const tolerance = expectedGas * (tolerancePercent / 100)
  const minExpected = expectedGas - tolerance
  const maxExpected = expectedGas + tolerance

  assertGasUsed(actualGas, minExpected, maxExpected, functionName)
}

/**
 * Compares gas usage between two measurements
 */
export function compareGasUsage(
  baseline: GasUsageResult,
  current: GasUsageResult
): GasComparisonResult {
  const difference = current.gasUsed - baseline.gasUsed
  const percentageChange = (difference / baseline.gasUsed) * 100
  const improved = difference < 0

  return {
    baseline,
    current,
    difference,
    percentageChange,
    improved,
  }
}

/**
 * Profiles gas usage across multiple function calls
 */
export async function profileGasUsage(
  testCases: Array<{
    name: string
    execute: () => Promise<ContractTransaction>
  }>
): Promise<GasUsageResult[]> {
  const results: GasUsageResult[] = []

  for (const testCase of testCases) {
    const tx = await testCase.execute()
    const gasUsage = await measureGasUsage(tx, testCase.name)
    results.push(gasUsage)
  }

  return results
}

/**
 * Benchmarks a function call multiple times and returns statistics
 */
export async function benchmarkGasUsage(
  execute: () => Promise<ContractTransaction>,
  functionName: string,
  iterations: number = 5
): Promise<{
  functionName: string
  iterations: number
  results: GasUsageResult[]
  statistics: {
    min: number
    max: number
    average: number
    median: number
    standardDeviation: number
  }
}> {
  const results: GasUsageResult[] = []

  for (let i = 0; i < iterations; i++) {
    const tx = await execute()
    const gasUsage = await measureGasUsage(tx, functionName)
    results.push(gasUsage)
  }

  const gasValues = results.map(r => r.gasUsed).sort((a, b) => a - b)
  const sum = gasValues.reduce((a, b) => a + b, 0)
  const average = sum / gasValues.length

  const median = gasValues.length % 2 === 0
    ? (gasValues[gasValues.length / 2 - 1] + gasValues[gasValues.length / 2]) / 2
    : gasValues[Math.floor(gasValues.length / 2)]

  const variance = gasValues.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / gasValues.length
  const standardDeviation = Math.sqrt(variance)

  return {
    functionName,
    iterations,
    results,
    statistics: {
      min: Math.min(...gasValues),
      max: Math.max(...gasValues),
      average,
      median,
      standardDeviation,
    },
  }
}

/**
 * Creates a gas reporter for test suites
 */
export function createGasReporter() {
  const measurements: GasUsageResult[] = []

  return {
    /**
     * Records a gas measurement
     */
    record(gasUsage: GasUsageResult): void {
      measurements.push(gasUsage)
    },

    /**
     * Records gas usage from a transaction
     */
    async recordFromTransaction(
      tx: ContractTransaction,
      functionName: string
    ): Promise<GasUsageResult> {
      const gasUsage = await measureGasUsage(tx, functionName)
      this.record(gasUsage)
      return gasUsage
    },

    /**
     * Gets all recorded measurements
     */
    getMeasurements(): GasUsageResult[] {
      return [...measurements]
    },

    /**
     * Gets measurements for a specific function
     */
    getMeasurementsForFunction(functionName: string): GasUsageResult[] {
      return measurements.filter(m => m.functionName === functionName)
    },

    /**
     * Generates a summary report
     */
    generateReport(): {
      totalMeasurements: number
      functions: Array<{
        name: string
        count: number
        totalGas: number
        averageGas: number
        minGas: number
        maxGas: number
      }>
    } {
      const functionGroups = measurements.reduce((groups, measurement) => {
        const name = measurement.functionName
        if (!groups[name]) {
          groups[name] = []
        }
        groups[name].push(measurement)
        return groups
      }, {} as Record<string, GasUsageResult[]>)

      const functions = Object.entries(functionGroups).map(([name, results]) => {
        const gasValues = results.map(r => r.gasUsed)
        return {
          name,
          count: results.length,
          totalGas: gasValues.reduce((a, b) => a + b, 0),
          averageGas: gasValues.reduce((a, b) => a + b, 0) / gasValues.length,
          minGas: Math.min(...gasValues),
          maxGas: Math.max(...gasValues),
        }
      })

      return {
        totalMeasurements: measurements.length,
        functions,
      }
    },

    /**
     * Clears all recorded measurements
     */
    clear(): void {
      measurements.length = 0
    },
  }
}

/**
 * Predefined gas expectations for common operations
 */
export const GAS_EXPECTATIONS = {
  SPV_VALIDATION: {
    min: 50000,
    max: 100000,
  },
  WALLET_REGISTRATION: {
    min: 100000,
    max: 200000,
  },
  REDEMPTION_INITIATION: {
    min: 80000,
    max: 150000,
  },
  REDEMPTION_FULFILLMENT: {
    min: 120000,
    max: 250000,
  },
  STATE_UPDATE: {
    min: 30000,
    max: 80000,
  },
} as const

/**
 * Legacy gas testing utilities
 */
export const gasTestUtils = {
  measureGasUsage,
  executeAndMeasureGas,
  assertGasUsed,
  assertGasWithinPercentage,
  compareGasUsage,
  profileGasUsage,
  benchmarkGasUsage,
  createGasReporter,
  GAS_EXPECTATIONS,
}