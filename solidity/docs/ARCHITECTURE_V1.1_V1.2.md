# V1.1/V1.2 Watchdog System Architecture

**Version**: 1.0  
**Date**: 2025-08-05  
**Status**: Final

---

## System Overview

The V1.1/V1.2 Watchdog system implements a dual-path architecture for institutional Qualified Custodian (QC) operations, with an optional automated decision framework.

```
┌─────────────────────────────────────────────────────────────────┐
│                        External Users                             │
└─────────────────────┬───────────────────┬───────────────────────┘
                      │                   │
                      ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    V1.1 Dual-Path System                          │
│  ┌─────────────────────┐        ┌──────────────────────────┐    │
│  │  Individual Path    │        │    Consensus Path        │    │
│  │      (90%)          │        │       (10%)              │    │
│  │                     │        │                          │    │
│  │  QCWatchdog ────────┼────────┼─► WatchdogConsensusManager│    │
│  │       │             │        │         │                │    │
│  │       ▼             │        │         ▼                │    │
│  │  Direct Execution   │        │    M-of-N Voting        │    │
│  └─────────────────────┘        └──────────────────────────┘    │
│                                                                   │
│  ┌─────────────────────┐                                         │
│  │  WatchdogMonitor    │ ◄─── Emergency Detection (3/hour)       │
│  └─────────────────────┘                                         │
└─────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Core QC Management Layer                          │
│  ┌──────────────┐  ┌─────────────────┐  ┌─────────────────┐    │
│  │  QCManager   │  │ QCReserveLedger │  │   QCRedeemer    │    │
│  └──────────────┘  └─────────────────┘  └─────────────────┘    │
│         │                   │                     │               │
│         ▼                   ▼                     ▼               │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                    SystemState                           │    │
│  │          (Pause Controls & Parameters)                   │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│               Policy & Integration Layer                          │
│  ┌────────────────────┐        ┌──────────────────────────┐     │
│  │ BasicMintingPolicy │        │ BasicRedemptionPolicy    │     │
│  └────────────────────┘        └──────────────────────────┘     │
│              │                              │                     │
│              ▼                              ▼                     │
│         ┌────────────────────────────────────────┐               │
│         │              Bank                      │               │
│         │    (TBTC Balance Management)           │               │
│         └────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

---

## V1.2 Automated Decision Framework (Optional)

```
┌─────────────────────────────────────────────────────────────────┐
│                 V1.2 Three-Layer Automation                       │
│                                                                   │
│  Layer 1: Deterministic Rules (90%+ automation)                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │        WatchdogAutomatedEnforcement                     │    │
│  │  • Reserve ratio monitoring                             │    │
│  │  • Redemption timeout handling                          │    │
│  │  • Attestation staleness checks                         │    │
│  │  • Automated pause/unpause actions                      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                          │                                        │
│                          ▼ Escalate if needed                     │
│  Layer 2: Threshold-Based Actions (Human oversight)              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │         WatchdogThresholdActions                        │    │
│  │  • 3+ reports trigger action                            │    │
│  │  • Time-windowed report aggregation                     │    │
│  │  • Configurable thresholds per issue type              │    │
│  │  • Semi-automated responses                             │    │
│  └─────────────────────────────────────────────────────────┘    │
│                          │                                        │
│                          ▼ Escalate complex issues                │
│  Layer 3: DAO Governance (Complex decisions)                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │          WatchdogDAOEscalation                          │    │
│  │  • Severity-based escalation                            │    │
│  │  • DAO proposal creation                                │    │
│  │  • Resolution tracking                                  │    │
│  │  • Enforcement coordination                             │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Relationships

### Core Components

```
QCManager
    ├── Manages QC lifecycle (registration, activation, deactivation)
    ├── Stores QC metadata and wallet information
    ├── Validates SPV proofs for Bitcoin wallets
    └── Integrations:
        ├── QCReserveLedger (reserve tracking)
        ├── QCRedeemer (redemption handling)
        └── SystemState (pause checks)

QCReserveLedger
    ├── Tracks reserve attestations with timestamps
    ├── Implements staleness checking (7-day default)
    ├── Maintains historical attestation data
    └── Used by:
        ├── QCWatchdog (attestation submission)
        └── Policies (reserve validation)

QCRedeemer
    ├── Two-step redemption process
    ├── 48-hour fulfillment window
    ├── Default handling for timeouts
    └── Integrations:
        ├── Bank (balance updates)
        └── SystemState (pause checks)

SystemState
    ├── Granular pause controls
    ├── Parameter management
    └── Used by all contracts for pause checks
```

### Watchdog Components

```
QCWatchdog (Individual Operations - 90%)
    ├── Single WATCHDOG_OPERATOR_ROLE
    ├── Direct execution path
    └── Operations:
        ├── attestReserves()
        ├── registerQCWallet()
        └── fulfillRedemption()

WatchdogConsensusManager (Authority Decisions - 10%)
    ├── M-of-N voting (default 2-of-5)
    ├── 2-hour voting periods
    └── Proposal Types:
        ├── StatusChange (QC activation/deactivation)
        ├── RedemptionDefault (force defaults)
        ├── ForceIntervention (emergency actions)
        └── ParameterChange (system parameters)

WatchdogMonitor
    ├── Tracks all watchdog instances
    ├── Emergency detection (3 reports/hour)
    ├── Automatic system pause on emergency
    └── Coordinates multiple QCWatchdog instances
```

---

## Data Flow Diagrams

### 1. Reserve Attestation Flow

```
Watchdog                QCWatchdog              QCReserveLedger         SystemState
   │                         │                          │                    │
   ├─attestReserves(qc,amt)─►│                          │                    │
   │                         ├─checkNotPaused()────────►│                    │
   │                         │◄─────────OK──────────────┤                    │
   │                         │                          │                    │
   │                         ├─attestReserves(qc,amt)──►│                    │
   │                         │                          ├─validateQC()       │
   │                         │                          ├─updateReserves()   │
   │                         │                          ├─emit event         │
   │                         │◄─────────Success─────────┤                    │
   │◄────────Success─────────┤                          │                    │
```

### 2. Consensus Voting Flow

```
Watchdog1          WatchdogConsensusManager          QCManager           Watchdog2
   │                         │                           │                    │
   ├─proposeAction(data)────►│                           │                    │
   │                         ├─createProposal()          │                    │
   │                         ├─autoVoteForProposer()     │                    │
   │                         ├─emit ProposalCreated      │                    │
   │◄───proposalId───────────┤                           │                    │
   │                         │                           │                    │
   │                         │◄────vote(proposalId)──────┼────────────────────┤
   │                         ├─validateVoter()           │                    │
   │                         ├─recordVote()              │                    │
   │                         ├─checkThreshold()          │                    │
   │                         ├─executeAction()──────────►│                    │
   │                         │◄────────Success───────────┤                    │
   │                         ├─emit ProposalExecuted     │                    │
```

### 3. Emergency Detection Flow

```
Watchdog1      Watchdog2      Watchdog3      WatchdogMonitor      SystemState
   │              │              │                  │                   │
   ├─report()────►│              │                  │                   │
   │              │              │                  ├─record(1/3)       │
   │              │              │                  │                   │
   │              ├─report()────►│                  │                   │
   │              │              │                  ├─record(2/3)       │
   │              │              │                  │                   │
   │              │              ├─report()────────►│                   │
   │              │              │                  ├─record(3/3)       │
   │              │              │                  ├─triggerEmergency()│
   │              │              │                  ├─pauseAll()───────►│
   │              │              │                  │◄───────OK─────────┤
   │              │              │                  ├─emit Emergency    │
```

---

## Security Architecture

### Access Control Hierarchy

```
DEFAULT_ADMIN_ROLE (Governance)
    │
    ├── PARAMETER_ADMIN_ROLE
    │   └── Parameter updates
    │
    ├── MANAGER_ROLE
    │   ├── QC registration
    │   ├── Watchdog management
    │   └── Service configuration
    │
    ├── PAUSER_ROLE
    │   └── Emergency pause operations
    │
    ├── WATCHDOG_OPERATOR_ROLE
    │   └── Individual watchdog operations
    │
    └── WATCHDOG_ROLE
        └── Consensus participation
```

### Trust Boundaries

```
┌─────────────────────────────────────┐
│         Untrusted Zone              │
│   • External Users                  │
│   • Bitcoin Network                 │
└───────────────┬─────────────────────┘
                │ SPV Proofs
┌───────────────▼─────────────────────┐
│      Semi-Trusted Zone              │
│   • Qualified Custodians            │
│   • Individual Watchdogs            │
└───────────────┬─────────────────────┘
                │ Attestations
┌───────────────▼─────────────────────┐
│        Trusted Zone                 │
│   • Consensus Watchdogs             │
│   • Governance/DAO                  │
│   • Core Contracts                  │
└─────────────────────────────────────┘
```

---

## Deployment Architecture

### V1.1 Only Deployment

```
Deployment Scripts 95-99
    │
    ├── 95_deploy_account_control_core
    │   ├── QCManager
    │   ├── QCData library
    │   └── SPVValidator
    │
    ├── 96_deploy_account_control_state
    │   ├── SystemState
    │   ├── QCReserveLedger
    │   └── QCRedeemer
    │
    ├── 97_deploy_account_control_policies
    │   ├── BasicMintingPolicy
    │   └── BasicRedemptionPolicy
    │
    ├── 98_deploy_account_control_watchdog
    │   ├── WatchdogMonitor
    │   └── WatchdogConsensusManager
    │
    └── 99_configure_account_control_system
        ├── Service registrations
        ├── Role assignments
        └── Initial parameters
```

### V1.1 + V1.2 Full Deployment

```
Additional Scripts 100-101
    │
    ├── 100_deploy_automated_decision_framework
    │   ├── WatchdogAutomatedEnforcement
    │   ├── WatchdogThresholdActions
    │   └── WatchdogDAOEscalation
    │
    └── 101_configure_automated_decision_framework
        ├── Rule configurations
        ├── Threshold settings
        ├── Integration setup
        └── DAO role grants
```

---

## Gas Optimization Architecture

### Old Architecture (OptimisticWatchdogConsensus)
```
Every Operation:
User → Adapter → Consensus Layer → Challenge Period → Execution
        (50k)      (100k)            (80k)           (70k)
                        Total: ~300k gas
```

### New Architecture (Dual-Path)
```
Individual (90%):
User → QCWatchdog → Direct Execution
        (30k)          (120k)
                Total: ~150k gas (50% savings)

Consensus (10%):
User → ConsensusManager → Voting → Auto-execution
         (40k)           (80k)      (45k)
                Total: ~165k gas (45% savings)
```

---

## Integration Points

### External Dependencies
- **Bank**: TBTC balance management
- **TBTCVault**: Minting interface
- **Bridge**: Bitcoin verification
- **LightRelay**: SPV proof validation

### Internal Integrations
- All contracts integrate with SystemState for pause checks
- Policies integrate with QCReserveLedger for validations
- QCWatchdog integrates with all QC management contracts
- V1.2 contracts integrate with V1.1 core when deployed

---

## Upgrade Paths

### V1.1 → V1.1 + V1.2
1. Deploy V1.2 contracts (scripts 100-101)
2. Configure V1.2 integrations
3. No changes to V1.1 contracts required
4. Enable V1.2 features selectively

### Future Enhancements
- Policy contracts upgradeable via registration
- Service contracts swappable via QCManager
- Parameter updates via governance
- New watchdog types can be added

---

## Conclusion

The V1.1/V1.2 architecture provides a robust, efficient, and flexible system for institutional Bitcoin custody operations. The dual-path design optimizes for the common case (90% individual operations) while maintaining security through consensus for critical decisions. The optional V1.2 framework adds automation capabilities without disrupting the core V1.1 functionality.