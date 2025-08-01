# Watchdog Consensus Models: Visual Comparison

## Quick Decision Tree

```
What type of operation?
│
├─> High Value (>$1M)?
│   └─> Use MAJORITY VOTING (safe but slow)
│
├─> Easily Reversible?
│   └─> Use OPTIMISTIC (fast but needs proofs)
│
├─> Critical Security?
│   └─> Use MAJORITY VOTING (predictable)
│
└─> Routine Operation?
    └─> Use OPTIMISTIC (efficient)
```

## Model Comparison Chart

| Aspect | Simple Majority | Optimistic (No Proofs) | Optimistic (With Proofs) | Hybrid |
|--------|----------------|------------------------|-------------------------|---------|
| **Implementation** | 300 lines ✅ | 400 lines ✅ | 1500+ lines ❌ | 800+ lines ⚠️ |
| **Gas Cost** | ~150k | ~100k | ~300k+ | Variable |
| **Time to Finality** | Fixed 2h | 15m-24h | 15m-24h | 15m-2h |
| **Watchdogs Needed** | N/2+1 | 1 | 1 | 1 to N/2+1 |
| **Security Model** | Social/Legal | Trust | Cryptographic | Mixed |
| **Complexity** | Low ✅ | Medium ⚠️ | High ❌ | High ❌ |
| **Operational Cost** | High | Low | Low | Medium |

## Execution Flow Comparison

### Simple Majority Voting
```
Submit ──> Wait 2h ──> Count Votes ──> Execute/Reject
                         │
                    (Need N/2+1)
```

### Optimistic Without Proofs
```
Submit ──> Wait 15m ──┬─> No Objection ──> Execute
                      │
                      └─> Objection ──> Escalate ──> Vote/Reject
```

### Optimistic With Fraud Proofs
```
Submit ──> Wait 15m ──┬─> No Challenge ──> Execute
                      │
                      └─> Challenge ──> Verify Proof ──┬─> Valid ──> Reject + Slash
                                                       │
                                                       └─> Invalid ──> Execute
```

## Security Comparison

### Attack Vectors

**Simple Majority:**
- ❌ N/2+1 watchdogs collude
- ✅ No complex attack vectors
- ✅ No timing attacks
- ✅ No proof manipulation

**Optimistic (No Proofs):**
- ❌ Single bad watchdog (until caught)
- ❌ Censorship of objections
- ❌ Social engineering
- ✅ Eventually consistent

**Optimistic (With Proofs):**
- ✅ Cryptographically secure
- ❌ Proof verification bugs
- ❌ Data availability attacks
- ❌ Miner censorship of proofs

## Cost Analysis

### Per Operation Costs

```
Simple Majority (5 watchdogs):
- Submit: 50k gas ($5)
- 5 Votes: 5 × 65k gas ($32.50)
- Execute: 100k gas ($10)
- Total: ~$47.50 per operation

Optimistic (Happy Path):
- Submit: 50k gas ($5)
- Execute: 100k gas ($10)
- Total: ~$15 per operation

Optimistic (Disputed with Proof):
- Submit: 50k gas ($5)
- Challenge: 300k gas ($30)
- Verify: 400k gas ($40)
- Total: ~$75 per operation
```

## Real-World Scenarios

### Scenario 1: Daily Reserve Attestations
```
100 QCs × 365 days = 36,500 operations/year

Simple Majority: 36,500 × $47.50 = $1,733,750/year
Optimistic: 36,500 × $15 = $547,500/year
Savings: $1,186,250/year
```

### Scenario 2: Malicious Watchdog Attack
```
Simple Majority:
- Need to corrupt 3/5 watchdogs
- Cost: 3 × (reputation + legal liability)
- Detection: Immediate (on-chain votes)

Optimistic (No Proofs):
- Need to corrupt 1 watchdog
- Cost: 1 × (reputation + legal liability)
- Detection: Within challenge period

Optimistic (With Proofs):
- Need to corrupt 1 watchdog
- Cost: 1 × (bond + reputation + legal liability)
- Detection: Immediate with valid proof
```

## Recommendation by Use Case

### Use Simple Majority When:
- 🏦 Handling institutional money
- ⚖️ Legal compliance is critical
- 🔒 Security > Efficiency
- 👥 Have reliable watchdog set
- 💰 Operations are high-value

### Use Optimistic When:
- 🚀 Speed is critical
- 💸 High transaction volume
- 🤖 Operations are verifiable
- 🔄 Reversal is possible
- 📊 Cost optimization matters

### Consider Hybrid When:
- 🎯 Different operation types
- 📈 Scaling is planned
- 🔀 Flexibility needed
- 👁️ Monitoring is strong
- 🏗️ Can handle complexity

## The "Goldilocks" Solution

For tBTC V1.1 with legally accountable watchdogs:

```solidity
contract GoldilocksConsensus {
    // Start with simple majority for everything
    uint256 constant THRESHOLD = 1_000_000e18; // $1M
    
    function determineConsensusType(uint256 value) {
        if (value < THRESHOLD && isRoutineOperation()) {
            // Future: Add optimistic path here
            return ConsensuType.MAJORITY; // For now
        }
        return ConsensuType.MAJORITY;
    }
}
```

**Why this works:**
1. ✅ Simple to start (ship V1.1)
2. ✅ Secure by default 
3. ✅ Can add optimistic later
4. ✅ No over-engineering
5. ✅ Clear upgrade path