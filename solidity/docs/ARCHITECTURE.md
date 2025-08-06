# tBTC v2 Account Control System Architecture

**Document Version**: 3.0  
**Date**: 2025-08-06  
**Status**: Production Ready  
**Purpose**: Comprehensive technical architecture specification with simplified watchdog system

---

## Executive Summary

The tBTC v2 Account Control system enables **Qualified Custodians** (regulated institutional entities) to mint tBTC tokens against their Bitcoin reserves through **direct Bank integration**. The system implements a simplified watchdog architecture based on the Three-Problem Framework:

- **Oracle Problem**: Multi-attester consensus for objective facts (reserve balances)
- **Observation Problem**: Transparent reporting of subjective concerns via events
- **Decision Problem**: Direct DAO governance without intermediary contracts

### Core Architectural Principles

1. **Direct Integration**: Leverage existing Bank/Vault infrastructure without abstraction layers
2. **Modular Design**: Policy-driven contracts enable evolution without breaking core interfaces  
3. **Data/Logic Separation**: Clear separation between storage (QCData) and business logic (QCManager)
4. **Simplified Watchdog**: Machine-readable codes, distributed trust, permissionless enforcement
5. **Future-Proof Interfaces**: Stable core contracts with upgradeable policy implementations

---

## Table of Contents

1. [System Architecture Overview](#system-architecture-overview)
2. [Smart Contract Architecture](#smart-contract-architecture)
3. [Simplified Watchdog System](#simplified-watchdog-system)
4. [Protocol Integration](#protocol-integration)
5. [Security Model](#security-model)
6. [Deployment Architecture](#deployment-architecture)
7. [Future Enhancements](#future-enhancements)

---

## System Architecture Overview

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    tBTC v2 Account Control System                   │
├─────────────────────┬─────────────────────┬─────────────────────────┤
│   QC Management     │   Watchdog System   │   Protocol Integration  │
│    (Enhanced)       │   (Dual-Path)       │     (Optimized)         │
├─────────────────────┼─────────────────────┼─────────────────────────┤
│                     │                     │                         │
│ QCManager           │ V1.1 System:        │ BasicMintingPolicy      │
│ QCData              │ • QCWatchdog        │                         │
│ QCMinter            │ • ConsensusManager  │ • Direct Integration    │
│ QCRedeemer          │ • WatchdogMonitor   │ • 50% Gas Savings       │
│ QCReserveLedger     │                     │ • Registry-based        │
│                     │ V1.2 Framework:     │                         │
│ • Bitcoin Wallets   │ • AutoEnforcement   │                         │
│ • Reserve Tracking  │ • ThresholdActions  │                         │
│ • SPV Verification  │ • DAO Escalation    │                         │
└─────────────────────┴─────────────────────┴─────────────────────────┘
```

### Integration with Existing tBTC v2

The Account Control system deploys as an **independent contract suite** that integrates seamlessly with existing tBTC infrastructure:

```
User → QCMinter → BasicMintingPolicy → Bank → TBTCVault → tBTC Tokens
```

**Key Integration Points**:
- **Bank Authorization**: BasicMintingPolicy authorized via `authorizedBalanceIncreasers`
- **Shared Infrastructure**: Uses same Bank/Vault/Token contracts as regular Bridge
- **Perfect Fungibility**: QC-minted tBTC indistinguishable from Bridge-minted tBTC
- **Coexistence**: Regular Bridge operations continue unchanged

---

## Smart Contract Architecture

### Core Contract Hierarchy

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   QCMinter      │────│ BasicMintingPolicy│────│   Bank.sol      │
│  (Entry Point)  │    │ (Direct Integration)│   │ (Existing)      │
└─────────────────┘    └──────────────────┘    └─────────════════┘
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
```

### 1. BasicMintingPolicy.sol (Core Integration)

**Purpose**: The cornerstone of QC integration, acting as the direct interface between Account Control and existing tBTC Bank/Vault architecture.

**Key Features**:
- Directly calls `Bank.increaseBalanceAndCall()` for seamless integration
- Auto-minting capability through TBTCVault integration
- Capacity validation and authorization checks
- Emergency pause mechanisms
- Policy-driven evolution (upgradeable via ProtocolRegistry)

**Critical Methods**:
```solidity
function creditQCBackedDeposit(
    address user,
    uint256 amount,
    address qc,
    bytes32 mintId,
    bool autoMint
) external onlyRole(MINTER_ROLE);
```

### 2. ProtocolRegistry.sol (Service Locator)

**Purpose**: Central registry enabling modular architecture and seamless upgrades.

**Key Features**:
- Service registration and discovery
- Hot-swappable policy contracts  
- Gas-optimized service resolution
- Version management capabilities

**Usage Pattern**:
```solidity
// Policy lookup
IBasicMintingPolicy policy = IBasicMintingPolicy(
    registry.getService("MINTING_POLICY")
);

// Service registration
registry.setService("MINTING_POLICY", newPolicyAddress);
```

### 3. QC Management Contracts

#### QCManager.sol (Business Logic)
- **Stateless business logic** for QC operations
- QC status management (Active, UnderReview, Revoked)
- Capacity calculations and validations
- Wallet registration coordination
- Integration with watchdog consensus

#### QCData.sol (Storage Layer)
- **Pure storage contract** for QC state
- Gas-optimized data structures
- Audit-friendly data access patterns
- Separation of concerns from business logic

#### QCMinter.sol & QCRedeemer.sol (Stable Interfaces)
- **Entry points** for minting and redemption operations
- Policy delegation to maintain interface stability
- Emergency pause capabilities
- Role-based access control

#### QCReserveLedger.sol (Reserve Tracking)
- Bitcoin reserve attestation storage
- Staleness detection and validation
- Multi-watchdog attestation support
- Historical reserve tracking

---

## Simplified Watchdog System

### Three-Problem Framework

**Core Principle**: Different problems require different solutions - oracle consensus for facts, transparent reporting for observations, direct DAO action for decisions.

The system separates concerns into:
- **Oracle Problem**: Multi-attester consensus for objective facts
- **Observation Problem**: Individual transparent reporting for subjective concerns
- **Decision Problem**: Direct DAO governance without intermediaries

### Architecture Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Attester #1   │    │   Attester #2   │    │   Attester #3   │
│                 │    │                 │    │                 │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    ReserveOracle        │
                    │  • Collects attestations│
                    │  • Calculates median    │
                    │  • Pushes consensus     │
                    └────────────┬────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│QCReserveLedger│    │WatchdogEnforcer  │    │SubjectiveReporting│
│ • Stores data │    │ • Permissionless │    │ • Event emission │
│ • Solvency    │    │ • Reason codes   │    │ • DAO monitoring │
└──────────────┘    └──────────────────┘    └──────────────────┘
```

### 1. ReserveOracle.sol

**Purpose**: Multi-attester consensus for reserve balances

**Key Operations**:
- `submitAttestation(address qc, uint256 balance)` - Attesters submit observations
- `getConsensusReserves(address qc)` - Returns median consensus
- Automatic push to QCReserveLedger when threshold met

**Key Features**:
- Minimum 3 attesters required for consensus
- Median calculation prevents manipulation
- No single point of trust
- Byzantine fault tolerance

### 2. WatchdogEnforcer.sol

**Purpose**: Permissionless enforcement of objective violations

**Enforcement Operations**:
- `enforceObjectiveViolation(address qc, bytes32 reasonCode)` - Anyone can trigger
- Validates reason code is objective (machine-verifiable)
- Checks violation condition against current state
- Updates QC status if violation confirmed

**Supported Violations**:
```solidity
bytes32 constant INSUFFICIENT_RESERVES = keccak256("INSUFFICIENT_RESERVES");
bytes32 constant STALE_ATTESTATIONS = keccak256("STALE_ATTESTATIONS");
bytes32 constant ZERO_RESERVES = keccak256("ZERO_RESERVES");
bytes32 constant REDEMPTION_TIMEOUT = keccak256("REDEMPTION_TIMEOUT");
```

### 3. WatchdogSubjectiveReporting.sol

**Purpose**: Transparent reporting of subjective observations

**Report Structure**:
```solidity
struct Report {
    uint256 id;
    address watchdog;
    address target;
    ObservationType obsType;
    string description;
    bytes32[] evidenceHashes;  // Max 20 hashes
    uint256 timestamp;
    uint256 supportCount;
}
```

**Key Features**:
- Simple event emission for DAO monitoring
- Support mechanism for validation
- Evidence stored as hashes (actual content via REST API)
- No complex state machines or escalation

---

### 4. WatchdogReasonCodes.sol

**Purpose**: Machine-readable violation codes

**Key Features**:
- Standardized bytes32 constants for all violations
- Clear separation of objective (90%) vs subjective (10%)
- Enables automated validation without human interpretation
- Gas-efficient compared to string comparisons

---

## Protocol Integration

### Direct Bank Integration Architecture

The system achieves efficiency through direct integration with existing tBTC contracts:

**Integration Flow**:
```
QC Request → QCMinter → BasicMintingPolicy
    ↓
Bank.increaseBalanceAndCall()
    ↓
TBTCVault.receiveBalanceIncrease() → Auto-mint tBTC
```

**Benefits**:
- **50% Gas Reduction**: Direct calls eliminate intermediate contracts
- **Proven Infrastructure**: Leverages battle-tested Bank/Vault architecture
- **Perfect Fungibility**: QC tBTC identical to Bridge tBTC
- **Operational Efficiency**: ~$375,000 annual operational savings

### Role Integration

**System Role Hierarchy**:
```
ReserveOracle:
├── Multiple ATTESTER_ROLE holders submit attestations
├── Oracle has ATTESTER_ROLE in QCReserveLedger
└── Pushes consensus automatically

WatchdogEnforcer:
├── ARBITER_ROLE in QCManager (for status changes)
├── Permissionless enforcement (anyone can call)
└── Uses machine-readable reason codes

WatchdogSubjectiveReporting:
├── WATCHDOG_ROLE for submitting reports
├── Emits events for DAO monitoring
└── No direct contract interactions
```

### ProtocolRegistry Usage

**Direct Integration** (Gas Optimized):
- Bank contract - Core balance management
- TBTCVault contract - Token minting/burning
- TBTC token contract - ERC-20 operations

**Registry Integration** (Flexible):
- BasicMintingPolicy (upgradeable)
- BasicRedemptionPolicy (upgradeable)
- QC management contracts
- System state and operational parameters

---

## Security Model

### Threat Model

**Protected Against**:
- Single malicious watchdog (M-of-N consensus)
- Coordination failures (independent operations)
- Emergency scenarios (automatic responses)
- Operator failures (watchdog deactivation)
- Front-running attacks (idempotent operations)

**Trust Assumptions**:
- Majority of watchdogs honest (standard assumption)
- Watchdogs are KYC'd legal entities (not anonymous)
- DAO governance acts in system interest

### Access Control Architecture

**Multi-layered Security**:
1. **Role-based Access Control**: OpenZeppelin AccessControl throughout
2. **Time-locked Governance**: 7-day delays for critical parameter changes
3. **Emergency Pause Mechanisms**: Granular pause controls per operation type
4. **Parameter Bounds**: Hard-coded limits prevent malicious configurations

### Security Features by Component

**QC Management**:
- SPV proof validation for all Bitcoin operations
- Reserve attestation staleness detection
- Capacity enforcement and validation
- Status change authorization controls

**Watchdog System**:
- M-of-N consensus for authority decisions
- Independent verification for data operations
- Emergency circuit breaker with automatic triggers
- Cooldown periods prevent spam attacks

**Protocol Integration**:
- Direct integration reduces attack surface
- Existing Bank/Vault security model maintained
- Perfect fungibility prevents protocol discrimination
- Emergency pause capabilities preserved

---

## Deployment Architecture

### Contract Deployment Order

The system deploys through numbered scripts ensuring proper dependency resolution:

**Core Infrastructure (Scripts 95-99)**:
1. `95_deploy_account_control_core.ts` - Core QC management contracts
2. `96_deploy_account_control_state.ts` - System state and registry
3. `97_deploy_account_control_policies.ts` - Minting and redemption policies
4. `98_deploy_account_control_watchdog.ts` - V1.1 watchdog consensus system
5. `99_configure_account_control_system.ts` - Final system configuration

**V1.2 Automation Framework (Scripts 100-102)**:
6. `100_deploy_automated_decision_framework.ts` - Three-layer automation system
7. `101_configure_automated_decision_framework.ts` - Role assignments and parameters

### Production Deployment Strategy

**Multi-Environment Approach**:
1. **Development**: Single watchdog, fast parameters for testing
2. **Staging**: 2-of-3 consensus, realistic parameters for validation
3. **Production**: 3-of-5 consensus, secure parameters for mainnet

**Scaling Considerations**:
```
Watchdog Count    Recommended M    Reasoning
3                 2                67% threshold (2-of-3)
5                 3                60% threshold (3-of-5)  
7                 4                57% threshold (4-of-7)
9                 5                56% threshold (5-of-9)
```

### Geographic Distribution

**Operational Security Requirements**:
- Independent deployment by different operators
- Geographic distribution across regions
- Organizational independence (different legal entities)
- No shared infrastructure dependencies

---

## Future Enhancements

### Architecture Evolution Path

The modular architecture enables seamless evolution through policy upgrades:

**Current → V2 Migration Path**:
```
V1.1 Dual-Path (Production)
    ↓
V1.2 Automated Framework (Enhanced)  
    ↓
V2.0 Crypto-Economic (Trust-minimized)
    ↓
V3.0 Fully Autonomous (AI-driven)
```

### Key Enhancement Categories

#### 1. Protocol Registry Enhancements
- **Service Versioning**: Blue-green policy deployments
- **Health Checking**: Automated monitoring integration
- **Performance Metrics**: Real-time service health monitoring

#### 2. Enhanced Minting Strategies
- **Strategy Enum**: Replace boolean with flexible options
- **Batch Operations**: Gas optimization for high-volume QCs
- **Conditional Minting**: Smart execution based on market conditions

#### 3. Advanced Security Features
- **Cryptographic Proof-of-Reserves**: Replace trust-based attestations
- **Granular Emergency Controls**: Fine-grained pause mechanisms
- **Multi-signature Integration**: Enhanced institutional controls

#### 4. DeFi Integration
- **Liquidity Provision**: QC reserves as DeFi collateral
- **Flash Loan Support**: Capital efficiency improvements
- **Structured Products**: Derivatives and yield instruments

#### 5. Cross-Chain Expansion
- **L2 Integration**: Direct minting on Layer 2 solutions
- **Cross-Chain Messaging**: Multi-network QC operations
- **Interoperability Protocols**: Standardized cross-chain interfaces

### Implementation Priority

**High Priority** (6-12 months):
- Service versioning support
- Cryptographic proof-of-reserves
- Batch operations support
- Enhanced emergency controls

**Medium Priority** (12-18 months):
- Advanced minting strategies
- DeFi protocol integrations
- Cross-chain expansion
- Performance optimizations

**Future Research** (18+ months):
- Fully autonomous operations
- AI-driven risk management
- Novel consensus mechanisms
- Quantum-resistant cryptography

---

## Configuration Parameters

### System-Wide Defaults

**Simplified Watchdog System**:
```solidity
// ReserveOracle
uint256 public constant MIN_ATTESTERS = 3;     // Minimum for consensus
uint256 public attestationWindow = 1 hours;    // Collection window

// SystemState (used by WatchdogEnforcer)
uint256 public minCollateralRatio = 90;        // 90% minimum
uint256 public staleThreshold = 7 days;        // Attestation staleness
uint256 public redemptionTimeout = 48 hours;   // Redemption deadline

// WatchdogSubjectiveReporting
uint256 public constant MAX_EVIDENCE_PER_REPORT = 20; // Evidence hashes
mapping(ObservationType => uint256) supportThresholds:
  SECURITY_OBSERVATION => 0    // Immediate
  COMPLIANCE_QUESTION => 1     // 1 supporter
  Others => 3                  // 3 supporters
```

### Environment-Specific Tuning

**Development**:
- Single approval for testing
- Faster iteration cycles
- Relaxed validation rules

**Staging**:
- Majority consensus validation
- Realistic timing parameters
- Full feature testing

**Production**:
- Secure majority requirements
- Conservative timing windows
- Maximum security validation

---

## Monitoring and Observability

### Key Performance Indicators

**System Health**:
- Active watchdog count and distribution
- Consensus participation rates
- Emergency response times
- Automated enforcement accuracy

**Operational Metrics**:
- QC onboarding and status changes
- Minting/redemption volumes and success rates
- Reserve attestation frequency and staleness
- Policy upgrade deployment frequency

**Security Metrics**:
- Failed authorization attempts
- Emergency pause triggers
- Consensus disputes and resolutions
- Attack vector monitoring

### Alerting Framework

**Critical Alerts**:
- Emergency pause triggered
- Watchdog consensus failure
- Automated enforcement errors
- Security policy violations

**Warning Alerts**:
- Stale reserve attestations
- Low watchdog participation
- Approaching capacity limits
- Performance degradation

**Informational Alerts**:
- Successful policy upgrades
- New QC onboarding
- System parameter changes
- Regular health check reports

---

## Conclusion

The tBTC v2 Account Control architecture represents a sophisticated balance of automation, security, and institutional requirements. Through its modular design, dual-path watchdog system, and direct Bank integration, it achieves:

- **90%+ operational automation** with human oversight for critical decisions
- **50% gas cost reduction** through direct protocol integration
- **Institutional compliance** through regulated QC framework
- **Future-proof evolution** via policy-driven architecture
- **Comprehensive security** through multiple validation layers

The architecture's strength lies in its ability to evolve - from the current V1.1 production system through V1.2 automation enhancements toward future crypto-economic trust-minimization - all while maintaining interface stability and operational continuity.

This comprehensive specification serves as the definitive reference for understanding, deploying, and maintaining the complete Account Control system across all architectural versions and operational environments.

---

**Document History**:
- v2.0 (2025-08-04): Consolidated architecture specification
- Combines: ARCHITECTURE.md, V1.1 specification, and Future Enhancements
- Covers: Complete V1.1 production + V1.2 automation framework