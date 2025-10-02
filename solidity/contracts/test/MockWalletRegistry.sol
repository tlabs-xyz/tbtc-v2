// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title Minimal Mock WalletRegistry for testing
contract MockWalletRegistry {
    // Minimal implementation - just needs to exist
    address public constant ecdsaWalletRegistry = address(0x1);
    address public walletOwner;
    address public randomBeacon;
    address public sortitionPool;
    address public governance;

    constructor() {
        walletOwner = msg.sender;
        // Set default test addresses
        randomBeacon = address(0x2);
        sortitionPool = address(0x3);
        governance = address(0x4);
    }

    function requestNewWallet() external pure returns (bytes32) {
        return bytes32(uint256(1));
    }

    function closeWallet(bytes32) external pure {
        // no-op
    }

    function seize(uint256, uint256, address) external pure {
        // no-op
    }

    // Allow setting randomBeacon for tests
    function setRandomBeacon(address _randomBeacon) external {
        randomBeacon = _randomBeacon;
    }

    // Allow setting sortitionPool for tests
    function setSortitionPool(address _sortitionPool) external {
        sortitionPool = _sortitionPool;
    }

    // Method expected by tests
    function __beaconCallback(uint256, uint256) external pure {
        // no-op for tests
    }

    // Methods for operator registration
    function registerOperator(address) external pure {
        // no-op for tests
    }

    function joinSortitionPool() external pure {
        // no-op for tests
    }

    // Method expected by tests
    function selectGroup() external pure returns (uint256[] memory) {
        uint256[] memory identifiers = new uint256[](1);
        identifiers[0] = 1;
        return identifiers;
    }

    // Allow setting governance for tests
    function setGovernance(address _governance) external {
        governance = _governance;
    }

    // Methods expected by the Bridge/Wallets contract
    function getWalletCreationState() external pure returns (uint256) {
        // Return 0 for State.IDLE
        return 0;
    }

    // Method expected by integration tests
    function operatorToStakingProvider(address operator) external pure returns (address) {
        // Return the operator as staking provider for simplicity in tests
        return operator;
    }
}