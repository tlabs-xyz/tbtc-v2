# Emergency Scenarios Study: tBTC v2 Account Control System

## Document Purpose
This document provides a rigorous, methodical analysis of emergency scenarios in the tBTC v2 account control system. For each scenario, we examine multiple remediation options considering the project's trust assumptions and requirements.

## Table of Contents
1. [Current Emergency Capabilities](#current-emergency-capabilities)
2. [Trust Assumptions & Requirements](#trust-assumptions--requirements)
3. [Emergency Scenarios Analysis](#emergency-scenarios-analysis)
4. [Proposed Solutions Matrix](#proposed-solutions-matrix)
5. [Implementation Recommendations](#implementation-recommendations)

---

## Current Emergency Capabilities

### 1. Role-Based Access Control (RBAC)
```
DEFAULT_ADMIN_ROLE      → DAO governance (ultimate authority)
ARBITER_ROLE           → Can change QC status to any state
PAUSER_ROLE            → Emergency council - pause functions
PARAMETER_ADMIN_ROLE   → Update system parameters
ATTESTER_ROLE          → Submit reserve attestations
```

### 2. Pause Mechanisms (SystemState)
- **Granular Pauses**: Can pause minting, redemption, registry, wallet registration independently
- **Time-Limited**: Emergency pauses expire after `emergencyPauseDuration` (default 7 days)
- **No Global Kill Switch**: Intentionally no single "pause everything" function

### 3. QC Status Management (QCManager)
- **Three States**: Active → UnderReview → Revoked
- **Status Change Authority**: Only through QCManager with proper roles
- **UnderReview**: Pauses minting but allows redemptions (circuit breaker)

### 4. Automated Enforcement (WatchdogEnforcer)
- **Permissionless**: Anyone can trigger for objective violations
- **Limited Power**: Can only set QCs to UnderReview
- **Objective Violations**: Insufficient reserves, stale attestations

### 5. Reserve Attestation (QCReserveLedger)
- **Multi-Attester Consensus**: Requires minimum 3 attesters
- **Median Calculation**: Resistant to single outlier manipulation
- **No Admin Override**: All updates must go through consensus

### 6. QC-Specific Emergency Controls (SystemState)
- **Individual QC Pausing**: Target specific qualified custodians without affecting others
- **Reason Code Tracking**: Emergency actions include machine-readable reason codes
- **Reversible Controls**: Both pause and unpause functions available
- **Time-Limited Duration**: Automatic expiry after `emergencyPauseDuration` (default 7 days)
- **Integration Ready**: Modifier `qcNotEmergencyPaused` for other contracts to check status

#### Implementation Details
```solidity
// Primary emergency pause function with reason tracking
function emergencyPauseQC(address qc, bytes32 reason) external onlyRole(PAUSER_ROLE)

// Unpause function for recovery
function emergencyUnpauseQC(address qc) external onlyRole(PAUSER_ROLE)

// Status checking functions
function isQCEmergencyPaused(address qc) external view returns (bool)
function isQCEmergencyPauseExpired(address qc) external view returns (bool)
function getQCPauseTimestamp(address qc) external view returns (uint256)
```

#### Common Reason Codes
- `INSUFFICIENT_COLLATERAL`: Below minimum collateral ratio
- `STALE_ATTESTATIONS`: Reserve attestations too old
- `COMPLIANCE_VIOLATION`: Regulatory or compliance issue
- `SECURITY_INCIDENT`: Security breach or suspicious activity
- `TECHNICAL_FAILURE`: System malfunction or bug
- `GENERIC_EMERGENCY_PAUSE`: Default for backward compatibility

#### Integration Points
- **WatchdogEnforcer**: Calls `emergencyPauseQC()` for automated violations
- **QCMinter/QCRedeemer**: Check `qcNotEmergencyPaused` modifier before operations
- **Monitoring Systems**: Listen for `QCEmergencyPaused` events for alerts
- **DAO Governance**: Can revoke PAUSER_ROLE if emergency powers abused

---

## Trust Assumptions & Requirements

### Core Trust Model
1. **No Single Point of Failure**: System should survive compromise of any single actor
2. **Permissionless Where Possible**: Objective violations enforceable by anyone
3. **Governed Where Necessary**: Subjective decisions require DAO governance
4. **Transparency**: All actions logged via events
5. **Proportional Response**: Graduated enforcement (pause → review → revoke)

### Security Requirements
1. **Reserve Integrity**: Reserve data must be trustless and tamper-proof
2. **Emergency Response**: Must handle critical failures within hours
3. **Attack Resistance**: Survive coordinated attacks on infrastructure
4. **Recovery Capability**: Ability to restore normal operations after incident

### Operational Requirements
1. **24/7 Availability**: System must function without constant human oversight
2. **Clear Escalation**: Well-defined paths from detection to resolution
3. **Audit Trail**: Complete record of all emergency actions
4. **Minimal Collateral Damage**: Targeted responses that don't affect entire system

---

## Emergency Scenarios Analysis

### Scenario 1: Complete Attestation System Failure
**Description**: All attesters go offline or attestation consensus mechanism fails completely

#### Current State (Updated August 2025)
- ✅ **Manual override implemented** via `forceConsensus()` function
- ✅ Reserves marked as "stale" after timeout
- ✅ WatchdogEnforcer triggers STALE_ATTESTATIONS violation
- ✅ QCs go to UnderReview, then ARBITER can force consensus with available attestations

**Implemented Solution**: ARBITER can now call `forceConsensus()` to break deadlocks when normal consensus cannot be reached. This requires at least one valid attestation to prevent arbitrary balance setting.

#### Option A: Emergency Manual Override
**Implementation**: Add `emergencySetReserveBalance()` restricted to ARBITER_ROLE

**Strongman (Pros)**:
- Immediate resolution of critical failures
- DAO maintains ultimate control
- Clear audit trail with reason codes
- Time-boxed emergency powers

**Strawman (Cons)**:
- Violates "no admin reserve updates" principle
- Single point of failure if ARBITER compromised
- Could be abused for non-emergencies
- Undermines trust in attestation system

#### Option B: Emergency Single-Attester Mode
**Implementation**: Allow ARBITER to temporarily reduce consensus threshold to 1

**Strongman (Pros)**:
- Maintains attestation flow structure
- Automatically reverts after timeout
- Less drastic than manual override
- Preserves event/audit trail

**Strawman (Cons)**:
- Still requires at least one functional attester
- Vulnerable to single compromised attester
- Complex state management
- May not help if attestation logic itself is broken

#### Option C: Pause-and-Migrate Strategy
**Implementation**: Pause all operations, deploy fixed contracts, migrate state

**Strongman (Pros)**:
- No compromise on security principles
- Allows fixing root cause
- Clean architectural solution
- No emergency backdoors needed

**Strawman (Cons)**:
- Lengthy process (days/weeks)
- Requires full system pause
- Complex migration process
- User funds locked during migration

### Scenario 2: Coordinated Attack on Multiple QCs
**Description**: Multiple QCs compromised simultaneously, need bulk emergency actions

#### Current State
- ❌ **No bulk operations** for status changes
- ✅ Individual QC status changes possible
- ✅ Can pause minting globally
- ⚠️  Manual process for multiple QCs

#### Option A: Batch Status Change Functions
**Implementation**: Add `batchSetQCStatus()` to QCManager

**Strongman (Pros)**:
- Rapid response to coordinated attacks
- Gas-efficient for multiple operations
- Maintains role-based security
- Clear audit trail per QC

**Strawman (Cons)**:
- Increased attack surface
- Risk of accidental bulk changes
- Complex validation logic
- May timeout with too many QCs

#### Option B: Global QC Freeze
**Implementation**: Add global "freeze all QCs" emergency function

**Strongman (Pros)**:
- Single transaction response
- Immediate effect
- Simple to implement
- Easy to understand

**Strawman (Cons)**:
- Affects innocent QCs
- Crude instrument
- Difficult to unfreeze selectively
- May cause panic

### Scenario 3: Critical Bug in Core Logic
**Description**: Bug discovered in consensus calculation or enforcement logic

#### Current State
- ✅ Can pause affected functions
- ✅ DAO can deploy fixes
- ❌ **No way to patch live contracts**
- ⚠️  Requires migration for fixes

#### Option A: Upgradeable Proxy Pattern
**Implementation**: Make critical contracts upgradeable

**Strongman (Pros)**:
- Quick bug fixes
- No migration needed
- Minimal user disruption
- Standard pattern

**Strawman (Cons)**:
- Introduces upgrade risk
- Centralization concern
- Complex governance needed
- Against immutability principle

#### Option B: Circuit Breaker + Migration
**Implementation**: Enhanced pause mechanisms with migration support

**Strongman (Pros)**:
- Maintains immutability
- Clear security model
- No upgrade risks
- Forced code review

**Strawman (Cons)**:
- Slow response time
- Complex migrations
- User inconvenience
- High coordination cost

### Scenario 4: Stale Reserves with Active QC
**Description**: QC reserves go stale but QC is otherwise functioning

#### Current State (Updated August 2025)
- ✅ Automatic UnderReview via WatchdogEnforcer
- ✅ Minting paused automatically
- ✅ **Can restore via `forceConsensus()`** with any fresh attestations
- ✅ QC can be recovered even with reduced attesters

**Implemented Solution**: When reserves go stale and QC enters UnderReview, the ARBITER can use `forceConsensus()` to update reserves using any available fresh attestations, even if below the normal consensus threshold.

#### Option A: Grace Period Override
**Implementation**: Allow ARBITER to extend staleness threshold temporarily

**Strongman (Pros)**:
- Buys time for attesters to return
- No direct data manipulation
- Temporary measure only
- Maintains trust model

**Strawman (Cons)**:
- Delays problem resolution
- May hide real issues
- Requires manual monitoring
- Not a real solution

#### Option B: Alternative Attestation Sources
**Implementation**: Allow backup attestation methods (e.g., on-chain proofs)

**Strongman (Pros)**:
- Decentralized fallback
- Cryptographic verification
- No admin intervention
- Permanent solution

**Strawman (Cons)**:
- Complex implementation
- Higher gas costs
- May not cover all assets
- Requires QC cooperation

---

## Proposed Solutions Matrix

| Scenario | Current Gap | Option A | Option B | Option C | Recommendation | Status |
|----------|-------------|----------|----------|----------|----------------|--------|
| Attestation Failure | ~~No manual override~~ | Emergency Override | Single-Attester Mode | Pause & Migrate | **Option B** (balance of speed and security) | ✅ Implemented via `forceConsensus()` |
| Coordinated Attack | No bulk ops | Batch Functions | Global Freeze | - | **Option A** (targeted response) | ❌ Not implemented |
| Critical Bug | No patching | Upgradeable | Circuit Breaker | - | **Option B** (maintains immutability) | ❌ Not implemented |
| Stale Reserves | ~~No recovery path~~ | Grace Period | Alt Attestation | - | **Option B** (permanent solution) | ✅ Implemented via `forceConsensus()` |

---

## Implementation Recommendations

### Phase 1: Critical Gaps (Immediate)
1. **Emergency Attestation Override** ✅ IMPLEMENTED
   - ~~Add temporary single-attester mode for ARBITER~~
   - ~~48-hour time limit with automatic reversion~~
   - ~~Detailed event logging with reason codes~~
   
   **Implementation Details (August 2025)**:
   - Added `forceConsensus()` function to QCReserveLedger
   - ARBITER_ROLE can force consensus with available attestations
   - Requires at least 1 valid attestation (safety check)
   - Emits `ForcedConsensusReached` event for transparency
   - See: QCReserveLedger.sol:152-187

2. **Batch Emergency Operations**
   - Implement `batchSetQCStatus()` with gas limits
   - Add `batchRevokeRole()` for attester management
   - Require multi-sig or time delay for execution

### Phase 2: Enhanced Monitoring (Short-term)
1. **Automated Alerts**
   - Off-chain monitoring for stale reserves
   - Alert system for attestation failures
   - Dashboard for emergency responders

2. **Runbook Documentation**
   - Step-by-step emergency procedures
   - Decision trees for different scenarios
   - Contact lists and escalation paths

### Phase 3: Long-term Resilience (Future)
1. **Alternative Attestation Methods**
   - On-chain proof verification
   - Cross-chain attestation bridges
   - Automated attestation from oracles

2. **Governance Enhancements**
   - Formalized emergency response team
   - Regular drill exercises
   - Post-mortem process

---

## Open Questions for Further Research

1. **Attestation Incentives**: How do we ensure attesters remain online and honest?
2. **Recovery Time Objectives**: What are acceptable downtime limits for different scenarios?
3. **Legal Considerations**: Do emergency powers need legal framework documentation?
4. **Economic Attacks**: How do emergency responses handle economic/MEV attacks?
5. **Cross-chain Risks**: How do emergencies on one chain affect others?

---

## Next Steps

1. **Stakeholder Review**: Present findings to DAO, security team, and attesters
2. **Threat Modeling**: Formal security analysis of proposed solutions
3. **Implementation Planning**: Prioritize based on risk and complexity
4. **Testing Strategy**: Define comprehensive emergency drill procedures

---

*Document Version: 1.0*  
*Last Updated: [Current Date]*  
*Status: DRAFT - Pending Review*