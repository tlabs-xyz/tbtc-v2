import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  WatchdogConsensusManager,
  QCManager,
  QCRedeemer,
  QCData,
  WatchdogMonitor,
  ProtocolRegistry,
} from "../../typechain"
import { ROLES, QCStatus } from "./AccountControlTestHelpers"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("Consensus Failure Modes", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let watchdog4: SignerWithAddress
  let watchdog5: SignerWithAddress
  let qcAddress: SignerWithAddress
  let thirdParty: SignerWithAddress

  let consensusManager: WatchdogConsensusManager
  let watchdogMonitor: WatchdogMonitor
  let mockQcManager: FakeContract<QCManager>
  let mockQcRedeemer: FakeContract<QCRedeemer>
  let mockQcData: FakeContract<QCData>

  // Constants
  const VOTING_PERIOD = 7200 // 2 hours
  const MIN_REQUIRED_VOTES = 2
  const MAX_REQUIRED_VOTES = 7

  // Proposal types
  enum ProposalType {
    STATUS_CHANGE = 0,
    WALLET_DEREGISTRATION = 1,
    REDEMPTION_DEFAULT = 2,
    FORCE_INTERVENTION = 3,
  }

  before(async () => {
    ;[
      deployer,
      governance,
      watchdog1,
      watchdog2,
      watchdog3,
      watchdog4,
      watchdog5,
      qcAddress,
      thirdParty,
    ] = await ethers.getSigners()
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy mocks
    mockQcManager = await smock.fake<QCManager>("QCManager")
    mockQcRedeemer = await smock.fake<QCRedeemer>("QCRedeemer")
    mockQcData = await smock.fake<QCData>("QCData")

    // Deploy WatchdogConsensusManager
    const WatchdogConsensusManager = await ethers.getContractFactory(
      "WatchdogConsensusManager"
    )
    consensusManager = await WatchdogConsensusManager.deploy(
      mockQcManager.address,
      mockQcRedeemer.address,
      mockQcData.address
    )
    await consensusManager.deployed()

    // Deploy WatchdogMonitor
    const WatchdogMonitor = await ethers.getContractFactory("WatchdogMonitor")
    watchdogMonitor = await WatchdogMonitor.deploy(
      consensusManager.address,
      mockQcData.address
    )
    await watchdogMonitor.deployed()

    // Setup roles
    await consensusManager.grantRole(
      ROLES.DEFAULT_ADMIN_ROLE,
      governance.address
    )
    await consensusManager
      .connect(governance)
      .grantRole(await consensusManager.MANAGER_ROLE(), governance.address)

    // Grant watchdog roles
    const watchdogs = [watchdog1, watchdog2, watchdog3, watchdog4, watchdog5]
    for (const watchdog of watchdogs) {
      await consensusManager
        .connect(governance)
        .grantRole(await consensusManager.WATCHDOG_ROLE(), watchdog.address)
    }

    // Setup default mock returns
    mockQcData.isQCRegistered.returns(true)
    mockQcData.getQCStatus.returns(QCStatus.Active)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Byzantine Watchdog Scenarios", () => {
    it("should handle (N-1)/3 Byzantine watchdogs", async () => {
      // With 5 watchdogs, can tolerate 1 Byzantine (5-1)/3 = 1.33 -> 1
      // Set required votes to 3 (majority)
      await consensusManager.connect(governance).updateConsensusParameters(3, 5)

      // Create proposal
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.UnderReview, ethers.utils.id("SUSPICIOUS")]
      )

      const tx = await consensusManager
        .connect(watchdog1)
        .createProposal(
          ProposalType.STATUS_CHANGE,
          proposalData,
          "Suspicious activity detected"
        )

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "ProposalCreated")
      const proposalId = event?.args?.proposalId

      // Byzantine watchdog votes (1)
      await consensusManager.connect(watchdog1).vote(proposalId)

      // Honest watchdogs vote (3)
      await consensusManager.connect(watchdog2).vote(proposalId)
      await consensusManager.connect(watchdog3).vote(proposalId)
      await consensusManager.connect(watchdog4).vote(proposalId)

      // Byzantine watchdog 5 doesn't vote or votes differently
      // System should still reach consensus with 4/5 votes

      // Execute proposal
      await consensusManager.connect(watchdog1).executeProposal(proposalId)

      // Verify execution
      expect(mockQcManager.setQCStatus).to.have.been.calledWith(
        qcAddress.address,
        QCStatus.UnderReview,
        ethers.utils.id("SUSPICIOUS")
      )
    })

    it("should fail with too many Byzantine watchdogs", async () => {
      // With 5 watchdogs and required = 3, if 3 are Byzantine, consensus fails
      await consensusManager.connect(governance).updateConsensusParameters(3, 5)

      // Create proposal
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.UnderReview, ethers.utils.id("SUSPICIOUS")]
      )

      const tx = await consensusManager
        .connect(watchdog1)
        .createProposal(
          ProposalType.STATUS_CHANGE,
          proposalData,
          "Suspicious activity"
        )

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "ProposalCreated")
      const proposalId = event?.args?.proposalId

      // Only 2 honest watchdogs vote
      await consensusManager.connect(watchdog1).vote(proposalId)
      await consensusManager.connect(watchdog2).vote(proposalId)

      // 3 Byzantine watchdogs don't vote or obstruct
      // Cannot reach required 3 votes

      // Advance time past voting period
      await helpers.time.increase(VOTING_PERIOD + 1)

      // Execution should fail
      await expect(
        consensusManager.connect(watchdog1).executeProposal(proposalId)
      ).to.be.revertedWith("ProposalNotApproved")
    })
  })

  describe("Voting Edge Cases", () => {
    let proposalId: string

    beforeEach(async () => {
      // Create a proposal
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.UnderReview, ethers.utils.id("TEST")]
      )

      const tx = await consensusManager
        .connect(watchdog1)
        .createProposal(ProposalType.STATUS_CHANGE, proposalData, "Test")

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "ProposalCreated")
      proposalId = event?.args?.proposalId
    })

    it("should handle voting exactly at deadline", async () => {
      // Advance to 1 second before deadline
      await helpers.time.increase(VOTING_PERIOD - 1)

      // Vote should succeed
      await expect(consensusManager.connect(watchdog2).vote(proposalId))
        .to.emit(consensusManager, "VoteCast")
        .withArgs(proposalId, watchdog2.address, 2)

      // Advance 2 seconds (now past deadline)
      await helpers.time.increase(2)

      // Next vote should fail
      await expect(
        consensusManager.connect(watchdog3).vote(proposalId)
      ).to.be.revertedWith("VotingEnded")
    })

    it("should prevent double voting", async () => {
      // First vote succeeds
      await consensusManager.connect(watchdog1).vote(proposalId)

      // Second vote from same watchdog fails
      await expect(
        consensusManager.connect(watchdog1).vote(proposalId)
      ).to.be.revertedWith("AlreadyVoted")
    })

    it("should handle proposal with exactly required votes", async () => {
      // Default is 2 required votes
      await consensusManager.connect(watchdog1).vote(proposalId)
      await consensusManager.connect(watchdog2).vote(proposalId)

      // Should be executable with exactly 2 votes
      await expect(
        consensusManager.connect(watchdog1).executeProposal(proposalId)
      )
        .to.emit(consensusManager, "ProposalExecuted")
        .withArgs(proposalId, ProposalType.STATUS_CHANGE, watchdog1.address)
    })

    it("should handle proposal with 0 votes", async () => {
      // Don't vote, just try to execute
      await expect(
        consensusManager.connect(watchdog1).executeProposal(proposalId)
      ).to.be.revertedWith("ProposalNotApproved")
    })

    it("should prevent execution of non-existent proposal", async () => {
      const fakeProposalId = ethers.utils.id("fake-proposal")

      await expect(
        consensusManager.connect(watchdog1).executeProposal(fakeProposalId)
      ).to.be.revertedWith("ProposalNotFound")
    })
  })

  describe("Proposal Timing Attacks", () => {
    it("should handle proposal spam attacks", async () => {
      // Attacker tries to spam proposals to DoS the system
      const proposals = []

      // Create multiple proposals rapidly
      for (let i = 0; i < 10; i++) {
        const proposalData = ethers.utils.defaultAbiCoder.encode(
          ["address", "uint8", "bytes32"],
          [qcAddress.address, QCStatus.UnderReview, ethers.utils.id(`SPAM${i}`)]
        )

        const tx = await consensusManager
          .connect(watchdog1)
          .createProposal(
            ProposalType.STATUS_CHANGE,
            proposalData,
            `Spam proposal ${i}`
          )

        const receipt = await tx.wait()
        const event = receipt.events?.find((e) => e.event === "ProposalCreated")
        proposals.push(event?.args?.proposalId)
      }

      // System should handle multiple proposals
      expect(proposals.length).to.equal(10)

      // Each proposal requires independent voting
      // This prevents spam from affecting legitimate proposals
    })

    it("should handle vote front-running attempts", async () => {
      // Create proposal
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.Revoked, ethers.utils.id("CRITICAL")]
      )

      const tx = await consensusManager
        .connect(watchdog1)
        .createProposal(
          ProposalType.STATUS_CHANGE,
          proposalData,
          "Critical issue"
        )

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "ProposalCreated")
      const proposalId = event?.args?.proposalId

      // Watchdog 1 votes
      await consensusManager.connect(watchdog1).vote(proposalId)

      // Attacker (watchdog5) tries to front-run execution
      // But doesn't have enough votes yet
      await expect(
        consensusManager.connect(watchdog5).executeProposal(proposalId)
      ).to.be.revertedWith("ProposalNotApproved")

      // Legitimate second vote
      await consensusManager.connect(watchdog2).vote(proposalId)

      // Now execution succeeds
      await consensusManager.connect(watchdog1).executeProposal(proposalId)
    })

    it("should handle proposal expiration correctly", async () => {
      // Create proposal
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.UnderReview, ethers.utils.id("TEST")]
      )

      const tx = await consensusManager
        .connect(watchdog1)
        .createProposal(ProposalType.STATUS_CHANGE, proposalData, "Test")

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "ProposalCreated")
      const proposalId = event?.args?.proposalId

      // Get one vote
      await consensusManager.connect(watchdog1).vote(proposalId)

      // Advance past voting period
      await helpers.time.increase(VOTING_PERIOD + 1)

      // Should not be able to vote anymore
      await expect(
        consensusManager.connect(watchdog2).vote(proposalId)
      ).to.be.revertedWith("VotingEnded")

      // Should not be able to execute without enough votes
      await expect(
        consensusManager.connect(watchdog1).executeProposal(proposalId)
      ).to.be.revertedWith("ProposalNotApproved")
    })
  })

  describe("Parameter Boundary Testing", () => {
    it("should enforce minimum required votes", async () => {
      // Try to set below minimum
      await expect(
        consensusManager
          .connect(governance)
          .updateConsensusParameters(MIN_REQUIRED_VOTES - 1, 5)
      ).to.be.revertedWith("InvalidParameters")
    })

    it("should enforce maximum required votes", async () => {
      // Try to set above maximum
      await expect(
        consensusManager
          .connect(governance)
          .updateConsensusParameters(MAX_REQUIRED_VOTES + 1, 10)
      ).to.be.revertedWith("InvalidParameters")
    })

    it("should enforce required <= total watchdogs", async () => {
      // Try to set required > total
      await expect(
        consensusManager.connect(governance).updateConsensusParameters(6, 5)
      ).to.be.revertedWith("InvalidParameters")
    })

    it("should handle voting period boundaries", async () => {
      // Set to minimum period
      await consensusManager.connect(governance).updateVotingPeriod(3600) // 1 hour minimum

      expect(await consensusManager.votingPeriod()).to.equal(3600)

      // Try to set below minimum
      await expect(
        consensusManager.connect(governance).updateVotingPeriod(3599)
      ).to.be.revertedWith("InvalidParameters")

      // Set to maximum period
      await consensusManager.connect(governance).updateVotingPeriod(86400) // 24 hours maximum

      expect(await consensusManager.votingPeriod()).to.equal(86400)

      // Try to set above maximum
      await expect(
        consensusManager.connect(governance).updateVotingPeriod(86401)
      ).to.be.revertedWith("InvalidParameters")
    })
  })

  describe("Coordination Deadlock Scenarios", () => {
    it("should handle split vote deadlock", async () => {
      // Set 4-of-5 requirement
      await consensusManager.connect(governance).updateConsensusParameters(4, 5)

      // Create two competing proposals
      const proposal1Data = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.UnderReview, ethers.utils.id("ISSUE_A")]
      )

      const proposal2Data = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.Revoked, ethers.utils.id("ISSUE_B")]
      )

      const tx1 = await consensusManager
        .connect(watchdog1)
        .createProposal(
          ProposalType.STATUS_CHANGE,
          proposal1Data,
          "Issue A detected"
        )

      const tx2 = await consensusManager
        .connect(watchdog2)
        .createProposal(
          ProposalType.STATUS_CHANGE,
          proposal2Data,
          "Issue B detected"
        )

      const receipt1 = await tx1.wait()
      const receipt2 = await tx2.wait()

      const proposalId1 = receipt1.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId

      const proposalId2 = receipt2.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId

      // Split votes: 2 for proposal1, 2 for proposal2, 1 abstains
      await consensusManager.connect(watchdog1).vote(proposalId1)
      await consensusManager.connect(watchdog3).vote(proposalId1)

      await consensusManager.connect(watchdog2).vote(proposalId2)
      await consensusManager.connect(watchdog4).vote(proposalId2)

      // Neither proposal reaches 4 votes required
      // Both will expire without execution
      await helpers.time.increase(VOTING_PERIOD + 1)

      await expect(
        consensusManager.connect(watchdog1).executeProposal(proposalId1)
      ).to.be.revertedWith("ProposalNotApproved")

      await expect(
        consensusManager.connect(watchdog2).executeProposal(proposalId2)
      ).to.be.revertedWith("ProposalNotApproved")
    })

    it("should handle offline watchdog scenario", async () => {
      // Set 3-of-5 requirement
      await consensusManager.connect(governance).updateConsensusParameters(3, 5)

      // Create critical proposal
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.Revoked, ethers.utils.id("CRITICAL")]
      )

      const tx = await consensusManager
        .connect(watchdog1)
        .createProposal(
          ProposalType.STATUS_CHANGE,
          proposalData,
          "Critical failure"
        )

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "ProposalCreated")
      const proposalId = event?.args?.proposalId

      // Only 2 watchdogs vote (3 are "offline")
      await consensusManager.connect(watchdog1).vote(proposalId)
      await consensusManager.connect(watchdog2).vote(proposalId)

      // Cannot execute with insufficient votes
      await expect(
        consensusManager.connect(watchdog1).executeProposal(proposalId)
      ).to.be.revertedWith("ProposalNotApproved")

      // System is stuck until another watchdog comes online
      // This demonstrates importance of proper watchdog availability monitoring
    })
  })

  describe("Consensus Recovery Mechanisms", () => {
    it("should allow parameter adjustment for recovery", async () => {
      // Initial: 4-of-5 requirement
      await consensusManager.connect(governance).updateConsensusParameters(4, 5)

      // Create proposal that gets stuck
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.UnderReview, ethers.utils.id("STUCK")]
      )

      const tx = await consensusManager
        .connect(watchdog1)
        .createProposal(ProposalType.STATUS_CHANGE, proposalData, "Stuck")

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "ProposalCreated")
      const proposalId = event?.args?.proposalId

      // Only 3 votes (one short)
      await consensusManager.connect(watchdog1).vote(proposalId)
      await consensusManager.connect(watchdog2).vote(proposalId)
      await consensusManager.connect(watchdog3).vote(proposalId)

      // Governance reduces requirement to 3-of-5
      await consensusManager.connect(governance).updateConsensusParameters(3, 5)

      // Old proposal still requires original 4 votes
      // This prevents gaming the system by changing params mid-vote
      await expect(
        consensusManager.connect(watchdog1).executeProposal(proposalId)
      ).to.be.revertedWith("ProposalNotApproved")

      // New proposals will use new parameters
      const newProposalTx = await consensusManager
        .connect(watchdog1)
        .createProposal(ProposalType.STATUS_CHANGE, proposalData, "New")

      const newReceipt = await newProposalTx.wait()
      const newProposalId = newReceipt.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId

      // New proposal only needs 3 votes
      await consensusManager.connect(watchdog1).vote(newProposalId)
      await consensusManager.connect(watchdog2).vote(newProposalId)
      await consensusManager.connect(watchdog3).vote(newProposalId)

      // Can execute with 3 votes
      await consensusManager.connect(watchdog1).executeProposal(newProposalId)
    })

    it("should handle emergency bypass scenarios", async () => {
      // In extreme cases, system might need emergency bypass
      // This would require governance action outside consensus system

      // For now, verify that consensus can't be bypassed by watchdogs alone
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.Revoked, ethers.utils.id("EMERGENCY")]
      )

      // Try to execute without creating/voting
      const fakeProposalId = ethers.utils.id("emergency-bypass")

      await expect(
        consensusManager.connect(watchdog1).executeProposal(fakeProposalId)
      ).to.be.revertedWith("ProposalNotFound")

      // System maintains integrity even in emergencies
      // Real emergency response would go through governance timelock
    })
  })

  describe("Complex Failure Scenarios", () => {
    it("should handle cascading proposal failures", async () => {
      // Multiple related proposals that depend on each other

      // Proposal 1: Change status to UnderReview
      const proposal1Data = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.UnderReview, ethers.utils.id("STEP1")]
      )

      // Proposal 2: Depends on status being UnderReview (would revoke)
      const proposal2Data = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.Revoked, ethers.utils.id("STEP2")]
      )

      // Create both proposals
      const tx1 = await consensusManager
        .connect(watchdog1)
        .createProposal(ProposalType.STATUS_CHANGE, proposal1Data, "Step 1")

      const tx2 = await consensusManager
        .connect(watchdog2)
        .createProposal(ProposalType.STATUS_CHANGE, proposal2Data, "Step 2")

      const receipt1 = await tx1.wait()
      const receipt2 = await tx2.wait()

      const proposalId1 = receipt1.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId

      const proposalId2 = receipt2.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId

      // Vote for second proposal first (out of order)
      await consensusManager.connect(watchdog1).vote(proposalId2)
      await consensusManager.connect(watchdog2).vote(proposalId2)

      // Try to execute - but QC is still Active, not UnderReview
      // In real implementation, this might fail due to state requirements
      await consensusManager.connect(watchdog1).executeProposal(proposalId2)

      // Now vote for first proposal
      await consensusManager.connect(watchdog3).vote(proposalId1)
      await consensusManager.connect(watchdog4).vote(proposalId1)

      // Execution order matters for dependent operations
      await consensusManager.connect(watchdog3).executeProposal(proposalId1)
    })

    it("should handle consensus during network congestion", async () => {
      // Simulate high gas prices affecting voting participation

      // Create urgent proposal
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.Revoked, ethers.utils.id("URGENT")]
      )

      const tx = await consensusManager
        .connect(watchdog1)
        .createProposal(
          ProposalType.STATUS_CHANGE,
          proposalData,
          "Urgent action needed"
        )

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "ProposalCreated")
      const proposalId = event?.args?.proposalId

      // Only urgent votes get through initially
      await consensusManager.connect(watchdog1).vote(proposalId)

      // Advance time significantly (simulating congestion period)
      await helpers.time.increase(VOTING_PERIOD / 2)

      // More votes come in later
      await consensusManager.connect(watchdog2).vote(proposalId)

      // Just before deadline
      await helpers.time.increase(VOTING_PERIOD / 2 - 100)

      await consensusManager.connect(watchdog3).vote(proposalId)

      // Should still be able to execute if enough votes
      await consensusManager.connect(watchdog1).executeProposal(proposalId)
    })
  })
})
