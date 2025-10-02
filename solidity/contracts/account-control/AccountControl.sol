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

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./interfaces/IBankMintBurn.sol";

/**
 * @title AccountControl
 * @notice Invariant enforcer ensuring backing >= minted for each reserve
 * @dev Core contract of the tBTC Account Control system that maintains the critical invariant
 *      that total backing must be >= total minted for each reserve. This contract serves as
 *      the central coordination point for:
 *      - Reserve authorization and management
 *      - Minting capacity controls and validation
 *      - Backing amount synchronization with oracles
 *      - Redemption processing and accounting
 *      - Emergency pause functionality for security
 *
 * @custom:security-contact security@threshold.network
 * @custom:roles
 * - RESERVE_ROLE: Manages reserves (authorize, deauthorize, set caps)
 *   - Required by: QCManager
 *   - Permissions: authorizeReserve, deauthorizeReserve, setMintingCap
 *
 * - ORACLE_ROLE: Updates backing amounts from oracle attestations
 *   - Required by: QCManager (for syncBackingFromOracle)
 *   - Permissions: setBacking, batchSetBacking
 *
 * - REDEEMER_ROLE: Notifies redemptions to update minted amounts
 *   - Required by: QCRedeemer
 *   - Permissions: notifyRedemption
 *
 * - MINTER_ROLE: Mints tBTC tokens after validation
 *   - Required by: QCMinter
 *   - Permissions: mintTBTC
 *
 * - Owner: Full administrative control
 *   - Can grant/revoke all roles
 *   - Can perform all RESERVE_ROLE actions
 *   - Can set emergency council, update caps
 *
 * - EmergencyCouncil: Emergency response capabilities
 *   - Can pause/unpause reserves and system
 *   - Cannot unpause (only Owner can unpause)
 */
contract AccountControl is ReentrancyGuard, Ownable, AccessControl {
    using EnumerableSet for EnumerableSet.AddressSet;
    // =================== CONSTANTS ===================
    uint256 public constant MIN_MINT_AMOUNT = 10**4; /// @dev 0.0001 BTC in satoshis
    uint256 public constant MAX_SINGLE_MINT = 100 * 10**8; /// @dev 100 BTC in satoshis
    uint256 public constant SATOSHI_MULTIPLIER = 1e10; /// @dev Converts tBTC (1e18) to satoshis (1e8)

    // =================== ROLES ===================
    bytes32 public constant RESERVE_ROLE = keccak256("RESERVE_ROLE"); /// @dev Can authorize reserves, set caps, manage reserves
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE"); /// @dev Can update backing amounts from oracle data
    bytes32 public constant REDEEMER_ROLE = keccak256("REDEEMER_ROLE"); /// @dev Can notify redemptions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE"); /// @dev Can mint tBTC tokens

    // =================== ENUMS ===================
    /// @dev Reserve types use enums for type safety and gas efficiency.
    enum ReserveType {
        UNINITIALIZED, // Default/uninitialized state (0)
        QC_PERMISSIONED // Qualified Custodian with permissioned access
    }

    // =================== STATE VARIABLES ===================
    mapping(address => uint256) public backing; /// @dev Reserve backing amounts in satoshis
    mapping(address => uint256) public minted; /// @dev Reserve minted amounts in satoshis
    mapping(address => bool) public authorized; /// @dev Reserve authorization status
    
    bool public systemPaused; /// @dev System-wide pause status

    struct ReserveInfo {
        uint256 mintingCap;
        ReserveType reserveType;
        bool paused;
    }
    mapping(address => ReserveInfo) public reserveInfo; /// @dev Reserve info with type and pause status

    // Reserve tracking
    EnumerableSet.AddressSet private reserves; /// @dev Set of all authorized reserve addresses
    uint256 public totalMintedAmount; /// @dev Total amount minted across all reserves in satoshis

    // Governance
    address public emergencyCouncil; /// @dev Emergency council address for pause operations
    address public bank; /// @dev Bank contract address for token minting/burning

    // =================== EVENTS ===================
    event MintExecuted(
        address indexed reserve,
        address indexed recipient,
        uint256 indexed amount,
        address executor,
        uint256 timestamp
    );
    event BackingUpdated(
        address indexed reserve,
        uint256 indexed oldAmount,
        uint256 indexed newAmount,
        address updatedBy,
        uint256 timestamp
    );
    event ReserveAuthorized(
        address indexed reserve,
        uint256 indexed mintingCap,
        ReserveType reserveType,
        address indexed authorizedBy,
        uint256 timestamp
    );
    event ReservePaused(address indexed reserve, address pausedBy);
    event ReserveUnpaused(address indexed reserve, address unpausedBy);
    event MintingCapUpdated(
        address indexed reserve,
        uint256 indexed oldCap,
        uint256 indexed newCap,
        address updatedBy,
        uint256 timestamp
    );
    event EmergencyCouncilUpdated(
        address indexed oldCouncil,
        address indexed newCouncil,
        address updatedBy,
        uint256 timestamp
    );
    event RedemptionProcessed(
        address indexed reserve,
        uint256 indexed amount,
        address processedBy,
        uint256 timestamp
    );
    event ReserveDeauthorized(
        address indexed reserve,
        address indexed deauthorizedBy,
        uint256 timestamp
    );
    event SystemPaused(
        address indexed pausedBy,
        uint256 timestamp
    );
    event SystemUnpaused(
        address indexed unpausedBy,
        uint256 timestamp
    );
    event BackingViolationDetected(
        address indexed reserve,
        uint256 backing,
        uint256 minted,
        uint256 deficit
    );
    event GlobalCapBelowMinted(
        uint256 cap,
        uint256 totalMinted,
        uint256 deficit
    );
    event ReserveCapBelowMinted(
        address indexed reserve,
        uint256 cap,
        uint256 minted,
        uint256 deficit
    );
    event TotalMintedUpdated(
        uint256 indexed oldAmount,
        uint256 indexed newAmount,
        address updatedBy,
        uint256 timestamp
    );

    // =================== ERRORS ===================
    error InsufficientBacking(uint256 available, uint256 required);
    error ExceedsReserveCap(uint256 requested, uint256 available);
    error NotAuthorized(address caller);
    error ReserveIsPaused(address reserve);
    error SystemIsPaused();
    error AmountTooSmall(uint256 amount, uint256 minimum);
    error AmountTooLarge(uint256 amount, uint256 maximum);
    error AlreadyAuthorized(address reserve);
    error ZeroAddress(string parameter);
    error InsufficientMinted(uint256 available, uint256 requested);
    error ReserveNotFound(address reserve);
    error CannotDeauthorizeWithOutstandingBalance(
        address reserve,
        uint256 outstandingAmount
    );
    error UnsafeOperationSequence(string operation);
    error NotOwnerOrCouncil(address caller);
    error ArithmeticOverflow(string operation);

    // =================== MODIFIERS ===================

    /// @notice Restricts access to authorized reserves that are not paused and system is not paused
    modifier onlyAuthorizedReserve() {
        if (!authorized[msg.sender]) revert NotAuthorized(msg.sender);
        if (reserveInfo[msg.sender].paused) revert ReserveIsPaused(msg.sender);
        if (systemPaused) revert SystemIsPaused();
        _;
    }

    /// @notice Restricts access to contract owner or emergency council
    modifier onlyOwnerOrEmergencyCouncil() {
        if (msg.sender != owner() && msg.sender != emergencyCouncil) {
            revert NotOwnerOrCouncil(msg.sender);
        }
        _;
    }

    /// @notice Restricts access to owner or accounts with RESERVE_ROLE
    modifier onlyOwnerOrReserveManager() {
        if (!(owner() == _msgSender() || hasRole(RESERVE_ROLE, _msgSender()))) {
            revert NotAuthorized(_msgSender());
        }
        _;
    }

    // =================== CONSTRUCTOR ===================

    /// @notice Initialize AccountControl with owner, emergency council, and bank addresses
    /// @param _owner Address that will own the contract and have admin privileges
    /// @param _emergencyCouncil Address that can pause operations in emergencies
    /// @param _bank Address of the bank contract that handles token minting/burning
    constructor(
        address _owner,
        address _emergencyCouncil,
        address _bank
    ) {
        if (_owner == address(0)) revert ZeroAddress("owner");
        if (_emergencyCouncil == address(0))
            revert ZeroAddress("emergencyCouncil");
        if (_bank == address(0)) revert ZeroAddress("bank");

        _transferOwnership(_owner);
        emergencyCouncil = _emergencyCouncil;
        bank = _bank;

        // Grant roles - owner gets admin role and can manage reserves
        _grantRole(DEFAULT_ADMIN_ROLE, _owner);
        _grantRole(RESERVE_ROLE, _owner);
    }

    // =================== RESERVE MANAGEMENT ===================

    /// @notice Authorize a new reserve with specific type
    /// @param reserve The reserve address
    /// @param mintingCap The maximum amount this reserve can mint
    /// @param reserveType The type of reserve
    function authorizeReserve(
        address reserve,
        uint256 mintingCap,
        ReserveType reserveType
    ) external onlyOwnerOrReserveManager {
        _authorizeReserveWithType(reserve, mintingCap, reserveType);
    }

    /// @notice Internal function to authorize a reserve with type
    function _authorizeReserveWithType(
        address reserve,
        uint256 mintingCap,
        ReserveType reserveType
    ) internal {
        if (authorized[reserve]) revert AlreadyAuthorized(reserve);
        if (mintingCap == 0) revert AmountTooSmall(mintingCap, 1);
        require(reserveType != ReserveType.UNINITIALIZED, "Invalid type");

        authorized[reserve] = true;
        reserveInfo[reserve] = ReserveInfo({
            mintingCap: mintingCap,
            reserveType: reserveType,
            paused: false
        });
        reserves.add(reserve);

        emit ReserveAuthorized(reserve, mintingCap, reserveType, msg.sender, block.timestamp);
    }

    /// @notice Deauthorize a reserve and remove it from the system
    /// @dev Reserve must have zero minted balance before deauthorization
    /// @param reserve The reserve address to deauthorize
    function deauthorizeReserve(address reserve)
        external
        onlyOwnerOrReserveManager
    {
        if (!authorized[reserve]) revert ReserveNotFound(reserve);

        // Cannot deauthorize reserves with outstanding minted balances
        // Reserves must be wound down to zero before deauthorization to prevent accounting inconsistencies
        if (minted[reserve] > 0)
            revert CannotDeauthorizeWithOutstandingBalance(
                reserve,
                minted[reserve]
            );

        authorized[reserve] = false;
        delete reserveInfo[reserve];
        delete backing[reserve]; // Clear backing to prevent accounting issues

        // Remove from reserves set
        reserves.remove(reserve);

        emit ReserveDeauthorized(reserve, msg.sender, block.timestamp);
    }

    // =================== MINTING CAP MANAGEMENT ===================

    function setMintingCap(address reserve, uint256 newCap)
        external
        onlyOwnerOrReserveManager
    {
        if (!authorized[reserve]) revert NotAuthorized(reserve);

        // Prevent zero caps - use pause functionality instead
        if (newCap == 0) revert AmountTooSmall(newCap, 1);

        uint256 currentMinted = minted[reserve];

        // Prevent setting cap below current minted amount
        if (newCap < currentMinted) {
            revert ExceedsReserveCap(currentMinted, newCap);
        }

        uint256 oldCap = reserveInfo[reserve].mintingCap;
        reserveInfo[reserve].mintingCap = newCap;
        emit MintingCapUpdated(reserve, oldCap, newCap, msg.sender, block.timestamp);
    }


    // =================== INTERNAL HELPERS ===================

    /// @dev Internal function to mint tokens via Bank contract
    /// @param recipient Address to receive minted tokens
    /// @param amount Amount in satoshis to mint
    function _mintTokensInternal(address recipient, uint256 amount) internal {
        // Pure token minting via Bank
        // Convert satoshis back to tBTC (wei) for Bank interface
        uint256 tbtcAmount = _satoshisToTbtc(amount);
        IBankMintBurn(bank).mint(recipient, tbtcAmount);
    }

    /// @dev Internal function to burn tokens via Bank contract
    /// @param amount Amount in satoshis to burn
    function _burnTokensInternal(uint256 amount) internal {
        // Pure token burning via Bank - burn from the caller (reserve)
        // Convert satoshis back to tBTC (wei) for Bank interface
        uint256 tbtcAmount = _satoshisToTbtc(amount);
        IBankMintBurn(bank).burnFrom(msg.sender, tbtcAmount);
    }

    /// @dev Internal function to credit minted amount with backing and cap validation\n    /// @dev Critical accounting function that enforces core system invariants:\n    ///      1. Backing invariant: backing[reserve] >= minted[reserve] + amount\n    ///      2. Capacity limit: minted[reserve] + amount <= mintingCap[reserve]\n    ///      3. Atomic updates to both reserve and global minted totals\n    ///      4. Emits TotalMintedUpdated for external monitoring\n    ///      Used by separated operations pattern for precise accounting control.
    /// @param reserve Reserve address to credit
    /// @param amount Amount in satoshis to credit
    function _creditMintedInternal(address reserve, uint256 amount) internal {
        // Check backing sufficiency
        if (backing[reserve] < minted[reserve] + amount) {
            revert InsufficientBacking(
                backing[reserve],
                minted[reserve] + amount
            );
        }

        // Check caps
        if (minted[reserve] + amount > reserveInfo[reserve].mintingCap) {
            revert ExceedsReserveCap(
                minted[reserve] + amount,
                reserveInfo[reserve].mintingCap
            );
        }

        // Pure accounting increment
        uint256 oldTotalMinted = totalMintedAmount;
        minted[reserve] += amount;
        totalMintedAmount += amount;
        
        emit TotalMintedUpdated(oldTotalMinted, totalMintedAmount, msg.sender, block.timestamp);
    }

    /// @dev Internal function to debit minted amount with validation\n    /// @dev Critical accounting function for redemption and burn operations:\n    ///      1. Validates sufficient minted balance exists for debit\n    ///      2. Atomically decrements both reserve and global minted amounts\n    ///      3. Maintains accounting consistency during token burns\n    ///      4. Emits TotalMintedUpdated for external monitoring\n    ///      Used by separated operations pattern and redemption flows.
    /// @param reserve Reserve address to debit
    /// @param amount Amount in satoshis to debit
    function _debitMintedInternal(address reserve, uint256 amount) internal {
        // Validation
        if (minted[reserve] < amount) {
            revert InsufficientMinted(minted[reserve], amount);
        }

        // Pure accounting decrement
        uint256 oldTotalMinted = totalMintedAmount;
        minted[reserve] -= amount;
        totalMintedAmount -= amount;
        
        emit TotalMintedUpdated(oldTotalMinted, totalMintedAmount, msg.sender, block.timestamp);
    }

    /// @dev Internal function to handle complete minting process with all validations\n    /// @dev Business logic: Enforces critical invariants before minting:\n    ///      1. Amount bounds: MIN_MINT_AMOUNT <= amount <= MAX_SINGLE_MINT\n    ///      2. Backing invariant: backing[reserve] >= minted[reserve] + amount\n    ///      3. Capacity limits: minted[reserve] + amount <= mintingCap[reserve]\n    ///      4. Updates both reserve and global minted amounts atomically\n    ///      5. Converts satoshis to tBTC (wei) for Bank interface compatibility
    /// @param reserve Reserve requesting the mint
    /// @param recipient Address to receive minted tokens
    /// @param amount Amount in satoshis to mint
    function _mintInternal(
        address reserve,
        address recipient,
        uint256 amount
    ) internal {
        // Validate amount
        if (amount < MIN_MINT_AMOUNT)
            revert AmountTooSmall(amount, MIN_MINT_AMOUNT);
        if (amount > MAX_SINGLE_MINT)
            revert AmountTooLarge(amount, MAX_SINGLE_MINT);

        // Check backing invariant
        if (backing[reserve] < minted[reserve] + amount) {
            revert InsufficientBacking(
                backing[reserve],
                minted[reserve] + amount
            );
        }

        // Check caps
        if (minted[reserve] + amount > reserveInfo[reserve].mintingCap) {
            revert ExceedsReserveCap(
                minted[reserve] + amount,
                reserveInfo[reserve].mintingCap
            );
        }

        // Update state
        uint256 oldTotalMinted = totalMintedAmount;
        minted[reserve] += amount;
        totalMintedAmount += amount;
        
        emit TotalMintedUpdated(oldTotalMinted, totalMintedAmount, msg.sender, block.timestamp);

        // Mint tokens via Bank
        // Convert satoshis to tBTC (wei) for Bank interface
        uint256 tbtcAmount = _satoshisToTbtc(amount);
        IBankMintBurn(bank).mint(recipient, tbtcAmount);

        emit MintExecuted(reserve, recipient, amount, msg.sender, block.timestamp);
    }

    /// @notice Mint tBTC tokens by converting to satoshis internally
    /// @dev This function accepts tBTC amounts (18 decimals) and converts them to satoshis (8 decimals)
    /// @dev Only callable by addresses with MINTER_ROLE (QCMinter)
    /// @dev Business logic: Performs comprehensive validation before minting:
    ///      1. Role-based access control (MINTER_ROLE required)
    ///      2. Reserve authorization and pause status validation
    ///      3. System-wide pause status check
    ///      4. Precision validation (no fractional satoshis allowed)
    ///      5. Amount bounds validation (MIN_MINT_AMOUNT to MAX_SINGLE_MINT)
    ///      6. Backing sufficiency check (critical invariant enforcement)
    ///      7. Atomic minting and accounting updates via internal helpers
    /// @param reserve Address of the reserve requesting the mint
    /// @param recipient Address to receive the minted tokens
    /// @param tbtcAmount Amount in tBTC units (1e18 precision)
    /// @return satoshis Amount converted to satoshis for event emission
    function mintTBTC(address reserve, address recipient, uint256 tbtcAmount)
        external
        nonReentrant
        returns (uint256 satoshis)
    {
        // Only allow addresses with MINTER_ROLE (QCMinter) to call this function
        require(hasRole(MINTER_ROLE, msg.sender), "Caller must have MINTER_ROLE");
        
        // Validate reserve is authorized
        require(authorized[reserve], "Reserve not authorized");
        require(!reserveInfo[reserve].paused, "Reserve is paused");
        require(!systemPaused, "System is paused");

        // Ensure no precision loss
        require(tbtcAmount % SATOSHI_MULTIPLIER == 0, "Bad precision");

        // Convert tBTC to satoshis internally
        satoshis = _tbtcToSatoshis(tbtcAmount);

        // Validate minimum and maximum amounts
        if (satoshis < MIN_MINT_AMOUNT) {
            revert AmountTooSmall(satoshis, MIN_MINT_AMOUNT);
        }
        if (satoshis > MAX_SINGLE_MINT) {
            revert AmountTooLarge(satoshis, MAX_SINGLE_MINT);
        }

        // Check backing requirement
        if (backing[reserve] < minted[reserve] + satoshis) {
            revert InsufficientBacking(
                backing[reserve],
                minted[reserve] + satoshis
            );
        }

        _mintTokensInternal(recipient, satoshis);
        _creditMintedInternal(reserve, satoshis);

        // Emit original event for backward compatibility
        emit MintExecuted(reserve, recipient, satoshis, msg.sender, block.timestamp);

        return satoshis;
    }


    // =================== BACKING MANAGEMENT ===================

    /// @notice Allow authorized reserves to update their own backing amounts
    /// @dev Reserves are responsible for providing attested backing through their own mechanisms
    /// @dev Note: backing < minted indicates undercollateralization - emits violation for watchdog detection
    /// @param amount The new backing amount in satoshis
    function updateBacking(uint256 amount) external onlyAuthorizedReserve {
        uint256 oldAmount = backing[msg.sender];
        uint256 currentMinted = minted[msg.sender];
        backing[msg.sender] = amount;

        // Observe and report violations without preventing them
        if (amount < currentMinted) {
            emit BackingViolationDetected(
                msg.sender,
                amount,
                currentMinted,
                currentMinted - amount
            );
        }
        emit BackingUpdated(msg.sender, oldAmount, amount, msg.sender, block.timestamp);
    }

    /// @notice Allow oracles to set backing for any reserve based on attestation data
    /// @dev Only callable by addresses with ORACLE_ROLE
    /// @param reserve The reserve address to set backing for
    /// @param amount The new backing amount in satoshis
    function setBacking(address reserve, uint256 amount) external {
        require(hasRole(ORACLE_ROLE, _msgSender()), "Missing ORACLE_ROLE");
        require(authorized[reserve], "Not authorized");

        uint256 oldBacking = backing[reserve];
        backing[reserve] = amount;

        emit BackingUpdated(reserve, oldBacking, amount, msg.sender, block.timestamp);
    }

    /// @notice Batch update backing for multiple reserves
    /// @dev Only callable by addresses with ORACLE_ROLE
    /// @dev Gas optimized for updating multiple reserves in a single transaction
    /// @param reserveAddresses Array of reserve addresses to update
    /// @param amounts Array of new backing amounts in satoshis (must match reserves length)
    function batchSetBacking(
        address[] calldata reserveAddresses,
        uint256[] calldata amounts
    ) external {
        require(hasRole(ORACLE_ROLE, _msgSender()), "Missing ORACLE_ROLE");
        require(reserveAddresses.length == amounts.length, "Array length mismatch");
        require(reserveAddresses.length > 0, "Empty arrays");

        // Process each reserve update
        for (uint256 i = 0; i < reserveAddresses.length; i++) {
            if (authorized[reserveAddresses[i]]) {
                uint256 oldBacking = backing[reserveAddresses[i]];
                backing[reserveAddresses[i]] = amounts[i];
                emit BackingUpdated(reserveAddresses[i], oldBacking, amounts[i], msg.sender, block.timestamp);
            }
        }
    }

    // =================== REDEMPTION OPERATIONS ===================

    /// @notice Redeem tokens by reducing minted amount for the calling reserve
    /// @param amount Amount in satoshis to redeem
    /// @return True if redemption was successful
    function redeem(uint256 amount)
        public
        onlyAuthorizedReserve
        returns (bool)
    {
        if (minted[msg.sender] < amount)
            revert InsufficientMinted(minted[msg.sender], amount);

        // Update state
        uint256 oldTotalMinted = totalMintedAmount;
        minted[msg.sender] -= amount;
        totalMintedAmount -= amount;
        
        emit TotalMintedUpdated(oldTotalMinted, totalMintedAmount, msg.sender, block.timestamp);

        emit RedemptionProcessed(msg.sender, amount, msg.sender, block.timestamp);
        return true;
    }

    /// @notice Handle redemption notifications from external systems (e.g., QCRedeemer)
    /// @param reserve The reserve address that is redeeming
    /// @param amount The amount being redeemed in satoshis
    function notifyRedemption(address reserve, uint256 amount)
        external
        returns (bool)
    {
        // Only allow authorized contracts to call this function
        require(
            hasRole(REDEEMER_ROLE, msg.sender) ||
                hasRole(RESERVE_ROLE, msg.sender),
            "Unauthorized"
        );
        require(authorized[reserve], "Reserve not authorized");
        require(
            minted[reserve] >= amount,
            "Insufficient minted amount for redemption"
        );

        // Update state
        uint256 oldTotalMinted = totalMintedAmount;
        minted[reserve] -= amount;
        totalMintedAmount -= amount;
        
        emit TotalMintedUpdated(oldTotalMinted, totalMintedAmount, msg.sender, block.timestamp);

        emit RedemptionProcessed(reserve, amount, msg.sender, block.timestamp);
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
        // Ensure no precision loss
        require(tbtcAmount % SATOSHI_MULTIPLIER == 0, "Bad precision");

        // Convert tBTC to satoshis internally
        uint256 satoshis = _tbtcToSatoshis(tbtcAmount);
        return redeem(satoshis);
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
        // Ensure no precision loss
        require(tbtcAmount % SATOSHI_MULTIPLIER == 0, "Bad precision");

        uint256 satoshis = _tbtcToSatoshis(tbtcAmount);

        // Use separated operations - internal calls
        _burnTokensInternal(satoshis); // Pure token operation
        _debitMintedInternal(msg.sender, satoshis); // Pure accounting operation

        return true;
    }

    // =================== PAUSE FUNCTIONALITY ===================

    /// @notice Pause a specific reserve to prevent operations
    /// @param reserve Address of reserve to pause
    function pauseReserve(address reserve)
        external
        onlyOwnerOrEmergencyCouncil
    {
        reserveInfo[reserve].paused = true;
        emit ReservePaused(reserve, msg.sender);
    }

    /// @notice Unpause a specific reserve to restore operations
    /// @param reserve Address of reserve to unpause
    function unpauseReserve(address reserve) external onlyOwner {
        reserveInfo[reserve].paused = false;
        emit ReserveUnpaused(reserve, msg.sender);
    }

    /// @notice Pause the entire system to prevent all operations
    function pauseSystem() external onlyOwnerOrEmergencyCouncil {
        systemPaused = true;
        emit SystemPaused(msg.sender, block.timestamp);
    }

    /// @notice Unpause the entire system to restore all operations
    function unpauseSystem() external onlyOwner {
        systemPaused = false;
        emit SystemUnpaused(msg.sender, block.timestamp);
    }

    // =================== VIEW FUNCTIONS ===================

    /// @notice Get the total amount of tBTC minted across all reserves
    /// @return Total minted amount in satoshis
    function totalMinted() public view returns (uint256) {
        return totalMintedAmount;
    }

    /// @notice Check if a reserve is authorized
    /// @param reserve The reserve address to check
    /// @return True if the reserve is authorized, false otherwise
    function isReserveAuthorized(address reserve) external view returns (bool) {
        return authorized[reserve];
    }

    /// @notice Get the minting cap for a reserve
    /// @param reserve The reserve address
    /// @return The minting cap for the reserve in satoshis
    function mintingCaps(address reserve) external view returns (uint256) {
        return reserveInfo[reserve].mintingCap;
    }

    /// @notice Check if a reserve can perform operations (authorized, not paused, system not paused)
    /// @param reserve Address of reserve to check
    /// @return True if reserve can operate
    function canOperate(address reserve) external view returns (bool) {
        return
            authorized[reserve] &&
            !reserveInfo[reserve].paused &&
            !systemPaused;
    }

    /// @notice Get comprehensive statistics for a reserve\n    /// @dev Complex calculation function that provides complete reserve status:\n    ///      1. Retrieves authorization and pause status from storage\n    ///      2. Gets current backing, minted amounts, and capacity limits\n    ///      3. Calculates available minting capacity using min(backing_available, cap_available)\n    ///      4. Returns reserve type for classification purposes\n    ///      Used by external systems for reserve monitoring and capacity planning.
    /// @param reserve Address of reserve to query
    /// @return isAuthorized True if reserve is authorized
    /// @return isPaused True if reserve is paused
    /// @return backingAmount Current backing amount in satoshis
    /// @return mintedAmount Current minted amount in satoshis
    /// @return mintingCap Maximum minting capacity in satoshis
    /// @return availableToMint Amount available to mint considering backing and cap
    /// @return reserveType Type of the reserve
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

        availableToMint = backingAvailable < capAvailable
            ? backingAvailable
            : capAvailable;
    }

    // =================== GOVERNANCE ===================

    /// @notice Update the emergency council address
    /// @param newCouncil New emergency council address
    function setEmergencyCouncil(address newCouncil) external onlyOwner {
        if (newCouncil == address(0)) revert ZeroAddress("emergencyCouncil");
        address oldCouncil = emergencyCouncil;
        emergencyCouncil = newCouncil;
        emit EmergencyCouncilUpdated(oldCouncil, newCouncil, msg.sender, block.timestamp);
    }

    // =================== ROLE MANAGEMENT ===================

    /**
     * @notice Grant RESERVE_ROLE to an address
     * @dev Allows: authorizeReserve, deauthorizeReserve, setMintingCap
     * @dev Typically granted to: QCManager contract
     * @param manager Address to grant the role to
     */
    function grantReserveRole(address manager) external onlyOwner {
        _grantRole(RESERVE_ROLE, manager);
    }

    /**
     * @notice Revoke RESERVE_ROLE from an address
     * @param manager Address to revoke the role from
     */
    function revokeReserveRole(address manager) external onlyOwner {
        _revokeRole(RESERVE_ROLE, manager);
    }

    /**
     * @notice Grant ORACLE_ROLE to an address
     * @dev Allows: setBacking
     * @dev Typically granted to: QCManager or ReserveOracle contracts
     * @param oracle Address to grant the role to
     */
    function grantOracleRole(address oracle) external onlyOwner {
        _grantRole(ORACLE_ROLE, oracle);
    }

    /**
     * @notice Revoke ORACLE_ROLE from an address
     * @param oracle Address to revoke the role from
     */
    function revokeOracleRole(address oracle) external onlyOwner {
        _revokeRole(ORACLE_ROLE, oracle);
    }

    /**
     * @notice Grant REDEEMER_ROLE to an address
     * @dev Allows: notifyRedemption
     * @dev Typically granted to: QCRedeemer contract
     * @param redeemer Address to grant the role to
     */
    function grantRedeemerRole(address redeemer) external onlyOwner {
        _grantRole(REDEEMER_ROLE, redeemer);
    }

    /**
     * @notice Revoke REDEEMER_ROLE from an address
     * @param redeemer Address to revoke the role from
     */
    function revokeRedeemerRole(address redeemer) external onlyOwner {
        _revokeRole(REDEEMER_ROLE, redeemer);
    }

    /**
     * @notice Grant MINTER_ROLE to an address
     * @dev Allows: mintTBTC
     * @dev Typically granted to: QCMinter contract
     * @param minter Address to grant the role to
     */
    function grantMinterRole(address minter) external onlyOwner {
        _grantRole(MINTER_ROLE, minter);
    }

    /**
     * @notice Revoke MINTER_ROLE from an address
     * @param minter Address to revoke the role from
     */
    function revokeMinterRole(address minter) external onlyOwner {
        _revokeRole(MINTER_ROLE, minter);
    }

    // =================== INTERNAL HELPER FUNCTIONS ===================

    /// @notice Calculate total minting caps of all authorized reserves excluding the specified reserve
    /// @param excludeReserve Reserve to exclude from calculation
    /// @return totalCaps Sum of all other authorized reserves' minting caps
    function _calculateTotalCapsExcluding(address excludeReserve)
        internal
        view
        returns (uint256 totalCaps)
    {
        // NOTE: O(n) gas cost. Could cache total in storage if >10 reserves expected.
        address[] memory reserveAddresses = reserves.values();
        for (uint256 i = 0; i < reserveAddresses.length; i++) {
            address reserve = reserveAddresses[i];
            if (reserve != excludeReserve && authorized[reserve]) {
                totalCaps += reserveInfo[reserve].mintingCap;
            }
        }
    }

    // =================== RESERVE LIST HELPERS ===================

    /// @notice Get the complete list of authorized reserves
    /// @return Array of all reserve addresses
    function getReserveList() external view returns (address[] memory) {
        return reserves.values();
    }

    /// @notice Get a reserve address at a specific index
    /// @param index The index in the reserve list
    /// @return The reserve address at the given index
    function reserveList(uint256 index) external view returns (address) {
        require(index < reserves.length(), "Index out of bounds");
        return reserves.at(index);
    }

    /// @notice Get the total number of reserves
    /// @return The number of reserves in the list
    function getReserveCount() external view returns (uint256) {
        return reserves.length();
    }

    /**
     * @notice Converts tBTC amount to satoshis
     * @param tbtcAmount Amount in tBTC (18 decimals)
     * @return Amount in satoshis (no decimals)
     */
    function _tbtcToSatoshis(uint256 tbtcAmount)
        internal
        pure
        returns (uint256)
    {
        return tbtcAmount / SATOSHI_MULTIPLIER;
    }

    /**
     * @notice Converts satoshis to tBTC amount
     * @param satoshis Amount in satoshis (no decimals)
     * @return Amount in tBTC (18 decimals)
     */
    function _satoshisToTbtc(uint256 satoshis) internal pure returns (uint256) {
        // Check for overflow before multiplication
        if (satoshis > type(uint256).max / SATOSHI_MULTIPLIER) {
            revert ArithmeticOverflow("satoshis to tBTC conversion");
        }
        return satoshis * SATOSHI_MULTIPLIER;
    }
}
