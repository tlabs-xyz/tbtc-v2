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

describe("QCRedeemer - Emergency Scenarios", () => {
  describe("QC Emergency Pause", () => {
    it("should prevent new redemptions when QC is emergency paused", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, user, qcAddress } = fixture

      // Setup QC and wallet
      await fixture.qcData.registerQC(
        qcAddress.address,
        TEST_CONSTANTS.LARGE_CAP
      )
      const walletAddress = TEST_CONSTANTS.VALID_LEGACY_BTC
      await fixture.qcData.registerWallet(qcAddress.address, walletAddress)

      // Setup user with tBTC
      const amount = ethers.BigNumber.from(TEST_CONSTANTS.MEDIUM_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await fixture.tbtc.mint(user.address, amount)
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, amount)

      // Emergency pause the QC
      await systemState.emergencyPauseQC(qcAddress.address)

      // Attempt to create redemption should fail
      await expectCustomError(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            amount,
            TEST_CONSTANTS.VALID_LEGACY_BTC,
            walletAddress
          ),
        qcRedeemer,
        "QCIsEmergencyPaused"
      )
    })

    it("should allow existing redemption fulfillment when QC is emergency paused", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, watchdog, qcAddress } = fixture

      // Create redemption before pause
      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Verify redemption exists and is pending
      const redemptionBefore = await qcRedeemer.redemptions(redemptionId)
      expect(redemptionBefore.status).to.equal(1) // RedemptionStatus.Pending

      // Emergency pause the QC
      await systemState.emergencyPauseQC(qcAddress.address)

      // Fulfillment should still work (arbiters can resolve pending issues)
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))

      const tx = await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)

      await expect(tx).to.emit(qcRedeemer, "RedemptionFulfilled")

      // Verify redemption is fulfilled
      const redemptionAfter = await qcRedeemer.redemptions(redemptionId)
      expect(redemptionAfter.status).to.equal(2) // RedemptionStatus.Fulfilled
    })

    it("should allow existing redemption defaulting when QC is emergency paused", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, watchdog, qcAddress } = fixture

      // Create redemption before pause
      const { redemptionId } = await createTestRedemption(fixture)

      // Emergency pause the QC
      await systemState.emergencyPauseQC(qcAddress.address)

      // Default should still work
      const reason = ethers.utils.formatBytes32String("EMERGENCY_DEFAULT")

      const tx = await qcRedeemer
        .connect(watchdog)
        .flagDefaultedRedemption(redemptionId, reason)

      await expect(tx).to.emit(qcRedeemer, "RedemptionDefaulted")

      // Verify redemption is defaulted
      const redemption = await qcRedeemer.redemptions(redemptionId)
      expect(redemption.status).to.equal(3) // RedemptionStatus.Defaulted
    })

    it("should resume normal operations after emergency unpause", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, user, qcAddress } = fixture

      // Setup QC and wallet
      await fixture.qcData.registerQC(
        qcAddress.address,
        TEST_CONSTANTS.LARGE_CAP
      )
      const walletAddress = TEST_CONSTANTS.VALID_LEGACY_BTC
      await fixture.qcData.registerWallet(qcAddress.address, walletAddress)

      // Setup user with tBTC
      const amount = ethers.BigNumber.from(TEST_CONSTANTS.MEDIUM_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await fixture.tbtc.mint(user.address, amount.mul(2)) // Extra for second attempt
      await fixture.tbtc
        .connect(user)
        .approve(qcRedeemer.address, amount.mul(2))

      // Emergency pause and verify it blocks redemptions
      await systemState.emergencyPauseQC(qcAddress.address)

      await expectCustomError(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            amount,
            TEST_CONSTANTS.VALID_LEGACY_BTC,
            walletAddress
          ),
        qcRedeemer,
        "QCIsEmergencyPaused"
      )

      // Unpause
      await systemState.emergencyUnpauseQC(qcAddress.address)

      // Should work now
      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(
          qcAddress.address,
          amount,
          TEST_CONSTANTS.VALID_LEGACY_BTC,
          walletAddress
        )

      await expect(tx).to.emit(qcRedeemer, "RedemptionRequested")
    })
  })

  describe("System-Wide Emergency Pause", () => {
    it("should prevent all new redemptions when system is paused", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, user, qcAddress } = fixture

      // Setup multiple QCs
      const qc1 = qcAddress.address
      const qc2 = fixture.user2.address

      await fixture.qcData.registerQC(qc1, TEST_CONSTANTS.LARGE_CAP)
      await fixture.qcData.registerQC(qc2, TEST_CONSTANTS.LARGE_CAP)

      const wallet1 = TEST_CONSTANTS.VALID_LEGACY_BTC
      const wallet2 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"

      await fixture.qcData.registerWallet(qc1, wallet1)
      await fixture.qcData.registerWallet(qc2, wallet2)

      // Setup user with tBTC
      const amount = ethers.BigNumber.from(TEST_CONSTANTS.MEDIUM_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await fixture.tbtc.mint(user.address, amount.mul(2))
      await fixture.tbtc
        .connect(user)
        .approve(qcRedeemer.address, amount.mul(2))

      // Pause all redemptions
      await systemState.pauseRedemption()

      // Both QCs should be blocked
      await expectCustomError(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qc1,
            amount,
            TEST_CONSTANTS.VALID_LEGACY_BTC,
            wallet1
          ),
        qcRedeemer,
        "RedemptionsArePaused"
      )

      await expectCustomError(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qc2,
            amount,
            TEST_CONSTANTS.VALID_LEGACY_BTC,
            wallet2
          ),
        qcRedeemer,
        "RedemptionsArePaused"
      )
    })

    it("should prevent fulfillment when system is paused", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, watchdog } = fixture

      // Create redemption before pause
      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Pause system
      await systemState.pauseRedemption()

      // Fulfillment should be blocked
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount),
        qcRedeemer,
        "RedemptionsArePaused"
      )
    })

    it("should prevent defaulting when system is paused", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, watchdog } = fixture

      // Create redemption before pause
      const { redemptionId } = await createTestRedemption(fixture)

      // Pause system
      await systemState.pauseRedemption()

      // Defaulting should work even when paused (emergency resolution)
      const reason = ethers.utils.formatBytes32String("EMERGENCY_DEFAULT")

      const tx = await qcRedeemer
        .connect(watchdog)
        .flagDefaultedRedemption(redemptionId, reason)

      await expect(tx).to.emit(qcRedeemer, "RedemptionDefaulted")
    })
  })

  describe("Mixed Pause States", () => {
    it("should handle QC-specific pause with system running", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, user } = fixture

      // Setup two QCs
      const qc1 = fixture.qcAddress.address
      const qc2 = fixture.user2.address

      await fixture.qcData.registerQC(qc1, TEST_CONSTANTS.LARGE_CAP)
      await fixture.qcData.registerQC(qc2, TEST_CONSTANTS.LARGE_CAP)

      const wallet1 = TEST_CONSTANTS.VALID_LEGACY_BTC
      const wallet2 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"

      await fixture.qcData.registerWallet(qc1, wallet1)
      await fixture.qcData.registerWallet(qc2, wallet2)

      // Setup user with tBTC
      const amount = ethers.BigNumber.from(TEST_CONSTANTS.MEDIUM_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await fixture.tbtc.mint(user.address, amount.mul(2))
      await fixture.tbtc
        .connect(user)
        .approve(qcRedeemer.address, amount.mul(2))

      // Emergency pause only QC1
      await systemState.emergencyPauseQC(qc1)

      // QC1 should be blocked
      await expectCustomError(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qc1,
            amount,
            TEST_CONSTANTS.VALID_LEGACY_BTC,
            wallet1
          ),
        qcRedeemer,
        "QCIsEmergencyPaused"
      )

      // QC2 should work normally
      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(
          qc2,
          amount,
          TEST_CONSTANTS.VALID_LEGACY_BTC,
          wallet2
        )

      await expect(tx).to.emit(qcRedeemer, "RedemptionRequested")
    })

    it("should handle system pause overriding QC-specific states", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, user, qcAddress } = fixture

      // Setup QC (not paused)
      await fixture.qcData.registerQC(
        qcAddress.address,
        TEST_CONSTANTS.LARGE_CAP
      )
      const walletAddress = TEST_CONSTANTS.VALID_LEGACY_BTC
      await fixture.qcData.registerWallet(qcAddress.address, walletAddress)

      // Setup user with tBTC
      const amount = ethers.BigNumber.from(TEST_CONSTANTS.MEDIUM_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await fixture.tbtc.mint(user.address, amount)
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, amount)

      // Pause entire system (overrides individual QC states)
      await systemState.pauseRedemption()

      // Even non-emergency-paused QC should be blocked
      await expectCustomError(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            amount,
            TEST_CONSTANTS.VALID_LEGACY_BTC,
            walletAddress
          ),
        qcRedeemer,
        "RedemptionsArePaused"
      )
    })
  })

  describe("System Recovery Scenarios", () => {
    it("should handle recovery from emergency pause with pending redemptions", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, watchdog, user, qcAddress } = fixture

      // Create multiple redemptions before emergency
      const redemptions = []
      for (let i = 0; i < 3; i++) {
        const { redemptionId, amount } = await createTestRedemption(fixture)
        redemptions.push({ redemptionId, amount })
      }

      // Verify all pending
      for (const { redemptionId } of redemptions) {
        const redemption = await qcRedeemer.redemptions(redemptionId)
        expect(redemption.status).to.equal(1) // Pending
      }

      // Emergency pause QC
      await systemState.emergencyPauseQC(qcAddress.address)

      // Resolve some redemptions during emergency
      const satoshiAmount1 = redemptions[0].amount.div(
        ethers.BigNumber.from(10).pow(10)
      )

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(
          redemptions[0].redemptionId,
          satoshiAmount1
        )

      await qcRedeemer
        .connect(watchdog)
        .flagDefaultedRedemption(
          redemptions[1].redemptionId,
          ethers.utils.formatBytes32String("EMERGENCY_DEFAULT")
        )

      // Unpause QC
      await systemState.emergencyUnpauseQC(qcAddress.address)

      // Should be able to create new redemptions
      await fixture.tbtc.mint(user.address, redemptions[0].amount)
      await fixture.tbtc
        .connect(user)
        .approve(qcRedeemer.address, redemptions[0].amount)

      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(
          qcAddress.address,
          redemptions[0].amount,
          TEST_CONSTANTS.VALID_LEGACY_BTC,
          TEST_CONSTANTS.VALID_LEGACY_BTC
        )

      await expect(tx).to.emit(qcRedeemer, "RedemptionRequested")

      // Existing pending redemption should still be resolvable
      const satoshiAmount2 = redemptions[2].amount.div(
        ethers.BigNumber.from(10).pow(10)
      )

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(
          redemptions[2].redemptionId,
          satoshiAmount2
        )

      // Verify final states
      expect(
        (await qcRedeemer.redemptions(redemptions[0].redemptionId)).status
      ).to.equal(2) // Fulfilled
      expect(
        (await qcRedeemer.redemptions(redemptions[1].redemptionId)).status
      ).to.equal(3) // Defaulted
      expect(
        (await qcRedeemer.redemptions(redemptions[2].redemptionId)).status
      ).to.equal(2) // Fulfilled
    })

    it("should maintain wallet obligation tracking during emergency scenarios", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, watchdog, qcAddress } = fixture

      const walletAddress = TEST_CONSTANTS.VALID_LEGACY_BTC

      // Create multiple redemptions for same wallet
      const redemptions = []
      for (let i = 0; i < 3; i++) {
        const { redemptionId, amount } = await createTestRedemption(fixture, {
          walletAddress,
        })

        redemptions.push({ redemptionId, amount })
      }

      // Verify wallet has obligations
      expect(await qcRedeemer.hasWalletObligations(walletAddress)).to.be.true
      expect(
        await qcRedeemer.getWalletPendingRedemptionCount(walletAddress)
      ).to.equal(3)

      // Emergency pause QC
      await systemState.emergencyPauseQC(qcAddress.address)

      // Resolve one redemption during emergency
      const satoshiAmount = redemptions[0].amount.div(
        ethers.BigNumber.from(10).pow(10)
      )

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(
          redemptions[0].redemptionId,
          satoshiAmount
        )

      // Check obligation count decreased
      expect(
        await qcRedeemer.getWalletPendingRedemptionCount(walletAddress)
      ).to.equal(2)
      expect(await qcRedeemer.hasWalletObligations(walletAddress)).to.be.true

      // Unpause and resolve remaining
      await systemState.emergencyUnpauseQC(qcAddress.address)

      const satoshiAmount2 = redemptions[1].amount.div(
        ethers.BigNumber.from(10).pow(10)
      )

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(
          redemptions[1].redemptionId,
          satoshiAmount2
        )

      await qcRedeemer
        .connect(watchdog)
        .flagDefaultedRedemption(
          redemptions[2].redemptionId,
          ethers.utils.formatBytes32String("TIMEOUT")
        )

      // All obligations should be cleared
      expect(
        await qcRedeemer.getWalletPendingRedemptionCount(walletAddress)
      ).to.equal(0)
      expect(await qcRedeemer.hasWalletObligations(walletAddress)).to.be.false
    })

    it("should handle timeout calculations correctly during long emergency pauses", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, qcAddress } = fixture

      // Set short timeout for testing
      await systemState.setRedemptionTimeout(3600) // 1 hour

      // Create redemption
      const { redemptionId } = await createTestRedemption(fixture)

      // Verify not timed out initially
      expect(await qcRedeemer.isRedemptionTimedOut(redemptionId)).to.be.false

      // Emergency pause QC
      await systemState.emergencyPauseQC(qcAddress.address)

      // Fast forward past timeout during emergency
      await time.increase(7200) // 2 hours

      // Should be timed out even during emergency
      expect(await qcRedeemer.isRedemptionTimedOut(redemptionId)).to.be.true

      // Unpause - redemption should still be timed out
      await systemState.emergencyUnpauseQC(qcAddress.address)
      expect(await qcRedeemer.isRedemptionTimedOut(redemptionId)).to.be.true
    })
  })

  describe("Emergency Operations Validation", () => {
    it("should validate only authorized roles can emergency pause", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { systemState, user, qcAddress } = fixture

      // Non-authorized user should not be able to emergency pause
      await expect(
        systemState.connect(user).emergencyPauseQC(qcAddress.address)
      ).to.be.reverted
    })

    it("should emit correct events during emergency operations", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, watchdog, qcAddress } = fixture

      // Create redemption to test event emissions during emergency operations
      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Emergency pause should emit events (in SystemState)
      await expect(systemState.emergencyPauseQC(qcAddress.address))
        .to.emit(systemState, "QCEmergencyPaused")
        .withArgs(qcAddress.address)

      // Fulfillment during emergency should still emit events
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      await expect(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)
      ).to.emit(qcRedeemer, "RedemptionFulfilled")

      // Unpause should emit events
      await expect(systemState.emergencyUnpauseQC(qcAddress.address))
        .to.emit(systemState, "QCEmergencyUnpaused")
        .withArgs(qcAddress.address)
    })
  })
})
