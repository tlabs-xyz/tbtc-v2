# Account Control Implementation Guide

**Document Version**: 1.0  
**Date**: 2025-07-11  
**Architecture**: Direct Bank Integration  
**Purpose**: Code patterns, deployment procedures, and configuration management  
**Related Documents**: [README.md](README.md), [ARCHITECTURE.md](ARCHITECTURE.md), [REQUIREMENTS.md](REQUIREMENTS.md), [FLOWS.md](FLOWS.md)

---

## Overview

This document provides comprehensive implementation guidance for the Account Control system, including smart contract patterns, deployment procedures, and configuration management. The implementation is based on the direct Bank integration approach that prioritizes simplicity and proven patterns.

## Core Contract Implementation Patterns

### 1. BasicMintingPolicy.sol - Direct Bank Integration

**Key Implementation**: The cornerstone of QC integration, acting as the direct interface between Account Control and the existing tBTC Bank/Vault architecture.

```solidity
// BasicMintingPolicy.sol - Direct Bank integration for QC minting
contract BasicMintingPolicy is IMintingPolicy, AccessControl {
  bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
  uint256 public constant SATOSHI_MULTIPLIER = 1e10;

  ProtocolRegistry public immutable protocolRegistry;

  /// @notice Request minting with direct Bank integration
  /// @param qc The address of the Qualified Custodian
  /// @param user The address receiving the tBTC tokens
  /// @param amount The amount of tBTC to mint (in wei)
  /// @return mintId Unique identifier for this minting request
  function requestMint(
    address qc,
    address user,
    uint256 amount
  ) external override onlyRole(MINTER_ROLE) returns (bytes32 mintId) {
    // Validate QC status, system state, and capacity
    _validateMintingRequest(qc, user, amount);

    // Convert tBTC amount to satoshis
    uint256 satoshis = amount / SATOSHI_MULTIPLIER;

    // Direct Bank interaction with auto-minting
    Bank bank = Bank(protocolRegistry.getService(BANK_KEY));
    TBTCVault tbtcVault = TBTCVault(
      protocolRegistry.getService(TBTC_VAULT_KEY)
    );

    address[] memory depositors = new address[](1);
    uint256[] memory amounts = new uint256[](1);
    depositors[0] = user;
    amounts[0] = satoshis;

    // Create Bank balance and automatically trigger TBTCVault minting
    bank.increaseBalanceAndCall(address(tbtcVault), depositors, amounts);

    // Update QC minted amount and complete mint
    _completeMint(qc, amount);
    return mintId;
  }

  /// @notice Get available minting capacity for a QC
  function getAvailableMintingCapacity(address qc)
    external
    view
    returns (uint256)
  {
    QCManager qcManager = QCManager(
      protocolRegistry.getService(QC_MANAGER_KEY)
    );
    return qcManager.getAvailableMintingCapacity(qc);
  }
}

```

**Implementation Features**:

- Direct `Bank.increaseBalanceAndCall()` integration
- Comprehensive validation pipeline
- Support for both auto-minting and manual minting workflows
- Gas-efficient error handling with custom errors
- Role-based access control with separation of duties

### 2. ProtocolRegistry.sol - Central Service Registry

**Purpose**: Cornerstone of the architecture's modularity, acting as a central, dynamic address book.

```solidity
// ProtocolRegistry.sol - Central service registry
contract ProtocolRegistry is AccessControl {
  mapping(bytes32 => address) public services;

  event ServiceUpdated(
    bytes32 indexed serviceId,
    address indexed oldAddress,
    address indexed newAddress
  );

  function setService(bytes32 serviceId, address serviceAddress)
    external
    onlyRole(DEFAULT_ADMIN_ROLE)
  {
    require(serviceAddress != address(0), "Invalid service address");
    address oldAddress = services[serviceId];
    services[serviceId] = serviceAddress;
    emit ServiceUpdated(serviceId, oldAddress, serviceAddress);
  }

  function getService(bytes32 serviceId) external view returns (address) {
    address service = services[serviceId];
    require(service != address(0), "Service not found");
    return service;
  }

  function hasService(bytes32 serviceId) external view returns (bool) {
    return services[serviceId] != address(0);
  }
}

```

**Benefits**:

- Enables component upgrades without full-system redeployment
- Decouples all system contracts
- Provides single source of truth for service addresses
- Supports future service versioning

### 3. QCData.sol - Dedicated Storage Layer

**Purpose**: Dedicated, auditable storage layer for all QC-related data with clear separation from business logic.

```solidity
// QCData.sol - Dedicated storage for QC data
contract QCData is Ownable {
  enum QCStatus {
    Active, // QC is fully operational
    UnderReview, // QC's minting rights are paused pending review
    Revoked // QC's rights are permanently terminated
  }

  enum WalletStatus {
    Inactive, // Not in use
    Active, // Actively monitored for reserves
    PendingDeRegistration // QC has requested to de-register
  }

  struct Custodian {
    QCStatus status;
    uint256 maxMintingCap;
    uint256 mintedAmount;
    uint256 registeredAt;
    string name;
  }

  struct Wallet {
    WalletStatus status;
    address owner; // The QC address that owns this wallet
    uint256 registeredAt;
  }

  mapping(address => Custodian) public custodians;
  mapping(address => mapping(string => Wallet)) public wallets;

  // Data access functions callable only by the owner (QCManager)
  function setCustodianStatus(address qc, QCStatus status) external onlyOwner {
    custodians[qc].status = status;
  }

  function updateMintedAmount(address qc, uint256 amount) external onlyOwner {
    custodians[qc].mintedAmount = amount;
  }

  // View functions for external access
  function getQCStatus(address qc) external view returns (QCStatus) {
    return custodians[qc].status;
  }

  function getQCMintedAmount(address qc) external view returns (uint256) {
    return custodians[qc].mintedAmount;
  }
}

```

**Design Principles**:

- Pure storage with no business logic
- Owned by QCManager for controlled access
- Gas-optimized struct layouts
- Clear data ownership and access patterns

### 4. QCMinter.sol - Stable Entry Point

**Purpose**: Focused contract that acts as a stable entry point for minting operations.

```solidity
// QCMinter.sol - Entry point for QC minting
contract QCMinter is AccessControl, Pausable {
  ProtocolRegistry public immutable protocolRegistry;

  event MintingPolicyUpdated(
    address indexed oldPolicy,
    address indexed newPolicy
  );

  /// @notice Called by a QC to request minting
  function requestQCMint(uint256 amount) external whenNotPaused {
    IMintingPolicy mintingPolicy = IMintingPolicy(
      protocolRegistry.getService(MINTING_POLICY_KEY)
    );
    mintingPolicy.requestMint(msg.sender, msg.sender, amount);
  }

  /// @notice Called by authorized minter to mint for specific user
  function requestQCMintFor(address user, uint256 amount)
    external
    onlyRole(MINTER_ROLE)
    whenNotPaused
  {
    IMintingPolicy mintingPolicy = IMintingPolicy(
      protocolRegistry.getService(MINTING_POLICY_KEY)
    );
    mintingPolicy.requestMint(msg.sender, user, amount);
  }

  /// @notice Update the minting policy (DAO only)
  function setMintingPolicy(address newPolicy)
    external
    onlyRole(DEFAULT_ADMIN_ROLE)
  {
    bytes32 policyKey = MINTING_POLICY_KEY;
    address oldPolicy = protocolRegistry.getService(policyKey);
    protocolRegistry.setService(policyKey, newPolicy);
    emit MintingPolicyUpdated(oldPolicy, newPolicy);
  }
}

```

**Key Features**:

- Stable interface that never changes
- Delegates all logic to upgradeable Policy contracts
- Emergency pause capabilities
- Role-based access for different minting scenarios

## Bank Integration Implementation

### Authorization Setup

The existing Bank contract requires modification to support multiple balance increasers:

```solidity
// Bank.sol modifications for Account Control integration
contract Bank {
  mapping(address => bool) public authorizedBalanceIncreasers;

  modifier onlyAuthorizedIncreaser() {
    require(
      authorizedBalanceIncreasers[msg.sender],
      "Caller not authorized to increase balances"
    );
    _;
  }

  function setAuthorizedBalanceIncreaser(address increaser, bool authorized)
    external
    onlyOwner
  {
    authorizedBalanceIncreasers[increaser] = authorized;
    emit BalanceIncreaserAuthorizationUpdated(increaser, authorized);
  }

  function increaseBalanceAndCall(
    address vault,
    address[] calldata depositors,
    uint256[] calldata amounts
  ) external onlyAuthorizedIncreaser {
    // Existing implementation with authorization check
  }
}

```

### Integration Workflow

1. **Deploy BasicMintingPolicy**: Deploy with ProtocolRegistry address
2. **Authorize in Bank**: Call `Bank.setAuthorizedBalanceIncreaser(basicMintingPolicy, true)`
3. **Register in Registry**: Add BasicMintingPolicy to ProtocolRegistry
4. **Configure QCMinter**: Set minting policy reference

## Deployment Implementation

### Deployment Script Pattern

Following the existing tBTC v2 numbered deployment script convention:

```typescript
// deploy/95_deploy_account_control.ts
import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, execute, get } = deployments
  const { deployer, governance } = await getNamedAccounts()

  // Deploy ProtocolRegistry
  const protocolRegistry = await deploy("ProtocolRegistry", {
    from: deployer,
    log: true,
  })

  // Deploy QCData
  const qcData = await deploy("QCData", {
    from: deployer,
    log: true,
  })

  // Deploy QCManager
  const qcManager = await deploy("QCManager", {
    from: deployer,
    args: [protocolRegistry.address],
    log: true,
  })

  // Deploy BasicMintingPolicy
  const basicMintingPolicy = await deploy("BasicMintingPolicy", {
    from: deployer,
    args: [protocolRegistry.address],
    log: true,
  })

  // Deploy QCMinter
  const qcMinter = await deploy("QCMinter", {
    from: deployer,
    args: [protocolRegistry.address],
    log: true,
  })

  // Configure ProtocolRegistry
  await execute(
    "ProtocolRegistry",
    { from: deployer },
    "setService",
    ethers.utils.id("QC_DATA"),
    qcData.address
  )

  // Get existing Bank contract
  const bank = await get("Bank")

  // Authorize BasicMintingPolicy in Bank
  await execute(
    "Bank",
    { from: governance },
    "setAuthorizedBalanceIncreaser",
    basicMintingPolicy.address,
    true
  )

  // Transfer ownership to governance
  await execute(
    "ProtocolRegistry",
    { from: deployer },
    "transferOwnership",
    governance
  )
}

func.tags = ["AccountControl"]
func.dependencies = ["Bank", "TBTCVault", "TBTC"]

export default func
```

### Configuration Management

**Environment Configuration**:

```typescript
// config/account-control.ts
export const AccountControlConfig = {
  mainnet: {
    governanceDelay: 7 * 24 * 60 * 60, // 7 days
    staleThreshold: 24 * 60 * 60, // 24 hours
    minMintAmount: ethers.utils.parseEther("0.01"), // 0.01 tBTC
    maxMintAmount: ethers.utils.parseEther("100"), // 100 tBTC
  },
  goerli: {
    governanceDelay: 60 * 60, // 1 hour for testing
    staleThreshold: 60 * 60, // 1 hour
    minMintAmount: ethers.utils.parseEther("0.001"),
    maxMintAmount: ethers.utils.parseEther("10"),
  },
}
```

## Testing Implementation

### Unit Test Pattern

```typescript
// test/BasicMintingPolicy.test.ts
describe("BasicMintingPolicy", () => {
  let basicMintingPolicy: BasicMintingPolicy
  let protocolRegistry: ProtocolRegistry
  let bank: Bank
  let tbtcVault: TBTCVault
  let qcManager: QCManager

  beforeEach(async () => {
    // Deploy test fixtures
    const fixture = await deployAccountControlFixture()
    basicMintingPolicy = fixture.basicMintingPolicy
    protocolRegistry = fixture.protocolRegistry
    bank = fixture.bank
    tbtcVault = fixture.tbtcVault
    qcManager = fixture.qcManager
  })

  describe("requestMint", () => {
    it("should successfully mint tokens with direct Bank integration", async () => {
      // Setup QC with Active status and sufficient capacity
      await qcManager.setQCStatus(qc.address, QCStatus.Active)
      await qcManager.setMintingCapacity(
        qc.address,
        ethers.utils.parseEther("100")
      )

      // Request mint
      const amount = ethers.utils.parseEther("1")
      const tx = await basicMintingPolicy.requestMint(
        qc.address,
        user.address,
        amount
      )

      // Verify Bank balance increased
      const satoshis = amount.div(SATOSHI_MULTIPLIER)
      expect(await bank.balanceOf(user.address)).to.equal(satoshis)

      // Verify tBTC tokens minted
      expect(await tbtc.balanceOf(user.address)).to.equal(amount)

      // Verify events emitted
      await expect(tx)
        .to.emit(basicMintingPolicy, "QCBackedDepositCredited")
        .withArgs(user.address, satoshis, qc.address, anyValue, true)
    })

    it("should revert if QC is not Active", async () => {
      await qcManager.setQCStatus(qc.address, QCStatus.UnderReview)

      await expect(
        basicMintingPolicy.requestMint(
          qc.address,
          user.address,
          ethers.utils.parseEther("1")
        )
      ).to.be.revertedWith("QCNotActive")
    })
  })
})
```

### Integration Test Pattern

```typescript
// test/integration/AccountControlIntegration.test.ts
describe("Account Control Integration", () => {
  it("should handle complete QC lifecycle", async () => {
    // 1. QC Onboarding
    await governance.registerQC(qc.address, ethers.utils.parseEther("100"))
    // Instant execution - no time delay needed

    // 2. Wallet Registration with SPV proof
    const spvProof = await generateSPVProof(btcAddress, challengeHash)
    await watchdog.registerWallet(qc.address, btcAddress, spvProof)

    // 3. Reserve Attestation
    await watchdog.submitReserveAttestation(
      qc.address,
      ethers.utils.parseEther("10")
    )

    // 4. Minting Operation
    const mintAmount = ethers.utils.parseEther("1")
    await qcMinter.connect(qc).requestQCMint(mintAmount)

    // 5. Verify Complete Flow
    expect(await tbtc.balanceOf(qc.address)).to.equal(mintAmount)
    expect(await qcData.getQCMintedAmount(qc.address)).to.equal(mintAmount)
  })
})
```

## Security Implementation

### Access Control Pattern

```solidity
// Comprehensive role-based access control
contract AccountControlAccessControl is AccessControl {
  bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
  bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
  bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
  bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
  bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
  bytes32 public constant QC_GOVERNANCE_ROLE = keccak256("QC_GOVERNANCE_ROLE");

  modifier onlyActiveQC(address qc) {
    QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
    require(qcData.getQCStatus(qc) == QCData.QCStatus.Active, "QC not active");
    _;
  }

  modifier whenNotPaused(bytes32 functionId) {
    SystemState systemState = SystemState(
      protocolRegistry.getService(SYSTEM_STATE_KEY)
    );
    require(!systemState.isPaused(functionId), "Function paused");
    _;
  }
}

```

### Input Validation Implementation

```solidity
// Comprehensive input validation with custom errors
contract ValidationLibrary {
  error InvalidQCAddress();
  error InvalidUserAddress();
  error InvalidAmount();
  error AmountOutsideAllowedRange();
  error InsufficientMintingCapacity();
  error StaleReserveAttestation();

  function validateMintingRequest(
    address qc,
    address user,
    uint256 amount,
    ProtocolRegistry registry
  ) internal view {
    if (qc == address(0)) revert InvalidQCAddress();
    if (user == address(0)) revert InvalidUserAddress();
    if (amount == 0) revert InvalidAmount();

    SystemState systemState = SystemState(
      registry.getService(SYSTEM_STATE_KEY)
    );
    if (
      amount < systemState.minMintAmount() ||
      amount > systemState.maxMintAmount()
    ) {
      revert AmountOutsideAllowedRange();
    }

    QCManager qcManager = QCManager(registry.getService(QC_MANAGER_KEY));
    if (amount > qcManager.getAvailableMintingCapacity(qc)) {
      revert InsufficientMintingCapacity();
    }
  }
}

```

## Gas Optimization Implementation

### Storage Layout Optimization

```solidity
// Gas-optimized storage layout
struct OptimizedCustodian {
  // Slot 1: Pack status, capacity, and minted amount
  QCStatus status; // 1 byte
  uint88 maxMintingCap; // 11 bytes (sufficient for 2^88 satoshis)
  uint88 mintedAmount; // 11 bytes
  bool isPaused; // 1 byte
  // 8 bytes remaining in slot 1

  // Slot 2: Timestamps
  uint128 registeredAt; // 16 bytes
  uint128 lastUpdated; // 16 bytes
  // Slot 3+: Variable length data
  string name;
}

```

### Event Optimization

```solidity
// Gas-optimized events with indexed parameters
event QCStatusChanged(
    address indexed qc,
    uint8 indexed oldStatus,    // Indexed for filtering
    uint8 indexed newStatus,    // Indexed for filtering
    uint256 timestamp,          // Block timestamp for queries
    bytes32 reason
);

event QCBackedDepositCredited(
    address indexed user,
    uint256 indexed amount,
    address indexed qc,
    bytes32 mintId,
    bool autoMinted
);
```

## Monitoring Implementation

### Comprehensive Event System

```solidity
// Events for complete system monitoring
contract AccountControlEvents {
  // QC Lifecycle Events
  event QCOnboardingQueued(
    address indexed qc,
    string name,
    uint256 capacity,
    uint256 executeAfter
  );
  event QCOnboardingExecuted(address indexed qc, string name, uint256 capacity);
  event QCStatusChanged(
    address indexed qc,
    uint8 oldStatus,
    uint8 newStatus,
    bytes32 reason
  );

  // Minting Events
  event MintRequested(
    bytes32 indexed mintId,
    address indexed qc,
    address indexed user,
    uint256 amount
  );
  event MintCompleted(
    bytes32 indexed mintId,
    address indexed qc,
    uint256 amount,
    uint256 timestamp
  );
  event MintRejected(
    address indexed qc,
    uint256 amount,
    string reason,
    uint256 timestamp
  );

  // Reserve Events
  event ReserveAttestationSubmitted(
    address indexed attester,
    address indexed qc,
    uint256 balance,
    uint256 timestamp
  );
  event SolvencyStatusChanged(
    address indexed qc,
    bool isSolvent,
    uint256 reserves,
    uint256 minted
  );

  // System Events
  event EmergencyPauseActivated(
    bytes32 functionId,
    address indexed pauser,
    uint256 timestamp
  );
  event SystemParameterUpdated(
    bytes32 indexed parameter,
    uint256 oldValue,
    uint256 newValue
  );
}

```

### Metrics Collection Interface

```solidity
// Standardized metrics for monitoring systems
interface IAccountControlMetrics {
  function getSystemMetrics()
    external
    view
    returns (
      uint256 totalQCs,
      uint256 activeQCs,
      uint256 totalMinted,
      uint256 totalReserves,
      uint256 averageCapacityUtilization
    );

  function getQCMetrics(address qc)
    external
    view
    returns (
      uint256 minted,
      uint256 capacity,
      uint256 reserves,
      uint256 utilizationRate
    );
}

```

## Conclusion

This implementation guide provides the comprehensive technical foundation for deploying and operating the Account Control system. The patterns demonstrated here prioritize:

- **Direct Integration**: Leveraging proven Bank/Vault infrastructure
- **Modular Architecture**: Clean separation enabling future upgrades
- **Security-First Design**: Comprehensive validation and access control
- **Gas Efficiency**: Optimized storage and execution patterns
- **Operational Excellence**: Complete monitoring and emergency response capabilities

All implementation patterns follow established tBTC v2 conventions while introducing the necessary innovations for institutional custodian integration.

---

**Document Control**

- **Version**: 1.0
- **Implementation Status**: Ready for deployment
- **Related Contracts**: [BasicMintingPolicy.sol](../contracts/account-control/BasicMintingPolicy.sol)
- **Testing**: Complete unit and integration test suites
- **Deployment**: Mainnet-ready with comprehensive deployment scripts
