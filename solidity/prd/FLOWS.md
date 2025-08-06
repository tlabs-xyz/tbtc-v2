# Account Control User Flows and Sequences

**Document Version**: 2.0  
**Date**: 2025-08-06  
**Architecture**: Simplified Watchdog System  
**Purpose**: User journeys and sequence diagrams for Account Control system  
**Related Documents**: [README.md](README.md), [REQUIREMENTS.md](REQUIREMENTS.md), [ARCHITECTURE.md](ARCHITECTURE.md), [IMPLEMENTATION.md](IMPLEMENTATION.md)

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Core User Flows](#3-core-user-flows)
4. [Error and Edge Case Flows](#4-error-and-edge-case-flows)
5. [Governance and Administrative Flows](#5-governance-and-administrative-flows)
6. [Implementation Requirements](#6-implementation-requirements)
7. [Script Structure and Examples](#7-script-structure-and-examples)
8. [Testnet Environment Setup](#8-testnet-environment-setup)

---

## 1. Executive Summary

### 1.1 Purpose

This document provides a complete inventory of user flows in the tBTC v2 Account Control system that require testnet validation through TypeScript testing scripts. The flows cover all critical paths from QC onboarding to redemption fulfillment, including error scenarios and governance operations.

### 1.2 System Participants

- **Qualified Custodians (QCs)**: Regulated entities holding Bitcoin reserves
- **End Users**: Individuals minting/redeeming tBTC through QCs
- **Oracle Attesters**: Multiple entities providing reserve attestations
- **Watchdog Reporters**: Entities reporting subjective observations
- **DAO Governance**: Decentralized governance managing system parameters
- **Emergency Council**: Entity with pause/unpause capabilities

### 1.3 Key Components

- **ProtocolRegistry**: Central address book for modular upgrades
- **QCManager**: Core QC lifecycle and status management
- **QCMinter/QCRedeemer**: Entry points for minting/redemption
- **Policy Contracts**: Upgradeable business logic (BasicMintingPolicy, BasicRedemptionPolicy)
- **QCReserveLedger**: Reserve attestation management
- **ReserveOracle**: Multi-attester consensus for reserve balances
- **WatchdogEnforcer**: Permissionless enforcement of objective violations
- **WatchdogSubjectiveReporting**: Transparent reporting via events

---

## 2. System Overview

### 2.1 Architecture Flow

```
User Request → QCMinter/QCRedeemer → Policy Contract → Core Logic → TBTC Token
                         ↓
            ProtocolRegistry (Service Discovery)
                         ↓
            QCManager ← QCData (State) → QCReserveLedger (Attestations)
```

### 2.2 Key States and Transitions

#### QC Status States

- **Active**: Fully operational, can mint and fulfill redemptions
- **UnderReview**: Minting paused, review in progress, cannot mint
- **Revoked**: Permanently terminated, no operations allowed

#### Redemption States

- **Pending**: Awaiting QC fulfillment on Bitcoin network
- **Fulfilled**: Successfully completed with SPV proof
- **Defaulted**: Failed to fulfill within timeout period

---

## 3. Core User Flows

### 3.1 QC Onboarding Flow

**Flow ID**: `QC-ONBOARD-001`  
**Priority**: Critical  
**Participants**: DAO Governance, QC, Watchdog

#### 3.1.1 Happy Path

1. **DAO Queues QC Onboarding** (Time-locked action)

   - DAO calls `QCManager.registerQC(qcAddress, maxMintingCap)`
   - 7-day waiting period begins
   - Event: `GovernanceActionQueued`

2. **DAO Executes QC Onboarding** (After time-lock)

   - System performs instant validation and onboarding
   - QC status set to `Active` in QCData
   - Event: `QCOnboarded`

3. **QC Registers Bitcoin Wallets**
   - QC generates Bitcoin addresses and creates OP_RETURN proof
   - QC calls `QCManager.requestWalletRegistration(btcAddress, spvProof)`
   - Watchdog validates proof and calls `QCManager.finalizeWalletRegistration(qc, btcAddress)`
   - Wallet status set to `Active`
   - Events: `WalletRegistrationRequested`, `WalletRegistered`

**Script Requirements**:

- Deploy all system contracts
- Set up DAO governance roles
- Generate Bitcoin addresses and OP_RETURN proofs
- Implement time-lock waiting and execution
- Validate final QC state and wallet registrations

#### 3.1.2 Error Scenarios

- **Invalid QC Address**: Zero address validation
- **Insufficient Time-lock**: Attempt execution before delay expires
- **Invalid SPV Proof**: Watchdog rejects wallet registration
- **Duplicate Registration**: Attempt to register same QC twice

### 3.2 Reserve Attestation Flow

**Flow ID**: `RESERVE-ATTEST-001`  
**Priority**: Critical  
**Participants**: Oracle Attesters, QC

#### 3.2.1 Happy Path

1. **Attesters Monitor QC Addresses**

   - Multiple attesters monitor registered Bitcoin addresses off-chain
   - Each calculates total reserves across all QC wallets

2. **Oracle Consensus Submission**

   - Each attester calls `ReserveOracle.submitAttestation(qc, balance)`
   - Oracle collects attestations until threshold met (minimum 3)
   - Median consensus calculated automatically
   - Oracle pushes consensus to `QCReserveLedger.recordConsensusAttestation()`
   - Events: `AttestationSubmitted`, `ConsensusReached`, `QCSolvencyVerified`

3. **Automated Status Management**
   - Anyone can call `WatchdogEnforcer.enforceObjectiveViolation()` if undercollateralized
   - If violation confirmed: QC status changes to `UnderReview`
   - Minting capabilities suspended
   - Event: `QCStatusChanged`

**Script Requirements**:

- Mock Bitcoin network monitoring
- Calculate reserve balances across multiple addresses
- Test solvency calculations and thresholds
- Validate automatic status transitions

#### 3.2.2 Error Scenarios

- **Stale Attestation**: Reject attestations older than threshold
- **Unauthorized Attester**: Non-watchdog attestation attempt
- **Undercollateralization**: Automatic status change to UnderReview

### 3.3 QC Minting Flow

**Flow ID**: `QC-MINT-001`  
**Priority**: Critical  
**Participants**: End User, QC, BasicMintingPolicy, TBTC Token

#### 3.3.1 Happy Path

1. **User Requests QC Minting**

   - User calls `QCMinter.requestQCMint(qcAddress, amount)`
   - QCMinter delegates to `BasicMintingPolicy.requestMint()`

2. **Policy Validation**

   - Check QC status is `Active`
   - Verify reserve freshness (attestation not stale)
   - Check available minting capacity
   - Validate amount against limits

3. **Token Minting**
   - Policy calls `TBTC.mint(user, amount)`
   - Update QC's minted balance in QCData
   - Events: `QCMintRequested`, `TBTCMinted`

**Script Requirements**:

- Set up user accounts with appropriate permissions
- Test capacity calculations and limits
- Validate policy checks (status, freshness, capacity)
- Verify token minting and balance updates

#### 3.3.2 Error Scenarios

- **Inactive QC**: Attempt minting with UnderReview/Revoked QC
- **Stale Reserves**: Minting blocked due to old attestation
- **Insufficient Capacity**: Amount exceeds available minting capacity
- **Policy Failure**: Various policy validation failures

### 3.4 User Redemption Flow

**Flow ID**: `USER-REDEEM-001`  
**Priority**: Critical  
**Participants**: End User, QC, Watchdog, BasicRedemptionPolicy

#### 3.4.1 Happy Path

1. **User Initiates Redemption**

   - User calls `QCRedeemer.initiateRedemption(qcAddress, amount)`
   - QCRedeemer burns user's tBTC tokens
   - Create redemption record with `Pending` status
   - Generate unique redemption ID

2. **QC Fulfillment Process**

   - QC receives redemption request
   - QC sends Bitcoin to user's address on Bitcoin network
   - QC provides transaction details to watchdog

3. **Watchdog Verification**
   - Watchdog monitors Bitcoin network for fulfillment
   - On successful payment: calls `BasicRedemptionPolicy.recordFulfillment(redemptionId, spvProof)`
   - Redemption status changes to `Fulfilled`
   - Events: `RedemptionRequested`, `RedemptionFulfilled`

**Script Requirements**:

- Mock Bitcoin network transactions
- Generate SPV proofs for fulfillment verification
- Test redemption ID generation and collision resistance
- Validate token burning and state transitions

#### 3.4.2 Timeout Scenarios

1. **Redemption Timeout**
   - Watchdog monitors for timeout expiration
   - Calls `BasicRedemptionPolicy.flagDefault(redemptionId)`
   - Redemption status changes to `Defaulted`
   - QC status may change to `UnderReview`
   - Event: `RedemptionDefaulted`

**Script Requirements**:

- Test timeout calculations and monitoring
- Validate default flagging process
- Test QC status changes on defaults

### 3.5 Wallet Management Flow

**Flow ID**: `WALLET-MGMT-001`  
**Priority**: High  
**Participants**: QC, Watchdog

#### 3.5.1 Wallet Deregistration

1. **QC Requests Deregistration**

   - QC calls `QCManager.requestWalletDeregistration(btcAddress)`
   - Wallet status changes to `PendingDeRegistration`
   - Event: `WalletDeRegistrationRequested`

2. **Solvency Check and Finalization**
   - Watchdog verifies QC remains solvent after wallet removal
   - Watchdog calls `QCManager.finalizeWalletDeregistration(qc, btcAddress)`
   - Wallet status changes to `Inactive`
   - Event: `WalletDeRegistrationFinalized`

**Script Requirements**:

- Test two-step deregistration process
- Validate solvency checks during deregistration
- Test race condition prevention

### 3.6 Policy Upgrade Flow

**Flow ID**: `POLICY-UPGRADE-001`  
**Priority**: High  
**Participants**: DAO Governance

#### 3.6.1 Minting Policy Upgrade

1. **Deploy New Policy Contract**

   - Deploy `AdvancedMintingPolicy` with new features
   - Initialize with required parameters

2. **Update Registry**

   - DAO calls `ProtocolRegistry.setService("MINTING_POLICY", newPolicyAddress)`
   - All subsequent mints use new policy
   - Event: `ServiceUpdated`

3. **Verify Upgrade**
   - Test new policy features
   - Ensure backward compatibility

**Script Requirements**:

- Deploy multiple policy versions
- Test seamless policy switching
- Validate no disruption to existing operations

---

## 4. Error and Edge Case Flows

### 4.1 Security Attack Scenarios

#### 4.1.1 Reentrancy Attack Flow

**Flow ID**: `SECURITY-REENTRANCY-001`  
**Test Objective**: Validate reentrancy protection in all external calls

**Script Requirements**:

- Deploy malicious contracts attempting reentrancy
- Test all functions with external calls (mint, redeem, attestation)
- Verify proper reentrancy guards

#### 4.1.2 Economic Attack Flow

**Flow ID**: `SECURITY-ECONOMIC-001`  
**Test Objective**: Validate economic security measures

**Scenarios**:

- **Undercollateralization Attack**: QC attempts to mint beyond reserves
- **Oracle Manipulation**: Attempt to submit false attestations
- **Redemption DoS**: Flood system with redemption requests

### 4.2 System Stress Testing

#### 4.2.1 High Volume Minting

**Flow ID**: `STRESS-MINT-001`  
**Test Objective**: System performance under high minting volume

**Script Requirements**:

- Generate multiple concurrent minting requests
- Test capacity limits and queuing
- Validate gas usage and transaction throughput

#### 4.2.2 Mass Redemption Scenario

**Flow ID**: `STRESS-REDEEM-001`  
**Test Objective**: System behavior during redemption surge

**Script Requirements**:

- Simulate multiple simultaneous redemptions
- Test QC fulfillment capacity
- Validate timeout and default handling

---

## 5. Governance and Administrative Flows

### 5.1 Emergency Pause Flow

**Flow ID**: `EMERGENCY-PAUSE-001`  
**Priority**: Critical  
**Participants**: Emergency Council, DAO

#### 5.1.1 Emergency Response

1. **Threat Detection**

   - Emergency council identifies security threat
   - Calls `SystemState.pauseSystem()` or specific function pauses

2. **System Recovery**
   - DAO investigates and resolves issue
   - Calls `SystemState.unpauseSystem()`
   - Operations resume normally

**Script Requirements**:

- Test granular pause capabilities
- Validate emergency response time
- Test system recovery procedures

### 5.2 Oracle Attester Management Flow

**Flow ID**: `ORACLE-MANAGE-001`  
**Priority**: High  
**Participants**: DAO Governance

#### 5.2.1 Attester Addition/Removal

1. **Add Attester**

   - DAO grants ATTESTER_ROLE to entity via `ReserveOracle.grantRole()`
   - Minimum 3 attesters maintained at all times

2. **Remove Attester**
   - DAO revokes ATTESTER_ROLE from entity
   - Ensure minimum attester count maintained
   - Verify consensus still achievable

**Script Requirements**:

- Test seamless watchdog transitions
- Validate no service interruption
- Test role management

---

## 6. Implementation Requirements

### 6.1 Core Dependencies

#### 6.1.1 Required NPM Packages

```json
{
  "dependencies": {
    "@openzeppelin/contracts": "^4.8.0",
    "hardhat": "^2.12.0",
    "@nomiclabs/hardhat-ethers": "^2.2.0",
    "@typechain/hardhat": "^6.1.0",
    "ethers": "^5.7.0",
    "chai": "^4.3.0",
    "typescript": "^4.9.0"
  }
}
```

#### 6.1.2 Hardhat Configuration

```typescript
// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config"
import "@nomiclabs/hardhat-ethers"
import "@typechain/hardhat"

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.17",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL,
      accounts: [process.env.PRIVATE_KEY!],
    },
    goerli: {
      url: process.env.GOERLI_RPC_URL,
      accounts: [process.env.PRIVATE_KEY!],
    },
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v5",
  },
}

export default config
```

### 6.2 Test Environment Setup

#### 6.2.1 Contract Deployment Script

```typescript
// scripts/deploy-account-control.ts
import { ethers } from "hardhat"
import {
  ProtocolRegistry,
  QCManager,
  QCData,
  SystemState,
  QCMinter,
  QCRedeemer,
  BasicMintingPolicy,
  BasicRedemptionPolicy,
  QCReserveLedger,
  SingleWatchdog,
} from "../typechain"

export async function deployAccountControlSystem() {
  console.log("Deploying Account Control System...")

  // Phase 1: Core Infrastructure
  const ProtocolRegistry = await ethers.getContractFactory("ProtocolRegistry")
  const protocolRegistry = await ProtocolRegistry.deploy()
  await protocolRegistry.deployed()
  console.log("ProtocolRegistry deployed to:", protocolRegistry.address)

  // Phase 2: State Management
  const QCData = await ethers.getContractFactory("QCData")
  const qcData = await QCData.deploy()
  await qcData.deployed()

  const SystemState = await ethers.getContractFactory("SystemState")
  const systemState = await SystemState.deploy()
  await systemState.deployed()

  const QCManager = await ethers.getContractFactory("QCManager")
  const qcManager = await QCManager.deploy(protocolRegistry.address)
  await qcManager.deployed()

  // Phase 3: Entry Points
  const QCMinter = await ethers.getContractFactory("QCMinter")
  const qcMinter = await QCMinter.deploy(protocolRegistry.address)
  await qcMinter.deployed()

  const QCRedeemer = await ethers.getContractFactory("QCRedeemer")
  const qcRedeemer = await QCRedeemer.deploy(protocolRegistry.address)
  await qcRedeemer.deployed()

  // Phase 4: Policy Layer
  const BasicMintingPolicy = await ethers.getContractFactory(
    "BasicMintingPolicy"
  )
  const basicMintingPolicy = await BasicMintingPolicy.deploy(
    protocolRegistry.address
  )
  await basicMintingPolicy.deployed()

  const BasicRedemptionPolicy = await ethers.getContractFactory(
    "BasicRedemptionPolicy"
  )
  const basicRedemptionPolicy = await BasicRedemptionPolicy.deploy(
    protocolRegistry.address
  )
  await basicRedemptionPolicy.deployed()

  const QCReserveLedger = await ethers.getContractFactory("QCReserveLedger")
  const qcReserveLedger = await QCReserveLedger.deploy(protocolRegistry.address)
  await qcReserveLedger.deployed()

  // Phase 5: Watchdog
  const SingleWatchdog = await ethers.getContractFactory("SingleWatchdog")
  const singleWatchdog = await SingleWatchdog.deploy(protocolRegistry.address)
  await singleWatchdog.deployed()

  // Phase 6: Service Registration
  await configureServices(protocolRegistry, {
    qcData,
    systemState,
    qcManager,
    qcMinter,
    qcRedeemer,
    basicMintingPolicy,
    basicRedemptionPolicy,
    qcReserveLedger,
    singleWatchdog,
  })

  return {
    protocolRegistry,
    qcData,
    systemState,
    qcManager,
    qcMinter,
    qcRedeemer,
    basicMintingPolicy,
    basicRedemptionPolicy,
    qcReserveLedger,
    singleWatchdog,
  }
}

async function configureServices(registry: ProtocolRegistry, contracts: any) {
  // Register all services
  await registry.setService(
    ethers.utils.id("QC_DATA"),
    contracts.qcData.address
  )
  await registry.setService(
    ethers.utils.id("SYSTEM_STATE"),
    contracts.systemState.address
  )
  await registry.setService(
    ethers.utils.id("QC_MANAGER"),
    contracts.qcManager.address
  )
  // ... register all other services

  console.log("All services registered in ProtocolRegistry")
}
```

### 6.3 Test Data Generation

#### 6.3.1 Bitcoin SPV Mock Data

```typescript
// utils/bitcoin-mocks.ts
export function generateMockSPVProof() {
  return {
    txHash: "0x1234567890abcdef...",
    merkleProof: ["0xabcd...", "0xefgh..."],
    blockHeader: "0x0100000000000000...",
    coinbaseProof: {
      merkleProof: ["0x1111...", "0x2222..."],
      position: 0,
    },
  }
}

export function generateBitcoinAddress() {
  // Generate testnet Bitcoin address
  return "tb1q" + Math.random().toString(36).substring(2, 42)
}

export function createOPReturnProof(qcAddress: string, btcAddress: string) {
  const data = `PROOF:${qcAddress}:${btcAddress}:${Date.now()}`
  return {
    opReturnData: Buffer.from(data).toString("hex"),
    spvProof: generateMockSPVProof(),
  }
}
```

---

## 7. Script Structure and Examples

### 7.1 Base Test Script Template

```typescript
// scripts/flows/base-flow-test.ts
import { ethers } from "hardhat"
import { expect } from "chai"
import { deployAccountControlSystem } from "../deploy-account-control"
import {
  generateBitcoinAddress,
  createOPReturnProof,
} from "../../utils/bitcoin-mocks"

export abstract class BaseFlowTest {
  protected contracts: any
  protected signers: any
  protected serviceKeys: any

  async setup() {
    console.log("Setting up test environment...")

    // Deploy contracts
    this.contracts = await deployAccountControlSystem()

    // Get signers
    const [deployer, governance, qc, user, watchdog] = await ethers.getSigners()
    this.signers = { deployer, governance, qc, user, watchdog }

    // Generate service keys
    this.serviceKeys = {
      QC_DATA: ethers.utils.id("QC_DATA"),
      QC_MANAGER: ethers.utils.id("QC_MANAGER"),
      MINTING_POLICY: ethers.utils.id("MINTING_POLICY"),
      // ... other keys
    }

    // Configure roles and permissions
    await this.configureRoles()

    console.log("Test environment ready")
  }

  async configureRoles() {
    const { qcManager, qcReserveLedger, singleWatchdog } = this.contracts
    const { watchdog } = this.signers

    // Grant watchdog roles
    const ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE")
    const REGISTRAR_ROLE = ethers.utils.id("REGISTRAR_ROLE")
    const ARBITER_ROLE = ethers.utils.id("ARBITER_ROLE")

    await qcReserveLedger.grantRole(ATTESTER_ROLE, watchdog.address)
    await qcManager.grantRole(REGISTRAR_ROLE, watchdog.address)
    await qcManager.grantRole(ARBITER_ROLE, watchdog.address)
  }

  abstract async executeFlow(): Promise<void>

  async run() {
    try {
      await this.setup()
      await this.executeFlow()
      console.log("✅ Flow test completed successfully")
    } catch (error) {
      console.error("❌ Flow test failed:", error)
      throw error
    }
  }
}
```

### 7.2 QC Onboarding Flow Script

```typescript
// scripts/flows/qc-onboarding-flow.ts
import { BaseFlowTest } from "./base-flow-test"
import {
  generateBitcoinAddress,
  createOPReturnProof,
} from "../../utils/bitcoin-mocks"
import { time } from "@nomicfoundation/hardhat-network-helpers"

export class QCOnboardingFlow extends BaseFlowTest {
  async executeFlow() {
    console.log("🚀 Starting QC Onboarding Flow")

    const { qcManager } = this.contracts
    const { governance, qc, watchdog } = this.signers

    // Step 1: Queue QC Onboarding (Time-locked)
    console.log("Step 1: Queueing QC onboarding...")
    const maxMintingCap = ethers.utils.parseEther("1000")

    await qcManager.connect(governance).registerQC(qc.address, maxMintingCap)
    console.log("✅ QC onboarding queued with 7-day delay")

    // Step 2: Wait for time-lock period
    console.log("Step 2: Waiting for time-lock period...")
    await time.increase(7 * 24 * 60 * 60) // 7 days
    console.log("✅ Time-lock period elapsed")

    // Step 3: Execute QC Onboarding
    console.log("Step 3: Executing QC onboarding...")
    await qcManager.connect(governance)
    // No additional step needed - instant execution

    // Verify QC status
    const qcStatus = await qcManager.getQCStatus(qc.address)
    expect(qcStatus).to.equal(1) // Active
    console.log("✅ QC onboarded successfully with Active status")

    // Step 4: Register Bitcoin Wallet
    console.log("Step 4: Registering Bitcoin wallet...")
    const btcAddress = generateBitcoinAddress()
    const proof = createOPReturnProof(qc.address, btcAddress)

    // QC requests wallet registration
    await qcManager
      .connect(qc)
      .requestWalletRegistration(btcAddress, proof.spvProof)
    console.log("✅ Wallet registration requested")

    // Watchdog finalizes registration
    await qcManager
      .connect(watchdog)
      .finalizeWalletRegistration(qc.address, btcAddress)
    console.log("✅ Wallet registration finalized")

    // Verify wallet status
    const walletStatus = await qcManager.getWalletStatus(qc.address, btcAddress)
    expect(walletStatus).to.equal(1) // Active
    console.log("✅ Bitcoin wallet registered successfully")

    console.log("🎉 QC Onboarding Flow completed successfully")
  }
}

// Execute if run directly
if (require.main === module) {
  const flow = new QCOnboardingFlow()
  flow.run().catch(console.error)
}
```

### 7.3 Full Minting Flow Script

```typescript
// scripts/flows/minting-flow.ts
import { BaseFlowTest } from "./base-flow-test"
import { ethers } from "hardhat"

export class MintingFlow extends BaseFlowTest {
  async executeFlow() {
    console.log("🚀 Starting QC Minting Flow")

    const { qcMinter, qcReserveLedger, tbtc } = this.contracts
    const { qc, user, watchdog } = this.signers

    // Prerequisites: QC must be onboarded and have reserves
    await this.setupQCWithReserves()

    // Step 1: User requests minting
    console.log("Step 1: User requesting mint...")
    const mintAmount = ethers.utils.parseEther("10")

    const initialBalance = await tbtc.balanceOf(user.address)

    await qcMinter.connect(user).requestQCMint(qc.address, mintAmount)
    console.log("✅ Mint request submitted")

    // Step 2: Verify minting completed
    const finalBalance = await tbtc.balanceOf(user.address)
    const mintedAmount = finalBalance.sub(initialBalance)

    expect(mintedAmount).to.equal(mintAmount)
    console.log(
      `✅ Successfully minted ${ethers.utils.formatEther(mintedAmount)} tBTC`
    )

    console.log("🎉 Minting Flow completed successfully")
  }

  async setupQCWithReserves() {
    // This would be implemented to:
    // 1. Register QC
    // 2. Register Bitcoin wallet
    // 3. Submit reserve attestation
    // ... setup code
  }
}
```

### 7.4 Redemption Flow Script

```typescript
// scripts/flows/redemption-flow.ts
import { BaseFlowTest } from "./base-flow-test"
import { ethers } from "hardhat"
import { time } from "@nomicfoundation/hardhat-network-helpers"

export class RedemptionFlow extends BaseFlowTest {
  async executeFlow() {
    console.log("🚀 Starting Redemption Flow")

    const { qcRedeemer, basicRedemptionPolicy, tbtc } = this.contracts
    const { qc, user, watchdog } = this.signers

    // Prerequisites: User must have tBTC tokens
    await this.setupUserWithTokens()

    // Step 1: User initiates redemption
    console.log("Step 1: User initiating redemption...")
    const redeemAmount = ethers.utils.parseEther("5")
    const btcReceiveAddress = "tb1qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

    const tx = await qcRedeemer
      .connect(user)
      .initiateRedemption(qc.address, redeemAmount, btcReceiveAddress)

    const receipt = await tx.wait()
    const event = receipt.events?.find((e) => e.event === "RedemptionRequested")
    const redemptionId = event?.args?.redemptionId

    console.log(`✅ Redemption initiated with ID: ${redemptionId}`)

    // Step 2: Verify redemption state
    const redemption = await qcRedeemer.getRedemption(redemptionId)
    expect(redemption.status).to.equal(1) // Pending
    expect(redemption.amount).to.equal(redeemAmount)
    console.log("✅ Redemption record created with Pending status")

    // Step 3: Simulate QC fulfillment
    console.log("Step 3: Simulating QC fulfillment...")
    const fulfillmentProof = this.generateFulfillmentProof(
      redemptionId,
      btcReceiveAddress,
      redeemAmount
    )

    await basicRedemptionPolicy
      .connect(watchdog)
      .recordFulfillment(redemptionId, fulfillmentProof)

    // Step 4: Verify fulfillment
    const updatedRedemption = await qcRedeemer.getRedemption(redemptionId)
    expect(updatedRedemption.status).to.equal(2) // Fulfilled
    console.log("✅ Redemption fulfilled successfully")

    console.log("🎉 Redemption Flow completed successfully")
  }

  async setupUserWithTokens() {
    // Mint tokens for user via QC
    // ... setup code
  }

  generateFulfillmentProof(
    redemptionId: string,
    btcAddress: string,
    amount: any
  ) {
    // Generate mock SPV proof for Bitcoin transaction
    return {
      txHash: "0x" + "1".repeat(64),
      merkleProof: ["0x" + "a".repeat(64)],
      blockHeader: "0x" + "0".repeat(160),
    }
  }
}
```

---

## 8. Testnet Environment Setup

### 8.1 Environment Configuration

#### 8.1.1 Environment Variables

```bash
# .env file
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID
GOERLI_RPC_URL=https://goerli.infura.io/v3/YOUR_PROJECT_ID
PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...

# Test configuration
TEST_QC_ADDRESS=0x...
TEST_USER_ADDRESS=0x...
TEST_WATCHDOG_ADDRESS=0x...
```

#### 8.1.2 Network Configuration

```typescript
// config/networks.ts
export const networkConfig = {
  sepolia: {
    name: "Sepolia",
    chainId: 11155111,
    blockConfirmations: 6,
    tbtcToken: "0x...", // Existing tBTC token on Sepolia
    timeout: {
      redemption: 86400, // 24 hours
      attestation: 3600, // 1 hour
    },
  },
  goerli: {
    name: "Goerli",
    chainId: 5,
    blockConfirmations: 6,
    tbtcToken: "0x...", // Existing tBTC token on Goerli
    timeout: {
      redemption: 86400,
      attestation: 3600,
    },
  },
}
```

### 8.2 Test Execution Framework

#### 8.2.1 Flow Runner Script

```typescript
// scripts/run-all-flows.ts
import { QCOnboardingFlow } from "./flows/qc-onboarding-flow"
import { MintingFlow } from "./flows/minting-flow"
import { RedemptionFlow } from "./flows/redemption-flow"

async function runAllFlows() {
  console.log("🚀 Starting comprehensive testnet flow testing")

  const flows = [
    new QCOnboardingFlow(),
    new MintingFlow(),
    new RedemptionFlow(),
  ]

  for (const flow of flows) {
    try {
      await flow.run()
      console.log(`✅ ${flow.constructor.name} completed successfully`)
    } catch (error) {
      console.error(`❌ ${flow.constructor.name} failed:`, error)
    }
  }

  console.log("🎉 All flow tests completed")
}

// Execute
runAllFlows().catch(console.error)
```

---

## 9. Implementation Checklist

### 9.1 Development Phases

**Phase 1: Infrastructure Setup** (Week 1)

- [ ] Set up testnet accounts and funding
- [ ] Deploy base contract suite
- [ ] Configure ProtocolRegistry
- [ ] Implement basic test utilities

**Phase 2: Core Flow Scripts** (Week 2)

- [ ] QC onboarding flow
- [ ] Reserve attestation flow
- [ ] Minting flow
- [ ] Redemption flow

**Phase 3: Advanced Flows** (Week 3)

- [ ] Policy upgrade flows
- [ ] Emergency response flows
- [ ] Wallet management flows
- [ ] Governance flows

**Phase 4: Error Testing** (Week 4)

- [ ] Security attack scenarios
- [ ] Edge case handling
- [ ] Stress testing
- [ ] Performance validation

**Phase 5: Automation** (Week 5)

- [ ] Continuous testing setup
- [ ] Monitoring and alerting
- [ ] Report generation
- [ ] Documentation completion

### 9.2 Success Metrics

- **Functional Coverage**: 100% of critical user flows tested
- **Error Coverage**: All identified error scenarios validated
- **Performance**: Gas usage within 10% of estimates
- **Reliability**: 99%+ success rate on repeated test runs
- **Documentation**: Complete implementation guide for future maintainers

This comprehensive flows document provides the foundation for implementing robust testnet testing scripts that validate all critical paths in the tBTC v2 Account Control system. Each flow includes detailed implementation requirements, error scenarios, and success criteria to ensure thorough validation of the system's functionality on real testnet environments.
