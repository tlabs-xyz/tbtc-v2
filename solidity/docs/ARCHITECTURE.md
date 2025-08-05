# tBTC v2 Account Control System Architecture

**Document Version**: 2.0  
**Date**: 2025-08-04  
**Status**: Production Ready  
**Purpose**: Comprehensive technical architecture specification for V1.1 production system with V1.2 automation framework

---

## Executive Summary

The tBTC v2 Account Control system enables **Qualified Custodians** (regulated institutional entities) to mint tBTC tokens against their Bitcoin reserves through **direct Bank integration**. The system implements a sophisticated dual-path architecture:

- **V1.1 Production System**: Configurable M-of-N consensus for critical operations with 90% independent watchdog operations
- **V1.2 Automation Framework**: Three-layer automated decision system achieving 90%+ automation

### Core Architectural Principles

1. **Direct Integration**: Leverage existing Bank/Vault infrastructure without abstraction layers
2. **Modular Design**: Policy-driven contracts enable evolution without breaking core interfaces  
3. **Data/Logic Separation**: Clear separation between storage (QCData) and business logic (QCManager)
4. **Dual-Path Watchdog Model**: Independent operations + targeted consensus for authority decisions
5. **Future-Proof Interfaces**: Stable core contracts with upgradeable policy implementations

---

## Table of Contents

1. [System Architecture Overview](#system-architecture-overview)
2. [Smart Contract Architecture](#smart-contract-architecture)
3. [V1.1 Watchdog System](#v11-watchdog-system)
4. [V1.2 Automated Framework](#v12-automated-framework)
5. [Protocol Integration](#protocol-integration)
6. [Security Model](#security-model)
7. [Deployment Architecture](#deployment-architecture)
8. [Future Enhancements](#future-enhancements)

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

## V1.1 Watchdog System

### Dual-Path Architecture Principle

**Core Principle**: Independent operations for data, consensus for authority, automatic responses for emergencies.

The V1.1 system categorizes operations into two paths:
- **Independent Path (90%)**: Data submission, SPV verification, routine attestations
- **Consensus Path (10%)**: Authority decisions requiring M-of-N agreement

### Architecture Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   QCWatchdog    │    │   QCWatchdog    │    │   QCWatchdog    │
│   Instance #1   │    │   Instance #2   │    │   Instance #3   │
│   (Operator A)  │    │   (Operator B)  │    │   (Operator C)  │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    WatchdogMonitor      │
                    │  • Registers watchdogs  │
                    │  • Emergency monitoring │
                    │  • Critical reports     │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ WatchdogConsensusManager│
                    │  • M-of-N consensus     │
                    │  • Status changes       │
                    │  • Critical decisions   │ 
                    └─────────────────────────┘
```

### 1. QCWatchdog.sol (Individual Instances)

**Purpose**: Individual watchdog operations for independent execution

**Independent Operations** (90% of workload):
- `attestReserves()` - Reserve balance attestations
- `registerWalletWithProof()` - Wallet registration with SPV proof
- `recordRedemptionFulfillment()` - Redemption completion with proof
- `raiseConcern()` - General concern reporting

**Key Features**:
- Deployed independently by each operator
- No coordination required for routine operations
- Direct QC API integration for efficiency
- Geographic and organizational distribution

### 2. WatchdogConsensusManager.sol (M-of-N Consensus)

**Purpose**: M-of-N consensus for critical operations requiring group authority

**Consensus Operations** (10% of workload):
1. **STATUS_CHANGE** - QC status modifications (Active ↔ UnderReview ↔ Revoked)
2. **WALLET_DEREGISTRATION** - Remove wallet from QC (prevents griefing)
3. **REDEMPTION_DEFAULT** - Flag redemption as defaulted (triggers penalties)
4. **FORCE_INTERVENTION** - Manual override operations (emergency governance)

**Configuration Parameters**:
```solidity
uint256 public requiredVotes = 2;      // M (required votes)
uint256 public totalWatchdogs = 5;     // N (total watchdog count)
uint256 public votingPeriod = 2 hours; // Voting window
```

**Parameter Bounds**:
```solidity
uint256 public constant MIN_REQUIRED_VOTES = 2;
uint256 public constant MAX_REQUIRED_VOTES = 7;
uint256 public constant MIN_VOTING_PERIOD = 1 hours;
uint256 public constant MAX_VOTING_PERIOD = 24 hours;
```

### 3. WatchdogMonitor.sol (Coordination & Emergency)

**Purpose**: Coordinates multiple independent QCWatchdog instances and emergency responses

**Key Features**:
- Watchdog instance registration and lifecycle management
- Emergency circuit breaker (3 critical reports → automatic pause)
- Report validity tracking (1-hour window)
- Clean separation between monitoring and consensus

**Emergency System**:
```solidity
uint256 public constant CRITICAL_REPORTS_THRESHOLD = 3;
uint256 public constant REPORT_VALIDITY_PERIOD = 1 hours;
```

---

## V1.2 Automated Framework

### Three-Layer Decision System

The V1.2 framework transforms watchdog operations from subjective voting to objective enforcement with clear DAO escalation:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         90%+ Automated Operations                   │
├─────────────────────┬─────────────────────┬─────────────────────────┤
│   Layer 1           │   Layer 2           │   Layer 3               │
│   Deterministic     │   Threshold-Based   │   DAO Escalation       │
│   Enforcement       │   Actions           │                         │
├─────────────────────┼─────────────────────┼─────────────────────────┤
│                     │                     │                         │
│ • Reserve checks    │ • 3+ reports needed │ • Governance proposals  │
│ • Timeout detection │ • Evidence required │ • Community decisions   │
│ • Inactivity rules  │ • Cooldown periods  │ • Complex judgments     │
│ • SPV validation    │ • Auto-escalation   │                         │
│                     │                     │                         │
│ Response: <1 min    │ Response: <1 hour   │ Response: Days/weeks    │
└─────────────────────┴─────────────────────┴─────────────────────────┘
```

### Layer 1: WatchdogAutomatedEnforcement.sol

**Purpose**: Handle all objective, measurable conditions without consensus

**Fully Automated Checks**:
```solidity
function enforceReserveCompliance(address qc) external {
    (uint256 reserves, bool isStale) = reserveLedger.getReserveBalanceAndStaleness(qc);
    uint256 minted = qcData.getMintedAmount(qc);
    
    // Stale attestation check
    if (isStale) {
        qcManager.setQCStatus(qc, QCData.QCStatus.UnderReview, "STALE_ATTESTATIONS");
        return;
    }
    
    // Insufficient reserves check
    if (reserves * 100 < minted * minCollateralRatio) {
        qcManager.setQCStatus(qc, QCData.QCStatus.UnderReview, "INSUFFICIENT_RESERVES");
    }
}

function enforceRedemptionTimeout(bytes32 redemptionId) external {
    // Automatic timeout enforcement
    require(block.timestamp > r.requestTime + redemptionTimeout, "Not timed out");
    redeemer.flagDefaultedRedemption(redemptionId, "TIMEOUT");
}
```

### Layer 2: WatchdogThresholdActions.sol

**Purpose**: Collect reports on non-deterministic issues, act at threshold

**Report Types**:
```solidity
enum ReportType {
    SUSPICIOUS_ACTIVITY,
    UNUSUAL_PATTERN, 
    EMERGENCY_SITUATION,
    OPERATIONAL_CONCERN
}
```

**Threshold Logic**:
```solidity
uint256 public constant REPORT_THRESHOLD = 3;
uint256 public constant REPORT_WINDOW = 24 hours;
uint256 public constant COOLDOWN_PERIOD = 7 days;
```

### Layer 3: WatchdogDAOEscalation.sol

**Purpose**: Create DAO proposals for all non-deterministic decisions

**Escalation Process**:
1. Threshold reached in Layer 2
2. Automatic DAO proposal creation
3. Community governance decision
4. Proposal execution

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
WatchdogConsensusManager:
├── ARBITER_ROLE in QCManager (for status changes)
├── ARBITER_ROLE in QCRedeemer (for redemption defaults)
└── WATCHDOG_ROLE granted to operators

WatchdogMonitor:
├── MANAGER_ROLE controls watchdog registration
├── WATCHDOG_OPERATOR_ROLE for critical reports
└── Grants WATCHDOG_ROLE in WatchdogConsensusManager

QCWatchdog (multiple instances):
├── Independent operations (no special roles)
├── ATTESTER_ROLE in QCReserveLedger
└── REGISTRAR_ROLE in QCManager
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

**V1.1 Watchdog System**:
```solidity
// WatchdogConsensusManager
uint256 public requiredVotes = 2;              // M value
uint256 public totalWatchdogs = 5;             // N value  
uint256 public votingPeriod = 2 hours;         // Voting window

// WatchdogMonitor
uint256 public constant CRITICAL_REPORTS_THRESHOLD = 3; // Emergency trigger
uint256 public constant REPORT_VALIDITY_PERIOD = 1 hour; // Report freshness
```

**V1.2 Automated Framework**:
```solidity
// WatchdogAutomatedEnforcement
uint256 public minCollateralRatio = 90;        // 90% minimum
uint256 public staleThreshold = 24 hours;      // Attestation staleness
uint256 public redemptionTimeout = 48 hours;   // Redemption deadline

// WatchdogThresholdActions
uint256 public constant REPORT_THRESHOLD = 3;  // Reports needed
uint256 public constant REPORT_WINDOW = 24 hours; // Time window
uint256 public constant COOLDOWN_PERIOD = 7 days; // Between actions
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