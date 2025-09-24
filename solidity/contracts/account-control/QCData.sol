// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title QCData
/// @dev Dedicated storage layer for all data related to Qualified Custodians
/// and their wallets. By isolating state, the system can upgrade logic contracts
/// without performing complex and risky data migrations. Implements simple
/// 3-state models as specified in the architecture.
contract QCData is AccessControl {
    bytes32 public constant QC_MANAGER_ROLE = keccak256("QC_MANAGER_ROLE");

    /// @dev Maximum number of wallets a QC can register to prevent unbounded array growth
    uint256 public constant MAX_WALLETS_PER_QC = 10;

    // Custom errors for gas-efficient reverts
    error InvalidManagerAddress();
    error InvalidQCAddress();
    error QCAlreadyRegistered();
    error InvalidMintingCapacity();
    error QCNotRegistered();
    error InvalidWalletAddress();
    error WalletAlreadyRegistered();
    error WalletNotRegistered();
    error WalletNotActive();
    error WalletNotPendingDeregistration();
    error InvalidCapacity();
    error MaxWalletsExceeded();

    /// @dev QC status enumeration - enhanced 5-state model
    enum QCStatus {
        Active,         // 0 - Full operations (mint + fulfill)
        MintingPaused,  // 1 - Can fulfill only (no new minting)
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

    /// @dev Qualified Custodian data structure - optimized for gas efficiency
    struct Custodian {
        uint256 totalMintedAmount; // Total tBTC minted by this QC
        uint256 maxMintingCapacity; // Maximum tBTC this QC can mint
        uint256 registeredAt; // Timestamp when QC was registered
        QCStatus status; // Current operational status
        bool selfPaused; // True if QC initiated the pause
        string[] walletAddresses; // Array of registered wallet addresses
        mapping(string => WalletStatus) walletStatuses;
        mapping(string => uint256) walletRegistrationTimes;
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
    mapping(string => WalletInfo) private wallets;

    /// @dev Array of all registered QC addresses
    address[] private registeredQCs;

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

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(QC_MANAGER_ROLE, msg.sender);
    }

    /// @notice Grant QC_MANAGER_ROLE to an address (typically QCManager contract)
    /// @param manager The address to grant the role to
    /// @dev Only callable by DEFAULT_ADMIN_ROLE
    function grantQCManagerRole(address manager)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (manager == address(0)) revert InvalidManagerAddress();
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
        if (qc == address(0)) revert InvalidQCAddress();
        if (custodians[qc].registeredAt != 0) revert QCAlreadyRegistered();
        if (maxMintingCapacity == 0) revert InvalidMintingCapacity();

        custodians[qc].status = QCStatus.Active;
        custodians[qc].maxMintingCapacity = maxMintingCapacity;
        custodians[qc].registeredAt = block.timestamp;
        registeredQCs.push(qc);

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
        if (!isQCRegistered(qc)) revert QCNotRegistered();

        QCStatus oldStatus = custodians[qc].status;
        custodians[qc].status = newStatus;

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
    /// @param btcAddress The Bitcoin address to register
    function registerWallet(address qc, string calldata btcAddress)
        external
        onlyRole(QC_MANAGER_ROLE)
    {
        if (!isQCRegistered(qc)) revert QCNotRegistered();
        if (bytes(btcAddress).length == 0) revert InvalidWalletAddress();
        if (isWalletRegistered(btcAddress)) revert WalletAlreadyRegistered();
        if (custodians[qc].walletAddresses.length >= MAX_WALLETS_PER_QC) revert MaxWalletsExceeded();

        // Add to QC's wallet list
        custodians[qc].walletAddresses.push(btcAddress);
        custodians[qc].walletStatuses[btcAddress] = WalletStatus.Active;
        custodians[qc].walletRegistrationTimes[btcAddress] = block.timestamp;

        // Store wallet info
        wallets[btcAddress] = WalletInfo({
            qc: qc,
            status: WalletStatus.Active,
            registeredAt: block.timestamp
        });

        emit WalletRegistered(qc, btcAddress, msg.sender, block.timestamp);
    }

    /// @notice Request wallet deregistration
    /// @param btcAddress The Bitcoin address to deregister
    function requestWalletDeRegistration(string calldata btcAddress)
        external
        onlyRole(QC_MANAGER_ROLE)
    {
        if (!isWalletRegistered(btcAddress)) revert WalletNotRegistered();
        if (!isWalletActive(btcAddress)) revert WalletNotActive();

        address qc = wallets[btcAddress].qc;
        custodians[qc].walletStatuses[btcAddress] = WalletStatus
            .PendingDeRegistration;
        wallets[btcAddress].status = WalletStatus.PendingDeRegistration;

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
        if (!isWalletRegistered(btcAddress)) revert WalletNotRegistered();
        if (wallets[btcAddress].status != WalletStatus.PendingDeRegistration) {
            revert WalletNotPendingDeregistration();
        }

        address qc = wallets[btcAddress].qc;
        custodians[qc].walletStatuses[btcAddress] = WalletStatus.Deregistered;
        wallets[btcAddress].status = WalletStatus.Deregistered;
        // Note: Keep qc address for audit trail instead of zeroing it

        // Remove wallet from QC's active list - cache storage array in memory for gas optimization
        string[] storage qcWallets = custodians[qc].walletAddresses;
        uint256 walletCount = qcWallets.length;
        bytes32 targetHash = keccak256(bytes(btcAddress));

        for (uint256 i = 0; i < walletCount; i++) {
            if (keccak256(bytes(qcWallets[i])) == targetHash) {
                qcWallets[i] = qcWallets[walletCount - 1];
                qcWallets.pop();
                break;
            }
        }

        emit WalletDeRegistrationFinalized(
            qc,
            btcAddress,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Update QC minted amount
    /// @param qc The address of the QC
    /// @param newAmount The new total minted amount
    function updateQCMintedAmount(address qc, uint256 newAmount)
        external
        onlyRole(QC_MANAGER_ROLE)
    {
        if (!isQCRegistered(qc)) revert QCNotRegistered();

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
        if (!isQCRegistered(qc)) revert QCNotRegistered();
        if (newCapacity == 0) revert InvalidCapacity();

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
        return custodians[qc].status;
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
        return wallets[btcAddress].status;
    }

    /// @notice Get wallet owner QC
    /// @param btcAddress The Bitcoin address
    /// @return qc The address of the QC that owns the wallet
    function getWalletOwner(string calldata btcAddress)
        external
        view
        returns (address qc)
    {
        return wallets[btcAddress].qc;
    }

    /// @notice Get QC wallet addresses
    /// @param qc The address of the QC
    /// @return addresses Array of wallet addresses for the QC
    function getQCWallets(address qc)
        external
        view
        returns (string[] memory addresses)
    {
        return custodians[qc].walletAddresses;
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
        current = custodians[qc].walletAddresses.length;
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
        return wallets[btcAddress].status == WalletStatus.Active;
    }

    /// @notice Check if wallet has been deregistered
    /// @param btcAddress The Bitcoin address
    /// @return deregistered True if the wallet has been deregistered
    function isWalletDeregistered(string calldata btcAddress)
        external
        view
        returns (bool deregistered)
    {
        return wallets[btcAddress].status == WalletStatus.Deregistered;
    }

    /// @notice Check if wallet is registered
    /// @param btcAddress The Bitcoin address
    /// @return registered True if the wallet is registered
    function isWalletRegistered(string calldata btcAddress)
        public
        view
        returns (bool registered)
    {
        return wallets[btcAddress].registeredAt != 0;
    }

    /// @notice Check if wallet can be activated (is inactive but not deregistered)
    /// @param btcAddress The Bitcoin address
    /// @return canActivate True if the wallet can be activated
    function canActivateWallet(string calldata btcAddress)
        external
        view
        returns (bool canActivate)
    {
        return
            wallets[btcAddress].status == WalletStatus.Inactive &&
            wallets[btcAddress].registeredAt != 0;
    }

    // =================== 5-STATE MODEL FUNCTIONS ===================

    /// @notice Set QC self-paused status
    /// @param qc QC address
    /// @param selfPaused True if QC initiated the pause
    function setQCSelfPaused(address qc, bool selfPaused) external onlyRole(QC_MANAGER_ROLE) {
        if (!isQCRegistered(qc)) {
            revert QCNotRegistered();
        }
        custodians[qc].selfPaused = selfPaused;
    }

    /// @notice Check if QC can mint (Active or MintingPaused states with minting allowed)
    /// @param qc QC address
    /// @return canMint True if QC can mint new tokens
    function canQCMint(address qc) external view returns (bool canMint) {
        QCStatus status = custodians[qc].status;
        return status == QCStatus.Active;
    }

    /// @notice Check if QC can fulfill redemptions 
    /// @param qc QC address  
    /// @return canFulfill True if QC can fulfill redemptions
    function canQCFulfill(address qc) external view returns (bool canFulfill) {
        QCStatus status = custodians[qc].status;
        return status == QCStatus.Active || 
               status == QCStatus.MintingPaused || 
               status == QCStatus.UnderReview;
    }

    /// @notice Get comprehensive QC information for 5-state model
    /// @param qc QC address
    /// @return status Current QC status
    /// @return totalMinted Total amount minted by QC
    /// @return maxCapacity Maximum minting capacity
    /// @return registeredAt Registration timestamp
    /// @return selfPaused True if QC initiated current pause
    function getQCInfo(address qc) external view returns (
        QCStatus status,
        uint256 totalMinted,
        uint256 maxCapacity,
        uint256 registeredAt,
        bool selfPaused
    ) {
        Custodian storage custodian = custodians[qc];
        return (
            custodian.status,
            custodian.totalMintedAmount,
            custodian.maxMintingCapacity,
            custodian.registeredAt,
            custodian.selfPaused
        );
    }
}
