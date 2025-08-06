// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./QCReserveLedger.sol";
import "./QCManager.sol";
import "./QCData.sol";
import "./SystemState.sol";

/// @title WatchdogEnforcer
/// @notice Automated enforcement of objective violations without requiring consensus
/// @dev Anyone can trigger enforcement for objective violations, making the system permissionless.
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
    // Reason codes for objective violations
    bytes32 public constant INSUFFICIENT_RESERVES = keccak256("INSUFFICIENT_RESERVES");
    bytes32 public constant STALE_ATTESTATIONS = keccak256("STALE_ATTESTATIONS");
    
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    
    // External contracts
    QCReserveLedger public immutable reserveLedger;
    QCManager public immutable qcManager;
    QCData public immutable qcData;
    SystemState public immutable systemState;
    
    // Configuration - minCollateralRatio is now read from SystemState
    
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
    
    // Custom errors
    error InvalidReasonCode();
    error ViolationNotFound();
    error NotObjectiveViolation();
    
    constructor(
        address _reserveLedger,
        address _qcManager,
        address _qcData,
        address _systemState
    ) {
        reserveLedger = QCReserveLedger(_reserveLedger);
        qcManager = QCManager(_qcManager);
        qcData = QCData(_qcData);
        systemState = SystemState(_systemState);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
    }
    
    /// @notice Enforce an objective violation (PERMISSIONLESS)
    /// @dev While anyone can call this function, it is primarily intended for watchdogs who
    ///      continuously monitor the system and detect violations. The permissionless nature
    ///      ensures system resilience - if watchdogs fail to act, anyone can step in.
    ///      SECURITY: nonReentrant protects against malicious QCs calling back during enforcement
    /// @param qc The Qualified Custodian address
    /// @param reasonCode The machine-readable reason code
    function enforceObjectiveViolation(address qc, bytes32 reasonCode) external nonReentrant {
        // Verify this is an objective violation
        if (reasonCode != INSUFFICIENT_RESERVES && reasonCode != STALE_ATTESTATIONS) {
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
        
        emit EnforcementAttempted(qc, reasonCode, msg.sender, violated, failureReason);
        
        if (!violated) {
            revert ViolationNotFound();
        }
        
        // Execute enforcement action
        _executeEnforcement(qc, reasonCode);
        
        emit ObjectiveViolationEnforced(qc, reasonCode, msg.sender, block.timestamp);
    }
    
    /// @notice Check if QC has insufficient reserves
    function _checkReserveViolation(address qc) internal view returns (bool violated, string memory reason) {
        (uint256 reserves, bool isStale) = reserveLedger.getReserveBalanceAndStaleness(qc);
        
        if (isStale) {
            return (false, "Reserves are stale, cannot determine violation");
        }
        
        uint256 minted = qcData.getQCMintedAmount(qc);
        uint256 requiredReserves = (minted * systemState.minCollateralRatio()) / 100;
        
        if (reserves < requiredReserves) {
            return (true, "");
        }
        
        return (false, "Reserves are sufficient");
    }
    
    /// @notice Check if attestations are stale
    function _checkStaleAttestations(address qc) internal view returns (bool violated, string memory reason) {
        (, bool isStale) = reserveLedger.getReserveBalanceAndStaleness(qc);
        
        if (isStale) {
            return (true, "");
        }
        
        return (false, "Attestations are fresh");
    }
    
    /// @notice Execute enforcement action based on violation type
    function _executeEnforcement(address qc, bytes32 reasonCode) internal {
        // All objective violations result in UnderReview status
        // This is a conservative approach - can be refined later
        // Use centralized state management to prevent race conditions
        qcManager.requestStatusChange(qc, QCData.QCStatus.UnderReview, reasonCode);
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
        if (reasonCode != INSUFFICIENT_RESERVES && reasonCode != STALE_ATTESTATIONS) {
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
        if (reasonCode != INSUFFICIENT_RESERVES && reasonCode != STALE_ATTESTATIONS) {
            return new address[](0);
        }
        
        address[] memory temp = new address[](qcs.length);
        uint256 count = 0;
        
        for (uint256 i = 0; i < qcs.length; i++) {
            (bool violated,) = this.checkViolation(qcs[i], reasonCode);
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
    
}