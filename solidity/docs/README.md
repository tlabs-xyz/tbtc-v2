# Technical Documentation - tBTC v2 Account Control

**System Version**: 2.0 (Simplified Watchdog)  
**Last Updated**: 2025-08-06

## 📍 Quick Start

**Current System State**: [`CURRENT_SYSTEM_STATE.md`](CURRENT_SYSTEM_STATE.md) - Start here!  
**Architecture**: [`ARCHITECTURE.md`](ARCHITECTURE.md)  
**Implementation Guide**: [`IMPLEMENTATION.md`](IMPLEMENTATION.md)  
**Full Navigation**: [`../DOCUMENTATION_MAP.md`](../DOCUMENTATION_MAP.md)

## 📁 Directory Contents

### Core Documentation
- **CURRENT_SYSTEM_STATE.md** - Single source of truth for system state
- **ARCHITECTURE.md** - Technical architecture and design
- **IMPLEMENTATION.md** - Code patterns and implementation guide
- **ARCHITECTURE_DECISIONS.md** - Key design decisions (ADRs)

### Watchdog System
- **WATCHDOG_FINAL_ARCHITECTURE.md** - Current watchdog architecture
- **ORACLE_DESIGN_DECISION.md** - Oracle consensus design rationale
- **EVIDENCE_STORAGE_FINAL_DESIGN.md** - Evidence handling approach

### Analysis & Reports
- **ROLE_MATRIX.md** - Complete role structure
- **GAS_ANALYSIS_REPORT.md** - Gas optimization analysis
- **DEPLOYMENT_SCRIPT_AUDIT.md** - Deployment review
- **SLITHER_ANALYSIS_REPORT.md** - Security analysis
- **CODE_REVIEW_CHECKLIST.md** - Review guidelines

### Archived Documentation
- **archive/** - Historical documentation preserved for reference
  - `v1.1-v1.2/` - Old dual-path watchdog system
  - `watchdog-migration/` - Migration process docs
  - `audit-phases/` - Phase 1-4 summaries

## 🔗 Related Documentation

- **Business/Product**: [`../prd/`](../prd/) - Requirements, flows, research
- **Smart Contracts**: [`../contracts/`](../contracts/) - Source code
- **Deployment**: [`../deploy/`](../deploy/) - Deployment scripts
- **Tests**: [`../test/`](../test/) - Test suites

## 🎯 For Developers

### Understanding the System
1. Read [`CURRENT_SYSTEM_STATE.md`](CURRENT_SYSTEM_STATE.md) for overview
2. Study [`ARCHITECTURE.md`](ARCHITECTURE.md) for technical design
3. Review [`IMPLEMENTATION.md`](IMPLEMENTATION.md) for code patterns

### Key Concepts
- **Three-Problem Framework**: Oracle, Observation, Decision problems
- **Direct Bank Integration**: No abstraction layers
- **Multi-Attester Consensus**: No single points of failure
- **Machine-Readable Codes**: Automated validation

### Recent Changes (v2.0)
- Simplified watchdog: 6 contracts → 4 contracts
- Multi-attester oracle consensus
- Permissionless enforcement
- Event-based reporting

## 📋 Document Status

All documents in this directory reflect the **current system state** (v2.0). Historical documentation has been archived for reference.

---

*For business/product documentation, see [`../prd/README.md`](../prd/README.md)*  
*For complete navigation, see [`../DOCUMENTATION_MAP.md`](../DOCUMENTATION_MAP.md)*