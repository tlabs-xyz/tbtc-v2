// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "./interfaces/IWatchdogOperation.sol";
import "../bridge/BitcoinTx.sol";
import "./QCData.sol";

/// @title WatchdogOperationLib
/// @notice Library for encoding and decoding watchdog operations
/// @dev This library provides helper functions for v1.1 watchdog consensus operations
library WatchdogOperationLib {
    // =================== ENCODING FUNCTIONS ===================
    
    /// @notice Encode reserve attestation parameters
    function encodeReserveAttestation(
        address qc,
        uint256 balance
    ) internal pure returns (bytes memory) {
        return abi.encode(qc, balance);
    }
    
    /// @notice Encode wallet registration parameters
    function encodeWalletRegistration(
        address qc,
        string calldata btcAddress,
        bytes32 challengeHash,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) internal pure returns (bytes memory) {
        return abi.encode(qc, btcAddress, challengeHash, txInfo, proof);
    }
    
    /// @notice Encode status change parameters
    function encodeStatusChange(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason
    ) internal pure returns (bytes memory) {
        return abi.encode(qc, newStatus, reason);
    }
    
    /// @notice Encode redemption fulfillment parameters
    function encodeRedemptionFulfillment(
        bytes32 redemptionId,
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) internal pure returns (bytes memory) {
        return abi.encode(redemptionId, userBtcAddress, expectedAmount, txInfo, proof);
    }
    
    /// @notice Encode redemption default parameters
    function encodeRedemptionDefault(
        bytes32 redemptionId,
        bytes32 reason
    ) internal pure returns (bytes memory) {
        return abi.encode(redemptionId, reason);
    }

    // =================== DECODING FUNCTIONS ===================
    
    /// @notice Decode reserve attestation parameters
    function decodeReserveAttestation(bytes memory data)
        internal
        pure
        returns (address qc, uint256 balance)
    {
        (qc, balance) = abi.decode(data, (address, uint256));
    }
    
    /// @notice Decode wallet registration parameters
    function decodeWalletRegistration(bytes memory data)
        internal
        pure
        returns (
            address qc,
            string memory btcAddress,
            bytes32 challengeHash,
            BitcoinTx.Info memory txInfo,
            BitcoinTx.Proof memory proof
        )
    {
        (qc, btcAddress, challengeHash, txInfo, proof) = abi.decode(
            data,
            (address, string, bytes32, BitcoinTx.Info, BitcoinTx.Proof)
        );
    }
    
    /// @notice Decode status change parameters
    function decodeStatusChange(bytes memory data)
        internal
        pure
        returns (
            address qc,
            QCData.QCStatus newStatus,
            bytes32 reason
        )
    {
        (qc, newStatus, reason) = abi.decode(data, (address, QCData.QCStatus, bytes32));
    }
    
    /// @notice Decode redemption fulfillment parameters
    function decodeRedemptionFulfillment(bytes memory data)
        internal
        pure
        returns (
            bytes32 redemptionId,
            string memory userBtcAddress,
            uint64 expectedAmount,
            BitcoinTx.Info memory txInfo,
            BitcoinTx.Proof memory proof
        )
    {
        (redemptionId, userBtcAddress, expectedAmount, txInfo, proof) = abi.decode(
            data,
            (bytes32, string, uint64, BitcoinTx.Info, BitcoinTx.Proof)
        );
    }
    
    /// @notice Decode redemption default parameters
    function decodeRedemptionDefault(bytes memory data)
        internal
        pure
        returns (bytes32 redemptionId, bytes32 reason)
    {
        (redemptionId, reason) = abi.decode(data, (bytes32, bytes32));
    }

    // =================== VALIDATION FUNCTIONS ===================
    
    /// @notice Validate reserve attestation data
    function validateReserveAttestation(address qc, uint256 balance)
        internal
        pure
        returns (bool)
    {
        return qc != address(0) && balance > 0;
    }
    
    /// @notice Validate wallet registration data
    function validateWalletRegistration(
        address qc,
        string memory btcAddress,
        bytes32 challengeHash
    ) internal pure returns (bool) {
        return qc != address(0) && 
               bytes(btcAddress).length > 0 && 
               challengeHash != bytes32(0);
    }
    
    /// @notice Validate status change data
    function validateStatusChange(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason
    ) internal pure returns (bool) {
        return qc != address(0) && 
               uint8(newStatus) <= 2 && // Valid status range
               reason != bytes32(0);
    }
    
    /// @notice Validate redemption data
    function validateRedemptionData(
        bytes32 redemptionId,
        string memory userBtcAddress
    ) internal pure returns (bool) {
        return redemptionId != bytes32(0) && 
               bytes(userBtcAddress).length > 0;
    }
}