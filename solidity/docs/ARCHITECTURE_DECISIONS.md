# Architecture Decisions Record (ADR)

**Document Version**: 1.0  
**Date**: 2025-08-06  
**Purpose**: Document key architectural decisions and their rationale  
**Status**: Active

---

## Overview

This document records significant architectural decisions made during the development of the Account Control system for tBTC v2, particularly focusing on the watchdog system migration.

---

## ADR-001: Watchdog System Simplification

### Date
2025-08-06

### Status
Accepted and Implemented

### Context
The initial watchdog system (v1.x) contained 6+ contracts with overlapping responsibilities:
- WatchdogAutomatedEnforcement
- WatchdogConsensusManager  
- WatchdogDAOEscalation
- WatchdogThresholdActions
- WatchdogMonitor
- QCWatchdog

Critical issue identified: **Machines cannot interpret human-readable strings** - the OptimisticWatchdogConsensus expected automated systems to understand strings like "excessive_slippage_observed".

### Decision
Migrate to a simplified 4-contract architecture based on the **Three-Problem Framework**:

1. **Oracle Problem** → `ReserveOracle` (multi-attester consensus)
2. **Observation Problem** → `WatchdogReporting` (transparent reporting)
3. **Decision Problem** → Direct DAO action (no intermediary)
4. **Enforcement** → `WatchdogEnforcer` (permissionless with reason codes)

### Consequences
**Positive:**
- 33% reduction in contracts (6 → 4)
- Machine-readable reason codes enable automation
- No single points of trust
- Gas optimization through minimal state
- Clear separation of concerns

**Negative:**
- Migration effort required
- Documentation updates needed
- Retraining for operators

---

## ADR-002: Machine-Readable Reason Codes

### Date
2025-08-05

### Status
Accepted and Implemented

### Context
Original system used human-readable strings for violations:
```solidity
"excessive_slippage_observed"
"suspicious_minting_pattern" 
"reserve_shortfall_detected"
```

Machines cannot interpret semantic meaning from strings.

### Decision
Replace strings with standardized bytes32 reason codes:
```solidity
bytes32 constant INSUFFICIENT_RESERVES = keccak256("INSUFFICIENT_RESERVES");
bytes32 constant STALE_ATTESTATIONS = keccak256("STALE_ATTESTATIONS");
```

### Consequences
**Positive:**
- Enables automated validation
- Reduces gas costs (bytes32 vs string)
- Prevents interpretation attacks
- Clear objective vs subjective separation

**Negative:**
- Less human-readable in logs
- Requires mapping for UI display

---

## ADR-003: Oracle Consensus for Reserve Attestations

### Date
2025-08-05

### Status
Accepted and Implemented

### Context
Original design trusted a single attester for reserve balances - single point of failure.

User feedback: "we don't trust single watchdogs"

### Decision
Implement multi-attester oracle consensus:
- Minimum 3 attesters required
- Median calculation for robustness
- Automatic consensus when threshold met

### Consequences
**Positive:**
- Eliminates single trust point
- Byzantine fault tolerance
- Robust against manipulation

**Negative:**
- Higher operational complexity
- Requires multiple attesters
- Slightly higher gas costs

---

## ADR-004: Remove proposedAction Field

### Date
2025-08-05

### Status
Accepted and Implemented

### Context
Initial design included `proposedAction` field in subjective reports, allowing watchdogs to suggest remediation.

User feedback: "watchdogs should report observations, DAO should investigate and make judgment"

### Decision
Remove `proposedAction` field entirely. Watchdogs only report observations, DAO decides actions.

### Consequences
**Positive:**
- Clear separation of concerns
- Prevents watchdog overreach
- Simplifies report structure

**Negative:**
- DAO must interpret observations
- No automated remediation hints

---

## ADR-005: No Rate Limiting for Reports

### Date
2025-08-05

### Status
Accepted and Implemented

### Context
Proposed various rate limiting mechanisms to prevent spam.

User feedback: "I don't think any rate-limiting ideas you shared are actually good"

### Decision
No explicit rate limiting - rely on:
- Gas costs as natural deterrent
- Role-gating (WATCHDOG_ROLE required)
- Support thresholds for importance

### Consequences
**Positive:**
- Simpler implementation
- No artificial constraints
- Emergencies not blocked

**Negative:**
- Potential for spam if gas is cheap
- Requires active DAO monitoring

---

## ADR-006: Evidence Storage via Hashes

### Date
2025-08-05

### Status
Accepted and Implemented

### Context
Need to store evidence for subjective reports without DoS vulnerability.

Options considered:
1. Full on-chain storage
2. IPFS with CID storage
3. Hash storage with REST API

### Decision
Store evidence hashes on-chain (max 20 per report), actual content via watchdog REST APIs.

### Consequences
**Positive:**
- Bounded on-chain storage
- No DoS vulnerability
- Leverages existing infrastructure

**Negative:**
- Requires off-chain availability
- Trust in watchdog REST APIs

---

## ADR-007: Direct DAO Action Model

### Date
2025-08-05

### Status
Accepted and Implemented

### Context
Initial design included WatchdogDAOBridge as intermediary between reports and DAO.

User feedback: "why cant the dao simply observe onchain reporting, discuss it offchain and then take action?"

### Decision
Remove DAOBridge entirely. DAO monitors events directly and takes action through governance.

### Consequences
**Positive:**
- Eliminates unnecessary contract
- Simpler architecture
- Direct accountability

**Negative:**
- Requires DAO tooling for monitoring
- No automated escalation

---

## ADR-008: Full Migration vs Parallel Systems

### Date
2025-08-06

### Status
Accepted and Implemented

### Context
Choice between:
- Option A: Keep both old and new systems
- Option B: Full migration to new system

User decision: "we want to fully migrate to new contracts"

### Decision
Complete migration - remove all old watchdog contracts, deploy only new simplified system.

### Consequences
**Positive:**
- No confusion from dual systems
- Clean architecture
- Lower maintenance burden

**Negative:**
- No gradual transition
- Higher migration risk
- Breaking change

---

## ADR-009: Permissionless Enforcement

### Date
2025-08-05

### Status
Accepted and Implemented

### Context
Original system required specific roles to trigger enforcement actions.

### Decision
Allow anyone to call `enforceObjectiveViolation()` - validation ensures only real violations trigger.

### Consequences
**Positive:**
- No dependency on specific operators
- Faster response to violations
- Increased system resilience

**Negative:**
- Potential for griefing attempts
- Higher validation gas costs

---

## ADR-010: Support-Based Report Filtering

### Date
2025-08-05

### Status
Accepted and Implemented

### Context
Need mechanism to filter important reports without explicit severity levels.

### Decision
Use support count as natural importance indicator:
- SECURITY_OBSERVATION: 0 supporters (immediate)
- COMPLIANCE_QUESTION: 1 supporter
- Others: 3 supporters for visibility

### Consequences
**Positive:**
- Organic importance emergence
- No artificial severity scale
- Community-driven prioritization

**Negative:**
- Requires multiple watchdogs
- Delayed response for non-critical

---

## Summary

The architectural decisions reflect a philosophy of:
1. **Simplification** over feature completeness
2. **Trust distribution** over efficiency
3. **Clear separation** over integration
4. **Machine readability** over human interpretation
5. **Direct action** over intermediation

These decisions resulted in a 33% reduction in contract count while improving security and clarity.