# Graduated Consequences Design for Redemption Defaults

**Document Version**: 1.0  
**Date**: 2025-08-05  
**Purpose**: Design and implementation plan for graduated consequence system  
**Status**: Proposal

---

## Executive Summary

This document proposes a graduated consequence system for handling redemption defaults in the Account Control system. Instead of immediately revoking a QC upon first default, the system implements progressive penalties that allow recovery from operational issues while protecting users.

## Current State Analysis

### Existing QC Status Model

```solidity
enum QCStatus {
    Active,        // Fully operational
    UnderReview,   // Minting paused, review in progress  
    Revoked        // Permanently terminated
}
```

### Current Default Handling Flow

1. Redemption timeout occurs
2. Watchdog calls `flagDefaultedRedemption()`
3. Redemption marked as `Defaulted`
4. **Gap**: No automatic QC status change
5. Manual intervention required to revoke QC

### Problems with Current Design

1. **Binary Consequences**: First default → manual decision → likely Revoked
2. **No Recovery Path**: Once Revoked, QC cannot recover
3. **Operational Rigidity**: Temporary issues treated same as systematic failures
4. **Manual Dependency**: Requires human decision for each default

## Proposed Graduated Consequence System

### Enhanced State Model

```solidity
enum QCStatus {
    Active,           // Fully operational
    UnderReview,      // Minting paused, must clear backlog
    Probation,        // NEW: Can fulfill but cannot take new redemptions
    Revoked           // Permanently terminated
}
```

### Default Tracking

```solidity
struct QCDefaultHistory {
    uint256 totalDefaults;
    uint256 defaultsWhileUnderReview;
    uint256 lastDefaultTimestamp;
    uint256 consecutiveDefaults;
    mapping(bytes32 => bool) defaultedRedemptions;
}
```

### Progressive Consequence Logic

```
First Default (Active → UnderReview):
- Minting capabilities suspended
- Must fulfill all pending redemptions
- Can return to Active after clearing backlog

Second Default (UnderReview → Probation):
- Cannot accept new redemptions
- Must fulfill existing obligations
- Extended monitoring period (30 days)

Third Default (Probation → Revoked):
- Permanent revocation
- Legal recourse activated
- User compensation procedures initiated
```

## Implementation Design

### 1. Data Structure Updates

#### QCData.sol Modifications

```solidity
// Add to QCData.sol
contract QCData {
    // Existing enum with new state
    enum QCStatus {
        Active,
        UnderReview,
        Probation,    // NEW
        Revoked
    }
    
    // NEW: Default tracking per QC
    struct DefaultHistory {
        uint256 totalDefaults;
        uint256 lastDefaultTimestamp;
        uint256 consecutiveDefaults;
        uint256 defaultsWhileUnderReview;
    }
    
    // NEW: Mapping for default history
    mapping(address => DefaultHistory) private defaultHistories;
    
    // NEW: Global tracking of defaults per redemption
    mapping(bytes32 => address) private defaultedRedemptionQCs;
    
    // NEW: Functions
    function recordDefault(address qc, bytes32 redemptionId) external onlyRole(QC_MANAGER_ROLE) {
        DefaultHistory storage history = defaultHistories[qc];
        history.totalDefaults++;
        history.lastDefaultTimestamp = block.timestamp;
        
        // Track consecutive defaults (reset if > 30 days since last)
        if (block.timestamp - history.lastDefaultTimestamp > 30 days) {
            history.consecutiveDefaults = 1;
        } else {
            history.consecutiveDefaults++;
        }
        
        // Track defaults while under review
        if (custodians[qc].status == QCStatus.UnderReview) {
            history.defaultsWhileUnderReview++;
        }
        
        defaultedRedemptionQCs[redemptionId] = qc;
    }
    
    function getDefaultHistory(address qc) external view returns (DefaultHistory memory) {
        return defaultHistories[qc];
    }
}
```

### 2. State Transition Logic

#### QCManager.sol Updates

```solidity
// Add to QCManager.sol
contract QCManager {
    // NEW: Graduated consequence handler
    function handleRedemptionDefault(
        address qc,
        bytes32 redemptionId,
        bytes32 reason
    ) external onlyRole(ARBITER_ROLE) {
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        QCData.DefaultHistory memory history = qcData.getDefaultHistory(qc);
        
        // Record the default
        qcData.recordDefault(qc, redemptionId);
        
        // Determine new status based on history and current status
        QCData.QCStatus newStatus = determineConsequence(
            currentStatus,
            history.totalDefaults,
            history.consecutiveDefaults,
            history.defaultsWhileUnderReview
        );
        
        if (newStatus != currentStatus) {
            qcData.setQCStatus(qc, newStatus, reason);
            emit QCStatusChangedDueToDefault(
                qc,
                redemptionId,
                currentStatus,
                newStatus,
                history.totalDefaults
            );
        }
    }
    
    // NEW: Consequence determination logic
    function determineConsequence(
        QCData.QCStatus currentStatus,
        uint256 totalDefaults,
        uint256 consecutiveDefaults,
        uint256 defaultsWhileUnderReview
    ) internal pure returns (QCData.QCStatus) {
        // If already revoked, stay revoked
        if (currentStatus == QCData.QCStatus.Revoked) {
            return QCData.QCStatus.Revoked;
        }
        
        // Pattern-based escalation
        if (currentStatus == QCData.QCStatus.Active) {
            // First default from Active → UnderReview
            return QCData.QCStatus.UnderReview;
        } else if (currentStatus == QCData.QCStatus.UnderReview) {
            // Default while UnderReview
            if (defaultsWhileUnderReview >= 2) {
                // Multiple defaults while under review → Revoked
                return QCData.QCStatus.Revoked;
            } else {
                // First default while under review → Probation
                return QCData.QCStatus.Probation;
            }
        } else if (currentStatus == QCData.QCStatus.Probation) {
            // Any default while on probation → Revoked
            return QCData.QCStatus.Revoked;
        }
        
        return currentStatus;
    }
    
    // NEW: Recovery mechanism
    function clearQCBacklog(address qc) external onlyRole(ARBITER_ROLE) {
        // Check if QC has fulfilled all pending redemptions
        if (!hasUnfulfilledRedemptions(qc)) {
            QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
            
            if (currentStatus == QCData.QCStatus.UnderReview) {
                // Can return to Active if backlog cleared
                qcData.setQCStatus(
                    qc,
                    QCData.QCStatus.Active,
                    keccak256("BACKLOG_CLEARED")
                );
            } else if (currentStatus == QCData.QCStatus.Probation) {
                // Probation requires time period (30 days) without issues
                QCData.DefaultHistory memory history = qcData.getDefaultHistory(qc);
                if (block.timestamp - history.lastDefaultTimestamp > 30 days) {
                    qcData.setQCStatus(
                        qc,
                        QCData.QCStatus.Active,
                        keccak256("PROBATION_COMPLETED")
                    );
                }
            }
        }
    }
}
```

### 3. Policy Integration

#### BasicRedemptionPolicy.sol Updates

```solidity
// Modify flagDefault to integrate with graduated consequences
function flagDefault(bytes32 redemptionId, bytes32 reason)
    external
    override
    onlyRole(ARBITER_ROLE)
    returns (bool success)
{
    // Existing validation...
    
    // State update
    defaultedRedemptions[redemptionId] = reason;
    
    // NEW: Trigger graduated consequence handler
    IQCManager qcManager = IQCManager(
        protocolRegistry.getService("QC_MANAGER")
    );
    
    // Get QC address from redemption
    address qc = getRedemptionQC(redemptionId);
    
    // Handle the default with graduated consequences
    qcManager.handleRedemptionDefault(qc, redemptionId, reason);
    
    emit RedemptionDefaultedByPolicy(
        redemptionId,
        reason,
        msg.sender,
        block.timestamp
    );
    
    return true;
}
```

### 4. Operational Restrictions

#### QCRedeemer.sol Updates

```solidity
// Modify initiateRedemption to check for Probation status
function initiateRedemption(
    address qc,
    uint256 amount,
    string calldata userBtcAddress
) external nonReentrant returns (bytes32 redemptionId) {
    // Existing validation...
    
    // NEW: Check if QC can accept new redemptions
    QCData.QCStatus qcStatus = qcData.getQCStatus(qc);
    if (qcStatus == QCData.QCStatus.Probation) {
        revert QCOnProbationCannotAcceptRedemptions();
    }
    if (qcStatus == QCData.QCStatus.Revoked) {
        revert QCRevoked();
    }
    
    // Continue with existing logic...
}
```

## Migration Strategy

### Phase 1: Contract Updates
1. Deploy updated QCData with new status and tracking
2. Deploy updated QCManager with graduated consequence logic
3. Deploy updated policies with integration hooks

### Phase 2: Migration Process
1. Pause redemption operations temporarily
2. Update registry with new contract addresses
3. Migrate existing QC statuses (preserve current states)
4. Initialize default histories (start with clean slate)
5. Resume operations with new logic

### Phase 3: Monitoring
1. Track default patterns across QCs
2. Monitor recovery success rates
3. Adjust parameters if needed (via governance)

## Test Scenarios

### Scenario 1: First Default Recovery
```javascript
it("should move QC to UnderReview on first default and allow recovery", async () => {
    // QC starts Active
    expect(await qcData.getQCStatus(qc)).to.equal(QCStatus.Active);
    
    // Redemption defaults
    await watchdog.flagDefaultedRedemption(redemptionId, "TIMEOUT");
    
    // QC moves to UnderReview
    expect(await qcData.getQCStatus(qc)).to.equal(QCStatus.UnderReview);
    
    // QC fulfills all pending redemptions
    await fulfillAllPendingRedemptions(qc);
    
    // Arbiter clears backlog
    await qcManager.clearQCBacklog(qc);
    
    // QC returns to Active
    expect(await qcData.getQCStatus(qc)).to.equal(QCStatus.Active);
});
```

### Scenario 2: Progressive Escalation
```javascript
it("should escalate through UnderReview → Probation → Revoked", async () => {
    // First default: Active → UnderReview
    await triggerDefault(redemption1);
    expect(await qcData.getQCStatus(qc)).to.equal(QCStatus.UnderReview);
    
    // Second default: UnderReview → Probation
    await triggerDefault(redemption2);
    expect(await qcData.getQCStatus(qc)).to.equal(QCStatus.Probation);
    
    // Third default: Probation → Revoked
    await triggerDefault(redemption3);
    expect(await qcData.getQCStatus(qc)).to.equal(QCStatus.Revoked);
});
```

### Scenario 3: Probation Period
```javascript
it("should enforce 30-day probation period", async () => {
    // QC on probation
    await qcData.setQCStatus(qc, QCStatus.Probation);
    
    // Cannot accept new redemptions
    await expect(
        qcRedeemer.initiateRedemption(qc, amount, btcAddress)
    ).to.be.revertedWith("QCOnProbationCannotAcceptRedemptions");
    
    // After 30 days without issues
    await time.increase(30 * 24 * 60 * 60);
    await qcManager.clearQCBacklog(qc);
    
    // Returns to Active
    expect(await qcData.getQCStatus(qc)).to.equal(QCStatus.Active);
});
```

## Benefits

### For QCs
- **Recovery Opportunity**: Can recover from operational issues
- **Clear Expectations**: Know exactly what triggers each consequence
- **Proportional Response**: Minor issues don't result in termination
- **Time to Fix**: Grace period to resolve systemic problems

### For Users
- **Better Service**: QCs incentivized to fulfill on time
- **Transparency**: Can see QC operational history
- **Risk Assessment**: Can choose QCs based on track record
- **Protection**: Serial defaulters still get revoked

### For Protocol
- **Operational Flexibility**: Handles edge cases gracefully
- **Reduced Manual Intervention**: Automated state transitions
- **Data-Driven Decisions**: Clear metrics for QC performance
- **Maintains Security**: Bad actors still removed from system

## Risk Analysis

### Potential Risks
1. **Gaming the System**: QCs might exploit recovery mechanisms
   - Mitigation: Consecutive default tracking, probation periods
   
2. **User Confusion**: More complex status model
   - Mitigation: Clear UI indicators, documentation
   
3. **Increased Complexity**: More states to manage
   - Mitigation: Well-defined state transitions, comprehensive testing

### Security Considerations
- All state transitions require ARBITER_ROLE
- State changes emit events for monitoring
- Cannot transition backward except through explicit recovery
- Revoked state remains terminal

## Governance Parameters

The following parameters should be configurable via governance:

```solidity
struct ConsequenceParameters {
    uint256 probationPeriod;           // Default: 30 days
    uint256 consecutiveDefaultWindow;   // Default: 30 days
    uint256 maxDefaultsInUnderReview;   // Default: 2
    uint256 maxDefaultsInProbation;     // Default: 1
}
```

## Implementation Timeline

### Week 1-2: Development
- Update smart contracts with new logic
- Write comprehensive unit tests
- Internal code review

### Week 3: Testing
- Integration testing with existing system
- Security review of state transitions
- Gas optimization analysis

### Week 4: Deployment Preparation
- Deployment scripts
- Migration procedures
- Documentation updates

### Week 5: Testnet Deployment
- Deploy to testnet
- End-to-end testing
- Monitor state transitions

### Week 6: Mainnet Deployment
- Governance proposal
- Mainnet deployment
- Post-deployment monitoring

## Conclusion

The graduated consequence system provides a more nuanced and operationally friendly approach to handling redemption defaults. By introducing progressive penalties and recovery mechanisms, the system:

1. Protects users while allowing QCs to recover from operational issues
2. Reduces the need for manual intervention
3. Provides clear incentives for timely redemption fulfillment
4. Maintains security by still removing bad actors

This design balances the need for strict enforcement with operational reality, creating a more sustainable and scalable system for institutional custody operations.

---

**Next Steps**:
1. Review and approve design with team
2. Begin implementation in development branch
3. Create comprehensive test suite
4. Schedule security review