// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title WatchdogSubjectiveReporting
/// @notice Simple transparent reporting system for subjective watchdog observations
/// @dev Watchdogs report observations. DAO monitors events and acts directly via governance.
contract WatchdogSubjectiveReporting is AccessControl, ReentrancyGuard {
    bytes32 public constant WATCHDOG_ROLE = keccak256("WATCHDOG_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    
    /// @notice Types of subjective observations
    enum ObservationType {
        SUSPICIOUS_PATTERN,      // Unusual transaction patterns
        OPERATIONAL_CONCERN,     // Quality of service issues
        UNUSUAL_BEHAVIOR,        // Deviations from normal operations
        COMPLIANCE_QUESTION,     // Potential compliance issues
        SECURITY_OBSERVATION,    // Security-related concerns
        GENERAL_CONCERN         // Other observations
    }
    
    /// @notice A subjective observation report
    struct Report {
        uint256 id;
        address watchdog;           // Who reported
        address target;             // Subject of observation (QC, wallet, etc)
        ObservationType obsType;    // Category of observation
        string description;         // Human-readable description
        bytes32[] evidenceHashes;   // Array of evidence hashes (stored off-chain)
        uint256 timestamp;         // When reported
        uint256 supportCount;      // Number of supporting watchdogs
    }
    
    // Storage
    mapping(uint256 => Report) public reports;
    mapping(uint256 => mapping(address => bool)) public hasSupported;
    mapping(address => uint256[]) public reportsByTarget;
    mapping(address => uint256[]) public reportsByWatchdog;
    
    uint256 public nextReportId = 1;
    uint256 public constant MAX_EVIDENCE_PER_REPORT = 20;
    
    // Events
    event ObservationReported(
        uint256 indexed reportId,
        address indexed target,
        ObservationType indexed obsType,
        address watchdog,
        string description,
        uint256 timestamp
    );
    
    event ReportSupported(
        uint256 indexed reportId,
        address indexed supporter,
        uint256 newSupportCount
    );
    
    event EvidenceAppended(
        uint256 indexed reportId,
        address indexed appender,
        bytes32 evidenceHash
    );
    
    // Custom errors
    error InvalidTarget();
    error DescriptionRequired();
    error ReportNotFound();
    error CannotSupportOwnReport();
    error AlreadySupported();
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
    }
    
    // =================== REPORTING FUNCTIONS ===================
    
    /// @notice Submit a subjective observation report
    /// @param target The address being reported on
    /// @param obsType The type of observation
    /// @param description Human-readable description for DAO review
    /// @param initialEvidenceHash Initial evidence hash (optional, use bytes32(0) for none)
    /// @return reportId The ID of the created report
    function reportObservation(
        address target,
        ObservationType obsType,
        string calldata description,
        bytes32 initialEvidenceHash
    ) external onlyRole(WATCHDOG_ROLE) nonReentrant returns (uint256 reportId) {
        if (target == address(0)) revert InvalidTarget();
        if (bytes(description).length == 0) revert DescriptionRequired();
        
        reportId = nextReportId++;
        
        reports[reportId] = Report({
            id: reportId,
            watchdog: msg.sender,
            target: target,
            obsType: obsType,
            description: description,
            evidenceHashes: new bytes32[](0),
            timestamp: block.timestamp,
            supportCount: 0
        });
        
        // Add initial evidence if provided
        if (initialEvidenceHash != bytes32(0)) {
            reports[reportId].evidenceHashes.push(initialEvidenceHash);
        }
        
        reportsByTarget[target].push(reportId);
        reportsByWatchdog[msg.sender].push(reportId);
        
        emit ObservationReported(reportId, target, obsType, msg.sender, description, block.timestamp);
    }
    
    /// @notice Support another watchdog's observation
    /// @param reportId The report to support
    function supportReport(uint256 reportId) external onlyRole(WATCHDOG_ROLE) {
        Report storage report = reports[reportId];
        
        if (report.timestamp == 0) revert ReportNotFound();
        if (report.watchdog == msg.sender) revert CannotSupportOwnReport();
        if (hasSupported[reportId][msg.sender]) revert AlreadySupported();
        
        hasSupported[reportId][msg.sender] = true;
        report.supportCount++;
        
        emit ReportSupported(reportId, msg.sender, report.supportCount);
    }
    
    /// @notice Append additional evidence hash to a report
    /// @param reportId The report to update
    /// @param evidenceHash Hash of new evidence (actual content stored off-chain)
    function appendEvidence(
        uint256 reportId,
        bytes32 evidenceHash
    ) external onlyRole(WATCHDOG_ROLE) {
        Report storage report = reports[reportId];
        
        if (report.timestamp == 0) revert ReportNotFound();
        
        // Only original reporter or supporters can add evidence
        require(
            report.watchdog == msg.sender || hasSupported[reportId][msg.sender],
            "Not authorized to append evidence"
        );
        
        // Prevent DoS by limiting evidence count
        require(
            report.evidenceHashes.length < MAX_EVIDENCE_PER_REPORT,
            "Evidence limit reached"
        );
        
        require(evidenceHash != bytes32(0), "Invalid evidence hash");
        
        report.evidenceHashes.push(evidenceHash);
        
        emit EvidenceAppended(reportId, msg.sender, evidenceHash);
    }
    
    // =================== VIEW FUNCTIONS ===================
    
    /// @notice Get all reports for a target
    /// @param target The address to query
    /// @return reportIds Array of report IDs
    function getReportsForTarget(address target) external view returns (uint256[] memory) {
        return reportsByTarget[target];
    }
    
    /// @notice Get all reports by a watchdog
    /// @param watchdog The watchdog address
    /// @return reportIds Array of report IDs
    function getReportsByWatchdog(address watchdog) external view returns (uint256[] memory) {
        return reportsByWatchdog[watchdog];
    }
    
    /// @notice Get detailed report information
    /// @param reportId The report ID
    /// @return report The full report struct
    function getReport(uint256 reportId) external view returns (Report memory) {
        return reports[reportId];
    }
    
    /// @notice Get evidence hashes for a report
    /// @param reportId The report ID
    /// @return evidenceHashes Array of evidence hashes
    function getEvidenceHashes(uint256 reportId) external view returns (bytes32[] memory) {
        return reports[reportId].evidenceHashes;
    }
    
    /// @notice Get high-support reports that might need DAO attention
    /// @param minSupport Minimum support count to filter by
    /// @return reportIds Array of report IDs with sufficient support
    function getHighSupportReports(uint256 minSupport) external view returns (uint256[] memory) {
        uint256[] memory candidates = new uint256[](nextReportId);
        uint256 count = 0;
        
        for (uint256 i = 1; i < nextReportId; i++) {
            if (reports[i].timestamp > 0 && reports[i].supportCount >= minSupport) {
                candidates[count++] = i;
            }
        }
        
        // Return trimmed array
        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = candidates[i];
        }
        
        return result;
    }
}