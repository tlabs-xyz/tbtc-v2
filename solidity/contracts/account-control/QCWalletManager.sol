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
import "./QCData.sol";
import "./QCErrors.sol";
import "./SystemState.sol";
import "./ReserveOracle.sol";
import "./QCManagerLib.sol";
import "./interfaces/IQCRedeemer.sol";
import "./interfaces/IQCWalletManager.sol";

/// @title QCWalletManager
/// @notice Manages wallet registration and deregistration for Qualified Custodians
/// @dev Extracted from QCManager to reduce contract size while maintaining functionality
contract QCWalletManager is AccessControl, ReentrancyGuard, QCErrors, IQCWalletManager {
    
    // =================== ROLES ===================
    
    bytes32 public constant QC_MANAGER_ROLE = keccak256("QC_MANAGER_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    // =================== STORAGE ===================

    QCData public immutable qcData;
    SystemState public immutable systemState;
    ReserveOracle public immutable reserveOracle;
    IQCRedeemer public qcRedeemer;

    /// @notice Track used nonces per QC for direct wallet registration
    mapping(address => mapping(uint256 => bool)) public usedNonces;
    
    /// @notice Track deregistration locks to prevent concurrent operations
    mapping(string => bool) private walletDeregistrationLocks;
    
    /// @notice Circuit breaker for emergency situations
    bool public emergencyStop;
    
    /// @notice Timelock for qcRedeemer changes (24 hours)
    uint256 public constant QC_REDEEMER_TIMELOCK = 24 hours;
    mapping(address => uint256) public pendingQCRedeemerUpdate;
    address public pendingQCRedeemer;

    // =================== EVENTS ===================

    /// @notice Emitted when wallet registration is requested
    event WalletRegistrationRequested(
        address indexed qc,
        string btcAddress,
        bytes32 indexed challenge,
        address indexed requestedBy,
        uint256 timestamp
    );

    /// @notice Emitted when wallet ownership verification is requested
    event WalletOwnershipVerificationRequested(
        address indexed qc,
        string bitcoinAddress,
        bytes32 indexed challenge,
        address indexed requestedBy,
        uint256 timestamp
    );

    /// @notice Emitted when wallet deregistration is requested
    event WalletDeregistrationRequested(
        address indexed qc, 
        string btcAddress,
        address indexed requestedBy,
        uint256 timestamp
    );

    /// @notice Emitted when wallet deregistration is completed with reserve balance details
    event WalletDeregistrationCompleted(
        address indexed qc,
        string btcAddress,
        uint256 indexed newReserveBalance,
        uint256 previousReserveBalance,
        address indexed completedBy,
        uint256 timestamp
    );

    /// @notice Emitted when reserve balance is updated
    event ReserveBalanceUpdated(
        address indexed qc,
        uint256 indexed oldBalance,
        uint256 indexed newBalance,
        address updatedBy
    );
    
    /// @notice Emitted when QCRedeemer update is proposed
    event QCRedeemerUpdateProposed(
        address indexed newRedeemer,
        uint256 indexed executionTime,
        address indexed caller
    );
    
    /// @notice Emitted when QCRedeemer is updated
    event QCRedeemerUpdated(
        address indexed oldRedeemer,
        address indexed newRedeemer,
        address indexed caller
    );
    
    /// @notice Emitted when emergency stop is set
    event EmergencyStopSet(
        bool indexed stopped,
        address indexed setBy
    );

    // =================== MODIFIERS ===================

    modifier onlyWhenNotPaused(string memory f) {
        require(!systemState.isFunctionPaused(f), "Paused");
        _;
    }

    modifier onlyQCManager() {
        require(hasRole(QC_MANAGER_ROLE, msg.sender), "Only QCManager");
        _;
    }
    
    modifier notInEmergency() {
        require(!emergencyStop, "Emergency stop activated");
        _;
    }
    
    modifier withWalletLock(string calldata btcAddress) {
        require(!walletDeregistrationLocks[btcAddress], "In progress");
        walletDeregistrationLocks[btcAddress] = true;
        _;
        walletDeregistrationLocks[btcAddress] = false;
    }

    // =================== CONSTRUCTOR ===================

    constructor(
        address _qcData,
        address _systemState,
        address _reserveOracle
    ) {
        require(_qcData != address(0), "Invalid QCData");
        require(_systemState != address(0), "Invalid SystemState");
        require(_reserveOracle != address(0), "Invalid ReserveOracle");

        qcData = QCData(_qcData);
        systemState = SystemState(_systemState);
        reserveOracle = ReserveOracle(_reserveOracle);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GOVERNANCE_ROLE, msg.sender);
        _grantRole(REGISTRAR_ROLE, msg.sender);
    }

    // =================== ADMIN FUNCTIONS ===================

    /// @notice Propose a QCRedeemer contract update with timelock
    /// @param _qcRedeemer New QCRedeemer address
    /// @dev Requires DEFAULT_ADMIN_ROLE and enforces 24-hour timelock for security
    function proposeQCRedeemer(address _qcRedeemer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        pendingQCRedeemer = _qcRedeemer;
        pendingQCRedeemerUpdate[_qcRedeemer] = block.timestamp + QC_REDEEMER_TIMELOCK;
        emit QCRedeemerUpdateProposed(_qcRedeemer, block.timestamp + QC_REDEEMER_TIMELOCK, msg.sender);
    }
    
    /// @notice Execute pending QCRedeemer update after timelock
    /// @dev Can only be called after the timelock period has expired
    function executeQCRedeemerUpdate() external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(pendingQCRedeemer != address(0), "No pending update");
        require(block.timestamp >= pendingQCRedeemerUpdate[pendingQCRedeemer], "Timelock not expired");
        
        address oldRedeemer = address(qcRedeemer);
        qcRedeemer = IQCRedeemer(pendingQCRedeemer);
        
        delete pendingQCRedeemerUpdate[pendingQCRedeemer];
        pendingQCRedeemer = address(0);
        
        emit QCRedeemerUpdated(oldRedeemer, address(qcRedeemer), msg.sender);
    }
    
    /// @notice Set emergency stop (circuit breaker)
    /// @param _stop True to activate emergency stop, false to deactivate
    /// @dev Emergency stop prevents all wallet operations except admin functions
    function setEmergencyStop(bool _stop) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emergencyStop = _stop;
        emit EmergencyStopSet(_stop, msg.sender);
    }

    // =================== WALLET MANAGEMENT ===================

    /// @notice Register a wallet for a QC using Bitcoin signature verification
    /// @param qc The qualified custodian address
    /// @param btcAddress The Bitcoin address to register
    /// @param challenge The challenge used for signature verification
    /// @param walletPublicKey The wallet's public key for verification
    /// @param v The recovery parameter of the signature
    /// @param r The r component of the signature
    /// @param s The s component of the signature
    /// @dev Requires REGISTRAR_ROLE and validates Bitcoin signature ownership
    function registerWallet(
        address qc,
        string calldata btcAddress,
        bytes32 challenge,
        bytes calldata walletPublicKey,
        uint8 v,
        bytes32 r,
        bytes32 s
    )
        external
        override
        onlyRole(REGISTRAR_ROLE)
        onlyWhenNotPaused("wallet_reg")
        notInEmergency
        nonReentrant
    {
        QCManagerLib.validateWalletRegistrationFull(
            qcData, qc, btcAddress, challenge, walletPublicKey, v, r, s
        );

        qcData.registerWallet(qc, btcAddress);

        emit WalletRegistrationRequested(qc, btcAddress, challenge, msg.sender, block.timestamp);
    }

    /// @notice Direct wallet registration by QCs themselves
    /// @param btcAddress The Bitcoin address to register
    /// @param nonce Unique nonce to prevent replay attacks
    /// @param walletPublicKey The wallet's public key for verification
    /// @param v The recovery parameter of the signature
    /// @param r The r component of the signature
    /// @param s The s component of the signature
    /// @dev Allows QCs to register wallets directly without REGISTRAR_ROLE
    function registerWalletDirect(
        string calldata btcAddress,
        uint256 nonce,
        bytes calldata walletPublicKey,
        uint8 v,
        bytes32 r,
        bytes32 s
    )
        external
        override
        onlyWhenNotPaused("wallet_reg")
        notInEmergency
        nonReentrant
    {
        bytes32 challenge = QCManagerLib.validateDirectWalletRegistration(
            qcData, msg.sender, btcAddress, nonce, walletPublicKey, v, r, s, block.chainid
        );

        if (usedNonces[msg.sender][nonce]) revert QCErrors.NonceAlreadyUsed(msg.sender, nonce);
        usedNonces[msg.sender][nonce] = true;

        qcData.registerWallet(msg.sender, btcAddress);

        emit WalletRegistrationRequested(msg.sender, btcAddress, challenge, msg.sender, block.timestamp);
    }

    /// @notice Request wallet ownership verification
    /// @param bitcoinAddress The Bitcoin address to verify ownership of
    /// @param nonce Unique nonce for challenge generation
    /// @return challenge The generated challenge for signature verification
    /// @dev Generates a challenge that must be signed to prove wallet ownership
    function requestWalletOwnershipVerification(
        string calldata bitcoinAddress,
        uint256 nonce
    ) external override returns (bytes32 challenge) {
        address qc;
        
        if (qcData.isQCRegistered(msg.sender)) {
            qc = msg.sender;
        } else if (hasRole(REGISTRAR_ROLE, msg.sender)) {
            revert QCErrors.MustUseRegisterWallet();
        } else {
            revert QCErrors.NotAuthorizedForWalletDeregistration(msg.sender);
        }

        if (bytes(bitcoinAddress).length == 0) revert QCErrors.InvalidWalletAddress();
        if (!QCManagerLib.isValidBitcoinAddress(bitcoinAddress)) revert QCErrors.InvalidWalletAddress();

        challenge = keccak256(abi.encodePacked("TBTC:", qc, nonce));

        emit WalletOwnershipVerificationRequested(qc, bitcoinAddress, challenge, msg.sender, block.timestamp);

        return challenge;
    }

    /// @notice Request wallet deregistration with atomic lock protection
    /// @param btcAddress The Bitcoin address to deregister
    /// @dev Checks for pending redemptions and locks wallet during deregistration process
    function requestWalletDeRegistration(string calldata btcAddress)
        external
        override
        onlyWhenNotPaused("wallet_reg")
        notInEmergency
        nonReentrant
        withWalletLock(btcAddress)
    {
        address qc = qcData.getWalletOwner(btcAddress);
        if (qc == address(0)) revert QCErrors.WalletNotRegistered(btcAddress);
        if (msg.sender != qc && !hasRole(GOVERNANCE_ROLE, msg.sender)) {
            revert QCErrors.NotAuthorizedForWalletDeregistration(msg.sender);
        }
        if (qcData.getWalletStatus(btcAddress) != QCData.WalletStatus.Active) {
            revert QCErrors.WalletNotActive(btcAddress);
        }

        bool hasObligations = address(qcRedeemer) != address(0) &&
            qcRedeemer.hasWalletObligations(btcAddress);

        if (hasObligations) {
            revert QCErrors.WalletHasPendingRedemptions();
        }

        qcData.requestWalletDeRegistration(btcAddress);
        emit WalletDeregistrationRequested(qc, btcAddress, msg.sender, block.timestamp);
    }

    /// @notice Finalize wallet deregistration with solvency check
    /// @param btcAddress The Bitcoin address to complete deregistration for
    /// @param newReserveBalance The updated reserve balance after deregistration
    /// @dev Performs solvency validation before completing deregistration
    function finalizeWalletDeRegistration(
        string calldata btcAddress,
        uint256 newReserveBalance
    )
        external
        override
        onlyRole(REGISTRAR_ROLE)
        onlyWhenNotPaused("wallet_reg")
        notInEmergency
        nonReentrant
    {
        address qc = qcData.getWalletOwner(btcAddress);
        if (qc == address(0)) revert QCErrors.WalletNotRegistered(btcAddress);
        if (qcData.getWalletStatus(btcAddress) != QCData.WalletStatus.PendingDeRegistration) {
            revert QCErrors.WalletNotPendingDeregistration(btcAddress);
        }

        // Get old balance before updating
        (uint256 oldBalance, ) = QCManagerLib.getReserveBalanceAndStaleness(reserveOracle, qc);

        // Update reserve balance and perform solvency check
        _updateReserveBalanceAndCheckSolvency(qc, newReserveBalance);

        // If we reach here, QC is solvent - finalize deregistration
        qcData.finalizeWalletDeRegistration(btcAddress);
        emit WalletDeregistrationCompleted(qc, btcAddress, newReserveBalance, oldBalance, msg.sender, block.timestamp);
    }

    // =================== VIEW FUNCTIONS ===================

    /// @notice Check if wallet is locked for deregistration
    /// @param btcAddress The Bitcoin address to check lock status for
    /// @return True if wallet is currently locked for deregistration operations
    function isWalletDeregistrationLocked(string calldata btcAddress) 
        external 
        view 
        override 
        returns (bool) 
    {
        return walletDeregistrationLocks[btcAddress];
    }

    // =================== WALLET ADMIN FUNCTIONS ===================

    /// @notice Set QCRedeemer contract reference
    /// @param _qcRedeemer The new QCRedeemer contract address
    /// @dev First-time setting is immediate; updates require timelock for security
    function setQCRedeemer(address _qcRedeemer) external override onlyRole(GOVERNANCE_ROLE) {
        if (_qcRedeemer == address(0)) revert InvalidManagerAddress();
        
        // Check if this is the first set or an update
        if (address(qcRedeemer) == address(0)) {
            // First time setting
            qcRedeemer = IQCRedeemer(_qcRedeemer);
        } else {
            // Update with timelock
            if (pendingQCRedeemer == address(0)) {
                // Initiate update
                pendingQCRedeemer = _qcRedeemer;
                pendingQCRedeemerUpdate[_qcRedeemer] = block.timestamp + QC_REDEEMER_TIMELOCK;
            } else {
                // Complete update
                require(pendingQCRedeemer == _qcRedeemer, "Wrong pending address");
                require(block.timestamp >= pendingQCRedeemerUpdate[_qcRedeemer], "Timelock not expired");
                
                qcRedeemer = IQCRedeemer(_qcRedeemer);
                pendingQCRedeemer = address(0);
                delete pendingQCRedeemerUpdate[_qcRedeemer];
            }
        }
    }

    // =================== INTERNAL FUNCTIONS ===================

    /// @notice Update reserve balance and check solvency
    /// @param qc The qualified custodian address
    /// @param newBalance The new reserve balance to set
    /// @dev Validates QC remains solvent after balance update
    function _updateReserveBalanceAndCheckSolvency(address qc, uint256 newBalance) private {
        (uint256 oldBalance,) = QCManagerLib.getReserveBalanceAndStaleness(reserveOracle, qc);
        QCManagerLib.updateReserveBalanceAndCheckSolvency(qc, newBalance, qcData);
        emit ReserveBalanceUpdated(qc, oldBalance, newBalance, msg.sender);
    }
}