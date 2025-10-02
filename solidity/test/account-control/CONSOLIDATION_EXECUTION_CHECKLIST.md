# Test Consolidation Execution Checklist

## Pre-Consolidation Setup

### 1. Create Baseline Metrics
- [ ] Run full test suite and save output
  ```bash
  cd solidity
  npm test -- --testPathPattern="account-control" > ../test-baseline.log 2>&1
  ```
- [ ] Generate coverage report
  ```bash
  npm run coverage -- --testPathPattern="account-control"
  ```
- [ ] Save coverage report HTML
- [ ] Document current metrics:
  - Total test files: 50
  - Total test cases: 1,761
  - Total describe blocks: 588

### 2. Create Safety Backup
- [ ] Create backup branch
  ```bash
  git checkout -b account-control-test-backup-$(date +%Y%m%d)
  git add -A && git commit -m "Backup: Account control tests before consolidation"
  ```

## Phase 1: QCRedeemer Consolidation

### Step 1.1: Remove Deployment Duplicates
**Files affected:**
- `core-contracts/qc-redeemer.test.ts` (keep tests here)
- `integration/qc-redeemer-integration.test.ts` (remove duplicates)

**Tests to remove from integration file:**
- [ ] Line 15: "should set correct dependencies"
- [ ] Line 20: "should grant deployer admin role"
- [ ] Line 33: "should configure dispute arbiter role"

**Validation:**
- [ ] Run tests: `npm test -- core-contracts/qc-redeemer.test.ts`
- [ ] Run tests: `npm test -- integration/qc-redeemer-integration.test.ts`
- [ ] Verify both pass

### Step 1.2: Merge Comprehensive Integration Tests
**Source:** `integration/qc-redeemer-comprehensive-integration.test.ts`
**Target:** `integration/qc-redeemer-integration.test.ts`

**Tests to migrate:**
- [ ] "should complete full redemption lifecycle with multiple participants" (line 15)
- [ ] "should handle redemption flow with system parameter changes" (line 116)
- [ ] "should integrate properly with AccountControl for reserve tracking" (line 157)
- [ ] All tests from "Cross-QC Redemption Scenarios" describe block
- [ ] All tests from "Complex Multi-Actor Scenarios" describe block
- [ ] All tests from "Real-World Scenario Simulations" describe block

**Post-migration:**
- [ ] Delete `qc-redeemer-comprehensive-integration.test.ts`
- [ ] Run full integration test suite
- [ ] Verify test count: ~42 tests in consolidated file

### Step 1.3: Consolidate QCRedeemer Edge Case Files
**Files to consolidate:**
- `qc-redeemer-comprehensive-demo.test.ts` (14 tests)
- `qc-redeemer-emergency-scenarios.test.ts` (23 tests)
- `qc-redeemer-error-boundaries.test.ts` (24 tests)
- `qc-redeemer-obligations.test.ts` (23 tests)
- `qc-redeemer-timeout-deadlines.test.ts` (17 tests)
- `qc-redeemer-trusted-fulfillment.test.ts` (20 tests)

**New file:** `core-contracts/qc-redeemer-edge-cases.test.ts`

**Structure:**
```typescript
describe("QCRedeemer Edge Cases and Scenarios", () => {
  describe("Emergency Scenarios", () => {
    // Tests from qc-redeemer-emergency-scenarios.test.ts
  })
  
  describe("Error Boundaries", () => {
    // Tests from qc-redeemer-error-boundaries.test.ts
  })
  
  describe("Obligation Management", () => {
    // Tests from qc-redeemer-obligations.test.ts
  })
  
  describe("Timeout and Deadline Handling", () => {
    // Tests from qc-redeemer-timeout-deadlines.test.ts
  })
  
  describe("Trusted Fulfillment", () => {
    // Tests from qc-redeemer-trusted-fulfillment.test.ts
  })
  
  describe("Comprehensive Demos", () => {
    // Selected unique demos from qc-redeemer-comprehensive-demo.test.ts
  })
})
```

**Validation:**
- [ ] Create new consolidated file
- [ ] Move tests maintaining describe structure
- [ ] Remove old files
- [ ] Run new edge cases test file
- [ ] Verify ~121 tests preserved

## Phase 2: System State Consolidation

### Step 2.1: Merge Security Tests
**Source:** `security/system-state-security.test.ts` (38 tests)
**Target:** `system-management/system-state.test.ts` (171 tests)

**Add new describe blocks in target:**
```typescript
describe("Security Tests", () => {
  describe("Pause Mechanism Security", () => {
    // Tests from system-state-security.test.ts
  })
  
  describe("Parameter Validation Security", () => {
    // Security-specific parameter tests
  })
  
  describe("Multi-Attacker Scenarios", () => {
    // Advanced security scenarios
  })
})
```

**Tests to migrate:**
- [ ] All "Access Control" tests (check for duplicates)
- [ ] "Emergency Pause Duration" tests
- [ ] "Security Pattern Validation" tests
- [ ] Remove duplicate pause tests

**Post-migration:**
- [ ] Delete `security/system-state-security.test.ts`
- [ ] Run consolidated test
- [ ] Verify ~195 total tests (removing ~14 duplicates)

## Phase 3: Bitcoin Address Test Organization

### Step 3.1: Verify Separation of Concerns
**Review files:**
- [ ] `bitcoin-integration/address-handling.test.ts` - Integration focus
- [ ] `core-contracts/bitcoin-address-utils.test.ts` - Unit test focus
- [ ] `fuzz/bitcoin-address-fuzzing.test.ts` - Property testing

**Action items:**
- [ ] Document any duplicate utility tests between first two files
- [ ] Move pure utility tests to bitcoin-address-utils.test.ts
- [ ] Keep integration-level tests in address-handling.test.ts
- [ ] No changes to fuzzing tests

## Phase 4: QCManager Consolidation

### Step 4.1: Identify Related Files
**Core files:**
- `qc-manager.test.ts`
- `qc-manager-lib.test.ts`

**Specialized files to evaluate:**
- `qc-manager-batch-safety.test.ts`
- `qc-manager-financial-integration.test.ts`
- `qc-manager-lib-bitcoin-validation.test.ts`
- `qc-manager-lib-error-matrix.test.ts`
- `qc-manager-lib-wallet-validation.test.ts`
- `qc-manager-oracle-fallback.test.ts`

**Decision criteria:**
- [ ] If tests are for library functions → merge into qc-manager-lib.test.ts
- [ ] If tests are for core contract → merge into qc-manager.test.ts
- [ ] Keep truly specialized scenarios separate

## Post-Consolidation Validation

### Final Checks
- [ ] Run full test suite
  ```bash
  npm test -- --testPathPattern="account-control"
  ```
- [ ] Generate new coverage report
  ```bash
  npm run coverage -- --testPathPattern="account-control"
  ```
- [ ] Compare metrics:
  - Test files: 50 → ~35 (expected)
  - Test cases: 1,761 → ~1,600 (expected)
  - Coverage: Should remain same or improve

### Coverage Verification
- [ ] Compare line coverage percentage
- [ ] Compare branch coverage percentage
- [ ] Identify any uncovered lines in consolidated files
- [ ] Document any coverage gaps

### Performance Check
- [ ] Compare test execution time
- [ ] Note any significant changes

## Rollback Plan

If issues arise at any step:
1. [ ] Stop consolidation immediately
2. [ ] Document the issue
3. [ ] Run: `git checkout account-control-test-backup-[date]`
4. [ ] Analyze and adjust approach

## Success Criteria

- [ ] All tests pass
- [ ] Coverage maintained or improved
- [ ] ~25-30% reduction in file count
- [ ] ~10-15% reduction in duplicate tests
- [ ] Clearer test organization
- [ ] Faster test execution
- [ ] No loss of test scenarios

## Notes Section
_Use this section to document any issues, decisions, or observations during consolidation_

### Issues Encountered:
- 

### Decisions Made:
- 

### Tests Requiring Special Attention:
-