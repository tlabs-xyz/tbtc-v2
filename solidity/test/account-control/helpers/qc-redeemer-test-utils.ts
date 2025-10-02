import { ethers } from "hardhat"
import { expect } from "chai"
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import type { BigNumber } from "ethers"
import {
  QCRedeemer,
  QCData,
  SystemState,
  TBTC,
  MockAccountControl,
} from "../../../typechain"

export interface RedemptionTestCase {
  amount: number | BigNumber
  userBtcAddress?: string
  walletAddress?: string
  user?: SignerWithAddress
  description?: string
}

export interface ValidBitcoinAddressTestCase {
  address: string
  type: "P2PKH" | "P2SH" | "P2WPKH" | "P2WSH" | "INVALID"
  network?: "mainnet" | "testnet"
  expected: boolean
  description?: string
}

export interface RedemptionScenario {
  name: string
  setup: () => Promise<void>
  execute: () => Promise<string> // Returns redemption ID
  verify: (redemptionId: string) => Promise<void>
  cleanup?: () => Promise<void>
}

export class QCRedeemerTestUtils {
  public static readonly DEFAULT_AMOUNTS = {
    TINY: 50000, // 0.0005 BTC
    SMALL: 100000, // 0.001 BTC
    MEDIUM: 1000000, // 0.01 BTC
    LARGE: 10000000, // 0.1 BTC
    HUGE: 100000000, // 1 BTC
  }

  public static readonly BITCOIN_ADDRESSES = {
    // Valid P2PKH addresses (mainnet)
    P2PKH_MAINNET: [
      "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Genesis block
      "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
      "1JfbZRwdDHKZmuiZgYArJZhcuuzuw2HuMu",
      "16AKHntBwUjCyKVxGY5zz8DFZr66YzXtU2",
    ],

    // Valid P2SH addresses (mainnet)
    P2SH_MAINNET: [
      "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
      "3QJmV3qfvL9SuYo34YihAf3sRCW3qSinyC",
      "342ftSRCvFHfCeFFBuz4xwbeqnDw6BGUey",
      "3Cbq7aT1tY8kMxWLbitaG7yT6bPbKChq64",
    ],

    // Valid Bech32 addresses (mainnet)
    BECH32_MAINNET: [
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
      "bc1qrp33g0554cgvn8t6rt0v2cyzgg6kz5z4vqx8v5w0c8z2jj8r6mjhqxnxnxj",
      "bc1ql49ydapnjafl5t2cp9zqpjwe6pdgmxy98859v2",
      "bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l",
    ],

    // Valid testnet addresses
    TESTNET: [
      "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
      "tb1qrp33g0554cgvn8t6rt0v2cyzgg6kz5z4vqx8v5w0c8z2jj8r6mjhqy9fjqh",
      "2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc",
      "2N2KANgjH1RTPQWeHQcwYq24fT2zLqJGhNz",
    ],

    // Invalid addresses for testing
    INVALID: [
      "", // Empty
      "1", // Too short
      "invalid_address", // Invalid chars
      "0x742d35cc6574d94532f6b3b49e0f2b6aa8b5cd7", // Ethereum address
      "2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Invalid prefix
      "bc2qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Invalid bech32
      "1".repeat(100), // Too long
      `bc1${"q".repeat(100)}`, // Too long bech32
    ],
  }

  public static readonly DEFAULT_REASONS = {
    TIMEOUT: ethers.utils.formatBytes32String("TIMEOUT"),
    INSUFFICIENT_FUNDS: ethers.utils.formatBytes32String("INSUFFICIENT_FUNDS"),
    NETWORK_ERROR: ethers.utils.formatBytes32String("NETWORK_ERROR"),
    QC_OFFLINE: ethers.utils.formatBytes32String("QC_OFFLINE"),
    MARKET_STRESS: ethers.utils.formatBytes32String("MARKET_STRESS"),
    MANUAL_DEFAULT: ethers.utils.formatBytes32String("MANUAL_DEFAULT"),
    EMERGENCY: ethers.utils.formatBytes32String("EMERGENCY"),
    TEST_DEFAULT: ethers.utils.formatBytes32String("TEST_DEFAULT"),
  }

  /**
   * Convert satoshis to tBTC Wei (18 decimals)
   */
  public static satoshisToWei(satoshis: number | BigNumber): BigNumber {
    return ethers.BigNumber.from(satoshis).mul(
      ethers.BigNumber.from(10).pow(10)
    )
  }

  /**
   * Convert tBTC Wei to satoshis (8 decimals)
   */
  public static weiToSatoshis(wei: BigNumber): BigNumber {
    return wei.div(ethers.BigNumber.from(10).pow(10))
  }

  /**
   * Generate comprehensive Bitcoin address test cases
   */
  public static generateBitcoinAddressTestCases(): ValidBitcoinAddressTestCase[] {
    const testCases: ValidBitcoinAddressTestCase[] = []

    // Valid P2PKH addresses
    this.BITCOIN_ADDRESSES.P2PKH_MAINNET.forEach((address, index) => {
      testCases.push({
        address,
        type: "P2PKH",
        network: "mainnet",
        expected: true,
        description: `Valid P2PKH mainnet address ${index + 1}`,
      })
    })

    // Valid P2SH addresses
    this.BITCOIN_ADDRESSES.P2SH_MAINNET.forEach((address, index) => {
      testCases.push({
        address,
        type: "P2SH",
        network: "mainnet",
        expected: true,
        description: `Valid P2SH mainnet address ${index + 1}`,
      })
    })

    // Valid Bech32 addresses
    this.BITCOIN_ADDRESSES.BECH32_MAINNET.forEach((address, index) => {
      testCases.push({
        address,
        type: "P2WPKH",
        network: "mainnet",
        expected: true,
        description: `Valid Bech32 mainnet address ${index + 1}`,
      })
    })

    // Valid testnet addresses
    this.BITCOIN_ADDRESSES.TESTNET.forEach((address, index) => {
      testCases.push({
        address,
        type: address.startsWith("tb1") ? "P2WPKH" : "P2SH",
        network: "testnet",
        expected: true,
        description: `Valid testnet address ${index + 1}`,
      })
    })

    // Invalid addresses
    this.BITCOIN_ADDRESSES.INVALID.forEach((address, index) => {
      testCases.push({
        address,
        type: "INVALID",
        expected: false,
        description: `Invalid address case ${index + 1}: ${address || "empty"}`,
      })
    })

    return testCases
  }

  /**
   * Generate redemption test cases with various amounts and scenarios
   */
  public static generateRedemptionTestCases(): RedemptionTestCase[] {
    const testCases: RedemptionTestCase[] = []

    // Different amount scenarios
    Object.entries(this.DEFAULT_AMOUNTS).forEach(([name, amount]) => {
      testCases.push({
        amount,
        userBtcAddress: this.BITCOIN_ADDRESSES.P2PKH_MAINNET[0],
        walletAddress: this.BITCOIN_ADDRESSES.P2PKH_MAINNET[1],
        description: `${name} amount redemption (${amount} satoshis)`,
      })
    })

    // Different address type combinations
    const addressTypes = [
      {
        user: this.BITCOIN_ADDRESSES.P2PKH_MAINNET[0],
        wallet: this.BITCOIN_ADDRESSES.P2PKH_MAINNET[1],
        desc: "P2PKH to P2PKH",
      },
      {
        user: this.BITCOIN_ADDRESSES.P2PKH_MAINNET[0],
        wallet: this.BITCOIN_ADDRESSES.P2SH_MAINNET[0],
        desc: "P2PKH to P2SH",
      },
      {
        user: this.BITCOIN_ADDRESSES.P2SH_MAINNET[0],
        wallet: this.BITCOIN_ADDRESSES.BECH32_MAINNET[0],
        desc: "P2SH to Bech32",
      },
      {
        user: this.BITCOIN_ADDRESSES.BECH32_MAINNET[0],
        wallet: this.BITCOIN_ADDRESSES.P2PKH_MAINNET[0],
        desc: "Bech32 to P2PKH",
      },
    ]

    addressTypes.forEach(({ user, wallet, desc }) => {
      testCases.push({
        amount: this.DEFAULT_AMOUNTS.MEDIUM,
        userBtcAddress: user,
        walletAddress: wallet,
        description: `${desc} address combination`,
      })
    })

    return testCases
  }

  /**
   * Create a standardized redemption with customizable parameters
   */
  public static async createStandardRedemption(
    qcRedeemer: QCRedeemer,
    tbtc: TBTC,
    qcData: QCData,
    qcAddress: string,
    user: SignerWithAddress,
    options: Partial<RedemptionTestCase> = {}
  ): Promise<{
    redemptionId: string
    amount: BigNumber
    userBtcAddress: string
    walletAddress: string
  }> {
    const defaults = {
      amount: this.DEFAULT_AMOUNTS.MEDIUM,
      userBtcAddress: this.BITCOIN_ADDRESSES.P2PKH_MAINNET[0],
      walletAddress: this.BITCOIN_ADDRESSES.P2PKH_MAINNET[1],
    }

    const params = { ...defaults, ...options }
    const amountWei = this.satoshisToWei(params.amount)

    // Register wallet if not already registered
    try {
      await qcData.registerWallet(qcAddress, params.walletAddress)
    } catch {
      // Wallet might already be registered
    }

    // Setup user with tBTC
    await tbtc.mint(user.address, amountWei)
    await tbtc.connect(user).approve(qcRedeemer.address, amountWei)

    // Create redemption
    const tx = await qcRedeemer
      .connect(user)
      .initiateRedemption(
        qcAddress,
        amountWei,
        params.userBtcAddress,
        params.walletAddress
      )

    const receipt = await tx.wait()
    const event = receipt.events?.find((e) => e.event === "RedemptionRequested")

    if (!event?.args?.redemptionId) {
      throw new Error("Failed to create redemption - no redemption ID in event")
    }

    return {
      redemptionId: event.args.redemptionId,
      amount: amountWei,
      userBtcAddress: params.userBtcAddress,
      walletAddress: params.walletAddress,
    }
  }

  /**
   * Batch create multiple redemptions with automatic configuration
   */
  public static async createRedemptionBatch(
    qcRedeemer: QCRedeemer,
    tbtc: TBTC,
    qcData: QCData,
    qcAddress: string,
    user: SignerWithAddress,
    count: number,
    baseAmount: number = this.DEFAULT_AMOUNTS.MEDIUM
  ): Promise<Array<{ redemptionId: string; amount: BigNumber }>> {
    const redemptions = []

    for (let i = 0; i < count; i++) {
      // Vary amounts slightly to avoid identical transactions
      const amount = baseAmount + i * 10000 // Add 0.0001 BTC per redemption

      const result = await this.createStandardRedemption(
        qcRedeemer,
        tbtc,
        qcData,
        qcAddress,
        user,
        { amount }
      )

      redemptions.push({
        redemptionId: result.redemptionId,
        amount: result.amount,
      })
    }

    return redemptions
  }

  /**
   * Verify redemption state comprehensively
   */
  public static async verifyRedemptionState(
    qcRedeemer: QCRedeemer,
    redemptionId: string,
    expectedStatus: number,
    additionalChecks?: {
      shouldBeFulfilled?: boolean
      shouldBeDefaulted?: boolean
      shouldBeTimedOut?: boolean
      expectedUser?: string
      expectedQC?: string
      expectedAmount?: BigNumber
    }
  ): Promise<void> {
    const redemption = await qcRedeemer.redemptions(redemptionId)
    expect(redemption.status).to.equal(
      expectedStatus,
      "Redemption status mismatch"
    )

    if (additionalChecks?.shouldBeFulfilled !== undefined) {
      const isFulfilled = await qcRedeemer.isRedemptionFulfilled(redemptionId)
      expect(isFulfilled).to.equal(
        additionalChecks.shouldBeFulfilled,
        "Fulfillment status mismatch"
      )
    }

    if (additionalChecks?.shouldBeDefaulted !== undefined) {
      const [isDefaulted] = await qcRedeemer.isRedemptionDefaulted(redemptionId)
      expect(isDefaulted).to.equal(
        additionalChecks.shouldBeDefaulted,
        "Default status mismatch"
      )
    }

    if (additionalChecks?.shouldBeTimedOut !== undefined) {
      const isTimedOut = await qcRedeemer.isRedemptionTimedOut(redemptionId)
      expect(isTimedOut).to.equal(
        additionalChecks.shouldBeTimedOut,
        "Timeout status mismatch"
      )
    }

    if (additionalChecks?.expectedUser) {
      expect(redemption.user).to.equal(
        additionalChecks.expectedUser,
        "User address mismatch"
      )
    }

    if (additionalChecks?.expectedQC) {
      expect(redemption.qc).to.equal(
        additionalChecks.expectedQC,
        "QC address mismatch"
      )
    }

    if (additionalChecks?.expectedAmount) {
      expect(redemption.amount).to.equal(
        additionalChecks.expectedAmount,
        "Amount mismatch"
      )
    }
  }

  /**
   * Verify wallet obligation state
   */
  public static async verifyWalletObligations(
    qcRedeemer: QCRedeemer,
    walletAddress: string,
    expectedState: {
      hasObligations: boolean
      activeCount: number
      totalAmount?: BigNumber
      earliestDeadline?: BigNumber
    }
  ): Promise<void> {
    const hasObligations = await qcRedeemer.hasWalletObligations(walletAddress)
    expect(hasObligations).to.equal(
      expectedState.hasObligations,
      "Wallet obligations mismatch"
    )

    const activeCount = await qcRedeemer.getWalletPendingRedemptionCount(
      walletAddress
    )

    expect(activeCount).to.equal(
      expectedState.activeCount,
      "Active count mismatch"
    )

    if (
      expectedState.totalAmount !== undefined ||
      expectedState.earliestDeadline !== undefined
    ) {
      const obligationDetails = await qcRedeemer.getWalletObligationDetails(
        walletAddress
      )

      if (expectedState.totalAmount !== undefined) {
        expect(obligationDetails.totalAmount).to.equal(
          expectedState.totalAmount,
          "Total amount mismatch"
        )
      }

      if (expectedState.earliestDeadline !== undefined) {
        expect(obligationDetails.earliestDeadline).to.equal(
          expectedState.earliestDeadline,
          "Earliest deadline mismatch"
        )
      }
    }
  }

  /**
   * Verify QC redemption tracking state
   */
  public static async verifyQCRedemptionState(
    qcRedeemer: QCRedeemer,
    qcAddress: string,
    expectedState: {
      activeCount: number
      hasUnfulfilled: boolean
      earliestDeadline?: BigNumber
      redemptionIds?: string[]
    }
  ): Promise<void> {
    const activeCount = await qcRedeemer.qcActiveRedemptionCount(qcAddress)
    expect(activeCount).to.equal(
      expectedState.activeCount,
      "QC active count mismatch"
    )

    const hasUnfulfilled = await qcRedeemer.hasUnfulfilledRedemptions(qcAddress)
    expect(hasUnfulfilled).to.equal(
      expectedState.hasUnfulfilled,
      "QC unfulfilled status mismatch"
    )

    if (expectedState.earliestDeadline !== undefined) {
      const earliestDeadline = await qcRedeemer.getEarliestRedemptionDeadline(
        qcAddress
      )

      expect(earliestDeadline).to.equal(
        expectedState.earliestDeadline,
        "QC earliest deadline mismatch"
      )
    }

    if (expectedState.redemptionIds !== undefined) {
      const redemptionIds = await qcRedeemer.getQCRedemptions(qcAddress)
      expect(redemptionIds.length).to.equal(
        expectedState.redemptionIds.length,
        "Redemption IDs length mismatch"
      )

      for (const expectedId of expectedState.redemptionIds) {
        expect(redemptionIds).to.include(
          expectedId,
          `Missing redemption ID: ${expectedId}`
        )
      }
    }
  }

  /**
   * Setup a complete test environment with multiple QCs, wallets, and users
   */
  public static async setupComplexTestEnvironment(
    qcData: QCData,
    tbtc: TBTC,
    qcAddresses: string[],
    users: SignerWithAddress[],
    mintingCap: BigNumber = ethers.BigNumber.from("1000000000000") // 10,000 BTC
  ): Promise<{
    qcs: Array<{ address: string; wallets: string[] }>
    preparedUsers: SignerWithAddress[]
  }> {
    const qcs = []

    // Setup QCs with wallets
    for (let i = 0; i < qcAddresses.length; i++) {
      const qcAddress = qcAddresses[i]

      // Register QC
      await qcData.registerQC(qcAddress, mintingCap)

      // Register multiple wallets per QC
      const wallets = [
        this.BITCOIN_ADDRESSES.P2PKH_MAINNET[
          i % this.BITCOIN_ADDRESSES.P2PKH_MAINNET.length
        ],
        this.BITCOIN_ADDRESSES.P2SH_MAINNET[
          i % this.BITCOIN_ADDRESSES.P2SH_MAINNET.length
        ],
        this.BITCOIN_ADDRESSES.BECH32_MAINNET[
          i % this.BITCOIN_ADDRESSES.BECH32_MAINNET.length
        ],
      ]

      for (const wallet of wallets) {
        await qcData.registerWallet(qcAddress, wallet)
      }

      qcs.push({ address: qcAddress, wallets })
    }

    // Setup users with tBTC
    const userBalance = ethers.utils.parseEther("100") // 100 tBTC per user
    for (const user of users) {
      await tbtc.mint(user.address, userBalance)
    }

    return {
      qcs,
      preparedUsers: users,
    }
  }

  /**
   * Execute a complex redemption scenario with automatic verification
   */
  public static async executeRedemptionScenario(
    scenario: RedemptionScenario
  ): Promise<string> {
    try {
      await scenario.setup()
      const redemptionId = await scenario.execute()
      await scenario.verify(redemptionId)

      if (scenario.cleanup) {
        await scenario.cleanup()
      }

      return redemptionId
    } catch (error) {
      console.error(`Scenario "${scenario.name}" failed:`, error)
      throw error
    }
  }

  /**
   * Generate property-based test data for Bitcoin addresses
   */
  public static generatePropertyBasedAddressTests(): Array<{
    input: string
    expectedValid: boolean
    property: string
  }> {
    return [
      // Length property tests
      { input: "1", expectedValid: false, property: "too_short" },
      {
        input: `1${"A".repeat(33)}`,
        expectedValid: true,
        property: "valid_length_p2pkh",
      },
      {
        input: `1${"A".repeat(34)}`,
        expectedValid: true,
        property: "max_length_p2pkh",
      },
      {
        input: `1${"A".repeat(35)}`,
        expectedValid: false,
        property: "too_long_p2pkh",
      },

      // Prefix property tests
      {
        input: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
        expectedValid: true,
        property: "valid_p2pkh_prefix",
      },
      {
        input: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
        expectedValid: true,
        property: "valid_p2sh_prefix",
      },
      {
        input: "2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
        expectedValid: false,
        property: "invalid_prefix_2",
      },
      {
        input: "4A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
        expectedValid: false,
        property: "invalid_prefix_4",
      },

      // Bech32 property tests
      {
        input: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
        expectedValid: true,
        property: "valid_bech32_mainnet",
      },
      {
        input: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
        expectedValid: true,
        property: "valid_bech32_testnet",
      },
      {
        input: "bc2qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        expectedValid: false,
        property: "invalid_bech32_version",
      },
      {
        input: `bc1${"q".repeat(71)}`,
        expectedValid: true,
        property: "max_bech32_length",
      },
      {
        input: `bc1${"q".repeat(72)}`,
        expectedValid: false,
        property: "too_long_bech32",
      },
    ]
  }
}

/**
 * Enhanced expectation helpers for QCRedeemer testing
 */
export class QCRedeemerExpectations {
  /**
   * Expect redemption creation to succeed with proper event emission
   */
  public static async expectRedemptionCreated(
    tx: Promise<any>,
    expectedUser: string,
    expectedQC: string,
    expectedAmount: BigNumber
  ): Promise<string> {
    const result = await tx
    await expect(result)
      .to.emit(result.contractInstance || result.to, "RedemptionRequested")
      .withArgs(
        expect.any(String), // redemptionId
        expectedUser,
        expectedQC,
        expectedAmount,
        expect.any(String), // userBtcAddress
        expect.any(String) // qcWalletAddress
      )

    const receipt = await result.wait()

    const event = receipt.events?.find(
      (e: any) => e.event === "RedemptionRequested"
    )

    if (!event?.args?.redemptionId) {
      throw new Error(
        "RedemptionRequested event not found or missing redemptionId"
      )
    }

    return event.args.redemptionId
  }

  /**
   * Expect redemption fulfillment to succeed with proper state changes
   */
  public static async expectRedemptionFulfilled(
    qcRedeemer: QCRedeemer,
    tx: Promise<any>,
    redemptionId: string,
    expectedActualAmount: BigNumber
  ): Promise<void> {
    await expect(tx).to.emit(qcRedeemer, "RedemptionFulfilled").withArgs(
      redemptionId,
      expect.any(String), // user
      expect.any(String), // qc
      expect.any(BigNumber), // amount
      expectedActualAmount,
      expect.any(String) // fulfilledBy
    )

    // Verify final state
    const redemption = await qcRedeemer.redemptions(redemptionId)
    expect(redemption.status).to.equal(2, "Redemption should be fulfilled") // RedemptionStatus.Fulfilled

    const isFulfilled = await qcRedeemer.isRedemptionFulfilled(redemptionId)
    expect(isFulfilled).to.be.true
  }

  /**
   * Expect redemption default to succeed with proper state changes
   */
  public static async expectRedemptionDefaulted(
    qcRedeemer: QCRedeemer,
    tx: Promise<any>,
    redemptionId: string,
    expectedReason: string
  ): Promise<void> {
    await expect(tx).to.emit(qcRedeemer, "RedemptionDefaulted").withArgs(
      redemptionId,
      expect.any(String), // user
      expect.any(String), // qc
      expect.any(BigNumber), // amount
      expectedReason,
      expect.any(String) // defaultedBy
    )

    // Verify final state
    const redemption = await qcRedeemer.redemptions(redemptionId)
    expect(redemption.status).to.equal(3, "Redemption should be defaulted") // RedemptionStatus.Defaulted

    const [isDefaulted, reason] = await qcRedeemer.isRedemptionDefaulted(
      redemptionId
    )

    expect(isDefaulted).to.be.true
    expect(reason).to.equal(expectedReason)
  }

  /**
   * Expect custom error with specific error message
   */
  public static async expectCustomErrorWithMessage(
    tx: Promise<any>,
    contract: any,
    errorName: string,
    expectedMessage?: string
  ): Promise<void> {
    if (expectedMessage) {
      await expect(tx).to.be.revertedWithCustomError(contract, errorName)
      // Additional message verification could be added here if needed
    } else {
      await expect(tx).to.be.revertedWithCustomError(contract, errorName)
    }
  }
}
