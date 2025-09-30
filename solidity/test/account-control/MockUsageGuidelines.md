# Mock Usage Guidelines for Account-Control Test Suite

## Overview

This guide standardizes mock usage patterns across the account-control test suite to improve consistency, maintainability, and readability. It covers when to use different types of mocks, standardized setup patterns, and practical examples.

## Test Classification and Mock Selection

### 1. Unit Tests - Use Smock Fakes
**Purpose**: Test individual contract functions in isolation  
**Mock Type**: Smock fakes (`@defi-wonderland/smock`)  
**When to Use**: Testing single contract behavior without external dependencies

**Benefits**:
- Complete interface control
- Fast execution
- Granular behavior configuration
- Automatic mock verification

### 2. Integration Tests - Use Direct Mocks
**Purpose**: Test interactions between multiple contracts  
**Mock Type**: Solidity mock contracts (MockBank, MockAccountControl, etc.)  
**When to Use**: Testing multi-contract workflows with realistic contract interactions

**Benefits**:
- Realistic gas costs
- Complex state interactions
- Contract-level error handling
- Deployed contract testing

### 3. End-to-End Tests - Use Real Contracts
**Purpose**: Test complete system workflows  
**Mock Type**: Real contracts with test fixtures  
**When to Use**: Testing complete user journeys and system integration

**Benefits**:
- Production-like behavior
- Complete validation chains
- Real upgrade patterns
- Comprehensive security testing

## Mock Contract Inventory

### Core System Mocks
| Contract | Path | Purpose | Best For |
|----------|------|---------|----------|
| MockBank | `contracts/test/MockBank.sol` | Token operations | AccountControl integration |
| MockAccountControl | `contracts/test/MockAccountControl.sol` | Reserve management | QC component testing |
| MockTBTCVault | `contracts/test/MockTBTCVault.sol` | tBTC vault operations | Bridge testing |
| MockTBTCToken | `contracts/test/MockTBTCToken.sol` | ERC20 token | Token flow testing |

### Data & State Mocks
| Contract | Path | Purpose | Best For |
|----------|------|---------|----------|
| MockQCData | `contracts/test/MockQCData.sol` | QC registry | QC lifecycle testing |
| MockSystemState | `contracts/test/MockSystemState.sol` | System configuration | State-dependent tests |
| MockReserveOracle | `contracts/test/MockReserveOracle.sol` | Price feeds | Reserve calculations |

### Workflow Mocks
| Contract | Path | Purpose | Best For |
|----------|------|---------|----------|
| MockQCManager | `contracts/test/MockQCManager.sol` | QC management | Manager integration |
| MockQCRedeemer | `contracts/test/MockQCRedeemer.sol` | Redemption flow | Redemption testing |
| MockWalletRegistry | `contracts/test/MockWalletRegistry.sol` | Wallet tracking | Wallet operations |

### Infrastructure Mocks
| Contract | Path | Purpose | Best For |
|----------|------|---------|----------|
| MockReimbursementPool | `contracts/test/MockReimbursementPool.sol` | Gas reimbursement | Cost testing |
| MockTokenStaking | `contracts/test/MockTokenStaking.sol` | Staking operations | Rewards testing |

### Bridge & Cross-Chain Mocks
| Contract | Path | Purpose | Best For |
|----------|------|---------|----------|
| MockTBTCBridge | `contracts/test/MockTBTCBridge.sol` | Bridge operations | Cross-chain testing |
| MockStarkGateBridge | `contracts/test/MockStarkGateBridge.sol` | StarkNet bridge | L2 integration |
| MockL1BTCRedeemerWormhole | `contracts/test/MockL1BTCRedeemerWormhole.sol` | Wormhole bridge | Cross-chain redemption |

### Testing Infrastructure
| Contract | Path | Purpose | Best For |
|----------|------|---------|----------|
| MockReserve | `contracts/test/MockReserve.sol` | Reserve simulation | Reserve testing |
| MockBankWithSeparatedOps | `contracts/test/MockBankWithSeparatedOps.sol` | Advanced Bank | Complex scenarios |
| TestRelay | Built-in | Bitcoin relay | SPV testing |

## Standardized Setup Patterns

### Unit Test Template (Smock Fakes)

```typescript
import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import { ContractUnderTest, Dependency } from "../../typechain"

chai.use(smock.matchers)

describe("ContractUnderTest", () => {
  let contract: ContractUnderTest
  let mockDependency: FakeContract<Dependency>
  let deployer: SignerWithAddress
  let user: SignerWithAddress

  beforeEach(async () => {
    await helpers.snapshot.createSnapshot()
    
    // Get signers
    [deployer, user] = await ethers.getSigners()
    
    // Create smock fakes
    mockDependency = await smock.fake<Dependency>("Dependency")
    
    // Deploy contract under test
    const ContractFactory = await ethers.getContractFactory("ContractUnderTest")
    contract = await ContractFactory.deploy(mockDependency.address)
    
    // Setup default mock behaviors
    mockDependency.someMethod.returns(true)
    mockDependency.getAmount.returns(ethers.utils.parseEther("1"))
  })

  afterEach(async () => {
    await helpers.snapshot.restoreSnapshot()
  })

  describe("Primary Function", () => {
    it("should execute successfully with valid inputs", async () => {
      // Arrange
      mockDependency.validate.returns(true)
      
      // Act
      await contract.primaryFunction(user.address, 1000)
      
      // Assert
      expect(mockDependency.validate).to.have.been.calledOnceWith(user.address)
    })
  })
})
```

### Integration Test Template (Direct Mocks)

```typescript
import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ContractUnderTest, MockDependency } from "../../typechain"
import { TEST_CONSTANTS } from "./fixtures/AccountControlFixtures"

describe("ContractUnderTest Integration", () => {
  let contract: ContractUnderTest
  let mockDependency: MockDependency
  let owner: SignerWithAddress
  let user: SignerWithAddress

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners()
    
    // Deploy mock contracts
    const MockDependencyFactory = await ethers.getContractFactory("MockDependency")
    mockDependency = await MockDependencyFactory.deploy()
    
    // Deploy contract under test
    const ContractFactory = await ethers.getContractFactory("ContractUnderTest")
    contract = await ContractFactory.deploy(
      owner.address,
      mockDependency.address
    )
    
    // Setup authorization
    await mockDependency.authorizeContract(contract.address)
    
    // Configure mock with test data
    await mockDependency.setAmount(TEST_CONSTANTS.MEDIUM_MINT)
    await mockDependency.setStatus(true)
  })

  describe("Multi-Contract Workflow", () => {
    it("should complete workflow with mock interactions", async () => {
      // Setup test data
      const amount = TEST_CONSTANTS.SMALL_MINT
      
      // Execute workflow
      await contract.connect(user).initiateWorkflow(amount)
      
      // Verify mock state changes
      expect(await mockDependency.getProcessedAmount()).to.equal(amount)
      expect(await mockDependency.getLastUser()).to.equal(user.address)
    })
  })
})
```

### E2E Test Template (Fixtures)

```typescript
import { expect } from "chai"
import { ethers } from "hardhat"
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import { deployQCManagerFixture, setupTestQC } from "./fixtures/AccountControlFixtures"

describe("QC Complete Workflow E2E", () => {
  async function setupE2EFixture() {
    const fixture = await deployQCManagerFixture()
    const qc = await setupTestQC(fixture, { 
      mintingCap: fixture.constants.LARGE_CAP 
    })
    return { ...fixture, qc }
  }

  describe("Complete QC Lifecycle", () => {
    it("should handle complete QC registration and minting workflow", async () => {
      const { qcManager, accountControl, qc, user, constants } = 
        await loadFixture(setupE2EFixture)
      
      // Execute complete workflow
      const amount = constants.MEDIUM_MINT
      
      // QC updates backing
      await accountControl.connect(qc).updateBacking(amount * 2)
      
      // QC mints tokens
      await accountControl.connect(qc).mint(user.address, amount)
      
      // Verify end-to-end state
      expect(await accountControl.totalMinted()).to.equal(amount)
      const reserveInfo = await accountControl.reserveInfo(qc.address)
      expect(reserveInfo.backing).to.equal(amount * 2)
    })
  })
})
```

## Authorization Patterns

### MockBank Authorization
```typescript
// Deploy MockBank
const MockBankFactory = await ethers.getContractFactory("MockBank")
const mockBank = await MockBankFactory.deploy()

// Authorize AccountControl to call MockBank
await mockBank.authorizeBalanceIncreaser(accountControl.address)

// Configure testing behaviors
await mockBank.setBatchSupported(true)
await mockBank.setFailOnSecondCall(false)
```

### MockAccountControl Authorization
```typescript
// Deploy MockAccountControl
const MockAccountControlFactory = await ethers.getContractFactory("MockAccountControl")
const mockAccountControl = await MockAccountControlFactory.deploy(mockBank.address)

// Authorize QC as reserve
await mockAccountControl.authorizeReserve(qcAddress, TEST_CONSTANTS.LARGE_CAP)

// Set test balances
await mockAccountControl.setMintedForTesting(qcAddress, TEST_CONSTANTS.MEDIUM_MINT)
await mockAccountControl.setTotalMintedForTesting(TEST_CONSTANTS.LARGE_MINT)
```

### Role-Based Authorization Pattern
```typescript
// Standard role setup for mocks
const MINTER_ROLE = await contract.MINTER_ROLE()
const GOVERNANCE_ROLE = await contract.GOVERNANCE_ROLE()

await contract.grantRole(MINTER_ROLE, minter.address)
await contract.grantRole(GOVERNANCE_ROLE, governance.address)

// QCData authorization
await qcData.grantRole(TEST_CONSTANTS.ROLES.QC_MANAGER, qcManager.address)
```

## File Naming Conventions

### Test File Naming
- **Unit Tests**: `ContractName.test.ts`
- **Integration Tests**: `ContractNameIntegration.test.ts` or `ContractNameComponent.test.ts`
- **E2E Tests**: `ContractNameWorkflows.test.ts` or `ContractNameE2E.test.ts`
- **Specific Feature Tests**: `ContractNameFeatureName.test.ts`

### Examples from Codebase
- `AccountControl.test.ts` - Core unit tests
- `AccountControlIntegration.test.ts` - Integration scenarios
- `AccountControlWorkflows.test.ts` - E2E workflows
- `core-contracts/qc-redeemer-wallet-obligations.test.ts` - Wallet obligations (core functionality and edge cases)

### Mock File Naming
- Solidity mocks: `MockContractName.sol`
- Test helpers: `ContractNameTestHelpers.ts`
- Fixtures: `ContractNameFixtures.ts`

## Mock Selection Quick Reference

### Choose Smock Fakes When:
- ✅ Testing single contract logic
- ✅ Need fine-grained control over return values
- ✅ Want to verify exact call parameters
- ✅ Testing error conditions
- ✅ Fast test execution is priority

### Choose Direct Mocks When:
- ✅ Testing contract interactions
- ✅ Need realistic gas costs
- ✅ Testing state changes across contracts
- ✅ Validating contract-level errors
- ✅ Testing authorization patterns

### Choose Real Contracts When:
- ✅ E2E testing complete workflows
- ✅ Testing upgrade mechanisms
- ✅ Validating production-like behavior
- ✅ Testing complex state interactions
- ✅ Security and integration testing

## Best Practices

### 1. Mock Lifecycle Management
```typescript
// Use snapshots for isolation
beforeEach(async () => {
  await helpers.snapshot.createSnapshot()
  // Setup mocks
})

afterEach(async () => {
  await helpers.snapshot.restoreSnapshot()
})
```

### 2. Consistent Mock Configuration
```typescript
// Create reusable mock setup functions
async function setupMockBank(options: {
  batchSupported?: boolean
  failOnSecondCall?: boolean
} = {}) {
  const mockBank = await MockBankFactory.deploy()
  await mockBank.setBatchSupported(options.batchSupported ?? true)
  await mockBank.setFailOnSecondCall(options.failOnSecondCall ?? false)
  return mockBank
}
```

### 3. Mock Verification Patterns
```typescript
// Smock verification
expect(mockContract.method).to.have.been.calledOnceWith(expectedParam)
expect(mockContract.method).to.have.been.calledTimes(2)

// Direct mock verification
expect(await mockContract.getCallCount()).to.equal(1)
expect(await mockContract.getLastCaller()).to.equal(user.address)
```

### 4. Error Testing
```typescript
// Smock error simulation
mockContract.method.reverts("Custom error message")

// Direct mock error simulation
await mockContract.setFailOnNextCall(true)
await expect(contract.method()).to.be.revertedWith("Mock failure")
```

### 5. State Assertion Patterns
```typescript
// Verify mock state changes
expect(await mockBank.balanceOf(user.address)).to.equal(expectedAmount)
expect(await mockAccountControl.totalMinted()).to.equal(totalMinted)

// Verify event emissions
await expect(transaction)
  .to.emit(contract, "EventName")
  .withArgs(param1, param2)
```

## Common Patterns by Test Type

### SPV Testing Pattern
```typescript
import { createRealSpvData, setupMockRelayForSpv } from "../helpers/account-control-test-helpers"

// For tests requiring valid SPV data
const spvData = createRealSpvData()
await setupMockRelayForSpv(mockRelay, spvData.chainDifficulty)

// For tests not requiring SPV validation
const mockSpvData = createMockSpvData()
```

### Bitcoin Address Testing Pattern
```typescript
import { bitcoinTestAddresses } from "../helpers/account-control-test-helpers"

// Use standardized test addresses
const validAddress = bitcoinTestAddresses.validP2PKH
const invalidAddress = bitcoinTestAddresses.invalid
```

### Amount Testing Pattern
```typescript
import { TEST_CONSTANTS } from "./fixtures/AccountControlFixtures"

// Use standardized amounts
const smallAmount = TEST_CONSTANTS.SMALL_MINT
const cap = TEST_CONSTANTS.MEDIUM_CAP
```

## Migration Guidelines

### From Smock to Direct Mocks
1. Replace `smock.fake<Contract>()` with contract deployment
2. Change `mock.method.returns(value)` to `await mock.setMethodReturn(value)`
3. Replace verification with state assertions
4. Add proper authorization setup

### From Direct Mocks to Real Contracts
1. Use fixture deployment patterns
2. Replace mock-specific methods with real contract setup
3. Add proper initialization sequences
4. Include realistic state setup

## Troubleshooting

### Common Issues
1. **Mock not authorized**: Ensure proper authorization setup
2. **Smock verification failures**: Check exact parameter matching
3. **State inconsistencies**: Verify mock configuration order
4. **Gas estimation failures**: Use direct mocks instead of smock for gas testing

### Debug Techniques
```typescript
// Log mock interactions
console.log("Mock call count:", await mockContract.getCallCount())
console.log("Mock state:", await mockContract.getCurrentState())

// Verify mock setup
expect(await mockContract.isAuthorized(caller.address)).to.be.true
```

This guide should be updated as new patterns emerge and mock contracts are added to the test suite.