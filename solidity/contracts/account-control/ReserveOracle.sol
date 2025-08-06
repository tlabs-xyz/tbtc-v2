// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IQCReserveLedger.sol";

/// @title ReserveOracle
/// @notice Multi-attester oracle for Bitcoin reserve balance consensus
/// @dev Receives attestations from multiple sources and calculates median consensus
contract ReserveOracle is AccessControl {
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    
    /// @notice Attestation data from a single attester
    struct Attestation {
        uint256 balance;        // Attested balance in satoshis
        uint256 timestamp;      // When submitted
    }
    
    /// @notice Consensus configuration
    uint256 public constant MIN_ATTESTERS = 3;              // Minimum attesters for consensus
    uint256 public constant CONSENSUS_WINDOW = 6 hours;     // Attestations must be within this window
    uint256 public constant MAX_DEVIATION_PERCENT = 5;      // Max 5% deviation from median
    
    /// @notice Reserve ledger to push consensus values
    IQCReserveLedger public immutable reserveLedger;
    
    /// @notice Temporary storage for attestations (qc => attester => attestation)
    mapping(address => mapping(address => Attestation)) public attestations;
    
    /// @notice Track attesters for each QC
    mapping(address => address[]) public attestersForQC;
    mapping(address => mapping(address => bool)) public hasAttested;
    
    /// @notice Track last consensus time to prevent spam
    mapping(address => uint256) public lastConsensusTime;
    uint256 public constant MIN_CONSENSUS_INTERVAL = 1 hours;
    
    // Events
    event AttestationSubmitted(
        address indexed qc,
        address indexed attester,
        uint256 balance,
        uint256 timestamp
    );
    
    event ConsensusAchieved(
        address indexed qc,
        uint256 consensusBalance,
        uint256 attesterCount,
        uint256 timestamp
    );
    
    event ConsensusRejected(
        address indexed qc,
        string reason
    );
    
    // Custom errors
    error InvalidQCAddress();
    error InvalidBalance();
    error TooSoonForConsensus();
    error InsufficientAttesters();
    error ExcessiveDeviation();
    
    constructor(address _reserveLedger) {
        if (_reserveLedger == address(0)) revert InvalidQCAddress();
        
        reserveLedger = IQCReserveLedger(_reserveLedger);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
    }
    
    /// @notice Submit a reserve balance attestation
    /// @param qc The Qualified Custodian address
    /// @param balance The attested reserve balance in satoshis
    function submitAttestation(address qc, uint256 balance) external onlyRole(ATTESTER_ROLE) {
        if (qc == address(0)) revert InvalidQCAddress();
        if (balance == 0) revert InvalidBalance();
        
        // Store attestation
        attestations[qc][msg.sender] = Attestation({
            balance: balance,
            timestamp: block.timestamp
        });
        
        // Track attester
        if (!hasAttested[qc][msg.sender]) {
            attestersForQC[qc].push(msg.sender);
            hasAttested[qc][msg.sender] = true;
        }
        
        emit AttestationSubmitted(qc, msg.sender, balance, block.timestamp);
        
        // Try to achieve consensus
        _checkConsensus(qc);
    }
    
    /// @notice Force consensus check for a QC
    /// @param qc The Qualified Custodian address
    function forceConsensusCheck(address qc) external onlyRole(MANAGER_ROLE) {
        _checkConsensus(qc);
    }
    
    /// @notice Check if consensus can be achieved and push to ledger
    function _checkConsensus(address qc) internal {
        // Rate limit consensus attempts
        if (block.timestamp < lastConsensusTime[qc] + MIN_CONSENSUS_INTERVAL) {
            revert TooSoonForConsensus();
        }
        
        // Get recent attestations
        (uint256[] memory validBalances, uint256 validCount) = _getRecentAttestations(qc);
        
        if (validCount < MIN_ATTESTERS) {
            emit ConsensusRejected(qc, "Insufficient attesters");
            return;
        }
        
        // Calculate median
        uint256 medianBalance = _calculateMedian(validBalances, validCount);
        
        // Check deviation
        if (!_checkDeviation(validBalances, validCount, medianBalance)) {
            emit ConsensusRejected(qc, "Excessive deviation");
            return;
        }
        
        // Push to ledger
        lastConsensusTime[qc] = block.timestamp;
        reserveLedger.recordConsensusAttestation(qc, medianBalance, validCount);
        
        emit ConsensusAchieved(qc, medianBalance, validCount, block.timestamp);
        
        // Clear old attestations
        _clearAttestations(qc);
    }
    
    /// @notice Get recent valid attestations
    function _getRecentAttestations(address qc) internal view returns (uint256[] memory balances, uint256 count) {
        address[] memory attesters = attestersForQC[qc];
        balances = new uint256[](attesters.length);
        
        uint256 cutoffTime = block.timestamp - CONSENSUS_WINDOW;
        
        for (uint256 i = 0; i < attesters.length; i++) {
            Attestation memory att = attestations[qc][attesters[i]];
            
            // Only include recent attestations
            if (att.timestamp > cutoffTime && att.balance > 0) {
                balances[count] = att.balance;
                count++;
            }
        }
    }
    
    /// @notice Calculate median of array (must be non-empty)
    function _calculateMedian(uint256[] memory values, uint256 length) internal pure returns (uint256) {
        // Sort array (bubble sort for simplicity, gas not critical here)
        for (uint256 i = 0; i < length - 1; i++) {
            for (uint256 j = 0; j < length - i - 1; j++) {
                if (values[j] > values[j + 1]) {
                    uint256 temp = values[j];
                    values[j] = values[j + 1];
                    values[j + 1] = temp;
                }
            }
        }
        
        // Return median
        if (length % 2 == 0) {
            return (values[length / 2 - 1] + values[length / 2]) / 2;
        } else {
            return values[length / 2];
        }
    }
    
    /// @notice Check if attestations are within acceptable deviation
    function _checkDeviation(
        uint256[] memory values,
        uint256 length,
        uint256 median
    ) internal pure returns (bool) {
        for (uint256 i = 0; i < length; i++) {
            uint256 deviation;
            
            if (values[i] > median) {
                deviation = ((values[i] - median) * 100) / median;
            } else {
                deviation = ((median - values[i]) * 100) / median;
            }
            
            if (deviation > MAX_DEVIATION_PERCENT) {
                return false;
            }
        }
        
        return true;
    }
    
    /// @notice Clear attestations after consensus
    function _clearAttestations(address qc) internal {
        address[] memory attesters = attestersForQC[qc];
        
        for (uint256 i = 0; i < attesters.length; i++) {
            delete attestations[qc][attesters[i]];
            delete hasAttested[qc][attesters[i]];
        }
        
        delete attestersForQC[qc];
    }
    
    /// @notice Get current attestations for a QC
    /// @param qc The Qualified Custodian address
    /// @return currentAttestations Array of current attestations
    function getAttestations(address qc) external view returns (
        address[] memory attesters,
        uint256[] memory balances,
        uint256[] memory timestamps
    ) {
        attesters = attestersForQC[qc];
        balances = new uint256[](attesters.length);
        timestamps = new uint256[](attesters.length);
        
        for (uint256 i = 0; i < attesters.length; i++) {
            Attestation memory att = attestations[qc][attesters[i]];
            balances[i] = att.balance;
            timestamps[i] = att.timestamp;
        }
    }
    
    /// @notice Check if enough attestations for consensus
    /// @param qc The Qualified Custodian address
    /// @return ready True if ready for consensus
    /// @return currentCount Number of valid attestations
    function isReadyForConsensus(address qc) external view returns (bool ready, uint256 currentCount) {
        (, currentCount) = _getRecentAttestations(qc);
        ready = currentCount >= MIN_ATTESTERS;
    }
}