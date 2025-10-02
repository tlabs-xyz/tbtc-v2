import { expect } from "chai"
import { ethers } from "hardhat"
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import {
  deployQCRedeemerFixture,
  createTestRedemption,
  TEST_CONSTANTS,
} from "../fixtures/account-control-fixtures"

describe("QCRedeemer Trusted Fulfillment", () => {
  describe("recordRedemptionFulfillmentTrusted", () => {
    it("should allow dispute arbiter to record fulfillment", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture
      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Record trusted fulfillment with actual amount in satoshis
      // Convert from tBTC Wei (18 decimals) to satoshis (8 decimals)
      const actualAmount = amount.div(ethers.BigNumber.from(10).pow(10))

      const tx = await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(redemptionId, actualAmount)

      // Check events
      await expect(tx).to.emit(qcRedeemer, "RedemptionFulfilled")

      // Verify redemption status
      const redemption = await qcRedeemer.redemptions(redemptionId)
      expect(redemption.status).to.equal(2) // RedemptionStatus.Fulfilled

      // Verify redemption is marked as fulfilled
      expect(await qcRedeemer.isRedemptionFulfilled(redemptionId)).to.be.true
    })

    it("should handle partial fulfillment (actual < requested)", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Record partial fulfillment (90% of requested)
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      const actualAmount = satoshiAmount.mul(9).div(10) // 90% of requested

      const tx = await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(redemptionId, actualAmount)

      await expect(tx).to.emit(qcRedeemer, "RedemptionFulfilled")

      // Verify redemption is still marked as fulfilled despite partial payment
      expect(await qcRedeemer.isRedemptionFulfilled(redemptionId)).to.be.true
    })

    it("should handle overpayment (actual > requested)", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Record overpayment (110% of requested)
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      const actualAmount = satoshiAmount.mul(11).div(10) // 110% of requested

      const tx = await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(redemptionId, actualAmount)

      await expect(tx).to.emit(qcRedeemer, "RedemptionFulfilled")

      // Verify redemption is marked as fulfilled
      expect(await qcRedeemer.isRedemptionFulfilled(redemptionId)).to.be.true
    })

    it("should update QC and wallet tracking counters", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog, qcAddress } = fixture

      const { redemptionId, amount, walletAddress } =
        await createTestRedemption(fixture)

      // Check counters before fulfillment
      const qcCountBefore = await qcRedeemer.qcActiveRedemptionCount(
        qcAddress.address
      )

      const walletCountBefore = await qcRedeemer.walletActiveRedemptionCount(
        walletAddress
      )

      expect(qcCountBefore).to.equal(1)
      expect(walletCountBefore).to.equal(1)

      // Record fulfillment
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)

      // Check counters after fulfillment
      const qcCountAfter = await qcRedeemer.qcActiveRedemptionCount(
        qcAddress.address
      )

      const walletCountAfter = await qcRedeemer.walletActiveRedemptionCount(
        walletAddress
      )

      expect(qcCountAfter).to.equal(0)
      expect(walletCountAfter).to.equal(0)

      // Verify QC no longer has unfulfilled redemptions
      expect(await qcRedeemer.hasUnfulfilledRedemptions(qcAddress.address)).to
        .be.false
      expect(await qcRedeemer.hasWalletObligations(walletAddress)).to.be.false
    })

    it("should prevent fulfillment by non-arbiter", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user } = fixture

      const { redemptionId, amount } = await createTestRedemption(fixture)

      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      await expect(
        qcRedeemer
          .connect(user)
          .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)
      ).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role`
      )
    })

    it("should prevent fulfillment when system is paused", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, watchdog } = fixture

      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Pause redemptions
      await systemState.pauseRedemption()

      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      await expect(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)
      ).to.be.revertedWithCustomError(qcRedeemer, "RedemptionsArePaused")
    })

    it("should prevent double fulfillment", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId, amount } = await createTestRedemption(fixture)

      // First fulfillment
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)

      // Attempt second fulfillment
      await expect(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)
      ).to.be.revertedWithCustomError(qcRedeemer, "RedemptionNotPending")
    })

    it("should prevent fulfillment of non-existent redemption", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const fakeRedemptionId = ethers.utils.id("non-existent")

      await expect(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(fakeRedemptionId, 1000000)
      ).to.be.revertedWithCustomError(qcRedeemer, "RedemptionNotPending")
    })

    it("should prevent fulfillment of defaulted redemption", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId, amount } = await createTestRedemption(fixture)

      // First default the redemption
      const reason = ethers.utils.id("test_default")
      await qcRedeemer
        .connect(watchdog)
        .flagDefaultedRedemption(redemptionId, reason)

      // Attempt to fulfill defaulted redemption
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      await expect(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)
      ).to.be.revertedWithCustomError(qcRedeemer, "RedemptionNotPending")
    })

    it("should reject zero amount fulfillment", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId } = await createTestRedemption(fixture)

      await expect(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, 0)
      ).to.be.revertedWithCustomError(qcRedeemer, "InvalidAmount")
    })

    it("should emit correct events with proper values", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog, user, qcAddress } = fixture

      const { redemptionId, amount } = await createTestRedemption(fixture)
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      const actualAmount = satoshiAmount.add(1000000) // Slightly different than requested

      const tx = await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(redemptionId, actualAmount)

      const receipt = await tx.wait()
      const block = await ethers.provider.getBlock(receipt.blockNumber)

      // Check RedemptionFulfilled event
      await expect(tx).to.emit(qcRedeemer, "RedemptionFulfilled").withArgs(
        redemptionId,
        user.address,
        qcAddress.address,
        amount, // Original amount is already in Wei from createTestRedemption
        actualAmount,
        watchdog.address
      )

      // Check RedemptionFulfilled event
      const eventArgs = await tx.wait().then((receipt) => {
        const event = receipt.events?.find(
          (e) => e.event === "RedemptionFulfilled"
        )

        return event?.args
      })

      expect(eventArgs?.redemptionId).to.equal(redemptionId)
      expect(eventArgs?.amount).to.equal(amount)
      expect(eventArgs?.actualAmount).to.equal(actualAmount)
      expect(eventArgs?.fulfilledBy).to.equal(watchdog.address)
    })

    it("should have correct state effects", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog, qcAddress } = fixture

      // Create two redemptions
      const {
        redemptionId: id1,
        amount,
        walletAddress,
      } = await createTestRedemption(fixture)

      const { redemptionId: id2 } = await createTestRedemption(fixture)

      // Record initial state
      const qcCountBefore = await qcRedeemer.qcActiveRedemptionCount(
        qcAddress.address
      )

      expect(qcCountBefore).to.equal(2)

      // Fulfill first with trusted method
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(id1, satoshiAmount)

      // Check intermediate state
      const qcCountMid = await qcRedeemer.qcActiveRedemptionCount(
        qcAddress.address
      )

      expect(qcCountMid).to.equal(1)

      // Fulfill second with trusted method
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(id2, satoshiAmount)

      // Final state should be same regardless of fulfillment method
      const qcCountAfter = await qcRedeemer.qcActiveRedemptionCount(
        qcAddress.address
      )

      expect(qcCountAfter).to.equal(0)

      // Both redemptions should be fulfilled
      expect(await qcRedeemer.isRedemptionFulfilled(id1)).to.be.true
      expect(await qcRedeemer.isRedemptionFulfilled(id2)).to.be.true
    })
  })

  describe("Integration scenarios", () => {
    it("should handle multiple concurrent redemptions with different actual amounts", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog, qcAddress } = fixture

      // Create multiple redemptions
      const redemptions = []
      for (let i = 0; i < 3; i++) {
        const { redemptionId, amount } = await createTestRedemption(fixture, {
          amount: TEST_CONSTANTS.MEDIUM_MINT + i * 1000000,
        })

        const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
        redemptions.push({
          redemptionId,
          requestedAmount: amount,
          satoshiAmount,
        })
      }

      // Fulfill with different actual amounts
      for (let i = 0; i < redemptions.length; i++) {
        const { redemptionId, satoshiAmount } = redemptions[i]
        const actualAmount = satoshiAmount.add(i * 100000) // Different actual amounts

        await qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, actualAmount)
      }

      // Verify all fulfilled
      for (const { redemptionId } of redemptions) {
        expect(await qcRedeemer.isRedemptionFulfilled(redemptionId)).to.be.true
      }

      // Verify no pending redemptions
      expect(await qcRedeemer.hasUnfulfilledRedemptions(qcAddress.address)).to
        .be.false
    })

    it("should maintain consistency when mixing fulfillment and default operations", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog, qcAddress } = fixture

      // Create 4 redemptions
      const redemptions = []
      for (let i = 0; i < 4; i++) {
        redemptions.push(await createTestRedemption(fixture))
      }

      // Mix operations: fulfill, default, fulfill, default
      const satoshiAmount0 = redemptions[0].amount.div(
        ethers.BigNumber.from(10).pow(10)
      )

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(
          redemptions[0].redemptionId,
          satoshiAmount0
        )

      await qcRedeemer
        .connect(watchdog)
        .flagDefaultedRedemption(
          redemptions[1].redemptionId,
          ethers.utils.id("reason1")
        )

      const satoshiAmount2 = redemptions[2].amount.div(
        ethers.BigNumber.from(10).pow(10)
      )

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(
          redemptions[2].redemptionId,
          satoshiAmount2.mul(2)
        ) // overpayment

      await qcRedeemer
        .connect(watchdog)
        .flagDefaultedRedemption(
          redemptions[3].redemptionId,
          ethers.utils.id("reason2")
        )

      // Verify final state
      expect(await qcRedeemer.hasUnfulfilledRedemptions(qcAddress.address)).to
        .be.false
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(0)

      // Verify individual states
      expect(
        await qcRedeemer.isRedemptionFulfilled(redemptions[0].redemptionId)
      ).to.be.true
      expect(
        await qcRedeemer.isRedemptionFulfilled(redemptions[2].redemptionId)
      ).to.be.true

      const [defaulted1, reason1] = await qcRedeemer.isRedemptionDefaulted(
        redemptions[1].redemptionId
      )

      const [defaulted2, reason2] = await qcRedeemer.isRedemptionDefaulted(
        redemptions[3].redemptionId
      )

      expect(defaulted1).to.be.true
      expect(defaulted2).to.be.true
    })
  })
})
