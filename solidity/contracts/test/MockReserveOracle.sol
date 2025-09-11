// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title MockReserveOracle
 * @notice Mock ReserveOracle for testing AccountControl V2 integration
 * @dev Simulates oracle consensus behavior for testing backing updates
 */
contract MockReserveOracle {
    address public accountControl;
    
    /// @notice Set the AccountControl contract address
    function setAccountControl(address _accountControl) external {
        accountControl = _accountControl;
    }
    
    /// @notice Mock function to simulate oracle consensus updating backing
    /// @param qc The QC address
    /// @param amount The backing amount from "consensus"
    function mockConsensusBackingUpdate(address qc, uint256 amount) external {
        require(accountControl != address(0), "AccountControl not set");
        
        // Call AccountControl as if consensus was reached
        (bool success, ) = accountControl.call(
            abi.encodeWithSignature("updateBacking(address,uint256)", qc, amount)
        );
        require(success, "Failed to update backing");
    }
    
    /// @notice Batch update multiple QCs (simulates batch oracle consensus)
    function mockBatchConsensusBackingUpdate(
        address[] calldata qcs,
        uint256[] calldata amounts
    ) external {
        require(qcs.length == amounts.length, "Array length mismatch");
        require(accountControl != address(0), "AccountControl not set");
        
        for (uint i = 0; i < qcs.length; i++) {
            (bool success, ) = accountControl.call(
                abi.encodeWithSignature("updateBacking(address,uint256)", qcs[i], amounts[i])
            );
            require(success, "Failed to update backing");
        }
    }
}