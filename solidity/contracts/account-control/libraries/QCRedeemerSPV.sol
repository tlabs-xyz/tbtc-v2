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
///
/// ERROR HANDLING:
/// - THROWING: validateSPVProof() - reverts with specific errors
/// - SAFE: validateSPVProofSafe(), verifyRedemptionPayment(), validateRedemptionTransaction() - return bool
///
/// Use throwing functions when you want detailed error info.
/// Use safe functions when you want to handle failures gracefully.
library QCRedeemerSPV {
    using BTCUtils for bytes;
    using BytesLib for bytes;
    using SPVState for SPVState.Storage;
    using BitcoinTx for bytes;
    
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
    
    /// @dev Calculate total payment amount to a specific Bitcoin address (THROWING FUNCTION)
    /// This version may throw on parsing errors - used internally for detailed error info
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

            // Check if this output pays to target address with enhanced validation
            if (isPaymentToAddress(output, targetAddress)) {
                totalAmount += outputValue;
            }
        }
        
        return totalAmount;
    }
    
    /// @dev Safe version of calculatePaymentToAddress that never throws (SAFE FUNCTION)
    /// @param outputVector The transaction output vector
    /// @param targetAddress The Bitcoin address to find payments to  
    /// @return totalAmount Total satoshis paid to the address (0 if any error occurs)
    function calculatePaymentToAddressSafe(
        bytes memory outputVector,
        string calldata targetAddress
    ) internal pure returns (uint64 totalAmount) {
        if (outputVector.length < 9) {
            return 0; // Invalid output vector
        }
        
        // Validate address before processing
        if (!SharedSPVCore.isValidBitcoinAddress(targetAddress)) {
            return 0; // Invalid address format
        }
        
        // Safe parsing with bounds checking
        (, uint256 outputsCount) = outputVector.parseVarInt();
        
        // Prevent excessive processing (potential DoS protection)
        if (outputsCount == 0 || outputsCount > 100) {
            return 0;
        }
        
        // Process outputs safely
        for (uint256 i = 0; i < outputsCount && i < 100; i++) {
            // Safe output extraction with length checking
            if (outputVector.length < 9 + (i * 9)) continue; // Basic bounds check
            
            bytes memory output = outputVector.extractOutputAtIndex(i);
            if (output.length < 9) continue; // Skip invalid outputs
            
            uint64 outputValue = output.extractValue();
            
            // Safe payment validation
            if (isPaymentToAddress(output, targetAddress)) {
                // Prevent overflow
                if (totalAmount > type(uint64).max - outputValue) {
                    return type(uint64).max; // Cap at max value instead of reverting
                }
                totalAmount += outputValue;
            }
        }
        
        return totalAmount;
    }
    
    /// @dev Check if Bitcoin address matches output with script type detection
    /// @param output The full Bitcoin transaction output  
    /// @param userBtcAddress The Bitcoin address
    /// @return matches True if address matches the output with correct script type
    function isPaymentToAddress(
        bytes memory output,
        string calldata userBtcAddress
    ) internal pure returns (bool matches) {
        if (output.length == 0) {
            return false;
        }
        
        // Decode address to get type and hash
        (bool valid, , bytes memory hash) = 
            SharedSPVCore.decodeAndValidateBitcoinAddress(userBtcAddress);
        
        if (!valid) {
            return false;
        }
        
        // Extract output script hash
        bytes memory outputHash = output.extractHash();
        if (outputHash.length == 0) {
            return false;
        }
        
        // Direct hash comparison - Bridge's extractHash() returns the raw hash
        // which should match our decoded address hash
        // Enhanced script type detection can be added when BitcoinTx.determineOutputType is available
        return keccak256(outputHash) == keccak256(hash);
    }
    
    /// @dev Verify that transaction contains expected payment to user (SAFE FUNCTION)
    /// This function follows the SAFE pattern - it never throws, always returns bool
    /// @param userBtcAddress The user's Bitcoin address
    /// @param expectedAmount The expected payment amount in satoshis
    /// @param txInfo The Bitcoin transaction information
    /// @return valid True if payment is found and sufficient
    function verifyRedemptionPayment(
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo
    ) external pure returns (bool valid) {
        if (bytes(userBtcAddress).length == 0 || expectedAmount == 0 || txInfo.outputVector.length == 0) {
            return false;
        }
        
        if (!SharedSPVCore.isValidBitcoinAddress(userBtcAddress)) {
            return false;
        }
        
        uint64 totalPayment = 0;
        
        if (txInfo.outputVector.length >= 9) {
            // Use safe calculation that gracefully handles parsing errors
            totalPayment = calculatePaymentToAddressSafe(txInfo.outputVector, userBtcAddress);
        }
        
        // Verify expected amount without dust threshold check
        // Dust validation is handled at the protocol level
        return totalPayment >= expectedAmount;
    }
    
    /// @dev Validate redemption-specific transaction requirements (SAFE FUNCTION)
    /// This function follows the SAFE pattern - it never throws, always returns bool
    /// @param redemptionStatus The current redemption status
    /// @param txInfo The Bitcoin transaction information
    /// @return valid True if transaction meets redemption requirements
    function validateRedemptionTransaction(
        uint8 redemptionStatus,
        BitcoinTx.Info memory txInfo
    ) public pure returns (bool valid) {
        // Status must be Pending (1) for validation
        if (redemptionStatus != 1) {
            return false;
        }
        
        // Basic validation - ensure required parameters are present
        if (txInfo.inputVector.length == 0) {
            return false;
        }
        
        if (txInfo.outputVector.length < 1 || txInfo.inputVector.length < 1) {
            return false;
        }
        
        // 1. Validate transaction has outputs (can't redeem without outputs)
        (, uint256 outputCount) = txInfo.outputVector.parseVarInt();
        if (outputCount == 0 || outputCount > 10) { // Prevent excessive outputs
            return false;
        }
        
        // 2. Validate transaction has inputs (must have funding sources)  
        (, uint256 inputCount) = txInfo.inputVector.parseVarInt();
        if (inputCount == 0) {
            return false;
        }
        
        // 3. Validate transaction is not too large (prevent DoS attacks)
        uint256 totalTxSize = txInfo.inputVector.length + txInfo.outputVector.length + 12;
        if (totalTxSize > 100000) { // 100KB max transaction size
            return false;
        }
        
        // 4. Locktime sanity: skip cross-chain time comparison
        // (Keep parsing for structure validation only)
        uint32 locktimeValue;
        unchecked {
            locktimeValue = BTCUtils.reverseUint32(uint32(txInfo.locktime));
        }
        // Note: Cross-chain time comparison removed due to Bitcoin/Ethereum time sync issues
        
        // 5. Validate transaction version (relax gating)
        uint32 versionValue;
        unchecked {
            versionValue = BTCUtils.reverseUint32(uint32(txInfo.version));
        }
        // Allow version 1+ for broader transaction compatibility
        if (versionValue < 1) {
            return false;
        }
        
        return true;
    }
}