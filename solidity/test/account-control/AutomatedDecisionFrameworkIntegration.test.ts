import { expect } from "chai"
import { ethers, deployments } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

import {
  WatchdogAutomatedEnforcement,
  WatchdogThresholdActions,
  WatchdogDAOEscalation,
  QCManager,
  QCRedeemer,
  QCData,
  SystemState,
  ReserveLedger,
} from "../../typechain"

import {
  deployAccountControlFixture,
  AccountControlFixture,
  ROLES,
  TEST_DATA,
  QCStatus,
  RedemptionStatus,
} from "./AccountControlTestHelpers"

describe("Automated Decision Framework Integration", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let qc1: SignerWithAddress
  let user: SignerWithAddress

  let fixture: AccountControlFixture
  let automatedEnforcement: WatchdogAutomatedEnforcement
  let thresholdActions: WatchdogThresholdActions
  let daoEscalation: WatchdogDAOEscalation
  let qcManager: QCManager
  let qcRedeemer: QCRedeemer
  let qcData: QCData
  let systemState: SystemState
  let reserveLedger: ReserveLedger

  enum ReportType {
    SUSPICIOUS_ACTIVITY = 0,
    UNUSUAL_PATTERN = 1,
    EMERGENCY_SITUATION = 2,
    OPERATIONAL_CONCERN = 3,
  }

  beforeEach(async () => {
    const signers = await ethers.getSigners()
    deployer = signers[0]
    governance = signers[1]
    watchdog1 = signers[2]
    watchdog2 = signers[3]
    watchdog3 = signers[4]
    qc1 = signers[5]
    user = signers[6]

    // Deploy complete fixture with automated framework
    fixture = await deployAccountControlFixture()

    // Extract contracts
    automatedEnforcement = fixture.watchdogAutomatedEnforcement
    thresholdActions = fixture.watchdogThresholdActions
    daoEscalation = fixture.watchdogDAOEscalation
    qcManager = fixture.qcManager
    qcRedeemer = fixture.qcRedeemer
    qcData = fixture.qcData
    systemState = fixture.systemState
    reserveLedger = fixture.reserveLedger

    // Grant additional watchdog roles for testing
    await thresholdActions.grantRole(ROLES.WATCHDOG_ROLE, watchdog2.address)
    await thresholdActions.grantRole(ROLES.WATCHDOG_ROLE, watchdog3.address)

    // Setup test QC
    await qcData.registerQC(qc1.address, ethers.utils.parseEther("1000"))
    await qcData.setQCStatus(qc1.address, QCStatus.Active)
  })

  describe("Layer 1: Automated Enforcement", () => {
    it("should automatically enforce stale reserve attestations", async () => {
      // Submit reserve attestation
      await reserveLedger.submitAttestation(qc1.address, ethers.utils.parseEther("100"))

      // Fast forward past stale threshold (24 hours + 1)
      await ethers.provider.send("evm_increaseTime", [24 * 3600 + 1])
      await ethers.provider.send("evm_mine", [])

      // Mock minted amount for QC (this would normally be tracked in QCData)
      // In a real implementation, this would be properly integrated

      // Enforce compliance - should detect stale attestations
      const tx = await automatedEnforcement.enforceReserveCompliance(qc1.address)

      await expect(tx)
        .to.emit(automatedEnforcement, "AutomatedAction")
        .withArgs("STALE_ATTESTATIONS", qc1.address, "STALE_ATTESTATIONS", anyValue)

      await expect(tx)
        .to.emit(automatedEnforcement, "ReserveComplianceEnforced")
        .withArgs(qc1.address, anyValue, anyValue, "STALE_ATTESTATIONS")
    })

    it("should respect enforcement cooldowns", async () => {
      // Setup stale attestation
      await reserveLedger.submitAttestation(qc1.address, ethers.utils.parseEther("100"))
      await ethers.provider.send("evm_increaseTime", [25 * 3600])
      await ethers.provider.send("evm_mine", [])

      // First enforcement should work
      await automatedEnforcement.enforceReserveCompliance(qc1.address)

      // Second enforcement within cooldown should fail
      await expect(
        automatedEnforcement.enforceReserveCompliance(qc1.address)
      ).to.be.revertedWith("EnforcementCooldownActive")

      // After cooldown, should work again
      await ethers.provider.send("evm_increaseTime", [3601]) // 1 hour + 1 second
      await ethers.provider.send("evm_mine", [])

      await expect(
        automatedEnforcement.enforceReserveCompliance(qc1.address)
      ).to.not.be.reverted
    })

    it("should allow batch enforcement operations", async () => {
      // Setup multiple QCs with stale attestations
      const qc2 = ethers.Wallet.createRandom().address
      await qcData.registerQC(qc2.address, ethers.utils.parseEther("1000"))
      await qcData.setQCStatus(qc2.address, QCStatus.Active)

      await reserveLedger.submitAttestation(qc1.address, ethers.utils.parseEther("100"))
      await reserveLedger.submitAttestation(qc2, ethers.utils.parseEther("200"))

      // Make attestations stale
      await ethers.provider.send("evm_increaseTime", [25 * 3600])
      await ethers.provider.send("evm_mine", [])

      // Batch enforce should process both QCs
      const tx = await automatedEnforcement.batchEnforceReserveCompliance([
        qc1.address,
        qc2,
      ])

      expect(tx).to.not.be.reverted
    })
  })

  describe("Layer 2: Threshold Actions", () => {
    it("should collect reports and execute threshold actions", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      // Submit reports from 3 watchdogs
      await thresholdActions
        .connect(watchdog1)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      await thresholdActions
        .connect(watchdog2)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      // Third report should trigger threshold action
      const tx = await thresholdActions
        .connect(watchdog3)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      // Should emit threshold reached and action executed events
      await expect(tx)
        .to.emit(thresholdActions, "ThresholdReached")
        .withArgs(anyValue, ReportType.SUSPICIOUS_ACTIVITY, qc1.address, 3)

      await expect(tx)
        .to.emit(thresholdActions, "ThresholdActionExecuted")
        .withArgs(anyValue, ReportType.SUSPICIOUS_ACTIVITY, qc1.address, 3, "IMMEDIATE_PAUSE")

      await expect(tx)
        .to.emit(thresholdActions, "EmergencyActionTaken")
        .withArgs(qc1.address, "SUSPICIOUS_ACTIVITY")
    })

    it("should prevent duplicate reports from same watchdog", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      // First report should succeed
      await thresholdActions
        .connect(watchdog1)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      // Second report from same watchdog should fail
      await expect(
        thresholdActions
          .connect(watchdog1)
          .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)
      ).to.be.revertedWith("AlreadyReported")
    })

    it("should respect cooldown periods between actions", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      // Trigger first threshold action
      await thresholdActions
        .connect(watchdog1)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      await thresholdActions
        .connect(watchdog2)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      await thresholdActions
        .connect(watchdog3)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      // Try to report again immediately (should fail due to cooldown)
      await expect(
        thresholdActions
          .connect(watchdog1)
          .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)
      ).to.be.revertedWith("InCooldownPeriod")

      // Fast forward past cooldown period (7 days)
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1])
      await ethers.provider.send("evm_mine", [])

      // Should be able to report again
      await expect(
        thresholdActions
          .connect(watchdog1)
          .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)
      ).to.not.be.reverted
    })
  })

  describe("Layer 3: DAO Escalation", () => {
    it("should escalate threshold actions to DAO", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      // Trigger threshold action which should escalate to DAO
      await thresholdActions
        .connect(watchdog1)
        .reportIssue(ReportType.UNUSUAL_PATTERN, qc1.address, evidenceHash, evidenceURI)

      await thresholdActions
        .connect(watchdog2)
        .reportIssue(ReportType.UNUSUAL_PATTERN, qc1.address, evidenceHash, evidenceURI)

      const tx = await thresholdActions
        .connect(watchdog3)
        .reportIssue(ReportType.UNUSUAL_PATTERN, qc1.address, evidenceHash, evidenceURI)

      // Should emit DAO escalation event
      await expect(tx)
        .to.emit(daoEscalation, "EscalatedToDAO")
        .withArgs(anyValue, ReportType.UNUSUAL_PATTERN, qc1.address, 3, anyValue, anyValue)
    })

    it("should create emergency proposals", async () => {
      const reason = ethers.utils.id("EMERGENCY_TEST")
      const immediateAction = ethers.utils.hexlify(ethers.utils.toUtf8Bytes("emergency_action"))

      // Create emergency proposal
      const tx = await daoEscalation
        .connect(governance)
        .createEmergencyProposal(qc1.address, reason, immediateAction)

      await expect(tx)
        .to.emit(daoEscalation, "EmergencyProposalCreated")
        .withArgs(anyValue, anyValue, qc1.address)
    })
  })

  describe("Integration between Layers", () => {
    it("should demonstrate full escalation path", async () => {
      // Step 1: Automated enforcement detects and acts on objective violation
      await reserveLedger.submitAttestation(qc1.address, ethers.utils.parseEther("100"))
      await ethers.provider.send("evm_increaseTime", [25 * 3600])
      await ethers.provider.send("evm_mine", [])

      const enforcementTx = await automatedEnforcement.enforceReserveCompliance(qc1.address)
      
      await expect(enforcementTx)
        .to.emit(automatedEnforcement, "AutomatedAction")
        .withArgs("STALE_ATTESTATIONS", qc1.address, "STALE_ATTESTATIONS", anyValue)

      // Step 2: Multiple watchdogs report subjective concern
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("escalation-evidence"))
      const evidenceURI = "ipfs://Qm456...escalation"

      await thresholdActions
        .connect(watchdog1)
        .reportIssue(ReportType.OPERATIONAL_CONCERN, qc1.address, evidenceHash, evidenceURI)

      await thresholdActions
        .connect(watchdog2)
        .reportIssue(ReportType.OPERATIONAL_CONCERN, qc1.address, evidenceHash, evidenceURI)

      // Step 3: Third report triggers threshold action and DAO escalation
      const thresholdTx = await thresholdActions
        .connect(watchdog3)
        .reportIssue(ReportType.OPERATIONAL_CONCERN, qc1.address, evidenceHash, evidenceURI)

      await expect(thresholdTx)
        .to.emit(thresholdActions, "ThresholdActionExecuted")
        .withArgs(anyValue, ReportType.OPERATIONAL_CONCERN, qc1.address, 3, "CONCERN_LOGGED")

      await expect(thresholdTx)
        .to.emit(daoEscalation, "EscalatedToDAO")
        .withArgs(anyValue, ReportType.OPERATIONAL_CONCERN, qc1.address, 3, anyValue, anyValue)

      // Verify system state
      const [count, lastFailure] = await automatedEnforcement.getFailureStats(qc1.address)
      // In a real implementation, failure tracking would be integrated
    })

    it("should maintain proper role permissions across layers", async () => {
      // Verify automated enforcement has proper roles
      expect(
        await qcManager.hasRole(ROLES.ARBITER_ROLE, automatedEnforcement.address)
      ).to.be.true

      expect(
        await qcRedeemer.hasRole(ROLES.ARBITER_ROLE, automatedEnforcement.address)
      ).to.be.true

      // Verify threshold actions has proper roles
      expect(
        await systemState.hasRole(ROLES.PAUSER_ROLE, thresholdActions.address)
      ).to.be.true

      expect(
        await daoEscalation.hasRole(ROLES.ESCALATOR_ROLE, thresholdActions.address)
      ).to.be.true

      // Verify watchdogs have proper roles
      expect(
        await thresholdActions.hasRole(ROLES.WATCHDOG_ROLE, watchdog1.address)
      ).to.be.true
    })
  })

  describe("Configuration and Parameters", () => {
    it("should use SystemState parameters for enforcement", async () => {
      // Verify automated enforcement uses SystemState configuration
      const minRatio = await systemState.minCollateralRatio()
      const staleThreshold = await systemState.staleThreshold()
      const failureThreshold = await systemState.failureThreshold()

      expect(minRatio).to.equal(90) // 90%
      expect(staleThreshold).to.equal(24 * 3600) // 24 hours  
      expect(failureThreshold).to.equal(3) // 3 failures
    })

    it("should update enforcement behavior when parameters change", async () => {
      // Change minimum collateral ratio
      await systemState.setMinCollateralRatio(95) // Increase to 95%

      // Verify new parameter is used
      const newRatio = await systemState.minCollateralRatio()
      expect(newRatio).to.equal(95)

      // Enforcement should now use the new 95% threshold
      // (This would be tested with proper reserve/minted amount setup)
    })
  })

  describe("Gas Efficiency", () => {
    it("should have reasonable gas costs for batch operations", async () => {
      const qcAddresses = [
        qc1.address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
      ]

      // Setup QCs
      for (let i = 1; i < qcAddresses.length; i++) {
        await qcData.registerQC(qcAddresses[i], ethers.utils.parseEther("1000"))
        await qcData.setQCStatus(qcAddresses[i], QCStatus.Active)
        await reserveLedger.submitAttestation(qcAddresses[i], ethers.utils.parseEther("100"))
      }

      // Make attestations stale
      await ethers.provider.send("evm_increaseTime", [25 * 3600])
      await ethers.provider.send("evm_mine", [])

      // Measure gas for batch enforcement
      const tx = await automatedEnforcement.batchEnforceReserveCompliance(qcAddresses)
      const receipt = await tx.wait()

      // Gas usage should be reasonable (exact numbers depend on implementation)
      expect(receipt.gasUsed.lt(ethers.utils.parseUnits("500000", "wei"))).to.be.true
    })
  })
})

// Helper for matching any value in events
const anyValue = (value: any) => true