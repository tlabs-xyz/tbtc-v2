// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./SingleWatchdog.sol";
import "./WatchdogConsensusManager.sol";
import "./QCData.sol";

/// @title WatchdogMonitor
/// @notice Coordinates multiple independent SingleWatchdog instances for V1.1
/// @dev Manages watchdog registration, monitoring, and emergency responses
contract WatchdogMonitor is AccessControl, ReentrancyGuard {
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant WATCHDOG_OPERATOR_ROLE = keccak256("WATCHDOG_OPERATOR_ROLE");
    
    // Emergency thresholds
    uint256 public constant CRITICAL_REPORTS_THRESHOLD = 3;
    uint256 public constant REPORT_VALIDITY_PERIOD = 1 hours;
    
    struct WatchdogInfo {
        address watchdogContract;
        address operator;
        bool active;
        uint256 registrationTime;
        string identifier;
    }
    
    struct CriticalReport {
        address qc;
        address reporter;
        uint256 timestamp;
        string reason;
        bytes32 reportHash;
    }
    
    // Storage
    mapping(address => WatchdogInfo) public watchdogs;
    mapping(address => bool) public isWatchdogContract;
    address[] public activeWatchdogs;
    
    // Emergency tracking
    mapping(address => CriticalReport[]) public criticalReports;
    mapping(address => bool) public emergencyPaused;
    
    // External contracts
    WatchdogConsensusManager public consensusManager;
    QCData public qcData;
    
    // Events
    event WatchdogRegistered(
        address indexed watchdogContract,
        address indexed operator,
        string identifier
    );
    
    event WatchdogDeactivated(
        address indexed watchdogContract,
        address indexed operator
    );
    
    event CriticalReportSubmitted(
        address indexed qc,
        address indexed reporter,
        string reason,
        uint256 recentReportCount
    );
    
    event EmergencyPauseTriggered(
        address indexed qc,
        uint256 reportCount,
        address triggeredBy
    );
    
    event EmergencyPauseCleared(
        address indexed qc,
        address clearedBy
    );
    
    // Custom errors
    error WatchdogNotActive();
    error WatchdogAlreadyRegistered();
    error InvalidWatchdog();
    error AlreadyPaused();
    error NotPaused();
    
    constructor(
        address _consensusManager,
        address _qcData
    ) {
        consensusManager = WatchdogConsensusManager(_consensusManager);
        qcData = QCData(_qcData);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
    }
    
    // =================== WATCHDOG MANAGEMENT ===================
    
    /// @notice Register a new watchdog instance
    /// @param watchdogContract The SingleWatchdog contract address
    /// @param operator The operator address
    /// @param identifier Human-readable identifier
    function registerWatchdog(
        address watchdogContract,
        address operator,
        string calldata identifier
    ) external onlyRole(MANAGER_ROLE) {
        if (watchdogs[operator].active) revert WatchdogAlreadyRegistered();
        
        // Verify it's actually a SingleWatchdog contract
        try SingleWatchdog(watchdogContract).protocolRegistry() returns (address) {
            // Valid SingleWatchdog
        } catch {
            revert InvalidWatchdog();
        }
        
        watchdogs[operator] = WatchdogInfo({
            watchdogContract: watchdogContract,
            operator: operator,
            active: true,
            registrationTime: block.timestamp,
            identifier: identifier
        });
        
        isWatchdogContract[watchdogContract] = true;
        activeWatchdogs.push(operator);
        
        // Grant watchdog role in consensus manager
        consensusManager.grantRole(consensusManager.WATCHDOG_ROLE(), operator);
        
        emit WatchdogRegistered(watchdogContract, operator, identifier);
    }
    
    /// @notice Deactivate a watchdog
    /// @param operator The operator address
    function deactivateWatchdog(address operator) external onlyRole(MANAGER_ROLE) {
        WatchdogInfo storage info = watchdogs[operator];
        if (!info.active) revert WatchdogNotActive();
        
        info.active = false;
        isWatchdogContract[info.watchdogContract] = false;
        
        // Remove from active list
        for (uint i = 0; i < activeWatchdogs.length; i++) {
            if (activeWatchdogs[i] == operator) {
                activeWatchdogs[i] = activeWatchdogs[activeWatchdogs.length - 1];
                activeWatchdogs.pop();
                break;
            }
        }
        
        // Revoke consensus role
        consensusManager.revokeRole(consensusManager.WATCHDOG_ROLE(), operator);
        
        emit WatchdogDeactivated(info.watchdogContract, operator);
    }
    
    // =================== EMERGENCY MONITORING ===================
    
    /// @notice Submit critical report about a QC
    /// @param qc The QC address
    /// @param reason Human-readable reason
    function submitCriticalReport(
        address qc,
        string calldata reason
    ) external onlyRole(WATCHDOG_OPERATOR_ROLE) {
        if (!watchdogs[msg.sender].active) revert WatchdogNotActive();
        
        bytes32 reportHash = keccak256(abi.encodePacked(qc, reason, block.timestamp));
        
        criticalReports[qc].push(CriticalReport({
            qc: qc,
            reporter: msg.sender,
            timestamp: block.timestamp,
            reason: reason,
            reportHash: reportHash
        }));
        
        // Count recent reports (within validity period)
        uint256 recentCount = _countRecentReports(qc);
        
        emit CriticalReportSubmitted(qc, msg.sender, reason, recentCount);
        
        // Trigger emergency pause if threshold reached
        if (recentCount >= CRITICAL_REPORTS_THRESHOLD && !emergencyPaused[qc]) {
            _triggerEmergencyPause(qc);
        }
    }
    
    /// @notice Clear emergency pause for a QC
    /// @param qc The QC address
    function clearEmergencyPause(address qc) external onlyRole(MANAGER_ROLE) {
        if (!emergencyPaused[qc]) revert NotPaused();
        
        emergencyPaused[qc] = false;
        
        // Clear old reports
        delete criticalReports[qc];
        
        emit EmergencyPauseCleared(qc, msg.sender);
    }
    
    /// @notice Clean up old critical reports
    /// @param qc The QC address
    function cleanupOldReports(address qc) external {
        CriticalReport[] storage reports = criticalReports[qc];
        uint256 cutoff = block.timestamp - REPORT_VALIDITY_PERIOD;
        
        // Remove expired reports
        uint256 writeIndex = 0;
        for (uint256 readIndex = 0; readIndex < reports.length; readIndex++) {
            if (reports[readIndex].timestamp > cutoff) {
                if (writeIndex != readIndex) {
                    reports[writeIndex] = reports[readIndex];
                }
                writeIndex++;
            }
        }
        
        // Truncate array
        while (reports.length > writeIndex) {
            reports.pop();
        }
    }
    
    // =================== INTERNAL FUNCTIONS ===================
    
    function _countRecentReports(address qc) internal view returns (uint256 count) {
        CriticalReport[] memory reports = criticalReports[qc];
        uint256 cutoff = block.timestamp - REPORT_VALIDITY_PERIOD;
        
        for (uint i = 0; i < reports.length; i++) {
            if (reports[i].timestamp > cutoff) {
                count++;
            }
        }
    }
    
    function _triggerEmergencyPause(address qc) internal {
        emergencyPaused[qc] = true;
        
        emit EmergencyPauseTriggered(
            qc,
            CRITICAL_REPORTS_THRESHOLD,
            msg.sender
        );
    }
    
    // =================== VIEW FUNCTIONS ===================
    
    /// @notice Get active watchdog count
    function getActiveWatchdogCount() external view returns (uint256) {
        return activeWatchdogs.length;
    }
    
    /// @notice Get watchdog info
    function getWatchdogInfo(address operator) external view returns (
        address watchdogContract,
        bool active,
        uint256 registrationTime,
        string memory identifier
    ) {
        WatchdogInfo memory info = watchdogs[operator];
        return (
            info.watchdogContract,
            info.active,
            info.registrationTime,
            info.identifier
        );
    }
    
    /// @notice Check if QC is emergency paused
    function isEmergencyPaused(address qc) external view returns (bool) {
        return emergencyPaused[qc];
    }
    
    /// @notice Get recent critical report count
    function getRecentReportCount(address qc) external view returns (uint256) {
        return _countRecentReports(qc);
    }
    
    /// @notice Get all critical reports for a QC
    function getCriticalReports(address qc) external view returns (CriticalReport[] memory) {
        return criticalReports[qc];
    }
    
    /// @notice Check if address is active watchdog operator
    function isActiveWatchdog(address operator) external view returns (bool) {
        return watchdogs[operator].active;
    }
}