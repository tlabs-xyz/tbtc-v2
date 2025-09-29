// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./QCData.sol";
import "./SystemState.sol";
import "./SPVState.sol";
import "../token/TBTC.sol";
import "../bridge/BitcoinTx.sol";
import {QCRedeemerSPV} from "./libraries/QCRedeemerSPV.sol";
import "./AccountControl.sol";
import "./QCManagerErrors.sol";

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
/// - Integration with tBTC token burning mechanism
/// - SPV proof verification for Bitcoin transaction validation
/// - Wallet Obligation Tracking System (WOTS) for preventing wallet abandonment
///
/// WOTS Design Notes:
/// - Uses dual tracking: arrays for history + counters for active obligations
/// - Prioritizes gas efficiency (O(1) obligation checks) over storage efficiency
/// - Arrays never shrink but counters are accurately maintained
/// - This prevents wallet de-registration while having redemption obligations
///
/// Role definitions:
/// - DEFAULT_ADMIN_ROLE: Can grant/revoke roles
/// - DISPUTE_ARBITER_ROLE: Can record redemption fulfillments and flag defaults
contract QCRedeemer is AccessControl, ReentrancyGuard {
    using SPVState for SPVState.Storage;
    
    // Custom errors for gas-efficient reverts
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
    bytes32 public constant DISPUTE_ARBITER_ROLE = keccak256("DISPUTE_ARBITER_ROLE");

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
        string qcWalletAddress;     // Added: QC's chosen wallet for this redemption
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
    
    /// @dev Track redemptions by wallet for obligation management
    /// @notice KNOWN LIMITATION: Arrays don't shrink after fulfillment/default
    ///         This causes gas costs to increase over time as arrays grow.
    ///         Mitigation: Use counter for obligation checks (O(1) complexity).
    ///         Future improvement: Implement array cleanup or use EnumerableSet.
    mapping(string => bytes32[]) public walletActiveRedemptions;
    
    /// @dev Track number of active redemptions per wallet
    /// @notice This counter is properly decremented on fulfillment/default,
    ///         providing accurate obligation tracking despite array growth.
    mapping(string => uint256) public walletActiveRedemptionCount;
    
    // Account Control Integration
    /// @dev Address of the Account Control contract
    address public accountControl;

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
    
    /// @dev Emitted when a redemption is assigned to a specific wallet
    event RedemptionAssignedToWallet(
        bytes32 indexed redemptionId,
        address indexed qc,
        string walletAddress,
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

    // Account Control Events
    /// @dev Emitted when Account Control address is updated
    event AccountControlUpdated(address indexed oldAddress, address indexed newAddress, address changedBy, uint256 timestamp);

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
        _grantRole(DISPUTE_ARBITER_ROLE, msg.sender);
    }

    /// @notice Initiate a redemption request
    /// @param qc The address of the Qualified Custodian
    /// @param amount The amount of tBTC to redeem
    /// @param userBtcAddress The user's Bitcoin address
    /// @param qcWalletAddress The QC's Bitcoin wallet that will handle this redemption
    /// @return redemptionId Unique identifier for this redemption request
    /// @dev SECURITY: nonReentrant protects against reentrancy via TBTC burnFrom and external calls
    function initiateRedemption(
        address qc,
        uint256 amount,
        string calldata userBtcAddress,
        string calldata qcWalletAddress
    ) external nonReentrant returns (bytes32 redemptionId) {
        if (qc == address(0)) revert QCManagerErrors.InvalidQCAddress();
        if (amount == 0) revert InvalidAmount();
        if (bytes(userBtcAddress).length == 0) revert BitcoinAddressRequired();
        if (bytes(qcWalletAddress).length == 0) revert BitcoinAddressRequired();

        // Bitcoin address format validation for user address
        bytes memory addr = bytes(userBtcAddress);
        if (
            !(addr[0] == 0x31 ||
                addr[0] == 0x33 ||
                (addr[0] == 0x62 && addr.length > 1 && addr[1] == 0x63))
        ) {
            revert InvalidBitcoinAddressFormat();
        }
        
        // Bitcoin address format validation for QC wallet address
        bytes memory qcAddr = bytes(qcWalletAddress);
        if (
            !(qcAddr[0] == 0x31 ||
                qcAddr[0] == 0x33 ||
                (qcAddr[0] == 0x62 && qcAddr.length > 1 && qcAddr[1] == 0x63))
        ) {
            revert InvalidBitcoinAddressFormat();
        }
        
        // Validate QC wallet is registered and active
        require(qcData.getWalletOwner(qcWalletAddress) == qc, "Wallet not registered to QC");
        require(
            qcData.getWalletStatus(qcWalletAddress) == QCData.WalletStatus.Active,
            "Wallet not active"
        );

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

        // Notify AccountControl of redemption
        require(accountControl != address(0), "AccountControl not set");
        AccountControl(accountControl).redeemTBTC(amount);

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
            userBtcAddress: userBtcAddress,
            qcWalletAddress: qcWalletAddress
        });
        
        // Track redemption for QC
        qcRedemptions[qc].push(redemptionId);
        qcActiveRedemptionCount[qc]++;
        
        // Track redemption for wallet
        walletActiveRedemptions[qcWalletAddress].push(redemptionId);
        walletActiveRedemptionCount[qcWalletAddress]++;

        emit RedemptionRequested(
            redemptionId,
            msg.sender,
            qc,
            amount,
            userBtcAddress,
            msg.sender,
            block.timestamp
        );
        
        emit RedemptionAssignedToWallet(
            redemptionId,
            qc,
            qcWalletAddress,
            block.timestamp
        );

        return redemptionId;
    }

    /// @notice Record fulfillment of a redemption (DISPUTE_ARBITER_ROLE)
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
    ) external onlyRole(DISPUTE_ARBITER_ROLE) nonReentrant {
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
        
        // No action needed here
        // Tokens were already burned during initiation (tbtcToken.burnFrom)
        // Backing will be updated in ReserveOracle when BTC reserves decrease
        // This maintains proper invariant: backing >= minted
        
        // Update tracking for QC
        address qc = redemptions[redemptionId].qc;
        if (qcActiveRedemptionCount[qc] > 0) {
            qcActiveRedemptionCount[qc]--;
        }
        
        // Update tracking for wallet
        string memory qcWalletAddress = redemptions[redemptionId].qcWalletAddress;
        if (walletActiveRedemptionCount[qcWalletAddress] > 0) {
            walletActiveRedemptionCount[qcWalletAddress]--;
            // NOTE: We decrement the counter but don't remove from walletActiveRedemptions array
            // This is intentional for V1 to keep logic simple and gas costs predictable
            // The counter provides accurate obligation tracking for hasWalletObligations()
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

    /// @notice Flag a redemption as defaulted (DISPUTE_ARBITER_ROLE)
    /// @param redemptionId The unique identifier of the redemption
    /// @param reason The reason for the default
    /// @dev SECURITY: nonReentrant protects against reentrancy via external calls
    function flagDefaultedRedemption(bytes32 redemptionId, bytes32 reason)
        external
        onlyRole(DISPUTE_ARBITER_ROLE)
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
        
        // Update tracking for QC
        address qc = redemptions[redemptionId].qc;
        if (qcActiveRedemptionCount[qc] > 0) {
            qcActiveRedemptionCount[qc]--;
        }
        
        // Update tracking for wallet
        string memory qcWalletAddress = redemptions[redemptionId].qcWalletAddress;
        if (walletActiveRedemptionCount[qcWalletAddress] > 0) {
            walletActiveRedemptionCount[qcWalletAddress]--;
            // NOTE: We decrement the counter but don't remove from walletActiveRedemptions array
            // This is intentional for V1 to keep logic simple and gas costs predictable
            // The counter provides accurate obligation tracking for hasWalletObligations()
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

        // Validate BTC address matches the originally requested address
        if (
            keccak256(bytes(userBtcAddress)) !=
            keccak256(bytes(redemptions[redemptionId].userBtcAddress))
        ) {
            revert RedemptionProofFailed("USER_ADDRESS_MISMATCH");
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
        // Note: _verifySPVProof now reverts with RedemptionProofFailed on any error
        _verifySPVProof(
            redemptionId,
            userBtcAddress,
            expectedAmount,
            txInfo,
            proof
        );

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
        
        // Complete SPV validation using library
        
        // 1. Validate SPV proof using library
        // First try the safe validation to check if it would fail
        (bool spvSuccess, bytes32 txHash) = QCRedeemerSPV.validateSPVProofSafe(spvState, txInfo, proof);
        if (!spvSuccess) {
            revert RedemptionProofFailed("SPV proof validation failed");
        }
        
        // 2. Verify transaction contains expected payment to userBtcAddress
        if (!QCRedeemerSPV.verifyRedemptionPayment(userBtcAddress, expectedAmount, txInfo)) {
            revert RedemptionProofFailed("Payment verification failed");
        }
        
        // 3. Validate redemption-specific transaction requirements
        Redemption memory redemption = redemptions[redemptionId];
        if (!QCRedeemerSPV.validateRedemptionTransaction(uint8(redemption.status), txInfo)) {
            revert RedemptionProofFailed("Transaction validation failed");
        }
        
        return true;
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
    
    // =================== Wallet Obligation Management ===================
    
    /// @notice Check if a wallet has unfulfilled redemption obligations
    /// @param walletAddress The Bitcoin wallet address to check
    /// @return hasObligations True if wallet has pending redemptions
    /// @dev CRITICAL FUNCTION: Used by QCManager to prevent wallet de-registration.
    ///      This relies on walletActiveRedemptionCount being accurately maintained.
    ///      Counter is decremented on fulfillment/default but arrays are not cleaned up.
    ///      This design choice prioritizes gas efficiency (O(1)) over storage efficiency.
    function hasWalletObligations(string calldata walletAddress) 
        external 
        view 
        returns (bool hasObligations) 
    {
        return walletActiveRedemptionCount[walletAddress] > 0;
    }
    
    /// @notice Get count of pending redemptions for a wallet
    /// @param walletAddress The Bitcoin wallet address to check
    /// @return count Number of pending redemptions
    function getWalletPendingRedemptionCount(string calldata walletAddress) 
        external 
        view 
        returns (uint256 count) 
    {
        return walletActiveRedemptionCount[walletAddress];
    }
    
    /// @notice Get earliest redemption deadline for a wallet
    /// @param walletAddress The Bitcoin wallet address to check
    /// @return deadline Earliest deadline timestamp, or type(uint256).max if no pending redemptions
    /// @notice GAS WARNING: This function iterates through ALL redemption IDs for a wallet,
    ///         including fulfilled/defaulted ones. Gas cost increases over time as array grows.
    ///         For production use, consider caching results or implementing array cleanup.
    function getWalletEarliestRedemptionDeadline(string calldata walletAddress) 
        external 
        view 
        returns (uint256 deadline) 
    {
        bytes32[] memory redemptionIds = walletActiveRedemptions[walletAddress];
        uint256 earliest = type(uint256).max;
        
        for (uint256 i = 0; i < redemptionIds.length; i++) {
            Redemption memory redemption = redemptions[redemptionIds[i]];
            if (redemption.status == RedemptionStatus.Pending && redemption.deadline < earliest) {
                earliest = redemption.deadline;
            }
        }
        
        return earliest;
    }
    
    /// @notice Get detailed obligation information for a wallet
    /// @param walletAddress The Bitcoin wallet address to check
    /// @return activeCount Number of active redemptions
    /// @return totalAmount Total tBTC amount being redeemed
    /// @return earliestDeadline Earliest redemption deadline
    /// @notice GAS WARNING: This function iterates through ALL redemption IDs for a wallet.
    ///         Consider using getWalletPendingRedemptionCount() alone for basic checks.
    function getWalletObligationDetails(string calldata walletAddress)
        external
        view
        returns (
            uint256 activeCount,
            uint256 totalAmount,
            uint256 earliestDeadline
        )
    {
        activeCount = walletActiveRedemptionCount[walletAddress];
        bytes32[] memory redemptionIds = walletActiveRedemptions[walletAddress];
        
        earliestDeadline = type(uint256).max;
        totalAmount = 0;
        
        // NOTE: This loops through ALL redemption IDs, including non-pending ones
        // Counter provides accurate activeCount, but we need to iterate for amounts/deadlines
        for (uint256 i = 0; i < redemptionIds.length; i++) {
            Redemption memory redemption = redemptions[redemptionIds[i]];
            if (redemption.status == RedemptionStatus.Pending) {
                totalAmount += redemption.amount;
                if (redemption.deadline < earliestDeadline) {
                    earliestDeadline = redemption.deadline;
                }
            }
        }
    }
    
    /// @notice Get all redemption IDs for a wallet
    /// @param walletAddress The Bitcoin wallet address to check
    /// @return redemptionIds Array of ALL redemption IDs (including fulfilled/defaulted)
    /// @dev IMPORTANT: Returns all redemption IDs including fulfilled/defaulted ones.
    ///      Array never shrinks, so this includes historical redemptions.
    ///      Caller must check redemption status to filter active ones.
    ///      For active count only, use getWalletPendingRedemptionCount() instead.
    /// @notice GAS WARNING: Array size grows over time and never shrinks.
    function getWalletRedemptions(string calldata walletAddress)
        external
        view
        returns (bytes32[] memory)
    {
        return walletActiveRedemptions[walletAddress];
    }

    // =================== CONFIGURATION FUNCTIONS ===================


    /// @notice Set the Account Control contract address
    /// @param _accountControl The address of the Account Control contract
    /// @dev Only DEFAULT_ADMIN_ROLE can call this function
    function setAccountControl(address _accountControl) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldAddress = accountControl;
        accountControl = _accountControl;
        emit AccountControlUpdated(oldAddress, _accountControl, msg.sender, block.timestamp);
    }
}
