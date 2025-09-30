// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title Mock TokenStaking for testing
/// @notice Minimal implementation to satisfy external dependency resolution
contract MockTokenStaking {
    mapping(address => uint256) public stakes;
    mapping(address => address) public stakingProviderToOperator;
    
    function stakingProviderFromOperator(address operator) external view returns (address) {
        // Simple mock - return the operator as the staking provider
        return operator;
    }
    
    function stakedNu(address) external pure returns (uint256) {
        return 0;
    }
}