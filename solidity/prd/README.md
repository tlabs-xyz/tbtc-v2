# Account Control Architecture for tBTC v2

**Document Version**: 2.0  
**Date**: 2025-08-06  
**Architecture**: Simplified Watchdog System  
**Status**: Production Ready

---

## Quick Start

Welcome to the Account Control system documentation. This feature extends tBTC v2 to support Qualified Custodians (QCs) through direct Bank integration.

### 📋 Essential Documents

| Document                                                   | Purpose                             | Audience                 |
| ---------------------------------------------------------- | ----------------------------------- | ------------------------ |
| **[REQUIREMENTS.md](REQUIREMENTS.md)**                     | Complete requirements specification | All stakeholders         |
| **[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)**     | Detailed technical architecture     | Architects, developers   |
| **[../docs/IMPLEMENTATION.md](../docs/IMPLEMENTATION.md)** | Code patterns and deployment        | Developers, DevOps       |
| **[FLOWS.md](FLOWS.md)**                                   | User journeys and sequences         | Product, QA, integrators |

### 📚 Reference Documents

| Document                                                                                                     | Purpose                             | Audience            |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ------------------- |
| **[../docs/CURRENT_SYSTEM_STATE.md](../docs/CURRENT_SYSTEM_STATE.md)**                                       | Current system state (truth source) | All stakeholders    |
| **[../docs/WATCHDOG_FINAL_ARCHITECTURE.md](../docs/WATCHDOG_FINAL_ARCHITECTURE.md)**                         | Watchdog system architecture        | Technical teams     |
| **[../docs/future-enhancements/FUTURE_ENHANCEMENTS.md](../docs/future-enhancements/FUTURE_ENHANCEMENTS.md)** | V2 roadmap and enhancements         | Product, architects |
| **[../DOCUMENTATION_MAP.md](../DOCUMENTATION_MAP.md)**                                                       | Complete documentation navigation   | All stakeholders    |

---

## Executive Summary

### What is Account Control?

Account Control enables **Qualified Custodians** (regulated institutional entities) to mint tBTC tokens against their segregated Bitcoin reserves through **direct Bank integration**. This expands tBTC liquidity while maintaining the security and decentralization principles of the original protocol.

### Key Innovation: Direct Bank Integration

Account Control integrates directly with the existing tBTC Bank/Vault architecture:

```
User → QCMinter → BasicMintingPolicy → Bank → TBTCVault → tBTC Tokens
```

### Core Features

- **🏦 Direct Bank Integration**: Seamless integration with proven Bank/Vault infrastructure
- **🔧 Modular Architecture**: Policy-driven contracts enable future upgrades without disruption
- **👁️ Simplified Watchdog**: Multi-attester consensus + permissionless enforcement
- **🛡️ Segregated Reserves**: Individual QC reserves prevent systemic gridlock
- **⚡ 5-State QC Model**: Advanced state management with self-pause and auto-escalation (Active, MintingPaused, Paused, UnderReview, Revoked)

### Business Benefits

- **📈 Liquidity Expansion**: Institutional custodian participation increases tBTC supply
- **🏛️ Institutional Integration**: Compliant pathway for regulated entities in DeFi
- **💰 Capital Efficiency**: Maximizes QC minting capacity relative to reserves
- **🔒 Risk Management**: Segregated reserves contain QC failures

---

## Architecture Overview

### System Components

#### Core Account Control
| Component                       | Purpose                      | Key Features                                      |
| ------------------------------- | ---------------------------- | ------------------------------------------------- |
| **BasicMintingPolicy**          | Direct Bank integration      | Auto-minting, capacity validation, 5-state checks |
| **BasicRedemptionPolicy**       | Redemption logic             | Network continuity (60% states allow fulfillment) |
| **ProtocolRegistry**            | Central service registry     | Component upgrades, dependency management         |
| **QCManager**                   | Business logic               | Stateless QC management, capacity calculations    |
| **QCData**                      | Storage layer                | 5-state enum, gas-optimized, audit-friendly      |
| **QCStateManager**              | State transition logic       | 5-state management, auto-escalation, graduated consequences |
| **QCRenewablePause**            | Pause credit system          | 90-day renewable credits, self-pause capabilities |
| **QCMinter**                    | Stable entry point           | Policy delegation, emergency pause                |
| **QCRedeemer**                  | Redemption engine            | Lifecycle management, default handling            |

#### Simplified Watchdog System (v2.0)
| Component                       | Purpose                      | Key Features                                      |
| ------------------------------- | ---------------------------- | ------------------------------------------------- |
| **WatchdogReasonCodes**         | Machine-readable violations  | Standardized codes for automated validation       |
| **QCReserveLedger**             | Multi-attester consensus     | Median calculation, eliminates single trust point |
| **WatchdogEnforcer**            | Permissionless enforcement   | Objective violations + 48h auto-escalation checks |

### Integration with Existing tBTC v2

The system deploys as an **independent contract suite** without modifying existing contracts:

- **Bank Authorization**: BasicMintingPolicy authorized via `authorizedBalanceIncreasers`
- **Shared Infrastructure**: Uses same Bank/Vault/Token contracts as regular Bridge
- **Perfect Fungibility**: QC-minted tBTC indistinguishable from Bridge-minted tBTC
- **Coexistence**: Regular Bridge operations continue unchanged

---

## Getting Started

### For Developers

1. **Start with**: [REQUIREMENTS.md](REQUIREMENTS.md) - Understand what we're building
2. **Technical spec**: [../V1.1_ACCOUNT_CONTROL_SPECIFICATION.md](../V1.1_ACCOUNT_CONTROL_SPECIFICATION.md) - Complete technical reference
3. **Architecture**: [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) - System architecture details
4. **Implementation**: [../docs/IMPLEMENTATION.md](../docs/IMPLEMENTATION.md) - Deploy and configure
5. **User flows**: [FLOWS.md](FLOWS.md) - Understand user journeys

### For Product Managers

1. **Business case**: [REQUIREMENTS.md](REQUIREMENTS.md) - Section 2 (Business Requirements)
2. **User experience**: [FLOWS.md](FLOWS.md) - Complete user journey documentation
3. **Future roadmap**: [../docs/future-enhancements/FUTURE_ENHANCEMENTS.md](../docs/future-enhancements/FUTURE_ENHANCEMENTS.md) - V2 evolution path

### For Security Reviewers

1. **Security requirements**: [REQUIREMENTS.md](REQUIREMENTS.md) - Section 5 (Security Requirements)
2. **Architecture security**: [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) - Complete security model
3. **Implementation security**: [../docs/IMPLEMENTATION.md](../docs/IMPLEMENTATION.md) - Security patterns and access control

### For QCs (Qualified Custodians)

1. **Onboarding process**: [FLOWS.md](FLOWS.md) - Section 4.2 (QC Registration Flow)
2. **Minting operations**: [FLOWS.md](FLOWS.md) - Section 4.1 (QC Minting Flow)
3. **Wallet management**: [FLOWS.md](FLOWS.md) - Section 4.2 (Wallet Registration)

---

## Current Status

### ✅ Completed

- **Requirements Analysis**: Complete requirements specification
- **Architecture Design**: Direct Bank integration architecture
- **Smart Contract Implementation**: BasicMintingPolicy and supporting contracts
- **Testing Framework**: Comprehensive unit and integration tests
- **Documentation**: Complete technical and user documentation

### 🔄 In Progress

- **Security Audit**: Professional security review
- **Testnet Deployment**: Goerli testnet validation
- **Integration Testing**: End-to-end system validation

### 📋 Next Steps

1. **Security Audit**: Complete independent security review
2. **Testnet Validation**: Deploy and test on Goerli
3. **QC Onboarding**: Partner with initial qualified custodians
4. **Mainnet Deployment**: Production deployment with governance approval

---

## Key Design Decisions

### Why Direct Bank Integration?

- **Simplicity**: Eliminates unnecessary abstraction layers
- **Proven Infrastructure**: Leverages battle-tested Bank/Vault architecture
- **Gas Efficiency**: Direct integration reduces transaction costs
- **Reduced Risk**: Fewer contracts in the critical path

### Watchdog System Design

The watchdog system focuses on objective, measurable violations through three key solutions:

1. **Oracle Problem** (Objective Facts)

   - Solution: Multi-attester consensus via `QCReserveLedger`
   - Multiple attesters submit reserve balances, median calculation prevents manipulation

2. **Enforcement Problem** (Objective Violations)

   - Solution: Permissionless enforcement via `WatchdogEnforcer`
   - Anyone can trigger enforcement for verifiable violations

3. **Decision Problem** (Governance Actions)
   - Solution: Direct DAO action for any non-automated decisions
   - DAO monitors enforcement events and can override if needed

#### System Benefits

- **Minimal Contracts**: 3-contract architecture for clarity and efficiency
- **Machine-Readable**: Reason codes enable automated validation
- **Trust Distribution**: No single points of failure
- **Permissionless Enforcement**: Anyone can trigger objective violations
- **Gas Optimization**: Minimal state, fewer cross-contract calls

### Why Policy-Driven Architecture?

- **Upgradeability**: Business logic can evolve without core contract changes
- **Future-Proofing**: Clear upgrade path to future crypto-economic enhancements
- **Interface Stability**: Core contracts maintain stable interfaces
- **Risk Management**: Isolated upgrade risks to policy contracts only

### Why 5-State QC Model?

The 5-state model provides sophisticated QC management that balances operational flexibility with network security:

#### Network Continuity Focus
- **60% State Availability**: 3 of 5 states (Active, MintingPaused, UnderReview) allow redemption fulfillment
- **Graduated Response**: Issues handled proportionally to severity
- **Self-Recovery**: QCs can resume from self-initiated pauses without council intervention

#### Operational Excellence
- **Self-Management**: QCs can pause for maintenance using renewable credits (1 per 90 days)
- **Automated Safety**: 48-hour auto-escalation prevents indefinite self-pauses
- **Progressive Consequences**: Graduated penalties for redemption defaults avoid harsh binary outcomes

#### QC Benefits
- **Operational Autonomy**: QCs control their pause/resume cycle for routine maintenance
- **Clear Expectations**: Predictable consequences and recovery paths
- **Network Continuity**: Can fulfill redemptions even during minting pauses

#### Protocol Benefits
- **Resilient Network**: Majority of operational states preserve core user functionality
- **Reduced Manual Intervention**: Automated escalation and graduated consequences
- **Risk Distribution**: Progressive enforcement prevents sudden systemic disruption

---

## Support and Contact

### Documentation Issues

- **GitHub Issues**: Report documentation problems or requests for clarification
- **Technical Questions**: Reach out to the development team

### Integration Support

- **QC Onboarding**: Contact business development for custodian partnership
- **Developer Integration**: Technical support for protocol integrators
- **Security Concerns**: Direct channel for security-related questions

---

## Version History

| Version | Date       | Changes                                    |
| ------- | ---------- | ------------------------------------------ |
| 1.0     | 2025-07-11 | Initial consolidated documentation release |
| 1.1     | 2025-08-04 | Dual-path watchdog + automated framework   |
| 2.0     | 2025-08-06 | Simplified watchdog system finalized       |

---

**This document serves as the entry point to Account Control documentation. For detailed technical information, please refer to the specific documents linked above.**
