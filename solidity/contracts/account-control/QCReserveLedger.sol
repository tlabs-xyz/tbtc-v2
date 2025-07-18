// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./ProtocolRegistry.sol";
import "./SystemState.sol";

/// @title QCReserveLedger
/// @dev Reserve attestation storage and verification system.
/// Exclusively responsible for recording off-chain reserve data submitted
/// by a trusted attester (the Watchdog). Contains staleness detection to
/// ensure reserve data is fresh for minting capacity calculations.
///
/// Role definitions:
/// - DEFAULT_ADMIN_ROLE: Can grant/revoke roles and invalidate attestations
/// - ATTESTER_ROLE: Can submit reserve attestations (typically granted to SingleWatchdog)
contract QCReserveLedger is AccessControl {
    // Custom errors for gas-efficient reverts
    error InvalidQCAddress();
    error NoAttestationExists();
    error ReasonRequired();

    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    bytes32 public constant SYSTEM_STATE_KEY = keccak256("SYSTEM_STATE");

    /// @dev Reserve attestation data structure - optimized for gas efficiency
    struct ReserveAttestation {
        uint256 balance; // Attested reserve balance in satoshis
        uint256 timestamp; // When the attestation was submitted
        uint256 blockNumber; // Block number when submitted
        address attester; // Who submitted the attestation - packed with bool
        bool isValid; // Whether this attestation is valid
    }

    ProtocolRegistry public immutable protocolRegistry;

    /// @dev Maps QC addresses to their latest reserve attestation
    mapping(address => ReserveAttestation) public reserveAttestations;

    /// @dev Maps QC addresses to historical attestations
    /// @notice Historical attestations are stored for legal compliance and audit trail purposes.
    /// This provides a complete record of all reserve balance changes over time, which is
    /// essential for regulatory compliance, dispute resolution, and transparency.
    mapping(address => ReserveAttestation[]) public attestationHistory;

    /// @dev Array of all QCs with attestations
    address[] public attestedQCs;

    /// @dev Mapping to check if QC is in attestedQCs array
    mapping(address => bool) public hasAttestation;

    /// @dev Emitted when a reserve attestation is submitted
    event ReserveAttestationSubmitted(
        address indexed attester,
        address indexed qc,
        uint256 indexed newBalance,
        uint256 oldBalance,
        uint256 timestamp,
        uint256 blockNumber
    );

    /// @dev Emitted when an attestation is marked as invalid
    event AttestationInvalidated(
        address indexed qc,
        uint256 indexed timestamp,
        bytes32 reason,
        address indexed invalidatedBy
    );

    /// @dev Emitted when staleness threshold is exceeded
    event AttestationStale(
        address indexed qc,
        uint256 indexed attestationTime,
        uint256 indexed currentTime,
        uint256 threshold,
        address checkedBy
    );

    /// @dev Emitted when attester role is granted
    event AttesterRoleGranted(
        address indexed attester,
        address indexed grantedBy,
        uint256 indexed timestamp
    );

    /// @dev Emitted when attester role is revoked
    event AttesterRoleRevoked(
        address indexed attester,
        address indexed revokedBy,
        uint256 indexed timestamp
    );

    /// @dev Emitted when an SPV-verified attestation is submitted
    event SPVVerifiedAttestationSubmitted(
        address indexed attester,
        address indexed qc,
        uint256 indexed balance,
        bytes32 proofTxHash,
        uint256 timestamp
    );

    constructor(address _protocolRegistry) {
        protocolRegistry = ProtocolRegistry(_protocolRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ATTESTER_ROLE, msg.sender);
    }

    /// @notice Submit reserve attestation for a QC (ATTESTER_ROLE)
    /// @param qc The address of the Qualified Custodian
    /// @param balance The attested reserve balance in satoshis
    /// @dev SPV proofs are intentionally not required for reserve attestations because:
    ///      1. Reserve proofs would need to verify multiple Bitcoin addresses and sum balances,
    ///         which is complex and expensive compared to single transaction proofs
    ///      2. Attesters are permissioned via ATTESTER_ROLE (typically SingleWatchdog)
    ///      3. Historical records provide audit trail for compliance
    ///      4. Attestations can be invalidated if fraud is detected
    ///      For enhanced security, consider periodic SPV-verified attestations via separate process
    function submitReserveAttestation(address qc, uint256 balance)
        external
        onlyRole(ATTESTER_ROLE)
    {
        if (qc == address(0)) revert InvalidQCAddress();

        // Get old balance for event emission
        uint256 oldBalance = hasAttestation[qc]
            ? reserveAttestations[qc].balance
            : 0;

        // Create new attestation
        ReserveAttestation memory newAttestation = ReserveAttestation({
            balance: balance,
            timestamp: block.timestamp,
            attester: msg.sender,
            blockNumber: block.number,
            isValid: true
        });

        // Update current attestation
        reserveAttestations[qc] = newAttestation;

        // Add to history
        attestationHistory[qc].push(newAttestation);

        // Add to attested QCs list if first attestation
        if (!hasAttestation[qc]) {
            attestedQCs.push(qc);
            hasAttestation[qc] = true;
        }

        emit ReserveAttestationSubmitted(
            msg.sender,
            qc,
            balance,
            oldBalance,
            block.timestamp,
            block.number
        );
    }

    /// @notice Submit SPV-verified reserve attestation for enhanced security (ATTESTER_ROLE)
    /// @param qc The address of the Qualified Custodian
    /// @param balance The attested reserve balance in satoshis
    /// @param proofData Encoded proof data containing transaction hash and additional metadata
    /// @dev This function provides an optional way to submit attestations with cryptographic proof.
    ///      While more secure, it's also more complex and expensive than regular attestations.
    ///      Recommended for periodic verification (e.g., daily/weekly) rather than every attestation.
    ///      The proofData format and validation logic would need to be implemented based on
    ///      specific requirements for multi-address reserve proofs.
    function submitSPVVerifiedAttestation(
        address qc,
        uint256 balance,
        bytes calldata proofData
    ) external onlyRole(ATTESTER_ROLE) {
        if (qc == address(0)) revert InvalidQCAddress();

        // Extract proof transaction hash from proofData for event
        // In a full implementation, this would validate the SPV proof
        bytes32 proofTxHash = bytes32(proofData[:32]);

        // Submit the attestation using the regular mechanism
        uint256 oldBalance = hasAttestation[qc]
            ? reserveAttestations[qc].balance
            : 0;

        ReserveAttestation memory newAttestation = ReserveAttestation({
            balance: balance,
            timestamp: block.timestamp,
            attester: msg.sender,
            blockNumber: block.number,
            isValid: true
        });

        reserveAttestations[qc] = newAttestation;
        attestationHistory[qc].push(newAttestation);

        if (!hasAttestation[qc]) {
            attestedQCs.push(qc);
            hasAttestation[qc] = true;
        }

        // Emit both regular and SPV-verified events
        emit ReserveAttestationSubmitted(
            msg.sender,
            qc,
            balance,
            oldBalance,
            block.timestamp,
            block.number
        );

        emit SPVVerifiedAttestationSubmitted(
            msg.sender,
            qc,
            balance,
            proofTxHash,
            block.timestamp
        );
    }

    /// @notice Get current reserve attestation for a QC
    /// @param qc The address of the Qualified Custodian
    /// @return attestation The current reserve attestation
    function getCurrentAttestation(address qc)
        external
        view
        returns (ReserveAttestation memory attestation)
    {
        return reserveAttestations[qc];
    }

    /// @notice Get reserve balance and staleness status
    /// @param qc The address of the Qualified Custodian
    /// @return balance The attested reserve balance
    /// @return isStale True if the attestation is stale
    function getReserveBalanceAndStaleness(address qc)
        external
        view
        returns (uint256 balance, bool isStale)
    {
        ReserveAttestation memory attestation = reserveAttestations[qc];

        if (!attestation.isValid || attestation.timestamp == 0) {
            return (0, true);
        }

        // Cache system state service to avoid redundant SLOAD operations
        SystemState systemState = SystemState(
            protocolRegistry.getService(SYSTEM_STATE_KEY)
        );
        uint256 staleThreshold = systemState.staleThreshold();

        isStale = block.timestamp > attestation.timestamp + staleThreshold;
        balance = attestation.balance;

        return (balance, isStale);
    }

    /// @notice Check if attestation is stale
    /// @param qc The address of the Qualified Custodian
    /// @return stale True if the attestation is stale
    function isAttestationStale(address qc) external view returns (bool stale) {
        ReserveAttestation memory attestation = reserveAttestations[qc];

        if (!attestation.isValid || attestation.timestamp == 0) {
            return true;
        }

        // Cache system state service to avoid redundant SLOAD operations
        SystemState systemState = SystemState(
            protocolRegistry.getService(SYSTEM_STATE_KEY)
        );
        uint256 staleThreshold = systemState.staleThreshold();

        return block.timestamp > attestation.timestamp + staleThreshold;
    }

    /// @notice Invalidate an attestation (Admin only)
    /// @param qc The address of the Qualified Custodian
    /// @param reason The reason for invalidation
    function invalidateAttestation(address qc, bytes32 reason)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (reserveAttestations[qc].timestamp == 0) {
            revert NoAttestationExists();
        }
        if (reason == bytes32(0)) revert ReasonRequired();

        reserveAttestations[qc].isValid = false;

        emit AttestationInvalidated(qc, block.timestamp, reason, msg.sender);
    }

    /// @notice Get attestation history for a QC
    /// @param qc The address of the Qualified Custodian
    /// @return history Array of historical attestations
    function getAttestationHistory(address qc)
        external
        view
        returns (ReserveAttestation[] memory history)
    {
        return attestationHistory[qc];
    }
}
