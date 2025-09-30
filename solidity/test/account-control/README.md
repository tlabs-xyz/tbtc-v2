# Account Control Test Suite

This directory contains the comprehensive test suite for the tBTC v2 account control system. The tests are organized into a modular, maintainable structure that provides clear separation of concerns and reusable infrastructure.

## Directory Structure

```
test/account-control/
├── README.md                           # This file - comprehensive guide
├── docs/                              # Detailed documentation
│   ├── testing-patterns.md           # Best practices and patterns
│   ├── helper-usage.md               # Helper infrastructure guide
│   └── contributing.md               # Guidelines for test development
│
├── fixtures/                         # Shared test infrastructure
│   ├── base-setup.ts                # Standard test environment setup
│   ├── test-data.ts                 # Centralized test constants
│   ├── test-factories.ts            # Test object creation patterns
│   ├── mock-factory.ts              # Consistent mock creation
│   └── validation.test.ts           # Fixture validation tests
│
├── helpers/                          # Specialized testing utilities
│   ├── bitcoin-helpers.ts           # Bitcoin-specific test utilities
│   ├── error-helpers.ts             # Standardized error testing
│   ├── gas-helpers.ts               # Gas usage analysis utilities
│   ├── spv-helpers.ts               # SPV testing infrastructure
│   └── spv-data-helpers.ts          # SPV data generation utilities
│
├── core-contracts/                  # QC financial operation tests
│   ├── qc-data.test.ts             # QC data structure tests
│   ├── qc-manager.test.ts          # QC manager functionality
│   ├── qc-minter.test.ts           # QC minting operations
│   ├── qc-redeemer.test.ts         # QC redemption operations
│   └── qc-redeemer-wallet-obligations.test.ts # Wallet obligation tests
│
├── system-management/               # System state and oracle tests
│   ├── system-state.test.ts        # System state management
│   ├── reserve-oracle.test.ts      # Oracle functionality
│   └── watchdog-enforcer.test.ts   # Watchdog enforcement
│
├── spv-functionality/               # SPV and Bitcoin integration tests
│   ├── spv-proofs.test.ts          # SPV proof validation
│   ├── spv-security.test.ts        # SPV security testing
│   ├── spv-libraries.test.ts       # SPV library integration
│   ├── payment-verification.test.ts # Payment verification
│   └── wallet-registration.test.ts  # Wallet registration
│
├── integration/                     # Cross-contract and end-to-end tests
│   ├── cross-contract.test.ts      # Multi-contract interactions
│   ├── end-to-end-flows.test.ts    # Complete user workflows
│   ├── mock-integration.test.ts    # Mock-based integration tests
│   └── oracle-integration.test.ts   # Oracle integration scenarios
│
├── bitcoin-integration/             # Bitcoin address and transaction tests
│   └── address-handling.test.ts    # Bitcoin address validation
│
└── Legacy Files (being migrated)
    ├── AccountControl*.test.ts      # Original test files
    ├── BitcoinAddress*.test.ts      # Address utility tests
    ├── SPV*.test.ts                 # SPV-related legacy tests
    └── SystemState*.test.ts         # System state legacy tests
```

## Quick Start

### Running Tests

```bash
# Run all account-control tests
npm test test/account-control

# Run specific test categories
npm test test/account-control/core-contracts
npm test test/account-control/spv-functionality
npm test test/account-control/integration

# Run individual test files
npm test test/account-control/core-contracts/qc-manager.test.ts
```

### Basic Test Setup

All tests should use the standardized base setup:

```typescript
import { createBaseTestEnvironment, restoreBaseTestEnvironment } from "../fixtures/base-setup"
import { expectCustomError } from "../helpers/error-helpers"

describe("Your Test Suite", () => {
  let testEnv: TestEnvironment

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()
  })

  afterEach(async () => {
    await restoreBaseTestEnvironment()
  })

  it("should demonstrate standardized testing", async () => {
    const { signers } = testEnv

    // Use standardized error testing
    await expectCustomError(
      contract.someFunction(),
      ContractFactory,
      "ExpectedError"
    )
  })
})
```

## Test Categories

### Core Contracts (`core-contracts/`)
Tests for the primary QC (Qualified Custodian) financial operations:
- **QC Data**: Data structure validation and manipulation
- **QC Manager**: Central management functionality
- **QC Minter**: Token minting operations and validations
- **QC Redeemer**: Token redemption and Bitcoin payment processing
- **Wallet Obligations**: Wallet management and obligation tracking

### System Management (`system-management/`)
Tests for system-level state and external integrations:
- **System State**: Global system state management and transitions
- **Reserve Oracle**: Price feed and reserve ratio calculations
- **Watchdog Enforcer**: Security monitoring and emergency procedures

### SPV Functionality (`spv-functionality/`)
Tests for Simplified Payment Verification and Bitcoin integration:
- **SPV Proofs**: Bitcoin transaction proof validation
- **SPV Security**: Security testing for proof manipulation attacks
- **SPV Libraries**: Integration with Bitcoin SPV libraries
- **Payment Verification**: Bitcoin payment confirmation
- **Wallet Registration**: Bitcoin wallet control proof validation

### Integration (`integration/`)
Tests for cross-contract interactions and complete workflows:
- **Cross-Contract**: Multi-contract interaction testing
- **End-to-End Flows**: Complete user journey testing
- **Mock Integration**: Integration testing with mocked dependencies
- **Oracle Integration**: Oracle system integration scenarios

### Bitcoin Integration (`bitcoin-integration/`)
Tests specific to Bitcoin address and transaction handling:
- **Address Handling**: Bitcoin address validation and utilities

## Helper Infrastructure

### Fixtures (`fixtures/`)
Shared infrastructure for consistent test environments:

- **`base-setup.ts`**: Standard test environment initialization
- **`test-data.ts`**: Centralized constants and test data
- **`test-factories.ts`**: Standardized object creation patterns
- **`mock-factory.ts`**: Consistent mock object creation

### Helpers (`helpers/`)
Specialized utilities for common testing patterns:

- **`error-helpers.ts`**: Standardized error testing with `expectCustomError()`
- **`spv-helpers.ts`**: SPV testing utilities and proof generation
- **`gas-helpers.ts`**: Gas usage analysis and profiling
- **`bitcoin-helpers.ts`**: Bitcoin-specific testing utilities

## Testing Patterns

### Standard Test Structure
```typescript
describe("ContractName", () => {
  let testEnv: TestEnvironment
  let contract: ContractType

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()
    // Contract-specific setup
  })

  describe("functionName", () => {
    it("should handle valid inputs correctly", async () => {
      // Positive test cases
    })

    it("should reject invalid inputs with appropriate errors", async () => {
      // Negative test cases using error helpers
    })

    it("should maintain proper access control", async () => {
      // Access control testing
    })
  })
})
```

### Error Testing
```typescript
// Use standardized error testing
await expectCustomError(
  contract.someFunction(invalidParam),
  ContractFactory,
  "InvalidParameter"
)

// Test with error arguments
await expectCustomError(
  contract.withdraw(amount),
  ContractFactory,
  "InsufficientBalance",
  expectedBalance,
  amount
)
```

### SPV Testing
```typescript
import { createMockSpvData, setupMockRelayForSpv } from "../helpers/spv-data-helpers"

const spvData = createMockSpvData({
  txId: "example_tx_id",
  outputIndex: 0,
  value: ethers.utils.parseEther("1.0")
})

await setupMockRelayForSpv(relay, spvData)
```

## Documentation

- **[Testing Patterns](./docs/testing-patterns.md)**: Comprehensive guide to testing best practices
- **[Helper Usage](./docs/helper-usage.md)**: Detailed documentation of helper functions
- **[Contributing](./docs/contributing.md)**: Guidelines for adding new tests

## Legacy Migration

This test suite represents a refactored and improved version of the original account-control tests. Legacy files are being gradually migrated to the new structure:

### Migration Status
- ✅ Helper infrastructure established
- ✅ Core contracts organized and improved
- ✅ System management tests reorganized
- ✅ SPV functionality consolidated
- ✅ Integration tests enhanced
- 🔄 Legacy file cleanup in progress

### Backward Compatibility
The `AccountControlTestHelpers.ts` file provides backward compatibility by re-exporting from the new modular structure. For new code, import directly from the appropriate helper modules.

## Performance and Gas Analysis

Gas usage analysis is integrated into the test infrastructure:

```typescript
import { profileGasUsage } from "../helpers/gas-helpers"

const gasProfile = await profileGasUsage(contract, testCases)
console.table(gasProfile)
```

## Security Testing

Security testing patterns are standardized across the test suite:
- SPV proof manipulation testing
- Access control validation
- Parameter validation testing
- Edge case boundary testing

## Continuous Integration

Tests are designed to be:
- **Fast**: Efficient setup and teardown
- **Reliable**: Deterministic and isolated
- **Comprehensive**: Full coverage of functionality
- **Maintainable**: Clear structure and documentation

For questions or contributions, see [Contributing Guidelines](./docs/contributing.md).