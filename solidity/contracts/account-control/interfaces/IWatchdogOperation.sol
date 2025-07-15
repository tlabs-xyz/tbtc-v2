// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../../bridge/BitcoinTx.sol";
import "../QCData.sol";

/// @title IWatchdogOperation
/// @notice Interface for watchdog operation execution logic
/// @dev This interface defines how different operation types are executed
///      after consensus is reached in the OptimisticWatchdogConsensus system
interface IWatchdogOperation {
    // =================== OPERATION EXECUTION ===================

    /// @notice Execute a reserve attestation operation
    /// @param qc The QC address
    /// @param balance The attested balance
    function executeReserveAttestation(
        address qc,
        uint256 balance
    ) external;

    /// @notice Execute a wallet registration operation
    /// @param qc The QC address
    /// @param btcAddress The Bitcoin address to register
    /// @param challengeHash The challenge hash for verification
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction
    function executeWalletRegistration(
        address qc,
        string calldata btcAddress,
        bytes32 challengeHash,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external;

    /// @notice Execute a QC status change operation
    /// @param qc The QC address
    /// @param newStatus The new status to set
    /// @param reason The reason for status change
    function executeStatusChange(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason
    ) external;

    /// @notice Execute a redemption fulfillment operation
    /// @param redemptionId The redemption identifier
    /// @param userBtcAddress The user's Bitcoin address
    /// @param expectedAmount The expected payment amount
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction
    function executeRedemptionFulfillment(
        bytes32 redemptionId,
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external;

    /// @notice Execute a redemption default operation
    /// @param redemptionId The redemption identifier
    /// @param reason The reason for default
    function executeRedemptionDefault(
        bytes32 redemptionId,
        bytes32 reason
    ) external;

    // =================== OPERATION ENCODING ===================

    /// @notice Encode reserve attestation parameters
    /// @param qc The QC address
    /// @param balance The balance to attest
    /// @return encoded The encoded operation data
    function encodeReserveAttestation(
        address qc,
        uint256 balance
    ) external pure returns (bytes memory encoded);

    /// @notice Encode wallet registration parameters
    /// @param qc The QC address
    /// @param btcAddress The Bitcoin address
    /// @param challengeHash The challenge hash
    /// @param txInfo Transaction information
    /// @param proof SPV proof
    /// @return encoded The encoded operation data
    function encodeWalletRegistration(
        address qc,
        string calldata btcAddress,
        bytes32 challengeHash,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external pure returns (bytes memory encoded);

    /// @notice Encode status change parameters
    /// @param qc The QC address
    /// @param newStatus The new status
    /// @param reason The reason
    /// @return encoded The encoded operation data
    function encodeStatusChange(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason
    ) external pure returns (bytes memory encoded);

    /// @notice Encode redemption fulfillment parameters
    /// @param redemptionId The redemption ID
    /// @param userBtcAddress User's Bitcoin address
    /// @param expectedAmount Expected amount
    /// @param txInfo Transaction information
    /// @param proof SPV proof
    /// @return encoded The encoded operation data
    function encodeRedemptionFulfillment(
        bytes32 redemptionId,
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external pure returns (bytes memory encoded);

    /// @notice Encode redemption default parameters
    /// @param redemptionId The redemption ID
    /// @param reason The reason for default
    /// @return encoded The encoded operation data
    function encodeRedemptionDefault(
        bytes32 redemptionId,
        bytes32 reason
    ) external pure returns (bytes memory encoded);

    // =================== OPERATION DECODING ===================

    /// @notice Decode reserve attestation parameters
    /// @param data The encoded operation data
    /// @return qc The QC address
    /// @return balance The balance
    function decodeReserveAttestation(bytes calldata data)
        external
        pure
        returns (address qc, uint256 balance);

    /// @notice Decode wallet registration parameters
    /// @param data The encoded operation data
    /// @return qc The QC address
    /// @return btcAddress The Bitcoin address
    /// @return challengeHash The challenge hash
    /// @return txInfo Transaction information
    /// @return proof SPV proof
    function decodeWalletRegistration(bytes calldata data)
        external
        pure
        returns (
            address qc,
            string memory btcAddress,
            bytes32 challengeHash,
            BitcoinTx.Info memory txInfo,
            BitcoinTx.Proof memory proof
        );

    /// @notice Decode status change parameters
    /// @param data The encoded operation data
    /// @return qc The QC address
    /// @return newStatus The new status
    /// @return reason The reason
    function decodeStatusChange(bytes calldata data)
        external
        pure
        returns (
            address qc,
            QCData.QCStatus newStatus,
            bytes32 reason
        );

    /// @notice Decode redemption fulfillment parameters
    /// @param data The encoded operation data
    /// @return redemptionId The redemption ID
    /// @return userBtcAddress User's Bitcoin address
    /// @return expectedAmount Expected amount
    /// @return txInfo Transaction information
    /// @return proof SPV proof
    function decodeRedemptionFulfillment(bytes calldata data)
        external
        pure
        returns (
            bytes32 redemptionId,
            string memory userBtcAddress,
            uint64 expectedAmount,
            BitcoinTx.Info memory txInfo,
            BitcoinTx.Proof memory proof
        );

    /// @notice Decode redemption default parameters
    /// @param data The encoded operation data
    /// @return redemptionId The redemption ID
    /// @return reason The reason
    function decodeRedemptionDefault(bytes calldata data)
        external
        pure
        returns (bytes32 redemptionId, bytes32 reason);
}