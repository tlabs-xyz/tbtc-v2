# Oracle Design Decision: Oracle + Slim Ledger Architecture

**Document Version**: 1.0  
**Date**: 2025-08-05  
**Purpose**: Document the architectural decision for reserve attestation oracle implementation  
**Status**: Design Decision

---

## Decision Summary

We will implement a **two-component architecture**:
1. **ReserveOracle**: Handles multi-attester consensus
2. **QCReserveLedger**: Stores consensus results and maintains history

Since the system is not yet deployed, this is the initial design, not a migration.

---

## Architecture Overview

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│   Attester 1        │     │   Attester 2        │     │   Attester 3-N      │
└──────────┬──────────┘     └──────────┬──────────┘     └──────────┬──────────┘
           │                           │                           │
           │ submitAttestation()       │                           │
           ▼                           ▼                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ReserveOracle                                     │
│  - Receives multiple attestations                                           │
│  - Calculates consensus (median)                                            │
│  - Validates freshness                                                      │
│  - No permanent storage                                                     │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      │ pushConsensusAttestation()
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          QCReserveLedger                                    │
│  - Stores consensus values only                                             │
│  - Maintains attestation history                                            │
│  - Provides staleness checking                                              │
│  - Handles invalidations                                                    │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      │ getReserveBalanceAndStaleness()
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Consumers (QCManager, Enforcement)                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Design Motivation

### Why Two Components Instead of One?

1. **Separation of Concerns**
   - Oracle solves the trust/consensus problem
   - Ledger solves the storage/history problem
   - Each component remains focused and simple

2. **Audit Trail Requirements**
   - Regulatory compliance requires permanent history
   - Need immutable record of all balance changes
   - Ledger optimized for efficient historical queries

3. **Architectural Flexibility**
   - Oracle consensus algorithm can evolve
   - Storage patterns can be optimized independently
   - Clean interfaces between components

### Why Not Just an Oracle?

1. **Storage Complexity**
   - Oracle would need to maintain full history
   - Would conflate consensus with storage
   - Makes oracle unnecessarily complex

2. **Interface Design**
   - Ledger provides clean, stable interface to consumers
   - Oracle internals hidden from rest of system
   - Single source of truth for accepted values

---

## Component Responsibilities

### ReserveOracle
**Purpose**: Transform untrusted individual attestations into trusted consensus values

**Responsibilities**:
- Accept attestations from multiple ATTESTER_ROLE holders
- Calculate median of recent attestations
- Determine when consensus is achieved
- Push consensus values to ledger

**What it does NOT do**:
- Store historical data
- Manage QC metadata
- Handle invalidations
- Provide consumer interfaces

### QCReserveLedger
**Purpose**: Store consensus values and provide system interface

**Responsibilities**:
- Store only consensus-validated attestations
- Maintain immutable history for audit
- Calculate staleness based on SystemState
- Handle admin invalidations
- Provide standard interface to consumers

**What it does NOT do**:
- Accept individual attestations
- Calculate consensus
- Manage attester credibility

---

## Key Design Principles

### 1. No Individual Attestations in Ledger
The ledger only stores values that have achieved consensus. This makes the trust model explicit - the ledger contains trusted data, not proposals.

### 2. Oracle as Pure Function
The oracle ideally maintains minimal state - just enough to calculate consensus. Once consensus is achieved, the value is pushed to permanent storage.

### 3. Clear Trust Boundary
```
Untrusted Zone          Trust Boundary          Trusted Zone
━━━━━━━━━━━━━━         ━━━━━━━━━━━━━━         ━━━━━━━━━━━━
Individual      →      Oracle         →        Ledger
Attestations           Consensus                Storage
```

---

## Implementation Approach

### ReserveOracle Contract

```solidity
contract ReserveOracle {
    struct Attestation {
        uint256 balance;
        uint256 timestamp;
    }
    
    // Temporary storage for consensus calculation
    mapping(address => mapping(address => Attestation)) public attestations;
    mapping(address => address[]) public attestersForQC;
    
    IQCReserveLedger public immutable reserveLedger;
    
    uint256 public constant MIN_ATTESTERS = 3;
    uint256 public constant CONSENSUS_WINDOW = 6 hours;
    uint256 public constant MAX_DEVIATION = 5; // 5% acceptable deviation
    
    event AttestationSubmitted(address indexed qc, address indexed attester, uint256 balance);
    event ConsensusAchieved(address indexed qc, uint256 consensusBalance, uint256 attesterCount);
    
    function submitAttestation(address qc, uint256 balance) external onlyRole(ATTESTER_ROLE) {
        attestations[qc][msg.sender] = Attestation({
            balance: balance,
            timestamp: block.timestamp
        });
        
        // Track attesters
        _trackAttester(qc, msg.sender);
        
        emit AttestationSubmitted(qc, msg.sender, balance);
        
        // Try to achieve consensus
        _checkConsensus(qc);
    }
    
    function _checkConsensus(address qc) internal {
        uint256[] memory validBalances = _getRecentAttestations(qc);
        
        if (validBalances.length >= MIN_ATTESTERS) {
            uint256 medianBalance = _calculateMedian(validBalances);
            
            // Verify attestations cluster around median
            if (_isConsensusReliable(validBalances, medianBalance)) {
                // Push to ledger
                reserveLedger.recordConsensusAttestation(qc, medianBalance, validBalances.length);
                
                emit ConsensusAchieved(qc, medianBalance, validBalances.length);
                
                // Clear attestations for this QC
                _clearAttestations(qc);
            }
        }
    }
}
```

### QCReserveLedger Contract

```solidity
contract QCReserveLedger is AccessControl {
    // Only oracle can submit
    address public immutable reserveOracle;
    
    struct ReserveAttestation {
        uint256 balance;
        uint256 timestamp;
        uint256 blockNumber;
        uint256 attesterCount; // How many attesters agreed
        bool isValid;
    }
    
    mapping(address => ReserveAttestation) public reserveAttestations;
    mapping(address => ReserveAttestation[]) public attestationHistory;
    
    modifier onlyOracle() {
        require(msg.sender == reserveOracle, "Only oracle");
        _;
    }
    
    function recordConsensusAttestation(
        address qc, 
        uint256 balance,
        uint256 attesterCount
    ) external onlyOracle {
        uint256 oldBalance = reserveAttestations[qc].balance;
        
        ReserveAttestation memory newAttestation = ReserveAttestation({
            balance: balance,
            timestamp: block.timestamp,
            blockNumber: block.number,
            attesterCount: attesterCount,
            isValid: true
        });
        
        reserveAttestations[qc] = newAttestation;
        attestationHistory[qc].push(newAttestation);
        
        emit ReserveAttestationSubmitted(
            reserveOracle, // Always from oracle
            qc,
            balance,
            oldBalance,
            block.timestamp,
            block.number
        );
    }
    
    // Consumer interface remains clean and simple
    function getReserveBalanceAndStaleness(address qc) 
        external 
        view 
        returns (uint256 balance, bool isStale) 
    {
        ReserveAttestation memory attestation = reserveAttestations[qc];
        
        if (!attestation.isValid || attestation.timestamp == 0) {
            return (0, true);
        }
        
        uint256 staleThreshold = SystemState(
            protocolRegistry.getService(SYSTEM_STATE_KEY)
        ).staleThreshold();
        
        isStale = block.timestamp > attestation.timestamp + staleThreshold;
        balance = attestation.balance;
    }
}
```

---

## Benefits of This Design

### 1. Explicit Trust Model
- Only consensus values enter the ledger
- No ambiguity about data validity
- Clear separation between proposals and facts

### 2. Clean Architecture
- Each component has single responsibility
- Minimal coupling between components
- Easy to reason about

### 3. Flexibility
- Can experiment with different consensus algorithms
- Can optimize storage independently
- Can add features without touching both components

### 4. Auditability
- Clear record of consensus events
- Immutable history maintained
- Attester count recorded

### 5. Simplicity
- Oracle doesn't deal with history
- Ledger doesn't deal with consensus
- Consumers have simple interface

---

## Implementation Considerations

### Consensus Parameters
- **Minimum Attesters**: 3 (prevents 2-party collusion)
- **Consensus Window**: 6 hours (fresh attestations only)
- **Deviation Tolerance**: 5% (handles minor discrepancies)

### Attester Management
- 5-7 independent attesters recommended
- Odd number prevents tied votes
- DAO can add/remove attesters

### Edge Cases
- **No Consensus**: Keep trying with new attestations
- **Stale Data**: Consumers see isStale = true
- **Malicious Attesters**: Median resistant to outliers

---

## Conclusion

The Oracle + Ledger design provides the right separation of concerns for the reserve attestation system. By clearly separating consensus from storage, we create a system that is:

- **Correct**: Only consensus values are trusted
- **Simple**: Each component has one job
- **Flexible**: Components can evolve independently
- **Auditable**: Complete history maintained

This architecture solves the trust problem while maintaining practical benefits like audit trails and clean interfaces.