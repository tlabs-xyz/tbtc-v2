# Account Control User Flows and Sequences

**Document Version**: 3.0  
**Date**: 2025-08-11  
**Architecture**: Simplified Account Control System  
**Purpose**: User journeys and sequence diagrams for Account Control system  
**Related Documents**: [README.md](README.md), [REQUIREMENTS.md](REQUIREMENTS.md), [ARCHITECTURE.md](ARCHITECTURE.md)

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Core User Flows](#3-core-user-flows)
4. [Error and Edge Case Flows](#4-error-and-edge-case-flows)
5. [Governance and Administrative Flows](#5-governance-and-administrative-flows)
6. [Implementation Requirements](#6-implementation-requirements)
7. [Script Structure and Examples](#7-script-structure-and-examples)
8. [Testnet Environment Setup](#8-testnet-environment-setup)
9. [Audit Trail and Monitoring](#9-audit-trail-and-monitoring)

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

### 1.3 Key System Components

**Core Components**:
- **QCManager**: Manages QC registration, status, and Bitcoin wallet associations
- **QCMinter**: Handles minting requests from QCs on behalf of users
- **QCRedeemer**: Processes redemption requests from users
- **QCData**: Stores QC information and status
- **SystemState**: Manages system-wide parameters and emergency controls
- **ReserveOracle**: Tracks Bitcoin reserves via multi-attester consensus
- **WatchdogEnforcer**: Monitors and enforces collateralization requirements

---

## 2. System Overview

### 2.1 System Flow

```
User Request → QCMinter/QCRedeemer → Bank → TBTC Token
                         ↓
            QCManager ← QCData (State) → ReserveOracle (Attestations)
```

### 2.2 Key States and Transitions

#### QC Status States (5-State Model)

- **Active**: Fully operational, can mint and fulfill redemptions
- **MintingPaused**: Can fulfill redemptions but cannot mint (self-initiated or watchdog)
- **Paused**: Cannot mint or fulfill (self-initiated maintenance mode, 48h max)
- **UnderReview**: Can fulfill but cannot mint (council review required)
- **Revoked**: Permanently terminated, no operations allowed

#### State Transition Rules
```
Active ↔ MintingPaused (QC self-pause for routine maintenance)
MintingPaused → Paused (QC escalates for full maintenance)  
Paused → UnderReview (Auto-escalation after 48h if not resumed)
MintingPaused/Paused → Active (QC resumes early)
UnderReview → Active/Revoked (Council decision)
```

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

1. **DAO Registers QC** (Instant action)

   - DAO calls `QCManager.registerQC(qcAddress, maxMintingCap)` with `GOVERNANCE_ROLE`
   - QC status immediately set to `Active` in QCData
   - Events: `QCRegistrationInitiated`, `QCOnboarded`

2. **QC Initiates Wallet Registration**

   - QC generates Bitcoin addresses and creates OP_RETURN proof
   - QC submits wallet registration request (off-chain or via separate interface)
   - Event: `WalletRegistrationRequested`

3. **Watchdog Validates and Registers Wallet**
   - Watchdog validates message signature for wallet ownership
   - Watchdog calls `QCManager.registerWallet(qc, btcAddress, spvProof)` with `REGISTRAR_ROLE`
   - Wallet status set to `Active`
   - Event: `WalletRegistered`

**Script Requirements**:

- Deploy all system contracts
- Set up DAO governance roles (`GOVERNANCE_ROLE`)
- Set up watchdog roles (`REGISTRAR_ROLE`, `ATTESTER_ROLE`)
- Generate Bitcoin addresses and OP_RETURN proofs
- Validate final QC state and wallet registrations

4. **Initial Zero Balance Attestation**

   - Attesters submit initial zero balance for newly registered QC
   - Establishes baseline monitoring from registration
   - No monitoring blind spots during initial setup period

5. **Pause Credit Initialization** (⚠️ **Manual Step Required**)

   - Admin must call `QCRenewablePause.grantInitialCredit(qc)` separately
   - **Not automatic** - requires explicit admin action with DEFAULT_ADMIN_ROLE
   - Credit becomes available only after manual grant
   - 90-day renewal cycle begins from first credit usage

#### 3.1.2 Complete Lifecycle Support

The onboarding flow now supports the complete QC lifecycle from registration through wind-down, including zero balance monitoring and renewable pause credits.

#### 3.1.3 Error Scenarios

- **Invalid QC Address**: Zero address validation
- **Insufficient Capacity**: Zero minting capacity provided
- **Invalid Message Signature**: Watchdog rejects wallet registration
- **Duplicate Registration**: Attempt to register same QC twice
- **Unauthorized Role**: Non-governance attempts QC registration

### 3.2 Reserve Attestation Flow

**Flow ID**: `RESERVE-ATTEST-001`  
**Priority**: Critical  
**Participants**: Oracle Attesters, QC

#### 3.2.1 Happy Path

1. **Attesters Monitor QC Addresses**

   - Multiple attesters monitor registered Bitcoin addresses off-chain
   - Each calculates total reserves across all QC wallets
   - Zero balances are accepted (for new QCs or wind-down)

2. **Attestation Submission and Consensus**

   - Each attester calls `submitAttestation(qc, balance)` with `ATTESTER_ROLE`
   - Zero balance attestations are now accepted
   - System collects attestations until `consensusThreshold` met (default 3)
   - Median consensus calculated automatically when threshold reached
   - Reserve balance updated in ReserveOracle
   - Events: `AttestationSubmitted`, `ConsensusReached`, `ReserveUpdated`

3. **Automated Status Management**
   - Anyone can call enforcement if undercollateralized
   - If violation confirmed: QC status changes to `UnderReview`
   - Minting capabilities suspended
   - Zero balance QCs remain monitored but cannot mint

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
**Participants**: End User, QC, System

#### 3.3.1 Happy Path

1. **QC Requests Minting** (On behalf of user) (⚠️ **MINTER_ROLE Required**)

   - QC calls `QCMinter.requestQCMint(qc, amount)` with MINTER_ROLE 
   - **Prerequisites**: QC must have been granted MINTER_ROLE after registration
   - **Manual Step**: Admin must call `QCMinter.grantRole(MINTER_ROLE, qcAddress)` 
   - System validates the request

2. **System Validation**

   - Confirms system is not paused
   - Verifies amount is within allowed bounds
   - Confirms QC status is `Active`
   - Checks available minting capacity against reserves

3. **Token Minting**
   - System processes the minting request
   - tBTC tokens are minted to the user's address
   - QC's minted amount is updated
   - Events: `MintCompleted`

**Script Requirements**:

- Set up user accounts with appropriate permissions
- Test capacity calculations and limits
- Validate system checks (status, freshness, capacity)
- Verify token minting and balance updates

#### 3.3.2 Error Scenarios

- **Inactive QC**: Attempt minting with UnderReview/Revoked QC
- **Stale Reserves**: Minting blocked due to old attestation
- **Insufficient Capacity**: Amount exceeds available minting capacity
- **Validation Failure**: System rejects request due to failed checks

### 3.4 User Redemption Flow

**Flow ID**: `USER-REDEEM-001`  
**Priority**: Critical  
**Participants**: End User, QC, Watchdog

#### 3.4.1 Happy Path

1. **User Initiates Redemption**

   - User calls `initiateRedemption(qc, amount, userBtcAddress)`
   - System burns user's tBTC tokens immediately
   - Creates redemption record with `Pending` status
   - Generates unique redemption ID
   - Event: `RedemptionRequested`

2. **QC Fulfillment Process**

   - QC monitors for redemption requests
   - QC sends Bitcoin to user's specified address within timeout period (7 days)
   - QC notifies watchdog of fulfillment

3. **Watchdog Verification and Completion**
   - Watchdog monitors Bitcoin network for fulfillment
   - Records successful payment in the system
   - Redemption status changes to `Fulfilled`
   - Event: `RedemptionFulfilled`

**Script Requirements**:

- Mock Bitcoin network transactions
- Test redemption ID generation and uniqueness
- Validate token burning and state transitions
- Test fulfillment recording process

#### 3.4.2 Timeout Scenarios

1. **Redemption Timeout with Graduated Consequences**
   - Watchdog monitors for timeout expiration
   - Calls `QCManager.handleRedemptionDefault(qc, redemptionId)`
   - Redemption status changes to `Defaulted`
   - QC status transitions based on graduated consequences:
     - 1st default: Active → MintingPaused
     - 2nd default (within 90d): MintingPaused → UnderReview  
     - 3rd default: UnderReview → Revoked
   - Events: `RedemptionDefaulted`, `QCStatusChanged`

**Script Requirements**:

- Test timeout calculations and monitoring
- Validate graduated consequence logic (1st, 2nd, 3rd defaults)
- Test QC recovery paths (backlog clearance)
- Test 90-day penalty window expiration
- **⚠️ CRITICAL BUG**: Flow states MintingPaused can fulfill, but code only allows Active+UnderReview (line 439-441)

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

### 3.6 QC Information and Status Queries

**Flow ID**: `QC-INFO-001`  
**Priority**: High  
**Participants**: QC, Users, System Monitors

#### 3.6.1 QC Status Queries

1. **Check QC Status**

   - Anyone can call `getQCStatus(qc)` to get current status
   - Returns: Active, MintingPaused, Paused, UnderReview, or Revoked
   - Used for operational decisions and monitoring

2. **Check QC Capabilities**

   - `canQCMint(qc)` - Returns if QC can currently mint tokens
   - `canQCFulfill(qc)` - Returns if QC can fulfill redemptions
   - Used to determine available operations

3. **Get Complete QC Information**

   - `getQCInfo(qc)` returns comprehensive QC data:
     - Current status and capabilities
     - Minting limits and current usage
     - Registration timestamp
     - Associated Bitcoin wallets

#### 3.6.2 Redemption Status Queries

**⚠️ Implementation Status**: The following IQCRedeemer interface methods are currently implemented with placeholder stubs for development purposes:

1. **Check Unfulfilled Redemptions**

   - `hasUnfulfilledRedemptions(qc)` - Currently returns `false` (safe default)
   - **TODO**: Requires QC-to-redemptions mapping for production
   - Used for operational planning and status assessment

2. **Get Redemption Deadlines**

   - `getEarliestRedemptionDeadline(qc)` - Currently returns `0` (no deadlines)
   - **TODO**: Requires deadline field in Redemption struct
   - Used for prioritizing fulfillment operations

3. **Count Pending Redemptions**

   - `getPendingRedemptionCount(qc)` - Currently returns `0` (no pending)
   - **TODO**: Requires QC redemption counters for production
   - Used for workload assessment

**Script Requirements**:

- Test all query functions return expected data (noting current stub implementations)
- Validate QC status and capability queries work across all QC states  
- Test actual query functions: `getQCStatus()`, `canQCMint()`, `canQCFulfill()`, `getQCInfo()`
- **Note**: Redemption query functions currently return static values per TODOs

### 3.7 QC Self-Pause Flow (5-State Model)

**Flow ID**: `QC-PAUSE-001`  
**Priority**: Critical  
**Participants**: QC, QCManager, WatchdogEnforcer

#### 3.7.1 Routine Maintenance (MintingPaused)

1. **QC Self-Initiates Pause**
   - QC calls `selfPause(PauseLevel.MintingOnly)`
   - Consumes 1 renewable pause credit
   - QC status changes to `MintingPaused`
   - Can still fulfill redemptions (network continuity)
   - 48h timer starts

2. **Early Resume**
   - QC can call `resumeSelfPause()` anytime before 48h
   - QC status returns to `Active`
   - 48h timer cleared

3. **Auto-Escalation**
   - If not resumed within 48h
   - System auto-escalates to `UnderReview`
   - Council intervention required

#### 3.7.2 Critical Maintenance (Full Pause)

1. **QC Escalates to Full Pause**
   - QC calls `selfPause(PauseLevel.Complete)`
   - QC status changes to `Paused`
   - Cannot mint OR fulfill redemptions
   - 48h timer starts

2. **Auto-Escalation After 48h**
   - If not resumed, auto-escalates to `UnderReview`
   - Council review required for restoration

**Script Requirements**:

- Test renewable pause credit consumption and renewal (90d cycles)
- Validate 48h auto-escalation timers
- Test early resume capabilities
- Validate network continuity (MintingPaused can fulfill)
- Test escalation monitoring

### 3.8 QC Renewable Pause Credits

**Flow ID**: `QC-CREDITS-001`  
**Priority**: High  
**Participants**: QC, System

#### 3.8.1 Pause Credit Management

1. **Credit Check**

   - QC calls `canSelfPause(qc)` to check available credits
   - Returns true if QC has unused pause credits
   - Each QC gets 1 credit per 90-day period

2. **Credit Consumption**

   - Self-pause consumes 1 credit
   - Credit is used regardless of pause duration
   - Early resume doesn't restore the credit

3. **Credit Renewal**

   - Credits automatically renew every 90 days
   - Renewal based on original registration timestamp
   - `getPauseInfo(qc)` returns credit status and renewal date

**Script Requirements**:

- Test 90-day renewal cycles
- Validate credit consumption and tracking
- Test edge cases around renewal timing

### 3.9 QC Auto-Escalation and Recovery

**Flow ID**: `QC-ESCALATION-001`  
**Priority**: Critical  
**Participants**: QC, Watchdog, Council

#### 3.9.1 Auto-Escalation Monitoring

1. **Escalation Eligibility Check**

   - Anyone can call `isEligibleForEscalation(qc)` to check
   - Returns true if QC has been paused beyond timeout (48h)
   - Used by watchdogs to identify escalation candidates

2. **Escalation Execution**

   - Watchdog calls escalation function for eligible QCs
   - QC status transitions from MintingPaused/Paused to UnderReview
   - QC loses ability to self-resume
   - Council intervention now required

#### 3.9.2 Recovery from UnderReview

1. **Backlog Assessment**

   - Council reviews QC's operational status
   - Checks if redemption backlogs are resolved
   - Verifies QC operational readiness

2. **Status Restoration**

   - Council calls `clearBacklog(qc)` if QC is ready
   - QC status returns to `Active`
   - QC can resume normal operations
   - Pause timeout tracking is cleared

**Script Requirements**:

- Test escalation eligibility detection
- Validate automatic status transitions
- Test council restoration process
- Verify timeout clearing

### 3.10 Policy Upgrade Flow

**Flow ID**: `POLICY-UPGRADE-001`  
**Priority**: High  
**Participants**: DAO Governance

#### 3.6.1 Minting Policy Upgrade

1. **Deploy New Policy Contract**

   - Deploy `AdvancedMintingPolicy` with new features
   - Initialize with required parameters

2. **Update Registry**

   - DAO would need to redeploy contracts (direct integration model)
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

### 5.3 Zero Balance Attestation Lifecycle

**Flow ID**: `ZERO-BALANCE-001`  
**Priority**: High  
**Participants**: Attesters, New QCs, Retiring QCs

#### 5.3.1 New QC Monitoring

1. **Initial Zero Balance**

   - Newly registered QC has no Bitcoin funds yet
   - Attesters can submit zero balance attestations
   - Enables monitoring from day one of registration
   - Prevents monitoring blind spots during onboarding

2. **First Funding Detection**

   - Attesters monitor for initial Bitcoin deposits
   - Normal attestation process begins once funds received
   - Seamless transition from zero to positive balance tracking

#### 5.3.2 QC Wind-Down Process

1. **Balance Reduction Monitoring**

   - QC reduces Bitcoin holdings during wind-down
   - Attesters continue monitoring as balance approaches zero
   - Maintains visibility through complete lifecycle

2. **Final Zero Balance**

   - QC completes operations and reaches zero balance
   - Attesters can confirm zero balance state
   - Enables clean operational closure without monitoring gaps

**Script Requirements**:

- Test zero balance attestation acceptance
- Validate transition from zero to positive balances
- Test complete lifecycle monitoring
- Ensure no monitoring blind spots

### 5.4 Emergency Consensus Flow

**Flow ID**: `EMERGENCY-CONSENSUS-001`  
**Priority**: Critical  
**Participants**: Arbiter, ReserveOracle

#### 5.4.1 Force Consensus Mechanism

1. **Consensus Failure Detection**

   - Normal attestation process fails to reach consensus threshold
   - Attesters unavailable or disputed attestations prevent agreement
   - System requires reserve update for critical operations

2. **Arbiter Intervention**

   - ARBITER role holder identifies consensus failure
   - Calls `forceConsensus(qc)` 
   - Requires at least one valid attestation to prevent arbitrary updates

3. **Emergency Consensus Applied**

   - Uses available attestations (even if below normal threshold)
   - Updates reserve balance with forced consensus
   - Events: `ForcedConsensusReached`, `ReserveUpdated`

**Script Requirements**:

- Test with partial attester availability
- Validate minimum attestation requirement
- Ensure ARBITER role authorization
- Test prevention of arbitrary reserve updates

### 5.5 QC Backlog Clearance Flow

**Flow ID**: `QC-BACKLOG-001`  
**Priority**: High  
**Participants**: Council, QC

#### 5.5.1 Council Review and Restoration

1. **Review Process**

   - Council reviews QC in UnderReview status
   - Assesses redemption backlog resolution
   - Verifies operational readiness
   - Confirms reserve adequacy

2. **Status Restoration**

   - Council calls `clearBacklog(qc)` for eligible QCs
   - QC status returns from UnderReview to Active
   - QC regains full operational capabilities
   - All timeout tracking is cleared

3. **Monitoring Resumption**

   - QC can resume normal minting operations
   - Reserve monitoring continues normally
   - Self-pause capabilities restored

**Script Requirements**:

- Test council review process
- Validate status restoration
- Test operational capability restoration
- Verify timeout clearing

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

export async function deployAccountControlSystem() {
  console.log("Deploying Account Control System...")

  // Deploy core components
  const qcData = await deployContract("QCData")
  const systemState = await deployContract("SystemState")
  const reserveOracle = await deployContract("ReserveOracle")
  const qcManager = await deployContract("QCManager")
  const qcMinter = await deployContract("QCMinter")
  const qcRedeemer = await deployContract("QCRedeemer")
  const watchdogEnforcer = await deployContract("WatchdogEnforcer")

  // Configure roles and permissions
  await configureSystemRoles()

  console.log("Account Control System deployed successfully")

  return {
    qcData,
    systemState,
    qcManager,
    qcMinter,
    qcRedeemer,
    reserveOracle,
    watchdogEnforcer,
  }
}
```

**Note**: The actual deployment is split across multiple scripts (95-99) in the `deploy/` directory.

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
    const { qcManager, reserveOracle, singleWatchdog } = this.contracts
    const { watchdog } = this.signers

    // Grant watchdog roles
    const ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE")
    const REGISTRAR_ROLE = ethers.utils.id("REGISTRAR_ROLE")
    const DISPUTE_ARBITER_ROLE = ethers.utils.id("DISPUTE_ARBITER_ROLE")

    await reserveOracle.grantRole(ATTESTER_ROLE, watchdog.address)
    await qcManager.grantRole(REGISTRAR_ROLE, watchdog.address)
    await qcManager.grantRole(DISPUTE_ARBITER_ROLE, watchdog.address)
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

    // Step 1: Register QC (Instant)
    console.log("Step 1: Registering QC...")
    const maxMintingCap = ethers.utils.parseEther("1000")

    await qcManager.connect(governance).registerQC(qc.address, maxMintingCap)
    console.log("✅ QC registered and activated instantly")

    // Verify QC status
    const qcStatus = await qcManager.getQCStatus(qc.address)
    expect(qcStatus).to.equal(0) // Active
    console.log("✅ QC onboarded successfully with Active status")

    // Step 2: Register Bitcoin Wallet
    console.log("Step 2: Registering Bitcoin wallet...")
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

    const { qcMinter, tbtc } = this.contracts
    const { qc, user } = this.signers

    // Prerequisites: QC must be onboarded and have reserves
    await this.setupQCWithReserves()

    // Step 1: QC requests minting on behalf of user
    console.log("Step 1: QC requesting mint for user...")
    const mintAmount = ethers.utils.parseEther("10")

    const initialBalance = await tbtc.balanceOf(user.address)

    await qcMinter.connect(qc).requestQCMint(qc.address, mintAmount)
    console.log("✅ Mint request submitted")

    // Step 2: Verify user received tokens
    const finalBalance = await tbtc.balanceOf(user.address)
    const mintedAmount = finalBalance.sub(initialBalance)

    expect(mintedAmount).to.equal(mintAmount)
    console.log(
      `✅ User received ${ethers.utils.formatEther(mintedAmount)} tBTC`
    )

    console.log("🎉 Minting Flow completed successfully")
  }

  async setupQCWithReserves() {
    // Setup steps:
    // 1. Register QC in the system
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

export class RedemptionFlow extends BaseFlowTest {
  async executeFlow() {
    console.log("🚀 Starting Redemption Flow")

    const { qcRedeemer } = this.contracts
    const { qc, user, watchdog } = this.signers

    // Prerequisites: User must have tBTC tokens
    await this.setupUserWithTokens()

    // Step 1: User initiates redemption
    console.log("Step 1: User requesting redemption...")
    const redeemAmount = ethers.utils.parseEther("5")
    const btcReceiveAddress = "tb1qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

    const tx = await qcRedeemer
      .connect(user)
      .initiateRedemption(qc.address, redeemAmount, btcReceiveAddress)

    const receipt = await tx.wait()
    const event = receipt.events?.find((e) => e.event === "RedemptionRequested")
    const redemptionId = event?.args?.redemptionId

    console.log(`✅ Redemption requested with ID: ${redemptionId}`)

    // Step 2: Verify redemption is pending
    const redemption = await qcRedeemer.getRedemption(redemptionId)
    expect(redemption.status).to.equal(1) // Pending
    console.log("✅ Redemption is pending QC fulfillment")

    // Step 3: Simulate QC fulfillment on Bitcoin network
    console.log("Step 3: QC fulfills redemption on Bitcoin...")
    
    // Watchdog records the fulfillment with SPV proof
    const mockTxInfo = this.generateMockBitcoinTx()
    const mockProof = this.generateMockSPVProof()
    
    await qcRedeemer
      .connect(watchdog)
      .recordRedemptionFulfillment(
        redemptionId,
        btcReceiveAddress,
        redeemAmount,
        mockTxInfo,
        mockProof
      )

    // Step 4: Verify redemption completed
    const updatedRedemption = await qcRedeemer.getRedemption(redemptionId)
    expect(updatedRedemption.status).to.equal(2) // Fulfilled
    console.log("✅ Redemption fulfilled - user received Bitcoin")

    console.log("🎉 Redemption Flow completed successfully")
  }

  async setupUserWithTokens() {
    // Give user tBTC tokens for redemption
    // ... setup code
  }

  generateMockBitcoinTx() {
    // Return mock BitcoinTx.Info structure
    return {
      version: "0x01000000",
      inputVector: "0x...", // Mock input data
      outputVector: "0x...", // Mock output data
      locktime: "0x00000000"
    }
  }

  generateMockSPVProof() {
    // Return mock BitcoinTx.Proof structure
    return {
      merkleProof: "0x...", // Mock merkle proof
      txIndexInBlock: 0,
      bitcoinHeaders: "0x..." // Mock block headers
    }
  }
}
```

### 7.5 QC Status Monitoring Script

```typescript
// scripts/flows/qc-status-monitoring.ts
import { BaseFlowTest } from "./base-flow-test"
import { ethers } from "hardhat"

export class QCStatusMonitoring extends BaseFlowTest {
  async executeFlow() {
    console.log("🚀 Starting QC Status Monitoring Flow")

    const { qcData, qcRedeemer } = this.contracts
    const { qc } = this.signers

    // Step 1: Query QC status
    console.log("Step 1: Checking QC status...")
    const status = await qcData.getQCStatus(qc.address)
    console.log(`QC Status: ${status}`) // 0=Active, 1=MintingPaused, etc.

    // Step 2: Check QC capabilities
    console.log("Step 2: Checking QC capabilities...")
    const canMint = await qcData.canQCMint(qc.address)
    const canFulfill = await qcData.canQCFulfill(qc.address)
    console.log(`Can mint: ${canMint}, Can fulfill: ${canFulfill}`)

    // Step 3: Get complete QC information
    console.log("Step 3: Getting complete QC info...")
    const qcInfo = await qcData.getQCInfo(qc.address)
    console.log(`QC Info - Status: ${qcInfo.status}, Minted: ${qcInfo.mintedAmount}`)

    // Step 4: Check redemption status (Note: Currently stubbed implementations)
    console.log("Step 4: Checking redemption status...")
    const hasUnfulfilled = await qcRedeemer.hasUnfulfilledRedemptions(qc.address)
    const pendingCount = await qcRedeemer.getPendingRedemptionCount(qc.address)
    console.log(`Has unfulfilled: ${hasUnfulfilled}, Pending count: ${pendingCount}`)
    console.log("⚠️ Note: Redemption status functions currently return static values per TODOs")

    console.log("🎉 QC Status Monitoring completed successfully")
  }
}
```

### 7.6 Self-Pause and Recovery Script

```typescript
// scripts/flows/qc-self-pause.ts
import { BaseFlowTest } from "./base-flow-test"
import { time } from "@nomicfoundation/hardhat-network-helpers"

export class QCSelfPauseFlow extends BaseFlowTest {
  async executeFlow() {
    console.log("🚀 Starting QC Self-Pause Flow")

    const { qcManager } = this.contracts
    const { qc } = this.signers

    // Step 1: Check pause credits
    console.log("Step 1: Checking pause credits...")
    const canPause = await qcManager.canSelfPause(qc.address)
    console.log(`QC can self-pause: ${canPause}`)

    if (!canPause) {
      console.log("❌ No pause credits available")
      return
    }

    // Step 2: Initiate self-pause
    console.log("Step 2: Initiating self-pause...")
    await qcManager.connect(qc).selfPause(0) // MintingOnly level
    console.log("✅ QC paused for maintenance")

    // Step 3: Check pause info
    const pauseInfo = await qcManager.getQCPauseInfo(qc.address)
    console.log(`Pause started at: ${pauseInfo.pauseTimestamp}`)

    // Step 4: Early resume
    console.log("Step 4: Resuming early...")
    await qcManager.connect(qc).resumeSelfPause()
    console.log("✅ QC resumed operations")

    console.log("🎉 Self-Pause Flow completed successfully")
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

## 9. System Status

### 9.1 Current Deployment

The Account Control system is deployed with the following components:

**Active Components**:
- QC registration and management
- Minting operations for qualified custodians
- User redemption processing
- Reserve attestation and monitoring
- Watchdog enforcement for collateralization

### 9.2 Known Limitations and Implementation Status

#### 9.2.1 Fully Implemented Features ✅

- **QC Status Management**: Complete 5-state model (Active, MintingPaused, Paused, UnderReview, Revoked)
- **QC Capability Queries**: `canQCMint()` and `canQCFulfill()` functions working correctly
- **Self-Pause System**: Complete with renewable credits (90-day cycles) and auto-escalation
- **Reserve Attestation**: Multi-attester consensus with zero balance support
- **Minting Operations**: Direct Bank integration with full validation
- **Redemption Core**: Token burning and redemption request creation

#### 9.2.2 CRITICAL IMPLEMENTATION BUGS 🚨

**URGENT**: The following critical discrepancies between documentation and code implementation were discovered during deep scrutiny:

**Bug #1 - Flow 3.1 QC Onboarding**: 
- **Documentation Claims**: "Pause Credit Initialization - QC receives initial renewable pause credit - Credit available immediately after registration"
- **Actual Implementation**: `QCManager.grantInitialCredit(qc)` must be called manually by admin (DEFAULT_ADMIN_ROLE)
- **Impact**: QCs cannot self-pause after registration without manual admin action
- **Location**: QCManager.sol (consolidated pause credit functionality)

**Bug #2 - Flow 3.3 QC Minting**: 
- **Documentation Claims**: "QC calls requestQCMint with appropriate permissions" 
- **Actual Implementation**: QCs must be manually granted MINTER_ROLE after registration
- **Impact**: Registered QCs cannot mint without separate role granting step
- **Location**: QCMinter.sol line 148-155, deploy script line 158-159

**Bug #3 - Flow 3.4 User Redemption**: ✅ RESOLVED
- **Documentation Claims**: "MintingPaused QCs can fulfill redemptions (network continuity)"
- **Previous Issue**: Only Active OR UnderReview QCs could redeem (breaking network continuity)
- **Resolution**: Added MintingPaused to allowed redemption statuses (QCRedeemer.sol lines 441)  
- **Status**: Fixed - MintingPaused QCs can now fulfill redemptions as documented

#### 9.2.3 Stubbed/Pending Implementation ⚠️

**Bitcoin Verification Methods**:
- **Message Signatures**: Used for wallet registration (proving QC controls Bitcoin addresses) ✅ PRODUCTION READY
- **SPV Proof Verification**: Used for redemption fulfillment (proving QC actually sent Bitcoin to users) - Leverages existing Bridge SPV infrastructure
- **Important**: Message signatures replaced SPV for wallet registration only. Redemption fulfillment still requires SPV proofs.

**IQCRedeemer Interface Methods**: Placeholder implementations in QCRedeemer
- `hasUnfulfilledRedemptions(qc)` - Always returns false (line 625)
- `getEarliestRedemptionDeadline(qc)` - Always returns 0 (line 640)
- `getPendingRedemptionCount(qc)` - Always returns 0 (line 653)
- **Impact**: QC workload assessment and deadline tracking unavailable
- **Status**: Requires additional data structures for production

#### 9.2.3 Testing Considerations

- **Script Development**: Use actual contract functions as documented
- **Redemption Monitoring**: Expect static values from IQCRedeemer interface methods
- **SPV Testing**: All SPV-related functions will pass validation (stubbed)
- **Production Readiness**: Core functionality complete, monitoring features require implementation

## 10. Implementation Checklist

### 10.1 Development Phases

**Phase 1: Infrastructure Setup** (Week 1)

- [ ] Set up testnet accounts and funding
- [ ] Deploy base contract suite
- [ ] Deploy contracts with direct dependencies
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

### 10.2 Success Metrics

- **Functional Coverage**: 100% of critical user flows tested
- **Error Coverage**: All identified error scenarios validated
- **Performance**: Gas usage within 10% of estimates
- **Reliability**: 99%+ success rate on repeated test runs
- **Documentation**: Complete implementation guide for future maintainers

This comprehensive flows document provides the foundation for implementing robust testnet testing scripts that validate all critical paths in the tBTC v2 Account Control system. Each flow includes detailed implementation requirements, error scenarios, and success criteria to ensure thorough validation of the system's functionality on real testnet environments.

---

## 9. Audit Trail and Monitoring

### 9.1 Overview

This section provides a comprehensive guide for implementing audit trails across all Account Control user flows. Each flow is documented with:

- **Entry Points**: External/public functions that initiate the flow
- **Key Events**: Events emitted for audit trail reconstruction
- **Data Requirements**: Essential data points for complete visibility
- **Correlation Patterns**: How to link related events across contracts

#### Core Principles

1. **Complete Traceability**: Every user action must be traceable from initiation to completion
2. **Actor Attribution**: All actions must be attributable to specific addresses and roles
3. **State Reconstruction**: System state at any point must be reconstructible from events
4. **Economic Transparency**: All value transfers must be tracked and auditable

### 9.2 QC Lifecycle Management Flows

#### 9.2.1 QC Registration Flow

**Purpose**: Onboard new Qualified Custodians to the system

**Entry Point**: `QCManager.registerQC(address qc, uint256 maxMintingCap)`

**Key Events**:

```solidity
// From QCManager.sol
event QCRegistrationInitiated(
    address indexed qc,
    address indexed initiatedBy,
    uint256 indexed timestamp
);

event QCOnboarded(
    address indexed qc,
    uint256 indexed maxMintingCap,
    address indexed onboardedBy,
    uint256 timestamp
);

// From QCData.sol
event QCRegistered(
    address indexed qc,
    address indexed registeredBy,
    uint256 indexed maxMintingCapacity,
    uint256 timestamp
);
```

**Audit Data Points**:

- QC address
- Initial minting capacity
- Registration timestamp
- Registering authority (must have GOVERNANCE_ROLE)
- Transaction details (gas, block number)

**Reconstruction Query**:

```sql
SELECT * FROM events
WHERE event_name IN ('QCRegistrationInitiated', 'QCOnboarded', 'QCRegistered')
AND qc_address = ?
ORDER BY timestamp ASC;
```

#### 9.2.2 Minting Capacity Increase Flow

**Purpose**: Expand operational limits for existing QCs

**Entry Point**: `QCManager.increaseMintingCapacity(address qc, uint256 newCap)`

**Key Events**:

```solidity
event MintingCapacityIncreased(
    address indexed qc,
    uint256 oldCapacity,
    uint256 indexed newCapacity,
    address indexed increasedBy,
    uint256 timestamp
);
```

**Audit Data Points**:

- QC address
- Previous capacity
- New capacity
- Authority approving increase
- Justification/reason

#### 9.2.3 QC Status Change Flow

**Purpose**: Track all QC status transitions (Active → MintingPaused → Paused → UnderReview → Revoked). Note: Revoked is reachable from ANY state via governance decision for severe violations.

**Entry Points**: Multiple functions in QCManager

**Key Events**:

```solidity
event QCStatusChanged(
    address indexed qc,
    QCData.QCStatus oldStatus,
    QCData.QCStatus indexed newStatus,
    bytes32 indexed reason,
    address changedBy,
    uint256 timestamp
);

event PauseCreditUsed(
    address indexed qc,
    uint256 indexed pauseNumber,
    uint256 expiryTimestamp,
    address indexed triggeredBy
);

event PauseCreditExpired(
    address indexed qc,
    uint256 indexed pauseNumber,
    address indexed triggeredBy
);
```

**Audit Data Points**:

- QC address
- Status transitions (from → to)
- Reason codes (machine-readable)
- Authority making change
- Pause credits used/expired

### 9.3 Wallet Management Flows

#### 9.3.1 Bitcoin Wallet Registration Flow

**Purpose**: Register Bitcoin addresses for QC reserve monitoring

**Entry Point**: `QCManager.registerWallet(address qc, string btcAddress, bytes signature)`

**Key Events**:

```solidity
event WalletRegistrationRequested(
    address indexed qc,
    string btcAddress,
    address indexed requestedBy,
    uint256 timestamp
);

event WalletRegistered(
    address indexed qc,
    string btcAddress,
    address indexed registeredBy,
    uint256 timestamp
);

event WalletRegistrationFailed(
    address indexed qc,
    string btcAddress,
    string reason,
    address indexed failedBy,
    uint256 timestamp
);
```

**Audit Data Points**:

- QC address
- Bitcoin address
- Message signature used for proof
- Verification status
- Registration authority

#### 9.3.2 Wallet De-registration Flow

**Purpose**: Remove Bitcoin addresses from monitoring

**Entry Point**: `QCManager.deregisterWallet(address qc, string btcAddress)`

**Key Events**:

```solidity
event WalletDeregistrationRequested(
    address indexed qc,
    string btcAddress,
    address indexed requestedBy,
    uint256 timestamp
);

event WalletDeregistered(
    address indexed qc,
    string btcAddress,
    address indexed deregisteredBy,
    uint256 timestamp
);
```

### 9.4 Reserve Operations Flows

#### 9.4.1 Reserve Attestation Flow

**Purpose**: Track Bitcoin reserve balance updates

**Entry Point**: `QCReserveLedger.submitAttestation(address qc, uint256 newBalance)`

**Key Events**:

```solidity
event AttestationSubmitted(
    address indexed qc,
    address indexed attester,
    uint256 indexed newBalance,
    uint256 timestamp,
    bytes32 attestationHash
);

event ConsensusReached(
    address indexed qc,
    uint256 indexed consensusBalance,
    uint256 numberOfAttesters,
    uint256 timestamp
);

event AttestationExpired(
    address indexed qc,
    uint256 indexed oldBalance,
    uint256 expiryTimestamp,
    uint256 timestamp
);
```

**Audit Data Points**:

- QC address
- Attester addresses
- Balance values
- Consensus mechanism
- Staleness tracking

#### 9.4.2 Solvency Check Flow

**Purpose**: Track automatic solvency enforcement

**Entry Point**: Automatic via WatchdogEnforcer

**Key Events**:

```solidity
event SolvencyCheckTriggered(
    address indexed qc,
    uint256 indexed currentReserves,
    uint256 indexed mintedAmount,
    address triggeredBy,
    uint256 timestamp
);

event SolvencyViolationDetected(
    address indexed qc,
    uint256 shortfall,
    bytes32 indexed reason,
    address indexed detectedBy,
    uint256 timestamp
);
```

### 9.5 Minting Operations Flows

#### 9.5.1 User Minting Flow

**Purpose**: Track tBTC minting requests and execution

**Entry Point**: `QCMinter.requestQCMint(address qc, uint256 amount)`

**Key Events**:

```solidity
event MintingRequested(
    address indexed user,
    address indexed qc,
    uint256 indexed amount,
    uint256 timestamp,
    bytes32 requestId
);

event MintingCompleted(
    address indexed user,
    address indexed qc,
    uint256 indexed amount,
    uint256 timestamp,
    bytes32 requestId
);

event MintingFailed(
    address indexed user,
    address indexed qc,
    uint256 indexed amount,
    string reason,
    uint256 timestamp,
    bytes32 requestId
);
```

**Audit Data Points**:

- User address
- QC address
- Minting amount
- Success/failure status
- Reason for failure (if any)

### 9.6 Redemption Operations Flows

#### 9.6.1 User Redemption Flow

**Purpose**: Track redemption requests and fulfillment

**Entry Point**: `QCRedeemer.initiateRedemption(address qc, uint256 amount, string btcAddress)`

**Key Events**:

```solidity
event RedemptionRequested(
    address indexed user,
    address indexed qc,
    uint256 indexed amount,
    string btcAddress,
    uint256 timeoutTimestamp,
    bytes32 redemptionId
);

event RedemptionFulfilled(
    address indexed user,
    address indexed qc,
    uint256 indexed amount,
    string btcTxHash,
    bytes32 redemptionId,
    uint256 timestamp
);

event RedemptionDefaulted(
    address indexed user,
    address indexed qc,
    uint256 indexed amount,
    bytes32 redemptionId,
    uint256 timeoutTimestamp
);
```

**Audit Data Points**:

- User address
- QC address
- Redemption amount
- Bitcoin address
- Timeout tracking
- Fulfillment status

#### 9.6.2 Default Handling Flow

**Purpose**: Track redemption defaults and consequences

**Entry Point**: Automatic timeout detection

**Key Events**:

```solidity
event DefaultDetected(
    address indexed qc,
    bytes32 indexed redemptionId,
    uint256 defaultedAmount,
    uint256 detectionTimestamp
);

event DefaultConsequenceApplied(
    address indexed qc,
    QCData.QCStatus newStatus,
    uint256 consecutiveDefaults,
    uint256 timestamp
);
```

### 9.7 Watchdog Operations Flows

#### 9.7.1 Objective Violation Enforcement

**Purpose**: Track automated enforcement of violations

**Entry Point**: `WatchdogEnforcer.enforceObjectiveViolation(address qc, bytes32 reasonCode)`

**Key Events**:

```solidity
event ObjectiveViolationDetected(
    address indexed qc,
    bytes32 indexed reasonCode,
    address indexed detectedBy,
    uint256 timestamp
);

event EnforcementActionTaken(
    address indexed qc,
    bytes32 indexed reasonCode,
    QCData.QCStatus newStatus,
    address indexed enforcedBy,
    uint256 timestamp
);
```

### 9.8 System Administration Flows

#### 9.8.1 Parameter Updates

**Purpose**: Track system parameter changes

**Entry Point**: Various admin functions

**Key Events**:

```solidity
event SystemParameterUpdated(
    string parameterName,
    bytes32 oldValue,
    bytes32 indexed newValue,
    address indexed updatedBy,
    uint256 timestamp
);

event EmergencyPauseTriggered(
    address indexed target,
    string reason,
    address indexed triggeredBy,
    uint256 timestamp
);

event EmergencyPauseLifted(
    address indexed target,
    address indexed liftedBy,
    uint256 timestamp
);
```

### 9.9 Event Correlation Patterns

#### 9.9.1 Cross-Contract Event Relationships

**QC Registration to First Minting**:

```sql
-- Find QC registration followed by first minting
SELECT 
    r.qc_address,
    r.timestamp AS registration_time,
    m.timestamp AS first_mint_time,
    TIMEDIFF(m.timestamp, r.timestamp) AS time_to_first_mint
FROM qc_registered r
LEFT JOIN minting_completed m ON r.qc_address = m.qc_address
WHERE m.timestamp = (
    SELECT MIN(timestamp) 
    FROM minting_completed 
    WHERE qc_address = r.qc_address
);
```

**Redemption Request to Fulfillment**:

```sql
-- Track redemption fulfillment times
SELECT 
    req.redemption_id,
    req.qc_address,
    req.amount,
    req.timeout_timestamp,
    ful.timestamp AS fulfillment_time,
    TIMEDIFF(ful.timestamp, req.timestamp) AS fulfillment_duration
FROM redemption_requested req
LEFT JOIN redemption_fulfilled ful ON req.redemption_id = ful.redemption_id
ORDER BY req.timestamp DESC;
```

#### 9.9.2 Status Change Tracking

**QC Status Transition Analysis**:

```sql
-- Analyze QC status changes over time
SELECT 
    qc_address,
    old_status,
    new_status,
    reason,
    changed_by,
    timestamp,
    LAG(timestamp) OVER (PARTITION BY qc_address ORDER BY timestamp) AS previous_change
FROM qc_status_changed
ORDER BY qc_address, timestamp;
```

### 9.10 Dashboard Implementation Guide

#### 9.10.1 Real-Time Monitoring Dashboard

**Key Metrics to Display**:

1. **QC Overview Panel**:
   - Total registered QCs
   - Active vs. paused QCs
   - Total minting capacity
   - Current utilization rates

2. **Operations Panel**:
   - Recent minting requests
   - Pending redemptions
   - Redemption fulfillment rates
   - Average fulfillment times

3. **Security Panel**:
   - Recent status changes
   - Objective violations detected
   - Solvency alerts
   - Emergency actions taken

4. **Reserve Panel**:
   - Total Bitcoin reserves
   - Attestation freshness
   - Consensus status
   - Reserve trends

#### 9.10.2 Alerting System

**Critical Alerts**:

```javascript
// Example alert conditions
const criticalAlerts = {
  // QC status degradation
  qcStatusDegraded: {
    condition: "QCStatusChanged.newStatus IN ('UnderReview', 'Revoked')",
    severity: "HIGH",
    notification: ["email", "slack", "sms"]
  },
  
  // Redemption near timeout
  redemptionTimeout: {
    condition: "RedemptionRequested.timeoutTimestamp - NOW() < 3600", // 1 hour
    severity: "CRITICAL",
    notification: ["email", "slack", "sms", "phone"]
  },
  
  // Objective violation
  objectiveViolation: {
    condition: "ObjectiveViolationDetected.*",
    severity: "HIGH",
    notification: ["email", "slack"]
  },
  
  // Emergency pause
  emergencyPause: {
    condition: "EmergencyPauseTriggered.*",
    severity: "CRITICAL",
    notification: ["email", "slack", "sms", "phone"]
  }
};
```

#### 9.10.3 Audit Report Generation

**Daily Operations Report**:

```sql
-- Daily operations summary
SELECT 
    DATE(timestamp) AS report_date,
    COUNT(CASE WHEN event_name = 'MintingCompleted' THEN 1 END) AS total_mints,
    SUM(CASE WHEN event_name = 'MintingCompleted' THEN amount ELSE 0 END) AS total_minted_amount,
    COUNT(CASE WHEN event_name = 'RedemptionRequested' THEN 1 END) AS total_redemptions,
    COUNT(CASE WHEN event_name = 'RedemptionFulfilled' THEN 1 END) AS fulfilled_redemptions,
    COUNT(CASE WHEN event_name = 'QCStatusChanged' THEN 1 END) AS status_changes
FROM events 
WHERE DATE(timestamp) = CURDATE()
GROUP BY DATE(timestamp);
```

**QC Performance Report**:

```sql
-- QC performance analysis
SELECT 
    qc_address,
    COUNT(CASE WHEN event_name = 'MintingCompleted' THEN 1 END) AS total_mints,
    AVG(CASE WHEN event_name = 'RedemptionFulfilled' 
        THEN TIMEDIFF(timestamp, request_timestamp) END) AS avg_fulfillment_time,
    COUNT(CASE WHEN event_name = 'RedemptionDefaulted' THEN 1 END) AS defaults,
    MAX(CASE WHEN event_name = 'QCStatusChanged' THEN timestamp END) AS last_status_change
FROM events 
WHERE timestamp >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY qc_address
ORDER BY total_mints DESC;
```

### 9.11 Compliance and Regulatory Reporting

#### 9.11.1 Audit Trail Completeness

**Event Coverage Verification**:

```sql
-- Ensure all critical flows have complete event coverage
SELECT 
    flow_type,
    expected_events,
    actual_events,
    coverage_percentage
FROM (
    SELECT 
        'minting' AS flow_type,
        COUNT(*) AS expected_events,
        COUNT(CASE WHEN event_name = 'MintingCompleted' THEN 1 END) AS actual_events,
        (COUNT(CASE WHEN event_name = 'MintingCompleted' THEN 1 END) * 100.0 / COUNT(*)) AS coverage_percentage
    FROM (SELECT * FROM events WHERE event_name IN ('MintingRequested', 'MintingCompleted', 'MintingFailed')) e
) coverage_analysis;
```

#### 9.11.2 Regulatory Compliance Data

**Reserve Backing Verification**:

```sql
-- Verify reserve backing for all minted tokens
SELECT 
    qc_address,
    total_minted,
    current_reserves,
    (current_reserves - total_minted) AS reserve_buffer,
    (current_reserves * 100.0 / total_minted) AS collateralization_ratio
FROM (
    SELECT 
        qc_address,
        SUM(CASE WHEN event_name = 'MintingCompleted' THEN amount 
                 WHEN event_name = 'RedemptionFulfilled' THEN -amount 
                 ELSE 0 END) AS total_minted,
        (SELECT consensus_balance FROM latest_consensus WHERE qc_address = e.qc_address) AS current_reserves
    FROM events e
    WHERE event_name IN ('MintingCompleted', 'RedemptionFulfilled')
    GROUP BY qc_address
) reserves_analysis;
```

This comprehensive audit trail system ensures complete transparency and regulatory compliance for all Account Control operations while providing the necessary tools for monitoring, alerting, and reporting.
