// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./QCData.sol";
import "./ReserveOracle.sol";
import "./AccountControl.sol";
import "./SystemState.sol";
import {MessageSigning} from "./libraries/MessageSigning.sol";

/**
 * @title QCManagerLib
 * @notice Library containing heavy logic for QCManager to reduce contract size
 * @dev Extracts registration, validation, and wallet management logic
 */
library QCManagerLib {
    using MessageSigning for bytes32;

    // ========== EVENTS ==========
    // These events will be emitted by the main QCManager contract

    // ========== ERRORS ==========
    error InvalidQCAddress();
    error InvalidMintingCapacity();
    error InvalidWalletAddress();
    error QCAlreadyRegistered(address qc);
    error QCNotRegistered(address qc);
    error QCNotActive(address qc);
    error NewCapMustBeHigher(uint256 current, uint256 requested);
    error InvalidStatusTransition(QCData.QCStatus from, QCData.QCStatus to);
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
        // On test networks, use the test helper function
        if (block.chainid == 31337) {
            AccountControl(accountControl).setBackingForTesting(qc, balance);
        } else {
            // For production, we would need a different approach
            // This is a known limitation that needs addressing
            revert("Production oracle sync not yet implemented");
        }

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


            if (!isStale && balance > mintedAmount) {
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