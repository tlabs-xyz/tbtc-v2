# Watchdog V1.1 Final Specification

**Purpose**: Authoritative technical specification for the V1.1 watchdog system  
**Status**: Production Ready  
**Date**: 2025-08-01

---

## Architecture Overview

The V1.1 watchdog system implements **minimal consensus** - applying group decision-making only where authority is truly required while allowing 90% of operations to remain independent.

### Core Principle
**Independent operations for data, consensus for authority, automatic responses for emergencies.**

---

## Contract Architecture

### 1. WatchdogConsensusManager.sol
**Purpose**: M-of-N consensus for critical operations requiring group authority

**Key Features**:
- Configurable M-of-N voting (default: 2-of-5, bounds: 2-7)
- Four operation types requiring consensus
- 2-hour voting window with automatic expiration
- Proposal auto-execution when threshold reached

**Operations Requiring Consensus**:
1. **STATUS_CHANGE** - QC status modifications (Active ↔ UnderReview ↔ Revoked)
2. **WALLET_DEREGISTRATION** - Remove wallet from QC (prevents griefing)
3. **REDEMPTION_DEFAULT** - Flag redemption as defaulted (triggers penalties)
4. **FORCE_INTERVENTION** - Manual override operations (emergency governance)

**Parameters**:
```solidity
uint256 public requiredVotes = 2;      // M (required votes)
uint256 public totalWatchdogs = 5;     // N (total watchdog count)
uint256 public votingPeriod = 2 hours; // Voting window
```

**Bounds**:
```solidity
uint256 public constant MIN_REQUIRED_VOTES = 2;
uint256 public constant MAX_REQUIRED_VOTES = 7;
uint256 public constant MIN_VOTING_PERIOD = 1 hours;
uint256 public constant MAX_VOTING_PERIOD = 24 hours;
```

### 2. WatchdogMonitor.sol
**Purpose**: Coordinates multiple independent SingleWatchdog instances and emergency responses

**Key Features**:
- Watchdog instance registration and lifecycle management
- Emergency circuit breaker (3 critical reports → automatic pause)
- Report validity tracking (1-hour window)
- Clean separation between monitoring and consensus

**Emergency System**:
```solidity
uint256 public constant CRITICAL_REPORTS_THRESHOLD = 3;
uint256 public constant REPORT_VALIDITY_PERIOD = 1 hours;
```

**Watchdog Management**:
- Register SingleWatchdog instances with operators
- Grant/revoke consensus roles automatically
- Track active watchdog count for threshold calculations

### 3. SingleWatchdog.sol (Existing)
**Purpose**: Individual watchdog operations for independent execution

**Independent Operations** (No Consensus):
- `attestReserves()` - Reserve balance attestations
- `registerWalletWithProof()` - Wallet registration with SPV proof
- `recordRedemptionFulfillment()` - Redemption completion with proof
- `raiseConcern()` - General concern reporting

---

## Operation Classification

### Category 1: Independent Operations (90%)
**Authority Source**: None needed (data submission) or cryptographic proof

| Operation | Implementation | Why Independent |
|-----------|----------------|-----------------|
| Reserve Attestations | SingleWatchdog | Multiple views welcome |
| Wallet Registration | SingleWatchdog | SPV proof is authority |
| Redemption Fulfillment | SingleWatchdog | Bitcoin proof is binary |
| Concern Reporting | SingleWatchdog | More perspectives = better |

### Category 2: Consensus Operations (10%)
**Authority Source**: M-of-N group decision

| Operation | Implementation | Why Consensus |
|-----------|----------------|---------------|
| QC Status Changes | WatchdogConsensusManager | Authority to change operational status |
| Wallet Deregistration | WatchdogConsensusManager | Authority to remove capabilities |
| Redemption Default Flagging | WatchdogConsensusManager | Authority to impose penalties |
| Force Interventions | WatchdogConsensusManager | Authority to override normal flow |

### Category 3: Emergency Operations (Automatic)
**Authority Source**: Threshold-based triggers

| Operation | Implementation | Trigger |
|-----------|----------------|---------|
| Emergency Pause | WatchdogMonitor | 3+ critical reports in 1 hour |
| Report Cleanup | WatchdogMonitor | Time-based expiration |
| Status Recovery | WatchdogMonitor | Manager override |

---

## Integration Points

### Role Relationships
```
WatchdogConsensusManager:
├── ARBITER_ROLE in QCManager (for status changes)
├── ARBITER_ROLE in QCRedeemer (for redemption defaults)
└── WATCHDOG_ROLE granted to operators

WatchdogMonitor:
├── MANAGER_ROLE controls watchdog registration
├── WATCHDOG_OPERATOR_ROLE for critical reports
└── Grants WATCHDOG_ROLE in WatchdogConsensusManager

SingleWatchdog (multiple instances):
├── Independent operations (no special roles)
├── ATTESTER_ROLE in QCReserveLedger
└── REGISTRAR_ROLE in QCManager
```

### Protocol Registry Usage
**Direct Integration** (Gas Optimized):
- Bank contract
- TBTCVault contract  
- TBTC token contract

**Registry Integration** (Flexible):
- BasicMintingPolicy (upgradeable)
- BasicRedemptionPolicy (upgradeable)
- QC management contracts

---

## Deployment Architecture

### Production Setup
1. **Deploy Core Contracts**:
   - WatchdogConsensusManager
   - WatchdogMonitor
   - Configure roles and parameters

2. **Deploy SingleWatchdog Instances**:
   - Each operator deploys independently  
   - Geographic and organizational distribution
   - Register with WatchdogMonitor

3. **Configure Consensus Parameters**:
   - Set M-of-N based on active watchdog count
   - Adjust voting periods if needed
   - Grant WATCHDOG_ROLE to operators

### Scaling Considerations
```
Watchdog Count    Recommended M    Reasoning
3                 2                67% threshold (2-of-3)
5                 3                60% threshold (3-of-5)  
7                 4                57% threshold (4-of-7)
9                 5                56% threshold (5-of-9)
```

---

## Security Model

### Threat Model
**Protected Against**:
- Single malicious watchdog (M-of-N consensus)
- Coordination failures (independent operations)
- Emergency scenarios (automatic responses)
- Operator failures (watchdog deactivation)

**Assumptions**:
- Majority of watchdogs honest (standard assumption)
- Watchdogs are KYC'd legal entities (not anonymous)
- DAO governance acts in system interest

### Attack Vectors and Mitigations

**Single Watchdog Griefing**:
- Attack: Malicious status changes or false reports
- Mitigation: M-of-N consensus for authority operations

**Coordination Attacks**:
- Attack: Majority collusion for malicious operations
- Mitigation: Legal/reputation consequences, DAO oversight

**Emergency Response Abuse**:
- Attack: False critical reports to trigger emergency pause
- Mitigation: 3-report threshold, manager recovery, different operators

**Availability Attacks**:
- Attack: Watchdogs go offline to prevent consensus
- Mitigation: Configurable thresholds, watchdog replacement procedures

---

## Configuration Parameters

### Default Configuration
```solidity
// WatchdogConsensusManager
requiredVotes = 2;              // M value
totalWatchdogs = 5;             // N value  
votingPeriod = 2 hours;         // Voting window

// WatchdogMonitor
CRITICAL_REPORTS_THRESHOLD = 3; // Emergency trigger
REPORT_VALIDITY_PERIOD = 1 hour; // Report freshness
```

### Parameter Bounds
```solidity
// Consensus bounds
MIN_REQUIRED_VOTES = 2;         // Prevents single-point failure
MAX_REQUIRED_VOTES = 7;         // Prevents coordination paralysis
MIN_VOTING_PERIOD = 1 hours;    // Minimum deliberation time
MAX_VOTING_PERIOD = 24 hours;   // Maximum operational delay

// Emergency bounds (hardcoded for security)
CRITICAL_REPORTS_THRESHOLD = 3; // Cannot be changed
REPORT_VALIDITY_PERIOD = 1 hour; // Cannot be changed
```

### Environment-Specific Settings

**Development/Testing**:
```solidity
requiredVotes = 1;              // Single approval for testing
votingPeriod = 30 minutes;      // Faster iterations
```

**Staging**:
```solidity
requiredVotes = 2;              // Majority of test watchdogs
votingPeriod = 1 hour;          // Balanced testing
```

**Production**:
```solidity
requiredVotes = 3;              // Secure majority
votingPeriod = 2 hours;         // Careful deliberation
```

---

## Operational Procedures

### Normal Operations

**Independent Operations** (Most Common):
1. SingleWatchdog instances operate independently
2. No coordination required
3. Results aggregated for pattern analysis

**Consensus Operations** (Rare):
1. Any watchdog proposes operation via WatchdogConsensusManager
2. Other watchdogs vote within 2-hour window
3. Automatic execution when M votes reached

**Emergency Operations** (Critical):
1. Watchdog submits critical report via WatchdogMonitor
2. System tracks report count and freshness
3. Automatic emergency pause at 3-report threshold

### Maintenance Procedures

**Add New Watchdog**:
1. Operator deploys SingleWatchdog instance
2. Manager registers with WatchdogMonitor
3. Grant WATCHDOG_ROLE in WatchdogConsensusManager
4. Update consensus parameters if needed

**Remove Watchdog**:
1. Manager deactivates via WatchdogMonitor
2. Automatically revokes consensus roles
3. Update consensus parameters for new count

**Parameter Updates**:
1. DAO governance votes on changes
2. Manager executes via updateConsensusParams()
3. All changes bounded by safety limits

**Emergency Recovery**:
1. Manager can clear false emergency pauses
2. DAO can replace managers if compromised
3. Watchdog operators can be replaced independently

---

## Testing Strategy

### Unit Testing
- WatchdogConsensusManager: All four operation types, parameter bounds, voting logic
- WatchdogMonitor: Registration, emergency thresholds, report tracking
- Integration: Role assignments, cross-contract calls

### Integration Testing  
- End-to-end consensus flows
- Emergency response scenarios
- Parameter update procedures
- Watchdog lifecycle management

### Security Testing
- Reentrancy protection
- Access control verification
- Parameter bound enforcement
- Emergency system abuse prevention

---

## Upgrade Strategy

### Upgradeable Components
- BasicMintingPolicy (via ProtocolRegistry)
- BasicRedemptionPolicy (via ProtocolRegistry)
- Parameter values (via governance)

### Non-Upgradeable Components  
- WatchdogConsensusManager (immutable logic)
- WatchdogMonitor (immutable logic)
- SingleWatchdog instances (operator-controlled)

### Migration Path
1. Deploy new contracts if logic changes needed
2. Update ProtocolRegistry for policy changes
3. Migrate watchdog registrations if required
4. Transfer roles and parameters to new system

---

## Monitoring and Observability

### Key Metrics
1. **Consensus Activity**: Proposal count, voting participation, execution rate
2. **Emergency System**: Critical report frequency, pause events, recovery time
3. **Watchdog Health**: Active count, response times, operation success rates
4. **System Performance**: Gas usage, transaction success rate, error frequency

### Alerting Conditions
1. **Immediate**: Emergency pause triggered
2. **High Priority**: Watchdog offline, consensus failure, parameter breach
3. **Medium Priority**: Low voting participation, pending proposals near expiration
4. **Low Priority**: Successful operations, parameter updates, new registrations

### Dashboards
1. **Operational**: Current system state, active watchdogs, pending operations
2. **Historical**: Trend analysis, performance metrics, incident tracking
3. **Security**: Emergency events, failed operations, access control changes

---

## Conclusion

The V1.1 watchdog system achieves optimal security-efficiency balance through surgical application of consensus mechanisms. By requiring group agreement only for authority-based decisions while maintaining independent operations for data submission and automatic responses for emergencies, the system provides robust security with minimal coordination overhead.

This specification serves as the definitive reference for implementation, deployment, and operation of the V1.1 watchdog system.