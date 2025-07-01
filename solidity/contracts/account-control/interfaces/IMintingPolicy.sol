// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title IMintingPolicy
/// @dev Interface for upgradeable minting policy contracts.
/// Core contracts delegate complex minting logic to Policy contracts,
/// enabling future upgrades without changing core contract interfaces.
interface IMintingPolicy {
    /// @notice Request minting of tBTC tokens for a QC
    /// @param qc The address of the Qualified Custodian
    /// @param user The address requesting the mint
    /// @param amount The amount of tBTC to mint
    /// @return mintId Unique identifier for this minting request
    function requestMint(
        address qc,
        address user,
        uint256 amount
    ) external returns (bytes32 mintId);

    /// @notice Get available minting capacity for a QC
    /// @param qc The address of the Qualified Custodian
    /// @return availableCapacity The amount available for minting
    function getAvailableMintingCapacity(address qc)
        external
        view
        returns (uint256 availableCapacity);

    /// @notice Check if a QC is eligible for minting
    /// @param qc The address of the Qualified Custodian
    /// @param amount The amount to mint
    /// @return eligible True if the QC can mint the requested amount
    function checkMintingEligibility(address qc, uint256 amount)
        external
        view
        returns (bool eligible);
}
