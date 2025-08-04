// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.21;

/// @title IWatchdogAutomatedEnforcement
/// @notice Interface for the automated enforcement component of the watchdog system
/// @dev This interface defines deterministic enforcement actions for objective violations
interface IWatchdogAutomatedEnforcement {
    /// @notice Emitted when a QC status is changed due to automated enforcement
    event AutomatedStatusChange(
        address indexed qc,
        uint8 oldStatus,
        uint8 newStatus,
        string reason
    );

    /// @notice Emitted when a redemption is defaulted by automated enforcement
    event AutomatedRedemptionDefault(
        bytes32 indexed redemptionKey,
        address indexed qc,
        string reason
    );

    /// @notice Emitted when enforcement is executed
    event EnforcementExecuted(
        string enforcementType,
        address indexed target,
        uint256 timestamp
    );

    /// @notice Custom errors
    error EnforcementCooldownActive();
    error NotAuthorized();
    error InvalidParameters();

    /// @notice Enforces reserve compliance violations
    /// @dev Checks for stale attestations, insufficient reserves, or zero reserves
    /// @param qc The QC address to check and potentially enforce
    function enforceReserveCompliance(address qc) external;

    /// @notice Enforces redemption timeout violations
    /// @dev Defaults redemptions that have exceeded the timeout period
    /// @param redemptionKey The key of the redemption to check
    function enforceRedemptionTimeout(bytes32 redemptionKey) external;

    /// @notice Enforces operational compliance violations
    /// @dev Checks for wallet inactivity or QC inactivity
    /// @param qc The QC address to check
    function enforceOperationalCompliance(address qc) external;

    /// @notice Batch enforcement for gas efficiency
    /// @dev Allows multiple enforcement actions in a single transaction
    /// @param qcs Array of QC addresses to check for reserve compliance
    /// @param redemptionKeys Array of redemption keys to check for timeouts
    function batchEnforce(
        address[] calldata qcs,
        bytes32[] calldata redemptionKeys
    ) external;

    /// @notice Sets the enforcement cooldown period
    /// @dev Only callable by admin role
    /// @param cooldown The cooldown period in seconds
    function setEnforcementCooldown(uint256 cooldown) external;

    /// @notice Gets the last enforcement timestamp for a specific type and target
    /// @param enforcementType The type of enforcement
    /// @param target The target address or identifier
    /// @return The timestamp of the last enforcement
    function getLastEnforcement(
        string calldata enforcementType,
        address target
    ) external view returns (uint256);

    /// @notice Checks if enforcement can be executed (cooldown expired)
    /// @param enforcementType The type of enforcement
    /// @param target The target address or identifier
    /// @return Whether enforcement can be executed
    function canEnforce(
        string calldata enforcementType,
        address target
    ) external view returns (bool);
}