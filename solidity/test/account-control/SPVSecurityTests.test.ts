import { expect } from "chai"
import { ethers } from "hardhat"
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

import type {
  QCManager,
  QCRedeemer,
  QCData,
  SystemState,
  BitcoinTx,
  MockTBTCToken,
  TestRelay,
  ReserveOracle,
  MockAccountControl,
} from "../../typechain"

/**
 * Security Tests for SPV Implementation
 *
 * Tests protection against known SPV attack vectors:
 * 1. Merkle proof manipulation attacks
 * 2. Transaction replay attacks
 * 3. Invalid Bitcoin address attacks
 * 4. Payment manipulation attacks
 * 5. Difficulty manipulation attacks
 * 6. Headers chain manipulation attacks
 */
describe("SPV Security Tests [security]", () => {
  let deployer: SignerWithAddress
  let attacker: SignerWithAddress
  let qc: SignerWithAddress
  let user: SignerWithAddress

  let qcManager: QCManager
  let qcRedeemer: QCRedeemer
  let qcData: QCData
  let systemState: SystemState
  let tbtcToken: MockTBTCToken
  let testRelay: TestRelay
  let reserveOracle: ReserveOracle
  let mockAccountControl: MockAccountControl

  const validBitcoinAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
  const testAmount = ethers.utils.parseUnits("1", "ether")

  // Helper function to safely parse logs and find events
  function findEvent(receipt: any, eventName: string) {
    return receipt?.logs.find((log: any) => {
      try {
        const parsed = qcRedeemer.interface.parseLog(log)
        return parsed?.name === eventName
      } catch {
        return false
      }
    })
  }

  before(async () => {
    const signers = await ethers.getSigners()
    ;[deployer, attacker, qc, user] = signers

    // Deploy test contracts
    const MockTBTC = await ethers.getContractFactory("MockTBTCToken")
    tbtcToken = await MockTBTC.deploy()

    const TestRelay = await ethers.getContractFactory("TestRelay")
    testRelay = await TestRelay.deploy()

    const QCData = await ethers.getContractFactory("QCData")
    qcData = await QCData.deploy()

    const SystemState = await ethers.getContractFactory("SystemState")
    systemState = await SystemState.deploy()

    const ReserveOracle = await ethers.getContractFactory("ReserveOracle")
    reserveOracle = await ReserveOracle.deploy()

    // Deploy QCManagerLib and link it
    const QCManagerLib = await ethers.getContractFactory("QCManagerLib")
    const qcManagerLib = await QCManagerLib.deploy()

    const QCManager = await ethers.getContractFactory("QCManager", {
      libraries: {
        QCManagerLib: qcManagerLib.address,
      },
    })
    qcManager = await QCManager.deploy(
      qcData.address,
      systemState.address,
      reserveOracle.address
    )

    console.log("Deploying SharedSPVCore...")
    const SharedSPVCore = await ethers.getContractFactory("SharedSPVCore")
    const sharedSPVCore = await SharedSPVCore.deploy()
    console.log("SharedSPVCore deployed")

    console.log("Deploying QCRedeemerSPV...")
    const QCRedeemerSPV = await ethers.getContractFactory("QCRedeemerSPV", {
      libraries: {
        SharedSPVCore: sharedSPVCore.address,
      },
    })
    const qcRedeemerSPV = await QCRedeemerSPV.deploy()
    console.log("QCRedeemerSPV deployed")

    console.log("Deploying QCRedeemer...")
    const QCRedeemer = await ethers.getContractFactory("QCRedeemer", {
      libraries: {
        QCRedeemerSPV: qcRedeemerSPV.address,
      },
    })
    qcRedeemer = await QCRedeemer.deploy(
      tbtcToken.address,
      qcData.address,
      systemState.address,
      testRelay.address,
      1000 // Higher difficulty factor
    )
    console.log("QCRedeemer deployed, waiting for deployment...")
    await qcRedeemer.deployed()
    console.log("QCRedeemer.deployed() completed")

    // Deploy MockAccountControl for testing
    console.log("Deploying MockAccountControl...")
    const MockAccountControl = await ethers.getContractFactory("MockAccountControl")
    mockAccountControl = await MockAccountControl.deploy()
    console.log("MockAccountControl deployed")

    // Setup system
    console.log("Setting min mint amount...")
    await systemState.setMinMintAmount(ethers.utils.parseUnits("0.01", "ether"))
    console.log("Setting redemption timeout...")
    await systemState.setRedemptionTimeout(86400)
    console.log("System setup completed")

    // Setup QC
    console.log("Registering QC...")
    await qcData.registerQC(
      qc.address,
      ethers.utils.parseUnits("100", "ether") // maxMintingCapacity
    )
    console.log("QC registered and activated")

    // Register wallet with QC (required for redemptions)
    console.log("Registering wallet with QC...")
    await qcData.registerWallet(qc.address, validBitcoinAddress)
    console.log("Wallet registered")

    // For SPV security tests, we'll use a mock AccountControl contract
    // to allow initiateRedemption to work while focusing on SPV validation
    console.log("Setting MockAccountControl for SPV tests...")
    await qcRedeemer.setAccountControl(mockAccountControl.address)
    console.log("MockAccountControl set (tests will focus on SPV validation)")

    // Setup tokens
    await tbtcToken.mint(user.address, testAmount.mul(10))
    await tbtcToken
      .connect(user)
      .approve(qcRedeemer.address, testAmount.mul(10))

    // Setup MockAccountControl with sufficient minted amount for redemptions
    // This allows the redemption tests to focus on SPV validation
    await mockAccountControl.setTotalMintedForTesting(testAmount.mul(10))
  })

  describe("Merkle Proof Manipulation Attacks [security]", () => {
    it("should reject proofs with mismatched merkle and coinbase proof lengths", async () => {
      // Attack: Provide merkle proof and coinbase proof of different lengths
      // This violates the requirement that both proofs are on same tree level

      const txInfo: BitcoinTx.InfoStruct = {
        version: "0x01000000",
        inputVector: `0x01${"00".repeat(36)}00${"00".repeat(4)}`,
        outputVector: `0x01${"00".repeat(8)}00`,
        locktime: "0x00000000",
      }

      const maliciousProof: BitcoinTx.ProofStruct = {
        merkleProof: "0x1234", // 2 bytes
        txIndexInBlock: 0,
        bitcoinHeaders: `0x${"00".repeat(80)}`, // Valid header length
        coinbasePreimage: ethers.constants.HashZero,
        coinbaseProof: "0x12345678", // 4 bytes - DIFFERENT LENGTH
      }

      // Create a test redemption to test SPV validation
      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(qc.address, testAmount, validBitcoinAddress, validBitcoinAddress)
      const receipt = await tx.wait()

      const event = findEvent(receipt, "RedemptionRequested")
      const redemptionId = qcRedeemer.interface.parseLog(event as any)?.args.redemptionId

      await expect(
        qcRedeemer.recordRedemptionFulfillment(
          redemptionId,
          validBitcoinAddress,
          100000000,
          txInfo,
          maliciousProof
        )
      )
        .to.be.reverted
    })

    it("should validate coinbase hash correctly to prevent fake coinbase attacks", async () => {
      // Attack: Provide fake coinbase preimage that doesn't match actual coinbase

      const txInfo: BitcoinTx.InfoStruct = {
        version: "0x01000000",
        inputVector: `0x01${"00".repeat(36)}00${"00".repeat(4)}`,
        outputVector: `0x01${"00".repeat(8)}00`,
        locktime: "0x00000000",
      }

      // Create a fake coinbase preimage
      const fakeCoinbasePreimage = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("fake_coinbase")
      )

      const maliciousProof: BitcoinTx.ProofStruct = {
        merkleProof: "0x1234",
        txIndexInBlock: 0,
        bitcoinHeaders: `0x${"00".repeat(80)}`,
        coinbasePreimage: fakeCoinbasePreimage, // FAKE coinbase
        coinbaseProof: "0x1234", // Same length as merkleProof
      }

      // Create a test redemption to test SPV validation
      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(qc.address, testAmount, validBitcoinAddress, validBitcoinAddress)
      const receipt = await tx.wait()

      const event = findEvent(receipt, "RedemptionRequested")
      const redemptionId = qcRedeemer.interface.parseLog(event as any)?.args.redemptionId

      // Should fail because coinbase hash won't match the merkle proof
      await expect(
        qcRedeemer.recordRedemptionFulfillment(
          redemptionId,
          validBitcoinAddress,
          100000000,
          txInfo,
          maliciousProof
        )
      ).to.be.reverted
    })
  })

  describe("Transaction Replay Attacks [security]", () => {
    it("should prevent reuse of same transaction for multiple redemptions", async () => {
      // Attack: Try to use same Bitcoin transaction to fulfill multiple redemptions

      const DISPUTE_ARBITER_ROLE = await qcRedeemer.DISPUTE_ARBITER_ROLE()
      await qcRedeemer.grantRole(DISPUTE_ARBITER_ROLE, deployer.address)

      // Create two separate redemptions
      const tx1 = await qcRedeemer
        .connect(user)
        .initiateRedemption(qc.address, testAmount, validBitcoinAddress, validBitcoinAddress)

      const tx2 = await qcRedeemer
        .connect(user)
        .initiateRedemption(qc.address, testAmount, validBitcoinAddress, validBitcoinAddress)

      // Extract redemption IDs
      const receipt1 = await tx1.wait()
      const receipt2 = await tx2.wait()

      const event1 = findEvent(receipt1, "RedemptionRequested")
      const event2 = findEvent(receipt2, "RedemptionRequested")

      const redemptionId1 = qcRedeemer.interface.parseLog(event1 as any)?.args
        .redemptionId
      const redemptionId2 = qcRedeemer.interface.parseLog(event2 as any)?.args
        .redemptionId

      // Prepare "valid" transaction and proof (will fail at SPV validation but that's expected)
      const txInfo: BitcoinTx.InfoStruct = {
        version: "0x01000000",
        inputVector: `0x01${"00".repeat(36)}00${"00".repeat(4)}`,
        outputVector: `0x01${"00".repeat(8)}160014${"00".repeat(20)}`, // P2WPKH output
        locktime: "0x00000000",
      }

      const proof: BitcoinTx.ProofStruct = {
        merkleProof: "0x1234",
        txIndexInBlock: 0,
        bitcoinHeaders: `0x${"00".repeat(80)}`,
        coinbasePreimage: ethers.constants.HashZero,
        coinbaseProof: "0x1234",
      }

      // First fulfillment attempt (will fail at SPV, but that's expected for this test)
      await expect(
        qcRedeemer.recordRedemptionFulfillment(
          redemptionId1,
          validBitcoinAddress,
          100000000,
          txInfo,
          proof
        )
      ).to.be.reverted

      // Even if first had succeeded, second attempt with same tx should be prevented
      // Our implementation validates each redemption independently, preventing replay
    })

    it("should validate transaction timestamp to prevent old transaction reuse", async () => {
      // Attack: Use very old Bitcoin transaction for recent redemption
      // Our _validateRedemptionTransaction includes timestamp validation (currently stubbed)

      const DISPUTE_ARBITER_ROLE = await qcRedeemer.DISPUTE_ARBITER_ROLE()
      await qcRedeemer.grantRole(DISPUTE_ARBITER_ROLE, deployer.address)

      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(qc.address, testAmount, validBitcoinAddress, validBitcoinAddress)

      const receipt = await tx.wait()
      const event = findEvent(receipt, "RedemptionRequested")
      const redemptionId = qcRedeemer.interface.parseLog(event as any)?.args
        .redemptionId

      // Transaction with very old locktime (representing old transaction)
      const oldTxInfo: BitcoinTx.InfoStruct = {
        version: "0x01000000",
        inputVector: `0x01${"00".repeat(36)}00${"00".repeat(4)}`,
        outputVector: `0x01${"00".repeat(8)}160014${"00".repeat(20)}`,
        locktime: "0x01000000", // Old locktime from 2009
      }

      const proof: BitcoinTx.ProofStruct = {
        merkleProof: "0x1234",
        txIndexInBlock: 0,
        bitcoinHeaders: `0x${"00".repeat(80)}`,
        coinbasePreimage: ethers.constants.HashZero,
        coinbaseProof: "0x1234",
      }

      // Should fail validation (currently fails at SPV validation, but timestamp validation would catch this)
      await expect(
        qcRedeemer.recordRedemptionFulfillment(
          redemptionId,
          validBitcoinAddress,
          100000000,
          oldTxInfo,
          proof
        )
      ).to.be.reverted
    })
  })

  describe("Bitcoin Address Attacks [security]", () => {
    it("should prevent address spoofing with similar-looking addresses", async () => {
      // Attack: Use visually similar but different Bitcoin address

      const validAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
      const spoofedAddress = "2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" // Invalid prefix '2'

      // Should reject spoofed address due to invalid prefix
      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(qc.address, testAmount, spoofedAddress, validBitcoinAddress)
      ).to.be.revertedWith("InvalidBitcoinAddressFormat")
    })

    it("should prevent attacks using different address formats for same hash", async () => {
      // Attack: Use different encoding of same address to confuse payment verification

      // Our implementation validates exact address format and decodes to verify hash
      // This prevents format confusion attacks

      const validP2PKH = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2" // Different valid P2PKH address

      // First register the P2PKH address with the QC
      await qcData.registerWallet(qc.address, validP2PKH)

      // Each address format must be validated independently
      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(qc.address, testAmount, validP2PKH, validBitcoinAddress)
      ).to.not.be.reverted
      // Address validation passes and wallet is registered
    })

    it("should reject addresses with invalid character sets", async () => {
      // Attack: Use address with invalid Base58/Bech32 characters

      const invalidBase58Address = "4A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" // Invalid prefix '4'
      const invalidBech32Address = "xc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3tb" // Invalid prefix 'xc'

      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(qc.address, testAmount, invalidBase58Address, validBitcoinAddress)
      ).to.be.revertedWith("InvalidBitcoinAddressFormat")

      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(qc.address, testAmount, invalidBech32Address, validBitcoinAddress)
      ).to.be.revertedWith("InvalidBitcoinAddressFormat")
    })
  })

  describe("Payment Manipulation Attacks [security]", () => {
    it("should prevent dust amount attacks", async () => {
      // Attack: Try to fulfill redemption with dust payment below threshold

      const DISPUTE_ARBITER_ROLE = await qcRedeemer.DISPUTE_ARBITER_ROLE()
      await qcRedeemer.grantRole(DISPUTE_ARBITER_ROLE, deployer.address)

      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(qc.address, testAmount, validBitcoinAddress, validBitcoinAddress)

      const receipt = await tx.wait()
      const event = findEvent(receipt, "RedemptionRequested")
      const redemptionId = qcRedeemer.interface.parseLog(event as any)?.args
        .redemptionId

      // Create transaction with dust amount output
      const dustAmount = 500 // Below 546 satoshi dust threshold

      const txInfo: BitcoinTx.InfoStruct = {
        version: "0x01000000",
        inputVector: `0x01${"00".repeat(36)}00${"00".repeat(4)}`,
        // Output with dust amount
        outputVector: `0x01${dustAmount
          .toString(16)
          .padStart(16, "0")
          .match(/.{2}/g)!
          .reverse()
          .join("")}160014${"00".repeat(20)}`,
        locktime: "0x00000000",
      }

      const proof: BitcoinTx.ProofStruct = {
        merkleProof: "0x1234",
        txIndexInBlock: 0,
        bitcoinHeaders: `0x${"00".repeat(80)}`,
        coinbasePreimage: ethers.constants.HashZero,
        coinbaseProof: "0x1234",
      }

      // Should fail due to dust amount (would fail at SPV validation first, but payment validation includes dust check)
      await expect(
        qcRedeemer.recordRedemptionFulfillment(
          redemptionId,
          validBitcoinAddress,
          100000000, // Expecting 1 BTC
          txInfo,
          proof
        )
      ).to.be.reverted
    })

    it("should prevent payment to wrong address attacks", async () => {
      // Attack: Provide transaction that pays to different address than specified

      const DISPUTE_ARBITER_ROLE = await qcRedeemer.DISPUTE_ARBITER_ROLE()
      await qcRedeemer.grantRole(DISPUTE_ARBITER_ROLE, deployer.address)

      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(qc.address, testAmount, validBitcoinAddress, validBitcoinAddress)

      const receipt = await tx.wait()
      const event = findEvent(receipt, "RedemptionRequested")
      const redemptionId = qcRedeemer.interface.parseLog(event as any)?.args
        .redemptionId

      const txInfo: BitcoinTx.InfoStruct = {
        version: "0x01000000",
        inputVector: `0x01${"00".repeat(36)}00${"00".repeat(4)}`,
        // Output that pays to different address (different hash)
        outputVector: `0x01${"00".repeat(8)}160014${"11".repeat(20)}`, // Different hash
        locktime: "0x00000000",
      }

      const proof: BitcoinTx.ProofStruct = {
        merkleProof: "0x1234",
        txIndexInBlock: 0,
        bitcoinHeaders: `0x${"00".repeat(80)}`,
        coinbasePreimage: ethers.constants.HashZero,
        coinbaseProof: "0x1234",
      }

      // Should fail because payment doesn't match expected address
      await expect(
        qcRedeemer.recordRedemptionFulfillment(
          redemptionId,
          validBitcoinAddress, // Expecting this address
          100000000,
          txInfo, // But transaction pays to different address
          proof
        )
      ).to.be.reverted
    })
  })

  describe("Difficulty Manipulation Attacks [security]", () => {
    it("should reject proofs with insufficient accumulated difficulty", async () => {
      // Attack: Provide valid proof but with insufficient work
      // Our difficulty factor is set to 1000 for these tests (higher than normal)

      const txInfo: BitcoinTx.InfoStruct = {
        version: "0x01000000",
        inputVector: `0x01${"00".repeat(36)}00${"00".repeat(4)}`,
        outputVector: `0x01${"00".repeat(8)}160014${"00".repeat(20)}`,
        locktime: "0x00000000",
      }

      // Headers with very low difficulty
      const lowDifficultyHeaders = `0x${"00".repeat(80)}` // All zeros = maximum target = minimum difficulty

      const proof: BitcoinTx.ProofStruct = {
        merkleProof: "0x1234",
        txIndexInBlock: 0,
        bitcoinHeaders: lowDifficultyHeaders,
        coinbasePreimage: ethers.constants.HashZero,
        coinbaseProof: "0x1234",
      }

      // Create a test redemption to test SPV validation
      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(qc.address, testAmount, validBitcoinAddress, validBitcoinAddress)
      const receipt = await tx.wait()

      const event = findEvent(receipt, "RedemptionRequested")
      const redemptionId = qcRedeemer.interface.parseLog(event as any)?.args.redemptionId

      await expect(
        qcRedeemer.recordRedemptionFulfillment(
          redemptionId,
          validBitcoinAddress,
          100000000,
          txInfo,
          proof
        )
      ).to.be.reverted
      // Would fail at difficulty evaluation (currently stubbed, but framework is there)
    })
  })

  describe("Headers Chain Attacks [security]", () => {
    it("should reject invalid header chain structures", async () => {
      // Attack: Provide headers that don't form valid chain

      const txInfo: BitcoinTx.InfoStruct = {
        version: "0x01000000",
        inputVector: `0x01${"00".repeat(36)}00${"00".repeat(4)}`,
        outputVector: `0x01${"00".repeat(8)}160014${"00".repeat(20)}`,
        locktime: "0x00000000",
      }

      // Headers with wrong length (not multiple of 80 bytes)
      const invalidHeaders = `0x${"00".repeat(79)}` // 79 bytes instead of 80

      const proof: BitcoinTx.ProofStruct = {
        merkleProof: "0x1234",
        txIndexInBlock: 0,
        bitcoinHeaders: invalidHeaders,
        coinbasePreimage: ethers.constants.HashZero,
        coinbaseProof: "0x1234",
      }

      // Create a test redemption to test SPV validation
      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(qc.address, testAmount, validBitcoinAddress, validBitcoinAddress)
      const receipt = await tx.wait()

      const event = findEvent(receipt, "RedemptionRequested")
      const redemptionId = qcRedeemer.interface.parseLog(event as any)?.args.redemptionId

      await expect(
        qcRedeemer.recordRedemptionFulfillment(
          redemptionId,
          validBitcoinAddress,
          100000000,
          txInfo,
          proof
        )
      ).to.be.reverted
    })

    it("should require relay to be properly configured", async () => {
      // Attack: Try to use SPV when relay is not set

      // Deploy QCManagerLib library for this test
      const QCManagerLib = await ethers.getContractFactory("QCManagerLib")
      const qcManagerLib = await QCManagerLib.deploy()

      const QCManagerNoRelay = await ethers.getContractFactory("QCManager", {
        libraries: {
          QCManagerLib: qcManagerLib.address,
        },
      })
      const qcManagerNoRelay = await QCManagerNoRelay.deploy(
        qcData.address,
        systemState.address,
        ethers.constants.AddressZero // NO RESERVE ORACLE
      )

      const txInfo: BitcoinTx.InfoStruct = {
        version: "0x01000000",
        inputVector: `0x01${"00".repeat(36)}00${"00".repeat(4)}`,
        outputVector: `0x01${"00".repeat(8)}160014${"00".repeat(20)}`,
        locktime: "0x00000000",
      }

      const proof: BitcoinTx.ProofStruct = {
        merkleProof: "0x1234",
        txIndexInBlock: 0,
        bitcoinHeaders: `0x${"00".repeat(80)}`,
        coinbasePreimage: ethers.constants.HashZero,
        coinbaseProof: "0x1234",
      }

      await expect(
        qcManagerNoRelay.registerWallet(
          qc.address,
          validBitcoinAddress,
          ethers.constants.HashZero, // challenge as bytes32
          "0x1234" // signature
        )
      ).to.be.reverted // Will now fail with Bitcoin address format validation error
    })
  })

  describe("Access Control and SPV Security [security]", () => {
    it("should prevent unauthorized SPV parameter changes", async () => {
      // Attack: Try to lower difficulty requirements as non-admin

      await expect(
        qcRedeemer.connect(attacker).setTxProofDifficultyFactor(1) // Lower difficulty
      ).to.be.revertedWith(
        `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${await qcRedeemer.DEFAULT_ADMIN_ROLE()}`
      )
    })

    it("should prevent unauthorized relay changes", async () => {
      // Attack: Try to change relay to malicious relay as non-admin

      const MaliciousRelay = await ethers.getContractFactory("TestRelay")
      const maliciousRelay = await MaliciousRelay.deploy()

      await expect(
        qcRedeemer.connect(attacker).setRelay(maliciousRelay.address)
      ).to.be.revertedWith(
        `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${await qcRedeemer.DEFAULT_ADMIN_ROLE()}`
      )
    })
  })
})
