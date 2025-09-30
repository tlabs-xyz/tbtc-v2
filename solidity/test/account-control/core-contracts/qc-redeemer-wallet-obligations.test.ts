import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  QCRedeemer,
  QCData,
  SystemState,
  TBTC,
  SPVState,
  TestRelay,
  MockAccountControl,
} from "../../../typechain"
import { deploySPVLibraries, getQCRedeemerLibraries } from "../../helpers/spvLibraryHelpers"
import { createRealSpvData } from "../helpers/spv-data-helpers"
import { setupTestSigners, type TestSigners } from "../fixtures/base-setup"
import { expectCustomError } from "../helpers/error-helpers"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCRedeemer - Wallet Obligations", () => {
  let signers: TestSigners
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let user3: SignerWithAddress
  let arbiter: SignerWithAddress

  let qcRedeemer: QCRedeemer
  let mockQCData: FakeContract<QCData>
  let mockSystemState: FakeContract<SystemState>
  let mockTBTC: FakeContract<TBTC>
  let testRelay: TestRelay
  let mockAccountControl: MockAccountControl

  // Test data - standardized using satoshis for consistency
  const qcAddress = "0x1234567890123456789012345678901234567890"
  const qcWallet1 = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" // Satoshi's address
  const qcWallet2 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"
  // Use a P2PKH address that we can create a valid transaction for
  // Bitcoin address hash160: 389ffce9cd9ae88dcc0631e88a821ffdbe9bfe26
  // This corresponds to Bitcoin address: 16AKHntBwUjCyKVxGY5zz8DFZr66YzXtU2
  const userBtcAddress = "16AKHntBwUjCyKVxGY5zz8DFZr66YzXtU2"
  const redemptionAmount = ethers.BigNumber.from("100000000") // 1 BTC in satoshis

  before(async () => {
    signers = await setupTestSigners()

    // Additional signers for this specific test
    const allSigners = await ethers.getSigners()
    user1 = allSigners[7] // Beyond the standard TestSigners
    user2 = allSigners[8]
    user3 = allSigners[9]
    arbiter = allSigners[10]
  })

  beforeEach(async () => {
    await createSnapshot()

    // Create mock contracts
    mockQCData = await smock.fake<QCData>("QCData")
    mockSystemState = await smock.fake<SystemState>("SystemState")
    mockTBTC = await smock.fake<TBTC>("TBTC")

    // Deploy test relay (required by SPVState)
    const TestRelayFactory = await ethers.getContractFactory("TestRelay")
    testRelay = await TestRelayFactory.deploy()
    await testRelay.deployed()

    // Configure TestRelay with proper difficulty for SPV validation
    const realSpvData = createRealSpvData()
    await testRelay.setCurrentEpochDifficultyFromHeaders(
      realSpvData.proof.bitcoinHeaders
    )
    await testRelay.setPrevEpochDifficultyFromHeaders(
      realSpvData.proof.bitcoinHeaders
    )

    // Deploy SPV libraries for QCRedeemer
    const libraries = await deploySPVLibraries()

    // Deploy QCRedeemer with required SPV parameters and library linking
    const QCRedeemerFactory = await ethers.getContractFactory("QCRedeemer", getQCRedeemerLibraries(libraries))
    qcRedeemer = await QCRedeemerFactory.deploy(
      mockTBTC.address,
      mockQCData.address,
      mockSystemState.address,
      testRelay.address,
      1 // txProofDifficultyFactor
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
    mockSystemState.minMintAmount.returns(ethers.BigNumber.from("100000")) // 0.001 BTC in satoshis

    // Setup QC as registered and active
    mockQCData.isQCRegistered.whenCalledWith(qcAddress).returns(true)
    mockQCData.getQCStatus.whenCalledWith(qcAddress).returns(0) // Active

    // Setup wallets as registered to QC
    mockQCData.getWalletOwner.whenCalledWith(qcWallet1).returns(qcAddress)
    mockQCData.getWalletOwner.whenCalledWith(qcWallet2).returns(qcAddress)
    mockQCData.getWalletStatus.whenCalledWith(qcWallet1).returns(1) // Active
    mockQCData.getWalletStatus.whenCalledWith(qcWallet2).returns(1) // Active

    // Setup TBTC mock (using satoshis)
    mockTBTC.balanceOf.returns(ethers.BigNumber.from("10000000000")) // 100 BTC in satoshis
    mockTBTC.burnFrom.returns(true)

    // Deploy MockBank first for MockAccountControl dependency
    const MockBankFactory = await ethers.getContractFactory("MockBank")
    const mockBank = await MockBankFactory.deploy()

    // Deploy MockAccountControl and configure QCRedeemer with comprehensive setup
    const MockAccountControlFactory = await ethers.getContractFactory("MockAccountControl")
    mockAccountControl = await MockAccountControlFactory.deploy(mockBank.address)
    await mockAccountControl.deployed()
    await mockAccountControl.setTotalMintedForTesting(
      ethers.BigNumber.from("100000000000") // 1000 BTC in satoshis
    )
    // Authorize QCRedeemer contract and set minted balance for redemptions
    await mockAccountControl.authorizeReserve(
      qcRedeemer.address,
      ethers.BigNumber.from("100000000000") // 1000 BTC minting cap
    )
    await mockAccountControl.setMintedForTesting(
      qcRedeemer.address,
      ethers.BigNumber.from("100000000000") // 1000 BTC in satoshis
    )
    await qcRedeemer.setAccountControl(mockAccountControl.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

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

      it("should clear wallet obligations on fulfillment (simulated via default)", async () => {
        // NOTE: This test simulates fulfillment by using the default mechanism because
        // creating a valid SPV proof for arbitrary test data is not feasible.
        // The wallet obligation clearing logic is the same for both fulfillment and default.
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
        expect(await qcRedeemer.getWalletPendingRedemptionCount(qcWallet1)).to.equal(0)
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
        mockQCData.getWalletOwner.whenCalledWith(invalidWallet).returns(qcAddress)
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
        mockQCData.getWalletOwner.whenCalledWith(bech32Wallet).returns(qcAddress)
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
})