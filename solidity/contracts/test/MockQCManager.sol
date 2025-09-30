// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.17;

/// @title MockQCManager
/// @notice Mock implementation of QCManager for testing
contract MockQCManager {
    mapping(address => uint256) public maxMintingCaps;
    mapping(address => bool) public isQCRegistered;
    mapping(address => uint256) public qcMintedAmount;

    event QCRegistered(address indexed qc, uint256 maxMintingCap);
    event MintingCapUpdated(address indexed qc, uint256 newCap);

    function registerQC(address qc, uint256 maxMintingCap) external {
        isQCRegistered[qc] = true;
        maxMintingCaps[qc] = maxMintingCap;
        emit QCRegistered(qc, maxMintingCap);
    }

    function getMaxMintingCap(address qc) external view returns (uint256) {
        return maxMintingCaps[qc];
    }

    function setMaxMintingCap(address qc, uint256 newCap) external {
        maxMintingCaps[qc] = newCap;
        emit MintingCapUpdated(qc, newCap);
    }

    function increaseMintingCap(address qc, uint256 newCap) external {
        require(newCap > maxMintingCaps[qc], "New cap must be higher");
        maxMintingCaps[qc] = newCap;
        emit MintingCapUpdated(qc, newCap);
    }

    function getQCMintedAmount(address qc) external view returns (uint256) {
        return qcMintedAmount[qc];
    }

    function recordMinting(address qc, uint256 amount) external {
        require(isQCRegistered[qc], "QC not registered");
        uint256 cap = maxMintingCaps[qc];
        uint256 newMinted = qcMintedAmount[qc] + amount;
        require(newMinted <= cap, "Exceeds minting cap");
        qcMintedAmount[qc] = newMinted;
    }

    function recordRedemption(address qc, uint256 amount) external {
        require(qcMintedAmount[qc] >= amount, "Insufficient minted amount");
        qcMintedAmount[qc] -= amount;
    }

    // Alias for setMaxMintingCap to match test expectations
    function setMintingCapacity(address qc, uint256 capacity) external {
        maxMintingCaps[qc] = capacity;
        emit MintingCapUpdated(qc, capacity);
    }

    function getAvailableMintingCapacity(address qc) external view returns (uint256) {
        // Simple mock: return max cap minus minted amount
        uint256 cap = maxMintingCaps[qc];
        uint256 minted = qcMintedAmount[qc];
        return cap > minted ? cap - minted : 0;
    }

    function updateQCMintedAmount(address qc, uint256 newAmount) external {
        qcMintedAmount[qc] = newAmount;
    }

    // Atomically check and consume minting capacity
    function consumeMintCapacity(address qc, uint256 amount) external returns (bool) {
        require(isQCRegistered[qc], "QC not registered");
        uint256 cap = maxMintingCaps[qc];
        uint256 minted = qcMintedAmount[qc];
        uint256 newMinted = minted + amount;
        
        if (newMinted > cap) {
            return false; // Capacity exceeded
        }
        
        qcMintedAmount[qc] = newMinted;
        return true;
    }
}