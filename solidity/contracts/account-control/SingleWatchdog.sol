// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./ProtocolRegistry.sol";
import "./QCManager.sol";
import "./QCData.sol";
import "./QCReserveLedger.sol";
import "./QCRedeemer.sol";
import "./interfaces/ISPVValidator.sol";
import "../bridge/BitcoinTx.sol";

/// @title SingleWatchdog
/// @dev Proxy contract implementing the single Watchdog model for tBTC v2.
/// 
/// This contract acts as a proxy that consolidates multiple system roles under
/// a single WATCHDOG_OPERATOR_ROLE for operational efficiency. While all functions
/// in this contract require WATCHDOG_OPERATOR_ROLE, the SingleWatchdog contract
/// itself must be granted specific roles in other system contracts:
/// - ARBITER_ROLE in QCManager and QCRedeemer
/// - ATTESTER_ROLE in QCReserveLedger  
/// - REGISTRAR_ROLE in QCManager
/// 
/// The proxy pattern allows a single operator to perform:
/// - Proof-of-Reserves attestations
/// - Wallet registration with SPV verification
/// - Redemption arbitration and fulfillment
/// - QC status management
/// 
/// Use setupWatchdogRoles() to grant this contract the necessary roles in system contracts.
contract SingleWatchdog is AccessControl {
    bytes32 public constant WATCHDOG_OPERATOR_ROLE =
        keccak256("WATCHDOG_OPERATOR_ROLE");

    // Custom errors for gas-efficient reverts
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

    // Service keys for ProtocolRegistry
    bytes32 public constant QC_MANAGER_KEY = keccak256("QC_MANAGER");
    bytes32 public constant QC_DATA_KEY = keccak256("QC_DATA");
    bytes32 public constant QC_RESERVE_LEDGER_KEY =
        keccak256("QC_RESERVE_LEDGER");
    bytes32 public constant QC_REDEEMER_KEY = keccak256("QC_REDEEMER");
    bytes32 public constant SPV_VALIDATOR_KEY = keccak256("SPV_VALIDATOR");

    ProtocolRegistry public immutable protocolRegistry;

    /// @dev Tracking for monitoring operations
    mapping(address => uint256) public lastAttestationTime;
    mapping(address => uint256) public attestationCount;
    mapping(string => uint256) public walletRegistrationTime;
    mapping(bytes32 => uint256) public redemptionHandlingTime;

    /// @dev Events
    // =================== STANDARDIZED EVENTS ===================

    /// @dev Emitted when Watchdog submits reserve attestation
    event WatchdogReserveAttestation(
        address indexed qc,
        uint256 indexed newBalance,
        uint256 indexed oldBalance,
        address submittedBy,
        uint256 timestamp
    );

    /// @dev Emitted when Watchdog takes action on redemption
    event WatchdogRedemptionAction(
        bytes32 indexed redemptionId,
        string indexed action,
        bytes32 reason,
        address indexed actionBy,
        uint256 timestamp
    );

    /// @dev Emitted when Watchdog changes QC status
    event WatchdogQCStatusChange(
        address indexed qc,
        QCData.QCStatus indexed newStatus,
        bytes32 reason,
        address indexed changedBy,
        uint256 timestamp
    );

    /// @dev Emitted when Watchdog registers wallet
    event WatchdogWalletRegistration(
        address indexed qc,
        string btcAddress,
        bytes32 challengeHash
    );

    constructor(address _protocolRegistry) {
        protocolRegistry = ProtocolRegistry(_protocolRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(WATCHDOG_OPERATOR_ROLE, msg.sender);
    }

    /// @notice Verify QC solvency (requires WATCHDOG_OPERATOR_ROLE)
    /// @dev Calls QCManager.verifyQCSolvency() which requires this contract to have ARBITER_ROLE
    /// @param qc The QC address
    /// @return solvent True if QC is solvent
    function verifyQCSolvency(address qc)
        external
        onlyRole(WATCHDOG_OPERATOR_ROLE)
        returns (bool solvent)
    {
        if (qc == address(0)) revert InvalidQCAddress();

        QCManager qcManager = QCManager(
            protocolRegistry.getService(QC_MANAGER_KEY)
        );

        return qcManager.verifyQCSolvency(qc);
    }

    /// @notice Set QC status (requires WATCHDOG_OPERATOR_ROLE)
    /// @dev Calls QCManager.setQCStatus() which requires this contract to have ARBITER_ROLE
    /// @param qc The QC address
    /// @param status The new status (as uint256)
    /// @param reason The reason for change
    function setQCStatus(
        address qc,
        uint256 status,
        bytes32 reason
    ) external onlyRole(WATCHDOG_OPERATOR_ROLE) {
        if (qc == address(0)) revert InvalidQCAddress();
        if (reason == bytes32(0)) revert ReasonRequired();

        QCManager qcManager = QCManager(
            protocolRegistry.getService(QC_MANAGER_KEY)
        );

        // Convert uint256 to QCStatus enum
        QCData.QCStatus qcStatus;
        if (status == 0) {
            qcStatus = QCData.QCStatus.Active;
        } else if (status == 1) {
            qcStatus = QCData.QCStatus.UnderReview;
        } else if (status == 2) {
            qcStatus = QCData.QCStatus.Revoked;
        } else {
            revert("Invalid status");
        }

        qcManager.setQCStatus(qc, qcStatus, reason);

        emit WatchdogQCStatusChange(
            qc,
            qcStatus,
            reason,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Submit reserve attestation (requires WATCHDOG_OPERATOR_ROLE)
    /// @dev Calls QCReserveLedger.submitReserveAttestation() which requires this contract to have ATTESTER_ROLE
    /// @param qc The QC address
    /// @param balance The attested balance
    function attestReserves(address qc, uint256 balance)
        external
        onlyRole(WATCHDOG_OPERATOR_ROLE)
    {
        if (qc == address(0)) revert InvalidQCAddress();

        QCReserveLedger reserveLedger = QCReserveLedger(
            protocolRegistry.getService(QC_RESERVE_LEDGER_KEY)
        );

        reserveLedger.submitReserveAttestation(qc, balance);

        lastAttestationTime[qc] = block.timestamp;
        attestationCount[qc]++;

        emit WatchdogReserveAttestation(
            qc,
            balance,
            0,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Register wallet with SPV proof (requires WATCHDOG_OPERATOR_ROLE)
    /// @dev Calls QCManager.registerWallet() which requires this contract to have REGISTRAR_ROLE
    /// @param qc The QC address
    /// @param btcAddress The Bitcoin address
    /// @param spvProof The SPV proof of control
    /// @param challengeHash The challenge hash used for verification
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

        QCManager qcManager = QCManager(
            protocolRegistry.getService(QC_MANAGER_KEY)
        );

        // Parse SPV proof data and verify wallet control
        (BitcoinTx.Info memory txInfo, BitcoinTx.Proof memory proof) = _parseSPVProof(spvProof);
        
        // Verify wallet control using SPV validator
        if (!_verifyWalletControl(qc, btcAddress, challengeHash, txInfo, proof)) {
            revert SPVVerificationFailed();
        }

        qcManager.registerWallet(qc, btcAddress, challengeHash, txInfo, proof);

        walletRegistrationTime[btcAddress] = block.timestamp;

        emit WatchdogWalletRegistration(qc, btcAddress, challengeHash);
    }

    /// @notice Record redemption fulfillment (requires WATCHDOG_OPERATOR_ROLE)
    /// @dev Calls QCRedeemer.recordRedemptionFulfillment() which requires this contract to have ARBITER_ROLE
    /// @param redemptionId The redemption identifier
    /// @param userBtcAddress The user's Bitcoin address
    /// @param expectedAmount The expected payment amount in satoshis
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    function recordRedemptionFulfillment(
        bytes32 redemptionId,
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external onlyRole(WATCHDOG_OPERATOR_ROLE) {
        if (redemptionId == bytes32(0)) revert InvalidRedemptionId();
        if (bytes(userBtcAddress).length == 0) revert BitcoinAddressRequired();

        QCRedeemer redeemer = QCRedeemer(
            protocolRegistry.getService(QC_REDEEMER_KEY)
        );

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

    /// @notice Flag redemption as defaulted (requires WATCHDOG_OPERATOR_ROLE)
    /// @dev Calls QCRedeemer.flagDefaultedRedemption() which requires this contract to have ARBITER_ROLE
    /// @param redemptionId The redemption identifier
    /// @param reason The reason for default
    function flagRedemptionDefault(bytes32 redemptionId, bytes32 reason)
        external
        onlyRole(WATCHDOG_OPERATOR_ROLE)
    {
        if (redemptionId == bytes32(0)) revert InvalidRedemptionId();
        if (reason == bytes32(0)) revert ReasonRequired();

        QCRedeemer redeemer = QCRedeemer(
            protocolRegistry.getService(QC_REDEEMER_KEY)
        );

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

    /// @notice Change QC status (requires WATCHDOG_OPERATOR_ROLE)
    /// @dev Calls QCManager.setQCStatus() which requires this contract to have ARBITER_ROLE
    /// @param qc The QC address
    /// @param newStatus The new status
    /// @param reason The reason for change
    function changeQCStatus(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason
    ) external onlyRole(WATCHDOG_OPERATOR_ROLE) {
        if (qc == address(0)) revert InvalidQCAddress();
        if (reason == bytes32(0)) revert ReasonRequired();

        QCManager qcManager = QCManager(
            protocolRegistry.getService(QC_MANAGER_KEY)
        );

        qcManager.setQCStatus(qc, newStatus, reason);

        emit WatchdogQCStatusChange(
            qc,
            newStatus,
            reason,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Verify QC solvency and take action if needed (requires WATCHDOG_OPERATOR_ROLE)
    /// @dev Calls QCManager.verifyQCSolvency() which requires this contract to have ARBITER_ROLE
    /// @param qc The QC address
    /// @return solvent True if QC is solvent
    function verifySolvencyAndAct(address qc)
        external
        onlyRole(WATCHDOG_OPERATOR_ROLE)
        returns (bool solvent)
    {
        if (qc == address(0)) revert InvalidQCAddress();

        QCManager qcManager = QCManager(
            protocolRegistry.getService(QC_MANAGER_KEY)
        );

        solvent = qcManager.verifyQCSolvency(qc);

        if (!solvent) {
            emit WatchdogQCStatusChange(
                qc,
                QCData.QCStatus.UnderReview,
                "INSOLVENCY_DETECTED",
                msg.sender,
                block.timestamp
            );
        }

        return solvent;
    }

    /// @notice Strategic attestation for critical conditions
    /// @param qc The QC address
    /// @param balance The attested balance
    /// @param condition The critical condition triggering attestation
    function strategicAttestation(
        address qc,
        uint256 balance,
        string calldata condition
    ) external onlyRole(WATCHDOG_OPERATOR_ROLE) {
        // Strategic attestation only when critical:
        // 1. Insolvency detection
        // 2. Staleness prevention
        // 3. Wallet deregistration support

        bytes32 conditionHash = keccak256(abi.encodePacked(condition));

        if (
            conditionHash != keccak256("INSOLVENCY") &&
            conditionHash != keccak256("STALENESS") &&
            conditionHash != keccak256("DEREGISTRATION")
        ) {
            revert InvalidStrategicCondition();
        }

        this.attestReserves(qc, balance);
    }

    /// @notice Bulk handle multiple redemptions (emergency use)
    /// @param redemptionIds Array of redemption IDs
    /// @param fulfill True to fulfill, false to default
    /// @param reason Reason for bulk action
    function bulkHandleRedemptions(
        bytes32[] calldata redemptionIds,
        bool fulfill,
        bytes32 reason
    ) external onlyRole(WATCHDOG_OPERATOR_ROLE) {
        if (redemptionIds.length == 0) revert NoRedemptionsProvided();
        if (reason == bytes32(0)) revert ReasonRequired();

        QCRedeemer redeemer = QCRedeemer(
            protocolRegistry.getService(QC_REDEEMER_KEY)
        );

        for (uint256 i = 0; i < redemptionIds.length; i++) {
            bytes32 redemptionId = redemptionIds[i];

            if (fulfill) {
                // Use empty SPV proof for bulk operations (emergency only)
                // Create placeholder SPV data for bulk operations (emergency only)
                BitcoinTx.Info memory txInfo = BitcoinTx.Info({
                    version: bytes4(0),
                    inputVector: "",
                    outputVector: "",
                    locktime: bytes4(0)
                });

                BitcoinTx.Proof memory proof = BitcoinTx.Proof({
                    merkleProof: "",
                    txIndexInBlock: 0,
                    bitcoinHeaders: "",
                    coinbasePreimage: bytes32(0),
                    coinbaseProof: ""
                });

                redeemer.recordRedemptionFulfillment(
                    redemptionId,
                    "",
                    0,
                    txInfo,
                    proof
                );
                emit WatchdogRedemptionAction(
                    redemptionId,
                    "BULK_FULFILLED",
                    reason,
                    msg.sender,
                    block.timestamp
                );
            } else {
                redeemer.flagDefaultedRedemption(redemptionId, reason);
                emit WatchdogRedemptionAction(
                    redemptionId,
                    "BULK_DEFAULTED",
                    reason,
                    msg.sender,
                    block.timestamp
                );
            }

            redemptionHandlingTime[redemptionId] = block.timestamp;
        }
    }

    /// @notice Get Watchdog statistics
    /// @param qc The QC address
    /// @return stats Array containing [lastAttestationTime, attestationCount, isOperational]
    function getWatchdogStats(address qc)
        external
        view
        returns (uint256[3] memory stats)
    {
        stats[0] = lastAttestationTime[qc];
        stats[1] = attestationCount[qc];
        stats[2] = hasRole(WATCHDOG_OPERATOR_ROLE, msg.sender) ? 1 : 0;

        return stats;
    }

    /// @notice Check if Watchdog is operational
    /// @return operational True if Watchdog has necessary roles
    function isWatchdogOperational() external view returns (bool operational) {
        // Check if this contract has been granted the necessary roles
        // Note: This function intentionally returns false rather than reverting
        // when services are missing, as it's checking operational readiness
        
        // Check QCReserveLedger service and role
        if (!protocolRegistry.hasService(QC_RESERVE_LEDGER_KEY)) {
            return false; // Service not available - watchdog not operational
        }
        
        address ledgerAddress = protocolRegistry.getService(QC_RESERVE_LEDGER_KEY);
        QCReserveLedger reserveLedger = QCReserveLedger(ledgerAddress);
        if (!reserveLedger.hasRole(reserveLedger.ATTESTER_ROLE(), address(this))) {
            return false;
        }

        // Check QCManager service and roles
        if (!protocolRegistry.hasService(QC_MANAGER_KEY)) {
            return false; // Service not available - watchdog not operational
        }
        
        address managerAddress = protocolRegistry.getService(QC_MANAGER_KEY);
        QCManager qcManager = QCManager(managerAddress);
        if (!qcManager.hasRole(qcManager.REGISTRAR_ROLE(), address(this))) {
            return false;
        }
        if (!qcManager.hasRole(qcManager.ARBITER_ROLE(), address(this))) {
            return false;
        }

        // Check QCRedeemer service and role
        if (!protocolRegistry.hasService(QC_REDEEMER_KEY)) {
            return false; // Service not available - watchdog not operational
        }
        
        address redeemerAddress = protocolRegistry.getService(QC_REDEEMER_KEY);
        QCRedeemer redeemer = QCRedeemer(redeemerAddress);
        if (!redeemer.hasRole(redeemer.ARBITER_ROLE(), address(this))) {
            return false;
        }

        return true;
    }

    /// @notice Setup Watchdog roles (DAO only)
    /// @dev This function grants this contract the necessary roles in all system contracts
    function setupWatchdogRoles() external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Grant ATTESTER_ROLE in QCReserveLedger
        QCReserveLedger reserveLedger = QCReserveLedger(
            protocolRegistry.getService(QC_RESERVE_LEDGER_KEY)
        );
        reserveLedger.grantRole(reserveLedger.ATTESTER_ROLE(), address(this));

        // Grant REGISTRAR_ROLE and ARBITER_ROLE in QCManager
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

    /// @dev Parse SPV proof data from bytes into BitcoinTx structures
    /// @param spvProofData The encoded SPV proof data
    /// @return txInfo Bitcoin transaction information
    /// @return proof SPV proof of transaction inclusion
    function _parseSPVProof(bytes calldata spvProofData) 
        private 
        view 
        returns (BitcoinTx.Info memory txInfo, BitcoinTx.Proof memory proof) 
    {
        // Decode the SPV proof data expecting ABI-encoded BitcoinTx.Info and BitcoinTx.Proof
        // The spvProofData should contain both structures encoded together
        try this._decodeSPVProof(spvProofData) returns (
            BitcoinTx.Info memory decodedTxInfo,
            BitcoinTx.Proof memory decodedProof
        ) {
            return (decodedTxInfo, decodedProof);
        } catch {
            revert InvalidSPVProofData();
        }
    }

    /// @dev External function to decode SPV proof data (allows try/catch)
    /// @param spvProofData The encoded SPV proof data
    /// @return txInfo Bitcoin transaction information
    /// @return proof SPV proof of transaction inclusion
    function _decodeSPVProof(bytes calldata spvProofData)
        external
        pure
        returns (BitcoinTx.Info memory txInfo, BitcoinTx.Proof memory proof)
    {
        (txInfo, proof) = abi.decode(spvProofData, (BitcoinTx.Info, BitcoinTx.Proof));
    }

    /// @dev Verify wallet control via SPV proof using SPV validator
    /// @param qc The QC address claiming wallet control
    /// @param btcAddress The Bitcoin address being claimed
    /// @param challenge The expected challenge hash
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return verified True if verification successful
    function _verifyWalletControl(
        address qc,
        string calldata btcAddress,
        bytes32 challenge,
        BitcoinTx.Info memory txInfo,
        BitcoinTx.Proof memory proof
    ) private view returns (bool verified) {
        // Check if SPV validator service is available
        if (!protocolRegistry.hasService(SPV_VALIDATOR_KEY)) {
            revert SPVValidatorNotAvailable();
        }
        
        address validatorAddress = protocolRegistry.getService(SPV_VALIDATOR_KEY);
        ISPVValidator spvValidator = ISPVValidator(validatorAddress);
        return spvValidator.verifyWalletControl(
            qc,
            btcAddress,
            challenge,
            txInfo,
            proof
        );
    }
}
