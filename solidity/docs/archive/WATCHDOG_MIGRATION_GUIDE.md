# Watchdog System Migration Guide

**Document Version**: 1.0  
**Date**: 2025-08-02  
**Purpose**: Guide for migrating from subjective consensus to automated decision framework  
**Status**: Implementation Guide

---

## Executive Summary

This guide provides step-by-step instructions for migrating from the current WatchdogConsensusManager system (subjective voting) to the new Automated Decision Framework (deterministic + DAO governance). The migration ensures zero downtime and maintains security throughout the transition.

**Migration Timeline**: 4 weeks  
**Backwards Compatibility**: Full during transition period  
**Risk Level**: Low (parallel deployment strategy)

---

## Overview of Changes

### Current System (Being Replaced)
- **WatchdogConsensusManager**: Subjective voting on human-readable proposals
- **Manual Coordination**: Watchdogs must coordinate on every decision
- **Interpretation Required**: Automated systems cannot validate reasoning

### New System (Target Architecture)
- **Layer 1**: WatchdogAutomatedEnforcement for deterministic decisions
- **Layer 2**: WatchdogThresholdActions for objective issue reporting
- **Layer 3**: WatchdogDAOEscalation for governance decisions

### Key Benefits
- **90%+ automation** of watchdog decisions
- **No human interpretation** required for machines
- **Faster response times** for objective violations
- **Clear escalation path** to DAO for subjective issues

---

## Migration Strategy

### Phase 1: Parallel Deployment (Week 1)

#### Step 1.1: Deploy New Framework
```bash
# Deploy automated framework contracts
npx hardhat deploy --tags "AutomatedDecisionFramework" --network <network>

# Configure roles and permissions
npx hardhat deploy --tags "ConfigureAutomatedDecisionFramework" --network <network>
```

#### Step 1.2: Verify Deployment
```solidity
// Check all contracts deployed correctly
WatchdogAutomatedEnforcement: 0x...
WatchdogThresholdActions: 0x...
WatchdogDAOEscalation: 0x...
ReserveLedger: 0x...
```

#### Step 1.3: Initial Testing
- Run automated enforcement on test QCs
- Verify threshold actions work with test reports
- Confirm DAO escalation creates proposals correctly

### Phase 2: Parallel Operation (Week 2-3)

#### Step 2.1: Configure Dual Operation
```typescript
// Update watchdog software to use both systems
const config = {
  // Old system (fallback)
  consensusManager: "0x...",
  monitor: "0x...",
  
  // New system (primary)
  automatedEnforcement: "0x...",
  thresholdActions: "0x...",
  daoEscalation: "0x...",
  
  // Migration settings
  useNewSystem: true,
  fallbackToOld: true,
  parallelValidation: true
}
```

#### Step 2.2: Monitor and Compare
- **Automated Decisions**: Compare old vs new enforcement actions
- **Response Times**: Measure improvement in objective violations
- **DAO Proposals**: Verify escalations create proper governance proposals

#### Step 2.3: Gradual Migration by Operation Type

**Week 2: Migrate Deterministic Operations**
```typescript
// Move objective violations to automated enforcement
const migratedOperations = [
  'reserve_compliance',
  'redemption_timeouts', 
  'wallet_inactivity',
  'operational_compliance'
]
```

**Week 3: Migrate Threshold Actions**
```typescript
// Move subjective reports to threshold system
const migratedReports = [
  'suspicious_activity',
  'unusual_patterns',
  'emergency_situations', 
  'operational_concerns'
]
```

### Phase 3: Full Migration (Week 4)

#### Step 3.1: Disable Old Consensus
```solidity
// Pause old consensus manager (governance action)
await watchdogConsensusManager.pause()

// Update all watchdog configurations
await updateWatchdogConfig({
  useOldConsensus: false,
  useAutomatedFramework: true
})
```

#### Step 3.2: Update Watchdog Software
```typescript
// Remove old consensus logic
// class OldWatchdog {
//   async proposeStatusChange(qc, status, reason) { ... }
//   async vote(proposalId) { ... }
// }

// New automated approach
class NewWatchdog {
  async enforceCompliance(qc) {
    return this.automatedEnforcement.enforceReserveCompliance(qc)
  }
  
  async reportIssue(type, target, evidence) {
    return this.thresholdActions.reportIssue(type, target, evidence.hash, evidence.uri)
  }
}
```

#### Step 3.3: Final Validation
- Confirm all operations using new framework
- Verify DAO proposals work end-to-end
- Monitor system performance and gas costs

### Phase 4: Cleanup (Week 5-6)

#### Step 4.1: Remove Old Contracts (Optional)
```solidity
// Remove roles from old contracts
await qcManager.revokeRole(ARBITER_ROLE, watchdogConsensusManager.address)
await qcRedeemer.revokeRole(ARBITER_ROLE, watchdogConsensusManager.address)

// Note: Keep contracts deployed for emergency fallback
```

#### Step 4.2: Documentation Updates
- Update operational procedures
- Update monitoring dashboards  
- Update incident response playbooks

---

## Technical Migration Details

### Contract Integration Points

#### QCManager Integration
```solidity
// OLD: WatchdogConsensusManager calls QCManager.setQCStatus()
// NEW: WatchdogAutomatedEnforcement calls QCManager.setQCStatus()

// Ensure roles are properly transferred:
await qcManager.revokeRole(ARBITER_ROLE, oldConsensusManager)
await qcManager.grantRole(ARBITER_ROLE, automatedEnforcement)
```

#### QCRedeemer Integration  
```solidity
// OLD: WatchdogConsensusManager calls QCRedeemer.flagDefaultedRedemption()
// NEW: WatchdogAutomatedEnforcement calls QCRedeemer.flagDefaultedRedemption()

// Update role assignments:
await qcRedeemer.revokeRole(ARBITER_ROLE, oldConsensusManager)
await qcRedeemer.grantRole(ARBITER_ROLE, automatedEnforcement)
```

#### SystemState Integration
```solidity
// NEW: Configure automated enforcement parameters
await systemState.setMinCollateralRatio(90)      // 90%
await systemState.setRedemptionTimeout(48 * 3600) // 48 hours
await systemState.setFailureThreshold(3)          // 3 failures
await systemState.setFailureWindow(7 * 24 * 3600) // 7 days
```

### Data Migration

#### No State Migration Required
- **QC Status**: Preserved in QCData
- **Wallet Registration**: No changes needed
- **Reserve Attestations**: Continue in existing ledger
- **Redemption History**: Preserved in QCRedeemer

#### New State Initialization
```solidity
// Initialize failure tracking in automated enforcement
// (starts fresh - historical failures not migrated)

// Initialize report tracking in threshold actions  
// (starts fresh - no historical reports)

// Initialize escalation tracking in DAO system
// (starts fresh - new governance proposals)
```

### Monitoring Migration

#### Update Dashboards
```yaml
# Old monitoring
old_metrics:
  - watchdog_proposals_created
  - watchdog_votes_cast
  - consensus_time_to_decision
  
# New monitoring  
new_metrics:
  - automated_actions_executed
  - threshold_reports_submitted
  - dao_escalations_created
  - enforcement_response_time
```

#### Update Alerting
```yaml
# Old alerts
old_alerts:
  - proposal_timeout
  - insufficient_votes
  - consensus_deadlock
  
# New alerts
new_alerts:
  - automated_enforcement_failure
  - threshold_reached
  - dao_escalation_created
  - enforcement_cooldown_violation
```

---

## Watchdog Operator Migration

### Software Updates Required

#### Old Watchdog Implementation
```typescript
// Remove these functions:
async proposeStatusChange(qc: string, status: QCStatus, reason: string)
async proposeWalletDeregistration(qc: string, wallet: string, reason: string)  
async proposeRedemptionDefault(redemptionId: string, reason: string)
async vote(proposalId: string)
async executeProposal(proposalId: string)
```

#### New Watchdog Implementation
```typescript
// Add these functions:
async enforceReserveCompliance(qc: string)
async enforceRedemptionTimeout(redemptionId: string)
async enforceWalletInactivity(wallet: string)
async enforceOperationalCompliance(qc: string)

async reportSuspiciousActivity(qc: string, evidence: Evidence)
async reportUnusualPattern(qc: string, evidence: Evidence)
async reportEmergency(qc: string, evidence: Evidence)
async reportOperationalConcern(qc: string, evidence: Evidence)
```

#### Evidence Structure
```typescript
interface Evidence {
  hash: string      // Hash of evidence data
  uri: string       // IPFS URI to full evidence
  timestamp: number // When evidence was collected
  source: string    // Source of evidence
}

// Example evidence creation
const evidence = {
  hash: ethers.utils.keccak256(evidenceData),
  uri: `ipfs://${ipfsHash}`,
  timestamp: Date.now(),
  source: 'reserve_monitoring'
}
```

### Configuration Changes

#### Old Configuration
```yaml
# OLD: watchdog.yml
consensus:
  required_votes: 2
  total_watchdogs: 5
  voting_period: 7200  # 2 hours
  
operations:
  check_interval: 300  # 5 minutes
  proposal_types:
    - status_change
    - wallet_deregistration  
    - redemption_default
```

#### New Configuration
```yaml
# NEW: watchdog.yml
enforcement:
  check_interval: 60      # 1 minute (faster)
  cooldown_respect: true
  batch_operations: true
  
threshold_reporting:
  evidence_storage: ipfs
  min_evidence_size: 1kb
  max_evidence_size: 10mb
  
automation:
  reserve_compliance: enabled
  redemption_timeouts: enabled
  wallet_inactivity: enabled
  operational_compliance: enabled
```

### Operational Changes

#### Decision Making Process

**OLD PROCESS:**
1. Watchdog detects issue
2. Create human-readable proposal
3. Wait for other watchdogs to vote
4. Execute if consensus reached
5. Handle disputes manually

**NEW PROCESS:**
1. **Objective Issues**: Execute immediately via automated enforcement
2. **Subjective Issues**: Create evidence-based report
3. **Threshold Reached**: Automatic action + DAO escalation
4. **DAO Decision**: Community governance resolution

#### Response Times

| Issue Type | Old Response Time | New Response Time | Improvement |
|------------|------------------|------------------|-------------|
| Stale Reserves | 2-24 hours | <1 minute | 120x-1440x faster |
| Redemption Timeout | 2-24 hours | <1 minute | 120x-1440x faster |
| Suspicious Activity | 2-24 hours | <1 hour | 2x-24x faster |
| Emergency Issues | 2-24 hours | <10 minutes | 12x-144x faster |

---

## Testing Strategy

### Pre-Migration Testing

#### Unit Tests
```bash
# Test automated enforcement
npm test test/account-control/WatchdogAutomatedEnforcement.test.ts

# Test threshold actions
npm test test/account-control/WatchdogThresholdActions.test.ts

# Test integration
npm test test/account-control/AutomatedDecisionFrameworkIntegration.test.ts
```

#### Integration Tests
```bash
# Test full migration scenario
npm test test/migration/WatchdogMigration.test.ts

# Test parallel operation
npm test test/migration/ParallelOperation.test.ts

# Test rollback capability
npm test test/migration/RollbackTest.test.ts
```

### Production Validation

#### Parallel Validation Tests
1. **Decision Comparison**: Run both systems, compare outcomes
2. **Performance Testing**: Measure response times and gas costs  
3. **Stress Testing**: High-volume operations during peak usage
4. **Failover Testing**: Verify emergency fallback procedures

#### Acceptance Criteria
- [ ] All automated enforcement works correctly
- [ ] Threshold actions trigger at proper levels
- [ ] DAO escalations create valid proposals
- [ ] Gas costs within acceptable ranges
- [ ] Response times meet performance requirements
- [ ] No security vulnerabilities introduced

---

## Risk Mitigation

### Technical Risks

#### Risk: Automated Enforcement False Positives
**Mitigation**: 
- Conservative thresholds initially
- Manual override capabilities  
- DAO can pause enforcement if needed

#### Risk: Threshold Actions Gaming
**Mitigation**:
- Require registered watchdogs only
- Cooldown periods prevent spam
- Evidence requirements for reports

#### Risk: DAO Escalation Bottleneck
**Mitigation**:
- Emergency pause capabilities
- Multiple escalation pathways
- Clear governance procedures

### Operational Risks

#### Risk: Watchdog Software Migration Errors
**Mitigation**:
- Staged rollout by watchdog operator
- Parallel operation period for validation
- Rollback procedures documented

#### Risk: Monitoring Gap During Migration
**Mitigation**: 
- Dual monitoring during transition
- Clear escalation procedures
- 24/7 support during migration weeks

### Financial Risks

#### Risk: Gas Cost Increase
**Mitigation**:
- Batch operations where possible
- Optimized contract design
- Gas cost monitoring and alerts

---

## Rollback Procedures

### Emergency Rollback (If Needed)

#### Immediate Rollback
```solidity
// 1. Pause new system
await automatedEnforcement.pause()
await thresholdActions.pause()

// 2. Re-enable old system
await watchdogConsensusManager.unpause()

// 3. Restore old role assignments
await qcManager.grantRole(ARBITER_ROLE, watchdogConsensusManager.address)
await qcRedeemer.grantRole(ARBITER_ROLE, watchdogConsensusManager.address)
```

#### Watchdog Configuration Rollback
```typescript
// Update watchdog config to use old system
const rollbackConfig = {
  useNewSystem: false,
  useOldSystem: true,
  rollbackReason: 'emergency_rollback_reason'
}
```

### Partial Rollback
```typescript
// Roll back specific operation types while keeping others
const partialRollback = {
  automated_enforcement: false,    // Disable automation
  threshold_actions: true,         // Keep threshold system
  dao_escalation: true            // Keep DAO escalation
}
```

---

## Success Metrics

### Performance Metrics
- **Response Time**: 90%+ reduction in median response time
- **Automation Rate**: 90%+ of decisions automated
- **Gas Efficiency**: <20% increase in gas costs
- **Uptime**: 99.9%+ availability during migration

### Operational Metrics  
- **Decision Accuracy**: <1% false positive rate
- **DAO Escalations**: <10% of total issues escalated
- **Watchdog Satisfaction**: >90% positive feedback
- **Community Adoption**: >95% DAO proposal approval rate

### Security Metrics
- **Incident Response**: <5 minute average response to critical issues
- **Zero Exploits**: No security incidents during migration
- **Audit Coverage**: 100% code coverage for new contracts
- **Penetration Testing**: Pass all security assessments

---

## Support and Resources

### Migration Support Team
- **Technical Lead**: Smart contract development team
- **Operations Lead**: Watchdog operator coordination  
- **QA Lead**: Testing and validation oversight
- **Community Lead**: DAO communication and governance

### Documentation Resources
- [Automated Decision Framework Specification](./WATCHDOG_AUTOMATED_DECISION_FRAMEWORK.md)
- [API Documentation](./WATCHDOG_API_SPECIFICATION.md)
- [Operations Guide](./WATCHDOG_V11_OPERATIONS_GUIDE.md)

### Emergency Contacts
- **24/7 Support**: support@example.com
- **Technical Issues**: tech-team@example.com  
- **Governance Questions**: dao@example.com

---

## Conclusion

The migration from subjective consensus to automated decision framework represents a significant improvement in the tBTC watchdog system. By following this guide, the migration can be completed safely with minimal risk and maximum benefit.

**Key Success Factors:**
1. **Thorough Testing**: Comprehensive validation before production
2. **Gradual Migration**: Phased approach reduces risk
3. **Parallel Operation**: Validation period ensures correctness  
4. **Clear Communication**: All stakeholders informed throughout
5. **Rollback Ready**: Emergency procedures prepared

The new automated framework will provide faster, more reliable, and more secure watchdog operations while maintaining the flexibility to escalate complex issues to DAO governance.