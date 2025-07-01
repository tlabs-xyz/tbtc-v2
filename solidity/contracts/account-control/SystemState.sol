// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title SystemState
/// @dev Global system state and emergency controls.
/// Holds global parameters and emergency controls (e.g., pause flags),
/// providing a single, auditable location for system-wide state.
/// Implements granular pause mechanisms for surgical response to threats.
contract SystemState is AccessControl {
    bytes32 public constant PARAMETER_ADMIN_ROLE = keccak256("PARAMETER_ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    
    /// @dev Global pause flags for granular emergency controls
    bool public isMintingPaused;
    bool public isRedemptionPaused;
    bool public isRegistryPaused;
    bool public isWalletRegistrationPaused;
    
    /// @dev Global system parameters
    uint256 public staleThreshold;           // Time after which reserve attestations are stale
    uint256 public redemptionTimeout;       // Maximum time for redemption fulfillment
    uint256 public walletRegistrationDelay; // Delay for wallet registration finalization
    uint256 public minMintAmount;           // Minimum amount for minting operations
    uint256 public maxMintAmount;           // Maximum amount for single minting operation
    
    /// @dev Emergency parameters
    address public emergencyCouncil;        // Emergency council address
    uint256 public emergencyPauseDuration;  // Maximum duration for emergency pauses
    mapping(bytes32 => uint256) public pauseTimestamps; // Tracks when pauses were activated
    
    // =================== STANDARDIZED EVENTS ===================
    
    /// @dev Emitted when system parameters are updated
    event MinMintAmountUpdated(
        uint256 indexed oldAmount,
        uint256 indexed newAmount,
        address indexed updatedBy
    );
    
    event MaxMintAmountUpdated(
        uint256 indexed oldAmount,
        uint256 indexed newAmount,
        address indexed updatedBy
    );
    
    event RedemptionTimeoutUpdated(
        uint256 indexed oldTimeout,
        uint256 indexed newTimeout,
        address indexed updatedBy
    );
    
    event StaleThresholdUpdated(
        uint256 indexed oldThreshold,
        uint256 indexed newThreshold,
        address indexed updatedBy
    );
    
    event WalletRegistrationDelayUpdated(
        uint256 indexed oldDelay,
        uint256 indexed newDelay,
        address indexed updatedBy
    );
    
    event EmergencyPauseDurationUpdated(
        uint256 indexed oldDuration,
        uint256 indexed newDuration,
        address indexed updatedBy
    );
    
    /// @dev Emitted when specific function types are paused/unpaused
    event MintingPaused(
        address indexed triggeredBy,
        uint256 indexed timestamp
    );
    
    event MintingUnpaused(
        address indexed triggeredBy,
        uint256 indexed timestamp
    );
    
    event RedemptionPaused(
        address indexed triggeredBy,
        uint256 indexed timestamp
    );
    
    event RedemptionUnpaused(
        address indexed triggeredBy,
        uint256 indexed timestamp
    );
    
    event RegistryPaused(
        address indexed triggeredBy,
        uint256 indexed timestamp
    );
    
    event RegistryUnpaused(
        address indexed triggeredBy,
        uint256 indexed timestamp
    );
    
    event WalletRegistrationPaused(
        address indexed triggeredBy,
        uint256 indexed timestamp
    );
    
    event WalletRegistrationUnpaused(
        address indexed triggeredBy,
        uint256 indexed timestamp
    );
    
    /// @dev Emitted when emergency council is updated
    event EmergencyCouncilUpdated(
        address indexed oldCouncil,
        address indexed newCouncil,
        address indexed updatedBy
    );
    
    /// @dev Events for role management are inherited from AccessControl
    
    // =================== MODIFIERS ===================
    
    modifier notPaused(string memory functionName) {
        bytes32 pauseKey = keccak256(abi.encodePacked(functionName));
        if (pauseKey == keccak256("minting")) {
            require(!isMintingPaused, "Minting is paused");
        } else if (pauseKey == keccak256("redemption")) {
            require(!isRedemptionPaused, "Redemption is paused");
        } else if (pauseKey == keccak256("registry")) {
            require(!isRegistryPaused, "Registry operations are paused");
        } else if (pauseKey == keccak256("wallet_registration")) {
            require(!isWalletRegistrationPaused, "Wallet registration is paused");
        }
        _;
    }
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PARAMETER_ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        
        // Set default parameters
        staleThreshold = 24 hours;           // Reserve attestations stale after 24 hours
        redemptionTimeout = 7 days;          // 7 days to fulfill redemptions
        walletRegistrationDelay = 1 hours;   // 1 hour delay for wallet registration
        minMintAmount = 0.01 ether;          // Minimum 0.01 tBTC
        maxMintAmount = 1000 ether;          // Maximum 1000 tBTC per transaction
        emergencyPauseDuration = 7 days;     // Emergency pauses last max 7 days
    }
    
    // =================== PAUSE FUNCTIONS ===================
    
    /// @notice Pause minting operations
    function pauseMinting() external onlyRole(PAUSER_ROLE) {
        require(!isMintingPaused, "Minting already paused");
        isMintingPaused = true;
        pauseTimestamps[keccak256("minting")] = block.timestamp;
        emit MintingPaused(msg.sender, block.timestamp);
    }
    
    /// @notice Unpause minting operations
    function unpauseMinting() external onlyRole(PAUSER_ROLE) {
        require(isMintingPaused, "Minting not paused");
        isMintingPaused = false;
        delete pauseTimestamps[keccak256("minting")];
        emit MintingUnpaused(msg.sender, block.timestamp);
    }
    
    /// @notice Pause redemption operations
    function pauseRedemption() external onlyRole(PAUSER_ROLE) {
        require(!isRedemptionPaused, "Redemption already paused");
        isRedemptionPaused = true;
        pauseTimestamps[keccak256("redemption")] = block.timestamp;
        emit RedemptionPaused(msg.sender, block.timestamp);
    }
    
    /// @notice Unpause redemption operations
    function unpauseRedemption() external onlyRole(PAUSER_ROLE) {
        require(isRedemptionPaused, "Redemption not paused");
        isRedemptionPaused = false;
        delete pauseTimestamps[keccak256("redemption")];
        emit RedemptionUnpaused(msg.sender, block.timestamp);
    }
    
    /// @notice Pause registry operations
    function pauseRegistry() external onlyRole(PAUSER_ROLE) {
        require(!isRegistryPaused, "Registry already paused");
        isRegistryPaused = true;
        pauseTimestamps[keccak256("registry")] = block.timestamp;
        emit RegistryPaused(msg.sender, block.timestamp);
    }
    
    /// @notice Unpause registry operations
    function unpauseRegistry() external onlyRole(PAUSER_ROLE) {
        require(isRegistryPaused, "Registry not paused");
        isRegistryPaused = false;
        delete pauseTimestamps[keccak256("registry")];
        emit RegistryUnpaused(msg.sender, block.timestamp);
    }
    
    /// @notice Pause wallet registration operations
    function pauseWalletRegistration() external onlyRole(PAUSER_ROLE) {
        require(!isWalletRegistrationPaused, "Wallet registration already paused");
        isWalletRegistrationPaused = true;
        pauseTimestamps[keccak256("wallet_registration")] = block.timestamp;
        emit WalletRegistrationPaused(msg.sender, block.timestamp);
    }
    
    /// @notice Unpause wallet registration operations
    function unpauseWalletRegistration() external onlyRole(PAUSER_ROLE) {
        require(isWalletRegistrationPaused, "Wallet registration not paused");
        isWalletRegistrationPaused = false;
        delete pauseTimestamps[keccak256("wallet_registration")];
        emit WalletRegistrationUnpaused(msg.sender, block.timestamp);
    }
    
    // =================== PARAMETER FUNCTIONS ===================
    
    /// @notice Update minimum mint amount
    /// @param newAmount The new minimum amount
    function setMinMintAmount(uint256 newAmount) external onlyRole(PARAMETER_ADMIN_ROLE) {
        require(newAmount > 0, "Invalid amount");
        require(newAmount <= maxMintAmount, "Min amount cannot exceed max amount");
        
        uint256 oldAmount = minMintAmount;
        minMintAmount = newAmount;
        
        emit MinMintAmountUpdated(oldAmount, newAmount, msg.sender);
    }
    
    /// @notice Update maximum mint amount
    /// @param newAmount The new maximum amount
    function setMaxMintAmount(uint256 newAmount) external onlyRole(PARAMETER_ADMIN_ROLE) {
        require(newAmount >= minMintAmount, "Max amount cannot be less than min amount");
        
        uint256 oldAmount = maxMintAmount;
        maxMintAmount = newAmount;
        
        emit MaxMintAmountUpdated(oldAmount, newAmount, msg.sender);
    }
    
    /// @notice Update redemption timeout
    /// @param newTimeout The new timeout in seconds
    function setRedemptionTimeout(uint256 newTimeout) external onlyRole(PARAMETER_ADMIN_ROLE) {
        require(newTimeout > 0, "Invalid timeout");
        require(newTimeout <= 30 days, "Timeout too long");
        
        uint256 oldTimeout = redemptionTimeout;
        redemptionTimeout = newTimeout;
        
        emit RedemptionTimeoutUpdated(oldTimeout, newTimeout, msg.sender);
    }
    
    /// @notice Update stale threshold
    /// @param newThreshold The new threshold in seconds
    function setStaleThreshold(uint256 newThreshold) external onlyRole(PARAMETER_ADMIN_ROLE) {
        require(newThreshold > 0, "Invalid threshold");
        require(newThreshold <= 7 days, "Threshold too long");
        
        uint256 oldThreshold = staleThreshold;
        staleThreshold = newThreshold;
        
        emit StaleThresholdUpdated(oldThreshold, newThreshold, msg.sender);
    }
    
    /// @notice Update wallet registration delay
    /// @param newDelay The new delay in seconds
    function setWalletRegistrationDelay(uint256 newDelay) external onlyRole(PARAMETER_ADMIN_ROLE) {
        require(newDelay <= 24 hours, "Delay too long");
        
        uint256 oldDelay = walletRegistrationDelay;
        walletRegistrationDelay = newDelay;
        
        emit WalletRegistrationDelayUpdated(oldDelay, newDelay, msg.sender);
    }
    
    /// @notice Update emergency pause duration
    /// @param newDuration The new duration in seconds
    function setEmergencyPauseDuration(uint256 newDuration) external onlyRole(PARAMETER_ADMIN_ROLE) {
        require(newDuration > 0, "Invalid duration");
        require(newDuration <= 30 days, "Duration too long");
        
        uint256 oldDuration = emergencyPauseDuration;
        emergencyPauseDuration = newDuration;
        
        emit EmergencyPauseDurationUpdated(oldDuration, newDuration, msg.sender);
    }
    
    /// @notice Update emergency council
    /// @param newCouncil The new emergency council address
    function setEmergencyCouncil(address newCouncil) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newCouncil != address(0), "Invalid council address");
        
        address oldCouncil = emergencyCouncil;
        emergencyCouncil = newCouncil;
        
        // Grant and revoke PAUSER_ROLE
        if (oldCouncil != address(0)) {
            _revokeRole(PAUSER_ROLE, oldCouncil);
        }
        _grantRole(PAUSER_ROLE, newCouncil);
        
        emit EmergencyCouncilUpdated(oldCouncil, newCouncil, msg.sender);
    }
    
    // =================== VIEW FUNCTIONS ===================
    
    /// @notice Check if function is paused
    /// @param functionName The name of the function to check
    /// @return paused True if the function is paused
    function isFunctionPaused(string calldata functionName) 
        external 
        view 
        returns (bool paused) 
    {
        bytes32 pauseKey = keccak256(abi.encodePacked(functionName));
        if (pauseKey == keccak256("minting")) {
            return isMintingPaused;
        } else if (pauseKey == keccak256("redemption")) {
            return isRedemptionPaused;
        } else if (pauseKey == keccak256("registry")) {
            return isRegistryPaused;
        } else if (pauseKey == keccak256("wallet_registration")) {
            return isWalletRegistrationPaused;
        }
        return false;
    }
    
    /// @notice Get pause timestamp for a function
    /// @param functionName The name of the function
    /// @return timestamp When the function was paused (0 if not paused)
    function getPauseTimestamp(string calldata functionName) 
        external 
        view 
        returns (uint256 timestamp) 
    {
        bytes32 pauseKey = keccak256(abi.encodePacked(functionName));
        return pauseTimestamps[pauseKey];
    }
    
    /// @notice Check if emergency pause has expired
    /// @param functionName The name of the function
    /// @return expired True if the emergency pause has expired
    function isEmergencyPauseExpired(string calldata functionName) 
        external 
        view 
        returns (bool expired) 
    {
        bytes32 pauseKey = keccak256(abi.encodePacked(functionName));
        uint256 pauseTime = pauseTimestamps[pauseKey];
        if (pauseTime == 0) return false;
        return block.timestamp > pauseTime + emergencyPauseDuration;
    }
}