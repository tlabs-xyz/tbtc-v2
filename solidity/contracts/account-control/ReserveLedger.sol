// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ReserveLedger
/// @notice Tracks reserve attestations and balances for QCs
/// @dev Simple implementation for reserve balance tracking and staleness detection
contract ReserveLedger is AccessControl {
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    struct ReserveData {
        uint256 balance;
        uint256 lastUpdate;
        bool isActive;
    }

    // QC address => Reserve data
    mapping(address => ReserveData) public reserves;
    
    // Configuration
    uint256 public staleThreshold = 24 hours; // Attestations stale after 24 hours

    // Events
    event ReserveAttested(
        address indexed qc,
        uint256 indexed balance,
        address indexed attestor,
        uint256 timestamp
    );

    event StaleThresholdUpdated(
        uint256 oldThreshold,
        uint256 newThreshold,
        address updatedBy
    );

    // Custom errors
    error NotAuthorized();
    error InvalidBalance();
    error InvalidThreshold();

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
        _grantRole(ATTESTOR_ROLE, msg.sender);
    }

    /// @notice Submit a reserve attestation for a QC
    /// @param qc The QC address
    /// @param balance The attested reserve balance
    function submitAttestation(address qc, uint256 balance) 
        external 
        onlyRole(ATTESTOR_ROLE) 
    {
        reserves[qc] = ReserveData({
            balance: balance,
            lastUpdate: block.timestamp,
            isActive: true
        });

        emit ReserveAttested(qc, balance, msg.sender, block.timestamp);
    }

    /// @notice Get reserve balance and staleness for a QC
    /// @param qc The QC address
    /// @return balance The reserve balance
    /// @return isStale True if the attestation is stale
    function getReserveBalanceAndStaleness(address qc) 
        external 
        view 
        returns (uint256 balance, bool isStale) 
    {
        ReserveData memory data = reserves[qc];
        balance = data.balance;
        isStale = (block.timestamp > data.lastUpdate + staleThreshold) || !data.isActive;
    }

    /// @notice Get reserve data for a QC
    /// @param qc The QC address
    /// @return data The complete reserve data
    function getReserveData(address qc) 
        external 
        view 
        returns (ReserveData memory data) 
    {
        return reserves[qc];
    }

    /// @notice Check if reserve attestation is stale
    /// @param qc The QC address
    /// @return stale True if attestation is stale
    function isAttestationStale(address qc) external view returns (bool stale) {
        ReserveData memory data = reserves[qc];
        return (block.timestamp > data.lastUpdate + staleThreshold) || !data.isActive;
    }

    /// @notice Update stale threshold
    /// @param newThreshold New threshold in seconds
    function setStaleThreshold(uint256 newThreshold) 
        external 
        onlyRole(MANAGER_ROLE) 
    {
        if (newThreshold == 0) revert InvalidThreshold();
        
        uint256 oldThreshold = staleThreshold;
        staleThreshold = newThreshold;
        
        emit StaleThresholdUpdated(oldThreshold, newThreshold, msg.sender);
    }

    /// @notice Deactivate a QC's reserve tracking
    /// @param qc The QC address
    function deactivateQC(address qc) external onlyRole(MANAGER_ROLE) {
        reserves[qc].isActive = false;
    }

    /// @notice Reactivate a QC's reserve tracking
    /// @param qc The QC address
    function reactivateQC(address qc) external onlyRole(MANAGER_ROLE) {
        reserves[qc].isActive = true;
    }
}