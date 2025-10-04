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

pragma solidity ^0.8.17;

/**
 * @title QCErrors
 * @notice Centralized error definitions for the entire QC (Qualified Custodian) system
 * @dev This interface provides a standardized set of errors used across all QC contracts
 *      including QCManager, QCManagerLib, QCPauseManager, QCRedeemer, and QCMinter.
 *      Centralizing errors improves consistency, reduces bytecode duplication, and simplifies maintenance.
 */
interface QCErrors {
    // =================== QC Manager & Core System Errors ===================

    /// @notice Thrown when QC address is zero address
    error InvalidQCAddress();

    /// @notice Thrown when QCData address is zero address
    error InvalidQCDataAddress();

    /// @notice Thrown when minting capacity is invalid
    error InvalidMintingCapacity();

    /// @notice Thrown when attempting to register an already registered QC
    /// @param qc The address that is already registered
    error QCAlreadyRegistered(address qc);

    /// @notice Thrown when QC is not registered
    /// @param qc The unregistered address
    error QCNotRegistered(address qc);

    /// @notice Thrown when QC is not in active status
    /// @param qc The QC address
    error QCNotActive(address qc);

    /// @notice Thrown when new cap is not higher than current
    /// @param currentCap Current minting capacity
    /// @param newCap Attempted new capacity
    error NewCapMustBeHigher(uint256 currentCap, uint256 newCap);

    // =================== Wallet Registration Errors ===================

    /// @notice Thrown when wallet address validation fails
    error InvalidWalletAddress();

    /// @notice Thrown when wallet is not registered
    /// @param btcAddress The Bitcoin address
    error WalletNotRegistered(string btcAddress);

    /// @notice Thrown when wallet is not active
    /// @param btcAddress The Bitcoin address
    error WalletNotActive(string btcAddress);

    /// @notice Thrown when wallet is not pending deregistration
    /// @param btcAddress The Bitcoin address
    error WalletNotPendingDeregistration(string btcAddress);

    /// @notice Thrown when wallet is already registered
    error WalletAlreadyRegistered();

    /// @notice Thrown when wallet is not inactive (for activation)
    error WalletNotInactive();

    /// @notice Thrown when maximum wallets per QC is exceeded
    error MaxWalletsExceeded();

    // =================== Signature Verification Errors ===================

    /// @notice Thrown when Bitcoin signature verification fails
    error SignatureVerificationFailed();

    /// @notice Thrown when message signature verification fails
    error MessageSignatureVerificationFailed();

    /// @notice Thrown when a nonce has already been used
    /// @param qc The QC address
    /// @param nonce The already-used nonce
    error NonceAlreadyUsed(address qc, uint256 nonce);

    // =================== Status Transition Errors ===================

    /// @notice Thrown when status transition is invalid
    /// @param oldStatus Current status
    /// @param newStatus Attempted new status
    error InvalidStatusTransition(
        uint8 oldStatus,
        uint8 newStatus
    );

    /// @notice Thrown when status is invalid for operation
    error InvalidStatus();

    // =================== Solvency & Balance Errors ===================

    /// @notice Thrown when QC would become insolvent
    /// @param newBalance Proposed balance
    /// @param mintedAmount Total minted amount
    error QCWouldBecomeInsolvent(uint256 newBalance, uint256 mintedAmount);

    /// @notice Thrown when not authorized for solvency operations
    /// @param caller The unauthorized caller
    error NotAuthorizedForSolvency(address caller);

    /// @notice Thrown when QC not registered for solvency check
    /// @param qc The QC address
    error QCNotRegisteredForSolvency(address qc);

    // =================== Service & System Errors ===================

    /// @notice Thrown when a service is not available
    /// @param service The unavailable service name
    error ServiceNotAvailable(string service);

    /// @notice Thrown when relay address is invalid
    error InvalidRelayAddress();

    /// @notice Thrown when QC reserve ledger is not available
    error QCReserveLedgerNotAvailable();

    /// @notice Thrown when not authorized for wallet deregistration
    /// @param caller The unauthorized caller
    error NotAuthorizedForWalletDeregistration(address caller);

    // =================== Capacity & Amount Errors ===================

    /// @notice Thrown when manager address is invalid (zero address)
    error InvalidManagerAddress();

    /// @notice Thrown when capacity value is invalid
    error InvalidCapacity();

    /// @notice Thrown when new capacity is below current total minted amount
    error CapacityBelowTotalMinted();

    /// @notice Thrown when amount exceeds minting capacity
    error ExceedsMintingCapacity();

    // =================== Bitcoin Address Validation Errors ===================

    /// @notice Thrown when Bitcoin address format is invalid
    /// @param btcAddress The invalid Bitcoin address
    error InvalidBitcoinAddressFormat(string btcAddress);

    /// @notice Thrown when Bitcoin address length is invalid
    /// @param btcAddress The Bitcoin address with invalid length
    /// @param length The actual length
    error InvalidBitcoinAddressLength(string btcAddress, uint256 length);

    /// @notice Thrown when address length is invalid (for public keys and other length validations)
    error InvalidAddressLength();

    /// @notice Thrown when address prefix is invalid
    error InvalidAddressPrefix();

    // =================== Configuration Errors ===================

    /// @notice Thrown when AccountControl is not configured
    error AccountControlNotSet();

    /// @notice Thrown when QCRedeemer is not set
    error QCRedeemerNotSet();

    // =================== Escalation & Management Errors ===================

    /// @notice Thrown when QC is not eligible for escalation
    error QCNotEligibleForEscalation();

    /// @notice Thrown when escalation period has not been reached
    error EscalationPeriodNotReached();

    /// @notice Thrown when caller is not the state manager
    error OnlyStateManager();


    /// @notice Thrown when reserve oracle price feed retry is attempted too soon after a failed query
    /// @param nextRetryTime When retry will be allowed
    error OracleRetryTooSoon(uint256 nextRetryTime);

    // =================== Pause Manager Errors ===================

    /// @notice Thrown when no pause credit is available
    error NoPauseCredit();

    /// @notice Thrown when already paused
    error AlreadyPaused();

    /// @notice Thrown when not currently paused
    error NotPaused();

    /// @notice Thrown when pause not expired
    error PauseNotExpired();

    /// @notice Thrown when credit already available
    error CreditAlreadyAvailable();

    /// @notice Thrown when never used credit
    error NeverUsedCredit();

    /// @notice Thrown when renewal period not met
    error RenewalPeriodNotMet();

    /// @notice Thrown when QC already initialized
    error QCAlreadyInitialized();

    /// @notice Thrown when reason is required but not provided
    error ReasonRequired();

    /// @notice Thrown when pause would breach redemption deadline
    error WouldBreachRedemptionDeadline();

    /// @notice Thrown when not self-paused
    error NotSelfPaused();

    /// @notice Thrown when cannot early resume
    error CannotEarlyResume();

    /// @notice Thrown when has pending redemptions
    error HasPendingRedemptions();
    
    // =================== Wallet Manager Specific Errors ===================
    
    /// @notice Thrown when registrar should use the registerWallet function
    error MustUseRegisterWallet();
    
    /// @notice Thrown when wallet has pending redemptions and cannot be deregistered
    error WalletHasPendingRedemptions();
    
    /// @notice Thrown when wallet deregistration is already in progress
    error WalletDeregistrationInProgress();

    // =================== Minter Errors ===================

    /// @notice Thrown when user address is zero
    error InvalidUserAddress();

    /// @notice Thrown when mint amount is zero or invalid
    error InvalidAmount();

    /// @notice Thrown when system-wide minting is paused
    error MintingIsPaused();

    /// @notice Thrown when amount is below minimum or above maximum allowed
    error AmountOutsideAllowedRange();

    /// @notice Thrown when QC lacks sufficient minting capacity
    error InsufficientMintingCapacity();

    /// @notice Thrown when insufficient balance for operation
    error InsufficientBalance();

    /// @notice Thrown when amount parameter is zero
    error ZeroAmount();

    // =================== Redeemer Errors ===================

    /// @notice Thrown when redemption amount is invalid
    error InvalidRedemptionAmount();

    /// @notice Thrown when Bitcoin address is required but not provided
    error BitcoinAddressRequired();

    /// @notice Thrown when QC wallet is not registered
    error QCWalletNotRegistered();

    /// @notice Thrown when QC wallet doesn't match expected wallet
    error QCWalletMismatch();

    /// @notice Thrown when redemption processing fails
    error RedemptionProcessingFailed();

    /// @notice Thrown when redemption is not in pending status
    error RedemptionNotPending();

    /// @notice Thrown when fulfillment verification fails
    error FulfillmentVerificationFailed();

    /// @notice Thrown when default flagging fails
    error DefaultFlaggingFailed();

    /// @notice Thrown when redemption ID is invalid
    error InvalidRedemptionId();

    /// @notice Thrown when redemption ID has already been used
    /// @param redemptionId The already-used redemption ID
    error RedemptionIdAlreadyUsed(bytes32 redemptionId);

    /// @notice Thrown when Bitcoin address is invalid
    /// @param btcAddress The invalid Bitcoin address
    error InvalidBitcoinAddress(string btcAddress);

    /// @notice Thrown when validation fails
    /// @param user The user address
    /// @param qc The QC address
    /// @param amount The amount that failed validation
    error ValidationFailed(address user, address qc, uint256 amount);

    /// @notice Thrown when redemption was not requested
    /// @param redemptionId The redemption ID that was not requested
    error RedemptionNotRequested(bytes32 redemptionId);

    /// @notice Thrown when redemption is already fulfilled
    /// @param redemptionId The already-fulfilled redemption ID
    error RedemptionAlreadyFulfilled(bytes32 redemptionId);

    /// @notice Thrown when redemption is already defaulted
    /// @param redemptionId The already-defaulted redemption ID
    error RedemptionAlreadyDefaulted(bytes32 redemptionId);

    /// @notice Thrown when redemptions are paused
    error RedemptionsArePaused();

    /// @notice Thrown when an invalid reason is provided for pause or deregistration operations
    error InvalidReason();

    /// @notice Thrown when relay is not set
    error RelayNotSet();

    /// @notice Thrown when Bitcoin SPV redemption proof validation fails
    /// @param reason The reason for proof failure
    error RedemptionProofFailed(string reason);

    /// @notice Thrown when proof difficulty is insufficient
    error InsufficientProofDifficulty();

    /// @notice Thrown when Bitcoin transaction is too old
    error TransactionTooOld();

    /// @notice Thrown when Bitcoin transaction is invalid
    error InvalidBitcoinTransaction();

    /// @notice Thrown when payment is not found in transaction
    error PaymentNotFound();

    /// @notice Thrown when payment amount is insufficient
    /// @param expected Expected payment amount
    /// @param actual Actual payment amount
    error InsufficientPayment(uint64 expected, uint64 actual);

    // =================== System State & Pause Errors ===================

    /// @notice Thrown when minting is already paused
    error MintingAlreadyPaused();

    /// @notice Thrown when minting is not currently paused
    error MintingNotPaused();

    /// @notice Thrown when redemption is already paused
    error RedemptionAlreadyPaused();

    /// @notice Thrown when redemption is not currently paused
    error RedemptionNotPaused();

    /// @notice Thrown when wallet registration is already paused
    error WalletRegistrationAlreadyPaused();

    /// @notice Thrown when wallet registration is not currently paused
    error WalletRegistrationNotPaused();


    /// @notice Thrown when redemption operations are paused
    error RedemptionIsPaused();

    /// @notice Thrown when wallet registration operations are paused
    error WalletRegistrationIsPaused();

    /// @notice Thrown when an invalid pause key is used
    /// @param functionName The invalid function name
    error InvalidPauseKey(string functionName);

    // =================== Emergency Management Errors ===================

    /// @notice Thrown when QC is already emergency paused
    /// @param qc The QC address that is already paused
    error QCIsEmergencyPaused(address qc);

    /// @notice Thrown when QC is not emergency paused
    /// @param qc The QC address that is not paused
    error QCNotEmergencyPaused(address qc);

    /// @notice Thrown when QC emergency pause has expired
    /// @param qc The QC address whose pause has expired
    error QCEmergencyPauseExpired(address qc);

    // =================== Parameter Validation Errors ===================

    /// @notice Thrown when minimum amount exceeds maximum amount
    /// @param minAmount The minimum amount that exceeds maximum
    /// @param maxAmount The maximum amount being exceeded
    error MinAmountExceedsMax(uint256 minAmount, uint256 maxAmount);

    /// @notice Thrown when maximum amount is below minimum amount
    /// @param maxAmount The maximum amount below minimum
    /// @param minAmount The minimum amount being undercut
    error MaxAmountBelowMin(uint256 maxAmount, uint256 minAmount);

    /// @notice Thrown when timeout value is invalid
    error InvalidTimeout();

    /// @notice Thrown when timeout exceeds maximum allowed
    /// @param timeout The timeout value that is too long
    /// @param maxTimeout The maximum allowed timeout
    error TimeoutTooLong(uint256 timeout, uint256 maxTimeout);

    /// @notice Thrown when threshold value is invalid
    error InvalidThreshold();

    /// @notice Thrown when threshold exceeds maximum allowed
    /// @param threshold The threshold value that is too long
    /// @param maxThreshold The maximum allowed threshold
    error ThresholdTooLong(uint256 threshold, uint256 maxThreshold);

    /// @notice Thrown when duration value is invalid
    error InvalidDuration();

    /// @notice Thrown when duration exceeds maximum allowed
    /// @param duration The duration value that is too long
    /// @param maxDuration The maximum allowed duration
    error DurationTooLong(uint256 duration, uint256 maxDuration);

    /// @notice Thrown when council address is invalid (zero address)
    error InvalidCouncilAddress();

    /// @notice Thrown when a parameter value is outside allowed bounds
    /// @param value The parameter value that is out of bounds
    /// @param min The minimum allowed value
    /// @param max The maximum allowed value
    error DurationOutOfBounds(uint256 value, uint256 min, uint256 max);
}