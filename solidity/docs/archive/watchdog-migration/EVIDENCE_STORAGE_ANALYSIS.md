# Evidence Storage Analysis and Solutions

**Document Version**: 1.0  
**Date**: 2025-08-05  
**Purpose**: Analyze evidence concatenation issue and evaluate solutions  
**Status**: Design Discussion

---

## Current Implementation Problem

### The Issue
```solidity
// WatchdogSubjectiveReporting.sol line 187
report.evidence = abi.encodePacked(report.evidence, additionalEvidence);
```

**Problems**:
1. **Unbounded Growth**: Evidence can grow infinitely
2. **DoS Vector**: Malicious actors can make reports too expensive to read
3. **Gas Costs**: Each append becomes more expensive
4. **No Validation**: Any data can be appended
5. **No Structure**: Just raw bytes concatenation

### Attack Scenario
```solidity
// Attacker creates report
reportObservation(target, GENERAL_CONCERN, "Minor issue", small_evidence);

// Then repeatedly appends large evidence
for (i = 0; i < 100; i++) {
    appendEvidence(reportId, bytes(10000)); // 10KB each time
}
// Result: 1MB of data, making report unusable
```

---

## Solution Options

### Option 1: Fixed-Size Evidence Array

```solidity
struct Report {
    // ... other fields ...
    bytes32[10] evidenceHashes;  // Fixed array of evidence hashes
    uint8 evidenceCount;
}

struct Evidence {
    bytes32 dataHash;
    string dataType;  // "transaction", "log", "document"
    string location;  // IPFS hash or URL
    address submitter;
    uint256 timestamp;
}

mapping(uint256 => mapping(uint256 => Evidence)) public reportEvidence;

function appendEvidence(
    uint256 reportId,
    bytes32 dataHash,
    string calldata dataType,
    string calldata location
) external onlyRole(WATCHDOG_ROLE) {
    Report storage report = reports[reportId];
    require(report.evidenceCount < 10, "Evidence limit reached");
    
    uint256 evidenceIndex = report.evidenceCount;
    reportEvidence[reportId][evidenceIndex] = Evidence({
        dataHash: dataHash,
        dataType: dataType,
        location: location,
        submitter: msg.sender,
        timestamp: block.timestamp
    });
    
    report.evidenceHashes[evidenceIndex] = dataHash;
    report.evidenceCount++;
}
```

**Pros**:
- Bounded storage
- Structured data
- Clear limits
- Gas predictable

**Cons**:
- Fixed limit might be restrictive
- More complex queries
- Additional storage overhead

### Option 2: Linked List of Evidence

```solidity
struct Evidence {
    bytes32 evidenceHash;
    bytes metadata;  // Small structured data
    address submitter;
    uint256 timestamp;
    uint256 nextEvidenceId;  // Links to next
}

mapping(uint256 => mapping(uint256 => Evidence)) public reportEvidence;
mapping(uint256 => uint256) public firstEvidenceId;
mapping(uint256 => uint256) public lastEvidenceId;
mapping(uint256 => uint256) public evidenceCount;

uint256 public constant MAX_EVIDENCE_PER_REPORT = 20;

function appendEvidence(
    uint256 reportId,
    bytes32 evidenceHash,
    bytes calldata metadata
) external onlyRole(WATCHDOG_ROLE) {
    require(evidenceCount[reportId] < MAX_EVIDENCE_PER_REPORT, "Evidence limit");
    require(metadata.length <= 256, "Metadata too large");
    
    uint256 evidenceId = uint256(keccak256(abi.encode(reportId, block.timestamp, msg.sender)));
    
    reportEvidence[reportId][evidenceId] = Evidence({
        evidenceHash: evidenceHash,
        metadata: metadata,
        submitter: msg.sender,
        timestamp: block.timestamp,
        nextEvidenceId: 0
    });
    
    if (firstEvidenceId[reportId] == 0) {
        firstEvidenceId[reportId] = evidenceId;
    } else {
        reportEvidence[reportId][lastEvidenceId[reportId]].nextEvidenceId = evidenceId;
    }
    
    lastEvidenceId[reportId] = evidenceId;
    evidenceCount[reportId]++;
}
```

**Pros**:
- Dynamic but bounded
- Preserves order
- Flexible traversal
- No array limitations

**Cons**:
- More complex iteration
- Multiple storage slots
- Harder to implement correctly

### Option 3: Evidence Registry Pattern

```solidity
// Separate contract for evidence storage
contract EvidenceRegistry {
    struct Evidence {
        bytes32 contentHash;  // IPFS/Arweave hash
        uint256 reportId;
        address submitter;
        uint256 timestamp;
        EvidenceType evidenceType;
        bool verified;
    }
    
    enum EvidenceType {
        TRANSACTION_HASH,
        LOG_EXTRACT,
        SCREENSHOT,
        DOCUMENT,
        API_RESPONSE,
        OTHER
    }
    
    mapping(bytes32 => Evidence) public evidence;
    mapping(uint256 => bytes32[]) public reportEvidenceIds;
    mapping(uint256 => uint256) public evidenceCount;
    
    uint256 public constant MAX_EVIDENCE_PER_REPORT = 20;
    uint256 public constant MAX_EVIDENCE_SIZE = 256; // For metadata
    
    function submitEvidence(
        uint256 reportId,
        bytes32 contentHash,
        EvidenceType evidenceType,
        bytes calldata metadata
    ) external returns (bytes32 evidenceId) {
        require(evidenceCount[reportId] < MAX_EVIDENCE_PER_REPORT, "Limit reached");
        require(metadata.length <= MAX_EVIDENCE_SIZE, "Metadata too large");
        
        evidenceId = keccak256(abi.encode(
            reportId,
            contentHash,
            msg.sender,
            block.timestamp
        ));
        
        evidence[evidenceId] = Evidence({
            contentHash: contentHash,
            reportId: reportId,
            submitter: msg.sender,
            timestamp: block.timestamp,
            evidenceType: evidenceType,
            verified: false
        });
        
        reportEvidenceIds[reportId].push(evidenceId);
        evidenceCount[reportId]++;
    }
}

// In WatchdogSubjectiveReporting:
struct Report {
    // ... other fields ...
    address evidenceRegistry;
    uint256 evidenceCount;
    // Remove evidence field entirely
}
```

**Pros**:
- Complete separation of concerns
- Can upgrade evidence handling independently
- Professional evidence management
- Easy to add verification layer

**Cons**:
- Additional contract deployment
- Cross-contract calls
- More complex architecture

### Option 4: Simple Hash Array

```solidity
struct Report {
    // ... other fields ...
    bytes32[] evidenceHashes;  // Just store hashes
    // Remove evidence bytes field
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

**Pros**:
- Simplest solution
- Minimal gas costs
- Clear bounds
- Easy to implement

**Cons**:
- No metadata on-chain
- Requires external storage
- Less information available

---

## Evidence Types and Storage Needs

### What Evidence Might Watchdogs Submit?

1. **Transaction Hashes**
   - Size: 32 bytes
   - Storage: On-chain hash is sufficient
   - Example: Suspicious transfers

2. **Log Extracts**
   - Size: 100-1000 bytes
   - Storage: IPFS with hash on-chain
   - Example: API error logs

3. **Screenshots**
   - Size: 100KB-1MB
   - Storage: IPFS/Arweave required
   - Example: UI showing issues

4. **Documents**
   - Size: Variable
   - Storage: IPFS with metadata
   - Example: Compliance reports

5. **Blockchain Data**
   - Size: 32-256 bytes
   - Storage: Can be on-chain
   - Example: Block numbers, addresses

---

## Recommendation

### Recommended Solution: Option 4 (Simple Hash Array) + Standards

**Why**:
1. **Simplicity**: Easiest to implement and audit
2. **Gas Efficient**: Minimal on-chain storage
3. **Flexible**: Can store any evidence type off-chain
4. **Bounded**: Clear limits prevent DoS
5. **Future-Proof**: Can migrate to complex system later

**Implementation**:
```solidity
struct Report {
    uint256 id;
    address watchdog;
    address target;
    ObservationType obsType;
    string description;
    bytes32[] evidenceHashes;    // Array of evidence hashes
    uint256 timestamp;
    uint256 supportCount;
    bool escalated;
}

uint256 public constant MAX_EVIDENCE_PER_REPORT = 20;
uint256 public constant MAX_EVIDENCE_BATCH = 5;

function submitEvidenceBatch(
    uint256 reportId,
    bytes32[] calldata evidenceHashes
) external onlyRole(WATCHDOG_ROLE) {
    Report storage report = reports[reportId];
    
    require(report.timestamp > 0, "Report not found");
    require(
        report.watchdog == msg.sender || hasSupported[reportId][msg.sender],
        "Not authorized"
    );
    require(evidenceHashes.length <= MAX_EVIDENCE_BATCH, "Batch too large");
    require(
        report.evidenceHashes.length + evidenceHashes.length <= MAX_EVIDENCE_PER_REPORT,
        "Would exceed evidence limit"
    );
    
    for (uint i = 0; i < evidenceHashes.length; i++) {
        report.evidenceHashes.push(evidenceHashes[i]);
    }
    
    emit EvidenceBatchAppended(reportId, msg.sender, evidenceHashes);
}
```

### Evidence Standards

Create off-chain standards for evidence:

```json
{
  "evidenceHash": "0x...",
  "type": "transaction|log|document|screenshot",
  "description": "Brief description",
  "source": {
    "ipfs": "QmHash...",
    "arweave": "txId...",
    "url": "https://..."
  },
  "metadata": {
    "timestamp": 1234567890,
    "submitter": "0x...",
    "reportId": 123
  }
}
```

### Migration Path

1. **Phase 1**: Remove concatenation, add hash array
2. **Phase 2**: Define evidence standards
3. **Phase 3**: Build evidence viewer UI
4. **Phase 4**: Consider registry if needed

---

## Decision Points

1. **Storage Limit**: Is 20 evidence items enough?
2. **Hash Type**: Just IPFS or support multiple?
3. **Metadata**: How much on-chain vs off-chain?
4. **Verification**: Add verification layer later?
5. **Access Control**: Who can add evidence?

---

## Conclusion

The simple hash array approach provides:
- **Security**: Bounded storage prevents DoS
- **Flexibility**: Any evidence type via IPFS
- **Simplicity**: Easy to implement and audit
- **Extensibility**: Can enhance later

This solves the immediate vulnerability while keeping options open for future enhancements.