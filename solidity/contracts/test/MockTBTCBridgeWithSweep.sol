// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../integrator/IBridge.sol";

contract MockTBTCBridgeWithSweep is IBridge {
    mapping(uint256 => IBridgeTypes.DepositRequest) private _deposits;

    // Track calls for testing
    bool public initializeDepositCalled;
    uint256 public nextDepositKey;

    // Events to match real Bridge
    event DepositRevealed(bytes32 indexed depositKey);

    constructor() {
        nextDepositKey = 0xebff13c2304229ab4a97bfbfabeac82c9c0704e4aae2acf022252ac8dc1101d1; // Expected test value
    }

    function revealDepositWithExtraData(
        IBridgeTypes.BitcoinTxInfo calldata, // fundingTx - unused in mock
        IBridgeTypes.DepositRevealInfo calldata reveal,
        bytes32 extraData
    ) external {
        initializeDepositCalled = true;

        // Use predefined deposit key for testing
        uint256 depositKey = nextDepositKey;

        // Create mock deposit
        _deposits[depositKey] = IBridgeTypes.DepositRequest({
            depositor: msg.sender,
            amount: 88800000, // Amount in satoshi that results in expectedTbtcAmount after fees
            revealedAt: uint32(block.timestamp), // solhint-disable-line not-rely-on-time
            vault: reveal.vault,
            treasuryFee: 898000, // Treasury fee in satoshi
            sweptAt: uint32(block.timestamp + 1), // solhint-disable-line not-rely-on-time
            extraData: extraData
        });

        emit DepositRevealed(bytes32(depositKey));
    }

    function deposits(uint256 depositKey)
        external
        view
        override
        returns (IBridgeTypes.DepositRequest memory)
    {
        return _deposits[depositKey];
    }

    function depositParameters()
        external
        pure
        returns (
            uint64,
            uint64,
            uint64 depositTxMaxFee,
            uint32
        )
    {
        return (0, 0, 1000000, 0); // 0.01 BTC max fee
    }

    // Test helper functions
    function wasInitializeDepositCalled() external view returns (bool) {
        return initializeDepositCalled;
    }

    function setNextDepositKey(uint256 _nextDepositKey) external {
        nextDepositKey = _nextDepositKey;
    }

    function resetMock() external {
        initializeDepositCalled = false;
        // Keep the expected deposit key for tests
        nextDepositKey = 0xebff13c2304229ab4a97bfbfabeac82c9c0704e4aae2acf022252ac8dc1101d1;
    }

    function sweepDeposit(uint256 depositKey) external {
        // For testing purposes, if deposit doesn't exist, create a mock one
        if (_deposits[depositKey].revealedAt == 0) {
            _deposits[depositKey] = IBridgeTypes.DepositRequest({
                depositor: msg.sender,
                amount: 88800000, // Amount in satoshi that results in expectedTbtcAmount after fees
                revealedAt: uint32(block.timestamp - 1), // Set to past to allow sweep, solhint-disable-line not-rely-on-time
                vault: address(0),
                treasuryFee: 898000, // Treasury fee in satoshi
                sweptAt: 0,
                extraData: bytes32(0)
            });
        }
        _deposits[depositKey].sweptAt = uint32(block.timestamp); // solhint-disable-line not-rely-on-time
    }
}
