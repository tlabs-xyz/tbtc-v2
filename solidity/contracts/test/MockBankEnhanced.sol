// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title MockBankEnhanced
 * @notice Enhanced Mock Bank contract for testing AccountControl enhancements
 * @dev Implements both individual and batch operations for comprehensive testing
 */
contract MockBankEnhanced {
    mapping(address => uint256) public balances;
    uint256 private _totalSupply;
    
    // Testing controls
    bool public batchSupported = true;
    bool public failOnSecondCall = false;
    uint256 public batchCallCount = 0;
    uint256 public individualCallCount = 0;
    uint256 private callCount = 0;

    function increaseBalance(address account, uint256 amount) external {
        individualCallCount++;
        callCount++;
        
        // Simulate failure on second call if configured
        if (failOnSecondCall && callCount == 2) {
            revert("Mock Bank: Forced failure");
        }
        
        balances[account] += amount;
        _totalSupply += amount;
    }
    
    function batchIncreaseBalance(address[] calldata accounts, uint256[] calldata amounts) external {
        if (!batchSupported) {
            revert("Mock Bank: Batch not supported");
        }
        
        batchCallCount++;
        
        require(accounts.length == amounts.length, "Array length mismatch");
        
        for (uint256 i = 0; i < accounts.length; i++) {
            balances[accounts[i]] += amounts[i];
            _totalSupply += amounts[i];
        }
    }
    
    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }
    
    // Testing configuration functions
    function setBatchSupported(bool supported) external {
        batchSupported = supported;
    }
    
    function setFailOnSecondCall(bool shouldFail) external {
        failOnSecondCall = shouldFail;
        callCount = 0; // Reset call count
    }
    
    function resetCounters() external {
        batchCallCount = 0;
        individualCallCount = 0;
        callCount = 0;
    }
}