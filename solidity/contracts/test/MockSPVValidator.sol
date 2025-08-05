// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title MockSPVValidator
/// @notice Mock SPV validator for gas benchmarking tests
contract MockSPVValidator {
    bool public mockValidation = true;
    
    function setMockValidation(bool _valid) external {
        mockValidation = _valid;
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