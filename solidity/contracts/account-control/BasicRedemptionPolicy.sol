// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IRedemptionPolicy.sol";
import "./ProtocolRegistry.sol";
import "./QCManager.sol";
import "./QCData.sol";
import "./SystemState.sol";
import "../token/TBTC.sol";
import "../bridge/BitcoinTx.sol";
import "./interfaces/ISPVValidator.sol";

/// @title BasicRedemptionPolicy
/// @dev Basic implementation of IRedemptionPolicy interface.
/// Handles fulfillment verification with SPV proofs and default detection.
/// Demonstrates the Policy contract pattern for upgradeable redemption logic.
///
/// Role definitions:
/// - DEFAULT_ADMIN_ROLE: Can perform bulk operations on redemptions
/// - ARBITER_ROLE: Can record fulfillments and flag defaults
/// - REDEEMER_ROLE: Can request redemptions (typically granted to QCRedeemer contract)
contract BasicRedemptionPolicy is IRedemptionPolicy, AccessControl {
    enum BulkAction {
        FULFILL,
        DEFAULT
    }

    // Custom errors for gas-efficient reverts
    error InvalidRedemptionId();
    error RedemptionIdAlreadyUsed(bytes32 redemptionId);
    error InvalidBitcoinAddress(string btcAddress);
    error InvalidBitcoinAddressFormat(string btcAddress);
    error ValidationFailed(address user, address qc, uint256 amount);
    error RedemptionNotRequested(bytes32 redemptionId);
    error InvalidAmount(uint256 amount);
    error RedemptionAlreadyFulfilled(bytes32 redemptionId);
    error RedemptionAlreadyDefaulted(bytes32 redemptionId);
    error RedemptionsArePaused();
    error SPVVerificationFailed(bytes32 redemptionId);
    error InvalidReason();
    error NoRedemptionsProvided();
    error ReasonRequiredForDefault();
    error SPVValidatorNotAvailable();

    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    bytes32 public constant REDEEMER_ROLE = keccak256("REDEEMER_ROLE");

    // Service keys for ProtocolRegistry
    bytes32 public constant QC_MANAGER_KEY = keccak256("QC_MANAGER");
    bytes32 public constant QC_DATA_KEY = keccak256("QC_DATA");
    bytes32 public constant SYSTEM_STATE_KEY = keccak256("SYSTEM_STATE");
    bytes32 public constant TBTC_TOKEN_KEY = keccak256("TBTC_TOKEN");
    bytes32 public constant SPV_VALIDATOR_KEY = keccak256("SPV_VALIDATOR");

    ProtocolRegistry public immutable protocolRegistry;

    /// @dev Mapping to track requested redemptions
    mapping(bytes32 => bool) public requestedRedemptions;

    /// @dev Mapping to track fulfilled redemptions
    mapping(bytes32 => bool) public fulfilledRedemptions;

    /// @dev Mapping to track defaulted redemptions
    mapping(bytes32 => bytes32) public defaultedRedemptions; // redemptionId => reason

    /// @dev Emitted when a redemption is fulfilled
    event RedemptionFulfilledByPolicy(
        bytes32 indexed redemptionId,
        address indexed verifiedBy,
        uint256 indexed timestamp
    );

    /// @dev Emitted when a redemption is flagged as defaulted
    event RedemptionDefaultedByPolicy(
        bytes32 indexed redemptionId,
        bytes32 indexed reason,
        address indexed flaggedBy,
        uint256 timestamp
    );

    /// @dev Emitted when a redemption is requested
    event RedemptionRequested(
        bytes32 indexed redemptionId,
        address indexed qc,
        address indexed user,
        uint256 amount,
        string btcAddress,
        address requestedBy,
        uint256 timestamp
    );

    constructor(address _protocolRegistry) {
        protocolRegistry = ProtocolRegistry(_protocolRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ARBITER_ROLE, msg.sender);
        _grantRole(REDEEMER_ROLE, msg.sender);
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
    ) public view override returns (bool valid) {
        // Check basic inputs
        if (user == address(0) || qc == address(0) || amount == 0) {
            return false;
        }

        // Check system state
        SystemState systemState = SystemState(
            protocolRegistry.getService(SYSTEM_STATE_KEY)
        );
        if (systemState.isRedemptionPaused()) {
            return false;
        }

        // Check if amount is within bounds
        if (amount < systemState.minMintAmount()) {
            return false;
        }

        // Check QC status
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        if (!qcData.isQCRegistered(qc)) {
            return false;
        }

        // QC can be Active or UnderReview for redemptions (more permissive than minting)
        QCData.QCStatus qcStatus = qcData.getQCStatus(qc);
        if (
            qcStatus != QCData.QCStatus.Active &&
            qcStatus != QCData.QCStatus.UnderReview
        ) {
            return false;
        }

        // Check if user has sufficient tBTC balance
        TBTC tbtcToken = TBTC(protocolRegistry.getService(TBTC_TOKEN_KEY));
        if (tbtcToken.balanceOf(user) < amount) {
            return false;
        }

        return true;
    }

    /// @notice Request redemption of tBTC tokens
    /// @dev This function implements collision detection by tracking requested redemption IDs.
    ///      It validates the request but does not burn tokens - that's handled by the calling contract.
    ///      This separation prevents double-burning when called from QCRedeemer.
    /// @param redemptionId The unique identifier for this redemption (must be unique)
    /// @param qc The address of the Qualified Custodian handling the redemption
    /// @param user The address requesting the redemption (must have sufficient tBTC balance)
    /// @param amount The amount of tBTC to redeem (must be > 0 and >= minMintAmount)
    /// @param btcAddress The Bitcoin address to send redeemed Bitcoin to (must be non-empty)
    /// @return success True if the redemption request was accepted and recorded
    function requestRedemption(
        bytes32 redemptionId,
        address qc,
        address user,
        uint256 amount,
        string calldata btcAddress
    ) external onlyRole(REDEEMER_ROLE) returns (bool success) {
        // Validate redemption-specific inputs only
        if (redemptionId == bytes32(0)) {
            revert InvalidRedemptionId();
        }

        if (requestedRedemptions[redemptionId]) {
            revert RedemptionIdAlreadyUsed(redemptionId);
        }

        if (bytes(btcAddress).length == 0) {
            revert InvalidBitcoinAddress(btcAddress);
        }
        
        // Bitcoin address format check
        bytes memory addr = bytes(btcAddress);
        if (!(addr[0] == 0x31 || addr[0] == 0x33 || (addr[0] == 0x62 && addr.length > 1 && addr[1] == 0x63))) {
            revert InvalidBitcoinAddressFormat(btcAddress);
        }

        // Use validateRedemptionRequest for all other validation
        // This includes: zero address checks, amount validation, system state, QC status, and balance checks
        if (!validateRedemptionRequest(user, qc, amount)) {
            revert ValidationFailed(user, qc, amount);
        }

        // Record the redemption request to prevent ID collisions
        // This is a critical security feature that prevents duplicate redemptions
        requestedRedemptions[redemptionId] = true;

        // Note: Token burning is intentionally NOT done here to prevent double-burning.
        // The calling contract (QCRedeemer) handles token burning after successful validation.
        // This design allows for proper separation of concerns and prevents race conditions.

        // Emit event for external monitoring and indexing
        emit RedemptionRequested(
            redemptionId,
            qc,
            user,
            amount,
            btcAddress,
            msg.sender,
            block.timestamp
        );

        return true;
    }

    /// @notice Record fulfillment of a redemption request
    /// @dev This function marks a redemption as fulfilled after SPV proof verification.
    ///      Only callable by authorized arbiters to prevent unauthorized fulfillments.
    /// @param redemptionId The unique identifier of the redemption (must exist and be pending)
    /// @param userBtcAddress The user's Bitcoin address that should receive payment
    /// @param expectedAmount The expected payment amount in satoshis
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return success True if the fulfillment was successfully recorded
    function recordFulfillment(
        bytes32 redemptionId,
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external override onlyRole(ARBITER_ROLE) returns (bool success) {
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
            revert InvalidAmount(expectedAmount);
        }

        // State validation - prevent double processing
        if (fulfilledRedemptions[redemptionId]) {
            revert RedemptionAlreadyFulfilled(redemptionId);
        }

        if (defaultedRedemptions[redemptionId] != bytes32(0)) {
            revert RedemptionAlreadyDefaulted(redemptionId);
        }

        // System state validation
        SystemState systemState = SystemState(
            protocolRegistry.getService(SYSTEM_STATE_KEY)
        );
        if (systemState.isRedemptionPaused()) {
            revert RedemptionsArePaused();
        }

        // SPV proof verification
        if (!_verifySPVProof(redemptionId, userBtcAddress, expectedAmount, txInfo, proof)) {
            revert SPVVerificationFailed(redemptionId);
        }

        // State update - mark as fulfilled (no reentrancy risk due to external call placement)
        fulfilledRedemptions[redemptionId] = true;

        // Event emission for monitoring and indexing
        emit RedemptionFulfilledByPolicy(
            redemptionId,
            msg.sender,
            block.timestamp
        );

        return true;
    }

    /// @notice Flag a redemption as defaulted
    /// @dev This function marks a redemption as defaulted when it cannot be fulfilled.
    ///      Only callable by authorized arbiters with a valid reason.
    /// @param redemptionId The unique identifier of the redemption (must exist and be pending)
    /// @param reason The reason for the default (must be non-empty for audit trail)
    /// @return success True if the default was successfully flagged
    function flagDefault(bytes32 redemptionId, bytes32 reason)
        external
        override
        onlyRole(ARBITER_ROLE)
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

    /// @notice Get redemption timeout period
    /// @return timeout The timeout period in seconds
    function getRedemptionTimeout()
        external
        view
        override
        returns (uint256 timeout)
    {
        SystemState systemState = SystemState(
            protocolRegistry.getService(SYSTEM_STATE_KEY)
        );
        return systemState.redemptionTimeout();
    }

    /// @notice Check if a redemption is fulfilled
    /// @param redemptionId The redemption identifier
    /// @return fulfilled True if the redemption is fulfilled
    function isRedemptionFulfilled(bytes32 redemptionId)
        external
        view
        override
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
        override
        returns (bool defaulted, bytes32 reason)
    {
        reason = defaultedRedemptions[redemptionId];
        defaulted = reason != bytes32(0);
    }

    /// @notice Get comprehensive redemption status
    /// @param redemptionId The redemption identifier
    /// @return status The status of the redemption
    function getRedemptionStatus(bytes32 redemptionId)
        external
        view
        override
        returns (IRedemptionPolicy.RedemptionStatus status)
    {
        if (fulfilledRedemptions[redemptionId]) {
            return IRedemptionPolicy.RedemptionStatus.FULFILLED;
        } else if (defaultedRedemptions[redemptionId] != bytes32(0)) {
            return IRedemptionPolicy.RedemptionStatus.DEFAULTED;
        } else {
            return IRedemptionPolicy.RedemptionStatus.PENDING;
        }
    }

    /// @dev Verify SPV proof for redemption fulfillment using SPV validator
    /// @dev DESIGN NOTE: We use SPVValidator instead of calling Bridge directly
    ///      to avoid modifying the production Bridge contract. SPVValidator
    ///      replicates Bridge's exact SPV logic while providing a clean interface
    ///      for Account Control system needs.
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
        // Check if SPV validator service is available
        if (!protocolRegistry.hasService(SPV_VALIDATOR_KEY)) {
            revert SPVValidatorNotAvailable();
        }
        
        address validatorAddress = protocolRegistry.getService(SPV_VALIDATOR_KEY);
        ISPVValidator spvValidator = ISPVValidator(validatorAddress);
        return
            spvValidator.verifyRedemptionFulfillment(
                redemptionId,
                userBtcAddress,
                expectedAmount,
                txInfo,
                proof
            );
    }

    /// @notice Emergency function to bulk handle redemptions (DAO only)
    /// @param redemptionIds Array of redemption IDs
    /// @param action The action to perform on the redemptions (e.g., FULFILL, DEFAULT)
    /// @param reason Reason for bulk action, required for DEFAULT action
    function bulkHandleRedemptions(
        bytes32[] calldata redemptionIds,
        BulkAction action,
        bytes32 reason
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (redemptionIds.length == 0) {
            revert NoRedemptionsProvided();
        }

        if (action == BulkAction.DEFAULT && reason == bytes32(0)) {
            revert ReasonRequiredForDefault();
        }

        for (uint256 i = 0; i < redemptionIds.length; i++) {
            bytes32 redemptionId = redemptionIds[i];

            if (
                fulfilledRedemptions[redemptionId] ||
                defaultedRedemptions[redemptionId] != bytes32(0)
            ) {
                continue; // Skip already processed redemptions
            }

            if (action == BulkAction.FULFILL) {
                fulfilledRedemptions[redemptionId] = true;
                emit RedemptionFulfilledByPolicy(
                    redemptionId,
                    msg.sender,
                    block.timestamp
                );
            } else if (action == BulkAction.DEFAULT) {
                defaultedRedemptions[redemptionId] = reason;
                emit RedemptionDefaultedByPolicy(
                    redemptionId,
                    reason,
                    msg.sender,
                    block.timestamp
                );
            }
        }
    }

}
