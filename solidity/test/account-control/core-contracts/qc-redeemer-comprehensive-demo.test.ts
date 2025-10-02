import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers"
import {
  deployQCRedeemerFixture,
  createTestRedemption,
  createTestRedemptionBatch,
  setupComplexTestScenario,
  verifyRedemptionState,
  fulfillTestRedemption,
  defaultTestRedemption,
  TEST_CONSTANTS,
} from "../fixtures/account-control-fixtures"
import {
  QCRedeemerTestUtils,
  QCRedeemerExpectations,
} from "../helpers/qc-redeemer-test-utils"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

/**
 * Comprehensive demonstration test suite showing how to use all the new test utilities
 * and demonstrating the enhanced test coverage for QCRedeemer
 */
describe("QCRedeemer - Comprehensive Test Coverage Demo", () => {
  describe("Test Utilities Demonstration", () => {
    it("should demonstrate Bitcoin address validation with comprehensive test cases", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer } = fixture

      // Use the utility to generate comprehensive test cases
      const testCases = QCRedeemerTestUtils.generateBitcoinAddressTestCases()

      for (const testCase of testCases) {
        const result = await qcRedeemer.validateBitcoinAddress(testCase.address)
        expect(result).to.equal(
          testCase.expected,
          `Failed test case: ${testCase.description}`
        )
      }

      console.log(`✅ Validated ${testCases.length} Bitcoin address test cases`)
    })

    it("should demonstrate property-based testing for Bitcoin addresses", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer } = fixture

      const propertyTests =
        QCRedeemerTestUtils.generatePropertyBasedAddressTests()

      for (const test of propertyTests) {
        const result = await qcRedeemer.validateBitcoinAddress(test.input)
        expect(result).to.equal(
          test.expectedValid,
          `Property test failed: ${test.property} - Input: ${test.input}`
        )
      }

      console.log(`✅ Executed ${propertyTests.length} property-based tests`)
    })

    it("should demonstrate standardized redemption creation with various amounts", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcData, tbtc, user, qcAddress } = fixture

      // Use different amount presets
      const amounts = Object.entries(QCRedeemerTestUtils.DEFAULT_AMOUNTS)

      for (const [name, amount] of amounts) {
        const result = await QCRedeemerTestUtils.createStandardRedemption(
          qcRedeemer,
          tbtc,
          qcData,
          qcAddress.address,
          user,
          { amount }
        )

        // Verify using standardized verification
        await QCRedeemerTestUtils.verifyRedemptionState(
          qcRedeemer,
          result.redemptionId,
          1, // Pending status
          {
            expectedUser: user.address,
            expectedQC: qcAddress.address,
            expectedAmount: result.amount,
          }
        )

        console.log(`✅ Created ${name} redemption: ${amount} satoshis`)
      }
    })

    it("should demonstrate batch redemption creation and processing", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcData, tbtc, user, qcAddress, watchdog } = fixture

      // Create batch of redemptions
      const redemptions = await QCRedeemerTestUtils.createRedemptionBatch(
        qcRedeemer,
        tbtc,
        qcData,
        qcAddress.address,
        user,
        5, // 5 redemptions
        QCRedeemerTestUtils.DEFAULT_AMOUNTS.MEDIUM
      )

      // Verify all created
      expect(redemptions.length).to.equal(5)

      // Process with mixed outcomes
      for (let i = 0; i < redemptions.length; i++) {
        const { redemptionId, amount } = redemptions[i]

        if (i % 2 === 0) {
          // Fulfill even-indexed redemptions
          await fulfillTestRedemption(
            qcRedeemer,
            watchdog,
            redemptionId,
            amount
          )
          await verifyRedemptionState(qcRedeemer, redemptionId, {
            status: 2, // Fulfilled
            isFulfilled: true,
          })
        } else {
          // Default odd-indexed redemptions
          await defaultTestRedemption(qcRedeemer, watchdog, redemptionId)
          await verifyRedemptionState(qcRedeemer, redemptionId, {
            status: 3, // Defaulted
            isDefaulted: true,
          })
        }
      }

      // Verify final QC state
      await QCRedeemerTestUtils.verifyQCRedemptionState(
        qcRedeemer,
        qcAddress.address,
        {
          activeCount: 0,
          hasUnfulfilled: false,
        }
      )

      console.log(`✅ Processed batch of ${redemptions.length} redemptions`)
    })

    it("should demonstrate complex multi-QC, multi-user scenario", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcData, tbtc } = fixture

      // Setup complex environment
      const { qcs, users, walletsByQC } = await setupComplexTestScenario(
        fixture,
        {
          qcCount: 3,
          userCount: 4,
          walletsPerQC: 2,
        }
      )

      console.log(`✅ Setup: ${qcs.length} QCs, ${users.length} users`)

      // Create redemptions across different QCs and users
      const allRedemptions = []

      for (let i = 0; i < qcs.length; i++) {
        const qcAddr = qcs[i]
        const user = users[i % users.length]
        const wallets = walletsByQC[qcAddr]

        for (const wallet of wallets) {
          await tbtc
            .connect(user)
            .approve(qcRedeemer.address, ethers.utils.parseEther("10"))

          const result = await QCRedeemerTestUtils.createStandardRedemption(
            qcRedeemer,
            tbtc,
            qcData,
            qcAddr,
            user,
            { walletAddress: wallet }
          )

          allRedemptions.push({ ...result, qcAddr, wallet })
        }
      }

      console.log(
        `✅ Created ${allRedemptions.length} redemptions across multiple QCs`
      )

      // Verify independent tracking per QC
      for (const qcAddr of qcs) {
        const qcRedemptions = allRedemptions.filter((r) => r.qcAddr === qcAddr)

        await QCRedeemerTestUtils.verifyQCRedemptionState(qcRedeemer, qcAddr, {
          activeCount: qcRedemptions.length,
          hasUnfulfilled: true,
        })
      }

      // Verify wallet-specific tracking
      for (const qcAddr of qcs) {
        const wallets = walletsByQC[qcAddr]
        for (const wallet of wallets) {
          await QCRedeemerTestUtils.verifyWalletObligations(
            qcRedeemer,
            wallet,
            {
              hasObligations: true,
              activeCount: 1, // One redemption per wallet in this test
            }
          )
        }
      }

      console.log("✅ Verified independent tracking across QCs and wallets")
    })
  })

  describe("Advanced Scenario Testing", () => {
    it("should demonstrate timeout tracking with realistic time progression", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState } = fixture

      // Set 2-hour timeout for realistic testing
      await systemState.setRedemptionTimeout(7200)

      // Create redemptions over time
      const redemptions = []
      const timeGaps = [0, 1800, 3600, 5400] // 0, 30min, 1h, 1.5h gaps

      for (const gap of timeGaps) {
        if (gap > 0) {
          await time.increase(gap)
        }

        const { redemptionId } = await createTestRedemption(fixture)
        const timestamp = await time.latest()

        redemptions.push({
          redemptionId,
          createdAt: timestamp,
          expectedDeadline: timestamp + 7200,
        })
      }

      // Fast forward to various points and check timeout status
      await time.increase(3600) // Total: 1h after last redemption

      for (let i = 0; i < redemptions.length; i++) {
        const { redemptionId } = redemptions[i]
        const isTimedOut = await qcRedeemer.isRedemptionTimedOut(redemptionId)

        // First redemption should be timed out (created 5.5h ago)
        // Last redemption should not be timed out (created 1h ago)
        if (i === 0) {
          expect(isTimedOut).to.be.true
        } else if (i === timeGaps.length - 1) {
          expect(isTimedOut).to.be.false
        }
      }

      console.log(
        `✅ Verified timeout behavior across ${redemptions.length} redemptions`
      )
    })

    it("should demonstrate emergency scenario with mixed recovery outcomes", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, watchdog, qcAddress } = fixture

      // Create multiple redemptions before emergency
      const preEmergencyRedemptions = await createTestRedemptionBatch(
        fixture,
        4,
        { amount: QCRedeemerTestUtils.DEFAULT_AMOUNTS.MEDIUM }
      )

      // Trigger emergency pause
      await systemState.emergencyPauseQC(qcAddress.address)

      // Process some redemptions during emergency
      await fulfillTestRedemption(
        qcRedeemer,
        watchdog,
        preEmergencyRedemptions[0].redemptionId,
        preEmergencyRedemptions[0].amount
      )

      await defaultTestRedemption(
        qcRedeemer,
        watchdog,
        preEmergencyRedemptions[1].redemptionId,
        "EMERGENCY_DEFAULT"
      )

      // Verify system can't accept new redemptions during emergency
      await expect(createTestRedemption(fixture)).to.be.revertedWithCustomError(
        qcRedeemer,
        "QCIsEmergencyPaused"
      )

      // Resume operations
      await systemState.emergencyUnpauseQC(qcAddress.address)

      // Process remaining redemptions post-emergency
      await fulfillTestRedemption(
        qcRedeemer,
        watchdog,
        preEmergencyRedemptions[2].redemptionId,
        preEmergencyRedemptions[2].amount
      )

      await fulfillTestRedemption(
        qcRedeemer,
        watchdog,
        preEmergencyRedemptions[3].redemptionId,
        preEmergencyRedemptions[3].amount
      )

      // Verify system is fully operational
      const postEmergencyRedemption = await createTestRedemption(fixture)
      expect(postEmergencyRedemption.redemptionId).to.not.be.empty

      // Final state verification
      await QCRedeemerTestUtils.verifyQCRedemptionState(
        qcRedeemer,
        qcAddress.address,
        {
          activeCount: 1, // Only the post-emergency redemption
          hasUnfulfilled: true,
        }
      )

      console.log("✅ Successfully demonstrated emergency recovery scenario")
    })

    it("should demonstrate comprehensive error boundary testing", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress, watchdog } = fixture

      // Test invalid redemption ID formats
      const invalidIds = [
        ethers.constants.HashZero,
        ethers.utils.id("non-existent"),
        "0x123", // Too short
      ]

      for (const invalidId of invalidIds) {
        await expect(
          qcRedeemer
            .connect(watchdog)
            .recordRedemptionFulfillmentTrusted(invalidId, 1000000)
        ).to.be.reverted
      }

      // Test Bitcoin address edge cases
      const edgeCaseAddresses = [
        "", // Empty
        "1", // Too short
        `1${"A".repeat(40)}`, // Too long
        "2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Invalid prefix
      ]

      for (const invalidAddr of edgeCaseAddresses) {
        const isValid = await qcRedeemer.validateBitcoinAddress(invalidAddr)
        expect(isValid).to.be.false
      }

      // Test amount conversion edge cases
      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Test zero amount fulfillment
      await expect(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, 0)
      ).to.be.revertedWithCustomError(qcRedeemer, "InvalidAmount")

      // Test maximum amount fulfillment
      const maxUint64 = ethers.BigNumber.from(2).pow(64).sub(1)
      await expect(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, maxUint64)
      ).to.emit(qcRedeemer, "RedemptionFulfilled")

      console.log(
        `✅ Verified ${
          invalidIds.length + edgeCaseAddresses.length
        } error boundary cases`
      )
    })

    it("should demonstrate comprehensive integration with all system components", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)

      const {
        qcRedeemer,
        systemState,
        qcData,
        tbtc,
        mockAccountControl,
        watchdog,
        qcAddress,
        user,
      } = fixture

      // Demonstrate SystemState integration
      await systemState.setRedemptionTimeout(3600)
      await systemState.setMinMintAmount(50000)

      // Demonstrate QCData integration
      await qcData.registerQC(qcAddress.address, TEST_CONSTANTS.LARGE_CAP)
      const newWallet = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"
      await qcData.registerWallet(qcAddress.address, newWallet)

      // Demonstrate TBTC integration
      const amount = QCRedeemerTestUtils.satoshisToWei(
        TEST_CONSTANTS.MEDIUM_MINT
      )

      await tbtc.mint(user.address, amount)
      await tbtc.connect(user).approve(qcRedeemer.address, amount)

      // Demonstrate AccountControl integration
      await mockAccountControl.setTotalMintedForTesting(amount.mul(10))
      await mockAccountControl.setMintedForTesting(
        qcRedeemer.address,
        amount.mul(5)
      )

      // Create redemption using all integrated components
      const redemptionResult =
        await QCRedeemerTestUtils.createStandardRedemption(
          qcRedeemer,
          tbtc,
          qcData,
          qcAddress.address,
          user,
          {
            amount: TEST_CONSTANTS.MEDIUM_MINT,
            walletAddress: newWallet,
          }
        )

      // Verify integration points
      const redemption = await qcRedeemer.redemptions(
        redemptionResult.redemptionId
      )

      expect(redemption.deadline).to.be.gt(0)
      expect(redemption.qcWalletAddress).to.equal(newWallet)

      // Demonstrate fulfillment flow
      await QCRedeemerExpectations.expectRedemptionFulfilled(
        qcRedeemer,
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(
            redemptionResult.redemptionId,
            TEST_CONSTANTS.MEDIUM_MINT
          ),
        redemptionResult.redemptionId,
        ethers.BigNumber.from(TEST_CONSTANTS.MEDIUM_MINT)
      )

      console.log("✅ Demonstrated full system integration")
    })
  })

  describe("Performance and Scalability Testing", () => {
    it("should handle moderate load scenarios efficiently", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog, qcAddress } = fixture

      const redemptionCount = 25
      const redemptions = []

      // Create multiple redemptions rapidly
      const startTime = Date.now()
      for (let i = 0; i < redemptionCount; i++) {
        const result = await createTestRedemption(fixture, {
          amount: QCRedeemerTestUtils.DEFAULT_AMOUNTS.SMALL + i * 1000,
        })

        redemptions.push(result)
      }
      const creationTime = Date.now() - startTime

      // Verify all tracked correctly
      const activeCount = await qcRedeemer.qcActiveRedemptionCount(
        qcAddress.address
      )

      expect(activeCount).to.equal(redemptionCount)

      // Process all redemptions
      const processingStartTime = Date.now()
      for (const { redemptionId, amount } of redemptions) {
        await fulfillTestRedemption(qcRedeemer, watchdog, redemptionId, amount)
      }
      const processingTime = Date.now() - processingStartTime

      // Verify final state
      const finalActiveCount = await qcRedeemer.qcActiveRedemptionCount(
        qcAddress.address
      )

      expect(finalActiveCount).to.equal(0)

      console.log(`✅ Processed ${redemptionCount} redemptions`)
      console.log(`   Creation time: ${creationTime}ms`)
      console.log(`   Processing time: ${processingTime}ms`)
      console.log(
        `   Average per redemption: ${(
          (creationTime + processingTime) /
          redemptionCount
        ).toFixed(2)}ms`
      )
    })

    it("should maintain data consistency under concurrent operations", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog, qcAddress } = fixture

      // Create redemptions that will be processed concurrently
      const redemptions = await createTestRedemptionBatch(fixture, 10)

      // Process in mixed order to simulate concurrent operations
      const processOrder = [2, 7, 1, 9, 4, 0, 6, 3, 8, 5]

      for (const index of processOrder) {
        const { redemptionId, amount } = redemptions[index]

        if (index % 3 === 0) {
          await fulfillTestRedemption(
            qcRedeemer,
            watchdog,
            redemptionId,
            amount
          )
        } else {
          await defaultTestRedemption(qcRedeemer, watchdog, redemptionId)
        }
      }

      // Verify final consistency
      const finalActiveCount = await qcRedeemer.qcActiveRedemptionCount(
        qcAddress.address
      )

      expect(finalActiveCount).to.equal(0)

      // Verify each redemption has correct final state
      let fulfilledCount = 0
      let defaultedCount = 0

      for (let i = 0; i < redemptions.length; i++) {
        const { redemptionId } = redemptions[i]
        const redemption = await qcRedeemer.redemptions(redemptionId)

        if (redemption.status === 2) fulfilledCount++
        else if (redemption.status === 3) defaultedCount++
      }

      expect(fulfilledCount + defaultedCount).to.equal(redemptions.length)
      console.log(
        `✅ Maintained consistency: ${fulfilledCount} fulfilled, ${defaultedCount} defaulted`
      )
    })
  })

  describe("Real-World Integration Patterns", () => {
    it("should demonstrate wallet lifecycle management integration", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcData, qcAddress } = fixture

      const walletAddress = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"

      // Register and activate wallet
      await qcData.registerWallet(qcAddress.address, walletAddress)
      await qcData.activateWallet(walletAddress)

      // Create redemption obligations
      const { redemptionId } = await createTestRedemption(fixture, {
        walletAddress,
      })

      // Verify wallet cannot be deregistered with pending obligations
      const hasObligations = await qcRedeemer.hasWalletObligations(
        walletAddress
      )

      expect(hasObligations).to.be.true

      // Clear obligations
      await fulfillTestRedemption(
        qcRedeemer,
        fixture.watchdog,
        redemptionId,
        QCRedeemerTestUtils.satoshisToWei(TEST_CONSTANTS.MEDIUM_MINT)
      )

      // Verify wallet can now be deregistered
      const hasObligationsAfter = await qcRedeemer.hasWalletObligations(
        walletAddress
      )

      expect(hasObligationsAfter).to.be.false

      console.log("✅ Demonstrated wallet lifecycle integration")
    })

    it("should demonstrate cross-chain redemption preparation", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer } = fixture

      // Test various Bitcoin address formats for cross-chain compatibility
      const crossChainAddresses = [
        {
          address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
          chain: "Bitcoin Legacy",
        },
        {
          address: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
          chain: "Bitcoin SegWit",
        },
        {
          address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
          chain: "Bitcoin Native SegWit",
        },
        {
          address: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
          chain: "Bitcoin Testnet",
        },
      ]

      for (const { address, chain } of crossChainAddresses) {
        const isValid = await qcRedeemer.validateBitcoinAddress(address)
        expect(isValid).to.be.true
        console.log(
          `✅ Validated ${chain} address: ${address.substring(0, 10)}...`
        )
      }

      // Demonstrate redemption creation for different networks
      for (const { address } of crossChainAddresses.slice(0, 2)) {
        const { redemptionId } = await createTestRedemption(fixture, {
          userBtcAddress: address,
          amount: QCRedeemerTestUtils.DEFAULT_AMOUNTS.SMALL,
        })

        const redemption = await qcRedeemer.redemptions(redemptionId)
        expect(redemption.userBtcAddress).to.equal(address)
      }

      console.log("✅ Demonstrated cross-chain address compatibility")
    })
  })
})
