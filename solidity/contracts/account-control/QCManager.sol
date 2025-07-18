// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./ProtocolRegistry.sol";
import "./QCData.sol";
import "./SystemState.sol";
import "./QCReserveLedger.sol";
import "../bridge/BitcoinTx.sol";
import "./interfaces/ISPVValidator.sol";

/// @title QCManager
/// @dev Stateless business logic controller for QC management.
/// Contains all business logic for managing QCs, reading from and writing to
/// QCData and SystemState via the central ProtocolRegistry. Manages QC status
/// changes, wallet registration flows, and integrates with role-based access control.
/// V1.1: Simplified with instant governance for all actions, relying on RBAC for security.
///
/// Role definitions:
/// - DEFAULT_ADMIN_ROLE: Can grant/revoke roles and update system configurations
/// - QC_ADMIN_ROLE: Can update minting amounts, request wallet deregistration
/// - REGISTRAR_ROLE: Can register/deregister wallets with SPV verification
/// - ARBITER_ROLE: Can pause QCs, change status, verify solvency (emergency response)
/// - QC_GOVERNANCE_ROLE: Can register QCs and manage minting capacity (instant actions)
contract QCManager is AccessControl {
    bytes32 public constant QC_ADMIN_ROLE = keccak256("QC_ADMIN_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");

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

    // Service keys for ProtocolRegistry
    bytes32 public constant QC_DATA_KEY = keccak256("QC_DATA");
    bytes32 public constant SYSTEM_STATE_KEY = keccak256("SYSTEM_STATE");
    bytes32 public constant QC_RESERVE_LEDGER_KEY =
        keccak256("QC_RESERVE_LEDGER");
    bytes32 public constant SPV_VALIDATOR_KEY = keccak256("SPV_VALIDATOR");

    ProtocolRegistry public immutable protocolRegistry;

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
        uint256 timestamp
    );

    /// @dev Emitted when wallet registration is requested
    event WalletRegistrationRequested(
        address indexed qc,
        string btcAddress,
        address indexed requestedBy,
        uint256 indexed timestamp
    );

    /// @dev Emitted when solvency check is performed
    event SolvencyCheckPerformed(
        address indexed qc,
        bool indexed solvent,
        uint256 mintedAmount,
        uint256 reserveBalance,
        address indexed checkedBy,
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
        bytes32 reason,
        address indexed pausedBy,
        uint256 indexed timestamp
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

    modifier onlyWhenNotPaused(string memory functionName) {
        SystemState systemState = SystemState(
            protocolRegistry.getService(SYSTEM_STATE_KEY)
        );
        require(
            !systemState.isFunctionPaused(functionName),
            "Function is paused"
        );
        _;
    }

    constructor(address _protocolRegistry) {
        protocolRegistry = ProtocolRegistry(_protocolRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(QC_ADMIN_ROLE, msg.sender);
        _grantRole(REGISTRAR_ROLE, msg.sender);
        _grantRole(ARBITER_ROLE, msg.sender);
        _grantRole(QC_GOVERNANCE_ROLE, msg.sender);
    }

    // =================== INSTANT GOVERNANCE FUNCTIONS ===================

    /// @notice Register a new Qualified Custodian (instant action)
    /// @param qc QC address to register
    /// @param maxMintingCap Maximum minting capacity for the QC
    function registerQC(address qc, uint256 maxMintingCap)
        external
        onlyRole(QC_GOVERNANCE_ROLE)
    {
        if (qc == address(0)) {
            revert InvalidQCAddress();
        }
        if (maxMintingCap == 0) {
            revert InvalidMintingCapacity();
        }

        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        if (qcData.isQCRegistered(qc)) {
            revert QCAlreadyRegistered(qc);
        }

        // Register QC with provided minting capacity
        qcData.registerQC(qc, maxMintingCap);

        emit QCRegistrationInitiated(qc, msg.sender, block.timestamp);
        emit QCOnboarded(qc, maxMintingCap, msg.sender, block.timestamp);
    }

    /// @notice Increase minting capacity for existing QC (instant action)
    /// @param qc QC address
    /// @param newCap New minting capacity (must be higher than current)
    function increaseMintingCapacity(address qc, uint256 newCap)
        external
        onlyRole(QC_GOVERNANCE_ROLE)
    {
        if (qc == address(0)) {
            revert InvalidQCAddress();
        }
        if (newCap == 0) {
            revert InvalidMintingCapacity();
        }

        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
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

    /// @notice Change QC status
    /// @param qc The address of the QC
    /// @param newStatus The new status for the QC
    /// @param reason The reason for the status change
    function setQCStatus(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason
    ) external onlyRole(ARBITER_ROLE) onlyWhenNotPaused("registry") {
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        if (!qcData.isQCRegistered(qc)) {
            revert QCNotRegistered(qc);
        }

        QCData.QCStatus oldStatus = qcData.getQCStatus(qc);

        // Validate status transitions
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
            block.timestamp
        );
    }

    /// @notice Register a wallet for a QC (REGISTRAR_ROLE)
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
    {
        if (bytes(btcAddress).length == 0) {
            revert InvalidWalletAddress();
        }

        // Cache QCData service to avoid redundant SLOAD operations
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        if (!qcData.isQCRegistered(qc)) {
            revert QCNotRegistered(qc);
        }
        if (qcData.getQCStatus(qc) != QCData.QCStatus.Active) {
            revert QCNotActive(qc);
        }

        // Verify wallet control using SPV client
        if (!_verifyWalletControl(qc, btcAddress, challenge, txInfo, proof)) {
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
    /// @param btcAddress The Bitcoin address to deregister
    function requestWalletDeRegistration(string calldata btcAddress)
        external
        onlyWhenNotPaused("wallet_registration")
    {
        // Cache QCData service to avoid redundant SLOAD operations
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
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
    /// @param btcAddress The Bitcoin address to finalize deregistration
    /// @param newReserveBalance The new reserve balance after wallet removal
    function finalizeWalletDeRegistration(
        string calldata btcAddress,
        uint256 newReserveBalance
    )
        external
        onlyRole(REGISTRAR_ROLE)
        onlyWhenNotPaused("wallet_registration")
    {
        // Cache QCData service to avoid redundant SLOAD operations
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
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

        // Update reserve balance and perform solvency check
        _updateReserveBalanceAndCheckSolvency(qc, newReserveBalance);

        // If we reach here, QC is solvent - finalize deregistration
        qcData.finalizeWalletDeRegistration(btcAddress);
    }

    /// @notice Get available minting capacity for a QC
    /// @param qc The address of the QC
    /// @return availableCapacity The amount available for minting
    function getAvailableMintingCapacity(address qc)
        external
        view
        returns (uint256 availableCapacity)
    {
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));

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
    function verifyQCSolvency(address qc) external returns (bool solvent) {
        if (!hasRole(ARBITER_ROLE, msg.sender)) {
            revert NotAuthorizedForSolvency(msg.sender);
        }

        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));

        if (!qcData.isQCRegistered(qc)) {
            revert QCNotRegisteredForSolvency(qc);
        }

        (uint256 reserveBalance, ) = _getReserveBalanceAndStaleness(qc);
        uint256 mintedAmount = qcData.getQCMintedAmount(qc);

        solvent = reserveBalance >= mintedAmount;

        // If insolvent, change status to UnderReview
        if (!solvent && qcData.getQCStatus(qc) == QCData.QCStatus.Active) {
            bytes32 reason = "UNDERCOLLATERALIZED";
            qcData.setQCStatus(qc, QCData.QCStatus.UnderReview, reason);
            emit QCStatusChanged(
                qc,
                QCData.QCStatus.Active,
                QCData.QCStatus.UnderReview,
                reason,
                msg.sender,
                block.timestamp
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
    /// @param qc The address of the QC
    /// @param newAmount The new total minted amount
    function updateQCMintedAmount(address qc, uint256 newAmount)
        external
        onlyRole(QC_ADMIN_ROLE)
    {
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
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

    /// @dev Helper to safely get service from protocol registry
    /// @param serviceKey The service key to look up
    /// @return service The service address
    function _getService(bytes32 serviceKey)
        private
        view
        returns (address service)
    {
        service = protocolRegistry.getService(serviceKey);
        if (service == address(0)) {
            revert ServiceNotAvailable(string(abi.encodePacked(serviceKey)));
        }
    }

    /// @dev Validate status transitions according to the simple 3-state model
    /// @param oldStatus The current status
    /// @param newStatus The proposed new status
    /// @return valid True if the transition is valid
    function _isValidStatusTransition(
        QCData.QCStatus oldStatus,
        QCData.QCStatus newStatus
    ) private pure returns (bool valid) {
        // Active ↔ UnderReview, any → Revoked
        if (oldStatus == QCData.QCStatus.Active) {
            return
                newStatus == QCData.QCStatus.UnderReview ||
                newStatus == QCData.QCStatus.Revoked;
        } else if (oldStatus == QCData.QCStatus.UnderReview) {
            return
                newStatus == QCData.QCStatus.Active ||
                newStatus == QCData.QCStatus.Revoked;
        } else if (oldStatus == QCData.QCStatus.Revoked) {
            return false; // No transitions from Revoked
        }
        return false;
    }

    /// @dev Verify wallet control via SPV proof using SPV validator
    /// @dev DESIGN NOTE: We use SPVValidator to access Bridge's SPV infrastructure
    ///      without modifying the production Bridge contract. This maintains the
    ///      same security guarantees while avoiding deployment risks.
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
        // Check if SPV validator service is available
        if (!protocolRegistry.hasService(SPV_VALIDATOR_KEY)) {
            revert SPVValidatorNotAvailable();
        }

        address validatorAddress = protocolRegistry.getService(
            SPV_VALIDATOR_KEY
        );
        ISPVValidator spvValidator = ISPVValidator(validatorAddress);
        return
            spvValidator.verifyWalletControl(
                qc,
                btcAddress,
                challenge,
                txInfo,
                proof
            );
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
        // Check if QCReserveLedger service is available
        if (!protocolRegistry.hasService(QC_RESERVE_LEDGER_KEY)) {
            revert QCReserveLedgerNotAvailable();
        }

        address ledgerAddress = protocolRegistry.getService(
            QC_RESERVE_LEDGER_KEY
        );
        QCReserveLedger reserveLedger = QCReserveLedger(ledgerAddress);
        return reserveLedger.getReserveBalanceAndStaleness(qc);
    }

    /// @dev Update reserve balance and check solvency
    /// @param qc The QC address
    /// @param newBalance The new reserve balance
    function _updateReserveBalanceAndCheckSolvency(
        address qc,
        uint256 newBalance
    ) private {
        // Update QCReserveLedger and perform solvency check
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        uint256 mintedAmount = qcData.getQCMintedAmount(qc);

        // Get old balance before updating
        (uint256 oldBalance, ) = _getReserveBalanceAndStaleness(qc);

        // Check solvency before updating
        if (newBalance < mintedAmount) {
            revert QCWouldBecomeInsolvent(newBalance, mintedAmount);
        }

        // Check if QCReserveLedger service is available
        if (!protocolRegistry.hasService(QC_RESERVE_LEDGER_KEY)) {
            revert QCReserveLedgerNotAvailable();
        }

        // Update reserve ledger with new balance
        address ledgerAddress = protocolRegistry.getService(
            QC_RESERVE_LEDGER_KEY
        );
        QCReserveLedger reserveLedger = QCReserveLedger(ledgerAddress);
        reserveLedger.submitReserveAttestation(qc, newBalance);

        emit ReserveBalanceUpdated(
            qc,
            oldBalance,
            newBalance,
            msg.sender,
            block.timestamp
        );
    }
}
