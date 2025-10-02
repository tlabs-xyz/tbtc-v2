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

/**
 * @title IQCWalletManager
 * @notice Interface for QC wallet management operations
 * @dev Handles wallet registration, deregistration, and ownership verification
 *
 * @custom:security-notes
 * - Uses Bitcoin signature verification for wallet ownership proof
 * - Implements atomic locking to prevent concurrent deregistration operations
 * - Integrates with WOTS to prevent wallet abandonment during active obligations
 */
interface IQCWalletManager {
    /**
     * @notice Register a wallet for a QC using Bitcoin signature verification
     * @dev Requires REGISTRAR_ROLE, validates Bitcoin signature against challenge
     * @param qc Address of the Qualified Custodian
     * @param btcAddress Bitcoin address to register (must be valid format)
     * @param challenge Pre-generated challenge used for signature verification
     * @param walletPublicKey Bitcoin public key corresponding to the address
     * @param v Recovery parameter for ECDSA signature
     * @param r First 32 bytes of ECDSA signature
     * @param s Second 32 bytes of ECDSA signature
     */
    function registerWallet(
        address qc,
        string calldata btcAddress,
        bytes32 challenge,
        bytes calldata walletPublicKey,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /**
     * @notice Direct wallet registration by QCs themselves
     * @dev QCs can register their own wallets using nonce-based challenges
     * @param btcAddress Bitcoin address to register (must be valid format)
     * @param nonce Unique nonce to prevent replay attacks (must be unused)
     * @param walletPublicKey Bitcoin public key corresponding to the address
     * @param v Recovery parameter for ECDSA signature
     * @param r First 32 bytes of ECDSA signature
     * @param s Second 32 bytes of ECDSA signature
     */
    function registerWalletDirect(
        string calldata btcAddress,
        uint256 nonce,
        bytes calldata walletPublicKey,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /**
     * @notice Request wallet ownership verification
     * @dev Generates a challenge for wallet ownership proof
     * @param bitcoinAddress Bitcoin address to verify ownership of
     * @param nonce Unique nonce for challenge generation
     * @return challenge Generated challenge hash for signature verification
     */
    function requestWalletOwnershipVerification(
        string calldata bitcoinAddress,
        uint256 nonce
    ) external returns (bytes32 challenge);

    /**
     * @notice Request wallet deregistration with atomic lock protection
     * @dev First phase of two-phase deregistration, sets atomic lock
     * @param btcAddress Bitcoin address to deregister (must have no pending obligations)
     */
    function requestWalletDeRegistration(string calldata btcAddress) external;

    /**
     * @notice Finalize wallet deregistration with solvency check
     * @dev Second phase of deregistration, validates reserve balance and removes wallet
     * @param btcAddress Bitcoin address to finalize deregistration for
     * @param newReserveBalance Updated reserve balance after wallet removal (must maintain solvency)
     */
    function finalizeWalletDeRegistration(
        string calldata btcAddress,
        uint256 newReserveBalance
    ) external;

    /**
     * @notice Check if wallet is locked for deregistration
     * @dev Used to prevent concurrent deregistration operations
     * @param btcAddress Bitcoin address to check lock status for
     * @return True if wallet is currently locked for deregistration, false otherwise
     */
    function isWalletDeregistrationLocked(string calldata btcAddress) external view returns (bool);

    /**
     * @notice Set QCRedeemer contract reference
     * @dev Admin function to update the QCRedeemer contract address for WOTS integration
     * @param _qcRedeemer Address of the QCRedeemer contract (must be valid contract)
     */
    function setQCRedeemer(address _qcRedeemer) external;
}