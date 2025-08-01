# Watchdog Consensus Threshold Analysis: Why 2-of-N vs M-of-N?

**Question**: Should we use fixed 2-of-N or configurable M-of-N for consensus?

---

## Current Landscape

### How Many Watchdogs?
Realistic deployment scenarios:
- **Minimum viable**: 3 watchdogs (different organizations)
- **Typical**: 5-7 watchdogs
- **Maximum practical**: 9-11 watchdogs (coordination overhead)

### What Are We Protecting Against?

1. **Single malicious watchdog** - Griefing attacks
2. **Accidental mistakes** - Human error
3. **Compromised watchdog** - Hacked systems
4. **Lazy consensus** - Everyone agreeing without verification

## Analyzing Different Thresholds

### Scenario: 5 Total Watchdogs

| Threshold | Formula | Votes Needed | Analysis |
|-----------|---------|--------------|-----------|
| 2-of-5 | Fixed 2 | 2 | ✅ Fast, ⚠️ Maybe too easy |
| 3-of-5 | Majority | 3 | ✅ Balanced |
| 4-of-5 | Supermajority | 4 | ⚠️ One offline = stuck |

### Scenario: 3 Total Watchdogs (Minimum)

| Threshold | Formula | Votes Needed | Analysis |
|-----------|---------|--------------|-----------|
| 2-of-3 | Fixed 2 or Majority | 2 | ✅ Only viable option |
| 3-of-3 | Unanimous | 3 | ❌ Too fragile |

### Scenario: 9 Total Watchdogs (Large)

| Threshold | Formula | Votes Needed | Analysis |
|-----------|---------|--------------|-----------|
| 2-of-9 | Fixed 2 | 2 | ❌ Too easy to collude |
| 5-of-9 | Majority | 5 | ✅ Good security |
| 7-of-9 | Supermajority | 7 | ⚠️ Hard to coordinate |

## The Problem with Fixed 2-of-N

```
With 3 watchdogs: 2-of-3 = 67% (reasonable)
With 5 watchdogs: 2-of-5 = 40% (maybe ok)
With 9 watchdogs: 2-of-9 = 22% (too low!)
```

**As N grows, fixed 2 becomes less secure**

## Better Approach: Configurable M-of-N

### Option 1: Simple Majority (N/2 + 1)
```solidity
uint256 public function getRequiredVotes() view returns (uint256) {
    return (activeWatchdogs.length / 2) + 1;
}
```
- 3 watchdogs → 2 required
- 5 watchdogs → 3 required
- 9 watchdogs → 5 required

**Pros**: Scales naturally, always >50%  
**Cons**: Odd/even differences

### Option 2: Configurable with Bounds
```solidity
uint256 public minVotes = 2;      // Never less than 2
uint256 public votesPercent = 51; // Requiring 51%

function getRequiredVotes() view returns (uint256) {
    uint256 calculated = (activeWatchdogs.length * votesPercent) / 100;
    return calculated > minVotes ? calculated : minVotes;
}
```

### Option 3: Tiered by Operation Severity
```solidity
function getRequiredVotes(OperationType opType) view returns (uint256) {
    if (opType == OperationType.STATUS_CHANGE) {
        return (activeWatchdogs.length / 2) + 1;  // Majority
    } else if (opType == OperationType.WALLET_DEREGISTRATION) {
        return (activeWatchdogs.length * 2) / 3;  // 67%
    } else if (opType == OperationType.EMERGENCY_ACTION) {
        return 2;  // Fast response needed
    }
}
```

## Real-World Considerations

### 1. Watchdog Availability
- Not all watchdogs online 24/7
- Maintenance windows
- Geographic distribution
- **Impact**: Too high threshold = operations stuck

### 2. Coordination Cost
- Each additional vote requires coordination
- Time zone differences
- Communication overhead
- **Impact**: Higher threshold = slower response

### 3. Security vs Efficiency
```
Low threshold (2-of-N):
+ Fast execution
+ High availability
- Easier to attack
- Less consensus

High threshold (67%+):
+ More secure
+ True consensus
- Slower execution
- Availability risk
```

## Recommendation: Adaptive M-of-N

```solidity
contract WatchdogConsensusManager {
    uint256 public constant MIN_VOTES = 2;        // Floor
    uint256 public constant MAX_VOTES = 5;        // Ceiling
    uint256 public votingThresholdPercent = 51;   // Configurable
    
    function getRequiredVotes() public view returns (uint256) {
        uint256 total = getActiveWatchdogCount();
        uint256 required = (total * votingThresholdPercent) / 100;
        
        // Bounds checking
        if (required < MIN_VOTES) return MIN_VOTES;
        if (required > MAX_VOTES) return MAX_VOTES;
        return required;
    }
    
    // DAO can adjust threshold
    function setVotingThreshold(uint256 newPercent) external onlyRole(DAO_ROLE) {
        require(newPercent >= 34 && newPercent <= 67, "Reasonable bounds");
        votingThresholdPercent = newPercent;
    }
}
```

### Why This Works

1. **Scales Properly**
   - 3 watchdogs: 2 required (67%)
   - 5 watchdogs: 3 required (51%)
   - 9 watchdogs: 5 required (51%, capped)

2. **Flexibility**
   - DAO can adjust based on experience
   - Different operations could have different thresholds
   - Emergency lower, critical higher

3. **Practical Bounds**
   - MIN_VOTES = 2 (prevent single watchdog)
   - MAX_VOTES = 5 (prevent coordination paralysis)

## Different Thresholds for Different Operations?

```solidity
mapping(OperationType => uint256) public thresholdPercents;

constructor() {
    thresholdPercents[OperationType.STATUS_CHANGE] = 51;           // Majority
    thresholdPercents[OperationType.WALLET_DEREGISTRATION] = 67;   // Supermajority
    thresholdPercents[OperationType.EMERGENCY_PAUSE] = 34;         // Fast action
}
```

## Final Answer

**Why not fixed 2-of-N?** Because it doesn't scale with the number of watchdogs.

**Recommended approach**: 
- Simple majority (N/2 + 1) as default
- With bounds (min: 2, max: 5)
- Configurable by DAO
- Potentially different for different operations

This gives us:
- Security that scales with watchdog count
- Practical limits to prevent paralysis
- Flexibility to adjust based on experience
- Still simple to understand and implement

**The magic number isn't 2, it's "enough to prevent single-actor attacks while maintaining operational efficiency."**