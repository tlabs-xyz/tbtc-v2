// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IRedemptionPolicy.sol";
import "./ProtocolRegistry.sol";
import "../token/TBTC.sol";
import "../bridge/BitcoinTx.sol";

/// @title QCRedeemer
/// @dev Stable entry point for tBTC redemption with Policy delegation.
/// Manages the entire lifecycle of a redemption request, delegating
/// fulfillment and default handling logic to a pluggable "Redemption Policy"
/// contract, allowing redemption rules to be upgraded without changing
/// the core redeemer contract.
///
/// Key Features:
/// - Collision-resistant redemption ID generation
/// - Policy-based validation and fulfillment
/// - Role-based access control for sensitive operations
/// - Integration with tBTC v2 token burning mechanism
contract QCRedeemer is AccessControl {
    // Custom errors for gas-efficient reverts
    error InvalidQCAddress();
    error InvalidAmount();
    error BitcoinAddressRequired();
    error InvalidBitcoinAddressFormat();
    error RedemptionRequestFailed();
    error RedemptionNotPending();
    error FulfillmentVerificationFailed();
    error DefaultFlaggingFailed();

    // Role definitions for access control
    bytes32 public constant REDEEMER_ROLE = keccak256("REDEEMER_ROLE");
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");

    // Service keys for ProtocolRegistry lookups
    bytes32 public constant REDEMPTION_POLICY_KEY =
        keccak256("REDEMPTION_POLICY");
    bytes32 public constant TBTC_TOKEN_KEY = keccak256("TBTC_TOKEN");

    // Bitcoin address placeholder - in production this should be user-provided
    string private constant PLACEHOLDER_BTC_ADDRESS = "placeholder_btc_address";

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
        RedemptionStatus status;
        string userBtcAddress;
    }

    ProtocolRegistry public immutable protocolRegistry;

    /// @dev Maps redemption IDs to redemption data
    mapping(bytes32 => Redemption) public redemptions;

    /// @dev Counter for generating unique redemption IDs
    uint256 private redemptionCounter;

    // =================== STANDARDIZED EVENTS ===================

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

    /// @dev Emitted when the redemption policy is updated
    event RedemptionPolicyUpdated(
        address indexed oldPolicy,
        address indexed newPolicy,
        address indexed updatedBy,
        uint256 timestamp
    );

    constructor(address _protocolRegistry) {
        protocolRegistry = ProtocolRegistry(_protocolRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REDEEMER_ROLE, msg.sender);
        _grantRole(ARBITER_ROLE, msg.sender);
    }

    /// @notice Initiate a redemption request
    /// @param qc The address of the Qualified Custodian
    /// @param amount The amount of tBTC to redeem
    /// @param userBtcAddress The user's Bitcoin address
    /// @return redemptionId Unique identifier for this redemption request
    function initiateRedemption(address qc, uint256 amount, string calldata userBtcAddress)
        external
        returns (bytes32 redemptionId)
    {
        if (qc == address(0)) revert InvalidQCAddress();
        if (amount == 0) revert InvalidAmount();
        if (bytes(userBtcAddress).length == 0) revert BitcoinAddressRequired();
        bytes memory addr = bytes(userBtcAddress);
        if (!(addr[0] == 0x31 || addr[0] == 0x33 || (addr[0] == 0x62 && addr.length > 1 && addr[1] == 0x63))) {
            revert InvalidBitcoinAddressFormat();
        }

        IRedemptionPolicy policy = IRedemptionPolicy(
            protocolRegistry.getService(REDEMPTION_POLICY_KEY)
        );

        redemptionId = _generateRedemptionId(msg.sender, qc, amount);

        if (!policy.requestRedemption(
                redemptionId,
                qc,
                msg.sender,
                amount,
                userBtcAddress
            )) {
            revert RedemptionRequestFailed();
        }

        TBTC tbtcToken = TBTC(protocolRegistry.getService(TBTC_TOKEN_KEY));
        tbtcToken.burnFrom(msg.sender, amount);

        redemptions[redemptionId] = Redemption({
            user: msg.sender,
            qc: qc,
            amount: amount,
            requestedAt: block.timestamp,
            status: RedemptionStatus.Pending,
            userBtcAddress: userBtcAddress
        });

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

    /// @notice Record fulfillment of a redemption (Watchdog only)
    /// @param redemptionId The unique identifier of the redemption
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
    ) external onlyRole(ARBITER_ROLE) {
        if (redemptions[redemptionId].status != RedemptionStatus.Pending) {
            revert RedemptionNotPending();
        }

        // Cache redemption policy service to avoid redundant SLOAD operations
        IRedemptionPolicy policy = IRedemptionPolicy(
            protocolRegistry.getService(REDEMPTION_POLICY_KEY)
        );

        // Delegate verification to policy contract
        if (!policy.recordFulfillment(
                redemptionId,
                userBtcAddress,
                expectedAmount,
                txInfo,
                proof
            )) {
            revert FulfillmentVerificationFailed();
        }

        // Update status
        redemptions[redemptionId].status = RedemptionStatus.Fulfilled;

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

    /// @notice Flag a redemption as defaulted (Watchdog only)
    /// @param redemptionId The unique identifier of the redemption
    /// @param reason The reason for the default
    function flagDefaultedRedemption(bytes32 redemptionId, bytes32 reason)
        external
        onlyRole(ARBITER_ROLE)
    {
        if (redemptions[redemptionId].status != RedemptionStatus.Pending) {
            revert RedemptionNotPending();
        }

        // Get active redemption policy from registry
        IRedemptionPolicy policy = IRedemptionPolicy(
            protocolRegistry.getService(REDEMPTION_POLICY_KEY)
        );

        // Delegate default handling to policy contract
        if (!policy.flagDefault(redemptionId, reason)) {
            revert DefaultFlaggingFailed();
        }

        // Update status
        redemptions[redemptionId].status = RedemptionStatus.Defaulted;

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

        IRedemptionPolicy policy = IRedemptionPolicy(
            protocolRegistry.getService(REDEMPTION_POLICY_KEY)
        );

        uint256 timeout = policy.getRedemptionTimeout();
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

    /// @notice Update redemption policy (DAO only)
    /// @dev This is called automatically when ProtocolRegistry is updated
    function updateRedemptionPolicy() external onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldPolicy = address(0);
        
        // Check if old policy exists
        if (protocolRegistry.hasService(REDEMPTION_POLICY_KEY)) {
            oldPolicy = protocolRegistry.getService(REDEMPTION_POLICY_KEY);
        }
        
        // Note: The new policy should already be set in the registry before calling this
        // The caller is responsible for ensuring the new policy is registered
        address newPolicy = protocolRegistry.getService(REDEMPTION_POLICY_KEY);

        emit RedemptionPolicyUpdated(
            oldPolicy,
            newPolicy,
            msg.sender,
            block.timestamp
        );
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
}
