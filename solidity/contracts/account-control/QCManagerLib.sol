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

import "./QCData.sol";
import "./QCErrors.sol";
import "./ReserveOracle.sol";
import "./AccountControl.sol";
import "./SystemState.sol";
import "./interfaces/IQCRedeemer.sol";
import "./interfaces/IAccountControl.sol";
import {BitcoinAddressUtils} from "./BitcoinAddressUtils.sol";
import {CheckBitcoinSigs} from "@keep-network/bitcoin-spv-sol/contracts/CheckBitcoinSigs.sol";

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

    // ========== STRUCTS ==========
    
    /// @notice Struct for QC registration data instead of direct external calls
    struct QCRegistrationData {
        address qc;
        uint256 maxMintingCap;
        bool shouldAuthorizeInAccountControl;
        IAccountControl.ReserveType reserveType;
    }
    
    /// @notice Struct for batch sync result data instead of storage parameters
    struct BatchSyncResult {
        address qc;
        uint256 newTimestamp;
        uint256 balance;
        bool isStale;
        bool success;
    }
    
    /// @notice Struct for pause information instead of storage parameters
    struct PauseInfoData {
        bool isPaused;
        uint256 pauseEndTime;
        bool canEarlyResume;
    }
    
    /// @notice Struct for oracle health check result
    struct OracleHealthResult {
        address qc;
        bool healthy;
        bool stale;
        bool failed;
        bool shouldUpdateStatus;
        uint256 balance;
        bool shouldUpdateCache;
        bool shouldMarkFailure;
        bool shouldClearFailure;
    }
    
    /// @notice Struct for batch health check results
    struct BatchHealthCheckResult {
        uint256 healthyCount;
        uint256 staleCount;
        uint256 failedCount;
        uint256 processedCount;
        OracleHealthResult[] results;
    }
    
    /// @notice Result structure for sync operations
    struct SyncResult {
        address qc;
        uint256 balance;
        bool isStale;
        bool success;
        bool shouldUpdateStatus;
        bool shouldUpdateAccountControl;
        uint256 newTimestamp;
    }

    // ========== REGISTRATION LOGIC ==========

    /**
     * @notice Validate QC registration parameters and return action data
     * @dev Returns structured data for caller to handle registration actions
     * @param qcData QCData contract instance
     * @param qc Address of the QC to register
     * @param maxMintingCap Maximum minting capacity for the QC
     * @return registrationData Structured data for registration actions
     */
    function validateQCRegistration(
        QCData qcData,
        address qc,
        uint256 maxMintingCap
    ) internal view returns (QCRegistrationData memory registrationData) {
        // Validate qcData parameter
        if (address(qcData) == address(0)) {
            revert QCErrors.InvalidQCDataAddress();
        }

        // Input validation
        if (qc == address(0)) {
            revert QCErrors.InvalidQCAddress();
        }
        if (maxMintingCap == 0) {
            revert QCErrors.InvalidMintingCapacity();
        }

        if (qcData.isQCRegistered(qc)) {
            revert QCErrors.QCAlreadyRegistered(qc);
        }

        // Return action data for caller to execute
        return QCRegistrationData({
            qc: qc,
            maxMintingCap: maxMintingCap,
            shouldAuthorizeInAccountControl: true,
            reserveType: IAccountControl.ReserveType.QC_PERMISSIONED
        });
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
    ) internal pure returns (bool valid) {
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
    /**
     * @notice Validate minting capacity update parameters
     * @dev Returns validation results without making external calls
     * @param qcData QCData contract instance
     * @param qc QC address
     * @param newCap New minting capacity
     * @return currentCap Current minting capacity
     * @return isValid Whether the update is valid
     */
    function validateMintingCapacityUpdate(
        QCData qcData,
        address qc,
        uint256 newCap
    ) internal view returns (uint256 currentCap, bool isValid) {
        if (!qcData.isQCRegistered(qc)) {
            revert QCErrors.QCNotRegistered(qc);
        }

        currentCap = qcData.getMaxMintingCapacity(qc);

        // Only allow increases
        if (newCap <= currentCap) {
            revert QCErrors.NewCapMustBeHigher(currentCap, newCap);
        }

        return (currentCap, true);
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
    ) internal returns (uint256 balance, bool isStale) {
        if (qc == address(0)) {
            revert QCErrors.InvalidQCAddress();
        }
        if (accountControl == address(0)) {
            revert QCErrors.AccountControlNotSet();
        }

        // Get the latest attested balance from oracle
        (balance, isStale) = reserveOracle.getReserveBalanceAndStaleness(qc);

        // Update AccountControl with the oracle-attested balance
        IAccountControl(accountControl).setBacking(qc, balance);

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
     * @notice Enhanced status transition validation with detailed reasoning\n     * @dev Complex state machine validation with business rule enforcement:\n     *      1. Self-transitions always allowed (idempotency)\n     *      2. Revoked is terminal state (no outbound transitions)\n     *      3. Cannot revoke QCs with unfulfilled redemptions (prevents fund loss)\n     *      4. Active state is most permissive (can transition anywhere)\n     *      5. Paused states have restricted transitions for operational safety\n     *      6. UnderReview can only go to Active or Revoked (governance decision)\n     *      7. Returns detailed error messages for governance transparency
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
    ) internal pure returns (bool valid, string memory reason) {
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
    ) internal view returns (uint256 balance, bool isStale) {
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
    ) internal view returns (
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
    ) internal view returns (uint256 availableCapacity) {
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
     * @dev Performs all validation checks for wallet registration.
     *      Reverts directly with custom errors on validation failure.
     * @param qcData QCData contract instance
     * @param qc The QC address
     * @param btcAddress The Bitcoin address to register
     * @param challenge The challenge that was signed
     * @param walletPublicKey The Bitcoin public key
     * @param v Recovery ID from signature
     * @param r First 32 bytes of signature
     * @param s Last 32 bytes of signature
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
    ) external view {
        // Check address length
        if (bytes(btcAddress).length == 0) {
            revert QCErrors.InvalidWalletAddress();
        }

        // Check QC registration
        if (!qcData.isQCRegistered(qc)) {
            revert QCErrors.QCNotRegistered(qc);
        }

        // Check QC status
        if (qcData.getQCStatus(qc) != QCData.QCStatus.Active) {
            revert QCErrors.QCNotActive(qc);
        }

        // Validate Bitcoin address format
        if (!isValidBitcoinAddress(btcAddress)) {
            revert QCErrors.InvalidWalletAddress();
        }

        // Verify Bitcoin signature
        if (!verifyBitcoinSignature(walletPublicKey, challenge, v, r, s)) {
            revert QCErrors.SignatureVerificationFailed();
        }

        // CRITICAL SECURITY FIX: Verify that the public key corresponds to the claimed Bitcoin address
        // This prevents signature bypass attacks where an attacker signs with any key
        // and claims ownership of any Bitcoin address
        string memory derivedAddress = BitcoinAddressUtils.deriveBitcoinAddressFromPublicKey(walletPublicKey);
        if (keccak256(bytes(derivedAddress)) != keccak256(bytes(btcAddress))) {
            revert QCErrors.SignatureVerificationFailed();
        }
    }

    /**
     * @notice Validate direct wallet registration by QC
     * @dev Validates direct registration with challenge generation.
     *      Reverts directly with custom errors on validation failure.
     * @param qcData QCData contract instance
     * @param qc The QC address (msg.sender)
     * @param btcAddress The Bitcoin address to register
     * @param nonce The nonce for challenge generation
     * @param walletPublicKey The Bitcoin public key
     * @param v Recovery ID from signature
     * @param r First 32 bytes of signature
     * @param s Last 32 bytes of signature
     * @return challenge The generated challenge
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
        uint256 /* chainId */
    ) external view returns (bytes32 challenge) {
        // Check QC registration and status
        if (!qcData.isQCRegistered(qc)) {
            revert QCErrors.QCNotRegistered(qc);
        }
        if (qcData.getQCStatus(qc) != QCData.QCStatus.Active) {
            revert QCErrors.QCNotActive(qc);
        }

        // Check address length
        if (bytes(btcAddress).length == 0) {
            revert QCErrors.InvalidWalletAddress();
        }

        // Generate deterministic challenge
        challenge = keccak256(abi.encodePacked("TBTC_DIRECT:", qc, btcAddress, nonce));

        // Validate Bitcoin address format
        if (!isValidBitcoinAddress(btcAddress)) {
            revert QCErrors.InvalidWalletAddress();
        }

        // Verify Bitcoin signature
        if (!verifyBitcoinSignature(walletPublicKey, challenge, v, r, s)) {
            revert QCErrors.SignatureVerificationFailed();
        }

        // Verify that the public key corresponds to the claimed Bitcoin address
        // This prevents signature bypass attacks where an attacker signs with any key
        // and claims ownership of any Bitcoin address
        string memory derivedAddress = BitcoinAddressUtils.deriveBitcoinAddressFromPublicKey(walletPublicKey);
        if (keccak256(bytes(derivedAddress)) != keccak256(bytes(btcAddress))) {
            revert QCErrors.SignatureVerificationFailed();
        }

        return challenge;
    }

    function syncAccountControlWithStatus(
        address accountControl,
        address qc,
        QCData.QCStatus oldStatus,
        QCData.QCStatus newStatus
    ) internal {
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
    ) internal returns (QCData.QCStatus newStatus) {
        QCData.QCStatus currentStatus = qcData.getQCStatus(qc);

        if (currentStatus == QCData.QCStatus.MintingPaused ||
            currentStatus == QCData.QCStatus.Paused) {

            newStatus = QCData.QCStatus.UnderReview;
            qcData.setQCStatus(qc, newStatus, autoEscalationReason);

            return newStatus;
        }

        return currentStatus;
    }

    /**
     * @notice Update reserve balance and check solvency
     * @param qc The QC address
     * @param newBalance The new reserve balance
     * @param qcData QCData contract for minted amount
     */
    function updateReserveBalanceAndCheckSolvency(
        address qc,
        uint256 newBalance,
        QCData qcData
    ) internal view {
        uint256 mintedAmount = qcData.getQCMintedAmount(qc);
        if (newBalance < mintedAmount) {
            revert QCErrors.QCWouldBecomeInsolvent(newBalance, mintedAmount);
        }
    }

    /**
     * @notice Get comprehensive pause information for a QC
     */
    /**
     * @notice Calculate pause information from provided data
     * @dev Pure function that processes pause data without storage access
     * @param pauseTimestamp Pause timestamp for the QC
     * @param canEarlyResume Whether QC can early resume
     * @param selfPauseTimeout Timeout for self-pause
     * @return pauseInfo Structured pause information
     */
    function calculatePauseInfo(
        uint256 pauseTimestamp,
        bool canEarlyResume,
        uint256 selfPauseTimeout
    ) internal pure returns (PauseInfoData memory pauseInfo) {
        pauseInfo.isPaused = pauseTimestamp != 0;
        pauseInfo.pauseEndTime = pauseInfo.isPaused ? pauseTimestamp + selfPauseTimeout : 0;
        pauseInfo.canEarlyResume = canEarlyResume;
    }

    /**
     * @notice Process single QC sync with full logic
     * @dev Returns structured data for main contract to handle storage updates
     * @param reserveOracle ReserveOracle contract
     * @param qcData QCData contract
     * @param qc QC address
     * @return result Structured sync result
     */
    function processSingleSync(
        address reserveOracle,
        address qcData,
        address qc
    ) external view returns (SyncResult memory result) {
        result.qc = qc;
        result.newTimestamp = block.timestamp;
        
        // Try oracle first
        try ReserveOracle(reserveOracle).getReserveBalanceAndStaleness(qc) returns (
            uint256 _balance,
            bool _isStale
        ) {
            result.balance = _balance;
            result.isStale = _isStale;
            result.success = true;
            result.shouldUpdateAccountControl = true;
            
            // Check if should update status
            if (_isStale && QCData(qcData).getQCStatus(qc) == QCData.QCStatus.Active) {
                result.shouldUpdateStatus = true;
            }
        } catch {
            // Oracle failed - sync fails
            result.success = false;
        }
        
        return result;
    }
    
    /// @notice Check if QC has unfulfilled redemptions
    function checkUnfulfilledRedemptions(address qcRedeemer, address qc) external view returns (bool) {
        return qcRedeemer != address(0) && IQCRedeemer(qcRedeemer).hasUnfulfilledRedemptions(qc);
    }

    /// @notice Get earliest redemption deadline for a QC
    function getEarliestRedemptionDeadline(address qcRedeemer, address qc) external view returns (uint256) {
        if (qcRedeemer == address(0)) return 0;
        try IQCRedeemer(qcRedeemer).getEarliestRedemptionDeadline(qc) returns (uint256 deadline) {
            return deadline;
        } catch { return 0; }
    }

    /// @notice Check if QC is eligible for escalation
    /**
     * @notice Check if QC is eligible for escalation based on pause time
     * @dev Pure function that calculates escalation eligibility without storage access
     * @param pauseTimestamp When the QC was paused
     * @param selfPauseTimeout Timeout for self-pause
     * @param currentTime Current timestamp
     * @return eligible Whether QC is eligible for escalation
     * @return timeUntilEscalation Time remaining until escalation
     */
    function calculateEscalationEligibility(
        uint256 pauseTimestamp,
        uint256 selfPauseTimeout,
        uint256 currentTime
    ) internal pure returns (bool eligible, uint256 timeUntilEscalation) {
        if (pauseTimestamp == 0) return (false, 0);

        uint256 elapsed = currentTime - pauseTimestamp;
        return elapsed >= selfPauseTimeout ? (true, 0) : (false, selfPauseTimeout - elapsed);
    }


    /**
     * @notice Process oracle health check with full logic
     * @dev Returns structured data for main contract to handle storage updates
     * @param reserveOracle ReserveOracle contract
     * @param qcData QCData contract  
     * @param qc QC address to check
     * @param lastSyncTimestamp Last sync timestamp for QC
     * @param oracleRetryInterval Retry interval for oracle
     * @param oracleFailureDetected Whether oracle failure was previously detected
     * @return result Structured result for processing
     */
    function processOracleHealthCheck(
        address reserveOracle,
        address qcData,
        address qc,
        uint256 lastSyncTimestamp,
        uint256 oracleRetryInterval,
        bool oracleFailureDetected
    ) internal view returns (OracleHealthResult memory result) {
        result.qc = qc;
        
        // Skip if checked recently
        if (oracleRetryInterval > 0 && block.timestamp < lastSyncTimestamp + oracleRetryInterval) {
            return result;
        }
        
        // Try to get oracle data
        try ReserveOracle(reserveOracle).getReserveBalanceAndStaleness(qc) returns (
            uint256 balance, 
            bool isStale
        ) {
            result.balance = balance;
            
            // Oracle working - check staleness
            if (isStale && QCData(qcData).getQCStatus(qc) == QCData.QCStatus.Active) {
                result.stale = true;
                result.shouldUpdateStatus = true;
                result.shouldUpdateCache = true;
            } else {
                result.healthy = true;
                result.shouldUpdateCache = true;
            }
            
            // Clear failure flag if it was set
            if (oracleFailureDetected) {
                result.shouldClearFailure = true;
            }
        } catch {
            // Oracle failed
            result.failed = true;
            if (!oracleFailureDetected) {
                result.shouldMarkFailure = true;
            }
        }
        
        return result;
    }
    
    /**
     * @notice Process batch oracle health check with gas optimization
     * @dev Returns structured results for main contract to handle storage updates
     * @param reserveOracle ReserveOracle contract
     * @param qcData QCData contract
     * @param qcs Array of QC addresses to check
     * @param lastSyncTimestamps Array of last sync timestamps for each QC
     * @param oracleFailureDetected Array of oracle failure detection flags for each QC
     * @param minGasPerOperation Minimum gas required per operation
     * @return result Batch health check results
     */
    function processBatchOracleHealthCheck(
        address reserveOracle,
        address qcData,
        address[] calldata qcs,
        uint256[] calldata lastSyncTimestamps,
        bool[] calldata oracleFailureDetected,
        uint256 minGasPerOperation
    ) external view returns (BatchHealthCheckResult memory result) {
        require(qcs.length > 0 && qcs.length <= 100, "Invalid batch size");
        require(qcs.length == lastSyncTimestamps.length && qcs.length == oracleFailureDetected.length, "Array length mismatch");
        
        // First pass: count how many we can process
        uint256 canProcess = 0;
        uint256 gasPerOp = minGasPerOperation;
        for (uint256 i = 0; i < qcs.length; i++) {
            if (gasleft() < gasPerOp) break;
            canProcess++;
        }
        
        result.results = new OracleHealthResult[](canProcess);
        
        for (uint256 i = 0; i < canProcess; i++) {
            result.processedCount++;
            
            OracleHealthResult memory healthResult = processOracleHealthCheck(
                reserveOracle,
                qcData,
                qcs[i],
                lastSyncTimestamps[i],
                0, // No rate limiting for health checks
                oracleFailureDetected[i]
            );
            
            result.results[i] = healthResult;
            
            // Update counters
            if (healthResult.healthy) {
                result.healthyCount++;
            } else if (healthResult.stale) {
                result.staleCount++;
            } else if (healthResult.failed) {
                result.failedCount++;
            }
        }
        
        return result;
    }

    /**
     * @notice Process batch sync for a single QC
     * @dev Extracted from QCManager to reduce contract size
     * @param reserveOracle ReserveOracle contract
     * @param qcData QCData contract
     * @param qc QC address
     * @param lastSyncTimestamp Last sync timestamp
     * @param minSyncInterval Minimum sync interval
     * @return success Whether sync was successful
     * @return balance Reserve balance if successful
     * @return isStale Whether data is stale
     * @return shouldUpdateStatus Whether status should be updated
     */
    function processSingleQCSync(
        address reserveOracle,
        address qcData, 
        address qc,
        uint256 lastSyncTimestamp,
        uint256 minSyncInterval
    ) internal view returns (
        bool success,
        uint256 balance,
        bool isStale,
        bool shouldUpdateStatus
    ) {
        // Check if valid QC
        if (qc == address(0) || !QCData(qcData).isQCRegistered(qc)) {
            return (false, 0, false, false);
        }
        
        QCData.QCStatus status = QCData(qcData).getQCStatus(qc);
        if (status == QCData.QCStatus.Revoked) {
            return (false, 0, false, false);
        }
        
        // Check rate limit (allow initial sync when timestamp is 0)
        if (lastSyncTimestamp != 0 && block.timestamp < lastSyncTimestamp + minSyncInterval) {
            return (false, 0, false, false);
        }
        
        // Try oracle
        try ReserveOracle(reserveOracle).getReserveBalanceAndStaleness(qc) returns (
            uint256 _balance,
            bool _isStale
        ) {
            // Check if should update status
            bool _shouldUpdateStatus = _isStale && status == QCData.QCStatus.Active;
            return (true, _balance, _isStale, _shouldUpdateStatus);
        } catch {
            return (false, 0, false, false);
        }
    }

    /**
     * @notice Handle solvency verification with enhanced error reporting
     * @dev Extracted from QCManager to reduce contract size
     * @param qc QC address to verify
     * @param qcData QCData contract
     * @param reserveOracle ReserveOracle contract
     * @return solvent Whether QC is solvent
     * @return shouldUpdateStatus Whether status should be updated
     * @return newStatus New status if update needed
     * @return mintedAmount Current minted amount
     * @return reserveBalance Current reserve balance\n     * @return isStale Whether oracle data is stale
     */
    function performSolvencyVerification(
        address qc,
        address qcData,
        address reserveOracle,
        address /* performedBy */
    ) external view returns (
        bool solvent,
        bool shouldUpdateStatus,
        QCData.QCStatus newStatus,
        uint256 mintedAmount,
        uint256 reserveBalance,
        bool isStale
    ) {
        (reserveBalance, isStale) = ReserveOracle(reserveOracle).getReserveBalanceAndStaleness(qc);
        mintedAmount = QCData(qcData).getQCMintedAmount(qc);

        if (isStale) {
            solvent = false;
            shouldUpdateStatus = QCData(qcData).getQCStatus(qc) == QCData.QCStatus.Active;
            newStatus = QCData.QCStatus.UnderReview;
        } else {
            solvent = reserveBalance >= mintedAmount;
            shouldUpdateStatus = !solvent && QCData(qcData).getQCStatus(qc) == QCData.QCStatus.Active;
            newStatus = QCData.QCStatus.UnderReview;
        }

        return (solvent, shouldUpdateStatus, newStatus, mintedAmount, reserveBalance, isStale);
    }

    /**
     * @notice Process auto-escalation for QCs that have timed out
     * @dev Extracted from QCManager to reduce contract size
     * @param qc QC address
     * @param qcData QCData contract
     * @param pauseTimestamp Pause timestamp for QC
     * @param selfPauseTimeout Timeout for self-pause
     * @param escalationWarningPeriod Warning period before escalation
     * @param escalationWarningEmitted Whether warning was already emitted
     * @return shouldEscalate Whether QC should be escalated
     * @return shouldEmitWarning Whether warning should be emitted
     * @return timeRemaining Time remaining until escalation
     */
    function processAutoEscalationCheck(
        address qc,
        address qcData,
        uint256 pauseTimestamp,
        uint256 selfPauseTimeout,
        uint256 escalationWarningPeriod,
        bool escalationWarningEmitted
    ) external view returns (
        bool shouldEscalate,
        bool shouldEmitWarning,
        uint256 timeRemaining
    ) {
        QCData.QCStatus currentStatus = QCData(qcData).getQCStatus(qc);
        if (
            currentStatus != QCData.QCStatus.Paused &&
            currentStatus != QCData.QCStatus.MintingPaused
        ) {
            return (false, false, 0);
        }

        if (pauseTimestamp == 0) return (false, false, 0);

        uint256 timeElapsed = block.timestamp - pauseTimestamp;

        // Check for warning period
        if (
            timeElapsed >= selfPauseTimeout - escalationWarningPeriod &&
            timeElapsed < selfPauseTimeout &&
            !escalationWarningEmitted
        ) {
            timeRemaining = selfPauseTimeout - timeElapsed;
            return (false, true, timeRemaining);
        }

        if (timeElapsed >= selfPauseTimeout) {
            return (true, false, 0);
        }

        return (false, false, selfPauseTimeout - timeElapsed);
    }

    /**
     * @notice Handle redemption default with graduated consequences
     * @dev Extracted from QCManager to reduce contract size
     * @param qcData QCData contract
     * @param qc QC that defaulted
     * @return oldStatus The old status
     * @return newStatus The new status to set
     * @return shouldClearPause Whether to clear pause tracking
     */
    function processRedemptionDefault(
        address qcData,
        address qc,
        bytes32 /* redemptionId */
    ) external view returns (
        QCData.QCStatus oldStatus,
        QCData.QCStatus newStatus,
        bool shouldClearPause
    ) {
        oldStatus = QCData(qcData).getQCStatus(qc);
        newStatus = oldStatus;

        // Progressive escalation logic
        if (
            oldStatus == QCData.QCStatus.Active ||
            oldStatus == QCData.QCStatus.MintingPaused
        ) {
            // First default → UnderReview
            newStatus = QCData.QCStatus.UnderReview;
        } else if (
            oldStatus == QCData.QCStatus.UnderReview ||
            oldStatus == QCData.QCStatus.Paused
        ) {
            // Second default → Revoked
            newStatus = QCData.QCStatus.Revoked;
        }
        // Revoked QCs remain revoked

        shouldClearPause = newStatus != oldStatus;
        return (oldStatus, newStatus, shouldClearPause);
    }

    /**
     * @notice Validate and process mint capacity consumption
     * @dev Extracted from QCManager to reduce contract size
     * @param qcData QCData contract
     * @param qc QC address
     * @param amount Amount to mint
     * @return success Whether minting is allowed
     * @return reason Reason for failure if applicable
     */
    function validateMintCapacityConsumption(
        address qcData,
        address qc,
        uint256 amount
    ) external view returns (bool success, string memory reason) {
        if (qc == address(0)) return (false, "Invalid QC address");
        if (amount == 0) return (false, "Invalid amount");
        if (!QCData(qcData).isQCRegistered(qc)) return (false, "QC not registered");
        if (QCData(qcData).getQCStatus(qc) != QCData.QCStatus.Active) return (false, "QC not active");

        uint256 mintingCap = QCData(qcData).getMaxMintingCapacity(qc);
        uint256 currentMinted = QCData(qcData).getQCMintedAmount(qc);

        if (currentMinted + amount > mintingCap) return (false, "Exceeds minting cap");

        return (true, "");
    }


    // =================== BATCH OPERATIONS ===================
    
    /**
     * @notice Process batch sync backing data from oracle with gas optimization
     * @dev Returns sync results for caller to handle storage updates and external calls
     * @param reserveOracle ReserveOracle contract
     * @param qcs Array of QC addresses to sync
     * @param lastSyncTimestamps Array of last sync timestamps (parallel to qcs array)
     * @param minSyncInterval Minimum sync interval
     * @return syncResults Array of sync results for caller to process
     * @return processedCount Total processed count
     * @return skippedDueToGas Count skipped due to gas limits
     */
    function processBatchSyncFromOracle(
        address reserveOracle,
        address[] calldata qcs,
        uint256[] calldata lastSyncTimestamps,
        uint256 minSyncInterval
    ) external view returns (
        BatchSyncResult[] memory syncResults,
        uint256 processedCount,
        uint256 skippedDueToGas
    ) {
        if (qcs.length == 0 || qcs.length > 50) {
            revert QCErrors.InvalidCapacity();
        }
        if (qcs.length != lastSyncTimestamps.length) {
            revert QCErrors.InvalidCapacity();
        }
        
        syncResults = new BatchSyncResult[](qcs.length);
        uint256 resultCount = 0;
        processedCount = 0;
        skippedDueToGas = 0;

        for (uint256 i = 0; i < qcs.length; i++) {
            // Circuit breaker - ensure enough gas for remaining operations
            if (gasleft() < 100000) {
                skippedDueToGas = qcs.length - i;
                break;
            }
            
            processedCount++;
            address currentQC = qcs[i];
            
            // Use existing single QC processing and create result directly
            (bool _success, uint256 _balance, bool _isStale, ) = 
                processSingleQCSync(reserveOracle, address(0), currentQC, lastSyncTimestamps[i], minSyncInterval);
                
            // Create result entry directly without intermediate variables
            syncResults[resultCount++] = BatchSyncResult(
                currentQC,
                _success ? block.timestamp : lastSyncTimestamps[i],
                _balance,
                _isStale,
                _success
            );
        }

        // If we processed fewer items, create a properly sized array
        if (resultCount < syncResults.length) {
            BatchSyncResult[] memory resizedResults = new BatchSyncResult[](resultCount);
            for (uint256 j = 0; j < resultCount; j++) {
                resizedResults[j] = syncResults[j];
            }
            syncResults = resizedResults;
        }
        
        return (syncResults, processedCount, skippedDueToGas);
    }
    
    /**
     * @notice Sync backing data from oracle for a single QC
     * @dev Moved from QCManager to reduce contract size
     * @param qc QC address to sync backing for
     * @param reserveOracle ReserveOracle contract
     * @param accountControl AccountControl contract
     * @param lastSyncTimestamp Last sync timestamp for rate limiting
     * @param minSyncInterval Minimum sync interval
     * @return balance The synced balance
     * @return isStale Whether data is stale
     */
    function syncBackingFromOracleInternal(
        address qc,
        address reserveOracle,
        address accountControl,
        uint256 lastSyncTimestamp,
        uint256 minSyncInterval
    ) external returns (uint256 balance, bool isStale) {
        if (lastSyncTimestamp != 0 && 
            block.timestamp < lastSyncTimestamp + minSyncInterval) {
            revert QCErrors.OracleRetryTooSoon(lastSyncTimestamp + minSyncInterval);
        }
        if (qc == address(0)) {
            revert QCErrors.InvalidQCAddress();
        }

        // Get reserve balance from oracle
        (balance, isStale) = ReserveOracle(reserveOracle).getReserveBalanceAndStaleness(qc);
        
        // Update AccountControl
        if (accountControl != address(0)) {
            IAccountControl(accountControl).setBacking(qc, balance);
        }
        
        return (balance, isStale);
    }

    // =================== VIEW FUNCTIONS FOR QCMANAGER ===================
    
    /**
     * @notice Check if QC has unfulfilled redemptions
     * @dev Moved from QCManager to reduce contract size
     */
    function hasUnfulfilledRedemptionsView(address qcRedeemer, address qc) external view returns (bool) {
        return qcRedeemer != address(0) && IQCRedeemer(qcRedeemer).hasUnfulfilledRedemptions(qc);
    }
    
    /**
     * @notice Get available minting capacity for a QC
     * @dev Moved from QCManager to reduce contract size
     */
    function getAvailableMintingCapacityView(
        address qcData,
        address reserveOracle,
        address qc
    ) external view returns (uint256) {
        return calculateAvailableMintingCapacity(
            QCData(qcData),
            ReserveOracle(reserveOracle),
            qc
        );
    }

    /**
     * @notice Helper function to update AccountControl backing to reduce stack depth
     * @param accountControl AccountControl contract address
     * @param validQCs Array of valid QC addresses
     * @param backingAmounts Array of backing amounts
     * @param validCount Number of valid entries
     */
    function _updateAccountControlBacking(
        address accountControl,
        address[] memory validQCs,
        uint256[] memory backingAmounts,
        uint256 validCount
    ) internal {
        if (validCount == 0 || accountControl == address(0)) return;

        uint256 MIN_GAS_PER_OPERATION = 50000;
        
        try IAccountControl(accountControl).batchSetBacking(
            validQCs,
            backingAmounts
        ) {
            // Success
        } catch {
            // If batch fails, try individual updates as fallback
            for (uint256 j = 0; j < validCount; j++) {
                if (gasleft() < MIN_GAS_PER_OPERATION) break;
                
                try IAccountControl(accountControl).setBacking(
                    validQCs[j],
                    backingAmounts[j]
                ) {} catch {}
            }
        }
    }

}

