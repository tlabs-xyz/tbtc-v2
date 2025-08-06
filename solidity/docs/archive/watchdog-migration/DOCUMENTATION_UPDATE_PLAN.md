# Documentation Update Plan

**Document Version**: 1.0  
**Date**: 2025-08-06  
**Purpose**: Track required documentation updates to reflect current design  
**Status**: Action Plan

---

## Documentation Requiring Updates

### 1. WATCHDOG_DESIGN_REVIEW.md

**Current Issues**:
- Still mentions severity levels (lines 99-122) - REMOVED
- Discusses rate limiting options (lines 137-194) - DECIDED AGAINST
- References DAOBridge integration (line 62) - DELETED
- Shows proposedAction in examples - REMOVED

**Required Updates**:
- Remove severity levels section
- Add note: "Rate limiting not needed due to gas costs and role-gating"
- Remove all DAOBridge references
- Update to show direct DAO action model

### 2. WATCHDOG_REPORT_LIFECYCLE.md

**Current Issues**:
- Shows ResolutionStatus enum (lines 99-106) - REMOVED
- Shows resolution fields in Report struct (lines 36-38) - REMOVED
- References clearReportsForTarget function (lines 133-146) - DOESN'T EXIST
- Shows escalated field (line 35) - REMOVED

**Required Updates**:
- Remove resolution tracking (DAO acts directly)
- Simplify Report struct to match implementation
- Remove clearance phase (no resolution tracking)
- Update to show simple event emission model

### 3. WATCHDOG_IMPLEMENTATION_ISSUES.md

**Current Issues**:
- Lists evidence storage vulnerability as open - FIXED
- Shows proposedAction debate as pending - DECIDED (removed)
- Missing oracle implementation - IMPLEMENTED

**Required Updates**:
- Mark evidence storage as RESOLVED (using hash array)
- Mark proposedAction as RESOLVED (removed field)
- Mark oracle implementation as COMPLETE
- Add new section for integration challenges

### 4. WATCHDOG_INTEGRATION_GAPS.md

**Current Issues**:
- Shows DAOBridge as solution for Gap 4 - INCORRECT
- Doesn't reflect simplified SubjectiveReporting

**Required Updates**:
- Remove DAOBridge as integration solution
- Note that DAO acts directly on reports
- Update to show actual integration approach

### 5. WATCHDOG_OPERATIONS_ANALYSIS.md

**Current Issues**:
- Shows theoretical optimal design that differs from implementation
- Doesn't reflect our simplified approach

**Required Updates**:
- Add section showing ACTUAL implementation
- Note differences between optimal theory and practical implementation

---

## Documentation to Create

### 1. WATCHDOG_REST_API_SPEC.md
- Full specification of evidence REST API
- Authentication flow
- Example requests/responses
- Implementation requirements

### 2. INTEGRATION_STRATEGY.md
- How new contracts work with existing ones
- Which contracts to keep/deprecate
- Migration path if needed

### 3. ROLE_HIERARCHY.md
- Clear definition of all roles
- Which contracts use which roles
- How roles relate to each other

---

## Documentation That's Accurate (No Changes Needed)

✅ **EVIDENCE_STORAGE_FINAL_DESIGN.md** - Correctly describes hash + REST API  
✅ **WATCHDOG_DESIGN_INSIGHTS.md** - Historical record of our journey  
✅ **ORACLE_DESIGN_DECISION.md** - Accurate oracle + ledger design  
✅ **EVIDENCE_DEFINITION.md** - Correct evidence types  
✅ **CURRENT_DESIGN_STATE.md** - Just created, fully accurate

---

## Priority Order for Updates

### High Priority (Blocking)
1. WATCHDOG_DESIGN_REVIEW.md - Remove outdated decisions
2. WATCHDOG_REPORT_LIFECYCLE.md - Match actual implementation

### Medium Priority (Confusing)
3. WATCHDOG_IMPLEMENTATION_ISSUES.md - Mark resolved issues
4. WATCHDOG_INTEGRATION_GAPS.md - Update integration approach

### Low Priority (Nice to Have)
5. WATCHDOG_OPERATIONS_ANALYSIS.md - Add actual vs theoretical

---

## Key Messages to Reinforce

In all updates, emphasize:

1. **Simplification achieved**: 4 contracts instead of 17+
2. **Clear separation**: Oracle vs Observation vs Decision
3. **Direct DAO action**: No intermediary contracts
4. **Minimal storage**: Hashes only, evidence off-chain
5. **No over-engineering**: No severity, no rate limiting, no proposedAction

---

## Update Process

1. Create backup of original docs (if needed)
2. Update each document with track changes
3. Review updates for consistency
4. Ensure all docs tell same story
5. Add update notes at top of each doc

---

## Success Criteria

Documentation is complete when:
- [ ] All contracts are accurately described
- [ ] Design decisions are clearly documented
- [ ] Integration approach is defined
- [ ] No contradictions between documents
- [ ] Implementation matches documentation