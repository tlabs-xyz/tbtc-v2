# What Is Evidence in the Watchdog Context?

**Document Version**: 1.0  
**Date**: 2025-08-05  
**Purpose**: Define what constitutes "evidence" for watchdog observations  
**Status**: Conceptual Analysis

---

## Core Question: What Is Evidence?

In the context of subjective watchdog observations, "evidence" is data that supports or validates an observation. Since these are SUBJECTIVE observations (not objective facts), the evidence serves to:

1. **Provide context** for the observation
2. **Enable verification** by other watchdogs
3. **Help DAO members** understand the issue
4. **Create accountability** for the reporter

---

## Evidence by Observation Type

### SUSPICIOUS_PATTERN: "QC routing 80% of redemptions through new addresses"

**What is the evidence?**
- List of redemption transaction hashes
- Analysis showing address creation times
- Pattern visualization/summary
- Time period of observation

**NOT evidence**:
- Just saying "it looks suspicious"
- Personal opinions
- Unverifiable claims

**On-chain data needed**: Transaction hashes (32 bytes each)
**Off-chain data needed**: Analysis report, address clustering data

### OPERATIONAL_CONCERN: "QC response times degrading"

**What is the evidence?**
- API response time logs
- Timestamps of slow responses
- Comparison with SLA/baseline
- Number of affected users

**NOT evidence**:
- "Feels slower"
- Single anecdotal experience
- No timestamps

**On-chain data needed**: Hash of log file
**Off-chain data needed**: Actual logs, analysis

### UNUSUAL_BEHAVIOR: "QC changed signing keys without notice"

**What is the evidence?**
- Old key address
- New key address
- Transaction showing key change
- Screenshot of missing announcement
- Expected notification channel

**NOT evidence**:
- "I think they changed keys"
- No specific addresses
- No timeline

**On-chain data needed**: Key addresses, transaction hash
**Off-chain data needed**: Screenshots, communication archives

### COMPLIANCE_QUESTION: "QC accepting funds from sanctioned addresses"

**What is the evidence?**
- Specific transaction hashes
- Sanctioned address list reference
- Transaction trace showing flow
- Date of sanction vs transaction

**NOT evidence**:
- "Might be sanctioned"
- No specific addresses
- Outdated sanction data

**On-chain data needed**: Transaction hashes, addresses
**Off-chain data needed**: Sanction list snapshot, analysis

### SECURITY_OBSERVATION: "Potential private key compromise indicators"

**What is the evidence?**
- Unusual transaction patterns
- Transactions from unexpected locations
- Multiple failed transaction attempts
- Timing analysis of transactions

**NOT evidence**:
- "Seems compromised"
- Fear without data
- Speculation

**On-chain data needed**: Transaction hashes showing pattern
**Off-chain data needed**: Pattern analysis, timeline

---

## Evidence Categories

### 1. On-Chain References (Can be stored directly)
- Transaction hashes (32 bytes)
- Block numbers (32 bytes)
- Addresses (20 bytes)
- Event logs (variable, but references)

### 2. Off-Chain Data (Must be hashed)
- Log files
- Screenshots
- API responses
- Analysis reports
- Communication records

### 3. External References
- Sanction lists
- Regulatory documents
- Public announcements
- News articles

### 4. Derived Analysis
- Pattern summaries
- Statistical analysis
- Trend visualizations
- Comparative data

---

## What Evidence Is NOT

### Not Evidence: Opinions
❌ "I don't trust this QC"
❌ "This seems wrong"
❌ "Other watchdogs agree with me"

### Not Evidence: Predictions
❌ "This will probably fail"
❌ "Users might lose money"
❌ "Could be a problem later"

### Not Evidence: Hearsay
❌ "I heard from someone..."
❌ "Users are complaining"
❌ "There are rumors..."

### Not Evidence: Feelings
❌ "This makes me uncomfortable"
❌ "I have a bad feeling"
❌ "Something seems off"

---

## Evidence Quality Standards

### High-Quality Evidence
✅ **Specific**: Exact transactions, addresses, times
✅ **Verifiable**: Others can check the same data
✅ **Relevant**: Directly related to the observation
✅ **Timely**: Recent and within context
✅ **Complete**: Full picture, not cherry-picked

### Low-Quality Evidence
❌ **Vague**: "Several transactions"
❌ **Unverifiable**: "Trust me"
❌ **Tangential**: Loosely related
❌ **Outdated**: Old data for current issue
❌ **Selective**: Only shows part of picture

---

## Practical Evidence Storage

Given this understanding, evidence should be:

### For Simple Observations
```solidity
// Just transaction hashes that others can verify
bytes32[] memory evidenceHashes = [
    0x123..., // tx showing pattern
    0x456..., // tx showing pattern
    0x789...  // tx showing pattern
];
```

### For Complex Observations
```json
{
    "observationType": "SUSPICIOUS_PATTERN",
    "evidenceSummary": {
        "transactions": ["0x123...", "0x456..."],
        "analysis": "ipfs://QmXxx...",  // Detailed analysis
        "timeframe": "2024-01-01 to 2024-01-07",
        "affectedAmount": "1000 BTC"
    }
}
```

---

## Design Implications

### 1. Evidence != Proof
- Evidence supports observations
- DAO decides if evidence is convincing
- Multiple weak evidence can be strong together

### 2. Storage Needs
- Most evidence is references (hashes)
- Actual data lives off-chain
- On-chain stores pointers

### 3. Verification Flow
```
Watchdog observes → Gathers evidence → Submits hashes → 
Other watchdogs verify → DAO reviews full evidence → Decision
```

### 4. Quality Control
- Other watchdogs can verify evidence
- Support indicates evidence quality
- DAO filters based on evidence strength

---

## Conclusion

Evidence in the watchdog context is:
1. **Verifiable data** that supports subjective observations
2. **References** (hashes) stored on-chain
3. **Actual content** stored off-chain (IPFS)
4. **Quality indicator** for report credibility

The key insight: Evidence doesn't make observations objective - it makes them verifiable and credible. The DAO still needs to interpret and decide.