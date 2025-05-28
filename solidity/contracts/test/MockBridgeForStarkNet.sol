// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import {BTCUtils} from "@keep-network/bitcoin-spv-sol/contracts/BTCUtils.sol";
import "../integrator/IBridge.sol";

contract MockBridgeForStarkNet is IBridge {
    mapping(uint256 => IBridgeTypes.DepositRequest) private _deposits;
    mapping(uint256 => bool) private _swept;
    mapping(uint256 => bool) private _finalized; // Track finalized deposits to prevent double finalization
    
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
        
        // Calculate deposit key exactly like AbstractBTCDepositor
        bytes memory txData = abi.encodePacked(
            fundingTx.version,
            fundingTx.inputVector,
            fundingTx.outputVector,
            fundingTx.locktime
        );
        bytes32 fundingTxHash = BTCUtils.hash256View(txData);
        uint256 depositKey = uint256(keccak256(abi.encodePacked(fundingTxHash, reveal.fundingOutputIndex)));
        
        lastDepositKey = depositKey;
        
        // Create mock deposit
        _deposits[depositKey] = IBridgeTypes.DepositRequest({
            depositor: msg.sender,
            amount: 100000000, // 1 BTC in satoshis (8-decimal precision)
            revealedAt: uint32(block.timestamp),
            vault: reveal.vault,
            treasuryFee: 12098, // Treasury fee in satoshis (should match the ratio)
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
    
    // Debug helper to check if deposit exists
    function depositExists(uint256 depositKey) external view returns (bool) {
        return _deposits[depositKey].depositor != address(0);
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