// SPDX-License-Identifier: GPL-3.0-only

pragma solidity 0.8.17;

import "../bridge/EcdsaLib.sol";

/// @dev This is a stub contract to expose EcdsaLib library functions for testing.
contract EcdsaLibStub {
    function compressPublicKey(bytes32 x, bytes32 y)
        public
        pure
        returns (bytes memory)
    {
        return EcdsaLib.compressPublicKey(x, y);
    }
}
