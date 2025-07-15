# CRITICAL-001: MEV-Resistant Validator Selection

**Severity**: Critical  
**Status**: Pending  
**Assignee**: TBD  
**Target**: v1.1 Pre-deployment  

## Problem

Current implementation in OptimisticWatchdogConsensus.sol:336 uses:
```solidity
block.number / 100 // Use block number rounded to prevent MEV
```

This is vulnerable to MEV attacks where block proposers can manipulate timing within 100-block windows.

## Solution

Implement the design from watchdog-selection.md using blockhash for true randomness:

```solidity
function calculatePrimaryValidator(
    bytes32 operationType,
    bytes calldata operationData
) public view override returns (address) {
    uint256 watchdogCount = activeWatchdogsList.length;
    require(watchdogCount > 0, "No active watchdogs");
    
    // Use previous block hash for randomness (MEV-resistant)
    bytes32 blockHash = blockhash(block.number - 1);
    
    // Handle case where blockhash returns 0 (>256 blocks old)
    if (blockHash == bytes32(0)) {
        // Fallback to pseudo-randomness based on block data
        blockHash = keccak256(abi.encode(block.timestamp, block.difficulty));
    }
    
    // Combine multiple entropy sources
    uint256 seed = uint256(keccak256(abi.encode(
        operationType,
        operationData,
        blockHash,
        address(this) // Contract address for cross-chain uniqueness
    )));
    
    uint256 index = seed % watchdogCount;
    return activeWatchdogsList[index];
}
```

## Implementation Steps

1. **Update OptimisticWatchdogConsensus.sol**
   - Replace current calculatePrimaryValidator implementation
   - Add blockhash validation logic
   - Include contract address for uniqueness

2. **Add Monitoring Event**
   ```solidity
   event PrimaryValidatorSelected(
       bytes32 indexed operationType,
       address indexed primaryValidator,
       uint256 blockNumber,
       bytes32 blockHash
   );
   ```

3. **Update Tests**
   - Mock blockhash in test environment
   - Test edge case when blockhash returns 0
   - Verify distribution uniformity
   - Test MEV resistance scenarios

4. **Gas Impact**
   - Current: ~1,000 gas
   - New: ~3,000 gas (acceptable overhead)

## Testing Checklist

- [ ] Unit test: Normal blockhash selection
- [ ] Unit test: Zero blockhash fallback
- [ ] Integration test: Validator distribution over 1000 operations
- [ ] Security test: Attempt to manipulate selection
- [ ] Gas test: Verify ~3,000 gas overhead

## Code Changes

### File: contracts/account-control/OptimisticWatchdogConsensus.sol

```diff
function calculatePrimaryValidator(
    bytes32 operationType,
    bytes calldata operationData
) public view override returns (address) {
    uint256 watchdogCount = activeWatchdogsList.length;
    require(watchdogCount > 0, "No active watchdogs");
    
-   // Deterministic selection based on operation data (similar to optimistic-minting)
-   uint256 seed = uint256(keccak256(abi.encode(
-       operationType,
-       operationData,
-       block.number / 100 // Use block number rounded to prevent MEV
-   )));
+   // Use previous block hash for MEV-resistant randomness
+   bytes32 blockHash = blockhash(block.number - 1);
+   
+   // Handle edge case where blockhash returns 0
+   if (blockHash == bytes32(0)) {
+       blockHash = keccak256(abi.encode(block.timestamp, block.difficulty));
+   }
+   
+   // Combine multiple entropy sources for security
+   uint256 seed = uint256(keccak256(abi.encode(
+       operationType,
+       operationData,
+       blockHash,
+       address(this)
+   )));
    
    uint256 index = seed % watchdogCount;
+   
+   emit PrimaryValidatorSelected(operationType, activeWatchdogsList[index], block.number, blockHash);
+   
    return activeWatchdogsList[index];
}
```

## Verification

After implementation:
1. Deploy to testnet
2. Monitor PrimaryValidatorSelected events
3. Analyze distribution statistics
4. Attempt MEV attacks in controlled environment
5. Verify no correlation with block timing

## References

- [watchdog-selection.md](../prd/watchdog-selection.md)
- [Original Security Finding](../v1.1-security-fixes-plan.md#finding_002)
- [Ethereum Yellow Paper - BLOCKHASH opcode](https://ethereum.github.io/yellowpaper/paper.pdf)