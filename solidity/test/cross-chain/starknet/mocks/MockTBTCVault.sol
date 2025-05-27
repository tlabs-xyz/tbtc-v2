// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../../../../contracts/integrator/ITBTCVault.sol";

contract MockTBTCVault is ITBTCVault {
    address public immutable tbtcToken;
    
    constructor(address _tbtcToken) {
        tbtcToken = _tbtcToken;
    }
    
    function receiveBalanceIncrease(address[] calldata, uint256[] calldata) external {
        // Mock implementation
    }
}