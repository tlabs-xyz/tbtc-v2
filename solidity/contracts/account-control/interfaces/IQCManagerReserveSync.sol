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
 * @title IQCManagerReserveSync
 * @notice Interface for QCManager reserve synchronization functionality
 * @dev Used by ReserveOracle to enable automatic backing synchronization
 */
interface IQCManagerReserveSync {
    /**
     * @notice Synchronize QC backing amount from oracle data
     * @dev Called by ReserveOracle when backing amount changes are detected
     * @param qc Address of the Qualified Custodian to sync
     */
    function syncBackingFromOracle(address qc) external;
}