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

/**
 * @title IAccountControl
 * @notice Interface for the AccountControl contract
 * @dev Defines the external functions available for interacting with AccountControl
 *
 * @custom:security-notes
 * - This interface should only be implemented by the AccountControl contract
 * - Callers must have appropriate roles to execute these functions
 */
interface IAccountControl {
    // ========== ENUMS ==========

    enum ReserveType {
        UNINITIALIZED,
        QC_PERMISSIONED
    }

    // ========== EXTERNAL FUNCTIONS ==========

    /**
     * @notice Authorize a new reserve with specific type
     * @dev Requires RESERVE_ROLE
     * @param reserve The reserve address
     * @param mintingCap The maximum amount this reserve can mint
     * @param rType The type of reserve
     */
    function authorizeReserve(
        address reserve,
        uint256 mintingCap,
        ReserveType rType
    ) external;

    /**
     * @notice Deauthorize a reserve
     * @dev Requires RESERVE_ROLE. Reserve must have zero minted balance.
     * @param reserve The reserve address to deauthorize
     */
    function deauthorizeReserve(address reserve) external;

    /**
     * @notice Set minting cap for a reserve
     * @dev Requires RESERVE_ROLE. New cap must be higher than current minted amount.
     * @param reserve The reserve address
     * @param newCap The new minting cap in satoshis
     */
    function setMintingCap(address reserve, uint256 newCap) external;

    /**
     * @notice Set backing amount for a reserve based on oracle data
     * @dev Requires ORACLE_ROLE
     * @param reserve The reserve address
     * @param amount The new backing amount in satoshis
     */
    function setBacking(address reserve, uint256 amount) external;

    /**
     * @notice Batch update backing for multiple reserves
     * @dev Requires ORACLE_ROLE, gas optimized for multiple updates
     * @param reserves Array of reserve addresses to update
     * @param amounts Array of new backing amounts in satoshis
     */
    function batchSetBacking(
        address[] calldata reserves,
        uint256[] calldata amounts
    ) external;

    /**
     * @notice Pause a specific reserve
     * @dev Can be called by Owner or EmergencyCouncil
     * @param reserve The reserve address to pause
     */
    function pauseReserve(address reserve) external;

    /**
     * @notice Unpause a specific reserve
     * @dev Can only be called by Owner (not EmergencyCouncil)
     * @param reserve The reserve address to unpause
     */
    function unpauseReserve(address reserve) external;

    /**
     * @notice Pause the entire system
     * @dev Can be called by Owner or EmergencyCouncil
     */
    function pauseSystem() external;

    /**
     * @notice Unpause the entire system
     * @dev Can only be called by Owner (not EmergencyCouncil)
     */
    function unpauseSystem() external;

    /**
     * @notice Handle redemption notification from external systems
     * @dev Requires REDEEMER_ROLE or RESERVE_ROLE
     * @param reserve The reserve address that is redeeming
     * @param amount The amount being redeemed in satoshis
     * @return success True if redemption was processed
     */
    function notifyRedemption(address reserve, uint256 amount)
        external
        returns (bool success);

    /**
     * @notice Mint tBTC tokens by converting to satoshis internally
     * @dev Only callable by addresses with MINTER_ROLE (QCMinter)
     * @param reserve Address of the reserve requesting the mint
     * @param recipient Address to receive the minted tokens
     * @param tbtcAmount Amount in tBTC units (1e18 precision)
     * @return satoshis Amount converted to satoshis for event emission
     */
    function mintTBTC(address reserve, address recipient, uint256 tbtcAmount)
        external
        returns (uint256 satoshis);

    // ========== VIEW FUNCTIONS ==========

    /**
     * @notice Get backing amount for a reserve
     * @param reserve The reserve address
     * @return The backing amount in satoshis
     */
    function backing(address reserve) external view returns (uint256);

    /**
     * @notice Get minted amount for a reserve
     * @param reserve The reserve address
     * @return The minted amount in satoshis
     */
    function minted(address reserve) external view returns (uint256);

    /**
     * @notice Check if a reserve is authorized
     * @param reserve The reserve address
     * @return True if authorized, false otherwise
     */
    function isReserveAuthorized(address reserve) external view returns (bool);

    /**
     * @notice Check if a reserve can operate (authorized, not paused, system not paused)
     * @param reserve The reserve address
     * @return True if reserve can operate, false otherwise
     */
    function canOperate(address reserve) external view returns (bool);

    /**
     * @notice Get the bank contract address
     * @return The bank contract address
     */
    function bank() external view returns (address);

    // ========== ROLE MANAGEMENT ==========

    /**
     * @notice Grant RESERVE_ROLE to an address
     * @dev Only callable by Owner
     * @param manager Address to grant the role to
     */
    function grantReserveRole(address manager) external;

    /**
     * @notice Grant ORACLE_ROLE to an address
     * @dev Only callable by Owner
     * @param oracle Address to grant the role to
     */
    function grantOracleRole(address oracle) external;

    /**
     * @notice Grant REDEEMER_ROLE to an address
     * @dev Only callable by Owner
     * @param redeemer Address to grant the role to
     */
    function grantRedeemerRole(address redeemer) external;

    /**
     * @notice Grant MINTER_ROLE to an address
     * @dev Only callable by Owner
     * @param minter Address to grant the role to
     */
    function grantMinterRole(address minter) external;
}
