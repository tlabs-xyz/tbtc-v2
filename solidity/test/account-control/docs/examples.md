# Code Examples and Templates

This document provides practical, working examples and templates for common testing scenarios in the account-control test suite. All examples follow the established patterns and use the helper infrastructure.

## Table of Contents

- [Basic Test File Template](#basic-test-file-template)
- [Core Contract Testing Examples](#core-contract-testing-examples)
- [SPV Testing Examples](#spv-testing-examples)
- [Integration Testing Examples](#integration-testing-examples)
- [Error Testing Examples](#error-testing-examples)
- [Gas Analysis Examples](#gas-analysis-examples)
- [Mock Usage Examples](#mock-usage-examples)
- [Performance Testing Examples](#performance-testing-examples)

## Basic Test File Template

### Standard Contract Test Template

```typescript
import { ethers } from "hardhat"
import { expect } from "chai"
import type { QCManager } from "../../../typechain"
import {
  createBaseTestEnvironment,
  restoreBaseTestEnvironment,
  type TestEnvironment
} from "../fixtures/base-setup"
import { expectCustomError, ERROR_MESSAGES } from "../helpers/error-helpers"
import { testAmounts, bitcoinTestAddresses } from "../fixtures/test-data"

describe("QCManager", () => {
  let testEnv: TestEnvironment
  let qcManager: QCManager
  let qcManagerFactory: any

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()

    qcManagerFactory = await ethers.getContractFactory("QCManager")
    qcManager = await qcManagerFactory.deploy(
      testEnv.signers.governance.address,
      testEnv.signers.watchdog.address
    )
    await qcManager.deployed()
  })

  afterEach(async () => {
    await restoreBaseTestEnvironment()
  })

  describe("Deployment", () => {
    it("should deploy with correct initial state", async () => {
      expect(await qcManager.governance()).to.equal(testEnv.signers.governance.address)
      expect(await qcManager.watchdog()).to.equal(testEnv.signers.watchdog.address)
      expect(await qcManager.paused()).to.be.false
    })

    it("should reject zero address in constructor", async () => {
      await expectCustomError(
        qcManagerFactory.deploy(
          ethers.constants.AddressZero,
          testEnv.signers.watchdog.address
        ),
        qcManagerFactory,
        "ZeroAddress"
      )
    })
  })

  describe("requestRedemption", () => {
    it("should process valid redemption request", async () => {
      const amount = testAmounts.standard
      const btcAddress = bitcoinTestAddresses.p2pkh.valid[0]

      const tx = await qcManager
        .connect(testEnv.signers.user)
        .requestRedemption(amount, btcAddress)

      await expect(tx)
        .to.emit(qcManager, "RedemptionRequested")
        .withArgs(testEnv.signers.user.address, amount, btcAddress)
    })

    it("should reject invalid bitcoin address", async () => {
      const amount = testAmounts.standard
      const invalidAddress = bitcoinTestAddresses.invalid[0]

      await expectCustomError(
        qcManager.connect(testEnv.signers.user).requestRedemption(amount, invalidAddress),
        qcManagerFactory,
        "InvalidBitcoinAddress"
      )
    })

    it("should reject zero amount", async () => {
      const btcAddress = bitcoinTestAddresses.p2pkh.valid[0]

      await expectCustomError(
        qcManager.connect(testEnv.signers.user).requestRedemption(0, btcAddress),
        qcManagerFactory,
        "InvalidAmount"
      )
    })
  })
})
```

## Core Contract Testing Examples

### QC Data Structure Testing

```typescript
import { QCData } from "../../../typechain"
import { createTestQCData } from "../fixtures/test-factories"

describe("QCData", () => {
  let qcData: QCData
  let testEnv: TestEnvironment

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()

    const qcDataFactory = await ethers.getContractFactory("QCData")
    qcData = await qcDataFactory.deploy()
    await qcData.deployed()
  })

  describe("updateQCInfo", () => {
    it("should update QC information correctly", async () => {
      const qcInfo = createTestQCData({
        qcAddress: testEnv.signers.qcAddress.address,
        btcAddress: bitcoinTestAddresses.p2pkh.valid[0],
        depositAmount: testAmounts.standard
      })

      await qcData.connect(testEnv.signers.governance).updateQCInfo(
        qcInfo.qcAddress,
        qcInfo.btcAddress,
        qcInfo.depositAmount
      )

      const storedInfo = await qcData.getQCInfo(qcInfo.qcAddress)
      expect(storedInfo.btcAddress).to.equal(qcInfo.btcAddress)
      expect(storedInfo.depositAmount).to.equal(qcInfo.depositAmount)
    })

    it("should emit QCInfoUpdated event", async () => {
      const qcAddress = testEnv.signers.qcAddress.address
      const btcAddress = bitcoinTestAddresses.p2pkh.valid[0]
      const amount = testAmounts.standard

      await expect(
        qcData.connect(testEnv.signers.governance).updateQCInfo(
          qcAddress,
          btcAddress,
          amount
        )
      )
        .to.emit(qcData, "QCInfoUpdated")
        .withArgs(qcAddress, btcAddress, amount)
    })
  })

  describe("Access Control", () => {
    it("should restrict updateQCInfo to governance", async () => {
      await expectCustomError(
        qcData.connect(testEnv.signers.user).updateQCInfo(
          testEnv.signers.qcAddress.address,
          bitcoinTestAddresses.p2pkh.valid[0],
          testAmounts.standard
        ),
        qcDataFactory,
        "Unauthorized"
      )
    })
  })
})
```

### QC Minter Testing

```typescript
import { QCMinter } from "../../../typechain"
import { createMockSpvData } from "../helpers/spv-data-helpers"

describe("QCMinter", () => {
  let qcMinter: QCMinter
  let testEnv: TestEnvironment

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()

    const qcMinterFactory = await ethers.getContractFactory("QCMinter")
    qcMinter = await qcMinterFactory.deploy(
      /* constructor parameters */
    )
    await qcMinter.deployed()
  })

  describe("mint", () => {
    it("should mint tokens with valid deposit proof", async () => {
      const mintAmount = testAmounts.standard
      const depositSpvData = createMockSpvData({
        value: mintAmount,
        recipientScript: createP2PKHScript(testEnv.signers.qcAddress.address)
      })

      const initialBalance = await tbtcToken.balanceOf(testEnv.signers.user.address)

      await qcMinter.connect(testEnv.signers.user).mint(
        mintAmount,
        depositSpvData.txInfo,
        depositSpvData.proof
      )

      const finalBalance = await tbtcToken.balanceOf(testEnv.signers.user.address)
      expect(finalBalance.sub(initialBalance)).to.equal(mintAmount)
    })

    it("should reject minting with insufficient deposit", async () => {
      const mintAmount = testAmounts.standard
      const insufficientDeposit = testAmounts.small

      const depositSpvData = createMockSpvData({
        value: insufficientDeposit,
        recipientScript: createP2PKHScript(testEnv.signers.qcAddress.address)
      })

      await expectCustomError(
        qcMinter.connect(testEnv.signers.user).mint(
          mintAmount,
          depositSpvData.txInfo,
          depositSpvData.proof
        ),
        qcMinterFactory,
        "InsufficientDeposit",
        insufficientDeposit,
        mintAmount
      )
    })
  })
})
```

## SPV Testing Examples

### Basic SPV Proof Validation

```typescript
import { SPVValidator } from "../../../typechain"
import {
  createMockSpvData,
  createRealSpvData,
  setupMockRelayForSpv
} from "../helpers/spv-data-helpers"
import { SPVTestHelpers } from "../SPVTestHelpers"
import { validSpvProofs } from "../../data/bitcoin/spv/valid-spv-proofs"

describe("SPVValidator", () => {
  let spvValidator: SPVValidator
  let relay: LightRelayStub
  let testEnv: TestEnvironment

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()

    const relayFactory = await ethers.getContractFactory("LightRelayStub")
    relay = await relayFactory.deploy()

    const validatorFactory = await ethers.getContractFactory("SPVValidator")
    spvValidator = await validatorFactory.deploy(relay.address)
    await spvValidator.deployed()
  })

  describe("validateProof", () => {
    it("should validate correct SPV proof", async () => {
      const spvData = createMockSpvData({
        txId: "a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890",
        outputIndex: 0,
        value: ethers.utils.parseEther("1.0")
      })

      await setupMockRelayForSpv(relay, spvData)

      const { gasUsed, txHash } = await SPVTestHelpers.validateProofWithGas(
        spvValidator,
        spvData,
        { min: 100000, max: 200000 }
      )

      expect(gasUsed).to.be.within(100000, 200000)
      expect(txHash).to.match(/^0x[a-fA-F0-9]{64}$/)
    })

    it("should validate real Bitcoin transaction", async () => {
      const realSpvData = createRealSpvData(validSpvProofs.mainnet_tx_1)

      await SPVTestHelpers.setupRelayDifficulty(relay, realSpvData)

      const result = await SPVTestHelpers.validateProofWithGas(
        spvValidator,
        realSpvData
      )

      expect(result.gasUsed).to.be.below(300000)
    })

    it("should reject tampered merkle proof", async () => {
      const validSpvData = createMockSpvData({
        txId: "validtransactionid1234567890123456789012345678901234567890",
        outputIndex: 0,
        value: ethers.utils.parseEther("1.0")
      })

      const tamperedSpvData = {
        ...validSpvData,
        proof: {
          ...validSpvData.proof,
          merkleProof: SPVTestHelpers.tamperMerkleProof(
            validSpvData.proof.merkleProof,
            32
          )
        }
      }

      await setupMockRelayForSpv(relay, validSpvData)

      await expectCustomError(
        spvValidator.validateProof(tamperedSpvData.txInfo, tamperedSpvData.proof),
        spvValidatorFactory,
        "InvalidMerkleProof"
      )
    })

    it("should reject proof with insufficient headers", async () => {
      const spvData = createMockSpvData({
        txId: "insufficientheaderstest123456789012345678901234567890",
        outputIndex: 0,
        value: ethers.utils.parseEther("1.0")
      })

      const insufficientSpvData = {
        ...spvData,
        proof: {
          ...spvData.proof,
          bitcoinHeaders: SPVTestHelpers.truncateHeaders(
            spvData.proof.bitcoinHeaders,
            2 // Only 2 headers instead of required 6
          )
        }
      }

      await setupMockRelayForSpv(relay, spvData)

      await expectCustomError(
        spvValidator.validateProof(insufficientSpvData.txInfo, insufficientSpvData.proof),
        spvValidatorFactory,
        "InsufficientProofOfWork"
      )
    })
  })

  describe("Security Tests", () => {
    it("should handle malformed transaction data", async () => {
      const malformedTxs = SPVTestHelpers.createMalformedTxInfo()
      const validProof = createMockSpvData({}).proof

      for (const [testName, malformedTx] of Object.entries(malformedTxs)) {
        await expectCustomError(
          spvValidator.validateProof(malformedTx, validProof),
          spvValidatorFactory,
          "InvalidTransactionFormat"
        )
      }
    })
  })
})
```

### SPV Integration Testing

```typescript
describe("SPV Integration", () => {
  let qcRedeemer: QCRedeemer
  let spvValidator: SPVValidator
  let testEnv: TestEnvironment

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()

    // Deploy integrated SPV system
    const deploymentResult = await deploySpvSystem(testEnv.signers.deployer)
    qcRedeemer = deploymentResult.qcRedeemer
    spvValidator = deploymentResult.spvValidator
  })

  it("should process redemption with SPV proof", async () => {
    // Step 1: Request redemption
    const redemptionAmount = testAmounts.standard
    const btcAddress = bitcoinTestAddresses.p2pkh.valid[0]

    const redemptionTx = await qcRedeemer
      .connect(testEnv.signers.user)
      .requestRedemption(redemptionAmount, btcAddress)

    const redemptionId = await getRedemptionIdFromTx(redemptionTx)

    // Step 2: Create SPV proof for fulfillment
    const fulfillmentSpvData = createMockSpvData({
      value: redemptionAmount,
      recipientAddress: btcAddress,
      outputIndex: 0
    })

    await setupMockRelayForSpv(relay, fulfillmentSpvData)

    // Step 3: Fulfill redemption with SPV proof
    await qcRedeemer.fulfillRedemption(
      redemptionId,
      fulfillmentSpvData.txInfo,
      fulfillmentSpvData.proof
    )

    // Step 4: Verify redemption state
    const redemptionData = await qcRedeemer.getRedemption(redemptionId)
    expect(redemptionData.status).to.equal(RedemptionStatus.Fulfilled)
  })
})
```

## Integration Testing Examples

### Cross-Contract Integration

```typescript
describe("Cross-Contract Integration", () => {
  let qcManager: QCManager
  let qcMinter: QCMinter
  let qcRedeemer: QCRedeemer
  let systemState: SystemState
  let testEnv: TestEnvironment

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()

    const deploymentResult = await deployIntegratedSystem(testEnv.signers.deployer)
    qcManager = deploymentResult.qcManager
    qcMinter = deploymentResult.qcMinter
    qcRedeemer = deploymentResult.qcRedeemer
    systemState = deploymentResult.systemState
  })

  it("should handle complete mint-redeem workflow", async () => {
    const { signers } = testEnv
    const amount = testAmounts.standard

    // Step 1: Provide wallet control proof
    const walletControlSpvData = createMockSpvData({
      value: amount,
      recipientScript: createP2PKHScript(signers.qcAddress.address)
    })

    await qcManager.connect(signers.qcAddress).provideWalletControlProof(
      walletControlSpvData.txInfo,
      walletControlSpvData.proof
    )

    // Step 2: Mint tBTC
    const mintAmount = amount.mul(90).div(100) // 90% collateralization
    await qcMinter.connect(signers.user).mint(mintAmount)

    // Verify mint
    const userBalance = await tbtcToken.balanceOf(signers.user.address)
    expect(userBalance).to.equal(mintAmount)

    // Step 3: Request redemption
    const btcAddress = bitcoinTestAddresses.p2pkh.valid[0]
    const redemptionTx = await qcRedeemer
      .connect(signers.user)
      .requestRedemption(mintAmount, btcAddress)

    // Step 4: Fulfill redemption
    const redemptionId = await getRedemptionIdFromTx(redemptionTx)
    const fulfillmentSpvData = createMockSpvData({
      value: mintAmount,
      recipientAddress: btcAddress
    })

    await qcRedeemer.fulfillRedemption(
      redemptionId,
      fulfillmentSpvData.txInfo,
      fulfillmentSpvData.proof
    )

    // Verify final state
    const finalBalance = await tbtcToken.balanceOf(signers.user.address)
    expect(finalBalance).to.equal(0)

    const redemptionData = await qcRedeemer.getRedemption(redemptionId)
    expect(redemptionData.status).to.equal(RedemptionStatus.Fulfilled)
  })

  it("should handle system state transitions", async () => {
    const { signers } = testEnv

    // Test system pause
    await systemState.connect(signers.watchdog).pauseSystem()
    expect(await systemState.paused()).to.be.true

    // Verify operations are blocked
    await expectCustomError(
      qcMinter.connect(signers.user).mint(testAmounts.standard),
      qcMinterFactory,
      "SystemPaused"
    )

    // Test system unpause
    await systemState.connect(signers.governance).unpauseSystem()
    expect(await systemState.paused()).to.be.false
  })
})
```

### End-to-End User Workflow

```typescript
describe("End-to-End User Workflows", () => {
  let fullSystem: DeployedSystem
  let testEnv: TestEnvironment

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()
    fullSystem = await deployFullSystem(testEnv.signers.deployer)
  })

  it("should handle complete user journey", async () => {
    const { signers } = testEnv
    const user = signers.user

    // User starts with 0 tBTC
    expect(await fullSystem.tbtcToken.balanceOf(user.address)).to.equal(0)

    // 1. User wants to deposit 1 BTC and mint 0.9 tBTC
    const depositAmount = ethers.utils.parseEther("1.0")
    const mintAmount = ethers.utils.parseEther("0.9")

    // 2. User provides Bitcoin deposit proof
    const depositSpvData = createMockSpvData({
      value: depositAmount,
      recipientScript: createP2PKHScript(signers.qcAddress.address)
    })

    await fullSystem.qcManager.connect(user).provideWalletControlProof(
      depositSpvData.txInfo,
      depositSpvData.proof
    )

    // 3. User mints tBTC
    await fullSystem.qcMinter.connect(user).mint(mintAmount)

    // Verify user now has tBTC
    expect(await fullSystem.tbtcToken.balanceOf(user.address)).to.equal(mintAmount)

    // 4. User wants to redeem 0.5 tBTC
    const redemptionAmount = ethers.utils.parseEther("0.5")
    const userBtcAddress = bitcoinTestAddresses.p2pkh.valid[0]

    const redemptionTx = await fullSystem.qcRedeemer
      .connect(user)
      .requestRedemption(redemptionAmount, userBtcAddress)

    // 5. System processes redemption
    const redemptionId = await getRedemptionIdFromTx(redemptionTx)

    const fulfillmentSpvData = createMockSpvData({
      value: redemptionAmount,
      recipientAddress: userBtcAddress
    })

    await fullSystem.qcRedeemer.fulfillRedemption(
      redemptionId,
      fulfillmentSpvData.txInfo,
      fulfillmentSpvData.proof
    )

    // 6. Verify final user state
    const remainingBalance = ethers.utils.parseEther("0.4") // 0.9 - 0.5
    expect(await fullSystem.tbtcToken.balanceOf(user.address)).to.equal(remainingBalance)

    const redemptionData = await fullSystem.qcRedeemer.getRedemption(redemptionId)
    expect(redemptionData.status).to.equal(RedemptionStatus.Fulfilled)
  })

  it("should handle emergency scenarios", async () => {
    const { signers } = testEnv

    // Simulate emergency scenario
    await fullSystem.systemState.connect(signers.watchdog).pauseSystem()

    // Verify all operations are halted
    await expectCustomError(
      fullSystem.qcMinter.connect(signers.user).mint(testAmounts.standard),
      fullSystem.qcMinterFactory,
      "SystemPaused"
    )

    await expectCustomError(
      fullSystem.qcRedeemer.connect(signers.user).requestRedemption(
        testAmounts.standard,
        bitcoinTestAddresses.p2pkh.valid[0]
      ),
      fullSystem.qcRedeemerFactory,
      "SystemPaused"
    )

    // Test recovery
    await fullSystem.systemState.connect(signers.governance).unpauseSystem()

    // Verify operations resume
    const depositSpvData = createMockSpvData({
      value: testAmounts.standard,
      recipientScript: createP2PKHScript(signers.qcAddress.address)
    })

    await fullSystem.qcManager.connect(signers.user).provideWalletControlProof(
      depositSpvData.txInfo,
      depositSpvData.proof
    )

    // Should not revert
    await fullSystem.qcMinter.connect(signers.user).mint(testAmounts.small)
  })
})
```

## Error Testing Examples

### Comprehensive Error Testing

```typescript
describe("Error Handling", () => {
  let contract: QCManager
  let testEnv: TestEnvironment

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()

    const contractFactory = await ethers.getContractFactory("QCManager")
    contract = await contractFactory.deploy(
      testEnv.signers.governance.address,
      testEnv.signers.watchdog.address
    )
  })

  describe("Parameter Validation", () => {
    it("should test all parameter validation errors", async () => {
      const validBtcAddress = bitcoinTestAddresses.p2pkh.valid[0]
      const validAmount = testAmounts.standard

      // Test invalid inputs systematically
      await testInvalidInputs(
        contract,
        "requestRedemption",
        [validAmount, validBtcAddress],
        [
          {
            name: "zero amount",
            args: [0, validBtcAddress],
            expectedError: "InvalidAmount"
          },
          {
            name: "invalid bitcoin address",
            args: [validAmount, bitcoinTestAddresses.invalid[0]],
            expectedError: "InvalidBitcoinAddress"
          },
          {
            name: "excessive amount",
            args: [ethers.constants.MaxUint256, validBtcAddress],
            expectedError: "ExcessiveAmount"
          }
        ]
      )
    })
  })

  describe("Access Control", () => {
    it("should test access control systematically", async () => {
      const accessTester = createAccessControlTester(contract)

      await accessTester.testOnlyGovernance(
        "setParameter",
        [newParameterValue],
        testEnv.signers.user
      )

      await accessTester.testOnlyWatchdog(
        "pauseOperations",
        [],
        testEnv.signers.user
      )

      await accessTester.testUnauthorized(
        "adminFunction",
        [param1, param2],
        testEnv.signers.thirdParty
      )
    })
  })

  describe("State Validation", () => {
    it("should test state transition errors", async () => {
      // Test operations in wrong state
      await expectCustomError(
        contract.finalizeOperation(operationId),
        contractFactory,
        "OperationNotReady",
        operationId,
        currentState
      )

      // Test duplicate operations
      await contract.startOperation(params)

      await expectCustomError(
        contract.startOperation(params), // Same operation
        contractFactory,
        "DuplicateOperation"
      )
    })
  })
})
```

## Gas Analysis Examples

### Gas Profiling and Analysis

```typescript
import { measureGas, profileGasUsage } from "../helpers/gas-helpers"

describe("Gas Analysis", () => {
  let spvValidator: SPVValidator
  let testEnv: TestEnvironment

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()

    const validatorFactory = await ethers.getContractFactory("SPVValidator")
    spvValidator = await validatorFactory.deploy(relay.address)
  })

  it("should profile gas usage across different proof types", async () => {
    const testCases = [
      {
        name: "simple_proof",
        data: createMockSpvData({
          outputCount: 1,
          headerCount: 6
        })
      },
      {
        name: "complex_proof",
        data: createMockSpvData({
          outputCount: 5,
          headerCount: 10
        })
      },
      {
        name: "real_bitcoin_tx",
        data: createRealSpvData(validSpvProofs.mainnet_tx_1)
      }
    ]

    const gasProfile = await profileGasUsage(spvValidator, testCases)

    console.table(gasProfile)

    // Assert gas usage expectations
    expect(gasProfile[0].gasUsed).to.be.below(150000) // simple_proof
    expect(gasProfile[1].gasUsed).to.be.below(250000) // complex_proof
    expect(gasProfile[2].gasUsed).to.be.below(200000) // real_bitcoin_tx
  })

  it("should measure individual operation gas", async () => {
    const spvData = createMockSpvData({
      value: testAmounts.standard
    })

    const gasUsed = await measureGas(async () => {
      return await spvValidator.validateProof(spvData.txInfo, spvData.proof)
    })

    expect(gasUsed).to.be.within(100000, 200000)

    // Log for analysis
    console.log(`SPV validation gas used: ${gasUsed}`)
  })

  it("should analyze gas scaling with proof complexity", async () => {
    const results = []

    for (let headerCount = 6; headerCount <= 20; headerCount += 2) {
      const spvData = createMockSpvData({
        headerCount,
        value: testAmounts.standard
      })

      const gasUsed = await measureGas(async () => {
        return await spvValidator.validateProof(spvData.txInfo, spvData.proof)
      })

      results.push({ headerCount, gasUsed })
    }

    console.table(results)

    // Verify gas scaling is reasonable
    const firstResult = results[0]
    const lastResult = results[results.length - 1]

    // Gas should scale sub-linearly with header count
    const gasRatio = lastResult.gasUsed / firstResult.gasUsed
    const headerRatio = lastResult.headerCount / firstResult.headerCount

    expect(gasRatio).to.be.below(headerRatio) // Sub-linear scaling
  })
})
```

## Mock Usage Examples

### Systematic Mock Usage

```typescript
import { createMockContracts, createStandardMocks } from "../fixtures/mock-factory"

describe("Mock Integration", () => {
  let mocks: ReturnType<typeof createMockContracts>
  let contract: QCManager
  let testEnv: TestEnvironment

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()

    // Create specific mocks needed for this test
    mocks = await createMockContracts({
      relay: true,
      oracle: true,
      bridge: false, // Use real bridge for this test
      tbtcToken: true
    })

    // Deploy contract with mocked dependencies
    const contractFactory = await ethers.getContractFactory("QCManager")
    contract = await contractFactory.deploy(
      mocks.relay.address,
      mocks.oracle.address,
      mocks.tbtcToken.address
    )
  })

  it("should work with configured mocks", async () => {
    // Configure mocks for test scenario
    await mocks.relay.setCurrentEpochDifficulty(spvTestConfig.chainDifficulty)
    await mocks.oracle.setPrice(ethers.utils.parseEther("50000")) // $50k BTC
    await mocks.tbtcToken.mint(testEnv.signers.user.address, testAmounts.large)

    // Execute operation
    const result = await contract.operationWithMocks(
      testAmounts.standard,
      bitcoinTestAddresses.p2pkh.valid[0]
    )

    // Verify result
    expect(result).to.be.true

    // Verify mock interactions
    expect(await mocks.relay.getCallCount("getCurrentEpochDifficulty")).to.equal(1)
    expect(await mocks.oracle.getCallCount("getPrice")).to.equal(1)
  })

  it("should handle mock failures gracefully", async () => {
    // Configure mock to fail
    await mocks.oracle.setShouldRevert(true)

    // Test that contract handles mock failure appropriately
    await expectCustomError(
      contract.operationRequiringOracle(params),
      contractFactory,
      "OracleFailure"
    )
  })
})

describe("Standard Mock Usage", () => {
  let standardMocks: ReturnType<typeof createStandardMocks>

  beforeEach(async () => {
    standardMocks = await createStandardMocks()
  })

  it("should use pre-configured standard mocks", async () => {
    // Standard mocks come pre-configured with reasonable defaults
    expect(await standardMocks.relay.getCurrentEpochDifficulty()).to.equal(
      spvTestConfig.chainDifficulty
    )
    expect(await standardMocks.oracle.getPrice()).to.be.above(0)
  })
})
```

## Performance Testing Examples

### Load and Stress Testing

```typescript
describe("Performance Tests", () => {
  let contract: QCManager
  let testEnv: TestEnvironment

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()

    const contractFactory = await ethers.getContractFactory("QCManager")
    contract = await contractFactory.deploy(
      testEnv.signers.governance.address,
      testEnv.signers.watchdog.address
    )
  })

  it("should handle concurrent operations efficiently", async () => {
    const concurrentCount = 10
    const operations = Array.from({ length: concurrentCount }, (_, i) =>
      contract.processOperation(i, `operation_${i}`)
    )

    const startTime = Date.now()
    const results = await Promise.all(operations)
    const endTime = Date.now()

    expect(results).to.have.length(concurrentCount)
    expect(endTime - startTime).to.be.below(5000) // Should complete within 5s

    // Verify all operations succeeded
    for (let i = 0; i < concurrentCount; i++) {
      expect(await contract.getOperationStatus(i)).to.equal(OperationStatus.Completed)
    }
  })

  it("should scale well with batch operations", async () => {
    const batchSizes = [1, 5, 10, 20, 50]
    const results = []

    for (const batchSize of batchSizes) {
      const operations = Array.from({ length: batchSize }, (_, i) => ({
        id: i,
        data: `batch_operation_${i}`
      }))

      const gasUsed = await measureGas(async () => {
        return await contract.batchProcess(operations)
      })

      const gasPerOperation = gasUsed / batchSize
      results.push({ batchSize, totalGas: gasUsed, gasPerOperation })
    }

    console.table(results)

    // Verify gas efficiency improves with larger batches
    const smallBatch = results.find(r => r.batchSize === 5)
    const largeBatch = results.find(r => r.batchSize === 50)

    expect(largeBatch.gasPerOperation).to.be.below(
      smallBatch.gasPerOperation * 0.8 // At least 20% more efficient
    )
  })

  it("should handle edge case loads", async () => {
    // Test with maximum possible values
    const maxAmount = ethers.constants.MaxUint256.div(2) // Avoid overflow
    const longAddress = "bc1q" + "x".repeat(58) // Maximum length Bitcoin address

    const gasUsed = await measureGas(async () => {
      return await contract.processLargeOperation(maxAmount, longAddress)
    })

    expect(gasUsed).to.be.below(1000000) // Should stay under 1M gas
  })
})
```

These examples provide comprehensive templates and patterns for testing various aspects of the account-control system. Use them as starting points for your own tests, adapting the patterns to fit your specific testing needs while maintaining consistency with the established helper infrastructure.