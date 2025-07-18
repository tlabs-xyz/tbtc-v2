// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IMintingPolicy.sol";
import "./ProtocolRegistry.sol";
import "./QCManager.sol";
import "./QCData.sol";
import "./SystemState.sol";
import "../bank/Bank.sol";
import "../vault/TBTCVault.sol";
import "../token/TBTC.sol";

/// @title BasicMintingPolicy
/// @notice Direct integration implementation of IMintingPolicy
/// @dev This policy validates QC status, reserve freshness, and capacity
///      before directly creating Bank balances and auto-minting tBTC tokens.
///      Implements direct Bank integration following the project's preference
///      for simple, direct patterns.
///
/// Role definitions:
/// - DEFAULT_ADMIN_ROLE: Can grant/revoke roles
/// - MINTER_ROLE: Can request minting of tBTC tokens (typically granted to QCMinter contract)
contract BasicMintingPolicy is IMintingPolicy, AccessControl {
    // Custom errors for gas-efficient reverts
    error InvalidQCAddress();
    error InvalidUserAddress();
    error InvalidAmount();
    error MintingPaused();
    error AmountOutsideAllowedRange();
    error QCNotActive();
    error InsufficientMintingCapacity();
    error NotAuthorizedInBank();

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // Service keys for ProtocolRegistry
    bytes32 public constant QC_MANAGER_KEY = keccak256("QC_MANAGER");
    bytes32 public constant QC_DATA_KEY = keccak256("QC_DATA");
    bytes32 public constant SYSTEM_STATE_KEY = keccak256("SYSTEM_STATE");
    bytes32 public constant QC_RESERVE_LEDGER_KEY = keccak256("QC_RESERVE_LEDGER");
    bytes32 public constant BANK_KEY = keccak256("BANK");
    bytes32 public constant TBTC_VAULT_KEY = keccak256("TBTC_VAULT");

    /// @notice Satoshi multiplier for converting tBTC to satoshis
    uint256 public constant SATOSHI_MULTIPLIER = 1e10;

    ProtocolRegistry public immutable protocolRegistry;

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

    constructor(address _protocolRegistry) {
        if (_protocolRegistry == address(0)) revert InvalidQCAddress();
        protocolRegistry = ProtocolRegistry(_protocolRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    /// @notice Request minting with direct Bank integration for seamless user experience
    /// @dev Validates QC capacity, directly creates Bank balance, and triggers TBTCVault minting
    /// @param qc The address of the Qualified Custodian
    /// @param user The address receiving the tBTC tokens
    /// @param amount The amount of tBTC to mint (in wei, 1e18 = 1 tBTC)
    /// @return mintId Unique identifier for this minting request
    function requestMint(
        address qc,
        address user,
        uint256 amount
    ) external override onlyRole(MINTER_ROLE) returns (bytes32 mintId) {
        // Validate inputs
        if (qc == address(0)) revert InvalidQCAddress();
        if (user == address(0)) revert InvalidUserAddress();
        if (amount == 0) revert InvalidAmount();

        // Check system state
        SystemState systemState = SystemState(
            protocolRegistry.getService(SYSTEM_STATE_KEY)
        );
        if (systemState.isMintingPaused()) {
            emit MintRejected(qc, user, amount, "Minting paused", msg.sender, block.timestamp);
            revert MintingPaused();
        }
        if (amount < systemState.minMintAmount() || amount > systemState.maxMintAmount()) {
            emit MintRejected(qc, user, amount, "Amount outside allowed range", msg.sender, block.timestamp);
            revert AmountOutsideAllowedRange();
        }

        // Check QC status
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        if (qcData.getQCStatus(qc) != QCData.QCStatus.Active) {
            emit MintRejected(qc, user, amount, "QC not active", msg.sender, block.timestamp);
            revert QCNotActive();
        }

        // Check minting capacity
        uint256 availableCapacity = getAvailableMintingCapacity(qc);
        if (amount > availableCapacity) {
            emit MintRejected(qc, user, amount, "Insufficient capacity", msg.sender, block.timestamp);
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

        // Get Bank and Vault references
        Bank bank = Bank(protocolRegistry.getService(BANK_KEY));
        TBTCVault tbtcVault = TBTCVault(protocolRegistry.getService(TBTC_VAULT_KEY));

        // Verify this contract is authorized in Bank
        if (!bank.authorizedBalanceIncreasers(address(this))) {
            revert NotAuthorizedInBank();
        }

        // Convert tBTC amount to satoshis for Bank balance
        // 1 tBTC = 1e18 wei, 1 BTC = 1e8 satoshis
        uint256 satoshis = amount / SATOSHI_MULTIPLIER;

        // Direct Bank interaction with auto-minting
        address[] memory depositors = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        depositors[0] = user;
        amounts[0] = satoshis;
        
        // This will create Bank balance and automatically trigger TBTCVault minting
        bank.increaseBalanceAndCall(address(tbtcVault), depositors, amounts);

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

        return mintId;
    }

    /// @notice Get available minting capacity for a QC
    /// @param qc The address of the Qualified Custodian
    /// @return availableCapacity The amount available for minting
    function getAvailableMintingCapacity(address qc)
        public
        view
        override
        returns (uint256 availableCapacity)
    {
        QCManager qcManager = QCManager(
            protocolRegistry.getService(QC_MANAGER_KEY)
        );
        return qcManager.getAvailableMintingCapacity(qc);
    }

    /// @notice Check if a QC is eligible for minting
    /// @param qc The address of the Qualified Custodian
    /// @param amount The amount to mint
    /// @return eligible True if the QC can mint the requested amount
    function checkMintingEligibility(address qc, uint256 amount)
        external
        view
        override
        returns (bool eligible)
    {
        // Check system state
        SystemState systemState = SystemState(
            protocolRegistry.getService(SYSTEM_STATE_KEY)
        );
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
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        if (qcData.getQCStatus(qc) != QCData.QCStatus.Active) {
            return false;
        }

        // Check capacity
        uint256 availableCapacity = getAvailableMintingCapacity(qc);
        return amount <= availableCapacity;
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
        QCManager qcManager = QCManager(
            protocolRegistry.getService(QC_MANAGER_KEY)
        );
        QCData qcDataContract = QCData(protocolRegistry.getService(QC_DATA_KEY));
        uint256 currentMinted = qcDataContract.getQCMintedAmount(qc);
        qcManager.updateQCMintedAmount(qc, currentMinted + amount);
    }
}