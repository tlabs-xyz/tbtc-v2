// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../account-control/QCManager.sol";

/// @title MockQCRedeemer
/// @notice Mock implementation of QCRedeemer for testing
contract MockQCRedeemer is IQCRedeemer {
    
    mapping(address => bool) private unfulfilledRedemptions;
    mapping(string => bool) private walletObligations;
    mapping(address => uint256) private earliestDeadlines;
    mapping(string => uint256) private walletPendingCounts;
    mapping(string => uint256) private walletEarliestDeadlines;
    
    /// @notice Check if QC has unfulfilled redemptions
    function hasUnfulfilledRedemptions(address qc) external view returns (bool) {
        return unfulfilledRedemptions[qc];
    }
    
    /// @notice Get earliest redemption deadline for QC
    function getEarliestRedemptionDeadline(address qc) external view returns (uint256) {
        return earliestDeadlines[qc];
    }
    
    /// @notice Check if wallet has obligations
    function hasWalletObligations(string calldata walletAddress) external view returns (bool) {
        return walletObligations[walletAddress];
    }
    
    /// @notice Get wallet pending redemption count
    function getWalletPendingRedemptionCount(string calldata walletAddress) external view returns (uint256) {
        return walletPendingCounts[walletAddress];
    }
    
    /// @notice Get wallet earliest redemption deadline
    function getWalletEarliestRedemptionDeadline(string calldata walletAddress) external view returns (uint256) {
        return walletEarliestDeadlines[walletAddress];
    }
    
    // Test helper functions
    
    function setUnfulfilledRedemptions(address qc, bool hasUnfulfilled) external {
        unfulfilledRedemptions[qc] = hasUnfulfilled;
    }
    
    function setEarliestDeadline(address qc, uint256 deadline) external {
        earliestDeadlines[qc] = deadline;
    }
    
    function setWalletObligations(string calldata walletAddress, bool hasObligations) external {
        walletObligations[walletAddress] = hasObligations;
    }
    
    function setWalletPendingCount(string calldata walletAddress, uint256 count) external {
        walletPendingCounts[walletAddress] = count;
    }
    
    function setWalletEarliestDeadline(string calldata walletAddress, uint256 deadline) external {
        walletEarliestDeadlines[walletAddress] = deadline;
    }

    /// @notice Validate Bitcoin address format
    /// @param btcAddress Bitcoin address to validate
    /// @return true if address appears valid, false otherwise
    function validateBitcoinAddress(string memory btcAddress) external pure returns (bool) {
        bytes memory addrBytes = bytes(btcAddress);
        // Basic validation: P2PKH (26-35 chars), P2SH (34 chars), Bech32 (42-62 chars)
        return addrBytes.length >= 26 && addrBytes.length <= 62;
    }
}