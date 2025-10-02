// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title Minimal Mock SortitionPool for testing
contract MockSortitionPool {
    bool public isChaosnetActive = true;
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function deactivateChaosnet() external {
        isChaosnetActive = false;
    }

    // Additional methods that might be needed by tests
    function selectGroup(uint256, bytes32) external pure returns (uint32[] memory) {
        uint32[] memory members = new uint32[](1);
        members[0] = 1;
        return members;
    }

    // Method expected by registerOperator
    function getOperatorID(address) external pure returns (uint32) {
        // Return a simple mock ID
        return 1;
    }

    // Method expected by tests
    function getIDOperators(uint32[] calldata ids) external pure returns (address[] memory) {
        address[] memory operators = new address[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            operators[i] = address(uint160(ids[i]));
        }
        return operators;
    }
}