// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/*
 * SPV Validator Design Philosophy
 * ==============================
 *
 * This contract bridges the gap between Account Control's SPV needs and
 * Bridge's proven SPV infrastructure without modifying production Bridge.
 *
 * WHY NOT MODIFY BRIDGE?
 * - Bridge secures millions in BTC and is battle-tested in production
 * - Redeploying Bridge carries significant risk and operational overhead
 * - Bridge's SPV logic is internal and not designed for external access
 *
 * OUR APPROACH:
 * - Replicate Bridge's exact SPV validation algorithms
 * - Use same relay contract and difficulty parameters as Bridge
 * - Provide clean interface tailored for Account Control needs
 * - Maintain identical security guarantees without production risks
 *
 * SECURITY CONSIDERATIONS:
 * - SPV logic is copied verbatim from Bridge's BitcoinTx.validateProof()
 * - Same cryptographic verification as production Bridge
 * - Same relay and difficulty factor sources ensure consistency
 * - Role-based access control protects configuration changes
 */

import "@keep-network/bitcoin-spv-sol/contracts/BTCUtils.sol";
import "@keep-network/bitcoin-spv-sol/contracts/ValidateSPV.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

import "../bridge/BitcoinTx.sol";
import "../bridge/IRelay.sol";
import "./BitcoinAddressUtils.sol";

/// @title SPV Validator for Account Control
/// @notice Lightweight SPV proof validator that replicates Bridge's validation logic
/// @dev This contract provides SPV validation without requiring Bridge modifications.
///
///      DESIGN DECISION: Rather than modifying the production Bridge contract
///      (which would require redeployment of a critical system component),
///      we created this lightweight validator that replicates Bridge's exact
///      SPV verification logic. This approach:
///
///      1. Avoids the risk of redeploying Bridge in production
///      2. Reuses the same battle-tested SPV algorithms that secure millions in BTC
///      3. Uses the same relay and difficulty parameters as Bridge
///      4. Provides a clean interface for Account Control system needs
///
///      The validator acts as a "bridge" to Bridge's proven SPV infrastructure,
///
///      Role definitions:
///      - DEFAULT_ADMIN_ROLE: Can grant/revoke roles (no other functions require roles)
///      giving Account Control access to production-grade SPV verification
///      without touching the core Bridge contract.
contract SPVValidator is AccessControl {
    using BTCUtils for bytes;
    using BTCUtils for uint256;
    using ValidateSPV for bytes;
    using ValidateSPV for bytes32;
    using BitcoinAddressUtils for string;

    // Custom errors for gas-efficient reverts
    error InvalidRelayAddress();
    error InvalidDifficultyFactor();
    error InvalidInputVector();
    error InvalidOutputVector();
    error MerkleTreeLevelMismatch();
    error InvalidTxMerkleProof();
    error InvalidCoinbaseMerkleProof();
    error InvalidHeadersChainLength();
    error InvalidHeadersChain();
    error InsufficientWorkInHeader();
    error InsufficientAccumulatedDifficulty();
    error NotAtCurrentOrPreviousDifficulty();

    /// @notice The relay contract for difficulty validation
    IRelay public immutable relay;

    /// @notice The difficulty factor required for SPV proofs
    uint96 public immutable txProofDifficultyFactor;

    /// @notice Events
    event SPVProofValidated(
        bytes32 indexed txHash,
        address indexed validator,
        uint256 indexed timestamp
    );

    event WalletControlVerified(
        address indexed qc,
        string btcAddress,
        bytes32 indexed txHash,
        address indexed verifiedBy,
        uint256 timestamp
    );

    event RedemptionFulfillmentVerified(
        bytes32 indexed redemptionId,
        bytes32 indexed txHash,
        address indexed verifiedBy,
        uint256 timestamp
    );

    /// @notice Constructor
    /// @param _relay Address of the relay contract (same as Bridge uses)
    /// @param _txProofDifficultyFactor Difficulty factor (same as Bridge uses)
    constructor(address _relay, uint96 _txProofDifficultyFactor) {
        if (_relay == address(0)) revert InvalidRelayAddress();
        if (_txProofDifficultyFactor == 0) revert InvalidDifficultyFactor();

        relay = IRelay(_relay);
        txProofDifficultyFactor = _txProofDifficultyFactor;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice Validate SPV proof using the same logic as Bridge
    /// @dev This function replicates Bridge's BitcoinTx.validateProof() logic exactly.
    ///      We chose to replicate rather than modify Bridge to avoid production risks.
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof data
    /// @return txHash Verified transaction hash
    function validateProof(
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external view returns (bytes32 txHash) {
        // REPLICATION NOTE: This replicates the exact logic from Bridge's
        // BitcoinTx.validateProof() to avoid modifying the production Bridge contract
        if (!txInfo.inputVector.validateVin()) revert InvalidInputVector();
        if (!txInfo.outputVector.validateVout()) revert InvalidOutputVector();
        if (proof.merkleProof.length != proof.coinbaseProof.length) {
            revert MerkleTreeLevelMismatch();
        }

        txHash = abi
            .encodePacked(
                txInfo.version,
                txInfo.inputVector,
                txInfo.outputVector,
                txInfo.locktime
            )
            .hash256View();

        bytes32 root = proof.bitcoinHeaders.extractMerkleRootLE();

        if (!txHash.prove(root, proof.merkleProof, proof.txIndexInBlock)) {
            revert InvalidTxMerkleProof();
        }

        bytes32 coinbaseHash = sha256(abi.encodePacked(proof.coinbasePreimage));

        if (!coinbaseHash.prove(root, proof.coinbaseProof, 0)) {
            revert InvalidCoinbaseMerkleProof();
        }

        _evaluateProofDifficulty(proof.bitcoinHeaders);

        return txHash;
    }

    /// @notice Verify wallet control via OP_RETURN challenge
    /// @param qc The QC address claiming wallet control
    /// @param btcAddress The Bitcoin address being claimed
    /// @param challenge The expected challenge string
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return verified True if wallet control is verified
    function verifyWalletControl(
        address qc,
        string calldata btcAddress,
        bytes32 challenge,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external returns (bool verified) {
        // Step 1: Verify SPV proof
        bytes32 txHash = this.validateProof(txInfo, proof);

        // Step 2: Verify OP_RETURN challenge in outputs
        bool challengeFound = _verifyOpReturnChallenge(
            txInfo.outputVector,
            challenge
        );
        if (!challengeFound) {
            return false;
        }

        // Step 3: Verify the transaction spends from the claimed Bitcoin address
        bool addressVerified = _verifyInputAddress(
            txInfo.inputVector,
            btcAddress
        );
        if (!addressVerified) {
            return false;
        }

        // Emit event for successful verification
        emit WalletControlVerified(
            qc,
            btcAddress,
            txHash,
            msg.sender,
            block.timestamp
        );

        return true;
    }

    /// @notice Verify redemption fulfillment payment
    /// @param redemptionId The redemption identifier
    /// @param userBtcAddress The user's Bitcoin address
    /// @param expectedAmount The expected payment amount in satoshis
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return verified True if redemption is fulfilled
    function verifyRedemptionFulfillment(
        bytes32 redemptionId,
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external returns (bool verified) {
        // Step 1: Verify SPV proof
        bytes32 txHash = this.validateProof(txInfo, proof);

        // Step 2: Verify payment to user's Bitcoin address
        bool paymentFound = _verifyPaymentOutput(
            txInfo.outputVector,
            userBtcAddress,
            expectedAmount
        );
        if (!paymentFound) {
            return false;
        }

        // Emit event for successful verification
        emit RedemptionFulfillmentVerified(
            redemptionId,
            txHash,
            msg.sender,
            block.timestamp
        );

        return true;
    }

    /// @dev Verify OP_RETURN challenge in transaction outputs
    /// @param outputVector Transaction outputs vector
    /// @param expectedChallenge The expected challenge hash
    /// @return found True if challenge is found in OP_RETURN output
    function _verifyOpReturnChallenge(
        bytes memory outputVector,
        bytes32 expectedChallenge
    ) private pure returns (bool found) {
        // Count outputs by parsing the VarInt at the beginning
        uint256 outputsCount = _parseVarInt(outputVector, 0);

        for (uint256 i = 0; i < outputsCount; i++) {
            bytes memory output = outputVector.extractOutputAtIndex(i);
            
            // Check if this is an OP_RETURN output
            if (output.length >= 34) { // Minimum: 8 bytes value + 1 byte script length + 1 byte OP_RETURN + 32 bytes data
                // Extract the locking script (skip 8-byte value)
                uint256 scriptLength = uint8(output[8]);
                
                // Check if it's OP_RETURN with 32-byte data
                if (scriptLength >= 34 && output[9] == 0x6a && output[10] == 0x20) {
                    // Extract the 32-byte data after OP_RETURN
                    bytes32 challengeData;
                    // solhint-disable-next-line no-inline-assembly
                    assembly {
                        challengeData := mload(add(output, 43)) // 32 bytes + 8 value + 1 script_len + 1 OP_RETURN + 1 data_len
                    }
                    
                    if (challengeData == expectedChallenge) {
                        return true;
                    }
                }
            }
        }
        
        return false;
    }

    /// @dev Verify that the transaction spends from the specified Bitcoin address
    /// @param inputVector Transaction inputs vector
    /// @param btcAddress The Bitcoin address to verify
    /// @return verified True if address is found in inputs
    function _verifyInputAddress(
        bytes memory inputVector,
        string memory btcAddress
    ) private pure returns (bool verified) {
        // Validate the address format by attempting to decode it
        // This will revert for invalid addresses, providing validation
        (uint8 scriptType, bytes memory expectedHash) = BitcoinAddressUtils.decodeAddress(btcAddress);
        
        // Ensure we got a valid result
        if (expectedHash.length == 0) return false;
        
        // Count inputs by parsing the VarInt
        uint256 inputsCount = _parseVarInt(inputVector, 0);
        if (inputsCount == 0) return false;
        
        // Parse each input to check if it spends from the expected address
        uint256 offset = _varIntLength(inputVector, 0);
        
        for (uint256 i = 0; i < inputsCount; i++) {
            // Each input is: [32-byte tx hash][4-byte output index][varint scriptSig length][scriptSig][4-byte sequence]
            
            // Skip tx hash (32 bytes) and output index (4 bytes)
            offset += 36;
            
            // Get scriptSig length
            uint256 scriptSigLen = _parseVarInt(inputVector, offset);
            offset += _varIntLength(inputVector, offset);
            
            // Extract and validate scriptSig if present
            if (scriptSigLen > 0) {
                bytes memory scriptSig = _extractBytes(inputVector, offset, scriptSigLen);
                
                // Check if this input spends from the expected address
                if (_validateInputScript(scriptSig, scriptType, expectedHash)) {
                    return true;
                }
                
                offset += scriptSigLen;
            }
            
            // Skip sequence number (4 bytes)
            offset += 4;
        }
        
        return false;
    }
    
    /// @dev Validate input script against expected address
    /// @param scriptSig The input script signature
    /// @param addressType The type of Bitcoin address (0=P2PKH, 1=P2SH, 2=P2WPKH, 3=P2WSH)
    /// @param expectedHash The expected hash from the address
    /// @return valid True if the script matches the expected address
    function _validateInputScript(
        bytes memory scriptSig,
        uint8 addressType,
        bytes memory expectedHash
    ) private pure returns (bool valid) {
        // For P2PKH inputs, scriptSig format is: <signature> <pubkey>
        if (addressType == 0) {
            // Extract public key from scriptSig
            bytes memory pubKey = _extractPubKeyFromP2PKHScriptSig(scriptSig);
            if (pubKey.length == 0) return false;
            
            // Hash the public key and compare with expected hash
            bytes memory pubKeyHash = abi.encodePacked(ripemd160(abi.encodePacked(sha256(pubKey))));
            return keccak256(pubKeyHash) == keccak256(expectedHash);
        }
        
        // For P2SH inputs, scriptSig contains the redeem script
        if (addressType == 1) {
            // Extract redeem script (it's the last data push in scriptSig)
            bytes memory redeemScript = _extractLastDataPush(scriptSig);
            if (redeemScript.length == 0) return false;
            
            // Hash the redeem script and compare with expected hash
            bytes memory scriptHash = abi.encodePacked(ripemd160(abi.encodePacked(sha256(redeemScript))));
            return keccak256(scriptHash) == keccak256(expectedHash);
        }
        
        // P2WPKH and P2WSH have empty scriptSig in witness transactions
        // For now, we don't support witness transaction parsing
        return false;
    }
    
    /// @dev Extract public key from P2PKH scriptSig
    /// @param scriptSig The script signature data
    /// @return pubKey The extracted public key
    function _extractPubKeyFromP2PKHScriptSig(bytes memory scriptSig) private pure returns (bytes memory pubKey) {
        if (scriptSig.length < 35) return pubKey; // Too short to contain sig + pubkey
        
        // Skip the signature: first byte is push opcode for signature length
        uint256 sigLen = uint256(uint8(scriptSig[0]));
        if (sigLen >= scriptSig.length) return pubKey;
        
        uint256 pubKeyOffset = sigLen + 1;
        if (pubKeyOffset >= scriptSig.length) return pubKey;
        
        // Get public key length
        uint256 pubKeyLen = uint256(uint8(scriptSig[pubKeyOffset]));
        pubKeyOffset += 1;
        
        // Validate public key length (33 for compressed, 65 for uncompressed)
        if (pubKeyLen != 33 && pubKeyLen != 65) return pubKey;
        if (pubKeyOffset + pubKeyLen > scriptSig.length) return pubKey;
        
        // Extract public key
        pubKey = _extractBytes(scriptSig, pubKeyOffset, pubKeyLen);
    }
    
    /// @dev Extract the last data push from a script
    /// @param script The script data
    /// @return data The last pushed data
    function _extractLastDataPush(bytes memory script) private pure returns (bytes memory data) {
        if (script.length == 0) return data;
        
        uint256 offset = 0;
        uint256 lastDataOffset = 0;
        uint256 lastDataLen = 0;
        
        // Parse through the script to find the last data push
        while (offset < script.length) {
            uint8 opcode = uint8(script[offset]);
            offset += 1;
            
            // Handle data push opcodes
            if (opcode <= 75) {
                // Direct push of 'opcode' bytes
                if (offset + opcode <= script.length) {
                    lastDataOffset = offset;
                    lastDataLen = opcode;
                    offset += opcode;
                } else {
                    break;
                }
            } else if (opcode == 0x4c) { // OP_PUSHDATA1
                if (offset + 1 <= script.length) {
                    uint256 len = uint256(uint8(script[offset]));
                    offset += 1;
                    if (offset + len <= script.length) {
                        lastDataOffset = offset;
                        lastDataLen = len;
                        offset += len;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            } else if (opcode == 0x4d) { // OP_PUSHDATA2
                if (offset + 2 <= script.length) {
                    uint256 len = uint256(uint8(script[offset])) | (uint256(uint8(script[offset + 1])) << 8);
                    offset += 2;
                    if (offset + len <= script.length) {
                        lastDataOffset = offset;
                        lastDataLen = len;
                        offset += len;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            } else {
                // Other opcodes - skip
                continue;
            }
        }
        
        // Extract the last data push found
        if (lastDataLen > 0) {
            data = _extractBytes(script, lastDataOffset, lastDataLen);
        }
    }
    
    /// @dev Extract bytes from data at specific offset and length
    /// @param data The data to extract from
    /// @param offset The starting offset
    /// @param length The number of bytes to extract
    /// @return extracted The extracted bytes
    function _extractBytes(bytes memory data, uint256 offset, uint256 length) private pure returns (bytes memory extracted) {
        if (offset + length > data.length) return extracted;
        
        extracted = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            extracted[i] = data[offset + i];
        }
    }

    /// @dev Verify payment output to specified address with expected amount
    /// @param outputVector Transaction outputs vector
    /// @param userBtcAddress The recipient Bitcoin address
    /// @param expectedAmount The expected payment amount in satoshis
    /// @return found True if payment is found
    function _verifyPaymentOutput(
        bytes memory outputVector,
        string memory userBtcAddress,
        uint64 expectedAmount
    ) private pure returns (bool found) {
        uint256 outputsCount = _parseVarInt(outputVector, 0);
        
        // Decode the Bitcoin address
        (uint8 scriptType, bytes memory expectedHash) = BitcoinAddressUtils.decodeAddress(userBtcAddress);
        
        // Ensure we got a valid result
        if (expectedHash.length == 0) return false;
        
        // Build the expected script based on address type
        bytes memory expectedScript;
        if (scriptType == 0) {
            // P2PKH: OP_DUP OP_HASH160 <20-byte-hash> OP_EQUALVERIFY OP_CHECKSIG
            expectedScript = abi.encodePacked(
                hex"76a914",
                expectedHash,
                hex"88ac"
            );
        } else if (scriptType == 1) {
            // P2SH: OP_HASH160 <20-byte-hash> OP_EQUAL
            expectedScript = abi.encodePacked(
                hex"a914",
                expectedHash,
                hex"87"
            );
        } else if (scriptType == 2) {
            // P2WPKH: OP_0 <20-byte-hash>
            expectedScript = abi.encodePacked(
                hex"0014",
                expectedHash
            );
        } else if (scriptType == 3) {
            // P2WSH: OP_0 <32-byte-hash>
            expectedScript = abi.encodePacked(
                hex"0020",
                expectedHash
            );
        } else {
            return false; // Unsupported script type
        }
        
        // Check each output
        for (uint256 i = 0; i < outputsCount; i++) {
            bytes memory output = outputVector.extractOutputAtIndex(i);
            
            // Extract value (first 8 bytes, little-endian)
            uint64 outputValue = output.extractValue();
            
            // Extract the script (skip value and script length)
            uint256 scriptLen = uint256(uint8(output[8]));
            if (output.length >= 9 + scriptLen) {
                bytes memory outputScript = new bytes(scriptLen);
                for (uint256 j = 0; j < scriptLen; j++) {
                    outputScript[j] = output[9 + j];
                }
                
                // Check if amount and script match
                if (outputValue >= expectedAmount && 
                    _compareBytes(outputScript, expectedScript)) {
                    return true;
                }
            }
        }
        
        return false;
    }

    /// @dev Convert Bitcoin address to script hash for comparison
    /// @param btcAddress The Bitcoin address
    /// @return scriptHash The corresponding script hash (empty if invalid)
    function _addressToScriptHash(string memory btcAddress) 
        private 
        pure 
        returns (bytes memory scriptHash) 
    {
        (, bytes memory hash) = BitcoinAddressUtils.decodeAddress(btcAddress);
        
        // For P2PKH and P2WPKH, we return the hash directly
        // For P2SH and P2WSH, we also return the hash directly
        return hash;
    }

    /// @dev Compare two byte arrays for equality
    /// @param a First byte array
    /// @param b Second byte array
    /// @return equal True if arrays are equal
    function _compareBytes(bytes memory a, bytes memory b) 
        private 
        pure 
        returns (bool equal) 
    {
        if (a.length != b.length) return false;
        
        for (uint256 i = 0; i < a.length; i++) {
            if (a[i] != b[i]) return false;
        }
        
        return true;
    }

    /// @dev Evaluate proof difficulty using the same logic as Bridge
    /// @dev This replicates Bridge's evaluateProofDifficulty() to maintain consistency
    ///      with production Bridge validation without requiring Bridge modifications.
    /// @param bitcoinHeaders Bitcoin headers chain being part of the SPV proof
    function _evaluateProofDifficulty(bytes memory bitcoinHeaders)
        private
        view
    {
        uint256 currentEpochDifficulty = relay.getCurrentEpochDifficulty();
        uint256 previousEpochDifficulty = relay.getPrevEpochDifficulty();

        uint256 requestedDiff = 0;
        uint256 firstHeaderDiff = bitcoinHeaders
            .extractTarget()
            .calculateDifficulty();

        if (firstHeaderDiff == currentEpochDifficulty) {
            requestedDiff = currentEpochDifficulty;
        } else if (firstHeaderDiff == previousEpochDifficulty) {
            requestedDiff = previousEpochDifficulty;
        } else {
            revert NotAtCurrentOrPreviousDifficulty();
        }

        uint256 observedDiff = bitcoinHeaders.validateHeaderChain();

        if (observedDiff == ValidateSPV.getErrBadLength()) {
            revert InvalidHeadersChainLength();
        }
        if (observedDiff == ValidateSPV.getErrInvalidChain()) {
            revert InvalidHeadersChain();
        }
        if (observedDiff == ValidateSPV.getErrLowWork()) {
            revert InsufficientWorkInHeader();
        }

        if (observedDiff < requestedDiff * txProofDifficultyFactor) {
            revert InsufficientAccumulatedDifficulty();
        }
    }

    /// @dev Parse VarInt from bytes at specified offset
    /// @param data The byte array containing the VarInt
    /// @param offset The offset to start parsing from
    /// @return value The parsed integer value
    function _parseVarInt(bytes memory data, uint256 offset) 
        private 
        pure 
        returns (uint256 value) 
    {
        uint8 firstByte = uint8(data[offset]);
        
        if (firstByte < 0xfd) {
            return firstByte;
        } else if (firstByte == 0xfd) {
            return uint16(uint8(data[offset + 1])) | (uint16(uint8(data[offset + 2])) << 8);
        } else if (firstByte == 0xfe) {
            return uint32(uint8(data[offset + 1])) | 
                   (uint32(uint8(data[offset + 2])) << 8) |
                   (uint32(uint8(data[offset + 3])) << 16) |
                   (uint32(uint8(data[offset + 4])) << 24);
        } else {
            // firstByte == 0xff - 8 byte integer
            uint256 result = 0;
            for (uint256 i = 0; i < 8; i++) {
                result |= uint256(uint8(data[offset + 1 + i])) << (i * 8);
            }
            return result;
        }
    }

    /// @dev Get the length of a VarInt encoding
    /// @param data The byte array containing the VarInt
    /// @param offset The offset of the VarInt
    /// @return length The total length including the prefix
    function _varIntLength(bytes memory data, uint256 offset) 
        private 
        pure 
        returns (uint256 length) 
    {
        uint8 firstByte = uint8(data[offset]);
        
        if (firstByte < 0xfd) {
            return 1;
        } else if (firstByte == 0xfd) {
            return 3; // 1 + 2 bytes
        } else if (firstByte == 0xfe) {
            return 5; // 1 + 4 bytes
        } else {
            return 9; // 1 + 8 bytes
        }
    }
}
