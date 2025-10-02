// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../account-control/BitcoinAddressUtils.sol";

/// @title Test wrapper for BitcoinAddressUtils internal functions
/// @notice Exposes internal library functions for comprehensive testing
/// @dev This contract is only for testing purposes and should not be used in production
contract TestBitcoinAddressUtilsInternals {
    using BitcoinAddressUtils for *;

    /// @notice Test base58 decoding functionality
    /// @param source The Base58 encoded data
    /// @return decoded The decoded bytes
    function testBase58Decode(bytes memory source)
        external
        pure
        returns (bytes memory decoded)
    {
        return BitcoinAddressUtils.base58Decode(source);
    }

    /// @notice Test base58 character to value conversion
    /// @param char The character to convert
    /// @return value The numeric value (0-57)
    function testBase58CharToValue(bytes1 char)
        external
        pure
        returns (uint256 value)
    {
        return BitcoinAddressUtils.base58CharToValue(char);
    }

    /// @notice Test bech32 character to value conversion
    /// @param char The character to convert
    /// @return value The numeric value (0-31)
    function testBech32CharToValue(bytes1 char)
        external
        pure
        returns (uint256 value)
    {
        return BitcoinAddressUtils.bech32CharToValue(char);
    }

    /// @notice Test bech32 polymod step function
    /// @param pre Previous value
    /// @return Next value
    function testBech32PolymodStep(uint256 pre)
        external
        pure
        returns (uint256)
    {
        return BitcoinAddressUtils.bech32PolymodStep(pre);
    }

    /// @notice Test bech32 address detection
    /// @param addr The address bytes to check
    /// @return True if valid Bech32 format
    function testIsBech32Address(bytes memory addr)
        external
        pure
        returns (bool)
    {
        return BitcoinAddressUtils.isBech32Address(addr);
    }

    /// @notice Test mixed case detection in addresses
    /// @param addr The address bytes to check
    /// @return True if mixed case is detected
    function testHasMixedCaseInAddress(bytes memory addr)
        external
        pure
        returns (bool)
    {
        return BitcoinAddressUtils.hasMixedCaseInAddress(addr);
    }

    /// @notice Test bech32 prefix validation
    /// @param addr The address bytes to check
    /// @return True if valid Bech32 prefix
    function testIsBech32Prefix(bytes memory addr)
        external
        pure
        returns (bool)
    {
        return BitcoinAddressUtils.isBech32Prefix(addr);
    }

    /// @notice Test bit conversion functionality
    /// @param data Input data
    /// @param start Start index
    /// @param end End index
    /// @param fromBits Source bit size
    /// @param toBits Target bit size
    /// @param pad Whether to pad incomplete groups
    /// @return output Converted data
    function testConvertBits(
        uint256[] memory data,
        uint256 start,
        uint256 end,
        uint256 fromBits,
        uint256 toBits,
        bool pad
    ) external pure returns (bytes memory output) {
        return BitcoinAddressUtils.convertBits(data, start, end, fromBits, toBits, pad);
    }

    /// @notice Test bech32 checksum verification
    /// @param addr The full address
    /// @param sepIndex The separator index
    /// @param values The decoded values
    /// @return valid True if checksum is valid
    function testVerifyBech32Checksum(
        bytes memory addr,
        uint256 sepIndex,
        uint256[] memory values
    ) external pure returns (bool valid) {
        return BitcoinAddressUtils.verifyBech32Checksum(addr, sepIndex, values);
    }

    /// @notice Test bech32 checksum calculation for derivation
    /// @param hrp Human readable part
    /// @param data The data part in 5-bit groups
    /// @param dataLen Length of data array to process
    /// @return checksum The 30-bit checksum
    function testBech32ChecksumForDerivation(
        string memory hrp,
        uint256[] memory data,
        uint256 dataLen
    ) external pure returns (uint256 checksum) {
        return BitcoinAddressUtils.bech32ChecksumForDerivation(hrp, data, dataLen);
    }

    /// @notice Test base58 address decoding specifically
    /// @param addr The address bytes
    /// @return scriptType The type of script
    /// @return scriptHash The hash
    function testDecodeBase58Address(bytes memory addr)
        external
        pure
        returns (uint8 scriptType, bytes memory scriptHash)
    {
        return BitcoinAddressUtils.decodeBase58Address(addr);
    }

    /// @notice Test bech32 address decoding specifically
    /// @param addr The address bytes
    /// @return scriptType The type of script
    /// @return scriptHash The hash
    function testDecodeBech32Address(bytes memory addr)
        external
        pure
        returns (uint8 scriptType, bytes memory scriptHash)
    {
        return BitcoinAddressUtils.decodeBech32Address(addr);
    }
}