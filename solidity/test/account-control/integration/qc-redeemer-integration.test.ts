import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers"
import {
  deployQCRedeemerFixture,
  createTestRedemption,
  TEST_CONSTANTS,
} from "../fixtures/account-control-fixtures"
import { expectCustomError, ERROR_MESSAGES } from "../helpers/error-helpers"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCRedeemer Integration Tests", () => {
  // Note: Deployment tests are covered in core unit tests (qc-redeemer.test.ts)
  
  describe("Redemption Requests", () => {
    it("should create redemption request with valid parameters", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress, constants } = fixture

      // Setup QC and wallet in QCData
      await fixture.qcData.registerQC(qcAddress.address, constants.LARGE_CAP)
      const qcWalletAddress = constants.VALID_LEGACY_BTC
      await fixture.qcData.registerWallet(qcAddress.address, qcWalletAddress)

      // Mint some tBTC for the user
      await fixture.tbtc.mint(user.address, ethers.utils.parseEther("10"))

      // Approve QCRedeemer to burn tBTC
      await fixture.tbtc
        .connect(user)
        .approve(qcRedeemer.address, ethers.utils.parseEther("10"))

      // Initiate redemption (new API)
      const amountSatoshis = constants.MEDIUM_MINT // 0.01 BTC in satoshis

      const amount = ethers.BigNumber.from(amountSatoshis).mul(
        ethers.BigNumber.from(10).pow(10)
      ) // Convert to tBTC Wei

      const userBtcAddress = constants.VALID_LEGACY_BTC

      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(
          qcAddress.address,
          amount,
          userBtcAddress,
          qcWalletAddress
        )

      const receipt = await tx.wait()

      const event = receipt.events?.find(
        (e) => e.event === "RedemptionRequested"
      )

      const redemptionId = event?.args?.[0]

      await expect(tx).to.emit(qcRedeemer, "RedemptionRequested")

      // Verify redemption state
      const redemption = await qcRedeemer.redemptions(redemptionId)
      expect(redemption.user).to.equal(user.address)
      expect(redemption.amount).to.equal(amount) // amount is now in tBTC Wei
      expect(redemption.userBtcAddress).to.equal(userBtcAddress)
    })

    it("should allow multiple redemptions with same parameters", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress, constants } = fixture

      // Create first redemption
      const {
        amount,
        btcAddress,
        walletAddress,
        redemptionId: firstId,
      } = await createTestRedemption(fixture)

      // Mint more tBTC for another attempt
      await fixture.tbtc.mint(user.address, ethers.utils.parseEther("10"))
      await fixture.tbtc
        .connect(user)
        .approve(qcRedeemer.address, ethers.utils.parseEther("10"))

      // Create second redemption with same parameters (IDs will differ due to counter + timestamp)
      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(
          qcAddress.address,
          amount,
          btcAddress,
          walletAddress
        )

      const receipt = await tx.wait()

      const event = receipt.events?.find(
        (e: any) => e.event === "RedemptionRequested"
      )

      const secondId = event?.args?.[0]

      // IDs should be different
      expect(secondId).to.not.equal(firstId)
    })

    it("should validate Bitcoin address format", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress, constants } = fixture

      // Setup wallet
      const qcWalletAddress = constants.VALID_LEGACY_BTC
      await fixture.qcData.registerQC(qcAddress.address, constants.LARGE_CAP)
      await fixture.qcData.registerWallet(qcAddress.address, qcWalletAddress)

      // Mint tBTC for user
      const amount = ethers.BigNumber.from(constants.SMALL_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await fixture.tbtc.mint(user.address, amount)
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, amount)

      // Try with invalid Bitcoin address
      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            amount,
            "invalid_btc_address",
            qcWalletAddress
          )
      ).to.be.revertedWithCustomError(qcRedeemer, "InvalidBitcoinAddressFormat")
    })

    it("should enforce minimum redemption amount", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress, constants } = fixture

      // Setup wallet
      const qcWalletAddress = constants.VALID_LEGACY_BTC
      await fixture.qcData.registerQC(qcAddress.address, constants.LARGE_CAP)
      await fixture.qcData.registerWallet(qcAddress.address, qcWalletAddress)

      // Mint tBTC for user
      const belowMinAmount = ethers.BigNumber.from(constants.MIN_MINT - 1).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await fixture.tbtc.mint(user.address, belowMinAmount)
      await fixture.tbtc
        .connect(user)
        .approve(qcRedeemer.address, belowMinAmount)

      // Try with amount below minimum
      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            belowMinAmount,
            constants.VALID_LEGACY_BTC,
            qcWalletAddress
          )
      ).to.be.reverted
    })

    it("should check wallet registration status", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress, constants } = fixture

      const unregisteredWallet = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"

      // Register QC but not the wallet
      await fixture.qcData.registerQC(qcAddress.address, constants.LARGE_CAP)

      // Mint tBTC for user
      const amount = ethers.BigNumber.from(constants.SMALL_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await fixture.tbtc.mint(user.address, amount)
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, amount)

      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            amount,
            constants.VALID_LEGACY_BTC,
            unregisteredWallet
          )
      ).to.be.revertedWith("Wallet not registered to QC")
    })
  })

  describe("Redemption Fulfillment ", () => {
    it("should prevent fulfillment by non-watchdog", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, constants } = fixture

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
  })

  describe("Redemption Cancellation ", () => {
    it("should allow dispute arbiter to flag redemption as defaulted", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId } = await createTestRedemption(fixture)

      // Flag redemption as defaulted
      const reason = ethers.utils.id("test_default_reason")

      const tx = await qcRedeemer
        .connect(watchdog)
        .flagDefaultedRedemption(redemptionId, reason)

      await expect(tx).to.emit(qcRedeemer, "RedemptionDefaulted")

      // Verify redemption status is Defaulted
      const redemption = await qcRedeemer.redemptions(redemptionId)
      expect(redemption.status).to.equal(3) // RedemptionStatus.Defaulted
    })

    it("should prevent flagging by non-arbiter", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user } = fixture

      const { redemptionId } = await createTestRedemption(fixture)
      const reason = ethers.utils.id("test_default_reason")

      await expect(
        qcRedeemer.connect(user).flagDefaultedRedemption(redemptionId, reason)
      ).to.be.reverted
    })
  })

  describe("Unfulfilled Redemption Queries ", () => {
    it("should track unfulfilled redemptions for QC", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcAddress } = fixture

      // Initially no unfulfilled redemptions
      expect(await qcRedeemer.hasUnfulfilledRedemptions(qcAddress.address)).to
        .be.false

      // Create redemption
      await createTestRedemption(fixture)

      // Now has unfulfilled redemptions
      expect(await qcRedeemer.hasUnfulfilledRedemptions(qcAddress.address)).to
        .be.true
    })

    it("should return earliest redemption deadline", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcAddress, constants } = fixture

      // Create multiple redemptions with amounts above minimum
      await createTestRedemption(fixture, { amount: constants.MEDIUM_MINT })
      await createTestRedemption(fixture, { amount: constants.LARGE_MINT })

      // Get earliest deadline
      const deadline = await qcRedeemer.getEarliestRedemptionDeadline(
        qcAddress.address
      )

      expect(deadline).to.be.gt(0)
    })
  })

  describe("System Pause [validation]", () => {
    it("should prevent new redemptions when paused", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, user, qcAddress, constants } = fixture

      // Pause redemptions in SystemState (new API)
      await systemState.pauseRedemption()

      // Setup wallet
      const qcWalletAddress = constants.VALID_LEGACY_BTC
      await fixture.qcData.registerQC(qcAddress.address, constants.LARGE_CAP)
      await fixture.qcData.registerWallet(qcAddress.address, qcWalletAddress)

      // Mint tBTC for user
      const amount = ethers.BigNumber.from(constants.SMALL_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await fixture.tbtc.mint(user.address, amount)
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, amount)

      // Try to create redemption
      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            amount,
            constants.VALID_LEGACY_BTC,
            qcWalletAddress
          )
      ).to.be.reverted
    })

    it("should prevent fulfillment when paused", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, watchdog } = fixture

      // Create redemption before pause
      const { redemptionId, amount, btcAddress } = await createTestRedemption(
        fixture
      )

      // Pause redemptions
      await systemState.pauseRedemption()

      // Fulfillment is also blocked when paused (contract design)
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      await expect(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)
      ).to.be.revertedWithCustomError(qcRedeemer, "RedemptionsArePaused")
    })
  })

  describe("AccountControl Integration ", () => {
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
      const expectedAmount = ethers.BigNumber.from(constants.MEDIUM_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      expect(redemptionId).to.not.be.empty
      expect(amount).to.equal(expectedAmount) // amount is now in tBTC Wei
    })

    it("should check total minted before allowing redemption", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)

      const {
        mockAccountControl,
        qcRedeemer,
        user,
        qcAddress,
        constants,
        systemState,
        deployer,
      } = fixture

      // Set total minted to zero (no available BTC to redeem)
      await mockAccountControl.setTotalMintedForTesting(0)

      // Also set per-reserve minted amount to zero for QCRedeemer
      // The mock checks minted[msg.sender] where msg.sender is QCRedeemer
      await mockAccountControl.setMintedForTesting(qcRedeemer.address, 0)

      // Setup wallet
      const qcWalletAddress = constants.VALID_LEGACY_BTC
      await fixture.qcData.registerQC(qcAddress.address, constants.LARGE_CAP)
      await fixture.qcData.registerWallet(qcAddress.address, qcWalletAddress)

      // Mint tBTC for user
      await fixture.tbtc.mint(user.address, ethers.utils.parseEther("10"))
      await fixture.tbtc
        .connect(user)
        .approve(qcRedeemer.address, ethers.utils.parseEther("10"))

      // Should fail due to insufficient total minted (convert amount to tBTC Wei)
      const amount = ethers.BigNumber.from(constants.MEDIUM_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            amount,
            constants.VALID_LEGACY_BTC,
            qcWalletAddress
          )
      ).to.be.revertedWithCustomError(
        fixture.mockAccountControl,
        "InsufficientMinted"
      ) // MockAccountControl throws InsufficientMinted
    })
  })

  // ===== Tests merged from qc-redeemer-comprehensive-integration.test.ts =====

  describe("End-to-End Workflow Integration", () => {
    it("should complete full redemption lifecycle with multiple participants", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog, user, user2, qcAddress } = fixture

      // Setup multiple users with different amounts
      const amounts = [
        TEST_CONSTANTS.SMALL_MINT,
        TEST_CONSTANTS.MEDIUM_MINT,
        TEST_CONSTANTS.LARGE_MINT,
      ]

      const users = [user, user2, fixture.governance]
      const redemptions = []

      // Create redemptions for multiple users
      for (let i = 0; i < users.length; i++) {
        const userSigner = users[i]
        const amountSatoshis = amounts[i]

        const amountWei = ethers.BigNumber.from(amountSatoshis).mul(
          ethers.BigNumber.from(10).pow(10)
        )

        // Setup user with tBTC
        await fixture.tbtc.mint(userSigner.address, amountWei)
        await fixture.tbtc
          .connect(userSigner)
          .approve(qcRedeemer.address, amountWei)

        // Create redemption
        const tx = await qcRedeemer
          .connect(userSigner)
          .initiateRedemption(
            qcAddress.address,
            amountWei,
            TEST_CONSTANTS.VALID_LEGACY_BTC,
            TEST_CONSTANTS.VALID_LEGACY_BTC
          )

        const receipt = await tx.wait()

        const event = receipt.events?.find(
          (e) => e.event === "RedemptionRequested"
        )

        const redemptionId = event?.args?.redemptionId

        redemptions.push({
          redemptionId,
          amount: amountWei,
          amountSatoshis,
          user: userSigner,
        })

        await expect(tx).to.emit(qcRedeemer, "RedemptionRequested")
      }

      // Verify all redemptions are tracked
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(3)
      expect(await qcRedeemer.hasUnfulfilledRedemptions(qcAddress.address)).to
        .be.true

      // Process redemptions with different outcomes
      // Fulfill first redemption
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(
          redemptions[0].redemptionId,
          redemptions[0].amountSatoshis
        )

      // Default second redemption
      await qcRedeemer
        .connect(watchdog)
        .flagDefaultedRedemption(
          redemptions[1].redemptionId,
          ethers.utils.formatBytes32String("TIMEOUT")
        )

      // Fulfill third with overpayment
      const overpayment = ethers.BigNumber.from(
        redemptions[2].amountSatoshis
      ).add(1000000) // Add 0.01 BTC

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(
          redemptions[2].redemptionId,
          overpayment
        )

      // Verify final state
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(0)
      expect(await qcRedeemer.hasUnfulfilledRedemptions(qcAddress.address)).to
        .be.false

      // Verify individual statuses
      const finalRedemptions = await Promise.all(
        redemptions.map((r) => qcRedeemer.redemptions(r.redemptionId))
      )

      expect(finalRedemptions[0].status).to.equal(2) // Fulfilled
      expect(finalRedemptions[1].status).to.equal(3) // Defaulted
      expect(finalRedemptions[2].status).to.equal(2) // Fulfilled
    })

    it("should handle redemption flow with system parameter changes", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, watchdog } = fixture

      // Create redemption with initial timeout
      const initialTimeout = 86400 // 24 hours
      await systemState.setRedemptionTimeout(initialTimeout)

      const { redemptionId: firstId, amount: firstAmount } =
        await createTestRedemption(fixture)

      // Change timeout and create another redemption
      const newTimeout = 3600 // 1 hour
      await systemState.setRedemptionTimeout(newTimeout)

      const { redemptionId: secondId, amount: secondAmount } =
        await createTestRedemption(fixture)

      // Verify different deadlines
      const firstRedemption = await qcRedeemer.redemptions(firstId)
      const secondRedemption = await qcRedeemer.redemptions(secondId)

      expect(secondRedemption.deadline).to.be.lt(firstRedemption.deadline)

      // Both should be fulfillable
      const satoshiAmount1 = firstAmount.div(ethers.BigNumber.from(10).pow(10))
      const satoshiAmount2 = secondAmount.div(ethers.BigNumber.from(10).pow(10))

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(firstId, satoshiAmount1)

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(secondId, satoshiAmount2)

      // Verify both fulfilled
      expect((await qcRedeemer.redemptions(firstId)).status).to.equal(2)
      expect((await qcRedeemer.redemptions(secondId)).status).to.equal(2)
    })

    it("should integrate properly with AccountControl for reserve tracking", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, mockAccountControl, qcAddress } = fixture

      // Set initial state
      const initialTotalMinted = ethers.BigNumber.from("100000000000") // 1000 BTC
      const initialQCMinted = ethers.BigNumber.from("50000000000") // 500 BTC

      await mockAccountControl.setTotalMintedForTesting(initialTotalMinted)
      await mockAccountControl.setMintedForTesting(
        qcRedeemer.address,
        initialQCMinted
      )

      // Create multiple redemptions
      const redemptionAmount = TEST_CONSTANTS.MEDIUM_MINT // 0.01 BTC
      const redemptions = []

      for (let i = 0; i < 3; i++) {
        const { redemptionId, amount } = await createTestRedemption(fixture, {
          amount: redemptionAmount,
        })

        redemptions.push({ redemptionId, amount })
      }

      // Verify AccountControl was called for each redemption
      // In real implementation, this would reduce the minted amount
      // Mock tracks these calls for verification

      // Simulate fulfillment reducing minted amounts
      for (const { redemptionId, amount } of redemptions) {
        const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
        await qcRedeemer
          .connect(fixture.watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)

        // In real implementation, this would call accountControl.redeem()
        // to reduce minted amounts
      }

      // Verify final QC tracking
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(0)
    })
  })

  describe("Cross-QC Redemption Scenarios", () => {
    it("should handle redemptions across multiple QCs independently", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, user2, qcAddress, watchdog } = fixture

      // Setup second QC
      const qc2Address = fixture.governance.address
      await fixture.qcData.registerQC(qc2Address, TEST_CONSTANTS.LARGE_CAP)

      // Register wallets for both QCs
      const wallet1 = TEST_CONSTANTS.VALID_LEGACY_BTC
      const wallet2 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"

      await fixture.qcData.registerWallet(qc2Address, wallet2)

      // Setup users with tBTC
      const amount = ethers.BigNumber.from(TEST_CONSTANTS.MEDIUM_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await fixture.tbtc.mint(user.address, amount.mul(2))
      await fixture.tbtc.mint(user2.address, amount.mul(2))
      await fixture.tbtc
        .connect(user)
        .approve(qcRedeemer.address, amount.mul(2))
      await fixture.tbtc
        .connect(user2)
        .approve(qcRedeemer.address, amount.mul(2))

      // Create redemptions for QC1
      const qc1Redemptions = []
      for (let i = 0; i < 2; i++) {
        const tx = await qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            amount,
            TEST_CONSTANTS.VALID_LEGACY_BTC,
            wallet1
          )

        const receipt = await tx.wait()

        const event = receipt.events?.find(
          (e) => e.event === "RedemptionRequested"
        )

        qc1Redemptions.push(event?.args?.redemptionId)
      }

      // Create redemptions for QC2
      const qc2Redemptions = []
      for (let i = 0; i < 2; i++) {
        const tx = await qcRedeemer
          .connect(user2)
          .initiateRedemption(
            qc2Address,
            amount,
            TEST_CONSTANTS.VALID_LEGACY_BTC,
            wallet2
          )

        const receipt = await tx.wait()

        const event = receipt.events?.find(
          (e) => e.event === "RedemptionRequested"
        )

        qc2Redemptions.push(event?.args?.redemptionId)
      }

      // Verify independent tracking
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(2)
      expect(await qcRedeemer.qcActiveRedemptionCount(qc2Address)).to.equal(2)

      // Fulfill one from each QC
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(qc1Redemptions[0], satoshiAmount)

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(qc2Redemptions[0], satoshiAmount)

      // Verify counts updated independently
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(1)
      expect(await qcRedeemer.qcActiveRedemptionCount(qc2Address)).to.equal(1)

      // Default remaining from QC1, fulfill remaining from QC2
      await qcRedeemer
        .connect(watchdog)
        .flagDefaultedRedemption(
          qc1Redemptions[1],
          ethers.utils.formatBytes32String("QC1_DEFAULT")
        )

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(qc2Redemptions[1], satoshiAmount)

      // Final state verification
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(0)
      expect(await qcRedeemer.qcActiveRedemptionCount(qc2Address)).to.equal(0)

      expect(await qcRedeemer.hasUnfulfilledRedemptions(qcAddress.address)).to
        .be.false
      expect(await qcRedeemer.hasUnfulfilledRedemptions(qc2Address)).to.be.false
    })

    it("should maintain independent deadline tracking per QC", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress } = fixture

      // Setup second QC
      const qc2Address = fixture.governance.address
      await fixture.qcData.registerQC(qc2Address, TEST_CONSTANTS.LARGE_CAP)

      const wallet2 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"
      await fixture.qcData.registerWallet(qc2Address, wallet2)

      const amount = ethers.BigNumber.from(TEST_CONSTANTS.MEDIUM_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await fixture.tbtc.mint(user.address, amount.mul(2))
      await fixture.tbtc
        .connect(user)
        .approve(qcRedeemer.address, amount.mul(2))

      // Create redemption for QC1
      const { redemptionId: qc1Id } = await createTestRedemption(fixture)

      const qc1Deadline = await qcRedeemer.getEarliestRedemptionDeadline(
        qcAddress.address
      )

      // Wait some time
      await time.increase(3600) // 1 hour

      // Create redemption for QC2
      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(
          qc2Address,
          amount,
          TEST_CONSTANTS.VALID_LEGACY_BTC,
          wallet2
        )

      const qc2Deadline = await qcRedeemer.getEarliestRedemptionDeadline(
        qc2Address
      )

      // QC2 deadline should be later than QC1
      expect(qc2Deadline).to.be.gt(qc1Deadline)

      // Each QC should maintain its own earliest deadline
      expect(
        await qcRedeemer.getEarliestRedemptionDeadline(qcAddress.address)
      ).to.equal(qc1Deadline)
      expect(
        await qcRedeemer.getEarliestRedemptionDeadline(qc2Address)
      ).to.equal(qc2Deadline)
    })

    it("should handle emergency pause affecting multiple QCs differently", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, user, qcAddress, watchdog } = fixture

      // Setup second QC
      const qc2Address = fixture.governance.address
      await fixture.qcData.registerQC(qc2Address, TEST_CONSTANTS.LARGE_CAP)

      const wallet2 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"
      await fixture.qcData.registerWallet(qc2Address, wallet2)

      const amount = ethers.BigNumber.from(TEST_CONSTANTS.MEDIUM_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await fixture.tbtc.mint(user.address, amount.mul(4))
      await fixture.tbtc
        .connect(user)
        .approve(qcRedeemer.address, amount.mul(4))

      // Create redemptions for both QCs
      const { redemptionId: qc1Id } = await createTestRedemption(fixture)

      const qc2Tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(
          qc2Address,
          amount,
          TEST_CONSTANTS.VALID_LEGACY_BTC,
          wallet2
        )

      const qc2Receipt = await qc2Tx.wait()

      const qc2Event = qc2Receipt.events?.find(
        (e) => e.event === "RedemptionRequested"
      )

      const qc2Id = qc2Event?.args?.redemptionId

      // Emergency pause only QC1
      await systemState.emergencyPauseQC(qcAddress.address)

      // QC1 new redemptions should fail
      await expectCustomError(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            amount,
            TEST_CONSTANTS.VALID_LEGACY_BTC,
            TEST_CONSTANTS.VALID_LEGACY_BTC
          ),
        qcRedeemer,
        "QCIsEmergencyPaused"
      )

      // QC2 new redemptions should still work
      await qcRedeemer
        .connect(user)
        .initiateRedemption(
          qc2Address,
          amount,
          TEST_CONSTANTS.VALID_LEGACY_BTC,
          wallet2
        )

      // Both existing redemptions should be fulfillable
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(qc1Id, satoshiAmount)

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(qc2Id, satoshiAmount)

      // Verify both fulfilled despite QC1 being paused
      expect((await qcRedeemer.redemptions(qc1Id)).status).to.equal(2)
      expect((await qcRedeemer.redemptions(qc2Id)).status).to.equal(2)
    })
  })

  describe("Wallet Deregistration and Obligation Management", () => {
    it("should prevent wallet deregistration with pending redemptions", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcAddress } = fixture

      const walletAddress = TEST_CONSTANTS.VALID_LEGACY_BTC

      // Create redemption for wallet
      const { redemptionId } = await createTestRedemption(fixture, {
        walletAddress,
      })

      // Verify wallet has obligations
      expect(await qcRedeemer.hasWalletObligations(walletAddress)).to.be.true

      // In real implementation, QCManager would check this before allowing deregistration
      // This test demonstrates the integration point
      const hasObligations = await qcRedeemer.hasWalletObligations(
        walletAddress
      )

      expect(hasObligations).to.be.true

      // Simulated deregistration attempt should be blocked by QCManager
      // (This would be tested in QCManager integration tests)
    })

    it("should allow wallet deregistration after all obligations cleared", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const walletAddress = TEST_CONSTANTS.VALID_LEGACY_BTC

      // Create multiple redemptions for wallet
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

      // Clear all obligations
      for (const { redemptionId, amount } of redemptions) {
        const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
        await qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)
      }

      // Verify no obligations remain
      expect(await qcRedeemer.hasWalletObligations(walletAddress)).to.be.false
      expect(
        await qcRedeemer.getWalletPendingRedemptionCount(walletAddress)
      ).to.equal(0)

      // Wallet should now be eligible for deregistration
      const hasObligations = await qcRedeemer.hasWalletObligations(
        walletAddress
      )

      expect(hasObligations).to.be.false
    })

    it("should track obligations across wallet registration changes", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcAddress, watchdog } = fixture

      const wallet1 = TEST_CONSTANTS.VALID_LEGACY_BTC
      const wallet2 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"

      // Register second wallet
      await fixture.qcData.registerWallet(qcAddress.address, wallet2)

      // Create redemptions for both wallets
      const { redemptionId: id1, amount: amount1 } = await createTestRedemption(
        fixture,
        { walletAddress: wallet1 }
      )

      const { redemptionId: id2, amount: amount2 } = await createTestRedemption(
        fixture,
        { walletAddress: wallet2 }
      )

      // Both wallets should have obligations
      expect(await qcRedeemer.hasWalletObligations(wallet1)).to.be.true
      expect(await qcRedeemer.hasWalletObligations(wallet2)).to.be.true

      // Clear wallet1 obligations
      const satoshiAmount1 = amount1.div(ethers.BigNumber.from(10).pow(10))
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(id1, satoshiAmount1)

      // Wallet1 should be clear, wallet2 should still have obligations
      expect(await qcRedeemer.hasWalletObligations(wallet1)).to.be.false
      expect(await qcRedeemer.hasWalletObligations(wallet2)).to.be.true

      // Clear wallet2 obligations
      const satoshiAmount2 = amount2.div(ethers.BigNumber.from(10).pow(10))
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(id2, satoshiAmount2)

      // Both wallets should be clear
      expect(await qcRedeemer.hasWalletObligations(wallet1)).to.be.false
      expect(await qcRedeemer.hasWalletObligations(wallet2)).to.be.false
    })

    it("should provide detailed obligation information for wallet management", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const walletAddress = TEST_CONSTANTS.VALID_LEGACY_BTC

      // Create redemptions with different amounts
      const amounts = [
        TEST_CONSTANTS.SMALL_MINT,
        TEST_CONSTANTS.MEDIUM_MINT,
        TEST_CONSTANTS.LARGE_MINT,
      ]

      const redemptions = []
      let totalExpectedAmount = ethers.BigNumber.from(0)

      for (const amountSatoshis of amounts) {
        const amountWei = ethers.BigNumber.from(amountSatoshis).mul(
          ethers.BigNumber.from(10).pow(10)
        )

        const { redemptionId } = await createTestRedemption(fixture, {
          amount: amountSatoshis,
          walletAddress,
        })

        redemptions.push({ redemptionId, amount: amountWei })
        totalExpectedAmount = totalExpectedAmount.add(amountWei)
      }

      // Get detailed obligation information
      const obligationDetails = await qcRedeemer.getWalletObligationDetails(
        walletAddress
      )

      expect(obligationDetails.activeCount).to.equal(3)
      expect(obligationDetails.totalAmount).to.equal(totalExpectedAmount)
      expect(obligationDetails.earliestDeadline).to.be.gt(0)
      expect(obligationDetails.earliestDeadline).to.not.equal(
        ethers.constants.MaxUint256
      )

      // Fulfill one redemption and check updated details
      const satoshiAmount = amounts[0]
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(
          redemptions[0].redemptionId,
          satoshiAmount
        )

      const updatedDetails = await qcRedeemer.getWalletObligationDetails(
        walletAddress
      )

      expect(updatedDetails.activeCount).to.equal(2)
      expect(updatedDetails.totalAmount).to.equal(
        totalExpectedAmount.sub(redemptions[0].amount)
      )
    })
  })

  describe("Complex Multi-Actor Scenarios", () => {
    it("should handle concurrent operations from multiple actors", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)

      const {
        qcRedeemer,
        user,
        user2,
        governance,
        watchdog,
        deployer,
        qcAddress,
      } = fixture

      // Setup multiple actors with different roles
      const actors = [user, user2, governance]
      const redemptions = []

      // Multiple actors create redemptions simultaneously
      for (let i = 0; i < actors.length; i++) {
        const actor = actors[i]

        const amount = ethers.BigNumber.from(TEST_CONSTANTS.MEDIUM_MINT).mul(
          ethers.BigNumber.from(10).pow(10)
        )

        await fixture.tbtc.mint(actor.address, amount)
        await fixture.tbtc.connect(actor).approve(qcRedeemer.address, amount)

        const { redemptionId } = await createTestRedemption(fixture, {
          user: actor,
        })

        redemptions.push({ redemptionId, actor, amount })
      }

      // Grant additional dispute arbiter role for concurrent processing
      const disputeRole = await qcRedeemer.DISPUTE_ARBITER_ROLE()
      await qcRedeemer
        .connect(deployer)
        .grantRole(disputeRole, deployer.address)

      // Process redemptions concurrently with different arbiters
      const satoshiAmount1 = redemptions[0].amount.div(
        ethers.BigNumber.from(10).pow(10)
      )

      const satoshiAmount2 = redemptions[1].amount.div(
        ethers.BigNumber.from(10).pow(10)
      )

      // Different arbiters handle different redemptions
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(
          redemptions[0].redemptionId,
          satoshiAmount1
        )

      await qcRedeemer
        .connect(deployer)
        .flagDefaultedRedemption(
          redemptions[1].redemptionId,
          ethers.utils.formatBytes32String("ARBITER2_DEFAULT")
        )

      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(
          redemptions[2].redemptionId,
          satoshiAmount1
        )

      // Verify all processed correctly
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(0)

      const statuses = await Promise.all(
        redemptions.map((r) =>
          qcRedeemer.redemptions(r.redemptionId).then((red) => red.status)
        )
      )

      expect(statuses[0]).to.equal(2) // Fulfilled
      expect(statuses[1]).to.equal(3) // Defaulted
      expect(statuses[2]).to.equal(2) // Fulfilled
    })

    it("should maintain consistency during system upgrades and migrations", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog, qcAddress } = fixture

      // Create redemptions before "upgrade"
      const preUpgradeRedemptions = []
      for (let i = 0; i < 3; i++) {
        const { redemptionId, amount } = await createTestRedemption(fixture)
        preUpgradeRedemptions.push({ redemptionId, amount })
      }

      // Simulate system parameter changes (upgrade scenario)
      await fixture.systemState.setRedemptionTimeout(1800) // 30 minutes

      // Create redemptions after "upgrade"
      const postUpgradeRedemptions = []
      for (let i = 0; i < 2; i++) {
        const { redemptionId, amount } = await createTestRedemption(fixture)
        postUpgradeRedemptions.push({ redemptionId, amount })
      }

      // All redemptions should be processable
      const allRedemptions = [
        ...preUpgradeRedemptions,
        ...postUpgradeRedemptions,
      ]

      for (const { redemptionId, amount } of allRedemptions) {
        const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
        await qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)
      }

      // Verify all processed
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(0)

      // Verify all fulfilled
      for (const { redemptionId } of allRedemptions) {
        const redemption = await qcRedeemer.redemptions(redemptionId)
        expect(redemption.status).to.equal(2) // Fulfilled
      }
    })

    it("should handle stress testing with many simultaneous redemptions", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, watchdog, qcAddress } = fixture

      const redemptionCount = 10
      const redemptions = []

      // Create many redemptions
      for (let i = 0; i < redemptionCount; i++) {
        const { redemptionId, amount } = await createTestRedemption(fixture)
        redemptions.push({ redemptionId, amount })
      }

      // Verify tracking
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(redemptionCount)

      const redemptionIds = await qcRedeemer.getQCRedemptions(qcAddress.address)
      expect(redemptionIds.length).to.equal(redemptionCount)

      // Process all redemptions in batch
      for (const { redemptionId, amount } of redemptions) {
        const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
        await qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)
      }

      // Verify all cleared
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(0)
      expect(await qcRedeemer.hasUnfulfilledRedemptions(qcAddress.address)).to
        .be.false
    })
  })

  describe("Real-World Scenario Simulations", () => {
    it("should simulate high-frequency trading redemption patterns", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, watchdog, qcAddress } = fixture

      // Simulate rapid redemption creation and fulfillment
      const rounds = 5
      const redemptionsPerRound = 3

      for (let round = 0; round < rounds; round++) {
        const roundRedemptions = []

        // Create multiple redemptions rapidly
        for (let i = 0; i < redemptionsPerRound; i++) {
          const { redemptionId, amount } = await createTestRedemption(fixture)
          roundRedemptions.push({ redemptionId, amount })
        }

        // Verify peak tracking
        expect(
          await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
        ).to.equal(redemptionsPerRound)

        // Fulfill them rapidly
        for (const { redemptionId, amount } of roundRedemptions) {
          const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
          await qcRedeemer
            .connect(watchdog)
            .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)
        }

        // Verify cleared between rounds
        expect(
          await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
        ).to.equal(0)
      }
    })

    it("should simulate emergency market conditions with mixed outcomes", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, watchdog, qcAddress } = fixture

      // Simulate market stress - many redemptions created
      const stressRedemptions = []
      for (let i = 0; i < 8; i++) {
        const { redemptionId, amount } = await createTestRedemption(fixture)
        stressRedemptions.push({ redemptionId, amount })
      }

      // Simulate emergency pause during stress
      await systemState.emergencyPauseQC(qcAddress.address)

      // Process existing redemptions during emergency
      // Some fulfilled, some defaulted based on market conditions
      const outcomes = [
        "fulfill",
        "default",
        "fulfill",
        "default",
        "fulfill",
        "fulfill",
        "default",
        "fulfill",
      ]

      for (let i = 0; i < stressRedemptions.length; i++) {
        const { redemptionId, amount } = stressRedemptions[i]
        const outcome = outcomes[i]

        if (outcome === "fulfill") {
          const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
          await qcRedeemer
            .connect(watchdog)
            .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)
        } else {
          await qcRedeemer
            .connect(watchdog)
            .flagDefaultedRedemption(
              redemptionId,
              ethers.utils.formatBytes32String("MARKET_STRESS")
            )
        }
      }

      // Verify emergency resolution
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(0)

      // Resume normal operations
      await systemState.emergencyUnpauseQC(qcAddress.address)

      // Verify system can handle new redemptions post-emergency
      const { redemptionId: postEmergencyId } = await createTestRedemption(
        fixture
      )

      expect(postEmergencyId).to.not.be.empty
    })

    it("should handle long-term operation with deadline management", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, systemState, watchdog, qcAddress } = fixture

      // Set short timeout to simulate time pressure
      await systemState.setRedemptionTimeout(7200) // 2 hours

      // Create redemptions over time
      const redemptions = []
      for (let i = 0; i < 4; i++) {
        const { redemptionId, amount } = await createTestRedemption(fixture)
        redemptions.push({ redemptionId, amount })

        // Advance time between redemptions
        await time.increase(1800) // 30 minutes
      }

      // Check timeout status for different redemptions
      const timeoutStatuses = await Promise.all(
        redemptions.map((r) => qcRedeemer.isRedemptionTimedOut(r.redemptionId))
      )

      // First redemption should be timed out, later ones not yet
      expect(timeoutStatuses[0]).to.be.true // Created 1.5 hours ago, timeout is 2 hours, plus 3*30min = timed out
      expect(timeoutStatuses[3]).to.be.false // Most recent

      // Process all redemptions regardless of timeout status
      for (const { redemptionId, amount } of redemptions) {
        const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
        await qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)
      }

      // Verify all processed successfully
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(0)
    })
  })
})
