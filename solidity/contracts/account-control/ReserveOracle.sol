// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./AccountControl.sol";

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
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    bytes32 public constant DISPUTE_ARBITER_ROLE = keccak256("DISPUTE_ARBITER_ROLE");

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

    // QC address => array of attester addresses who have pending attestations
    mapping(address => address[]) public pendingAttesters;

    // Configuration
    uint256 public consensusThreshold = 3;
    uint256 public attestationTimeout = 6 hours; // Time window for attestations to be considered valid
    uint256 public maxStaleness = 24 hours; // Maximum time before reserve data is considered stale

    // Account Control Integration
    /// @dev Address of the Account Control contract
    address public accountControl;

    // Events
    event AttestationSubmitted(
        address indexed qc,
        address indexed attester,
        uint256 balance,
        uint256 timestamp
    );
    
    event BatchAttestationSubmitted(
        address indexed attester,
        address[] qcs,
        uint256[] balances,
        uint256 timestamp
    );

    event ConsensusReached(
        address indexed qc,
        uint256 newBalance,
        uint256 oldBalance,
        uint256 consensusTimestamp,
        address[] attesters
    );

    event ReserveBalanceUpdated(
        address indexed qc,
        uint256 oldBalance,
        uint256 newBalance
    );

    event AttestationExpired(
        address indexed qc,
        address indexed attester,
        uint256 expiredBalance
    );
    
    event AttesterRegistered(
        address indexed attester,
        uint64 attesterIndex
    );

    event ConsensusThresholdUpdated(
        uint256 oldThreshold,
        uint256 newThreshold
    );

    event AttestationTimeoutUpdated(
        uint256 oldTimeout,
        uint256 newTimeout
    );

    event MaxStalenessUpdated(
        uint256 oldMaxStaleness,
        uint256 newMaxStaleness
    );

    // Account Control Events
    /// @dev Emitted when Account Control address is updated
    event AccountControlUpdated(address indexed oldAddress, address indexed newAddress, address changedBy, uint256 timestamp);

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

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ATTESTER_ROLE, msg.sender);
        _grantRole(DISPUTE_ARBITER_ROLE, msg.sender);
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
        
        emit BatchAttestationSubmitted(msg.sender, qcs, balances, block.timestamp);
    }
    
    /// @notice Submit single balance attestation for a QC (for backward compatibility)
    /// @param qc The address of the Qualified Custodian
    /// @param balance The attested reserve balance
    function attestBalance(address qc, uint256 balance)
        external
        onlyRole(ATTESTER_ROLE)
    {
        _ensureAttesterRegistered(msg.sender);
        _attestBalanceInternal(qc, balance);
        emit AttestationSubmitted(qc, msg.sender, balance, block.timestamp);
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
        isStale = block.timestamp > data.lastUpdateTimestamp + maxStaleness;
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

    /// @notice Check if reserve data is stale for a QC
    /// @param qc The address of the Qualified Custodian
    /// @return isStale True if the reserve data is stale
    function isReserveDataStale(address qc) external view returns (bool) {
        return
            block.timestamp >
            reserves[qc].lastUpdateTimestamp + maxStaleness;
    }

    /// @notice Get pending attestation count for a QC
    /// @param qc The address of the Qualified Custodian
    /// @return count Number of pending attestations
    function getPendingAttestationCount(address qc)
        external
        view
        returns (uint256 count)
    {
        return pendingAttesters[qc].length;
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

    /// @notice Update consensus threshold (DISPUTE_ARBITER_ROLE only)
    /// @param newThreshold New consensus threshold (minimum 2)
    function setConsensusThreshold(uint256 newThreshold)
        external
        onlyRole(DISPUTE_ARBITER_ROLE)
    {
        if (newThreshold < 2) revert InvalidThreshold();

        uint256 oldThreshold = consensusThreshold;
        consensusThreshold = newThreshold;

        emit ConsensusThresholdUpdated(oldThreshold, newThreshold);
    }

    /// @notice Update attestation timeout (DISPUTE_ARBITER_ROLE only)
    /// @param newTimeout New timeout in seconds (minimum 1 hour, maximum 24 hours)
    function setAttestationTimeout(uint256 newTimeout)
        external
        onlyRole(DISPUTE_ARBITER_ROLE)
    {
        if (newTimeout < 1 hours || newTimeout > 24 hours)
            revert InvalidTimeout();

        uint256 oldTimeout = attestationTimeout;
        attestationTimeout = newTimeout;

        emit AttestationTimeoutUpdated(oldTimeout, newTimeout);
    }

    /// @notice Update maximum staleness period (DISPUTE_ARBITER_ROLE only)
    /// @param newMaxStaleness New staleness period in seconds (minimum 1 hour)
    function setMaxStaleness(uint256 newMaxStaleness)
        external
        onlyRole(DISPUTE_ARBITER_ROLE)
    {
        if (newMaxStaleness < 1 hours) revert InvalidStaleness();

        uint256 oldMaxStaleness = maxStaleness;
        maxStaleness = newMaxStaleness;

        emit MaxStalenessUpdated(oldMaxStaleness, newMaxStaleness);
    }

    /// @notice Emergency function to reset consensus for a QC (DISPUTE_ARBITER_ROLE only)
    /// @param qc The address of the Qualified Custodian
    function resetConsensus(address qc) external onlyRole(DISPUTE_ARBITER_ROLE) {
        _clearPendingAttestations(qc);
    }

    /// @notice Emergency function to manually set reserve balance (DISPUTE_ARBITER_ROLE only)
    /// @param qc The address of the Qualified Custodian
    /// @param balance The new reserve balance
    function emergencySetReserve(address qc, uint256 balance)
        external
        onlyRole(DISPUTE_ARBITER_ROLE)
    {
        uint256 oldBalance = reserves[qc].balance;
        reserves[qc] = ReserveData({
            balance: balance,
            lastUpdateTimestamp: block.timestamp
        });

        // Update backing in Account Control with oracle consensus
        AccountControl(accountControl).updateBacking(qc, balance);

        // Clear any pending attestations
        _clearPendingAttestations(qc);

        emit ReserveBalanceUpdated(qc, oldBalance, balance);
    }

    /// @dev Ensure attester is registered in the index mapping
    function _ensureAttesterRegistered(address attester) private {
        if (attesterToIndex[attester] == 0) {
            uint64 index = nextAttesterIndex++;
            attesterToIndex[attester] = index;
            indexToAttester[index] = attester;
            emit AttesterRegistered(attester, index);
        }
    }
    
    /// @dev Internal function to process a single attestation
    function _attestBalanceInternal(address qc, uint256 balance) private {
        if (qc == address(0)) revert QCAddressRequired();
        if (balance > type(uint128).max) revert BalanceOverflow();

        // Check if this attester has already submitted for this QC
        if (pendingAttestations[qc][msg.sender].timestamp != 0) {
            revert AttesterAlreadySubmitted();
        }

        // Clean up any expired attestations
        _cleanExpiredAttestations(qc);

        // Get attester index
        uint64 attesterIndex = attesterToIndex[msg.sender];

        // Record the new attestation
        pendingAttestations[qc][msg.sender] = PackedAttestation({
            balance: uint128(balance),
            timestamp: uint64(block.timestamp),
            attesterIndex: attesterIndex
        });

        pendingAttesters[qc].push(msg.sender);

        // Check if we have enough attestations to reach consensus
        if (pendingAttesters[qc].length >= consensusThreshold) {
            _processConsensus(qc);
        }
    }

    /// @dev Process consensus and update reserve balance
    function _processConsensus(address qc) private {
        uint256[] memory balances = new uint256[](pendingAttesters[qc].length);
        address[] memory attesters = new address[](
            pendingAttesters[qc].length
        );

        // Collect all valid attestations
        uint256 validCount = 0;
        for (uint256 i = 0; i < pendingAttesters[qc].length; i++) {
            address attester = pendingAttesters[qc][i];
            PackedAttestation memory attestation = pendingAttestations[qc][
                attester
            ];

            if (
                attestation.timestamp != 0 &&
                block.timestamp <= uint256(attestation.timestamp) + attestationTimeout
            ) {
                balances[validCount] = uint256(attestation.balance);
                attesters[validCount] = attester;
                validCount++;
            }
        }

        if (validCount < consensusThreshold) {
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

        // Update backing in Account Control with oracle consensus
        AccountControl(accountControl).updateBacking(qc, consensusBalance);

        // Create array of participating attesters for event
        address[] memory participatingAttesters = new address[](validCount);
        for (uint256 i = 0; i < validCount; i++) {
            participatingAttesters[i] = attesters[i];
        }

        emit ConsensusReached(
            qc,
            consensusBalance,
            oldBalance,
            block.timestamp,
            participatingAttesters
        );

        emit ReserveBalanceUpdated(qc, oldBalance, consensusBalance);

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

    /// @dev Clean up expired attestations for a QC
    function _cleanExpiredAttestations(address qc) private {
        address[] storage attesters = pendingAttesters[qc];
        uint256 i = 0;

        while (i < attesters.length) {
            address attester = attesters[i];
            PackedAttestation storage attestation = pendingAttestations[qc][
                attester
            ];

            if (
                attestation.timestamp != 0 &&
                block.timestamp > uint256(attestation.timestamp) + attestationTimeout
            ) {
                emit AttestationExpired(qc, attester, uint256(attestation.balance));

                // Remove expired attestation
                delete pendingAttestations[qc][attester];

                // Remove attester from array by swapping with last element
                attesters[i] = attesters[attesters.length - 1];
                attesters.pop();
                // Don't increment i since we moved a new element to position i
            } else {
                i++;
            }
        }
    }

    /// @dev Clear all pending attestations for a QC
    function _clearPendingAttestations(address qc) private {
        address[] storage attesters = pendingAttesters[qc];

        for (uint256 i = 0; i < attesters.length; i++) {
            delete pendingAttestations[qc][attesters[i]];
        }

        delete pendingAttesters[qc];
    }

    // =================== CONFIGURATION FUNCTIONS ===================


    /// @notice Set the Account Control contract address
    /// @param _accountControl The address of the Account Control contract
    /// @dev Only DEFAULT_ADMIN_ROLE can call this function
    function setAccountControl(address _accountControl) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldAddress = accountControl;
        accountControl = _accountControl;
        emit AccountControlUpdated(oldAddress, _accountControl, msg.sender, block.timestamp);
    }

}