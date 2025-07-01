// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title ErrorCodes
/// @dev Centralized error code system for the Account Control system
/// @notice This contract provides systematic error codes and enhanced error logging
///         to address the "Incomplete Error Messages" security issue identified in the review.
///         
/// Error Code Format: CCFF
/// - CC: Contract identifier (01-99)
/// - FF: Function/operation identifier (01-99)
///
/// Contract Identifiers:
/// - 01: ProtocolRegistry
/// - 02: QCData  
/// - 03: SystemState
/// - 04: QCManager
/// - 05: QCMinter
/// - 06: QCRedeemer
/// - 07: QCReserveLedger
/// - 08: SPVValidator
/// - 09: SingleWatchdog
/// - 10: BasicMintingPolicy
/// - 11: BasicRedemptionPolicy
contract ErrorCodes {
    // ===== PROTOCOL REGISTRY (01XX) =====
    uint16 public constant ERR_REGISTRY_INVALID_SERVICE_ADDR = 101;
    uint16 public constant ERR_REGISTRY_SERVICE_NOT_REGISTERED = 102;
    
    // ===== QC DATA (02XX) =====
    uint16 public constant ERR_QCDATA_INVALID_MANAGER = 201;
    uint16 public constant ERR_QCDATA_INVALID_QC_ADDR = 202;
    uint16 public constant ERR_QCDATA_QC_ALREADY_REGISTERED = 203;
    uint16 public constant ERR_QCDATA_INVALID_CAPACITY = 204;
    uint16 public constant ERR_QCDATA_QC_NOT_REGISTERED = 205;
    uint16 public constant ERR_QCDATA_INVALID_WALLET_ADDR = 206;
    uint16 public constant ERR_QCDATA_WALLET_ALREADY_REGISTERED = 207;
    uint16 public constant ERR_QCDATA_WALLET_NOT_REGISTERED = 208;
    uint16 public constant ERR_QCDATA_WALLET_NOT_ACTIVE = 209;
    
    // ===== SYSTEM STATE (03XX) =====
    uint16 public constant ERR_SYSSTATE_MINTING_ALREADY_PAUSED = 301;
    uint16 public constant ERR_SYSSTATE_MINTING_NOT_PAUSED = 302;
    uint16 public constant ERR_SYSSTATE_REDEMPTION_ALREADY_PAUSED = 303;
    uint16 public constant ERR_SYSSTATE_REDEMPTION_NOT_PAUSED = 304;
    uint16 public constant ERR_SYSSTATE_INVALID_THRESHOLD = 305;
    uint16 public constant ERR_SYSSTATE_INVALID_TIMEOUT = 306;
    uint16 public constant ERR_SYSSTATE_INVALID_COUNCIL_ADDR = 307;
    uint16 public constant ERR_SYSSTATE_FUNCTION_PAUSED = 308;
    
    // ===== QC MANAGER (04XX) =====
    uint16 public constant ERR_QCMGR_INVALID_QC_ADDR = 401;
    uint16 public constant ERR_QCMGR_INVALID_CAPACITY = 402;
    uint16 public constant ERR_QCMGR_QC_ALREADY_REGISTERED = 403;
    uint16 public constant ERR_QCMGR_ACTION_ALREADY_QUEUED = 404;
    uint16 public constant ERR_QCMGR_ACTION_NOT_QUEUED = 405;
    uint16 public constant ERR_QCMGR_DELAY_NOT_ELAPSED = 406;
    uint16 public constant ERR_QCMGR_ACTION_ALREADY_EXECUTED = 407;
    uint16 public constant ERR_QCMGR_QC_NOT_REGISTERED = 408;
    uint16 public constant ERR_QCMGR_INVALID_WALLET_ADDR = 409;
    uint16 public constant ERR_QCMGR_QC_NOT_ACTIVE = 410;
    uint16 public constant ERR_QCMGR_SPV_VERIFICATION_FAILED = 411;
    uint16 public constant ERR_QCMGR_WALLET_NOT_REGISTERED = 412;
    uint16 public constant ERR_QCMGR_NOT_AUTHORIZED = 413;
    uint16 public constant ERR_QCMGR_WALLET_NOT_ACTIVE = 414;
    uint16 public constant ERR_QCMGR_SOLVENCY_NOT_AUTHORIZED = 415;
    uint16 public constant ERR_QCMGR_QC_WOULD_BE_INSOLVENT = 416;
    
    // ===== QC MINTER (05XX) =====
    uint16 public constant ERR_MINTER_INVALID_QC_ADDR = 501;
    uint16 public constant ERR_MINTER_INVALID_AMOUNT = 502;
    uint16 public constant ERR_MINTER_MINTING_PAUSED = 503;
    uint16 public constant ERR_MINTER_POLICY_NOT_AVAILABLE = 504;
    uint16 public constant ERR_MINTER_POLICY_VALIDATION_FAILED = 505;
    uint16 public constant ERR_MINTER_TOKEN_MINT_FAILED = 506;
    
    // ===== QC REDEEMER (06XX) =====
    uint16 public constant ERR_REDEEMER_INVALID_QC_ADDR = 601;
    uint16 public constant ERR_REDEEMER_INVALID_AMOUNT = 602;
    uint16 public constant ERR_REDEEMER_REDEMPTION_FAILED = 603;
    uint16 public constant ERR_REDEEMER_NOT_PENDING = 604;
    uint16 public constant ERR_REDEEMER_FULFILLMENT_FAILED = 605;
    uint16 public constant ERR_REDEEMER_DEFAULT_FAILED = 606;
    
    // ===== QC RESERVE LEDGER (07XX) =====
    uint16 public constant ERR_LEDGER_INVALID_QC_ADDR = 701;
    uint16 public constant ERR_LEDGER_NO_ATTESTATION_EXISTS = 702;
    uint16 public constant ERR_LEDGER_REASON_REQUIRED = 703;
    
    // ===== SPV VALIDATOR (08XX) =====
    uint16 public constant ERR_SPV_INVALID_RELAY_ADDR = 801;
    uint16 public constant ERR_SPV_INVALID_DIFFICULTY_FACTOR = 802;
    uint16 public constant ERR_SPV_INVALID_INPUT_VECTOR = 803;
    uint16 public constant ERR_SPV_INVALID_OUTPUT_VECTOR = 804;
    uint16 public constant ERR_SPV_MERKLE_PROOF_MISMATCH = 805;
    uint16 public constant ERR_SPV_INVALID_TX_MERKLE_PROOF = 806;
    uint16 public constant ERR_SPV_INVALID_COINBASE_PROOF = 807;
    uint16 public constant ERR_SPV_DIFFICULTY_MISMATCH = 808;
    uint16 public constant ERR_SPV_INVALID_HEADER_LENGTH = 809;
    uint16 public constant ERR_SPV_INVALID_HEADER_CHAIN = 810;
    uint16 public constant ERR_SPV_INSUFFICIENT_WORK = 811;
    uint16 public constant ERR_SPV_INSUFFICIENT_DIFFICULTY = 812;
    
    // ===== SINGLE WATCHDOG (09XX) =====
    uint16 public constant ERR_WATCHDOG_INVALID_QC_ADDR = 901;
    uint16 public constant ERR_WATCHDOG_REASON_REQUIRED = 902;
    uint16 public constant ERR_WATCHDOG_INVALID_STATUS = 903;
    uint16 public constant ERR_WATCHDOG_INVALID_WALLET_ADDR = 904;
    uint16 public constant ERR_WATCHDOG_SPV_PROOF_REQUIRED = 905;
    uint16 public constant ERR_WATCHDOG_CHALLENGE_REQUIRED = 906;
    uint16 public constant ERR_WATCHDOG_INVALID_REDEMPTION_ID = 907;
    uint16 public constant ERR_WATCHDOG_BTC_ADDR_REQUIRED = 908;
    
    // ===== BASIC MINTING POLICY (10XX) =====
    uint16 public constant ERR_MINT_POLICY_INVALID_USER = 1001;
    uint16 public constant ERR_MINT_POLICY_INVALID_QC = 1002;
    uint16 public constant ERR_MINT_POLICY_INVALID_AMOUNT = 1003;
    uint16 public constant ERR_MINT_POLICY_SYSTEM_PAUSED = 1004;
    uint16 public constant ERR_MINT_POLICY_AMOUNT_TOO_SMALL = 1005;
    uint16 public constant ERR_MINT_POLICY_AMOUNT_TOO_LARGE = 1006;
    uint16 public constant ERR_MINT_POLICY_QC_NOT_REGISTERED = 1007;
    uint16 public constant ERR_MINT_POLICY_QC_NOT_ACTIVE = 1008;
    uint16 public constant ERR_MINT_POLICY_INSUFFICIENT_CAPACITY = 1009;
    
    // ===== BASIC REDEMPTION POLICY (11XX) =====
    uint16 public constant ERR_REDEEM_POLICY_INVALID_USER = 1101;
    uint16 public constant ERR_REDEEM_POLICY_INVALID_QC = 1102;
    uint16 public constant ERR_REDEEM_POLICY_INVALID_AMOUNT = 1103;
    uint16 public constant ERR_REDEEM_POLICY_SYSTEM_PAUSED = 1104;
    uint16 public constant ERR_REDEEM_POLICY_AMOUNT_TOO_SMALL = 1105;
    uint16 public constant ERR_REDEEM_POLICY_QC_NOT_REGISTERED = 1106;
    uint16 public constant ERR_REDEEM_POLICY_QC_INVALID_STATUS = 1107;
    uint16 public constant ERR_REDEEM_POLICY_INSUFFICIENT_BALANCE = 1108;
    uint16 public constant ERR_REDEEM_POLICY_INVALID_ID = 1109;
    uint16 public constant ERR_REDEEM_POLICY_ID_COLLISION = 1110;
    uint16 public constant ERR_REDEEM_POLICY_INVALID_BTC_ADDR = 1111;
    uint16 public constant ERR_REDEEM_POLICY_VALIDATION_FAILED = 1112;
    uint16 public constant ERR_REDEEM_POLICY_NOT_REQUESTED = 1113;
    uint16 public constant ERR_REDEEM_POLICY_ALREADY_FULFILLED = 1114;
    uint16 public constant ERR_REDEEM_POLICY_ALREADY_DEFAULTED = 1115;
    uint16 public constant ERR_REDEEM_POLICY_SPV_FAILED = 1116;
    uint16 public constant ERR_REDEEM_POLICY_INVALID_REASON = 1117;
    uint16 public constant ERR_REDEEM_POLICY_NO_REDEMPTIONS = 1118;
    uint16 public constant ERR_REDEEM_POLICY_REASON_REQUIRED = 1119;
    
    /// @dev Enhanced error event for logging failed transaction attempts
    /// This addresses the security review recommendation to "log failed transaction attempts"
    event ErrorLogged(
        uint16 indexed errorCode,
        string indexed functionName,
        address indexed caller,
        bytes32 contextHash,
        string message,
        uint256 timestamp
    );
    
    /// @dev Emitted when an error code is deprecated or updated
    event ErrorCodeUpdated(
        uint16 indexed oldCode,
        uint16 indexed newCode,
        string reason,
        uint256 timestamp
    );
    
    /// @notice Get error message for a given error code
    /// @param errorCode The error code to look up
    /// @return message Human-readable error message
    function getErrorMessage(uint16 errorCode) external pure returns (string memory message) {
        // Protocol Registry errors
        if (errorCode == ERR_REGISTRY_INVALID_SERVICE_ADDR) return "ProtocolRegistry: Invalid service address";
        if (errorCode == ERR_REGISTRY_SERVICE_NOT_REGISTERED) return "ProtocolRegistry: Service not registered";
        
        // QC Data errors
        if (errorCode == ERR_QCDATA_INVALID_MANAGER) return "QCData: Invalid manager address";
        if (errorCode == ERR_QCDATA_INVALID_QC_ADDR) return "QCData: Invalid QC address";
        if (errorCode == ERR_QCDATA_QC_ALREADY_REGISTERED) return "QCData: QC already registered";
        if (errorCode == ERR_QCDATA_INVALID_CAPACITY) return "QCData: Invalid minting capacity";
        if (errorCode == ERR_QCDATA_QC_NOT_REGISTERED) return "QCData: QC not registered";
        if (errorCode == ERR_QCDATA_INVALID_WALLET_ADDR) return "QCData: Invalid wallet address";
        if (errorCode == ERR_QCDATA_WALLET_ALREADY_REGISTERED) return "QCData: Wallet already registered";
        if (errorCode == ERR_QCDATA_WALLET_NOT_REGISTERED) return "QCData: Wallet not registered";
        if (errorCode == ERR_QCDATA_WALLET_NOT_ACTIVE) return "QCData: Wallet not active";
        
        // System State errors
        if (errorCode == ERR_SYSSTATE_MINTING_ALREADY_PAUSED) return "SystemState: Minting already paused";
        if (errorCode == ERR_SYSSTATE_MINTING_NOT_PAUSED) return "SystemState: Minting not paused";
        if (errorCode == ERR_SYSSTATE_REDEMPTION_ALREADY_PAUSED) return "SystemState: Redemption already paused";
        if (errorCode == ERR_SYSSTATE_REDEMPTION_NOT_PAUSED) return "SystemState: Redemption not paused";
        if (errorCode == ERR_SYSSTATE_INVALID_THRESHOLD) return "SystemState: Invalid threshold value";
        if (errorCode == ERR_SYSSTATE_INVALID_TIMEOUT) return "SystemState: Invalid timeout value";
        if (errorCode == ERR_SYSSTATE_INVALID_COUNCIL_ADDR) return "SystemState: Invalid council address";
        if (errorCode == ERR_SYSSTATE_FUNCTION_PAUSED) return "SystemState: Function is paused";
        
        // QC Manager errors
        if (errorCode == ERR_QCMGR_INVALID_QC_ADDR) return "QCManager: Invalid QC address";
        if (errorCode == ERR_QCMGR_INVALID_CAPACITY) return "QCManager: Invalid minting capacity";
        if (errorCode == ERR_QCMGR_QC_ALREADY_REGISTERED) return "QCManager: QC already registered";
        if (errorCode == ERR_QCMGR_ACTION_ALREADY_QUEUED) return "QCManager: Action already queued";
        if (errorCode == ERR_QCMGR_ACTION_NOT_QUEUED) return "QCManager: Action not queued";
        if (errorCode == ERR_QCMGR_DELAY_NOT_ELAPSED) return "QCManager: Delay period not elapsed";
        if (errorCode == ERR_QCMGR_ACTION_ALREADY_EXECUTED) return "QCManager: Action already executed";
        if (errorCode == ERR_QCMGR_QC_NOT_REGISTERED) return "QCManager: QC not registered";
        if (errorCode == ERR_QCMGR_INVALID_WALLET_ADDR) return "QCManager: Invalid wallet address";
        if (errorCode == ERR_QCMGR_QC_NOT_ACTIVE) return "QCManager: QC not active";
        if (errorCode == ERR_QCMGR_SPV_VERIFICATION_FAILED) return "QCManager: SPV verification failed";
        if (errorCode == ERR_QCMGR_WALLET_NOT_REGISTERED) return "QCManager: Wallet not registered";
        if (errorCode == ERR_QCMGR_NOT_AUTHORIZED) return "QCManager: Not authorized";
        if (errorCode == ERR_QCMGR_WALLET_NOT_ACTIVE) return "QCManager: Wallet not active";
        if (errorCode == ERR_QCMGR_SOLVENCY_NOT_AUTHORIZED) return "QCManager: Not authorized for solvency check";
        if (errorCode == ERR_QCMGR_QC_WOULD_BE_INSOLVENT) return "QCManager: QC would become insolvent";
        
        // QC Minter errors
        if (errorCode == ERR_MINTER_INVALID_QC_ADDR) return "QCMinter: Invalid QC address";
        if (errorCode == ERR_MINTER_INVALID_AMOUNT) return "QCMinter: Invalid amount";
        if (errorCode == ERR_MINTER_MINTING_PAUSED) return "QCMinter: Minting is paused";
        if (errorCode == ERR_MINTER_POLICY_NOT_AVAILABLE) return "QCMinter: Minting policy not available";
        if (errorCode == ERR_MINTER_POLICY_VALIDATION_FAILED) return "QCMinter: Policy validation failed";
        if (errorCode == ERR_MINTER_TOKEN_MINT_FAILED) return "QCMinter: Token mint failed";
        
        // QC Redeemer errors
        if (errorCode == ERR_REDEEMER_INVALID_QC_ADDR) return "QCRedeemer: Invalid QC address";
        if (errorCode == ERR_REDEEMER_INVALID_AMOUNT) return "QCRedeemer: Invalid amount";
        if (errorCode == ERR_REDEEMER_REDEMPTION_FAILED) return "QCRedeemer: Redemption request failed";
        if (errorCode == ERR_REDEEMER_NOT_PENDING) return "QCRedeemer: Redemption not pending";
        if (errorCode == ERR_REDEEMER_FULFILLMENT_FAILED) return "QCRedeemer: Fulfillment verification failed";
        if (errorCode == ERR_REDEEMER_DEFAULT_FAILED) return "QCRedeemer: Default flagging failed";
        
        // Default fallback
        return "Unknown error code";
    }
    
    /// @notice Get contract name from error code
    /// @param errorCode The error code to analyze
    /// @return contractName The name of the contract that generated this error
    function getContractFromErrorCode(uint16 errorCode) external pure returns (string memory contractName) {
        uint16 contractId = errorCode / 100;
        
        if (contractId == 1) return "ProtocolRegistry";
        if (contractId == 2) return "QCData";
        if (contractId == 3) return "SystemState";
        if (contractId == 4) return "QCManager";
        if (contractId == 5) return "QCMinter";
        if (contractId == 6) return "QCRedeemer";
        if (contractId == 7) return "QCReserveLedger";
        if (contractId == 8) return "SPVValidator";
        if (contractId == 9) return "SingleWatchdog";
        if (contractId == 10) return "BasicMintingPolicy";
        if (contractId == 11) return "BasicRedemptionPolicy";
        
        return "Unknown";
    }
    
    /// @notice Check if an error code indicates a security-critical issue
    /// @param errorCode The error code to check
    /// @return critical True if this error indicates a security-critical issue
    function isSecurityCritical(uint16 errorCode) external pure returns (bool critical) {
        // ID collision attacks
        if (errorCode == ERR_REDEEM_POLICY_ID_COLLISION) return true;
        
        // SPV verification failures  
        if (errorCode == ERR_QCMGR_SPV_VERIFICATION_FAILED) return true;
        if (errorCode == ERR_SPV_INVALID_TX_MERKLE_PROOF) return true;
        if (errorCode == ERR_SPV_INVALID_COINBASE_PROOF) return true;
        if (errorCode == ERR_REDEEM_POLICY_SPV_FAILED) return true;
        
        // Solvency issues
        if (errorCode == ERR_QCMGR_QC_WOULD_BE_INSOLVENT) return true;
        
        // Authorization failures
        if (errorCode == ERR_QCMGR_NOT_AUTHORIZED) return true;
        if (errorCode == ERR_QCMGR_SOLVENCY_NOT_AUTHORIZED) return true;
        
        return false;
    }
} 