# Contract Interfaces: V1.1/V1.2 Watchdog System

**Version**: 1.0  
**Date**: 2025-08-05

---

## Core Contracts

### ISystemState

```solidity
interface ISystemState {
    // Events
    event AllPaused(address indexed pauser);
    event AllUnpaused(address indexed pauser);
    event RegistrationsPaused(address indexed pauser);
    event RegistrationsUnpaused(address indexed pauser);
    event AttestationsPaused(address indexed pauser);
    event AttestationsUnpaused(address indexed pauser);
    event MintingPaused(address indexed pauser);
    event MintingUnpaused(address indexed pauser);
    event RedemptionsPaused(address indexed pauser);
    event RedemptionsUnpaused(address indexed pauser);
    event ParameterUpdated(string parameter, uint256 oldValue, uint256 newValue);

    // Pause state getters
    function allPaused() external view returns (bool);
    function registrationsPaused() external view returns (bool);
    function attestationsPaused() external view returns (bool);
    function mintingPaused() external view returns (bool);
    function redemptionsPaused() external view returns (bool);

    // Pause operations (PAUSER_ROLE required)
    function pauseAll() external;
    function unpauseAll() external;
    function pauseRegistrations() external;
    function unpauseRegistrations() external;
    function pauseAttestations() external;
    function unpauseAttestations() external;
    function pauseMinting() external;
    function unpauseMinting() external;
    function pauseRedemptions() external;
    function unpauseRedemptions() external;

    // Parameter management (PARAMETER_ADMIN_ROLE required)
    function updateParameter(string calldata parameter, uint256 value) external;
    function getParameter(string calldata parameter) external view returns (uint256);
}
```

### IQCManager

```solidity
interface IQCManager {
    // Structs
    struct QCData {
        string name;
        bool isActive;
        uint256 registeredAt;
        uint256 deactivatedAt;
    }

    struct WalletData {
        string btcAddress;
        bool isActive;
        uint256 registeredAt;
    }

    // Events
    event QCRegistered(address indexed qc, string name);
    event QCDeactivated(address indexed qc);
    event QCReactivated(address indexed qc);
    event WalletRegistered(address indexed qc, bytes20 indexed walletPubKey, string btcAddress);
    event WalletDeactivated(address indexed qc, bytes20 indexed walletPubKey);
    event ServiceRegistered(string service, address serviceAddress);

    // QC Management (MANAGER_ROLE required)
    function registerQC(address qc, string calldata name) external;
    function deactivateQC(address qc) external;
    function reactivateQC(address qc) external;

    // Wallet Management
    function registerQCWallet(
        address qc,
        bytes20 walletPubKey,
        string calldata btcAddress,
        bytes calldata spvProof
    ) external;
    function deactivateQCWallet(address qc, bytes20 walletPubKey) external;

    // Service Registration (MANAGER_ROLE required)
    function registerService(string calldata serviceName, address serviceAddress) external;

    // Getters
    function qcs(address qc) external view returns (QCData memory);
    function qcWallets(address qc, bytes20 walletPubKey) external view returns (WalletData memory);
    function isQCActive(address qc) external view returns (bool);
    function isWalletRegistered(address qc, bytes20 walletPubKey) external view returns (bool);
    function reserveLedger() external view returns (address);
    function redeemer() external view returns (address);
}
```

### IQCReserveLedger

```solidity
interface IQCReserveLedger {
    // Structs
    struct Attestation {
        uint256 reserves;
        uint256 timestamp;
        address attester;
    }

    // Events
    event ReservesAttested(address indexed qc, uint256 reserves);
    event StalenessUpdated(uint256 oldPeriod, uint256 newPeriod);

    // Attestation
    function attestReserves(address qc, uint256 reserves) external;

    // Getters
    function getCurrentReserves(address qc) external view returns (uint256);
    function getLastAttestation(address qc) external view returns (Attestation memory);
    function isAttestationStale(address qc) external view returns (bool);
    function stalenessPeriod() external view returns (uint256);

    // Configuration (PARAMETER_ADMIN_ROLE required)
    function updateStalenessPeriod(uint256 newPeriod) external;
}
```

### IQCRedeemer

```solidity
interface IQCRedeemer {
    // Enums
    enum RedemptionStatus { Pending, Processing, Fulfilled, Defaulted, Cancelled }

    // Structs
    struct Redemption {
        address redeemer;
        uint256 amount;
        string btcAddress;
        string userBtcAddress;
        RedemptionStatus status;
        uint256 initiatedAt;
        uint256 fulfilledAt;
        bytes32 btcTxHash;
    }

    // Events
    event RedemptionInitiated(
        bytes32 indexed redemptionId,
        address indexed redeemer,
        uint256 amount,
        string btcAddress
    );
    event RedemptionFulfilled(bytes32 indexed redemptionId, bytes32 btcTxHash);
    event RedemptionDefaulted(bytes32 indexed redemptionId);
    event RedemptionCancelled(bytes32 indexed redemptionId);

    // Redemption lifecycle
    function initiateRedemption(
        uint256 amount,
        string calldata btcAddress,
        string calldata userBtcAddress
    ) external returns (bytes32);
    
    function fulfillRedemption(bytes32 redemptionId, bytes32 btcTxHash) external;
    function defaultRedemption(bytes32 redemptionId) external;
    function cancelRedemption(bytes32 redemptionId) external;

    // Getters
    function redemptions(bytes32 redemptionId) external view returns (Redemption memory);
    function redemptionTimeout() external view returns (uint256);
    function currentRedemptionId() external view returns (bytes32);
}
```

---

## Watchdog Contracts

### IQCWatchdog

```solidity
interface IQCWatchdog {
    // Events
    event ReservesAttested(address indexed qc, uint256 reserves);
    event WalletRegistered(address indexed qc, bytes20 walletPubKey);
    event RedemptionFulfilled(bytes32 indexed redemptionId);

    // Operations (WATCHDOG_OPERATOR_ROLE required)
    function attestReserves(address qc, uint256 reserves) external;
    
    function registerQCWallet(
        address qc,
        bytes20 walletPubKey,
        string calldata btcAddress,
        bytes calldata spvProof
    ) external;
    
    function fulfillRedemption(bytes32 redemptionId, bytes32 btcTxHash) external;

    // Getters
    function qcManager() external view returns (address);
    function reserveLedger() external view returns (address);
    function redeemer() external view returns (address);
    function systemState() external view returns (address);
}
```

### IWatchdogConsensusManager

```solidity
interface IWatchdogConsensusManager {
    // Enums
    enum ProposalType { StatusChange, RedemptionDefault, ForceIntervention, ParameterChange }

    // Structs
    struct Proposal {
        ProposalType proposalType;
        bytes data;
        string reason;
        address proposer;
        uint256 voteCount;
        uint256 createdAt;
        uint256 expiresAt;
        bool executed;
        mapping(address => bool) hasVoted;
    }

    // Events
    event ProposalCreated(
        bytes32 indexed proposalId,
        ProposalType proposalType,
        address proposer,
        string reason
    );
    event VoteCast(bytes32 indexed proposalId, address voter, bool support);
    event ProposalExecuted(bytes32 indexed proposalId);
    event WatchdogAdded(address watchdog);
    event WatchdogRemoved(address watchdog);
    event ConsensusThresholdUpdated(ProposalType proposalType, uint256 threshold);

    // Proposal management
    function proposeAction(
        ProposalType proposalType,
        bytes calldata data,
        string calldata reason
    ) external returns (bytes32);
    
    function vote(bytes32 proposalId, bool support) external;

    // Watchdog management (MANAGER_ROLE required)
    function addWatchdog(address watchdog) external;
    function removeWatchdog(address watchdog) external;
    function updateConsensusThreshold(ProposalType proposalType, uint256 threshold) external;

    // Getters
    function proposals(bytes32 proposalId) external view returns (
        ProposalType proposalType,
        bytes data,
        string memory reason,
        address proposer,
        uint256 voteCount,
        uint256 createdAt,
        uint256 expiresAt,
        bool executed
    );
    function isAuthorizedWatchdog(address watchdog) external view returns (bool);
    function consensusThreshold(ProposalType proposalType) external view returns (uint256);
    function votingPeriod() external view returns (uint256);
}
```

### IWatchdogMonitor

```solidity
interface IWatchdogMonitor {
    // Events
    event WatchdogRegistered(address indexed watchdog, string name);
    event WatchdogRemoved(address indexed watchdog);
    event EmergencyReported(address indexed watchdog, address reporter, string issue);
    event EmergencyTriggered(uint256 reportCount);

    // Watchdog management (MANAGER_ROLE required)
    function registerWatchdog(address watchdog, string calldata name) external;
    function removeWatchdog(address watchdog) external;

    // Emergency reporting
    function reportEmergency(address watchdog, string calldata issue) external;

    // Getters
    function registeredWatchdogs(uint256 index) external view returns (address);
    function watchdogCount() external view returns (uint256);
    function emergencyCount() external view returns (uint256);
    function EMERGENCY_THRESHOLD() external view returns (uint256);
    function REPORT_WINDOW() external view returns (uint256);
}
```

---

## Policy Contracts

### IBasicMintingPolicy

```solidity
interface IBasicMintingPolicy {
    // Events
    event MintExecuted(address indexed qc, uint256 amount, address recipient);
    event CapacityUpdated(address indexed qc, uint256 oldCapacity, uint256 newCapacity);

    // Minting operations
    function executeMint(
        address qc,
        uint256 amount,
        address recipient
    ) external;

    // Configuration (MANAGER_ROLE required)
    function updateQCCapacity(address qc, uint256 capacity) external;

    // Getters
    function canMint(address qc, uint256 amount) external view returns (bool);
    function qcCapacities(address qc) external view returns (uint256 capacity, uint256 used);
    function reserveRatioThreshold() external view returns (uint256);
}
```

### IBasicRedemptionPolicy

```solidity
interface IBasicRedemptionPolicy {
    // Events
    event RedemptionExecuted(bytes32 indexed redemptionId, uint256 amount);
    event MinimumUpdated(uint256 oldMinimum, uint256 newMinimum);
    event MaximumUpdated(uint256 oldMaximum, uint256 newMaximum);

    // Redemption operations
    function executeRedemption(bytes32 redemptionId) external;

    // Configuration (PARAMETER_ADMIN_ROLE required)
    function updateMinimumRedemption(uint256 minimum) external;
    function updateMaximumRedemption(uint256 maximum) external;

    // Getters
    function canRedeem(address qc, uint256 amount) external view returns (bool);
    function minimumRedemption() external view returns (uint256);
    function maximumRedemption() external view returns (uint256);
}
```

---

## V1.2 Automated Framework Contracts

### IWatchdogAutomatedEnforcement

```solidity
interface IWatchdogAutomatedEnforcement {
    // Enums
    enum RuleType { ReserveRatio, RedemptionTimeout, AttestationStaleness, AnomalyDetection }
    enum ActionType { PauseMinting, PauseQC, DefaultRedemption, Alert }

    // Structs
    struct Rule {
        bool enabled;
        bytes parameters;
        ActionType action;
    }

    // Events
    event RuleConfigured(RuleType ruleType, bool enabled, bytes parameters);
    event RuleTriggered(RuleType ruleType, address qc, string reason);
    event AutomatedActionTaken(address qc, string action, string reason);
    event EscalationRequired(address qc, string toLayer, string reason);

    // Rule configuration (MANAGER_ROLE required)
    function configureRule(
        RuleType ruleType,
        bool enabled,
        bytes calldata parameters
    ) external;

    // Automated checks
    function checkReserveRatio(address qc, uint256 currentRatio, uint256 requiredRatio) external;
    function checkRedemptionTimeout(bytes32 redemptionId) external;
    function checkAttestationStaleness(address qc, uint256 lastAttestation) external;
    function detectAnomaly(address qc, uint256 metric, string calldata description) external;

    // Batch operations
    function batchCheckCompliance(address qc) external returns (bytes memory violations);

    // Getters
    function rules(RuleType ruleType) external view returns (Rule memory);
    function getActionHistory(address qc) external view returns (bytes memory);
}
```

### IWatchdogThresholdActions

```solidity
interface IWatchdogThresholdActions {
    // Structs
    struct ThresholdConfig {
        uint256 threshold;
        uint256 timeWindow;
        uint256 actionType;
    }

    struct Report {
        address reporter;
        uint256 timestamp;
        string description;
    }

    // Events
    event IssueReported(address indexed qc, string issueType, address reporter);
    event ThresholdReached(address indexed qc, string issueType, uint256 count);
    event ActionExecuted(address indexed qc, uint256 actionType, string reason);
    event DAOEscalationRequired(address qc, string issueType, string reason);
    event ThresholdConfigured(string issueType, uint256 threshold, uint256 window, uint256 action);

    // Reporting
    function reportIssue(
        address qc,
        string calldata issueType,
        string calldata description
    ) external;

    // Configuration (MANAGER_ROLE required)
    function configureThreshold(
        string calldata issueType,
        uint256 threshold,
        uint256 timeWindow,
        uint256 actionType
    ) external;

    // Getters
    function getReportCount(address qc, string calldata issueType) external view returns (uint256);
    function getWalletStatus(address qc) external view returns (bool isPaused, string memory reason);
    function getReportHistory(address qc) external view returns (Report[] memory);
}
```

### IWatchdogDAOEscalation

```solidity
interface IWatchdogDAOEscalation {
    // Enums
    enum ResolutionType { None, Warning, ImposeCconditions, TerminateQC, CustomAction }

    // Structs
    struct Escalation {
        address qc;
        string issueType;
        address escalator;
        uint256 severity;
        string description;
        bytes evidence;
        uint256 timestamp;
        bool resolved;
        ResolutionType resolutionType;
        string resolutionReason;
    }

    // Events
    event IssueEscalated(
        address indexed qc,
        string issueType,
        address escalator,
        uint256 severity
    );
    event EscalationResolved(
        uint256 indexed escalationId,
        ResolutionType resolution,
        string reason
    );

    // Escalation
    function escalateToDAO(
        address qc,
        string calldata issueType,
        uint256 severity,
        string calldata description,
        bytes calldata evidence
    ) external returns (uint256);

    // Resolution (DAO_ROLE required)
    function resolveEscalation(
        uint256 escalationId,
        ResolutionType resolution,
        string calldata reasoning,
        bytes calldata data
    ) external;

    // Getters
    function escalations(uint256 id) external view returns (Escalation memory);
    function getActiveEscalations() external view returns (Escalation[] memory);
    function getQCEscalations(address qc) external view returns (Escalation[] memory);
}
```

---

## Integration Interfaces

### ISPVValidator

```solidity
interface ISPVValidator {
    function validateSPVProof(
        bytes memory txBytes,
        uint256 txIndex,
        bytes memory siblings,
        bytes memory blockHeader,
        uint256 blockHeight
    ) external view returns (bool);
}
```

### IBitcoinAddressUtils

```solidity
library BitcoinAddressUtils {
    function isValidBitcoinAddress(string memory addr) internal pure returns (bool);
    function isP2PKH(string memory addr) internal pure returns (bool);
    function isP2SH(string memory addr) internal pure returns (bool);
    function isBech32(string memory addr) internal pure returns (bool);
}
```

---

## Usage Examples

### Minting Flow
```solidity
// 1. Watchdog attests reserves
qcWatchdog.attestReserves(qcAddress, reserveAmount);

// 2. Policy validates and executes mint
mintingPolicy.executeMint(qcAddress, mintAmount, recipient);
```

### Redemption Flow
```solidity
// 1. User initiates redemption
bytes32 redemptionId = qcRedeemer.initiateRedemption(amount, btcAddress, userBtcAddress);

// 2. Watchdog fulfills redemption
qcWatchdog.fulfillRedemption(redemptionId, btcTxHash);
```

### Consensus Operation
```solidity
// 1. Propose action
bytes32 proposalId = consensusManager.proposeAction(
    ProposalType.StatusChange,
    abi.encode(qcAddress, false),
    "Deactivate QC for violations"
);

// 2. Other watchdogs vote
consensusManager.vote(proposalId, true);
// Auto-executes when threshold reached
```

---

## Error Messages

Common revert messages across contracts:
- `"Unauthorized"` - Caller lacks required role
- `"System paused"` - Operation blocked by pause state
- `"Invalid address"` - Zero address provided
- `"Already registered"` - Duplicate registration attempt
- `"Not found"` - Entity doesn't exist
- `"Invalid state"` - Operation not allowed in current state
- `"Timeout exceeded"` - Time-based deadline passed
- `"Threshold not met"` - Insufficient votes/reports
- `"Already voted"` - Duplicate vote attempt
- `"Insufficient balance"` - Not enough funds