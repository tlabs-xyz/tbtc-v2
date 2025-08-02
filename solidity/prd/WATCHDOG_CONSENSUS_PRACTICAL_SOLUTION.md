# Practical Solution: Watchdog Consensus Coordination

**Document Version**: 1.0  
**Date**: 2025-08-01  
**Purpose**: Immediate practical solution for watchdog consensus coordination  
**Status**: Implementation Guide

---

## Quick Win Solution

Instead of redesigning the entire consensus system, implement a coordination layer that allows watchdogs to communicate and validate proposals before voting.

---

## Option 1: Standardized Reason Codes (Minimal Change)

### Contract Enhancement

```solidity
// Add to WatchdogConsensusManager.sol
mapping(bytes32 => bool) public validReasonCodes;

// Predefined reason codes
bytes32 constant REASON_INSUFFICIENT_RESERVES = keccak256("INSUFFICIENT_RESERVES");
bytes32 constant REASON_REDEMPTION_TIMEOUT = keccak256("REDEMPTION_TIMEOUT");
bytes32 constant REASON_WALLET_COMPROMISED = keccak256("WALLET_COMPROMISED");
bytes32 constant REASON_PROLONGED_INACTIVITY = keccak256("PROLONGED_INACTIVITY");

function proposeStatusChange(
    address qc,
    QCData.QCStatus newStatus,
    bytes32 reasonCode,        // Machine-readable
    string calldata details     // Human-readable supplement
) external onlyRole(WATCHDOG_ROLE) returns (bytes32 proposalId) {
    require(validReasonCodes[reasonCode], "Invalid reason code");
    
    // Include reason code in proposal ID to prevent duplicates
    bytes memory data = abi.encode(qc, newStatus, reasonCode);
    proposalId = keccak256(abi.encodePacked(
        ProposalType.STATUS_CHANGE, 
        data, 
        block.number / 100  // Allow new proposal every 100 blocks
    ));
    
    _createProposal(ProposalType.STATUS_CHANGE, data, details);
}
```

### Watchdog Implementation

```javascript
// Watchdog can now understand proposals
async function evaluateProposal(proposal) {
    const [qc, newStatus, reasonCode] = decode(proposal.data);
    
    switch(reasonCode) {
        case 'INSUFFICIENT_RESERVES':
            // Check own attestation data
            const reserves = await getLatestReserves(qc);
            const minted = await getMintedAmount(qc);
            return reserves < minted;
            
        case 'REDEMPTION_TIMEOUT':
            // Verify timeout from own monitoring
            const redemptions = await getPendingRedemptions(qc);
            return redemptions.some(r => isTimedOut(r));
            
        default:
            return false; // Unknown reason, don't vote
    }
}
```

---

## Option 2: Off-Chain Coordination API (No Contract Changes)

### Watchdog Coordination Service

Each watchdog exposes an endpoint for proposal coordination:

```
POST /api/v1/consensus/propose
{
    "proposalType": "STATUS_CHANGE",
    "target": "0x123...",
    "newStatus": "UNDER_REVIEW", 
    "evidence": {
        "type": "INSUFFICIENT_RESERVES",
        "reserves": "500000000",
        "minted": "1000000000",
        "attestationBlock": 19234567,
        "attestationSources": ["watchdog1", "watchdog2"]
    }
}

Response:
{
    "proposalId": "0xabc...",
    "support": true,
    "reason": "Evidence matches local data"
}
```

### Coordination Flow

1. **Watchdog detects issue** (e.g., insufficient reserves)
2. **Broadcasts intent** to other watchdogs via API
3. **Collects preliminary support** before creating on-chain proposal
4. **Creates proposal** only if threshold support exists
5. **Other watchdogs vote** based on pre-coordination

### Benefits
- No contract changes needed
- Prevents most duplicate proposals
- Allows evidence sharing
- Maintains security (on-chain voting still required)

---

## Option 3: Proposal Deduplication Helper

### Simple Contract Addition

```solidity
// Add to WatchdogConsensusManager
mapping(bytes32 => bytes32) public activeProposals; // actionHash => proposalId

function getActiveProposal(
    ProposalType proposalType,
    bytes calldata actionData
) external view returns (bytes32 proposalId) {
    bytes32 actionHash = keccak256(abi.encodePacked(proposalType, actionData));
    proposalId = activeProposals[actionHash];
    
    if (proposalId != 0) {
        Proposal storage proposal = proposals[proposalId];
        // Check if still active (not expired or executed)
        if (!proposal.executed && 
            block.timestamp < proposal.timestamp + votingPeriod) {
            return proposalId;
        }
    }
    return 0;
}

function _createProposal(...) internal {
    // ... existing code ...
    
    // Register active proposal
    bytes32 actionHash = keccak256(abi.encodePacked(proposalType, data));
    activeProposals[actionHash] = proposalId;
}
```

### Watchdog Usage

```javascript
// Before creating proposal, check if one exists
const actionData = encode([qc, newStatus]);
const existingProposal = await consensusManager.getActiveProposal(
    ProposalType.STATUS_CHANGE,
    actionData
);

if (existingProposal !== '0x0') {
    // Vote on existing proposal instead
    await consensusManager.vote(existingProposal);
} else {
    // Create new proposal
    await consensusManager.proposeStatusChange(qc, newStatus, reason);
}
```

---

## Recommended Approach

**Start with Option 1 + Option 3**:
1. Implement standardized reason codes (Option 1)
2. Add deduplication helper (Option 3)
3. Update watchdog software to use both

**Benefits**:
- Minimal contract changes
- Backward compatible
- Solves immediate problems
- Can evolve to full evidence system later

**Implementation Timeline**:
- Week 1: Contract updates
- Week 2: Watchdog software updates
- Week 3: Testing and deployment
- Week 4: Monitor and refine

---

## Future Evolution Path

```
Current System (human-readable)
    ↓
Reason Codes (machine + human readable)  ← We are here
    ↓
Evidence Structs (full machine validation)
    ↓
Autonomous Consensus (no human intervention)
```

This pragmatic approach solves the immediate problems while leaving room for future improvements.