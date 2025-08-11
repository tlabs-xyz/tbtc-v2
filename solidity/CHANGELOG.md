# Changelog

All notable changes to the tBTC V1.1 Account Control system documentation will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Consolidated V1.1_ACCOUNT_CONTROL_SPECIFICATION.md - Single authoritative technical reference combining system overview and watchdog specifications
- Organized future enhancement documents in docs/future-enhancements/ directory
- Updated PRD README.md with correct file references and navigation

### Changed
- Reorganized documentation structure for better clarity and navigation
- Updated documentation references to point to consolidated specification
- Improved developer onboarding flow in PRD README

### Removed
- Historical design journey documents (WATCHDOG_DESIGN_JOURNEY.md, WATCHDOG_V11_DESIGN_JOURNEY.md, etc.)
- Redundant analysis documents that duplicated information in final specification
- Overlapping system overview and watchdog specification files
- Backup files and temporary documents not meant for version control

### Fixed
- Broken documentation links in PRD README.md
- Inconsistent file references across documentation index

## Summary of Changes

This release represents a major documentation consolidation effort that:

- **Reduced file count** from 28 to 15 essential documentation files (~50% reduction)
- **Created single source of truth** for V1.1 system technical specifications  
- **Eliminated redundancy** while preserving all essential technical information
- **Improved navigation** with clear documentation hierarchy and corrected references
- **Organized future work** by separating current system docs from enhancement proposals

### Documentation Structure After Changes

```
solidity/
├── V1.1_ACCOUNT_CONTROL_SPECIFICATION.md (NEW - Consolidated technical spec)
├── docs/
│   ├── ARCHITECTURE.md (System architecture)
│   ├── IMPLEMENTATION.md (Implementation guide)  
│   ├── ACCOUNT_CONTROL_AUDIT_TRAIL.md (Audit documentation)
│   └── future-enhancements/ (NEW - Future roadmap)
│       ├── FUTURE_ENHANCEMENTS.md
│       ├── WATCHDOG_AUTOMATED_DECISION_FRAMEWORK.md
│       ├── WATCHDOG_CONSENSUS_EVIDENCE_SYSTEM.md
│       └── WATCHDOG_CONSENSUS_PRACTICAL_SOLUTION.md
└── prd/
    ├── README.md (Updated documentation index)
    ├── REQUIREMENTS.md (Business requirements)
    └── FLOWS.md (User journeys)
```

The result is a cleaner, more navigable documentation structure that focuses on what the V1.1 system IS rather than how it evolved, making it easier for new developers, auditors, and stakeholders to understand and work with the Account Control system.