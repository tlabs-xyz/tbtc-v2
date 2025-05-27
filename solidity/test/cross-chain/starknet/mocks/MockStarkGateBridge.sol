// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../../../../../contracts/cross-chain/starknet/interfaces/IStarkGateBridge.sol";

contract MockStarkGateBridge is IStarkGateBridge {
    uint256 public messageNonce = 1;
    
    // Track calls for testing
    struct DepositCall {
        address token;
        uint256 amount;
        uint256 l2Recipient;
        uint256[] message;
        uint256 value;
    }
    
    DepositCall public lastDepositCall;
    bool public depositWithMessageCalled;
    
    function depositWithMessage(
        address token,
        uint256 amount,
        uint256 l2Recipient,
        uint256[] calldata message
    ) external payable override returns (uint256) {
        depositWithMessageCalled = true;
        lastDepositCall = DepositCall({
            token: token,
            amount: amount,
            l2Recipient: l2Recipient,
            message: message,
            value: msg.value
        });
        
        return messageNonce++;
    }
    
    function estimateMessageFee() external pure override returns (uint256) {
        return 0.01 ether;
    }
    
    function depositWithMessageCancelRequest(
        address,
        uint256,
        uint256,
        uint256[] calldata,
        uint256
    ) external override {
        // Mock implementation
    }
    
    function l1ToL2MessageNonce() external view override returns (uint256) {
        return messageNonce;
    }
    
    function isDepositCancellable(uint256) external pure override returns (bool) {
        return true;
    }
    
    // Helper functions for testing
    function wasDepositWithMessageCalled() external view returns (bool) {
        return depositWithMessageCalled;
    }
    
    function getLastDepositRecipient() external view returns (uint256) {
        return lastDepositCall.l2Recipient;
    }
    
    function getLastDepositAmount() external view returns (uint256) {
        return lastDepositCall.amount;
    }
    
    function getLastDepositToken() external view returns (address) {
        return lastDepositCall.token;
    }
    
    function getLastDepositValue() external view returns (uint256) {
        return lastDepositCall.value;
    }
}