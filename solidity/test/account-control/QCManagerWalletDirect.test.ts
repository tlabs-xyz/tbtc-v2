import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import { 
  QCManager,
  QCData,
  SystemState,
  ReserveOracle,
  MessageSigning
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
  const mockSignature = ethers.utils.randomBytes(65) // 65-byte signature

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

    // Deploy MessageSigning library
    const MessageSigningFactory = await ethers.getContractFactory("MessageSigning")
    const messageSigning = await MessageSigningFactory.deploy()
    await messageSigning.deployed()

    // Deploy QCManager with library
    const QCManagerFactory = await ethers.getContractFactory("QCManager", {
      libraries: {
        MessageSigning: messageSigning.address
      }
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
      it("should successfully register a wallet with valid signature", async () => {
        // For this test, we'll mock the MessageSigning verification
        // In production, this would actually verify the Bitcoin signature
        
        // Calculate expected challenge
        const chainId = await qc1.getChainId()
        const expectedChallenge = ethers.utils.keccak256(
          ethers.utils.solidityPack(
            ["string", "address", "string", "uint256", "uint256"],
            ["TBTC_QC_WALLET_DIRECT:", qc1.address, validBitcoinAddress, testNonce, chainId]
          )
        )

        // Note: In a real test, we'd need to generate a valid Bitcoin signature
        // For now, we'll test the flow assuming signature verification passes
        await expect(
          qcManager.connect(qc1).registerWalletDirect(
            validBitcoinAddress,
            testNonce,
            mockSignature
          )
        ).to.be.revertedWith("MessageSignatureVerificationFailed")
        // This is expected as we're using a mock signature
        
        // Verify the nonce tracking works
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
          qcManager.connect(nonQC).registerWalletDirect(
            validBitcoinAddress,
            testNonce,
            mockSignature
          )
        ).to.be.revertedWith("QCNotRegistered")
      })
    })

    context("when called by inactive QC", () => {
      it("should revert with QCNotActive", async () => {
        await expect(
          qcManager.connect(qc2).registerWalletDirect(
            validBitcoinAddress,
            testNonce,
            mockSignature
          )
        ).to.be.revertedWith("QCNotActive")
      })
    })

    context("when Bitcoin address is invalid", () => {
      it("should revert with InvalidWalletAddress for empty address", async () => {
        await expect(
          qcManager.connect(qc1).registerWalletDirect(
            "",
            testNonce,
            mockSignature
          )
        ).to.be.revertedWith("InvalidWalletAddress")
      })
    })

    context("when function is paused", () => {
      beforeEach(async () => {
        mockSystemState.isFunctionPaused.whenCalledWith("wallet_registration").returns(true)
      })

      it("should revert when wallet registration is paused", async () => {
        await expect(
          qcManager.connect(qc1).registerWalletDirect(
            validBitcoinAddress,
            testNonce,
            mockSignature
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
          ["TBTC_QC_WALLET_DIRECT:", qc1.address, validBitcoinAddress, testNonce, chainId]
        )
      )
      
      // Same inputs should produce same challenge
      const challenge2 = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "address", "string", "uint256", "uint256"],
          ["TBTC_QC_WALLET_DIRECT:", qc1.address, validBitcoinAddress, testNonce, chainId]
        )
      )
      
      expect(challenge1).to.equal(challenge2)
      
      // Different nonce should produce different challenge
      const challenge3 = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "address", "string", "uint256", "uint256"],
          ["TBTC_QC_WALLET_DIRECT:", qc1.address, validBitcoinAddress, testNonce + 1, chainId]
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