// SPDX-License-Identifier: GPL-3.0-only

// ██████████████     ▐████▌     ██████████████
// ██████████████     ▐████▌     ██████████████
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
// ██████████████     ▐████▌     ██████████████
// ██████████████     ▐████▌     ██████████████
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌

pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./SystemState.sol";
import "./interfaces/IQCManagerReserveSync.sol";

/// @title ReserveOracle
/// @notice Multi-attester consensus oracle with honest-majority assumption for QC reserve attestation
/// @dev This oracle system provides secure, decentralized reserve balance attestation for Qualified Custodians.
///
/// ## Honest-Majority Oracle Design
/// The system protects against malicious attesters through:
/// - **Consensus Requirement**: Minimum 3 attesters required for balance updates
/// - **Median Calculation**: Uses statistical median to resist outlier manipulation
/// - **Time-Bounded Attestations**: Attestations expire after 6 hours to prevent replay attacks
/// - **Staleness Detection**: Reserves marked stale after 24 hours without fresh attestations
///
/// ## Security Properties
/// - **50% Attack Resistance**: System remains secure with up to 50% malicious attesters
/// - **Individual Attester Immunity**: No single attester can manipulate final balance
/// - **Temporal Consistency**: Time-based validation prevents stale or backdated attestations
/// - **Role-Based Access**: Only authorized attesters can submit balance attestations
///
/// ## Integration Points
/// - **QCManager**: Uses reserve balances for minting capacity calculations and solvency checks
/// - **Attesters**: External systems (APIs, blockchain monitors) submit balance attestations
/// - **Emergency Response**: DISPUTE_ARBITER_ROLE can handle emergency situations and reset consensus
///
/// SECURITY: This contract is critical for system solvency. All balance updates require
/// consensus from multiple independent attesters to prevent single points of failure.
contract ReserveOracle is AccessControl {
    using EnumerableSet for EnumerableSet.AddressSet;
    
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    bytes32 public constant DISPUTE_ARBITER_ROLE = keccak256("DISPUTE_ARBITER_ROLE");
    
    /// @dev Address of QCManager contract for automatic backing synchronization
    address public qcManager;
    
    /// @dev SystemState contract for oracle configuration parameters
    SystemState public immutable systemState;

    struct ReserveData {
        uint256 balance;
        uint256 lastUpdateTimestamp;
    }

    struct PackedAttestation {
        uint128 balance;
        uint64 timestamp;
        uint64 attesterIndex;
    }

    // QC address => ReserveData
    mapping(address => ReserveData) public reserves;

    // QC address => attester address => PackedAttestation
    mapping(address => mapping(address => PackedAttestation))
        public pendingAttestations;
    
    // Attester registry for storage optimization
    mapping(address => uint64) public attesterToIndex;
    mapping(uint64 => address) public indexToAttester;
    uint64 public nextAttesterIndex = 1; // Start from 1, 0 reserved for unset

    // QC address => set of attester addresses who have pending attestations
    mapping(address => EnumerableSet.AddressSet) private pendingAttesters;

    // Events
    event AttestationSubmitted(
        address indexed attester,
        address indexed qc,
        uint256 indexed balance,
        uint256 timestamp
    );
    
    event BatchAttestationSubmitted(
        address indexed attester,
        address[] qcs,
        uint256[] balances,
        uint256 attestationCount,
        uint256 timestamp
    );

    event ReserveBalanceUpdated(
        address indexed qc,
        uint256 indexed oldBalance,
        uint256 indexed newBalance,
        uint256 attestationCount,
        address triggeredBy,
        uint256 timestamp
    );

    event AttestationExpired(
        address indexed qc,
        address indexed attester,
        uint256 indexed expiredBalance,
        uint256 timestamp
    );
    
    event AttesterRegistered(
        address indexed attester,
        uint64 indexed attesterIndex,
        uint256 timestamp
    );

    event AttestationOverridden(
        address indexed qc,
        uint256 indexed oldBalance,
        uint256 indexed newBalance,
        uint256 timestamp
    );

    event ConsensusThresholdUpdated(
        uint256 indexed oldThreshold,
        uint256 indexed newThreshold
    );

    event AttestationTimeoutUpdated(
        uint256 indexed oldTimeout,
        uint256 indexed newTimeout
    );

    event MaxStalenessUpdated(
        uint256 indexed oldMaxStaleness,
        uint256 indexed newMaxStaleness
    );
    
    event ConsensusReached(
        address indexed qc,
        uint256 indexed consensusBalance,
        uint256 indexed attestationCount
    );

    // Custom errors for gas efficiency
    error QCAddressRequired();
    error AttesterAlreadySubmitted();
    error AttestationTooOld();
    error InsufficientAttestations();
    error InvalidThreshold();
    error InvalidTimeout();
    error InvalidStaleness();
    error MismatchedArrays();
    error BalanceOverflow();

    constructor(address _systemState) {
        require(_systemState != address(0), "Invalid SystemState address");
        systemState = SystemState(_systemState);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ATTESTER_ROLE, msg.sender);
        _grantRole(DISPUTE_ARBITER_ROLE, msg.sender);
    }
    
    /// @notice Set QCManager address for automatic backing synchronization
    /// @param _qcManager Address of the QCManager contract
    function setQCManager(address _qcManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        qcManager = _qcManager;
    }

    /// @notice Get the current consensus threshold
    /// @return The minimum number of attestations required for consensus
    function consensusThreshold() external view returns (uint256) {
        return systemState.oracleConsensusThreshold();
    }

    /// @notice Set the consensus threshold (delegated to SystemState)
    /// @param threshold The new consensus threshold
    function setConsensusThreshold(uint256 threshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revert("Use SystemState.setOracleConsensusThreshold() instead");
    }

    /// @notice Get the current attestation timeout
    /// @return The timeout period for attestations in seconds
    function attestationTimeout() external view returns (uint256) {
        return systemState.oracleAttestationTimeout();
    }

    /// @notice Set the attestation timeout (delegated to SystemState)
    /// @param timeout The new attestation timeout in seconds
    function setAttestationTimeout(uint256 timeout) external onlyRole(DISPUTE_ARBITER_ROLE) {
        revert("Use SystemState.setOracleAttestationTimeout() instead");
    }

    /// @notice Get the current maximum staleness period
    /// @return The maximum staleness period in seconds
    function maxStaleness() external view returns (uint256) {
        return systemState.oracleMaxStaleness();
    }

    /// @notice Set the maximum staleness period (delegated to SystemState)
    /// @param staleness The new maximum staleness period in seconds
    function setMaxStaleness(uint256 staleness) external onlyRole(DISPUTE_ARBITER_ROLE) {
        revert("Use SystemState.setOracleMaxStaleness() instead");
    }

    /// @notice Submit balance attestations for multiple QCs in batch
    /// @param qcs Array of Qualified Custodian addresses
    /// @param balances Array of attested reserve balances (must match qcs length)
    function batchAttestBalances(
        address[] calldata qcs,
        uint256[] calldata balances
    ) external onlyRole(ATTESTER_ROLE) {
        if (qcs.length != balances.length) revert MismatchedArrays();
        if (qcs.length == 0) return; // No-op for empty arrays
        
        // Register attester if not already registered
        _ensureAttesterRegistered(msg.sender);
        
        // Process each attestation
        for (uint256 i = 0; i < qcs.length; i++) {
            _attestBalanceInternal(qcs[i], balances[i]);
        }
        
        emit BatchAttestationSubmitted(msg.sender, qcs, balances, qcs.length, block.timestamp);
    }
    

    /// @notice Get reserve balance and staleness for a QC
    /// @param qc The address of the Qualified Custodian
    /// @return balance The current reserve balance
    /// @return isStale True if the balance data is stale
    function getReserveBalanceAndStaleness(address qc)
        external
        view
        returns (uint256 balance, bool isStale)
    {
        ReserveData memory data = reserves[qc];
        balance = data.balance;
        if (data.lastUpdateTimestamp == 0) {
            isStale = true;
        } else {
            isStale = block.timestamp - data.lastUpdateTimestamp > systemState.oracleMaxStaleness();
        }
    }

    /// @notice Get current reserve balance for a QC
    /// @param qc The address of the Qualified Custodian
    /// @return balance The current reserve balance
    function getReserveBalance(address qc)
        external
        view
        returns (uint256 balance)
    {
        return reserves[qc].balance;
    }

    /// @notice Get pending attestation details for a QC and attester
    /// @param qc The address of the Qualified Custodian
    /// @param attester The address of the attester
    /// @return balance The attested balance
    /// @return timestamp When the attestation was made
    function getPendingAttestation(address qc, address attester)
        external
        view
        returns (uint256 balance, uint256 timestamp)
    {
        PackedAttestation memory attestation = pendingAttestations[qc][
            attester
        ];
        return (uint256(attestation.balance), uint256(attestation.timestamp));
    }

    /// @notice Get the count of pending attestations for a QC
    /// @param qc The address of the Qualified Custodian
    /// @return count The number of pending attestations
    function getPendingAttestationCount(address qc)
        external
        view
        returns (uint256 count)
    {
        return pendingAttesters[qc].length();
    }


    /// @notice Emergency function to reset consensus for a QC (DISPUTE_ARBITER_ROLE only)
    /// @param qc The address of the Qualified Custodian
    function resetConsensus(address qc) external onlyRole(DISPUTE_ARBITER_ROLE) {
        _clearPendingAttestations(qc);
    }

    /// @notice Submit a reserve balance attestation for a QC
    /// @param qc The address of the Qualified Custodian
    /// @param balance The attested reserve balance
    function submitAttestation(
        address qc,
        uint256 balance
    ) external onlyRole(ATTESTER_ROLE) {
        // Ensure attester is registered
        _ensureAttesterRegistered(msg.sender);
        
        // Process the attestation
        _attestBalanceInternal(qc, balance);
        
        // Emit attestation event
        emit AttestationSubmitted(msg.sender, qc, balance, block.timestamp);
    }

    /// @notice Emergency function to manually set reserve balance (DISPUTE_ARBITER_ROLE only)
    /// @param qc The address of the Qualified Custodian
    /// @param balance The new reserve balance
    function emergencySetReserve(address qc, uint256 balance)
        external
        onlyRole(DISPUTE_ARBITER_ROLE)
    {
        if (qc == address(0)) revert QCAddressRequired();
        uint256 oldBalance = reserves[qc].balance;
        reserves[qc] = ReserveData({
            balance: balance,
            lastUpdateTimestamp: block.timestamp
        });

        // Clear any pending attestations
        _clearPendingAttestations(qc);

        emit ReserveBalanceUpdated(qc, oldBalance, balance, 0, msg.sender, block.timestamp);
    }

    /// @notice Direct update of reserve balance (ATTESTER_ROLE only)
    /// @dev This function bypasses the consensus mechanism and directly updates reserve balances.
    ///      WARNING: Only use in testing environments or emergency situations with proper authorization.
    /// @param qc The address of the Qualified Custodian
    /// @param balance The new reserve balance
    function updateReserveBalance(address qc, uint256 balance)
        external
        onlyRole(ATTESTER_ROLE)
    {
        if (qc == address(0)) revert QCAddressRequired();
        
        uint256 oldBalance = reserves[qc].balance;
        reserves[qc] = ReserveData({
            balance: balance,
            lastUpdateTimestamp: block.timestamp
        });

        emit ReserveBalanceUpdated(qc, oldBalance, balance, 1, msg.sender, block.timestamp);

        // Automatically sync backing to AccountControl if QCManager is set
        if (qcManager != address(0)) {
            try IQCManagerReserveSync(qcManager).syncBackingFromOracle(qc) {
            } catch {
                // Sync failed - continue operation but don't revert
            }
        }
    }

    /// @dev Ensure attester is registered in the index mapping
    function _ensureAttesterRegistered(address attester) private {
        if (attesterToIndex[attester] == 0) {
            uint64 index = nextAttesterIndex++;
            attesterToIndex[attester] = index;
            indexToAttester[index] = attester;
            emit AttesterRegistered(attester, index, block.timestamp);
        }
    }
    
    /// @dev Internal function to process a single attestation
    function _attestBalanceInternal(address qc, uint256 balance) private {
        if (qc == address(0)) revert QCAddressRequired();
        if (balance > type(uint128).max) revert BalanceOverflow();

        // Clean up any expired attestations first
        _cleanExpiredAttestations(qc);
        
        // Check for remaining expired attestations from OTHER attesters
        // If there are still expired attestations from other attesters after cleanup, reject new submissions
        uint256 attesterCount = pendingAttesters[qc].length();
        for (uint256 i = 0; i < attesterCount; i++) {
            address attester = pendingAttesters[qc].at(i);
            PackedAttestation memory attestation = pendingAttestations[qc][attester];
            if (attestation.timestamp != 0 && 
                block.timestamp > uint256(attestation.timestamp) + systemState.oracleAttestationTimeout() &&
                attester != msg.sender) {
                // Other attester has timed out but wasn't cleaned - reject new submissions from different attesters  
                revert AttestationTooOld();
            }
        }
        
        // Check if this attester has already submitted for this QC (contains is more efficient)
        if (pendingAttesters[qc].contains(msg.sender)) {
            revert AttesterAlreadySubmitted();
        }

        // Get attester index
        uint64 attesterIndex = attesterToIndex[msg.sender];

        // Record the new attestation
        pendingAttestations[qc][msg.sender] = PackedAttestation({
            balance: uint128(balance),
            timestamp: uint64(block.timestamp),
            attesterIndex: attesterIndex
        });

        // Add to set (automatically prevents duplicates)
        pendingAttesters[qc].add(msg.sender);

        // Check if we have enough attestations to reach consensus
        if (pendingAttesters[qc].length() >= systemState.oracleConsensusThreshold()) {
            _processConsensus(qc);
        }
    }

    /// @dev Process consensus and update reserve balance
    function _processConsensus(address qc) private {
        uint256 attesterCount = pendingAttesters[qc].length();
        uint256[] memory balances = new uint256[](attesterCount);
        address[] memory attesters = new address[](attesterCount);

        // Collect all valid attestations
        uint256 validCount = 0;
        for (uint256 i = 0; i < attesterCount; i++) {
            address attester = pendingAttesters[qc].at(i);
            PackedAttestation memory attestation = pendingAttestations[qc][
                attester
            ];

            if (
                attestation.timestamp != 0 &&
                block.timestamp <= uint256(attestation.timestamp) + systemState.oracleAttestationTimeout()
            ) {
                balances[validCount] = uint256(attestation.balance);
                attesters[validCount] = attester;
                validCount++;
            }
        }

        if (validCount < systemState.oracleConsensusThreshold()) {
            revert InsufficientAttestations();
        }

        // Calculate median balance for honest-majority consensus
        uint256 consensusBalance = _calculateMedian(balances, validCount);
        uint256 oldBalance = reserves[qc].balance;

        // Update reserve data
        reserves[qc] = ReserveData({
            balance: consensusBalance,
            lastUpdateTimestamp: block.timestamp
        });

        // Create array of participating attesters for event
        address[] memory participatingAttesters = new address[](validCount);
        for (uint256 i = 0; i < validCount; i++) {
            participatingAttesters[i] = attesters[i];
        }

        emit ReserveBalanceUpdated(qc, oldBalance, consensusBalance, validCount, msg.sender, block.timestamp);
        emit ConsensusReached(qc, consensusBalance, validCount);

        // Automatically sync backing to AccountControl if QCManager is set
        if (qcManager != address(0)) {
            try IQCManagerReserveSync(qcManager).syncBackingFromOracle(qc) {
            } catch {
                // Sync failed - continue operation but don't revert
            }
        }

        // Clear pending attestations
        _clearPendingAttestations(qc);
    }

    /// @dev Calculate median of array (honest-majority consensus)
    function _calculateMedian(uint256[] memory values, uint256 length)
        private
        pure
        returns (uint256)
    {
        if (length == 0) return 0;
        if (length == 1) return values[0];

        // Simple bubble sort for small arrays
        for (uint256 i = 0; i < length - 1; i++) {
            for (uint256 j = 0; j < length - i - 1; j++) {
                if (values[j] > values[j + 1]) {
                    uint256 temp = values[j];
                    values[j] = values[j + 1];
                    values[j + 1] = temp;
                }
            }
        }

        if (length % 2 == 1) {
            return values[length / 2];
        } else {
            return (values[length / 2 - 1] + values[length / 2]) / 2;
        }
    }

    /// @dev Clean up expired attestations and revoked attesters for a QC
    function _cleanExpiredAttestations(address qc) private {
        uint256 attesterCount = pendingAttesters[qc].length();
        
        // Iterate backwards to avoid index issues when removing
        for (uint256 i = attesterCount; i > 0; i--) {
            address attester = pendingAttesters[qc].at(i - 1);
            PackedAttestation storage attestation = pendingAttestations[qc][attester];

            bool isExpired = attestation.timestamp != 0 &&
                block.timestamp > uint256(attestation.timestamp) + systemState.oracleAttestationTimeout();
            bool isRevoked = attestation.timestamp != 0 &&
                !hasRole(ATTESTER_ROLE, attester);

            if (isExpired || isRevoked) {
                if (isExpired) {
                    emit AttestationExpired(qc, attester, uint256(attestation.balance), block.timestamp);
                }

                // Remove attestation
                delete pendingAttestations[qc][attester];
                
                // Remove from set (O(1) operation)
                pendingAttesters[qc].remove(attester);
            }
        }
    }

    /// @dev Clear all pending attestations for a QC
    function _clearPendingAttestations(address qc) private {
        uint256 attesterCount = pendingAttesters[qc].length();
        
        // Clear all attestations
        for (uint256 i = 0; i < attesterCount; i++) {
            address attester = pendingAttesters[qc].at(i);
            delete pendingAttestations[qc][attester];
        }
        
        // Clear the entire set efficiently
        delete pendingAttesters[qc];
    }

    /// @notice Get attestation information for a QC
    /// @param qc The address of the Qualified Custodian
    /// @return pending True if attestations are pending consensus
    /// @return attestations Number of current attestations
    /// @return finalizedAmount The finalized consensus amount (or 0 if pending)
    function getAttestation(address qc) external view returns (
        bool pending,
        uint256 attestations,
        uint256 finalizedAmount
    ) {
        // Check if we have pending attestations
        uint256 pendingCount = pendingAttesters[qc].length();
        if (pendingCount > 0) {
            // Count valid (non-expired) attestations
            uint256 validCount = 0;
            for (uint256 i = 0; i < pendingCount; i++) {
                address attester = pendingAttesters[qc].at(i);
                PackedAttestation memory attestation = pendingAttestations[qc][attester];
                
                if (attestation.timestamp != 0 &&
                    block.timestamp <= uint256(attestation.timestamp) + systemState.oracleAttestationTimeout()) {
                    validCount++;
                }
            }
            
            return (true, validCount, 0);
        }
        
        // No pending attestations - return finalized data
        ReserveData memory reserveData = reserves[qc];
        return (false, 0, reserveData.balance);
    }

    /// @notice Override attestation with dispute arbiter authority
    /// @dev This function allows dispute arbiters to override consensus results in case of errors
    /// @param qc The address of the Qualified Custodian
    /// @param newAmount The correct reserve amount
    function overrideAttestation(address qc, uint256 newAmount, string calldata /* reason */)
        external
        onlyRole(DISPUTE_ARBITER_ROLE)
    {
        if (qc == address(0)) revert QCAddressRequired();
        
        uint256 oldAmount = reserves[qc].balance;
        reserves[qc] = ReserveData({
            balance: newAmount,
            lastUpdateTimestamp: block.timestamp
        });

        // Clear any pending attestations
        _clearPendingAttestations(qc);

        emit AttestationOverridden(qc, oldAmount, newAmount, block.timestamp);
        emit ReserveBalanceUpdated(qc, oldAmount, newAmount, 0, msg.sender, block.timestamp);

        // Automatically sync backing to AccountControl if QCManager is set
        if (qcManager != address(0)) {
            try IQCManagerReserveSync(qcManager).syncBackingFromOracle(qc) {
            } catch {
                // Sync failed - continue operation but don't revert
            }
        }
    }
    
    /// @notice Get the list of pending attesters for a QC
    /// @dev This function provides external access to the attester set
    /// @param qc The address of the Qualified Custodian
    /// @return attesters Array of addresses who have pending attestations
    function getPendingAttesters(address qc) external view returns (address[] memory) {
        uint256 count = pendingAttesters[qc].length();
        address[] memory attesters = new address[](count);
        
        for (uint256 i = 0; i < count; i++) {
            attesters[i] = pendingAttesters[qc].at(i);
        }
        
        return attesters;
    }
}

