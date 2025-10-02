// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.17;

interface IQCData {
    function registerQC(address qc, uint256 maxMintingCap) external;
    function setQCStatus(address qc, uint8 status, bytes32 reason) external;
}

interface IMockAccountControl {
    enum ReserveType {
        UNINITIALIZED,
        QC_PERMISSIONED
    }
    function authorizeReserve(address reserve, uint256 mintingCap, ReserveType rType) external;
    function setMintingCap(address reserve, uint256 newCap) external;
}

/// @title MockQCManager
/// @notice Mock implementation of QCManager for testing
contract MockQCManager {
    mapping(address => uint256) public maxMintingCaps;
    mapping(address => bool) public isQCRegistered;
    mapping(address => uint256) public qcMintedAmount;
    mapping(address => bool) public qcActive; // Track active status
    mapping(string => bool) public walletRegistered; // Track wallet registration
    mapping(string => bool) public walletActive; // Track wallet active status

    // Mock AccountControl address
    address public accountControl;

    // QCData reference for integration
    IQCData public qcData;

    event QCRegistered(address indexed qc, uint256 maxMintingCap);
    event QCOnboarded(address indexed qc, uint256 maxMintingCap);
    event MintingCapUpdated(address indexed qc, uint256 newCap);
    event WalletRegistered(address indexed qc, string btcAddress);
    event AccountControlUpdated(address indexed oldAddress, address indexed newAddress);

    /// @notice Custom errors to match real QCManager behavior
    error QCNotRegistered(address qc);
    error QCNotActive(address qc);
    error QCAlreadyRegistered(address qc);
    error InvalidWalletAddress();
    error WalletNotRegistered(string btcAddress);
    error WalletNotActive(string btcAddress);
    error SignatureVerificationFailed();
    error MessageSignatureVerificationFailed();

    function registerQC(address qc, uint256 maxMintingCap) external {
        if (qc == address(0)) revert InvalidWalletAddress();
        if (isQCRegistered[qc]) revert QCAlreadyRegistered(qc);

        isQCRegistered[qc] = true;
        qcActive[qc] = true; // Set as active by default
        maxMintingCaps[qc] = maxMintingCap;

        // Also register in QCData if available
        if (address(qcData) != address(0)) {
            qcData.registerQC(qc, maxMintingCap);
            qcData.setQCStatus(qc, 0, bytes32("Active"));
        }

        // Also authorize in AccountControl if available
        if (accountControl != address(0)) {
            IMockAccountControl(accountControl).authorizeReserve(qc, maxMintingCap, IMockAccountControl.ReserveType.QC_PERMISSIONED);
        }

        emit QCRegistered(qc, maxMintingCap);
    }


    function getMaxMintingCap(address qc) external view returns (uint256) {
        return maxMintingCaps[qc];
    }

    function setMaxMintingCap(address qc, uint256 newCap) external {
        maxMintingCaps[qc] = newCap;
        emit MintingCapUpdated(qc, newCap);
    }

    function increaseMintingCap(address qc, uint256 newCap) external {
        require(newCap >= maxMintingCaps[qc], "New cap must be higher or equal");
        maxMintingCaps[qc] = newCap;
        
        // Update AccountControl if configured
        if (accountControl != address(0)) {
            IMockAccountControl(accountControl).setMintingCap(qc, newCap);
        }
        
        emit MintingCapUpdated(qc, newCap);
    }
    
    // Alias for increaseMintingCap to match test expectations
    function increaseMintingCapacity(address qc, uint256 newCap) external {
        this.increaseMintingCap(qc, newCap);
    }

    function getQCMintedAmount(address qc) external view returns (uint256) {
        return qcMintedAmount[qc];
    }

    function recordMinting(address qc, uint256 amount) external {
        if (!isQCRegistered[qc]) revert QCNotRegistered(qc);
        if (!qcActive[qc]) revert QCNotActive(qc);
        
        uint256 cap = maxMintingCaps[qc];
        uint256 newMinted = qcMintedAmount[qc] + amount;
        require(newMinted <= cap, "Exceeds minting cap");
        qcMintedAmount[qc] = newMinted;
    }

    function recordRedemption(address qc, uint256 amount) external {
        require(qcMintedAmount[qc] >= amount, "Insufficient minted amount");
        qcMintedAmount[qc] -= amount;
    }

    // Alias for setMaxMintingCap to match test expectations
    function setMintingCapacity(address qc, uint256 capacity) external {
        maxMintingCaps[qc] = capacity;
        emit MintingCapUpdated(qc, capacity);
    }

    function getAvailableMintingCapacity(address qc) external view returns (uint256) {
        // Simple mock: return max cap minus minted amount
        uint256 cap = maxMintingCaps[qc];
        uint256 minted = qcMintedAmount[qc];
        return cap > minted ? cap - minted : 0;
    }

    function updateQCMintedAmount(address qc, uint256 newAmount) external {
        qcMintedAmount[qc] = newAmount;
    }

    // Atomically check and consume minting capacity
    function consumeMintCapacity(address qc, uint256 amount) external returns (bool) {
        if (!isQCRegistered[qc]) revert QCNotRegistered(qc);
        if (!qcActive[qc]) revert QCNotActive(qc);
        
        uint256 cap = maxMintingCaps[qc];
        uint256 minted = qcMintedAmount[qc];
        uint256 newMinted = minted + amount;
        
        if (newMinted > cap) {
            return false; // Capacity exceeded
        }
        
        qcMintedAmount[qc] = newMinted;
        return true;
    }

    /// @notice Register a wallet for a QC
    function registerWallet(address qc, string memory btcAddress) external {
        if (!isQCRegistered[qc]) revert QCNotRegistered(qc);
        if (bytes(btcAddress).length == 0) revert InvalidWalletAddress();
        
        walletRegistered[btcAddress] = true;
        walletActive[btcAddress] = true;
        emit WalletRegistered(qc, btcAddress);
    }

    /// @notice Check if wallet is registered and active
    function validateWallet(string memory btcAddress) external view {
        if (!walletRegistered[btcAddress]) revert WalletNotRegistered(btcAddress);
        if (!walletActive[btcAddress]) revert WalletNotActive(btcAddress);
    }

    /// @notice Mock signature verification that fails for testing
    function verifySignature(
        address, // qc parameter unused in mock
        bytes memory signature,
        bytes memory message
    ) external pure {
        // Mock implementation - always fails for error testing
        if (signature.length == 0 || message.length == 0) {
            revert SignatureVerificationFailed();
        }
        // For specific test scenarios, we can make this fail
        if (keccak256(signature) == keccak256("invalid")) {
            revert MessageSignatureVerificationFailed();
        }
    }

    /// @notice Set QC active status for testing
    function setQCActive(address qc, bool active) external {
        if (!isQCRegistered[qc]) revert QCNotRegistered(qc);
        qcActive[qc] = active;
    }

    /// @notice Set wallet active status for testing
    function setWalletActive(string memory btcAddress, bool active) external {
        if (!walletRegistered[btcAddress]) revert WalletNotRegistered(btcAddress);
        walletActive[btcAddress] = active;
    }

    /// @notice Set AccountControl address for testing
    function setAccountControl(address _accountControl) external {
        address oldAddress = accountControl;
        accountControl = _accountControl;
        emit AccountControlUpdated(oldAddress, _accountControl);
    }

    /// @notice Set QCData address for testing integration
    function setQCData(address _qcData) external {
        qcData = IQCData(_qcData);
    }
}