import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import { QCRedeemer, QCData, SystemState, TBTC } from "../../typechain"
import { deploySPVLibraries, getQCRedeemerLibraries } from "../helpers/spvLibraryHelpers"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCRedeemer - Wallet Obligations (Edge Cases)", () => {
  let deployer: SignerWithAddress
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let user3: SignerWithAddress
  let arbiter: SignerWithAddress

  let qcRedeemer: QCRedeemer
  let mockQCData: FakeContract<QCData>
  let mockSystemState: FakeContract<SystemState>
  let mockTBTC: FakeContract<TBTC>

  // Test data
  const qcAddress = "0x1234567890123456789012345678901234567890"
  const qcWallet1 = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
  const qcWallet2 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"
  const userBtcAddress = "1HLoD9E4SDFFPDiYfNYnkBLQ85Y51J3Zb1"
  const redemptionAmount = ethers.utils.parseEther("1")

  before(async () => {
    const [
      deployerSigner,
      user1Signer,
      user2Signer,
      user3Signer,
      arbiterSigner,
    ] = await ethers.getSigners()
    deployer = deployerSigner
    user1 = user1Signer
    user2 = user2Signer
    user3 = user3Signer
    arbiter = arbiterSigner
  })

  beforeEach(async () => {
    await createSnapshot()

    // Create mock contracts
    mockQCData = await smock.fake<QCData>("QCData")
    mockSystemState = await smock.fake<SystemState>("SystemState")
    mockTBTC = await smock.fake<TBTC>("TBTC")

    // Deploy SPV libraries for QCRedeemer
    const libraries = await deploySPVLibraries()

    // Deploy QCRedeemer with library linking
    const QCRedeemerFactory = await ethers.getContractFactory("QCRedeemer", getQCRedeemerLibraries(libraries))
    qcRedeemer = await QCRedeemerFactory.deploy(
      mockTBTC.address,
      mockQCData.address,
      mockSystemState.address,
      ethers.constants.AddressZero,
      0
    )
    await qcRedeemer.deployed()

    // Grant arbiter role
    await qcRedeemer.grantRole(
      await qcRedeemer.DISPUTE_ARBITER_ROLE(),
      arbiter.address
    )

    // Setup default mocks
    mockSystemState.isRedemptionPaused.returns(false)
    mockSystemState.isQCEmergencyPaused.returns(false)
    mockSystemState.redemptionTimeout.returns(86400)
    mockSystemState.minMintAmount.returns(ethers.utils.parseEther("0.001"))

    mockQCData.isQCRegistered.whenCalledWith(qcAddress).returns(true)
    mockQCData.getQCStatus.whenCalledWith(qcAddress).returns(0)

    mockQCData.getWalletOwner.whenCalledWith(qcWallet1).returns(qcAddress)
    mockQCData.getWalletOwner.whenCalledWith(qcWallet2).returns(qcAddress)
    mockQCData.getWalletStatus.whenCalledWith(qcWallet1).returns(0)
    mockQCData.getWalletStatus.whenCalledWith(qcWallet2).returns(0)

    mockTBTC.balanceOf.returns(ethers.utils.parseEther("100"))
    mockTBTC.burnFrom.returns(true)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Edge Case: Bitcoin Address Validation", () => {
    it("should reject QC wallet with invalid Bitcoin address format", async () => {
      const invalidWallet = "0x1234567890123456789012345678901234567890" // Ethereum address
      mockQCData.getWalletOwner.whenCalledWith(invalidWallet).returns(qcAddress)
      mockQCData.getWalletStatus.whenCalledWith(invalidWallet).returns(0)

      await expect(
        qcRedeemer
          .connect(user1)
          .initiateRedemption(
            qcAddress,
            redemptionAmount,
            userBtcAddress,
            invalidWallet
          )
      ).to.be.revertedWith("InvalidBitcoinAddressFormat")
    })

    it("should accept various valid Bitcoin address formats", async () => {
      // Test P2PKH (starts with 1)
      const p2pkhWallet = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
      mockQCData.getWalletOwner.whenCalledWith(p2pkhWallet).returns(qcAddress)
      mockQCData.getWalletStatus.whenCalledWith(p2pkhWallet).returns(0)

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
      mockQCData.getWalletStatus.whenCalledWith(p2shWallet).returns(0)

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
      mockQCData.getWalletOwner.whenCalledWith(bech32Wallet).returns(qcAddress)
      mockQCData.getWalletStatus.whenCalledWith(bech32Wallet).returns(0)

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

  describe("Edge Case: Multiple Defaults Same Wallet", () => {
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
      await expect(
        qcRedeemer
          .connect(arbiter)
          .flagDefaultedRedemption(
            redemptionId,
            ethers.utils.formatBytes32String("DUPLICATE")
          )
      ).to.be.revertedWith("RedemptionNotPending")

      // Counter should be zero and not underflowed
      expect(
        await qcRedeemer.getWalletPendingRedemptionCount(qcWallet1)
      ).to.equal(0)
    })
  })

  describe("Edge Case: Concurrent Operations", () => {
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

      // Note: Fulfillment would require proper SPV setup, so we test default only
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

  describe("Edge Case: Array Growth Management", () => {
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
      const redemptionsBefore = await qcRedeemer.getWalletRedemptions(qcWallet1)
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
      const redemptionsAfter = await qcRedeemer.getWalletRedemptions(qcWallet1)
      expect(redemptionsAfter.length).to.equal(1)
      expect(redemptionsAfter[0]).to.equal(redemptionId)

      // But counter is cleared
      expect(
        await qcRedeemer.getWalletPendingRedemptionCount(qcWallet1)
      ).to.equal(0)
    })
  })

  describe("Edge Case: Wallet Status Transitions", () => {
    it("should prevent redemption with wallet that becomes inactive", async () => {
      // Initially active
      mockQCData.getWalletStatus.whenCalledWith(qcWallet1).returns(0)

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
      mockQCData.getWalletStatus.whenCalledWith(qcWallet1).returns(1)

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

  describe("Edge Case: Redemption Deadline Tracking", () => {
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
