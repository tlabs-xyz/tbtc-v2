/**
 * General Test Infrastructure
 * 
 * Provides common testing utilities and infrastructure components
 * that can be shared across different test suites in the TBTC v2 project.
 */

import { ethers } from "hardhat"
import { Contract } from "ethers"
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers"
import { LibraryLinkingHelper } from "./libraryLinkingHelper"
import { SPVTestData, TxInfo, SPVProof } from "./SPVTestData"
import { BitcoinTransactionUtils } from "./BitcoinTransactionUtils"

/**
 * Test Environment Configuration
 */
export interface TestEnvironment {
  deployer: HardhatEthersSigner
  user: HardhatEthersSigner
  governance: HardhatEthersSigner
  pauser: HardhatEthersSigner
  arbiter: HardhatEthersSigner
}

/**
 * Mock Contract Instances
 */
export interface MockContracts {
  tbtc?: Contract
  bank?: Contract
  bridge?: Contract
  lightRelay?: Contract
  qcData?: Contract
  systemState?: Contract
  reserveOracle?: Contract
}

/**
 * Test Data Generator Options
 */
export interface TestDataOptions {
  addressType?: 'p2pkh' | 'p2sh' | 'bech32'
  network?: 'mainnet' | 'testnet'
  includeChange?: boolean
  feeRate?: number // satoshis per byte
}

/**
 * General Test Infrastructure Class
 * 
 * This class provides reusable testing components and utilities
 * that help set up consistent test environments across the project.
 */
export class TestInfrastructure {
  private static _instance: TestInfrastructure
  private _environment?: TestEnvironment
  private _mockContracts: MockContracts = {}

  /**
   * Singleton pattern for test infrastructure
   */
  static getInstance(): TestInfrastructure {
    if (!TestInfrastructure._instance) {
      TestInfrastructure._instance = new TestInfrastructure()
    }
    return TestInfrastructure._instance
  }

  /**
   * Set up the basic test environment with signers
   */
  async setupTestEnvironment(): Promise<TestEnvironment> {
    if (this._environment) {
      return this._environment
    }

    const signers = await ethers.getSigners()
    
    this._environment = {
      deployer: signers[0],
      user: signers[1],
      governance: signers[2],
      pauser: signers[3],
      arbiter: signers[4]
    }

    return this._environment
  }

  /**
   * Deploy mock contracts for testing
   */
  async deployMockContracts(): Promise<MockContracts> {
    const env = await this.setupTestEnvironment()

    // Deploy mock TBTC token
    if (!this._mockContracts.tbtc) {
      const MockTBTCToken = await ethers.getContractFactory("MockTBTCToken")
      this._mockContracts.tbtc = await MockTBTCToken.deploy()
      await this._mockContracts.tbtc.waitForDeployment()
    }

    // Deploy mock Bank
    if (!this._mockContracts.bank) {
      const MockBank = await ethers.getContractFactory("MockBank")
      this._mockContracts.bank = await MockBank.deploy()
      await this._mockContracts.bank.waitForDeployment()
    }

    // Deploy mock Bridge
    if (!this._mockContracts.bridge) {
      const MockBridge = await ethers.getContractFactory("MockBridge")
      this._mockContracts.bridge = await MockBridge.deploy()
      await this._mockContracts.bridge.waitForDeployment()
    }

    // Deploy TestRelay (Light Relay)
    if (!this._mockContracts.lightRelay) {
      const TestRelay = await ethers.getContractFactory("TestRelay")
      this._mockContracts.lightRelay = await TestRelay.deploy()
      await this._mockContracts.lightRelay.waitForDeployment()
      
      // Set reasonable difficulty values for testing
      await this._mockContracts.lightRelay.setCurrentEpochDifficulty(1000)
      await this._mockContracts.lightRelay.setPrevEpochDifficulty(900)
    }

    // Deploy mock QCData
    if (!this._mockContracts.qcData) {
      const MockQCData = await ethers.getContractFactory("MockQCData")
      this._mockContracts.qcData = await MockQCData.deploy()
      await this._mockContracts.qcData.waitForDeployment()
    }

    // Deploy mock SystemState
    if (!this._mockContracts.systemState) {
      const MockSystemState = await ethers.getContractFactory("MockSystemState")
      this._mockContracts.systemState = await MockSystemState.deploy()
      await this._mockContracts.systemState.waitForDeployment()
    }

    // Deploy mock ReserveOracle
    if (!this._mockContracts.reserveOracle) {
      const MockReserveOracle = await ethers.getContractFactory("MockReserveOracle")
      this._mockContracts.reserveOracle = await MockReserveOracle.deploy()
      await this._mockContracts.reserveOracle.waitForDeployment()
    }

    return this._mockContracts
  }

  /**
   * Deploy QCRedeemer with proper library linking
   */
  async deployQCRedeemer(): Promise<Contract> {
    const mocks = await this.deployMockContracts()
    
    return await LibraryLinkingHelper.deployQCRedeemer(
      await mocks.tbtc!.getAddress(),
      await mocks.qcData!.getAddress(),
      await mocks.systemState!.getAddress(),
      await mocks.lightRelay!.getAddress(),
      1 // txProofDifficultyFactor for testing
    )
  }

  /**
   * Deploy QCManager with proper library linking
   */
  async deployQCManager(): Promise<Contract> {
    const mocks = await this.deployMockContracts()

    return await LibraryLinkingHelper.deployQCManager(
      await mocks.qcData!.getAddress(),
      await mocks.systemState!.getAddress(),
      await mocks.reserveOracle!.getAddress()
    )
  }

  /**
   * Generate test transaction data with specified options
   */
  generateTestTransactionData(options: TestDataOptions = {}): {
    txInfo: TxInfo
    proof: SPVProof
    address: string
    amount: number
  } {
    const address = BitcoinTransactionUtils.generateValidBitcoinAddress(
      options.addressType || 'p2pkh'
    )
    const amount = 10000 // 10000 satoshis default
    
    const txHex = BitcoinTransactionUtils.createRedemptionTransaction(
      "sender_address_placeholder",
      address,
      amount
    )

    const txInfo = BitcoinTransactionUtils.txHexToTxInfo(txHex)
    const proof = SPVTestData.generateValidSPVProof()

    return {
      txInfo,
      proof,
      address,
      amount
    }
  }

  /**
   * Generate batch test data for load testing
   */
  generateBatchTestData(count: number, options: TestDataOptions = []): Array<{
    txInfo: TxInfo
    proof: SPVProof
    address: string
    amount: number
  }> {
    const results = []
    
    for (let i = 0; i < count; i++) {
      results.push(this.generateTestTransactionData(options))
    }
    
    return results
  }

  /**
   * Set up SPV test environment with proper relay configuration
   */
  async setupSPVTestEnvironment(): Promise<{
    spvState: Contract
    testRelay: Contract
    qcRedeemerSPV: Contract
  }> {
    const mocks = await this.deployMockContracts()
    
    // Deploy SPV State
    const SPVState = await ethers.getContractFactory("SPVState")
    const spvState = await SPVState.deploy()
    await spvState.waitForDeployment()

    // Deploy QCRedeemerSPV test contract
    const libraries = await LibraryLinkingHelper.deployAllLibraries()
    const QCRedeemerSPVTest = await ethers.getContractFactory("QCRedeemerSPVTest", {
      libraries: {
        SharedSPVCore: libraries.SharedSPVCore,
        QCRedeemerSPV: libraries.QCRedeemerSPV,
      },
    })
    const qcRedeemerSPV = await QCRedeemerSPVTest.deploy(
      await mocks.lightRelay!.getAddress(),
      1 // txProofDifficultyFactor
    )
    await qcRedeemerSPV.waitForDeployment()

    return {
      spvState,
      testRelay: mocks.lightRelay!,
      qcRedeemerSPV
    }
  }

  /**
   * Create a realistic test scenario with multiple transactions
   */
  createTestScenario(name: string): TestScenario {
    return new TestScenario(name, this)
  }

  /**
   * Clean up test environment (reset singleton state)
   */
  reset(): void {
    this._environment = undefined
    this._mockContracts = {}
  }

  /**
   * Get current test environment
   */
  getEnvironment(): TestEnvironment | undefined {
    return this._environment
  }

  /**
   * Get deployed mock contracts
   */
  getMockContracts(): MockContracts {
    return this._mockContracts
  }

  /**
   * Utility to advance time in test environment
   */
  async advanceTime(seconds: number): Promise<void> {
    await ethers.provider.send("evm_increaseTime", [seconds])
    await ethers.provider.send("evm_mine", [])
  }

  /**
   * Utility to advance blocks in test environment
   */
  async advanceBlocks(blocks: number): Promise<void> {
    for (let i = 0; i < blocks; i++) {
      await ethers.provider.send("evm_mine", [])
    }
  }

  /**
   * Utility to get current block timestamp
   */
  async getCurrentTimestamp(): Promise<number> {
    const block = await ethers.provider.getBlock("latest")
    return block!.timestamp
  }

  /**
   * Utility to snapshot and restore blockchain state
   */
  async snapshot(): Promise<string> {
    return await ethers.provider.send("evm_snapshot", [])
  }

  async revert(snapshotId: string): Promise<void> {
    await ethers.provider.send("evm_revert", [snapshotId])
  }
}

/**
 * Test Scenario Builder
 * 
 * Helps create complex test scenarios with multiple steps
 */
export class TestScenario {
  private steps: Array<() => Promise<void>> = []
  private context: Map<string, any> = new Map()

  constructor(
    public readonly name: string,
    private infrastructure: TestInfrastructure
  ) {}

  /**
   * Add a step to the test scenario
   */
  addStep(description: string, step: () => Promise<void>): TestScenario {
    this.steps.push(async () => {
      console.log(`  Step: ${description}`)
      await step()
    })
    return this
  }

  /**
   * Set context data for the scenario
   */
  setContext(key: string, value: any): TestScenario {
    this.context.set(key, value)
    return this
  }

  /**
   * Get context data from the scenario
   */
  getContext<T>(key: string): T | undefined {
    return this.context.get(key)
  }

  /**
   * Execute all steps in the scenario
   */
  async execute(): Promise<void> {
    console.log(`\nExecuting test scenario: ${this.name}`)
    
    for (let i = 0; i < this.steps.length; i++) {
      console.log(`  [${i + 1}/${this.steps.length}]`)
      await this.steps[i]()
    }
    
    console.log(`  ✓ Scenario "${this.name}" completed successfully\n`)
  }

  /**
   * Execute scenario with automatic cleanup
   */
  async executeWithCleanup(): Promise<void> {
    const snapshot = await this.infrastructure.snapshot()
    
    try {
      await this.execute()
    } finally {
      await this.infrastructure.revert(snapshot)
    }
  }
}

/**
 * Test Performance Monitor
 * 
 * Monitors gas usage and execution time for performance testing
 */
export class TestPerformanceMonitor {
  private measurements: Map<string, {
    gasUsed: number[]
    executionTime: number[]
  }> = new Map()

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
    report += "=".repeat(50) + "\n"

    for (const [operation, measurements] of this.measurements) {
      const avgGas = measurements.gasUsed.reduce((a, b) => a + b, 0) / measurements.gasUsed.length
      const avgTime = measurements.executionTime.reduce((a, b) => a + b, 0) / measurements.executionTime.length
      
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

  private recordMeasurement(operation: string, gasUsed: number, executionTime: number): void {
    if (!this.measurements.has(operation)) {
      this.measurements.set(operation, { gasUsed: [], executionTime: [] })
    }

    const measurements = this.measurements.get(operation)!
    measurements.gasUsed.push(gasUsed)
    measurements.executionTime.push(executionTime)
  }

  private async getGasUsed(): Promise<number> {
    const block = await ethers.provider.getBlock("latest")
    return block!.gasUsed.toNumber ? block!.gasUsed.toNumber() : Number(block!.gasUsed)
  }
}

// Export singleton instance for easy access
export const testInfrastructure = TestInfrastructure.getInstance()