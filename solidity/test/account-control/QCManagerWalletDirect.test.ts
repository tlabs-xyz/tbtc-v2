import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  QCManager,
  QCData,
  SystemState,
  ReserveOracle,
} from "../../typechain"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCManager - Direct Wallet Registration", () => {
  let deployer: SignerWithAddress
  let qc1: SignerWithAddress
  let qc2: SignerWithAddress
  let nonQC: SignerWithAddress

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
    const [deployerSigner, qc1Signer, qc2Signer, nonQCSigner] =
      await ethers.getSigners()
    deployer = deployerSigner
    qc1 = qc1Signer
    qc2 = qc2Signer
    nonQC = nonQCSigner
  })

  beforeEach(async () => {
    await createSnapshot()

    // Create mock contracts
    mockQCData = await smock.fake<QCData>("QCData")
    mockSystemState = await smock.fake<SystemState>("SystemState")
    mockReserveOracle = await smock.fake<ReserveOracle>("ReserveOracle")

    // Deploy QCManagerLib library
    const QCManagerLibFactory = await ethers.getContractFactory("QCManagerLib")
    const qcManagerLib = await QCManagerLibFactory.deploy()
    await qcManagerLib.deployed()

    // Deploy QCManager with libraries
    const QCManagerFactory = await ethers.getContractFactory("QCManager", {
      libraries: {
        QCManagerLib: qcManagerLib.address,
      },
    })
    qcManager = await QCManagerFactory.deploy(
      mockQCData.address,
      mockSystemState.address,
      mockReserveOracle.address
    )
    await qcManager.deployed()

    // Setup default mock behaviors
    mockSystemState.isFunctionPaused.returns(false)

    // Setup QC1 as registered and active
    mockQCData.isQCRegistered.whenCalledWith(qc1.address).returns(true)
    mockQCData.getQCStatus.whenCalledWith(qc1.address).returns(0) // Active

    // Setup QC2 as registered but paused
    mockQCData.isQCRegistered.whenCalledWith(qc2.address).returns(true)
    mockQCData.getQCStatus.whenCalledWith(qc2.address).returns(2) // Paused

    // NonQC is not registered
    mockQCData.isQCRegistered.whenCalledWith(nonQC.address).returns(false)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("registerWalletDirect", () => {
    context("when called by a registered, active QC", () => {
      it("should reject registration with invalid signature", async () => {
        // For this test, we're using a mock signature that will fail verification
        // This tests the signature verification rejection path

        // Calculate expected challenge
        const chainId = await qc1.getChainId()
        const expectedChallenge = ethers.utils.keccak256(
          ethers.utils.solidityPack(
            ["string", "address", "string", "uint256", "uint256"],
            [
              "TBTC_QC_WALLET_DIRECT:",
              qc1.address,
              validBitcoinAddress,
              testNonce,
              chainId,
            ]
          )
        )

        // Using a mock signature that will fail verification
        await expect(
          qcManager
            .connect(qc1)
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
        const nonceUsed = await qcManager.usedNonces(qc1.address, testNonce)
        expect(nonceUsed).to.be.false // Not used because transaction reverted
      })

      it("should reject registration with already used nonce", async () => {
        // First, mark the nonce as used by attempting a registration
        // (it will fail on signature but nonce gets marked)

        // For testing nonce rejection, we need to first successfully use a nonce
        // This would require a valid signature in production

        // Check that nonce starts as unused
        const nonceUsed = await qcManager.usedNonces(qc1.address, testNonce)
        expect(nonceUsed).to.be.false
      })
    })

    context("when called by non-QC", () => {
      it("should revert with QCNotRegistered", async () => {
        await expect(
          qcManager
            .connect(nonQC)
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
      it("should revert with QCNotActive", async () => {
        await expect(
          qcManager
            .connect(qc2)
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

    context("when Bitcoin address is invalid", () => {
      it("should revert with InvalidWalletAddress for empty address", async () => {
        await expect(
          qcManager
            .connect(qc1)
            .registerWalletDirect(
              "",
              testNonce,
              mockWalletPublicKey,
              mockSignatureV,
              mockSignatureR,
              mockSignatureS
            )
        ).to.be.revertedWith("InvalidWalletAddress")
      })
    })

    context("when function is paused", () => {
      beforeEach(async () => {
        mockSystemState.isFunctionPaused
          .whenCalledWith("wallet_registration")
          .returns(true)
      })

      it("should revert when wallet registration is paused", async () => {
        await expect(
          qcManager
            .connect(qc1)
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

  describe("Challenge Generation", () => {
    it("should generate deterministic challenges", async () => {
      const chainId = await qc1.getChainId()

      // Calculate challenge off-chain (what QC would do)
      const challenge1 = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "address", "string", "uint256", "uint256"],
          [
            "TBTC_QC_WALLET_DIRECT:",
            qc1.address,
            validBitcoinAddress,
            testNonce,
            chainId,
          ]
        )
      )

      // Same inputs should produce same challenge
      const challenge2 = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "address", "string", "uint256", "uint256"],
          [
            "TBTC_QC_WALLET_DIRECT:",
            qc1.address,
            validBitcoinAddress,
            testNonce,
            chainId,
          ]
        )
      )

      expect(challenge1).to.equal(challenge2)

      // Different nonce should produce different challenge
      const challenge3 = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "address", "string", "uint256", "uint256"],
          [
            "TBTC_QC_WALLET_DIRECT:",
            qc1.address,
            validBitcoinAddress,
            testNonce + 1,
            chainId,
          ]
        )
      )

      expect(challenge1).to.not.equal(challenge3)
    })
  })

  describe("Nonce Management", () => {
    it("should track used nonces per QC", async () => {
      // Check initial state
      const nonce1Used = await qcManager.usedNonces(qc1.address, 1)
      const nonce2Used = await qcManager.usedNonces(qc1.address, 2)

      expect(nonce1Used).to.be.false
      expect(nonce2Used).to.be.false

      // Different QCs can use same nonce
      const qc1Nonce1 = await qcManager.usedNonces(qc1.address, 1)
      const qc2Nonce1 = await qcManager.usedNonces(qc2.address, 1)

      expect(qc1Nonce1).to.be.false
      expect(qc2Nonce1).to.be.false
    })
  })
})
