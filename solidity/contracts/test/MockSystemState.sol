// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @title MockSystemState
/// @notice Mock implementation of SystemState for testing
contract MockSystemState {
    
    bool private _mintingPaused;
    bool private _redemptionPaused;
    mapping(address => bool) private _qcEmergencyPaused;
    uint256 private _minMintAmount = 10000; // 0.0001 BTC in satoshis
    uint256 private _maxMintAmount = 100000000; // 1 BTC in satoshis
    uint256 private _redemptionTimeout = 86400; // 24 hours
    
    function isMintingPaused() external view returns (bool) {
        return _mintingPaused;
    }
    
    function setMintingPaused(bool isPaused) external {
        _mintingPaused = isPaused;
    }
    
    function isRedemptionPaused() external view returns (bool) {
        return _redemptionPaused;
    }
    
    function setRedemptionPaused(bool isPaused) external {
        _redemptionPaused = isPaused;
    }
    
    function isQCEmergencyPaused(address qc) external view returns (bool) {
        return _qcEmergencyPaused[qc];
    }
    
    function setQCEmergencyPaused(address qc, bool isPaused) external {
        _qcEmergencyPaused[qc] = isPaused;
    }
    
    function minMintAmount() external view returns (uint256) {
        return _minMintAmount;
    }
    
    function setMinMintAmount(uint256 amount) external {
        _minMintAmount = amount;
    }
    
    function maxMintAmount() external view returns (uint256) {
        return _maxMintAmount;
    }
    
    function setMaxMintAmount(uint256 amount) external {
        _maxMintAmount = amount;
    }
    
    function redemptionTimeout() external view returns (uint256) {
        return _redemptionTimeout;
    }
    
    function setRedemptionTimeout(uint256 timeout) external {
        _redemptionTimeout = timeout;
    }
    
    function isEmergencyActive() external pure returns (bool) {
        return false; // For testing, no emergency state
    }
    
    function isFunctionPaused(string calldata /* functionName */) external pure returns (bool) {
        return false; // For testing, no functions are paused
    }

    // General pause functionality for system-wide pause
    bool public paused = false;

    event Paused(address account);
    event Unpaused(address account);

    function pause() external {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // System-specific pause functions (aliases for compatibility)
    function pauseSystem() external {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpauseSystem() external {
        paused = false;
        emit Unpaused(msg.sender);
    }
}