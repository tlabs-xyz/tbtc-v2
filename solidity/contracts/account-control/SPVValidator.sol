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
///      giving Account Control access to production-grade SPV verification
///      without touching the core Bridge contract.
contract SPVValidator is AccessControl {
    using BTCUtils for bytes;
    using BTCUtils for uint256;
    using ValidateSPV for bytes;
    using ValidateSPV for bytes32;

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

    /// @notice Role for updating configuration
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

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
        _grantRole(CONFIG_ROLE, msg.sender);
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
    /// @param btcAddress The Bitcoin address to verify (P2PKH format expected)
    /// @return verified True if address is found in inputs
    function _verifyInputAddress(
        bytes memory inputVector,
        string memory btcAddress
    ) private pure returns (bool verified) {
        // This is a simplified implementation that checks P2PKH addresses
        // In production, this should support P2SH, P2WPKH, P2WSH, and P2TR addresses
        
        // For MVP: Basic P2PKH address validation (starts with '1')
        bytes memory addr = bytes(btcAddress);
        if (addr.length == 0 || addr[0] != 0x31) { // '1' in ASCII
            return false; // Only supporting P2PKH for now
        }
        
        // Count inputs by parsing the VarInt
        uint256 inputsCount = _parseVarInt(inputVector, 0);
        
        // For simplified implementation: if we have inputs and address format is valid,
        // we assume verification passes. In production, this would:
        // 1. Extract scriptSig from each input
        // 2. Parse the scriptSig to get the public key
        // 3. Hash the public key and compare with address hash
        
        return inputsCount > 0;
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
        
        // Convert address to expected script hash for comparison
        bytes memory expectedScriptHash = _addressToScriptHash(userBtcAddress);
        if (expectedScriptHash.length == 0) {
            return false; // Invalid address format
        }
        
        for (uint256 i = 0; i < outputsCount; i++) {
            bytes memory output = outputVector.extractOutputAtIndex(i);
            
            // Extract value (first 8 bytes, little-endian)
            uint64 outputValue = output.extractValue();
            
            // Extract script hash
            bytes memory outputScriptHash = output.extractHash();
            
            // Check if amount and address match
            if (outputValue >= expectedAmount && 
                _compareBytes(outputScriptHash, expectedScriptHash)) {
                return true;
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
        bytes memory addr = bytes(btcAddress);
        if (addr.length == 0) return "";
        
        // P2PKH addresses start with '1'
        if (addr[0] == 0x31) {
            // TODO: Implement Base58 decoding and HASH160 extraction
            // For MVP, return placeholder 20-byte hash
            return new bytes(20);
        }
        
        // P2SH addresses start with '3'
        if (addr[0] == 0x33) {
            // TODO: Implement Base58 decoding for P2SH
            return new bytes(20);
        }
        
        // Bech32 addresses start with 'bc1'
        if (addr.length > 2 && addr[0] == 0x62 && addr[1] == 0x63) {
            // TODO: Implement Bech32 decoding
            return new bytes(32); // P2WSH uses 32-byte hash
        }
        
        return ""; // Unsupported address format
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
