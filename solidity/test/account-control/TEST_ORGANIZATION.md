# Account Control Test Organization

## Overview

The Account Control test suite is organized into unit tests and integration tests to provide comprehensive coverage while minimizing redundancy.

## Directory Structure

```
test/account-control/
├── integration/              # Integration tests
│   ├── SystemIntegration.test.ts      # Core system integration (consolidated)
│   ├── EndToEndUserJourneys.test.ts   # User-centric scenarios  
│   ├── SecurityIntegration.test.ts    # Security and attack scenarios
│   ├── IntegrationTestHelpers.ts      # Shared test utilities
│   └── README.md                      # Integration test documentation
│
├── unit tests (main directory)
│   ├── QCManager.test.ts              # QC management functionality
│   ├── QCData.test.ts                 # Data storage and retrieval
│   ├── QCMinter.test.ts               # Minting operations
│   ├── QCRedeemer.test.ts             # Redemption operations
│   ├── QCReserveLedger.test.ts        # Reserve tracking
│   ├── BasicMintingPolicy.test.ts     # Minting policy logic
│   ├── BasicRedemptionPolicy.test.ts  # Redemption policy logic
│   ├── SystemState.test.ts            # System state management
│   ├── ProtocolRegistry.test.ts      # Service registry
│   ├── WatchdogEnforcer.test.ts      # Watchdog enforcement
│   ├── SPVValidator.test.ts           # SPV proof validation
│   └── ...                            # Other unit tests
│
└── AccountControlTestHelpers.ts       # Shared test utilities

```

## Test Categories

### Unit Tests
- Focus on individual contract functionality
- Mock external dependencies
- Fast execution
- High code coverage

### Integration Tests

#### SystemIntegration.test.ts (Consolidated)
- Core QC lifecycle operations
- Minting and redemption flows
- Watchdog consensus mechanisms
- Emergency response
- Multi-QC scenarios
- Cross-contract communication
- Performance testing
- Governance and upgrades

#### EndToEndUserJourneys.test.ts
- Institutional user scenarios
- Retail user scenarios
- Crisis response scenarios
- Attack scenarios
- System migration scenarios

#### SecurityIntegration.test.ts
- Reentrancy prevention
- Access control attacks
- Economic attacks
- Consensus manipulation
- Data integrity attacks
- Compound attack scenarios

## Recent Changes

### Consolidation (Latest)
- Merged `CompleteSystemIntegration.test.ts` and `FullSystemIntegration.test.ts` into `SystemIntegration.test.ts`
- Extracted shared helpers to `IntegrationTestHelpers.ts`
- Removed empty subdirectories (core/, emergency/, scenarios/, security/)
- Reduced test code by ~30% while maintaining full coverage

### Benefits
1. **Eliminated redundancy** - No more duplicate test scenarios
2. **Clearer organization** - Each file has a specific focus
3. **Better maintainability** - Shared helpers reduce duplication
4. **Improved performance** - Less setup/teardown overhead
5. **Easier navigation** - Clear separation of concerns

## Running Tests

```bash
# Run all tests
npx hardhat test

# Run unit tests only
npx hardhat test test/account-control/*.test.ts

# Run integration tests only
npx hardhat test test/account-control/integration/

# Run specific integration test
npx hardhat test test/account-control/integration/SystemIntegration.test.ts

# Run with gas reporting
REPORT_GAS=true npx hardhat test
```

## Test Coverage Goals

- Unit test coverage: >90%
- Integration test coverage: Complete user flows
- Security test coverage: All known attack vectors
- Performance benchmarks: Sub-second operations