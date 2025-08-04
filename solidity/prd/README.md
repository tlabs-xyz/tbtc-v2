# Account Control Architecture for tBTC v2

**Document Version**: 1.1  
**Date**: 2025-08-04  
**Architecture**: V1.1 Dual-Path + V1.2 Automated Framework  
**Status**: Production Ready

---

## Quick Start

Welcome to the Account Control system documentation. This feature extends tBTC v2 to support Qualified Custodians (QCs) through direct Bank integration.

### 📋 Essential Documents

| Document                                   | Purpose                             | Audience                 |
| ------------------------------------------ | ----------------------------------- | ------------------------ |
| **[REQUIREMENTS.md](REQUIREMENTS.md)**     | Complete requirements specification | All stakeholders         |
| **[ARCHITECTURE.md](ARCHITECTURE.md)**     | Detailed technical architecture     | Architects, developers   |
| **[IMPLEMENTATION.md](IMPLEMENTATION.md)** | Code patterns and deployment        | Developers, DevOps       |
| **[FLOWS.md](FLOWS.md)**                   | User journeys and sequences         | Product, QA, integrators |

### 📚 Reference Documents

| Document                                                       | Purpose                      | Audience                |
| -------------------------------------------------------------- | ---------------------------- | ----------------------- |
| **[SPV_IMPLEMENTATION_GUIDE.md](SPV_IMPLEMENTATION_GUIDE.md)** | SPV integration details      | Blockchain developers   |
| **[FUTURE_ENHANCEMENTS.md](FUTURE_ENHANCEMENTS.md)**           | V2 roadmap and enhancements  | Product, architects     |
| **[RESEARCH.md](RESEARCH.md)**                                 | Background research findings | Researchers, architects |

---

## Executive Summary

### What is Account Control?

Account Control enables **Qualified Custodians** (regulated institutional entities) to mint tBTC tokens against their segregated Bitcoin reserves through **direct Bank integration**. This expands tBTC liquidity while maintaining the security and decentralization principles of the original protocol.

### Key Innovation: Direct Bank Integration

Unlike abstraction-layer approaches, Account Control integrates directly with the existing tBTC Bank/Vault architecture:

```
User → QCMinter → BasicMintingPolicy → Bank → TBTCVault → tBTC Tokens
```

### Core Features

- **🏦 Direct Bank Integration**: Seamless integration with proven Bank/Vault infrastructure
- **🔧 Modular Architecture**: Policy-driven contracts enable future upgrades without disruption
- **👁️ Dual-Path Watchdog**: Individual QCWatchdog instances + M-of-N consensus for critical operations
- **🛡️ Segregated Reserves**: Individual QC reserves prevent systemic gridlock
- **⚡ Simple State Machine**: Clean 3-state QC model (Active, UnderReview, Revoked)

### Business Benefits

- **📈 Liquidity Expansion**: Institutional custodian participation increases tBTC supply
- **🏛️ Institutional Integration**: Compliant pathway for regulated entities in DeFi
- **💰 Capital Efficiency**: Maximizes QC minting capacity relative to reserves
- **🔒 Risk Management**: Segregated reserves contain QC failures

---

## Architecture Overview

### System Components

| Component                       | Purpose                      | Key Features                                      |
| ------------------------------- | ---------------------------- | ------------------------------------------------- |
| **BasicMintingPolicy**          | Direct Bank integration      | Auto-minting, capacity validation, error handling |
| **ProtocolRegistry**            | Central service registry     | Component upgrades, dependency management         |
| **QCManager**                   | Business logic               | Stateless QC management, capacity calculations    |
| **QCData**                      | Storage layer                | Pure storage, gas-optimized, audit-friendly       |
| **QCMinter**                    | Stable entry point           | Policy delegation, emergency pause                |
| **QCRedeemer**                  | Redemption engine            | Lifecycle management, default handling            |
| **QCWatchdog**                  | Individual watchdog proxy    | Routine operations, SPV verification              |
| **WatchdogConsensusManager**    | M-of-N consensus             | Critical operations voting, Byzantine fault tolerance |
| **WatchdogAutomatedEnforcement** | V1.2 automated rules        | Deterministic enforcement, 90%+ automation       |

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
2. **Then read**: [ARCHITECTURE.md](ARCHITECTURE.md) - Learn the technical design
3. **Implementation**: [IMPLEMENTATION.md](IMPLEMENTATION.md) - Deploy and configure
4. **User flows**: [FLOWS.md](FLOWS.md) - Understand user journeys

### For Product Managers

1. **Business case**: [REQUIREMENTS.md](REQUIREMENTS.md) - Section 2 (Business Requirements)
2. **User experience**: [FLOWS.md](FLOWS.md) - Complete user journey documentation
3. **Future roadmap**: [FUTURE_ENHANCEMENTS.md](FUTURE_ENHANCEMENTS.md) - V2 evolution path

### For Security Reviewers

1. **Security requirements**: [REQUIREMENTS.md](REQUIREMENTS.md) - Section 5 (Security Requirements)
2. **Architecture security**: [ARCHITECTURE.md](ARCHITECTURE.md) - Section 6 (Security Considerations)
3. **Implementation security**: [IMPLEMENTATION.md](IMPLEMENTATION.md) - Security patterns and access control

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

### Why Single Watchdog?

- **Operational Simplicity**: Clear responsibility and accountability
- **Faster Response**: No consensus delays for critical operations
- **DAO Oversight**: Watchdog appointed and monitored by DAO
- **Future Evolution**: Clear path to M-of-N decentralization in V2

### Why Policy-Driven Architecture?

- **Upgradeability**: Business logic can evolve without core contract changes
- **Future-Proofing**: Clear path from attestation-based V1 to crypto-economic V2
- **Interface Stability**: Core contracts maintain stable interfaces
- **Risk Management**: Isolated upgrade risks to policy contracts only

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

---

**This document serves as the entry point to Account Control documentation. For detailed technical information, please refer to the specific documents linked above.**
