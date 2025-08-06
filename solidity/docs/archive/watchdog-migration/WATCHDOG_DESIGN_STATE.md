# Current Watchdog System Design State

**Document Version**: 1.0  
**Date**: 2025-08-06  
**Purpose**: Accurate representation of the current design after all discussions  
**Status**: Current State Documentation

---

## Executive Summary

After extensive analysis and simplification, we've created a focused watchdog system that addresses three core problems with minimal complexity. This document represents the ACTUAL current state, not aspirational design.

---

## Current Architecture

### Contracts Created (4 Total)

#### 1. WatchdogReasonCodes.sol
- **Purpose**: Machine-readable violation codes for automated validation
- **Status**: ✅ Implemented
- **Integration**: Used by WatchdogEnforcer for validation

#### 2. ReserveOracle.sol  
- **Purpose**: Multi-attester consensus for reserve balances
- **Status**: ✅ Implemented
- **Integration**: Connected to QCReserveLedger

#### 3. WatchdogSubjectiveReporting.sol
- **Purpose**: Simple transparent reporting of subjective observations
- **Status**: ✅ Implemented (simplified version without DAOBridge)
- **Key Features**:
  - No proposedAction field (watchdogs observe, don't prescribe)
  - Evidence stored as hash array (max 20 per report)
  - No explicit severity levels
  - No rate limiting

#### 4. WatchdogEnforcer.sol
- **Purpose**: Permissionless enforcement of objective violations
- **Status**: ✅ Implemented
- **Integration**: Uses reason codes, calls QCManager

### Contracts Modified

#### QCReserveLedger.sol
- Added `recordConsensusAttestation()` for oracle integration
- Added `reserveOracle` address storage
- Maintains backward compatibility for single attester

### Contracts Removed
- ~~WatchdogDAOBridge~~ - Unnecessary intermediary

---

## Design Decisions (Final)

### 1. Three-Problem Framework

We identified three distinct problems requiring different solutions:

| Problem | Solution | Implementation |
|---------|----------|----------------|
| **Oracle Problem** | Multiple attesters for untrusted facts | ReserveOracle |
| **Observation Problem** | Transparent individual reporting | WatchdogSubjectiveReporting |
| **Decision Problem** | DAO governance | Direct DAO action (no bridge) |

### 2. Evidence Storage
- **On-chain**: Array of evidence hashes (32 bytes each, max 20)
- **Off-chain**: Actual evidence served by watchdog REST APIs
- **Access**: DAO members fetch using hash as key
- **No IPFS**: Simpler to use existing watchdog infrastructure

### 3. Subjective Reporting Simplifications
- **No proposedAction**: Watchdogs report observations, not solutions
- **No severity levels**: Support count provides natural importance filtering
- **No rate limiting**: Gas costs + role-gating provide sufficient protection
- **Type-based thresholds**: 
  - SECURITY_OBSERVATION: Auto-escalate
  - COMPLIANCE_QUESTION: 1 supporter needed
  - Others: 3 supporters needed

### 4. Integration Approach
- **Objective violations**: Anyone can call enforcer with proof
- **Reserve attestations**: Oracle consensus, then permissionless enforcement
- **Subjective concerns**: Reports emit events, DAO monitors and acts directly

---

## What Was Removed (Full Migration)

These contracts from the original PR were completely removed:
- **WatchdogAutomatedEnforcement.sol** - Complex automated enforcement (removed)
- **WatchdogDAOEscalation.sol** - Complex escalation system (removed)
- **WatchdogConsensusManager.sol** - M-of-N voting with human strings (removed)
- **WatchdogThresholdActions.sol** - Threshold-based actions (removed)
- **WatchdogMonitor.sol** - Monitoring logic (removed)
- **QCWatchdog.sol** - Single operator proxy (removed)

---

## Migration Completed

### What We Did
We chose **Option B: Replace Old** and successfully completed the migration:
1. **Removed all 6 old watchdog contracts**
2. **Deployed 4 new simplified contracts**
3. **Updated deployment scripts**
4. **Removed old test files**
5. **Cleaned up all references**

### Integration Points
1. **ReserveOracle → QCReserveLedger**: Oracle has ATTESTER_ROLE for consensus submissions
2. **WatchdogEnforcer → QCManager**: Enforcer has ARBITER_ROLE for status updates
3. **WatchdogSubjectiveReporting**: Emits events for DAO monitoring
4. **WatchdogReasonCodes**: Library used by Enforcer for validation

---

## Documentation Status

### Current Documents (Accurate)
- **CURRENT_DESIGN_STATE.md** - This document, reflects actual state
- **WATCHDOG_MIGRATION_COMPLETE.md** - Documents the migration process
- **WATCHDOG_FINAL_ARCHITECTURE.md** - Final architecture documentation
- **EVIDENCE_STORAGE_FINAL_DESIGN.md** - Hash + REST API design
- **WATCHDOG_DESIGN_INSIGHTS.md** - Historical journey
- **ORACLE_DESIGN_DECISION.md** - Oracle architecture rationale

### Documents Needing Updates
Some older documents still reference outdated designs but are kept for historical context.

---

## Summary

Migration to the simplified 4-contract watchdog system is complete. All old contracts have been removed, new contracts are deployed, and integration points are configured. The system now provides:

- **Oracle consensus** for reserve attestations (no single point of trust)
- **Permissionless enforcement** of objective violations
- **Simple event-based** subjective reporting
- **Direct DAO action** without intermediary contracts