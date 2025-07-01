// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IMintingPolicy.sol";
import "./ProtocolRegistry.sol";
import "./QCManager.sol";
import "./QCData.sol";
import "./SystemState.sol";
import "../token/TBTC.sol";

/// @title BasicMintingPolicy
/// @dev Basic implementation of IMintingPolicy interface.
/// This policy validates QC status, reserve freshness, and capacity
/// before calling tBTC.mint() directly after validation.
/// Demonstrates the Policy contract pattern for upgradeable business logic.
contract BasicMintingPolicy is IMintingPolicy, AccessControl {
    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("POLICY_ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant MINTING_POLICY_KEY = keccak256("MINTING_POLICY");

    // Service keys for ProtocolRegistry
    bytes32 public constant QC_MANAGER_KEY = keccak256("QC_MANAGER");
    bytes32 public constant QC_DATA_KEY = keccak256("QC_DATA");
    bytes32 public constant SYSTEM_STATE_KEY = keccak256("SYSTEM_STATE");
    bytes32 public constant QC_RESERVE_LEDGER_KEY =
        keccak256("QC_RESERVE_LEDGER");
    bytes32 public constant TBTC_TOKEN_KEY = keccak256("TBTC_TOKEN");

    ProtocolRegistry public immutable protocolRegistry;

    /// @dev Mapping to track mint requests
    mapping(bytes32 => bool) public completedMints;

    /// @dev Counter for generating unique mint IDs
    uint256 private mintCounter;

    // =================== STANDARDIZED EVENTS ===================

    /// @dev Emitted when a mint is completed
    event MintCompleted(
        bytes32 indexed mintId,
        address indexed qc,
        address indexed user,
        uint256 amount,
        address completedBy,
        uint256 timestamp
    );

    /// @dev Emitted when a mint is rejected
    event MintRejected(
        address indexed qc,
        address indexed user,
        uint256 indexed amount,
        string reason,
        address rejectedBy,
        uint256 timestamp
    );

    constructor(address _protocolRegistry) {
        protocolRegistry = ProtocolRegistry(_protocolRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(POLICY_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    /// @notice Request minting of tBTC tokens for a QC
    /// @param qc The address of the Qualified Custodian
    /// @param user The address requesting the mint
    /// @param amount The amount of tBTC to mint
    /// @return mintId Unique identifier for this minting request
    function requestMint(
        address qc,
        address user,
        uint256 amount
    ) external override onlyRole(MINTER_ROLE) returns (bytes32 mintId) {
        // Validate inputs
        require(qc != address(0), "Invalid QC address");
        require(user != address(0), "Invalid user address");
        require(amount > 0, "Amount must be greater than zero");

        // Check system state
        SystemState systemState = SystemState(
            protocolRegistry.getService(SYSTEM_STATE_KEY)
        );
        require(!systemState.isMintingPaused(), "Minting is paused");
        require(
            amount >= systemState.minMintAmount() &&
                amount <= systemState.maxMintAmount(),
            "Amount outside allowed range"
        );

        // Check QC status
        QCData qcData = QCData(protocolRegistry.getService(QC_DATA_KEY));
        require(
            qcData.getQCStatus(qc) == QCData.QCStatus.Active,
            "QC not active"
        );

        // Check minting capacity
        uint256 availableCapacity = getAvailableMintingCapacity(qc);
        require(amount <= availableCapacity, "Insufficient minting capacity");

        // Generate unique mint ID
        mintId = _generateMintId(qc, user, amount);

        // Perform the mint
        // TODO: Is this correct way to mint? Or should some other tbtc-v2 contract do it?
        TBTC tbtcToken = TBTC(protocolRegistry.getService(TBTC_TOKEN_KEY));
        tbtcToken.mint(user, amount);

        // Update QC minted amount
        QCManager qcManager = QCManager(
            protocolRegistry.getService(QC_MANAGER_KEY)
        );
        uint256 currentMinted = qcData.getQCMintedAmount(qc);
        qcManager.updateQCMintedAmount(qc, currentMinted + amount);

        // Mark mint as completed
        completedMints[mintId] = true;

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

    /// @notice Check if a mint request was completed
    /// @param mintId The mint request identifier
    /// @return completed True if the mint was completed
    function isMintCompleted(bytes32 mintId)
        external
        view
        returns (bool completed)
    {
        return completedMints[mintId];
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
}
