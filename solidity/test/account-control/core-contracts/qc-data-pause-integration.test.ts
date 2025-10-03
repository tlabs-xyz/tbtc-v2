import { expect } from "chai"
import { ethers } from "hardhat"
import { QCData } from "../../../../typechain"
import {
  setupAccountControlTestSigners,
  createBaseTestEnvironment,
  restoreBaseTestEnvironment,
  AccountControlTestSigners,
} from "../../fixtures"

describe("QCData - PauseLevel Integration", () => {
  let signers: AccountControlTestSigners
  let qcData: QCData
  let qcManager: any

  // Test data
  const testQCAddress = "0x1234567890123456789012345678901234567890"
  const testQCAddress2 = "0x2345678901234567890123456789012345678901"
  const maxMintingCapacity = ethers.utils.parseEther("100")
  const testReason = ethers.utils.id("TEST_REASON")

  // Enum values
  const QCStatus = {
    Active: 0,
    MintingPaused: 1,
    Paused: 2,
    UnderReview: 3,
    Revoked: 4,
  }

  const PauseLevel = {
    MintingOnly: 0,
    Complete: 1,
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

  describe("QC Registration with Default Pause Settings", () => {
    it("should initialize QC with MintingOnly pause level", async () => {
      const pauseLevel = await qcData.getQCPauseLevel(testQCAddress)
      expect(pauseLevel).to.equal(PauseLevel.MintingOnly)
    })

    it("should initialize QC with selfPaused = false", async () => {
      const selfPaused = await qcData.getQCSelfPaused(testQCAddress)
      expect(selfPaused).to.be.false
    })

    it("should allow minting for newly registered QC (Active + MintingOnly)", async () => {
      const canMint = await qcData.canQCMint(testQCAddress)
      expect(canMint).to.be.true
    })

    it("should allow fulfillment for newly registered QC (Active + MintingOnly)", async () => {
      const canFulfill = await qcData.canQCFulfill(testQCAddress)
      expect(canFulfill).to.be.true
    })
  })

  describe("setQCPauseLevel Function", () => {
    it("should set pause level and emit event", async () => {
      const tx = qcData.connect(qcManager).setQCPauseLevel(
        testQCAddress,
        PauseLevel.Complete,
        true // selfInitiated
      )

      await expect(tx)
        .to.emit(qcData, "QCPauseLevelUpdated")
        .withArgs(
          testQCAddress,
          PauseLevel.MintingOnly, // old level
          PauseLevel.Complete, // new level
          true, // selfInitiated
          qcManager.address,
          await getBlockTimestamp()
        )
    })

    it("should update pause level in storage", async () => {
      await qcData
        .connect(qcManager)
        .setQCPauseLevel(testQCAddress, PauseLevel.Complete, true)

      expect(await qcData.getQCPauseLevel(testQCAddress)).to.equal(
        PauseLevel.Complete
      )
      expect(await qcData.getQCSelfPaused(testQCAddress)).to.be.true
    })

    it("should reject calls from unauthorized addresses", async () => {
      await expect(
        qcData
          .connect(signers.user)
          .setQCPauseLevel(testQCAddress, PauseLevel.Complete, false)
      ).to.be.revertedWith("AccessControl:")
    })

    it("should reject calls for unregistered QC", async () => {
      const unregisteredQC = "0x9999999999999999999999999999999999999999"

      await expect(
        qcData
          .connect(qcManager)
          .setQCPauseLevel(unregisteredQC, PauseLevel.Complete, false)
      )
        .to.be.revertedWithCustomError(qcData, "QCNotRegistered")
        .withArgs(unregisteredQC)
    })
  })

  describe("canQCMint Integration with PauseLevel", () => {
    describe("Active QC Status", () => {
      it("should allow minting when Active + MintingOnly pause", async () => {
        // QC starts as Active + MintingOnly by default
        expect(await qcData.canQCMint(testQCAddress)).to.be.true
      })

      it("should block minting when Active + Complete pause", async () => {
        await qcData
          .connect(qcManager)
          .setQCPauseLevel(testQCAddress, PauseLevel.Complete, false)

        expect(await qcData.canQCMint(testQCAddress)).to.be.false
      })
    })

    describe("MintingPaused QC Status", () => {
      beforeEach(async () => {
        // Set QC to MintingPaused status
        await qcData
          .connect(qcManager)
          .setQCStatus(testQCAddress, QCStatus.MintingPaused, testReason)
      })

      it("should block minting when MintingPaused regardless of pause level", async () => {
        // Test with MintingOnly pause level
        await qcData
          .connect(qcManager)
          .setQCPauseLevel(testQCAddress, PauseLevel.MintingOnly, false)
        expect(await qcData.canQCMint(testQCAddress)).to.be.false

        // Test with Complete pause level
        await qcData
          .connect(qcManager)
          .setQCPauseLevel(testQCAddress, PauseLevel.Complete, false)
        expect(await qcData.canQCMint(testQCAddress)).to.be.false
      })
    })

    describe("Other QC Statuses", () => {
      const inactiveStatuses = [
        { name: "Paused", value: QCStatus.Paused },
        { name: "UnderReview", value: QCStatus.UnderReview },
        { name: "Revoked", value: QCStatus.Revoked },
      ]

      inactiveStatuses.forEach((status) => {
        it(`should block minting when ${status.name} regardless of pause level`, async () => {
          await qcData
            .connect(qcManager)
            .setQCStatus(testQCAddress, status.value, testReason)

          // Test with MintingOnly pause level
          await qcData
            .connect(qcManager)
            .setQCPauseLevel(testQCAddress, PauseLevel.MintingOnly, false)
          expect(await qcData.canQCMint(testQCAddress)).to.be.false

          // Test with Complete pause level
          await qcData
            .connect(qcManager)
            .setQCPauseLevel(testQCAddress, PauseLevel.Complete, false)
          expect(await qcData.canQCMint(testQCAddress)).to.be.false
        })
      })
    })

    it("should block minting for unregistered QC", async () => {
      const unregisteredQC = "0x9999999999999999999999999999999999999999"
      expect(await qcData.canQCMint(unregisteredQC)).to.be.false
    })
  })

  describe("canQCFulfill Integration with PauseLevel", () => {
    describe("Active QC Status", () => {
      it("should allow fulfillment when Active + MintingOnly pause", async () => {
        // QC starts as Active + MintingOnly by default
        expect(await qcData.canQCFulfill(testQCAddress)).to.be.true
      })

      it("should block fulfillment when Active + Complete pause", async () => {
        await qcData
          .connect(qcManager)
          .setQCPauseLevel(testQCAddress, PauseLevel.Complete, false)

        expect(await qcData.canQCFulfill(testQCAddress)).to.be.false
      })
    })

    describe("MintingPaused QC Status", () => {
      beforeEach(async () => {
        // Set QC to MintingPaused status
        await qcData
          .connect(qcManager)
          .setQCStatus(testQCAddress, QCStatus.MintingPaused, testReason)
      })

      it("should allow fulfillment when MintingPaused + MintingOnly pause", async () => {
        await qcData
          .connect(qcManager)
          .setQCPauseLevel(testQCAddress, PauseLevel.MintingOnly, false)

        expect(await qcData.canQCFulfill(testQCAddress)).to.be.true
      })

      it("should block fulfillment when MintingPaused + Complete pause", async () => {
        await qcData
          .connect(qcManager)
          .setQCPauseLevel(testQCAddress, PauseLevel.Complete, false)

        expect(await qcData.canQCFulfill(testQCAddress)).to.be.false
      })
    })

    describe("Other QC Statuses", () => {
      const inactiveStatuses = [
        { name: "Paused", value: QCStatus.Paused },
        { name: "UnderReview", value: QCStatus.UnderReview },
        { name: "Revoked", value: QCStatus.Revoked },
      ]

      inactiveStatuses.forEach((status) => {
        it(`should block fulfillment when ${status.name} regardless of pause level`, async () => {
          await qcData
            .connect(qcManager)
            .setQCStatus(testQCAddress, status.value, testReason)

          // Test with MintingOnly pause level
          await qcData
            .connect(qcManager)
            .setQCPauseLevel(testQCAddress, PauseLevel.MintingOnly, false)
          expect(await qcData.canQCFulfill(testQCAddress)).to.be.false

          // Test with Complete pause level
          await qcData
            .connect(qcManager)
            .setQCPauseLevel(testQCAddress, PauseLevel.Complete, false)
          expect(await qcData.canQCFulfill(testQCAddress)).to.be.false
        })
      })
    })

    it("should block fulfillment for unregistered QC", async () => {
      const unregisteredQC = "0x9999999999999999999999999999999999999999"
      expect(await qcData.canQCFulfill(unregisteredQC)).to.be.false
    })
  })

  describe("Comprehensive Permission Matrix", () => {
    interface PermissionTest {
      qcStatus: string
      qcStatusValue: number
      pauseLevel: string
      pauseLevelValue: number
      canMint: boolean
      canFulfill: boolean
    }

    const permissionMatrix: PermissionTest[] = [
      // Active status combinations
      {
        qcStatus: "Active",
        qcStatusValue: QCStatus.Active,
        pauseLevel: "MintingOnly",
        pauseLevelValue: PauseLevel.MintingOnly,
        canMint: true,
        canFulfill: true,
      },
      {
        qcStatus: "Active",
        qcStatusValue: QCStatus.Active,
        pauseLevel: "Complete",
        pauseLevelValue: PauseLevel.Complete,
        canMint: false,
        canFulfill: false,
      },

      // MintingPaused status combinations
      {
        qcStatus: "MintingPaused",
        qcStatusValue: QCStatus.MintingPaused,
        pauseLevel: "MintingOnly",
        pauseLevelValue: PauseLevel.MintingOnly,
        canMint: false,
        canFulfill: true,
      },
      {
        qcStatus: "MintingPaused",
        qcStatusValue: QCStatus.MintingPaused,
        pauseLevel: "Complete",
        pauseLevelValue: PauseLevel.Complete,
        canMint: false,
        canFulfill: false,
      },

      // Other statuses (all should block both operations regardless of pause level)
      {
        qcStatus: "Paused",
        qcStatusValue: QCStatus.Paused,
        pauseLevel: "MintingOnly",
        pauseLevelValue: PauseLevel.MintingOnly,
        canMint: false,
        canFulfill: false,
      },
      {
        qcStatus: "Paused",
        qcStatusValue: QCStatus.Paused,
        pauseLevel: "Complete",
        pauseLevelValue: PauseLevel.Complete,
        canMint: false,
        canFulfill: false,
      },
      {
        qcStatus: "UnderReview",
        qcStatusValue: QCStatus.UnderReview,
        pauseLevel: "MintingOnly",
        pauseLevelValue: PauseLevel.MintingOnly,
        canMint: false,
        canFulfill: false,
      },
      {
        qcStatus: "UnderReview",
        qcStatusValue: QCStatus.UnderReview,
        pauseLevel: "Complete",
        pauseLevelValue: PauseLevel.Complete,
        canMint: false,
        canFulfill: false,
      },
      {
        qcStatus: "Revoked",
        qcStatusValue: QCStatus.Revoked,
        pauseLevel: "MintingOnly",
        pauseLevelValue: PauseLevel.MintingOnly,
        canMint: false,
        canFulfill: false,
      },
      {
        qcStatus: "Revoked",
        qcStatusValue: QCStatus.Revoked,
        pauseLevel: "Complete",
        pauseLevelValue: PauseLevel.Complete,
        canMint: false,
        canFulfill: false,
      },
    ]

    permissionMatrix.forEach((test) => {
      it(`should handle ${test.qcStatus} + ${test.pauseLevel}: mint=${test.canMint}, fulfill=${test.canFulfill}`, async () => {
        // Set QC status
        if (test.qcStatusValue !== QCStatus.Active) {
          await qcData
            .connect(qcManager)
            .setQCStatus(testQCAddress, test.qcStatusValue, testReason)
        }

        // Set pause level
        await qcData
          .connect(qcManager)
          .setQCPauseLevel(testQCAddress, test.pauseLevelValue, false)

        // Test permissions
        expect(await qcData.canQCMint(testQCAddress)).to.equal(test.canMint)
        expect(await qcData.canQCFulfill(testQCAddress)).to.equal(
          test.canFulfill
        )
      })
    })
  })

  describe("getQCInfo Integration", () => {
    it("should return pause level and selfPaused in comprehensive info", async () => {
      // Set specific pause state
      await qcData
        .connect(qcManager)
        .setQCPauseLevel(testQCAddress, PauseLevel.Complete, true)

      const info = await qcData.getQCInfo(testQCAddress)

      // info should return: status, totalMinted, maxCapacity, registeredAt, pauseLevel, selfPaused
      expect(info.status).to.equal(QCStatus.Active)
      expect(info.totalMinted).to.equal(0)
      expect(info.maxCapacity).to.equal(maxMintingCapacity)
      expect(info.registeredAt).to.be.gt(0)
      expect(info.pauseLevel).to.equal(PauseLevel.Complete)
      expect(info.selfPaused).to.be.true
    })
  })

  describe("Multiple QCs with Different Pause States", () => {
    it("should handle independent pause states for multiple QCs", async () => {
      // Set different pause levels for different QCs
      await qcData
        .connect(qcManager)
        .setQCPauseLevel(testQCAddress, PauseLevel.Complete, true)

      await qcData
        .connect(qcManager)
        .setQCPauseLevel(testQCAddress2, PauseLevel.MintingOnly, false)

      // Verify independent states
      expect(await qcData.getQCPauseLevel(testQCAddress)).to.equal(
        PauseLevel.Complete
      )
      expect(await qcData.getQCSelfPaused(testQCAddress)).to.be.true
      expect(await qcData.canQCMint(testQCAddress)).to.be.false
      expect(await qcData.canQCFulfill(testQCAddress)).to.be.false

      expect(await qcData.getQCPauseLevel(testQCAddress2)).to.equal(
        PauseLevel.MintingOnly
      )
      expect(await qcData.getQCSelfPaused(testQCAddress2)).to.be.false
      expect(await qcData.canQCMint(testQCAddress2)).to.be.true
      expect(await qcData.canQCFulfill(testQCAddress2)).to.be.true
    })
  })
})

// Helper function to get current block timestamp
async function getBlockTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest")
  return block.timestamp
}
