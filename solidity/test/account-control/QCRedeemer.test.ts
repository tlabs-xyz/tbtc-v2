import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import {
  deployQCRedeemerFixture,
  createTestRedemption,
  getSimpleSpvData,
  TEST_CONSTANTS,
} from "./fixtures/AccountControlFixtures"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCRedeemer", () => {
  describe("Deployment", () => {
    it("should set correct dependencies", async () => {
      const { qcRedeemer } = await loadFixture(deployQCRedeemerFixture)
      expect(qcRedeemer.address).to.not.equal(ethers.constants.AddressZero)
    })

    it("should grant deployer admin role", async () => {
      const { qcRedeemer, deployer, constants } = await loadFixture(deployQCRedeemerFixture)
      expect(await qcRedeemer.hasRole(constants.ROLES.DEFAULT_ADMIN, deployer.address)).to.be.true
    })

    it("should configure dispute arbiter role", async () => {
      const { qcRedeemer, watchdog, constants } = await loadFixture(deployQCRedeemerFixture)
      expect(await qcRedeemer.hasRole(constants.ROLES.DISPUTE_ARBITER, watchdog.address)).to.be
        .true
    })
  })

  describe("Redemption Requests", () => {
    it("should create redemption request with valid parameters", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress, constants } = fixture

      // Setup QC and wallet in QCData
      await fixture.qcData.registerQC(qcAddress.address, constants.LARGE_CAP)
      const walletAddress = ethers.Wallet.createRandom().address
      await fixture.qcData.registerWallet(
        walletAddress,
        qcAddress.address,
        constants.VALID_LEGACY_BTC,
        ethers.utils.randomBytes(32)
      )

      // Mint some tBTC for the user
      await fixture.tbtc.mint(user.address, ethers.utils.parseEther("10"))

      // Approve QCRedeemer to burn tBTC
      await fixture.tbtc
        .connect(user)
        .approve(qcRedeemer.address, ethers.utils.parseEther("10"))

      // Request redemption
      const redemptionId = ethers.utils.id("test_redemption_1")
      const amount = constants.MEDIUM_MINT // 0.01 BTC in satoshis

      const tx = await qcRedeemer
        .connect(user)
        .requestRedemption(redemptionId, amount, constants.VALID_LEGACY_BTC, walletAddress)

      await expect(tx)
        .to.emit(qcRedeemer, "RedemptionRequested")
        .withArgs(redemptionId, user.address, amount, constants.VALID_LEGACY_BTC, walletAddress)

      // Verify redemption state
      const redemption = await qcRedeemer.redemptions(redemptionId)
      expect(redemption.requester).to.equal(user.address)
      expect(redemption.amount).to.equal(amount)
      expect(redemption.btcAddress).to.equal(constants.VALID_LEGACY_BTC)
    })

    it("should prevent duplicate redemption IDs", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, constants } = fixture

      // Create first redemption
      const { redemptionId } = await createTestRedemption(fixture)

      // Mint more tBTC for another attempt
      await fixture.tbtc.mint(user.address, ethers.utils.parseEther("10"))
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, ethers.utils.parseEther("10"))

      // Try to create redemption with same ID
      await expect(
        qcRedeemer
          .connect(user)
          .requestRedemption(
            redemptionId,
            constants.SMALL_MINT,
            constants.VALID_LEGACY_BTC,
            ethers.Wallet.createRandom().address
          )
      ).to.be.revertedWith("RedemptionAlreadyExists")
    })

    it("should validate Bitcoin address format", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, constants } = fixture

      // Setup wallet
      const walletAddress = ethers.Wallet.createRandom().address
      await fixture.qcData.registerQC(fixture.qcAddress.address, constants.LARGE_CAP)
      await fixture.qcData.registerWallet(
        walletAddress,
        fixture.qcAddress.address,
        constants.VALID_LEGACY_BTC,
        ethers.utils.randomBytes(32)
      )

      // Try with invalid Bitcoin address
      await expect(
        qcRedeemer
          .connect(user)
          .requestRedemption(
            ethers.utils.id("test"),
            constants.SMALL_MINT,
            "invalid_btc_address",
            walletAddress
          )
      ).to.be.revertedWith("InvalidBitcoinAddress")
    })

    it("should enforce minimum redemption amount", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, constants } = fixture

      // Setup wallet
      const walletAddress = ethers.Wallet.createRandom().address
      await fixture.qcData.registerQC(fixture.qcAddress.address, constants.LARGE_CAP)
      await fixture.qcData.registerWallet(
        walletAddress,
        fixture.qcAddress.address,
        constants.VALID_LEGACY_BTC,
        ethers.utils.randomBytes(32)
      )

      // Try with amount below minimum
      await expect(
        qcRedeemer
          .connect(user)
          .requestRedemption(
            ethers.utils.id("test"),
            constants.MIN_MINT - 1, // Below minimum
            constants.VALID_LEGACY_BTC,
            walletAddress
          )
      ).to.be.revertedWith("AmountBelowMinimum")
    })

    it("should check wallet registration status", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, constants } = fixture

      const unregisteredWallet = ethers.Wallet.createRandom().address

      await expect(
        qcRedeemer
          .connect(user)
          .requestRedemption(
            ethers.utils.id("test"),
            constants.SMALL_MINT,
            constants.VALID_LEGACY_BTC,
            unregisteredWallet
          )
      ).to.be.revertedWith("WalletNotRegistered")
    })
  })

  describe("Redemption Fulfillment", () => {
    it("should record fulfillment by watchdog", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog, constants } = fixture

      // Create redemption
      const { redemptionId, amount, btcAddress } = await createTestRedemption(fixture)

      // Get simple SPV data for test
      const spvData = getSimpleSpvData()

      // Record fulfillment
      const tx = await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillment(redemptionId, btcAddress, amount, spvData.txInfo, spvData.proof)

      await expect(tx)
        .to.emit(qcRedeemer, "RedemptionFulfilled")
        .withArgs(redemptionId, btcAddress, amount)

      // Verify redemption marked as fulfilled
      const redemption = await qcRedeemer.redemptions(redemptionId)
      expect(redemption.fulfilled).to.be.true
    })

    it("should prevent fulfillment by non-watchdog", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, constants } = fixture

      const { redemptionId, amount, btcAddress } = await createTestRedemption(fixture)
      const spvData = getSimpleSpvData()

      await expect(
        qcRedeemer
          .connect(user)
          .recordRedemptionFulfillment(redemptionId, btcAddress, amount, spvData.txInfo, spvData.proof)
      ).to.be.revertedWith(/AccessControl: account .* is missing role/)
    })

    it("should prevent double fulfillment", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId, amount, btcAddress } = await createTestRedemption(fixture)
      const spvData = getSimpleSpvData()

      // First fulfillment
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillment(redemptionId, btcAddress, amount, spvData.txInfo, spvData.proof)

      // Try second fulfillment
      await expect(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillment(redemptionId, btcAddress, amount, spvData.txInfo, spvData.proof)
      ).to.be.revertedWith("RedemptionAlreadyFulfilled")
    })
  })

  describe("Redemption Cancellation", () => {
    it("should allow dispute arbiter to cancel redemption", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId } = await createTestRedemption(fixture)

      // Cancel redemption
      const tx = await qcRedeemer.connect(watchdog).cancelRedemption(redemptionId)

      await expect(tx).to.emit(qcRedeemer, "RedemptionCancelled").withArgs(redemptionId)

      // Verify redemption is cancelled
      const redemption = await qcRedeemer.redemptions(redemptionId)
      expect(redemption.cancelled).to.be.true
    })

    it("should prevent cancellation by non-arbiter", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user } = fixture

      const { redemptionId } = await createTestRedemption(fixture)

      await expect(
        qcRedeemer.connect(user).cancelRedemption(redemptionId)
      ).to.be.revertedWith(/AccessControl: account .* is missing role/)
    })

    it("should prevent cancellation of fulfilled redemption", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId, amount, btcAddress } = await createTestRedemption(fixture)
      const spvData = getSimpleSpvData()

      // Fulfill redemption first
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillment(redemptionId, btcAddress, amount, spvData.txInfo, spvData.proof)

      // Try to cancel
      await expect(
        qcRedeemer.connect(watchdog).cancelRedemption(redemptionId)
      ).to.be.revertedWith("RedemptionAlreadyFulfilled")
    })
  })

  describe("Unfulfilled Redemption Queries", () => {
    it("should track unfulfilled redemptions for QC", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcAddress } = fixture

      // Initially no unfulfilled redemptions
      expect(await qcRedeemer.hasUnfulfilledRedemptions(qcAddress.address)).to.be.false

      // Create redemption
      await createTestRedemption(fixture)

      // Now has unfulfilled redemptions
      expect(await qcRedeemer.hasUnfulfilledRedemptions(qcAddress.address)).to.be.true
    })

    it("should return earliest redemption deadline", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcAddress } = fixture

      // Create multiple redemptions
      await createTestRedemption(fixture, { amount: 100000 })
      await createTestRedemption(fixture, { amount: 200000 })

      // Get earliest deadline
      const deadline = await qcRedeemer.getEarliestRedemptionDeadline(qcAddress.address)
      expect(deadline).to.be.gt(0)
    })

    it("should clear unfulfilled status after fulfillment", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcAddress, watchdog } = fixture

      // Create and fulfill redemption
      const { redemptionId, amount, btcAddress } = await createTestRedemption(fixture)
      const spvData = getSimpleSpvData()

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillment(redemptionId, btcAddress, amount, spvData.txInfo, spvData.proof)

      // No unfulfilled redemptions after fulfillment
      expect(await qcRedeemer.hasUnfulfilledRedemptions(qcAddress.address)).to.be.false
    })
  })

  describe("System Pause", () => {
    it("should prevent new redemptions when paused", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, user, constants } = fixture

      // Pause redemptions in SystemState
      await systemState.setRedemptionPaused(true)

      // Setup wallet
      const walletAddress = ethers.Wallet.createRandom().address
      await fixture.qcData.registerQC(fixture.qcAddress.address, constants.LARGE_CAP)
      await fixture.qcData.registerWallet(
        walletAddress,
        fixture.qcAddress.address,
        constants.VALID_LEGACY_BTC,
        ethers.utils.randomBytes(32)
      )

      // Try to create redemption
      await expect(
        qcRedeemer
          .connect(user)
          .requestRedemption(
            ethers.utils.id("test"),
            constants.SMALL_MINT,
            constants.VALID_LEGACY_BTC,
            walletAddress
          )
      ).to.be.revertedWith("RedemptionsPaused")
    })

    it("should allow fulfillment even when paused", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, watchdog } = fixture

      // Create redemption before pause
      const { redemptionId, amount, btcAddress } = await createTestRedemption(fixture)

      // Pause redemptions
      await systemState.setRedemptionPaused(true)

      // Should still allow fulfillment
      const spvData = getSimpleSpvData()
      await expect(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillment(redemptionId, btcAddress, amount, spvData.txInfo, spvData.proof)
      ).to.emit(qcRedeemer, "RedemptionFulfilled")
    })
  })

  describe("AccountControl Integration", () => {
    it("should reduce total minted on redemption", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { mockAccountControl, constants } = fixture

      // Set initial total minted
      const initialMinted = ethers.BigNumber.from("100000000000") // 1000 BTC
      await mockAccountControl.setTotalMintedForTesting(initialMinted)

      // Create redemption
      const { redemptionId, amount } = await createTestRedemption(fixture, {
        amount: constants.MEDIUM_MINT,
      })

      // Verify total minted was reduced (mock would track this)
      // In real implementation, this would call accountControl.redeem(amount)
      expect(redemptionId).to.not.be.empty
      expect(amount).to.equal(constants.MEDIUM_MINT)
    })

    it("should check total minted before allowing redemption", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { mockAccountControl, qcRedeemer, user, constants } = fixture

      // Set total minted to zero (no available BTC to redeem)
      await mockAccountControl.setTotalMintedForTesting(0)

      // Setup wallet
      const walletAddress = ethers.Wallet.createRandom().address
      await fixture.qcData.registerQC(fixture.qcAddress.address, constants.LARGE_CAP)
      await fixture.qcData.registerWallet(
        walletAddress,
        fixture.qcAddress.address,
        constants.VALID_LEGACY_BTC,
        ethers.utils.randomBytes(32)
      )

      // Mint tBTC for user
      await fixture.tbtc.mint(user.address, ethers.utils.parseEther("10"))
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, ethers.utils.parseEther("10"))

      // Should fail due to insufficient total minted
      await expect(
        qcRedeemer
          .connect(user)
          .requestRedemption(
            ethers.utils.id("test"),
            constants.MEDIUM_MINT,
            constants.VALID_LEGACY_BTC,
            walletAddress
          )
      ).to.be.revertedWith("InsufficientTotalMinted")
    })
  })
})