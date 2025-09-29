// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import {BTCUtils} from "@keep-network/bitcoin-spv-sol/contracts/BTCUtils.sol";
import {BytesLib} from "@keep-network/bitcoin-spv-sol/contracts/BytesLib.sol";
import "../SPVState.sol";
import "../../bridge/BitcoinTx.sol";
import {SharedSPVCore} from "./SharedSPVCore.sol";

/// @title QCRedeemerSPV
/// @dev Library for redemption-specific SPV validation logic used by QCRedeemer
/// Specialized logic for payment verification, uses SharedSPVCore for common operations
library QCRedeemerSPV {
    using BTCUtils for bytes;
    using BytesLib for bytes;
    using SPVState for SPVState.Storage;
    
    // Redemption specific error codes
    error RedemptionErr(uint8 code);
    // Error codes:
    // 1: Payment verification failed
    // 2: Transaction validation failed
    // 3: Invalid Bitcoin address
    // 4: Invalid Bitcoin transaction
    
    /// @dev Validate SPV proof and return transaction hash
    /// @param spvState The SPV state storage
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return txHash The validated transaction hash
    function validateSPVProof(
        SPVState.Storage storage spvState,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) internal view returns (bytes32 txHash) {
        // Use shared core SPV validation
        // Note: SharedSPVCore.validateCoreSPVProof may throw SPVErr errors
        // For now, we let them propagate through. The calling function in QCRedeemer
        // should handle the error conversion to maintain test compatibility.
        return SharedSPVCore.validateCoreSPVProof(spvState, txInfo, proof);
    }
    
    /// @dev Safe wrapper for SPV validation that returns success status
    /// @param spvState The SPV state storage
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return success True if validation passed
    /// @return txHash The validated transaction hash (0x0 if failed)
    function validateSPVProofSafe(
        SPVState.Storage storage spvState,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) internal view returns (bool success, bytes32 txHash) {
        // Check basic requirements first to avoid reverts
        if (!spvState.isInitialized()) {
            return (false, bytes32(0));
        }
        
        // Check input/output vector lengths
        if (txInfo.inputVector.length < 5 || txInfo.outputVector.length < 9) {
            return (false, bytes32(0));
        }
        
        // Check proof structure
        if (proof.merkleProof.length == 0 || 
            proof.bitcoinHeaders.length < 80 ||
            proof.merkleProof.length != proof.coinbaseProof.length) {
            return (false, bytes32(0));
        }
        
        // If basic checks pass, attempt full validation
        // Wrap in try-catch to handle SPVErr errors from SharedSPVCore
        try SharedSPVCore.validateCoreSPVProof(spvState, txInfo, proof) returns (bytes32 validatedTxHash) {
            return (true, validatedTxHash);
        } catch {
            // Catch any SPVErr or other errors and return false
            return (false, bytes32(0));
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
        if (!SharedSPVCore.isValidBitcoinAddress(userBtcAddress)) {
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

            if (output.length < 9) continue; // Need at least 9 bytes for valid output

            // Use Bridge's proven method for value extraction
            uint64 outputValue = output.extractValue();

            // Use Bridge's proven method for hash extraction
            bytes memory outputHash = output.extractHash();
            if (outputHash.length == 0) continue; // Skip invalid scripts

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
        
        // Use SharedSPVCore to decode the target address
        (bool valid, , bytes memory decodedHash) = SharedSPVCore.decodeAndValidateBitcoinAddress(targetAddress);
        
        if (!valid) {
            return false;
        }
        
        // Direct comparison - Bridge's extractHash() returns the raw hash
        // which should match our decoded address hash
        return keccak256(outputHash) == keccak256(decodedHash);
    }
    
    
    /// @dev Validate redemption-specific transaction requirements
    /// @param redemptionStatus The current redemption status
    /// @param txInfo The Bitcoin transaction information
    /// @return valid True if transaction meets redemption requirements
    function validateRedemptionTransaction(
        uint8 redemptionStatus,
        BitcoinTx.Info memory txInfo
    ) public view returns (bool valid) {
        
        // Status must be Pending (1) for validation
        if (redemptionStatus != 1) {
            return false;
        }
        
        // Basic validation - ensure required parameters are present
        if (txInfo.inputVector.length == 0) {
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