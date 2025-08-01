# Account Control Role Management Guide

**Date**: 2025-08-01  
**Purpose**: Document the role structure and transfer process for V1.1 Account Control

---

## Role Structure Overview

### QCManager Roles
- **DEFAULT_ADMIN_ROLE**: Can grant/revoke all other roles
- **QC_GOVERNANCE_ROLE**: Can register new QCs and set minting capacity
- **QC_ADMIN_ROLE**: Can update minting parameters (held by BasicMintingPolicy)
- **REGISTRAR_ROLE**: Can register wallets with SPV proof (held by SingleWatchdog instances)
- **ARBITER_ROLE**: Can change QC status and verify solvency (held by WatchdogConsensusManager)

### QCMinter Roles
- **DEFAULT_ADMIN_ROLE**: Can grant/revoke roles
- **MINTER_ROLE**: Can request minting (granted to individual QCs)

### SystemState Roles
- **DEFAULT_ADMIN_ROLE**: Can grant/revoke roles
- **PARAMETER_ADMIN_ROLE**: Can update system parameters
- **PAUSER_ROLE**: Can pause/unpause system operations

### WatchdogConsensusManager Roles
- **DEFAULT_ADMIN_ROLE**: Can grant/revoke roles
- **MANAGER_ROLE**: Can update consensus parameters
- **WATCHDOG_ROLE**: Can propose and vote on consensus operations

### WatchdogMonitor Roles
- **DEFAULT_ADMIN_ROLE**: Can grant/revoke roles
- **MANAGER_ROLE**: Can register/deactivate watchdog instances
- **WATCHDOG_OPERATOR_ROLE**: Can submit critical reports

## Deployment State

After running deployment scripts (95-99), roles are distributed as follows:

```
Deployer holds:
├── DEFAULT_ADMIN_ROLE (all contracts)
├── QC_GOVERNANCE_ROLE (QCManager)
├── MINTER_ROLE (QCMinter)
├── PARAMETER_ADMIN_ROLE (SystemState)
├── PAUSER_ROLE (SystemState)
├── MANAGER_ROLE (WatchdogConsensusManager)
└── MANAGER_ROLE (WatchdogMonitor)

Contracts hold:
├── BasicMintingPolicy → QC_ADMIN_ROLE (QCManager)
├── WatchdogConsensusManager → ARBITER_ROLE (QCManager, QCRedeemer)
└── SingleWatchdog instances → REGISTRAR_ROLE (QCManager)
    └── SingleWatchdog instances → ATTESTER_ROLE (QCReserveLedger)
```

## Production Setup Process

### Step 1: Configure Governance Account

In `hardhat.config.ts`, ensure governance account is set:
```typescript
namedAccounts: {
  deployer: 0,
  governance: {
    mainnet: "0x...", // DAO governance contract
    goerli: "0x...",  // Test governance
  }
}
```

### Step 2: Deploy Contracts

```bash
npx hardhat deploy --network mainnet --tags AccountControl
```

### Step 3: Transfer Roles to Governance

Run the role transfer script:
```bash
TRANSFER_ROLES_TO_GOVERNANCE=true npx hardhat deploy --network mainnet --tags TransferRolesToGovernance
```

This will:
1. Grant QC_GOVERNANCE_ROLE to governance
2. Grant DEFAULT_ADMIN_ROLE to governance in all contracts
3. Grant PAUSER_ROLE to governance

### Step 4: Governance Completes Transfer

Governance must execute these transactions:

```solidity
// 1. Revoke DEFAULT_ADMIN_ROLE from deployer in all contracts
QCManager.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
QCData.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
// ... repeat for all contracts

// 2. Optionally revoke other roles from deployer
QCManager.revokeRole(QC_GOVERNANCE_ROLE, deployer);
SystemState.revokeRole(PAUSER_ROLE, deployer);
```

### Step 5: Configure Production Watchdogs

```solidity
// 1. Deploy SingleWatchdog instances (done by each operator)
// 2. Register each instance with WatchdogMonitor
WatchdogMonitor.registerWatchdog(singleWatchdog1.address, operator1, "Operator 1");
WatchdogMonitor.registerWatchdog(singleWatchdog2.address, operator2, "Operator 2");
WatchdogMonitor.registerWatchdog(singleWatchdog3.address, operator3, "Operator 3");

// 3. Grant WATCHDOG_ROLE to operators in WatchdogConsensusManager
WatchdogConsensusManager.grantRole(WATCHDOG_ROLE, operator1);
WatchdogConsensusManager.grantRole(WATCHDOG_ROLE, operator2);
WatchdogConsensusManager.grantRole(WATCHDOG_ROLE, operator3);

// 4. Update consensus parameters based on active watchdog count
WatchdogConsensusManager.updateConsensusParams(2, 3); // 2-of-3 consensus

// 5. Remove test operator roles
WatchdogMonitor.revokeRole(WATCHDOG_OPERATOR_ROLE, deployer);
```

### Step 6: Register QCs

Governance can now register Qualified Custodians:

```solidity
// Register a new QC with minting capacity
QCManager.registerQC(qcAddress, 1000 ether); // 1000 tBTC capacity

// Grant MINTER_ROLE to the QC
QCMinter.grantRole(MINTER_ROLE, qcAddress);
```

## Emergency Procedures

### Pausing Operations

If granted PAUSER_ROLE, governance can:
```solidity
SystemState.pauseMinting();      // Stop all minting
SystemState.pauseRedemption();   // Stop all redemptions
SystemState.pauseRegistry();     // Stop QC registrations
```

### Changing QC Status

Through WatchdogConsensusManager (requires M-of-N consensus):
```solidity
// Any watchdog can propose status change
WatchdogConsensusManager.proposeStatusChange(
    qcAddress,
    QCStatus.UnderReview,
    "Suspicious activity detected"
);

// Other watchdogs vote to approve
// Executes automatically when threshold reached
```

### Revoking QC Access

Governance can:
```solidity
// Revoke minting ability
QCMinter.revokeRole(MINTER_ROLE, qcAddress);

// Change QC status (through watchdog consensus)
// This prevents further operations
```

## Security Considerations

1. **Two-Step Transfer**: Always grant new role before revoking old role
2. **Multi-Sig Governance**: Production governance should be a multi-sig or DAO
3. **Emergency Access**: Consider separate emergency multi-sig for PAUSER_ROLE
4. **Watchdog Distribution**: Ensure watchdogs are geographically and organizationally diverse
5. **Role Monitoring**: Set up monitoring for all role changes

## Verification Commands

Check role assignments:
```javascript
// Check who has QC_GOVERNANCE_ROLE
const hasRole = await qcManager.hasRole(
  ethers.utils.id("QC_GOVERNANCE_ROLE"),
  governanceAddress
);

// List all QCs with MINTER_ROLE
const filter = qcMinter.filters.RoleGranted(
  ethers.utils.id("MINTER_ROLE")
);
const events = await qcMinter.queryFilter(filter);
```

## Common Issues

### Issue: "AccessControl: account X is missing role Y"
**Solution**: Ensure the calling account has the required role. Check role assignments.

### Issue: Cannot register QC
**Solution**: Verify governance has QC_GOVERNANCE_ROLE in QCManager.

### Issue: QC cannot mint
**Solution**: Ensure QC has MINTER_ROLE in QCMinter and is registered/active.

### Issue: Watchdog operations fail
**Solution**: Check WatchdogConsensusManager has required roles in target contracts.

## Role Dependency Map

```
DAO Governance
├── Controls QC Registration (QC_GOVERNANCE_ROLE)
├── Controls Role Assignments (DEFAULT_ADMIN_ROLE)
└── Controls Emergency Pauses (PAUSER_ROLE)
    
WatchdogConsensusManager
├── Manages QC Status Changes (ARBITER_ROLE)
└── Executes Consensus Decisions (WATCHDOG_ROLE holders)

WatchdogMonitor
├── Coordinates Multiple Watchdogs (MANAGER_ROLE)
└── Emergency Response (WATCHDOG_OPERATOR_ROLE holders)

SingleWatchdog Instances
├── Register Wallets (REGISTRAR_ROLE)
└── Attest Reserves (ATTESTER_ROLE)
    
Individual QCs
└── Can Mint tBTC (MINTER_ROLE)
```