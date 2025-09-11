// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/**
 * @title MockQCData
 * @notice Mock implementation of QCData for testing
 */
contract MockQCData {
    enum QCStatus { Inactive, Active, UnderReview, Revoked }
    
    mapping(address => QCStatus) private qcStatuses;
    mapping(address => uint256) private mintedAmounts;
    
    function getQCStatus(address qc) external view returns (QCStatus) {
        return qcStatuses[qc];
    }
    
    function setQCStatus(address qc, QCStatus status) external {
        qcStatuses[qc] = status;
    }
    
    function getMintedAmount(address qc) external view returns (uint256) {
        return mintedAmounts[qc];
    }
    
    function setMintedAmount(address qc, uint256 amount) external {
        mintedAmounts[qc] = amount;
    }
}