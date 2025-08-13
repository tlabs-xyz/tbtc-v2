// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {BTCUtils} from "@keep-network/bitcoin-spv-sol/contracts/BTCUtils.sol";
import {BytesLib} from "@keep-network/bitcoin-spv-sol/contracts/BytesLib.sol";
import {ValidateSPV} from "@keep-network/bitcoin-spv-sol/contracts/ValidateSPV.sol";
import "./QCData.sol";
import "./SystemState.sol";
import "./ReserveOracle.sol";
import "./SPVState.sol";
import "./BitcoinAddressUtils.sol";
import "../bridge/BitcoinTx.sol";
import "../bridge/IRelay.sol";
import {QCManagerSPV} from "./libraries/QCManagerSPV.sol";

// =================== CONSOLIDATED INTERFACES ===================
// Interfaces for contracts that will be removed in consolidation
interface IQCRedeemer {
    function hasUnfulfilledRedemptions(address qc) external view returns (bool);
    function getEarliestRedemptionDeadline(address qc) external view returns (uint256);
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
/// - QC_ADMIN_ROLE: Can update minting amounts, request wallet deregistration
/// - REGISTRAR_ROLE: Can register/deregister wallets with SPV verification
/// - ARBITER_ROLE: Can pause QCs, change status, verify solvency, handle defaults (emergency response)
/// - WATCHDOG_ENFORCER_ROLE: Can request status changes to UnderReview (limited authority)
/// - QC_GOVERNANCE_ROLE: Can register QCs and manage minting capacity (instant actions)
/// - WATCHDOG_ROLE: Can check QC escalations and trigger auto-escalation
/// - PAUSER_ROLE: Can clear emergency pauses and restore credits
contract QCManager is AccessControl, ReentrancyGuard {
    using BTCUtils for bytes;
    using BTCUtils for uint256;
    using ValidateSPV for bytes;
    using ValidateSPV for bytes32;
    using BytesLib for bytes;
    using SPVState for SPVState.Storage;
    
    bytes32 public constant QC_ADMIN_ROLE = keccak256("QC_ADMIN_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    bytes32 public constant WATCHDOG_ENFORCER_ROLE =
        keccak256("WATCHDOG_ENFORCER_ROLE");
    bytes32 public constant WATCHDOG_ROLE = keccak256("WATCHDOG_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // =================== STATE MANAGEMENT CONSTANTS ===================
    
    uint256 public constant SELF_PAUSE_TIMEOUT = 48 hours;
    uint256 public constant ESCALATION_WARNING_PERIOD = 1 hours;
    
    // Reason codes for state changes
    bytes32 public constant SELF_PAUSE = keccak256("SELF_PAUSE");
    bytes32 public constant EARLY_RESUME = keccak256("EARLY_RESUME");
    bytes32 public constant AUTO_ESCALATION = keccak256("AUTO_ESCALATION");
    bytes32 public constant DEFAULT_ESCALATION = keccak256("DEFAULT_ESCALATION");
    bytes32 public constant BACKLOG_CLEARED = keccak256("BACKLOG_CLEARED");
    
    // =================== PAUSE CREDIT CONSTANTS ===================
    
    uint256 public constant PAUSE_DURATION = 48 hours;
    uint256 public constant RENEWAL_PERIOD = 90 days;
    uint256 public constant MIN_REDEMPTION_BUFFER = 8 hours;

    // Custom errors for gas-efficient reverts
    error InvalidQCAddress();
    error InvalidMintingCapacity();
    error QCAlreadyRegistered(address qc);
    error InvalidWalletAddress();
    error QCNotRegistered(address qc);
    error QCNotActive(address qc);
    error SPVVerificationFailed();
    error NotAuthorizedForSolvency(address caller);
    error QCNotRegisteredForSolvency(address qc);
    error ReasonRequired();
    error InvalidStatusTransition(
        QCData.QCStatus oldStatus,
        QCData.QCStatus newStatus
    );
    error NewCapMustBeHigher(uint256 currentCap, uint256 newCap);
    error WalletNotRegistered(string btcAddress);
    error NotAuthorizedForWalletDeregistration(address caller);
    error WalletNotActive(string btcAddress);
    error WalletNotPendingDeregistration(string btcAddress);
    error QCWouldBecomeInsolvent(uint256 newBalance, uint256 mintedAmount);
    error QCReserveLedgerNotAvailable();
    error SPVValidatorNotAvailable();
    error ServiceNotAvailable(string service);
    error InvalidRelayAddress();
    // SPV-related errors moved to QCManagerSPV library (including RelayNotSet)
    
    // =================== STATE MANAGEMENT ERRORS ===================
    
    error NoPauseCredit();
    error AlreadyPaused();
    error NotSelfPaused();
    error CannotEarlyResume();
    error InvalidPauseLevel();
    error HasPendingRedemptions();
    error InvalidStatus();
    error NotEligibleForEscalation();
    
    // =================== PAUSE CREDIT ERRORS ===================
    
    error NoPauseCreditAvailable();
    error PauseReasonRequired();
    error WouldBreachRedemptionDeadline();
    error NotPaused();
    error PauseNotExpired();
    error CreditAlreadyAvailable();
    error NeverUsedCredit();
    error RenewalPeriodNotMet();
    error QCAlreadyInitialized();
    error QCNotEligibleForEscalation();
    error EscalationPeriodNotReached();
    error OnlyStateManager();
    
    bytes32 public constant QC_GOVERNANCE_ROLE =
        keccak256("QC_GOVERNANCE_ROLE");

    // =================== ENUMS AND STRUCTS ===================
    
    /// @dev Pause level selection for QC self-pause
    enum PauseLevel {
        MintingOnly,    // Pause minting but allow fulfillment
        Complete        // Pause all operations
    }
    
    /// @dev Pause credit information for each QC
    struct PauseCredit {
        bool hasCredit;              // Can QC pause themselves?
        uint256 lastUsed;            // When last used (0 = never)
        uint256 creditRenewTime;     // When credit can be renewed
        bool isPaused;               // Currently paused?
        uint256 pauseEndTime;        // When pause expires
        bytes32 pauseReason;         // Why paused
    }

    QCData public immutable qcData;
    SystemState public immutable systemState;
    ReserveOracle public immutable reserveOracle;
    
    // SPV validation storage
    SPVState.Storage internal spvState;
    
    // =================== STATE MANAGEMENT STORAGE ===================
    
    /// @dev Track QC self-pause timeouts for auto-escalation
    mapping(address => uint256) public qcPauseTimestamp;
    
    /// @dev Track if QC can early resume (only for self-initiated pauses)
    mapping(address => bool) public qcCanEarlyResume;
    
    /// @dev Track if escalation warning has been emitted
    mapping(address => bool) public escalationWarningEmitted;
    
    // =================== PAUSE CREDIT STORAGE ===================
    
    mapping(address => PauseCredit) public pauseCredits;
    
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

    /// @dev Emitted when wallet deregistration is completed with reserve balance details
    event WalletDeregistrationCompleted(
        address indexed qc,
        string btcAddress,
        uint256 newReserveBalance,
        uint256 previousReserveBalance
    );

    /// @dev Emitted when wallet registration fails
    event WalletRegistrationFailed(
        address indexed qc,
        string btcAddress,
        string reason,
        address attemptedBy
    );
    
    // =================== STATE MANAGEMENT EVENTS ===================
    
    event QCSelfPaused(
        address indexed qc,
        PauseLevel level,
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
    
    // =================== PAUSE CREDIT EVENTS ===================
    
    event PauseCreditUsed(
        address indexed qc,
        bytes32 reason,
        uint256 duration
    );
    
    event PauseCreditRenewed(
        address indexed qc,
        uint256 nextRenewalTime
    );
    
    event PauseExpired(
        address indexed qc
    );
    
    event EmergencyCleared(
        address indexed qc,
        address indexed clearedBy,
        bytes32 reason
    );
    
    event EarlyResumed(
        address indexed qc,
        address indexed resumedBy  // Added for consolidation
    );
    
    event InitialCreditGranted(
        address indexed qc,
        address indexed grantedBy
    );

    modifier onlyWhenNotPaused(string memory functionName) {
        require(
            !systemState.isFunctionPaused(functionName),
            "Function is paused"
        );
        _;
    }

    constructor(
        address _qcData,
        address _systemState,
        address _reserveOracle,
        address _relay,
        uint96 _txProofDifficultyFactor
    ) {
        qcData = QCData(_qcData);
        systemState = SystemState(_systemState);
        reserveOracle = ReserveOracle(_reserveOracle);
        
        // Initialize SPV state
        spvState.initialize(_relay, _txProofDifficultyFactor);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(QC_ADMIN_ROLE, msg.sender);
        _grantRole(REGISTRAR_ROLE, msg.sender);
        _grantRole(ARBITER_ROLE, msg.sender);
        _grantRole(QC_GOVERNANCE_ROLE, msg.sender);
        _grantRole(WATCHDOG_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }
    
    /// @notice Set QCRedeemer contract reference (temporary until full consolidation)
    /// @param _qcRedeemer Address of the QCRedeemer contract
    function setQCRedeemer(address _qcRedeemer) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        qcRedeemer = IQCRedeemer(_qcRedeemer);
    }
    
    // =================== SPV CONFIGURATION FUNCTIONS ===================
    
    /// @notice Update the Bitcoin relay address
    /// @param _relay New relay address
    function setRelay(address _relay) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        spvState.setRelay(_relay);
    }
    
    /// @notice Update the transaction proof difficulty factor
    /// @param _txProofDifficultyFactor New difficulty factor
    function setTxProofDifficultyFactor(uint96 _txProofDifficultyFactor) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        spvState.setTxProofDifficultyFactor(_txProofDifficultyFactor);
    }
    
    /// @notice Get current SPV parameters
    /// @return relay The current relay address
    /// @return difficultyFactor The current difficulty factor
    function getSPVParameters() 
        external 
        view 
        returns (address relay, uint96 difficultyFactor) 
    {
        return spvState.getParameters();
    }

    // =================== INSTANT GOVERNANCE FUNCTIONS ===================

    /// @notice Register a new Qualified Custodian (instant action)
    /// @dev SECURITY: nonReentrant protects against reentrancy via QCData external calls
    /// @param qc QC address to register
    /// @param maxMintingCap Maximum minting capacity for the QC
    function registerQC(address qc, uint256 maxMintingCap)
        external
        onlyRole(QC_GOVERNANCE_ROLE)
        nonReentrant
    {
        if (qc == address(0)) {
            revert InvalidQCAddress();
        }
        if (maxMintingCap == 0) {
            revert InvalidMintingCapacity();
        }

        if (qcData.isQCRegistered(qc)) {
            revert QCAlreadyRegistered(qc);
        }

        // Register QC with provided minting capacity
        qcData.registerQC(qc, maxMintingCap);

        emit QCRegistrationInitiated(qc, msg.sender, block.timestamp);
        emit QCOnboarded(qc, maxMintingCap, msg.sender, block.timestamp);
    }

    /// @notice Increase minting capacity for existing QC (instant action)
    /// @dev SECURITY: nonReentrant protects against reentrancy via QCData external calls
    /// @param qc QC address
    /// @param newCap New minting capacity (must be higher than current)
    function increaseMintingCapacity(address qc, uint256 newCap)
        external
        onlyRole(QC_GOVERNANCE_ROLE)
        nonReentrant
    {
        if (qc == address(0)) {
            revert InvalidQCAddress();
        }
        if (newCap == 0) {
            revert InvalidMintingCapacity();
        }

        if (!qcData.isQCRegistered(qc)) {
            revert QCNotRegistered(qc);
        }

        uint256 currentCap = qcData.getMaxMintingCapacity(qc);
        if (newCap <= currentCap) {
            revert NewCapMustBeHigher(currentCap, newCap);
        }

        qcData.updateMaxMintingCapacity(qc, newCap);

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

    /// @notice Change QC status with full authority (ARBITER_ROLE only)
    /// @dev ARBITER_ROLE has full authority to make any valid status transition.
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
        onlyRole(ARBITER_ROLE)
        nonReentrant
    {
        _executeStatusChange(qc, newStatus, reason, "ARBITER");
    }

    /// @notice Request status change from WatchdogEnforcer (WATCHDOG_ENFORCER_ROLE only)
    /// @dev WATCHDOG_ENFORCER_ROLE has LIMITED authority - can ONLY set QCs to UnderReview.
    ///      This design provides automated detection with human oversight:
    ///      - Watchdog detects objective violations (insufficient reserves, stale attestations)
    ///      - Sets QC to UnderReview (temporary suspension) to prevent further minting
    ///      - Human governance (ARBITER_ROLE) reviews and decides final outcome
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
        onlyRole(WATCHDOG_ENFORCER_ROLE)
        nonReentrant
    {
        // AUTHORITY VALIDATION: WatchdogEnforcer can only set QCs to UnderReview
        require(
            newStatus == QCData.QCStatus.UnderReview,
            "WatchdogEnforcer can only set UnderReview status"
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
    /// @dev authority parameter removed to fix docstring parsing error
    function _executeStatusChange(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason,
        string memory /* authority */
    ) private {
        if (reason == bytes32(0)) {
            revert ReasonRequired();
        }

        if (!qcData.isQCRegistered(qc)) {
            revert QCNotRegistered(qc);
        }

        QCData.QCStatus oldStatus = qcData.getQCStatus(qc);

        // Validate status transitions according to state machine rules
        if (!_isValidStatusTransition(oldStatus, newStatus)) {
            revert InvalidStatusTransition(oldStatus, newStatus);
        }

        qcData.setQCStatus(qc, newStatus, reason);

        emit QCStatusChanged(
            qc,
            oldStatus,
            newStatus,
            reason,
            msg.sender,
            "AUTHORITY",
            block.timestamp
        );
    }

    /// @notice Register a wallet for a QC (REGISTRAR_ROLE)
    /// @dev SECURITY: nonReentrant protects against reentrancy via SPVValidator and QCData external calls
    /// @param qc The address of the QC
    /// @param btcAddress The Bitcoin address to register
    /// @param challenge The challenge bytes that should be in OP_RETURN
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    function registerWallet(
        address qc,
        string calldata btcAddress,
        bytes32 challenge,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    )
        external
        onlyRole(REGISTRAR_ROLE)
        onlyWhenNotPaused("wallet_registration")
        nonReentrant
    {
        if (bytes(btcAddress).length == 0) {
            emit WalletRegistrationFailed(
                qc,
                btcAddress,
                "INVALID_WALLET_ADDRESS",
                msg.sender
            );
            revert InvalidWalletAddress();
        }

        // Cache QCData service to avoid redundant SLOAD operations
        if (!qcData.isQCRegistered(qc)) {
            emit WalletRegistrationFailed(
                qc,
                btcAddress,
                "QC_NOT_REGISTERED",
                msg.sender
            );
            revert QCNotRegistered(qc);
        }
        if (qcData.getQCStatus(qc) != QCData.QCStatus.Active) {
            emit WalletRegistrationFailed(
                qc,
                btcAddress,
                "QC_NOT_ACTIVE",
                msg.sender
            );
            revert QCNotActive(qc);
        }

        // Verify wallet control using SPV client library
        if (!QCManagerSPV.verifyWalletControl(spvState, btcAddress, challenge, txInfo, proof)) {
            emit WalletRegistrationFailed(
                qc,
                btcAddress,
                "SPV_VERIFICATION_FAILED",
                msg.sender
            );
            revert SPVVerificationFailed();
        }

        qcData.registerWallet(qc, btcAddress);

        emit WalletRegistrationRequested(
            qc,
            btcAddress,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Request wallet deregistration
    /// @dev SECURITY: nonReentrant protects against reentrancy via QCData external calls
    /// @param btcAddress The Bitcoin address to deregister
    function requestWalletDeRegistration(string calldata btcAddress)
        external
        onlyWhenNotPaused("wallet_registration")
        nonReentrant
    {
        // Cache QCData service to avoid redundant SLOAD operations
        address qc = qcData.getWalletOwner(btcAddress);

        if (qc == address(0)) {
            revert WalletNotRegistered(btcAddress);
        }
        if (msg.sender != qc && !hasRole(QC_ADMIN_ROLE, msg.sender)) {
            revert NotAuthorizedForWalletDeregistration(msg.sender);
        }
        if (qcData.getWalletStatus(btcAddress) != QCData.WalletStatus.Active) {
            revert WalletNotActive(btcAddress);
        }

        qcData.requestWalletDeRegistration(btcAddress);
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
        onlyWhenNotPaused("wallet_registration")
        nonReentrant
    {
        // Cache QCData service to avoid redundant SLOAD operations
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
        (uint256 oldBalance, ) = _getReserveBalanceAndStaleness(qc);

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

        // Check if QC is active
        if (qcData.getQCStatus(qc) != QCData.QCStatus.Active) {
            return 0;
        }

        // Get reserve balance and check if stale
        (uint256 reserveBalance, bool isStale) = _getReserveBalanceAndStaleness(
            qc
        );
        if (isStale) {
            return 0;
        }

        uint256 mintedAmount = qcData.getQCMintedAmount(qc);

        // Available capacity = reserves - minted amount
        if (reserveBalance > mintedAmount) {
            return reserveBalance - mintedAmount;
        }

        return 0;
    }

    /// @notice Verify QC solvency
    /// @param qc The address of the QC to verify
    /// @return solvent True if QC is solvent
    /// @dev NOTE: This function ignores staleness of reserve proofs, unlike getAvailableMintingCapacity.
    ///      This means a QC with stale reserves can still be marked as solvent if their last known
    ///      balance covers minted amount. This is intentional to avoid false insolvency triggers
    ///      due to temporary communication issues, but creates potential for manipulation.
    ///      SECURITY: nonReentrant protects against reentrancy during status updates and external reads
    function verifyQCSolvency(address qc)
        external
        nonReentrant
        returns (bool solvent)
    {
        if (!hasRole(ARBITER_ROLE, msg.sender)) {
            revert NotAuthorizedForSolvency(msg.sender);
        }


        if (!qcData.isQCRegistered(qc)) {
            revert QCNotRegisteredForSolvency(qc);
        }

        (uint256 reserveBalance, ) = _getReserveBalanceAndStaleness(qc);
        uint256 mintedAmount = qcData.getQCMintedAmount(qc);

        solvent = reserveBalance >= mintedAmount;

        // If insolvent, change status to UnderReview
        if (!solvent && qcData.getQCStatus(qc) == QCData.QCStatus.Active) {
            bytes32 reason = keccak256("UNDERCOLLATERALIZED");
            _executeStatusChange(
                qc,
                QCData.QCStatus.UnderReview,
                reason,
                "ARBITER"
            );
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
        onlyRole(QC_ADMIN_ROLE)
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


    /// @notice Validate status transitions according to business state machine rules
    /// @dev STATE MACHINE RULES:
    ///      - Active ↔ UnderReview (bidirectional)
    ///      - Active → Revoked (terminal)
    ///      - UnderReview → Revoked (terminal)
    ///      - Revoked → (nothing) (terminal state)
    /// @param oldStatus The current status
    /// @param newStatus The requested new status
    /// @return valid True if the transition is allowed
    function _isValidStatusTransition(
        QCData.QCStatus oldStatus,
        QCData.QCStatus newStatus
    ) private pure returns (bool valid) {
        // No-op transitions are always valid
        if (oldStatus == newStatus) return true;

        // Define valid transitions based on current state
        if (oldStatus == QCData.QCStatus.Active) {
            // Active can transition to any other state
            return
                newStatus == QCData.QCStatus.MintingPaused ||
                newStatus == QCData.QCStatus.Paused ||
                newStatus == QCData.QCStatus.UnderReview ||
                newStatus == QCData.QCStatus.Revoked;
        } else if (oldStatus == QCData.QCStatus.MintingPaused) {
            // MintingPaused can go to:
            // - Active (resume operations)
            // - Paused (escalate to full pause)
            // - UnderReview (watchdog/auto-escalation)
            // - Revoked (governance decision)
            return
                newStatus == QCData.QCStatus.Active ||
                newStatus == QCData.QCStatus.Paused ||
                newStatus == QCData.QCStatus.UnderReview ||
                newStatus == QCData.QCStatus.Revoked;
        } else if (oldStatus == QCData.QCStatus.Paused) {
            // Paused can go to:
            // - Active (resume operations)
            // - MintingPaused (partial resume)
            // - UnderReview (watchdog/auto-escalation)
            // - Revoked (governance decision)
            return
                newStatus == QCData.QCStatus.Active ||
                newStatus == QCData.QCStatus.MintingPaused ||
                newStatus == QCData.QCStatus.UnderReview ||
                newStatus == QCData.QCStatus.Revoked;
        } else if (oldStatus == QCData.QCStatus.UnderReview) {
            // UnderReview can go back to Active (resolved) or to Revoked (permanent)
            return
                newStatus == QCData.QCStatus.Active ||
                newStatus == QCData.QCStatus.Revoked;
        } else if (oldStatus == QCData.QCStatus.Revoked) {
            // Terminal state - no transitions allowed
            return false;
        }
        return false;
    }

    // SPV validation functions moved to QCManagerSPV library to reduce contract size
    // The following functions were removed:
    // - _verifyWalletControl() - now in QCManagerSPV.verifyWalletControl()
    // - _evaluateProofDifficulty() - now in library
    // - _validateWalletControlProof() - now in library
    // - _decodeAndValidateBitcoinAddress() - now in library
    // - _isValidBitcoinAddress() - now in library
    // - _findChallengeInOpReturn() - now in library
    // - _verifyTransactionSignature() - now in library

    /// @dev Get reserve balance and check staleness
    /// @param qc The QC address
    /// @return balance The reserve balance
    /// @return isStale True if the balance is stale
    function _getReserveBalanceAndStaleness(address qc)
        private
        view
        returns (uint256 balance, bool isStale)
    {
        return reserveOracle.getReserveBalanceAndStaleness(qc);
    }
    
    /// @notice Check if SPV validation is properly configured
    /// @return isConfigured True if SPV state is initialized
    function isSPVConfigured() external view returns (bool isConfigured) {
        return spvState.isInitialized();
    }

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
        (uint256 oldBalance, ) = _getReserveBalanceAndStaleness(qc);

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
    function selfPause(PauseLevel level) external nonReentrant {
        address qc = msg.sender;
        
        // Validate QC status
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        if (currentStatus != QCData.QCStatus.Active) {
            revert QCNotActive(qc);
        }
        
        // Check pause credit availability
        if (!canSelfPause(qc)) {
            revert NoPauseCredit();
        }
        
        // Use renewable pause credit
        _useEmergencyPause(qc, "SELF_MAINTENANCE");
        
        // Set appropriate state based on pause level
        QCData.QCStatus newStatus = (level == PauseLevel.MintingOnly) ? 
            QCData.QCStatus.MintingPaused : 
            QCData.QCStatus.Paused;
        
        // Update QC status
        qcData.setQCStatus(qc, newStatus, SELF_PAUSE);
        qcData.setQCSelfPaused(qc, true);
        
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
            revert CannotEarlyResume();
        }
        
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        if (currentStatus != QCData.QCStatus.MintingPaused && 
            currentStatus != QCData.QCStatus.Paused) {
            revert NotSelfPaused();
        }
        
        // Clear pause tracking
        delete qcPauseTimestamp[qc];
        delete qcCanEarlyResume[qc];
        delete escalationWarningEmitted[qc];
        
        // Return to Active status
        qcData.setQCStatus(qc, QCData.QCStatus.Active, EARLY_RESUME);
        qcData.setQCSelfPaused(qc, false);
        
        // Notify pause credit system
        _resumeEarly(qc);
        
        emit EarlyResumed(qc, qc);
    }
    
    // =================== WATCHDOG INTEGRATION ===================
    
    /// @notice Watchdog checks for QCs requiring auto-escalation
    /// @param qcAddresses Array of QC addresses to check
    function checkQCEscalations(address[] calldata qcAddresses) 
        external 
        onlyRole(WATCHDOG_ROLE) 
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
            
            // Check if escalation period has been reached
            if (timeElapsed < SELF_PAUSE_TIMEOUT) {
                revert EscalationPeriodNotReached();
            }
            
            // Check for warning period (1 hour before escalation) but only if not yet escalated
            if (timeElapsed >= SELF_PAUSE_TIMEOUT - ESCALATION_WARNING_PERIOD && 
                timeElapsed < SELF_PAUSE_TIMEOUT &&
                !escalationWarningEmitted[qc]) {
                uint256 timeRemaining = SELF_PAUSE_TIMEOUT - timeElapsed;
                emit ApproachingEscalation(qc, timeRemaining);
                escalationWarningEmitted[qc] = true;
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
        onlyRole(ARBITER_ROLE)
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
        onlyRole(ARBITER_ROLE) 
        nonReentrant 
    {
        // Check for pending redemptions
        if (hasUnfulfilledRedemptions(qc)) {
            revert HasPendingRedemptions();
        }
        
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        
        // Only UnderReview QCs can be cleared back to Active
        if (currentStatus == QCData.QCStatus.UnderReview) {
            qcData.setQCStatus(qc, QCData.QCStatus.Active, BACKLOG_CLEARED);
            
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
        PauseCredit memory credit = pauseCredits[qc];
        
        // Must have credit and not be currently paused
        if (!credit.hasCredit || credit.isPaused) {
            return false;
        }
        
        // Check QC is active
        try qcData.getQCStatus(qc) returns (QCData.QCStatus status) {
            if (status != QCData.QCStatus.Active) {
                return false;
            }
        } catch {
            return false;
        }
        
        // Check redemption deadline protection
        uint256 earliestDeadline = getEarliestRedemptionDeadline(qc);
        if (earliestDeadline > 0 && 
            earliestDeadline < block.timestamp + PAUSE_DURATION + MIN_REDEMPTION_BUFFER) {
            return false;
        }
        
        return true;
    }
    
    /// @notice Renew pause credit after 90 days
    function renewPauseCredit() external {
        address qc = msg.sender;
        PauseCredit storage credit = pauseCredits[qc];
        
        // Validate conditions
        QCData.QCStatus status = qcData.getQCStatus(qc);
        if (status != QCData.QCStatus.Active) revert QCNotActive(qc);
        if (credit.hasCredit) revert CreditAlreadyAvailable();
        if (credit.lastUsed == 0) revert NeverUsedCredit();
        if (block.timestamp < credit.creditRenewTime) revert RenewalPeriodNotMet();
        
        // Renew credit
        credit.hasCredit = true;
        credit.creditRenewTime = 0;
        
        emit PauseCreditRenewed(qc, block.timestamp + RENEWAL_PERIOD);
    }
    
    /// @notice Check and auto-resume if pause expired
    /// @param qc QC address
    function resumeIfExpired(address qc) external {
        PauseCredit storage credit = pauseCredits[qc];
        
        if (!credit.isPaused) revert NotPaused();
        if (block.timestamp < credit.pauseEndTime) revert PauseNotExpired();
        
        // Clear pause state
        credit.isPaused = false;
        credit.pauseEndTime = 0;
        credit.pauseReason = bytes32(0);
        
        emit PauseExpired(qc);
    }
    
    /// @notice Emergency council can clear pause and restore credit
    /// @param qc QC address
    /// @param reason Reason for clearing
    function emergencyClearPause(address qc, string calldata reason) 
        external 
        onlyRole(PAUSER_ROLE) 
    {
        PauseCredit storage credit = pauseCredits[qc];
        
        // Clear pause state
        credit.isPaused = false;
        credit.pauseEndTime = 0;
        credit.pauseReason = bytes32(0);
        
        // Optionally restore credit if it was consumed
        if (!credit.hasCredit && credit.lastUsed > 0) {
            credit.hasCredit = true;
            credit.creditRenewTime = 0;
        }
        
        emit EmergencyCleared(qc, msg.sender, keccak256(bytes(reason)));
    }
    
    /// @notice Grant initial credit to new QC
    /// @param qc QC address
    function grantInitialCredit(address qc) 
        external 
        onlyRole(PAUSER_ROLE) 
    {
        // Verify QC is registered
        if (!qcData.isQCRegistered(qc)) {
            revert QCNotRegistered(qc);
        }
        
        if (pauseCredits[qc].lastUsed != 0) revert QCAlreadyInitialized();
        
        pauseCredits[qc].hasCredit = true;
        
        emit InitialCreditGranted(qc, msg.sender);
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
        try qcRedeemer.getEarliestRedemptionDeadline(qc) returns (uint256 deadline) {
            return deadline;
        } catch {
            return 0;
        }
    }
    
    // isSelfPaused() removed - use getPauseInfo() instead
    // getSPVState() removed - use getSPVParameters() and isSPVConfigured() instead
    
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
        PauseCredit memory credit = pauseCredits[qc];
        return (
            credit.isPaused,
            credit.pauseEndTime,
            credit.pauseReason,
            credit.hasCredit,
            credit.creditRenewTime
        );
    }
    
    /// @notice Get time until credit renewal is available
    /// @param qc QC address
    /// @return timeUntilRenewal Seconds until renewal (0 if available now)
    function getTimeUntilRenewal(address qc) 
        external 
        view 
        returns (uint256 timeUntilRenewal) 
    {
        PauseCredit memory credit = pauseCredits[qc];
        
        if (credit.hasCredit || credit.lastUsed == 0) {
            return 0;
        }
        
        if (block.timestamp >= credit.creditRenewTime) {
            return 0;
        }
        
        return credit.creditRenewTime - block.timestamp;
    }
    
    // =================== INTERNAL HELPER FUNCTIONS ===================
    
    /// @dev Internal function to perform auto-escalation
    function _performAutoEscalation(address qc) private {
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        
        // Auto-escalate based on current state
        if (currentStatus == QCData.QCStatus.MintingPaused || 
            currentStatus == QCData.QCStatus.Paused) {
            
            // Escalate to UnderReview
            qcData.setQCStatus(qc, QCData.QCStatus.UnderReview, AUTO_ESCALATION);
            
            // Clear early resume capability
            delete qcCanEarlyResume[qc];
            delete qcPauseTimestamp[qc];
            qcData.setQCSelfPaused(qc, false);
            
            emit AutoEscalated(qc, currentStatus, QCData.QCStatus.UnderReview);
        }
    }
    
    /// @dev Internal function to use emergency pause credit
    function _useEmergencyPause(address qc, string memory reason) private {
        PauseCredit storage credit = pauseCredits[qc];
        
        // Validate conditions
        if (!credit.hasCredit) revert NoPauseCreditAvailable();
        if (credit.isPaused) revert AlreadyPaused();
        if (bytes(reason).length == 0) revert ReasonRequired();
        
        // Check QC status
        QCData.QCStatus status = qcData.getQCStatus(qc);
        if (status != QCData.QCStatus.Active) revert QCNotActive(qc);
        
        // Deadline protection
        uint256 earliestDeadline = getEarliestRedemptionDeadline(qc);
        if (earliestDeadline > 0 && 
            earliestDeadline < block.timestamp + PAUSE_DURATION + MIN_REDEMPTION_BUFFER) {
            revert WouldBreachRedemptionDeadline();
        }
        
        // Consume credit and set pause
        credit.hasCredit = false;
        credit.lastUsed = block.timestamp;
        credit.creditRenewTime = block.timestamp + RENEWAL_PERIOD;
        credit.isPaused = true;
        credit.pauseEndTime = block.timestamp + PAUSE_DURATION;
        credit.pauseReason = keccak256(bytes(reason));
        
        emit PauseCreditUsed(qc, credit.pauseReason, PAUSE_DURATION);
    }
    
    /// @dev Internal function for early resume from pause credit system
    function _resumeEarly(address qc) private {
        PauseCredit storage credit = pauseCredits[qc];
        
        // Clear pause state
        credit.isPaused = false;
        credit.pauseEndTime = 0;
        credit.pauseReason = bytes32(0);
        
        emit EarlyResumed(qc, msg.sender);
    }
}
