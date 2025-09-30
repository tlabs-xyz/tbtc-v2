# Contributing Guidelines for Account Control Tests

This guide provides comprehensive guidelines for contributing to the account-control test suite. Following these guidelines ensures consistency, maintainability, and high-quality test coverage across the entire codebase.

## Table of Contents

- [Getting Started](#getting-started)
- [Test Organization](#test-organization)
- [Writing New Tests](#writing-new-tests)
- [Code Style Guidelines](#code-style-guidelines)
- [Testing Standards](#testing-standards)
- [Helper Usage](#helper-usage)
- [Error Testing Requirements](#error-testing-requirements)
- [Documentation Requirements](#documentation-requirements)
- [Code Review Guidelines](#code-review-guidelines)
- [Performance Considerations](#performance-considerations)

## Getting Started

### Prerequisites

Before contributing to the test suite, ensure you have:

1. Node.js (version specified in `.nvmrc`)
2. Yarn package manager
3. Hardhat development environment
4. Understanding of Solidity and TypeScript
5. Familiarity with Chai testing framework

### Setup

```bash
# Install dependencies
yarn install

# Run existing tests to verify setup
yarn test test/account-control

# Run specific test category
yarn test test/account-control/core-contracts
```

### Development Workflow

1. **Create feature branch**: `git checkout -b feature/test-improvement`
2. **Write tests**: Follow patterns in this guide
3. **Run tests**: Ensure all tests pass
4. **Submit PR**: Include description and test coverage information

## Test Organization

### Directory Structure Guidelines

Place new tests in the appropriate directory based on functionality:

```
test/account-control/
├── core-contracts/         # QC financial operations
├── system-management/      # System state and oracles
├── spv-functionality/      # SPV and Bitcoin integration
├── integration/           # Cross-contract and end-to-end
├── bitcoin-integration/   # Bitcoin-specific functionality
├── fixtures/             # Shared test infrastructure
└── helpers/              # Testing utilities
```

### Naming Conventions

#### File Naming
- Use kebab-case: `qc-manager.test.ts`
- Include `.test.ts` suffix
- Match contract names: `QCManager` → `qc-manager.test.ts`
- Group related functionality: `qc-redeemer-wallet-obligations.test.ts`

#### Test Naming
- Use descriptive names: `"should reject redemption with insufficient balance"`
- Start with action: `"should"`, `"must"`, `"cannot"`
- Include context: `"when user is not authorized"`
- Be specific: `"should emit RedemptionRequested event with correct parameters"`

### Test Categorization

#### Core Contracts
- Financial operations (mint, redeem, transfer)
- Data structure validation
- State management
- Access control

#### System Management
- System state transitions
- Oracle integrations
- Emergency procedures
- Governance operations

#### SPV Functionality
- Bitcoin transaction validation
- Proof verification
- Security testing
- Performance analysis

#### Integration
- Multi-contract workflows
- End-to-end user journeys
- Cross-system interactions
- Mock integration testing

## Writing New Tests

### Basic Test Template

```typescript
import { ethers } from "hardhat"
import { expect } from "chai"
import type { ContractName } from "../../../typechain"
import {
  createBaseTestEnvironment,
  restoreBaseTestEnvironment,
  type TestEnvironment
} from "../fixtures/base-setup"
import { expectCustomError } from "../helpers/error-helpers"
import { testConstants } from "../fixtures/test-data"

describe("ContractName", () => {
  let testEnv: TestEnvironment
  let contract: ContractName
  let contractFactory: any

  beforeEach(async () => {
    testEnv = await createBaseTestEnvironment()

    contractFactory = await ethers.getContractFactory("ContractName")
    contract = await contractFactory.deploy(/* constructor args */)
    await contract.deployed()
  })

  afterEach(async () => {
    await restoreBaseTestEnvironment()
  })

  describe("Deployment", () => {
    it("should deploy with correct initial state", async () => {
      // Test initial state
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
    })

    it("should reject invalid parameters with appropriate error", async () => {
      // Negative test case
    })

    it("should enforce access control", async () => {
      // Access control test
    })

    it("should emit expected events", async () => {
      // Event testing
    })
  })
})
```

### Required Test Categories

Every contract should include tests for:

1. **Deployment**
   - Initial state validation
   - Constructor parameter validation

2. **Core Functionality**
   - Primary function testing
   - Edge case handling
   - State transition validation

3. **Error Handling**
   - Invalid parameter rejection
   - Access control enforcement
   - Boundary condition testing

4. **Events**
   - Event emission verification
   - Event parameter validation

5. **Integration**
   - Inter-contract communication
   - External dependency interaction

## Code Style Guidelines

### TypeScript Standards

```typescript
// Use explicit types for contract interfaces
let contract: QCManager
let contractFactory: QCManager__factory

// Use const assertions for test data
const testAmounts = {
  small: ethers.utils.parseEther("0.1"),
  standard: ethers.utils.parseEther("1.0"),
  large: ethers.utils.parseEther("10.0")
} as const

// Use async/await consistently
const result = await contract.functionName(params)
expect(result).to.equal(expectedValue)
```

### Import Organization

```typescript
// 1. Node modules
import { ethers } from "hardhat"
import { expect } from "chai"

// 2. Type imports
import type { ContractName } from "../../../typechain"
import type { TestEnvironment } from "../fixtures/base-setup"

// 3. Fixtures and test infrastructure
import { createBaseTestEnvironment } from "../fixtures/base-setup"
import { testConstants } from "../fixtures/test-data"

// 4. Helper utilities
import { expectCustomError } from "../helpers/error-helpers"
import { createMockSpvData } from "../helpers/spv-data-helpers"
```

### Variable Naming

```typescript
// Use descriptive names
const redemptionAmount = ethers.utils.parseEther("1.0")
const btcRecipientAddress = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"

// Use consistent prefixes
const mockSpvData = createMockSpvData({...})
const testSigners = await setupTestSigners()
const validInputs = {...}
const invalidInputs = {...}
```

## Testing Standards

### Test Coverage Requirements

- **Statement Coverage**: Minimum 95%
- **Branch Coverage**: Minimum 90%
- **Function Coverage**: 100%
- **Line Coverage**: Minimum 95%

### Test Quality Standards

1. **Independence**: Each test should be completely independent
2. **Clarity**: Test purpose should be immediately clear
3. **Completeness**: Cover all execution paths
4. **Performance**: Tests should complete quickly (< 30 seconds per file)

### Required Test Patterns

#### Positive Testing
```typescript
it("should process valid redemption request", async () => {
  const { signers } = testEnv
  const redemptionAmount = ethers.utils.parseEther("1.0")

  const tx = await contract
    .connect(signers.user)
    .requestRedemption(redemptionAmount, validBtcAddress)

  await expect(tx)
    .to.emit(contract, "RedemptionRequested")
    .withArgs(signers.user.address, redemptionAmount, validBtcAddress)
})
```

#### Negative Testing
```typescript
it("should reject redemption with insufficient balance", async () => {
  const { signers } = testEnv
  const excessiveAmount = ethers.utils.parseEther("1000.0")

  await expectCustomError(
    contract.connect(signers.user).requestRedemption(excessiveAmount, validBtcAddress),
    contractFactory,
    "InsufficientBalance",
    currentBalance,
    excessiveAmount
  )
})
```

#### Access Control Testing
```typescript
it("should restrict governance functions to governance role", async () => {
  const { signers } = testEnv

  await expectCustomError(
    contract.connect(signers.user).governanceFunction(params),
    contractFactory,
    "Unauthorized"
  )
})
```

#### Event Testing
```typescript
it("should emit events with correct parameters", async () => {
  const expectedEventArgs = [param1, param2, param3]

  await expect(contract.functionName(inputs))
    .to.emit(contract, "EventName")
    .withArgs(...expectedEventArgs)
})
```

## Helper Usage

### Required Helper Usage

#### Environment Setup
```typescript
// ALWAYS use standardized environment setup
beforeEach(async () => {
  testEnv = await createBaseTestEnvironment()
})

afterEach(async () => {
  await restoreBaseTestEnvironment()
})
```

#### Error Testing
```typescript
// ALWAYS use expectCustomError for custom errors
await expectCustomError(
  contract.function(invalidParam),
  contractFactory,
  "ErrorName"
)

// Use ERROR_MESSAGES for string errors
await expectRevert(
  contract.legacyFunction(invalidParam),
  ERROR_MESSAGES.INVALID_ADDRESS
)
```

#### SPV Testing
```typescript
// Use helper utilities for SPV data
const spvData = createMockSpvData({
  value: amount,
  recipientAddress: btcAddress
})

await setupMockRelayForSpv(relay, spvData)
```

### Helper Extension Guidelines

When adding new helper functions:

1. **Placement**: Add to appropriate helper module
2. **Documentation**: Include JSDoc comments
3. **Testing**: Add unit tests for helper functions
4. **Exports**: Update index files appropriately

```typescript
/**
 * Creates mock redemption data for testing
 * @param options Redemption configuration options
 * @returns Mock redemption data object
 */
export function createMockRedemption(options: {
  amount: BigNumber
  btcAddress: string
  requester: string
}): MockRedemptionData {
  // Implementation
}
```

## Error Testing Requirements

### Custom Error Testing

```typescript
// Required format for custom errors
await expectCustomError(
  contractCall,
  contractFactory,
  "ErrorName",
  ...expectedArgs // Include if error has parameters
)
```

### String Error Testing

```typescript
// Use constants for string errors
await expectRevert(
  contractCall,
  ERROR_MESSAGES.SPECIFIC_ERROR
)
```

### Error Coverage Requirements

Every function must have negative tests for:

1. **Parameter Validation**
   - Zero address checks
   - Invalid amounts
   - Array length mismatches
   - Range validations

2. **Access Control**
   - Unauthorized access attempts
   - Role-based restrictions
   - Permission validations

3. **State Validations**
   - Invalid state transitions
   - Precondition failures
   - Business rule violations

4. **External Failures**
   - External contract failures
   - Oracle failures
   - Network condition failures

## Documentation Requirements

### Test Documentation

```typescript
describe("QCManager", () => {
  /**
   * Test suite for QC Manager functionality
   * Covers redemption, minting, and wallet management
   */

  describe("requestRedemption", () => {
    /**
     * Tests for redemption request functionality
     * - Valid redemption processing
     * - Invalid parameter handling
     * - Access control enforcement
     * - Event emission verification
     */

    it("should process valid redemption with correct state changes", async () => {
      // Test description explains the specific scenario being tested
    })
  })
})
```

### Inline Comments

```typescript
it("should handle complex SPV validation scenario", async () => {
  // Setup: Create SPV data with multiple outputs
  const complexSpvData = createMockSpvData({
    outputCount: 3,
    value: ethers.utils.parseEther("2.5")
  })

  // Execute: Validate the complex proof
  const result = await spvValidator.validateProof(
    complexSpvData.txInfo,
    complexSpvData.proof
  )

  // Verify: Ensure proper gas usage for complex proofs
  expect(result.gasUsed).to.be.within(200000, 300000)
})
```

### README Updates

When adding new test categories or patterns:

1. Update main README.md
2. Update relevant documentation files
3. Add examples to helper-usage.md
4. Update testing-patterns.md if introducing new patterns

## Code Review Guidelines

### Review Checklist

#### Test Quality
- [ ] Tests are independent and isolated
- [ ] Descriptive test names and descriptions
- [ ] Comprehensive coverage of functionality
- [ ] Appropriate use of helper infrastructure
- [ ] Proper error testing patterns

#### Code Quality
- [ ] Follows TypeScript style guidelines
- [ ] Proper import organization
- [ ] Consistent variable naming
- [ ] No magic numbers or hard-coded values
- [ ] Appropriate use of constants

#### Documentation
- [ ] Test purpose is clear
- [ ] Complex logic is commented
- [ ] Helper functions are documented
- [ ] README updates if needed

#### Performance
- [ ] Tests complete in reasonable time
- [ ] No unnecessary contract deployments
- [ ] Efficient use of beforeEach/afterEach
- [ ] Proper cleanup and restoration

### Common Review Comments

#### Test Organization
```typescript
// ❌ Poor test organization
it("test redemption", async () => {
  // Multiple unrelated assertions
})

// ✅ Well-organized tests
describe("requestRedemption", () => {
  it("should emit RedemptionRequested event", async () => {
    // Single, focused assertion
  })

  it("should update user balance correctly", async () => {
    // Single, focused assertion
  })
})
```

#### Error Testing
```typescript
// ❌ Poor error testing
try {
  await contract.function(invalidParam)
  expect.fail("Should have thrown")
} catch (error) {
  expect(error.message).to.include("Invalid")
}

// ✅ Proper error testing
await expectCustomError(
  contract.function(invalidParam),
  contractFactory,
  "InvalidParameter"
)
```

#### Helper Usage
```typescript
// ❌ Manual setup
const [deployer, user] = await ethers.getSigners()
const snapshot = await helpers.snapshot.createSnapshot()

// ✅ Helper usage
const testEnv = await createBaseTestEnvironment()
```

## Performance Considerations

### Test Execution Performance

1. **Minimize Contract Deployments**
   ```typescript
   // ❌ Deploy in every test
   it("should test function", async () => {
     const contract = await deployContract()
     // test logic
   })

   // ✅ Deploy once per describe block
   describe("ContractName", () => {
     let contract: ContractType

     beforeEach(async () => {
       contract = await deployContract()
     })
   })
   ```

2. **Efficient Snapshot Usage**
   ```typescript
   // ✅ Use helper infrastructure for snapshots
   beforeEach(async () => {
     testEnv = await createBaseTestEnvironment() // Handles snapshots
   })

   afterEach(async () => {
     await restoreBaseTestEnvironment() // Handles restoration
   })
   ```

3. **Batch Related Tests**
   ```typescript
   // ✅ Group related tests to minimize setup
   describe("Redemption Workflow", () => {
     let redemptionId: string

     beforeEach(async () => {
       // Setup redemption state once
       const tx = await contract.requestRedemption(amount, address)
       redemptionId = await getRedemptionIdFromTx(tx)
     })

     it("should allow fulfillment", async () => {
       // Test fulfillment
     })

     it("should prevent double fulfillment", async () => {
       // Test protection
     })
   })
   ```

### Gas Analysis Integration

```typescript
import { measureGas } from "../helpers/gas-helpers"

it("should execute within gas limits", async () => {
  const gasUsed = await measureGas(async () => {
    return await contract.expensiveOperation(params)
  })

  expect(gasUsed).to.be.below(500000) // Set reasonable limits
})
```

## Migration Guidelines

### Legacy Test Migration

When migrating legacy tests:

1. **Update Imports**
   ```typescript
   // Old
   import { createMockSpvData } from "../helpers/account-control-test-helpers"

   // New
   import { createMockSpvData } from "../helpers/spv-data-helpers"
   ```

2. **Modernize Error Testing**
   ```typescript
   // Old
   await expect(contract.function()).to.be.revertedWith("Error message")

   // New
   await expectCustomError(contract.function(), contractFactory, "ErrorName")
   ```

3. **Update Environment Setup**
   ```typescript
   // Old
   const [deployer, user] = await ethers.getSigners()

   // New
   const testEnv = await createBaseTestEnvironment()
   const { signers } = testEnv
   ```

### Backward Compatibility

When making changes that affect existing tests:

1. **Maintain compatibility layer** during transition
2. **Update documentation** with migration examples
3. **Provide clear migration timeline**
4. **Assist team members** with migration

## Best Practices Summary

1. **Always use helper infrastructure** for common operations
2. **Write descriptive test names** that explain the scenario
3. **Use standardized error testing** patterns
4. **Maintain test independence** and isolation
5. **Include comprehensive documentation**
6. **Follow consistent code style**
7. **Ensure adequate test coverage**
8. **Optimize for maintainability** over brevity
9. **Use real data when possible** for SPV testing
10. **Include performance considerations** in test design

By following these guidelines, you'll contribute high-quality, maintainable tests that enhance the overall quality of the account-control test suite.