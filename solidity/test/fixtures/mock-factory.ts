import { FakeContract, smock } from "@defi-wonderland/smock"
import type { BigNumber } from "ethers"
import type { IRelay, IRandomBeacon, ReserveOracle } from "../../typechain"

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

export class TestMockFactory {
  private mocks: Map<string, FakeContract<any>> = new Map()

  /**
   * Create a mock IRelay contract
   */
  async createMockRelay(
    config?: MockConfiguration["relay"]
  ): Promise<FakeContract<IRelay>> {
    const mockRelay = await smock.fake<IRelay>("IRelay")

    // Set default behaviors
    mockRelay.getCurrentEpochDifficulty.returns(
      config?.currentEpochDifficulty || 1000000
    )
    mockRelay.getPrevEpochDifficulty.returns(
      config?.prevEpochDifficulty || 1000000
    )

    this.mocks.set("relay", mockRelay)
    return mockRelay
  }

  /**
   * Create a mock IRandomBeacon contract
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
      relay.getCurrentEpochDifficulty.returns(1000000)
      relay.getPrevEpochDifficulty.returns(1000000)
    }

    // Add other standard behaviors as needed
  }
}
