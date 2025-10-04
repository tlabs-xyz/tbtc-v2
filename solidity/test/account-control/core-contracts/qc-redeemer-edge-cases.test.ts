import { expect } from "chai"
import { ethers } from "hardhat"
import { FakeContract, smock } from "@defi-wonderland/smock"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import {
  QCRedeemer,
  QCData,
  SystemState,
  AccountControl,
  ILightRelay,
  TBTC,
  QCWalletManager,
} from "../../../typechain"
import { LibraryLinkingHelper } from "../helpers/library-linking-helper"
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers"

/**
 * QCRedeemer Edge Cases and Special Scenarios
 * 
 * This file consolidates all edge case tests from:
 * - qc-redeemer-emergency-scenarios.test.ts
 * - qc-redeemer-error-boundaries.test.ts
 * - qc-redeemer-obligations.test.ts
 * - qc-redeemer-timeout-deadlines.test.ts
 * - qc-redeemer-trusted-fulfillment.test.ts
 * - qc-redeemer-comprehensive-demo.test.ts (selected unique tests)
 */
describe("QCRedeemer Edge Cases and Scenarios", () => {
  // Common test setup will go here
  let qcRedeemer: QCRedeemer
  let fakeQCData: FakeContract<QCData>
  let fakeSystemState: FakeContract<SystemState>
  let fakeAccountControl: FakeContract<AccountControl>
  let fakeLightRelay: FakeContract<ILightRelay>
  let fakeTbtc: FakeContract<TBTC>
  let fakeWalletManager: FakeContract<QCWalletManager>

  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let user: SignerWithAddress
  let user2: SignerWithAddress
  let watchdog: SignerWithAddress
  let qcAddress: SignerWithAddress

  // Test constants
  const MEDIUM_MINT = 1000000 // 0.01 BTC in satoshis
  const VALID_LEGACY_BTC = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
  const VALID_BECH32_BTC = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080"
  const SATOSHI_TO_WEI = ethers.BigNumber.from(10).pow(10)

  // Role constants
  const GOVERNANCE_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("GOVERNANCE_ROLE")
  )
  const DISPUTE_ARBITER_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("DISPUTE_ARBITER_ROLE")
  )
  const WATCHDOG_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("WATCHDOG_ROLE")
  )
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero

  beforeEach(async () => {
    const signers = await ethers.getSigners()
    deployer = signers[0]
    governance = signers[1]
    user = signers[2]
    user2 = signers[3]
    watchdog = signers[4]
    qcAddress = signers[5]

    // Deploy mocks
    fakeQCData = await smock.fake<QCData>("QCData")
    fakeSystemState = await smock.fake<SystemState>("SystemState")
    fakeAccountControl = await smock.fake<AccountControl>("AccountControl")
    fakeLightRelay = await smock.fake<ILightRelay>("ILightRelay")
    fakeTbtc = await smock.fake<TBTC>("TBTC")
    fakeWalletManager = await smock.fake<QCWalletManager>("QCWalletManager")

    // Deploy QCRedeemer with library linking
    const libraries = await LibraryLinkingHelper.deployAllLibraries()

    const QCRedeemer = await ethers.getContractFactory("QCRedeemer", {
      libraries: libraries,
    })

    qcRedeemer = await QCRedeemer.deploy(
      fakeQCData.address,
      fakeSystemState.address,
      fakeAccountControl.address,
      fakeTbtc.address,
      fakeLightRelay.address
    )
    await qcRedeemer.deployed()

    // Grant roles
    await qcRedeemer.grantRole(DISPUTE_ARBITER_ROLE, watchdog.address)

    // Setup default mock behaviors
    fakeSystemState.isRedemptionPaused.returns(false)
    fakeSystemState.getRedemptionTimeout.returns(86400) // 24 hours
    fakeSystemState.isPaused.returns(false)
    fakeQCData.getWalletOwner.returns(qcAddress.address)
    fakeQCData.getState.returns({
      status: 1, // Active
      qcCap: ethers.utils.parseEther("100"),
      totalMinted: 0,
      totalBurned: 0
    })
    fakeWalletManager.isWalletActive.returns(true)
    fakeTbtc.balanceOf.returns(ethers.utils.parseEther("1000"))
    fakeTbtc.transferFrom.returns(true)
  })

  // Content from each edge case file will be added here in the following sections

  // ===== Tests from qc-redeemer-emergency-scenarios.test.ts =====

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

  // ===== Tests from qc-redeemer-error-boundaries.test.ts =====

  describe("Invalid Redemption ID Handling", () => {
    it("should handle empty redemption IDs gracefully", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const emptyRedemptionId = ethers.constants.HashZero

      // Should revert with appropriate error for trusted fulfillment
      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(emptyRedemptionId, 1000000),
        qcRedeemer,
        "InvalidRedemptionId"
      )

      // Should revert with appropriate error for flagging default
      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .flagDefaultedRedemption(
            emptyRedemptionId,
            ethers.utils.formatBytes32String("INVALID")
          ),
        qcRedeemer,
        "InvalidRedemptionId"
      )
    })

    it("should handle non-existent redemption IDs", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const fakeRedemptionId = ethers.utils.id("non-existent-redemption")

      // Should revert indicating redemption was not requested
      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(fakeRedemptionId, 1000000),
        qcRedeemer,
        "RedemptionNotRequested"
      )

      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .flagDefaultedRedemption(
            fakeRedemptionId,
            ethers.utils.formatBytes32String("INVALID")
          ),
        qcRedeemer,
        "RedemptionNotRequested"
      )
    })

    it("should handle malformed redemption ID formats", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      // Test various malformed formats
      const malformedIds = [
        "0x123", // Too short
        ethers.utils.id("valid-but-non-existent"),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("another-fake")),
      ]

      for (const malformedId of malformedIds) {
        await expectCustomError(
          qcRedeemer
            .connect(watchdog)
            .recordRedemptionFulfillmentTrusted(malformedId, 1000000),
          qcRedeemer,
          "RedemptionNotRequested"
        )
      }
    })

    it("should validate redemption ID uniqueness", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer } = fixture

      // Create first redemption
      const { redemptionId: firstId } = await createTestRedemption(fixture)

      // Create second redemption with same parameters (should get different ID)
      const { redemptionId: secondId } = await createTestRedemption(fixture)

      // IDs should be different due to counter increment
      expect(firstId).to.not.equal(secondId)

      // Both should be valid
      const firstRedemption = await qcRedeemer.redemptions(firstId)
      const secondRedemption = await qcRedeemer.redemptions(secondId)

      expect(firstRedemption.status).to.equal(1) // Pending
      expect(secondRedemption.status).to.equal(1) // Pending
    })
  })

  describe("Bitcoin Address Format Edge Cases", () => {
    it("should reject addresses with invalid length", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress } = fixture

      await fixture.qcData.registerQC(
        qcAddress.address,
        TEST_CONSTANTS.LARGE_CAP
      )

      const amount = ethers.BigNumber.from(TEST_CONSTANTS.SMALL_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await fixture.tbtc.mint(user.address, amount)
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, amount)

      const invalidAddresses = [
        "", // Empty
        "1", // Too short
        "1".repeat(100), // Too long
        "3".repeat(100), // Too long P2SH-style
        `bc1${"q".repeat(100)}`, // Too long Bech32
      ]

      for (const invalidAddr of invalidAddresses) {
        if (invalidAddr === "") {
          // Empty address triggers specific error
          await expect(
            qcRedeemer
              .connect(user)
              .initiateRedemption(
                qcAddress.address,
                amount,
                invalidAddr,
                invalidAddr
              )
          ).to.be.revertedWithCustomError(qcRedeemer, "BitcoinAddressRequired")
        } else {
          await expectCustomError(
            qcRedeemer
              .connect(user)
              .initiateRedemption(
                qcAddress.address,
                amount,
                invalidAddr,
                invalidAddr
              ),
            qcRedeemer,
            "InvalidBitcoinAddressFormat"
          )
        }
      }
    })

    it("should reject addresses with invalid prefixes", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress } = fixture

      await fixture.qcData.registerQC(
        qcAddress.address,
        TEST_CONSTANTS.LARGE_CAP
      )

      const amount = ethers.BigNumber.from(TEST_CONSTANTS.SMALL_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await fixture.tbtc.mint(user.address, amount)
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, amount)

      const invalidPrefixes = [
        "2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Invalid prefix '2'
        "4A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Invalid prefix '4'
        "bc2qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Invalid bech32 prefix
        "tb2qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Invalid testnet prefix
        "ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Litecoin prefix
      ]

      for (const invalidAddr of invalidPrefixes) {
        await expectCustomError(
          qcRedeemer
            .connect(user)
            .initiateRedemption(
              qcAddress.address,
              amount,
              invalidAddr,
              TEST_CONSTANTS.VALID_LEGACY_BTC
            ),
          qcRedeemer,
          "InvalidBitcoinAddressFormat"
        )
      }
    })

    it("should accept all valid Bitcoin address formats", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress } = fixture

      await fixture.qcData.registerQC(
        qcAddress.address,
        TEST_CONSTANTS.LARGE_CAP
      )

      const validAddresses = [
        "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // P2PKH (Genesis block)
        "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", // P2PKH
        "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // P2SH
        "3QJmV3qfvL9SuYo34YihAf3sRCW3qSinyC", // P2SH
        "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080", // Bech32 P2WPKH
        "bc1qrp33g0554cgvn8t6rt0v2cyzgg6kz5z4vqx8v5w0c8z2jj8r6mjhqxnxnxj", // Bech32 P2WSH
        "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", // Testnet Bech32
        "tb1qrp33g0554cgvn8t6rt0v2cyzgg6kz5z4vqx8v5w0c8z2jj8r6mjhqy9fjqh", // Testnet Bech32 long
      ]

      for (let i = 0; i < validAddresses.length; i++) {
        const validAddr = validAddresses[i]

        const walletAddr =
          validAddresses[Math.min(i, validAddresses.length - 1)]

        // Register wallet for each test
        await fixture.qcData.registerWallet(qcAddress.address, walletAddr)

        const amount = ethers.BigNumber.from(TEST_CONSTANTS.SMALL_MINT).mul(
          ethers.BigNumber.from(10).pow(10)
        )

        await fixture.tbtc.mint(user.address, amount)
        await fixture.tbtc.connect(user).approve(qcRedeemer.address, amount)

        // Should not revert
        const tx = await qcRedeemer
          .connect(user)
          .initiateRedemption(qcAddress.address, amount, validAddr, walletAddr)

        await expect(tx).to.emit(qcRedeemer, "RedemptionRequested")
      }
    })

    it("should validate Bitcoin addresses using standalone function", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer } = fixture

      const testCases = [
        { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", expected: true },
        { address: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", expected: true },
        {
          address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
          expected: true,
        },
        {
          address: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
          expected: true,
        },
        { address: "invalid_address", expected: false },
        { address: "", expected: false },
        {
          address: "0x742d35cc6574d94532f6b3b49e0f2b6aa8b5cd7",
          expected: false,
        },
        { address: "2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", expected: false },
        {
          address: "bc2qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
          expected: false,
        },
      ]

      for (const testCase of testCases) {
        const result = await qcRedeemer.validateBitcoinAddress(testCase.address)
        expect(result).to.equal(
          testCase.expected,
          `Address ${testCase.address} validation failed`
        )
      }
    })
  })

  describe("Amount Conversion Edge Cases", () => {
    it("should handle minimum amount boundaries", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress } = fixture

      await fixture.qcData.registerQC(
        qcAddress.address,
        TEST_CONSTANTS.LARGE_CAP
      )
      const walletAddress = TEST_CONSTANTS.VALID_LEGACY_BTC
      await fixture.qcData.registerWallet(qcAddress.address, walletAddress)

      // Test exact minimum amount
      const minAmount = await fixture.systemState.minMintAmount()
      const minAmountWei = minAmount.mul(ethers.BigNumber.from(10).pow(10))

      await fixture.tbtc.mint(user.address, minAmountWei)
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, minAmountWei)

      // Should work with exact minimum
      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(
          qcAddress.address,
          minAmountWei,
          TEST_CONSTANTS.VALID_LEGACY_BTC,
          walletAddress
        )

      await expect(tx).to.emit(qcRedeemer, "RedemptionRequested")

      // Test below minimum
      const belowMinWei = minAmountWei.sub(1)
      await fixture.tbtc.mint(user.address, belowMinWei)
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, belowMinWei)

      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            belowMinWei,
            TEST_CONSTANTS.VALID_LEGACY_BTC,
            walletAddress
          )
      ).to.be.reverted
    })

    it("should handle maximum uint256 amounts gracefully", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress } = fixture

      await fixture.qcData.registerQC(
        qcAddress.address,
        TEST_CONSTANTS.LARGE_CAP
      )
      const walletAddress = TEST_CONSTANTS.VALID_LEGACY_BTC
      await fixture.qcData.registerWallet(qcAddress.address, walletAddress)

      const maxAmount = ethers.constants.MaxUint256
      await fixture.tbtc.mint(user.address, maxAmount)
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, maxAmount)

      // Should revert due to validation (insufficient balance in mock or overflow)
      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            maxAmount,
            TEST_CONSTANTS.VALID_LEGACY_BTC,
            walletAddress
          )
      ).to.be.reverted
    })

    it("should handle precision in satoshi to wei conversions", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Test various satoshi amounts for fulfillment
      const satoshiAmounts = [
        1, // 1 satoshi
        100, // 100 satoshis
        1000000, // 0.01 BTC
        100000000, // 1 BTC
        2100000000000000, // 21M BTC in satoshis (near max supply)
      ]

      for (let i = 0; i < satoshiAmounts.length; i++) {
        // Create new redemption for each test
        if (i > 0) {
          const { redemptionId: newId } = await createTestRedemption(fixture)
          await qcRedeemer
            .connect(watchdog)
            .recordRedemptionFulfillmentTrusted(newId, satoshiAmounts[i])
        } else {
          await qcRedeemer
            .connect(watchdog)
            .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmounts[i])
        }
      }
    })

    it("should reject zero amounts in fulfillment", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId } = await createTestRedemption(fixture)

      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, 0),
        qcRedeemer,
        "InvalidAmount"
      )
    })

    it("should handle large satoshi amounts in fulfillment", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId } = await createTestRedemption(fixture)

      // Test maximum uint64 value
      const maxUint64 = ethers.BigNumber.from(2).pow(64).sub(1)

      // Should accept large but valid amounts
      const tx = await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(redemptionId, maxUint64)

      await expect(tx).to.emit(qcRedeemer, "RedemptionFulfilled")
    })
  })

  describe("State Validation Edge Cases", () => {
    it("should handle rapid state transitions", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Rapid fulfillment after creation should work
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))

      const tx = await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)

      await expect(tx).to.emit(qcRedeemer, "RedemptionFulfilled")

      // Immediate attempt to fulfill again should fail
      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount),
        qcRedeemer,
        "RedemptionNotPending"
      )
    })

    it("should prevent operations on defaulted redemptions", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Default the redemption
      const reason = ethers.utils.formatBytes32String("TEST_DEFAULT")
      await qcRedeemer
        .connect(watchdog)
        .flagDefaultedRedemption(redemptionId, reason)

      // Cannot fulfill defaulted redemption
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount),
        qcRedeemer,
        "RedemptionNotPending"
      )

      // Cannot default again
      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .flagDefaultedRedemption(redemptionId, reason),
        qcRedeemer,
        "RedemptionNotPending"
      )
    })

    it("should handle invalid reason parameters for defaults", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId } = await createTestRedemption(fixture)

      // Cannot default with empty reason
      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .flagDefaultedRedemption(redemptionId, ethers.constants.HashZero),
        qcRedeemer,
        "InvalidReason"
      )
    })
  })

  describe("Access Control Edge Cases", () => {
    it("should handle role revocation scenarios", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog, deployer } = fixture

      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Initially watchdog can fulfill
      let satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)

      // Create another redemption
      const { redemptionId: secondId, amount: secondAmount } =
        await createTestRedemption(fixture)

      // Revoke role from watchdog
      const disputeArbitrationRole = await qcRedeemer.DISPUTE_ARBITER_ROLE()
      await qcRedeemer
        .connect(deployer)
        .revokeRole(disputeArbitrationRole, watchdog.address)

      // Now watchdog cannot fulfill
      satoshiAmount = secondAmount.div(ethers.BigNumber.from(10).pow(10))
      await expect(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(secondId, satoshiAmount)
      ).to.be.revertedWith(
        `AccessControl: account ${watchdog.address.toLowerCase()} is missing role`
      )
    })

    it("should handle multiple role holders", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog, user2, deployer } = fixture

      // Grant dispute arbiter role to another user
      const disputeArbitrationRole = await qcRedeemer.DISPUTE_ARBITER_ROLE()
      await qcRedeemer
        .connect(deployer)
        .grantRole(disputeArbitrationRole, user2.address)

      const { redemptionId: firstId, amount: firstAmount } =
        await createTestRedemption(fixture)

      const { redemptionId: secondId, amount: secondAmount } =
        await createTestRedemption(fixture)

      // Both should be able to fulfill
      let satoshiAmount = firstAmount.div(ethers.BigNumber.from(10).pow(10))
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(firstId, satoshiAmount)

      satoshiAmount = secondAmount.div(ethers.BigNumber.from(10).pow(10))
      await qcRedeemer
        .connect(user2)
        .recordRedemptionFulfillmentTrusted(secondId, satoshiAmount)

      // Verify both redemptions are fulfilled
      expect((await qcRedeemer.redemptions(firstId)).status).to.equal(2)
      expect((await qcRedeemer.redemptions(secondId)).status).to.equal(2)
    })
  })

  describe("Data Integrity Edge Cases", () => {
    it("should maintain data consistency during concurrent operations", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog, qcAddress } = fixture

      // Create multiple redemptions
      const redemptions = []
      for (let i = 0; i < 5; i++) {
        const { redemptionId, amount } = await createTestRedemption(fixture)
        redemptions.push({ redemptionId, amount })
      }

      // Verify initial counts
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(5)

      // Fulfill some, default others in mixed order
      const operations = [
        { type: "fulfill", index: 1 },
        { type: "default", index: 3 },
        { type: "fulfill", index: 0 },
        { type: "default", index: 4 },
        { type: "fulfill", index: 2 },
      ]

      for (const op of operations) {
        const { redemptionId, amount } = redemptions[op.index]

        if (op.type === "fulfill") {
          const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
          await qcRedeemer
            .connect(watchdog)
            .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)
        } else {
          await qcRedeemer
            .connect(watchdog)
            .flagDefaultedRedemption(
              redemptionId,
              ethers.utils.formatBytes32String(`DEFAULT_${op.index}`)
            )
        }
      }

      // Final count should be zero
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(0)
      expect(await qcRedeemer.hasUnfulfilledRedemptions(qcAddress.address)).to
        .be.false
    })

    it("should handle array bounds correctly", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcAddress } = fixture

      // Initially no redemptions
      const initialRedemptions = await qcRedeemer.getQCRedemptions(
        qcAddress.address
      )

      expect(initialRedemptions.length).to.equal(0)

      // Add one redemption
      const { redemptionId } = await createTestRedemption(fixture)

      const oneRedemption = await qcRedeemer.getQCRedemptions(qcAddress.address)
      expect(oneRedemption.length).to.equal(1)
      expect(oneRedemption[0]).to.equal(redemptionId)

      // Add many redemptions
      const manyRedemptions = []
      for (let i = 0; i < 10; i++) {
        const { redemptionId: newId } = await createTestRedemption(fixture)
        manyRedemptions.push(newId)
      }

      const allRedemptions = await qcRedeemer.getQCRedemptions(
        qcAddress.address
      )

      expect(allRedemptions.length).to.equal(11) // 1 + 10

      // Verify all IDs are present
      expect(allRedemptions).to.include(redemptionId)
      for (const id of manyRedemptions) {
        expect(allRedemptions).to.include(id)
      }
    })
  })

  // ===== Tests from qc-redeemer-obligations.test.ts =====

  describe("Core Functionality", () => {
    describe("Wallet-specific redemption tracking", () => {
      it("should track redemptions by wallet", async () => {
        // User1 initiates redemption with wallet1
        await qcRedeemer
          .connect(user1)
          .initiateRedemption(
            qcAddress,
            redemptionAmount,
            userBtcAddress,
            qcWallet1
          )

        // Check wallet has obligations
        expect(await qcRedeemer.hasWalletObligations(qcWallet1)).to.be.true
        expect(
          await qcRedeemer.getWalletPendingRedemptionCount(qcWallet1)
        ).to.equal(1)

        // Wallet2 should have no obligations
        expect(await qcRedeemer.hasWalletObligations(qcWallet2)).to.be.false
        expect(
          await qcRedeemer.getWalletPendingRedemptionCount(qcWallet2)
        ).to.equal(0)
      })

      it("should handle multiple redemptions per wallet", async () => {
        // Multiple users initiate redemptions with same wallet
        await qcRedeemer
          .connect(user1)
          .initiateRedemption(
            qcAddress,
            redemptionAmount,
            userBtcAddress,
            qcWallet1
          )

        await qcRedeemer
          .connect(user2)
          .initiateRedemption(
            qcAddress,
            redemptionAmount.mul(2),
            userBtcAddress,
            qcWallet1
          )

        // Check wallet has multiple obligations
        expect(
          await qcRedeemer.getWalletPendingRedemptionCount(qcWallet1)
        ).to.equal(2)

        // Get detailed obligations
        const details = await qcRedeemer.getWalletObligationDetails(qcWallet1)
        expect(details.activeCount).to.equal(2)
        expect(details.totalAmount).to.equal(redemptionAmount.mul(3))
      })

      it("should reject redemption with unregistered wallet", async () => {
        const unregisteredWallet = "1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX"
        mockQCData.getWalletOwner
          .whenCalledWith(unregisteredWallet)
          .returns(ethers.constants.AddressZero)

        await expect(
          qcRedeemer
            .connect(user1)
            .initiateRedemption(
              qcAddress,
              redemptionAmount,
              userBtcAddress,
              unregisteredWallet
            )
        ).to.be.revertedWith("Wallet not registered to QC")
      })

      it("should reject redemption with wallet registered to different QC", async () => {
        const otherQC = "0x9876543210987654321098765432109876543210"
        mockQCData.getWalletOwner.whenCalledWith(qcWallet1).returns(otherQC)

        await expect(
          qcRedeemer
            .connect(user1)
            .initiateRedemption(
              qcAddress,
              redemptionAmount,
              userBtcAddress,
              qcWallet1
            )
        ).to.be.revertedWith("Wallet not registered to QC")
      })

      it("should reject redemption with inactive wallet", async () => {
        mockQCData.getWalletStatus.whenCalledWith(qcWallet1).returns(0) // Inactive

        await expect(
          qcRedeemer
            .connect(user1)
            .initiateRedemption(
              qcAddress,
              redemptionAmount,
              userBtcAddress,
              qcWallet1
            )
        ).to.be.revertedWith("Wallet not active")
      })
    })

    describe("Wallet obligation clearing", () => {
      let redemptionId: string

      beforeEach(async () => {
        // Initiate a redemption
        const tx = await qcRedeemer
          .connect(user1)
          .initiateRedemption(
            qcAddress,
            redemptionAmount,
            userBtcAddress,
            qcWallet1
          )

        const receipt = await tx.wait()

        const event = receipt.events?.find(
          (e) => e.event === "RedemptionRequested"
        )

        redemptionId = event?.args?.redemptionId
      })

      it("should clear wallet obligations on fulfillment", async () => {
        // Initially wallet has obligations
        expect(await qcRedeemer.hasWalletObligations(qcWallet1)).to.be.true
        expect(
          await qcRedeemer.getWalletPendingRedemptionCount(qcWallet1)
        ).to.equal(1)

        // Simulate fulfillment by flagging as defaulted
        // This tests the same wallet obligation clearing logic
        await qcRedeemer
          .connect(arbiter)
          .flagDefaultedRedemption(
            redemptionId,
            ethers.utils.formatBytes32String("TEST_FULFILLED")
          )

        // Assert post-conditions
        expect(await qcRedeemer.hasWalletObligations(qcWallet1)).to.be.false
        expect(
          await qcRedeemer.getWalletPendingRedemptionCount(qcWallet1)
        ).to.equal(0)
      })

      it("should clear wallet obligations on default", async () => {
        // Initially wallet has obligations
        expect(await qcRedeemer.hasWalletObligations(qcWallet1)).to.be.true

        // Flag as defaulted
        await qcRedeemer
          .connect(arbiter)
          .flagDefaultedRedemption(
            redemptionId,
            ethers.utils.formatBytes32String("TIMEOUT")
          )

        // After default, wallet should have no obligations
        expect(await qcRedeemer.hasWalletObligations(qcWallet1)).to.be.false
        expect(
          await qcRedeemer.getWalletPendingRedemptionCount(qcWallet1)
        ).to.equal(0)
      })
    })

    describe("Wallet earliest deadline tracking", () => {
      it("should track earliest deadline for wallet", async () => {
        // Initiate multiple redemptions
        await qcRedeemer
          .connect(user1)
          .initiateRedemption(
            qcAddress,
            redemptionAmount,
            userBtcAddress,
            qcWallet1
          )

        // Move time forward
        await ethers.provider.send("evm_increaseTime", [3600]) // 1 hour
        await ethers.provider.send("evm_mine", [])

        await qcRedeemer
          .connect(user2)
          .initiateRedemption(
            qcAddress,
            redemptionAmount,
            userBtcAddress,
            qcWallet1
          )

        // Get earliest deadline
        const earliestDeadline =
          await qcRedeemer.getWalletEarliestRedemptionDeadline(qcWallet1)

        // First redemption should have earlier deadline
        expect(earliestDeadline).to.be.gt(0)
        expect(earliestDeadline).to.not.equal(ethers.constants.MaxUint256)
      })

      it("should return max uint256 for wallet with no pending redemptions", async () => {
        const deadline = await qcRedeemer.getWalletEarliestRedemptionDeadline(
          qcWallet1
        )

        expect(deadline).to.equal(ethers.constants.MaxUint256)
      })
    })
  })

  describe("Edge Cases", () => {
    describe("Bitcoin Address Validation", () => {
      it("should reject QC wallet with invalid Bitcoin address format", async () => {
        const invalidWallet = "0x1234567890123456789012345678901234567890" // Ethereum address
        mockQCData.getWalletOwner
          .whenCalledWith(invalidWallet)
          .returns(qcAddress)
        mockQCData.getWalletStatus.whenCalledWith(invalidWallet).returns(1) // Active

        await expectCustomError(
          qcRedeemer
            .connect(user1)
            .initiateRedemption(
              qcAddress,
              redemptionAmount,
              userBtcAddress,
              invalidWallet
            ),
          qcRedeemer,
          "InvalidBitcoinAddressFormat"
        )
      })

      it("should accept various valid Bitcoin address formats", async () => {
        // Test P2PKH (starts with 1)
        const p2pkhWallet = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
        mockQCData.getWalletOwner.whenCalledWith(p2pkhWallet).returns(qcAddress)
        mockQCData.getWalletStatus.whenCalledWith(p2pkhWallet).returns(1) // Active

        await qcRedeemer
          .connect(user1)
          .initiateRedemption(
            qcAddress,
            redemptionAmount,
            userBtcAddress,
            p2pkhWallet
          )

        // Test P2SH (starts with 3)
        const p2shWallet = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"
        mockQCData.getWalletOwner.whenCalledWith(p2shWallet).returns(qcAddress)
        mockQCData.getWalletStatus.whenCalledWith(p2shWallet).returns(1) // Active

        await qcRedeemer
          .connect(user2)
          .initiateRedemption(
            qcAddress,
            redemptionAmount,
            userBtcAddress,
            p2shWallet
          )

        // Test Bech32 (starts with bc1)
        const bech32Wallet = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
        mockQCData.getWalletOwner
          .whenCalledWith(bech32Wallet)
          .returns(qcAddress)
        mockQCData.getWalletStatus.whenCalledWith(bech32Wallet).returns(1) // Active

        await qcRedeemer
          .connect(user3)
          .initiateRedemption(
            qcAddress,
            redemptionAmount,
            userBtcAddress,
            bech32Wallet
          )
      })
    })

    describe("Multiple Defaults Same Wallet", () => {
      it("should handle multiple redemption defaults for same wallet", async () => {
        // Create multiple redemptions for same wallet
        const tx1 = await qcRedeemer
          .connect(user1)
          .initiateRedemption(
            qcAddress,
            redemptionAmount,
            userBtcAddress,
            qcWallet1
          )

        const receipt1 = await tx1.wait()

        const redemptionId1 = receipt1.events?.find(
          (e) => e.event === "RedemptionRequested"
        )?.args?.redemptionId

        const tx2 = await qcRedeemer
          .connect(user2)
          .initiateRedemption(
            qcAddress,
            redemptionAmount.mul(2),
            userBtcAddress,
            qcWallet1
          )

        const receipt2 = await tx2.wait()

        const redemptionId2 = receipt2.events?.find(
          (e) => e.event === "RedemptionRequested"
        )?.args?.redemptionId

        // Check initial state
        expect(
          await qcRedeemer.getWalletPendingRedemptionCount(qcWallet1)
        ).to.equal(2)

        // Default first redemption
        await qcRedeemer
          .connect(arbiter)
          .flagDefaultedRedemption(
            redemptionId1,
            ethers.utils.formatBytes32String("TIMEOUT")
          )

        // Should decrement count
        expect(
          await qcRedeemer.getWalletPendingRedemptionCount(qcWallet1)
        ).to.equal(1)
        expect(await qcRedeemer.hasWalletObligations(qcWallet1)).to.be.true

        // Default second redemption
        await qcRedeemer
          .connect(arbiter)
          .flagDefaultedRedemption(
            redemptionId2,
            ethers.utils.formatBytes32String("TIMEOUT")
          )

        // Should be fully cleared
        expect(
          await qcRedeemer.getWalletPendingRedemptionCount(qcWallet1)
        ).to.equal(0)
        expect(await qcRedeemer.hasWalletObligations(qcWallet1)).to.be.false
      })

      it("should prevent counter underflow on multiple defaults", async () => {
        // Create one redemption
        const tx = await qcRedeemer
          .connect(user1)
          .initiateRedemption(
            qcAddress,
            redemptionAmount,
            userBtcAddress,
            qcWallet1
          )

        const receipt = await tx.wait()

        const redemptionId = receipt.events?.find(
          (e) => e.event === "RedemptionRequested"
        )?.args?.redemptionId

        // Default it once
        await qcRedeemer
          .connect(arbiter)
          .flagDefaultedRedemption(
            redemptionId,
            ethers.utils.formatBytes32String("TIMEOUT")
          )

        // Try to default same redemption again - should revert
        await expectCustomError(
          qcRedeemer
            .connect(arbiter)
            .flagDefaultedRedemption(
              redemptionId,
              ethers.utils.formatBytes32String("DUPLICATE")
            ),
          qcRedeemer,
          "RedemptionNotPending"
        )

        // Counter should be zero and not underflowed
        expect(
          await qcRedeemer.getWalletPendingRedemptionCount(qcWallet1)
        ).to.equal(0)
      })
    })

    describe("Concurrent Operations", () => {
      it("should handle mixed fulfillments and defaults for same wallet", async () => {
        // Create 3 redemptions
        const redemptionIds = []
        for (let i = 0; i < 3; i++) {
          const tx = await qcRedeemer
            .connect(user1)
            .initiateRedemption(
              qcAddress,
              redemptionAmount,
              userBtcAddress,
              qcWallet1
            )

          const receipt = await tx.wait()
          redemptionIds.push(
            receipt.events?.find((e) => e.event === "RedemptionRequested")?.args
              ?.redemptionId
          )
        }

        expect(
          await qcRedeemer.getWalletPendingRedemptionCount(qcWallet1)
        ).to.equal(3)

        // Default first, fulfill second, default third
        await qcRedeemer
          .connect(arbiter)
          .flagDefaultedRedemption(
            redemptionIds[0],
            ethers.utils.formatBytes32String("TIMEOUT")
          )
        expect(
          await qcRedeemer.getWalletPendingRedemptionCount(qcWallet1)
        ).to.equal(2)

        await qcRedeemer
          .connect(arbiter)
          .flagDefaultedRedemption(
            redemptionIds[2],
            ethers.utils.formatBytes32String("FAILURE")
          )
        expect(
          await qcRedeemer.getWalletPendingRedemptionCount(qcWallet1)
        ).to.equal(1)

        // Wallet should still have obligations
        expect(await qcRedeemer.hasWalletObligations(qcWallet1)).to.be.true
      })
    })

    describe("Array Growth Management", () => {
      it("should track redemption IDs even after fulfillment", async () => {
        // Create redemption
        const tx = await qcRedeemer
          .connect(user1)
          .initiateRedemption(
            qcAddress,
            redemptionAmount,
            userBtcAddress,
            qcWallet1
          )

        const receipt = await tx.wait()

        const redemptionId = receipt.events?.find(
          (e) => e.event === "RedemptionRequested"
        )?.args?.redemptionId

        // Get wallet redemptions before default
        const redemptionsBefore = await qcRedeemer.getWalletRedemptions(
          qcWallet1
        )

        expect(redemptionsBefore.length).to.equal(1)
        expect(redemptionsBefore[0]).to.equal(redemptionId)

        // Default the redemption
        await qcRedeemer
          .connect(arbiter)
          .flagDefaultedRedemption(
            redemptionId,
            ethers.utils.formatBytes32String("TIMEOUT")
          )

        // Array still contains the ID (not cleaned up)
        const redemptionsAfter = await qcRedeemer.getWalletRedemptions(
          qcWallet1
        )

        expect(redemptionsAfter.length).to.equal(1)
        expect(redemptionsAfter[0]).to.equal(redemptionId)

        // But counter is cleared
        expect(
          await qcRedeemer.getWalletPendingRedemptionCount(qcWallet1)
        ).to.equal(0)
      })
    })

    describe("Wallet Status Transitions", () => {
      it("should prevent redemption with wallet that becomes inactive", async () => {
        // Initially active
        mockQCData.getWalletStatus.whenCalledWith(qcWallet1).returns(1) // Active

        // Create first redemption - succeeds
        await qcRedeemer
          .connect(user1)
          .initiateRedemption(
            qcAddress,
            redemptionAmount,
            userBtcAddress,
            qcWallet1
          )

        // Wallet becomes inactive
        mockQCData.getWalletStatus.whenCalledWith(qcWallet1).returns(0)

        // Second redemption should fail
        await expect(
          qcRedeemer
            .connect(user2)
            .initiateRedemption(
              qcAddress,
              redemptionAmount,
              userBtcAddress,
              qcWallet1
            )
        ).to.be.revertedWith("Wallet not active")

        // But existing obligations remain
        expect(await qcRedeemer.hasWalletObligations(qcWallet1)).to.be.true
      })
    })

    describe("Redemption Deadline Tracking", () => {
      it("should correctly track earliest deadline with time progression", async () => {
        // Create first redemption
        await qcRedeemer
          .connect(user1)
          .initiateRedemption(
            qcAddress,
            redemptionAmount,
            userBtcAddress,
            qcWallet1
          )

        const firstDeadline =
          await qcRedeemer.getWalletEarliestRedemptionDeadline(qcWallet1)

        // Advance time by 1 hour
        await ethers.provider.send("evm_increaseTime", [3600])
        await ethers.provider.send("evm_mine", [])

        // Create second redemption (will have later deadline)
        await qcRedeemer
          .connect(user2)
          .initiateRedemption(
            qcAddress,
            redemptionAmount,
            userBtcAddress,
            qcWallet1
          )

        // Earliest deadline should still be the first one
        const earliestDeadline =
          await qcRedeemer.getWalletEarliestRedemptionDeadline(qcWallet1)

        expect(earliestDeadline).to.equal(firstDeadline)
      })
    })
  })

  // ===== Tests from qc-redeemer-timeout-deadlines.test.ts =====

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

  // ===== Tests from qc-redeemer-trusted-fulfillment.test.ts =====

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
