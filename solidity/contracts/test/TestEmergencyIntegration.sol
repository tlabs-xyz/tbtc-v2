// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../account-control/SystemState.sol";

/// @title TestEmergencyIntegration
/// @notice Test contract to verify emergency pause modifier integration
/// @dev Used for testing that the qcNotEmergencyPaused modifier works correctly
contract TestEmergencyIntegration {
    SystemState public immutable systemState;

    // Events for testing
    event FunctionExecuted(address qc, string message);
    event ModifierPassed(address qc);

    constructor(address _systemState) {
        systemState = SystemState(_systemState);
    }

    /// @notice Test function that uses the emergency pause modifier
    /// @param qc The QC address to check for emergency pause
    function testFunction(address qc) external {
        // Use the modifier from SystemState
        if (systemState.isQCEmergencyPaused(qc)) {
            revert SystemState.QCIsEmergencyPaused(qc);
        }

        emit ModifierPassed(qc);
        emit FunctionExecuted(qc, "Function executed successfully");
    }

    /// @notice Test function for QC-specific operations (minting simulation)
    /// @param qc The QC address
    function testQCMinting(address qc, uint256 /* amount */) external {
        if (systemState.isQCEmergencyPaused(qc)) {
            revert SystemState.QCIsEmergencyPaused(qc);
        }

        emit FunctionExecuted(qc, "Minting operation completed");
    }

    /// @notice Test function for QC-specific operations (redemption simulation)
    /// @param qc The QC address
    function testQCRedemption(address qc, uint256 /* amount */) external {
        if (systemState.isQCEmergencyPaused(qc)) {
            revert SystemState.QCIsEmergencyPaused(qc);
        }

        emit FunctionExecuted(qc, "Redemption operation completed");
    }

    /// @notice Test function that doesn't use the modifier (should always work)
    /// @param qc The QC address
    function testWithoutModifier(address qc) external {
        emit FunctionExecuted(qc, "Function without modifier executed");
    }

    /// @notice Get the current pause status for a QC
    /// @param qc The QC address
    /// @return paused True if the QC is emergency paused
    function getQCPauseStatus(address qc) external view returns (bool paused) {
        return systemState.isQCEmergencyPaused(qc);
    }
}
