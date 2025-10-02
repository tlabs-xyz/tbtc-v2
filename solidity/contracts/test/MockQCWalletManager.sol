// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../account-control/interfaces/IQCWalletManager.sol";

/// @title MockQCWalletManager
/// @notice Mock implementation of IQCWalletManager for testing
contract MockQCWalletManager is IQCWalletManager {
    
    mapping(string => address) public walletOwners;
    mapping(string => bool) public deregistrationLocks;
    address public qcRedeemer;
    
    event WalletRegistered(address indexed qc, string btcAddress);
    event WalletDeregistrationRequested(string btcAddress);
    event WalletDeregistrationFinalized(string btcAddress, uint256 newReserveBalance);
    
    /// @notice Register a wallet for a QC using Bitcoin signature verification
    function registerWallet(
        address qc,
        string calldata btcAddress,
        bytes32 challenge,
        bytes calldata walletPublicKey,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override {
        // Mock implementation - just register without signature verification
        walletOwners[btcAddress] = qc;
        emit WalletRegistered(qc, btcAddress);
    }

    /// @notice Direct wallet registration by QCs themselves
    function registerWalletDirect(
        string calldata btcAddress,
        uint256 nonce,
        bytes calldata walletPublicKey,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override {
        // Mock implementation - just register without signature verification
        walletOwners[btcAddress] = msg.sender;
        emit WalletRegistered(msg.sender, btcAddress);
    }

    /// @notice Request wallet ownership verification
    function requestWalletOwnershipVerification(
        string calldata bitcoinAddress,
        uint256 nonce
    ) external override returns (bytes32 challenge) {
        // Mock implementation - return a deterministic challenge
        challenge = keccak256(abi.encodePacked("MOCK_CHALLENGE:", bitcoinAddress, nonce, msg.sender));
        return challenge;
    }

    /// @notice Request wallet deregistration with atomic lock protection
    function requestWalletDeRegistration(string calldata btcAddress) external override {
        deregistrationLocks[btcAddress] = true;
        emit WalletDeregistrationRequested(btcAddress);
    }

    /// @notice Finalize wallet deregistration with solvency check
    function finalizeWalletDeRegistration(
        string calldata btcAddress,
        uint256 newReserveBalance
    ) external override {
        delete walletOwners[btcAddress];
        delete deregistrationLocks[btcAddress];
        emit WalletDeregistrationFinalized(btcAddress, newReserveBalance);
    }

    /// @notice Check if wallet is locked for deregistration
    function isWalletDeregistrationLocked(string calldata btcAddress) external view override returns (bool) {
        return deregistrationLocks[btcAddress];
    }

    /// @notice Set QCRedeemer contract reference
    function setQCRedeemer(address _qcRedeemer) external override {
        qcRedeemer = _qcRedeemer;
    }
    
    /// @notice Get wallet owner (helper for testing)
    function getWalletOwner(string calldata btcAddress) external view returns (address) {
        return walletOwners[btcAddress];
    }
}