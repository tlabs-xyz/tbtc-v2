# Oracle Implementation Analysis

**Document Version**: 1.0  
**Date**: 2025-08-05  
**Purpose**: Analyze the need for oracle consensus implementation for reserve attestations  
**Status**: Design Discussion

---

## Current State: Single Trusted Attester

### How It Works Now
```solidity
// QCReserveLedger.sol
function submitReserveAttestation(address qc, uint256 balance) 
    external 
    onlyRole(ATTESTER_ROLE)  // Single trusted entity
{
    reserveAttestations[qc] = ReserveAttestation({
        balance: balance,
        timestamp: block.timestamp,
        attester: msg.sender,
        // ... no consensus, just trust
    });
}
```

### The Trust Problem
1. **Single Point of Failure**: One compromised/malicious attester can lie about reserves
2. **No Verification**: System accepts any balance claim
3. **High Stakes**: Reserve attestations determine minting capacity

---

## Why We Need Oracle Consensus

### The Core Issue
- **Objective Fact**: QC has exactly X BTC in reserves
- **Cannot Verify On-Chain**: No SPV proof for multi-address balances
- **Must Trust Someone**: But trusting one entity is risky

### Oracle Consensus Solution
Instead of trusting one attester, trust the majority of multiple attesters:
```
Attester 1: "QC has 1000 BTC"
Attester 2: "QC has 1000 BTC"
Attester 3: "QC has 999 BTC"
→ Consensus: 1000 BTC (median or majority)
```

---

## Design Options for Oracle Implementation

### Option 1: Simple Majority Consensus

```solidity
contract SimpleReserveOracle {
    struct Attestation {
        uint256 balance;
        uint256 timestamp;
    }
    
    mapping(address => mapping(address => Attestation)) public attestations; // qc => attester => attestation
    mapping(address => address[]) public attestersForQC;
    
    uint256 public constant MIN_ATTESTERS = 3;
    uint256 public constant CONSENSUS_THRESHOLD = 2; // 2 out of 3 must agree
    
    function submitAttestation(address qc, uint256 balance) external onlyRole(ATTESTER_ROLE) {
        attestations[qc][msg.sender] = Attestation({
            balance: balance,
            timestamp: block.timestamp
        });
        
        // Track attesters
        if (!hasAttested[qc][msg.sender]) {
            attestersForQC[qc].push(msg.sender);
            hasAttested[qc][msg.sender] = true;
        }
    }
    
    function getConsensusBalance(address qc) external view returns (uint256 balance, bool hasConsensus) {
        address[] memory attesters = attestersForQC[qc];
        if (attesters.length < MIN_ATTESTERS) return (0, false);
        
        // Count matching attestations
        mapping(uint256 => uint256) memory balanceCounts;
        
        for (uint i = 0; i < attesters.length; i++) {
            uint256 attestedBalance = attestations[qc][attesters[i]].balance;
            balanceCounts[attestedBalance]++;
            
            if (balanceCounts[attestedBalance] >= CONSENSUS_THRESHOLD) {
                return (attestedBalance, true);
            }
        }
        
        return (0, false);
    }
}
```

**Pros**: Simple, clear threshold
**Cons**: Requires exact matches, no tolerance for small differences

### Option 2: Median-Based Consensus

```solidity
contract MedianReserveOracle {
    using SafeMath for uint256;
    
    mapping(address => mapping(address => uint256)) public attestations;
    mapping(address => address[]) public activeAttesters;
    mapping(address => mapping(address => uint256)) public attestationTime;
    
    uint256 public constant MIN_ATTESTERS = 3;
    uint256 public constant MAX_ATTESTERS = 7;
    uint256 public constant ATTESTATION_VALIDITY = 6 hours;
    uint256 public constant DEVIATION_THRESHOLD = 5; // 5% acceptable deviation
    
    function submitAttestation(address qc, uint256 balance) external onlyRole(ATTESTER_ROLE) {
        attestations[qc][msg.sender] = balance;
        attestationTime[qc][msg.sender] = block.timestamp;
        
        _updateActiveAttesters(qc, msg.sender);
    }
    
    function getConsensusBalance(address qc) external view returns (
        uint256 medianBalance,
        uint256 attestersCount,
        bool isReliable
    ) {
        uint256[] memory validBalances = _getValidAttestations(qc);
        attestersCount = validBalances.length;
        
        if (attestersCount < MIN_ATTESTERS) {
            return (0, attestersCount, false);
        }
        
        // Calculate median
        medianBalance = _calculateMedian(validBalances);
        
        // Check deviation from median
        uint256 deviationCount = 0;
        for (uint i = 0; i < validBalances.length; i++) {
            uint256 deviation = _calculateDeviation(validBalances[i], medianBalance);
            if (deviation > DEVIATION_THRESHOLD) {
                deviationCount++;
            }
        }
        
        // Reliable if most attestations are close to median
        isReliable = deviationCount <= (attestersCount / 3);
        
        return (medianBalance, attestersCount, isReliable);
    }
    
    function _calculateMedian(uint256[] memory values) internal pure returns (uint256) {
        // Sort array (bubble sort for simplicity)
        for (uint i = 0; i < values.length - 1; i++) {
            for (uint j = 0; j < values.length - i - 1; j++) {
                if (values[j] > values[j + 1]) {
                    uint256 temp = values[j];
                    values[j] = values[j + 1];
                    values[j + 1] = temp;
                }
            }
        }
        
        // Return median
        if (values.length % 2 == 0) {
            return (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
        } else {
            return values[values.length / 2];
        }
    }
}
```

**Pros**: Tolerates small differences, outlier resistant
**Cons**: More complex, gas intensive

### Option 3: Weighted Consensus (Reputation-Based)

```solidity
contract WeightedReserveOracle {
    struct Attester {
        uint256 reputation;  // 0-1000, based on historical accuracy
        uint256 attestationCount;
        uint256 lastSlash;
    }
    
    mapping(address => Attester) public attesters;
    mapping(address => mapping(address => uint256)) public attestations;
    
    uint256 public constant MIN_TOTAL_WEIGHT = 2000; // Need 2000+ reputation points
    uint256 public constant SLASH_AMOUNT = 100;
    uint256 public constant REPUTATION_RECOVERY = 10; // Per accurate attestation
    
    function submitAttestation(address qc, uint256 balance) external onlyRole(ATTESTER_ROLE) {
        require(attesters[msg.sender].reputation > 0, "Attester banned");
        
        attestations[qc][msg.sender] = balance;
        
        // Could trigger consensus calculation here
        _checkAndUpdateConsensus(qc);
    }
    
    function getWeightedConsensus(address qc) external view returns (uint256 balance, uint256 totalWeight) {
        // Calculate weighted average based on reputation
        uint256 weightedSum = 0;
        totalWeight = 0;
        
        address[] memory allAttesters = getAttesters();
        
        for (uint i = 0; i < allAttesters.length; i++) {
            address attester = allAttesters[i];
            uint256 attestedBalance = attestations[qc][attester];
            
            if (attestedBalance > 0 && _isRecent(qc, attester)) {
                uint256 weight = attesters[attester].reputation;
                weightedSum += attestedBalance * weight;
                totalWeight += weight;
            }
        }
        
        require(totalWeight >= MIN_TOTAL_WEIGHT, "Insufficient attestation weight");
        
        balance = weightedSum / totalWeight;
    }
    
    function slashAttester(address attester, address qc) external onlyRole(GOVERNANCE_ROLE) {
        // Called if attester proven wrong
        attesters[attester].reputation = attesters[attester].reputation.sub(SLASH_AMOUNT);
        attesters[attester].lastSlash = block.timestamp;
        
        emit AttesterSlashed(attester, qc, SLASH_AMOUNT);
    }
}
```

**Pros**: Incentivizes accuracy, self-improving
**Cons**: Complex reputation management, bootstrap problem

---

## Integration with Existing System

### Current QCReserveLedger Modification

```solidity
contract QCReserveLedger {
    IReserveOracle public reserveOracle;
    
    // Keep direct attestation for backward compatibility
    function submitReserveAttestation(address qc, uint256 balance) external onlyRole(ATTESTER_ROLE) {
        // Forward to oracle
        reserveOracle.submitAttestation(qc, balance);
        
        // Emit event for monitoring
        emit ReserveAttestationSubmitted(msg.sender, qc, balance, oldBalance, block.timestamp, block.number);
    }
    
    // New function to get consensus balance
    function getReserveBalanceWithConsensus(address qc) external view returns (
        uint256 balance,
        bool hasConsensus,
        uint256 attestersCount
    ) {
        return reserveOracle.getConsensusBalance(qc);
    }
    
    // Override the main getter to use consensus
    function getReserveBalanceAndStaleness(address qc) external view returns (uint256 balance, bool isStale) {
        (balance, bool hasConsensus,) = reserveOracle.getConsensusBalance(qc);
        
        if (!hasConsensus) {
            return (0, true); // No consensus = stale
        }
        
        // Check staleness based on attestation times
        isStale = reserveOracle.isAttestationStale(qc);
    }
}
```

---

## Implementation Considerations

### 1. Attester Set Management
- **Fixed Set**: Hardcode 5-7 trusted attesters
- **Dynamic Set**: DAO can add/remove attesters
- **Permissionless**: Anyone can attest, weight by stake

### 2. Consensus Parameters
- **Minimum Attesters**: 3? 5? 7?
- **Agreement Threshold**: Simple majority? Supermajority?
- **Staleness Period**: How old before invalid?

### 3. Incentive Design
- **Rewards**: Pay for accurate attestations?
- **Penalties**: Slash for proven lies?
- **Gas Costs**: Who pays for attestations?

### 4. Migration Path
```
Phase 1: Deploy oracle alongside existing system
Phase 2: Attesters submit to both systems
Phase 3: Start reading from oracle
Phase 4: Deprecate single attester
```

---

## Recommendation

### Start Simple: Median-Based Oracle

1. **Why Median**:
   - Handles small discrepancies naturally
   - Resistant to outliers
   - No complex reputation system needed

2. **Parameters**:
   - 5 attesters minimum
   - 3+ must submit for consensus
   - 6-hour attestation validity
   - 5% deviation tolerance

3. **Implementation Steps**:
   - Deploy MedianReserveOracle
   - Grant ATTESTER_ROLE to 5-7 entities
   - Update QCReserveLedger to read from oracle
   - Monitor for 1 month before enforcing

---

## Questions for Discussion

1. **Attester Selection**: Who should be attesters? Keep Foundation's SingleWatchdog?
2. **Consensus Threshold**: Is 3/5 sufficient? Need 4/5?
3. **Deviation Handling**: What if attestations vary widely?
4. **Emergency Fallback**: What if no consensus achieved?
5. **Upgrade Path**: How to transition without disruption?

---

## Conclusion

The oracle implementation fills a critical trust gap in the current system. By requiring multiple attesters to agree on reserve balances, we:
- Remove single point of failure
- Maintain objectivity through consensus
- Enable permissionless computation on trusted data
- Align with the overall watchdog philosophy

The median-based approach provides a good balance of simplicity and robustness for initial implementation.