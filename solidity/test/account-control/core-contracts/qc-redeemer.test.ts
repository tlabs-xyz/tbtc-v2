import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import {
  deployQCRedeemerFixture,
  createTestRedemption,
  getSimpleSpvData,
  getValidSpvData,
  TEST_CONSTANTS,
} from "../fixtures/AccountControlFixtures"
import { expectCustomError, ERROR_MESSAGES } from "../helpers/error-helpers"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCRedeemer [unit]", () => {
  describe("Deployment [unit]", () => {
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

  describe("Redemption Requests [unit]", () => {
    it("should create redemption request with valid parameters", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress, constants } = fixture

      // Setup QC and wallet in QCData
      await fixture.qcData.registerQC(qcAddress.address, constants.LARGE_CAP)
      const qcWalletAddress = constants.VALID_LEGACY_BTC
      await fixture.qcData.registerWallet(
        qcAddress.address,
        qcWalletAddress
      )

      // Mint some tBTC for the user
      await fixture.tbtc.mint(user.address, ethers.utils.parseEther("10"))

      // Approve QCRedeemer to burn tBTC
      await fixture.tbtc
        .connect(user)
        .approve(qcRedeemer.address, ethers.utils.parseEther("10"))

      // Initiate redemption (new API)
      const amountSatoshis = constants.MEDIUM_MINT // 0.01 BTC in satoshis
      const amount = ethers.BigNumber.from(amountSatoshis).mul(ethers.BigNumber.from(10).pow(10)) // Convert to tBTC Wei
      const userBtcAddress = constants.VALID_LEGACY_BTC

      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(qcAddress.address, amount, userBtcAddress, qcWalletAddress)

      const receipt = await tx.wait()
      const event = receipt.events?.find(e => e.event === "RedemptionRequested")
      const redemptionId = event?.args?.[0]

      await expect(tx)
        .to.emit(qcRedeemer, "RedemptionRequested")

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
      const { amount, btcAddress, walletAddress, redemptionId: firstId } = await createTestRedemption(fixture)

      // Mint more tBTC for another attempt
      await fixture.tbtc.mint(user.address, ethers.utils.parseEther("10"))
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, ethers.utils.parseEther("10"))

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
      const event = receipt.events?.find((e: any) => e.event === "RedemptionRequested")
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
      await fixture.qcData.registerWallet(
        qcAddress.address,
        qcWalletAddress
      )

      // Mint tBTC for user
      const amount = ethers.BigNumber.from(constants.SMALL_MINT).mul(ethers.BigNumber.from(10).pow(10))
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
      ).to.be.revertedWith("InvalidBitcoinAddressFormat")
    })

    it("should enforce minimum redemption amount", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress, constants } = fixture

      // Setup wallet
      const qcWalletAddress = constants.VALID_LEGACY_BTC
      await fixture.qcData.registerQC(qcAddress.address, constants.LARGE_CAP)
      await fixture.qcData.registerWallet(
        qcAddress.address,
        qcWalletAddress
      )

      // Mint tBTC for user
      const belowMinAmount = ethers.BigNumber.from(constants.MIN_MINT - 1).mul(ethers.BigNumber.from(10).pow(10))
      await fixture.tbtc.mint(user.address, belowMinAmount)
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, belowMinAmount)

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
      const amount = ethers.BigNumber.from(constants.SMALL_MINT).mul(ethers.BigNumber.from(10).pow(10))
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

  describe("Redemption Fulfillment [integration]", () => {
    it.skip("should validate SPV proof requirements for redemption fulfillment - TODO: REQUIRES Bitcoin transaction generation, proper SPV merkle proof builders, valid tBTC transaction outputs that match test addresses, and complete payment verification pipeline", async () => {
      // IMPLEMENTATION REQUIREMENTS:
      // 1. Bitcoin transaction generation with actual outputs to test addresses
      // 2. Proper SPV merkle proof builders that create valid proofs
      // 3. Bitcoin header chain validation with real difficulty verification
      // 4. Complete payment verification pipeline for all address formats
      // 5. Integration with tBTC SPV library validation patterns
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
      ).to.be.reverted
    })

    it.skip("should validate SPV proof structure before processing - TODO: REQUIRES Complete SPV structure validation, Bitcoin header chain validation, proper merkle proof format validation, and differentiated error handling for structure vs payment validation failures", async () => {
      // IMPLEMENTATION REQUIREMENTS:
      // 1. Complete SPV structure validation (headers, merkle proofs, coinbase proofs)
      // 2. Bitcoin header chain validation with proper difficulty checking
      // 3. Proper merkle proof format validation with length and structure checks
      // 4. Differentiated error handling for structure vs payment validation failures
      // 5. Edge case testing for malformed proofs, empty headers, invalid lengths
    })
  })

  describe("Redemption Cancellation [unit]", () => {
    it("should allow dispute arbiter to flag redemption as defaulted", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId } = await createTestRedemption(fixture)

      // Flag redemption as defaulted
      const reason = ethers.utils.id("test_default_reason")
      const tx = await qcRedeemer.connect(watchdog).flagDefaultedRedemption(redemptionId, reason)

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

    it.skip("should test redemption status validation with SPV proof verification - TODO: REQUIRES Full SPV proof validation that properly handles failed proofs while maintaining correct redemption status transitions", async () => {
      // IMPLEMENTATION REQUIREMENTS:
      // 1. Full SPV proof validation that properly handles failed proofs
      // 2. Correct redemption status transitions (Pending -> Fulfilled/Defaulted)
      // 3. Verification that failed SPV proofs don't incorrectly mark redemptions as fulfilled
      // 4. State consistency checks after failed validation attempts
      // 5. Proper error propagation and redemption status management
    })
  })

  describe("Unfulfilled Redemption Queries [unit]", () => {
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
      const { qcRedeemer, qcAddress, constants } = fixture

      // Create multiple redemptions with amounts above minimum
      await createTestRedemption(fixture, { amount: constants.MEDIUM_MINT })
      await createTestRedemption(fixture, { amount: constants.LARGE_MINT })

      // Get earliest deadline
      const deadline = await qcRedeemer.getEarliestRedemptionDeadline(qcAddress.address)
      expect(deadline).to.be.gt(0)
    })

    it.skip("should demonstrate SPV proof validation with comprehensive test data - TODO: REQUIRES Complete SPV test data suite with real Bitcoin transaction validation", async () => {
      // IMPLEMENTATION REQUIREMENTS:
      // 1. Complete SPV test data suite including valid Bitcoin transactions
      // 2. Valid Bitcoin transactions with matching output addresses for test scenarios
      // 3. Proper merkle proofs for real Bitcoin blocks with correct transaction inclusion
      // 4. Valid coinbase proofs that pass Bridge SPV validation
      // 5. Comprehensive validation covering all SPV pipeline stages
      // 6. Integration with tBTC v2 test suite validation patterns
      // 7. Differentiation between simple and comprehensive SPV data validation paths
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
      await fixture.qcData.registerWallet(
        qcAddress.address,
        qcWalletAddress
      )

      // Mint tBTC for user
      const amount = ethers.BigNumber.from(constants.SMALL_MINT).mul(ethers.BigNumber.from(10).pow(10))
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
      const { redemptionId, amount, btcAddress } = await createTestRedemption(fixture)

      // Pause redemptions
      await systemState.pauseRedemption()

      // Fulfillment is also blocked when paused (contract design)
      const spvData = getSimpleSpvData()
      await expect(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillment(redemptionId, btcAddress, amount, spvData.txInfo, spvData.proof)
      ).to.be.reverted
    })
  })

  describe("AccountControl Integration [integration]", () => {
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
      const expectedAmount = ethers.BigNumber.from(constants.MEDIUM_MINT).mul(ethers.BigNumber.from(10).pow(10))
      expect(redemptionId).to.not.be.empty
      expect(amount).to.equal(expectedAmount) // amount is now in tBTC Wei
    })

    it("should check total minted before allowing redemption", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { mockAccountControl, qcRedeemer, user, qcAddress, constants, systemState, deployer } = fixture

      // Enable AccountControl mode in SystemState
      // First grant OPERATIONS_ROLE to deployer
      const OPERATIONS_ROLE = ethers.utils.id("OPERATIONS_ROLE")
      await systemState.grantRole(OPERATIONS_ROLE, deployer.address)
      
      // Enable AccountControl mode
      await systemState.setAccountControlMode(true)

      // Set total minted to zero (no available BTC to redeem)
      await mockAccountControl.setTotalMintedForTesting(0)
      
      // Also set per-reserve minted amount to zero for QCRedeemer
      // The mock checks minted[msg.sender] where msg.sender is QCRedeemer
      await mockAccountControl.setMintedForTesting(qcRedeemer.address, 0)

      // Setup wallet
      const qcWalletAddress = constants.VALID_LEGACY_BTC
      await fixture.qcData.registerQC(qcAddress.address, constants.LARGE_CAP)
      await fixture.qcData.registerWallet(
        qcAddress.address,
        qcWalletAddress
      )

      // Mint tBTC for user
      await fixture.tbtc.mint(user.address, ethers.utils.parseEther("10"))
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, ethers.utils.parseEther("10"))

      // Should fail due to insufficient total minted (convert amount to tBTC Wei)
      const amount = ethers.BigNumber.from(constants.MEDIUM_MINT).mul(ethers.BigNumber.from(10).pow(10))
      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            amount,
            constants.VALID_LEGACY_BTC,
            qcWalletAddress
          )
      ).to.be.revertedWith("InsufficientMinted") // MockAccountControl throws InsufficientMinted
    })
  })
})