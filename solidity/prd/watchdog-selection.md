# Watchdog Primary Selection - Quick Reference

**Document Version**: 1.0  
**Date**: 2025-01-15  
**Status**: v1 Implementation Design  
**Purpose**: Quick reference for primary validator selection mechanism  
**Related Documents**: [watchdog-decentralization.md](watchdog-decentralization.md), [watchdog-rotation-mechanism.md](watchdog-rotation-mechanism.md)

---

## v1 Implementation: Per-Operation Selection with Randomness

### Core Selection Algorithm

```solidity
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

### Key Properties

1. **Per-Operation Selection**
   - Primary validator changes for every operation
   - No single watchdog has sustained control
   - Natural load distribution across all watchdogs

2. **Unpredictability**
   - Block hash randomness prevents gaming
   - Attackers cannot manipulate operation parameters to ensure specific primary
   - ~500 gas overhead for blockhash call

3. **Deterministic Verification**
   - Anyone can verify the correct primary was selected
   - Combines operation-specific data with randomness
   - Maintains auditability while preventing manipulation

### Security Model

```
┌─────────────────────────────────────────────────────────────┐
│                     Operation Submitted                      │
├─────────────────────────────────────────────────────────────┤
│  1. Calculate primary: f(qc, opHash, blockNum, blockhash)  │
│  2. Primary validator submits optimistically                │
│  3. 1-hour challenge window opens                           │
│  4. Other watchdogs can challenge if invalid               │
│  5. Escalating delays if challenged (1h → 4h → 12h)       │
└─────────────────────────────────────────────────────────────┘
```

### Implementation in Context

```solidity
contract OptimisticWatchdogConsensus {
    function submitOptimisticOperation(
        bytes32 operationType,
        bytes calldata operationData
    ) external onlyRole(VALIDATOR_ROLE) returns (bytes32 operationId) {
        // Verify this is the designated primary validator
        address primaryValidator = getPrimaryValidator(
            operationType, 
            operationData, 
            block.number
        );
        require(msg.sender == primaryValidator, "Not designated primary");
        
        // Continue with optimistic submission...
        operationId = keccak256(abi.encode(
            operationType, 
            operationData, 
            block.timestamp
        ));
        
        // Store operation with primary assignment
        operations[operationId].primaryValidator = primaryValidator;
        // ...
    }
}
```

### Gas Cost Analysis

- **Base selection cost**: ~3,000 gas
  - Keccak256 hashing: ~500 gas
  - Blockhash lookup: ~500 gas
  - XOR operations: ~100 gas
  - Array access: ~1,000 gas
  - Modulo operation: ~900 gas

- **Total overhead**: ~3,000 gas per operation (5% of base operation cost)

### Monitoring and Metrics

Track these metrics to evaluate if enhanced rotation is needed:

1. **Primary Distribution**
   ```sql
   SELECT primary_validator, COUNT(*) as operation_count
   FROM operations
   GROUP BY primary_validator
   -- Should show roughly uniform distribution
   ```

2. **Challenge Frequency**
   ```sql
   SELECT primary_validator, 
          COUNT(CASE WHEN challenged THEN 1 END) as challenges,
          COUNT(*) as total_operations,
          (challenges / total_operations) as challenge_rate
   FROM operations
   GROUP BY primary_validator
   -- High challenge rates may indicate issues
   ```

3. **Selection Patterns**
   - Monitor for unusual clustering
   - Check for timing correlations
   - Analyze operation parameter distributions

### Future Enhancement Triggers

Consider implementing rotation (see [watchdog-rotation-mechanism.md](watchdog-rotation-mechanism.md)) if:

1. **Gaming Detected**: Evidence of primary selection manipulation
2. **High Challenge Rate**: >5% of operations challenged successfully
3. **Uneven Distribution**: Some watchdogs consistently selected more/less
4. **Stakeholder Concerns**: Institutional partners request additional measures
5. **Regulatory Requirements**: New compliance requirements emerge

### Simple Enhancements Before Full Rotation

If issues arise, consider these simpler fixes first:

1. **Rate Limiting**
   ```solidity
   mapping(address => uint256) lastPrimaryBlock;
   require(block.number > lastPrimaryBlock[validator] + 10, "Rate limited");
   ```

2. **Enhanced Randomness**
   ```solidity
   // Use multiple block hashes
   uint256 randomSeed = uint256(keccak256(abi.encode(
       blockhash(block.number - 1),
       blockhash(block.number - 2),
       blockhash(block.number - 3)
   ))) % 256;
   ```

3. **Emergency Exclusion**
   ```solidity
   mapping(address => bool) emergencyExcluded;
   // Skip excluded validators in selection
   ```

---

## Summary

The v1 primary selection mechanism balances simplicity with security:
- ✅ Simple implementation (one function)
- ✅ Unpredictable selection (block hash randomness)
- ✅ Per-operation rotation (no sustained control)
- ✅ Low gas overhead (~3,000 gas)
- ✅ Natural load distribution

This approach is appropriate for v1 launch. Monitor operational metrics and only add complexity (like full rotation) if actual exploitation attempts or operational issues justify it.