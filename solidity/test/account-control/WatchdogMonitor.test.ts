import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  WatchdogMonitor,
  WatchdogConsensusManager,
  QCData,
  QCWatchdog,
  ProtocolRegistry,
} from "../../typechain"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("WatchdogMonitor", () => {
  let deployer: SignerWithAddress
  let manager: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let watchdog4: SignerWithAddress
  let watchdog5: SignerWithAddress
  let qcAddress: SignerWithAddress
  let thirdParty: SignerWithAddress

  let watchdogMonitor: WatchdogMonitor
  let mockConsensusManager: FakeContract<WatchdogConsensusManager>
  let mockQcData: FakeContract<QCData>
  let mockWatchdogContract1: FakeContract<QCWatchdog>
  let mockWatchdogContract2: FakeContract<QCWatchdog>
  let mockWatchdogContract3: FakeContract<QCWatchdog>
  let mockProtocolRegistry: FakeContract<ProtocolRegistry>

  // Roles
  let MANAGER_ROLE: string
  let WATCHDOG_OPERATOR_ROLE: string
  let DEFAULT_ADMIN_ROLE: string

  // Constants from contract
  const CRITICAL_REPORTS_THRESHOLD = 3
  const REPORT_VALIDITY_PERIOD = 3600 // 1 hour

  before(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;[
      deployer,
      manager,
      watchdog1,
      watchdog2,
      watchdog3,
      watchdog4,
      watchdog5,
      qcAddress,
      thirdParty,
    ] = await ethers.getSigners()

    // Generate role hashes
    MANAGER_ROLE = ethers.utils.id("MANAGER_ROLE")
    WATCHDOG_OPERATOR_ROLE = ethers.utils.id("WATCHDOG_OPERATOR_ROLE")
    DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy mocks
    mockConsensusManager = await smock.fake<WatchdogConsensusManager>(
      "WatchdogConsensusManager"
    )
    mockQcData = await smock.fake<QCData>("QCData")
    
    // Create mock watchdog contracts
    mockWatchdogContract1 = await smock.fake<QCWatchdog>("QCWatchdog")
    mockWatchdogContract2 = await smock.fake<QCWatchdog>("QCWatchdog")
    mockWatchdogContract3 = await smock.fake<QCWatchdog>("QCWatchdog")
    mockProtocolRegistry = await smock.fake<ProtocolRegistry>("ProtocolRegistry")

    // Setup mock returns
    mockWatchdogContract1.protocolRegistry.returns(mockProtocolRegistry.address)
    mockWatchdogContract2.protocolRegistry.returns(mockProtocolRegistry.address)
    mockWatchdogContract3.protocolRegistry.returns(mockProtocolRegistry.address)

    // Deploy WatchdogMonitor
    const WatchdogMonitor = await ethers.getContractFactory("WatchdogMonitor")
    watchdogMonitor = await WatchdogMonitor.deploy(
      mockConsensusManager.address,
      mockQcData.address
    )
    await watchdogMonitor.deployed()

    // Grant manager role
    await watchdogMonitor
      .connect(deployer)
      .grantRole(MANAGER_ROLE, manager.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment", () => {
    it("should set correct consensus manager", async () => {
      expect(await watchdogMonitor.consensusManager()).to.equal(
        mockConsensusManager.address
      )
    })

    it("should set correct QC data", async () => {
      expect(await watchdogMonitor.qcData()).to.equal(mockQcData.address)
    })

    it("should grant deployer admin and manager roles", async () => {
      expect(
        await watchdogMonitor.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)
      ).to.be.true
      expect(
        await watchdogMonitor.hasRole(MANAGER_ROLE, deployer.address)
      ).to.be.true
    })

    it("should have correct threshold constants", async () => {
      expect(await watchdogMonitor.CRITICAL_REPORTS_THRESHOLD()).to.equal(
        CRITICAL_REPORTS_THRESHOLD
      )
      expect(await watchdogMonitor.REPORT_VALIDITY_PERIOD()).to.equal(
        REPORT_VALIDITY_PERIOD
      )
    })
  })

  describe("Watchdog Management", () => {
    describe("registerWatchdog", () => {
      it("should successfully register a new watchdog", async () => {
        const identifier = "Watchdog Alpha"
        
        const tx = await watchdogMonitor
          .connect(manager)
          .registerWatchdog(
            mockWatchdogContract1.address,
            watchdog1.address,
            identifier
          )

        await expect(tx)
          .to.emit(watchdogMonitor, "WatchdogRegistered")
          .withArgs(
            mockWatchdogContract1.address,
            watchdog1.address,
            identifier
          )

        // Verify storage
        const info = await watchdogMonitor.watchdogs(watchdog1.address)
        expect(info.watchdogContract).to.equal(mockWatchdogContract1.address)
        expect(info.operator).to.equal(watchdog1.address)
        expect(info.active).to.be.true
        expect(info.identifier).to.equal(identifier)

        // Verify mappings
        expect(
          await watchdogMonitor.isWatchdogContract(mockWatchdogContract1.address)
        ).to.be.true

        // Verify active watchdogs array
        expect(await watchdogMonitor.getActiveWatchdogCount()).to.equal(1)
      })

      it("should grant watchdog role in consensus manager", async () => {
        await watchdogMonitor
          .connect(manager)
          .registerWatchdog(
            mockWatchdogContract1.address,
            watchdog1.address,
            "Test"
          )

        expect(mockConsensusManager.grantRole).to.have.been.calledWith(
          await mockConsensusManager.WATCHDOG_ROLE(),
          watchdog1.address
        )
      })

      it("should revert if watchdog already registered", async () => {
        await watchdogMonitor
          .connect(manager)
          .registerWatchdog(
            mockWatchdogContract1.address,
            watchdog1.address,
            "Test"
          )

        await expect(
          watchdogMonitor
            .connect(manager)
            .registerWatchdog(
              mockWatchdogContract2.address,
              watchdog1.address,
              "Test2"
            )
        ).to.be.revertedWith("WatchdogAlreadyRegistered")
      })

      it("should revert if invalid watchdog contract", async () => {
        const invalidContract = thirdParty.address // Not a QCWatchdog contract

        await expect(
          watchdogMonitor
            .connect(manager)
            .registerWatchdog(invalidContract, watchdog1.address, "Test")
        ).to.be.revertedWith("InvalidWatchdog")
      })

      it("should revert if called by non-manager", async () => {
        await expect(
          watchdogMonitor
            .connect(thirdParty)
            .registerWatchdog(
              mockWatchdogContract1.address,
              watchdog1.address,
              "Test"
            )
        ).to.be.revertedWith("AccessControl")
      })

      it("should handle registering multiple watchdogs", async () => {
        // Register 3 watchdogs
        await watchdogMonitor
          .connect(manager)
          .registerWatchdog(
            mockWatchdogContract1.address,
            watchdog1.address,
            "Alpha"
          )
        
        await watchdogMonitor
          .connect(manager)
          .registerWatchdog(
            mockWatchdogContract2.address,
            watchdog2.address,
            "Beta"
          )
        
        await watchdogMonitor
          .connect(manager)
          .registerWatchdog(
            mockWatchdogContract3.address,
            watchdog3.address,
            "Gamma"
          )

        expect(await watchdogMonitor.getActiveWatchdogCount()).to.equal(3)
      })
    })

    describe("deactivateWatchdog", () => {
      beforeEach(async () => {
        // Register watchdogs first
        await watchdogMonitor
          .connect(manager)
          .registerWatchdog(
            mockWatchdogContract1.address,
            watchdog1.address,
            "Alpha"
          )
        
        await watchdogMonitor
          .connect(manager)
          .registerWatchdog(
            mockWatchdogContract2.address,
            watchdog2.address,
            "Beta"
          )
      })

      it("should successfully deactivate a watchdog", async () => {
        const tx = await watchdogMonitor
          .connect(manager)
          .deactivateWatchdog(watchdog1.address)

        await expect(tx)
          .to.emit(watchdogMonitor, "WatchdogDeactivated")
          .withArgs(mockWatchdogContract1.address, watchdog1.address)

        // Verify storage
        const info = await watchdogMonitor.watchdogs(watchdog1.address)
        expect(info.active).to.be.false

        // Verify mappings
        expect(
          await watchdogMonitor.isWatchdogContract(mockWatchdogContract1.address)
        ).to.be.false

        // Verify active watchdogs array
        expect(await watchdogMonitor.getActiveWatchdogCount()).to.equal(1)
      })

      it("should revoke watchdog role in consensus manager", async () => {
        await watchdogMonitor
          .connect(manager)
          .deactivateWatchdog(watchdog1.address)

        expect(mockConsensusManager.revokeRole).to.have.been.calledWith(
          await mockConsensusManager.WATCHDOG_ROLE(),
          watchdog1.address
        )
      })

      it("should maintain array integrity when deactivating", async () => {
        // Register a third watchdog
        await watchdogMonitor
          .connect(manager)
          .registerWatchdog(
            mockWatchdogContract3.address,
            watchdog3.address,
            "Gamma"
          )

        // Deactivate the middle watchdog
        await watchdogMonitor
          .connect(manager)
          .deactivateWatchdog(watchdog2.address)

        expect(await watchdogMonitor.getActiveWatchdogCount()).to.equal(2)
        
        // Verify remaining watchdogs are still active
        expect(
          (await watchdogMonitor.watchdogs(watchdog1.address)).active
        ).to.be.true
        expect(
          (await watchdogMonitor.watchdogs(watchdog3.address)).active
        ).to.be.true
      })

      it("should revert if watchdog not active", async () => {
        await expect(
          watchdogMonitor
            .connect(manager)
            .deactivateWatchdog(watchdog3.address)
        ).to.be.revertedWith("WatchdogNotActive")
      })

      it("should revert if called by non-manager", async () => {
        await expect(
          watchdogMonitor
            .connect(thirdParty)
            .deactivateWatchdog(watchdog1.address)
        ).to.be.revertedWith("AccessControl")
      })
    })

    describe("Edge Cases - Watchdog Management", () => {
      it("should handle deactivating last watchdog", async () => {
        await watchdogMonitor
          .connect(manager)
          .registerWatchdog(
            mockWatchdogContract1.address,
            watchdog1.address,
            "Solo"
          )

        await watchdogMonitor
          .connect(manager)
          .deactivateWatchdog(watchdog1.address)

        expect(await watchdogMonitor.getActiveWatchdogCount()).to.equal(0)
      })

      it("should prevent registering with zero address", async () => {
        await expect(
          watchdogMonitor
            .connect(manager)
            .registerWatchdog(
              ethers.constants.AddressZero,
              watchdog1.address,
              "Test"
            )
        ).to.be.revertedWith("InvalidWatchdog")
      })

      it("should handle empty identifier", async () => {
        // Empty identifier should be allowed
        await expect(
          watchdogMonitor
            .connect(manager)
            .registerWatchdog(
              mockWatchdogContract1.address,
              watchdog1.address,
              ""
            )
        ).to.not.be.reverted
      })
    })
  })

  describe("Critical Reporting", () => {
    beforeEach(async () => {
      // Register and grant roles to watchdogs
      await watchdogMonitor
        .connect(manager)
        .registerWatchdog(
          mockWatchdogContract1.address,
          watchdog1.address,
          "Alpha"
        )
      
      await watchdogMonitor
        .connect(manager)
        .registerWatchdog(
          mockWatchdogContract2.address,
          watchdog2.address,
          "Beta"
        )
      
      await watchdogMonitor
        .connect(manager)
        .registerWatchdog(
          mockWatchdogContract3.address,
          watchdog3.address,
          "Gamma"
        )

      // Grant watchdog operator roles
      await watchdogMonitor
        .connect(deployer)
        .grantRole(WATCHDOG_OPERATOR_ROLE, watchdog1.address)
      
      await watchdogMonitor
        .connect(deployer)
        .grantRole(WATCHDOG_OPERATOR_ROLE, watchdog2.address)
      
      await watchdogMonitor
        .connect(deployer)
        .grantRole(WATCHDOG_OPERATOR_ROLE, watchdog3.address)
    })

    describe("submitCriticalReport", () => {
      it("should successfully submit a critical report", async () => {
        const reason = "Suspicious 40% reserve decrease detected"

        const tx = await watchdogMonitor
          .connect(watchdog1)
          .submitCriticalReport(qcAddress.address, reason)

        await expect(tx)
          .to.emit(watchdogMonitor, "CriticalReportSubmitted")
          .withArgs(qcAddress.address, watchdog1.address, reason, 1)

        // Verify report storage
        const reports = await watchdogMonitor.getCriticalReports(
          qcAddress.address
        )
        expect(reports.length).to.equal(1)
        expect(reports[0].qc).to.equal(qcAddress.address)
        expect(reports[0].reporter).to.equal(watchdog1.address)
        expect(reports[0].reason).to.equal(reason)
      })

      it("should count recent reports correctly", async () => {
        // Submit 2 reports
        await watchdogMonitor
          .connect(watchdog1)
          .submitCriticalReport(qcAddress.address, "Report 1")

        await watchdogMonitor
          .connect(watchdog2)
          .submitCriticalReport(qcAddress.address, "Report 2")

        expect(
          await watchdogMonitor.getRecentReportCount(qcAddress.address)
        ).to.equal(2)
      })

      it("should trigger emergency pause at threshold", async () => {
        // Submit reports up to threshold
        await watchdogMonitor
          .connect(watchdog1)
          .submitCriticalReport(qcAddress.address, "Report 1")

        await watchdogMonitor
          .connect(watchdog2)
          .submitCriticalReport(qcAddress.address, "Report 2")

        // Third report should trigger emergency
        const tx = await watchdogMonitor
          .connect(watchdog3)
          .submitCriticalReport(qcAddress.address, "Report 3 - Critical")

        await expect(tx)
          .to.emit(watchdogMonitor, "EmergencyPauseTriggered")
          .withArgs(
            qcAddress.address,
            CRITICAL_REPORTS_THRESHOLD,
            watchdog3.address
          )

        expect(
          await watchdogMonitor.isEmergencyPaused(qcAddress.address)
        ).to.be.true
      })

      it("should not double-trigger emergency pause", async () => {
        // Reach threshold
        await watchdogMonitor
          .connect(watchdog1)
          .submitCriticalReport(qcAddress.address, "Report 1")
        await watchdogMonitor
          .connect(watchdog2)
          .submitCriticalReport(qcAddress.address, "Report 2")
        await watchdogMonitor
          .connect(watchdog3)
          .submitCriticalReport(qcAddress.address, "Report 3")

        // Fourth report should not trigger again
        const tx = await watchdogMonitor
          .connect(watchdog1)
          .submitCriticalReport(qcAddress.address, "Report 4")

        // Should emit report but not emergency trigger
        await expect(tx)
          .to.emit(watchdogMonitor, "CriticalReportSubmitted")
          .and.not.emit(watchdogMonitor, "EmergencyPauseTriggered")
      })

      it("should revert if watchdog not active", async () => {
        await watchdogMonitor
          .connect(manager)
          .deactivateWatchdog(watchdog1.address)

        await expect(
          watchdogMonitor
            .connect(watchdog1)
            .submitCriticalReport(qcAddress.address, "Invalid report")
        ).to.be.revertedWith("WatchdogNotActive")
      })

      it("should revert if not watchdog operator", async () => {
        await expect(
          watchdogMonitor
            .connect(thirdParty)
            .submitCriticalReport(qcAddress.address, "Invalid report")
        ).to.be.revertedWith("AccessControl")
      })
    })

    describe("Report Validity and Cleanup", () => {
      it("should ignore expired reports in count", async () => {
        // Submit a report
        await watchdogMonitor
          .connect(watchdog1)
          .submitCriticalReport(qcAddress.address, "Old report")

        // Advance time beyond validity period
        await helpers.time.increase(REPORT_VALIDITY_PERIOD + 1)

        // Submit new report
        await watchdogMonitor
          .connect(watchdog2)
          .submitCriticalReport(qcAddress.address, "New report")

        // Should only count the new report
        expect(
          await watchdogMonitor.getRecentReportCount(qcAddress.address)
        ).to.equal(1)
      })

      it("should clean up old reports", async () => {
        // Submit multiple reports
        await watchdogMonitor
          .connect(watchdog1)
          .submitCriticalReport(qcAddress.address, "Report 1")

        await helpers.time.increase(REPORT_VALIDITY_PERIOD / 2)

        await watchdogMonitor
          .connect(watchdog2)
          .submitCriticalReport(qcAddress.address, "Report 2")

        // Advance time so first report expires
        await helpers.time.increase(REPORT_VALIDITY_PERIOD / 2 + 1)

        // Clean up
        await watchdogMonitor.cleanupOldReports(qcAddress.address)

        const reports = await watchdogMonitor.getCriticalReports(
          qcAddress.address
        )
        expect(reports.length).to.equal(1)
        expect(reports[0].reason).to.equal("Report 2")
      })
    })

    describe("Edge Cases - Critical Reporting", () => {
      it("should handle report at exact validity boundary", async () => {
        await watchdogMonitor
          .connect(watchdog1)
          .submitCriticalReport(qcAddress.address, "Boundary report")

        // Advance to exact boundary
        await helpers.time.increase(REPORT_VALIDITY_PERIOD)

        // Report should still be valid
        expect(
          await watchdogMonitor.getRecentReportCount(qcAddress.address)
        ).to.equal(1)

        // One second later, should be invalid
        await helpers.time.increase(1)
        expect(
          await watchdogMonitor.getRecentReportCount(qcAddress.address)
        ).to.equal(0)
      })

      it("should handle multiple reports from same watchdog", async () => {
        await watchdogMonitor
          .connect(watchdog1)
          .submitCriticalReport(qcAddress.address, "Report 1")

        await watchdogMonitor
          .connect(watchdog1)
          .submitCriticalReport(qcAddress.address, "Report 2")

        // Both reports should be stored
        const reports = await watchdogMonitor.getCriticalReports(
          qcAddress.address
        )
        expect(reports.length).to.equal(2)
        expect(reports[0].reporter).to.equal(watchdog1.address)
        expect(reports[1].reporter).to.equal(watchdog1.address)
      })

      it("should handle empty reason string", async () => {
        await expect(
          watchdogMonitor
            .connect(watchdog1)
            .submitCriticalReport(qcAddress.address, "")
        ).to.not.be.reverted
      })

      it("should generate unique report hashes", async () => {
        // Submit similar reports
        await watchdogMonitor
          .connect(watchdog1)
          .submitCriticalReport(qcAddress.address, "Duplicate reason")

        await watchdogMonitor
          .connect(watchdog1)
          .submitCriticalReport(qcAddress.address, "Duplicate reason")

        const reports = await watchdogMonitor.getCriticalReports(
          qcAddress.address
        )
        
        // Report hashes should be different due to timestamp
        expect(reports[0].reportHash).to.not.equal(reports[1].reportHash)
      })
    })
  })

  describe("Emergency Response", () => {
    beforeEach(async () => {
      // Setup watchdogs with roles
      await watchdogMonitor
        .connect(manager)
        .registerWatchdog(
          mockWatchdogContract1.address,
          watchdog1.address,
          "Alpha"
        )
      
      await watchdogMonitor
        .connect(manager)
        .registerWatchdog(
          mockWatchdogContract2.address,
          watchdog2.address,
          "Beta"
        )
      
      await watchdogMonitor
        .connect(manager)
        .registerWatchdog(
          mockWatchdogContract3.address,
          watchdog3.address,
          "Gamma"
        )

      await watchdogMonitor
        .connect(deployer)
        .grantRole(WATCHDOG_OPERATOR_ROLE, watchdog1.address)
      
      await watchdogMonitor
        .connect(deployer)
        .grantRole(WATCHDOG_OPERATOR_ROLE, watchdog2.address)
      
      await watchdogMonitor
        .connect(deployer)
        .grantRole(WATCHDOG_OPERATOR_ROLE, watchdog3.address)

      // Trigger emergency pause
      await watchdogMonitor
        .connect(watchdog1)
        .submitCriticalReport(qcAddress.address, "Critical 1")
      await watchdogMonitor
        .connect(watchdog2)
        .submitCriticalReport(qcAddress.address, "Critical 2")
      await watchdogMonitor
        .connect(watchdog3)
        .submitCriticalReport(qcAddress.address, "Critical 3")
    })

    describe("clearEmergencyPause", () => {
      it("should successfully clear emergency pause", async () => {
        expect(
          await watchdogMonitor.isEmergencyPaused(qcAddress.address)
        ).to.be.true

        const tx = await watchdogMonitor
          .connect(manager)
          .clearEmergencyPause(qcAddress.address)

        await expect(tx)
          .to.emit(watchdogMonitor, "EmergencyPauseCleared")
          .withArgs(qcAddress.address, manager.address)

        expect(
          await watchdogMonitor.isEmergencyPaused(qcAddress.address)
        ).to.be.false
      })

      it("should clear all reports when clearing emergency", async () => {
        await watchdogMonitor
          .connect(manager)
          .clearEmergencyPause(qcAddress.address)

        const reports = await watchdogMonitor.getCriticalReports(
          qcAddress.address
        )
        expect(reports.length).to.equal(0)
      })

      it("should revert if not paused", async () => {
        await watchdogMonitor
          .connect(manager)
          .clearEmergencyPause(qcAddress.address)

        await expect(
          watchdogMonitor
            .connect(manager)
            .clearEmergencyPause(qcAddress.address)
        ).to.be.revertedWith("NotPaused")
      })

      it("should revert if called by non-manager", async () => {
        await expect(
          watchdogMonitor
            .connect(thirdParty)
            .clearEmergencyPause(qcAddress.address)
        ).to.be.revertedWith("AccessControl")
      })
    })

    describe("Emergency Coordination", () => {
      it("should maintain emergency state across operations", async () => {
        // Emergency is active
        expect(
          await watchdogMonitor.isEmergencyPaused(qcAddress.address)
        ).to.be.true

        // Submit more reports - should not affect emergency state
        await watchdogMonitor
          .connect(watchdog1)
          .submitCriticalReport(qcAddress.address, "Additional report")

        expect(
          await watchdogMonitor.isEmergencyPaused(qcAddress.address)
        ).to.be.true
      })

      it("should handle multiple QC emergencies independently", async () => {
        const qc2 = watchdog4 // Using as second QC address

        // QC1 is already in emergency
        expect(
          await watchdogMonitor.isEmergencyPaused(qcAddress.address)
        ).to.be.true

        // QC2 should not be affected
        expect(await watchdogMonitor.isEmergencyPaused(qc2.address)).to.be.false

        // Trigger emergency for QC2
        await watchdogMonitor
          .connect(watchdog1)
          .submitCriticalReport(qc2.address, "QC2 Report 1")
        await watchdogMonitor
          .connect(watchdog2)
          .submitCriticalReport(qc2.address, "QC2 Report 2")
        await watchdogMonitor
          .connect(watchdog3)
          .submitCriticalReport(qc2.address, "QC2 Report 3")

        // Both should be in emergency
        expect(
          await watchdogMonitor.isEmergencyPaused(qcAddress.address)
        ).to.be.true
        expect(await watchdogMonitor.isEmergencyPaused(qc2.address)).to.be.true

        // Clear one emergency
        await watchdogMonitor
          .connect(manager)
          .clearEmergencyPause(qcAddress.address)

        // Only one should be cleared
        expect(
          await watchdogMonitor.isEmergencyPaused(qcAddress.address)
        ).to.be.false
        expect(await watchdogMonitor.isEmergencyPaused(qc2.address)).to.be.true
      })
    })
  })

  describe("View Functions", () => {
    beforeEach(async () => {
      await watchdogMonitor
        .connect(manager)
        .registerWatchdog(
          mockWatchdogContract1.address,
          watchdog1.address,
          "Test Watchdog"
        )
    })

    it("should return correct watchdog info", async () => {
      const [
        watchdogContract,
        active,
        registrationTime,
        identifier,
      ] = await watchdogMonitor.getWatchdogInfo(watchdog1.address)

      expect(watchdogContract).to.equal(mockWatchdogContract1.address)
      expect(active).to.be.true
      expect(registrationTime).to.be.gt(0)
      expect(identifier).to.equal("Test Watchdog")
    })

    it("should return correct active watchdog status", async () => {
      expect(
        await watchdogMonitor.isActiveWatchdog(watchdog1.address)
      ).to.be.true
      expect(
        await watchdogMonitor.isActiveWatchdog(watchdog2.address)
      ).to.be.false
    })

    it("should return empty info for non-existent watchdog", async () => {
      const [
        watchdogContract,
        active,
        registrationTime,
        identifier,
      ] = await watchdogMonitor.getWatchdogInfo(thirdParty.address)

      expect(watchdogContract).to.equal(ethers.constants.AddressZero)
      expect(active).to.be.false
      expect(registrationTime).to.equal(0)
      expect(identifier).to.equal("")
    })
  })

  describe("Integration with Consensus Manager", () => {
    it("should properly integrate with consensus manager on registration", async () => {
      await watchdogMonitor
        .connect(manager)
        .registerWatchdog(
          mockWatchdogContract1.address,
          watchdog1.address,
          "Integration Test"
        )

      // Verify consensus manager interaction
      expect(mockConsensusManager.grantRole).to.have.been.called
    })

    it("should properly integrate with consensus manager on deactivation", async () => {
      await watchdogMonitor
        .connect(manager)
        .registerWatchdog(
          mockWatchdogContract1.address,
          watchdog1.address,
          "Integration Test"
        )

      await watchdogMonitor
        .connect(manager)
        .deactivateWatchdog(watchdog1.address)

      // Verify consensus manager interaction
      expect(mockConsensusManager.revokeRole).to.have.been.called
    })
  })
})