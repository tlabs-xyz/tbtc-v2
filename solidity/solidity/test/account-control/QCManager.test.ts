import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  QCManager,
  QCData,
  SystemState,
  ReserveOracle,
  IQCRedeemer,
} from "../../typechain"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCManager", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qcAddress: SignerWithAddress
  let arbiter: SignerWithAddress
  let watchdog: SignerWithAddress
  let registrar: SignerWithAddress
  let user: SignerWithAddress

  let qcManager: QCManager
  let mockQCData: FakeContract<QCData>
  let mockSystemState: FakeContract<SystemState>
  let mockReserveOracle: FakeContract<ReserveOracle>
  let mockQCRedeemer: FakeContract<IQCRedeemer>

  // Role constants
  let DEFAULT_ADMIN_ROLE: string
  let QC_ADMIN_ROLE: string
  let REGISTRAR_ROLE: string
  let ARBITER_ROLE: string
  let WATCHDOG_ENFORCER_ROLE: string
  let WATCHDOG_ROLE: string
  let PAUSER_ROLE: string
  let QC_GOVERNANCE_ROLE: string

  // Test constants
  const initialMintingCapacity = ethers.utils.parseEther("100")
  const validBtcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"

  before(async () => {
    const signers = await ethers.getSigners()
    deployer = signers[0]
    governance = signers[1]
    qcAddress = signers[2]
    arbiter = signers[3]
    watchdog = signers[4]
    registrar = signers[5]
    user = signers[6]

    // Generate role hashes
    DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
    QC_ADMIN_ROLE = ethers.utils.id("QC_ADMIN_ROLE")
    REGISTRAR_ROLE = ethers.utils.id("REGISTRAR_ROLE")
    ARBITER_ROLE = ethers.utils.id("ARBITER_ROLE")
    WATCHDOG_ENFORCER_ROLE = ethers.utils.id("WATCHDOG_ENFORCER_ROLE")
    WATCHDOG_ROLE = ethers.utils.id("WATCHDOG_ROLE")
    PAUSER_ROLE = ethers.utils.id("PAUSER_ROLE")
    QC_GOVERNANCE_ROLE = ethers.utils.id("QC_GOVERNANCE_ROLE")
  })

  beforeEach(async () => {
    await createSnapshot()

    // Create mock contracts
    mockQCData = await smock.fake<QCData>("QCData")
    mockSystemState = await smock.fake<SystemState>("SystemState")
    mockReserveOracle = await smock.fake<ReserveOracle>("ReserveOracle")
    mockQCRedeemer = await smock.fake<IQCRedeemer>("IQCRedeemer")

    // Deploy QCManager with direct integration
    const QCManagerFactory = await ethers.getContractFactory("QCManager")
    qcManager = await QCManagerFactory.deploy(
      mockQCData.address,
      mockSystemState.address,
      mockReserveOracle.address
    )
    await qcManager.deployed()

    // Setup default mock behaviors
    mockSystemState.isFunctionPaused.returns(false) // Functions not paused
    mockSystemState.isMintingPaused.returns(false)
    mockSystemState.isQCEmergencyPaused.returns(false)

    mockQCData.isQCRegistered.returns(false) // QC not registered by default
    mockQCData.getQCStatus.returns(0) // NeverRegistered status
    mockQCData.getMaxMintingCapacity.returns(0)
    mockQCData.getQCMintedAmount.returns(0)
    mockQCData.registerQC.returns()
    mockQCData.updateMaxMintingCapacity.returns()
    mockQCData.setQCStatus.returns()
    mockQCData.registerWallet.returns()
    mockQCData.setQCSelfPaused.returns()

    mockReserveOracle.getReserveBalanceAndStaleness.returns([0, false])
    mockQCRedeemer.hasUnfulfilledRedemptions.returns(false)
    mockQCRedeemer.getEarliestRedemptionDeadline.returns(0)

    // Grant roles for testing
    await qcManager.grantRole(QC_GOVERNANCE_ROLE, governance.address)
    await qcManager.grantRole(ARBITER_ROLE, arbiter.address)
    await qcManager.grantRole(WATCHDOG_ENFORCER_ROLE, watchdog.address)
    await qcManager.grantRole(REGISTRAR_ROLE, registrar.address)
    await qcManager.grantRole(WATCHDOG_ROLE, watchdog.address)

    // Set QCRedeemer reference for integrated functionality
    await qcManager.setQCRedeemer(mockQCRedeemer.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment", () => {
    it("should set correct dependencies", async () => {
      expect(qcManager.address).to.not.equal(ethers.constants.AddressZero)
    })

    it("should grant deployer admin role", async () => {
      expect(await qcManager.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to
        .be.true
    })

    it("should have correct role constants", async () => {
      expect(await qcManager.QC_ADMIN_ROLE()).to.equal(QC_ADMIN_ROLE)
      expect(await qcManager.REGISTRAR_ROLE()).to.equal(REGISTRAR_ROLE)
      expect(await qcManager.ARBITER_ROLE()).to.equal(ARBITER_ROLE)
      expect(await qcManager.WATCHDOG_ENFORCER_ROLE()).to.equal(
        WATCHDOG_ENFORCER_ROLE
      )
      expect(await qcManager.WATCHDOG_ROLE()).to.equal(WATCHDOG_ROLE)
      expect(await qcManager.PAUSER_ROLE()).to.equal(PAUSER_ROLE)
    })
  })

  describe("QC Registration", () => {
    context("when called by governance", () => {
      it("should register QC successfully", async () => {
        mockQCData.isQCRegistered
          .whenCalledWith(qcAddress.address)
          .returns(false)

        const tx = await qcManager
          .connect(governance)
          .registerQC(qcAddress.address, initialMintingCapacity)

        expect(mockQCData.registerQC).to.have.been.calledWith(
          qcAddress.address,
          initialMintingCapacity
        )

        await expect(tx)
          .to.emit(qcManager, "QCRegistrationInitiated")
          .withArgs(qcAddress.address, governance.address, expect.any(Number))

        await expect(tx)
          .to.emit(qcManager, "QCOnboarded")
          .withArgs(
            qcAddress.address,
            initialMintingCapacity,
            governance.address,
            expect.any(Number)
          )
      })

      it("should revert if QC already registered", async () => {
        mockQCData.isQCRegistered
          .whenCalledWith(qcAddress.address)
          .returns(true)

        await expect(
          qcManager
            .connect(governance)
            .registerQC(qcAddress.address, initialMintingCapacity)
        ).to.be.revertedWith("QCAlreadyRegistered")
      })

      it("should revert with zero address", async () => {
        await expect(
          qcManager
            .connect(governance)
            .registerQC(ethers.constants.AddressZero, initialMintingCapacity)
        ).to.be.revertedWith("InvalidQCAddress")
      })

      it("should revert with zero capacity", async () => {
        await expect(
          qcManager.connect(governance).registerQC(qcAddress.address, 0)
        ).to.be.revertedWith("InvalidMintingCapacity")
      })
    })

    context("when called by non-governance", () => {
      it("should revert", async () => {
        await expect(
          qcManager
            .connect(user)
            .registerQC(qcAddress.address, initialMintingCapacity)
        ).to.be.revertedWith(
          `AccessControl: account ${user.address.toLowerCase()} is missing role ${QC_GOVERNANCE_ROLE}`
        )
      })
    })
  })

  describe("Minting Capacity Management", () => {
    beforeEach(async () => {
      // Setup registered QC
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getMaxMintingCapacity
        .whenCalledWith(qcAddress.address)
        .returns(initialMintingCapacity)
    })

    context("when called by governance", () => {
      it("should increase minting capacity", async () => {
        const newCapacity = initialMintingCapacity.mul(2)

        const tx = await qcManager
          .connect(governance)
          .increaseMintingCapacity(qcAddress.address, newCapacity)

        expect(mockQCData.updateMaxMintingCapacity).to.have.been.calledWith(
          qcAddress.address,
          newCapacity
        )

        await expect(tx)
          .to.emit(qcManager, "MintingCapIncreased")
          .withArgs(
            qcAddress.address,
            initialMintingCapacity,
            newCapacity,
            governance.address,
            expect.any(Number)
          )
      })

      it("should revert when decreasing capacity", async () => {
        const lowerCapacity = initialMintingCapacity.div(2)

        await expect(
          qcManager
            .connect(governance)
            .increaseMintingCapacity(qcAddress.address, lowerCapacity)
        ).to.be.revertedWith("NewCapMustBeHigher")
      })

      it("should revert for unregistered QC", async () => {
        mockQCData.isQCRegistered
          .whenCalledWith(qcAddress.address)
          .returns(false)

        await expect(
          qcManager
            .connect(governance)
            .increaseMintingCapacity(
              qcAddress.address,
              initialMintingCapacity.mul(2)
            )
        ).to.be.revertedWith("QCNotRegistered")
      })
    })
  })

  describe("5-State Machine", () => {
    beforeEach(async () => {
      // Setup registered QC in Active status
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(1) // Active
    })

    describe("setQCStatus", () => {
      context("when called by arbiter", () => {
        it("should change status to UnderReview", async () => {
          const reason = ethers.utils.id("COMPLIANCE_REVIEW")

          const tx = await qcManager
            .connect(arbiter)
            .setQCStatus(qcAddress.address, 4, reason) // UnderReview

          expect(mockQCData.setQCStatus).to.have.been.calledWith(
            qcAddress.address,
            4,
            reason
          )

          await expect(tx).to.emit(qcManager, "QCStatusChanged").withArgs(
            qcAddress.address,
            1, // oldStatus (Active)
            4, // newStatus (UnderReview)
            reason,
            arbiter.address,
            "AUTHORITY",
            expect.any(Number)
          )
        })

        it("should revert with empty reason", async () => {
          await expect(
            qcManager
              .connect(arbiter)
              .setQCStatus(qcAddress.address, 4, ethers.constants.HashZero)
          ).to.be.revertedWith("ReasonRequired")
        })
      })

      context("when called by non-arbiter", () => {
        it("should revert", async () => {
          const reason = ethers.utils.id("UNAUTHORIZED")

          await expect(
            qcManager.connect(user).setQCStatus(qcAddress.address, 4, reason)
          ).to.be.revertedWith(
            `AccessControl: account ${user.address.toLowerCase()} is missing role ${ARBITER_ROLE}`
          )
        })
      })
    })

    describe("requestStatusChange", () => {
      context("when called by watchdog enforcer", () => {
        it("should request status change to UnderReview", async () => {
          const reason = ethers.utils.id("INSUFFICIENT_RESERVES")

          const tx = await qcManager
            .connect(watchdog)
            .requestStatusChange(qcAddress.address, 4, reason) // UnderReview

          expect(mockQCData.setQCStatus).to.have.been.calledWith(
            qcAddress.address,
            4,
            reason
          )

          await expect(tx)
            .to.emit(qcManager, "QCStatusChangeRequested")
            .withArgs(
              qcAddress.address,
              4, // requestedStatus
              reason,
              watchdog.address,
              expect.any(Number)
            )
        })

        it("should revert when requesting invalid status", async () => {
          const reason = ethers.utils.id("INVALID_REQUEST")

          // WatchdogEnforcer can only request UnderReview status
          await expect(
            qcManager
              .connect(watchdog)
              .requestStatusChange(qcAddress.address, 5, reason) // Revoked
          ).to.be.revertedWith(
            "WatchdogEnforcer can only set UnderReview status"
          )
        })
      })
    })
  })

  describe("Self-Pause System", () => {
    beforeEach(async () => {
      // Setup QC with pause credit
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(1) // Active
      mockQCRedeemer.hasUnfulfilledRedemptions
        .whenCalledWith(qcAddress.address)
        .returns(false)

      // Grant pause credit using correct function name
      await qcManager.connect(deployer).grantInitialCredit(qcAddress.address)
    })

    describe("canSelfPause", () => {
      it("should return true when QC has credit and no unfulfilled redemptions", async () => {
        expect(await qcManager.canSelfPause(qcAddress.address)).to.be.true
      })

      it("should return false when QC has unfulfilled redemptions", async () => {
        mockQCRedeemer.hasUnfulfilledRedemptions
          .whenCalledWith(qcAddress.address)
          .returns(true)

        expect(await qcManager.canSelfPause(qcAddress.address)).to.be.false
      })

      it("should return false when QC is not Active", async () => {
        mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(2) // MintingPaused

        expect(await qcManager.canSelfPause(qcAddress.address)).to.be.false
      })
    })

    describe("selfPause", () => {
      it("should pause minting only", async () => {
        const tx = await qcManager.connect(qcAddress).selfPause(0) // MintingOnly

        expect(mockQCData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          2 // MintingPaused
        )

        await expect(tx).to.emit(qcManager, "QCSelfPaused")
      })

      it("should pause completely", async () => {
        const tx = await qcManager.connect(qcAddress).selfPause(1) // Complete

        expect(mockQCData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          3 // Paused
        )

        await expect(tx).to.emit(qcManager, "QCSelfPaused")
      })

      it("should consume pause credit", async () => {
        await qcManager.connect(qcAddress).selfPause(0)

        // Should not be able to pause again immediately
        expect(await qcManager.canSelfPause(qcAddress.address)).to.be.false
      })
    })
  })

  describe("Available Minting Capacity", () => {
    beforeEach(async () => {
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(1) // Active
      mockQCData.getQCMintedAmount
        .whenCalledWith(qcAddress.address)
        .returns(ethers.utils.parseEther("30"))
    })

    it("should calculate available capacity correctly", async () => {
      // Available should be based on reserve balance
      mockReserveOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qcAddress.address)
        .returns([ethers.utils.parseEther("70"), false])

      const availableCapacity = await qcManager.getAvailableMintingCapacity(
        qcAddress.address
      )
      expect(availableCapacity).to.equal(ethers.utils.parseEther("40")) // 70 reserves - 30 minted = 40
    })

    it("should return zero when QC is not Active", async () => {
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(2) // MintingPaused

      const availableCapacity = await qcManager.getAvailableMintingCapacity(
        qcAddress.address
      )
      expect(availableCapacity).to.equal(0)
    })

    it("should return zero for stale reserves", async () => {
      mockReserveOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qcAddress.address)
        .returns([ethers.utils.parseEther("70"), true]) // stale = true

      const availableCapacity = await qcManager.getAvailableMintingCapacity(
        qcAddress.address
      )
      expect(availableCapacity).to.equal(0)
    })

    it("should return zero when reserves are insufficient", async () => {
      // Reserves (20) < minted (30) = 0 available
      mockReserveOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qcAddress.address)
        .returns([ethers.utils.parseEther("20"), false])

      const availableCapacity = await qcManager.getAvailableMintingCapacity(
        qcAddress.address
      )
      expect(availableCapacity).to.equal(0)
    })
  })

  describe("Solvency Checking", () => {
    beforeEach(async () => {
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getQCMintedAmount
        .whenCalledWith(qcAddress.address)
        .returns(ethers.utils.parseEther("50"))
    })

    describe("verifyQCSolvency", () => {
      context("when called by arbiter", () => {
        it("should verify solvency with adequate reserves", async () => {
          // Mock adequate reserves (100 > 50 minted)
          mockReserveOracle.getReserveBalanceAndStaleness
            .whenCalledWith(qcAddress.address)
            .returns([ethers.utils.parseEther("100"), false])

          const result = await qcManager
            .connect(arbiter)
            .verifyQCSolvency(qcAddress.address)

          expect(result).to.be.true
        })

        it("should detect insolvency", async () => {
          // Mock insufficient reserves (30 < 50 minted)
          mockReserveOracle.getReserveBalanceAndStaleness
            .whenCalledWith(qcAddress.address)
            .returns([ethers.utils.parseEther("30"), false])

          mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(1) // Active

          const result = await qcManager
            .connect(arbiter)
            .verifyQCSolvency(qcAddress.address)

          expect(result).to.be.false

          // Should also change status to UnderReview
          expect(mockQCData.setQCStatus).to.have.been.calledWith(
            qcAddress.address,
            4, // UnderReview
            expect.any(String)
          )
        })

        it("should revert for unregistered QC", async () => {
          mockQCData.isQCRegistered
            .whenCalledWith(qcAddress.address)
            .returns(false)

          await expect(
            qcManager.connect(arbiter).verifyQCSolvency(qcAddress.address)
          ).to.be.revertedWith("QCNotRegisteredForSolvency")
        })
      })

      context("when called by non-arbiter", () => {
        it("should revert", async () => {
          await expect(
            qcManager.connect(user).verifyQCSolvency(qcAddress.address)
          ).to.be.revertedWith("NotAuthorizedForSolvency")
        })
      })
    })
  })
})
