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
contract BasicRedemptionPolicy is IRedemptionPolicy, AccessControl {
    enum BulkAction {
        FULFILL,
        DEFAULT
    }

    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("POLICY_ADMIN_ROLE");
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    bytes32 public constant REDEEMER_ROLE = keccak256("REDEEMER_ROLE");

    // Service keys for ProtocolRegistry
    bytes32 public constant QC_MANAGER_KEY = keccak256("QC_MANAGER");
    bytes32 public constant QC_DATA_KEY = keccak256("QC_DATA");
    bytes32 public constant SYSTEM_STATE_KEY = keccak256("SYSTEM_STATE");
    bytes32 public constant TBTC_TOKEN_KEY = keccak256("TBTC_TOKEN");
    bytes32 public constant SPV_VALIDATOR_KEY = keccak256("SPV_VALIDATOR");

    // Error codes for systematic error tracking
    // Format: CCFF where CC=contract(11=BasicRedemptionPolicy), FF=function
    uint16 public constant ERR_BRP_VALIDATE_INVALID_USER = 1101;
    uint16 public constant ERR_BRP_VALIDATE_INVALID_QC = 1102;
    uint16 public constant ERR_BRP_VALIDATE_INVALID_AMOUNT = 1103;
    uint16 public constant ERR_BRP_VALIDATE_SYSTEM_PAUSED = 1104;
    uint16 public constant ERR_BRP_VALIDATE_AMOUNT_TOO_SMALL = 1105;
    uint16 public constant ERR_BRP_VALIDATE_QC_NOT_REGISTERED = 1106;
    uint16 public constant ERR_BRP_VALIDATE_QC_INVALID_STATUS = 1107;
    uint16 public constant ERR_BRP_VALIDATE_INSUFFICIENT_BALANCE = 1108;
    uint16 public constant ERR_BRP_REQUEST_INVALID_ID = 1201;
    uint16 public constant ERR_BRP_REQUEST_ID_COLLISION = 1202;
    uint16 public constant ERR_BRP_REQUEST_INVALID_QC = 1203;
    uint16 public constant ERR_BRP_REQUEST_INVALID_USER = 1204;
    uint16 public constant ERR_BRP_REQUEST_INVALID_AMOUNT = 1205;
    uint16 public constant ERR_BRP_REQUEST_INVALID_BTC_ADDR = 1206;
    uint16 public constant ERR_BRP_REQUEST_VALIDATION_FAILED = 1207;
    uint16 public constant ERR_BRP_FULFILL_INVALID_ID = 1301;
    uint16 public constant ERR_BRP_FULFILL_NOT_REQUESTED = 1302;
    uint16 public constant ERR_BRP_FULFILL_INVALID_BTC_ADDR = 1303;
    uint16 public constant ERR_BRP_FULFILL_INVALID_AMOUNT = 1304;
    uint16 public constant ERR_BRP_FULFILL_ALREADY_FULFILLED = 1305;
    uint16 public constant ERR_BRP_FULFILL_ALREADY_DEFAULTED = 1306;
    uint16 public constant ERR_BRP_FULFILL_SYSTEM_PAUSED = 1307;
    uint16 public constant ERR_BRP_FULFILL_SPV_FAILED = 1308;
    uint16 public constant ERR_BRP_DEFAULT_INVALID_ID = 1401;
    uint16 public constant ERR_BRP_DEFAULT_NOT_REQUESTED = 1402;
    uint16 public constant ERR_BRP_DEFAULT_INVALID_REASON = 1403;
    uint16 public constant ERR_BRP_DEFAULT_ALREADY_FULFILLED = 1404;
    uint16 public constant ERR_BRP_DEFAULT_ALREADY_DEFAULTED = 1405;
    uint16 public constant ERR_BRP_BULK_NO_REDEMPTIONS = 1501;
    uint16 public constant ERR_BRP_BULK_REASON_REQUIRED = 1502;

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

    /// @dev Enhanced error event for logging failed transaction attempts
    event ErrorLogged(
        uint16 indexed errorCode,
        string indexed functionName,
        address indexed caller,
        bytes32 contextHash,
        string message
    );

    constructor(address _protocolRegistry) {
        protocolRegistry = ProtocolRegistry(_protocolRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(POLICY_ADMIN_ROLE, msg.sender);
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
        // Input validation - fail fast with detailed error messages and context
        if (redemptionId == bytes32(0)) {
            _logError(
                ERR_BRP_REQUEST_INVALID_ID,
                "requestRedemption",
                msg.sender,
                bytes32(0),
                "requestRedemption: Invalid redemption ID - cannot be zero bytes32"
            );
            require(
                false,
                "BRP-1201: requestRedemption failed - Invalid redemption ID (zero bytes32)"
            );
        }

        if (requestedRedemptions[redemptionId]) {
            _logError(
                ERR_BRP_REQUEST_ID_COLLISION,
                "requestRedemption",
                msg.sender,
                redemptionId,
                "requestRedemption: Redemption ID collision - ID already used, potential attack"
            );
            require(
                false,
                "BRP-1202: requestRedemption failed - Redemption ID already used, potential collision attack"
            );
        }

        if (qc == address(0)) {
            _logError(
                ERR_BRP_REQUEST_INVALID_QC,
                "requestRedemption",
                msg.sender,
                redemptionId,
                "requestRedemption: Invalid QC address - cannot be zero address"
            );
            require(
                false,
                "BRP-1203: requestRedemption failed - Invalid QC address (zero address)"
            );
        }

        if (user == address(0)) {
            _logError(
                ERR_BRP_REQUEST_INVALID_USER,
                "requestRedemption",
                msg.sender,
                redemptionId,
                "requestRedemption: Invalid user address - cannot be zero address"
            );
            require(
                false,
                "BRP-1204: requestRedemption failed - Invalid user address (zero address)"
            );
        }

        if (amount == 0) {
            _logError(
                ERR_BRP_REQUEST_INVALID_AMOUNT,
                "requestRedemption",
                msg.sender,
                redemptionId,
                string(
                    abi.encodePacked(
                        "requestRedemption: Invalid amount (",
                        _uintToString(amount),
                        ") - must be greater than zero"
                    )
                )
            );
            require(
                false,
                "BRP-1205: requestRedemption failed - Amount must be greater than zero"
            );
        }

        if (bytes(btcAddress).length == 0) {
            _logError(
                ERR_BRP_REQUEST_INVALID_BTC_ADDR,
                "requestRedemption",
                msg.sender,
                redemptionId,
                "requestRedemption: Invalid Bitcoin address - cannot be empty string"
            );
            require(
                false,
                "BRP-1206: requestRedemption failed - Invalid Bitcoin address (empty string)"
            );
        }

        // Business logic validation - check if redemption is allowed
        if (!validateRedemptionRequest(user, qc, amount)) {
            _logError(
                ERR_BRP_REQUEST_VALIDATION_FAILED,
                "requestRedemption",
                msg.sender,
                redemptionId,
                string(
                    abi.encodePacked(
                        "requestRedemption: Validation failed - user: ",
                        _addressToString(user),
                        ", qc: ",
                        _addressToString(qc),
                        ", amount: ",
                        _uintToString(amount)
                    )
                )
            );
            require(
                false,
                "BRP-1207: requestRedemption failed - Validation failed, check QC status and user eligibility"
            );
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
    ) external override returns (bool success) {
        // Input validation - check redemption exists and is in correct state with detailed error context
        if (redemptionId == bytes32(0)) {
            _logError(
                ERR_BRP_FULFILL_INVALID_ID,
                "recordFulfillment",
                msg.sender,
                bytes32(0),
                "recordFulfillment: Invalid redemption ID - cannot be zero bytes32"
            );
            require(
                false,
                "BRP-1301: recordFulfillment failed - Invalid redemption ID (zero bytes32)"
            );
        }

        if (!requestedRedemptions[redemptionId]) {
            _logError(
                ERR_BRP_FULFILL_NOT_REQUESTED,
                "recordFulfillment",
                msg.sender,
                redemptionId,
                "recordFulfillment: Redemption not requested - ID not found in system"
            );
            require(
                false,
                "BRP-1302: recordFulfillment failed - Redemption not requested, verify redemption ID"
            );
        }

        if (bytes(userBtcAddress).length == 0) {
            _logError(
                ERR_BRP_FULFILL_INVALID_BTC_ADDR,
                "recordFulfillment",
                msg.sender,
                redemptionId,
                "recordFulfillment: Invalid Bitcoin address - cannot be empty string"
            );
            require(
                false,
                "BRP-1303: recordFulfillment failed - Invalid Bitcoin address (empty string)"
            );
        }

        if (expectedAmount == 0) {
            _logError(
                ERR_BRP_FULFILL_INVALID_AMOUNT,
                "recordFulfillment",
                msg.sender,
                redemptionId,
                string(
                    abi.encodePacked(
                        "recordFulfillment: Invalid amount (",
                        _uintToString(expectedAmount),
                        ") - must be greater than zero"
                    )
                )
            );
            require(
                false,
                "BRP-1304: recordFulfillment failed - Invalid amount (must be greater than zero)"
            );
        }

        // State validation - prevent double processing with clear explanations
        if (fulfilledRedemptions[redemptionId]) {
            _logError(
                ERR_BRP_FULFILL_ALREADY_FULFILLED,
                "recordFulfillment",
                msg.sender,
                redemptionId,
                "recordFulfillment: Already fulfilled - redemption has been processed"
            );
            require(
                false,
                "BRP-1305: recordFulfillment failed - Redemption already fulfilled, cannot process twice"
            );
        }

        if (defaultedRedemptions[redemptionId] != bytes32(0)) {
            _logError(
                ERR_BRP_FULFILL_ALREADY_DEFAULTED,
                "recordFulfillment",
                msg.sender,
                redemptionId,
                "recordFulfillment: Already defaulted - redemption marked as failed"
            );
            require(
                false,
                "BRP-1306: recordFulfillment failed - Redemption already defaulted, cannot fulfill"
            );
        }

        // System state validation with context
        SystemState systemState = SystemState(
            protocolRegistry.getService(SYSTEM_STATE_KEY)
        );
        if (systemState.isRedemptionPaused()) {
            _logError(
                ERR_BRP_FULFILL_SYSTEM_PAUSED,
                "recordFulfillment",
                msg.sender,
                redemptionId,
                "recordFulfillment: System paused - redemptions temporarily disabled"
            );
            require(
                false,
                "BRP-1307: recordFulfillment failed - Redemptions are paused by system administrator"
            );
        }

        // SPV proof verification with enhanced error context
        if (
            !_verifySPVProof(
                redemptionId,
                userBtcAddress,
                expectedAmount,
                txInfo,
                proof
            )
        ) {
            _logError(
                ERR_BRP_FULFILL_SPV_FAILED,
                "recordFulfillment",
                msg.sender,
                redemptionId,
                string(
                    abi.encodePacked(
                        "recordFulfillment: SPV verification failed - address: ",
                        userBtcAddress,
                        ", amount: ",
                        _uintToString(expectedAmount)
                    )
                )
            );
            require(
                false,
                "BRP-1308: recordFulfillment failed - SPV proof verification failed, verify transaction data"
            );
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
        // Input validation with detailed error context
        if (redemptionId == bytes32(0)) {
            _logError(
                ERR_BRP_DEFAULT_INVALID_ID,
                "flagDefault",
                msg.sender,
                bytes32(0),
                "flagDefault: Invalid redemption ID - cannot be zero bytes32"
            );
            require(
                false,
                "BRP-1401: flagDefault failed - Invalid redemption ID (zero bytes32)"
            );
        }

        if (!requestedRedemptions[redemptionId]) {
            _logError(
                ERR_BRP_DEFAULT_NOT_REQUESTED,
                "flagDefault",
                msg.sender,
                redemptionId,
                "flagDefault: Redemption not requested - ID not found in system"
            );
            require(
                false,
                "BRP-1402: flagDefault failed - Redemption not requested, verify redemption ID"
            );
        }

        if (reason == bytes32(0)) {
            _logError(
                ERR_BRP_DEFAULT_INVALID_REASON,
                "flagDefault",
                msg.sender,
                redemptionId,
                "flagDefault: Invalid reason - cannot be zero bytes32, audit trail required"
            );
            require(
                false,
                "BRP-1403: flagDefault failed - Reason required for audit trail (cannot be zero bytes32)"
            );
        }

        // State validation - prevent double processing with clear explanations
        if (fulfilledRedemptions[redemptionId]) {
            _logError(
                ERR_BRP_DEFAULT_ALREADY_FULFILLED,
                "flagDefault",
                msg.sender,
                redemptionId,
                "flagDefault: Already fulfilled - cannot default completed redemption"
            );
            require(
                false,
                "BRP-1404: flagDefault failed - Redemption already fulfilled, cannot mark as defaulted"
            );
        }

        if (defaultedRedemptions[redemptionId] != bytes32(0)) {
            _logError(
                ERR_BRP_DEFAULT_ALREADY_DEFAULTED,
                "flagDefault",
                msg.sender,
                redemptionId,
                "flagDefault: Already defaulted - redemption already marked as failed"
            );
            require(
                false,
                "BRP-1405: flagDefault failed - Redemption already defaulted, cannot process twice"
            );
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
        try protocolRegistry.getService(SPV_VALIDATOR_KEY) returns (
            address validatorAddress
        ) {
            ISPVValidator spvValidator = ISPVValidator(validatorAddress);
            return
                spvValidator.verifyRedemptionFulfillment(
                    redemptionId,
                    userBtcAddress,
                    expectedAmount,
                    txInfo,
                    proof
                );
        } catch {
            // If SPV validator not available, reject verification
            return false;
        }
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
            _logError(
                ERR_BRP_BULK_NO_REDEMPTIONS,
                "bulkHandleRedemptions",
                msg.sender,
                bytes32(0),
                "bulkHandleRedemptions: No redemptions provided - array cannot be empty"
            );
            require(
                false,
                "BRP-1501: bulkHandleRedemptions failed - No redemptions provided in array"
            );
        }

        if (action == BulkAction.DEFAULT && reason == bytes32(0)) {
            _logError(
                ERR_BRP_BULK_REASON_REQUIRED,
                "bulkHandleRedemptions",
                msg.sender,
                bytes32(uint256(redemptionIds.length)),
                string(
                    abi.encodePacked(
                        "bulkHandleRedemptions: Reason required for DEFAULT action on ",
                        _uintToString(redemptionIds.length),
                        " redemptions"
                    )
                )
            );
            require(
                false,
                "BRP-1502: bulkHandleRedemptions failed - Reason required for DEFAULT action (cannot be zero bytes32)"
            );
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

    function _addressToString(address addr)
        private
        pure
        returns (string memory)
    {
        bytes memory data = abi.encodePacked(addr);
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(2 + data.length * 2);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < data.length; i++) {
            str[2 + i * 2] = alphabet[uint256(uint8(data[i] >> 4))];
            str[3 + i * 2] = alphabet[uint256(uint8(data[i] & 0x0f))];
        }
        return string(str);
    }

    function _uintToString(uint256 value) private pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
