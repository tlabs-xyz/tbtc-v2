# SPV Proof Usage in tBTC V1.1 Account Control System

**Date**: 2025-07-29  
**Purpose**: Document how SPV proofs are used for QC onboarding and why they're essential

---

## Executive Summary

SPV (Simplified Payment Verification) proofs are **critical** for QC onboarding in the account control system. They provide cryptographic proof that a Qualified Custodian (QC) controls specific Bitcoin wallets. This is separate from the watchdog consensus mechanism and must remain intact.

## Current SPV Usage Flow

### 1. Wallet Registration Process

```
QC wants to register Bitcoin wallet
    ↓
QC creates Bitcoin transaction with OP_RETURN containing challenge
    ↓
QC submits SPV proof to SingleWatchdog.registerWalletWithProof()
    ↓
SingleWatchdog verifies SPV proof via SPVValidator
    ↓
If valid, wallet is registered to QC in QCData
```

### 2. Key Components

**SPVValidator.sol** (Account Control)
- Replicates Bridge's SPV verification logic
- Verifies Bitcoin transaction proofs
- Confirms wallet ownership via challenge-response

**SingleWatchdog.sol** (Operation Executor)
- Accepts SPV proofs from operators
- Delegates verification to SPVValidator
- Registers verified wallets

**QCManager.sol** (Core Management)
- Contains `registerWallet()` function
- Requires REGISTRAR_ROLE (granted to SingleWatchdog)
- Verifies SPV proof before registration

## How SPV Verification Works

### 1. Challenge-Response Protocol

```solidity
// QC proves wallet control by:
// 1. Receiving challenge hash from system
// 2. Creating Bitcoin tx with OP_RETURN containing challenge
// 3. Submitting SPV proof of that transaction

function verifyWalletControl(
    address qc,
    string calldata btcAddress,
    bytes32 challenge,
    BitcoinTx.Info calldata txInfo,
    BitcoinTx.Proof calldata proof
) returns (bool) {
    // Step 1: Verify transaction is in Bitcoin blockchain
    validateProof(txInfo, proof);
    
    // Step 2: Verify OP_RETURN contains challenge
    _verifyOpReturnChallenge(txInfo.outputVector, challenge);
    
    // Step 3: Verify tx spends from claimed address
    _verifyInputAddress(txInfo.inputVector, btcAddress);
}
```

### 2. What SPV Proof Contains

```solidity
struct BitcoinTx.Info {
    bytes4 version;
    bytes inputVector;      // Contains spending addresses
    bytes outputVector;     // Contains OP_RETURN with challenge
    bytes4 locktime;
}

struct BitcoinTx.Proof {
    bytes merkleProof;      // Proves tx is in block
    uint256 txIndexInBlock;
    bytes bitcoinHeaders;   // Chain of block headers
    bytes32 coinbasePreimage;
    bytes coinbaseProof;
}
```

### 3. Security Guarantees

- **Proof of Inclusion**: Transaction is confirmed in Bitcoin blockchain
- **Proof of Control**: Only wallet owner can create spending transaction
- **Challenge Uniqueness**: Prevents replay attacks
- **Difficulty Validation**: Ensures sufficient work on Bitcoin chain

## Why SPV is Essential for QC Onboarding

### 1. Cryptographic Proof of Control
- Legal agreements say QC controls wallets
- SPV proves it cryptographically on-chain
- No trust required - math proves ownership

### 2. Prevents Wallet Theft
- QC can't claim someone else's wallet
- Each wallet registration requires proof of control
- System can verify claims independently

### 3. Audit Trail
- Every wallet registration has on-chain proof
- Can be verified years later
- Provides evidence for compliance

### 4. Automated Verification
- No manual process needed
- Reduces operational overhead
- Instant verification of ownership

## SPV vs Watchdog Consensus

These serve **completely different purposes**:

| Aspect | SPV Proofs | Watchdog Consensus |
|--------|------------|-------------------|
| **Purpose** | Prove wallet ownership | Approve operations |
| **When Used** | QC onboarding only | Ongoing operations |
| **Trust Model** | Trustless (cryptographic) | Social (majority vote) |
| **Can Be Faked** | No (math) | Yes (collusion) |
| **Gas Cost** | High (~300k) | Medium (~150k) |
| **Complexity** | High (Bitcoin parsing) | Low (vote counting) |

## Critical Implementation Notes

### 1. SPV Cannot Be Removed
Even with simplified watchdog consensus, SPV must remain because:
- It's the only trustless way to prove wallet control
- Required for secure QC onboarding
- Prevents fraudulent wallet claims

### 2. Not Used for Reserve Attestations
- Reserve attestations use watchdog consensus (social proof)
- Why? Proving total reserves via SPV would be extremely complex
- Would need to verify balances of multiple addresses
- Gas costs would be prohibitive

### 3. Integration Points

```solidity
// Current flow (must be preserved):
SingleWatchdog.registerWalletWithProof()
    → SPVValidator.verifyWalletControl()
    → QCManager.registerWallet()
    → QCData.registerWallet()
```

## Example: QC Wallet Registration

### Step 1: QC Receives Challenge
```javascript
const challenge = ethers.utils.id("QC_WALLET_CHALLENGE_12345")
// 0x7f3e9c4d2a1b8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c
```

### Step 2: QC Creates Bitcoin Transaction
```
Input: bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh (QC's wallet)
Output 1: bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh (change)
Output 2: OP_RETURN 7f3e9c4d2a1b8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c
```

### Step 3: QC Submits SPV Proof
```solidity
singleWatchdog.registerWalletWithProof(
    qcAddress,
    "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    spvProofData, // Contains BitcoinTx.Info and BitcoinTx.Proof
    challenge
)
```

### Step 4: System Verifies and Registers
- SPV proof validates transaction exists in Bitcoin
- OP_RETURN contains correct challenge
- Transaction spends from claimed address
- Wallet registered to QC

## Security Considerations

### 1. Challenge Generation
- Must be unique per registration attempt
- Should include QC address and timestamp
- Prevents replay attacks

### 2. SPV Proof Validation
- Uses same logic as Bridge contract
- Requires sufficient Bitcoin confirmations
- Validates against current difficulty

### 3. Access Control
- Only REGISTRAR_ROLE can register wallets
- Currently granted to SingleWatchdog
- Could be granted to WatchdogConsensus if needed

## Future Considerations

### 1. Gas Optimization
- SPV verification costs ~300k gas
- Could batch multiple wallet registrations
- Consider ZK proofs in future

### 2. Multi-Wallet Registration
- Currently one wallet at a time
- Could allow Merkle tree of wallets
- Single proof for multiple addresses

### 3. Integration with Watchdog Consensus
- Keep SPV for wallet registration
- Use consensus for operational decisions
- Clear separation of concerns

## Conclusion

SPV proofs are **essential** for secure QC onboarding and must be preserved regardless of the watchdog consensus model. They provide the only trustless way to prove Bitcoin wallet ownership, which is fundamental to the security of the entire tBTC system. While we use simple majority voting for ongoing operations, we rely on cryptographic proofs for the critical step of wallet registration.