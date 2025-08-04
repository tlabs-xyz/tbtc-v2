# Watchdog System Complete Guide

**Document Version**: 2.0  
**Date**: 2025-08-04  
**Purpose**: Comprehensive guide for tBTC v2 watchdog system operation, API, migration, and automation  
**Status**: Production Guide

---

## Executive Summary

This document provides complete coverage of the tBTC v2 watchdog system, covering V1.1 dual-path architecture, V1.2 automated decision framework, operations, API specifications, and migration procedures. The system enables **90% automation** of watchdog decisions while maintaining security through DAO oversight and M-of-N consensus for critical operations.

### Key Components
- **QCWatchdog** - Individual watchdog instances for routine operations
- **WatchdogConsensusManager** - M-of-N consensus for critical operations
- **WatchdogMonitor** - Coordinates multiple watchdog instances
- **V1.2 Automated Framework** - Three-layer decision system for 90%+ automation

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Operations Guide](#operations-guide)
3. [REST API Specification](#rest-api-specification)
4. [Automated Decision Framework](#automated-decision-framework)
5. [Migration Guide](#migration-guide)
6. [Evidence-Based Consensus](#evidence-based-consensus)
7. [Configuration and Deployment](#configuration-and-deployment)
8. [Troubleshooting](#troubleshooting)

---

## System Architecture

### V1.1 Dual-Path Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   QCWatchdog    │    │   QCWatchdog    │    │   QCWatchdog    │
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

### V1.2 Three-Layer Automated Framework

```
┌─────────────────────────────────────────────────────────────────────┐
│                         90% Automated Operations                    │
├─────────────────────┬─────────────────────┬─────────────────────────┤
│   Layer 1           │   Layer 2           │   Layer 3               │
│   Deterministic     │   Threshold-Based   │   DAO Escalation       │
│   Enforcement       │   Actions           │                         │
├─────────────────────┼─────────────────────┼─────────────────────────┤
│                     │                     │                         │
│ • Reserve checks    │ • 3+ reports needed │ • Governance proposals  │
│ • Timeout detection │ • Evidence required │ • Community decisions   │
│ • Inactivity rules  │ • Cooldown periods  │ • Complex judgments     │
│ • SPV validation    │ • Auto-escalation   │                         │
│                     │                     │                         │
│ Response: <1 min    │ Response: <1 hour   │ Response: Days/weeks    │
└─────────────────────┴─────────────────────┴─────────────────────────┘
```

### Core Principles

- **Independence**: Most operations executed independently by individual watchdogs
- **Consensus**: Only critical operations require M-of-N agreement
- **Emergency**: Automatic responses for time-critical issues
- **Automation**: 90%+ of decisions fully automated

---

## Operations Guide

### 1. Normal Operations (Independent Execution)

#### Reserve Attestations
```solidity
// Each watchdog independently attests reserves
qcWatchdog.attestReserves(qcAddress, balance);
```

#### Wallet Registration
```solidity
// Each watchdog can register wallets with SPV proof
qcWatchdog.registerWalletWithProof(
    qcAddress,
    btcAddress,
    spvProof
);
```

**Important**: QCs request wallet registration through a specific watchdog's REST API rather than watchdogs monitoring the Bitcoin blockchain independently. This eliminates potential conflicts:
- QC authenticates with their chosen watchdog's API
- Submits registration request with SPV proof
- That specific watchdog executes the on-chain registration
- No multi-watchdog coordination needed

#### Redemption Fulfillment
```solidity
// Each watchdog can record redemption fulfillment
qcWatchdog.recordRedemptionFulfillment(
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

---

## REST API Specification

### Authentication

All API endpoints require bearer token authentication:

```
Authorization: Bearer <QC_API_TOKEN>
```

Tokens are issued during QC onboarding and map to specific QC addresses.

### API Endpoints

#### 1. Wallet Registration

**Endpoint**: `POST /api/v1/wallet/register`

**Purpose**: Request registration of a new Bitcoin wallet after QC has sent the OP_RETURN transaction

**Request Body**:
```json
{
  "qcAddress": "0x1234567890123456789012345678901234567890",
  "btcAddress": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  "spvProof": {
    "txInfo": {
      "version": "0x01000000",
      "inputVector": "0x...",
      "outputVector": "0x...",
      "locktime": "0x00000000"
    },
    "proof": {
      "merkleProof": "0x...",
      "txIndexInBlock": 42,
      "bitcoinHeaders": "0x..."
    },
    "challengeHash": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
  }
}
```

**Response (Success - 200)**:
```json
{
  "status": "success",
  "transactionHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  "btcAddress": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

#### 2. Reserve Attestation

**Endpoint**: `POST /api/v1/reserves/attest`

**Request Body**:
```json
{
  "qcAddress": "0x1234567890123456789012345678901234567890",
  "balance": "1000000000000",
  "attestationData": {
    "timestamp": "2025-01-15T10:00:00Z",
    "wallets": [
      {
        "address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        "balance": "500000000000"
      }
    ],
    "signature": "0x..."
  }
}
```

#### 3. Redemption Status Update

**Endpoint**: `POST /api/v1/redemption/fulfill`

**Request Body**:
```json
{
  "redemptionId": "0x9876543210987654321098765432109876543210987654321098765432109876",
  "userBtcAddress": "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  "expectedAmount": "99500000",
  "spvProof": {
    "txInfo": {...},
    "proof": {...}
  }
}
```

#### 4. Health Check

**Endpoint**: `GET /api/v1/health`

**Response**:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "watchdogAddress": "0xabcdef1234567890abcdef1234567890abcdef12",
  "ethBalance": "5.234",
  "services": {
    "ethereum": "connected",
    "bitcoin": "connected",
    "database": "connected"
  }
}
```

### Error Handling

**Standard Error Response**:
```json
{
  "status": "error",
  "code": "ERROR_CODE",
  "message": "Human readable error message",
  "details": {},
  "timestamp": "2025-01-15T10:30:00Z",
  "requestId": "req_1234567890"
}
```

### Rate Limiting
- Per QC: 100 requests per minute
- Burst allowance: 20 requests

---

## Automated Decision Framework

### Complete Protocol Deviation Catalog

#### 1. Reserve-Related Deviations (Fully Automatable)

| Deviation | Detection Logic | Threshold | Action |
|-----------|----------------|-----------|---------|
| Insufficient Reserves | `reserves < mintedAmount * collateralRatio` | 90% | Status → UnderReview |
| Stale Attestations | `currentTime > lastAttestation + staleThreshold` | 24 hours | Status → UnderReview |
| Declining Reserves | `newReserves < oldReserves * 0.9` | 10% drop | Alert + Monitor |
| Zero Reserves | `reserves == 0` | Immediate | Status → UnderReview |

#### 2. Redemption Failures (Fully Automatable)

| Deviation | Detection Logic | Threshold | Action |
|-----------|----------------|-----------|---------|
| Redemption Timeout | `currentTime > redemptionRequest + timeout` | Configurable | Flag as defaulted |
| Incorrect Amount | `btcPaid != requestedAmount` | Any deviation | Flag as defaulted |
| Wrong Recipient | `btcRecipient != userBtcAddress` | Any mismatch | Flag as defaulted |
| No BTC Transaction | No SPV proof within timeout | Timeout | Flag as defaulted |

### Layer 1: Deterministic Enforcement

**Purpose**: Handle all objective, measurable conditions without consensus

```solidity
contract WatchdogAutomatedEnforcement {
    function enforceReserveCompliance(address qc) external {
        (uint256 reserves, bool isStale) = reserveLedger.getReserveBalanceAndStaleness(qc);
        uint256 minted = qcData.getMintedAmount(qc);
        QCData.QCStatus status = qcData.getQCStatus(qc);
        
        // Only act on Active QCs
        if (status != QCData.QCStatus.Active) return;
        
        // Check 1: Stale attestations
        if (isStale) {
            qcManager.setQCStatus(qc, QCData.QCStatus.UnderReview, "STALE_ATTESTATIONS");
            emit AutomatedAction(qc, "STALE_ATTESTATIONS", block.timestamp);
            return;
        }
        
        // Check 2: Insufficient reserves
        if (reserves * 100 < minted * minCollateralRatio) {
            qcManager.setQCStatus(qc, QCData.QCStatus.UnderReview, "INSUFFICIENT_RESERVES");
            emit AutomatedAction(qc, "INSUFFICIENT_RESERVES", block.timestamp);
        }
    }
    
    function enforceRedemptionTimeout(bytes32 redemptionId) external {
        Redemption memory r = redeemer.getRedemption(redemptionId);
        
        require(r.status == RedemptionStatus.Pending, "Not pending");
        require(block.timestamp > r.requestTime + redemptionTimeout, "Not timed out");
        
        redeemer.flagDefaultedRedemption(redemptionId, "TIMEOUT");
        emit AutomatedAction(redemptionId, "REDEMPTION_TIMEOUT", block.timestamp);
    }
}
```

### Layer 2: Threshold-Based Actions

**Purpose**: Collect reports on non-deterministic issues, act at threshold

```solidity
contract WatchdogThresholdActions {
    uint256 public constant REPORT_THRESHOLD = 3;
    uint256 public constant REPORT_WINDOW = 24 hours;
    
    enum ReportType {
        SUSPICIOUS_ACTIVITY,
        UNUSUAL_PATTERN,
        EMERGENCY_SITUATION,
        OPERATIONAL_CONCERN
    }
    
    function reportIssue(
        ReportType reportType,
        address target,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external onlyWatchdog {
        bytes32 issueId = keccak256(abi.encodePacked(reportType, target));
        
        // Check cooldown and duplicate reporting
        require(block.timestamp > lastActionTime[issueId] + COOLDOWN_PERIOD, "In cooldown");
        require(!hasReported[issueId][msg.sender], "Already reported");
        
        // Add report
        reports[issueId].push(Report({
            watchdog: msg.sender,
            timestamp: block.timestamp,
            evidenceHash: evidenceHash,
            evidenceURI: evidenceURI
        }));
        
        // Check if threshold reached
        uint256 recentReports = _countRecentReports(issueId);
        if (recentReports >= REPORT_THRESHOLD) {
            _executeThresholdAction(reportType, target, issueId);
        }
    }
}
```

### Layer 3: DAO Escalation System

**Purpose**: Create DAO proposals for all non-deterministic decisions

```solidity
contract WatchdogDAOEscalation {
    function escalate(
        bytes32 issueId,
        uint8 reportType,
        address target,
        bytes calldata evidence
    ) external onlyThresholdContract {
        // Create appropriate DAO proposal based on report type
        uint256 proposalId = _createDAOProposal(reportType, target, evidence);
        
        emit EscalatedToDAO(issueId, reportType, target, 3, proposalId);
    }
}
```

### Decision Flow

**90% Automated Operations**:
1. Objective violations → Layer 1 (immediate action)
2. Subjective concerns → Layer 2 (threshold system)
3. Complex issues → Layer 3 (DAO governance)

---

## Migration Guide

### Migration from Subjective Consensus to Automated Framework

**Timeline**: 4 weeks  
**Risk Level**: Low (parallel deployment strategy)

### Phase 1: Parallel Deployment (Week 1)

```bash
# Deploy automated framework contracts
npx hardhat deploy --tags "AutomatedDecisionFramework" --network <network>

# Configure roles and permissions
npx hardhat deploy --tags "ConfigureAutomatedDecisionFramework" --network <network>
```

### Phase 2: Parallel Operation (Week 2-3)

**Dual System Configuration**:
```typescript
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

### Phase 3: Full Migration (Week 4)

#### Disable Old Consensus
```solidity
// Pause old consensus manager (governance action)
await watchdogConsensusManager.pause()

// Update all watchdog configurations
await updateWatchdogConfig({
  useOldConsensus: false,
  useAutomatedFramework: true
})
```

#### Update Watchdog Software
**Remove old functions**:
```typescript
// Remove these functions:
async proposeStatusChange(qc: string, status: QCStatus, reason: string)
async vote(proposalId: string)
```

**Add new functions**:
```typescript
// Add these functions:
async enforceReserveCompliance(qc: string)
async enforceRedemptionTimeout(redemptionId: string)
async reportSuspiciousActivity(qc: string, evidence: Evidence)
```

### Benefits of Migration

| Issue Type | Old Response Time | New Response Time | Improvement |
|------------|------------------|------------------|-------------|
| Stale Reserves | 2-24 hours | <1 minute | 120x-1440x faster |
| Redemption Timeout | 2-24 hours | <1 minute | 120x-1440x faster |
| Suspicious Activity | 2-24 hours | <1 hour | 2x-24x faster |
| Emergency Issues | 2-24 hours | <10 minutes | 12x-144x faster |

### Rollback Procedures

**Emergency Rollback**:
```solidity
// 1. Pause new system
await automatedEnforcement.pause()
await thresholdActions.pause()

// 2. Re-enable old system
await watchdogConsensusManager.unpause()

// 3. Restore old role assignments
await qcManager.grantRole(ARBITER_ROLE, watchdogConsensusManager.address)
```

---

## Evidence-Based Consensus

### Problem with Current System

The current WatchdogConsensusManager accepts human-readable "reason" strings, making it impossible for automated watchdogs to:
1. Validate proposal legitimacy independently
2. Prevent duplicate proposals
3. Make informed voting decisions

### Solution: Machine-Interpretable Evidence

**Evidence Structure**:
```solidity
struct Evidence {
    bytes32 evidenceType;      // Type of evidence (e.g., INSUFFICIENT_RESERVES)
    bytes32 dataHash;          // Hash of the evidence data
    uint256 blockNumber;       // Block at which evidence was collected
    bytes signature;           // Optional: signature from data source
}
```

**Enhanced Proposals**:
```solidity
struct Proposal {
    ProposalType proposalType;
    bytes data;                // Encoded action parameters
    Evidence[] evidence;       // Machine-verifiable evidence
    address proposer;
    uint256 voteCount;
    uint256 timestamp;
    bool executed;
    string humanSummary;       // Optional: for monitoring/UI only
}
```

### Evidence Types

#### STATUS_CHANGE Evidence
```solidity
struct InsufficientReservesProof {
    uint256 attestedReserves;
    uint256 mintedAmount;
    uint256 attestationTimestamp;
    address[] attestingWatchdogs;  // Must meet threshold
}
```

#### WALLET_DEREGISTRATION Evidence
```solidity
struct WalletDeregistrationEvidence {
    DeregistrationReason reason;
    bytes32 btcTxHash;          // For compromise proof
    uint256 lastActivityBlock;   // For inactivity
    bytes signature;            // For QC request
}
```

### Duplicate Prevention

**Deterministic Proposal IDs**:
```solidity
// Same inputs ALWAYS produce same ID
bytes32 proposalId = keccak256(abi.encodePacked(
    proposalType,
    actionParameters,
    evidenceHash
));

// Creating duplicate proposal will revert
if (proposals[proposalId].timestamp != 0) {
    revert ProposalAlreadyExists(proposalId);
}
```

---

## Configuration and Deployment

### Default Configuration Parameters

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

#### Production
- M=3, N=5 (secure majority)
- Voting Period = 2 hours (careful deliberation)

### Deployment Steps

#### 1. Deploy Core Contracts
```bash
yarn deploy --network <network> --tags AccountControlWatchdog
yarn deploy --network <network> --tags AccountControlConfig
```

#### 2. Deploy QCWatchdog Instances
```bash
# For each watchdog operator
npx hardhat run scripts/deploy-qc-watchdog.js --network <network>
```

#### 3. Register Watchdog Instances
```solidity
// Register each deployed QCWatchdog
watchdogMonitor.registerWatchdog(
    qcWatchdogAddress,
    operatorAddress,
    "Watchdog Operator Name"
);

// Grant consensus role
watchdogConsensusManager.grantRole(WATCHDOG_ROLE, operatorAddress);
```

#### 4. Configure Consensus Parameters
```solidity
// Set M-of-N based on deployed watchdog count
watchdogConsensusManager.updateConsensusParams(
    2, // M (required votes)
    3  // N (total watchdogs)
);
```

---

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

### Emergency Procedures

#### Watchdog Instance Failure
```solidity
// Deactivate failed watchdog
watchdogMonitor.deactivateWatchdog(operatorAddress);

// Deploy and register replacement
watchdogMonitor.registerWatchdog(
    newWatchdogAddress,
    newOperatorAddress,
    "Replacement Watchdog"
);
```

#### System-Wide Emergency
```solidity
// Clear emergency pause if false alarm
watchdogMonitor.clearEmergencyPause(qcAddress);

// Adjust voting period for urgent decisions
watchdogConsensusManager.updateVotingPeriod(30 minutes);
```

---

## Monitoring and Observability

### Key Metrics

1. **Watchdog Health**
   - Active watchdog count
   - Last activity timestamp per watchdog
   - Response time metrics

2. **Consensus Activity**
   - Pending proposals
   - Vote counts
   - Average time to consensus

3. **Automated Framework Performance**
   - Automated actions executed
   - Threshold reports submitted
   - DAO escalations created
   - Enforcement response time

### Alerting Conditions

1. **Immediate Alerts**
   - Emergency pause triggered
   - Watchdog instance offline
   - Automated enforcement failure

2. **Warning Alerts**
   - Low active watchdog count
   - Threshold reached
   - High critical report frequency

### Dashboard Requirements

**Real-time Monitoring**:
- Current system state
- Active watchdogs
- Pending operations
- Automated action frequency

**Historical Analysis**:
- Trend analysis
- Performance metrics
- Incident tracking
- Decision accuracy rates

---

## Security Considerations

### Access Control Roles

1. **MANAGER_ROLE**: Can adjust parameters and manage watchdogs
2. **WATCHDOG_ROLE**: Can propose and vote on consensus operations
3. **WATCHDOG_OPERATOR_ROLE**: Can submit critical reports
4. **ARBITER_ROLE**: Granted to consensus manager for executing decisions

### Parameter Bounds

- **Required Votes**: Min 2, Max 7 (prevents single points of failure and coordination paralysis)
- **Voting Period**: Min 1 hour, Max 24 hours (balances urgency with deliberation)
- **Emergency Thresholds**: Hard-coded to prevent manipulation

### Operational Security

1. **Independent Deployment**: Each QCWatchdog deployed by different operators
2. **Geographic Distribution**: Watchdogs should be geographically distributed
3. **Organizational Independence**: Operators should be different organizations
4. **Communication Security**: Off-chain coordination should use secure channels

---

## Conclusion

The tBTC v2 watchdog system represents a sophisticated balance between automation and security, providing:

- **90%+ automation** of routine operations
- **M-of-N consensus** for critical decisions
- **Emergency response** capabilities
- **DAO escalation** for complex governance issues
- **Evidence-based validation** for all proposals
- **Comprehensive monitoring** and alerting

This guide serves as the complete reference for deploying, operating, and maintaining the watchdog system across all architectural versions and operational scenarios.

---

**Document History**:
- v2.0 (2025-08-04): Consolidated from 6 separate watchdog documents
- Includes: Operations, API, Migration, Automation, Evidence, and Practical Solutions
- Covers: V1.1 dual-path + V1.2 automated framework architectures