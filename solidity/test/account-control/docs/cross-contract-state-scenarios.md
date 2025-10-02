# Cross-Contract State Transition Test Scenarios

## Overview

This document defines comprehensive test scenarios for validating state transitions across QCManager's contract dependencies. Each scenario includes setup, execution steps, validation points, and expected outcomes.

## Critical State Transition Scenarios

### Scenario 1: Oracle Failure → QC Pause → AccountControl Freeze
**Test File**: `test/account-control/integration/oracle-failure-cascade.test.ts`

#### Setup
```typescript
// Initial state: QC active with sufficient backing
const qc = qcs[0];
await qcManager.registerQC(qc.address, ethers.utils.parseEther("1000"));
await reserveOracle.updateReserveBalance(qc.address, ethers.utils.parseEther("800"));
await qcManager.syncBackingFromOracle(qc.address);

// Verify initial healthy state
expect(await qcData.getQCStatus(qc.address)).to.equal(QCStatus.ACTIVE);
expect(await accountControl.authorized(qc.address)).to.be.true;
```

#### Execution Steps
```typescript
describe("Oracle Failure Cascade", () => {
  it("should propagate oracle failure through system correctly", async () => {
    // Step 1: Oracle becomes unavailable
    await mockOracle.setUnavailable(true);
    
    // Step 2: Grace period expires, QC enters self-pause
    await time.increase(systemState.gracefulDegradationTimeout() + 1);
    await qcManager.syncBackingFromOracle(qc.address);
    
    // Step 3: Self-pause escalates to system pause
    await time.increase(systemState.selfPauseEscalationDelay() + 1);
    await pauseManager.checkEscalation(qc.address);
    
    // Step 4: AccountControl responds to system pause
    await accountControl.updateQCStatus(qc.address);
  });
});
```

#### State Validation Points
```typescript
// After each step, validate state consistency
const validateStateTransition = async (expectedStage: number) => {
  const qcStatus = await qcData.getQCStatus(qc.address);
  const pauseInfo = await pauseManager.getPauseInfo(qc.address);
  const accountStatus = await accountControl.getReserveStatus(qc.address);
  const oracleData = await qcManager.qcOracleData(qc.address);
  
  switch(expectedStage) {
    case 1: // Oracle failure detected
      expect(oracleData.oracleFailureDetected).to.be.true;
      expect(qcStatus).to.equal(QCStatus.ACTIVE); // Still active
      break;
      
    case 2: // Self-pause initiated  
      expect(qcStatus).to.equal(QCStatus.SELF_PAUSED);
      expect(pauseInfo.selfPauseTimestamp).to.be.gt(0);
      expect(accountStatus.mintingPaused).to.be.false; // Not yet escalated
      break;
      
    case 3: // Escalation triggered
      expect(qcStatus).to.equal(QCStatus.UNDER_REVIEW);
      expect(pauseInfo.escalated).to.be.true;
      break;
      
    case 4: // AccountControl frozen
      expect(accountStatus.mintingPaused).to.be.true;
      expect(accountStatus.redeemingPaused).to.be.true;
      break;
  }
};
```

### Scenario 2: QC Registration → Wallet Setup → Operational Readiness
**Test File**: `test/account-control/integration/qc-onboarding-flow.test.ts`

#### Multi-Step Registration Process
```typescript
describe("Complete QC Onboarding Flow", () => {
  it("should coordinate registration across all contracts", async () => {
    const newQC = ethers.Wallet.createRandom();
    const mintingCap = ethers.utils.parseEther("5000");
    
    // Step 1: Initial QC registration in QCManager
    const registrationTx = await qcManager.registerQC(newQC.address, mintingCap);
    
    // Step 2: Wallet registration with QCWalletManager  
    const walletData = createWalletRegistrationData(newQC.address);
    await qcManager.connect(newQC).registerWalletDirect(
      walletData.btcAddress,
      walletData.nonce,
      walletData.publicKey,
      walletData.signature.v,
      walletData.signature.r,
      walletData.signature.s
    );
    
    // Step 3: Oracle data initialization
    await reserveOracle.updateReserveBalance(newQC.address, ethers.utils.parseEther("4000"));
    await qcManager.syncBackingFromOracle(newQC.address);
    
    // Step 4: Final operational validation
    await validateQCFullyOperational(newQC.address);
  });
});
```

#### Comprehensive State Validation
```typescript
const validateQCFullyOperational = async (qcAddress: string) => {
  // QCData state
  const qcInfo = await qcData.getQCInfo(qcAddress);
  expect(qcInfo.status).to.equal(QCStatus.ACTIVE);
  expect(qcInfo.maxCapacity).to.equal(mintingCap);
  expect(qcInfo.registeredAt).to.be.gt(0);
  
  // AccountControl authorization
  const authorized = await accountControl.authorized(qcAddress);
  expect(authorized).to.be.true;
  
  const reserveInfo = await accountControl.reserveInfo(qcAddress);
  expect(reserveInfo.mintingCap).to.equal(mintingCap);
  
  // Wallet registration
  const walletRegistered = await walletManager.isWalletRegistered(qcAddress, walletData.btcAddress);
  expect(walletRegistered).to.be.true;
  
  // Oracle data synced
  const oracleData = await qcManager.qcOracleData(qcAddress);
  expect(oracleData.lastKnownReserveBalance).to.equal(ethers.utils.parseEther("4000"));
  expect(oracleData.lastKnownBalanceTimestamp).to.be.gt(0);
  
  // Operational readiness
  const canMint = await qcManager.canMint(qcAddress, ethers.utils.parseEther("100"));
  expect(canMint).to.be.true;
};
```

### Scenario 3: Emergency Pause → System Lockdown → Coordinated Recovery
**Test File**: `test/account-control/integration/emergency-recovery.test.ts`

#### Emergency Activation Sequence
```typescript
describe("Emergency Pause and Recovery", () => {
  it("should coordinate emergency pause across all contracts", async () => {
    // Setup: Multiple active QCs
    const activeQCs = [qcs[0], qcs[1], qcs[2]];
    for (const qc of activeQCs) {
      await setupActiveQC(qc.address);
    }
    
    // Emergency trigger
    await systemState.connect(emergency).activateEmergencyPause("SECURITY_INCIDENT");
    
    // Validate immediate lockdown
    await validateEmergencyLockdown(activeQCs);
    
    // Recovery phase
    await systemState.connect(governance).beginGradualRecovery();
    await validateGradualRecovery(activeQCs);
  });
});
```

#### Emergency State Validation
```typescript
const validateEmergencyLockdown = async (qcs: string[]) => {
  // System-wide pause active
  expect(await systemState.emergencyPauseActive()).to.be.true;
  
  for (const qc of qcs) {
    // All QCs moved to emergency state
    const status = await qcData.getQCStatus(qc);
    expect(status).to.equal(QCStatus.EMERGENCY_PAUSED);
    
    // AccountControl blocks all operations
    const reserveInfo = await accountControl.reserveInfo(qc);
    expect(reserveInfo.mintingPaused).to.be.true;
    expect(reserveInfo.redeemingPaused).to.be.true;
    
    // QCManager blocks new operations
    const canOperate = await qcManager.canPerformOperation(qc);
    expect(canOperate).to.be.false;
  }
};
```

### Scenario 4: Governance Parameter Change → System Reconfiguration
**Test File**: `test/account-control/integration/governance-parameter-changes.test.ts`

#### Parameter Change Propagation
```typescript
describe("Governance Parameter Changes", () => {
  it("should propagate parameter changes across all contracts", async () => {
    // Initial parameters
    const oldStaleThreshold = await systemState.staleThreshold();
    const oldSyncInterval = await systemState.minSyncInterval();
    
    // Governance changes parameters
    const newStaleThreshold = 48 * 60 * 60; // 48 hours
    const newSyncInterval = 10 * 60; // 10 minutes
    
    await systemState.connect(governance).setStaleThreshold(newStaleThreshold);
    await systemState.connect(governance).setMinSyncInterval(newSyncInterval);
    
    // Validate parameter propagation
    await validateParameterPropagation(newStaleThreshold, newSyncInterval);
    
    // Test operational impact
    await testOperationalImpact(newStaleThreshold, newSyncInterval);
  });
});
```

#### Parameter Impact Validation
```typescript
const testOperationalImpact = async (staleThreshold: number, syncInterval: number) => {
  // Test sync interval enforcement
  await qcManager.syncBackingFromOracle(qcs[0].address);
  
  // Should be rate limited
  await expect(
    qcManager.syncBackingFromOracle(qcs[0].address)
  ).to.be.revertedWith("Rate limited");
  
  // Wait for new interval
  await time.increase(syncInterval + 1);
  
  // Should now succeed
  await expect(
    qcManager.syncBackingFromOracle(qcs[0].address)
  ).to.not.be.reverted;
  
  // Test stale threshold impact
  await time.increase(staleThreshold + 1);
  
  // Oracle data should now be considered stale
  const syncTx = await qcManager.syncBackingFromOracle(qcs[0].address);
  const receipt = await syncTx.wait();
  
  const staleDataEvent = receipt.events?.find(e => 
    e.event === "QCOperation" && 
    e.args?.operation === "STALE_DATA_DETECTED"
  );
  expect(staleDataEvent).to.exist;
};
```

### Scenario 5: Concurrent Operations → Conflict Resolution
**Test File**: `test/account-control/integration/concurrent-operations.test.ts`

#### Race Condition Testing
```typescript
describe("Concurrent Operations", () => {
  it("should handle simultaneous operations consistently", async () => {
    const qc = qcs[0];
    
    // Setup concurrent operations
    const operations = [
      () => qcManager.syncBackingFromOracle(qc.address),
      () => qcManager.connect(governance).increaseMintingCapacity(qc.address, ethers.utils.parseEther("2000")),
      () => pauseManager.connect(watchdog).pauseQC(qc.address, "SUSPICIOUS_ACTIVITY"),
      () => qcManager.connect(arbiter).setQCStatus(qc.address, QCStatus.UNDER_REVIEW, "INVESTIGATION")
    ];
    
    // Execute concurrently
    const results = await Promise.allSettled(
      operations.map(op => op())
    );
    
    // Validate final state consistency
    await validateConcurrentOperationConsistency(qc.address, results);
  });
});
```

#### Consistency Validation
```typescript
const validateConcurrentOperationConsistency = async (
  qcAddress: string, 
  operationResults: PromiseSettledResult<any>[]
) => {
  // Check that state is consistent regardless of operation order
  const qcStatus = await qcData.getQCStatus(qcAddress);
  const accountStatus = await accountControl.getReserveStatus(qcAddress);
  const pauseInfo = await pauseManager.getPauseInfo(qcAddress);
  const oracleData = await qcManager.qcOracleData(qcAddress);
  
  // Validate state relationships
  if (qcStatus === QCStatus.PAUSED || qcStatus === QCStatus.UNDER_REVIEW) {
    expect(accountStatus.mintingPaused).to.be.true;
  }
  
  if (pauseInfo.isPaused) {
    expect(qcStatus).to.not.equal(QCStatus.ACTIVE);
  }
  
  // Validate operation precedence
  const successfulOps = operationResults.filter(r => r.status === "fulfilled");
  const failedOps = operationResults.filter(r => r.status === "rejected");
  
  // At least one operation should succeed
  expect(successfulOps.length).to.be.gte(1);
  
  // Failed operations should not leave partial state
  await validateNoPartialState(qcAddress);
};
```

## Advanced Scenarios

### Scenario 6: Multi-QC Batch Operation with Mixed States
**Complex interaction**: Some QCs healthy, others failing, some paused

### Scenario 7: Oracle Consensus Failure → Dispute Resolution
**Complex interaction**: Multiple oracles providing conflicting data

### Scenario 8: System Upgrade → State Migration → Validation
**Complex interaction**: Contract upgrades with state consistency preservation

### Scenario 9: Resource Exhaustion → Graceful Degradation
**Complex interaction**: Gas limits, memory constraints, performance degradation

### Scenario 10: Long-term Oracle Outage → Extended Fallback → Recovery
**Complex interaction**: Extended periods using cached data, gradual system recovery

## Implementation Framework

### Test Organization Structure
```
test/account-control/integration/cross-contract-scenarios/
├── oracle-failure-cascade.test.ts
├── qc-onboarding-flow.test.ts  
├── emergency-recovery.test.ts
├── governance-parameter-changes.test.ts
├── concurrent-operations.test.ts
├── multi-qc-batch-operations.test.ts
├── oracle-consensus-disputes.test.ts
├── system-upgrade-migration.test.ts
├── resource-exhaustion.test.ts
└── extended-fallback-recovery.test.ts
```

### Common Utilities
```typescript
// Cross-contract state validation utilities
export const validateCrossContractConsistency = async (qcAddress: string) => {
  // Implementation details...
};

// State transition helpers
export const executeStateTransition = async (
  transition: StateTransition,
  validationPoints: ValidationPoint[]
) => {
  // Implementation details...
};

// Concurrent operation test framework
export const testConcurrentOperations = async (
  operations: Operation[],
  expectedOutcomes: ExpectedOutcome[]
) => {
  // Implementation details...
};
```

### Success Criteria

Each scenario must validate:
1. **State Consistency**: All contracts maintain consistent state
2. **Event Ordering**: Events emitted in correct sequence  
3. **Error Handling**: Failures handled gracefully without orphaned state
4. **Performance**: Operations complete within acceptable time/gas limits
5. **Recovery**: System recovers to consistent state after failures

### Execution Timeline

- **Week 1**: Implement Scenarios 1-3 (critical state transitions)
- **Week 2**: Implement Scenarios 4-5 (governance and concurrency)  
- **Week 3**: Implement Advanced Scenarios 6-8
- **Week 4**: Implement Scenarios 9-10 and optimization

This comprehensive test suite will ensure robust cross-contract state management and provide confidence in complex system behaviors.