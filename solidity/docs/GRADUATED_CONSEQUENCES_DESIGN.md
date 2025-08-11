# Graduated Consequences Design for Redemption Defaults

**Document Version**: 1.0  
**Date**: 2025-08-05  
**Purpose**: Design and implementation plan for graduated consequence system  
**Status**: Proposal

---

## Executive Summary

This document describes the graduated consequence system for handling redemption defaults in the Account Control system, now integrated with the 5-state QC management model. The system implements progressive penalties through state transitions (Active → MintingPaused → Paused/UnderReview → Revoked) that allow recovery from operational issues while protecting users.

## Current State Analysis

### Current 5-State QC Model

```solidity
enum QCStatus {
    Active,         // Fully operational
    MintingPaused,  // Can fulfill but cannot mint (self-initiated or violation)
    Paused,         // Cannot mint or fulfill (maintenance mode)
    UnderReview,    // Council review, can fulfill but not mint
    Revoked         // Permanently terminated
}
```

### 5-State Default Handling Flow

1. Redemption timeout occurs
2. Watchdog/Arbiter calls `handleRedemptionDefault()`
3. QCStateManager applies graduated consequence:
   - First default: Active → MintingPaused
   - Second default: MintingPaused → UnderReview
   - Third default: UnderReview → Revoked
4. QC can recover by clearing backlog and meeting conditions

### Benefits of 5-State Design

1. **Graduated Response**: Progressive penalties match violation severity
2. **Recovery Paths**: Multiple opportunities to restore good standing
3. **Network Continuity**: 60% of states preserve fulfillment capability
4. **Automated Enforcement**: State transitions triggered automatically

## Integrated 5-State Consequence System

### State Model with Graduated Consequences

```solidity
enum QCStatus {
    Active,           // Fully operational
    MintingPaused,    // First consequence - can fulfill, cannot mint
    Paused,           // Maintenance mode - temporary full pause
    UnderReview,      // Council review - can fulfill, cannot mint
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
First Default (Active → MintingPaused):
- Minting capabilities suspended
- Can still fulfill redemptions (network continuity)
- Must clear backlog to return to Active
- 90-day window before next penalty tier

Second Default (MintingPaused → UnderReview):
- Council review triggered
- Can still fulfill existing redemptions
- Requires council approval to return to Active
- Evidence of systemic issues needed

Third Default (UnderReview → Revoked):
- Permanent revocation
- All operations halted
- Legal recourse activated
- User compensation procedures initiated

Alternative Path (Operational Issues):
Active → MintingPaused → Paused (self-initiated)
- QC recognizes need for maintenance
- Uses renewable pause credit
- 48h to resolve or auto-escalates to UnderReview
```

## Implementation Design

### 1. Data Structure Updates

#### QCData.sol Modifications

```solidity
// Updated QCData.sol with 5-state model
contract QCData {
    // 5-state enum
    enum QCStatus {
        Active,
        MintingPaused,  // First tier consequence
        Paused,         // Maintenance mode
        UnderReview,    // Council review
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

#### Integration with QCStateManager

```solidity
// QCStateManager handles graduated consequences
contract QCStateManager {
    // Graduated consequence handler integrated with 5-state model
    function handleRedemptionDefault(
        address qc,
        bytes32 redemptionId
    ) external onlyRole(ARBITER_ROLE) {
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        DefaultHistory storage history = defaultHistories[qc];
        
        // Record the default
        history.totalDefaults++;
        history.lastDefaultTimestamp = block.timestamp;
        
        // Determine new status based on 5-state progression
        QCData.QCStatus newStatus = determineConsequence(
            currentStatus,
            history.totalDefaults,
            history.consecutiveDefaults
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
    
    // Consequence determination with 5-state model
    function determineConsequence(
        QCData.QCStatus currentStatus,
        uint256 totalDefaults,
        uint256 consecutiveDefaults
    ) internal view returns (QCData.QCStatus) {
        // If already revoked, stay revoked
        if (currentStatus == QCData.QCStatus.Revoked) {
            return QCData.QCStatus.Revoked;
        }
        
        // 5-state progression for defaults
        if (currentStatus == QCData.QCStatus.Active) {
            // First default: Active → MintingPaused
            return QCData.QCStatus.MintingPaused;
        } else if (currentStatus == QCData.QCStatus.MintingPaused) {
            // Second default within window: MintingPaused → UnderReview
            if (block.timestamp - history.lastDefaultTimestamp <= DEFAULT_PENALTY_WINDOW) {
                return QCData.QCStatus.UnderReview;
            } else {
                // Outside window, stay in MintingPaused (reset progression)
                return QCData.QCStatus.MintingPaused;
            }
        } else if (currentStatus == QCData.QCStatus.UnderReview) {
            // Third default: UnderReview → Revoked
            return QCData.QCStatus.Revoked;
        } else if (currentStatus == QCData.QCStatus.Paused) {
            // Default during pause → UnderReview (serious issue)
            return QCData.QCStatus.UnderReview;
        }
        
        return currentStatus;
    }
    
    // Recovery mechanism for 5-state model
    function clearQCBacklog(address qc) external onlyRole(ARBITER_ROLE) {
        // Check if QC has fulfilled all pending redemptions
        if (!hasUnfulfilledRedemptions(qc)) {
            QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
            DefaultHistory memory history = defaultHistories[qc];
            
            if (currentStatus == QCData.QCStatus.MintingPaused) {
                // Can return to Active if backlog cleared and time passed
                if (block.timestamp - history.lastDefaultTimestamp > RECOVERY_PERIOD) {
                    _executeStatusChange(
                        qc,
                        QCData.QCStatus.Active,
                        keccak256("BACKLOG_CLEARED_RECOVERY")
                    );
                }
            } else if (currentStatus == QCData.QCStatus.UnderReview) {
                // Council must approve return to Active
                // This function just marks eligibility
                emit QCEligibleForRecovery(qc, block.timestamp);
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

#### Policy Integration Updates

```solidity
// BasicRedemptionPolicy.sol - Updated for 5-state model
function canInitiateRedemption(
    address qc,
    uint256 amount
) external view returns (bool) {
    QCData.QCStatus qcStatus = qcData.getQCStatus(qc);
    
    // Only Active state can accept new redemptions
    if (qcStatus != QCData.QCStatus.Active) {
        return false;
    }
    
    // Additional checks...
    return true;
}

function canFulfillRedemption(
    address qc,
    bytes32 redemptionId
) external view returns (bool) {
    QCData.QCStatus qcStatus = qcData.getQCStatus(qc);
    
    // Active, MintingPaused, and UnderReview can fulfill
    // This preserves network continuity (60% of states)
    if (qcStatus == QCData.QCStatus.Paused || 
        qcStatus == QCData.QCStatus.Revoked) {
        return false;
    }
    
    return true;
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
it("should move QC to MintingPaused on first default and allow recovery", async () => {
    // QC starts Active
    expect(await qcData.getQCStatus(qc)).to.equal(QCStatus.Active);
    
    // Redemption defaults
    await qcStateManager.handleRedemptionDefault(qc, redemptionId);
    
    // QC moves to MintingPaused (can still fulfill)
    expect(await qcData.getQCStatus(qc)).to.equal(QCStatus.MintingPaused);
    expect(await qcData.canQCFulfill(qc)).to.be.true;
    expect(await qcData.canQCMint(qc)).to.be.false;
    
    // QC fulfills all pending redemptions
    await fulfillAllPendingRedemptions(qc);
    
    // Wait for recovery period
    await time.increase(90 * 24 * 60 * 60); // 90 days
    
    // Arbiter clears backlog
    await qcStateManager.clearQCBacklog(qc);
    
    // QC returns to Active
    expect(await qcData.getQCStatus(qc)).to.equal(QCStatus.Active);
});
```

### Scenario 2: Progressive Escalation
```javascript
it("should escalate through MintingPaused → UnderReview → Revoked", async () => {
    // First default: Active → MintingPaused
    await qcStateManager.handleRedemptionDefault(qc, redemption1);
    expect(await qcData.getQCStatus(qc)).to.equal(QCStatus.MintingPaused);
    
    // Second default within window: MintingPaused → UnderReview
    await qcStateManager.handleRedemptionDefault(qc, redemption2);
    expect(await qcData.getQCStatus(qc)).to.equal(QCStatus.UnderReview);
    
    // Third default: UnderReview → Revoked
    await qcStateManager.handleRedemptionDefault(qc, redemption3);
    expect(await qcData.getQCStatus(qc)).to.equal(QCStatus.Revoked);
});
```

### Scenario 3: Self-Pause with Auto-Escalation
```javascript
it("should handle self-pause with 48h auto-escalation", async () => {
    // QC self-initiates pause
    await qcStateManager.selfPause(qc, PauseLevel.MintingOnly);
    expect(await qcData.getQCStatus(qc)).to.equal(QCStatus.MintingPaused);
    
    // Can still fulfill redemptions
    expect(await qcData.canQCFulfill(qc)).to.be.true;
    
    // QC escalates to full pause
    await qcStateManager.selfPause(qc, PauseLevel.Full);
    expect(await qcData.getQCStatus(qc)).to.equal(QCStatus.Paused);
    
    // After 48 hours without resolution
    await time.increase(48 * 60 * 60);
    await watchdogEnforcer.checkQCEscalations([qc]);
    
    // Auto-escalates to UnderReview
    expect(await qcData.getQCStatus(qc)).to.equal(QCStatus.UnderReview);
});
```

## Benefits of 5-State Model

### For QCs
- **Recovery Opportunity**: Multiple paths to restore good standing
- **Self-Management**: Can initiate pauses for maintenance
- **Renewable Credits**: Regular pause credits for operational needs
- **Network Continuity**: Can fulfill redemptions in 60% of states
- **Clear Progression**: Predictable consequences for violations

### For Users
- **Better Availability**: Redemptions continue in most pause states
- **Graduated Response**: Issues handled proportionally
- **Transparency**: Clear visibility into QC operational status
- **Protection**: Progressive enforcement prevents sudden disruption

### For Protocol
- **Network Resilience**: 60% of states preserve core functionality
- **Automated Enforcement**: Watchdog-triggered escalations
- **Flexible Operations**: Handles maintenance and emergencies
- **Data-Driven**: Clear metrics for QC health monitoring

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
    uint256 pauseExpiryTime;           // Default: 48 hours
    uint256 pauseCreditInterval;       // Default: 90 days
    uint256 defaultPenaltyWindow;      // Default: 90 days
    uint256 recoveryPeriod;            // Default: 90 days
    uint256 redemptionGracePeriod;     // Default: 8 hours
    uint256 maxConsecutiveDefaults;    // Default: 3
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

The 5-state graduated consequence system provides a sophisticated approach to QC management that balances network continuity with risk management. Key achievements:

1. **Network Continuity**: 60% of states preserve redemption fulfillment
2. **Self-Recovery**: QCs can manage operational issues proactively
3. **Automated Escalation**: 48-hour timers prevent indefinite pauses
4. **Progressive Enforcement**: Violations trigger proportional responses
5. **Renewable Resources**: Pause credits refresh every 90 days

This design enables institutional custodians to operate reliably while protecting users through graduated enforcement, creating a resilient and scalable custody ecosystem for tBTC.

---

**Next Steps**:
1. Review and approve design with team
2. Begin implementation in development branch
3. Create comprehensive test suite
4. Schedule security review