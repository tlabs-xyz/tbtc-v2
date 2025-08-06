// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title QCReserveLedger
/// @notice Unified contract for reserve attestation and consensus
/// @dev Combines oracle consensus and ledger storage in a single atomic operation
contract QCReserveLedger is AccessControl {
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    
    struct ReserveData {
        uint256 balance;
        uint256 lastUpdateTimestamp;
    }
    
    struct PendingAttestation {
        uint256 balance;
        uint256 timestamp;
        address attester;
    }
    
    
    // QC address => ReserveData
    mapping(address => ReserveData) public reserves;
    
    // QC address => attester address => PendingAttestation
    mapping(address => mapping(address => PendingAttestation)) public pendingAttestations;
    
    // QC address => array of attester addresses who have pending attestations
    mapping(address => address[]) public pendingAttesters;
    
    
    // Configuration
    uint256 public consensusThreshold = 3;
    uint256 public attestationTimeout = 6 hours; // Time window for attestations to be considered valid
    uint256 public maxStaleness = 24 hours; // Maximum time before reserve data is considered stale
    
    // Events
    event AttestationSubmitted(
        address indexed qc,
        address indexed attester,
        uint256 balance,
        uint256 timestamp
    );
    
    event ConsensusReached(
        address indexed qc,
        uint256 consensusBalance,
        uint256 attestationCount,
        uint256 timestamp
    );
    
    event ReserveUpdated(
        address indexed qc,
        uint256 oldBalance,
        uint256 newBalance,
        uint256 timestamp
    );
    
    event ConsensusThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event AttestationTimeoutUpdated(uint256 oldTimeout, uint256 newTimeout);
    event MaxStalenessUpdated(uint256 oldStaleness, uint256 newStaleness);
    
    // Errors
    error InvalidBalance();
    error InvalidThreshold();
    error InvalidTimeout();
    error NoConsensusYet();
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        // Only admin role needed - attesters granted separately
    }
    
    /// @notice Submit an attestation for a QC's reserve balance
    /// @dev Only attest when there's actual reserve movement or data is stale
    /// @param qc The QC address
    /// @param balance The attested reserve balance
    function submitAttestation(address qc, uint256 balance) external onlyRole(ATTESTER_ROLE) {
        if (balance == 0) revert InvalidBalance();
        
        // Store attestation
        pendingAttestations[qc][msg.sender] = PendingAttestation({
            balance: balance,
            timestamp: block.timestamp,
            attester: msg.sender
        });
        
        // Track attester if not already tracked
        _trackAttester(qc, msg.sender);
        
        emit AttestationSubmitted(qc, msg.sender, balance, block.timestamp);
        
        // Attempt to reach consensus
        _attemptConsensus(qc);
    }
    
    /// @notice Get reserve balance and staleness for a QC
    /// @param qc The QC address
    /// @return balance The last consensus balance
    /// @return isStale Whether the balance is stale (older than maxStaleness)
    function getReserveBalanceAndStaleness(address qc) 
        external 
        view 
        returns (uint256 balance, bool isStale) 
    {
        ReserveData memory data = reserves[qc];
        balance = data.balance;
        isStale = data.lastUpdateTimestamp == 0 || block.timestamp > data.lastUpdateTimestamp + maxStaleness;
    }
    
    
    /// @notice Update consensus threshold
    /// @param newThreshold New number of attestations required
    function setConsensusThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newThreshold == 0) revert InvalidThreshold();
        uint256 oldThreshold = consensusThreshold;
        consensusThreshold = newThreshold;
        emit ConsensusThresholdUpdated(oldThreshold, newThreshold);
    }
    
    /// @notice Update attestation timeout
    /// @param newTimeout New timeout in seconds
    function setAttestationTimeout(uint256 newTimeout) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTimeout == 0) revert InvalidTimeout();
        uint256 oldTimeout = attestationTimeout;
        attestationTimeout = newTimeout;
        emit AttestationTimeoutUpdated(oldTimeout, newTimeout);
    }
    
    /// @notice Update maximum staleness period
    /// @param newStaleness New staleness threshold in seconds
    function setMaxStaleness(uint256 newStaleness) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newStaleness == 0) revert InvalidTimeout();
        uint256 oldStaleness = maxStaleness;
        maxStaleness = newStaleness;
        emit MaxStalenessUpdated(oldStaleness, newStaleness);
    }
    
    /// @notice Check if reserve data is stale and needs fresh attestations
    /// @param qc The QC address
    /// @return isStale Whether the reserve data is older than maxStaleness
    /// @return timeSinceUpdate Time in seconds since last update
    function isReserveStale(address qc) 
        external 
        view 
        returns (bool isStale, uint256 timeSinceUpdate) 
    {
        ReserveData memory data = reserves[qc];
        if (data.lastUpdateTimestamp == 0) {
            return (true, type(uint256).max); // Never updated
        }
        timeSinceUpdate = block.timestamp - data.lastUpdateTimestamp;
        isStale = timeSinceUpdate > maxStaleness;
    }
    
    /// @dev Attempt to reach consensus for a QC
    function _attemptConsensus(address qc) internal {
        address[] memory attesters = pendingAttesters[qc];
        uint256 validCount = 0;
        uint256[] memory validBalances = new uint256[](attesters.length);
        
        // Collect valid attestations within timeout window
        for (uint256 i = 0; i < attesters.length; i++) {
            PendingAttestation memory attestation = pendingAttestations[qc][attesters[i]];
            
            // Check if attestation is still valid (not expired)
            if (block.timestamp <= attestation.timestamp + attestationTimeout) {
                validBalances[validCount] = attestation.balance;
                validCount++;
            }
        }
        
        // Check if we have enough valid attestations
        if (validCount < consensusThreshold) {
            return; // Not enough attestations yet
        }
        
        // Calculate median of valid balances
        uint256 consensusBalance = _calculateMedian(validBalances, validCount);
        
        // Update reserve data
        uint256 oldBalance = reserves[qc].balance;
        reserves[qc] = ReserveData({
            balance: consensusBalance,
            lastUpdateTimestamp: block.timestamp
        });
        
        // Clear pending attestations for this QC
        _clearPendingAttestations(qc);
        
        emit ConsensusReached(qc, consensusBalance, validCount, block.timestamp);
        emit ReserveUpdated(qc, oldBalance, consensusBalance, block.timestamp);
    }
    
    /// @dev Calculate median using insertion sort (efficient for small arrays)
    function _calculateMedian(uint256[] memory values, uint256 length) internal pure returns (uint256) {
        require(length <= 10, "Too many attesters for consensus");
        if (length == 0) return 0;
        if (length == 1) return values[0];
        
        // Insertion sort - O(n²) worst case, O(n) best case for nearly sorted data
        // Very efficient for small arrays (n ≤ 10) with good constant factors
        for (uint256 i = 1; i < length; i++) {
            uint256 key = values[i];
            uint256 j = i;
            while (j > 0 && values[j-1] > key) {
                values[j] = values[j-1];
                j--;
            }
            values[j] = key;
        }
        
        // Return median
        if (length % 2 == 0) {
            return (values[length / 2 - 1] + values[length / 2]) / 2;
        } else {
            return values[length / 2];
        }
    }
    
    /// @dev Track an attester for a QC
    function _trackAttester(address qc, address attester) internal {
        address[] storage attesters = pendingAttesters[qc];
        
        // Check if attester is already tracked
        for (uint256 i = 0; i < attesters.length; i++) {
            if (attesters[i] == attester) {
                return; // Already tracked
            }
        }
        
        // Add new attester
        attesters.push(attester);
    }
    
    /// @dev Clear all pending attestations for a QC
    function _clearPendingAttestations(address qc) internal {
        address[] storage attesters = pendingAttesters[qc];
        
        // Delete all pending attestations
        for (uint256 i = 0; i < attesters.length; i++) {
            delete pendingAttestations[qc][attesters[i]];
        }
        
        // Clear the attesters array
        delete pendingAttesters[qc];
    }
    
}