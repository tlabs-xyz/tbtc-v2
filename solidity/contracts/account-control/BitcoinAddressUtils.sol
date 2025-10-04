// SPDX-License-Identifier: GPL-3.0-only

// ██████████████     ▐████▌     ██████████████
// ██████████████     ▐████▌     ██████████████
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
// ██████████████     ▐████▌     ██████████████
// ██████████████     ▐████▌     ██████████████
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌

pragma solidity 0.8.17;

import "./QCErrors.sol";

/**
 * @title Bitcoin Address Utilities
 * @notice Library for decoding Bitcoin addresses into their script representations
 * @dev Comprehensive Bitcoin address validation and manipulation library that supports:
 *      - P2PKH (Pay-to-PubKey-Hash): Legacy addresses starting with '1'
 *      - P2SH (Pay-to-Script-Hash): Script addresses starting with '3'
 *      - P2WPKH (Pay-to-Witness-PubKey-Hash): Native SegWit addresses (bc1...)
 *      - P2WSH (Pay-to-Witness-Script-Hash): Native SegWit script addresses
 *
 *      This library provides critical security functions for:
 *      - Bitcoin address format validation (lightweight and full cryptographic)
 *      - Address decoding for script hash extraction
 *      - Public key to Bitcoin address derivation
 *      - Base58 and Bech32 encoding/decoding
 *
 * @custom:security-contact security@threshold.network
 * @custom:security-notes
 * - All address validation includes checksum verification to prevent typos
 * - Mixed-case Bech32 addresses are rejected per BIP-173
 * - Public key derivation uses proper Bitcoin address standards
 */
library BitcoinAddressUtils {

    // Bitcoin address version bytes
    uint8 private constant P2PKH_MAINNET_PREFIX = 0x00; // Addresses starting with '1'
    uint8 private constant P2SH_MAINNET_PREFIX = 0x05; // Addresses starting with '3'
    uint8 private constant P2PKH_TESTNET_PREFIX = 0x6F; // Addresses starting with 'm' or 'n'
    uint8 private constant P2SH_TESTNET_PREFIX = 0xC4; // Addresses starting with '2'

    // Base58 alphabet (Bitcoin uses this specific ordering)
    bytes private constant BASE58_ALPHABET =
        "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

    // Bech32 constants
    bytes private constant BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    uint256 private constant BECH32_GENERATOR = 0x3b6a57b2;
    uint256 private constant BECH32_POLY_2 = 0x26508e6d;
    uint256 private constant BECH32_POLY_4 = 0x1ea119fa;
    uint256 private constant BECH32_POLY_8 = 0x3d4233dd;
    uint256 private constant BECH32_POLY_16 = 0x2a1462b3;
    
    // Character constants
    bytes1 private constant SEPARATOR_CHAR = 0x31; // '1'
    
    // Bech32 network prefixes  
    string private constant MAINNET_HRP = "bc";

    /// @notice Decode a Bitcoin address to its script representation\n    /// @dev Complex address parsing with multi-format support:\n    ///      1. Input validation and length checks\n    ///      2. Format detection (Bech32 vs Base58)\n    ///      3. Delegates to specialized decoders based on format\n    ///      4. Returns standardized script type and hash for all formats\n    ///      5. Performs full cryptographic validation including checksums\n    ///      Critical for wallet registration security and Bitcoin integration.
    /// @param btcAddress The Bitcoin address as a string
    /// @return scriptType The type of script (0=P2PKH, 1=P2SH, 2=P2WPKH, 3=P2WSH)
    /// @return scriptHash The hash component of the script (20 or 32 bytes)
    function decodeAddress(string memory btcAddress)
        internal
        pure
        returns (uint8 scriptType, bytes memory scriptHash)
    {
        bytes memory addr = bytes(btcAddress);
        if (addr.length == 0) revert QCErrors.InvalidWalletAddress();

        // Check for Bech32 addresses (P2WPKH or P2WSH)
        if (isBech32Address(addr)) {
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
        if (decoded.length != 25) revert QCErrors.InvalidBitcoinAddressLength(string(addr), decoded.length);

        // Extract components
        uint8 version = uint8(decoded[0]);
        bytes memory hash = new bytes(20);
        for (uint256 i = 0; i < 20; i++) {
            hash[i] = decoded[i + 1];
        }

        // Verify checksum
        bytes memory toHash = new bytes(21);
        toHash[0] = decoded[0];
        for (uint256 i = 0; i < 20; i++) {
            toHash[i + 1] = decoded[i + 1];
        }

        bytes32 checksum = sha256(abi.encodePacked(sha256(toHash)));
        for (uint256 i = 0; i < 4; i++) {
            if (decoded[21 + i] != checksum[i]) revert QCErrors.InvalidBitcoinAddressFormat(string(addr));
        }

        // Determine script type based on version byte
        if (
            version == P2PKH_MAINNET_PREFIX || version == P2PKH_TESTNET_PREFIX
        ) {
            return (0, hash); // P2PKH
        } else if (
            version == P2SH_MAINNET_PREFIX || version == P2SH_TESTNET_PREFIX
        ) {
            return (1, hash); // P2SH
        } else {
            revert QCErrors.InvalidBitcoinAddressFormat(string(addr));
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
            if (addr[i] == SEPARATOR_CHAR) {
                sepIndex = i;
                break;
            }
        }

        if (sepIndex == 0 || sepIndex + 7 > addr.length)
            revert QCErrors.InvalidBitcoinAddressFormat("");

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
        if (!verifyBech32Checksum(addr, sepIndex, values))
            revert QCErrors.InvalidBitcoinAddressFormat(string(addr));

        // Convert from 5-bit to 8-bit, excluding version and checksum
        uint256 witnessVersion = values[0];
        bytes memory witnessProgram = convertBits(
            values,
            1,
            values.length - 6,
            5,
            8,
            false
        );

        // Determine script type based on witness program length
        if (witnessVersion == 0) {
            if (witnessProgram.length == 20) {
                return (2, witnessProgram); // P2WPKH
            } else if (witnessProgram.length == 32) {
                return (3, witnessProgram); // P2WSH
            }
        }

        revert QCErrors.InvalidBitcoinAddressFormat(string(addr));
    }

    /// @notice Base58 decode implementation
    /// @param source The Base58 encoded data
    /// @return decoded The decoded bytes
    function base58Decode(bytes memory source)
        internal
        pure
        returns (bytes memory decoded)
    {
        if (source.length == 0) {
            return new bytes(0);
        }
        
        // Count leading '1's which represent leading zeros
        uint256 leadingOnes = 0;
        for (uint256 i = 0; i < source.length && source[i] == 0x31; i++) {
            leadingOnes++;
        }
        
        // If all characters are '1', return that many zero bytes
        if (leadingOnes == source.length) {
            return new bytes(leadingOnes);
        }
        
        // Use fixed size for Bitcoin addresses to avoid overflow
        // Bitcoin addresses decode to at most 25 bytes (1 version + 20 hash + 4 checksum)
        // Use 32 bytes to be safe for any base58 decoding
        uint256 WORK_SIZE = 32;
        bytes memory num = new bytes(WORK_SIZE);
        
        // Process each character
        for (uint256 i = leadingOnes; i < source.length; i++) {
            uint256 carry = base58CharToValue(source[i]);
            
            // Big integer multiply by 58 and add carry
            for (uint256 j = 0; j < WORK_SIZE; j++) {
                uint256 idx = WORK_SIZE - 1 - j;
                carry += 58 * uint256(uint8(num[idx]));
                num[idx] = bytes1(uint8(carry % 256));
                carry /= 256;
            }
            
            if (carry != 0) revert QCErrors.InvalidBitcoinAddressFormat("");
        }
        
        // Find first non-zero byte
        uint256 firstNonZero = WORK_SIZE;
        for (uint256 i = 0; i < WORK_SIZE; i++) {
            if (num[i] != 0) {
                firstNonZero = i;
                break;
            }
        }
        
        // If no non-zero bytes found, but we have non-leading-one characters, it's an error
        if (firstNonZero == WORK_SIZE && leadingOnes < source.length) {
            revert QCErrors.InvalidBitcoinAddressFormat("");
        }
        
        // Calculate result size
        uint256 significantBytes = firstNonZero == WORK_SIZE ? 0 : WORK_SIZE - firstNonZero;
        uint256 totalSize = leadingOnes + significantBytes;
        
        decoded = new bytes(totalSize);
        
        // Copy leading zeros
        for (uint256 i = 0; i < leadingOnes; i++) {
            decoded[i] = 0x00;
        }
        
        // Copy significant bytes
        for (uint256 i = 0; i < significantBytes; i++) {
            decoded[leadingOnes + i] = num[firstNonZero + i];
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
        uint8 c = uint8(char);
        
        // Base58 character mapping optimized for gas
        if (c >= 0x31 && c <= 0x39) { // '1' to '9'
            return c - 0x31; // 0-8
        } else if (c >= 0x41 && c <= 0x48) { // 'A' to 'H'
            return c - 0x41 + 9; // 9-16
        } else if (c >= 0x4A && c <= 0x4E) { // 'J' to 'N'
            return c - 0x4A + 17; // 17-21
        } else if (c >= 0x50 && c <= 0x5A) { // 'P' to 'Z'
            return c - 0x50 + 22; // 22-32
        } else if (c >= 0x61 && c <= 0x6B) { // 'a' to 'k'
            return c - 0x61 + 33; // 33-43
        } else if (c >= 0x6D && c <= 0x7A) { // 'm' to 'z'
            return c - 0x6D + 44; // 44-57
        }

        revert QCErrors.InvalidAddressPrefix();
    }

    /// @notice Convert Bech32 character to its numeric value
    /// @param char The character to convert
    /// @return value The numeric value (0-31)
    function bech32CharToValue(bytes1 char)
        internal
        pure
        returns (uint256 value)
    {
        uint8 c = uint8(char);
        
        // Bech32 character mapping optimized for gas
        // Charset: "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
        // Support both lowercase and uppercase variants
        if (c == 0x71 || c == 0x51) return 0;  // 'q' or 'Q'
        if (c == 0x70 || c == 0x50) return 1;  // 'p' or 'P'
        if (c == 0x7A || c == 0x5A) return 2;  // 'z' or 'Z'
        if (c == 0x72 || c == 0x52) return 3;  // 'r' or 'R'
        if (c == 0x79 || c == 0x59) return 4;  // 'y' or 'Y'
        if (c == 0x39) return 5;  // '9'
        if (c == 0x78 || c == 0x58) return 6;  // 'x' or 'X'
        if (c == 0x38) return 7;  // '8'
        if (c == 0x67 || c == 0x47) return 8;  // 'g' or 'G'
        if (c == 0x66 || c == 0x46) return 9;  // 'f' or 'F'
        if (c == 0x32) return 10; // '2'
        if (c == 0x74 || c == 0x54) return 11; // 't' or 'T'
        if (c == 0x76 || c == 0x56) return 12; // 'v' or 'V'
        if (c == 0x64 || c == 0x44) return 13; // 'd' or 'D'
        if (c == 0x77 || c == 0x57) return 14; // 'w' or 'W'
        if (c == 0x30) return 15; // '0'
        if (c == 0x73 || c == 0x53) return 16; // 's' or 'S'
        if (c == 0x33) return 17; // '3'
        if (c == 0x6A || c == 0x4A) return 18; // 'j' or 'J'
        if (c == 0x6E || c == 0x4E) return 19; // 'n' or 'N'
        if (c == 0x35) return 20; // '5'
        if (c == 0x34) return 21; // '4'
        if (c == 0x6B || c == 0x4B) return 22; // 'k' or 'K'
        if (c == 0x68 || c == 0x48) return 23; // 'h' or 'H'
        if (c == 0x63 || c == 0x43) return 24; // 'c' or 'C'
        if (c == 0x65 || c == 0x45) return 25; // 'e' or 'E'
        if (c == 0x36) return 26; // '6'
        if (c == 0x6D || c == 0x4D) return 27; // 'm' or 'M'
        if (c == 0x75 || c == 0x55) return 28; // 'u' or 'U'
        if (c == 0x61 || c == 0x41) return 29; // 'a' or 'A'
        if (c == 0x37) return 30; // '7'
        if (c == 0x6C || c == 0x4C) return 31; // 'l' or 'L'

        revert QCErrors.InvalidAddressPrefix();
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

        // Process HRP (convert to lowercase for checksum verification per BIP-173)
        for (uint256 i = 0; i < sepIndex; i++) {
            uint256 c = uint256(uint8(addr[i]));
            // Convert uppercase to lowercase if needed
            if (c >= 0x41 && c <= 0x5A) {
                c = c + 0x20;
            }
            chk = bech32PolymodStep(chk) ^ (c >> 5);
        }

        chk = bech32PolymodStep(chk);

        for (uint256 i = 0; i < sepIndex; i++) {
            uint256 c = uint256(uint8(addr[i]));
            // Convert uppercase to lowercase if needed
            if (c >= 0x41 && c <= 0x5A) {
                c = c + 0x20;
            }
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
    function bech32PolymodStep(uint256 pre) internal pure returns (uint256) {
        uint256 b = pre >> 25;
        return
            ((pre & 0x1ffffff) << 5) ^
            (b & 1 != 0 ? BECH32_GENERATOR : 0) ^
            (b & 2 != 0 ? BECH32_POLY_2 : 0) ^
            (b & 4 != 0 ? BECH32_POLY_4 : 0) ^
            (b & 8 != 0 ? BECH32_POLY_8 : 0) ^
            (b & 16 != 0 ? BECH32_POLY_16 : 0);
    }

    /// @notice Check if address is a valid Bech32 format
    /// @param addr The address bytes to check
    /// @return True if valid Bech32 format (bc1/BC1/tb1/TB1), rejects mixed-case per BIP-173
    function isBech32Address(bytes memory addr) internal pure returns (bool) {
        if (addr.length < 4) return false;
        
        // Check for Bech32 prefixes (bc1/BC1/tb1/TB1)
        if (addr.length >= 3 && addr[2] == SEPARATOR_CHAR) {
            return isBech32Prefix(addr) && !hasMixedCaseInAddress(addr);
        }
        
        return false;
    }

    /// @notice Check if address has mixed case (violates BIP-173)
    /// @param addr The address bytes to check
    /// @return True if mixed case is detected
    function hasMixedCaseInAddress(bytes memory addr) internal pure returns (bool) {
        bool hasUppercase = false;
        bool hasLowercase = false;
        
        for (uint256 i = 0; i < addr.length; i++) {
            uint8 c = uint8(addr[i]);
            
            // Check if character is uppercase letter (A-Z: 0x41-0x5A)
            if (c >= 0x41 && c <= 0x5A) {
                hasUppercase = true;
            }
            // Check if character is lowercase letter (a-z: 0x61-0x7A)
            else if (c >= 0x61 && c <= 0x7A) {
                hasLowercase = true;
            }
            
            // Early exit if mixed case detected
            if (hasUppercase && hasLowercase) {
                return true;
            }
        }
        
        return false;
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
        if (start >= end) return output; // Return empty bytes for empty input
        
        uint256 acc = 0;
        uint256 bits = 0;
        uint256 maxv = (1 << toBits) - 1;
        bytes memory result = new bytes(
            ((end - start) * fromBits) / toBits + 1
        );
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

    /// @notice Derive Bitcoin P2WPKH (native SegWit) address from public key
    /// @dev Derives a bech32 encoded Bitcoin address (bc1...) from an uncompressed public key
    /// @dev Complex cryptographic derivation process:
    ///      1. Validates 64-byte uncompressed public key input
    ///      2. Compresses public key using Y-coordinate parity (0x02/0x03 prefix)
    ///      3. Performs SHA256 + RIPEMD160 hash chain on compressed key
    ///      4. Creates witness program (version 0 + 20-byte pubKeyHash)
    ///      5. Converts to 5-bit groups for bech32 encoding
    ///      6. Calculates bech32 checksum using proper polynomial math
    ///      7. Encodes final address with 'bc1' prefix for mainnet
    ///      Critical for wallet ownership verification in QC registration.
    /// @param publicKey The uncompressed public key (64 bytes, no 0x04 prefix)
    /// @return btcAddress The derived Bitcoin address in bech32 format
    function deriveBitcoinAddressFromPublicKey(bytes memory publicKey) internal pure returns (string memory) {
        if (publicKey.length != 64) revert QCErrors.InvalidAddressLength();
        
        // Step 1: Compress the public key
        // Take the X coordinate (first 32 bytes)
        bytes memory compressed = new bytes(33);
        // Determine prefix based on Y coordinate parity
        // Y coordinate is the last 32 bytes of the public key
        bytes32 yCoordBytes;
        for (uint i = 0; i < 32; i++) {
            yCoordBytes |= bytes32(uint256(uint8(publicKey[32 + i]))) << ((31 - i) * 8);
        }
        uint256 yCoord = uint256(yCoordBytes);
        compressed[0] = (yCoord % 2 == 0) ? bytes1(0x02) : bytes1(0x03);
        // Copy X coordinate
        for (uint i = 0; i < 32; i++) {
            compressed[i + 1] = publicKey[i];
        }
        
        // Step 2: Hash the compressed public key
        bytes20 pubKeyHash = ripemd160(abi.encodePacked(sha256(compressed)));
        
        // Step 3: Witness program is implicitly version 0 with 20 bytes pubKeyHash
        
        // Step 4: Convert to 5-bit groups for bech32
        // Need 33 entries: 1 witness version + 32 payload groups (20 bytes * 8 bits / 5 bits = 32)
        uint256[] memory values = new uint256[](39); // Extra space for checksum calculation
        values[0] = 0; // witness version
        
        // Convert 20 bytes to 5-bit groups
        uint256 accumulator = 0;
        uint256 bits = 0;
        uint256 idx = 1;
        
        for (uint256 i = 0; i < 20; i++) {
            uint8 b = uint8(pubKeyHash[i]);
            accumulator = (accumulator << 8) | b;
            bits += 8;
            
            while (bits >= 5) {
                bits -= 5;
                values[idx++] = (accumulator >> bits) & 0x1f;
            }
        }
        if (bits > 0) {
            values[idx++] = (accumulator << (5 - bits)) & 0x1f;
        }
        
        // Step 5: Calculate bech32 checksum
        uint256 checksum = bech32ChecksumForDerivation(MAINNET_HRP, values, idx);
        
        // Append checksum (6 characters) - extract in correct order
        for (uint256 i = 0; i < 6; i++) {
            values[idx++] = (checksum >> (5 * (5 - i))) & 0x1f;
        }
        
        // Step 6: Encode as bech32
        bytes memory result = "bc1";
        
        for (uint256 i = 0; i < idx; i++) {
            result = abi.encodePacked(result, BECH32_CHARSET[values[i]]);
        }
        
        return string(result);
    }

    /// @notice Calculate bech32 checksum for address derivation (internal helper)
    /// @param hrp Human readable part (e.g., "bc")
    /// @param data The data part in 5-bit groups
    /// @param dataLen Length of data array to process
    /// @return checksum The 30-bit checksum
    function bech32ChecksumForDerivation(string memory hrp, uint256[] memory data, uint256 dataLen) internal pure returns (uint256) {
        uint256 chk = 1;
        
        // Process HRP
        bytes memory hrpBytes = bytes(hrp);
        for (uint256 i = 0; i < hrpBytes.length; i++) {
            chk = bech32PolymodStep(chk) ^ (uint256(uint8(hrpBytes[i])) >> 5);
        }
        chk = bech32PolymodStep(chk);
        
        for (uint256 i = 0; i < hrpBytes.length; i++) {
            chk = bech32PolymodStep(chk) ^ (uint256(uint8(hrpBytes[i])) & 0x1f);
        }
        
        // Process data
        for (uint256 i = 0; i < dataLen; i++) {
            chk = bech32PolymodStep(chk) ^ data[i];
        }
        
        // Process 6 zeros for checksum
        for (uint256 i = 0; i < 6; i++) {
            chk = bech32PolymodStep(chk);
        }
        
        return chk ^ 1;
    }

    /// @notice Check if address has a valid Bech32 prefix
    /// @param addr The address bytes to check
    /// @return True if valid Bech32 prefix (bc1/BC1/tb1/TB1)
    function isBech32Prefix(bytes memory addr) internal pure returns (bool) {
        // Need at least 3 characters for a valid prefix (e.g., "bc1")
        if (addr.length < 3) return false;
        
        // Third character must be '1' (separator)
        if (addr[2] != 0x31) return false;
        
        // Check for mainnet prefixes: "bc" or "BC"
        bool isLowercaseBC = addr[0] == 0x62 && addr[1] == 0x63; // "bc"
        bool isUppercaseBC = addr[0] == 0x42 && addr[1] == 0x43; // "BC"
        
        // Check for testnet prefixes: "tb" or "TB"
        bool isLowercaseTB = addr[0] == 0x74 && addr[1] == 0x62; // "tb"
        bool isUppercaseTB = addr[0] == 0x54 && addr[1] == 0x42; // "TB"
        
        return isLowercaseBC || isUppercaseBC || isLowercaseTB || isUppercaseTB;
    }

    /// @notice Lightweight Bitcoin address format validation (no cryptographic checks)
    /// @dev Gas-optimized validation for storage operations. Only checks basic format requirements.
    /// @dev This does NOT verify checksums or perform full validation - use decodeAddress for that.
    /// @param btcAddress The Bitcoin address to validate
    function validateAddressFormat(string calldata btcAddress) internal pure {
        bytes memory addr = bytes(btcAddress);
        uint256 length = addr.length;
        
        // Basic length check
        if (length < 26 || length > 90) revert QCErrors.InvalidBitcoinAddressLength(btcAddress, length);
        
        bytes1 first = addr[0];
        
        // P2PKH addresses: start with '1', length 26-35
        if (first == 0x31) { // '1'
            if (length > 35) revert QCErrors.InvalidBitcoinAddressLength(btcAddress, length);
            return;
        }
        
        // P2SH addresses: start with '3', length 26-35  
        if (first == 0x33) { // '3'
            if (length > 35) revert QCErrors.InvalidBitcoinAddressLength(btcAddress, length);
            return;
        }
        
        // Bech32 addresses: start with 'bc1' or 'tb1' (case-insensitive check)
        if (length >= 4) {
            // Check for 'bc1' prefix (mainnet)
            if ((addr[0] == 0x62 || addr[0] == 0x42) && // 'b' or 'B'
                (addr[1] == 0x63 || addr[1] == 0x43) && // 'c' or 'C' 
                addr[2] == 0x31) { // '1'
                
                // Ensure no mixed case (BIP-173 requirement)
                if (hasMixedCaseInAddress(addr)) {
                    revert QCErrors.InvalidBitcoinAddressFormat(btcAddress);
                }
                
                // Basic character validation for Bech32
                for (uint256 i = 3; i < length; i++) {
                    uint8 c = uint8(addr[i]);
                    // Must be lowercase alphanumeric (0-9, a-z)
                    if (!((c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a))) {
                        // Allow uppercase if entire address is uppercase
                        if (!((c >= 0x41 && c <= 0x5a) && addr[0] == 0x42)) {
                            revert QCErrors.InvalidBitcoinAddressFormat(btcAddress);
                        }
                    }
                }
                return;
            }
            
            // Check for 'tb1' prefix (testnet)
            if ((addr[0] == 0x74 || addr[0] == 0x54) && // 't' or 'T'
                (addr[1] == 0x62 || addr[1] == 0x42) && // 'b' or 'B'
                addr[2] == 0x31) { // '1'
                
                // Ensure no mixed case
                if (hasMixedCaseInAddress(addr)) {
                    revert QCErrors.InvalidBitcoinAddressFormat(btcAddress);
                }
                
                // Basic character validation
                for (uint256 i = 3; i < length; i++) {
                    uint8 c = uint8(addr[i]);
                    if (!((c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a))) {
                        if (!((c >= 0x41 && c <= 0x5a) && addr[0] == 0x54)) {
                            revert QCErrors.InvalidBitcoinAddressFormat(btcAddress);
                        }
                    }
                }
                return;
            }
        }

        revert QCErrors.InvalidBitcoinAddressFormat("");
    }
}
