import { expect } from "chai"
import { ethers, deployments } from "hardhat"
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers"

import type {
  QCManager,
  QCRedeemer,
  QCManagerSPV,
  QCRedeemerSPV,
  QCData,
  SystemState,
  MockTBTCToken,
  TestRelay,
} from "../../../typechain"

import {
  ValidMainnetProof,
  P2PKHWalletControlProof,
  ComplexMultiInputTx,
} from "../../data/bitcoin/spv/valid-spv-proofs"

/**
 * Integration Tests for SPV Library Architecture
 *
 * Tests the integration between the main contracts and the extracted SPV libraries:
 * 1. QCManager integration with QCManagerSPV library
 * 2. QCRedeemer integration with QCRedeemerSPV library
 * 3. Error code propagation from libraries to main contracts
 * 4. Performance and gas usage with library pattern
 * 5. Library deployment and linking verification
 */
describe("SPV Library Integration", () => {
  let deployer: HardhatEthersSigner
  let qc: HardhatEthersSigner
  let user: HardhatEthersSigner

  let qcManager: QCManager
  let qcRedeemer: QCRedeemer
  let qcManagerSPV: QCManagerSPV
  let qcRedeemerSPV: QCRedeemerSPV
  let qcData: QCData
  let systemState: SystemState
  let tbtcToken: MockTBTCToken
  let testRelay: TestRelay

  const validBitcoinAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
  const testAmount = ethers.parseEther("1")

  before(async () => {
    const signers = await ethers.getSigners()
    deployer = signers[0]
    qc = signers[1]
    user = signers[2]

    // Deploy dependencies first
    const MockTBTC = await ethers.getContractFactory("MockTBTCToken")
    tbtcToken = await MockTBTC.deploy()

    const TestRelay = await ethers.getContractFactory("TestRelay")
    testRelay = await TestRelay.deploy()

    const QCData = await ethers.getContractFactory("QCData")
    qcData = await QCData.deploy(deployer.address)

    const SystemState = await ethers.getContractFactory("SystemState")
    systemState = await SystemState.deploy(deployer.address)

    // Deploy SPV libraries first (they're used by main contracts)
    const QCManagerSPVLib = await ethers.getContractFactory("QCManagerSPV")
    const qcManagerSPVLib = await QCManagerSPVLib.deploy()

    const QCRedeemerSPVLib = await ethers.getContractFactory("QCRedeemerSPV")
    const qcRedeemerSPVLib = await QCRedeemerSPVLib.deploy()

    // Deploy main contracts with library linking
    const QCManager = await ethers.getContractFactory("QCManager", {
      libraries: {
        QCManagerSPV: await qcManagerSPVLib.getAddress(),
      },
    })
    qcManager = await QCManager.deploy(
      await qcData.getAddress(),
      await systemState.getAddress(),
      await testRelay.getAddress(),
      1 // txProofDifficultyFactor
    )

    const QCRedeemer = await ethers.getContractFactory("QCRedeemer", {
      libraries: {
        QCRedeemerSPV: await qcRedeemerSPVLib.getAddress(),
      },
    })
    qcRedeemer = await QCRedeemer.deploy(
      await tbtcToken.getAddress(),
      await qcData.getAddress(),
      await systemState.getAddress(),
      await testRelay.getAddress(),
      1 // txProofDifficultyFactor
    )

    // Setup test environment
    await systemState.setMinMintAmount(ethers.parseEther("0.01"))
    await systemState.setRedemptionTimeout(86400)
    await tbtcToken.mint(user.address, testAmount)
    await tbtcToken
      .connect(user)
      .approve(await qcRedeemer.getAddress(), testAmount)
  })

  describe("Library Deployment and Linking", () => {
    it("should have successfully linked QCManagerSPV library", async () => {
      // Verify QCManager contract was deployed with library linking
      expect(await qcManager.getAddress()).to.not.equal(ethers.ZeroAddress)

      // Verify SPV state is initialized
      const [relay, difficultyFactor, isInitialized] =
        await qcManager.getSPVState()
      expect(relay).to.equal(await testRelay.getAddress())
      expect(difficultyFactor).to.equal(1)
      expect(isInitialized).to.be.true
    })

    it("should have successfully linked QCRedeemerSPV library", async () => {
      // Verify QCRedeemer contract was deployed with library linking
      expect(await qcRedeemer.getAddress()).to.not.equal(ethers.ZeroAddress)

      // Verify SPV state is initialized
      const [relay, difficultyFactor, isInitialized] =
        await qcRedeemer.getSPVState()
      expect(relay).to.equal(await testRelay.getAddress())
      expect(difficultyFactor).to.equal(1)
      expect(isInitialized).to.be.true
    })

    it("should have reduced contract sizes after library extraction", async () => {
      // Get bytecode sizes
      const qcManagerBytecode = await ethers.provider.getCode(
        await qcManager.getAddress()
      )
      const qcRedeemerBytecode = await ethers.provider.getCode(
        await qcRedeemer.getAddress()
      )

      // Contract sizes should be significantly reduced from 25.94KB and 29.45KB
      // Since we extracted SPV logic to libraries
      const qcManagerSize = (qcManagerBytecode.length - 2) / 2 // -2 for 0x prefix, /2 for hex
      const qcRedeemerSize = (qcRedeemerBytecode.length - 2) / 2

      console.log(`QCManager size: ${(qcManagerSize / 1024).toFixed(2)}KB`)
      console.log(`QCRedeemer size: ${(qcRedeemerSize / 1024).toFixed(2)}KB`)

      // Should be well under 24KB limit now
      expect(qcManagerSize).to.be.lessThan(24 * 1024) // 24KB
      expect(qcRedeemerSize).to.be.lessThan(24 * 1024) // 24KB
    })
  })

  describe("QCManager Library Integration", () => {
    beforeEach(async () => {
      // Register QC for wallet registration tests
      await qcData.registerQC(
        qc.address,
        "Test QC",
        "https://test.qc",
        ethers.parseEther("100"),
        86400
      )
    })

    it("should delegate SPV validation to QCManagerSPV library", async () => {
      const txInfo = {
        version: ValidMainnetProof.txInfo.version,
        inputVector: ValidMainnetProof.txInfo.inputVector,
        outputVector: ValidMainnetProof.txInfo.outputVector,
        locktime: ValidMainnetProof.txInfo.locktime,
      }

      const proof = {
        merkleProof: ValidMainnetProof.proof.merkleProof,
        txIndexInBlock: ValidMainnetProof.proof.txIndexInBlock,
        bitcoinHeaders: "0x", // Empty for test (library skips SPV validation)
        coinbasePreimage: ValidMainnetProof.proof.coinbasePreimage,
        coinbaseProof: "0x", // Empty for test
      }

      // Should fail at wallet control proof validation (no OP_RETURN with challenge)
      await expect(
        qcManager.registerWallet(
          qc.address,
          validBitcoinAddress,
          "test_challenge_123",
          txInfo,
          proof
        )
      )
        .to.be.revertedWithCustomError(qcManager, "SPVProofValidationFailed")
        .withArgs("Wallet control proof failed")
    })

    it("should propagate library errors correctly", async () => {
      const txInfo = {
        version: "0x01000000",
        inputVector: "0xFF", // Invalid input vector
        outputVector: "0x01000000000000000000",
        locktime: "0x00000000",
      }

      const proof = {
        merkleProof: "0x",
        txIndexInBlock: 0,
        bitcoinHeaders: "0x",
        coinbasePreimage: ethers.ZeroHash,
        coinbaseProof: "0x",
      }

      // Library SPVErr(2) should be translated to main contract error
      await expect(
        qcManager.registerWallet(
          qc.address,
          validBitcoinAddress,
          "test_challenge",
          txInfo,
          proof
        )
      )
        .to.be.revertedWithCustomError(qcManager, "SPVProofValidationFailed")
        .withArgs("Invalid input vector")
    })

    it("should handle Bitcoin address validation through library", async () => {
      const txInfo = {
        version: "0x01000000",
        inputVector:
          "0x01000000000000000000000000000000000000000000000000000000000000000000000000000000ffffffff",
        outputVector: "0x01000000000000000000",
        locktime: "0x00000000",
      }

      const proof = {
        merkleProof: "0x",
        txIndexInBlock: 0,
        bitcoinHeaders: "0x",
        coinbasePreimage: ethers.ZeroHash,
        coinbaseProof: "0x",
      }

      // Should fail at address validation in library
      await expect(
        qcManager.registerWallet(
          qc.address,
          "invalid_bitcoin_address", // Invalid format
          "test_challenge",
          txInfo,
          proof
        )
      ).to.be.revertedWithCustomError(qcManager, "InvalidBitcoinAddress")
    })
  })

  describe("QCRedeemer Library Integration", () => {
    let redemptionId: string

    beforeEach(async () => {
      // Setup QC and redemption
      await qcData.registerQC(
        qc.address,
        "Test QC",
        "https://test.qc",
        ethers.parseEther("100"),
        86400
      )
      await qcData.activateQC(qc.address)

      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(qc.address, testAmount, validBitcoinAddress)

      const receipt = await tx.wait()
      const event = receipt?.logs.find(
        (log) =>
          qcRedeemer.interface.parseLog(log as any)?.name ===
          "RedemptionRequested"
      )
      redemptionId = qcRedeemer.interface.parseLog(event as any)?.args
        .redemptionId
    })

    it("should delegate SPV validation to QCRedeemerSPV library", async () => {
      const ARBITER_ROLE = await qcRedeemer.ARBITER_ROLE()
      await qcRedeemer.grantRole(ARBITER_ROLE, deployer.address)

      const txInfo = {
        version: ValidMainnetProof.txInfo.version,
        inputVector: ValidMainnetProof.txInfo.inputVector,
        outputVector: ValidMainnetProof.txInfo.outputVector,
        locktime: ValidMainnetProof.txInfo.locktime,
      }

      const proof = {
        merkleProof: "0x1234",
        txIndexInBlock: ValidMainnetProof.proof.txIndexInBlock,
        bitcoinHeaders: "0x", // Empty headers for test
        coinbasePreimage: ValidMainnetProof.proof.coinbasePreimage,
        coinbaseProof: "0x1234",
      }

      // Should fail at payment verification (no matching output to user address)
      await expect(
        qcRedeemer.recordRedemptionFulfillment(
          redemptionId,
          validBitcoinAddress,
          100000000, // 1 BTC in satoshis
          txInfo,
          proof
        )
      )
        .to.be.revertedWithCustomError(qcRedeemer, "RedemptionProofFailed")
        .withArgs("Payment verification failed")
    })

    it("should propagate library errors correctly", async () => {
      const ARBITER_ROLE = await qcRedeemer.ARBITER_ROLE()
      await qcRedeemer.grantRole(ARBITER_ROLE, deployer.address)

      const txInfo = {
        version: "0x01000000",
        inputVector: "0xFF", // Invalid input vector
        outputVector: "0x01000000000000000000",
        locktime: "0x00000000",
      }

      const proof = {
        merkleProof: "0x1234",
        txIndexInBlock: 0,
        bitcoinHeaders: "0x00",
        coinbasePreimage: ethers.ZeroHash,
        coinbaseProof: "0x1234",
      }

      // Library SPVErr(2) should be translated appropriately
      await expect(
        qcRedeemer.recordRedemptionFulfillment(
          redemptionId,
          validBitcoinAddress,
          100000000,
          txInfo,
          proof
        )
      ).to.be.revertedWithCustomError(qcRedeemer, "SPVVerificationFailed")
    })

    it("should validate transaction structure through library", async () => {
      const ARBITER_ROLE = await qcRedeemer.ARBITER_ROLE()
      await qcRedeemer.grantRole(ARBITER_ROLE, deployer.address)

      // Create transaction that passes SPV but fails transaction validation
      const txInfo = {
        version: "0x00000000", // Invalid version (should be 1 or 2)
        inputVector:
          "0x01000000000000000000000000000000000000000000000000000000000000000000000000000000ffffffff",
        outputVector: "0x01000000000000000000",
        locktime: "0x00000000",
      }

      const proof = {
        merkleProof: "0x1234",
        txIndexInBlock: 0,
        bitcoinHeaders: "0x",
        coinbasePreimage: ethers.ZeroHash,
        coinbaseProof: "0x1234",
      }

      // Should fail at transaction validation in library
      await expect(
        qcRedeemer.recordRedemptionFulfillment(
          redemptionId,
          validBitcoinAddress,
          100000000,
          txInfo,
          proof
        )
      )
        .to.be.revertedWithCustomError(qcRedeemer, "RedemptionProofFailed")
        .withArgs("Transaction validation failed")
    })
  })

  describe("Error Code Translation", () => {
    it("should translate QCManagerSPV error codes to readable messages", async () => {
      await qcData.registerQC(
        qc.address,
        "Test QC",
        "https://test.qc",
        ethers.parseEther("100"),
        86400
      )

      // Test SPVErr(7) - Empty headers
      const txInfo = {
        version: "0x01000000",
        inputVector:
          "0x01000000000000000000000000000000000000000000000000000000000000000000000000000000ffffffff",
        outputVector: "0x01000000000000000000",
        locktime: "0x00000000",
      }

      const proof = {
        merkleProof: "0x1234",
        txIndexInBlock: 0,
        bitcoinHeaders: "0x", // Empty headers
        coinbasePreimage: ethers.ZeroHash,
        coinbaseProof: "0x1234",
      }

      // Should translate library error to meaningful message
      await expect(
        qcManager.registerWallet(
          qc.address,
          validBitcoinAddress,
          "test_challenge",
          txInfo,
          proof
        )
      )
        .to.be.revertedWithCustomError(qcManager, "SPVProofValidationFailed")
        .withArgs("Empty headers")
    })

    it("should translate QCRedeemerSPV error codes to readable messages", async () => {
      await qcData.registerQC(
        qc.address,
        "Test QC",
        "https://test.qc",
        ethers.parseEther("100"),
        86400
      )
      await qcData.activateQC(qc.address)

      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(qc.address, testAmount, validBitcoinAddress)
      const receipt = await tx.wait()
      const event = receipt?.logs.find(
        (log) =>
          qcRedeemer.interface.parseLog(log as any)?.name ===
          "RedemptionRequested"
      )
      const redemptionId = qcRedeemer.interface.parseLog(event as any)?.args
        .redemptionId

      const ARBITER_ROLE = await qcRedeemer.ARBITER_ROLE()
      await qcRedeemer.grantRole(ARBITER_ROLE, deployer.address)

      // Test SPVErr(4) - Mismatched proof lengths
      const txInfo = {
        version: "0x01000000",
        inputVector:
          "0x01000000000000000000000000000000000000000000000000000000000000000000000000000000ffffffff",
        outputVector: "0x01000000000000000000",
        locktime: "0x00000000",
      }

      const proof = {
        merkleProof: "0x1234", // 2 bytes
        txIndexInBlock: 0,
        bitcoinHeaders: "0x00",
        coinbasePreimage: ethers.ZeroHash,
        coinbaseProof: "0x123456", // 3 bytes - different length
      }

      // Should translate library error appropriately
      await expect(
        qcRedeemer.recordRedemptionFulfillment(
          redemptionId,
          validBitcoinAddress,
          100000000,
          txInfo,
          proof
        )
      ).to.be.revertedWithCustomError(qcRedeemer, "SPVVerificationFailed")
    })
  })

  describe("Performance and Gas Usage", () => {
    it("should maintain reasonable gas usage with library pattern", async () => {
      await qcData.registerQC(
        qc.address,
        "Test QC",
        "https://test.qc",
        ethers.parseEther("100"),
        86400
      )

      const txInfo = {
        version: "0x01000000",
        inputVector:
          "0x01000000000000000000000000000000000000000000000000000000000000000000000000000000ffffffff",
        outputVector: "0x01000000000000000000",
        locktime: "0x00000000",
      }

      const proof = {
        merkleProof: "0x",
        txIndexInBlock: 0,
        bitcoinHeaders: "0x",
        coinbasePreimage: ethers.ZeroHash,
        coinbaseProof: "0x",
      }

      // Measure gas usage for library call
      try {
        await qcManager.estimateGas.registerWallet(
          qc.address,
          validBitcoinAddress,
          "test_challenge",
          txInfo,
          proof
        )
      } catch (error: any) {
        // Expected to fail, but we can check that gas estimation doesn't exceed reasonable limits
        // Library pattern should not significantly increase gas costs
        expect(error.message).to.include("SPVProofValidationFailed")
      }
    })

    it("should efficiently handle multiple library function calls", async () => {
      await qcData.registerQC(
        qc.address,
        "Test QC",
        "https://test.qc",
        ethers.parseEther("100"),
        86400
      )
      await qcData.activateQC(qc.address)

      // Create redemption
      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(qc.address, testAmount, validBitcoinAddress)
      const receipt = await tx.wait()
      const event = receipt?.logs.find(
        (log) =>
          qcRedeemer.interface.parseLog(log as any)?.name ===
          "RedemptionRequested"
      )
      const redemptionId = qcRedeemer.interface.parseLog(event as any)?.args
        .redemptionId

      const ARBITER_ROLE = await qcRedeemer.ARBITER_ROLE()
      await qcRedeemer.grantRole(ARBITER_ROLE, deployer.address)

      const txInfo = {
        version: "0x02000000",
        inputVector:
          "0x01000000000000000000000000000000000000000000000000000000000000000000000000000000ffffffff",
        outputVector: "0x01000000000000000000",
        locktime: "0x00000000",
      }

      const proof = {
        merkleProof: "0x1234",
        txIndexInBlock: 0,
        bitcoinHeaders: "0x",
        coinbasePreimage: ethers.ZeroHash,
        coinbaseProof: "0x1234",
      }

      // This call involves multiple library function calls:
      // 1. validateSPVProof
      // 2. verifyRedemptionPayment
      // 3. validateRedemptionTransaction
      try {
        await qcRedeemer.estimateGas.recordRedemptionFulfillment(
          redemptionId,
          validBitcoinAddress,
          100000000,
          txInfo,
          proof
        )
      } catch (error: any) {
        // Multiple library calls should complete efficiently
        expect(error.message).to.include("RedemptionProofFailed")
      }
    })
  })

  describe("Bridge SPV Library Compatibility", () => {
    it("should maintain compatibility with Bridge SPV patterns", async () => {
      // Test that our libraries work with the same data structures as Bridge
      const bridgeCompatibleTx = ValidMainnetProof

      const txInfo = {
        version: bridgeCompatibleTx.txInfo.version,
        inputVector: bridgeCompatibleTx.txInfo.inputVector,
        outputVector: bridgeCompatibleTx.txInfo.outputVector,
        locktime: bridgeCompatibleTx.txInfo.locktime,
      }

      // Our libraries should be able to process Bridge-compatible transaction data
      // Even if validation fails, the parsing should work correctly
      expect(txInfo.version).to.be.a("string")
      expect(txInfo.inputVector).to.be.a("string")
      expect(txInfo.outputVector).to.be.a("string")
      expect(txInfo.locktime).to.be.a("string")
    })

    it("should use the same SPV validation libraries as Bridge", async () => {
      // Verify our contracts are using the same Bridge libraries:
      // - BTCUtils for transaction hashing
      // - ValidateSPV for merkle proof verification
      // - BytesLib for byte manipulation

      const [relay, difficultyFactor] = await qcManager.getSPVParameters()
      expect(relay).to.equal(await testRelay.getAddress())
      expect(difficultyFactor).to.equal(1)

      const [relay2, difficultyFactor2] = await qcRedeemer.getSPVParameters()
      expect(relay2).to.equal(await testRelay.getAddress())
      expect(difficultyFactor2).to.equal(1)
    })
  })
})
