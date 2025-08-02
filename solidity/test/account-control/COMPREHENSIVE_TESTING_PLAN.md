# Comprehensive Testing Plan for Account Control System

**Date**: 2025-08-01  
**Purpose**: Document all edge cases, user flows, and testing gaps in the Account Control system  
**Status**: Testing plan for implementation

---

## Executive Summary

This document outlines a comprehensive testing strategy for the Account Control system based on analysis of smart contracts and existing test coverage. Major gaps have been identified, particularly in WatchdogMonitor testing, reserve movement detection, and cross-contract edge cases.

## Current State Analysis

### Contracts and Test Coverage

| Contract | Test File | Coverage Status |
|----------|-----------|-----------------|
| BasicMintingPolicy.sol | BasicMintingPolicy.test.ts | ✅ Basic coverage |
| BasicRedemptionPolicy.sol | BasicRedemptionPolicy.test.ts | ✅ Basic coverage |
| BitcoinAddressUtils.sol | BitcoinAddressUtils.test.ts | ✅ Good coverage |
| ProtocolRegistry.sol | ProtocolRegistry.test.ts | ✅ Basic coverage |
| QCData.sol | QCData.test.ts | ✅ Basic coverage |
| QCManager.sol | QCManager.test.ts | ✅ Good coverage |
| QCMinter.sol | QCMinter.test.ts | ✅ Basic coverage |
| QCRedeemer.sol | QCRedeemer.test.ts | ✅ Basic coverage |
| QCReserveLedger.sol | QCReserveLedger.test.ts | ✅ Basic coverage |
| QCWatchdog.sol | QCWatchdog.test.ts | ✅ Basic coverage |
| SPVValidator.sol | SPVValidator.test.ts | ✅ Good coverage |
| SystemState.sol | SystemState.test.ts | ✅ Basic coverage |
| WatchdogConsensusManager.sol | WatchdogConsensusManager.test.ts | ✅ Basic coverage |
| **WatchdogMonitor.sol** | **MISSING** | ❌ **No tests** |

### Special Test Categories
- EconomicAttackTests.test.ts - Flash loan and MEV attacks
- RaceConditionTests.test.ts - Concurrency issues
- ReentrancyTests.test.ts - Reentrancy protection
- SecurityTests.test.ts - General security scenarios

## Identified Testing Gaps

### 1. Critical Missing Coverage

#### WatchdogMonitor (No Tests)
The WatchdogMonitor contract has zero test coverage despite being critical for V1.1 consensus system.

#### Reserve Movement Detection
No tests for scenarios where QC funds move out and watchdogs must detect and respond.

#### Cross-Contract Integration
Limited testing of complex interactions between multiple contracts.

### 2. Edge Cases by Contract

#### BasicMintingPolicy
- **Satoshi Conversion Edge Cases**
  - Minting exactly 1 satoshi worth of tBTC
  - Rounding errors in tBTC to satoshi conversion
  - Maximum uint256 amounts
  
- **Capacity Boundary Conditions**
  - Minting at exactly 100% capacity
  - Multiple concurrent mints depleting capacity
  - Capacity changes during mint request

- **Bank Integration Failures**
  - Bank.increaseBalanceAndCall reverting
  - Gas estimation for Bank operations
  - Reentrancy through Bank callbacks

#### QCManager
- **Wallet Registration Edge Cases**
  - Registering wallet for QC in different states
  - Maximum wallets per QC
  - Duplicate wallet registration attempts
  - Empty wallet arrays

- **Solvency Check Timing**
  - Solvency check during attestation update
  - Multiple simultaneous solvency checks
  - Solvency with stale attestations (by design)

- **Status Transition Validation**
  - Invalid status transitions
  - Status change during operations
  - Concurrent status modifications

#### QCRedeemer
- **Redemption ID Generation**
  - Counter overflow (unlikely but should test)
  - Collision resistance verification
  - Predictability concerns

- **Bitcoin Address Validation**
  - Edge cases in address formats
  - Malformed addresses
  - Script addresses vs standard addresses

- **Redemption State Machine**
  - State transitions during fulfillment
  - Multiple redemptions per user
  - Redemption during QC revocation

#### WatchdogConsensusManager
- **Voting Edge Cases**
  - Voting exactly at deadline
  - Vote changing (should fail)
  - Proposal with 0 votes executing

- **Byzantine Scenarios**
  - (N-1)/3 Byzantine watchdogs
  - Proposal spam attacks
  - Vote front-running

- **Parameter Boundaries**
  - MIN/MAX required votes
  - MIN/MAX voting periods
  - Edge values for all parameters

## Comprehensive Test Scenarios

### 1. WatchdogMonitor Test Suite (NEW)

```typescript
describe("WatchdogMonitor", () => {
  describe("Watchdog Management", () => {
    it("should handle duplicate registration attempts")
    it("should prevent deactivating non-existent watchdog")
    it("should maintain activeWatchdogs array integrity")
    it("should handle operator address changes")
    it("should validate watchdog contract interface")
  })

  describe("Critical Reporting", () => {
    it("should enforce report validity period")
    it("should handle report spam from single watchdog")
    it("should trigger emergency at exact threshold")
    it("should prevent double counting of reports")
    it("should clean up expired reports correctly")
  })

  describe("Emergency Response", () => {
    it("should coordinate with consensus manager")
    it("should handle emergency during active operations")
    it("should prevent emergency pause stacking")
    it("should validate clear emergency permissions")
  })
})
```

### 2. Reserve Movement Detection Suite

```typescript
describe("Reserve Movement Detection", () => {
  describe("Decrease Detection", () => {
    it("should detect 10%, 25%, 50%, 75% decreases")
    it("should distinguish normal volatility from fund movement")
    it("should handle attestation during movement")
    it("should track cumulative decreases")
  })

  describe("Consensus Formation", () => {
    it("should handle split opinions on reserve amount")
    it("should timeout on incomplete consensus")
    it("should weight recent attestations higher")
    it("should handle Byzantine reporters")
  })

  describe("Response Actions", () => {
    it("should escalate based on decrease severity")
    it("should coordinate emergency responses")
    it("should maintain operations during investigation")
    it("should recover from false alarms")
  })
})
```

### 3. Time-Based Attack Scenarios

```typescript
describe("Time-Based Attacks", () => {
  describe("Attestation Staleness Manipulation", () => {
    it("should handle attestation 1 second before stale")
    it("should prevent timestamp manipulation")
    it("should validate block.timestamp usage")
  })

  describe("Proposal Timing Attacks", () => {
    it("should handle votes at period boundaries")
    it("should prevent extending voting periods")
    it("should resist MEV on time-sensitive ops")
  })

  describe("Deadline Racing", () => {
    it("should handle operations at exact deadlines")
    it("should prevent deadline extension attacks")
    it("should ensure atomic deadline checks")
  })
})
```

### 4. Cross-Contract Integration Tests

```typescript
describe("Cross-Contract Integration", () => {
  describe("Service Registry Manipulation", () => {
    it("should handle service changes mid-operation")
    it("should validate service availability")
    it("should prevent circular dependencies")
    it("should handle missing services gracefully")
  })

  describe("Multi-Contract Transactions", () => {
    it("should maintain consistency across contracts")
    it("should handle partial failures")
    it("should prevent state desynchronization")
    it("should validate cross-contract permissions")
  })

  describe("Upgrade Scenarios", () => {
    it("should handle operations during upgrades")
    it("should maintain backwards compatibility")
    it("should prevent upgrade race conditions")
    it("should validate upgrade permissions")
  })
})
```

### 5. Economic Edge Cases

```typescript
describe("Economic Edge Cases", () => {
  describe("Dust Attacks", () => {
    it("should handle 1 wei operations")
    it("should prevent dust accumulation")
    it("should maintain precision in conversions")
  })

  describe("Maximum Value Operations", () => {
    it("should handle MAX_UINT256 amounts")
    it("should prevent overflow in calculations")
    it("should validate capacity limits")
  })

  describe("Fee Calculation Edge Cases", () => {
    it("should handle zero fee scenarios")
    it("should prevent fee manipulation")
    it("should maintain fee precision")
  })
})
```

### 6. Access Control Edge Cases

```typescript
describe("Access Control Edge Cases", () => {
  describe("Role Renunciation", () => {
    it("should handle admin self-renunciation")
    it("should prevent role lock scenarios")
    it("should validate role dependencies")
  })

  describe("Multi-Role Scenarios", () => {
    it("should handle overlapping permissions")
    it("should prevent privilege escalation")
    it("should validate role combinations")
  })

  describe("Emergency Role Assumptions", () => {
    it("should handle emergency role grants")
    it("should prevent unauthorized escalation")
    it("should maintain role audit trail")
  })
})
```

### 7. State Transition Tests

```typescript
describe("State Transitions", () => {
  describe("Pause Scenarios", () => {
    it("should handle pause during active mints")
    it("should coordinate multi-contract pauses")
    it("should prevent pause bypass attempts")
  })

  describe("QC State Changes", () => {
    it("should handle operations during transitions")
    it("should prevent invalid state paths")
    it("should maintain state consistency")
  })

  describe("System Recovery", () => {
    it("should recover from partial failures")
    it("should handle inconsistent states")
    it("should validate recovery permissions")
  })
})
```

## Implementation Priority Matrix

| Priority | Test Category | Rationale |
|----------|--------------|-----------|
| **P0 - Critical** | WatchdogMonitor tests | Completely missing, core to V1.1 |
| **P0 - Critical** | Reserve movement detection | Major security gap |
| **P0 - Critical** | Consensus failure modes | Byzantine fault tolerance |
| **P1 - High** | Cross-contract edge cases | Integration complexity |
| **P1 - High** | Time-based attacks | MEV and manipulation risks |
| **P1 - High** | Economic edge cases | Financial security |
| **P2 - Medium** | Access control edge cases | Permission security |
| **P2 - Medium** | State transition tests | Operational integrity |
| **P3 - Low** | Gas optimization tests | Performance tuning |

## Test Implementation Guidelines

### 1. Test Structure
```typescript
// Each test file should follow this structure
describe("ContractName", () => {
  // Setup and fixtures
  
  describe("Happy Path", () => {
    // Normal operation tests
  })
  
  describe("Edge Cases", () => {
    // Boundary conditions
    // Unusual inputs
    // Timing issues
  })
  
  describe("Error Cases", () => {
    // Revert scenarios
    // Invalid inputs
    // Permission failures
  })
  
  describe("Attack Scenarios", () => {
    // Economic attacks
    // Timing attacks
    // Access control exploits
  })
})
```

### 2. Helper Functions
```typescript
// Common helpers needed
async function simulateReserveMovement(...)
async function createConsensusScenario(...)
async function measureGasForEdgeCase(...)
async function simulateTimestampManipulation(...)
```

### 3. Test Data Sets
- Boundary values for all numeric inputs
- Valid/invalid Bitcoin addresses
- Edge case amounts (0, 1, MAX_UINT256)
- Timing values at boundaries

### 4. Coverage Metrics
- Line coverage: Target 95%+
- Branch coverage: Target 90%+
- Edge case coverage: 100% of identified scenarios
- Attack vector coverage: All known vectors

## Next Steps

1. **Immediate Actions**
   - Create WatchdogMonitor.test.ts
   - Implement reserve movement detection tests
   - Add consensus failure test scenarios

2. **Short Term (1 week)**
   - Complete P0 and P1 priority tests
   - Review and update existing tests for edge cases
   - Create integration test suite

3. **Medium Term (2-3 weeks)**
   - Complete all P2 priority tests
   - Conduct security review of test coverage
   - Performance and gas optimization tests

4. **Ongoing**
   - Monitor for new edge cases
   - Update tests with production learnings
   - Maintain test documentation

## Conclusion

This comprehensive testing plan addresses critical gaps in the Account Control system's test coverage. Priority should be given to WatchdogMonitor tests and reserve movement detection scenarios, as these represent the most significant security risks. Implementation of these tests will significantly improve system robustness and security.