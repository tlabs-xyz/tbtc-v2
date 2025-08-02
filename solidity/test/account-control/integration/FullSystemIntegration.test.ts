import { expect } from "chai"
import { ethers, deployments, getNamedAccounts } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
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
  TBTCVault,
  TBTC,
  Bridge,
} from "../../../typechain"
import { AccountControlTestHelpers } from "../AccountControlTestHelpers"

describe("Full System Integration Tests", () => {
  let watchdogConsensusManager: WatchdogConsensusManager
  let qcManager: QCManager
  let watchdogMonitor: WatchdogMonitor
  let mintingPolicy: BasicMintingPolicy
  let redemptionPolicy: BasicRedemptionPolicy
  let qcRedeemer: QCRedeemer
  let qcData: QCData
  let systemState: AccountControlSystemState
  let bank: Bank
  let vault: TBTCVault
  let tbtc: TBTC
  let bridge: Bridge

  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qcAddress: SignerWithAddress
  let qcAddress2: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let watchdog4: SignerWithAddress
  let watchdog5: SignerWithAddress
  let user1: SignerWithAddress
  let user2: SignerWithAddress

  let qcProxy: QCWatchdog
  let qcProxy2: QCWatchdog

  const validBtcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
  const validLegacyBtc = "1HLoD9E4SDFFPDiYfNYnkBLQ85Y51J3Zb1"
  const validSegwitBtc = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"

  beforeEach(async () => {
    await deployments.fixture(["AccountControl"])
    
    const accounts = await getNamedAccounts()
    deployer = await ethers.getSigner(accounts.deployer)
    governance = await ethers.getSigner(accounts.governance)
    ;[qcAddress, qcAddress2, watchdog1, watchdog2, watchdog3, watchdog4, watchdog5, user1, user2] = 
      await ethers.getSigners()

    // Get deployed contracts
    watchdogConsensusManager = await ethers.getContract("WatchdogConsensusManager", governance)
    qcManager = await ethers.getContract("QCManager", governance)
    watchdogMonitor = await ethers.getContract("WatchdogMonitor", governance)
    mintingPolicy = await ethers.getContract("BasicMintingPolicy", governance)
    redemptionPolicy = await ethers.getContract("BasicRedemptionPolicy", governance)
    qcRedeemer = await ethers.getContract("QCRedeemer", governance)
    qcData = await ethers.getContract("QCData", governance)
    systemState = await ethers.getContract("AccountControlSystemState", governance)
    bank = await ethers.getContract("Bank", governance)
    vault = await ethers.getContract("TBTCVault", governance)
    tbtc = await ethers.getContract("TBTC", governance)
    bridge = await ethers.getContract("Bridge", governance)

    // Setup QC and watchdogs
    await AccountControlTestHelpers.registerQC(qcManager, qcAddress.address, governance)
    await AccountControlTestHelpers.setupWatchdogs(
      watchdogConsensusManager,
      [watchdog1, watchdog2, watchdog3, watchdog4, watchdog5],
      governance
    )
    
    const proxyAddress = await qcManager.qcProxies(qcAddress.address)
    qcProxy = await ethers.getContractAt("QCWatchdog", proxyAddress) as QCWatchdog
  })

  describe("End-to-End QC Operations Flow", () => {
    it("should handle complete QC lifecycle from registration to redemption", async () => {
      // Step 1: QC Registration and Setup
      expect(await qcManager.isRegisteredQC(qcAddress.address)).to.be.true
      
      // Step 2: Register Bitcoin Wallet
      const walletPubKeyHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("qcWallet1"))
      await qcProxy.connect(qcAddress).registerBitcoinWallet(
        walletPubKeyHash,
        ethers.utils.toUtf8Bytes("spvProof")
      )
      
      // Step 3: Submit Attestation
      const reserves = ethers.utils.parseUnits("100", 18)
      await qcData.connect(governance).updateAttestation(
        qcAddress.address,
        reserves,
        Math.floor(Date.now() / 1000)
      )
      
      // Step 4: Set Minting Capacity
      await mintingPolicy.connect(governance).setQCCapacity(
        qcAddress.address,
        ethers.utils.parseUnits("50", 18)
      )
      
      // Step 5: Create and Execute Minting Proposal
      const mintAmount = ethers.utils.parseUnits("30", 18)
      const mintProposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [mintAmount],
        watchdog1
      )
      
      // Vote on proposal
      await watchdogConsensusManager.connect(watchdog2).vote(mintProposalId, true)
      
      // Wait for delay
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      // Execute minting
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(mintProposalId)
      ).to.emit(watchdogConsensusManager, "ProposalExecuted")
      
      // Verify Bank balance
      const bankBalance = await bank.balanceOf(qcAddress.address)
      expect(bankBalance).to.equal(mintAmount)
      
      // Step 6: User mints tBTC through Vault
      // QC approves vault to use their Bank balance
      await bank.connect(qcAddress).approveBalance(vault.address, mintAmount)
      
      // User can now mint tBTC
      await vault.connect(user1).mint(mintAmount)
      
      // Verify tBTC balance
      const tbtcBalance = await tbtc.balanceOf(user1.address)
      expect(tbtcBalance).to.equal(mintAmount)
      
      // Step 7: Initiate Redemption
      const redeemAmount = ethers.utils.parseUnits("10", 18)
      
      // User approves QCRedeemer
      await tbtc.connect(user1).approve(qcRedeemer.address, redeemAmount)
      
      // QC initiates redemption
      await qcRedeemer.connect(qcAddress).initiateRedemption(
        redeemAmount,
        validBtcAddress
      )
      
      // Step 8: Complete Redemption
      await ethers.provider.send("evm_increaseTime", [86400]) // 24 hours
      await ethers.provider.send("evm_mine", [])
      
      await qcRedeemer.connect(qcAddress).completeRedemption(0)
      
      // Verify redemption completed
      const redemption = await qcRedeemer.redemptions(0)
      expect(redemption.status).to.equal(1) // Completed
    })
  })

  describe("Multi-QC Interaction Scenarios", () => {
    it("should handle multiple QCs operating simultaneously", async () => {
      // Register second QC
      await AccountControlTestHelpers.registerQC(qcManager, qcAddress2.address, governance)
      const proxyAddress2 = await qcManager.qcProxies(qcAddress2.address)
      qcProxy2 = await ethers.getContractAt("QCWatchdog", proxyAddress2) as QCWatchdog
      
      // Set capacities for both QCs
      await mintingPolicy.connect(governance).setQCCapacity(
        qcAddress.address,
        ethers.utils.parseUnits("50", 18)
      )
      await mintingPolicy.connect(governance).setQCCapacity(
        qcAddress2.address,
        ethers.utils.parseUnits("50", 18)
      )
      
      // Create proposals for both QCs
      const proposal1 = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("25", 18)],
        watchdog1
      )
      
      const proposal2 = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy2,
        "mint",
        [ethers.utils.parseUnits("30", 18)],
        watchdog2
      )
      
      // Vote on both proposals
      await watchdogConsensusManager.connect(watchdog3).vote(proposal1, true)
      await watchdogConsensusManager.connect(watchdog4).vote(proposal2, true)
      
      // Execute both after delay
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      await watchdogConsensusManager.connect(watchdog1).execute(proposal1)
      await watchdogConsensusManager.connect(watchdog2).execute(proposal2)
      
      // Verify both QCs have balances
      expect(await bank.balanceOf(qcAddress.address)).to.equal(ethers.utils.parseUnits("25", 18))
      expect(await bank.balanceOf(qcAddress2.address)).to.equal(ethers.utils.parseUnits("30", 18))
    })
  })

  describe("Watchdog Monitoring and Emergency Response", () => {
    it("should handle critical situation detection and response", async () => {
      // Setup QC with minted balance
      await mintingPolicy.connect(governance).setQCCapacity(
        qcAddress.address,
        ethers.utils.parseUnits("100", 18)
      )
      
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
      
      // Simulate critical situation detection
      await watchdogMonitor.connect(watchdog1).submitCriticalReport(
        qcAddress.address,
        "Detected significant reserve discrepancy"
      )
      
      await watchdogMonitor.connect(watchdog2).submitCriticalReport(
        qcAddress.address,
        "Confirmed: reserves below threshold"
      )
      
      await watchdogMonitor.connect(watchdog3).submitCriticalReport(
        qcAddress.address,
        "Triggering emergency pause"
      )
      
      // Verify emergency pause is active
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.true
      
      // QC operations should be blocked
      await expect(
        qcProxy.connect(qcAddress).mintUsingBank(ethers.utils.parseUnits("10", 18))
      ).to.be.reverted
      
      // Governance can resolve the situation
      await watchdogMonitor.connect(governance).clearEmergencyPause(qcAddress.address)
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.false
    })
  })

  describe("Cross-System Integration", () => {
    it("should integrate properly with existing tBTC infrastructure", async () => {
      // Setup QC
      await mintingPolicy.connect(governance).setQCCapacity(
        qcAddress.address,
        ethers.utils.parseUnits("100", 18)
      )
      
      // Mint through consensus
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
      
      // QC approves vault
      await bank.connect(qcAddress).approveBalance(vault.address, ethers.utils.parseUnits("50", 18))
      
      // Multiple users can mint from same QC balance
      await vault.connect(user1).mint(ethers.utils.parseUnits("20", 18))
      await vault.connect(user2).mint(ethers.utils.parseUnits("15", 18))
      
      // Verify tBTC distribution
      expect(await tbtc.balanceOf(user1.address)).to.equal(ethers.utils.parseUnits("20", 18))
      expect(await tbtc.balanceOf(user2.address)).to.equal(ethers.utils.parseUnits("15", 18))
      
      // Verify remaining Bank balance
      expect(await bank.balanceOf(qcAddress.address)).to.equal(ethers.utils.parseUnits("15", 18))
    })
  })

  describe("Stress Testing and Edge Scenarios", () => {
    it("should handle rapid proposal creation and voting", async () => {
      await mintingPolicy.connect(governance).setQCCapacity(
        qcAddress.address,
        ethers.utils.parseUnits("1000", 18)
      )
      
      const proposals = []
      
      // Create multiple proposals rapidly
      for (let i = 0; i < 5; i++) {
        const proposalId = await AccountControlTestHelpers.createProposal(
          watchdogConsensusManager,
          qcProxy,
          "mint",
          [ethers.utils.parseUnits(`${(i + 1) * 10}`, 18)],
          i % 2 === 0 ? watchdog1 : watchdog2
        )
        proposals.push(proposalId)
      }
      
      // Vote on all proposals
      for (let i = 0; i < proposals.length; i++) {
        await watchdogConsensusManager.connect(watchdog3).vote(proposals[i], true)
        if (i % 2 === 0) {
          await watchdogConsensusManager.connect(watchdog4).vote(proposals[i], true)
        }
      }
      
      // Execute all approved proposals
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      let totalMinted = BigNumber.from(0)
      for (const proposalId of proposals) {
        const proposal = await watchdogConsensusManager.proposals(proposalId)
        if (proposal.yesVotes >= 2) {
          await watchdogConsensusManager.connect(watchdog1).execute(proposalId)
          // Extract amount from proposal (this is simplified)
          totalMinted = totalMinted.add(ethers.utils.parseUnits(`${(proposals.indexOf(proposalId) + 1) * 10}`, 18))
        }
      }
      
      // Verify total minted amount
      expect(await bank.balanceOf(qcAddress.address)).to.equal(totalMinted)
    })

    it("should handle system-wide pause during active operations", async () => {
      // Start multiple operations
      await mintingPolicy.connect(governance).setQCCapacity(
        qcAddress.address,
        ethers.utils.parseUnits("100", 18)
      )
      
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("50", 18)],
        watchdog1
      )
      
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      
      // Pause system mid-operation
      await systemState.connect(governance).pauseSystem()
      
      // All operations should be blocked
      await expect(
        watchdogConsensusManager.connect(watchdog3).vote(proposalId, true)
      ).to.be.reverted
      
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.be.reverted
      
      // Unpause and resume
      await systemState.connect(governance).unpauseSystem()
      
      // Operations can now continue
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.emit(watchdogConsensusManager, "ProposalExecuted")
    })
  })

  describe("Governance and Upgrade Scenarios", () => {
    it("should handle policy upgrades gracefully", async () => {
      // Set initial state
      await mintingPolicy.connect(governance).setQCCapacity(
        qcAddress.address,
        ethers.utils.parseUnits("100", 18)
      )
      
      // Create proposal with old policy
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("50", 18)],
        watchdog1
      )
      
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      
      // Deploy and set new policy
      const NewPolicyFactory = await ethers.getContractFactory("BasicMintingPolicy")
      const newPolicy = await NewPolicyFactory.deploy()
      await newPolicy.deployed()
      
      await qcManager.connect(governance).setMintingPolicy(newPolicy.address)
      
      // Migrate state to new policy
      await newPolicy.connect(governance).setQCCapacity(
        qcAddress.address,
        ethers.utils.parseUnits("100", 18)
      )
      
      // Execute proposal with new policy
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.emit(watchdogConsensusManager, "ProposalExecuted")
    })

    it("should handle watchdog configuration changes", async () => {
      // Add new watchdog
      const newWatchdog = user1
      await watchdogConsensusManager.connect(governance).registerWatchdog(newWatchdog.address)
      
      // Remove existing watchdog
      await watchdogConsensusManager.connect(governance).deactivateWatchdog(watchdog5.address)
      
      // Create proposal with new configuration
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )
      
      // New watchdog can vote
      await watchdogConsensusManager.connect(newWatchdog).vote(proposalId, true)
      
      // Deactivated watchdog cannot
      await expect(
        watchdogConsensusManager.connect(watchdog5).vote(proposalId, true)
      ).to.be.revertedWith("Not an active watchdog")
      
      // Execute with new quorum
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.emit(watchdogConsensusManager, "ProposalExecuted")
    })
  })
})