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

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./QCManager.sol";
import "./QCData.sol";
import "./SystemState.sol";
import "./AccountControl.sol";
import "./QCErrors.sol";

/// @title QCMinter
/// @notice QC-backed tBTC minting implementation with comprehensive validation
/// @dev This contract serves as a validation layer for tBTC minting operations.
///      It validates QC status, system state, capacity limits, and amount bounds
///      before delegating actual minting to the AccountControl contract.
///      
///      The contract follows the principle of separation of concerns:
///      - QCMinter: Business logic validation and access control
///      - AccountControl: Invariant enforcement and actual token minting
///
/// @custom:security-contact security@thesis.co
///
/// Role definitions:
/// - DEFAULT_ADMIN_ROLE: Can grant/revoke roles and manage contract permissions
/// - MINTER_ROLE: Can request minting of tBTC tokens (typically bridge operators)
contract QCMinter is AccessControl, ReentrancyGuard {

    /// @notice Role identifier for addresses authorized to request minting
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    /// @notice Conversion factor from tBTC (1e18) to satoshis (1e8)
    uint256 public constant SATOSHI_MULTIPLIER = 1e10;

    /// @notice Contract dependencies for validation and minting operations
    /// @dev All contracts except AccountControl are immutable for gas efficiency
    QCData public immutable qcData;        // QC status and metadata
    SystemState public immutable systemState; // System-wide configuration
    QCManager public immutable qcManager;     // QC capacity management
    AccountControl public accountControl;      // Actual minting execution

    // =================== ACCOUNT CONTROL INTEGRATION ===================

    /// @notice Mapping to track mint requests for external monitoring and auditing
    /// @dev Public mapping allows external systems to query mint request details by ID
    mapping(bytes32 => MintRequest) public mintRequests;

    /// @notice Counter for generating unique mint IDs, incremented for each request
    /// @dev Private to prevent external manipulation of ID generation
    uint256 private mintCounter;

    /// @notice Structure containing details of a mint request
    /// @dev Used for external tracking and audit purposes
    struct MintRequest {
        address qc;        // The Qualified Custodian providing backing
        address user;      // The recipient of minted tBTC tokens
        uint256 amount;    // Amount of tBTC requested (in wei)
        uint256 timestamp; // Block timestamp when request was made
    }

    // =================== EVENTS ===================

    /// @notice Emitted when a mint is rejected
    event MintRejected(
        address indexed qc,
        address indexed user,
        uint256 indexed amount,
        string reason,
        address rejectedBy,
        uint256 timestamp
    );

    /// @notice Emitted when a QC mint request is initiated
    event QCMintRequested(
        address indexed qc,
        address indexed user,
        uint256 indexed amount,
        bytes32 mintId,
        address requestedBy,
        uint256 timestamp
    );

    /// @notice Emitted when mint is completed through AccountControl
    event MintCompleted(
        address indexed qc,
        address indexed user,
        uint256 indexed amount,
        bytes32 mintId,
        uint256 satoshis
    );

    /// @notice Emitted when auto-mint flow completes successfully
    event AutoMintCompleted(
        address indexed user,
        uint256 satoshiAmount,
        uint256 tbtcAmount
    );

    /// @notice Emitted when QC mint is processed successfully
    /// @dev DEPRECATED: Use MintCompleted instead. Will be removed in v2.0.0
    event QCMintProcessed(
        address indexed qc,
        address indexed user,
        uint256 indexed amount,
        bytes32 mintId,
        uint256 satoshis,
        address processedBy,
        uint256 timestamp
    );

    /// @notice Initialize the QCMinter contract with required dependencies
    /// @dev Sets up role-based access control and validates all dependency addresses
    /// @param _qcData Address of the QCData contract for QC status queries
    /// @param _systemState Address of the SystemState contract for system-wide settings
    /// @param _qcManager Address of the QCManager contract for capacity management
    /// @param _accountControl Address of the AccountControl contract for actual minting
    constructor(
        address _qcData,
        address _systemState,
        address _qcManager,
        address _accountControl
    ) {
        require(_qcData != address(0), "Invalid qcData address");
        require(_systemState != address(0), "Invalid systemState address");
        require(_qcManager != address(0), "Invalid qcManager address");
        require(_accountControl != address(0), "Invalid accountControl address");

        qcData = QCData(_qcData);
        systemState = SystemState(_systemState);
        qcManager = QCManager(_qcManager);
        accountControl = AccountControl(_accountControl);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    /// @notice Validates QC capacity and initiates tBTC minting process
    /// @dev Performs comprehensive validation before delegating to AccountControl for actual minting
    /// @param qc The address of the Qualified Custodian providing backing
    /// @param recipient The address to receive the minted tBTC tokens
    /// @param amount The amount of tBTC to mint (in wei, 1e18 = 1 tBTC)
    /// @return mintId Unique identifier for this minting request
    function requestQCMint(address qc, address recipient, uint256 amount)
        external
        onlyRole(MINTER_ROLE)
        nonReentrant
        returns (bytes32 mintId)
    {
        return _requestMint(qc, recipient, amount);
    }

    /// @notice Internal minting logic with comprehensive validation and state management
    /// @dev Validates system state, QC eligibility, capacity, then delegates to AccountControl
    /// @param qc The address of the Qualified Custodian providing backing
    /// @param user The address receiving the tBTC tokens
    /// @param amount The amount of tBTC to mint (in wei, 1e18 = 1 tBTC)
    /// @return mintId Unique identifier for this minting request
    function _requestMint(
        address qc,
        address user,
        uint256 amount
    ) internal returns (bytes32 mintId) {
        // Validate inputs
        if (qc == address(0)) revert QCErrors.InvalidQCAddress();
        if (user == address(0)) revert QCErrors.InvalidUserAddress();
        if (amount == 0) revert QCErrors.InvalidAmount();

        // Check system state
        if (systemState.isMintingPaused()) {
            emit MintRejected(
                qc,
                user,
                amount,
                "Minting paused",
                msg.sender,
                block.timestamp
            );
            revert QCErrors.MintingIsPaused();
        }
        if (systemState.isQCEmergencyPaused(qc)) {
            emit MintRejected(
                qc,
                user,
                amount,
                "QC emergency paused",
                msg.sender,
                block.timestamp
            );
            revert QCErrors.QCIsEmergencyPaused(qc);
        }
        if (
            amount < systemState.minMintAmount() ||
            amount > systemState.maxMintAmount()
        ) {
            emit MintRejected(
                qc,
                user,
                amount,
                "Amount outside allowed range",
                msg.sender,
                block.timestamp
            );
            revert QCErrors.AmountOutsideAllowedRange();
        }

        // Check QC status
        if (qcData.getQCStatus(qc) != QCData.QCStatus.Active) {
            emit MintRejected(
                qc,
                user,
                amount,
                "QC not active",
                msg.sender,
                block.timestamp
            );
            revert QCErrors.QCNotActive(qc);
        }

        // Atomically check and consume minting capacity
        bool capacityConsumed = qcManager.consumeMintCapacity(qc, amount);
        if (!capacityConsumed) {
            emit MintRejected(
                qc,
                user,
                amount,
                "Insufficient capacity",
                msg.sender,
                block.timestamp
            );
            revert QCErrors.InsufficientMintingCapacity();
        }

        // Generate unique mint ID
        mintId = _generateMintId(qc, user, amount);

        // Emit request event
        emit QCMintRequested(qc, user, amount, mintId, msg.sender, block.timestamp);

        // Store mint request for external tracking
        mintRequests[mintId] = MintRequest({
            qc: qc,
            user: user,
            amount: amount,
            timestamp: block.timestamp
        });

        // Use AccountControl for minting (returns satoshis for event emission)
        uint256 satoshis = accountControl.mintTBTC(qc, user, amount);

        // Emit completion events
        emit MintCompleted(qc, user, amount, mintId, satoshis);
        emit QCMintProcessed(qc, user, amount, mintId, satoshis, msg.sender, block.timestamp);

        return mintId;
    }

    /// @notice Get available minting capacity for a Qualified Custodian
    /// @dev Delegates to QCManager for real-time capacity calculation
    /// @param qc The address of the Qualified Custodian
    /// @return availableCapacity The amount available for minting (in wei)
    function getAvailableMintingCapacity(address qc)
        external
        view
        returns (uint256 availableCapacity)
    {
        return qcManager.getAvailableMintingCapacity(qc);
    }

    /// @notice Check if a Qualified Custodian is eligible for minting a specific amount
    /// @dev Performs all validation checks without state changes
    /// @param qc The address of the Qualified Custodian
    /// @param amount The amount to mint (in wei, 1e18 = 1 tBTC)
    /// @return eligible True if the QC can mint the requested amount
    function checkMintingEligibility(address qc, uint256 amount)
        external
        view
        returns (bool eligible)
    {
        // Check system state
        if (systemState.isMintingPaused()) {
            return false;
        }

        if (
            amount < systemState.minMintAmount() ||
            amount > systemState.maxMintAmount()
        ) {
            return false;
        }

        // Check QC status
        if (qcData.getQCStatus(qc) != QCData.QCStatus.Active) {
            return false;
        }

        // Check capacity using external call for gas-efficient view function delegation
        uint256 availableCapacity = this.getAvailableMintingCapacity(qc);
        return amount <= availableCapacity;
    }


    /// @notice Generate unique mint identifier for tracking purposes
    /// @dev Uses counter, timestamp, and parameters to ensure uniqueness
    /// @param qc The Qualified Custodian address
    /// @param user The user address receiving tokens
    /// @param amount The mint amount for additional entropy
    /// @return mintId The generated unique identifier
    function _generateMintId(
        address qc,
        address user,
        uint256 amount
    ) private returns (bytes32 mintId) {
        // Unchecked increment is safe: counter overflow after 2^256 operations is not realistic
        unchecked {
            mintCounter++;
        }
        return
            keccak256(
                abi.encodePacked(qc, user, amount, mintCounter, block.timestamp)
            );
    }

}
