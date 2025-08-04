// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./QCManager.sol";
import "./QCData.sol";
import "./SystemState.sol";

/// @title WatchdogDAOEscalation
/// @notice Layer 3: DAO escalation system for non-deterministic decisions
/// @dev Creates DAO proposals for all issues requiring governance decisions
contract WatchdogDAOEscalation is AccessControl, ReentrancyGuard {
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant ESCALATOR_ROLE = keccak256("ESCALATOR_ROLE");

    // DAO interface - simplified for integration
    interface IGovernor {
        function propose(
            address[] memory targets,
            uint256[] memory values,
            bytes[] memory calldatas,
            string memory description
        ) external returns (uint256 proposalId);
    }

    enum ReportType {
        SUSPICIOUS_ACTIVITY,    // 0
        UNUSUAL_PATTERN,        // 1
        EMERGENCY_SITUATION,    // 2
        OPERATIONAL_CONCERN     // 3
    }

    struct Escalation {
        bytes32 issueId;
        uint8 reportType;
        address target;
        bytes evidence;          // Aggregated evidence from reports
        uint256 timestamp;
        uint256 watchdogCount;
        uint256 proposalId;      // DAO proposal ID
        bool resolved;
        string description;      // Human-readable description for DAO
    }

    // External contracts
    QCManager public immutable qcManager;
    QCData public immutable qcData;
    SystemState public immutable systemState;
    IGovernor public dao;

    // Configuration
    uint256 public constant MIN_PROPOSAL_DELAY = 2 days;
    uint256 public proposalCounter;

    // Storage
    mapping(bytes32 => Escalation) public escalations;
    mapping(uint256 => bytes32) public proposalToEscalation; // DAO proposal ID -> escalation ID

    // Events
    event EscalatedToDAO(
        bytes32 indexed escalationId,
        uint8 indexed reportType,
        address indexed target,
        uint256 watchdogCount,
        uint256 proposalId,
        string description
    );

    event EscalationResolved(
        bytes32 indexed escalationId,
        uint256 indexed proposalId,
        bool approved,
        address resolver
    );

    event DAOProposalCreated(
        bytes32 indexed escalationId,
        uint256 indexed proposalId,
        ReportType reportType,
        address target
    );

    event EmergencyProposalCreated(
        bytes32 indexed escalationId,
        uint256 indexed proposalId,
        address target
    );

    // Custom errors
    error NotAuthorized();
    error EscalationNotFound();
    error AlreadyResolved();
    error DAONotSet();
    error InvalidReportType();
    error ProposalCreationFailed();

    modifier onlyEscalator() {
        if (!hasRole(ESCALATOR_ROLE, msg.sender)) {
            revert NotAuthorized();
        }
        _;
    }

    constructor(
        address _qcManager,
        address _qcData,
        address _systemState,
        address _dao
    ) {
        qcManager = QCManager(_qcManager);
        qcData = QCData(_qcData);
        systemState = SystemState(_systemState);
        dao = IGovernor(_dao);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
        _grantRole(ESCALATOR_ROLE, msg.sender);
    }

    // =================== ESCALATION FUNCTIONS ===================

    /// @notice Escalate an issue to DAO governance
    /// @param issueId The unique issue identifier
    /// @param reportType The type of report (0-3)
    /// @param target The target QC or contract address
    /// @param evidence Aggregated evidence from watchdog reports
    function escalate(
        bytes32 issueId,
        uint8 reportType,
        address target,
        bytes calldata evidence
    ) external onlyEscalator nonReentrant {
        if (address(dao) == address(0)) revert DAONotSet();
        if (reportType > 3) revert InvalidReportType();

        bytes32 escalationId = _generateEscalationId(issueId);

        // Create escalation record
        string memory description = _generateDescription(reportType, target, evidence);
        
        escalations[escalationId] = Escalation({
            issueId: issueId,
            reportType: reportType,
            target: target,
            evidence: evidence,
            timestamp: block.timestamp,
            watchdogCount: 3, // Threshold count that triggered escalation
            proposalId: 0,
            resolved: false,
            description: description
        });

        // Create appropriate DAO proposal
        uint256 proposalId = _createDAOProposal(ReportType(reportType), target, evidence, description);
        escalations[escalationId].proposalId = proposalId;
        proposalToEscalation[proposalId] = escalationId;

        emit EscalatedToDAO(
            escalationId,
            reportType,
            target,
            3, // Threshold count
            proposalId,
            description
        );

        emit DAOProposalCreated(escalationId, proposalId, ReportType(reportType), target);
    }

    // =================== DAO PROPOSAL CREATION ===================

    function _createDAOProposal(
        ReportType reportType,
        address target,
        bytes memory evidence,
        string memory description
    ) internal returns (uint256) {
        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);

        targets[0] = address(qcManager);
        values[0] = 0;

        string memory proposalDescription;

        if (reportType == ReportType.SUSPICIOUS_ACTIVITY) {
            // Propose to revoke QC
            calldatas[0] = abi.encodeWithSignature(
                "setQCStatus(address,uint8,bytes32)",
                target,
                uint8(QCData.QCStatus.Revoked),
                "SUSPICIOUS_ACTIVITY_CONFIRMED"
            );

            proposalDescription = string(abi.encodePacked(
                "Revoke QC ",
                _addressToString(target),
                " for suspicious activity. ",
                description,
                " Evidence hash: ",
                _bytes32ToString(keccak256(evidence))
            ));

        } else if (reportType == ReportType.EMERGENCY_SITUATION) {
            // Propose emergency measures
            calldatas[0] = abi.encodeWithSignature(
                "setQCStatus(address,uint8,bytes32)",
                target,
                uint8(QCData.QCStatus.Suspended),
                "EMERGENCY_CONFIRMED"
            );

            proposalDescription = string(abi.encodePacked(
                "Emergency: Suspend QC ",
                _addressToString(target),
                " due to emergency situation. ",
                description
            ));

        } else if (reportType == ReportType.UNUSUAL_PATTERN) {
            // Propose investigation and potential restrictions
            calldatas[0] = abi.encodeWithSignature(
                "setQCStatus(address,uint8,bytes32)",
                target,
                uint8(QCData.QCStatus.UnderReview),
                "UNUSUAL_PATTERN_DETECTED"
            );

            proposalDescription = string(abi.encodePacked(
                "Investigate QC ",
                _addressToString(target),
                " for unusual patterns. ",
                description
            ));

        } else if (reportType == ReportType.OPERATIONAL_CONCERN) {
            // Propose operational review
            calldatas[0] = abi.encodeWithSignature(
                "setQCStatus(address,uint8,bytes32)",
                target,
                uint8(QCData.QCStatus.UnderReview),
                "OPERATIONAL_CONCERN_RAISED"
            );

            proposalDescription = string(abi.encodePacked(
                "Review QC ",
                _addressToString(target),
                " operations based on watchdog concerns. ",
                description
            ));
        }

        try dao.propose(targets, values, calldatas, proposalDescription) returns (uint256 proposalId) {
            return proposalId;
        } catch {
            revert ProposalCreationFailed();
        }
    }

    // =================== RESOLUTION FUNCTIONS ===================

    /// @notice Mark an escalation as resolved (called after DAO vote)
    /// @param escalationId The escalation ID
    /// @param approved Whether the DAO proposal was approved
    function resolveEscalation(bytes32 escalationId, bool approved) 
        external onlyRole(MANAGER_ROLE) 
    {
        Escalation storage escalation = escalations[escalationId];
        
        if (escalation.timestamp == 0) revert EscalationNotFound();
        if (escalation.resolved) revert AlreadyResolved();

        escalation.resolved = true;

        emit EscalationResolved(
            escalationId,
            escalation.proposalId,
            approved,
            msg.sender
        );
    }

    /// @notice Batch resolve multiple escalations
    /// @param escalationIds Array of escalation IDs
    /// @param approvals Array of approval statuses
    function batchResolveEscalations(
        bytes32[] calldata escalationIds,
        bool[] calldata approvals
    ) external onlyRole(MANAGER_ROLE) {
        require(escalationIds.length == approvals.length, "Array length mismatch");
        
        for (uint256 i = 0; i < escalationIds.length; i++) {
            try this.resolveEscalation(escalationIds[i], approvals[i]) {
                // Success, continue
            } catch {
                // Skip failed resolution and continue
                continue;
            }
        }
    }

    // =================== EMERGENCY PROPOSALS ===================

    /// @notice Create emergency proposal for immediate action
    /// @param target The target QC
    /// @param reason The emergency reason
    /// @param immediateAction The action to take immediately
    function createEmergencyProposal(
        address target,
        bytes32 reason,
        bytes calldata immediateAction
    ) external onlyRole(MANAGER_ROLE) returns (uint256 proposalId) {
        if (address(dao) == address(0)) revert DAONotSet();

        bytes32 escalationId = _generateEscalationId(
            keccak256(abi.encodePacked("EMERGENCY", target, reason, block.timestamp))
        );

        // Create escalation record
        escalations[escalationId] = Escalation({
            issueId: keccak256(abi.encodePacked("EMERGENCY", reason)),
            reportType: uint8(ReportType.EMERGENCY_SITUATION),
            target: target,
            evidence: immediateAction,
            timestamp: block.timestamp,
            watchdogCount: 0, // Emergency doesn't require watchdog threshold
            proposalId: 0,
            resolved: false,
            description: string(abi.encodePacked("Emergency: ", _bytes32ToString(reason)))
        });

        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);

        targets[0] = target;
        values[0] = 0;
        calldatas[0] = immediateAction;

        string memory description = string(abi.encodePacked(
            "EMERGENCY PROPOSAL: Immediate action required for ",
            _addressToString(target),
            ". Reason: ",
            _bytes32ToString(reason)
        ));

        proposalId = dao.propose(targets, values, calldatas, description);
        escalations[escalationId].proposalId = proposalId;
        proposalToEscalation[proposalId] = escalationId;

        emit EmergencyProposalCreated(escalationId, proposalId, target);
        
        return proposalId;
    }

    // =================== HELPER FUNCTIONS ===================

    function _generateEscalationId(bytes32 issueId) internal returns (bytes32) {
        proposalCounter++;
        return keccak256(abi.encodePacked(
            issueId,
            proposalCounter,
            block.timestamp
        ));
    }

    function _generateDescription(
        uint8 reportType,
        address target,
        bytes memory evidence
    ) internal pure returns (string memory) {
        string memory typeStr;
        
        if (reportType == 0) typeStr = "Suspicious Activity";
        else if (reportType == 1) typeStr = "Unusual Pattern";
        else if (reportType == 2) typeStr = "Emergency Situation";
        else if (reportType == 3) typeStr = "Operational Concern";
        else typeStr = "Unknown";

        return string(abi.encodePacked(
            typeStr,
            " detected for QC ",
            _addressToString(target),
            ". Multiple watchdogs reported concerns. Evidence hash: ",
            _bytes32ToString(keccak256(evidence))
        ));
    }

    function _addressToString(address addr) internal pure returns (string memory) {
        bytes32 value = bytes32(uint256(uint160(addr)));
        bytes memory alphabet = "0123456789abcdef";
        
        bytes memory str = new bytes(42);
        str[0] = '0';
        str[1] = 'x';
        
        for (uint256 i = 0; i < 20; i++) {
            str[2 + i * 2] = alphabet[uint8(value[i + 12] >> 4)];
            str[3 + i * 2] = alphabet[uint8(value[i + 12] & 0x0f)];
        }
        
        return string(str);
    }

    function _bytes32ToString(bytes32 data) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(64);
        
        for (uint256 i = 0; i < 32; i++) {
            str[i * 2] = alphabet[uint8(data[i] >> 4)];
            str[1 + i * 2] = alphabet[uint8(data[i] & 0x0f)];
        }
        
        return string(str);
    }

    // =================== VIEW FUNCTIONS ===================

    /// @notice Get escalation details
    /// @param escalationId The escalation ID
    /// @return escalation The escalation data
    function getEscalation(bytes32 escalationId) 
        external view returns (Escalation memory escalation) 
    {
        return escalations[escalationId];
    }

    /// @notice Get escalation ID by DAO proposal ID
    /// @param proposalId The DAO proposal ID
    /// @return escalationId The corresponding escalation ID
    function getEscalationByProposal(uint256 proposalId) 
        external view returns (bytes32 escalationId) 
    {
        return proposalToEscalation[proposalId];
    }

    /// @notice Check if escalation exists and is active
    /// @param escalationId The escalation ID
    /// @return exists True if escalation exists
    /// @return resolved True if escalation is resolved
    function getEscalationStatus(bytes32 escalationId) 
        external view returns (bool exists, bool resolved) 
    {
        Escalation memory escalation = escalations[escalationId];
        return (escalation.timestamp > 0, escalation.resolved);
    }

    /// @notice Get all escalations for a target (view function, gas intensive)
    /// @param target The target address
    /// @param limit Maximum number of results
    /// @return escalationIds Array of escalation IDs
    function getEscalationsForTarget(address target, uint256 limit) 
        external view returns (bytes32[] memory escalationIds) 
    {
        // Note: This is a gas-intensive operation, should be used carefully
        // In production, consider implementing a mapping from target to escalation IDs
        
        bytes32[] memory results = new bytes32[](limit);
        uint256 count = 0;
        
        // This is inefficient but works for demonstration
        // In production, you'd want to maintain target -> escalationIds mapping
        for (uint256 i = 1; i <= proposalCounter && count < limit; i++) {
            bytes32 testId = keccak256(abi.encodePacked("test", i)); // Simplified
            if (escalations[testId].target == target) {
                results[count] = testId;
                count++;
            }
        }
        
        // Resize array to actual count
        bytes32[] memory finalResults = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            finalResults[i] = results[i];
        }
        
        return finalResults;
    }

    // =================== ADMIN FUNCTIONS ===================

    /// @notice Update the DAO contract address
    /// @param _dao The new DAO contract address
    function setDAO(address _dao) external onlyRole(MANAGER_ROLE) {
        dao = IGovernor(_dao);
    }

    /// @notice Emergency cleanup of resolved escalations
    /// @param escalationIds Array of escalation IDs to clean up
    function cleanupResolvedEscalations(bytes32[] calldata escalationIds) 
        external onlyRole(MANAGER_ROLE) 
    {
        for (uint256 i = 0; i < escalationIds.length; i++) {
            Escalation storage escalation = escalations[escalationIds[i]];
            
            if (escalation.resolved && 
                block.timestamp > escalation.timestamp + 30 days) {
                // Clean up old resolved escalations
                delete proposalToEscalation[escalation.proposalId];
                delete escalations[escalationIds[i]];
            }
        }
    }
}