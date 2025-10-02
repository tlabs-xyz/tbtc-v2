# Multi-Step Operation Test Scenarios

## Overview

Multi-step operations are complex workflows that require multiple transactions and cross-contract coordination. These scenarios test that the system maintains consistency throughout extended operations, handles interruptions gracefully, and ensures atomic completion of multi-phase processes.

## Core Multi-Step Operation Scenarios

### Scenario MS-1: Complete QC Onboarding Workflow
**File**: `test/account-control/integration/multi-step/qc-onboarding-workflow.test.ts`

#### Operation Steps
```
1. Governance approval → 2. QC registration → 3. Wallet setup → 
4. Oracle initialization → 5. AccountControl authorization → 
6. Capacity validation → 7. Operational readiness
```

#### Implementation
```typescript
describe("Complete QC Onboarding Workflow", () => {
  it("should handle complete QC onboarding with state consistency", async () => {
    const newQC = ethers.Wallet.createRandom();
    const workflow = new QCOnboardingWorkflow(newQC.address);
    
    // Step 1: Governance Approval
    await workflow.executeStep1_GovernanceApproval({
      proposalId: "QC_ONBOARD_001",
      qcAddress: newQC.address,
      maxCapacity: ethers.utils.parseEther("5000"),
      votingPeriod: 7 * 24 * 60 * 60 // 7 days
    });
    
    await validateWorkflowStep(workflow, 1, {
      expectedState: "GOVERNANCE_APPROVED",
      requiredApprovals: ["GOVERNANCE_ROLE"],
      nextStepAllowed: true
    });
    
    // Step 2: QC Registration
    await workflow.executeStep2_QCRegistration({
      qcAddress: newQC.address,
      maxMintingCap: ethers.utils.parseEther("5000"),
      reserveType: "PRIMARY"
    });
    
    await validateWorkflowStep(workflow, 2, {
      expectedState: "QC_REGISTERED",
      contractUpdates: ["QCData", "AccountControl"],
      dataConsistency: true
    });
    
    // Step 3: Wallet Setup and Validation
    await workflow.executeStep3_WalletSetup({
      btcAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      publicKey: generateTestPublicKey(),
      signature: generateTestSignature(newQC)
    });
    
    await validateWorkflowStep(workflow, 3, {
      expectedState: "WALLET_REGISTERED",
      walletValidated: true,
      signatureVerified: true
    });
    
    // Step 4: Oracle Data Initialization
    await workflow.executeStep4_OracleInitialization({
      initialBalance: ethers.utils.parseEther("4000"),
      oracleAttestors: [attester1.address, attester2.address],
      consensusThreshold: 2
    });
    
    await validateWorkflowStep(workflow, 4, {
      expectedState: "ORACLE_INITIALIZED",
      oracleDataSynced: true,
      backingVerified: true
    });
    
    // Step 5: AccountControl Authorization
    await workflow.executeStep5_AccountControlAuth();
    
    await validateWorkflowStep(workflow, 5, {
      expectedState: "ACCOUNT_AUTHORIZED",
      mintingCapEnabled: true,
      reserveConfigured: true
    });
    
    // Step 6: Capacity and Security Validation
    await workflow.executeStep6_CapacityValidation();
    
    await validateWorkflowStep(workflow, 6, {
      expectedState: "CAPACITY_VALIDATED",
      securityChecksPass: true,
      operationalLimitsSet: true
    });
    
    // Step 7: Final Operational Readiness
    await workflow.executeStep7_OperationalReadiness();
    
    await validateWorkflowComplete(workflow, {
      qcFullyOperational: true,
      allSystemsIntegrated: true,
      firstOperationReady: true
    });
  });
});
```

#### Workflow Validation Framework
```typescript
class QCOnboardingWorkflow {
  constructor(public qcAddress: string) {}
  
  async validateCrossContractConsistency(): Promise<ValidationResult> {
    // Validate state consistency across all contracts
    const qcInfo = await qcData.getQCInfo(this.qcAddress);
    const accountInfo = await accountControl.reserveInfo(this.qcAddress);
    const walletInfo = await walletManager.getWalletInfo(this.qcAddress);
    const oracleInfo = await qcManager.qcOracleData(this.qcAddress);
    
    return {
      consistent: this.validateDataConsistency(qcInfo, accountInfo, walletInfo, oracleInfo),
      issues: this.identifyInconsistencies(qcInfo, accountInfo, walletInfo, oracleInfo)
    };
  }
  
  async handleStepFailure(step: number, error: Error): Promise<RecoveryResult> {
    // Implement step-specific recovery logic
    switch(step) {
      case 2: return await this.recoverFromRegistrationFailure(error);
      case 3: return await this.recoverFromWalletFailure(error);
      case 4: return await this.recoverFromOracleFailure(error);
      default: return await this.executeGeneralRecovery(step, error);
    }
  }
}
```

### Scenario MS-2: Complex Redemption with Dispute Resolution
**File**: `test/account-control/integration/multi-step/complex-redemption-workflow.test.ts`

#### Operation Steps
```
1. Redemption request → 2. Backing verification → 3. QC processing → 
4. Dispute filed → 5. Investigation period → 6. Arbitration → 
7. Resolution execution → 8. Final settlement
```

#### Implementation
```typescript
describe("Complex Redemption with Dispute Workflow", () => {
  it("should handle disputed redemption with full arbitration", async () => {
    const redemptionAmount = ethers.utils.parseEther("50");
    const user = users[0];
    const qc = qcs[0];
    const workflow = new DisputedRedemptionWorkflow();
    
    // Step 1: Initial redemption request
    const redemptionId = await workflow.executeStep1_RedemptionRequest({
      user: user.address,
      qc: qc.address,
      amount: redemptionAmount,
      btcTargetAddress: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
    });
    
    // Step 2: Backing verification and escrow
    await workflow.executeStep2_BackingVerification(redemptionId);
    
    // Step 3: QC begins processing
    await workflow.executeStep3_QCProcessing(redemptionId);
    
    // Step 4: Dispute filed during processing
    await workflow.executeStep4_DisputeFiled({
      redemptionId,
      disputeReason: "PROCESSING_DELAY",
      evidence: "QC failed to process within SLA",
      disputant: user.address
    });
    
    // Step 5: Investigation period
    await workflow.executeStep5_Investigation({
      investigationPeriod: 3 * 24 * 60 * 60, // 3 days
      evidenceCollection: true,
      stakeholderInput: true
    });
    
    // Step 6: Arbitration process
    await workflow.executeStep6_Arbitration({
      arbiters: [arbiter1.address, arbiter2.address, arbiter3.address],
      votingPeriod: 48 * 60 * 60, // 48 hours
      requiredConsensus: 2
    });
    
    // Step 7: Resolution execution
    await workflow.executeStep7_ResolutionExecution();
    
    // Step 8: Final settlement
    await workflow.executeStep8_FinalSettlement();
    
    await validateWorkflowComplete(workflow, {
      disputeResolved: true,
      userCompensated: true,
      qcStatusUpdated: true,
      systemIntegrityMaintained: true
    });
  });
});
```

### Scenario MS-3: Emergency Recovery with Staged Reactivation
**File**: `test/account-control/integration/multi-step/emergency-recovery-workflow.test.ts`

#### Operation Steps
```
1. Emergency detected → 2. System lockdown → 3. Problem diagnosis → 
4. Fix deployment → 5. Limited testing → 6. Staged reactivation → 
7. Full monitoring → 8. Normal operation
```

#### Implementation
```typescript
describe("Emergency Recovery with Staged Reactivation", () => {
  it("should recover from emergency with staged validation", async () => {
    const emergencyReason = "ORACLE_MANIPULATION_DETECTED";
    const affectedQCs = [qc1.address, qc2.address];
    const workflow = new EmergencyRecoveryWorkflow();
    
    // Step 1: Emergency detection and response
    await workflow.executeStep1_EmergencyDetection({
      trigger: emergencyReason,
      affectedComponents: affectedQCs,
      severity: "CRITICAL",
      autoResponseEnabled: true
    });
    
    // Step 2: Immediate system lockdown
    await workflow.executeStep2_SystemLockdown({
      pauseAllOperations: true,
      freezeGovernance: false, // Keep governance for recovery
      notifyStakeholders: true
    });
    
    // Step 3: Problem diagnosis phase
    await workflow.executeStep3_ProblemDiagnosis({
      diagnosticPeriod: 2 * 60 * 60, // 2 hours
      expertReview: true,
      systemAudit: true
    });
    
    // Step 4: Fix deployment
    await workflow.executeStep4_FixDeployment({
      fixDescription: "Oracle validation enhancement",
      governanceApproval: true,
      testnetValidation: true
    });
    
    // Step 5: Limited testing with subset of QCs
    await workflow.executeStep5_LimitedTesting({
      testQCs: [qc1.address],
      testOperations: ["oracle_sync", "capacity_check"],
      testDuration: 30 * 60 // 30 minutes
    });
    
    // Step 6: Staged reactivation
    await workflow.executeStep6_StagedReactivation({
      stage1QCs: [qc1.address],
      stage2QCs: [qc2.address],
      stageDelay: 15 * 60, // 15 minutes between stages
      monitoringEnabled: true
    });
    
    // Step 7: Full monitoring period
    await workflow.executeStep7_FullMonitoring({
      monitoringPeriod: 4 * 60 * 60, // 4 hours
      alertThresholds: "SENSITIVE",
      rollbackEnabled: true
    });
    
    // Step 8: Return to normal operation
    await workflow.executeStep8_NormalOperation();
    
    await validateWorkflowComplete(workflow, {
      emergencyResolved: true,
      systemFullyOperational: true,
      noDataLoss: true,
      stakeholdersNotified: true
    });
  });
});
```

### Scenario MS-4: Coordinated System Upgrade
**File**: `test/account-control/integration/multi-step/coordinated-upgrade-workflow.test.ts`

#### Operation Steps
```
1. Upgrade proposal → 2. Testing validation → 3. Governance approval → 
4. Deployment preparation → 5. Coordinated deployment → 6. State migration → 
7. Integration testing → 8. Rollback capability → 9. Production validation
```

#### Implementation
```typescript
describe("Coordinated System Upgrade Workflow", () => {
  it("should execute system-wide upgrade with state consistency", async () => {
    const upgradeId = "UPGRADE_V2_1_0";
    const upgradedContracts = ["QCManager", "QCData", "AccountControl"];
    const workflow = new SystemUpgradeWorkflow(upgradeId);
    
    // Step 1: Upgrade proposal
    await workflow.executeStep1_UpgradeProposal({
      upgradeId,
      contracts: upgradedContracts,
      migrationRequired: true,
      backwardCompatible: false
    });
    
    // Step 2: Comprehensive testing
    await workflow.executeStep2_TestingValidation({
      unitTestsPassed: true,
      integrationTestsPassed: true,
      performanceTestsPassed: true,
      securityAuditPassed: true
    });
    
    // Step 3: Governance approval process
    await workflow.executeStep3_GovernanceApproval({
      votingPeriod: 7 * 24 * 60 * 60, // 7 days
      quorumRequired: "MAJORITY",
      timelockDelay: 48 * 60 * 60 // 48 hours
    });
    
    // Step 4: Pre-deployment preparation
    await workflow.executeStep4_DeploymentPreparation({
      stateSnapshot: true,
      rollbackPlan: true,
      emergencyContacts: true
    });
    
    // Step 5: Coordinated deployment
    await workflow.executeStep5_CoordinatedDeployment({
      deploymentOrder: upgradedContracts,
      atomicDeployment: true,
      rollbackOnFailure: true
    });
    
    // Step 6: State migration
    await workflow.executeStep6_StateMigration({
      migrationScripts: true,
      dataValidation: true,
      consistencyChecks: true
    });
    
    // Step 7: Post-upgrade integration testing
    await workflow.executeStep7_IntegrationTesting({
      testSuite: "COMPREHENSIVE",
      performanceValidation: true,
      regressionTesting: true
    });
    
    // Step 8: Rollback capability verification
    await workflow.executeStep8_RollbackVerification({
      rollbackTested: true,
      rollbackTime: "< 30 minutes",
      dataIntegrityVerified: true
    });
    
    // Step 9: Production validation
    await workflow.executeStep9_ProductionValidation({
      monitoringPeriod: 24 * 60 * 60, // 24 hours
      performanceBaseline: true,
      userAcceptanceTesting: true
    });
    
    await validateWorkflowComplete(workflow, {
      upgradeSuccessful: true,
      systemStable: true,
      performanceImproved: true,
      rollbackCapable: true
    });
  });
});
```

## Advanced Multi-Step Scenarios

### Scenario MS-5: Multi-QC Capacity Rebalancing
**Complex coordination**: Redistributing capacity across multiple QCs based on performance and backing

### Scenario MS-6: Oracle Consensus Rebuilding  
**Complex coordination**: Rebuilding oracle consensus after partial oracle network failure

### Scenario MS-7: Cross-Chain State Synchronization
**Complex coordination**: Synchronizing QC state across multiple blockchain networks

## Test Infrastructure Requirements

### Multi-Step Workflow Framework
```typescript
abstract class MultiStepWorkflow {
  protected steps: WorkflowStep[] = [];
  protected currentStep: number = 0;
  protected state: WorkflowState = {};
  
  abstract defineSteps(): WorkflowStep[];
  
  async executeWorkflow(): Promise<WorkflowResult> {
    for (const step of this.steps) {
      try {
        await this.executeStep(step);
        await this.validateStep(step);
        this.currentStep++;
      } catch (error) {
        return await this.handleStepFailure(step, error);
      }
    }
    return { success: true, finalState: this.state };
  }
  
  async validateStep(step: WorkflowStep): Promise<void> {
    // Cross-contract consistency validation
    await this.validateCrossContractState();
    
    // Step-specific validation
    await step.validate(this.state);
    
    // Checkpoint creation
    await this.createCheckpoint();
  }
  
  abstract handleStepFailure(step: WorkflowStep, error: Error): Promise<RecoveryResult>;
}
```

### State Consistency Validation
```typescript
interface StateConsistencyValidator {
  // Validate state across all contracts
  validateGlobalConsistency(): Promise<ConsistencyResult>;
  
  // Check specific contract relationships
  validateContractRelationships(
    contracts: Contract[],
    relationships: Relationship[]
  ): Promise<RelationshipValidation>;
  
  // Identify and report inconsistencies
  identifyInconsistencies(): Promise<InconsistencyReport>;
  
  // Suggest remediation actions
  suggestRemediation(
    inconsistencies: Inconsistency[]
  ): Promise<RemediationPlan>;
}
```

### Recovery and Rollback Framework
```typescript
interface WorkflowRecoveryManager {
  // Create workflow checkpoints
  createCheckpoint(step: number, state: WorkflowState): Promise<CheckpointId>;
  
  // Rollback to previous checkpoint
  rollbackToCheckpoint(checkpointId: CheckpointId): Promise<RollbackResult>;
  
  // Forward recovery from failure
  recoverFromFailure(
    failurePoint: number,
    recoveryStrategy: RecoveryStrategy
  ): Promise<RecoveryResult>;
  
  // Alternative workflow paths
  executeAlternativePath(
    alternativePath: WorkflowPath
  ): Promise<AlternativeResult>;
}
```

## Interruption and Recovery Testing

### Planned Interruptions
```typescript
describe("Workflow Interruption Handling", () => {
  it("should handle planned interruptions gracefully", async () => {
    const workflow = new QCOnboardingWorkflow(qc.address);
    
    // Execute first 3 steps
    await workflow.executeSteps(1, 3);
    
    // Planned interruption (governance pause)
    await systemState.enableMaintenanceMode();
    
    // Attempt to continue - should be blocked
    await expect(
      workflow.executeStep(4)
    ).to.be.revertedWith("MaintenanceModeActive");
    
    // Resume after maintenance
    await systemState.disableMaintenanceMode();
    await workflow.resumeFromStep(4);
    
    await validateWorkflowComplete(workflow);
  });
});
```

### Failure Recovery Testing
```typescript
describe("Workflow Failure Recovery", () => {
  it("should recover from mid-workflow failures", async () => {
    const workflow = new DisputedRedemptionWorkflow();
    
    // Execute until arbitration step
    await workflow.executeSteps(1, 5);
    
    // Simulate arbitration failure
    await simulateArbitrationFailure();
    
    // Should automatically trigger recovery
    const recoveryResult = await workflow.handleStepFailure(6, error);
    
    expect(recoveryResult.success).to.be.true;
    expect(recoveryResult.alternativePath).to.equal("GOVERNANCE_RESOLUTION");
    
    await validateWorkflowComplete(workflow);
  });
});
```

## Success Criteria

Each multi-step operation scenario must demonstrate:

1. **Step Atomicity**: Each step completes fully or fails cleanly
2. **State Consistency**: System state remains consistent between steps
3. **Failure Recovery**: Graceful handling of step failures with recovery
4. **Progress Tracking**: Clear visibility into workflow progress
5. **Rollback Capability**: Ability to rollback to previous valid state
6. **Performance Optimization**: Efficient execution with minimal gas usage

## Implementation Timeline

- **Week 1**: MS-1, MS-2 (QC onboarding and redemption workflows)
- **Week 2**: MS-3, MS-4 (Emergency recovery and system upgrade)  
- **Week 3**: MS-5, MS-6 (Advanced scenarios)
- **Week 4**: Interruption testing and optimization

This comprehensive testing ensures complex operations maintain system integrity throughout their execution lifecycle.