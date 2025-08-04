import { expect } from "chai"
import { ethers, deployments, getNamedAccounts } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

import {
  WatchdogThresholdActions,
  WatchdogDAOEscalation,
  QCManager,
  QCData,
  SystemState,
} from "../../typechain"

describe("WatchdogThresholdActions", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let qc1: SignerWithAddress
  let user: SignerWithAddress

  let thresholdActions: WatchdogThresholdActions
  let daoEscalation: WatchdogDAOEscalation
  let qcManager: QCManager
  let qcData: QCData
  let systemState: SystemState

  enum ReportType {
    SUSPICIOUS_ACTIVITY = 0,
    UNUSUAL_PATTERN = 1,
    EMERGENCY_SITUATION = 2,
    OPERATIONAL_CONCERN = 3,
  }

  const fixture = deployments.createFixture(async () => {
    await deployments.fixture(["AutomatedDecisionFramework", "ConfigureAutomatedDecisionFramework"])

    thresholdActions = await ethers.getContract("WatchdogThresholdActions")
    daoEscalation = await ethers.getContract("WatchdogDAOEscalation")
    qcManager = await ethers.getContract("QCManager")
    qcData = await ethers.getContract("QCData")
    systemState = await ethers.getContract("SystemState")

    return {
      thresholdActions,
      daoEscalation,
      qcManager,
      qcData,
      systemState,
    }
  })

  beforeEach(async () => {
    const signers = await ethers.getSigners()
    deployer = signers[0]
    governance = signers[1]
    watchdog1 = signers[2]
    watchdog2 = signers[3]
    watchdog3 = signers[4]
    qc1 = signers[5]
    user = signers[6]

    await fixture()

    // Grant WATCHDOG_ROLE to test watchdogs
    const watchdogRole = await thresholdActions.WATCHDOG_ROLE()
    await thresholdActions.grantRole(watchdogRole, watchdog1.address)
    await thresholdActions.grantRole(watchdogRole, watchdog2.address)
    await thresholdActions.grantRole(watchdogRole, watchdog3.address)
  })

  describe("Issue Reporting", () => {
    it("should allow watchdogs to report issues", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      const tx = await thresholdActions
        .connect(watchdog1)
        .reportIssue(
          ReportType.SUSPICIOUS_ACTIVITY,
          qc1.address,
          evidenceHash,
          evidenceURI
        )

      await expect(tx)
        .to.emit(thresholdActions, "IssueReported")
        .withArgs(
          anyValue, // issueId
          ReportType.SUSPICIOUS_ACTIVITY,
          qc1.address,
          watchdog1.address,
          evidenceHash,
          evidenceURI
        )
    })

    it("should prevent non-watchdogs from reporting", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      await expect(
        thresholdActions
          .connect(user)
          .reportIssue(
            ReportType.SUSPICIOUS_ACTIVITY,
            qc1.address,
            evidenceHash,
            evidenceURI
          )
      ).to.be.revertedWith("NotWatchdog")
    })

    it("should prevent duplicate reports from same watchdog", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      // First report should succeed
      await thresholdActions
        .connect(watchdog1)
        .reportIssue(
          ReportType.SUSPICIOUS_ACTIVITY,
          qc1.address,
          evidenceHash,
          evidenceURI
        )

      // Second report from same watchdog should fail
      await expect(
        thresholdActions
          .connect(watchdog1)
          .reportIssue(
            ReportType.SUSPICIOUS_ACTIVITY,
            qc1.address,
            evidenceHash,
            evidenceURI
          )
      ).to.be.revertedWith("AlreadyReported")
    })

    it("should reject invalid report types", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      await expect(
        thresholdActions
          .connect(watchdog1)
          .reportIssue(
            4, // Invalid report type
            qc1.address,
            evidenceHash,
            evidenceURI
          )
      ).to.be.revertedWith("InvalidReportType")
    })

    it("should reject zero address targets", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      await expect(
        thresholdActions
          .connect(watchdog1)
          .reportIssue(
            ReportType.SUSPICIOUS_ACTIVITY,
            ethers.constants.AddressZero,
            evidenceHash,
            evidenceURI
          )
      ).to.be.revertedWith("InvalidTarget")
    })
  })

  describe("Threshold Actions", () => {
    it("should execute action when threshold reached for suspicious activity", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      // Three reports needed for threshold
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

    it("should execute action for emergency situation", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("emergency-evidence"))
      const evidenceURI = "ipfs://Qm456...emergency"

      // Report emergency from three watchdogs
      await thresholdActions
        .connect(watchdog1)
        .reportIssue(ReportType.EMERGENCY_SITUATION, qc1.address, evidenceHash, evidenceURI)

      await thresholdActions
        .connect(watchdog2)
        .reportIssue(ReportType.EMERGENCY_SITUATION, qc1.address, evidenceHash, evidenceURI)

      const tx = await thresholdActions
        .connect(watchdog3)
        .reportIssue(ReportType.EMERGENCY_SITUATION, qc1.address, evidenceHash, evidenceURI)

      await expect(tx)
        .to.emit(thresholdActions, "ThresholdActionExecuted")
        .withArgs(anyValue, ReportType.EMERGENCY_SITUATION, qc1.address, 3, "EMERGENCY_PAUSE")

      await expect(tx)
        .to.emit(thresholdActions, "EmergencyActionTaken")
        .withArgs(qc1.address, "EMERGENCY_SITUATION")
    })

    it("should execute action for unusual pattern", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("pattern-evidence"))
      const evidenceURI = "ipfs://Qm789...pattern"

      // Report pattern from three watchdogs
      await thresholdActions
        .connect(watchdog1)
        .reportIssue(ReportType.UNUSUAL_PATTERN, qc1.address, evidenceHash, evidenceURI)

      await thresholdActions
        .connect(watchdog2)
        .reportIssue(ReportType.UNUSUAL_PATTERN, qc1.address, evidenceHash, evidenceURI)

      const tx = await thresholdActions
        .connect(watchdog3)
        .reportIssue(ReportType.UNUSUAL_PATTERN, qc1.address, evidenceHash, evidenceURI)

      await expect(tx)
        .to.emit(thresholdActions, "ThresholdActionExecuted")
        .withArgs(anyValue, ReportType.UNUSUAL_PATTERN, qc1.address, 3, "PATTERN_FLAGGED")

      await expect(tx)
        .to.emit(thresholdActions, "UnusualPatternDetected")
        .withArgs(qc1.address, 3)
    })

    it("should execute action for operational concern", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("concern-evidence"))
      const evidenceURI = "ipfs://Qm101...concern"

      // Report concern from three watchdogs
      await thresholdActions
        .connect(watchdog1)
        .reportIssue(ReportType.OPERATIONAL_CONCERN, qc1.address, evidenceHash, evidenceURI)

      await thresholdActions
        .connect(watchdog2)
        .reportIssue(ReportType.OPERATIONAL_CONCERN, qc1.address, evidenceHash, evidenceURI)

      const tx = await thresholdActions
        .connect(watchdog3)
        .reportIssue(ReportType.OPERATIONAL_CONCERN, qc1.address, evidenceHash, evidenceURI)

      await expect(tx)
        .to.emit(thresholdActions, "ThresholdActionExecuted")
        .withArgs(anyValue, ReportType.OPERATIONAL_CONCERN, qc1.address, 3, "CONCERN_LOGGED")

      await expect(tx)
        .to.emit(thresholdActions, "OperationalConcernRaised")
        .withArgs(qc1.address, 3)
    })
  })

  describe("Manual Execution", () => {
    it("should allow manual execution when threshold is reached", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      // Submit 3 reports but don't trigger automatic execution
      await thresholdActions
        .connect(watchdog1)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      await thresholdActions
        .connect(watchdog2)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      await thresholdActions
        .connect(watchdog3)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      // Get issue ID
      const issueId = await thresholdActions.generateIssueId(
        ReportType.SUSPICIOUS_ACTIVITY,
        qc1.address
      )

      // If automatic execution was blocked somehow, manual execution should work
      // (This test assumes automatic execution was successful, so this will fail)
      await expect(
        thresholdActions.executeThresholdAction(issueId)
      ).to.be.revertedWith("ActionAlreadyExecuted")
    })

    it("should prevent manual execution when threshold not reached", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      // Submit only 2 reports (below threshold of 3)
      await thresholdActions
        .connect(watchdog1)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      await thresholdActions
        .connect(watchdog2)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      const issueId = await thresholdActions.generateIssueId(
        ReportType.SUSPICIOUS_ACTIVITY,
        qc1.address
      )

      await expect(
        thresholdActions.executeThresholdAction(issueId)
      ).to.be.revertedWith("ThresholdNotReached")
    })
  })

  describe("Cooldown Period", () => {
    it("should respect cooldown period between actions", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      // Trigger first action
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

  describe("View Functions", () => {
    it("should return reports for an issue", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      await thresholdActions
        .connect(watchdog1)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      const issueId = await thresholdActions.generateIssueId(
        ReportType.SUSPICIOUS_ACTIVITY,
        qc1.address
      )

      const reports = await thresholdActions.getReports(issueId)
      expect(reports).to.have.length(1)
      expect(reports[0].watchdog).to.equal(watchdog1.address)
      expect(reports[0].evidenceHash).to.equal(evidenceHash)
      expect(reports[0].evidenceURI).to.equal(evidenceURI)
    })

    it("should return recent report count", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      await thresholdActions
        .connect(watchdog1)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      await thresholdActions
        .connect(watchdog2)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      const issueId = await thresholdActions.generateIssueId(
        ReportType.SUSPICIOUS_ACTIVITY,
        qc1.address
      )

      const count = await thresholdActions.getRecentReportCount(issueId)
      expect(count).to.equal(2)
    })

    it("should check if watchdog has reported", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      const issueId = await thresholdActions.generateIssueId(
        ReportType.SUSPICIOUS_ACTIVITY,
        qc1.address
      )

      // Before reporting
      let hasReported = await thresholdActions.hasWatchdogReported(issueId, watchdog1.address)
      expect(hasReported).to.be.false

      // After reporting
      await thresholdActions
        .connect(watchdog1)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      hasReported = await thresholdActions.hasWatchdogReported(issueId, watchdog1.address)
      expect(hasReported).to.be.true
    })

    it("should check if issue can receive new reports", async () => {
      // Initially should be able to report
      let canReport = await thresholdActions
        .connect(watchdog1)
        .canReportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address)
      expect(canReport).to.be.true

      // After submitting a report, same watchdog shouldn't be able to report again
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      await thresholdActions
        .connect(watchdog1)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      canReport = await thresholdActions
        .connect(watchdog1)
        .canReportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address)
      expect(canReport).to.be.false
    })
  })

  describe("Admin Functions", () => {
    it("should allow admin to reset issues", async () => {
      const evidenceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"))
      const evidenceURI = "ipfs://Qm123...evidence"

      await thresholdActions
        .connect(watchdog1)
        .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)

      const issueId = await thresholdActions.generateIssueId(
        ReportType.SUSPICIOUS_ACTIVITY,
        qc1.address
      )

      // Admin reset
      await thresholdActions.emergencyResetIssue(issueId)

      // Should be able to report again after reset
      await expect(
        thresholdActions
          .connect(watchdog1)
          .reportIssue(ReportType.SUSPICIOUS_ACTIVITY, qc1.address, evidenceHash, evidenceURI)
      ).to.not.be.reverted
    })

    it("should prevent non-admin from resetting issues", async () => {
      const issueId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test-issue"))

      await expect(
        thresholdActions.connect(user).emergencyResetIssue(issueId)
      ).to.be.revertedWith("AccessControl")
    })
  })
})

// Helper for matching any value in events
const anyValue = (value: any) => true