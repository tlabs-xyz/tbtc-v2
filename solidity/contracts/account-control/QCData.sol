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
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./QCErrors.sol";
import "./BitcoinAddressUtils.sol";

/**
 * @title QCData
 * @notice Dedicated storage layer for all data related to Qualified Custodians
 * @dev Central data repository that manages QC lifecycle, wallet registrations, and operational states.
 *      This contract provides a standardized interface for:
 *      - QC registration and status management (5-state model)
 *      - Wallet registration and lifecycle tracking
 *      - Minting capacity and usage tracking
 *      - Oracle synchronization data management
 *      - Pause level and self-pause functionality
 *
 * @custom:security-contact security@threshold.network
 * @custom:roles
 * - QC_MANAGER_ROLE: Can manage QC lifecycle and data
 *   - Required by: QCManager contract
 *   - Permissions: All QC and wallet management functions
 * - DEFAULT_ADMIN_ROLE: Can grant/revoke QC_MANAGER_ROLE
 *   - Required by: Contract deployer and governance
 *   - Permissions: Role management only
 */
contract QCData is AccessControl {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    bytes32 public constant QC_MANAGER_ROLE = keccak256("QC_MANAGER_ROLE");

    /// @dev Maximum number of wallets a QC can register to prevent unbounded array growth
    uint256 public constant MAX_WALLETS_PER_QC = 10;

    // =================== DATA STRUCTURES & ENUMS ===================
    
    /// @dev QC status enumeration - 5-state model
    enum QCStatus {
        Active,         // 0 - Full operations (mint + fulfill)
        MintingPaused,  // 1 - Minting paused, fulfillment allowed
        Paused,         // 2 - Complete halt (no operations)
        UnderReview,    // 3 - Under governance review (no operations)
        Revoked         // 4 - Terminal state (no operations)
    }

    /// @dev Wallet status enumeration - comprehensive 4-state model
    enum WalletStatus {
        Inactive, // Wallet is registered but not yet active
        Active, // Wallet is active and operational
        PendingDeRegistration, // Wallet deregistration requested, pending finalization
        Deregistered // Wallet has been permanently deregistered
    }

    /// @dev Pause level enumeration for QC self-pause functionality
    enum PauseLevel {
        MintingOnly,    // Pause minting but allow fulfillment
        Complete        // Pause all operations
    }

    /// @dev Oracle data for QC synchronization
    struct QCOracleData {
        uint256 lastSyncTimestamp;
        bool oracleFailureDetected;
    }

    /// @dev Qualified Custodian data structure - optimized for gas efficiency
    struct Custodian {
        uint256 totalMintedAmount; // Total tBTC minted by this QC (in wei units, 1e18 = 1 tBTC)
        uint256 maxMintingCapacity; // Maximum tBTC this QC can mint (in wei units, 1e18 = 1 tBTC)
        uint256 registeredAt; // Timestamp when QC was registered (block.timestamp)
        QCStatus status; // Current operational status (affects mint/fulfill permissions)
        PauseLevel pauseLevel; // Current pause level (granular operational control)
        bool selfPaused; // True if QC initiated the pause (vs. governance-imposed)
        EnumerableSet.Bytes32Set walletKeys; // Set of registered wallet keys (gas-efficient enumerable storage)
        mapping(bytes32 => string) walletAddresses; // Maps wallet key to Bitcoin address string
        mapping(bytes32 => WalletStatus) walletStatuses; // Per-wallet operational status
        mapping(bytes32 => uint256) walletRegistrationTimes; // Wallet registration timestamps
    }

    /// @dev Wallet information structure
    struct WalletInfo {
        address qc;
        WalletStatus status;
        uint256 registeredAt;
    }

    /// @dev Maps QC addresses to their data
    mapping(address => Custodian) private custodians;

    /// @dev Maps wallet addresses to their information
    mapping(bytes32 => WalletInfo) private wallets;

    /// @dev Maps QC addresses to their oracle synchronization data
    mapping(address => QCOracleData) private qcOracleData;

    /// @dev Maps QC addresses to their last status change timestamp
    mapping(address => uint256) private qcStatusChangeTimestamps;

    /// @dev Set of all registered QC addresses
    EnumerableSet.AddressSet private registeredQCs;

    // =================== STANDARDIZED EVENTS ===================

    /// @dev Emitted when a QC is registered
    event QCRegistered(
        address indexed qc,
        address indexed registeredBy,
        uint256 indexed maxMintingCapacity,
        uint256 timestamp
    );

    /// @dev Emitted when a QC's status changes
    event QCStatusChanged(
        address indexed qc,
        QCStatus indexed oldStatus,
        QCStatus indexed newStatus,
        bytes32 reason,
        address changedBy,
        uint256 timestamp
    );

    /// @dev Emitted when a wallet is registered
    event WalletRegistered(
        address indexed qc,
        string btcAddress,
        address indexed registeredBy,
        uint256 timestamp
    );

    /// @dev Emitted when wallet deregistration is requested
    event WalletDeRegistrationRequested(
        address indexed qc,
        string btcAddress,
        address indexed requestedBy,
        uint256 timestamp
    );

    /// @dev Emitted when wallet deregistration is finalized
    event WalletDeRegistrationFinalized(
        address indexed qc,
        string btcAddress,
        address indexed finalizedBy,
        uint256 timestamp
    );

    /// @dev Emitted when QC minted amount is updated
    event QCMintedAmountUpdated(
        address indexed qc,
        uint256 indexed oldAmount,
        uint256 indexed newAmount,
        address updatedBy,
        uint256 timestamp
    );

    /// @dev Emitted when QC max minting capacity is updated
    event QCMaxMintingCapacityUpdated(
        address indexed qc,
        uint256 indexed oldCapacity,
        uint256 indexed newCapacity,
        address updatedBy,
        uint256 timestamp
    );

    /// @dev Emitted when QC manager role is granted
    event QCManagerRoleGranted(
        address indexed manager,
        address indexed grantedBy,
        uint256 timestamp
    );

    /// @dev Emitted when QC manager role is revoked
    event QCManagerRoleRevoked(
        address indexed manager,
        address indexed revokedBy,
        uint256 timestamp
    );

    /// @dev Emitted when a wallet is activated
    event WalletActivated(
        address indexed qc,
        string btcAddress,
        address indexed activatedBy,
        uint256 timestamp
    );

    /// @dev Emitted when QC pause level is updated
    event QCPauseLevelUpdated(
        address indexed qc,
        PauseLevel indexed oldLevel,
        PauseLevel indexed newLevel,
        bool selfInitiated,
        address updatedBy,
        uint256 timestamp
    );

    /// @dev Emitted when QC oracle sync timestamp is updated
    event QCOracleSyncTimestampUpdated(
        address indexed qc,
        uint256 indexed oldTimestamp,
        uint256 indexed newTimestamp,
        address updatedBy,
        uint256 blockTimestamp
    );

    /// @dev Emitted when QC oracle failure status is updated
    event QCOracleFailureStatusUpdated(
        address indexed qc,
        bool indexed oldStatus,
        bool indexed newStatus,
        address updatedBy,
        uint256 timestamp
    );

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(QC_MANAGER_ROLE, msg.sender);
    }

    /// @dev Helper function to convert string wallet address to bytes32 key
    /// @param btcAddress The Bitcoin address as string
    /// @return key The bytes32 key for mapping lookups
    function _getWalletKey(string calldata btcAddress) private pure returns (bytes32 key) {
        return keccak256(bytes(btcAddress));
    }

    /// @notice Grant QC_MANAGER_ROLE to an address (typically QCManager contract)
    /// @param manager The address to grant the role to
    /// @dev Only callable by DEFAULT_ADMIN_ROLE
    function grantQCManagerRole(address manager)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (manager == address(0)) revert QCErrors.InvalidManagerAddress();
        _grantRole(QC_MANAGER_ROLE, manager);
        emit QCManagerRoleGranted(manager, msg.sender, block.timestamp);
    }

    /// @notice Revoke QC_MANAGER_ROLE from an address
    /// @param manager The address to revoke the role from
    /// @dev Only callable by DEFAULT_ADMIN_ROLE
    function revokeQCManagerRole(address manager)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _revokeRole(QC_MANAGER_ROLE, manager);
        emit QCManagerRoleRevoked(manager, msg.sender, block.timestamp);
    }


    /// @notice Register a new Qualified Custodian
    /// @param qc The address of the QC to register
    /// @param maxMintingCapacity The maximum minting capacity for this QC
    function registerQC(address qc, uint256 maxMintingCapacity)
        external
        onlyRole(QC_MANAGER_ROLE)
    {
        if (qc == address(0)) revert QCErrors.InvalidQCAddress();
        if (custodians[qc].registeredAt != 0) revert QCErrors.QCAlreadyRegistered(qc);
        if (maxMintingCapacity == 0) revert QCErrors.InvalidMintingCapacity();

        custodians[qc].status = QCStatus.Active;
        custodians[qc].pauseLevel = PauseLevel.MintingOnly; // Security default: enable fulfillment immediately but require explicit approval for minting
        custodians[qc].selfPaused = false;
        custodians[qc].maxMintingCapacity = maxMintingCapacity;
        custodians[qc].registeredAt = block.timestamp;
        qcStatusChangeTimestamps[qc] = block.timestamp; // Record initial status change timestamp
        registeredQCs.add(qc);

        emit QCRegistered(qc, msg.sender, maxMintingCapacity, block.timestamp);
    }

    /// @notice Update QC status
    /// @param qc The address of the QC
    /// @param newStatus The new status for the QC
    /// @param reason The reason for the status change
    function setQCStatus(
        address qc,
        QCStatus newStatus,
        bytes32 reason
    ) external onlyRole(QC_MANAGER_ROLE) {
        if (!isQCRegistered(qc)) revert QCErrors.QCNotRegistered(qc);

        QCStatus oldStatus = custodians[qc].status;
        custodians[qc].status = newStatus;

        // Record timestamp only if status actually changed
        if (oldStatus != newStatus) {
            qcStatusChangeTimestamps[qc] = block.timestamp;
        }

        emit QCStatusChanged(
            qc,
            oldStatus,
            newStatus,
            reason,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Register a wallet for a QC
    /// @param qc The address of the QC
    /// @dev Performs Bitcoin address format validation and adds wallet to QC's wallet set.
    ///      Wallet starts in Inactive status and must be activated separately.
    /// @param btcAddress The Bitcoin address to register
    function registerWallet(address qc, string calldata btcAddress)
        external
        onlyRole(QC_MANAGER_ROLE)
    {
        if (!isQCRegistered(qc)) revert QCErrors.QCNotRegistered(qc);
        
        // Lightweight Bitcoin address format validation (checks syntax/format only, not cryptographic validity)
        BitcoinAddressUtils.validateAddressFormat(btcAddress);
        
        if (isWalletRegistered(btcAddress)) revert QCErrors.WalletAlreadyRegistered();
        if (custodians[qc].walletKeys.length() >= MAX_WALLETS_PER_QC) revert QCErrors.MaxWalletsExceeded();

        // Add to QC's wallet list
        bytes32 walletKey = _getWalletKey(btcAddress);
        custodians[qc].walletKeys.add(walletKey);
        custodians[qc].walletAddresses[walletKey] = btcAddress;
        custodians[qc].walletStatuses[walletKey] = WalletStatus.Inactive;
        custodians[qc].walletRegistrationTimes[walletKey] = block.timestamp;

        // Store wallet info
        wallets[walletKey] = WalletInfo({
            qc: qc,
            status: WalletStatus.Inactive,
            registeredAt: block.timestamp
        });

        emit WalletRegistered(qc, btcAddress, msg.sender, block.timestamp);
    }

    /// @notice Activate a registered wallet
    /// @param btcAddress The Bitcoin address to activate
    function activateWallet(string calldata btcAddress)
        external
        onlyRole(QC_MANAGER_ROLE)
    {
        if (!isWalletRegistered(btcAddress)) revert QCErrors.WalletNotRegistered(btcAddress);
        
        bytes32 walletKey = _getWalletKey(btcAddress);
        if (wallets[walletKey].status != WalletStatus.Inactive) revert QCErrors.WalletNotInactive();
        
        address qc = wallets[walletKey].qc;
        custodians[qc].walletStatuses[walletKey] = WalletStatus.Active;
        wallets[walletKey].status = WalletStatus.Active;
        
        emit WalletActivated(qc, btcAddress, msg.sender, block.timestamp);
    }

    /// @notice Request wallet deregistration
    /// @param btcAddress The Bitcoin address to deregister
    function requestWalletDeRegistration(string calldata btcAddress)
        external
        onlyRole(QC_MANAGER_ROLE)
    {
        if (!isWalletRegistered(btcAddress)) revert QCErrors.WalletNotRegistered(btcAddress);
        if (!isWalletActive(btcAddress)) revert QCErrors.WalletNotActive(btcAddress);

        bytes32 walletKey = _getWalletKey(btcAddress);
        address qc = wallets[walletKey].qc;
        custodians[qc].walletStatuses[walletKey] = WalletStatus
            .PendingDeRegistration;
        wallets[walletKey].status = WalletStatus.PendingDeRegistration;

        emit WalletDeRegistrationRequested(
            qc,
            btcAddress,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Finalize wallet deregistration
    /// @param btcAddress The Bitcoin address to finalize deregistration
    function finalizeWalletDeRegistration(string calldata btcAddress)
        external
        onlyRole(QC_MANAGER_ROLE)
    {
        if (!isWalletRegistered(btcAddress)) revert QCErrors.WalletNotRegistered(btcAddress);
        bytes32 walletKey = _getWalletKey(btcAddress);
        if (wallets[walletKey].status != WalletStatus.PendingDeRegistration) {
            revert QCErrors.WalletNotPendingDeregistration(btcAddress);
        }

        address qc = wallets[walletKey].qc;
        custodians[qc].walletStatuses[walletKey] = WalletStatus.Deregistered;
        wallets[walletKey].status = WalletStatus.Deregistered;
        // Security assumption: preserve QC address for complete audit trail (compliance requirement)

        // Remove wallet from QC's wallet set
        custodians[qc].walletKeys.remove(walletKey);
        delete custodians[qc].walletAddresses[walletKey];

        emit WalletDeRegistrationFinalized(
            qc,
            btcAddress,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Update QC minted amount
    /// @dev Updates the total minted amount for a QC with capacity validation.
    ///      Prevents QC from exceeding allocated minting capacity.
    /// @param qc The address of the QC
    /// @param newAmount The new total minted amount in wei
    function updateQCMintedAmount(address qc, uint256 newAmount)
        external
        onlyRole(QC_MANAGER_ROLE)
    {
        if (!isQCRegistered(qc)) revert QCErrors.QCNotRegistered(qc);

        // Critical validation: prevent QC from exceeding allocated minting capacity (prevents overruns)
        if (newAmount > custodians[qc].maxMintingCapacity) revert QCErrors.ExceedsMintingCapacity();

        uint256 oldAmount = custodians[qc].totalMintedAmount;
        custodians[qc].totalMintedAmount = newAmount;

        emit QCMintedAmountUpdated(
            qc,
            oldAmount,
            newAmount,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Update QC max minting capacity
    /// @param qc The address of the QC
    /// @param newCapacity The new maximum minting capacity
    function updateMaxMintingCapacity(address qc, uint256 newCapacity)
        external
        onlyRole(QC_MANAGER_ROLE)
    {
        if (!isQCRegistered(qc)) revert QCErrors.QCNotRegistered(qc);
        if (newCapacity == 0) revert QCErrors.InvalidCapacity();
        if (newCapacity < custodians[qc].totalMintedAmount) revert QCErrors.CapacityBelowTotalMinted();

        uint256 oldCapacity = custodians[qc].maxMintingCapacity;
        custodians[qc].maxMintingCapacity = newCapacity;

        emit QCMaxMintingCapacityUpdated(
            qc,
            oldCapacity,
            newCapacity,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Get QC status
    /// @param qc The address of the QC
    /// @return status The current status of the QC
    function getQCStatus(address qc) external view returns (QCStatus status) {
        if (!isQCRegistered(qc)) revert QCErrors.QCNotRegistered(qc);
        return custodians[qc].status;
    }

    /// @notice Get QC status change timestamp
    /// @param qc The address of the QC
    /// @return timestamp The timestamp when the QC status was last changed (0 if never changed)
    function getQCStatusChangeTimestamp(address qc) external view returns (uint256 timestamp) {
        if (!isQCRegistered(qc)) revert QCErrors.QCNotRegistered(qc);
        return qcStatusChangeTimestamps[qc];
    }

    /// @notice Get QC minted amount
    /// @param qc The address of the QC
    /// @return amount The total amount minted by the QC
    function getQCMintedAmount(address qc)
        external
        view
        returns (uint256 amount)
    {
        return custodians[qc].totalMintedAmount;
    }

    /// @notice Get QC max minting capacity
    /// @param qc The address of the QC
    /// @return capacity The maximum minting capacity of the QC
    function getMaxMintingCapacity(address qc)
        external
        view
        returns (uint256 capacity)
    {
        return custodians[qc].maxMintingCapacity;
    }

    /// @notice Get wallet status
    /// @param btcAddress The Bitcoin address
    /// @return status The current status of the wallet
    function getWalletStatus(string calldata btcAddress)
        external
        view
        returns (WalletStatus status)
    {
        bytes32 walletKey = _getWalletKey(btcAddress);
        return wallets[walletKey].status;
    }

    /// @notice Get wallet owner QC
    /// @param btcAddress The Bitcoin address
    /// @return qc The address of the QC that owns the wallet
    function getWalletOwner(string calldata btcAddress)
        external
        view
        returns (address qc)
    {
        bytes32 walletKey = _getWalletKey(btcAddress);
        return wallets[walletKey].qc;
    }

    /// @notice Get QC wallet addresses
    /// @param qc The address of the QC
    /// @return addresses Array of wallet addresses for the QC
    function getQCWallets(address qc)
        external
        view
        returns (string[] memory addresses)
    {
        bytes32[] memory walletKeyArray = custodians[qc].walletKeys.values();
        uint256 length = walletKeyArray.length;
        addresses = new string[](length);
        
        for (uint256 i = 0; i < length; i++) {
            addresses[i] = custodians[qc].walletAddresses[walletKeyArray[i]];
        }
        return addresses;
    }

    /// @notice Get wallet count and capacity information for a QC
    /// @param qc The address of the QC
    /// @return current Current number of registered wallets
    /// @return maximum Maximum allowed wallets
    /// @return remaining Remaining wallet slots available
    function getQCWalletCapacity(address qc)
        external
        view
        returns (uint256 current, uint256 maximum, uint256 remaining)
    {
        current = custodians[qc].walletKeys.length();
        maximum = MAX_WALLETS_PER_QC;
        remaining = maximum > current ? maximum - current : 0;
    }

    /// @notice Check if QC is registered
    /// @param qc The address of the QC
    /// @return registered True if the QC is registered
    function isQCRegistered(address qc) public view returns (bool registered) {
        return custodians[qc].registeredAt != 0;
    }

    /// @notice Check if wallet is currently active
    /// @param btcAddress The Bitcoin address
    /// @return active True if the wallet is active
    function isWalletActive(string calldata btcAddress)
        public
        view
        returns (bool active)
    {
        bytes32 walletKey = _getWalletKey(btcAddress);
        return wallets[walletKey].status == WalletStatus.Active;
    }

    /// @notice Check if wallet has been deregistered
    /// @param btcAddress The Bitcoin address
    /// @return deregistered True if the wallet has been deregistered
    function isWalletDeregistered(string calldata btcAddress)
        external
        view
        returns (bool deregistered)
    {
        bytes32 walletKey = _getWalletKey(btcAddress);
        return wallets[walletKey].status == WalletStatus.Deregistered;
    }

    /// @notice Check if wallet is registered
    /// @param btcAddress The Bitcoin address
    /// @return registered True if the wallet is registered
    function isWalletRegistered(string calldata btcAddress)
        public
        view
        returns (bool registered)
    {
        bytes32 walletKey = _getWalletKey(btcAddress);
        return wallets[walletKey].registeredAt != 0;
    }

    /// @notice Check if wallet can be activated (is inactive but not deregistered)
    /// @param btcAddress The Bitcoin address
    /// @return canActivate True if the wallet can be activated
    function canActivateWallet(string calldata btcAddress)
        external
        view
        returns (bool canActivate)
    {
        bytes32 walletKey = _getWalletKey(btcAddress);
        return
            wallets[walletKey].status == WalletStatus.Inactive &&
            wallets[walletKey].registeredAt != 0;
    }

    // =================== 5-STATE MODEL FUNCTIONS ===================

    /// @notice Set QC pause level
    /// @param qc QC address
    /// @param pauseLevel The pause level to set
    /// @param selfInitiated True if QC initiated the pause
    function setQCPauseLevel(address qc, PauseLevel pauseLevel, bool selfInitiated) external onlyRole(QC_MANAGER_ROLE) {
        if (!isQCRegistered(qc)) {
            revert QCErrors.QCNotRegistered(qc);
        }
        
        PauseLevel oldLevel = custodians[qc].pauseLevel;
        custodians[qc].pauseLevel = pauseLevel;
        custodians[qc].selfPaused = selfInitiated;
        
        emit QCPauseLevelUpdated(qc, oldLevel, pauseLevel, selfInitiated, msg.sender, block.timestamp);
    }


    /// @notice Check if QC can mint (only Active state allows minting)
    /// @dev Complex business logic evaluation for minting permissions:
    ///      1. Early exit for unregistered QCs (no permissions)
    ///      2. Requires Active status (MintingPaused/Paused/UnderReview/Revoked all deny)
    ///      3. Requires pause level != Complete (allows MintingOnly pause for graceful degradation)
    ///      4. Used by QCManager for capacity consumption decisions
    ///      5. Critical for system security - prevents unauthorized minting
    /// @param qc QC address
    /// @return canMint True if QC can mint new tokens
    function canQCMint(address qc) external view returns (bool canMint) {
        // Early exit: unregistered QCs have no operational permissions
        if (!isQCRegistered(qc)) {
            return false;
        }

        QCStatus status = custodians[qc].status;
        PauseLevel pauseLevel = custodians[qc].pauseLevel;
        
        // Business logic: minting requires Active status AND not completely paused
        // - Active: full operational capability
        // - MintingPaused/Paused/UnderReview/Revoked: no minting allowed
        // - Complete pause level: all operations halted
        return status == QCStatus.Active && pauseLevel != PauseLevel.Complete;
    }

    /// @notice Check if QC can fulfill redemptions
    /// @dev Complex business logic for fulfillment permissions (more permissive than minting):
    ///      1. Early exit for unregistered QCs (no permissions)
    ///      2. Requires Active status (same as minting)
    ///      3. Allows fulfillment during MintingOnly pause (graceful degradation)
    ///      4. Only Complete pause halts fulfillment operations
    ///      5. Used by QCRedeemer for redemption processing decisions
    ///      6. Supports operational continuity during partial system degradation 
    /// @param qc QC address  
    /// @return canFulfill True if QC can fulfill redemptions
    function canQCFulfill(address qc) external view returns (bool canFulfill) {
        // Early exit: unregistered QCs have no operational permissions
        if (!isQCRegistered(qc)) {
            return false;
        }

        QCStatus status = custodians[qc].status;
        PauseLevel pauseLevel = custodians[qc].pauseLevel;
        
        // Business logic: fulfillment has more permissive rules than minting
        // - Active status required (same as minting)
        // - MintingOnly pause allows fulfillment to continue (graceful degradation)
        // - Complete pause halts all operations including fulfillment
        bool statusAllowsFulfill = status == QCStatus.Active;
        return statusAllowsFulfill && pauseLevel != PauseLevel.Complete;
    }

    /// @notice Get QC pause level
    /// @param qc QC address
    /// @return pauseLevel Current pause level
    function getQCPauseLevel(address qc) external view returns (PauseLevel pauseLevel) {
        if (!isQCRegistered(qc)) revert QCErrors.QCNotRegistered(qc);
        return custodians[qc].pauseLevel;
    }

    /// @notice Get QC self-paused status
    /// @param qc QC address
    /// @return selfPaused True if QC initiated current pause
    function getQCSelfPaused(address qc) external view returns (bool selfPaused) {
        if (!isQCRegistered(qc)) revert QCErrors.QCNotRegistered(qc);
        return custodians[qc].selfPaused;
    }

    /// @notice Get comprehensive QC information for 5-state model
    /// @param qc QC address
    /// @return status Current QC status
    /// @return totalMinted Total amount minted by QC
    /// @return maxCapacity Maximum minting capacity
    /// @return registeredAt Registration timestamp
    /// @return pauseLevel Current pause level
    /// @return selfPaused True if QC initiated current pause
    function getQCInfo(address qc) external view returns (
        QCStatus status,
        uint256 totalMinted,
        uint256 maxCapacity,
        uint256 registeredAt,
        PauseLevel pauseLevel,
        bool selfPaused
    ) {
        if (!isQCRegistered(qc)) revert QCErrors.QCNotRegistered(qc);
        Custodian storage custodian = custodians[qc];
        return (
            custodian.status,
            custodian.totalMintedAmount,
            custodian.maxMintingCapacity,
            custodian.registeredAt,
            custodian.pauseLevel,
            custodian.selfPaused
        );
    }

    /// @notice Get all registered QC addresses
    /// @return Array of registered QC addresses
    function getRegisteredQCs() external view returns (address[] memory) {
        return registeredQCs.values();
    }

    /// @notice Get the total number of registered QCs
    /// @return The number of registered QCs
    function getRegisteredQCCount() external view returns (uint256) {
        return registeredQCs.length();
    }

    // =================== ORACLE DATA FUNCTIONS ===================

    /// @notice Get QC oracle data
    /// @param qc The address of the QC
    /// @return lastSyncTimestamp The last sync timestamp
    /// @return oracleFailureDetected Whether oracle failure is detected
    function getQCOracleData(address qc) 
        external 
        view 
        returns (uint256 lastSyncTimestamp, bool oracleFailureDetected) 
    {
        QCOracleData storage data = qcOracleData[qc];
        return (data.lastSyncTimestamp, data.oracleFailureDetected);
    }

    /// @notice Get QC oracle last sync timestamp
    /// @param qc The address of the QC
    /// @return lastSyncTimestamp The last sync timestamp
    function getQCOracleLastSyncTimestamp(address qc) 
        external 
        view 
        returns (uint256 lastSyncTimestamp) 
    {
        return qcOracleData[qc].lastSyncTimestamp;
    }

    /// @notice Get QC oracle failure detection status
    /// @param qc The address of the QC
    /// @return oracleFailureDetected Whether oracle failure is detected
    function getQCOracleFailureDetected(address qc) 
        external 
        view 
        returns (bool oracleFailureDetected) 
    {
        return qcOracleData[qc].oracleFailureDetected;
    }

    /// @notice Update QC oracle sync timestamp
    /// @param qc The address of the QC
    /// @param newTimestamp The new sync timestamp
    function updateQCOracleSyncTimestamp(address qc, uint256 newTimestamp)
        external
        onlyRole(QC_MANAGER_ROLE)
    {
        if (!isQCRegistered(qc)) revert QCErrors.QCNotRegistered(qc);

        uint256 oldTimestamp = qcOracleData[qc].lastSyncTimestamp;
        qcOracleData[qc].lastSyncTimestamp = newTimestamp;

        emit QCOracleSyncTimestampUpdated(
            qc,
            oldTimestamp,
            newTimestamp,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Update QC oracle failure detection status
    /// @param qc The address of the QC
    /// @param failureDetected The new failure detection status
    function updateQCOracleFailureDetected(address qc, bool failureDetected)
        external
        onlyRole(QC_MANAGER_ROLE)
    {
        if (!isQCRegistered(qc)) revert QCErrors.QCNotRegistered(qc);

        bool oldStatus = qcOracleData[qc].oracleFailureDetected;
        qcOracleData[qc].oracleFailureDetected = failureDetected;

        emit QCOracleFailureStatusUpdated(
            qc,
            oldStatus,
            failureDetected,
            msg.sender,
            block.timestamp
        );
    }
}
