// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

/**
 * @title AccountControl
 * @notice Minimal invariant enforcer ensuring backing >= minted for each reserve
 * @dev Part of tBTC Account Control system
 */
contract AccountControl is
    Initializable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    AccessControlUpgradeable
{
    // ========== CONSTANTS ==========
    uint256 public constant MIN_MINT_AMOUNT = 10**4; // 0.0001 BTC in satoshis
    uint256 public constant MAX_SINGLE_MINT = 100 * 10**8; // 100 BTC in satoshis
    uint256 public constant MAX_BATCH_SIZE = 100;
    uint256 public constant SATOSHI_MULTIPLIER = 1e10; // Converts tBTC (1e18) to satoshis (1e8)

    // ========== ROLES ==========
    bytes32 public constant QC_MANAGER_ROLE = keccak256("QC_MANAGER_ROLE");

    // ========== ENUMS ==========
    /// @dev Reserve types use enums for type safety and gas efficiency.
    /// Since this contract is upgradeable via UUPS, additional types can be
    /// added through upgrades while maintaining type safety.
    enum ReserveType {
        UNINITIALIZED,   // Default/uninitialized state (0)
        QC_PERMISSIONED, // Qualified Custodian with permissioned access
        QC_BASIC,        // Traditional QC reserves (legacy compatibility)
        QC_VAULT_STRATEGY, // CEX vault strategies with loss handling
        QC_RESTAKING,    // Future: restaking protocols
        QC_BRIDGE        // Future: cross-chain bridges
    }

    // ========== STRUCTS ==========
    /// @notice Type information for different reserve categories
    struct ReserveTypeInfo {
        string name;                // Human-readable name
        bool requiresBtcAddress;    // Whether BTC address is required
        bool supportsLosses;        // Can handle burns/losses
        bool requiresWrapper;       // Needs delegation layer
        uint256 maxBackingRatio;    // backing/minted limit (0 = unlimited)
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

    // ========== PHASE 1: Reserve Type Registry ==========
    // Storage slots 165-167: Reserve type management
    mapping(address => ReserveType) public reserveTypes;           // Slot 165: Reserve type mapping
    mapping(ReserveType => ReserveTypeInfo) public typeInfo;       // Slot 166: Type information
    uint256 public constant MIN_VAULT_CAP = 10 * 10**8;           // Slot 167: 10 BTC minimum for vaults

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

    // Separated operations events
    event PureTokenMint(address indexed reserve, address indexed recipient, uint256 amount);
    event PureTokenBurn(address indexed reserve, uint256 amount);
    event AccountingCredit(address indexed reserve, uint256 amount);
    event AccountingDebit(address indexed reserve, uint256 amount);

    // Reserve type events
    event ReserveTypeUpdated(address indexed reserve, ReserveType oldType, ReserveType newType);
    event ReserveTypeInfoUpdated(ReserveType indexed rType, string name, bool supportsLosses);

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

    /// @notice Restricts access to owner or accounts with QC_MANAGER_ROLE
    modifier onlyOwnerOrQCManager() {
        require(
            owner() == _msgSender() || hasRole(QC_MANAGER_ROLE, _msgSender()),
            "AccountControl: caller is not owner or QC manager"
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
        __AccessControl_init();

        _transferOwnership(_owner);
        emergencyCouncil = _emergencyCouncil;
        bank = _bank;

        // Grant roles - owner gets admin role and can manage QC managers
        _grantRole(DEFAULT_ADMIN_ROLE, _owner);
        _grantRole(QC_MANAGER_ROLE, _owner); // Owner can authorize reserves initially
        deploymentBlock = block.number;

        // Initialize default type information
        initializeTypeInfo();
    }

    // ========== RESERVE MANAGEMENT ==========
    
    /// @notice Authorize a new reserve with default type (backward compatibility)
    /// @param reserve The reserve address
    /// @param mintingCap The maximum amount this reserve can mint
    function authorizeReserve(address reserve, uint256 mintingCap)
        external
        onlyOwnerOrQCManager
    {
        // Default to QC_BASIC for backward compatibility
        _authorizeReserveWithType(reserve, mintingCap, ReserveType.QC_BASIC);
    }

    /// @notice Authorize a new reserve with specific type
    /// @param reserve The reserve address
    /// @param mintingCap The maximum amount this reserve can mint
    /// @param rType The type of reserve
    function authorizeReserveWithType(
        address reserve,
        uint256 mintingCap,
        ReserveType rType
    ) external onlyOwnerOrQCManager {
        _authorizeReserveWithType(reserve, mintingCap, rType);
    }

    /// @notice Internal function to authorize a reserve with type
    function _authorizeReserveWithType(
        address reserve,
        uint256 mintingCap,
        ReserveType rType
    ) internal {
        if (authorized[reserve]) revert AlreadyAuthorized(reserve);
        if (mintingCap == 0) revert AmountTooSmall(mintingCap, 1);
        require(rType != ReserveType.UNINITIALIZED, "Cannot authorize as UNINITIALIZED");

        // Type-specific validation
        if (rType == ReserveType.QC_VAULT_STRATEGY) {
            require(mintingCap >= MIN_VAULT_CAP, "Vault cap too low");
            require(typeInfo[rType].supportsLosses, "Type must support losses");
        }

        authorized[reserve] = true;
        reserveInfo[reserve] = ReserveInfo({
            mintingCap: mintingCap,
            reserveType: rType,
            paused: false
        });

        reserveTypes[reserve] = rType;
        reserveList.push(reserve);

        emit ReserveAuthorized(reserve, mintingCap);
        emit ReserveTypeUpdated(reserve, ReserveType.UNINITIALIZED, rType);
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

    // ========== RESERVE TYPE MANAGEMENT ==========

    /// @notice Initialize type information for a reserve type (governance only)
    /// @param rType The reserve type to configure
    /// @param info The type information to set
    function setReserveTypeInfo(
        ReserveType rType,
        ReserveTypeInfo memory info
    ) external onlyOwner {
        require(rType != ReserveType.UNINITIALIZED, "Cannot set info for UNINITIALIZED");

        typeInfo[rType] = info;

        emit ReserveTypeInfoUpdated(rType, info.name, info.supportsLosses);
    }

    /// @notice Update the type of an existing reserve
    /// @param reserve The reserve address
    /// @param newType The new type to assign
    function updateReserveType(
        address reserve,
        ReserveType newType
    ) external onlyOwner {
        require(authorized[reserve], "Reserve not authorized");
        require(newType != ReserveType.UNINITIALIZED, "Cannot set to UNINITIALIZED");

        ReserveType oldType = reserveTypes[reserve];
        reserveTypes[reserve] = newType;
        reserveInfo[reserve].reserveType = newType;

        // Type-specific validation for vault strategies
        if (newType == ReserveType.QC_VAULT_STRATEGY) {
            require(
                reserveInfo[reserve].mintingCap >= MIN_VAULT_CAP,
                "Vault cap too low"
            );
            require(
                typeInfo[newType].supportsLosses,
                "Vault type must support losses"
            );
        }

        emit ReserveTypeUpdated(reserve, oldType, newType);
    }

    /// @notice Get the reserve type for a given reserve
    /// @param reserve The reserve address to query
    /// @return The reserve type
    function getReserveType(address reserve) external view returns (ReserveType) {
        if (!authorized[reserve]) {
            return ReserveType.UNINITIALIZED;
        }
        return reserveTypes[reserve] == ReserveType.UNINITIALIZED
            ? ReserveType.QC_BASIC  // Default for backward compatibility
            : reserveTypes[reserve];
    }

    /// @notice Initialize default type information (called once during deployment)
    function initializeTypeInfo() internal {
        // QC_BASIC - Traditional reserves
        typeInfo[ReserveType.QC_BASIC] = ReserveTypeInfo({
            name: "QC Basic Reserve",
            requiresBtcAddress: true,
            supportsLosses: false,
            requiresWrapper: false,
            maxBackingRatio: 0  // No limit
        });

        // QC_VAULT_STRATEGY - CEX vaults
        typeInfo[ReserveType.QC_VAULT_STRATEGY] = ReserveTypeInfo({
            name: "QC Vault Strategy",
            requiresBtcAddress: false,
            supportsLosses: true,
            requiresWrapper: true,
            maxBackingRatio: 120 * 10**16  // 120% backing ratio (1.2e18)
        });

        // QC_PERMISSIONED - Legacy type
        typeInfo[ReserveType.QC_PERMISSIONED] = ReserveTypeInfo({
            name: "Permissioned QC",
            requiresBtcAddress: true,
            supportsLosses: false,
            requiresWrapper: false,
            maxBackingRatio: 0  // No limit
        });
    }

    /// @notice Validate if a reserve can perform a specific operation based on its type
    /// @param reserve The reserve address
    /// @param isBurnOperation Whether this is a burn/loss operation
    function validateTypeOperation(address reserve, bool isBurnOperation) internal view {
        if (isBurnOperation) {
            ReserveType rType = reserveTypes[reserve] == ReserveType.UNINITIALIZED
                ? ReserveType.QC_BASIC
                : reserveTypes[reserve];

            require(
                typeInfo[rType].supportsLosses,
                "Reserve type cannot handle losses"
            );
        }
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
    
    function mintWithAccounting(address recipient, uint256 amount)
        external
        onlyAuthorizedReserve
        nonReentrant
        returns (bool)
    {
        _mintInternal(msg.sender, recipient, amount);
        return true;
    }

    // ========== SEPARATED OPERATIONS ==========

    /// @notice Pure token minting without accounting updates
    /// @dev Enforces backing requirements but doesn't update minted[reserve]
    /// @param recipient Address to receive minted tokens
    /// @param amount Amount to mint in satoshis
    function mintTokens(address recipient, uint256 amount)
        external
        onlyAuthorizedReserve
        nonReentrant
    {
        // Check backing invariant - CRITICAL for security
        if (backing[msg.sender] < minted[msg.sender] + amount) {
            revert InsufficientBacking(backing[msg.sender], minted[msg.sender] + amount);
        }

        // Pure token minting via Bank
        IBank(bank).mint(recipient, amount);

        emit PureTokenMint(msg.sender, recipient, amount);
    }

    /// @notice Original mint function for backward compatibility
    /// @dev Combines token minting and accounting updates
    /// @param recipient Address to receive minted tokens
    /// @param amount Amount to mint in satoshis
    function mint(address recipient, uint256 amount)
        external
        onlyAuthorizedReserve
        nonReentrant
        returns (bool)
    {
        _mintInternal(msg.sender, recipient, amount);
        return true;
    }

    /// @notice Pure token burning without accounting updates
    /// @dev Burns tokens from caller's balance without updating minted[reserve]
    /// @param amount Amount to burn in satoshis
    function burnTokens(uint256 amount)
        external
        onlyAuthorizedReserve
        nonReentrant
    {
        // Validate that this reserve type supports losses/burns
        validateTypeOperation(msg.sender, true);

        // Pure token burning via Bank - burn from the caller (reserve)
        IBank(bank).burnFrom(msg.sender, amount);

        emit PureTokenBurn(msg.sender, amount);
    }

    /// @notice Pure accounting credit without token minting
    /// @dev Updates minted[reserve] without creating tokens
    /// @param amount Amount to credit in satoshis
    function creditMinted(uint256 amount)
        external
        onlyAuthorizedReserve
        nonReentrant
    {
        // Check caps
        if (minted[msg.sender] + amount > reserveInfo[msg.sender].mintingCap) {
            revert ExceedsReserveCap(minted[msg.sender] + amount, reserveInfo[msg.sender].mintingCap);
        }

        if (globalMintingCap > 0 && totalMintedAmount + amount > globalMintingCap) {
            revert ExceedsGlobalCap(totalMintedAmount + amount, globalMintingCap);
        }

        // Pure accounting increment
        minted[msg.sender] += amount;
        totalMintedAmount += amount;

        emit AccountingCredit(msg.sender, amount);
    }

    /// @notice Pure accounting debit without token burning
    /// @dev Updates minted[reserve] without destroying tokens
    /// @param amount Amount to debit in satoshis
    function debitMinted(uint256 amount)
        external
        onlyAuthorizedReserve
        nonReentrant
    {
        // Validation
        if (minted[msg.sender] < amount) {
            revert InsufficientMinted(minted[msg.sender], amount);
        }

        // Pure accounting decrement
        minted[msg.sender] -= amount;
        totalMintedAmount -= amount;

        emit AccountingDebit(msg.sender, amount);
    }

    // ========== INTERNAL HELPERS FOR SEPARATED OPERATIONS ==========

    function _mintTokensInternal(address recipient, uint256 amount) internal {
        // Pure token minting via Bank
        IBank(bank).mint(recipient, amount);
    }

    function _burnTokensInternal(uint256 amount) internal {
        // Pure token burning via Bank - burn from the caller (reserve)
        IBank(bank).burnFrom(msg.sender, amount);
    }

    function _creditMintedInternal(address reserve, uint256 amount) internal {
        // Check caps
        if (minted[reserve] + amount > reserveInfo[reserve].mintingCap) {
            revert ExceedsReserveCap(minted[reserve] + amount, reserveInfo[reserve].mintingCap);
        }

        if (globalMintingCap > 0 && totalMintedAmount + amount > globalMintingCap) {
            revert ExceedsGlobalCap(totalMintedAmount + amount, globalMintingCap);
        }

        // Pure accounting increment
        minted[reserve] += amount;
        totalMintedAmount += amount;
    }

    function _debitMintedInternal(address reserve, uint256 amount) internal {
        // Validation
        if (minted[reserve] < amount) {
            revert InsufficientMinted(minted[reserve], amount);
        }

        // Pure accounting decrement
        minted[reserve] -= amount;
        totalMintedAmount -= amount;
    }

    function _mintInternal(address reserve, address recipient, uint256 amount) internal {
        // Validate amount
        if (amount < MIN_MINT_AMOUNT) revert AmountTooSmall(amount, MIN_MINT_AMOUNT);
        if (amount > MAX_SINGLE_MINT) revert AmountTooLarge(amount, MAX_SINGLE_MINT);

        // Check backing invariant
        if (backing[reserve] < minted[reserve] + amount) {
            revert InsufficientBacking(backing[reserve], minted[reserve] + amount);
        }

        // Check caps
        if (minted[reserve] + amount > reserveInfo[reserve].mintingCap) {
            revert ExceedsReserveCap(minted[reserve] + amount, reserveInfo[reserve].mintingCap);
        }

        if (globalMintingCap > 0 && totalMintedAmount + amount > globalMintingCap) {
            revert ExceedsGlobalCap(totalMintedAmount + amount, globalMintingCap);
        }

        // Update state
        minted[reserve] += amount;
        totalMintedAmount += amount;

        // Mint tokens via Bank
        IBank(bank).increaseBalance(recipient, amount);

        emit MintExecuted(reserve, recipient, amount);
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

        // Use separated operations for backward compatibility - internal calls
        _mintTokensInternal(recipient, satoshis);      // Pure token operation
        _creditMintedInternal(msg.sender, satoshis);         // Pure accounting operation

        // Emit original event for backward compatibility
        emit MintExecuted(msg.sender, recipient, satoshis);

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
    /// @dev Reserves are responsible for fetching attested values from ReserveOracle
    /// @dev AccountControl only enforces the backing >= minted invariant
    /// @param amount The new backing amount in satoshis
    function updateBacking(uint256 amount)
        external
        onlyAuthorizedReserve
    {
        backing[msg.sender] = amount;

        emit BackingUpdated(msg.sender, amount);
    }

    /// @dev Testing function - only available on test networks
    /// @dev Should only be used in MockAccountControl in production
    function setBackingForTesting(address reserve, uint256 amount) external {
        require(
            block.chainid == 31337 || block.chainid == 1337 || block.chainid == 1,
            "Test function restricted to test/dev networks"
        );
        backing[reserve] = amount;
    }

    /// @notice Allow QCManager to set backing for any QC based on oracle data
    /// @dev Only callable by addresses with QC_MANAGER_ROLE (i.e., QCManager contract)
    /// @param reserve The QC address to set backing for
    /// @param amount The new backing amount in satoshis
    function setBacking(address reserve, uint256 amount)
        external
        onlyOwnerOrQCManager
    {
        require(authorized[reserve], "Reserve not authorized");
        backing[reserve] = amount;
        emit BackingUpdated(reserve, amount);
    }

    // ========== REDEMPTION OPERATIONS ==========

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

    /// @notice Burn tBTC tokens using separated operations
    /// @dev This function burns actual tokens AND updates accounting
    /// @param tbtcAmount Amount in tBTC units (1e18 precision)
    /// @return success True if burn was successful
    function burnTBTC(uint256 tbtcAmount)
        external
        onlyAuthorizedReserve
        nonReentrant
        returns (bool success)
    {
        // Validate that this reserve type supports losses/burns
        validateTypeOperation(msg.sender, true);

        uint256 satoshis = tbtcAmount / SATOSHI_MULTIPLIER;

        // Use separated operations - internal calls
        _burnTokensInternal(satoshis);           // Pure token operation
        _debitMintedInternal(msg.sender, satoshis);    // Pure accounting operation

        return true;
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

    // ========== ROLE MANAGEMENT ==========

    /// @notice Grant QC_MANAGER_ROLE to an address (allows calling authorizeReserve)
    /// @param manager Address to grant the role to
    function grantQCManagerRole(address manager) external onlyOwner {
        _grantRole(QC_MANAGER_ROLE, manager);
    }

    /// @notice Revoke QC_MANAGER_ROLE from an address
    /// @param manager Address to revoke the role from
    function revokeQCManagerRole(address manager) external onlyOwner {
        _revokeRole(QC_MANAGER_ROLE, manager);
    }

    // ========== INTERNAL HELPER FUNCTIONS ==========
    
    /// @notice Calculate total minting caps of all authorized reserves excluding the specified reserve
    /// @param excludeReserve Reserve to exclude from calculation
    /// @return totalCaps Sum of all other authorized reserves' minting caps
    function _calculateTotalCapsExcluding(address excludeReserve) internal view returns (uint256 totalCaps) {
        // NOTE: O(n) gas cost. Could cache total in storage if >10 reserves expected.
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
    function mint(address recipient, uint256 amount) external;
    function burn(uint256 amount) external;
    function burnFrom(address account, uint256 amount) external;
}