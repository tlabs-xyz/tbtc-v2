// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../integrator/IBridge.sol";

contract MockBridgeForStarkNet is IBridge {
    mapping(uint256 => IBridgeTypes.DepositRequest) private _deposits;
    mapping(uint256 => bool) private _swept;
    
    // Events to match real Bridge
    event DepositRevealed(uint256 indexed depositKey);
    
    // Track calls for testing
    bool public initializeDepositCalled;
    uint256 public lastDepositKey;
    
    function revealDepositWithExtraData(
        IBridgeTypes.BitcoinTxInfo calldata fundingTx,
        IBridgeTypes.DepositRevealInfo calldata reveal,
        bytes32 extraData
    ) external {
        initializeDepositCalled = true;
        
        // Calculate deposit key using extraData as the key component
        // This simulates how AbstractBTCDepositor creates unique deposit keys
        uint256 depositKey = uint256(extraData);
        
        lastDepositKey = depositKey;
        
        // Create mock deposit
        _deposits[depositKey] = IBridgeTypes.DepositRequest({
            depositor: msg.sender,
            amount: 1000000000000000, // Example amount
            revealedAt: uint32(block.timestamp),
            vault: reveal.vault,
            treasuryFee: 12098000000000, // Example treasury fee
            sweptAt: 0,
            extraData: extraData
        });
        
        emit DepositRevealed(depositKey);
    }
    
    function deposits(uint256 depositKey) external view override returns (IBridgeTypes.DepositRequest memory) {
        return _deposits[depositKey];
    }
    
    function depositParameters() external pure returns (
        uint64,
        uint64,
        uint64 depositTxMaxFee,
        uint32
    ) {
        return (0, 0, 1000000, 0);
    }
    
    // Test helper to simulate sweeping
    function sweepDeposit(uint256 depositKey) external {
        require(_deposits[depositKey].depositor != address(0), "Deposit not found");
        require(!_swept[depositKey], "Already swept");
        _swept[depositKey] = true;
        _deposits[depositKey].sweptAt = uint32(block.timestamp);
    }
    
    // Debug helper
    function getDepositKeys() external view returns (uint256[] memory) {
        // This is just for debugging - would be inefficient in production
        uint256[] memory keys = new uint256[](1);
        keys[0] = lastDepositKey;
        return keys;
    }
    
    // Test helper functions
    function wasInitializeDepositCalled() external view returns (bool) {
        return initializeDepositCalled;
    }
    
    function getLastDepositKey() external view returns (uint256) {
        return lastDepositKey;
    }
    
    function resetMock() external {
        initializeDepositCalled = false;
        lastDepositKey = 0;
    }
}