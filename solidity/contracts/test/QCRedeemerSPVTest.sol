// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../account-control/libraries/QCRedeemerSPV.sol";
import "../account-control/libraries/SharedSPVCore.sol";
import "../account-control/SPVState.sol";
import "../bridge/BitcoinTx.sol";
import "../bridge/IRelay.sol";

/// @title QCRedeemerSPVTest
/// @dev Test contract wrapper for QCRedeemerSPV library functions
/// Allows direct testing of library functions by exposing them as external functions
contract QCRedeemerSPVTest {
    using SPVState for SPVState.Storage;
    
    SPVState.Storage internal spvState;
    
    constructor(address _relay, uint96 _txProofDifficultyFactor) {
        spvState.initialize(_relay, _txProofDifficultyFactor);
    }
    
    /// @dev Wrapper for validateSPVProof
    function validateSPVProof(
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external view returns (bytes32 txHash) {
        return QCRedeemerSPV.validateSPVProof(spvState, txInfo, proof);
    }
    
    /// @dev Wrapper for evaluateProofDifficulty (now in SharedSPVCore)
    function testEvaluateProofDifficulty(
        bytes memory bitcoinHeaders
    ) external view {
        SharedSPVCore.evaluateProofDifficulty(spvState, bitcoinHeaders);
    }
    
    /// @dev Wrapper for verifyRedemptionPayment
    function verifyRedemptionPayment(
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo
    ) external pure returns (bool valid) {
        return QCRedeemerSPV.verifyRedemptionPayment(userBtcAddress, expectedAmount, txInfo);
    }
    
    /// @dev Wrapper for validateRedemptionTransaction
    function validateRedemptionTransaction(
        uint8 redemptionStatus,
        BitcoinTx.Info calldata txInfo
    ) external view returns (bool valid) {
        return QCRedeemerSPV.validateRedemptionTransaction(redemptionStatus, txInfo);
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
    
    /// @dev Wrapper for calculatePaymentToAddress (internal function test)
    function testCalculatePaymentToAddress(
        bytes memory outputVector, 
        string calldata targetAddress
    ) external pure returns (uint64 totalAmount) {
        return QCRedeemerSPV.calculatePaymentToAddress(outputVector, targetAddress);
    }
    
    /// @dev Wrapper for addressMatchesOutputHash (internal function test)
    function testAddressMatchesOutputHash(
        string calldata targetAddress,
        bytes memory outputHash
    ) external pure returns (bool matches) {
        return QCRedeemerSPV.addressMatchesOutputHash(targetAddress, outputHash);
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