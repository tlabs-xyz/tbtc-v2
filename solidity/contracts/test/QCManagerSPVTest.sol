// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../account-control/libraries/QCManagerSPV.sol";
import "../account-control/libraries/SharedSPVCore.sol";
import "../account-control/SPVState.sol";
import "../bridge/BitcoinTx.sol";
import "../bridge/IRelay.sol";

/// @title QCManagerSPVTest
/// @dev Test contract wrapper for QCManagerSPV library functions
/// Allows direct testing of library functions by exposing them as external functions
contract QCManagerSPVTest {
    using SPVState for SPVState.Storage;
    
    SPVState.Storage internal spvState;
    
    constructor(address _relay, uint96 _txProofDifficultyFactor) {
        spvState.initialize(_relay, _txProofDifficultyFactor);
    }
    
    /// @dev Wrapper for verifyWalletControl
    function verifyWalletControl(
        string calldata btcAddress,
        bytes32 challenge,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external view returns (bool verified) {
        return QCManagerSPV.verifyWalletControl(spvState, btcAddress, challenge, txInfo, proof);
    }
    
    /// @dev Wrapper for validateSPVProof (delegates to SharedSPVCore)
    function validateSPVProof(
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external view returns (bytes32 txHash) {
        return SharedSPVCore.validateCoreSPVProof(spvState, txInfo, proof);
    }
    
    /// @dev Wrapper for evaluateProofDifficulty (now in SharedSPVCore)
    function testEvaluateProofDifficulty(
        bytes memory bitcoinHeaders
    ) external view {
        SharedSPVCore.evaluateProofDifficulty(spvState, bitcoinHeaders);
    }
    
    /// @dev Wrapper for validateWalletControlProof
    function validateWalletControlProof(
        string calldata btcAddress,
        bytes32 challenge,
        BitcoinTx.Info calldata txInfo
    ) external pure returns (bool valid) {
        return QCManagerSPV.validateWalletControlProof(btcAddress, challenge, txInfo);
    }
    
    /// @dev Wrapper for findChallengeInOpReturn
    function findChallengeInOpReturn(
        bytes memory outputVector,
        bytes32 challenge
    ) external pure returns (bool found) {
        return QCManagerSPV.findChallengeInOpReturn(outputVector, challenge);
    }
    
    /// @dev Wrapper for verifyTransactionSignature
    function verifyTransactionSignature(
        string calldata btcAddress,
        BitcoinTx.Info calldata txInfo
    ) external pure returns (bool valid) {
        return QCManagerSPV.verifyTransactionSignature(btcAddress, txInfo);
    }
    
    /// @dev Wrapper for isValidBitcoinAddress (now in SharedSPVCore)
    function isValidBitcoinAddress(string calldata btcAddress) 
        external 
        pure 
        returns (bool valid) 
    {
        return SharedSPVCore.isValidBitcoinAddress(btcAddress);
    }
    
    /// @dev Wrapper for decodeAndValidateBitcoinAddress (now in SharedSPVCore)
    function decodeAndValidateBitcoinAddress(string calldata btcAddress)
        external
        pure
        returns (bool valid, uint8 scriptType, bytes memory scriptHash)
    {
        return SharedSPVCore.decodeAndValidateBitcoinAddress(btcAddress);
    }
    
    /// @dev Get SPV state for testing
    function getSPVState() external view returns (
        address relay,
        uint96 difficultyFactor,
        bool isInitialized
    ) {
        (relay, difficultyFactor) = spvState.getParameters();
        isInitialized = spvState.isInitialized();
    }
}