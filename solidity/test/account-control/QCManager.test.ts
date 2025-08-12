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
  let pauser: SignerWithAddress
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
    pauser = signers[6]
    user = signers[7]

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
    
    mockReserveOracle.getReserveBalanceAndStaleness.returns([0, false])
    mockQCRedeemer.hasUnfulfilledRedemptions.returns(false)
    mockQCRedeemer.getEarliestRedemptionDeadline.returns(0)

    // Grant roles for testing
    await qcManager.grantRole(QC_GOVERNANCE_ROLE, governance.address)
    await qcManager.grantRole(ARBITER_ROLE, arbiter.address)
    await qcManager.grantRole(WATCHDOG_ENFORCER_ROLE, watchdog.address)
    await qcManager.grantRole(REGISTRAR_ROLE, registrar.address)
    await qcManager.grantRole(PAUSER_ROLE, pauser.address)
    await qcManager.grantRole(WATCHDOG_ROLE, watchdog.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment", () => {
    it("should set correct dependencies", async () => {
      // QCManager uses direct integration - dependencies are immutable
      expect(qcManager.address).to.not.equal(ethers.constants.AddressZero)
    })

    it("should grant deployer admin role", async () => {
      expect(await qcManager.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true
    })

    it("should have correct role constants", async () => {
      expect(await qcManager.QC_ADMIN_ROLE()).to.equal(QC_ADMIN_ROLE)
      expect(await qcManager.REGISTRAR_ROLE()).to.equal(REGISTRAR_ROLE)
      expect(await qcManager.ARBITER_ROLE()).to.equal(ARBITER_ROLE)
      expect(await qcManager.WATCHDOG_ENFORCER_ROLE()).to.equal(WATCHDOG_ENFORCER_ROLE)
      expect(await qcManager.WATCHDOG_ROLE()).to.equal(WATCHDOG_ROLE)
      expect(await qcManager.PAUSER_ROLE()).to.equal(PAUSER_ROLE)
    })
  })

  describe("QC Registration", () => {
    context("when called by governance", () => {
      it("should register QC successfully", async () => {
        mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(false)
        
        const tx = await qcManager
          .connect(governance)
          .registerQC(qcAddress.address, initialMintingCapacity)

        expect(mockQCData.registerQC).to.have.been.calledWith(
          qcAddress.address,
          initialMintingCapacity
        )

        await expect(tx)
          .to.emit(qcManager, "QCRegistered")
          .withArgs(
            qcAddress.address,
            initialMintingCapacity,
            governance.address
          )
      })

      it("should revert if QC already registered", async () => {
        mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)

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
          qcManager
            .connect(governance)
            .registerQC(qcAddress.address, 0)
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
      mockQCData.getMaxMintingCapacity.whenCalledWith(qcAddress.address).returns(initialMintingCapacity)
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
          .to.emit(qcManager, "MintingCapacityUpdated")
          .withArgs(
            qcAddress.address,
            initialMintingCapacity,
            newCapacity,
            governance.address
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
        mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(false)
        
        await expect(
          qcManager
            .connect(governance)
            .increaseMintingCapacity(qcAddress.address, initialMintingCapacity.mul(2))
        ).to.be.revertedWith("QCNotRegistered")
      })
    })
  })

  describe("Wallet Registration", () => {
    beforeEach(async () => {
      // Setup registered QC
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
    })

    context("when called by registrar with valid SPV proof", () => {
      it("should register wallet successfully", async () => {
        const mockTxInfo = {
          version: "0x02000000",
          inputVector: "0x01" + "a".repeat(72) + "ffffffff",
          outputVector: "0x01" + "00e1f50500000000" + "1976a914" + "b".repeat(40) + "88ac",
          locktime: "0x00000000"
        }
        const mockProof = {
          merkleProof: "0x" + "c".repeat(128),
          txIndexInBlock: 0,
          bitcoinHeaders: "0x" + "d".repeat(160),
          coinbasePreimage: ethers.utils.id("mock_coinbase")
        }

        const tx = await qcManager
          .connect(registrar)
          .registerWallet(
            qcAddress.address,
            validBtcAddress,
            mockTxInfo,
            mockProof
          )

        expect(mockQCData.registerWallet).to.have.been.calledWith(
          qcAddress.address,
          validBtcAddress
        )

        await expect(tx)
          .to.emit(qcManager, "WalletRegistered")
          .withArgs(
            qcAddress.address,
            validBtcAddress,
            registrar.address
          )
      })

      it("should revert for unregistered QC", async () => {
        mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(false)
        
        const mockTxInfo = { version: "0x02000000", inputVector: "0x01", outputVector: "0x01", locktime: "0x00000000" }
        const mockProof = { merkleProof: "0x", txIndexInBlock: 0, bitcoinHeaders: "0x", coinbasePreimage: ethers.utils.id("mock") }

        await expect(
          qcManager
            .connect(registrar)
            .registerWallet(qcAddress.address, validBtcAddress, mockTxInfo, mockProof)
        ).to.be.revertedWith("QCNotRegistered")
      })

      it("should revert with invalid wallet address", async () => {
        const mockTxInfo = { version: "0x02000000", inputVector: "0x01", outputVector: "0x01", locktime: "0x00000000" }
        const mockProof = { merkleProof: "0x", txIndexInBlock: 0, bitcoinHeaders: "0x", coinbasePreimage: ethers.utils.id("mock") }

        await expect(
          qcManager
            .connect(registrar)
            .registerWallet(qcAddress.address, "", mockTxInfo, mockProof)
        ).to.be.revertedWith("InvalidWalletAddress")
      })
    })

    context("when called by non-registrar", () => {
      it("should revert", async () => {
        const mockTxInfo = { version: "0x02000000", inputVector: "0x01", outputVector: "0x01", locktime: "0x00000000" }
        const mockProof = { merkleProof: "0x", txIndexInBlock: 0, bitcoinHeaders: "0x", coinbasePreimage: ethers.utils.id("mock") }

        await expect(
          qcManager
            .connect(user)
            .registerWallet(qcAddress.address, validBtcAddress, mockTxInfo, mockProof)
        ).to.be.revertedWith(
          `AccessControl: account ${user.address.toLowerCase()} is missing role ${REGISTRAR_ROLE}`
        )
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
            4
          )

          await expect(tx)
            .to.emit(qcManager, "QCStatusChanged")
            .withArgs(
              qcAddress.address,
              1, // oldStatus (Active)
              4, // newStatus (UnderReview)
              reason,
              arbiter.address
            )
        })

        it("should change status to Revoked", async () => {
          const reason = ethers.utils.id("SECURITY_BREACH")
          
          await qcManager
            .connect(arbiter)
            .setQCStatus(qcAddress.address, 5, reason) // Revoked

          expect(mockQCData.setQCStatus).to.have.been.calledWith(
            qcAddress.address,
            5
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
            qcManager
              .connect(user)
              .setQCStatus(qcAddress.address, 4, reason)
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
            4
          )

          await expect(tx)
            .to.emit(qcManager, "StatusChangeRequested")
            .withArgs(
              qcAddress.address,
              1, // oldStatus
              4, // requestedStatus
              reason,
              watchdog.address
            )
        })

        it("should revert when requesting invalid status", async () => {
          const reason = ethers.utils.id("INVALID_REQUEST")
          
          // WatchdogEnforcer can only request UnderReview status
          await expect(
            qcManager
              .connect(watchdog)
              .requestStatusChange(qcAddress.address, 5, reason) // Revoked
          ).to.be.revertedWith("InvalidStatusTransition")
        })
      })
    })
  })

  describe("Self-Pause System", () => {
    beforeEach(async () => {
      // Setup QC with pause credit
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(1) // Active
      mockQCRedeemer.hasUnfulfilledRedemptions.whenCalledWith(qcAddress.address).returns(false)
      
      // Grant pause credit
      await qcManager.connect(pauser).grantPauseCredit(qcAddress.address)
    })

    describe("canSelfPause", () => {
      it("should return true when QC has credit and no unfulfilled redemptions", async () => {
        expect(await qcManager.canSelfPause(qcAddress.address)).to.be.true
      })

      it("should return false when QC has unfulfilled redemptions", async () => {
        mockQCRedeemer.hasUnfulfilledRedemptions.whenCalledWith(qcAddress.address).returns(true)
        
        expect(await qcManager.canSelfPause(qcAddress.address)).to.be.false
      })

      it("should return false when QC is already paused", async () => {
        // First pause the QC
        await qcManager.connect(qcAddress).selfPause(1) // MintingOnly
        
        expect(await qcManager.canSelfPause(qcAddress.address)).to.be.false
      })
    })

    describe("selfPause", () => {
      context("when called by QC with credit", () => {
        it("should pause minting only", async () => {
          const tx = await qcManager.connect(qcAddress).selfPause(1) // MintingOnly

          expect(mockQCData.setQCStatus).to.have.been.calledWith(
            qcAddress.address,
            2 // MintingPaused
          )

          await expect(tx).to.emit(qcManager, "QCSelfPaused")
        })

        it("should pause completely", async () => {
          const tx = await qcManager.connect(qcAddress).selfPause(2) // Complete

          expect(mockQCData.setQCStatus).to.have.been.calledWith(
            qcAddress.address,
            3 // Paused
          )

          await expect(tx).to.emit(qcManager, "QCSelfPaused")
        })

        it("should consume pause credit", async () => {
          await qcManager.connect(qcAddress).selfPause(1)
          
          // Should not be able to pause again immediately
          expect(await qcManager.canSelfPause(qcAddress.address)).to.be.false
        })

        it("should revert if redemption deadline conflict", async () => {
          // Set redemption deadline within buffer period
          const futureDeadline = Math.floor(Date.now() / 1000) + 4 * 3600 // 4 hours from now
          mockQCRedeemer.getEarliestRedemptionDeadline
            .whenCalledWith(qcAddress.address)
            .returns(futureDeadline)

          await expect(
            qcManager.connect(qcAddress).selfPause(2) // Complete pause would conflict
          ).to.be.revertedWith("RedemptionDeadlineConflict")
        })
      })

      context("when called by QC without credit", () => {
        it("should revert", async () => {
          // Revoke the credit
          await qcManager.connect(pauser).revokePauseCredit(qcAddress.address)
          
          await expect(
            qcManager.connect(qcAddress).selfPause(1)
          ).to.be.revertedWith("NoPauseCredit")
        })
      })

      context("when called by non-QC", () => {
        it("should revert", async () => {
          await expect(
            qcManager.connect(user).selfPause(1)
          ).to.be.revertedWith("QCNotRegistered")
        })
      })
    })

    describe("resumeSelfPause", () => {
      beforeEach(async () => {
        // Pause QC first
        await qcManager.connect(qcAddress).selfPause(1) // MintingOnly
      })

      it("should allow early resume", async () => {
        const tx = await qcManager.connect(qcAddress).resumeSelfPause()

        expect(mockQCData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          1 // Back to Active
        )

        await expect(tx).to.emit(qcManager, "QCSelfResumed")
      })

      it("should revert if called by non-QC", async () => {
        await expect(
          qcManager.connect(user).resumeSelfPause()
        ).to.be.revertedWith("CannotEarlyResume")
      })
    })
  })

  describe("Pause Credit Management", () => {
    beforeEach(async () => {
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
    })

    describe("grantPauseCredit", () => {
      context("when called by pauser", () => {
        it("should grant pause credit to QC", async () => {
          const tx = await qcManager
            .connect(pauser)
            .grantPauseCredit(qcAddress.address)

          await expect(tx)
            .to.emit(qcManager, "PauseCreditGranted")
            .withArgs(qcAddress.address, pauser.address)

          expect(await qcManager.canSelfPause(qcAddress.address)).to.be.true
        })

        it("should revert for unregistered QC", async () => {
          mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(false)
          
          await expect(
            qcManager.connect(pauser).grantPauseCredit(qcAddress.address)
          ).to.be.revertedWith("QCNotRegistered")
        })
      })

      context("when called by non-pauser", () => {
        it("should revert", async () => {
          await expect(
            qcManager.connect(user).grantPauseCredit(qcAddress.address)
          ).to.be.revertedWith(
            `AccessControl: account ${user.address.toLowerCase()} is missing role ${PAUSER_ROLE}`
          )
        })
      })
    })

    describe("revokePauseCredit", () => {
      beforeEach(async () => {
        await qcManager.connect(pauser).grantPauseCredit(qcAddress.address)
      })

      context("when called by pauser", () => {
        it("should revoke pause credit", async () => {
          const tx = await qcManager
            .connect(pauser)
            .revokePauseCredit(qcAddress.address)

          await expect(tx)
            .to.emit(qcManager, "PauseCreditRevoked")
            .withArgs(qcAddress.address, pauser.address)

          expect(await qcManager.canSelfPause(qcAddress.address)).to.be.false
        })
      })
    })
  })

  describe("Solvency Checking", () => {
    beforeEach(async () => {
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getQCMintedAmount.whenCalledWith(qcAddress.address).returns(ethers.utils.parseEther("50"))
    })

    describe("checkSolvency", () => {
      context("when called by arbiter", () => {
        it("should verify solvency with adequate reserves", async () => {
          // Mock adequate reserves (100 > 50 minted)
          mockReserveOracle.getReserveBalanceAndStaleness
            .whenCalledWith(qcAddress.address)
            .returns([ethers.utils.parseEther("100"), false])

          const result = await qcManager
            .connect(arbiter)
            .checkSolvency(qcAddress.address)

          expect(result.isSolvent).to.be.true
          expect(result.reserveBalance).to.equal(ethers.utils.parseEther("100"))
          expect(result.mintedAmount).to.equal(ethers.utils.parseEther("50"))
        })

        it("should detect insolvency", async () => {
          // Mock insufficient reserves (30 < 50 minted)
          mockReserveOracle.getReserveBalanceAndStaleness
            .whenCalledWith(qcAddress.address)
            .returns([ethers.utils.parseEther("30"), false])

          const result = await qcManager
            .connect(arbiter)
            .checkSolvency(qcAddress.address)

          expect(result.isSolvent).to.be.false
        })

        it("should detect stale reserves", async () => {
          mockReserveOracle.getReserveBalanceAndStaleness
            .whenCalledWith(qcAddress.address)
            .returns([ethers.utils.parseEther("100"), true]) // stale = true

          const result = await qcManager
            .connect(arbiter)
            .checkSolvency(qcAddress.address)

          expect(result.isStale).to.be.true
        })

        it("should revert for unregistered QC", async () => {
          mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(false)
          
          await expect(
            qcManager.connect(arbiter).checkSolvency(qcAddress.address)
          ).to.be.revertedWith("QCNotRegisteredForSolvency")
        })
      })

      context("when called by non-arbiter", () => {
        it("should revert", async () => {
          await expect(
            qcManager.connect(user).checkSolvency(qcAddress.address)
          ).to.be.revertedWith("NotAuthorizedForSolvency")
        })
      })
    })
  })

  describe("Available Minting Capacity", () => {
    beforeEach(async () => {
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(1) // Active
      mockQCData.getMaxMintingCapacity.whenCalledWith(qcAddress.address).returns(ethers.utils.parseEther("100"))
      mockQCData.getQCMintedAmount.whenCalledWith(qcAddress.address).returns(ethers.utils.parseEther("30"))
    })

    it("should calculate available capacity correctly", async () => {
      // Capacity: 100, Minted: 30, Available should be 70
      mockReserveOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qcAddress.address)
        .returns([ethers.utils.parseEther("70"), false])

      const availableCapacity = await qcManager.getAvailableMintingCapacity(qcAddress.address)
      expect(availableCapacity).to.equal(ethers.utils.parseEther("70"))
    })

    it("should return zero when QC is not Active", async () => {
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(2) // MintingPaused
      
      const availableCapacity = await qcManager.getAvailableMintingCapacity(qcAddress.address)
      expect(availableCapacity).to.equal(0)
    })

    it("should be limited by reserve balance", async () => {
      // Reserve only 40, should limit available capacity to 40 even though cap-minted = 70
      mockReserveOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qcAddress.address)
        .returns([ethers.utils.parseEther("40"), false])

      const availableCapacity = await qcManager.getAvailableMintingCapacity(qcAddress.address)
      expect(availableCapacity).to.equal(ethers.utils.parseEther("40"))
    })

    it("should return zero for stale reserves", async () => {
      mockReserveOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qcAddress.address)
        .returns([ethers.utils.parseEther("70"), true]) // stale = true

      const availableCapacity = await qcManager.getAvailableMintingCapacity(qcAddress.address)
      expect(availableCapacity).to.equal(0)
    })
  })

  describe("Auto-Escalation System", () => {
    beforeEach(async () => {
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(3) // Paused
      
      // Setup a paused QC with escalation timer
      await qcManager.connect(pauser).grantPauseCredit(qcAddress.address)
      await qcManager.connect(qcAddress).selfPause(2) // Complete pause
    })

    describe("checkEscalation", () => {
      context("when called by watchdog after timeout", () => {
        it("should escalate to UnderReview after timeout", async () => {
          // Fast forward time beyond SELF_PAUSE_TIMEOUT (48 hours)
          await helpers.time.increaseTime(48 * 3600 + 1)
          
          const tx = await qcManager.connect(watchdog).checkEscalation(qcAddress.address)

          expect(mockQCData.setQCStatus).to.have.been.calledWith(
            qcAddress.address,
            4 // UnderReview
          )

          await expect(tx).to.emit(qcManager, "QCStatusEscalated")
        })

        it("should revert before timeout", async () => {
          // Only wait 1 hour (less than 48 hours)
          await helpers.time.increaseTime(3600)
          
          await expect(
            qcManager.connect(watchdog).checkEscalation(qcAddress.address)
          ).to.be.revertedWith("EscalationPeriodNotReached")
        })

        it("should revert if QC is not paused", async () => {
          mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(1) // Active
          
          await expect(
            qcManager.connect(watchdog).checkEscalation(qcAddress.address)
          ).to.be.revertedWith("QCNotEligibleForEscalation")
        })
      })
    })
  })

  describe("Edge Cases and Integration", () => {
    it("should handle QC trying to self-pause when system is paused", async () => {
      mockSystemState.isFunctionPaused.returns(true) // System paused
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(1) // Active
      
      await qcManager.connect(pauser).grantPauseCredit(qcAddress.address)

      await expect(
        qcManager.connect(qcAddress).selfPause(1)
      ).to.be.revertedWith("Pausable: paused")
    })

    it("should handle multiple status changes correctly", async () => {
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(1) // Active
      
      const reason1 = ethers.utils.id("FIRST_CHANGE")
      await qcManager.connect(arbiter).setQCStatus(qcAddress.address, 4, reason1) // UnderReview
      
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(4) // UnderReview
      
      const reason2 = ethers.utils.id("SECOND_CHANGE")
      await qcManager.connect(arbiter).setQCStatus(qcAddress.address, 1, reason2) // Back to Active

      expect(mockQCData.setQCStatus).to.have.been.calledTwice
    })
  })
})