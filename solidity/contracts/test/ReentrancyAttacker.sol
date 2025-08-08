// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "../../contracts/account-control/interfaces/IRedemptionPolicy.sol";
import "../../contracts/account-control/QCRedeemer.sol";
import "../../contracts/account-control/BasicRedemptionPolicy.sol";
import "../../contracts/bridge/BitcoinTx.sol";

/// @title ReentrancyAttacker
/// @notice A generic reentrancy attacker contract for testing
/// @dev Can be configured to attack different functions
contract ReentrancyAttacker {
    enum AttackType {
        NONE,
        QCREDEEMER_INITIATE,
        QCREDEEMER_FULFILL,
        QCREDEEMER_DEFAULT,
        REDEMPTION_POLICY_FULFILL
    }
    
    // Target contracts
    QCRedeemer public qcRedeemer;
    BasicRedemptionPolicy public redemptionPolicy;
    
    // Attack configuration
    AttackType public attackType;
    uint256 public attackCount;
    uint256 public maxAttacks;
    
    // Attack parameters
    address public attackQC;
    uint256 public attackAmount;
    string public attackBtcAddress;
    bytes32 public attackRedemptionId;
    bytes32 public attackReason;
    
    // Events
    event AttackExecuted(AttackType attackType, uint256 attemptNumber);
    event AttackResult(bool success, bytes data);
    
    constructor() {
        maxAttacks = 2; // Default to attempting 2 reentrancies
    }
    
    function setTargets(
        address _qcRedeemer,
        address _redemptionPolicy
    ) external {
        qcRedeemer = QCRedeemer(_qcRedeemer);
        redemptionPolicy = BasicRedemptionPolicy(_redemptionPolicy);
    }
    
    function prepareAttack(
        AttackType _type,
        address _qc,
        uint256 _amount,
        string calldata _btcAddress,
        bytes32 _redemptionId
    ) external {
        attackType = _type;
        attackQC = _qc;
        attackAmount = _amount;
        attackBtcAddress = _btcAddress;
        attackRedemptionId = _redemptionId;
        attackReason = keccak256("ATTACK_REASON");
        attackCount = 0;
    }
    
    /// @notice Execute the configured attack
    function executeAttack() external {
        if (attackType == AttackType.QCREDEEMER_INITIATE) {
            _attackInitiateRedemption();
        } else if (attackType == AttackType.QCREDEEMER_FULFILL) {
            _attackRecordFulfillment();
        } else if (attackType == AttackType.QCREDEEMER_DEFAULT) {
            _attackFlagDefault();
        } else if (attackType == AttackType.REDEMPTION_POLICY_FULFILL) {
            _attackPolicyFulfillment();
        }
    }
    
    function _attackInitiateRedemption() internal {
        emit AttackExecuted(AttackType.QCREDEEMER_INITIATE, attackCount);
        
        try qcRedeemer.initiateRedemption(
            attackQC,
            attackAmount,
            attackBtcAddress
        ) returns (bytes32 redemptionId) {
            emit AttackResult(true, abi.encode(redemptionId));
            
            // Try reentrancy if we haven't exceeded max attempts
            if (attackCount < maxAttacks) {
                attackCount++;
                _attackInitiateRedemption();
            }
        } catch (bytes memory reason) {
            emit AttackResult(false, reason);
        }
    }
    
    function _attackRecordFulfillment() internal {
        emit AttackExecuted(AttackType.QCREDEEMER_FULFILL, attackCount);
        
        // Create mock SPV data
        BitcoinTx.Info memory txInfo = BitcoinTx.Info({
            version: bytes4(0x02000000),
            inputVector: hex"01",
            outputVector: hex"01",
            locktime: bytes4(0x00000000)
        });
        
        BitcoinTx.Proof memory proof = BitcoinTx.Proof({
            merkleProof: hex"01",
            txIndexInBlock: 0,
            bitcoinHeaders: hex"01",
            coinbasePreimage: bytes32(0),
            coinbaseProof: hex"01"
        });
        
        try qcRedeemer.recordRedemptionFulfillment(
            attackRedemptionId,
            attackBtcAddress,
            100000, // expectedAmount
            txInfo,
            proof
        ) {
            emit AttackResult(true, hex"");
            
            // Try reentrancy
            if (attackCount < maxAttacks) {
                attackCount++;
                _attackRecordFulfillment();
            }
        } catch (bytes memory reason) {
            emit AttackResult(false, reason);
        }
    }
    
    function _attackFlagDefault() internal {
        emit AttackExecuted(AttackType.QCREDEEMER_DEFAULT, attackCount);
        
        try qcRedeemer.flagDefaultedRedemption(
            attackRedemptionId,
            attackReason
        ) {
            emit AttackResult(true, hex"");
            
            // Try reentrancy
            if (attackCount < maxAttacks) {
                attackCount++;
                _attackFlagDefault();
            }
        } catch (bytes memory reason) {
            emit AttackResult(false, reason);
        }
    }
    
    function _attackPolicyFulfillment() internal {
        emit AttackExecuted(AttackType.REDEMPTION_POLICY_FULFILL, attackCount);
        
        // Create mock SPV data
        BitcoinTx.Info memory txInfo = BitcoinTx.Info({
            version: bytes4(0x02000000),
            inputVector: hex"01",
            outputVector: hex"01",
            locktime: bytes4(0x00000000)
        });
        
        BitcoinTx.Proof memory proof = BitcoinTx.Proof({
            merkleProof: hex"01",
            txIndexInBlock: 0,
            bitcoinHeaders: hex"01",
            coinbasePreimage: bytes32(0),
            coinbaseProof: hex"01"
        });
        
        try redemptionPolicy.recordFulfillment(
            attackRedemptionId,
            attackBtcAddress,
            100000, // expectedAmount
            txInfo,
            proof
        ) returns (bool success) {
            emit AttackResult(success, abi.encode(success));
            
            // Try reentrancy
            if (attackCount < maxAttacks) {
                attackCount++;
                _attackPolicyFulfillment();
            }
        } catch (bytes memory reason) {
            emit AttackResult(false, reason);
        }
    }
    
    /// @notice Callback function that some contracts might call
    receive() external payable {
        // If we receive ETH during an attack, continue the attack
        if (attackType != AttackType.NONE && attackCount < maxAttacks) {
            this.executeAttack();
        }
    }
    
    /// @notice Fallback that continues attack
    fallback() external payable {
        if (attackType != AttackType.NONE && attackCount < maxAttacks) {
            this.executeAttack();
        }
    }
}