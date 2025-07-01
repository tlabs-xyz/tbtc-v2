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
    // Role definitions for access control
    bytes32 public constant REDEEMER_ROLE = keccak256("REDEEMER_ROLE");
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    
    // Service keys for ProtocolRegistry lookups
    bytes32 public constant REDEMPTION_POLICY_KEY = keccak256("REDEMPTION_POLICY");
    bytes32 public constant TBTC_TOKEN_KEY = keccak256("TBTC_TOKEN");
    
    // Error messages for better debugging and user experience
    string private constant ERROR_INVALID_QC = "Invalid QC address";
    string private constant ERROR_INVALID_AMOUNT = "Amount must be greater than zero";
    string private constant ERROR_REDEMPTION_FAILED = "Redemption request failed";
    string private constant ERROR_NOT_PENDING = "Redemption not pending";
    string private constant ERROR_FULFILLMENT_FAILED = "Fulfillment verification failed";
    string private constant ERROR_DEFAULT_FAILED = "Default flagging failed";
    
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
    /// @return redemptionId Unique identifier for this redemption request
    function initiateRedemption(
        address qc,
        uint256 amount
    ) external returns (bytes32 redemptionId) {
        require(qc != address(0), ERROR_INVALID_QC);
        require(amount > 0, ERROR_INVALID_AMOUNT);
        
        // Cache services to avoid redundant SLOAD operations
        IRedemptionPolicy policy = IRedemptionPolicy(
            protocolRegistry.getService(REDEMPTION_POLICY_KEY)
        );
        
        // Generate unique redemption ID
        redemptionId = _generateRedemptionId(msg.sender, qc, amount);
        
        // Request redemption through policy (includes validation and collision detection)
        // Note: Using placeholder Bitcoin address for now - this should be provided by the user in a real implementation
        require(
            policy.requestRedemption(redemptionId, qc, msg.sender, amount, PLACEHOLDER_BTC_ADDRESS),
            ERROR_REDEMPTION_FAILED
        );
        
        // Burn the user's tBTC tokens
        TBTC tbtcToken = TBTC(protocolRegistry.getService(TBTC_TOKEN_KEY));
        tbtcToken.burnFrom(msg.sender, amount);
        
        // Store redemption data
        redemptions[redemptionId] = Redemption({
            user: msg.sender,
            qc: qc,
            amount: amount,
            requestedAt: block.timestamp,
            status: RedemptionStatus.Pending
        });
        
        emit RedemptionRequested(redemptionId, msg.sender, qc, amount, msg.sender, block.timestamp);
        
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
        require(
            redemptions[redemptionId].status == RedemptionStatus.Pending,
            ERROR_NOT_PENDING
        );
        
        // Cache redemption policy service to avoid redundant SLOAD operations
        IRedemptionPolicy policy = IRedemptionPolicy(
            protocolRegistry.getService(REDEMPTION_POLICY_KEY)
        );
        
        // Delegate verification to policy contract
        require(
            policy.recordFulfillment(redemptionId, userBtcAddress, expectedAmount, txInfo, proof),
            ERROR_FULFILLMENT_FAILED
        );
        
        // Update status
        redemptions[redemptionId].status = RedemptionStatus.Fulfilled;
        
        Redemption memory redemption = redemptions[redemptionId];
        emit RedemptionFulfilled(redemptionId, redemption.user, redemption.qc, redemption.amount, msg.sender, block.timestamp);
    }
    
    /// @notice Flag a redemption as defaulted (Watchdog only)
    /// @param redemptionId The unique identifier of the redemption
    /// @param reason The reason for the default
    function flagDefaultedRedemption(
        bytes32 redemptionId,
        bytes32 reason
    ) external onlyRole(ARBITER_ROLE) {
        require(
            redemptions[redemptionId].status == RedemptionStatus.Pending,
            ERROR_NOT_PENDING
        );
        
        // Get active redemption policy from registry
        IRedemptionPolicy policy = IRedemptionPolicy(
            protocolRegistry.getService(REDEMPTION_POLICY_KEY)
        );
        
        // Delegate default handling to policy contract
        require(
            policy.flagDefault(redemptionId, reason),
            ERROR_DEFAULT_FAILED
        );
        
        // Update status
        redemptions[redemptionId].status = RedemptionStatus.Defaulted;
        
        Redemption memory redemption = redemptions[redemptionId];
        emit RedemptionDefaulted(redemptionId, redemption.user, redemption.qc, redemption.amount, reason, msg.sender, block.timestamp);
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
    function updateRedemptionPolicy() external {
        address oldPolicy = address(0);
        try protocolRegistry.getService(REDEMPTION_POLICY_KEY) returns (address current) {
            oldPolicy = current;
        } catch {
            // Policy not yet registered
        }
        
        address newPolicy = protocolRegistry.getService(REDEMPTION_POLICY_KEY);
        
        emit RedemptionPolicyUpdated(oldPolicy, newPolicy, msg.sender, block.timestamp);
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
        return keccak256(
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