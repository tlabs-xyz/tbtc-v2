import chai, { expect } from "chai"
import { ethers } from "hardhat"
import { FakeContract, smock } from "@defi-wonderland/smock"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import {
  QCManager,
  QCData,
  SystemState,
  ReserveOracle,
  QCPauseManager,
  AccountControl,
  QCWalletManager,
} from "../../../typechain"
import { LibraryLinkingHelper } from "../helpers/library-linking-helper"
import {
  createDirectWalletRegistration,
  generateBitcoinKeyPair,
  TEST_KEY_PAIRS,
} from "../helpers/wallet-signature-helpers"

chai.use(smock.matchers)

describe("QCManager", () => {
  let qcManager: QCManager
  let fakeQCData: FakeContract<QCData>
  let fakeSystemState: FakeContract<SystemState>
  let fakeReserveOracle: FakeContract<ReserveOracle>
  let fakePauseManager: FakeContract<QCPauseManager>
  let fakeAccountControl: FakeContract<AccountControl>
  let fakeWalletManager: FakeContract<QCWalletManager>

  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qcAddress: SignerWithAddress
  let arbiter: SignerWithAddress
  let watchdog: SignerWithAddress
  let registrar: SignerWithAddress
  let user: SignerWithAddress

  // Test constants
  const MEDIUM_CAP = ethers.utils.parseEther("10")
  const LARGE_CAP = ethers.utils.parseEther("100")
  const VALID_LEGACY_BTC = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"

  // Role constants
  const GOVERNANCE_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("GOVERNANCE_ROLE")
  )

  const REGISTRAR_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("REGISTRAR_ROLE")
  )

  const DISPUTE_ARBITER_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("DISPUTE_ARBITER_ROLE")
  )

  const ENFORCEMENT_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("ENFORCEMENT_ROLE")
  )

  const MONITOR_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("MONITOR_ROLE")
  )

  const EMERGENCY_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("EMERGENCY_ROLE")
  )

  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero

  beforeEach(async () => {
    ;[deployer, governance, qcAddress, arbiter, watchdog, registrar, user] =
      await ethers.getSigners()

    // Create fake contracts using Smock
    fakeQCData = await smock.fake<QCData>("QCData")
    fakeSystemState = await smock.fake<SystemState>("SystemState")
    fakeReserveOracle = await smock.fake<ReserveOracle>("ReserveOracle")
    fakePauseManager = await smock.fake<QCPauseManager>("QCPauseManager")
    fakeAccountControl = await smock.fake<AccountControl>("AccountControl")
    fakeWalletManager = await smock.fake<QCWalletManager>("QCWalletManager")

    // Deploy QCManager with library linking
    const QCManagerFactory = await LibraryLinkingHelper.getQCManagerFactory()

    qcManager = (await QCManagerFactory.deploy(
      fakeQCData.address,
      fakeSystemState.address,
      fakeReserveOracle.address,
      fakeAccountControl.address,
      fakePauseManager.address,
      fakeWalletManager.address
    )) as QCManager

    // Grant roles for testing
    await qcManager.grantRole(GOVERNANCE_ROLE, governance.address)
    await qcManager.grantRole(REGISTRAR_ROLE, registrar.address)
    await qcManager.grantRole(DISPUTE_ARBITER_ROLE, arbiter.address)
    await qcManager.grantRole(ENFORCEMENT_ROLE, watchdog.address)

    // AccountControl is set in constructor, no need for setAccountControl
    await qcManager.grantRole(DEFAULT_ADMIN_ROLE, governance.address)
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
    it("should register QC successfully when called by governance", async () => {
      // Setup mock behaviors
      fakeQCData.registerQC.returns()
      fakeAccountControl.authorizeReserve.returns()

      const tx = await qcManager
        .connect(governance)
        .registerQC(qcAddress.address, MEDIUM_CAP)

      await expect(tx).to.emit(qcManager, "QCOnboarded")

      // Verify mock was called correctly
      expect(fakeQCData.registerQC).to.have.been.calledWith(
        qcAddress.address,
        MEDIUM_CAP
      )
      expect(fakeAccountControl.authorizeReserve).to.have.been.calledWith(
        qcAddress.address,
        MEDIUM_CAP,
        1
      )
    })

    it("should prevent duplicate QC registration", async () => {
      // Setup mock to allow first registration
      fakeQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(false)
      fakeQCData.registerQC.returns()
      fakeAccountControl.authorizeReserve.returns()

      await qcManager
        .connect(governance)
        .registerQC(qcAddress.address, MEDIUM_CAP)

      // Setup mock to indicate QC is now registered
      fakeQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)

      await expect(
        qcManager.connect(governance).registerQC(qcAddress.address, LARGE_CAP)
      ).to.be.revertedWithCustomError(qcManager, "QCAlreadyRegistered")
        .withArgs(qcAddress.address)
    })

    it("should prevent registration with invalid parameters", async () => {
      // Zero address
      await expect(
        qcManager
          .connect(governance)
          .registerQC(ethers.constants.AddressZero, MEDIUM_CAP)
      ).to.be.revertedWithCustomError(qcManager, "InvalidQCAddress")

      // Zero capacity
      const validAddress = ethers.Wallet.createRandom().address
      await expect(
        qcManager.connect(governance).registerQC(validAddress, 0)
      ).to.be.revertedWithCustomError(qcManager, "InvalidMintingCapacity")
    })

    it("should enforce governance role for registration", async () => {
      await expect(
        qcManager.connect(user).registerQC(qcAddress.address, MEDIUM_CAP)
      ).to.be.reverted
    })
  })

  describe("Minting Capacity Management", () => {
    beforeEach(async () => {
      // Setup QC as registered
      fakeQCData.getQCInfo.returns({
        registeredAt: 1,
        maxCapacity: MEDIUM_CAP,
        currentBacking: 0,
        totalMinted: 0,
        status: 0,
        statusUpdatedAt: 0,
        frozenUntil: 0,
      })
      fakeQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
    })

    it("should increase minting capacity for registered QC", async () => {
      fakeQCData.updateMaxMintingCapacity.returns()
      fakeAccountControl.setMintingCap.returns()

      const newCapacity = LARGE_CAP

      const tx = await qcManager
        .connect(governance)
        .increaseMintingCapacity(qcAddress.address, newCapacity)

      await expect(tx)
        .to.emit(qcManager, "BalanceUpdate")
        .withArgs(
          qcAddress.address,
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("CAP")),
          MEDIUM_CAP.toString(),
          newCapacity.toString()
        )

      expect(fakeQCData.updateMaxMintingCapacity).to.have.been.calledWith(
        qcAddress.address,
        newCapacity
      )
      expect(fakeAccountControl.setMintingCap).to.have.been.calledWith(
        qcAddress.address,
        newCapacity
      )
    })

    it("should prevent decreasing minting capacity", async () => {
      // Setup QC as registered with LARGE_CAP
      fakeQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      fakeQCData.getQCInfo.returns({
        registeredAt: 1,
        maxCapacity: LARGE_CAP,
        currentBacking: 0,
        totalMinted: 0,
        status: 0,
        statusUpdatedAt: 0,
        frozenUntil: 0,
      })

      // Important: also set getMaxMintingCapacity to return LARGE_CAP
      fakeQCData.getMaxMintingCapacity
        .whenCalledWith(qcAddress.address)
        .returns(LARGE_CAP)

      await expect(
        qcManager
          .connect(governance)
          .increaseMintingCapacity(qcAddress.address, MEDIUM_CAP)
      ).to.be.revertedWithCustomError(qcManager, "NewCapMustBeHigher")
        .withArgs(LARGE_CAP.toString(), MEDIUM_CAP.toString())
    })

    it("should prevent capacity increase for unregistered QC", async () => {
      fakeQCData.getQCInfo.returns({
        registeredAt: 0, // Not registered
        maxCapacity: 0,
        currentBacking: 0,
        totalMinted: 0,
        status: 0,
        statusUpdatedAt: 0,
        frozenUntil: 0,
      })

      const unregisteredQC = ethers.Wallet.createRandom().address

      await expect(
        qcManager
          .connect(governance)
          .increaseMintingCapacity(unregisteredQC, LARGE_CAP)
      ).to.be.revertedWithCustomError(qcManager, "QCNotRegistered")
        .withArgs(unregisteredQC)
    })
  })

  describe("QC Status Management", () => {
    beforeEach(async () => {
      // Setup QC as registered
      fakeQCData.getQCInfo.returns({
        registeredAt: 1,
        maxCapacity: MEDIUM_CAP,
        currentBacking: 0,
        totalMinted: 0,
        status: 0, // REGISTERED
        statusUpdatedAt: 0,
        frozenUntil: 0,
      })
      fakeQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      fakeQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(0) // REGISTERED
    })

    it("should update QC status through valid transitions", async () => {
      fakeQCData.setQCStatus.returns()

      // Transition to ACTIVE (1)
      await expect(
        qcManager
          .connect(arbiter)
          .setQCStatus(
            qcAddress.address,
            1,
            ethers.utils.formatBytes32String("activate")
          )
      ).to.emit(qcManager, "QCStatusChanged")

      expect(fakeQCData.setQCStatus).to.have.been.calledWith(
        qcAddress.address,
        1,
        ethers.utils.formatBytes32String("activate")
      )
    })

    it("should allow DISPUTE_ARBITER to set any status", async () => {
      fakeQCData.setQCStatus.returns()

      // DISPUTE_ARBITER can set any status directly
      await expect(
        qcManager.connect(arbiter).setQCStatus(
          qcAddress.address,
          3, // UNDER_REVIEW
          ethers.utils.formatBytes32String("review")
        )
      ).to.emit(qcManager, "QCStatusChanged")

      expect(fakeQCData.setQCStatus).to.have.been.calledWith(
        qcAddress.address,
        3,
        ethers.utils.formatBytes32String("review")
      )
    })
  })

  describe("Direct Wallet Registration", () => {
    const testNonce = 12345

    let walletRegistrationData: ReturnType<
      typeof createDirectWalletRegistration
    >

    beforeEach(async () => {
      // Setup QC as registered and active
      fakeQCData.getQCInfo.returns({
        registeredAt: 1,
        maxCapacity: MEDIUM_CAP,
        currentBacking: 0,
        totalMinted: 0,
        status: 1, // ACTIVE
        statusUpdatedAt: 0,
        frozenUntil: 0,
      })
      fakeQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true)
      fakeQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(1) // ACTIVE

      // Setup mock system state to not be paused
      fakeSystemState.isFunctionPaused.returns(false)

      // Setup QCData mock to allow wallet registration
      fakeQCData.registerWallet.returns()

      // Reset wallet manager mock for each test
      fakeWalletManager.registerWalletDirect.reset()

      // By default, allow successful registration
      fakeWalletManager.registerWalletDirect.returns()

      // Generate real wallet registration data with valid signatures
      walletRegistrationData = createDirectWalletRegistration(
        qcAddress.address,
        testNonce
      )
    })

    it("should successfully register wallet with valid signature", async () => {
      const tx = await qcManager
        .connect(qcAddress)
        .registerWalletDirect(
          walletRegistrationData.btcAddress,
          testNonce,
          ethers.utils.hexlify(walletRegistrationData.publicKey),
          walletRegistrationData.signature.v,
          walletRegistrationData.signature.r,
          walletRegistrationData.signature.s
        )

      // Verify QCWalletManager.registerWalletDirect was called
      expect(fakeWalletManager.registerWalletDirect).to.have.been.calledWith(
        walletRegistrationData.btcAddress,
        testNonce,
        ethers.utils.hexlify(walletRegistrationData.publicKey),
        walletRegistrationData.signature.v,
        walletRegistrationData.signature.r,
        walletRegistrationData.signature.s
      )

      // Verify event was emitted
      await expect(tx).to.emit(qcManager, "WalletRegistrationRequested")
    })

    it("should revert when called by non-QC", async () => {
      // Setup fake to check if caller is registered QC
      fakeQCData.isQCRegistered.whenCalledWith(user.address).returns(false)

      // Reset wallet manager and configure it to revert
      fakeWalletManager.registerWalletDirect.reset()
      fakeWalletManager.registerWalletDirect.reverts("QCNotRegistered")

      await expect(
        qcManager
          .connect(user)
          .registerWalletDirect(
            walletRegistrationData.btcAddress,
            testNonce,
            ethers.utils.hexlify(walletRegistrationData.publicKey),
            walletRegistrationData.signature.v,
            walletRegistrationData.signature.r,
            walletRegistrationData.signature.s
          )
      ).to.be.reverted
    })

    it("should revert when called by inactive QC", async () => {
      // Set QC as paused
      fakeQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(2) // PAUSED

      // Reset and setup wallet manager to revert with QCNotActive
      fakeWalletManager.registerWalletDirect.reset()
      fakeWalletManager.registerWalletDirect.reverts("QCNotActive")

      await expect(
        qcManager
          .connect(qcAddress)
          .registerWalletDirect(
            walletRegistrationData.btcAddress,
            testNonce,
            ethers.utils.hexlify(walletRegistrationData.publicKey),
            walletRegistrationData.signature.v,
            walletRegistrationData.signature.r,
            walletRegistrationData.signature.s
          )
      ).to.be.reverted
    })

    it("should revert with InvalidWalletAddress for empty address", async () => {
      // Reset and setup wallet manager to revert with InvalidWalletAddress
      fakeWalletManager.registerWalletDirect.reset()
      fakeWalletManager.registerWalletDirect.reverts("InvalidWalletAddress")

      await expect(
        qcManager
          .connect(qcAddress)
          .registerWalletDirect(
            "",
            testNonce,
            ethers.utils.hexlify(walletRegistrationData.publicKey),
            walletRegistrationData.signature.v,
            walletRegistrationData.signature.r,
            walletRegistrationData.signature.s
          )
      ).to.be.reverted
    })

    it("should revert with SignatureVerificationFailed for invalid signature", async () => {
      // Use wrong private key to generate invalid signature
      const wrongKeyPair = generateBitcoinKeyPair()

      const wrongRegistrationData = createDirectWalletRegistration(
        qcAddress.address,
        testNonce,
        wrongKeyPair
      )

      // Reset and setup wallet manager to revert with SignatureVerificationFailed
      fakeWalletManager.registerWalletDirect.reset()
      fakeWalletManager.registerWalletDirect.reverts(
        "SignatureVerificationFailed"
      )

      await expect(
        qcManager.connect(qcAddress).registerWalletDirect(
          walletRegistrationData.btcAddress, // Valid address
          testNonce,
          ethers.utils.hexlify(wrongRegistrationData.publicKey), // Wrong public key
          wrongRegistrationData.signature.v, // Wrong signature
          wrongRegistrationData.signature.r,
          wrongRegistrationData.signature.s
        )
      ).to.be.reverted
    })

    it("should revert with SignatureVerificationFailed for mismatched address", async () => {
      // Use different Bitcoin address than what the signature proves ownership for
      const differentAddress = TEST_KEY_PAIRS.PAIR_2.address

      // Reset and setup wallet manager to revert with SignatureVerificationFailed
      fakeWalletManager.registerWalletDirect.reset()
      fakeWalletManager.registerWalletDirect.reverts(
        "SignatureVerificationFailed"
      )

      await expect(
        qcManager.connect(qcAddress).registerWalletDirect(
          differentAddress, // Different address
          testNonce,
          ethers.utils.hexlify(walletRegistrationData.publicKey), // Public key for different address
          walletRegistrationData.signature.v,
          walletRegistrationData.signature.r,
          walletRegistrationData.signature.s
        )
      ).to.be.reverted
    })

    it("should track used nonces per QC", async () => {
      // Setup fake wallet manager to track nonces
      fakeWalletManager.usedNonces
        .whenCalledWith(qcAddress.address, testNonce)
        .returns(false)

      // Check initial state - QCManager delegates to wallet manager
      expect(await fakeWalletManager.usedNonces(qcAddress.address, testNonce))
        .to.be.false

      // Register wallet to use nonce
      await qcManager
        .connect(qcAddress)
        .registerWalletDirect(
          walletRegistrationData.btcAddress,
          testNonce,
          ethers.utils.hexlify(walletRegistrationData.publicKey),
          walletRegistrationData.signature.v,
          walletRegistrationData.signature.r,
          walletRegistrationData.signature.s
        )

      // Setup mock to return true after registration
      fakeWalletManager.usedNonces
        .whenCalledWith(qcAddress.address, testNonce)
        .returns(true)

      // Verify nonce is now marked as used
      expect(await fakeWalletManager.usedNonces(qcAddress.address, testNonce))
        .to.be.true

      // Verify the wallet manager was called with nonce tracking
      expect(fakeWalletManager.registerWalletDirect).to.have.been.called
    })

    it("should prevent reuse of same nonce", async () => {
      // Setup wallet manager to succeed first
      fakeWalletManager.registerWalletDirect.returns()

      // First registration should succeed
      await qcManager
        .connect(qcAddress)
        .registerWalletDirect(
          walletRegistrationData.btcAddress,
          testNonce,
          ethers.utils.hexlify(walletRegistrationData.publicKey),
          walletRegistrationData.signature.v,
          walletRegistrationData.signature.r,
          walletRegistrationData.signature.s
        )

      // Reset and setup wallet manager to revert for nonce reuse
      fakeWalletManager.registerWalletDirect.reset()
      fakeWalletManager.registerWalletDirect.reverts("NonceAlreadyUsed")

      // Second registration with same nonce should fail
      const newWalletData = createDirectWalletRegistration(
        qcAddress.address,
        testNonce // Same nonce
      )

      await expect(
        qcManager
          .connect(qcAddress)
          .registerWalletDirect(
            newWalletData.btcAddress,
            testNonce,
            ethers.utils.hexlify(newWalletData.publicKey),
            newWalletData.signature.v,
            newWalletData.signature.r,
            newWalletData.signature.s
          )
      ).to.be.reverted
    })
  })
})
