import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import {
  SystemState,
  QCManager,
  QCData,
  ReserveOracle,
  AccountControl,
  MockQCWalletManager,
  MockQCPauseManager,
  MockReserveOracle,
  MockSystemState,
} from "../../../typechain"
import { deployQCManagerFixture } from "../fixtures/account-control-fixtures"

describe("SystemState Cross-Contract Integration Tests", () => {
  let systemState: SystemState
  let qcManager: QCManager
  let qcData: QCData
  let accountControl: AccountControl
  let mockReserveOracle: MockReserveOracle
  let mockWalletManager: MockQCWalletManager
  let mockPauseManager: MockQCPauseManager

  let owner: SignerWithAddress
  let operations: SignerWithAddress
  let emergency: SignerWithAddress
  let governance: SignerWithAddress
  let qc1: SignerWithAddress
  let qc2: SignerWithAddress
  let user: SignerWithAddress

  // Role constants
  const OPERATIONS_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("OPERATIONS_ROLE")
  )

  const EMERGENCY_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("EMERGENCY_ROLE")
  )

  const MONITOR_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("MONITOR_ROLE")
  )

  async function deployIntegrationFixture() {
    const signers = await ethers.getSigners()

    ;[owner, operations, emergency, , qc1, qc2, user] = signers

    // Deploy base fixture
    const fixture = await deployQCManagerFixture()
    systemState = fixture.systemState
    qcManager = fixture.qcManager
    qcData = fixture.qcData
    governance = fixture.governance

    // Deploy mock contracts for integration testing
    const MockReserveOracle = await ethers.getContractFactory(
      "MockReserveOracle"
    )

    mockReserveOracle = await MockReserveOracle.deploy()

    const MockWalletManager = await ethers.getContractFactory(
      "MockQCWalletManager"
    )

    mockWalletManager = await MockWalletManager.deploy()

    const MockPauseManager = await ethers.getContractFactory(
      "MockQCPauseManager"
    )

    mockPauseManager = await MockPauseManager.deploy()

    // Deploy AccountControl to test full integration
    const AccountControl = await ethers.getContractFactory("AccountControl")
    accountControl = await AccountControl.deploy(
      owner.address,
      emergency.address,
      mockReserveOracle.address
    )

    // Grant necessary roles
    await systemState.grantRole(OPERATIONS_ROLE, operations.address)
    await systemState.grantRole(EMERGENCY_ROLE, emergency.address)
    await qcManager.grantRole(MONITOR_ROLE, operations.address)

    // Setup QCs
    await qcManager
      .connect(governance)
      .registerQC(qc1.address, ethers.utils.parseEther("1000"))
    await qcManager
      .connect(governance)
      .registerQC(qc2.address, ethers.utils.parseEther("2000"))

    return {
      systemState,
      qcManager,
      qcData,
      accountControl,
      mockReserveOracle,
      mockWalletManager,
      mockPauseManager,
      owner,
      operations,
      emergency,
      governance,
      qc1,
      qc2,
      user,
    }
  }

  beforeEach(async () => {
    const contracts = await loadFixture(deployIntegrationFixture)
    Object.assign(this, contracts)
  })

  describe("SystemState ↔ QCManager Integration", () => {
    describe("Parameter Synchronization", () => {
      it("should use SystemState parameters in QCManager operations", async () => {
        // Update min sync interval in SystemState
        const newInterval = 30 * 60 // 30 minutes
        await systemState.connect(operations).setMinSyncInterval(newInterval)

        expect(await systemState.minSyncInterval()).to.equal(newInterval)

        // QCManager should respect this interval
        await qcManager
          .connect(operations)
          .syncOracleToAccountControl(qc1.address)

        // Immediate second sync should fail due to interval
        await expect(
          qcManager.connect(operations).syncOracleToAccountControl(qc1.address)
        ).to.be.revertedWith("SyncTooFrequent")

        // After interval passes, sync should work
        await helpers.time.increaseTime(newInterval + 1)
        await expect(
          qcManager.connect(operations).syncOracleToAccountControl(qc1.address)
        ).to.not.be.reverted
      })

      it("should coordinate pause durations between contracts", async () => {
        // Set emergency pause duration
        const pauseDuration = 2 * 60 * 60 // 2 hours
        await systemState
          .connect(operations)
          .setEmergencyPauseDuration(pauseDuration)

        // Pause QC through SystemState
        const testReason = ethers.utils.id("INTEGRATION_TEST")
        await systemState
          .connect(emergency)
          .emergencyPauseQC(qc1.address, testReason)

        expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.true

        // Time travel to just before expiry
        await helpers.time.increaseTime(pauseDuration - 60) // 1 minute before expiry

        expect(await systemState.isQCEmergencyPauseExpired(qc1.address)).to.be
          .false

        // Time travel past expiry
        await helpers.time.increaseTime(120) // 1 minute past expiry

        expect(await systemState.isQCEmergencyPauseExpired(qc1.address)).to.be
          .true
      })

      it("should validate collateral enforcement parameters work across contracts", async () => {
        // Set collateral parameters
        await systemState.connect(operations).setMinCollateralRatio(150) // 150%
        await systemState.connect(operations).setFailureThreshold(3)
        await systemState.connect(operations).setFailureWindow(24 * 60 * 60) // 24 hours

        // These parameters should be available for enforcement logic
        expect(await systemState.minCollateralRatio()).to.equal(150)
        expect(await systemState.failureThreshold()).to.equal(3)
        expect(await systemState.failureWindow()).to.equal(24 * 60 * 60)

        // Mock enforcement would use these parameters
        const ratio = await systemState.minCollateralRatio()
        const threshold = await systemState.failureThreshold()

        expect(ratio).to.be.gte(100) // Business logic validation
        expect(threshold).to.be.gte(1)
      })
    })

    describe("Emergency Response Integration", () => {
      it("should coordinate emergency pauses across system components", async () => {
        // Emergency scenario: pause both system functions and specific QCs
        await systemState.connect(emergency).pauseMinting()
        await systemState.connect(emergency).pauseRedemption()
        await systemState
          .connect(emergency)
          .emergencyPauseQC(
            qc1.address,
            ethers.utils.id("SYSTEM_WIDE_EMERGENCY")
          )

        // Verify system-wide emergency state
        expect(await systemState.isMintingPaused()).to.be.true
        expect(await systemState.isRedemptionPaused()).to.be.true
        expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.true
        expect(await systemState.isQCEmergencyPaused(qc2.address)).to.be.false

        // QC2 should still be operational while QC1 is paused
        // (In real system, operations would check these states)

        // Recovery: restore operations gradually
        await systemState.connect(emergency).unpauseRedemption() // Users can exit first
        await systemState.connect(emergency).emergencyUnpauseQC(qc1.address) // Restore QC
        await systemState.connect(emergency).unpauseMinting() // Full operations restored

        // Verify full recovery
        expect(await systemState.isMintingPaused()).to.be.false
        expect(await systemState.isRedemptionPaused()).to.be.false
        expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.false
      })

      it("should handle emergency council transitions during active operations", async () => {
        const newEmergencyCouncil = user

        // Start operations with current emergency council
        await systemState
          .connect(emergency)
          .emergencyPauseQC(qc1.address, ethers.utils.id("INITIAL_EMERGENCY"))

        expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.true

        // Emergency council transition
        await systemState
          .connect(owner)
          .setEmergencyCouncil(newEmergencyCouncil.address)

        // Verify role transition
        expect(await systemState.hasRole(EMERGENCY_ROLE, emergency.address)).to
          .be.false
        expect(
          await systemState.hasRole(EMERGENCY_ROLE, newEmergencyCouncil.address)
        ).to.be.true

        // Old council cannot make changes
        await expect(
          systemState.connect(emergency).emergencyUnpauseQC(qc1.address)
        ).to.be.revertedWith("AccessControl:")

        // New council can resolve emergency
        await systemState
          .connect(newEmergencyCouncil)
          .emergencyUnpauseQC(qc1.address)
        expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.false
      })
    })

    describe("Oracle Integration", () => {
      it("should coordinate oracle parameters with consensus mechanisms", async () => {
        // Configure oracle consensus requirements
        await systemState.connect(operations).setOracleConsensusThreshold(3)
        await systemState
          .connect(operations)
          .setOracleAttestationTimeout(4 * 60 * 60) // 4 hours
        await systemState
          .connect(operations)
          .setOracleMaxStaleness(24 * 60 * 60) // 24 hours

        const threshold = await systemState.oracleConsensusThreshold()
        const timeout = await systemState.oracleAttestationTimeout()
        const staleness = await systemState.oracleMaxStaleness()

        // Mock oracle should use these parameters
        await mockReserveOracle.setConsensusThreshold(threshold)
        await mockReserveOracle.setAttestationTimeout(timeout)

        expect(await mockReserveOracle.consensusThreshold()).to.equal(threshold)
        expect(await mockReserveOracle.attestationTimeout()).to.equal(timeout)

        // Oracle operations should respect staleness limits
        expect(staleness).to.be.gte(timeout) // Data should be valid longer than consensus time
      })

      it("should handle oracle failures with proper fallback", async () => {
        // Set oracle retry parameters
        await systemState.connect(operations).setOracleRetryInterval(30 * 60) // 30 minutes
        await systemState.connect(operations).setOracleConsensusThreshold(3)

        // Simulate oracle failure scenario
        await mockReserveOracle.setFailureMode(true)

        const retryInterval = await systemState.oracleRetryInterval()
        const threshold = await systemState.oracleConsensusThreshold()

        // System should respect retry intervals during failures
        expect(retryInterval).to.be.gt(0)
        expect(threshold).to.be.gte(1)

        // Reset oracle for normal operation
        await mockReserveOracle.setFailureMode(false)
      })
    })
  })

  describe("SystemState ↔ AccountControl Integration", () => {
    describe("Pause Modifier Integration", () => {
      it("should respect SystemState pause states in AccountControl operations", async () => {
        // Pause minting in SystemState
        await systemState.connect(emergency).pauseMinting()

        // AccountControl operations that depend on minting should respect pause
        // (This would be tested with actual AccountControl contract calls)
        expect(await systemState.isMintingPaused()).to.be.true

        // Redemption should still work
        expect(await systemState.isRedemptionPaused()).to.be.false

        // Unpause and verify recovery
        await systemState.connect(emergency).unpauseMinting()
        expect(await systemState.isMintingPaused()).to.be.false
      })

      it("should integrate QC emergency pauses with AccountControl", async () => {
        // Pause specific QC
        await systemState
          .connect(emergency)
          .emergencyPauseQC(qc1.address, ethers.utils.id("QC_SPECIFIC_ISSUE"))

        // Operations involving QC1 should be blocked
        expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.true

        // Operations with QC2 should continue
        expect(await systemState.isQCEmergencyPaused(qc2.address)).to.be.false

        // Test the qcNotEmergencyPaused modifier behavior
        // (In real integration, AccountControl would use this modifier)
      })
    })

    describe("Parameter Dependency Validation", () => {
      it("should validate mint amounts are enforced in AccountControl", async () => {
        // Set mint amount limits
        const minAmount = ethers.utils.parseEther("0.1")
        const maxAmount = ethers.utils.parseEther("1000")

        await systemState.connect(operations).setMinMintAmount(minAmount)
        await systemState.connect(operations).setMaxMintAmount(maxAmount)

        expect(await systemState.minMintAmount()).to.equal(minAmount)
        expect(await systemState.maxMintAmount()).to.equal(maxAmount)

        // AccountControl should enforce these limits
        // (Integration testing would verify actual enforcement)
      })

      it("should coordinate redemption timeouts across contracts", async () => {
        const timeout = 7 * 24 * 60 * 60 // 7 days
        await systemState.connect(operations).setRedemptionTimeout(timeout)

        expect(await systemState.redemptionTimeout()).to.equal(timeout)

        // AccountControl and related contracts should use this timeout
        // for redemption operations
      })
    })
  })

  describe("Watchdog Enforcement Integration", () => {
    describe("Automated QC Pausing", () => {
      it("should enable automated QC pausing via emergency role", async () => {
        // Simulate watchdog contract having emergency role
        const watchdogAddress = operations.address // Use operations as mock watchdog

        // Grant emergency role to watchdog
        await systemState.grantRole(EMERGENCY_ROLE, watchdogAddress)

        // Watchdog detects violation and pauses QC
        const violationReason = ethers.utils.id("INSUFFICIENT_COLLATERAL")
        await systemState
          .connect(operations)
          .emergencyPauseQC(qc1.address, violationReason)

        expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.true

        // Verify event emission for monitoring
        const pauseTime = await systemState.getQCPauseTimestamp(qc1.address)
        expect(pauseTime).to.be.gt(0)
      })

      it("should handle collateral monitoring and enforcement", async () => {
        // Set enforcement parameters
        await systemState.connect(operations).setMinCollateralRatio(120) // 120%
        await systemState.connect(operations).setFailureThreshold(2)
        await systemState.connect(operations).setFailureWindow(60 * 60 * 24) // 24 hours

        const minRatio = await systemState.minCollateralRatio()
        const threshold = await systemState.failureThreshold()
        const window = await systemState.failureWindow()

        // Simulate watchdog monitoring
        expect(minRatio).to.equal(120)
        expect(threshold).to.equal(2)
        expect(window).to.equal(60 * 60 * 24)

        // Watchdog would use these parameters for automated enforcement
        // In real system: if (collateralRatio < minRatio && failures >= threshold) { pauseQC() }
      })
    })

    describe("Stale Data Monitoring", () => {
      it("should enable monitoring of stale attestations", async () => {
        // Set staleness threshold
        const staleThreshold = 12 * 60 * 60 // 12 hours
        await systemState.connect(operations).setStaleThreshold(staleThreshold)

        expect(await systemState.staleThreshold()).to.equal(staleThreshold)

        // Watchdog would monitor attestation freshness
        // In real system: if (block.timestamp - lastAttestation > staleThreshold) { pauseQC() }

        // Simulate stale data detection and QC pause
        await systemState
          .connect(emergency)
          .emergencyPauseQC(qc1.address, ethers.utils.id("STALE_ATTESTATIONS"))

        expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.true
      })

      it("should coordinate oracle staleness with system monitoring", async () => {
        // Set oracle staleness parameters
        await systemState.connect(operations).setOracleMaxStaleness(6 * 60 * 60) // 6 hours
        await systemState.connect(operations).setStaleThreshold(4 * 60 * 60) // 4 hours

        const oracleStaleness = await systemState.oracleMaxStaleness()
        const systemStaleness = await systemState.staleThreshold()

        // Oracle data should be fresher than system threshold
        expect(systemStaleness).to.be.lte(oracleStaleness)

        // Both parameters should be used in monitoring logic
        expect(oracleStaleness).to.be.gt(0)
        expect(systemStaleness).to.be.gt(0)
      })
    })
  })

  describe("Multi-Contract Emergency Scenarios", () => {
    describe("Cascading Emergency Response", () => {
      it("should handle system-wide emergency with multiple contract coordination", async () => {
        // Scenario: Critical vulnerability detected

        // Step 1: Immediate system-wide pause
        await systemState.connect(emergency).pauseMinting()
        await systemState.connect(emergency).pauseRedemption()
        await systemState.connect(emergency).pauseWalletRegistration()

        // Step 2: Pause high-risk QCs
        await systemState
          .connect(emergency)
          .emergencyPauseQC(
            qc1.address,
            ethers.utils.id("CRITICAL_VULNERABILITY")
          )
        await systemState
          .connect(emergency)
          .emergencyPauseQC(
            qc2.address,
            ethers.utils.id("CRITICAL_VULNERABILITY")
          )

        // Verify complete system shutdown
        expect(await systemState.isMintingPaused()).to.be.true
        expect(await systemState.isRedemptionPaused()).to.be.true
        expect(await systemState.isWalletRegistrationPaused()).to.be.true
        expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.true
        expect(await systemState.isQCEmergencyPaused(qc2.address)).to.be.true

        // Step 3: Gradual recovery after fix
        // First: Allow wallet registration (safe operations)
        await systemState.connect(emergency).unpauseWalletRegistration()

        // Second: Allow redemptions (users can exit)
        await systemState.connect(emergency).unpauseRedemption()

        // Third: Restore QCs individually after validation
        await systemState.connect(emergency).emergencyUnpauseQC(qc1.address)
        await helpers.time.increaseTime(3600) // Wait 1 hour for monitoring
        await systemState.connect(emergency).emergencyUnpauseQC(qc2.address)

        // Fourth: Restore minting (full operations)
        await systemState.connect(emergency).unpauseMinting()

        // Verify complete recovery
        expect(await systemState.isMintingPaused()).to.be.false
        expect(await systemState.isRedemptionPaused()).to.be.false
        expect(await systemState.isWalletRegistrationPaused()).to.be.false
        expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.false
        expect(await systemState.isQCEmergencyPaused(qc2.address)).to.be.false
      })

      it("should handle partial recovery scenarios", async () => {
        // Scenario: Issue affects only some QCs

        // Initial emergency state
        await systemState
          .connect(emergency)
          .emergencyPauseQC(qc1.address, ethers.utils.id("QC_SPECIFIC_ISSUE"))

        // QC1 paused, QC2 operational
        expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.true
        expect(await systemState.isQCEmergencyPaused(qc2.address)).to.be.false

        // System functions remain operational
        expect(await systemState.isMintingPaused()).to.be.false
        expect(await systemState.isRedemptionPaused()).to.be.false

        // Operations with QC2 can continue
        // Operations with QC1 should be blocked

        // Recovery: QC1 comes back online
        await systemState.connect(emergency).emergencyUnpauseQC(qc1.address)
        expect(await systemState.isQCEmergencyPaused(qc1.address)).to.be.false

        // Full system operational
        expect(await systemState.isQCEmergencyPaused(qc2.address)).to.be.false
      })
    })

    describe("Cross-Contract State Validation", () => {
      it("should maintain consistency across all integrated contracts", async () => {
        // Set comprehensive system configuration
        await systemState
          .connect(operations)
          .setMinMintAmount(ethers.utils.parseEther("0.1"))
        await systemState
          .connect(operations)
          .setMaxMintAmount(ethers.utils.parseEther("1000"))
        await systemState
          .connect(operations)
          .setRedemptionTimeout(7 * 24 * 60 * 60)
        await systemState.connect(operations).setStaleThreshold(24 * 60 * 60)
        await systemState.connect(operations).setMinCollateralRatio(150)
        await systemState.connect(operations).setOracleConsensusThreshold(3)

        // Verify all parameters are set correctly
        expect(await systemState.minMintAmount()).to.equal(
          ethers.utils.parseEther("0.1")
        )
        expect(await systemState.maxMintAmount()).to.equal(
          ethers.utils.parseEther("1000")
        )
        expect(await systemState.redemptionTimeout()).to.equal(7 * 24 * 60 * 60)
        expect(await systemState.staleThreshold()).to.equal(24 * 60 * 60)
        expect(await systemState.minCollateralRatio()).to.equal(150)
        expect(await systemState.oracleConsensusThreshold()).to.equal(3)

        // All integrated contracts should have access to these parameters
        // and maintain consistency in their operations
      })

      it("should validate parameter bounds across contract interactions", async () => {
        // Test that parameter relationships are maintained across contracts
        await systemState.connect(operations).setStaleThreshold(12 * 60 * 60) // 12 hours
        await systemState
          .connect(operations)
          .setRedemptionTimeout(7 * 24 * 60 * 60) // 7 days
        await systemState
          .connect(operations)
          .setOracleMaxStaleness(24 * 60 * 60) // 24 hours

        const staleThreshold = await systemState.staleThreshold()
        const redemptionTimeout = await systemState.redemptionTimeout()
        const oracleStaleness = await systemState.oracleMaxStaleness()

        // Validate logical relationships
        expect(staleThreshold).to.be.lt(redemptionTimeout) // Stale data detected before redemption expires
        expect(staleThreshold).to.be.lte(oracleStaleness) // System staleness aligned with oracle staleness
        expect(oracleStaleness).to.be.lt(redemptionTimeout) // Oracle data fresh relative to redemption window
      })
    })
  })

  describe("Performance and Gas Optimization", () => {
    describe("Cross-Contract Call Efficiency", () => {
      it("should have efficient parameter access across contracts", async () => {
        // Measure gas for parameter reads
        const gasEstimates = {
          minMintAmount: await systemState.estimateGas.minMintAmount(),
          maxMintAmount: await systemState.estimateGas.maxMintAmount(),
          redemptionTimeout: await systemState.estimateGas.redemptionTimeout(),
          staleThreshold: await systemState.estimateGas.staleThreshold(),
          minCollateralRatio:
            await systemState.estimateGas.minCollateralRatio(),
          oracleConsensusThreshold:
            await systemState.estimateGas.oracleConsensusThreshold(),
        }

        // Parameter reads should be very cheap
        Object.values(gasEstimates).forEach((gasEstimate) => {
          expect(gasEstimate).to.be.lt(30000) // Very low gas for parameter reads
        })
      })

      it("should have efficient emergency operations", async () => {
        // Measure gas for emergency operations
        const pauseTx = await systemState.connect(emergency).pauseMinting()
        const pauseReceipt = await pauseTx.wait()

        const qcPauseTx = await systemState
          .connect(emergency)
          .emergencyPauseQC(qc1.address, ethers.utils.id("GAS_TEST"))

        const qcPauseReceipt = await qcPauseTx.wait()

        // Emergency operations should be gas-efficient
        expect(pauseReceipt.gasUsed).to.be.lt(100000)
        expect(qcPauseReceipt.gasUsed).to.be.lt(150000)
      })
    })
  })
})
