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
    
    // Error codes for systematic error tracking
    // Format: CCFF where CC=contract(12=QCManager), FF=function
    uint16 public constant ERR_QCM_REGISTER_INVALID_QC = 1201;
    uint16 public constant ERR_QCM_REGISTER_INVALID_CAPACITY = 1202;
    uint16 public constant ERR_QCM_REGISTER_ALREADY_REGISTERED = 1203;
    uint16 public constant ERR_QCM_REGISTER_ACTION_QUEUED = 1204;
    uint16 public constant ERR_QCM_WALLET_INVALID_ADDRESS = 1301;
    uint16 public constant ERR_QCM_WALLET_QC_NOT_REGISTERED = 1302;
    uint16 public constant ERR_QCM_WALLET_QC_NOT_ACTIVE = 1303;
    uint16 public constant ERR_QCM_WALLET_SPV_FAILED = 1304;
    uint16 public constant ERR_QCM_SOLVENCY_NOT_AUTHORIZED = 1401;
    uint16 public constant ERR_QCM_SOLVENCY_QC_NOT_REGISTERED = 1402;
    
    /// @dev Enhanced error event for logging failed transaction attempts
    event ErrorLogged(
        uint16 indexed errorCode,
        string indexed functionName,
        address indexed caller,
        bytes32 contextHash,
        string message
    );
    bytes32 public constant TIME_LOCKED_ADMIN_ROLE = keccak256("TIME_LOCKED_ADMIN_ROLE");
    
    // Service keys for ProtocolRegistry
    bytes32 public constant QC_DATA_KEY = keccak256("QC_DATA");
    bytes32 public constant SYSTEM_STATE_KEY = keccak256("SYSTEM_STATE");
    bytes32 public constant QC_RESERVE_LEDGER_KEY = keccak256("QC_RESERVE_LEDGER");
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
        SystemState systemState = SystemState(protocolRegistry.getService(SYSTEM_STATE_KEY));
        require(!systemState.isFunctionPaused(functionName), "Function is paused");
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
    function queueQCOnboarding(
        address qc,
        uint256 maxMintingCap
    ) external onlyRole(TIME_LOCKED_ADMIN_ROLE) {
        require(qc != address(0), "Invalid QC address");
        require(maxMintingCap > 0, "Invalid minting capacity");
        
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        require(!qcData.isQCRegistered(qc), "QC already registered");
        
        bytes32 actionHash = keccak256(abi.encodePacked("QC_ONBOARDING", qc, maxMintingCap));
        require(pendingActions[actionHash].executeAfter == 0, "Action already queued");
        
        uint256 executeAfter = block.timestamp + GOVERNANCE_DELAY;
        
        pendingActions[actionHash] = PendingAction({
            actionHash: actionHash,
            executeAfter: executeAfter,
            executed: false
        });
        
        emit GovernanceActionQueued(actionHash, executeAfter, "QC_ONBOARDING", msg.sender, block.timestamp);
    }
    
    /// @notice Execute QC onboarding after delay period
    /// @param qc QC address to onboard
    /// @param maxMintingCap Maximum minting capacity for the QC
    function executeQCOnboarding(
        address qc,
        uint256 maxMintingCap
    ) external onlyRole(TIME_LOCKED_ADMIN_ROLE) {
        bytes32 actionHash = keccak256(abi.encodePacked("QC_ONBOARDING", qc, maxMintingCap));
        PendingAction storage action = pendingActions[actionHash];
        
        require(action.executeAfter != 0, "Action not queued");
        require(block.timestamp >= action.executeAfter, "Delay period not elapsed");
        require(!action.executed, "Action already executed");
        
        // Mark as executed before external calls
        action.executed = true;
        
        // Execute QC registration
        _registerQC(qc, maxMintingCap);
        
        emit GovernanceActionExecuted(actionHash, "QC_ONBOARDING", msg.sender, block.timestamp);
        emit QCOnboarded(qc, maxMintingCap, msg.sender, block.timestamp);
    }
    
    /// @notice Queue minting cap increase (requires 7-day delay)
    /// @param qc QC address
    /// @param newCap New minting capacity (must be higher than current)
    function queueMintingCapIncrease(
        address qc,
        uint256 newCap
    ) external onlyRole(TIME_LOCKED_ADMIN_ROLE) {
        require(qc != address(0), "Invalid QC address");
        require(newCap > 0, "Invalid minting capacity");
        
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        require(qcData.isQCRegistered(qc), "QC not registered");
        
        uint256 currentCap = qcData.getMaxMintingCapacity(qc);
        require(newCap > currentCap, "New cap must be higher than current");
        
        bytes32 actionHash = keccak256(abi.encodePacked("MINTING_CAP_INCREASE", qc, newCap));
        require(pendingActions[actionHash].executeAfter == 0, "Action already queued");
        
        uint256 executeAfter = block.timestamp + GOVERNANCE_DELAY;
        
        pendingActions[actionHash] = PendingAction({
            actionHash: actionHash,
            executeAfter: executeAfter,
            executed: false
        });
        
        emit GovernanceActionQueued(actionHash, executeAfter, "MINTING_CAP_INCREASE", msg.sender, block.timestamp);
    }
    
    /// @notice Execute minting cap increase after delay period
    /// @param qc QC address
    /// @param newCap New minting capacity
    function executeMintingCapIncrease(
        address qc,
        uint256 newCap
    ) external onlyRole(TIME_LOCKED_ADMIN_ROLE) {
        bytes32 actionHash = keccak256(abi.encodePacked("MINTING_CAP_INCREASE", qc, newCap));
        PendingAction storage action = pendingActions[actionHash];
        
        require(action.executeAfter != 0, "Action not queued");
        require(block.timestamp >= action.executeAfter, "Delay period not elapsed");
        require(!action.executed, "Action already executed");
        
        // Mark as executed before external calls
        action.executed = true;
        
        // Execute minting cap increase
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        uint256 oldCap = qcData.getMaxMintingCapacity(qc);
        qcData.updateMaxMintingCapacity(qc, newCap);
        
        emit GovernanceActionExecuted(actionHash, "MINTING_CAP_INCREASE", msg.sender, block.timestamp);
        emit MintingCapIncreased(qc, oldCap, newCap, msg.sender, block.timestamp);
    }
    
    // =================== INSTANT EMERGENCY FUNCTIONS ===================
    
    /// @notice Emergency QC pause (instant action for threat response)
    /// @param qc QC address to pause
    /// @param reason Reason for emergency pause
    function emergencyPauseQC(
        address qc,
        bytes32 reason
    ) external onlyRole(ARBITER_ROLE) onlyWhenNotPaused("registry") {
        require(qc != address(0), "Invalid QC address");
        require(reason != bytes32(0), "Reason required");
        
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        require(qcData.isQCRegistered(qc), "QC not registered");
        
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);
        
        // Only pause if currently Active or UnderReview
        if (currentStatus == QCData.QCStatus.Active || currentStatus == QCData.QCStatus.UnderReview) {
            qcData.setQCStatus(qc, QCData.QCStatus.UnderReview, reason);
            
            emit QCStatusChanged(qc, currentStatus, QCData.QCStatus.UnderReview, reason, msg.sender, block.timestamp);
            emit QCEmergencyPaused(qc, reason, msg.sender, block.timestamp);
        }
    }
    
    // =================== EXISTING FUNCTIONS (PRESERVED) ===================
    
    /// @notice Register a new Qualified Custodian (legacy function - now internal)
    /// @dev This function is now used internally by time-locked governance
    /// @param qc The address of the QC to register
    /// @param maxMintingCap The maximum minting capacity for the QC
    function _registerQC(address qc, uint256 maxMintingCap) internal {
        require(qc != address(0), "Invalid QC address");
        require(maxMintingCap > 0, "Invalid minting capacity");
        
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        require(!qcData.isQCRegistered(qc), "QC already registered");
        
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
        require(qcData.isQCRegistered(qc), "QC not registered");
        
        QCData.QCStatus oldStatus = qcData.getQCStatus(qc);
        
        // Validate status transitions
        require(
            _isValidStatusTransition(oldStatus, newStatus),
            "Invalid status transition"
        );
        
        qcData.setQCStatus(qc, newStatus, reason);
        
        emit QCStatusChanged(qc, oldStatus, newStatus, reason, msg.sender, block.timestamp);
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
    ) external onlyRole(REGISTRAR_ROLE) onlyWhenNotPaused("wallet_registration") {
        require(bytes(btcAddress).length > 0, "Invalid wallet address");
        
        // Cache QCData service to avoid redundant SLOAD operations
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        require(qcData.isQCRegistered(qc), "QC not registered");
        require(
            qcData.getQCStatus(qc) == QCData.QCStatus.Active,
            "QC not active"
        );
        
        // Verify wallet control using SPV client
        require(_verifyWalletControl(qc, btcAddress, challenge, txInfo, proof), "SPV verification failed");
        
        qcData.registerWallet(qc, btcAddress);
        
        emit WalletRegistrationRequested(qc, btcAddress, msg.sender, block.timestamp);
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
        
        require(qc != address(0), "Wallet not registered");
        require(
            msg.sender == qc || hasRole(QC_ADMIN_ROLE, msg.sender),
            "Not authorized"
        );
        require(
            qcData.getWalletStatus(btcAddress) == QCData.WalletStatus.Active,
            "Wallet not active"
        );
        
        qcData.requestWalletDeRegistration(btcAddress);
    }
    
    /// @notice Finalize wallet deregistration with solvency check
    /// @param btcAddress The Bitcoin address to finalize deregistration
    /// @param newReserveBalance The new reserve balance after wallet removal
    function finalizeWalletDeRegistration(
        string calldata btcAddress,
        uint256 newReserveBalance
    ) external onlyRole(REGISTRAR_ROLE) onlyWhenNotPaused("wallet_registration") {
        // Cache QCData service to avoid redundant SLOAD operations
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        address qc = qcData.getWalletOwner(btcAddress);
        
        require(qc != address(0), "Wallet not registered");
        require(
            qcData.getWalletStatus(btcAddress) == QCData.WalletStatus.PendingDeRegistration,
            "Wallet not pending deregistration"
        );
        
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
        (uint256 reserveBalance, bool isStale) = _getReserveBalanceAndStaleness(qc);
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
            _logError(ERR_QCM_SOLVENCY_NOT_AUTHORIZED, "verifyQCSolvency", msg.sender,
                     keccak256(abi.encodePacked(qc)),
                     string(abi.encodePacked("verifyQCSolvency: Not authorized - caller ", 
                           _addressToString(msg.sender), " lacks ARBITER_ROLE")));
            require(false, "QCM-1401: verifyQCSolvency failed - Only arbiter can verify solvency, check role permissions");
        }
        
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        
        if (!qcData.isQCRegistered(qc)) {
            _logError(ERR_QCM_SOLVENCY_QC_NOT_REGISTERED, "verifyQCSolvency", msg.sender,
                     keccak256(abi.encodePacked(qc)),
                     string(abi.encodePacked("verifyQCSolvency: QC not registered - ", 
                           _addressToString(qc), " must be registered before solvency verification")));
            require(false, "QCM-1402: verifyQCSolvency failed - QC not registered, register QC first");
        }
        
        (uint256 reserveBalance,) = _getReserveBalanceAndStaleness(qc);
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
        
        emit SolvencyCheckPerformed(qc, solvent, mintedAmount, reserveBalance, msg.sender, block.timestamp);
        
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
        require(qcData.isQCRegistered(qc), "QC not registered");
        
        qcData.updateQCMintedAmount(qc, newAmount);
    }
    
    /// @notice Get QC status
    /// @param qc The address of the QC
    /// @return status The current status of the QC
    function getQCStatus(address qc) external view returns (QCData.QCStatus status) {
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
            return newStatus == QCData.QCStatus.UnderReview || 
                   newStatus == QCData.QCStatus.Revoked;
        } else if (oldStatus == QCData.QCStatus.UnderReview) {
            return newStatus == QCData.QCStatus.Active || 
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
        try protocolRegistry.getService(SPV_VALIDATOR_KEY) returns (address validatorAddress) {
            ISPVValidator spvValidator = ISPVValidator(validatorAddress);
            return spvValidator.verifyWalletControl(qc, btcAddress, challenge, txInfo, proof);
        } catch {
            // If SPV validator not available, reject verification
            return false;
        }
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
        // Get from QCReserveLedger
        try protocolRegistry.getService(QC_RESERVE_LEDGER_KEY) returns (address ledgerAddress) {
            QCReserveLedger reserveLedger = QCReserveLedger(ledgerAddress);
            return reserveLedger.getReserveBalanceAndStaleness(qc);
        } catch {
            // If QCReserveLedger not registered yet, return stale
            return (0, true);
        }
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
        (uint256 oldBalance,) = _getReserveBalanceAndStaleness(qc);
        
        // Check solvency before updating
        require(newBalance >= mintedAmount, "QC would become insolvent");
        
        // Update reserve ledger with new balance
        try protocolRegistry.getService(QC_RESERVE_LEDGER_KEY) returns (address ledgerAddress) {
            QCReserveLedger reserveLedger = QCReserveLedger(ledgerAddress);
            reserveLedger.submitReserveAttestation(qc, newBalance);
        } catch {
            // If QCReserveLedger not registered yet, skip update but still check solvency
            revert("QC Reserve Ledger not available");
        }
        
        emit ReserveBalanceUpdated(qc, oldBalance, newBalance, msg.sender, block.timestamp);
    }
    
    // Helper functions for enhanced error messages and logging
    function _logError(
        uint16 errorCode,
        string memory functionName,
        address caller,
        bytes32 contextHash,
        string memory message
    ) private {
        emit ErrorLogged(errorCode, functionName, caller, contextHash, message);
    }
    
    function _addressToString(address addr) private pure returns (string memory) {
        bytes memory data = abi.encodePacked(addr);
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(2 + data.length * 2);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < data.length; i++) {
            str[2+i*2] = alphabet[uint256(uint8(data[i] >> 4))];
            str[3+i*2] = alphabet[uint256(uint8(data[i] & 0x0f))];
        }
        return string(str);
    }
    
    function _statusToString(QCData.QCStatus status) private pure returns (string memory) {
        if (status == QCData.QCStatus.Active) {
            return "Active";
        } else if (status == QCData.QCStatus.UnderReview) {
            return "UnderReview";
        } else if (status == QCData.QCStatus.Revoked) {
            return "Revoked";
        }
        return "Unknown";
    }
}