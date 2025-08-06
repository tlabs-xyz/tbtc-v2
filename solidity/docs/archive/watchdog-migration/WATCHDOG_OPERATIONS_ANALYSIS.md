# Watchdog Operations Comprehensive Analysis

**Document Version**: 1.5  
**Date**: 2025-08-05  
**Purpose**: Analyze all watchdog operations through the lens of trust and computation separation  
**Status**: Analysis Document

---

## Framework for Analysis

Each operation is analyzed across four dimensions:

1. **Data Input Phase**: How external information enters the system
2. **Trust Requirements**: Level of trust needed for the data
3. **Computation Phase**: Processing logic applied to the data
4. **Optimal Design**: How the operation should be structured

---

## Detailed Operation Analysis

### 1. Reserve Attestation & Compliance

#### Current Implementation

**Data Input**:
```solidity
// QCWatchdog.sol
function attestReserves(address qc, uint256 balance) external onlyRole(WATCHDOG_OPERATOR_ROLE) {
    reserveLedger.submitReserveAttestation(qc, balance);
}
```

**Computation/Enforcement**:
```solidity
// WatchdogAutomatedEnforcement.sol
function enforceReserveCompliance(address qc) external {
    (uint256 reserves, bool isStale) = reserveLedger.getReserveBalanceAndStaleness(qc);
    uint256 minted = qcData.getQCMintedAmount(qc);
    
    if (reserves * 100 < minted * systemState.minCollateralRatio()) {
        qcManager.setQCStatus(qc, QCData.QCStatus.UnderReview, "INSUFFICIENT_RESERVES");
    }
}
```

#### Analysis

| Aspect | Details |
|--------|---------|
| **Data Type** | Reserve balance (off-chain Bitcoin holdings) |
| **Trust Level** | HIGH - Pure attestation, no cryptographic proof |
| **Verification** | None - relies on attester honesty |
| **Computation** | Deterministic comparison: `reserves < minted * ratio` |
| **Current Design** | Separate input from computation ✅ |
| **Consensus Needed** | For attestation accuracy, NOT for computation |

#### Why No SPV Proof?

From QCReserveLedger.sol comments:
> "Reserve proofs would need to verify multiple Bitcoin addresses and sum balances, which is complex and expensive compared to single transaction proofs"

#### Optimal Design (Oracle Consensus + Permissionless Enforcement)

```solidity
// Phase 1: Oracle Consensus - Multiple attesters submit objective facts
contract ReserveOracle {
    mapping(address => mapping(address => uint256)) public attestations; // qc => attester => balance
    mapping(address => uint256) public attestationCount;
    uint256 public constant MIN_ATTESTERS = 3;
    
    function attestReserves(address qc, uint256 balance) external onlyRole(WATCHDOG_ROLE) {
        attestations[qc][msg.sender] = balance;
        attestationCount[qc]++;
        
        // Auto-compute consensus when threshold reached
        if (attestationCount[qc] >= MIN_ATTESTERS) {
            _computeConsensus(qc);
        }
    }
    
    function _computeConsensus(address qc) internal {
        uint256[] memory values = _getAttestationValues(qc);
        uint256 consensusValue = _calculateMedian(values);
        _storeConsensusReserves(qc, consensusValue);
    }
}

// Phase 2: Permissionless Enforcement - Anyone can trigger based on consensus data
contract ComplianceEngine {
    function checkReserveCompliance(address qc) external {  // No role restriction!
        uint256 reserves = oracle.getConsensusReserves(qc);
        uint256 minted = qcData.getMintedAmount(qc);
        
        // Deterministic computation on trusted (consensus) data
        if (reserves < minted * 0.9) {
            qcManager.setQCStatus(qc, UnderReview, "INSUFFICIENT_RESERVES");
        }
    }
}
```

**Key Benefits**:
- No single point of trust failure
- Clear separation: oracle consensus for data, permissionless for computation
- Reduced attack surface (need to corrupt multiple attesters)
- Anyone can trigger enforcement once consensus is reached

---

### 2. Wallet Registration

#### Current Implementation

**Data Input + Verification**:
```solidity
// QCWatchdog.sol
function registerWalletWithProof(
    address qc,
    string calldata btcAddress,
    bytes calldata spvProof,
    bytes32 challengeHash
) external onlyRole(WATCHDOG_OPERATOR_ROLE) {
    // SPV verification
    if (!_verifyWalletControl(qc, btcAddress, challengeHash, txInfo, proof)) {
        revert SPVVerificationFailed();
    }
    qcManager.registerWallet(qc, btcAddress, challengeHash, txInfo, proof);
}
```

#### Analysis

| Aspect | Details |
|--------|---------|
| **Data Type** | Bitcoin address ownership proof |
| **Trust Level** | LOW - Cryptographically verifiable |
| **Verification** | SPV proof of control transaction |
| **Computation** | Proof validation + registration |
| **Current Design** | Combined input/action ✅ |
| **Consensus Needed** | None - cryptographic proof |

#### Optimal Design
Current design is already optimal - trustless verification with immediate action.

---

### 3. Redemption Fulfillment

#### Current Implementation

**Data Input**:
```solidity
// QCWatchdog.sol
function recordRedemptionFulfillment(
    bytes32 redemptionId,
    string calldata userBtcAddress,
    uint64 expectedAmount,
    BitcoinTx.Info calldata txInfo,
    BitcoinTx.Proof calldata proof
) external onlyRole(WATCHDOG_OPERATOR_ROLE) {
    // Verify Bitcoin transaction via SPV
    qcRedeemer.recordRedemptionFulfillment(redemptionId, txInfo, proof);
}
```

**Timeout Enforcement**:
```solidity
// WatchdogAutomatedEnforcement.sol
function enforceRedemptionTimeout(bytes32 redemptionId) external {
    Redemption memory r = redeemer.getRedemption(redemptionId);
    
    if (block.timestamp > r.requestedAt + timeout && r.status == Pending) {
        qcRedeemer.flagDefaultedRedemption(redemptionId, "REDEMPTION_TIMEOUT");
    }
}
```

#### Analysis

| Aspect | Details |
|--------|---------|
| **Data Type** | Bitcoin transaction proof |
| **Trust Level** | LOW - SPV verifiable |
| **Verification** | Cryptographic proof |
| **Computation** | Timeout check (purely on-chain) |
| **Current Design** | Good separation ✅ |
| **Consensus Needed** | None |

---

### 4. QC Status Changes

#### Current Implementation

**Via Consensus (Current)**:
```solidity
// WatchdogConsensusManager.sol
function proposeStatusChange(
    address qc,
    QCData.QCStatus newStatus,
    string calldata reason
) external onlyRole(WATCHDOG_ROLE) returns (bytes32 proposalId) {
    // Creates proposal requiring M-of-N votes
}
```

**Direct Change (Available)**:
```solidity
// QCWatchdog.sol
function changeQCStatus(
    address qc,
    QCData.QCStatus newStatus,
    bytes32 reason
) external onlyRole(WATCHDOG_OPERATOR_ROLE) {
    qcManager.setQCStatus(qc, newStatus, reason);
}
```

#### Analysis

| Aspect | Details |
|--------|---------|
| **Data Type** | Status determination |
| **Trust Level** | VARIES - Depends on reason |
| **Verification** | Depends on underlying evidence |
| **Computation** | Status update |
| **Current Design** | Conflated - always requires consensus |
| **Consensus Needed** | Only for subjective reasons |

#### Optimal Design

```solidity
// Separate objective from subjective status changes
function triggerObjectiveStatusChange(address qc, bytes32 violationType) external {
    // Verify objective condition
    if (violationType == INSUFFICIENT_RESERVES) {
        require(reservesViolated(qc), "No violation");
    } else if (violationType == REDEMPTION_TIMEOUT) {
        require(hasTimedOutRedemptions(qc), "No timeout");
    }
    // Direct execution for objective violations
    qcManager.setQCStatus(qc, QCStatus.UnderReview, violationType);
}

function proposeSubjectiveStatusChange(address qc, QCStatus newStatus, string reason) external {
    // Requires consensus for subjective determinations
    createProposal(...);
}
```

---

### 5. Solvency Verification

#### Current Implementation

```solidity
// QCWatchdog.sol
function verifySolvencyAndAct(address qc) external onlyRole(WATCHDOG_OPERATOR_ROLE) {
    bool solvent = qcManager.verifyQCSolvency(qc);
    if (!solvent) {
        // Emit event only - doesn't change status directly
    }
}
```

#### Analysis

| Aspect | Details |
|--------|---------|
| **Data Type** | Computed solvency from on-chain data |
| **Trust Level** | MEDIUM - Based on trusted attestations |
| **Verification** | Mathematical computation |
| **Computation** | Compare reserves vs minted |
| **Current Design** | Oddly passive (only emits event) |
| **Consensus Needed** | None for computation |

---

## Operation Categories (Revised with Oracle Consensus Understanding)

### Category 1: Purely Trustless Operations
- Redemption timeout enforcement
- On-chain activity monitoring
- Mathematical computations on accepted data

**Design Principle**: Should be permissionlessly triggerable
**Consensus Needed**: None

### Category 2: Cryptographically Verifiable Operations
- Wallet registration (SPV)
- Redemption fulfillment (SPV)
- Bitcoin transaction verification

**Design Principle**: Role-gated for DoS protection but no consensus needed
**Consensus Needed**: None (cryptographic proof is sufficient)

### Category 3: Objective Facts from Untrusted Sources (Oracle Problem)
- Reserve attestations
- Wallet activity timestamps
- Off-chain metrics

**Design Principle**: Requires oracle consensus from multiple attesters
**Consensus Type**: Oracle consensus - voting on "what IS"
**Post-Consensus**: Computation should be permissionless

**Implementation Pattern**:
```solidity
// Step 1: Multiple attesters submit data
mapping(address => mapping(address => uint256)) attestations; // qc => attester => balance

// Step 2: Consensus calculation
function getConsensusReserves(address qc) public view returns (uint256) {
    // Calculate median of attestations
    uint256[] memory values = getAttestationValues(qc);
    return calculateMedian(values);
}

// Step 3: Permissionless enforcement
function enforceReserveCompliance(address qc) external { // No role!
    uint256 consensusReserves = getConsensusReserves(qc);
    uint256 minted = getMintedAmount(qc);
    
    if (consensusReserves < minted * 0.9) {
        setQCStatus(qc, UnderReview, "INSUFFICIENT_RESERVES");
    }
}
```

### Category 4: Subjective Observations (Reporting Only)

**What Belongs in Category 4**:
1. **Pattern Recognition Requiring Human Judgment**
   - Unusual fund routing patterns suggesting evasion
   - Redemption patterns indicating wash trading
   - Behavior inconsistent with stated business model

2. **Quality Issues Not Violating Hard Metrics**
   - Poor support quality despite meeting response times
   - Misleading documentation though technically accurate
   - User complaints increasing though SLAs are met

3. **Potential Security Concerns (Not Provable)**
   - Weak operational security practices
   - Concerning staff changes or partnerships
   - Risk indicators without concrete violations

**What Does NOT Belong in Category 4**:
- Objective facts (need oracle consensus)
- Objective violations (should be automated)
- Non-actionable observations (noise)

**Actionability Requirements**:
Every report must include:
1. Specific action DAO could take
2. Evidence supporting the observation
3. Material risk to protocol or users

**Design Principle**: Transparent reporting without immediate action
**Consensus Type**: None - individual watchdogs report observations
**Decision Making**: DAO reviews accumulated reports and decides
**Filtering**: Severity levels and peer support prevent DAO overwhelm

**Implementation Pattern**:
```solidity
// Watchdog Reporting System with Severity Filtering
contract SubjectiveReporting {
    enum ObservationType {
        SUSPICIOUS_PATTERN,
        OPERATIONAL_CONCERN,
        UNUSUAL_BEHAVIOR,
        COMPLIANCE_QUESTION,
        SECURITY_OBSERVATION
    }
    
    enum Severity {
        LOW,      // Needs 5 supporters to escalate
        MEDIUM,   // Needs 3 supporters to escalate
        HIGH,     // Needs 1 supporter to escalate
        CRITICAL  // Immediately escalated to DAO
    }
    
    struct Report {
        uint256 id;
        address watchdog;
        address target;
        ObservationType obsType;
        Severity severity;
        string description;
        bytes evidence;
        uint256 timestamp;
        uint256 supportCount;
        string proposedAction;  // What DAO should do
    }
    
    mapping(uint256 => Report) public reports;
    mapping(uint256 => mapping(address => bool)) public hasSupported;
    
    // Individual watchdog reports observation with actionability requirement
    function reportObservation(
        address target,
        ObservationType obsType,
        Severity severity,
        string memory description,
        bytes memory evidence,
        string memory proposedAction  // Required: what should DAO do?
    ) external onlyRole(WATCHDOG_ROLE) returns (uint256 reportId) {
        require(bytes(proposedAction).length > 0, "Must propose DAO action");
        reportId = nextReportId++;
        reports[reportId] = Report({
            id: reportId,
            watchdog: msg.sender,
            target: target,
            obsType: obsType,
            severity: severity,
            description: description,
            evidence: evidence,
            timestamp: block.timestamp,
            supportCount: 0,
            proposedAction: proposedAction
        });
        
        emit ObservationReported(reportId, target, obsType, msg.sender);
    }
    
    // Other watchdogs can support/validate observation
    function supportReport(uint256 reportId) external onlyRole(WATCHDOG_ROLE) {
        require(!hasSupported[reportId][msg.sender], "Already supported");
        hasSupported[reportId][msg.sender] = true;
        reports[reportId].supportCount++;
        
        emit ReportSupported(reportId, msg.sender);
    }
    
    // DAO queries reports for review
    function getReportsForTarget(address target) external view returns (Report[] memory) {
        // Return all reports for target, ordered by support count
    }
}

// DAO Governance decides on accumulated reports
contract DAOGovernance {
    function createProposalFromReports(uint256[] memory reportIds) external returns (uint256 proposalId) {
        // DAO members create proposals based on watchdog reports
        // Standard governance voting process
        // Actions only execute after DAO approval
    }
}
```

**Example Reports**:
```solidity
// Good: Actionable with clear proposed response
reportObservation(
    qcAddress,
    SUSPICIOUS_PATTERN,
    HIGH,
    "QC routing 80% of redemptions through new addresses daily",
    evidenceBytes, // Transaction hashes
    "Restrict QC from using new addresses without 48h delay"
);

// Bad: Not actionable
reportObservation(
    qcAddress,
    OPERATIONAL_CONCERN,
    LOW,
    "QC seems less responsive",
    emptyBytes,
    ""  // Reverts: no proposed action
);
```

**Key Benefits**:
- Clear separation: Watchdogs observe, DAO decides
- Transparent: All observations on-chain before action
- Accountable: Clear trail from observation to decision
- Flexible: DAO can consider multiple reports together
- Filtered: Only actionable, material reports reach DAO

---

## Implementation Pattern Guidance

### When to Use Combined Pattern vs Separate Pattern

The choice between combined and separate patterns depends on the specific requirements of each operation:

#### Combined Pattern (Single Transaction)

**Best for:**
- SPV-verified operations (wallet registration, redemption fulfillment)
- Time-sensitive enforcement
- Operations requiring atomicity
- Gas optimization scenarios

**Example - Reserve Attestation with Immediate Check:**
```solidity
function attestReservesAndEnforce(address qc, uint256 balance) external onlyRole(ATTESTER) {
    // Phase 1: Submit attestation (trusted input)
    reserveLedger.submitReserveAttestation(qc, balance);
    
    // Phase 2: Check compliance (deterministic computation)
    uint256 minted = qcData.getQCMintedAmount(qc);
    if (balance * 100 < minted * minCollateralRatio) {
        qcManager.setQCStatus(qc, QCStatus.UnderReview, "INSUFFICIENT_RESERVES");
    }
    
    // Both phases in one atomic transaction - efficient and safe
}
```

#### Separate Pattern (Multiple Transactions)

**Best for:**
- Operations with multiple downstream computations
- Different actors for input vs triggering
- Maximum decentralization
- Flexible timing requirements

**Example - Separate Attestation and Enforcement:**
```solidity
// Transaction 1: Trusted party submits data
function submitReserveAttestation(address qc, uint256 balance) external onlyRole(ATTESTER) {
    reserveLedger.submitReserveAttestation(qc, balance);
    emit AttestationSubmitted(qc, balance);
}

// Transaction 2: Anyone can trigger computation
function checkReserveCompliance(address qc) external {  // No role restriction!
    (uint256 reserves, bool isStale) = reserveLedger.getReserveBalanceAndStaleness(qc);
    uint256 minted = qcData.getQCMintedAmount(qc);
    
    if (reserves * 100 < minted * minCollateralRatio) {
        qcManager.setQCStatus(qc, QCStatus.UnderReview, "INSUFFICIENT_RESERVES");
    }
}
```

### Pattern Selection by Operation Type

| Operation | Recommended Pattern | Reasoning |
|-----------|-------------------|-----------|
| **Wallet Registration** | Combined | SPV proof + registration should be atomic |
| **Reserve Attestation** | Both supported | Combined for efficiency, separate for flexibility |
| **Redemption Fulfillment** | Combined | Proof verification + status update should be atomic |
| **Redemption Timeout** | Separate only | Pure computation, should be permissionless |
| **Suspicious Activity** | Reporting only | Watchdog reports, DAO decides |
| **Emergency Situations** | Reporting only | Watchdog reports urgently, DAO acts |
| **Quality Concerns** | Reporting only | Accumulate reports for DAO review |

### Hybrid Implementation Example

The optimal design supports both patterns:

```solidity
contract OptimalWatchdog {
    // Combined pattern - common path
    function attestReservesWithCheck(address qc, uint256 balance) external onlyRole(ATTESTER) {
        _submitAttestation(qc, balance);
        
        // Optional immediate enforcement
        if (_shouldEnforceImmediately(qc)) {
            _enforceCompliance(qc);
        }
    }
    
    // Separate pattern - always available
    function enforceCompliance(address qc) external {  // Permissionless!
        _enforceCompliance(qc);
    }
    
    // Batch operations - gas efficient
    function batchEnforceCompliance(address[] calldata qcs) external {
        for (uint i = 0; i < qcs.length; i++) {
            _enforceCompliance(qcs[i]);
        }
    }
    
    // Internal enforcement logic
    function _enforceCompliance(address qc) internal {
        // Deterministic computation on stored data
        // No external trust required at this point
    }
}
```

### Key Benefits of Supporting Both Patterns

1. **Operational Flexibility**: Operators can choose based on urgency
2. **Gas Optimization**: Combine when beneficial, separate when not
3. **Progressive Decentralization**: Start combined, enable separation over time
4. **Resilience**: If attesters fail to enforce, anyone can trigger
5. **Composability**: Other protocols can trigger enforcement

---

## Filtering and Escalation Mechanism

To prevent DAO overwhelm while ensuring critical issues are addressed:

### Severity-Based Escalation Thresholds

| Severity | Support Required | Use Case |
|----------|-----------------|----------|
| LOW | 5 watchdogs | Minor concerns, patterns worth monitoring |
| MEDIUM | 3 watchdogs | Significant issues requiring investigation |
| HIGH | 1 watchdog | Serious concerns with clear evidence |
| CRITICAL | 0 (immediate) | Urgent security or solvency threats |

### Actionability Checklist for Watchdogs

Before submitting a report, verify:

1. **Specific DAO Action Available**
   - ✅ "Restrict operations until audit completed"
   - ✅ "Require additional collateral"
   - ✅ "Update operational requirements"
   - ❌ "Be aware of this situation"

2. **Evidence Can Be Verified**
   - ✅ Transaction hashes
   - ✅ On-chain patterns
   - ✅ External documentation
   - ❌ Unverifiable claims

3. **Material Risk Exists**
   - ✅ User funds at risk
   - ✅ Protocol security concern
   - ✅ Regulatory compliance issue
   - ❌ Minor preferences

### Edge Case Handling

1. **Objective Fact Dispute**: Use oracle re-attestation, not subjective report
2. **Mixed Objective/Subjective**: Separate automated response from human judgment
3. **Urgent Subjective**: Use CRITICAL severity for immediate escalation

---

## Key Findings

### 1. Misaligned Consensus Requirements (Updated Understanding)

Current system requires consensus for:
- Objective computations (reserve < minted * 0.9) ❌
- Timeout enforcement ❌
- Mathematical checks ❌

**Revised Understanding**: The system should use TWO types of consensus:

**Oracle Consensus** (for untrusted objective facts):
- Reserve balance attestations ✅
- Wallet activity timestamps ✅
- Off-chain metrics ✅

**Decision Consensus** (for subjective judgments):
- Suspicious activity assessment ✅
- Emergency interventions ✅
- Operational quality concerns ✅

**No Consensus Needed**:
- Deterministic computations on consensus data ✅
- Timeout enforcement (uses blockchain time) ✅
- SPV-verified operations ✅

### 2. The Oracle Problem (Formerly "Trusted Input Problem")

Many objective facts exist off-chain and cannot be verified on-chain:
- Reserve attestations (multiple Bitcoin addresses, no efficient SPV)
- Wallet activity timestamps
- Off-chain metrics

**Solution**: Oracle consensus transforms untrusted individual reports into trusted aggregate data through honest majority assumption. This is not about objectivity vs subjectivity, but about trust distribution.

### 3. Separation of Concerns Success

The system does successfully separate:
- Data input from computation (mostly)
- Independent watchdog operations from consensus operations
- Cryptographic verification from trust-based attestation

### 4. Permissionless Computation Opportunity

Most enforcement functions could be permissionlessly triggerable:
- Anyone could call `enforceReserveCompliance()`
- Anyone could call `enforceRedemptionTimeout()`
- Only the data input needs permission

---

## Recommendations

### 1. Implement True Permissionless Triggers

```solidity
modifier onlyValidComputation(bytes32 computationType) {
    require(isObjectiveComputation(computationType), "Not objective");
    _;
}

function triggerComputation(address target, bytes32 computationType) 
    external 
    onlyValidComputation(computationType) 
{
    // No role check - anyone can trigger objective computations
}
```

### 2. Separate Trusted Input from Computation

```solidity
contract TrustedInputRegistry {
    // Only these need roles
    function submitAttestation(address qc, uint256 value) external onlyRole(ATTESTER_ROLE);
}

contract ComputationEngine {
    // These should be permissionless
    function checkViolations(address qc) external; // No role!
}
```

### 3. Multi-Source Trust Distribution

```solidity
// Instead of single attestations
mapping(address => AttestationData[]) multipleAttestations;

function getConsensusValue(address qc) public view returns (uint256) {
    // Median of multiple sources
}
```

### 4. Progressive Decentralization Path

1. **Phase 1**: Current trusted attestations with consensus
2. **Phase 2**: Multiple attesters, permissionless computation
3. **Phase 3**: Cryptographic proofs where possible
4. **Phase 4**: Fully trustless with ZK proofs of reserves

---

## Conclusion

The watchdog system faces three distinct challenges:

1. **The Oracle Problem**: Getting objective facts on-chain from untrusted sources
2. **The Observation Problem**: Documenting subjective observations transparently
3. **The Judgment Problem**: Making decisions on subjective matters

The optimal architecture implements:

1. **Oracle Consensus**: Multiple watchdogs attest to objective facts (reserve balances)
2. **Transparent Reporting**: Individual watchdogs report subjective observations
3. **DAO Governance**: Protocol governance makes decisions on subjective reports
4. **Permissionless Enforcement**: Anyone can trigger computations on consensus data
5. **Combined Patterns**: Support attest+enforce in one transaction for efficiency

This achieves true simplification through clear separation of concerns:

| Function | Who | Consensus | Action |
|----------|-----|-----------|--------|
| Objective facts | Multiple watchdogs | Oracle consensus | Permissionless computation |
| Subjective observations | Individual watchdogs | None (just report) | No immediate action |
| Subjective decisions | DAO | Governance vote | Authorized execution |
| Objective enforcement | Anyone | None needed | Immediate if conditions met |

Key benefits:
- No single points of failure (oracle consensus for facts)
- Clear separation of powers (observe vs decide)
- Maximum permissionlessness (objective computations)
- Proper deliberation (DAO reviews subjective matters)
- Full transparency (all reports on-chain)

The fundamental insight: Watchdogs are observers and fact-reporters, not judges. When judgment is needed, it belongs to the DAO.

## Design Validation

### Why This Design Is Not Over-Engineered

1. **Each Consensus Type Solves a Real Problem**:
   - **Oracle consensus**: We genuinely don't trust single attesters for Bitcoin reserves
   - **No consensus**: Cryptographic proofs and on-chain data don't need consensus
   - **DAO consensus**: Subjective decisions require deliberation

2. **Clear Decision Tree**:
   ```
   Is it objective?
   ├─ Yes → Can we verify on-chain?
   │   ├─ Yes → No consensus needed (permissionless)
   │   └─ No → Oracle consensus (multiple attesters)
   └─ No → Individual reporting → DAO decision
   ```

3. **Minimal Viable Consensus**:
   - We only use consensus where absolutely necessary
   - Computations are permissionless
   - Individual observations don't require watchdog consensus

### What We Removed vs What We Kept

**Removed** (Over-engineering):
- Consensus for mathematical computations
- Consensus for timeout checks  
- Watchdog voting on subjective matters
- Complex 3-layer enforcement hierarchy

**Kept** (Necessary complexity):
- Oracle consensus for untrusted objective facts
- Individual reporting with severity filtering
- DAO governance for subjective decisions
- Combined patterns for gas efficiency

### Final Architecture Validation

Our design addresses three distinct problems with appropriate solutions:

1. **Oracle Problem** → Multiple attesters reach consensus on facts
2. **Observation Problem** → Individual reports with quality filtering  
3. **Decision Problem** → DAO governance with full context

This is intellectually honest engineering: using the right tool for each problem, no more, no less.