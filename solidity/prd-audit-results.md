# PRD Documentation Audit Results

**Date**: 2025-07-15  
**Purpose**: Document findings from PRD audit for watchdog quorum integration  
**Status**: Phase 1.1 Complete

## Executive Summary

The PRD documents consistently reference a **single trusted Watchdog** model throughout. While the separate `watchdog-decentralization.md` document describes the N-of-M quorum design, the main PRD files (REQUIREMENTS.md, ARCHITECTURE.md, IMPLEMENTATION.md) have NOT been updated to reflect the quorum model.

## Findings by Document

### REQUIREMENTS.md Analysis

#### Current State
- **167 references** to "Single Watchdog Attestation" (REQ-FUNC-RES-001)
- **Multiple explicit statements** about "single trusted entity"
- **Role consolidation** documented: ATTESTER_ROLE, REGISTRAR_ROLE, ARBITER_ROLE in one entity
- **Line 715**: "Watchdog decentralization (planned for V2)" - indicates it's a future enhancement

#### Required Updates
1. **Section 3.4.1** needs complete rewrite:
   - Change "Single Watchdog Attestation" to "Optimistic Watchdog Consensus"
   - Update requirement ID from REQ-FUNC-RES-001
   - Add escalating consensus requirements

2. **Section 5.4.1** needs update:
   - Remove "Single Trusted Entity" language
   - Add N-of-M consensus security model
   - Document Byzantine fault tolerance requirements

3. **New requirements needed**:
   - Challenge period specifications (1h, 4h, 12h)
   - Consensus thresholds (3-of-5, 5-of-9)
   - Backward compatibility requirements

### ARCHITECTURE.md Analysis

#### Current State
- **Line 182**: "The protocol relies on a single, DAO-appointed Watchdog"
- **Line 521**: "Centralized Watchdog: Single point of failure for liveness and correctness"
- **Line 539**: Critical dependency on single Watchdog documented as risk
- **Line 726**: "M-of-N Watchdog Quorum" listed as V2 priority

#### Required Updates
1. **Section 3** needs major revision:
   - Replace "Off-chain Components: Watchdog Service" with "Watchdog Consensus System"
   - Add optimistic consensus architecture
   - Include challenge and escalation mechanisms

2. **Architecture diagrams** need updates:
   - Show N watchdogs instead of single entity
   - Add challenge/response flows
   - Include consensus decision points

3. **Risk section** needs revision:
   - Remove single point of failure risk
   - Add new risks: consensus delays, coordination complexity

### IMPLEMENTATION.md Analysis

#### Current State
- Minimal watchdog references
- Example code shows direct watchdog calls
- No mention of consensus or quorum

#### Required Updates
1. Add new interfaces:
   - `IOptimisticWatchdogConsensus`
   - `IWatchdogOperation`
   - Challenge/escalation methods

2. Update example code to show:
   - Optimistic submission
   - Challenge handling
   - Consensus execution

## Cross-Document Inconsistencies

### Major Inconsistency
**watchdog-decentralization.md** describes a complete N-of-M quorum system, but this is NOT reflected in the main PRD documents. This creates confusion about the actual system design.

### Resolution Approach
1. **Option A**: Update all PRD docs to reflect quorum design (Recommended)
2. **Option B**: Keep PRDs as V1 single watchdog, clearly mark quorum as V2

## Backward Compatibility Concerns

### Currently Documented
- PRDs mention backward compatibility generally
- No specific mention of watchdog upgrade path

### Needs Documentation
1. How `WatchdogAdapter` maintains existing interfaces
2. Migration strategy from single to quorum
3. Emergency fallback procedures

## Missing Technical Specifications

### In Current PRDs
1. No interface definitions for quorum system
2. No gas cost analysis for consensus operations
3. No event specifications for challenges/escalations
4. No data structures for operations/consensus

### Needed Additions
```solidity
interface IOptimisticWatchdogConsensus {
    function submitOptimisticOperation(bytes32 operationType, bytes calldata data) external returns (bytes32);
    function challengeOperation(bytes32 operationId, bytes calldata evidence) external;
    function executeOperation(bytes32 operationId) external;
    function emergencyOverride(bytes32 operationId) external;
}
```

## Recommendations

### Immediate Actions
1. **Decision Required**: Are we documenting V1 (single) or V2 (quorum) as the target state?
2. **If V2 (quorum)**:
   - Update all requirement IDs
   - Revise all architecture sections
   - Add consensus specifications
   - Update risk assessments

3. **If V1 with V2 path**:
   - Clearly mark current state vs future
   - Add migration requirements
   - Document upgrade interfaces

### Documentation Strategy
1. Create a **VERSION** marker in each document
2. Use consistent terminology:
   - V1: "Single Watchdog"
   - V2: "Watchdog Consensus" or "Watchdog Quorum"
3. Add clear transition requirements

## Next Steps

1. **Get stakeholder decision** on documentation approach
2. **Create unified terminology** guide
3. **Update all PRDs** systematically
4. **Add missing technical specs**
5. **Validate with implementation** team

## Optimistic-Minting Repository Analysis

### Current State
The optimistic-minting repository is a **TypeScript/Node.js application**, not a Solidity contracts repository. It implements:
- **Two-role system**: Minters and Guardians
- **Off-chain monitoring**: Event-based processing
- **No quorum logic**: Simple role-based permissions

### Key Patterns to Adapt
1. **Role separation**: Minter/Guardian pattern → Primary Validator/Challenger pattern
2. **Delay mechanisms**: OptimisticMintingDelay → Challenge periods (1h, 4h, 12h)
3. **Monitoring infrastructure**: Can be reused for watchdog coordination

### Integration Concerns
- The repository references **SingleWatchdog** in its integration guide
- No mention of quorum or N-of-M consensus
- Would need updates to support multiple watchdogs

## Conclusion

1. **PRD Mismatch**: The main PRD documents describe a single watchdog system, while `watchdog-decentralization.md` describes an N-of-M quorum
2. **Optimistic-Minting**: Is an off-chain TypeScript application, not the Solidity pattern source we expected
3. **Fundamental Decision Needed**: Are we implementing V1 (single) or V2 (quorum) now?

This fundamental mismatch must be resolved before proceeding with implementation. The optimistic patterns we need may be in the main tBTC contracts, not in this separate monitoring application.