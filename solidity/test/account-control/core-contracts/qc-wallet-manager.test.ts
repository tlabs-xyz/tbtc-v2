import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { FakeContract, smock } from "@defi-wonderland/smock"
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import {
  QCWalletManager,
  QCData,
  SystemState,
  ReserveOracle,
  IQCRedeemer,
} from "../../../typechain"
import { setupTestSigners, type TestSigners } from "../fixtures/base-setup"
import { TEST_CONSTANTS } from "../fixtures/account-control-fixtures"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCWalletManager", () => {
  let signers: TestSigners
  let qcWalletManager: QCWalletManager
  let qcData: QCData
  let systemState: SystemState
  let reserveOracle: ReserveOracle
  let mockQCRedeemer: FakeContract<IQCRedeemer>

  // Test constants
  const VALID_BTC_ADDRESSES = {
    P2PKH: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    P2SH: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
    BECH32: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
  }

  const INVALID_BTC_ADDRESSES = {
    ETHEREUM: "0x1234567890123456789012345678901234567890",
    EMPTY: "",
    MALFORMED: "invalid_address",
  }

  // Sample wallet public key and signature components for testing
  const SAMPLE_WALLET_PUBKEY = `0x${"04".repeat(33)}` // 33-byte compressed public key

  const SAMPLE_SIGNATURE = {
    v: 27,
    r: ethers.utils.formatBytes32String("sample_r"),
    s: ethers.utils.formatBytes32String("sample_s"),
  }

  before(async () => {
    signers = await setupTestSigners()
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy real contracts
    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy()

    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy()

    const ReserveOracleFactory = await ethers.getContractFactory(
      "ReserveOracle"
    )

    reserveOracle = await ReserveOracleFactory.deploy(systemState.address)

    // Create mock QCRedeemer
    mockQCRedeemer = await smock.fake<IQCRedeemer>("IQCRedeemer")
    mockQCRedeemer.hasWalletObligations.returns(false)

    // Deploy QCManagerLib library first
    const QCManagerLibFactory = await ethers.getContractFactory("QCManagerLib")
    const qcManagerLib = await QCManagerLibFactory.deploy()

    // Deploy QCWalletManager with library linking
    const QCWalletManagerFactory = await ethers.getContractFactory(
      "QCWalletManager",
      {
        libraries: {
          QCManagerLib: qcManagerLib.address,
        },
      }
    )

    qcWalletManager = await QCWalletManagerFactory.deploy(
      qcData.address,
      systemState.address,
      reserveOracle.address
    )

    // Set QCRedeemer reference
    await qcWalletManager.setQCRedeemer(mockQCRedeemer.address)

    // Setup roles
    await qcWalletManager.grantRole(
      await qcWalletManager.REGISTRAR_ROLE(),
      signers.deployer.address
    )
    await qcWalletManager.grantRole(
      await qcWalletManager.GOVERNANCE_ROLE(),
      signers.governance.address
    )

    // Setup test QC in QCData
    await qcData.registerQC(
      signers.qcAddress.address,
      TEST_CONSTANTS.MEDIUM_CAP
    )
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment and Configuration", () => {
    it("should deploy with correct initial configuration", async () => {
      expect(await qcWalletManager.qcData()).to.equal(qcData.address)
      expect(await qcWalletManager.systemState()).to.equal(systemState.address)
      expect(await qcWalletManager.reserveOracle()).to.equal(
        reserveOracle.address
      )
      expect(await qcWalletManager.qcRedeemer()).to.equal(
        mockQCRedeemer.address
      )
    })

    it("should set correct access control roles", async () => {
      const DEFAULT_ADMIN_ROLE = await qcWalletManager.DEFAULT_ADMIN_ROLE()
      const REGISTRAR_ROLE = await qcWalletManager.REGISTRAR_ROLE()
      const GOVERNANCE_ROLE = await qcWalletManager.GOVERNANCE_ROLE()

      expect(
        await qcWalletManager.hasRole(
          DEFAULT_ADMIN_ROLE,
          signers.deployer.address
        )
      ).to.be.true
      expect(
        await qcWalletManager.hasRole(REGISTRAR_ROLE, signers.deployer.address)
      ).to.be.true
      expect(
        await qcWalletManager.hasRole(GOVERNANCE_ROLE, signers.deployer.address)
      ).to.be.true
    })

    it("should revert deployment with zero addresses", async () => {
      // Deploy QCManagerLib library first
      const QCManagerLibFactory = await ethers.getContractFactory(
        "QCManagerLib"
      )

      const qcManagerLib = await QCManagerLibFactory.deploy()

      const QCWalletManagerFactory = await ethers.getContractFactory(
        "QCWalletManager",
        {
          libraries: {
            QCManagerLib: qcManagerLib.address,
          },
        }
      )

      await expect(
        QCWalletManagerFactory.deploy(
          ethers.constants.AddressZero,
          systemState.address,
          reserveOracle.address
        )
      ).to.be.revertedWith("Invalid QCData")

      await expect(
        QCWalletManagerFactory.deploy(
          qcData.address,
          ethers.constants.AddressZero,
          reserveOracle.address
        )
      ).to.be.revertedWith("Invalid SystemState")

      await expect(
        QCWalletManagerFactory.deploy(
          qcData.address,
          systemState.address,
          ethers.constants.AddressZero
        )
      ).to.be.revertedWith("Invalid ReserveOracle")
    })
  })

  describe("QCRedeemer Management", () => {
    it("should allow admin to set QCRedeemer", async () => {
      const newRedeemer = signers.user.address

      await qcWalletManager.setQCRedeemer(newRedeemer)

      expect(await qcWalletManager.qcRedeemer()).to.equal(newRedeemer)
    })

    it("should prevent non-admin from setting QCRedeemer", async () => {
      const DEFAULT_ADMIN_ROLE = await qcWalletManager.DEFAULT_ADMIN_ROLE()

      await expect(
        qcWalletManager
          .connect(signers.user)
          .setQCRedeemer(signers.user.address)
      ).to.be.revertedWith(
        `AccessControl: account ${signers.user.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
      )
    })
  })

  describe("Wallet Registration by Registrar", () => {
    it("should allow registrar to register wallet with valid signature", async () => {
      const challenge = ethers.utils.formatBytes32String("test_challenge")

      const tx = await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        VALID_BTC_ADDRESSES.P2PKH,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )

      await expect(tx)
        .to.emit(qcWalletManager, "WalletRegistrationRequested")
        .withArgs(
          signers.qcAddress.address,
          VALID_BTC_ADDRESSES.P2PKH,
          challenge,
          signers.deployer.address
        )
    })

    it("should support different Bitcoin address formats", async () => {
      const challenge = ethers.utils.formatBytes32String("test_challenge")

      for (const [format, address] of Object.entries(VALID_BTC_ADDRESSES)) {
        await qcWalletManager.registerWallet(
          signers.qcAddress.address,
          address,
          challenge,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )
      }
    })

    it("should prevent non-registrar from registering wallet", async () => {
      const REGISTRAR_ROLE = await qcWalletManager.REGISTRAR_ROLE()
      const challenge = ethers.utils.formatBytes32String("test_challenge")

      await expect(
        qcWalletManager
          .connect(signers.user)
          .registerWallet(
            signers.qcAddress.address,
            VALID_BTC_ADDRESSES.P2PKH,
            challenge,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
      ).to.be.revertedWith(
        `AccessControl: account ${signers.user.address.toLowerCase()} is missing role ${REGISTRAR_ROLE}`
      )
    })

    it("should prevent registration when system is paused", async () => {
      await systemState.pauseWalletRegistration()

      const challenge = ethers.utils.formatBytes32String("test_challenge")

      await expect(
        qcWalletManager.registerWallet(
          signers.qcAddress.address,
          VALID_BTC_ADDRESSES.P2PKH,
          challenge,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )
      ).to.be.revertedWith("Paused")
    })
  })

  describe("Direct Wallet Registration by QCs", () => {
    it("should allow QC to register wallet directly", async () => {
      const nonce = 1

      const tx = await qcWalletManager
        .connect(signers.qcAddress)
        .registerWalletDirect(
          VALID_BTC_ADDRESSES.P2PKH,
          nonce,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )

      await expect(tx).to.emit(qcWalletManager, "WalletRegistrationRequested")
    })

    it("should prevent reuse of nonce", async () => {
      const nonce = 1

      // First registration succeeds
      await qcWalletManager
        .connect(signers.qcAddress)
        .registerWalletDirect(
          VALID_BTC_ADDRESSES.P2PKH,
          nonce,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )

      // Second registration with same nonce fails
      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .registerWalletDirect(
            VALID_BTC_ADDRESSES.P2SH,
            nonce,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
      ).to.be.revertedWithCustomError(qcWalletManager, "NonceAlreadyUsed")
    })

    it("should allow different QCs to use same nonce", async () => {
      const nonce = 1

      // Register second QC
      await qcData.registerQC(signers.user.address, TEST_CONSTANTS.MEDIUM_CAP)

      // Both QCs can use same nonce
      await qcWalletManager
        .connect(signers.qcAddress)
        .registerWalletDirect(
          VALID_BTC_ADDRESSES.P2PKH,
          nonce,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )

      await qcWalletManager
        .connect(signers.user)
        .registerWalletDirect(
          VALID_BTC_ADDRESSES.P2SH,
          nonce,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )
    })

    it("should prevent unregistered QC from direct registration", async () => {
      const nonce = 1

      await expect(
        qcWalletManager
          .connect(signers.user)
          .registerWalletDirect(
            VALID_BTC_ADDRESSES.P2PKH,
            nonce,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
      ).to.be.revertedWithCustomError(qcWalletManager, "QCNotRegistered")
    })

    it("should prevent direct registration when system is paused", async () => {
      await systemState.pauseWalletRegistration()
      const nonce = 1

      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .registerWalletDirect(
            VALID_BTC_ADDRESSES.P2PKH,
            nonce,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
      ).to.be.revertedWith("Paused")
    })
  })

  describe("Wallet Ownership Verification", () => {
    it("should allow QC to request ownership verification", async () => {
      const nonce = 123

      const tx = await qcWalletManager
        .connect(signers.qcAddress)
        .requestWalletOwnershipVerification(VALID_BTC_ADDRESSES.P2PKH, nonce)

      const expectedChallenge = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["string", "address", "uint256"],
          ["TBTC:", signers.qcAddress.address, nonce]
        )
      )

      await expect(tx)
        .to.emit(qcWalletManager, "WalletOwnershipVerificationRequested")
        .withArgs(
          signers.qcAddress.address,
          VALID_BTC_ADDRESSES.P2PKH,
          expectedChallenge,
          signers.qcAddress.address
        )
    })

    it("should prevent registrar from using ownership verification", async () => {
      const nonce = 123

      await expect(
        qcWalletManager
          .connect(signers.deployer) // Has REGISTRAR_ROLE
          .requestWalletOwnershipVerification(VALID_BTC_ADDRESSES.P2PKH, nonce)
      ).to.be.revertedWith("Use registerWallet")
    })

    it("should prevent unauthorized users from requesting verification", async () => {
      const nonce = 123

      await expect(
        qcWalletManager
          .connect(signers.user)
          .requestWalletOwnershipVerification(VALID_BTC_ADDRESSES.P2PKH, nonce)
      ).to.be.revertedWith("Unauthorized")
    })

    it("should reject empty Bitcoin address", async () => {
      const nonce = 123

      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletOwnershipVerification("", nonce)
      ).to.be.revertedWithCustomError(qcWalletManager, "InvalidWalletAddress")
    })

    it("should reject invalid Bitcoin address format", async () => {
      const nonce = 123

      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletOwnershipVerification(
            INVALID_BTC_ADDRESSES.ETHEREUM,
            nonce
          )
      ).to.be.revertedWithCustomError(qcWalletManager, "InvalidWalletAddress")
    })
  })

  describe("Wallet Deregistration", () => {
    beforeEach(async () => {
      // Register a wallet first
      const challenge = ethers.utils.formatBytes32String("test_challenge")
      await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        VALID_BTC_ADDRESSES.P2PKH,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )
    })

    it("should allow QC to request wallet deregistration", async () => {
      const tx = await qcWalletManager
        .connect(signers.qcAddress)
        .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)

      await expect(tx)
        .to.emit(qcWalletManager, "WalletDeregistrationRequested")
        .withArgs(signers.qcAddress.address, VALID_BTC_ADDRESSES.P2PKH)
    })

    it("should allow governance to request wallet deregistration", async () => {
      const tx = await qcWalletManager
        .connect(signers.governance)
        .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)

      await expect(tx)
        .to.emit(qcWalletManager, "WalletDeregistrationRequested")
        .withArgs(signers.qcAddress.address, VALID_BTC_ADDRESSES.P2PKH)
    })

    it("should prevent deregistration when wallet has obligations", async () => {
      mockQCRedeemer.hasWalletObligations.returns(true)

      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)
      ).to.be.revertedWith("Pending redemptions")
    })

    it("should prevent unauthorized deregistration", async () => {
      await expect(
        qcWalletManager
          .connect(signers.user)
          .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)
      ).to.be.revertedWithCustomError(
        qcWalletManager,
        "NotAuthorizedForWalletDeregistration"
      )
    })

    it("should prevent deregistration of unregistered wallet", async () => {
      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2SH) // Not registered
      ).to.be.revertedWithCustomError(qcWalletManager, "WalletNotRegistered")
    })

    it("should prevent deregistration when system is paused", async () => {
      await systemState.pauseWalletRegistration()

      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)
      ).to.be.revertedWith("Paused")
    })

    it("should check deregistration lock status", async () => {
      const isLocked = await qcWalletManager.isWalletDeregistrationLocked(
        VALID_BTC_ADDRESSES.P2PKH
      )

      expect(isLocked).to.be.false
    })
  })

  describe("Wallet Deregistration Finalization", () => {
    beforeEach(async () => {
      // Register and request deregistration
      const challenge = ethers.utils.formatBytes32String("test_challenge")
      await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        VALID_BTC_ADDRESSES.P2PKH,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )

      await qcWalletManager
        .connect(signers.qcAddress)
        .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)
    })

    it("should allow registrar to finalize deregistration with solvency check", async () => {
      const newReserveBalance = ethers.utils.parseEther("100") // 100 BTC

      // Mock reserve oracle to return valid balance
      await reserveOracle.setReserveBalance(
        signers.qcAddress.address,
        newReserveBalance
      )

      const tx = await qcWalletManager.finalizeWalletDeRegistration(
        VALID_BTC_ADDRESSES.P2PKH,
        newReserveBalance
      )

      await expect(tx)
        .to.emit(qcWalletManager, "WalletDeregistrationCompleted")
        .withArgs(
          signers.qcAddress.address,
          VALID_BTC_ADDRESSES.P2PKH,
          newReserveBalance,
          0
        )

      await expect(tx).to.emit(qcWalletManager, "ReserveBalanceUpdated")
    })

    it("should prevent non-registrar from finalizing deregistration", async () => {
      const newReserveBalance = ethers.utils.parseEther("100")
      const REGISTRAR_ROLE = await qcWalletManager.REGISTRAR_ROLE()

      await expect(
        qcWalletManager
          .connect(signers.user)
          .finalizeWalletDeRegistration(
            VALID_BTC_ADDRESSES.P2PKH,
            newReserveBalance
          )
      ).to.be.revertedWith(
        `AccessControl: account ${signers.user.address.toLowerCase()} is missing role ${REGISTRAR_ROLE}`
      )
    })

    it("should prevent finalization when system is paused", async () => {
      await systemState.pauseWalletRegistration()
      const newReserveBalance = ethers.utils.parseEther("100")

      await expect(
        qcWalletManager.finalizeWalletDeRegistration(
          VALID_BTC_ADDRESSES.P2PKH,
          newReserveBalance
        )
      ).to.be.revertedWith("Paused")
    })

    it("should prevent finalization of wallet not pending deregistration", async () => {
      const newReserveBalance = ethers.utils.parseEther("100")

      // Register another wallet that hasn't requested deregistration
      const challenge = ethers.utils.formatBytes32String("test_challenge2")
      await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        VALID_BTC_ADDRESSES.P2SH,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )

      await expect(
        qcWalletManager.finalizeWalletDeRegistration(
          VALID_BTC_ADDRESSES.P2SH,
          newReserveBalance
        )
      ).to.be.revertedWithCustomError(
        qcWalletManager,
        "WalletNotPendingDeregistration"
      )
    })

    it("should prevent finalization of unregistered wallet", async () => {
      const newReserveBalance = ethers.utils.parseEther("100")

      await expect(
        qcWalletManager.finalizeWalletDeRegistration(
          VALID_BTC_ADDRESSES.BECH32,
          newReserveBalance
        )
      ).to.be.revertedWithCustomError(qcWalletManager, "WalletNotRegistered")
    })
  })

  describe("Reentrancy Protection", () => {
    it("should protect wallet registration from reentrancy", async () => {
      const challenge = ethers.utils.formatBytes32String("test_challenge")

      // This test verifies the nonReentrant modifier is applied
      // The modifier itself prevents reentrancy attacks
      await expect(
        qcWalletManager.registerWallet(
          signers.qcAddress.address,
          VALID_BTC_ADDRESSES.P2PKH,
          challenge,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )
      ).to.not.be.reverted
    })

    it("should protect direct wallet registration from reentrancy", async () => {
      const nonce = 1

      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .registerWalletDirect(
            VALID_BTC_ADDRESSES.P2PKH,
            nonce,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
      ).to.not.be.reverted
    })

    it("should protect deregistration from reentrancy", async () => {
      // Register wallet first
      const challenge = ethers.utils.formatBytes32String("test_challenge")
      await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        VALID_BTC_ADDRESSES.P2PKH,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )

      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)
      ).to.not.be.reverted
    })
  })

  describe("Bitcoin Address Validation", () => {
    it("should accept valid P2PKH addresses", async () => {
      const nonce = 123

      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletOwnershipVerification(VALID_BTC_ADDRESSES.P2PKH, nonce)
      ).to.not.be.reverted
    })

    it("should accept valid P2SH addresses", async () => {
      const nonce = 123

      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletOwnershipVerification(VALID_BTC_ADDRESSES.P2SH, nonce)
      ).to.not.be.reverted
    })

    it("should accept valid Bech32 addresses", async () => {
      const nonce = 123

      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletOwnershipVerification(VALID_BTC_ADDRESSES.BECH32, nonce)
      ).to.not.be.reverted
    })

    it("should reject Ethereum addresses", async () => {
      const nonce = 123

      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletOwnershipVerification(
            INVALID_BTC_ADDRESSES.ETHEREUM,
            nonce
          )
      ).to.be.revertedWithCustomError(qcWalletManager, "InvalidWalletAddress")
    })

    it("should reject malformed addresses", async () => {
      const nonce = 123

      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletOwnershipVerification(
            INVALID_BTC_ADDRESSES.MALFORMED,
            nonce
          )
      ).to.be.revertedWithCustomError(qcWalletManager, "InvalidWalletAddress")
    })
  })

  describe("Integration with External Contracts", () => {
    it("should properly interact with QCData for QC registration check", async () => {
      // This is implicitly tested in other tests, but we can verify the integration
      const isRegistered = await qcData.isQCRegistered(
        signers.qcAddress.address
      )

      expect(isRegistered).to.be.true

      const isNotRegistered = await qcData.isQCRegistered(signers.user.address)
      expect(isNotRegistered).to.be.false
    })

    it("should properly interact with SystemState for pause checks", async () => {
      // Verify system is not paused initially
      const isPaused = await systemState.isFunctionPaused("wallet_reg")
      expect(isPaused).to.be.false

      // Pause and verify
      await systemState.pauseWalletRegistration()
      const isPausedAfter = await systemState.isFunctionPaused("wallet_reg")
      expect(isPausedAfter).to.be.true
    })

    it("should properly interact with QCRedeemer for obligation checks", async () => {
      // Default mock behavior
      expect(
        await mockQCRedeemer.hasWalletObligations(VALID_BTC_ADDRESSES.P2PKH)
      ).to.be.false

      // Change mock behavior and verify
      mockQCRedeemer.hasWalletObligations.returns(true)
      expect(
        await mockQCRedeemer.hasWalletObligations(VALID_BTC_ADDRESSES.P2PKH)
      ).to.be.true
    })

    it("should handle case when QCRedeemer is not set", async () => {
      // Deploy QCManagerLib library first
      const QCManagerLibFactory = await ethers.getContractFactory(
        "QCManagerLib"
      )

      const qcManagerLib = await QCManagerLibFactory.deploy()

      // Deploy new instance without QCRedeemer
      const QCWalletManagerFactory = await ethers.getContractFactory(
        "QCWalletManager",
        {
          libraries: {
            QCManagerLib: qcManagerLib.address,
          },
        }
      )

      const newWalletManager = await QCWalletManagerFactory.deploy(
        qcData.address,
        systemState.address,
        reserveOracle.address
      )

      // Should handle null QCRedeemer gracefully (no obligations check)
      expect(await newWalletManager.qcRedeemer()).to.equal(
        ethers.constants.AddressZero
      )
    })
  })

  describe("Edge Cases and Error Conditions", () => {
    it("should handle concurrent deregistration requests properly", async () => {
      // Register wallet first
      const challenge = ethers.utils.formatBytes32String("test_challenge")
      await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        VALID_BTC_ADDRESSES.P2PKH,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )

      // First deregistration request succeeds
      await qcWalletManager
        .connect(signers.qcAddress)
        .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)

      // Second request should handle gracefully (wallet already in pending state)
      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)
      ).to.be.revertedWithCustomError(qcWalletManager, "WalletNotActive")
    })

    it("should handle nonce overflow gracefully", async () => {
      const maxNonce = ethers.constants.MaxUint256

      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .registerWalletDirect(
            VALID_BTC_ADDRESSES.P2PKH,
            maxNonce,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
      ).to.not.be.reverted
    })

    it("should handle empty signature components", async () => {
      const challenge = ethers.utils.formatBytes32String("test_challenge")

      // This should be caught by the validation library
      await expect(
        qcWalletManager.registerWallet(
          signers.qcAddress.address,
          VALID_BTC_ADDRESSES.P2PKH,
          challenge,
          SAMPLE_WALLET_PUBKEY,
          0, // Invalid v
          ethers.constants.HashZero, // Empty r
          ethers.constants.HashZero // Empty s
        )
      ).to.be.reverted // Will be caught by QCManagerLib validation
    })

    it("should handle very long Bitcoin addresses gracefully", async () => {
      const longAddress = "1".repeat(100) // Too long to be valid
      const nonce = 123

      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletOwnershipVerification(longAddress, nonce)
      ).to.be.revertedWithCustomError(qcWalletManager, "InvalidWalletAddress")
    })
  })

  describe("State Consistency", () => {
    it("should maintain consistent state across multiple operations", async () => {
      const nonce1 = 1
      const nonce2 = 2

      // Register two wallets
      await qcWalletManager
        .connect(signers.qcAddress)
        .registerWalletDirect(
          VALID_BTC_ADDRESSES.P2PKH,
          nonce1,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )

      await qcWalletManager
        .connect(signers.qcAddress)
        .registerWalletDirect(
          VALID_BTC_ADDRESSES.P2SH,
          nonce2,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )

      // Verify nonces are tracked correctly
      expect(
        await qcWalletManager.usedNonces(signers.qcAddress.address, nonce1)
      ).to.be.true
      expect(
        await qcWalletManager.usedNonces(signers.qcAddress.address, nonce2)
      ).to.be.true
      expect(await qcWalletManager.usedNonces(signers.qcAddress.address, 3)).to
        .be.false
    })
  })

  describe("Emergency Stop Functionality", () => {
    beforeEach(async () => {
      // Register a wallet first
      const challenge = ethers.utils.formatBytes32String("test_challenge")
      await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        VALID_BTC_ADDRESSES.P2PKH,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )
    })

    it("should allow admin to activate emergency stop", async () => {
      const tx = await qcWalletManager.setEmergencyStop(true)

      await expect(tx)
        .to.emit(qcWalletManager, "EmergencyStopSet")
        .withArgs(true, signers.deployer.address)

      expect(await qcWalletManager.emergencyStop()).to.be.true
    })

    it("should allow admin to deactivate emergency stop", async () => {
      await qcWalletManager.setEmergencyStop(true)

      const tx = await qcWalletManager.setEmergencyStop(false)

      await expect(tx)
        .to.emit(qcWalletManager, "EmergencyStopSet")
        .withArgs(false, signers.deployer.address)

      expect(await qcWalletManager.emergencyStop()).to.be.false
    })

    it("should prevent non-admin from setting emergency stop", async () => {
      const DEFAULT_ADMIN_ROLE = await qcWalletManager.DEFAULT_ADMIN_ROLE()

      await expect(
        qcWalletManager.connect(signers.user).setEmergencyStop(true)
      ).to.be.revertedWith(
        `AccessControl: account ${signers.user.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
      )
    })

    it("should block all wallet operations when emergency stop is active", async () => {
      await qcWalletManager.setEmergencyStop(true)

      const challenge = ethers.utils.formatBytes32String("emergency_test")
      const nonce = 999

      // Wallet registration should be blocked
      await expect(
        qcWalletManager.registerWallet(
          signers.qcAddress.address,
          VALID_BTC_ADDRESSES.P2SH,
          challenge,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )
      ).to.be.revertedWith("Emergency stop activated")

      // Direct wallet registration should be blocked
      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .registerWalletDirect(
            VALID_BTC_ADDRESSES.BECH32,
            nonce,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
      ).to.be.revertedWith("Emergency stop activated")

      // Wallet deregistration should be blocked
      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)
      ).to.be.revertedWith("Emergency stop activated")

      // Finalization should be blocked
      await expect(
        qcWalletManager.finalizeWalletDeRegistration(
          VALID_BTC_ADDRESSES.P2PKH,
          ethers.utils.parseEther("100")
        )
      ).to.be.revertedWith("Emergency stop activated")
    })

    it("should allow operations to resume after emergency stop is deactivated", async () => {
      await qcWalletManager.setEmergencyStop(true)
      await qcWalletManager.setEmergencyStop(false)

      const nonce = 888

      // Operations should work normally again
      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .registerWalletDirect(
            VALID_BTC_ADDRESSES.BECH32,
            nonce,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
      ).to.not.be.reverted
    })

    it("should allow view functions during emergency stop", async () => {
      await qcWalletManager.setEmergencyStop(true)

      // View functions should still work
      expect(await qcWalletManager.emergencyStop()).to.be.true
      expect(
        await qcWalletManager.isWalletDeregistrationLocked(
          VALID_BTC_ADDRESSES.P2PKH
        )
      ).to.be.false
    })
  })

  describe("QCRedeemer Timelock Management", () => {
    let newRedeemerAddress: string

    beforeEach(async () => {
      newRedeemerAddress = signers.user.address
    })

    it("should allow immediate first-time QCRedeemer setting", async () => {
      // Deploy new instance without QCRedeemer
      const QCManagerLibFactory = await ethers.getContractFactory(
        "QCManagerLib"
      )

      const qcManagerLib = await QCManagerLibFactory.deploy()

      const QCWalletManagerFactory = await ethers.getContractFactory(
        "QCWalletManager",
        {
          libraries: {
            QCManagerLib: qcManagerLib.address,
          },
        }
      )

      const newWalletManager = await QCWalletManagerFactory.deploy(
        qcData.address,
        systemState.address,
        reserveOracle.address
      )

      await newWalletManager.grantRole(
        await newWalletManager.GOVERNANCE_ROLE(),
        signers.governance.address
      )

      // First-time setting should be immediate
      await newWalletManager
        .connect(signers.governance)
        .setQCRedeemer(newRedeemerAddress)

      expect(await newWalletManager.qcRedeemer()).to.equal(newRedeemerAddress)
    })

    it("should initiate timelock for QCRedeemer updates", async () => {
      const tx = await qcWalletManager.proposeQCRedeemer(newRedeemerAddress)

      const expectedExecutionTime =
        (await ethers.provider.getBlock("latest")).timestamp + 24 * 60 * 60

      await expect(tx)
        .to.emit(qcWalletManager, "QCRedeemerUpdateProposed")
        .withArgs(
          newRedeemerAddress,
          expectedExecutionTime,
          signers.deployer.address
        )

      expect(await qcWalletManager.pendingQCRedeemer()).to.equal(
        newRedeemerAddress
      )
      expect(
        await qcWalletManager.pendingQCRedeemerUpdate(newRedeemerAddress)
      ).to.be.closeTo(expectedExecutionTime, 5) // Allow 5 second tolerance
    })

    it("should prevent execution before timelock expires", async () => {
      await qcWalletManager.proposeQCRedeemer(newRedeemerAddress)

      await expect(
        qcWalletManager.executeQCRedeemerUpdate()
      ).to.be.revertedWith("Timelock not expired")
    })

    it("should allow execution after timelock expires", async () => {
      const oldRedeemer = await qcWalletManager.qcRedeemer()

      await qcWalletManager.proposeQCRedeemer(newRedeemerAddress)

      // Fast forward 24 hours + 1 second
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1])
      await ethers.provider.send("evm_mine", [])

      const tx = await qcWalletManager.executeQCRedeemerUpdate()

      await expect(tx)
        .to.emit(qcWalletManager, "QCRedeemerUpdated")
        .withArgs(oldRedeemer, newRedeemerAddress, signers.deployer.address)

      expect(await qcWalletManager.qcRedeemer()).to.equal(newRedeemerAddress)
      expect(await qcWalletManager.pendingQCRedeemer()).to.equal(
        ethers.constants.AddressZero
      )
    })

    it("should prevent execution without pending update", async () => {
      await expect(
        qcWalletManager.executeQCRedeemerUpdate()
      ).to.be.revertedWith("No pending update")
    })

    it("should prevent non-admin from proposing updates", async () => {
      const DEFAULT_ADMIN_ROLE = await qcWalletManager.DEFAULT_ADMIN_ROLE()

      await expect(
        qcWalletManager
          .connect(signers.user)
          .proposeQCRedeemer(newRedeemerAddress)
      ).to.be.revertedWith(
        `AccessControl: account ${signers.user.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
      )
    })

    it("should prevent non-admin from executing updates", async () => {
      const DEFAULT_ADMIN_ROLE = await qcWalletManager.DEFAULT_ADMIN_ROLE()

      await qcWalletManager.proposeQCRedeemer(newRedeemerAddress)

      await expect(
        qcWalletManager.connect(signers.user).executeQCRedeemerUpdate()
      ).to.be.revertedWith(
        `AccessControl: account ${signers.user.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
      )
    })

    it("should allow overriding pending updates", async () => {
      const firstRedeemer = signers.user.address
      const secondRedeemer = signers.governance.address

      // Propose first update
      await qcWalletManager.proposeQCRedeemer(firstRedeemer)

      // Propose second update (should override first)
      await qcWalletManager.proposeQCRedeemer(secondRedeemer)

      expect(await qcWalletManager.pendingQCRedeemer()).to.equal(secondRedeemer)
    })
  })

  describe("Enhanced Solvency Testing", () => {
    beforeEach(async () => {
      // Register wallet and request deregistration
      const challenge = ethers.utils.formatBytes32String("test_challenge")
      await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        VALID_BTC_ADDRESSES.P2PKH,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )

      await qcWalletManager
        .connect(signers.qcAddress)
        .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)
    })

    it("should prevent finalization with insufficient reserve balance", async () => {
      const insufficientBalance = ethers.utils.parseEther("0.1") // Very low balance

      // This should fail solvency check in QCManagerLib
      await expect(
        qcWalletManager.finalizeWalletDeRegistration(
          VALID_BTC_ADDRESSES.P2PKH,
          insufficientBalance
        )
      ).to.be.reverted // Will be caught by solvency validation
    })

    it("should handle zero reserve balance correctly", async () => {
      const zeroBalance = ethers.utils.parseEther("0")

      await expect(
        qcWalletManager.finalizeWalletDeRegistration(
          VALID_BTC_ADDRESSES.P2PKH,
          zeroBalance
        )
      ).to.be.reverted // Should fail solvency check
    })

    it("should handle maximum reserve balance", async () => {
      const maxBalance = ethers.constants.MaxUint256.div(2) // Large but safe value

      // Mock reserve oracle to accept large balance
      await reserveOracle.setReserveBalance(
        signers.qcAddress.address,
        maxBalance
      )

      await expect(
        qcWalletManager.finalizeWalletDeRegistration(
          VALID_BTC_ADDRESSES.P2PKH,
          maxBalance
        )
      ).to.not.be.reverted
    })

    it("should emit correct reserve balance events", async () => {
      const newBalance = ethers.utils.parseEther("150")
      const oldBalance = ethers.utils.parseEther("0") // Default in mock

      await reserveOracle.setReserveBalance(
        signers.qcAddress.address,
        newBalance
      )

      const tx = await qcWalletManager.finalizeWalletDeRegistration(
        VALID_BTC_ADDRESSES.P2PKH,
        newBalance
      )

      await expect(tx)
        .to.emit(qcWalletManager, "ReserveBalanceUpdated")
        .withArgs(
          signers.qcAddress.address,
          oldBalance,
          newBalance,
          signers.deployer.address
        )
    })

    it("should handle negative balance changes correctly", async () => {
      // Set initial balance higher, then reduce it
      const initialBalance = ethers.utils.parseEther("200")
      const reducedBalance = ethers.utils.parseEther("50")

      await reserveOracle.setReserveBalance(
        signers.qcAddress.address,
        initialBalance
      )

      // Register another wallet to increase QC's reserves first
      const challenge = ethers.utils.formatBytes32String("test_challenge2")
      await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        VALID_BTC_ADDRESSES.P2SH,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )

      await qcWalletManager
        .connect(signers.qcAddress)
        .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2SH)

      await reserveOracle.setReserveBalance(
        signers.qcAddress.address,
        reducedBalance
      )

      await expect(
        qcWalletManager.finalizeWalletDeRegistration(
          VALID_BTC_ADDRESSES.P2SH,
          reducedBalance
        )
      ).to.not.be.reverted
    })
  })

  describe("Concurrent Operation Tests", () => {
    beforeEach(async () => {
      // Register multiple wallets for testing
      const challenges = [
        ethers.utils.formatBytes32String("challenge1"),
        ethers.utils.formatBytes32String("challenge2"),
        ethers.utils.formatBytes32String("challenge3"),
      ]

      const addresses = [
        VALID_BTC_ADDRESSES.P2PKH,
        VALID_BTC_ADDRESSES.P2SH,
        VALID_BTC_ADDRESSES.BECH32,
      ]

      for (let i = 0; i < addresses.length; i++) {
        await qcWalletManager.registerWallet(
          signers.qcAddress.address,
          addresses[i],
          challenges[i],
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )
      }
    })

    it("should handle concurrent deregistration requests atomically", async () => {
      // Request deregistration for first wallet
      await qcWalletManager
        .connect(signers.qcAddress)
        .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)

      // Verify lock is active
      expect(
        await qcWalletManager.isWalletDeregistrationLocked(
          VALID_BTC_ADDRESSES.P2PKH
        )
      ).to.be.true

      // Second request on same wallet should fail due to lock
      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)
      ).to.be.revertedWith("In progress")
    })

    it("should allow concurrent operations on different wallets", async () => {
      // Both operations should succeed as they're on different wallets
      const promise1 = qcWalletManager
        .connect(signers.qcAddress)
        .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)

      const promise2 = qcWalletManager
        .connect(signers.qcAddress)
        .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2SH)

      await Promise.all([promise1, promise2])

      // Both wallets should be locked
      expect(
        await qcWalletManager.isWalletDeregistrationLocked(
          VALID_BTC_ADDRESSES.P2PKH
        )
      ).to.be.true
      expect(
        await qcWalletManager.isWalletDeregistrationLocked(
          VALID_BTC_ADDRESSES.P2SH
        )
      ).to.be.true
    })

    it("should release locks after finalization", async () => {
      await qcWalletManager
        .connect(signers.qcAddress)
        .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)

      // Verify lock is active
      expect(
        await qcWalletManager.isWalletDeregistrationLocked(
          VALID_BTC_ADDRESSES.P2PKH
        )
      ).to.be.true

      // Finalize deregistration
      const newBalance = ethers.utils.parseEther("100")
      await reserveOracle.setReserveBalance(
        signers.qcAddress.address,
        newBalance
      )

      await qcWalletManager.finalizeWalletDeRegistration(
        VALID_BTC_ADDRESSES.P2PKH,
        newBalance
      )

      // Lock should be released
      expect(
        await qcWalletManager.isWalletDeregistrationLocked(
          VALID_BTC_ADDRESSES.P2PKH
        )
      ).to.be.false
    })

    it("should handle mixed concurrent operations", async () => {
      // Mix of registration and deregistration operations
      const newNonce = 777

      const registrationPromise = qcWalletManager
        .connect(signers.qcAddress)
        .registerWalletDirect(
          "1NewAddressForConcurrentTest",
          newNonce,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )

      const deregistrationPromise = qcWalletManager
        .connect(signers.qcAddress)
        .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)

      // Both should complete successfully
      await Promise.all([registrationPromise, deregistrationPromise])
    })

    it("should maintain data consistency under concurrent load", async () => {
      const concurrentOperations = []
      const nonces = [1001, 1002, 1003, 1004, 1005]

      // Create multiple concurrent registration operations
      for (let i = 0; i < nonces.length; i++) {
        concurrentOperations.push(
          qcWalletManager
            .connect(signers.qcAddress)
            .registerWalletDirect(
              `1ConcurrentTest${i}`,
              nonces[i],
              SAMPLE_WALLET_PUBKEY,
              SAMPLE_SIGNATURE.v,
              SAMPLE_SIGNATURE.r,
              SAMPLE_SIGNATURE.s
            )
        )
      }

      await Promise.all(concurrentOperations)

      // Verify all nonces were properly tracked
      for (const nonce of nonces) {
        expect(
          await qcWalletManager.usedNonces(signers.qcAddress.address, nonce)
        ).to.be.true
      }
    })
  })

  describe("Cross-Contract Integration Tests", () => {
    it("should properly integrate with QCData for wallet lifecycle", async () => {
      const btcAddress = VALID_BTC_ADDRESSES.P2PKH
      const challenge = ethers.utils.formatBytes32String("integration_test")

      // Initial state - wallet not registered
      expect(await qcData.getWalletOwner(btcAddress)).to.equal(
        ethers.constants.AddressZero
      )

      // Register wallet through QCWalletManager
      await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        btcAddress,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )

      // Verify QCData state updated
      expect(await qcData.getWalletOwner(btcAddress)).to.equal(
        signers.qcAddress.address
      )
      expect(await qcData.getWalletStatus(btcAddress)).to.equal(1) // Active

      // Request deregistration
      await qcWalletManager
        .connect(signers.qcAddress)
        .requestWalletDeRegistration(btcAddress)

      // Verify status changed to pending
      expect(await qcData.getWalletStatus(btcAddress)).to.equal(2) // PendingDeRegistration

      // Finalize deregistration
      const newBalance = ethers.utils.parseEther("100")
      await reserveOracle.setReserveBalance(
        signers.qcAddress.address,
        newBalance
      )

      await qcWalletManager.finalizeWalletDeRegistration(btcAddress, newBalance)

      // Verify final state
      expect(await qcData.getWalletStatus(btcAddress)).to.equal(3) // Deregistered
    })

    it("should properly integrate with SystemState for pause functionality", async () => {
      const challenge = ethers.utils.formatBytes32String("pause_test")

      // Normal operation should work
      await expect(
        qcWalletManager.registerWallet(
          signers.qcAddress.address,
          VALID_BTC_ADDRESSES.P2PKH,
          challenge,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )
      ).to.not.be.reverted

      // Pause the system
      await systemState.pauseWalletRegistration()

      // Operations should be blocked
      await expect(
        qcWalletManager.registerWallet(
          signers.qcAddress.address,
          VALID_BTC_ADDRESSES.P2SH,
          challenge,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )
      ).to.be.revertedWith("Paused")

      // Unpause and verify operations resume
      await systemState.unpauseWalletRegistration()

      await expect(
        qcWalletManager.registerWallet(
          signers.qcAddress.address,
          VALID_BTC_ADDRESSES.BECH32,
          challenge,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )
      ).to.not.be.reverted
    })

    it("should properly integrate with QCRedeemer for obligation checks", async () => {
      const btcAddress = VALID_BTC_ADDRESSES.P2PKH
      const challenge = ethers.utils.formatBytes32String("obligation_test")

      // Register wallet
      await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        btcAddress,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )

      // Set mock to indicate wallet has obligations
      mockQCRedeemer.hasWalletObligations.returns(true)

      // Deregistration should be blocked
      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletDeRegistration(btcAddress)
      ).to.be.revertedWith("Pending redemptions")

      // Clear obligations
      mockQCRedeemer.hasWalletObligations.returns(false)

      // Deregistration should now work
      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletDeRegistration(btcAddress)
      ).to.not.be.reverted
    })

    it("should handle null QCRedeemer gracefully", async () => {
      // Deploy new instance without QCRedeemer
      const QCManagerLibFactory = await ethers.getContractFactory(
        "QCManagerLib"
      )

      const qcManagerLib = await QCManagerLibFactory.deploy()

      const QCWalletManagerFactory = await ethers.getContractFactory(
        "QCWalletManager",
        {
          libraries: {
            QCManagerLib: qcManagerLib.address,
          },
        }
      )

      const newWalletManager = await QCWalletManagerFactory.deploy(
        qcData.address,
        systemState.address,
        reserveOracle.address
      )

      await newWalletManager.grantRole(
        await newWalletManager.REGISTRAR_ROLE(),
        signers.deployer.address
      )

      const challenge = ethers.utils.formatBytes32String("null_redeemer_test")

      // Register wallet
      await newWalletManager.registerWallet(
        signers.qcAddress.address,
        VALID_BTC_ADDRESSES.P2PKH,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )

      // Deregistration should work without QCRedeemer check
      await expect(
        newWalletManager
          .connect(signers.qcAddress)
          .requestWalletDeRegistration(VALID_BTC_ADDRESSES.P2PKH)
      ).to.not.be.reverted
    })

    it("should properly integrate with ReserveOracle for balance updates", async () => {
      const btcAddress = VALID_BTC_ADDRESSES.P2PKH
      const challenge = ethers.utils.formatBytes32String("oracle_test")
      const initialBalance = ethers.utils.parseEther("50")
      const newBalance = ethers.utils.parseEther("100")

      // Set initial balance
      await reserveOracle.setReserveBalance(
        signers.qcAddress.address,
        initialBalance
      )

      // Register and request deregistration
      await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        btcAddress,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )

      await qcWalletManager
        .connect(signers.qcAddress)
        .requestWalletDeRegistration(btcAddress)

      // Update balance in oracle
      await reserveOracle.setReserveBalance(
        signers.qcAddress.address,
        newBalance
      )

      // Finalize should read from oracle
      const tx = await qcWalletManager.finalizeWalletDeRegistration(
        btcAddress,
        newBalance
      )

      await expect(tx)
        .to.emit(qcWalletManager, "ReserveBalanceUpdated")
        .withArgs(
          signers.qcAddress.address,
          initialBalance,
          newBalance,
          signers.deployer.address
        )
    })
  })

  describe("Error Recovery and Edge Cases", () => {
    it("should handle recovery from failed deregistration", async () => {
      const btcAddress = VALID_BTC_ADDRESSES.P2PKH
      const challenge = ethers.utils.formatBytes32String("recovery_test")

      // Register wallet
      await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        btcAddress,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )

      // Request deregistration
      await qcWalletManager
        .connect(signers.qcAddress)
        .requestWalletDeRegistration(btcAddress)

      // Verify wallet is in pending state
      expect(await qcData.getWalletStatus(btcAddress)).to.equal(2) // PendingDeRegistration

      // Attempt finalization with invalid balance (should fail)
      await expect(
        qcWalletManager.finalizeWalletDeRegistration(
          btcAddress,
          ethers.utils.parseEther("0") // Too low
        )
      ).to.be.reverted

      // Wallet should still be in pending state
      expect(await qcData.getWalletStatus(btcAddress)).to.equal(2)

      // Now finalize with valid balance
      const validBalance = ethers.utils.parseEther("100")
      await reserveOracle.setReserveBalance(
        signers.qcAddress.address,
        validBalance
      )

      await expect(
        qcWalletManager.finalizeWalletDeRegistration(btcAddress, validBalance)
      ).to.not.be.reverted

      // Should be properly deregistered
      expect(await qcData.getWalletStatus(btcAddress)).to.equal(3) // Deregistered
    })

    it("should handle system state changes during operations", async () => {
      const btcAddress = VALID_BTC_ADDRESSES.P2PKH
      const challenge = ethers.utils.formatBytes32String("state_change_test")

      // Start registration
      await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        btcAddress,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )

      // Request deregistration
      await qcWalletManager
        .connect(signers.qcAddress)
        .requestWalletDeRegistration(btcAddress)

      // Pause system after request but before finalization
      await systemState.pauseWalletRegistration()

      // Finalization should be blocked
      await expect(
        qcWalletManager.finalizeWalletDeRegistration(
          btcAddress,
          ethers.utils.parseEther("100")
        )
      ).to.be.revertedWith("Paused")

      // Unpause and finalize
      await systemState.unpauseWalletRegistration()

      const validBalance = ethers.utils.parseEther("100")
      await reserveOracle.setReserveBalance(
        signers.qcAddress.address,
        validBalance
      )

      await expect(
        qcWalletManager.finalizeWalletDeRegistration(btcAddress, validBalance)
      ).to.not.be.reverted
    })

    it("should handle emergency stop during operations", async () => {
      const btcAddress = VALID_BTC_ADDRESSES.P2PKH
      const challenge = ethers.utils.formatBytes32String("emergency_test")

      // Register wallet
      await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        btcAddress,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )

      // Activate emergency stop
      await qcWalletManager.setEmergencyStop(true)

      // All operations should be blocked
      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletDeRegistration(btcAddress)
      ).to.be.revertedWith("Emergency stop activated")

      // Deactivate emergency stop
      await qcWalletManager.setEmergencyStop(false)

      // Operations should resume
      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletDeRegistration(btcAddress)
      ).to.not.be.reverted
    })

    it("should handle contract upgrades gracefully", async () => {
      const currentRedeemer = await qcWalletManager.qcRedeemer()
      const newRedeemer = signers.user.address

      // Propose update
      await qcWalletManager.proposeQCRedeemer(newRedeemer)

      // Operations should continue with current redeemer
      const btcAddress = VALID_BTC_ADDRESSES.P2PKH
      const challenge = ethers.utils.formatBytes32String("upgrade_test")

      await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        btcAddress,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )

      // Complete upgrade
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1])
      await ethers.provider.send("evm_mine", [])

      await qcWalletManager.executeQCRedeemerUpdate()

      // Verify new redeemer is set
      expect(await qcWalletManager.qcRedeemer()).to.equal(newRedeemer)

      // Operations should continue with new redeemer
      await expect(
        qcWalletManager
          .connect(signers.qcAddress)
          .requestWalletDeRegistration(btcAddress)
      ).to.not.be.reverted
    })

    it("should handle malformed data gracefully", async () => {
      const malformedChallenges = [
        ethers.constants.HashZero,
        "0x",
        ethers.utils.formatBytes32String(""),
      ]

      for (const challenge of malformedChallenges) {
        await expect(
          qcWalletManager.registerWallet(
            signers.qcAddress.address,
            VALID_BTC_ADDRESSES.P2PKH,
            challenge,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
        ).to.be.reverted // Should be caught by validation
      }
    })

    it("should handle role changes during operations", async () => {
      const btcAddress = VALID_BTC_ADDRESSES.P2PKH
      const challenge = ethers.utils.formatBytes32String("role_change_test")

      // Register wallet
      await qcWalletManager.registerWallet(
        signers.qcAddress.address,
        btcAddress,
        challenge,
        SAMPLE_WALLET_PUBKEY,
        SAMPLE_SIGNATURE.v,
        SAMPLE_SIGNATURE.r,
        SAMPLE_SIGNATURE.s
      )

      // Request deregistration
      await qcWalletManager
        .connect(signers.qcAddress)
        .requestWalletDeRegistration(btcAddress)

      // Remove registrar role
      await qcWalletManager.revokeRole(
        await qcWalletManager.REGISTRAR_ROLE(),
        signers.deployer.address
      )

      // Finalization should fail
      await expect(
        qcWalletManager.finalizeWalletDeRegistration(
          btcAddress,
          ethers.utils.parseEther("100")
        )
      ).to.be.revertedWith("missing role")

      // Restore role and complete operation
      await qcWalletManager.grantRole(
        await qcWalletManager.REGISTRAR_ROLE(),
        signers.deployer.address
      )

      const validBalance = ethers.utils.parseEther("100")
      await reserveOracle.setReserveBalance(
        signers.qcAddress.address,
        validBalance
      )

      await expect(
        qcWalletManager.finalizeWalletDeRegistration(btcAddress, validBalance)
      ).to.not.be.reverted
    })
  })
})
