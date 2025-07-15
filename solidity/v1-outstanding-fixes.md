# V1 SingleWatchdog - Outstanding Fixes

**Date**: 2025-07-15  
**Priority**: High - Complete before V2 development  
**Estimated Time**: 1-2 days total  
**Status**: Ready for implementation

## Overview

This document lists all outstanding fixes needed to complete V1 SingleWatchdog implementation before moving to V2 quorum development. All items are minor and can be completed quickly.

---

## 1. Deployment Script - Automated Role Setup

### Issue
The deployment script deploys SingleWatchdog but doesn't automatically set up the required roles in system contracts.

### Current State
```typescript
// deploy/98_deploy_account_control_watchdog.ts
const singleWatchdog = await deploy("SingleWatchdog", {
  from: deployer,
  args: [protocolRegistry.address],
  log: true,
})
// Missing: role setup
```

### Required Fix
```typescript
// Add after deployment:
const SingleWatchdog = await ethers.getContractFactory("SingleWatchdog", deployer)
const watchdog = SingleWatchdog.attach(singleWatchdog.address)

// Setup roles in system contracts
log("Setting up Watchdog roles...")
const tx = await watchdog.setupWatchdogRoles()
await tx.wait()
log("Watchdog roles configured successfully")

// Optionally verify operational status
const isOperational = await watchdog.isWatchdogOperational()
if (!isOperational) {
  throw new Error("Watchdog not operational after role setup")
}
```

### Files to Update
- `deploy/98_deploy_account_control_watchdog.ts`

---

## 2. Test Coverage - Bulk Operations Edge Cases

### Issue
Bulk operations (`bulkHandleRedemptions`) lack comprehensive error scenario tests.

### Current State
- Basic happy path tests exist
- Missing error scenarios and edge cases

### Required Tests
```typescript
// In test/account-control/SingleWatchdog.test.ts

describe("bulkHandleRedemptions edge cases", () => {
  it("should revert with empty redemption array", async () => {
    await expect(
      singleWatchdog.bulkHandleRedemptions([], true, defaultReasonBytes32)
    ).to.be.revertedWith("NoRedemptionsProvided")
  })

  it("should revert with zero reason", async () => {
    await expect(
      singleWatchdog.bulkHandleRedemptions(
        [redemptionId], 
        true, 
        ethers.constants.HashZero
      )
    ).to.be.revertedWith("ReasonRequired")
  })

  it("should handle mixed valid/invalid redemptions", async () => {
    // Test partial success scenarios
  })

  it("should emit correct events for each redemption", async () => {
    // Test event emission for bulk operations
  })

  it("should update tracking mappings correctly", async () => {
    // Verify redemptionHandlingTime updates
  })
})
```

### Files to Update
- `test/account-control/SingleWatchdog.test.ts`

---

## 3. PRD Documentation - Update Examples

### Issue
PRD documentation shows outdated interface examples that don't match the implemented SingleWatchdog.

### Current State
```typescript
// IMPLEMENTATION.md shows:
await watchdog.submitReserveAttestation(qc.address, ethers.utils.parseEther("10"));
```

### Required Fix
```typescript
// Update to actual interface:
await singleWatchdog.attestReserves(qc.address, ethers.utils.parseEther("10"));

// Or for strategic attestation:
await singleWatchdog.strategicAttestation(
  qc.address, 
  ethers.utils.parseEther("10"), 
  "INSOLVENCY"
);
```

### Documentation Updates Needed
1. **Function name corrections**:
   - `submitReserveAttestation` → `attestReserves`
   - `finalizeWalletRegistration` → `registerWalletWithProof`
   - Add `strategicAttestation` examples

2. **Add role setup examples**:
```typescript
// Setup watchdog roles after deployment
await singleWatchdog.setupWatchdogRoles();

// Verify operational status
const isOperational = await singleWatchdog.isWatchdogOperational();
console.log("Watchdog operational:", isOperational);
```

3. **Add monitoring examples**:
```typescript
// Get watchdog statistics
const stats = await singleWatchdog.getWatchdogStats(qcAddress);
console.log("Last attestation:", stats[0]);
console.log("Total attestations:", stats[1]);
```

### Files to Update
- `prd/IMPLEMENTATION.md` - Section 6.2.5 (Watchdog Integration)
- `prd/FLOWS.md` - Update watchdog interaction examples

---

## 4. Integration Test - Complete Workflow

### Issue
Missing end-to-end integration test that validates the complete watchdog workflow.

### Required Test
```typescript
// New file: test/integration/account-control/WatchdogIntegration.test.ts

describe("SingleWatchdog Integration", () => {
  it("should complete full QC lifecycle with watchdog", async () => {
    // 1. Setup watchdog roles
    await singleWatchdog.setupWatchdogRoles()
    
    // 2. Register QC wallet
    await singleWatchdog.registerWalletWithProof(
      qc.address,
      btcAddress,
      spvProof,
      challengeHash
    )
    
    // 3. Attest reserves
    await singleWatchdog.attestReserves(qc.address, reserveBalance)
    
    // 4. Handle redemption
    await singleWatchdog.recordRedemptionFulfillment(
      redemptionId,
      userBtcAddress,
      expectedAmount,
      txInfo,
      proof
    )
    
    // 5. Verify all state changes
    const stats = await singleWatchdog.getWatchdogStats(qc.address)
    expect(stats[1]).to.equal(1) // One attestation
  })
})
```

### Files to Create
- `test/integration/account-control/WatchdogIntegration.test.ts`

---

## 5. Gas Optimization Verification

### Issue
Gas costs are estimated but not verified with actual measurements.

### Required Action
Create gas benchmark tests:

```typescript
// New file: test/gas/SingleWatchdog.gas.ts

describe("SingleWatchdog Gas Benchmarks", () => {
  it("should measure gas for attestReserves", async () => {
    const tx = await singleWatchdog.attestReserves(qc.address, reserveBalance)
    const receipt = await tx.wait()
    console.log("attestReserves gas used:", receipt.gasUsed.toString())
    expect(receipt.gasUsed).to.be.lt(100000) // Target: <100k
  })
  
  // Similar tests for other functions...
})
```

### Files to Create
- `test/gas/SingleWatchdog.gas.ts`

---

## 6. Event Standardization Check

### Issue
Verify all events follow consistent naming and parameter patterns.

### Required Review
```solidity
// Ensure all events follow pattern:
// WatchdogXxxAction(indexed primary, indexed secondary, data, actor, timestamp)

event WatchdogReserveAttestation(
    address indexed qc,
    uint256 indexed newBalance,
    uint256 indexed oldBalance, // Should this be indexed?
    address submittedBy,
    uint256 timestamp
);
```

### Files to Review
- `contracts/account-control/SingleWatchdog.sol` - Event definitions

---

## Implementation Plan

### Day 1 (4-6 hours)
1. **Morning**: 
   - Fix deployment script (1 hour)
   - Add integration test (2 hours)
   
2. **Afternoon**:
   - Add bulk operation tests (2 hours)
   - Create gas benchmark tests (1 hour)

### Day 2 (2-4 hours)
1. **Morning**:
   - Update PRD documentation (2 hours)
   
2. **Afternoon**:
   - Review and standardize events (1 hour)
   - Final testing and verification (1 hour)

---

## Verification Checklist

After implementing all fixes:

- [ ] Deployment script automatically sets up roles
- [ ] `isWatchdogOperational()` returns true after deployment
- [ ] All bulk operation edge cases tested
- [ ] Gas measurements documented and within targets
- [ ] PRD examples match actual implementation
- [ ] Integration test passes
- [ ] All events follow consistent pattern

---

## Notes

1. **Priority**: Complete these fixes before starting V2 development
2. **Dependencies**: None - all fixes are independent
3. **Risk**: Low - all changes are additive or documentation only
4. **Testing**: Run full test suite after each fix

---

**Status**: Ready for implementation  
**Next Step**: Assign developer to complete fixes  
**Tracking**: Update this document as items are completed