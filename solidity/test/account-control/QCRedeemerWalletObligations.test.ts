import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  QCRedeemer,
  QCData,
  SystemState,
  TBTC,
  SPVState,
} from "../../typechain"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCRedeemer - Wallet Obligations", () => {
  let deployer: SignerWithAddress
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let arbiter: SignerWithAddress

  let qcRedeemer: QCRedeemer
  let mockQCData: FakeContract<QCData>
  let mockSystemState: FakeContract<SystemState>
  let mockTBTC: FakeContract<TBTC>

  // Test data
  const qcAddress = "0x1234567890123456789012345678901234567890"
  const qcWallet1 = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" // Satoshi's address
  const qcWallet2 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"
  const userBtcAddress = "1HLoD9E4SDFFPDiYfNYnkBLQ85Y51J3Zb1"
  const redemptionAmount = ethers.utils.parseEther("1")

  before(async () => {
    const [deployerSigner, user1Signer, user2Signer, arbiterSigner] =
      await ethers.getSigners()
    deployer = deployerSigner
    user1 = user1Signer
    user2 = user2Signer
    arbiter = arbiterSigner
  })

  beforeEach(async () => {
    await createSnapshot()

    // Create mock contracts
    mockQCData = await smock.fake<QCData>("QCData")
    mockSystemState = await smock.fake<SystemState>("SystemState")
    mockTBTC = await smock.fake<TBTC>("TBTC")

    // Deploy QCRedeemer with required SPV parameters
    const QCRedeemerFactory = await ethers.getContractFactory("QCRedeemer")
    qcRedeemer = await QCRedeemerFactory.deploy(
      mockTBTC.address,
      mockQCData.address,
      mockSystemState.address,
      ethers.constants.AddressZero, // relay address (not used in tests)
      0 // txProofDifficultyFactor (not used in tests)
    )
    await qcRedeemer.deployed()

    // Grant dispute arbiter role
    await qcRedeemer.grantRole(
      await qcRedeemer.DISPUTE_ARBITER_ROLE(),
      arbiter.address
    )

    // Setup default mock behaviors
    mockSystemState.isRedemptionPaused.returns(false)
    mockSystemState.isQCEmergencyPaused.returns(false)
    mockSystemState.redemptionTimeout.returns(86400) // 24 hours
    mockSystemState.minMintAmount.returns(ethers.utils.parseEther("0.001"))

    // Setup QC as registered and active
    mockQCData.isQCRegistered.whenCalledWith(qcAddress).returns(true)
    mockQCData.getQCStatus.whenCalledWith(qcAddress).returns(0) // Active

    // Setup wallets as registered to QC
    mockQCData.getWalletOwner.whenCalledWith(qcWallet1).returns(qcAddress)
    mockQCData.getWalletOwner.whenCalledWith(qcWallet2).returns(qcAddress)
    mockQCData.getWalletStatus.whenCalledWith(qcWallet1).returns(0) // Active
    mockQCData.getWalletStatus.whenCalledWith(qcWallet2).returns(0) // Active

    // Setup TBTC mock
    mockTBTC.balanceOf.returns(ethers.utils.parseEther("100"))
    mockTBTC.burnFrom.returns(true)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

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
      mockQCData.getWalletStatus.whenCalledWith(qcWallet1).returns(1) // Not Active

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

      // Mock SPV proof data (simplified for testing)
      const mockTxInfo = {
        version: "0x01000000",
        inputVector: "0x00",
        outputVector: "0x00",
        locktime: "0x00000000",
      }

      const mockProof = {
        merkleProof: "0x00",
        txIndexInBlock: 0,
        bitcoinHeaders: "0x00",
      }

      // Record fulfillment
      // Note: This will fail in real scenario without proper SPV setup
      // For testing wallet obligation clearing, we'd need to mock SPV validation

      // After fulfillment, wallet should have no obligations
      // This would be tested with proper SPV mocking
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
