// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title IProtocolRegistry
/// @notice Interface for ProtocolRegistry contract
interface IProtocolRegistry {
    function getService(string memory serviceName) external view returns (address);
    function setService(string memory serviceName, address serviceAddress) external;
    function hasService(string memory serviceName) external view returns (bool);
}