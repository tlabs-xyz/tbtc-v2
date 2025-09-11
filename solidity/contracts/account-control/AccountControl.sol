// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title AccountControl
 * @notice Minimal invariant enforcer ensuring backing >= minted for each reserve
 * @dev Part of tBTC V2 Account Control system
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
    uint256 public constant RATE_LIMIT_WINDOW = 3600; // 1 hour

    // ========== STATE VARIABLES ==========
    /*
     * STORAGE LAYOUT DOCUMENTATION (CRITICAL FOR UPGRADEABILITY)
     * 
     * DO NOT MODIFY THE ORDER OR TYPE OF EXISTING VARIABLES.
     * ONLY ADD NEW VARIABLES AT THE END TO MAINTAIN UPGRADE SAFETY.
     * 
     * Current storage slots (estimated):
     * Slots 0-1: Initializable base contract storage
     * Slots 2-3: UUPSUpgradeable base contract storage  
     * Slots 4-5: ReentrancyGuardUpgradeable base contract storage
     * Slots 6-7: OwnableUpgradeable base contract storage
     * 
     * AccountControl-specific storage starts around slot 8:
     */
    
    // Core accounting (slots ~8-9)
    mapping(address => uint256) public backing;        // Slot 8: Reserve backing amounts in satoshis
    mapping(address => uint256) public minted;         // Slot 9: Reserve minted amounts in satoshis
    
    // Authorization and limits (slots ~10-12)
    mapping(address => bool) public authorized;        // Slot 10: Reserve authorization status
    mapping(address => uint256) public mintingCaps;    // Slot 11: Per-reserve minting caps
    uint256 public globalMintingCap;                   // Slot 12: Global minting cap
    
    // Reserve tracking (slots ~13-14)
    address[] public reserveList;                      // Slot 13: Array of authorized reserves
    uint256 public totalMintedAmount;                  // Slot 14: Optimized total minted tracking
    
    // Pause states (slots ~15-16)
    mapping(address => bool) public paused;           // Slot 15: Per-reserve pause status
    bool public systemPaused;                         // Slot 16: System-wide pause status
    
    // Rate limiting (slot ~17)
    mapping(address => uint256) public lastBackingUpdate; // Slot 17: Rate limiting timestamps
    
    // Governance (slots ~18-20)
    address public emergencyCouncil;                  // Slot 18: Emergency council address
    address public bank;                              // Slot 19: Bank contract address  
    uint256 public deploymentBlock;                   // Slot 20: Deployment block number
    
    // Watchdog system (slot ~21)
    mapping(address => bool) public watchdogs;        // Slot 21: Authorized watchdog addresses
    
    // Event optimization (slot ~22)
    bool public emitIndividualEvents;                 // Slot 22: Individual event emission toggle
    
    /*
     * END OF V1 STORAGE LAYOUT
     * 
     * ANY NEW VARIABLES MUST BE ADDED BELOW THIS COMMENT
     * TO MAINTAIN UPGRADE COMPATIBILITY
     */

    // ========== EVENTS ==========
    event MintExecuted(address indexed reserve, address indexed recipient, uint256 amount);
    event BatchMintExecuted(address indexed reserve, uint256 recipientCount, uint256 totalAmount);
    event BackingUpdated(address indexed reserve, uint256 amount);
    event ReserveAuthorized(address indexed reserve, uint256 mintingCap);
    event ReservePaused(address indexed reserve);
    event ReserveUnpaused(address indexed reserve);
    event MintingCapUpdated(address indexed reserve, uint256 oldCap, uint256 newCap);
    event GlobalMintingCapUpdated(uint256 cap);
    event ViolationReported(address indexed watchdog, address indexed reserve, string violation);
    event WatchdogAuthorized(address indexed watchdog);
    event WatchdogRevoked(address indexed watchdog);
    event EmergencyCouncilUpdated(address indexed oldCouncil, address indexed newCouncil);
    event RedemptionProcessed(address indexed reserve, uint256 amount);
    event ReserveDeauthorized(address indexed reserve);

    // ========== ERRORS ==========
    error InsufficientBacking();
    error ExceedsReserveCap();
    error ExceedsGlobalCap();
    error NotAuthorized();
    error ReserveIsPaused();
    error SystemIsPaused();
    error AmountTooSmall();
    error AmountTooLarge();
    error ArrayLengthMismatch();
    error BatchSizeExceeded();
    error RateLimitExceeded();
    error AlreadyAuthorized();
    error NotAWatchdog();
    error ZeroAddress();
    error InsufficientMinted();
    error ReserveNotFound();

    // ========== MODIFIERS ==========
    modifier onlyAuthorizedReserve() {
        if (!authorized[msg.sender]) revert NotAuthorized();
        if (paused[msg.sender]) revert ReserveIsPaused();
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
        if (_owner == address(0)) revert ZeroAddress();
        if (_emergencyCouncil == address(0)) revert ZeroAddress();
        if (_bank == address(0)) revert ZeroAddress();
        
        __Ownable_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        
        _transferOwnership(_owner);
        emergencyCouncil = _emergencyCouncil;
        bank = _bank;
        deploymentBlock = block.number;
    }

    // ========== RESERVE MANAGEMENT ==========
    
    function authorizeReserve(address reserve, uint256 mintingCap) 
        external 
        onlyOwner 
    {
        if (authorized[reserve]) revert AlreadyAuthorized();
        
        authorized[reserve] = true;
        mintingCaps[reserve] = mintingCap;
        reserveList.push(reserve);
        
        emit ReserveAuthorized(reserve, mintingCap);
    }

    function deauthorizeReserve(address reserve) 
        external 
        onlyOwner 
    {
        if (!authorized[reserve]) revert ReserveNotFound();
        
        authorized[reserve] = false;
        mintingCaps[reserve] = 0;
        
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
        // Prevent reducing cap below current minted amount
        if (newCap < minted[reserve]) {
            revert ExceedsReserveCap(); // Reusing existing error for consistency
        }
        
        uint256 oldCap = mintingCaps[reserve];
        mintingCaps[reserve] = newCap;
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
        if (amount < MIN_MINT_AMOUNT) revert AmountTooSmall();
        if (amount > MAX_SINGLE_MINT) revert AmountTooLarge();
        
        // Check backing invariant
        if (backing[msg.sender] < minted[msg.sender] + amount) {
            revert InsufficientBacking();
        }
        
        // Check caps
        if (minted[msg.sender] + amount > mintingCaps[msg.sender]) {
            revert ExceedsReserveCap();
        }
        
        if (globalMintingCap > 0 && totalMintedAmount + amount > globalMintingCap) {
            revert ExceedsGlobalCap();
        }
        
        // Update state
        minted[msg.sender] += amount;
        totalMintedAmount += amount;
        
        // Mint tokens via Bank
        IBank(bank).increaseBalance(recipient, amount);
        
        emit MintExecuted(msg.sender, recipient, amount);
        return true;
    }

    function batchMint(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyAuthorizedReserve nonReentrant returns (bool) {
        if (recipients.length != amounts.length) revert ArrayLengthMismatch();
        if (recipients.length > MAX_BATCH_SIZE) revert BatchSizeExceeded();
        
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] < MIN_MINT_AMOUNT) revert AmountTooSmall();
            if (amounts[i] > MAX_SINGLE_MINT) revert AmountTooLarge();
            totalAmount += amounts[i];
        }
        
        // Check backing invariant for total
        if (backing[msg.sender] < minted[msg.sender] + totalAmount) {
            revert InsufficientBacking();
        }
        
        // Check caps for total
        if (minted[msg.sender] + totalAmount > mintingCaps[msg.sender]) {
            revert ExceedsReserveCap();
        }
        
        if (globalMintingCap > 0 && totalMintedAmount + totalAmount > globalMintingCap) {
            revert ExceedsGlobalCap();
        }
        
        // Execute batch mints first to ensure atomicity
        // If any Bank call fails, entire transaction reverts before state changes
        try IBank(bank).batchIncreaseBalance(recipients, amounts) {
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
        
        // Individual events for detailed tracking (optional based on monitoring needs)
        if (emitIndividualEvents) {
            for (uint256 i = 0; i < recipients.length; i++) {
                emit MintExecuted(msg.sender, recipients[i], amounts[i]);
            }
        }
        
        return true;
    }

    // ========== BACKING MANAGEMENT ==========
    
    function updateBacking(uint256 amount) 
        external 
        onlyAuthorizedReserve 
    {
        // Rate limiting
        if (lastBackingUpdate[msg.sender] > 0) {
            if (block.timestamp < lastBackingUpdate[msg.sender] + RATE_LIMIT_WINDOW) {
                revert RateLimitExceeded();
            }
        }
        
        backing[msg.sender] = amount;
        lastBackingUpdate[msg.sender] = block.timestamp;
        
        emit BackingUpdated(msg.sender, amount);
    }

    function redeem(uint256 amount) 
        external 
        onlyAuthorizedReserve 
        returns (bool)
    {
        if (minted[msg.sender] < amount) revert InsufficientMinted();
        
        // Update state
        minted[msg.sender] -= amount;
        totalMintedAmount -= amount;
        
        emit RedemptionProcessed(msg.sender, amount);
        return true;
    }

    function adjustMinted(uint256 amount, bool increase) 
        external 
        onlyAuthorizedReserve 
    {
        if (increase) {
            minted[msg.sender] += amount;
            totalMintedAmount += amount;
        } else {
            require(minted[msg.sender] >= amount, "Underflow protection");
            minted[msg.sender] -= amount;
            totalMintedAmount -= amount;
        }
    }

    // ========== PAUSE FUNCTIONALITY ==========
    
    function pauseReserve(address reserve) 
        external 
        onlyOwnerOrEmergencyCouncil 
    {
        paused[reserve] = true;
        emit ReservePaused(reserve);
    }

    function unpauseReserve(address reserve) 
        external 
        onlyOwner 
    {
        paused[reserve] = false;
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

    // ========== WATCHDOG FUNCTIONS ==========
    
    function authorizeWatchdog(address watchdog) 
        external 
        onlyOwner 
    {
        watchdogs[watchdog] = true;
        emit WatchdogAuthorized(watchdog);
    }

    function revokeWatchdog(address watchdog) 
        external 
        onlyOwner 
    {
        watchdogs[watchdog] = false;
        emit WatchdogRevoked(watchdog);
    }

    function reportViolation(address reserve, string calldata violation) 
        external 
    {
        if (!watchdogs[msg.sender]) revert NotAWatchdog();
        emit ViolationReported(msg.sender, reserve, violation);
    }

    // ========== VIEW FUNCTIONS ==========
    
    function totalMinted() public view returns (uint256) {
        return totalMintedAmount;
    }

    function getTotalSupply() external view returns (uint256) {
        return IBank(bank).totalSupply();
    }

    function canOperate(address reserve) external view returns (bool) {
        return authorized[reserve] && !paused[reserve] && !systemPaused;
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
            uint256 availableToMint
        ) 
    {
        isAuthorized = authorized[reserve];
        isPaused = paused[reserve];
        backingAmount = backing[reserve];
        mintedAmount = minted[reserve];
        mintingCap = mintingCaps[reserve];
        
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
        if (newCouncil == address(0)) revert ZeroAddress();
        address oldCouncil = emergencyCouncil;
        emergencyCouncil = newCouncil;
        emit EmergencyCouncilUpdated(oldCouncil, newCouncil);
    }
    
    function setIndividualEventEmission(bool enabled) 
        external 
        onlyOwner 
    {
        emitIndividualEvents = enabled;
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
    function batchIncreaseBalance(address[] calldata accounts, uint256[] calldata amounts) external;
    function totalSupply() external view returns (uint256);
}