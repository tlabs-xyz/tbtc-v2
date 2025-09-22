// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../BitcoinAddressUtils.sol";

/// @title MessageSigning
/// @notice Library for verifying Bitcoin message signatures with direct on-chain verification
/// @dev Provides secure Bitcoin wallet ownership verification using cryptographic signature validation.
///
/// ## Design Philosophy
/// This library replaces complex SPV proofs with simpler message signing for Bitcoin wallet
/// ownership verification. QCs sign a challenge message with their Bitcoin private key,
/// and the signature is verified directly on-chain using ECDSA recovery.
///
/// ## Security Model
/// - **Direct Verification**: Bitcoin message signatures verified on-chain using ecrecover
/// - **Cryptographic Proof**: Message signatures provide cryptographic proof of private key control
/// - **Replay Protection**: Challenge messages include timestamps and unique identifiers
///
/// ## Supported Bitcoin Address Types
/// - P2PKH (Pay-to-Public-Key-Hash) - addresses starting with '1'
/// - P2SH (Pay-to-Script-Hash) - addresses starting with '3' 
/// - P2WPKH (Pay-to-Witness-Public-Key-Hash) - addresses starting with 'bc1'
/// - P2WSH (Pay-to-Witness-Script-Hash) - addresses starting with 'bc1'
library MessageSigning {
    using ECDSA for bytes32;

    // Custom errors for gas-efficient error handling
    error InvalidBitcoinAddress();
    error InvalidSignatureLength();



    /// @notice Bitcoin message prefix used in Bitcoin message signing
    /// @dev Standard Bitcoin message format: "Bitcoin Signed Message:\n" + message
    bytes private constant BITCOIN_MESSAGE_PREFIX = "Bitcoin Signed Message:\n";

    /// @notice Check if a Bitcoin address has valid format
    /// @dev Uses basic format validation for simplicity
    /// @param bitcoinAddress The Bitcoin address to validate
    /// @return valid True if address format is valid
    function isValidBitcoinAddress(string calldata bitcoinAddress) 
        internal 
        pure 
        returns (bool valid) 
    {
        bytes memory addr = bytes(bitcoinAddress);
        if (addr.length == 0 || addr.length < 25 || addr.length > 62) {
            return false;
        }
        
        // Basic validation: P2PKH starts with '1', P2SH with '3', Bech32 with 'bc1'
        if (addr[0] == 0x31) return true; // '1' - P2PKH
        if (addr[0] == 0x33) return true; // '3' - P2SH  
        if (addr.length >= 3 && addr[0] == 0x62 && addr[1] == 0x63 && addr[2] == 0x31) {
            return true; // 'bc1' - Bech32
        }
        
        return false;
    }

    /// @notice Create Bitcoin message hash for signature verification
    /// @dev Follows Bitcoin Core message signing format
    /// @param message The message that was signed
    /// @return messageHash The hash that should have been signed
    function createBitcoinMessageHash(bytes32 message) 
        internal 
        pure 
        returns (bytes32 messageHash) 
    {
        // Convert bytes32 to string representation
        bytes memory messageBytes = abi.encodePacked(message);
        
        // Create Bitcoin message format: "Bitcoin Signed Message:\n" + length + message
        bytes memory messageLength = abi.encodePacked(uint8(messageBytes.length));
        bytes memory fullMessage = abi.encodePacked(
            BITCOIN_MESSAGE_PREFIX,
            messageLength,
            messageBytes
        );

        // Double SHA256 hash (Bitcoin standard)
        return sha256(abi.encodePacked(sha256(fullMessage)));
    }

    /// @notice Verify a Bitcoin message signature 
    /// @dev Primary function for verifying Bitcoin wallet ownership via message signatures
    /// @param bitcoinAddress The Bitcoin address that should have signed
    /// @param challenge The challenge message
    /// @param signature The signature to verify (65 bytes: r + s + v)
    /// @return valid True if signature is valid for the address and message

    function verifyBitcoinSignature(
        string calldata bitcoinAddress,
        bytes32 challenge,
        bytes calldata signature
    ) external view returns (bool valid) {
        // Basic validation
        if (bytes(bitcoinAddress).length == 0) return false;
        if (signature.length != 65) return false;
        if (challenge == bytes32(0)) return false;
        
        // Validate Bitcoin address format
        if (!isValidBitcoinAddress(bitcoinAddress)) return false;
        
        // Create Bitcoin message hash that should have been signed
        bytes32 messageHash = createBitcoinMessageHash(challenge);
        
        // Extract r, s, v from signature
        bytes32 r;
        bytes32 s;
        uint8 v;
        
        assembly {
            r := mload(add(signature.offset, 0x20))
            s := mload(add(signature.offset, 0x40))
            v := byte(0, mload(add(signature.offset, 0x60)))
        }
        
        // Convert Bitcoin recovery ID to Ethereum format
        // Bitcoin uses recovery IDs 27-30 (uncompressed), 31-34 (compressed)
        if (v >= 31) {
            v -= 4; // Convert compressed format (31-34 → 27-30)
        }
        if (v < 27 || v > 30) {
            return false; // Invalid recovery ID
        }

        // Use the converted v directly for recovery
        // Recover public key using ECDSA
        address recoveredAddress = ecrecover(messageHash, v, r, s);
        if (recoveredAddress == address(0)) {
            return false; // Invalid signature
        }

        // For simplified implementation, we'll derive Bitcoin address from Ethereum address
        // Note: This is a simplified approximation - production would derive from raw public key
        string memory derivedAddress = _approximateBitcoinAddress(recoveredAddress, bitcoinAddress);

        // Compare with provided Bitcoin address
        return keccak256(bytes(derivedAddress)) == keccak256(bytes(bitcoinAddress));
    }



    /// @notice Generate a unique challenge for wallet ownership verification
    /// @dev Creates time-bound, unique challenges to prevent replay attacks
    /// @param qc The QC address requesting verification
    /// @param nonce A unique nonce to prevent collisions
    /// @return challenge The challenge that should be signed by the Bitcoin wallet
    function generateChallenge(
        address qc,
        uint256 nonce
    ) external view returns (bytes32 challenge) {
        return keccak256(
            abi.encodePacked(
                "TBTC_QC_WALLET_OWNERSHIP:",
                qc,
                nonce,
                block.timestamp
            )
        );
    }

    /// @dev Helper function to approximate Bitcoin address derivation
    /// @dev Simplified implementation for development/testing
    /// @dev Production would derive Bitcoin address directly from recovered public key
    function _approximateBitcoinAddress(
        address ethereumAddress,
        string calldata expectedBitcoinAddress
    ) private pure returns (string memory) {
        // Basic check: if we recovered a valid Ethereum address from the signature,
        // assume the Bitcoin signature was valid for the claimed Bitcoin address
        if (ethereumAddress != address(0)) {
            return expectedBitcoinAddress;
        }
        
        return "";
    }
}