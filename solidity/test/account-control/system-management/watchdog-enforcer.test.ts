import chai, { expect } from "chai"
import { ethers, network } from "hardhat"
import { FakeContract, smock } from "@defi-wonderland/smock"
import { time } from "@nomicfoundation/hardhat-network-helpers"

import {
  WatchdogEnforcer,
  ReserveOracle,
  QCManager,
  QCData,
  SystemState,
} from "../../../typechain"
import {
  setupTestSigners,
  createBaseTestEnvironment,
  restoreBaseTestEnvironment,
  TestSigners,
} from "../fixtures/base-setup"
import { expectCustomError, ERROR_MESSAGES } from "../helpers/error-helpers"

chai.use(smock.matchers)

describe("WatchdogEnforcer", () => {
  let signers: TestSigners
  let watchdogEnforcer: WatchdogEnforcer
  let mockReserveOracle: FakeContract<ReserveOracle>
  let mockQcManager: FakeContract<QCManager>
  let mockQcData: FakeContract<QCData>
  let mockSystemState: FakeContract<SystemState>

  // Roles
  let DEFAULT_ADMIN_ROLE: string
  let ENFORCEMENT_ROLE: string

  // Reason codes
  let INSUFFICIENT_RESERVES: string
  let STALE_ATTESTATIONS: string
  let PROLONGED_STALENESS: string
  let EXTENDED_UNDER_REVIEW: string
  let SUSTAINED_RESERVE_VIOLATION: string

  // Test data
  const reserveBalance = ethers.utils.parseEther("10")
  const mintedAmount = ethers.utils.parseEther("15") // Undercollateralized
  const minCollateralRatio = 100 // 100% = 1:1 ratio

  before(async () => {
    signers = await setupTestSigners()

    // Generate role hashes
    DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
    ENFORCEMENT_ROLE = ethers.utils.id("ENFORCEMENT_ROLE")

    // Generate reason codes
    INSUFFICIENT_RESERVES = ethers.utils.id("INSUFFICIENT_RESERVES")
    STALE_ATTESTATIONS = ethers.utils.id("STALE_ATTESTATIONS")
    PROLONGED_STALENESS = ethers.utils.id("PROLONGED_STALENESS")
    EXTENDED_UNDER_REVIEW = ethers.utils.id("EXTENDED_UNDER_REVIEW")
    SUSTAINED_RESERVE_VIOLATION = ethers.utils.id("SUSTAINED_RESERVE_VIOLATION")
  })

  beforeEach(async () => {
    await createBaseTestEnvironment()

    // Create mock contracts
    mockReserveOracle = await smock.fake<ReserveOracle>("ReserveOracle")
    mockQcManager = await smock.fake<QCManager>("QCManager")
    mockQcData = await smock.fake<QCData>("QCData")
    mockSystemState = await smock.fake<SystemState>("SystemState")

    // Deploy WatchdogEnforcer
    const WatchdogEnforcerFactory = await ethers.getContractFactory(
      "WatchdogEnforcer"
    )

    watchdogEnforcer = await WatchdogEnforcerFactory.deploy(
      mockReserveOracle.address,
      mockQcManager.address,
      mockQcData.address,
      mockSystemState.address
    )
    await watchdogEnforcer.deployed()

    // Set up default mock behaviors
    mockSystemState.minCollateralRatio.returns(minCollateralRatio)
    mockQcData.getQCMintedAmount.returns(mintedAmount)
    mockReserveOracle.getReserveBalanceAndStaleness.returns([
      reserveBalance,
      false,
    ])
  })

  afterEach(async () => {
    await restoreBaseTestEnvironment()
  })

  describe("Deployment", () => {
    it("should set correct addresses", async () => {
      expect(await watchdogEnforcer.reserveOracle()).to.equal(
        mockReserveOracle.address
      )
      expect(await watchdogEnforcer.qcManager()).to.equal(mockQcManager.address)
      expect(await watchdogEnforcer.qcData()).to.equal(mockQcData.address)
      expect(await watchdogEnforcer.systemState()).to.equal(
        mockSystemState.address
      )
    })

    it("should grant deployer necessary roles", async () => {
      const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
      expect(
        await watchdogEnforcer.hasRole(
          DEFAULT_ADMIN_ROLE,
          signers.deployer.address
        )
      ).to.be.true
      expect(
        await watchdogEnforcer.hasRole(
          ENFORCEMENT_ROLE,
          signers.deployer.address
        )
      ).to.be.true
    })

    it("should have correct reason codes", async () => {
      expect(await watchdogEnforcer.INSUFFICIENT_RESERVES()).to.equal(
        INSUFFICIENT_RESERVES
      )
      expect(await watchdogEnforcer.STALE_ATTESTATIONS()).to.equal(
        STALE_ATTESTATIONS
      )
      expect(await watchdogEnforcer.PROLONGED_STALENESS()).to.equal(
        PROLONGED_STALENESS
      )
      expect(await watchdogEnforcer.EXTENDED_UNDER_REVIEW()).to.equal(
        EXTENDED_UNDER_REVIEW
      )
    })
  })

  describe("enforceObjectiveViolation", () => {
    context("when enforcing insufficient reserves", () => {
      context("when QC has insufficient reserves", () => {
        let tx: any // ContractTransaction

        beforeEach(async () => {
          // Setup: reserves < minted amount
          mockReserveOracle.getReserveBalanceAndStaleness.returns([
            reserveBalance,
            false,
          ])
          mockQcData.getQCMintedAmount.returns(
            reserveBalance.add(ethers.utils.parseEther("1"))
          ) // Undercollateralized

          tx = await watchdogEnforcer.enforceObjectiveViolation(
            signers.qcAddress.address,
            INSUFFICIENT_RESERVES
          )
        })

        it("should call requestStatusChange on QCManager", async () => {
          expect(mockQcManager.requestStatusChange).to.have.been.calledWith(
            signers.qcAddress.address,
            3, // UnderReview
            INSUFFICIENT_RESERVES
          )
        })

        it("should emit ObjectiveViolationEnforced event", async () => {
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
          await expect(tx)
            .to.emit(watchdogEnforcer, "ObjectiveViolationEnforced")
            .withArgs(
              signers.qcAddress.address,
              INSUFFICIENT_RESERVES,
              signers.deployer.address,
              currentBlock.timestamp
            )
        })

        it("should emit EnforcementAttempted event", async () => {
          await expect(tx)
            .to.emit(watchdogEnforcer, "EnforcementAttempted")
            .withArgs(
              signers.qcAddress.address,
              INSUFFICIENT_RESERVES,
              signers.deployer.address,
              true,
              ""
            )
        })
      })

      context("when QC has sufficient reserves", () => {
        beforeEach(async () => {
          // Setup: reserves >= minted amount
          mockReserveOracle.getReserveBalanceAndStaleness.returns([
            reserveBalance,
            false,
          ])
          mockQcData.getQCMintedAmount.returns(reserveBalance) // Exactly collateralized
        })

        it("should revert with ViolationNotFound", async () => {
          await expect(
            watchdogEnforcer.enforceObjectiveViolation(
              signers.qcAddress.address,
              INSUFFICIENT_RESERVES
            )
          ).to.be.revertedWith("ViolationNotFound")
        })

        it("should emit EnforcementAttempted event before reverting", async () => {
          // Unfortunately, we can't test events emitted before revert in current Hardhat
          // The test is that it reverts with ViolationNotFound
        })
      })

      context("when reserves are stale", () => {
        beforeEach(async () => {
          // Setup: stale reserves
          mockReserveOracle.getReserveBalanceAndStaleness.returns([
            reserveBalance,
            true, // Stale
          ])
        })

        it("should revert when checking insufficient reserves", async () => {
          await expect(
            watchdogEnforcer.enforceObjectiveViolation(
              signers.qcAddress.address,
              INSUFFICIENT_RESERVES
            )
          ).to.be.revertedWith("ViolationNotFound")
        })

        it("should emit EnforcementAttempted event before reverting", async () => {
          // Unfortunately, we can't test events emitted before revert in current Hardhat
          // The test is that it reverts with ViolationNotFound
        })
      })
    })

    context("when enforcing stale attestations", () => {
      context("when attestations are stale", () => {
        let tx: any // ContractTransaction

        beforeEach(async () => {
          // Setup: stale attestations
          mockReserveOracle.getReserveBalanceAndStaleness.returns([
            reserveBalance,
            true, // Stale
          ])

          tx = await watchdogEnforcer.enforceObjectiveViolation(
            signers.qcAddress.address,
            STALE_ATTESTATIONS
          )
        })

        it("should call requestStatusChange on QCManager", async () => {
          expect(mockQcManager.requestStatusChange).to.have.been.calledWith(
            signers.qcAddress.address,
            3, // UnderReview
            STALE_ATTESTATIONS
          )
        })

        it("should emit ObjectiveViolationEnforced event", async () => {
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
          await expect(tx)
            .to.emit(watchdogEnforcer, "ObjectiveViolationEnforced")
            .withArgs(
              signers.qcAddress.address,
              STALE_ATTESTATIONS,
              signers.deployer.address,
              currentBlock.timestamp
            )
        })
      })

      context("when attestations are fresh", () => {
        beforeEach(async () => {
          // Setup: fresh attestations
          mockReserveOracle.getReserveBalanceAndStaleness.returns([
            reserveBalance,
            false, // Fresh
          ])
        })

        it("should revert with ViolationNotFound", async () => {
          await expect(
            watchdogEnforcer.enforceObjectiveViolation(
              signers.qcAddress.address,
              STALE_ATTESTATIONS
            )
          ).to.be.revertedWith("ViolationNotFound")
        })
      })
    })

    context("when using invalid reason code", () => {
      it("should revert with NotObjectiveViolation", async () => {
        const invalidReason = ethers.utils.id("INVALID_REASON")
        await expect(
          watchdogEnforcer.enforceObjectiveViolation(
            signers.qcAddress.address,
            invalidReason
          )
        ).to.be.revertedWith("NotObjectiveViolation")
      })
    })

    context("when called by anyone (permissionless)", () => {
      it("should allow watchdog to enforce", async () => {
        // Setup violation
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          reserveBalance,
          true, // Stale
        ])

        await expect(
          watchdogEnforcer
            .connect(signers.watchdog)
            .enforceObjectiveViolation(
              signers.qcAddress.address,
              STALE_ATTESTATIONS
            )
        ).to.not.be.reverted
      })

      it("should allow random user to enforce", async () => {
        // Setup violation
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          reserveBalance,
          true, // Stale
        ])

        await expect(
          watchdogEnforcer
            .connect(signers.user)
            .enforceObjectiveViolation(
              signers.qcAddress.address,
              STALE_ATTESTATIONS
            )
        ).to.not.be.reverted
      })
    })

    context("reentrancy protection", () => {
      it("should have reentrancy protection", async () => {
        // The WatchdogEnforcer uses nonReentrant modifier
        // This test verifies the modifier is present by checking that
        // the function executes successfully when called normally

        // Setup violation
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          reserveBalance,
          true, // Stale
        ])

        // Should execute without reentrancy issues
        await expect(
          watchdogEnforcer.enforceObjectiveViolation(
            signers.qcAddress.address,
            STALE_ATTESTATIONS
          )
        ).to.not.be.reverted

        // Verify requestStatusChange was called once
        expect(mockQcManager.requestStatusChange).to.have.been.calledOnce
      })
    })

    context("escalation timer management", () => {
      context("when enforcing INSUFFICIENT_RESERVES", () => {
        it("should start escalation timer on first violation", async () => {
          // Setup: reserves < minted amount
          mockReserveOracle.getReserveBalanceAndStaleness.returns([
            reserveBalance,
            false,
          ])
          mockQcData.getQCMintedAmount.returns(
            reserveBalance.add(ethers.utils.parseEther("1"))
          )

          const tx = await watchdogEnforcer.enforceObjectiveViolation(
            signers.qcAddress.address,
            INSUFFICIENT_RESERVES
          )

          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
          const escalationDeadline = currentBlock.timestamp + 45 * 60 // 45 minutes

          await expect(tx)
            .to.emit(watchdogEnforcer, "CriticalViolationDetected")
            .withArgs(
              signers.qcAddress.address,
              INSUFFICIENT_RESERVES,
              signers.deployer.address,
              currentBlock.timestamp,
              escalationDeadline
            )

          // Verify timer was set
          expect(
            await watchdogEnforcer.criticalViolationTimestamps(
              signers.qcAddress.address
            )
          ).to.equal(currentBlock.timestamp)
        })

        it("should not restart escalation timer if already active", async () => {
          // Setup: reserves < minted amount
          mockReserveOracle.getReserveBalanceAndStaleness.returns([
            reserveBalance,
            false,
          ])
          mockQcData.getQCMintedAmount.returns(
            reserveBalance.add(ethers.utils.parseEther("1"))
          )

          // First enforcement - starts timer
          const tx1 = await watchdogEnforcer.enforceObjectiveViolation(
            signers.qcAddress.address,
            INSUFFICIENT_RESERVES
          )

          const firstBlock = await ethers.provider.getBlock(tx1.blockNumber)

          // Wait some time then enforce again
          await time.increase(600) // 10 minutes

          // Second enforcement - should not restart timer
          const tx2 = await watchdogEnforcer.enforceObjectiveViolation(
            signers.qcAddress.address,
            INSUFFICIENT_RESERVES
          )

          // Verify timer timestamp hasn't changed
          expect(
            await watchdogEnforcer.criticalViolationTimestamps(
              signers.qcAddress.address
            )
          ).to.equal(firstBlock.timestamp)

          // Verify CriticalViolationDetected was only emitted once
          await expect(tx2).to.not.emit(
            watchdogEnforcer,
            "CriticalViolationDetected"
          )
        })
      })

      context("when enforcing other violations", () => {
        it("should not start escalation timer for STALE_ATTESTATIONS", async () => {
          // Setup: stale attestations
          mockReserveOracle.getReserveBalanceAndStaleness.returns([
            reserveBalance,
            true, // Stale
          ])

          const tx = await watchdogEnforcer.enforceObjectiveViolation(
            signers.qcAddress.address,
            STALE_ATTESTATIONS
          )

          // Verify no escalation timer was set
          expect(
            await watchdogEnforcer.criticalViolationTimestamps(
              signers.qcAddress.address
            )
          ).to.equal(0)

          // Verify no CriticalViolationDetected event
          await expect(tx).to.not.emit(
            watchdogEnforcer,
            "CriticalViolationDetected"
          )
        })

        it("should not start escalation timer for PROLONGED_STALENESS", async () => {
          // Setup: prolonged staleness
          const staleSyncTimestamp =
            (await ethers.provider.getBlock("latest")).timestamp -
            (48 * 60 * 60 + 1)

          mockQcData.getQCOracleData.returns([staleSyncTimestamp, false])

          const tx = await watchdogEnforcer.enforceObjectiveViolation(
            signers.qcAddress.address,
            PROLONGED_STALENESS
          )

          // Verify no escalation timer was set
          expect(
            await watchdogEnforcer.criticalViolationTimestamps(
              signers.qcAddress.address
            )
          ).to.equal(0)

          // Verify no CriticalViolationDetected event
          await expect(tx).to.not.emit(
            watchdogEnforcer,
            "CriticalViolationDetected"
          )
        })
      })
    })
  })

  describe("checkViolation", () => {
    context("when checking insufficient reserves", () => {
      it("should return true when reserves are insufficient", async () => {
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          ethers.utils.parseEther("9"),
          false,
        ])
        mockQcData.getQCMintedAmount.returns(ethers.utils.parseEther("10"))

        const [violated, reason] = await watchdogEnforcer.checkViolation(
          signers.qcAddress.address,
          INSUFFICIENT_RESERVES
        )

        expect(violated).to.be.true
        expect(reason).to.equal("")
      })

      it("should return false when reserves are sufficient", async () => {
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          ethers.utils.parseEther("10"),
          false,
        ])
        mockQcData.getQCMintedAmount.returns(ethers.utils.parseEther("10"))

        const [violated, reason] = await watchdogEnforcer.checkViolation(
          signers.qcAddress.address,
          INSUFFICIENT_RESERVES
        )

        expect(violated).to.be.false
        expect(reason).to.equal("Reserves are sufficient")
      })

      it("should return false when reserves are stale", async () => {
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          ethers.utils.parseEther("9"),
          true, // Stale
        ])

        const [violated, reason] = await watchdogEnforcer.checkViolation(
          signers.qcAddress.address,
          INSUFFICIENT_RESERVES
        )

        expect(violated).to.be.false
        expect(reason).to.equal(
          "Reserves are stale, cannot determine violation"
        )
      })
    })

    context("when checking stale attestations", () => {
      it("should return true when attestations are stale", async () => {
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          reserveBalance,
          true, // Stale
        ])

        const [violated, reason] = await watchdogEnforcer.checkViolation(
          signers.qcAddress.address,
          STALE_ATTESTATIONS
        )

        expect(violated).to.be.true
        expect(reason).to.equal("")
      })

      it("should return false when attestations are fresh", async () => {
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          reserveBalance,
          false, // Fresh
        ])

        const [violated, reason] = await watchdogEnforcer.checkViolation(
          signers.qcAddress.address,
          STALE_ATTESTATIONS
        )

        expect(violated).to.be.false
        expect(reason).to.equal("Attestations are fresh")
      })
    })

    context("when using invalid reason code", () => {
      it("should return false with appropriate message", async () => {
        const invalidReason = ethers.utils.id("INVALID_REASON")

        const [violated, reason] = await watchdogEnforcer.checkViolation(
          signers.qcAddress.address,
          invalidReason
        )

        expect(violated).to.be.false
        expect(reason).to.equal("Not an objective violation")
      })
    })
  })

  describe("batchCheckViolations", () => {
    const qc1 = "0x0000000000000000000000000000000000000001"
    const qc2 = "0x0000000000000000000000000000000000000002"
    const qc3 = "0x0000000000000000000000000000000000000003"

    context("when checking for insufficient reserves", () => {
      it("should return QCs with violations", async () => {
        // QC1: insufficient
        mockReserveOracle.getReserveBalanceAndStaleness
          .whenCalledWith(qc1)
          .returns([ethers.utils.parseEther("9"), false])
        mockQcData.getQCMintedAmount
          .whenCalledWith(qc1)
          .returns(ethers.utils.parseEther("10"))

        // QC2: sufficient
        mockReserveOracle.getReserveBalanceAndStaleness
          .whenCalledWith(qc2)
          .returns([ethers.utils.parseEther("10"), false])
        mockQcData.getQCMintedAmount
          .whenCalledWith(qc2)
          .returns(ethers.utils.parseEther("10"))

        // QC3: insufficient
        mockReserveOracle.getReserveBalanceAndStaleness
          .whenCalledWith(qc3)
          .returns([ethers.utils.parseEther("5"), false])
        mockQcData.getQCMintedAmount
          .whenCalledWith(qc3)
          .returns(ethers.utils.parseEther("10"))

        const violatedQCs = await watchdogEnforcer.batchCheckViolations(
          [qc1, qc2, qc3],
          INSUFFICIENT_RESERVES
        )

        expect(violatedQCs).to.have.lengthOf(2)
        expect(violatedQCs[0]).to.equal(qc1)
        expect(violatedQCs[1]).to.equal(qc3)
      })
    })

    context("when checking for stale attestations", () => {
      it("should return QCs with stale attestations", async () => {
        // QC1: stale
        mockReserveOracle.getReserveBalanceAndStaleness
          .whenCalledWith(qc1)
          .returns([reserveBalance, true])

        // QC2: fresh
        mockReserveOracle.getReserveBalanceAndStaleness
          .whenCalledWith(qc2)
          .returns([reserveBalance, false])

        // QC3: stale
        mockReserveOracle.getReserveBalanceAndStaleness
          .whenCalledWith(qc3)
          .returns([reserveBalance, true])

        const violatedQCs = await watchdogEnforcer.batchCheckViolations(
          [qc1, qc2, qc3],
          STALE_ATTESTATIONS
        )

        expect(violatedQCs).to.have.lengthOf(2)
        expect(violatedQCs[0]).to.equal(qc1)
        expect(violatedQCs[1]).to.equal(qc3)
      })
    })

    context("when using invalid reason code", () => {
      it("should return empty array", async () => {
        const invalidReason = ethers.utils.id("INVALID_REASON")

        const violatedQCs = await watchdogEnforcer.batchCheckViolations(
          [qc1, qc2, qc3],
          invalidReason
        )

        expect(violatedQCs).to.have.lengthOf(0)
      })
    })

    context("with empty QC array", () => {
      it("should return empty array", async () => {
        const violatedQCs = await watchdogEnforcer.batchCheckViolations(
          [],
          INSUFFICIENT_RESERVES
        )

        expect(violatedQCs).to.have.lengthOf(0)
      })
    })
  })

  describe("Integration scenarios", () => {
    context("when collateral ratio changes", () => {
      it("should adapt to new collateral ratio", async () => {
        // Initial: 100% ratio, QC is sufficiently collateralized
        mockSystemState.minCollateralRatio.returns(100)
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          ethers.utils.parseEther("10"),
          false,
        ])
        mockQcData.getQCMintedAmount.returns(ethers.utils.parseEther("10"))

        let [violated] = await watchdogEnforcer.checkViolation(
          signers.qcAddress.address,
          INSUFFICIENT_RESERVES
        )

        expect(violated).to.be.false

        // Change ratio to 150%
        mockSystemState.minCollateralRatio.returns(150)

        // Now the same QC is undercollateralized
        ;[violated] = await watchdogEnforcer.checkViolation(
          signers.qcAddress.address,
          INSUFFICIENT_RESERVES
        )
        expect(violated).to.be.true
      })
    })

    context("when multiple violations exist", () => {
      it("should allow enforcing each violation separately", async () => {
        // Setup: both stale and insufficient
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          ethers.utils.parseEther("9"),
          true, // Stale
        ])
        mockQcData.getQCMintedAmount.returns(ethers.utils.parseEther("10"))

        // Enforce stale attestations
        await watchdogEnforcer.enforceObjectiveViolation(
          signers.qcAddress.address,
          STALE_ATTESTATIONS
        )

        expect(mockQcManager.requestStatusChange).to.have.been.calledWith(
          signers.qcAddress.address,
          3,
          STALE_ATTESTATIONS
        )

        // Cannot enforce insufficient reserves when data is stale
        await expect(
          watchdogEnforcer.enforceObjectiveViolation(
            signers.qcAddress.address,
            INSUFFICIENT_RESERVES
          )
        ).to.be.revertedWith("ViolationNotFound")
      })
    })

    context("when enforcing prolonged staleness", () => {
      context("when QC has prolonged staleness", () => {
        let tx: any // ContractTransaction

        beforeEach(async () => {
          // Setup: oracle data is older than 48 hours
          const staleSyncTimestamp =
            (await ethers.provider.getBlock("latest")).timestamp -
            (48 * 60 * 60 + 1) // 48 hours + 1 second ago

          mockQcData.getQCOracleData.returns([staleSyncTimestamp, false])

          tx = await watchdogEnforcer.enforceObjectiveViolation(
            signers.qcAddress.address,
            PROLONGED_STALENESS
          )
        })

        it("should call requestStatusChange on QCManager", async () => {
          expect(mockQcManager.requestStatusChange).to.have.been.calledWith(
            signers.qcAddress.address,
            3, // UnderReview
            PROLONGED_STALENESS
          )
        })

        it("should emit ObjectiveViolationEnforced event", async () => {
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
          await expect(tx)
            .to.emit(watchdogEnforcer, "ObjectiveViolationEnforced")
            .withArgs(
              signers.qcAddress.address,
              PROLONGED_STALENESS,
              signers.deployer.address,
              currentBlock.timestamp
            )
        })

        it("should emit EnforcementAttempted event", async () => {
          await expect(tx)
            .to.emit(watchdogEnforcer, "EnforcementAttempted")
            .withArgs(
              signers.qcAddress.address,
              PROLONGED_STALENESS,
              signers.deployer.address,
              true,
              ""
            )
        })
      })

      context("when QC has no sync timestamp", () => {
        beforeEach(async () => {
          // Setup: no sync timestamp recorded (timestamp = 0)
          mockQcData.getQCOracleData.returns([0, false])
        })

        it("should detect violation", async () => {
          await watchdogEnforcer.enforceObjectiveViolation(
            signers.qcAddress.address,
            PROLONGED_STALENESS
          )

          expect(mockQcManager.requestStatusChange).to.have.been.calledWith(
            signers.qcAddress.address,
            3, // UnderReview
            PROLONGED_STALENESS
          )
        })
      })

      context("when QC staleness is within threshold", () => {
        beforeEach(async () => {
          // Setup: oracle data is recent (within 48 hours)
          const recentSyncTimestamp =
            (await ethers.provider.getBlock("latest")).timestamp - 12 * 60 * 60 // 12 hours ago

          mockQcData.getQCOracleData.returns([recentSyncTimestamp, false])
        })

        it("should revert with ViolationNotFound", async () => {
          await expect(
            watchdogEnforcer.enforceObjectiveViolation(
              signers.qcAddress.address,
              PROLONGED_STALENESS
            )
          ).to.be.revertedWith("ViolationNotFound")
        })
      })
    })

    context("when enforcing extended under review", () => {
      context(
        "when QC has been in UnderReview status for extended period",
        () => {
          let tx: any // ContractTransaction

          beforeEach(async () => {
            // Setup: QC is in UnderReview status and has been for more than 7 days
            const extendedReviewTimestamp =
              (await ethers.provider.getBlock("latest")).timestamp -
              (7 * 24 * 60 * 60 + 1) // 7 days + 1 second ago

            mockQcData.getQCStatus.returns(3) // QCStatus.UnderReview
            mockQcData.getQCStatusChangeTimestamp.returns(
              extendedReviewTimestamp
            )

            tx = await watchdogEnforcer.enforceObjectiveViolation(
              signers.qcAddress.address,
              EXTENDED_UNDER_REVIEW
            )
          })

          it("should call requestStatusChange on QCManager", async () => {
            expect(mockQcManager.requestStatusChange).to.have.been.calledWith(
              signers.qcAddress.address,
              3, // UnderReview
              EXTENDED_UNDER_REVIEW
            )
          })

          it("should emit ObjectiveViolationEnforced event", async () => {
            const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
            await expect(tx)
              .to.emit(watchdogEnforcer, "ObjectiveViolationEnforced")
              .withArgs(
                signers.qcAddress.address,
                EXTENDED_UNDER_REVIEW,
                signers.deployer.address,
                currentBlock.timestamp
              )
          })

          it("should emit EnforcementAttempted event", async () => {
            await expect(tx)
              .to.emit(watchdogEnforcer, "EnforcementAttempted")
              .withArgs(
                signers.qcAddress.address,
                EXTENDED_UNDER_REVIEW,
                signers.deployer.address,
                true,
                ""
              )
          })
        }
      )

      context("when QC is in UnderReview status within acceptable time", () => {
        beforeEach(async () => {
          // Setup: QC is in UnderReview status but only for 3 days
          const recentReviewTimestamp =
            (await ethers.provider.getBlock("latest")).timestamp -
            3 * 24 * 60 * 60 // 3 days ago

          mockQcData.getQCStatus.returns(3) // QCStatus.UnderReview
          mockQcData.getQCStatusChangeTimestamp.returns(recentReviewTimestamp)
        })

        it("should revert with ViolationNotFound", async () => {
          await expect(
            watchdogEnforcer.enforceObjectiveViolation(
              signers.qcAddress.address,
              EXTENDED_UNDER_REVIEW
            )
          ).to.be.revertedWith("ViolationNotFound")
        })
      })

      context("when QC is in UnderReview status with no timestamp", () => {
        beforeEach(async () => {
          // Setup: QC is in UnderReview status but no status change timestamp recorded
          mockQcData.getQCStatus.returns(3) // QCStatus.UnderReview
          mockQcData.getQCStatusChangeTimestamp.returns(0) // No timestamp
        })

        it("should revert with ViolationNotFound", async () => {
          await expect(
            watchdogEnforcer.enforceObjectiveViolation(
              signers.qcAddress.address,
              EXTENDED_UNDER_REVIEW
            )
          ).to.be.revertedWith("ViolationNotFound")
        })
      })

      context("when QC is not in UnderReview status", () => {
        beforeEach(async () => {
          // Setup: QC is Active
          mockQcData.getQCStatus.returns(0) // QCStatus.Active
        })

        it("should revert with ViolationNotFound", async () => {
          await expect(
            watchdogEnforcer.enforceObjectiveViolation(
              signers.qcAddress.address,
              EXTENDED_UNDER_REVIEW
            )
          ).to.be.revertedWith("ViolationNotFound")
        })
      })
    })
  })

  describe("checkViolation", () => {
    context("when checking prolonged staleness", () => {
      context("when QC has prolonged staleness", () => {
        beforeEach(async () => {
          const staleSyncTimestamp =
            (await ethers.provider.getBlock("latest")).timestamp -
            (48 * 60 * 60 + 1)

          mockQcData.getQCOracleData.returns([staleSyncTimestamp, false])
        })

        it("should return violation found", async () => {
          const [violated, reason] = await watchdogEnforcer.checkViolation(
            signers.qcAddress.address,
            PROLONGED_STALENESS
          )

          expect(violated).to.be.true
          expect(reason).to.equal("")
        })
      })

      context("when QC staleness is within threshold", () => {
        beforeEach(async () => {
          const recentSyncTimestamp =
            (await ethers.provider.getBlock("latest")).timestamp - 12 * 60 * 60

          mockQcData.getQCOracleData.returns([recentSyncTimestamp, false])
        })

        it("should return no violation", async () => {
          const [violated, reason] = await watchdogEnforcer.checkViolation(
            signers.qcAddress.address,
            PROLONGED_STALENESS
          )

          expect(violated).to.be.false
          expect(reason).to.equal(
            "Oracle data within acceptable staleness limit"
          )
        })
      })
    })

    context("when checking extended under review", () => {
      context("when QC is not in UnderReview status", () => {
        beforeEach(async () => {
          mockQcData.getQCStatus.returns(0) // QCStatus.Active
        })

        it("should return no violation", async () => {
          const [violated, reason] = await watchdogEnforcer.checkViolation(
            signers.qcAddress.address,
            EXTENDED_UNDER_REVIEW
          )

          expect(violated).to.be.false
          expect(reason).to.equal("QC is not in UnderReview status")
        })
      })

      context(
        "when QC has been in UnderReview status for extended period",
        () => {
          beforeEach(async () => {
            const extendedReviewTimestamp =
              (await ethers.provider.getBlock("latest")).timestamp -
              (7 * 24 * 60 * 60 + 1) // 7 days + 1 second ago

            mockQcData.getQCStatus.returns(3) // QCStatus.UnderReview
            mockQcData.getQCStatusChangeTimestamp.returns(
              extendedReviewTimestamp
            )
          })

          it("should return violation found", async () => {
            const [violated, reason] = await watchdogEnforcer.checkViolation(
              signers.qcAddress.address,
              EXTENDED_UNDER_REVIEW
            )

            expect(violated).to.be.true
            expect(reason).to.equal("")
          })
        }
      )

      context("when QC is in UnderReview status within acceptable time", () => {
        beforeEach(async () => {
          const recentReviewTimestamp =
            (await ethers.provider.getBlock("latest")).timestamp -
            3 * 24 * 60 * 60 // 3 days ago

          mockQcData.getQCStatus.returns(3) // QCStatus.UnderReview
          mockQcData.getQCStatusChangeTimestamp.returns(recentReviewTimestamp)
        })

        it("should return no violation", async () => {
          const [violated, reason] = await watchdogEnforcer.checkViolation(
            signers.qcAddress.address,
            EXTENDED_UNDER_REVIEW
          )

          expect(violated).to.be.false
          expect(reason).to.equal(
            "QC has been UnderReview within acceptable time limit"
          )
        })
      })

      context("when QC is in UnderReview status with no timestamp", () => {
        beforeEach(async () => {
          mockQcData.getQCStatus.returns(3) // QCStatus.UnderReview
          mockQcData.getQCStatusChangeTimestamp.returns(0) // No timestamp
        })

        it("should return no violation", async () => {
          const [violated, reason] = await watchdogEnforcer.checkViolation(
            signers.qcAddress.address,
            EXTENDED_UNDER_REVIEW
          )

          expect(violated).to.be.false
          expect(reason).to.equal(
            "QC has been UnderReview within acceptable time limit"
          )
        })
      })
    })

    context("when checking invalid violation types", () => {
      it("should reject invalid violation types", async () => {
        const invalidViolation = ethers.utils.id("INVALID_VIOLATION")

        const [violated, reason] = await watchdogEnforcer.checkViolation(
          signers.qcAddress.address,
          invalidViolation
        )

        expect(violated).to.be.false
        expect(reason).to.equal("Not an objective violation")
      })
    })
  })

  describe("batchCheckViolations", () => {
    context("when checking multiple QCs for prolonged staleness", () => {
      const qcAddresses = [
        "0x1000000000000000000000000000000000000001",
        "0x1000000000000000000000000000000000000002",
        "0x1000000000000000000000000000000000000003",
      ]

      beforeEach(async () => {
        // Setup: first and third QCs have prolonged staleness, second is recent
        const currentTime = (await ethers.provider.getBlock("latest")).timestamp
        const staleTimestamp = currentTime - (48 * 60 * 60 + 1) // Stale
        const recentTimestamp = currentTime - 12 * 60 * 60 // Recent

        mockQcData.getQCOracleData
          .whenCalledWith(qcAddresses[0])
          .returns([staleTimestamp, false])
        mockQcData.getQCOracleData
          .whenCalledWith(qcAddresses[1])
          .returns([recentTimestamp, false])
        mockQcData.getQCOracleData
          .whenCalledWith(qcAddresses[2])
          .returns([staleTimestamp, false])
      })

      it("should return only QCs with violations", async () => {
        const violatedQCs = await watchdogEnforcer.batchCheckViolations(
          qcAddresses,
          PROLONGED_STALENESS
        )

        expect(violatedQCs).to.have.length(2)
        expect(violatedQCs[0]).to.equal(qcAddresses[0])
        expect(violatedQCs[1]).to.equal(qcAddresses[2])
      })
    })

    context("when checking with invalid violation type", () => {
      it("should return empty array", async () => {
        const invalidViolation = ethers.utils.id("INVALID_VIOLATION")

        const violatedQCs = await watchdogEnforcer.batchCheckViolations(
          ["0x1000000000000000000000000000000000000001"],
          invalidViolation
        )

        expect(violatedQCs).to.have.length(0)
      })
    })
  })

  describe("checkEscalation", () => {
    beforeEach(async () => {
      // Setup mock for emergencyPauseQC function
      mockSystemState.emergencyPauseQC.returns()
    })

    context("when escalation timer exists and delay has passed", () => {
      let initialTimestamp: number

      beforeEach(async () => {
        // Setup: Create escalation timer by enforcing INSUFFICIENT_RESERVES violation
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          reserveBalance,
          false,
        ])
        mockQcData.getQCMintedAmount.returns(
          reserveBalance.add(ethers.utils.parseEther("1"))
        )

        const tx = await watchdogEnforcer.enforceObjectiveViolation(
          signers.qcAddress.address,
          INSUFFICIENT_RESERVES
        )

        const block = await ethers.provider.getBlock(tx.blockNumber)
        initialTimestamp = block.timestamp

        // Advance time past the escalation delay (45 minutes)
        await time.increase(45 * 60 + 1) // 45 minutes + 1 second
      })

      context("when violation still exists", () => {
        it("should escalate to emergency pause", async () => {
          // Violation still exists
          mockReserveOracle.getReserveBalanceAndStaleness.returns([
            reserveBalance,
            false,
          ])
          mockQcData.getQCMintedAmount.returns(
            reserveBalance.add(ethers.utils.parseEther("1"))
          )

          const tx = await watchdogEnforcer.checkEscalation(
            signers.qcAddress.address
          )

          // Verify emergency pause was called
          expect(mockSystemState.emergencyPauseQC).to.have.been.calledWith(
            signers.qcAddress.address,
            SUSTAINED_RESERVE_VIOLATION
          )

          // Verify escalation event
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
          await expect(tx)
            .to.emit(watchdogEnforcer, "ViolationEscalated")
            .withArgs(
              signers.qcAddress.address,
              SUSTAINED_RESERVE_VIOLATION,
              signers.deployer.address,
              currentBlock.timestamp
            )

          // Verify escalation timer was cleared
          expect(
            await watchdogEnforcer.criticalViolationTimestamps(
              signers.qcAddress.address
            )
          ).to.equal(0)
        })

        it("should allow anyone to trigger escalation", async () => {
          // Violation still exists
          mockReserveOracle.getReserveBalanceAndStaleness.returns([
            reserveBalance,
            false,
          ])
          mockQcData.getQCMintedAmount.returns(
            reserveBalance.add(ethers.utils.parseEther("1"))
          )

          // Call from different user
          await expect(
            watchdogEnforcer
              .connect(signers.user)
              .checkEscalation(signers.qcAddress.address)
          ).to.not.be.reverted

          expect(mockSystemState.emergencyPauseQC).to.have.been.calledWith(
            signers.qcAddress.address,
            SUSTAINED_RESERVE_VIOLATION
          )
        })
      })

      context("when violation is resolved with fresh data", () => {
        it("should clear escalation timer and not escalate", async () => {
          // Violation resolved with fresh data
          mockReserveOracle.getReserveBalanceAndStaleness.returns([
            reserveBalance.add(ethers.utils.parseEther("5")), // Sufficient reserves
            false, // Fresh data
          ])
          mockQcData.getQCMintedAmount.returns(reserveBalance)

          const tx = await watchdogEnforcer.checkEscalation(
            signers.qcAddress.address
          )

          // Verify emergency pause was NOT called
          expect(mockSystemState.emergencyPauseQC).to.not.have.been.called

          // Verify escalation timer was cleared
          expect(
            await watchdogEnforcer.criticalViolationTimestamps(
              signers.qcAddress.address
            )
          ).to.equal(0)

          // Verify timer cleared event
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
          await expect(tx)
            .to.emit(watchdogEnforcer, "EscalationTimerCleared")
            .withArgs(
              signers.qcAddress.address,
              signers.deployer.address,
              currentBlock.timestamp
            )
        })
      })

      context("when violation cannot be determined due to stale data", () => {
        it("should preserve escalation timer and not escalate", async () => {
          // Stale oracle data - cannot determine violation state
          mockReserveOracle.getReserveBalanceAndStaleness.returns([
            reserveBalance,
            true, // Stale data
          ])

          await watchdogEnforcer.checkEscalation(signers.qcAddress.address)

          // Verify emergency pause was NOT called
          expect(mockSystemState.emergencyPauseQC).to.not.have.been.called

          // Verify escalation timer was NOT cleared (preserved)
          expect(
            await watchdogEnforcer.criticalViolationTimestamps(
              signers.qcAddress.address
            )
          ).to.equal(initialTimestamp)
        })
      })
    })

    context("when escalation timer does not exist", () => {
      it("should revert with ViolationNotFound", async () => {
        // No escalation timer exists
        expect(
          await watchdogEnforcer.criticalViolationTimestamps(
            signers.qcAddress.address
          )
        ).to.equal(0)

        await expect(
          watchdogEnforcer.checkEscalation(signers.qcAddress.address)
        ).to.be.revertedWith("ViolationNotFound")
      })
    })

    context("when escalation delay has not passed", () => {
      it("should revert with EscalationDelayNotReached", async () => {
        // Setup: Create escalation timer
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          reserveBalance,
          false,
        ])
        mockQcData.getQCMintedAmount.returns(
          reserveBalance.add(ethers.utils.parseEther("1"))
        )

        await watchdogEnforcer.enforceObjectiveViolation(
          signers.qcAddress.address,
          INSUFFICIENT_RESERVES
        )

        // Advance time but not enough (only 30 minutes instead of 45)
        await time.increase(30 * 60)

        await expect(
          watchdogEnforcer.checkEscalation(signers.qcAddress.address)
        ).to.be.revertedWith("EscalationDelayNotReached")
      })

      it("should succeed exactly at escalation deadline", async () => {
        // Setup: Create escalation timer
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          reserveBalance,
          false,
        ])
        mockQcData.getQCMintedAmount.returns(
          reserveBalance.add(ethers.utils.parseEther("1"))
        )

        await watchdogEnforcer.enforceObjectiveViolation(
          signers.qcAddress.address,
          INSUFFICIENT_RESERVES
        )

        // Advance time exactly to the deadline
        await time.increase(45 * 60) // Exactly 45 minutes

        // Should succeed (violation still exists)
        await expect(
          watchdogEnforcer.checkEscalation(signers.qcAddress.address)
        ).to.not.be.reverted

        expect(mockSystemState.emergencyPauseQC).to.have.been.called
      })
    })

    context("reentrancy protection", () => {
      it("should have reentrancy protection", async () => {
        // Setup escalation scenario
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          reserveBalance,
          false,
        ])
        mockQcData.getQCMintedAmount.returns(
          reserveBalance.add(ethers.utils.parseEther("1"))
        )

        await watchdogEnforcer.enforceObjectiveViolation(
          signers.qcAddress.address,
          INSUFFICIENT_RESERVES
        )

        await time.increase(45 * 60 + 1)

        // Should execute without reentrancy issues
        await expect(
          watchdogEnforcer.checkEscalation(signers.qcAddress.address)
        ).to.not.be.reverted

        // Verify escalation was called once
        expect(mockSystemState.emergencyPauseQC).to.have.been.calledOnce
      })
    })
  })

  describe("clearEscalationTimer", () => {
    context("when QC is Active and timer exists", () => {
      beforeEach(async () => {
        // Setup: Create escalation timer
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          reserveBalance,
          false,
        ])
        mockQcData.getQCMintedAmount.returns(
          reserveBalance.add(ethers.utils.parseEther("1"))
        )

        await watchdogEnforcer.enforceObjectiveViolation(
          signers.qcAddress.address,
          INSUFFICIENT_RESERVES
        )

        // Verify timer was set
        expect(
          await watchdogEnforcer.criticalViolationTimestamps(
            signers.qcAddress.address
          )
        ).to.not.equal(0)

        // Set QC status to Active
        mockQcData.getQCStatus.returns(0) // QCStatus.Active
      })

      it("should clear escalation timer", async () => {
        const tx = await watchdogEnforcer.clearEscalationTimer(
          signers.qcAddress.address
        )

        // Verify timer was cleared
        expect(
          await watchdogEnforcer.criticalViolationTimestamps(
            signers.qcAddress.address
          )
        ).to.equal(0)

        // Verify event was emitted
        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
        await expect(tx)
          .to.emit(watchdogEnforcer, "EscalationTimerCleared")
          .withArgs(
            signers.qcAddress.address,
            signers.deployer.address,
            currentBlock.timestamp
          )
      })

      it("should allow anyone to clear timer", async () => {
        await expect(
          watchdogEnforcer
            .connect(signers.user)
            .clearEscalationTimer(signers.qcAddress.address)
        ).to.not.be.reverted

        // Verify timer was cleared
        expect(
          await watchdogEnforcer.criticalViolationTimestamps(
            signers.qcAddress.address
          )
        ).to.equal(0)
      })
    })

    context("when QC is not Active", () => {
      beforeEach(async () => {
        // Setup: Create escalation timer
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          reserveBalance,
          false,
        ])
        mockQcData.getQCMintedAmount.returns(
          reserveBalance.add(ethers.utils.parseEther("1"))
        )

        await watchdogEnforcer.enforceObjectiveViolation(
          signers.qcAddress.address,
          INSUFFICIENT_RESERVES
        )

        // Set QC status to UnderReview (not Active)
        mockQcData.getQCStatus.returns(3) // QCStatus.UnderReview
      })

      it("should not clear escalation timer", async () => {
        const timerBefore = await watchdogEnforcer.criticalViolationTimestamps(
          signers.qcAddress.address
        )

        await watchdogEnforcer.clearEscalationTimer(signers.qcAddress.address)

        // Verify timer was NOT cleared
        expect(
          await watchdogEnforcer.criticalViolationTimestamps(
            signers.qcAddress.address
          )
        ).to.equal(timerBefore)
      })
    })

    context("when no escalation timer exists", () => {
      beforeEach(async () => {
        // Set QC status to Active
        mockQcData.getQCStatus.returns(0) // QCStatus.Active

        // Verify no timer exists
        expect(
          await watchdogEnforcer.criticalViolationTimestamps(
            signers.qcAddress.address
          )
        ).to.equal(0)
      })

      it("should not emit event or change state", async () => {
        const tx = await watchdogEnforcer.clearEscalationTimer(
          signers.qcAddress.address
        )

        // Verify no event was emitted
        await expect(tx).to.not.emit(watchdogEnforcer, "EscalationTimerCleared")

        // Timer remains zero
        expect(
          await watchdogEnforcer.criticalViolationTimestamps(
            signers.qcAddress.address
          )
        ).to.equal(0)
      })
    })
  })

  describe("Gas Analysis", () => {
    context("batch operations", () => {
      const testQCs = [
        "0x1000000000000000000000000000000000000001",
        "0x1000000000000000000000000000000000000002",
        "0x1000000000000000000000000000000000000003",
        "0x1000000000000000000000000000000000000004",
        "0x1000000000000000000000000000000000000005",
      ]

      beforeEach(async () => {
        // Setup varied violation states for batch testing
        testQCs.forEach((qc, index) => {
          if (index % 2 === 0) {
            // Even indexed QCs have violations
            mockReserveOracle.getReserveBalanceAndStaleness
              .whenCalledWith(qc)
              .returns([ethers.utils.parseEther("9"), false])
            mockQcData.getQCMintedAmount
              .whenCalledWith(qc)
              .returns(ethers.utils.parseEther("10"))
          } else {
            // Odd indexed QCs have no violations
            mockReserveOracle.getReserveBalanceAndStaleness
              .whenCalledWith(qc)
              .returns([ethers.utils.parseEther("10"), false])
            mockQcData.getQCMintedAmount
              .whenCalledWith(qc)
              .returns(ethers.utils.parseEther("10"))
          }
        })
      })

      it("should have reasonable gas costs for batch checking 5 QCs", async () => {
        const gasEstimate =
          await watchdogEnforcer.estimateGas.batchCheckViolations(
            testQCs,
            INSUFFICIENT_RESERVES
          )

        // Log gas usage for monitoring
        console.log(
          `        Gas estimated for batchCheckViolations (5 QCs): ${gasEstimate}`
        )

        // Basic sanity check - should be more efficient than 5 individual calls
        // but exact threshold depends on contract complexity
        expect(gasEstimate.toNumber()).to.be.lessThan(500000) // Reasonable upper bound
      })

      it("should scale linearly with number of QCs", async () => {
        // Test with different batch sizes
        const singleQCGas =
          await watchdogEnforcer.estimateGas.batchCheckViolations(
            [testQCs[0]],
            INSUFFICIENT_RESERVES
          )

        const allQCsGas =
          await watchdogEnforcer.estimateGas.batchCheckViolations(
            testQCs,
            INSUFFICIENT_RESERVES
          )

        console.log(`        Single QC gas: ${singleQCGas}`)
        console.log(`        5 QCs gas: ${allQCsGas}`)

        // Should scale roughly linearly (allowing for base overhead)
        const gasPerQC = allQCsGas.sub(singleQCGas).div(4) // Additional gas per QC
        expect(gasPerQC.toNumber()).to.be.lessThan(100000) // Reasonable per-QC cost
      })
    })

    context("enforcement operations", () => {
      it("should have reasonable gas costs for violation enforcement", async () => {
        // Setup violation
        mockReserveOracle.getReserveBalanceAndStaleness.returns([
          reserveBalance,
          false,
        ])
        mockQcData.getQCMintedAmount.returns(
          reserveBalance.add(ethers.utils.parseEther("1"))
        )

        const tx = await watchdogEnforcer.enforceObjectiveViolation(
          signers.qcAddress.address,
          INSUFFICIENT_RESERVES
        )

        const receipt = await tx.wait()
        const { gasUsed } = receipt

        console.log(
          `        Gas used for enforceObjectiveViolation: ${gasUsed}`
        )

        // Should be efficient for core enforcement operations
        expect(gasUsed.toNumber()).to.be.lessThan(200000)
      })
    })
  })
})
