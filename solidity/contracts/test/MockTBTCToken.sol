// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockTBTCToken is ERC20 {
    bool public shouldFailApprove = false;
    bool public shouldFailTransfer = false;
    
    constructor() ERC20("Mock tBTC", "tBTC") {
        _mint(msg.sender, 1000000 * 10**18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    // Security testing features
    function setShouldFailApprove(bool _shouldFail) external {
        shouldFailApprove = _shouldFail;
    }
    
    function setShouldFailTransfer(bool _shouldFail) external {
        shouldFailTransfer = _shouldFail;
    }
    
    function approve(address spender, uint256 amount) public virtual override returns (bool) {
        require(!shouldFailApprove, "Mock: approve failed");
        return super.approve(spender, amount);
    }
    
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public virtual override returns (bool) {
        require(!shouldFailTransfer, "Mock: transfer failed");
        return super.transferFrom(from, to, amount);
    }
}