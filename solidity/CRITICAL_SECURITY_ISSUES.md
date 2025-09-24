# Critical Security Issues - Account Control V2

## HIGH SEVERITY

### 1. MessageSigning.sol - Complete Signature Bypass [CRITICAL]
**File**: `contracts/account-control/libraries/MessageSigning.sol`
**Lines**: 169-180, 94-143
**Severity**: CRITICAL - Allows forging any Bitcoin ownership claim

**Description**:
The `_approximateBitcoinAddress` function returns the expected Bitcoin address whenever ecrecover succeeds with any non-zero address, completely bypassing actual signature verification.

**Impact**:
- Attackers can sign with any private key and claim any Bitcoin address
- Complete bypass of Bitcoin ownership verification
- Could lead to unauthorized asset transfers

**Fix Required**:
1. Implement proper Bitcoin address derivation from recovered public key
2. Compare derived address with claimed address
3. Add proper Bitcoin message encoding (compact size varint)
4. Validate Bitcoin addresses with proper checksums

### 2. MockReserve.sol - Reentrancy Vulnerability
**File**: `contracts/test/MockReserve.sol`
**Lines**: 113-118
**Severity**: HIGH

**Description**:
State updates (`userBalances` and `totalUserBalances`) occur after external call to `accountControl.mint()`, violating checks-effects-interactions pattern.

**Impact**:
- Potential reentrancy attacks if AccountControl's guards fail
- Could lead to incorrect state or fund manipulation

**Fix Required**:
```solidity
// Update state before external call
userBalances[recipient] += amount;
totalUserBalances += amount;
accountControl.mint(recipient, amount);
```

### 3. MockReimbursementPool.sol - Missing Access Control
**File**: `contracts/test/MockReimbursementPool.sol`
**Lines**: 13-19
**Severity**: MEDIUM-HIGH

**Description**:
The `authorize` and `unauthorize` functions lack access control, allowing any address to grant/revoke authorization.

**Impact**:
- Unauthorized privilege escalation in tests
- Could mask real access control issues during testing

**Fix Required**:
Add owner-only access control to both functions.

## MEDIUM SEVERITY

### 4. Bitcoin Address Validation Issues
**File**: `contracts/account-control/libraries/MessageSigning.sol`, `contracts/account-control/BitcoinAddressUtils.sol`
**Severity**: MEDIUM

**Issues**:
- Missing Base58 checksum validation for P2PKH/P2SH addresses
- Missing Bech32 checksum validation for Segwit addresses
- Incorrect BECH32_GENERATOR constant (should be 5-value GEN array)
- No support for testnet addresses

### 5. QCManager Solvency Check Ignores Staleness
**File**: `contracts/account-control/QCManager.sol`
**Lines**: 907-911
**Severity**: MEDIUM

**Description**:
Solvency checks explicitly ignore oracle data staleness, allowing manipulation through delayed updates.

**Impact**:
- Inaccurate solvency determinations
- Potential for manipulation via stale oracle data

## RECOMMENDED ACTIONS

1. **IMMEDIATE**: Block deployment of MessageSigning.sol to production
2. **SHORT-TERM**: Fix critical security vulnerabilities in order of severity
3. **MEDIUM-TERM**: Implement proper Bitcoin cryptographic validations
4. **LONG-TERM**: Consider off-chain Bitcoin signature verification with on-chain attestations

## Testing Recommendations

All mock contracts should be clearly marked as UNSAFE_FOR_PRODUCTION and include prominent warnings in their documentation and code comments.