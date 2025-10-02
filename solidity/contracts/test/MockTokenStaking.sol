// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title Mock TokenStaking for testing
/// @notice Minimal implementation to satisfy external dependency resolution
contract MockTokenStaking {
    mapping(address => uint256) public stakes;
    mapping(address => address) public stakingProviderToOperator;
    mapping(address => mapping(address => uint256)) public authorizations;
    
    function stakingProviderFromOperator(address operator) external pure returns (address) {
        // Simple mock - return the operator as the staking provider
        return operator;
    }
    
    function stakedNu(address) external pure returns (uint256) {
        return 0;
    }

    // Method needed by integration tests
    function stake(
        address stakingProvider,
        address beneficiary,
        address authorizer,
        uint256 amount
    ) external {
        stakes[stakingProvider] = amount;
        // Mock implementation - just store the stake
    }

    // Method needed by integration tests
    function increaseAuthorization(
        address stakingProvider,
        address application,
        uint256 amount
    ) external {
        authorizations[stakingProvider][application] = amount;
        // Mock implementation - just store the authorization
    }
}