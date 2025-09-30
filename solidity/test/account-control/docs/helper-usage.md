# Helper Infrastructure Usage Guide

This guide provides comprehensive documentation for using the helper infrastructure in the account-control test suite. The helper system is designed to provide reusable, standardized utilities that ensure consistent testing patterns across all test files.

## Table of Contents

- [Overview](#overview)
- [Fixtures](#fixtures)
- [Error Helpers](#error-helpers)
- [SPV Helpers](#spv-helpers)
- [Gas Analysis Helpers](#gas-analysis-helpers)
- [Bitcoin Helpers](#bitcoin-helpers)
- [Import Patterns](#import-patterns)
- [Migration from Legacy](#migration-from-legacy)

## Overview

The helper infrastructure is organized into two main categories:

- **Fixtures** (`fixtures/`): Shared test infrastructure and data
- **Helpers** (`helpers/`): Specialized testing utilities

All helpers are designed to work together and provide a consistent testing experience.

## Fixtures

### Base Setup (`fixtures/base-setup.ts`)

The base setup provides standardized test environment initialization and management.

#### Core Functions

```typescript
import {
  createBaseTestEnvironment,
  restoreBaseTestEnvironment,
  setupTestSigners,
  setupTestEnvironment,
  setupRelayForTesting,
  type TestEnvironment,
  type TestSigners
} from "../fixtures/base-setup"
```

#### `createBaseTestEnvironment()`

Creates a complete test environment with snapshot management:

```typescript
describe("Test Suite", () => {
  let testEnv: TestEnvironment

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()
    // Automatically creates snapshot for restoration
  })

  afterEach(async () => {
    await restoreBaseTestEnvironment()
    // Restores to snapshot state
  })
})
```

**Returns:**
```typescript
interface TestEnvironment {
  signers: TestSigners
  blockNumber: number
  timestamp: number
}
```

#### `setupTestSigners()`

Provides standardized signer roles:

```typescript
const signers = await setupTestSigners()
// Available signers:
// - deployer: Contract deployment
// - governance: Governance operations
// - watchdog: Watchdog operations
// - user: Regular user operations
// - liquidator: Liquidation operations
// - qcAddress: QC address operations
// - thirdParty: Third-party operations
```

#### `setupRelayForTesting()`

Configures relay contracts for SPV testing:

```typescript
import { spvTestConfig } from "../fixtures/test-data"

await setupRelayForTesting(relay, spvTestConfig.chainDifficulty)
```

### Test Data (`fixtures/test-data.ts`)

Centralized test constants and data:

```typescript
import {
  bitcoinTestAddresses,
  spvTestConfig,
  testAmounts,
  validLegacyBtc
} from "../fixtures/test-data"

// Bitcoin test addresses
const validP2PKH = bitcoinTestAddresses.p2pkh.valid[0]
const invalidAddress = bitcoinTestAddresses.invalid[0]

// SPV configuration
const difficulty = spvTestConfig.chainDifficulty
const minHeaders = spvTestConfig.minHeadersForProof

// Standard test amounts
const defaultAmount = testAmounts.standard
const largeAmount = testAmounts.large
```

### Mock Factory (`fixtures/mock-factory.ts`)

Consistent mock object creation:

```typescript
import { createMockContracts, createStandardMocks } from "../fixtures/mock-factory"

// Create specific mocks
const mocks = await createMockContracts({
  relay: true,
  oracle: true,
  bridge: false
})

// Create standard mock set
const standardMocks = await createStandardMocks()
```

### Test Factories (`fixtures/test-factories.ts`)

Standardized object creation patterns:

```typescript
import {
  createTestRedemption,
  createTestWalletData,
  createTestSpvProof
} from "../fixtures/test-factories"

const redemption = createTestRedemption({
  amount: ethers.utils.parseEther("1.0"),
  btcAddress: validBtcAddress,
  requester: userAddress
})
```

## Error Helpers

### Basic Error Testing (`helpers/error-helpers.ts`)

#### `expectCustomError()`

Primary method for testing custom errors:

```typescript
import { expectCustomError } from "../helpers/error-helpers"

// Basic custom error
await expectCustomError(
  contract.functionName(invalidParam),
  contractFactory,
  "InvalidParameter"
)

// Custom error with arguments
await expectCustomError(
  contract.withdraw(amount),
  contractFactory,
  "InsufficientBalance",
  currentBalance,
  requestedAmount
)
```

#### `expectRevert()`

For string-based error messages:

```typescript
import { expectRevert, ERROR_MESSAGES } from "../helpers/error-helpers"

await expectRevert(
  contract.legacyFunction(invalidParam),
  ERROR_MESSAGES.INVALID_ADDRESS
)
```

#### Access Control Testing

```typescript
import { createAccessControlTester } from "../helpers/error-helpers"

describe("Access Control", () => {
  let accessTester: ReturnType<typeof createAccessControlTester>

  beforeEach(async () => {
    accessTester = createAccessControlTester(contract)
  })

  it("should restrict governance functions", async () => {
    await accessTester.testOnlyGovernance(
      "governanceFunction",
      [param1, param2],
      nonGovernanceSigner
    )
  })

  it("should restrict watchdog functions", async () => {
    await accessTester.testOnlyWatchdog(
      "watchdogFunction",
      [],
      nonWatchdogSigner
    )
  })
})
```

#### Parameter Validation Testing

```typescript
import { createParameterValidationTester } from "../helpers/error-helpers"

const paramTester = createParameterValidationTester(contract)

// Test zero address rejection
await paramTester.testZeroAddress("setAddress", 0, [otherParams])

// Test invalid amount rejection
await paramTester.testInvalidAmount("transfer", 1, [validAddress])

// Test array length mismatch
await paramTester.testArrayLengthMismatch("batchOperation", 0, 1)
```

#### Batch Invalid Input Testing

```typescript
import { testInvalidInputs } from "../helpers/error-helpers"

await testInvalidInputs(
  contract,
  "functionName",
  [validParam1, validParam2], // Valid arguments baseline
  [
    {
      name: "zero address",
      args: [ethers.constants.AddressZero, validParam2],
      expectedError: "Invalid address"
    },
    {
      name: "invalid amount",
      args: [validParam1, 0],
      expectedError: "Invalid amount"
    }
  ]
)
```

### Error Messages Reference

```typescript
import { ERROR_MESSAGES } from "../helpers/error-helpers"

// SPV related errors
ERROR_MESSAGES.INSUFFICIENT_PROOF_OF_WORK
ERROR_MESSAGES.INVALID_MERKLE_PROOF
ERROR_MESSAGES.INVALID_BLOCK_HEADER
ERROR_MESSAGES.RELAY_NOT_READY

// Wallet control errors
ERROR_MESSAGES.WALLET_NOT_REGISTERED
ERROR_MESSAGES.UNAUTHORIZED_WALLET_ACCESS
ERROR_MESSAGES.INVALID_WALLET_CONTROL_PROOF

// Redemption errors
ERROR_MESSAGES.REDEMPTION_NOT_FOUND
ERROR_MESSAGES.REDEMPTION_ALREADY_FULFILLED
ERROR_MESSAGES.PAYMENT_VERIFICATION_FAILED

// Access control errors
ERROR_MESSAGES.NOT_AUTHORIZED
ERROR_MESSAGES.ONLY_GOVERNANCE
ERROR_MESSAGES.ONLY_WATCHDOG

// General validation errors
ERROR_MESSAGES.INVALID_ADDRESS
ERROR_MESSAGES.ZERO_ADDRESS
ERROR_MESSAGES.INVALID_AMOUNT
ERROR_MESSAGES.ARRAY_LENGTH_MISMATCH
```

## SPV Helpers

### SPV Data Helpers (`helpers/spv-data-helpers.ts`)

#### Mock SPV Data Creation

```typescript
import { createMockSpvData, createRealSpvData } from "../helpers/spv-data-helpers"

// Create mock SPV proof data
const mockSpvData = createMockSpvData({
  txId: "test_transaction_id",
  outputIndex: 0,
  value: ethers.utils.parseEther("1.0"),
  recipientAddress: btcAddress
})

// Use real Bitcoin transaction data
import { validSpvProofs } from "../../data/bitcoin/spv/valid-spv-proofs"
const realSpvData = createRealSpvData(validSpvProofs.mainnet_tx_1)
```

#### SPV Proof Utilities

```typescript
import {
  setupMockRelayForSpv,
  createCompleteSpvTestData,
  createMockWalletControlProof,
  fulfillRedemptionForTest
} from "../helpers/spv-data-helpers"

// Setup relay for SPV testing
await setupMockRelayForSpv(relay, spvData)

// Create complete test data including relay setup
const completeData = await createCompleteSpvTestData(relay, {
  outputValue: amount,
  recipientAddress: btcAddress
})

// Create wallet control proof
const walletProof = createMockWalletControlProof(
  qcAddress,
  btcAddress,
  txInfo,
  proof
)

// Fulfill redemption for testing
await fulfillRedemptionForTest(
  qcRedeemer,
  redemptionId,
  outputValue,
  recipientAddress
)
```

### SPV Testing Utilities (`helpers/spv-helpers.ts`)

Advanced SPV testing functionality:

```typescript
import { SPVTestHelpers } from "../helpers/spv-helpers"

// Validate proof with gas measurement
const { gasUsed, txHash } = await SPVTestHelpers.validateProofWithGas(
  spvValidator,
  spvData,
  { min: 100000, max: 200000 } // Expected gas range
)

// Setup relay difficulty
await SPVTestHelpers.setupRelayDifficulty(relay, spvData)

// Create tampered proofs for security testing
const tamperedProof = SPVTestHelpers.tamperMerkleProof(
  originalProof,
  32 // Position to tamper
)

// Create malformed transaction data
const malformedTxs = SPVTestHelpers.createMalformedTxInfo()

// Parse output vector
const outputs = SPVTestHelpers.parseOutputVector(outputVector)
```

### SPV Security Testing

```typescript
// Test insufficient proof of work
const insufficientHeaders = SPVTestHelpers.truncateHeaders(
  validHeaders,
  2 // Keep only 2 headers instead of required 6
)

// Test with malformed transaction data
const malformedTxs = SPVTestHelpers.createMalformedTxInfo()
for (const [testName, malformedTx] of Object.entries(malformedTxs)) {
  await expectCustomError(
    spvValidator.validateProof(malformedTx, validProof),
    spvValidatorFactory,
    "InvalidTransactionFormat"
  )
}
```

## Gas Analysis Helpers

### Gas Measurement (`helpers/gas-helpers.ts`)

```typescript
import { measureGas, profileGasUsage, assertGasUsed } from "../helpers/gas-helpers"

// Measure single operation gas usage
const gasUsed = await measureGas(async () => {
  return await contract.expensiveOperation(params)
})

// Profile gas across multiple test cases
const testCases = [spvData1, spvData2, spvData3]
const gasProfile = await profileGasUsage(spvValidator, testCases)
console.table(gasProfile)

// Assert gas usage within expected range
assertGasUsed(gasUsed, 100000, 200000)
```

### Gas Profiling Patterns

```typescript
describe("Gas Analysis", () => {
  it("should profile operations", async () => {
    const operations = [
      { name: "small_tx", data: smallTxData },
      { name: "large_tx", data: largeTxData },
      { name: "complex_proof", data: complexProofData }
    ]

    const results = []
    for (const op of operations) {
      const gasUsed = await measureGas(async () => {
        return await contract.processOperation(op.data)
      })
      results.push({ name: op.name, gasUsed })
    }

    console.table(results)

    // Assert gas efficiency
    expect(results[0].gasUsed).to.be.below(150000) // small_tx
    expect(results[1].gasUsed).to.be.below(250000) // large_tx
  })
})
```

## Bitcoin Helpers

### Bitcoin Address Utilities (`helpers/bitcoin-helpers.ts`)

```typescript
import {
  createP2PKHAddress,
  validateBitcoinAddress,
  createP2SHAddress,
  createBech32Address
} from "../helpers/bitcoin-helpers"

// Create Bitcoin addresses for testing
const p2pkhAddress = createP2PKHAddress(pubKeyHash)
const p2shAddress = createP2SHAddress(scriptHash)
const bech32Address = createBech32Address(pubKeyHash)

// Validate Bitcoin addresses
const isValid = validateBitcoinAddress(address, network)
```

### Bitcoin Transaction Utilities

```typescript
import {
  createBitcoinTransaction,
  parseBitcoinTransaction,
  createOutputScript
} from "../helpers/bitcoin-helpers"

// Create Bitcoin transaction for testing
const tx = createBitcoinTransaction({
  inputs: [{ txId, outputIndex, script }],
  outputs: [{ value, script: createOutputScript(address) }]
})

// Parse Bitcoin transaction data
const parsedTx = parseBitcoinTransaction(rawTxData)
```

## Import Patterns

### Modern Import Pattern (Recommended)

```typescript
// Import specific utilities from appropriate modules
import { createBaseTestEnvironment, type TestEnvironment } from "../fixtures/base-setup"
import { expectCustomError, ERROR_MESSAGES } from "../helpers/error-helpers"
import { createMockSpvData, setupMockRelayForSpv } from "../helpers/spv-data-helpers"
import { measureGas, profileGasUsage } from "../helpers/gas-helpers"
import { bitcoinTestAddresses, spvTestConfig } from "../fixtures/test-data"
```

### Legacy Compatibility Pattern

```typescript
// For backward compatibility - imports from consolidated helper
import {
  createMockSpvData,
  bitcoinTestAddresses,
  BitcoinTxInfo,
  BitcoinTxProof
} from "../AccountControlTestHelpers"
```

### Index-based Imports

```typescript
// Import from index files for convenience
import {
  spvHelpers,
  bitcoinHelpers,
  errorHelpers
} from "../helpers"

import {
  testData,
  mockFactory,
  baseSetup
} from "../fixtures"
```

## Migration from Legacy

### Old Pattern (Deprecated)
```typescript
import {
  createMockSpvData,
  bitcoinTestAddresses,
  setupMockRelayForSpv
} from "../AccountControlTestHelpers"
```

### New Pattern (Recommended)
```typescript
import { createMockSpvData, setupMockRelayForSpv } from "../helpers/spv-data-helpers"
import { bitcoinTestAddresses } from "../fixtures/test-data"
import { createBaseTestEnvironment } from "../fixtures/base-setup"
import { expectCustomError } from "../helpers/error-helpers"
```

### Migration Benefits

1. **Better Organization**: Clear separation between fixtures and utilities
2. **Improved Maintainability**: Smaller, focused modules
3. **Enhanced Reusability**: Specific imports reduce bundle size
4. **Type Safety**: Better TypeScript support with modular imports
5. **Testing**: Individual helper modules can be unit tested

### Gradual Migration Strategy

1. **Phase 1**: Keep `AccountControlTestHelpers.ts` as compatibility layer
2. **Phase 2**: Update new tests to use modular imports
3. **Phase 3**: Migrate existing tests file by file
4. **Phase 4**: Remove compatibility layer when all tests migrated

## Best Practices

### Consistent Error Testing
```typescript
// Always use expectCustomError for custom errors
await expectCustomError(
  contract.function(invalidParam),
  contractFactory,
  "ErrorName"
)

// Use ERROR_MESSAGES constants for string errors
await expectRevert(
  contract.legacyFunction(invalidParam),
  ERROR_MESSAGES.INVALID_ADDRESS
)
```

### Standard Environment Setup
```typescript
// Always use createBaseTestEnvironment for consistent setup
let testEnv: TestEnvironment

beforeEach(async () => {
  testEnv = await createBaseTestEnvironment()
})

afterEach(async () => {
  await restoreBaseTestEnvironment()
})
```

### SPV Testing Patterns
```typescript
// Use createMockSpvData for simple cases
const mockData = createMockSpvData({ value: amount })

// Use createRealSpvData for realistic testing
const realData = createRealSpvData(validSpvProofs.mainnet_tx_1)

// Always setup relay properly
await setupMockRelayForSpv(relay, spvData)
```

### Gas Analysis Integration
```typescript
// Measure gas for performance-critical operations
const gasUsed = await measureGas(async () => {
  return await contract.criticalOperation(params)
})

// Assert reasonable gas usage
expect(gasUsed).to.be.below(expectedMaxGas)
```

This helper infrastructure provides a solid foundation for consistent, maintainable testing across the account-control test suite. Use these patterns to ensure your tests are reliable, efficient, and easy to understand.