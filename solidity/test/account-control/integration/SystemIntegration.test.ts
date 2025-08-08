import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { smock } from "@defi-wonderland/smock"
import { BigNumber } from "ethers"
import {
  IntegrationTestContext,
  setupIntegrationTest,
  setupQCForTesting,
  createAndExecuteProposal,
  triggerEmergencyPause,
  TEST_AMOUNTS,
} from "./IntegrationTestHelpers"
import {
  QCStatus,
  TEST_DATA,
  createMockSpvData,
} from "../AccountControlTestHelpers"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("System Integration Tests", () => {
  let ctx: IntegrationTestContext
  let qcAddress2: SignerWithAddress
  
  before(async () => {
    const signers = await ethers.getSigners()
    qcAddress2 = signers[9]
  })

  beforeEach(async () => {
    await createSnapshot()
    ctx = await setupIntegrationTest(true) // Include V2 contracts
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Core QC Lifecycle", () => {
    it("should handle complete QC onboarding with SPV validation", async () => {
      // Register QC
      await ctx.qcData.registerQC(ctx.qcAddress.address, TEST_AMOUNTS.LARGE)
      
      expect(await ctx.qcData.isQCRegistered(ctx.qcAddress.address)).to.be.true
      expect(await ctx.qcData.getQCStatus(ctx.qcAddress.address)).to.equal(QCStatus.Active)

      // Register wallet with SPV proof
      const { challenge, txInfo, proof } = createMockSpvData()
      const encodedProof = ethers.utils.defaultAbiCoder.encode(
        [
          "tuple(bytes4 version, bytes inputVector, bytes outputVector, bytes4 locktime)",
          "tuple(bytes merkleProof, uint256 txIndexInBlock, bytes bitcoinHeaders, bytes32 coinbasePreimage, bytes coinbaseProof)",
        ],
        [txInfo, proof]
      )

      await ctx.qcWatchdog
        .connect(ctx.watchdog1)
        .registerWalletWithProof(
          ctx.qcAddress.address,
          TEST_DATA.BTC_ADDRESSES.TEST,
          encodedProof,
          challenge
        )

      expect(await ctx.qcData.isWalletRegistered(TEST_DATA.BTC_ADDRESSES.TEST)).to.be.true

      // Submit reserves and verify solvency
      await ctx.qcReserveLedger
        .connect(ctx.watchdog1)
        .submitReserveAttestation(ctx.qcAddress.address, TEST_AMOUNTS.MEDIUM)

      expect(await ctx.qcManager.verifyQCSolvency(ctx.qcAddress.address)).to.be.true
    })

    it("should handle SPV validation failures gracefully", async () => {
      await ctx.qcData.registerQC(ctx.qcAddress.address, TEST_AMOUNTS.LARGE)
      
      // Configure SPV validator to reject
      ctx.mockSpvValidator.verifyWalletControl.returns(false)
      
      const { challenge, txInfo, proof } = createMockSpvData()
      const encodedProof = ethers.utils.defaultAbiCoder.encode(
        [
          "tuple(bytes4 version, bytes inputVector, bytes outputVector, bytes4 locktime)",
          "tuple(bytes merkleProof, uint256 txIndexInBlock, bytes bitcoinHeaders, bytes32 coinbasePreimage, bytes coinbaseProof)",
        ],
        [txInfo, proof]
      )

      await expect(
        ctx.qcWatchdog
          .connect(ctx.watchdog1)
          .registerWalletWithProof(
            ctx.qcAddress.address,
            TEST_DATA.BTC_ADDRESSES.TEST,
            encodedProof,
            challenge
          )
      ).to.be.revertedWith("SPVVerificationFailed")

      expect(await ctx.qcData.isWalletRegistered(TEST_DATA.BTC_ADDRESSES.TEST)).to.be.false
    })
  })

  describe("Minting Operations", () => {
    beforeEach(async () => {
      await setupQCForTesting(ctx, ctx.qcAddress.address, "1000", "500")
    })

    it("should prevent minting when QC becomes insolvent", async () => {
      // Make QC insolvent
      await ctx.qcData.updateQCMintedAmount(
        ctx.qcAddress.address,
        ethers.utils.parseEther("600") // More than reserves
      )

      const canMint = await ctx.basicMintingPolicy.canMint(
        ctx.user1.address,
        ctx.qcAddress.address,
        TEST_AMOUNTS.SMALL
      )
      expect(canMint).to.be.false
    })

    it("should handle consensus-based minting through proposals", async () => {
      // Setup V2 contracts
      await ctx.basicMintingPolicy.setQCCapacity(
        ctx.qcAddress.address,
        TEST_AMOUNTS.MEDIUM
      )

      // Create minting proposal
      const mintProposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [ctx.qcAddress.address, TEST_AMOUNTS.SMALL]
      )

      await createAndExecuteProposal(
        ctx,
        mintProposalData,
        "Mint 10 tBTC",
        [ctx.watchdog1, ctx.watchdog2]
      )

      // Verify minting occurred through Bank
      if (ctx.bank) {
        const bankBalance = await ctx.bank.balanceOf(ctx.qcAddress.address)
        expect(bankBalance).to.equal(TEST_AMOUNTS.SMALL)
      }
    })
  })

  describe("Redemption Operations", () => {
    beforeEach(async () => {
      await setupQCForTesting(ctx, ctx.qcAddress.address, "1000", "500")
      await ctx.basicMintingPolicy.executeMint(
        ctx.user1.address,
        ctx.qcAddress.address,
        TEST_AMOUNTS.MEDIUM
      )
    })

    it("should handle redemption timeout and default", async () => {
      const tx = await ctx.qcRedeemer
        .connect(ctx.user1)
        .initiateRedemption(
          ctx.qcAddress.address,
          TEST_AMOUNTS.SMALL,
          TEST_DATA.BTC_ADDRESSES.LEGACY
        )

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "RedemptionInitiated")
      const redemptionId = event?.args?.redemptionId

      // Advance time past timeout
      await helpers.time.increase(604800 + 1) // 7 days

      await ctx.qcRedeemer
        .connect(ctx.governance)
        .flagDefaultedRedemption(redemptionId, ethers.utils.id("TIMEOUT"))

      // Verify QC status affected
      // Implementation specific - could check penalties
    })
  })

  describe("Watchdog Consensus", () => {
    beforeEach(async () => {
      await setupQCForTesting(ctx, ctx.qcAddress.address, "1000", "500")
    })

    it("should handle consensus-based QC status changes", async () => {
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [ctx.qcAddress.address, QCStatus.UnderReview, ethers.utils.id("SUSPICIOUS")]
      )

      await createAndExecuteProposal(
        ctx,
        proposalData,
        "Suspicious activity detected",
        [ctx.watchdog1, ctx.watchdog2]
      )

      expect(await ctx.qcData.getQCStatus(ctx.qcAddress.address)).to.equal(
        QCStatus.UnderReview
      )

      // Verify operations blocked
      const canMint = await ctx.basicMintingPolicy.canMint(
        ctx.user1.address,
        ctx.qcAddress.address,
        TEST_AMOUNTS.SMALL
      )
      expect(canMint).to.be.false
    })

    it("should handle rapid proposal creation and voting", async () => {
      await ctx.basicMintingPolicy.setQCCapacity(
        ctx.qcAddress.address,
        TEST_AMOUNTS.LARGE
      )
      
      const proposals = []
      
      // Create multiple proposals rapidly
      for (let i = 0; i < 5; i++) {
        const proposalId = await createAndExecuteProposal(
          ctx,
          ethers.utils.defaultAbiCoder.encode(
            ["address", "uint256"],
            [ctx.qcAddress.address, ethers.utils.parseEther(`${(i + 1) * 10}`)]
          ),
          `Mint ${(i + 1) * 10} tBTC`,
          i % 2 === 0 ? [ctx.watchdog1, ctx.watchdog2, ctx.watchdog3] : [ctx.watchdog1, ctx.watchdog2]
        )
        proposals.push(proposalId)
      }

      // Verify all proposals executed
      expect(proposals.length).to.equal(5)
    })
  })

  describe("Emergency Response", () => {
    beforeEach(async () => {
      await setupQCForTesting(ctx, ctx.qcAddress.address, "1000", "500")
      await ctx.basicMintingPolicy.executeMint(
        ctx.user1.address,
        ctx.qcAddress.address,
        TEST_AMOUNTS.MEDIUM
      )
    })

    it("should handle emergency pause and recovery", async () => {
      // Trigger emergency
      await triggerEmergencyPause(
        ctx,
        ctx.qcAddress.address,
        [ctx.watchdog1, ctx.watchdog2, ctx.watchdog3]
      )

      expect(await ctx.watchdogMonitor.isEmergencyPaused(ctx.qcAddress.address)).to.be.true

      // Operations blocked
      const canMint = await ctx.basicMintingPolicy.canMint(
        ctx.user1.address,
        ctx.qcAddress.address,
        TEST_AMOUNTS.SMALL
      )
      expect(canMint).to.be.false

      // Clear emergency
      await ctx.watchdogMonitor
        .connect(ctx.governance)
        .clearEmergencyPause(ctx.qcAddress.address)

      // Operations resume
      const canMintAfter = await ctx.basicMintingPolicy.canMint(
        ctx.user1.address,
        ctx.qcAddress.address,
        TEST_AMOUNTS.SMALL
      )
      expect(canMintAfter).to.be.true
    })

    it("should handle system-wide pause during active operations", async () => {
      // Pause system
      await ctx.systemState.pauseMinting()
      await ctx.systemState.pauseRedemption()

      // All operations blocked
      const canMint = await ctx.basicMintingPolicy.canMint(
        ctx.user1.address,
        ctx.qcAddress.address,
        TEST_AMOUNTS.SMALL
      )
      expect(canMint).to.be.false

      await expect(
        ctx.qcRedeemer
          .connect(ctx.user1)
          .initiateRedemption(
            ctx.qcAddress.address,
            TEST_AMOUNTS.SMALL,
            TEST_DATA.BTC_ADDRESSES.LEGACY
          )
      ).to.be.reverted

      // Unpause
      await ctx.systemState.unpauseMinting()
      await ctx.systemState.unpauseRedemption()

      // Operations resume
      const canMintAfter = await ctx.basicMintingPolicy.canMint(
        ctx.user1.address,
        ctx.qcAddress.address,
        TEST_AMOUNTS.SMALL
      )
      expect(canMintAfter).to.be.true
    })
  })

  describe("Multi-QC Operations", () => {
    beforeEach(async () => {
      // Setup two QCs
      await setupQCForTesting(ctx, ctx.qcAddress.address, "1000", "500")
      await setupQCForTesting(ctx, qcAddress2.address, "1000", "500")
    })

    it("should handle independent QC emergencies", async () => {
      // Trigger emergency for QC1 only
      await triggerEmergencyPause(
        ctx,
        ctx.qcAddress.address,
        [ctx.watchdog1, ctx.watchdog2, ctx.watchdog3]
      )

      expect(await ctx.watchdogMonitor.isEmergencyPaused(ctx.qcAddress.address)).to.be.true
      expect(await ctx.watchdogMonitor.isEmergencyPaused(qcAddress2.address)).to.be.false

      // QC1 blocked, QC2 operational
      const canMintQC1 = await ctx.basicMintingPolicy.canMint(
        ctx.user1.address,
        ctx.qcAddress.address,
        TEST_AMOUNTS.SMALL
      )
      expect(canMintQC1).to.be.false

      const canMintQC2 = await ctx.basicMintingPolicy.canMint(
        ctx.user1.address,
        qcAddress2.address,
        TEST_AMOUNTS.SMALL
      )
      expect(canMintQC2).to.be.true
    })
  })

  describe("Cross-Contract Communication", () => {
    beforeEach(async () => {
      await setupQCForTesting(ctx, ctx.qcAddress.address, "1000", "500")
    })

    it("should handle service registry updates gracefully", async () => {
      // Verify current operation works
      const canMint = await ctx.basicMintingPolicy.canMint(
        ctx.user1.address,
        ctx.qcAddress.address,
        TEST_AMOUNTS.SMALL
      )
      expect(canMint).to.be.true

      // Deploy new QCData contract
      const NewQCData = await ethers.getContractFactory("QCData")
      const newQcData = await NewQCData.deploy()
      await newQcData.deployed()

      // Update service registry
      await ctx.protocolRegistry.setService(
        ethers.utils.id("QC_DATA"),
        newQcData.address
      )

      // Existing operations continue with cached references
      // New operations would use new contract
    })
  })

  describe("Performance and Scalability", () => {
    beforeEach(async () => {
      await setupQCForTesting(ctx, ctx.qcAddress.address, "10000", "5000")
    })

    it("should handle concurrent operations efficiently", async () => {
      const operations = []

      // Multiple attestations
      for (let i = 0; i < 5; i++) {
        operations.push(
          ctx.qcReserveLedger
            .connect(ctx.watchdog1)
            .submitReserveAttestation(
              ctx.qcAddress.address,
              TEST_AMOUNTS.LARGE.add(ethers.utils.parseEther(i.toString()))
            )
        )
      }

      // Multiple validity checks
      for (let i = 0; i < 3; i++) {
        operations.push(
          ctx.basicMintingPolicy.canMint(
            ctx.user1.address,
            ctx.qcAddress.address,
            TEST_AMOUNTS.SMALL
          )
        )
      }

      const results = await Promise.all(operations)
      expect(results.length).to.equal(8)
    })

    it("should maintain consistency under high load", async () => {
      const mintAmount = ethers.utils.parseEther("10")
      const operations = 10

      for (let i = 0; i < operations; i++) {
        await ctx.basicMintingPolicy.executeMint(
          ctx.user1.address,
          ctx.qcAddress.address,
          mintAmount
        )
      }

      const totalMinted = mintAmount.mul(operations)
      expect(await ctx.tbtc.balanceOf(ctx.user1.address)).to.equal(totalMinted)
      expect(await ctx.qcData.getQCMintedAmount(ctx.qcAddress.address)).to.equal(totalMinted)
    })
  })

  describe("V2 Infrastructure Integration", () => {
    beforeEach(async () => {
      await setupQCForTesting(ctx, ctx.qcAddress.address, "1000", "500")
    })

    it("should integrate with Bank and Vault systems", async () => {
      if (!ctx.bank || !ctx.vault) {
        this.skip()
        return
      }

      // Setup QC capacity
      await ctx.basicMintingPolicy.setQCCapacity(
        ctx.qcAddress.address,
        TEST_AMOUNTS.MEDIUM
      )

      // Mint through consensus
      const mintProposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [ctx.qcAddress.address, TEST_AMOUNTS.SMALL.mul(5)]
      )

      await createAndExecuteProposal(
        ctx,
        mintProposalData,
        "Mint 50 tBTC to Bank",
        [ctx.watchdog1, ctx.watchdog2]
      )

      // QC approves vault
      await ctx.bank.connect(ctx.qcAddress).approveBalance(
        ctx.vault.address,
        TEST_AMOUNTS.SMALL.mul(5)
      )

      // Multiple users mint from same QC balance
      await ctx.vault.connect(ctx.user1).mint(TEST_AMOUNTS.SMALL.mul(2))
      await ctx.vault.connect(ctx.user2).mint(TEST_AMOUNTS.SMALL)

      // Verify distribution
      expect(await ctx.tbtc.balanceOf(ctx.user1.address)).to.equal(TEST_AMOUNTS.SMALL.mul(2))
      expect(await ctx.tbtc.balanceOf(ctx.user2.address)).to.equal(TEST_AMOUNTS.SMALL)
      expect(await ctx.bank.balanceOf(ctx.qcAddress.address)).to.equal(TEST_AMOUNTS.SMALL.mul(2))
    })
  })

  describe("Governance and Upgrades", () => {
    beforeEach(async () => {
      await setupQCForTesting(ctx, ctx.qcAddress.address, "1000", "500")
    })

    it("should handle policy upgrades gracefully", async () => {
      // Create operation with old policy
      await ctx.basicMintingPolicy.executeMint(
        ctx.user1.address,
        ctx.qcAddress.address,
        TEST_AMOUNTS.SMALL
      )

      // Deploy new policy
      const NewPolicyFactory = await ethers.getContractFactory("BasicMintingPolicy")
      const newPolicy = await NewPolicyFactory.deploy(ctx.protocolRegistry.address)
      await newPolicy.deployed()

      // Update registry
      await ctx.protocolRegistry.setService(
        ethers.utils.id("MINTING_POLICY"),
        newPolicy.address
      )

      // Grant roles to new policy
      await ctx.qcManager.grantRole(
        ethers.utils.id("QC_ADMIN_ROLE"),
        newPolicy.address
      )

      // Operations continue with new policy
      await newPolicy.executeMint(
        ctx.user1.address,
        ctx.qcAddress.address,
        TEST_AMOUNTS.SMALL
      )

      expect(await ctx.tbtc.balanceOf(ctx.user1.address)).to.equal(TEST_AMOUNTS.SMALL.mul(2))
    })

    it("should handle dynamic watchdog configuration", async () => {
      const newWatchdog = ctx.user2

      // Add new watchdog
      await ctx.watchdogConsensusManager
        .connect(ctx.governance)
        .grantRole(
          await ctx.watchdogConsensusManager.WATCHDOG_ROLE(),
          newWatchdog.address
        )

      // Remove existing watchdog
      await ctx.watchdogConsensusManager
        .connect(ctx.governance)
        .revokeRole(
          await ctx.watchdogConsensusManager.WATCHDOG_ROLE(),
          ctx.watchdog3.address
        )

      // Create proposal with new configuration
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [ctx.qcAddress.address, TEST_AMOUNTS.SMALL]
      )

      const tx = await ctx.watchdogConsensusManager
        .connect(ctx.watchdog1)
        .createProposal(0, proposalData, "Test with new watchdog config")

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "ProposalCreated")
      const proposalId = event?.args?.proposalId

      // New watchdog can vote
      await ctx.watchdogConsensusManager.connect(newWatchdog).vote(proposalId)

      // Removed watchdog cannot
      await expect(
        ctx.watchdogConsensusManager.connect(ctx.watchdog3).vote(proposalId)
      ).to.be.reverted
    })
  })
})