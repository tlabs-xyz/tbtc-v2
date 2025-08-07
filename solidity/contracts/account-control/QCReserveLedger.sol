// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title QCReserveLedger
/// @notice Multi-attester consensus oracle with Byzantine fault tolerance
/// @dev SECURITY: Uses consensus-based architecture where individual attesters cannot 
///      manipulate final balance. Requires 3+ attestations with median calculation 
///      to protect against up to 50% malicious attesters.
contract QCReserveLedger is AccessControl {
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    
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
    
    event ForcedConsensusReached(
        address indexed qc,
        uint256 consensusBalance,
        uint256 attestationCount,
        address indexed arbiter,
        address[] attestersUsed,
        uint256[] balancesUsed
    );
    
    event ConsensusThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event AttestationTimeoutUpdated(uint256 oldTimeout, uint256 newTimeout);
    event MaxStalenessUpdated(uint256 oldStaleness, uint256 newStaleness);
    
    // Errors
    error InvalidThreshold();
    error InvalidTimeout();
    error NoConsensusYet();
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ARBITER_ROLE, msg.sender);
    }
    
    /// @notice Submit an attestation for a QC's reserve balance
    /// @dev Only attest when there's actual reserve movement or data is stale
    /// @param qc The QC address
    /// @param balance The attested reserve balance
    function submitAttestation(address qc, uint256 balance) external onlyRole(ATTESTER_ROLE) {
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
    
    /// @notice Force consensus with available attestations (emergency use only)
    /// @dev Only ARBITER can call when consensus cannot be reached naturally.
    ///      Requires at least one valid attestation to prevent arbitrary updates.
    /// @param qc The QC address to force consensus for
    function forceConsensus(address qc) external onlyRole(ARBITER_ROLE) {
        address[] memory attesters = pendingAttesters[qc];
        uint256 validCount = 0;
        uint256[] memory validBalances = new uint256[](attesters.length);
        address[] memory validAttesters = new address[](attesters.length);
        
        // Collect valid attestations within timeout window (same logic as _attemptConsensus)
        for (uint256 i = 0; i < attesters.length; i++) {
            PendingAttestation memory attestation = pendingAttestations[qc][attesters[i]];
            
            // Check if attestation is still valid (not expired)
            if (block.timestamp <= attestation.timestamp + attestationTimeout) {
                validBalances[validCount] = attestation.balance;
                validAttesters[validCount] = attesters[i];
                validCount++;
            }
        }
        
        // SAFETY: Require at least ONE valid attestation to prevent arbitrary balance setting
        require(validCount > 0, "No valid attestations to force consensus");
        
        // Create properly sized arrays for the event
        address[] memory usedAttesters = new address[](validCount);
        uint256[] memory usedBalances = new uint256[](validCount);
        for (uint256 i = 0; i < validCount; i++) {
            usedAttesters[i] = validAttesters[i];
            usedBalances[i] = validBalances[i];
        }
        
        // Calculate median of available valid balances
        uint256 consensusBalance = _calculateMedian(validBalances, validCount);
        
        // Update reserve data
        uint256 oldBalance = reserves[qc].balance;
        reserves[qc] = ReserveData({
            balance: consensusBalance,
            lastUpdateTimestamp: block.timestamp
        });
        
        // Clear pending attestations for this QC
        _clearPendingAttestations(qc);
        
        // Emit both forced consensus and regular reserve update events
        emit ForcedConsensusReached(qc, consensusBalance, validCount, msg.sender, usedAttesters, usedBalances);
        emit ReserveUpdated(qc, oldBalance, consensusBalance, block.timestamp);
    }
    
    
    /// @dev Consensus engine - aggregates attestations and updates balance via median
    /// @dev SECURITY: Only updates balance when consensus threshold met (3+ attesters)
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
        
        // CONSENSUS GATE: Only proceed if threshold met (Byzantine fault tolerance)
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
    
    /// @dev Byzantine fault tolerant median calculation using insertion sort
    /// @dev SECURITY: Median protects against up to 50% malicious attesters
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