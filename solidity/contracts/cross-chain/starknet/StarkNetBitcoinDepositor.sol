// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../integrator/AbstractBTCDepositor.sol";
import "../integrator/IBridge.sol";
import "../integrator/ITBTCVault.sol";
import "./interfaces/IStarkGateBridge.sol";

/// @title StarkNet L1 Bitcoin Depositor
/// @notice This contract facilitates Bitcoin deposits that are bridged to StarkNet L2
/// @dev Inherits from AbstractBTCDepositor and integrates with StarkGate bridge
contract StarkNetBitcoinDepositor is AbstractBTCDepositor, Ownable {
    using SafeERC20 for IERC20;

    // ========== State Variables ==========

    /// @notice The StarkGate bridge contract interface
    IStarkGateBridge public immutable starkGateBridge;

    /// @notice The L1 tBTC token contract
    IERC20 public immutable tbtcToken;

    /// @notice The L1→L2 message fee required for StarkGate bridge
    uint256 public l1ToL2MessageFee;

    // ========== Events ==========

    /// @notice Emitted when tBTC is successfully bridged to StarkNet
    /// @param depositKey The unique identifier for the deposit
    /// @param starkNetRecipient The recipient address on StarkNet L2
    /// @param amount The amount of tBTC bridged
    /// @param messageNonce The nonce of the L1→L2 message
    event TBTCBridgedToStarkNet(
        bytes32 indexed depositKey,
        uint256 indexed starkNetRecipient,
        uint256 amount,
        uint256 messageNonce
    );

    /// @notice Emitted when the L1→L2 message fee is updated
    /// @param newFee The new fee amount in wei
    event L1ToL2MessageFeeUpdated(uint256 newFee);

    /// @notice Emitted when the depositor is initialized
    /// @param starkGateBridge The address of the StarkGate bridge
    /// @param tbtcToken The address of the tBTC token
    event StarkNetBitcoinDepositorInitialized(
        address starkGateBridge,
        address tbtcToken
    );

    // ========== Constructor ==========

    /// @notice Initializes the StarkNet Bitcoin Depositor contract
    /// @param _tbtcBridge Address of the tBTC Bridge contract
    /// @param _tbtcVault Address of the tBTC Vault contract
    /// @param _starkGateBridge Address of the StarkGate bridge contract
    /// @param _l1ToL2MessageFee Initial L1→L2 message fee for StarkGate
    constructor(
        address _tbtcBridge,
        address _tbtcVault,
        address _starkGateBridge,
        uint256 _l1ToL2MessageFee
    ) {
        require(_tbtcBridge != address(0), "Invalid tBTC Bridge");
        require(_tbtcVault != address(0), "Invalid tBTC Vault");
        require(_starkGateBridge != address(0), "Invalid StarkGate bridge");
        require(_l1ToL2MessageFee > 0, "Invalid L1->L2 message fee");

        bridge = IBridge(_tbtcBridge);
        tbtcVault = ITBTCVault(_tbtcVault);
        starkGateBridge = IStarkGateBridge(_starkGateBridge);
        tbtcToken = IERC20(ITBTCVault(_tbtcVault).tbtcToken());
        l1ToL2MessageFee = _l1ToL2MessageFee;

        emit StarkNetBitcoinDepositorInitialized(_starkGateBridge, address(tbtcToken));
    }

    // ========== External Functions ==========

    /// @notice Initializes a deposit by revealing it to the tBTC Bridge
    /// @param fundingTx Bitcoin funding transaction data
    /// @param reveal Deposit reveal data  
    /// @param l2DepositOwner The L2 address that will own the deposit (as bytes32)
    function initializeDeposit(
        IBridgeTypes.BitcoinTxInfo calldata fundingTx,
        IBridgeTypes.DepositRevealInfo calldata reveal,
        bytes32 l2DepositOwner
    ) external {
        require(l2DepositOwner != bytes32(0), "Invalid L2 deposit owner");
        
        // Call parent's _initializeDeposit which handles the reveal to tBTC Bridge
        _initializeDeposit(fundingTx, reveal, l2DepositOwner);
    }

    /// @notice Finalizes a deposit by bridging minted tBTC to StarkNet
    /// @param depositKey The deposit key from initialization
    function finalizeDeposit(bytes32 depositKey) external payable {
        require(msg.value >= l1ToL2MessageFee, "Insufficient L1->L2 message fee");
        
        // Call parent's _finalizeDeposit to get the minted tBTC
        (uint256 initialAmount, uint256 tbtcAmount, bytes32 l2DepositOwner) = _finalizeDeposit(depositKey);
        
        // Bridge the tBTC to StarkNet
        _transferTbtc(tbtcAmount, l2DepositOwner);
    }

    /// @notice Returns the required fee to finalize a deposit
    /// @return The current L1→L2 message fee in wei
    function quoteFinalizeDeposit() public view returns (uint256) {
        return l1ToL2MessageFee;
    }

    /// @notice Updates the L1→L2 message fee
    /// @param newFee The new fee amount in wei
    function updateL1ToL2MessageFee(uint256 newFee) external onlyOwner {
        require(newFee > 0, "Invalid fee");
        l1ToL2MessageFee = newFee;
        emit L1ToL2MessageFeeUpdated(newFee);
    }

    // ========== Internal Functions ==========

    /// @notice Transfers tBTC to StarkNet L2 using StarkGate bridge
    /// @dev This is the key integration point with StarkGate
    /// @param amount The amount of tBTC to bridge
    /// @param l2Receiver The recipient address on StarkNet (as bytes32)
    function _transferTbtc(
        uint256 amount,
        bytes32 l2Receiver
    ) internal {
        // Convert bytes32 to uint256 for StarkNet address format
        uint256 starkNetRecipient = uint256(l2Receiver);
        require(starkNetRecipient != 0, "Invalid StarkNet address");

        // Approve StarkGate bridge to spend tBTC
        tbtcToken.safeIncreaseAllowance(address(starkGateBridge), amount);

        // Bridge tBTC to StarkNet with empty message for direct transfer
        uint256[] memory emptyMessage = new uint256[](0);
        uint256 messageNonce = starkGateBridge.depositWithMessage{value: msg.value}(
            address(tbtcToken),
            amount,
            starkNetRecipient,
            emptyMessage
        );

        // Emit event for tracking
        emit TBTCBridgedToStarkNet(
            keccak256(abi.encode(block.timestamp, amount, starkNetRecipient)),
            starkNetRecipient,
            amount,
            messageNonce
        );
    }
}