// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../../bridge/BitcoinTx.sol";

/// @title SPV Validator Interface
/// @notice Interface for Bitcoin SPV proof validation in Account Control system
/// @dev This interface provides SPV validation capabilities without requiring
///      modifications to the production Bridge contract. The implementation
///      replicates Bridge's proven SPV logic while offering a clean interface
///      tailored for Account Control system needs.
interface ISPVValidator {
    /// @notice Validate SPV proof using the same logic as Bridge
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof data
    /// @return txHash Verified transaction hash
    function validateProof(
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external view returns (bytes32 txHash);

    /// @notice Verify wallet control via OP_RETURN challenge
    /// @param qc The QC address claiming wallet control
    /// @param btcAddress The Bitcoin address being claimed
    /// @param challenge The expected challenge string
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return verified True if wallet control is verified
    function verifyWalletControl(
        address qc,
        string calldata btcAddress,
        bytes32 challenge,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external view returns (bool verified);

    /// @notice Verify redemption fulfillment payment
    /// @param redemptionId The redemption identifier
    /// @param userBtcAddress The user's Bitcoin address
    /// @param expectedAmount The expected payment amount in satoshis
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return verified True if redemption is fulfilled
    function verifyRedemptionFulfillment(
        bytes32 redemptionId,
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external view returns (bool verified);
}
