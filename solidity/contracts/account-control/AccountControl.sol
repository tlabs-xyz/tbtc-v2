// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title AccountControl
 * @notice Minimal invariant enforcer ensuring backing >= minted for each reserve
 * @dev Part of tBTC Account Control system
 */
contract AccountControl is 
    Initializable, 
    UUPSUpgradeable, 
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable 
{
    // ========== CONSTANTS ==========
    uint256 public constant MIN_MINT_AMOUNT = 10**4; // 0.0001 BTC in satoshis
    uint256 public constant MAX_SINGLE_MINT = 100 * 10**8; // 100 BTC in satoshis
    uint256 public constant MAX_BATCH_SIZE = 100;
    uint256 public constant SATOSHI_MULTIPLIER = 1e10; // Converts tBTC (1e18) to satoshis (1e8)

    // ========== ENUMS ==========
    /// @dev Reserve types use enums for type safety and gas efficiency.
    /// Since this contract is upgradeable via UUPS, additional types can be 
    /// added through upgrades while maintaining type safety.
    enum ReserveType {
        UNINITIALIZED,   // Default/uninitialized state (0)
        QC_PERMISSIONED  // Qualified Custodian with permissioned access
    }

    // ========== STATE VARIABLES ==========
    /*
     * STORAGE LAYOUT DOCUMENTATION (CRITICAL FOR UPGRADEABILITY)
     * 
     * DO NOT MODIFY THE ORDER OR TYPE OF EXISTING VARIABLES.
     * ONLY ADD NEW VARIABLES AT THE END TO MAINTAIN UPGRADE SAFETY.
     * 
     * Based on actual OpenZeppelin v4.8.1 upgradeable contracts:
     * Slot 0: Initializable._initialized (uint8) + Initializable._initializing (bool) + padding
     * Slot 1: ReentrancyGuardUpgradeable._status (uint256)
     * Slot 2: OwnableUpgradeable._owner (address) + padding  
     * Slots 3-52: UUPSUpgradeable.__gap[50] (reserved slots)
     * Slots 53-101: ReentrancyGuardUpgradeable.__gap[49] (reserved slots)
     * Slots 102-150: OwnableUpgradeable.__gap[49] (reserved slots)
     * 
     * AccountControl-specific storage starts at slot 151:
     */
    
    // Core accounting (slots 151-152)
    mapping(address => uint256) public backing;        // Slot 151: Reserve backing amounts in satoshis
    mapping(address => uint256) public minted;         // Slot 152: Reserve minted amounts in satoshis
    
    // Authorization and limits (slots 153-155)
    mapping(address => bool) public authorized;        // Slot 153: Reserve authorization status
    
    struct ReserveInfo {
        uint256 mintingCap;
        ReserveType reserveType;
        bool paused;
    }
    mapping(address => ReserveInfo) public reserveInfo; // Slot 154: Reserve info with type and pause status
    uint256 public globalMintingCap;                   // Slot 155: Global minting cap
    
    // Reserve tracking (slots 156-157)
    address[] public reserveList;                      // Slot 156: Array of authorized reserves
    uint256 public totalMintedAmount;                  // Slot 157: Optimized total minted tracking
    
    // Pause states (slot 158)
    bool public systemPaused;                         // Slot 158: System-wide pause status
    
    // Slot 159: Available for future use (previously reserveOracle - removed for V2 minimal design)
    
    // Governance (slots 160-162)
    address public emergencyCouncil;                  // Slot 160: Emergency council address
    address public bank;                              // Slot 161: Bank contract address  
    uint256 public deploymentBlock;                   // Slot 162: Deployment block number
    
    // Slot 163: Available for future use (event optimization removed for simplicity)
    
    /*
     * END OF CORE STORAGE LAYOUT
     * 
     * ANY ADDITIONAL VARIABLES MUST BE ADDED BELOW THIS COMMENT
     * TO MAINTAIN UPGRADE COMPATIBILITY
     */
    
    // Slots 165-167: Available for future use (reserve type management simplified)

    // ========== EVENTS ==========
    event MintExecuted(address indexed reserve, address indexed recipient, uint256 amount);
    event BatchMintExecuted(address indexed reserve, uint256 recipientCount, uint256 totalAmount);
    event BackingUpdated(address indexed reserve, uint256 amount);
    event ReserveAuthorized(address indexed reserve, uint256 mintingCap);
    event ReservePaused(address indexed reserve);
    event ReserveUnpaused(address indexed reserve);
    event MintingCapUpdated(address indexed reserve, uint256 oldCap, uint256 newCap);
    event GlobalMintingCapUpdated(uint256 cap);
    event EmergencyCouncilUpdated(address indexed oldCouncil, address indexed newCouncil);
    event RedemptionProcessed(address indexed reserve, uint256 amount);
    event ReserveDeauthorized(address indexed reserve);

    // ========== ERRORS ==========
    error InsufficientBacking(uint256 available, uint256 required);
    error ExceedsReserveCap(uint256 requested, uint256 available);
    error ExceedsGlobalCap(uint256 requested, uint256 available);
    error NotAuthorized(address caller);
    error ReserveIsPaused(address reserve);
    error SystemIsPaused();
    error AmountTooSmall(uint256 amount, uint256 minimum);
    error AmountTooLarge(uint256 amount, uint256 maximum);
    error ArrayLengthMismatch(uint256 recipientsLength, uint256 amountsLength);
    error BatchSizeExceeded(uint256 size, uint256 maximum);
    error AlreadyAuthorized(address reserve);
    error ZeroAddress(string parameter);
    error InsufficientMinted(uint256 available, uint256 requested);
    error ReserveNotFound(address reserve);
    error CannotDeauthorizeWithOutstandingBalance(address reserve, uint256 outstandingAmount);

    // ========== MODIFIERS ==========
    modifier onlyAuthorizedReserve() {
        if (!authorized[msg.sender]) revert NotAuthorized(msg.sender);
        if (reserveInfo[msg.sender].paused) revert ReserveIsPaused(msg.sender);
        if (systemPaused) revert SystemIsPaused();
        _;
    }


    modifier onlyOwnerOrEmergencyCouncil() {
        require(
            msg.sender == owner() || msg.sender == emergencyCouncil,
            "Unauthorized"
        );
        _;
    }

    // ========== INITIALIZATION ==========
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _emergencyCouncil,
        address _bank
    ) public initializer {
        if (_owner == address(0)) revert ZeroAddress("owner");
        if (_emergencyCouncil == address(0)) revert ZeroAddress("emergencyCouncil");
        if (_bank == address(0)) revert ZeroAddress("bank");
        
        __Ownable_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        
        _transferOwnership(_owner);
        emergencyCouncil = _emergencyCouncil;
        bank = _bank;
        deploymentBlock = block.number;
        
        // Reserve types managed through upgrades - QC_PERMISSIONED is default and only type in V2
    }

    // ========== RESERVE MANAGEMENT ==========
    
    /// @notice Authorize a reserve for minting operations (QC_PERMISSIONED type)
    /// @param reserve The address of the reserve to authorize  
    /// @param mintingCap The maximum amount this reserve can mint
    function authorizeReserve(address reserve, uint256 mintingCap) 
        external 
        onlyOwner 
    {
        if (authorized[reserve]) revert AlreadyAuthorized(reserve);
        if (mintingCap == 0) revert AmountTooSmall(mintingCap, 1); // Prevent zero caps, use pause instead
        
        authorized[reserve] = true;
        reserveInfo[reserve] = ReserveInfo({
            mintingCap: mintingCap,
            reserveType: ReserveType.QC_PERMISSIONED,
            paused: false
        });
        reserveList.push(reserve);
        
        emit ReserveAuthorized(reserve, mintingCap);
    }

    function deauthorizeReserve(address reserve) 
        external 
        onlyOwner 
    {
        if (!authorized[reserve]) revert ReserveNotFound(reserve);
        
        // Safety check: cannot deauthorize reserves with outstanding minted balances
        // Reserves must be wound down to zero before deauthorization to prevent accounting inconsistencies
        if (minted[reserve] > 0) revert CannotDeauthorizeWithOutstandingBalance(reserve, minted[reserve]);
        
        authorized[reserve] = false;
        delete reserveInfo[reserve];
        delete backing[reserve]; // Clear backing to prevent accounting issues
        
        // Remove from reserveList
        for (uint256 i = 0; i < reserveList.length; i++) {
            if (reserveList[i] == reserve) {
                reserveList[i] = reserveList[reserveList.length - 1];
                reserveList.pop();
                break;
            }
        }
        
        emit ReserveDeauthorized(reserve);
    }

    function setMintingCap(address reserve, uint256 newCap) 
        external 
        onlyOwner 
    {
        // Check that reserve is authorized
        if (!authorized[reserve]) revert NotAuthorized(msg.sender);
        
        // Prevent zero caps - use pause functionality instead
        if (newCap == 0) revert AmountTooSmall(newCap, 1);
        
        // Prevent reducing cap below current minted amount to maintain system invariant (minted <= cap)
        // Use pauseReserve() for immediate risk reduction; caps can only be lowered after natural redemptions
        if (newCap < minted[reserve]) {
            revert ExceedsReserveCap(minted[reserve], newCap); // Minted amount exceeds cap
        }
        
        // Validate against global cap if set
        if (globalMintingCap > 0) {
            uint256 totalOtherCaps = _calculateTotalCapsExcluding(reserve);
            if (totalOtherCaps + newCap > globalMintingCap) {
                revert ExceedsGlobalCap(totalOtherCaps + newCap, globalMintingCap);
            }
        }
        
        uint256 oldCap = reserveInfo[reserve].mintingCap;
        reserveInfo[reserve].mintingCap = newCap;
        emit MintingCapUpdated(reserve, oldCap, newCap);
    }

    function setGlobalMintingCap(uint256 cap) 
        external 
        onlyOwner 
    {
        globalMintingCap = cap;
        emit GlobalMintingCapUpdated(cap);
    }


    // ========== MINTING OPERATIONS ==========
    
    function mint(address recipient, uint256 amount) 
        external 
        onlyAuthorizedReserve 
        nonReentrant 
        returns (bool)
    {
        // Validate amount
        if (amount < MIN_MINT_AMOUNT) revert AmountTooSmall(amount, MIN_MINT_AMOUNT);
        if (amount > MAX_SINGLE_MINT) revert AmountTooLarge(amount, MAX_SINGLE_MINT);
        
        // Check backing invariant
        if (backing[msg.sender] < minted[msg.sender] + amount) {
            revert InsufficientBacking(backing[msg.sender], minted[msg.sender] + amount);
        }
        
        // Check caps
        if (minted[msg.sender] + amount > reserveInfo[msg.sender].mintingCap) {
            revert ExceedsReserveCap(minted[msg.sender] + amount, reserveInfo[msg.sender].mintingCap);
        }
        
        if (globalMintingCap > 0 && totalMintedAmount + amount > globalMintingCap) {
            revert ExceedsGlobalCap(totalMintedAmount + amount, globalMintingCap);
        }
        
        // Update state
        minted[msg.sender] += amount;
        totalMintedAmount += amount;
        
        // Mint tokens via Bank
        IBank(bank).increaseBalance(recipient, amount);
        
        emit MintExecuted(msg.sender, recipient, amount);
        return true;
    }

    /// @notice Mint tBTC tokens by converting to satoshis internally
    /// @dev This function accepts tBTC amounts (18 decimals) and converts them to satoshis (8 decimals)
    /// @param recipient Address to receive the minted tokens
    /// @param tbtcAmount Amount in tBTC units (1e18 precision)
    /// @return satoshis Amount converted to satoshis for event emission
    function mintTBTC(address recipient, uint256 tbtcAmount) 
        external 
        onlyAuthorizedReserve 
        nonReentrant 
        returns (uint256 satoshis)
    {
        // Convert tBTC to satoshis internally
        satoshis = tbtcAmount / SATOSHI_MULTIPLIER;
        this.mint(recipient, satoshis);
        return satoshis;
    }

    function batchMint(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyAuthorizedReserve nonReentrant returns (bool) {
        if (recipients.length != amounts.length) revert ArrayLengthMismatch(recipients.length, amounts.length);
        if (recipients.length > MAX_BATCH_SIZE) revert BatchSizeExceeded(recipients.length, MAX_BATCH_SIZE);
        
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] < MIN_MINT_AMOUNT) revert AmountTooSmall(amounts[i], MIN_MINT_AMOUNT);
            if (amounts[i] > MAX_SINGLE_MINT) revert AmountTooLarge(amounts[i], MAX_SINGLE_MINT);
            totalAmount += amounts[i];
        }
        
        // Check backing invariant for total
        if (backing[msg.sender] < minted[msg.sender] + totalAmount) {
            revert InsufficientBacking(backing[msg.sender], minted[msg.sender] + totalAmount);
        }
        
        // Check caps for total
        if (minted[msg.sender] + totalAmount > reserveInfo[msg.sender].mintingCap) {
            revert ExceedsReserveCap(minted[msg.sender] + totalAmount, reserveInfo[msg.sender].mintingCap);
        }
        
        if (globalMintingCap > 0 && totalMintedAmount + totalAmount > globalMintingCap) {
            revert ExceedsGlobalCap(totalMintedAmount + totalAmount, globalMintingCap);
        }
        
        // Execute batch mints first to ensure atomicity
        // If any Bank call fails, entire transaction reverts
        try IBank(bank).increaseBalances(recipients, amounts) {
            // Batch call succeeded
        } catch {
            // Fallback to individual calls if batch not supported
            for (uint256 i = 0; i < recipients.length; i++) {
                IBank(bank).increaseBalance(recipients[i], amounts[i]);
            }
        }
        
        // Update state only after all Bank calls succeed
        minted[msg.sender] += totalAmount;
        totalMintedAmount += totalAmount;
        
        // Emit batch event for gas efficiency
        emit BatchMintExecuted(msg.sender, recipients.length, totalAmount);
        
        return true;
    }

    // ========== BACKING MANAGEMENT ==========
    
    /// @notice Allow authorized reserves to update their own backing amounts
    /// @param amount The new backing amount 
    /// @dev Only callable by the reserve itself (federated architecture)
    function updateBacking(uint256 amount) 
        external 
        onlyAuthorizedReserve 
    {
        backing[msg.sender] = amount;
        
        emit BackingUpdated(msg.sender, amount);
    }

    function redeem(uint256 amount) 
        external 
        onlyAuthorizedReserve 
        returns (bool)
    {
        if (minted[msg.sender] < amount) revert InsufficientMinted(minted[msg.sender], amount);
        
        // Update state
        minted[msg.sender] -= amount;
        totalMintedAmount -= amount;
        
        emit RedemptionProcessed(msg.sender, amount);
        return true;
    }

    /// @notice Redeem tBTC tokens by converting to satoshis internally
    /// @dev This function accepts tBTC amounts (18 decimals) and converts them to satoshis (8 decimals)
    /// @param tbtcAmount Amount in tBTC units (1e18 precision)
    /// @return success True if redemption was successful
    function redeemTBTC(uint256 tbtcAmount) 
        external 
        onlyAuthorizedReserve 
        returns (bool success)
    {
        // Convert tBTC to satoshis internally
        uint256 satoshis = tbtcAmount / SATOSHI_MULTIPLIER;
        return this.redeem(satoshis);
    }


    // ========== PAUSE FUNCTIONALITY ==========
    // Asymmetric security: EmergencyCouncil can pause (fast response), only Owner can unpause (deliberate recovery)
    
    function pauseReserve(address reserve) 
        external 
        onlyOwnerOrEmergencyCouncil 
    {
        reserveInfo[reserve].paused = true;
        emit ReservePaused(reserve);
    }

    function unpauseReserve(address reserve) 
        external 
        onlyOwner 
    {
        reserveInfo[reserve].paused = false;
        emit ReserveUnpaused(reserve);
    }

    function pauseSystem() 
        external 
        onlyOwnerOrEmergencyCouncil 
    {
        systemPaused = true;
    }

    function unpauseSystem() 
        external 
        onlyOwner 
    {
        systemPaused = false;
    }


    // ========== VIEW FUNCTIONS ==========
    
    function totalMinted() public view returns (uint256) {
        return totalMintedAmount;
    }

    function getTotalSupply() external view returns (uint256) {
        // Bank contract does not have totalSupply()
        // Return total minted amount as best approximation
        // Note: For actual tBTC total supply, query TBTCVault directly
        return totalMintedAmount;
    }

    function canOperate(address reserve) external view returns (bool) {
        return authorized[reserve] && !reserveInfo[reserve].paused && !systemPaused;
    }

    function getReserveCount() external view returns (uint256) {
        return reserveList.length;
    }

    function getReserveStats(address reserve) 
        external 
        view 
        returns (
            bool isAuthorized,
            bool isPaused,
            uint256 backingAmount,
            uint256 mintedAmount,
            uint256 mintingCap,
            uint256 availableToMint,
            ReserveType reserveType
        ) 
    {
        ReserveInfo memory info = reserveInfo[reserve];
        
        isAuthorized = authorized[reserve];
        isPaused = info.paused;
        backingAmount = backing[reserve];
        mintedAmount = minted[reserve];
        mintingCap = info.mintingCap;
        reserveType = info.reserveType;
        
        // Calculate available to mint considering backing and cap
        uint256 backingAvailable = 0;
        if (backingAmount > mintedAmount) {
            backingAvailable = backingAmount - mintedAmount;
        }
        
        uint256 capAvailable = 0;
        if (mintingCap > mintedAmount) {
            capAvailable = mintingCap - mintedAmount;
        }
        
        availableToMint = backingAvailable < capAvailable ? backingAvailable : capAvailable;
    }






    // ========== GOVERNANCE ==========
    
    function setEmergencyCouncil(address newCouncil) 
        external 
        onlyOwner 
    {
        if (newCouncil == address(0)) revert ZeroAddress("emergencyCouncil");
        address oldCouncil = emergencyCouncil;
        emergencyCouncil = newCouncil;
        emit EmergencyCouncilUpdated(oldCouncil, newCouncil);
    }


    // ========== INTERNAL HELPER FUNCTIONS ==========
    
    /// @notice Calculate total minting caps of all authorized reserves excluding the specified reserve
    /// @param excludeReserve Reserve to exclude from calculation
    /// @return totalCaps Sum of all other authorized reserves' minting caps
    function _calculateTotalCapsExcluding(address excludeReserve) internal view returns (uint256 totalCaps) {
        // OPTIMIZATION PROPOSAL: This function has O(n) gas cost that grows with the number of reserves.
        // For large numbers of reserves, this could become expensive.
        //
        // PROPOSED SOLUTION:
        // 1. Add cached storage variable: uint256 public totalMintingCapsCache;
        // 2. Update cache in authorizeReserve(): totalMintingCapsCache += mintingCap;
        // 3. Update cache in deauthorizeReserve(): totalMintingCapsCache -= reserveInfo[reserve].mintingCap;
        // 4. Update cache in setMintingCap(): totalMintingCapsCache = totalMintingCapsCache - oldCap + newCap;
        // 5. Replace this function: return totalMintingCapsCache - reserveInfo[excludeReserve].mintingCap;
        //
        // TRADEOFFS:
        // - PRO: O(1) gas cost, much more predictable
        // - PRO: Scales to unlimited number of reserves
        // - CON: Additional storage slot (~20k gas for first write)
        // - CON: More complex state management across multiple functions
        // - CON: Risk of cache desync if not maintained carefully
        //
        // RECOMMENDATION: Implement if expecting >10 reserves, otherwise current solution acceptable.
        
        for (uint256 i = 0; i < reserveList.length; i++) {
            address reserve = reserveList[i];
            if (reserve != excludeReserve && authorized[reserve]) {
                totalCaps += reserveInfo[reserve].mintingCap;
            }
        }
    }

    // ========== UPGRADEABILITY ==========
    
    function _authorizeUpgrade(address newImplementation) 
        internal 
        override 
        onlyOwner 
    {}
}

// ========== INTERFACES ==========

interface IBank {
    function increaseBalance(address account, uint256 amount) external;
    function increaseBalances(address[] calldata accounts, uint256[] calldata amounts) external;
    // Note: Bank contract does not have totalSupply() - this will be handled by TBTCVault
}