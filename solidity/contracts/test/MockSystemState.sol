// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title MockSystemState
 * @notice Mock system state for testing QCRedeemer integration
 */
contract MockSystemState {
    uint256 private _redemptionTimeout = 86400; // 24 hours default
    
    function redemptionTimeout() external view returns (uint256) {
        return _redemptionTimeout;
    }
    
    function setRedemptionTimeout(uint256 timeout) external {
        _redemptionTimeout = timeout;
    }
}