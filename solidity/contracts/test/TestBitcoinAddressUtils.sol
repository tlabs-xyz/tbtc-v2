// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../account-control/BitcoinAddressUtils.sol";

/// @title Test wrapper for BitcoinAddressUtils library
/// @notice Exposes library functions for testing
contract TestBitcoinAddressUtils {
    /// @notice Decode a Bitcoin address for testing
    /// @param btcAddress The Bitcoin address to decode
    /// @return scriptType The script type (0=P2PKH, 1=P2SH, 2=P2WPKH, 3=P2WSH)
    /// @return scriptHash The decoded hash
    function decodeAddress(string memory btcAddress) 
        external 
        pure 
        returns (uint8 scriptType, bytes memory scriptHash) 
    {
        return BitcoinAddressUtils.decodeAddress(btcAddress);
    }
}