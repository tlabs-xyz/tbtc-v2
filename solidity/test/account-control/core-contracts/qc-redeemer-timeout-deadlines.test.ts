import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers"
import {
  deployQCRedeemerFixture,
  createTestRedemption,
  TEST_CONSTANTS,
} from "../fixtures/account-control-fixtures"
import { expectCustomError } from "../helpers/error-helpers"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCRedeemer - Timeout and Deadline Management", () => {
  describe("Redemption Timeout Logic", () => {
    it("should correctly identify non-timed out redemptions", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer } = fixture

      const { redemptionId } = await createTestRedemption(fixture)

      // Should not be timed out immediately after creation
      const isTimedOut = await qcRedeemer.isRedemptionTimedOut(redemptionId)
      expect(isTimedOut).to.be.false
    })

    it("should correctly identify timed out redemptions", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState } = fixture

      // Set a short timeout for testing
      const shortTimeout = 3600 // 1 hour
      await systemState.setRedemptionTimeout(shortTimeout)

      const { redemptionId } = await createTestRedemption(fixture)

      // Fast forward past the timeout
      await time.increase(shortTimeout + 1)

      const isTimedOut = await qcRedeemer.isRedemptionTimedOut(redemptionId)
      expect(isTimedOut).to.be.true
    })

    it("should handle timeout edge cases around deadline", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState } = fixture

      const timeout = 3600 // 1 hour
      await systemState.setRedemptionTimeout(timeout)

      const { redemptionId } = await createTestRedemption(fixture)

      // Just before timeout
      await time.increase(timeout - 10)
      expect(await qcRedeemer.isRedemptionTimedOut(redemptionId)).to.be.false

      // Exactly at timeout (should not be timed out)
      await time.increase(10)
      expect(await qcRedeemer.isRedemptionTimedOut(redemptionId)).to.be.false

      // Just after timeout
      await time.increase(1)
      expect(await qcRedeemer.isRedemptionTimedOut(redemptionId)).to.be.true
    })

    it("should return false for non-pending redemptions", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Fulfill the redemption
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)

      // Fast forward past timeout
      await time.increase(86400 + 1)

      // Should return false for fulfilled redemptions regardless of time
      expect(await qcRedeemer.isRedemptionTimedOut(redemptionId)).to.be.false
    })

    it("should return false for defaulted redemptions", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId } = await createTestRedemption(fixture)

      // Default the redemption
      await qcRedeemer
        .connect(watchdog)
        .flagDefaultedRedemption(
          redemptionId,
          ethers.utils.formatBytes32String("TEST_DEFAULT")
        )

      // Fast forward past timeout
      await time.increase(86400 + 1)

      // Should return false for defaulted redemptions
      expect(await qcRedeemer.isRedemptionTimedOut(redemptionId)).to.be.false
    })

    it("should handle non-existent redemption IDs", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer } = fixture

      const fakeRedemptionId = ethers.utils.id("non-existent")

      // Should return false for non-existent redemptions
      expect(await qcRedeemer.isRedemptionTimedOut(fakeRedemptionId)).to.be
        .false
    })
  })

  describe("Deadline Calculations", () => {
    it("should calculate correct deadline on redemption creation", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState } = fixture

      const customTimeout = 7200 // 2 hours
      await systemState.setRedemptionTimeout(customTimeout)

      const beforeTimestamp = await time.latest()
      const { redemptionId } = await createTestRedemption(fixture)
      const afterTimestamp = await time.latest()

      const redemption = await qcRedeemer.redemptions(redemptionId)
      const expectedMinDeadline = beforeTimestamp + customTimeout
      const expectedMaxDeadline = afterTimestamp + customTimeout

      expect(redemption.deadline).to.be.gte(expectedMinDeadline)
      expect(redemption.deadline).to.be.lte(expectedMaxDeadline)
    })

    it("should handle varying timeout values", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState } = fixture

      const timeouts = [1800, 3600, 7200, 86400] // 30min, 1h, 2h, 24h

      for (const timeout of timeouts) {
        await systemState.setRedemptionTimeout(timeout)

        const beforeTime = await time.latest()
        const { redemptionId } = await createTestRedemption(fixture)
        const afterTime = await time.latest()

        const redemption = await qcRedeemer.redemptions(redemptionId)

        expect(redemption.deadline).to.be.gte(beforeTime + timeout)
        expect(redemption.deadline).to.be.lte(afterTime + timeout)
      }
    })

    it("should maintain consistent deadlines across multiple redemptions", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer } = fixture

      const redemptions = []
      const expectedDeadlines = []

      // Create multiple redemptions rapidly
      for (let i = 0; i < 3; i++) {
        const beforeTime = await time.latest()
        const { redemptionId } = await createTestRedemption(fixture)
        const afterTime = await time.latest()

        redemptions.push(redemptionId)
        expectedDeadlines.push({
          min: beforeTime + 86400,
          max: afterTime + 86400,
        })

        // Small delay between redemptions
        await time.increase(10)
      }

      // Verify all deadlines are correct
      for (let i = 0; i < redemptions.length; i++) {
        const redemption = await qcRedeemer.redemptions(redemptions[i])
        expect(redemption.deadline).to.be.gte(expectedDeadlines[i].min)
        expect(redemption.deadline).to.be.lte(expectedDeadlines[i].max)
      }
    })
  })

  describe("Earliest Deadline Tracking", () => {
    it("should track earliest deadline with time progression", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcAddress } = fixture

      // Create first redemption
      const { redemptionId: firstId } = await createTestRedemption(fixture)
      const firstRedemption = await qcRedeemer.redemptions(firstId)

      // Get initial earliest deadline
      let earliestDeadline = await qcRedeemer.getEarliestRedemptionDeadline(
        qcAddress.address
      )

      expect(earliestDeadline).to.equal(firstRedemption.deadline)

      // Advance time by 1 hour
      await time.increase(3600)

      // Create second redemption (will have later deadline)
      const { redemptionId: secondId } = await createTestRedemption(fixture)
      const secondRedemption = await qcRedeemer.redemptions(secondId)

      // Earliest deadline should still be the first one
      earliestDeadline = await qcRedeemer.getEarliestRedemptionDeadline(
        qcAddress.address
      )
      expect(earliestDeadline).to.equal(firstRedemption.deadline)
      expect(secondRedemption.deadline).to.be.gt(firstRedemption.deadline)

      // Advance time by another hour
      await time.increase(3600)

      // Create third redemption
      const { redemptionId: thirdId } = await createTestRedemption(fixture)

      // Earliest should still be the first
      earliestDeadline = await qcRedeemer.getEarliestRedemptionDeadline(
        qcAddress.address
      )
      expect(earliestDeadline).to.equal(firstRedemption.deadline)
    })

    it("should update earliest deadline when earliest redemption is fulfilled", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcAddress, watchdog } = fixture

      // Create two redemptions with time gap
      const { redemptionId: firstId, amount: firstAmount } =
        await createTestRedemption(fixture)

      const firstRedemption = await qcRedeemer.redemptions(firstId)

      await time.increase(3600) // 1 hour gap

      const { redemptionId: secondId } = await createTestRedemption(fixture)
      const secondRedemption = await qcRedeemer.redemptions(secondId)

      // Initially earliest should be first
      let earliestDeadline = await qcRedeemer.getEarliestRedemptionDeadline(
        qcAddress.address
      )

      expect(earliestDeadline).to.equal(firstRedemption.deadline)

      // Fulfill first redemption
      const satoshiAmount = firstAmount.div(ethers.BigNumber.from(10).pow(10))
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(firstId, satoshiAmount)

      // Now earliest should be second
      earliestDeadline = await qcRedeemer.getEarliestRedemptionDeadline(
        qcAddress.address
      )
      expect(earliestDeadline).to.equal(secondRedemption.deadline)
    })

    it("should return max uint256 when no pending redemptions exist", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcAddress } = fixture

      const deadline = await qcRedeemer.getEarliestRedemptionDeadline(
        qcAddress.address
      )

      expect(deadline).to.equal(ethers.constants.MaxUint256)
    })

    it("should handle mixed fulfillment and default operations on deadline tracking", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcAddress, watchdog } = fixture

      // Create 4 redemptions with time gaps
      const redemptions = []
      for (let i = 0; i < 4; i++) {
        const { redemptionId, amount } = await createTestRedemption(fixture)
        const redemption = await qcRedeemer.redemptions(redemptionId)
        redemptions.push({
          redemptionId,
          amount,
          deadline: redemption.deadline,
        })
        await time.increase(1800) // 30 min gap
      }

      // Initial earliest should be first
      let earliestDeadline = await qcRedeemer.getEarliestRedemptionDeadline(
        qcAddress.address
      )

      expect(earliestDeadline).to.equal(redemptions[0].deadline)

      // Fulfill second (not earliest)
      const satoshiAmount1 = redemptions[1].amount.div(
        ethers.BigNumber.from(10).pow(10)
      )

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(
          redemptions[1].redemptionId,
          satoshiAmount1
        )

      // Earliest should still be first
      earliestDeadline = await qcRedeemer.getEarliestRedemptionDeadline(
        qcAddress.address
      )
      expect(earliestDeadline).to.equal(redemptions[0].deadline)

      // Default first (earliest)
      await qcRedeemer
        .connect(watchdog)
        .flagDefaultedRedemption(
          redemptions[0].redemptionId,
          ethers.utils.formatBytes32String("TIMEOUT")
        )

      // Now earliest should be third (second was fulfilled)
      earliestDeadline = await qcRedeemer.getEarliestRedemptionDeadline(
        qcAddress.address
      )
      expect(earliestDeadline).to.equal(redemptions[2].deadline)

      // Fulfill third
      const satoshiAmount2 = redemptions[2].amount.div(
        ethers.BigNumber.from(10).pow(10)
      )

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(
          redemptions[2].redemptionId,
          satoshiAmount2
        )

      // Now earliest should be fourth
      earliestDeadline = await qcRedeemer.getEarliestRedemptionDeadline(
        qcAddress.address
      )
      expect(earliestDeadline).to.equal(redemptions[3].deadline)
    })
  })

  describe("System Parameter Changes", () => {
    it("should not affect existing redemption deadlines when timeout changes", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState } = fixture

      // Create redemption with default timeout
      const { redemptionId } = await createTestRedemption(fixture)
      const originalRedemption = await qcRedeemer.redemptions(redemptionId)
      const originalDeadline = originalRedemption.deadline

      // Change system timeout
      await systemState.setRedemptionTimeout(3600) // Change to 1 hour

      // Original redemption deadline should remain unchanged
      const redemptionAfterChange = await qcRedeemer.redemptions(redemptionId)
      expect(redemptionAfterChange.deadline).to.equal(originalDeadline)

      // New redemptions should use new timeout
      const beforeNewRedemption = await time.latest()
      const { redemptionId: newId } = await createTestRedemption(fixture)
      const afterNewRedemption = await time.latest()

      const newRedemption = await qcRedeemer.redemptions(newId)
      expect(newRedemption.deadline).to.be.gte(beforeNewRedemption + 3600)
      expect(newRedemption.deadline).to.be.lte(afterNewRedemption + 3600)
      expect(newRedemption.deadline).to.be.lt(originalDeadline)
    })

    it("should handle timeout value edge cases", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState } = fixture

      // Test minimum timeout (1 second)
      await systemState.setRedemptionTimeout(1)
      const { redemptionId: minId } = await createTestRedemption(fixture)

      // Immediately check if it's timed out (should not be)
      expect(await qcRedeemer.isRedemptionTimedOut(minId)).to.be.false

      // Wait 2 seconds and check again
      await time.increase(2)
      expect(await qcRedeemer.isRedemptionTimedOut(minId)).to.be.true

      // Test large timeout (1 week)
      const oneWeek = 7 * 24 * 3600
      await systemState.setRedemptionTimeout(oneWeek)
      const { redemptionId: maxId } = await createTestRedemption(fixture)

      // Should not be timed out even after a day
      await time.increase(24 * 3600)
      expect(await qcRedeemer.isRedemptionTimedOut(maxId)).to.be.false
    })
  })

  describe("Wallet-Specific Deadline Tracking", () => {
    it("should track earliest deadline per wallet correctly", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcAddress } = fixture

      // Setup two different wallets
      const wallet1 = TEST_CONSTANTS.VALID_LEGACY_BTC
      const wallet2 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"

      await fixture.qcData.registerWallet(qcAddress.address, wallet1)
      await fixture.qcData.registerWallet(qcAddress.address, wallet2)

      // Create redemption for wallet1
      const { redemptionId: id1 } = await createTestRedemption(fixture, {
        walletAddress: wallet1,
      })

      const redemption1 = await qcRedeemer.redemptions(id1)

      await time.increase(3600) // 1 hour gap

      // Create redemption for wallet2
      const { redemptionId: id2 } = await createTestRedemption(fixture, {
        walletAddress: wallet2,
      })

      const redemption2 = await qcRedeemer.redemptions(id2)

      // Each wallet should have its own earliest deadline
      const wallet1Deadline =
        await qcRedeemer.getWalletEarliestRedemptionDeadline(wallet1)

      const wallet2Deadline =
        await qcRedeemer.getWalletEarliestRedemptionDeadline(wallet2)

      expect(wallet1Deadline).to.equal(redemption1.deadline)
      expect(wallet2Deadline).to.equal(redemption2.deadline)
      expect(wallet1Deadline).to.be.lt(wallet2Deadline)
    })

    it("should return max uint256 for wallets with no pending redemptions", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer } = fixture

      const emptyWallet = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"

      const deadline = await qcRedeemer.getWalletEarliestRedemptionDeadline(
        emptyWallet
      )

      expect(deadline).to.equal(ethers.constants.MaxUint256)
    })
  })
})
