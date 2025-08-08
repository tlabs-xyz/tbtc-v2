import { ethers, deployments, helpers } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber } from "ethers"
import {
  WatchdogAutomatedEnforcement,
  WatchdogThresholdActions,
  WatchdogDAOEscalation,
  WatchdogMonitor,
  QCManager,
  QCRedeemer,
  SystemState,
} from "../../typechain"

const HOUR = 3600
const DAY = 86400
const WEEK = 604800

describe("Automated Decision Framework Integration Tests", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let dao: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let watchdog4: SignerWithAddress
  let watchdog5: SignerWithAddress
  let qc1: SignerWithAddress
  let qc2: SignerWithAddress
  let user: SignerWithAddress

  let automatedEnforcement: WatchdogAutomatedEnforcement
  let thresholdActions: WatchdogThresholdActions
  let daoEscalation: WatchdogDAOEscalation
  let watchdogMonitor: WatchdogMonitor
  let qcManager: QCManager
  let qcRedeemer: QCRedeemer
  let systemState: SystemState

  beforeEach(async () => {
    await deployments.fixture(["AccountControl", "AutomatedDecisionFramework"])
    ;({ deployer, governance } = await helpers.signers.getNamedSigners())
    ;[
      dao,
      watchdog1,
      watchdog2,
      watchdog3,
      watchdog4,
      watchdog5,
      qc1,
      qc2,
      user,
    ] = await helpers.signers.getUnnamedSigners()

    // Get deployed contracts
    automatedEnforcement = await helpers.contracts.getContract(
      "WatchdogAutomatedEnforcement"
    )
    thresholdActions = await helpers.contracts.getContract(
      "WatchdogThresholdActions"
    )
    daoEscalation = await helpers.contracts.getContract("WatchdogDAOEscalation")
    watchdogMonitor = await helpers.contracts.getContract("WatchdogMonitor")
    qcManager = await helpers.contracts.getContract("QCManager")
    qcRedeemer = await helpers.contracts.getContract("QCRedeemer")
    systemState = await helpers.contracts.getContract("SystemState")

    // Grant DAO role
    await daoEscalation
      .connect(governance)
      .grantRole(await daoEscalation.DAO_ROLE(), dao.address)

    // Register QCs
    await qcManager.connect(governance).registerQC(qc1.address, "QC1")
    await qcManager.connect(governance).registerQC(qc2.address, "QC2")
  })

  describe("Layer 1: Automated Enforcement (90%+ automation)", () => {
    it("should automatically pause operations on reserve ratio violation", async () => {
      // Configure rule: Pause if reserve ratio < 95%
      await automatedEnforcement.connect(governance).configureRule(
        0, // RuleType.ReserveRatio
        true, // enabled
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "uint256"],
          [95, 100] // 95% minimum ratio
        )
      )

      // Simulate reserve ratio drop
      const event = {
        qcAddress: qc1.address,
        currentRatio: 90, // Below 95%
        requiredRatio: 95,
        timestamp: await helpers.time.latest(),
      }

      // Trigger automated check
      await expect(
        automatedEnforcement.checkReserveRatio(
          event.qcAddress,
          event.currentRatio,
          event.requiredRatio
        )
      )
        .to.emit(automatedEnforcement, "RuleTriggered")
        .withArgs(0, qc1.address, "Reserve ratio below threshold")
        .and.to.emit(automatedEnforcement, "AutomatedActionTaken")
        .withArgs(qc1.address, "PAUSE_MINTING", "Reserve ratio: 90% < 95%")

      // Verify minting is paused for the QC
      const isPaused = await systemState.mintingPaused()
      expect(isPaused).to.be.true
    })

    it("should automatically default stale redemptions", async () => {
      // Configure rule: Auto-default redemptions after 48 hours
      await automatedEnforcement.connect(governance).configureRule(
        1, // RuleType.RedemptionTimeout
        true,
        ethers.utils.defaultAbiCoder.encode(["uint256"], [48 * HOUR])
      )

      // Create a redemption
      await qcRedeemer
        .connect(qc1)
        .initiateRedemption(
          ethers.utils.parseEther("10"),
          "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
          "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
        )
      const redemptionId = await qcRedeemer.currentRedemptionId()

      // Fast forward past timeout
      await helpers.time.increaseTime(49 * HOUR)

      // Trigger automated check
      await expect(automatedEnforcement.checkRedemptionTimeout(redemptionId))
        .to.emit(automatedEnforcement, "RuleTriggered")
        .withArgs(1, qc1.address, "Redemption timeout exceeded")
        .and.to.emit(qcRedeemer, "RedemptionDefaulted")
        .withArgs(redemptionId)

      // Verify redemption is defaulted
      const redemption = await qcRedeemer.redemptions(redemptionId)
      expect(redemption.status).to.equal(3) // Defaulted
    })

    it("should enforce attestation staleness rules", async () => {
      // Configure rule: Pause if attestation > 7 days old
      await automatedEnforcement.connect(governance).configureRule(
        2, // RuleType.AttestationStaleness
        true,
        ethers.utils.defaultAbiCoder.encode(["uint256"], [7 * DAY])
      )

      // Simulate stale attestation check
      const lastAttestation = (await helpers.time.latest()) - 8 * DAY

      await expect(
        automatedEnforcement.checkAttestationStaleness(
          qc1.address,
          lastAttestation
        )
      )
        .to.emit(automatedEnforcement, "RuleTriggered")
        .withArgs(2, qc1.address, "Attestation is stale")
        .and.to.emit(automatedEnforcement, "AutomatedActionTaken")
        .withArgs(qc1.address, "PAUSE_QC_OPERATIONS", "Attestation 8 days old")
    })

    it("should handle multiple rule violations efficiently", async () => {
      // Configure multiple rules
      await automatedEnforcement.connect(governance).configureRule(
        0, // Reserve ratio
        true,
        ethers.utils.defaultAbiCoder.encode(["uint256", "uint256"], [95, 100])
      )

      await automatedEnforcement.connect(governance).configureRule(
        2, // Attestation staleness
        true,
        ethers.utils.defaultAbiCoder.encode(["uint256"], [7 * DAY])
      )

      // Batch check multiple conditions
      const violations = await automatedEnforcement.batchCheckCompliance(
        qc1.address
      )

      // Process violations
      for (const violation of violations) {
        if (violation.violated) {
          await expect(
            automatedEnforcement.executeAutomatedAction(
              violation.ruleType,
              qc1.address,
              violation.data
            )
          ).to.emit(automatedEnforcement, "AutomatedActionTaken")
        }
      }
    })
  })

  describe("Layer 2: Threshold Actions (3+ reports → action)", () => {
    it("should trigger action after threshold reports", async () => {
      const issueType = "WALLET_COMPROMISE"

      // Configure threshold for wallet compromise
      await thresholdActions.connect(governance).configureThreshold(
        issueType,
        3, // threshold
        1 * HOUR, // timeWindow
        0 // ActionType.PAUSE_WALLET
      )

      // First report
      await expect(
        thresholdActions
          .connect(watchdog1)
          .reportIssue(
            qc1.address,
            issueType,
            "Suspicious wallet activity detected"
          )
      )
        .to.emit(thresholdActions, "IssueReported")
        .withArgs(qc1.address, issueType, watchdog1.address)

      // Second report
      await thresholdActions
        .connect(watchdog2)
        .reportIssue(
          qc1.address,
          issueType,
          "Confirmed unauthorized transaction"
        )

      // Third report triggers action
      await expect(
        thresholdActions
          .connect(watchdog3)
          .reportIssue(
            qc1.address,
            issueType,
            "Multiple unauthorized transfers"
          )
      )
        .to.emit(thresholdActions, "ThresholdReached")
        .withArgs(qc1.address, issueType, 3)
        .and.to.emit(thresholdActions, "ActionExecuted")
        .withArgs(qc1.address, 0, "WALLET_COMPROMISE threshold reached")

      // Verify wallet operations are paused
      const walletStatus = await thresholdActions.getWalletStatus(qc1.address)
      expect(walletStatus.isPaused).to.be.true
    })

    it("should respect time windows for threshold counting", async () => {
      const issueType = "PERFORMANCE_DEGRADATION"

      await thresholdActions.connect(governance).configureThreshold(
        issueType,
        2,
        30 * MINUTE,
        1 // ActionType.ALERT_GOVERNANCE
      )

      // First report
      await thresholdActions
        .connect(watchdog1)
        .reportIssue(qc2.address, issueType, "Slow response times")

      // Fast forward past window
      await helpers.time.increaseTime(31 * MINUTE)

      // Second report - should not trigger as first is outside window
      await expect(
        thresholdActions
          .connect(watchdog2)
          .reportIssue(qc2.address, issueType, "Still slow")
      ).to.not.emit(thresholdActions, "ThresholdReached")

      // Third report within new window
      await thresholdActions
        .connect(watchdog3)
        .reportIssue(qc2.address, issueType, "Performance issues continue")

      // Now threshold should be reached
      await expect(
        thresholdActions
          .connect(watchdog4)
          .reportIssue(
            qc2.address,
            issueType,
            "Critical performance degradation"
          )
      )
        .to.emit(thresholdActions, "ThresholdReached")
        .withArgs(qc2.address, issueType, 2)
    })

    it("should handle different issue types independently", async () => {
      // Configure different thresholds
      await thresholdActions
        .connect(governance)
        .configureThreshold("SECURITY_BREACH", 2, 1 * HOUR, 0)

      await thresholdActions
        .connect(governance)
        .configureThreshold("COMPLIANCE_VIOLATION", 3, 2 * HOUR, 1)

      // Mix reports of different types
      await thresholdActions
        .connect(watchdog1)
        .reportIssue(qc1.address, "SECURITY_BREACH", "Potential breach")

      await thresholdActions
        .connect(watchdog2)
        .reportIssue(qc1.address, "COMPLIANCE_VIOLATION", "KYC issue")

      // Security breach reaches threshold first
      await expect(
        thresholdActions
          .connect(watchdog3)
          .reportIssue(qc1.address, "SECURITY_BREACH", "Confirmed breach")
      )
        .to.emit(thresholdActions, "ThresholdReached")
        .withArgs(qc1.address, "SECURITY_BREACH", 2)

      // Compliance still needs more reports
      const complianceCount = await thresholdActions.getReportCount(
        qc1.address,
        "COMPLIANCE_VIOLATION"
      )
      expect(complianceCount).to.equal(1)
    })
  })

  describe("Layer 3: DAO Escalation (governance decisions)", () => {
    it("should create DAO proposal for complex issues", async () => {
      const complexIssue = {
        issueType: "QC_INSOLVENCY_RISK",
        severity: 9, // High severity
        description: "QC showing signs of potential insolvency",
        evidence: ethers.utils.keccak256(
          ethers.utils.toUtf8Bytes("evidence_hash")
        ),
      }

      // Escalate to DAO
      await expect(
        daoEscalation
          .connect(watchdog1)
          .escalateToDAO(
            qc1.address,
            complexIssue.issueType,
            complexIssue.severity,
            complexIssue.description,
            complexIssue.evidence
          )
      )
        .to.emit(daoEscalation, "IssueEscalated")
        .withArgs(
          qc1.address,
          complexIssue.issueType,
          watchdog1.address,
          complexIssue.severity
        )

      // Get escalation details
      const escalations = await daoEscalation.getActiveEscalations()
      expect(escalations.length).to.equal(1)
      expect(escalations[0].qcAddress).to.equal(qc1.address)
      expect(escalations[0].severity).to.equal(9)
    })

    it("should allow DAO to resolve escalated issues", async () => {
      // Create escalation
      await daoEscalation
        .connect(watchdog1)
        .escalateToDAO(
          qc2.address,
          "REGULATORY_CONCERN",
          7,
          "Potential regulatory compliance issue",
          ethers.utils.formatBytes32String("evidence1")
        )

      const escalationId = 1 // First escalation

      // DAO investigates and decides on action
      const resolution = {
        action: 2, // ResolutionType.IMPOSE_CONDITIONS
        reasoning: "QC must provide additional compliance documentation",
        conditions: ethers.utils.defaultAbiCoder.encode(
          ["string[]"],
          [["Provide audit report", "Update compliance procedures"]]
        ),
      }

      await expect(
        daoEscalation
          .connect(dao)
          .resolveEscalation(
            escalationId,
            resolution.action,
            resolution.reasoning,
            resolution.conditions
          )
      )
        .to.emit(daoEscalation, "EscalationResolved")
        .withArgs(escalationId, resolution.action, resolution.reasoning)

      // Verify resolution is recorded
      const escalation = await daoEscalation.escalations(escalationId)
      expect(escalation.resolved).to.be.true
      expect(escalation.resolutionType).to.equal(2)
    })

    it("should enforce DAO decisions through automated systems", async () => {
      // Escalate issue
      await daoEscalation
        .connect(watchdog1)
        .escalateToDAO(
          qc1.address,
          "SEVERE_VIOLATION",
          10,
          "Critical security and compliance violations",
          ethers.utils.formatBytes32String("evidence2")
        )

      const escalationId = 1

      // DAO decides to terminate QC
      await expect(
        daoEscalation.connect(dao).resolveEscalation(
          escalationId,
          3, // ResolutionType.TERMINATE_QC
          "Severe violations warrant termination",
          "0x"
        )
      )
        .to.emit(daoEscalation, "EscalationResolved")
        .and.to.emit(qcManager, "QCDeactivated")
        .withArgs(qc1.address)

      // Verify QC is deactivated
      const qcData = await qcManager.qcs(qc1.address)
      expect(qcData.isActive).to.be.false
    })

    it("should track escalation history for governance review", async () => {
      // Create multiple escalations
      await daoEscalation
        .connect(watchdog1)
        .escalateToDAO(qc1.address, "ISSUE_1", 5, "First issue", "0x01")

      await daoEscalation
        .connect(watchdog2)
        .escalateToDAO(qc1.address, "ISSUE_2", 8, "Second issue", "0x02")

      await daoEscalation
        .connect(watchdog3)
        .escalateToDAO(qc2.address, "ISSUE_3", 6, "Third issue", "0x03")

      // Get QC-specific escalations
      const qc1Escalations = await daoEscalation.getQCEscalations(qc1.address)
      expect(qc1Escalations.length).to.equal(2)

      // Get all active escalations
      const activeEscalations = await daoEscalation.getActiveEscalations()
      expect(activeEscalations.length).to.equal(3)

      // Resolve one
      await daoEscalation.connect(dao).resolveEscalation(
        1,
        1, // WARNING
        "Issue addressed",
        "0x"
      )

      // Check active count decreased
      const remainingActive = await daoEscalation.getActiveEscalations()
      expect(remainingActive.length).to.equal(2)
    })
  })

  describe("Cross-Layer Integration", () => {
    it("should escalate from Layer 1 to Layer 2 when automated rules insufficient", async () => {
      // Layer 1 detects issue but cannot fully resolve
      await automatedEnforcement.connect(governance).configureRule(
        3, // RuleType.AnomalyDetection
        true,
        ethers.utils.defaultAbiCoder.encode(
          ["uint256"],
          [1000] // Threshold for anomaly
        )
      )

      // Anomaly detected, escalate to threshold system
      await expect(
        automatedEnforcement.detectAnomaly(
          qc1.address,
          1500, // Above threshold
          "Unusual transaction pattern"
        )
      )
        .to.emit(automatedEnforcement, "EscalationRequired")
        .withArgs(qc1.address, "Layer2", "Anomaly requires human review")

      // Layer 2 picks up the escalation
      await thresholdActions
        .connect(watchdog1)
        .reportIssue(
          qc1.address,
          "ANOMALY_ESCALATION",
          "Automated system flagged unusual pattern"
        )
    })

    it("should escalate from Layer 2 to Layer 3 for unresolvable issues", async () => {
      // Configure threshold that triggers DAO escalation
      await thresholdActions.connect(governance).configureThreshold(
        "CRITICAL_ISSUE",
        2,
        1 * HOUR,
        99 // Special action type for DAO escalation
      )

      // Reports trigger threshold
      await thresholdActions
        .connect(watchdog1)
        .reportIssue(qc2.address, "CRITICAL_ISSUE", "Major problem detected")

      // Second report triggers DAO escalation
      await expect(
        thresholdActions
          .connect(watchdog2)
          .reportIssue(
            qc2.address,
            "CRITICAL_ISSUE",
            "Confirmed critical issue"
          )
      )
        .to.emit(thresholdActions, "DAOEscalationRequired")
        .withArgs(
          qc2.address,
          "CRITICAL_ISSUE",
          "Threshold action requires DAO"
        )

      // Verify escalation created in Layer 3
      const escalations = await daoEscalation.getActiveEscalations()
      expect(escalations.length).to.be.greaterThan(0)
    })

    it("should maintain audit trail across all layers", async () => {
      // Layer 1 action
      await automatedEnforcement.checkReserveRatio(qc1.address, 90, 95)

      // Layer 2 reports
      await thresholdActions
        .connect(watchdog1)
        .reportIssue(
          qc1.address,
          "FOLLOW_UP",
          "Monitoring after automated action"
        )

      // Layer 3 escalation
      await daoEscalation
        .connect(watchdog2)
        .escalateToDAO(
          qc1.address,
          "COMPREHENSIVE_REVIEW",
          8,
          "Full review needed after multiple issues",
          "0x"
        )

      // Each layer maintains its own logs
      // Integration layer could aggregate these for comprehensive view
      const automatedLogs = await automatedEnforcement.getActionHistory(
        qc1.address
      )
      const thresholdReports = await thresholdActions.getReportHistory(
        qc1.address
      )
      const daoEscalations = await daoEscalation.getQCEscalations(qc1.address)

      // All should have entries for qc1
      expect(automatedLogs.length).to.be.greaterThan(0)
      expect(thresholdReports.length).to.be.greaterThan(0)
      expect(daoEscalations.length).to.be.greaterThan(0)
    })
  })
})
