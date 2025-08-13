// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import {BTCUtils} from "@keep-network/bitcoin-spv-sol/contracts/BTCUtils.sol";
import {BytesLib} from "@keep-network/bitcoin-spv-sol/contracts/BytesLib.sol";
import {ValidateSPV} from "@keep-network/bitcoin-spv-sol/contracts/ValidateSPV.sol";
import "../SPVState.sol";
import "../BitcoinAddressUtils.sol";
import "../../bridge/BitcoinTx.sol";
import "../../bridge/IRelay.sol";

/// @title SharedSPVCore
/// @dev Shared SPV validation logic used by both QCManager and QCRedeemer
/// Extracts common SPV functionality to eliminate code duplication
library SharedSPVCore {
    using BTCUtils for bytes;
    using BTCUtils for uint256;
    using ValidateSPV for bytes;
    using ValidateSPV for bytes32;
    using BytesLib for bytes;
    using SPVState for SPVState.Storage;
    
    // Compact error codes to save space
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
    
    /// @dev Validate core SPV proof components
    /// @param spvState The SPV state storage
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return txHash The validated transaction hash
    function validateCoreSPVProof(
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
    
    /// @dev Validate Bitcoin address format (basic validation)
    /// @param btcAddress The Bitcoin address to validate
    /// @return valid True if address format is valid
    function isValidBitcoinAddress(string calldata btcAddress) external pure returns (bool valid) {
        bytes memory addr = bytes(btcAddress);
        if (addr.length == 0 || addr.length < 14 || addr.length > 74) {
            return false;
        }
        
        // Basic format validation
        return (addr[0] == 0x31 || // '1' - P2PKH
                addr[0] == 0x33 || // '3' - P2SH  
                (addr[0] == 0x62 && addr.length > 1 && addr[1] == 0x63)); // 'bc' - Bech32
    }
    
    /// @dev Decode and validate Bitcoin address using BitcoinAddressUtils
    /// @param btcAddress The Bitcoin address to validate and decode
    /// @return valid True if address is valid
    /// @return scriptType The decoded script type (0=P2PKH, 1=P2SH, 2=P2WPKH, 3=P2WSH)
    /// @return scriptHash The decoded script hash (20 or 32 bytes)
    function decodeAndValidateBitcoinAddress(
        string calldata btcAddress
    ) external pure returns (bool valid, uint8 scriptType, bytes memory scriptHash) {
        // Check basic length requirements before attempting decode
        bytes memory addr = bytes(btcAddress);
        if (addr.length == 0 || addr.length < 14 || addr.length > 74) {
            return (false, 0, new bytes(0));
        }
        
        // Basic format validation
        bool validFormat = (addr[0] == 0x31 || // '1' - P2PKH
                           addr[0] == 0x33 || // '3' - P2SH  
                           (addr[0] == 0x62 && addr.length > 1 && addr[1] == 0x63)); // 'bc' - Bech32
        
        if (!validFormat) {
            return (false, 0, new bytes(0));
        }
        
        // Decode using BitcoinAddressUtils
        (uint8 decodedScriptType, bytes memory decodedScriptHash) = 
            BitcoinAddressUtils.decodeAddress(btcAddress);
        
        return (true, decodedScriptType, decodedScriptHash);
    }
}