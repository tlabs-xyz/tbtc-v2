import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  BasicRedemptionPolicy,
  ProtocolRegistry,
  QCData,
  SystemState,
  TBTC,
  SPVValidator,
} from "../../typechain"
import { createMockSpvData } from "./AccountControlTestHelpers"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("BasicRedemptionPolicy", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let user: SignerWithAddress
  let qcAddress: SignerWithAddress
  let thirdParty: SignerWithAddress

  let basicRedemptionPolicy: BasicRedemptionPolicy
  let protocolRegistry: ProtocolRegistry
  let mockQcData: FakeContract<QCData>
  let mockSystemState: FakeContract<SystemState>
  let mockTbtc: FakeContract<TBTC>
  let mockSpvValidator: FakeContract<SPVValidator>

  // Service keys
  let QC_DATA_KEY: string
  let SYSTEM_STATE_KEY: string
  let TBTC_TOKEN_KEY: string
  let SPV_VALIDATOR_KEY: string

  // Roles
  let REDEEMER_ROLE: string
  let ARBITER_ROLE: string

  // Test data
  const redemptionAmount = ethers.utils.parseEther("5")
  const redemptionId = ethers.utils.id("test_redemption_id")
  const spvProof = ethers.utils.toUtf8Bytes("mock_spv_proof")
  const bitcoinAddress = "bc1qtest123456789"

  before(async () => {
    const signers = await ethers.getSigners()
    deployer = signers[0]
    governance = signers[1]
    user = signers[2]
    qcAddress = signers[3]
    thirdParty = signers[4]

    // Generate service keys
    QC_DATA_KEY = ethers.utils.id("QC_DATA")
    SYSTEM_STATE_KEY = ethers.utils.id("SYSTEM_STATE")
    TBTC_TOKEN_KEY = ethers.utils.id("TBTC_TOKEN")
    SPV_VALIDATOR_KEY = ethers.utils.id("SPV_VALIDATOR")

    // Generate role hashes
    REDEEMER_ROLE = ethers.utils.id("REDEEMER_ROLE")
    ARBITER_ROLE = ethers.utils.id("ARBITER_ROLE")
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy ProtocolRegistry
    const ProtocolRegistryFactory = await ethers.getContractFactory(
      "ProtocolRegistry"
    )
    protocolRegistry = await ProtocolRegistryFactory.deploy()
    await protocolRegistry.deployed()

    // Deploy BasicRedemptionPolicy
    const BasicRedemptionPolicyFactory = await ethers.getContractFactory(
      "BasicRedemptionPolicy"
    )
    basicRedemptionPolicy = await BasicRedemptionPolicyFactory.deploy(
      protocolRegistry.address
    )
    await basicRedemptionPolicy.deployed()

    // Create mock contracts
    mockQcData = await smock.fake<QCData>("QCData")
    mockSystemState = await smock.fake<SystemState>("SystemState")
    mockTbtc = await smock.fake<TBTC>("TBTC")
    mockSpvValidator = await smock.fake<SPVValidator>("SPVValidator")

    // Register services
    await protocolRegistry.setService(QC_DATA_KEY, mockQcData.address)
    await protocolRegistry.setService(SYSTEM_STATE_KEY, mockSystemState.address)
    await protocolRegistry.setService(TBTC_TOKEN_KEY, mockTbtc.address)
    await protocolRegistry.setService(
      SPV_VALIDATOR_KEY,
      mockSpvValidator.address
    )

    // Set up default mock behaviors
    mockSystemState.isRedemptionPaused.returns(false)
    mockSystemState.redemptionTimeout.returns(604800) // 7 days
    mockQcData.getQCStatus.returns(0) // Active
    mockQcData.isQCRegistered.returns(true)
    mockSystemState.minMintAmount.returns(ethers.utils.parseEther("0.01"))
    mockTbtc.balanceOf.returns(redemptionAmount)
    mockSpvValidator.verifyRedemptionFulfillment.returns(true)

    // Grant roles to deployer for testing
    await basicRedemptionPolicy.grantRole(REDEEMER_ROLE, deployer.address)
    await basicRedemptionPolicy.grantRole(ARBITER_ROLE, deployer.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment", () => {
    it("should set correct protocol registry", async () => {
      expect(await basicRedemptionPolicy.protocolRegistry()).to.equal(
        protocolRegistry.address
      )
    })

    it("should grant deployer admin role", async () => {
      const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
      expect(
        await basicRedemptionPolicy.hasRole(
          DEFAULT_ADMIN_ROLE,
          deployer.address
        )
      ).to.be.true
    })

    it("should have correct service key constants", async () => {
      expect(await basicRedemptionPolicy.QC_DATA_KEY()).to.equal(QC_DATA_KEY)
      expect(await basicRedemptionPolicy.SYSTEM_STATE_KEY()).to.equal(
        SYSTEM_STATE_KEY
      )
      expect(await basicRedemptionPolicy.TBTC_TOKEN_KEY()).to.equal(
        TBTC_TOKEN_KEY
      )
    })
  })

  describe("requestRedemption", () => {
    context("when called without REDEEMER_ROLE", () => {
      it("should revert", async () => {
        await expect(
          basicRedemptionPolicy
            .connect(user)
            .requestRedemption(
              redemptionId,
              qcAddress.address,
              user.address,
              redemptionAmount,
              bitcoinAddress
            )
        ).to.be.revertedWith(
          `AccessControl: account ${user.address.toLowerCase()} is missing role ${REDEEMER_ROLE}`
        )
      })
    })

    context("when called with valid parameters", () => {
      let tx: any

      beforeEach(async () => {
        tx = await basicRedemptionPolicy.requestRedemption(
          redemptionId,
          qcAddress.address,
          user.address,
          redemptionAmount,
          bitcoinAddress
        )
      })

      it("should not burn tBTC tokens (handled by calling contract)", async () => {
        // The BasicRedemptionPolicy no longer burns tokens directly
        // Token burning is handled by the calling contract (QCRedeemer) to prevent double-burning
        expect(mockTbtc.burnFrom).to.not.have.been.called
        expect(mockTbtc.burn).to.not.have.been.called
      })

      it("should emit RedemptionRequested event", async () => {
        const receipt = await tx.wait()
        const { timestamp } = await ethers.provider.getBlock(
          receipt.blockNumber
        )

        await expect(tx)
          .to.emit(basicRedemptionPolicy, "RedemptionRequested")
          .withArgs(
            redemptionId,
            qcAddress.address,
            user.address,
            redemptionAmount,
            bitcoinAddress,
            deployer.address, // requestedBy (the caller)
            timestamp
          )
      })
    })

    context("when called with invalid parameters", () => {
      it("should revert with empty redemption ID", async () => {
        await expect(
          basicRedemptionPolicy.requestRedemption(
            ethers.constants.HashZero,
            qcAddress.address,
            user.address,
            redemptionAmount,
            bitcoinAddress
          )
        ).to.be.revertedWith("InvalidRedemptionId")
      })

      it("should revert with zero QC address", async () => {
        await expect(
          basicRedemptionPolicy.requestRedemption(
            redemptionId,
            ethers.constants.AddressZero,
            user.address,
            redemptionAmount,
            bitcoinAddress
          )
        ).to.be.revertedWith("ValidationFailed")
      })

      it("should revert with zero user address", async () => {
        await expect(
          basicRedemptionPolicy.requestRedemption(
            redemptionId,
            qcAddress.address,
            ethers.constants.AddressZero,
            redemptionAmount,
            bitcoinAddress
          )
        ).to.be.revertedWith("ValidationFailed")
      })

      it("should revert with zero amount", async () => {
        await expect(
          basicRedemptionPolicy.requestRedemption(
            redemptionId,
            qcAddress.address,
            user.address,
            0,
            bitcoinAddress
          )
        ).to.be.revertedWith("ValidationFailed")
      })

      it("should revert with empty Bitcoin address", async () => {
        await expect(
          basicRedemptionPolicy.requestRedemption(
            redemptionId,
            qcAddress.address,
            user.address,
            redemptionAmount,
            ""
          )
        ).to.be.revertedWith("InvalidBitcoinAddress")
      })
    })

    context("when system checks fail", () => {
      it("should revert when redemption is paused", async () => {
        mockSystemState.isRedemptionPaused.returns(true)

        await expect(
          basicRedemptionPolicy.requestRedemption(
            redemptionId,
            qcAddress.address,
            user.address,
            redemptionAmount,
            bitcoinAddress
          )
        ).to.be.revertedWith("ValidationFailed")
      })

      it("should revert when QC is revoked", async () => {
        mockQcData.getQCStatus.whenCalledWith(qcAddress.address).returns(2) // Revoked

        await expect(
          basicRedemptionPolicy.requestRedemption(
            redemptionId,
            qcAddress.address,
            user.address,
            redemptionAmount,
            bitcoinAddress
          )
        ).to.be.revertedWith("ValidationFailed")
      })

      it("should allow redemption when QC is active", async () => {
        mockQcData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // Active

        await expect(
          basicRedemptionPolicy.requestRedemption(
            redemptionId,
            qcAddress.address,
            user.address,
            redemptionAmount,
            bitcoinAddress
          )
        ).to.not.be.reverted
      })

      it("should allow redemption when QC is under review", async () => {
        mockQcData.getQCStatus.whenCalledWith(qcAddress.address).returns(1) // UnderReview

        await expect(
          basicRedemptionPolicy.requestRedemption(
            redemptionId,
            qcAddress.address,
            user.address,
            redemptionAmount,
            bitcoinAddress
          )
        ).to.not.be.reverted
      })

      it("should revert when user has insufficient balance", async () => {
        // Grant REDEEMER_ROLE to user for this test
        await basicRedemptionPolicy.grantRole(REDEEMER_ROLE, user.address)

        mockTbtc.balanceOf.reset()
        mockTbtc.balanceOf
          .whenCalledWith(user.address)
          .returns(redemptionAmount.sub(1))

        await expect(
          basicRedemptionPolicy
            .connect(user)
            .requestRedemption(
              redemptionId,
              qcAddress.address,
              user.address,
              redemptionAmount,
              bitcoinAddress
            )
        ).to.be.revertedWith("ValidationFailed")
      })
    })

    context("when redemption ID is already used", () => {
      beforeEach(async () => {
        // Request a redemption first to mark the ID as used
        await basicRedemptionPolicy.requestRedemption(
          redemptionId,
          qcAddress.address,
          user.address,
          redemptionAmount,
          bitcoinAddress
        )
      })

      it("should revert with 'Redemption ID already used'", async () => {
        await expect(
          basicRedemptionPolicy.requestRedemption(
            redemptionId, // Same ID
            qcAddress.address,
            user.address,
            redemptionAmount,
            bitcoinAddress
          )
        ).to.be.revertedWith("RedemptionIdAlreadyUsed")
      })
    })
  })

  describe("recordFulfillment", () => {
    context("when called with valid parameters", () => {
      let tx: any

      beforeEach(async () => {
        await basicRedemptionPolicy.requestRedemption(
          redemptionId,
          qcAddress.address,
          user.address,
          redemptionAmount,
          bitcoinAddress
        )

        const mockSpvData = createMockSpvData()
        tx = await basicRedemptionPolicy.recordFulfillment(
          redemptionId,
          bitcoinAddress,
          100000, // expectedAmount in satoshis
          mockSpvData.txInfo,
          mockSpvData.proof
        )
      })

      it("should mark redemption as fulfilled", async () => {
        expect(await basicRedemptionPolicy.isRedemptionFulfilled(redemptionId))
          .to.be.true
      })

      it("should emit RedemptionFulfilledByPolicy event", async () => {
        const receipt = await tx.wait()
        const { timestamp } = await ethers.provider.getBlock(
          receipt.blockNumber
        )

        await expect(tx)
          .to.emit(basicRedemptionPolicy, "RedemptionFulfilledByPolicy")
          .withArgs(redemptionId, deployer.address, timestamp)
      })
    })

    context("when called with invalid parameters", () => {
      beforeEach(async () => {
        await basicRedemptionPolicy.requestRedemption(
          redemptionId,
          qcAddress.address,
          user.address,
          redemptionAmount,
          bitcoinAddress
        )
      })

      it("should revert with empty redemption ID", async () => {
        const mockSpvData = createMockSpvData()
        await expect(
          basicRedemptionPolicy.recordFulfillment(
            ethers.constants.HashZero,
            bitcoinAddress,
            100000,
            mockSpvData.txInfo,
            mockSpvData.proof
          )
        ).to.be.revertedWith("InvalidRedemptionId")
      })

      it("should revert with empty SPV proof", async () => {
        const mockSpvData = createMockSpvData()
        mockSpvData.proof.merkleProof = "0x" // empty proof

        // Configure mock to return false for empty proof
        mockSpvValidator.verifyRedemptionFulfillment.returns(false)

        await expect(
          basicRedemptionPolicy.recordFulfillment(
            redemptionId,
            bitcoinAddress,
            100000,
            mockSpvData.txInfo,
            mockSpvData.proof
          )
        ).to.be.revertedWith("SPVVerificationFailed")
      })
    })

    context("when redemption is already fulfilled", () => {
      beforeEach(async () => {
        await basicRedemptionPolicy.requestRedemption(
          redemptionId,
          qcAddress.address,
          user.address,
          redemptionAmount,
          bitcoinAddress
        )
        const mockSpvData = createMockSpvData()
        await basicRedemptionPolicy.recordFulfillment(
          redemptionId,
          bitcoinAddress,
          100000,
          mockSpvData.txInfo,
          mockSpvData.proof
        )
      })

      it("should revert", async () => {
        const defaultReason =
          ethers.utils.formatBytes32String("Timeout exceeded")
        await expect(
          basicRedemptionPolicy.flagDefault(redemptionId, defaultReason)
        ).to.be.revertedWith("RedemptionAlreadyFulfilled")
      })
    })

    context("when redemption is flagged as default", () => {
      beforeEach(async () => {
        await basicRedemptionPolicy.requestRedemption(
          redemptionId,
          qcAddress.address,
          user.address,
          redemptionAmount,
          bitcoinAddress
        )
        await basicRedemptionPolicy.flagDefault(
          redemptionId,
          ethers.utils.formatBytes32String("Timeout")
        )
      })

      it("should revert", async () => {
        const mockSpvData = createMockSpvData()
        await expect(
          basicRedemptionPolicy.recordFulfillment(
            redemptionId,
            bitcoinAddress,
            100000,
            mockSpvData.txInfo,
            mockSpvData.proof
          )
        ).to.be.revertedWith("RedemptionAlreadyDefaulted")
      })
    })
  })

  describe("flagDefault", () => {
    const defaultReason = ethers.utils.formatBytes32String("Timeout exceeded")

    context("when called with valid parameters", () => {
      let tx: any

      beforeEach(async () => {
        await basicRedemptionPolicy.requestRedemption(
          redemptionId,
          qcAddress.address,
          user.address,
          redemptionAmount,
          bitcoinAddress
        )
        tx = await basicRedemptionPolicy.flagDefault(
          redemptionId,
          defaultReason
        )
      })

      it("should mark redemption as defaulted", async () => {
        const [isDefaulted] = await basicRedemptionPolicy.isRedemptionDefaulted(
          redemptionId
        )
        expect(isDefaulted).to.be.true
      })

      it("should emit RedemptionDefaultedByPolicy event", async () => {
        const receipt = await tx.wait()
        const { timestamp } = await ethers.provider.getBlock(
          receipt.blockNumber
        )

        await expect(tx)
          .to.emit(basicRedemptionPolicy, "RedemptionDefaultedByPolicy")
          .withArgs(redemptionId, defaultReason, deployer.address, timestamp)
      })
    })

    context("when called with invalid parameters", () => {
      beforeEach(async () => {
        await basicRedemptionPolicy.requestRedemption(
          redemptionId,
          qcAddress.address,
          user.address,
          redemptionAmount,
          bitcoinAddress
        )
      })
      it("should revert with empty redemption ID", async () => {
        await expect(
          basicRedemptionPolicy.flagDefault(
            ethers.constants.HashZero,
            defaultReason
          )
        ).to.be.revertedWith("InvalidRedemptionId")
      })

      it("should revert with empty reason", async () => {
        await expect(
          basicRedemptionPolicy.flagDefault(
            redemptionId,
            ethers.constants.HashZero
          )
        ).to.be.revertedWith("InvalidReason")
      })
    })

    context("when redemption is already fulfilled", () => {
      beforeEach(async () => {
        await basicRedemptionPolicy.requestRedemption(
          redemptionId,
          qcAddress.address,
          user.address,
          redemptionAmount,
          bitcoinAddress
        )
        const mockSpvData = createMockSpvData()
        await basicRedemptionPolicy.recordFulfillment(
          redemptionId,
          bitcoinAddress,
          100000,
          mockSpvData.txInfo,
          mockSpvData.proof
        )
      })

      it("should revert", async () => {
        const defaultReason =
          ethers.utils.formatBytes32String("Timeout exceeded")
        await expect(
          basicRedemptionPolicy.flagDefault(redemptionId, defaultReason)
        ).to.be.revertedWith("RedemptionAlreadyFulfilled")
      })
    })

    context("when redemption is already defaulted", () => {
      beforeEach(async () => {
        await basicRedemptionPolicy.requestRedemption(
          redemptionId,
          qcAddress.address,
          user.address,
          redemptionAmount,
          bitcoinAddress
        )
        await basicRedemptionPolicy.flagDefault(redemptionId, defaultReason)
      })

      it("should revert", async () => {
        await expect(
          basicRedemptionPolicy.flagDefault(
            redemptionId,
            ethers.utils.formatBytes32String("Another reason")
          )
        ).to.be.revertedWith("RedemptionAlreadyDefaulted")
      })
    })
  })

  describe("Status Checking Functions", () => {
    beforeEach(async () => {
      await basicRedemptionPolicy.requestRedemption(
        redemptionId,
        qcAddress.address,
        user.address,
        redemptionAmount,
        bitcoinAddress
      )
    })
    describe("isRedemptionFulfilled", () => {
      it("should return false for non-existent redemption", async () => {
        const nonExistentId = ethers.utils.id("non_existent")
        expect(await basicRedemptionPolicy.isRedemptionFulfilled(nonExistentId))
          .to.be.false
      })

      it("should return true for fulfilled redemption", async () => {
        const mockSpvData = createMockSpvData()
        await basicRedemptionPolicy.recordFulfillment(
          redemptionId,
          bitcoinAddress,
          100000,
          mockSpvData.txInfo,
          mockSpvData.proof
        )
        expect(await basicRedemptionPolicy.isRedemptionFulfilled(redemptionId))
          .to.be.true
      })

      it("should return false for defaulted redemption", async () => {
        await basicRedemptionPolicy.flagDefault(
          redemptionId,
          ethers.utils.formatBytes32String("Timeout")
        )
        expect(await basicRedemptionPolicy.isRedemptionFulfilled(redemptionId))
          .to.be.false
      })
    })

    describe("isRedemptionDefaulted", () => {
      it("should return false for non-existent redemption", async () => {
        const nonExistentId = ethers.utils.id("non_existent")
        const [isDefaulted] = await basicRedemptionPolicy.isRedemptionDefaulted(
          nonExistentId
        )
        expect(isDefaulted).to.be.false
      })

      it("should return true for defaulted redemption", async () => {
        await basicRedemptionPolicy.flagDefault(
          redemptionId,
          ethers.utils.formatBytes32String("Timeout")
        )
        const [isDefaulted] = await basicRedemptionPolicy.isRedemptionDefaulted(
          redemptionId
        )
        expect(isDefaulted).to.be.true
      })

      it("should return false for fulfilled redemption", async () => {
        const mockSpvData = createMockSpvData()
        await basicRedemptionPolicy.recordFulfillment(
          redemptionId,
          bitcoinAddress,
          100000,
          mockSpvData.txInfo,
          mockSpvData.proof
        )
        const [isDefaulted] = await basicRedemptionPolicy.isRedemptionDefaulted(
          redemptionId
        )
        expect(isDefaulted).to.be.false
      })
    })

    describe("getRedemptionStatus", () => {
      it("should return PENDING (0) for a newly requested redemption", async () => {
        expect(
          await basicRedemptionPolicy.getRedemptionStatus(redemptionId)
        ).to.equal(0) // PENDING
      })

      it("should return FULFILLED (1) for fulfilled redemption", async () => {
        const mockSpvData = createMockSpvData()
        await basicRedemptionPolicy.recordFulfillment(
          redemptionId,
          bitcoinAddress,
          100000,
          mockSpvData.txInfo,
          mockSpvData.proof
        )
        expect(
          await basicRedemptionPolicy.getRedemptionStatus(redemptionId)
        ).to.equal(1) // FULFILLED
      })

      it("should return DEFAULTED (2) for defaulted redemption", async () => {
        await basicRedemptionPolicy.flagDefault(
          redemptionId,
          ethers.utils.formatBytes32String("Timeout")
        )
        expect(
          await basicRedemptionPolicy.getRedemptionStatus(redemptionId)
        ).to.equal(2) // DEFAULTED
      })
    })
  })

  describe("Access Control", () => {
    context("DEFAULT_ADMIN_ROLE functions", () => {
      it("should allow admin to grant roles", async () => {
        await expect(
          basicRedemptionPolicy.grantRole(ARBITER_ROLE, thirdParty.address)
        ).to.not.be.reverted
      })

      it("should prevent non-admin from granting roles", async () => {
        const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
        await expect(
          basicRedemptionPolicy
            .connect(thirdParty)
            .grantRole(ARBITER_ROLE, user.address)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
        )
      })
    })
  })

  describe("Edge Cases", () => {
    context("when ProtocolRegistry services are not set", () => {
      it("should revert when trying to request redemption", async () => {
        // Deploy a new protocol registry without services
        const EmptyRegistryFactory = await ethers.getContractFactory(
          "ProtocolRegistry"
        )
        const emptyRegistry = await EmptyRegistryFactory.deploy()
        await emptyRegistry.deployed()

        const BasicRedemptionPolicyFactory = await ethers.getContractFactory(
          "BasicRedemptionPolicy"
        )
        const policyWithEmptyRegistry =
          await BasicRedemptionPolicyFactory.deploy(emptyRegistry.address)
        await policyWithEmptyRegistry.deployed()

        await expect(
          policyWithEmptyRegistry.requestRedemption(
            redemptionId,
            qcAddress.address,
            user.address,
            redemptionAmount,
            bitcoinAddress
          )
        ).to.be.reverted
      })
    })

    context("when service contracts change behavior", () => {
      it("should handle SystemState parameter changes", async () => {
        // First call succeeds
        await basicRedemptionPolicy.requestRedemption(
          redemptionId,
          qcAddress.address,
          user.address,
          redemptionAmount,
          bitcoinAddress
        )

        // Change system state to paused
        mockSystemState.isRedemptionPaused.returns(true)

        // Second call should fail
        const newRedemptionId = ethers.utils.id("new_redemption")
        await expect(
          basicRedemptionPolicy.requestRedemption(
            newRedemptionId,
            qcAddress.address,
            user.address,
            redemptionAmount,
            bitcoinAddress
          )
        ).to.be.revertedWith("ValidationFailed")
      })

      it("should handle QCData status changes", async () => {
        // First call succeeds
        await basicRedemptionPolicy.requestRedemption(
          redemptionId,
          qcAddress.address,
          user.address,
          redemptionAmount,
          bitcoinAddress
        )

        // Change QC status to Revoked
        mockQcData.getQCStatus.whenCalledWith(qcAddress.address).returns(2) // Revoked

        // Second call should fail
        const newRedemptionId = ethers.utils.id("new_redemption")
        await expect(
          basicRedemptionPolicy.requestRedemption(
            newRedemptionId,
            qcAddress.address,
            user.address,
            redemptionAmount,
            bitcoinAddress
          )
        ).to.be.revertedWith("ValidationFailed")
      })
    })

    context("boundary conditions", () => {
      it("should handle maximum redemption amount", async () => {
        const maxAmount = ethers.constants.MaxUint256
        mockTbtc.balanceOf.reset()
        mockTbtc.balanceOf.returns(maxAmount)

        await expect(
          basicRedemptionPolicy.requestRedemption(
            redemptionId,
            qcAddress.address,
            user.address,
            maxAmount,
            bitcoinAddress
          )
        ).to.not.be.reverted
      })

      it("should handle minimum redemption amount", async () => {
        const minAmount = ethers.utils.parseEther("0.01")
        mockTbtc.balanceOf.reset()
        mockTbtc.balanceOf.whenCalledWith(user.address).returns(minAmount)
        mockSystemState.minMintAmount.reset()
        mockSystemState.minMintAmount.returns(minAmount)

        await expect(
          basicRedemptionPolicy.requestRedemption(
            redemptionId,
            qcAddress.address,
            user.address,
            minAmount,
            bitcoinAddress
          )
        ).to.not.be.reverted
      })

      it("should handle exact balance match", async () => {
        mockTbtc.balanceOf.reset()
        mockTbtc.balanceOf.returns(redemptionAmount) // Exact match

        await expect(
          basicRedemptionPolicy.requestRedemption(
            redemptionId,
            qcAddress.address,
            user.address,
            redemptionAmount,
            bitcoinAddress
          )
        ).to.not.be.reverted
      })

      it("should fail when balance is 1 wei short", async () => {
        mockTbtc.balanceOf.reset()
        mockTbtc.balanceOf
          .whenCalledWith(user.address)
          .returns(redemptionAmount.sub(1))

        await expect(
          basicRedemptionPolicy.requestRedemption(
            redemptionId,
            qcAddress.address,
            user.address,
            redemptionAmount,
            bitcoinAddress
          )
        ).to.be.revertedWith("ValidationFailed")
      })
    })

    context("multiple redemptions", () => {
      const redemptionId2 = ethers.utils.id("redemption_2")
      const redemptionId3 = ethers.utils.id("redemption_3")

      it("should handle multiple redemptions independently", async () => {
        // Request multiple redemptions
        await basicRedemptionPolicy.requestRedemption(
          redemptionId,
          qcAddress.address,
          user.address,
          redemptionAmount,
          bitcoinAddress
        )

        await basicRedemptionPolicy.requestRedemption(
          redemptionId2,
          qcAddress.address,
          user.address,
          redemptionAmount,
          bitcoinAddress
        )

        await basicRedemptionPolicy.requestRedemption(
          redemptionId3,
          qcAddress.address,
          user.address,
          redemptionAmount,
          bitcoinAddress
        )

        // Fulfill one, default another, leave one pending
        const mockSpvData = createMockSpvData()
        await basicRedemptionPolicy.recordFulfillment(
          redemptionId,
          bitcoinAddress,
          100000,
          mockSpvData.txInfo,
          mockSpvData.proof
        )
        await basicRedemptionPolicy.flagDefault(
          redemptionId2,
          ethers.utils.formatBytes32String("Timeout")
        )

        // Check statuses
        expect(
          await basicRedemptionPolicy.getRedemptionStatus(redemptionId)
        ).to.equal(1) // Fulfilled
        expect(
          await basicRedemptionPolicy.getRedemptionStatus(redemptionId2)
        ).to.equal(2) // Defaulted
        expect(
          await basicRedemptionPolicy.getRedemptionStatus(redemptionId3)
        ).to.equal(0) // Pending
      })
    })
  })

  describe("validateRedemptionRequest", () => {
    context("when all conditions are valid", () => {
      it("should return true for active QC", async () => {
        mockQcData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // Active

        const result = await basicRedemptionPolicy.validateRedemptionRequest(
          user.address,
          qcAddress.address,
          redemptionAmount
        )

        expect(result).to.be.true
      })

      it("should return true for QC under review", async () => {
        mockQcData.getQCStatus.whenCalledWith(qcAddress.address).returns(1) // UnderReview

        const result = await basicRedemptionPolicy.validateRedemptionRequest(
          user.address,
          qcAddress.address,
          redemptionAmount
        )

        expect(result).to.be.true
      })
    })

    context("when QC status is invalid", () => {
      it("should return false for revoked QC", async () => {
        mockQcData.getQCStatus.whenCalledWith(qcAddress.address).returns(2) // Revoked

        const result = await basicRedemptionPolicy.validateRedemptionRequest(
          user.address,
          qcAddress.address,
          redemptionAmount
        )

        expect(result).to.be.false
      })

      // Test that the allowlist approach correctly rejects only known invalid statuses
      it("should correctly implement allowlist logic for QC statuses", async () => {
        // Test that only Active (0) and UnderReview (1) are allowed, Revoked (2) is rejected

        // Active should be allowed
        mockQcData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // Active
        let result = await basicRedemptionPolicy.validateRedemptionRequest(
          user.address,
          qcAddress.address,
          redemptionAmount
        )
        expect(result).to.be.true

        // UnderReview should be allowed
        mockQcData.getQCStatus.whenCalledWith(qcAddress.address).returns(1) // UnderReview
        result = await basicRedemptionPolicy.validateRedemptionRequest(
          user.address,
          qcAddress.address,
          redemptionAmount
        )
        expect(result).to.be.true

        // Revoked should be rejected
        mockQcData.getQCStatus.whenCalledWith(qcAddress.address).returns(2) // Revoked
        result = await basicRedemptionPolicy.validateRedemptionRequest(
          user.address,
          qcAddress.address,
          redemptionAmount
        )
        expect(result).to.be.false
      })
    })

    context("when other conditions are invalid", () => {
      it("should return false for zero user address", async () => {
        const result = await basicRedemptionPolicy.validateRedemptionRequest(
          ethers.constants.AddressZero,
          qcAddress.address,
          redemptionAmount
        )

        expect(result).to.be.false
      })

      it("should return false for zero QC address", async () => {
        const result = await basicRedemptionPolicy.validateRedemptionRequest(
          user.address,
          ethers.constants.AddressZero,
          redemptionAmount
        )

        expect(result).to.be.false
      })

      it("should return false for zero amount", async () => {
        const result = await basicRedemptionPolicy.validateRedemptionRequest(
          user.address,
          qcAddress.address,
          0
        )

        expect(result).to.be.false
      })

      it("should return false when redemption is paused", async () => {
        mockSystemState.isRedemptionPaused.returns(true)

        const result = await basicRedemptionPolicy.validateRedemptionRequest(
          user.address,
          qcAddress.address,
          redemptionAmount
        )

        expect(result).to.be.false
      })

      it("should return false when QC is not registered", async () => {
        mockQcData.isQCRegistered
          .whenCalledWith(qcAddress.address)
          .returns(false)

        const result = await basicRedemptionPolicy.validateRedemptionRequest(
          user.address,
          qcAddress.address,
          redemptionAmount
        )

        expect(result).to.be.false
      })

      it("should return false when user has insufficient balance", async () => {
        mockTbtc.balanceOf
          .whenCalledWith(user.address)
          .returns(redemptionAmount.sub(1))

        const result = await basicRedemptionPolicy.validateRedemptionRequest(
          user.address,
          qcAddress.address,
          redemptionAmount
        )

        expect(result).to.be.false
      })

      it("should return false when amount is below minimum", async () => {
        const minAmount = ethers.utils.parseEther("0.1")
        mockSystemState.minMintAmount.returns(minAmount)

        const result = await basicRedemptionPolicy.validateRedemptionRequest(
          user.address,
          qcAddress.address,
          minAmount.sub(1)
        )

        expect(result).to.be.false
      })
    })
  })

  describe("getRedemptionTimeout", () => {
    it("should return correct timeout from SystemState", async () => {
      const expectedTimeout = 86400 // 24 hours in seconds
      mockSystemState.redemptionTimeout.returns(expectedTimeout)

      const timeout = await basicRedemptionPolicy.getRedemptionTimeout()

      expect(mockSystemState.redemptionTimeout).to.have.been.called
      expect(timeout).to.equal(expectedTimeout)
    })

    it("should handle different timeout values", async () => {
      const timeoutValues = [
        3600,   // 1 hour
        86400,  // 24 hours  
        604800, // 7 days
        2592000 // 30 days
      ]

      for (const expectedTimeout of timeoutValues) {
        mockSystemState.redemptionTimeout.returns(expectedTimeout)
        
        const timeout = await basicRedemptionPolicy.getRedemptionTimeout()
        expect(timeout).to.equal(expectedTimeout)
      }
    })

    it("should handle SystemState unavailability gracefully", async () => {
      // Mock SystemState to revert when called
      mockSystemState.redemptionTimeout.reverts("SystemState unavailable")

      await expect(
        basicRedemptionPolicy.getRedemptionTimeout()
      ).to.be.revertedWith("SystemState unavailable")
    })

    it("should be a view function with minimal gas cost", async () => {
      const expectedTimeout = 86400
      mockSystemState.redemptionTimeout.returns(expectedTimeout)

      const gasEstimate = await basicRedemptionPolicy.estimateGas.getRedemptionTimeout()
      expect(gasEstimate).to.be.lt(50000) // Should be very cheap for view function
    })

    it("should return zero when SystemState returns zero", async () => {
      mockSystemState.redemptionTimeout.returns(0)

      const timeout = await basicRedemptionPolicy.getRedemptionTimeout()
      expect(timeout).to.equal(0)
    })

    it("should handle maximum timeout values", async () => {
      const maxTimeout = ethers.constants.MaxUint256
      mockSystemState.redemptionTimeout.returns(maxTimeout)

      const timeout = await basicRedemptionPolicy.getRedemptionTimeout()
      expect(timeout).to.equal(maxTimeout)
    })
  })

})
