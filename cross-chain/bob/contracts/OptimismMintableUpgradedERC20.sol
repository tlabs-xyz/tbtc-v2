// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "./interfaces/IOptimismMintableERC20.sol";
import "./interfaces/ISemver.sol";

/// @notice Storage contract that preserves the exact storage layout of the legacy OptimismMintableUpgradableERC20
/// @dev This contract MUST be inherited FIRST to ensure storage slots remain in the same positions
contract OptimismERC20StorageV1 is Initializable, ERC20Upgradeable {
    /// @notice Address of the corresponding version of this token on the remote chain.
    /// @dev Storage slot must remain at the same position as in legacy contract
    address public REMOTE_TOKEN;
    
    /// @notice Address of the StandardBridge on this network.
    /// @dev Storage slot must remain at the same position as in legacy contract
    address public BRIDGE;

    /// @notice Decimals of the token
    /// @dev Storage slot must remain at the same position as in legacy contract
    uint8 internal DECIMALS;
    
    /// @notice Reserved storage space to allow for layout changes in future upgrades
    /// @dev Reduced from 50 to 45 to account for the 5 slots used above (including inherited ERC20)
    uint256[45] private __gap_storage_v1;
}

/// @title OptimismMintableUpgradedERC20
/// @notice OptimismMintableUpgradableERC20 is a standard extension of the base ERC20 token contract designed
///         to allow the StandardBridge contracts to mint and burn tokens. This makes it possible to
///         use an OptimismMintablERC20 as the L2 representation of an L1 token, or vice-versa.
///         Designed to be backwards compatible with the older StandardL2ERC20 token which was only
///         meant for use on L2.
///
///         This upgraded version adds L2TBTC functionality including:
///         - Multiple minters support
///         - Guardian-based pause mechanism
///         - ERC20Permit support
///         - Burnable functionality
///         - Token recovery functions
contract OptimismMintableUpgradedERC20 is
    OptimismERC20StorageV1,
    ERC20BurnableUpgradeable,
    ERC20PermitUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    IOptimismMintableERC20,
    ILegacyMintableERC20,
    ISemver
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // ========== NEW STORAGE VARIABLES (APPEND ONLY) ==========
    // All new storage MUST be added here, after the legacy storage
    
    /// @notice Indicates if the given address is a minter. Only minters can
    ///         mint the token.
    mapping(address => bool) public isMinter;

    /// @notice List of all minters.
    address[] public minters;

    /// @notice Indicates if the given address is a guardian. Only guardians can
    ///         pause token mints and burns.
    mapping(address => bool) public isGuardian;

    /// @notice List of all guardians.
    address[] public guardians;

    /// @notice Semantic version.
    /// @custom:semver 2.0.0
    string public constant version = "2.0.0";

    // Events
    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);
    event GuardianAdded(address indexed guardian);
    event GuardianRemoved(address indexed guardian);
    event Mint(address indexed account, uint256 amount);
    event Burn(address indexed account, uint256 amount);

    // Modifiers
    modifier onlyBridge() {
        require(msg.sender == BRIDGE, "OptimismMintableERC20: only bridge can mint and burn");
        _;
    }
     
    modifier onlyMinter() {
        require(isMinter[msg.sender], "Caller is not a minter");
        _;
    }

    modifier onlyGuardian() {
        require(isGuardian[msg.sender], "Caller is not a guardian");
        _;
    }

    constructor() {
        _disableInitializers();
    }

    /// @notice Initializer for the legacy contract (V1)
    /// @dev This function signature must remain unchanged for upgrade compatibility
    /// @param _bridge      Address of the L2 standard bridge.
    /// @param _remoteToken Address of the corresponding L1 token.
    /// @param _name        ERC20 name.
    /// @param _symbol      ERC20 symbol.
    function initialize(
        address _bridge,
        address _remoteToken,
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    ) public initializer {
        __ERC20_init(_name, _symbol);
        REMOTE_TOKEN = _remoteToken;
        BRIDGE = _bridge;
        DECIMALS = _decimals;
    }

    /// @notice Reinitializer function to be called after upgrade to V2
    /// @dev This function initializes the new functionality added in V2.
    ///      It can only be called once and sets up ownership and other new features.
    /// @param _owner The address that will become the owner of the contract
    function initializeV2(address _owner) external reinitializer(2) {
        // Initialize new inherited contracts
        __ERC20Burnable_init();
        __ERC20Permit_init(name());
        __Ownable_init();
        __Pausable_init();
        
        // Transfer ownership to the specified owner
        _transferOwnership(_owner);
        
        // Add the bridge as the first minter for backward compatibility
        if (!isMinter[bridge()]) {
            isMinter[bridge()] = true;
            minters.push(bridge());
            emit MinterAdded(bridge());
        }
    }

    /// @notice Adds the address to the minters list.
    /// @dev Requirements:
    ///      - The caller must be the contract owner.
    ///      - `minter` must not be a minter address already.
    /// @param minter The address to be added as a minter.
    function addMinter(address minter) external onlyOwner {
        require(!isMinter[minter], "This address is already a minter");
        isMinter[minter] = true;
        minters.push(minter);
        emit MinterAdded(minter);
    }

    /// @notice Removes the address from the minters list.
    /// @dev Requirements:
    ///      - The caller must be the contract owner.
    ///      - `minter` must be a minter address.
    /// @param minter The address to be removed from the minters list.
    function removeMinter(address minter) external onlyOwner {
        require(isMinter[minter], "This address is not a minter");
        delete isMinter[minter];

        // We do not expect too many minters so a simple loop is safe.
        for (uint256 i = 0; i < minters.length; i++) {
            if (minters[i] == minter) {
                minters[i] = minters[minters.length - 1];
                // slither-disable-next-line costly-loop
                minters.pop();
                break;
            }
        }

        emit MinterRemoved(minter);
    }

    /// @notice Adds the address to the guardians list.
    /// @dev Requirements:
    ///      - The caller must be the contract owner.
    ///      - `guardian` must not be a guardian address already.
    /// @param guardian The address to be added as a guardian.
    function addGuardian(address guardian) external onlyOwner {
        require(!isGuardian[guardian], "This address is already a guardian");
        isGuardian[guardian] = true;
        guardians.push(guardian);
        emit GuardianAdded(guardian);
    }

    /// @notice Removes the address from the guardians list.
    /// @dev Requirements:
    ///      - The caller must be the contract owner.
    ///      - `guardian` must be a guardian address.
    /// @param guardian The address to be removed from the guardians list.
    function removeGuardian(address guardian) external onlyOwner {
        require(isGuardian[guardian], "This address is not a guardian");
        delete isGuardian[guardian];

        // We do not expect too many guardians so a simple loop is safe.
        for (uint256 i = 0; i < guardians.length; i++) {
            if (guardians[i] == guardian) {
                guardians[i] = guardians[guardians.length - 1];
                // slither-disable-next-line costly-loop
                guardians.pop();
                break;
            }
        }

        emit GuardianRemoved(guardian);
    }

    /// @notice Allows the governance of the token contract to recover any ERC20
    ///         sent mistakenly to the token contract address.
    /// @param token The address of the token to be recovered.
    /// @param recipient The token recipient address that will receive recovered
    ///        tokens.
    /// @param amount The amount to be recovered.
    function recoverERC20(
        IERC20Upgradeable token,
        address recipient,
        uint256 amount
    ) external onlyOwner {
        token.safeTransfer(recipient, amount);
    }

    /// @notice Allows the governance of the token contract to recover any
    ///         ERC721 sent mistakenly to the token contract address.
    /// @param token The address of the token to be recovered.
    /// @param recipient The token recipient address that will receive the
    ///        recovered token.
    /// @param tokenId The ID of the ERC721 token to be recovered.
    function recoverERC721(
        IERC721Upgradeable token,
        address recipient,
        uint256 tokenId,
        bytes calldata data
    ) external onlyOwner {
        token.safeTransferFrom(address(this), recipient, tokenId, data);
    }

    /// @notice Allows one of the guardians to pause mints and burns allowing
    ///         avoidance of contagion in case of a chain- or bridge-specific
    ///         incident.
    /// @dev Requirements:
    ///      - The caller must be a guardian.
    ///      - The contract must not be already paused.
    function pause() external onlyGuardian {
        _pause();
    }

    /// @notice Allows the governance to unpause mints and burns previously
    ///         paused by one of the guardians.
    /// @dev Requirements:
    ///      - The caller must be the contract owner.
    ///      - The contract must be paused.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Allows one of the minters to mint `amount` tokens and assign
    ///         them to `account`, increasing the total supply. Emits
    ///         a `Transfer` event with `from` set to the zero address.
    /// @dev Requirements:
    ///      - The caller must be a minter.
    ///      - `account` must not be the zero address.
    /// @param account The address to receive tokens.
    /// @param amount The amount of token to be minted.
    function mint(address account, uint256 amount)
        external
        override(IOptimismMintableERC20, ILegacyMintableERC20)
        whenNotPaused
        onlyMinter
    {
        _mint(account, amount);
        emit Mint(account, amount);
    }

    /// @notice Allows the StandardBridge on this network to burn tokens.
    /// @param _from   Address to burn tokens from.
    /// @param _amount Amount of tokens to burn.
    function burn(
        address _from,
        uint256 _amount
    )
        external
        virtual
        override(IOptimismMintableERC20, ILegacyMintableERC20)
        onlyBridge
    {
        _burn(_from, _amount);
        emit Burn(_from, _amount);
    }

    /// @notice Destroys `amount` tokens from the caller. Emits a `Transfer`
    ///         event with `to` set to the zero address.
    /// @dev Requirements:
    ///      - The caller must have at least `amount` tokens.
    /// @param amount The amount of token to be burned.
    function burn(uint256 amount) public override whenNotPaused {
        super.burn(amount);
        emit Burn(msg.sender, amount);
    }

    /// @notice Destroys `amount` tokens from `account`, deducting from the
    ///         caller's allowance. Emits a `Transfer` event with `to` set to
    ///         the zero address.
    /// @dev Requirements:
    ///      - The che caller must have allowance for `accounts`'s tokens of at
    ///        least `amount`.
    ///      - `account` must not be the zero address.
    ///      - `account` must have at least `amount` tokens.
    /// @param account The address owning tokens to be burned.
    /// @param amount The amount of token to be burned.
    function burnFrom(address account, uint256 amount)
        public
        override
        whenNotPaused
    {
        super.burnFrom(account, amount);
        emit Burn(account, amount);
    }

    /// @notice Allows to fetch a list of all minters.
    function getMinters() external view returns (address[] memory) {
        return minters;
    }

    /// @notice Allows to fetch a list of all guardians.
    function getGuardians() external view returns (address[] memory) {
        return guardians;
    }

   /// @notice ERC165 interface check function.
    /// @param _interfaceId Interface ID to check.
    /// @return Whether or not the interface is supported by this contract.
    function supportsInterface(bytes4 _interfaceId) external pure virtual returns (bool) {
        bytes4 iface1 = type(IERC165).interfaceId;
        // Interface corresponding to the legacy L2StandardERC20.
        bytes4 iface2 = type(ILegacyMintableERC20).interfaceId;
        // Interface corresponding to the updated OptimismMintableERC20 (this contract).
        bytes4 iface3 = type(IOptimismMintableERC20).interfaceId;
        return _interfaceId == iface1 || _interfaceId == iface2 || _interfaceId == iface3;
    }

    /// @custom:legacy
    /// @notice Legacy getter for the remote token. Use REMOTE_TOKEN going forward.
    function l1Token() public view returns (address) {
        return REMOTE_TOKEN;
    }

    /// @custom:legacy
    /// @notice Legacy getter for the bridge. Use BRIDGE going forward.
    function l2Bridge() public view returns (address) {
        return BRIDGE;
    }

    /// @custom:legacy
    /// @notice Legacy getter for REMOTE_TOKEN.
    function remoteToken() public view returns (address) {
        return REMOTE_TOKEN;
    }

    /// @custom:legacy
    /// @notice Legacy getter for BRIDGE.
    function bridge() public view returns (address) {
        return BRIDGE;
    }

    /// @dev Returns the number of decimals used to get its user representation.
    /// For example, if `decimals` equals `2`, a balance of `505` tokens should
    /// be displayed to a user as `5.05` (`505 / 10 ** 2`).
    /// NOTE: This information is only used for _display_ purposes: it in
    /// no way affects any of the arithmetic of the contract, including
    /// {IERC20-balanceOf} and {IERC20-transfer}.
    function decimals() public view override returns (uint8) {
        return DECIMALS;
    }

    // Reserve storage space for future upgrades
    uint256[50] private __gap;
}
