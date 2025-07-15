# Discrepancies and Issues - Watchdog Quorum Integration

**Date**: 2025-07-15  
**Purpose**: Document all discrepancies between design and implementation  
**Status**: Critical Issues Identified

## Critical Discrepancies

### 1. Documentation Version Mismatch
**Severity**: 🔴 High  
**Location**: All PRD files vs watchdog-decentralization.md  
**Expected**: Unified documentation describing quorum system  
**Actual**: PRDs describe single watchdog, separate doc describes quorum  
**Impact**: Confusion about actual implementation target  
**Fix**: Decision needed - implement V1 or V2?

### 2. Missing Core Contracts
**Severity**: 🔴 High  
**Location**: ./contracts/account-control/  
**Expected**: OptimisticWatchdogConsensus.sol, WatchdogAdapter.sol  
**Actual**: Only SingleWatchdog.sol exists  
**Impact**: Cannot implement quorum without these contracts  
**Fix**: Create new contracts based on patterns

### 3. Interface Definitions Missing
**Severity**: 🔴 High  
**Location**: ./contracts/account-control/interfaces/  
**Expected**: IOptimisticWatchdogConsensus.sol interface  
**Actual**: No consensus-related interfaces  
**Impact**: Cannot define contract interactions  
**Fix**: Create comprehensive interface definitions

## Medium Severity Issues

### 4. Event Definitions Incomplete
**Severity**: 🟡 Medium  
**Location**: N/A - not yet created  
**Expected**: Events for challenges, escalations, consensus  
**Actual**: Only single watchdog events exist  
**Impact**: Cannot track consensus operations  
**Fix**: Define new event set:
```solidity
event OperationSubmitted(bytes32 indexed operationId, address indexed validator);
event OperationChallenged(bytes32 indexed operationId, address indexed challenger);
event OperationEscalated(bytes32 indexed operationId, uint8 objectionCount);
event OperationExecuted(bytes32 indexed operationId, bool success);
```

### 5. ProtocolRegistry Integration
**Severity**: 🟡 Medium  
**Location**: ProtocolRegistry.sol  
**Expected**: Keys for consensus system services  
**Actual**: Only SINGLE_WATCHDOG key exists  
**Impact**: Cannot register new consensus services  
**Fix**: Add new service keys:
```solidity
bytes32 constant WATCHDOG_CONSENSUS = keccak256("WATCHDOG_CONSENSUS");
bytes32 constant WATCHDOG_ADAPTER = keccak256("WATCHDOG_ADAPTER");
```

### 6. Role Definitions
**Severity**: 🟡 Medium  
**Location**: Access control roles  
**Expected**: VALIDATOR_ROLE, CHALLENGER_ROLE  
**Actual**: Only WATCHDOG_OPERATOR_ROLE  
**Impact**: Cannot implement multi-watchdog permissions  
**Fix**: Define new role structure

## Low Severity Issues

### 7. Gas Measurements
**Severity**: 🟢 Low  
**Location**: Documentation  
**Expected**: Actual gas measurements for consensus  
**Actual**: Only estimates based on similar contracts  
**Impact**: May not meet gas targets  
**Fix**: Implement and measure actual gas usage

### 8. Test Coverage
**Severity**: 🟢 Low  
**Location**: ./test/  
**Expected**: Tests for consensus scenarios  
**Actual**: Only SingleWatchdog tests  
**Impact**: No validation of consensus logic  
**Fix**: Create comprehensive test suite

## Pattern Inconsistencies

### 9. Delay Mechanisms
**Source**: TBTCOptimisticMinting uses fixed 3-hour delay  
**Target**: Need escalating delays [1h, 4h, 12h]  
**Gap**: Must implement dynamic delay calculation

### 10. Role Assignment
**Source**: TBTCOptimisticMinting uses manual role assignment  
**Target**: Need deterministic primary validator selection  
**Gap**: Must implement selection algorithm

## Integration Gaps

### 11. Backward Compatibility
**Expected**: Zero changes to existing contracts  
**Risk**: May need minimal updates to QCManager, etc.  
**Mitigation**: Use adapter pattern strictly

### 12. Migration Path
**Expected**: Seamless upgrade from single to quorum  
**Actual**: No migration contracts or scripts  
**Gap**: Need migration strategy implementation

## Operational Gaps

### 13. Monitoring Infrastructure
**Expected**: Dashboards for consensus tracking  
**Actual**: No specifications or implementations  
**Gap**: Need monitoring service design

### 14. Coordination Protocol
**Expected**: Off-chain watchdog coordination  
**Actual**: No protocol specification  
**Gap**: Need coordination service design

## Summary by Category

| Category | Critical | Medium | Low | Total |
|----------|----------|--------|-----|-------|
| Documentation | 1 | 0 | 0 | 1 |
| Contracts | 2 | 0 | 0 | 2 |
| Integration | 0 | 3 | 0 | 3 |
| Testing | 0 | 0 | 2 | 2 |
| Operations | 0 | 2 | 0 | 2 |
| **TOTAL** | **3** | **5** | **2** | **10** |

## Recommended Priority

### Week 1: Critical Issues
1. Get decision on V1 vs V2 implementation
2. Create interface definitions
3. Start OptimisticWatchdogConsensus contract

### Week 2: Medium Issues  
4. Complete event definitions
5. Update ProtocolRegistry integration
6. Implement role structure

### Week 3: Remaining Items
7. Gas optimization
8. Test implementation
9. Operational tooling

## Blockers

1. **Decision Required**: V1 (single) or V2 (quorum) - blocks everything
2. **Interface Design**: Must be complete before implementation
3. **Pattern Validation**: Need confirmation that adapted patterns are acceptable

## Next Actions

1. **Immediate**: Get stakeholder decision on implementation target
2. **Day 1-2**: Create IOptimisticWatchdogConsensus interface
3. **Day 3-5**: Begin OptimisticWatchdogConsensus implementation
4. **Week 2**: Integration and testing