// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

import "forge-std/Test.sol";
import "../../../contracts/cross-chain/starknet/StarkNetBitcoinDepositor.sol";
import "./mocks/MockStarkGateBridge.sol";
import "./mocks/MockTBTCToken.sol";
import "./mocks/MockTBTCBridge.sol";
import "./mocks/MockTBTCVault.sol";

contract StarkNetBitcoinDepositorTest is Test {
    StarkNetBitcoinDepositor public depositor;
    MockStarkGateBridge public mockStarkGateBridge;
    MockTBTCToken public mockTBTCToken;
    MockTBTCBridge public mockTBTCBridge;
    MockTBTCVault public mockTBTCVault;

    // Test addresses
    address public owner = address(0x1);
    address public user = address(0x2);
    uint256 public starkNetRecipient = uint256(0x3);
    
    // Test values
    uint256 public constant INITIAL_MESSAGE_FEE = 0.01 ether;
    uint256 public constant DEPOSIT_AMOUNT = 1 ether;

    function setUp() public {
        // Deploy mocks
        mockStarkGateBridge = new MockStarkGateBridge();
        mockTBTCToken = new MockTBTCToken();
        mockTBTCBridge = new MockTBTCBridge();
        mockTBTCVault = new MockTBTCVault();

        // Deploy depositor contract
        vm.prank(owner);
        depositor = new StarkNetBitcoinDepositor(
            address(mockTBTCBridge),
            address(mockTBTCVault),
            address(0), // wormhole (not used)
            address(0), // wormhole gateway (not used)
            address(0), // wormhole token bridge (not used)
            0, // l2 wormhole gateway (not used)
            address(mockStarkGateBridge),
            INITIAL_MESSAGE_FEE
        );
    }

    // ========== Constructor Tests ==========

    function test_Constructor_Success() public {
        assertEq(address(depositor.starkGateBridge()), address(mockStarkGateBridge));
        assertEq(depositor.l1ToL2MessageFee(), INITIAL_MESSAGE_FEE);
    }

    function test_Constructor_RevertInvalidBridge() public {
        vm.expectRevert("Invalid StarkGate bridge");
        new StarkNetBitcoinDepositor(
            address(mockTBTCBridge),
            address(mockTBTCVault),
            address(0),
            address(0),
            address(0),
            0,
            address(0), // Invalid bridge
            INITIAL_MESSAGE_FEE
        );
    }

    function test_Constructor_RevertInvalidFee() public {
        vm.expectRevert("Invalid L1->L2 message fee");
        new StarkNetBitcoinDepositor(
            address(mockTBTCBridge),
            address(mockTBTCVault),
            address(0),
            address(0),
            address(0),
            0,
            address(mockStarkGateBridge),
            0 // Invalid fee
        );
    }

    // ========== quoteFinalizeDeposit Tests ==========

    function test_QuoteFinalizeDeposit() public {
        bytes32 depositKey = keccak256("test");
        uint256 fee = depositor.quoteFinalizeDeposit(depositKey);
        assertEq(fee, INITIAL_MESSAGE_FEE);
    }

    // ========== updateL1ToL2MessageFee Tests ==========

    function test_UpdateL1ToL2MessageFee_Success() public {
        uint256 newFee = 0.02 ether;
        
        vm.expectEmit(false, false, false, true);
        emit StarkNetBitcoinDepositor.L1ToL2MessageFeeUpdated(newFee);
        
        vm.prank(owner);
        depositor.updateL1ToL2MessageFee(newFee);
        
        assertEq(depositor.l1ToL2MessageFee(), newFee);
    }

    function test_UpdateL1ToL2MessageFee_RevertNotOwner() public {
        vm.prank(user);
        vm.expectRevert("Ownable: caller is not the owner");
        depositor.updateL1ToL2MessageFee(0.02 ether);
    }

    function test_UpdateL1ToL2MessageFee_RevertInvalidFee() public {
        vm.prank(owner);
        vm.expectRevert("Invalid fee");
        depositor.updateL1ToL2MessageFee(0);
    }

    // ========== _transferTbtc Tests (via finalizeDeposit) ==========

    function test_TransferTbtc_Success() public {
        // This would test the internal _transferTbtc function
        // through the parent's finalizeDeposit function
        // Requires more complex setup with deposit initialization
    }

    function test_TransferTbtc_RevertInvalidAddress() public {
        // Test with zero address
        // Requires testing through finalizeDeposit
    }

    function test_TransferTbtc_EmitsEvent() public {
        // Test event emission
        // Requires testing through finalizeDeposit
    }
}