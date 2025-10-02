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

import "../QCData.sol";

/**
 * @title IQCManagerEvents
 * @notice Consolidated event interface for QCManager to reduce contract size
 * @dev Groups similar events using indexed parameters for efficient filtering
 */
interface IQCManagerEvents {
    // ========== GENERIC CONSOLIDATED EVENTS ==========
    
    /**
     * @notice Generic event for QC operations
     * @dev Use operation parameter to distinguish event types:
     * - "SYNC_SUCCESS": Successful oracle sync
     * - "SYNC_FAILED": Failed oracle sync
     * - "ORACLE_FAILED": Oracle failure detected
     * - "ORACLE_RECOVERED": Oracle recovered
     * - "MINTING_DENIED": Minting denied due to stale oracle data
     * @param qc QC address
     * @param operation Operation type (keccak256 hash)
     * @param value Relevant numeric value (balance, amount, etc.)
     * @param data Additional data encoded as bytes32
     */
    event QCOperation(
        address indexed qc,
        bytes32 indexed operation,
        uint256 value,
        bytes32 data
    );
    
    /**
     * @notice Batch operation summary event
     * @dev Replaces multiple batch-specific events
     * @param operation Operation type (e.g., "BATCH_SYNC", "BATCH_HEALTH_CHECK")
     * @param processed Number of items processed
     * @param successful Number of successful operations
     * @param failed Number of failed operations
     */
    event BatchOperation(
        bytes32 indexed operation,
        uint256 processed,
        uint256 successful,
        uint256 failed
    );
    
    // ========== CRITICAL EVENTS (Keep Specific) ==========
    
    /**
     * @notice QC status change (critical for state tracking)
     */
    event QCStatusChanged(
        address indexed qc,
        QCData.QCStatus indexed oldStatus,
        QCData.QCStatus indexed newStatus,
        bytes32 reason,
        address changedBy,
        uint256 timestamp
    );
    
    /**
     * @notice QC onboarding (critical for registration)
     */
    event QCOnboarded(
        address indexed qc,
        uint256 indexed maxMintingCap,
        address indexed onboardedBy,
        uint256 timestamp
    );
    
    /**
     * @notice Solvency check result (critical for monitoring)
     */
    event SolvencyCheck(
        address indexed qc,
        bool indexed solvent,
        uint256 backing,
        uint256 obligations,
        bool staleData
    );
    
    /**
     * @notice Minting capacity or balance update
     */
    event BalanceUpdate(
        address indexed qc,
        bytes32 indexed updateType, // "MINTED", "RESERVE", "CAP"
        uint256 oldValue,
        uint256 newValue
    );
}