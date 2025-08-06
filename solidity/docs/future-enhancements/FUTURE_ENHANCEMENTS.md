# Account Control Future Enhancements

**Document Version**: 1.0  
**Date**: 2025-08-06  
**Architecture**: Direct Bank Integration  
**Purpose**: V2 roadmap and enhancement planning for Account Control system  
**Related Documents**: [README.md](README.md), [ARCHITECTURE.md](ARCHITECTURE.md), [REQUIREMENTS.md](REQUIREMENTS.md)

---

## Overview

This document outlines potential future enhancements to the Account Control system, including both direct Bank integration improvements and broader protocol evolution. These ideas were considered during design but not implemented in the initial version. They are preserved for future consideration as the protocol evolves and new use cases emerge.

## Core Architecture Principles (Maintained)

The following architectural principles guide all enhancement ideas:

✅ **Modular Contract System**: ProtocolRegistry enables individual component upgrades  
✅ **Policy-Driven Evolution**: Core contracts delegate to upgradeable Policy contracts  
✅ **Simplified Watchdog Architecture**: 4-contract system with clear separation of concerns  
✅ **Data/Logic Separation**: QCData.sol (storage) vs QCManager.sol (stateless logic)  
✅ **Unified Reserve Management**: Single ReserveLedger contract with atomic consensus+storage  
✅ **Simple State Models**: 3-state QC model (Active, UnderReview, Revoked)  
✅ **Independent Deployment**: New contract suite without modifying existing tBTC v2

## 1. Protocol Registry and Core Infrastructure

### 1.1 Service Versioning Support

**Enhancement**: Add versioning to services to enable parallel policy testing

```solidity
contract ProtocolRegistry {
  // Current implementation
  mapping(bytes32 => address) public services;

  // Enhanced with versioning
  mapping(bytes32 => mapping(uint256 => address)) public versionedServices;
  mapping(bytes32 => uint256) public currentVersions;

  function setServiceVersion(
    bytes32 serviceId,
    uint256 version,
    address serviceAddress
  ) external;

  function activateServiceVersion(bytes32 serviceId, uint256 version) external;
}

```

**Benefits**:

- Enables blue-green policy deployments
- Allows testing V2 policies alongside V1 without disruption
- Maintains backward compatibility

### 1.2 Service Health Checking

**Enhancement**: Add health check interface for registered services

```solidity
interface IHealthCheckable {
  function healthCheck()
    external
    view
    returns (bool isHealthy, string memory status);
}

// In ProtocolRegistry
function getServiceHealth(bytes32 serviceId)
  external
  view
  returns (bool, string memory);

```

**Benefits**:

- Early detection of policy contract issues
- Automated monitoring integration
- Graceful degradation capabilities

## 2. Enhanced Minting Strategies

### 2.1 Minting Strategy Enum

Replace the simple `autoMint` boolean with a more flexible enum:

```solidity
enum MintingStrategy {
  AutoMint, // Current behavior when autoMint = true
  BankOnly, // Current behavior when autoMint = false
  DeferredMint, // Create balance with scheduled mint
  ConditionalMint // Mint only if conditions are met
}

function creditQCBackedDeposit(
  address user,
  uint256 amount,
  address qc,
  bytes32 mintId,
  MintingStrategy strategy,
  bytes calldata strategyData // Additional parameters for complex strategies
) external;

```

**Use Cases:**

- **DeferredMint**: Schedule minting for specific time or block
- **ConditionalMint**: Mint only if gas price below threshold or other conditions

### 2.2 Batch Operations Support

Enable QCs to process multiple deposits in a single transaction:

```solidity
struct CreditRequest {
  address user;
  uint256 amount;
  bytes32 mintId;
  bool autoMint;
}

function batchCreditQCBackedDeposits(
  address qc,
  CreditRequest[] calldata requests
) external onlyRole(MINTER_ROLE) nonReentrant;

```

**Benefits:**

- Gas optimization for high-volume QCs
- Atomic processing of related deposits
- Simplified accounting for institutional users

### 2.3 Strategic Attestation Cost Optimization

**Status**: ✅ **IMPLEMENTED** - Multi-attester consensus with batch optimization built into ReserveLedger

**Current Implementation**: The unified ReserveLedger contract already provides:
- Multi-attester consensus mechanism (3+ attesters)
- Atomic attestation submission and consensus calculation
- Efficient storage patterns for multiple QC updates

**Additional Enhancement**: Further batch optimization for cross-QC attestations

```solidity
contract ReserveLedger {
  function submitBatchAttestations(
    address[] calldata qcs,
    uint256[] calldata balances
  ) external onlyRole(ATTESTER_ROLE) {
    require(qcs.length == balances.length, "Array length mismatch");
    
    for (uint256 i = 0; i < qcs.length; i++) {
      submitAttestation(qcs[i], balances[i]);
    }
  }
}
```

**Benefits**:
- ✅ Already achieved: Multi-attester consensus reduces single points of failure
- ✅ Already achieved: Atomic operations reduce gas costs
- Future: Cross-QC batch operations for further optimization

## 3. Storage and Performance Optimizations

### 3.1 Gas-Optimized Storage Layout

**Enhancement**: Pack QC data into minimal storage slots

```solidity
struct Custodian {
  // Slot 1: Status (1 byte) + maxMintingCapacity (11 bytes) + currentMinted (11 bytes) + flags (1 byte) = 24 bytes
  QCStatus status; // 1 byte (0-2)
  uint88 maxCapacity; // 11 bytes (enough for 2^88 satoshis = ~3B BTC)
  uint88 currentMinted; // 11 bytes
  bool isPaused; // 1 byte
  // 8 bytes remaining in slot 1

  // Slot 2: Timestamps
  uint128 registeredAt; // 16 bytes (sufficient until year 10^10)
  uint128 lastUpdated; // 16 bytes
  // Slot 3: String storage (separate for variable length)
  string name;
}

```

**Benefits**:

- Reduces storage costs by ~40%
- Faster reads/writes for QC data
- Better cache locality

### 3.2 Event Indexing Strategy

**Enhancement**: Optimize event parameters for monitoring queries

```solidity
// Current
event QCStatusChanged(address indexed qc, QCStatus oldStatus, QCStatus newStatus, bytes32 reason);

// Enhanced for monitoring
event QCStatusChanged(
    address indexed qc,
    uint8 indexed oldStatus,      // Indexed for filtering
    uint8 indexed newStatus,      // Indexed for filtering
    uint256 timestamp,            // Block timestamp for easier querying
    bytes32 reason
);
```

**Benefits**:

- Faster event filtering for monitoring
- Better support for time-based queries
- Improved analytics capabilities

### 3.3 State Diff Compression

**Enhancement**: Only store state changes rather than full state

```solidity
contract QCDataDiff {
  struct StatusChange {
    uint256 blockNumber;
    QCStatus status;
    bytes32 reason;
  }

  mapping(address => StatusChange[]) public statusHistory;

  function getCurrentStatus(address qc) external view returns (QCStatus) {
    StatusChange[] memory history = statusHistory[qc];
    return
      history.length > 0 ? history[history.length - 1].status : QCStatus.Active;
  }
}

```

**Benefits**:

- Reduces storage costs for frequently changing state
- Maintains historical audit trail
- Better for governance analysis

## 4. Advanced DeFi Integration Features

### 4.1 Liquidity Provision Protocols

Enable QCs to provide liquidity without immediate minting:

```solidity
interface ILiquidityProvider {
  function provideLiquidity(
    address qc,
    uint256 bankBalance,
    uint256 minReturn
  ) external returns (uint256 lpTokens);
}

```

**Scenario Flow:**

1. QC creates Bank balance (no auto-mint)
2. DeFi protocol uses Bank balance as collateral
3. Protocol mints tBTC only for liquidations
4. QC maintains tax-efficient structure

### 4.2 Structured Products Integration

Support for derivatives and structured products:

```solidity
interface IStructuredProduct {
  function createOption(
    address underlying, // Bank balance holder
    uint256 amount,
    uint256 strike,
    uint256 expiry
  ) external returns (uint256 optionId);
}

```

**Use Cases:**

- Options on QC reserves
- Yield-bearing Bank balance products
- Insurance products for QC defaults

### 4.3 Flash Loan Support

Enable flash loans of Bank balances:

```solidity
interface IFlashLoanReceiver {
  function executeOperation(
    uint256 amount,
    uint256 fee,
    bytes calldata params
  ) external;
}

function flashLoanBankBalance(
  uint256 amount,
  IFlashLoanReceiver receiver,
  bytes calldata params
) external nonReentrant;

```

**Benefits:**

- Arbitrage opportunities
- Capital efficiency
- Composability with other protocols

## 5. Enhanced Security Features

### 5.1 Cryptographic Proof-of-Reserves

Replace trust-based attestations with cryptographic proofs:

```solidity
struct ReserveProof {
  bytes32 merkleRoot; // Root of UTXO set
  bytes[] inclusionProofs; // Proofs for QC's UTXOs
  uint256 totalReserves;
  uint256 timestamp;
  bytes signature; // QC's signature
}

function submitCryptographicReserveProof(
  address qc,
  ReserveProof calldata proof
) external;

```

### 5.2 Emergency Pause Granularity

**Enhancement**: More granular pause controls as specified in Account Control design

```solidity
contract SystemState {
  mapping(bytes32 => bool) public paused;

  bytes32 public constant MINTING_PAUSED = keccak256("MINTING_PAUSED");
  bytes32 public constant REDEMPTION_PAUSED = keccak256("REDEMPTION_PAUSED");
  bytes32 public constant REGISTRATION_PAUSED =
    keccak256("REGISTRATION_PAUSED");

  function pauseFunction(bytes32 functionId) external onlyRole(PAUSER_ROLE);

  function unpauseFunction(bytes32 functionId) external onlyRole(PAUSER_ROLE);

  modifier whenNotPaused(bytes32 functionId) {
    require(!paused[functionId], "Function paused");
    _;
  }
}

```

**Benefits**:

- Surgical response to specific threats
- Minimizes disruption during emergencies
- Better crisis management

### 5.3 Enhanced Time-Locked Governance

**Current Status**: ✅ Basic time-locked governance implemented with 7-day delays for critical actions

**Enhancement**: Extended role-based access with additional time delays for sensitive operations

```solidity
contract EnhancedTimelockAccessControl is AccessControl {
  struct PendingRoleChange {
    address account;
    bytes32 role;
    bool isGrant;
    uint256 executeAfter;
  }

  mapping(bytes32 => PendingRoleChange) public pendingChanges;
  uint256 public constant ROLE_CHANGE_DELAY = 24 hours;

  function proposeRoleChange(
    address account,
    bytes32 role,
    bool isGrant
  ) external;

  function executeRoleChange(bytes32 changeId) external;
}

```

**Benefits** (Additional to existing time-locked governance):

- Extends time-lock coverage to role management changes
- Provides transparency for administrative governance changes beyond QC operations
- Reduces insider threat risks for role assignments

### 5.4 Multi-Sig Integration

Support for multi-signature operations:

```solidity
struct MultiSigRequest {
  address[] signers;
  uint256 requiredSignatures;
  bytes32 operationHash;
  uint256 deadline;
}

function initiateMultiSigDeposit(
  MultiSigRequest calldata request,
  uint256 amount
) external;

```

## 6. Watchdog System Status

### 6.1 Current Implementation

**Status**: ✅ **IMPLEMENTED** - Simplified 4-contract watchdog system

**Current Architecture**:
- **ReserveLedger**: Multi-attester consensus (replaces single watchdog model)
- **WatchdogReporting**: Transparent subjective observation reporting
- **WatchdogEnforcer**: Permissionless objective violation enforcement
- **WatchdogReasonCodes**: Machine-readable violation codes

**Key Improvements Already Achieved**:
- ✅ **Decentralized Consensus**: 3+ attesters eliminate single points of failure
- ✅ **Clear Separation**: Objective enforcement vs subjective reporting
- ✅ **Transparency**: All observations reported via events for DAO monitoring
- ✅ **Permissionless Enforcement**: Anyone can enforce objective violations

### 6.2 Future Multi-Attester Enhancements

**Enhancement**: Extend current multi-attester model

```solidity
// Current ReserveLedger already supports multiple attesters
contract ReserveLedger {
  uint256 public consensusThreshold = 3; // Configurable
  mapping(address => mapping(address => PendingAttestation)) public pendingAttestations;
  
  function submitAttestation(address qc, uint256 balance) external onlyRole(ATTESTER_ROLE) {
    // Automatic consensus calculation when threshold met
    if (getPendingAttesterCount(qc) + 1 >= consensusThreshold) {
      uint256 consensusBalance = calculateConsensus(qc, balance);
      updateReserveBalance(qc, consensusBalance);
    }
  }
}
```

**Benefits** (Beyond Current Implementation):
- Dynamic threshold adjustment
- Weighted attester voting
- Geographic distribution requirements

## 7. Policy Contract Enhancements

### 7.1 Policy Validation Framework

**Enhancement**: Add validation interface for policy contracts

```solidity
interface IPolicyValidator {
  function validatePolicyUpgrade(address oldPolicy, address newPolicy)
    external
    view
    returns (bool isValid, string memory reason);

  function getRequiredInterfaces() external pure returns (bytes4[] memory);
}

contract PolicyUpgradeValidator is IPolicyValidator {
  function validatePolicyUpgrade(address oldPolicy, address newPolicy)
    external
    view
    override
    returns (bool, string memory)
  {
    // Validate interface compatibility
    // Check storage layout compatibility
    // Verify access control setup
    return (true, "Validation passed");
  }
}

```

**Benefits**:

- Prevents invalid policy upgrades
- Ensures interface compatibility
- Reduces upgrade risks

### 7.2 Policy Parameter Management

**Enhancement**: Centralized parameter management for policies

```solidity
contract PolicyParameterStore {
  mapping(bytes32 => uint256) public uintParams;
  mapping(bytes32 => address) public addressParams;
  mapping(bytes32 => bool) public boolParams;

  function setParameter(bytes32 key, uint256 value)
    external
    onlyRole(PARAMETER_ADMIN_ROLE);

  function getParameter(bytes32 key) external view returns (uint256);
}

// Usage in policies
contract BasicMintingPolicy {
  function getStaleThreshold() internal view returns (uint256) {
    return parameterStore.getParameter(keccak256("STALE_THRESHOLD"));
  }
}

```

**Benefits**:

- Centralized parameter governance
- Hot-swappable configuration without contract upgrades
- Better parameter auditability

## 8. Cross-Chain and Scaling Solutions

### 8.1 L2 Integration

Direct minting on Layer 2 solutions:

```solidity
interface IL2Bridge {
  function mintOnL2(
    address user,
    uint256 amount,
    uint256 chainId,
    bytes calldata userData
  ) external;
}

```

### 8.2 Cross-Chain Messaging

Support for cross-chain QC operations:

```solidity
interface ICrossChainMessenger {
  function sendCrossChainMint(
    uint256 targetChain,
    address recipient,
    uint256 amount,
    bytes calldata metadata
  ) external;
}

```

## 9. Advanced Governance Features

### 9.1 Dynamic Fee Models

Implement flexible fee structures:

```solidity
struct FeeModel {
    uint256 baseFee;
    uint256 percentageFee;
    uint256 volumeDiscount;
    uint256 qcSpecificRate;
}

mapping(address => FeeModel) public qcFeeModels;
```

### 9.2 Reputation System

Track QC performance on-chain:

```solidity
struct QCReputation {
    uint256 successfulMints;
    uint256 defaultedRedemptions;
    uint256 averageResponseTime;
    uint256 reputationScore;
}

mapping(address => QCReputation) public qcReputations;
```

### 9.3 Automated Risk Management

Dynamic limits based on QC behavior:

```solidity
function calculateDynamicMintingCap(address qc) public view returns (uint256) {
  QCReputation memory rep = qcReputations[qc];
  uint256 baseCap = custodians[qc].maxMintingCap;

  // Adjust based on reputation
  if (rep.reputationScore > EXCELLENT_THRESHOLD) {
    return (baseCap * 120) / 100; // 20% bonus
  } else if (rep.reputationScore < POOR_THRESHOLD) {
    return (baseCap * 50) / 100; // 50% reduction
  }
  return baseCap;
}

```

## 10. User Experience Enhancements

### 10.1 Gasless Transactions

Support meta-transactions for QC operations:

```solidity
function creditQCBackedDepositWithPermit(
  address user,
  uint256 amount,
  address qc,
  bytes32 mintId,
  bool autoMint,
  uint256 deadline,
  uint8 v,
  bytes32 r,
  bytes32 s
) external;

```

### 10.2 Subscription-Based Minting

Automated recurring mints:

```solidity
struct MintSubscription {
    address user;
    address qc;
    uint256 amount;
    uint256 frequency;
    uint256 nextMintTime;
}

mapping(bytes32 => MintSubscription) public subscriptions;
```

## 11. Monitoring and Analytics

### 11.1 On-Chain Metrics Collection

**Enhancement**: Standardized metrics for system monitoring

```solidity
contract QCMetrics {
  struct SystemMetrics {
    uint256 totalQCs;
    uint256 activeQCs;
    uint256 totalMinted;
    uint256 totalReserves;
    uint256 averageCapacityUtilization;
  }

  function getSystemMetrics() external view returns (SystemMetrics memory);

  function getQCMetrics(address qc)
    external
    view
    returns (
      uint256 minted,
      uint256 capacity,
      uint256 reserves
    );
}

```

**Benefits**:

- Real-time system health monitoring
- Better analytics for DAO governance
- Automated alerting capabilities

### 11.2 Enhanced Event System

Detailed events for better monitoring:

```solidity
event QCMetricsUpdated(
    address indexed qc,
    uint256 totalMinted,
    uint256 totalRedeemed,
    uint256 activeDeposits,
    uint256 utilizationRate
);

event SystemHealthUpdate(
  uint256 indexed blockNumber,
  uint256 totalQCs,
  uint256 systemUtilization,
  uint256 avgReserveRatio
);

event QCPerformanceMetric(
  address indexed qc,
  uint256 indexed metricType,
  uint256 value,
  uint256 timestamp
);
```

**Benefits**:

- Standardized monitoring interface
- Better integration with existing tBTC v2 monitoring
- Historical trend analysis

### 11.3 On-Chain Analytics

Built-in analytics functions:

```solidity
function getQCAnalytics(address qc)
  external
  view
  returns (
    uint256 totalVolume30d,
    uint256 averageDepositSize,
    uint256 uniqueUsers,
    uint256 healthScore
  );

```

## 12. Testing and Validation Framework

### 12.1 Policy Testing Framework

**Enhancement**: Standardized testing interface for policies

```solidity
interface IPolicyTestable {
  function runDiagnostics()
    external
    view
    returns (bool[] memory testResults, string[] memory testNames);

  function simulateOperation(bytes calldata operationData)
    external
    view
    returns (bool success, bytes memory result);
}

```

**Benefits**:

- Consistent policy testing
- Easier validation of upgrades
- Better quality assurance

### 12.2 Integration Test Helpers

**Enhancement**: Helper contracts for testing complete flows

```solidity
contract AccountControlTestHelper {
  function simulateQCLifecycle(
    address qc,
    string memory name,
    uint256 capacity
  ) external returns (bool success);

  function simulateMintingFlow(address qc, uint256 amount)
    external
    returns (bool success);

  function simulateRedemptionFlow(address qc, uint256 amount)
    external
    returns (bool success);
}

```

**Benefits**:

- Faster integration testing
- Consistent test scenarios
- Better regression testing

## 13. Migration Status and V2 Preparation

### 13.1 Recent Migrations Completed

**Status**: ✅ **COMPLETED** - Major architectural consolidation

**Completed Migrations**:
- ✅ **ReserveOracle + QCReserveLedger → ReserveLedger**: Unified atomic consensus+storage
- ✅ **WatchdogSubjectiveReporting → WatchdogReporting**: Simplified transparent reporting
- ✅ **Complex Watchdog System → 4-Contract Architecture**: Based on Three-Problem Framework

**Migration Benefits Achieved**:
- Eliminated dual interface problems
- Reduced gas costs through atomic operations
- Simplified maintenance and upgrades
- Improved security through clear separation of concerns

### 13.2 Future Collateralization Interface Preparation

**Enhancement**: Prepare interface for future collateralized policies

```solidity
interface ICollateralPolicy {
  function getRequiredCollateral(address qc, uint256 mintAmount)
    external
    view
    returns (uint256);

  function validateCollateral(address qc, uint256 collateralAmount)
    external
    view
    returns (bool);
}

// V1 implementation returns zero collateral
contract NoCollateralPolicy is ICollateralPolicy {
  function getRequiredCollateral(address, uint256)
    external
    pure
    override
    returns (uint256)
  {
    return 0; // V1 requires no collateral
  }

  function validateCollateral(address, uint256)
    external
    pure
    override
    returns (bool)
  {
    return true; // V1 accepts any collateral amount
  }
}

```

**Benefits**:

- Smooth V1 → V2 transition
- Interface stability across versions
- Backward compatibility

## Implementation Priority

Based on potential impact, complexity, and strategic importance:

### 1. **High Priority**

- **Service Versioning Support** (Section 1.1): Enables safe policy upgrades
- **Cryptographic Proof-of-Reserves** (Section 5.1): Critical security enhancement  
- **Batch Operations Support** (Section 2.2): Gas optimization for scaling
- **Emergency Pause Granularity** (Section 5.2): Essential operational control
- **L2 Integration** (Section 8.1): Cross-chain scaling necessity
- ✅ ~~**Watchdog Heartbeat Mechanism**: Replaced by multi-attester consensus system~~

### 2. **Medium Priority**

- **Enhanced Minting Strategies** (Section 2.1): User experience improvements
- **Gas-Optimized Storage Layout** (Section 3.1): Cost reduction
- **Policy Validation Framework** (Section 7.1): Upgrade safety
- **On-Chain Metrics Collection** (Section 11.1): Operational monitoring
- **Enhanced Time-Locked Governance** (Section 5.3): Extended security controls
- **Dynamic Fee Models** (Section 9.1): Economic flexibility
- ✅ ~~**Strategic Attestation Cost Optimization**: Implemented via ReserveLedger consensus~~

### 3. **Low Priority**

- **Service Health Checking** (Section 1.2): Monitoring enhancements
- **Event Indexing Strategy** (Section 3.2): Analytics improvements
- **Advanced DeFi Integration** (Section 4): Ecosystem expansion
- **Reputation System** (Section 9.2): Long-term governance evolution
- **Gasless Transactions** (Section 10.1): UX convenience features
- **Subscription-Based Minting** (Section 10.2): Automation features
- **Testing Framework** (Section 12): Development tooling
- **Future V2 Preparation** (Section 13): Forward compatibility

### 4. **Research Phase**

- **State Diff Compression** (Section 3.3): Novel storage optimization
- **Flash Loan Support** (Section 4.3): Complex DeFi integration
- **Cross-Chain Messaging** (Section 8.2): Advanced interoperability
- **Automated Risk Management** (Section 9.3): AI/ML governance integration

## Implementation Strategy

### Phase 1: Core Infrastructure (6-12 months)

1. Deploy core contracts with service versioning support
2. Implement cryptographic proof-of-reserves
3. Add emergency pause granularity
4. ✅ ~~Deploy watchdog heartbeat mechanism~~ **COMPLETED**: Multi-attester consensus system deployed

### Phase 2: Performance & Monitoring (3-6 months)

1. Implement gas-optimized storage layout
2. Add comprehensive monitoring and analytics
3. Deploy batch operations support
4. Enhance event system for better tracking

### Phase 3: Advanced Features (6-12 months)

1. Implement enhanced minting strategies
2. Add policy validation framework
3. Deploy dynamic fee models
4. Begin L2 integration work

### Phase 4: Ecosystem Integration (ongoing)

1. DeFi protocol integrations
2. Cross-chain expansion
3. Advanced governance features
4. V2 preparation interfaces

## Document Status and Next Steps

### Recent Achievements (2025-08-06 Update)

This document has been updated to reflect major architectural improvements completed:

✅ **Watchdog System Simplified**: Migrated from complex dual-path model to 4-contract architecture  
✅ **Reserve Consensus Implemented**: Multi-attester system eliminates single points of failure  
✅ **Atomic Operations**: ReserveLedger unification reduces gas costs and complexity  
✅ **Transparent Reporting**: Event-based watchdog observations for DAO governance  

### Roadmap Evolution

This comprehensive enhancement roadmap now represents the evolution from the **current simplified architecture** to a full-featured, scalable Bitcoin-backed token protocol. The enhancements maintain strict adherence to the modular, policy-driven architecture while addressing:

- **Operational Excellence**: Better monitoring, testing, and deployment capabilities
- **Security Enhancements**: Granular controls, cryptographic proofs, and validation systems  
- **Performance Optimization**: Gas efficiency and scalability improvements
- **Future-Proofing**: V2 preparation while maintaining current simplicity and compatibility
- **Ecosystem Growth**: DeFi integration and cross-chain expansion capabilities

The modular architecture makes these enhancements feasible without major system overhauls, enabling gradual implementation based on DAO governance decisions and operational needs. All enhancements preserve the core principles of policy-driven evolution, **multi-attester consensus**, and independent deployment from existing tBTC infrastructure.

### Priority Updates

Given the successful watchdog migration, priorities should focus on:
1. **Service versioning** for safe policy upgrades
2. **Cryptographic proof-of-reserves** to further enhance security
3. **L2 integration** for cross-chain scaling
4. **Gas optimization** through enhanced storage patterns
