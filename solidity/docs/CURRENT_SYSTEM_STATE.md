# Current System State - tBTC v2 Account Control

**Document Version**: 2.0  
**Date**: 2025-08-06  
**Purpose**: Single authoritative source for current system state  
**Status**: Active

---

## Related Documentation

This document provides the **overall system architecture overview**. For specialized subsystem designs, see:

- **[QC State Management - Comprehensive Design](../../tbtc-v2-tmp/qc-state/comprehensive_qc_state_design.md)** - 5-state QC operational model with renewable pause credits  
- **[Pause Architecture](PAUSE_ARCHITECTURE.md)** - System-wide emergency pause mechanisms
- **[Graduated Consequences Design](GRADUATED_CONSEQUENCES_DESIGN.md)** - Business logic consequences for redemption defaults

**Scope of This Document**: Current deployment status, contract architecture, and system-wide operational state. For detailed subsystem designs, see the specific design documents above.

---

## Executive Summary

The tBTC v2 Account Control system enables Qualified Custodians (QCs) to mint tBTC against their Bitcoin reserves through direct Bank integration. The system implements a 5-state QC management model with renewable pause credits and automated escalation, providing network continuity during operational issues.

**Key Statistics**:
- **Core Contracts**: 12 (QC management + state control) + 3 (watchdog)
- **QC States**: 5-state linear model (Active → MintingPaused → Paused/UnderReview → Revoked)
- **Network Continuity**: 60% of states preserve redemption fulfillment
- **Trust Model**: Multi-attester consensus with watchdog auto-escalation
- **Architecture**: Direct Bank integration with modular policies
- **Gas Savings**: ~50% vs abstraction layer approach

---

## System Architecture

### Core Account Control System

| Component | Purpose | Status |
|-----------|---------|--------|
| **QCManager** | QC lifecycle and business logic | ✅ Deployed |
| **QCData** | Isolated storage layer (5-state enum) | 🔄 Update Required |
| **QCStateManager** | 5-state transition logic with auto-escalation | 🆕 New Contract |
| **QCRenewablePause** | Renewable pause credit system | 🆕 New Contract |
| **QCMinter** | Minting entry point | ✅ Deployed |
| **QCRedeemer** | Redemption management | ✅ Deployed |
| **QCReserveLedger** | Unified reserve attestation and consensus | ✅ Deployed |
| **BasicMintingPolicy** | Direct Bank integration | 🔄 Update Required |
| **BasicRedemptionPolicy** | Redemption policy logic | 🔄 Update Required |
| **SystemState** | Global parameters and pausing | ✅ Deployed |
| **SPVValidator** | Bitcoin SPV proof validation | ✅ Deployed |

### Simplified Watchdog System (v2.0)

| Component            | Purpose                                                      | Status         |
| -------------------- | ------------------------------------------------------------ | -------------- |
| **QCReserveLedger**  | Multi-attester consensus oracle                              | ✅ Implemented |
| **WatchdogEnforcer** | Permissionless violation enforcement (includes reason codes) | ✅ Implemented |

---

## Key Design Principles

### 1. Two-Problem Framework

- **Oracle Problem**: Multi-attester consensus for objective facts (solved by QCReserveLedger)
- **Enforcement Problem**: Permissionless enforcement of objective violations (solved by WatchdogEnforcer with embedded reason codes)

### 2. Direct Integration

- Uses existing Bank/Vault infrastructure
- No abstraction layers
- ~50% gas savings vs proxy approaches

### 3. Trust Distribution

- No single points of failure
- Minimum 3 attesters for reserve consensus
- Permissionless enforcement of violations

### 4. Machine Readability

- Standardized bytes32 reason codes (INSUFFICIENT_RESERVES, STALE_ATTESTATIONS, SUSTAINED_RESERVE_VIOLATION)
- Automated validation without human interpretation
- Clear objective vs subjective separation

---

## Current Configuration

### System Parameters

```solidity
// Reserve Management
minCollateralRatio: 100%        // Minimum reserves vs minted
staleThreshold: 24 hours        // Max age for reserve attestations
attestationTimeout: 6 hours     // Oracle collection window

// Operations
redemptionTimeout: 7 days       // QC must fulfill within
minMintAmount: 0.01 tBTC        // Minimum minting amount
maxMintAmount: 1000 tBTC        // Maximum per transaction

// 5-State Model Parameters
pauseExpiryTime: 48 hours       // Self-pause auto-escalation timer
pauseCreditInterval: 90 days    // Renewable pause credit period
defaultPenaltyWindow: 90 days   // Window for graduated consequences
redemptionGracePeriod: 8 hours  // Protection before deadline
```

### Role Structure

- **DEFAULT_ADMIN_ROLE**: DAO governance
- **ATTESTER_ROLE**: Oracle attesters (multiple entities)
- **ARBITER_ROLE**: Update QC status, handle defaults
- **WATCHDOG_ROLE**: Trigger auto-escalation checks
- **STATE_MANAGER_ROLE**: QCStateManager contract (in QCData)
- **WATCHDOG_ENFORCER_ROLE**: WatchdogEnforcer contract
- **MINTER_ROLE**: QCMinter contract
- **PAUSER_ROLE**: Emergency council
- **QC_ADMIN_ROLE**: QC administration
- **QC_GOVERNANCE_ROLE**: QC registration and capacity

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

## 5-State Model Features

### Network Continuity Focus
- **60% State Availability**: 3 out of 5 states allow redemption fulfillment
- **Graduated Response**: Issues handled proportionally to severity
- **Self-Recovery**: QCs can resume from self-initiated pauses

### Renewable Pause Credits
- **Initial Credit**: Each QC gets 1 pause credit on registration
- **Renewal Period**: New credit every 90 days
- **Usage**: For emergency maintenance or operational issues
- **Early Resume**: QCs can resume before 48h expires

### Auto-Escalation System
- **48-Hour Timer**: Self-pauses auto-escalate if not resolved
- **Watchdog Monitoring**: Automated checking for escalation
- **UnderReview Transition**: Unresolved pauses trigger council review

### Graduated Consequences
- **First Default**: MintingPaused (can still fulfill)
- **Second Default**: Paused (maintenance required)
- **Persistent Issues**: UnderReview (council intervention)
- **Final**: Revoked (permanent termination)

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
    QCManager → QCData (direct reference)
                           ↓
                    QCReserveLedger ← ReserveOracle ← Attesters
```

---

## Operational Status

### QC States (5-State Model)
- **Active**: Full operations - can mint and fulfill redemptions
- **MintingPaused**: Can fulfill redemptions but cannot mint new tBTC (self-initiated or watchdog)
- **Paused**: Self-initiated maintenance pause, cannot mint or fulfill (48h max)
- **UnderReview**: Council review state, can fulfill but cannot mint
- **Revoked**: Permanently disabled, no operations allowed

### State Transition Rules
```
Active ↔ MintingPaused (QC self-pause for routine maintenance)
MintingPaused → Paused (QC escalates for full maintenance)
Paused → UnderReview (Auto-escalation after 48h if not resumed)
MintingPaused/Paused → Active (QC resumes early)
UnderReview → Active/Revoked (Council decision)
```

### Redemption States

- **Pending**: Awaiting Bitcoin transaction
- **Fulfilled**: Completed with SPV proof
- **Defaulted**: Failed to fulfill within timeout

---

## System Design Rationale

### Core Architecture Decisions

1. **Watchdog System**: 3-contract architecture for clarity and efficiency
2. **Trust Model**: Multi-attester consensus eliminates single points of failure
3. **Enforcement**: Permissionless validation enables objective enforcement
4. **Reporting**: Simple event emission with machine-readable reason codes

### Design Principles

- **Machine-Readable**: System uses structured data instead of human strings
- **Trust Distribution**: Multiple attesters provide consensus on objective facts
- **Simplification**: Minimal contracts reduce complexity and gas costs
- **Clear Separation**: Different problems addressed with focused solutions

---

## Operational Details

### Renewable Pause Credit Mechanism

QCs receive renewable pause credits for operational flexibility:

- **Initial Grant**: 1 credit upon QC registration
- **Renewal Period**: 1 new credit every 90 days
- **Maximum Credits**: 1 (no accumulation)
- **Usage**: Consumed when self-pausing (MintingPaused or Paused)
- **Recovery**: Must wait 90 days for renewal after use

### Auto-Escalation Timer

Self-initiated pauses have automatic escalation to prevent indefinite disruption:

```
Self-Pause Initiated (MintingPaused/Paused)
        ↓
48-Hour Timer Starts
        ↓
QC Can Resume Anytime (resumeSelfPause)
        ↓
If Not Resumed After 48h:
        ↓
Watchdog Calls checkEscalation()
        ↓
Auto-Escalate to UnderReview
        ↓
Emergency Council Intervention Required
```

### Default Tracking & Progressive Consequences

The system tracks redemption defaults with graduated consequences:

**Timing Parameters:**
- **Consecutive Default Window**: 30 days (resets if no defaults)
- **Recovery Period**: 90 days between penalty tiers
- **First Default**: Active → MintingPaused (can still fulfill)
- **Second Default**: MintingPaused → UnderReview (council review)
- **Third Default**: UnderReview → Revoked (permanent termination)

**Default Recovery Path:**
- Clear redemption backlog
- Maintain good standing for recovery period
- Council approval for UnderReview → Active transition

### Role Distribution Across Contracts

| Contract | Roles | Purpose |
|----------|-------|---------|
| **QCManager** | QC_ADMIN_ROLE, REGISTRAR_ROLE, ARBITER_ROLE, QC_GOVERNANCE_ROLE, WATCHDOG_ENFORCER_ROLE | Business logic and coordination |
| **QCMinter** | MINTER_ROLE | Minting authorization |
| **QCRedeemer** | REDEEMER_ROLE, ARBITER_ROLE | Redemption and arbitration |
| **SystemState** | PARAMETER_ADMIN_ROLE, PAUSER_ROLE | System parameters and pausing |
| **QCData** | QC_MANAGER_ROLE, STATE_MANAGER_ROLE | State storage management |
| **QCReserveLedger** | ATTESTER_ROLE | Reserve attestation |
| **WatchdogEnforcer** | Permissionless | Anyone can trigger violations |

### Emergency Response Quick Reference

**Key Emergency Functions:**
- `emergencyPauseQC(address qc, bytes32 reason)` - QC-specific pause (7-day auto-expire)
- `forceConsensus()` - Override attestation deadlocks (requires ≥1 valid attestation)
- `pauseMinting()` / `pauseRedemption()` - Global function pauses
- `checkEscalation(address qc)` - Trigger escalation after 45-minute timer
- `enforceObjectiveViolation(qc, reasonCode)` - Permissionless violation enforcement

**Emergency Authority:**
- **PAUSER_ROLE**: Execute pauses (Emergency Council)
- **ARBITER_ROLE**: Force consensus, resolve disputes
- **Anyone**: Trigger objective violations via WatchdogEnforcer

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

_This document is the authoritative source for current system state. All other state descriptions should reference this document._
