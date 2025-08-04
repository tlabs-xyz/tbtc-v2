// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.21;

/// @title IReserveLedger
/// @notice Interface for the reserve ledger tracking QC reserve balances
/// @dev This interface manages reserve attestations and staleness detection
interface IReserveLedger {
    /// @notice Structure for tracking reserve attestations
    struct ReserveAttestation {
        uint256 totalReserve;
        uint256 liquidReserve;
        uint256 timestamp;
        bytes32 attestationHash;
        string attestationURI;
    }

    /// @notice Emitted when a new reserve attestation is recorded
    event ReserveAttestationRecorded(
        address indexed qc,
        uint256 totalReserve,
        uint256 liquidReserve,
        uint256 timestamp,
        bytes32 attestationHash
    );

    /// @notice Emitted when a stale attestation is detected
    event StaleAttestationDetected(
        address indexed qc,
        uint256 lastAttestationTime,
        uint256 staleThreshold
    );

    /// @notice Custom errors
    error NotAuthorized();
    error InvalidAttestation();
    error AttestationTooFrequent();

    /// @notice Record a new reserve attestation for a QC
    /// @dev Only callable by authorized attesters
    /// @param qc The QC address
    /// @param totalReserve The total reserve amount
    /// @param liquidReserve The liquid portion of reserves
    /// @param attestationHash Hash of the attestation data
    /// @param attestationURI URI pointing to full attestation details
    function recordAttestation(
        address qc,
        uint256 totalReserve,
        uint256 liquidReserve,
        bytes32 attestationHash,
        string calldata attestationURI
    ) external;

    /// @notice Get the latest attestation for a QC
    /// @param qc The QC address
    /// @return The latest reserve attestation
    function getLatestAttestation(
        address qc
    ) external view returns (ReserveAttestation memory);

    /// @notice Check if a QC's attestation is stale
    /// @param qc The QC address
    /// @return Whether the attestation is stale
    function isAttestationStale(address qc) external view returns (bool);

    /// @notice Get the time since last attestation
    /// @param qc The QC address
    /// @return The time in seconds since last attestation
    function getTimeSinceLastAttestation(
        address qc
    ) external view returns (uint256);

    /// @notice Calculate the collateralization ratio for a QC
    /// @param qc The QC address
    /// @return The collateralization ratio (percentage)
    function getCollateralizationRatio(address qc) external view returns (uint256);

    /// @notice Check if a QC meets minimum reserve requirements
    /// @param qc The QC address
    /// @return Whether the QC meets requirements
    function meetsReserveRequirements(address qc) external view returns (bool);

    /// @notice Set the minimum attestation frequency
    /// @dev Only callable by admin role
    /// @param frequency The minimum time between attestations in seconds
    function setMinAttestationFrequency(uint256 frequency) external;

    /// @notice Get historical attestations for a QC
    /// @param qc The QC address
    /// @param limit The maximum number of attestations to return
    /// @return Array of historical attestations
    function getAttestationHistory(
        address qc,
        uint256 limit
    ) external view returns (ReserveAttestation[] memory);
}