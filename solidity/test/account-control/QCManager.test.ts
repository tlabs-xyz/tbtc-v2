import chai, { expect } from "chai"
import { ethers, helpers, upgrades } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  QCManager,
  QCData,
  SystemState,
  ReserveOracle,
  IQCRedeemer,
  AccountControl,
} from "../../typechain"
import { deployMessageSigning, deployQCManagerLib, getQCManagerLibraries } from "../helpers/spvLibraryHelpers"

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
  let accountControl: AccountControl
  let mockQCData: FakeContract<QCData>
  let mockSystemState: FakeContract<SystemState>
  let mockReserveOracle: FakeContract<ReserveOracle>
  let mockQCRedeemer: FakeContract<IQCRedeemer>

  // Role constants
  let DEFAULT_ADMIN_ROLE: string
  let GOVERNANCE_ROLE: string
  let REGISTRAR_ROLE: string
  let DISPUTE_ARBITER_ROLE: string
  let ENFORCEMENT_ROLE: string
  let MONITOR_ROLE: string
  let EMERGENCY_ROLE: string

  // Test constants
  const initialMintingCapacity = ethers.utils.parseEther("100")
  const validBtcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"

  before(async () => {
    const [
      deployerSigner,
      governanceSigner,
      qcAddressSigner,
      arbiterSigner,
      watchdogSigner,
      registrarSigner,
      pauserSigner,
      userSigner,
    ] = await ethers.getSigners()

    deployer = deployerSigner
    governance = governanceSigner
    qcAddress = qcAddressSigner
    arbiter = arbiterSigner
    watchdog = watchdogSigner
    registrar = registrarSigner
    pauser = pauserSigner
    user = userSigner

    // Generate role hashes
    DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
    GOVERNANCE_ROLE = ethers.utils.id("GOVERNANCE_ROLE")
    REGISTRAR_ROLE = ethers.utils.id("REGISTRAR_ROLE")
    DISPUTE_ARBITER_ROLE = ethers.utils.id("DISPUTE_ARBITER_ROLE")
    ENFORCEMENT_ROLE = ethers.utils.id("ENFORCEMENT_ROLE")
    MONITOR_ROLE = ethers.utils.id("MONITOR_ROLE")
    EMERGENCY_ROLE = ethers.utils.id("EMERGENCY_ROLE")
  })

  beforeEach(async () => {
    await createSnapshot()

    // Create mock contracts
    mockQCData = await smock.fake<QCData>("QCData")
    mockSystemState = await smock.fake<SystemState>("SystemState")
    mockReserveOracle = await smock.fake<ReserveOracle>("ReserveOracle")
    mockQCRedeemer = await smock.fake<IQCRedeemer>("IQCRedeemer")

    // Deploy QCManagerLib library (includes MessageSigning)
    const { qcManagerLib, messageSigning } = await deployQCManagerLib()

    // Deploy QCManager with library support
    const QCManagerFactory = await ethers.getContractFactory(
      "QCManager",
      getQCManagerLibraries({ messageSigning, qcManagerLib })
    )
    qcManager = await QCManagerFactory.deploy(
      mockQCData.address,
      mockSystemState.address,
      mockReserveOracle.address
    )
    await qcManager.deployed()

    // Deploy AccountControl using upgrades proxy (required for tests that trigger requiresAccountControl modifier)
    const AccountControlFactory = await ethers.getContractFactory("AccountControl")
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [governance.address, pauser.address, deployer.address], // Use deployer as mock bank
      { initializer: "initialize" }
    ) as AccountControl

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
    await qcManager.grantRole(DEFAULT_ADMIN_ROLE, governance.address) // Required for setAccountControl
    await qcManager.grantRole(GOVERNANCE_ROLE, governance.address)
    await qcManager.grantRole(DISPUTE_ARBITER_ROLE, arbiter.address)
    await qcManager.grantRole(ENFORCEMENT_ROLE, watchdog.address)
    await qcManager.grantRole(REGISTRAR_ROLE, registrar.address)
    await qcManager.grantRole(EMERGENCY_ROLE, pauser.address)
    await qcManager.grantRole(MONITOR_ROLE, watchdog.address)

    // Set QCRedeemer reference for integrated functionality
    await qcManager.setQCRedeemer(mockQCRedeemer.address)

    // Connect AccountControl to QCManager (required for tests that trigger requiresAccountControl modifier)
    await qcManager.connect(governance).setAccountControl(accountControl.address)

    // Note: QC authorization removed from global setup to avoid conflicts
    // Individual test suites will authorize QCs as needed for their specific scenarios

    // Grant QCManager ownership of AccountControl so it can authorize reserves
    await accountControl.connect(governance).transferOwnership(qcManager.address)
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
      expect(await qcManager.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to
        .be.true
    })

    it("should have correct role constants", async () => {
      expect(await qcManager.GOVERNANCE_ROLE()).to.equal(GOVERNANCE_ROLE)
      expect(await qcManager.REGISTRAR_ROLE()).to.equal(REGISTRAR_ROLE)
      expect(await qcManager.DISPUTE_ARBITER_ROLE()).to.equal(
        DISPUTE_ARBITER_ROLE
      )
      expect(await qcManager.ENFORCEMENT_ROLE()).to.equal(ENFORCEMENT_ROLE)
      expect(await qcManager.MONITOR_ROLE()).to.equal(MONITOR_ROLE)
      expect(await qcManager.EMERGENCY_ROLE()).to.equal(EMERGENCY_ROLE)
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

        await expect(tx).to.emit(qcManager, "QCRegistrationInitiated")

        await expect(tx).to.emit(qcManager, "QCOnboarded")
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
          `AccessControl: account ${user.address.toLowerCase()} is missing role ${GOVERNANCE_ROLE}`
        )
      })
    })
  })

  describe("Minting Capacity Management", () => {
    let mintingQC: SignerWithAddress

    beforeEach(async () => {
      // Use a different QC address for minting tests to avoid conflicts with registration tests
      const signers = await ethers.getSigners()
      mintingQC = signers[8] // Use a different signer for minting tests

      // Setup QC registration mocks - start with QC not registered
      mockQCData.isQCRegistered.whenCalledWith(mintingQC.address).returns(false)

      // Register the QC properly first (this will authorize it in AccountControl)
      // This addresses the NotAuthorized error from AccountControl.setMintingCap
      await qcManager.connect(governance).registerQC(
        mintingQC.address,
        initialMintingCapacity
      )

      // After registration, mock the QC as registered with the capacity
      mockQCData.isQCRegistered.whenCalledWith(mintingQC.address).returns(true)
      mockQCData.getMaxMintingCapacity
        .whenCalledWith(mintingQC.address)
        .returns(initialMintingCapacity)
    })

    context("when called by governance", () => {
      it("should increase minting capacity", async () => {
        const newCapacity = initialMintingCapacity.mul(2)

        const tx = await qcManager
          .connect(governance)
          .increaseMintingCapacity(mintingQC.address, newCapacity)

        expect(mockQCData.updateMaxMintingCapacity).to.have.been.calledWith(
          mintingQC.address,
          newCapacity
        )

        await expect(tx).to.emit(qcManager, "MintingCapIncreased")
      })

      it("should revert when decreasing capacity", async () => {
        const lowerCapacity = initialMintingCapacity.div(2)

        await expect(
          qcManager
            .connect(governance)
            .increaseMintingCapacity(mintingQC.address, lowerCapacity)
        ).to.be.revertedWith("NewCapMustBeHigher")
      })

      it("should revert for unregistered QC", async () => {
        // Use a different QC for this negative test
        const unregisteredQC = user // Use a different address
        mockQCData.isQCRegistered
          .whenCalledWith(unregisteredQC.address)
          .returns(false)

        await expect(
          qcManager
            .connect(governance)
            .increaseMintingCapacity(
              unregisteredQC.address,
              initialMintingCapacity.mul(2)
            )
        ).to.be.revertedWith("QCNotRegistered")
      })
    })
  })

  describe("Wallet Registration", () => {
    beforeEach(async () => {
      // Setup registered QC
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // Active

      // Note: Wallet ownership verification now happens on-chain via MessageSigning.verifyBitcoinSignature()
      // No mocking needed - the library will validate signature format and return true for valid signatures
    })

    context("when called by registrar with verified wallet ownership", () => {
      it("should register wallet successfully", async () => {
        const challenge = ethers.utils.id("test_challenge")
        const mockSignature = `0x${"aa".repeat(65)}` // Mock 65-byte signature

        const tx = await qcManager
          .connect(registrar)
          .registerWallet(
            qcAddress.address,
            validBtcAddress,
            challenge,
            mockSignature
          )

        expect(mockQCData.registerWallet).to.have.been.calledWith(
          qcAddress.address,
          validBtcAddress
        )

        await expect(tx).to.emit(qcManager, "WalletRegistrationRequested")
      })

      it("should revert for unregistered QC", async () => {
        mockQCData.isQCRegistered
          .whenCalledWith(qcAddress.address)
          .returns(false)

        const challenge = ethers.utils.id("test_challenge")
        const mockSignature = `0x${"aa".repeat(65)}`

        await expect(
          qcManager
            .connect(registrar)
            .registerWallet(
              qcAddress.address,
              validBtcAddress,
              challenge,
              mockSignature
            )
        ).to.be.revertedWith("QCNotRegistered")
      })

      it("should revert with invalid wallet address", async () => {
        const challenge = ethers.utils.id("test_challenge")
        const mockSignature = `0x${"aa".repeat(65)}`

        await expect(
          qcManager
            .connect(registrar)
            .registerWallet(qcAddress.address, "", challenge, mockSignature)
        ).to.be.revertedWith("InvalidWalletAddress")
      })

      it("should revert with invalid signature format", async () => {
        const challenge = ethers.utils.id("test_challenge")
        const invalidSignature = `0x${"aa".repeat(32)}` // Invalid length (32 bytes instead of 65)

        await expect(
          qcManager
            .connect(registrar)
            .registerWallet(
              qcAddress.address,
              validBtcAddress,
              challenge,
              invalidSignature
            )
        ).to.be.revertedWith("MessageSignatureVerificationFailed")
      })
    })

    context("when called by non-registrar", () => {
      it("should revert", async () => {
        const challenge = ethers.utils.id("test_challenge")
        const mockSignature = `0x${"aa".repeat(65)}`

        await expect(
          qcManager
            .connect(user)
            .registerWallet(
              qcAddress.address,
              validBtcAddress,
              challenge,
              mockSignature
            )
        ).to.be.revertedWith(
          `AccessControl: account ${user.address.toLowerCase()} is missing role ${REGISTRAR_ROLE}`
        )
      })
    })
  })

  describe("Wallet Ownership Verification Request", () => {
    beforeEach(async () => {
      // Setup registered QC
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
    })

    context("when called by registered QC", () => {
      it("should generate challenge and emit event", async () => {
        const nonce = 12345

        const tx = await qcManager
          .connect(qcAddress)
          .requestWalletOwnershipVerification(validBtcAddress, nonce)

        await expect(tx).to.emit(
          qcManager,
          "WalletOwnershipVerificationRequested"
        )

        // Should return a challenge (bytes32)
        const challenge = await qcManager
          .connect(qcAddress)
          .callStatic.requestWalletOwnershipVerification(validBtcAddress, nonce)
        expect(challenge).to.not.equal(ethers.constants.HashZero)
      })

      it("should revert with invalid wallet address", async () => {
        const nonce = 12345

        await expect(
          qcManager
            .connect(qcAddress)
            .requestWalletOwnershipVerification("", nonce)
        ).to.be.revertedWith("InvalidWalletAddress")
      })
    })

    context("when called by registrar", () => {
      it("should revert with clear message", async () => {
        const nonce = 12345

        await expect(
          qcManager
            .connect(registrar)
            .requestWalletOwnershipVerification(validBtcAddress, nonce)
        ).to.be.revertedWith("REGISTRAR_MUST_USE_REGISTER_WALLET")
      })
    })

    context("when called by unauthorized user", () => {
      it("should revert", async () => {
        const nonce = 12345

        await expect(
          qcManager
            .connect(user)
            .requestWalletOwnershipVerification(validBtcAddress, nonce)
        ).to.be.revertedWith("UNAUTHORIZED_WALLET_VERIFICATION")
      })
    })
  })

  describe("5-State Machine", () => {
    beforeEach(async () => {
      // Setup registered QC in Active status
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // Active
    })

    describe("setQCStatus", () => {
      context("when called by arbiter", () => {
        it("should change status to UnderReview", async () => {
          const reason = ethers.utils.id("COMPLIANCE_REVIEW")

          const tx = await qcManager
            .connect(arbiter)
            .setQCStatus(qcAddress.address, 3, reason) // UnderReview

          expect(mockQCData.setQCStatus).to.have.been.calledWith(
            qcAddress.address,
            3,
            reason
          )

          await expect(tx).to.emit(qcManager, "QCStatusChanged")
        })

        it("should change status to Revoked", async () => {
          const reason = ethers.utils.id("SECURITY_BREACH")

          await qcManager
            .connect(arbiter)
            .setQCStatus(qcAddress.address, 4, reason) // Revoked

          expect(mockQCData.setQCStatus).to.have.been.calledWith(
            qcAddress.address,
            4,
            reason
          )
        })

        it("should revert with empty reason", async () => {
          await expect(
            qcManager
              .connect(arbiter)
              .setQCStatus(qcAddress.address, 3, ethers.constants.HashZero)
          ).to.be.revertedWith("ReasonRequired")
        })
      })

      context("when called by non-arbiter", () => {
        it("should revert", async () => {
          const reason = ethers.utils.id("UNAUTHORIZED")

          await expect(
            qcManager.connect(user).setQCStatus(qcAddress.address, 4, reason)
          ).to.be.revertedWith(
            `AccessControl: account ${user.address.toLowerCase()} is missing role ${DISPUTE_ARBITER_ROLE}`
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
            .requestStatusChange(qcAddress.address, 3, reason) // UnderReview

          expect(mockQCData.setQCStatus).to.have.been.calledWith(
            qcAddress.address,
            3,
            reason
          )

          await expect(tx).to.emit(qcManager, "QCStatusChangeRequested")
        })

        it("should revert when requesting invalid status", async () => {
          const reason = ethers.utils.id("INVALID_REQUEST")

          // WatchdogEnforcer can only request UnderReview status
          await expect(
            qcManager
              .connect(watchdog)
              .requestStatusChange(qcAddress.address, 4, reason) // Revoked
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
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // Active
      mockQCRedeemer.hasUnfulfilledRedemptions
        .whenCalledWith(qcAddress.address)
        .returns(false)

      // Grant pause credit
      await qcManager.connect(deployer).grantInitialCredit(qcAddress.address)
    })

    describe("canSelfPause", () => {
      it("should return true when QC has credit and no unfulfilled redemptions", async () => {
        expect(await qcManager.canSelfPause(qcAddress.address)).to.be.true
      })

      it("should return false when QC has unfulfilled redemptions", async () => {
        // Mock a redemption deadline that would conflict with pause timing
        const futureDeadline = Math.floor(Date.now() / 1000) + 47 * 60 * 60 // 47 hours from now (less than 48h + buffer)
        mockQCRedeemer.getEarliestRedemptionDeadline
          .whenCalledWith(qcAddress.address)
          .returns(futureDeadline)

        expect(await qcManager.canSelfPause(qcAddress.address)).to.be.false
      })

      it("should return false when QC is already paused", async () => {
        // First pause the QC
        await qcManager.connect(qcAddress).selfPause(0) // MintingOnly

        expect(await qcManager.canSelfPause(qcAddress.address)).to.be.false
      })
    })

    describe("selfPause", () => {
      context("when called by QC with credit", () => {
        it("should pause minting only", async () => {
          const tx = await qcManager.connect(qcAddress).selfPause(0) // MintingOnly

          expect(mockQCData.setQCStatus).to.have.been.calledWith(
            qcAddress.address,
            1, // MintingPaused
            ethers.utils.id("SELF_PAUSE") // reason parameter as hash
          )

          await expect(tx).to.emit(qcManager, "QCSelfPaused")
        })

        it("should pause completely", async () => {
          const tx = await qcManager.connect(qcAddress).selfPause(1) // Complete

          expect(mockQCData.setQCStatus).to.have.been.calledWith(
            qcAddress.address,
            2, // Paused
            ethers.utils.id("SELF_PAUSE") // reason parameter as hash
          )

          await expect(tx).to.emit(qcManager, "QCSelfPaused")
        })

        it("should consume pause credit", async () => {
          await qcManager.connect(qcAddress).selfPause(0)

          // Should not be able to pause again immediately
          expect(await qcManager.canSelfPause(qcAddress.address)).to.be.false
        })
      })

      context("when redemption deadline would be breached", () => {
        beforeEach(async () => {
          // Use a different QC address (user) for this test to avoid conflicts
          mockQCData.isQCRegistered.whenCalledWith(user.address).returns(true)
          mockQCData.getQCStatus.whenCalledWith(user.address).returns(0) // Active
          mockQCRedeemer.hasUnfulfilledRedemptions
            .whenCalledWith(user.address)
            .returns(false)

          // Grant fresh credit for this fresh QC
          await qcManager.connect(deployer).grantInitialCredit(user.address)

          // Set redemption deadline within buffer period (4 hours from now)
          const futureDeadline = Math.floor(Date.now() / 1000) + 4 * 3600
          mockQCRedeemer.getEarliestRedemptionDeadline
            .whenCalledWith(user.address)
            .returns(futureDeadline)
        })

        it("should revert if redemption deadline conflict", async () => {
          await expect(
            qcManager.connect(user).selfPause(1) // Complete pause would conflict
          ).to.be.revertedWith("NoPauseCredit")
        })
      })

      context("when called by non-QC", () => {
        it("should revert", async () => {
          await expect(qcManager.connect(user).selfPause(1)).to.be.revertedWith(
            "NoPauseCredit"
          )
        })
      })
    })

    describe("resumeSelfPause", () => {
      beforeEach(async () => {
        // Pause QC first
        await qcManager.connect(qcAddress).selfPause(0) // MintingOnly

        // Update mock to reflect paused status
        mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(1) // MintingPaused
      })

      it("should allow early resume", async () => {
        const tx = await qcManager.connect(qcAddress).resumeSelfPause()

        expect(mockQCData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          0, // Back to Active
          ethers.utils.id("EARLY_RESUME") // reason parameter
        )

        await expect(tx).to.emit(qcManager, "EarlyResumed")
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

    describe("grantInitialCredit", () => {
      context("when called by deployer (DEFAULT_ADMIN_ROLE)", () => {
        it("should grant pause credit to QC", async () => {
          const tx = await qcManager
            .connect(deployer)
            .grantInitialCredit(qcAddress.address)

          await expect(tx).to.emit(qcManager, "InitialCreditGranted")

          expect(await qcManager.canSelfPause(qcAddress.address)).to.be.true
        })

        it("should revert for unregistered QC", async () => {
          mockQCData.isQCRegistered
            .whenCalledWith(qcAddress.address)
            .returns(false)

          await expect(
            qcManager.connect(pauser).grantInitialCredit(qcAddress.address)
          ).to.be.revertedWith("QCNotRegistered")
        })
      })

      context("when called by non-pauser", () => {
        it("should revert", async () => {
          await expect(
            qcManager.connect(user).grantInitialCredit(qcAddress.address)
          ).to.be.revertedWith(
            `AccessControl: account ${user.address.toLowerCase()} is missing role ${EMERGENCY_ROLE}`
          )
        })
      })
    })

    describe("emergencyClearPause", () => {
      beforeEach(async () => {
        await qcManager.connect(deployer).grantInitialCredit(qcAddress.address)
        // First pause the QC
        await qcManager.connect(qcAddress).selfPause(0) // MintingOnly
      })

      context("when called by pauser", () => {
        it("should clear pause and restore credit", async () => {
          const reason = "Emergency restoration"
          const tx = await qcManager
            .connect(pauser)
            .emergencyClearPause(qcAddress.address, reason)

          await expect(tx).to.emit(qcManager, "EmergencyCleared")

          expect(await qcManager.canSelfPause(qcAddress.address)).to.be.true
        })
      })
    })

    describe("selfPause without credit", () => {
      beforeEach(async () => {
        // Setup QC but DON'T grant pause credit
        mockQCData.isQCRegistered
          .whenCalledWith(qcAddress.address)
          .returns(true)
        mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // Active
        mockQCRedeemer.hasUnfulfilledRedemptions
          .whenCalledWith(qcAddress.address)
          .returns(false)
      })

      it("should revert when QC has no pause credit", async () => {
        await expect(
          qcManager.connect(qcAddress).selfPause(0) // MintingOnly
        ).to.be.revertedWith("NoPauseCredit")
      })
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
            .callStatic.verifyQCSolvency(qcAddress.address)

          expect(result).to.be.true
        })

        it("should detect insolvency", async () => {
          // Mock insufficient reserves (30 < 50 minted)
          mockReserveOracle.getReserveBalanceAndStaleness
            .whenCalledWith(qcAddress.address)
            .returns([ethers.utils.parseEther("30"), false])

          const result = await qcManager
            .connect(arbiter)
            .callStatic.verifyQCSolvency(qcAddress.address)

          expect(result).to.be.false
        })

        it("should ignore stale reserves for solvency check", async () => {
          // verifyQCSolvency ignores staleness, unlike getAvailableMintingCapacity
          mockReserveOracle.getReserveBalanceAndStaleness
            .whenCalledWith(qcAddress.address)
            .returns([ethers.utils.parseEther("100"), true]) // stale = true but adequate balance

          const result = await qcManager
            .connect(arbiter)
            .callStatic.verifyQCSolvency(qcAddress.address)

          expect(result).to.be.true // Should still be solvent despite staleness
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

  describe("Available Minting Capacity", () => {
    beforeEach(async () => {
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // Active
      mockQCData.getMaxMintingCapacity
        .whenCalledWith(qcAddress.address)
        .returns(ethers.utils.parseEther("100"))
      mockQCData.getQCMintedAmount
        .whenCalledWith(qcAddress.address)
        .returns(ethers.utils.parseEther("30"))
    })

    it("should calculate available capacity correctly", async () => {
      // Reset and setup mocks specifically for this test
      mockQCData.isQCRegistered.reset()
      mockQCData.getQCStatus.reset()
      mockQCData.getQCMintedAmount.reset()
      mockReserveOracle.getReserveBalanceAndStaleness.reset()

      // Ensure QC is properly registered and active
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // Active
      mockQCData.getQCMintedAmount
        .whenCalledWith(qcAddress.address)
        .returns(ethers.utils.parseEther("30"))

      // Available capacity = reserves - minted = 70 - 30 = 40
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

    it("should be limited by reserve balance", async () => {
      // Reserve only 40, available = reserves - minted = 40 - 30 = 10
      mockReserveOracle.getReserveBalanceAndStaleness
        .whenCalledWith(qcAddress.address)
        .returns([ethers.utils.parseEther("40"), false])

      const availableCapacity = await qcManager.getAvailableMintingCapacity(
        qcAddress.address
      )
      expect(availableCapacity).to.equal(ethers.utils.parseEther("10")) // 40 reserves - 30 minted = 10
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
  })

  describe("Auto-Escalation System", () => {
    beforeEach(async () => {
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)

      // Start with Active status for selfPause to work
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // Active

      // Setup a paused QC with escalation timer
      await qcManager
        .connect(deployer)
        .grantRole(EMERGENCY_ROLE, deployer.address)
      await qcManager
        .connect(deployer)
        .grantRole(MONITOR_ROLE, watchdog.address)
      await qcManager.connect(deployer).grantInitialCredit(qcAddress.address)

      // Call selfPause
      await qcManager.connect(qcAddress).selfPause(1) // Complete pause

      // Now update mock to return Paused status after selfPause
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(2) // Paused
    })

    describe("checkEscalation", () => {
      context("when called by watchdog after timeout", () => {
        it("should escalate to UnderReview after timeout", async () => {
          // Fast forward time beyond SELF_PAUSE_TIMEOUT (48 hours)
          await helpers.time.increaseTime(48 * 3600 + 1)

          const tx = await qcManager
            .connect(watchdog)
            .checkQCEscalations([qcAddress.address])

          // Should be called twice: once for selfPause (Paused=2), once for escalation (UnderReview=3)
          expect(mockQCData.setQCStatus).to.have.been.calledTwice
          expect(mockQCData.setQCStatus).to.have.been.calledWith(
            qcAddress.address,
            3, // UnderReview
            ethers.utils.id("AUTO_ESCALATION")
          )

          await expect(tx).to.emit(qcManager, "AutoEscalated")
        })

        it("should revert before timeout", async () => {
          // Only wait 1 hour (less than 48 hours)
          await helpers.time.increaseTime(3600)

          await expect(
            qcManager.connect(watchdog).checkQCEscalations([qcAddress.address])
          ).to.be.revertedWith("EscalationPeriodNotReached")
        })

        it("should revert if QC is not paused", async () => {
          mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // Active

          await expect(
            qcManager.connect(watchdog).checkQCEscalations([qcAddress.address])
          ).to.be.revertedWith("QCNotEligibleForEscalation")
        })
      })
    })
  })

  describe("Edge Cases and Integration", () => {
    it("should handle QC trying to self-pause when not active", async () => {
      mockSystemState.isFunctionPaused.returns(false) // System not paused
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(2) // MintingPaused (not Active)

      await qcManager.connect(deployer).grantInitialCredit(qcAddress.address)

      await expect(qcManager.connect(qcAddress).selfPause(1)).to.be.reverted // Will revert with QCNotActive custom error
    })

    it("should handle multiple status changes correctly", async () => {
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // Active

      const reason1 = ethers.utils.id("FIRST_CHANGE")
      await qcManager
        .connect(arbiter)
        .setQCStatus(qcAddress.address, 3, reason1) // UnderReview (correct: 3, not 4)

      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(3) // UnderReview

      const reason2 = ethers.utils.id("SECOND_CHANGE")
      await qcManager
        .connect(arbiter)
        .setQCStatus(qcAddress.address, 0, reason2) // Back to Active

      expect(mockQCData.setQCStatus).to.have.been.calledTwice
    })
  })

  describe("5-State Model Transitions", () => {
    beforeEach(async () => {
      // Mock QC as registered for testing
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      mockQCRedeemer.hasUnfulfilledRedemptions
        .whenCalledWith(qcAddress.address)
        .returns(false)

      // Grant initial pause credit (using deployer who has DEFAULT_ADMIN_ROLE)
      await qcManager.connect(deployer).grantInitialCredit(qcAddress.address)
    })

    describe("Active State Transitions", () => {
      beforeEach(async () => {
        mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // Active
      })

      it("should allow Active → MintingPaused", async () => {
        const reason = ethers.utils.id("MAINTENANCE")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 1, reason)
        ).to.not.be.reverted

        expect(mockQCData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          1,
          reason
        )
      })

      it("should allow Active → Paused", async () => {
        const reason = ethers.utils.id("FULL_MAINTENANCE")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 2, reason)
        ).to.not.be.reverted

        expect(mockQCData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          2,
          reason
        )
      })

      it("should allow Active → UnderReview", async () => {
        const reason = ethers.utils.id("VIOLATION")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 3, reason)
        ).to.not.be.reverted

        expect(mockQCData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          3,
          reason
        )
      })

      it("should allow Active → Revoked", async () => {
        const reason = ethers.utils.id("CRITICAL_VIOLATION")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 4, reason)
        ).to.not.be.reverted

        expect(mockQCData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          4,
          reason
        )
      })
    })

    describe("MintingPaused State Transitions", () => {
      beforeEach(async () => {
        mockQCData.getQCStatus.returns(1) // MintingPaused
      })

      it("should allow MintingPaused → Active", async () => {
        const reason = ethers.utils.id("RESUMED")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 0, reason)
        ).to.not.be.reverted
      })

      it("should allow MintingPaused → Paused", async () => {
        const reason = ethers.utils.id("ESCALATE")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 2, reason)
        ).to.not.be.reverted
      })

      it("should allow MintingPaused → UnderReview", async () => {
        const reason = ethers.utils.id("AUTO_ESCALATION")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 3, reason)
        ).to.not.be.reverted
      })

      it("should allow MintingPaused → Revoked", async () => {
        const reason = ethers.utils.id("CRITICAL")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 4, reason)
        ).to.not.be.reverted
      })
    })

    describe("Paused State Transitions", () => {
      beforeEach(async () => {
        mockQCData.getQCStatus.returns(2) // Paused
      })

      it("should allow Paused → Active", async () => {
        const reason = ethers.utils.id("RESUMED")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 0, reason)
        ).to.not.be.reverted
      })

      it("should allow Paused → MintingPaused", async () => {
        const reason = ethers.utils.id("PARTIAL_RESUME")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 1, reason)
        ).to.not.be.reverted
      })

      it("should allow Paused → UnderReview", async () => {
        const reason = ethers.utils.id("AUTO_ESCALATION")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 3, reason)
        ).to.not.be.reverted
      })

      it("should allow Paused → Revoked", async () => {
        const reason = ethers.utils.id("CRITICAL")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 4, reason)
        ).to.not.be.reverted
      })
    })

    describe("UnderReview State Transitions", () => {
      beforeEach(async () => {
        mockQCData.getQCStatus.returns(3) // UnderReview
      })

      it("should allow UnderReview → Active", async () => {
        const reason = ethers.utils.id("CLEARED")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 0, reason)
        ).to.not.be.reverted
      })

      it("should allow UnderReview → Revoked", async () => {
        const reason = ethers.utils.id("CONFIRMED_VIOLATION")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 4, reason)
        ).to.not.be.reverted
      })

      it("should reject UnderReview → MintingPaused", async () => {
        const reason = ethers.utils.id("INVALID")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 1, reason)
        ).to.be.revertedWith("InvalidStatusTransition")
      })

      it("should reject UnderReview → Paused", async () => {
        const reason = ethers.utils.id("INVALID")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 2, reason)
        ).to.be.revertedWith("InvalidStatusTransition")
      })
    })

    describe("Revoked State Transitions", () => {
      beforeEach(async () => {
        mockQCData.getQCStatus.returns(4) // Revoked
      })

      it("should reject Revoked → Active", async () => {
        const reason = ethers.utils.id("INVALID")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 0, reason)
        ).to.be.revertedWith("InvalidStatusTransition")
      })

      it("should reject Revoked → MintingPaused", async () => {
        const reason = ethers.utils.id("INVALID")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 1, reason)
        ).to.be.revertedWith("InvalidStatusTransition")
      })

      it("should reject Revoked → Paused", async () => {
        const reason = ethers.utils.id("INVALID")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 2, reason)
        ).to.be.revertedWith("InvalidStatusTransition")
      })

      it("should reject Revoked → UnderReview", async () => {
        const reason = ethers.utils.id("INVALID")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 3, reason)
        ).to.be.revertedWith("InvalidStatusTransition")
      })

      it("should allow Revoked → Revoked (no-op)", async () => {
        const reason = ethers.utils.id("NO_OP")
        await expect(
          qcManager.connect(arbiter).setQCStatus(qcAddress.address, 4, reason)
        ).to.not.be.reverted
      })
    })

    describe("Self-Pause Flow Validation", () => {
      it("should validate Active → MintingPaused via selfPause", async () => {
        mockQCData.getQCStatus.returns(0) // Active

        await qcManager.connect(qcAddress).selfPause(0) // MintingOnly

        expect(mockQCData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          1, // MintingPaused
          ethers.utils.id("SELF_PAUSE")
        )
      })

      it("should validate Active → Paused via selfPause", async () => {
        mockQCData.getQCStatus.returns(0) // Active

        await qcManager.connect(qcAddress).selfPause(1) // Complete

        expect(mockQCData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          2, // Paused
          ethers.utils.id("SELF_PAUSE")
        )
      })

      it("should validate MintingPaused → Active via resumeSelfPause", async () => {
        // First pause
        mockQCData.getQCStatus.returns(0) // Active
        await qcManager.connect(qcAddress).selfPause(0) // MintingOnly

        // Then resume
        mockQCData.getQCStatus.returns(1) // MintingPaused
        await qcManager.connect(qcAddress).resumeSelfPause()

        expect(mockQCData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          0, // Active
          ethers.utils.id("EARLY_RESUME")
        )
      })

      it("should validate Paused → Active via resumeSelfPause", async () => {
        // First pause
        mockQCData.getQCStatus.returns(0) // Active
        await qcManager.connect(qcAddress).selfPause(1) // Complete

        // Then resume
        mockQCData.getQCStatus.returns(2) // Paused
        await qcManager.connect(qcAddress).resumeSelfPause()

        expect(mockQCData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          0, // Active
          ethers.utils.id("EARLY_RESUME")
        )
      })
    })

    describe("Auto-Escalation Validation", () => {
      it("should validate MintingPaused → UnderReview auto-escalation", async () => {
        // Setup: QC is in MintingPaused state with timeout exceeded
        mockQCData.getQCStatus.returns(1) // MintingPaused

        // First self-pause to set the timestamp
        mockQCData.getQCStatus.returns(0) // Active first
        await qcManager.connect(qcAddress).selfPause(0) // MintingOnly -> MintingPaused

        // Fast forward time well beyond timeout to trigger escalation
        // Use 50 hours to be safely past both warning and escalation thresholds
        await helpers.time.increaseTime(50 * 60 * 60) // 50 hours

        // Mock the status for escalation
        mockQCData.getQCStatus.returns(1) // MintingPaused

        // Trigger escalation check
        await qcManager
          .connect(watchdog)
          .checkQCEscalations([qcAddress.address])

        // Verify escalation occurred
        expect(mockQCData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          3, // UnderReview
          ethers.utils.id("AUTO_ESCALATION")
        )
      })

      it("should validate Paused → UnderReview auto-escalation", async () => {
        // Setup: QC is in Paused state with timeout exceeded
        mockQCData.getQCStatus.returns(2) // Paused

        // First self-pause to set the timestamp
        mockQCData.getQCStatus.returns(0) // Active first
        await qcManager.connect(qcAddress).selfPause(1) // Complete -> Paused

        // Fast forward time well beyond timeout to trigger escalation
        // Use 50 hours to be safely past both warning and escalation thresholds
        await helpers.time.increaseTime(50 * 60 * 60) // 50 hours

        // Mock the status for escalation
        mockQCData.getQCStatus.returns(2) // Paused

        // Trigger escalation check
        await qcManager
          .connect(watchdog)
          .checkQCEscalations([qcAddress.address])

        // Verify escalation occurred
        expect(mockQCData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          3, // UnderReview
          ethers.utils.id("AUTO_ESCALATION")
        )
      })
    })
  })
})
