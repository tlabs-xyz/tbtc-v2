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

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./QCData.sol";
import "./QCErrors.sol";
import "./SystemState.sol";
import "./ReserveOracle.sol";
import {BitcoinAddressUtils} from "./BitcoinAddressUtils.sol";
import {CheckBitcoinSigs} from "@keep-network/bitcoin-spv-sol/contracts/CheckBitcoinSigs.sol";
import "./AccountControl.sol";
import "./QCManagerLib.sol";
import "./interfaces/IQCPauseManager.sol";
import "./interfaces/IQCRedeemer.sol";
import "./interfaces/IQCWalletManager.sol";
import "./interfaces/IQCManagerEvents.sol";

/// @title QCManager
/// @dev Unified controller for QC management with 5-state model and self-pause system
///
/// @notice Oracle Sync Architecture
/// QCManager acts as an intermediary between ReserveOracle and AccountControl to provide:
/// - Rate limiting (MIN_SYNC_INTERVAL = 5 minutes) to prevent DoS attacks and excessive gas consumption
/// - Automatic status changes (pause QCs with stale oracle data > 24 hours)
/// - Coordinated backing updates synchronized with QC status changes
/// - Batch sync operations for gas efficiency when updating multiple QCs
/// - Access control ensuring only MONITOR_ROLE can trigger syncs
contract QCManager is AccessControl, ReentrancyGuard, QCErrors, IQCManagerEvents {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant DISPUTE_ARBITER_ROLE =
        keccak256("DISPUTE_ARBITER_ROLE");
    bytes32 public constant ENFORCEMENT_ROLE = keccak256("ENFORCEMENT_ROLE");
    bytes32 public constant MONITOR_ROLE = keccak256("MONITOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // =================== CONSTANTS ===================
    
    // Batch operation safety
    uint256 public constant MIN_GAS_PER_OPERATION = 50000;
    uint256 public constant CIRCUIT_BREAKER_THRESHOLD = 100000; // Min gas to continue

    // Reason codes for state changes (QCPauseManager uses string-based reasons for its operations)
    bytes32 private constant UNDERCOLLATERALIZED_REASON = keccak256("UNDERCOLLATERALIZED");
    bytes32 private constant STALE_DATA_REASON = keccak256("STALE_ORACLE_DATA");
    
    // Operation types for consolidated events
    bytes32 private constant OP_SYNC_SUCCESS = keccak256("SYNC_SUCCESS");
    bytes32 private constant OP_SYNC_FAILED = keccak256("SYNC_FAILED");
    bytes32 private constant OP_ORACLE_FAILED = keccak256("ORACLE_FAILED");
    bytes32 private constant OP_ORACLE_RECOVERED = keccak256("ORACLE_RECOVERED");
    bytes32 private constant OP_MINTING_DENIED = keccak256("MINTING_DENIED");
    bytes32 private constant OP_STATUS_REQUEST = keccak256("STATUS_REQUEST");
    bytes32 private constant OP_BATCH_SYNC = keccak256("BATCH_SYNC");
    bytes32 private constant OP_BATCH_HEALTH = keccak256("BATCH_HEALTH_CHECK");

    // =================== STORAGE ===================

    QCData public immutable qcData; /// @dev QC status and metadata storage
    SystemState public immutable systemState; /// @dev System-wide configuration and pause states
    ReserveOracle public immutable reserveOracle; /// @dev Oracle for reserve backing attestations
    AccountControl public immutable accountControl; /// @dev Core invariant enforcement contract
    IQCPauseManager public immutable pauseManager; /// @dev QC pause management and escalation
    IQCWalletManager public immutable walletManager; /// @dev QC wallet registration and management
    IQCRedeemer public qcRedeemer; /// @dev QC redemption processing (set after deployment)
    
    // =================== INTERNAL HELPERS ===================
    
    /// @notice Convert timestamp to bytes32 for event data
    function timestampToBytes32(uint256 timestamp) private pure returns (bytes32) {
        return bytes32(timestamp);
    }

    modifier onlyWhenNotPaused(string memory f) {
        require(!systemState.isFunctionPaused(f), "Paused");
        _;
    }

    modifier validQC(address qc) {
        if (qc == address(0)) revert InvalidQCAddress();
        if (!qcData.isQCRegistered(qc)) revert QCNotRegistered(qc);
        _;
    }
    
    /// @dev Rate limiting modifier to prevent oracle sync abuse
    /// @param qc The QC address to check rate limiting for
    /// @dev Business logic: Enforces minimum interval between oracle syncs (default 5 minutes)
    /// @dev Rationale: Prevents DoS attacks and excessive gas consumption from rapid sync attempts
    /// @dev First sync (timestamp == 0) always allowed to enable initial setup
    modifier rateLimited(address qc) {
        uint256 minInterval = systemState.minSyncInterval();
        uint256 lastSyncTimestamp = qcData.getQCOracleLastSyncTimestamp(qc);
        require(
            lastSyncTimestamp == 0 || 
            block.timestamp >= lastSyncTimestamp + minInterval,
            "Rate limited"
        );
        _;
    }

    // =================== CONSTRUCTOR ===================

    constructor(
        address _qcData,
        address _systemState,
        address _reserveOracle,
        address _accountControl,
        address _pauseManager,
        address _walletManager
    ) {
        require(_qcData != address(0), "Invalid QCData");
        require(_systemState != address(0), "Invalid SystemState");
        require(_reserveOracle != address(0), "Invalid ReserveOracle");
        require(_accountControl != address(0), "Invalid AccountControl");
        require(_pauseManager != address(0), "Invalid PauseManager");
        require(_walletManager != address(0), "Invalid WalletManager");

        qcData = QCData(_qcData);
        systemState = SystemState(_systemState);
        reserveOracle = ReserveOracle(_reserveOracle);
        accountControl = AccountControl(_accountControl);
        pauseManager = IQCPauseManager(_pauseManager);
        walletManager = IQCWalletManager(_walletManager);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GOVERNANCE_ROLE, msg.sender);
        _grantRole(REGISTRAR_ROLE, msg.sender);
        _grantRole(DISPUTE_ARBITER_ROLE, msg.sender);
        _grantRole(MONITOR_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
    }

    /// @notice Set QCRedeemer contract reference
    function setQCRedeemer(address _qcRedeemer)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        qcRedeemer = IQCRedeemer(_qcRedeemer);
        walletManager.setQCRedeemer(_qcRedeemer);
    }

    // =================== GOVERNANCE ===================

    /// @notice Register a new Qualified Custodian
    function registerQC(address qc, uint256 maxMintingCap)
        external
        onlyRole(GOVERNANCE_ROLE)
        nonReentrant
    {
        // Get validation data from library
        QCManagerLib.QCRegistrationData memory regData = QCManagerLib.validateQCRegistration(
            qcData,
            qc,
            maxMintingCap
        );

        // Execute registration actions
        qcData.registerQC(regData.qc, regData.maxMintingCap);
        
        // Authorize in AccountControl if needed
        if (regData.shouldAuthorizeInAccountControl) {
            accountControl.authorizeReserve(
                regData.qc, 
                regData.maxMintingCap, 
                AccountControl.ReserveType(uint8(regData.reserveType))
            );
        }

        try this.syncBackingFromOracle(qc) {} catch {}

        emit QCOnboarded(
            qc,
            maxMintingCap,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Increase minting capacity for existing QC
    function increaseMintingCapacity(address qc, uint256 newCap)
        external
        onlyRole(GOVERNANCE_ROLE)
        nonReentrant
        validQC(qc)
    {
        if (newCap == 0) {
            revert InvalidMintingCapacity();
        }

        // Validate with library
        (uint256 currentCap, ) = QCManagerLib.validateMintingCapacityUpdate(
            qcData,
            qc,
            newCap
        );

        // Execute updates
        qcData.updateMaxMintingCapacity(qc, newCap);
        
        // Update in AccountControl
        accountControl.setMintingCap(qc, newCap);

        emit BalanceUpdate(qc, keccak256("CAP"), currentCap, newCap);
    }

    // =================== EMERGENCY ===================

    // =================== OPERATIONS ===================

    /// @notice Change QC status with full authority (DISPUTE_ARBITER_ROLE only)
    function setQCStatus(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason
    ) external onlyRole(DISPUTE_ARBITER_ROLE) nonReentrant {
        _executeStatusChange(qc, newStatus, reason, "ARBITER");
    }

    /// @notice Request status change from WatchdogEnforcer (ENFORCEMENT_ROLE only)
    function requestStatusChange(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason
    ) external onlyRole(ENFORCEMENT_ROLE) nonReentrant {
        require(newStatus == QCData.QCStatus.UnderReview, "UnderReview only");

        emit QCOperation(qc, OP_STATUS_REQUEST, uint256(newStatus), reason);
        _executeStatusChange(qc, newStatus, reason, "WATCHDOG_ENFORCER");
    }

    /// @notice Internal function that executes all status changes with full validation
    /// @param qc The QC address to change status for
    /// @param newStatus The new status to set
    /// @param reason The reason for the status change (bytes32 hash)
    /// @param context String context for the change (e.g., "ARBITER", "WATCHDOG_ENFORCER")
    /// @dev Validates transitions, checks redemption obligations, and syncs AccountControl
    /// @dev Automatically triggers oracle sync for non-Revoked status changes
    /// @dev Complex business logic flow:
    ///      1. Validates reason is provided and QC is registered
    ///      2. Checks for unfulfilled redemptions that may restrict transitions
    ///      3. Validates status transition using detailed validation rules
    ///      4. Updates QC status in QCData storage
    ///      5. Synchronizes AccountControl reserve state (pause/unpause/deauthorize)
    ///      6. Triggers oracle sync for current backing data (except Revoked status)
    ///      7. Emits QCStatusChanged event for external monitoring
    function _executeStatusChange(
        address qc,
        QCData.QCStatus newStatus,
        bytes32 reason,
        string memory context
    ) private {
        if (reason == bytes32(0)) revert("No reason");
        if (!qcData.isQCRegistered(qc)) revert QCNotRegistered(qc);

        QCData.QCStatus oldStatus = qcData.getQCStatus(qc);

        // Check if QC has unfulfilled redemptions for enhanced validation
        bool hasRedemptions = false;
        if (address(qcRedeemer) != address(0)) {
            hasRedemptions = qcRedeemer.hasUnfulfilledRedemptions(qc);
        }

        // Validate status transitions with detailed reasoning
        (bool isValid, ) = QCManagerLib.validateStatusTransitionDetailed(
            oldStatus,
            newStatus,
            hasRedemptions
        );

        if (!isValid)
            revert InvalidStatusTransition(uint8(oldStatus), uint8(newStatus));

        qcData.setQCStatus(qc, newStatus, reason);

        // Synchronize AccountControl with QC status changes
        _syncAccountControlWithStatus(qc, oldStatus, newStatus);

        emit QCStatusChanged(qc, oldStatus, newStatus, reason, msg.sender, block.timestamp);
    }

    /// @notice Synchronizes AccountControl with QC status changes
    /// @param qc The QC address being updated
    /// @param oldStatus The previous QC status
    /// @param newStatus The new QC status
    /// @dev Business logic: Maintains AccountControl state consistency with QC status
    /// @dev Oracle sync attempted for all non-Revoked transitions to ensure current backing data
    /// @dev Revoked QCs skip oracle sync as they're permanently excluded from operations
    function _syncAccountControlWithStatus(
        address qc,
        QCData.QCStatus oldStatus,
        QCData.QCStatus newStatus
    ) private {
        if (oldStatus == newStatus) return;

        if (newStatus != QCData.QCStatus.Revoked) {
            try this.syncBackingFromOracle(qc) {} catch {}
        }

        QCManagerLib.syncAccountControlWithStatus(
            address(accountControl),
            qc,
            oldStatus,
            newStatus
        );
    }
    
    /// @notice Public interface for QCPauseManager to sync AccountControl with status changes
    function syncAccountControlWithStatus(
        address qc,
        QCData.QCStatus oldStatus,
        QCData.QCStatus newStatus
    ) external {
        require(msg.sender == address(pauseManager), "Only QCPauseManager");
        _syncAccountControlWithStatus(qc, oldStatus, newStatus);
    }

    /// @notice Atomically consume minting capacity for a QC
    /// @param qc The QC address to consume capacity from
    /// @param amount The amount of capacity to consume (in wei)
    /// @return success True if capacity was successfully consumed, false if denied
    /// @dev Enforces strict staleness checks - minting denied if oracle data > 24 hours old
    /// @dev No fallback mechanisms - stale data results in immediate minting denial
    /// @dev Validates against both capacity limits and reserve backing requirements\n    /// @dev Critical capacity management with multi-layered validation:\n    ///      1. Basic capacity validation via QCManagerLib (QC status, capacity limits)\n    ///      2. Oracle data staleness check (enforces 24-hour data freshness)\n    ///      3. Reserve backing sufficiency validation (currentMinted + amount <= reserveBalance)\n    ///      4. Atomic capacity consumption with minted amount updates\n    ///      5. Returns false on any validation failure (no capacity consumed)\n    ///      6. Emits BalanceUpdate event for external monitoring of capacity usage
    function consumeMintCapacity(address qc, uint256 amount)
        external
        onlyRole(MINTER_ROLE)
        nonReentrant
        returns (bool success)
    {
        uint256 currentMinted = qcData.getQCMintedAmount(qc);

        // Validate basic mint capacity constraints
        (bool isValid, ) = QCManagerLib.validateMintCapacityConsumption(
            address(qcData), qc, amount
        );
        if (!isValid) return false;
        
        // Check oracle data - no fallback, deny minting if stale or insufficient
        if (address(reserveOracle) != address(0)) {
            (uint256 reserveBalance, bool isStale) = QCManagerLib.getReserveBalanceAndStaleness(
                reserveOracle,
                qc
            );
            
            // Deny minting if data is stale or insufficient reserve
            if (isStale || currentMinted + amount > reserveBalance) {
                if (isStale) {
                    emit QCOperation(qc, OP_MINTING_DENIED, amount, STALE_DATA_REASON);
                }
                return false;
            }
        }

        qcData.updateQCMintedAmount(qc, currentMinted + amount);
        emit BalanceUpdate(
            qc,
            keccak256("MINTED"),
            currentMinted,
            currentMinted + amount
        );
        return true;
    }

    /// @notice Verify QC solvency with proper staleness handling
    /// @param qc The QC address to verify solvency for
    /// @return solvent True if QC is solvent (reserve >= minted amount)
    /// @dev Automatically changes QC status to UnderReview if undercollateralized or data stale
    /// @dev Triggers status change with appropriate reason (STALE_DATA_REASON or UNDERCOLLATERALIZED_REASON)
    /// @dev Only DISPUTE_ARBITER_ROLE can call this function for governance control
    function verifyQCSolvency(address qc)
        external
        nonReentrant
        returns (bool solvent)
    {
        if (!hasRole(DISPUTE_ARBITER_ROLE, msg.sender))
            revert NotAuthorizedForSolvency(msg.sender);
        if (!qcData.isQCRegistered(qc)) revert QCNotRegisteredForSolvency(qc);

        (bool _solvent, bool shouldUpdateStatus, QCData.QCStatus newStatus, uint256 mintedAmount, uint256 reserveBalance, bool isStale) = 
            QCManagerLib.performSolvencyVerification(
                qc,
                address(qcData),
                address(reserveOracle),
                msg.sender
            );
        
        solvent = _solvent;

        if (shouldUpdateStatus) {
            bytes32 reason = isStale ? STALE_DATA_REASON : UNDERCOLLATERALIZED_REASON;
            string memory context = isStale ? "STALE_DATA" : "ARBITER";
            _executeStatusChange(qc, newStatus, reason, context);
        }

        emit SolvencyCheck(
            qc,
            solvent,
            reserveBalance,
            mintedAmount,
            isStale
        );

        return solvent;
    }

    /// @notice Update QC minted amount
    function updateQCMintedAmount(address qc, uint256 newAmount)
        external
        onlyRole(GOVERNANCE_ROLE)
        nonReentrant
        validQC(qc)
    {
        uint256 oldAmount = qcData.getQCMintedAmount(qc);
        qcData.updateQCMintedAmount(qc, newAmount);

        emit BalanceUpdate(qc, keccak256("MINTED"), oldAmount, newAmount);
    }

    function _updateReserveBalanceAndCheckSolvency(
        address qc,
        uint256 newBalance
    ) private {
        (uint256 oldBalance, ) = QCManagerLib.getReserveBalanceAndStaleness(
            reserveOracle,
            qc
        );
        QCManagerLib.updateReserveBalanceAndCheckSolvency(
            qc,
            newBalance,
            qcData
        );
        emit BalanceUpdate(qc, keccak256("RESERVE"), oldBalance, newBalance);
    }



    /// @notice Proactive oracle health check
    /// @param qcs Array of QCs to check
    function checkOracleHealth(address[] calldata qcs) 
        external 
        onlyRole(MONITOR_ROLE) 
        nonReentrant 
    {
        // Prepare data arrays for library call
        uint256[] memory lastSyncTimestamps = new uint256[](qcs.length);
        bool[] memory oracleFailureDetected = new bool[](qcs.length);
        
        for (uint256 i = 0; i < qcs.length; i++) {
            (lastSyncTimestamps[i], oracleFailureDetected[i]) = qcData.getQCOracleData(qcs[i]);
        }
        
        // Process health checks in library
        QCManagerLib.BatchHealthCheckResult memory batchResult = 
            QCManagerLib.processBatchOracleHealthCheck(
                address(reserveOracle),
                address(qcData),
                qcs,
                lastSyncTimestamps,
                oracleFailureDetected,
                MIN_GAS_PER_OPERATION
            );
            
        // Process results
        for (uint256 i = 0; i < batchResult.results.length; i++) {
            QCManagerLib.OracleHealthResult memory result = batchResult.results[i];
            
            if (result.shouldUpdateStatus) {
                _executeStatusChange(
                    result.qc,
                    QCData.QCStatus.UnderReview,
                    STALE_DATA_REASON,
                    "HEALTH_CHECK"
                );
            }
            
            if (result.shouldMarkFailure) {
                qcData.updateQCOracleFailureDetected(result.qc, true);
                emit QCOperation(result.qc, OP_ORACLE_FAILED, 0, timestampToBytes32(block.timestamp));
            }
            
            if (result.shouldClearFailure) {
                qcData.updateQCOracleFailureDetected(result.qc, false);
                emit QCOperation(result.qc, OP_ORACLE_RECOVERED, 0, timestampToBytes32(block.timestamp));
            }
        }
    }

    /// @notice Handle redemption default with graduated consequences (delegated to QCPauseManager)
    /// @param qc QC that defaulted
    /// @param redemptionId ID of the defaulted redemption
    function handleRedemptionDefault(address qc, bytes32 redemptionId)
        external
        onlyRole(DISPUTE_ARBITER_ROLE)
        nonReentrant
    {
        pauseManager.handleRedemptionDefault(qc, redemptionId);
    }

    /// @notice Clear QC backlog and potentially restore to Active (delegated to QCPauseManager)
    /// @param qc QC address to clear
    function clearQCBacklog(address qc)
        external
        onlyRole(DISPUTE_ARBITER_ROLE)
        nonReentrant
    {
        pauseManager.clearQCBacklog(qc);
    }

    // =================== VIEW FUNCTIONS ===================

    /// @notice Check if QC has unfulfilled redemptions (delegated to QCManagerLib)
    function hasUnfulfilledRedemptions(address qc)
        external
        view
        returns (bool)
    {
        return QCManagerLib.hasUnfulfilledRedemptionsView(address(qcRedeemer), qc);
    }

    /// @notice Get earliest redemption deadline for a QC (delegated to QCManagerLib)
    function getEarliestRedemptionDeadline(address qc)
        external
        view
        returns (uint256)
    {
        return QCManagerLib.getEarliestRedemptionDeadline(address(qcRedeemer), qc);
    }

    /// @notice Check if QC is eligible for escalation (delegated to QCPauseManager)
    function isEligibleForEscalation(address qc)
        external
        view
        returns (bool eligible, uint256 timeUntilEscalation)
    {
        return pauseManager.isEligibleForEscalation(qc);
    }

    /// @notice Get available minting capacity for a QC (delegated to QCManagerLib)
    function getAvailableMintingCapacity(address qc)
        external
        view
        returns (uint256)
    {
        return QCManagerLib.getAvailableMintingCapacityView(
            address(qcData),
            address(reserveOracle),
            qc
        );
    }

    // =================== ACCOUNT CONTROL ===================

    /// @notice Sync backing data from oracle
    /// @param qc QC address to sync backing for
    function syncBackingFromOracle(address qc)
        external
        onlyRole(MONITOR_ROLE)
        nonReentrant
        rateLimited(qc)
    {
        _syncBackingFromOracleInternal(qc);
    }

    /// @notice Internal sync function that can be called by batch operations
    /// @param qc QC address to sync backing for
    function _syncBackingFromOracleInternal(address qc) internal {
        require(_isValidQC(qc), "Invalid QC");

        // Use library to process sync
        QCManagerLib.SyncResult memory result = QCManagerLib.processSingleSync(
            address(reserveOracle),
            address(qcData),
            qc
        );
        
        if (!result.success) {
            emit QCOperation(qc, OP_SYNC_FAILED, 0, timestampToBytes32(block.timestamp));
            return;
        }
        
        // Update AccountControl if needed
        if (result.shouldUpdateAccountControl) {
            accountControl.setBacking(qc, result.balance);
        }
        
        // Handle status change if needed
        if (result.shouldUpdateStatus) {
            _executeStatusChange(
                qc,
                QCData.QCStatus.UnderReview,
                STALE_DATA_REASON,
                "AUTO_SYNC"
            );
        }
        
        // Update timestamp and emit success
        qcData.updateQCOracleSyncTimestamp(qc, result.newTimestamp);
        emit QCOperation(qc, OP_SYNC_SUCCESS, result.balance, result.isStale ? bytes32(uint256(1)) : bytes32(0));
    }

    /// @notice Batch sync backing data from oracle (delegated to QCManagerLib)
    /// @param qcs Array of QC addresses to sync
    function batchSyncBackingFromOracle(address[] calldata qcs)
        external
        onlyRole(MONITOR_ROLE)
        nonReentrant
    {
        // Prepare timestamps array for library call
        uint256[] memory timestamps = new uint256[](qcs.length);
        for (uint256 i = 0; i < qcs.length; i++) {
            timestamps[i] = qcData.getQCOracleLastSyncTimestamp(qcs[i]);
        }
        
        // Get sync results from library
        (QCManagerLib.BatchSyncResult[] memory syncResults, uint256 processedCount, ) = 
            QCManagerLib.processBatchSyncFromOracle(
                address(reserveOracle),
                qcs,
                timestamps,
                systemState.minSyncInterval()
            );
            
        // Process results and execute external calls
        uint256 successfulCount = 0;
        
        for (uint256 i = 0; i < syncResults.length; i++) {
            QCManagerLib.BatchSyncResult memory result = syncResults[i];
            
            // Update storage timestamp
            qcData.updateQCOracleSyncTimestamp(result.qc, result.newTimestamp);
            
            if (result.success) {
                // Update AccountControl
                try accountControl.setBacking(result.qc, result.balance) {} catch {}
                
                successfulCount++;
                
                emit QCOperation(result.qc, OP_SYNC_SUCCESS, result.balance, result.isStale ? bytes32(uint256(1)) : bytes32(0));
            }
        }
        
        // Emit completion summary
        emit BatchOperation(
            OP_BATCH_SYNC,
            processedCount,
            successfulCount,
            processedCount - successfulCount
        );
    }

    /// @notice Batch health check for oracle availability
    /// @param qcs Array of QC addresses to check
    function batchCheckOracleHealth(address[] calldata qcs)
        external
        onlyRole(MONITOR_ROLE)
        nonReentrant
    {
        // Use the same logic as checkOracleHealth
        this.checkOracleHealth(qcs);
        
        // Emit batch operation summary
        emit BatchOperation(
            OP_BATCH_HEALTH,
            qcs.length,
            0, // Success count not tracked in checkOracleHealth
            0  // Failed count not tracked in checkOracleHealth
        );
    }

    /// @notice Validate if an address is a registered and active QC
    /// @param qc QC address to validate
    /// @return true if QC is valid for sync operations
    /// @dev Business logic: Sync operations allowed for all registered QCs except Revoked
    /// @dev Rationale: Even paused or under-review QCs need backing data for governance decisions
    /// @dev Revoked QCs are permanently excluded to prevent resource waste on terminated entities
    function _isValidQC(address qc) private view returns (bool) {
        if (qc == address(0)) return false;
        if (!qcData.isQCRegistered(qc)) return false;

        QCData.QCStatus status = qcData.getQCStatus(qc);
        // Allow sync for all states except Revoked
        return status != QCData.QCStatus.Revoked;
    }
}
