// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../cross-chain/starknet/interfaces/IStarkGateBridge.sol";

contract MockStarkGateBridge is IStarkGateBridge {
    uint256 public messageNonce = 1;
    uint256 private _customReturnValue;
    bool private _useCustomReturnValue;
    
    // Track calls for testing
    struct DepositCall {
        address token;
        uint256 amount;
        uint256 l2Recipient;
        uint256[] message;
        uint256 value;
    }
    
    struct SimpleDepositCall {
        address token;
        uint256 amount;
        uint256 l2Recipient;
        uint256 value;
    }
    
    DepositCall public lastDepositCall;
    SimpleDepositCall public lastSimpleDepositCall;
    bool public depositWithMessageCalled;
    bool public depositCalled;
    uint256 public depositCallCount;
    
    function deposit(
        address token,
        uint256 amount,
        uint256 l2Recipient
    ) external payable override returns (uint256) {
        depositCalled = true;
        depositCallCount++;
        lastSimpleDepositCall = SimpleDepositCall({
            token: token,
            amount: amount,
            l2Recipient: l2Recipient,
            value: msg.value
        });
        
        if (_useCustomReturnValue) {
            return _customReturnValue;
        }
        return messageNonce++;
    }
    
    function deposit(
        address token,
        uint256 amount,
        uint256 l2Recipient
    ) external payable override returns (uint256) {
        require(msg.value == 0.1 ether, "Incorrect L1->L2 message fee");
        
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        
        deposits[nextNonce] = DepositInfo({
            token: token,
            amount: amount,
            l2Recipient: l2Recipient,
            message: new uint256[](0),
            depositor: msg.sender
        });
        
        uint256 nonce = nextNonce;
        nextNonce++;
        
        return nonce;
    }

    function depositWithMessage(
        address token,
        uint256 amount,
        uint256 l2Recipient,
        uint256[] calldata message
    ) external payable override returns (uint256) {
        depositWithMessageCalled = true;
        depositCallCount++;
        lastDepositCall = DepositCall({
            token: token,
            amount: amount,
            l2Recipient: l2Recipient,
            message: message,
            value: msg.value
        });
        
        if (_useCustomReturnValue) {
            return _customReturnValue;
        }
        return messageNonce++;
    }
    
    uint256 public dynamicFee = 0.01 ether;
    bool public shouldFailEstimation = false;
    
    function estimateMessageFee() external view override returns (uint256) {
        require(!shouldFailEstimation, "Estimation failed");
        return dynamicFee;
    }
    
    function setDynamicFee(uint256 _fee) external {
        dynamicFee = _fee;
    }
    
    function setShouldFailEstimation(bool _shouldFail) external {
        shouldFailEstimation = _shouldFail;
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
    
    // Test control functions
    function setDepositWithMessageReturn(uint256 value) external {
        _customReturnValue = value;
        _useCustomReturnValue = true;
    }
    
    // Helper functions for deposit() testing
    function wasDepositCalled() external view returns (bool) {
        return depositCalled;
    }
    
    function getLastSimpleDepositCall() external view returns (SimpleDepositCall memory) {
        return lastSimpleDepositCall;
    }
    
    function resetMock() external {
        depositWithMessageCalled = false;
        depositCalled = false;
        depositCallCount = 0;
        _useCustomReturnValue = false;
        messageNonce = 1;
    }
    
    function getDepositCount() external view returns (uint256) {
        return depositCallCount;
    }
    
    function getLastDepositCall() external view returns (DepositCall memory) {
        return lastDepositCall;
    }
}