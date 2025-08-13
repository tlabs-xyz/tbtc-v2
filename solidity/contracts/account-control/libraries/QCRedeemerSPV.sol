// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import {BTCUtils} from "@keep-network/bitcoin-spv-sol/contracts/BTCUtils.sol";
import {BytesLib} from "@keep-network/bitcoin-spv-sol/contracts/BytesLib.sol";
import {ValidateSPV} from "@keep-network/bitcoin-spv-sol/contracts/ValidateSPV.sol";
import "../SPVState.sol";
import "../BitcoinAddressUtils.sol";
import "../../bridge/BitcoinTx.sol";
import "../../bridge/IRelay.sol";

/// @title QCRedeemerSPV
/// @dev Library for SPV validation logic used by QCRedeemer
/// Extracts complex SPV verification functions to reduce main contract size
/// Following the proven pattern from QCManagerSPV
library QCRedeemerSPV {
    using BTCUtils for bytes;
    using BTCUtils for uint256;
    using ValidateSPV for bytes;
    using ValidateSPV for bytes32;
    using BytesLib for bytes;
    using SPVState for SPVState.Storage;
    
    // Compact error codes to save space (following QCManagerSPV pattern)
    error SPVErr(uint8 code);
    // Error codes:
    // 1: Relay not set
    // 2: Invalid input vector
    // 3: Invalid output vector
    // 4: Tx not on same level as coinbase
    // 5: Invalid merkle proof
    // 6: Invalid coinbase proof
    // 7: Empty headers
    // 8: Not at current/previous difficulty
    // 9: Invalid headers chain length
    // 10: Invalid headers chain
    // 11: Insufficient work in header
    // 12: Insufficient accumulated difficulty
    // 13: Payment verification failed
    // 14: Transaction validation failed
    // 15: Invalid Bitcoin address
    // 16: Invalid Bitcoin transaction
    
    /// @dev Validate SPV proof and return transaction hash
    /// @param spvState The SPV state storage
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return txHash The validated transaction hash
    function validateSPVProof(
        SPVState.Storage storage spvState,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external view returns (bytes32 txHash) {
        // Verify SPV state is initialized
        if (!spvState.isInitialized()) {
            revert SPVErr(1); // Relay not set
        }
        
        // Validate transaction structure
        if (!txInfo.inputVector.validateVin()) {
            revert SPVErr(2); // Invalid input vector
        }
        if (!txInfo.outputVector.validateVout()) {
            revert SPVErr(3); // Invalid output vector
        }
        
        // Validate proof structure
        if (proof.merkleProof.length != proof.coinbaseProof.length) {
            revert SPVErr(4); // Tx not on same level as coinbase
        }
        
        // Calculate transaction hash
        txHash = abi.encodePacked(
            txInfo.version,
            txInfo.inputVector,
            txInfo.outputVector,
            txInfo.locktime
        ).hash256View();
        
        // Validate merkle proof
        bytes32 root = proof.bitcoinHeaders.extractMerkleRootLE();
        
        if (!txHash.prove(root, proof.merkleProof, proof.txIndexInBlock)) {
            revert SPVErr(5); // Invalid merkle proof
        }
        
        // Validate coinbase proof
        bytes32 coinbaseHash = sha256(abi.encodePacked(proof.coinbasePreimage));
        if (!coinbaseHash.prove(root, proof.coinbaseProof, 0)) {
            revert SPVErr(6); // Invalid coinbase proof
        }
        
        // Evaluate proof difficulty
        evaluateProofDifficulty(spvState, proof.bitcoinHeaders);
        
        return txHash;
    }
    
    /// @dev Evaluate proof difficulty against relay requirements
    /// @param spvState The SPV state storage
    /// @param bitcoinHeaders Bitcoin headers chain for difficulty evaluation
    function evaluateProofDifficulty(
        SPVState.Storage storage spvState,
        bytes memory bitcoinHeaders
    ) internal view {
        if (bitcoinHeaders.length == 0) {
            revert SPVErr(7); // Empty headers
        }
        
        // Get SPV parameters
        (address relayAddress, uint96 difficultyFactor) = spvState.getParameters();
        IRelay relay = IRelay(relayAddress);
        
        // Get current and previous epoch difficulties from relay
        uint256 currentEpochDifficulty = relay.getCurrentEpochDifficulty();
        uint256 previousEpochDifficulty = relay.getPrevEpochDifficulty();
        
        // Extract difficulty from first header
        uint256 firstHeaderDiff = bitcoinHeaders.extractTarget().calculateDifficulty();
        
        // Determine which epoch we're validating against
        uint256 requestedDiff;
        if (firstHeaderDiff == currentEpochDifficulty) {
            requestedDiff = currentEpochDifficulty;
        } else if (firstHeaderDiff == previousEpochDifficulty) {
            requestedDiff = previousEpochDifficulty;
        } else {
            revert SPVErr(8); // Not at current/previous difficulty
        }
        
        // Validate the header chain and get observed difficulty
        uint256 observedDiff = bitcoinHeaders.validateHeaderChain();
        
        // Check for validation errors from ValidateSPV library
        if (observedDiff == ValidateSPV.getErrBadLength()) {
            revert SPVErr(9); // Invalid headers chain length
        }
        if (observedDiff == ValidateSPV.getErrInvalidChain()) {
            revert SPVErr(10); // Invalid headers chain
        }
        if (observedDiff == ValidateSPV.getErrLowWork()) {
            revert SPVErr(11); // Insufficient work in header
        }
        
        // Verify accumulated difficulty meets requirements
        if (observedDiff < requestedDiff * difficultyFactor) {
            revert SPVErr(12); // Insufficient accumulated difficulty
        }
    }
    
    /// @dev Verify that transaction contains expected payment to user
    /// @param userBtcAddress The user's Bitcoin address
    /// @param expectedAmount The expected payment amount in satoshis
    /// @param txInfo The Bitcoin transaction information
    /// @return valid True if payment is found and sufficient
    function verifyRedemptionPayment(
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo
    ) external pure returns (bool valid) {
        // Basic parameter validation
        if (bytes(userBtcAddress).length == 0 || expectedAmount == 0 || txInfo.outputVector.length == 0) {
            return false;
        }
        
        // Validate Bitcoin address format
        if (!isValidBitcoinAddress(userBtcAddress)) {
            return false;
        }
        
        // Find payment to user address and verify amount
        uint64 totalPayment = calculatePaymentToAddress(txInfo.outputVector, userBtcAddress);
        
        // Verify payment meets expected amount (accounting for dust threshold)
        return totalPayment >= expectedAmount && totalPayment >= 546; // Bitcoin dust threshold
    }
    
    /// @dev Calculate total payment amount to a specific Bitcoin address
    /// @param outputVector The transaction output vector
    /// @param targetAddress The Bitcoin address to find payments to
    /// @return totalAmount Total satoshis paid to the address
    function calculatePaymentToAddress(
        bytes memory outputVector, 
        string calldata targetAddress
    ) internal pure returns (uint64 totalAmount) {
        // Use Bridge pattern for parsing output vector (following Redemption.sol)
        (, uint256 outputsCount) = outputVector.parseVarInt();
        
        for (uint256 i = 0; i < outputsCount; i++) {
            // Use Bridge's proven method for extracting outputs
            bytes memory output = outputVector.extractOutputAtIndex(i);
            
            if (output.length < 8) continue;
            
            // Use Bridge's proven method for value extraction
            uint64 outputValue = output.extractValue();
            
            // Use Bridge's proven method for hash extraction  
            bytes memory outputHash = output.extractHash();
            
            // Check if this output pays to target address using Bridge patterns
            if (addressMatchesOutputHash(targetAddress, outputHash)) {
                totalAmount += outputValue;
            }
        }
        
        return totalAmount;
    }
    
    /// @dev Check if Bitcoin address matches output hash using real address decoding
    /// @param targetAddress The Bitcoin address  
    /// @param outputHash The extracted output hash from Bridge's extractHash()
    /// @return matches True if address matches the output hash
    function addressMatchesOutputHash(
        string calldata targetAddress,
        bytes memory outputHash
    ) internal pure returns (bool matches) {
        if (outputHash.length == 0) {
            return false;
        }
        
        // Use BitcoinAddressUtils to decode the target address
        (bool valid, , bytes memory decodedHash) = decodeAndValidateBitcoinAddress(targetAddress);
        
        if (!valid) {
            return false;
        }
        
        // Direct comparison - Bridge's extractHash() returns the raw hash
        // which should match our decoded address hash
        return keccak256(outputHash) == keccak256(decodedHash);
    }
    
    /// @dev Validate and decode Bitcoin address using BitcoinAddressUtils
    /// @param btcAddress The Bitcoin address to validate and decode
    /// @return valid True if address is valid
    /// @return scriptType The decoded script type (0=P2PKH, 1=P2SH, 2=P2WPKH, 3=P2WSH)
    /// @return scriptHash The decoded script hash (20 or 32 bytes)
    function decodeAndValidateBitcoinAddress(
        string calldata btcAddress
    ) internal pure returns (bool valid, uint8 scriptType, bytes memory scriptHash) {
        // Check basic length requirements before attempting decode
        bytes memory addr = bytes(btcAddress);
        if (addr.length == 0 || addr.length < 14 || addr.length > 74) {
            return (false, 0, new bytes(0));
        }
        
        // BitcoinAddressUtils.decodeAddress will revert on invalid addresses
        // Since we can't use try-catch with library functions, we'll use the
        // validation from isValidBitcoinAddress pattern
        
        // First check if it's a valid format
        bool firstCharValid = (addr[0] == 0x31 || // '1' - P2PKH
                               addr[0] == 0x33 || // '3' - P2SH
                               (addr[0] == 0x62 && addr.length > 1 && addr[1] == 0x63)); // 'bc' - Bech32
        
        if (!firstCharValid) {
            return (false, 0, new bytes(0));
        }
        
        // Now we can safely decode
        (uint8 decodedScriptType, bytes memory decodedScriptHash) = BitcoinAddressUtils.decodeAddress(btcAddress);
        return (true, decodedScriptType, decodedScriptHash);
    }
    
    /// @dev Legacy validation function - now uses real address decoding  
    /// @param btcAddress The Bitcoin address to validate
    /// @return valid True if address format is valid
    function isValidBitcoinAddress(string calldata btcAddress) internal pure returns (bool valid) {
        (bool isValid, , ) = decodeAndValidateBitcoinAddress(btcAddress);
        return isValid;
    }
    
    /// @dev Validate redemption-specific transaction requirements
    /// @param redemptionStatus The current redemption status
    /// @param txInfo The Bitcoin transaction information
    /// @return valid True if transaction meets redemption requirements
    function validateRedemptionTransaction(
        uint8 redemptionStatus,
        BitcoinTx.Info calldata txInfo
    ) external view returns (bool valid) {
        // Basic validation - ensure required parameters are present
        if (txInfo.inputVector.length == 0) {
            return false;
        }
        
        // Status must be Pending (1) for validation
        if (redemptionStatus != 1) {
            return false;
        }
        
        // 1. Validate transaction has outputs (can't redeem without outputs)
        (, uint256 outputCount) = txInfo.outputVector.parseVarInt();
        if (outputCount == 0) {
            return false;
        }
        
        // 2. Validate transaction has inputs (must have funding sources)
        (, uint256 inputCount) = txInfo.inputVector.parseVarInt();
        if (inputCount == 0) {
            return false;
        }
        
        // 3. Validate transaction is not too large (prevent DoS attacks)
        uint256 totalTxSize = txInfo.inputVector.length + txInfo.outputVector.length + 12; // version(4) + locktime(4) + 2 varint bytes + 2 varint bytes
        if (totalTxSize > 100000) { // 100KB max transaction size (standard Bitcoin limit)
            return false;
        }
        
        // 4. Basic fee structure validation - ensure transaction has reasonable structure
        // A legitimate redemption should have at least 1 input and 1 output to user
        // Additional outputs for change/fees are acceptable
        if (outputCount > 10) { // Prevent transactions with excessive outputs
            return false;
        }
        
        // 5. Validate locktime is reasonable (anti-replay protection)
        // Locktime should either be 0 (immediate) or within reasonable bounds
        uint32 locktimeValue = BTCUtils.reverseUint32(uint32(txInfo.locktime));
        if (locktimeValue > block.timestamp + 86400) { // No more than 1 day in future
            return false;
        }
        
        // 6. Validate transaction version (Bitcoin standard versions)
        uint32 versionValue = BTCUtils.reverseUint32(uint32(txInfo.version));
        if (versionValue < 1 || versionValue > 2) {
            return false;
        }
        
        return true;
    }
}