# Watchdog Operations Classification

**Purpose**: Clear classification of which operations need what level of authority

---

## Operation Categories

### Category 1: Data Submission (No Authority Needed)

These operations just submit data. Multiple conflicting submissions are fine.

| Operation | Current Implementation | Authority Model | Why It Works |
|-----------|----------------------|-----------------|---------------|
| Reserve Attestation | `attestReserves(qc, balance)` | Independent | Each watchdog's view is valid data |
| Concern Reporting | `raiseConcern(...)` | Independent | Multiple perspectives welcome |
| Statistics Updates | `updateStats(...)` | Independent | More data = better |

**Consensus Needed**: ❌ None  
**Monitoring Value**: ✅ High (patterns emerge)

### Category 2: Cryptographically Verifiable (Proof is Authority)

These operations include mathematical proof. The proof itself provides authority.

| Operation | Current Implementation | Authority Model | Why It Works |
|-----------|----------------------|-----------------|---------------|
| Wallet Registration | `registerWalletWithProof(...)` | SPV Proof | Can't fake Bitcoin ownership |
| Redemption Fulfillment | `recordRedemptionFulfillment(...)` | SPV Proof | Payment proof is binary |
| Block Header Validation | `validateBlockHeader(...)` | Merkle Proof | Math doesn't lie |

**Consensus Needed**: ❌ None (proof is consensus)  
**Monitoring Value**: ⚠️ Medium (catch implementation bugs)

### Category 3: Status & State Changes (Decision Authority Required)

These operations change system state based on judgment. Someone must decide.

| Operation | Current Implementation | Authority Model | Why Monitoring Fails |
|-----------|----------------------|-----------------|----------------------|
| QC Status Change | `setQCStatus(qc, status)` | ??? | Who decides? |
| Pause QC Operations | `pauseQC(qc)` | ??? | Who has power? |
| Wallet Deregistration | `deregisterWallet(...)` | ??? | Who can remove? |
| Capacity Adjustment | `adjustCapacity(...)` | ??? | Who sets limits? |

**Consensus Needed**: ✅ Yes (2-of-N minimum)  
**Monitoring Value**: ✅ High (but not sufficient)

### Category 4: Emergency Response (Automatic Authority)

These operations must happen fast. Waiting for consensus = system damage.

| Operation | Trigger | Authority Model | Implementation |
|-----------|---------|-----------------|----------------|
| Emergency Pause | 3+ critical reports | Automatic | Circuit breaker |
| Redemption Timeout | Time elapsed | Automatic | Smart contract |
| Staleness Flag | Time elapsed | Automatic | Smart contract |

**Consensus Needed**: ❌ None (threshold/time based)  
**Monitoring Value**: ✅ High (triggers the automatic response)

## Decision Tree

```
Is this operation submitting data only?
├─ YES → Independent execution
└─ NO → Does it include cryptographic proof?
    ├─ YES → Proof is authority
    └─ NO → Does it change system state?
        ├─ YES → Is it emergency/time-critical?
        │   ├─ YES → Automatic trigger
        │   └─ NO → Needs consensus (2-of-N)
        └─ NO → Independent execution
```

## Authority Requirements by Severity

### 🟢 Low Severity - Independent
- Reserve attestations
- Concern reporting  
- Statistics/monitoring
- **Rule**: No consensus needed

### 🟡 Medium Severity - Proof-Based
- Wallet registration
- Redemption fulfillment
- **Rule**: Valid proof = automatic execution

### 🟠 High Severity - Consensus Required  
- Status changes (Active → UnderReview)
- Non-emergency pauses
- **Rule**: 2-of-N watchdogs must agree

### 🔴 Critical Severity - Automatic Action
- Emergency pause
- Fraud response
- **Rule**: Threshold triggers immediate action

## Implementation Recommendations

### For Independent Operations (Category 1)
```solidity
// No changes needed to SingleWatchdog
function attestReserves(address qc, uint256 balance) external {
    reserveLedger.submitAttestation(qc, balance);
    // That's it. No consensus.
}
```

### For Proof-Based Operations (Category 2)
```solidity
// Current implementation is fine
function registerWalletWithProof(..., bytes proof) external {
    require(verifySPVProof(proof), "Invalid proof");
    qcManager.registerWallet(...);
    // Proof provides authority
}
```

### For State Changes (Category 3)
```solidity
// Need new QCStatusManager
contract QCStatusManager {
    function proposeStatusChange(address qc, Status newStatus) external {
        // Requires 2-of-N agreement
        if (votes[proposalId] >= 2) {
            executeStatusChange(qc, newStatus);
        }
    }
}
```

### For Emergency Response (Category 4)
```solidity
// Need new EmergencyPause
contract EmergencyPause {
    function reportCritical(address qc) external {
        if (recentReports[qc].length >= 3) {
            systemState.emergencyPause(qc); // Automatic
        }
    }
}
```

## Summary

| Category | Operations | Authority Source | Implementation |
|----------|------------|------------------|----------------|
| Data Submission | Attestations, Concerns | None needed | SingleWatchdog |
| Proof-Based | Wallet reg, Redemptions | Cryptographic proof | SingleWatchdog |
| State Changes | Status, Pauses | 2-of-N consensus | QCStatusManager |
| Emergency | Critical issues | Automatic threshold | EmergencyPause |

**Key Principle**: Match the authority model to the operation's requirements, not the other way around.