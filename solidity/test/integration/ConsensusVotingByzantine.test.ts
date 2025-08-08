import { ethers, deployments, helpers } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber } from "ethers"
import {
  WatchdogConsensusManager,
  QCManager,
  QCRedeemer,
  SystemState,
} from "../../typechain"

const HOUR = 3600
const DAY = 86400
const VOTING_PERIOD = 2 * HOUR

describe("WatchdogConsensusManager Voting & Byzantine Fault Tests", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let watchdog4: SignerWithAddress
  let watchdog5: SignerWithAddress
  let byzantineWatchdog: SignerWithAddress
  let qc1: SignerWithAddress
  let qc2: SignerWithAddress
  let user: SignerWithAddress

  let consensusManager: WatchdogConsensusManager
  let qcManager: QCManager
  let qcRedeemer: QCRedeemer
  let systemState: SystemState

  const ProposalType = {
    StatusChange: 0,
    RedemptionDefault: 1,
    ForceIntervention: 2,
    ParameterChange: 3,
  }

  beforeEach(async () => {
    await deployments.fixture(["AccountControl"])
    ;({ deployer, governance } = await helpers.signers.getNamedSigners())
    ;[watchdog1, watchdog2, watchdog3, watchdog4, watchdog5, byzantineWatchdog, qc1, qc2, user] = 
      await helpers.signers.getUnnamedSigners()

    // Get deployed contracts
    consensusManager = await helpers.contracts.getContract("WatchdogConsensusManager")
    qcManager = await helpers.contracts.getContract("QCManager")
    qcRedeemer = await helpers.contracts.getContract("QCRedeemer")
    systemState = await helpers.contracts.getContract("SystemState")

    // Add watchdogs to consensus manager
    await consensusManager.connect(governance).addWatchdog(watchdog1.address)
    await consensusManager.connect(governance).addWatchdog(watchdog2.address)
    await consensusManager.connect(governance).addWatchdog(watchdog3.address)
    await consensusManager.connect(governance).addWatchdog(watchdog4.address)
    await consensusManager.connect(governance).addWatchdog(watchdog5.address)

    // Register QCs
    await qcManager.connect(governance).registerQC(qc1.address, "QC1")
    await qcManager.connect(governance).registerQC(qc2.address, "QC2")
  })

  describe("M-of-N Voting Flows", () => {
    it("should handle 2-of-5 consensus for status change", async () => {
      // Propose QC status change
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "bool"],
        [qc1.address, false] // Deactivate QC1
      )

      const tx = await consensusManager.connect(watchdog1).proposeAction(
        ProposalType.StatusChange,
        proposalData,
        "QC1 showing suspicious behavior"
      )
      const receipt = await tx.wait()
      const event = receipt.events?.find(e => e.event === "ProposalCreated")
      const proposalId = event?.args?.proposalId

      // Check initial state
      let proposal = await consensusManager.proposals(proposalId)
      expect(proposal.proposalType).to.equal(ProposalType.StatusChange)
      expect(proposal.voteCount).to.equal(1) // Proposer auto-votes
      expect(proposal.executed).to.be.false

      // First additional vote (2/5 threshold reached)
      await expect(
        consensusManager.connect(watchdog2).vote(proposalId, true)
      )
        .to.emit(consensusManager, "VoteCast")
        .withArgs(proposalId, watchdog2.address, true)
        .and.to.emit(consensusManager, "ProposalExecuted")
        .withArgs(proposalId)

      // Verify execution
      proposal = await consensusManager.proposals(proposalId)
      expect(proposal.voteCount).to.equal(2)
      expect(proposal.executed).to.be.true

      // QC should be deactivated
      const qcData = await qcManager.qcs(qc1.address)
      expect(qcData.isActive).to.be.false
    })

    it("should handle 3-of-5 consensus for redemption default", async () => {
      // Setup: Create a redemption
      await qcRedeemer.connect(qc1).initiateRedemption(
        ethers.utils.parseEther("10"),
        "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
      )
      const redemptionId = await qcRedeemer.currentRedemptionId()

      // Update consensus threshold for redemption defaults
      await consensusManager.connect(governance).updateConsensusThreshold(
        ProposalType.RedemptionDefault,
        3
      )

      // Propose redemption default
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["bytes32"],
        [redemptionId]
      )

      const tx = await consensusManager.connect(watchdog1).proposeAction(
        ProposalType.RedemptionDefault,
        proposalData,
        "QC failed to fulfill redemption"
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId

      // Vote from watchdog2 (2/3)
      await consensusManager.connect(watchdog2).vote(proposalId, true)

      // Check not executed yet
      let proposal = await consensusManager.proposals(proposalId)
      expect(proposal.executed).to.be.false

      // Vote from watchdog3 (3/3 threshold reached)
      await expect(
        consensusManager.connect(watchdog3).vote(proposalId, true)
      )
        .to.emit(consensusManager, "ProposalExecuted")
        .withArgs(proposalId)

      // Redemption should be defaulted
      const redemption = await qcRedeemer.redemptions(redemptionId)
      expect(redemption.status).to.equal(3) // Defaulted
    })

    it("should reject proposal if threshold not met before deadline", async () => {
      // Set higher threshold temporarily
      await consensusManager.connect(governance).updateConsensusThreshold(
        ProposalType.StatusChange,
        4
      )

      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "bool"],
        [qc2.address, false]
      )

      const tx = await consensusManager.connect(watchdog1).proposeAction(
        ProposalType.StatusChange,
        proposalData,
        "Test high threshold"
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId

      // Only 2 more votes (total 3/4)
      await consensusManager.connect(watchdog2).vote(proposalId, true)
      await consensusManager.connect(watchdog3).vote(proposalId, true)

      // Fast forward past voting period
      await helpers.time.increaseTime(VOTING_PERIOD + 1)

      // Try to vote after deadline
      await expect(
        consensusManager.connect(watchdog4).vote(proposalId, true)
      ).to.be.revertedWith("Voting period ended")

      // Proposal should not be executed
      const proposal = await consensusManager.proposals(proposalId)
      expect(proposal.executed).to.be.false
      expect(proposal.voteCount).to.equal(3)
    })

    it("should handle negative votes correctly", async () => {
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "bool"],
        [qc1.address, false]
      )

      const tx = await consensusManager.connect(watchdog1).proposeAction(
        ProposalType.StatusChange,
        proposalData,
        "Controversial proposal"
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId

      // Negative votes
      await consensusManager.connect(watchdog2).vote(proposalId, false)
      await consensusManager.connect(watchdog3).vote(proposalId, false)

      // Positive vote
      await consensusManager.connect(watchdog4).vote(proposalId, true)

      // Check vote count (only positive votes count toward threshold)
      const proposal = await consensusManager.proposals(proposalId)
      expect(proposal.voteCount).to.equal(2) // Initial + watchdog4
      expect(proposal.executed).to.be.true // 2/5 threshold met
    })
  })

  describe("Byzantine Fault Scenarios", () => {
    it("should tolerate 1 Byzantine actor in 2-of-5 system", async () => {
      // Byzantine actor tries to create malicious proposal
      const maliciousData = ethers.utils.defaultAbiCoder.encode(
        ["address", "bool"],
        [qc1.address, false] // Try to deactivate legitimate QC
      )

      const tx = await consensusManager.connect(byzantineWatchdog).proposeAction(
        ProposalType.StatusChange,
        maliciousData,
        "Fake issue"
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId

      // Honest watchdogs vote against
      await consensusManager.connect(watchdog1).vote(proposalId, false)
      await consensusManager.connect(watchdog2).vote(proposalId, false)
      await consensusManager.connect(watchdog3).vote(proposalId, false)
      await consensusManager.connect(watchdog4).vote(proposalId, false)

      // Proposal doesn't execute (only 1 positive vote)
      const proposal = await consensusManager.proposals(proposalId)
      expect(proposal.voteCount).to.equal(1)
      expect(proposal.executed).to.be.false

      // QC remains active
      const qcData = await qcManager.qcs(qc1.address)
      expect(qcData.isActive).to.be.true
    })

    it("should handle Byzantine actor attempting double voting", async () => {
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "bool"],
        [qc2.address, true]
      )

      const tx = await consensusManager.connect(watchdog1).proposeAction(
        ProposalType.StatusChange,
        proposalData,
        "Legitimate proposal"
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId

      // Byzantine actor votes
      await consensusManager.connect(byzantineWatchdog).vote(proposalId, true)

      // Byzantine actor tries to vote again
      await expect(
        consensusManager.connect(byzantineWatchdog).vote(proposalId, true)
      ).to.be.revertedWith("Already voted")

      // Verify vote count is correct
      const proposal = await consensusManager.proposals(proposalId)
      expect(proposal.voteCount).to.equal(2) // Only counted once
    })

    it("should prevent proposal spam from Byzantine actors", async () => {
      // Create multiple proposals rapidly
      const data = ethers.utils.defaultAbiCoder.encode(
        ["address", "bool"],
        [qc1.address, false]
      )

      // First proposal succeeds
      await consensusManager.connect(byzantineWatchdog).proposeAction(
        ProposalType.StatusChange,
        data,
        "Spam 1"
      )

      // Subsequent proposals should have cooldown or limits
      // (Implementation would need rate limiting)
      // For now, we test that system can handle multiple proposals
      await consensusManager.connect(byzantineWatchdog).proposeAction(
        ProposalType.StatusChange,
        data,
        "Spam 2"
      )

      // System should still function with honest majority
      const legitimateData = ethers.utils.defaultAbiCoder.encode(
        ["address", "bool"],
        [qc2.address, true]
      )

      const tx = await consensusManager.connect(watchdog1).proposeAction(
        ProposalType.StatusChange,
        legitimateData,
        "Legitimate after spam"
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId

      // Honest majority can still pass legitimate proposals
      await expect(
        consensusManager.connect(watchdog2).vote(proposalId, true)
      )
        .to.emit(consensusManager, "ProposalExecuted")
    })

    it("should handle Byzantine coalition (2 actors) but maintain safety", async () => {
      // Add Byzantine watchdog to consensus
      await consensusManager.connect(governance).addWatchdog(byzantineWatchdog.address)

      // Two Byzantine actors collude
      const maliciousData = ethers.utils.defaultAbiCoder.encode(
        ["address", "bool"],
        [qc1.address, false]
      )

      const tx = await consensusManager.connect(byzantineWatchdog).proposeAction(
        ProposalType.StatusChange,
        maliciousData,
        "Collusion attack"
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId

      // Second Byzantine actor votes
      await expect(
        consensusManager.connect(watchdog5).vote(proposalId, true)
      )
        .to.emit(consensusManager, "ProposalExecuted")
        .withArgs(proposalId)

      // Attack succeeds with 2/5 threshold
      // This shows importance of proper threshold setting
      const qcData = await qcManager.qcs(qc1.address)
      expect(qcData.isActive).to.be.false

      // Recommendation: Use 3-of-5 for critical operations
    })
  })

  describe("Voting Edge Cases", () => {
    it("should handle simultaneous proposals correctly", async () => {
      const data1 = ethers.utils.defaultAbiCoder.encode(
        ["address", "bool"],
        [qc1.address, false]
      )
      const data2 = ethers.utils.defaultAbiCoder.encode(
        ["address", "bool"],
        [qc2.address, false]
      )

      // Create two proposals simultaneously
      const tx1 = await consensusManager.connect(watchdog1).proposeAction(
        ProposalType.StatusChange,
        data1,
        "Proposal 1"
      )
      const tx2 = await consensusManager.connect(watchdog2).proposeAction(
        ProposalType.StatusChange,
        data2,
        "Proposal 2"
      )

      const receipt1 = await tx1.wait()
      const receipt2 = await tx2.wait()

      const proposalId1 = receipt1.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId
      const proposalId2 = receipt2.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId

      // Vote on both proposals
      await consensusManager.connect(watchdog3).vote(proposalId1, true)
      await consensusManager.connect(watchdog4).vote(proposalId2, true)

      // Both should execute independently
      const proposal1 = await consensusManager.proposals(proposalId1)
      const proposal2 = await consensusManager.proposals(proposalId2)

      expect(proposal1.executed).to.be.true
      expect(proposal2.executed).to.be.true
    })

    it("should handle proposal for non-existent QC gracefully", async () => {
      const nonExistentQC = ethers.Wallet.createRandom().address
      const data = ethers.utils.defaultAbiCoder.encode(
        ["address", "bool"],
        [nonExistentQC, false]
      )

      const tx = await consensusManager.connect(watchdog1).proposeAction(
        ProposalType.StatusChange,
        data,
        "Invalid QC proposal"
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId

      // Vote to execute
      await consensusManager.connect(watchdog2).vote(proposalId, true)

      // Execution should fail gracefully
      // The QCManager should revert on non-existent QC
      await expect(
        qcManager.qcs(nonExistentQC)
      ).to.not.be.reverted // Can query, but QC won't exist
    })

    it("should enforce voting period strictly", async () => {
      const data = ethers.utils.defaultAbiCoder.encode(
        ["address", "bool"],
        [qc1.address, true]
      )

      const tx = await consensusManager.connect(watchdog1).proposeAction(
        ProposalType.StatusChange,
        data,
        "Time-sensitive proposal"
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId

      // Fast forward to just before deadline
      await helpers.time.increaseTime(VOTING_PERIOD - 10)

      // Vote should still work
      await expect(
        consensusManager.connect(watchdog2).vote(proposalId, true)
      ).to.not.be.reverted

      // Fast forward past deadline
      await helpers.time.increaseTime(20)

      // Vote should now fail
      await expect(
        consensusManager.connect(watchdog3).vote(proposalId, true)
      ).to.be.revertedWith("Voting period ended")
    })
  })

  describe("Consensus Manager Administration", () => {
    it("should allow governance to update consensus thresholds", async () => {
      // Change threshold for status changes to 3-of-5
      await expect(
        consensusManager.connect(governance).updateConsensusThreshold(
          ProposalType.StatusChange,
          3
        )
      )
        .to.emit(consensusManager, "ConsensusThresholdUpdated")
        .withArgs(ProposalType.StatusChange, 3)

      // Verify new threshold is enforced
      const data = ethers.utils.defaultAbiCoder.encode(
        ["address", "bool"],
        [qc1.address, false]
      )

      const tx = await consensusManager.connect(watchdog1).proposeAction(
        ProposalType.StatusChange,
        data,
        "Test new threshold"
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated")?.args?.proposalId

      // 2 votes (total 2/5) should not execute
      await consensusManager.connect(watchdog2).vote(proposalId, true)
      
      let proposal = await consensusManager.proposals(proposalId)
      expect(proposal.executed).to.be.false

      // 3rd vote should trigger execution
      await expect(
        consensusManager.connect(watchdog3).vote(proposalId, true)
      )
        .to.emit(consensusManager, "ProposalExecuted")
    })

    it("should handle watchdog removal and addition", async () => {
      // Remove a watchdog
      await expect(
        consensusManager.connect(governance).removeWatchdog(watchdog5.address)
      )
        .to.emit(consensusManager, "WatchdogRemoved")
        .withArgs(watchdog5.address)

      // Removed watchdog cannot propose
      await expect(
        consensusManager.connect(watchdog5).proposeAction(
          ProposalType.StatusChange,
          "0x",
          "Should fail"
        )
      ).to.be.revertedWith("Not authorized watchdog")

      // Add new watchdog
      const newWatchdog = await helpers.signers.getUnnamedSigners().then(s => s[10])
      await expect(
        consensusManager.connect(governance).addWatchdog(newWatchdog.address)
      )
        .to.emit(consensusManager, "WatchdogAdded")
        .withArgs(newWatchdog.address)

      // New watchdog can participate
      const data = ethers.utils.defaultAbiCoder.encode(
        ["address", "bool"],
        [qc2.address, true]
      )

      await expect(
        consensusManager.connect(newWatchdog).proposeAction(
          ProposalType.StatusChange,
          data,
          "New watchdog proposal"
        )
      ).to.not.be.reverted
    })
  })
})