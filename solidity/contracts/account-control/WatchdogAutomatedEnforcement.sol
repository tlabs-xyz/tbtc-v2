// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./QCManager.sol";
import "./QCRedeemer.sol";
import "./QCData.sol";
import "./SystemState.sol";
import "./QCReserveLedger.sol";

/// @title WatchdogAutomatedEnforcement
/// @notice Layer 1: Deterministic enforcement for objective violations
/// @dev Handles 90%+ of decisions that are objectively measurable without consensus
contract WatchdogAutomatedEnforcement is AccessControl, ReentrancyGuard {
    bytes32 public constant WATCHDOG_ROLE = keccak256("WATCHDOG_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // External contracts
    QCManager public immutable qcManager;
    QCRedeemer public immutable qcRedeemer;
    QCData public immutable qcData;
    SystemState public immutable systemState;
    QCReserveLedger public immutable reserveLedger;

    // Tracking for pattern detection
    mapping(address => uint256) public failureCount;
    mapping(address => uint256) public lastFailureTime;
    mapping(bytes32 => uint256) public redemptionFailures;
    mapping(address => uint256) public lastOperationTime;

    // Rate limiting for enforcement calls
    mapping(bytes32 => uint256) public lastEnforcementTime;
    uint256 public constant ENFORCEMENT_COOLDOWN = 1 hours;

    // Events for monitoring and transparency
    event AutomatedAction(
        bytes32 indexed actionType,
        address indexed target,
        bytes32 indexed reason,
        uint256 timestamp
    );

    event RedemptionTimeoutEnforced(
        bytes32 indexed redemptionId,
        address indexed qc,
        uint256 timestamp
    );

    event ReserveComplianceEnforced(
        address indexed qc,
        uint256 reserves,
        uint256 minted,
        bytes32 reason
    );

    event WalletInactivityEnforced(
        string indexed btcAddress,
        address indexed qc,
        uint256 lastActivity
    );

    event OperationalComplianceEnforced(
        address indexed qc,
        uint256 failureCount,
        bytes32 reason
    );

    event PatternDetected(
        address indexed qc,
        bytes32 indexed pattern,
        uint256 count,
        uint256 timeWindow
    );

    // Custom errors
    error InvalidConfiguration();
    error EnforcementCooldownActive();
    error QCNotActive();
    error RedemptionNotPending();
    error NotTimedOut();
    error WalletNotInactive();
    error UnauthorizedEnforcement();

    constructor(
        address _qcManager,
        address _qcRedeemer,
        address _qcData,
        address _systemState,
        address _reserveLedger
    ) {
        qcManager = QCManager(_qcManager);
        qcRedeemer = QCRedeemer(_qcRedeemer);
        qcData = QCData(_qcData);
        systemState = SystemState(_systemState);
        reserveLedger = QCReserveLedger(_reserveLedger);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
    }

    // =================== RESERVE COMPLIANCE ENFORCEMENT ===================

    /// @notice Enforce reserve compliance for a QC
    /// @param qc The QC address to check
    function enforceReserveCompliance(address qc) external {
        if (!_canEnforce("RESERVE_COMPLIANCE", qc)) {
            revert EnforcementCooldownActive();
        }

        (uint256 reserves, bool isStale) = reserveLedger.getReserveBalanceAndStaleness(qc);
        uint256 minted = qcData.getQCMintedAmount(qc);
        QCData.QCStatus status = qcData.getQCStatus(qc);

        // Only act on Active QCs
        if (status != QCData.QCStatus.Active) return;

        bytes32 reason;
        bool actionTaken = false;

        // Check 1: Stale attestations
        if (isStale) {
            reason = "STALE_ATTESTATIONS";
            actionTaken = true;
        }
        // Check 2: Insufficient reserves
        else if (reserves * 100 < minted * systemState.minCollateralRatio()) {
            reason = "INSUFFICIENT_RESERVES";
            actionTaken = true;
        }
        // Check 3: Zero reserves with outstanding minted amount
        else if (reserves == 0 && minted > 0) {
            reason = "ZERO_RESERVES";
            actionTaken = true;
        }

        if (actionTaken) {
            qcManager.setQCStatus(qc, QCData.QCStatus.UnderReview, reason);
            
            _recordEnforcement("RESERVE_COMPLIANCE", qc);
            
            emit AutomatedAction(reason, qc, reason, block.timestamp);
            emit ReserveComplianceEnforced(qc, reserves, minted, reason);
        }
    }

    // =================== REDEMPTION TIMEOUT ENFORCEMENT ===================

    /// @notice Enforce redemption timeout for a specific redemption
    /// @param redemptionId The redemption ID to check
    function enforceRedemptionTimeout(bytes32 redemptionId) external {
        QCRedeemer.Redemption memory redemption = qcRedeemer.getRedemption(redemptionId);
        
        // Must be pending
        if (redemption.status != QCRedeemer.RedemptionStatus.Pending) {
            revert RedemptionNotPending();
        }

        // Must be timed out
        uint256 timeout = systemState.redemptionTimeout();
        if (block.timestamp <= redemption.requestedAt + timeout) {
            revert NotTimedOut();
        }

        // Check rate limiting
        if (!_canEnforce("REDEMPTION_TIMEOUT", redemptionId)) {
            revert EnforcementCooldownActive();
        }

        // Flag as defaulted (idempotent operation)
        qcRedeemer.flagDefaultedRedemption(redemptionId, "TIMEOUT");

        // Track pattern for the QC
        _incrementFailureCount(redemption.qc);
        
        _recordEnforcement("REDEMPTION_TIMEOUT", redemptionId);

        emit AutomatedAction("REDEMPTION_TIMEOUT", redemption.qc, "TIMEOUT", block.timestamp);
        emit RedemptionTimeoutEnforced(redemptionId, redemption.qc, block.timestamp);
    }

    // =================== WALLET INACTIVITY ENFORCEMENT ===================

    /// @notice Enforce wallet inactivity deregistration
    /// @param btcAddress The Bitcoin address to check
    function enforceWalletInactivity(string calldata btcAddress) external {
        uint256 lastActivity = _getLastWalletActivity(btcAddress);
        // Note: This would need to be implemented based on QCData wallet status tracking
        // For now, using a placeholder implementation
        
        address qc = _getWalletOwner(btcAddress);
        if (qc == address(0)) return; // Wallet not found

        // Must be beyond inactivity period
        uint256 inactivityPeriod = systemState.walletInactivityPeriod();
        if (block.timestamp <= lastActivity + inactivityPeriod) {
            revert WalletNotInactive();
        }

        // Check rate limiting
        if (!_canEnforce("WALLET_INACTIVITY", btcAddress)) {
            revert EnforcementCooldownActive();
        }

        // Request deregistration
        qcManager.requestWalletDeRegistration(btcAddress);
        
        _recordEnforcement("WALLET_INACTIVITY", btcAddress);

        emit AutomatedAction("WALLET_INACTIVE", qc, "INACTIVITY", block.timestamp);
        emit WalletInactivityEnforced(btcAddress, qc, lastActivity);
    }

    // =================== OPERATIONAL COMPLIANCE ENFORCEMENT ===================

    /// @notice Enforce operational compliance for a QC
    /// @param qc The QC address to check
    function enforceOperationalCompliance(address qc) external {
        if (!_canEnforce("OPERATIONAL_COMPLIANCE", qc)) {
            revert EnforcementCooldownActive();
        }

        uint256 recentFailures = _getRecentFailureCount(qc);
        uint256 lastOperation = lastOperationTime[qc];
        QCData.QCStatus status = qcData.getQCStatus(qc);

        // Only act on Active QCs
        if (status != QCData.QCStatus.Active) return;

        bytes32 reason;
        bool actionTaken = false;

        // Check 1: Repeated failures
        uint256 failureThreshold = systemState.failureThreshold();
        if (recentFailures >= failureThreshold) {
            reason = "REPEATED_FAILURES";
            actionTaken = true;
        }
        // Check 2: Prolonged inactivity
        else {
            uint256 inactivityPeriod = systemState.qcInactivityPeriod();
            if (block.timestamp > lastOperation + inactivityPeriod) {
                reason = "QC_INACTIVE";
                actionTaken = true;
            }
        }

        if (actionTaken) {
            qcManager.setQCStatus(qc, QCData.QCStatus.UnderReview, reason);
            
            _recordEnforcement("OPERATIONAL_COMPLIANCE", qc);

            emit AutomatedAction(reason, qc, reason, block.timestamp);
            emit OperationalComplianceEnforced(qc, recentFailures, reason);

            // Emit pattern detection if failure-related
            if (reason == "REPEATED_FAILURES") {
                emit PatternDetected(qc, "FAILURE_PATTERN", recentFailures, systemState.failureWindow());
            }
        }
    }

    // =================== BATCH ENFORCEMENT ===================

    /// @notice Batch enforce reserve compliance for multiple QCs
    /// @param qcs Array of QC addresses to check
    function batchEnforceReserveCompliance(address[] calldata qcs) external {
        for (uint256 i = 0; i < qcs.length; i++) {
            try this.enforceReserveCompliance(qcs[i]) {
                // Success, continue
            } catch {
                // Skip this QC and continue with others
                continue;
            }
        }
    }

    /// @notice Batch enforce redemption timeouts
    /// @param redemptionIds Array of redemption IDs to check
    function batchEnforceRedemptionTimeouts(bytes32[] calldata redemptionIds) external {
        for (uint256 i = 0; i < redemptionIds.length; i++) {
            try this.enforceRedemptionTimeout(redemptionIds[i]) {
                // Success, continue
            } catch {
                // Skip this redemption and continue with others
                continue;
            }
        }
    }

    // =================== INTERNAL HELPER FUNCTIONS ===================

    function _canEnforce(string memory actionType, address target) internal view returns (bool) {
        bytes32 key = keccak256(abi.encodePacked(actionType, target));
        return block.timestamp > lastEnforcementTime[key] + ENFORCEMENT_COOLDOWN;
    }

    function _canEnforce(string memory actionType, bytes32 target) internal view returns (bool) {
        bytes32 key = keccak256(abi.encodePacked(actionType, target));
        return block.timestamp > lastEnforcementTime[key] + ENFORCEMENT_COOLDOWN;
    }

    function _canEnforce(string memory actionType, string memory target) internal view returns (bool) {
        bytes32 key = keccak256(abi.encodePacked(actionType, target));
        return block.timestamp > lastEnforcementTime[key] + ENFORCEMENT_COOLDOWN;
    }

    function _recordEnforcement(string memory actionType, address target) internal {
        bytes32 key = keccak256(abi.encodePacked(actionType, target));
        lastEnforcementTime[key] = block.timestamp;
    }

    function _recordEnforcement(string memory actionType, bytes32 target) internal {
        bytes32 key = keccak256(abi.encodePacked(actionType, target));
        lastEnforcementTime[key] = block.timestamp;
    }

    function _recordEnforcement(string memory actionType, string memory target) internal {
        bytes32 key = keccak256(abi.encodePacked(actionType, target));
        lastEnforcementTime[key] = block.timestamp;
    }

    function _incrementFailureCount(address qc) internal {
        uint256 failureWindow = systemState.failureWindow();
        
        // Reset count if outside window
        if (block.timestamp > lastFailureTime[qc] + failureWindow) {
            failureCount[qc] = 0;
        }
        
        failureCount[qc]++;
        lastFailureTime[qc] = block.timestamp;
    }

    function _getRecentFailureCount(address qc) internal view returns (uint256) {
        uint256 failureWindow = systemState.failureWindow();
        
        // Count is valid if within window
        if (block.timestamp <= lastFailureTime[qc] + failureWindow) {
            return failureCount[qc];
        }
        
        return 0;
    }

    function _getLastWalletActivity(string memory btcAddress) internal view returns (uint256) {
        // Placeholder implementation - would need to track wallet activity
        // This could be implemented by monitoring wallet registration timestamps
        // and last transaction times from QCData
        return block.timestamp - 100 days; // Placeholder
    }

    function _getWalletOwner(string memory btcAddress) internal view returns (address) {
        // Placeholder implementation - would need to look up wallet owner from QCData
        return address(0); // Placeholder
    }

    // =================== VIEW FUNCTIONS ===================

    /// @notice Get failure statistics for a QC
    /// @param qc The QC address
    /// @return count Recent failure count
    /// @return lastFailure Timestamp of last failure
    function getFailureStats(address qc) external view returns (uint256 count, uint256 lastFailure) {
        return (_getRecentFailureCount(qc), lastFailureTime[qc]);
    }

    /// @notice Check if enforcement action can be taken
    /// @param actionType The type of enforcement action
    /// @param target The target address
    /// @return canEnforce True if enforcement is allowed
    function canEnforceAction(string calldata actionType, address target) 
        external view returns (bool canEnforce) 
    {
        return _canEnforce(actionType, target);
    }

    /// @notice Get next available enforcement time
    /// @param actionType The type of enforcement action
    /// @param target The target address
    /// @return nextTime Timestamp when enforcement becomes available
    function getNextEnforcementTime(string calldata actionType, address target) 
        external view returns (uint256 nextTime) 
    {
        bytes32 key = keccak256(abi.encodePacked(actionType, target));
        return lastEnforcementTime[key] + ENFORCEMENT_COOLDOWN;
    }

    // =================== ADMIN FUNCTIONS ===================

    /// @notice Update operation timestamp for a QC (called by other contracts)
    /// @param qc The QC address
    function updateOperationTime(address qc) external {
        // This would be called by QCMinter, QCRedeemer, etc. when operations occur
        require(
            msg.sender == address(qcManager) || 
            msg.sender == address(qcRedeemer) ||
            hasRole(MANAGER_ROLE, msg.sender),
            "Unauthorized"
        );
        
        lastOperationTime[qc] = block.timestamp;
    }

    /// @notice Emergency disable enforcement for maintenance
    /// @param disabled True to disable enforcement
    function setEmergencyDisabled(bool disabled) external onlyRole(MANAGER_ROLE) {
        // Implementation would add emergency disable functionality
        // For now, this is a placeholder for future emergency controls
    }
}