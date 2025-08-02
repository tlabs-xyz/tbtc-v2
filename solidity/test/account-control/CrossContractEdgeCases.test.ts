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
  Bank,
  TBTCVault,
  Bridge,
} from "../../typechain"
import { AccountControlTestHelpers } from "./AccountControlTestHelpers"

describe("Cross-Contract Edge Cases", () => {
  let watchdogConsensusManager: WatchdogConsensusManager
  let qcManager: QCManager
  let watchdogMonitor: WatchdogMonitor
  let mintingPolicy: BasicMintingPolicy
  let redemptionPolicy: BasicRedemptionPolicy
  let qcRedeemer: QCRedeemer
  let bank: Bank
  let vault: TBTCVault
  let bridge: Bridge

  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qcAddress: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let watchdog4: SignerWithAddress
  let watchdog5: SignerWithAddress
  let attacker: SignerWithAddress

  let qcProxy: QCWatchdog
  let mockBank: FakeContract<Bank>
  let mockVault: FakeContract<TBTCVault>
  let mockBridge: FakeContract<Bridge>

  const validBtcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
  const validLegacyBtc = "1HLoD9E4SDFFPDiYfNYnkBLQ85Y51J3Zb1"
  const validSegwitBtc = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"

  beforeEach(async () => {
    await deployments.fixture(["AccountControl"])
    
    const accounts = await getNamedAccounts()
    deployer = await ethers.getSigner(accounts.deployer)
    governance = await ethers.getSigner(accounts.governance)
    ;[qcAddress, watchdog1, watchdog2, watchdog3, watchdog4, watchdog5, attacker] = 
      await ethers.getSigners()

    // Get deployed contracts
    watchdogConsensusManager = await ethers.getContract("WatchdogConsensusManager", governance)
    qcManager = await ethers.getContract("QCManager", governance)
    watchdogMonitor = await ethers.getContract("WatchdogMonitor", governance)
    mintingPolicy = await ethers.getContract("BasicMintingPolicy", governance)
    redemptionPolicy = await ethers.getContract("BasicRedemptionPolicy", governance)
    qcRedeemer = await ethers.getContract("QCRedeemer", governance)
    bank = await ethers.getContract("Bank", governance)
    vault = await ethers.getContract("TBTCVault", governance)
    bridge = await ethers.getContract("Bridge", governance)

    // Create mocks for isolated testing
    mockBank = await smock.fake<Bank>("Bank")
    mockVault = await smock.fake<TBTCVault>("TBTCVault")
    mockBridge = await smock.fake<Bridge>("Bridge")

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

  describe("Contract Upgrade Edge Cases", () => {
    it("should maintain state consistency during policy upgrade", async () => {
      // Set capacity in current policy
      await mintingPolicy.connect(governance).setQCCapacity(qcAddress.address, ethers.utils.parseUnits("100", 18))
      
      // Deploy new policy
      const NewPolicyFactory = await ethers.getContractFactory("BasicMintingPolicy")
      const newPolicy = await NewPolicyFactory.deploy()
      await newPolicy.deployed()
      
      // Upgrade should require data migration
      await expect(
        qcManager.connect(governance).setMintingPolicy(newPolicy.address)
      ).to.emit(qcManager, "MintingPolicyUpdated")
      
      // Old capacity should not automatically transfer
      expect(await newPolicy.getQCCapacity(qcAddress.address)).to.equal(0)
    })

    it("should handle mid-operation contract upgrades", async () => {
      // Start a minting operation
      const mintAmount = ethers.utils.parseUnits("10", 18)
      
      // Create proposal
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [mintAmount],
        watchdog1
      )
      
      // Vote but don't execute
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      
      // Upgrade policy mid-operation
      const NewPolicyFactory = await ethers.getContractFactory("BasicMintingPolicy")
      const newPolicy = await NewPolicyFactory.deploy()
      await newPolicy.deployed()
      await qcManager.connect(governance).setMintingPolicy(newPolicy.address)
      
      // Execution should fail gracefully
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.be.reverted
    })
  })

  describe("Reentrancy Protection", () => {
    it("should prevent reentrancy in consensus execution", async () => {
      // Create a proposal
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )
      
      // Vote to reach consensus
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      
      // Wait for time delay
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      // Mock bank to attempt reentrancy
      let executionCount = 0
      mockBank.increaseBalanceAndCall.callsFake(async () => {
        executionCount++
        if (executionCount === 1) {
          // Attempt reentrant call
          await expect(
            watchdogConsensusManager.connect(watchdog1).execute(proposalId)
          ).to.be.revertedWith("ReentrancyGuard: reentrant call")
        }
      })
      
      // Should handle reentrancy attempt gracefully
      await watchdogConsensusManager.connect(watchdog1).execute(proposalId)
    })
  })

  describe("Inter-Contract State Synchronization", () => {
    it("should handle Bank balance updates during concurrent operations", async () => {
      // Setup initial balance
      const initialBalance = ethers.utils.parseUnits("100", 18)
      
      // Set capacity for multiple operations
      await mintingPolicy.connect(governance).setQCCapacity(
        qcAddress.address, 
        ethers.utils.parseUnits("200", 18)
      )
      
      // Create multiple concurrent operations
      const proposals = await Promise.all([
        AccountControlTestHelpers.createProposal(
          watchdogConsensusManager,
          qcProxy,
          "mint",
          [ethers.utils.parseUnits("10", 18)],
          watchdog1
        ),
        AccountControlTestHelpers.createProposal(
          watchdogConsensusManager,
          qcProxy,
          "mint",
          [ethers.utils.parseUnits("20", 18)],
          watchdog2
        ),
      ])
      
      // Vote on both
      for (const proposalId of proposals) {
        await watchdogConsensusManager.connect(watchdog3).vote(proposalId, true)
        await watchdogConsensusManager.connect(watchdog4).vote(proposalId, true)
      }
      
      // Execute both after delay
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      // Track execution results
      const results = []
      for (const proposalId of proposals) {
        try {
          await watchdogConsensusManager.connect(watchdog1).execute(proposalId)
          results.push(true)
        } catch (e) {
          results.push(false)
        }
      }
      
      // At least one should succeed
      expect(results.filter(r => r).length).to.be.gte(1)
    })

    it("should maintain consistency when Bridge updates wallet states", async () => {
      // Register a Bitcoin wallet
      const walletPubKeyHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("wallet1"))
      await qcProxy.connect(qcAddress).registerBitcoinWallet(
        walletPubKeyHash,
        ethers.utils.toUtf8Bytes("spvProof")
      )
      
      // Verify wallet is registered
      const wallets = await qcManager.getQCWallets(qcAddress.address)
      expect(wallets).to.include(walletPubKeyHash)
      
      // Operations should work with valid wallet
      await mintingPolicy.connect(governance).setQCCapacity(
        qcAddress.address,
        ethers.utils.parseUnits("50", 18)
      )
      
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
      
      // Should execute successfully
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.emit(watchdogConsensusManager, "ProposalExecuted")
    })
  })

  describe("Cross-Contract Authorization Edge Cases", () => {
    it("should respect authorization boundaries across contracts", async () => {
      // Attacker should not be able to bypass QC registration
      await expect(
        qcProxy.connect(attacker).mintUsingBank(ethers.utils.parseUnits("10", 18))
      ).to.be.revertedWith("Caller is not the authorized QC")
      
      // Even with direct contract interaction
      await expect(
        bank.connect(attacker).increaseBalanceAndCall(
          attacker.address,
          ethers.utils.parseUnits("10", 18),
          "0x"
        )
      ).to.be.reverted
    })

    it("should handle authorization during emergency pause", async () => {
      // Trigger emergency pause through monitor
      await watchdogMonitor.connect(watchdog1).submitCriticalReport(qcAddress.address, "Critical issue 1")
      await watchdogMonitor.connect(watchdog2).submitCriticalReport(qcAddress.address, "Critical issue 2")
      await watchdogMonitor.connect(watchdog3).submitCriticalReport(qcAddress.address, "Critical issue 3")
      
      // QC should be paused
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.true
      
      // Operations should be blocked
      await expect(
        qcProxy.connect(qcAddress).mintUsingBank(ethers.utils.parseUnits("10", 18))
      ).to.be.reverted
    })
  })

  describe("Multi-Contract Transaction Atomicity", () => {
    it("should rollback all changes on partial failure", async () => {
      // Set up capacity
      await mintingPolicy.connect(governance).setQCCapacity(
        qcAddress.address,
        ethers.utils.parseUnits("100", 18)
      )
      
      // Create proposal that will fail during execution
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("50", 18)],
        watchdog1
      )
      
      // Vote to approve
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      
      // Make bank fail during execution
      const originalBank = await ethers.getContract("Bank")
      await originalBank.updateBridge(ethers.constants.AddressZero) // This will cause mint to fail
      
      // Wait and attempt execution
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      // Should revert
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.be.reverted
      
      // Proposal state should remain unexecuted
      const proposal = await watchdogConsensusManager.proposals(proposalId)
      expect(proposal.executed).to.be.false
    })

    it("should handle gas limit edge cases across contracts", async () => {
      // Create a large operation that consumes significant gas
      const largeAmount = ethers.utils.parseUnits("1000", 18)
      await mintingPolicy.connect(governance).setQCCapacity(qcAddress.address, largeAmount)
      
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [largeAmount],
        watchdog1
      )
      
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      // Should handle within block gas limit
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId, {
          gasLimit: 3000000
        })
      ).to.not.be.reverted
    })
  })

  describe("External Integration Edge Cases", () => {
    it("should handle chain reorganization scenarios", async () => {
      // Create snapshot before operations
      const snapshot = await ethers.provider.send("evm_snapshot", [])
      
      // Perform operations
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )
      
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      
      // Simulate reorg by reverting
      await ethers.provider.send("evm_revert", [snapshot])
      
      // Proposal should not exist
      const proposal = await watchdogConsensusManager.proposals(proposalId)
      expect(proposal.proposer).to.equal(ethers.constants.AddressZero)
    })

    it("should handle timestamp manipulation edge cases", async () => {
      // Create time-sensitive operation
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )
      
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      
      // Try to execute before time delay
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.be.revertedWith("Execution delay not passed")
      
      // Advance time exactly to boundary
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      // Should now execute
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.emit(watchdogConsensusManager, "ProposalExecuted")
    })
  })
})