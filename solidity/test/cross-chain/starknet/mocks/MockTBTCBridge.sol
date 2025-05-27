// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../../../../contracts/integrator/IBridge.sol";

contract MockTBTCBridge is IBridge {
    mapping(bytes32 => bool) public deposits;
    
    function revealDepositWithExtraData(
        IBridgeTypes.BitcoinTxInfo calldata,
        IBridgeTypes.DepositRevealInfo calldata,
        bytes32
    ) external returns (uint256) {
        // Mock implementation
        return 1;
    }
    
    function deposits(uint256) external pure returns (
        address depositor,
        uint256 amount,
        uint8 status,
        bytes32 keccak256
    ) {
        // Mock implementation
        return (address(0), 0, 0, bytes32(0));
    }
    
    function depositParameters() external pure returns (
        uint64,
        uint64,
        uint64 depositTxMaxFee,
        uint32
    ) {
        return (0, 0, 1000000, 0); // 0.01 BTC max fee
    }
}