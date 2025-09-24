// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./QCData.sol";
import "./ReserveOracle.sol";
import "./AccountControl.sol";
import "./SystemState.sol";
// MessageSigning import removed - not used in this library

/**
 * @title QCManagerLib
 * @author tBTC Account Control Team
 * @notice Library containing validation and utility logic extracted from QCManager to reduce contract size
 * @dev This library was created to address EIP-170 contract size limitations. It contains non-state-modifying
 * validation logic and utility functions that can be safely delegated. The main QCManager contract retains
 * all state variables and access control logic.
 *
 * @custom:security-contact security@threshold.network
 */
library QCManagerLib {

    // ========== EVENTS ==========
    // Note: Events are defined in main QCManager contract as libraries cannot emit events directly

    // ========== ERRORS ==========

    /// @notice Thrown when QC address is zero address
    error InvalidQCAddress();

    /// @notice Thrown when minting capacity is invalid (zero or exceeds limits)
    error InvalidMintingCapacity();

    /// @notice Thrown when wallet address validation fails
    error InvalidWalletAddress();

    /// @notice Thrown when attempting to register an already registered QC
    /// @param qc The address that is already registered
    error QCAlreadyRegistered(address qc);

    /// @notice Thrown when operating on a non-registered QC
    /// @param qc The address that is not registered
    error QCNotRegistered(address qc);

    /// @notice Thrown when QC is not in ACTIVE status
    /// @param qc The address of the inactive QC
    error QCNotActive(address qc);

    /// @notice Thrown when new capacity is not higher than current
    /// @param current Current capacity
    /// @param requested Requested new capacity
    error NewCapMustBeHigher(uint256 current, uint256 requested);

    /// @notice Thrown when status transition is invalid
    /// @param from Current status
    /// @param to Requested new status
    error InvalidStatusTransition(QCData.QCStatus from, QCData.QCStatus to);

    /// @notice Thrown when caller is not authorized for status change
    /// @param caller The unauthorized caller address
    error UnauthorizedStatusChange(address caller);

    // ========== REGISTRATION LOGIC ==========

    /**
     * @notice Register a new QC with validation and setup
     * @param qcData QCData contract instance
     * @param accountControl AccountControl address for authorization
     * @param qc Address of the QC to register
     * @param maxMintingCap Maximum minting capacity for the QC
     */
    function registerQCWithValidation(
        QCData qcData,
        address accountControl,
        address qc,
        uint256 maxMintingCap
    ) external {
        // Input validation
        if (qc == address(0)) {
            revert InvalidQCAddress();
        }
        if (maxMintingCap == 0) {
            revert InvalidMintingCapacity();
        }

        if (qcData.isQCRegistered(qc)) {
            revert QCAlreadyRegistered(qc);
        }

        // Register QC with provided minting capacity
        qcData.registerQC(qc, maxMintingCap);

        // Authorize QC in Account Control with minting cap
        if (accountControl != address(0)) {
            AccountControl(accountControl).authorizeReserve(qc, maxMintingCap);
        }
    }


    /**
     * @notice Validate status transition according to state machine rules
     * @param from Current status
     * @param to Target status
     * @return valid Whether the transition is valid
     */
    function isValidStatusTransition(
        QCData.QCStatus from,
        QCData.QCStatus to
    ) external pure returns (bool valid) {
        // Self-transitions always allowed
        if (from == to) return true;

        // Active can transition to any state
        if (from == QCData.QCStatus.Active) {
            return true;
        }

        // MintingPaused can go to Active, Paused, UnderReview, or Revoked
        if (from == QCData.QCStatus.MintingPaused) {
            return to == QCData.QCStatus.Active ||
                   to == QCData.QCStatus.Paused ||
                   to == QCData.QCStatus.UnderReview ||
                   to == QCData.QCStatus.Revoked;
        }

        // Paused can go to Active, MintingPaused, UnderReview, or Revoked
        if (from == QCData.QCStatus.Paused) {
            return to == QCData.QCStatus.Active ||
                   to == QCData.QCStatus.MintingPaused ||
                   to == QCData.QCStatus.UnderReview ||
                   to == QCData.QCStatus.Revoked;
        }

        // UnderReview can only go to Active or Revoked
        if (from == QCData.QCStatus.UnderReview) {
            return to == QCData.QCStatus.Active ||
                   to == QCData.QCStatus.Revoked;
        }

        // Revoked is terminal - no transitions allowed
        if (from == QCData.QCStatus.Revoked) {
            return false;
        }

        return false;
    }

    /**
     * @notice Update minting capacity with validation
     * @param qcData QCData contract instance
     * @param qc QC address
     * @param newCap New minting capacity
     * @param accountControl AccountControl address for updating
     */
    function updateMintingCapacity(
        QCData qcData,
        address qc,
        uint256 newCap,
        address accountControl
    ) external {
        if (!qcData.isQCRegistered(qc)) {
            revert QCNotRegistered(qc);
        }

        uint256 currentCap = qcData.getMaxMintingCapacity(qc);

        // Only allow increases
        if (newCap <= currentCap) {
            revert NewCapMustBeHigher(currentCap, newCap);
        }

        // Update in QCData
        qcData.updateMaxMintingCapacity(qc, newCap);

        // Update in AccountControl if set
        if (accountControl != address(0)) {
            AccountControl(accountControl).setMintingCap(qc, newCap);
        }
    }

    /**
     * @notice Sync backing from oracle to AccountControl
     * @param reserveOracle ReserveOracle contract instance
     * @param accountControl AccountControl address
     * @param qc The QC address to sync backing for
     * @return balance The synced balance
     * @return isStale Whether the balance is stale
     */
    function syncBackingFromOracle(
        ReserveOracle reserveOracle,
        address accountControl,
        address qc
    ) external returns (uint256 balance, bool isStale) {
        require(qc != address(0), "QC address cannot be zero");
        require(accountControl != address(0), "AccountControl not set");

        // Get the latest attested balance from oracle
        (balance, isStale) = reserveOracle.getReserveBalanceAndStaleness(qc);

        // Update AccountControl with the oracle-attested balance
        // TODO: Implement automatic AccountControl backing sync after oracle verification
        // Requirements: Add access controls, staleness validation, and error handling
        // Timeline: Q1 2025 after oracle attestation system is fully tested
        // For now, this function only reads from the oracle and returns the data

        return (balance, isStale);
    }

    /**
     * @notice Calculate available minting capacity for a QC
     * @param qcData QCData contract instance
     * @param reserveOracle ReserveOracle contract instance
     * @param qc QC address
     * @return availableCapacity Available minting capacity in satoshis
     */
    function calculateAvailableMintingCapacity(
        QCData qcData,
        ReserveOracle reserveOracle,
        address qc
    ) external view returns (uint256 availableCapacity) {
        // Check QC is active
        if (qcData.getQCStatus(qc) != QCData.QCStatus.Active) {
            return 0;
        }

        // Get minting cap and minted amount
        uint256 mintingCap = qcData.getMaxMintingCapacity(qc);
        uint256 mintedAmount = qcData.getQCMintedAmount(qc);

        // Calculate capacity from cap
        uint256 capBasedCapacity = mintingCap > mintedAmount
            ? mintingCap - mintedAmount
            : 0;

        // Get reserve balance if oracle is available
        if (address(reserveOracle) != address(0)) {
            (uint256 balance, bool isStale) = reserveOracle
                .getReserveBalanceAndStaleness(qc);

            // If reserves are stale, return 0 (no capacity available)
            if (isStale) {
                return 0;
            }

            if (balance > mintedAmount) {
                uint256 reserveBasedCapacity = balance - mintedAmount;
                // Return minimum of cap-based and reserve-based
                return capBasedCapacity < reserveBasedCapacity
                    ? capBasedCapacity
                    : reserveBasedCapacity;
            }
        }

        return capBasedCapacity;
    }

}