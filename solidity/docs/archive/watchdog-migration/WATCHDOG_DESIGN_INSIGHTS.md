# Watchdog System Design Insights

**Document Version**: 1.5  
**Date**: 2025-08-05  
**Purpose**: Document key insights from analyzing the watchdog system architecture  
**Status**: Analysis Document

---

## Executive Summary

Through our analysis of the tBTC v2 watchdog system, we've uncovered fundamental insights about trust, objectivity, and consensus in decentralized monitoring systems. This document captures these insights to guide future design decisions.

## Design Journey

Our understanding evolved through several key realizations:

1. **Initial Concern**: The PR claiming "simplification" actually added massive complexity (17+ contracts, 30k+ lines)

2. **First Insight**: We thought requiring consensus for objective computations (like reserve < threshold) was over-engineered

3. **Critical Correction**: You pointed out we don't trust single watchdogs for reserve attestations - this is an oracle problem, not over-engineering

4. **Final Architecture**: We now understand there are THREE distinct problems requiring different solutions:
   - Oracle problem (objective facts, untrusted sources) → Multiple attesters
   - Observation problem (subjective observations) → Individual reporting  
   - Decision problem (subjective judgments) → DAO governance

This journey led us from skepticism about consensus to understanding its proper role.

---

## Key Insights

### 1. The Two-Phase Nature of Watchdog Operations

Every watchdog operation can be decomposed into two distinct phases:

1. **Data Input Phase**: Getting external information on-chain
2. **Computation/Action Phase**: Processing that information to trigger protocol actions

These phases have different trust requirements and should be treated separately.

### 2. Trust Spectrum in Data Inputs

We identified three categories of data inputs based on trust requirements:

#### Category 1: Cryptographically Verifiable (Trustless)
- **Examples**: SPV proofs, Bitcoin transaction proofs, on-chain data
- **Trust Level**: None - can be verified by smart contracts
- **Consensus Needed**: No
- **Who Can Submit**: Anyone (though may be role-gated for DoS protection)

#### Category 2: Trusted but Deterministic
- **Examples**: Reserve attestations, activity timestamps
- **Trust Level**: High - relies on honest reporting
- **Consensus Needed**: For the input, not the computation
- **Who Can Submit**: Permissioned attesters

#### Category 3: Subjective Observations
- **Examples**: "Suspicious activity", "operational concerns"
- **Trust Level**: Very High - requires human judgment
- **Consensus Needed**: Yes - multiple observers must agree
- **Who Can Submit**: Permissioned watchdogs with consensus

### 3. The Objectivity Misconception

We discovered that "objectivity" in the watchdog context doesn't mean "trustless" but rather "deterministic computation given accepted inputs":

```
"Objective" = Deterministic Computation + Accepted Data
              (No trust needed)        (May require trust)
```

For example:
- Reserve violation: `trusted_attestation < minted * 0.9` 
- The computation is objective, but the attestation requires trust

**Update**: This led to a deeper insight about the oracle problem. Objective facts (like reserve balances) exist in reality but cannot be verified on-chain without trust. This is why oracle consensus (multiple attesters) is needed - not because the fact is subjective, but because no single source can be trusted to report it accurately.

### 4. Separation of Concerns Principle

The 3-layer system correctly identified that we need to separate:

1. **Who can provide data** (trust boundary)
2. **Who can trigger computations** (should be permissionless for objective computations)
3. **Who can make decisions** (consensus for subjective matters)

Our simplified approach conflated these concerns by requiring consensus for objective computations.

### 5. The 90/10 Rule

The documents claim 90% of watchdog operations are "objective" (deterministic computations) and only 10% are subjective. However, this is misleading because:

- 90% have deterministic **computations**
- But many rely on **trusted inputs**
- True trustless operations are probably closer to 30-40%

### 6. Consensus Anti-Patterns (Revised Understanding)

We initially identified these as anti-patterns, but our understanding has evolved:

#### Former Anti-Pattern 1: Voting on Facts
We thought: "Making watchdogs vote on objective computations like 'is 800 < 1000 * 0.9?'"

**Revised Understanding**: If the "800" comes from untrusted attestations, voting on the INPUT (what is the reserve balance?) makes sense. The computation itself shouldn't require consensus.

#### Anti-Pattern 2: Consensus for Computation Triggering
Requiring M-of-N approval to run a deterministic calculation on existing data

**This remains an anti-pattern**: Once data is accepted (through oracle consensus if needed), computations should be permissionless.

#### Former Anti-Pattern 3: Conflating Input Trust with Computation Trust
We thought: "Requiring consensus for computations just because the underlying data was trusted"

**Revised Understanding**: The pattern should be:
1. Use oracle consensus for untrusted inputs (if needed)
2. Use permissionless computation on consensus data
3. Don't require consensus for the computation itself

### 7. The Real Purpose of Consensus

Consensus should be used for:
1. **Validating trusted inputs** when multiple sources can provide verification
2. **Making subjective decisions** that require human judgment
3. **Authorizing high-impact actions** as a safety mechanism

Consensus should NOT be used for:
1. **Running deterministic computations** on accepted data
2. **Triggering time-based actions** (like timeouts)
3. **Checking mathematical conditions**

### 7.5. Two Types of Consensus: Oracle vs Decision

A critical insight emerged from our analysis: consensus serves two fundamentally different purposes in the watchdog system.

#### Type 1: Oracle Consensus (Trust Distribution)

**Purpose**: Transform untrusted objective facts into trusted data through honest majority

**The Problem**:
- Reserve balances exist as objective facts (a QC has exactly X BTC)
- But we cannot verify this on-chain without expensive proofs
- A single attester could lie or be compromised

**The Solution**:
```solidity
// Multiple independent watchdogs report the same objective fact
Watchdog 1: attestReserves(qc, 1000 BTC)
Watchdog 2: attestReserves(qc, 1000 BTC)
Watchdog 3: attestReserves(qc, 999 BTC)
→ Consensus: 1000 BTC (median/majority)
```

**Key Characteristics**:
- Voting on "what IS" (objective reality)
- Truth exists but cannot be directly verified
- Multiple attesters reduce single point of failure
- This is fundamentally an oracle problem

#### Type 2: Decision Consensus (Judgment Aggregation) - Moved to DAO

**Purpose**: Aggregate human judgment on subjective matters

**Updated Design**: Watchdogs no longer make subjective decisions. Instead:
1. Watchdogs submit transparent subjective reports
2. DAO members review accumulated reports
3. DAO makes decisions through governance

**The New Flow**:
```solidity
// Step 1: Watchdogs report observations (no consensus needed)
Watchdog 1: reportObservation(qc, SUSPICIOUS_PATTERN, "Unusual fund movements", evidence)
Watchdog 2: supportReport(reportId) // Can validate others' observations
Watchdog 3: reportObservation(qc, OPERATIONAL_CONCERN, "Slow responses", evidence)

// Step 2: DAO reviews and decides (decision consensus)
DAO Proposal: "Review watchdog reports for QC X"
→ DAO Vote: Take action / No action / Request investigation
```

**Key Characteristics**:
- Watchdogs: Report observations transparently
- DAO: Makes decisions on accumulated reports
- Clear separation of observation from judgment
- Better accountability and deliberation

#### The Critical Distinction

| Aspect | Oracle Consensus | Watchdog Reporting | DAO Decision |
|--------|-----------------|-------------------|--------------|
| **Who** | Multiple watchdogs | Individual watchdogs | DAO members |
| **Question** | "What is the fact?" | "What did I observe?" | "What should we do?" |
| **Truth** | Objective but unverifiable | Subjective observation | Subjective judgment |
| **Goal** | Overcome untrusted sources | Transparent documentation | Aggregate judgment |
| **Example** | Reserve balance reporting | Suspicious pattern report | Action on reports |
| **Consensus** | Yes (oracle) | No (just report) | Yes (governance) |
| **Action** | Permissionless computation | No immediate action | Authorized execution |

### 8. Design Principles for Simplification

Based on our analysis, a truly simplified system should:

1. **Separate data submission from computation triggering**
2. **Make objective computations permissionless**
3. **Use oracle consensus for objective facts from untrusted sources**
4. **Separate subjective reporting from decision-making**
5. **Let DAO handle all subjective decisions**
6. **Minimize trusted inputs through cryptographic proofs**
7. **Allow parallel data sources for trust distribution**
8. **Support both combined and separate patterns based on use case**
9. **Conceptual separation doesn't require implementation separation**

### 8.5. Three-Layer Architecture

The refined architecture separates concerns clearly:

```
Layer 1: Data Input
├── Trustless: SPV proofs, on-chain data
├── Oracle Consensus: Reserve attestations (multiple watchdogs)
└── Subjective Reports: Individual watchdog observations

Layer 2: Computation/Processing  
├── Permissionless: Anyone can trigger objective computations
├── Deterministic: Math on consensus data
└── Transparent: All reports visible on-chain

Layer 3: Decision/Action
├── Automated: Objective violations trigger immediate action
├── DAO Governed: Subjective reports reviewed by DAO
└── Authorized: High-impact actions require governance
```

This architecture ensures:
- No single point of failure (oracle consensus)
- Clear separation of powers (watchdogs observe, DAO decides)
- Maximum permissionlessness where possible
- Proper deliberation for subjective matters

### 8.6. Category 4 Criteria: Subjective Reporting

**What Qualifies for Subjective Reporting**:
1. **Requires Human Judgment**: Cannot be reduced to objective metrics
2. **Has Actionable Response**: Clear DAO actions available
3. **Represents Material Risk**: Worth governance attention

**Filtering Mechanism**:
- Severity levels (LOW/MEDIUM/HIGH/CRITICAL)
- Peer support requirements (except CRITICAL)
- Mandatory proposed actions
- Evidence requirements

**What Does NOT Qualify**:
- Objective facts (use oracle consensus)
- Objective violations (use automated enforcement)
- Non-actionable observations (noise)
- Minor operational preferences

This ensures the DAO only reviews high-quality, actionable reports while allowing individual watchdogs to raise genuine concerns.

### 8.7. Final Design Decisions

Based on our analysis, we've made these key design decisions:

1. **Use Oracle Consensus Where Needed**:
   - Reserve attestations (can't verify multi-address Bitcoin balances)
   - Any objective fact from untrusted off-chain sources
   - Median/majority from 3+ attesters

2. **Make Computations Permissionless**:
   - Reserve compliance checks
   - Timeout enforcements
   - Any deterministic calculation on accepted data

3. **Individual Reporting for Subjective Observations**:
   - No watchdog consensus on subjective matters
   - Severity-based filtering (LOW/MEDIUM/HIGH/CRITICAL)
   - Mandatory actionability (proposed DAO action required)

4. **DAO Governance for All Subjective Decisions**:
   - Reviews filtered watchdog reports
   - Makes decisions through standard governance
   - Clear separation from observation

5. **Support Combined Patterns**:
   - `attestAndEnforce()` for gas efficiency
   - Separate functions for flexibility
   - Both patterns available based on use case

These decisions create a system that is as simple as possible while addressing the real trust and coordination challenges.

### 9. Implementation Patterns: Conceptual Separation with Practical Combination

While we've established that data submission and computation triggering are conceptually separate concerns, practical implementation often benefits from combining them. This isn't a violation of separation of concerns - it's an optimization.

#### The Combined Pattern

```solidity
// Single transaction for efficiency
function attestAndEnforce(address qc, uint256 balance) external onlyRole(ATTESTER) {
    // Phase 1: Store trusted data (permissioned)
    _storeAttestation(qc, balance);
    
    // Phase 2: Trigger computation (conceptually permissionless)
    _enforceCompliance(qc);  // Even though gated by role, computation itself needs no trust
}
```

**Benefits:**
- **Gas Efficiency**: Single transaction instead of two
- **Atomicity**: No state inconsistency between submission and enforcement
- **MEV Protection**: No opportunity for front-running between phases
- **Simplicity**: Easier mental model for operators

**When to Use:**
- Computation should always immediately follow data submission
- Same actor performs both operations
- Atomicity is required
- Gas optimization is important

#### The Separate Pattern

```solidity
// Separate transactions for flexibility
function submitAttestation(address qc, uint256 balance) external onlyRole(ATTESTER) {
    _storeAttestation(qc, balance);
}

function enforceCompliance(address qc) external {  // No role restriction!
    require(hasAttestation(qc), "No attestation");
    _enforceCompliance(qc);
}
```

**Benefits:**
- **Flexibility**: Multiple computations can use same data
- **Permissionless Triggers**: Anyone can trigger computations
- **Delayed Execution**: Can wait for optimal gas prices
- **Composability**: Other contracts can trigger enforcement

**When to Use:**
- Multiple computations depend on same data
- Different actors submit vs trigger
- Delayed or conditional triggering is beneficial
- Maximum decentralization is desired

#### Hybrid Approach

The optimal design supports both patterns:

```solidity
// Option 1: Combined (common case)
function attestReservesWithCheck(address qc, uint256 balance) external onlyRole(ATTESTER) {
    attestReserves(qc, balance);
    if (shouldEnforce(qc)) {
        enforceCompliance(qc);  // Immediate enforcement
    }
}

// Option 2: Separate (always available)
function enforceCompliance(address qc) external {  // Permissionless
    // Use existing attestation data
    _enforceCompliance(qc);
}
```

#### Key Insight

The combined pattern doesn't violate our principles because:
1. **Conceptually**: Data and computation remain separate concerns
2. **Implementation**: Combining them is purely an optimization
3. **Architecture**: System supports both patterns
4. **Security**: Trust boundaries remain clear (data needs trust, computation doesn't)

---

## Operation Classification

### Current Operation Set Analysis

| Operation | Data Input Type | Computation Type | Current Implementation | Optimal Implementation |
|-----------|----------------|------------------|----------------------|----------------------|
| Reserve Compliance | Trusted attestation | Deterministic | Requires consensus | Permissionless trigger on trusted data |
| Redemption Timeout | On-chain timestamp | Deterministic | Requires consensus | Permissionless trigger |
| Wallet Registration | SPV proof | Verification | Direct execution | Correct as-is |
| Redemption Fulfillment | SPV proof | Verification | Direct execution | Correct as-is |
| Suspicious Activity | Subjective observation | Subjective | Requires consensus | Correct as-is |
| QC Status Change | Depends on reason | Deterministic/Subjective | Always requires consensus | Should depend on reason |

### Trust Reduction Opportunities

1. **Reserve Attestations**: Could potentially use Chainlink oracles or multiple attesters
2. **Activity Monitoring**: Can be made fully on-chain by tracking contract interactions
3. **Timeout Enforcement**: Already trustless, just needs permissionless triggers

---

## Architectural Implications

### Option 1: True Separation Architecture
```
Data Input Layer (handles trust)
    ↓
Data Storage Layer (neutral storage)
    ↓
Computation Layer (trustless execution)
    ↓
Action Layer (protocol state changes)
```

### Option 2: Hybrid Approach
- Trusted operations go through consensus
- Trustless operations execute directly
- Deterministic computations are permissionless

### Option 3: Progressive Decentralization
1. Start with trusted inputs + consensus
2. Gradually replace with trustless mechanisms
3. Eventually minimize consensus requirements

---

## Unresolved Questions

1. **Economic Incentives**: Who pays for permissionless computation triggers?
2. **DoS Protection**: How to prevent spam if anyone can trigger computations?
3. **Trust Minimization**: Can we make reserve attestations trustless?
4. **Dispute Resolution**: What happens when attesters disagree?
5. **Upgrade Path**: How to transition from trusted to trustless inputs?

---

## Conclusion

The core insight is that the watchdog system must handle three distinct challenges:

1. **The Oracle Problem**: Objective facts exist off-chain but require trust to report on-chain
2. **The Observation Problem**: Subjective observations need transparent reporting
3. **The Judgment Problem**: Subjective decisions require deliberative governance

A truly simplified system would:

1. Use oracle consensus (multiple attesters) for untrusted objective facts
2. Enable transparent reporting of subjective observations by individual watchdogs
3. Delegate subjective decisions to DAO governance
4. Make computations on consensus data permissionless
5. Support combined patterns for efficiency while maintaining conceptual separation
6. Progressively replace oracle consensus with cryptographic proofs where possible

The optimal architecture separates:

- **Oracle consensus**: Transforms untrusted objective facts into trusted data (watchdogs)
- **Subjective reporting**: Transparent documentation of observations (individual watchdogs)
- **Decision consensus**: Deliberative judgment on subjective matters (DAO)
- **Permissionless computation**: Executes deterministic logic on trusted data (anyone)

This design achieves:
- Clear separation of powers (observe vs decide)
- No single points of failure (oracle consensus)
- Proper deliberation for subjective matters (DAO governance)
- Maximum permissionlessness where possible
- Transparent accountability at every layer

The key evolution in our understanding: Watchdogs should observe and report, not judge and execute, when it comes to subjective matters.