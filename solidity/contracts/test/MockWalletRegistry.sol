// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title Minimal Mock WalletRegistry for testing
contract MockWalletRegistry {
    // Minimal implementation - just needs to exist
    address public constant ecdsaWalletRegistry = address(0x1);

    function requestNewWallet() external pure returns (bytes32) {
        return bytes32(uint256(1));
    }

    function closeWallet(bytes32) external pure {
        // no-op
    }

    function seize(uint256, uint256, address) external pure {
        // no-op
    }
}