# Account Control Test Consolidation Plan

## Overview
This document tracks the consolidation of duplicate and overlapping tests in the account-control test suite to ensure no test coverage is lost during the refactoring process.

## Phase 1: Test Inventory

### QCRedeemer Test Files

#### 1. core-contracts/qc-redeemer.test.ts
- **Purpose**: Unit tests for QCRedeemer contract
- **Test Count**: 22 tests (6 describe blocks)
- **Key Test Areas**:
  - Deployment configuration (3 tests)
  - Redemption request creation (8 tests)
  - System pause behavior (2 tests)
  - Unfulfilled redemption queries (2 tests)

#### 2. integration/qc-redeemer-integration.test.ts  
- **Purpose**: Integration tests for QCRedeemer
- **Test Count**: 21 tests (8 describe blocks)
- **Key Test Areas**:
  - Deployment (3 tests - DUPLICATE with core-contracts)
  - Redemption requests (8 tests - similar patterns to core)
  - Redemption fulfillment (3 tests - UNIQUE)
  - Redemption cancellation (3 tests - UNIQUE)
  - System pause (2 tests - DUPLICATE with core-contracts)
  - AccountControl integration (2 tests - UNIQUE)

#### 3. integration/qc-redeemer-comprehensive-integration.test.ts
- **Purpose**: Complex multi-actor scenarios
- **Test Count**: 21 tests (6 describe blocks)
- **Key Test Areas**:
  - End-to-end workflow integration (3 tests)
  - Cross-QC redemption scenarios (6 tests)
  - Wallet deregistration and obligations (4 tests)
  - Multi-actor scenarios (4 tests)
  - Real-world simulations (4 tests)

#### 4. Additional QCRedeemer-specific files
- core-contracts/qc-redeemer-comprehensive-demo.test.ts
- core-contracts/qc-redeemer-emergency-scenarios.test.ts
- core-contracts/qc-redeemer-error-boundaries.test.ts
- core-contracts/qc-redeemer-obligations.test.ts
- core-contracts/qc-redeemer-timeout-deadlines.test.ts
- core-contracts/qc-redeemer-trusted-fulfillment.test.ts

### Bitcoin Address Test Files

#### 1. bitcoin-integration/address-handling.test.ts
- **Purpose**: Integration-level address handling
- **Test Count**: 48 tests (26 describe blocks)
- **Key Test Areas**:
  - P2PKH validation and utilities (6 tests)
  - P2SH validation and utilities (4 tests)
  - P2WPKH/P2WSH validation and utilities (8 tests)
  - Testnet address support (20 tests - comprehensive)
  - Address derivation (6 tests)
  - Error handling (4 tests)

#### 2. core-contracts/bitcoin-address-utils.test.ts
- **Purpose**: Unit tests for address utilities
- **Test Count**: 37 tests (20 describe blocks)
- **Key Test Areas**:
  - Base58 decoding (5 tests)
  - Bech32 validation (10 tests)
  - Address type detection (8 tests)
  - Character conversion utilities (14 tests)

#### 3. fuzz/bitcoin-address-fuzzing.test.ts
- **Purpose**: Property-based testing for address handling
- **Test Count**: 21 tests (7 describe blocks)
- **Key Test Areas**:
  - Address derivation properties (3 tests)
  - Address decoding properties (4 tests)
  - Base58 decoding properties (5 tests)
  - Bech32 internal functions (4 tests)
  - Error boundaries (3 tests)
  - Invariants (2 tests)

### System State Test Files

#### 1. system-management/system-state.test.ts
- **Purpose**: Core SystemState functionality
- **Test Count**: 171 tests (55 describe blocks)
- **Key Test Areas**:
  - Deployment and initialization (3 tests)
  - Pause/unpause operations (24 tests)
  - Parameter management (80+ tests)
  - Role management (20+ tests)
  - View functions (40+ tests)

#### 2. security/system-state-security.test.ts
- **Purpose**: Security-focused tests
- **Test Count**: 38 tests (19 describe blocks)
- **Key Test Areas**:
  - Access control for pause operations (4 tests - OVERLAP)
  - Pause state management (6 tests - OVERLAP)
  - Emergency pause duration (4 tests - UNIQUE)
  - Parameter validation (12 tests - SOME OVERLAP)
  - Security patterns (12 tests - UNIQUE)

#### 3. system-management/system-state-governance-parameters.test.ts
- **Purpose**: Governance parameter management
- **Test Count**: 32 tests (8 describe blocks)
- **Key Test Areas**:
  - Parameter bounds validation
  - Update permissions
  - Event emission
  - Default values

### QCManager Test Files

#### 1. core-contracts/qc-manager.test.ts
- **Purpose**: Core QCManager functionality
- **Test Count**: [TO BE ANALYZED]

#### 2. core-contracts/qc-manager-lib.test.ts
- **Purpose**: QCManagerLib utility functions
- **Test Count**: [TO BE ANALYZED]

#### 3. Specialized QCManager files
- qc-manager-batch-safety.test.ts
- qc-manager-financial-integration.test.ts
- qc-manager-lib-bitcoin-validation.test.ts
- qc-manager-lib-error-matrix.test.ts
- qc-manager-lib-wallet-validation.test.ts
- qc-manager-oracle-fallback.test.ts

## Phase 2: Duplicate Test Mapping

### Identified Duplicates

#### QCRedeemer Deployment Tests
| Test | File 1 | File 2 | Action |
|------|--------|--------|--------|
| "should set correct dependencies" | qc-redeemer.test.ts:87 | qc-redeemer-integration.test.ts:15 | Keep in unit test |
| "should grant deployer admin role" | qc-redeemer.test.ts:91 | qc-redeemer-integration.test.ts:20 | Keep in unit test |
| "should configure dispute arbiter role" | qc-redeemer.test.ts:96 | qc-redeemer-integration.test.ts:33 | Keep in unit test |

#### System Pause Tests
| Test | File 1 | File 2 | Action |
|------|--------|--------|--------|
| Pause mechanism tests | system-state.test.ts | system-state-security.test.ts | Consolidate security aspects |

### Unique Tests to Preserve

#### QCRedeemer Integration Unique Tests
- Redemption fulfillment workflow
- Redemption cancellation logic
- AccountControl integration scenarios
- Multi-actor complex scenarios
- Wallet deregistration with obligations

## Phase 3: Consolidation Strategy

### Strategy 1: QCRedeemer Consolidation

**Target Structure:**
```
core-contracts/
  qc-redeemer.test.ts           # Pure unit tests only
  qc-redeemer-edge-cases.test.ts # Merge all edge case files

integration/
  qc-redeemer-integration.test.ts # All integration scenarios
```

**Migration Plan:**
1. Remove duplicate deployment tests from integration file
2. Move complex scenarios from comprehensive-integration to main integration
3. Consolidate edge case files into single file

### Strategy 2: Bitcoin Address Consolidation

**Target Structure:**
```
core-contracts/
  bitcoin-address-utils.test.ts  # Pure utility unit tests

bitcoin-integration/
  address-handling.test.ts       # Keep as comprehensive integration

fuzz/
  bitcoin-address-fuzzing.test.ts # Keep as-is for property testing
```

**Migration Plan:**
1. Identify overlapping utility tests
2. Keep integration tests that use full system
3. Preserve all fuzz tests

### Strategy 3: System State Consolidation

**Target Structure:**
```
system-management/
  system-state.test.ts          # All system state tests with security section
```

**Migration Plan:**
1. Create "Security Tests" describe block in main file
2. Move all security-specific tests
3. Remove security file

## Phase 4: Execution Steps

### Step 1: Create Test Coverage Baseline
```bash
# Run coverage before changes
npm run coverage -- --testPathPattern="account-control"
# Save coverage report as baseline
```

### Step 2: Create Backup
```bash
# Create backup branch
git checkout -b test-consolidation-backup
git add -A && git commit -m "Backup before test consolidation"
```

### Step 3: Execute File by File
1. Start with lowest risk (QCRedeemer deployment duplicates)
2. Run tests after each change
3. Compare coverage metrics
4. Document any issues

### Step 4: Final Validation
1. Run full test suite
2. Compare coverage with baseline
3. Review git diff for any missed tests
4. Run mutation testing if available

## Phase 5: Validation Checklist

- [ ] All test files compile without errors
- [ ] All tests pass
- [ ] Coverage percentage maintained or improved
- [ ] No unique test cases lost (verified by grep)
- [ ] Test execution time improved
- [ ] Clear file organization achieved

## Phase 6: Rollback Plan

If issues arise:
1. `git checkout test-consolidation-backup`
2. Analyze what went wrong
3. Adjust plan and retry

## Tracking Progress

### Files Completed
- [ ] QCRedeemer core/integration consolidation
- [ ] QCRedeemer edge case consolidation  
- [ ] Bitcoin address test deduplication
- [ ] System state security merge
- [ ] QCManager file organization

### Tests Migrated
- **Total tests before**: 1,761 tests
- **Total files before**: 50 files
- **Expected tests after**: ~1,600 tests
- **Expected files after**: ~35 files
- **Expected duplicate removal**: ~160 tests (9%)
- **Expected file reduction**: 15 files (30%)

### Consolidation Impact by Area
1. **QCRedeemer**: 9 files → 3 files, ~180 tests → ~165 tests
2. **System State**: 3 files → 1 file, ~241 tests → ~220 tests  
3. **Bitcoin Address**: 3 files → 3 files (no change), better organization
4. **QCManager**: 7 files → 3-4 files (pending analysis)

## Key Benefits Expected
1. **Reduced Maintenance**: 30% fewer files to maintain
2. **Better Organization**: Clear separation between unit/integration/edge cases
3. **Faster Test Runs**: ~9% fewer duplicate tests
4. **Easier Navigation**: Logical grouping of related tests
5. **No Coverage Loss**: All unique test scenarios preserved

## Notes and Observations
- Bitcoin address tests show good separation of concerns - minimal consolidation needed
- System state has significant pause test overlap between security and core files
- QCRedeemer has the most fragmentation with 9 separate test files
- Many test names are poorly formatted (containing ")") which may need cleanup