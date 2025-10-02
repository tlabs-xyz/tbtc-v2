// SPDX-License-Identifier: GPL-3.0-only

// ██████████████     ▐████▌     ██████████████
// ██████████████     ▐████▌     ██████████████
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
// ██████████████     ▐████▌     ██████████████
// ██████████████     ▐████▌     ██████████████
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌

pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./QCData.sol";
import "./SystemState.sol";
import "./BitcoinAddressUtils.sol";
import "../token/TBTC.sol";
import "./AccountControl.sol";
import "./QCErrors.sol";

/// @title QCRedeemer
/// @dev Direct implementation for tBTC redemption with QC backing.
/// Manages the entire lifecycle of a redemption request, handling
/// fulfillment and default logic directly without interfaces.
/// Manages redemption fulfillment through trusted arbiter validation.
///
/// Key Features:
/// - Collision-resistant redemption ID generation
/// - Direct validation and fulfillment logic
/// - Role-based access control for sensitive operations
/// - Integration with tBTC token burning mechanism
/// - Trusted arbiter validation for Bitcoin transaction verification
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
contract QCRedeemer is AccessControl, ReentrancyGuard, QCErrors {
    using EnumerableSet for EnumerableSet.Bytes32Set;

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
        uint256 deadline;           // Deadline for fulfillment
        RedemptionStatus status;
        string userBtcAddress;
        string qcWalletAddress;     // QC's chosen wallet for this redemption
    }

    // Contract dependencies
    TBTC public immutable tbtcToken;
    QCData public immutable qcData;
    SystemState public immutable systemState;
    AccountControl public accountControl;

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
    mapping(address => EnumerableSet.Bytes32Set) private qcRedemptions;
    
    /// @dev Track number of active redemptions per QC
    mapping(address => uint256) public qcActiveRedemptionCount;
    
    /// @dev Track redemptions by wallet for obligation management
    mapping(string => EnumerableSet.Bytes32Set) private walletActiveRedemptions;
    
    /// @dev Track number of active redemptions per wallet
    mapping(string => uint256) public walletActiveRedemptionCount;
    
    // Account Control Integration

    // =================== EVENTS ===================

    /// @dev Emitted when a redemption is requested
    event RedemptionRequested(
        bytes32 indexed redemptionId,
        address indexed user,
        address indexed qc,
        uint256 amount,
        string userBtcAddress,
        string qcWalletAddress
    );
    
    /// @dev Emitted when a redemption is fulfilled
    event RedemptionFulfilled(
        bytes32 indexed redemptionId,
        address indexed user,
        address indexed qc,
        uint256 amount,
        uint256 actualAmount,
        address fulfilledBy
    );

    /// @dev Emitted when a redemption is flagged as defaulted
    event RedemptionDefaulted(
        bytes32 indexed redemptionId,
        address indexed user,
        address indexed qc,
        uint256 amount,
        bytes32 reason,
        address defaultedBy
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
        address _accountControl
    ) {
        require(_tbtcToken != address(0), "Invalid token address");
        require(_qcData != address(0), "Invalid qcData address");
        require(_systemState != address(0), "Invalid systemState address");
        require(_accountControl != address(0), "Invalid accountControl address");

        tbtcToken = TBTC(_tbtcToken);
        qcData = QCData(_qcData);
        systemState = SystemState(_systemState);
        accountControl = AccountControl(_accountControl);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DISPUTE_ARBITER_ROLE, msg.sender);
    }

    /// @notice Initiate a redemption request
    /// @param qc The address of the Qualified Custodian
    /// @param amount The amount of tBTC to redeem
    /// @param userBtcAddress The user's Bitcoin address
    /// @param qcWalletAddress The QC's Bitcoin wallet that will handle this redemption
    /// @return redemptionId Unique identifier for this redemption request
    /// @dev SECURITY: nonReentrant protects against reentrancy via TBTC burnFrom, AccountControl.notifyRedemption, and event emissions
    function initiateRedemption(
        address qc,
        uint256 amount,
        string calldata userBtcAddress,
        string calldata qcWalletAddress
    ) external nonReentrant returns (bytes32 redemptionId) {
        // Check if redemptions are paused
        if (systemState.isRedemptionPaused()) {
            revert RedemptionsArePaused();
        }
        
        if (qc == address(0)) revert QCErrors.InvalidQCAddress();
        require(amount > 0, "InvalidRedemptionAmount");
        if (bytes(userBtcAddress).length == 0) revert BitcoinAddressRequired();
        if (bytes(qcWalletAddress).length == 0) revert BitcoinAddressRequired();

        // Bitcoin address format validation for user address
        if (!_isValidBitcoinAddress(userBtcAddress)) revert InvalidBitcoinAddressFormat(userBtcAddress);
        
        // Bitcoin address format validation for QC wallet address  
        if (!_isValidBitcoinAddress(qcWalletAddress)) revert InvalidBitcoinAddressFormat(qcWalletAddress);
        
        // Validate QC wallet is registered and active
        address walletOwner = qcData.getWalletOwner(qcWalletAddress);
        require(walletOwner != address(0), "Wallet not registered to QC");
        require(walletOwner == qc, "Wallet not registered to QC");
        require(
            qcData.getWalletStatus(qcWalletAddress) == QCData.WalletStatus.Active,
            "Wallet not active"
        );

        // Check if QC is emergency paused
        if (systemState.isQCEmergencyPaused(qc)) {
            revert QCErrors.QCIsEmergencyPaused(qc);
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

        // Convert tBTC amount to satoshis for AccountControl
        uint256 satoshis = amount / 1e10; // Convert from 18 decimals (tBTC) to 8 decimals (satoshis), assuming 1:1 tBTC:BTC ratio
        accountControl.notifyRedemption(qc, satoshis);

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
        qcRedemptions[qc].add(redemptionId);
        qcActiveRedemptionCount[qc]++;
        
        // Track redemption for wallet
        walletActiveRedemptions[qcWalletAddress].add(redemptionId);
        walletActiveRedemptionCount[qcWalletAddress]++;

        emit RedemptionRequested(
            redemptionId,
            msg.sender,
            qc,
            amount,
            userBtcAddress,
            qcWalletAddress
        );

        return redemptionId;
    }


    /// @notice Validate Bitcoin address format
    /// @param bitcoinAddress The Bitcoin address to validate
    /// @return isValid True if the address is valid
    function validateBitcoinAddress(string calldata bitcoinAddress) external pure returns (bool isValid) {
        return _isValidBitcoinAddress(bitcoinAddress);
    }

    /// @notice Record fulfillment of a redemption by trusting the arbiter (DISPUTE_ARBITER_ROLE)
    /// @param redemptionId The unique identifier of the redemption
    /// @param actualAmount The actual payment amount in satoshis sent to user
    /// @dev This is a trusted variant that relies on arbiter validation
    /// @dev SECURITY: nonReentrant protects against reentrancy via external calls
    function recordRedemptionFulfillmentTrusted(
        bytes32 redemptionId,
        uint64 actualAmount
    ) external onlyRole(DISPUTE_ARBITER_ROLE) nonReentrant {
        // Check if redemptions are paused
        if (systemState.isRedemptionPaused()) {
            revert RedemptionsArePaused();
        }
        
        if (redemptions[redemptionId].status != RedemptionStatus.Pending) {
            revert RedemptionNotPending();
        }

        // Validate and record fulfillment using trusted internal logic
        if (!_recordFulfillmentTrusted(redemptionId, actualAmount)) {
            revert FulfillmentVerificationFailed();
        }

        // Update status
        redemptions[redemptionId].status = RedemptionStatus.Fulfilled;
        
        // Update tracking for QC
        address qc = redemptions[redemptionId].qc;
        if (qcActiveRedemptionCount[qc] > 0) {
            qcActiveRedemptionCount[qc]--;
            qcRedemptions[qc].remove(redemptionId);
        }
        
        // Update tracking for wallet
        string memory qcWalletAddress = redemptions[redemptionId].qcWalletAddress;
        if (walletActiveRedemptionCount[qcWalletAddress] > 0) {
            walletActiveRedemptionCount[qcWalletAddress]--;
            walletActiveRedemptions[qcWalletAddress].remove(redemptionId);
        }

        Redemption memory redemption = redemptions[redemptionId];
        emit RedemptionFulfilled(
            redemptionId,
            redemption.user,
            redemption.qc,
            redemption.amount,
            actualAmount,
            msg.sender
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
            qcRedemptions[qc].remove(redemptionId);
        }
        
        // Update tracking for wallet
        string memory qcWalletAddress = redemptions[redemptionId].qcWalletAddress;
        if (walletActiveRedemptionCount[qcWalletAddress] > 0) {
            walletActiveRedemptionCount[qcWalletAddress]--;
            walletActiveRedemptions[qcWalletAddress].remove(redemptionId);
        }

        Redemption memory redemption = redemptions[redemptionId];
        emit RedemptionDefaulted(
            redemptionId,
            redemption.user,
            redemption.qc,
            redemption.amount,
            reason,
            msg.sender
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
        // MintingPaused QCs can fulfill redemptions to maintain network continuity during operational issues
        // This prevents user funds from being locked due to temporary QC operational problems
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


    /// @dev Internal function to record fulfillment with trusted arbiter validation
    /// @param redemptionId The unique identifier of the redemption
    /// @param actualAmount The actual payment amount in satoshis sent to user
    /// @return success True if the fulfillment was successfully recorded
    function _recordFulfillmentTrusted(
        bytes32 redemptionId,
        uint64 actualAmount
    ) internal returns (bool success) {
        // Input validation
        if (redemptionId == bytes32(0)) {
            revert InvalidRedemptionId();
        }

        if (!requestedRedemptions[redemptionId]) {
            revert RedemptionNotRequested(redemptionId);
        }

        if (actualAmount == 0) {
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

        // State update - mark as fulfilled
        fulfilledRedemptions[redemptionId] = true;

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
    
    /// @notice Get all redemption IDs for a QC
    /// @param qc The QC address to check
    /// @return redemptionIds Array of active redemption IDs
    function getQCRedemptions(address qc) external view returns (bytes32[] memory) {
        return qcRedemptions[qc].values();
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
        bytes32[] memory redemptionIds = qcRedemptions[qc].values();
        uint256 earliest = type(uint256).max;
        
        for (uint256 i = 0; i < redemptionIds.length; i++) {
            Redemption memory redemption = redemptions[redemptionIds[i]];
            if (redemption.status == RedemptionStatus.Pending && redemption.deadline < earliest) {
                earliest = redemption.deadline;
            }
        }
        
        return earliest;
    }
    
    // =================== Wallet Obligation Management ===================
    
    /// @notice Check if a wallet has unfulfilled redemption obligations
    /// @param walletAddress The Bitcoin wallet address to check
    /// @return hasObligations True if wallet has pending redemptions
    /// @dev CRITICAL FUNCTION: Used by QCManager to prevent wallet de-registration.
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
    function getWalletEarliestRedemptionDeadline(string calldata walletAddress) 
        external 
        view 
        returns (uint256 deadline) 
    {
        bytes32[] memory redemptionIds = walletActiveRedemptions[walletAddress].values();
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
        bytes32[] memory redemptionIds = walletActiveRedemptions[walletAddress].values();
        
        earliestDeadline = type(uint256).max;
        totalAmount = 0;
        
        // Iterate through active redemptions to calculate totals
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
    /// @return redemptionIds Array of active redemption IDs only
    /// @dev Returns only active redemptions thanks to EnumerableSet cleanup
    function getWalletRedemptions(string calldata walletAddress)
        external
        view
        returns (bytes32[] memory)
    {
        return walletActiveRedemptions[walletAddress].values();
    }

    // =================== BITCOIN ADDRESS VALIDATION ===================

    /// @dev Validate Bitcoin address format supporting P2PKH, P2SH, P2WPKH, P2WSH
    /// @param btcAddress The Bitcoin address to validate
    /// @return valid True if the address is in a valid format
    function _isValidBitcoinAddress(string memory btcAddress) internal pure returns (bool valid) {
        bytes memory addr = bytes(btcAddress);
        if (addr.length == 0) return false;
        
        // Check Base58 addresses (P2PKH and P2SH)
        // P2PKH addresses start with '1' (0x31)
        // P2SH addresses start with '3' (0x33)  
        if (addr[0] == 0x31 || addr[0] == 0x33) {
            // Basic length check for Base58 addresses (25-34 characters typical)
            return addr.length >= 26 && addr.length <= 35;
        }
        
        // Check Bech32 addresses (P2WPKH and P2WSH)
        // Mainnet: bc1... (0x62 0x63 0x31)
        // Testnet: tb1... (0x74 0x62 0x31)
        if (addr.length >= 14) {
            // Check for bc1 (mainnet)
            if (addr[0] == 0x62 && addr[1] == 0x63 && addr[2] == 0x31) {
                return addr.length <= 74; // Max length for bech32
            }
            // Check for tb1 (testnet)  
            if (addr[0] == 0x74 && addr[1] == 0x62 && addr[2] == 0x31) {
                return addr.length <= 74; // Max length for bech32
            }
        }
        
        return false;
    }
}
