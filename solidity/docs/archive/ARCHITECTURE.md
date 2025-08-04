# Account Control Architecture for tBTC v2

**Document Version**: 1.2  
**Date**: 2025-08-03  
**Architecture**: Direct Bank Integration with Automated Decision Framework  
**Purpose**: Detailed technical architecture specification  
**Related Documents**: [README.md](README.md), [REQUIREMENTS.md](REQUIREMENTS.md), [IMPLEMENTATION.md](IMPLEMENTATION.md), [RESEARCH.md](RESEARCH.md)

---

## 1. Technical Architecture Overview

This document provides detailed technical architecture for the Account Control system implemented through direct Bank integration. For business requirements and high-level overview, see [README.md](README.md) and [REQUIREMENTS.md](REQUIREMENTS.md).

### 1.1 Architectural Principles

The Account Control architecture is built on four core principles:

1. **Direct Integration**: Leverage existing Bank/Vault infrastructure without abstraction layers
2. **Modular Design**: Policy-driven contracts enable evolution without breaking core interfaces
3. **Data/Logic Separation**: Clear separation between storage (QCData) and business logic (QCManager)
4. **Future-Proof Interfaces**: Stable core contracts with upgradeable policy implementations

### 1.2 System Architecture Diagram

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   QCMinter      │────│ BasicMintingPolicy│────│   Bank.sol      │
│  (Entry Point)  │    │ (Direct Integration)│   │ (Existing)      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                        │
         │              ┌─────────────────┐               │
         └──────────────│ ProtocolRegistry│               │
                        │ (Service Locator)│               │
                        └─────────────────┘               │
                                 │                        │
              ┌──────────────────┼──────────────────┐     │
              │                  │                  │     │
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ │
    │   QCManager     │ │    QCData       │ │  SystemState    │ │
    │ (Business Logic)│ │   (Storage)     │ │ (Global State)  │ │
    └─────────────────┘ └─────────────────┘ └─────────────────┘ │
                                                                │
                        ┌─────────────────┐                    │
                        │   TBTCVault     │◄───────────────────┘
                        │   (Existing)    │
                        └─────────────────┘
                                 │
                    ┌─────────────────────────────────────────────┐
                    │         V1.1 Watchdog Quorum System          │
                    │                                             │
                    │  ┌─────────────────────┐ ┌─────────────────┐ │
                    │  │WatchdogConsensus    │ │   WatchdogMonitor   │ │
                    │  │     Manager         │ │   (Emergency        │ │
                    │  │ (M-of-N Voting)     │ │    Coordination)    │ │
                    │  └─────────────────────┘ └─────────────────┘ │
                    │            │                       │        │
                    │            └───────────────────────┘        │
                    └─────────────────────────────────────────────┘
                                        │
                    ┌─────────────────────────────────────────────┐
                    │    V1.2 Automated Decision Framework        │
                    │                                             │
                    │  ┌─────────────────────┐ ┌─────────────────┐ │
                    │  │ WatchdogAutomated   │ │ WatchdogThreshold   │ │
                    │  │    Enforcement      │ │     Actions         │ │
                    │  │ (Deterministic)     │ │ (3+ Reports)        │ │
                    │  └─────────────────────┘ └─────────────────┘ │
                    │            │                       │        │
                    │            └───────────┬───────────┘        │
                    │                        │                    │
                    │              ┌─────────────────────┐        │
                    │              │  WatchdogDAO        │        │
                    │              │   Escalation       │        │
                    │              │ (DAO Governance)   │        │
                    │              └─────────────────────┘        │
                    └─────────────────────────────────────────────┘
```

## 2. Smart Contract Architecture

The architecture's strength lies in its modularity and the principle of
separation of concerns. Instead of a single monolithic contract, the system is a
suite of specialized, interoperable contracts. This design enhances clarity,
maintainability, and future upgradeability. Core contracts are designed as
stable shells that delegate complex, evolving logic to external **"Policy"**
contracts. This allows the DAO to upgrade the system's behavior over time—for
instance, moving from a Watchdog-arbitrated V1 to a trust-minimized V2 with
on-chain challenges—by simply deploying new Policy modules and updating
pointers, without altering the core contract interfaces.

### 2.1 `BasicMintingPolicy.sol` (The Direct Bank Integration)

**CORE COMPONENT**: This contract is the cornerstone of the QC integration,
acting as the direct interface between Account Control and the existing tBTC
Bank/Vault architecture. It enables QC-backed reserves to create Bank
balances and mint tBTC tokens seamlessly.

- **Key Features:**
  - Directly calls Bank.increaseBalanceAndCall() for seamless integration
  - Validates QC status, capacity, and system state before minting
  - Supports both auto-minting and manual minting workflows
  - Provides comprehensive error handling and validation
  - Maintains authorization through Bank's authorized balance increasers

### 2.2 `ProtocolRegistry.sol`

This contract is the cornerstone of the architecture's modularity, acting as a
central, dynamic address book. It decouples all system contracts, enabling
upgrades to individual components without requiring a full-system redeployment.

### 2.3 `QCManager.sol`, `QCData.sol`, and `SystemState.sol`

To enforce the Single Responsibility Principle, logic, data, and global state
are broken down into three focused contracts.

**1. `QCData.sol` (The State Store)** This contract serves as the dedicated,
auditable storage layer for all data related to Qualified Custodians and their
wallets. By isolating state, the system can upgrade logic contracts without
performing complex and risky data migrations. It stores `Custodian` and `Wallet`
structs, governed by `QCStatus` and `WalletStatus` enums.

- **`QCStatus`**: `Active`, `UnderReview`, `Revoked`
- **`WalletStatus`**: `Inactive`, `Active`, `PendingDeRegistration`

**2. `QCManager.sol` (The Logic Controller)** This contract contains all the
business logic for managing QCs. It is stateless itself, reading from and
writing to `QCData` and `SystemState` via the central `ProtocolRegistry`. It
manages QC status changes and wallet registration flows.

**3. `SystemState.sol` (The Global State)** This contract holds global
parameters and emergency controls (e.g., `isMintingPaused`), providing a single,
auditable location for system-wide state.

### 2.4 `QCReserveLedger.sol` (The Reserve Ledger)

This contract is exclusively responsible for recording off-chain reserve data
submitted by a trusted attester (the Watchdog). It contains a `STALE_THRESHOLD`
parameter to ensure reserve data is fresh.

### 2.5 `QCMinter.sol` (The Minting Engine)

A focused contract that acts as a stable entry point for minting `tBTC`. It
delegates the core validation and minting logic to a pluggable "Minting Policy"
contract (`IMintingPolicy`), allowing the minting rules to be upgraded without
changing the core minter contract.

### 2.6 `BasicMintingPolicy.sol` (The Minting Policy Implementation)

**CORE COMPONENT**: This contract implements the `IMintingPolicy` interface
with direct Bank integration, enabling seamless integration with the Bank/Vault architecture.

- **Key Features:**
  - Direct Bank integration using Bank.increaseBalanceAndCall()
  - Validates QC status, capacity, and system state
  - Converts tBTC amounts to satoshis for Bank operations
  - Supports both auto-mint and manual mint workflows
  - Authorized as a balance increaser in the Bank contract

### 2.7 `QCRedeemer.sol` (The Redemption Engine)

This contract manages the entire lifecycle of a redemption request, delegating
fulfillment and default handling logic to a pluggable "Redemption Policy"
(`IRedemptionPolicy`). It tracks redemptions via a `Redemption` struct and a
`RedemptionStatus` enum (`NeverInitiated`, `Pending`, `Fulfilled`, `Defaulted`).

### 2.8 `Bridge.sol`, `Bank.sol`, and `TBTCVault.sol` (Enhanced Integration)

**UPDATED INTEGRATION**: The existing contracts have been enhanced to support
direct BasicMintingPolicy integration while maintaining backward compatibility.

- **Bank Contract Modifications:**

  - Added `authorizedBalanceIncreasers` mapping to allow BasicMintingPolicy to increase balances
  - Modified `onlyBridge` modifier to `onlyAuthorizedIncreaser` for inclusive access
  - Added `setAuthorizedBalanceIncreaser()` function for managing authorized contracts

- **Key Integration Points:**
  - **Bank Integration**: BasicMintingPolicy is authorized as a balance increaser via `authorizedBalanceIncreasers`
  - **Vault Integration**: Auto-minting uses `increaseBalanceAndCall()` to trigger `TBTCVault.receiveBalanceIncrease()`
  - **Shared Infrastructure**: Both regular Bridge and BasicMintingPolicy use the same Bank and TBTCVault infrastructure

### 2.9 V1.1 Dual-Path Watchdog Architecture

**CORE COMPONENT**: The V1.1 system implements a **dual-path architecture** that balances efficiency 
with security. **90% of watchdog operations** use individual QCWatchdog instances for maximum 
efficiency, while **critical operations requiring authority** use M-of-N consensus through 
WatchdogConsensusManager.

#### 2.9.1 QCWatchdog.sol - Individual Watchdog Operations

**Primary Component**: Individual watchdog proxy handling routine operations:

- **Role Consolidation**: Single WATCHDOG_OPERATOR_ROLE for all routine operations
- **Direct Integration**: Proxy pattern for efficient system interaction
- **Core Operations**: Proof-of-reserves attestation, wallet registration, redemption handling
- **SPV Verification**: Bitcoin transaction verification for wallet registration
- **Event Standardization**: Comprehensive event emission for monitoring

```solidity
/// @title QCWatchdog
/// @dev Proxy contract consolidating multiple system roles under single WATCHDOG_OPERATOR_ROLE
contract QCWatchdog is AccessControl {
    bytes32 public constant WATCHDOG_OPERATOR_ROLE = keccak256("WATCHDOG_OPERATOR_ROLE");
    
    // Required roles in other contracts:
    // - ARBITER_ROLE in QCManager and QCRedeemer
    // - ATTESTER_ROLE in QCReserveLedger
    // - REGISTRAR_ROLE in QCManager
}
```

**Key Features**:
- **Gas Efficient**: Direct calls without consensus overhead for routine operations
- **Operational Simplicity**: Single role management for operators
- **Comprehensive Monitoring**: Tracking for attestations, registrations, and redemptions
- **SPV Integration**: Bitcoin transaction verification using existing tBTC infrastructure

#### 2.9.2 WatchdogConsensusManager.sol - Critical Consensus Operations

**Consensus Component**: M-of-N voting system for operations requiring authority:

- **Selective Consensus**: Only critical operations requiring multiple authority signatures
- **Configurable Parameters**: M-of-N voting (default 2-of-5) with safety bounds
- **Proposal-Based System**: Structured voting on specific operation types
- **Time-Limited Voting**: 2-hour voting periods with cleanup mechanisms
- **Byzantine Fault Tolerance**: Tolerates up to (N-1)/3 Byzantine failures

```solidity
struct Proposal {
    ProposalType proposalType;  // STATUS_CHANGE, WALLET_DEREGISTRATION, etc.
    bytes data;                // Encoded operation parameters
    address proposer;          // Proposing watchdog
    uint256 voteCount;         // Current vote count
    uint256 timestamp;         // Proposal timestamp
    bool executed;             // Execution status
    string reason;             // Human-readable reason
}
```

**Consensus-Required Operations**:
- QC status changes (Active ↔ UnderReview ↔ Revoked)
- Wallet deregistration requests
- Redemption default declarations
- Force intervention scenarios

#### 2.9.3 WatchdogMonitor.sol - System Coordination

**Coordination Component**: Manages multiple QCWatchdog instances and emergency responses:

- **Watchdog Registration**: Registration and lifecycle management of QCWatchdog instances
- **Emergency Detection**: Monitors for critical reports requiring immediate action
- **Threshold-Based Actions**: Automatic emergency pause when threshold reached (3+ reports in 1 hour)
- **Cross-Instance Coordination**: Ensures consistent behavior across multiple watchdogs

**Emergency Response System**:
- **Critical Report Tracking**: Aggregates reports from multiple watchdog instances
- **Automatic Emergency Pause**: Triggers when CRITICAL_REPORTS_THRESHOLD exceeded
- **Recovery Procedures**: Clear emergency states once issues resolved

#### 2.9.4 Dual-Path Operation Flow

**Routine Operations (90% of watchdog activity)**:
```
QCWatchdog → Direct System Integration
- Attestation: QCWatchdog → QCReserveLedger
- Registration: QCWatchdog → QCManager (with SPV proof)
- Redemption Fulfillment: QCWatchdog → QCRedeemer
```

**Critical Operations (10% requiring authority)**:
```
Watchdog → WatchdogConsensusManager → Proposal → Voting → Execution
- Status Changes: Require M-of-N consensus before execution
- Wallet Deregistration: Require consensus approval
- Default Declarations: Require consensus validation
```

**Emergency Scenarios**:
```
Multiple Watchdogs → WatchdogMonitor → Emergency Detection → Automatic Response
- Critical Reports: Aggregated across all watchdog instances
- Emergency Pause: Triggered automatically at threshold
- Recovery: Coordinated through WatchdogMonitor
```

#### 2.9.5 Security Features

- **Role Separation**: Individual operations vs. consensus-required operations
- **Reentrancy Protection**: All execution functions protected by OpenZeppelin's ReentrancyGuard
- **Access Control**: Granular role-based permissions with emergency and management roles
- **Input Validation**: Comprehensive validation of operation parameters and states
- **Byzantine Fault Tolerance**: Consensus operations tolerate up to (N-1)/3 Byzantine failures
- **Emergency Circuit Breakers**: Automatic response to critical scenarios

### 2.10 Automated Decision Framework (V1.2 Enhancement)

**MAJOR ENHANCEMENT**: The V1.2 system introduces a three-layer automated decision framework 
that addresses the fundamental limitation of the V1.1 consensus system - machines cannot 
interpret subjective human-readable proposals. This framework achieves 90%+ automation 
for deterministic violations while maintaining human oversight for subjective issues.

#### 2.10.1 Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Layer 3: DAO Escalation                      │
│              (WatchdogDAOEscalation.sol)                        │
│    - Governance proposals for unresolved subjective issues      │
│    - Emergency proposal creation                                │
│    - Final arbitration layer                                    │
└────────────────────────┬───────────────────────────────────────┘
                         │ Escalate (3+ reports)
┌────────────────────────┴───────────────────────────────────────┐
│                Layer 2: Threshold Actions                       │
│            (WatchdogThresholdActions.sol)                       │
│    - Collect reports from multiple watchdogs                    │
│    - Execute actions at threshold (3+ reports in 24h)           │
│    - Machine-interpretable evidence system                      │
└────────────────────────┬───────────────────────────────────────┘
                         │ Report subjective issues
┌────────────────────────┴───────────────────────────────────────┐
│              Layer 1: Automated Enforcement                     │
│          (WatchdogAutomatedEnforcement.sol)                     │
│    - Deterministic rule enforcement                             │
│    - Reserve compliance, redemption timeouts                    │
│    - Operational compliance checks                              │
└─────────────────────────────────────────────────────────────────┘
```

#### 2.10.2 WatchdogAutomatedEnforcement.sol (Layer 1)

**Primary Component**: Handles 90%+ of watchdog operations through deterministic rules:

- **Reserve Compliance**: Automatically enforces stale attestations, insufficient reserves
- **Redemption Timeouts**: Defaults redemptions exceeding timeout periods
- **Operational Compliance**: Enforces wallet inactivity and QC operational requirements
- **MEV-Resistant Selection**: Uses blockhash randomness for operation selection
- **Idempotent Operations**: Prevents duplicate enforcement through cooldown periods

```solidity
// Enforcement types with cooldown tracking
mapping(bytes32 => uint256) public lastEnforcementTime;
uint256 public constant ENFORCEMENT_COOLDOWN = 1 hours; // Prevents spam

// Example deterministic rule
function enforceReserveCompliance(address qc) external {
    if (!_canEnforce("RESERVE_COMPLIANCE", qc)) {
        revert EnforcementCooldownActive();
    }
    
    (uint256 reserves, bool isStale) = reserveLedger.getReserveBalanceAndStaleness(qc);
    uint256 minted = qcData.getQCMintedAmount(qc);
    QCData.QCStatus status = qcData.getQCStatus(qc);
    
    // Only act on Active QCs
    if (status != QCData.QCStatus.Active) return;
    
    // Check stale attestation (objective: timestamp > threshold)
    if (isStale) {
        qcManager.setQCStatus(qc, QCData.QCStatus.UnderReview, "Stale reserve attestation");
        emit ReserveComplianceEnforced(qc, reserves, minted, "STALE_ATTESTATION");
    }
    
    // Check collateralization ratio (objective: reserves < minted)
    if (reserves < minted) {
        qcManager.setQCStatus(qc, QCData.QCStatus.UnderReview, "Insufficient reserves");
        emit ReserveComplianceEnforced(qc, reserves, minted, "INSUFFICIENT_RESERVES");
    }
}
```

#### 2.10.3 WatchdogThresholdActions.sol (Layer 2)

**Threshold Component**: Handles subjective issues requiring human judgment:

- **Report Types**: SUSPICIOUS_ACTIVITY, UNUSUAL_PATTERN, EMERGENCY_SITUATION, OPERATIONAL_CONCERN
- **Consensus Threshold**: 3+ watchdog reports within 24 hours trigger action
- **Evidence System**: Machine-interpretable with hash + IPFS URI pattern
- **Automatic Escalation**: Unresolved issues escalate to DAO after threshold

```solidity
// Report aggregation with threshold tracking
struct Issue {
    uint8 reportType;
    address target;
    uint256 reportCount;
    uint256 firstReportTime;
    bool actionExecuted;
    bool escalated;
}

// Evidence structure for machine processing
struct Report {
    uint8 reportType;
    address target;
    address reporter;
    uint256 timestamp;
    bytes32 evidenceHash;    // For verification
    string evidenceURI;      // IPFS link to detailed evidence
}
```

#### 2.10.4 WatchdogDAOEscalation.sol (Layer 3)

**Governance Component**: Final arbitration for complex issues:

- **Proposal Creation**: Converts threshold reports into governance proposals
- **Emergency Powers**: DAO can create emergency proposals directly
- **Resolution Tracking**: Marks issues as resolved post-governance
- **Integration**: Works with existing BridgeGovernance infrastructure

#### 2.10.5 Integration with Existing QCReserveLedger

**Reserve Tracking**: The automated framework leverages the existing `QCReserveLedger.sol`:

- **Existing Functionality**: Uses established attestation and staleness detection
- **No Duplication**: Reuses proven reserve tracking infrastructure  
- **Seamless Integration**: `WatchdogAutomatedEnforcement` calls existing methods
- **Backwards Compatible**: No changes required to existing reserve operations

#### 2.10.6 Key Benefits Over V1.1

1. **90%+ Automation**: Deterministic rules handle most operations without voting
2. **Machine Interpretable**: No more human-readable proposal parsing issues
3. **Gas Efficient**: Batch operations and optimized storage patterns
4. **MEV Resistant**: Randomized selection prevents frontrunning
5. **Gradual Migration**: Can run parallel to V1.1 during transition

### 2.11 Watchdog Architecture Evolution Journey

**ARCHITECTURAL LEARNING**: The Account Control watchdog system underwent significant evolution 
from initial design to production implementation, providing key insights into operational 
efficiency versus security trade-offs.

#### 2.11.1 Initial Design: OptimisticWatchdogConsensus (Deprecated)

**Original Vision**: The initial design attempted to implement a sophisticated optimistic 
consensus system with complex voting mechanisms and extensive parameterization.

**Key Components (Removed)**:
- **OptimisticWatchdogConsensus**: Complex voting system with escalating delays
- **MEV-Resistant Primary Selection**: Blockhash-based randomness for validator selection
- **Escalating Consensus Delays**: 1h→4h→12h→24h based on objection count
- **Approval Mechanism**: Byzantine fault tolerance with disputed operation handling

**Why It Was Abandoned**:
1. **Operational Complexity**: Required extensive coordination between multiple parties
2. **Gas Inefficiency**: Complex voting mechanisms consumed excessive gas
3. **Timing Issues**: Escalating delays created poor user experience
4. **Implementation Overhead**: Significant development and testing complexity
5. **Real-World Mismatch**: Theoretical security model didn't match practical operations

#### 2.11.2 Simplified Evolution: Dual-Path V1.1 Architecture

**Pragmatic Approach**: The production V1.1 system evolved to a **dual-path model** 
that separates routine operations from critical consensus operations.

**Key Innovation**: **90% efficiency rule** - recognize that most watchdog operations 
are routine and don't require consensus, reserving expensive consensus mechanisms 
for only critical authority decisions.

**Evolutionary Benefits**:
- **Operational Efficiency**: Individual QCWatchdog instances handle routine operations
- **Selective Consensus**: WatchdogConsensusManager used only for critical operations
- **Emergency Response**: WatchdogMonitor provides coordinated emergency responses
- **Gas Optimization**: Dramatic reduction in transaction costs
- **Simplified Operations**: Single role management for operators

#### 2.11.3 V1.2 Enhancement: Automated Decision Framework

**Next Evolution**: Address the fundamental limitation that machines cannot interpret 
subjective human-readable proposals.

**Core Problem Solved**: V1.1 consensus still required human interpretation of proposals, 
limiting automation. V1.2 introduces **deterministic rule enforcement** for objective 
violations and **threshold-based escalation** for subjective issues.

**Architectural Progression**:
```
V1.0 Complex Consensus → V1.1 Dual-Path → V1.2 Automated Framework
    (Theoretical)         (Practical)      (Machine-Driven)
```

#### 2.11.4 Key Architectural Lessons Learned

**1. YAGNI Principle Validation**: "You Aren't Gonna Need It" proved critical. The initial 
complex design included many theoretical features that weren't needed in practice.

**2. Operational Reality Over Theoretical Security**: Perfect Byzantine fault tolerance 
is less valuable than practical operational efficiency for institutional use cases.

**3. Progressive Enhancement Strategy**: Start simple (V1.1) and add sophistication 
(V1.2) based on actual operational needs rather than theoretical requirements.

**4. Clear Separation of Concerns**: Separating routine operations from critical 
authority decisions dramatically simplifies both code and operations.

**5. Human-Machine Interface Design**: Critical insight that machines need deterministic 
rules, not human-readable proposals, for effective automation.

#### 2.11.5 Design Patterns That Emerged

**1. Dual-Path Pattern**: Separate routine operations from consensus-required operations
- Routine: Direct contract calls with single role
- Critical: Multi-party consensus with voting mechanisms

**2. Layered Automation Pattern**: Three-layer decision framework
- Layer 1: Deterministic (machine-driven)
- Layer 2: Threshold-based (human-supervised)
- Layer 3: Governance (human-driven)

**3. Progressive Security Model**: Start with trust-based approach, evolve to 
trustless mechanisms as the system matures and requirements become clearer.

**4. Emergency Circuit Breaker Pattern**: Always maintain emergency coordination 
capabilities even in distributed systems.

#### 2.11.6 Future Evolution Insights

**Migration Strategy**: The modular architecture enables future enhancements without 
breaking existing operations:

- **V1.3 Cryptographic Proofs**: Add zero-knowledge proofs for reserve attestations
- **V2.0 Full Automation**: Complete machine-driven operations with minimal human oversight
- **V2.1 Cross-Chain Integration**: Extend to other blockchain networks

**Scaling Considerations**: Current architecture supports growth through:
- Horizontal scaling: Multiple QCWatchdog instances
- Vertical scaling: Enhanced automation in V1.2 framework
- Network scaling: Cross-chain deployment patterns

### 2.12 Gas Optimization Strategy

**Storage Layout Optimization**:

```solidity
// Optimized for 32-byte storage slots
struct QCData {
  QCStatus status; // 1 byte
  uint88 maxMintingCapacity; // 11 bytes
  uint88 currentMinted; // 11 bytes
  uint64 lastReserveUpdate; // 8 bytes
  uint8 reserved; // 1 byte
  // Total: 32 bytes (1 storage slot)
}

```

**Gas Cost Targets**:

- QC Registration: < 500,000 gas
- Minting Operation: < 150,000 gas
- Redemption Request: < 100,000 gas
- Risk Assessment Update: < 80,000 gas

**Computational Optimization**:

- External libraries reduce deployment gas costs
- Pure functions enable compile-time optimization
- Batch operations reduce transaction costs
- Lazy evaluation for expensive calculations

## 3. Off-chain Components: Optimistic Watchdog Quorum

The protocol implements an **Optimistic N-of-M Watchdog Quorum** for decentralized,
on-chain reporting. This system provides Byzantine fault tolerance while maintaining
gas efficiency through optimistic execution patterns.

- **Key Functions & Responsibilities:**
  - **Decentralized Quorum:** Multiple DAO-appointed watchdogs form an N-of-M consensus system
  - **M-of-N Consensus:** Configurable voting thresholds with default 2-of-5 configuration
  - **Proposal-Based Operations:** Structured voting system for critical interventions
  - **Time-Limited Voting:** 2-hour voting windows with automatic cleanup
  - **Proof-of-Reserves Attestation:** Continuously monitors all registered QC
    Bitcoin addresses through M-of-N consensus on `WatchdogConsensusManager.sol`
  - **Delinquency Arbitration:** Acts as the trusted on-chain arbiter for
    redemption failures. It monitors pending redemptions, investigates timeouts,
    and calls `recordRedemptionFulfillment` or `flagDefaultedRedemption` on
    `QCRedeemer.sol`. If a default occurs, it calls `setQCStatus` on
    `QCManager.sol` to revoke the QC's rights.
  - **Proof-of-Control Verification:** Observes `OP_RETURN` challenges during
    wallet registrations and submits the SPV proof to call `registerWallet` on
    `QCManager.sol`.

### 2.3 Security Roles & Separation of Duties

The architecture moves away from a single "Guardian" to a system of granular,
on-chain roles to enforce separation of duties and the principle of least
privilege.

- **`DEFAULT_ADMIN_ROLE` (The DAO):** The highest authority, responsible for
  appointing all other roles and managing the `ProtocolRegistry`.
- **`PARAMETER_ADMIN_ROLE` (The DAO):** Responsible for tuning non-critical system
  parameters, such as timeouts and thresholds, and for upgrading Policy
  contracts.
- **`QC_GOVERNANCE_ROLE` (The DAO):** Responsible for instant governance actions
  that require time-locked execution, including:
  - **QC Onboarding:** Adding new QC entities to the system
  - **Minting Cap Increases:** Increasing `maxMintingCap` for existing QCs
  - **Major Protocol Upgrades:** Significant system-wide changes
- **Watchdog Roles:** The Watchdog entity is granted a specific set of
  permissions:
  - **`ATTESTER_ROLE`**: The permission to submit reserve balance attestations
    to the `QCReserveLedger`.
  - **`REGISTRAR_ROLE`**: The permission to finalize wallet registrations by
    calling `registerWallet` in `QCManager`.
  - **`ARBITER_ROLE`**: The permission to flag redemption defaults and change a
    QC's status (e.g., to `UnderReview` or `Revoked`) in `QCManager`. This role
    can act **instantly** for emergency actions like pausing or removing QCs.
- **V1.2 Automated Framework Roles:** The automated decision framework introduces
  additional roles for machine-driven enforcement:
  - **`ENFORCER_ROLE`**: Permission to execute deterministic enforcement actions
    in `WatchdogAutomatedEnforcement`. Granted to watchdog operators for
    automated compliance checks.
  - **`WATCHDOG_ROLE`**: Permission to submit reports in `WatchdogThresholdActions`
    for subjective issues requiring multiple attestations.
  - **`ESCALATOR_ROLE`**: Permission to escalate unresolved issues to DAO
    governance. Typically granted to `WatchdogThresholdActions` contract.
  - **`DAO_ROLE`**: Permission to create emergency proposals in
    `WatchdogDAOEscalation`. Reserved for governance contracts.
- **`PAUSER_ROLE` (The Emergency Council):** A separate, technical multi-sig
  with the limited power to trigger a granular, temporary pause on specific
  system functions (e.g., `pauseMinting()`, `pauseRedemptions()`). This surgical
  approach minimizes disruption during a crisis and operates **instantly** without
  time delays.

This multi-role system ensures no single entity has unilateral power over the
entire system, creating checks and balances. The time-locked governance for
onboarding and cap increases provides community oversight while maintaining rapid
response capabilities for emergencies.

### 2.4 User Flows

#### 2.4.1 QC Minting Flow (Direct Bank Integration)

The minting flow is streamlined through direct Bank integration, providing a
single-step experience for users.

**Updated Flow:**

```
User → QCMinter → BasicMintingPolicy → Bank → TBTCVault → tBTC Tokens
```

**Step-by-Step Process:**

1. User calls `QCMinter.requestQCMint()` with tBTC amount
2. QCMinter validates request and calls `BasicMintingPolicy.requestMint()`
3. BasicMintingPolicy validates:
   - QC status (must be Active)
   - System state (minting not paused)
   - Amount limits (within min/max bounds)
   - QC capacity (sufficient reserves)
4. BasicMintingPolicy converts tBTC to satoshis and calls `Bank.increaseBalanceAndCall()`
5. Bank creates balance and calls `TBTCVault.receiveBalanceIncrease()`
6. TBTCVault mints tBTC tokens directly to user

```mermaid
sequenceDiagram
    participant User as User
    participant Minter as QCMinter.sol
    participant Policy as BasicMintingPolicy.sol
    participant Policy as BasicMintingPolicy.sol
    participant Bank as Bank.sol
    participant Vault as TBTCVault.sol
    participant Manager as QCManager.sol

    User->>Minter: 1. requestQCMint(amount)
    Minter->>Policy: 2. requestMint(qc, user, amount)

    Policy->>Manager: 3. Validate QC status and capacity
    Manager-->>Policy: QC validated

    Policy->>Bank: 4. increaseBalanceAndCall(vault, [user], [satoshis])
    Bank->>Vault: 5. receiveBalanceIncrease(user, satoshis)
    Vault->>User: 6. Mint tBTC tokens

    Policy-->>User: tBTC tokens minted
```

#### 2.4.2 QC Wallet Registration & De-registration Flow

Wallet management is hardened with mandatory, on-chain cryptographic
verification for critical actions.

1. **Registration (SPV-Verified):** A QC proves control of a BTC address via an
   `OP_RETURN` transaction on Bitcoin. After sending the transaction, the QC
   submits a registration request through a watchdog's authenticated REST API.
   The watchdog independently verifies the Bitcoin transaction, cross-checks the
   information provided by the QC, and then calls `registerWallet` with an SPV 
   proof, which `QCManager` verifies against the on-chain BTC light client.
2. **De-registration (Hardened On-Chain Flow):** A two-step process to prevent
   race conditions.
   1. **Request:** The QC calls `requestDeRegistration(btcAddress)` on
      `QCManager`.
   2. **Finalize:** The Watchdog later performs an atomic action by calling
      `finalizeDeRegistration(btcAddress, newBalance)`, which simultaneously
      updates the reserve attestation and performs a solvency check before
      removing the wallet.

```mermaid
sequenceDiagram
    participant QC as Qualified Custodian
    participant Manager as QCManager.sol
    participant Watchdog as Watchdog
    participant BTCNet as Bitcoin Network
    participant BTCClient as On-Chain BTC Light Client
    participant Ledger as QCReserveLedger.sol

    %% Registration
    QC->>Watchdog: 1. Signal intent to register btcAddress (off-chain)
    Watchdog-->>QC: Provides challenge hash (off-chain)
    QC->>BTCNet: 2. Create BTC Tx from btcAddress with OP_RETURN challenge
    QC->>Watchdog: 3. Submits registration request via REST API
    Watchdog->>BTCNet: 4. Independently verifies BTC transaction
    Watchdog->>Manager: 5. registerWallet(qc, btcAddress, spvProof)
    Manager->>BTCClient: 6. verifyOpReturn(spvProof, challenge)
    BTCClient-->>Manager: Returns true
    Manager->>Manager: Adds wallet to QC's pool

    %% Hardened De-registration Flow
    QC->>Manager: 1. requestDeRegistration(btcAddress)
    Manager->>Manager: Sets wallet status to PendingDeRegistration
    Manager-->>QC: Success
    note right of Watchdog: Watchdog observes event

    Watchdog->>Watchdog: 2. Calculate new total reserve (off-chain)
    Watchdog->>Manager: 3. finalizeDeRegistration(btcAddress, newLowerBalance)

    Manager->>Ledger: a. submitReserveAttestation(qc, newLowerBalance)
    Ledger-->>Manager: Success

    Manager->>Manager: b. Perform solvency check against new balance
    alt QC is Solvent
        Manager->>Manager: c. Sets wallet status to Inactive
        Manager-->>Watchdog: Success
    else QC is Insolvent
        Manager-->>Watchdog: Revert
    end
```

#### 2.4.3 System Health and Coexistence

The direct Bank integration ensures seamless coexistence with the regular Bridge:

**Separation of Concerns:**

- **Regular Bridge**: Handles DKG wallet management and Bitcoin SPV verification
- **BasicMintingPolicy**: Handles QC reserve management and attestation verification
- **Shared Components**: Both use same Bank and TBTCVault infrastructure

**Authorization Model:**

```solidity
// Bank contract maintains separate authorization for balance increasers
mapping(address => bool) public authorizedBalanceIncreasers;

// Both Bridge and BasicMintingPolicy are authorized:
authorizedBalanceIncreasers[bridgeAddress] = true;              // Regular Bridge
authorizedBalanceIncreasers[basicMintingPolicyAddress] = true;  // QC Minting
```

#### 2.4.4 Redemption Flow & Delinquency Enforcement

1. **Initiation:** A user calls `initiateRedemption` on `QCRedeemer`, burning
   `tBTC` and creating a `Pending` redemption request.
2. **Fulfillment:** The Watchdog observes the fulfillment BTC transaction,
   constructs an SPV proof, and calls `recordRedemptionFulfillment`. The
   `RedemptionPolicy` verifies the proof and marks the redemption `Fulfilled`.
3. **Delinquency:** If the `redemptionTimeout` expires, the Watchdog first calls
   `flagDefaultedRedemption` (marking the request `Defaulted`) and then
   `setQCStatus(qc, Revoked)` to permanently revoke the QC's rights.

```mermaid
sequenceDiagram
    participant User as User / Off-chain Service
    participant Watchdog as Watchdog
    participant Redeemer as QCRedeemer.sol
    participant Policy as Active RedemptionPolicy
    participant Manager as QCManager.sol
    participant QC as Qualified Custodian
    participant BTCClient as On-Chain BTC Light Client

    User->>Redeemer: 1. initiateRedemption() against QC (burns tBTC)
    Redeemer->>Redeemer: Starts redemptionTimeout
    Watchdog->>Redeemer: (Continuously monitors for fulfillment on BTC)

    alt QC is performant
        QC->>User: Fulfills redemption via BTC Tx (off-chain)
        Watchdog->>Policy: 2. recordRedemptionFulfillment(redemptionId, spvProof)
        Policy->>BTCClient: verifyTxProof(spvProof)
        BTCClient-->>Policy: Returns true
        Policy->>Redeemer: Marks redemption as Fulfilled
    else QC is NOT performant
        Note over Watchdog, Redeemer: redemptionTimeout expires...

        Watchdog->>Redeemer: 3a. flagDefaultedRedemption(redemptionId)
        Redeemer->>Redeemer: Marks redemption as Defaulted

        Watchdog->>Manager: 3b. setQCStatus(qc, Revoked, "REDEMPTION_DEFAULT")
        Manager->>Manager: Sets QC status to Revoked
    end
```

#### 2.4.5 Reserve Attestation Flow

The Watchdog constantly monitors QC balances off-chain but only submits an
on-chain attestation to `QCReserveLedger` under critical conditions: to flag
potential insolvency, to prevent a valid attestation from becoming stale, or to
support a wallet de-registration.

#### 2.4.6 QC Status Management Flow (UnderReview & Recovery)

The `UnderReview` status is a temporary "yellow card" to pause a QC's minting
rights. It can be triggered automatically if a new reserve attestation reveals a
QC is undercollateralized, or manually by an arbiter. To recover, the QC must
resolve the issue off-chain, after which an arbiter can restore its `Active`
status.

#### 2.4.7 Emergency Pause Flow

The Emergency Council (`PAUSER_ROLE`) can surgically halt specific functions
(e.g., `pauseMinting()`) via the `SystemState` contract in response to an
immediate threat, without freezing the entire protocol.

#### 2.4.8 Time-Locked Governance Flow (New QC Onboarding & Minting Cap Increases)

Critical governance actions now require a mandatory delay to provide community oversight while preserving emergency response capabilities.

**QC Onboarding Flow:**

1. **Instant Action:** The DAO calls `registerQC(qcAddress, maxMintingCap)` on `QCManager.sol`.
2. **Immediate Execution:** The system performs instant validation and onboarding.
3. **Role-Based Security:** Access control through QC_GOVERNANCE_ROLE provides security.

**Minting Cap Increase Flow:**

1. **Instant Action:** The DAO calls `increaseMintingCapacity(qcAddress, newCap)` on `QCManager.sol`.
2. **Immediate Execution:** The system performs instant validation and capacity increase.
3. **Role-Based Security:** Access control through QC_GOVERNANCE_ROLE provides security.

```mermaid
sequenceDiagram
    participant DAO as DAO (QC_GOVERNANCE_ROLE)
    participant Manager as QCManager.sol
    participant Community as Community
    participant QC as Qualified Custodian

    Note over DAO, QC: Time-Locked QC Onboarding Flow

    DAO->>Manager: 1. registerQC(qc, maxMintingCap)
    Manager->>Manager: Creates pending action with 7-day delay
    Manager-->>DAO: Success, emits GovernanceActionQueued

    Note over Community: 7-day community review period
    Community->>Community: Review proposal, raise objections if needed

    Note over DAO, Manager: After 7 days...

    Manager->>Manager: 2. Instant execution and validation
    Manager->>Manager: Verify delay has passed
    Manager->>Manager: Register QC with minting cap
    Manager-->>DAO: Success, emits GovernanceActionExecuted
    Manager-->>QC: QC is now active and can begin operations

    Note over DAO, QC: Minting Cap Increase Flow (similar process)

    DAO->>Manager: 3. queueMintingCapIncrease(qc, newCap)
    Manager->>Manager: Creates pending action with 7-day delay

    Note over Community: 7-day community review period

    DAO->>Manager: 4. executeMintingCapIncrease(qc, newCap)
    Manager->>Manager: Update QC's maxMintingCap
    Manager-->>DAO: Success
```

## 3. Governance Considerations

The DAO's role is high-level oversight, with new mechanisms to protect against
failure or capture and implement time-locked governance for critical actions.

- **Time-Locked Critical Actions:** The following actions now require a mandatory
  governance delay (typically 7 days) to provide community oversight:
  - **Onboarding QCs:** Vetting and registering new QC entities through a
    two-step queue-and-execute process.
  - **Minting Cap Increases:** Raising the `maxMintingCap` for existing QCs
    requires advance notice and community review.
  - **Major Protocol Upgrades:** Significant changes to core system parameters
    or contract implementations.
- **Instant Emergency Actions:** The following actions can be executed immediately
  without delay to respond to threats:
  - **QC Status Changes:** Moving QCs to `UnderReview` or `Revoked` status.
  - **Emergency Pauses:** Surgical halting of specific system functions.
  - **QC Removal:** Immediate revocation of QC rights in case of defaults.
- **Managing Protocol Parameters:** Setting and adjusting non-critical parameters
  such as timeouts and thresholds can be done without delay.
- **Appointing and Managing Security Roles:** Appointing the Watchdog, Emergency
  Council, and other roles.
- **Arbitrating Status:** Acting as the final arbiter for a QC (e.g., moving
  them from `UnderReview` back to `Active`).
- **Governance Failsafe (Emergency Council):** A separate, technical multi-sig
  with limited pause powers for rapid crisis response, operating without time
  delays.

## 4. Security and Economic Considerations

### 4.1 Direct Bank Integration Security Model

The direct Bank integration introduces several security considerations:

**Strengths:**

- Direct integration with proven Bank contract architecture
- Role-based access control with separation of duties
- Comprehensive input validation and system health checks
- Coexistence with existing Bridge without conflicts
- Simpler architecture reduces attack surface

**Key Risks:**

- **QC Reserve Attestation Trust Model**: Relies on QC attestations without
  cryptographic proof of Bitcoin holdings
- **Bank Authorization**: BasicMintingPolicy must be properly authorized in Bank
- **Centralized Watchdog**: Single point of failure for liveness and correctness

### 4.2 Solvency Checks & Default Handling

The V1 solvency model is based on a trust-and-verify system, backed by legal
agreements.

1. **Solvency Check:** A QC is solvent if its minted `tBTC` is less than or
   equal to its attested BTC reserves. This is checked during wallet
   de-registration.
2. **Default Scenario:** When a default is signaled by the Watchdog, the QC's
   status is set to `Revoked`. The smart contract **cannot** seize any assets.
   The loss from the default is **socialized** across all `tBTC` holders. User
   recourse is limited to off-chain legal agreements.

### 4.3 Key Acknowledged Risks for V1

- **Watchdog Quorum Resilience (Improved):** The V1.1 protocol implements an
  optimistic N-of-M watchdog quorum, significantly reducing single points of
  failure. The system can tolerate up to (N-1)/3 Byzantine failures while
  maintaining liveness. MEV-resistant selection and escalating consensus
  provide additional security. Emergency override capabilities ensure
  governance can intervene in extreme scenarios.
- **Socialized Default Risk (Critical):** The protocol merges the risk profiles
  of DKG-backed and QC-backed `tBTC`. A QC default will result in an immediate,
  socialized loss across _all_ `tBTC` holders. Recourse is limited to off-chain
  legal agreements.
- **Counterparty and Legal Recourse Risk:** The system relies on the assumption
  that regulated QCs will honor their obligations. The final security guarantee
  shifts from on-chain crypto-economics to off-chain legal contracts and the
  court system.
- **Instantaneous Governance (Partially Mitigated):** V1 now implements time-locked
  governance for critical actions like QC onboarding and minting cap increases,
  providing a 7-day window for community oversight. However, emergency actions
  (QC pausing/removal, status changes) remain instantaneous by design to enable
  rapid threat response. While this reduces governance risk for routine operations,
  it still places high trust in the security of emergency action roles and the
  DAO's governance keys.
- **Implementation Risk:** The complexity of the modular system and its
  off-chain dependencies is high.
- **MEV Risk in Minting:** The V1 minting process is vulnerable to
  front-running. This will be mitigated in a future version with a commit-reveal
  scheme.

## 5. Monitoring and Alerts

For enhanced monitoring, security, and off-chain tooling, every state change and
critical action within the contracts must emit a detailed event.

- **`QCManager.sol` Events:**
  - `QCStatusChanged(address indexed qc, QCStatus oldStatus, QCStatus newStatus, bytes32 reason)`
  - `WalletRegistered(address indexed qc, string btcAddress)`
  - `WalletDeRegistrationRequested(address indexed qc, string btcAddress)`
  - `WalletDeRegistrationFinalized(address indexed qc, string btcAddress)`
  - `GovernanceActionQueued(bytes32 indexed actionHash, uint256 executeAfter, string actionType)`
  - `GovernanceActionExecuted(bytes32 indexed actionHash, string actionType)`
  - `QCOnboarded(address indexed qc, uint256 maxMintingCap)`
  - `MintingCapIncreased(address indexed qc, uint256 oldCap, uint256 newCap)`
- **`QCReserveLedger.sol` Events:**
  - `ReserveAttestationSubmitted(address indexed attester, address indexed qc, uint256 newBalance, uint256 timestamp)`
- **`QCMinter.sol` Events:**
  - `QCMintRequested(address indexed qc, uint256 amount)`
  - `MintingPolicyUpdated(address indexed newPolicy)`
- **`QCRedeemer.sol` Events:**
  - `RedemptionRequested(bytes32 indexed redemptionId, address indexed user, address indexed qc, uint256 amount)`
  - `RedemptionFulfilled(bytes32 indexed redemptionId)`
  - `RedemptionDefaulted(bytes32 indexed redemptionId)`
  - `RedemptionPolicyUpdated(address indexed newPolicy)`
- **`SystemState.sol` Events:**
  - Events for pausing and unpausing specific functionalities.

## 6. Design Rationale - Simplified Minting Architecture

### Overview

Following YAGNI principles and production requirements analysis, the Account Control system implements a streamlined single-step minting process that directly integrates with the Bank/Vault infrastructure.

### Direct Bank Integration

The `BasicMintingPolicy.requestMint()` function implements a simple, efficient flow:

- Creates Bank balance AND immediately mints tBTC tokens in one atomic operation
- Eliminates complexity of two-step processes
- Reduces gas costs and operational overhead

### Design Benefits

1. **Simplicity**: Single function, single transaction, predictable outcome
2. **Gas Efficiency**: One transaction for the complete minting process
3. **Security**: Atomic operation prevents intermediate states
4. **User Experience**: Clear, straightforward minting flow

### Production-Driven Architecture

After extensive analysis, the two-step minting process (previously `requestMintWithOption`) was removed because:

- No production use cases required delayed minting
- Batch operations can be handled at the application layer
- Simpler contracts are easier to audit and maintain
- Reduced attack surface from fewer state transitions

### Comparison with Classic Bridge

#### Classic Bridge Approach

- Creates Bank balance first, then requires manual `TBTCVault.mint()` call
- Two-phase process necessitated by Bitcoin's async nature and SPV requirements
- Designed for trustless, decentralized operation

#### Account Control Approach

- Single atomic operation: deposit acknowledgment and token creation
- Instant verification through Watchdog attestation
- Optimized for institutional, regulated entities

### Why This Difference Makes Sense

1. **Different Trust Models**: Bridge is trustless, Account Control uses regulated entities
2. **Different Timing**: Bridge handles async Bitcoin, Account Control has instant attestations
3. **Different Users**: Bridge serves anyone, Account Control serves institutions
4. **Different Goals**: Bridge maximizes decentralization, Account Control maximizes efficiency

### Integration with Existing Infrastructure

The BasicMintingPolicy seamlessly integrates with tBTC's existing infrastructure:

```solidity
// Auto-mint flow
BasicMintingPolicy → Bank.increaseBalanceAndCall() → TBTCVault.receiveBalanceIncrease() → Mint tBTC

// Manual mint flow
BasicMintingPolicy → Bank.increaseBalance() → User later calls → TBTCVault.mint()
```

Both paths use the same underlying Bank and TBTCVault contracts, ensuring consistency and security.

### Security Considerations

1. **Input Validation**: Both paths include comprehensive validation
2. **Authorization**: BasicMintingPolicy must be authorized in Bank
3. **Validation**: Same checks regardless of auto-mint choice
4. **Atomicity**: Auto-mint ensures all-or-nothing execution

### Conclusion

The `autoMint` flag represents a thoughtful balance between:

- **Simplicity**: Clear, binary choice
- **Flexibility**: Supports diverse use cases
- **Compatibility**: Works within existing tBTC architecture
- **Future-Proofing**: Can evolve without breaking changes

This design acknowledges that QC operations are fundamentally different from classic Bridge deposits while providing the flexibility needed for sophisticated institutional use cases.

## 7. Future Extensions & V2 Improvements

The modular, policy-based architecture is explicitly intended to allow for
crucial, trust-minimizing upgrades.

### 7.1 Enhanced Direct Integration Security

- **Cryptographic Proof-of-Reserves**: Implement verifiable Bitcoin reserve
  proofs instead of trust-based attestations.
- **Advanced Access Controls**: Add timelock governance for critical parameter changes.
- **Batch Operations**: Support multiple mints in single transaction.

### 7.2 On-Chain Crypto-Economic Security (Collateralization)

A future `CollateralizedMintingPolicy` could require QCs to post an on-chain
bond in a `CollateralVault.sol`. In a default, this bond could be seized to
compensate the affected user on-chain, moving from a trust-based to a
"trust-but-verify" model.

### 7.3 Governance Time-Locks and Role Decentralization

**Current Implementation (V1):** Time-locked governance for critical actions is now
implemented, requiring a mandatory delay for QC onboarding and minting cap increases
while preserving instant emergency response capabilities.

**Future Enhancements:**

- **Extended Time-Lock Coverage:** Future versions may expand time-locked governance
  to cover additional parameter changes and system upgrades.
- **M-of-N Watchdog Quorum:** The highest priority for V2 is to decentralize the
  Watchdog role to an M-of-N quorum to remove the single point of failure.
- **Advanced Role Granularity:** The monolithic Watchdog role will be further split
  to enforce the principle of least privilege, with on-chain incentives to ensure
  operational sustainability.

### 7.4 Fair Minting and User Experience Enhancements

- **Commit-Reveal for Minting:** To mitigate MEV risk, the `QCMinter` can be
  upgraded to enforce a two-step commit-reveal scheme.
- **User-Initiated Redemption Cancellation:** A mechanism can be added to the
  `QCRedeemer` allowing a user to cancel a stale redemption request to prevent
  locked funds.
- **Cross-Chain Support**: Extend to L2 and sidechains.

## 8. Architecture Decision Records (ADRs)

### 8.1 ADR-001: Library vs Contract Architecture Decision

**Status**: Accepted  
**Date**: 2025-06-24

**Context**: Need to decide between library-based and contract-based architecture for QC functionality.

**Decision**: Use library pattern for core business logic with contract orchestration.

**Rationale**:

- Gas efficiency through external library linking
- Code reusability across multiple contracts
- Easier testing and validation of isolated components
- Modular design enables selective upgrades

**Consequences**:

- Positive: Lower deployment costs, better modularity
- Negative: Additional complexity in library linking

### 8.2 ADR-002: Storage Pattern Decision

**Status**: Accepted  
**Date**: 2025-06-24

**Context**: Choose storage pattern for QC data that balances efficiency and upgradability.

**Decision**: Use struct-based storage with library access patterns.

**Rationale**:

- Storage slot optimization through struct packing
- Clear data organization and access patterns
- Compatibility with existing BridgeState patterns
- Support for future storage layout upgrades

**Consequences**:

- Positive: Optimal gas costs, clear data organization
- Negative: Storage migration complexity for major changes

### 8.3 ADR-003: Oracle Integration Pattern

**Status**: Accepted  
**Date**: 2025-06-24

**Context**: Design oracle integration for reserve attestations with appropriate security.

**Decision**: Single trusted Watchdog with DAO oversight.

**Rationale**:

- Simplified trust model with clear accountability
- Reduced complexity compared to multi-oracle consensus
- Ability to rapidly respond to issues
- Clear path to V2 multi-oracle upgrade

**Consequences**:

- Positive: Simple implementation, clear responsibilities
- Negative: Single point of failure, trust dependency

### 8.4 ADR-004: Risk Assessment Architecture

**Status**: Accepted  
**Date**: 2025-06-24

**Context**: Design solvency monitoring system that is simple and efficient.

**Decision**: Simple reserve vs minted balance comparison with strategic attestation.

**Rationale**:

- Clear and auditable solvency model
- Low computational overhead
- Strategic attestation reduces on-chain costs
- Easily extensible for future risk models

**Consequences**:

- Positive: Simple and reliable solvency verification, low gas costs
- Negative: Relies on trusted Watchdog, less sophisticated risk modeling

### 8.5 ADR-005: Integration Strategy with Existing Bridge

**Status**: Accepted  
**Date**: 2025-06-24

**Context**: Determine how to integrate QC functionality with existing Bridge contract.

**Decision**: Direct Bank integration through BasicMintingPolicy.

**Rationale**:

- Zero breaking changes to existing functionality
- Clear separation of concerns
- Simplified architecture with direct Bank calls
- Reduced risk to existing system
- Leverages existing Bank authorization patterns

**Consequences**:

- Positive: Seamless integration, backward compatibility, simpler architecture
- Negative: Requires Bank authorization management

### 8.6 ADR-006: Time-Locked Governance Implementation

**Status**: Accepted  
**Date**: 2025-06-24

**Context**: Balance community oversight with operational efficiency for critical actions.

**Decision**: Implement time-locked governance for QC onboarding and minting cap increases.

**Rationale**:

- Provides community review period for critical decisions
- Maintains instant response for emergency actions
- Balances decentralization with operational needs
- Clear separation between routine and emergency actions

**Consequences**:

- Positive: Enhanced governance transparency, community oversight
- Negative: Delayed execution for routine operations, increased complexity

### 8.7 ADR-007: Watchdog Consensus Simplification Decision

**Status**: Accepted  
**Date**: 2025-08-04

**Context**: The initial OptimisticWatchdogConsensus design proved operationally complex and gas-inefficient during implementation, requiring a strategic pivot to a more practical approach.

**Decision**: Replace complex OptimisticWatchdogConsensus with simplified dual-path architecture using QCWatchdog for routine operations and WatchdogConsensusManager for critical consensus operations.

**Rationale**:

- **90% Efficiency Rule**: Analysis showed that 90% of watchdog operations are routine and don't require multi-party consensus
- **Gas Optimization**: Complex voting mechanisms consumed excessive gas for routine operations
- **Operational Simplicity**: Single role management (WATCHDOG_OPERATOR_ROLE) reduces operational overhead
- **Selective Consensus**: Reserve expensive consensus mechanisms only for critical authority decisions
- **User Experience**: Eliminate escalating delays (1h→4h→12h→24h) that created poor UX
- **YAGNI Principle**: Remove theoretical features that weren't needed in practice

**Implementation Details**:

- **QCWatchdog**: Individual proxy contracts for routine operations (attestation, registration, fulfillment)
- **WatchdogConsensusManager**: M-of-N voting system for critical operations (status changes, defaults)
- **WatchdogMonitor**: Coordination layer for emergency responses and multi-instance management
- **Preserved Security**: Critical operations still require consensus while routine operations gain efficiency

**Consequences**:

- Positive: Dramatic gas reduction, simplified operations, better user experience, maintained security for critical operations
- Negative: Less theoretical Byzantine fault tolerance for routine operations, architectural complexity from dual-path design

**Migration Impact**: This decision enabled the V1.2 Automated Decision Framework by establishing the foundational dual-path pattern that separates deterministic operations from consensus-requiring operations.

## 9. Deployment Architecture & System Capacity

### 9.1 Account Control Deployment Strategy

**Deployment Overview**: Account Control system deploys as an extension to the existing 
tBTC v2 infrastructure using scripts 95-101, following the established numbered 
deployment pattern.

**Phase 1: Core Infrastructure (Scripts 95-97)**

**Script 95**: `deploy_account_control_core.ts`
- QCManager: Business logic for QC lifecycle management
- QCData: Data storage contract for QC and wallet information
- QCMinter: Entry point for minting operations
- QCRedeemer: Entry point for redemption operations
- ProtocolRegistry: Service locator for modular architecture

**Script 96**: `deploy_account_control_state.ts`
- SystemState: Global state and emergency controls
- QCReserveLedger: Reserve attestation tracking
- SPVValidator: Bitcoin transaction verification

**Script 97**: `deploy_account_control_policies.ts`
- BasicMintingPolicy: Direct Bank integration for minting
- BasicRedemptionPolicy: Redemption fulfillment and default handling

**Phase 2: Watchdog System (Script 98)**

**Script 98**: `deploy_account_control_watchdog.ts`
- WatchdogConsensusManager: M-of-N consensus for critical operations
- WatchdogMonitor: Coordinates multiple QCWatchdog instances
- QCWatchdog: Individual watchdog proxy for routine operations

**Phase 3: System Configuration (Script 99)**

**Script 99**: `configure_account_control_system.ts`
- Role assignments and permissions
- Contract authorizations and integrations
- Parameter initialization
- Bank authorization for BasicMintingPolicy

**Phase 4: V1.2 Automated Framework (Scripts 100-101)**

**Script 100**: `deploy_automated_decision_framework.ts`
- WatchdogAutomatedEnforcement: Layer 1 deterministic enforcement
- WatchdogThresholdActions: Layer 2 threshold-based actions
- WatchdogDAOEscalation: Layer 3 governance escalation

**Script 101**: `configure_automated_decision_framework.ts`
- Framework configuration and role assignments
- Integration with existing V1.1 system
- Automated framework activation

### 9.2 System Capacity Design

**Scalability Targets**:

| Metric                    | Target Capacity           | Growth Strategy                     |
| ------------------------- | ------------------------- | ----------------------------------- |
| **QCs Supported**         | 50 active QCs             | Horizontal scaling through sharding |
| **Wallets per QC**        | 20 Bitcoin addresses      | Dynamic allocation based on needs   |
| **Concurrent Operations** | 1000+ simultaneous        | Batch processing optimization       |
| **Data Retention**        | 5+ years operational data | Efficient archival and pruning      |

### 9.3 Deployment Scripts Architecture

**Hardhat Deploy Pattern**: Account Control follows the established tBTC v2 numbered 
deployment convention, using scripts 95-101 for the complete system.

```typescript
// Account Control Deployment Scripts (95-101)
deploy/
├── 95_deploy_account_control_core.ts          // Core contracts
├── 96_deploy_account_control_state.ts         // State management
├── 97_deploy_account_control_policies.ts      // Policy contracts
├── 98_deploy_account_control_watchdog.ts      // Watchdog system
├── 99_configure_account_control_system.ts     // System configuration
├── 100_deploy_automated_decision_framework.ts // V1.2 framework
└── 101_configure_automated_decision_framework.ts // Framework config
```

**Integration with Existing Scripts**: Account Control integrates with existing 
tBTC infrastructure deployed in earlier scripts (00-94):

- **Script 30**: `deploy_spv_validator.ts` - SPV infrastructure for Bitcoin verification
- **Script 05**: `deploy_bank.ts` - Bank contract for balance management
- **Script 07**: `deploy_tbtc_vault.ts` - Vault contract for token minting

**Dependency Chain**:
```
Scripts 00-94 (tBTC Infrastructure) → Scripts 95-99 (Account Control V1.1) → Scripts 100-101 (V1.2 Framework)
```

**Environment-Specific Configuration**:

- Testnet: Relaxed parameters for testing
- Mainnet: Production-grade security parameters
- Development: Fast iteration parameters

## 10. Monitoring & Observability

### 10.1 Real-Time Monitoring System

```
Monitoring System Architecture
├── Event Stream Processing
│   ├── Smart contract event ingestion
│   ├── Real-time event filtering
│   └── Event correlation and analysis
├── Metrics Collection
│   ├── System health metrics
│   ├── Business operation metrics
│   └── Security incident metrics
├── Alerting System
│   ├── Threshold-based alerts
│   ├── Anomaly detection alerts
│   └── Emergency escalation procedures
└── Dashboard & Visualization
    ├── Real-time system status
    ├── Historical trend analysis
    └── Risk assessment visualizations
```

### 10.2 Key Performance Indicators (KPIs)

**System Health KPIs**:

- QC system uptime percentage
- Average transaction confirmation time
- Oracle consensus success rate
- Risk assessment computation time

**Business Operation KPIs**:

- Active QC count and utilization
- Daily minting/redemption volumes
- Average risk scores across QCs
- Fee collection and distribution rates

**Security KPIs**:

- Number of failed validation attempts
- Oracle consensus disagreement frequency
- Emergency circuit breaker activations
- Time to incident resolution

### 10.3 Alert Classification System

**Severity Levels**:

- **P0 Critical**: System down or security breach
- **P1 High**: Major functionality impaired
- **P2 Medium**: Minor functionality issues
- **P3 Low**: Performance degradation or warnings

**Response Timeline**:

- **0-5 minutes**: Automated alert generation and initial assessment
- **5-15 minutes**: Human verification and initial response
- **15-60 minutes**: Detailed investigation and mitigation
- **1-24 hours**: Full resolution and post-incident analysis
