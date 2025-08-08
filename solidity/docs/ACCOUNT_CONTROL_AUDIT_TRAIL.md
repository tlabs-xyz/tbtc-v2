# Account Control Audit Trail Documentation

**Version**: 1.0  
**Date**: 2025-01-08  
**Purpose**: Comprehensive audit trail design for all Account Control user flows  
**Scope**: Event tracking, data reconstruction, and compliance monitoring

---

## Table of Contents

1. [Overview](#1-overview)
2. [QC Lifecycle Management Flows](#2-qc-lifecycle-management-flows)
3. [Wallet Management Flows](#3-wallet-management-flows)
4. [Reserve Operations Flows](#4-reserve-operations-flows)
5. [Minting Operations Flows](#5-minting-operations-flows)
6. [Redemption Operations Flows](#6-redemption-operations-flows)
7. [Watchdog Operations Flows](#7-watchdog-operations-flows)
8. [System Administration Flows](#8-system-administration-flows)
9. [Event Correlation Patterns](#9-event-correlation-patterns)
10. [Dashboard Implementation Guide](#10-dashboard-implementation-guide)

---

## 1. Overview

This document provides a comprehensive guide for implementing audit trails across all Account Control user flows. Each flow is documented with:

- **Entry Points**: External/public functions that initiate the flow
- **Key Events**: Events emitted for audit trail reconstruction
- **Data Requirements**: Essential data points for complete visibility
- **Correlation Patterns**: How to link related events across contracts

### Core Principles

1. **Complete Traceability**: Every user action must be traceable from initiation to completion
2. **Actor Attribution**: All actions must be attributable to specific addresses and roles
3. **State Reconstruction**: System state at any point must be reconstructible from events
4. **Economic Transparency**: All value transfers must be tracked and auditable

---

## 2. QC Lifecycle Management Flows

### 2.1 QC Registration Flow

**Purpose**: Onboard new Qualified Custodians to the system

**Entry Point**: `QCManager.registerQC(address qc, uint256 maxMintingCap)`

**Key Events**:

```solidity
// From QCManager.sol
event QCRegistrationInitiated(
    address indexed qc,
    address indexed initiatedBy,
    uint256 indexed timestamp
);

event QCOnboarded(
    address indexed qc,
    uint256 indexed maxMintingCap,
    address indexed onboardedBy,
    uint256 timestamp
);

// From QCData.sol
event QCRegistered(
    address indexed qc,
    address indexed registeredBy,
    uint256 indexed maxMintingCapacity,
    uint256 timestamp
);
```

**Audit Data Points**:

- QC address
- Initial minting capacity
- Registration timestamp
- Registering authority (must have QC_GOVERNANCE_ROLE)
- Transaction details (gas, block number)

**Reconstruction Query**:

```sql
SELECT * FROM events
WHERE event_name IN ('QCRegistrationInitiated', 'QCOnboarded', 'QCRegistered')
AND qc_address = ?
ORDER BY timestamp ASC;
```

### 2.2 Minting Capacity Increase Flow

**Purpose**: Expand operational limits for existing QCs

**Entry Point**: `QCManager.increaseMintingCapacity(address qc, uint256 newCap)`

**Key Events**:

```solidity
event MintingCapIncreased(
    address indexed qc,
    uint256 indexed oldCap,
    uint256 indexed newCap,
    address increasedBy,
    uint256 timestamp
);

event QCMaxMintingCapacityUpdated(
    address indexed qc,
    uint256 indexed oldCapacity,
    uint256 indexed newCapacity,
    address updatedBy,
    uint256 timestamp
);
```

**Audit Data Points**:

- Previous capacity vs new capacity
- Capacity change percentage
- Authority verification
- Historical capacity changes

### 2.3 QC Status Change Flow

**Purpose**: Manage QC operational status (Active → UnderReview → Revoked)

**Entry Point**: `QCManager.setQCStatus(address qc, QCStatus newStatus, bytes32 reason)`

**Key Events**:

```solidity
event QCStatusChanged(
    address indexed qc,
    QCStatus indexed oldStatus,
    QCStatus indexed newStatus,
    bytes32 reason,
    address changedBy,
    uint256 timestamp
);

// Watchdog-initiated
event WatchdogQCStatusChange(
    address indexed qc,
    QCStatus indexed newStatus,
    bytes32 reason,
    address indexed changedBy,
    uint256 timestamp
);
```

**Audit Data Points**:

- Status transition validation
- Reason codes and descriptions
- Authority (ARBITER_ROLE required)
- Impact on active operations

---

## 3. Wallet Management Flows

### 3.1 Wallet Registration Flow

**Purpose**: Register Bitcoin addresses under QC control with SPV verification

**Entry Points**:

- `QCManager.registerWallet(address qc, string btcAddress, bytes32 challenge, BitcoinTx.Info txInfo, BitcoinTx.Proof proof)`
- `QCWatchdog.registerWalletWithProof(address qc, string btcAddress, bytes spvProof, bytes32 challengeHash)`

**Key Events**:

```solidity
// Success path
event WalletRegistrationRequested(
    address indexed qc,
    string btcAddress,
    address indexed requestedBy,
    uint256 indexed timestamp
);

event WalletControlVerified(
    address indexed qc,
    string btcAddress,
    bytes32 indexed txHash,
    address indexed verifiedBy,
    uint256 timestamp
);

event SPVProofStored(
    bytes32 indexed operationId,
    bytes spvProof,
    BitcoinTx.Info txInfo
);

event WalletRegistered(
    address indexed qc,
    string btcAddress,
    address indexed registeredBy,
    uint256 indexed timestamp
);

// Failure path
event WalletRegistrationFailed(
    address indexed qc,
    string btcAddress,
    string reason,
    address attemptedBy
);
```

**Audit Data Points**:

- Bitcoin address format validation
- SPV proof components (transaction, merkle proof, block header)
- Challenge-response verification
- QC status at registration time
- Complete proof data for re-verification

**Reconstruction Pattern**:

1. Find `WalletRegistrationRequested` event
2. Match with `WalletControlVerified` using qc + btcAddress
3. Retrieve `SPVProofStored` using operationId = keccak256(qc, btcAddress)
4. Confirm with `WalletRegistered` or identify failure with `WalletRegistrationFailed`

### 3.2 Wallet Deregistration Flow

**Purpose**: Remove Bitcoin addresses from QC control with solvency verification

**Entry Points**:

- Request: `QCManager.requestWalletDeRegistration(string btcAddress)`
- Finalize: `QCManager.finalizeWalletDeRegistration(string btcAddress, uint256 newReserveBalance)`

**Key Events**:

```solidity
event WalletDeRegistrationRequested(
    address indexed qc,
    string btcAddress,
    address indexed requestedBy,
    uint256 indexed timestamp
);

event WalletDeregistrationCompleted(
    address indexed qc,
    string btcAddress,
    uint256 newReserveBalance,
    uint256 previousReserveBalance
);

event WalletDeRegistrationFinalized(
    address indexed qc,
    string btcAddress,
    address indexed finalizedBy,
    uint256 indexed timestamp
);

// Related solvency events
event ReserveBalanceUpdated(
    address indexed qc,
    uint256 indexed oldBalance,
    uint256 indexed newBalance,
    address updatedBy,
    uint256 timestamp
);
```

**Audit Data Points**:

- Two-step process tracking
- Reserve balance before/after
- Solvency check results
- Time between request and finalization

---

## 4. Reserve Operations Flows

### 4.1 Regular Reserve Attestation Flow

**Purpose**: Update QC reserve balances for minting capacity calculation

**Entry Point**: `QCReserveLedger.submitReserveAttestation(address qc, uint256 balance)`

**Key Events**:

```solidity
event ReserveAttestationSubmitted(
    address indexed attester,
    address indexed qc,
    uint256 indexed newBalance,
    uint256 oldBalance,
    uint256 timestamp,
    uint256 blockNumber
);

event AttestationFailed(
    address indexed qc,
    address indexed attester,
    string reason
);

// Strategic attestations
event WatchdogReserveAttestation(
    address indexed qc,
    uint256 indexed newBalance,
    uint256 indexed oldBalance,
    address submittedBy,
    uint256 timestamp
);
```

**Audit Data Points**:

- Balance change magnitude and direction
- Attestation frequency
- Attester authorization (ATTESTER_ROLE)
- Historical balance trends

### 4.2 SPV-Verified Attestation Flow

**Purpose**: Enhanced attestation with cryptographic proof

**Entry Point**: `QCReserveLedger.submitSPVVerifiedAttestation(address qc, uint256 balance, bytes proofData)`

**Key Events**:

```solidity
event SPVVerifiedAttestationSubmitted(
    address indexed attester,
    address indexed qc,
    uint256 indexed balance,
    bytes32 proofTxHash,
    uint256 timestamp
);
```

### 4.3 Solvency Check Flow

**Purpose**: Verify QC has sufficient reserves for minted amount

**Entry Point**: `QCManager.verifyQCSolvency(address qc)`

**Key Events**:

```solidity
event SolvencyCheckPerformed(
    address indexed qc,
    bool indexed solvent,
    uint256 mintedAmount,
    uint256 reserveBalance,
    address indexed checkedBy,
    uint256 timestamp
);

// If insolvent, triggers status change
event QCStatusChanged(
    address indexed qc,
    QCStatus indexed oldStatus,
    QCStatus indexed newStatus,
    bytes32 reason, // "UNDERCOLLATERALIZED"
    address changedBy,
    uint256 timestamp
);
```

---

## 5. Minting Operations Flows

### 5.1 Successful Minting Flow

**Purpose**: Create tBTC tokens backed by QC reserves

**Entry Points**:

- User: `QCMinter.requestQCMint(uint256 amount)`
- Policy: `BasicMintingPolicy.requestMint(address qc, address user, uint256 amount)`

**Key Events**:

```solidity
// From QCMinter
event QCMintRequested(
    address indexed user,
    address indexed qc,
    uint256 indexed amount,
    bytes32 mintId,
    uint256 timestamp
);

// From BasicMintingPolicy
event QCBankBalanceCreated(
    address indexed qc,
    address indexed user,
    uint256 satoshis,
    bytes32 indexed mintId
);

event QCBackedDepositCredited(
    address indexed user,
    uint256 amount,
    address indexed qc,
    bytes32 indexed mintId,
    bool autoMinted
);

event MintCompleted(
    bytes32 indexed mintId,
    address indexed qc,
    address indexed user,
    uint256 amount,
    address completedBy,
    uint256 timestamp
);

// From Bank
event BalanceIncreased(
    address indexed owner,
    uint256 amount
);

// From TBTCVault
event Minted(
    address indexed to,
    uint256 amount
);

// From QCManager
event QCMintedAmountUpdated(
    address indexed qc,
    uint256 indexed oldAmount,
    uint256 indexed newAmount,
    address updatedBy,
    uint256 timestamp
);
```

**Audit Data Points**:

- Unique mintId for tracking
- tBTC amount vs satoshi conversion
- Available capacity before mint
- Complete flow from request to token receipt
- Gas costs across contracts

### 5.2 Failed Minting Flow

**Purpose**: Track rejected minting attempts

**Key Events**:

```solidity
event MintRejected(
    address indexed qc,
    address indexed user,
    uint256 indexed amount,
    string reason,
    address rejectedBy,
    uint256 timestamp
);
```

**Failure Reasons**:

- "Minting paused"
- "Amount outside allowed range"
- "QC not active"
- "Insufficient capacity"

---

## 6. Redemption Operations Flows

### 6.1 Redemption Request Flow

**Purpose**: User burns tBTC to receive Bitcoin

**Entry Point**: `QCRedeemer.initiateRedemption(address qc, uint256 amount, string userBtcAddress)`

**Key Events**:

```solidity
// Success path
event RedemptionRequested(
    bytes32 indexed redemptionId,
    address indexed user,
    address indexed qc,
    uint256 amount,
    string userBtcAddress,
    address requestedBy,
    uint256 timestamp
);

// From TBTC token
event Transfer(
    address indexed from,
    address indexed to, // burn address: 0x0
    uint256 value
);

// Failure path
event RedemptionRequestFailed(
    address indexed qc,
    address indexed user,
    uint256 amount,
    string reason,
    address attemptedBy
);
```

### 6.2 Redemption Fulfillment Flow

**Purpose**: Record Bitcoin payment with SPV proof

**Entry Point**: `QCRedeemer.recordRedemptionFulfillment(bytes32 redemptionId, string userBtcAddress, uint64 expectedAmount, BitcoinTx.Info txInfo, BitcoinTx.Proof proof)`

**Key Events**:

```solidity
event RedemptionFulfilled(
    bytes32 indexed redemptionId,
    address indexed user,
    address indexed qc,
    uint256 amount,
    address fulfilledBy,
    uint256 timestamp
);

event RedemptionFulfillmentVerified(
    bytes32 indexed redemptionId,
    bytes32 indexed txHash,
    address indexed verifiedBy,
    uint256 timestamp
);

event SPVProofStored(
    bytes32 indexed operationId, // redemptionId
    bytes spvProof,
    BitcoinTx.Info txInfo
);

event WatchdogRedemptionAction(
    bytes32 indexed redemptionId,
    string indexed action, // "FULFILLED"
    bytes32 reason,
    address indexed actionBy,
    uint256 timestamp
);
```

### 6.3 Redemption Default Flow

**Purpose**: Handle failed redemptions after timeout

**Entry Point**: `QCRedeemer.flagDefaultedRedemption(bytes32 redemptionId, bytes32 reason)`

**Key Events**:

```solidity
event RedemptionDefaulted(
    bytes32 indexed redemptionId,
    address indexed user,
    address indexed qc,
    uint256 amount,
    bytes32 reason,
    address defaultedBy,
    uint256 timestamp
);

event WatchdogRedemptionAction(
    bytes32 indexed redemptionId,
    string indexed action, // "DEFAULTED"
    bytes32 reason,
    address indexed actionBy,
    uint256 timestamp
);

// Triggers QC punishment
event QCStatusChanged(
    address indexed qc,
    QCStatus indexed oldStatus,
    QCStatus indexed newStatus, // Revoked
    bytes32 reason, // "REDEMPTION_DEFAULT"
    address changedBy,
    uint256 timestamp
);
```

---

## 7. Watchdog Operations Flows

### 7.1 Watchdog Consensus Proposal Flow

**Purpose**: Multi-watchdog voting on critical operations

**Entry Point**: `WatchdogConsensusManager.createProposal(ProposalType proposalType, bytes data, string reason)`

**Key Events**:

```solidity
event ProposalCreated(
    bytes32 indexed proposalId,
    ProposalType indexed proposalType,
    address indexed proposer,
    string reason
);

event VoteCast(
    bytes32 indexed proposalId,
    address indexed voter,
    uint256 newVoteCount
);

event ProposalExecuted(
    bytes32 indexed proposalId,
    ProposalType indexed proposalType,
    address indexed executor
);

event ProposalExpired(
    bytes32 indexed proposalId
);
```

**Proposal Types**:

- STATUS_CHANGE
- WALLET_DEREGISTRATION
- REDEMPTION_DEFAULT
- FORCE_INTERVENTION

### 7.2 Emergency Monitoring Flow

**Purpose**: Track critical issues requiring immediate attention

**Entry Point**: `WatchdogMonitor.submitCriticalReport(address qc, string reason)`

**Key Events**:

```solidity
event CriticalReportSubmitted(
    address indexed qc,
    address indexed reporter,
    string reason,
    uint256 recentReportCount
);

event EmergencyPauseTriggered(
    address indexed qc,
    uint256 reportCount,
    address triggeredBy
);

event EmergencyPauseCleared(
    address indexed qc,
    address clearedBy
);
```

---

## 8. System Administration Flows

### 8.1 Role Management Flow

**Purpose**: Grant/revoke system permissions

**Entry Points**: Various `grantRole` and `revokeRole` functions

**Key Events**:

```solidity
// Standard OpenZeppelin events
event RoleGranted(
    bytes32 indexed role,
    address indexed account,
    address indexed sender
);

event RoleRevoked(
    bytes32 indexed role,
    address indexed account,
    address indexed sender
);

// Custom role events
event QCManagerRoleGranted(
    address indexed manager,
    address indexed grantedBy,
    uint256 indexed timestamp
);

event AttesterRoleGranted(
    address indexed attester,
    address indexed grantedBy,
    uint256 indexed timestamp
);
```

### 8.2 System Parameter Updates

**Purpose**: Adjust operational thresholds

**Entry Points**: Various setter functions in SystemState

**Key Events**:

```solidity
event MinMintAmountUpdated(
    uint256 indexed oldAmount,
    uint256 indexed newAmount,
    address indexed updatedBy,
    uint256 timestamp
);

event RedemptionTimeoutUpdated(
    uint256 indexed oldTimeout,
    uint256 indexed newTimeout,
    address indexed updatedBy,
    uint256 timestamp
);

event StaleThresholdUpdated(
    uint256 indexed oldThreshold,
    uint256 indexed newThreshold,
    address indexed updatedBy,
    uint256 timestamp
);
```

### 8.3 Emergency Pause Operations

**Purpose**: Circuit breaker activation

**Entry Points**: `SystemState.pauseMinting()`, `pauseRedemption()`, etc.

**Key Events**:

```solidity
event MintingPaused(
    address indexed triggeredBy,
    uint256 indexed timestamp
);

event MintingUnpaused(
    address indexed triggeredBy,
    uint256 indexed timestamp
);

event RedemptionPaused(
    address indexed triggeredBy,
    uint256 indexed timestamp
);
```

---

## 9. Event Correlation Patterns

### 9.1 Cross-Contract Event Linking

**Minting Flow Correlation**:

```javascript
// Link minting events across contracts
const correlatedMintFlow = {
  mintId: "0x123...",
  events: [
    { contract: "QCMinter", event: "QCMintRequested", timestamp: 1000 },
    {
      contract: "BasicMintingPolicy",
      event: "QCBankBalanceCreated",
      timestamp: 1001,
    },
    { contract: "Bank", event: "BalanceIncreased", timestamp: 1002 },
    { contract: "TBTCVault", event: "Minted", timestamp: 1003 },
    { contract: "BasicMintingPolicy", event: "MintCompleted", timestamp: 1004 },
  ],
}
```

**Redemption Lifecycle Correlation**:

```javascript
const redemptionLifecycle = {
  redemptionId: "0x456...",
  phases: {
    request: { event: "RedemptionRequested", timestamp: 2000 },
    burn: { event: "Transfer", amount: "1000000000000000000" },
    fulfillment: {
      event: "RedemptionFulfilled",
      proof: { event: "SPVProofStored", txHash: "0x789..." },
    },
  },
}
```

### 9.2 Actor Analysis Patterns

**Role-Based Activity Tracking**:

```sql
-- Find all actions by a specific watchdog
SELECT event_name, qc_address, timestamp
FROM events
WHERE actor_address = ?
AND actor_role IN ('WATCHDOG_OPERATOR_ROLE', 'ARBITER_ROLE')
ORDER BY timestamp DESC;
```

### 9.3 State Reconstruction Queries

**QC State at Point in Time**:

```sql
-- Reconstruct QC state at specific timestamp
WITH qc_history AS (
    SELECT
        qc_address,
        event_name,
        event_data,
        timestamp,
        ROW_NUMBER() OVER (PARTITION BY event_type ORDER BY timestamp DESC) as rn
    FROM events
    WHERE qc_address = ?
    AND timestamp <= ?
)
SELECT * FROM qc_history WHERE rn = 1;
```

---

## 10. Dashboard Implementation Guide

### 10.1 Core Metrics

**System Health Dashboard**:

- Active QCs count
- Total minted vs total reserves
- Pending redemptions count
- Failed operations in last 24h
- Average processing times

**QC Detail View**:

- Current status and history
- Minting capacity utilization
- Wallet addresses (active/inactive)
- Reserve attestation freshness
- Recent operations

### 10.2 Compliance Reports

**Daily Operations Report**:

```javascript
{
    date: "2025-01-08",
    metrics: {
        totalMinted: "1000.5 tBTC",
        totalRedeemed: "250.3 tBTC",
        activeQCs: 12,
        failedOperations: 3,
        averageRedemptionTime: "4.2 hours"
    },
    alerts: [
        { type: "STALE_ATTESTATION", qc: "0x123...", age: "26 hours" },
        { type: "HIGH_FAILURE_RATE", qc: "0x456...", rate: "15%" }
    ]
}
```

### 10.3 Anomaly Detection

**Patterns to Monitor**:

1. **Unusual Minting Patterns**: Sudden spikes or drops
2. **Attestation Irregularities**: Missed attestations, large balance changes
3. **Redemption Delays**: Approaching timeout thresholds
4. **Role Changes**: Unexpected permission modifications
5. **Failed Operation Clusters**: Multiple failures from same QC

### 10.4 Real-Time Alerts

**Critical Alerts**:

- QC status changed to UnderReview or Revoked
- Redemption default detected
- Emergency pause activated
- Solvency check failure
- Consensus proposal requiring attention

**Warning Alerts**:

- Attestation approaching staleness
- High capacity utilization (>90%)
- Increased failure rate
- Pending redemption >75% timeout

### 10.5 Data Retention Policy

**Retention Requirements**:

- Transaction data: Permanent
- Event logs: Permanent
- Derived metrics: 2 years
- Alert history: 1 year
- Debug logs: 30 days

---

## Appendix: Event Index

Complete list of all events for quick reference:

[Table with all events, their contracts, and primary use cases]

---

## Implementation Checklist

- [ ] Deploy event indexing infrastructure
- [ ] Implement event correlation engine
- [ ] Build dashboard visualization layer
- [ ] Configure real-time alert system
- [ ] Set up compliance report generation
- [ ] Implement data archival strategy
- [ ] Create monitoring runbooks
- [ ] Deploy anomaly detection algorithms
