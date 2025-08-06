// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title WatchdogReasonCodes
/// @notice Standardized machine-readable reason codes for watchdog consensus decisions
/// @dev This library defines all valid reason codes that can be used in proposals,
///      enabling automated watchdogs to validate and vote on proposals without
///      human interpretation. Each code represents a specific, objectively 
///      verifiable condition.
library WatchdogReasonCodes {
    // =================== OBJECTIVE VIOLATIONS (90% of cases) ===================
    // These can be verified automatically by checking on-chain data
    
    /// @notice Insufficient reserves to back minted tBTC
    /// @dev Reserves < minted amount * collateral ratio
    bytes32 public constant INSUFFICIENT_RESERVES = keccak256("INSUFFICIENT_RESERVES");
    
    /// @notice Reserve attestations are older than acceptable threshold
    /// @dev Current time > last attestation + stale threshold
    bytes32 public constant STALE_ATTESTATIONS = keccak256("STALE_ATTESTATIONS");
    
    /// @notice Redemption request exceeded timeout period
    /// @dev Current time > redemption request time + timeout
    bytes32 public constant REDEMPTION_TIMEOUT = keccak256("REDEMPTION_TIMEOUT");
    
    /// @notice Wallet has been inactive beyond threshold
    /// @dev No operations for longer than inactivity period
    bytes32 public constant WALLET_INACTIVE = keccak256("WALLET_INACTIVE");
    
    /// @notice QC has been inactive beyond threshold
    /// @dev No minting/redemption operations for extended period
    bytes32 public constant QC_INACTIVE = keccak256("QC_INACTIVE");
    
    /// @notice QC has exceeded failure threshold
    /// @dev Failure count > threshold within time window
    bytes32 public constant REPEATED_FAILURES = keccak256("REPEATED_FAILURES");
    
    /// @notice Reserves have dropped significantly
    /// @dev New reserves < old reserves * threshold (e.g., 90%)
    bytes32 public constant DECLINING_RESERVES = keccak256("DECLINING_RESERVES");
    
    /// @notice QC has zero reserves but outstanding minted amount
    /// @dev Reserves == 0 && minted > 0
    bytes32 public constant ZERO_RESERVES = keccak256("ZERO_RESERVES");
    
    /// @notice Invalid SPV proof provided
    /// @dev SPV validation failed cryptographically
    bytes32 public constant INVALID_SPV_PROOF = keccak256("INVALID_SPV_PROOF");
    
    /// @notice Redemption fulfilled with incorrect amount
    /// @dev BTC paid != requested amount
    bytes32 public constant INCORRECT_REDEMPTION_AMOUNT = keccak256("INCORRECT_REDEMPTION_AMOUNT");
    
    /// @notice Redemption sent to wrong recipient
    /// @dev BTC recipient != user's Bitcoin address
    bytes32 public constant WRONG_REDEMPTION_RECIPIENT = keccak256("WRONG_REDEMPTION_RECIPIENT");
    
    // =================== SUBJECTIVE ISSUES (10% - require consensus) ===================
    // These require multiple watchdog agreement as they involve judgment
    
    /// @notice Suspicious activity detected requiring investigation
    /// @dev Unusual patterns that don't match specific violations
    bytes32 public constant SUSPICIOUS_ACTIVITY = keccak256("SUSPICIOUS_ACTIVITY");
    
    /// @notice Operational concerns raised by watchdogs
    /// @dev Quality of service issues, response time problems
    bytes32 public constant OPERATIONAL_CONCERN = keccak256("OPERATIONAL_CONCERN");
    
    /// @notice Emergency situation requiring immediate action
    /// @dev Critical issues that need rapid response
    bytes32 public constant EMERGENCY_SITUATION = keccak256("EMERGENCY_SITUATION");
    
    /// @notice Potential wallet compromise detected
    /// @dev Unauthorized transaction patterns observed
    bytes32 public constant WALLET_COMPROMISED = keccak256("WALLET_COMPROMISED");
    
    /// @notice Regulatory compliance issue
    /// @dev External compliance requirement or order
    bytes32 public constant REGULATORY_REQUIREMENT = keccak256("REGULATORY_REQUIREMENT");
    
    // =================== HELPER FUNCTIONS ===================
    
    /// @notice Check if a reason code is objective (can be auto-validated)
    /// @param reasonCode The reason code to check
    /// @return True if the code represents an objective violation
    function isObjectiveViolation(bytes32 reasonCode) internal pure returns (bool) {
        return reasonCode == INSUFFICIENT_RESERVES ||
               reasonCode == STALE_ATTESTATIONS ||
               reasonCode == REDEMPTION_TIMEOUT ||
               reasonCode == WALLET_INACTIVE ||
               reasonCode == QC_INACTIVE ||
               reasonCode == REPEATED_FAILURES ||
               reasonCode == DECLINING_RESERVES ||
               reasonCode == ZERO_RESERVES ||
               reasonCode == INVALID_SPV_PROOF ||
               reasonCode == INCORRECT_REDEMPTION_AMOUNT ||
               reasonCode == WRONG_REDEMPTION_RECIPIENT;
    }
    
    /// @notice Get human-readable string for a reason code (for logging/UI only)
    /// @param reasonCode The reason code to describe
    /// @return description Human-readable description
    function getDescription(bytes32 reasonCode) internal pure returns (string memory description) {
        if (reasonCode == INSUFFICIENT_RESERVES) return "Insufficient reserves";
        if (reasonCode == STALE_ATTESTATIONS) return "Stale attestations";
        if (reasonCode == REDEMPTION_TIMEOUT) return "Redemption timeout";
        if (reasonCode == WALLET_INACTIVE) return "Wallet inactive";
        if (reasonCode == QC_INACTIVE) return "QC inactive";
        if (reasonCode == REPEATED_FAILURES) return "Repeated failures";
        if (reasonCode == DECLINING_RESERVES) return "Declining reserves";
        if (reasonCode == ZERO_RESERVES) return "Zero reserves";
        if (reasonCode == INVALID_SPV_PROOF) return "Invalid SPV proof";
        if (reasonCode == INCORRECT_REDEMPTION_AMOUNT) return "Incorrect redemption amount";
        if (reasonCode == WRONG_REDEMPTION_RECIPIENT) return "Wrong redemption recipient";
        if (reasonCode == SUSPICIOUS_ACTIVITY) return "Suspicious activity";
        if (reasonCode == OPERATIONAL_CONCERN) return "Operational concern";
        if (reasonCode == EMERGENCY_SITUATION) return "Emergency situation";
        if (reasonCode == WALLET_COMPROMISED) return "Wallet compromised";
        if (reasonCode == REGULATORY_REQUIREMENT) return "Regulatory requirement";
        return "Unknown reason";
    }
}