# Account Control Integration Tests

This directory contains integration tests for the Account Control system, organized to minimize overlap and maximize coverage.

## Test Organization

### Core Integration Tests

- **SystemIntegration.test.ts** - Consolidated integration tests covering:
  - Core QC lifecycle (registration, SPV validation, solvency)
  - Minting and redemption operations
  - Watchdog consensus mechanisms
  - Emergency response scenarios
  - Multi-QC operations
  - Cross-contract communication
  - Performance and scalability
  - V2 infrastructure integration (Bank, Vault)
  - Governance and upgrade scenarios

### User Journey Tests

- **EndToEndUserJourneys.test.ts** - Real-world user scenarios:
  - Institutional user flows (large-scale operations)
  - Retail user flows (small transactions, DeFi)
  - Crisis scenarios (QC investigation, recovery)
  - Worst-case scenarios (insolvency, revocation)
  - Multi-user concurrent operations
  - Attack scenarios and defense mechanisms

### Security Tests

- **SecurityIntegration.test.ts** - Comprehensive security testing:
  - Reentrancy attack prevention
  - Access control bypass attempts
  - Economic attack scenarios
  - Consensus manipulation
  - Cross-contract vulnerabilities
  - Emergency system abuse
  - Data integrity attacks
  - Compound attack scenarios

## Test Helpers

- **IntegrationTestHelpers.ts** - Shared utilities:
  - Test context setup
  - QC configuration helpers
  - Proposal creation/execution
  - Emergency trigger helpers
  - Common test amounts

## Running Tests

```bash
# Run all integration tests
npx hardhat test test/account-control/integration/

# Run specific test file
npx hardhat test test/account-control/integration/SystemIntegration.test.ts

# Run with gas reporting
REPORT_GAS=true npx hardhat test test/account-control/integration/
```

## Test Coverage

The integration tests cover:
- ✅ Complete QC lifecycle
- ✅ Minting and redemption flows
- ✅ Watchdog consensus operations
- ✅ Emergency response mechanisms
- ✅ Multi-QC scenarios
- ✅ Security attack vectors
- ✅ User journey scenarios
- ✅ System upgrades and governance
- ✅ Cross-contract interactions
- ✅ Performance under load

## Deprecated Files

The following files have been consolidated into SystemIntegration.test.ts:
- CompleteSystemIntegration.test.ts (deprecated)
- FullSystemIntegration.test.ts (deprecated)

These files contained significant overlap and have been merged to reduce redundancy while maintaining full test coverage.