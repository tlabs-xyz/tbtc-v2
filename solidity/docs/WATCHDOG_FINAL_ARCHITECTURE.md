# Watchdog System Final Architecture

**Document Version**: 1.0  
**Date**: 2025-08-06  
**Purpose**: Final architecture documentation for the simplified watchdog system  
**Status**: Final Design

---

## System Overview

The watchdog system provides monitoring and enforcement for the tBTC v2 protocol through 4 watchdog-specific contracts that handle consensus, enforcement, and reporting within a larger 14-contract account control system.

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

### 2. QCReserveLedger Contract (formerly ReserveOracle)

**Purpose**: Multi-attester consensus oracle and reserve balance storage

**Key Features**:
- **Single Interface Architecture**: Uses consensus-based approach instead of dual interface
- Accepts attestations from multiple sources with ATTESTER_ROLE
- Calculates median consensus using insertion sort algorithm  
- Stores consensus reserve balances with staleness tracking
- Implements Byzantine fault tolerance through median calculation

**Security Properties**:
- **Individual attesters cannot manipulate final balance** - consensus required
- **Byzantine fault tolerant** - median protects against up to 50% malicious attesters
- **Threshold protection** - requires 3+ attestations before any balance update

**Core Functions**:
```solidity
function submitAttestation(address qc, uint256 balance) external onlyRole(ATTESTER_ROLE)
function getReserveBalanceAndStaleness(address qc) external view returns (uint256, bool)
function isReserveStale(address qc) external view returns (bool isStale, uint256 timeSinceUpdate)
```

**Consensus Parameters**:
- `consensusThreshold`: 3 attestations required (configurable)
- `attestationTimeout`: 6 hours window for valid attestations
- `maxStaleness`: 24 hours before data considered stale

**Consensus Mechanism**:
- Minimum 3 attesters required (configurable)
- Insertion sort + median calculation for robustness
- Auto-triggers when threshold met
- Efficient O(n) median for small attester sets (≤10)

**Architectural Decision**:
The single interface consensus-based design is more secure than oracle/ledger separation because:
1. **Atomic Operations**: Consensus and storage happen atomically, preventing inconsistencies
2. **Reduced Attack Surface**: No additional interfaces or cross-contract calls
3. **Byzantine Fault Tolerance**: Built-in consensus provides stronger security than external oracle
4. **Gas Efficiency**: No additional contract calls for consensus operations

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
Attesters → QCReserveLedger (internal consensus) → Enforcement
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
| ATTESTER_ROLE | Submit reserve attestations | QCReserveLedger |
| WATCHDOG_ROLE | Report subjective observations | SubjectiveReporting |
| ARBITER_ROLE | Update QC status | WatchdogEnforcer → QCManager |
| DAO_ROLE | Governance decisions | Direct action |

### Role Hierarchy
- No overlapping definitions
- Clear separation of concerns
- Standardized across contracts

---

## Data Flow Diagrams

### Reserve Consensus Flow
```
┌──────────┐    ┌──────────┐    ┌──────────┐
│Attester 1│    │Attester 2│    │Attester 3│
└────┬─────┘    └────┬─────┘    └────┬─────┘
     │               │               │
     └───────┬───────┴───────┬───────┘
             │               │
             ▼               ▼
      ┌─────────────────────────┐
      │   QCReserveLedger       │
      │  - Collect attestations │
      │  - Calculate median     │
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

| Aspect | Original (6 watchdog contracts) | Current (4 watchdog contracts) |
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

The watchdog system successfully addresses the core problems identified in the original design:

1. **Machine Interpretation**: Solved with reason codes
2. **Trust Distribution**: Solved with multi-attester consensus in QCReserveLedger
3. **Over-Complexity**: Solved with focused watchdog contracts
4. **Integration Gaps**: Solved with clean interfaces

## Complete Account Control System

The 4 watchdog contracts operate within a broader **14-contract account control system**:

### Watchdog-Specific Contracts (4)
- WatchdogReasonCodes.sol - Machine-readable violation codes
- QCReserveLedger.sol - Multi-attester consensus and storage
- WatchdogReporting.sol - Subjective observation reporting
- WatchdogEnforcer.sol - Permissionless objective enforcement

### Core Account Control Infrastructure (10)
- QCManager.sol - QC lifecycle management
- QCData.sol - QC state and data storage
- BasicMintingPolicy.sol - Direct Bank integration for minting
- BasicRedemptionPolicy.sol - Redemption policy implementation
- QCMinter.sol - User-facing minting interface
- QCRedeemer.sol - User-facing redemption interface
- SystemState.sol - Global system parameters
- ProtocolRegistry.sol - Service discovery and upgrades
- SPVValidator.sol - Bitcoin SPV proof validation
- BitcoinAddressUtils.sol - Bitcoin address utilities

**Total System**: 14 contracts + 3 interfaces = **17 total files**

The result is a watchdog subsystem that is:
- **Focused**: 4 contracts handle watchdog concerns specifically
- **Clearer**: Single responsibility per contract
- **Safer**: No single points of failure in consensus
- **Efficient**: Optimized algorithms (insertion sort for small sets)
- **Maintainable**: Clean, documented architecture