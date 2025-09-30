// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./ReserveOracle.sol";
import "./QCManager.sol";
import "./QCData.sol";
import "./SystemState.sol";

/// @title WatchdogEnforcer
/// @notice Automated enforcement of objective violations without requiring consensus
/// @dev Anyone can trigger enforcement for objective violations, making the system permissionless.
///
///      AUTHORITY MODEL:
///      This contract has LIMITED authority - it can ONLY set QCs to UnderReview status.
///      This design provides automated detection with human oversight:
///      - Automated: Rapidly detects and responds to objective violations
///      - Human Oversight: ARBITER_ROLE makes final decisions (Active/Revoked)
///      - Safety: Prevents false positives from permanently damaging legitimate QCs
///
///      EXPECTED USAGE PATTERN:
///      - Primary callers: Watchdogs who continuously monitor QC compliance
///      - Secondary callers: Automated monitoring systems, community members, or other participants
///      - The permissionless design ensures system resilience: if watchdogs fail to act,
///        anyone can step in to enforce violations and maintain system integrity
///
///      OPERATIONAL FLOW:
///      1. Watchdogs monitor QCs using checkViolation() or batchCheckViolations()
///      2. Upon detecting violations, watchdogs call enforceObjectiveViolation()
///      3. If watchdogs are offline/inactive, any participant can enforce violations
///      4. All enforcement attempts are logged via events for transparency
contract WatchdogEnforcer is AccessControl, ReentrancyGuard {
    // Role definitions
    bytes32 public constant ENFORCEMENT_ROLE = keccak256("ENFORCEMENT_ROLE");
    
    // Reason codes for objective violations
    bytes32 public constant INSUFFICIENT_RESERVES =
        keccak256("INSUFFICIENT_RESERVES");
    bytes32 public constant STALE_ATTESTATIONS =
        keccak256("STALE_ATTESTATIONS");
    bytes32 public constant SUSTAINED_RESERVE_VIOLATION =
        keccak256("SUSTAINED_RESERVE_VIOLATION");

    // Escalation parameters
    uint256 public constant ESCALATION_DELAY = 45 minutes;

    // Escalation state tracking
    mapping(address => uint256) public criticalViolationTimestamps;

    // External contracts
    ReserveOracle public immutable reserveOracle;
    QCManager public immutable qcManager;
    QCData public immutable qcData;
    SystemState public immutable systemState;

    // Events
    event ObjectiveViolationEnforced(
        address indexed qc,
        bytes32 indexed reasonCode,
        address indexed enforcer,
        uint256 timestamp
    );

    event EnforcementAttempted(
        address indexed qc,
        bytes32 indexed reasonCode,
        address indexed enforcer,
        bool success,
        string reason
    );

    event CriticalViolationDetected(
        address indexed qc,
        bytes32 indexed reasonCode,
        address indexed enforcer,
        uint256 timestamp,
        uint256 escalationDeadline
    );

    event ViolationEscalated(
        address indexed qc,
        bytes32 indexed reasonCode,
        address indexed escalator,
        uint256 timestamp
    );

    event EscalationTimerCleared(
        address indexed qc,
        address indexed clearedBy,
        uint256 timestamp
    );

    // Custom errors
    error ZeroAddress();
    error InvalidReasonCode();
    error ViolationNotFound();
    error NotObjectiveViolation();
    error EscalationDelayNotReached();

    constructor(
        address _reserveOracle,
        address _qcManager,
        address _qcData,
        address _systemState
    ) {
        if (_reserveOracle == address(0)) revert ZeroAddress();
        if (_qcManager == address(0)) revert ZeroAddress();
        if (_qcData == address(0)) revert ZeroAddress();
        if (_systemState == address(0)) revert ZeroAddress();
        
        reserveOracle = ReserveOracle(_reserveOracle);
        qcManager = QCManager(_qcManager);
        qcData = QCData(_qcData);
        systemState = SystemState(_systemState);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ENFORCEMENT_ROLE, msg.sender);
    }

    /// @notice Enforce an objective violation (PERMISSIONLESS)
    /// @dev While anyone can call this function, it is primarily intended for watchdogs who
    ///      continuously monitor the system and detect violations. The permissionless nature
    ///      ensures system resilience - if watchdogs fail to act, anyone can step in.
    ///      SECURITY: nonReentrant protects against malicious QCs calling back during enforcement
    /// @param qc The Qualified Custodian address
    /// @param reasonCode The machine-readable reason code
    function enforceObjectiveViolation(address qc, bytes32 reasonCode)
        external
        nonReentrant
    {
        // Verify this is an objective violation
        if (
            reasonCode != INSUFFICIENT_RESERVES &&
            reasonCode != STALE_ATTESTATIONS
        ) {
            revert NotObjectiveViolation();
        }

        bool violated = false;
        string memory failureReason;

        // Check specific violation type
        if (reasonCode == INSUFFICIENT_RESERVES) {
            (violated, failureReason) = _checkReserveViolation(qc);
        } else if (reasonCode == STALE_ATTESTATIONS) {
            (violated, failureReason) = _checkStaleAttestations(qc);
        } else {
            revert InvalidReasonCode();
        }

        emit EnforcementAttempted(
            qc,
            reasonCode,
            msg.sender,
            violated,
            failureReason
        );

        if (!violated) {
            revert ViolationNotFound();
        }

        // Execute enforcement action
        _executeEnforcement(qc, reasonCode);

        emit ObjectiveViolationEnforced(
            qc,
            reasonCode,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Check if QC has insufficient reserves
    function _checkReserveViolation(address qc)
        internal
        view
        returns (bool violated, string memory reason)
    {
        (uint256 reserves, bool isStale) = reserveOracle
            .getReserveBalanceAndStaleness(qc);

        if (isStale) {
            return (false, "Reserves are stale, cannot determine violation");
        }

        uint256 minted = qcData.getQCMintedAmount(qc);
        uint256 collateralRatio = systemState.minCollateralRatio();

        // Use safe mulDiv to avoid overflow
        // Check if: reserves < (minted * collateralRatio) / 100
        uint256 required = Math.mulDiv(minted, collateralRatio, 100);
        if (reserves < required) {
            return (true, "");
        }

        return (false, "Reserves are sufficient");
    }

    /// @notice Check if attestations are stale
    function _checkStaleAttestations(address qc)
        internal
        view
        returns (bool violated, string memory reason)
    {
        (, bool isStale) = reserveOracle.getReserveBalanceAndStaleness(qc);

        if (isStale) {
            return (true, "");
        }

        return (false, "Attestations are fresh");
    }

    /// @notice Execute enforcement action based on violation type
    function _executeEnforcement(address qc, bytes32 reasonCode) internal {
        // All objective violations trigger UnderReview status through QCManager
        qcManager.requestStatusChange(
            qc,
            QCData.QCStatus.UnderReview,
            reasonCode
        );

        // Start escalation timer for INSUFFICIENT_RESERVES violations
        if (reasonCode == INSUFFICIENT_RESERVES) {
            if (criticalViolationTimestamps[qc] == 0) {
                criticalViolationTimestamps[qc] = block.timestamp;
                uint256 escalationDeadline = block.timestamp + ESCALATION_DELAY;
                emit CriticalViolationDetected(
                    qc,
                    reasonCode,
                    msg.sender,
                    block.timestamp,
                    escalationDeadline
                );
            }
        }
    }

    /// @notice Check if a violation exists without enforcing (read-only)
    /// @dev This function is useful for watchdogs and monitoring systems to detect
    ///      violations before deciding whether to call enforceObjectiveViolation()
    /// @param qc The Qualified Custodian address
    /// @param reasonCode The reason code to check
    /// @return violated Whether the violation exists
    /// @return reason Human-readable explanation
    function checkViolation(address qc, bytes32 reasonCode)
        external
        view
        returns (bool violated, string memory reason)
    {
        if (
            reasonCode != INSUFFICIENT_RESERVES &&
            reasonCode != STALE_ATTESTATIONS
        ) {
            return (false, "Not an objective violation");
        }

        if (reasonCode == INSUFFICIENT_RESERVES) {
            return _checkReserveViolation(qc);
        } else if (reasonCode == STALE_ATTESTATIONS) {
            return _checkStaleAttestations(qc);
        }

        return (false, "Unknown reason code");
    }

    /// @notice Batch check multiple QCs for violations
    /// @dev Efficient function for watchdogs to scan multiple QCs in a single call
    ///      to identify which ones require enforcement action
    /// @param qcs Array of QC addresses to check
    /// @param reasonCode The reason code to check
    /// @return violatedQCs Array of QCs that have violations
    function batchCheckViolations(address[] calldata qcs, bytes32 reasonCode)
        external
        view
        returns (address[] memory violatedQCs)
    {
        if (
            reasonCode != INSUFFICIENT_RESERVES &&
            reasonCode != STALE_ATTESTATIONS
        ) {
            return new address[](0);
        }

        address[] memory temp = new address[](qcs.length);
        uint256 count = 0;

        for (uint256 i = 0; i < qcs.length; i++) {
            (bool violated, ) = this.checkViolation(qcs[i], reasonCode);
            if (violated) {
                temp[count++] = qcs[i];
            }
        }

        // Return trimmed array
        violatedQCs = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            violatedQCs[i] = temp[i];
        }
    }

    /// @notice Check and escalate sustained violations to emergency pause
    /// @dev Anyone can call this function to escalate violations that have persisted
    ///      beyond the ESCALATION_DELAY. This provides automated safety net for
    ///      sustained violations while respecting the 45-minute grace period.
    /// @param qc The QC address to check for escalation
    function checkEscalation(address qc) external nonReentrant {
        uint256 violationTimestamp = criticalViolationTimestamps[qc];

        // Must have an active escalation timer
        if (violationTimestamp == 0) {
            revert ViolationNotFound();
        }

        // Must have exceeded the escalation delay
        if (block.timestamp < violationTimestamp + ESCALATION_DELAY) {
            revert EscalationDelayNotReached();
        }

        // Re-verify violation before escalating
        (bool stillViolating, string memory reason) = _checkReserveViolation(qc);
        if (!stillViolating) {
            // Only clear timer if data is fresh and violation genuinely resolved
            // Do not clear if oracle data is stale (cannot determine violation state)
            if (keccak256(abi.encodePacked(reason)) != keccak256(abi.encodePacked("Reserves are stale, cannot determine violation"))) {
                delete criticalViolationTimestamps[qc];
                emit EscalationTimerCleared(qc, msg.sender, block.timestamp);
            }
            return;
        }

        // Escalate to emergency pause
        systemState.emergencyPauseQC(qc, SUSTAINED_RESERVE_VIOLATION);
        emit ViolationEscalated(
            qc,
            SUSTAINED_RESERVE_VIOLATION,
            msg.sender,
            block.timestamp
        );

        // Clear the escalation timer after escalation
        delete criticalViolationTimestamps[qc];
    }

    /// @notice Clear escalation timer when QC returns to Active status
    /// @dev This function allows cleanup of escalation timers when QCs resolve
    ///      their violations and return to Active status. Can be called by anyone.
    /// @param qc The QC address to clear the timer for
    function clearEscalationTimer(address qc) external {
        // Only clear if QC is back to Active status
        if (
            qcData.getQCStatus(qc) == QCData.QCStatus.Active &&
            criticalViolationTimestamps[qc] != 0
        ) {
            delete criticalViolationTimestamps[qc];
            emit EscalationTimerCleared(qc, msg.sender, block.timestamp);
        }
    }
}
