import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  QCRedeemer,
  ProtocolRegistry,
  QCData,
  SystemState,
  TBTC,
  IRedemptionPolicy,
} from "../../typechain"
import { createMockSpvData } from "./AccountControlTestHelpers"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCRedeemer", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let user: SignerWithAddress
  let qcAddress: SignerWithAddress
  let watchdog: SignerWithAddress
  let thirdParty: SignerWithAddress

  let qcRedeemer: QCRedeemer
  let protocolRegistry: ProtocolRegistry
  let mockRedemptionPolicy: FakeContract<IRedemptionPolicy>
  let mockTbtc: FakeContract<TBTC>

  // Service keys
  let REDEMPTION_POLICY_KEY: string
  let TBTC_TOKEN_KEY: string

  // Roles
  let REDEEMER_ROLE: string
  let ARBITER_ROLE: string

  before(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;[deployer, governance, user, qcAddress, watchdog, thirdParty] =
      await ethers.getSigners()

    // Generate service keys
    REDEMPTION_POLICY_KEY = ethers.utils.id("REDEMPTION_POLICY")
    TBTC_TOKEN_KEY = ethers.utils.id("TBTC_TOKEN")

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

    // Deploy QCRedeemer
    const QCRedeemerFactory = await ethers.getContractFactory("QCRedeemer")
    qcRedeemer = await QCRedeemerFactory.deploy(protocolRegistry.address)
    await qcRedeemer.deployed()

    // Create mock contracts
    mockRedemptionPolicy = await smock.fake<IRedemptionPolicy>(
      "IRedemptionPolicy"
    )
    mockTbtc = await smock.fake<TBTC>("TBTC")

    // Register services
    await protocolRegistry.setService(
      REDEMPTION_POLICY_KEY,
      mockRedemptionPolicy.address
    )
    await protocolRegistry.setService(TBTC_TOKEN_KEY, mockTbtc.address)

    // Set up default mock behaviors
    mockRedemptionPolicy.validateRedemptionRequest.returns(true)
    mockRedemptionPolicy.requestRedemption.returns(true)
    mockRedemptionPolicy.recordFulfillment.returns(true)
    mockRedemptionPolicy.flagDefault.returns(true)
    mockRedemptionPolicy.getRedemptionTimeout.returns(86400) // 24 hours

    // Grant roles
    await qcRedeemer.grantRole(ARBITER_ROLE, watchdog.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment", () => {
    it("should set correct protocol registry", async () => {
      expect(await qcRedeemer.protocolRegistry()).to.equal(
        protocolRegistry.address
      )
    })

    it("should grant deployer admin and redeemer roles", async () => {
      const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
      expect(await qcRedeemer.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to
        .be.true
      expect(await qcRedeemer.hasRole(REDEEMER_ROLE, deployer.address)).to.be
        .true
      expect(await qcRedeemer.hasRole(ARBITER_ROLE, deployer.address)).to.be
        .true
    })
  })

  describe("Role Constants", () => {
    it("should have correct role constants", async () => {
      expect(await qcRedeemer.REDEEMER_ROLE()).to.equal(REDEEMER_ROLE)
      expect(await qcRedeemer.ARBITER_ROLE()).to.equal(ARBITER_ROLE)
      expect(await qcRedeemer.REDEMPTION_POLICY_KEY()).to.equal(
        REDEMPTION_POLICY_KEY
      )
      expect(await qcRedeemer.TBTC_TOKEN_KEY()).to.equal(TBTC_TOKEN_KEY)
    })
  })

  describe("initiateRedemption", () => {
    const redemptionAmount = ethers.utils.parseEther("5")

    context("when called with invalid parameters", () => {
      it("should revert with zero QC address", async () => {
        await expect(
          qcRedeemer
            .connect(user)
            .initiateRedemption(ethers.constants.AddressZero, redemptionAmount)
        ).to.be.revertedWith("Invalid QC address")
      })

      it("should revert with zero amount", async () => {
        await expect(
          qcRedeemer.connect(user).initiateRedemption(qcAddress.address, 0)
        ).to.be.revertedWith("Amount must be greater than zero")
      })
    })

    context("when policy validation fails", () => {
      beforeEach(async () => {
        mockRedemptionPolicy.requestRedemption.returns(false)
      })

      it("should revert", async () => {
        await expect(
          qcRedeemer
            .connect(user)
            .initiateRedemption(qcAddress.address, redemptionAmount)
        ).to.be.revertedWith("Redemption request failed")
      })
    })

    context("when all validations pass", () => {
      let tx: any
      let redemptionId: string

      beforeEach(async () => {
        tx = await qcRedeemer
          .connect(user)
          .initiateRedemption(qcAddress.address, redemptionAmount)
        const receipt = await tx.wait()
        const event = receipt.events?.find(
          (e: any) => e.event === "RedemptionRequested"
        )
        redemptionId = event?.args?.redemptionId
      })

      it("should call policy requestRedemption", async () => {
        expect(mockRedemptionPolicy.requestRedemption).to.have.been.calledWith(
          redemptionId,
          qcAddress.address,
          user.address,
          redemptionAmount,
          "placeholder_btc_address"
        )
      })

      it("should burn user tokens", async () => {
        expect(mockTbtc.burnFrom).to.have.been.calledWith(
          user.address,
          redemptionAmount
        )
      })

      it("should create redemption record", async () => {
        const redemption = await qcRedeemer.getRedemption(redemptionId)
        expect(redemption.user).to.equal(user.address)
        expect(redemption.qc).to.equal(qcAddress.address)
        expect(redemption.amount).to.equal(redemptionAmount)
        expect(redemption.status).to.equal(1) // Pending
      })

      it("should emit RedemptionRequested event", async () => {
        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
        await expect(tx)
          .to.emit(qcRedeemer, "RedemptionRequested")
          .withArgs(
            redemptionId,
            user.address,
            qcAddress.address,
            redemptionAmount,
            user.address,
            currentBlock.timestamp
          )
      })

      it("should return unique redemption ID", async () => {
        const tx2 = await qcRedeemer
          .connect(user)
          .initiateRedemption(qcAddress.address, redemptionAmount)
        const receipt2 = await tx2.wait()
        const event2 = receipt2.events?.find(
          (e: any) => e.event === "RedemptionRequested"
        )
        const redemptionId2 = event2?.args?.redemptionId

        expect(redemptionId).to.not.equal(redemptionId2)
      })
    })
  })

  describe("recordRedemptionFulfillment", () => {
    let redemptionId: string
    const spvProof = ethers.utils.toUtf8Bytes("mock_spv_proof")

    beforeEach(async () => {
      // Create a redemption first
      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(qcAddress.address, ethers.utils.parseEther("5"))
      const receipt = await tx.wait()
      const event = receipt.events?.find(
        (e: any) => e.event === "RedemptionRequested"
      )
      redemptionId = event?.args?.redemptionId
    })

    context("when called by non-arbiter", () => {
      it("should revert", async () => {
        const mockSpvData = createMockSpvData()
        await expect(
          qcRedeemer
            .connect(thirdParty)
            .recordRedemptionFulfillment(
              redemptionId,
              "bc1qtest123456789",
              100000,
              mockSpvData.txInfo,
              mockSpvData.proof
            )
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${ARBITER_ROLE}`
        )
      })
    })

    context("when redemption is not pending", () => {
      beforeEach(async () => {
        // Fulfill the redemption first
        const mockSpvData = createMockSpvData()
        await qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillment(
            redemptionId,
            "bc1qtest123456789",
            100000,
            mockSpvData.txInfo,
            mockSpvData.proof
          )
      })

      it("should revert", async () => {
        const defaultReason = ethers.utils.id("TIMEOUT")
        await expect(
          qcRedeemer
            .connect(watchdog)
            .flagDefaultedRedemption(redemptionId, defaultReason)
        ).to.be.revertedWith("Redemption not pending")
      })
    })

    context("when policy recordFulfillment fails", () => {
      beforeEach(async () => {
        mockRedemptionPolicy.recordFulfillment.returns(false)
      })

      it("should revert", async () => {
        const mockSpvData = createMockSpvData()
        await expect(
          qcRedeemer
            .connect(watchdog)
            .recordRedemptionFulfillment(
              redemptionId,
              "bc1qtest123456789",
              100000,
              mockSpvData.txInfo,
              mockSpvData.proof
            )
        ).to.be.revertedWith("Fulfillment verification failed")
      })
    })

    context("when called by arbiter with valid redemption", () => {
      let tx: any

      beforeEach(async () => {
        const mockSpvData = createMockSpvData()
        tx = await qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillment(
            redemptionId,
            "bc1qtest123456789",
            100000,
            mockSpvData.txInfo,
            mockSpvData.proof
          )
      })

      it("should call policy recordFulfillment", async () => {
        expect(mockRedemptionPolicy.recordFulfillment).to.have.been.calledOnce
      })

      it("should update redemption status to Fulfilled", async () => {
        const redemption = await qcRedeemer.getRedemption(redemptionId)
        expect(redemption.status).to.equal(2) // Fulfilled
      })

      it("should emit RedemptionFulfilled event", async () => {
        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
        await expect(tx)
          .to.emit(qcRedeemer, "RedemptionFulfilled")
          .withArgs(
            redemptionId,
            user.address,
            qcAddress.address,
            redemptionAmount,
            arbiter.address,
            currentBlock.timestamp
          )
      })
    })
  })

  describe("flagDefaultedRedemption", () => {
    let redemptionId: string
    const defaultReason = ethers.utils.id("TIMEOUT")

    beforeEach(async () => {
      // Create a redemption first
      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(qcAddress.address, ethers.utils.parseEther("5"))
      const receipt = await tx.wait()
      const event = receipt.events?.find(
        (e: any) => e.event === "RedemptionRequested"
      )
      redemptionId = event?.args?.redemptionId
    })

    context("when called by non-arbiter", () => {
      it("should revert", async () => {
        await expect(
          qcRedeemer
            .connect(thirdParty)
            .flagDefaultedRedemption(redemptionId, defaultReason)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${ARBITER_ROLE}`
        )
      })
    })

    context("when redemption is not pending", () => {
      beforeEach(async () => {
        // Fulfill the redemption first
        const mockSpvData = createMockSpvData()
        await qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillment(
            redemptionId,
            "bc1qtest123456789",
            100000,
            mockSpvData.txInfo,
            mockSpvData.proof
          )
      })

      it("should revert", async () => {
        const defaultReason = ethers.utils.id("TIMEOUT")
        await expect(
          qcRedeemer
            .connect(watchdog)
            .flagDefaultedRedemption(redemptionId, defaultReason)
        ).to.be.revertedWith("Redemption not pending")
      })
    })

    context("when policy flagDefault fails", () => {
      beforeEach(async () => {
        mockRedemptionPolicy.flagDefault.returns(false)
      })

      it("should revert", async () => {
        await expect(
          qcRedeemer
            .connect(watchdog)
            .flagDefaultedRedemption(redemptionId, defaultReason)
        ).to.be.revertedWith("Default flagging failed")
      })
    })

    context("when called by arbiter with valid redemption", () => {
      let tx: any

      beforeEach(async () => {
        tx = await qcRedeemer
          .connect(watchdog)
          .flagDefaultedRedemption(redemptionId, defaultReason)
      })

      it("should call policy flagDefault", async () => {
        expect(mockRedemptionPolicy.flagDefault).to.have.been.calledWith(
          redemptionId,
          defaultReason
        )
      })

      it("should update redemption status to Defaulted", async () => {
        const redemption = await qcRedeemer.getRedemption(redemptionId)
        expect(redemption.status).to.equal(3) // Defaulted
      })

      it("should emit RedemptionDefaulted event", async () => {
        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
        await expect(tx)
          .to.emit(qcRedeemer, "RedemptionDefaulted")
          .withArgs(
            redemptionId,
            user.address,
            qcAddress.address,
            ethers.utils.parseEther("5"),
            defaultReason,
            watchdog.address,
            currentBlock.timestamp
          )
      })
    })
  })

  describe("isRedemptionTimedOut", () => {
    let redemptionId: string

    beforeEach(async () => {
      // Create a redemption first
      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(qcAddress.address, ethers.utils.parseEther("5"))
      const receipt = await tx.wait()
      const event = receipt.events?.find(
        (e: any) => e.event === "RedemptionRequested"
      )
      redemptionId = event?.args?.redemptionId
    })

    context("when redemption is not pending", () => {
      beforeEach(async () => {
        // Fulfill the redemption first
        const mockSpvData = createMockSpvData()
        await qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillment(
            redemptionId,
            "bc1qtest123456789",
            100000,
            mockSpvData.txInfo,
            mockSpvData.proof
          )
      })

      it("should return false", async () => {
        expect(await qcRedeemer.isRedemptionTimedOut(redemptionId)).to.be.false
      })
    })

    context("when redemption is pending but not timed out", () => {
      it("should return false", async () => {
        expect(await qcRedeemer.isRedemptionTimedOut(redemptionId)).to.be.false
      })
    })

    context("when redemption is pending and timed out", () => {
      beforeEach(async () => {
        // Fast forward time beyond timeout
        await helpers.time.increaseTime(86401) // 24 hours + 1 second
      })

      it("should return true", async () => {
        expect(await qcRedeemer.isRedemptionTimedOut(redemptionId)).to.be.true
      })
    })
  })

  describe("getRedemption", () => {
    it("should return correct redemption data", async () => {
      const redemptionAmount = ethers.utils.parseEther("5")
      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(qcAddress.address, redemptionAmount)
      const receipt = await tx.wait()
      const event = receipt.events?.find(
        (e: any) => e.event === "RedemptionRequested"
      )
      const redemptionId = event?.args?.redemptionId

      const redemption = await qcRedeemer.getRedemption(redemptionId)
      expect(redemption.user).to.equal(user.address)
      expect(redemption.qc).to.equal(qcAddress.address)
      expect(redemption.amount).to.equal(redemptionAmount)
      expect(redemption.status).to.equal(1) // Pending
      expect(redemption.requestedAt).to.be.gt(0)
    })

    it("should return empty data for non-existent redemption", async () => {
      const nonExistentId = ethers.utils.id("non_existent")
      const redemption = await qcRedeemer.getRedemption(nonExistentId)
      expect(redemption.user).to.equal(ethers.constants.AddressZero)
      expect(redemption.qc).to.equal(ethers.constants.AddressZero)
      expect(redemption.amount).to.equal(0)
      expect(redemption.status).to.equal(0) // NeverInitiated
    })
  })

  describe("updateRedemptionPolicy", () => {
    it("should emit RedemptionPolicyUpdated event when called by admin", async () => {
      const tx = await qcRedeemer.updateRedemptionPolicy()
      const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
      await expect(tx)
        .to.emit(qcRedeemer, "RedemptionPolicyUpdated")
        .withArgs(
          mockRedemptionPolicy.address,
          mockRedemptionPolicy.address,
          deployer.address,
          currentBlock.timestamp
        )
    })

    it("should revert when called by non-admin", async () => {
      const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
      await expect(
        qcRedeemer.connect(user).updateRedemptionPolicy()
      ).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
      )
    })
  })

  describe("Access Control", () => {
    context("ARBITER_ROLE functions", () => {
      let redemptionId: string
      const spvProof = ethers.utils.toUtf8Bytes("mock_spv_proof")
      const defaultReason = ethers.utils.id("TIMEOUT")

      beforeEach(async () => {
        // Create a redemption first
        const tx = await qcRedeemer
          .connect(user)
          .initiateRedemption(qcAddress.address, ethers.utils.parseEther("5"))
        const receipt = await tx.wait()
        const event = receipt.events?.find(
          (e: any) => e.event === "RedemptionRequested"
        )
        redemptionId = event?.args?.redemptionId
      })

      it("should allow arbiter to record fulfillment", async () => {
        const mockSpvData = createMockSpvData()
        await expect(
          qcRedeemer
            .connect(watchdog)
            .recordRedemptionFulfillment(
              redemptionId,
              "bc1qtest123456789",
              100000,
              mockSpvData.txInfo,
              mockSpvData.proof
            )
        ).to.not.be.reverted
      })

      it("should allow arbiter to flag default", async () => {
        await expect(
          qcRedeemer
            .connect(watchdog)
            .flagDefaultedRedemption(redemptionId, defaultReason)
        ).to.not.be.reverted
      })

      it("should prevent non-arbiter from recording fulfillment", async () => {
        const mockSpvData = createMockSpvData()
        await expect(
          qcRedeemer
            .connect(thirdParty)
            .recordRedemptionFulfillment(
              redemptionId,
              "bc1qtest123456789",
              100000,
              mockSpvData.txInfo,
              mockSpvData.proof
            )
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${ARBITER_ROLE}`
        )
      })

      it("should prevent non-arbiter from flagging default", async () => {
        await expect(
          qcRedeemer
            .connect(thirdParty)
            .flagDefaultedRedemption(redemptionId, defaultReason)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${ARBITER_ROLE}`
        )
      })
    })
  })

  describe("Edge Cases", () => {
    context("when ProtocolRegistry service is not set", () => {
      it("should revert when trying to initiate redemption", async () => {
        // Deploy a new protocol registry without services
        const EmptyRegistryFactory = await ethers.getContractFactory(
          "ProtocolRegistry"
        )
        const emptyRegistry = await EmptyRegistryFactory.deploy()
        await emptyRegistry.deployed()

        const QCRedeemerFactory = await ethers.getContractFactory("QCRedeemer")
        const redeemerWithEmptyRegistry = await QCRedeemerFactory.deploy(
          emptyRegistry.address
        )
        await redeemerWithEmptyRegistry.deployed()

        await expect(
          redeemerWithEmptyRegistry
            .connect(user)
            .initiateRedemption(qcAddress.address, ethers.utils.parseEther("5"))
        ).to.be.reverted
      })
    })

    context("when policy contracts change behavior", () => {
      let redemptionId: string

      beforeEach(async () => {
        // Create a redemption first
        const tx = await qcRedeemer
          .connect(user)
          .initiateRedemption(qcAddress.address, ethers.utils.parseEther("5"))
        const receipt = await tx.wait()
        const event = receipt.events?.find(
          (e: any) => e.event === "RedemptionRequested"
        )
        redemptionId = event?.args?.redemptionId
      })

      it("should handle policy validation changes", async () => {
        mockRedemptionPolicy.recordFulfillment.returns(false)

        const spvProof = ethers.utils.toUtf8Bytes("mock_spv_proof")
        const mockSpvData = createMockSpvData()
        await expect(
          qcRedeemer
            .connect(watchdog)
            .recordRedemptionFulfillment(
              redemptionId,
              "bc1qtest123456789",
              100000,
              mockSpvData.txInfo,
              mockSpvData.proof
            )
        ).to.be.revertedWith("Fulfillment verification failed")
      })
    })
  })
})
