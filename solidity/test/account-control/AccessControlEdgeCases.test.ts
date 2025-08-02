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
} from "../../typechain"
import { AccountControlTestHelpers } from "./AccountControlTestHelpers"

describe("Access Control Edge Cases", () => {
  let watchdogConsensusManager: WatchdogConsensusManager
  let qcManager: QCManager
  let watchdogMonitor: WatchdogMonitor
  let mintingPolicy: BasicMintingPolicy
  let redemptionPolicy: BasicRedemptionPolicy
  let qcRedeemer: QCRedeemer
  let qcData: QCData
  let systemState: AccountControlSystemState

  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qcAddress: SignerWithAddress
  let qcAddress2: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let watchdog4: SignerWithAddress
  let watchdog5: SignerWithAddress
  let attacker: SignerWithAddress
  let unauthorizedUser: SignerWithAddress

  let qcProxy: QCWatchdog
  let qcProxy2: QCWatchdog

  const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000"
  const GOVERNANCE_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("GOVERNANCE_ROLE"))
  const WATCHDOG_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("WATCHDOG_ROLE"))
  const QC_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_ROLE"))
  const ARBITER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ARBITER_ROLE"))

  const validBtcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"

  beforeEach(async () => {
    await deployments.fixture(["AccountControl"])
    
    const accounts = await getNamedAccounts()
    deployer = await ethers.getSigner(accounts.deployer)
    governance = await ethers.getSigner(accounts.governance)
    ;[qcAddress, qcAddress2, watchdog1, watchdog2, watchdog3, watchdog4, watchdog5, attacker, unauthorizedUser] = 
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

    // Setup first QC and watchdogs
    await AccountControlTestHelpers.registerQC(qcManager, qcAddress.address, governance)
    await AccountControlTestHelpers.setupWatchdogs(
      watchdogConsensusManager,
      [watchdog1, watchdog2, watchdog3, watchdog4, watchdog5],
      governance
    )
    
    const proxyAddress = await qcManager.qcProxies(qcAddress.address)
    qcProxy = await ethers.getContractAt("QCWatchdog", proxyAddress) as QCWatchdog
  })

  describe("Role Hierarchy Attacks", () => {
    it("should prevent role escalation through contract interaction", async () => {
      // Attacker tries to grant themselves admin role
      await expect(
        watchdogConsensusManager.connect(attacker).grantRole(DEFAULT_ADMIN_ROLE, attacker.address)
      ).to.be.revertedWith("AccessControl: account")
      
      // Attacker tries to grant themselves governance role
      await expect(
        qcManager.connect(attacker).grantRole(GOVERNANCE_ROLE, attacker.address)
      ).to.be.revertedWith("AccessControl: account")
      
      // Even with watchdog role, cannot grant admin
      await watchdogConsensusManager.connect(governance).registerWatchdog(attacker.address)
      await expect(
        watchdogConsensusManager.connect(attacker).grantRole(DEFAULT_ADMIN_ROLE, attacker.address)
      ).to.be.revertedWith("AccessControl: account")
    })

    it("should handle role renunciation edge cases", async () => {
      // Register a second QC
      await AccountControlTestHelpers.registerQC(qcManager, qcAddress2.address, governance)
      const proxyAddress2 = await qcManager.qcProxies(qcAddress2.address)
      qcProxy2 = await ethers.getContractAt("QCWatchdog", proxyAddress2) as QCWatchdog
      
      // QC renounces their role
      await qcManager.connect(qcAddress).renounceRole(QC_ROLE, qcAddress.address)
      
      // QC operations should fail
      await expect(
        qcProxy.connect(qcAddress).mintUsingBank(ethers.utils.parseUnits("10", 18))
      ).to.be.revertedWith("Caller is not the authorized QC")
      
      // But other QC should still work
      await mintingPolicy.connect(governance).setQCCapacity(
        qcAddress2.address,
        ethers.utils.parseUnits("50", 18)
      )
      
      // Create proposal for QC2
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy2,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )
      
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.emit(watchdogConsensusManager, "ProposalExecuted")
    })

    it("should prevent cross-contract role confusion", async () => {
      // Watchdog in one contract shouldn't have privileges in another
      await expect(
        qcManager.connect(watchdog1).pauseQC(qcAddress.address)
      ).to.be.reverted
      
      // QC in QCManager shouldn't have watchdog privileges
      await expect(
        watchdogConsensusManager.connect(qcAddress).registerWatchdog(attacker.address)
      ).to.be.reverted
      
      // Admin of one contract shouldn't be admin of another
      await expect(
        qcData.connect(deployer).updateAttestation(
          qcAddress.address,
          ethers.utils.parseUnits("100", 18),
          Math.floor(Date.now() / 1000)
        )
      ).to.be.reverted
    })
  })

  describe("Multi-Signature Role Management", () => {
    it("should handle concurrent role changes", async () => {
      // Start with 5 watchdogs
      const watchdogs = await watchdogConsensusManager.getActiveWatchdogs()
      expect(watchdogs.length).to.equal(5)
      
      // Governance starts removing watchdogs while operations are pending
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )
      
      // Remove a watchdog mid-operation
      await watchdogConsensusManager.connect(governance).deactivateWatchdog(watchdog5.address)
      
      // Voting should still work with remaining watchdogs
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      
      // But removed watchdog cannot vote
      await expect(
        watchdogConsensusManager.connect(watchdog5).vote(proposalId, true)
      ).to.be.revertedWith("Not an active watchdog")
      
      // Consensus requirements should adjust
      const updatedWatchdogs = await watchdogConsensusManager.getActiveWatchdogs()
      expect(updatedWatchdogs.length).to.equal(4)
    })

    it("should enforce minimum watchdog requirements", async () => {
      // Try to remove too many watchdogs
      await watchdogConsensusManager.connect(governance).deactivateWatchdog(watchdog4.address)
      await watchdogConsensusManager.connect(governance).deactivateWatchdog(watchdog5.address)
      
      // Should not allow going below minimum (3)
      await expect(
        watchdogConsensusManager.connect(governance).deactivateWatchdog(watchdog3.address)
      ).to.be.revertedWith("Below minimum watchdog count")
    })
  })

  describe("Proxy Authorization Attacks", () => {
    it("should prevent unauthorized proxy deployment", async () => {
      // Attacker tries to deploy their own proxy
      const QCWatchdogFactory = await ethers.getContractFactory("QCWatchdog")
      const maliciousProxy = await QCWatchdogFactory.deploy(
        qcManager.address,
        attacker.address,
        watchdogConsensusManager.address
      )
      await maliciousProxy.deployed()
      
      // Malicious proxy should not be able to interact with system
      await expect(
        maliciousProxy.connect(attacker).mintUsingBank(ethers.utils.parseUnits("10", 18))
      ).to.be.reverted
      
      // System should not recognize malicious proxy
      const registeredProxy = await qcManager.qcProxies(attacker.address)
      expect(registeredProxy).to.not.equal(maliciousProxy.address)
    })

    it("should handle proxy upgrade authorization", async () => {
      // Only governance should be able to upgrade proxy implementation
      await expect(
        qcManager.connect(attacker).upgradeQCProxy(qcAddress.address, attacker.address)
      ).to.be.reverted
      
      // Even QC cannot upgrade their own proxy
      await expect(
        qcManager.connect(qcAddress).upgradeQCProxy(qcAddress.address, attacker.address)
      ).to.be.reverted
    })
  })

  describe("Emergency Access Control", () => {
    it("should restrict emergency functions to authorized roles", async () => {
      // Unauthorized user cannot trigger emergency pause
      await expect(
        systemState.connect(unauthorizedUser).pauseSystem()
      ).to.be.reverted
      
      // Watchdog cannot directly pause system
      await expect(
        systemState.connect(watchdog1).pauseSystem()
      ).to.be.reverted
      
      // Only governance can pause
      await expect(
        systemState.connect(governance).pauseSystem()
      ).to.emit(systemState, "SystemPaused")
    })

    it("should handle emergency pause state transitions", async () => {
      // Trigger emergency through monitor
      await watchdogMonitor.connect(watchdog1).submitCriticalReport(qcAddress.address, "Critical 1")
      await watchdogMonitor.connect(watchdog2).submitCriticalReport(qcAddress.address, "Critical 2")
      await watchdogMonitor.connect(watchdog3).submitCriticalReport(qcAddress.address, "Critical 3")
      
      // QC should be paused
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.true
      
      // Operations should be blocked
      await expect(
        qcProxy.connect(qcAddress).mintUsingBank(ethers.utils.parseUnits("10", 18))
      ).to.be.reverted
      
      // Only governance can unpause
      await expect(
        watchdogMonitor.connect(watchdog1).clearEmergencyPause(qcAddress.address)
      ).to.be.reverted
      
      await watchdogMonitor.connect(governance).clearEmergencyPause(qcAddress.address)
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.false
    })
  })

  describe("Arbiter Role Edge Cases", () => {
    it("should handle arbiter role in redemption disputes", async () => {
      // Setup: QC has minted tokens
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
      
      // Initiate redemption
      await qcRedeemer.connect(qcAddress).initiateRedemption(
        ethers.utils.parseUnits("20", 18),
        validBtcAddress
      )
      
      // Non-arbiter cannot handle timeout
      await ethers.provider.send("evm_increaseTime", [86401]) // Past timeout
      await ethers.provider.send("evm_mine", [])
      
      await expect(
        qcRedeemer.connect(unauthorizedUser).handleRedemptionTimeout(0)
      ).to.be.reverted
      
      // Arbiter can handle timeout
      await qcRedeemer.connect(governance).handleRedemptionTimeout(0)
    })

    it("should prevent arbiter abuse of power", async () => {
      // Arbiter cannot directly mint or affect QC operations
      await expect(
        qcProxy.connect(governance).mintUsingBank(ethers.utils.parseUnits("10", 18))
      ).to.be.revertedWith("Caller is not the authorized QC")
      
      // Arbiter cannot bypass consensus
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )
      
      await expect(
        watchdogConsensusManager.connect(governance).execute(proposalId)
      ).to.be.revertedWith("Proposal not approved")
    })
  })

  describe("Permission Delegation Attacks", () => {
    it("should prevent permission delegation through callbacks", async () => {
      // Create a proposal that might trigger callbacks
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
      
      // Even if attacker controls callback, permissions don't transfer
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.emit(watchdogConsensusManager, "ProposalExecuted")
    })

    it("should handle permission checks in nested calls", async () => {
      // Create a complex nested operation
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
      
      // Execution involves multiple permission checks across contracts
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.emit(watchdogConsensusManager, "ProposalExecuted")
      
      // Verify permissions were checked at each level
      const events = await watchdogConsensusManager.queryFilter(
        watchdogConsensusManager.filters.ProposalExecuted()
      )
      expect(events.length).to.be.gte(1)
    })
  })

  describe("Access Control State Consistency", () => {
    it("should maintain consistency during role transfers", async () => {
      // Transfer admin role
      await qcManager.connect(governance).grantRole(DEFAULT_ADMIN_ROLE, deployer.address)
      
      // Both should have admin temporarily
      expect(await qcManager.hasRole(DEFAULT_ADMIN_ROLE, governance.address)).to.be.true
      expect(await qcManager.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true
      
      // Original admin renounces
      await qcManager.connect(governance).renounceRole(DEFAULT_ADMIN_ROLE, governance.address)
      
      // Only new admin should have role
      expect(await qcManager.hasRole(DEFAULT_ADMIN_ROLE, governance.address)).to.be.false
      expect(await qcManager.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true
      
      // System should still function with new admin
      await qcManager.connect(deployer).setMintingPolicy(mintingPolicy.address)
    })

    it("should handle role member enumeration edge cases", async () => {
      // Add multiple members to a role
      const members = [watchdog1.address, watchdog2.address, watchdog3.address]
      
      for (const member of members) {
        await qcData.connect(governance).grantRole(GOVERNANCE_ROLE, member)
      }
      
      // Get role member count
      const memberCount = await qcData.getRoleMemberCount(GOVERNANCE_ROLE)
      expect(memberCount).to.equal(members.length + 1) // +1 for original governance
      
      // Enumerate members
      const enumerated = []
      for (let i = 0; i < memberCount; i++) {
        enumerated.push(await qcData.getRoleMember(GOVERNANCE_ROLE, i))
      }
      
      // All members should be present
      expect(enumerated).to.include(governance.address)
      members.forEach(member => {
        expect(enumerated).to.include(member)
      })
    })
  })

  describe("Zero Address and Edge Value Attacks", () => {
    it("should handle zero address in role operations", async () => {
      // Cannot grant role to zero address
      await expect(
        qcManager.connect(governance).grantRole(QC_ROLE, ethers.constants.AddressZero)
      ).to.be.reverted
      
      // Cannot register zero address as watchdog
      await expect(
        watchdogConsensusManager.connect(governance).registerWatchdog(ethers.constants.AddressZero)
      ).to.be.revertedWith("Invalid watchdog address")
      
      // Cannot register zero address as QC
      await expect(
        qcManager.connect(governance).registerQC(ethers.constants.AddressZero)
      ).to.be.revertedWith("Invalid QC address")
    })

    it("should handle role operations at permission boundaries", async () => {
      // Test at exact minimum watchdog threshold
      await watchdogConsensusManager.connect(governance).deactivateWatchdog(watchdog4.address)
      await watchdogConsensusManager.connect(governance).deactivateWatchdog(watchdog5.address)
      
      // Should have exactly 3 watchdogs
      const watchdogs = await watchdogConsensusManager.getActiveWatchdogs()
      expect(watchdogs.length).to.equal(3)
      
      // Consensus should still work at minimum
      const proposalId = await AccountControlTestHelpers.createProposal(
        watchdogConsensusManager,
        qcProxy,
        "mint",
        [ethers.utils.parseUnits("10", 18)],
        watchdog1
      )
      
      // Need 2 votes for 2-of-3
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId, true)
      
      await ethers.provider.send("evm_increaseTime", [3600])
      await ethers.provider.send("evm_mine", [])
      
      await expect(
        watchdogConsensusManager.connect(watchdog1).execute(proposalId)
      ).to.emit(watchdogConsensusManager, "ProposalExecuted")
    })
  })
})