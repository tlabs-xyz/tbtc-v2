// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/**
 * @title AccountControlLib
 * @notice Library containing batch operations and utility functions for AccountControl
 * @dev Extracted to reduce AccountControl contract size below EIP-170 limit
 */
library AccountControlLib {
    // Constants mirrored from AccountControl
    uint256 public constant MIN_MINT_AMOUNT = 10**4; // 0.0001 BTC in satoshis
    uint256 public constant MAX_SINGLE_MINT = 100 * 10**8; // 100 BTC in satoshis
    uint256 public constant MAX_BATCH_SIZE = 100;
    uint256 public constant SATOSHI_MULTIPLIER = 1e10; // Converts tBTC (1e18) to satoshis (1e8)

    // Note: Error definitions removed as they're already defined in AccountControl
    // The library will use the errors from the calling contract

    /**
     * @notice Validates batch mint parameters
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts to mint
     * @return totalAmount Sum of all amounts
     */
    function validateBatchMint(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) internal pure returns (uint256 totalAmount) {
        require(recipients.length == amounts.length, "Array length mismatch");
        require(recipients.length <= MAX_BATCH_SIZE, "Batch size exceeded");

        for (uint256 i = 0; i < amounts.length; i++) {
            require(amounts[i] >= MIN_MINT_AMOUNT, "Amount too small");
            require(amounts[i] <= MAX_SINGLE_MINT, "Amount too large");
            totalAmount += amounts[i];
        }
    }

    /**
     * @notice Converts tBTC amount to satoshis
     * @param tbtcAmount Amount in tBTC (18 decimals)
     * @return Amount in satoshis (no decimals)
     */
    function tbtcToSatoshis(uint256 tbtcAmount) internal pure returns (uint256) {
        return tbtcAmount / SATOSHI_MULTIPLIER;
    }

    /**
     * @notice Converts satoshis to tBTC amount
     * @param satoshis Amount in satoshis (no decimals)
     * @return Amount in tBTC (18 decimals)
     */
    function satoshisToTbtc(uint256 satoshis) internal pure returns (uint256) {
        return satoshis * SATOSHI_MULTIPLIER;
    }

    /**
     * @notice Calculates total minting caps excluding a specific reserve
     * @param reserves Array of all reserve addresses
     * @param mintingCaps Mapping of reserve to minting cap
     * @param excludeReserve Reserve to exclude from calculation
     * @return totalCaps Sum of all caps excluding specified reserve
     */
    function calculateTotalCapsExcluding(
        address[] memory reserves,
        mapping(address => uint256) storage mintingCaps,
        address excludeReserve
    ) internal view returns (uint256 totalCaps) {
        for (uint256 i = 0; i < reserves.length; i++) {
            if (reserves[i] != excludeReserve) {
                totalCaps += mintingCaps[reserves[i]];
            }
        }
    }
}