# tBTC v2 Account Control - Requirements Specification

**Document Version**: 4.0  
**Date**: 2025-08-06  
**Architecture**: Simplified Watchdog System (Post-Migration)  
**Purpose**: Complete requirements specification (source of truth)  
**Related Documents**: [README.md](README.md), [ARCHITECTURE.md](ARCHITECTURE.md), [IMPLEMENTATION.md](IMPLEMENTATION.md), [FLOWS.md](FLOWS.md)

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Business Requirements](#2-business-requirements)
3. [Functional Requirements](#3-functional-requirements)
4. [Technical Requirements](#4-technical-requirements)
5. [Security Requirements](#5-security-requirements)
6. [Performance Requirements](#6-performance-requirements)
7. [Integration Requirements](#7-integration-requirements)
8. [Governance Requirements](#8-governance-requirements)
9. [User Experience Requirements](#9-user-experience-requirements)
10. [Testing Requirements](#10-testing-requirements)
11. [Success Criteria](#11-success-criteria)
12. [Scope Definition](#12-scope-definition)
13. [Dependencies](#13-dependencies)
14. [Risk Assessment](#14-risk-assessment)

---

## 1. Executive Summary

### 1.1 Overview

The tBTC v2 Account Control feature introduces "Qualified Custodian" (QC) functionality through **direct Bank integration**, enabling regulated custodial entities to mint tBTC tokens against their segregated Bitcoin reserves. The system implements a modular, policy-driven architecture that enables future upgrades without disrupting core interfaces.

### 1.2 Business Objectives

- **REQ-BUS-001**: Must integrate Qualified Custodians to expand protocol liquidity
- **REQ-BUS-002**: Must enable tax-efficient operations through segregated off-chain reserves
- **REQ-BUS-003**: Must guarantee capital efficiency for QCs while maintaining security guarantees
- **REQ-BUS-004**: Must provide compliant pathway for regulated entities to participate in DeFi
- **REQ-BUS-005**: Must maintain system resilience through modular architecture

### 1.3 Key Stakeholders

- **Primary**: Qualified Custodians (regulated institutional entities)
- **Secondary**: tBTC token holders, DeFi protocol integrators
- **Operational**: tBTC DAO governance, Oracle attesters, Watchdog reporters, system administrators

---

## 2. Business Requirements

### 2.1 Institutional Integration

- **REQ-BUS-INST-001**: Must provide seamless onboarding for regulated custodial entities
- **REQ-BUS-INST-002**: Must support segregated reserve management for tax efficiency
- **REQ-BUS-INST-003**: Must enable custodians to maintain operational autonomy over Bitcoin wallets
- **REQ-BUS-INST-004**: Must provide accounting primitives for custodial asset management

### 2.2 Liquidity Expansion

- **REQ-BUS-LIQ-001**: Must increase tBTC supply through institutional custodian participation
- **REQ-BUS-LIQ-002**: Must maintain perfect fungibility between Bridge-minted and QC-minted tBTC
- **REQ-BUS-LIQ-003**: Must support concurrent operations from multiple QCs

### 2.3 Capital Efficiency

- **REQ-BUS-CAP-001**: Must maximize QC minting capacity relative to reserves
- **REQ-BUS-CAP-002**: Must enable efficient utilization of custodial Bitcoin holdings
- **REQ-BUS-CAP-003**: Must support dynamic capacity adjustments based on risk assessment

---

## 3. Functional Requirements

### 3.1 Core Architecture

#### 3.1.1 Direct Bank Integration (REQ-FUNC-BANK-001)

**Requirement**: The BasicMintingPolicy MUST directly integrate with the existing Bank/Vault architecture

- Direct calls to `Bank.increaseBalanceAndCall()` for seamless minting
- Authorization through `authorizedBalanceIncreasers` mapping
- Support for both auto-minting and manual minting workflows
- Coexistence with regular Bridge operations

**Acceptance Criteria**:

- BasicMintingPolicy authorized as balance increaser in Bank contract
- Auto-minting triggers TBTCVault.receiveBalanceIncrease() automatically
- Manual minting creates Bank balance for user discretionary minting
- No interference with existing Bridge → Bank → Vault flows

#### 3.1.2 Modular Contract System (REQ-FUNC-MOD-001)

**Requirement**: The system MUST implement a modular, upgradeable contract architecture

- ProtocolRegistry as central service registry
- Data/logic separation (QCData.sol storage, QCManager.sol logic)
- Policy-driven operations through IMintingPolicy and IRedemptionPolicy
- Independent component upgradeability

**Acceptance Criteria**:

- All contracts reference services through ProtocolRegistry
- QCData owned by QCManager with clear access control
- Policy contracts upgradeable via registry updates
- No direct contract-to-contract dependencies

### 3.2 QC Lifecycle Management

#### 3.2.1 QC State Machine (REQ-FUNC-QC-001)

**Requirement**: The system MUST implement a simple 3-state QC status system

- **Active**: QC fully operational with minting/redemption rights
- **UnderReview**: QC minting rights paused pending review
- **Revoked**: QC rights permanently terminated

**Acceptance Criteria**:

- State transitions: Active ↔ UnderReview, any → Revoked
- Status changes require ARBITER_ROLE authorization
- QCStatusChanged events emitted with reason
- Recovery path from UnderReview to Active

#### 3.2.2 Wallet Management (REQ-FUNC-WALLET-001)

**Requirement**: The system MUST support Bitcoin wallet registration with cryptographic proof

- Wallet control verification via OP_RETURN challenges
- SPV proof validation for wallet registration
- Two-step deregistration process (request → finalize)
- Wallet states: Inactive, Active, PendingDeRegistration

**Acceptance Criteria**:

- Registration requires Watchdog-verified SPV proof
- Atomic solvency check during wallet deregistration
- Events emitted for all wallet state changes
- Only REGISTRAR_ROLE can finalize registrations

### 3.3 Minting Operations

#### 3.3.1 Direct Bank Minting (REQ-FUNC-MINT-001)

**Requirement**: The system MUST implement seamless minting through direct Bank integration

- BasicMintingPolicy validates QC status, capacity, and system state
- Direct Bank balance creation with optional auto-minting
- Comprehensive input validation and error handling
- Unique mint ID generation and tracking

**Acceptance Criteria**:

- Validation: QC Active status, sufficient capacity, system not paused
- Amount validation against min/max limits from SystemState
- Bank.increaseBalanceAndCall() for auto-minting path
- Bank.increaseBalance() for manual minting path
- MintCompleted events with full transaction details

#### 3.3.2 Capacity Management (REQ-FUNC-CAP-001)

**Requirement**: The system MUST implement dynamic minting capacity management

- Capacity calculation: maxMintingCap - currentMinted + available reserves
- Real-time capacity checking before minting
- Reserve freshness validation against STALE_THRESHOLD
- Capacity updates upon successful minting

**Acceptance Criteria**:

- getAvailableMintingCapacity() returns real-time capacity
- Minting rejected if amount exceeds available capacity
- QCManager updates minted amounts after successful operations
- Fresh reserve attestations required for capacity calculations

### 3.4 Reserve Management

#### 3.4.1 Simplified Watchdog Architecture (REQ-FUNC-RES-001)
**Requirement**: The system MUST implement a simplified watchdog architecture based on the Three-Problem Framework

**Current Design (v2.0)**:
- **Oracle Problem**: ReserveOracle provides multi-attester consensus for reserve balances
- **Observation Problem**: WatchdogReporting enables transparent reporting via events
- **Decision Problem**: Direct DAO action without intermediary contracts
- **Enforcement**: WatchdogEnforcer allows permissionless triggering of objective violations

**Key Components**:
- **WatchdogReasonCodes**: Machine-readable violation codes for automated validation
- **ReserveOracle**: Median consensus from 3+ attesters, eliminates single trust point
- **WatchdogReporting**: Simple event emission for DAO monitoring
- **WatchdogEnforcer**: Anyone can trigger enforcement with valid reason codes

**Acceptance Criteria**:
- Multiple attesters submit reserve balances, oracle calculates median
- Machine-readable reason codes enable automated validation
- Subjective reports emit events for DAO monitoring
- Permissionless enforcement of objective violations (INSUFFICIENT_RESERVES, STALE_ATTESTATIONS)
- All operations protected by ReentrancyGuard and comprehensive access control
- V1.2 framework achieves 90%+ automation for measurable violations

#### 3.4.2 Proof-of-Reserves Process (REQ-FUNC-POR-001)

**Requirement**: The system MUST implement efficient Proof-of-Reserves monitoring

- Continuous monitoring of all registered QC Bitcoin addresses
- Strategic attestation triggers: insolvency detection, staleness prevention, deregistration support
- Integration with wallet management for solvency checks
- Real-time reserve balance tracking

**Acceptance Criteria**:

- Watchdog monitors all QC addresses continuously off-chain
- On-chain attestation only when critical conditions met
- Immediate attestation for potential insolvency situations
- Support for wallet deregistration solvency verification

### 3.5 Redemption Operations

#### 3.5.1 Redemption Lifecycle (REQ-FUNC-REDEEM-001)

**Requirement**: The system MUST implement complete redemption lifecycle management

- Redemption initiation with tBTC burning
- Pending/Fulfilled/Defaulted state management
- SPV proof verification for fulfillment
- Timeout and default handling

**Acceptance Criteria**:

- initiateRedemption burns tBTC and creates Pending redemption
- Collision-resistant redemption IDs using user nonces
- SPV proof verification for fulfillment confirmation
- Automatic default flagging after timeout periods

#### 3.5.2 Delinquency Enforcement (REQ-FUNC-DELIN-001)

**Requirement**: The system MUST implement automatic delinquency enforcement

- Watchdog monitoring of redemption fulfillments
- Automatic QC status change to Revoked upon default
- Default handling with loss socialization
- Legal recourse integration points

**Acceptance Criteria**:

- Watchdog monitors Bitcoin network for fulfillment transactions
- Automatic status change to Revoked upon confirmed default
- RedemptionDefaulted events with full audit trail
- Integration with off-chain legal enforcement mechanisms

### 3.6 Emergency Controls

#### 3.6.1 Granular Pause System (REQ-FUNC-PAUSE-001)

**Requirement**: The system MUST implement granular emergency pause controls

- Independent pause controls for minting, redemptions, registrations
- PAUSER_ROLE for emergency function pausing
- Surgical response to threats without full system freeze
- Pause/unpause events for audit trail

**Acceptance Criteria**:

- SystemState contract manages independent pause flags
- Function-specific modifiers: whenMintingNotPaused, whenRedemptionNotPaused
- PAUSER_ROLE separate from DAO for rapid response
- Events emitted for all pause state changes

---

## 4. Technical Requirements

### 4.1 Platform Requirements

#### 4.1.1 Blockchain Platform (REQ-TECH-PLAT-001)

- **Target Network**: Ethereum Mainnet with L2 compatibility
- **Solidity Version**: 0.8.17 (matching existing tBTC v2)
- **EVM Compatibility**: Must function on all EVM-compatible networks
- **Gas Limit**: Individual transactions < 3M gas units

#### 4.1.2 Development Environment (REQ-TECH-DEV-001)

- **Framework**: Hardhat development environment
- **Testing**: Comprehensive test suite using Waffle and Chai
- **Deployment**: Hardhat-deploy with numbered scripts
- **Verification**: Etherscan verification support

### 4.2 SPV Integration Requirements

#### 4.2.1 SPV Validator Implementation (REQ-TECH-SPV-001)

**Requirement**: The system MUST leverage existing Bitcoin SPV infrastructure

- Use existing LightRelay for Bitcoin header validation
- SPVValidator contract replicating Bridge's SPV logic exactly
- Wallet control verification via OP_RETURN challenges
- Redemption fulfillment verification through SPV proofs

**Acceptance Criteria**:

- SPVValidator uses identical cryptographic verification as Bridge
- Minimum 6 confirmations for transaction finality
- Transaction hash tracking prevents replay attacks
- Zero risk to production Bridge contract

#### 4.2.2 Cryptographic Security (REQ-TECH-CRYPTO-001)

- **Hash Functions**: Secure hash functions for all operations
- **Signature Verification**: Proper validation of all cryptographic signatures
- **Randomness**: Secure randomness sources for non-deterministic operations
- **SPV Proofs**: Leverage existing @keep-network/bitcoin-spv-sol libraries

### 4.3 Storage and State Management

#### 4.3.1 Gas-Optimized Storage (REQ-TECH-STORAGE-001)

- **Custom Errors**: Gas-efficient error handling
- **Storage Layout**: Optimized struct packing
- **Minimal Operations**: Efficient read/write patterns
- **Event Optimization**: Strategic event emission

#### 4.3.2 State Separation (REQ-TECH-STATE-001)

- **Data Layer**: QCData.sol for all persistent storage
- **Logic Layer**: QCManager.sol for stateless business logic
- **Global State**: SystemState.sol for system-wide parameters
- **Clear Ownership**: Defined access control between layers

---

## 5. Security Requirements

### 5.1 Access Control

#### 5.1.1 Role-Based Access Control (REQ-SEC-RBAC-001)

**Requirement**: The system MUST implement granular role-based access control

**Core Roles**:

- **DEFAULT_ADMIN_ROLE**: DAO governance (grant/revoke roles)
- **MINTER_ROLE**: QCMinter contract (request minting operations)
- **ATTESTER_ROLE**: ReserveOracle and individual attesters (submit reserve attestations)
- **REGISTRAR_ROLE**: Authorized entities (finalize wallet registrations)
- **ARBITER_ROLE**: WatchdogEnforcer (objective violation enforcement)
- **WATCHDOG_ROLE**: Subjective reporters (submit observations)
- **PAUSER_ROLE**: Emergency Council (granular function pausing)

**Acceptance Criteria**:

- OpenZeppelin AccessControl implementation
- Clear privilege separation for each role
- Role grants/revocations emit events
- Multi-signature for critical role changes

#### 5.1.2 Authorization Validation (REQ-SEC-AUTH-001)

- **Input Validation**: Comprehensive parameter checking with custom errors
- **State Validation**: QC status and system state verification
- **Capacity Validation**: Real-time minting capacity verification
- **Authorization Checks**: Bank authorization verification before operations

### 5.2 Cryptographic Security

#### 5.2.1 SPV Security (REQ-SEC-SPV-001)

- **Proof Validation**: Leverage existing LightRelay for header validation
- **Challenge Verification**: OP_RETURN challenge verification for wallet control
- **Confirmation Requirements**: Minimum confirmation depths for security
- **Replay Prevention**: Transaction hash tracking to prevent replay attacks

#### 5.2.2 Signature Security (REQ-SEC-SIG-001)

- **Attestation Signatures**: Watchdog signature validation for attestations
- **Multi-Signature**: Multi-sig requirements for governance operations
- **Nonce Management**: Proper nonce handling to prevent replay attacks
- **Key Management**: Secure key management for all roles

### 5.3 Economic Security

#### 5.3.1 Solvency Protection (REQ-SEC-SOLV-001)

- **Real-Time Monitoring**: Continuous solvency verification
- **Automatic Controls**: Automatic status changes for undercollateralization
- **Reserve Segregation**: Protect solvent QCs through segregated reserves
- **Default Handling**: Systematic default detection and response

#### 5.3.2 Attack Prevention (REQ-SEC-ATTACK-001)

- **Flash Loan Protection**: Multi-block confirmation requirements
- **MEV Resistance**: Transaction ordering protections where possible
- **Circuit Breakers**: Automated responses to unusual activity
- **Rate Limiting**: Appropriate rate limits for sensitive operations

### 5.4 Operational Security

#### 5.4.1 Watchdog Security (REQ-SEC-WATCHDOG-001)

- **Distributed Trust**: Multiple attesters for oracle consensus (no single point of failure)
- **Permissionless Enforcement**: Anyone can trigger objective violations with valid proof
- **Transparent Reporting**: All subjective observations emit public events
- **DAO Oversight**: Direct governance action on reports without intermediaries

#### 5.4.2 Emergency Response (REQ-SEC-EMERGENCY-001)

- **Rapid Response**: Emergency controls independent of governance delays
- **Granular Controls**: Function-specific pause mechanisms
- **Incident Procedures**: Documented response and recovery protocols
- **Override Capabilities**: Emergency governance override for critical situations

---

## 6. Performance Requirements

### 6.1 Gas Efficiency

#### 6.1.1 Transaction Costs (REQ-PERF-GAS-001)

**Target Gas Costs**:

- QC Minting: < 150,000 gas
- Reserve Attestation: < 100,000 gas
- QC Status Change: < 80,000 gas
- Wallet Registration: < 200,000 gas

#### 6.1.2 Optimization Strategies (REQ-PERF-OPT-001)

- **Direct Integration**: Eliminate intermediate contracts for efficiency
- **Strategic Attestation**: Minimize on-chain attestation frequency
- **Custom Errors**: Gas-efficient error handling
- **Storage Optimization**: Efficient storage layout and access patterns

### 6.2 Scalability

#### 6.2.1 System Capacity (REQ-PERF-SCALE-001)

- **QC Support**: Accommodate up to 50 registered QCs
- **Wallet Management**: Support up to 20 Bitcoin addresses per QC
- **Concurrent Operations**: Handle 1000+ simultaneous operations
- **Data Growth**: Efficient storage for 5+ years of operational data

#### 6.2.2 Throughput Requirements (REQ-PERF-THROUGH-001)

- **Minting Throughput**: Process 100+ mints per hour during peak periods
- **Attestation Frequency**: Support real-time reserve monitoring
- **State Updates**: Efficient state transitions without bottlenecks
- **Event Processing**: Support high-frequency event monitoring

### 6.3 Reliability

#### 6.3.1 Availability (REQ-PERF-AVAIL-001)

- **Uptime Target**: 99.9% availability for core functions
- **Fault Tolerance**: Continue operations with single component failure
- **Recovery Time**: Resume operations within 1 hour of recoverable failures
- **Data Integrity**: Zero tolerance for data corruption or loss

#### 6.3.2 Error Handling (REQ-PERF-ERROR-001)

- **Graceful Degradation**: Non-critical failures don't impact core functionality
- **Clear Errors**: Descriptive error messages for all revert conditions
- **Event Logging**: Comprehensive event logging for debugging
- **Rollback Safety**: Safe transaction rollback for invalid operations

---

## 7. Integration Requirements

### 7.1 tBTC v2 System Integration

#### 7.1.1 Independent Deployment (REQ-INT-DEPLOY-001)

**Requirement**: Deploy Account Control as independent contract suite

- No modifications to existing Bridge, Bank, or TBTC contracts
- Separate governance structure with DAO oversight
- Access existing contracts through interfaces only
- Complete separation of concerns

**Technical Implementation**:

- Deploy ProtocolRegistry, QCManager, QCData, SystemState independently
- BasicMintingPolicy authorized in Bank's authorizedBalanceIncreasers
- Use existing TBTC token interface for minting/burning
- No shared state with existing tBTC v2 contracts

#### 7.1.2 Bank Integration (REQ-INT-BANK-001)

**Requirement**: Seamless integration with existing Bank contract

- BasicMintingPolicy authorized as balance increaser
- Support for both increaseBalanceAndCall (auto-mint) and increaseBalance (manual)
- Maintain compatibility with existing Bridge operations
- Shared infrastructure for optimal efficiency

**Acceptance Criteria**:

- Bank.authorizedBalanceIncreasers[basicMintingPolicy] = true
- Bank operations trigger TBTCVault.receiveBalanceIncrease() for auto-minting
- Manual minting allows user discretionary timing
- No interference with Bridge → Bank → Vault flows

#### 7.1.3 Token Integration (REQ-INT-TOKEN-001)

**Requirement**: Use existing TBTC token with perfect fungibility

- QC-minted tokens indistinguishable from Bridge-minted tokens
- No token contract modifications required
- Unified token across all minting sources
- Maintain existing token functionality

**Acceptance Criteria**:

- TBTCVault handles minting for QC operations
- Perfect fungibility between all tBTC regardless of source
- No changes to existing token interfaces
- Maintain compatibility with existing DeFi integrations

### 7.2 External Service Integration

#### 7.2.1 Watchdog Integration (REQ-INT-WATCHDOG-001)

- **Oracle Attesters**: Multiple entities submit reserve attestations for consensus
- **Subjective Reporters**: Watchdogs submit observations via events
- **Data Sources**: Integration with Bitcoin blockchain explorers
- **Permissionless Enforcement**: Anyone can trigger violations with proof

#### 7.2.2 Monitoring Integration (REQ-INT-MON-001)

- **Event Compatibility**: Events compatible with existing monitoring
- **Metrics Support**: Standardized metrics interfaces
- **Real-Time Alerting**: Support for automated alerting systems
- **Dashboard Integration**: Compatible with existing analytics tools

---

## 8. Governance Requirements

### 8.1 Time-Locked Governance

#### 8.1.1 Critical Action Delays (REQ-GOV-TIMELOCK-001)

**Requirement**: 7-day governance delays for critical QC operations

**Time-Locked Actions**:

- QC onboarding and registration of new institutional entities
- Minting capacity increases for existing QCs
- Major protocol parameter changes affecting system security
- Policy contract upgrades requiring community oversight

**Implementation**:

- QC_GOVERNANCE_ROLE for instant governance actions
- Instant-by-default governance philosophy
- registerQC() single-step process for QC onboarding
- PendingAction struct tracks queued actions with execution timestamps

#### 8.1.2 Emergency Response (REQ-GOV-EMERGENCY-001)

**Requirement**: Preserve instant emergency response capabilities

**Instant Emergency Actions**:

- QC status changes (Active ↔ UnderReview, any → Revoked)
- Emergency system pauses and QC removal
- Redemption default handling and threat response
- Watchdog appointment and replacement for operational continuity

**Acceptance Criteria**:

- Emergency actions bypass governance delays
- PAUSER_ROLE for immediate function pausing
- ARBITER_ROLE for immediate QC status changes
- Emergency procedures documented and tested

### 8.2 Role Management

#### 8.2.1 Role Assignment (REQ-GOV-ROLES-001)

- **DAO Control**: DEFAULT_ADMIN_ROLE controls all role assignments
- **Operational Roles**: Clear assignment of operational responsibilities
- **Emergency Roles**: Emergency Council with limited pause authorities
- **Watchdog Roles**: Single entity with multiple operational roles

#### 8.2.2 Governance Oversight (REQ-GOV-OVERSIGHT-001)

- **Parameter Control**: DAO control over all system parameters
- **Policy Upgrades**: DAO approval for policy contract changes
- **QC Management**: DAO oversight of QC onboarding and management
- **Emergency Override**: DAO emergency override capabilities

---

## 9. User Experience Requirements

### 9.1 QC Operations

#### 9.1.1 Onboarding Flow (REQ-UX-ONBOARD-001)

**Requirement**: Streamlined QC onboarding with governance oversight

- Two-step onboarding: queue → execute with 7-day delay
- Clear documentation of requirements and procedures
- Status tracking throughout onboarding process
- Integration with off-chain compliance verification

**Acceptance Criteria**:

- registerQC() with instant execution
- Community review through role-based access control
- QCOnboardingQueued and QCOnboardingExecuted events
- Clear rejection paths with reason codes

#### 9.1.2 Minting Experience (REQ-UX-MINT-001)

**Requirement**: Single-step minting experience for end users

- Auto-minting path: Bank balance creation and tBTC minting in one transaction
- Manual minting path: User discretionary timing for tax optimization
- Real-time capacity checking and clear error messages
- Comprehensive event emission for monitoring

**Acceptance Criteria**:

- requestMint() provides seamless one-step minting
- Atomic operation ensures deposit and minting happen together
- Clear error messages for all failure conditions
- MintCompleted events with full transaction details

#### 9.1.3 Wallet Management (REQ-UX-WALLET-001)

**Requirement**: Secure and user-friendly wallet management

- SPV-verified wallet registration with OP_RETURN challenges
- Two-step deregistration with solvency verification
- Clear status tracking for all wallet operations
- Comprehensive error handling and recovery paths

**Acceptance Criteria**:

- Wallet registration requires cryptographic proof of control
- Atomic solvency check during deregistration prevents gridlock
- WalletRegistered, DeregistrationRequested, WalletDeregistered events
- Clear documentation of wallet management procedures

### 9.2 Error Handling and Recovery

#### 9.2.1 User Feedback (REQ-UX-FEEDBACK-001)

- **Clear Error Messages**: Descriptive errors for all failure conditions
- **Status Information**: Real-time status information for all operations
- **Recovery Guidance**: Clear guidance for error recovery
- **Support Integration**: Integration with support and documentation systems

#### 9.2.2 Operation Transparency (REQ-UX-TRANSPARENCY-001)

- **Transaction Tracking**: Unique IDs for all operations
- **Status Updates**: Real-time status updates throughout operation lifecycle
- **Audit Trail**: Complete audit trail for all QC operations
- **Historical Data**: Access to historical operation data

---

## 10. Testing Requirements

### 10.1 Functional Testing

#### 10.1.1 Core Flow Testing (REQ-TEST-FLOWS-001)

**Requirement**: Comprehensive testing of all critical user flows

- End-to-end QC onboarding with time-locked governance
- Complete minting flows (auto-mint and manual mint)
- Full redemption lifecycle including timeout and default scenarios
- Wallet registration and deregistration flows

**Acceptance Criteria**:

- All critical paths tested on testnet before mainnet deployment
- Edge cases and error conditions comprehensively tested
- Integration testing with existing tBTC v2 contracts
- Performance testing under load conditions

#### 10.1.2 Security Testing (REQ-TEST-SECURITY-001)

**Requirement**: Comprehensive security testing and validation

- Attack scenario testing (flash loan, replay, etc.)
- Access control validation for all roles
- Emergency response procedure testing
- Cryptographic verification testing

**Acceptance Criteria**:

- Security audit with no critical findings
- Penetration testing completed successfully
- All attack vectors tested and mitigated
- Emergency procedures validated through drills

### 10.2 Integration Testing

#### 10.2.1 System Integration (REQ-TEST-INTEGRATION-001)

- **Bank Integration**: Comprehensive testing of Bank interaction patterns
- **SPV Integration**: Validation of SPV proof verification
- **Governance Integration**: Testing of all governance workflows
- **Monitoring Integration**: Validation of event emission and monitoring

#### 10.2.2 Performance Testing (REQ-TEST-PERFORMANCE-001)

- **Gas Optimization**: Validation of gas efficiency targets
- **Load Testing**: System behavior under high transaction volumes
- **Scalability Testing**: Validation of capacity limits
- **Stress Testing**: System behavior under extreme conditions

---

## 11. Success Criteria

### 11.1 Technical Success Criteria

#### 11.1.1 Deployment Success (REQ-SUCCESS-DEPLOY-001)

- [ ] All contracts deploy successfully to testnet and mainnet
- [ ] Gas costs within specified limits for all operations
- [ ] Full compatibility with existing tBTC v2 functionality
- [ ] Zero regression in existing system performance
- [ ] Complete test coverage (>95%) for all new functionality

#### 11.1.2 Integration Success (REQ-SUCCESS-INTEGRATION-001)

- [ ] Seamless integration with existing Bank/Vault architecture
- [ ] Successful Watchdog integration with all required roles
- [ ] Complete governance integration with existing DAO systems
- [ ] Monitoring and alerting systems operational
- [ ] Emergency response procedures tested and validated

### 11.2 Functional Success Criteria

#### 11.2.1 QC Operations Success (REQ-SUCCESS-QC-001)

- [ ] Successful registration of at least 3 test QCs
- [ ] End-to-end minting operations completed without issues
- [ ] End-to-end redemption operations completed successfully
- [ ] Wallet management operations functioning correctly
- [ ] Emergency controls responding appropriately

#### 11.2.2 Operational Success (REQ-SUCCESS-OPS-001)

- [ ] 24/7 monitoring systems operational
- [ ] Watchdog operations functioning reliably
- [ ] Reserve attestation system working correctly
- [ ] Solvency monitoring detecting issues appropriately
- [ ] Time-locked governance procedures validated

### 11.3 Business Success Criteria

#### 11.3.1 Adoption Success (REQ-SUCCESS-ADOPTION-001)

- [ ] At least 5 QCs registered within 6 months of mainnet deployment
- [ ] Minimum $10M in QC-backed tBTC minted within first year
- [ ] Zero security incidents resulting in fund loss
- [ ] Positive feedback from institutional partners
- [ ] Integration by at least 3 major DeFi protocols

#### 11.3.2 System Health Success (REQ-SUCCESS-HEALTH-001)

- [ ] 99.9% uptime maintained for first 6 months
- [ ] Zero successful attacks on the system
- [ ] All QCs maintaining required solvency ratios
- [ ] Emergency response mechanisms functioning when needed
- [ ] Community and governance satisfaction with system operation

---

## 12. Scope Definition

### 12.1 In Scope

#### 12.1.1 Core Functionality (REQ-SCOPE-CORE-001)

- Complete QC registration and lifecycle management
- Direct Bank integration for minting operations
- Reserve attestation and solvency monitoring system
- Redemption lifecycle management with default handling
- SPV-verified wallet management
- Emergency controls and granular pause mechanisms
- Time-locked governance for critical operations
- Comprehensive monitoring and event emission

#### 12.1.2 Supporting Systems (REQ-SCOPE-SUPPORT-001)

- Deployment scripts and upgrade procedures
- Comprehensive testing framework and test suites
- Documentation and operational procedures
- Integration with existing monitoring systems
- Watchdog integration and role management
- Governance parameter configuration and management

### 12.2 Out of Scope

#### 12.2.1 Future Enhancements (REQ-SCOPE-FUTURE-001)

- Cryptographic proof-of-reserves (V2 enhancement)
- Watchdog decentralization (planned for V2)
- On-chain collateralization system (planned for V2)
- Cross-chain deployment (planned for V2)
- Advanced fee optimization algorithms
- Automated market making capabilities

#### 12.2.2 External Dependencies (REQ-SCOPE-EXTERNAL-001)

- QC legal compliance verification
- Regulatory approval processes
- External audit and certification
- Third-party integration development
- Marketing and business development
- Legal framework development beyond smart contracts

---

## 13. Dependencies

### 13.1 Technical Dependencies

#### 13.1.1 Smart Contract Dependencies (REQ-DEP-CONTRACT-001)

| Dependency                    | Version        | Criticality | Impact                              |
| ----------------------------- | -------------- | ----------- | ----------------------------------- |
| @openzeppelin/contracts       | ^4.8.1         | High        | Security primitives, access control |
| @keep-network/bitcoin-spv-sol | 3.4.0-solc-0.8 | High        | SPV proof validation                |
| Existing tBTC v2 contracts    | Current        | Critical    | Bank/Vault integration              |
| Ethereum network              | Mainnet        | Critical    | Platform availability               |

#### 13.1.2 Infrastructure Dependencies (REQ-DEP-INFRA-001)

- **Ethereum Network**: 99.9% uptime requirement
- **Bitcoin Network**: Continuous availability for monitoring
- **Watchdog Services**: Real-time monitoring and attestation
- **Governance Systems**: DAO decision-making infrastructure

### 13.2 Business Dependencies

#### 13.2.1 Governance Dependencies (REQ-DEP-GOVERNANCE-001)

- tBTC DAO approval for Account Control feature deployment
- Parameter setting and configuration approval through governance
- QC onboarding approval process with community oversight
- Emergency response authorization and role assignments

#### 13.2.2 Operational Dependencies (REQ-DEP-OPERATIONAL-001)

- Watchdog service agreements and operational SLAs
- QC legal agreements and compliance verification processes
- Emergency response team availability and procedures
- Community monitoring and support infrastructure

---

## 14. Risk Assessment

### 14.1 Technical Risks

#### 14.1.1 Smart Contract Risks (REQ-RISK-CONTRACT-001)

| Risk                               | Probability | Impact   | Mitigation Strategy                                    |
| ---------------------------------- | ----------- | -------- | ------------------------------------------------------ |
| Critical bug in BasicMintingPolicy | Medium      | High     | Comprehensive testing, security audits, bug bounty     |
| Bank integration issues            | Low         | High     | Extensive integration testing, staged deployment       |
| SPV verification vulnerabilities   | Low         | Critical | Leverage proven SPV infrastructure, additional testing |
| Gas limit exceeded                 | Low         | Medium   | Gas optimization, transaction batching                 |

#### 14.1.2 Security Risks (REQ-RISK-SECURITY-001)

| Risk                      | Probability | Impact   | Mitigation Strategy                                   |
| ------------------------- | ----------- | -------- | ----------------------------------------------------- |
| Watchdog compromise       | Low         | High     | DAO oversight, emergency replacement, role separation |
| QC private key compromise | Medium      | High     | Monitoring, circuit breakers, revocation procedures   |
| Governance key compromise | Low         | Critical | Multi-signature, timelock, emergency procedures       |
| Flash loan attack         | Medium      | Medium   | Multi-block confirmations, circuit breakers           |

### 14.2 Business Risks

#### 14.2.1 Operational Risks (REQ-RISK-OPERATIONAL-001)

| Risk                      | Probability | Impact | Mitigation Strategy                              |
| ------------------------- | ----------- | ------ | ------------------------------------------------ |
| QC default on redemptions | Medium      | High   | Monitoring, segregated reserves, legal recourse  |
| Insufficient QC adoption  | Medium      | Medium | Incentive design, partnerships, marketing        |
| Regulatory restrictions   | Low         | High   | Legal compliance, jurisdictional diversification |
| Community opposition      | Low         | Medium | Transparent development, engagement              |

#### 14.2.2 Economic Risks (REQ-RISK-ECONOMIC-001)

| Risk                            | Probability | Impact   | Mitigation Strategy                           |
| ------------------------------- | ----------- | -------- | --------------------------------------------- |
| Systemic QC insolvency          | Low         | Critical | Diversification, monitoring, circuit breakers |
| tBTC price impact from defaults | Medium      | High     | Reserve segregation, insurance mechanisms     |
| Economic attack on incentives   | Low         | High     | Game theory analysis, parameter tuning        |

### 14.3 Risk Mitigation Strategy

#### 14.3.1 Preventive Measures (REQ-RISK-PREVENTION-001)

- Comprehensive security audits before deployment
- Extensive testing including edge cases and attack scenarios
- Multi-signature and timelock protection for critical operations
- Real-time monitoring and alerting systems
- Strategic reserve attestation to minimize on-chain costs

#### 14.3.2 Reactive Measures (REQ-RISK-REACTION-001)

- Incident response procedures and emergency contact protocols
- Granular pause mechanisms for surgical threat response
- Emergency governance override capabilities
- Contract upgrade and rollback procedures where applicable
- Legal recourse mechanisms for QC defaults

---

## Conclusion

This comprehensive requirements specification provides the definitive source of truth for implementing the tBTC v2 Account Control feature. The direct Bank integration approach balances simplicity, security, and functionality while providing a clear foundation for future enhancements.

Key architectural decisions prioritize:

- **Simplicity**: Direct Bank integration over complex abstraction layers
- **Security**: Comprehensive validation and access control
- **Modularity**: Policy-driven architecture enabling future upgrades
- **Compatibility**: Seamless integration with existing tBTC v2 infrastructure

The success of this implementation depends on careful execution of these requirements, thorough testing, and ongoing operational vigilance. The modular design ensures the system can evolve while maintaining stability and security.

---

**Document Control**

- **Version**: 3.0 (Consolidated Source of Truth)
- **Replaces**: account-control-requirements.md
- **Approval Required From**: tBTC DAO, Technical Team, Security Team
- **Next Review Date**: 2025-08-11
- **Distribution**: All project stakeholders, development team, governance council
