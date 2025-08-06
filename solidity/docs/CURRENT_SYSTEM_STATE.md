# Current System State - tBTC v2 Account Control

**Document Version**: 2.0  
**Date**: 2025-08-06  
**Purpose**: Single authoritative source for current system state  
**Status**: Active

---

## Executive Summary

The tBTC v2 Account Control system enables Qualified Custodians (QCs) to mint tBTC against their Bitcoin reserves through direct Bank integration. Following a recent migration, the system now uses a simplified watchdog architecture based on the Three-Problem Framework.

**Key Statistics**:
- **Core Contracts**: 10 (QC management) + 3 (watchdog)
- **Trust Model**: Multi-attester consensus (no single points of failure) 
- **Architecture**: Direct Bank integration with modular policies
- **Gas Savings**: ~50% vs abstraction layer approach

---

## System Architecture

### Core Account Control System

| Component | Purpose | Status |
|-----------|---------|--------|
| **ProtocolRegistry** | Service discovery and upgrades | ✅ Deployed |
| **QCManager** | QC lifecycle and business logic | ✅ Deployed |
| **QCData** | Isolated storage layer | ✅ Deployed |
| **QCMinter** | Minting entry point | ✅ Deployed |
| **QCRedeemer** | Redemption management | ✅ Deployed |
| **QCReserveLedger** | Unified reserve attestation and consensus | ✅ Deployed |
| **BasicMintingPolicy** | Direct Bank integration | ✅ Deployed |
| **BasicRedemptionPolicy** | Redemption policy logic | ✅ Deployed |
| **SystemState** | Global parameters and pausing | ✅ Deployed |
| **SPVValidator** | Bitcoin SPV proof validation | ✅ Deployed |

### Simplified Watchdog System (v2.0)

| Component | Purpose | Status |
|-----------|---------|--------|
| **WatchdogReasonCodes** | Machine-readable violation codes | ✅ Implemented |
| **WatchdogReporting** | Transparent event-based reporting | ✅ Implemented |
| **WatchdogEnforcer** | Permissionless violation enforcement | ✅ Implemented |

### Removed in Migration

The following contracts were removed during the watchdog simplification:
- ~~WatchdogAutomatedEnforcement~~ → Replaced by WatchdogEnforcer
- ~~WatchdogConsensusManager~~ → Replaced by ReserveOracle
- ~~WatchdogDAOEscalation~~ → Direct DAO action model
- ~~WatchdogThresholdActions~~ → Simplified reporting
- ~~WatchdogMonitor~~ → No longer needed
- ~~QCWatchdog~~ → Functionality distributed

---

## Key Design Principles

### 1. Three-Problem Framework
- **Oracle Problem**: Multi-attester consensus for objective facts
- **Observation Problem**: Transparent reporting for subjective concerns
- **Decision Problem**: Direct DAO governance without intermediaries

### 2. Direct Integration
- Uses existing Bank/Vault infrastructure
- No abstraction layers
- ~50% gas savings vs proxy approaches

### 3. Trust Distribution
- No single points of failure
- Minimum 3 attesters for reserve consensus
- Permissionless enforcement of violations

### 4. Machine Readability
- Standardized bytes32 reason codes
- Automated validation without human interpretation
- Clear objective vs subjective separation

---

## Current Configuration

### System Parameters
```solidity
// Reserve Management
minCollateralRatio: 90%         // Minimum reserves vs minted
staleThreshold: 7 days          // Max age for attestations
attestationWindow: 1 hour       // Oracle collection window

// Operations
redemptionTimeout: 48 hours     // QC must fulfill within
minMintAmount: 0.01 tBTC        // Minimum minting amount
maxMintAmount: 100 tBTC         // Maximum per transaction

// Reporting
maxEvidencePerReport: 20        // Hash array limit
supportThresholds: {
  SECURITY_OBSERVATION: 0,      // Immediate escalation
  COMPLIANCE_QUESTION: 1,       // 1 supporter needed
  Others: 3                     // 3 supporters needed
}
```

### Role Structure
- **DEFAULT_ADMIN_ROLE**: DAO governance
- **ATTESTER_ROLE**: Oracle attesters (multiple entities)
- **WATCHDOG_ROLE**: Subjective reporters
- **ARBITER_ROLE**: WatchdogEnforcer contract
- **MINTER_ROLE**: QCMinter contract
- **PAUSER_ROLE**: Emergency council

### Operational Expectations

**WatchdogEnforcer Usage Pattern**:
- **Primary Operation**: Watchdogs continuously monitor QCs and call enforcement functions
- **Fallback Mechanism**: Permissionless design allows anyone to enforce violations if watchdogs fail
- **Monitoring Flow**: Watchdogs use `checkViolation()` and `batchCheckViolations()` for efficient scanning
- **Enforcement Flow**: Upon detecting violations, watchdogs call `enforceObjectiveViolation()`
- **Transparency**: All enforcement attempts logged via events for DAO monitoring

**Expected Actors**:
- **Primary**: Watchdogs with WATCHDOG_ROLE who monitor system health
- **Secondary**: Automated monitoring systems, community members, other participants
- **Resilience**: System integrity maintained even if primary actors are inactive

---

## Integration Points

### With tBTC Core
- **Bank Contract**: BasicMintingPolicy authorized as balance increaser
- **TBTCVault**: Receives balance increases for auto-minting
- **TBTC Token**: QCMinter has MINTER_ROLE, QCRedeemer has BURNER_ROLE

### Data Flow
```
User → QCMinter → BasicMintingPolicy → Bank → TBTCVault → TBTC Tokens
         ↓
    ProtocolRegistry ← QCManager ← QCData
                           ↓
                    QCReserveLedger ← ReserveOracle ← Attesters
```

---

## Operational Status

### QC States
- **Active**: Can mint and fulfill redemptions
- **UnderReview**: Minting paused, under investigation
- **Revoked**: Permanently disabled

### Redemption States
- **Pending**: Awaiting Bitcoin transaction
- **Fulfilled**: Completed with SPV proof
- **Defaulted**: Failed to fulfill within timeout

---

## Recent Changes (Migration v2.0)

### What Changed
1. **Watchdog System**: 6 contracts → 4 contracts (33% reduction)
2. **Trust Model**: Single watchdog → Multi-attester consensus
3. **Enforcement**: Role-gated → Permissionless with validation
4. **Reporting**: Complex state machines → Simple event emission

### Why It Changed
- **Machine Interpretation**: Contracts cannot understand human strings
- **Trust Distribution**: Eliminate single points of failure
- **Simplification**: Reduce complexity and gas costs
- **Clear Separation**: Different problems need different solutions

---

## Documentation References

### Technical Documentation
- **Architecture**: docs/ARCHITECTURE.md
- **Implementation**: docs/IMPLEMENTATION.md
- **Deployment**: deploy/README.md

### Business Documentation
- **Requirements**: prd/REQUIREMENTS.md
- **User Flows**: prd/FLOWS.md
- **Product Overview**: prd/README.md

### Watchdog Specific
- **Final Architecture**: docs/WATCHDOG_FINAL_ARCHITECTURE.md
- **Architecture Decisions**: docs/ARCHITECTURE_DECISIONS.md

---

## Next Steps

### Immediate
1. Complete integration testing on testnet
2. Security audit of simplified watchdog system
3. Grant roles to initial attesters and reporters

### Near Term
1. Onboard first Qualified Custodians
2. Establish oracle attester network
3. Configure DAO monitoring tools

### Long Term
1. Expand QC network
2. Optimize gas costs further
3. Consider graduated documentation (Phase 3)

---

*This document is the authoritative source for current system state. All other state descriptions should reference this document.*