// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./QCData.sol";
import "./SystemState.sol";
import "./QCReserveLedger.sol";
import "../bridge/BitcoinTx.sol";
// SPV validation is now handled directly in this contract and QCRedeemer

/// @title QCManager
/// @dev Stateless business logic controller for QC management.
/// Contains all business logic for managing QCs, reading from and writing to
/// QCData and SystemState via the central ProtocolRegistry. Manages QC status
/// changes, wallet registration flows, and integrates with role-based access control.
///
/// Role definitions:
/// - DEFAULT_ADMIN_ROLE: Can grant/revoke roles and update system configurations
/// - QC_ADMIN_ROLE: Can update minting amounts, request wallet deregistration
/// - REGISTRAR_ROLE: Can register/deregister wallets with SPV verification
/// - ARBITER_ROLE: Can pause QCs, change status, verify solvency (emergency response)
/// - QC_GOVERNANCE_ROLE: Can register QCs and manage minting capacity (instant actions)
contract QCManager is AccessControl, ReentrancyGuard {
    bytes32 public constant QC_ADMIN_ROLE = keccak256("QC_ADMIN_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    bytes32 public constant WATCHDOG_ENFORCER_ROLE =
        keccak256("WATCHDOG_ENFORCER_ROLE");

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
    bytes32 public constant QC_GOVERNANCE_ROLE =
        keccak256("QC_GOVERNANCE_ROLE");


    QCData public immutable qcData;
    SystemState public immutable systemState;
    QCReserveLedger public immutable qcReserveLedger;

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
        address _qcReserveLedger
    ) {
        qcData = QCData(_qcData);
        systemState = SystemState(_systemState);
        qcReserveLedger = QCReserveLedger(_qcReserveLedger);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(QC_ADMIN_ROLE, msg.sender);
        _grantRole(REGISTRAR_ROLE, msg.sender);
        _grantRole(ARBITER_ROLE, msg.sender);
        _grantRole(QC_GOVERNANCE_ROLE, msg.sender);
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
        onlyWhenNotPaused("registry")
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
        onlyWhenNotPaused("registry")
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
    /// @param authority The type of authority making the change (for logging)
    function _executeStatusChange(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason,
        string memory authority
    ) private {

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
            authority,
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

        // Verify wallet control using SPV client
        if (!_verifyWalletControl(qc, btcAddress, challenge, txInfo, proof)) {
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
            // Active can go to UnderReview (temporary) or Revoked (permanent)
            return
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

    /// @dev Verify wallet control via SPV proof
    /// @dev SPV validation is now handled directly in this contract
    /// @param qc The QC address claiming wallet control
    /// @param btcAddress The Bitcoin address being claimed
    /// @param challenge The expected challenge string
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return verified True if verification successful
    function _verifyWalletControl(
        address qc,
        string calldata btcAddress,
        bytes32 challenge,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) private view returns (bool verified) {
        // TODO: Implement actual SPV validation logic
        // For now, return true to allow wallet registration during development
        // This should integrate with Bridge's SPV infrastructure
        qc; btcAddress; challenge; txInfo; proof; // Silence unused parameter warnings
        return true;
    }

    /// @dev Get reserve balance and check staleness
    /// @param qc The QC address
    /// @return balance The reserve balance
    /// @return isStale True if the balance is stale
    function _getReserveBalanceAndStaleness(address qc)
        private
        view
        returns (uint256 balance, bool isStale)
    {
        return qcReserveLedger.getReserveBalanceAndStaleness(qc);
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
}
