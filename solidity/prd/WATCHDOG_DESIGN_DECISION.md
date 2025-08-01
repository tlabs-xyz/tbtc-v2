# Watchdog Design Decision Record

**Date**: 2025-08-01  
**Decision**: Use SingleWatchdog model instead of majority voting consensus  
**Status**: Recommended for V1.1

---

## Context

We evaluated whether to implement a majority voting system for watchdog operations (attestations, status changes, etc.) versus keeping the current SingleWatchdog model.

## Key Insights

### 1. Complexity Doesn't Equal Security

**Initial assumption**: Multiple watchdogs voting = more secure  
**Reality**: For KYC'd, legally contracted entities, voting adds complexity without proportional security benefit

### 2. Coordination is a Hidden Cost

**What voting requires**:
- N watchdogs must coordinate timing
- Agreement on exact data values
- Handling partial votes/timeouts
- Managing conflicting proposals

**What single watchdog requires**:
- One attestation, done

### 3. Trust Model Reality

We're not dealing with anonymous DeFi users. These are:
- **Legally contracted** service providers
- **KYC'd entities** with real-world identity
- **Professionally liable** for false attestations
- **Economically incentivized** to be accurate

If we can't trust one professional watchdog to report a Bitcoin balance, voting won't fix the underlying trust issue.

### 4. Failure Modes Multiply

**Single Watchdog**:
- Watchdog offline → clear failure, clear accountability

**Majority Voting**:
- Watchdog A votes, B is offline, C disagrees on value
- Who's responsible? How long to wait? What's the resolution?
- More complexity = more ways to fail

### 5. Optimistic Approaches Don't Eliminate Complexity

Propose + Challenge models sound elegant but:
- Challenged operations still need resolution
- This means voting anyway (back to square one)
- Now we have TWO phases of complexity

## Decision

**Use SingleWatchdog model for V1.1** with monitoring capabilities.

### Implementation Approach

1. **Keep SingleWatchdog as-is**:
```solidity
function attestReserves(address qc, uint256 balance) external onlyRole(WATCHDOG_OPERATOR_ROLE) {
    reserveLedger.submitReserveAttestation(qc, balance);
}
```

2. **Add Monitoring Layer**:
```solidity
contract WatchdogMonitor {
    event SuspiciousAttestation(address watchdog, address qc, uint256 balance, string reason);
    
    function flagAttestation(address qc, uint256 reportedBalance, string reason) 
        external onlyWatchdog {
        emit SuspiciousAttestation(msg.sender, qc, reportedBalance, reason);
    }
}
```

3. **Multiple Watchdogs for Redundancy, Not Consensus**:
- Deploy multiple SingleWatchdog instances
- Each can operate independently
- Natural redundancy without coordination
- DAO can revoke misbehaving watchdogs

## Benefits of This Approach

1. **Simplicity**: Already implemented, well-tested
2. **Clear Accountability**: Each action tied to specific watchdog
3. **No Coordination Overhead**: Operations execute immediately
4. **Flexibility**: Can add monitoring without changing core flow
5. **Legal Protection**: Existing contracts and liability cover trust

## Future Considerations

### If we need more security later:

1. **Rotation System**: Different watchdog responsible each day/week
2. **Random Selection**: Use blockhash to select today's watchdog
3. **Escalation Path**: DAO can require multiple attestations for specific QCs
4. **Automated Monitoring**: Compare attestations across watchdogs, flag deviations

### What we're NOT doing:

1. **Not** requiring coordination for routine operations
2. **Not** adding voting complexity without clear benefit
3. **Not** solving trust issues with technical complexity
4. **Not** optimizing for theoretical attacks over practical operations

## Conclusion

> "A complex system that works is invariably found to have evolved from a simple system that worked. A complex system designed from scratch never works and cannot be patched up to make it work."  
> — John Gall, Systemantics

We have a simple system that works (SingleWatchdog). Let's not break it by adding complexity we don't need.

## Action Items

1. ✅ Keep SingleWatchdog implementation as-is
2. ⬜ Add monitoring capabilities for cross-watchdog verification
3. ⬜ Document operational procedures for multiple independent watchdogs
4. ⬜ Set up alerting for attestation discrepancies
5. ❌ Do NOT implement majority voting consensus

## Approval

This decision should be reviewed by:
- [ ] Technical team
- [ ] Security team  
- [ ] Operations team
- [ ] Legal/Compliance team

**Rationale**: When you have legal contracts and professional liability, use them. Don't try to solve trust problems with technical complexity.