// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./QCData.sol";
import "./QCManagerErrors.sol";
import "./ReserveOracle.sol";
import "./AccountControl.sol";
import "./SystemState.sol";
import {BitcoinAddressUtils} from "./BitcoinAddressUtils.sol";
import {CheckBitcoinSigs} from "@keep-network/bitcoin-spv-sol/contracts/CheckBitcoinSigs.sol";
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
    // All error definitions are imported from QCManagerErrors.sol to avoid duplicates

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
        // Validate qcData parameter
        require(address(qcData) != address(0), "QCData cannot be zero");

        // Input validation
        if (qc == address(0)) {
            revert QCManagerErrors.InvalidQCAddress();
        }
        if (maxMintingCap == 0) {
            revert QCManagerErrors.InvalidMintingCapacity();
        }

        if (qcData.isQCRegistered(qc)) {
            revert QCManagerErrors.QCAlreadyRegistered(qc);
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
            revert QCManagerErrors.QCNotRegistered(qc);
        }

        uint256 currentCap = qcData.getMaxMintingCapacity(qc);

        // Only allow increases
        if (newCap <= currentCap) {
            revert QCManagerErrors.NewCapMustBeHigher(currentCap, newCap);
        }

        // Update in QCData
        qcData.updateMaxMintingCapacity(qc, newCap);

        // Update in AccountControl if set
        if (accountControl != address(0)) {
            AccountControl(accountControl).setMintingCap(qc, newCap);
        }
    }

    /**
     * @notice Sync reserve backing from oracle to AccountControl
     * @dev Fetches the latest attested reserve balance from the oracle and updates AccountControl.
     *      This ensures AccountControl has the most recent backing information for solvency checks.
     *      Critical for maintaining consistency between oracle attestations and operational controls.
     *      Should be called when QC status changes or before critical operations.
     * @param reserveOracle ReserveOracle contract providing reserve attestations
     * @param accountControl AccountControl contract to update with backing information
     * @param qc QC address whose backing to sync
     * @return balance The synced reserve balance in satoshis
     * @return isStale True if balance is older than 6 hours, may affect minting capacity
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
        AccountControl(accountControl).setBacking(qc, balance);

        return (balance, isStale);
    }

    // =================== VALIDATION FUNCTIONS ===================

    /**
     * @notice Validate Bitcoin address format using BitcoinAddressUtils
     * @dev Validates Bitcoin addresses for supported formats:
     *      - P2PKH (Pay-to-PubKey-Hash): Starts with '1', 26-35 chars
     *      - P2SH (Pay-to-Script-Hash): Starts with '3', 26-35 chars
     *      - Bech32 (SegWit): Starts with 'bc1', 42-62 chars
     *      This validation is critical for wallet registration security.
     * @param bitcoinAddress The Bitcoin address string to validate
     * @return valid True if address matches a valid Bitcoin format, false otherwise
     */
    function isValidBitcoinAddress(string memory bitcoinAddress)
        public
        pure
        returns (bool valid)
    {
        if (bytes(bitcoinAddress).length == 0) return false;

        // Basic Bitcoin address format validation (matching original QCManager logic)
        bytes memory addr = bytes(bitcoinAddress);
        if (addr.length < 25 || addr.length > 62) {
            return false;
        }

        // Basic validation: P2PKH starts with '1', P2SH with '3', Bech32 with 'bc1'
        if (addr[0] == 0x31) return true; // '1' - P2PKH
        if (addr[0] == 0x33) return true; // '3' - P2SH
        if (addr.length >= 3 && addr[0] == 0x62 && addr[1] == 0x63 && addr[2] == 0x31) {
            return true; // 'bc1' - Bech32
        }

        return false;
    }

    /**
     * @notice Verify Bitcoin signature using CheckBitcoinSigs library
     * @dev Uses the same ECDSA verification logic as Bridge contracts (Fraud.sol).
     *      This function is critical for proving wallet ownership during registration.
     *      The signature must be created with the Bitcoin private key corresponding to the public key.
     * @param walletPublicKey The Bitcoin public key in uncompressed format (64 bytes, no 0x04 prefix)
     * @param messageHash The keccak256 hash of the message that was signed
     * @param v Recovery ID from the ECDSA signature (typically 27 or 28)
     * @param r First 32 bytes of the ECDSA signature
     * @param s Last 32 bytes of the ECDSA signature
     * @return valid True if signature is valid and matches the public key, false otherwise
     */
    function verifyBitcoinSignature(
        bytes memory walletPublicKey,
        bytes32 messageHash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal pure returns (bool valid) {
        // Validate public key length (64 bytes for uncompressed key without prefix)
        if (walletPublicKey.length != 64) {
            return false;
        }

        // Use CheckBitcoinSigs library for signature verification
        return CheckBitcoinSigs.checkSig(
            walletPublicKey,
            messageHash,
            v,
            r,
            s
        );
    }

    /**
     * @notice Enhanced status transition validation with detailed reasoning
     * @param from Current QC status
     * @param to Target QC status
     * @param hasUnfulfilledRedemptions Whether QC has pending redemptions
     * @return valid Whether transition is allowed
     * @return reason Detailed reason if transition is invalid
     */
    function validateStatusTransitionDetailed(
        QCData.QCStatus from,
        QCData.QCStatus to,
        bool hasUnfulfilledRedemptions
    ) external pure returns (bool valid, string memory reason) {
        // Self-transitions always allowed
        if (from == to) return (true, "");

        // Cannot transition from Revoked (terminal state)
        if (from == QCData.QCStatus.Revoked) {
            return (false, "Cannot transition from Revoked status");
        }

        // Check redemption constraints
        if (hasUnfulfilledRedemptions && to == QCData.QCStatus.Revoked) {
            return (false, "Cannot revoke QC with unfulfilled redemptions");
        }

        // Active can transition to any state except itself
        if (from == QCData.QCStatus.Active) {
            return (true, "");
        }

        // MintingPaused transitions
        if (from == QCData.QCStatus.MintingPaused) {
            if (to == QCData.QCStatus.Active ||
                to == QCData.QCStatus.Paused ||
                to == QCData.QCStatus.UnderReview ||
                to == QCData.QCStatus.Revoked) {
                return (true, "");
            }
            return (false, "Invalid transition from MintingPaused");
        }

        // Paused transitions
        if (from == QCData.QCStatus.Paused) {
            if (to == QCData.QCStatus.Active ||
                to == QCData.QCStatus.MintingPaused ||
                to == QCData.QCStatus.UnderReview ||
                to == QCData.QCStatus.Revoked) {
                return (true, "");
            }
            return (false, "Invalid transition from Paused");
        }

        // UnderReview transitions (only to Active or Revoked)
        if (from == QCData.QCStatus.UnderReview) {
            if (to == QCData.QCStatus.Active || to == QCData.QCStatus.Revoked) {
                return (true, "");
            }
            return (false, "UnderReview can only transition to Active or Revoked");
        }

        return (false, "Invalid status transition");
    }

    // =================== BUSINESS LOGIC FUNCTIONS ===================

    /**
     * @notice Check if QC can use self-pause based on credit availability
     * @param hasCredit Whether QC has available pause credit
     * @param lastUsed Timestamp of last pause credit usage
     * @param creditRenewTime When credit becomes available again
     * @return canPause Whether QC can self-pause
     * @return reason Reason if pause is not allowed
     */
    function checkPauseEligibility(
        bool hasCredit,
        uint256 lastUsed,
        uint256 creditRenewTime
    ) internal view returns (bool canPause, string memory reason) {
        if (hasCredit) {
            return (true, "");
        }

        if (lastUsed == 0) {
            return (true, "Initial credit available");
        }

        if (block.timestamp >= creditRenewTime) {
            return (true, "Credit renewed");
        }

        return (false, "Credit exhausted - wait for renewal");
    }

    /**
     * @notice Update pause credit after usage
     * @param hasCredit Current credit status
     * @param level Pause level being used
     * @return newHasCredit Updated credit status
     * @return newLastUsed Updated last used timestamp
     * @return newCreditRenewTime Updated renewal time
     */
    function updatePauseCredit(
        bool hasCredit,
        QCData.PauseLevel level
    ) external view returns (bool newHasCredit, uint256 newLastUsed, uint256 newCreditRenewTime) {
        // Both pause levels use 90-day renewal period
        if (level == QCData.PauseLevel.Complete) {
            newHasCredit = false;
            newLastUsed = block.timestamp;
            newCreditRenewTime = block.timestamp + 90 days; // 90-day renewal period
        } else {
            // MintingOnly pause also uses 90-day renewal
            newHasCredit = hasCredit;
            newLastUsed = block.timestamp;
            newCreditRenewTime = block.timestamp + 90 days; // 90-day renewal period
        }

        return (newHasCredit, newLastUsed, newCreditRenewTime);
    }

    /**
     * @notice Calculate time until pause credit renewal
     * @param hasCredit Whether QC has available pause credit
     * @param lastUsed Timestamp of last pause credit usage
     * @param creditRenewTime When credit becomes available again
     * @return timeUntilRenewal Time in seconds until credit renewal (0 if available)
     */
    function calculateTimeUntilRenewal(
        bool hasCredit,
        uint256 lastUsed,
        uint256 creditRenewTime
    ) public view returns (uint256 timeUntilRenewal) {
        if (hasCredit || lastUsed == 0) {
            return 0;
        }

        if (block.timestamp >= creditRenewTime) {
            return 0;
        }

        return creditRenewTime - block.timestamp;
    }

    /**
     * @notice Get reserve balance and staleness from oracle
     * @dev Retrieves the most recent attested reserve balance for a QC.
     *      Balance is considered stale if older than 6 hours (STALENESS_THRESHOLD).
     *      Stale balances may affect minting capacity and require fresh attestations.
     * @param reserveOracle ReserveOracle contract providing reserve attestations
     * @param qc QC address to query balance for
     * @return balance Current reserve balance in satoshis
     * @return isStale True if balance is older than 6 hours, false if fresh
     */
    function getReserveBalanceAndStaleness(
        ReserveOracle reserveOracle,
        address qc
    ) external view returns (uint256 balance, bool isStale) {
        return reserveOracle.getReserveBalanceAndStaleness(qc);
    }

    /**
     * @notice Verify QC solvency by comparing backing to obligations
     * @dev Performs critical solvency check by comparing attested reserves to minted tBTC.
     *      A QC is considered solvent if reserves >= minted amount.
     *      This function ignores staleness - solvency is based on last known balance.
     *      Used by DISPUTE_ARBITER_ROLE to detect undercollateralization.
     * @param qc QC address to verify solvency for
     * @param qcData QCData contract for minted amount information
     * @param reserveOracle ReserveOracle contract for reserve attestations
     * @return isSolvent True if reserves cover minted amount, false if undercollateralized
     * @return backing Current attested backing amount in satoshis
     * @return obligations Total minted tBTC amount in satoshis
     * @return deficit Undercollateralization amount if insolvent, 0 if solvent
     */
    function verifyQCSolvency(
        address qc,
        QCData qcData,
        ReserveOracle reserveOracle
    ) external view returns (
        bool isSolvent,
        uint256 backing,
        uint256 obligations,
        uint256 deficit
    ) {
        // Get current backing from oracle
        (backing,) = reserveOracle.getReserveBalanceAndStaleness(qc);

        // Get obligations (minted amount)
        obligations = qcData.getQCMintedAmount(qc);

        // Calculate solvency
        if (backing >= obligations) {
            isSolvent = true;
            deficit = 0;
        } else {
            isSolvent = false;
            deficit = obligations - backing;
        }

        return (isSolvent, backing, obligations, deficit);
    }

    // =================== VIEW FUNCTIONS ===================

    /**
     * @notice Get comprehensive pause information for a QC
     * @param qc QC address
     * @param qcData QCData contract instance
     * @param hasCredit Whether QC has pause credit
     * @param lastUsed Last pause credit usage timestamp
     * @param creditRenewTime Credit renewal timestamp
     * @param pauseReason Current pause reason
     * @return canPause Whether QC can self-pause
     * @return timeUntilRenewal Time until credit renewal (0 if available)
     * @return currentStatus Current QC status
     * @return reason Current pause reason
     */
    function getPauseInfoDetailed(
        address qc,
        QCData qcData,
        bool hasCredit,
        uint256 lastUsed,
        uint256 creditRenewTime,
        string memory pauseReason
    ) external view returns (
        bool canPause,
        uint256 timeUntilRenewal,
        QCData.QCStatus currentStatus,
        string memory reason
    ) {
        // Get current status
        currentStatus = qcData.getQCStatus(qc);

        // Check pause eligibility
        (canPause, reason) = checkPauseEligibility(hasCredit, lastUsed, creditRenewTime);

        // Use existing function to calculate time until renewal
        timeUntilRenewal = calculateTimeUntilRenewal(hasCredit, lastUsed, creditRenewTime);

        return (canPause, timeUntilRenewal, currentStatus, pauseReason);
    }

    /**
     * @notice Calculate available minting capacity for a QC
     * @dev Determines how much more tBTC a QC can mint based on:
     *      1. Governance-set minting cap minus already minted amount
     *      2. Attested reserve balance minus already minted amount
     *      Returns the minimum of these two values.
     *      Returns 0 if QC is not active or reserves are stale (>6 hours old).
     * @param qcData QCData contract instance for QC information
     * @param reserveOracle ReserveOracle contract for reserve attestations
     * @param qc QC address to calculate capacity for
     * @return availableCapacity Available minting capacity in satoshis (0 if unavailable)
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
            } else {
                // Reserves are exhausted - return 0 capacity
                return 0;
            }
        }

        return capBasedCapacity;
    }

    /**
     * @notice Comprehensive wallet registration validation
     * @dev Performs all validation checks for wallet registration
     * @param qcData QCData contract instance
     * @param qc The QC address
     * @param btcAddress The Bitcoin address to register
     * @param challenge The challenge that was signed
     * @param walletPublicKey The Bitcoin public key
     * @param v Recovery ID from signature
     * @param r First 32 bytes of signature
     * @param s Last 32 bytes of signature
     * @return success True if all validations pass
     * @return errorCode Error code if validation fails (for event emission)
     */
    function validateWalletRegistrationFull(
        QCData qcData,
        address qc,
        string calldata btcAddress,
        bytes32 challenge,
        bytes calldata walletPublicKey,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external view returns (bool success, string memory errorCode) {
        // Check address length
        if (bytes(btcAddress).length == 0) {
            return (false, "INVALID_ADDR");
        }

        // Check QC registration
        if (!qcData.isQCRegistered(qc)) {
            return (false, "QC_NOT_REG");
        }

        // Check QC status
        if (qcData.getQCStatus(qc) != QCData.QCStatus.Active) {
            return (false, "QC_INACTIVE");
        }

        // Validate Bitcoin address format
        if (!isValidBitcoinAddress(btcAddress)) {
            return (false, "BAD_ADDR");
        }

        // Verify Bitcoin signature
        if (!verifyBitcoinSignature(walletPublicKey, challenge, v, r, s)) {
            return (false, "SIG_FAIL");
        }

        return (true, "");
    }

    /**
     * @notice Validate direct wallet registration by QC
     * @dev Validates direct registration with challenge generation
     * @param qcData QCData contract instance
     * @param qc The QC address (msg.sender)
     * @param btcAddress The Bitcoin address to register
     * @param nonce The nonce for challenge generation
     * @param walletPublicKey The Bitcoin public key
     * @param v Recovery ID from signature
     * @param r First 32 bytes of signature
     * @param s Last 32 bytes of signature
     * @param chainId The current chain ID
     * @return success True if all validations pass
     * @return challenge The generated challenge
     * @return errorCode Error code if validation fails
     */
    function validateDirectWalletRegistration(
        QCData qcData,
        address qc,
        string calldata btcAddress,
        uint256 nonce,
        bytes calldata walletPublicKey,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256 chainId
    ) external view returns (bool success, bytes32 challenge, string memory errorCode) {
        // Check QC registration and status
        if (!qcData.isQCRegistered(qc)) {
            return (false, bytes32(0), "QC_NOT_REG");
        }
        if (qcData.getQCStatus(qc) != QCData.QCStatus.Active) {
            return (false, bytes32(0), "QC_INACTIVE");
        }

        // Check address length
        if (bytes(btcAddress).length == 0) {
            return (false, bytes32(0), "INVALID_ADDR");
        }

        // Generate deterministic challenge
        challenge = keccak256(
            abi.encodePacked(
                "TBTC_QC_WALLET_DIRECT:",
                qc,
                btcAddress,
                nonce,
                block.chainid
            )
        );

        // Validate Bitcoin address format
        if (!isValidBitcoinAddress(btcAddress)) {
            return (false, challenge, "BAD_ADDR_DIRECT");
        }

        // Verify Bitcoin signature
        if (!verifyBitcoinSignature(walletPublicKey, challenge, v, r, s)) {
            return (false, challenge, "SIG_FAIL_DIRECT");
        }

        return (true, challenge, "");
    }

    function syncAccountControlWithStatus(
        address accountControl,
        address qc,
        QCData.QCStatus oldStatus,
        QCData.QCStatus newStatus
    ) external {
        if (oldStatus == newStatus) return;

        IAccountControl ac = IAccountControl(accountControl);

        if (newStatus == QCData.QCStatus.Active) {
            ac.unpauseReserve(qc);
        } else if (
            newStatus == QCData.QCStatus.MintingPaused ||
            newStatus == QCData.QCStatus.Paused ||
            newStatus == QCData.QCStatus.UnderReview
        ) {
            ac.pauseReserve(qc);
        } else if (newStatus == QCData.QCStatus.Revoked) {
            ac.deauthorizeReserve(qc);
        }
    }

    function performAutoEscalationLogic(
        QCData qcData,
        address qc,
        bytes32 autoEscalationReason
    ) external returns (QCData.QCStatus newStatus) {
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);

        if (currentStatus == QCData.QCStatus.MintingPaused ||
            currentStatus == QCData.QCStatus.Paused) {

            newStatus = QCData.QCStatus.UnderReview;
            qcData.setQCStatus(qc, newStatus, autoEscalationReason);

            return newStatus;
        }

        return currentStatus;
    }
}

interface IAccountControl {
    function pauseReserve(address reserve) external;
    function unpauseReserve(address reserve) external;
    function deauthorizeReserve(address reserve) external;
}