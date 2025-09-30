// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import {BTCUtils} from "@keep-network/bitcoin-spv-sol/contracts/BTCUtils.sol";
import {ValidateSPV} from "@keep-network/bitcoin-spv-sol/contracts/ValidateSPV.sol";
import "../bridge/IRelay.sol";

/// @notice Test relay contract for SPV testing
/// @dev Extends SystemTestRelay functionality with additional test methods
/// TODO: This contract bypasses actual SPV validation for testing purposes.
///       In production, proper SPV validation through a real relay is critical
///       for security. The bypassSPVValidation flag should never exist in production code.
contract TestRelay is IRelay {
    using BTCUtils for bytes;
    using BTCUtils for uint256;

    uint256 private currentEpochDifficulty;
    uint256 private prevEpochDifficulty;
    uint256 private validateHeaderChainResult;
    bool private bypassSPVValidation;

    function setCurrentEpochDifficulty(uint256 _difficulty) external {
        currentEpochDifficulty = _difficulty;
    }

    function setPrevEpochDifficulty(uint256 _difficulty) external {
        prevEpochDifficulty = _difficulty;
    }

    function setCurrentEpochDifficultyFromHeaders(bytes memory bitcoinHeaders)
        external
    {
        uint256 firstHeaderDiff = bitcoinHeaders
            .extractTarget()
            .calculateDifficulty();

        currentEpochDifficulty = firstHeaderDiff;
    }

    function setPrevEpochDifficultyFromHeaders(bytes memory bitcoinHeaders)
        external
    {
        uint256 firstHeaderDiff = bitcoinHeaders
            .extractTarget()
            .calculateDifficulty();

        prevEpochDifficulty = firstHeaderDiff;
    }

    function getCurrentEpochDifficulty()
        external
        view
        override
        returns (uint256)
    {
        return currentEpochDifficulty;
    }

    function getPrevEpochDifficulty() external view override returns (uint256) {
        return prevEpochDifficulty;
    }

    /// @dev Set the result that validateHeaderChain should return for testing
    /// @param _result The result to return (normal difficulty or error codes)
    function setValidateHeaderChainResult(uint256 _result) external {
        validateHeaderChainResult = _result;
    }
    
    /// @dev Enable or disable SPV validation bypass for testing
    /// @param _bypass True to bypass validation, false to use normal validation
    function setBypassSPVValidation(bool _bypass) external {
        bypassSPVValidation = _bypass;
    }

    /// @dev Mock implementation of header chain validation
    /// @return The set result for testing purposes
    function validateHeaderChain(bytes memory) external view returns (uint256) {
        return validateHeaderChainResult;
    }
}