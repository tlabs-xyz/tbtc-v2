# Deployment Script Security Audit

**Date**: 2025-08-05  
**Scripts Audited**: 95-102  
**Purpose**: Verify proper role assignments and security in Account Control deployment

---

## Executive Summary

The deployment scripts follow a phased approach with proper role separation, but several security concerns were identified:

### Critical Issues
1. **No automatic admin role cleanup** - Deployer retains DEFAULT_ADMIN_ROLE until script 102
2. **Optional governance transfer** - Script 102 can be skipped, leaving deployer with full control
3. **No verification of role transfers** - Scripts don't verify successful role grants

### Recommendations
1. Enforce governance configuration before deployment
2. Add role verification after each grant
3. Implement automatic deployer privilege revocation
4. Add deployment validation script

---

## Script-by-Script Analysis

### Script 95: Deploy Account Control Core
**Purpose**: Deploy core QC management contracts  
**Contracts**: QCManager, QCData, QCMinter, QCRedeemer

**Security Findings**:
- ✅ Contracts deployed with proper constructor arguments
- ⚠️ Deployer becomes DEFAULT_ADMIN_ROLE on all contracts
- ✅ No immediate role grants (follows separation of concerns)

### Script 96: Deploy Account Control State  
**Purpose**: Deploy state management contracts  
**Contracts**: SystemState, QCReserveLedger, ProtocolRegistry, SPVValidator

**Security Findings**:
- ✅ SystemState initialized with secure default parameters
- ⚠️ All contracts have deployer as admin
- ✅ SPVValidator deployed separately (good practice)

### Script 97: Deploy Account Control Policies
**Purpose**: Deploy policy contracts  
**Contracts**: BasicMintingPolicy, BasicRedemptionPolicy

**Security Findings**:
- ✅ Policies linked to core contracts properly
- ✅ Constructor validation ensures required contracts exist
- ⚠️ No role grants yet (done in script 99)

### Script 98: Deploy Account Control Watchdog
**Purpose**: Deploy V1.1 watchdog system  
**Contracts**: WatchdogConsensusManager, WatchdogMonitor

**Security Findings**:
- ✅ Proper dependency injection via constructors
- ✅ Default consensus parameters are secure (2-of-5)
- ⚠️ No watchdog operators configured yet

### Script 99: Configure Account Control System
**Purpose**: Wire up all contracts and grant operational roles

**Critical Role Grants**:
1. **QCManager Roles**:
   - ✅ QC_MANAGER_ROLE → QCData (required for data updates)
   - ✅ ATTESTER_ROLE → QCReserveLedger (for attestations)
   - ✅ QC_ADMIN_ROLE → BasicMintingPolicy (for QC operations)
   - ✅ ARBITER_ROLE → WatchdogConsensusManager (for status changes)

2. **Policy Roles**:
   - ✅ MINTER_ROLE → QCMinter on BasicMintingPolicy
   - ✅ REDEEMER_ROLE → QCRedeemer on BasicRedemptionPolicy
   - ⚠️ MINTER_ROLE → BasicMintingPolicy on TBTC (skipped in test mode)

3. **Watchdog Roles**:
   - ✅ ARBITER_ROLE → WatchdogConsensusManager on QCManager
   - ✅ ARBITER_ROLE → WatchdogConsensusManager on QCRedeemer

**Security Concerns**:
- ❌ No role verification after grants
- ❌ Deployer retains all admin roles
- ⚠️ Service registration could fail silently

### Script 100: Deploy Automated Decision Framework
**Purpose**: Deploy optional V1.2 automation contracts  
**Contracts**: WatchdogAutomatedEnforcement, WatchdogThresholdActions, WatchdogDAOEscalation

**Security Findings**:
- ✅ Optional deployment (good for phased rollout)
- ✅ Proper constructor dependencies
- ⚠️ Additional complexity if partially deployed

### Script 101: Configure Automated Decision Framework
**Purpose**: Configure V1.2 framework roles and parameters

**Role Grants**:
- ✅ ARBITER_ROLE → WatchdogAutomatedEnforcement (on QCManager/QCRedeemer)
- ✅ ESCALATOR_ROLE → WatchdogThresholdActions (on DAOEscalation)
- ✅ SystemState parameters configured

**Security Findings**:
- ✅ Proper role hierarchy maintained
- ⚠️ No validation of parameter values
- ⚠️ Could be run without script 100

### Script 102: Transfer Roles to Governance
**Purpose**: Transfer admin control from deployer to governance

**Critical Transfers**:
1. QC_GOVERNANCE_ROLE in QCManager
2. DEFAULT_ADMIN_ROLE in all contracts
3. Revocation of deployer privileges

**Security Issues**:
- ❌ **Optional execution** - Can be skipped entirely
- ❌ **No enforcement** - Governance address not required
- ⚠️ **Incomplete contract list** - Some contracts might be missed
- ✅ Checks before granting (good practice)
- ✅ Revokes deployer roles (when executed)

---

## Cross-Script Dependencies

### Correct Execution Order
1. Scripts 95-98: Deploy contracts (any order within group)
2. Script 99: Configure system (requires all contracts)
3. Scripts 100-101: Optional V1.2 deployment
4. Script 102: Transfer to governance (critical final step)

### Missing Dependencies
- No script to deploy individual QCWatchdog instances
- No script to add watchdog operators
- No script to register initial QCs

---

## Security Recommendations

### Immediate Actions
1. **Enforce Governance Configuration**
   ```typescript
   if (!governance || governance === deployer) {
     throw new Error("Governance address must be configured")
   }
   ```

2. **Add Role Verification**
   ```typescript
   // After each role grant
   const hasRole = await contract.hasRole(ROLE, recipient)
   if (!hasRole) throw new Error(`Failed to grant ${ROLE}`)
   ```

3. **Implement Deployment Validation**
   - Create script 103_validate_deployment.ts
   - Run automated role verification
   - Check all service registrations
   - Verify no deployer privileges remain

### Long-term Improvements
1. **Two-Step Admin Transfer**
   - Add pending admin mechanism
   - Require explicit acceptance
   - Prevent accidental loss of admin

2. **Deployment State Tracking**
   - Record deployment phase
   - Prevent out-of-order execution
   - Enable safe re-runs

3. **Parameter Validation**
   - Verify all parameters are within safe bounds
   - Check cross-parameter relationships
   - Validate against mainnet values

---

## Risk Assessment

### High Risk
- Deployer retaining admin control (if script 102 skipped)
- Silent failures in role grants
- Missing cross-contract dependencies

### Medium Risk  
- Incorrect execution order
- Partial V1.2 deployment
- Parameter misconfiguration

### Low Risk
- Test mode differences
- Gas optimization settings
- Event emission gaps

---

## Conclusion

The deployment scripts implement a reasonable phased approach but lack critical safety checks. The optional nature of governance transfer (script 102) is the most significant security risk. Implementing the recommended verifications and enforcements would significantly improve deployment security.