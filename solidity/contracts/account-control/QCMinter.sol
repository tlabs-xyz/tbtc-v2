// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./QCManager.sol";
import "./QCData.sol";
import "./SystemState.sol";
import "../bank/Bank.sol";
import "../vault/TBTCVault.sol";
import "../token/TBTC.sol";
import "./AccountControl.sol";


/// @title QCMinter
/// @notice QC-backed tBTC minting implementation
/// @dev This contract validates QC status, reserve freshness, and capacity
///      before creating Bank balances and minting tBTC tokens.
///
/// Role definitions:
/// - DEFAULT_ADMIN_ROLE: Can grant/revoke roles
/// - MINTER_ROLE: Can request minting of tBTC tokens
contract QCMinter is AccessControl, ReentrancyGuard {
    error InvalidQCAddress();
    error InvalidUserAddress();
    error InvalidAmount();
    error MintingPaused();
    error AmountOutsideAllowedRange();
    error QCNotActive();
    error InsufficientMintingCapacity();
    error NotAuthorizedInBank();
    error InsufficientBalance();
    error ZeroAmount();

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    uint256 public constant SATOSHI_MULTIPLIER = 1e10;

    // Core protocol contracts
    Bank public immutable bank;
    TBTCVault public immutable tbtcVault;
    TBTC public immutable tbtc;

    // Business logic contracts
    QCData public immutable qcData;
    SystemState public immutable systemState;
    QCManager public immutable qcManager;

    // Auto-minting support
    bool public autoMintEnabled;

    // =================== ACCOUNT CONTROL INTEGRATION ===================
    // Required AccountControl integration
    address public accountControl;

    /// @dev Mapping to track mint requests
    mapping(bytes32 => MintRequest) public mintRequests;

    /// @dev Counter for generating unique mint IDs
    uint256 private mintCounter;

    struct MintRequest {
        address qc;
        address user;
        uint256 amount;
        uint256 timestamp;
        bool completed;
    }

    // =================== EVENTS ===================

    /// @notice Emitted when QC-backed deposit is credited to Bank
    event QCBackedDepositCredited(
        address indexed user,
        uint256 amount,
        address indexed qc,
        bytes32 indexed mintId,
        bool autoMinted
    );

    /// @notice Emitted when a mint is completed
    event MintCompleted(
        bytes32 indexed mintId,
        address indexed qc,
        address indexed user,
        uint256 amount,
        address completedBy,
        uint256 timestamp
    );

    /// @notice Emitted when a mint is rejected
    event MintRejected(
        address indexed qc,
        address indexed user,
        uint256 indexed amount,
        string reason,
        address rejectedBy,
        uint256 timestamp
    );

    /// @notice Emitted when QC-backed balance is created in Bank
    event QCBankBalanceCreated(
        address indexed qc,
        address indexed user,
        uint256 satoshis,
        bytes32 indexed mintId
    );

    /// @dev Emitted when a QC minting request is initiated
    event QCMintRequested(
        address indexed qc,
        address indexed user,
        uint256 indexed amount,
        bytes32 mintId,
        address requestedBy,
        uint256 timestamp
    );

    /// @notice Emitted when auto-mint feature is enabled/disabled
    event AutoMintToggled(bool enabled);

    /// @notice Emitted when AccountControl address is updated
    event AccountControlUpdated(address indexed accountControl);

    /// @notice Emitted when auto-mint is completed
    event AutoMintCompleted(
        address indexed user,
        uint256 satoshis,
        uint256 tbtcAmount
    );

    /// @notice Emitted when manual mint is completed
    event ManualMintCompleted(
        address indexed user,
        uint256 satoshis,
        uint256 tbtcAmount
    );

    /// @notice Emitted when QC mint is completed (hybrid version)
    event QCMintCompleted(
        address indexed user,
        uint256 satoshis,
        bool automated
    );

    constructor(
        address _bank,
        address _tbtcVault,
        address _tbtc,
        address _qcData,
        address _systemState,
        address _qcManager
    ) {
        require(_bank != address(0), "Invalid bank address");
        require(_tbtcVault != address(0), "Invalid vault address");
        require(_tbtc != address(0), "Invalid token address");
        require(_qcData != address(0), "Invalid qcData address");
        require(_systemState != address(0), "Invalid systemState address");
        require(_qcManager != address(0), "Invalid qcManager address");

        bank = Bank(_bank);
        tbtcVault = TBTCVault(_tbtcVault);
        tbtc = TBTC(_tbtc);
        qcData = QCData(_qcData);
        systemState = SystemState(_systemState);
        qcManager = QCManager(_qcManager);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    /// @notice Enable or disable auto-minting feature
    /// @param enabled Whether auto-minting should be enabled
    function setAutoMintEnabled(bool enabled) external onlyRole(GOVERNANCE_ROLE) {
        autoMintEnabled = enabled;
        emit AutoMintToggled(enabled);
    }

    // =================== CONFIGURATION ===================

    /// @notice Set AccountControl address
    /// @param _accountControl Address of the AccountControl contract
    function setAccountControl(address _accountControl) external onlyRole(GOVERNANCE_ROLE) {
        accountControl = _accountControl;
        emit AccountControlUpdated(_accountControl);
    }

    /// @dev Validates QC capacity and creates Bank balance
    ///      SECURITY: nonReentrant protects against reentrancy
    /// @param qc The address of the Qualified Custodian
    /// @param amount The amount of tBTC to mint (in wei, 1e18 = 1 tBTC)
    /// @return mintId Unique identifier for this minting request
    function requestQCMint(address qc, uint256 amount)
        external
        onlyRole(MINTER_ROLE)
        nonReentrant
        returns (bytes32 mintId)
    {
        return _requestMint(qc, msg.sender, amount);
    }

    /// @notice Request QC-backed minting with hybrid options
    /// @param qc The address of the Qualified Custodian
    /// @param amount The amount of tBTC to mint (in wei, 1e18 = 1 tBTC)
    /// @param autoMint Whether to use automated minting (if enabled)
    /// @param permitData Optional permit data for gasless approval (currently unused)
    /// @return mintId Unique identifier for this minting request
    function requestQCMintHybrid(
        address qc,
        uint256 amount,
        bool autoMint,
        bytes calldata permitData
    ) external onlyRole(MINTER_ROLE) nonReentrant returns (bytes32 mintId) {
        return _requestMintHybrid(qc, msg.sender, amount, autoMint, permitData);
    }

    /// @notice Internal minting logic
    /// @param qc The address of the Qualified Custodian
    /// @param user The address receiving the tBTC tokens
    /// @param amount The amount of tBTC to mint (in wei, 1e18 = 1 tBTC)
    /// @return mintId Unique identifier for this minting request
    function _requestMint(
        address qc,
        address user,
        uint256 amount
    ) internal returns (bytes32 mintId) {
        // Validate inputs
        if (qc == address(0)) revert InvalidQCAddress();
        if (user == address(0)) revert InvalidUserAddress();
        if (amount == 0) revert InvalidAmount();

        // Check system state
        if (systemState.isMintingPaused()) {
            emit MintRejected(
                qc,
                user,
                amount,
                "Minting paused",
                msg.sender,
                block.timestamp
            );
            revert MintingPaused();
        }
        if (systemState.isQCEmergencyPaused(qc)) {
            emit MintRejected(
                qc,
                user,
                amount,
                "QC emergency paused",
                msg.sender,
                block.timestamp
            );
            revert SystemState.QCIsEmergencyPaused(qc);
        }
        if (
            amount < systemState.minMintAmount() ||
            amount > systemState.maxMintAmount()
        ) {
            emit MintRejected(
                qc,
                user,
                amount,
                "Amount outside allowed range",
                msg.sender,
                block.timestamp
            );
            revert AmountOutsideAllowedRange();
        }

        // Check QC status
        if (qcData.getQCStatus(qc) != QCData.QCStatus.Active) {
            emit MintRejected(
                qc,
                user,
                amount,
                "QC not active",
                msg.sender,
                block.timestamp
            );
            revert QCNotActive();
        }

        // Check minting capacity
        uint256 availableCapacity = getAvailableMintingCapacity(qc);
        if (amount > availableCapacity) {
            emit MintRejected(
                qc,
                user,
                amount,
                "Insufficient capacity",
                msg.sender,
                block.timestamp
            );
            revert InsufficientMintingCapacity();
        }

        // Generate unique mint ID
        mintId = _generateMintId(qc, user, amount);

        // Store mint request
        mintRequests[mintId] = MintRequest({
            qc: qc,
            user: user,
            amount: amount,
            timestamp: block.timestamp,
            completed: false
        });

        // Verify this contract is authorized in Bank
        if (!bank.authorizedBalanceIncreasers(address(this))) {
            revert NotAuthorizedInBank();
        }

        // Use AccountControl for minting (handles tBTC to satoshi conversion internally)
        AccountControl(accountControl).mintTBTC(user, amount);

        // Convert to satoshis for event emission and tracking
        uint256 satoshis = amount / SATOSHI_MULTIPLIER;
        
        // Emit event for QC attribution
        emit QCBankBalanceCreated(qc, user, satoshis, mintId);

        // Update QC minted amount
        _updateQCMintedAmount(qc, amount);

        // Mark mint as completed
        mintRequests[mintId].completed = true;

        // Emit events
        emit QCBackedDepositCredited(user, satoshis, qc, mintId, true);
        emit MintCompleted(
            mintId,
            qc,
            user,
            amount,
            msg.sender,
            block.timestamp
        );
        emit QCMintRequested(
            qc,
            user,
            amount,
            mintId,
            msg.sender,
            block.timestamp
        );

        return mintId;
    }

    /// @notice Internal hybrid minting logic
    /// @param qc The address of the Qualified Custodian
    /// @param user The address receiving the tBTC tokens
    /// @param amount The amount of tBTC to mint (in wei, 1e18 = 1 tBTC)
    /// @param autoMint Whether to use automated minting (if enabled)
    /// @param permitData Optional permit data for gasless approval (currently unused)
    /// @return mintId Unique identifier for this minting request
    function _requestMintHybrid(
        address qc,
        address user,
        uint256 amount,
        bool autoMint,
        bytes calldata permitData
    ) internal returns (bytes32 mintId) {
        // Validate inputs (same as original)
        if (qc == address(0)) revert InvalidQCAddress();
        if (user == address(0)) revert InvalidUserAddress();
        if (amount == 0) revert InvalidAmount();

        // Check system state (same as original)
        if (systemState.isMintingPaused()) {
            emit MintRejected(
                qc,
                user,
                amount,
                "Minting paused",
                msg.sender,
                block.timestamp
            );
            revert MintingPaused();
        }
        if (systemState.isQCEmergencyPaused(qc)) {
            emit MintRejected(
                qc,
                user,
                amount,
                "QC emergency paused",
                msg.sender,
                block.timestamp
            );
            revert SystemState.QCIsEmergencyPaused(qc);
        }
        if (
            amount < systemState.minMintAmount() ||
            amount > systemState.maxMintAmount()
        ) {
            emit MintRejected(
                qc,
                user,
                amount,
                "Amount outside allowed range",
                msg.sender,
                block.timestamp
            );
            revert AmountOutsideAllowedRange();
        }

        // Check QC status (same as original)
        if (qcData.getQCStatus(qc) != QCData.QCStatus.Active) {
            emit MintRejected(
                qc,
                user,
                amount,
                "QC not active",
                msg.sender,
                block.timestamp
            );
            revert QCNotActive();
        }

        // Check minting capacity (same as original)
        uint256 availableCapacity = getAvailableMintingCapacity(qc);
        if (amount > availableCapacity) {
            emit MintRejected(
                qc,
                user,
                amount,
                "Insufficient capacity",
                msg.sender,
                block.timestamp
            );
            revert InsufficientMintingCapacity();
        }

        // Generate unique mint ID (same as original)
        mintId = _generateMintId(qc, user, amount);

        // Store mint request (same as original)
        mintRequests[mintId] = MintRequest({
            qc: qc,
            user: user,
            amount: amount,
            timestamp: block.timestamp,
            completed: false
        });

        // No need to check authorization here - Bank will check when we call increaseBalance

        // HYBRID LOGIC: Choose between manual and automated minting
        if (autoMint && autoMintEnabled) {
            // Option 1: Automated minting - create balance and immediately mint tBTC
            AccountControl(accountControl).mintTBTC(user, amount);
            
            // Convert to satoshis for further processing
            uint256 satoshis = amount / SATOSHI_MULTIPLIER;
            
            // Execute automated minting directly
            _executeAutoMint(user, satoshis);
            
            // Emit event for automated completion
            emit QCMintCompleted(user, satoshis, true);
        } else {
            // Option 2: Manual process - just create Bank balance
            AccountControl(accountControl).mintTBTC(user, amount);
            
            // Convert to satoshis for event emission
            uint256 satoshis = amount / SATOSHI_MULTIPLIER;
            
            // Emit event for manual completion (user needs to mint separately)
            emit QCMintCompleted(user, satoshis, false);
        }

        // Emit event for QC attribution (same as original)
        emit QCBankBalanceCreated(qc, user, satoshis, mintId);

        // Update QC minted amount (same as original)
        _updateQCMintedAmount(qc, amount);

        // Mark mint as completed (same as original)
        mintRequests[mintId].completed = true;

        // Emit completion events (same as original)
        emit QCBackedDepositCredited(user, satoshis, qc, mintId, autoMint);
        emit MintCompleted(
            mintId,
            qc,
            user,
            amount,
            msg.sender,
            block.timestamp
        );
        emit QCMintRequested(
            qc,
            user,
            amount,
            mintId,
            msg.sender,
            block.timestamp
        );

        return mintId;
    }

    /// @notice Get available minting capacity for a QC
    /// @param qc The address of the Qualified Custodian
    /// @return availableCapacity The amount available for minting
    function getAvailableMintingCapacity(address qc)
        public
        view
        returns (uint256 availableCapacity)
    {
        return qcManager.getAvailableMintingCapacity(qc);
    }

    /// @notice Check if a QC is eligible for minting
    /// @param qc The address of the Qualified Custodian
    /// @param amount The amount to mint
    /// @return eligible True if the QC can mint the requested amount
    function checkMintingEligibility(address qc, uint256 amount)
        external
        view
        returns (bool eligible)
    {
        // Check system state
        if (systemState.isMintingPaused()) {
            return false;
        }

        if (
            amount < systemState.minMintAmount() ||
            amount > systemState.maxMintAmount()
        ) {
            return false;
        }

        // Check QC status
        if (qcData.getQCStatus(qc) != QCData.QCStatus.Active) {
            return false;
        }

        // Check capacity
        uint256 availableCapacity = getAvailableMintingCapacity(qc);
        return amount <= availableCapacity;
    }

    /// @notice Manually mint tBTC for user using their Bank balance
    /// @dev User must have pre-approved this contract to spend their Bank balance
    /// @param user The user to mint tBTC for
    function manualMint(address user) external nonReentrant {
        if (user == address(0)) revert InvalidUserAddress();
        
        uint256 satoshis = bank.balanceOf(user);
        if (satoshis == 0) revert ZeroAmount();

        // User must have pre-approved this contract (or transaction will revert)
        bank.transferBalanceFrom(user, address(this), satoshis);

        uint256 tbtcAmount = satoshis * SATOSHI_MULTIPLIER;
        tbtcVault.mint(tbtcAmount);
        tbtc.transfer(user, tbtcAmount);

        emit ManualMintCompleted(user, satoshis, tbtcAmount);
    }

    /// @notice Get the expected tBTC amount for given satoshi amount
    /// @param satoshis Amount in satoshis
    /// @return tbtcAmount Equivalent tBTC amount in wei
    function getSatoshiToTBTCAmount(uint256 satoshis) external pure returns (uint256 tbtcAmount) {
        return satoshis * SATOSHI_MULTIPLIER;
    }

    /// @notice Check if user has sufficient Bank balance and allowance
    /// @param user The user to check
    /// @return hasBalance True if user has Bank balance > 0
    /// @return hasAllowance True if user has approved this contract for their balance
    /// @return balance User's current Bank balance
    /// @return allowance User's current allowance to this contract
    function checkMintEligibility(address user) 
        external 
        view 
        returns (
            bool hasBalance,
            bool hasAllowance,
            uint256 balance,
            uint256 allowance
        ) 
    {
        balance = bank.balanceOf(user);
        allowance = bank.allowance(user, address(this));
        
        hasBalance = balance > 0;
        hasAllowance = allowance >= balance;
    }

    /// @dev Execute automated minting for user
    /// @param user The user receiving tBTC tokens
    /// @param satoshis Amount of satoshis to convert to tBTC
    function _executeAutoMint(address user, uint256 satoshis) internal {
        if (user == address(0)) revert InvalidUserAddress();
        if (satoshis == 0) revert ZeroAmount();
        if (bank.balanceOf(user) < satoshis) revert InsufficientBalance();

        // Check user has approved this contract to spend their balance
        if (bank.allowance(user, address(this)) < satoshis) {
            revert InsufficientBalance(); // Reusing error for insufficient allowance
        }

        // Transfer Bank balance from user to this contract
        bank.transferBalanceFrom(user, address(this), satoshis);

        // Mint tBTC (mints to this contract)
        uint256 tbtcAmount = satoshis * SATOSHI_MULTIPLIER;
        tbtcVault.mint(tbtcAmount);

        // Transfer tBTC tokens to user
        tbtc.transfer(user, tbtcAmount);

        emit AutoMintCompleted(user, satoshis, tbtcAmount);
    }

    /// @dev Generate unique mint ID
    /// @param qc The QC address
    /// @param user The user address
    /// @param amount The mint amount
    /// @return mintId The generated unique ID
    function _generateMintId(
        address qc,
        address user,
        uint256 amount
    ) private returns (bytes32 mintId) {
        mintCounter++;
        return
            keccak256(
                abi.encodePacked(qc, user, amount, mintCounter, block.timestamp)
            );
    }

    /// @dev Helper to update QC minted amount to avoid stack too deep errors
    function _updateQCMintedAmount(address qc, uint256 amount) private {
        uint256 currentMinted = qcData.getQCMintedAmount(qc);
        qcManager.updateQCMintedAmount(qc, currentMinted + amount);
    }
}
