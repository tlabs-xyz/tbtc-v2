# Watchdog System V1.1 Operations Guide

**Purpose**: Complete operational guide for the V1.1 watchdog system with multiple independent watchdogs and M-of-N consensus

---

## System Architecture Overview

### Components

1. **SingleWatchdog** - Individual watchdog instances (existing)
2. **WatchdogConsensusManager** - M-of-N consensus for critical operations
3. **WatchdogMonitor** - Coordinates multiple watchdog instances
4. **Emergency System** - Automatic circuit breaker

### Key Principles

- **Independence**: Most operations executed independently by individual watchdogs
- **Consensus**: Only critical operations require M-of-N agreement
- **Emergency**: Automatic responses for time-critical issues

## Deployment Architecture

### Production Setup

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   SingleWatchdog│    │   SingleWatchdog│    │   SingleWatchdog│
│   Instance #1   │    │   Instance #2   │    │   Instance #3   │
│                 │    │                 │    │                 │
│   Operator A    │    │   Operator B    │    │   Operator C    │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    WatchdogMonitor      │
                    │                         │
                    │  - Registers watchdogs  │
                    │  - Emergency monitoring │
                    │  - Critical reports     │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ WatchdogConsensusManager│
                    │                         │
                    │  - M-of-N consensus     │
                    │  - Status changes       │
                    │  - Critical decisions   │
                    └─────────────────────────┘
```

### Deployment Steps

#### Step 1: Deploy Core Contracts
```bash
# Deploy WatchdogConsensusManager and WatchdogMonitor
yarn deploy --network <network> --tags AccountControlWatchdog

# Configure system
yarn deploy --network <network> --tags AccountControlConfig
```

#### Step 2: Deploy SingleWatchdog Instances
```bash
# For each watchdog operator, deploy a SingleWatchdog instance
# This is typically done by the watchdog operators themselves

# Example deployment script:
npx hardhat run scripts/deploy-single-watchdog.js --network <network>
```

#### Step 3: Register Watchdog Instances
```solidity
// For each deployed SingleWatchdog instance
watchdogMonitor.registerWatchdog(
    singleWatchdogAddress,
    operatorAddress,
    "Watchdog Operator Name"
);

// Grant consensus role to operator
watchdogConsensusManager.grantRole(WATCHDOG_ROLE, operatorAddress);
```

#### Step 4: Configure Consensus Parameters
```solidity
// Set M-of-N parameters based on deployed watchdog count
// Example: 3 watchdogs = 2-of-3 consensus
watchdogConsensusManager.updateConsensusParams(
    2, // M (required votes)
    3  // N (total watchdogs)
);
```

## Operational Procedures

### 1. Normal Operations (Independent Execution)

#### Reserve Attestations
```solidity
// Each watchdog independently attests reserves
singleWatchdog.attestReserves(qcAddress, balance);
```

#### Wallet Registration
```solidity
// Each watchdog can register wallets with SPV proof
singleWatchdog.registerWalletWithProof(
    qcAddress,
    btcAddress,
    spvProof
);
```

**Note**: In practice, QCs request wallet registration through a specific watchdog's REST API rather than watchdogs monitoring the Bitcoin blockchain independently. This eliminates potential conflicts:
- QC authenticates with their chosen watchdog's API
- Submits registration request with SPV proof
- That specific watchdog executes the on-chain registration
- No multi-watchdog coordination needed

#### Redemption Fulfillment
```solidity
// Each watchdog can record redemption fulfillment
singleWatchdog.recordRedemptionFulfillment(
    redemptionId,
    fulfillmentData,
    spvProof
);
```

### 2. Consensus Operations (M-of-N Agreement Required)

#### QC Status Changes
```solidity
// Watchdog A proposes status change
bytes32 proposalId = watchdogConsensusManager.proposeStatusChange(
    qcAddress,
    QCData.QCStatus.UnderReview,
    "INSUFFICIENT_RESERVES"
);

// Watchdog B supports the proposal
watchdogConsensusManager.vote(proposalId);

// Automatically executes when M votes reached
```

#### Wallet Deregistration
```solidity
// Propose wallet removal
bytes32 proposalId = watchdogConsensusManager.proposeWalletDeregistration(
    qcAddress,
    btcAddress,
    "WALLET_COMPROMISED"
);

// Other watchdogs vote
watchdogConsensusManager.vote(proposalId);
```

#### Redemption Default Flagging
```solidity
// Flag redemption as defaulted
bytes32 proposalId = watchdogConsensusManager.proposeRedemptionDefault(
    redemptionId,
    keccak256("TIMEOUT_EXCEEDED"),
    "QC failed to fulfill within 24 hours"
);
```

### 3. Emergency Response (Automatic)

#### Critical Reports
```solidity
// Any watchdog can submit critical report
watchdogMonitor.submitCriticalReport(
    qcAddress,
    "CRITICAL_INSOLVENCY_DETECTED"
);

// After 3 reports within 1 hour -> automatic emergency pause
```

#### Emergency Status Check
```solidity
// Check if QC is emergency paused
bool isPaused = watchdogMonitor.isEmergencyPaused(qcAddress);

// Get recent report count
uint256 reportCount = watchdogMonitor.getRecentReportCount(qcAddress);
```

## Monitoring and Maintenance

### Health Checks

#### 1. Watchdog Instance Health
```solidity
// Check active watchdog count
uint256 activeCount = watchdogMonitor.getActiveWatchdogCount();

// Get watchdog info
(address watchdogContract, bool active, uint256 regTime, string memory id) = 
    watchdogMonitor.getWatchdogInfo(operatorAddress);

// Verify watchdog is responding
bool isActive = watchdogMonitor.isActiveWatchdog(operatorAddress);
```

#### 2. Consensus System Health
```solidity
// Get consensus parameters
(uint256 required, uint256 total, uint256 period) = 
    watchdogConsensusManager.getConsensusParams();

// Check proposal status
(ProposalType pType, bytes memory data, address proposer, 
 uint256 voteCount, uint256 timestamp, bool executed, string memory reason) = 
    watchdogConsensusManager.getProposal(proposalId);
```

### Regular Maintenance

#### 1. Cleanup Expired Proposals
```solidity
// Clean up old proposals (can be called by anyone)
bytes32[] memory expiredIds = getExpiredProposals(); // Helper function
watchdogConsensusManager.cleanupExpired(expiredIds);
```

#### 2. Clean Up Old Reports
```solidity
// Clean up old critical reports
watchdogMonitor.cleanupOldReports(qcAddress);
```

#### 3. Update Consensus Parameters
```solidity
// Adjust based on active watchdog count
uint256 activeCount = watchdogMonitor.getActiveWatchdogCount();
uint256 newRequired = (activeCount / 2) + 1; // Majority

watchdogConsensusManager.updateConsensusParams(
    newRequired,
    activeCount
);
```

## Emergency Procedures

### 1. Watchdog Instance Failure

#### Deactivate Failed Watchdog
```solidity
// Manager can deactivate non-responsive watchdog
watchdogMonitor.deactivateWatchdog(operatorAddress);

// This automatically:
// - Removes from active list
// - Revokes consensus role
// - Stops accepting reports from that instance
```

#### Replace Failed Watchdog
```solidity
// Deploy new SingleWatchdog instance
// Register new instance
watchdogMonitor.registerWatchdog(
    newWatchdogAddress,
    newOperatorAddress,
    "Replacement Watchdog"
);

// Grant roles
watchdogConsensusManager.grantRole(WATCHDOG_ROLE, newOperatorAddress);
watchdogMonitor.grantRole(WATCHDOG_OPERATOR_ROLE, newOperatorAddress);
```

### 2. Consensus System Issues

#### Emergency Parameter Adjustment
```solidity
// If consensus is stuck due to insufficient active watchdogs
// Manager can temporarily lower threshold
watchdogConsensusManager.updateConsensusParams(
    1, // Emergency: allow single watchdog decisions
    activeCount
);

// Remember to restore normal parameters once resolved
```

#### Manual Proposal Execution
```solidity
// If proposal has enough votes but didn't auto-execute
watchdogConsensusManager.executeProposal(proposalId);
```

### 3. System-Wide Emergency

#### Clear Emergency Pause
```solidity
// Manager can clear emergency pause if false alarm
watchdogMonitor.clearEmergencyPause(qcAddress);
```

#### Emergency Voting Period Adjustment
```solidity
// Shorten voting period for urgent decisions
watchdogConsensusManager.updateVotingPeriod(30 minutes);

// Restore normal period later
watchdogConsensusManager.updateVotingPeriod(2 hours);
```

## Configuration Parameters

### Default Settings

| Parameter | Default Value | Adjustable | Notes |
|-----------|---------------|------------|-------|
| Required Votes (M) | 2 | ✅ Yes | Minimum 2, Maximum 7 |
| Total Watchdogs (N) | 5 | ✅ Yes | Set based on active count |
| Voting Period | 2 hours | ✅ Yes | Range: 1-24 hours |
| Critical Report Threshold | 3 | ❌ No | Hard-coded for security |
| Report Validity Period | 1 hour | ❌ No | Hard-coded for security |

### Recommended Configurations

#### Development/Testing
- M=1, N=3 (single approval for testing)
- Voting Period = 30 minutes (faster testing)

#### Staging
- M=2, N=3 (majority consensus)
- Voting Period = 1 hour

#### Production
- M=3, N=5 (secure majority)
- Voting Period = 2 hours (careful deliberation)

## Security Considerations

### Access Control

1. **MANAGER_ROLE**: Can adjust parameters and manage watchdogs
2. **WATCHDOG_ROLE**: Can propose and vote on consensus operations
3. **WATCHDOG_OPERATOR_ROLE**: Can submit critical reports
4. **ARBITER_ROLE**: Granted to WatchdogConsensusManager for executing decisions

### Parameter Bounds

- **Required Votes**: Min 2, Max 7 (prevents both single points of failure and coordination paralysis)
- **Voting Period**: Min 1 hour, Max 24 hours (balances urgency with deliberation)
- **Emergency Thresholds**: Hard-coded to prevent manipulation

### Operational Security

1. **Independent Deployment**: Each SingleWatchdog deployed by different operators
2. **Geographic Distribution**: Watchdogs should be geographically distributed
3. **Organizational Independence**: Operators should be different organizations
4. **Communication Security**: Off-chain coordination should use secure channels

## Troubleshooting

### Common Issues

#### 1. Consensus Not Reaching Threshold
**Symptoms**: Proposals created but not executed
**Causes**: Insufficient active watchdogs, network issues
**Solutions**: 
- Check active watchdog count
- Verify network connectivity
- Consider temporarily lowering threshold

#### 2. Emergency Pause Not Triggering
**Symptoms**: Critical reports submitted but no emergency pause
**Causes**: Reports from same watchdog, reports outside validity window
**Solutions**:
- Verify reports are from different watchdogs
- Check timestamps on reports
- Manually trigger if needed

#### 3. Watchdog Instance Not Responding
**Symptoms**: No attestations or reports from specific watchdog
**Causes**: Operator issues, contract problems, network issues
**Solutions**:
- Contact operator directly
- Check watchdog contract state
- Consider deactivation if non-responsive

### Error Messages

| Error | Meaning | Solution |
|-------|---------|----------|
| `WatchdogNotActive` | Watchdog deactivated | Reactivate or replace watchdog |
| `ProposalNotFound` | Invalid proposal ID | Verify proposal exists |
| `AlreadyVoted` | Duplicate vote attempt | Each watchdog can only vote once |
| `VotingEnded` | Proposal expired | Create new proposal |
| `ProposalNotApproved` | Insufficient votes | Wait for more votes or manual execution |
| `InvalidParameters` | Parameter out of bounds | Use values within acceptable ranges |

## Monitoring Dashboard Requirements

### Key Metrics

1. **Watchdog Health**
   - Active watchdog count
   - Last activity timestamp per watchdog
   - Response time metrics

2. **Consensus Activity**
   - Pending proposals
   - Vote counts
   - Average time to consensus

3. **Emergency Monitoring**
   - Critical report count per QC
   - Emergency pause status
   - Recent emergency events

4. **System Performance**
   - Transaction success rates
   - Gas usage trends
   - Error frequency

### Alerting

1. **Immediate Alerts**
   - Emergency pause triggered
   - Watchdog instance offline
   - Consensus failure

2. **Warning Alerts**
   - Low active watchdog count
   - Pending proposals near expiration
   - High critical report frequency

3. **Informational**
   - New watchdog registered
   - Consensus parameter changes
   - Successful proposal execution

This operational guide provides the framework for running a secure, efficient, and maintainable V1.1 watchdog system with multiple independent operators and minimal consensus overhead.