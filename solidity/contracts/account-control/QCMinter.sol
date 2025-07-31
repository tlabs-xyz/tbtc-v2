// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IMintingPolicy.sol";
import "./ProtocolRegistry.sol";

/// @title QCMinter
/// @notice Stable entry point for tBTC minting with Policy delegation
/// @dev Acts as a focused contract that delegates core validation and minting
///      logic to a pluggable "Minting Policy" contract, allowing minting rules
///      to be upgraded without changing the core minter contract.
///      Supports both direct and registry-based policy integration.
///
/// Role definitions:
/// - DEFAULT_ADMIN_ROLE: Can grant/revoke roles
/// - MINTER_ROLE: Can request QC mints
contract QCMinter is AccessControl {
    error InvalidQCAddress();
    error InvalidAmount();
    error PolicyNotSet();

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant MINTING_POLICY_KEY = keccak256("MINTING_POLICY");

    // =================== INTEGRATION STRATEGY ===================
    
    IMintingPolicy public mintingPolicy;
    ProtocolRegistry public immutable protocolRegistry;
    bool public useDirectIntegration;

    // =================== STANDARDIZED EVENTS ===================

    /// @dev Emitted when a QC minting request is initiated
    event QCMintRequested(
        address indexed qc,
        address indexed user,
        uint256 indexed amount,
        bytes32 mintId,
        address requestedBy,
        uint256 timestamp
    );

    /// @dev Emitted when minting policy is updated
    event MintingPolicyUpdated(
        address indexed oldPolicy,
        address indexed newPolicy,
        bool useDirectIntegration
    );

    constructor(
        address _protocolRegistry,
        address _directMintingPolicy
    ) {
        require(_protocolRegistry != address(0), "Invalid registry");
        
        protocolRegistry = ProtocolRegistry(_protocolRegistry);
        
        // Setup direct integration if policy provided
        if (_directMintingPolicy != address(0)) {
            mintingPolicy = IMintingPolicy(_directMintingPolicy);
            useDirectIntegration = true;
        } else {
            useDirectIntegration = false;
        }

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    /// @notice Request QC minting with optimized policy lookup
    /// @param qc The address of the Qualified Custodian
    /// @param amount The amount of tBTC to mint
    /// @return mintId Unique identifier for this minting request
    function requestQCMint(address qc, uint256 amount)
        external
        onlyRole(MINTER_ROLE)
        returns (bytes32 mintId)
    {
        if (qc == address(0)) revert InvalidQCAddress();
        if (amount == 0) revert InvalidAmount();

        // Optimized policy lookup - direct integration saves ~5,000 gas
        IMintingPolicy policy = _getMintingPolicy();

        // Delegate to policy contract
        mintId = policy.requestMint(qc, msg.sender, amount);

        emit QCMintRequested(
            qc,
            msg.sender,
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
        external
        view
        returns (uint256 availableCapacity)
    {
        if (qc == address(0)) return 0;

        // Optimized policy lookup
        IMintingPolicy policy = _getMintingPolicy();
        return policy.getAvailableMintingCapacity(qc);
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
        IMintingPolicy policy = _getMintingPolicy();
        return policy.checkMintingEligibility(qc, amount);
    }

    // =================== POLICY MANAGEMENT ===================

    /// @notice Update minting policy with option for direct integration
    /// @param newPolicy Address of new minting policy
    /// @param useDirect Whether to use direct integration (true) or registry (false)
    function updateMintingPolicy(address newPolicy, bool useDirect)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(newPolicy != address(0), "Invalid policy address");

        address oldPolicy = address(mintingPolicy);
        
        if (useDirect) {
            // Direct integration - gas efficient
            mintingPolicy = IMintingPolicy(newPolicy);
            useDirectIntegration = true;
        } else {
            // Registry integration - more flexible but higher gas
            mintingPolicy = IMintingPolicy(address(0));
            useDirectIntegration = false;
        }

        emit MintingPolicyUpdated(oldPolicy, newPolicy, useDirect);
    }

    /// @notice Switch between direct and registry integration modes
    /// @param useDirect True for direct integration, false for registry
    function switchIntegrationMode(bool useDirect)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (useDirect == useDirectIntegration) return;

        if (useDirect) {
            // Switch to direct - need to set policy from registry
            address policyAddress = protocolRegistry.getService(MINTING_POLICY_KEY);
            require(policyAddress != address(0), "No policy in registry");
            
            mintingPolicy = IMintingPolicy(policyAddress);
            useDirectIntegration = true;
        } else {
            // Switch to registry - clear direct policy
            address oldPolicy = address(mintingPolicy);
            mintingPolicy = IMintingPolicy(address(0));
            useDirectIntegration = false;
            
            emit MintingPolicyUpdated(oldPolicy, address(0), false);
        }
    }

    // =================== VIEW FUNCTIONS ===================

    /// @notice Get current minting policy address
    /// @return policyAddress Current policy address
    /// @return isDirect Whether using direct integration
    function getCurrentMintingPolicy()
        external
        view
        returns (address policyAddress, bool isDirect)
    {
        if (useDirectIntegration) {
            return (address(mintingPolicy), true);
        } else {
            return (protocolRegistry.getService(MINTING_POLICY_KEY), false);
        }
    }

    // =================== INTERNAL FUNCTIONS ===================

    /// @dev Get minting policy using current integration mode
    function _getMintingPolicy() internal view returns (IMintingPolicy) {
        if (useDirectIntegration) {
            if (address(mintingPolicy) == address(0)) revert PolicyNotSet();
            return mintingPolicy;
        } else {
            // Registry lookup
            address policyAddress = protocolRegistry.getService(MINTING_POLICY_KEY);
            if (policyAddress == address(0)) revert PolicyNotSet();
            return IMintingPolicy(policyAddress);
        }
    }
}
