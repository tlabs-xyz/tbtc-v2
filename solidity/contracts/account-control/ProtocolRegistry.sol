// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ProtocolRegistry
/// @dev Central dynamic address book enabling modular system upgrades.
/// Acts as the cornerstone of the architecture's modularity by decoupling
/// all system contracts and enabling upgrades to individual components
/// without requiring full-system redeployment.
contract ProtocolRegistry is AccessControl {
    bytes32 public constant PARAMETER_ADMIN_ROLE = keccak256("PARAMETER_ADMIN_ROLE");
    
    /// @dev Maps service identifiers to contract addresses
    mapping(bytes32 => address) public services;
    
    /// @dev Emitted when a service address is updated
    event ServiceUpdated(
        bytes32 indexed serviceId,
        address indexed oldAddress,
        address indexed newAddress,
        address updatedBy,
        uint256 timestamp
    );
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PARAMETER_ADMIN_ROLE, msg.sender);
    }
    
    /// @notice Update service address (DAO only)
    /// @param serviceId The identifier of the service to update
    /// @param serviceAddress The new address for the service
    function setService(bytes32 serviceId, address serviceAddress) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(serviceAddress != address(0), "Invalid service address");
        
        address oldAddress = services[serviceId];
        services[serviceId] = serviceAddress;
        
        emit ServiceUpdated(serviceId, oldAddress, serviceAddress, msg.sender, block.timestamp);
    }
    
    /// @notice Get service address
    /// @param serviceId The identifier of the service to retrieve
    /// @return The address of the requested service
    function getService(bytes32 serviceId) 
        external 
        view 
        returns (address) 
    {
        address serviceAddress = services[serviceId];
        require(serviceAddress != address(0), "Service not registered");
        return serviceAddress;
    }
    
    /// @notice Check if service is registered
    /// @param serviceId The identifier of the service to check
    /// @return True if the service is registered, false otherwise
    function hasService(bytes32 serviceId) 
        external 
        view 
        returns (bool) 
    {
        return services[serviceId] != address(0);
    }
}