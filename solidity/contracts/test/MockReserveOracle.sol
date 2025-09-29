// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @title MockReserveOracle
/// @notice Mock implementation of ReserveOracle for testing
contract MockReserveOracle {
    
    struct ReserveData {
        uint256 balance;
        bool isStale;
        uint256 lastUpdate;
    }
    
    mapping(address => ReserveData) private reserves;
    uint256 public constant STALENESS_THRESHOLD = 6 hours;
    
    function getReserveBalanceAndStaleness(address qc) 
        external 
        view 
        returns (uint256 balance, bool isStale) 
    {
        ReserveData memory data = reserves[qc];
        return (data.balance, data.isStale);
    }
    
    function getReserveBalance(address qc) external view returns (uint256) {
        return reserves[qc].balance;
    }
    
    function setReserveBalance(
        address qc, 
        uint256 balance, 
        bool isStale
    ) external {
        reserves[qc] = ReserveData({
            balance: balance,
            isStale: isStale,
            lastUpdate: block.timestamp
        });
    }
    
    function attestReserve(
        address qc,
        uint256 balance,
        uint256 timestamp,
        bytes calldata signature
    ) external {
        // Mock implementation - just update the balance
        reserves[qc] = ReserveData({
            balance: balance,
            isStale: false,
            lastUpdate: timestamp
        });
    }
    
    function getLastAttestation(address qc) 
        external 
        view 
        returns (uint256 balance, uint256 timestamp) 
    {
        ReserveData memory data = reserves[qc];
        return (data.balance, data.lastUpdate);
    }
}