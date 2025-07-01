// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IMintingPolicy.sol";
import "./ProtocolRegistry.sol";

/// @title QCMinter
/// @dev Stable entry point for tBTC minting with Policy delegation.
/// Acts as a focused contract that delegates core validation and minting
/// logic to a pluggable "Minting Policy" contract, allowing minting rules
/// to be upgraded without changing the core minter contract.
contract QCMinter is AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant MINTING_POLICY_KEY = keccak256("MINTING_POLICY");
    
    ProtocolRegistry public immutable protocolRegistry;
    
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
    
    /// @dev Emitted when the minting policy is updated
    event MintingPolicyUpdated(
        address indexed oldPolicy,
        address indexed newPolicy,
        address indexed updatedBy,
        uint256 timestamp
    );
    
    constructor(address _protocolRegistry) {
        protocolRegistry = ProtocolRegistry(_protocolRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }
    
    /// @notice Request QC minting (delegates to active policy)
    /// @param qc The address of the Qualified Custodian
    /// @param amount The amount of tBTC to mint
    /// @return mintId Unique identifier for this minting request
    function requestQCMint(
        address qc,
        uint256 amount
    ) external returns (bytes32 mintId) {
        require(qc != address(0), "Invalid QC address");
        require(amount > 0, "Amount must be greater than zero");
        
        // Get active minting policy from registry
        IMintingPolicy policy = IMintingPolicy(
            protocolRegistry.getService(MINTING_POLICY_KEY)
        );
        
        // Delegate to policy contract
        mintId = policy.requestMint(qc, msg.sender, amount);
        
        emit QCMintRequested(qc, msg.sender, amount, mintId, msg.sender, block.timestamp);
        
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
        // Cache policy service to avoid redundant SLOAD operations
        IMintingPolicy policy = IMintingPolicy(
            protocolRegistry.getService(MINTING_POLICY_KEY)
        );
        
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
        IMintingPolicy policy = IMintingPolicy(
            protocolRegistry.getService(MINTING_POLICY_KEY)
        );
        
        return policy.checkMintingEligibility(qc, amount);
    }
    
    /// @notice Update minting policy (DAO only)
    /// @dev This is called automatically when ProtocolRegistry is updated
    function updateMintingPolicy() external {
        address oldPolicy = address(0);
        try protocolRegistry.getService(MINTING_POLICY_KEY) returns (address current) {
            oldPolicy = current;
        } catch {
            // Policy not yet registered
        }
        
        address newPolicy = protocolRegistry.getService(MINTING_POLICY_KEY);
        
        emit MintingPolicyUpdated(oldPolicy, newPolicy, msg.sender, block.timestamp);
    }
}