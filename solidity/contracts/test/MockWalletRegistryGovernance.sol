// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title Mock WalletRegistryGovernance for testing
contract MockWalletRegistryGovernance {
    uint256 public dkgResultChallengePeriodLength = 7200; // Default 2 hours
    uint256 public governanceDelay = 604800; // Default 7 days in seconds
    
    // Method expected by tests
    function beginDkgResultChallengePeriodLengthUpdate(uint256 newLength) external {
        // Mock implementation - just store the value
        dkgResultChallengePeriodLength = newLength;
    }
    
    // Method that might be needed by tests
    function finalizeDkgResultChallengePeriodLengthUpdate() external {
        // no-op for tests
    }
}