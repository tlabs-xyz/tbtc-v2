// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../account-control/QCData.sol";

/// @title MockQCData
/// @notice Mock implementation of QCData for testing
contract MockQCData {
    
    mapping(address => QCData.QCStatus) private qcStatuses;
    mapping(address => bool) private registered;
    mapping(address => uint256) private mintedAmounts;
    mapping(address => uint256) private maxCapacities;
    mapping(address => uint256) private registeredAt;
    mapping(address => bool) private selfPaused;
    
    function isQCRegistered(address qc) external view returns (bool) {
        return registered[qc];
    }
    
    function getQCStatus(address qc) external view returns (QCData.QCStatus) {
        return qcStatuses[qc];
    }
    
    
    function registerQC(address qc, uint256 maxMintingCapacity) external {
        registered[qc] = true;
        maxCapacities[qc] = maxMintingCapacity;
        qcStatuses[qc] = QCData.QCStatus.Active;
        registeredAt[qc] = block.timestamp;
        selfPaused[qc] = false;
    }
    
    function getQCInfo(address qc) external view returns (
        QCData.QCStatus status,
        uint256 totalMinted,
        uint256 maxCapacity,
        uint256 regAt,
        bool selfPausedStatus
    ) {
        return (
            qcStatuses[qc],
            mintedAmounts[qc],
            maxCapacities[qc],
            registeredAt[qc],
            selfPaused[qc]
        );
    }
    
    function getMaxMintingCapacity(address qc) external view returns (uint256) {
        return maxCapacities[qc];
    }
    
    function updateMaxMintingCapacity(address qc, uint256 newCapacity) external {
        maxCapacities[qc] = newCapacity;
    }
    
    function getQCMintedAmount(address qc) external view returns (uint256) {
        return mintedAmounts[qc];
    }
    
    function setQCMintedAmount(address qc, uint256 amount) external {
        mintedAmounts[qc] = amount;
    }
    
    function registerWallet(address qc, string calldata btcAddress) external {
        // Mock implementation - does nothing
    }
    
    function setQCStatus(
        address qc, 
        QCData.QCStatus newStatus, 
        bytes32 /* reason */
    ) external {
        qcStatuses[qc] = newStatus;
    }
    
    function setQCSelfPaused(address qc, bool paused) external {
        selfPaused[qc] = paused;
    }
    
    function isWalletRegistered(string calldata /* btcAddress */) external pure returns (bool) {
        // Mock implementation - always returns false for testing
        return false;
    }
    
    function canQCMint(address qc) external view returns (bool) {
        return qcStatuses[qc] == QCData.QCStatus.Active;
    }
    
    function canQCFulfill(address qc) external view returns (bool) {
        QCData.QCStatus status = qcStatuses[qc];
        return status == QCData.QCStatus.Active || 
               status == QCData.QCStatus.MintingPaused ||
               status == QCData.QCStatus.UnderReview;
    }
    
    function isWalletActive(string calldata /* btcAddress */) external pure returns (bool) {
        return true; // Mock implementation
    }
    
    function getWalletOwner(string calldata /* btcAddress */) external view returns (address) {
        return address(this); // Mock implementation
    }
    
    function getWalletStatus(string calldata /* btcAddress */) external pure returns (QCData.WalletStatus) {
        return QCData.WalletStatus.Active; // Mock implementation - always return Active
    }
}