# Emergency Scenarios Study: tBTC v2 Account Control System

## Document Purpose
Quick reference for emergency scenarios, current capabilities, and response procedures in the tBTC v2 account control system.

## Emergency Response Quick Reference

### Key Emergency Functions
- `emergencyPauseQC(address qc, bytes32 reason)` → QC-specific pause (7-day auto-expire)
- `forceConsensus()` → Override attestation deadlocks (requires ≥1 valid attestation)

### Authority & Role Details
See [ROLE_MATRIX.md](ROLE_MATRIX.md) for complete role definitions and [STATE_CHANGE_AUTHORITY.md](STATE_CHANGE_AUTHORITY.md) for QC status change authority model.

---

## Current Emergency Capabilities

### SystemState Pauses
- **Granular**: Separate pause controls for minting, redemption, registry, wallet registration
- **Time-Limited**: 7-day auto-expiry on emergency pauses
- **QC-Specific**: Target individual QCs without affecting others

### QC Management 
- **Emergency Pause**: Individual QC pause with reason codes
- **Automated Enforcement**: WatchdogEnforcer triggers violations permissionlessly
- **Status Control**: See [STATE_CHANGE_AUTHORITY.md](STATE_CHANGE_AUTHORITY.md) for complete state machine

### Reserve Attestation (QCReserveLedger)  
- **Consensus Required**: Minimum 3 attesters, median calculation
- **Staleness Detection**: Automatic UnderReview after timeout
- **Emergency Override**: `forceConsensus()` for deadlock resolution

---

## Emergency Scenarios & Solutions

### Scenario 1: Attestation System Failure
**Current Gap**: ~~No manual override~~  
**Status**: ✅ **SOLVED** - `forceConsensus()` implemented (QCReserveLedger.sol:152-187)

**Solution**: ARBITER can force consensus with any available attestation, breaking deadlocks while maintaining safety checks.

### Scenario 2: Coordinated Attack on Multiple QCs
**Current Gap**: No bulk operations for emergency response  
**Status**: ❌ **NOT IMPLEMENTED**

**Recommended Solution**: Batch operations
- `batchSetQCStatus(address[] qcs, QCStatus status, bytes32 reason)`  
- `batchEmergencyPause(address[] qcs, bytes32 reason)`
- Gas-limited with role-based security

**Alternative**: Global QC freeze (crude but immediate)

### Scenario 3: Critical Bug in Core Logic  
**Current Gap**: No live contract patching capability  
**Status**: ❌ **NOT IMPLEMENTED**

**Recommended Solution**: Enhanced circuit breaker + migration
- Maintains immutability principle
- Clear security model vs upgradeable contracts
- Requires comprehensive pause mechanisms

### Scenario 4: Stale Reserves Recovery
**Current Gap**: ~~No recovery path when attesters unavailable~~  
**Status**: ✅ **SOLVED** - `forceConsensus()` handles this case

**Solution**: QCs automatically go UnderReview when stale, ARBITER can restore via `forceConsensus()` with fresh attestations.

---

## Implementation Status Summary

### ✅ Completed (August 2025)
- **Emergency Attestation Override**: `forceConsensus()` function
- **QC-Specific Emergency Controls**: Individual pause/unpause with reason codes  
- **Stale Reserve Recovery**: Automatic detection + manual recovery path
- **Automated Violation Enforcement**: WatchdogEnforcer integration

### ❌ Outstanding Gaps
1. **Batch Emergency Operations**: Multi-QC status changes
2. **Enhanced Circuit Breakers**: More granular pause mechanisms  
3. **Live Patching Strategy**: Upgrade vs migration decision framework

### ⚠️ Partial Solutions
- **Monitoring & Alerting**: Basic event emission, needs off-chain integration
- **Documentation**: Technical implementation exists, operational runbooks needed

---

## Emergency Response Procedures

### Attestation Failure Response
1. **Detection**: WatchdogEnforcer triggers stale attestation violation
2. **Automatic**: QC status → UnderReview (minting paused)
3. **Manual**: ARBITER calls `forceConsensus()` with available attestations
4. **Recovery**: QC status restored when consensus re-established

### Coordinated Attack Response  
1. **Detection**: Multiple QC compromise indicators
2. **Manual**: Individual `emergencyPauseQC()` calls per affected QC
3. **Escalation**: Consider global minting pause if widespread
4. **Recovery**: Individual QC review and restoration

### Critical Bug Response
1. **Detection**: Bug identified in core logic  
2. **Manual**: Emergency pause of affected functions
3. **Escalation**: DAO governance for fix deployment
4. **Recovery**: Migration to patched contracts

---

## Implementation Priorities

### Phase 1: Critical (Immediate)
1. **Batch Emergency Operations** - Essential for coordinated attack response
2. **Enhanced Monitoring** - Off-chain alerting system
3. **Operational Runbooks** - Step-by-step emergency procedures

### Phase 2: Enhanced (Short-term)  
1. **Alternative Attestation Sources** - On-chain proof verification
2. **Governance Framework** - Formalized emergency response team
3. **Regular Drills** - Test emergency procedures

### Phase 3: Long-term Resilience
1. **Cross-chain Coordination** - Handle multi-chain emergencies
2. **Economic Attack Defense** - MEV and market manipulation response
3. **Legal Framework** - Documentation for regulatory compliance

---

## Key Contacts & Escalation

- **Immediate Response**: PAUSER_ROLE holders (Emergency Council)
- **Technical Decisions**: ARBITER_ROLE holders  
- **Governance**: DAO (DEFAULT_ADMIN_ROLE)
- **Development**: Security team + core developers

---

*Document Version: 2.0*  
*Last Updated: August 2025*  
*Status: ACTIVE - Emergency Reference*