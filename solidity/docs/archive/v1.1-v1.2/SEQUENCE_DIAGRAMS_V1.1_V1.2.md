# Sequence Diagrams: V1.1/V1.2 Key Flows

**Version**: 1.0  
**Date**: 2025-08-05

---

## 1. QC Registration and Wallet Setup

```mermaid
sequenceDiagram
    participant Gov as Governance
    participant QCM as QCManager
    participant SS as SystemState
    participant W as Watchdog
    participant QCW as QCWatchdog
    participant SPV as SPVValidator

    Note over Gov,SPV: QC Registration Phase
    Gov->>QCM: registerQC(qcAddress, "QC Name")
    QCM->>QCM: Validate inputs
    QCM->>QCM: Store QC data
    QCM-->>Gov: emit QCRegistered

    Note over Gov,SPV: Wallet Registration Phase
    W->>QCW: registerQCWallet(qc, pubKey, btcAddr, proof)
    QCW->>SS: Check not paused
    SS-->>QCW: OK
    QCW->>QCM: registerQCWallet(...)
    QCM->>QCM: Validate QC is active
    QCM->>SPV: validateSPVProof(proof)
    SPV-->>QCM: Valid
    QCM->>QCM: Store wallet data
    QCM-->>QCW: Success
    QCW-->>W: emit WalletRegistered
```

---

## 2. Reserve Attestation Flow

```mermaid
sequenceDiagram
    participant W as Watchdog
    participant QCW as QCWatchdog
    participant SS as SystemState
    participant QCM as QCManager
    participant QCL as QCReserveLedger
    participant MP as MintingPolicy

    W->>QCW: attestReserves(qc, amount)
    QCW->>SS: Check attestations not paused
    SS-->>QCW: Not paused
    
    QCW->>QCL: attestReserves(qc, amount)
    QCL->>QCM: isQCActive(qc)
    QCM-->>QCL: true
    QCL->>QCL: Validate amount > 0
    QCL->>QCL: Store attestation with timestamp
    QCL-->>QCW: emit ReservesAttested
    
    Note over QCL,MP: Later minting checks reserves
    MP->>QCL: getCurrentReserves(qc)
    QCL->>QCL: Check staleness < 7 days
    QCL-->>MP: Return current reserves
```

---

## 3. Minting Operation Flow

```mermaid
sequenceDiagram
    participant User as User/Integration
    participant MP as MintingPolicy
    participant SS as SystemState
    participant QCM as QCManager
    participant QCL as QCReserveLedger
    participant Bank as Bank
    participant TV as TBTCVault

    User->>MP: executeMint(qc, amount, recipient)
    MP->>MP: nonReentrant check
    MP->>SS: Check minting not paused
    SS-->>MP: Not paused
    
    MP->>QCM: isQCActive(qc)
    QCM-->>MP: true
    
    MP->>QCL: getCurrentReserves(qc)
    QCL->>QCL: Check not stale
    QCL-->>MP: reserves
    
    MP->>MP: Check capacity limits
    MP->>MP: Calculate reserve ratio
    MP->>MP: Validate ratio >= threshold
    
    MP->>Bank: increaseBalanceAndCall(qc, amount, calldata)
    Bank->>Bank: Increase QC balance
    Bank->>TV: mint(recipient, amount)
    TV->>TV: Mint TBTC tokens
    TV-->>Bank: Success
    Bank-->>MP: Success
    MP-->>User: emit MintExecuted
```

---

## 4. Redemption Lifecycle Flow

```mermaid
sequenceDiagram
    participant QC as QC User
    participant QCR as QCRedeemer
    participant SS as SystemState
    participant Bank as Bank
    participant W as Watchdog
    participant QCW as QCWatchdog
    participant Arb as Arbiter

    Note over QC,Arb: Initiation Phase
    QC->>QCR: initiateRedemption(amount, btcAddr, userBtcAddr)
    QCR->>QCR: nonReentrant check
    QCR->>SS: Check redemptions not paused
    SS-->>QCR: Not paused
    QCR->>QCR: Validate Bitcoin addresses
    QCR->>QCR: Generate redemptionId
    QCR->>Bank: decreaseBalance(qc, amount)
    Bank-->>QCR: Success
    QCR->>QCR: Store redemption data
    QCR-->>QC: emit RedemptionInitiated(redemptionId)

    Note over QC,Arb: Fulfillment Path (Normal)
    W->>QCW: fulfillRedemption(redemptionId, btcTxHash)
    QCW->>SS: Check not paused
    SS-->>QCW: OK
    QCW->>QCR: fulfillRedemption(...)
    QCR->>QCR: Validate redemption pending
    QCR->>QCR: Update status to Fulfilled
    QCR-->>QCW: emit RedemptionFulfilled

    Note over QC,Arb: Default Path (Timeout)
    Note right of Arb: After 48 hours
    Arb->>QCR: defaultRedemption(redemptionId)
    QCR->>QCR: Check timeout exceeded
    QCR->>QCR: Update status to Defaulted
    QCR->>Bank: increaseBalance(qc, amount)
    Bank-->>QCR: Success
    QCR-->>Arb: emit RedemptionDefaulted
```

---

## 5. Consensus Voting Flow (M-of-N)

```mermaid
sequenceDiagram
    participant W1 as Watchdog 1
    participant W2 as Watchdog 2
    participant W3 as Watchdog 3
    participant WCM as WatchdogConsensusManager
    participant QCM as QCManager

    Note over W1,QCM: Proposal Creation
    W1->>WCM: proposeAction(StatusChange, data, reason)
    WCM->>WCM: Validate watchdog authorized
    WCM->>WCM: Create proposal
    WCM->>WCM: Auto-vote for proposer (1/5)
    WCM-->>W1: emit ProposalCreated(proposalId)

    Note over W1,QCM: Voting Phase (2 hour window)
    W2->>WCM: vote(proposalId, true)
    WCM->>WCM: Check not already voted
    WCM->>WCM: Check not expired
    WCM->>WCM: Record vote (2/5)
    WCM->>WCM: Check threshold (2 >= 2) ✓
    WCM->>WCM: Execute proposal
    
    Note over W1,QCM: Execution
    WCM->>QCM: deactivateQC(qcAddress)
    QCM->>QCM: Update QC status
    QCM-->>WCM: Success
    WCM-->>W2: emit ProposalExecuted

    Note over W1,QCM: Late vote rejected
    W3->>WCM: vote(proposalId, true)
    WCM->>WCM: Check already executed
    WCM-->>W3: revert "Already executed"
```

---

## 6. Emergency Detection and Response

```mermaid
sequenceDiagram
    participant W1 as Watchdog 1
    participant W2 as Watchdog 2
    participant W3 as Watchdog 3
    participant WM as WatchdogMonitor
    participant SS as SystemState
    participant EC as Emergency Council

    Note over W1,EC: Report Accumulation (1 hour window)
    W1->>WM: reportEmergency(watchdog1, "Suspicious activity")
    WM->>WM: Check reporter authorized
    WM->>WM: Record report (1/3)
    WM-->>W1: emit EmergencyReported

    W2->>WM: reportEmergency(watchdog2, "Confirmed breach")
    WM->>WM: Check not duplicate reporter
    WM->>WM: Check within time window
    WM->>WM: Record report (2/3)
    WM-->>W2: emit EmergencyReported

    W3->>WM: reportEmergency(watchdog3, "Critical issue")
    WM->>WM: Record report (3/3)
    WM->>WM: Threshold reached!
    
    Note over W1,EC: Automatic Emergency Response
    WM->>SS: pauseAll()
    SS->>SS: Set all pause flags
    SS-->>WM: emit AllPaused
    WM-->>W3: emit EmergencyTriggered(3)

    Note over W1,EC: Resolution
    EC->>SS: unpauseAll()
    SS->>SS: Clear pause flags
    SS-->>EC: emit AllUnpaused
```

---

## 7. V1.2 Automated Rule Enforcement

```mermaid
sequenceDiagram
    participant Sys as System Monitor
    participant WAE as WatchdogAutomatedEnforcement
    participant QCL as QCReserveLedger
    participant SS as SystemState
    participant WTA as WatchdogThresholdActions
    participant WDE as WatchdogDAOEscalation

    Note over Sys,WDE: Layer 1: Automated Check
    Sys->>WAE: checkReserveRatio(qc, 85, 95)
    WAE->>WAE: Load rule configuration
    WAE->>WAE: Evaluate: 85 < 95 ✗
    WAE->>SS: pauseMinting()
    SS-->>WAE: Success
    WAE-->>Sys: emit RuleTriggered
    WAE-->>Sys: emit AutomatedActionTaken

    Note over Sys,WDE: Complex Issue - Escalate to Layer 2
    WAE->>WAE: Detect pattern needing review
    WAE-->>WTA: emit EscalationRequired

    Note over Sys,WDE: Layer 2: Threshold Collection
    loop 3 Watchdog Reports
        Sys->>WTA: reportIssue(qc, "PATTERN", desc)
        WTA->>WTA: Record report
        WTA->>WTA: Check threshold
    end
    WTA->>WTA: Threshold reached (3/3)
    WTA-->>Sys: emit ThresholdReached

    Note over Sys,WDE: Layer 3: DAO Escalation
    WTA->>WTA: Issue too complex
    WTA-->>WDE: emit DAOEscalationRequired
    
    Sys->>WDE: escalateToDAO(qc, type, 9, desc, evidence)
    WDE->>WDE: Create escalation
    WDE-->>Sys: emit IssueEscalated
```

---

## 8. Cross-Contract State Synchronization

```mermaid
sequenceDiagram
    participant Gov as Governance
    participant QCM as QCManager
    participant QCL as QCReserveLedger
    participant QCR as QCRedeemer
    participant MP as MintingPolicy
    participant RP as RedemptionPolicy

    Note over Gov,RP: Service Registration
    Gov->>QCM: registerService("reserveLedger", QCL)
    QCM->>QCM: Store service address
    Gov->>QCM: registerService("redeemer", QCR)
    QCM->>QCM: Store service address

    Note over Gov,RP: QC Deactivation Propagation
    Gov->>QCM: deactivateQC(qcAddress)
    QCM->>QCM: Update QC status
    QCM-->>Gov: emit QCDeactivated

    Note over Gov,RP: Dependent Contract Checks
    MP->>QCM: isQCActive(qcAddress)
    QCM-->>MP: false
    MP-->>MP: Block minting operation

    RP->>QCM: isQCActive(qcAddress) 
    QCM-->>RP: false
    RP-->>RP: Block redemption operation

    QCL->>QCM: isQCActive(qcAddress)
    QCM-->>QCL: false
    QCL-->>QCL: Block new attestations
```

---

## 9. Byzantine Fault Scenario

```mermaid
sequenceDiagram
    participant BW as Byzantine Watchdog
    participant HW1 as Honest Watchdog 1
    participant HW2 as Honest Watchdog 2
    participant WCM as WatchdogConsensusManager
    participant QCM as QCManager

    Note over BW,QCM: Byzantine actor creates malicious proposal
    BW->>WCM: proposeAction(StatusChange, maliciousData, "Fake reason")
    WCM->>WCM: Create proposal
    WCM->>WCM: Byzantine auto-vote (1/5)
    WCM-->>BW: proposalId

    Note over BW,QCM: Honest watchdogs evaluate
    HW1->>WCM: vote(proposalId, false)
    WCM->>WCM: Record negative vote
    WCM->>WCM: voteCount still 1/5
    WCM-->>HW1: emit VoteCast

    HW2->>WCM: vote(proposalId, false)
    WCM->>WCM: Record negative vote
    WCM->>WCM: voteCount still 1/5
    WCM-->>HW2: emit VoteCast

    Note over BW,QCM: Voting period expires
    Note right of WCM: After 2 hours
    BW->>WCM: vote(proposalId, true)
    WCM->>WCM: Check expired
    WCM-->>BW: revert "Voting period ended"

    Note over BW,QCM: Proposal fails - system protected
```

---

## Key Design Patterns

### 1. NonReentrant Pattern
All state-changing functions that make external calls use the `nonReentrant` modifier to prevent reentrancy attacks.

### 2. Check-Effects-Interactions
State changes occur before external calls to prevent reentrancy vulnerabilities.

### 3. Access Control
Role-based permissions checked at the beginning of each function.

### 4. Pause Mechanism
SystemState pause checks integrated at critical points in all flows.

### 5. Time-Window Validation
Consistent pattern for time-based logic (redemption timeouts, voting periods, report windows).

### 6. Event Emission
Comprehensive event logging for all state changes and critical actions.

### 7. Fail-Safe Defaults
System defaults to secure state (paused, not authorized) in error conditions.

---

## Integration Testing Considerations

When testing these flows:

1. **Timing**: Use `hardhat` time manipulation to test time-dependent flows
2. **Permissions**: Test with unauthorized callers to verify access control
3. **State Dependencies**: Ensure proper setup (QC registered, wallets added, etc.)
4. **Edge Cases**: Test boundary conditions (exact thresholds, timeouts)
5. **Concurrency**: Test simultaneous operations to check for race conditions
6. **Byzantine Behavior**: Test with malicious actors to verify security