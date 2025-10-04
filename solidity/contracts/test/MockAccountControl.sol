// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

// Define minimal interface for Bank operations
interface IBankWithIncrease {
    function increaseBalance(address account, uint256 amount) external;
    function decreaseBalance(address account, uint256 amount) external;
}

/// @title Mock AccountControl contract for testing
/// @notice Mock implementation that tracks global minted amount for all users
/// @dev In the real system, QCs mint on behalf of users, not for themselves
contract MockAccountControl {
    /// @notice Reserve types enum (simplified for mock)
    enum ReserveType {
        UNINITIALIZED,
        QC_PERMISSIONED
    }
    /// @notice Reference to the Bank contract for balance management
    IBankWithIncrease public bank;
    /// @notice Track total minted amount globally (in wei)
    /// @dev This represents the total tBTC minted through the AccountControl system
    uint256 public totalMinted;
    
    /// @notice Role constants for testing
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant REDEEMER_ROLE = keccak256("REDEEMER_ROLE");

    /// @notice Track whether AccountControl integration is enabled
    bool public accountControlEnabled = true;

    /// @notice Track backing amounts for reserves (for testing)
    mapping(address => uint256) public backing;
    
    /// @notice Track authorization status of reserves
    mapping(address => bool) public authorized;
    
    /// @notice Track minting caps for reserves
    mapping(address => uint256) public mintingCaps;

    /// @notice Track minted amount per reserve/QC
    mapping(address => uint256) public reserveMinted;
    
    /// @notice Track total minted amount per reserve (for AccountControl compatibility)
    mapping(address => uint256) public minted;

    /// @notice Pause state for testing
    bool public paused = false;

    /// @notice Custom error for insufficient minted balance
    error InsufficientMinted(uint256 available, uint256 requested);

    /// @notice Custom errors to match real AccountControl behavior
    error QCNotRegistered(address qc);
    error QCNotActive(address qc);
    error InvalidWalletAddress();
    error WalletNotRegistered(string btcAddress);
    error WalletNotActive(string btcAddress);
    error SignatureVerificationFailed();
    error MessageSignatureVerificationFailed();

    /// @notice Modifier to check if contract is not paused
    modifier whenNotPaused() {
        require(!paused, "Contract paused");
        _;
    }

    /// @notice Constructor to set the bank reference
    constructor(address _bank) {
        bank = IBankWithIncrease(_bank);
    }

    /// @notice Set the bank address (for testing)
    function setBank(address _bank) external {
        bank = IBankWithIncrease(_bank);
    }

    /// @notice Enable or disable AccountControl mode for testing
    /// @param enabled True to enable AccountControl integration, false to disable
    function setAccountControlEnabled(bool enabled) external {
        accountControlEnabled = enabled;
    }

    /// @notice Set totalMinted for testing purposes
    /// @param amount The amount to set as totalMinted (in satoshis)
    function setTotalMintedForTesting(uint256 amount) external {
        totalMinted = amount;
    }

    /// @notice Set backing for a reserve for testing purposes
    /// @param reserve The reserve address
    /// @param amount The backing amount to set
    function setBackingForTesting(address reserve, uint256 amount) external {
        backing[reserve] = amount;
    }

    /// @notice Set minted amount for a reserve for testing purposes
    /// @param reserve The reserve address
    /// @param amount The minted amount to set (in satoshis)
    function setMintedForTesting(address reserve, uint256 amount) external {
        minted[reserve] = amount;
        reserveMinted[reserve] = amount;
    }
    
    /// @notice Check if a reserve is authorized
    /// @param reserve The reserve address to check
    /// @return True if the reserve is authorized
    function isReserveAuthorized(address reserve) external view returns (bool) {
        return authorized[reserve];
    }
    /// @notice Mock implementation of mintTBTC function
    /// @param user The user receiving minted TBTC
    /// @param amount The amount of TBTC being minted (in wei)
    /// @dev Tracks total minted amount globally, not per-caller
    /// @return satoshis The amount converted to satoshis
    function mintTBTC(address user, uint256 amount) external whenNotPaused returns (uint256 satoshis) {
        // Convert tBTC amount to satoshis
        satoshis = amount / 1e10;

        // Track total minted amount globally when AccountControl is enabled
        if (accountControlEnabled) {
            // Check authorization - throw custom error instead of require
            if (!authorized[msg.sender]) revert QCNotRegistered(msg.sender);
            
            // Check minting cap - simplified for testing
            // In production, QCMinter handles cap checks at QC level
            if (mintingCaps[msg.sender] > 0) {
                require(minted[msg.sender] + satoshis <= mintingCaps[msg.sender], "Minting cap exceeded");
            }

            // Enforce backing >= minted invariant
            require(
                backing[msg.sender] >= minted[msg.sender] + satoshis,
                "Insufficient backing for mint"
            );

            totalMinted += satoshis;
            minted[msg.sender] += satoshis;
            reserveMinted[msg.sender] += satoshis;
        }

        // Create bank balance for the user
        // Bank expects tBTC amounts (18 decimals), not satoshis
        if (address(bank) != address(0)) {
            bank.increaseBalance(user, amount);
        }

        emit TBTCMinted(user, amount, satoshis);
        emit MintExecuted(msg.sender, user, satoshis);
        return satoshis;
    }

    /// @notice Mock implementation of redeemTBTC function
    /// @param amount The amount of TBTC being redeemed (in wei)
    /// @dev For QCRedeemer integration - reduces minted from the QCRedeemer's balance
    /// @return success True if redemption was successful
    function redeemTBTC(uint256 amount) external whenNotPaused returns (bool success) {
        // Amount is in wei - convert to satoshis for consistency
        uint256 satoshis = amount / 1e10;

        // Only enforce limits when AccountControl is enabled
        if (accountControlEnabled) {
            // Check if reserve has sufficient minted balance
            if (minted[msg.sender] < satoshis) {
                revert InsufficientMinted(minted[msg.sender], satoshis);
            }

            // Update both global and per-reserve minted balance
            totalMinted -= satoshis;
            minted[msg.sender] -= satoshis;
            reserveMinted[msg.sender] -= satoshis;
        }

        emit TBTCRedeemed(msg.sender, amount);
        emit RedemptionProcessed(msg.sender, satoshis);
        return true;
    }

    /// @notice Mock implementation of notifyRedemption function
    /// @param reserve The reserve address that is redeeming
    /// @param amount The amount being redeemed in satoshis
    /// @dev Mock version that allows any caller for testing flexibility
    function notifyRedemption(
        address reserve,
        uint256 amount
    ) external whenNotPaused returns (bool) {
        uint256 satoshis = amount; // Amount is in satoshis

        // Only enforce limits when AccountControl is enabled
        if (accountControlEnabled) {
            // Check if reserve has sufficient minted balance
            if (minted[reserve] < satoshis) {
                revert InsufficientMinted(minted[reserve], satoshis);
            }

            // Update both global and per-reserve minted balance
            totalMinted -= satoshis;
            minted[reserve] -= satoshis;
            reserveMinted[reserve] -= satoshis;
        }

        emit RedemptionProcessed(reserve, satoshis);
        return true;
    }

    /// @notice Event emitted when TBTC is minted
    event TBTCMinted(address indexed user, uint256 amount, uint256 satoshis);

    /// @notice Event emitted when TBTC is redeemed
    event TBTCRedeemed(address indexed redeemer, uint256 amount);
    
    /// @notice Event emitted when mint is executed (matches real AccountControl)
    event MintExecuted(address indexed reserve, address indexed recipient, uint256 amount);
    
    /// @notice Event emitted when redemption is processed (matches real AccountControl)
    event RedemptionProcessed(address indexed reserve, uint256 amount);
    
    /// @notice Event emitted when a reserve is authorized (matches real AccountControl)
    event ReserveAuthorized(address indexed reserve, uint256 mintingCap);
    
    /// @notice Authorize a reserve with type
    function authorizeReserve(address reserve, uint256 mintingCap, ReserveType /* rType */) external {
        if (reserve == address(0)) revert QCNotRegistered(reserve);
        authorized[reserve] = true;
        mintingCaps[reserve] = mintingCap;
        emit ReserveAuthorized(reserve, mintingCap);
    }
    
    /// @notice Set minting cap for a reserve
    function setMintingCap(address reserve, uint256 newCap) external {
        mintingCaps[reserve] = newCap;
    }
    
    /// @notice Set backing for a reserve
    function setBacking(address reserve, uint256 amount) external {
        backing[reserve] = amount;
    }
    
    /// @notice Get backing for a reserve
    function getBacking(address reserve) external view returns (uint256) {
        return backing[reserve];
    }
    
    /// @notice Get reserve info
    function reserveInfo(address reserve) external view returns (
        bool isAuthorized,
        uint256 mintingCap,
        uint256 backingAmount
    ) {
        return (authorized[reserve], mintingCaps[reserve], backing[reserve]);
    }
    
    /// @notice System pause state
    uint256 public systemPaused;
    
    /// @notice Check if an address has a specific role (always returns true for testing)
    function hasRole(bytes32 /* role */, address account) external view returns (bool) {
        return authorized[account];
    }
    
    /// @notice Core mint function
    /// @param amount Amount to mint in satoshis (matching real AccountControl interface)
    function mint(address recipient, uint256 amount) external whenNotPaused returns (bool) {
        uint256 satoshis = amount; // Amount is in satoshis
        if (accountControlEnabled) {
            // Check authorization - throw custom error instead of require
            if (!authorized[msg.sender]) revert QCNotRegistered(msg.sender);
            
            // Check minting cap - simplified for testing
            // In production, QCMinter handles cap checks at QC level
            if (mintingCaps[msg.sender] > 0) {
                require(minted[msg.sender] + satoshis <= mintingCaps[msg.sender], "Minting cap exceeded");
            }

            // Enforce backing >= minted invariant
            require(
                backing[msg.sender] >= minted[msg.sender] + satoshis,
                "Insufficient backing for mint"
            );

            totalMinted += satoshis;
            minted[msg.sender] += satoshis;
            reserveMinted[msg.sender] += satoshis;
        }
        
        // Create bank balance for the recipient
        // Convert satoshis to tBTC (wei) for bank interface
        uint256 tbtcAmount = satoshis * 1e10;
        if (address(bank) != address(0)) {
            bank.increaseBalance(recipient, tbtcAmount);
        }

        emit TBTCMinted(recipient, tbtcAmount, satoshis);
        emit MintExecuted(msg.sender, recipient, satoshis);
        return true;
    }
    
    /// @notice Core redeem function
    /// @param amount Amount to redeem in satoshis (matching real AccountControl interface)
    function redeem(uint256 amount) external whenNotPaused returns (bool) {
        uint256 satoshis = amount; // Amount is in satoshis

        // Only enforce limits when AccountControl is enabled
        if (accountControlEnabled) {
            // Check if reserve has sufficient minted balance
            if (minted[msg.sender] < satoshis) {
                revert InsufficientMinted(minted[msg.sender], satoshis);
            }

            // Update both global and per-reserve minted balance
            totalMinted -= satoshis;
            minted[msg.sender] -= satoshis;
            reserveMinted[msg.sender] -= satoshis;
        }

        emit TBTCRedeemed(msg.sender, satoshis);
        emit RedemptionProcessed(msg.sender, satoshis);
        return true;
    }
    
    /// @notice Update backing function
    function updateBacking(uint256 amount) external whenNotPaused {
        backing[msg.sender] = amount;
    }
    
    /// @notice Get total minted amount (different from totalMinted)
    function totalMintedAmount() external view returns (uint256) {
        return totalMinted;
    }
    
    /// @notice Pause system
    function pauseSystem() external {
        systemPaused = 1;
    }
    
    /// @notice Unpause system
    function unpauseSystem() external {
        systemPaused = 0;
    }
    
    /// @notice Check if reserve can operate
    function canOperate(address reserve) external view returns (bool) {
        return authorized[reserve] && systemPaused == 0;
    }
    
    /// @notice Pause reserve (no-op for mock)
    function pauseReserve(address reserve) external {
        // Mock implementation - do nothing
    }
    
    /// @notice Unpause reserve (no-op for mock)
    function unpauseReserve(address reserve) external {
        // Mock implementation - do nothing
    }
    
    /// @notice Deauthorize reserve
    function deauthorizeReserve(address reserve) external {
        authorized[reserve] = false;
    }
    

    /// @notice Set pause state for testing
    function setPaused(bool _paused) external {
        paused = _paused;
    }

    /// @notice Mock implementation of grantRedeemerRole (no-op for testing)
    function grantRedeemerRole(address redeemer) external {
        // Mock implementation - always succeeds for testing flexibility
        // In real implementation, this would grant REDEEMER_ROLE
    }

    /// @notice Mock implementation of revokeRedeemerRole (no-op for testing)
    function revokeRedeemerRole(address redeemer) external {
        // Mock implementation - always succeeds for testing flexibility
        // In real implementation, this would revoke REDEEMER_ROLE
    }
}