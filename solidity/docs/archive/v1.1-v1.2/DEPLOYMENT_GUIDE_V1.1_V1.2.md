# Deployment Guide: V1.1/V1.2 Watchdog System

**Version**: 1.0  
**Date**: 2025-08-05  
**Target Networks**: Ethereum Mainnet, Sepolia Testnet

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [V1.1 Deployment](#v11-deployment)
4. [V1.2 Deployment (Optional)](#v12-deployment-optional)
5. [Post-Deployment Configuration](#post-deployment-configuration)
6. [Verification Steps](#verification-steps)
7. [Rollback Procedures](#rollback-procedures)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Tools
- Node.js v16+ and npm v8+
- Hardhat v2.12+
- Git
- Ethereum wallet with deployment funds

### Required Access
- Deployment wallet private key
- Governance multi-sig address
- Etherscan API key (for verification)
- RPC endpoint (Infura/Alchemy)

### Contract Dependencies
The following contracts must already be deployed:
- Bank
- TBTCVault
- Bridge
- LightRelay

---

## Environment Setup

### 1. Clone Repository
```bash
git clone https://github.com/keep-network/tbtc-v2
cd tbtc-v2/solidity
npm install
```

### 2. Configure Environment
Create `.env` file:
```bash
# Network Configuration
ETHEREUM_MAINNET_RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY

# Deployment Configuration
DEPLOYER_PRIVATE_KEY=0x...
GOVERNANCE_ADDRESS=0x...
ETHERSCAN_API_KEY=...

# Contract Addresses (from previous deployments)
BANK_ADDRESS=0x...
TBTC_VAULT_ADDRESS=0x...
BRIDGE_ADDRESS=0x...
LIGHT_RELAY_ADDRESS=0x...

# V1.1 Configuration
STALENESS_PERIOD=604800  # 7 days in seconds
REDEMPTION_TIMEOUT=172800  # 48 hours in seconds
CONSENSUS_THRESHOLD=2  # M in M-of-N
VOTING_PERIOD=7200  # 2 hours in seconds

# V1.2 Configuration (if deploying)
DEPLOY_V1_2=false  # Set to true for V1.2
RESERVE_RATIO_THRESHOLD=95  # 95%
EMERGENCY_THRESHOLD=3  # Reports per hour
```

### 3. Compile Contracts
```bash
npx hardhat compile
```

---

## V1.1 Deployment

### Script Overview
- `95_deploy_account_control_core.ts` - Core QC management
- `96_deploy_account_control_state.ts` - State and ledger contracts
- `97_deploy_account_control_policies.ts` - Minting/redemption policies
- `98_deploy_account_control_watchdog.ts` - Watchdog system
- `99_configure_account_control_system.ts` - System configuration

### Step 1: Deploy Core Contracts (Script 95)
```bash
npx hardhat deploy --network sepolia --tags core-account-control
```

Expected output:
```
Deploying QCData library...
QCData deployed at: 0x...
Deploying SPVValidator...
SPVValidator deployed at: 0x...
Deploying QCManager...
QCManager deployed at: 0x...
```

### Step 2: Deploy State Contracts (Script 96)
```bash
npx hardhat deploy --network sepolia --tags state-account-control
```

Expected output:
```
Deploying SystemState...
SystemState deployed at: 0x...
Deploying QCReserveLedger...
QCReserveLedger deployed at: 0x...
Deploying QCRedeemer...
QCRedeemer deployed at: 0x...
```

### Step 3: Deploy Policy Contracts (Script 97)
```bash
npx hardhat deploy --network sepolia --tags policies-account-control
```

Expected output:
```
Deploying BasicMintingPolicy...
BasicMintingPolicy deployed at: 0x...
Deploying BasicRedemptionPolicy...
BasicRedemptionPolicy deployed at: 0x...
```

### Step 4: Deploy Watchdog System (Script 98)
```bash
npx hardhat deploy --network sepolia --tags watchdog-account-control
```

Expected output:
```
Deploying WatchdogMonitor...
WatchdogMonitor deployed at: 0x...
Deploying WatchdogConsensusManager...
WatchdogConsensusManager deployed at: 0x...
```

### Step 5: Configure System (Script 99)
```bash
npx hardhat deploy --network sepolia --tags configure-account-control
```

This script will:
1. Register services in QCManager
2. Grant initial roles
3. Set system parameters
4. Link contracts together

---

## V1.2 Deployment (Optional)

### Prerequisites
- V1.1 must be fully deployed and configured
- Set `DEPLOY_V1_2=true` in `.env`

### Step 1: Deploy V1.2 Contracts (Script 100)
```bash
npx hardhat deploy --network sepolia --tags automated-framework
```

Expected output:
```
Deploying WatchdogAutomatedEnforcement...
WatchdogAutomatedEnforcement deployed at: 0x...
Deploying WatchdogThresholdActions...
WatchdogThresholdActions deployed at: 0x...
Deploying WatchdogDAOEscalation...
WatchdogDAOEscalation deployed at: 0x...
```

### Step 2: Configure V1.2 (Script 101)
```bash
npx hardhat deploy --network sepolia --tags configure-automated-framework
```

This will:
1. Link V1.2 contracts to V1.1 system
2. Configure automated rules
3. Set threshold parameters
4. Grant DAO roles

---

## Post-Deployment Configuration

### 1. Transfer Ownership to Governance

**CRITICAL**: Run script 102 to transfer admin roles
```bash
npx hardhat run scripts/102_transfer_governance.ts --network sepolia
```

### 2. Register Initial Watchdogs
```javascript
// scripts/register_watchdogs.ts
const watchdogs = [
  { address: "0x...", name: "Watchdog Alpha" },
  { address: "0x...", name: "Watchdog Beta" },
  { address: "0x...", name: "Watchdog Gamma" },
  { address: "0x...", name: "Watchdog Delta" },
  { address: "0x...", name: "Watchdog Epsilon" }
];

for (const watchdog of watchdogs) {
  await consensusManager.addWatchdog(watchdog.address);
}
```

### 3. Deploy Individual QCWatchdog Instances
```javascript
// scripts/deploy_qc_watchdogs.ts
const QCWatchdog = await ethers.getContractFactory("QCWatchdog");

for (let i = 0; i < 5; i++) {
  const watchdog = await QCWatchdog.deploy(
    qcManager.address,
    reserveLedger.address,
    redeemer.address,
    systemState.address
  );
  
  await watchdog.grantRole(
    await watchdog.WATCHDOG_OPERATOR_ROLE(),
    watchdogs[i].address
  );
  
  await watchdogMonitor.registerWatchdog(
    watchdog.address,
    watchdogs[i].name
  );
}
```

### 4. Configure Bank Integration
```javascript
// Grant minter role to policies
await bank.grantRole(MINTER_ROLE, mintingPolicy.address);
await bank.grantRole(REDEEMER_ROLE, redemptionPolicy.address);
```

---

## Verification Steps

### 1. Run Role Verification Script
```bash
npx hardhat run scripts/verify-roles.ts --network sepolia
```

Expected output:
```
✅ QCManager: All roles configured correctly
✅ SystemState: All roles configured correctly
✅ WatchdogConsensusManager: All roles configured correctly
⚠️  WARNING: Deployer still has DEFAULT_ADMIN_ROLE on 3 contracts
```

### 2. Verify Contract Source on Etherscan
```bash
npx hardhat verify --network sepolia DEPLOYED_ADDRESS "constructor" "args"
```

### 3. Test Basic Operations
```javascript
// scripts/test_deployment.ts
// 1. Register a test QC
await qcManager.registerQC(testQC, "Test QC");

// 2. Test pause functionality
await systemState.pauseAll();
await systemState.unpauseAll();

// 3. Test watchdog registration
const testWatchdog = await QCWatchdog.deploy(...);
await watchdogMonitor.registerWatchdog(testWatchdog.address, "Test");
```

### 4. Verify Integration Points
```bash
npx hardhat run scripts/verify-integrations.ts --network sepolia
```

Checks:
- Service registrations in QCManager
- SystemState integration in all contracts
- Bank permissions for policies
- Cross-contract references

---

## Rollback Procedures

### If Deployment Fails

1. **Before Script 99 (Configuration)**:
   - Simply redeploy failed contracts
   - No state to preserve

2. **After Configuration**:
   - Document all completed transactions
   - Identify point of failure
   - May need to start fresh with new addresses

### Emergency Pause
If issues detected post-deployment:
```javascript
// Emergency pause all operations
await systemState.connect(pauser).pauseAll();
```

### Contract Replacement
For critical bugs (policies are replaceable):
```javascript
// Deploy new policy
const newPolicy = await BasicMintingPolicy.deploy(...);

// Update registration
await qcManager.registerService("mintingPolicy", newPolicy.address);

// Update Bank permissions
await bank.revokeRole(MINTER_ROLE, oldPolicy.address);
await bank.grantRole(MINTER_ROLE, newPolicy.address);
```

---

## Troubleshooting

### Common Issues

#### 1. "Insufficient funds" Error
**Solution**: Ensure deployer has enough ETH for gas costs
- Estimated gas needed: 50M gas units total
- At 30 gwei: ~1.5 ETH required

#### 2. "Contract already deployed" Error
**Solution**: Check deployment files in `deployments/network/`
```bash
rm -rf deployments/sepolia/*.json
```

#### 3. Role Configuration Failures
**Solution**: Ensure correct account is executing
```javascript
// Check current signer
console.log("Deployer:", await deployer.getAddress());
console.log("Governance:", governanceAddress);
```

#### 4. Integration Failures
**Solution**: Verify dependency addresses
```javascript
// Verify external contracts exist
const bankCode = await ethers.provider.getCode(BANK_ADDRESS);
if (bankCode === "0x") {
  throw new Error("Bank contract not found");
}
```

### Debug Commands

```bash
# Check deployment status
npx hardhat deployment-status --network sepolia

# Export deployment data
npx hardhat export --network sepolia --export ./deployments.json

# Run specific script with verbose logging
DEBUG=hardhat:* npx hardhat deploy --network sepolia --tags core-account-control
```

---

## Security Checklist

Before mainnet deployment:

- [ ] All contracts compiled with Solidity 0.8.17
- [ ] Slither analysis completed and issues addressed
- [ ] Formal audit completed
- [ ] Deployment scripts tested on testnet
- [ ] Multi-sig wallet controls governance
- [ ] Emergency pause tested
- [ ] Role transfers completed (script 102)
- [ ] No test data or test addresses remain
- [ ] Gas costs optimized
- [ ] Event monitoring configured

---

## Mainnet Deployment

### Additional Mainnet Steps

1. **Use Hardware Wallet**:
   ```bash
   npx hardhat deploy --network mainnet --ledger
   ```

2. **Deploy with Defender**:
   Consider using OpenZeppelin Defender for deployment

3. **Implement Timelock**:
   Add 48-hour timelock for governance actions

4. **Monitor Gas Prices**:
   Use gas price oracles to optimize deployment timing

5. **Incremental Deployment**:
   Deploy and verify each script separately

---

## Post-Deployment Monitoring

### Set Up Monitoring
1. Configure event listeners for critical events
2. Set up alerts for emergency reports
3. Monitor gas usage patterns
4. Track QC registrations and attestations

### Regular Maintenance
1. Review watchdog performance weekly
2. Update parameters based on usage
3. Rotate watchdog operators quarterly
4. Conduct security reviews

---

## Support and Resources

- Documentation: `/docs/`
- Integration Tests: `/test/integration/`
- Example Scripts: `/scripts/examples/`
- Discord: [Development Channel]
- Emergency Contact: security@keep.network

---

## Appendix: Contract Addresses

### Sepolia Testnet
```
QCManager: 0x...
SystemState: 0x...
QCReserveLedger: 0x...
QCRedeemer: 0x...
WatchdogMonitor: 0x...
WatchdogConsensusManager: 0x...
BasicMintingPolicy: 0x...
BasicRedemptionPolicy: 0x...
```

### Mainnet (TBD)
```
To be updated after mainnet deployment
```