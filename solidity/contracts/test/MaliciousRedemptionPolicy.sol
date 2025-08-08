// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../../contracts/account-control/interfaces/IRedemptionPolicy.sol";
import "../../contracts/account-control/QCRedeemer.sol";
import "../../contracts/bridge/BitcoinTx.sol";

/// @title MaliciousRedemptionPolicy
/// @notice A malicious redemption policy that attempts reentrancy attacks
/// @dev Used for testing reentrancy protection in QCRedeemer
contract MaliciousRedemptionPolicy is IRedemptionPolicy {
    QCRedeemer public immutable targetRedeemer;
    
    // Attack configuration
    bool public attackEnabled;
    uint256 public attackCount;
    bytes32 public targetRedemptionId;
    
    // Events
    event ReentrancyAttempted(address attacker, uint256 attemptNumber);
    event AttackResult(bool success, string reason);
    
    constructor(address _targetRedeemer) {
        targetRedeemer = QCRedeemer(_targetRedeemer);
    }
    
    function enableAttack(bytes32 _redemptionId) external {
        attackEnabled = true;
        targetRedemptionId = _redemptionId;
        attackCount = 0;
    }
    
    function disableAttack() external {
        attackEnabled = false;
    }
    
    /// @notice Validates redemption request and attempts reentrancy
    function validateRedemptionRequest(
        address /* user */,
        address /* qc */,
        uint256 /* amount */
    ) external pure override returns (bool valid) {
        // Always validate successfully to proceed with attack
        return true;
    }
    
    /// @notice Requests redemption - this is where we attempt reentrancy
    function requestRedemption(
        bytes32 redemptionId,
        address qc,
        address user,
        uint256 amount,
        string calldata btcAddress
    ) external override returns (bool success) {
        // If attack is enabled and this is our first entry
        if (attackEnabled && attackCount == 0) {
            attackCount++;
            emit ReentrancyAttempted(msg.sender, attackCount);
            
            // Attempt to re-enter the QCRedeemer
            try targetRedeemer.initiateRedemption(qc, amount, btcAddress) {
                emit AttackResult(true, "Reentrancy successful - VULNERABILITY!");
            } catch Error(string memory reason) {
                emit AttackResult(false, reason);
            } catch {
                emit AttackResult(false, "Unknown revert");
            }
        }
        
        // Return true to complete the original call
        return true;
    }
    
    /// @notice Records fulfillment - another reentrancy vector
    function recordFulfillment(
        bytes32 redemptionId,
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external override returns (bool success) {
        // If attack is enabled, attempt reentrancy
        if (attackEnabled && redemptionId == targetRedemptionId) {
            attackCount++;
            emit ReentrancyAttempted(msg.sender, attackCount);
            
            // Attempt to call recordRedemptionFulfillment again
            try targetRedeemer.recordRedemptionFulfillment(
                redemptionId,
                userBtcAddress,
                expectedAmount,
                txInfo,
                proof
            ) {
                emit AttackResult(true, "Double fulfillment successful - VULNERABILITY!");
            } catch Error(string memory reason) {
                emit AttackResult(false, reason);
            } catch {
                emit AttackResult(false, "Unknown revert");
            }
        }
        
        return true;
    }
    
    /// @notice Flag default - yet another reentrancy vector
    function flagDefault(bytes32 redemptionId, bytes32 reason) 
        external 
        override 
        returns (bool success) 
    {
        // If attack is enabled, attempt reentrancy
        if (attackEnabled && redemptionId == targetRedemptionId) {
            attackCount++;
            emit ReentrancyAttempted(msg.sender, attackCount);
            
            // Attempt to flag default again
            try targetRedeemer.flagDefaultedRedemption(redemptionId, reason) {
                emit AttackResult(true, "Double default successful - VULNERABILITY!");
            } catch Error(string memory reason) {
                emit AttackResult(false, string(abi.encodePacked("Reverted: ", reason)));
            } catch {
                emit AttackResult(false, "Unknown revert");
            }
        }
        
        return true;
    }
    
    /// @notice Get redemption timeout
    function getRedemptionTimeout() external pure override returns (uint256) {
        return 24 hours;
    }
    
    /// @notice Get redemption status
    function getRedemptionStatus(bytes32 /* redemptionId */)
        external
        pure
        override
        returns (IRedemptionPolicy.RedemptionStatus)
    {
        return IRedemptionPolicy.RedemptionStatus.PENDING;
    }
    
    /// @notice Check if redemption is fulfilled
    function isRedemptionFulfilled(bytes32 /* redemptionId */)
        external
        pure
        override
        returns (bool)
    {
        return false;
    }
    
    /// @notice Check if redemption is defaulted
    function isRedemptionDefaulted(bytes32 /* redemptionId */)
        external
        pure
        override
        returns (bool defaulted, bytes32 reason)
    {
        return (false, bytes32(0));
    }
}