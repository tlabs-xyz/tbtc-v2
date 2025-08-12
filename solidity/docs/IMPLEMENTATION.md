# tBTC v2 Account Control Implementation Guide

**Document Version**: 3.0  
**Date**: 2025-08-06  
**Architecture**: Simplified Watchdog System  
**Purpose**: Comprehensive implementation guide covering code patterns, deployment, configuration, and role management

---

## Executive Summary

This document provides complete implementation guidance for the Account Control system, including smart contract patterns, deployment procedures, SPV integration, role management, and operational configuration. The implementation follows the direct Bank integration approach prioritizing simplicity, security, and proven architectural patterns.

---

## Table of Contents

1. [Core Contract Implementation](#core-contract-implementation)
2. [SPV Integration Guide](#spv-integration-guide)
3. [Role Management System](#role-management-system)
4. [Deployment Procedures](#deployment-procedures)
5. [Configuration Management](#configuration-management)
6. [Testing Strategies](#testing-strategies)
7. [Security Implementation](#security-implementation)
8. [Monitoring and Operations](#monitoring-and-operations)

---

## Core Contract Implementation

### 1. BasicMintingPolicy.sol - Direct Bank Integration

**Purpose**: The cornerstone of QC integration, acting as the direct interface between Account Control and existing tBTC Bank/Vault architecture.

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

  function _validateMintingRequest(
    address qc,
    address user,
    uint256 amount
  ) internal view {
    QCManager qcManager = QCManager(
      protocolRegistry.getService(QC_MANAGER_KEY)
    );
    SystemState systemState = SystemState(
      protocolRegistry.getService(SYSTEM_STATE_KEY)
    );

    // Check system not paused
    require(!systemState.isPaused(), "System paused");

    // Check QC is active
    require(
      qcManager.getQCStatus(qc) == QCData.QCStatus.Active,
      "QC not active"
    );

    // Check minting capacity
    require(
      qcManager.getAvailableMintingCapacity(qc) >= amount,
      "Insufficient capacity"
    );

    // Check minimum/maximum amounts
    require(amount >= systemState.getMinMintAmount(), "Amount too small");
    require(amount <= systemState.getMaxMintAmount(), "Amount too large");
  }
}

```

### Implementation Features

- **Direct Integration**: Single-hop call to Bank contract eliminates intermediate layers
- **Auto-minting**: Seamless TBTCVault integration for immediate token minting
- **Capacity Validation**: Real-time checks against QC minting limits
- **Emergency Controls**: System-wide pause mechanisms
- **Gas Optimization**: Efficient batched operations for multiple users

### 2. Direct Integration Pattern

**Purpose**: Simplified architecture with direct contract dependencies for gas optimization.

```solidity
// Example: QCMinter with direct integration
contract QCMinter {
  bytes32 public constant SERVICE_ADMIN_ROLE = keccak256("SERVICE_ADMIN_ROLE");

  mapping(bytes32 => address) private services;
  mapping(bytes32 => bool) private criticalServices;

  event ServiceRegistered(
    bytes32 indexed serviceId,
    address indexed serviceAddress
  );
  event ServiceUpdated(
    bytes32 indexed serviceId,
    address indexed oldAddress,
    address indexed newAddress
  );

  /// @notice Register a new service
  function setService(bytes32 serviceId, address serviceAddress)
    external
    onlyRole(SERVICE_ADMIN_ROLE)
  {
    require(serviceAddress != address(0), "Invalid address");

    address oldAddress = services[serviceId];
    services[serviceId] = serviceAddress;

    if (oldAddress == address(0)) {
      emit ServiceRegistered(serviceId, serviceAddress);
    } else {
      emit ServiceUpdated(serviceId, oldAddress, serviceAddress);
    }
  }

  /// @notice Get service address with validation
  function getService(bytes32 serviceId) external view returns (address) {
    address serviceAddress = services[serviceId];
    require(serviceAddress != address(0), "Service not registered");
    return serviceAddress;
  }

  /// @notice Mark service as critical (requires additional validation)
  function setCriticalService(bytes32 serviceId, bool isCritical)
    external
    onlyRole(DEFAULT_ADMIN_ROLE)
  {
    criticalServices[serviceId] = isCritical;
  }
}

```

### 3. QC Management Implementation Pattern

**Separation of Concerns Architecture**:

```solidity
// QCData.sol - Pure storage contract
contract QCData {
  struct Custodian {
    QCStatus status;
    uint256 maxMintingCap;
    uint256 currentMinted;
    uint256 registeredAt;
    string name;
    bool isPaused;
  }

  mapping(address => Custodian) private custodians;
  mapping(address => mapping(string => bool)) private registeredWallets;

  function setCustodian(address qc, Custodian memory custodian)
    external
    onlyRole(DATA_ADMIN_ROLE)
  {
    custodians[qc] = custodian;
  }

  function getCustodian(address qc) external view returns (Custodian memory) {
    return custodians[qc];
  }
}

// QCManager.sol - Business logic contract
contract QCManager is AccessControl {
  QCData private qcData;

  function registerQC(
    address qc,
    string calldata name,
    uint256 maxMintingCap
  ) external onlyRole(QC_GOVERNANCE_ROLE) {
    // Validation logic
    require(qc != address(0), "Invalid QC address");
    require(bytes(name).length > 0, "Name required");
    require(maxMintingCap > 0, "Capacity required");

    // Create custodian record
    QCData.Custodian memory custodian = QCData.Custodian({
      status: QCData.QCStatus.Active,
      maxMintingCap: maxMintingCap,
      currentMinted: 0,
      registeredAt: block.timestamp,
      name: name,
      isPaused: false
    });

    qcData.setCustodian(qc, custodian);
    emit QCRegistered(qc, name, maxMintingCap);
  }

  function getAvailableMintingCapacity(address qc)
    external
    view
    returns (uint256)
  {
    QCData.Custodian memory custodian = qcData.getCustodian(qc);
    require(custodian.registeredAt > 0, "QC not registered");
    require(custodian.status == QCData.QCStatus.Active, "QC not active");

    if (custodian.currentMinted >= custodian.maxMintingCap) {
      return 0;
    }

    return custodian.maxMintingCap - custodian.currentMinted;
  }
}

```

---

## SPV Integration Guide

### Overview

SPV (Simplified Payment Verification) proofs are **critical** for QC onboarding in the Account Control system. They provide cryptographic proof that a Qualified Custodian controls specific Bitcoin wallets through a challenge-response protocol.

### Wallet Registration Flow

```
QC wants to register Bitcoin wallet
    ↓
QC creates Bitcoin transaction with OP_RETURN containing challenge
    ↓
QC submits SPV proof to QCWatchdog.registerWalletWithProof()
    ↓
QCWatchdog verifies SPV proof via SPVValidator
    ↓
If valid, wallet is registered to QC in QCData
```

### Key Components

#### 1. SPVValidator.sol

**Purpose**: Replicates Bridge's SPV verification logic for Account Control

```solidity
contract SPVValidator {
  using BTCUtils for bytes;
  using BytesLib for bytes;

  /// @notice Validate SPV proof for wallet registration
  function validateProof(
    bytes memory txInfo,
    bytes memory proof,
    bytes32 challengeHash,
    string memory btcAddress
  ) external view returns (bool) {
    // 1. Validate transaction structure
    require(txInfo.length >= 60, "Invalid transaction");

    // 2. Extract OP_RETURN from transaction outputs
    bytes memory opReturn = _extractOpReturn(txInfo);
    require(opReturn.length == 32, "Invalid OP_RETURN");

    // 3. Verify challenge hash matches
    bytes32 extractedChallenge = bytes32(opReturn);
    require(extractedChallenge == challengeHash, "Challenge mismatch");

    // 4. Verify SPV proof against Bitcoin headers
    bool proofValid = _verifySpvProof(txInfo, proof);
    require(proofValid, "Invalid SPV proof");

    // 5. Verify transaction spends from claimed address
    bool addressValid = _verifyBtcAddress(txInfo, btcAddress);
    require(addressValid, "Address mismatch");

    return true;
  }

  function _extractOpReturn(bytes memory txInfo)
    internal
    pure
    returns (bytes memory)
  {
    // Parse transaction outputs to find OP_RETURN
    uint256 outputCount = txInfo.extractOutputLength();

    for (uint256 i = 0; i < outputCount; i++) {
      bytes memory output = txInfo.extractOutputAtIndex(i);
      bytes memory script = output.extractScript();

      // Check if script starts with OP_RETURN (0x6a)
      if (script.length > 1 && script[0] == 0x6a) {
        // Return the data after OP_RETURN opcode
        return script.slice(2, 32);
      }
    }

    revert("No OP_RETURN found");
  }
}

```

#### 2. Challenge-Response Protocol

```solidity
// QCManager.sol - Challenge generation
function generateWalletChallenge(address qc, string memory btcAddress)
  external
  view
  returns (bytes32)
{
  return
    keccak256(
      abi.encodePacked(
        qc,
        btcAddress,
        block.timestamp,
        blockhash(block.number - 1)
      )
    );
}

// QCWatchdog.sol - Proof verification and registration
function registerWalletWithProof(
  address qc,
  string memory btcAddress,
  bytes memory txInfo,
  bytes memory spvProof,
  bytes32 challengeHash
) external {
  // Verify SPV proof
  require(
    spvValidator.validateProof(txInfo, spvProof, challengeHash, btcAddress),
    "Invalid SPV proof"
  );

  // Register wallet
  qcManager.registerWallet(qc, btcAddress);

  emit WalletRegistered(qc, btcAddress, challengeHash);
}

```

### Implementation Guidelines

**Security Requirements**:

1. Challenge must be unique per registration attempt
2. Bitcoin transaction must be confirmed (minimum 6 blocks)
3. OP_RETURN must contain exact challenge hash
4. Transaction must spend from the claimed Bitcoin address

**Integration Pattern**:

```typescript
// Watchdog API endpoint implementation
app.post("/api/v1/wallet/register", async (req, res) => {
  const { qcAddress, btcAddress, spvProof } = req.body

  // 1. Generate challenge
  const challenge = await qcManager.generateWalletChallenge(
    qcAddress,
    btcAddress
  )

  // 2. Verify Bitcoin transaction exists and is confirmed
  const btcTx = await bitcoinClient.getTransaction(spvProof.txHash)
  require(btcTx.confirmations >= 6, "Insufficient confirmations")

  // 3. Submit proof on-chain
  const tx = await qcWatchdog.registerWalletWithProof(
    qcAddress,
    btcAddress,
    spvProof.txInfo,
    spvProof.merkleProof,
    challenge
  )

  res.json({ success: true, transactionHash: tx.hash })
})
```

---

## Role Management System

### Role Structure Overview

The Account Control system implements a comprehensive role-based access control system using OpenZeppelin's AccessControl pattern.

### Contract-Specific Roles

#### QCManager Roles

```solidity
bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
bytes32 public constant QC_GOVERNANCE_ROLE = keccak256("QC_GOVERNANCE_ROLE");
bytes32 public constant QC_ADMIN_ROLE = keccak256("QC_ADMIN_ROLE");
bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
```

- **DEFAULT_ADMIN_ROLE**: Can grant/revoke all other roles
- **QC_GOVERNANCE_ROLE**: Can register new QCs and set minting capacity
- **QC_ADMIN_ROLE**: Can update minting parameters (held by BasicMintingPolicy)
- **REGISTRAR_ROLE**: Can register wallets with SPV proof (held by QCWatchdog instances)
- **ARBITER_ROLE**: Can change QC status and verify solvency (held by WatchdogConsensusManager)

#### QCMinter Roles

```solidity
bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
```

- **MINTER_ROLE**: Can request minting (granted to individual QCs)

#### SystemState Roles

```solidity
bytes32 public constant PARAMETER_ADMIN_ROLE = keccak256("PARAMETER_ADMIN_ROLE");
bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
```

- **PARAMETER_ADMIN_ROLE**: Can update system parameters
- **PAUSER_ROLE**: Can pause/unpause system operations

#### Watchdog System Roles

```solidity
// WatchdogConsensusManager
bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
bytes32 public constant WATCHDOG_ROLE = keccak256("WATCHDOG_ROLE");

// WatchdogMonitor
bytes32 public constant WATCHDOG_OPERATOR_ROLE = keccak256("WATCHDOG_OPERATOR_ROLE");
```

### Deployment State

After running deployment scripts (95-99), roles are distributed as follows:

```
Deployer holds:
├── DEFAULT_ADMIN_ROLE (all contracts)
├── QC_GOVERNANCE_ROLE (QCManager)
├── MINTER_ROLE (QCMinter)
├── PARAMETER_ADMIN_ROLE (SystemState)
├── PAUSER_ROLE (SystemState)
├── MANAGER_ROLE (WatchdogConsensusManager)
└── MANAGER_ROLE (WatchdogMonitor)

Contracts hold:
├── QC_ADMIN_ROLE (BasicMintingPolicy → QCManager)
├── ARBITER_ROLE (WatchdogConsensusManager → QCManager, QCRedeemer)
└── REGISTRAR_ROLE (QCWatchdog instances → QCManager)
```

### Role Transfer Process

**Step 1: Transfer to Governance Multisig**

```solidity
// Transfer administrative roles to governance
address governance = 0x123...; // Multisig address

// QCManager
qcManager.grantRole(DEFAULT_ADMIN_ROLE, governance);
qcManager.grantRole(QC_GOVERNANCE_ROLE, governance);
qcManager.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
qcManager.renounceRole(QC_GOVERNANCE_ROLE, deployer);

// SystemState
systemState.grantRole(DEFAULT_ADMIN_ROLE, governance);
systemState.grantRole(PARAMETER_ADMIN_ROLE, governance);
systemState.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
systemState.renounceRole(PARAMETER_ADMIN_ROLE, deployer);
```

**Step 2: Configure Watchdog Operators**

```solidity
// Grant watchdog roles to operators
address[] memory operators = [watchdogOp1, watchdogOp2, watchdogOp3];

for (uint i = 0; i < operators.length; i++) {
    watchdogConsensusManager.grantRole(WATCHDOG_ROLE, operators[i]);
    watchdogMonitor.grantRole(WATCHDOG_OPERATOR_ROLE, operators[i]);
}
```

**Step 3: Grant QC Minting Rights**

```solidity
// Grant minting role to QCs
address[] memory qcs = [qc1, qc2, qc3];

for (uint i = 0; i < qcs.length; i++) {
    qcMinter.grantRole(MINTER_ROLE, qcs[i]);
}
```

### Role Verification Script

```typescript
// verify-roles.ts
async function verifyRoleConfiguration() {
  const contracts = await loadDeployedContracts()

  // Verify administrative roles
  console.log("=== Administrative Roles ===")
  console.log(
    "QCManager DEFAULT_ADMIN:",
    await contracts.qcManager.hasRole(DEFAULT_ADMIN_ROLE, governance)
  )
  console.log(
    "SystemState PARAMETER_ADMIN:",
    await contracts.systemState.hasRole(PARAMETER_ADMIN_ROLE, governance)
  )

  // Verify contract-to-contract roles
  console.log("=== Contract Roles ===")
  console.log(
    "BasicMintingPolicy QC_ADMIN:",
    await contracts.qcManager.hasRole(
      QC_ADMIN_ROLE,
      contracts.basicMintingPolicy.address
    )
  )
  console.log(
    "WatchdogConsensusManager ARBITER:",
    await contracts.qcManager.hasRole(
      ARBITER_ROLE,
      contracts.watchdogConsensusManager.address
    )
  )

  // Verify watchdog roles
  console.log("=== Watchdog Roles ===")
  for (const operator of watchdogOperators) {
    console.log(
      `Operator ${operator} WATCHDOG_ROLE:`,
      await contracts.watchdogConsensusManager.hasRole(WATCHDOG_ROLE, operator)
    )
  }

  // Verify QC roles
  console.log("=== QC Roles ===")
  for (const qc of qcs) {
    console.log(
      `QC ${qc} MINTER_ROLE:`,
      await contracts.qcMinter.hasRole(MINTER_ROLE, qc)
    )
  }
}
```

---

## Deployment Procedures

### Environment Setup

**Prerequisites**:

```bash
# Install dependencies
yarn install

# Configure environment
cp .env.example .env
# Edit .env with network configuration

# Compile contracts
yarn build

# Run tests
yarn test
```

### Deployment Scripts Architecture

The deployment uses numbered scripts ensuring proper dependency resolution:

```
deploy/
├── 95_deploy_account_control_core.ts       # Core QC management
├── 96_deploy_account_control_state.ts      # System state and registry
├── 97_deploy_account_control_policies.ts   # Minting/redemption policies
├── 98_deploy_account_control_watchdog.ts   # watchdog system
├── 99_configure_account_control_system.ts  # Final configuration
├── 100_deploy_automated_framework.ts       # automation framework
└── 101_configure_automated_framework.ts    # Automation configuration
```

### Step-by-Step Deployment

#### Step 1: Core Contracts

```bash
# Deploy core QC management contracts
npx hardhat deploy --tags "AccountControlCore" --network <network>

# Verify deployment
npx hardhat verify --network <network> <QCManager_address>
npx hardhat verify --network <network> <QCData_address>
```

#### Step 2: System State and Registry

```bash
# Deploy registry and state management
npx hardhat deploy --tags "AccountControlState" --network <network>
```

#### Step 3: Policy Contracts

```bash
# Deploy minting and redemption policies
npx hardhat deploy --tags "AccountControlPolicies" --network <network>
```

#### Step 4: Watchdog System

```bash
# Deploy watchdog consensus system
npx hardhat deploy --tags "AccountControlWatchdog" --network <network>
```

#### Step 5: System Configuration

```bash
# Configure roles and parameters
npx hardhat deploy --tags "AccountControlConfig" --network <network>
```

#### Step 6: v1 Automated Framework

```bash
# Deploy automated decision framework
npx hardhat deploy --tags "AutomatedDecisionFramework" --network <network>

# Configure automation
npx hardhat deploy --tags "ConfigureAutomatedFramework" --network <network>
```

### Deployment Verification

**Contract Verification Script**:

```typescript
// verify-deployment.ts
async function verifyDeployment() {
  const contracts = await loadContracts()

  // 1. Verify contract addresses
  console.log("Contract Addresses:")
  console.log("QCManager:", contracts.qcManager.address)
  console.log("BasicMintingPolicy:", contracts.basicMintingPolicy.address)
  console.log("ProtocolRegistry:", contracts.protocolRegistry.address)

  // 2. Verify service registration
  const bankKey = ethers.utils.id("BANK")
  const registeredBank = await contracts.protocolRegistry.getService(bankKey)
  console.log("Registered Bank:", registeredBank)

  // 3. Verify role assignments
  const adminRole = await contracts.qcManager.DEFAULT_ADMIN_ROLE()
  const hasAdminRole = await contracts.qcManager.hasRole(adminRole, deployer)
  console.log("Deployer has admin role:", hasAdminRole)

  // 4. Verify integration
  const mintingPolicyAddress = await contracts.qcMinter.getPolicy()
  console.log("QCMinter policy:", mintingPolicyAddress)
  console.log(
    "Matches BasicMintingPolicy:",
    mintingPolicyAddress === contracts.basicMintingPolicy.address
  )
}
```

---

## Configuration Management

### System Parameters

**Global System Configuration** (SystemState):

```solidity
contract SystemState {
  // Minting parameters
  uint256 public minMintAmount = 0.1 ether; // 0.1 tBTC minimum
  uint256 public maxMintAmount = 1000 ether; // 1000 tBTC maximum
  uint256 public globalMintingCap = 10000 ether; // 10000 tBTC global cap

  // Reserve parameters
  uint256 public staleThreshold = 24 hours; // Attestation staleness
  uint256 public minCollateralRatio = 100; // 100% minimum

  // Redemption parameters
  uint256 public redemptionTimeout = 48 hours; // Fulfillment deadline
  uint256 public minRedemptionAmount = 0.01 ether; // 0.01 tBTC minimum

  // Emergency parameters
  bool public systemPaused = false;
  mapping(bytes32 => bool) public functionPaused;
}

```

**Watchdog Configuration**:

```solidity
// WatchdogConsensusManager configuration
struct ConsensusParams {
    uint256 requiredVotes;      // M (required votes)
    uint256 totalWatchdogs;     // N (total watchdog count)
    uint256 votingPeriod;       // Voting window in seconds
}

// Default production values
ConsensusParams memory params = ConsensusParams({
    requiredVotes: 3,           // 3-of-5 consensus
    totalWatchdogs: 5,          // 5 total watchdogs
    votingPeriod: 2 hours       // 2-hour voting window
});
```

**v1 Automation Configuration**:

```solidity
// WatchdogAutomatedEnforcement parameters
uint256 public minCollateralRatio = 100;       // 100% minimum
uint256 public staleThreshold = 24 hours;      // Attestation staleness
uint256 public redemptionTimeout = 48 hours;   // Redemption deadline

// WatchdogThresholdActions parameters
uint256 public constant REPORT_THRESHOLD = 3;  // Reports needed
uint256 public constant REPORT_WINDOW = 24 hours; // Time window
uint256 public constant COOLDOWN_PERIOD = 7 days; // Between actions
```

### Environment-Specific Configuration

#### Development Configuration

```typescript
// config/development.ts
export const developmentConfig = {
  // Fast testing parameters
  consensus: {
    requiredVotes: 1, // Single approval
    totalWatchdogs: 3, // Minimal set
    votingPeriod: 30 * 60, // 30 minutes
  },

  // Relaxed validation
  minting: {
    minAmount: ethers.utils.parseEther("0.01"), // 0.01 tBTC
    maxAmount: ethers.utils.parseEther("100"), // 100 tBTC
    staleThreshold: 1 * 60 * 60, // 1 hour
  },

  // Quick redemption
  redemption: {
    timeout: 2 * 60 * 60, // 2 hours
  },
}
```

#### Production Configuration

```typescript
// config/production.ts
export const productionConfig = {
  // Secure consensus
  consensus: {
    requiredVotes: 3, // 3-of-5 majority
    totalWatchdogs: 5, // Geographic distribution
    votingPeriod: 2 * 60 * 60, // 2 hours deliberation
  },

  // Conservative validation
  minting: {
    minAmount: ethers.utils.parseEther("0.1"), // 0.1 tBTC
    maxAmount: ethers.utils.parseEther("1000"), // 1000 tBTC
    staleThreshold: 24 * 60 * 60, // 24 hours
  },

  // Reasonable redemption window
  redemption: {
    timeout: 48 * 60 * 60, // 48 hours
  },
}
```

### Configuration Update Procedures

**Parameter Update Script**:

```typescript
// update-parameters.ts
async function updateSystemParameters(newParams: SystemParameters) {
  const systemState = await ethers.getContract("SystemState")

  // Validate parameters
  require(newParams.minMintAmount > 0, "Invalid min amount")
  require(newParams.maxMintAmount >
    newParams.minMintAmount, "Invalid max amount")
  require(newParams.staleThreshold >= 1 * 60 * 60, "Stale threshold too short")

  // Update with proper role
  const parameterAdminRole = await systemState.PARAMETER_ADMIN_ROLE()
  const hasRole = await systemState.hasRole(parameterAdminRole, signer.address)
  require(hasRole, "Insufficient permissions")

  // Execute updates
  await systemState.setMinMintAmount(newParams.minMintAmount)
  await systemState.setMaxMintAmount(newParams.maxMintAmount)
  await systemState.setStaleThreshold(newParams.staleThreshold)

  console.log("Parameters updated successfully")
}
```

---

## Testing Strategies

### Unit Testing Approach

**Contract-Specific Tests**:

```typescript
// QCManager.test.ts
describe("QCManager", () => {
  let qcManager: QCManager
  let qcData: QCData

  beforeEach(async () => {
    qcData = await deploy("QCData")
    qcManager = await deploy("QCManager", [qcData.address])
  })

  describe("QC Registration", () => {
    it("should register QC with valid parameters", async () => {
      await qcManager.registerQC(
        qc.address,
        "Test QC",
        ethers.utils.parseEther("1000")
      )

      const custodian = await qcData.getCustodian(qc.address)
      expect(custodian.name).to.equal("Test QC")
      expect(custodian.status).to.equal(QCStatus.Active)
    })

    it("should reject invalid QC address", async () => {
      await expect(
        qcManager.registerQC(
          ethers.constants.AddressZero,
          "Test QC",
          ethers.utils.parseEther("1000")
        )
      ).to.be.revertedWith("Invalid QC address")
    })
  })
})
```

### Integration Testing

**End-to-End Flow Tests**:

```typescript
// integration/QCMinting.test.ts
describe("QC Minting Integration", () => {
  let contracts: DeployedContracts

  beforeEach(async () => {
    contracts = await deployAccountControlSystem()
  })

  it("should complete full minting flow", async () => {
    // 1. Register QC
    await contracts.qcManager.registerQC(
      qc.address,
      "Integration Test QC",
      ethers.utils.parseEther("1000")
    )

    // 2. Grant minting role
    await contracts.qcMinter.grantRole(MINTER_ROLE, qc.address)

    // 3. Execute minting
    const mintAmount = ethers.utils.parseEther("10")
    await contracts.qcMinter.connect(qc).requestMint(user.address, mintAmount)

    // 4. Verify results
    const userBalance = await contracts.tbtc.balanceOf(user.address)
    expect(userBalance).to.equal(mintAmount)

    const qcMinted = await contracts.qcData.getCustodian(qc.address)
    expect(qcMinted.currentMinted).to.equal(mintAmount)
  })
})
```

### SPV Testing

**SPV Proof Validation Tests**:

```typescript
// SPVValidator.test.ts
describe("SPV Proof Validation", () => {
  let spvValidator: SPVValidator

  beforeEach(async () => {
    spvValidator = await deploy("SPVValidator")
  })

  it("should validate correct SPV proof", async () => {
    const testData = loadTestBitcoinData()

    const isValid = await spvValidator.validateProof(
      testData.txInfo,
      testData.merkleProof,
      testData.challengeHash,
      testData.btcAddress
    )

    expect(isValid).to.be.true
  })

  it("should reject proof with wrong challenge", async () => {
    const testData = loadTestBitcoinData()
    const wrongChallenge = ethers.utils.randomBytes(32)

    await expect(
      spvValidator.validateProof(
        testData.txInfo,
        testData.merkleProof,
        wrongChallenge,
        testData.btcAddress
      )
    ).to.be.revertedWith("Challenge mismatch")
  })
})
```

### Load Testing

**Performance Testing Script**:

```typescript
// load-test.ts
async function performLoadTest() {
  const contracts = await loadContracts()
  const qcs = await setupTestQCs(100)

  console.log("Starting load test with 100 QCs...")

  // Test concurrent minting
  const mintPromises = qcs.map(async (qc, index) => {
    const mintAmount = ethers.utils.parseEther((index + 1).toString())
    return contracts.qcMinter.connect(qc).requestMint(qc.address, mintAmount)
  })

  const startTime = Date.now()
  await Promise.all(mintPromises)
  const endTime = Date.now()

  console.log(`Load test completed in ${endTime - startTime}ms`)
  console.log(`Average time per mint: ${(endTime - startTime) / 100}ms`)
}
```

---

## Security Implementation

### Access Control Patterns

**Role-Based Security**:

```solidity
contract SecureContract is AccessControl {
  // Define roles
  bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
  bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

  // Function-level access control
  function criticalOperation() external onlyRole(OPERATOR_ROLE) {
    require(!paused(), "Contract paused");
    _performOperation();
  }

  // Administrative functions
  function updateParameters(uint256 newValue) external onlyRole(ADMIN_ROLE) {
    require(newValue > 0 && newValue <= MAX_VALUE, "Invalid parameter");
    parameter = newValue;
    emit ParameterUpdated(newValue);
  }
}

```

### Emergency Controls

**Granular Pause Implementation**:

```solidity
contract SystemState {
  mapping(bytes32 => bool) public functionPaused;

  bytes32 public constant MINTING_PAUSED = keccak256("MINTING_PAUSED");
  bytes32 public constant REDEMPTION_PAUSED = keccak256("REDEMPTION_PAUSED");
  bytes32 public constant REGISTRATION_PAUSED =
    keccak256("REGISTRATION_PAUSED");

  modifier whenNotPaused(bytes32 functionId) {
    require(!functionPaused[functionId], "Function paused");
    _;
  }

  function pauseFunction(bytes32 functionId) external onlyRole(PAUSER_ROLE) {
    functionPaused[functionId] = true;
    emit FunctionPaused(functionId);
  }

  function unpauseFunction(bytes32 functionId) external onlyRole(PAUSER_ROLE) {
    functionPaused[functionId] = false;
    emit FunctionUnpaused(functionId);
  }
}

```

### Input Validation

**Comprehensive Validation Pattern**:

```solidity
contract QCManager {
  function registerQC(
    address qc,
    string calldata name,
    uint256 maxMintingCap
  ) external onlyRole(QC_GOVERNANCE_ROLE) {
    // Address validation
    require(qc != address(0), "Invalid QC address");
    require(qc != address(this), "Cannot self-register");

    // String validation
    require(bytes(name).length > 0, "Name required");
    require(bytes(name).length <= 100, "Name too long");

    // Amount validation
    require(maxMintingCap > 0, "Capacity required");
    require(maxMintingCap <= MAX_QC_CAPACITY, "Capacity too high");

    // State validation
    require(!_isRegistered(qc), "QC already registered");

    // Business logic validation
    uint256 totalCapacity = _getTotalCapacity() + maxMintingCap;
    require(totalCapacity <= GLOBAL_CAPACITY_LIMIT, "Global limit exceeded");

    _registerQC(qc, name, maxMintingCap);
  }
}

```

### Reentrancy Protection

**ReentrancyGuard Usage**:

```solidity
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract BasicMintingPolicy is ReentrancyGuard {
  function requestMint(
    address qc,
    address user,
    uint256 amount
  ) external onlyRole(MINTER_ROLE) nonReentrant returns (bytes32) {
    // External calls protected against reentrancy
    _validateRequest(qc, user, amount);

    Bank bank = Bank(protocolRegistry.getService(BANK_KEY));
    bank.increaseBalanceAndCall(); /* parameters */

    return _completeMint(qc, amount);
  }
}

```

---

## Monitoring and Operations

### Event-Based Monitoring

**Comprehensive Event System**:

```solidity
contract QCManager {
  // QC lifecycle events
  event QCRegistered(address indexed qc, string name, uint256 maxCapacity);
  event QCStatusChanged(
    address indexed qc,
    QCStatus oldStatus,
    QCStatus newStatus,
    bytes32 reason
  );
  event QCCapacityUpdated(
    address indexed qc,
    uint256 oldCapacity,
    uint256 newCapacity
  );

  // Wallet management events
  event WalletRegistered(
    address indexed qc,
    string btcAddress,
    bytes32 challengeHash
  );
  event WalletDeregistered(
    address indexed qc,
    string btcAddress,
    bytes32 reason
  );

  // Operational events
  event MintingRequested(
    address indexed qc,
    address indexed user,
    uint256 amount,
    bytes32 mintId
  );
  event MintingCompleted(
    address indexed qc,
    address indexed user,
    uint256 amount,
    bytes32 mintId
  );
}

```

### Health Check Implementation

**System Health Monitoring**:

```solidity
contract SystemHealthCheck {
  function getSystemHealth() external view returns (SystemHealth memory) {
    return
      SystemHealth({
        totalQCs: _getTotalQCs(),
        activeQCs: _getActiveQCs(),
        totalMinted: _getTotalMinted(),
        totalCapacity: _getTotalCapacity(),
        systemPaused: systemState.systemPaused(),
        lastUpdateTime: block.timestamp
      });
  }

  function getQCHealth(address qc) external view returns (QCHealth memory) {
    QCData.Custodian memory custodian = qcData.getCustodian(qc);

    return
      QCHealth({
        status: custodian.status,
        currentMinted: custodian.currentMinted,
        maxCapacity: custodian.maxMintingCap,
        utilizationRate: (custodian.currentMinted * 100) /
          custodian.maxMintingCap,
        lastActivity: _getLastActivity(qc),
        walletCount: _getWalletCount(qc)
      });
  }
}

```

### Alerting Framework

**Automated Alert Generation**:

```typescript
// monitoring/alerts.ts
class AlertManager {
  async checkSystemHealth() {
    const health = await this.contracts.healthCheck.getSystemHealth()

    // Critical alerts
    if (health.systemPaused) {
      await this.sendAlert(AlertLevel.CRITICAL, "System paused", health)
    }

    // Warning alerts
    const utilizationRate = (health.totalMinted * 100) / health.totalCapacity
    if (utilizationRate > 90) {
      await this.sendAlert(AlertLevel.WARNING, "High system utilization", {
        utilizationRate,
      })
    }

    // QC-specific checks
    const activeQCs = await this.getActiveQCs()
    for (const qc of activeQCs) {
      await this.checkQCHealth(qc)
    }
  }

  async checkQCHealth(qc: string) {
    const health = await this.contracts.healthCheck.getQCHealth(qc)

    // QC-specific alerts
    if (health.status !== QCStatus.Active) {
      await this.sendAlert(AlertLevel.WARNING, `QC ${qc} not active`, health)
    }

    if (health.utilizationRate > 95) {
      await this.sendAlert(AlertLevel.WARNING, `QC ${qc} near capacity`, health)
    }

    const timeSinceLastActivity = Date.now() - health.lastActivity * 1000
    if (timeSinceLastActivity > 7 * 24 * 60 * 60 * 1000) {
      // 7 days
      await this.sendAlert(
        AlertLevel.INFO,
        `QC ${qc} inactive for 7 days`,
        health
      )
    }
  }
}
```

### Operational Dashboards

**Real-time Metrics Collection**:

```typescript
// monitoring/metrics.ts
class MetricsCollector {
  async collectSystemMetrics() {
    const contracts = await this.loadContracts()

    const metrics = {
      // System-wide metrics
      totalQCs: await this.getTotalQCs(),
      activeQCs: await this.getActiveQCs(),
      totalMinted: await this.getTotalMinted(),
      globalUtilization: await this.getGlobalUtilization(),

      // Performance metrics
      avgMintTime: await this.getAverageMintTime(),
      mintSuccessRate: await this.getMintSuccessRate(),
      recentTxCount: await this.getRecentTransactionCount(),

      // Watchdog metrics
      activeWatchdogs: await this.getActiveWatchdogCount(),
      consensusParticipation: await this.getConsensusParticipation(),
      emergencyReports: await this.getRecentEmergencyReports(),

      timestamp: Date.now(),
    }

    await this.publishMetrics(metrics)
    return metrics
  }
}
```

---

## Conclusion

This comprehensive implementation guide provides all necessary information for deploying, configuring, and operating the tBTC v2 Account Control system. The modular architecture, extensive security controls, and operational monitoring capabilities ensure a robust, scalable, and maintainable system.

Key implementation highlights:

- **Direct Bank Integration**: 50% gas reduction through efficient contract interactions
- **Comprehensive Security**: Multi-layered access control and emergency mechanisms
- **SPV Verification**: Cryptographic proof of Bitcoin wallet ownership
- **Role-Based Management**: Granular permissions for different system participants
- **Operational Excellence**: Extensive monitoring, alerting, and health checking

The system is designed for production deployment with institutional-grade security, compliance, and operational requirements while maintaining the flexibility for future enhancements and protocol evolution.

---

**Document History**:

- v2.0 (2025-08-04): Consolidated implementation guide
- Combines: IMPLEMENTATION.md, SPV_USAGE_IN_ACCOUNT_CONTROL.md, ACCOUNT_CONTROL_ROLE_MANAGEMENT.md
- Coverage: Complete deployment, configuration, security, and operations guidance
