// SPDX-License-Identifier: GPL-3.0-only

pragma solidity ^0.8.17;

import "../integrator/IBank.sol";

contract MockBank is IBank {
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;
    
    // Testing controls
    bool public batchSupported = true;
    bool public failOnSecondCall = false;
    uint256 public batchCallCount = 0;
    uint256 public individualCallCount = 0;
    uint256 private callCount = 0;
    bool public paused = false;

    // Authorization tracking
    mapping(address => bool) private _authorizedIncreasers;
    address public admin;
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this function");
        _;
    }
    
    modifier onlyAuthorized() {
        require(_authorizedIncreasers[msg.sender] || msg.sender == admin, 
                "Not authorized");
        _;
    }
    
    modifier whenNotPaused() {
        require(!paused, "Contract paused");
        _;
    }
    
    constructor() {
        admin = msg.sender;
    }

    function balanceAvailable(address account)
        external
        view
        override
        returns (uint256)
    {
        return _balances[account];
    }

    function increaseBalanceAllowance(address spender, uint256 amount)
        external
        override
        whenNotPaused
    {
        _allowances[msg.sender][spender] += amount;
        emit BalanceApproval(
            msg.sender,
            spender,
            _allowances[msg.sender][spender]
        );
    }

    function transferBalanceFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external override whenNotPaused returns (bool) {
        uint256 currentAllowance = _allowances[sender][msg.sender];
        require(currentAllowance >= amount, "MockBank: insufficient allowance");
        require(_balances[sender] >= amount, "MockBank: insufficient balance");

        _balances[sender] -= amount;
        _balances[recipient] += amount;
        _allowances[sender][msg.sender] = currentAllowance - amount;

        emit TransferBalance(sender, recipient, amount);
        return true;
    }

    // AccountControl integration methods
    function increaseBalance(address account, uint256 amount) external onlyAuthorized whenNotPaused {
        individualCallCount++;
        callCount++;
        
        // Simulate failure on second call if configured
        if (failOnSecondCall && callCount == 2) {
            revert("Mock Bank: Forced failure");
        }
        
        _balances[account] += amount;
        _totalSupply += amount;
    }
    
    function increaseBalances(address[] calldata accounts, uint256[] calldata amounts) external onlyAuthorized whenNotPaused {
        if (!batchSupported) {
            revert("Mock Bank: Batch not supported");
        }
        
        batchCallCount++;
        
        require(accounts.length == amounts.length, "Array length mismatch");
        
        for (uint256 i = 0; i < accounts.length; i++) {
            _balances[accounts[i]] += amounts[i];
            _totalSupply += amounts[i];
        }
    }

    function decreaseBalance(address account, uint256 amount) external onlyAuthorized whenNotPaused {
        require(_balances[account] >= amount, "Insufficient balance");
        _balances[account] -= amount;
        _totalSupply -= amount;
    }

    // Missing mint function that AccountControl IBank interface expects
    function mint(address recipient, uint256 amount) external onlyAuthorized whenNotPaused {
        _balances[recipient] += amount;
        _totalSupply += amount;
    }

    // Missing burn functions that AccountControl IBank interface expects
    function burn(uint256 amount) external onlyAuthorized whenNotPaused {
        require(_balances[msg.sender] >= amount, "Insufficient balance to burn");
        _balances[msg.sender] -= amount;
        _totalSupply -= amount;
    }

    function burnFrom(address account, uint256 amount) external onlyAuthorized whenNotPaused {
        require(_balances[account] >= amount, "Insufficient balance to burn");
        _balances[account] -= amount;
        _totalSupply -= amount;
    }
    
    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    // Mock-specific functions for testing setup
    function setBalance(address account, uint256 amount) external {
        _balances[account] = amount;
    }

    function getAllowance(address owner, address spender)
        external
        view
        returns (uint256)
    {
        return _allowances[owner][spender];
    }

    // Standard ERC20-like allowance function for compatibility
    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    // Testing configuration functions
    function setBatchSupported(bool supported) external onlyAdmin {
        batchSupported = supported;
    }
    
    function setFailOnSecondCall(bool shouldFail) external onlyAdmin {
        failOnSecondCall = shouldFail;
        callCount = 0; // Reset call count
    }
    
    function resetCounters() external onlyAdmin {
        batchCallCount = 0;
        individualCallCount = 0;
        callCount = 0;
    }

    function setTotalSupply(uint256 newTotalSupply) external onlyAuthorized {
        _totalSupply = newTotalSupply;
    }

    // Convenience getter for external access to balances
    function balances(address account) external view returns (uint256) {
        return _balances[account];
    }

    // ERC20-compatible balanceOf function
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    // Authorization functions
    function authorizedBalanceIncreasers(address account) external view returns (bool) {
        return _authorizedIncreasers[account];
    }

    function authorizeBalanceIncreaser(address account) external onlyAdmin {
        _authorizedIncreasers[account] = true;
    }

    function unauthorizeBalanceIncreaser(address account) external onlyAdmin {
        _authorizedIncreasers[account] = false;
    }

    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
    }
}
