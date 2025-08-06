# Evidence Storage Final Design

**Document Version**: 1.0  
**Date**: 2025-08-05  
**Purpose**: Final design for evidence storage using hash + REST API approach  
**Status**: Design Decision

---

## The Approach: Hash On-Chain, Evidence via REST API

### Core Design
1. **On-chain**: Store only evidence hashes (32 bytes each)
2. **Off-chain**: Watchdog operators host REST API with actual evidence
3. **Access**: DAO members can fetch evidence using hash as key
4. **Security**: API is permissioned, only accessible by DAO

---

## Why This Approach Is Superior

### Advantages over IPFS
1. **No External Dependencies**: No need for IPFS nodes/gateways
2. **Access Control**: Can restrict to DAO members only
3. **Dynamic Content**: Can update/annotate evidence if needed
4. **Cost Efficient**: Watchdogs already run infrastructure
5. **Privacy**: Sensitive data not publicly accessible
6. **Availability**: Watchdogs incentivized to keep API running

### Advantages over Full On-Chain
1. **Gas Efficient**: Only 32 bytes per evidence
2. **Flexible Format**: Any evidence type supported
3. **Scalable**: No blockchain bloat
4. **Updatable**: Can add context without new transactions

---

## Implementation Design

### Smart Contract Side

```solidity
struct Report {
    uint256 id;
    address watchdog;
    address target;
    ObservationType obsType;
    string description;
    bytes32[] evidenceHashes;    // Just hashes
    uint256 timestamp;
    uint256 supportCount;
    bool escalated;
}

uint256 public constant MAX_EVIDENCE_PER_REPORT = 20;

function appendEvidence(
    uint256 reportId,
    bytes32 evidenceHash
) external onlyRole(WATCHDOG_ROLE) {
    Report storage report = reports[reportId];
    
    require(report.timestamp > 0, "Report not found");
    require(
        report.watchdog == msg.sender || hasSupported[reportId][msg.sender],
        "Not authorized"
    );
    require(
        report.evidenceHashes.length < MAX_EVIDENCE_PER_REPORT,
        "Evidence limit reached"
    );
    
    report.evidenceHashes.push(evidenceHash);
    
    emit EvidenceAppended(reportId, msg.sender, evidenceHash);
}
```

### REST API Design

```yaml
# API Specification
endpoints:
  GET /evidence/{hash}:
    description: Retrieve evidence by hash
    authentication: DAO member signature
    response:
      schema:
        hash: string (32 bytes)
        reportId: number
        submitter: address
        timestamp: number
        type: enum [transaction, log, screenshot, document, analysis]
        content: object
          description: string
          data: string (base64 or JSON)
          metadata: object
        signatures: array
          - watchdog: address
            signature: string
            timestamp: number

  GET /evidence/bulk:
    description: Retrieve multiple evidence items
    parameters:
      hashes: array of strings
    authentication: DAO member signature
    response:
      array of evidence objects

  GET /report/{reportId}/evidence:
    description: Get all evidence for a report
    authentication: DAO member signature
    response:
      array of evidence objects
```

### Evidence Structure

```json
{
  "hash": "0x1234567890abcdef...",
  "reportId": 42,
  "submitter": "0xWatchdogAddress...",
  "timestamp": 1704067200,
  "type": "transaction_analysis",
  "content": {
    "description": "Analysis of suspicious redemption patterns",
    "data": {
      "transactions": [
        {
          "hash": "0xabc...",
          "from": "0x...",
          "to": "0x...",
          "value": "100000000",
          "suspicious_indicators": ["new_address", "immediate_transfer"]
        }
      ],
      "pattern_summary": "80% of redemptions routed through addresses created within 24h",
      "timeframe": "2024-01-01 to 2024-01-07",
      "visual_chart": "base64_encoded_image"
    },
    "metadata": {
      "tool_used": "chain_analysis_v2",
      "confidence": "high"
    }
  },
  "signatures": [
    {
      "watchdog": "0xOriginalReporter...",
      "signature": "0xsig1...",
      "timestamp": 1704067200
    },
    {
      "watchdog": "0xSupportingWatchdog...",
      "signature": "0xsig2...",
      "timestamp": 1704067500
    }
  ]
}
```

---

## Security Model

### Authentication Flow
```
1. DAO member requests evidence
2. Signs request with their DAO member key
3. Watchdog API verifies signature against DAO contract
4. If valid, returns evidence
5. DAO member can verify evidence hash matches on-chain
```

### API Security Requirements
1. **HTTPS only**: Encrypted transport
2. **Rate limiting**: Prevent DoS
3. **Request signing**: Authenticate DAO members
4. **Audit logging**: Track all access
5. **Hash verification**: Client verifies hash matches

### Trust Model
- **Trust**: DAO trusts watchdog to serve correct evidence
- **Verification**: Hash ensures evidence hasn't changed
- **Redundancy**: Multiple watchdogs can serve same evidence
- **Accountability**: Access logs show who retrieved what

---

## Operational Considerations

### Watchdog Requirements
1. **API Availability**: Must maintain 95%+ uptime
2. **Evidence Retention**: Keep evidence for minimum 1 year
3. **Backup**: Regular backups of evidence database
4. **Performance**: Response time < 2 seconds
5. **Capacity**: Handle 100 requests/minute

### DAO Integration
```javascript
// DAO frontend pseudocode
async function reviewReport(reportId) {
  // Get report from blockchain
  const report = await contract.getReport(reportId);
  
  // Fetch evidence from watchdog API
  const evidence = [];
  for (const hash of report.evidenceHashes) {
    try {
      const response = await watchdogAPI.getEvidence(hash, signature);
      
      // Verify hash matches
      if (keccak256(response) !== hash) {
        throw new Error("Evidence tampered");
      }
      
      evidence.push(response);
    } catch (e) {
      console.error(`Failed to fetch evidence ${hash}`);
    }
  }
  
  // Display evidence to DAO member
  displayEvidence(evidence);
}
```

---

## Migration Path

### Phase 1: Update Contract
1. Remove evidence concatenation
2. Add hash array storage
3. Deploy updated contract

### Phase 2: Build API
1. Watchdogs implement REST API
2. Test with sample evidence
3. Document API endpoints

### Phase 3: DAO Integration
1. Update DAO frontend
2. Add evidence viewing UI
3. Test end-to-end flow

### Phase 4: Operationalize
1. Monitor API availability
2. Regular backups
3. Performance optimization

---

## Alternative Considerations

### Fallback Options
1. **Multiple Watchdog APIs**: Evidence replicated across watchdogs
2. **IPFS Backup**: Also store on IPFS as fallback
3. **On-Chain Summary**: Store brief summary on-chain

### Future Enhancements
1. **Evidence Verification**: Other watchdogs can countersign
2. **ZK Proofs**: Prove evidence properties without revealing
3. **Decentralized Storage**: Move to decentralized solution later

---

## Benefits Summary

This approach provides:
1. **Efficiency**: Minimal on-chain storage
2. **Privacy**: Evidence only accessible to DAO
3. **Flexibility**: Any evidence format supported
4. **Accountability**: Clear audit trail
5. **Practicality**: Uses existing infrastructure
6. **Security**: Permissioned access control

The key insight: By keeping evidence off-chain but hash-verified, we get the best of both worlds - gas efficiency and evidence integrity, with practical access control.