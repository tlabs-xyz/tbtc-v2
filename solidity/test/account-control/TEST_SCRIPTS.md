# Account-Control Test Scripts Guide

## Overview
The account-control test suite has been reorganized into logical directories. The npm scripts have been updated to support both directory-based and tag-based test execution.

## Available Test Scripts

### Run All Tests
```bash
# Run all account-control tests
yarn test:account-control
# or
npm run test:account-control
```

### Run Tests by Directory

#### Core Contracts
```bash
# Run all core contract tests (QC Manager, Minter, Redeemer, Data, etc.)
yarn test:ac:core
```

#### System Management
```bash
# Run system management tests (SystemState, ReserveOracle, WatchdogEnforcer)
yarn test:ac:system
```

#### SPV Functionality
```bash
# Run SPV and Bitcoin integration tests
yarn test:ac:spv
```

#### Integration Tests
```bash
# Run cross-contract integration tests
yarn test:ac:integration
```

#### Security Tests
```bash
# Run security-focused tests
yarn test:ac:security
```

#### Bitcoin Integration
```bash
# Run Bitcoin address handling tests
yarn test:ac:bitcoin
```

### Run Tests by Tag

Tests can also be filtered by tags in their describe blocks:

```bash
# Run only unit tests
yarn test:ac:unit

# Run smoke tests
yarn test:ac:smoke

# Run validation tests
yarn test:ac:validation
```

## Directory Structure

```
test/account-control/
├── bitcoin-integration/    # Bitcoin address handling
├── core-contracts/         # Core QC contract tests
├── integration/            # Cross-contract scenarios
├── security/               # Security-focused tests
├── spv-functionality/      # SPV and Bitcoin integration
└── system-management/      # System state and oracle
```

## Test Execution Tips

### Running Specific Tests
```bash
# Run a specific test file
npx hardhat test test/account-control/core-contracts/qc-manager.test.ts

# Run tests matching a pattern
npx hardhat test test/account-control/**/*.test.ts --grep "should register wallet"
```

### Environment Variables
All account-control tests run with:
- `USE_EXTERNAL_DEPLOY=true` - Uses external deployment artifacts
- `TEST_USE_STUBS_TBTC=true` - Uses stubbed TBTC for faster testing

### Memory Settings
The main test script (`test-account-control.sh`) automatically sets:
- `NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512"`

This prevents out-of-memory errors for large test suites.

### Timeout Handling
Tests have a 1-hour timeout. If tests exceed this:
- Check for infinite loops
- Consider splitting large test files
- Use `--grep` to run specific tests

## Common Issues

### Exit Code 50
If you see "Exit code 50", it's likely a compilation or library linking issue:
```bash
npm run clean && npm run build
```

### Out of Memory
If tests fail with memory errors:
```bash
export NODE_OPTIONS="--max-old-space-size=8192"
yarn test:ac:core
```

### Test Discovery
The glob pattern `test/account-control/**/*.test.ts` automatically finds all test files in subdirectories. No need to update scripts when adding new test files.

## Development Workflow

1. **Write tests** in the appropriate directory
2. **Run directory tests** during development (e.g., `yarn test:ac:core`)
3. **Run all tests** before committing (`yarn test:account-control`)
4. **Use tags** for cross-cutting concerns (`[unit]`, `[integration]`, `[security]`)

## Script Maintenance

The scripts are defined in:
- `package.json` - NPM script definitions
- `test-account-control.sh` - Main test runner with error handling

When adding new directories:
1. Create the directory under `test/account-control/`
2. Add a corresponding npm script in `package.json`
3. Document the new category here