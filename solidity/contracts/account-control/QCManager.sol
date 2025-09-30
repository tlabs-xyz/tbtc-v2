// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./QCData.sol";
import "./QCManagerErrors.sol";
import "./SystemState.sol";
import "./ReserveOracle.sol";
import {BitcoinAddressUtils} from "./BitcoinAddressUtils.sol";
import {CheckBitcoinSigs} from "@keep-network/bitcoin-spv-sol/contracts/CheckBitcoinSigs.sol";
import "./AccountControl.sol";
import "./QCManagerLib.sol";
import "./IQCPauseManager.sol";

// =================== CONSOLIDATED INTERFACES ===================
// Interfaces for contracts that will be removed in consolidation
interface IQCRedeemer {
    function hasUnfulfilledRedemptions(address qc) external view returns (bool);
    function getEarliestRedemptionDeadline(address qc) external view returns (uint256);
    function hasWalletObligations(string calldata walletAddress) external view returns (bool);
    function getWalletPendingRedemptionCount(string calldata walletAddress) external view returns (uint256);
    function getWalletEarliestRedemptionDeadline(string calldata walletAddress) external view returns (uint256);
}

/// @title QCManager
/// @dev Unified controller for QC management, consolidating business logic, state management, and pause credits.
/// Contains all business logic for managing QCs, reading from and writing to
/// QCData and SystemState. Manages QC status changes, wallet registration flows,
/// self-pause capabilities, renewable pause credits, and integrates with role-based access control.
///
/// ## Consolidated Functionality
/// This contract combines functionality from:
/// - QCManager: Core business logic and QC lifecycle management
/// - QCStateManager: 5-state machine with self-pause and auto-escalation
/// - QCRenewablePause: 90-day renewable pause credit system
///
/// ## 5-State QC Model
/// - Active: Full operations (mint + fulfill)
/// - MintingPaused: Can fulfill only (no new minting)
/// - Paused: Complete halt (no operations)
/// - UnderReview: Under governance review (no operations)
/// - Revoked: Terminal state (no operations)
///
/// ## Self-Pause System
/// - QCs can self-pause using renewable 90-day credits
/// - 48-hour pause duration with auto-escalation to UnderReview
/// - Redemption deadline protection prevents breaking user commitments
/// - Emergency council can override and restore credits
///
/// Role definitions:
/// - DEFAULT_ADMIN_ROLE: Can grant/revoke roles and update system configurations
/// - GOVERNANCE_ROLE: Can register QCs, manage minting capacity, update minting amounts
/// - REGISTRAR_ROLE: Can register/deregister wallets with message signature verification
/// - DISPUTE_ARBITER_ROLE: Can pause QCs, change status, verify solvency, handle defaults (emergency response)
/// - ENFORCEMENT_ROLE: Can request status changes to UnderReview (limited authority)
/// - MONITOR_ROLE: Can check QC escalations and trigger auto-escalation
/// - EMERGENCY_ROLE: Can clear emergency pauses and restore credits
contract QCManager is AccessControl, ReentrancyGuard, QCManagerErrors {
    
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant DISPUTE_ARBITER_ROLE = keccak256("DISPUTE_ARBITER_ROLE");
    bytes32 public constant ENFORCEMENT_ROLE =
        keccak256("ENFORCEMENT_ROLE");
    bytes32 public constant MONITOR_ROLE = keccak256("MONITOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // =================== STATE MANAGEMENT CONSTANTS ===================
    
    uint256 public constant SELF_PAUSE_TIMEOUT = 48 hours;
    uint256 public constant ESCALATION_WARNING_PERIOD = 1 hours;
    
    // Reason codes for state changes
    bytes32 public constant SELF_PAUSE = keccak256("SELF_PAUSE");
    bytes32 public constant EARLY_RESUME = keccak256("EARLY_RESUME");
    bytes32 public constant AUTO_ESCALATION = keccak256("AUTO_ESCALATION");
    bytes32 public constant DEFAULT_ESCALATION = keccak256("DEFAULT_ESCALATION");
    bytes32 public constant BACKLOG_CLEARED = keccak256("BACKLOG_CLEARED");
    bytes32 public constant UNDERCOLLATERALIZED_REASON = keccak256("UNDERCOLLATERALIZED");
    bytes32 public constant STALE_DATA_REASON = keccak256("STALE_ORACLE_DATA");
    
    // =================== PAUSE CREDIT INTEGRATION ===================
    // Pause credit system managed by QCPauseManager contract

    // Additional errors not in QCManagerErrors
    error QCNotEligibleForEscalation();
    error EscalationPeriodNotReached();
    error OnlyStateManager();
    // WouldBreachRedemptionDeadline moved to QCManagerPauseLib
    

    // =================== STRUCTS ===================
    
    // PauseCredit struct moved to QCManagerPauseLib

    QCData public immutable qcData;
    SystemState public immutable systemState;
    ReserveOracle public immutable reserveOracle;

    /// @dev Address of the Account Control contract
    address public accountControl;
    
    // =================== STATE MANAGEMENT STORAGE ===================
    
    /// @dev Track QC self-pause timeouts for auto-escalation
    mapping(address => uint256) public qcPauseTimestamp;
    
    /// @dev Track if QC can early resume (only for self-initiated pauses)
    mapping(address => bool) public qcCanEarlyResume;
    
    /// @dev Track if escalation warning has been emitted
    mapping(address => bool) public escalationWarningEmitted;
    
    // =================== EXTERNAL CONTRACTS ===================
    
    /// @notice QCPauseManager contract for pause credit management
    IQCPauseManager public immutable pauseManager;
    
    // =================== WALLET REGISTRATION STORAGE ===================

    /// @dev Track used nonces for each QC to prevent replay attacks
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    /// @dev Mutex locks for wallet deregistration to prevent race conditions
    /// @dev CRITICAL: Prevents concurrent redemptions during deregistration check
    mapping(string => bool) private walletDeregistrationLocks;

    // Temporary reference for QCRedeemer until full consolidation
    IQCRedeemer public qcRedeemer;

    // =================== STANDARDIZED EVENTS ===================

    /// @dev Emitted when QC registration is initiated
    event QCRegistrationInitiated(
        address indexed qc,
        address indexed initiatedBy,
        uint256 indexed timestamp
    );

    /// @dev Emitted when QC status is changed
    event QCStatusChanged(
        address indexed qc,
        QCData.QCStatus indexed oldStatus,
        QCData.QCStatus indexed newStatus,
        bytes32 reason,
        address changedBy,
        string authority,
        uint256 timestamp
    );

    event QCStatusChangeRequested(
        address indexed qc,
        QCData.QCStatus indexed requestedStatus,
        bytes32 reason,
        address indexed requester,
        uint256 timestamp
    );

    /// @dev Emitted when wallet registration is requested
    event WalletRegistrationRequested(
        address indexed qc,
        string btcAddress,
        bytes32 challenge,
        address indexed requestedBy,
        uint256 timestamp
    );

    /// @dev Emitted when wallet ownership verification is requested
    event WalletOwnershipVerificationRequested(
        address indexed qc,
        string bitcoinAddress,
        bytes32 challenge,
        address indexed requestedBy,
        uint256 timestamp
    );

    /// @dev Emitted when solvency check is performed
    event SolvencyCheckPerformed(
        address indexed qc,
        bool indexed solvent,
        uint256 mintedAmount,
        uint256 reserveBalance,
        address checkedBy,
        uint256 timestamp
    );

    /// @dev Emitted when solvency check encounters stale oracle data
    event SolvencyCheckWithStaleData(
        address indexed qc,
        uint256 lastKnownReserveBalance,
        uint256 mintedAmount,
        address checkedBy,
        uint256 timestamp
    );

    /// @dev Emitted when QC is onboarded through governance process
    event QCOnboarded(
        address indexed qc,
        uint256 indexed maxMintingCap,
        address indexed onboardedBy,
        uint256 timestamp
    );

    /// @dev Emitted when minting cap is increased through governance process
    event MintingCapIncreased(
        address indexed qc,
        uint256 indexed oldCap,
        uint256 indexed newCap,
        address increasedBy,
        uint256 timestamp
    );

    /// @dev Emitted when QC is emergency paused
    event QCEmergencyPaused(
        address indexed qc,
        bytes32 indexed reason,
        address indexed pausedBy,
        uint256 timestamp
    );

    /// @dev Emitted when reserve balance is updated
    event ReserveBalanceUpdated(
        address indexed qc,
        uint256 indexed oldBalance,
        uint256 indexed newBalance,
        address updatedBy,
        uint256 timestamp
    );

    event QCMintedAmountUpdated(
        address indexed qc,
        uint256 indexed oldAmount,
        uint256 indexed newAmount,
        address updatedBy,
        uint256 timestamp
    );

    /// @dev Emitted when wallet deregistration is requested
    event WalletDeregistrationRequested(
        address indexed qc,
        string btcAddress,
        uint256 timestamp
    );

    /// @dev Emitted when wallet deregistration is completed with reserve balance details
    event WalletDeregistrationCompleted(
        address indexed qc,
        string btcAddress,
        uint256 newReserveBalance,
        uint256 previousReserveBalance
    );

    // =================== STATE MANAGEMENT EVENTS ===================
    
    event QCSelfPaused(
        address indexed qc,
        QCData.PauseLevel level,
        QCData.QCStatus newStatus,
        uint256 timeout
    );
    
    // QCEarlyResumed consolidated with EarlyResumed to reduce contract size
    
    event ApproachingEscalation(
        address indexed qc,
        uint256 timeRemaining
    );
    
    event AutoEscalated(
        address indexed qc,
        QCData.QCStatus fromStatus,
        QCData.QCStatus toStatus
    );
    
    event DefaultProcessed(
        address indexed qc,
        bytes32 redemptionId,
        QCData.QCStatus oldStatus,
        QCData.QCStatus newStatus
    );
    
    event BacklogCleared(
        address indexed qc,
        QCData.QCStatus newStatus
    );
    
    // Pause credit events now emitted by QCPauseManager contract

    // Account Control Events
    /// @dev Emitted when Account Control address is updated
    event AccountControlUpdated(address indexed oldAddress, address indexed newAddress, address changedBy, uint256 timestamp);
    
    /// @dev Emitted when backing is synced from oracle to AccountControl
    event BackingSyncedFromOracle(address indexed qc, uint256 balance, bool isStale);

    modifier onlyWhenNotPaused(string memory functionName) {
        require(
            !systemState.isFunctionPaused(functionName),
            "Function is paused"
        );
        _;
    }

    /// @notice Ensures AccountControl is configured
    /// @dev Reverts if accountControl is not set (address(0))
    modifier requiresAccountControl() {
        require(accountControl != address(0), "AccountControl not set");
        _;
    }

    constructor(
        address _qcData,
        address _systemState,
        address _reserveOracle,
        address _pauseManager
    ) {
        require(_qcData != address(0), "Invalid QCData address");
        require(_systemState != address(0), "Invalid SystemState address");
        require(_reserveOracle != address(0), "Invalid ReserveOracle address");
        require(_pauseManager != address(0), "Invalid PauseManager address");

        qcData = QCData(_qcData);
        systemState = SystemState(_systemState);
        reserveOracle = ReserveOracle(_reserveOracle);
        pauseManager = IQCPauseManager(_pauseManager);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GOVERNANCE_ROLE, msg.sender);
        _grantRole(REGISTRAR_ROLE, msg.sender);
        _grantRole(DISPUTE_ARBITER_ROLE, msg.sender);
        _grantRole(MONITOR_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
    }
    
    /// @notice Set QCRedeemer contract reference (temporary until full consolidation)
    /// @param _qcRedeemer Address of the QCRedeemer contract
    function setQCRedeemer(address _qcRedeemer) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        qcRedeemer = IQCRedeemer(_qcRedeemer);
    }
    


    // =================== INSTANT GOVERNANCE FUNCTIONS ===================

    /// @notice Register a new Qualified Custodian (instant action)
    /// @dev SECURITY: nonReentrant protects against reentrancy via QCData external calls
    /// @param qc QC address to register
    /// @param maxMintingCap Maximum minting capacity for the QC
    function registerQC(address qc, uint256 maxMintingCap)
        external
        onlyRole(GOVERNANCE_ROLE)
        requiresAccountControl
        nonReentrant
    {
        // Delegate to library for validation and registration
        QCManagerLib.registerQCWithValidation(
            qcData,
            address(accountControl),
            qc,
            maxMintingCap
        );

        // Sync backing from oracle if available
        try this.syncBackingFromOracle(qc) {
            // Backing synced successfully
        } catch {
            // No oracle data yet or oracle not available - backing starts at 0
            // This is normal for newly registered QCs
        }

        emit QCRegistrationInitiated(qc, msg.sender, block.timestamp);
        emit QCOnboarded(qc, maxMintingCap, msg.sender, block.timestamp);
    }

    /// @notice Increase minting capacity for existing QC (instant action)
    /// @dev SECURITY: nonReentrant protects against reentrancy via QCData external calls
    /// @param qc QC address
    /// @param newCap New minting capacity (must be higher than current)
    function increaseMintingCapacity(address qc, uint256 newCap)
        external
        onlyRole(GOVERNANCE_ROLE)
        requiresAccountControl
        nonReentrant
    {
        if (qc == address(0)) {
            revert InvalidQCAddress();
        }
        if (newCap == 0) {
            revert InvalidMintingCapacity();
        }

        uint256 currentCap = qcData.getMaxMintingCapacity(qc);

        // Delegate to library for validation and update
        QCManagerLib.updateMintingCapacity(
            qcData,
            qc,
            newCap,
            address(accountControl)
        );

        emit MintingCapIncreased(
            qc,
            currentCap,
            newCap,
            msg.sender,
            block.timestamp
        );
    }

    // =================== INSTANT EMERGENCY FUNCTIONS ===================

    // =================== OPERATIONAL FUNCTIONS ===================

    /// @notice Change QC status with full authority (DISPUTE_ARBITER_ROLE only)
    /// @dev DISPUTE_ARBITER_ROLE has full authority to make any valid status transition.
    ///      This is typically used by governance or emergency response.
    ///      SECURITY: nonReentrant protects against reentrancy via QCData external calls
    /// @param qc The address of the QC
    /// @param newStatus The new status for the QC
    /// @param reason The reason for the status change
    function setQCStatus(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason
    )
        external
        onlyRole(DISPUTE_ARBITER_ROLE)
        nonReentrant
    {
        _executeStatusChange(qc, newStatus, reason, "ARBITER");
    }

    /// @notice Request status change from WatchdogEnforcer (ENFORCEMENT_ROLE only)
    /// @dev ENFORCEMENT_ROLE has LIMITED authority - can ONLY set QCs to UnderReview.
    ///      This design provides automated detection with human oversight:
    ///      - Watchdog detects objective violations (insufficient reserves, stale attestations)
    ///      - Sets QC to UnderReview (temporary suspension) to prevent further minting
    ///      - Human governance (DISPUTE_ARBITER_ROLE) reviews and decides final outcome
    ///      This prevents false positives from permanently damaging QCs while ensuring rapid response.
    ///      SECURITY: nonReentrant protects against reentrancy via QCData external calls
    /// @param qc The address of the QC
    /// @param newStatus The new status (must be UnderReview for watchdog enforcer)
    /// @param reason The reason code for the status change
    function requestStatusChange(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason
    )
        external
        onlyRole(ENFORCEMENT_ROLE)
        nonReentrant
    {
        // AUTHORITY VALIDATION: WatchdogEnforcer can only set QCs to UnderReview
        require(
            newStatus == QCData.QCStatus.UnderReview,
            "WatchdogEnforcer: UnderReview only"
        );

        emit QCStatusChangeRequested(
            qc,
            newStatus,
            reason,
            msg.sender,
            block.timestamp
        );
        _executeStatusChange(qc, newStatus, reason, "WATCHDOG_ENFORCER");
    }

    /// @notice Internal function that executes all status changes with full validation
    /// @param qc The address of the QC
    /// @param newStatus The new status
    /// @param reason The reason for the change
    /// @param authority The authority making the status change
    function _executeStatusChange(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason,
        string memory authority
    ) private requiresAccountControl {
        if (reason == bytes32(0)) {
            revert("Reason required");
        }

        if (!qcData.isQCRegistered(qc)) {
            revert QCNotRegistered(qc);
        }

        QCData.QCStatus oldStatus = qcData.getQCStatus(qc);

        // Check if QC has unfulfilled redemptions for enhanced validation
        bool hasRedemptions = false;
        if (address(qcRedeemer) != address(0)) {
            hasRedemptions = qcRedeemer.hasUnfulfilledRedemptions(qc);
        }

        // Validate status transitions with detailed reasoning
        (bool isValid,) = QCManagerLib.validateStatusTransitionDetailed(
            oldStatus,
            newStatus,
            hasRedemptions
        );

        if (!isValid) {
            revert InvalidStatusTransition(uint8(oldStatus), uint8(newStatus));
        }

        qcData.setQCStatus(qc, newStatus, reason);

        // Synchronize AccountControl with QC status changes
        _syncAccountControlWithStatus(qc, oldStatus, newStatus);

        emit QCStatusChanged(
            qc,
            oldStatus,
            newStatus,
            reason,
            msg.sender,
            authority,
            block.timestamp
        );
    }

    /// @notice Synchronizes AccountControl with QC status changes
    /// @dev Essential bridge maintaining consistency between QCManager business logic and AccountControl operational controls.
    /// @param qc The address of the QC
    /// @param oldStatus The previous status
    /// @param newStatus The new status
    /// @dev Maps QC statuses to AccountControl actions:
    ///      - Active: Resume/unpause reserve operations
    ///      - MintingPaused/Paused/UnderReview: Pause reserve operations  
    ///      - Revoked: Deauthorize reserve completely
    function _syncAccountControlWithStatus(
        address qc,
        QCData.QCStatus oldStatus,
        QCData.QCStatus newStatus
    ) private {
        if (oldStatus == newStatus) return;

        if (newStatus != QCData.QCStatus.Revoked) {
            try this.syncBackingFromOracle(qc) {
            } catch {
            }
        }

        QCManagerLib.syncAccountControlWithStatus(
            accountControl,
            qc,
            oldStatus,
            newStatus
        );
    }

    /// @notice Register a wallet for a QC using Bitcoin signature verification
    /// @dev SECURITY: nonReentrant protects against reentrancy via ReserveOracle and QCData external calls
    /// @param qc The address of the QC
    /// @param btcAddress The Bitcoin address to register
    /// @param challenge The challenge message that was signed
    /// @param walletPublicKey The Bitcoin public key in uncompressed format (64 bytes)
    /// @param v Recovery ID from signature
    /// @param r First 32 bytes of signature
    /// @param s Last 32 bytes of signature
    function registerWallet(
        address qc,
        string calldata btcAddress,
        bytes32 challenge,
        bytes calldata walletPublicKey,
        uint8 v,
        bytes32 r,
        bytes32 s
    )
        external
        onlyRole(REGISTRAR_ROLE)
        onlyWhenNotPaused("wallet_reg")
        nonReentrant
    {
        // Validate wallet registration - will revert on failure
        QCManagerLib.validateWalletRegistrationFull(
            qcData,
            qc,
            btcAddress,
            challenge,
            walletPublicKey,
            v,
            r,
            s
        );

        qcData.registerWallet(qc, btcAddress);

        emit WalletRegistrationRequested(
            qc,
            btcAddress,
            challenge,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Direct wallet registration by QCs themselves (simplified flow)
    /// @dev This function allows registered QCs to directly register their Bitcoin wallets
    ///      without requiring a watchdog intermediary. The QC must:
    ///      1. Be registered and active
    ///      2. Generate a deterministic challenge off-chain using the same parameters
    ///      3. Sign the challenge with their Bitcoin private key
    ///      4. Submit the signature with a unique nonce
    /// @param btcAddress The Bitcoin address to register
    /// @param nonce A unique nonce to prevent replay attacks (QC must track their nonces)
    /// @param walletPublicKey The Bitcoin public key in uncompressed format (64 bytes)
    /// @param v Recovery ID from signature
    /// @param r First 32 bytes of signature
    /// @param s Last 32 bytes of signature
    function registerWalletDirect(
        string calldata btcAddress,
        uint256 nonce,
        bytes calldata walletPublicKey,
        uint8 v,
        bytes32 r,
        bytes32 s
    )
        external
        onlyWhenNotPaused("wallet_reg")
        nonReentrant
    {
        // Validate and generate challenge - will revert on failure
        bytes32 challenge = QCManagerLib.validateDirectWalletRegistration(
            qcData,
            msg.sender,
            btcAddress,
            nonce,
            walletPublicKey,
            v,
            r,
            s,
            block.chainid
        );

        // Check and mark nonce as used to prevent replay
        if (usedNonces[msg.sender][nonce]) {
            revert NonceAlreadyUsed(msg.sender, nonce);
        }
        usedNonces[msg.sender][nonce] = true;

        // Register the wallet
        qcData.registerWallet(msg.sender, btcAddress);

        // Emit success event
        emit WalletRegistrationRequested(
            msg.sender,
            btcAddress,
            challenge,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Request wallet ownership verification (called by QC or authorized registrar)
    /// @dev This generates a challenge that QCs must sign with their Bitcoin private key
    /// @param bitcoinAddress The Bitcoin address to verify ownership of
    /// @param nonce A unique nonce to prevent challenge collisions
    /// @return challenge The challenge that must be signed with the Bitcoin private key
    function requestWalletOwnershipVerification(
        string calldata bitcoinAddress,
        uint256 nonce
    ) external returns (bytes32 challenge) {
        address qc;
        
        // Allow QCs to request verification for their own wallets
        if (qcData.isQCRegistered(msg.sender)) {
            qc = msg.sender;
        } 
        // Allow REGISTRAR_ROLE to initiate verification on behalf of QCs
        else if (hasRole(REGISTRAR_ROLE, msg.sender)) {
            // For registrars, the QC address should be derived from context or passed separately
            // For now, revert with clear message
            revert("Use registerWallet");
        }
        else {
            revert("Unauthorized");
        }

        // Validate Bitcoin address format
        if (bytes(bitcoinAddress).length == 0) revert InvalidWalletAddress();
        if (!QCManagerLib.isValidBitcoinAddress(bitcoinAddress)) revert InvalidWalletAddress();

        // Generate unique challenge (simplified version without MessageSigning)
        challenge = keccak256(
            abi.encodePacked(
                "TBTC_QC_WALLET_OWNERSHIP:",
                qc,
                nonce,
                block.timestamp
            )
        );

        emit WalletOwnershipVerificationRequested(
            qc,
            bitcoinAddress,
            challenge,
            msg.sender,
            block.timestamp
        );

        return challenge;
    }

    /// @notice Request wallet deregistration with atomic lock protection
    /// @dev CRITICAL FIX: Implements atomic lock-check-deregister pattern to prevent
    ///      race condition where redemptions could be created between check and deregistration
    /// @param btcAddress The Bitcoin address to deregister
    function requestWalletDeRegistration(string calldata btcAddress)
        external
        onlyWhenNotPaused("wallet_reg")
        nonReentrant
    {
        address qc = qcData.getWalletOwner(btcAddress);

        if (qc == address(0)) {
            revert WalletNotRegistered(btcAddress);
        }
        if (msg.sender != qc && !hasRole(GOVERNANCE_ROLE, msg.sender)) {
            revert NotAuthorizedForWalletDeregistration(msg.sender);
        }
        if (qcData.getWalletStatus(btcAddress) != QCData.WalletStatus.Active) {
            revert WalletNotActive(btcAddress);
        }

        // CRITICAL FIX: Atomic lock to prevent race conditions
        // Lock the wallet to prevent concurrent redemption operations
        require(!walletDeregistrationLocks[btcAddress], "WalletDeregistrationInProgress");
        walletDeregistrationLocks[btcAddress] = true;

        // Check for pending redemptions while locked
        bool hasObligations = false;
        if (address(qcRedeemer) != address(0)) {
            hasObligations = IQCRedeemer(address(qcRedeemer)).hasWalletObligations(btcAddress);
        }

        // If wallet has obligations, unlock and revert
        if (hasObligations) {
            walletDeregistrationLocks[btcAddress] = false;
            revert("WalletHasPendingRedemptions");
        }

        // CRITICAL: Perform deregistration while still locked
        // This ensures no redemptions can be created between check and deregistration
        try qcData.requestWalletDeRegistration(btcAddress) {
            // Success - wallet is now marked for deregistration
            // Emit event before unlocking
            emit WalletDeregistrationRequested(
                msg.sender,
                btcAddress,
                block.timestamp
            );
        } catch Error(string memory reason) {
            // Unlock on any failure and propagate the error
            walletDeregistrationLocks[btcAddress] = false;
            revert(reason);
        } catch (bytes memory) {
            // Unlock on any low-level failure
            walletDeregistrationLocks[btcAddress] = false;
            revert("WalletDeregistrationFailed");
        }

        // Unlock after successful deregistration
        walletDeregistrationLocks[btcAddress] = false;
    }

    /// @notice Finalize wallet deregistration with solvency check
    /// @dev SECURITY: nonReentrant protects against reentrancy via QCData and QCReserveLedger external calls
    /// @param btcAddress The Bitcoin address to finalize deregistration
    /// @param newReserveBalance The new reserve balance after wallet removal
    function finalizeWalletDeRegistration(
        string calldata btcAddress,
        uint256 newReserveBalance
    )
        external
        onlyRole(REGISTRAR_ROLE)
        onlyWhenNotPaused("wallet_reg")
        nonReentrant
    {
        address qc = qcData.getWalletOwner(btcAddress);

        if (qc == address(0)) {
            revert WalletNotRegistered(btcAddress);
        }
        if (
            qcData.getWalletStatus(btcAddress) !=
            QCData.WalletStatus.PendingDeRegistration
        ) {
            revert WalletNotPendingDeregistration(btcAddress);
        }

        // Get old balance before updating
        (uint256 oldBalance, ) = QCManagerLib.getReserveBalanceAndStaleness(reserveOracle, qc);

        // Update reserve balance and perform solvency check
        _updateReserveBalanceAndCheckSolvency(qc, newReserveBalance);

        // If we reach here, QC is solvent - finalize deregistration
        qcData.finalizeWalletDeRegistration(btcAddress);

        // Emit comprehensive deregistration event
        emit WalletDeregistrationCompleted(
            qc,
            btcAddress,
            newReserveBalance,
            oldBalance
        );
    }

    /// @notice Get available minting capacity for a QC
    /// @param qc The address of the QC
    /// @return availableCapacity The amount available for minting
    function getAvailableMintingCapacity(address qc)
        external
        view
        returns (uint256 availableCapacity)
    {
        // Delegate to library for calculation
        return QCManagerLib.calculateAvailableMintingCapacity(
            qcData,
            reserveOracle,
            qc
        );
    }

    /// @notice Atomically consume minting capacity for a QC
    /// @dev This function atomically checks capacity and updates minted amount to prevent TOCTOU vulnerabilities
    ///      SECURITY: This is the critical fix for the race condition where multiple mints could exceed capacity
    /// @param qc The address of the QC
    /// @param amount The amount to mint (in satoshis)
    /// @return success True if capacity was successfully consumed
    function consumeMintCapacity(address qc, uint256 amount)
        external
        onlyRole(MINTER_ROLE)
        nonReentrant
        returns (bool success)
    {
        // Validate inputs
        if (qc == address(0)) {
            revert InvalidQCAddress();
        }
        if (amount == 0) {
            return false;
        }

        // Check QC is registered
        if (!qcData.isQCRegistered(qc)) {
            revert QCNotRegistered(qc);
        }

        // Check QC is active
        if (qcData.getQCStatus(qc) != QCData.QCStatus.Active) {
            return false;
        }

        // Get current state
        uint256 mintingCap = qcData.getMaxMintingCapacity(qc);
        uint256 currentMinted = qcData.getQCMintedAmount(qc);
        
        // Calculate capacity from minting cap
        if (currentMinted + amount > mintingCap) {
            return false;
        }

        // Check reserve balance if oracle is available
        if (address(reserveOracle) != address(0)) {
            (uint256 reserveBalance, bool isStale) = reserveOracle.getReserveBalanceAndStaleness(qc);
            
            // If reserves are stale, no capacity available
            if (isStale) {
                return false;
            }
            
            // Check if new minted amount would exceed reserves
            if (currentMinted + amount > reserveBalance) {
                return false;
            }
        }

        // Atomically update the minted amount
        uint256 newMintedAmount = currentMinted + amount;
        qcData.updateQCMintedAmount(qc, newMintedAmount);

        // Emit event for tracking
        emit QCMintedAmountUpdated(
            qc,
            currentMinted,
            newMintedAmount,
            msg.sender,
            block.timestamp
        );

        return true;
    }

    /// @notice Verify QC solvency with proper staleness handling
    /// @param qc The address of the QC to verify
    /// @return solvent True if QC is solvent (false if data is stale)
    /// @dev CRITICAL FIX: Now properly checks and enforces oracle data freshness.
    ///      Stale data is treated as potentially insolvent for safety.
    ///      SECURITY: nonReentrant protects against reentrancy during status updates and external reads
    function verifyQCSolvency(address qc)
        external
        nonReentrant
        returns (bool solvent)
    {
        if (!hasRole(DISPUTE_ARBITER_ROLE, msg.sender)) {
            revert NotAuthorizedForSolvency(msg.sender);
        }

        if (!qcData.isQCRegistered(qc)) {
            revert QCNotRegisteredForSolvency(qc);
        }

        // CRITICAL FIX: Get both reserve balance AND staleness flag
        (uint256 reserveBalance, bool isStale) = QCManagerLib.getReserveBalanceAndStaleness(reserveOracle, qc);
        uint256 mintedAmount = qcData.getQCMintedAmount(qc);

        // CRITICAL FIX: Handle staleness appropriately
        if (isStale) {
            // Data is stale - cannot make accurate solvency determination
            // Treat as potentially insolvent for safety
            solvent = false;

            // If currently Active, change status to UnderReview due to stale data
            if (qcData.getQCStatus(qc) == QCData.QCStatus.Active) {
                bytes32 reason = STALE_DATA_REASON;
                _executeStatusChange(
                    qc,
                    QCData.QCStatus.UnderReview,
                    reason,
                    "STALE_DATA"
                );
            }

            emit SolvencyCheckWithStaleData(
                qc,
                reserveBalance,
                mintedAmount,
                msg.sender,
                block.timestamp
            );
        } else {
            // Data is fresh - perform normal solvency check
            solvent = reserveBalance >= mintedAmount;

            // If insolvent with fresh data, change status to UnderReview
            if (!solvent && qcData.getQCStatus(qc) == QCData.QCStatus.Active) {
                bytes32 reason = UNDERCOLLATERALIZED_REASON;
                _executeStatusChange(
                    qc,
                    QCData.QCStatus.UnderReview,
                    reason,
                    "ARBITER"
                );
            }
        }

        emit SolvencyCheckPerformed(
            qc,
            solvent,
            mintedAmount,
            reserveBalance,
            msg.sender,
            block.timestamp
        );

        return solvent;
    }

    /// @notice Update QC minted amount (for use by minting system)
    /// @dev SECURITY: nonReentrant protects against reentrancy via QCData external calls
    /// @param qc The address of the QC
    /// @param newAmount The new total minted amount
    function updateQCMintedAmount(address qc, uint256 newAmount)
        external
        onlyRole(GOVERNANCE_ROLE)
        nonReentrant
    {
        if (!qcData.isQCRegistered(qc)) {
            revert QCNotRegistered(qc);
        }

        uint256 oldAmount = qcData.getQCMintedAmount(qc);
        qcData.updateQCMintedAmount(qc, newAmount);

        emit QCMintedAmountUpdated(
            qc,
            oldAmount,
            newAmount,
            msg.sender,
            block.timestamp
        );
    }





    /// @dev Get reserve balance and check staleness
    /// @param qc The QC address
    /// @return balance The reserve balance
    /// @return isStale True if the balance is stale
    


    /// @dev Update reserve balance and check solvency
    /// @param qc The QC address
    /// @param newBalance The new reserve balance
    function _updateReserveBalanceAndCheckSolvency(
        address qc,
        uint256 newBalance
    ) private {
        // Update QCReserveLedger and perform solvency check
        uint256 mintedAmount = qcData.getQCMintedAmount(qc);

        // Get old balance before updating
        (uint256 oldBalance, ) = QCManagerLib.getReserveBalanceAndStaleness(reserveOracle, qc);

        // Check solvency before updating
        if (newBalance < mintedAmount) {
            revert QCWouldBecomeInsolvent(newBalance, mintedAmount);
        }

        // NOTE: Reserve balance updates happen through the attestation process
        // in QCReserveLedger, not through direct updates. This function only
        // validates solvency for the wallet deregistration process.

        emit ReserveBalanceUpdated(
            qc,
            oldBalance,
            newBalance,
            msg.sender,
            block.timestamp
        );
    }
    
    // =================== QC SELF-PAUSE FUNCTIONS ===================
    
    /// @notice QC initiates self-pause with chosen level
    /// @param level PauseLevel.MintingOnly or PauseLevel.Complete
    function selfPause(QCData.PauseLevel level) external nonReentrant {
        address qc = msg.sender;
        
        // Validate QC status
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        if (currentStatus != QCData.QCStatus.Active) {
            revert QCNotActive(qc);
        }
        
        // Check pause credit availability
        if (!canSelfPause(qc)) {
            revert("No pause credit available");
        }
        
        // Use renewable pause credit
        _useEmergencyPause(qc, "SELF_MAINTENANCE");
        
        // Set appropriate state based on pause level
        QCData.QCStatus newStatus = (level == QCData.PauseLevel.MintingOnly) ? 
            QCData.QCStatus.MintingPaused : 
            QCData.QCStatus.Paused;
        
        // Update QC status
        QCData.QCStatus oldStatus = qcData.getQCStatus(qc);
        qcData.setQCStatus(qc, newStatus, SELF_PAUSE);
        qcData.setQCSelfPaused(qc, true);
        _syncAccountControlWithStatus(qc, oldStatus, newStatus);
        
        // Track timeout for auto-escalation
        qcPauseTimestamp[qc] = block.timestamp;
        qcCanEarlyResume[qc] = true;
        escalationWarningEmitted[qc] = false;
        
        emit QCSelfPaused(qc, level, newStatus, block.timestamp + SELF_PAUSE_TIMEOUT);
    }
    
    /// @notice QC resumes from self-initiated pause before timeout
    function resumeSelfPause() external nonReentrant {
        address qc = msg.sender;
        
        if (!qcCanEarlyResume[qc]) {
            revert("Cannot early resume");
        }
        
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        if (currentStatus != QCData.QCStatus.MintingPaused && 
            currentStatus != QCData.QCStatus.Paused) {
            revert("Not self-paused");
        }
        
        // Clear pause tracking
        delete qcPauseTimestamp[qc];
        delete qcCanEarlyResume[qc];
        delete escalationWarningEmitted[qc];
        
        // Return to Active status
        qcData.setQCStatus(qc, QCData.QCStatus.Active, EARLY_RESUME);
        qcData.setQCSelfPaused(qc, false);
        _syncAccountControlWithStatus(qc, currentStatus, QCData.QCStatus.Active);

        // Notify pause credit system (emits EarlyResumed event)
        _resumeEarly(qc);
    }
    
    // =================== WATCHDOG INTEGRATION ===================
    
    /// @notice Watchdog checks for QCs requiring auto-escalation
    /// @param qcAddresses Array of QC addresses to check
    function checkQCEscalations(address[] calldata qcAddresses) 
        external 
        onlyRole(MONITOR_ROLE) 
        nonReentrant 
    {
        for (uint256 i = 0; i < qcAddresses.length; i++) {
            address qc = qcAddresses[i];
            
            // Check if QC is eligible for escalation
            QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
            if (currentStatus != QCData.QCStatus.Paused && currentStatus != QCData.QCStatus.MintingPaused) {
                revert QCNotEligibleForEscalation();
            }
            
            // Skip if no pause timestamp
            if (qcPauseTimestamp[qc] == 0) continue;
            
            uint256 timeElapsed = block.timestamp - qcPauseTimestamp[qc];
            
            // Check for warning period (1 hour before escalation) but only if not yet escalated
            if (timeElapsed >= SELF_PAUSE_TIMEOUT - ESCALATION_WARNING_PERIOD && 
                timeElapsed < SELF_PAUSE_TIMEOUT &&
                !escalationWarningEmitted[qc]) {
                uint256 timeRemaining = SELF_PAUSE_TIMEOUT - timeElapsed;
                emit ApproachingEscalation(qc, timeRemaining);
                escalationWarningEmitted[qc] = true;
            }
            
            // Skip if escalation period has not been reached yet
            if (timeElapsed < SELF_PAUSE_TIMEOUT) {
                continue; // Skip this QC, check others
            }
            
            // Perform auto-escalation after 48h
            _performAutoEscalation(qc);
        }
    }
    
    /// @notice Handle redemption default with graduated consequences
    /// @param qc QC that defaulted
    /// @param redemptionId ID of the defaulted redemption
    function handleRedemptionDefault(address qc, bytes32 redemptionId)
        external
        onlyRole(DISPUTE_ARBITER_ROLE)
        nonReentrant
    {
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        QCData.QCStatus newStatus = currentStatus;
        
        // Progressive escalation logic
        if (currentStatus == QCData.QCStatus.Active || 
            currentStatus == QCData.QCStatus.MintingPaused) {
            // First default → UnderReview
            newStatus = QCData.QCStatus.UnderReview;
        } else if (currentStatus == QCData.QCStatus.UnderReview || 
                   currentStatus == QCData.QCStatus.Paused) {
            // Second default → Revoked
            newStatus = QCData.QCStatus.Revoked;
        }
        // Revoked QCs remain revoked
        
        if (newStatus != currentStatus) {
            qcData.setQCStatus(qc, newStatus, DEFAULT_ESCALATION);
            _syncAccountControlWithStatus(qc, currentStatus, newStatus);

            // Clear any self-pause tracking if escalating
            if (qcCanEarlyResume[qc]) {
                delete qcCanEarlyResume[qc];
                delete qcPauseTimestamp[qc];
                qcData.setQCSelfPaused(qc, false);
            }
        }
        
        emit DefaultProcessed(qc, redemptionId, currentStatus, newStatus);
    }
    
    /// @notice Clear QC backlog and potentially restore to Active
    /// @param qc QC address to clear
    function clearQCBacklog(address qc) 
        external 
        onlyRole(DISPUTE_ARBITER_ROLE) 
        nonReentrant 
    {
        // Check for pending redemptions
        if (hasUnfulfilledRedemptions(qc)) {
            revert("Has pending redemptions");
        }
        
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        
        // Only UnderReview QCs can be cleared back to Active
        if (currentStatus == QCData.QCStatus.UnderReview) {
            QCData.QCStatus oldStatus = currentStatus;
            qcData.setQCStatus(qc, QCData.QCStatus.Active, BACKLOG_CLEARED);
            _syncAccountControlWithStatus(qc, oldStatus, QCData.QCStatus.Active);

            // Clear any remaining timeout tracking
            delete qcPauseTimestamp[qc];
            delete qcCanEarlyResume[qc];
            delete escalationWarningEmitted[qc];
            qcData.setQCSelfPaused(qc, false);

            emit BacklogCleared(qc, QCData.QCStatus.Active);
        } else {
            revert InvalidStatus();
        }
    }
    
    // =================== PAUSE CREDIT MANAGEMENT ===================
    
    /// @notice Check if QC can use pause credit
    /// @param qc QC address
    /// @return canPause Whether QC can self-pause
    function canSelfPause(address qc) public view returns (bool canPause) {
        return pauseManager.canSelfPause(qc);
    }
    
    /// @notice Renew pause credit after 90 days
    function renewPauseCredit() external {
        address qc = msg.sender;
        pauseManager.renewPauseCredit(qc);
    }
    
    /// @notice Check and auto-resume if pause expired
    /// @param qc QC address
    function resumeIfExpired(address qc) external {
        pauseManager.resumeIfExpired(qc);
    }
    
    /// @notice Emergency council can clear pause and restore credit
    /// @param qc QC address
    /// @param reason Reason for clearing
    function emergencyClearPause(address qc, string calldata reason) 
        external 
        onlyRole(EMERGENCY_ROLE) 
    {
        pauseManager.emergencyClearPause(qc, reason);
    }
    
    /// @notice Grant initial credit to new QC
    /// @param qc QC address
    function grantInitialCredit(address qc) 
        external 
        onlyRole(EMERGENCY_ROLE) 
    {
        pauseManager.grantInitialCredit(qc);
    }
    
    // =================== VIEW FUNCTIONS FOR CONSOLIDATED STATE ===================
    
    // getQCPauseInfo() removed - use getPauseInfo() for comprehensive pause information
    
    /// @notice Check if QC has unfulfilled redemptions
    /// @param qc QC address
    /// @return hasUnfulfilled Whether QC has pending redemptions
    function hasUnfulfilledRedemptions(address qc) public view returns (bool) {
        if (address(qcRedeemer) == address(0)) return false;
        return qcRedeemer.hasUnfulfilledRedemptions(qc);
    }

    /// @notice Check if a wallet is locked for deregistration
    /// @param btcAddress The Bitcoin wallet address
    /// @return isLocked Whether the wallet is currently locked
    function isWalletDeregistrationLocked(string calldata btcAddress) external view returns (bool) {
        return walletDeregistrationLocks[btcAddress];
    }
    
    /// @notice Check if QC is eligible for escalation
    /// @param qc QC address
    /// @return eligible Whether QC can be escalated
    /// @return timeUntilEscalation Seconds until escalation (0 if ready)
    function isEligibleForEscalation(address qc) external view returns (
        bool eligible,
        uint256 timeUntilEscalation
    ) {
        if (qcPauseTimestamp[qc] == 0) {
            return (false, 0);
        }
        
        uint256 timeElapsed = block.timestamp - qcPauseTimestamp[qc];
        
        if (timeElapsed >= SELF_PAUSE_TIMEOUT) {
            return (true, 0);
        } else {
            return (false, SELF_PAUSE_TIMEOUT - timeElapsed);
        }
    }
    
    /// @notice Get earliest redemption deadline for a QC
    /// @param qc QC address
    /// @return deadline Earliest redemption deadline (0 if none)
    function getEarliestRedemptionDeadline(address qc) 
        public 
        view 
        returns (uint256 deadline) 
    {
        if (address(qcRedeemer) == address(0)) return 0;
        try qcRedeemer.getEarliestRedemptionDeadline(qc) returns (uint256 redemptionDeadline) {
            return redemptionDeadline;
        } catch {
            return 0;
        }
    }
    
    // isSelfPaused() removed - use getPauseInfo() instead

    
    /// @notice Get comprehensive pause credit information for a QC
    /// @param qc QC address
    /// @return isPaused Whether currently paused
    /// @return pauseEndTime When pause expires
    /// @return pauseReason Reason for pause
    /// @return hasCredit Whether credit is available
    /// @return creditRenewTime When credit can be renewed
    function getPauseInfo(address qc) external view returns (
        bool isPaused,
        uint256 pauseEndTime,
        bytes32 pauseReason,
        bool hasCredit,
        uint256 creditRenewTime
    ) {
        return pauseManager.getPauseInfo(qc);
    }
    
    /// @notice Get time until credit renewal is available
    /// @param qc QC address
    /// @return timeUntilRenewal Seconds until renewal (0 if available now)
    function getTimeUntilRenewal(address qc)
        external
        view
        returns (uint256 timeUntilRenewal)
    {
        return pauseManager.getTimeUntilRenewal(qc);
    }
    
    // =================== INTERNAL HELPER FUNCTIONS ===================



    /// @dev Internal function to perform auto-escalation
    function _performAutoEscalation(address qc) private {
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);

        QCData.QCStatus newStatus = QCManagerLib.performAutoEscalationLogic(
            qcData,
            qc,
            AUTO_ESCALATION
        );

        if (newStatus != currentStatus) {
            delete qcCanEarlyResume[qc];
            delete qcPauseTimestamp[qc];
            qcData.setQCSelfPaused(qc, false);

            emit AutoEscalated(qc, currentStatus, newStatus);
        }
    }
    
    /// @dev Internal function to use emergency pause credit
    function _useEmergencyPause(address qc, string memory reason) private {
        pauseManager.useEmergencyPause(qc, reason);
    }
    
    /// @dev Internal function for early resume from pause credit system
    function _resumeEarly(address qc) private {
        pauseManager.resumeEarly(qc);
    }

    // =================== ACCOUNT CONTROL FUNCTIONS ===================

    // Minimal implementation to pass tests - needs production redesign
    function syncBackingFromOracle(address qc) external {
        (uint256 balance, bool isStale) = QCManagerLib.syncBackingFromOracle(
            reserveOracle,
            address(accountControl),
            qc
        );
        emit BackingSyncedFromOracle(qc, balance, isStale);
    }

    function batchSyncBackingFromOracle(address[] calldata qcs) external {
        for (uint256 i = 0; i < qcs.length; i++) {
            if (qcs[i] != address(0)) {
                try this.syncBackingFromOracle(qcs[i]) {} catch {}
            }
        }
    }

    function setAccountControl(address _accountControl) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_accountControl != address(0));
        
        address oldAddress = accountControl;
        accountControl = _accountControl;
        emit AccountControlUpdated(oldAddress, _accountControl, msg.sender, block.timestamp);
    }
}
