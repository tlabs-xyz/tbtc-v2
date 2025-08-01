// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./QCManager.sol";
import "./QCRedeemer.sol";
import "./QCData.sol";

/// @title WatchdogConsensusManager
/// @notice Manages consensus operations requiring multiple watchdog agreement
/// @dev Implements configurable M-of-N voting for critical operations
contract WatchdogConsensusManager is AccessControl, ReentrancyGuard {
    bytes32 public constant WATCHDOG_ROLE = keccak256("WATCHDOG_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    
    // Configurable consensus parameters
    uint256 public requiredVotes = 2;      // M (default: 2)
    uint256 public totalWatchdogs = 5;     // N (default: 5)
    uint256 public votingPeriod = 2 hours; // Time window for voting
    
    // Bounds for safety
    uint256 public constant MIN_REQUIRED_VOTES = 2;
    uint256 public constant MAX_REQUIRED_VOTES = 7;
    uint256 public constant MIN_VOTING_PERIOD = 1 hours;
    uint256 public constant MAX_VOTING_PERIOD = 24 hours;
    
    enum ProposalType {
        STATUS_CHANGE,
        WALLET_DEREGISTRATION,
        REDEMPTION_DEFAULT,
        FORCE_INTERVENTION
    }
    
    struct Proposal {
        ProposalType proposalType;
        bytes data;
        address proposer;
        uint256 voteCount;
        uint256 timestamp;
        bool executed;
        string reason;
    }
    
    // Storage
    mapping(bytes32 => Proposal) public proposals;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;
    uint256 public proposalCount;
    
    // External contracts
    QCManager public qcManager;
    QCRedeemer public qcRedeemer;
    QCData public qcData;
    
    // Events
    event ProposalCreated(
        bytes32 indexed proposalId,
        ProposalType indexed proposalType,
        address indexed proposer,
        string reason
    );
    
    event VoteCast(
        bytes32 indexed proposalId,
        address indexed voter,
        uint256 newVoteCount
    );
    
    event ProposalExecuted(
        bytes32 indexed proposalId,
        ProposalType indexed proposalType,
        address indexed executor
    );
    
    event ProposalExpired(
        bytes32 indexed proposalId
    );
    
    event ConsensusParamsUpdated(
        uint256 oldRequired,
        uint256 newRequired,
        uint256 oldTotal,
        uint256 newTotal
    );
    
    event VotingPeriodUpdated(
        uint256 oldPeriod,
        uint256 newPeriod
    );
    
    // Custom errors
    error InvalidProposal();
    error ProposalNotFound();
    error AlreadyVoted();
    error VotingEnded();
    error AlreadyExecuted();
    error InvalidParameters();
    error ProposalNotApproved();
    
    constructor(
        address _qcManager,
        address _qcRedeemer,
        address _qcData
    ) {
        qcManager = QCManager(_qcManager);
        qcRedeemer = QCRedeemer(_qcRedeemer);
        qcData = QCData(_qcData);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
    }
    
    // =================== PROPOSAL FUNCTIONS ===================
    
    /// @notice Create a proposal for status change
    /// @param qc The QC address
    /// @param newStatus The new status
    /// @param reason Human-readable reason
    function proposeStatusChange(
        address qc,
        QCData.QCStatus newStatus,
        string calldata reason
    ) external onlyRole(WATCHDOG_ROLE) returns (bytes32 proposalId) {
        bytes memory data = abi.encode(qc, newStatus);
        proposalId = _createProposal(ProposalType.STATUS_CHANGE, data, reason);
    }
    
    /// @notice Create a proposal for wallet deregistration
    /// @param qc The QC address
    /// @param btcAddress The Bitcoin address to deregister
    /// @param reason Human-readable reason
    function proposeWalletDeregistration(
        address qc,
        string calldata btcAddress,
        string calldata reason
    ) external onlyRole(WATCHDOG_ROLE) returns (bytes32 proposalId) {
        bytes memory data = abi.encode(qc, btcAddress);
        proposalId = _createProposal(ProposalType.WALLET_DEREGISTRATION, data, reason);
    }
    
    /// @notice Create a proposal for redemption default
    /// @param redemptionId The redemption ID
    /// @param defaultReason The reason for default
    /// @param description Human-readable description
    function proposeRedemptionDefault(
        bytes32 redemptionId,
        bytes32 defaultReason,
        string calldata description
    ) external onlyRole(WATCHDOG_ROLE) returns (bytes32 proposalId) {
        bytes memory data = abi.encode(redemptionId, defaultReason);
        proposalId = _createProposal(ProposalType.REDEMPTION_DEFAULT, data, description);
    }
    
    /// @notice Create a proposal for force intervention
    /// @param target The target contract
    /// @param callData The call data for intervention
    /// @param reason Human-readable reason
    function proposeForceIntervention(
        address target,
        bytes calldata callData,
        string calldata reason
    ) external onlyRole(WATCHDOG_ROLE) returns (bytes32 proposalId) {
        bytes memory data = abi.encode(target, callData);
        proposalId = _createProposal(ProposalType.FORCE_INTERVENTION, data, reason);
    }
    
    /// @notice Vote on an existing proposal
    /// @param proposalId The proposal ID
    function vote(bytes32 proposalId) external onlyRole(WATCHDOG_ROLE) {
        Proposal storage proposal = proposals[proposalId];
        
        if (proposal.timestamp == 0) revert ProposalNotFound();
        if (proposal.executed) revert AlreadyExecuted();
        if (hasVoted[proposalId][msg.sender]) revert AlreadyVoted();
        if (block.timestamp > proposal.timestamp + votingPeriod) revert VotingEnded();
        
        hasVoted[proposalId][msg.sender] = true;
        proposal.voteCount++;
        
        emit VoteCast(proposalId, msg.sender, proposal.voteCount);
        
        // Auto-execute if threshold reached
        if (proposal.voteCount >= requiredVotes) {
            _executeProposal(proposalId);
        }
    }
    
    /// @notice Execute an approved proposal
    /// @param proposalId The proposal ID
    function executeProposal(bytes32 proposalId) external nonReentrant {
        Proposal storage proposal = proposals[proposalId];
        
        if (proposal.timestamp == 0) revert ProposalNotFound();
        if (proposal.executed) revert AlreadyExecuted();
        if (proposal.voteCount < requiredVotes) revert ProposalNotApproved();
        
        _executeProposal(proposalId);
    }
    
    // =================== INTERNAL FUNCTIONS ===================
    
    function _createProposal(
        ProposalType proposalType,
        bytes memory data,
        string calldata reason
    ) internal returns (bytes32 proposalId) {
        proposalCount++;
        proposalId = keccak256(
            abi.encodePacked(proposalType, data, proposalCount, block.timestamp)
        );
        
        proposals[proposalId] = Proposal({
            proposalType: proposalType,
            data: data,
            proposer: msg.sender,
            voteCount: 1, // Proposer auto-votes
            timestamp: block.timestamp,
            executed: false,
            reason: reason
        });
        
        hasVoted[proposalId][msg.sender] = true;
        
        emit ProposalCreated(proposalId, proposalType, msg.sender, reason);
        emit VoteCast(proposalId, msg.sender, 1);
        
        // If only 1 vote needed (testing), execute immediately
        if (requiredVotes == 1) {
            _executeProposal(proposalId);
        }
    }
    
    function _executeProposal(bytes32 proposalId) internal {
        Proposal storage proposal = proposals[proposalId];
        proposal.executed = true;
        
        if (proposal.proposalType == ProposalType.STATUS_CHANGE) {
            (address qc, QCData.QCStatus newStatus) = abi.decode(
                proposal.data,
                (address, QCData.QCStatus)
            );
            qcManager.setQCStatus(qc, newStatus, keccak256(bytes(proposal.reason)));
            
        } else if (proposal.proposalType == ProposalType.WALLET_DEREGISTRATION) {
            (address qc, string memory btcAddress) = abi.decode(
                proposal.data,
                (address, string)
            );
            qcManager.requestWalletDeRegistration(btcAddress);
            
        } else if (proposal.proposalType == ProposalType.REDEMPTION_DEFAULT) {
            (bytes32 redemptionId, bytes32 defaultReason) = abi.decode(
                proposal.data,
                (bytes32, bytes32)
            );
            qcRedeemer.flagDefaultedRedemption(redemptionId, defaultReason);
            
        } else if (proposal.proposalType == ProposalType.FORCE_INTERVENTION) {
            (address target, bytes memory callData) = abi.decode(
                proposal.data,
                (address, bytes)
            );
            (bool success,) = target.call(callData);
            require(success, "Intervention failed");
        }
        
        emit ProposalExecuted(proposalId, proposal.proposalType, msg.sender);
    }
    
    // =================== ADMIN FUNCTIONS ===================
    
    /// @notice Update consensus parameters
    /// @param newRequired New M value (votes required)
    /// @param newTotal New N value (total watchdog count)
    function updateConsensusParams(
        uint256 newRequired,
        uint256 newTotal
    ) external onlyRole(MANAGER_ROLE) {
        if (newRequired < MIN_REQUIRED_VOTES || newRequired > MAX_REQUIRED_VOTES) {
            revert InvalidParameters();
        }
        if (newRequired > newTotal) revert InvalidParameters();
        if (newTotal == 0) revert InvalidParameters();
        
        uint256 oldRequired = requiredVotes;
        uint256 oldTotal = totalWatchdogs;
        
        requiredVotes = newRequired;
        totalWatchdogs = newTotal;
        
        emit ConsensusParamsUpdated(oldRequired, newRequired, oldTotal, newTotal);
    }
    
    /// @notice Update voting period
    /// @param newPeriod New voting period in seconds
    function updateVotingPeriod(uint256 newPeriod) external onlyRole(MANAGER_ROLE) {
        if (newPeriod < MIN_VOTING_PERIOD || newPeriod > MAX_VOTING_PERIOD) {
            revert InvalidParameters();
        }
        
        uint256 oldPeriod = votingPeriod;
        votingPeriod = newPeriod;
        
        emit VotingPeriodUpdated(oldPeriod, newPeriod);
    }
    
    /// @notice Clean up expired proposals
    /// @param proposalIds Array of proposal IDs to clean
    function cleanupExpired(bytes32[] calldata proposalIds) external {
        for (uint i = 0; i < proposalIds.length; i++) {
            Proposal storage proposal = proposals[proposalIds[i]];
            
            if (proposal.timestamp > 0 && 
                !proposal.executed &&
                block.timestamp > proposal.timestamp + votingPeriod) {
                
                delete proposals[proposalIds[i]];
                emit ProposalExpired(proposalIds[i]);
            }
        }
    }
    
    // =================== VIEW FUNCTIONS ===================
    
    /// @notice Get proposal details
    function getProposal(bytes32 proposalId) external view returns (
        ProposalType proposalType,
        bytes memory data,
        address proposer,
        uint256 voteCount,
        uint256 timestamp,
        bool executed,
        string memory reason
    ) {
        Proposal memory proposal = proposals[proposalId];
        return (
            proposal.proposalType,
            proposal.data,
            proposal.proposer,
            proposal.voteCount,
            proposal.timestamp,
            proposal.executed,
            proposal.reason
        );
    }
    
    /// @notice Check if address can vote on proposal
    function canVote(bytes32 proposalId, address voter) external view returns (bool) {
        Proposal memory proposal = proposals[proposalId];
        
        return proposal.timestamp > 0 &&
               !proposal.executed &&
               !hasVoted[proposalId][voter] &&
               block.timestamp <= proposal.timestamp + votingPeriod &&
               hasRole(WATCHDOG_ROLE, voter);
    }
    
    /// @notice Get consensus parameters
    function getConsensusParams() external view returns (
        uint256 required,
        uint256 total,
        uint256 period
    ) {
        return (requiredVotes, totalWatchdogs, votingPeriod);
    }
}