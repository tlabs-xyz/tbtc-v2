# Testing Patterns and Best Practices

This guide provides comprehensive testing patterns and best practices for the account-control test suite. These patterns ensure consistency, maintainability, and thorough coverage across all test files.

## Table of Contents

- [Standard Test Structure](#standard-test-structure)
- [Environment Setup Patterns](#environment-setup-patterns)
- [Error Testing Patterns](#error-testing-patterns)
- [SPV Testing Patterns](#spv-testing-patterns)
- [Gas Analysis Patterns](#gas-analysis-patterns)
- [Mock Usage Patterns](#mock-usage-patterns)
- [Data Validation Patterns](#data-validation-patterns)
- [Security Testing Patterns](#security-testing-patterns)
- [Integration Testing Patterns](#integration-testing-patterns)

## Standard Test Structure

### Basic Test File Template

```typescript
import { ethers } from "hardhat"
import { expect } from "chai"
import type { ContractType } from "../../../typechain"
import {
  createBaseTestEnvironment,
  restoreBaseTestEnvironment,
  type TestEnvironment
} from "../fixtures/base-setup"
import { expectCustomError, ERROR_MESSAGES } from "../helpers/error-helpers"
import { testDataConstants } from "../fixtures/test-data"

describe("ContractName", () => {
  let testEnv: TestEnvironment
  let contract: ContractType
  let contractFactory: any

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()

    // Deploy contract under test
    contractFactory = await ethers.getContractFactory("ContractName")
    contract = await contractFactory.deploy(/* constructor args */)
    await contract.deployed()
  })

  afterEach(async () => {
    await restoreBaseTestEnvironment()
  })

  describe("Deployment", () => {
    it("should deploy with correct initial state", async () => {
      // Verify initial state
    })

    it("should reject invalid constructor parameters", async () => {
      await expectCustomError(
        contractFactory.deploy(/* invalid args */),
        contractFactory,
        "InvalidParameter"
      )
    })
  })

  describe("functionName", () => {
    it("should execute successfully with valid parameters", async () => {
      // Positive test case
      const result = await contract.functionName(validParams)
      expect(result).to.equal(expectedValue)
    })

    it("should reject invalid parameters", async () => {
      await expectCustomError(
        contract.functionName(invalidParams),
        contractFactory,
        "InvalidParameter"
      )
    })

    it("should enforce access control", async () => {
      const { signers } = testEnv

      await expectCustomError(
        contract.connect(signers.user).functionName(validParams),
        contractFactory,
        "Unauthorized"
      )
    })

    it("should emit expected events", async () => {
      await expect(contract.functionName(validParams))
        .to.emit(contract, "EventName")
        .withArgs(expectedArgs)
    })
  })
})
```

## Environment Setup Patterns

### Standard Environment Setup

```typescript
import { createBaseTestEnvironment, type TestEnvironment } from "../fixtures/base-setup"

describe("Test Suite", () => {
  let testEnv: TestEnvironment

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()
    // testEnv provides:
    // - signers: { deployer, governance, watchdog, user, liquidator, qcAddress, thirdParty }
    // - blockNumber: current block number
    // - timestamp: current timestamp
  })
})
```

### Custom Environment Setup

```typescript
import { setupTestEnvironment, setupRelayForTesting } from "../fixtures/base-setup"
import { spvTestConfig } from "../fixtures/test-data"

describe("SPV Test Suite", () => {
  let testEnv: TestEnvironment
  let relay: LightRelayStub
  let spvValidator: SPVValidator

  beforeEach(async () => {
    testEnv = await setupTestEnvironment()

    // Deploy SPV-specific contracts
    const relayFactory = await ethers.getContractFactory("LightRelayStub")
    relay = await relayFactory.deploy()

    const validatorFactory = await ethers.getContractFactory("SPVValidator")
    spvValidator = await validatorFactory.deploy(relay.address)

    // Setup relay with appropriate configuration
    await setupRelayForTesting(relay, spvTestConfig.chainDifficulty)
  })
})
```

## Error Testing Patterns

### Basic Error Testing

```typescript
import { expectCustomError, expectRevert, ERROR_MESSAGES } from "../helpers/error-helpers"

// Test custom errors with factory reference
await expectCustomError(
  contract.functionName(invalidParam),
  contractFactory,
  "InvalidParameter"
)

// Test custom errors with arguments
await expectCustomError(
  contract.withdraw(amount),
  contractFactory,
  "InsufficientBalance",
  currentBalance,
  attemptedAmount
)

// Test string-based error messages
await expectRevert(
  contract.legacyFunction(invalidParam),
  ERROR_MESSAGES.INVALID_ADDRESS
)
```

### Access Control Testing

```typescript
import { createAccessControlTester } from "../helpers/error-helpers"

describe("Access Control", () => {
  let accessControlTester: ReturnType<typeof createAccessControlTester>

  beforeEach(async () => {
    accessControlTester = createAccessControlTester(contract)
  })

  it("should restrict governance functions", async () => {
    const { signers } = testEnv

    await accessControlTester.testOnlyGovernance(
      "governanceFunction",
      [param1, param2],
      signers.user
    )
  })

  it("should restrict watchdog functions", async () => {
    const { signers } = testEnv

    await accessControlTester.testOnlyWatchdog(
      "watchdogFunction",
      [param1],
      signers.user
    )
  })
})
```

### Parameter Validation Testing

```typescript
import { createParameterValidationTester } from "../helpers/error-helpers"

describe("Parameter Validation", () => {
  let paramTester: ReturnType<typeof createParameterValidationTester>

  beforeEach(async () => {
    paramTester = createParameterValidationTester(contract)
  })

  it("should reject zero addresses", async () => {
    await paramTester.testZeroAddress("setAddress", 0, [otherParam])
  })

  it("should reject invalid amounts", async () => {
    await paramTester.testInvalidAmount("transfer", 1, [validAddress])
  })

  it("should reject array length mismatches", async () => {
    await paramTester.testArrayLengthMismatch("batchOperation", 0, 1)
  })
})
```

## SPV Testing Patterns

### Basic SPV Proof Testing

```typescript
import { createMockSpvData, setupMockRelayForSpv } from "../helpers/spv-data-helpers"
import { SPVTestHelpers } from "../helpers/spv-test-helpers-legacy"

describe("SPV Functionality", () => {
  it("should validate correct SPV proofs", async () => {
    // Create mock SPV data
    const spvData = createMockSpvData({
      txId: "example_transaction_id",
      outputIndex: 0,
      value: ethers.utils.parseEther("1.0")
    })

    // Setup relay for SPV validation
    await setupMockRelayForSpv(relay, spvData)

    // Validate proof with gas analysis
    const { gasUsed, txHash } = await SPVTestHelpers.validateProofWithGas(
      spvValidator,
      spvData,
      { min: 100000, max: 200000 } // Expected gas range
    )

    expect(gasUsed).to.be.within(100000, 200000)
    expect(txHash).to.match(/^0x[a-fA-F0-9]{64}$/)
  })

  it("should reject tampered proofs", async () => {
    const validProof = createMockSpvData({...})
    const tamperedProof = {
      ...validProof,
      proof: {
        ...validProof.proof,
        merkleProof: SPVTestHelpers.tamperMerkleProof(
          validProof.proof.merkleProof,
          32
        )
      }
    }

    await expectCustomError(
      spvValidator.validateProof(tamperedProof.txInfo, tamperedProof.proof),
      spvValidatorFactory,
      "InvalidMerkleProof"
    )
  })
})
```

### Real Bitcoin Data Testing

```typescript
import { createRealSpvData } from "../helpers/spv-data-helpers"
import { validSpvProofs } from "../../data/bitcoin/spv/valid-spv-proofs"

describe("Real Bitcoin Data", () => {
  it("should validate real Bitcoin transactions", async () => {
    // Use real Bitcoin transaction data
    const realSpvData = createRealSpvData(validSpvProofs.mainnet_tx_1)

    await SPVTestHelpers.setupRelayDifficulty(relay, realSpvData)

    const result = await SPVTestHelpers.validateProofWithGas(
      spvValidator,
      realSpvData
    )

    expect(result.gasUsed).to.be.below(300000) // Real data should be efficient
  })
})
```

## Gas Analysis Patterns

### Gas Profiling

```typescript
import { profileGasUsage, measureGas } from "../helpers/gas-helpers"

describe("Gas Analysis", () => {
  it("should profile gas usage across test cases", async () => {
    const testCases = [
      createMockSpvData({ name: "small_tx" }),
      createMockSpvData({ name: "large_tx", outputCount: 10 }),
      createMockSpvData({ name: "complex_proof" })
    ]

    const gasProfile = await profileGasUsage(spvValidator, testCases)

    console.table(gasProfile) // Display gas usage table

    // Assert gas usage expectations
    expect(gasProfile[0].gasUsed).to.be.below(150000) // small_tx
    expect(gasProfile[1].gasUsed).to.be.below(250000) // large_tx
  })

  it("should measure individual operation gas usage", async () => {
    const gasUsed = await measureGas(async () => {
      return await contract.expensiveOperation(params)
    })

    expect(gasUsed).to.be.within(100000, 200000)
  })
})
```

## Mock Usage Patterns

### Consistent Mock Creation

```typescript
import { createMockContracts, createMockSpvData } from "../fixtures/mock-factory"

describe("Mock Integration", () => {
  let mocks: ReturnType<typeof createMockContracts>

  beforeEach(async () => {
    mocks = await createMockContracts({
      relay: true,
      oracle: true,
      bridge: false // Don't mock bridge for this test
    })

    // Configure mocks
    await mocks.relay.setCurrentEpochDifficulty(testConfig.chainDifficulty)
    await mocks.oracle.setPrice(testConfig.btcPrice)
  })

  it("should work with mocked dependencies", async () => {
    const result = await contract.operationUsingMocks(params)
    expect(result).to.equal(expectedResult)

    // Verify mock interactions
    expect(await mocks.relay.getCallCount("setCurrentEpochDifficulty")).to.equal(1)
  })
})
```

## Data Validation Patterns

### Test Data Consistency

```typescript
import { validateTestData } from "../fixtures/base-setup"
import { bitcoinTestAddresses, spvTestConfig } from "../fixtures/test-data"

describe("Data Validation", () => {
  it("should use consistent test data", async () => {
    // Validate test data integrity
    expect(validateTestData(bitcoinTestAddresses)).to.be.true
    expect(validateTestData(spvTestConfig)).to.be.true

    // Use standardized test constants
    const validAddress = bitcoinTestAddresses.p2pkh.valid[0]
    const difficulty = spvTestConfig.chainDifficulty

    await contract.processAddress(validAddress, difficulty)
  })
})
```

## Security Testing Patterns

### Proof Manipulation Testing

```typescript
import { SPVTestHelpers } from "../helpers/spv-test-helpers-legacy"

describe("Security Tests", () => {
  it("should reject proofs with insufficient work", async () => {
    const validProof = createMockSpvData({...})
    const insufficientWorkProof = {
      ...validProof,
      proof: {
        ...validProof.proof,
        bitcoinHeaders: SPVTestHelpers.truncateHeaders(
          validProof.proof.bitcoinHeaders,
          2 // Only 2 headers instead of required 6
        )
      }
    }

    await expectCustomError(
      spvValidator.validateProof(insufficientWorkProof.txInfo, insufficientWorkProof.proof),
      spvValidatorFactory,
      "InsufficientProofOfWork"
    )
  })

  it("should handle malformed transaction data", async () => {
    const malformedTxs = SPVTestHelpers.createMalformedTxInfo()

    for (const [testName, malformedTx] of Object.entries(malformedTxs)) {
      await expectCustomError(
        spvValidator.validateProof(malformedTx, validProof),
        spvValidatorFactory,
        "InvalidTransactionFormat",
        `Failed on ${testName}`
      )
    }
  })
})
```

### Boundary Testing

```typescript
describe("Boundary Tests", () => {
  it("should handle edge case values", async () => {
    const edgeCases = [
      { value: 0, description: "zero value" },
      { value: 1, description: "minimum value" },
      { value: ethers.constants.MaxUint256, description: "maximum value" }
    ]

    for (const testCase of edgeCases) {
      // Test should either succeed or fail with expected error
      const result = await safeCall(() =>
        contract.handleValue(testCase.value)
      )

      if (!result.success) {
        // If it fails, ensure it's an expected error
        expect(result.error).to.include("overflow")
      } else {
        // If it succeeds, verify the result is reasonable
        expect(result.result).to.be.a("object")
      }
    }
  })
})
```

## Integration Testing Patterns

### Cross-Contract Integration

```typescript
describe("Cross-Contract Integration", () => {
  let qcManager: QCManager
  let qcRedeemer: QCRedeemer
  let systemState: SystemState

  beforeEach(async () => {
    // Deploy integrated system
    const deploymentResult = await deployIntegratedSystem(testEnv.signers.deployer)
    qcManager = deploymentResult.qcManager
    qcRedeemer = deploymentResult.qcRedeemer
    systemState = deploymentResult.systemState
  })

  it("should handle complete redemption workflow", async () => {
    const { signers } = testEnv

    // Step 1: Request redemption
    const redemptionTx = await qcManager
      .connect(signers.user)
      .requestRedemption(redemptionAmount, btcAddress)

    // Step 2: Verify state changes
    const redemptionId = await getRedemptionIdFromTx(redemptionTx)
    const redemptionData = await qcRedeemer.getRedemption(redemptionId)
    expect(redemptionData.status).to.equal(RedemptionStatus.Pending)

    // Step 3: Process redemption
    const spvData = createMockSpvData({
      outputValue: redemptionAmount,
      recipientAddress: btcAddress
    })

    await qcRedeemer.fulfillRedemption(redemptionId, spvData.txInfo, spvData.proof)

    // Step 4: Verify final state
    const finalRedemptionData = await qcRedeemer.getRedemption(redemptionId)
    expect(finalRedemptionData.status).to.equal(RedemptionStatus.Fulfilled)
  })
})
```

### End-to-End Flow Testing

```typescript
describe("End-to-End Flows", () => {
  it("should handle complete user journey", async () => {
    const { signers } = testEnv
    const user = signers.user

    // 1. User deposits Bitcoin (simulated via SPV proof)
    const depositSpvData = createMockSpvData({
      value: ethers.utils.parseEther("1.0"),
      outputScript: createP2PKHScript(user.address)
    })

    await qcManager.connect(user).provideWalletControlProof(
      depositSpvData.txInfo,
      depositSpvData.proof
    )

    // 2. User mints tBTC
    const mintAmount = ethers.utils.parseEther("0.9") // 90% of deposit
    await qcMinter.connect(user).mint(mintAmount)

    // 3. Verify user balance
    const userBalance = await tbtcToken.balanceOf(user.address)
    expect(userBalance).to.equal(mintAmount)

    // 4. User redeems tBTC
    const redemptionTx = await qcRedeemer
      .connect(user)
      .requestRedemption(mintAmount, bitcoinTestAddresses.p2pkh.valid[0])

    // 5. Process redemption
    const redemptionId = await getRedemptionIdFromTx(redemptionTx)
    const fulfillmentSpvData = createMockSpvData({
      value: mintAmount,
      recipientAddress: bitcoinTestAddresses.p2pkh.valid[0]
    })

    await qcRedeemer.fulfillRedemption(
      redemptionId,
      fulfillmentSpvData.txInfo,
      fulfillmentSpvData.proof
    )

    // 6. Verify final state
    const finalBalance = await tbtcToken.balanceOf(user.address)
    expect(finalBalance).to.equal(0)
  })
})
```

## Performance Testing Patterns

### Load Testing

```typescript
describe("Performance Tests", () => {
  it("should handle multiple concurrent operations", async () => {
    const concurrentOperations = Array.from({ length: 10 }, (_, i) =>
      contract.processOperation(i, testData[i])
    )

    const startTime = Date.now()
    const results = await Promise.all(concurrentOperations)
    const endTime = Date.now()

    expect(results).to.have.length(10)
    expect(endTime - startTime).to.be.below(5000) // Should complete within 5 seconds
  })
})
```

These patterns provide a comprehensive foundation for testing in the account-control test suite. They ensure consistency, thorough coverage, and maintainable test code across all test categories.