import { ethers, deployments, helpers } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber } from "ethers"
import {
  QCWatchdog,
  WatchdogMonitor,
  SystemState,
  QCManager,
  QCReserveLedger,
  QCRedeemer,
} from "../../typechain"

const HOUR = 3600
const MINUTE = 60

describe("WatchdogMonitor Emergency Detection Tests", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let watchdog4: SignerWithAddress
  let emergencyCouncil: SignerWithAddress

  let watchdogMonitor: WatchdogMonitor
  let systemState: SystemState
  let qcManager: QCManager
  let qcReserveLedger: QCReserveLedger
  let qcRedeemer: QCRedeemer

  let qcWatchdog1: QCWatchdog
  let qcWatchdog2: QCWatchdog
  let qcWatchdog3: QCWatchdog
  let qcWatchdog4: QCWatchdog

  beforeEach(async () => {
    await deployments.fixture(["AccountControl"])
    ;({ deployer, governance } = await helpers.signers.getNamedSigners())
    ;[watchdog1, watchdog2, watchdog3, watchdog4, emergencyCouncil] = 
      await helpers.signers.getUnnamedSigners()

    // Get deployed contracts
    watchdogMonitor = await helpers.contracts.getContract("WatchdogMonitor")
    systemState = await helpers.contracts.getContract("SystemState")
    qcManager = await helpers.contracts.getContract("QCManager")
    qcReserveLedger = await helpers.contracts.getContract("QCReserveLedger")
    qcRedeemer = await helpers.contracts.getContract("QCRedeemer")

    // Deploy watchdog instances
    const QCWatchdog = await ethers.getContractFactory("QCWatchdog")
    qcWatchdog1 = await QCWatchdog.deploy(
      qcManager.address,
      qcReserveLedger.address,
      qcRedeemer.address,
      systemState.address
    )
    qcWatchdog2 = await QCWatchdog.deploy(
      qcManager.address,
      qcReserveLedger.address,
      qcRedeemer.address,
      systemState.address
    )
    qcWatchdog3 = await QCWatchdog.deploy(
      qcManager.address,
      qcReserveLedger.address,
      qcRedeemer.address,
      systemState.address
    )
    qcWatchdog4 = await QCWatchdog.deploy(
      qcManager.address,
      qcReserveLedger.address,
      qcRedeemer.address,
      systemState.address
    )

    // Grant operator roles
    await qcWatchdog1.grantRole(await qcWatchdog1.WATCHDOG_OPERATOR_ROLE(), watchdog1.address)
    await qcWatchdog2.grantRole(await qcWatchdog2.WATCHDOG_OPERATOR_ROLE(), watchdog2.address)
    await qcWatchdog3.grantRole(await qcWatchdog3.WATCHDOG_OPERATOR_ROLE(), watchdog3.address)
    await qcWatchdog4.grantRole(await qcWatchdog4.WATCHDOG_OPERATOR_ROLE(), watchdog4.address)

    // Register watchdogs
    await watchdogMonitor.connect(governance).registerWatchdog(qcWatchdog1.address, "Watchdog 1")
    await watchdogMonitor.connect(governance).registerWatchdog(qcWatchdog2.address, "Watchdog 2")
    await watchdogMonitor.connect(governance).registerWatchdog(qcWatchdog3.address, "Watchdog 3")
    await watchdogMonitor.connect(governance).registerWatchdog(qcWatchdog4.address, "Watchdog 4")

    // Set emergency council
    await systemState.connect(governance).grantRole(
      await systemState.PAUSER_ROLE(),
      emergencyCouncil.address
    )
  })

  describe("Emergency Report Threshold (3 reports/hour)", () => {
    it("should trigger emergency pause when 3 reports received within 1 hour", async () => {
      const issue = "Suspicious activity detected"

      // First report
      await expect(
        watchdogMonitor.connect(watchdog1).reportEmergency(
          qcWatchdog1.address,
          issue
        )
      )
        .to.emit(watchdogMonitor, "EmergencyReported")
        .withArgs(qcWatchdog1.address, watchdog1.address, issue)

      // Check no pause yet
      const pausedAfter1 = await systemState.allPaused()
      expect(pausedAfter1).to.be.false

      // Second report (different watchdog)
      await watchdogMonitor.connect(watchdog2).reportEmergency(
        qcWatchdog2.address,
        issue
      )

      // Still no pause
      const pausedAfter2 = await systemState.allPaused()
      expect(pausedAfter2).to.be.false

      // Third report triggers emergency
      await expect(
        watchdogMonitor.connect(watchdog3).reportEmergency(
          qcWatchdog3.address,
          issue
        )
      )
        .to.emit(watchdogMonitor, "EmergencyTriggered")
        .withArgs(3)

      // System should be paused
      const pausedAfter3 = await systemState.allPaused()
      expect(pausedAfter3).to.be.true
    })

    it("should not trigger emergency if reports are spread over more than 1 hour", async () => {
      const issue = "Minor concern"

      // First report
      await watchdogMonitor.connect(watchdog1).reportEmergency(
        qcWatchdog1.address,
        issue
      )

      // Second report after 30 minutes
      await helpers.time.increaseTime(30 * MINUTE)
      await watchdogMonitor.connect(watchdog2).reportEmergency(
        qcWatchdog2.address,
        issue
      )

      // Move past 1 hour window
      await helpers.time.increaseTime(35 * MINUTE)

      // Third report - should not trigger emergency as first report is outside window
      await expect(
        watchdogMonitor.connect(watchdog3).reportEmergency(
          qcWatchdog3.address,
          issue
        )
      ).to.not.emit(watchdogMonitor, "EmergencyTriggered")

      // System should not be paused
      const paused = await systemState.allPaused()
      expect(paused).to.be.false
    })

    it("should handle sliding window correctly", async () => {
      // Report 1 at t=0
      await watchdogMonitor.connect(watchdog1).reportEmergency(
        qcWatchdog1.address,
        "Issue 1"
      )

      // Report 2 at t=30min
      await helpers.time.increaseTime(30 * MINUTE)
      await watchdogMonitor.connect(watchdog2).reportEmergency(
        qcWatchdog2.address,
        "Issue 2"
      )

      // Report 3 at t=50min (still within 1 hour of report 1)
      await helpers.time.increaseTime(20 * MINUTE)
      await expect(
        watchdogMonitor.connect(watchdog3).reportEmergency(
          qcWatchdog3.address,
          "Issue 3"
        )
      )
        .to.emit(watchdogMonitor, "EmergencyTriggered")
        .withArgs(3)

      const paused = await systemState.allPaused()
      expect(paused).to.be.true
    })

    it("should count unique watchdog reports only", async () => {
      const issue = "Duplicate report test"

      // First report from watchdog1
      await watchdogMonitor.connect(watchdog1).reportEmergency(
        qcWatchdog1.address,
        issue
      )

      // Duplicate report from same watchdog (should be ignored)
      await expect(
        watchdogMonitor.connect(watchdog1).reportEmergency(
          qcWatchdog1.address,
          issue + " duplicate"
        )
      ).to.be.revertedWith("Watchdog already reported in current window")

      // Second unique report
      await watchdogMonitor.connect(watchdog2).reportEmergency(
        qcWatchdog2.address,
        issue
      )

      // Third unique report triggers emergency
      await expect(
        watchdogMonitor.connect(watchdog3).reportEmergency(
          qcWatchdog3.address,
          issue
        )
      )
        .to.emit(watchdogMonitor, "EmergencyTriggered")
        .withArgs(3)
    })
  })

  describe("Emergency Response Actions", () => {
    beforeEach(async () => {
      // Trigger emergency by having 3 reports
      await watchdogMonitor.connect(watchdog1).reportEmergency(
        qcWatchdog1.address,
        "Emergency test"
      )
      await watchdogMonitor.connect(watchdog2).reportEmergency(
        qcWatchdog2.address,
        "Emergency test"
      )
      await watchdogMonitor.connect(watchdog3).reportEmergency(
        qcWatchdog3.address,
        "Emergency test"
      )
    })

    it("should pause all system operations", async () => {
      // Verify all operations are paused
      expect(await systemState.allPaused()).to.be.true
      expect(await systemState.registrationsPaused()).to.be.true
      expect(await systemState.attestationsPaused()).to.be.true
      expect(await systemState.mintingPaused()).to.be.true
      expect(await systemState.redemptionsPaused()).to.be.true
    })

    it("should record emergency details", async () => {
      const emergencyCount = await watchdogMonitor.emergencyCount()
      expect(emergencyCount).to.equal(1)

      // Get recent reports (implementation would need getter)
      // This tests the concept - actual implementation would provide access
    })

    it("should allow emergency council to resolve", async () => {
      // Emergency council can unpause after investigation
      await systemState.connect(emergencyCouncil).unpauseAll()

      expect(await systemState.allPaused()).to.be.false
    })
  })

  describe("Report Window Management", () => {
    it("should reset report count after window expires", async () => {
      // Two reports within window
      await watchdogMonitor.connect(watchdog1).reportEmergency(
        qcWatchdog1.address,
        "Issue"
      )
      await watchdogMonitor.connect(watchdog2).reportEmergency(
        qcWatchdog2.address,
        "Issue"
      )

      // Move past 1 hour window
      await helpers.time.increaseTime(HOUR + 1)

      // Watchdog1 can report again
      await expect(
        watchdogMonitor.connect(watchdog1).reportEmergency(
          qcWatchdog1.address,
          "New issue"
        )
      ).to.not.be.reverted

      // Add two more reports - should trigger emergency
      await watchdogMonitor.connect(watchdog3).reportEmergency(
        qcWatchdog3.address,
        "New issue"
      )
      
      await expect(
        watchdogMonitor.connect(watchdog4).reportEmergency(
          qcWatchdog4.address,
          "New issue"
        )
      )
        .to.emit(watchdogMonitor, "EmergencyTriggered")
        .withArgs(3)
    })

    it("should handle reports at window boundaries correctly", async () => {
      // Report 1 at t=0
      await watchdogMonitor.connect(watchdog1).reportEmergency(
        qcWatchdog1.address,
        "Boundary test"
      )

      // Report 2 at t=59min59s
      await helpers.time.increaseTime(HOUR - 1)
      await watchdogMonitor.connect(watchdog2).reportEmergency(
        qcWatchdog2.address,
        "Boundary test"
      )

      // Report 3 at t=60min - should still trigger
      await helpers.time.increaseTime(1)
      await expect(
        watchdogMonitor.connect(watchdog3).reportEmergency(
          qcWatchdog3.address,
          "Boundary test"
        )
      )
        .to.emit(watchdogMonitor, "EmergencyTriggered")
        .withArgs(3)
    })
  })

  describe("Integration with System Recovery", () => {
    it("should support graduated response based on report count", async () => {
      // 1 report - logged but no action
      await watchdogMonitor.connect(watchdog1).reportEmergency(
        qcWatchdog1.address,
        "Minor issue"
      )
      expect(await systemState.allPaused()).to.be.false

      // 2 reports - heightened monitoring (in real impl)
      await watchdogMonitor.connect(watchdog2).reportEmergency(
        qcWatchdog2.address,
        "Growing concern"
      )
      expect(await systemState.allPaused()).to.be.false

      // 3 reports - emergency pause
      await watchdogMonitor.connect(watchdog3).reportEmergency(
        qcWatchdog3.address,
        "Critical issue"
      )
      expect(await systemState.allPaused()).to.be.true
    })

    it("should emit detailed events for monitoring", async () => {
      // Each report should emit detailed event
      await expect(
        watchdogMonitor.connect(watchdog1).reportEmergency(
          qcWatchdog1.address,
          "Detailed issue description"
        )
      )
        .to.emit(watchdogMonitor, "EmergencyReported")
        .withArgs(
          qcWatchdog1.address,
          watchdog1.address,
          "Detailed issue description"
        )

      // Emergency trigger should include count
      await watchdogMonitor.connect(watchdog2).reportEmergency(
        qcWatchdog2.address,
        "Issue 2"
      )
      
      await expect(
        watchdogMonitor.connect(watchdog3).reportEmergency(
          qcWatchdog3.address,
          "Issue 3"
        )
      )
        .to.emit(watchdogMonitor, "EmergencyTriggered")
        .withArgs(3)
    })
  })

  describe("Access Control and Security", () => {
    it("should only allow registered watchdogs to report", async () => {
      const unregisteredWatchdog = await helpers.signers.getUnnamedSigners().then(s => s[10])
      
      await expect(
        watchdogMonitor.connect(unregisteredWatchdog).reportEmergency(
          qcWatchdog1.address,
          "Unauthorized report"
        )
      ).to.be.revertedWith("Caller not operator of watchdog")
    })

    it("should prevent report spam from compromised watchdog", async () => {
      // First report succeeds
      await watchdogMonitor.connect(watchdog1).reportEmergency(
        qcWatchdog1.address,
        "First report"
      )

      // Immediate second report from same watchdog fails
      await expect(
        watchdogMonitor.connect(watchdog1).reportEmergency(
          qcWatchdog1.address,
          "Spam report"
        )
      ).to.be.revertedWith("Watchdog already reported in current window")

      // But other watchdogs can still report
      await expect(
        watchdogMonitor.connect(watchdog2).reportEmergency(
          qcWatchdog2.address,
          "Legitimate report"
        )
      ).to.not.be.reverted
    })

    it("should handle watchdog removal gracefully", async () => {
      // Report from watchdog1
      await watchdogMonitor.connect(watchdog1).reportEmergency(
        qcWatchdog1.address,
        "Issue before removal"
      )

      // Remove watchdog1
      await watchdogMonitor.connect(governance).removeWatchdog(qcWatchdog1.address)

      // Watchdog1 can no longer report
      await expect(
        watchdogMonitor.connect(watchdog1).reportEmergency(
          qcWatchdog1.address,
          "Post-removal report"
        )
      ).to.be.revertedWith("Watchdog not registered")

      // Other watchdogs can still trigger emergency
      await watchdogMonitor.connect(watchdog2).reportEmergency(
        qcWatchdog2.address,
        "Issue"
      )
      
      await expect(
        watchdogMonitor.connect(watchdog3).reportEmergency(
          qcWatchdog3.address,
          "Issue"
        )
      )
        .to.emit(watchdogMonitor, "EmergencyTriggered")
        .withArgs(3) // Still counts the pre-removal report
    })
  })
})