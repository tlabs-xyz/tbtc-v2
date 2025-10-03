import { FakeContract, smock } from "@defi-wonderland/smock"
import { ethers } from "hardhat"
import type { BigNumber, BytesLike, BigNumberish } from "ethers"
import type { IRelay, IRandomBeacon, ReserveOracle } from "../../typechain"

// Import constants from the centralized location
import { BLOCKCHAIN, BTC_ADDRESSES } from "./constants"

export interface MockConfiguration {
  relay?: {
    currentEpochDifficulty?: BigNumber
    prevEpochDifficulty?: BigNumber
  }
  randomBeacon?: {
    // Random beacon mock configuration
  }
  reserveOracle?: {
    latestPrice?: BigNumber
    priceTimestamp?: number
    isStale?: boolean
  }
}

/**
 * Unified mock factory that provides both FakeContract and plain mock object patterns
 */
export class TestMockFactory {
  private mocks: Map<string, FakeContract<any>> = new Map()

  /**
   * Create a mock IRelay contract using smock
   */
  async createMockRelay(
    config?: MockConfiguration["relay"]
  ): Promise<FakeContract<IRelay>> {
    const mockRelay = await smock.fake<IRelay>("IRelay")

    // Set default behaviors
    mockRelay.getCurrentEpochDifficulty.returns(
      config?.currentEpochDifficulty || BLOCKCHAIN.DEFAULT_DIFFICULTY
    )
    mockRelay.getPrevEpochDifficulty.returns(
      config?.prevEpochDifficulty || BLOCKCHAIN.DEFAULT_DIFFICULTY
    )

    this.mocks.set("relay", mockRelay)
    return mockRelay
  }

  /**
   * Create a plain mock relay object (for tests not using smock)
   */
  createPlainMockRelay(
    difficulty: number = BLOCKCHAIN.DEFAULT_DIFFICULTY
  ) {
    return {
      getCurrentEpochDifficulty: () => difficulty,
      getPrevEpochDifficulty: () => difficulty,
      getBlockDifficulty: () => difficulty,
      getCurrentAndPrevEpochDifficulty: () => [difficulty, difficulty],
      getEpochDifficulty: () => difficulty,
      ready: () => true,
      setCurrentEpochDifficulty: () => Promise.resolve(),
      setPrevEpochDifficulty: () => Promise.resolve(),
      setReady: () => Promise.resolve(),
    }
  }

  /**
   * Create a mock IRandomBeacon contract using smock
   */
  async createMockRandomBeacon(
    config?: MockConfiguration["randomBeacon"]
  ): Promise<FakeContract<IRandomBeacon>> {
    const mockRandomBeacon = await smock.fake<IRandomBeacon>("IRandomBeacon")

    // Set default behaviors for random beacon
    // Add specific mock behaviors as needed

    this.mocks.set("randomBeacon", mockRandomBeacon)
    return mockRandomBeacon
  }

  /**
   * Create a mock transaction receipt (plain object)
   */
  createMockTransactionReceipt(
    overrides: Partial<{
      gasUsed: BigNumberish
      status: number
      blockNumber: number
    }> = {}
  ) {
    const receipt = {
      gasUsed: ethers.BigNumber.from(overrides.gasUsed ?? 100000),
      status: overrides.status ?? 1,
      blockNumber: overrides.blockNumber ?? BLOCKCHAIN.TEST_BLOCK_HEIGHT,
      wait: () => Promise.resolve(receipt),
    }
    return receipt
  }

  /**
   * Create a plain mock contract with common patterns
   */
  createMockContract(methods: Record<string, any> = {}) {
    const defaultMethods = {
      connect: function() { return this },
      deployed: () => Promise.resolve(this),
      interface: {
        encodeFunctionData: () => "0x",
        decodeFunctionResult: () => [],
      },
    }

    return {
      ...defaultMethods,
      ...methods,
    }
  }

  /**
   * Create a mock signer with standard properties
   */
  createMockSigner(address?: string) {
    const signerAddress = address ?? ethers.Wallet.createRandom().address
    return {
      address: signerAddress,
      getAddress: async () => signerAddress,
      signMessage: async () => "0x",
      connect: function() { return this },
    }
  }

  /**
   * Create mock Bitcoin transaction data
   */
  createMockBitcoinTx(
    overrides: Partial<{
      version: BytesLike
      inputVector: BytesLike
      outputVector: BytesLike
      locktime: BytesLike
    }> = {}
  ) {
    return {
      version: overrides.version ?? "0x01000000",
      inputVector:
        overrides.inputVector ?? `0x01${"00".repeat(36)}00${"00".repeat(4)}`,
      outputVector: overrides.outputVector ?? `0x01${"00".repeat(8)}00`,
      locktime: overrides.locktime ?? "0x00000000",
    }
  }

  /**
   * Create a mock ReserveOracle contract for QC tests
   */
  async createMockReserveOracle(
    config?: MockConfiguration["reserveOracle"]
  ): Promise<FakeContract<ReserveOracle>> {
    const mockOracle = await smock.fake<ReserveOracle>("ReserveOracle")

    // Set default oracle behaviors
    mockOracle.latestRoundData.returns([
      0, // roundId
      config?.latestPrice || 50000, // price (e.g., $50,000 for BTC)
      0, // startedAt
      config?.priceTimestamp || Math.floor(Date.now() / 1000), // updatedAt
      0, // answeredInRound
    ])

    // Configure staleness check
    if (config?.isStale) {
      const staleTimestamp = Math.floor(Date.now() / 1000) - 3700 // 1 hour + 100 seconds ago
      mockOracle.latestRoundData.returns([
        0,
        config.latestPrice || 50000,
        0,
        staleTimestamp,
        0,
      ])
    }

    this.mocks.set("reserveOracle", mockOracle)
    return mockOracle
  }

  /**
   * Get a previously created mock by name
   */
  getMock<T>(name: string): FakeContract<T> | undefined {
    return this.mocks.get(name) as FakeContract<T>
  }

  /**
   * Reset all mocks to their default state
   */
  resetAllMocks(): void {
    for (const mock of this.mocks.values()) {
      mock.reset()
    }
  }

  /**
   * Clear all mocks
   */
  clearAllMocks(): void {
    this.mocks.clear()
  }

  /**
   * Create a standard integration test mock set
   */
  async createIntegrationMockSet(config?: MockConfiguration): Promise<{
    relay: FakeContract<IRelay>
    randomBeacon: FakeContract<IRandomBeacon>
  }> {
    const relay = await this.createMockRelay(config?.relay)
    const randomBeacon = await this.createMockRandomBeacon(config?.randomBeacon)

    return {
      relay,
      randomBeacon,
    }
  }

  /**
   * Create QC-specific mock set
   */
  async createQCMockSet(config?: MockConfiguration): Promise<{
    reserveOracle: FakeContract<ReserveOracle>
  }> {
    const reserveOracle = await this.createMockReserveOracle(
      config?.reserveOracle
    )

    return {
      reserveOracle,
    }
  }

  /**
   * Setup mock behaviors for cross-contract integration scenarios
   */
  setupCrossContractMocks(scenarios: {
    [contractName: string]: {
      [methodName: string]: any
    }
  }): void {
    Object.entries(scenarios).forEach(([contractName, methods]) => {
      const mock = this.getMock(contractName)
      if (mock) {
        Object.entries(methods).forEach(([methodName, returnValue]) => {
          mock[methodName].returns(returnValue)
        })
      }
    })
  }

  /**
   * Apply consistent mock behavior across all integration tests
   */
  applyStandardIntegrationBehavior(): void {
    const relay = this.getMock<IRelay>("relay")
    if (relay) {
      relay.getCurrentEpochDifficulty.returns(BLOCKCHAIN.DEFAULT_DIFFICULTY)
      relay.getPrevEpochDifficulty.returns(BLOCKCHAIN.DEFAULT_DIFFICULTY)
    }

    // Add other standard behaviors as needed
  }
}

// Export convenience functions for backward compatibility
export const createMockRelay = (difficulty?: number) => 
  new TestMockFactory().createPlainMockRelay(difficulty)

export const createMockTransactionReceipt = (overrides?: any) =>
  new TestMockFactory().createMockTransactionReceipt(overrides)

export const createMockContract = (methods?: Record<string, any>) =>
  new TestMockFactory().createMockContract(methods)

export const createMockSigner = (address?: string) =>
  new TestMockFactory().createMockSigner(address)

export const createMockBitcoinTx = (overrides?: any) =>
  new TestMockFactory().createMockBitcoinTx(overrides)
