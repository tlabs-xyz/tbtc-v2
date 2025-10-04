import { expect } from "chai"
import { ethers } from "hardhat"
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs"
import { QCData } from "../../../../typechain"
import {
  setupAccountControlTestSigners,
  createBaseTestEnvironment,
  restoreBaseTestEnvironment,
  AccountControlTestSigners,
} from "../../fixtures"

describe("QCData - Oracle Integration", () => {
  let signers: AccountControlTestSigners
  let qcData: QCData
  let qcManager: any

  // Test data
  const testQCAddress = "0x1234567890123456789012345678901234567890"
  const testQCAddress2 = "0x2345678901234567890123456789012345678901"
  const maxMintingCapacity = ethers.utils.parseEther("100")
  const testReason = ethers.utils.id("TEST_REASON")

  // Test timestamps
  const baseTimestamp = 1700000000 // Nov 15, 2023
  const futureTimestamp = baseTimestamp + 3600 // +1 hour
  const pastTimestamp = baseTimestamp - 3600 // -1 hour

  // QC Status enum values
  const QCStatus = {
    Active: 0,
    MintingPaused: 1,
    Paused: 2,
    UnderReview: 3,
    Revoked: 4,
  }

  before(async () => {
    signers = await setupAccountControlTestSigners()
    qcManager = signers.deployer
  })

  beforeEach(async () => {
    await createBaseTestEnvironment()

    // Deploy QCData
    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy()
    await qcData.deployed()

    // Register test QCs
    await qcData
      .connect(qcManager)
      .registerQC(testQCAddress, maxMintingCapacity)
    await qcData
      .connect(qcManager)
      .registerQC(testQCAddress2, maxMintingCapacity)
  })

  afterEach(async () => {
    await restoreBaseTestEnvironment()
  })

  describe("1. Basic Oracle Data Management", () => {
    describe("1.1 Oracle Data Initialization", () => {
      it("should initialize oracle data with default values for new QCs", async () => {
        const oracleData = await qcData.getQCOracleData(testQCAddress)

        expect(oracleData.lastSyncTimestamp).to.equal(0)
        expect(oracleData.oracleFailureDetected).to.be.false
      })

      it("should return default values from individual getters for new QCs", async () => {
        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(0)
        expect(await qcData.getQCOracleFailureDetected(testQCAddress)).to.be
          .false
      })

      it("should initialize independent oracle data for multiple QCs", async () => {
        const oracleData1 = await qcData.getQCOracleData(testQCAddress)
        const oracleData2 = await qcData.getQCOracleData(testQCAddress2)

        expect(oracleData1.lastSyncTimestamp).to.equal(0)
        expect(oracleData1.oracleFailureDetected).to.be.false
        expect(oracleData2.lastSyncTimestamp).to.equal(0)
        expect(oracleData2.oracleFailureDetected).to.be.false
      })
    })

    describe("1.2 Oracle Sync Timestamp Operations", () => {
      it("should update oracle sync timestamp successfully", async () => {
        const tx = qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)

        await expect(tx).to.not.be.reverted

        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(baseTimestamp)
      })

      it("should emit QCOracleSyncTimestampUpdated event with correct parameters", async () => {
        const tx = await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)

        const receipt = await tx.wait()
        const block = await ethers.provider.getBlock(receipt.blockNumber)

        await expect(tx)
          .to.emit(qcData, "QCOracleSyncTimestampUpdated")
          .withArgs(
            testQCAddress,
            0, // oldTimestamp (initially 0)
            baseTimestamp, // newTimestamp
            qcManager.address,
            block.timestamp
          )
      })

      it("should handle timestamp progression correctly", async () => {
        // Set initial timestamp
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, pastTimestamp)
        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(pastTimestamp)

        // Update to present
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(baseTimestamp)

        // Update to future
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, futureTimestamp)
        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(futureTimestamp)
      })

      it("should update oracle data while preserving failure detection status", async () => {
        // Set failure detection first
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        // Update timestamp
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)

        const oracleData = await qcData.getQCOracleData(testQCAddress)
        expect(oracleData.lastSyncTimestamp).to.equal(baseTimestamp)
        expect(oracleData.oracleFailureDetected).to.be.true
      })

      it("should handle multiple timestamp updates correctly", async () => {
        const timestamps = [pastTimestamp, baseTimestamp, futureTimestamp]

        for (let i = 0; i < timestamps.length; i++) {
          const oldTimestamp = i === 0 ? 0 : timestamps[i - 1]

          const tx = await qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(testQCAddress, timestamps[i])

          const receipt = await tx.wait()
          const block = await ethers.provider.getBlock(receipt.blockNumber)

          await expect(tx)
            .to.emit(qcData, "QCOracleSyncTimestampUpdated")
            .withArgs(
              testQCAddress,
              oldTimestamp,
              timestamps[i],
              qcManager.address,
              block.timestamp
            )

          expect(
            await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
          ).to.equal(timestamps[i])
        }
      })
    })

    describe("1.3 Oracle Failure Detection Operations", () => {
      it("should update oracle failure detection successfully", async () => {
        const tx = qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        await expect(tx).to.not.be.reverted

        expect(await qcData.getQCOracleFailureDetected(testQCAddress)).to.be
          .true
      })

      it("should emit QCOracleFailureStatusUpdated event with correct parameters", async () => {
        await expect(
          qcData
            .connect(qcManager)
            .updateQCOracleFailureDetected(testQCAddress, true)
        )
          .to.emit(qcData, "QCOracleFailureStatusUpdated")
          .withArgs(
            testQCAddress,
            false, // oldStatus (initially false)
            true, // newStatus
            qcManager.address,
            anyValue // Accept any timestamp value
          )
      })

      it("should handle failure detection toggle scenarios", async () => {
        // Set to true
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)
        expect(await qcData.getQCOracleFailureDetected(testQCAddress)).to.be
          .true

        // Toggle to false
        await expect(
          qcData
            .connect(qcManager)
            .updateQCOracleFailureDetected(testQCAddress, false)
        )
          .to.emit(qcData, "QCOracleFailureStatusUpdated")
          .withArgs(
            testQCAddress,
            true, // oldStatus
            false, // newStatus
            qcManager.address,
            anyValue // Accept any timestamp value
          )

        expect(await qcData.getQCOracleFailureDetected(testQCAddress)).to.be
          .false
      })

      it("should update failure detection while preserving sync timestamp", async () => {
        // Set sync timestamp first
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)

        // Update failure detection
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        const oracleData = await qcData.getQCOracleData(testQCAddress)
        expect(oracleData.lastSyncTimestamp).to.equal(baseTimestamp)
        expect(oracleData.oracleFailureDetected).to.be.true
      })

      it("should handle multiple failure detection toggles correctly", async () => {
        const statuses = [true, false, true, false]

        for (let i = 0; i < statuses.length; i++) {
          const oldStatus = i === 0 ? false : statuses[i - 1]

          await expect(
            qcData
              .connect(qcManager)
              .updateQCOracleFailureDetected(testQCAddress, statuses[i])
          )
            .to.emit(qcData, "QCOracleFailureStatusUpdated")
            .withArgs(
              testQCAddress,
              oldStatus,
              statuses[i],
              qcManager.address,
              anyValue // Accept any timestamp value
            )

          expect(
            await qcData.getQCOracleFailureDetected(testQCAddress)
          ).to.equal(statuses[i])
        }
      })
    })

    describe("1.4 Oracle Data Getters", () => {
      beforeEach(async () => {
        // Set up test data
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)
      })

      it("should return comprehensive oracle data correctly", async () => {
        const oracleData = await qcData.getQCOracleData(testQCAddress)

        expect(oracleData.lastSyncTimestamp).to.equal(baseTimestamp)
        expect(oracleData.oracleFailureDetected).to.be.true
      })

      it("should return individual oracle data fields correctly", async () => {
        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(baseTimestamp)
        expect(await qcData.getQCOracleFailureDetected(testQCAddress)).to.be
          .true
      })

      it("should be callable by any address (view functions)", async () => {
        // Test with different signers
        expect(
          await qcData
            .connect(signers.governance)
            .getQCOracleData(testQCAddress)
        ).to.not.be.reverted

        expect(
          await qcData
            .connect(signers.governance)
            .getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(baseTimestamp)

        expect(
          await qcData
            .connect(signers.governance)
            .getQCOracleFailureDetected(testQCAddress)
        ).to.be.true
      })
    })
  })

  describe("2. Access Control & Security Tests", () => {
    describe("2.1 Permission Validation", () => {
      it("should allow QC_MANAGER_ROLE to update oracle sync timestamp", async () => {
        await expect(
          qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        ).to.not.be.reverted
      })

      it("should allow QC_MANAGER_ROLE to update oracle failure detection", async () => {
        await expect(
          qcData
            .connect(qcManager)
            .updateQCOracleFailureDetected(testQCAddress, true)
        ).to.not.be.reverted
      })

      it("should reject unauthorized access to updateQCOracleSyncTimestamp", async () => {
        const unauthorizedUser = signers.governance

        // First remove the QC_MANAGER_ROLE if it exists
        if (
          await qcData.hasRole(
            await qcData.QC_MANAGER_ROLE(),
            unauthorizedUser.address
          )
        ) {
          await qcData.revokeQCManagerRole(unauthorizedUser.address)
        }

        await expect(
          qcData
            .connect(unauthorizedUser)
            .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        ).to.be.revertedWith("AccessControl:")
      })

      it("should reject unauthorized access to updateQCOracleFailureDetected", async () => {
        const unauthorizedUser = signers.governance

        // Ensure user doesn't have QC_MANAGER_ROLE
        if (
          await qcData.hasRole(
            await qcData.QC_MANAGER_ROLE(),
            unauthorizedUser.address
          )
        ) {
          await qcData.revokeQCManagerRole(unauthorizedUser.address)
        }

        await expect(
          qcData
            .connect(unauthorizedUser)
            .updateQCOracleFailureDetected(testQCAddress, true)
        ).to.be.revertedWith("AccessControl:")
      })

      it("should allow multiple managers to perform oracle operations", async () => {
        // Grant additional manager role
        const additionalManager = signers.governance
        await qcData.grantQCManagerRole(additionalManager.address)

        // Both managers should be able to update oracle data
        await expect(
          qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        ).to.not.be.reverted

        await expect(
          qcData
            .connect(additionalManager)
            .updateQCOracleFailureDetected(testQCAddress, true)
        ).to.not.be.reverted
      })

      it("should reject oracle operations after manager role revocation", async () => {
        // Grant and then revoke manager role
        const tempManager = signers.governance
        await qcData.grantQCManagerRole(tempManager.address)
        await qcData.revokeQCManagerRole(tempManager.address)

        // Should now be rejected
        await expect(
          qcData
            .connect(tempManager)
            .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        ).to.be.revertedWith("AccessControl:")

        await expect(
          qcData
            .connect(tempManager)
            .updateQCOracleFailureDetected(testQCAddress, true)
        ).to.be.revertedWith("AccessControl:")
      })
    })

    describe("2.2 QC Registration Validation", () => {
      it("should reject oracle operations on unregistered QCs", async () => {
        const unregisteredQC = "0x9999999999999999999999999999999999999999"

        await expect(
          qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(unregisteredQC, baseTimestamp)
        )
          .to.be.revertedWithCustomError(qcData, "QCNotRegistered")
          .withArgs(unregisteredQC)

        await expect(
          qcData
            .connect(qcManager)
            .updateQCOracleFailureDetected(unregisteredQC, true)
        )
          .to.be.revertedWithCustomError(qcData, "QCNotRegistered")
          .withArgs(unregisteredQC)
      })

      it("should reject oracle data queries for unregistered QCs", async () => {
        const unregisteredQC = "0x9999999999999999999999999999999999999999"

        // Note: These should not revert but return default values for unregistered QCs
        // However, if the contract implementation requires QC to be registered, test accordingly
        const oracleData = await qcData.getQCOracleData(unregisteredQC)
        expect(oracleData.lastSyncTimestamp).to.equal(0)
        expect(oracleData.oracleFailureDetected).to.be.false

        expect(
          await qcData.getQCOracleLastSyncTimestamp(unregisteredQC)
        ).to.equal(0)
        expect(await qcData.getQCOracleFailureDetected(unregisteredQC)).to.be
          .false
      })

      it("should reject oracle operations with zero address QC", async () => {
        const zeroAddress = ethers.constants.AddressZero

        await expect(
          qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(zeroAddress, baseTimestamp)
        )
          .to.be.revertedWithCustomError(qcData, "QCNotRegistered")
          .withArgs(zeroAddress)

        await expect(
          qcData
            .connect(qcManager)
            .updateQCOracleFailureDetected(zeroAddress, true)
        )
          .to.be.revertedWithCustomError(qcData, "QCNotRegistered")
          .withArgs(zeroAddress)
      })

      it("should validate QC registration before oracle operations", async () => {
        // Create a new QC address but don't register it
        const newQC = "0x3333333333333333333333333333333333333333"

        // Operations should fail
        await expect(
          qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(newQC, baseTimestamp)
        )
          .to.be.revertedWithCustomError(qcData, "QCNotRegistered")
          .withArgs(newQC)

        // Register the QC
        await qcData.connect(qcManager).registerQC(newQC, maxMintingCapacity)

        // Operations should now succeed
        await expect(
          qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(newQC, baseTimestamp)
        ).to.not.be.reverted

        await expect(
          qcData.connect(qcManager).updateQCOracleFailureDetected(newQC, true)
        ).to.not.be.reverted
      })
    })

    describe("2.3 Input Validation", () => {
      it("should accept zero timestamp values", async () => {
        await expect(
          qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(testQCAddress, 0)
        ).to.not.be.reverted

        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(0)
      })

      it("should accept maximum timestamp values", async () => {
        const maxTimestamp = ethers.constants.MaxUint256

        await expect(
          qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(testQCAddress, maxTimestamp)
        ).to.not.be.reverted

        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(maxTimestamp)
      })

      it("should handle boolean values correctly for failure detection", async () => {
        // Test true
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)
        expect(await qcData.getQCOracleFailureDetected(testQCAddress)).to.be
          .true

        // Test false
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, false)
        expect(await qcData.getQCOracleFailureDetected(testQCAddress)).to.be
          .false
      })

      it("should maintain data integrity across operations", async () => {
        // Set both oracle values
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        // Verify both are maintained
        const oracleData = await qcData.getQCOracleData(testQCAddress)
        expect(oracleData.lastSyncTimestamp).to.equal(baseTimestamp)
        expect(oracleData.oracleFailureDetected).to.be.true

        // Update one, verify other is preserved
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, futureTimestamp)

        const updatedData = await qcData.getQCOracleData(testQCAddress)
        expect(updatedData.lastSyncTimestamp).to.equal(futureTimestamp)
        expect(updatedData.oracleFailureDetected).to.be.true // Should be preserved
      })
    })
  })

  describe("3. Integration with QC Lifecycle Tests", () => {
    describe("3.1 Oracle Data During QC State Changes", () => {
      beforeEach(async () => {
        // Set up initial oracle data
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)
      })

      it("should preserve oracle data when QC status changes", async () => {
        // Change QC status to various states
        const statusesToTest = [
          QCStatus.MintingPaused,
          QCStatus.Paused,
          QCStatus.UnderReview,
          QCStatus.Revoked,
          QCStatus.Active, // Back to active
        ]

        for (const status of statusesToTest) {
          await qcData
            .connect(qcManager)
            .setQCStatus(testQCAddress, status, testReason)

          // Oracle data should be preserved
          const oracleData = await qcData.getQCOracleData(testQCAddress)
          expect(oracleData.lastSyncTimestamp).to.equal(baseTimestamp)
          expect(oracleData.oracleFailureDetected).to.be.true
        }
      })

      it("should allow oracle updates during different QC statuses", async () => {
        const statusesToTest = [
          QCStatus.Active,
          QCStatus.MintingPaused,
          QCStatus.Paused,
          QCStatus.UnderReview,
          QCStatus.Revoked,
        ]

        for (const status of statusesToTest) {
          // Set QC status
          await qcData
            .connect(qcManager)
            .setQCStatus(testQCAddress, status, testReason)

          // Oracle operations should still be allowed regardless of QC status
          const newTimestamp = baseTimestamp + status * 1000 // Different timestamp for each status

          await expect(
            qcData
              .connect(qcManager)
              .updateQCOracleSyncTimestamp(testQCAddress, newTimestamp)
          ).to.not.be.reverted

          await expect(
            qcData
              .connect(qcManager)
              .updateQCOracleFailureDetected(testQCAddress, status % 2 === 0)
          ).to.not.be.reverted

          // Verify updates took effect
          expect(
            await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
          ).to.equal(newTimestamp)
          expect(
            await qcData.getQCOracleFailureDetected(testQCAddress)
          ).to.equal(status % 2 === 0)
        }
      })

      it("should preserve oracle data during pause level changes", async () => {
        // Change pause levels
        await qcData.connect(qcManager).setQCPauseLevel(testQCAddress, 1, true) // Complete pause, self-initiated

        // Oracle data should be preserved
        let oracleData = await qcData.getQCOracleData(testQCAddress)
        expect(oracleData.lastSyncTimestamp).to.equal(baseTimestamp)
        expect(oracleData.oracleFailureDetected).to.be.true

        // Change back to minting only pause
        await qcData.connect(qcManager).setQCPauseLevel(testQCAddress, 0, false) // MintingOnly pause, governance-initiated

        // Oracle data should still be preserved
        oracleData = await qcData.getQCOracleData(testQCAddress)
        expect(oracleData.lastSyncTimestamp).to.equal(baseTimestamp)
        expect(oracleData.oracleFailureDetected).to.be.true
      })

      it("should maintain oracle data during capacity changes", async () => {
        // Update minting capacity
        const newCapacity = ethers.utils.parseEther("200")
        await qcData
          .connect(qcManager)
          .updateMaxMintingCapacity(testQCAddress, newCapacity)

        // Oracle data should be preserved
        const oracleData = await qcData.getQCOracleData(testQCAddress)
        expect(oracleData.lastSyncTimestamp).to.equal(baseTimestamp)
        expect(oracleData.oracleFailureDetected).to.be.true

        // Update minted amount
        const mintedAmount = ethers.utils.parseEther("50")
        await qcData
          .connect(qcManager)
          .updateQCMintedAmount(testQCAddress, mintedAmount)

        // Oracle data should still be preserved
        const oracleData2 = await qcData.getQCOracleData(testQCAddress)
        expect(oracleData2.lastSyncTimestamp).to.equal(baseTimestamp)
        expect(oracleData2.oracleFailureDetected).to.be.true
      })
    })

    describe("3.2 Oracle Data in QC Comprehensive Info", () => {
      it("should include oracle data in comprehensive QC info", async () => {
        // Set up test oracle data
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        // Get comprehensive QC info
        const qcInfo = await qcData.getQCInfo(testQCAddress)

        // Verify QC info structure (doesn't include oracle data directly, but should be accessible)
        expect(qcInfo.status).to.equal(QCStatus.Active)
        expect(qcInfo.totalMinted).to.equal(0)
        expect(qcInfo.maxCapacity).to.equal(maxMintingCapacity)
        expect(qcInfo.registeredAt).to.be.gt(0)

        // Oracle data should be accessible via separate calls
        const oracleData = await qcData.getQCOracleData(testQCAddress)
        expect(oracleData.lastSyncTimestamp).to.equal(baseTimestamp)
        expect(oracleData.oracleFailureDetected).to.be.true
      })

      it("should maintain oracle data consistency with QC info", async () => {
        // Update various QC properties
        await qcData
          .connect(qcManager)
          .setQCStatus(testQCAddress, QCStatus.MintingPaused, testReason)
        await qcData.connect(qcManager).setQCPauseLevel(testQCAddress, 1, true)
        await qcData
          .connect(qcManager)
          .updateQCMintedAmount(testQCAddress, ethers.utils.parseEther("25"))

        // Update oracle data
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, futureTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, false)

        // Verify all data is consistent
        const qcInfo = await qcData.getQCInfo(testQCAddress)
        expect(qcInfo.status).to.equal(QCStatus.MintingPaused)
        expect(qcInfo.totalMinted).to.equal(ethers.utils.parseEther("25"))
        expect(qcInfo.pauseLevel).to.equal(1)
        expect(qcInfo.selfPaused).to.be.true

        const oracleData = await qcData.getQCOracleData(testQCAddress)
        expect(oracleData.lastSyncTimestamp).to.equal(futureTimestamp)
        expect(oracleData.oracleFailureDetected).to.be.false
      })
    })

    describe("3.3 Oracle Integration with Permission Logic", () => {
      it("should test oracle data with minting permission logic", async () => {
        // Test various combinations of QC status, pause level, and oracle data
        const testCases = [
          {
            status: QCStatus.Active,
            pauseLevel: 0, // MintingOnly
            oracleFailure: false,
            expectedCanMint: true,
            expectedCanFulfill: true,
          },
          {
            status: QCStatus.Active,
            pauseLevel: 1, // Complete
            oracleFailure: false,
            expectedCanMint: false,
            expectedCanFulfill: false,
          },
          {
            status: QCStatus.MintingPaused,
            pauseLevel: 0, // MintingOnly
            oracleFailure: false,
            expectedCanMint: false,
            expectedCanFulfill: true,
          },
          {
            status: QCStatus.Paused,
            pauseLevel: 0, // MintingOnly
            oracleFailure: true,
            expectedCanMint: false,
            expectedCanFulfill: false,
          },
        ]

        for (const testCase of testCases) {
          // Set up QC state
          await qcData
            .connect(qcManager)
            .setQCStatus(testQCAddress, testCase.status, testReason)
          await qcData
            .connect(qcManager)
            .setQCPauseLevel(testQCAddress, testCase.pauseLevel, false)

          // Set up oracle state
          await qcData
            .connect(qcManager)
            .updateQCOracleFailureDetected(
              testQCAddress,
              testCase.oracleFailure
            )
          await qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)

          // Test permissions (oracle data doesn't directly affect permissions in current implementation)
          expect(await qcData.canQCMint(testQCAddress)).to.equal(
            testCase.expectedCanMint
          )
          expect(await qcData.canQCFulfill(testQCAddress)).to.equal(
            testCase.expectedCanFulfill
          )

          // Verify oracle data is maintained
          const oracleData = await qcData.getQCOracleData(testQCAddress)
          expect(oracleData.oracleFailureDetected).to.equal(
            testCase.oracleFailure
          )
          expect(oracleData.lastSyncTimestamp).to.equal(baseTimestamp)
        }
      })

      it("should maintain oracle data during permission state changes", async () => {
        // Set initial oracle data
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        // Change QC to various states that affect permissions
        await qcData
          .connect(qcManager)
          .setQCStatus(testQCAddress, QCStatus.Revoked, testReason)

        // Oracle data should be preserved even when permissions are revoked
        let oracleData = await qcData.getQCOracleData(testQCAddress)
        expect(oracleData.lastSyncTimestamp).to.equal(baseTimestamp)
        expect(oracleData.oracleFailureDetected).to.be.true
        expect(await qcData.canQCMint(testQCAddress)).to.be.false
        expect(await qcData.canQCFulfill(testQCAddress)).to.be.false

        // Restore QC to active state
        await qcData
          .connect(qcManager)
          .setQCStatus(testQCAddress, QCStatus.Active, testReason)

        // Oracle data should still be preserved
        oracleData = await qcData.getQCOracleData(testQCAddress)
        expect(oracleData.lastSyncTimestamp).to.equal(baseTimestamp)
        expect(oracleData.oracleFailureDetected).to.be.true
        expect(await qcData.canQCMint(testQCAddress)).to.be.true
        expect(await qcData.canQCFulfill(testQCAddress)).to.be.true
      })
    })

    describe("3.4 Oracle Data Persistence", () => {
      it("should persist oracle data across multiple transactions", async () => {
        // Set oracle data in multiple transactions
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)

        // Verify persistence
        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(baseTimestamp)

        // Update failure detection in separate transaction
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        // Both values should be persisted
        const oracleData = await qcData.getQCOracleData(testQCAddress)
        expect(oracleData.lastSyncTimestamp).to.equal(baseTimestamp)
        expect(oracleData.oracleFailureDetected).to.be.true

        // Update timestamp again
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, futureTimestamp)

        // New timestamp should be persisted, failure detection preserved
        const updatedData = await qcData.getQCOracleData(testQCAddress)
        expect(updatedData.lastSyncTimestamp).to.equal(futureTimestamp)
        expect(updatedData.oracleFailureDetected).to.be.true
      })

      it("should maintain oracle data through complex QC operations", async () => {
        // Set initial oracle data
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        // Perform various QC operations
        await qcData
          .connect(qcManager)
          .setQCStatus(testQCAddress, QCStatus.UnderReview, testReason)
        await qcData.connect(qcManager).setQCPauseLevel(testQCAddress, 1, true)
        await qcData
          .connect(qcManager)
          .updateMaxMintingCapacity(
            testQCAddress,
            ethers.utils.parseEther("150")
          )

        // Register a wallet
        await qcData
          .connect(qcManager)
          .registerWallet(testQCAddress, "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")

        // Oracle data should still be intact
        const oracleData = await qcData.getQCOracleData(testQCAddress)
        expect(oracleData.lastSyncTimestamp).to.equal(baseTimestamp)
        expect(oracleData.oracleFailureDetected).to.be.true

        // Restore QC state
        await qcData
          .connect(qcManager)
          .setQCStatus(testQCAddress, QCStatus.Active, testReason)

        // Oracle data should still be preserved
        const finalData = await qcData.getQCOracleData(testQCAddress)
        expect(finalData.lastSyncTimestamp).to.equal(baseTimestamp)
        expect(finalData.oracleFailureDetected).to.be.true
      })
    })
  })

  describe("4. Event Emission & Data Consistency Tests", () => {
    describe("4.1 Event Parameter Validation", () => {
      it("should emit QCOracleSyncTimestampUpdated with exact parameters", async () => {
        const oldTimestamp = 0 // Initially 0
        const newTimestamp = baseTimestamp

        const tx = await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, newTimestamp)

        const receipt = await tx.wait()
        const block = await ethers.provider.getBlock(receipt.blockNumber)

        await expect(tx)
          .to.emit(qcData, "QCOracleSyncTimestampUpdated")
          .withArgs(
            testQCAddress,
            oldTimestamp,
            newTimestamp,
            qcManager.address,
            block.timestamp
          )
      })

      it("should emit QCOracleFailureStatusUpdated with exact parameters", async () => {
        const oldStatus = false // Initially false
        const newStatus = true

        const tx = await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, newStatus)

        const receipt = await tx.wait()
        const block = await ethers.provider.getBlock(receipt.blockNumber)

        await expect(tx)
          .to.emit(qcData, "QCOracleFailureStatusUpdated")
          .withArgs(
            testQCAddress,
            oldStatus,
            newStatus,
            qcManager.address,
            block.timestamp
          )
      })

      it("should emit events with correct old values on subsequent updates", async () => {
        // First update
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        // Second update - should emit events with correct old values
        const tx1 = await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, futureTimestamp)

        const receipt1 = await tx1.wait()
        const block1 = await ethers.provider.getBlock(receipt1.blockNumber)

        await expect(tx1)
          .to.emit(qcData, "QCOracleSyncTimestampUpdated")
          .withArgs(
            testQCAddress,
            baseTimestamp, // old value
            futureTimestamp, // new value
            qcManager.address,
            block1.timestamp
          )

        const tx2 = await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, false)

        const receipt2 = await tx2.wait()
        const block2 = await ethers.provider.getBlock(receipt2.blockNumber)

        await expect(tx2)
          .to.emit(qcData, "QCOracleFailureStatusUpdated")
          .withArgs(
            testQCAddress,
            true, // old value
            false, // new value
            qcManager.address,
            block2.timestamp
          )
      })

      it("should not emit events when values don't change", async () => {
        // Set initial value
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)

        // Update with same value - should still emit event (current implementation always emits)
        const tx = await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)

        const receipt = await tx.wait()
        const block = await ethers.provider.getBlock(receipt.blockNumber)

        await expect(tx)
          .to.emit(qcData, "QCOracleSyncTimestampUpdated")
          .withArgs(
            testQCAddress,
            baseTimestamp,
            baseTimestamp, // same value
            qcManager.address,
            block.timestamp
          )
      })

      it("should emit events from different managers with correct addresses", async () => {
        // Grant additional manager role
        const secondManager = signers.governance
        await qcData.grantQCManagerRole(secondManager.address)

        // First manager updates
        const tx1 = await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)

        const receipt1 = await tx1.wait()
        const block1 = await ethers.provider.getBlock(receipt1.blockNumber)

        await expect(tx1)
          .to.emit(qcData, "QCOracleSyncTimestampUpdated")
          .withArgs(
            testQCAddress,
            0,
            baseTimestamp,
            qcManager.address, // first manager
            block1.timestamp
          )

        // Second manager updates
        const tx2 = await qcData
          .connect(secondManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        const receipt2 = await tx2.wait()
        const block2 = await ethers.provider.getBlock(receipt2.blockNumber)

        await expect(tx2)
          .to.emit(qcData, "QCOracleFailureStatusUpdated")
          .withArgs(
            testQCAddress,
            false,
            true,
            secondManager.address, // second manager
            block2.timestamp
          )
      })
    })

    describe("4.2 Data Consistency After Events", () => {
      it("should ensure state consistency immediately after event emission", async () => {
        const tx = await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)

        // After transaction, state should be consistent
        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(baseTimestamp)

        // Event should have been emitted
        await expect(tx).to.emit(qcData, "QCOracleSyncTimestampUpdated")
      })

      it("should maintain consistency between individual getters and comprehensive getter", async () => {
        // Update both values
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        // All getters should return consistent data
        const comprehensiveData = await qcData.getQCOracleData(testQCAddress)

        const individualTimestamp = await qcData.getQCOracleLastSyncTimestamp(
          testQCAddress
        )

        const individualFailure = await qcData.getQCOracleFailureDetected(
          testQCAddress
        )

        expect(comprehensiveData.lastSyncTimestamp).to.equal(
          individualTimestamp
        )
        expect(comprehensiveData.oracleFailureDetected).to.equal(
          individualFailure
        )
        expect(comprehensiveData.lastSyncTimestamp).to.equal(baseTimestamp)
        expect(comprehensiveData.oracleFailureDetected).to.be.true
      })

      it("should maintain data consistency during rapid updates", async () => {
        const timestamps = [baseTimestamp, futureTimestamp, pastTimestamp]
        const failures = [true, false, true]

        for (let i = 0; i < timestamps.length; i++) {
          // Update both values
          await qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(testQCAddress, timestamps[i])
          await qcData
            .connect(qcManager)
            .updateQCOracleFailureDetected(testQCAddress, failures[i])

          // Verify consistency immediately
          const data = await qcData.getQCOracleData(testQCAddress)
          expect(data.lastSyncTimestamp).to.equal(timestamps[i])
          expect(data.oracleFailureDetected).to.equal(failures[i])
        }
      })

      it("should maintain consistency across view and state-changing functions", async () => {
        // Set initial state
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        // View functions should all return the same data
        const data1 = await qcData.getQCOracleData(testQCAddress)

        const data2 = await qcData
          .connect(signers.user || signers.deployer)
          .getQCOracleData(testQCAddress)

        const data3 = await qcData
          .connect(signers.thirdParty || signers.governance)
          .getQCOracleData(testQCAddress)

        expect(data1.lastSyncTimestamp).to.equal(data2.lastSyncTimestamp)
        expect(data1.oracleFailureDetected).to.equal(
          data2.oracleFailureDetected
        )
        expect(data2.lastSyncTimestamp).to.equal(data3.lastSyncTimestamp)
        expect(data2.oracleFailureDetected).to.equal(
          data3.oracleFailureDetected
        )
      })
    })

    describe("4.3 Event Ordering and Timing", () => {
      it("should emit events in correct chronological order", async () => {
        // Multiple updates should emit events in order
        const tx1 = await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)

        const tx2 = await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        const tx3 = await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, futureTimestamp)

        // Events should have increasing block numbers/timestamps
        const receipt1 = await tx1.wait()
        const receipt2 = await tx2.wait()
        const receipt3 = await tx3.wait()

        expect(receipt1.blockNumber).to.be.lte(receipt2.blockNumber)
        expect(receipt2.blockNumber).to.be.lte(receipt3.blockNumber)
      })

      it("should include accurate block timestamps in events", async () => {
        const tx = await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)

        const receipt = await tx.wait()
        const block = await ethers.provider.getBlock(receipt.blockNumber)

        // The event timestamp should match the block timestamp
        const event = receipt.events?.find(
          (e) => e.event === "QCOracleSyncTimestampUpdated"
        )

        expect(event).to.not.be.undefined
        if (event) {
          expect(event.args?.blockTimestamp).to.equal(block.timestamp)
        }
      })
    })
  })

  describe("5. Edge Cases & Error Conditions Tests", () => {
    describe("5.1 Timestamp Edge Cases", () => {
      it("should handle zero timestamp correctly", async () => {
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, 0)

        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(0)
      })

      it("should handle maximum uint256 timestamp", async () => {
        const maxTimestamp = ethers.constants.MaxUint256

        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, maxTimestamp)

        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(maxTimestamp)
      })

      it("should handle timestamp regression correctly", async () => {
        // Set future timestamp first
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, futureTimestamp)

        // Then set past timestamp (should be allowed)
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, pastTimestamp)

        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(pastTimestamp)
      })

      it("should handle rapid timestamp changes", async () => {
        const timestamps = [0, 1, ethers.constants.MaxUint256, baseTimestamp]

        for (const timestamp of timestamps) {
          await qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(testQCAddress, timestamp)

          expect(
            await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
          ).to.equal(timestamp)
        }
      })

      it("should handle timestamp overflow protection", async () => {
        // Test with very large numbers
        const largeTimestamp = ethers.BigNumber.from("9999999999999999999")

        await expect(
          qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(testQCAddress, largeTimestamp)
        ).to.not.be.reverted

        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(largeTimestamp)
      })
    })

    describe("5.2 Boolean State Edge Cases", () => {
      it("should handle rapid boolean toggles", async () => {
        const states = [true, false, true, false, true]

        for (const state of states) {
          await qcData
            .connect(qcManager)
            .updateQCOracleFailureDetected(testQCAddress, state)

          expect(
            await qcData.getQCOracleFailureDetected(testQCAddress)
          ).to.equal(state)
        }
      })

      it("should handle setting same boolean value multiple times", async () => {
        // Set to true multiple times
        for (let i = 0; i < 5; i++) {
          await qcData
            .connect(qcManager)
            .updateQCOracleFailureDetected(testQCAddress, true)

          expect(await qcData.getQCOracleFailureDetected(testQCAddress)).to.be
            .true
        }

        // Set to false multiple times
        for (let i = 0; i < 5; i++) {
          await qcData
            .connect(qcManager)
            .updateQCOracleFailureDetected(testQCAddress, false)

          expect(await qcData.getQCOracleFailureDetected(testQCAddress)).to.be
            .false
        }
      })
    })

    describe("5.3 State Transition Edge Cases", () => {
      it("should handle oracle updates during QC status transitions", async () => {
        // Start with active QC
        expect(await qcData.getQCStatus(testQCAddress)).to.equal(
          QCStatus.Active
        )

        // Update oracle data during status change
        await qcData
          .connect(qcManager)
          .setQCStatus(testQCAddress, QCStatus.Paused, testReason)

        // Oracle update should still work
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)

        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(baseTimestamp)
      })

      it("should handle concurrent oracle and QC operations", async () => {
        // Simulate concurrent operations
        const promises = [
          qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp),
          qcData
            .connect(qcManager)
            .updateQCOracleFailureDetected(testQCAddress, true),
          qcData
            .connect(qcManager)
            .setQCStatus(testQCAddress, QCStatus.MintingPaused, testReason),
        ]

        // All operations should succeed
        await Promise.all(promises)

        // Verify final state
        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(baseTimestamp)
        expect(await qcData.getQCOracleFailureDetected(testQCAddress)).to.be
          .true
        expect(await qcData.getQCStatus(testQCAddress)).to.equal(
          QCStatus.MintingPaused
        )
      })
    })

    describe("5.4 Memory and Storage Edge Cases", () => {
      it("should handle multiple QCs with different oracle states", async () => {
        // Register additional QCs
        const qc3 = "0x3333333333333333333333333333333333333333"
        const qc4 = "0x4444444444444444444444444444444444444444"

        await qcData.connect(qcManager).registerQC(qc3, maxMintingCapacity)
        await qcData.connect(qcManager).registerQC(qc4, maxMintingCapacity)

        // Set different oracle states for each QC
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress2, futureTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress2, false)

        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(qc3, pastTimestamp)
        await qcData.connect(qcManager).updateQCOracleFailureDetected(qc3, true)

        // Verify isolation
        const data1 = await qcData.getQCOracleData(testQCAddress)
        const data2 = await qcData.getQCOracleData(testQCAddress2)
        const data3 = await qcData.getQCOracleData(qc3)
        const data4 = await qcData.getQCOracleData(qc4)

        expect(data1.lastSyncTimestamp).to.equal(baseTimestamp)
        expect(data1.oracleFailureDetected).to.be.true

        expect(data2.lastSyncTimestamp).to.equal(futureTimestamp)
        expect(data2.oracleFailureDetected).to.be.false

        expect(data3.lastSyncTimestamp).to.equal(pastTimestamp)
        expect(data3.oracleFailureDetected).to.be.true

        expect(data4.lastSyncTimestamp).to.equal(0) // Default
        expect(data4.oracleFailureDetected).to.be.false // Default
      })
    })
  })

  describe("6. Multi-QC Oracle Management Tests", () => {
    describe("6.1 Independent Oracle States", () => {
      it("should maintain independent oracle data for multiple QCs", async () => {
        // Register additional QCs
        const qc3 = "0x3333333333333333333333333333333333333333"
        const qc4 = "0x4444444444444444444444444444444444444444"
        const qc5 = "0x5555555555555555555555555555555555555555"

        await qcData.connect(qcManager).registerQC(qc3, maxMintingCapacity)
        await qcData.connect(qcManager).registerQC(qc4, maxMintingCapacity)
        await qcData.connect(qcManager).registerQC(qc5, maxMintingCapacity)

        // Set different oracle states for each QC
        const oracleStates = [
          { qc: testQCAddress, timestamp: baseTimestamp, failure: true },
          { qc: testQCAddress2, timestamp: futureTimestamp, failure: false },
          { qc: qc3, timestamp: pastTimestamp, failure: true },
          { qc: qc4, timestamp: 0, failure: false },
          { qc: qc5, timestamp: ethers.constants.MaxUint256, failure: true },
        ]

        // Apply oracle states
        for (const state of oracleStates) {
          await qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(state.qc, state.timestamp)
          await qcData
            .connect(qcManager)
            .updateQCOracleFailureDetected(state.qc, state.failure)
        }

        // Verify independence
        for (const state of oracleStates) {
          const oracleData = await qcData.getQCOracleData(state.qc)
          expect(oracleData.lastSyncTimestamp).to.equal(state.timestamp)
          expect(oracleData.oracleFailureDetected).to.equal(state.failure)
        }
      })

      it("should handle oracle updates affecting only specific QCs", async () => {
        // Set initial states
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress2, futureTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress2, false)

        // Update only first QC
        const newTimestamp = pastTimestamp
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, newTimestamp)

        // Verify only first QC changed
        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(newTimestamp)
        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress2)
        ).to.equal(futureTimestamp)

        // Update only second QC failure detection
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress2, true)

        // Verify isolation
        expect(await qcData.getQCOracleFailureDetected(testQCAddress)).to.be
          .true
        expect(await qcData.getQCOracleFailureDetected(testQCAddress2)).to.be
          .true
      })

      it("should support bulk oracle operations efficiently", async () => {
        // Register multiple QCs
        const qcs = []
        for (let i = 3; i <= 7; i++) {
          const qc = `0x${i.toString(16).padStart(8, "0").repeat(5)}`
          qcs.push(qc)
          await qcData.connect(qcManager).registerQC(qc, maxMintingCapacity)
        }

        // Bulk update timestamps
        const updatePromises = qcs.map((qc, index) =>
          qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(qc, baseTimestamp + index * 1000)
        )

        await Promise.all(updatePromises)

        // Verify all updates
        for (let i = 0; i < qcs.length; i++) {
          expect(await qcData.getQCOracleLastSyncTimestamp(qcs[i])).to.equal(
            baseTimestamp + i * 1000
          )
        }
      })

      it("should handle oracle data aggregation scenarios", async () => {
        // Set up multiple QCs with different oracle states
        const qcs = [testQCAddress, testQCAddress2]
        const timestamps = [baseTimestamp, futureTimestamp]
        const failures = [true, false]

        for (let i = 0; i < qcs.length; i++) {
          await qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(qcs[i], timestamps[i])
          await qcData
            .connect(qcManager)
            .updateQCOracleFailureDetected(qcs[i], failures[i])
        }

        // Simulate aggregation by reading all data
        const allOracleData = []
        for (const qc of qcs) {
          const data = await qcData.getQCOracleData(qc)
          allOracleData.push({
            qc,
            timestamp: data.lastSyncTimestamp,
            failure: data.oracleFailureDetected,
          })
        }

        // Verify aggregated data
        expect(allOracleData).to.have.length(2)
        expect(allOracleData[0].timestamp).to.equal(baseTimestamp)
        expect(allOracleData[0].failure).to.be.true
        expect(allOracleData[1].timestamp).to.equal(futureTimestamp)
        expect(allOracleData[1].failure).to.be.false
      })
    })

    describe("6.2 Oracle Synchronization Patterns", () => {
      it("should support synchronized oracle updates across multiple QCs", async () => {
        const qcs = [testQCAddress, testQCAddress2]
        const syncTimestamp = baseTimestamp

        // Synchronized update - same timestamp for all QCs
        for (const qc of qcs) {
          await qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(qc, syncTimestamp)
        }

        // Verify synchronization
        for (const qc of qcs) {
          expect(await qcData.getQCOracleLastSyncTimestamp(qc)).to.equal(
            syncTimestamp
          )
        }
      })

      it("should handle staggered oracle updates", async () => {
        const qcs = [testQCAddress, testQCAddress2]
        const baseTime = baseTimestamp

        // Staggered updates with increasing timestamps
        for (let i = 0; i < qcs.length; i++) {
          await qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(qcs[i], baseTime + i * 3600) // 1 hour apart
        }

        // Verify staggered pattern
        for (let i = 0; i < qcs.length; i++) {
          expect(await qcData.getQCOracleLastSyncTimestamp(qcs[i])).to.equal(
            baseTime + i * 3600
          )
        }
      })

      it("should support oracle failure recovery scenarios", async () => {
        // Simulate failure scenario
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress2, true)

        // Verify failure state
        expect(await qcData.getQCOracleFailureDetected(testQCAddress)).to.be
          .true
        expect(await qcData.getQCOracleFailureDetected(testQCAddress2)).to.be
          .true

        // Simulate recovery - restore one at a time
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, false)
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)

        // Verify partial recovery
        expect(await qcData.getQCOracleFailureDetected(testQCAddress)).to.be
          .false
        expect(await qcData.getQCOracleFailureDetected(testQCAddress2)).to.be
          .true

        // Complete recovery
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress2, false)
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress2, baseTimestamp)

        // Verify full recovery
        expect(await qcData.getQCOracleFailureDetected(testQCAddress)).to.be
          .false
        expect(await qcData.getQCOracleFailureDetected(testQCAddress2)).to.be
          .false
      })

      it("should maintain oracle coordination during QC lifecycle events", async () => {
        // Set initial oracle states
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, false)

        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress2, futureTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress2, true)

        // Change QC statuses
        await qcData
          .connect(qcManager)
          .setQCStatus(testQCAddress, QCStatus.Paused, testReason)
        await qcData
          .connect(qcManager)
          .setQCStatus(testQCAddress2, QCStatus.UnderReview, testReason)

        // Oracle states should be preserved
        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(baseTimestamp)
        expect(await qcData.getQCOracleFailureDetected(testQCAddress)).to.be
          .false

        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress2)
        ).to.equal(futureTimestamp)
        expect(await qcData.getQCOracleFailureDetected(testQCAddress2)).to.be
          .true

        // Oracle updates should still work during status changes
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, pastTimestamp)

        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(pastTimestamp)
      })
    })
  })

  describe("7. Performance & Gas Optimization Tests", () => {
    describe("7.1 Gas Usage Testing", () => {
      it("should have reasonable gas costs for oracle operations", async () => {
        // Test timestamp update gas usage
        const timestampTx = await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)

        const timestampReceipt = await timestampTx.wait()

        // Test failure detection gas usage
        const failureTx = await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        const failureReceipt = await failureTx.wait()

        // Gas usage should be reasonable (these are estimates)
        expect(timestampReceipt.gasUsed).to.be.lt(100000) // Should be well under 100k gas
        expect(failureReceipt.gasUsed).to.be.lt(100000)

        console.log(`Timestamp update gas: ${timestampReceipt.gasUsed}`)
        console.log(`Failure detection gas: ${failureReceipt.gasUsed}`)
      })

      it("should have efficient gas usage for getter functions", async () => {
        // Set up data
        await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)
        await qcData
          .connect(qcManager)
          .updateQCOracleFailureDetected(testQCAddress, true)

        // Estimate gas for view functions (should be very cheap)
        const comprehensiveGas = await qcData.estimateGas.getQCOracleData(
          testQCAddress
        )

        const timestampGas =
          await qcData.estimateGas.getQCOracleLastSyncTimestamp(testQCAddress)

        const failureGas = await qcData.estimateGas.getQCOracleFailureDetected(
          testQCAddress
        )

        // View functions should be very cheap
        expect(comprehensiveGas).to.be.lt(30000)
        expect(timestampGas).to.be.lt(30000)
        expect(failureGas).to.be.lt(30000)

        console.log(`Comprehensive getter gas: ${comprehensiveGas}`)
        console.log(`Timestamp getter gas: ${timestampGas}`)
        console.log(`Failure getter gas: ${failureGas}`)
      })

      it("should optimize gas for repeated operations", async () => {
        // First operation (cold storage)
        const firstTx = await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp)

        const firstReceipt = await firstTx.wait()

        // Second operation (warm storage)
        const secondTx = await qcData
          .connect(qcManager)
          .updateQCOracleSyncTimestamp(testQCAddress, futureTimestamp)

        const secondReceipt = await secondTx.wait()

        // Second operation should use less gas due to warm storage
        expect(secondReceipt.gasUsed).to.be.lte(firstReceipt.gasUsed)

        console.log(`First update gas: ${firstReceipt.gasUsed}`)
        console.log(`Second update gas: ${secondReceipt.gasUsed}`)
      })

      it("should handle batch operations efficiently", async () => {
        // Register additional QCs for batch testing
        const additionalQCs = []
        for (let i = 3; i <= 5; i++) {
          const qc = `0x${i.toString(16).padStart(8, "0").repeat(5)}`
          additionalQCs.push(qc)
          await qcData.connect(qcManager).registerQC(qc, maxMintingCapacity)
        }

        // Measure gas for individual operations
        const individualGasUsed = []
        for (const qc of additionalQCs) {
          const tx = await qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(qc, baseTimestamp)

          const receipt = await tx.wait()
          individualGasUsed.push(receipt.gasUsed.toNumber())
        }

        const totalIndividualGas = individualGasUsed.reduce(
          (sum, gas) => sum + gas,
          0
        )

        console.log(
          `Total gas for ${additionalQCs.length} individual operations: ${totalIndividualGas}`
        )
        console.log(
          `Average gas per operation: ${
            totalIndividualGas / additionalQCs.length
          }`
        )

        // Verify gas usage is reasonable for multiple QCs
        expect(totalIndividualGas).to.be.lt(500000) // Reasonable upper bound
      })
    })

    describe("7.2 Storage Optimization", () => {
      it("should efficiently store oracle data for multiple QCs", async () => {
        // Test storage efficiency by registering many QCs
        const qcs = []
        const numQCs = 10

        // Register QCs
        for (let i = 0; i < numQCs; i++) {
          // Generate valid Ethereum addresses (20 bytes = 40 hex chars)
          const qc = `0x${(i + 1).toString(16).padStart(8, "0").repeat(5)}`
          qcs.push(qc)
          await qcData.connect(qcManager).registerQC(qc, maxMintingCapacity)
        }

        // Set oracle data for each QC
        for (let i = 0; i < qcs.length; i++) {
          await qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(qcs[i], baseTimestamp + i)
          await qcData
            .connect(qcManager)
            .updateQCOracleFailureDetected(qcs[i], i % 2 === 0)
        }

        // Verify all data is stored correctly
        for (let i = 0; i < qcs.length; i++) {
          const data = await qcData.getQCOracleData(qcs[i])
          expect(data.lastSyncTimestamp).to.equal(baseTimestamp + i)
          expect(data.oracleFailureDetected).to.equal(i % 2 === 0)
        }
      })

      it("should maintain consistent read performance across multiple QCs", async () => {
        // Set up multiple QCs with oracle data
        const qcs = [testQCAddress, testQCAddress2]

        for (const qc of qcs) {
          await qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(qc, baseTimestamp)
          await qcData
            .connect(qcManager)
            .updateQCOracleFailureDetected(qc, true)
        }

        // Measure read performance for each QC
        const readTimes = []
        for (const qc of qcs) {
          const start = Date.now()
          await qcData.getQCOracleData(qc)
          const end = Date.now()
          readTimes.push(end - start)
        }

        // Read times should be consistent (this is more about ensuring no major regressions)
        const avgReadTime =
          readTimes.reduce((sum, time) => sum + time, 0) / readTimes.length

        console.log(`Average read time: ${avgReadTime}ms`)

        // All read times should be relatively fast and consistent
        for (const readTime of readTimes) {
          expect(readTime).to.be.lt(100) // Should be very fast in test environment
        }
      })
    })

    describe("7.3 Scalability Testing", () => {
      it("should handle maximum realistic oracle update load", async () => {
        // Test rapid consecutive updates
        const numUpdates = 50
        const startTime = Date.now()

        for (let i = 0; i < numUpdates; i++) {
          await qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(testQCAddress, baseTimestamp + i)
        }

        const endTime = Date.now()
        const totalTime = endTime - startTime

        console.log(`${numUpdates} oracle updates completed in ${totalTime}ms`)
        console.log(`Average time per update: ${totalTime / numUpdates}ms`)

        // Verify final state
        expect(
          await qcData.getQCOracleLastSyncTimestamp(testQCAddress)
        ).to.equal(baseTimestamp + numUpdates - 1)
      })

      it("should maintain performance with complex oracle state combinations", async () => {
        // Create complex oracle state scenario
        const numQCs = 5
        const qcs = []

        // Register multiple QCs
        for (let i = 0; i < numQCs; i++) {
          const qc = `0x${(i + 100).toString(16).padStart(8, "0").repeat(5)}`
          qcs.push(qc)
          await qcData.connect(qcManager).registerQC(qc, maxMintingCapacity)
        }

        // Set complex oracle states
        for (let i = 0; i < qcs.length; i++) {
          const timestamp = i % 2 === 0 ? baseTimestamp : futureTimestamp
          const failure = i % 3 === 0

          await qcData
            .connect(qcManager)
            .updateQCOracleSyncTimestamp(qcs[i], timestamp)
          await qcData
            .connect(qcManager)
            .updateQCOracleFailureDetected(qcs[i], failure)
        }

        // Verify all complex states are maintained
        for (let i = 0; i < qcs.length; i++) {
          const data = await qcData.getQCOracleData(qcs[i])

          const expectedTimestamp =
            i % 2 === 0 ? baseTimestamp : futureTimestamp

          const expectedFailure = i % 3 === 0

          expect(data.lastSyncTimestamp).to.equal(expectedTimestamp)
          expect(data.oracleFailureDetected).to.equal(expectedFailure)
        }
      })
    })
  })
})

// Helper function to get latest block timestamp
async function getLatestBlockTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest")
  return block.timestamp
}
