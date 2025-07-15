// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IOptimisticWatchdogConsensus.sol";
import "./interfaces/IWatchdogOperation.sol";
import "./WatchdogOperationLib.sol";
import "./ProtocolRegistry.sol";
import "./QCManager.sol";
import "./QCData.sol";
import "./QCReserveLedger.sol";
import "./QCRedeemer.sol";
import "./interfaces/ISPVValidator.sol";
import "../bridge/BitcoinTx.sol";

/// @title WatchdogAdapter
/// @notice Adapter contract that maintains SingleWatchdog interface while using OptimisticWatchdogConsensus
/// @dev This contract enables seamless migration from v1.0 single watchdog to v1.1 consensus system
///      by implementing the same interface as SingleWatchdog but routing operations through consensus
contract WatchdogAdapter is AccessControl, IWatchdogOperation {
    using WatchdogOperationLib for *;

    // =================== CONSTANTS ===================
    
    bytes32 public constant WATCHDOG_OPERATOR_ROLE = keccak256("WATCHDOG_OPERATOR_ROLE");
    
    // Service keys for ProtocolRegistry
    bytes32 public constant QC_MANAGER_KEY = keccak256("QC_MANAGER");
    bytes32 public constant QC_DATA_KEY = keccak256("QC_DATA");
    bytes32 public constant QC_RESERVE_LEDGER_KEY = keccak256("QC_RESERVE_LEDGER");
    bytes32 public constant QC_REDEEMER_KEY = keccak256("QC_REDEEMER");
    bytes32 public constant SPV_VALIDATOR_KEY = keccak256("SPV_VALIDATOR");
    bytes32 public constant CONSENSUS_KEY = keccak256("WATCHDOG_CONSENSUS");

    // =================== STATE VARIABLES ===================
    
    ProtocolRegistry public immutable protocolRegistry;
    IOptimisticWatchdogConsensus public immutable consensus;
    
    /// @dev Tracking for monitoring operations (compatibility with SingleWatchdog)
    mapping(address => uint256) public lastAttestationTime;
    mapping(address => uint256) public attestationCount;
    mapping(string => uint256) public walletRegistrationTime;
    mapping(bytes32 => uint256) public redemptionHandlingTime;
    
    /// @dev Mapping to track pending operations for async execution
    mapping(bytes32 => bytes32) public pendingOperations;

    // =================== EVENTS (Compatibility) ===================
    
    event WatchdogReserveAttestation(
        address indexed qc,
        uint256 indexed newBalance,
        uint256 indexed oldBalance,
        address submittedBy,
        uint256 timestamp
    );

    event WatchdogRedemptionAction(
        bytes32 indexed redemptionId,
        string indexed action,
        bytes32 reason,
        address indexed actionBy,
        uint256 timestamp
    );

    event WatchdogQCStatusChange(
        address indexed qc,
        QCData.QCStatus indexed newStatus,
        bytes32 reason,
        address indexed changedBy,
        uint256 timestamp
    );

    event WatchdogWalletRegistration(
        address indexed qc,
        string btcAddress,
        bytes32 challengeHash
    );

    event DirectExecutionPerformed(
        bytes32 indexed operationType,
        address indexed operator,
        bytes32 indexed operationHash,
        uint256 timestamp
    );

    // =================== ERRORS (Compatibility) ===================
    
    error InvalidQCAddress();
    error ReasonRequired();
    error InvalidWalletAddress();
    error SPVProofRequired();
    error ChallengeHashRequired();
    error InvalidRedemptionId();
    error BitcoinAddressRequired();
    error InvalidStrategicCondition();
    error NoRedemptionsProvided();
    error SPVValidatorNotAvailable();
    error SPVVerificationFailed();
    error InvalidSPVProofData();
    error NotAuthorizedCaller();
    error OperationPending();

    // =================== CONSTRUCTOR ===================
    
    constructor(address _protocolRegistry, address _consensus) {
        require(_protocolRegistry != address(0), "Invalid registry");
        require(_consensus != address(0), "Invalid consensus");
        
        protocolRegistry = ProtocolRegistry(_protocolRegistry);
        consensus = IOptimisticWatchdogConsensus(_consensus);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(WATCHDOG_OPERATOR_ROLE, msg.sender);
    }

    // =================== MODIFIERS ===================
    
    modifier onlyWatchdogOperatorOrConsensus() {
        if (!hasRole(WATCHDOG_OPERATOR_ROLE, msg.sender) && msg.sender != address(consensus)) {
            revert NotAuthorizedCaller();
        }
        _;
    }

    // =================== SINGLEW WATCHDOG INTERFACE FUNCTIONS ===================
    
    /// @notice Submit reserve attestation (SingleWatchdog compatibility)
    /// @param qc The QC address
    /// @param balance The attested balance
    function attestReserves(address qc, uint256 balance)
        external
        onlyRole(WATCHDOG_OPERATOR_ROLE)
    {
        if (qc == address(0)) revert InvalidQCAddress();
        
        // Encode operation data
        bytes memory operationData = WatchdogOperationLib.encodeReserveAttestation(qc, balance);
        
        // Submit to consensus if caller is active watchdog
        if (consensus.isActiveWatchdog(msg.sender)) {
            bytes32 operationId = consensus.submitOptimisticOperation(
                consensus.RESERVE_ATTESTATION(),
                operationData
            );
            pendingOperations[operationId] = consensus.RESERVE_ATTESTATION();
        } else {
            // Direct execution for non-watchdog operators (backward compatibility)
            executeReserveAttestation(qc, balance);
            emit DirectExecutionPerformed(
                consensus.RESERVE_ATTESTATION(),
                msg.sender,
                keccak256(operationData),
                block.timestamp
            );
        }
    }
    
    /// @notice Register wallet with SPV proof (SingleWatchdog compatibility)
    function registerWalletWithProof(
        address qc,
        string calldata btcAddress,
        bytes calldata spvProof,
        bytes32 challengeHash
    ) external onlyRole(WATCHDOG_OPERATOR_ROLE) {
        if (qc == address(0)) revert InvalidQCAddress();
        if (bytes(btcAddress).length == 0) revert InvalidWalletAddress();
        if (spvProof.length == 0) revert SPVProofRequired();
        if (challengeHash == bytes32(0)) revert ChallengeHashRequired();
        
        // Parse SPV proof
        (BitcoinTx.Info memory txInfo, BitcoinTx.Proof memory proof) = _parseSPVProof(spvProof);
        
        // Encode operation data
        bytes memory operationData = WatchdogOperationLib.encodeWalletRegistration(
            qc,
            btcAddress,
            challengeHash,
            txInfo,
            proof
        );
        
        // Submit to consensus if caller is active watchdog
        if (consensus.isActiveWatchdog(msg.sender)) {
            bytes32 operationId = consensus.submitOptimisticOperation(
                consensus.WALLET_REGISTRATION(),
                operationData
            );
            pendingOperations[operationId] = consensus.WALLET_REGISTRATION();
        } else {
            // Direct execution for non-watchdog operators
            executeWalletRegistration(qc, btcAddress, challengeHash, txInfo, proof);
            emit DirectExecutionPerformed(
                consensus.WALLET_REGISTRATION(),
                msg.sender,
                keccak256(operationData),
                block.timestamp
            );
        }
    }
    
    /// @notice Change QC status (SingleWatchdog compatibility)
    function changeQCStatus(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason
    ) external onlyRole(WATCHDOG_OPERATOR_ROLE) {
        if (qc == address(0)) revert InvalidQCAddress();
        if (reason == bytes32(0)) revert ReasonRequired();
        
        // Encode operation data
        bytes memory operationData = WatchdogOperationLib.encodeStatusChange(qc, newStatus, reason);
        
        // Submit to consensus if caller is active watchdog
        if (consensus.isActiveWatchdog(msg.sender)) {
            bytes32 operationId = consensus.submitOptimisticOperation(
                consensus.STATUS_CHANGE(),
                operationData
            );
            pendingOperations[operationId] = consensus.STATUS_CHANGE();
        } else {
            // Direct execution for non-watchdog operators
            executeStatusChange(qc, newStatus, reason);
            emit DirectExecutionPerformed(
                consensus.STATUS_CHANGE(),
                msg.sender,
                keccak256(operationData),
                block.timestamp
            );
        }
    }
    
    /// @notice Record redemption fulfillment (SingleWatchdog compatibility)
    function recordRedemptionFulfillment(
        bytes32 redemptionId,
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external onlyRole(WATCHDOG_OPERATOR_ROLE) {
        if (redemptionId == bytes32(0)) revert InvalidRedemptionId();
        if (bytes(userBtcAddress).length == 0) revert BitcoinAddressRequired();
        
        // Encode operation data
        bytes memory operationData = WatchdogOperationLib.encodeRedemptionFulfillment(
            redemptionId,
            userBtcAddress,
            expectedAmount,
            txInfo,
            proof
        );
        
        // Submit to consensus if caller is active watchdog
        if (consensus.isActiveWatchdog(msg.sender)) {
            bytes32 operationId = consensus.submitOptimisticOperation(
                consensus.REDEMPTION_FULFILLMENT(),
                operationData
            );
            pendingOperations[operationId] = consensus.REDEMPTION_FULFILLMENT();
        } else {
            // Direct execution for non-watchdog operators
            executeRedemptionFulfillment(redemptionId, userBtcAddress, expectedAmount, txInfo, proof);
            emit DirectExecutionPerformed(
                consensus.REDEMPTION_FULFILLMENT(),
                msg.sender,
                keccak256(operationData),
                block.timestamp
            );
        }
    }
    
    /// @notice Flag redemption as defaulted (SingleWatchdog compatibility)
    function flagRedemptionDefault(bytes32 redemptionId, bytes32 reason)
        external
        onlyRole(WATCHDOG_OPERATOR_ROLE)
    {
        if (redemptionId == bytes32(0)) revert InvalidRedemptionId();
        if (reason == bytes32(0)) revert ReasonRequired();
        
        // Encode operation data
        bytes memory operationData = WatchdogOperationLib.encodeRedemptionDefault(redemptionId, reason);
        
        // Submit to consensus if caller is active watchdog
        if (consensus.isActiveWatchdog(msg.sender)) {
            bytes32 operationId = consensus.submitOptimisticOperation(
                consensus.REDEMPTION_FULFILLMENT(),
                operationData
            );
            pendingOperations[operationId] = consensus.REDEMPTION_FULFILLMENT();
        } else {
            // Direct execution for non-watchdog operators
            executeRedemptionDefault(redemptionId, reason);
            emit DirectExecutionPerformed(
                consensus.REDEMPTION_FULFILLMENT(),
                msg.sender,
                keccak256(operationData),
                block.timestamp
            );
        }
    }

    // =================== OPERATION EXECUTION (Called by Consensus) ===================
    
    /// @notice Execute operation from consensus
    /// @dev This is called by OptimisticWatchdogConsensus after challenge period
    function executeOperation(bytes32 operationType, bytes calldata operationData) 
        external 
        onlyWatchdogOperatorOrConsensus 
    {
        if (operationType == consensus.RESERVE_ATTESTATION()) {
            (address qc, uint256 balance) = WatchdogOperationLib.decodeReserveAttestation(operationData);
            executeReserveAttestation(qc, balance);
        } else if (operationType == consensus.WALLET_REGISTRATION()) {
            (
                address qc,
                string memory btcAddress,
                bytes32 challengeHash,
                BitcoinTx.Info memory txInfo,
                BitcoinTx.Proof memory proof
            ) = WatchdogOperationLib.decodeWalletRegistration(operationData);
            executeWalletRegistration(qc, btcAddress, challengeHash, txInfo, proof);
        } else if (operationType == consensus.STATUS_CHANGE()) {
            (address qc, QCData.QCStatus newStatus, bytes32 reason) = 
                WatchdogOperationLib.decodeStatusChange(operationData);
            executeStatusChange(qc, newStatus, reason);
        } else if (operationType == consensus.REDEMPTION_FULFILLMENT()) {
            // Try to decode as fulfillment first
            try WatchdogOperationLib.decodeRedemptionFulfillment(operationData) returns (
                bytes32 redemptionId,
                string memory userBtcAddress,
                uint64 expectedAmount,
                BitcoinTx.Info memory txInfo,
                BitcoinTx.Proof memory proof
            ) {
                executeRedemptionFulfillment(redemptionId, userBtcAddress, expectedAmount, txInfo, proof);
            } catch {
                // If that fails, try as default
                (bytes32 redemptionId, bytes32 reason) = 
                    WatchdogOperationLib.decodeRedemptionDefault(operationData);
                executeRedemptionDefault(redemptionId, reason);
            }
        }
    }
    
    /// @inheritdoc IWatchdogOperation
    function executeReserveAttestation(address qc, uint256 balance) public override {
        require(
            hasRole(WATCHDOG_OPERATOR_ROLE, msg.sender) || 
            msg.sender == address(consensus) ||
            msg.sender == address(this),
            "Unauthorized"
        );
        
        QCReserveLedger reserveLedger = QCReserveLedger(
            protocolRegistry.getService(QC_RESERVE_LEDGER_KEY)
        );
        
        reserveLedger.submitReserveAttestation(qc, balance);
        
        lastAttestationTime[qc] = block.timestamp;
        attestationCount[qc]++;
        
        emit WatchdogReserveAttestation(qc, balance, 0, msg.sender, block.timestamp);
    }
    
    /// @inheritdoc IWatchdogOperation
    function executeWalletRegistration(
        address qc,
        string calldata btcAddress,
        bytes32 challengeHash,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) public override {
        require(
            hasRole(WATCHDOG_OPERATOR_ROLE, msg.sender) || 
            msg.sender == address(consensus) ||
            msg.sender == address(this),
            "Unauthorized"
        );
        
        // Verify wallet control
        if (!_verifyWalletControl(qc, btcAddress, challengeHash, txInfo, proof)) {
            revert SPVVerificationFailed();
        }
        
        QCManager qcManager = QCManager(protocolRegistry.getService(QC_MANAGER_KEY));
        qcManager.registerWallet(qc, btcAddress, challengeHash, txInfo, proof);
        
        walletRegistrationTime[btcAddress] = block.timestamp;
        
        emit WatchdogWalletRegistration(qc, btcAddress, challengeHash);
    }
    
    /// @inheritdoc IWatchdogOperation
    function executeStatusChange(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason
    ) public override {
        require(
            hasRole(WATCHDOG_OPERATOR_ROLE, msg.sender) || 
            msg.sender == address(consensus) ||
            msg.sender == address(this),
            "Unauthorized"
        );
        
        QCManager qcManager = QCManager(protocolRegistry.getService(QC_MANAGER_KEY));
        qcManager.setQCStatus(qc, newStatus, reason);
        
        emit WatchdogQCStatusChange(qc, newStatus, reason, msg.sender, block.timestamp);
    }
    
    /// @inheritdoc IWatchdogOperation
    function executeRedemptionFulfillment(
        bytes32 redemptionId,
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) public override {
        require(
            hasRole(WATCHDOG_OPERATOR_ROLE, msg.sender) || 
            msg.sender == address(consensus) ||
            msg.sender == address(this),
            "Unauthorized"
        );
        
        QCRedeemer redeemer = QCRedeemer(protocolRegistry.getService(QC_REDEEMER_KEY));
        redeemer.recordRedemptionFulfillment(
            redemptionId,
            userBtcAddress,
            expectedAmount,
            txInfo,
            proof
        );
        
        redemptionHandlingTime[redemptionId] = block.timestamp;
        
        emit WatchdogRedemptionAction(
            redemptionId,
            "FULFILLED",
            bytes32(0),
            msg.sender,
            block.timestamp
        );
    }
    
    /// @inheritdoc IWatchdogOperation
    function executeRedemptionDefault(bytes32 redemptionId, bytes32 reason) public override {
        require(
            hasRole(WATCHDOG_OPERATOR_ROLE, msg.sender) || 
            msg.sender == address(consensus) ||
            msg.sender == address(this),
            "Unauthorized"
        );
        
        QCRedeemer redeemer = QCRedeemer(protocolRegistry.getService(QC_REDEEMER_KEY));
        redeemer.flagDefaultedRedemption(redemptionId, reason);
        
        redemptionHandlingTime[redemptionId] = block.timestamp;
        
        emit WatchdogRedemptionAction(
            redemptionId,
            "DEFAULTED",
            reason,
            msg.sender,
            block.timestamp
        );
    }

    // =================== COMPATIBILITY FUNCTIONS ===================
    
    /// @notice Check if watchdog is operational (SingleWatchdog compatibility)
    function isWatchdogOperational() external view returns (bool) {
        // Check if consensus is operational
        if (address(consensus) == address(0)) return false;
        
        // Check if we have required roles in system contracts
        if (!protocolRegistry.hasService(QC_RESERVE_LEDGER_KEY)) return false;
        
        address ledgerAddress = protocolRegistry.getService(QC_RESERVE_LEDGER_KEY);
        QCReserveLedger reserveLedger = QCReserveLedger(ledgerAddress);
        if (!reserveLedger.hasRole(reserveLedger.ATTESTER_ROLE(), address(this))) {
            return false;
        }
        
        // Check other required services
        if (!protocolRegistry.hasService(QC_MANAGER_KEY)) return false;
        if (!protocolRegistry.hasService(QC_REDEEMER_KEY)) return false;
        
        return true;
    }
    
    /// @notice Get watchdog statistics (SingleWatchdog compatibility)
    function getWatchdogStats(address qc) external view returns (uint256[3] memory stats) {
        stats[0] = lastAttestationTime[qc];
        stats[1] = attestationCount[qc];
        stats[2] = hasRole(WATCHDOG_OPERATOR_ROLE, msg.sender) ? 1 : 0;
    }
    
    /// @notice Setup watchdog roles in system contracts
    function setupWatchdogRoles() external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Grant ATTESTER_ROLE in QCReserveLedger
        QCReserveLedger reserveLedger = QCReserveLedger(
            protocolRegistry.getService(QC_RESERVE_LEDGER_KEY)
        );
        reserveLedger.grantRole(reserveLedger.ATTESTER_ROLE(), address(this));
        
        // Grant roles in QCManager
        QCManager qcManager = QCManager(
            protocolRegistry.getService(QC_MANAGER_KEY)
        );
        qcManager.grantRole(qcManager.REGISTRAR_ROLE(), address(this));
        qcManager.grantRole(qcManager.ARBITER_ROLE(), address(this));
        
        // Grant ARBITER_ROLE in QCRedeemer
        QCRedeemer redeemer = QCRedeemer(
            protocolRegistry.getService(QC_REDEEMER_KEY)
        );
        redeemer.grantRole(redeemer.ARBITER_ROLE(), address(this));
    }

    // =================== INTERNAL FUNCTIONS ===================
    
    function _parseSPVProof(bytes calldata spvProofData) 
        private 
        pure 
        returns (BitcoinTx.Info memory txInfo, BitcoinTx.Proof memory proof) 
    {
        (txInfo, proof) = abi.decode(spvProofData, (BitcoinTx.Info, BitcoinTx.Proof));
    }
    
    function _verifyWalletControl(
        address qc,
        string calldata btcAddress,
        bytes32 challenge,
        BitcoinTx.Info memory txInfo,
        BitcoinTx.Proof memory proof
    ) private view returns (bool) {
        if (!protocolRegistry.hasService(SPV_VALIDATOR_KEY)) {
            revert SPVValidatorNotAvailable();
        }
        
        address validatorAddress = protocolRegistry.getService(SPV_VALIDATOR_KEY);
        ISPVValidator spvValidator = ISPVValidator(validatorAddress);
        return spvValidator.verifyWalletControl(qc, btcAddress, challenge, txInfo, proof);
    }

    // =================== ENCODING FUNCTIONS (IWatchdogOperation) ===================
    
    /// @inheritdoc IWatchdogOperation
    function encodeReserveAttestation(address qc, uint256 balance)
        external
        pure
        override
        returns (bytes memory)
    {
        return WatchdogOperationLib.encodeReserveAttestation(qc, balance);
    }
    
    /// @inheritdoc IWatchdogOperation
    function encodeWalletRegistration(
        address qc,
        string calldata btcAddress,
        bytes32 challengeHash,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external pure override returns (bytes memory) {
        return WatchdogOperationLib.encodeWalletRegistration(qc, btcAddress, challengeHash, txInfo, proof);
    }
    
    /// @inheritdoc IWatchdogOperation
    function encodeStatusChange(address qc, QCData.QCStatus newStatus, bytes32 reason)
        external
        pure
        override
        returns (bytes memory)
    {
        return WatchdogOperationLib.encodeStatusChange(qc, newStatus, reason);
    }
    
    /// @inheritdoc IWatchdogOperation
    function encodeRedemptionFulfillment(
        bytes32 redemptionId,
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external pure override returns (bytes memory) {
        return WatchdogOperationLib.encodeRedemptionFulfillment(
            redemptionId,
            userBtcAddress,
            expectedAmount,
            txInfo,
            proof
        );
    }
    
    /// @inheritdoc IWatchdogOperation
    function encodeRedemptionDefault(bytes32 redemptionId, bytes32 reason)
        external
        pure
        override
        returns (bytes memory)
    {
        return WatchdogOperationLib.encodeRedemptionDefault(redemptionId, reason);
    }
    
    // =================== DECODING FUNCTIONS (IWatchdogOperation) ===================
    
    /// @inheritdoc IWatchdogOperation
    function decodeReserveAttestation(bytes calldata data)
        external
        pure
        override
        returns (address qc, uint256 balance)
    {
        return WatchdogOperationLib.decodeReserveAttestation(data);
    }
    
    /// @inheritdoc IWatchdogOperation
    function decodeWalletRegistration(bytes calldata data)
        external
        pure
        override
        returns (
            address qc,
            string memory btcAddress,
            bytes32 challengeHash,
            BitcoinTx.Info memory txInfo,
            BitcoinTx.Proof memory proof
        )
    {
        return WatchdogOperationLib.decodeWalletRegistration(data);
    }
    
    /// @inheritdoc IWatchdogOperation
    function decodeStatusChange(bytes calldata data)
        external
        pure
        override
        returns (address qc, QCData.QCStatus newStatus, bytes32 reason)
    {
        return WatchdogOperationLib.decodeStatusChange(data);
    }
    
    /// @inheritdoc IWatchdogOperation
    function decodeRedemptionFulfillment(bytes calldata data)
        external
        pure
        override
        returns (
            bytes32 redemptionId,
            string memory userBtcAddress,
            uint64 expectedAmount,
            BitcoinTx.Info memory txInfo,
            BitcoinTx.Proof memory proof
        )
    {
        return WatchdogOperationLib.decodeRedemptionFulfillment(data);
    }
    
    /// @inheritdoc IWatchdogOperation
    function decodeRedemptionDefault(bytes calldata data)
        external
        pure
        override
        returns (bytes32 redemptionId, bytes32 reason)
    {
        return WatchdogOperationLib.decodeRedemptionDefault(data);
    }
}