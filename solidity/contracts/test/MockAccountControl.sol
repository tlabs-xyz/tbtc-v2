// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title Mock AccountControl contract for testing
/// @notice Mock implementation that tracks global minted amount for all users
/// @dev In the real system, QCs mint on behalf of users, not for themselves
contract MockAccountControl {
    /// @notice Track total minted amount globally (in satoshis)
    /// @dev This represents the total tBTC minted through the AccountControl system
    uint256 public totalMinted;

    /// @notice Track whether AccountControl integration is enabled
    bool public accountControlEnabled = true;

    /// @notice Track backing amounts for reserves (for testing)
    mapping(address => uint256) public backing;
    
    /// @notice Track authorization status of reserves
    mapping(address => bool) public authorized;
    
    /// @notice Track minting caps for reserves
    mapping(address => uint256) public mintingCaps;

    /// @notice Pause state for testing
    bool public paused = false;

    /// @notice Custom error for insufficient minted balance
    error InsufficientMinted(uint256 available, uint256 requested);

    /// @notice Modifier to check if contract is not paused
    modifier whenNotPaused() {
        require(!paused, "Contract paused");
        _;
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
    }
    /// @notice Mock implementation of mintTBTC function
    /// @param user The user receiving minted TBTC
    /// @param amount The amount of TBTC being minted
    /// @dev Tracks total minted amount globally, not per-caller
    /// @return satoshis The amount in satoshis (converted from tBTC)
    function mintTBTC(address user, uint256 amount) external whenNotPaused returns (uint256 satoshis) {
        // Convert tBTC (18 decimals) to satoshis (8 decimals)
        satoshis = amount / 1e10;

        // Track total minted amount globally when AccountControl is enabled
        if (accountControlEnabled) {
            // Check authorization
            require(authorized[msg.sender], "Reserve not authorized");
            
            // Check minting cap
            require(minted[msg.sender] + satoshis <= mintingCaps[msg.sender], "Minting cap exceeded");
            
            // Enforce backing >= minted invariant
            require(
                backing[msg.sender] >= minted[msg.sender] + satoshis,
                "Insufficient backing for mint"
            );
            
            totalMinted += satoshis;
            minted[msg.sender] += satoshis;
        }

        emit TBTCMinted(user, amount, satoshis);
        return satoshis;
    }

    /// @notice Mock implementation of redeemTBTC function
    /// @param amount The amount of TBTC being redeemed (in tBTC wei)
    /// @dev Checks against global totalMinted, as users redeem what was minted for them
    /// @return success True if redemption was successful
    function redeemTBTC(uint256 amount) external whenNotPaused returns (bool success) {
        // Convert tBTC amount to satoshis for comparison
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
        }

        emit TBTCRedeemed(msg.sender, amount);
        return true;
    }

    /// @notice Event emitted when TBTC is minted
    event TBTCMinted(address indexed user, uint256 amount, uint256 satoshis);

    /// @notice Event emitted when TBTC is redeemed
    event TBTCRedeemed(address indexed redeemer, uint256 amount);
    
    /// @notice Authorize a reserve
    function authorizeReserve(address reserve, uint256 mintingCap) external {
        authorized[reserve] = true;
        mintingCaps[reserve] = mintingCap;
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
    
    /// @notice Track minted amounts per reserve
    mapping(address => uint256) public minted;
    
    /// @notice System pause state
    uint256 public systemPaused;
    
    /// @notice Core mint function
    function mint(address recipient, uint256 amount) external whenNotPaused returns (bool) {
        uint256 satoshis = amount / 1e10;
        if (accountControlEnabled) {
            // Check authorization
            require(authorized[msg.sender], "Reserve not authorized");
            
            // Check minting cap
            require(minted[msg.sender] + satoshis <= mintingCaps[msg.sender], "Minting cap exceeded");
            
            // Enforce backing >= minted invariant
            require(
                backing[msg.sender] >= minted[msg.sender] + satoshis,
                "Insufficient backing for mint"
            );
            
            totalMinted += satoshis;
            minted[msg.sender] += satoshis;
        }
        emit TBTCMinted(recipient, amount, satoshis);
        return true;
    }
    
    /// @notice Core redeem function
    function redeem(uint256 amount) external whenNotPaused returns (bool) {
        // Convert tBTC amount to satoshis for comparison
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
        }

        emit TBTCRedeemed(msg.sender, amount);
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
    
    /// @notice Credit minted amount for separated operations
    function creditMinted(uint256 amount) external whenNotPaused {
        uint256 satoshis = amount / 1e10;
        
        if (accountControlEnabled) {
            // Check authorization
            require(authorized[msg.sender], "Reserve not authorized");
            
            // Check minting cap
            require(minted[msg.sender] + satoshis <= mintingCaps[msg.sender], "Minting cap exceeded");
            
            // Enforce backing >= minted invariant
            require(
                backing[msg.sender] >= minted[msg.sender] + satoshis,
                "Insufficient backing for mint"
            );
        }
        
        totalMinted += satoshis;
        minted[msg.sender] += satoshis;
    }
    
    /// @notice Debit minted amount for separated operations
    function debitMinted(uint256 amount) external whenNotPaused {
        uint256 satoshis = amount / 1e10;
        if (totalMinted >= satoshis) {
            totalMinted -= satoshis;
        }
        if (minted[msg.sender] >= satoshis) {
            minted[msg.sender] -= satoshis;
        }
    }

    /// @notice Set pause state for testing
    function setPaused(bool _paused) external {
        paused = _paused;
    }
}