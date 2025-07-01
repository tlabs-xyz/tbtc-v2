// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../../bridge/BitcoinTx.sol";

/// @title IRedemptionPolicy
/// @dev Interface for upgradeable redemption policy contracts.
/// Core contracts delegate redemption fulfillment and default handling
/// logic to Policy contracts, enabling future upgrades without changing
/// core contract interfaces.
interface IRedemptionPolicy {
    /// @dev Enum for redemption status
    enum RedemptionStatus {
        PENDING,
        FULFILLED,
        DEFAULTED
    }

    /// @notice Request redemption of tBTC tokens
    /// @param redemptionId The unique identifier for this redemption
    /// @param qc The address of the Qualified Custodian
    /// @param user The address requesting the redemption
    /// @param amount The amount of tBTC to redeem
    /// @param btcAddress The Bitcoin address to send redeemed Bitcoin to
    /// @return success True if the redemption request was accepted
    function requestRedemption(
        bytes32 redemptionId,
        address qc,
        address user,
        uint256 amount,
        string calldata btcAddress
    ) external returns (bool success);

    /// @notice Record fulfillment of a redemption request
    /// @param redemptionId The unique identifier of the redemption
    /// @param userBtcAddress The user's Bitcoin address
    /// @param expectedAmount The expected payment amount in satoshis
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return success True if the fulfillment was successfully recorded
    function recordFulfillment(
        bytes32 redemptionId,
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external returns (bool success);

    /// @notice Flag a redemption as defaulted
    /// @param redemptionId The unique identifier of the redemption
    /// @param reason The reason for the default
    /// @return success True if the default was successfully flagged
    function flagDefault(bytes32 redemptionId, bytes32 reason)
        external
        returns (bool success);

    /// @notice Check if a redemption request is valid
    /// @param user The address requesting the redemption
    /// @param qc The address of the Qualified Custodian
    /// @param amount The amount to redeem
    /// @return valid True if the redemption request is valid
    function validateRedemptionRequest(
        address user,
        address qc,
        uint256 amount
    ) external view returns (bool valid);

    /// @notice Get redemption timeout period
    /// @return timeout The timeout period in seconds
    function getRedemptionTimeout() external view returns (uint256 timeout);

    /// @notice Get comprehensive redemption status
    /// @param redemptionId The redemption identifier
    /// @return status The status of the redemption
    function getRedemptionStatus(bytes32 redemptionId)
        external
        view
        returns (RedemptionStatus status);

    /// @notice Check if a redemption is fulfilled
    /// @param redemptionId The redemption identifier
    /// @return fulfilled True if the redemption is fulfilled
    function isRedemptionFulfilled(bytes32 redemptionId)
        external
        view
        returns (bool fulfilled);

    /// @notice Check if a redemption is defaulted
    /// @param redemptionId The redemption identifier
    /// @return defaulted True if the redemption is defaulted
    /// @return reason The reason for the default
    function isRedemptionDefaulted(bytes32 redemptionId)
        external
        view
        returns (bool defaulted, bytes32 reason);
}
