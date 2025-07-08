// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title Bitcoin Address Utilities
/// @notice Library for decoding Bitcoin addresses into their script representations
/// @dev Supports P2PKH, P2SH, P2WPKH, and P2WSH address formats
library BitcoinAddressUtils {
    // Custom errors
    error InvalidAddressLength();
    error InvalidAddressPrefix();
    error InvalidChecksum();
    error UnsupportedAddressType();
    
    // Bitcoin address version bytes
    uint8 private constant P2PKH_MAINNET_PREFIX = 0x00; // Addresses starting with '1'
    uint8 private constant P2SH_MAINNET_PREFIX = 0x05; // Addresses starting with '3'
    uint8 private constant P2PKH_TESTNET_PREFIX = 0x6F; // Addresses starting with 'm' or 'n'
    uint8 private constant P2SH_TESTNET_PREFIX = 0xC4; // Addresses starting with '2'
    
    // Base58 alphabet (Bitcoin uses this specific ordering)
    bytes private constant BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    
    // Bech32 constants
    bytes private constant BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    uint256 private constant BECH32_GENERATOR = 0x3b6a57b2;
    
    /// @notice Decode a Bitcoin address to its script representation
    /// @param btcAddress The Bitcoin address as a string
    /// @return scriptType The type of script (0=P2PKH, 1=P2SH, 2=P2WPKH, 3=P2WSH)
    /// @return scriptHash The hash component of the script (20 or 32 bytes)
    function decodeAddress(string memory btcAddress) 
        internal 
        pure 
        returns (uint8 scriptType, bytes memory scriptHash) 
    {
        bytes memory addr = bytes(btcAddress);
        if (addr.length == 0) revert InvalidAddressLength();
        
        // Check for Bech32 addresses (P2WPKH or P2WSH)
        if (addr.length >= 3 && addr[0] == 0x62 && addr[1] == 0x63 && addr[2] == 0x31) {
            // Address starts with "bc1"
            return decodeBech32Address(addr);
        }
        
        // Otherwise, it's a Base58 address (P2PKH or P2SH)
        return decodeBase58Address(addr);
    }
    
    /// @notice Decode a Base58-encoded Bitcoin address (P2PKH or P2SH)
    /// @param addr The address bytes
    /// @return scriptType The type of script (0=P2PKH, 1=P2SH)
    /// @return scriptHash The 20-byte hash
    function decodeBase58Address(bytes memory addr) 
        internal 
        pure 
        returns (uint8 scriptType, bytes memory scriptHash) 
    {
        // Base58 decode
        bytes memory decoded = base58Decode(addr);
        
        // Verify minimum length (1 byte version + 20 bytes hash + 4 bytes checksum)
        if (decoded.length != 25) revert InvalidAddressLength();
        
        // Extract components
        uint8 version = uint8(decoded[0]);
        bytes memory hash = new bytes(20);
        for (uint i = 0; i < 20; i++) {
            hash[i] = decoded[i + 1];
        }
        
        // Verify checksum
        bytes memory toHash = new bytes(21);
        toHash[0] = decoded[0];
        for (uint i = 0; i < 20; i++) {
            toHash[i + 1] = decoded[i + 1];
        }
        
        bytes32 checksum = sha256(abi.encodePacked(sha256(toHash)));
        for (uint i = 0; i < 4; i++) {
            if (decoded[21 + i] != checksum[i]) revert InvalidChecksum();
        }
        
        // Determine script type based on version byte
        if (version == P2PKH_MAINNET_PREFIX || version == P2PKH_TESTNET_PREFIX) {
            return (0, hash); // P2PKH
        } else if (version == P2SH_MAINNET_PREFIX || version == P2SH_TESTNET_PREFIX) {
            return (1, hash); // P2SH
        } else {
            revert InvalidAddressPrefix();
        }
    }
    
    /// @notice Decode a Bech32-encoded Bitcoin address (P2WPKH or P2WSH)
    /// @param addr The address bytes
    /// @return scriptType The type of script (2=P2WPKH, 3=P2WSH)
    /// @return scriptHash The hash (20 bytes for P2WPKH, 32 bytes for P2WSH)
    function decodeBech32Address(bytes memory addr) 
        internal 
        pure 
        returns (uint8 scriptType, bytes memory scriptHash) 
    {
        // Find separator
        uint256 sepIndex = 0;
        for (uint256 i = 0; i < addr.length; i++) {
            if (addr[i] == 0x31) { // '1'
                sepIndex = i;
                break;
            }
        }
        
        if (sepIndex == 0 || sepIndex + 7 > addr.length) revert InvalidAddressLength();
        
        // Decode data part
        bytes memory data = new bytes(addr.length - sepIndex - 1);
        for (uint256 i = sepIndex + 1; i < addr.length; i++) {
            data[i - sepIndex - 1] = addr[i];
        }
        
        // Convert from bech32 to 5-bit groups
        uint256[] memory values = new uint256[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            values[i] = bech32CharToValue(data[i]);
        }
        
        // Verify checksum (last 6 characters)
        if (!verifyBech32Checksum(addr, sepIndex, values)) revert InvalidChecksum();
        
        // Convert from 5-bit to 8-bit, excluding version and checksum
        uint256 witnessVersion = values[0];
        bytes memory witnessProgram = convertBits(values, 1, values.length - 7, 5, 8, false);
        
        // Determine script type based on witness program length
        if (witnessVersion == 0) {
            if (witnessProgram.length == 20) {
                return (2, witnessProgram); // P2WPKH
            } else if (witnessProgram.length == 32) {
                return (3, witnessProgram); // P2WSH
            }
        }
        
        revert UnsupportedAddressType();
    }
    
    /// @notice Base58 decode implementation
    /// @param source The Base58 encoded data
    /// @return decoded The decoded bytes
    function base58Decode(bytes memory source) 
        internal 
        pure 
        returns (bytes memory decoded) 
    {
        uint256 result = 0;
        uint256 multi = 1;
        
        // Process from right to left
        for (int256 i = int256(source.length) - 1; i >= 0; i--) {
            uint256 digit = base58CharToValue(source[uint256(i)]);
            result += digit * multi;
            multi *= 58;
        }
        
        // Convert to bytes
        bytes memory temp = new bytes(32);
        uint256 len = 0;
        while (result > 0) {
            temp[len++] = bytes1(uint8(result % 256));
            result /= 256;
        }
        
        // Count leading zeros in source
        uint256 leadingZeros = 0;
        for (uint256 i = 0; i < source.length && source[i] == 0x31; i++) {
            leadingZeros++;
        }
        
        // Build final result with correct length
        decoded = new bytes(leadingZeros + len);
        
        // Add leading zeros
        for (uint256 i = 0; i < leadingZeros; i++) {
            decoded[i] = 0x00;
        }
        
        // Add decoded bytes in reverse order
        for (uint256 i = 0; i < len; i++) {
            decoded[leadingZeros + i] = temp[len - 1 - i];
        }
    }
    
    /// @notice Convert Base58 character to its numeric value
    /// @param char The character to convert
    /// @return value The numeric value (0-57)
    function base58CharToValue(bytes1 char) 
        internal 
        pure 
        returns (uint256 value) 
    {
        for (uint256 i = 0; i < 58; i++) {
            if (BASE58_ALPHABET[i] == char) {
                return i;
            }
        }
        revert InvalidAddressPrefix();
    }
    
    /// @notice Convert Bech32 character to its numeric value
    /// @param char The character to convert
    /// @return value The numeric value (0-31)
    function bech32CharToValue(bytes1 char) 
        internal 
        pure 
        returns (uint256 value) 
    {
        for (uint256 i = 0; i < 32; i++) {
            if (BECH32_CHARSET[i] == char) {
                return i;
            }
        }
        revert InvalidAddressPrefix();
    }
    
    /// @notice Verify Bech32 checksum
    /// @param addr The full address
    /// @param sepIndex The separator index
    /// @param values The decoded values
    /// @return valid True if checksum is valid
    function verifyBech32Checksum(
        bytes memory addr,
        uint256 sepIndex,
        uint256[] memory values
    ) internal pure returns (bool valid) {
        uint256 chk = 1;
        
        // Process HRP
        for (uint256 i = 0; i < sepIndex; i++) {
            uint256 c = uint256(uint8(addr[i]));
            chk = bech32PolymodStep(chk) ^ (c >> 5);
        }
        
        chk = bech32PolymodStep(chk);
        
        for (uint256 i = 0; i < sepIndex; i++) {
            uint256 c = uint256(uint8(addr[i]));
            chk = bech32PolymodStep(chk) ^ (c & 0x1f);
        }
        
        // Process data
        for (uint256 i = 0; i < values.length; i++) {
            chk = bech32PolymodStep(chk) ^ values[i];
        }
        
        return chk == 1;
    }
    
    /// @notice Bech32 polymod step function
    /// @param pre Previous value
    /// @return Next value
    function bech32PolymodStep(uint256 pre) 
        internal 
        pure 
        returns (uint256) 
    {
        uint256 b = pre >> 25;
        return ((pre & 0x1ffffff) << 5) ^
            (b & 1 != 0 ? 0x3b6a57b2 : 0) ^
            (b & 2 != 0 ? 0x26508e6d : 0) ^
            (b & 4 != 0 ? 0x1ea119fa : 0) ^
            (b & 8 != 0 ? 0x3d4233dd : 0) ^
            (b & 16 != 0 ? 0x2a1462b3 : 0);
    }
    
    /// @notice Convert between bit groups
    /// @param data Input data
    /// @param start Start index
    /// @param end End index
    /// @param fromBits Source bit size
    /// @param toBits Target bit size
    /// @param pad Whether to pad incomplete groups
    /// @return output Converted data
    function convertBits(
        uint256[] memory data,
        uint256 start,
        uint256 end,
        uint256 fromBits,
        uint256 toBits,
        bool pad
    ) internal pure returns (bytes memory output) {
        uint256 acc = 0;
        uint256 bits = 0;
        uint256 maxv = (1 << toBits) - 1;
        bytes memory result = new bytes(((end - start) * fromBits) / toBits + 1);
        uint256 length = 0;
        
        for (uint256 i = start; i < end; i++) {
            acc = (acc << fromBits) | data[i];
            bits += fromBits;
            
            while (bits >= toBits) {
                bits -= toBits;
                result[length++] = bytes1(uint8((acc >> bits) & maxv));
            }
        }
        
        if (pad && bits > 0) {
            result[length++] = bytes1(uint8((acc << (toBits - bits)) & maxv));
        }
        
        output = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            output[i] = result[i];
        }
    }
}