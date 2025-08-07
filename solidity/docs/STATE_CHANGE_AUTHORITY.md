# QC State Change Authority Design

**Document Version**: 1.0  
**Date**: 2025-08-06  
**Purpose**: Document the state change authority model and best practices  
**Status**: Implementation Reference

---

## Overview

This document explains how QC state changes are managed in the tBTC v2 Account Control system, following Solidity best practices for state management and access control.

## Core Design Principles

### 1. Single Source of Truth
**QCManager is the ONLY contract that can change QC status.**

All status modifications must flow through QCManager to ensure:
- Proper validation of state transitions
- Consistent event emission
- Authority checking
- Business logic enforcement

### 2. Clear Authority Boundaries
Different roles have different levels of authority:

```solidity
// FULL Authority - Can make any valid transition
ARBITER_ROLE → setQCStatus(qc, newStatus, reason)

// LIMITED Authority - Can only set to UnderReview  
WATCHDOG_ENFORCER_ROLE → requestStatusChange(qc, UnderReview, reason)

// INTERNAL Authority - Solvency checks can also set to UnderReview
_executeStatusChange(qc, UnderReview, reason, "SOLVENCY_CHECK")
```

### 3. Checks-Effects-Interactions Pattern
All state changes follow the standard Solidity pattern:

```solidity
function _executeStatusChange(...) private {
    if (!qcData.isQCRegistered(qc)) revert QCNotRegistered(qc);
    if (!_isValidStatusTransition(oldStatus, newStatus)) revert InvalidStatusTransition(...);
    
    qcData.setQCStatus(qc, newStatus, reason);
    
    emit QCStatusChanged(...);
}
```

## Authority Model

### ARBITER_ROLE (Full Authority)
**Who**: Governance, Emergency Responders  
**Can Do**: Any valid state transition  
**Use Cases**:
- Governance decisions to revoke QCs
- Emergency response to security incidents
- Manual resolution of disputes
- Restoring QCs from UnderReview to Active

```solidity
// Examples of ARBITER actions
qcManager.setQCStatus(qc, QCStatus.Active, "Issues resolved");
qcManager.setQCStatus(qc, QCStatus.Revoked, "Regulatory violation");
```

### WATCHDOG_ENFORCER_ROLE (Limited Authority)
**Who**: WatchdogEnforcer contract  
**Can Do**: Only set QCs to UnderReview status  
**Use Cases**:
- Objective violation detection (insufficient reserves)
- Stale attestation enforcement
- Automated compliance monitoring

```solidity
// WatchdogEnforcer can only do this:
qcManager.requestStatusChange(qc, QCStatus.UnderReview, "INSUFFICIENT_RESERVES");

// This would FAIL - WatchdogEnforcer cannot set to Active or Revoked
qcManager.requestStatusChange(qc, QCStatus.Active, "...");     // ❌ REVERT
qcManager.requestStatusChange(qc, QCStatus.Revoked, "...");    // ❌ REVERT
```

### Internal Authority (Solvency Checks)
**Who**: QCManager internal functions  
**Can Do**: Set QCs to UnderReview when undercollateralized  
**Use Cases**:
- Automatic insolvency detection
- Business logic enforcement

```solidity
// Internal solvency check
if (!solvent && currentStatus == Active) {
    _executeStatusChange(qc, UnderReview, "UNDERCOLLATERALIZED", "SOLVENCY_CHECK");
}
```

## State Machine Rules

### Valid Transitions
```
┌─────────┐    ┌──────────────┐    ┌─────────┐
│ Active  │◄──►│ UnderReview  │───►│ Revoked │
└─────────┘    └──────────────┘    └─────────┘
     │                                   ▲
     └───────────────────────────────────┘
```

**Active State**:
- ✅ → UnderReview (temporary suspension)
- ✅ → Revoked (permanent termination)
- ❌ → Active (no-op, but allowed)

**UnderReview State**:
- ✅ → Active (issues resolved)
- ✅ → Revoked (permanent termination)
- ❌ → UnderReview (no-op, but allowed)

**Revoked State**:
- ❌ → Active (cannot resurrect)
- ❌ → UnderReview (terminal state)
- ❌ → Revoked (no-op, but allowed)

### Business Logic
- **UnderReview**: QC cannot mint new tokens, existing redemptions continue
- **Revoked**: QC cannot mint, new redemptions blocked
- **Active**: Full operational capabilities

## Implementation Pattern

### ✅ CORRECT: Centralized State Management

```solidity
contract QCManager {
    /// @notice ONLY way to change QC status - all paths flow through here
    function _executeStatusChange(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason,
        string memory authority
    ) private {
        // Single implementation with full validation
        // Consistent event emission
    }
    
    // Public interfaces that use the internal function
    function setQCStatus(...) external onlyRole(ARBITER_ROLE) {
        _executeStatusChange(qc, newStatus, reason, "ARBITER");
    }
    
    function requestStatusChange(...) external onlyRole(WATCHDOG_ENFORCER_ROLE) {
        require(newStatus == UnderReview, "Limited authority");
        _executeStatusChange(qc, newStatus, reason, "WATCHDOG_ENFORCER");
    }
}
```

### ❌ WRONG: Multiple State Modification Paths

```solidity
// BAD: Multiple contracts can change state
contract QCManager {
    function setQCStatus(...) { qcData.setQCStatus(...); }
}

contract WatchdogEnforcer {
    function enforce(...) { qcData.setQCStatus(...); }  // ❌ Bypass validation
}

contract SomeOtherContract {
    function doSomething(...) { qcData.setQCStatus(...); }  // ❌ No authority check
}
```

## Security Considerations

### Authority Separation
- **ARBITER_ROLE** should be held by governance with timelock delays
- **WATCHDOG_ENFORCER_ROLE** should only be granted to WatchdogEnforcer contract
- **No roles should overlap** unless explicitly intended

### State Consistency
- All state changes go through single validation function
- State machine rules prevent invalid transitions  
- Events always emitted consistently

### Access Control
- Role-based permissions enforced at function level
- Authority validated before state changes
- Clear documentation of who can do what

## Event Tracking

All state changes emit consistent events:

```solidity
event QCStatusChanged(
    address indexed qc,
    QCStatus indexed oldStatus,
    QCStatus indexed newStatus,
    bytes32 reason,
    address changedBy,
    uint256 timestamp
);

// Additional event for watchdog requests
event QCStatusChangeRequested(
    address indexed qc,
    QCStatus indexed requestedStatus,
    bytes32 reason,
    address indexed requester,
    uint256 timestamp
);
```

## Common Pitfalls to Avoid

### ❌ Direct State Modification
```solidity
// DON'T DO THIS
qcData.setQCStatus(qc, newStatus, reason);  // Bypasses validation
```

### ❌ Multiple Authority Paths  
```solidity
// DON'T DO THIS
if (hasRole(ROLE_A, msg.sender)) {
    qcData.setQCStatus(...);
} else if (hasRole(ROLE_B, msg.sender)) {
    qcData.setQCStatus(...);  // Different validation logic
}
```

### ❌ Missing Validation
```solidity
// DON'T DO THIS  
function setStatus(...) external {
    qcData.setQCStatus(qc, newStatus, reason);  // No transition validation
}
```

## Testing State Changes

### Authority Tests
```solidity
it("should only allow ARBITER_ROLE to make any transition", async () => {
    await expect(
        qcManager.connect(nonArbiter).setQCStatus(qc, QCStatus.Revoked, "test")
    ).to.be.revertedWith("AccessControl");
});

it("should only allow WATCHDOG_ENFORCER_ROLE to set UnderReview", async () => {
    await expect(
        qcManager.connect(watchdog).requestStatusChange(qc, QCStatus.Active, "test")
    ).to.be.revertedWith("WatchdogEnforcer can only set UnderReview status");
});
```

### State Machine Tests
```solidity
it("should prevent invalid transitions", async () => {
    // Set QC to Revoked
    await qcManager.setQCStatus(qc, QCStatus.Revoked, "test");
    
    // Should not be able to transition from Revoked
    await expect(
        qcManager.setQCStatus(qc, QCStatus.Active, "test")
    ).to.be.revertedWith("InvalidStatusTransition");
});
```

## Best Practices Summary

1. **Single Source of Truth**: One contract manages all state changes
2. **Clear Authority**: Different roles have clearly defined permissions  
3. **Validation First**: Check all conditions before changing state
4. **Consistent Events**: Always emit events after successful changes
5. **State Machine**: Enforce valid transitions according to business rules
6. **Access Control**: Use role-based permissions consistently
7. **Documentation**: Document all authority relationships clearly

This design eliminates the issues identified in the watchdog remediation plan while following established Solidity best practices for state management.