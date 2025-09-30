// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../bridge/IRelay.sol";

/// @title SPV State
/// @notice Holds the state required for SPV (Simplified Payment Verification)
///         validation in the Account Control system. This includes the Bitcoin
///         relay reference and proof difficulty requirements.
/// @dev This library manages SPV-related storage for Account Control contracts
///      that need to validate Bitcoin transactions using the same infrastructure
///      as the Bridge.
library SPVState {
    // Custom errors for initialization states
    error RelayAddressZero();
    error DifficultyFactorZero();
    error AlreadyInitialized();
    error RelayNotContract();

    // Events
    event SPVInitialized(address relay, uint96 txProofDifficultyFactor);
    /// @notice SPV validation storage structure
    struct Storage {
        /// @notice Bitcoin relay providing the current Bitcoin network difficulty.
        ///         This is the same relay used by the Bridge for consistency.
        IRelay relay;
        /// @notice The number of confirmations on the Bitcoin chain required to
        ///         successfully evaluate an SPV proof. This should match the
        ///         Bridge's txProofDifficultyFactor for security consistency.
        uint96 txProofDifficultyFactor;
        /// @notice Flag indicating whether the SPV state has been initialized
        bool initialized;
    }

    /// @notice Validates that the SPV state is properly initialized
    /// @param self The SPV storage reference
    /// @return isValid True if initialization flag is set
    function isInitialized(Storage storage self) internal view returns (bool isValid) {
        return self.initialized;
    }

    /// @notice Initializes the SPV state with relay and difficulty parameters
    /// @param self The SPV storage reference
    /// @param _relay Address of the Bitcoin relay contract
    /// @param _txProofDifficultyFactor Required confirmations for SPV proofs
    function initialize(
        Storage storage self,
        address _relay,
        uint96 _txProofDifficultyFactor
    ) internal {
        if (_relay == address(0)) revert RelayAddressZero();
        if (_txProofDifficultyFactor == 0) revert DifficultyFactorZero();
        if (isInitialized(self)) revert AlreadyInitialized();
        if (_relay.code.length == 0) revert RelayNotContract();

        self.relay = IRelay(_relay);
        self.txProofDifficultyFactor = _txProofDifficultyFactor;
        self.initialized = true;
        
        emit SPVInitialized(_relay, _txProofDifficultyFactor);
    }

    /// @notice Updates the relay address
    /// @param self The SPV storage reference
    /// @param _relay New relay address
    function setRelay(Storage storage self, address _relay) internal {
        require(_relay != address(0), "SPVState: relay address cannot be zero");
        self.relay = IRelay(_relay);
    }

    /// @notice Updates the transaction proof difficulty factor
    /// @param self The SPV storage reference
    /// @param _txProofDifficultyFactor New difficulty factor
    function setTxProofDifficultyFactor(Storage storage self, uint96 _txProofDifficultyFactor) internal {
        require(_txProofDifficultyFactor > 0, "SPVState: difficulty factor must be positive");
        self.txProofDifficultyFactor = _txProofDifficultyFactor;
    }

    /// @notice Gets the current relay and difficulty factor
    /// @param self The SPV storage reference
    /// @return relay The current relay address
    /// @return difficultyFactor The current difficulty factor
    function getParameters(Storage storage self) 
        internal 
        view 
        returns (address relay, uint96 difficultyFactor) 
    {
        return (address(self.relay), self.txProofDifficultyFactor);
    }
}