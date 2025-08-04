// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.21;

/// @title IWatchdogDAOEscalation
/// @notice Interface for the DAO escalation component of the watchdog system
/// @dev This interface handles creating governance proposals for unresolved issues
interface IWatchdogDAOEscalation {
    /// @notice Structure for tracking escalated issues
    struct EscalatedIssue {
        bytes32 issueId;
        uint8 reportType;
        address target;
        uint256 escalationTime;
        uint256 proposalId;
        bool resolved;
        bytes evidence;
    }

    /// @notice Emitted when an issue is escalated to DAO
    event IssueEscalatedToDAO(
        bytes32 indexed issueId,
        uint8 reportType,
        address indexed target,
        uint256 proposalId
    );

    /// @notice Emitted when an emergency proposal is created
    event EmergencyProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string description
    );

    /// @notice Emitted when an escalated issue is resolved
    event EscalatedIssueResolved(
        bytes32 indexed issueId,
        uint256 proposalId,
        bool approved
    );

    /// @notice Custom errors
    error NotAuthorized();
    error IssueAlreadyEscalated();
    error InvalidReportType();
    error ProposalCreationFailed();

    /// @notice Escalate an issue to DAO governance
    /// @dev Only callable by ESCALATOR_ROLE (typically ThresholdActions contract)
    /// @param issueId The ID of the issue to escalate
    /// @param reportType The type of report
    /// @param target The target address
    /// @param evidence Encoded evidence for the proposal
    function escalate(
        bytes32 issueId,
        uint8 reportType,
        address target,
        bytes calldata evidence
    ) external;

    /// @notice Create an emergency proposal
    /// @dev Only callable by DAO_ROLE
    /// @param targets Array of target addresses for the proposal
    /// @param values Array of ETH values for the proposal
    /// @param calldatas Array of encoded function calls
    /// @param description Description of the emergency action
    /// @return proposalId The ID of the created proposal
    function createEmergencyProposal(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) external returns (uint256 proposalId);

    /// @notice Mark an escalated issue as resolved
    /// @dev Called after DAO proposal execution or rejection
    /// @param issueId The ID of the resolved issue
    /// @param approved Whether the proposal was approved
    function markResolved(bytes32 issueId, bool approved) external;

    /// @notice Get details of an escalated issue
    /// @param issueId The ID of the issue
    /// @return The escalated issue details
    function getEscalatedIssue(
        bytes32 issueId
    ) external view returns (EscalatedIssue memory);

    /// @notice Check if an issue has been escalated
    /// @param issueId The ID of the issue
    /// @return Whether the issue has been escalated
    function isEscalated(bytes32 issueId) external view returns (bool);

    /// @notice Set the DAO governor contract address
    /// @dev Only callable by admin role
    /// @param governor The address of the governor contract
    function setGovernor(address governor) external;

    /// @notice Generate a proposal description from issue details
    /// @param reportType The type of report
    /// @param target The target address
    /// @param evidence The evidence data
    /// @return The generated proposal description
    function generateProposalDescription(
        uint8 reportType,
        address target,
        bytes calldata evidence
    ) external pure returns (string memory);
}