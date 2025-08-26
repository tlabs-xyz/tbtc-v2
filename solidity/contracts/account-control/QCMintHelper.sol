// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../bank/Bank.sol";
import "../vault/TBTCVault.sol";
import "../token/TBTC.sol";

/// @title QCMintHelper
/// @notice Helper contract for automated tBTC minting from Bank balances
/// @dev This contract automates the process of converting Bank balance to tBTC tokens
///      for users who want seamless Account Control minting experience.
contract QCMintHelper is ReentrancyGuard {
    error InvalidQCMinter();
    error InsufficientBalance();
    error InvalidUser();
    error ZeroAmount();

    Bank public immutable bank;
    TBTCVault public immutable tbtcVault;
    TBTC public immutable tbtc;
    address public immutable qcMinter;
    
    uint256 public constant SATOSHI_MULTIPLIER = 1e10;

    event AutoMintCompleted(
        address indexed user,
        uint256 satoshis,
        uint256 tbtcAmount
    );
    
    event ManualMintCompleted(
        address indexed user,
        uint256 satoshis,
        uint256 tbtcAmount
    );

    modifier onlyQCMinter() {
        if (msg.sender != qcMinter) revert InvalidQCMinter();
        _;
    }

    constructor(
        address _bank,
        address _tbtcVault,
        address _tbtc,
        address _qcMinter
    ) {
        require(_bank != address(0), "Bank cannot be zero address");
        require(_tbtcVault != address(0), "TBTCVault cannot be zero address");
        require(_tbtc != address(0), "TBTC cannot be zero address");
        require(_qcMinter != address(0), "QCMinter cannot be zero address");

        bank = Bank(_bank);
        tbtcVault = TBTCVault(_tbtcVault);
        tbtc = TBTC(_tbtc);
        qcMinter = _qcMinter;
    }

    /// @notice Automatically mint tBTC for user using their Bank balance
    /// @dev Called by QCMinter after Bank balance is created
    ///      User must have pre-approved this contract to spend their Bank balance
    /// @param user The user receiving tBTC tokens
    /// @param satoshis Amount of satoshis to convert to tBTC
    /// @param permitData Reserved for future use (currently ignored)
    function autoMint(
        address user,
        uint256 satoshis,
        bytes calldata permitData
    ) external onlyQCMinter nonReentrant {
        if (user == address(0)) revert InvalidUser();
        if (satoshis == 0) revert ZeroAmount();
        if (bank.balanceOf(user) < satoshis) revert InsufficientBalance();

        // Check user has approved this contract to spend their balance
        if (bank.allowance(user, address(this)) < satoshis) {
            revert InsufficientBalance(); // Reusing error for insufficient allowance
        }

        // Transfer Bank balance from user to helper
        bank.transferBalanceFrom(user, address(this), satoshis);

        // Helper mints tBTC (mints to msg.sender = helper)
        uint256 tbtcAmount = satoshis * SATOSHI_MULTIPLIER;
        tbtcVault.mint(tbtcAmount);

        // Transfer tBTC tokens to user
        tbtc.transfer(user, tbtcAmount);

        emit AutoMintCompleted(user, satoshis, tbtcAmount);
    }

    /// @notice Manually mint tBTC for user (fallback option)
    /// @dev User must have pre-approved helper to spend their Bank balance
    /// @param user The user to mint tBTC for
    function manualMint(address user) external nonReentrant {
        if (user == address(0)) revert InvalidUser();
        
        uint256 satoshis = bank.balanceOf(user);
        if (satoshis == 0) revert ZeroAmount();

        // User must have pre-approved helper (or transaction will revert)
        bank.transferBalanceFrom(user, address(this), satoshis);

        uint256 tbtcAmount = satoshis * SATOSHI_MULTIPLIER;
        tbtcVault.mint(tbtcAmount);
        tbtc.transfer(user, tbtcAmount);

        emit ManualMintCompleted(user, satoshis, tbtcAmount);
    }


    /// @notice Get the expected tBTC amount for given satoshi amount
    /// @param satoshis Amount in satoshis
    /// @return tbtcAmount Equivalent tBTC amount in wei
    function getSatoshiToTBTCAmount(uint256 satoshis) external pure returns (uint256 tbtcAmount) {
        return satoshis * SATOSHI_MULTIPLIER;
    }

    /// @notice Check if user has sufficient Bank balance and allowance
    /// @param user The user to check
    /// @return hasBalance True if user has Bank balance > 0
    /// @return hasAllowance True if user has approved helper for their balance
    /// @return balance User's current Bank balance
    /// @return allowance User's current allowance to helper
    function checkMintEligibility(address user) 
        external 
        view 
        returns (
            bool hasBalance,
            bool hasAllowance,
            uint256 balance,
            uint256 allowance
        ) 
    {
        balance = bank.balanceOf(user);
        allowance = bank.allowance(user, address(this));
        
        hasBalance = balance > 0;
        hasAllowance = allowance >= balance;
    }
}