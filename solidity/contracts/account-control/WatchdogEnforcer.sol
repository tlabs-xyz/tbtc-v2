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
    /// @dev Role that allows enforcement of objective violations (optional - enforcement is permissionless)
    bytes32 public constant ENFORCEMENT_ROLE = keccak256("ENFORCEMENT_ROLE");
    
    /// @dev Reason code for QCs with reserves below required collateral ratio
    bytes32 public constant INSUFFICIENT_RESERVES =
        keccak256("INSUFFICIENT_RESERVES");
    /// @dev Reason code for QCs with outdated reserve attestations from oracle
    bytes32 public constant STALE_ATTESTATIONS =
        keccak256("STALE_ATTESTATIONS");
    /// @dev Reason code for reserve violations that have persisted beyond grace period
    bytes32 public constant SUSTAINED_RESERVE_VIOLATION =
        keccak256("SUSTAINED_RESERVE_VIOLATION");
    /// @dev Reason code for QCs operating with stale oracle data for extended periods
    bytes32 public constant PROLONGED_STALENESS =
        keccak256("PROLONGED_STALENESS");
    /// @dev Reason code for QCs stuck in UnderReview status for extended periods
    bytes32 public constant EXTENDED_UNDER_REVIEW =
        keccak256("EXTENDED_UNDER_REVIEW");

    /// @dev Grace period before reserve violations escalate to emergency pause
    /// @notice 45 minutes allows QCs time to resolve temporary liquidity issues
    ///         while preventing extended exposure to undercollateralized positions
    uint256 public constant ESCALATION_DELAY = 45 minutes;
    
    /// @dev Threshold for prolonged staleness violations (48 hours)
    /// @notice Allows for temporary oracle outages while preventing extended stale operations
    uint256 public constant PROLONGED_STALENESS_THRESHOLD = 48 hours;
    
    /// @dev Threshold for extended under review status (7 days)
    /// @notice Prevents QCs from remaining in review status indefinitely
    uint256 public constant EXTENDED_REVIEW_THRESHOLD = 7 days;
    
    /// @dev Converts uint8 failure reason codes to human-readable strings for events
    /// @param reasonCode The internal reason code from violation checks
    /// @return Human-readable explanation of the check result
    function _reasonCodeToString(uint8 reasonCode) internal pure returns (string memory) {
        if (reasonCode == REASON_OK) return "";
        if (reasonCode == REASON_RESERVES_STALE) return "Reserves are stale, cannot determine violation";
        if (reasonCode == REASON_RESERVES_SUFFICIENT) return "Reserves are sufficient";
        if (reasonCode == REASON_ATTESTATIONS_FRESH) return "Attestations are fresh";
        if (reasonCode == REASON_WITHIN_STALENESS_LIMIT) return "Oracle data within acceptable staleness limit";
        if (reasonCode == REASON_NOT_UNDER_REVIEW) return "QC is not in UnderReview status";
        if (reasonCode == REASON_WITHIN_REVIEW_PERIOD) return "QC has been UnderReview within acceptable time limit";
        return "Unknown reason";
    }

    /// @dev Tracks when reserve violations were first detected for escalation timing
    /// @notice Maps QC address to timestamp when INSUFFICIENT_RESERVES violation began
    mapping(address => uint256) public criticalViolationTimestamps;

    /// @dev Oracle contract for checking QC reserve balances and staleness
    ReserveOracle public immutable reserveOracle;
    /// @dev Manager contract for requesting QC status changes
    QCManager public immutable qcManager;
    /// @dev Data contract for accessing QC information and minted amounts
    QCData public immutable qcData;
    /// @dev System contract for accessing parameters and emergency pause functionality
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
    
    /// @dev Internal reason codes for violation check results
    /// @notice Used to provide detailed explanations when violations are not found
    uint8 public constant REASON_OK = 0; // Violation confirmed
    uint8 public constant REASON_RESERVES_STALE = 1; // Cannot check due to stale oracle data
    uint8 public constant REASON_RESERVES_SUFFICIENT = 2; // Reserves meet requirements
    uint8 public constant REASON_ATTESTATIONS_FRESH = 3; // Attestations are current
    uint8 public constant REASON_WITHIN_STALENESS_LIMIT = 4; // Oracle data within acceptable staleness limit
    uint8 public constant REASON_NOT_UNDER_REVIEW = 5; // QC is not in UnderReview status
    uint8 public constant REASON_WITHIN_REVIEW_PERIOD = 6; // QC has been UnderReview within acceptable time limit

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
    /// @param qc The Qualified Custodian address
    /// @param reasonCode The machine-readable reason code
    function enforceObjectiveViolation(address qc, bytes32 reasonCode)
        external
        nonReentrant
    {
        // Validate inputs
        if (qc == address(0)) revert ZeroAddress();
        
        // Verify this is an objective violation
        if (
            reasonCode != INSUFFICIENT_RESERVES &&
            reasonCode != STALE_ATTESTATIONS &&
            reasonCode != PROLONGED_STALENESS &&
            reasonCode != EXTENDED_UNDER_REVIEW
        ) {
            revert NotObjectiveViolation();
        }

        bool violated = false;
        uint8 failureReasonCode;

        // Check specific violation type
        if (reasonCode == INSUFFICIENT_RESERVES) {
            (violated, failureReasonCode) = _checkReserveViolation(qc);
        } else if (reasonCode == STALE_ATTESTATIONS) {
            (violated, failureReasonCode) = _checkStaleAttestations(qc);
        } else if (reasonCode == PROLONGED_STALENESS) {
            (violated, failureReasonCode) = _checkProlongedStaleness(qc);
        } else if (reasonCode == EXTENDED_UNDER_REVIEW) {
            (violated, failureReasonCode) = _checkExtendedUnderReview(qc);
        } else {
            revert InvalidReasonCode();
        }

        emit EnforcementAttempted(
            qc,
            reasonCode,
            msg.sender,
            violated,
            _reasonCodeToString(failureReasonCode)
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

    /// @dev Checks if a QC's reserves are below the required collateral ratio
    /// @param qc The QC address to check
    /// @return violated True if reserves are insufficient and data is fresh
    /// @return reasonCode Detailed reason code explaining the check result
    function _checkReserveViolation(address qc)
        internal
        view
        returns (bool violated, uint8 reasonCode)
    {
        (uint256 reserves, bool isStale) = reserveOracle
            .getReserveBalanceAndStaleness(qc);

        if (isStale) {
            return (false, REASON_RESERVES_STALE);
        }

        uint256 minted = qcData.getQCMintedAmount(qc);
        uint256 collateralRatio = systemState.minCollateralRatio();

        // Check if: reserves < (minted * collateralRatio) / 100
        uint256 required = Math.mulDiv(minted, collateralRatio, 100);
        if (reserves < required) {
            return (true, REASON_OK);
        }

        return (false, REASON_RESERVES_SUFFICIENT);
    }

    /// @dev Checks if a QC's reserve attestations from the oracle are stale
    /// @param qc The QC address to check
    /// @return violated True if attestations are stale
    /// @return reasonCode Detailed reason code explaining the check result
    function _checkStaleAttestations(address qc)
        internal
        view
        returns (bool violated, uint8 reasonCode)
    {
        (, bool isStale) = reserveOracle.getReserveBalanceAndStaleness(qc);

        if (isStale) {
            return (true, REASON_OK);
        }

        return (false, REASON_ATTESTATIONS_FRESH);
    }

    /// @dev Checks if a QC has operated with stale oracle data for extended periods
    /// @param qc The QC address to check
    /// @return violated True if QC has prolonged staleness beyond threshold
    /// @return reasonCode Detailed reason code explaining the check result
    function _checkProlongedStaleness(address qc)
        internal
        view
        returns (bool violated, uint8 reasonCode)
    {
        (uint256 lastSyncTimestamp, ) = qcData.getQCOracleData(qc);
        
        // If no sync timestamp recorded, consider it as prolonged staleness
        if (lastSyncTimestamp == 0) {
            return (true, REASON_OK);
        }
        
        uint256 staleDuration = block.timestamp - lastSyncTimestamp;
        
        if (staleDuration > PROLONGED_STALENESS_THRESHOLD) {
            return (true, REASON_OK);
        }
        
        return (false, REASON_WITHIN_STALENESS_LIMIT);
    }

    /// @dev Checks if a QC has been in UnderReview status for extended periods
    /// @param qc The QC address to check
    /// @return violated True if QC has been UnderReview beyond threshold
    /// @return reasonCode Detailed reason code explaining the check result
    function _checkExtendedUnderReview(address qc)
        internal
        view
        returns (bool violated, uint8 reasonCode)
    {
        QCData.QCStatus status = qcData.getQCStatus(qc);
        
        if (status != QCData.QCStatus.UnderReview) {
            return (false, REASON_NOT_UNDER_REVIEW);
        }
        
        // Get the timestamp when status was last changed
        uint256 statusChangeTime = qcData.getQCStatusChangeTimestamp(qc);
        
        // If no status change timestamp recorded, consider it as just changed
        if (statusChangeTime == 0) {
            return (false, REASON_WITHIN_REVIEW_PERIOD);
        }
        
        // Check if QC has been in UnderReview status beyond the threshold
        uint256 timeInReview = block.timestamp - statusChangeTime;
        if (timeInReview > EXTENDED_REVIEW_THRESHOLD) {
            return (true, REASON_OK);
        }
        
        return (false, REASON_WITHIN_REVIEW_PERIOD);
    }

    /// @dev Executes the appropriate enforcement action for a confirmed violation
    /// @param qc The QC address being enforced against
    /// @param reasonCode The specific violation type that was confirmed
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
            reasonCode != STALE_ATTESTATIONS &&
            reasonCode != PROLONGED_STALENESS &&
            reasonCode != EXTENDED_UNDER_REVIEW
        ) {
            return (false, "Not an objective violation");
        }

        uint8 failureReasonCode;
        if (reasonCode == INSUFFICIENT_RESERVES) {
            (violated, failureReasonCode) = _checkReserveViolation(qc);
        } else if (reasonCode == STALE_ATTESTATIONS) {
            (violated, failureReasonCode) = _checkStaleAttestations(qc);
        } else if (reasonCode == PROLONGED_STALENESS) {
            (violated, failureReasonCode) = _checkProlongedStaleness(qc);
        } else if (reasonCode == EXTENDED_UNDER_REVIEW) {
            (violated, failureReasonCode) = _checkExtendedUnderReview(qc);
        }

        return (violated, _reasonCodeToString(failureReasonCode));
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
            reasonCode != STALE_ATTESTATIONS &&
            reasonCode != PROLONGED_STALENESS &&
            reasonCode != EXTENDED_UNDER_REVIEW
        ) {
            return new address[](0);
        }

        address[] memory temp = new address[](qcs.length);
        uint256 count = 0;

        for (uint256 i = 0; i < qcs.length; i++) {
            bool violated;
            uint8 failureReasonCode;
            if (reasonCode == INSUFFICIENT_RESERVES) {
                (violated, failureReasonCode) = _checkReserveViolation(qcs[i]);
            } else if (reasonCode == STALE_ATTESTATIONS) {
                (violated, failureReasonCode) = _checkStaleAttestations(qcs[i]);
            } else if (reasonCode == PROLONGED_STALENESS) {
                (violated, failureReasonCode) = _checkProlongedStaleness(qcs[i]);
            } else if (reasonCode == EXTENDED_UNDER_REVIEW) {
                (violated, failureReasonCode) = _checkExtendedUnderReview(qcs[i]);
            }
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
        (bool stillViolating, uint8 reasonCode) = _checkReserveViolation(qc);
        if (!stillViolating) {
            // Clear timer only when violation is genuinely resolved with fresh data
            // Preserve timer if oracle data is stale since violation state is indeterminate
            if (reasonCode != REASON_RESERVES_STALE) {
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
