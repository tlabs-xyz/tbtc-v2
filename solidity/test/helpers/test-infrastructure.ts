/**
 * General Test Infrastructure
 *
 * Provides common testing utilities and infrastructure components
 * that can be shared across different test suites in the TBTC v2 project.
 */

import { ethers } from "hardhat"
import { Contract } from "ethers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { LibraryLinkingHelper } from "../account-control/helpers/library-linking-helper"
import { BitcoinUtils } from "./bitcoin-utils"

/**
 * Test Environment Configuration
 */
export interface TestEnvironment {
  deployer: SignerWithAddress
  user: SignerWithAddress
  governance: SignerWithAddress
  pauser: SignerWithAddress
  arbiter: SignerWithAddress
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
  pauseManager?: Contract
  walletManager?: Contract
}

/**
 * Test Data Generator Options
 */
export interface TestDataOptions {
  addressType?: "p2pkh" | "p2sh" | "bech32"
  network?: "mainnet" | "testnet"
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
      arbiter: signers[4],
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
      const MockReserveOracle = await ethers.getContractFactory(
        "MockReserveOracle"
      )

      this._mockContracts.reserveOracle = await MockReserveOracle.deploy()
      await this._mockContracts.reserveOracle.waitForDeployment()
    }

    // Deploy mock QCPauseManager
    if (!this._mockContracts.pauseManager) {
      const MockQCPauseManager = await ethers.getContractFactory(
        "MockQCPauseManager"
      )

      this._mockContracts.pauseManager = await MockQCPauseManager.deploy()
      await this._mockContracts.pauseManager.waitForDeployment()
    }

    // Deploy mock QCWalletManager
    if (!this._mockContracts.walletManager) {
      const MockQCWalletManager = await ethers.getContractFactory(
        "MockQCWalletManager"
      )

      this._mockContracts.walletManager = await MockQCWalletManager.deploy()
      await this._mockContracts.walletManager.waitForDeployment()
    }

    return this._mockContracts
  }

  /**
   * Deploy QCRedeemer with proper library linking
   */
  async deployQCRedeemer(): Promise<Contract> {
    const mocks = await this.deployMockContracts()

    return LibraryLinkingHelper.deployQCRedeemer(
      await mocks.tbtc.getAddress(),
      await mocks.qcData.getAddress(),
      await mocks.systemState.getAddress()
    )
  }

  /**
   * Deploy QCManager with proper library linking
   */
  async deployQCManager(): Promise<Contract> {
    const mocks = await this.deployMockContracts()

    return LibraryLinkingHelper.deployQCManager(
      await mocks.qcData.getAddress(),
      await mocks.systemState.getAddress(),
      await mocks.reserveOracle.getAddress(),
      await mocks.pauseManager.getAddress(),
      await mocks.walletManager.getAddress()
    )
  }

  /**
   * Generate test Bitcoin address for testing
   */
  generateTestBitcoinAddress(options: TestDataOptions = {}): {
    address: string
    amount: number
  } {
    const address = BitcoinUtils.generateValidBitcoinAddress(
      options.addressType || "p2pkh"
    )

    const amount = 10000 // 10000 satoshis default

    return {
      address,
      amount,
    }
  }

  /**
   * Generate batch test addresses for load testing
   */
  generateBatchTestAddresses(
    count: number,
    options: TestDataOptions = {}
  ): Array<{
    address: string
    amount: number
  }> {
    const results = []

    for (let i = 0; i < count; i++) {
      results.push(this.generateTestBitcoinAddress(options))
    }

    return results
  }

  /**
   * Note: SPV test environment functionality has been removed.
   * QCRedeemer now uses trusted arbiter validation instead of SPV proofs.
   */

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
    return block.timestamp
  }

  /**
   * Utility to snapshot and restore blockchain state
   */
  async snapshot(): Promise<string> {
    return ethers.provider.send("evm_snapshot", [])
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

// Export singleton instance for easy access
export const testInfrastructure = TestInfrastructure.getInstance()
