# Account Control System Role Matrix

**Document Version**: 1.0  
**Date**: 2025-08-05  
**Purpose**: Comprehensive documentation of all roles, permissions, and access control in the Account Control system

---

## Table of Contents

1. [Role Overview](#role-overview)
2. [Role Definitions](#role-definitions)
3. [Contract-Role Mapping](#contract-role-mapping)
4. [Cross-Contract Dependencies](#cross-contract-dependencies)
5. [Role Lifecycle](#role-lifecycle)
6. [Security Considerations](#security-considerations)

---

## Role Overview

The Account Control system implements 17 distinct roles across multiple contracts, following OpenZeppelin's AccessControl pattern.

### Role Categories

1. **Administrative Roles**
   - `DEFAULT_ADMIN_ROLE`: Ultimate admin authority in all contracts
   - `PARAMETER_ADMIN_ROLE`: System parameter management
   - `MANAGER_ROLE`: Operational management and configuration

2. **Operational Roles**
   - `PAUSER_ROLE`: Emergency pause capabilities
   - `MINTER_ROLE`: Authorization to mint tBTC
   - `REDEEMER_ROLE`: Process redemption requests
   - `ARBITER_ROLE`: Handle disputes and full status changes

3. **Watchdog Roles**
   - `WATCHDOG_ROLE`: Participate in consensus voting
   - `WATCHDOG_OPERATOR_ROLE`: Individual watchdog operations
   - `WATCHDOG_ENFORCER_ROLE`: Limited enforcement (UnderReview only)
   - `ATTESTER_ROLE`: Submit reserve attestations
   - `REGISTRAR_ROLE`: Register Bitcoin wallets

4. **QC Management Roles**
   - `QC_ADMIN_ROLE`: QC administrative operations
   - `QC_MANAGER_ROLE`: Modify QC data
   - `QC_GOVERNANCE_ROLE`: QC governance decisions

5. **Escalation Roles**
   - `ESCALATOR_ROLE`: Create DAO escalation proposals

---

## Role Definitions

### DEFAULT_ADMIN_ROLE (0x0000...0000)
- **Purpose**: Ultimate administrative control
- **Capabilities**:
  - Grant and revoke any role
  - Transfer admin privileges
  - Emergency recovery actions
- **Holders**: 
  - Initially: Deployer
  - Post-deployment: Governance multisig
- **Contracts**: All AccessControl contracts

### PARAMETER_ADMIN_ROLE
- **Purpose**: Manage system-wide parameters
- **Capabilities**:
  - Update mint amounts (min/max)
  - Set timeouts and thresholds
  - Configure collateral ratios
  - Set emergency council
- **Holders**: Governance or DAO timelock
- **Contracts**: SystemState

### PAUSER_ROLE
- **Purpose**: Emergency response capabilities
- **Capabilities**:
  - Pause minting operations
  - Pause redemptions
  - Pause registry operations
  - Pause wallet registrations
- **Holders**: 
  - Governance multisig
  - Emergency council (optional)
  - Automated monitoring systems
- **Contracts**: SystemState

### MANAGER_ROLE
- **Purpose**: Operational management
- **Capabilities**:
  - Configure watchdog parameters
  - Update operational settings
  - Manage contract integrations
- **Holders**: Governance or operations team
- **Contracts**: 
  - WatchdogConsensusManager
  - WatchdogMonitor
  - WatchdogAutomatedEnforcement
  - WatchdogThresholdActions
  - WatchdogDAOEscalation

### WATCHDOG_ROLE
- **Purpose**: Participate in M-of-N consensus
- **Capabilities**:
  - Propose status changes
  - Vote on proposals
  - Propose wallet deregistration
  - Flag redemption defaults
- **Holders**: Individual watchdog operators (KYC'd entities)
- **Contracts**: 
  - WatchdogConsensusManager
  - WatchdogThresholdActions
  - WatchdogAutomatedEnforcement

### WATCHDOG_OPERATOR_ROLE
- **Purpose**: Individual watchdog operations
- **Capabilities**:
  - Submit reserve attestations
  - Register wallets with SPV proofs
  - Record redemption fulfillments
  - Raise operational concerns
  - Submit critical reports
- **Holders**: QCWatchdog contract operators
- **Contracts**: 
  - QCWatchdog (individual instances)
  - WatchdogMonitor

### MINTER_ROLE
- **Purpose**: Authorization to mint tBTC
- **Capabilities**:
  - Execute minting operations
  - Credit QC-backed deposits
- **Holders**: 
  - QCMinter → BasicMintingPolicy
  - BasicMintingPolicy → TBTC token
- **Contracts**: 
  - BasicMintingPolicy
  - TBTC (external)

### REDEEMER_ROLE
- **Purpose**: Process redemption requests
- **Capabilities**:
  - Initiate redemptions
  - Update redemption status
- **Holders**: 
  - QCRedeemer → BasicRedemptionPolicy
- **Contracts**: 
  - QCRedeemer
  - BasicRedemptionPolicy

### ARBITER_ROLE
- **Purpose**: Authority for disputes and status changes
- **Capabilities**:
  - Change QC status (any valid transition)
  - Flag defaulted redemptions
  - Handle dispute resolution
- **Holders**: 
  - Governance multisig
  - Emergency responders
- **Contracts**: 
  - QCManager
  - QCRedeemer
  - BasicRedemptionPolicy

### WATCHDOG_ENFORCER_ROLE
- **Purpose**: Limited enforcement authority for objective violations
- **Capabilities**:
  - ONLY set QCs to UnderReview status
  - Cannot set Active or Revoked status
  - Used for automated enforcement of collateral violations
- **Holders**: 
  - WatchdogEnforcer contract (not individuals)
- **Contracts**: QCManager

### ATTESTER_ROLE
- **Purpose**: Submit reserve attestations
- **Capabilities**:
  - Attest to Bitcoin reserve balances
  - Update reserve records
- **Holders**: QCWatchdog instances
- **Contracts**: QCReserveLedger

### REGISTRAR_ROLE
- **Purpose**: Register Bitcoin wallets
- **Capabilities**:
  - Register new wallets with SPV proofs
  - Request wallet deregistration
- **Holders**: QCWatchdog instances
- **Contracts**: QCManager

### QC_ADMIN_ROLE
- **Purpose**: QC administrative operations
- **Capabilities**:
  - Register new QCs
  - Update QC capacity
  - Manage QC lifecycle
- **Holders**: 
  - Governance
  - BasicMintingPolicy (for specific operations)
- **Contracts**: QCManager

### QC_MANAGER_ROLE
- **Purpose**: Modify QC data
- **Capabilities**:
  - Update QC information
  - Modify QC state
- **Holders**: QCManager contract
- **Contracts**: QCData

### QC_GOVERNANCE_ROLE
- **Purpose**: QC governance decisions
- **Capabilities**:
  - Major QC policy changes
  - Strategic decisions
- **Holders**: Governance/DAO
- **Contracts**: QCManager

### ESCALATOR_ROLE
- **Purpose**: Create DAO escalation proposals
- **Capabilities**:
  - Escalate threshold actions to DAO
  - Create governance proposals
- **Holders**: 
  - WatchdogThresholdActions
  - Governance members
- **Contracts**: WatchdogDAOEscalation

---

## Contract-Role Mapping

### SystemState
- `DEFAULT_ADMIN_ROLE`: Full control
- `PARAMETER_ADMIN_ROLE`: Parameter updates
- `PAUSER_ROLE`: Pause operations

### QCManager
- `DEFAULT_ADMIN_ROLE`: Full control
- `QC_ADMIN_ROLE`: QC administration
- `QC_GOVERNANCE_ROLE`: Governance decisions
- `REGISTRAR_ROLE`: Wallet registration
- `ARBITER_ROLE`: Status changes (any valid transition)
- `WATCHDOG_ENFORCER_ROLE`: Limited status changes (only to UnderReview)

### QCData
- `DEFAULT_ADMIN_ROLE`: Full control
- `QC_MANAGER_ROLE`: Data modifications

### QCMinter
- `DEFAULT_ADMIN_ROLE`: Full control
- `MINTER_ROLE`: Execute minting

### QCRedeemer
- `DEFAULT_ADMIN_ROLE`: Full control
- `REDEEMER_ROLE`: Process redemptions
- `ARBITER_ROLE`: Handle defaults

### QCReserveLedger
- `DEFAULT_ADMIN_ROLE`: Full control
- `ATTESTER_ROLE`: Submit attestations

### BasicMintingPolicy
- `DEFAULT_ADMIN_ROLE`: Full control
- `MINTER_ROLE`: Authorized minter

### BasicRedemptionPolicy
- `DEFAULT_ADMIN_ROLE`: Full control
- `REDEEMER_ROLE`: Process redemptions
- `ARBITER_ROLE`: Handle disputes

### QCWatchdog (Individual Instances)
- `DEFAULT_ADMIN_ROLE`: Full control
- `WATCHDOG_OPERATOR_ROLE`: All operations

### WatchdogConsensusManager
- `DEFAULT_ADMIN_ROLE`: Full control
- `MANAGER_ROLE`: Configuration
- `WATCHDOG_ROLE`: Voting rights

### WatchdogMonitor
- `DEFAULT_ADMIN_ROLE`: Full control
- `MANAGER_ROLE`: Configuration
- `WATCHDOG_OPERATOR_ROLE`: Report submission

### WatchdogAutomatedEnforcement
- `DEFAULT_ADMIN_ROLE`: Full control
- `MANAGER_ROLE`: Configuration
- `WATCHDOG_ROLE`: Trigger enforcement

### WatchdogThresholdActions
- `DEFAULT_ADMIN_ROLE`: Full control
- `MANAGER_ROLE`: Configuration
- `WATCHDOG_ROLE`: Submit reports

### WatchdogDAOEscalation
- `DEFAULT_ADMIN_ROLE`: Full control
- `MANAGER_ROLE`: Configuration
- `ESCALATOR_ROLE`: Create proposals

---

## Cross-Contract Dependencies

### Critical Role Grants

1. **WatchdogConsensusManager needs:**
   - `ARBITER_ROLE` in QCManager (for status changes)
   - `ARBITER_ROLE` in QCRedeemer (for defaults)

2. **WatchdogAutomatedEnforcement needs:**
   - `ARBITER_ROLE` in QCManager
   - `ARBITER_ROLE` in QCRedeemer

3. **QCWatchdog instances need:**
   - `ATTESTER_ROLE` in QCReserveLedger
   - `REGISTRAR_ROLE` in QCManager
   - `ARBITER_ROLE` in QCManager (optional)
   - `ARBITER_ROLE` in QCRedeemer (optional)

4. **BasicMintingPolicy needs:**
   - `QC_ADMIN_ROLE` in QCManager
   - `MINTER_ROLE` in TBTC token

5. **QCMinter needs:**
   - `MINTER_ROLE` in BasicMintingPolicy

6. **QCRedeemer needs:**
   - `REDEEMER_ROLE` in BasicRedemptionPolicy

7. **QCManager needs:**
   - `QC_MANAGER_ROLE` in QCData

---

## Role Lifecycle

### Deployment Phase (Scripts 95-99)
1. Contracts deployed with deployer as `DEFAULT_ADMIN_ROLE`
2. Operational roles granted to contracts
3. Service registrations completed
4. Cross-contract permissions established

### Configuration Phase (Scripts 100-101)
1. v1 framework roles configured
2. Additional automated enforcement roles
3. Threshold and escalation permissions

### Governance Transfer (Script 102)
1. Grant governance all admin roles
2. Revoke deployer admin privileges
3. Verify complete transfer
4. Document final state

### Operational Phase
1. Watchdog operators receive `WATCHDOG_ROLE`
2. QCWatchdog instances deployed and configured
3. Emergency responders get `PAUSER_ROLE`
4. Regular role audits performed

---

## Security Considerations

### Best Practices

1. **Principle of Least Privilege**
   - Grant minimum required permissions
   - Separate operational from admin roles
   - Time-bound temporary permissions

2. **Role Separation**
   - Admin roles: Governance only
   - Operational roles: Specific operators
   - Emergency roles: Limited distribution

3. **Access Control Patterns**
   ```solidity
   modifier onlyRole(bytes32 role) {
       require(hasRole(role, msg.sender), "Missing role");
       _;
   }
   ```

4. **Role Transfer Safety**
   - Two-step transfer process recommended
   - Verify recipient before revoking sender
   - Test permissions after transfer

### Risk Mitigation

1. **Admin Role Loss**
   - Multiple admin holders
   - Recovery mechanisms
   - Regular backups of role state

2. **Privilege Escalation**
   - Regular role audits
   - Event monitoring
   - Automated alerts

3. **Emergency Response**
   - Clear pause procedures
   - Multiple pause authorities
   - Maximum pause durations

### Audit Checklist

- [ ] All contracts have governance as admin
- [ ] Deployer has no remaining privileges
- [ ] Cross-contract dependencies satisfied
- [ ] Emergency roles properly distributed
- [ ] No unexpected role assignments
- [ ] Role admin chains correct
- [ ] Event logs match expected state

---

## Appendix: Role Identifiers

```solidity
// Standard Roles
bytes32 constant DEFAULT_ADMIN_ROLE = 0x00;

// System Roles
bytes32 constant PARAMETER_ADMIN_ROLE = keccak256("PARAMETER_ADMIN_ROLE");
bytes32 constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
bytes32 constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

// Operational Roles
bytes32 constant MINTER_ROLE = keccak256("MINTER_ROLE");
bytes32 constant REDEEMER_ROLE = keccak256("REDEEMER_ROLE");
bytes32 constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
bytes32 constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
bytes32 constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

// Watchdog Roles
bytes32 constant WATCHDOG_ROLE = keccak256("WATCHDOG_ROLE");
bytes32 constant WATCHDOG_OPERATOR_ROLE = keccak256("WATCHDOG_OPERATOR_ROLE");

// QC Roles
bytes32 constant QC_ADMIN_ROLE = keccak256("QC_ADMIN_ROLE");
bytes32 constant QC_MANAGER_ROLE = keccak256("QC_MANAGER_ROLE");
bytes32 constant QC_GOVERNANCE_ROLE = keccak256("QC_GOVERNANCE_ROLE");

// Escalation Roles
bytes32 constant ESCALATOR_ROLE = keccak256("ESCALATOR_ROLE");
```