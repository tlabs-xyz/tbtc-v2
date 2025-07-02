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
/// changes, wallet registration flows, and integrates with single Watchdog model.
/// V1.1: Enhanced with time-locked governance for critical actions while preserving
/// instant emergency response capabilities.
contract QCManager is AccessControl {
    bytes32 public constant QC_ADMIN_ROLE = keccak256("QC_ADMIN_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");

    // Custom errors for gas-efficient reverts
    error InvalidQCAddress();
    error InvalidMintingCapacity();
    error QCAlreadyRegistered(address qc);
    error ActionAlreadyQueued(bytes32 actionHash);
    error InvalidWalletAddress();
    error QCNotRegistered(address qc);
    error QCNotActive(address qc);
    error SPVVerificationFailed();
    error NotAuthorizedForSolvency(address caller);
    error QCNotRegisteredForSolvency(address qc);
    error ActionNotQueued(bytes32 actionHash);
    error DelayPeriodNotElapsed(uint256 executeAfter, uint256 currentTime);
    error ActionAlreadyExecuted(bytes32 actionHash);
    error ReasonRequired();
    error InvalidStatusTransition(QCData.QCStatus oldStatus, QCData.QCStatus newStatus);
    error NewCapMustBeHigher(uint256 currentCap, uint256 newCap);
    error WalletNotRegistered(string btcAddress);
    error NotAuthorizedForWalletDeregistration(address caller);
    error WalletNotActive(string btcAddress);
    error WalletNotPendingDeregistration(string btcAddress);
    error QCWouldBecomeInsolvent(uint256 newBalance, uint256 mintedAmount);
    error QCReserveLedgerNotAvailable();
    error SPVValidatorNotAvailable();
    bytes32 public constant TIME_LOCKED_ADMIN_ROLE =
        keccak256("TIME_LOCKED_ADMIN_ROLE");

    // Service keys for ProtocolRegistry
    bytes32 public constant QC_DATA_KEY = keccak256("QC_DATA");
    bytes32 public constant SYSTEM_STATE_KEY = keccak256("SYSTEM_STATE");
    bytes32 public constant QC_RESERVE_LEDGER_KEY =
        keccak256("QC_RESERVE_LEDGER");
    bytes32 public constant SPV_VALIDATOR_KEY = keccak256("SPV_VALIDATOR");

    /// @dev Governance delay for critical actions (7 days)
    uint256 public constant GOVERNANCE_DELAY = 7 days;

    ProtocolRegistry public immutable protocolRegistry;

    /// @dev Structure for tracking pending governance actions
    struct PendingAction {
        bytes32 actionHash;
        uint256 executeAfter;
        bool executed;
    }

    /// @dev Mapping to track pending governance actions
    mapping(bytes32 => PendingAction) public pendingActions;

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

    // =================== TIME-LOCKED GOVERNANCE EVENTS ===================

    /// @dev Emitted when a governance action is queued
    event GovernanceActionQueued(
        bytes32 indexed actionHash,
        uint256 indexed executeAfter,
        string actionType,
        address indexed queuedBy,
        uint256 timestamp
    );

    /// @dev Emitted when a governance action is executed
    event GovernanceActionExecuted(
        bytes32 indexed actionHash,
        string actionType,
        address indexed executedBy,
        uint256 indexed timestamp
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
        _grantRole(TIME_LOCKED_ADMIN_ROLE, msg.sender);
    }

    // =================== TIME-LOCKED GOVERNANCE FUNCTIONS ===================

    /// @notice Queue QC onboarding (requires 7-day delay)
    /// @param qc QC address to onboard
    /// @param maxMintingCap Maximum minting capacity for the QC
    function queueQCOnboarding(address qc, uint256 maxMintingCap)
        external
        onlyRole(TIME_LOCKED_ADMIN_ROLE)
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

        bytes32 actionHash = keccak256(
            abi.encodePacked("QC_ONBOARDING", qc, maxMintingCap)
        );
        if (pendingActions[actionHash].executeAfter != 0) {
            revert ActionAlreadyQueued(actionHash);
        }

        uint256 executeAfter = block.timestamp + GOVERNANCE_DELAY;

        pendingActions[actionHash] = PendingAction({
            actionHash: actionHash,
            executeAfter: executeAfter,
            executed: false
        });

        emit GovernanceActionQueued(
            actionHash,
            executeAfter,
            "QC_ONBOARDING",
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Execute QC onboarding after delay period
    /// @param qc QC address to onboard
    /// @param maxMintingCap Maximum minting capacity for the QC
    function executeQCOnboarding(address qc, uint256 maxMintingCap)
        external
        onlyRole(TIME_LOCKED_ADMIN_ROLE)
    {
        bytes32 actionHash = keccak256(
            abi.encodePacked("QC_ONBOARDING", qc, maxMintingCap)
        );
        PendingAction storage action = pendingActions[actionHash];

        if (action.executeAfter == 0) {
            revert ActionNotQueued(actionHash);
        }
        if (block.timestamp < action.executeAfter) {
            revert DelayPeriodNotElapsed(action.executeAfter, block.timestamp);
        }
        if (action.executed) {
            revert ActionAlreadyExecuted(actionHash);
        }

        // Mark as executed before external calls
        action.executed = true;

        // Execute QC registration
        _registerQC(qc, maxMintingCap);

        emit GovernanceActionExecuted(
            actionHash,
            "QC_ONBOARDING",
            msg.sender,
            block.timestamp
        );
        emit QCOnboarded(qc, maxMintingCap, msg.sender, block.timestamp);
    }

    /// @notice Queue minting cap increase (requires 7-day delay)
    /// @param qc QC address
    /// @param newCap New minting capacity (must be higher than current)
    function queueMintingCapIncrease(address qc, uint256 newCap)
        external
        onlyRole(TIME_LOCKED_ADMIN_ROLE)
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

        bytes32 actionHash = keccak256(
            abi.encodePacked("MINTING_CAP_INCREASE", qc, newCap)
        );
        if (pendingActions[actionHash].executeAfter != 0) {
            revert ActionAlreadyQueued(actionHash);
        }

        uint256 executeAfter = block.timestamp + GOVERNANCE_DELAY;

        pendingActions[actionHash] = PendingAction({
            actionHash: actionHash,
            executeAfter: executeAfter,
            executed: false
        });

        emit GovernanceActionQueued(
            actionHash,
            executeAfter,
            "MINTING_CAP_INCREASE",
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Execute minting cap increase after delay period
    /// @param qc QC address
    /// @param newCap New minting capacity
    function executeMintingCapIncrease(address qc, uint256 newCap)
        external
        onlyRole(TIME_LOCKED_ADMIN_ROLE)
    {
        bytes32 actionHash = keccak256(
            abi.encodePacked("MINTING_CAP_INCREASE", qc, newCap)
        );
        PendingAction storage action = pendingActions[actionHash];

        if (action.executeAfter == 0) {
            revert ActionNotQueued(actionHash);
        }
        if (block.timestamp < action.executeAfter) {
            revert DelayPeriodNotElapsed(action.executeAfter, block.timestamp);
        }
        if (action.executed) {
            revert ActionAlreadyExecuted(actionHash);
        }

        // Mark as executed before external calls
        action.executed = true;

        // Execute minting cap increase
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        uint256 oldCap = qcData.getMaxMintingCapacity(qc);
        qcData.updateMaxMintingCapacity(qc, newCap);

        emit GovernanceActionExecuted(
            actionHash,
            "MINTING_CAP_INCREASE",
            msg.sender,
            block.timestamp
        );
        emit MintingCapIncreased(
            qc,
            oldCap,
            newCap,
            msg.sender,
            block.timestamp
        );
    }

    // =================== INSTANT EMERGENCY FUNCTIONS ===================

    /// @notice Emergency QC pause (instant action for threat response)
    /// @param qc QC address to pause
    /// @param reason Reason for emergency pause
    function emergencyPauseQC(address qc, bytes32 reason)
        external
        onlyRole(ARBITER_ROLE)
        onlyWhenNotPaused("registry")
    {
        if (qc == address(0)) {
            revert InvalidQCAddress();
        }
        if (reason == bytes32(0)) {
            revert ReasonRequired();
        }

        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        if (!qcData.isQCRegistered(qc)) {
            revert QCNotRegistered(qc);
        }

        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);

        // Only pause if currently Active or UnderReview
        if (
            currentStatus == QCData.QCStatus.Active ||
            currentStatus == QCData.QCStatus.UnderReview
        ) {
            qcData.setQCStatus(qc, QCData.QCStatus.UnderReview, reason);

            emit QCStatusChanged(
                qc,
                currentStatus,
                QCData.QCStatus.UnderReview,
                reason,
                msg.sender,
                block.timestamp
            );
            emit QCEmergencyPaused(qc, reason, msg.sender, block.timestamp);
        }
    }

    // =================== EXISTING FUNCTIONS (PRESERVED) ===================

    /// @notice Register a new Qualified Custodian (legacy function - now internal)
    /// @dev This function is now used internally by time-locked governance
    /// @param qc The address of the QC to register
    /// @param maxMintingCap The maximum minting capacity for the QC
    function _registerQC(address qc, uint256 maxMintingCap) internal {
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
    }

    /// @notice Legacy registerQC function for backward compatibility
    /// @dev Deprecated - use queueQCOnboarding for new registrations
    /// @param qc The address of the QC to register
    function registerQC(address qc)
        external
        onlyRole(QC_ADMIN_ROLE)
        onlyWhenNotPaused("registry")
    {
        // For legacy compatibility, use a default minting capacity
        // In production, this should be removed and replaced with time-locked governance
        _registerQC(qc, 1000 ether); // Default 1000 tBTC capacity
    }

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

    /// @notice Register a wallet for a QC (Watchdog only)
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
        if (qcData.getWalletStatus(btcAddress) != QCData.WalletStatus.PendingDeRegistration) {
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

        qcData.updateQCMintedAmount(qc, newAmount);
    }

    /// @notice Get QC status
    /// @param qc The address of the QC
    /// @return status The current status of the QC
    function getQCStatus(address qc)
        external
        view
        returns (QCData.QCStatus status)
    {
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        return qcData.getQCStatus(qc);
    }

    /// @notice Get QC wallet addresses
    /// @param qc The address of the QC
    /// @return addresses Array of wallet addresses for the QC
    function getQCWallets(address qc)
        external
        view
        returns (string[] memory addresses)
    {
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        return qcData.getQCWallets(qc);
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
        
        address validatorAddress = protocolRegistry.getService(SPV_VALIDATOR_KEY);
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
        
        address ledgerAddress = protocolRegistry.getService(QC_RESERVE_LEDGER_KEY);
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
        address ledgerAddress = protocolRegistry.getService(QC_RESERVE_LEDGER_KEY);
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
