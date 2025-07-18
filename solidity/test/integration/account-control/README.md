# Account Control Integration Tests

This directory contains comprehensive integration tests for the tBTC v2 Account Control system. These tests validate complete user flows end-to-end, ensuring all components work together correctly.

## Overview

The integration tests cover the four critical user flows documented in the PRD:

1. **QC Onboarding (QC-ONBOARD-001)** - Complete QC registration with wallet management
2. **Reserve Attestation (RESERVE-ATTEST-001)** - Reserve monitoring and solvency verification
3. **QC Minting (QC-MINT-001)** - Full minting flow from user request to tBTC tokens
4. **User Redemption (USER-REDEEM-001)** - Complete redemption flow with fulfillment

## Test Files

### Core Integration Tests

- **`BaseAccountControlIntegration.test.ts`** - Base class with shared setup and utilities
- **`QCOnboardingIntegration.test.ts`** - QC onboarding flow tests
- **`ReserveAttestationIntegration.test.ts`** - Reserve attestation and solvency tests
- **`QCMintingIntegration.test.ts`** - Complete minting flow tests
- **`UserRedemptionIntegration.test.ts`** - Complete redemption flow tests
- **`CompleteFlowIntegration.test.ts`** - End-to-end system integration tests

### Test Runner

- **`../../scripts/run-integration-tests.ts`** - Automated test runner with reporting

## Running Tests

### Run All Integration Tests

```bash
npm run test:integration:account-control
```

### Run Specific Test Files

```bash
# QC Onboarding
npx hardhat test test/integration/account-control/QCOnboardingIntegration.test.ts

# Reserve Attestation
npx hardhat test test/integration/account-control/ReserveAttestationIntegration.test.ts

# QC Minting
npx hardhat test test/integration/account-control/QCMintingIntegration.test.ts

# User Redemption
npx hardhat test test/integration/account-control/UserRedemptionIntegration.test.ts

# Complete Flow
npx hardhat test test/integration/account-control/CompleteFlowIntegration.test.ts
```

### Run Specific Test Using Runner

```bash
# Run specific test
npm run test:integration:account-control -- --test=QCOnboarding

# Show help
npm run test:integration:account-control -- --help
```

## Test Architecture

### Base Integration Class

All integration tests extend `BaseAccountControlIntegration` which provides:

- **Contract Deployment**: Deploys all account control contracts
- **Service Configuration**: Configures ProtocolRegistry with all services
- **Role Management**: Sets up all required roles and permissions
- **Test Utilities**: Helper functions for common operations
- **Mock Setup**: Configures smock mocks for tBTC core contracts

### Test Parameters

Common test parameters defined in `TEST_PARAMS`:

```typescript
{
  MAX_MINTING_CAP: "1000 ETH",
  MIN_MINT_AMOUNT: "0.1 ETH",
  MAX_MINT_AMOUNT: "10 ETH",
  REDEMPTION_TIMEOUT: "24 hours",
  GOVERNANCE_DELAY: "7 days",
  ATTESTATION_STALE_THRESHOLD: "1 hour"
}
```

## Test Coverage

### QC Onboarding Tests

- **Happy Path**: Complete onboarding with wallet registration
- **Multiple Wallets**: QC with multiple Bitcoin wallets
- **Error Scenarios**: Invalid parameters, unauthorized access, timing issues

### Reserve Attestation Tests

- **Happy Path**: Fresh attestation with sufficient reserves
- **Undercollateralization**: QC with insufficient reserves
- **Stale Attestation**: Old attestations blocking minting
- **Error Scenarios**: Unauthorized attestations, invalid parameters

### QC Minting Tests

- **Happy Path**: Complete minting flow with auto-minting
- **Concurrent Minting**: Multiple users minting simultaneously
- **Edge Cases**: Minimum/maximum amounts, capacity limits
- **Error Scenarios**: Inactive QC, stale reserves, insufficient capacity

### User Redemption Tests

- **Happy Path**: Complete redemption with fulfillment
- **Timeout Scenario**: Redemption timeout and default handling
- **Concurrent Redemptions**: Multiple users redeeming simultaneously
- **Error Scenarios**: Insufficient balance, invalid parameters, unauthorized actions

### Complete Flow Tests

- **End-to-End**: Full system flow from QC onboarding to redemption
- **Policy Upgrades**: Testing system upgrades and modularity
- **Emergency Scenarios**: Emergency pause/unpause, QC revocation
- **Stress Testing**: High volume operations, capacity exhaustion

## Key Test Scenarios

### 1. QC Onboarding Flow

```typescript
// Queue QC onboarding (governance)
await qcManager.queueQCOnboarding(qc.address, maxMintingCap)

// Wait for timelock
await advanceTime(GOVERNANCE_DELAY)

// Execute onboarding
await qcManager.executeQCOnboarding(qc.address, maxMintingCap)

// Register Bitcoin wallet
await qcManager.requestWalletRegistration(btcAddress, spvProof)
await qcManager.finalizeWalletRegistration(qc.address, btcAddress)
```

### 2. Reserve Attestation Flow

```typescript
// Watchdog submits attestation
await qcReserveLedger.submitAttestation(qc.address, totalReserves, timestamp)

// Verify solvency check
const availableCapacity = await qcManager.getAvailableMintingCapacity(
  qc.address
)
expect(availableCapacity).to.be.greaterThan(0)
```

### 3. QC Minting Flow

```typescript
// User requests mint
await qcMinter.requestQCMint(qc.address, mintAmount)

// Verify policy validation
// Verify QCBridge integration
// Verify Bank balance creation
// Verify TBTCVault auto-minting
// Verify state updates
```

### 4. User Redemption Flow

```typescript
// User initiates redemption
await qcRedeemer.initiateRedemption(qc.address, amount, btcAddress)

// Verify token burning
// Verify redemption record
// Simulate QC fulfillment
// Watchdog records fulfillment
await basicRedemptionPolicy.recordFulfillment(redemptionId, proof)
```

## Mock Configuration

The tests use Smock to mock core tBTC contracts:

```typescript
// Mock core contracts
this.bridge = await smock.fake<Bridge>("Bridge")
this.bank = await smock.fake<Bank>("Bank")
this.tbtcVault = await smock.fake<TBTCVault>("TBTCVault")
this.tbtc = await smock.fake<TBTC>("TBTC")

// Configure mock behavior
this.tbtcVault.tbtcToken.returns(this.tbtc.address)
this.tbtcVault.receiveBalanceIncrease.returns()
this.bank.increaseBalanceAndCall.returns()
this.bank.hasAuthorizedBalanceIncreaser.returns(true)
```

## Error Testing

Each test file includes comprehensive error scenario testing:

- **Authorization Errors**: Unauthorized access attempts
- **Parameter Validation**: Invalid parameters and edge cases
- **State Validation**: Operations in invalid states
- **Time-based Errors**: Timeout and freshness validations
- **Capacity Limits**: Exceeding system limits

## Test Utilities

### Helper Functions

```typescript
// Generate test data
generateBitcoinAddress(): string
generateMockSPVProof(): any

// Time manipulation
advanceTime(seconds: number): Promise<void>
getBlockTimestamp(): Promise<number>

// Common setup
setupOnboardedQC(): Promise<void>
setupUserWithTokens(): Promise<void>
```

### Event Verification

```typescript
// Verify events emitted
const event = receipt.events?.find((e) => e.event === "QCOnboarded")
expect(event).to.exist
expect(event.args?.qc).to.equal(qc.address)
```

## Continuous Integration

The integration tests are designed to run in CI/CD pipelines:

- **Deterministic**: Tests use fixed parameters and mocked external dependencies
- **Fast**: Optimized for CI execution with reasonable timeouts
- **Comprehensive**: Cover all critical paths and error scenarios
- **Reporting**: Generate detailed test reports with pass/fail status

## Performance Considerations

- **Gas Optimization**: Tests verify gas usage is within reasonable limits
- **Concurrency**: Tests validate system behavior under concurrent operations
- **Scalability**: Tests ensure system can handle multiple QCs and users
- **Resource Usage**: Tests monitor memory and CPU usage during execution

## Future Enhancements

- **Mainnet Forking**: Test against real mainnet state
- **Fuzzing**: Property-based testing with random inputs
- **Performance Benchmarking**: Automated performance regression testing
- **Cross-Chain Testing**: Integration with L2 and cross-chain components

## Contributing

When adding new integration tests:

1. Extend `BaseAccountControlIntegration` class
2. Follow the existing test structure (setup -> execution -> verification)
3. Include both happy path and error scenarios
4. Add comprehensive event and state verification
5. Update this README with new test descriptions
6. Ensure tests pass in CI environment

## Support

For questions or issues with integration tests:

- Check the [main documentation](../../../docs/README.md)
- Review the [user flows documentation](../../../docs/user-flows/README.md)
- See [PRD flows](../../../prd/flows.md) for detailed requirements
- Open an issue in the repository
