# Account Control Background Research

**Document Version**: 1.0  
**Date**: 2025-07-11  
**Purpose**: Historical research findings that informed the Account Control architecture  
**Related Documents**: [README.md](README.md), [ARCHITECTURE.md](ARCHITECTURE.md), [REQUIREMENTS.md](REQUIREMENTS.md)

---

## Overview

This document captures the background research conducted during the Account Control design phase. The research informed the enhanced implementation plan with time-locked governance features and direct Bank integration approach.

## tBTC v2 Project Research

### Contract Architecture Patterns

The tBTC v2 system uses a sophisticated library pattern for modular functionality:

- **BridgeState.sol**: Defines central Storage struct with gas-optimized layout
- **Bridge.sol** uses multiple libraries via `using` statements:
  - `using Deposit for BridgeState.Storage`
  - `using DepositSweep for BridgeState.Storage`
  - `using Redemption for BridgeState.Storage`
  - `using Wallets for BridgeState.Storage`
  - `using Fraud for BridgeState.Storage`
  - `using MovingFunds for BridgeState.Storage`

This pattern enables:
- Modular functionality without contract size limits
- Gas-efficient storage layout
- Upgradeable components via proxy + library linking

### Security & Access Control Implementations

Current implementations primarily use:

1. **Ownable Pattern** (`@openzeppelin/contracts/access/Ownable.sol`):
   - **LightRelay.sol**: `contract LightRelay is Ownable, ILightRelay`
   - **BridgeGovernance.sol**: Inherits Ownable for governance functions

2. **Governable Pattern** (custom implementation):
   - **Bridge.sol**: `contract Bridge is Governable, EcdsaWalletOwner, Initializable`
   - Provides governance delay mechanisms for sensitive operations

3. **Role-Based Access** (limited usage):
   - Authorization mappings: `mapping(address => bool) public isAuthorized` in LightRelay

### Bitcoin SPV & LightRelay Integration

**SPV Proof Validation**:
- Key validation steps:
  1. Input/output vector validation
  2. Merkle proof verification against Bitcoin headers
  3. Coinbase proof validation
  4. Difficulty evaluation via `evaluateProofDifficulty()`

**LightRelay Architecture**:
- Uses `@keep-network/bitcoin-spv-sol` libraries: `BytesLib`, `BTCUtils`, `ValidateSPV`
- Implements Bitcoin difficulty retargeting
- Manages epoch transitions and proof validation
- Authorization system for retarget submitters

### Testing Patterns & Tooling

**Test Framework**:
- **Hardhat** with TypeScript configuration
- **Waffle** for contract testing
- **Chai** for assertions with `chai-as-promised`
- **Smock** (`@defi-wonderland/smock`) for advanced mocking

### Libraries & External Dependencies

**Core Libraries**:
1. **Bitcoin SPV**: `@keep-network/bitcoin-spv-sol: "3.4.0-solc-0.8"`
2. **Keep Network Stack**: ECDSA, Random Beacon, tBTC development versions
3. **OpenZeppelin**: Contracts 4.8.1 for security primitives
4. **Thesis Contracts**: `@thesis/solidity-contracts`

### Integration Points for Account Control

**Recommended Implementation Approach**:
1. **Access Control Extension**: Extend existing Ownable pattern with multi-role support
2. **Storage Integration**: Extend BridgeState.Storage with QC-specific parameters
3. **Library Pattern Adoption**: Create AccountControl library following existing patterns
4. **Testing Strategy**: Follow existing fixture pattern with Smock for mocking
5. **Deployment Integration**: Add new deployment scripts following numbered convention

## Key Research Insights

### Architecture Decision Drivers

1. **Modular Design**: The existing tBTC v2 library pattern proved successful and influenced the Account Control modular architecture
2. **Access Control Evolution**: Research showed need for more sophisticated role-based access control beyond simple Ownable patterns
3. **SPV Reuse**: Existing SPV infrastructure could be leveraged rather than reimplemented
4. **Testing Sophistication**: Advanced mocking capabilities with Smock enabled comprehensive testing strategies

### Integration Strategy

The research revealed that Account Control could be implemented as an independent system that leverages existing tBTC v2 infrastructure without modification, leading to the direct Bank integration approach adopted in the final architecture.

### Technical Constraints Identified

- Contract size limits requiring library patterns
- Gas optimization needs for storage layouts
- SPV proof validation complexity requiring existing infrastructure reuse
- Testing framework requirements for comprehensive coverage

---

**Document Control**

- **Created**: 2025-07-11 (extracted from ARCHITECTURE.md)
- **Purpose**: Preserve historical research for future reference
- **Audience**: Developers, architects, researchers
- **Maintenance**: Update when new research influences architecture decisions