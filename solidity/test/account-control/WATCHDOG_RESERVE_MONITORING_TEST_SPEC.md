# Watchdog Reserve Monitoring Test Specification

**Date**: 2025-08-01  
**Purpose**: Comprehensive test scenarios for watchdog detection of QC fund movements  
**Status**: Test specification for implementation

---

## Overview

This document specifies test scenarios to ensure watchdogs can properly detect when QC reserves decrease (indicating potential fund movement) and respond appropriately. These tests address a critical gap in the current test coverage.

## Test Categories

### 1. Reserve Decrease Detection Tests
**File**: `test/account-control/WatchdogReserveMonitoring.test.ts`

#### Test 1.1: Basic Reserve Decrease Detection
```typescript
describe("Basic Reserve Decrease Detection", () => {
  it("should detect and report reserve decrease while maintaining solvency", async () => {
    // Setup
    // - Initial attestation: 100 BTC reserves, 50 tBTC minted
    // - QC moves 30 BTC out (simulated by next attestation showing 70 BTC)
    
    // Expected behavior:
    // - Watchdog detects 30% decrease
    // - Emits ReserveDecreaseDetected event
    // - System still considers QC solvent (70 > 50)
    // - QC remains Active but flagged for monitoring
  })
})
```

#### Test 1.2: Critical Reserve Decrease Leading to Insolvency
```typescript
describe("Critical Reserve Decrease", () => {
  it("should detect insolvency from reserve decrease", async () => {
    // Setup
    // - Initial attestation: 100 BTC reserves, 80 tBTC minted
    // - QC moves 40 BTC out (next attestation shows 60 BTC)
    
    // Expected behavior:
    // - Watchdog detects 40% decrease AND insolvency (60 < 80)
    // - QC status changes to UnderReview
    // - Minting is immediately blocked
    // - Critical alert emitted
  })
})
```

#### Test 1.3: Gradual Reserve Depletion Pattern
```typescript
describe("Gradual Depletion Detection", () => {
  it("should track pattern of gradual decreases", async () => {
    // Setup
    // - Multiple attestations: 100 → 90 → 80 → 70 BTC
    // - Each decrease is 10%
    
    // Expected behavior:
    // - System tracks depletion pattern
    // - Warning triggered when reserves approach minted amount
    // - Predictive alert if trend continues
  })
})
```

### 2. Consensus-Based Reserve Monitoring
**File**: `test/account-control/ConsensusReserveDetection.test.ts`

#### Test 2.1: Multiple Watchdogs Detect Same Reserve Change
```typescript
describe("Consensus on Reserve Change", () => {
  it("should form consensus when multiple watchdogs report same decrease", async () => {
    // Setup
    // - Initial state: 100 BTC reserves
    // - 3 watchdogs independently detect and report 70 BTC
    
    // Expected behavior:
    // - Consensus forms on 70 BTC balance
    // - Single action taken (not duplicate)
    // - High confidence indicator due to consensus
  })
})
```

#### Test 2.2: Conflicting Reserve Reports
```typescript
describe("Conflicting Reports Resolution", () => {
  it("should handle conflicting reserve reports", async () => {
    // Setup
    // - Watchdog A reports 100 BTC (stale or compromised)
    // - Watchdog B reports 70 BTC (correct)
    // - Watchdog C reports 75 BTC (timing difference)
    
    // Expected behavior:
    // - Voting mechanism activates
    // - Investigation flag raised
    // - Conservative approach taken (assume lower balance)
  })
})
```

#### Test 2.3: Byzantine Watchdog Scenario
```typescript
describe("Byzantine Fault Tolerance", () => {
  it("should handle malicious watchdog reporting false reserves", async () => {
    // Setup
    // - 1 watchdog reports false high reserves (100 BTC)
    // - 4 watchdogs report correct lower reserves (60 BTC)
    
    // Expected behavior:
    // - System trusts majority (60 BTC)
    // - Byzantine watchdog flagged
    // - Alert sent about discrepancy
  })
})
```

### 3. Emergency Response Tests
**File**: `test/account-control/WatchdogEmergencyResponse.test.ts`

#### Test 3.1: Large Balance Drop Emergency
```typescript
describe("Emergency Response to Large Drop", () => {
  it("should trigger emergency response for 50%+ decrease", async () => {
    // Setup
    // - Attestation shows drop from 100 to 45 BTC (55% decrease)
    
    // Expected behavior:
    // - Multiple watchdogs submit critical reports
    // - Emergency pause triggered after 3 reports
    // - DAO emergency notification sent
    // - All QC operations frozen
  })
})
```

#### Test 3.2: Rapid Sequential Withdrawals Detection
```typescript
describe("Pattern-Based Emergency Detection", () => {
  it("should detect rapid withdrawal pattern", async () => {
    // Setup
    // - Hour 1: 100 → 95 BTC
    // - Hour 2: 95 → 89 BTC  
    // - Hour 3: 89 → 82 BTC
    // - Hour 4: 82 → 74 BTC
    
    // Expected behavior:
    // - Pattern detection triggers after 3rd decrease
    // - Emergency response despite small individual changes
    // - Velocity-based alert system activates
  })
})
```

#### Test 3.3: Strategic Attestation for Critical Situations
```typescript
describe("Strategic Attestation Usage", () => {
  it("should use strategic attestation for immediate response", async () => {
    // Setup
    // - Massive reserve decrease detected
    // - Standard consensus too slow
    
    // Expected behavior:
    // - Watchdog invokes strategicAttestation
    // - Immediate status change to UnderReview
    // - Bypasses normal voting delay
    // - Other watchdogs alerted to verify
  })
})
```

### 4. Integration Tests
**File**: `test/integration/account-control/ReserveMovementIntegration.test.ts`

#### Test 4.1: Full Detection and Response Flow
```typescript
describe("Complete Reserve Movement Response", () => {
  it("should execute full detection-to-resolution flow", async () => {
    // Comprehensive test covering:
    // 1. Initial state: 100 BTC reserves, 60 tBTC minted
    // 2. Fund movement: attestation shows 50 BTC
    // 3. Detection: Watchdogs identify decrease and insolvency
    // 4. Response: Status change, minting blocked
    // 5. Remediation: QC must add reserves
    // 6. Resolution: Status restored or QC revoked
  })
})
```

#### Test 4.2: Wallet Deregistration During Low Reserves
```typescript
describe("Deregistration with Reserve Constraints", () => {
  it("should handle deregistration attempt during low reserves", async () => {
    // Setup
    // - QC has multiple wallets
    // - Reserves are barely sufficient
    // - QC attempts to deregister a wallet
    
    // Expected behavior:
    // - Watchdog must attest during deregistration
    // - System prevents if it would cause insolvency
    // - Atomic operation ensures consistency
  })
})
```

#### Test 4.3: System-Wide Coordinated Attack Detection
```typescript
describe("Multi-QC Attack Pattern", () => {
  it("should detect coordinated reserve movements", async () => {
    // Setup
    // - 3 QCs show simultaneous 40% decreases
    // - Within 1-hour window
    
    // Expected behavior:
    // - System-wide alert triggered
    // - All QC operations paused
    // - Emergency DAO vote initiated
    // - Pattern analysis report generated
  })
})
```

### 5. Edge Case Tests
**File**: `test/account-control/ReserveMonitoringEdgeCases.test.ts`

#### Test 5.1: Reserve Recovery After Decrease
```typescript
describe("Reserve Recovery Handling", () => {
  it("should handle reserve increase after concerning decrease", async () => {
    // Setup
    // - Reserves drop: 100 → 60 BTC
    // - Before action: reserves increase to 110 BTC
    
    // Expected behavior:
    // - System notes recovery
    // - Pending actions cancelled
    // - QC remains on watch list
    // - Historical pattern recorded
  })
})
```

#### Test 5.2: Mid-Movement Attestation Timing
```typescript
describe("Attestation During Movement", () => {
  it("should handle attestations during active fund movement", async () => {
    // Setup
    // - Funds being moved in Bitcoin network
    // - Watchdog A attests during movement
    // - Watchdog B attests after completion
    
    // Expected behavior:
    // - System recognizes timing discrepancy
    // - Waits for consensus before action
    // - Flags for manual review if needed
  })
})
```

#### Test 5.3: Stale Data vs Actual Movement
```typescript
describe("Distinguishing Stale Data from Movement", () => {
  it("should differentiate between stale attestation and fund movement", async () => {
    // Setup
    // - Last attestation: 30 days old showing 100 BTC
    // - New attestation: shows 70 BTC
    
    // Expected behavior:
    // - System requests intermediate attestations
    // - Checks blockchain for transaction evidence
    // - Makes informed decision on actual timing
  })
})
```

### 6. WatchdogMonitor Critical Reporting
**File**: `test/account-control/WatchdogMonitorReporting.test.ts`

#### Test 6.1: Critical Report Workflow
```typescript
describe("Critical Report Submission", () => {
  it("should process critical report for major reserve decrease", async () => {
    // Setup
    // - Watchdog detects 40% decrease
    
    // Expected behavior:
    // - submitCriticalReport called with details
    // - Report stored with timestamp
    // - Other watchdogs notified
    // - Verification period begins
  })
})
```

#### Test 6.2: Threshold-Based Emergency Trigger
```typescript
describe("Emergency Threshold Activation", () => {
  it("should trigger emergency when report threshold met", async () => {
    // Setup
    // - 3 watchdogs submit critical reports within 1 hour
    
    // Expected behavior:
    // - CRITICAL_REPORTS_THRESHOLD reached
    // - Emergency pause activated
    // - Governance notification sent
    // - 24-hour resolution period begins
  })
})
```

#### Test 6.3: False Alarm Recovery
```typescript
describe("False Alarm Handling", () => {
  it("should properly clear false emergency alerts", async () => {
    // Setup
    // - Critical reports submitted
    // - Investigation reveals technical error
    
    // Expected behavior:
    // - Manager can clear emergency status
    // - Operations resume normally
    // - Incident logged for analysis
    // - Watchdog reputation tracking
  })
})
```

## Implementation Helpers

### Reserve Change Simulator
```typescript
async function simulateReserveChange(
  qcWatchdog: Contract,
  qc: string,
  oldBalance: BigNumber,
  newBalance: BigNumber,
  watchdogs: Signer[]
): Promise<SimulationResult> {
  const results = [];
  
  for (const watchdog of watchdogs) {
    const tx = await qcWatchdog
      .connect(watchdog)
      .attestReserves(qc, newBalance);
    results.push(await tx.wait());
  }
  
  return {
    transactions: results,
    percentageChange: oldBalance.sub(newBalance).mul(100).div(oldBalance),
    consensusReached: results.length >= 2
  };
}
```

### Pattern Detection Helper
```typescript
interface ReservePattern {
  timestamps: number[];
  balances: BigNumber[];
  
  getVelocity(): number;
  predictNextBalance(): BigNumber;
  isAnomalous(): boolean;
}

function analyzeReservePattern(
  attestations: Attestation[]
): ReservePattern {
  // Implementation for pattern analysis
}
```

### Emergency Response Validator
```typescript
async function validateEmergencyResponse(
  monitor: Contract,
  qc: string,
  expectedState: EmergencyState
): Promise<void> {
  const isPaused = await monitor.isEmergencyPaused(qc);
  const reportCount = await monitor.getRecentReportCount(qc);
  
  expect(isPaused).to.equal(expectedState.paused);
  expect(reportCount).to.be.gte(expectedState.minReports);
}
```

## Event Definitions for Testing

```solidity
// Add to QCWatchdog or WatchdogMonitor
event SignificantReserveDecrease(
    address indexed qc,
    uint256 previousBalance,
    uint256 newBalance,
    uint256 percentageDecrease,
    address detectedBy
);

event ReserveDepletionPattern(
    address indexed qc,
    uint256 velocity, // BTC per hour
    uint256 projectedEmpty, // timestamp
    uint8 confidence // 0-100
);

event ConsensusDiscrepancy(
    address indexed qc,
    address[] reporters,
    uint256[] reportedBalances,
    uint256 variance
);
```

## Test Execution Strategy

1. **Unit Tests First**: Implement individual component tests
2. **Integration Tests**: Test full workflows
3. **Stress Tests**: High-frequency attestation scenarios
4. **Failure Mode Tests**: Network issues, timing problems
5. **Performance Tests**: Gas optimization for emergency paths

## Success Criteria

- All scenarios pass with appropriate responses
- Gas costs remain reasonable even in emergency scenarios
- No false positives in normal operation
- Clear audit trail for all decisions
- Timely response to genuine threats

## Future Enhancements

1. Machine learning for pattern detection
2. Cross-chain reserve verification
3. Automated reserve rebalancing suggestions
4. Reputation system for watchdog accuracy
5. Integration with external monitoring services