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

    // ========== ENUMS ==========
    /// @dev TODO: We considered using string-based reserve types to avoid requiring 
    /// contract upgrades when adding new types, but since this contract is upgradeable 
    /// via UUPS, enums provide better type safety and gas efficiency while still 
    /// allowing future type additions through upgrades.
    enum ReserveType {
        QC,           // Qualified Custodian
        ALLOWLISTED,  // Allowlisted reserve
        L2_BRIDGE     // L2 bridge reserve
    }

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
    
    struct ReserveInfo {
        uint256 mintingCap;
        ReserveType reserveType;
    }
    mapping(address => ReserveInfo) public reserveInfo; // Slot 11: Reserve info with type
    uint256 public globalMintingCap;                   // Slot 12: Global minting cap
    
    // Reserve tracking (slots ~13-14)
    address[] public reserveList;                      // Slot 13: Array of authorized reserves
    uint256 public totalMintedAmount;                  // Slot 14: Optimized total minted tracking
    
    // Pause states (slots ~15-16)
    mapping(address => bool) public paused;           // Slot 15: Per-reserve pause status
    bool public systemPaused;                         // Slot 16: System-wide pause status
    
    // Oracle integration (slot ~17)
    address public reserveOracle;                     // Slot 17: ReserveOracle contract address
    
    // Governance (slots ~18-20)
    address public emergencyCouncil;                  // Slot 18: Emergency council address
    address public bank;                              // Slot 19: Bank contract address  
    uint256 public deploymentBlock;                   // Slot 20: Deployment block number
    
    // Slot ~21 available for future use
    
    // Event optimization (slot ~22)
    bool public emitIndividualEvents;                 // Slot 22: Individual event emission toggle
    
    /*
     * END OF V1 STORAGE LAYOUT
     * 
     * ANY NEW VARIABLES MUST BE ADDED BELOW THIS COMMENT
     * TO MAINTAIN UPGRADE COMPATIBILITY
     */
    
    // Reserve type system (slots ~23-24)
    mapping(ReserveType => bool) public validReserveTypes;   // Slot 23: Valid reserve types
    ReserveType[] public reserveTypeList;                   // Slot 24: List of all reserve types

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
    event ReserveOracleUpdated(address indexed oldOracle, address indexed newOracle);
    event RedemptionProcessed(address indexed reserve, uint256 amount);
    event ReserveDeauthorized(address indexed reserve);
    event ReserveTypeAdded(string indexed reserveType);
    event ReserveTypeSet(address indexed reserve, string reserveType);
    event ReserveTypeChanged(address indexed reserve, string oldType, string newType);

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
    error AlreadyAuthorized();
    error NotAWatchdog();
    error ZeroAddress();
    error InsufficientMinted();
    error ReserveNotFound();
    error InvalidReserveType();
    error ReserveTypeExists();

    // ========== MODIFIERS ==========
    modifier onlyAuthorizedReserve() {
        if (!authorized[msg.sender]) revert NotAuthorized();
        if (paused[msg.sender]) revert ReserveIsPaused();
        if (systemPaused) revert SystemIsPaused();
        _;
    }

    modifier onlyReserveOracle() {
        if (msg.sender != reserveOracle) revert NotAuthorized();
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
    
    function authorizeReserve(address reserve, uint256 mintingCap, string calldata reserveType) 
        external 
        onlyOwner 
    {
        if (authorized[reserve]) revert AlreadyAuthorized();
        if (!validReserveTypes[reserveType]) revert InvalidReserveType();
        
        authorized[reserve] = true;
        reserveInfo[reserve] = ReserveInfo({
            mintingCap: mintingCap,
            reserveType: reserveType
        });
        reserveList.push(reserve);
        
        emit ReserveAuthorized(reserve, mintingCap);
        emit ReserveTypeSet(reserve, reserveType);
    }

    function deauthorizeReserve(address reserve) 
        external 
        onlyOwner 
    {
        if (!authorized[reserve]) revert ReserveNotFound();
        
        authorized[reserve] = false;
        delete reserveInfo[reserve];
        
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

    // ========== RESERVE TYPE MANAGEMENT ==========
    
    function addReserveType(string calldata reserveType) 
        external 
        onlyOwner 
    {
        if (validReserveTypes[reserveType]) revert ReserveTypeExists();
        if (bytes(reserveType).length == 0) revert ZeroAddress(); // Reuse error for empty string
        
        validReserveTypes[reserveType] = true;
        reserveTypeList.push(reserveType);
        
        emit ReserveTypeAdded(reserveType);
    }

    function setReserveType(address reserve, string calldata newType) 
        external 
        onlyOwner 
    {
        if (!authorized[reserve]) revert NotAuthorized();
        if (!validReserveTypes[newType]) revert InvalidReserveType();
        
        string memory oldType = reserveInfo[reserve].reserveType;
        reserveInfo[reserve].reserveType = newType;
        
        emit ReserveTypeChanged(reserve, oldType, newType);
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
        if (minted[msg.sender] + amount > reserveInfo[msg.sender].mintingCap) {
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
        if (minted[msg.sender] + totalAmount > reserveInfo[msg.sender].mintingCap) {
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
    
    /// @notice Update QC backing amount based on oracle consensus
    /// @param qc The QC address to update
    /// @param amount The new backing amount from oracle consensus
    /// @dev Only callable by authorized ReserveOracle
    function updateBackingFromOracle(address qc, uint256 amount) 
        external 
        onlyReserveOracle 
    {
        if (!authorized[qc]) revert NotAuthorized();
        
        backing[qc] = amount;
        
        emit BackingUpdated(qc, amount);
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
            uint256 availableToMint,
            string memory reserveType
        ) 
    {
        ReserveInfo memory info = reserveInfo[reserve];
        
        isAuthorized = authorized[reserve];
        isPaused = paused[reserve];
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

    function getReservesByType(string calldata reserveType) 
        external 
        view 
        returns (address[] memory) 
    {
        if (!validReserveTypes[reserveType]) revert InvalidReserveType();
        
        // Count first
        uint256 count = 0;
        for (uint256 i = 0; i < reserveList.length; i++) {
            if (keccak256(bytes(reserveInfo[reserveList[i]].reserveType)) == keccak256(bytes(reserveType))) {
                count++;
            }
        }
        
        // Populate array
        address[] memory typeReserves = new address[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < reserveList.length; i++) {
            if (keccak256(bytes(reserveInfo[reserveList[i]].reserveType)) == keccak256(bytes(reserveType))) {
                typeReserves[index] = reserveList[i];
                index++;
            }
        }
        
        return typeReserves;
    }

    function getReserveTypeStats() 
        external 
        view 
        returns (string[] memory types, uint256[] memory counts, uint256[] memory totalMintedByType) 
    {
        types = new string[](reserveTypeList.length);
        counts = new uint256[](reserveTypeList.length);
        totalMintedByType = new uint256[](reserveTypeList.length);
        
        for (uint256 i = 0; i < reserveTypeList.length; i++) {
            types[i] = reserveTypeList[i];
            
            // Count reserves and total minted for this type
            for (uint256 j = 0; j < reserveList.length; j++) {
                if (keccak256(bytes(reserveInfo[reserveList[j]].reserveType)) == keccak256(bytes(reserveTypeList[i]))) {
                    counts[i]++;
                    totalMintedByType[i] += minted[reserveList[j]];
                }
            }
        }
    }

    function getReserveTypeCount() external view returns (uint256) {
        return reserveTypeList.length;
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

    function setReserveOracle(address newReserveOracle) 
        external 
        onlyOwner 
    {
        if (newReserveOracle == address(0)) revert ZeroAddress();
        reserveOracle = newReserveOracle;
        emit ReserveOracleUpdated(reserveOracle, newReserveOracle);
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