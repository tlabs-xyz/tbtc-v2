# Documentation Map - tBTC v2 Account Control

**Last Updated**: 2025-08-06  
**System Version**: 2.0 (Simplified Watchdog)  
**Purpose**: Complete navigation guide for all documentation

---

## 🗺️ Quick Navigation

### For Different Users

**👔 Business Stakeholders** → Start with [`prd/README.md`](prd/README.md)  
**👨‍💻 Developers** → Start with [`docs/CURRENT_SYSTEM_STATE.md`](docs/CURRENT_SYSTEM_STATE.md)  
**🔍 Auditors** → Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)  
**🚀 Deployers** → Start with [`deploy/README.md`](deploy/README.md)

---

## 📁 Directory Structure

### Root Directory
*Purpose: High-level system documentation*

(No documentation files in root directory)

### `/solidity` - Development Notes
*Purpose: Developer reference and project notes*

| File | Description | Status |
|------|-------------|--------|
| [`CLAUDE.md`](CLAUDE.md) | Development notes and test guidance | Active |
| [`DOCUMENTATION_MAP.md`](DOCUMENTATION_MAP.md) | This navigation guide | Active |

### `/prd` - Product Requirements & Business Documentation
*Purpose: Business-focused documentation for stakeholders*

| File | Description | Primary Audience |
|------|-------------|------------------|
| [`README.md`](prd/README.md) | Product overview and entry point | All stakeholders |
| [`REQUIREMENTS.md`](prd/REQUIREMENTS.md) | Complete requirements specification | Product, architects |
| [`FLOWS.md`](prd/FLOWS.md) | User journeys and flow diagrams | Product, QA, developers |

### `/docs` - Technical Documentation
*Purpose: Implementation details, architecture, and technical guides*

#### Core System Documentation
| File | Description | Status |
|------|-------------|--------|
| [`README.md`](docs/README.md) | Technical documentation quick start | Active |
| [`CURRENT_SYSTEM_STATE.md`](docs/CURRENT_SYSTEM_STATE.md) | **📍 Single source of truth for current state** | Active |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Technical architecture details | Active |
| [`IMPLEMENTATION.md`](docs/IMPLEMENTATION.md) | Code patterns and examples | Active |

#### Security & Authority Documentation
| File | Description | Status |
|------|-------------|--------|
| [`SECURITY_ARCHITECTURE.md`](docs/SECURITY_ARCHITECTURE.md) | Comprehensive security architecture, roles, and enforcement | Active |
| [`PAUSE_ARCHITECTURE.md`](docs/PAUSE_ARCHITECTURE.md) | Two-tier pause system and emergency response | Active |
| [`ACCOUNT_CONTROL_AUDIT_TRAIL.md`](docs/ACCOUNT_CONTROL_AUDIT_TRAIL.md) | Event tracking and monitoring | Active |

#### Watchdog System Documentation
| File | Description | Status |
|------|-------------|--------|
| [`WATCHDOG_FINAL_ARCHITECTURE.md`](docs/WATCHDOG_FINAL_ARCHITECTURE.md) | Current watchdog design | Active |

#### Analysis & Reports
| File | Description | Status |
|------|-------------|--------|
| [`GAS_ANALYSIS_REPORT.md`](docs/GAS_ANALYSIS_REPORT.md) | Gas optimization analysis | Reference |
| [`SLITHER_ANALYSIS_REPORT.md`](docs/SLITHER_ANALYSIS_REPORT.md) | Security analysis results | Reference |
| [`CODE_REVIEW_CHECKLIST.md`](docs/CODE_REVIEW_CHECKLIST.md) | Review guidelines | Reference |

#### Future Planning
| File | Description | Status |
|------|-------------|--------|
| [`future-enhancements/FUTURE_ENHANCEMENTS.md`](docs/future-enhancements/FUTURE_ENHANCEMENTS.md) | Roadmap and future features | Planning |

### `/contracts` - Smart Contract Source Code
*Purpose: Solidity implementation*

#### Account Control Core
- `account-control/QCManager.sol` - QC lifecycle management
- `account-control/QCData.sol` - Storage layer
- `account-control/QCMinter.sol` - Minting entry point
- `account-control/QCRedeemer.sol` - Redemption handling
- `account-control/QCReserveLedger.sol` - Reserve tracking

#### Watchdog System (v2.0)
- `account-control/WatchdogReasonCodes.sol` - Machine-readable codes
- `account-control/ReserveOracle.sol` - Multi-attester consensus
- `account-control/WatchdogEnforcer.sol` - Permissionless enforcement
- `account-control/WatchdogReporting.sol` - Event reporting

#### Policies
- `account-control/policies/BasicMintingPolicy.sol` - Direct Bank integration
- `account-control/policies/BasicRedemptionPolicy.sol` - Redemption logic

### `/deploy` - Deployment Scripts
*Purpose: Hardhat deployment configuration*

| Script | Description |
|--------|-------------|
| `97_deploy_account_control_core.ts` | Core system deployment |
| `98_deploy_simplified_watchdog.ts` | Watchdog system deployment |
| `99_configure_account_control_system.ts` | System configuration |

### `/test` - Test Suites
*Purpose: Comprehensive test coverage*

- `account-control/` - Unit tests for each contract
- `integration/` - End-to-end integration tests
- `fixtures/` - Test data and utilities

### `/docs/archive` - Historical Documentation
*Purpose: Preserved for historical context*

#### Subdirectories
- `v1/` - Watchdog system documentation
- `watchdog-migration/` - Migration process documentation
- `audit-phases/` - Phase 1-4 audit summaries

---

## 📊 Documentation by Topic

### Understanding the System
1. Start: [`prd/README.md`](prd/README.md) - Product overview
2. Then: [`docs/CURRENT_SYSTEM_STATE.md`](docs/CURRENT_SYSTEM_STATE.md) - Current implementation
3. Deep dive: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - Technical details and ADRs
4. Security: [`docs/SECURITY_ARCHITECTURE.md`](docs/SECURITY_ARCHITECTURE.md) - Roles, authority, and enforcement

### Watchdog System
1. Architecture: [`docs/WATCHDOG_FINAL_ARCHITECTURE.md`](docs/WATCHDOG_FINAL_ARCHITECTURE.md)
2. Full technical design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (includes ADRs and oracle design)

### Security & Emergency Response
1. Complete security architecture: [`docs/SECURITY_ARCHITECTURE.md`](docs/SECURITY_ARCHITECTURE.md)
2. Pause system & emergency response: [`docs/PAUSE_ARCHITECTURE.md`](docs/PAUSE_ARCHITECTURE.md)
3. Audit trail: [`docs/ACCOUNT_CONTROL_AUDIT_TRAIL.md`](docs/ACCOUNT_CONTROL_AUDIT_TRAIL.md)

### Implementation & Deployment
1. Code patterns: [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)
2. Deployment: [`deploy/README.md`](deploy/README.md)
3. Configuration: [`deploy/99_configure_account_control_system.ts`](deploy/99_configure_account_control_system.ts)

### Requirements & Flows
1. Requirements: [`prd/REQUIREMENTS.md`](prd/REQUIREMENTS.md)
2. User flows: [`prd/FLOWS.md`](prd/FLOWS.md)
3. Roles & security: [`docs/SECURITY_ARCHITECTURE.md`](docs/SECURITY_ARCHITECTURE.md)
4. Event tracking: [`docs/ACCOUNT_CONTROL_AUDIT_TRAIL.md`](docs/ACCOUNT_CONTROL_AUDIT_TRAIL.md)

---

## 🔄 Document Maintenance

### Version Control
- Current system version: **2.0** (Simplified Watchdog)
- All active documents should reference this version
- Historical versions preserved in `/archive`

### Update Frequency
- **CURRENT_SYSTEM_STATE.md**: Update with any system changes
- **ARCHITECTURE.md**: Update with design changes
- **REQUIREMENTS.md**: Update with requirement changes
- **Archive**: Move outdated docs here, don't delete

### Document Ownership
- **Product Documentation** (`/prd`): Product team
- **Technical Documentation** (`/docs`): Engineering team
- **Deployment** (`/deploy`): DevOps team
- **Tests** (`/test`): QA team

---

## ❓ Common Questions

### Where do I find...?

**Current system design?** → [`docs/CURRENT_SYSTEM_STATE.md`](docs/CURRENT_SYSTEM_STATE.md)  
**Contract interfaces?** → [`contracts/interfaces/`](contracts/interfaces/)  
**Deployment order?** → [`deploy/README.md`](deploy/README.md)  
**User flows?** → [`prd/FLOWS.md`](prd/FLOWS.md)  
**Security analysis?** → [`docs/SLITHER_ANALYSIS_REPORT.md`](docs/SLITHER_ANALYSIS_REPORT.md)  
**Security & roles?** → [`docs/SECURITY_ARCHITECTURE.md`](docs/SECURITY_ARCHITECTURE.md)  
**Emergency response?** → [`docs/PAUSE_ARCHITECTURE.md`](docs/PAUSE_ARCHITECTURE.md)  
**Event monitoring?** → [`docs/ACCOUNT_CONTROL_AUDIT_TRAIL.md`](docs/ACCOUNT_CONTROL_AUDIT_TRAIL.md)  
**Historical context?** → [`docs/archive/`](docs/archive/)  

### What's the difference between...?

**`/prd` vs `/docs`?**
- PRD = Business/product focus
- Docs = Technical/implementation focus

**CURRENT_SYSTEM_STATE vs ARCHITECTURE?**
- CURRENT_SYSTEM_STATE = What is deployed now
- ARCHITECTURE = How it's designed and why

**Active vs Archive?**
- Active = Current system documentation
- Archive = Historical/outdated documentation

---

## 📈 Documentation Phases

### ✅ Phase 1: Minimal Harmonization (Complete)
- Consolidated current state documentation
- Archived redundant files
- Fixed version consistency
- Created this documentation map

### 🔄 Phase 2: Business-Technical Separation (Planned)
- Transform PRD into pure business documentation
- Consolidate technical docs for developers
- Create clear cross-references

### 🔮 Phase 3: Graduated Consolidation (Future)
- Create tiered documentation system
- Progressive disclosure for different audiences
- Advanced navigation features

---

*For questions about documentation structure, contact the engineering team.*