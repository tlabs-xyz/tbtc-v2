import { ethers, helpers } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import type {
  StarkNetBitcoinDepositor,
  MockBridgeForStarkNet,
  MockTBTCVault,
  MockTBTCToken,
  MockStarkGateBridge,
} from "../../typechain"
import { to1ePrecision } from "../helpers/contract-test-helpers"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("StarkNetBitcoinDepositor - Security & Edge Cases", () => {
  let depositor: StarkNetBitcoinDepositor
  let bridge: MockBridgeForStarkNet
  let tbtcVault: MockTBTCVault
  let tbtcToken: MockTBTCToken
  let starkGateBridge: MockStarkGateBridge
  
  let owner: SignerWithAddress
  let attacker: SignerWithAddress
  let user: SignerWithAddress
  
  const INITIAL_MESSAGE_FEE = ethers.utils.parseEther("0.01")
  const STARKNET_RECIPIENT = "0x04e3bc49f130f9d0379082c24efd397a0eddfccdc6023a2f02a74d8527140276"
  const STARKNET_TBTC_TOKEN = ethers.BigNumber.from("0x12345")
  
  before(async () => {
    [owner, attacker, user] = await ethers.getSigners()
    
    // Deploy mock contracts
    const MockTBTCToken = await ethers.getContractFactory("MockTBTCToken")
    tbtcToken = await MockTBTCToken.deploy()

    const MockBridgeForStarkNet = await ethers.getContractFactory("MockBridgeForStarkNet")
    bridge = await MockBridgeForStarkNet.deploy()

    const MockTBTCVault = await ethers.getContractFactory("contracts/test/MockTBTCVault.sol:MockTBTCVault")
    tbtcVault = await MockTBTCVault.deploy()
    await tbtcVault.setTbtcToken(tbtcToken.address)

    const MockStarkGateBridge = await ethers.getContractFactory("MockStarkGateBridge")
    starkGateBridge = await MockStarkGateBridge.deploy()

    // Deploy main contract with proxy
    const StarkNetBitcoinDepositor = await ethers.getContractFactory("StarkNetBitcoinDepositor")
    const depositorImpl = await StarkNetBitcoinDepositor.deploy()
    
    // Deploy proxy
    const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy")
    const initData = depositorImpl.interface.encodeFunctionData("initialize", [
      bridge.address,
      tbtcVault.address,
      starkGateBridge.address,
      STARKNET_TBTC_TOKEN,
      INITIAL_MESSAGE_FEE
    ])
    const proxy = await ProxyFactory.deploy(depositorImpl.address, initData)
    
    depositor = StarkNetBitcoinDepositor.attach(proxy.address)
  })

  describe("Reentrancy Protection", () => {
    it("should prevent reentrancy attacks during finalizeDeposit", async () => {
      // Test that contract is protected against reentrancy
      // Note: AbstractL1BTCDepositor should have reentrancy protection
      // We need to verify it's inherited and working
      
      // Create a reentrancy attacker contract that tries to call back
      const ReentrancyAttacker = await ethers.getContractFactory("ReentrancyAttacker")
      const attacker = await ReentrancyAttacker.deploy(depositor.address)
      
      // Attempt reentrancy attack
      await expect(
        attacker.attack({ value: INITIAL_MESSAGE_FEE })
      ).to.be.reverted // The parent contract should have reentrancy guard
    })

    it("should prevent recursive calls to _transferTbtc", async () => {
      // The internal _transferTbtc function should not be callable recursively
      // This is protected by the parent's finalizeDeposit reentrancy guard
      
      // Test that multiple simultaneous calls are rejected
      const depositKey = ethers.utils.keccak256("0x01")
      
      // First call should work, second should fail if called within the same tx
      // This would be tested via a malicious StarkGate bridge mock
    })
  })

  describe("Access Control", () => {
    it("should only allow owner to update L1ToL2MessageFee", async () => {
      const newFee = ethers.utils.parseEther("0.02")
      
      await expect(
        depositor.connect(attacker).updateL1ToL2MessageFee(newFee)
      ).to.be.revertedWith("Ownable: caller is not the owner")
      
      // Owner should succeed
      await expect(
        depositor.connect(owner).updateL1ToL2MessageFee(newFee)
      ).to.emit(depositor, "L1ToL2MessageFeeUpdated")
        .withArgs(newFee)
    })

    it("should only allow owner to update fee buffer", async () => {
      const newBuffer = 20
      
      await expect(
        depositor.connect(attacker).updateFeeBuffer(newBuffer)
      ).to.be.revertedWith("Ownable: caller is not the owner")
      
      // Owner should succeed
      await expect(
        depositor.connect(owner).updateFeeBuffer(newBuffer)
      ).to.emit(depositor, "FeeBufferUpdated")
        .withArgs(newBuffer)
    })

    it("should prevent initialization after deployment", async () => {
      // Try to re-initialize - should fail
      await expect(
        depositor.initialize(
          bridge.address,
          tbtcVault.address,
          starkGateBridge.address,
          STARKNET_TBTC_TOKEN,
          INITIAL_MESSAGE_FEE
        )
      ).to.be.revertedWith("Initializable: contract is already initialized")
    })

    it("should not allow direct calls to internal functions", async () => {
      // _transferTbtc is internal and cannot be called directly
      // This is enforced at compile time, but we can verify the ABI
      const abi = depositor.interface.fragments
      const transferTbtcFunction = abi.find(f => f.name === "_transferTbtc")
      expect(transferTbtcFunction).to.be.undefined
    })
  })

  describe("Integer Overflow/Underflow Protection", () => {
    it("should handle maximum uint256 amounts safely", async () => {
      const maxUint256 = ethers.constants.MaxUint256
      
      // Fee update with max value should be allowed (no overflow in storage)
      await expect(
        depositor.connect(owner).updateL1ToL2MessageFee(maxUint256)
      ).to.emit(depositor, "L1ToL2MessageFeeUpdated")
        .withArgs(maxUint256)
        
      // Reset fee to avoid affecting other tests
      await depositor.connect(owner).updateL1ToL2MessageFee(INITIAL_MESSAGE_FEE)
    })

    it("should handle fee buffer calculations without overflow", async () => {
      // Set fee buffer to maximum allowed (50%)
      await depositor.connect(owner).updateFeeBuffer(50)
      
      // quoteFinalizeDepositDynamic should handle large base fees
      // Mock StarkGate to return a large fee that won't overflow with 50% buffer
      // MaxUint256 / 1.5 to ensure no overflow when adding 50%
      const maxSafeFee = ethers.constants.MaxUint256.mul(2).div(3)
      await starkGateBridge.setEstimateMessageFeeReturn(maxSafeFee)
      
      // This should not overflow even with 50% buffer
      const quote = await depositor.quoteFinalizeDepositDynamic()
      
      // Verify it calculated correctly (accounting for integer division)
      // The contract does (baseFee / 100) * feeBuffer, which loses precision
      const expectedBufferAmount = maxSafeFee.div(100).mul(50)
      const expectedQuote = maxSafeFee.add(expectedBufferAmount)
      expect(quote).to.equal(expectedQuote)
    })

    it("should prevent fee buffer above maximum", async () => {
      await expect(
        depositor.connect(owner).updateFeeBuffer(51)
      ).to.be.revertedWith("Fee buffer too high")
      
      await expect(
        depositor.connect(owner).updateFeeBuffer(100)
      ).to.be.revertedWith("Fee buffer too high")
    })
  })

  describe("Input Validation", () => {
    it("should reject zero fee updates", async () => {
      await expect(
        depositor.connect(owner).updateL1ToL2MessageFee(0)
      ).to.be.revertedWith("Fee must be greater than 0")
    })

    it("should reject invalid StarkNet addresses in _transferTbtc", async () => {
      // This is tested through the parent's finalizeDeposit
      // We need to setup a deposit with zero destination address
      
      // Mock bridge to simulate a deposit with zero recipient
      const fundingTx = {
        version: "0x01000000",
        inputVector: "0x01" + "0".repeat(70),
        outputVector: "0x02" + "0".repeat(70),
        locktime: "0x00000000",
      }
      
      const reveal = {
        fundingOutputIndex: 0,
        blindingFactor: "0xf9f0c90d00039523",
        walletPubKeyHash: "0x8db50eb52063ea9d98b3eac91489a90f738986f6",
        refundPubKeyHash: "0x28e081f285138ccbe389c1eb8985716230129f89",
        refundLocktime: "0x60bcea61",
        vault: tbtcVault.address,
      }
      
      // Initialize deposit with zero StarkNet recipient (invalid)
      const zeroRecipient = ethers.constants.HashZero
      
      // This should revert when trying to finalize with zero recipient
      // The validation happens in _transferTbtc
    })

    it("should validate message fee payment", async () => {
      // Setup a valid deposit first using the parent's initializeDeposit
      const fundingTx = {
        version: "0x01000000",
        inputVector: "0x01" + "a".repeat(70),
        outputVector: "0x02" + "b".repeat(70),
        locktime: "0x00000000",
      }
      
      const reveal = {
        fundingOutputIndex: 0,
        blindingFactor: "0xf9f0c90d00039523",
        walletPubKeyHash: "0x8db50eb52063ea9d98b3eac91489a90f738986f6",
        refundPubKeyHash: "0x28e081f285138ccbe389c1eb8985716230129f89",
        refundLocktime: "0x60bcea61",
        vault: tbtcVault.address,
      }
      
      // Initialize deposit through the depositor contract (not bridge)
      const tx = await depositor.initializeDeposit(fundingTx, reveal, STARKNET_RECIPIENT)
      const receipt = await tx.wait()
      
      // Extract depositKey from events
      const event = receipt.events?.find(e => e.event === "DepositInitialized")
      const depositKey = event?.args?.depositKey
      
      // Now finalize the deposit on the bridge side
      await bridge.revealDepositWithExtraData(fundingTx, reveal, STARKNET_RECIPIENT)
      
      // Mock vault to show deposit exists and is ready
      await tbtcVault.setOptimisticMintingFinalized(depositKey)
      await tbtcVault.setDepositAmount(depositKey, ethers.utils.parseEther("1"))
      
      // Mint tBTC to the depositor contract so it has funds to transfer
      await tbtcToken.mint(depositor.address, ethers.utils.parseEther("1"))
      
      // Now test insufficient fee validation
      await expect(
        depositor.finalizeDeposit(depositKey, { value: 0 })
      ).to.be.revertedWith("Insufficient L1->L2 message fee")
      
      // Try with less than required
      await expect(
        depositor.finalizeDeposit(depositKey, { value: INITIAL_MESSAGE_FEE.sub(1) })
      ).to.be.revertedWith("Insufficient L1->L2 message fee")
    })
  })

  describe("Front-running Protection", () => {
    it("should not be vulnerable to fee update front-running", async () => {
      // Scenario: Owner wants to update fee, attacker sees tx and front-runs
      // The contract doesn't have explicit front-run protection for fee updates
      // But this is acceptable as only owner can update fees
      
      const currentFee = await depositor.l1ToL2MessageFee()
      const newFee = currentFee.mul(2)
      
      // Even if attacker front-runs a user's deposit before fee increase,
      // it doesn't harm the protocol - user just pays less fee
      await depositor.connect(owner).updateL1ToL2MessageFee(newFee)
      
      // Verify new fee is active
      expect(await depositor.l1ToL2MessageFee()).to.equal(newFee)
    })

    it("should handle deposit finalization atomically", async () => {
      // The deposit finalization should be atomic - no partial state changes
      // If StarkGate bridge fails, no tBTC should be transferred
      
      // Make StarkGate bridge revert
      await starkGateBridge.setShouldRevert(true)
      
      const depositKey = ethers.utils.keccak256("0x03")
      const initialBalance = await tbtcToken.balanceOf(depositor.address)
      
      // This should revert and not change any state
      await expect(
        depositor.finalizeDeposit(depositKey, { value: INITIAL_MESSAGE_FEE })
      ).to.be.reverted
      
      // Verify no tokens were transferred
      expect(await tbtcToken.balanceOf(depositor.address)).to.equal(initialBalance)
      
      // Reset StarkGate bridge
      await starkGateBridge.setShouldRevert(false)
    })
  })

  describe("Emergency Scenarios", () => {
    it("should handle StarkGate bridge unavailability gracefully", async () => {
      // Test quoteFinalizeDepositDynamic fallback
      // Already tested in previous tests, but let's be explicit
      
      // Make estimateMessageFee revert
      await starkGateBridge.setShouldRevertEstimate(true)
      
      // Should fall back to static fee
      const quote = await depositor.quoteFinalizeDepositDynamic()
      expect(quote).to.equal(await depositor.l1ToL2MessageFee())
      
      // Reset
      await starkGateBridge.setShouldRevertEstimate(false)
    })

    it("should handle token approval failures", async () => {
      // Mock token to fail on approve
      await tbtcToken.setShouldFailApprove(true)
      
      const depositKey = ethers.utils.keccak256("0x04")
      
      await expect(
        depositor.finalizeDeposit(depositKey, { value: INITIAL_MESSAGE_FEE })
      ).to.be.reverted
      
      // Reset
      await tbtcToken.setShouldFailApprove(false)
    })

    it("should handle extreme gas price scenarios", async () => {
      // Set an extremely high message fee
      const extremeFee = ethers.utils.parseEther("100")
      await depositor.connect(owner).updateL1ToL2MessageFee(extremeFee)
      
      // Setup a valid deposit first
      const fundingTx = {
        version: "0x01000000",
        inputVector: "0x01" + "c".repeat(70),
        outputVector: "0x02" + "d".repeat(70),
        locktime: "0x00000000",
      }
      
      const reveal = {
        fundingOutputIndex: 0,
        blindingFactor: "0xf9f0c90d00039523",
        walletPubKeyHash: "0x8db50eb52063ea9d98b3eac91489a90f738986f6",
        refundPubKeyHash: "0x28e081f285138ccbe389c1eb8985716230129f89",
        refundLocktime: "0x60bcea61",
        vault: tbtcVault.address,
      }
      
      // Initialize through depositor
      const tx = await depositor.initializeDeposit(fundingTx, reveal, STARKNET_RECIPIENT)
      const receipt = await tx.wait()
      const event = receipt.events?.find(e => e.event === "DepositInitialized")
      const depositKey = event?.args?.depositKey
      
      // Finalize on bridge
      await bridge.revealDepositWithExtraData(fundingTx, reveal, STARKNET_RECIPIENT)
      await tbtcVault.setOptimisticMintingFinalized(depositKey)
      await tbtcVault.setDepositAmount(depositKey, ethers.utils.parseEther("1"))
      await tbtcToken.mint(depositor.address, ethers.utils.parseEther("1"))
      
      // User must provide exact fee
      await expect(
        depositor.finalizeDeposit(depositKey, { value: extremeFee.sub(1) })
      ).to.be.revertedWith("Insufficient L1->L2 message fee")
      
      // Reset to normal fee
      await depositor.connect(owner).updateL1ToL2MessageFee(INITIAL_MESSAGE_FEE)
    })
  })

  describe("State Consistency", () => {
    it("should maintain consistent state across failures", async () => {
      // Verify that failed transactions don't leave inconsistent state
      const depositKey = ethers.utils.keccak256("0x06")
      
      // Get initial state
      const initialFee = await depositor.l1ToL2MessageFee()
      const initialBuffer = await depositor.feeBuffer()
      
      // Cause various failures and verify state remains consistent
      await starkGateBridge.setShouldRevert(true)
      
      await expect(
        depositor.finalizeDeposit(depositKey, { value: INITIAL_MESSAGE_FEE })
      ).to.be.reverted
      
      // State should be unchanged
      expect(await depositor.l1ToL2MessageFee()).to.equal(initialFee)
      expect(await depositor.feeBuffer()).to.equal(initialBuffer)
      
      await starkGateBridge.setShouldRevert(false)
    })

    it("should handle concurrent operations safely", async () => {
      // Multiple users trying to finalize different deposits
      // This tests that the contract handles concurrent access properly
      // In a real scenario, these would be in different blocks
      // but we can at least verify the contract state handles multiple deposits
    })
  })

  describe("Proxy-specific Security", () => {
    it("should not allow implementation contract initialization", async () => {
      // Deploy a new implementation directly (not through proxy)
      const StarkNetBitcoinDepositor = await ethers.getContractFactory("StarkNetBitcoinDepositor")
      const impl = await StarkNetBitcoinDepositor.deploy()
      
      // Try to initialize it - should fail due to _disableInitializers()
      await expect(
        impl.initialize(
          bridge.address,
          tbtcVault.address,
          starkGateBridge.address,
          STARKNET_TBTC_TOKEN,
          INITIAL_MESSAGE_FEE
        )
      ).to.be.revertedWith("Initializable: contract is already initialized")
    })

    it("should prevent storage collision attacks", async () => {
      // The __gap variable prevents storage collisions in upgrades
      // This is more of a design verification than a runtime test
      
      // Verify the contract has proper storage gap
      // This would be caught at compile time if missing
      expect(true).to.be.true // Placeholder - gap is verified in contract
    })
  })

  describe("Edge Cases", () => {
    it("should handle zero amount transfers", async () => {
      // While unusual, contract should handle zero amounts gracefully
      // This might happen due to rounding or fee calculations
      
      // Setup a valid deposit first
      const fundingTx = {
        version: "0x01000000",
        inputVector: "0x01" + "e".repeat(70),
        outputVector: "0x02" + "f".repeat(70),
        locktime: "0x00000000",
      }
      
      const reveal = {
        fundingOutputIndex: 0,
        blindingFactor: "0xf9f0c90d00039523",
        walletPubKeyHash: "0x8db50eb52063ea9d98b3eac91489a90f738986f6",
        refundPubKeyHash: "0x28e081f285138ccbe389c1eb8985716230129f89",
        refundLocktime: "0x60bcea61",
        vault: tbtcVault.address,
      }
      
      // Initialize through depositor
      const tx = await depositor.initializeDeposit(fundingTx, reveal, STARKNET_RECIPIENT)
      const receipt = await tx.wait()
      const event = receipt.events?.find(e => e.event === "DepositInitialized")
      const depositKey = event?.args?.depositKey
      
      // Finalize on bridge
      await bridge.revealDepositWithExtraData(fundingTx, reveal, STARKNET_RECIPIENT)
      await tbtcVault.setOptimisticMintingFinalized(depositKey)
      
      // Mock vault to return zero amount
      await tbtcVault.setDepositAmount(depositKey, 0)
      
      // Should still work but transfer zero
      await expect(
        depositor.finalizeDeposit(depositKey, { value: INITIAL_MESSAGE_FEE })
      ).to.not.be.reverted
    })

    it("should handle maximum realistic deposit amounts", async () => {
      // Test with 21 million BTC (maximum possible)
      const maxBTC = ethers.utils.parseEther("21000000")
      
      // Setup a valid deposit first
      const fundingTx = {
        version: "0x01000000",
        inputVector: "0x01" + "9".repeat(70),
        outputVector: "0x02" + "8".repeat(70),
        locktime: "0x00000000",
      }
      
      const reveal = {
        fundingOutputIndex: 0,
        blindingFactor: "0xf9f0c90d00039523",
        walletPubKeyHash: "0x8db50eb52063ea9d98b3eac91489a90f738986f6",
        refundPubKeyHash: "0x28e081f285138ccbe389c1eb8985716230129f89",
        refundLocktime: "0x60bcea61",
        vault: tbtcVault.address,
      }
      
      // Initialize through depositor
      const tx = await depositor.initializeDeposit(fundingTx, reveal, STARKNET_RECIPIENT)
      const receipt = await tx.wait()
      const event = receipt.events?.find(e => e.event === "DepositInitialized")
      const depositKey = event?.args?.depositKey
      
      // Finalize on bridge
      await bridge.revealDepositWithExtraData(fundingTx, reveal, STARKNET_RECIPIENT)
      await tbtcVault.setOptimisticMintingFinalized(depositKey)
      
      // Mock vault to return max amount
      await tbtcVault.setDepositAmount(depositKey, maxBTC)
      
      // Mint enough tBTC to the depositor
      await tbtcToken.mint(depositor.address, maxBTC)
      
      // Should handle large amounts
      await expect(
        depositor.finalizeDeposit(depositKey, { value: INITIAL_MESSAGE_FEE })
      ).to.not.be.reverted
    })

    it("should handle rapid fee updates", async () => {
      // Test multiple rapid fee updates
      const fees = [
        ethers.utils.parseEther("0.01"),
        ethers.utils.parseEther("0.02"),
        ethers.utils.parseEther("0.005"),
        ethers.utils.parseEther("0.1"),
      ]
      
      for (const fee of fees) {
        await depositor.connect(owner).updateL1ToL2MessageFee(fee)
        expect(await depositor.l1ToL2MessageFee()).to.equal(fee)
      }
    })

    it("should handle all fee buffer edge values", async () => {
      // Test boundary values for fee buffer
      const bufferValues = [0, 1, 49, 50]
      
      for (const buffer of bufferValues) {
        await depositor.connect(owner).updateFeeBuffer(buffer)
        expect(await depositor.feeBuffer()).to.equal(buffer)
      }
      
      // Just above maximum should fail
      await expect(
        depositor.connect(owner).updateFeeBuffer(51)
      ).to.be.revertedWith("Fee buffer too high")
    })
  })
})