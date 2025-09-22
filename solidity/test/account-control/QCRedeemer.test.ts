import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  QCRedeemer,
  QCData,
  SystemState,
  TBTC,
  TestRelay,
} from "../../typechain"
import {
  createMockSpvData,
  createCompleteSpvTestData,
  fulfillRedemptionForTest,
} from "./AccountControlTestHelpers"

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
  let mockTbtc: FakeContract<TBTC>
  let mockQCData: FakeContract<QCData>
  let mockSystemState: FakeContract<SystemState>
  let testRelay: TestRelay

  // Roles
  let DEFAULT_ADMIN_ROLE: string
  let DISPUTE_ARBITER_ROLE: string

  // Bitcoin addresses for testing
  const validLegacyBtc = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"

  before(async () => {
    const [
      deployerSigner,
      governanceSigner,
      userSigner,
      qcAddressSigner,
      watchdogSigner,
      thirdPartySigner,
    ] = await ethers.getSigners()
    deployer = deployerSigner
    governance = governanceSigner
    user = userSigner
    qcAddress = qcAddressSigner
    watchdog = watchdogSigner
    thirdParty = thirdPartySigner

    // Generate role hashes
    DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
    DISPUTE_ARBITER_ROLE = ethers.utils.id("DISPUTE_ARBITER_ROLE")
  })

  beforeEach(async () => {
    await createSnapshot()

    // Create mock contracts
    mockTbtc = await smock.fake<TBTC>("TBTC")
    mockQCData = await smock.fake<QCData>("QCData")
    mockSystemState = await smock.fake<SystemState>("SystemState")

    // Create TestRelay for SPV validation
    const TestRelayFactory = await ethers.getContractFactory("TestRelay")
    testRelay = await TestRelayFactory.deploy()
    await testRelay.deployed()

    // Deploy SharedSPVCore library first
    const SharedSPVCoreFactory = await ethers.getContractFactory(
      "SharedSPVCore"
    )
    const sharedSPVCore = await SharedSPVCoreFactory.deploy()
    await sharedSPVCore.deployed()

    // Deploy QCRedeemerSPV library with SharedSPVCore dependency
    const QCRedeemerSPVFactory = await ethers.getContractFactory(
      "QCRedeemerSPV",
      {
        libraries: {
          SharedSPVCore: sharedSPVCore.address,
        },
      }
    )
    const qcRedeemerSPVLib = await QCRedeemerSPVFactory.deploy()
    await qcRedeemerSPVLib.deployed()

    // Deploy QCRedeemer with SPV support and link the library
    const QCRedeemerFactory = await ethers.getContractFactory("QCRedeemer", {
      libraries: {
        QCRedeemerSPV: qcRedeemerSPVLib.address,
      },
    })
    qcRedeemer = await QCRedeemerFactory.deploy(
      mockTbtc.address,
      mockQCData.address,
      mockSystemState.address,
      testRelay.address, // Use TestRelay for proper SPV validation
      1 // Low difficulty factor for testing - require same difficulty, not 96x
    )
    await qcRedeemer.deployed()

    // Grant roles
    await qcRedeemer.grantRole(DISPUTE_ARBITER_ROLE, watchdog.address)

    // Setup default mocks for validation
    mockSystemState.isRedemptionPaused.returns(false)
    mockSystemState.isQCEmergencyPaused.returns(false)
    mockSystemState.minMintAmount.returns(ethers.utils.parseEther("0.01")) // 0.01 tBTC minimum

    mockQCData.isQCRegistered.returns(true)
    mockQCData.getQCStatus.returns(0) // Active status

    // Setup QCData mocks for wallet registration
    // Default behavior - any wallet query returns the qcAddress as owner
    mockQCData.getWalletOwner.returns(qcAddress.address)
    // Mock wallet status as Active (enum value 1)
    mockQCData.getWalletStatus.returns(1) // WalletStatus.Active

    // Mock tBTC balance to always have enough
    mockTbtc.balanceOf.returns(ethers.utils.parseEther("100")) // 100 tBTC balance for all users
    mockTbtc.burnFrom.returns(true) // Mock successful burns

    // Deploy a mock AccountControl for redeemTBTC calls
    const MockAccountControl = await ethers.getContractFactory("MockAccountControl")
    const mockAccountControl = await MockAccountControl.deploy()
    await mockAccountControl.deployed()

    // Set the AccountControl address in QCRedeemer
    await qcRedeemer.setAccountControl(mockAccountControl.address)

    // Set a large totalMinted amount to allow redemptions in tests
    // 1000 BTC in satoshis should cover all test cases
    const largeAmount = ethers.BigNumber.from("100000000000") // 1000 BTC * 10^8 satoshis
    await mockAccountControl.setTotalMintedForTesting(largeAmount)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment", () => {
    it("should set correct dependencies", async () => {
      // QCRedeemer now uses direct integration - no public getters for dependencies
      expect(qcRedeemer.address).to.not.equal(ethers.constants.AddressZero)
    })

    it("should grant deployer admin and redeemer roles", async () => {
      const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
      expect(await qcRedeemer.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to
        .be.true
      expect(await qcRedeemer.hasRole(DISPUTE_ARBITER_ROLE, deployer.address))
        .to.be.true
      expect(await qcRedeemer.hasRole(DISPUTE_ARBITER_ROLE, deployer.address))
        .to.be.true
    })
  })

  describe("Role Constants", () => {
    it("should have correct role constants", async () => {
      expect(await qcRedeemer.DISPUTE_ARBITER_ROLE()).to.equal(
        DISPUTE_ARBITER_ROLE
      )
      expect(await qcRedeemer.DISPUTE_ARBITER_ROLE()).to.equal(
        DISPUTE_ARBITER_ROLE
      )
      // REDEMPTION_POLICY_KEY and TBTC_TOKEN_KEY removed with direct implementation
    })
  })

  describe("initiateRedemption", () => {
    const redemptionAmount = ethers.utils.parseEther("5")
    const validLegacyBtc = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
    const validBech32Btc = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080"
    const invalidBtc = "not_a_btc_address"

    context("when called with invalid parameters", () => {
      it("should revert with zero QC address", async () => {
        await expect(
          qcRedeemer
            .connect(user)
            .initiateRedemption(
              ethers.constants.AddressZero,
              redemptionAmount,
              validLegacyBtc,
              validLegacyBtc // qcWalletAddress
            )
        ).to.be.revertedWith("InvalidQCAddress")
      })

      it("should revert with zero amount", async () => {
        await expect(
          qcRedeemer
            .connect(user)
            .initiateRedemption(qcAddress.address, 0, validLegacyBtc, validLegacyBtc)
        ).to.be.revertedWith("InvalidAmount")
      })

      it("should revert if Bitcoin address is empty", async () => {
        await expect(
          qcRedeemer
            .connect(user)
            .initiateRedemption(qcAddress.address, redemptionAmount, "", validLegacyBtc)
        ).to.be.revertedWith("BitcoinAddressRequired")
      })

      it("should revert if Bitcoin address is invalid format", async () => {
        await expect(
          qcRedeemer
            .connect(user)
            .initiateRedemption(qcAddress.address, redemptionAmount, invalidBtc, validLegacyBtc)
        ).to.be.revertedWith("InvalidBitcoinAddressFormat")
      })

      it("should revert if Bitcoin address starts with invalid character", async () => {
        // Test addresses starting with '2' (invalid)
        await expect(
          qcRedeemer
            .connect(user)
            .initiateRedemption(
              qcAddress.address,
              redemptionAmount,
              "2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
              validLegacyBtc // qcWalletAddress
            )
        ).to.be.revertedWith("InvalidBitcoinAddressFormat")
      })

      it("should revert if Bech32 address is malformed", async () => {
        // Test incomplete Bech32 (just 'b' instead of 'bc1')
        await expect(
          qcRedeemer
            .connect(user)
            .initiateRedemption(
              qcAddress.address,
              redemptionAmount,
              "b1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
              validLegacyBtc // qcWalletAddress
            )
        ).to.be.revertedWith("InvalidBitcoinAddressFormat")
      })
    })

    context("when all validations pass", () => {
      let tx: any // ContractTransaction
      let redemptionId: string
      let usedBtc: string

      beforeEach(async () => {
        usedBtc = validLegacyBtc
        tx = await qcRedeemer
          .connect(user)
          .initiateRedemption(qcAddress.address, redemptionAmount, usedBtc, validLegacyBtc)
        const receipt = await tx.wait()
        const event = receipt.events?.find(
          (e: any) => e.event === "RedemptionRequested" // Event interface
        )
        redemptionId = event?.args?.redemptionId
      })

      it("should burn user tokens", async () => {
        expect(mockTbtc.burnFrom).to.have.been.calledWith(
          user.address,
          redemptionAmount
        )
      })

      it("should create redemption record with correct BTC address", async () => {
        const redemption = await qcRedeemer.getRedemption(redemptionId)
        expect(redemption.user).to.equal(user.address)
        expect(redemption.qc).to.equal(qcAddress.address)
        expect(redemption.amount).to.equal(redemptionAmount)
        expect(redemption.status).to.equal(1) // Pending
        expect(redemption.userBtcAddress).to.equal(usedBtc)
      })

      it("should emit RedemptionRequested event with correct BTC address", async () => {
        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
        await expect(tx)
          .to.emit(qcRedeemer, "RedemptionRequested")
          .withArgs(
            redemptionId,
            user.address,
            qcAddress.address,
            redemptionAmount,
            usedBtc,
            user.address,
            currentBlock.timestamp
          )
      })

      it("should return unique redemption ID", async () => {
        const tx2 = await qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            redemptionAmount,
            validBech32Btc,
            validBech32Btc // qcWalletAddress
          )
        const receipt2 = await tx2.wait()
        const event2 = receipt2.events?.find(
          (e: any) => e.event === "RedemptionRequested" // Event interface
        )
        const redemptionId2 = event2?.args?.redemptionId
        expect(redemptionId).to.not.equal(redemptionId2)
      })

      it("should accept P2PKH Bitcoin addresses (starting with '1')", async () => {
        await expect(
          qcRedeemer
            .connect(user)
            .initiateRedemption(
              qcAddress.address,
              redemptionAmount,
              "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
              "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2" // qcWalletAddress
            )
        ).to.not.be.reverted
      })

      it("should accept P2SH Bitcoin addresses (starting with '3')", async () => {
        await expect(
          qcRedeemer
            .connect(user)
            .initiateRedemption(
              qcAddress.address,
              redemptionAmount,
              "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
              "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy" // qcWalletAddress
            )
        ).to.not.be.reverted
      })

      it("should accept Bech32 Bitcoin addresses (starting with 'bc1')", async () => {
        await expect(
          qcRedeemer
            .connect(user)
            .initiateRedemption(
              qcAddress.address,
              redemptionAmount,
              validBech32Btc,
              validBech32Btc // qcWalletAddress
            )
        ).to.not.be.reverted
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
        .initiateRedemption(
          qcAddress.address,
          ethers.utils.parseEther("5"),
          validLegacyBtc,
          validLegacyBtc // qcWalletAddress
        )
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
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${DISPUTE_ARBITER_ROLE}`
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
        ).to.be.revertedWith("RedemptionNotPending")
      })
    })

    context("when called by arbiter with valid redemption", () => {
      let tx: any // ContractTransaction

      beforeEach(async () => {
        // Use mock data for successful test - SPV validation will be skipped with mock data
        // but this verifies the overall flow works
        const mockSpvData = createMockSpvData()
        tx = await qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillment(
            redemptionId,
            validLegacyBtc,
            100000,
            mockSpvData.txInfo,
            mockSpvData.proof
          )
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
            ethers.utils.parseEther("5"),
            watchdog.address,
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
        .initiateRedemption(
          qcAddress.address,
          ethers.utils.parseEther("5"),
          validLegacyBtc,
          validLegacyBtc // qcWalletAddress
        )
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
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${DISPUTE_ARBITER_ROLE}`
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
        ).to.be.revertedWith("RedemptionNotPending")
      })
    })

    context("when called by arbiter with valid redemption", () => {
      let tx: any // ContractTransaction

      beforeEach(async () => {
        tx = await qcRedeemer
          .connect(watchdog)
          .flagDefaultedRedemption(redemptionId, defaultReason)
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
        .initiateRedemption(
          qcAddress.address,
          ethers.utils.parseEther("5"),
          validLegacyBtc,
          validLegacyBtc // qcWalletAddress
        )
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
        .initiateRedemption(qcAddress.address, redemptionAmount, validLegacyBtc, validLegacyBtc)
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

  describe("Access Control", () => {
    context("DISPUTE_ARBITER_ROLE functions", () => {
      let redemptionId: string
      const spvProof = ethers.utils.toUtf8Bytes("mock_spv_proof")
      const defaultReason = ethers.utils.id("TIMEOUT")

      beforeEach(async () => {
        // Create a redemption first
        const tx = await qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            ethers.utils.parseEther("5"),
            validLegacyBtc,
            validLegacyBtc // qcWalletAddress
          )
        const receipt = await tx.wait()
        const event = receipt.events?.find(
          (e: any) => e.event === "RedemptionRequested" // Event interface
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
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${DISPUTE_ARBITER_ROLE}`
        )
      })

      it("should prevent non-arbiter from flagging default", async () => {
        await expect(
          qcRedeemer
            .connect(thirdParty)
            .flagDefaultedRedemption(redemptionId, defaultReason)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${DISPUTE_ARBITER_ROLE}`
        )
      })
    })
  })

  describe("Edge Cases", () => {
    context("when policy contracts change behavior", () => {
      let redemptionId: string

      beforeEach(async () => {
        // Create a redemption first
        const tx = await qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            ethers.utils.parseEther("5"),
            validLegacyBtc,
            validLegacyBtc // qcWalletAddress
          )
        const receipt = await tx.wait()
        const event = receipt.events?.find(
          (e: any) => e.event === "RedemptionRequested" // Event interface
        )
        redemptionId = event?.args?.redemptionId
      })

      it("should handle SPV verification properly", async () => {
        // SPV verification is now handled internally and will reject invalid proofs
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
        ).to.be.revertedWith("SPVErr") // Mock data fails SPV validation
      })
    })
  })

  describe("SPV Validation Integration", () => {
    let redemptionId: string

    beforeEach(async () => {
      // Create a redemption first
      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(
          qcAddress.address,
          ethers.utils.parseEther("5"),
          validLegacyBtc,
          validLegacyBtc // qcWalletAddress
        )
      const receipt = await tx.wait()
      const event = receipt.events?.find(
        (e: any) => e.event === "RedemptionRequested"
      )
      redemptionId = event?.args?.redemptionId
    })

    it("should successfully validate real SPV proofs", async () => {
      const realSpvData = createCompleteSpvTestData()

      // Configure TestRelay with proper difficulty from Bitcoin headers
      await testRelay.setCurrentEpochDifficultyFromHeaders(
        realSpvData.proof.bitcoinHeaders
      )
      await testRelay.setPrevEpochDifficultyFromHeaders(
        realSpvData.proof.bitcoinHeaders
      )

      // This should fail on payment verification (not SPV), proving SPV validation works
      await expect(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillment(
            redemptionId,
            realSpvData.userBtcAddress,
            realSpvData.expectedAmount,
            realSpvData.txInfo,
            realSpvData.proof
          )
      ).to.be.revertedWith(
        "RedemptionProofFailed(\"Payment verification failed\")"
      )

      // The fact that we get payment verification error (not SPV error) proves SPV works!
    })

    it("should fail with invalid SPV proofs", async () => {
      // Don't configure relay properly - this should fail on SPV validation
      const mockSpvData = createMockSpvData()

      await expect(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillment(
            redemptionId,
            validLegacyBtc,
            100000,
            mockSpvData.txInfo,
            mockSpvData.proof
          )
      ).to.be.revertedWith("SPVErr")
    })
  })
})
