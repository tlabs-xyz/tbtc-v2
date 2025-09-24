# Account Control System Deployment Guide

## Overview
The Account Control system requires careful sequential deployment due to library linking requirements and contract size optimizations. This guide provides step-by-step instructions for deploying the system on both testnet and mainnet.

## Contract Size Requirements
- **QCManager**: Must be under 24.576KB (EIP-170 limit)
- **QCManagerLib**: Library extracted to reduce QCManager size
- All contracts must be deployed with library linking

## Prerequisites

### Environment Setup
```bash
# Install dependencies
npm install

# Set environment variables
export DEPLOYER_PRIVATE_KEY="your_private_key"
export RPC_URL="your_rpc_url"
export ETHERSCAN_API_KEY="your_etherscan_key" # For verification
```

### Testing Environment
For local testing with contract size limits disabled:
```bash
export TEST_USE_STUBS_TBTC=true
```

## Deployment Order

The contracts MUST be deployed in the following sequence:

### 1. Deploy Core Libraries
```bash
# Deploy QCManagerLib first (required for QCManager linking)
npx hardhat run scripts/deploy/01-deploy-libraries.js --network <network>
```

### 2. Deploy Data Contracts
```bash
# Deploy QCData - stores QC and wallet registration data
npx hardhat run scripts/deploy/02-deploy-qcdata.js --network <network>

# Deploy SystemState - manages system-wide status
npx hardhat run scripts/deploy/03-deploy-systemstate.js --network <network>

# Deploy ReserveOracle - provides reserve balance attestations
npx hardhat run scripts/deploy/04-deploy-reserveoracle.js --network <network>
```

### 3. Deploy QCManager with Library Linking
```bash
# Deploy QCManager with QCManagerLib linked
npx hardhat run scripts/deploy/05-deploy-qcmanager.js --network <network>
```

**Important**: The deployment script must link QCManagerLib:
```javascript
const QCManagerLib = await ethers.getContractFactory("QCManagerLib");
const qcManagerLib = await QCManagerLib.deploy();

const QCManager = await ethers.getContractFactory("QCManager", {
  libraries: {
    QCManagerLib: qcManagerLib.address,
  },
});
```

### 4. Deploy AccountControl
```bash
# Deploy AccountControl (upgradeable proxy)
npx hardhat run scripts/deploy/06-deploy-accountcontrol.js --network <network>
```

### 5. Configure Access Control
```bash
# Grant roles and permissions
npx hardhat run scripts/deploy/07-configure-access.js --network <network>
```

This script should:
- Grant QC_MANAGER_ROLE to QCManager contract in AccountControl
- Set up admin roles in QCData and SystemState
- Configure ReserveOracle attesters

### 6. Deploy Peripheral Contracts
```bash
# Deploy QCMinter
npx hardhat run scripts/deploy/08-deploy-qcminter.js --network <network>

# Deploy QCRedeemer
npx hardhat run scripts/deploy/09-deploy-qcredeemer.js --network <network>
```

### 7. Final Configuration
```bash
# Connect all contracts and set initial parameters
npx hardhat run scripts/deploy/10-finalize-setup.js --network <network>
```

## Verification

### Contract Verification on Etherscan
```bash
# Verify QCManagerLib
npx hardhat verify --network <network> <QCManagerLib_address>

# Verify QCManager (with library linking)
npx hardhat verify --network <network> <QCManager_address> \
  --libraries scripts/libraries.js

# Verify other contracts
npx hardhat verify --network <network> <contract_address> <constructor_args>
```

### Post-Deployment Checks
1. **Verify library linking**: Check that QCManager properly calls QCManagerLib functions
2. **Test role permissions**: Ensure QCManager has QC_MANAGER_ROLE in AccountControl
3. **Validate contract sizes**: Confirm all contracts are under 24.576KB
4. **Test basic operations**: Register a test QC and wallet

## Network-Specific Configuration

### Mainnet
```javascript
{
  optimizer: {
    enabled: true,
    runs: 200
  }
}
```

### Testnet
```javascript
{
  optimizer: {
    enabled: true,
    runs: 1  // Optimize for size on testnets
  }
}
```

### Local Testing
```javascript
{
  allowUnlimitedContractSize: process.env.TEST_USE_STUBS_TBTC === "true"
}
```

## Troubleshooting

### Contract Size Errors
If you encounter "Contract code size exceeds 24576 bytes":
1. Ensure QCManagerLib is properly deployed and linked
2. Check optimizer settings (use `runs: 1` for maximum size reduction)
3. Verify library linking in deployment script

### Library Linking Issues
If library functions fail:
1. Verify library address is correct in deployment
2. Check that library is deployed before main contract
3. Ensure proper linking configuration in hardhat config

### Access Control Errors
If operations fail with permission errors:
1. Verify QCManager has QC_MANAGER_ROLE in AccountControl
2. Check all role grants were successful
3. Ensure correct addresses in configuration

## Gas Costs

Estimated deployment costs (at 30 gwei):
- QCManagerLib: ~0.05 ETH
- QCData: ~0.06 ETH
- SystemState: ~0.06 ETH
- ReserveOracle: ~0.06 ETH
- QCManager: ~0.15 ETH (with library linking)
- AccountControl: ~0.10 ETH (proxy)
- Total: ~0.5-0.6 ETH

## Security Checklist

Before mainnet deployment:
- [ ] All contracts audited
- [ ] Library linking verified
- [ ] Access control roles configured correctly
- [ ] Emergency pause mechanisms tested
- [ ] Upgrade mechanisms tested (for AccountControl)
- [ ] Contract sizes verified under limits
- [ ] Integration tests passed
- [ ] Deployment scripts tested on testnet

## Emergency Procedures

### Pause Operations
```javascript
// Emergency pause via SystemState
systemState.setSystemPaused(true, "Emergency reason");
```

### Contract Upgrade (AccountControl only)
```javascript
// Upgrade AccountControl implementation
const NewAccountControl = await ethers.getContractFactory("AccountControlV2");
await upgrades.upgradeProxy(accountControlProxy.address, NewAccountControl);
```

## Support

For deployment issues, contact:
- Technical: security@threshold.network
- Discord: [Threshold Discord]
- GitHub: https://github.com/keep-network/tbtc-v2