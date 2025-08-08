// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../account-control/interfaces/ISPVValidator.sol";
import "../bridge/BitcoinTx.sol";

/// @title MockSPVValidator
/// @notice Mock SPV validator for gas benchmarking tests
contract MockSPVValidator is ISPVValidator {
    bool public mockValidation = true;
    
    function setMockValidation(bool _valid) external {
        mockValidation = _valid;
    }
    
    function validateProof(
        BitcoinTx.Info calldata,
        BitcoinTx.Proof calldata
    ) external view override returns (bytes32 txHash) {
        return bytes32(uint256(1));
    }
    
    function verifyWalletControl(
        address,
        string calldata,
        bytes32,
        BitcoinTx.Info calldata,
        BitcoinTx.Proof calldata
    ) external view override returns (bool verified) {
        return mockValidation;
    }
    
    function verifyRedemptionFulfillment(
        bytes32,
        string calldata,
        uint64,
        BitcoinTx.Info calldata,
        BitcoinTx.Proof calldata
    ) external view override returns (bool verified) {
        return mockValidation;
    }
    
    function validateSPVProof(
        bytes memory,
        uint256,
        bytes memory,
        bytes memory,
        uint256
    ) external view returns (bool) {
        return mockValidation;
    }
}