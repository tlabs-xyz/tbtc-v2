// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import {BTCUtils} from "@keep-network/bitcoin-spv-sol/contracts/BTCUtils.sol";
import "../integrator/IBridge.sol";

contract MockBridgeForStarkNet is IBridge {
    mapping(uint256 => IBridgeTypes.DepositRequest) private _deposits;
    mapping(uint256 => bool) private _swept;
    mapping(uint256 => bool) private _finalized; // Track finalized deposits to prevent double finalization

    // Added for redemption mocks
    mapping(uint256 => IBridgeTypes.RedemptionRequest) internal _pendingRedemptions;

    uint64 internal _redemptionDustThreshold = 50000; // 0.0005 BTC
    uint64 internal _redemptionTreasuryFeeDivisor = 200; // 0.5%
    uint64 internal _redemptionTxMaxFee = 10000; // 0.0001 BTC
    uint64 internal _redemptionTxMaxTotalFee = 50000; // 0.0005 BTC
    uint32 internal _redemptionTimeout = 6 * 3600; // 6 hours in seconds
    uint96 internal _redemptionTimeoutSlashingAmount = 10**18; // 1 TBTC with 18 decimals
    uint32 internal _redemptionTimeoutNotifierRewardMultiplier = 5; // 5%

    // Events to match real Bridge
    event DepositRevealed(uint256 indexed depositKey);
    // Added for redemption mocks
    event RedemptionRequestedMock(
        bytes20 walletPubKeyHash,
        uint64 amount,
        bytes redeemerOutputScript,
        uint256 redemptionKey
    );

    // Track calls for testing
    bool public initializeDepositCalled;
    uint256 public lastDepositKey;

    function revealDepositWithExtraData(
        IBridgeTypes.BitcoinTxInfo calldata fundingTx,
        IBridgeTypes.DepositRevealInfo calldata reveal,
        bytes32 extraData
    ) external override {
        initializeDepositCalled = true;

        // Calculate deposit key exactly like AbstractBTCDepositor
        bytes memory txData = abi.encodePacked(
            fundingTx.version,
            fundingTx.inputVector,
            fundingTx.outputVector,
            fundingTx.locktime
        );
        bytes32 fundingTxHash = BTCUtils.hash256View(txData);
        uint256 depositKey = uint256(
            keccak256(
                abi.encodePacked(fundingTxHash, reveal.fundingOutputIndex)
            )
        );

        lastDepositKey = depositKey;

        // Create mock deposit
        _deposits[depositKey] = IBridgeTypes.DepositRequest({
            depositor: msg.sender,
            amount: 100000000, // 1 BTC in satoshis (8-decimal precision)
            // solhint-disable-next-line not-rely-on-time
            revealedAt: uint32(block.timestamp),
            vault: reveal.vault,
            treasuryFee: 12098, // Treasury fee in satoshis (should match the ratio)
            sweptAt: 0,
            extraData: extraData
        });

        emit DepositRevealed(depositKey);
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
        return (0, 0, 1000000, 0);
    }

    // Test helper to simulate sweeping
    function sweepDeposit(uint256 depositKey) external {
        require(
            _deposits[depositKey].depositor != address(0),
            "Deposit not found"
        );
        require(!_swept[depositKey], "Already swept");
        _swept[depositKey] = true;
        // solhint-disable-next-line not-rely-on-time
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

    // --- Redemption related mock functions ---
    function requestRedemption(
        bytes20 walletPubKeyHash,
        BitcoinTx.UTXO calldata /*mainUtxo*/, // Marked unused
        bytes calldata redeemerOutputScript,
        uint64 amount
    ) external override {
        bytes32 scriptHash = keccak256(redeemerOutputScript);
        uint256 redemptionKey;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mstore(0, scriptHash)
            mstore(32, walletPubKeyHash)
            redemptionKey := keccak256(0, 52)
        }

        require(
            _pendingRedemptions[redemptionKey].requestedAt == 0,
            "Redemption already requested"
        );

        _pendingRedemptions[redemptionKey] = IBridgeTypes.RedemptionRequest({
            redeemer: msg.sender,
            requestedAmount: amount,
            treasuryFee: _redemptionTreasuryFeeDivisor > 0 ? amount / _redemptionTreasuryFeeDivisor : 0,
            txMaxFee: _redemptionTxMaxFee,
            // solhint-disable-next-line not-rely-on-time
            requestedAt: uint32(block.timestamp)
        });

        emit RedemptionRequestedMock(
            walletPubKeyHash,
            amount,
            redeemerOutputScript,
            redemptionKey
        );
    }

    function pendingRedemptions(uint256 redemptionKey)
        external
        view
        override
        returns (IBridgeTypes.RedemptionRequest memory)
    {
        return _pendingRedemptions[redemptionKey];
    }

    function redemptionParameters()
        external
        view
        override
        returns (
            uint64 redemptionDustThreshold,
            uint64 redemptionTreasuryFeeDivisor,
            uint64 redemptionTxMaxFee,
            uint64 redemptionTxMaxTotalFee,
            uint32 redemptionTimeout,
            uint96 redemptionTimeoutSlashingAmount,
            uint32 redemptionTimeoutNotifierRewardMultiplier
        )
    {
        redemptionDustThreshold = _redemptionDustThreshold;
        redemptionTreasuryFeeDivisor = _redemptionTreasuryFeeDivisor;
        redemptionTxMaxFee = _redemptionTxMaxFee;
        redemptionTxMaxTotalFee = _redemptionTxMaxTotalFee;
        redemptionTimeout = _redemptionTimeout;
        redemptionTimeoutSlashingAmount = _redemptionTimeoutSlashingAmount;
        redemptionTimeoutNotifierRewardMultiplier = _redemptionTimeoutNotifierRewardMultiplier;
    }
}
