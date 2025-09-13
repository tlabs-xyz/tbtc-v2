# Reserve Backing Integration Pattern

## Architecture Overview

The V2 Account Control system uses a clean separation of concerns:
- **AccountControl**: Enforces mathematical invariant (backing >= minted)
- **ReserveOracle**: Provides attested backing values through consensus
- **Reserves** (e.g., QCManager): Bridge between oracle and AccountControl

## Current Implementation

```solidity
function updateBacking(uint256 amount) external onlyAuthorizedReserve
```

This function is essential for reserves to inform AccountControl of their backing, whether from:
- Oracle-attested values (production)
- Manual updates (testing)
- Direct setting (development)

## Data Flow

```
1. Attesters submit balance attestations to ReserveOracle
   └─> reserveOracle.attestBalance(qc, balance)

2. Consensus reached when threshold met (e.g., 2/3 attesters agree)
   └─> Median balance calculated
   └─> Reserve balance stored in oracle

3. Reserve queries oracle for its attested balance
   └─> balance = reserveOracle.getReserveBalance(address(this))

4. Reserve updates AccountControl with this backing
   └─> accountControl.updateBacking(balance)
```

**Key Point**: AccountControl doesn't know about ReserveOracle. It only knows that authorized reserves can update their own backing.

### Implementation Requirements

To enable this flow:

1. **Add oracle integration to reserves**:
   ```solidity
   function syncBackingFromOracle() external {
       (uint256 balance, ) = reserveOracle.getReserveBalanceAndStaleness(address(this));
       accountControl.updateBacking(balance);
   }
   ```

2. **Consider automation**:
   - Watchdog service could trigger syncs
   - Time-based sync requirements
   - Event-driven updates on consensus

3. **Handle staleness**:
   - ReserveOracle tracks `lastUpdateTimestamp`
   - Implement maximum staleness thresholds
   - Pause minting if backing data too old

### Security Considerations

- **Attestation Quality**: Multiple attesters prevent single point of failure
- **Median Consensus**: Resistant to outlier manipulation
- **Update Frequency**: Balance between gas costs and freshness
- **Emergency Controls**: DISPUTE_ARBITER_ROLE can manually set balances

### Migration Path

1. **Phase 1** (Current): Direct updateBacking() calls
2. **Phase 2**: Optional oracle integration
3. **Phase 3**: Mandatory oracle-based backing updates
4. **Phase 4**: Fully automated synchronization

## Testing Strategy

The current `updateBacking()` function should be retained for:
- Unit tests requiring specific backing states
- Integration tests simulating various scenarios
- Development environments without oracle infrastructure

Production deployments would restrict or remove direct backing updates in favor of oracle-attested values.