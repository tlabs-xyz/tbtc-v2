# Wallet Obligation Tracking System (WOTS)

## Overview

The Wallet Obligation Tracking System (WOTS) is a critical security feature that prevents Bitcoin wallets from being de-registered while they have outstanding redemption obligations. This system maintains the integrity of the tBTC redemption process by explicitly binding each redemption to a specific QC wallet.

## Problem Solved

Previously, redemptions were tracked only by QC address, not by specific wallets. This created a vulnerability where:
- A QC could de-register a wallet that had pending redemptions
- Users could be left without a way to redeem their tBTC
- QCs could potentially avoid redemption obligations by removing wallets

## Solution Architecture

### 1. Wallet-Redemption Binding

Each redemption is now explicitly bound to a specific QC wallet:

```solidity
struct Redemption {
    address user;
    address qc;
    uint256 amount;
    uint256 requestedAt;
    uint256 deadline;
    RedemptionStatus status;
    string userBtcAddress;
    string qcWalletAddress;  // NEW: Specific wallet handling this redemption
}
```

### 2. Wallet Obligation Tracking

The system maintains detailed tracking of wallet obligations:

```solidity
// Track redemptions by wallet
mapping(string => bytes32[]) public walletActiveRedemptions;
mapping(string => uint256) public walletActiveRedemptionCount;
```

### 3. De-registration Protection

Wallets cannot be de-registered while having active redemptions:

```solidity
function requestWalletDeRegistration(string calldata btcAddress) {
    // Check if wallet has pending redemption obligations
    require(
        !qcRedeemer.hasWalletObligations(btcAddress),
        "Cannot deregister: wallet has pending redemptions"
    );
    // Proceed with de-registration only if no obligations
}
```

## Key Features

### QC Autonomy Preserved
- QCs retain full control over which wallet handles each redemption
- No forced assignment or automatic distribution
- QCs specify the wallet when initiating redemptions

### Simple Safety Mechanism
- Single check prevents de-registration of obligated wallets
- Clear error messages inform QCs of blocking redemptions
- Transparent obligation tracking via public functions

### Comprehensive Tracking
- Per-wallet redemption counts
- Earliest deadline tracking for priority management
- Total obligation amounts for capacity planning

## API Reference

### QCRedeemer Functions

#### `initiateRedemption()`
```solidity
function initiateRedemption(
    address qc,
    uint256 amount,
    string calldata userBtcAddress,
    string calldata qcWalletAddress  // NEW parameter
) external returns (bytes32 redemptionId)
```
QCs must now specify which wallet will handle the redemption.

#### `hasWalletObligations()`
```solidity
function hasWalletObligations(string calldata walletAddress) 
    external view returns (bool)
```
Returns true if the wallet has any pending redemptions.

#### `getWalletPendingRedemptionCount()`
```solidity
function getWalletPendingRedemptionCount(string calldata walletAddress)
    external view returns (uint256)
```
Returns the number of active redemptions for a wallet.

#### `getWalletEarliestRedemptionDeadline()`
```solidity
function getWalletEarliestRedemptionDeadline(string calldata walletAddress)
    external view returns (uint256)
```
Returns the earliest deadline among pending redemptions.

#### `getWalletObligationDetails()`
```solidity
function getWalletObligationDetails(string calldata walletAddress)
    external view returns (
        uint256 activeCount,
        uint256 totalAmount,
        uint256 earliestDeadline
    )
```
Provides comprehensive obligation information for a wallet.

## Usage Examples

### Initiating a Redemption
```javascript
// QC specifies which of their wallets will handle this redemption
const redemptionId = await qcRedeemer.initiateRedemption(
    qcAddress,
    amount,
    userBitcoinAddress,
    "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"  // QC's chosen wallet
);
```

### Checking Before De-registration
```javascript
// Check if wallet can be de-registered
const hasObligations = await qcRedeemer.hasWalletObligations(walletAddress);
if (hasObligations) {
    console.log("Cannot deregister: wallet has pending redemptions");
    
    // Get details about obligations
    const details = await qcRedeemer.getWalletObligationDetails(walletAddress);
    console.log(`Active redemptions: ${details.activeCount}`);
    console.log(`Total amount: ${details.totalAmount}`);
    console.log(`Earliest deadline: ${new Date(details.earliestDeadline * 1000)}`);
}
```

### QC Wallet Management Strategy
```javascript
// QCs can distribute redemptions across wallets
const wallets = await qcData.getQCWallets(qcAddress);
for (const wallet of wallets) {
    const count = await qcRedeemer.getWalletPendingRedemptionCount(wallet);
    if (count < MAX_REDEMPTIONS_PER_WALLET) {
        // Use this wallet for next redemption
        return wallet;
    }
}
```

## Security Considerations

### Atomicity
- Wallet obligations are updated atomically with redemption state changes
- Fulfillment and default operations properly clear obligations
- No race conditions between obligation checks and de-registration

### Gas Efficiency
- Minimal additional storage (one string and two counters per redemption)
- O(1) obligation checking (simple counter comparison)
- Efficient cleanup on fulfillment/default

### Edge Cases Handled
1. **Multiple redemptions per wallet**: Counter accurately tracks all
2. **Wallet registered to different QC**: Validation prevents cross-QC usage
3. **Inactive wallet**: Cannot be used for new redemptions
4. **Timeout scenarios**: Obligations cleared on default flagging

## Migration Considerations

### For Existing Systems
- Existing redemptions continue to work (backward compatible)
- New redemptions require wallet specification
- UI/integration updates needed to pass wallet parameter

### For QC Operators
- Must track which wallets are handling redemptions
- Cannot remove wallets with active obligations
- Can implement custom distribution strategies

## Known Limitations

The current V1 implementation has some documented limitations that are acceptable for production use but could be improved in future versions:

### 1. Array Growth Without Cleanup
**Issue**: The `walletActiveRedemptions` arrays grow over time but never shrink when redemptions are fulfilled or defaulted.

**Impact**: 
- Gas costs increase over time for functions that iterate through arrays
- Storage bloat for long-running wallets with many historical redemptions

**Mitigation**: 
- Critical functions like `hasWalletObligations()` use counters (O(1) complexity)
- Gas warnings added to functions that iterate through arrays
- Acceptable for V1 given the trade-off for simplicity

**Future Fix**: Implement array cleanup, use EnumerableSet, or add pagination

### 2. Small Race Condition Window
**Issue**: In `requestWalletDeRegistration()`, there's a small window between checking obligations and executing de-registration.

**Impact**: 
- A new redemption could theoretically be initiated during this window
- Very unlikely in practice since QCs control their own wallet usage

**Mitigation**: 
- Window is extremely small (single transaction execution)
- QCs have no incentive to exploit this against themselves

**Future Fix**: Implement atomic check-and-act pattern or mutex

## Future Enhancements

Potential improvements for future versions:

1. **Array Management**
   - Implement array cleanup on fulfillment/default
   - Use OpenZeppelin's EnumerableSet for better storage management
   - Add pagination for large result sets

2. **Emergency De-registration**
   - Time-based escape hatch for overdue redemptions
   - Automatic default flagging after deadline + grace period

3. **Wallet Performance Metrics**
   - Track fulfillment rates per wallet
   - Historical performance scoring
   - Reputation-based assignment preferences

4. **Advanced Load Balancing**
   - Automatic distribution algorithms
   - Capacity-based routing
   - Priority queue management

5. **Atomic Operations**
   - Mutex-style locks for critical sections
   - Atomic check-and-act patterns
   - Better concurrency control

## Conclusion

The Wallet Obligation Tracking System provides essential protection against wallet abandonment while preserving QC operational flexibility. By explicitly binding redemptions to specific wallets and preventing de-registration of obligated wallets, the system ensures that user redemptions can always be fulfilled while giving QCs full control over their wallet management strategies.