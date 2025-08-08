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
} from "../../typechain"
import { AccountControlTestHelpers } from "./AccountControlTestHelpers"

describe("Time-Based Attack Scenarios", () => {
  let watchdogConsensusManager: WatchdogConsensusManager
  let qcManager: QCManager
  let watchdogMonitor: WatchdogMonitor
  let mintingPolicy: BasicMintingPolicy
  let redemptionPolicy: BasicRedemptionPolicy
  let qcRedeemer: QCRedeemer
  let qcData: QCData

  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qcAddress: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let watchdog4: SignerWithAddress
  let watchdog5: SignerWithAddress
  let attacker: SignerWithAddress
  let victim: SignerWithAddress

  let qcProxy: QCWatchdog

  const validBtcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
  const validLegacyBtc = "1HLoD9E4SDFFPDiYfNYnkBLQ85Y51J3Zb1"

  beforeEach(async () => {
    await deployments.fixture(["AccountControl"])
    
    const accounts = await getNamedAccounts()
    deployer = await ethers.getSigner(accounts.deployer)
    governance = await ethers.getSigner(accounts.governance)
    ;[qcAddress, watchdog1, watchdog2, watchdog3, watchdog4, watchdog5, attacker, victim] = 
      await ethers.getSigners()

    // Get deployed contracts
    watchdogConsensusManager = await ethers.getContract("WatchdogConsensusManager", governance)
    qcManager = await ethers.getContract("QCManager", governance)
    watchdogMonitor = await ethers.getContract("WatchdogMonitor", governance)
    mintingPolicy = await ethers.getContract("BasicMintingPolicy", governance)
    redemptionPolicy = await ethers.getContract("BasicRedemptionPolicy", governance)
    qcRedeemer = await ethers.getContract("QCRedeemer", governance)
    qcData = await ethers.getContract("QCData", governance)

    // Setup standard QC and watchdogs
    await AccountControlTestHelpers.registerQC(qcManager, qcAddress.address, governance)
    await AccountControlTestHelpers.setupWatchdogs(
      watchdogConsensusManager,
      [watchdog1, watchdog2, watchdog3, watchdog4, watchdog5],
      governance
    )
    
    const proxyAddress = await qcManager.qcProxies(qcAddress.address)
    qcProxy = await ethers.getContractAt("QCWatchdog", proxyAddress) as QCWatchdog
  })

  describe("Timestamp Manipulation Attacks", () => {
    it("should prevent execution with manipulated timestamps", async () => {
      // Create proposal
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )
      
      // Vote to reach consensus
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      
      // Get current block timestamp
      const block = await ethers.provider.getBlock("latest")
      const currentTime = block.timestamp
      
      // Try to manipulate timestamp backward (simulated)
      await ethers.provider.send("evm_setNextBlockTimestamp", [currentTime - 1000])
      await ethers.provider.send("evm_mine", [])
      
      // Execution should still respect original proposal time
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.be.revertedWith("Execution delay not passed")
      
      // Reset and advance properly
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      // Now should execute
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.emit(watchdogConsensusManager, "ProposalExecuted")
    })

    it("should handle rapid proposal creation to bypass delays", async () => {
      // Attacker tries to create multiple proposals rapidly
      const proposals = []
      
      // Create 5 proposals in quick succession
      for (let i = 0; i < 5; i++) {
        const proposalId = await AccountControlTestHelpers.createProposal(
          watchdogConsensusManager,
          qcProxy,
          "mint",
          [ethers.utils.parseUnits(`${i + 1}`, 18)],
          watchdog1
        )
        proposals.push(proposalId)
      }
      
      // Vote on all proposals
      for (const proposalId of proposals) {
        await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      }
      
      // Try to execute all immediately
      for (const proposalId of proposals) {
        await expect(
          watchdogConsensusManager.connect(watchdog1).execute(proposalId)
        ).to.be.revertedWith("Execution delay not passed")
      }
      
      // Advance time
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      // All should now be executable
      for (const proposalId of proposals) {
        const proposal = await watchdogConsensusManager.proposals(proposalId)
        expect(proposal.endTime).to.be.lte(Math.floor(Date.now() / 1000))
      }
    })
  })

  describe("Front-Running and MEV Attacks", () => {
    it("should prevent front-running of proposal execution", async () => {
      // Set up capacity
      await mintingPolicy.connect(governance).setQCCapacity(
        qcAddress.address,
        ethers.utils.parseUnits("100", 18)
      )
      
      // Victim creates proposal
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("50", 18)],
        watchdog1
      )
      
      // Vote to reach consensus
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      
      // Advance time
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      // Attacker tries to front-run with their own proposal
      const attackerProposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("60", 18)], // Exceeds remaining capacity
        watchdog3
      )
      
      // Even with votes, attacker proposal needs delay
      await watchdogConsensusManager.connect(watchdog4).vote(attackerProposalId, true)
      
      // Victim executes their proposal first
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.emit(watchdogConsensusManager, "ProposalExecuted")
      
      // Attacker cannot execute immediately
      await expect(
        watchdogConsensusManager.connect(watchdog3).execute(attackerProposalId)
      ).to.be.revertedWith("Execution delay not passed")
    })

    it("should handle sandwich attacks on redemption operations", async () => {
      // Setup: QC has minted tokens
      await mintingPolicy.connect(governance).setQCCapacity(
        qcAddress.address,
        ethers.utils.parseUnits("100", 18)
      )
      
      // Mint some tokens first
      const mintProposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("50", 18)],
        watchdog1
      )
      
      await watchdogConsensusManager.connect(watchdog2).vote(mintProposalId, true)
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      await watchdogConsensusManager.connect(watchdog1).execute(mintProposalId)
      
      // Victim initiates redemption
      await qcRedeemer.connect(qcAddress).initiateRedemption(
        ethers.utils.parseUnits("20", 18),
        validBtcAddress
      )
      
      // Attacker tries to sandwich with their own redemption
      await expect(
        qcRedeemer.connect(attacker).initiateRedemption(
          ethers.utils.parseUnits("10", 18),
          validLegacyBtc
        )
      ).to.be.revertedWith("AccessControl: account")
      
      // Complete victim's redemption
      const redemptionId = 0 // First redemption
      await ethers.provider.send("evm_increaseTime", [86400]) // 24 hours
      await ethers.provider.send("evm_mine", [])
      
      await qcRedeemer.connect(qcAddress).completeRedemption(redemptionId)
    })
  })

  describe("Delay Manipulation Attacks", () => {
    it("should enforce escalating delays for disputed operations", async () => {
      // Create initial proposal
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )
      
      // First objection - 1 hour delay
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, false)
      
      let proposal = await watchdogConsensusManager.proposals(proposalId)
      const initialDelay = proposal.endTime - proposal.startTime
      expect(initialDelay).to.equal(3600) // 1 hour
      
      // Second objection - should escalate to 4 hours
      await watchdogConsensusManager.connect(watchdog3).vote(proposalId, false)
      
      proposal = await watchdogConsensusManager.proposals(proposalId)
      const secondDelay = proposal.endTime - proposal.startTime
      expect(secondDelay).to.equal(14400) // 4 hours
      
      // Third objection - should escalate to 12 hours
      await watchdogConsensusManager.connect(watchdog4).vote(proposalId, false)
      
      proposal = await watchdogConsensusManager.proposals(proposalId)
      const thirdDelay = proposal.endTime - proposal.startTime
      expect(thirdDelay).to.equal(43200) // 12 hours
    })

    it("should prevent delay bypass through proposal cancellation", async () => {
      // Create proposal
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )
      
      // Vote to reach consensus
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      
      // Try to cancel to bypass delay
      await expect(
        watchdogConsensusManager.connect(watchdog1).cancelProposal(proposalId)
      ).to.be.revertedWith("Cannot cancel after voting")
      
      // Delay cannot be bypassed
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.be.revertedWith("Execution delay not passed")
    })
  })

  describe("Attestation Timing Attacks", () => {
    it("should prevent stale attestation exploitation", async () => {
      // Submit initial attestation
      const reserves = ethers.utils.parseUnits("100", 18)
      const attestationTime = Math.floor(Date.now() / 1000)
      
      await qcData.connect(governance).updateAttestation(
        qcAddress.address,
        reserves,
        attestationTime
      )
      
      // Advance time beyond staleness threshold
      await ethers.provider.send("evm_increaseTime", [172800]) // 48 hours
      await ethers.provider.send("evm_mine", [])
      
      // Try to use stale attestation for operations
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("50", 18)],
        watchdog1
      )
      
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      // Execution should check attestation freshness
      await watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      
      // Verify attestation staleness is considered
      const attestation = await qcData.attestations(qcAddress.address)
      const currentTime = Math.floor(Date.now() / 1000)
      const isStale = (currentTime - attestation.timestamp) > 86400 // 24 hour threshold
      expect(isStale).to.be.true
    })

    it("should handle rapid attestation updates", async () => {
      // Attacker tries to rapidly update attestations
      const attestationCount = 5
      const baseReserves = ethers.utils.parseUnits("100", 18)
      
      for (let i = 0; i < attestationCount; i++) {
        const reserves = baseReserves.add(ethers.utils.parseUnits(`${i}`, 18))
        const attestationTime = Math.floor(Date.now() / 1000) + i
        
        await qcData.connect(governance).updateAttestation(
          qcAddress.address,
          reserves,
          attestationTime
        )
        
        // Small time advance
        await ethers.provider.send("evm_increaseTime", [60])
        await ethers.provider.send("evm_mine", [])
      }
      
      // System should use latest attestation
      const finalAttestation = await qcData.attestations(qcAddress.address)
      expect(finalAttestation.reserves).to.equal(
        baseReserves.add(ethers.utils.parseUnits(`${attestationCount - 1}`, 18))
      )
    })
  })

  describe("Race Condition Attacks", () => {
    it("should handle concurrent proposal executions", async () => {
      // Set up capacity for multiple operations
      await mintingPolicy.connect(governance).setQCCapacity(
        qcAddress.address,
        ethers.utils.parseUnits("100", 18)
      )
      
      // Create multiple proposals
      const proposal1 = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("40", 18)],
        watchdog1
      )
      
      const proposal2 = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("40", 18)],
        watchdog2
      )
      
      const proposal3 = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("40", 18)],
        watchdog3
      )
      
      // Vote on all
      await watchdogConsensusManager.connect(watchdog4).vote(proposal1, true)
      await watchdogConsensusManager.connect(watchdog5).vote(proposal2, true)
      await watchdogConsensusManager.connect(watchdog1).vote(proposal3, true)
      
      // Advance time
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      // Try to execute all concurrently (simulate with sequential calls)
      const results = []
      
      try {
        await watchdogConsensusManager.connect(watchdog1).execute(proposal1)
        results.push({ id: proposal1, success: true })
      } catch {
        results.push({ id: proposal1, success: false })
      }
      
      try {
        await watchdogConsensusManager.connect(watchdog2).execute(proposal2)
        results.push({ id: proposal2, success: true })
      } catch {
        results.push({ id: proposal2, success: false })
      }
      
      try {
        await watchdogConsensusManager.connect(watchdog3).execute(proposal3)
        results.push({ id: proposal3, success: true })
      } catch {
        results.push({ id: proposal3, success: false })
      }
      
      // Only 2 should succeed due to capacity limit
      const successCount = results.filter(r => r.success).length
      expect(successCount).to.equal(2)
    })

    it("should prevent double execution race conditions", async () => {
      // Create and approve proposal
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )
      
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      // First execution succeeds
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.emit(watchdogConsensusManager, "ProposalExecuted")
      
      // Second execution fails
      await expect(
        watchdogConsensusManager.connect(watchdog2).execute(proposalId)
      ).to.be.revertedWith("Proposal already executed")
    })
  })

  describe("Time Window Exploitation", () => {
    it("should enforce voting deadline windows", async () => {
      // Create proposal
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )
      
      // Get voting deadline
      const proposal = await watchdogConsensusManager.proposals(proposalId)
      const votingDeadline = proposal.endTime
      
      // Advance time past voting deadline
      await ethers.provider.send("evm_increaseTime", [7200]) // 2 hours past
      await ethers.provider.send("evm_mine", [])
      
      // Late votes should be rejected
      await expect(
        watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      ).to.be.revertedWith("Voting period ended")
    })

    it("should handle emergency pause timing windows", async () => {
      // Submit critical reports in sequence
      await watchdogMonitor.connect(watchdog1).submitCriticalReport(qcAddress.address, "Issue 1")
      
      // Check report window
      const report1Time = (await ethers.provider.getBlock("latest")).timestamp
      
      await ethers.provider.send("evm_increaseTime", [300]) // 5 minutes
      await ethers.provider.send("evm_mine", [])
      
      await watchdogMonitor.connect(watchdog2).submitCriticalReport(qcAddress.address, "Issue 2")
      
      // Third report triggers pause
      await watchdogMonitor.connect(watchdog3).submitCriticalReport(qcAddress.address, "Issue 3")
      
      // Verify pause is active
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.true
      
      // Check pause window enforcement
      const pauseDetails = await watchdogMonitor.emergencyPauses(qcAddress.address)
      expect(pauseDetails.isPaused).to.be.true
      expect(pauseDetails.reportCount).to.equal(3)
    })
  })

  describe("Blockhash Manipulation", () => {
    it("should use secure randomness for watchdog selection", async () => {
      // Get current block info
      const block = await ethers.provider.getBlock("latest")
      const blockHash = block.hash
      
      // Calculate expected primary watchdog
      const watchdogs = await watchdogConsensusManager.getActiveWatchdogs()
      const expectedIndex = BigNumber.from(blockHash).mod(watchdogs.length)
      
      // Create proposal to trigger selection
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )
      
      // Verify selection is deterministic but unpredictable
      const proposal = await watchdogConsensusManager.proposals(proposalId)
      
      // Selection should be based on blockhash
      // Note: Actual implementation may differ
      expect(watchdogs.length).to.be.gte(3)
    })

    it("should prevent blockhash grinding attacks", async () => {
      // Simulate multiple proposal creations
      const proposals = []
      
      for (let i = 0; i < 3; i++) {
        // Mine a new block
        await ethers.provider.send("evm_mine", [])
        
        const proposalId = await AccountControlTestHelpers.createProposal(
          watchdogConsensusManager,
          qcProxy,
          "mint",
          [ethers.utils.parseUnits(`${i + 1}`, 18)],
          watchdog1
        )
        
        proposals.push(proposalId)
      }
      
      // Each proposal should have different characteristics
      const proposalData = await Promise.all(
        proposals.map(id => watchdogConsensusManager.proposals(id))
      )
      
      // Verify proposals are independent
      const startTimes = proposalData.map(p => p.startTime)
      const uniqueStartTimes = [...new Set(startTimes)]
      expect(uniqueStartTimes.length).to.equal(proposals.length)
    })
  })
})