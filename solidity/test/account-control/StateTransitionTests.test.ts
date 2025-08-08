import { expect } from "chai"
import { ethers, deployments, getNamedAccounts } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import { BigNumber } from "ethers"
import type {
  WatchdogConsensusManager,
  QCManager,
  WatchdogMonitor,
  QCWatchdog,
  BasicMintingPolicy,
  BasicRedemptionPolicy,
  QCRedeemer,
  QCData,
  AccountControlSystemState,
  Bank,
} from "../../typechain"
import { AccountControlTestHelpers } from "./AccountControlTestHelpers"

describe("State Transition Tests", () => {
  let watchdogConsensusManager: WatchdogConsensusManager
  let qcManager: QCManager
  let watchdogMonitor: WatchdogMonitor
  let mintingPolicy: BasicMintingPolicy
  let redemptionPolicy: BasicRedemptionPolicy
  let qcRedeemer: QCRedeemer
  let qcData: QCData
  let systemState: AccountControlSystemState
  let bank: Bank

  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qcAddress: SignerWithAddress
  let qcAddress2: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let watchdog4: SignerWithAddress
  let watchdog5: SignerWithAddress
  let user: SignerWithAddress

  let qcProxy: QCWatchdog
  let qcProxy2: QCWatchdog

  const validBtcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
  const validLegacyBtc = "1HLoD9E4SDFFPDiYfNYnkBLQ85Y51J3Zb1"

  // State enums
  enum ProposalState {
    Pending = 0,
    Active = 1,
    Approved = 2,
    Executed = 3,
    Rejected = 4,
    Cancelled = 5,
  }

  enum QCState {
    NotRegistered = 0,
    Active = 1,
    Paused = 2,
    Suspended = 3,
    Deactivated = 4,
  }

  enum RedemptionState {
    Initiated = 0,
    Completed = 1,
    TimedOut = 2,
    Disputed = 3,
  }

  beforeEach(async () => {
    await deployments.fixture(["AccountControl"])

    const accounts = await getNamedAccounts()
    deployer = await ethers.getSigner(accounts.deployer)
    governance = await ethers.getSigner(accounts.governance)
    ;[
      qcAddress,
      qcAddress2,
      watchdog1,
      watchdog2,
      watchdog3,
      watchdog4,
      watchdog5,
      user,
    ] = await ethers.getSigners()

    // Get deployed contracts
    watchdogConsensusManager = await ethers.getContract(
      "WatchdogConsensusManager",
      governance
    )
    qcManager = await ethers.getContract("QCManager", governance)
    watchdogMonitor = await ethers.getContract("WatchdogMonitor", governance)
    mintingPolicy = await ethers.getContract("BasicMintingPolicy", governance)
    redemptionPolicy = await ethers.getContract(
      "BasicRedemptionPolicy",
      governance
    )
    qcRedeemer = await ethers.getContract("QCRedeemer", governance)
    qcData = await ethers.getContract("QCData", governance)
    systemState = await ethers.getContract(
      "AccountControlSystemState",
      governance
    )
    bank = await ethers.getContract("Bank", governance)

    // Setup QC and watchdogs
    await AccountControlTestHelpers.registerQC(
      qcManager,
      qcAddress.address,
      governance
    )
    await AccountControlTestHelpers.setupWatchdogs(
      watchdogConsensusManager,
      [watchdog1, watchdog2, watchdog3, watchdog4, watchdog5],
      governance
    )

    const proxyAddress = await qcManager.qcProxies(qcAddress.address)
    qcProxy = (await ethers.getContractAt(
      "QCWatchdog",
      proxyAddress
    )) as QCWatchdog
  })

  describe("Proposal State Transitions", () => {
    it("should handle complete proposal lifecycle", async () => {
      // State: None -> Pending
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )

      let proposal = await watchdogConsensusManager.proposals(proposalId)
      expect(proposal.executed).to.be.false
      expect(proposal.yesVotes).to.equal(1) // Proposer auto-votes

      // State: Pending -> Active (after first external vote)
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)

      proposal = await watchdogConsensusManager.proposals(proposalId)
      expect(proposal.yesVotes).to.equal(2)
      expect(proposal.executed).to.be.false

      // State: Active -> Approved (consensus reached but delay not passed)
      // Already approved with 2/5 votes

      // Cannot execute before delay
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.be.revertedWith("Execution delay not passed")

      // State: Approved -> Executed
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])

      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.emit(watchdogConsensusManager, "ProposalExecuted")

      proposal = await watchdogConsensusManager.proposals(proposalId)
      expect(proposal.executed).to.be.true

      // Cannot re-execute
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.be.revertedWith("Proposal already executed")
    })

    it("should handle proposal rejection flow", async () => {
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )

      // Vote against
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, false)
      await watchdogConsensusManager.connect(watchdog3).vote(proposalId, false)
      await watchdogConsensusManager.connect(watchdog4).vote(proposalId, false)

      const proposal = await watchdogConsensusManager.proposals(proposalId)
      expect(proposal.noVotes).to.equal(3)

      // With 3/5 against, proposal is rejected
      // Advance time past voting period
      await ethers.provider.send("evm_increaseTime", [86400])
      await ethers.provider.send("evm_mine", [])

      // Cannot execute rejected proposal
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.be.revertedWith("Proposal not approved")
    })

    it("should handle proposal cancellation", async () => {
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )

      // Can cancel before external votes
      await watchdogConsensusManager
        .connect(watchdog1)
        .cancelProposal(proposalId)

      // Cannot vote on cancelled proposal
      await expect(
        watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      ).to.be.revertedWith("Proposal cancelled")

      // Cannot execute cancelled proposal
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.be.revertedWith("Proposal cancelled")
    })

    it("should handle proposal expiration", async () => {
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )

      // Don't vote, let it expire
      await ethers.provider.send("evm_increaseTime", [604800]) // 7 days
      await ethers.provider.send("evm_mine", [])

      // Cannot vote on expired proposal
      await expect(
        watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      ).to.be.revertedWith("Voting period ended")

      // Cannot execute expired proposal without consensus
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.be.revertedWith("Proposal not approved")
    })
  })

  describe("QC State Transitions", () => {
    it("should handle QC lifecycle states", async () => {
      // State: NotRegistered -> Active (done in beforeEach)
      const isRegistered = await qcManager.isRegisteredQC(qcAddress.address)
      expect(isRegistered).to.be.true

      // State: Active -> Paused (via emergency)
      await watchdogMonitor
        .connect(watchdog1)
        .submitCriticalReport(qcAddress.address, "Critical 1")
      await watchdogMonitor
        .connect(watchdog2)
        .submitCriticalReport(qcAddress.address, "Critical 2")
      await watchdogMonitor
        .connect(watchdog3)
        .submitCriticalReport(qcAddress.address, "Critical 3")

      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be
        .true

      // Operations blocked while paused
      await expect(
        qcProxy
          .connect(qcAddress)
          .mintUsingBank(ethers.utils.parseUnits("10", 18))
      ).to.be.reverted

      // State: Paused -> Active (unpause)
      await watchdogMonitor
        .connect(governance)
        .clearEmergencyPause(qcAddress.address)
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be
        .false

      // State: Active -> Suspended (governance action)
      await qcManager.connect(governance).pauseQC(qcAddress.address)

      // State: Suspended -> Deactivated
      await qcManager.connect(governance).deactivateQC(qcAddress.address)

      // Cannot operate when deactivated
      await expect(
        qcProxy
          .connect(qcAddress)
          .mintUsingBank(ethers.utils.parseUnits("10", 18))
      ).to.be.reverted
    })

    it("should handle QC state during ongoing operations", async () => {
      // Set capacity
      await mintingPolicy
        .connect(governance)
        .setQCCapacity(qcAddress.address, ethers.utils.parseUnits("100", 18))

      // Start operation
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("50", 18)],
        watchdog1
      )

      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)

      // Pause QC while operation pending
      await qcManager.connect(governance).pauseQC(qcAddress.address)

      // Advance time
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])

      // Execution should fail due to paused state
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.be.reverted
    })
  })

  describe("Redemption State Transitions", () => {
    it("should handle complete redemption lifecycle", async () => {
      // Setup: QC mints tokens first
      await mintingPolicy
        .connect(governance)
        .setQCCapacity(qcAddress.address, ethers.utils.parseUnits("100", 18))

      const mintProposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("50", 18)],
        watchdog1
      )

      await watchdogConsensusManager
        .connect(watchdog2)
        .vote(mintProposalId, true)
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      await watchdogConsensusManager.connect(watchdog1).execute(mintProposalId)

      // State: None -> Initiated
      await qcRedeemer
        .connect(qcAddress)
        .initiateRedemption(ethers.utils.parseUnits("20", 18), validBtcAddress)

      const redemptionId = 0
      let redemption = await qcRedeemer.redemptions(redemptionId)
      expect(redemption.status).to.equal(RedemptionState.Initiated)

      // State: Initiated -> Completed
      await ethers.provider.send("evm_increaseTime", [86400]) // 24 hours
      await ethers.provider.send("evm_mine", [])

      await qcRedeemer.connect(qcAddress).completeRedemption(redemptionId)

      redemption = await qcRedeemer.redemptions(redemptionId)
      expect(redemption.status).to.equal(RedemptionState.Completed)

      // Cannot complete again
      await expect(
        qcRedeemer.connect(qcAddress).completeRedemption(redemptionId)
      ).to.be.revertedWith("Invalid redemption status")
    })

    it("should handle redemption timeout flow", async () => {
      // Setup minting
      await mintingPolicy
        .connect(governance)
        .setQCCapacity(qcAddress.address, ethers.utils.parseUnits("100", 18))

      const mintProposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("50", 18)],
        watchdog1
      )

      await watchdogConsensusManager
        .connect(watchdog2)
        .vote(mintProposalId, true)
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      await watchdogConsensusManager.connect(watchdog1).execute(mintProposalId)

      // Initiate redemption
      await qcRedeemer
        .connect(qcAddress)
        .initiateRedemption(ethers.utils.parseUnits("20", 18), validBtcAddress)

      const redemptionId = 0

      // State: Initiated -> TimedOut
      await ethers.provider.send("evm_increaseTime", [86401]) // Past timeout
      await ethers.provider.send("evm_mine", [])

      await qcRedeemer.connect(governance).handleRedemptionTimeout(redemptionId)

      const redemption = await qcRedeemer.redemptions(redemptionId)
      expect(redemption.status).to.equal(RedemptionState.TimedOut)
    })
  })

  describe("Watchdog State Transitions", () => {
    it("should handle watchdog activation and deactivation", async () => {
      // Add new watchdog
      const newWatchdog = user

      // State: Inactive -> Active
      await watchdogConsensusManager
        .connect(governance)
        .registerWatchdog(newWatchdog.address)

      let watchdogs = await watchdogConsensusManager.getActiveWatchdogs()
      expect(watchdogs).to.include(newWatchdog.address)

      // New watchdog can participate
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )

      await expect(
        watchdogConsensusManager.connect(newWatchdog).vote(proposalId, true)
      ).to.emit(watchdogConsensusManager, "VoteCast")

      // State: Active -> Inactive
      await watchdogConsensusManager
        .connect(governance)
        .deactivateWatchdog(newWatchdog.address)

      watchdogs = await watchdogConsensusManager.getActiveWatchdogs()
      expect(watchdogs).to.not.include(newWatchdog.address)

      // Cannot vote when inactive
      const proposalId2 = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("5", 18)],
        watchdog1
      )

      await expect(
        watchdogConsensusManager.connect(newWatchdog).vote(proposalId2, true)
      ).to.be.revertedWith("Not an active watchdog")
    })

    it("should handle watchdog transitions during active proposals", async () => {
      // Create proposal with all watchdogs
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )

      // Some watchdogs vote
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)

      // Deactivate a watchdog who hasn't voted
      await watchdogConsensusManager
        .connect(governance)
        .deactivateWatchdog(watchdog5.address)

      // Deactivated watchdog cannot vote
      await expect(
        watchdogConsensusManager.connect(watchdog5).vote(proposalId, true)
      ).to.be.revertedWith("Not an active watchdog")

      // But proposal can still reach consensus with remaining watchdogs
      // Already have 2/4 votes which is enough

      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])

      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.emit(watchdogConsensusManager, "ProposalExecuted")
    })
  })

  describe("System-Wide State Transitions", () => {
    it("should handle system pause and unpause", async () => {
      // System starts unpaused
      expect(await systemState.isSystemPaused()).to.be.false

      // Create ongoing operations
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )

      // Pause system
      await systemState.connect(governance).pauseSystem()
      expect(await systemState.isSystemPaused()).to.be.true

      // Operations blocked
      await expect(
        watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      ).to.be.reverted

      // Unpause system
      await systemState.connect(governance).unpauseSystem()
      expect(await systemState.isSystemPaused()).to.be.false

      // Operations resume
      await expect(
        watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      ).to.emit(watchdogConsensusManager, "VoteCast")
    })

    it("should handle state consistency across contract upgrades", async () => {
      // Set some state
      await mintingPolicy
        .connect(governance)
        .setQCCapacity(qcAddress.address, ethers.utils.parseUnits("100", 18))

      const capacity = await mintingPolicy.getQCCapacity(qcAddress.address)

      // Create proposal
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("50", 18)],
        watchdog1
      )

      // Deploy new policy (simulating upgrade)
      const NewPolicyFactory = await ethers.getContractFactory(
        "BasicMintingPolicy"
      )
      const newPolicy = await NewPolicyFactory.deploy()
      await newPolicy.deployed()

      // Upgrade
      await qcManager.connect(governance).setMintingPolicy(newPolicy.address)

      // Old state is not automatically migrated
      const newCapacity = await newPolicy.getQCCapacity(qcAddress.address)
      expect(newCapacity).to.equal(0)

      // Pending operations may fail due to state mismatch
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])

      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.be.reverted // Due to 0 capacity in new policy
    })
  })

  describe("Complex State Interaction Scenarios", () => {
    it("should handle multiple simultaneous state changes", async () => {
      // Register second QC
      await AccountControlTestHelpers.registerQC(
        qcManager,
        qcAddress2.address,
        governance
      )
      const proxyAddress2 = await qcManager.qcProxies(qcAddress2.address)
      qcProxy2 = (await ethers.getContractAt(
        "QCWatchdog",
        proxyAddress2
      )) as QCWatchdog

      // Set capacities
      await mintingPolicy
        .connect(governance)
        .setQCCapacity(qcAddress.address, ethers.utils.parseUnits("100", 18))
      await mintingPolicy
        .connect(governance)
        .setQCCapacity(qcAddress2.address, ethers.utils.parseUnits("100", 18))

      // Create proposals for both QCs
      const proposal1 = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("50", 18)],
        watchdog1
      )

      const proposal2 = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy2,
        "mint",
        [ethers.utils.parseUnits("30", 18)],
        watchdog2
      )

      // Vote on first proposal
      await watchdogConsensusManager.connect(watchdog3).vote(proposal1, true)

      // Pause first QC
      await qcManager.connect(governance).pauseQC(qcAddress.address)

      // Vote on second proposal
      await watchdogConsensusManager.connect(watchdog4).vote(proposal2, true)

      // Deactivate a watchdog
      await watchdogConsensusManager
        .connect(governance)
        .deactivateWatchdog(watchdog5.address)

      // Advance time
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])

      // First proposal execution fails (QC paused)
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposal1)
      ).to.be.reverted

      // Second proposal execution succeeds
      await expect(
        watchdogConsensusManager.connect(watchdog2).execute(proposal2)
      ).to.emit(watchdogConsensusManager, "ProposalExecuted")
    })

    it("should maintain state invariants during edge transitions", async () => {
      // Set up initial state
      await mintingPolicy
        .connect(governance)
        .setQCCapacity(qcAddress.address, ethers.utils.parseUnits("100", 18))

      // Create and execute mint
      const mintProposal = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("50", 18)],
        watchdog1
      )

      await watchdogConsensusManager.connect(watchdog2).vote(mintProposal, true)
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      await watchdogConsensusManager.connect(watchdog1).execute(mintProposal)

      // Check Bank balance increased
      const bankBalance = await bank.balanceOf(qcAddress.address)
      expect(bankBalance).to.equal(ethers.utils.parseUnits("50", 18))

      // Initiate redemption
      await qcRedeemer
        .connect(qcAddress)
        .initiateRedemption(ethers.utils.parseUnits("20", 18), validBtcAddress)

      // Try to pause QC during redemption
      await qcManager.connect(governance).pauseQC(qcAddress.address)

      // Redemption should still be processable by arbiter
      await ethers.provider.send("evm_increaseTime", [86401])
      await ethers.provider.send("evm_mine", [])

      await qcRedeemer.connect(governance).handleRedemptionTimeout(0)

      // Verify state consistency
      const redemption = await qcRedeemer.redemptions(0)
      expect(redemption.status).to.equal(RedemptionState.TimedOut)
    })
  })
})
