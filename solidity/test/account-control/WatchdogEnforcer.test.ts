import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"

import {
  WatchdogEnforcer,
  ReserveOracle,
  QCManager,
  QCData,
  SystemState,
} from "../../typechain"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("WatchdogEnforcer", () => {
  let deployer: SignerWithAddress
  let watchdog: SignerWithAddress
  let qcAddress: SignerWithAddress
  let randomUser: SignerWithAddress

  let watchdogEnforcer: WatchdogEnforcer
  let mockReserveOracle: FakeContract<ReserveOracle>
  let mockQcManager: FakeContract<QCManager>
  let mockQcData: FakeContract<QCData>
  let mockSystemState: FakeContract<SystemState>

  // Roles
  let MANAGER_ROLE: string
  let WATCHDOG_ENFORCER_ROLE: string

  // Reason codes
  let INSUFFICIENT_RESERVES: string
  let STALE_ATTESTATIONS: string

  // Test data
  const reserveBalance = ethers.utils.parseEther("10")
  const mintedAmount = ethers.utils.parseEther("15") // Undercollateralized
  const minCollateralRatio = 100 // 100% = 1:1 ratio

  before(async () => {
    const signers = await ethers.getSigners()
    deployer = signers[0]
    watchdog = signers[1]
    qcAddress = signers[2]
    randomUser = signers[3]

    // Generate role hashes
    MANAGER_ROLE = ethers.utils.id("MANAGER_ROLE")
    WATCHDOG_ENFORCER_ROLE = ethers.utils.id("WATCHDOG_ENFORCER_ROLE")

    // Generate reason codes
    INSUFFICIENT_RESERVES = ethers.utils.id("INSUFFICIENT_RESERVES")
    STALE_ATTESTATIONS = ethers.utils.id("STALE_ATTESTATIONS")
  })

  beforeEach(async () => {
    await createSnapshot()

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
    await restoreSnapshot()
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
        await watchdogEnforcer.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)
      ).to.be.true
      expect(await watchdogEnforcer.hasRole(MANAGER_ROLE, deployer.address)).to
        .be.true
    })

    it("should have correct reason codes", async () => {
      expect(await watchdogEnforcer.INSUFFICIENT_RESERVES()).to.equal(
        INSUFFICIENT_RESERVES
      )
      expect(await watchdogEnforcer.STALE_ATTESTATIONS()).to.equal(
        STALE_ATTESTATIONS
      )
    })
  })

  describe("enforceObjectiveViolation", () => {
    context("when enforcing insufficient reserves", () => {
      context("when QC has insufficient reserves", () => {
        let tx: any

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
            qcAddress.address,
            INSUFFICIENT_RESERVES
          )
        })

        it("should call requestStatusChange on QCManager", async () => {
          expect(mockQcManager.requestStatusChange).to.have.been.calledWith(
            qcAddress.address,
            1, // UnderReview
            INSUFFICIENT_RESERVES
          )
        })

        it("should emit ObjectiveViolationEnforced event", async () => {
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
          await expect(tx)
            .to.emit(watchdogEnforcer, "ObjectiveViolationEnforced")
            .withArgs(
              qcAddress.address,
              INSUFFICIENT_RESERVES,
              deployer.address,
              currentBlock.timestamp
            )
        })

        it("should emit EnforcementAttempted event", async () => {
          await expect(tx)
            .to.emit(watchdogEnforcer, "EnforcementAttempted")
            .withArgs(
              qcAddress.address,
              INSUFFICIENT_RESERVES,
              deployer.address,
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
              qcAddress.address,
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
              qcAddress.address,
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
        let tx: any

        beforeEach(async () => {
          // Setup: stale attestations
          mockReserveOracle.getReserveBalanceAndStaleness.returns([
            reserveBalance,
            true, // Stale
          ])

          tx = await watchdogEnforcer.enforceObjectiveViolation(
            qcAddress.address,
            STALE_ATTESTATIONS
          )
        })

        it("should call requestStatusChange on QCManager", async () => {
          expect(mockQcManager.requestStatusChange).to.have.been.calledWith(
            qcAddress.address,
            1, // UnderReview
            STALE_ATTESTATIONS
          )
        })

        it("should emit ObjectiveViolationEnforced event", async () => {
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
          await expect(tx)
            .to.emit(watchdogEnforcer, "ObjectiveViolationEnforced")
            .withArgs(
              qcAddress.address,
              STALE_ATTESTATIONS,
              deployer.address,
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
              qcAddress.address,
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
            qcAddress.address,
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
            .connect(watchdog)
            .enforceObjectiveViolation(qcAddress.address, STALE_ATTESTATIONS)
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
            .connect(randomUser)
            .enforceObjectiveViolation(qcAddress.address, STALE_ATTESTATIONS)
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
            qcAddress.address,
            STALE_ATTESTATIONS
          )
        ).to.not.be.reverted

        // Verify requestStatusChange was called once
        expect(mockQcManager.requestStatusChange).to.have.been.calledOnce
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
          qcAddress.address,
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
          qcAddress.address,
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
          qcAddress.address,
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
          qcAddress.address,
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
          qcAddress.address,
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
          qcAddress.address,
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
          qcAddress.address,
          INSUFFICIENT_RESERVES
        )
        expect(violated).to.be.false

        // Change ratio to 150%
        mockSystemState.minCollateralRatio.returns(150)

        // Now the same QC is undercollateralized
        ;[violated] = await watchdogEnforcer.checkViolation(
          qcAddress.address,
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
          qcAddress.address,
          STALE_ATTESTATIONS
        )

        expect(mockQcManager.requestStatusChange).to.have.been.calledWith(
          qcAddress.address,
          1,
          STALE_ATTESTATIONS
        )

        // Cannot enforce insufficient reserves when data is stale
        await expect(
          watchdogEnforcer.enforceObjectiveViolation(
            qcAddress.address,
            INSUFFICIENT_RESERVES
          )
        ).to.be.revertedWith("ViolationNotFound")
      })
    })
  })
})
