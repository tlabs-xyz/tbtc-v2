// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title IQCReserveLedger
/// @notice Interface for QCReserveLedger to accept consensus attestations
interface IQCReserveLedger {
    /// @notice Record a consensus attestation from the oracle
    /// @param qc The Qualified Custodian address
    /// @param balance The consensus reserve balance
    /// @param attesterCount Number of attesters that agreed
    function recordConsensusAttestation(
        address qc,
        uint256 balance,
        uint256 attesterCount
    ) external;
    
    /// @notice Get reserve balance and staleness for a QC
    /// @param qc The Qualified Custodian address
    /// @return balance The reserve balance
    /// @return isStale Whether the attestation is stale
    function getReserveBalanceAndStaleness(address qc) external view returns (uint256 balance, bool isStale);
}