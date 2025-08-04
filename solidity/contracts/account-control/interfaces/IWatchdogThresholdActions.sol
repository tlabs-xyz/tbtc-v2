// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title IWatchdogThresholdActions
/// @notice Interface for the threshold-based reporting component of the watchdog system
/// @dev This interface handles subjective issues requiring multiple watchdog reports
interface IWatchdogThresholdActions {
    /// @notice Types of reports that can be submitted
    enum ReportType {
        AnomalousActivity,
        PolicyViolation,
        OperationalConcern,
        SecurityThreat,
        ComplianceIssue
    }

    /// @notice Structure for tracking reports
    struct Report {
        uint8 reportType;
        address target;
        address reporter;
        uint256 timestamp;
        bytes32 evidenceHash;
        string evidenceURI;
    }

    /// @notice Structure for tracking issue status
    struct Issue {
        uint8 reportType;
        address target;
        uint256 reportCount;
        uint256 firstReportTime;
        bool actionExecuted;
        bool escalated;
    }

    /// @notice Emitted when a new report is submitted
    event ReportSubmitted(
        bytes32 indexed issueId,
        uint8 reportType,
        address indexed target,
        address indexed reporter,
        bytes32 evidenceHash,
        string evidenceURI
    );

    /// @notice Emitted when threshold is reached and action is executed
    event ThresholdActionExecuted(
        bytes32 indexed issueId,
        uint8 reportType,
        address indexed target,
        uint256 reportCount
    );

    /// @notice Emitted when an issue is escalated to DAO
    event IssueEscalated(
        bytes32 indexed issueId,
        uint8 reportType,
        address indexed target,
        uint256 reportCount
    );

    /// @notice Custom errors
    error InvalidReportType();
    error ReportCooldownActive();
    error IssueAlreadyEscalated();
    error NotAuthorized();
    error InvalidEvidence();

    /// @notice Submit a report about a QC or redemption
    /// @dev Requires WATCHDOG_ROLE
    /// @param reportType The type of report being submitted
    /// @param target The address of the QC or contract being reported
    /// @param evidenceHash Hash of the evidence (for verification)
    /// @param evidenceURI URI pointing to detailed evidence (e.g., IPFS)
    function reportIssue(
        ReportType reportType,
        address target,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external;

    /// @notice Get the current status of an issue
    /// @param issueId The ID of the issue
    /// @return The issue details
    function getIssue(bytes32 issueId) external view returns (Issue memory);

    /// @notice Get all reports for a specific issue
    /// @param issueId The ID of the issue
    /// @return Array of reports
    function getReports(bytes32 issueId) external view returns (Report[] memory);

    /// @notice Set the DAO escalation contract address
    /// @dev Only callable by admin role
    /// @param daoEscalation The address of the DAO escalation contract
    function setDAOEscalation(address daoEscalation) external;

    /// @notice Set the report threshold for action execution
    /// @dev Only callable by admin role
    /// @param threshold The number of reports required to trigger action
    function setReportThreshold(uint256 threshold) external;

    /// @notice Set the time window for report aggregation
    /// @dev Only callable by admin role
    /// @param window The time window in seconds
    function setReportWindow(uint256 window) external;

    /// @notice Check if a watchdog can submit a report (cooldown check)
    /// @param reporter The address of the watchdog
    /// @param target The target being reported
    /// @return Whether the watchdog can submit a report
    function canReport(address reporter, address target) external view returns (bool);

    /// @notice Generate issue ID from report type and target
    /// @param reportType The type of report
    /// @param target The target address
    /// @return The generated issue ID
    function generateIssueId(
        ReportType reportType,
        address target
    ) external pure returns (bytes32);
}