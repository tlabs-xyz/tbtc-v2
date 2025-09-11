// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/**
 * @title MockSystemState
 * @notice Mock implementation of SystemState for testing
 */
contract MockSystemState {
    bool public mintingPaused;
    mapping(address => bool) public qcEmergencyPaused;
    uint256 public minMintAmount = 100e18;
    uint256 public maxMintAmount = 100_000e18;
    
    function isMintingPaused() external view returns (bool) {
        return mintingPaused;
    }
    
    function setMintingPaused(bool paused) external {
        mintingPaused = paused;
    }
    
    function isQCEmergencyPaused(address qc) external view returns (bool) {
        return qcEmergencyPaused[qc];
    }
    
    function setQCEmergencyPaused(address qc, bool paused) external {
        qcEmergencyPaused[qc] = paused;
    }
    
    function setMintAmountRange(uint256 min, uint256 max) external {
        minMintAmount = min;
        maxMintAmount = max;
    }
}