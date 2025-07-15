# Watchdog Primary Rotation Mechanism - Future Enhancement Option

**Document Version**: 1.0  
**Date**: 2025-01-15  
**Status**: Future Enhancement Design (v2.0 Consideration)  
**Purpose**: Document potential rotation mechanism for future implementation if needed  
**Related Documents**: [watchdog-decentralization.md](watchdog-decentralization.md)

---

## Executive Summary

This document outlines a potential **Hybrid Block-based Rotation with Failover** mechanism that could be implemented in a future version if operational experience indicates the need for additional security measures beyond the current per-operation primary selection with randomness.

**Note**: This is NOT planned for initial implementation. The v1 system uses simple per-operation primary selection with block hash randomness, which may be sufficient. This document serves as a reference for potential v2 enhancements.

**When to Consider Implementation**:
- If v1 operational data shows primary selection gaming
- If legal framework proves insufficient deterrent
- If challenge mechanism is frequently triggered
- If stakeholder feedback indicates need for additional security

---

## Problem Statement

The current optimistic watchdog design uses deterministic primary validator selection per operation:
```solidity
uint256 index = (qcSeed ^ opSeed ^ blockSeed) % watchdogCount;
```

**Security Issues**:
1. Creates temporary single points of failure
2. Predictable selection enables timing attacks
3. No automatic failover for unresponsive primaries
4. Potential for gaming the selection algorithm

---

## Proposed Solution: Hybrid Rotation

### Core Design Principles

1. **Time-windowed Rotation**: Fixed 10-minute windows (50 blocks)
2. **Cryptographic Randomness**: Unpredictable selection within windows
3. **Reputation-based Filtering**: Only high-performing watchdogs can be primary
4. **Automatic Failover**: System continues with next eligible watchdog
5. **Emergency Override**: Rapid response to compromised primaries

### Rotation Algorithm

```solidity
contract RotatingPrimaryWatchdog {
    // Configuration
    uint256 public constant ROTATION_PERIOD = 50; // blocks (~10 minutes)
    uint256 public constant RESPONSE_TIMEOUT = 300; // seconds (5 minutes)
    uint256 public constant MIN_REPUTATION_SCORE = 80; // out of 100
    uint256 public constant MAX_CONSECUTIVE_FAILURES = 3;
    
    // State
    uint256 public lastRotationBlock;
    mapping(address => WatchdogMetrics) public watchdogMetrics;
    
    struct WatchdogMetrics {
        uint256 reputationScore;    // 0-100
        uint256 consecutiveFailures; // Reset on success
        uint256 lastActiveBlock;     // Last successful operation
        bool isEligible;            // Can be selected as primary
    }
    
    function getCurrentPrimary() public view returns (address) {
        address[] memory eligible = getEligibleWatchdogs();
        require(eligible.length > 0, "No eligible watchdogs");
        
        // Base rotation index
        uint256 rotationIndex = (block.number / ROTATION_PERIOD) % eligible.length;
        
        // Add unpredictability
        uint256 randomSeed = uint256(keccak256(abi.encode(
            block.number / ROTATION_PERIOD,  // Rotation period number
            blockhash(block.number - 1),      // Recent randomness
            eligible.length                   // Eligible set size
        )));
        
        // Final selection
        uint256 finalIndex = (rotationIndex + randomSeed) % eligible.length;
        return eligible[finalIndex];
    }
}
```

---

## Implementation Details

### 1. Reputation Management

```solidity
function updateWatchdogReputation(
    address watchdog, 
    bool success,
    uint256 responseTime
) internal {
    WatchdogMetrics storage metrics = watchdogMetrics[watchdog];
    
    if (success) {
        // Increase reputation (capped at 100)
        metrics.reputationScore = min(100, metrics.reputationScore + 1);
        metrics.consecutiveFailures = 0;
        
        // Bonus for fast response
        if (responseTime < 60) { // Under 1 minute
            metrics.reputationScore = min(100, metrics.reputationScore + 1);
        }
    } else {
        // Decrease reputation (floored at 0)
        metrics.reputationScore = metrics.reputationScore > 5 ? 
            metrics.reputationScore - 5 : 0;
        metrics.consecutiveFailures++;
        
        // Auto-disable after too many failures
        if (metrics.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            metrics.isEligible = false;
            emit WatchdogAutoDisabled(watchdog, block.number);
        }
    }
    
    metrics.lastActiveBlock = block.number;
}
```

### 2. Failover Mechanism

```solidity
modifier ensureActivePrimary(bytes32 operationId) {
    address currentPrimary = getCurrentPrimary();
    WatchdogOperation storage op = operations[operationId];
    
    // Check if primary has responded within timeout
    if (op.primaryValidator == currentPrimary && 
        block.timestamp > op.submittedAt + RESPONSE_TIMEOUT &&
        !op.primaryResponded) {
        
        // Trigger failover
        _handlePrimaryTimeout(currentPrimary, operationId);
        
        // Update to new primary
        currentPrimary = getCurrentPrimary();
        op.primaryValidator = currentPrimary;
    }
    _;
}

function _handlePrimaryTimeout(address timedOutPrimary, bytes32 operationId) internal {
    // Update metrics
    watchdogMetrics[timedOutPrimary].consecutiveFailures++;
    
    // Force rotation to next eligible
    lastRotationBlock = block.number;
    
    emit PrimaryTimeout(timedOutPrimary, operationId, block.timestamp);
}
```

### 3. Integration with Optimistic Consensus

```solidity
function submitOptimisticOperation(
    bytes32 operationType,
    bytes calldata operationData
) external onlyRole(VALIDATOR_ROLE) returns (bytes32 operationId) {
    // Get current primary with rotation check
    address currentPrimary = getCurrentPrimaryWithRotation();
    require(msg.sender == currentPrimary, "Not current primary");
    
    // Create operation
    operationId = keccak256(abi.encode(
        operationType, 
        operationData, 
        block.timestamp,
        currentPrimary
    ));
    
    // Store operation with primary assignment
    WatchdogOperation storage op = operations[operationId];
    op.primaryValidator = currentPrimary;
    op.rotationPeriod = block.number / ROTATION_PERIOD;
    // ... rest of operation setup
    
    // Update primary metrics
    watchdogMetrics[currentPrimary].lastActiveBlock = block.number;
    
    return operationId;
}

function getCurrentPrimaryWithRotation() internal returns (address) {
    uint256 currentPeriod = block.number / ROTATION_PERIOD;
    uint256 lastPeriod = lastRotationBlock / ROTATION_PERIOD;
    
    // Check if rotation needed
    if (currentPeriod > lastPeriod) {
        _performRotation();
    }
    
    return getCurrentPrimary();
}
```

---

## Off-chain Coordination

### 1. Watchdog Monitoring Service

```typescript
class RotationMonitoringService {
    private readonly BLOCKS_PER_PERIOD = 50;
    private readonly PREPARATION_LEAD_TIME = 25; // blocks
    
    async monitorRotationSchedule(): Promise<void> {
        const currentBlock = await this.web3.eth.getBlockNumber();
        const currentPeriod = Math.floor(currentBlock / this.BLOCKS_PER_PERIOD);
        
        // Check if we're primary in next period
        const nextPrimary = await this.predictNextPrimary(currentPeriod + 1);
        if (nextPrimary === this.myAddress) {
            const blocksUntilPrimary = ((currentPeriod + 1) * this.BLOCKS_PER_PERIOD) - currentBlock;
            
            if (blocksUntilPrimary <= this.PREPARATION_LEAD_TIME) {
                await this.prepareForPrimaryDuty();
            }
        }
        
        // Monitor current primary health
        const currentPrimary = await this.contract.getCurrentPrimary();
        if (currentPrimary === this.myAddress) {
            await this.performPrimaryDuties();
        }
    }
    
    async prepareForPrimaryDuty(): Promise<void> {
        // Scale infrastructure
        await this.scaleUpValidationNodes();
        
        // Sync state with other watchdogs
        await this.syncWithPeerWatchdogs();
        
        // Pre-fetch pending operations
        await this.prefetchPendingOperations();
        
        // Setup monitoring alerts
        await this.enablePrimaryAlerts();
        
        console.log('Ready for primary duty in next rotation period');
    }
}
```

### 2. Handoff Protocol

```typescript
interface RotationHandoff {
    outgoingPrimary: string;
    incomingPrimary: string;
    handoffBlock: number;
    pendingOperations: string[];
    systemSnapshot: SystemState;
}

class HandoffCoordinator {
    async executeHandoff(handoff: RotationHandoff): Promise<void> {
        if (handoff.outgoingPrimary === this.myAddress) {
            // Outgoing primary duties
            await this.publishHandoffData(handoff);
            await this.notifyIncomingPrimary(handoff.incomingPrimary);
            await this.scaleDownInfrastructure();
            
        } else if (handoff.incomingPrimary === this.myAddress) {
            // Incoming primary duties
            await this.receiveHandoffData(handoff);
            await this.verifySystemState(handoff.systemSnapshot);
            await this.assumePrimaryRole();
        }
    }
}
```

---

## Security Analysis

### Attack Vectors Mitigated

1. **Timing Attacks**: Randomness prevents predictable primary selection
2. **DoS Attacks**: Automatic failover ensures system continuity
3. **Reputation Gaming**: Consecutive failure limits prevent gaming
4. **Long-term Compromise**: 10-minute rotation limits exposure window

### Remaining Considerations

1. **Rotation Period Trade-offs**:
   - Shorter periods: Better security, higher operational overhead
   - Longer periods: More efficient, increased risk window
   - 10 minutes balances security and efficiency

2. **Reputation System Tuning**:
   - Initial reputation: 50/100 (neutral)
   - Success increment: +1 (or +2 for fast response)
   - Failure decrement: -5
   - Auto-disable threshold: 3 consecutive failures

---

## Gas Cost Analysis

```solidity
// Rotation overhead per operation
function rotationGasEstimate() public pure returns (uint256) {
    // getCurrentPrimary(): ~5,000 gas
    // - Array iteration: ~2,000 gas
    // - Keccak256: ~500 gas
    // - Storage reads: ~2,500 gas
    
    // Reputation update: ~5,000 gas
    // - Storage updates: ~5,000 gas
    
    // Total overhead: ~10,000 gas
    return 10000;
}
```

**Impact**: ~10% increase in operation gas cost (from ~60k to ~70k)

---

## Implementation Timeline

### Phase 1: Core Rotation Logic (2 weeks)
- Implement getCurrentPrimary() with rotation algorithm
- Add reputation tracking system
- Create failover mechanisms

### Phase 2: Integration (1 week)
- Integrate with OptimisticWatchdogConsensus
- Update operation submission flow
- Add emergency rotation controls

### Phase 3: Off-chain Infrastructure (2 weeks)
- Build monitoring services
- Implement handoff protocols
- Create operational dashboards

### Phase 4: Testing (2 weeks)
- Unit tests for rotation logic
- Integration tests with consensus
- Chaos testing for failures

---

## Conclusion

The hybrid rotation mechanism addresses the primary centralization risk while maintaining the benefits of optimistic consensus. Key innovations:

1. **Predictable yet Secure**: Operators can prepare for duties while attackers cannot game selection
2. **Automatic Resilience**: System continues operating despite individual failures
3. **Performance-based**: High-performing watchdogs get more primary duties
4. **Gas Efficient**: Minimal overhead maintains system efficiency

This design transforms the static primary assignment into a dynamic, resilient system suitable for protecting billions in tBTC value.

---

## Current v1 Design (For Reference)

The initial watchdog decentralization implementation uses a simpler approach:

```solidity
// v1: Per-operation primary selection with randomness
function getPrimaryValidator(
    address qc,
    bytes32 operationHash,
    uint256 blockNumber
) public view returns (address) {
    uint256 watchdogCount = activeWatchdogs.length;
    
    // Deterministic selection based on operation data
    uint256 qcSeed = uint256(keccak256(abi.encode(qc))) % 256;
    uint256 opSeed = uint256(operationHash) % 256;
    uint256 blockSeed = blockNumber % 256;
    
    // Add randomness from previous block hash to prevent manipulation
    uint256 randomSeed = uint256(blockhash(block.number - 1)) % 256;
    
    uint256 index = (qcSeed ^ opSeed ^ blockSeed ^ randomSeed) % watchdogCount;
    return activeWatchdogs[index];
}
```

**v1 Security Model**:
- Primary changes for every operation (no sustained control)
- Block hash randomness prevents gaming
- Legal framework provides primary security
- Challenge mechanism allows intervention
- Simple and gas-efficient

**Decision Criteria for v2 Rotation**:
1. **Metrics to Track in v1**:
   - Primary selection distribution (should be roughly uniform)
   - Frequency of challenges against primary validators
   - Any attempts to game the selection algorithm
   - Operational issues with current approach

2. **Triggers for Implementing Rotation**:
   - Evidence of primary selection manipulation
   - High frequency of successful challenges
   - Stakeholder concerns about security
   - Regulatory requirements for additional measures

3. **Alternative Enhancements to Consider**:
   - Simple rate limiting instead of full rotation
   - Reputation system without rotation
   - Enhanced monitoring and alerting
   - Stronger economic incentives

---

**Recommendation**: Launch v1 with the simple randomized selection and monitor closely. Only implement this rotation mechanism if operational data indicates a clear need. The complexity should be justified by actual observed risks, not theoretical concerns.