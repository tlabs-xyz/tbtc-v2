import { ethers, helpers, waffle } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { Contract } from "ethers"
import { smock } from "@defi-wonderland/smock"
import type { FakeContract } from "@defi-wonderland/smock"

const { loadFixture } = waffle

describe("WatchdogConsensusManager", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let nonWatchdog: SignerWithAddress

  let consensusManager: Contract
  let qcManager: FakeContract<Contract>
  let qcRedeemer: FakeContract<Contract>
  let qcData: FakeContract<Contract>

  // Proposal type enum values (matches WatchdogConsensusManager.sol)
  const STATUS_CHANGE = 0
  const WALLET_DEREGISTRATION = 1
  const REDEMPTION_DEFAULT = 2
  const FORCE_INTERVENTION = 3

  // Role constants
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
  const WATCHDOG_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("WATCHDOG_ROLE"))
  const MANAGER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MANAGER_ROLE"))

  // Default parameters
  const DEFAULT_REQUIRED_VOTES = 2
  const DEFAULT_TOTAL_WATCHDOGS = 5
  const DEFAULT_VOTING_PERIOD = 2 * 60 * 60 // 2 hours

  async function fixture() {
    ;[deployer, governance, watchdog1, watchdog2, watchdog3, nonWatchdog] = 
      await ethers.getSigners()

    // Deploy mock contracts
    qcManager = await smock.fake("QCManager")
    qcRedeemer = await smock.fake("QCRedeemer")
    qcData = await smock.fake("QCData")

    // Deploy WatchdogConsensusManager
    const WatchdogConsensusManager = await ethers.getContractFactory("WatchdogConsensusManager")
    consensusManager = await WatchdogConsensusManager.deploy(
      qcManager.address,
      qcRedeemer.address,
      qcData.address
    )
    await consensusManager.deployed()

    // Grant roles
    await consensusManager.grantRole(MANAGER_ROLE, governance.address)
    await consensusManager.connect(governance).grantRole(WATCHDOG_ROLE, watchdog1.address)
    await consensusManager.connect(governance).grantRole(WATCHDOG_ROLE, watchdog2.address)
    await consensusManager.connect(governance).grantRole(WATCHDOG_ROLE, watchdog3.address)

    return {
      consensusManager,
      qcManager,
      qcRedeemer,
      qcData,
      deployer,
      governance,
      watchdog1,
      watchdog2,
      watchdog3,
      nonWatchdog
    }
  }

  beforeEach(async () => {
    ;({
      consensusManager,
      qcManager,
      qcRedeemer,
      qcData,
      deployer,
      governance,
      watchdog1,
      watchdog2,
      watchdog3,
      nonWatchdog
    } = await loadFixture(fixture))
  })

  describe("Deployment", () => {
    it("Should deploy with correct initial parameters", async () => {
      expect(await consensusManager.requiredVotes()).to.equal(DEFAULT_REQUIRED_VOTES)
      expect(await consensusManager.totalWatchdogs()).to.equal(DEFAULT_TOTAL_WATCHDOGS)
      expect(await consensusManager.votingPeriod()).to.equal(DEFAULT_VOTING_PERIOD)
    })

    it("Should set up initial roles correctly", async () => {
      expect(await consensusManager.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true
      expect(await consensusManager.hasRole(MANAGER_ROLE, deployer.address)).to.be.true
      expect(await consensusManager.hasRole(MANAGER_ROLE, governance.address)).to.be.true
    })

    it("Should set external contract addresses correctly", async () => {
      expect(await consensusManager.qcManager()).to.equal(qcManager.address)
      expect(await consensusManager.qcRedeemer()).to.equal(qcRedeemer.address)
      expect(await consensusManager.qcData()).to.equal(qcData.address)
    })
  })

  describe("Status Change Proposals", () => {
    it("Should allow watchdog to propose status change", async () => {
      const qcAddress = ethers.Wallet.createRandom().address
      const newStatus = 1 // UnderReview
      const reason = "Test status change"

      const tx = await consensusManager.connect(watchdog1).proposeStatusChange(
        qcAddress,
        newStatus,
        reason
      )

      const receipt = await tx.wait()
      const event = receipt.events?.find(e => e.event === 'ProposalCreated')
      expect(event).to.not.be.undefined
      expect(event?.args?.proposer).to.equal(watchdog1.address)
    })

    it("Should not allow non-watchdog to propose", async () => {
      const qcAddress = ethers.Wallet.createRandom().address
      const newStatus = 1
      const reason = "Test status change"

      await expect(
        consensusManager.connect(nonWatchdog).proposeStatusChange(qcAddress, newStatus, reason)
      ).to.be.revertedWith("AccessControl:")
    })

    it("Should auto-execute when threshold reached", async () => {
      const qcAddress = ethers.Wallet.createRandom().address
      const newStatus = 1
      const reason = "Test status change"

      // Propose (watchdog1 auto-votes)
      const tx = await consensusManager.connect(watchdog1).proposeStatusChange(
        qcAddress,
        newStatus,
        reason
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === 'ProposalCreated')?.args?.proposalId

      // Second vote should trigger execution
      const voteTx = await consensusManager.connect(watchdog2).vote(proposalId)
      const voteReceipt = await voteTx.wait()
      
      // Should have execution event
      const executionEvent = voteReceipt.events?.find(e => e.event === 'ProposalExecuted')
      expect(executionEvent).to.not.be.undefined
      
      // Should have called QCManager
      expect(qcManager.setQCStatus).to.have.been.calledOnce
    })
  })

  describe("Voting", () => {
    let proposalId: string

    beforeEach(async () => {
      const qcAddress = ethers.Wallet.createRandom().address
      const newStatus = 1
      const reason = "Test proposal"

      const tx = await consensusManager.connect(watchdog1).proposeStatusChange(
        qcAddress,
        newStatus,
        reason
      )
      const receipt = await tx.wait()
      proposalId = receipt.events?.find(e => e.event === 'ProposalCreated')?.args?.proposalId
    })

    it("Should allow watchdog to vote", async () => {
      await expect(consensusManager.connect(watchdog2).vote(proposalId))
        .to.emit(consensusManager, 'VoteCast')
        .withArgs(proposalId, watchdog2.address, 2)
    })

    it("Should not allow duplicate voting", async () => {
      await consensusManager.connect(watchdog2).vote(proposalId)
      
      await expect(
        consensusManager.connect(watchdog2).vote(proposalId)
      ).to.be.revertedWith("AlreadyVoted")
    })

    it("Should not allow voting on non-existent proposal", async () => {
      const fakeProposalId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("fake"))
      
      await expect(
        consensusManager.connect(watchdog2).vote(fakeProposalId)
      ).to.be.revertedWith("ProposalNotFound")
    })
  })

  describe("Parameter Management", () => {
    it("Should allow manager to update consensus parameters", async () => {
      const newRequired = 3
      const newTotal = 7

      await expect(
        consensusManager.connect(governance).updateConsensusParams(newRequired, newTotal)
      ).to.emit(consensusManager, 'ConsensusParamsUpdated')

      expect(await consensusManager.requiredVotes()).to.equal(newRequired)
      expect(await consensusManager.totalWatchdogs()).to.equal(newTotal)
    })

    it("Should enforce parameter bounds", async () => {
      // Test minimum bounds
      await expect(
        consensusManager.connect(governance).updateConsensusParams(1, 5)
      ).to.be.revertedWith("InvalidParameters")

      // Test maximum bounds
      await expect(
        consensusManager.connect(governance).updateConsensusParams(8, 10)
      ).to.be.revertedWith("InvalidParameters")

      // Test required > total
      await expect(
        consensusManager.connect(governance).updateConsensusParams(5, 3)
      ).to.be.revertedWith("InvalidParameters")
    })

    it("Should allow manager to update voting period", async () => {
      const newPeriod = 4 * 60 * 60 // 4 hours

      await expect(
        consensusManager.connect(governance).updateVotingPeriod(newPeriod)
      ).to.emit(consensusManager, 'VotingPeriodUpdated')

      expect(await consensusManager.votingPeriod()).to.equal(newPeriod)
    })

    it("Should not allow non-manager to update parameters", async () => {
      await expect(
        consensusManager.connect(watchdog1).updateConsensusParams(3, 7)
      ).to.be.revertedWith("AccessControl:")

      await expect(
        consensusManager.connect(watchdog1).updateVotingPeriod(4 * 60 * 60)
      ).to.be.revertedWith("AccessControl:")
    })
  })

  describe("View Functions", () => {
    it("Should return correct consensus parameters", async () => {
      const params = await consensusManager.getConsensusParams()
      expect(params.required).to.equal(DEFAULT_REQUIRED_VOTES)
      expect(params.total).to.equal(DEFAULT_TOTAL_WATCHDOGS)
      expect(params.period).to.equal(DEFAULT_VOTING_PERIOD)
    })

    it("Should check voting eligibility correctly", async () => {
      const qcAddress = ethers.Wallet.createRandom().address
      const tx = await consensusManager.connect(watchdog1).proposeStatusChange(
        qcAddress, 1, "test"
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === 'ProposalCreated')?.args?.proposalId

      // Watchdog2 should be able to vote
      expect(await consensusManager.canVote(proposalId, watchdog2.address)).to.be.true

      // Watchdog1 already voted (proposer auto-votes)
      expect(await consensusManager.canVote(proposalId, watchdog1.address)).to.be.false

      // Non-watchdog should not be able to vote
      expect(await consensusManager.canVote(proposalId, nonWatchdog.address)).to.be.false
    })
  })

  describe("Proposal Cleanup", () => {
    it("Should clean up expired proposals", async () => {
      const qcAddress = ethers.Wallet.createRandom().address
      const tx = await consensusManager.connect(watchdog1).proposeStatusChange(
        qcAddress, 1, "test"
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === 'ProposalCreated')?.args?.proposalId

      // Fast forward past voting period
      await helpers.time.increase(DEFAULT_VOTING_PERIOD + 1)

      // Clean up expired proposal
      await expect(consensusManager.cleanupExpired([proposalId]))
        .to.emit(consensusManager, 'ProposalExpired')
        .withArgs(proposalId)
    })
  })

  describe("Wallet Deregistration Proposals", () => {
    it("Should allow watchdog to propose wallet deregistration", async () => {
      const qcAddress = ethers.Wallet.createRandom().address
      const btcAddress = "bc1qexamplewallet"
      const reason = "Suspicious wallet activity"

      const tx = await consensusManager.connect(watchdog1).proposeWalletDeregistration(
        qcAddress,
        btcAddress,
        reason
      )

      const receipt = await tx.wait()
      const event = receipt.events?.find(e => e.event === 'ProposalCreated')
      expect(event).to.not.be.undefined
      expect(event?.args?.proposalType).to.equal(1) // WALLET_DEREGISTRATION
      expect(event?.args?.proposer).to.equal(watchdog1.address)
      expect(event?.args?.reason).to.equal(reason)
    })

    it("Should execute wallet deregistration when consensus reached", async () => {
      const qcAddress = ethers.Wallet.createRandom().address
      const btcAddress = "bc1qexamplewallet"
      const reason = "Consensus reached"

      const tx = await consensusManager.connect(watchdog1).proposeWalletDeregistration(
        qcAddress,
        btcAddress,
        reason
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === 'ProposalCreated')?.args?.proposalId

      // Second vote should trigger execution
      const voteTx = await consensusManager.connect(watchdog2).vote(proposalId)
      const voteReceipt = await voteTx.wait()
      
      // Should have execution event
      const executionEvent = voteReceipt.events?.find(e => e.event === 'ProposalExecuted')
      expect(executionEvent).to.not.be.undefined
      expect(executionEvent?.args?.proposalType).to.equal(1)
      
      // Should have called QCManager.requestWalletDeRegistration
      expect(qcManager.requestWalletDeRegistration).to.have.been.calledOnceWith(btcAddress)
    })
  })

  describe("Redemption Default Proposals", () => {
    it("Should allow watchdog to propose redemption default", async () => {
      const redemptionId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("redemption123"))
      const defaultReason = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TIMEOUT"))
      const description = "Redemption timed out after 48 hours"

      const tx = await consensusManager.connect(watchdog1).proposeRedemptionDefault(
        redemptionId,
        defaultReason,
        description
      )

      const receipt = await tx.wait()
      const event = receipt.events?.find(e => e.event === 'ProposalCreated')
      expect(event).to.not.be.undefined
      expect(event?.args?.proposalType).to.equal(2) // REDEMPTION_DEFAULT
      expect(event?.args?.proposer).to.equal(watchdog1.address)
      expect(event?.args?.reason).to.equal(description)
    })

    it("Should execute redemption default when consensus reached", async () => {
      const redemptionId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("redemption123"))
      const defaultReason = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TIMEOUT"))
      const description = "Consensus reached"

      const tx = await consensusManager.connect(watchdog1).proposeRedemptionDefault(
        redemptionId,
        defaultReason,
        description
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === 'ProposalCreated')?.args?.proposalId

      // Second vote should trigger execution
      const voteTx = await consensusManager.connect(watchdog2).vote(proposalId)
      const voteReceipt = await voteTx.wait()
      
      // Should have execution event
      const executionEvent = voteReceipt.events?.find(e => e.event === 'ProposalExecuted')
      expect(executionEvent).to.not.be.undefined
      expect(executionEvent?.args?.proposalType).to.equal(2)
      
      // Should have called QCRedeemer.flagDefaultedRedemption
      expect(qcRedeemer.flagDefaultedRedemption).to.have.been.calledOnceWith(redemptionId, defaultReason)
    })
  })

  describe("Force Intervention Proposals", () => {
    it("Should allow watchdog to propose force intervention", async () => {
      const targetContract = ethers.Wallet.createRandom().address
      const callData = "0x1234567890abcdef"
      const reason = "Emergency intervention required"

      const tx = await consensusManager.connect(watchdog1).proposeForceIntervention(
        targetContract,
        callData,
        reason
      )

      const receipt = await tx.wait()
      const event = receipt.events?.find(e => e.event === 'ProposalCreated')
      expect(event).to.not.be.undefined
      expect(event?.args?.proposalType).to.equal(3) // FORCE_INTERVENTION
      expect(event?.args?.proposer).to.equal(watchdog1.address)
      expect(event?.args?.reason).to.equal(reason)
    })

    it("Should execute force intervention when consensus reached", async () => {
      // Deploy a mock target contract for testing
      const MockTarget = await ethers.getContractFactory("contracts/test/TestERC20.sol:TestERC20")
      const mockTarget = await MockTarget.deploy()
      await mockTarget.deployed()

      const callData = mockTarget.interface.encodeFunctionData("pause")
      const reason = "Emergency pause required"

      const tx = await consensusManager.connect(watchdog1).proposeForceIntervention(
        mockTarget.address,
        callData,
        reason
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === 'ProposalCreated')?.args?.proposalId

      // Second vote should trigger execution
      const voteTx = await consensusManager.connect(watchdog2).vote(proposalId)
      const voteReceipt = await voteTx.wait()
      
      // Should have execution event
      const executionEvent = voteReceipt.events?.find(e => e.event === 'ProposalExecuted')
      expect(executionEvent).to.not.be.undefined
      expect(executionEvent?.args?.proposalType).to.equal(3)
    })
  })

  describe("M-of-N Consensus Scenarios", () => {
    beforeEach(async () => {
      // Set up 3-of-5 consensus for more complex testing
      await consensusManager.connect(governance).updateConsensusParams(3, 5)
    })

    it("Should require 3 votes for execution with 3-of-5 configuration", async () => {
      const qcAddress = ethers.Wallet.createRandom().address
      const newStatus = 1
      const reason = "3-of-5 test"

      // Create proposal (watchdog1 auto-votes = 1 vote)
      const tx = await consensusManager.connect(watchdog1).proposeStatusChange(
        qcAddress,
        newStatus,
        reason
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === 'ProposalCreated')?.args?.proposalId

      // Second vote (total = 2 votes) - should not execute yet
      await consensusManager.connect(watchdog2).vote(proposalId)
      let proposal = await consensusManager.getProposal(proposalId)
      expect(proposal.executed).to.equal(false)
      expect(proposal.voteCount).to.equal(2)

      // Third vote (total = 3 votes) - should trigger execution
      const thirdVoteTx = await consensusManager.connect(watchdog3).vote(proposalId)
      const thirdVoteReceipt = await thirdVoteTx.wait()
      
      const executionEvent = thirdVoteReceipt.events?.find(e => e.event === 'ProposalExecuted')
      expect(executionEvent).to.not.be.undefined

      proposal = await consensusManager.getProposal(proposalId)
      expect(proposal.executed).to.equal(true)
      expect(proposal.voteCount).to.equal(3)
    })

    it("Should handle mixed proposal types with different consensus requirements", async () => {
      // Create multiple proposals of different types
      const qcAddress = ethers.Wallet.createRandom().address
      
      const statusTx = await consensusManager.connect(watchdog1).proposeStatusChange(
        qcAddress, 1, "Status change"
      )
      const statusReceipt = await statusTx.wait()
      const statusProposalId = statusReceipt.events?.find(e => e.event === 'ProposalCreated')?.args?.proposalId

      const walletTx = await consensusManager.connect(watchdog2).proposeWalletDeregistration(
        qcAddress, "bc1qwallet", "Wallet issue"
      )
      const walletReceipt = await walletTx.wait()
      const walletProposalId = walletReceipt.events?.find(e => e.event === 'ProposalCreated')?.args?.proposalId

      // Both should require 3 votes total
      // Status proposal needs 2 more votes (already has 1 from proposer)
      await consensusManager.connect(watchdog3).vote(statusProposalId)
      await consensusManager.connect(watchdog4).vote(statusProposalId) // Should execute

      // Wallet proposal needs 2 more votes (already has 1 from proposer)
      await consensusManager.connect(watchdog1).vote(walletProposalId)
      await consensusManager.connect(watchdog3).vote(walletProposalId) // Should execute

      const statusProposal = await consensusManager.getProposal(statusProposalId)
      const walletProposal = await consensusManager.getProposal(walletProposalId)

      expect(statusProposal.executed).to.equal(true)
      expect(walletProposal.executed).to.equal(true)
    })
  })
})