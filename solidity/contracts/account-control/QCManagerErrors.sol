// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title QCManagerErrors
 * @notice Centralized error definitions for the QC Manager system
 * @dev This contract provides a standardized set of errors used across QCManager and QCManagerLib.
 * Centralizing errors improves consistency, reduces bytecode duplication, and simplifies maintenance.
 */
interface QCManagerErrors {
    // =================== QC Registration Errors ===================

    /// @notice Thrown when QC address is zero address
    error InvalidQCAddress();

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
        uint8 oldStatus,  // Using uint8 to avoid circular dependency
        uint8 newStatus
    );

    /// @notice Thrown when status is invalid for operation
    error InvalidStatus();

    /// @notice Thrown when reason is required but not provided
    error ReasonRequired();

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

    // =================== Pause Credit Errors ===================

    /// @notice Thrown when no pause credit is available
    error NoPauseCredit();

    /// @notice Thrown when already paused
    error AlreadyPaused();

    /// @notice Thrown when not self-paused
    error NotSelfPaused();

    /// @notice Thrown when cannot early resume
    error CannotEarlyResume();

    /// @notice Thrown when pause level is invalid
    error InvalidPauseLevel();

    /// @notice Thrown when has pending redemptions
    error HasPendingRedemptions();

    /// @notice Thrown when credit already available
    error CreditAlreadyAvailable();

    /// @notice Thrown when never used credit
    error NeverUsedCredit();

    /// @notice Thrown when renewal period not met
    error RenewalPeriodNotMet();

    /// @notice Thrown when pause expired
    error PauseExpired();

    /// @notice Thrown when not currently paused
    error NotPaused();

    /// @notice Thrown when pause not expired
    error PauseNotExpired();

    /// @notice Thrown when QC already initialized
    error QCAlreadyInitialized();

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

    // =================== Configuration Errors ===================

    /// @notice Thrown when AccountControl is not configured
    error AccountControlNotSet();

    /// @notice Thrown when QCRedeemer is not set
    error QCRedeemerNotSet();
}