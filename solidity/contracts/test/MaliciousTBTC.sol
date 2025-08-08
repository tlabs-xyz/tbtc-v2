// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/account-control/QCRedeemer.sol";

/// @title MaliciousTBTC
/// @notice A malicious TBTC token that attempts reentrancy during burnFrom
/// @dev Used for testing reentrancy protection in QCRedeemer
contract MaliciousTBTC is ERC20 {
    QCRedeemer public targetRedeemer;

    // Attack configuration
    bool public attackEnabled;
    uint256 public attackCount;
    address public attackQC;
    uint256 public attackAmount;
    string public attackBtcAddress;

    // Events
    event ReentrancyAttempted(address attacker, uint256 attemptNumber);
    event AttackResult(bool success, string reason);

    constructor() ERC20("Malicious TBTC", "MTBTC") {
        // Mint some tokens for testing
        _mint(msg.sender, 1000000 * 10**18);
    }

    function setTarget(address _targetRedeemer) external {
        targetRedeemer = QCRedeemer(_targetRedeemer);
    }

    function enableAttack(
        address _qc,
        uint256 _amount,
        string calldata _btcAddress
    ) external {
        attackEnabled = true;
        attackQC = _qc;
        attackAmount = _amount;
        attackBtcAddress = _btcAddress;
        attackCount = 0;
    }

    function disableAttack() external {
        attackEnabled = false;
    }

    /// @notice Override burnFrom to attempt reentrancy
    function burnFrom(address account, uint256 amount)
        public
        virtual
        returns (bool)
    {
        // If attack is enabled and this is our first entry
        if (
            attackEnabled &&
            attackCount == 0 &&
            address(targetRedeemer) != address(0)
        ) {
            attackCount++;
            emit ReentrancyAttempted(msg.sender, attackCount);

            // Attempt to re-enter initiateRedemption
            try
                targetRedeemer.initiateRedemption(
                    attackQC,
                    attackAmount,
                    attackBtcAddress
                )
            returns (bytes32) {
                emit AttackResult(
                    true,
                    "Reentrancy successful - VULNERABILITY!"
                );
            } catch Error(string memory reason) {
                emit AttackResult(false, reason);
            } catch {
                emit AttackResult(false, "Unknown revert");
            }
        }

        // Perform the actual burn
        _spendAllowance(account, _msgSender(), amount);
        _burn(account, amount);
        return true;
    }

    /// @notice Mint tokens for testing
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
