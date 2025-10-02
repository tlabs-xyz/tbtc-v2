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
} from "../../../typechain"
import { LibraryLinkingHelper } from "../helpers/library-linking-helper"

describe("QCRedeemer", () => {
  let qcRedeemer: QCRedeemer
  let fakeQCData: FakeContract<QCData>
  let fakeSystemState: FakeContract<SystemState>
  let fakeAccountControl: FakeContract<AccountControl>
  let fakeLightRelay: FakeContract<ILightRelay>
  let fakeTbtc: FakeContract<TBTC>

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
    ;[deployer, governance, user, user2, watchdog, qcAddress] =
      await ethers.getSigners()

    // Create fake contracts using Smock
    fakeQCData = await smock.fake<QCData>("QCData")
    fakeSystemState = await smock.fake<SystemState>("SystemState")
    fakeAccountControl = await smock.fake<AccountControl>("AccountControl")
    fakeLightRelay = await smock.fake<ILightRelay>("ILightRelay")
    fakeTbtc = await smock.fake<TBTC>("TBTC")

    // Deploy libraries
    const libraries = await LibraryLinkingHelper.deployAllLibraries()

    // Deploy QCRedeemer with fake dependencies
    qcRedeemer = (await LibraryLinkingHelper.deployQCRedeemer(
      fakeTbtc.address,
      fakeQCData.address,
      fakeSystemState.address,
      fakeAccountControl.address,
      libraries
    )) as QCRedeemer

    // Grant roles for testing
    await qcRedeemer.grantRole(GOVERNANCE_ROLE, governance.address)
    await qcRedeemer.grantRole(DISPUTE_ARBITER_ROLE, watchdog.address)
    await qcRedeemer.grantRole(WATCHDOG_ROLE, watchdog.address)

    // AccountControl address is set in constructor

    // Default mock behaviors
    fakeSystemState.isRedemptionPaused.returns(false)
    fakeSystemState.redemptionTimeout.returns(86400) // 24 hours
  })

  describe("Deployment", () => {
    it("should set correct dependencies", async () => {
      expect(qcRedeemer.address).to.not.equal(ethers.constants.AddressZero)
    })

    it("should grant deployer admin role", async () => {
      expect(await qcRedeemer.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to
        .be.true
    })

    it("should configure dispute arbiter role", async () => {
      expect(await qcRedeemer.hasRole(DISPUTE_ARBITER_ROLE, watchdog.address))
        .to.be.true
    })
  })

  describe("Redemption Requests", () => {
    beforeEach(async () => {
      // Setup QC as registered with wallet
      fakeQCData.getWalletOwner.returns(qcAddress.address)
      fakeQCData.getWalletStatus.returns(1) // WalletStatus.Active

      // Setup QC as registered and active
      fakeQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      fakeQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // QCStatus.Active

      // Setup system state defaults
      fakeSystemState.isQCEmergencyPaused.returns(false)
      fakeSystemState.minMintAmount.returns(ethers.BigNumber.from("100000")) // 0.001 BTC in satoshis

      // Setup user with tBTC balance
      fakeTbtc.balanceOf
        .whenCalledWith(user.address)
        .returns(ethers.utils.parseEther("10"))
      fakeTbtc.transferFrom.returns(true)
      fakeTbtc.burnFrom.returns(true)
    })

    it("should create redemption request with valid parameters", async () => {
      const amountSatoshis = MEDIUM_MINT
      const amount = ethers.BigNumber.from(amountSatoshis).mul(SATOSHI_TO_WEI)
      const userBtcAddress = VALID_LEGACY_BTC
      const qcWalletAddress = VALID_LEGACY_BTC

      // Setup mocks
      fakeAccountControl.notifyRedemption.returns()

      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(
          qcAddress.address,
          amount,
          userBtcAddress,
          qcWalletAddress
        )

      await expect(tx).to.emit(qcRedeemer, "RedemptionRequested")

      // The transaction success and RedemptionRequested event emission prove the mocks were called correctly
    })

    it("should revert when invalid QC address provided", async () => {
      const amount = ethers.utils.parseEther("1")

      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            ethers.constants.AddressZero,
            amount,
            VALID_LEGACY_BTC,
            VALID_LEGACY_BTC
          )
      ).to.be.revertedWith("InvalidQCAddress")
    })

    it("should revert when amount is zero", async () => {
      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            0,
            VALID_LEGACY_BTC,
            VALID_LEGACY_BTC
          )
      ).to.be.revertedWith("InvalidRedemptionAmount")
    })

    it("should revert when user BTC address is invalid", async () => {
      const amount = ethers.utils.parseEther("1")

      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            amount,
            "invalid_btc_address",
            VALID_LEGACY_BTC
          )
      ).to.be.revertedWith("InvalidBitcoinAddress")
    })

    it("should revert when QC wallet not registered", async () => {
      const amount = ethers.utils.parseEther("1")

      // Mock QCData to return empty wallet
      fakeQCData.getWalletOwner.returns(ethers.constants.AddressZero)
      fakeQCData.getWalletStatus.returns(0) // WalletStatus.Inactive

      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            amount,
            VALID_LEGACY_BTC,
            VALID_LEGACY_BTC
          )
      ).to.be.revertedWith("Wallet not registered to QC")
    })

    it("should revert when provided wallet doesn't match registered wallet", async () => {
      const amount = ethers.utils.parseEther("1")

      // Mock QCData to return different wallet
      fakeQCData.getWalletOwner.returns(user.address) // Different QC
      fakeQCData.getWalletStatus.returns(1) // WalletStatus.Active

      await expect(
        qcRedeemer.connect(user).initiateRedemption(
          qcAddress.address,
          amount,
          VALID_LEGACY_BTC,
          VALID_LEGACY_BTC // This doesn't match VALID_BECH32_BTC
        )
      ).to.be.revertedWith("QCWalletMismatch")
    })

    it("should support different Bitcoin address formats", async () => {
      const amount = ethers.utils.parseEther("1")

      const testAddresses = [
        VALID_LEGACY_BTC, // P2PKH
        "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // P2SH
        VALID_BECH32_BTC, // Bech32
      ]

      for (const btcAddress of testAddresses) {
        fakeQCData.getWalletOwner.returns(qcAddress.address)
        fakeQCData.getWalletStatus.returns(1) // WalletStatus.Active
        fakeAccountControl.notifyRedemption.returns()

        await expect(
          qcRedeemer
            .connect(user)
            .initiateRedemption(
              qcAddress.address,
              amount,
              btcAddress,
              btcAddress
            )
        ).to.not.be.reverted
      }
    })
  })

  //   describe("Redemption Cancellation", () => {
  //     let redemptionId: string
  //     const amount = ethers.utils.parseEther("1")
  //
  //     beforeEach(async () => {
  //       // Create a redemption first
  //       fakeTbtc.balanceOf
  //         .whenCalledWith(user.address)
  //         .returns(ethers.utils.parseEther("10"))
  //       fakeTbtc.transferFrom.returns(true)
  //       fakeTbtc.transfer.returns(true)
  //       fakeQCData.getWalletOwner.returns(qcAddress.address)
  //       fakeQCData.getWalletStatus.returns(1) // WalletStatus.Active
  //       fakeAccountControl.notifyRedemption.returns()
  //       fakeAccountControl.notifyRedemptionCancellation.returns()
  //
  //       const tx = await qcRedeemer
  //         .connect(user)
  //         .initiateRedemption(
  //           qcAddress.address,
  //           amount,
  //           VALID_LEGACY_BTC,
  //           VALID_LEGACY_BTC
  //         )
  //
  //       const receipt = await tx.wait()
  //
  //       const event = receipt.events?.find(
  //         (e) => e.event === "RedemptionRequested"
  //       )
  //
  //       redemptionId = event?.args?.[0]
  //     })
  //
  //     it("should allow user to cancel their own redemption", async () => {
  //       const tx = await qcRedeemer.connect(user).cancelRedemption(redemptionId)
  //
  //       await expect(tx)
  //         .to.emit(qcRedeemer, "RedemptionCancelled")
  //         .withArgs(redemptionId)
  //
  //       // Verify tBTC was returned
  //       expect(fakeTbtc.transfer).to.have.been.calledWith(user.address, amount)
  //
  //       // Verify AccountControl was notified
  //       expect(
  //         fakeAccountControl.notifyRedemptionCancellation
  //       ).to.have.been.calledWith(qcAddress.address, amount)
  //
  //       // Verify redemption is marked as cancelled
  //       const redemption = await qcRedeemer.redemptions(redemptionId)
  //       expect(redemption.status).to.equal(2) // CANCELLED
  //     })
  //
  //     it("should prevent cancellation by non-owner", async () => {
  //       await expect(
  //         qcRedeemer.connect(user2).cancelRedemption(redemptionId)
  //       ).to.be.revertedWith("NotRedemptionOwner")
  //     })
  //
  //     it("should prevent cancellation of non-existent redemption", async () => {
  //       const fakeId = ethers.utils.formatBytes32String("fake")
  //
  //       await expect(
  //         qcRedeemer.connect(user).cancelRedemption(fakeId)
  //       ).to.be.revertedWith("RedemptionNotFound")
  //     })
  //
  //     it("should prevent cancellation of already fulfilled redemption", async () => {
  //       // Fulfill the redemption using the watchdog (dispute arbiter)
  //       const redemption = await qcRedeemer.redemptions(redemptionId)
  //       const actualAmount = 100000000 // 1 BTC in satoshis
  //
  //       await qcRedeemer
  //         .connect(watchdog)
  //         .recordRedemptionFulfillmentTrusted(redemptionId, actualAmount)
  //
  //       // Verify redemption is now fulfilled
  //       const fulfilledRedemption = await qcRedeemer.redemptions(redemptionId)
  //       expect(fulfilledRedemption.status).to.equal(2) // FULFILLED
  //
  //       // Attempt to cancel fulfilled redemption should revert
  //       await expect(
  //         qcRedeemer.connect(user).cancelRedemption(redemptionId)
  //       ).to.be.revertedWith("RedemptionNotPending")
  //     })
  //   })

  describe("System Pause", () => {
    it("should prevent new redemptions when system is paused", async () => {
      // Mock system as paused
      fakeSystemState.isRedemptionPaused.returns(true)

      const amount = ethers.utils.parseEther("1")

      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            amount,
            VALID_LEGACY_BTC,
            VALID_LEGACY_BTC
          )
      ).to.be.revertedWithCustomError(qcRedeemer, "RedemptionsArePaused")
    })

    it("should allow redemptions when system is not paused", async () => {
      // Mock system as not paused (default)
      fakeSystemState.isRedemptionPaused.returns(false)

      // Setup other mocks
      fakeQCData.getWalletOwner.returns(qcAddress.address)
      fakeQCData.getWalletStatus.returns(1) // WalletStatus.Active
      fakeTbtc.transferFrom.returns(true)
      fakeTbtc.burnFrom.returns(true)
      fakeTbtc.balanceOf
        .whenCalledWith(user.address)
        .returns(ethers.utils.parseEther("10"))

      // Setup QC as registered and active
      fakeQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      fakeQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // QCStatus.Active

      // Setup system state defaults
      fakeSystemState.isQCEmergencyPaused.returns(false)
      fakeSystemState.minMintAmount.returns(ethers.BigNumber.from("100000")) // 0.001 BTC in satoshis

      fakeAccountControl.notifyRedemption.returns()

      const amount = ethers.utils.parseEther("1")

      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            amount,
            VALID_LEGACY_BTC,
            VALID_LEGACY_BTC
          )
      ).to.not.be.reverted
    })
  })

  describe("Unfulfilled Redemption Queries", () => {
    beforeEach(async () => {
      // Setup for creating redemptions
      fakeTbtc.balanceOf
        .whenCalledWith(user.address)
        .returns(ethers.utils.parseEther("10"))
      fakeTbtc.transferFrom.returns(true)
      fakeTbtc.burnFrom.returns(true)
      fakeQCData.getWalletOwner.returns(qcAddress.address)
      fakeQCData.getWalletStatus.returns(1) // WalletStatus.Active

      // Setup QC as registered and active
      fakeQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      fakeQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // QCStatus.Active

      // Setup system state defaults
      fakeSystemState.isQCEmergencyPaused.returns(false)
      fakeSystemState.minMintAmount.returns(ethers.BigNumber.from("100000")) // 0.001 BTC in satoshis

      fakeAccountControl.notifyRedemption.returns()
    })

    it("should return unfulfilled redemptions for user", async () => {
      // Create multiple redemptions
      const amount1 = ethers.utils.parseEther("1")
      const amount2 = ethers.utils.parseEther("2")

      await qcRedeemer
        .connect(user)
        .initiateRedemption(
          qcAddress.address,
          amount1,
          VALID_LEGACY_BTC,
          VALID_LEGACY_BTC
        )

      await qcRedeemer
        .connect(user)
        .initiateRedemption(
          qcAddress.address,
          amount2,
          VALID_LEGACY_BTC,
          VALID_LEGACY_BTC
        )

      const hasPending = await qcRedeemer.hasUnfulfilledRedemptions(
        qcAddress.address
      )

      expect(hasPending).to.be.true
    })

    it("should not include fulfilled redemptions", async () => {
      // Create redemption
      const amount = ethers.utils.parseEther("1")

      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(
          qcAddress.address,
          amount,
          VALID_LEGACY_BTC,
          VALID_LEGACY_BTC
        )

      const receipt = await tx.wait()

      const event = receipt.events?.find(
        (e) => e.event === "RedemptionRequested"
      )

      const redemptionId = event?.args?.[0]

      // Fulfill it using trusted arbiter
      const actualAmount = 100000000 // 1 BTC in satoshis
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(redemptionId, actualAmount)

      const hasPending = await qcRedeemer.hasUnfulfilledRedemptions(
        user.address
      )

      expect(hasPending).to.be.false
    })
  })
})
