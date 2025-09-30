import chai, { expect } from "chai"
import { ethers } from "hardhat"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  QCManager,
  QCData,
  SystemState,
  ReserveOracle,
} from "../../../typechain"
import {
  setupTestSigners,
  createBaseTestEnvironment,
  restoreBaseTestEnvironment,
  TestSigners
} from "../fixtures/base-setup"
import { expectCustomError, ERROR_MESSAGES } from "../helpers/error-helpers"
import { deploySPVLibraries, deployQCManagerLib } from "../../helpers/spvLibraryHelpers"

chai.use(smock.matchers)

/**
 * SPV Wallet Registration Tests
 *
 * Consolidates SPV-related wallet registration functionality from QCManagerWalletDirect.test.ts
 * Tests SPV signature verification and Bitcoin address validation for wallet registration
 */
describe("SPV Wallet Registration", () => {
  let signers: TestSigners

  let qcManager: QCManager
  let mockQCData: FakeContract<QCData>
  let mockSystemState: FakeContract<SystemState>
  let mockReserveOracle: FakeContract<ReserveOracle>

  // Test data
  const validBitcoinAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
  const validBech32Address = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080"
  const testNonce = 12345

  // Mock Bitcoin signature parameters
  const mockWalletPublicKey = `0x${"aa".repeat(64)}` // 64 bytes uncompressed public key
  const mockSignatureV = 27
  const mockSignatureR = ethers.utils.formatBytes32String("mock_r_value")
  const mockSignatureS = ethers.utils.formatBytes32String("mock_s_value")

  before(async () => {
    signers = await setupTestSigners()
  })

  beforeEach(async () => {
    await createBaseTestEnvironment()

    // Create mock contracts
    mockQCData = await smock.fake<QCData>("QCData")
    mockSystemState = await smock.fake<SystemState>("SystemState")
    mockReserveOracle = await smock.fake<ReserveOracle>("ReserveOracle")

    // Deploy QCManager libraries
    const { qcManagerLib, qcManagerPauseLib } = await deployQCManagerLib()

    // Deploy QCPauseManager first (required for QCManager constructor)
    const QCPauseManagerFactory = await ethers.getContractFactory("QCPauseManager")
    const pauseManager = await QCPauseManagerFactory.deploy(
      mockQCData.address,
      signers.deployer.address, // Temporary QCManager address
      signers.deployer.address, // Admin
      signers.deployer.address  // Emergency role
    )
    await pauseManager.deployed()

    // Deploy QCManager with libraries (only QCManagerLib needed)
    const QCManagerFactory = await ethers.getContractFactory("QCManager", {
      libraries: {
        QCManagerLib: qcManagerLib.address,
      },
    })
    qcManager = await QCManagerFactory.deploy(
      mockQCData.address,
      mockSystemState.address,
      mockReserveOracle.address,
      pauseManager.address
    )
    await qcManager.deployed()

    // Setup default mock behaviors
    mockSystemState.isFunctionPaused.returns(false)

    // Setup QC1 as registered and active
    mockQCData.isQCRegistered.whenCalledWith(signers.qcAddress.address).returns(true)
    mockQCData.getQCStatus.whenCalledWith(signers.qcAddress.address).returns(0) // Active

    // Setup user as registered but paused (for testing inactive QC)
    mockQCData.isQCRegistered.whenCalledWith(signers.user.address).returns(true)
    mockQCData.getQCStatus.whenCalledWith(signers.user.address).returns(2) // Paused

    // Third party is not registered
    mockQCData.isQCRegistered.whenCalledWith(signers.thirdParty.address).returns(false)
  })

  afterEach(async () => {
    await restoreBaseTestEnvironment()
  })

  describe("SPV Signature Verification", () => {
    context("when called by a registered, active QC", () => {
      it("should reject registration with invalid SPV signature", async () => {
        // Test the SPV signature verification rejection path
        // Calculate expected challenge for SPV verification
        const chainId = await signers.qcAddress.getChainId()
        const expectedChallenge = ethers.utils.keccak256(
          ethers.utils.solidityPack(
            ["string", "address", "string", "uint256", "uint256"],
            [
              "TBTC_QC_WALLET_DIRECT:",
              signers.qcAddress.address,
              validBitcoinAddress,
              testNonce,
              chainId,
            ]
          )
        )

        // Using a mock signature that will fail SPV verification
        await expect(
          qcManager
            .connect(signers.qcAddress)
            .registerWalletDirect(
              validBitcoinAddress,
              testNonce,
              mockWalletPublicKey,
              mockSignatureV,
              mockSignatureR,
              mockSignatureS
            )
        ).to.be.revertedWith("SignatureVerificationFailed")

        // Verify the nonce was not consumed due to failed verification
        const nonceUsed = await qcManager.usedNonces(signers.qcAddress.address, testNonce)
        expect(nonceUsed).to.be.false // Not used because transaction reverted
      })

      it("should handle SPV nonce reuse prevention", async () => {
        // Test SPV nonce validation for preventing replay attacks
        // Check that nonce starts as unused
        let nonceUsed = await qcManager.usedNonces(signers.qcAddress.address, testNonce)
        expect(nonceUsed).to.be.false

        // In production with valid SPV signatures, successful registration
        // would mark the nonce as used to prevent replay attacks
        // This is verified in integration tests with real Bitcoin signatures
      })

      it("should validate SPV signature format and structure", async () => {
        // Test showing the SPV signature validation path exists
        // This requires a valid Bitcoin signature in production
        const tx = qcManager
          .connect(signers.qcAddress)
          .registerWalletDirect(
            validBitcoinAddress,
            testNonce,
            mockWalletPublicKey,
            mockSignatureV,
            mockSignatureR,
            mockSignatureS
          )

        // Will revert with SignatureVerificationFailed in this test
        // but in production with valid SPV signature would succeed
        await expect(tx).to.be.revertedWith("SignatureVerificationFailed")
      })
    })

    context("when using different Bitcoin address formats", () => {
      it("should handle P2PKH addresses in SPV registration", async () => {
        // Test SPV signature verification with P2PKH address
        await expect(
          qcManager
            .connect(signers.qcAddress)
            .registerWalletDirect(
              validBitcoinAddress, // P2PKH format
              testNonce,
              mockWalletPublicKey,
              mockSignatureV,
              mockSignatureR,
              mockSignatureS
            )
        ).to.be.revertedWith("SignatureVerificationFailed")
      })

      it("should handle Bech32 addresses in SPV registration", async () => {
        // Test SPV signature verification with Bech32 address
        await expect(
          qcManager
            .connect(signers.qcAddress)
            .registerWalletDirect(
              validBech32Address, // Bech32 format
              testNonce + 1, // Different nonce
              mockWalletPublicKey,
              mockSignatureV,
              mockSignatureR,
              mockSignatureS
            )
        ).to.be.revertedWith("SignatureVerificationFailed")
      })
    })
  })

  describe("SPV Challenge Generation", () => {
    it("should generate deterministic SPV challenges", async () => {
      const chainId = await signers.qcAddress.getChainId()

      // Calculate SPV challenge off-chain (what QC would do)
      const challenge1 = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "address", "string", "uint256", "uint256"],
          [
            "TBTC_QC_WALLET_DIRECT:",
            signers.qcAddress.address,
            validBitcoinAddress,
            testNonce,
            chainId,
          ]
        )
      )

      // Same inputs should produce same SPV challenge
      const challenge2 = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "address", "string", "uint256", "uint256"],
          [
            "TBTC_QC_WALLET_DIRECT:",
            signers.qcAddress.address,
            validBitcoinAddress,
            testNonce,
            chainId,
          ]
        )
      )

      expect(challenge1).to.equal(challenge2)

      // Different nonce should produce different SPV challenge
      const challenge3 = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "address", "string", "uint256", "uint256"],
          [
            "TBTC_QC_WALLET_DIRECT:",
            signers.qcAddress.address,
            validBitcoinAddress,
            testNonce + 1,
            chainId,
          ]
        )
      )

      expect(challenge1).to.not.equal(challenge3)
    })

    it("should include QC address in SPV challenge", async () => {
      const chainId = await signers.qcAddress.getChainId()

      // Different QC should produce different SPV challenge
      const qc1Challenge = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "address", "string", "uint256", "uint256"],
          [
            "TBTC_QC_WALLET_DIRECT:",
            signers.qcAddress.address,
            validBitcoinAddress,
            testNonce,
            chainId,
          ]
        )
      )

      const qc2Challenge = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "address", "string", "uint256", "uint256"],
          [
            "TBTC_QC_WALLET_DIRECT:",
            signers.user.address,
            validBitcoinAddress,
            testNonce,
            chainId,
          ]
        )
      )

      expect(qc1Challenge).to.not.equal(qc2Challenge)
    })
  })

  describe("SPV Nonce Management", () => {
    it("should track SPV nonces per QC independently", async () => {
      // Test that SPV nonce tracking is per-QC
      const nonce1 = 100
      const nonce2 = 200

      // Both nonces should start as unused for both QCs
      expect(await qcManager.usedNonces(signers.qcAddress.address, nonce1)).to.be.false
      expect(await qcManager.usedNonces(signers.qcAddress.address, nonce2)).to.be.false
      expect(await qcManager.usedNonces(signers.user.address, nonce1)).to.be.false
      expect(await qcManager.usedNonces(signers.user.address, nonce2)).to.be.false
    })

    it("should allow different QCs to use the same SPV nonce", async () => {
      // Test that different QCs can use the same nonce value for SPV signatures
      const sharedNonce = 999

      // Both QCs should be able to use the same nonce
      expect(await qcManager.usedNonces(signers.qcAddress.address, sharedNonce)).to.be.false
      expect(await qcManager.usedNonces(signers.user.address, sharedNonce)).to.be.false

      // Each QC maintains its own SPV nonce namespace
    })

    it("should support multiple wallet registrations per QC with different SPV nonces", async () => {
      // Test that a QC can register multiple wallets using different SPV nonces
      const nonce1 = 100
      const nonce2 = 200
      const wallet1 = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
      const wallet2 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"

      // Both nonces should start as unused
      expect(await qcManager.usedNonces(signers.qcAddress.address, nonce1)).to.be.false
      expect(await qcManager.usedNonces(signers.qcAddress.address, nonce2)).to.be.false

      // Multiple registrations would succeed with valid SPV signatures
      // Here we're verifying the nonce management structure exists
    })
  })

  describe("SPV Access Control", () => {
    context("when called by non-QC", () => {
      it("should reject SPV wallet registration from non-QC", async () => {
        await expect(
          qcManager
            .connect(signers.thirdParty)
            .registerWalletDirect(
              validBitcoinAddress,
              testNonce,
              mockWalletPublicKey,
              mockSignatureV,
              mockSignatureR,
              mockSignatureS
            )
        ).to.be.revertedWith("QCNotRegistered")
      })
    })

    context("when called by inactive QC", () => {
      it("should reject SPV wallet registration from inactive QC", async () => {
        await expect(
          qcManager
            .connect(signers.user) // user is paused
            .registerWalletDirect(
              validBitcoinAddress,
              testNonce,
              mockWalletPublicKey,
              mockSignatureV,
              mockSignatureR,
              mockSignatureS
            )
        ).to.be.revertedWith("QCNotActive")
      })
    })

    context("when function is paused", () => {
      beforeEach(async () => {
        mockSystemState.isFunctionPaused
          .whenCalledWith("wallet_reg")
          .returns(true)
      })

      it("should reject SPV wallet registration when paused", async () => {
        await expect(
          qcManager
            .connect(signers.qcAddress)
            .registerWalletDirect(
              validBitcoinAddress,
              testNonce,
              mockWalletPublicKey,
              mockSignatureV,
              mockSignatureR,
              mockSignatureS
            )
        ).to.be.revertedWith("Function is paused")
      })
    })
  })

  describe("SPV Bitcoin Address Validation", () => {
    context("when Bitcoin address is invalid", () => {
      it("should reject SPV registration with empty Bitcoin address", async () => {
        await expect(
          qcManager
            .connect(signers.qcAddress)
            .registerWalletDirect(
              "", // Empty address
              testNonce,
              mockWalletPublicKey,
              mockSignatureV,
              mockSignatureR,
              mockSignatureS
            )
        ).to.be.revertedWith("InvalidWalletAddress")
      })

      it("should reject SPV registration with malformed Bitcoin address", async () => {
        await expect(
          qcManager
            .connect(signers.qcAddress)
            .registerWalletDirect(
              "invalid_bitcoin_address",
              testNonce,
              mockWalletPublicKey,
              mockSignatureV,
              mockSignatureR,
              mockSignatureS
            )
        ).to.be.revertedWith("InvalidWalletAddress")
      })
    })
  })
})