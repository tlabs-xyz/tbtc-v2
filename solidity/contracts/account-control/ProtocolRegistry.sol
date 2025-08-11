// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IProtocolRegistry.sol";

/// @title ProtocolRegistry
/// @notice Central registry enabling modular architecture and seamless upgrades
/// @dev Service locator pattern for Account Control system components
contract ProtocolRegistry is AccessControl, IProtocolRegistry {
    bytes32 public constant SERVICE_ADMIN_ROLE = keccak256("SERVICE_ADMIN_ROLE");

    // Custom errors for gas-efficient reverts
    error InvalidServiceAddress();
    error ServiceNotRegistered(string serviceName);
    error ServiceAlreadyRegistered(string serviceName);

    /// @dev Maps service name hashes to their contract addresses
    mapping(bytes32 => address) private services;
    
    /// @dev Maps service name hashes to critical service flags
    mapping(bytes32 => bool) private criticalServices;

    // =================== EVENTS ===================

    /// @dev Emitted when a new service is registered
    event ServiceRegistered(
        string indexed serviceName,
        bytes32 indexed serviceId,
        address indexed serviceAddress,
        address registeredBy,
        uint256 timestamp
    );

    /// @dev Emitted when an existing service is updated
    event ServiceUpdated(
        string indexed serviceName,
        bytes32 indexed serviceId,
        address indexed oldAddress,
        address newAddress,
        address updatedBy,
        uint256 timestamp
    );

    /// @dev Emitted when service critical status changes
    event ServiceCriticalStatusChanged(
        string indexed serviceName,
        bytes32 indexed serviceId,
        bool indexed isCritical,
        address changedBy,
        uint256 timestamp
    );

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SERVICE_ADMIN_ROLE, msg.sender);
    }

    /// @notice Register or update a service
    /// @param serviceName Human-readable service name  
    /// @param serviceAddress Contract address for the service
    function setService(string memory serviceName, address serviceAddress)
        external
        onlyRole(SERVICE_ADMIN_ROLE)
    {
        if (serviceAddress == address(0)) {
            revert InvalidServiceAddress();
        }

        bytes32 serviceId = keccak256(bytes(serviceName));
        address oldAddress = services[serviceId];
        services[serviceId] = serviceAddress;

        if (oldAddress == address(0)) {
            emit ServiceRegistered(
                serviceName,
                serviceId,
                serviceAddress,
                msg.sender,
                block.timestamp
            );
        } else {
            emit ServiceUpdated(
                serviceName,
                serviceId,
                oldAddress,
                serviceAddress,
                msg.sender,
                block.timestamp
            );
        }
    }

    /// @notice Get service address by name with validation
    /// @param serviceName Service name to look up
    /// @return serviceAddress Contract address for the service
    function getService(string memory serviceName)
        external
        view
        returns (address serviceAddress)
    {
        bytes32 serviceId = keccak256(bytes(serviceName));
        serviceAddress = services[serviceId];
        
        if (serviceAddress == address(0)) {
            revert ServiceNotRegistered(serviceName);
        }
        
        return serviceAddress;
    }

    /// @notice Check if a service is registered
    /// @param serviceName Service name to check
    /// @return registered True if service exists
    function hasService(string memory serviceName)
        external
        view
        returns (bool registered)
    {
        bytes32 serviceId = keccak256(bytes(serviceName));
        return services[serviceId] != address(0);
    }

    /// @notice Mark service as critical (requires additional validation)
    /// @param serviceName Service to mark as critical
    /// @param isCritical Whether service is critical
    function setCriticalService(string memory serviceName, bool isCritical)
        external
        onlyRole(SERVICE_ADMIN_ROLE)
    {
        bytes32 serviceId = keccak256(bytes(serviceName));
        
        if (services[serviceId] == address(0)) {
            revert ServiceNotRegistered(serviceName);
        }
        
        criticalServices[serviceId] = isCritical;
        
        emit ServiceCriticalStatusChanged(
            serviceName,
            serviceId,
            isCritical,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Check if service is marked as critical
    /// @param serviceName Service to check
    /// @return isCritical True if service is critical
    function isServiceCritical(string memory serviceName)
        external
        view
        returns (bool isCritical)
    {
        bytes32 serviceId = keccak256(bytes(serviceName));
        return criticalServices[serviceId];
    }

    /// @notice Get service address directly by service ID (gas-optimized)
    /// @param serviceId Keccak256 hash of service name
    /// @return serviceAddress Contract address for the service
    function getServiceById(bytes32 serviceId)
        external
        view
        returns (address serviceAddress)
    {
        return services[serviceId];
    }

    /// @notice Batch register multiple services
    /// @param serviceNames Array of service names
    /// @param serviceAddresses Array of service addresses
    function batchSetServices(
        string[] memory serviceNames,
        address[] memory serviceAddresses
    ) external onlyRole(SERVICE_ADMIN_ROLE) {
        require(
            serviceNames.length == serviceAddresses.length,
            "Array length mismatch"
        );

        for (uint256 i = 0; i < serviceNames.length; i++) {
            if (serviceAddresses[i] == address(0)) {
                revert InvalidServiceAddress();
            }

            bytes32 serviceId = keccak256(bytes(serviceNames[i]));
            address oldAddress = services[serviceId];
            services[serviceId] = serviceAddresses[i];

            if (oldAddress == address(0)) {
                emit ServiceRegistered(
                    serviceNames[i],
                    serviceId,
                    serviceAddresses[i],
                    msg.sender,
                    block.timestamp
                );
            } else {
                emit ServiceUpdated(
                    serviceNames[i],
                    serviceId,
                    oldAddress,
                    serviceAddresses[i],
                    msg.sender,
                    block.timestamp
                );
            }
        }
    }
}