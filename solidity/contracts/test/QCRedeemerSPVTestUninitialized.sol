// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../account-control/libraries/QCRedeemerSPV.sol";
import "../account-control/libraries/SharedSPVCore.sol";
import "../account-control/SPVState.sol";
import "../bridge/BitcoinTx.sol";
import "../bridge/IRelay.sol";

/// @title QCRedeemerSPVTestUninitialized
/// @dev Test contract for testing SPV functions with uninitialized SPV state
/// Allows testing of SPVErr(1) error case when relay is not set
contract QCRedeemerSPVTestUninitialized {
    using SPVState for SPVState.Storage;
    
    SPVState.Storage internal spvState;
    
    // Constructor does not initialize SPV state
    constructor() {
        // Intentionally left empty to test uninitialized state
    }
    
    /// @dev Wrapper for validateSPVProof to test SPVErr(1)
    function validateSPVProof(
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external view returns (bytes32 txHash) {
        return QCRedeemerSPV.validateSPVProof(spvState, txInfo, proof);
    }
    
    /// @dev Check if SPV is initialized
    function isInitialized() external view returns (bool) {
        return spvState.isInitialized();
    }
}