# Pause System Integration Plan: tBTC v2 Account Control

**Document Version**: 1.0  
**Date**: 2025-08-07  
**Status**: Implementation Plan  
**Purpose**: Roadmap to integrate designed-but-unused emergency pause mechanisms

---

## Executive Summary

The tBTC v2 system has a sophisticated two-tier pause architecture that is **architecturally complete but operationally disconnected**. The emergency pause infrastructure exists in `SystemState.sol` but is not integrated with the actual minting/redemption operations.

**Current Gap**: Two parallel QC disable mechanisms exist but don't coordinate:
1. **Status-based system** (Active → UnderReview → Revoked) - **Currently used**
2. **Emergency pause system** - **Infrastructure ready, not integrated**

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Integration Strategy](#integration-strategy)  
3. [Implementation Phases](#implementation-phases)
4. [Detailed Task Breakdown](#detailed-task-breakdown)
5. [Testing Requirements](#testing-requirements)
6. [Deployment Strategy](#deployment-strategy)
7. [Risk Assessment](#risk-assessment)

---

## Current State Analysis

### What's Fully Implemented ✅

```solidity
// SystemState.sol - Emergency pause infrastructure
function emergencyPauseQC(address qc, bytes32 reason) external onlyRole(PAUSER_ROLE)
function emergencyUnpauseQC(address qc) external onlyRole(PAUSER_ROLE)
modifier qcNotEmergencyPaused(address qc)

// Query functions
function isQCEmergencyPaused(address qc) external view returns (bool)
function isQCEmergencyPauseExpired(address qc) external view returns (bool)
function getQCPauseTimestamp(address qc) external view returns (uint256)
```

### What's Missing ⏳

#### 1. **Operational Contract Integration**
- `QCMinter.requestQCMint()` - Missing `qcNotEmergencyPaused(qc)` modifier
- `QCRedeemer.initiateRedemption()` - Missing `qcNotEmergencyPaused(qc)` modifier
- Policy contracts not checking emergency pause status

#### 2. **WatchdogEnforcer Integration**
- Only calls `qcManager.requestStatusChange()` 
- Never calls `systemState.emergencyPauseQC()`
- No severity-based escalation logic

#### 3. **Coordination Between Systems**
- Status changes and emergency pauses operate independently
- No unified QC operational status query
- No escalation from status → emergency pause

---

## Integration Strategy

### Recommended Approach: **Parallel Systems with Coordination**

Both systems serve different purposes and should coexist:

- **Status System**: Graduated policy enforcement (automated)
- **Emergency Pause**: Immediate security response (manual + critical automation)
- **Coordination**: Operations check BOTH status AND emergency pause state

### Design Principles

1. **Defense in Depth**: Multiple independent safety mechanisms
2. **Least Surprise**: Preserve existing status-based behavior
3. **Clear Escalation**: Defined path from status → emergency pause
4. **Operational Safety**: Emergency pause takes precedence over status

---

## Implementation Phases

### Phase 1: Basic Integration (Week 1-2)
**Goal**: Connect emergency pause system to operational contracts

#### Tasks:
1. **Modify QCMinter Contract**
   ```solidity
   function requestQCMint(address qc, uint256 amount)
       external
       onlyRole(MINTER_ROLE)
       qcNotEmergencyPaused(qc)  // ADD THIS
       returns (bytes32 mintId)
   ```

2. **Modify QCRedeemer Contract**
   ```solidity
   function initiateRedemption(address qc, uint256 amount)
       external
       qcNotEmergencyPaused(qc)  // ADD THIS
   ```

3. **Update BasicMintingPolicy**
   ```solidity
   function requestMint(address qc, address recipient, uint256 amount) 
       external 
       returns (bool) 
   {
       // Add emergency pause check
       if (systemState.isQCEmergencyPaused(qc)) {
           emit MintRejected(qc, recipient, amount, "QCEmergencyPaused");
           return false;
       }
       
       // Existing logic...
   }
   ```

4. **Update BasicRedemptionPolicy**
   ```solidity
   function requestRedemption(address qc, uint256 amount) 
       external 
       returns (bool) 
   {
       // Add emergency pause check  
       if (systemState.isQCEmergencyPaused(qc)) {
           emit RedemptionRejected(qc, amount, "QCEmergencyPaused");
           return false;
       }
       
       // Existing logic...
   }
   ```

**Success Criteria**: QC emergency pauses block minting/redemption operations

### Phase 2: Enhanced Enforcement (Week 3-4)
**Goal**: Integrate emergency pauses with automated enforcement

#### Tasks:
1. **Add Severity Classification to WatchdogEnforcer**
   ```solidity
   enum ViolationSeverity { LOW, MEDIUM, HIGH, CRITICAL }
   
   function _classifyViolation(bytes32 reasonCode) internal pure returns (ViolationSeverity) {
       if (reasonCode == INSUFFICIENT_RESERVES) return ViolationSeverity.CRITICAL;
       if (reasonCode == STALE_ATTESTATIONS) return ViolationSeverity.HIGH;
       // ... other classifications
   }
   ```

2. **Enhanced Enforcement Logic**
   ```solidity
   function _executeEnforcement(address qc, bytes32 reasonCode) internal {
       ViolationSeverity severity = _classifyViolation(reasonCode);
       
       if (severity == ViolationSeverity.CRITICAL) {
           // Emergency pause for critical issues
           systemState.emergencyPauseQC(qc, reasonCode);
           emit EmergencyPauseTriggered(qc, reasonCode, "CRITICAL_VIOLATION");
       } else {
           // Status change for policy violations
           qcManager.requestStatusChange(qc, QCData.QCStatus.UnderReview, reasonCode);
       }
   }
   ```

3. **Add Emergency Council Integration**
   ```solidity
   function emergencyPauseForSecurityIncident(address qc, bytes32 reason) 
       external 
       onlyRole(EMERGENCY_RESPONDER_ROLE) 
   {
       systemState.emergencyPauseQC(qc, reason);
   }
   ```

**Success Criteria**: Critical violations trigger emergency pauses automatically

### Phase 3: System Coordination (Week 5-6)
**Goal**: Unified QC operational status and proper coordination

#### Tasks:
1. **Create Unified Status Query**
   ```solidity
   // In SystemState.sol
   function getQCOperationalStatus(address qc) 
       external 
       view 
       returns (bool canMint, bool canRedeem, bytes32 reason) 
   {
       // Check emergency pause first (highest priority)
       if (qcEmergencyPauses[qc]) {
           return (false, false, "EMERGENCY_PAUSED");
       }
       
       // Check status-based restrictions
       QCData.QCStatus status = qcData.getQCStatus(qc);
       if (status != QCData.QCStatus.Active) {
           return (false, true, "STATUS_RESTRICTED"); // Can redeem, can't mint
       }
       
       return (true, true, "OPERATIONAL");
   }
   ```

2. **Update Policy Contracts to Use Unified Status**
   ```solidity
   function requestMint(address qc, address recipient, uint256 amount) 
       external 
       returns (bool) 
   {
       (bool canMint, , bytes32 reason) = systemState.getQCOperationalStatus(qc);
       if (!canMint) {
           emit MintRejected(qc, recipient, amount, reason);
           return false;
       }
       
       // Continue with other policy checks...
   }
   ```

3. **Add Status → Emergency Pause Escalation**
   ```solidity
   // In QCManager.sol
   function _checkForEscalation(address qc, bytes32 reasonCode) internal {
       uint256 violations = violationCounter[qc];
       uint256 timeWindow = block.timestamp - firstViolationTime[qc];
       
       // Escalate to emergency pause if too many violations
       if (violations >= 3 && timeWindow <= 24 hours) {
           systemState.emergencyPauseQC(qc, keccak256("REPEATED_VIOLATIONS"));
           emit ViolationEscalated(qc, violations, reasonCode);
       }
   }
   ```

**Success Criteria**: Unified operational status, automatic escalation working

### Phase 4: Monitoring & Documentation (Week 7-8)
**Goal**: Complete integration with monitoring and updated documentation

#### Tasks:
1. **Enhanced Event Structure**
   ```solidity
   event QCOperationalStatusChanged(
       address indexed qc,
       bool canMint,
       bool canRedeem,
       bytes32 reason,
       uint256 timestamp
   );
   ```

2. **Update Integration Documentation**
   - Update PAUSE_ARCHITECTURE.md with actual usage patterns
   - Document the coordination between status and emergency pause systems
   - Create operational runbooks for each pause type

3. **Add Monitoring Integration**
   ```solidity
   function getSystemHealthStatus() 
       external 
       view 
       returns (
           uint256 totalQCs,
           uint256 activeQCs,
           uint256 underReviewQCs,
           uint256 emergencyPausedQCs,
           uint256 globalPauseFlags
       )
   ```

**Success Criteria**: Complete system visibility and documentation

---

## Detailed Task Breakdown

### Smart Contract Modifications Required

#### 1. QCMinter.sol
```solidity
// BEFORE:
function requestQCMint(address qc, uint256 amount)
    external
    onlyRole(MINTER_ROLE)
    returns (bytes32 mintId)

// AFTER:
function requestQCMint(address qc, uint256 amount)
    external
    onlyRole(MINTER_ROLE)
    qcNotEmergencyPaused(qc)  // NEW
    returns (bytes32 mintId)
```

#### 2. QCRedeemer.sol
```solidity
// BEFORE:
function initiateRedemption(address qc, uint256 amount)
    external

// AFTER:
function initiateRedemption(address qc, uint256 amount)
    external
    qcNotEmergencyPaused(qc)  // NEW
```

#### 3. BasicMintingPolicy.sol
```solidity
// ADD at beginning of requestMint():
if (systemState.isQCEmergencyPaused(qc)) {
    emit MintRejected(qc, recipient, amount, "QCEmergencyPaused");
    return false;
}
```

#### 4. BasicRedemptionPolicy.sol
```solidity
// ADD at beginning of requestRedemption():
if (systemState.isQCEmergencyPaused(qc)) {
    emit RedemptionRejected(qc, amount, "QCEmergencyPaused");
    return false;
}
```

#### 5. WatchdogEnforcer.sol
```solidity
// MODIFY _executeEnforcement():
function _executeEnforcement(address qc, bytes32 reasonCode) internal {
    ViolationSeverity severity = _classifyViolation(reasonCode);
    
    if (severity == ViolationSeverity.CRITICAL) {
        systemState.emergencyPauseQC(qc, reasonCode);
    } else {
        qcManager.requestStatusChange(qc, QCData.QCStatus.UnderReview, reasonCode);
    }
}
```

### New Functions to Add

#### SystemState.sol Enhancements
```solidity
function getQCOperationalStatus(address qc) 
    external 
    view 
    returns (bool canMint, bool canRedeem, bytes32 reason);

function getSystemHealthStatus() 
    external 
    view 
    returns (
        uint256 totalQCs,
        uint256 activeQCs, 
        uint256 underReviewQCs,
        uint256 emergencyPausedQCs,
        uint256 globalPauseFlags
    );
```

---

## Testing Requirements

### Unit Tests
1. **Emergency Pause Integration**
   - QCMinter reverts with emergency pause active
   - QCRedeemer reverts with emergency pause active
   - Policy contracts reject requests for emergency paused QCs

2. **Severity Classification**
   - Critical violations trigger emergency pause
   - Non-critical violations use status changes
   - Escalation logic from status → emergency pause

3. **Unified Status Query**
   - Emergency pause takes precedence over status
   - Correct operational status returned for all states

### Integration Tests
1. **End-to-End Pause Flows**
   - Emergency pause blocks all QC operations
   - Auto-expiry restores operations after 7 days
   - Manual unpause works correctly

2. **WatchdogEnforcer Integration**
   - Critical violations trigger emergency pause
   - Multiple violations escalate properly
   - Both systems work together without conflicts

### Regression Tests
1. **Existing Functionality Preserved**
   - Status-based system continues working
   - Global pause functions unaffected
   - All existing tests pass

---

## Deployment Strategy

### Phase 1 Deployment
1. Deploy updated QCMinter with emergency pause modifier
2. Deploy updated QCRedeemer with emergency pause modifier
3. Deploy updated BasicMintingPolicy with emergency pause check
4. Deploy updated BasicRedemptionPolicy with emergency pause check
5. Update registry to point to new implementations

### Phase 2 Deployment
1. Deploy enhanced WatchdogEnforcer with severity classification
2. Update SystemState with unified status functions
3. Test emergency pause automation in staging

### Phase 3 Deployment
1. Deploy final SystemState with coordination features
2. Update all policy contracts to use unified status
3. Enable automatic escalation mechanisms

### Rollback Plan
- Keep previous contract versions available
- Registry-based upgradeability allows instant rollback
- Emergency pause system can be disabled if needed

---

## Risk Assessment

### High Risk Items ⚠️
1. **Contract Upgrade Coordination**
   - Multiple contracts need simultaneous updates
   - Registry must be updated atomically
   - **Mitigation**: Staged deployment with feature flags

2. **Emergency Pause Precedence**
   - Emergency pause vs status conflicts
   - Unexpected behavior during transitions
   - **Mitigation**: Comprehensive integration testing

### Medium Risk Items ⚠️
1. **Performance Impact**
   - Additional storage reads for pause checks
   - Gas cost increases
   - **Mitigation**: Gas optimization and benchmarking

2. **Operational Complexity**
   - Two parallel pause systems to manage
   - Emergency responder training required
   - **Mitigation**: Clear documentation and runbooks

### Low Risk Items ⚠️
1. **Auto-expiry Edge Cases**
   - Pause expires during active operation
   - **Mitigation**: Grace period handling

2. **Event Compatibility**
   - New events may break monitoring
   - **Mitigation**: Backward-compatible event structure

---

## Success Metrics

### Technical Metrics
- [ ] All QC operations respect emergency pause state
- [ ] Critical violations automatically trigger emergency pauses
- [ ] Unified status query provides accurate information
- [ ] No regression in existing functionality

### Operational Metrics
- [ ] Emergency response time < 10 minutes for manual pauses
- [ ] Automatic critical violation response < 1 block
- [ ] Zero false positive emergency pauses
- [ ] Clear audit trail for all pause actions

### Documentation Metrics
- [ ] Integration patterns documented
- [ ] Operational runbooks complete
- [ ] Developer documentation updated
- [ ] Monitoring integration guide complete

---

## Conclusion

This implementation plan addresses the critical gap between the well-designed emergency pause architecture and its operational integration. By following this phased approach, the tBTC v2 system will gain:

1. **Complete pause system functionality** - Emergency pauses will actually block operations
2. **Automated critical response** - Severe violations trigger immediate pauses
3. **Coordinated dual systems** - Status and emergency pause systems work together
4. **Enhanced security posture** - Multiple independent safety mechanisms

The plan minimizes risk through staged deployment while maximizing the security benefits of the sophisticated pause architecture that has already been designed.