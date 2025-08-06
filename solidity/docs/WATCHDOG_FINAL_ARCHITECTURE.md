# Watchdog System Final Architecture

**Document Version**: 1.0  
**Date**: 2025-08-06  
**Purpose**: Final architecture documentation for the simplified watchdog system  
**Status**: Final Design

---

## System Overview

The watchdog system provides monitoring and enforcement for the tBTC v2 protocol through a simplified 4-contract architecture that clearly separates oracle consensus, objective enforcement, and subjective reporting.

---

## Core Components

### 1. WatchdogReasonCodes Library

**Purpose**: Machine-readable violation codes for automated validation

**Key Features**:
- Standardized violation codes (bytes32 constants)
- Clear separation of objective (90%) vs subjective (10%) violations
- Enables automated watchdog validation

**Example Codes**:
```solidity
bytes32 constant INSUFFICIENT_RESERVES = keccak256("INSUFFICIENT_RESERVES");
bytes32 constant STALE_ATTESTATIONS = keccak256("STALE_ATTESTATIONS");
bytes32 constant REDEMPTION_TIMEOUT = keccak256("REDEMPTION_TIMEOUT");
```

---

### 2. ReserveOracle Contract

**Purpose**: Multi-attester consensus for reserve balances

**Key Features**:
- Accepts attestations from multiple sources
- Calculates median consensus
- Pushes consensus to QCReserveLedger
- Eliminates single point of trust

**Core Functions**:
```solidity
function submitAttestation(address qc, uint256 balance) external onlyRole(ATTESTER_ROLE)
function getConsensusReserves(address qc) external view returns (uint256)
```

**Consensus Mechanism**:
- Minimum 3 attesters required
- Median calculation for robustness
- Auto-triggers when threshold met

---

### 3. WatchdogReporting Contract

**Purpose**: Transparent reporting of subjective observations

**Key Features**:
- Simple event-based reporting
- Support mechanism for validation
- Evidence stored as hash array
- No complex state machines

**Report Structure**:
```solidity
struct Report {
    uint256 id;
    address watchdog;
    address target;
    ObservationType obsType;
    string description;
    bytes32[] evidenceHashes;  // Max 20 hashes
    uint256 timestamp;
    uint256 supportCount;
}
```

**Observation Types**:
- SUSPICIOUS_PATTERN
- OPERATIONAL_CONCERN
- UNUSUAL_BEHAVIOR
- COMPLIANCE_QUESTION
- SECURITY_OBSERVATION
- GENERAL_CONCERN

**Key Design Decisions**:
- **No proposedAction**: Watchdogs observe, DAO decides
- **No severity levels**: Support count provides natural filtering
- **No rate limiting**: Gas costs and role-gating sufficient
- **Evidence as hashes**: Actual content via REST API

---

### 4. WatchdogEnforcer Contract

**Purpose**: Permissionless enforcement of objective violations

**Key Features**:
- Anyone can trigger enforcement
- Uses reason codes for validation
- Checks objective violations only
- Sets QC status on violation detection

**Expected Usage Pattern**:
- **Primary callers**: Watchdogs who continuously monitor QC compliance
- **Secondary callers**: Automated monitoring systems, community members, other participants
- **Resilience design**: Permissionless nature ensures system integrity even if watchdogs fail to act
- **Operational flow**: Watchdogs monitor → detect violations → enforce → log transparency events

**Enforcement Flow**:
```solidity
function enforceObjectiveViolation(address qc, bytes32 reasonCode) external {
    // 1. Validate reason code is objective
    // 2. Check violation condition
    // 3. If violated, set QC status
}
```

**Monitoring Functions**:
```solidity
// For watchdogs to check violations before enforcing
function checkViolation(address qc, bytes32 reasonCode) external view returns (bool violated, string memory reason)

// For efficient batch monitoring by watchdogs
function batchCheckViolations(address[] calldata qcs, bytes32 reasonCode) external view returns (address[] memory violatedQCs)
```

**Supported Violations**:
- INSUFFICIENT_RESERVES: QC reserves below minimum collateral ratio
- STALE_ATTESTATIONS: Reserve attestations are too old
- ZERO_RESERVES: QC has zero reserves but outstanding minted tokens

---

## Integration Architecture

### Reserve Attestation Flow
```
Attesters → ReserveOracle → Consensus → QCReserveLedger → Enforcement
```

### Subjective Reporting Flow
```
Watchdogs → SubjectiveReporting → Events → DAO Monitoring → Governance Action
```

### Objective Enforcement Flow
```
Watchdogs (Primary) → WatchdogEnforcer → Validation → QCManager Status Update
Community/Systems (Fallback) → WatchdogEnforcer → Validation → QCManager Status Update
```

**Typical Workflow**:
1. Watchdogs continuously monitor QCs using `checkViolation()` or `batchCheckViolations()`
2. Upon detecting violations, watchdogs call `enforceObjectiveViolation()`
3. If watchdogs are inactive, any participant can step in to enforce violations
4. All enforcement attempts are logged for transparency and monitoring

---

## Evidence Storage Architecture

### On-Chain Storage
- Only evidence hashes (32 bytes each)
- Maximum 20 evidence items per report
- Prevents DoS through bounded arrays

### Off-Chain Storage
- Watchdog REST API serves actual evidence
- DAO members authenticate to access
- Evidence indexed by hash

### REST API Specification
```yaml
GET /evidence/{hash}
  authentication: DAO member signature
  response:
    hash: string
    reportId: number
    content: object
    signatures: array
```

---

## Role Architecture

### System Roles

| Role | Purpose | Contracts |
|------|---------|-----------|
| ATTESTER_ROLE | Submit reserve attestations | ReserveOracle |
| WATCHDOG_ROLE | Report subjective observations | SubjectiveReporting |
| ARBITER_ROLE | Update QC status | WatchdogEnforcer → QCManager |
| DAO_ROLE | Governance decisions | Direct action |

### Role Hierarchy
- No overlapping definitions
- Clear separation of concerns
- Standardized across contracts

---

## Data Flow Diagrams

### Oracle Consensus Flow
```
┌──────────┐    ┌──────────┐    ┌──────────┐
│Attester 1│    │Attester 2│    │Attester 3│
└────┬─────┘    └────┬─────┘    └────┬─────┘
     │               │               │
     └───────┬───────┴───────┬───────┘
             │               │
             ▼               ▼
      ┌─────────────────────────┐
      │    ReserveOracle        │
      │  - Collect attestations │
      │  - Calculate median     │
      └───────────┬─────────────┘
                  │
                  ▼
      ┌─────────────────────────┐
      │   QCReserveLedger       │
      │  - Store consensus      │
      │  - Track history        │
      └─────────────────────────┘
```

### Enforcement Flow
```
┌──────────┐         ┌─────────────────┐
│  Anyone  │────────▶│WatchdogEnforcer │
└──────────┘         └────────┬────────┘
                              │
                    Check Violation
                              │
                              ▼
                    ┌─────────────────┐
                    │   QCManager     │
                    │ Set QC Status   │
                    └─────────────────┘
```

---

## Security Considerations

### Trust Model
- **Reserve Attestations**: Trust distributed across multiple attesters
- **Objective Enforcement**: Trustless (permissionless with validation)
- **Subjective Reports**: Trust in individual watchdogs, validated by peers
- **DAO Actions**: Trust in governance process

### Attack Vectors Mitigated
- **Single point of failure**: Oracle consensus requires multiple attesters
- **Spam attacks**: Role-gating and gas costs
- **Evidence DoS**: Bounded array size (max 20)
- **Manipulation**: Machine-readable codes prevent interpretation attacks

---

## Gas Optimization

### Optimizations Implemented
- Evidence stored as hashes (32 bytes vs unbounded)
- No complex state tracking
- Minimal cross-contract calls
- Efficient data structures

### Estimated Gas Costs
- Submit attestation: ~50,000 gas
- Report observation: ~80,000 gas
- Support report: ~30,000 gas
- Enforce violation: ~60,000 gas

---

## Configuration Parameters

### Oracle Parameters
- Minimum attesters: 3
- Consensus mechanism: Median
- Freshness window: 7 days

### Reporting Parameters
- Max evidence per report: 20
- Support thresholds:
  - SECURITY_OBSERVATION: 0 (immediate)
  - COMPLIANCE_QUESTION: 1
  - Others: 3

### Enforcement Parameters
- Collateral ratio: 90%
- Staleness threshold: 7 days

---

## Comparison with Original System

| Aspect | Original (6 watchdog contracts) | Simplified (4 contracts) |
|--------|-------------------------|--------------------------|
| Complexity | High - overlapping logic | Low - clear separation |
| Trust Model | Single attester | Multi-attester consensus |
| Enforcement | Role-gated | Permissionless |
| Subjective Reports | Complex state machines | Simple events |
| Machine Validation | Human strings | Machine codes |
| Gas Costs | High - many calls | Low - optimized |
| Code Size | ~30,000 lines | ~2,000 lines |

---

## Future Enhancements

### Potential Improvements
1. **ZK Proofs**: Privacy-preserving evidence
2. **Slashing**: Economic penalties for false reports
3. **Reputation System**: Track watchdog performance
4. **Automated Remediation**: Self-healing for certain violations

### Upgrade Path
- Contracts upgradeable via ProtocolRegistry
- Clean interfaces enable modular updates
- No migration required for enhancements

---

## Conclusion

The simplified watchdog system successfully addresses the core problems identified in the original design:

1. **Machine Interpretation**: Solved with reason codes
2. **Trust Distribution**: Solved with oracle consensus
3. **Over-Complexity**: Solved with focused contracts
4. **Integration Gaps**: Solved with clean interfaces

The result is a system that is:
- **Simpler**: 33% fewer contracts
- **Clearer**: Single responsibility per contract
- **Safer**: No single points of failure
- **Efficient**: Optimized gas usage
- **Maintainable**: Clean, documented architecture