# Watchdog Wallet Registration Guide

**Document Version**: 1.0  
**Date**: 2025-08-01  
**Purpose**: Clarify wallet registration behavior with multiple QCWatchdog instances  
**Status**: Implementation Guide

---

## Overview

In the V1.1 Account Control system with multiple independent QCWatchdog instances, wallet registration follows a **"First Valid Registration Wins"** model. This document clarifies the expected behavior and provides operational guidance.

## Key Design Principles

1. **SPV Proof is Authority**: The cryptographic proof of wallet control is the sole determinant of validity
2. **Independent Operation**: Wallet registration does NOT require consensus among watchdogs
3. **Deterministic Validation**: SPV proof validation is binary - either valid or invalid
4. **Idempotent Registration**: Duplicate valid registrations are safely rejected

## How It Works

### Multiple Watchdogs, One Truth

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ QCWatchdog1 │     │ QCWatchdog2 │     │ QCWatchdog3 │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                    │                    │
       │ registerWallet()   │ registerWallet()  │
       │ (with SPV proof)   │ (with SPV proof)  │
       │                    │                    │
       ▼                    ▼                    ▼
┌────────────────────────────────────────────────────────┐
│                      QCManager                          │
│  1. Verify SPV proof                                   │
│  2. Check if wallet already registered                 │
│  3. Register if new, reject if duplicate               │
└────────────────────────────────────────────────────────┘
```

### Registration Flow

1. **QC generates Bitcoin wallet** and creates OP_RETURN proof of control
2. **Any watchdog** can observe the Bitcoin transaction and submit registration
3. **QCManager** validates the SPV proof and registers the wallet
4. **Subsequent attempts** by other watchdogs are safely rejected

### What Happens With Conflicts?

**Scenario 1: Multiple Watchdogs, Same Wallet**
- Watchdog A submits registration for wallet X at block 100
- Watchdog B submits registration for wallet X at block 101
- Result: A succeeds, B's transaction reverts with "Wallet already registered"
- Impact: Minimal - only wasted gas for B

**Scenario 2: Multiple Watchdogs, Different Wallets**
- This shouldn't happen if QC follows protocol
- QC should only generate one wallet per registration request
- If it occurs, first valid registration wins
- QC must use the registered wallet or request deregistration

## Operational Guidelines

### For Watchdog Operators

1. **Monitor Bitcoin mempool** for QC wallet registration transactions
2. **Coordinate off-chain** (optional) to avoid duplicate work:
   ```
   // Example coordination channel
   Watchdog A: "Seeing registration TX for QC 0x123..."
   Watchdog B: "Acknowledged, A has it"
   ```
3. **Submit promptly** when you observe a valid registration
4. **Handle reverts gracefully** - "already registered" is expected behavior

### For QC Operators

1. **Generate one wallet** per registration request
2. **Wait for confirmation** before generating additional wallets
3. **Monitor events** to confirm successful registration:
   ```solidity
   event WalletRegistrationRequested(
       address indexed qc,
       string btcAddress,
       address indexed registrar,
       uint256 timestamp
   );
   ```

### For System Monitors

Track these metrics:
- Total registration attempts vs successes
- Distribution of registrations across watchdogs
- Average time from Bitcoin TX to Ethereum registration
- Gas costs for duplicate attempts

## Implementation Details

### Current Code Behavior

```solidity
// In QCManager.sol
function registerWallet(...) external onlyRole(REGISTRAR_ROLE) {
    // 1. Validate SPV proof
    if (!_verifyWalletControl(...)) {
        revert SPVVerificationFailed();
    }
    
    // 2. Register wallet (QCData will revert if duplicate)
    qcData.registerWallet(qc, btcAddress);
    
    // 3. Emit event
    emit WalletRegistrationRequested(...);
}
```

### No Code Changes Required

The current implementation already supports multiple watchdogs correctly:
- `onlyRole(REGISTRAR_ROLE)` allows any watchdog with the role
- QCData prevents duplicate registrations
- SPV validation ensures only valid registrations succeed

## Benefits of This Approach

1. **Simplicity**: No complex coordination required
2. **Resilience**: System works even if some watchdogs are offline
3. **Trustless**: SPV proof prevents any malicious registration
4. **Efficient**: First observer can act immediately

## Potential Improvements (Future)

1. **Add Registration Attempt Event**: Emit event even for failed attempts to improve monitoring
2. **Batch Registration**: Allow registering multiple wallets in one transaction
3. **Priority System**: Assign primary/backup registrars based on past performance
4. **Gas Refund**: Consider refunding gas for duplicate attempts (complex to implement fairly)

## FAQ

**Q: What if all watchdogs try to register at once?**
A: Only one succeeds, others revert. This is safe but wastes gas.

**Q: Can a malicious watchdog register a fake wallet?**
A: No, SPV proof validation prevents this.

**Q: Should watchdogs coordinate?**
A: Optional but recommended to save gas.

**Q: What if no watchdog registers a wallet?**
A: QC operations will be blocked until registration occurs. Multiple watchdogs provide redundancy.

**Q: Can we change to consensus-based registration?**
A: Yes, but it contradicts the "SPV is authority" principle and adds unnecessary complexity.

## Conclusion

The current "any watchdog can register" model is intentional and secure. The SPV proof provides deterministic validation, making consensus unnecessary. Operational efficiency can be improved through off-chain coordination, but the system remains secure and functional without it.