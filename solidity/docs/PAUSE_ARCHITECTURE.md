# Pause Architecture: tBTC v2 Account Control System

**Document Version**: 1.0  
**Date**: 2025-08-07  
**Status**: Design Specification  
**Purpose**: Comprehensive documentation of the two-tier pause architecture and its design rationale

---

## Executive Summary

The tBTC v2 Account Control system implements a sophisticated **two-tier pause architecture** that enables proportional emergency response while minimizing system disruption. This design allows for:

- **Global function-specific pauses** for system-wide threats
- **QC-specific emergency pauses** for targeted intervention
- **No single kill switch** to prevent catastrophic failure modes

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tier 1: Global Function-Specific Pauses](#tier-1-global-function-specific-pauses)
3. [Tier 2: QC-Specific Emergency Pauses](#tier-2-qc-specific-emergency-pauses)
4. [Design Rationale](#design-rationale)
5. [Implementation Status](#implementation-status)
6. [Integration Patterns](#integration-patterns)
7. [Security Implications](#security-implications)
8. [Operational Playbook](#operational-playbook)

---

## Architecture Overview

The pause architecture is implemented in `SystemState.sol` and provides granular control over system operations:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Pause Architecture                            │
├─────────────────────────┬───────────────────────────────────────────┤
│   Global Pauses         │        QC-Specific Pauses                 │
│   (System-Wide)         │        (Individual Targets)               │
├─────────────────────────┼───────────────────────────────────────────┤
│ • pauseMinting()        │ • emergencyPauseQC(qc, reason)          │
│ • pauseRedemption()     │ • emergencyUnpauseQC(qc)                 │
│ • pauseRegistry()       │ • Modifier: qcNotEmergencyPaused(qc)     │
│ • pauseWalletReg()      │ • Auto-expiry after 7 days               │
└─────────────────────────┴───────────────────────────────────────────┘
```

### Key Design Principles

1. **Proportional Response**: Match intervention to threat severity
2. **Minimize Collateral Damage**: Target specific issues without system-wide impact
3. **Time-Limited**: All pauses auto-expire to prevent permanent lockdown
4. **Role-Based**: Only PAUSER_ROLE (emergency council) can pause/unpause
5. **Audit Trail**: Comprehensive event logging for all pause actions

---

## Tier 1: Global Function-Specific Pauses

### Overview

Global pauses act as **circuit breakers** for specific system functions, affecting all QCs simultaneously.

### Available Global Pauses

#### 1. Minting Pause
```solidity
function pauseMinting() external onlyRole(PAUSER_ROLE)
function unpauseMinting() external onlyRole(PAUSER_ROLE)
bool public isMintingPaused
```

**Purpose**: Emergency halt of all new tBTC minting
**When to Use**:
- Critical bug in minting logic discovered
- Market manipulation attempts detected
- Regulatory requirement for temporary halt
- Pre-upgrade safety measure

**Impact**: 
- BasicMintingPolicy rejects all mint requests
- Existing tBTC remains unaffected
- Redemptions continue normally

#### 2. Redemption Pause
```solidity
function pauseRedemption() external onlyRole(PAUSER_ROLE)
function unpauseRedemption() external onlyRole(PAUSER_ROLE)
bool public isRedemptionPaused
```

**Purpose**: Protect reserves during critical incidents
**When to Use**:
- Security breach affecting reserve custody
- Technical issues with redemption processing
- Coordinated attack on reserves detected
- Emergency audit requirement

**Impact**:
- BasicRedemptionPolicy rejects all redemption requests
- Minting can continue (if not separately paused)
- QCs cannot fulfill redemptions

#### 3. Registry Pause
```solidity
function pauseRegistry() external onlyRole(PAUSER_ROLE)
function unpauseRegistry() external onlyRole(PAUSER_ROLE)
bool public isRegistryPaused
```

**Purpose**: Freeze QC registration/modification
**When to Use**:
- System upgrade in progress
- Security review of registration process
- Prevent new QCs during incident response

**Impact**:
- No new QCs can be registered
- Existing QCs cannot be modified
- Current QCs continue operations

#### 4. Wallet Registration Pause
```solidity
function pauseWalletRegistration() external onlyRole(PAUSER_ROLE)
function unpauseWalletRegistration() external onlyRole(PAUSER_ROLE)
bool public isWalletRegistrationPaused
```

**Purpose**: Control Bitcoin wallet additions
**When to Use**:
- Wallet security incident
- Upgrade to wallet verification process
- Temporary freeze during audit

**Impact**:
- QCs cannot add new Bitcoin wallets
- Existing wallets remain operational

### Global Pause Characteristics

- **Scope**: Affect all QCs equally
- **Duration**: No automatic expiry (manual unpause required)
- **Authority**: PAUSER_ROLE only
- **Granularity**: Each function type independently pauseable
- **Transparency**: Events emitted with timestamp and triggerer

---

## Tier 2: QC-Specific Emergency Pauses

### Overview

QC-specific pauses enable **surgical intervention** for individual custodian issues without affecting the broader system.

### Emergency Pause Functions

```solidity
function emergencyPauseQC(address qc, bytes32 reason) external onlyRole(PAUSER_ROLE)
function emergencyUnpauseQC(address qc) external onlyRole(PAUSER_ROLE)
modifier qcNotEmergencyPaused(address qc)
```

### Reason Codes

Machine-readable codes enable automated monitoring and response:

```solidity
bytes32 constant INSUFFICIENT_COLLATERAL = keccak256("INSUFFICIENT_COLLATERAL");
bytes32 constant STALE_ATTESTATIONS = keccak256("STALE_ATTESTATIONS");
bytes32 constant COMPLIANCE_VIOLATION = keccak256("COMPLIANCE_VIOLATION");
bytes32 constant SECURITY_INCIDENT = keccak256("SECURITY_INCIDENT");
bytes32 constant TECHNICAL_FAILURE = keccak256("TECHNICAL_FAILURE");
```

### QC Pause Characteristics

- **Scope**: Individual QC only
- **Duration**: Auto-expires after `emergencyPauseDuration` (7 days default)
- **Authority**: PAUSER_ROLE only
- **Effect**: Blocks ALL operations for the specific QC
- **Reason Tracking**: Machine-readable codes for automation

### Query Functions

```solidity
function isQCEmergencyPaused(address qc) external view returns (bool)
function isQCEmergencyPauseExpired(address qc) external view returns (bool)
function getQCPauseTimestamp(address qc) external view returns (uint256)
```

---

## Design Rationale

### Why Two Tiers?

The two-tier design addresses fundamentally different threat models:

#### System-Wide Threats (Global Pauses)
- **Nature**: Affect protocol integrity or all participants
- **Examples**: Critical bugs, market attacks, regulatory events
- **Response**: Immediate system-wide halt of specific functions
- **Recovery**: Requires fix deployment or threat mitigation

#### Individual QC Issues (QC-Specific Pauses)
- **Nature**: Isolated to single custodian
- **Examples**: Collateral shortfall, compliance violation, technical failure
- **Response**: Targeted freeze without broader impact
- **Recovery**: QC-specific remediation

### Design Decisions

1. **No Universal Kill Switch**
   - Prevents single point of catastrophic failure
   - Forces thoughtful response to different scenarios
   - Reduces attack surface

2. **Function-Level Granularity**
   - Mint/redeem can be paused independently
   - Allows partial system operation during incidents
   - Minimizes user impact

3. **Time-Limited QC Pauses**
   - Auto-expiry prevents permanent lockout
   - Forces active decision for extended pauses
   - Provides natural recovery path

4. **Reason Code Requirements**
   - Enables automated monitoring systems
   - Creates audit trail for compliance
   - Supports future automation

---

## Implementation Status

### Phase 1: Emergency Pause Integration ✅ Complete

✅ **Global Pause Infrastructure**
- All pause/unpause functions in SystemState.sol
- Integration in BasicMintingPolicy and BasicRedemptionPolicy
- Comprehensive test coverage

✅ **QC Emergency Pause Integration**
- QCMinter and QCRedeemer check emergency pause status
- BasicMintingPolicy and BasicRedemptionPolicy enforce pause state
- All operations respect QC-specific emergency pauses
- Complete integration test suite

### Phase 2: Time-Based Escalation ✅ Complete

✅ **Automated Escalation Infrastructure**
- 45-minute escalation timer in WatchdogEnforcer
- INSUFFICIENT_RESERVES violations trigger escalation countdown
- Automated emergency pause after sustained violations
- PAUSER_ROLE granted to WatchdogEnforcer for escalation

✅ **Monitoring Integration**
- Comprehensive event structure for off-chain monitoring
- CriticalViolationDetected, ViolationEscalated, EscalationTimerCleared events
- Timer cleanup and management functions
- Integration documentation and examples

### Coordinated Dual System Architecture

The system now implements **coordinated dual QC disable mechanisms**:

1. **Status-Based System** (Active → UnderReview → Revoked)
   - Used for policy violations and graduated enforcement
   - Provides human oversight and nuanced state transitions
   - Integrated with QCManager and watchdog enforcement

2. **Emergency Pause System** (Manual + Automated Escalation)
   - Manual emergency pauses for security incidents (Emergency Council)
   - Automated escalation for sustained critical violations (45-min delay)
   - Immediate operational halt with auto-expiry safety net

**Graduated Response Flow**:
```
INSUFFICIENT_RESERVES Detected
         ↓
QC → UnderReview Status (45-minute grace period)
         ↓ (if violation persists)
Automatic Emergency Pause (blocks all operations)
```

This coordinated approach provides:
- **Legal compliance** through human oversight windows
- **Automated safety** for sustained critical violations  
- **Proportional response** matching intervention to threat severity
- **Multiple independent safety mechanisms** for defense in depth

---

## Integration Patterns

### For Minting Operations

```solidity
contract QCMinter {
    ISystemState systemState;
    
    function mintFromQC(address qc, uint256 amount) 
        external 
        qcNotEmergencyPaused(qc)  // Check QC-specific pause
    {
        // Global pause checked by policy
        bool approved = mintingPolicy.requestMint(qc, recipient, amount);
        require(approved, "Mint rejected by policy");
        
        // Proceed with minting...
    }
}
```

### For Policy Contracts

```solidity
contract BasicMintingPolicy {
    function requestMint(address qc, address recipient, uint256 amount) 
        external 
        returns (bool) 
    {
        // Check global pause first
        if (systemState.isMintingPaused()) {
            emit MintRejected(qc, recipient, amount, "MintingPaused");
            return false;
        }
        
        // Additional policy checks...
    }
}
```

### For Automated Enforcement

```solidity
contract WatchdogEnforcer {
    function checkCollateral(address qc) external {
        uint256 reserves = getReserves(qc);
        uint256 required = getRequiredCollateral(qc);
        
        if (reserves < required) {
            // Emergency pause for severe undercollateralization
            systemState.emergencyPauseQC(
                qc, 
                keccak256("INSUFFICIENT_COLLATERAL")
            );
        }
    }
}
```

---

## Security Implications

### Attack Vectors Mitigated

1. **Compromised QC**
   - Individual pause prevents damage spread
   - Other QCs continue normal operations
   - Time-limited to prevent permanent DoS

2. **Systemic Vulnerability**
   - Global pause halts exploitable operations
   - Granular control limits attack surface
   - Preserves partial functionality

3. **Governance Capture**
   - No single pause-all function
   - Multiple independent pause controls
   - Time limits on emergency powers

### Security Guarantees

1. **Access Control**
   - Only PAUSER_ROLE can pause/unpause
   - Role management via OpenZeppelin AccessControl
   - DAO can revoke roles if abused

2. **Transparency**
   - All pauses emit detailed events
   - Reason codes for QC pauses
   - On-chain audit trail

3. **Recovery Paths**
   - Manual unpause always available
   - Auto-expiry for QC pauses
   - No permanent lock states

---

## Operational Playbook

### Incident Response Decision Tree

```
Security Incident Detected
├─> Affects Single QC?
│   ├─> Yes: emergencyPauseQC(qc, reason)
│   └─> No: Continue ↓
├─> Affects Minting Logic?
│   ├─> Yes: pauseMinting()
│   └─> No: Continue ↓
├─> Affects Redemption Logic?
│   ├─> Yes: pauseRedemption()
│   └─> No: Continue ↓
├─> Affects QC Registration?
│   ├─> Yes: pauseRegistry()
│   └─> No: Monitor situation
```

### Recovery Procedures

#### After Global Pause
1. Deploy fixes if required
2. Verify system integrity
3. Unpause affected functions
4. Monitor for normal operation
5. Post-mortem analysis

#### After QC Emergency Pause
1. QC addresses specific issue
2. Verify compliance restored
3. Either:
   - emergencyUnpauseQC() for quick recovery
   - Let pause auto-expire if more time needed
4. Monitor QC performance

### Monitoring Requirements

1. **Real-Time Alerts**
   - Listen for all pause/unpause events
   - Track pause durations
   - Monitor auto-expiry times

2. **Automated Responses**
   - Integrate reason codes with monitoring
   - Trigger alerts based on pause types
   - Escalate based on duration

3. **Compliance Tracking**
   - Log all emergency actions
   - Document reason codes
   - Maintain pause/unpause history

---

## Off-Chain Monitoring Integration

### Escalation Event Monitoring

The time-based escalation system (Phase 2) emits specific events designed for off-chain monitoring integration:

#### CriticalViolationDetected Event
```solidity
event CriticalViolationDetected(
    address indexed qc,
    bytes32 indexed reasonCode,
    address indexed enforcer,
    uint256 timestamp,
    uint256 escalationDeadline
);
```

**Event Type**: *Warning system event*  
**Purpose**: Indicates a QC has triggered a critical violation (insufficient reserves) that starts a 45-minute escalation timer  
**Action Required**: Monitor QC for resolution within escalation window

**Off-Chain Integration Requirements**:
- Set up alerts for approaching escalation deadlines
- Monitor QC status changes during the escalation window  
- Prepare automated `checkEscalation()` calls after the 45-minute delay
- Track QC compliance metrics and resolution rates

#### ViolationEscalated Event
```solidity
event ViolationEscalated(
    address indexed qc,
    bytes32 indexed reasonCode,
    address indexed escalator,
    uint256 timestamp
);
```

**Event Type**: *Critical system event*  
**Purpose**: Indicates a QC's critical violation persisted beyond the 45-minute window and triggered automatic emergency pause  
**Action Required**: Immediate team response to investigate sustained violation

**Response Procedures**:
- Investigate root cause of sustained violation
- Coordinate with QC to resolve underlying issue
- Manually unpause via emergency council once verified safe
- Review automated escalation thresholds if false positive
- Update incident response documentation

#### EscalationTimerCleared Event
```solidity
event EscalationTimerCleared(
    address indexed qc,
    address indexed clearedBy,
    uint256 timestamp
);
```

**Event Type**: *Informational system event*  
**Purpose**: Indicates escalation timer cleared due to QC returning to Active status or manual intervention  
**Action Required**: Log resolution for compliance tracking

### Monitoring System Architecture

#### Event Routing Strategy
```
CriticalViolationDetected → Sentry Hub → PagerDuty + Discord #qc-alerts
ViolationEscalated → Sentry Hub → Immediate PagerDuty escalation
EscalationTimerCleared → Discord #qc-notifications (informational)
```

#### Automated Monitoring Tasks

**Timer Management**:
- Track escalation deadlines for all active critical violations
- Automated `checkEscalation()` calls after 45-minute delays
- Grace period handling for block timing variations

**Metrics Collection**:
- QC violation frequency and resolution times
- Escalation trigger rates and false positive analysis
- Emergency pause duration and recovery metrics
- System availability impact during emergency responses

**Alert Thresholds**:
- Critical: Violation escalated to emergency pause
- Warning: Critical violation detected (45-min countdown)
- Info: Escalation timer cleared (violation resolved)

#### Integration with Existing Infrastructure

The QC escalation events integrate with the existing tBTC v2 monitoring system architecture:

- **Sentry Hub**: Receives critical and warning events for team action
- **Discord Integration**: Informational events sent directly to notification channels  
- **PagerDuty Escalation**: Critical events trigger immediate team response
- **Monitoring Dashboard**: Real-time visibility into QC status and escalation timers

#### Configuration Requirements

**Event Listeners**:
```javascript
// Example monitoring integration
const watchdogEnforcer = new ethers.Contract(address, abi, provider);

// Critical violation detection
watchdogEnforcer.on("CriticalViolationDetected", 
  (qc, reasonCode, enforcer, timestamp, escalationDeadline) => {
    scheduleEscalationCheck(qc, escalationDeadline);
    alertTeam("warning", `QC ${qc} critical violation - 45min timer started`);
  }
);

// Automatic escalation to emergency pause
watchdogEnforcer.on("ViolationEscalated", 
  (qc, reasonCode, escalator, timestamp) => {
    alertTeam("critical", `QC ${qc} emergency paused - immediate action required`);
    updateDashboard(qc, "EMERGENCY_PAUSED");
  }
);

// Resolution tracking
watchdogEnforcer.on("EscalationTimerCleared", 
  (qc, clearedBy, timestamp) => {
    logResolution(qc, timestamp);
    updateDashboard(qc, "RESOLVED");
  }
);
```

**Automated Response Functions**:
```javascript
async function checkEscalationDue(qc, deadline) {
  if (Date.now() >= deadline * 1000) {
    try {
      const tx = await watchdogEnforcer.checkEscalation(qc);
      console.log(`Escalation triggered for QC ${qc}: ${tx.hash}`);
    } catch (error) {
      console.log(`Escalation check for QC ${qc} failed: ${error.message}`);
    }
  }
}
```

---

## Conclusion

The two-tier pause architecture provides tBTC v2 with sophisticated emergency response capabilities that balance security, availability, and operational flexibility. By avoiding a single kill switch and implementing granular controls, the system can respond proportionally to threats while minimizing disruption to users and maintaining system integrity.

This architecture demonstrates mature security design that considers both technical and operational requirements, providing clear paths for incident response while preventing single points of catastrophic failure.