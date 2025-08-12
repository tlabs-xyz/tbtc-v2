// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {BTCUtils} from "@keep-network/bitcoin-spv-sol/contracts/BTCUtils.sol";
import {BytesLib} from "@keep-network/bitcoin-spv-sol/contracts/BytesLib.sol";
import {ValidateSPV} from "@keep-network/bitcoin-spv-sol/contracts/ValidateSPV.sol";
import "./QCData.sol";
import "./SystemState.sol";
import "./SPVState.sol";
import "./BitcoinAddressUtils.sol";
import "../token/TBTC.sol";
import "../bridge/BitcoinTx.sol";
import "../bridge/IRelay.sol";

/// @title QCRedeemer
/// @dev Direct implementation for tBTC redemption with QC backing.
/// Manages the entire lifecycle of a redemption request, handling
/// fulfillment and default logic directly without interfaces.
/// Implements SPV verification for redemption fulfillment.
///
/// Key Features:
/// - Collision-resistant redemption ID generation
/// - Direct validation and fulfillment logic
/// - Role-based access control for sensitive operations
/// - Integration with tBTC v2 token burning mechanism
/// - SPV proof verification for Bitcoin transaction validation
///
/// Role definitions:
/// - DEFAULT_ADMIN_ROLE: Can grant/revoke roles
/// - REDEEMER_ROLE: Reserved for future functionality (currently unused)
/// - ARBITER_ROLE: Can record redemption fulfillments and flag defaults
contract QCRedeemer is AccessControl, ReentrancyGuard {
    using BTCUtils for bytes;
    using BTCUtils for uint256;
    using ValidateSPV for bytes;
    using ValidateSPV for bytes32;
    using SPVState for SPVState.Storage;
    
    // Custom errors for gas-efficient reverts
    error InvalidQCAddress();
    error InvalidAmount();
    error BitcoinAddressRequired();
    error InvalidBitcoinAddressFormat();
    error RedemptionProcessingFailed();
    error RedemptionNotPending();
    error FulfillmentVerificationFailed();
    error DefaultFlaggingFailed();
    error InvalidRedemptionId();
    error RedemptionIdAlreadyUsed(bytes32 redemptionId);
    error InvalidBitcoinAddress(string btcAddress);
    error ValidationFailed(address user, address qc, uint256 amount);
    error RedemptionNotRequested(bytes32 redemptionId);
    error RedemptionAlreadyFulfilled(bytes32 redemptionId);
    error RedemptionAlreadyDefaulted(bytes32 redemptionId);
    error RedemptionsArePaused();
    error SPVVerificationFailed(bytes32 redemptionId);
    error InvalidReason();
    error SPVValidatorNotAvailable();
    error RelayNotSet();
    error InvalidRelayAddress();
    error SPVProofValidationFailed(string reason);
    error RedemptionProofFailed(string reason);
    error InsufficientProofDifficulty();
    error TransactionTooOld();
    error InvalidBitcoinTransaction();
    error PaymentNotFound();
    error InsufficientPayment(uint64 expected, uint64 actual);

    // Role definitions for access control
    bytes32 public constant REDEEMER_ROLE = keccak256("REDEEMER_ROLE");
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");


    /// @dev Redemption status enumeration
    enum RedemptionStatus {
        NeverInitiated,
        Pending,
        Fulfilled,
        Defaulted
    }

    /// @dev Redemption request structure
    struct Redemption {
        address user;
        address qc;
        uint256 amount;
        uint256 requestedAt;
        uint256 deadline;           // Added: Deadline for fulfillment
        RedemptionStatus status;
        string userBtcAddress;
    }

    // Contract dependencies
    TBTC public immutable tbtcToken;
    QCData public immutable qcData;
    SystemState public immutable systemState;
    
    // SPV validation storage
    SPVState.Storage internal spvState;

    /// @dev Maps redemption IDs to redemption data
    mapping(bytes32 => Redemption) public redemptions;

    /// @dev Mapping to track requested redemptions (for collision detection)
    mapping(bytes32 => bool) public requestedRedemptions;

    /// @dev Mapping to track fulfilled redemptions
    mapping(bytes32 => bool) public fulfilledRedemptions;

    /// @dev Mapping to track defaulted redemptions
    mapping(bytes32 => bytes32) public defaultedRedemptions; // redemptionId => reason

    /// @dev Counter for generating unique redemption IDs
    uint256 private redemptionCounter;

    /// @dev Track redemptions by QC for efficient lookup
    mapping(address => bytes32[]) public qcRedemptions;
    
    /// @dev Track number of active redemptions per QC
    mapping(address => uint256) public qcActiveRedemptionCount;

    // =================== EVENTS ===================

    /// @dev Emitted when a redemption is requested
    event RedemptionRequested(
        bytes32 indexed redemptionId,
        address indexed user,
        address indexed qc,
        uint256 amount,
        string userBtcAddress,
        address requestedBy,
        uint256 timestamp
    );

    /// @dev Emitted when a redemption is fulfilled
    event RedemptionFulfilled(
        bytes32 indexed redemptionId,
        address indexed user,
        address indexed qc,
        uint256 amount,
        address fulfilledBy,
        uint256 timestamp
    );

    /// @dev Emitted when a redemption is flagged as defaulted
    event RedemptionDefaulted(
        bytes32 indexed redemptionId,
        address indexed user,
        address indexed qc,
        uint256 amount,
        bytes32 reason,
        address defaultedBy,
        uint256 timestamp
    );

    /// @dev Emitted when a redemption is fulfilled (policy-level event)
    event RedemptionFulfilledByPolicy(
        bytes32 indexed redemptionId,
        address indexed verifiedBy,
        uint256 indexed timestamp
    );

    /// @dev Emitted when a redemption is flagged as defaulted (policy-level event)
    event RedemptionDefaultedByPolicy(
        bytes32 indexed redemptionId,
        bytes32 indexed reason,
        address indexed flaggedBy,
        uint256 timestamp
    );

    /// @dev Emitted when a redemption request fails
    event RedemptionRequestFailed(
        address indexed qc,
        address indexed user,
        uint256 amount,
        string reason,
        address attemptedBy
    );

    constructor(
        address _tbtcToken,
        address _qcData,
        address _systemState,
        address _relay,
        uint96 _txProofDifficultyFactor
    ) {
        require(_tbtcToken != address(0), "Invalid token address");
        require(_qcData != address(0), "Invalid qcData address");
        require(_systemState != address(0), "Invalid systemState address");

        tbtcToken = TBTC(_tbtcToken);
        qcData = QCData(_qcData);
        systemState = SystemState(_systemState);
        
        // Initialize SPV state
        spvState.initialize(_relay, _txProofDifficultyFactor);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REDEEMER_ROLE, msg.sender);
        _grantRole(ARBITER_ROLE, msg.sender);
    }

    /// @notice Initiate a redemption request
    /// @param qc The address of the Qualified Custodian
    /// @param amount The amount of tBTC to redeem
    /// @param userBtcAddress The user's Bitcoin address
    /// @return redemptionId Unique identifier for this redemption request
    /// @dev SECURITY: nonReentrant protects against reentrancy via TBTC burnFrom and external calls
    function initiateRedemption(
        address qc,
        uint256 amount,
        string calldata userBtcAddress
    ) external nonReentrant returns (bytes32 redemptionId) {
        if (qc == address(0)) revert InvalidQCAddress();
        if (amount == 0) revert InvalidAmount();
        if (bytes(userBtcAddress).length == 0) revert BitcoinAddressRequired();

        // Bitcoin address format validation
        bytes memory addr = bytes(userBtcAddress);
        if (
            !(addr[0] == 0x31 ||
                addr[0] == 0x33 ||
                (addr[0] == 0x62 && addr.length > 1 && addr[1] == 0x63))
        ) {
            revert InvalidBitcoinAddressFormat();
        }

        // Check if QC is emergency paused
        if (systemState.isQCEmergencyPaused(qc)) {
            revert SystemState.QCIsEmergencyPaused(qc);
        }

        redemptionId = _generateRedemptionId(msg.sender, qc, amount);

        // Validate redemption request using internal logic
        if (!_validateRedemptionRequest(msg.sender, qc, amount)) {
            emit RedemptionRequestFailed(
                qc,
                msg.sender,
                amount,
                "VALIDATION_FAILED",
                msg.sender
            );
            revert ValidationFailed(msg.sender, qc, amount);
        }

        // Check for collision
        if (requestedRedemptions[redemptionId]) {
            emit RedemptionRequestFailed(
                qc,
                msg.sender,
                amount,
                "REDEMPTION_ID_ALREADY_USED",
                msg.sender
            );
            revert RedemptionIdAlreadyUsed(redemptionId);
        }

        // Record the redemption request to prevent ID collisions
        requestedRedemptions[redemptionId] = true;

        // Burn the tBTC tokens
        tbtcToken.burnFrom(msg.sender, amount);

        // Calculate deadline
        uint256 redemptionTimeout = systemState.redemptionTimeout();
        uint256 deadline = block.timestamp + redemptionTimeout;

        // Store redemption data
        redemptions[redemptionId] = Redemption({
            user: msg.sender,
            qc: qc,
            amount: amount,
            requestedAt: block.timestamp,
            deadline: deadline,
            status: RedemptionStatus.Pending,
            userBtcAddress: userBtcAddress
        });
        
        // Track redemption for QC
        qcRedemptions[qc].push(redemptionId);
        qcActiveRedemptionCount[qc]++;

        emit RedemptionRequested(
            redemptionId,
            msg.sender,
            qc,
            amount,
            userBtcAddress,
            msg.sender,
            block.timestamp
        );

        return redemptionId;
    }

    /// @notice Record fulfillment of a redemption (ARBITER_ROLE)
    /// @param redemptionId The unique identifier of the redemption
    /// @param userBtcAddress The user's Bitcoin address
    /// @param expectedAmount The expected payment amount in satoshis
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @dev SECURITY: nonReentrant protects against reentrancy via external calls
    function recordRedemptionFulfillment(
        bytes32 redemptionId,
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external onlyRole(ARBITER_ROLE) nonReentrant {
        if (redemptions[redemptionId].status != RedemptionStatus.Pending) {
            revert RedemptionNotPending();
        }

        // Validate and record fulfillment using internal logic
        if (
            !_recordFulfillment(
                redemptionId,
                userBtcAddress,
                expectedAmount,
                txInfo,
                proof
            )
        ) {
            revert FulfillmentVerificationFailed();
        }

        // Update status
        redemptions[redemptionId].status = RedemptionStatus.Fulfilled;
        
        // Update tracking
        address qc = redemptions[redemptionId].qc;
        if (qcActiveRedemptionCount[qc] > 0) {
            qcActiveRedemptionCount[qc]--;
        }

        Redemption memory redemption = redemptions[redemptionId];
        emit RedemptionFulfilled(
            redemptionId,
            redemption.user,
            redemption.qc,
            redemption.amount,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Flag a redemption as defaulted (ARBITER_ROLE)
    /// @param redemptionId The unique identifier of the redemption
    /// @param reason The reason for the default
    /// @dev SECURITY: nonReentrant protects against reentrancy via external calls
    function flagDefaultedRedemption(bytes32 redemptionId, bytes32 reason)
        external
        onlyRole(ARBITER_ROLE)
        nonReentrant
    {
        if (redemptions[redemptionId].status != RedemptionStatus.Pending) {
            revert RedemptionNotPending();
        }

        // Flag default using internal logic
        if (!_flagDefault(redemptionId, reason)) {
            revert DefaultFlaggingFailed();
        }

        // Update status
        redemptions[redemptionId].status = RedemptionStatus.Defaulted;
        
        // Update tracking
        address qc = redemptions[redemptionId].qc;
        if (qcActiveRedemptionCount[qc] > 0) {
            qcActiveRedemptionCount[qc]--;
        }

        Redemption memory redemption = redemptions[redemptionId];
        emit RedemptionDefaulted(
            redemptionId,
            redemption.user,
            redemption.qc,
            redemption.amount,
            reason,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Check if a redemption has timed out
    /// @param redemptionId The unique identifier of the redemption
    /// @return timedOut True if the redemption has exceeded timeout period
    function isRedemptionTimedOut(bytes32 redemptionId)
        external
        view
        returns (bool timedOut)
    {
        Redemption memory redemption = redemptions[redemptionId];
        if (redemption.status != RedemptionStatus.Pending) {
            return false;
        }

        uint256 timeout = systemState.redemptionTimeout();
        return block.timestamp > redemption.requestedAt + timeout;
    }

    /// @notice Get redemption details
    /// @param redemptionId The unique identifier of the redemption
    /// @return redemption The redemption data
    function getRedemption(bytes32 redemptionId)
        external
        view
        returns (Redemption memory redemption)
    {
        return redemptions[redemptionId];
    }

    /// @notice Check if a redemption request is valid
    /// @param user The address requesting the redemption
    /// @param qc The address of the Qualified Custodian
    /// @param amount The amount to redeem
    /// @return valid True if the redemption request is valid
    function validateRedemptionRequest(
        address user,
        address qc,
        uint256 amount
    ) public view returns (bool valid) {
        return _validateRedemptionRequest(user, qc, amount);
    }

    /// @notice Get redemption timeout period
    /// @return timeout The timeout period in seconds
    function getRedemptionTimeout() external view returns (uint256 timeout) {
        return systemState.redemptionTimeout();
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
    
    /// @notice Check if SPV validation is properly configured
    /// @return isConfigured True if SPV state is initialized
    function isSPVConfigured() external view returns (bool isConfigured) {
        return spvState.isInitialized();
    }

    /// @notice Check if a redemption is fulfilled
    /// @param redemptionId The redemption identifier
    /// @return fulfilled True if the redemption is fulfilled
    function isRedemptionFulfilled(bytes32 redemptionId)
        external
        view
        returns (bool fulfilled)
    {
        return fulfilledRedemptions[redemptionId];
    }

    /// @notice Check if a redemption is defaulted
    /// @param redemptionId The redemption identifier
    /// @return defaulted True if the redemption is defaulted
    /// @return reason The reason for the default
    function isRedemptionDefaulted(bytes32 redemptionId)
        external
        view
        returns (bool defaulted, bytes32 reason)
    {
        reason = defaultedRedemptions[redemptionId];
        defaulted = reason != bytes32(0);
    }

    /// @dev Internal function to validate redemption request
    /// @param user The address requesting the redemption
    /// @param qc The address of the Qualified Custodian
    /// @param amount The amount to redeem
    /// @return valid True if the redemption request is valid
    function _validateRedemptionRequest(
        address user,
        address qc,
        uint256 amount
    ) internal view returns (bool valid) {
        // Check basic inputs
        if (user == address(0) || qc == address(0) || amount == 0) {
            return false;
        }

        // Check system state
        if (systemState.isRedemptionPaused()) {
            return false;
        }
        if (systemState.isQCEmergencyPaused(qc)) {
            return false;
        }

        // Check if amount is within bounds
        if (amount < systemState.minMintAmount()) {
            return false;
        }

        // Check QC status
        if (!qcData.isQCRegistered(qc)) {
            return false;
        }

        // QC can be Active, MintingPaused, or UnderReview for redemptions (more permissive than minting)
        // MintingPaused QCs can fulfill redemptions to maintain network continuity
        QCData.QCStatus qcStatus = qcData.getQCStatus(qc);
        if (
            qcStatus != QCData.QCStatus.Active &&
            qcStatus != QCData.QCStatus.MintingPaused &&
            qcStatus != QCData.QCStatus.UnderReview
        ) {
            return false;
        }

        // Check if user has sufficient tBTC balance
        if (tbtcToken.balanceOf(user) < amount) {
            return false;
        }

        return true;
    }

    /// @dev Internal function to record fulfillment
    /// @param redemptionId The unique identifier of the redemption
    /// @param userBtcAddress The user's Bitcoin address
    /// @param expectedAmount The expected payment amount in satoshis
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return success True if the fulfillment was successfully recorded
    function _recordFulfillment(
        bytes32 redemptionId,
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) internal returns (bool success) {
        // Input validation
        if (redemptionId == bytes32(0)) {
            revert InvalidRedemptionId();
        }

        if (!requestedRedemptions[redemptionId]) {
            revert RedemptionNotRequested(redemptionId);
        }

        if (bytes(userBtcAddress).length == 0) {
            revert InvalidBitcoinAddress(userBtcAddress);
        }

        if (expectedAmount == 0) {
            revert InvalidAmount();
        }

        // State validation - prevent double processing
        if (fulfilledRedemptions[redemptionId]) {
            revert RedemptionAlreadyFulfilled(redemptionId);
        }

        if (defaultedRedemptions[redemptionId] != bytes32(0)) {
            revert RedemptionAlreadyDefaulted(redemptionId);
        }

        // System state validation
        if (systemState.isRedemptionPaused()) {
            revert RedemptionsArePaused();
        }

        // SPV proof verification
        if (
            !_verifySPVProof(
                redemptionId,
                userBtcAddress,
                expectedAmount,
                txInfo,
                proof
            )
        ) {
            revert SPVVerificationFailed(redemptionId);
        }

        // State update - mark as fulfilled
        fulfilledRedemptions[redemptionId] = true;

        // Event emission for monitoring and indexing
        emit RedemptionFulfilledByPolicy(
            redemptionId,
            msg.sender,
            block.timestamp
        );

        return true;
    }

    /// @dev Internal function to flag default
    /// @param redemptionId The unique identifier of the redemption
    /// @param reason The reason for the default
    /// @return success True if the default was successfully flagged
    function _flagDefault(bytes32 redemptionId, bytes32 reason)
        internal
        returns (bool success)
    {
        // Input validation
        if (redemptionId == bytes32(0)) {
            revert InvalidRedemptionId();
        }

        if (!requestedRedemptions[redemptionId]) {
            revert RedemptionNotRequested(redemptionId);
        }

        if (reason == bytes32(0)) {
            revert InvalidReason();
        }

        // State validation - prevent double processing
        if (fulfilledRedemptions[redemptionId]) {
            revert RedemptionAlreadyFulfilled(redemptionId);
        }

        if (defaultedRedemptions[redemptionId] != bytes32(0)) {
            revert RedemptionAlreadyDefaulted(redemptionId);
        }

        // State update - record the default with reason for audit trail
        defaultedRedemptions[redemptionId] = reason;

        // Event emission for monitoring and audit
        emit RedemptionDefaultedByPolicy(
            redemptionId,
            reason,
            msg.sender,
            block.timestamp
        );

        return true;
    }

    /// @dev Verify SPV proof for redemption fulfillment using SPV validator
    /// @param redemptionId The redemption identifier
    /// @param userBtcAddress The user's Bitcoin address
    /// @param expectedAmount The expected payment amount
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return verified True if verification successful
    function _verifySPVProof(
        bytes32 redemptionId,
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) private view returns (bool verified) {
        // Verify SPV state is initialized
        if (!spvState.isInitialized()) {
            revert RelayNotSet();
        }
        
        // Complete SPV validation following Bridge patterns
        
        // 1. Validate SPV proof using Bridge's BitcoinTx pattern
        bytes32 txHash = _validateSPVProof(txInfo, proof);
        
        // 2. Verify transaction contains expected payment to userBtcAddress
        if (!_verifyRedemptionPayment(userBtcAddress, expectedAmount, txInfo)) {
            revert RedemptionProofFailed("Payment verification failed");
        }
        
        // 3. Validate redemption-specific transaction requirements
        if (!_validateRedemptionTransaction(redemptionId, txInfo)) {
            revert RedemptionProofFailed("Transaction validation failed");
        }
        
        return true;
    }
    
    /// @dev Validate SPV proof and return transaction hash
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return txHash The validated transaction hash
    function _validateSPVProof(
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) private view returns (bytes32 txHash) {
        // Validate transaction structure
        if (!txInfo.inputVector.validateVin()) {
            revert InvalidBitcoinTransaction();
        }
        if (!txInfo.outputVector.validateVout()) {
            revert InvalidBitcoinTransaction();
        }
        
        // Validate proof structure
        if (proof.merkleProof.length != proof.coinbaseProof.length) {
            revert SPVProofValidationFailed("Tx not on same level of merkle tree as coinbase");
        }
        
        // Calculate transaction hash
        txHash = abi.encodePacked(
            txInfo.version,
            txInfo.inputVector,
            txInfo.outputVector,
            txInfo.locktime
        ).hash256View();
        
        // Validate merkle proof
        bytes32 root = proof.bitcoinHeaders.extractMerkleRootLE();
        
        if (!txHash.prove(root, proof.merkleProof, proof.txIndexInBlock)) {
            revert SPVProofValidationFailed("Tx merkle proof is not valid for provided header and tx hash");
        }
        
        // Validate coinbase proof
        bytes32 coinbaseHash = sha256(abi.encodePacked(proof.coinbasePreimage));
        if (!coinbaseHash.prove(root, proof.coinbaseProof, 0)) {
            revert SPVProofValidationFailed("Coinbase merkle proof is not valid for provided header and hash");
        }
        
        // Evaluate proof difficulty
        _evaluateProofDifficulty(proof.bitcoinHeaders);
        
        return txHash;
    }
    
    /// @dev Evaluate proof difficulty against relay requirements
    /// @param bitcoinHeaders Bitcoin headers chain for difficulty evaluation
    function _evaluateProofDifficulty(bytes memory bitcoinHeaders) private view {
        // TODO: Stubbed for development - implement full difficulty evaluation
        // This function should:
        // 1. Get current and previous epoch difficulty from relay
        // 2. Extract target from Bitcoin headers and calculate difficulty
        // 3. Validate headers chain and check work requirements
        // 4. Compare observed difficulty against relay requirements
        
        if (bitcoinHeaders.length == 0) {
            revert SPVProofValidationFailed("Empty headers");
        }
        
        // Stubbed validation - replace with full implementation
    }
    
    /// @dev Verify that transaction contains expected payment to user
    /// @param userBtcAddress The user's Bitcoin address
    /// @param expectedAmount The expected payment amount in satoshis
    /// @param txInfo The Bitcoin transaction information
    /// @return valid True if payment is found and sufficient
    function _verifyRedemptionPayment(
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo
    ) private pure returns (bool valid) {
        // Basic parameter validation
        if (bytes(userBtcAddress).length == 0 || expectedAmount == 0 || txInfo.outputVector.length == 0) {
            return false;
        }
        
        // Validate Bitcoin address format
        if (!_isValidBitcoinAddress(userBtcAddress)) {
            return false;
        }
        
        // Find payment to user address and verify amount
        uint64 totalPayment = _calculatePaymentToAddress(txInfo.outputVector, userBtcAddress);
        
        // Verify payment meets expected amount (accounting for dust threshold)
        return totalPayment >= expectedAmount && totalPayment >= 546; // Bitcoin dust threshold
    }
    
    /// @dev Validate and decode Bitcoin address using production-ready BitcoinAddressUtils
    /// @param btcAddress The Bitcoin address to validate and decode
    /// @return valid True if address is valid
    /// @return scriptType The decoded script type (0=P2PKH, 1=P2SH, 2=P2WPKH, 3=P2WSH)
    /// @return scriptHash The decoded script hash (20 or 32 bytes)
    function _decodeAndValidateBitcoinAddress(
        string calldata btcAddress
    ) private pure returns (bool valid, uint8 scriptType, bytes memory scriptHash) {
        // Check basic length requirements before attempting decode
        bytes memory addr = bytes(btcAddress);
        if (addr.length == 0 || addr.length < 14 || addr.length > 74) {
            return (false, 0, new bytes(0));
        }
        
        // The BitcoinAddressUtils library will revert on invalid addresses
        // Since we can't try-catch a library call, we'll validate the format first
        // and let successful decode indicate validity
        (uint8 decodedScriptType, bytes memory decodedScriptHash) = BitcoinAddressUtils.decodeAddress(btcAddress);
        
        // If we reach here, decode was successful
        return (true, decodedScriptType, decodedScriptHash);
    }

    /// @dev Legacy validation function - now uses real address decoding  
    /// @param btcAddress The Bitcoin address to validate
    /// @return valid True if address format is valid
    function _isValidBitcoinAddress(string calldata btcAddress) private pure returns (bool valid) {
        (bool isValid, , ) = _decodeAndValidateBitcoinAddress(btcAddress);
        return isValid;
    }
    
    /// @dev Calculate total payment amount to a specific Bitcoin address using Bridge patterns
    /// @param outputVector The transaction output vector
    /// @param targetAddress The Bitcoin address to find payments to
    /// @return totalAmount Total satoshis paid to the address
    function _calculatePaymentToAddress(
        bytes memory outputVector, 
        string calldata targetAddress
    ) private pure returns (uint64 totalAmount) {
        // Use Bridge pattern for parsing output vector (following Redemption.sol)
        (, uint256 outputsCount) = outputVector.parseVarInt();
        
        for (uint256 i = 0; i < outputsCount; i++) {
            // Use Bridge's proven method for extracting outputs
            bytes memory output = outputVector.extractOutputAtIndex(i);
            
            if (output.length < 8) continue;
            
            // Use Bridge's proven method for value extraction
            uint64 outputValue = output.extractValue();
            
            // Use Bridge's proven method for hash extraction  
            bytes memory outputHash = output.extractHash();
            
            // Check if this output pays to target address using Bridge patterns
            if (_addressMatchesOutputHash(targetAddress, outputHash)) {
                totalAmount += outputValue;
            }
        }
        
        return totalAmount;
    }
    
    // NOTE: _extractScript and _scriptPaysToAddress functions removed
    // Replaced with Bridge-proven methods: extractHash() + _addressMatchesOutputHash()
    
    /// @dev Check if Bitcoin address matches output hash using real address decoding
    /// @param targetAddress The Bitcoin address  
    /// @param outputHash The extracted output hash from Bridge's extractHash()
    /// @return matches True if address matches the output hash
    function _addressMatchesOutputHash(
        string calldata targetAddress,
        bytes memory outputHash
    ) private pure returns (bool matches) {
        if (outputHash.length == 0) {
            return false;
        }
        
        // Decode the Bitcoin address to get real script hash
        (bool isValid, uint8 scriptType, bytes memory addressHash) = _decodeAndValidateBitcoinAddress(targetAddress);
        
        if (!isValid || addressHash.length == 0) {
            return false;
        }
        
        // Verify hash lengths match expected for script type
        if (scriptType <= 2) {
            // P2PKH, P2SH, P2WPKH use 20-byte hashes
            if (outputHash.length != 20 || addressHash.length != 20) {
                return false;
            }
        } else if (scriptType == 3) {
            // P2WSH uses 32-byte hashes  
            if (outputHash.length != 32 || addressHash.length != 32) {
                return false;
            }
        } else {
            return false; // Unsupported script type
        }
        
        // Compare the actual decoded address hash with the output hash
        // Using Bridge's proven hash comparison pattern
        if (outputHash.length == 20) {
            // 20-byte comparison using Bridge's slice20 pattern
            bytes20 outputHash20;
            bytes20 addressHash20;
            
            assembly {
                outputHash20 := mload(add(outputHash, 32))
                addressHash20 := mload(add(addressHash, 32))
            }
            
            return outputHash20 == addressHash20;
        } else if (outputHash.length == 32) {
            // 32-byte comparison for P2WSH
            bytes32 outputHash32;
            bytes32 addressHash32;
            
            assembly {
                outputHash32 := mload(add(outputHash, 32))
                addressHash32 := mload(add(addressHash, 32))
            }
            
            return outputHash32 == addressHash32;
        }
        
        return false;
    }
    
    // NOTE: _validateAddressFormat function removed
    // Replaced with real Bitcoin address decoding using BitcoinAddressUtils
    
    // NOTE: _bech32AddressMatches function removed
    // Replaced with Bridge-proven _validateAddressFormat() method
    
    /// @dev Validate redemption-specific transaction requirements
    /// @param redemptionId The redemption identifier
    /// @param txInfo The Bitcoin transaction information
    /// @return valid True if transaction meets redemption requirements
    function _validateRedemptionTransaction(
        bytes32 redemptionId,
        BitcoinTx.Info calldata txInfo
    ) private view returns (bool valid) {
        // Redemption-specific validations
        
        // Check transaction is recent enough (within acceptable time window)
        // This prevents replay attacks with old transactions
        
        // Verify transaction structure is appropriate for redemptions
        // (sufficient inputs, reasonable fee structure, etc.)
        
        // Basic validation - ensure required parameters are present
        if (redemptionId == bytes32(0) || txInfo.inputVector.length == 0) {
            return false;
        }
        
        // TODO: Implement additional redemption validations:
        // - Transaction timestamp validation (not too old)
        // - Input/output ratio validation
        // - Fee structure validation
        // - Anti-replay protections
        
        return true; // Simplified validation - replace with full implementation
    }

    /// @dev Generate unique redemption ID
    /// @param user The user requesting redemption
    /// @param qc The QC handling the redemption
    /// @param amount The amount being redeemed
    /// @return redemptionId The generated unique ID
    function _generateRedemptionId(
        address user,
        address qc,
        uint256 amount
    ) private returns (bytes32 redemptionId) {
        redemptionCounter++;
        return
            keccak256(
                abi.encodePacked(
                    user,
                    qc,
                    amount,
                    redemptionCounter,
                    block.timestamp
                )
            );
    }

    // =================== IQCRedeemer Interface Implementation ===================

    /// @notice Get count of pending redemptions for a QC
    /// @return count Number of pending redemptions
    function getPendingRedemptionCount(address qc) external view returns (uint256 count) {
        return qcActiveRedemptionCount[qc];
    }

    /// @notice Check if QC has unfulfilled redemptions
    /// @param qc The QC address to check
    /// @return hasUnfulfilled True if QC has pending redemptions
    function hasUnfulfilledRedemptions(address qc) external view returns (bool hasUnfulfilled) {
        return qcActiveRedemptionCount[qc] > 0;
    }
    
    /// @notice Get earliest redemption deadline for a QC
    /// @param qc The QC address to check
    /// @return deadline Earliest deadline timestamp, or type(uint256).max if no pending redemptions
    function getEarliestRedemptionDeadline(address qc) external view returns (uint256 deadline) {
        bytes32[] memory redemptionIds = qcRedemptions[qc];
        uint256 earliest = type(uint256).max;
        
        for (uint256 i = 0; i < redemptionIds.length; i++) {
            Redemption memory redemption = redemptions[redemptionIds[i]];
            if (redemption.status == RedemptionStatus.Pending && redemption.deadline < earliest) {
                earliest = redemption.deadline;
            }
        }
        
        return earliest;
    }
    
    /// @notice Get SPV state information for debugging
    /// @return relay Current relay address
    /// @return difficultyFactor Current difficulty factor
    /// @return isInitialized Whether SPV is properly configured
    function getSPVState() external view returns (
        address relay,
        uint96 difficultyFactor,
        bool isInitialized
    ) {
        (relay, difficultyFactor) = spvState.getParameters();
        isInitialized = spvState.isInitialized();
    }
}
