# Watchdog Report Lifecycle

**Document Version**: 1.0  
**Date**: 2025-08-05  
**Purpose**: Document the complete lifecycle of subjective reports from creation to resolution  
**Status**: Design Documentation

---

## Report Lifecycle Overview

```
1. Creation → 2. Support → 3. Escalation → 4. DAO Review → 5. Resolution → 6. Clearance
```

---

## Phase 1: Report Creation

### Who Can Create
- Any address with `WATCHDOG_ROLE`
- Must provide: target, observation type, description, evidence

### Initial State
```solidity
Report {
    id: 1,
    watchdog: 0xReporter...,
    target: 0xQC...,
    obsType: SUSPICIOUS_PATTERN,
    description: "80% redemptions through new addresses",
    evidence: 0x123...,  // Will be array of hashes
    timestamp: 1234567890,
    supportCount: 0,
    escalated: false,
    resolution: UNRESOLVED,
    resolutionNotes: "",
    resolvedAt: 0
}
```

### Event
```solidity
event ObservationReported(reportId: 1, target: 0xQC..., obsType: SUSPICIOUS_PATTERN, watchdog: 0xReporter...)
```

---

## Phase 2: Support Gathering

### Who Can Support
- Any `WATCHDOG_ROLE` except original reporter
- Can also append evidence if supporter

### Support Mechanics
```solidity
function supportReport(uint256 reportId) external onlyRole(WATCHDOG_ROLE)
```

### Auto-Escalation Thresholds
- `SECURITY_OBSERVATION`: 0 (immediate)
- `COMPLIANCE_QUESTION`: 1 supporter
- Others: 3 supporters (default)

---

## Phase 3: Escalation

### Automatic Escalation
When support threshold reached:
```solidity
report.escalated = true;
emit ReportEscalated(reportId, target, supportCount, reason);
```

### Manual Escalation
Authorized watchdogs can force escalation:
```solidity
function escalateReport(uint256 reportId, string reason) external
```

---

## Phase 4: DAO Review

### Discovery
DAO members query escalated reports:
```solidity
function getReportsForDAOReview(minSupport, includeEscalated) returns (uint256[] reportIds)
```

### Evidence Review
1. DAO fetches report details from blockchain
2. DAO fetches evidence from watchdog REST API using hashes
3. DAO members discuss and vote on action

### Resolution Options
```solidity
enum ResolutionStatus {
    UNRESOLVED,         // Not yet reviewed
    UNDER_REVIEW,       // DAO actively reviewing
    ACTION_TAKEN,       // DAO took corrective action
    NO_ACTION_NEEDED,   // Reviewed but no action required
    FALSE_REPORT        // Report was invalid/malicious
}
```

---

## Phase 5: Resolution

### Individual Report Resolution
```solidity
function resolveReport(
    uint256 reportId,
    ResolutionStatus resolution,
    string calldata notes
) external onlyRole(DAO_ROLE)
```

**Example**:
```solidity
resolveReport(
    42,
    ResolutionStatus.ACTION_TAKEN,
    "QC placed under enhanced monitoring due to pattern. New redemption limits applied."
);
```

### Bulk Resolution (Clear QC's Name)
```solidity
function clearReportsForTarget(
    address target,
    ResolutionStatus resolution,
    string calldata notes
) external onlyRole(DAO_ROLE)
```

**Example - After thorough investigation**:
```solidity
clearReportsForTarget(
    0xQC...,
    ResolutionStatus.NO_ACTION_NEEDED,
    "DAO investigation found patterns were due to legitimate business model change. All reports cleared."
);
```

**Example - After taking action**:
```solidity
clearReportsForTarget(
    0xQC...,
    ResolutionStatus.ACTION_TAKEN,
    "QC has implemented required changes. Compliance verified. Historical reports resolved."
);
```

---

## Phase 6: Post-Resolution

### Query Functions
```solidity
// Check if QC has unresolved reports
hasUnresolvedReports(address target) returns (bool)

// Get only unresolved reports
getUnresolvedReportsForTarget(address target) returns (uint256[])
```

### Update Resolution
If DAO needs to revise decision:
```solidity
function updateResolution(
    uint256 reportId,
    ResolutionStatus newResolution,
    string calldata notes
) external onlyRole(DAO_ROLE)
```

---

## Resolution Scenarios

### Scenario 1: Legitimate Concern → Action
1. Watchdog reports suspicious redemption patterns
2. 3 other watchdogs support with additional evidence
3. Report auto-escalates to DAO
4. DAO reviews, finds merit, implements restrictions
5. Resolution: `ACTION_TAKEN`
6. QC fixes issues
7. DAO clears all reports: "Issues addressed"

### Scenario 2: False Alarm → Clear Name
1. Watchdog reports operational concerns
2. Gets support, escalates
3. DAO investigates thoroughly
4. Finds no actual issues (misunderstanding)
5. Resolution: `NO_ACTION_NEEDED`
6. Clears QC's name with explanation

### Scenario 3: Malicious Report → Penalty
1. Watchdog makes false report
2. No support (other watchdogs see it's false)
3. DAO reviews anyway (manual escalation)
4. Resolution: `FALSE_REPORT`
5. Watchdog potentially loses role

---

## State Transitions

```
UNRESOLVED → UNDER_REVIEW → ACTION_TAKEN
         ↓              ↓
         ↓              → NO_ACTION_NEEDED
         ↓
         → FALSE_REPORT
```

**Note**: Can update from any resolved state to another (except back to UNRESOLVED)

---

## Benefits of Resolution System

### For QCs
- **Clear name**: After investigation, reports can be cleared
- **Transparency**: Public record of resolution
- **Finality**: Resolved reports don't affect reputation

### For Watchdogs
- **Accountability**: False reports are marked
- **Feedback**: Learn what DAO considers actionable
- **Completion**: Clear lifecycle end

### For DAO
- **Efficiency**: Bulk resolution for related reports
- **Flexibility**: Multiple resolution types
- **Audit Trail**: Complete history preserved

### For Users
- **Confidence**: Can see if concerns were addressed
- **Transparency**: Understand DAO decisions
- **Trust**: System handles both real and false concerns

---

## Implementation Notes

1. **Resolution Authority**: Only DAO_ROLE can resolve
2. **Immutable History**: Reports never deleted, only resolved
3. **Bulk Operations**: Efficient for clearing multiple reports
4. **State Consistency**: Can't unresolve reports
5. **Evidence Preservation**: Evidence remains accessible post-resolution

---

## Future Enhancements

1. **Auto-Archive**: Move old resolved reports to archive storage
2. **Resolution Templates**: Common resolution texts
3. **Time Limits**: Auto-close old unescalated reports
4. **Appeal Process**: Allow QCs to request re-review
5. **Metrics**: Track resolution times and patterns