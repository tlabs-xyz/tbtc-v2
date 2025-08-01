# Audit: Which Watchdog Operations Actually Need Consensus?

**Question**: Are status changes the only operations requiring consensus?

---

## Complete Operation Inventory

Let me go through EVERY operation a watchdog can perform:

### 1. Reserve Attestations
```solidity
function attestReserves(address qc, uint256 balance)
```
**Needs Consensus?** ❌ NO
- Multiple different values are fine
- Pattern analysis reveals truth
- Each attestation is valid data

### 2. Wallet Registration
```solidity
function registerWalletWithProof(address qc, string btcAddress, bytes spvProof)
```
**Needs Consensus?** ❌ NO
- SPV proof is deterministic
- Either valid or not
- BUT... what if QC already at wallet limit?

**🤔 WAIT**: Should multiple watchdogs agree before adding wallet #10 to a QC?

### 3. Wallet Deregistration
```solidity
function deregisterWallet(address qc, string btcAddress)
```
**Needs Consensus?** ✅ YES
- This is a critical decision
- Removes QC's ability to use wallet
- Could be abused by single malicious watchdog

**Found one!**

### 4. Redemption Fulfillment Recording
```solidity
function recordRedemptionFulfillment(bytes32 redemptionId, ..., bytes spvProof)
```
**Needs Consensus?** ❌ NO
- SPV proof shows payment happened
- Binary fact

### 5. Flag Redemption as Defaulted
```solidity
function flagRedemptionDefault(bytes32 redemptionId, bytes32 reason)
```
**Needs Consensus?** 🤔 MAYBE
- This triggers penalties for QC
- Single watchdog could grief
- But if timeout is objective...

**Depends on implementation**

### 6. QC Status Changes
```solidity
function setQCStatus(address qc, QCStatus newStatus, bytes32 reason)
```
**Needs Consensus?** ✅ YES (Already identified)

### 7. Emergency QC Pause
```solidity
function emergencyPauseQC(address qc)
```
**Needs Consensus?** ❌ NO (if using threshold)
- 3 reports = automatic
- Speed critical

### 8. Capacity Adjustments
```solidity
function adjustMintingCapacity(address qc, uint256 newCapacity)
```
**Current System**: This is a DAO/Governance function
**But if watchdogs did it**: ✅ Would need consensus

### 9. Force Redemption Processing
```solidity
function forceProcessRedemption(bytes32 redemptionId)
```
**If this existed**: ✅ Would need consensus
- Forces QC to act
- Significant intervention

### 10. Strategic Attestation
```solidity
function strategicAttestation(address qc, uint256 balance, string condition)
```
**Needs Consensus?** ❌ NO
- It's just a special attestation
- Monitoring handles discrepancies

## New Operations We Discovered Need Consensus

### 1. Wallet Deregistration ✅
**Why**: Removes QC capability, could be abused
```solidity
// Needs consensus to prevent single watchdog griefing
function proposeWalletDeregistration(address qc, string btcAddress, bytes32 reason)
```

### 2. Redemption Default Flagging ✅ (If it has penalties)
**Why**: Triggers penalties, affects QC reputation
```solidity
// If defaulting has consequences, needs consensus
function proposeRedemptionDefault(bytes32 redemptionId, bytes32 reason)
```

### 3. Manual Intervention Operations ✅
**Why**: Override normal flow, significant power
```solidity
// Any "force" operations would need consensus
function proposeForceAction(ActionType action, bytes data)
```

## Operations That Definitely DON'T Need Consensus

### Data/Monitoring Operations
- Reserve attestations
- Concern reporting
- Statistics updates

### Proof-Based Operations
- Wallet registration (with SPV)
- Redemption fulfillment (with SPV)
- Any Bitcoin proof verification

### Automatic/Threshold Operations
- Emergency pause (3 reports = auto)
- Timeout handlers
- Staleness flags

## Revised Consensus Needs

```solidity
contract WatchdogConsensusOperations {
    enum OperationType {
        STATUS_CHANGE,           // QC status changes
        WALLET_DEREGISTRATION,   // Remove wallet from QC
        REDEMPTION_DEFAULT,      // Flag redemption as defaulted
        FORCE_INTERVENTION       // Any manual override
    }
    
    // All need 2-of-N consensus
}
```

## The Pattern We See

**Operations need consensus when they**:
1. ❌ Remove capabilities (deregister wallet)
2. ❌ Impose penalties (flag default)
3. ❌ Change operational status
4. ❌ Override normal flow

**Operations DON'T need consensus when they**:
1. ✅ Add data (attestations)
2. ✅ Have cryptographic proof
3. ✅ Are time/threshold triggered
4. ✅ Are additive, not restrictive

## Updated Recommendation

### Expand QCStatusManager to Handle All Consensus Operations

```solidity
contract WatchdogConsensusManager {  // Renamed for clarity
    
    enum ProposalType {
        STATUS_CHANGE,
        WALLET_DEREGISTRATION,
        REDEMPTION_DEFAULT,
        FORCE_INTERVENTION
    }
    
    struct Proposal {
        ProposalType proposalType;
        bytes data;  // Encoded parameters
        address proposer;
        uint256 votes;
        uint256 timestamp;
        bool executed;
    }
    
    function propose(ProposalType pType, bytes calldata data) external {
        // Same 2-of-N voting mechanism
        // Different execution based on type
    }
}
```

## Conclusion

**No, status changes are NOT the only operations needing consensus.**

We also need consensus for:
1. Wallet deregistration
2. Redemption default flagging (if it has penalties)
3. Any force/manual intervention operations

The good news: These are all rare operations. The voting mechanism stays simple (2-of-N), just handles a few more operation types.

**Still ~90% of operations remain independent, but we need consensus for ~10% that involve removing capabilities or imposing penalties.**