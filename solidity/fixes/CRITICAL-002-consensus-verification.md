# CRITICAL-002: Consensus Verification for High Objections

**Severity**: Critical  
**Status**: Pending  
**Assignee**: TBD  
**Target**: v1.1 Pre-deployment  

## Problem

Current implementation in OptimisticWatchdogConsensus.sol:219-221:
```solidity
if (operation.objectionCount >= consensusThresholds[3]) {
    revert InsufficientConsensus();
}
```

Operations with high objection counts (≥5) cannot be executed, potentially causing system deadlock.

## Solution

Implement explicit approval mechanism for disputed operations:

```solidity
// New state variables
mapping(bytes32 => mapping(address => bool)) public operationApprovals;
mapping(bytes32 => uint256) public approvalCount;

// New approval function
function approveOperation(bytes32 operationId) external;

// Updated execution logic
function executeOperation(bytes32 operationId) external;
```

## Implementation Details

### 1. Add State Variables

```solidity
// In OptimisticWatchdogConsensus.sol state variables section

/// @notice Tracks which watchdogs have approved a disputed operation
mapping(bytes32 => mapping(address => bool)) public operationApprovals;

/// @notice Count of approvals for each operation
mapping(bytes32 => uint256) public approvalCount;

/// @notice Minimum approvals required for disputed operations
uint8 public constant MIN_APPROVALS_FOR_DISPUTED = 3;
```

### 2. Add Approval Function

```solidity
/// @notice Approve a disputed operation for execution
/// @param operationId The operation to approve
function approveOperation(bytes32 operationId) 
    external 
    onlyActiveWatchdog 
    operationExists(operationId) 
{
    WatchdogOperation storage operation = operations[operationId];
    
    // Validate operation state
    require(!operation.executed, "Already executed");
    require(operation.challenged, "Not disputed");
    require(block.timestamp >= operation.finalizedAt, "Challenge period active");
    
    // Prevent double approval
    require(!operationApprovals[operationId][msg.sender], "Already approved");
    
    // Record approval
    operationApprovals[operationId][msg.sender] = true;
    approvalCount[operationId]++;
    
    emit OperationApproved(operationId, msg.sender, approvalCount[operationId]);
}
```

### 3. Update Execute Function

```solidity
function executeOperation(bytes32 operationId) 
    external 
    override 
    operationExists(operationId) 
    whenNotPaused 
{
    WatchdogOperation storage operation = operations[operationId];
    
    // Validate execution conditions
    if (operation.executed) revert OperationAlreadyExecuted();
    if (block.timestamp < operation.finalizedAt) revert ChallengePeriodActive();
    
    // Check consensus requirements if challenged
    if (operation.challenged) {
        uint8 requiredConsensus = _getRequiredConsensus(operation.objectionCount);
        
        // For high objection counts, require explicit approvals
        if (operation.objectionCount >= consensusThresholds[2]) { // ≥3 objections
            uint256 requiredApprovals = _calculateRequiredApprovals(operation.objectionCount);
            require(
                approvalCount[operationId] >= requiredApprovals,
                "Insufficient approvals for disputed operation"
            );
        }
    }
    
    // Mark as executed
    operation.executed = true;
    
    // Execute the operation through the operation executor
    bool success = _executeOperationType(operation.operationType, operation.operationData);
    
    emit OperationExecuted(operationId, msg.sender, success);
}
```

### 4. Add Helper Function

```solidity
/// @dev Calculate required approvals based on objection count
function _calculateRequiredApprovals(uint8 objectionCount) internal view returns (uint256) {
    uint256 activeCount = activeWatchdogsList.length;
    
    if (objectionCount >= consensusThresholds[3]) { // ≥5 objections
        // Require majority of active watchdogs
        return (activeCount / 2) + 1;
    } else if (objectionCount >= consensusThresholds[2]) { // ≥3 objections
        // Require at least 3 approvals or 40% of watchdogs, whichever is higher
        return Math.max(3, (activeCount * 2) / 5);
    }
    
    return 0; // No approvals needed for low objection counts
}
```

### 5. Add Event

```solidity
/// @notice Emitted when a watchdog approves a disputed operation
event OperationApproved(
    bytes32 indexed operationId,
    address indexed approver,
    uint256 totalApprovals
);
```

## Testing Requirements

### Unit Tests

```solidity
describe("Consensus Verification", () => {
    it("should require approvals for high objection operations", async () => {
        // Submit operation
        // Challenge 5 times
        // Attempt execution - should fail
        // Get 3 approvals
        // Execute - should succeed
    });
    
    it("should prevent double approval", async () => {
        // Approve once - success
        // Approve again - should revert
    });
    
    it("should calculate required approvals correctly", async () => {
        // Test with 3 objections - needs 3 approvals
        // Test with 5 objections - needs majority
        // Test with different watchdog counts
    });
});
```

### Integration Tests

- [ ] Full disputed operation flow
- [ ] Approval collection from multiple watchdogs
- [ ] Edge cases with changing watchdog set
- [ ] Gas optimization for approval process

## Migration Considerations

Since this adds new functionality without breaking existing behavior:
1. Deploy new contracts
2. No state migration needed
3. Update documentation for watchdog operators
4. Train operators on approval process

## Monitoring

Track these metrics post-deployment:
- Operations requiring approvals
- Average approval collection time
- Approval participation rates by watchdog
- Operations that fail to get sufficient approvals

## Alternative Designs Considered

1. **Automatic Resolution**: Rejected - requires off-chain coordination
2. **Veto System**: Rejected - can lead to griefing
3. **Economic Stakes**: Deferred to v1.2 - adds complexity

## References

- [Original Security Finding](../v1.1-security-fixes-plan.md#finding_001)
- [Consensus Mechanisms Research](https://ethereum.org/en/developers/docs/consensus-mechanisms/)
- [Account Control Requirements](../prd/REQUIREMENTS.md)