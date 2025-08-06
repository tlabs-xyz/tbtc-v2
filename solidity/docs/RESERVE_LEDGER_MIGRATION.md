# ReserveLedger Migration Documentation

## Overview
This document describes the consolidation of ReserveOracle and QCReserveLedger into a single, unified ReserveLedger contract.

## Motivation

The original design had unnecessary separation between:
- **ReserveOracle**: Collected attestations and calculated consensus
- **QCReserveLedger**: Stored consensus results and provided query interface

This separation introduced several problems:
1. **Dual Interface Problem**: QCReserveLedger accepted both oracle consensus AND direct attestations
2. **Unnecessary Complexity**: Two contracts for what should be a single atomic operation
3. **Address Restriction**: Artificial limitation on which address could provide consensus
4. **Extra Gas Costs**: Multiple transactions needed for consensus → storage flow

## New Architecture

### ReserveLedger Contract
A single contract that:
- Accepts attestations from authorized attesters
- Automatically calculates consensus when threshold is met
- Stores reserve balances with timestamps
- Provides query interface for balance and staleness

### Key Improvements

1. **Atomic Operations**: Consensus and storage happen in the same transaction
2. **No Address Restrictions**: Any authorized attester can submit attestations
3. **Simplified Interface**: Clear separation between consensus (submitAttestation) and admin updates (updateReserveBalance)
4. **No Backward Compatibility Needed**: System not yet deployed, so we can make breaking changes
5. **Gas Efficiency**: Eliminates extra transaction for oracle → ledger communication

## Migration Steps Completed

1. ✅ Created new ReserveLedger.sol contract
2. ✅ Updated WatchdogEnforcer to use ReserveLedger
3. ✅ Updated QCManager to use ReserveLedger
4. ✅ Deleted obsolete contracts:
   - ReserveOracle.sol
   - QCReserveLedger.sol
   - IQCReserveLedger.sol (no backward compatibility needed)
5. ✅ Created new deployment script (98_deploy_reserve_ledger.ts)
6. ✅ Updated configuration script (99_configure_account_control_system.ts)
7. ✅ Created comprehensive test suite (ReserveLedger.test.ts)

## Contract Interface

### Main Functions

```solidity
// Submit attestation (automatically attempts consensus)
function submitAttestation(address qc, uint256 balance) external onlyRole(ATTESTER_ROLE)

// Query reserve balance and staleness
function getReserveBalanceAndStaleness(address qc) external view returns (uint256 balance, bool isStale)

// Admin function for direct balance updates (used by QCManager)
function updateReserveBalance(address qc, uint256 balance) external onlyRole(MANAGER_ROLE)
```

### Configuration Functions

```solidity
// Set number of attestations required for consensus
function setConsensusThreshold(uint256 newThreshold) external onlyRole(MANAGER_ROLE)

// Set timeout for attestation staleness
function setAttestationTimeout(uint256 newTimeout) external onlyRole(MANAGER_ROLE)
```

## Consensus Algorithm

The contract uses a median-based consensus algorithm:
1. Collects attestations from authorized attesters
2. When threshold is reached, calculates median of all valid (non-expired) attestations
3. Updates reserve balance with consensus value
4. Clears pending attestations for that QC

## Role Management

- **ATTESTER_ROLE**: Can submit attestations for consensus
- **MANAGER_ROLE**: Can configure thresholds/timeouts AND directly update balances (for QCManager)
- **DEFAULT_ADMIN_ROLE**: Can grant/revoke roles

## Benefits of Consolidation

1. **Reduced Complexity**: Single contract instead of two
2. **Gas Savings**: One transaction instead of two for consensus
3. **Cleaner Architecture**: No artificial separation of concerns
4. **Better Security**: No dual interface confusion
5. **Easier Maintenance**: Single point of truth for reserve data

## Clean Break Design

Since the account control system has not been deployed yet, we took the opportunity to make a clean break:
- No backward compatibility interfaces needed
- QCManager uses `updateReserveBalance()` for administrative updates
- Clear separation between consensus attestations and admin updates

## Testing

Comprehensive test coverage includes:
- Basic attestation submission
- Consensus calculation with various scenarios
- Median calculation for odd/even number of attestations
- Timeout and staleness handling
- Role-based access control
- Edge cases and error conditions

## Future Considerations

1. **Dynamic Attester Management**: Could add functions to dynamically add/remove attesters
2. **Weighted Consensus**: Could implement reputation-based weighting
3. **Historical Data**: Could track historical consensus values
4. **Events for Monitoring**: Already emits comprehensive events for off-chain monitoring