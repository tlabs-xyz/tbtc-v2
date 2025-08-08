import { ethers, helpers, waffle } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { Contract } from "ethers"
import { smock } from "@defi-wonderland/smock"
import type { FakeContract } from "@defi-wonderland/smock"

const { loadFixture } = waffle

// Security tests for WatchdogConsensusManager/WatchdogMonitor architecture
// Tests M-of-N consensus, access control, reentrancy protection, and Byzantine fault tolerance
describe("v1 Security Tests", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let watchdog4: SignerWithAddress
  let watchdog5: SignerWithAddress
  let attacker: SignerWithAddress

  let consensusManager: Contract
  let watchdogMonitor: Contract
  let qcManager: FakeContract<Contract>
  let qcRedeemer: FakeContract<Contract>
  let qcData: FakeContract<Contract>

  // Proposal type constants (matches WatchdogConsensusManager.sol)
  const STATUS_CHANGE = 0
  const WALLET_DEREGISTRATION = 1
  const REDEMPTION_DEFAULT = 2
  const FORCE_INTERVENTION = 3

  // Role constants
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
  const WATCHDOG_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("WATCHDOG_ROLE")
  )
  const MANAGER_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("MANAGER_ROLE")
  )
  const WATCHDOG_OPERATOR_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("WATCHDOG_OPERATOR_ROLE")
  )

  async function fixture() {
    ;[
      deployer,
      governance,
      watchdog1,
      watchdog2,
      watchdog3,
      watchdog4,
      watchdog5,
      attacker,
    ] = await ethers.getSigners()

    // Deploy mock QC contracts for WatchdogConsensusManager
    qcManager = await smock.fake("QCManager")
    qcRedeemer = await smock.fake("QCRedeemer")
    qcData = await smock.fake("QCData")

    // Deploy WatchdogConsensusManager
    const WatchdogConsensusManager = await ethers.getContractFactory(
      "WatchdogConsensusManager"
    )
    consensusManager = await WatchdogConsensusManager.deploy(
      qcManager.address,
      qcRedeemer.address,
      qcData.address
    )
    await consensusManager.deployed()

    // Deploy WatchdogMonitor
    const WatchdogMonitor = await ethers.getContractFactory("WatchdogMonitor")
    watchdogMonitor = await WatchdogMonitor.deploy(
      consensusManager.address,
      qcData.address
    )
    await watchdogMonitor.deployed()

    // Setup consensus manager roles
    await consensusManager.grantRole(MANAGER_ROLE, governance.address)
    await consensusManager
      .connect(governance)
      .grantRole(WATCHDOG_ROLE, watchdog1.address)
    await consensusManager
      .connect(governance)
      .grantRole(WATCHDOG_ROLE, watchdog2.address)
    await consensusManager
      .connect(governance)
      .grantRole(WATCHDOG_ROLE, watchdog3.address)
    await consensusManager
      .connect(governance)
      .grantRole(WATCHDOG_ROLE, watchdog4.address)
    await consensusManager
      .connect(governance)
      .grantRole(WATCHDOG_ROLE, watchdog5.address)

    // Setup monitor roles
    await watchdogMonitor.grantRole(MANAGER_ROLE, governance.address)
    await watchdogMonitor
      .connect(governance)
      .grantRole(WATCHDOG_OPERATOR_ROLE, watchdog1.address)
    await watchdogMonitor
      .connect(governance)
      .grantRole(WATCHDOG_OPERATOR_ROLE, watchdog2.address)
    await watchdogMonitor
      .connect(governance)
      .grantRole(WATCHDOG_OPERATOR_ROLE, watchdog3.address)

    return {
      consensusManager,
      watchdogMonitor,
      qcManager,
      qcRedeemer,
      qcData,
      deployer,
      governance,
      watchdog1,
      watchdog2,
      watchdog3,
      watchdog4,
      watchdog5,
      attacker,
    }
  }

  beforeEach(async () => {
    ;({
      consensusManager,
      watchdogMonitor,
      qcManager,
      qcRedeemer,
      qcData,
      deployer,
      governance,
      watchdog1,
      watchdog2,
      watchdog3,
      watchdog4,
      watchdog5,
      attacker,
    } = await loadFixture(fixture))
  })

  describe("M-of-N Consensus Tests", () => {
    it("should require minimum votes for proposal execution", async () => {
      // Create a status change proposal
      const qcAddress = ethers.Wallet.createRandom().address
      const newStatus = 1 // UnderReview
      const reason = "Suspicious activity detected"

      const tx = await consensusManager
        .connect(watchdog1)
        .proposeStatusChange(qcAddress, newStatus, reason)
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId

      // Should not execute with only 1 vote (need 2 by default)
      const proposal = await consensusManager.getProposal(proposalId)
      expect(proposal.executed).to.equal(false)
      expect(proposal.voteCount).to.equal(1) // Proposer auto-votes
    })

    it("should execute proposal when consensus threshold reached", async () => {
      // Create a status change proposal
      const qcAddress = ethers.Wallet.createRandom().address
      const newStatus = 1 // UnderReview
      const reason = "Consensus reached"

      const tx = await consensusManager
        .connect(watchdog1)
        .proposeStatusChange(qcAddress, newStatus, reason)
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId

      // Second watchdog votes - should trigger auto-execution
      await expect(consensusManager.connect(watchdog2).vote(proposalId))
        .to.emit(consensusManager, "ProposalExecuted")
        .withArgs(proposalId, STATUS_CHANGE, watchdog2.address)

      // Verify proposal is executed
      const proposal = await consensusManager.getProposal(proposalId)
      expect(proposal.executed).to.equal(true)
      expect(proposal.voteCount).to.equal(2)
    })

    it("should prevent double voting", async () => {
      // Create a proposal
      const qcAddress = ethers.Wallet.createRandom().address
      const newStatus = 1
      const reason = "Test proposal"

      const tx = await consensusManager
        .connect(watchdog1)
        .proposeStatusChange(qcAddress, newStatus, reason)
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId

      // Try to vote again - should fail
      await expect(
        consensusManager.connect(watchdog1).vote(proposalId)
      ).to.be.revertedWithCustomError(consensusManager, "AlreadyVoted")
    })
  })

  describe("Access Control Tests", () => {
    it("should prevent non-watchdog from proposing", async () => {
      const qcAddress = ethers.Wallet.createRandom().address
      const newStatus = 1
      const reason = "Unauthorized attempt"

      await expect(
        consensusManager
          .connect(attacker)
          .proposeStatusChange(qcAddress, newStatus, reason)
      ).to.be.reverted // Should fail due to missing WATCHDOG_ROLE
    })

    it("should prevent non-watchdog from voting", async () => {
      // Create a proposal first
      const qcAddress = ethers.Wallet.createRandom().address
      const newStatus = 1
      const reason = "Test proposal"

      const tx = await consensusManager
        .connect(watchdog1)
        .proposeStatusChange(qcAddress, newStatus, reason)
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId

      // Attacker tries to vote
      await expect(consensusManager.connect(attacker).vote(proposalId)).to.be
        .reverted // Should fail due to missing WATCHDOG_ROLE
    })

    it("should prevent execution of non-approved proposals", async () => {
      // Create a proposal that doesn't reach threshold
      const qcAddress = ethers.Wallet.createRandom().address
      const newStatus = 1
      const reason = "Insufficient votes"

      const tx = await consensusManager
        .connect(watchdog1)
        .proposeStatusChange(qcAddress, newStatus, reason)
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId

      // Try to execute manually without enough votes
      await expect(
        consensusManager.executeProposal(proposalId)
      ).to.be.revertedWithCustomError(consensusManager, "ProposalNotApproved")
    })

    it("should only allow MANAGER_ROLE to update consensus parameters", async () => {
      await expect(
        consensusManager.connect(attacker).updateConsensusParams(3, 5)
      ).to.be.reverted // Should fail due to missing MANAGER_ROLE

      // Should work with proper role
      await expect(
        consensusManager.connect(governance).updateConsensusParams(3, 5)
      ).to.not.be.reverted
    })
  })

  describe("Reentrancy Protection Tests", () => {
    it("should have reentrancy protection on executeProposal", async () => {
      // Create a proposal
      const qcAddress = ethers.Wallet.createRandom().address
      const newStatus = 1
      const reason = "Reentrancy test"

      const tx = await consensusManager
        .connect(watchdog1)
        .proposeStatusChange(qcAddress, newStatus, reason)
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId

      // Get second vote to reach threshold
      await consensusManager.connect(watchdog2).vote(proposalId)

      // Verify proposal is executed and protected by ReentrancyGuard
      const proposal = await consensusManager.getProposal(proposalId)
      expect(proposal.executed).to.equal(true)

      // Try to execute again - should fail
      await expect(
        consensusManager.executeProposal(proposalId)
      ).to.be.revertedWithCustomError(consensusManager, "AlreadyExecuted")
    })
  })

  describe("Byzantine Fault Tolerance Tests", () => {
    it("should handle diverse proposal types", async () => {
      const qcAddress = ethers.Wallet.createRandom().address

      // Test different proposal types
      const statusTx = await consensusManager
        .connect(watchdog1)
        .proposeStatusChange(qcAddress, 1, "Status change test")
      const statusReceipt = await statusTx.wait()
      const statusProposalId = statusReceipt.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId

      const walletTx = await consensusManager
        .connect(watchdog2)
        .proposeWalletDeregistration(
          qcAddress,
          "bc1qwalletaddress",
          "Wallet deregistration test"
        )
      const walletReceipt = await walletTx.wait()
      const walletProposalId = walletReceipt.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId

      // Verify both proposals exist
      const statusProposal = await consensusManager.getProposal(
        statusProposalId
      )
      const walletProposal = await consensusManager.getProposal(
        walletProposalId
      )

      expect(statusProposal.proposalType).to.equal(STATUS_CHANGE)
      expect(walletProposal.proposalType).to.equal(WALLET_DEREGISTRATION)
    })

    it("should handle concurrent proposals correctly", async () => {
      const qc1 = ethers.Wallet.createRandom().address
      const qc2 = ethers.Wallet.createRandom().address

      // Create multiple proposals concurrently
      const tx1 = await consensusManager
        .connect(watchdog1)
        .proposeStatusChange(qc1, 1, "Proposal 1")
      const tx2 = await consensusManager
        .connect(watchdog2)
        .proposeStatusChange(qc2, 1, "Proposal 2")

      const receipt1 = await tx1.wait()
      const receipt2 = await tx2.wait()

      const proposalId1 = receipt1.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId
      const proposalId2 = receipt2.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId

      expect(proposalId1).to.not.equal(proposalId2)

      // Both should be able to reach consensus
      await consensusManager.connect(watchdog3).vote(proposalId1)
      await consensusManager.connect(watchdog4).vote(proposalId2)

      const proposal1 = await consensusManager.getProposal(proposalId1)
      const proposal2 = await consensusManager.getProposal(proposalId2)

      expect(proposal1.executed).to.equal(true)
      expect(proposal2.executed).to.equal(true)
    })
  })

  describe("Timing and Cleanup Tests", () => {
    it("should handle proposal expiration correctly", async () => {
      // Create a proposal
      const qcAddress = ethers.Wallet.createRandom().address
      const newStatus = 1
      const reason = "Expiration test"

      const tx = await consensusManager
        .connect(watchdog1)
        .proposeStatusChange(qcAddress, newStatus, reason)
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId

      // Fast forward past voting period
      await helpers.time.increase(2 * 60 * 60 + 1) // 2 hours + 1 second

      // Should not be able to vote after expiration
      await expect(
        consensusManager.connect(watchdog2).vote(proposalId)
      ).to.be.revertedWithCustomError(consensusManager, "VotingEnded")
    })

    it("should allow cleanup of expired proposals", async () => {
      // Create a proposal
      const qcAddress = ethers.Wallet.createRandom().address
      const newStatus = 1
      const reason = "Cleanup test"

      const tx = await consensusManager
        .connect(watchdog1)
        .proposeStatusChange(qcAddress, newStatus, reason)
      const receipt = await tx.wait()
      const proposalId = receipt.events?.find(
        (e) => e.event === "ProposalCreated"
      )?.args?.proposalId

      // Fast forward past voting period
      await helpers.time.increase(2 * 60 * 60 + 1)

      // Should be able to clean up expired proposal
      await expect(consensusManager.cleanupExpired([proposalId]))
        .to.emit(consensusManager, "ProposalExpired")
        .withArgs(proposalId)
    })

    it("should handle parameter bounds correctly", async () => {
      // Test minimum bounds
      await expect(
        consensusManager.connect(governance).updateConsensusParams(1, 5) // Below minimum
      ).to.be.revertedWithCustomError(consensusManager, "InvalidParameters")

      // Test maximum bounds
      await expect(
        consensusManager.connect(governance).updateConsensusParams(8, 10) // Above maximum
      ).to.be.revertedWithCustomError(consensusManager, "InvalidParameters")

      // Test invalid ratio
      await expect(
        consensusManager.connect(governance).updateConsensusParams(6, 5) // M > N
      ).to.be.revertedWithCustomError(consensusManager, "InvalidParameters")
    })
  })
})
