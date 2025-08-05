// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./QCManager.sol";
import "./QCData.sol";
import "./SystemState.sol";
import "./WatchdogDAOEscalation.sol";

/// @title WatchdogThresholdActions
/// @notice Layer 2: Threshold-based actions for non-deterministic issues
/// @dev Collects reports from watchdogs, executes actions when threshold reached
contract WatchdogThresholdActions is AccessControl, ReentrancyGuard {
    bytes32 public constant WATCHDOG_ROLE = keccak256("WATCHDOG_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // Configuration from SystemState
    uint256 public constant REPORT_THRESHOLD = 3;
    uint256 public constant REPORT_WINDOW = 24 hours;
    uint256 public constant COOLDOWN_PERIOD = 7 days;

    enum ReportType {
        SUSPICIOUS_ACTIVITY,    // 0 - Immediate pause + DAO escalation
        UNUSUAL_PATTERN,        // 1 - Flag for review + DAO escalation
        EMERGENCY_SITUATION,    // 2 - Emergency pause + DAO escalation
        OPERATIONAL_CONCERN     // 3 - Log concern + DAO escalation
    }

    struct Report {
        address watchdog;
        uint256 timestamp;
        bytes32 evidenceHash;
        string evidenceURI;      // IPFS link to detailed evidence
    }

    struct IssueData {
        ReportType reportType;
        address target;
        uint256 lastActionTime;
        bool actionExecuted;
    }

    // External contracts
    QCManager public immutable qcManager;
    QCData public immutable qcData;
    SystemState public immutable systemState;
    WatchdogDAOEscalation public daoEscalation;

    // Storage
    mapping(bytes32 => Report[]) public reports;
    mapping(bytes32 => IssueData) public issues;
    mapping(bytes32 => mapping(address => bool)) public hasReported;

    // Events
    event IssueReported(
        bytes32 indexed issueId,
        ReportType indexed reportType,
        address indexed target,
        address watchdog,
        bytes32 evidenceHash,
        string evidenceURI
    );

    event ThresholdReached(
        bytes32 indexed issueId,
        ReportType indexed reportType,
        address indexed target,
        uint256 reportCount
    );

    event ThresholdActionExecuted(
        bytes32 indexed issueId,
        ReportType indexed reportType,
        address indexed target,
        uint256 reportCount,
        bytes32 action
    );

    event UnusualPatternDetected(
        address indexed target,
        uint256 reportCount
    );

    event OperationalConcernRaised(
        address indexed target,
        uint256 reportCount
    );

    event EmergencyActionTaken(
        address indexed target,
        bytes32 reason
    );

    // Custom errors
    error NotWatchdog();
    error InCooldownPeriod();
    error AlreadyReported();
    error InvalidReportType();
    error InvalidTarget();
    error ThresholdNotReached();
    error ActionAlreadyExecuted();
    error DAOEscalationNotSet();

    modifier onlyWatchdog() {
        if (!hasRole(WATCHDOG_ROLE, msg.sender)) {
            revert NotWatchdog();
        }
        _;
    }

    constructor(
        address _qcManager,
        address _qcData,
        address _systemState
    ) {
        qcManager = QCManager(_qcManager);
        qcData = QCData(_qcData);
        systemState = SystemState(_systemState);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
    }

    // =================== REPORTING FUNCTIONS ===================

    /// @notice Report a non-deterministic issue requiring threshold action
    /// @param reportType The type of report being submitted
    /// @param target The target QC or contract address
    /// @param evidenceHash Hash of the evidence supporting this report
    /// @param evidenceURI IPFS URI containing detailed evidence
    function reportIssue(
        ReportType reportType,
        address target,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external onlyWatchdog nonReentrant {
        if (target == address(0)) revert InvalidTarget();
        if (uint8(reportType) > 3) revert InvalidReportType();

        bytes32 issueId = _generateIssueId(reportType, target);

        // Check cooldown period
        if (block.timestamp <= issues[issueId].lastActionTime + COOLDOWN_PERIOD) {
            revert InCooldownPeriod();
        }

        // Check if this watchdog already reported this issue
        if (hasReported[issueId][msg.sender]) {
            revert AlreadyReported();
        }

        // Mark as reported by this watchdog
        hasReported[issueId][msg.sender] = true;

        // Store issue metadata if first report
        if (reports[issueId].length == 0) {
            issues[issueId] = IssueData({
                reportType: reportType,
                target: target,
                lastActionTime: 0,
                actionExecuted: false
            });
        }

        // Add the report
        reports[issueId].push(Report({
            watchdog: msg.sender,
            timestamp: block.timestamp,
            evidenceHash: evidenceHash,
            evidenceURI: evidenceURI
        }));

        emit IssueReported(
            issueId,
            reportType,
            target,
            msg.sender,
            evidenceHash,
            evidenceURI
        );

        // Check if threshold reached
        uint256 recentReports = _countRecentReports(issueId);
        if (recentReports >= REPORT_THRESHOLD) {
            emit ThresholdReached(issueId, reportType, target, recentReports);
            _executeThresholdAction(issueId, reportType, target, recentReports);
        }
    }

    // =================== THRESHOLD ACTION EXECUTION ===================

    function _executeThresholdAction(
        bytes32 issueId,
        ReportType reportType,
        address target,
        uint256 reportCount
    ) internal {
        // Prevent duplicate execution
        if (issues[issueId].actionExecuted) {
            revert ActionAlreadyExecuted();
        }

        issues[issueId].lastActionTime = block.timestamp;
        issues[issueId].actionExecuted = true;

        bytes32 actionTaken;
        bytes memory evidence = _aggregateEvidence(issueId);

        if (reportType == ReportType.SUSPICIOUS_ACTIVITY) {
            // Immediate pause pending DAO review
            qcManager.setQCStatus(target, QCData.QCStatus.UnderReview, "SUSPICIOUS_ACTIVITY");
            actionTaken = "IMMEDIATE_PAUSE";
            
            emit EmergencyActionTaken(target, "SUSPICIOUS_ACTIVITY");
            
            // Escalate to DAO
            if (address(daoEscalation) != address(0)) {
                daoEscalation.escalate(issueId, uint8(reportType), target, evidence);
            }

        } else if (reportType == ReportType.EMERGENCY_SITUATION) {
            // Emergency pause all operations
            systemState.emergencyPause(target);
            actionTaken = "EMERGENCY_PAUSE";
            
            emit EmergencyActionTaken(target, "EMERGENCY_SITUATION");
            
            // Escalate to DAO
            if (address(daoEscalation) != address(0)) {
                daoEscalation.escalate(issueId, uint8(reportType), target, evidence);
            }

        } else if (reportType == ReportType.UNUSUAL_PATTERN) {
            // Flag for review without immediate pause
            actionTaken = "PATTERN_FLAGGED";
            
            emit UnusualPatternDetected(target, reportCount);
            
            // Escalate to DAO for investigation
            if (address(daoEscalation) != address(0)) {
                daoEscalation.escalate(issueId, uint8(reportType), target, evidence);
            }

        } else if (reportType == ReportType.OPERATIONAL_CONCERN) {
            // Log concern and escalate
            actionTaken = "CONCERN_LOGGED";
            
            emit OperationalConcernRaised(target, reportCount);
            
            // Escalate to DAO for review
            if (address(daoEscalation) != address(0)) {
                daoEscalation.escalate(issueId, uint8(reportType), target, evidence);
            }
        }

        emit ThresholdActionExecuted(issueId, reportType, target, reportCount, actionTaken);

        // Reset reporting state for future reports
        _resetReportingState(issueId);
    }

    // =================== MANUAL EXECUTION ===================

    /// @notice Manually execute threshold action if threshold was reached
    /// @param issueId The issue ID to execute action for
    function executeThresholdAction(bytes32 issueId) external nonReentrant {
        IssueData memory issue = issues[issueId];
        
        if (issue.target == address(0)) revert InvalidTarget();
        if (issue.actionExecuted) revert ActionAlreadyExecuted();
        
        uint256 recentReports = _countRecentReports(issueId);
        if (recentReports < REPORT_THRESHOLD) revert ThresholdNotReached();

        _executeThresholdAction(issueId, issue.reportType, issue.target, recentReports);
    }

    // =================== HELPER FUNCTIONS ===================

    function _generateIssueId(ReportType reportType, address target) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(reportType, target));
    }

    function _countRecentReports(bytes32 issueId) internal view returns (uint256) {
        uint256 count = 0;
        uint256 cutoff = block.timestamp - REPORT_WINDOW;
        
        Report[] memory issueReports = reports[issueId];
        for (uint256 i = 0; i < issueReports.length; i++) {
            if (issueReports[i].timestamp > cutoff) {
                count++;
            }
        }
        
        return count;
    }

    /// @notice Aggregate evidence hashes from all reports for a specific issue
    /// @dev Collects all evidence hashes submitted by watchdogs for the given issue into an encoded array.
    ///      This aggregated evidence is passed to DAO proposals for review.
    /// @param issueId The unique identifier of the issue
    /// @return Encoded array of evidence hashes (bytes32[])
    function _aggregateEvidence(bytes32 issueId) internal view returns (bytes memory) {
        Report[] memory issueReports = reports[issueId];
        bytes32[] memory evidenceHashes = new bytes32[](issueReports.length);
        
        for (uint256 i = 0; i < issueReports.length; i++) {
            evidenceHashes[i] = issueReports[i].evidenceHash;
        }
        
        return abi.encode(evidenceHashes);
    }

    /// @notice Reset the reporting state for an issue after action execution
    /// @dev Clears all watchdog report flags and deletes the reports array.
    ///      This allows fresh reporting for the same issue after cooldown period.
    /// @param issueId The unique identifier of the issue to reset
    function _resetReportingState(bytes32 issueId) internal {
        // Clear hasReported mapping for all watchdogs
        Report[] memory issueReports = reports[issueId];
        for (uint256 i = 0; i < issueReports.length; i++) {
            hasReported[issueId][issueReports[i].watchdog] = false;
        }
        
        // Clear reports array
        delete reports[issueId];
        
        // Reset action executed flag
        issues[issueId].actionExecuted = false;
    }

    // =================== VIEW FUNCTIONS ===================

    /// @notice Get all reports for an issue
    /// @param issueId The issue ID
    /// @return allReports Array of reports
    function getReports(bytes32 issueId) external view returns (Report[] memory allReports) {
        return reports[issueId];
    }

    /// @notice Get recent report count for an issue
    /// @param issueId The issue ID
    /// @return count Number of recent reports
    function getRecentReportCount(bytes32 issueId) external view returns (uint256 count) {
        return _countRecentReports(issueId);
    }

    /// @notice Check if watchdog has reported an issue
    /// @param issueId The issue ID
    /// @param watchdog The watchdog address
    /// @return reported True if already reported
    function hasWatchdogReported(bytes32 issueId, address watchdog) 
        external view returns (bool reported) 
    {
        return hasReported[issueId][watchdog];
    }

    /// @notice Get issue metadata
    /// @param issueId The issue ID
    /// @return issue The issue data
    function getIssue(bytes32 issueId) external view returns (IssueData memory issue) {
        return issues[issueId];
    }

    /// @notice Check if issue can receive new reports
    /// @param reportType The report type
    /// @param target The target address
    /// @return canReport True if reporting is allowed
    function canReportIssue(ReportType reportType, address target) 
        external view returns (bool canReport) 
    {
        bytes32 issueId = _generateIssueId(reportType, target);
        
        return block.timestamp > issues[issueId].lastActionTime + COOLDOWN_PERIOD &&
               !hasReported[issueId][msg.sender];
    }

    /// @notice Generate issue ID for external use
    /// @param reportType The report type
    /// @param target The target address
    /// @return issueId The generated issue ID
    function generateIssueId(ReportType reportType, address target) 
        external pure returns (bytes32 issueId) 
    {
        return _generateIssueId(reportType, target);
    }

    // =================== ADMIN FUNCTIONS ===================

    /// @notice Set the DAO escalation contract
    /// @param _daoEscalation The DAO escalation contract address
    function setDAOEscalation(address _daoEscalation) external onlyRole(MANAGER_ROLE) {
        daoEscalation = WatchdogDAOEscalation(_daoEscalation);
    }

    /// @notice Emergency reset of an issue (admin only)
    /// @param issueId The issue ID to reset
    function emergencyResetIssue(bytes32 issueId) external onlyRole(MANAGER_ROLE) {
        _resetReportingState(issueId);
        issues[issueId].actionExecuted = false;
        issues[issueId].lastActionTime = 0;
    }

    /// @notice Clean up old reports outside the window
    /// @param issueIds Array of issue IDs to clean
    function cleanupOldReports(bytes32[] calldata issueIds) external {
        uint256 cutoff = block.timestamp - REPORT_WINDOW;
        
        for (uint256 i = 0; i < issueIds.length; i++) {
            bytes32 issueId = issueIds[i];
            Report[] storage issueReports = reports[issueId];
            
            // Remove old reports (this is gas-intensive, should be used sparingly)
            uint256 writeIndex = 0;
            for (uint256 j = 0; j < issueReports.length; j++) {
                if (issueReports[j].timestamp > cutoff) {
                    if (writeIndex != j) {
                        issueReports[writeIndex] = issueReports[j];
                    }
                    writeIndex++;
                } else {
                    // Clear hasReported for old reports
                    hasReported[issueId][issueReports[j].watchdog] = false;
                }
            }
            
            // Trim array
            while (issueReports.length > writeIndex) {
                issueReports.pop();
            }
        }
    }
}