// SPDX-License-Identifier: GPL-3.0-only

// ██████████████     ▐████▌     ██████████████
// ██████████████     ▐████▌     ██████████████
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
// ██████████████     ▐████▌     ██████████████
// ██████████████     ▐████▌     ██████████████
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌

pragma solidity 0.8.17;

/// @notice Interface for Bank contract with minting and burning capabilities.
/// @dev Used by AccountControl for managing TBTC token operations.
interface IBankMintBurn {
    /// @notice Increases the balance of the specified account.
    /// @param account The address of the account.
    /// @param amount The amount to increase the balance by.
    function increaseBalance(address account, uint256 amount) external;

    /// @notice Increases the balances of multiple accounts.
    /// @param accounts The addresses of the accounts.
    /// @param amounts The amounts to increase the balances by.
    function increaseBalances(address[] calldata accounts, uint256[] calldata amounts) external;

    /// @notice Mints tokens to the specified recipient.
    /// @param recipient The address of the recipient.
    /// @param amount The amount of tokens to mint.
    function mint(address recipient, uint256 amount) external;

    /// @notice Burns tokens from the caller's account.
    /// @param amount The amount of tokens to burn.
    function burn(uint256 amount) external;

    /// @notice Burns tokens from the specified account.
    /// @param account The address of the account.
    /// @param amount The amount of tokens to burn.
    function burnFrom(address account, uint256 amount) external;
}