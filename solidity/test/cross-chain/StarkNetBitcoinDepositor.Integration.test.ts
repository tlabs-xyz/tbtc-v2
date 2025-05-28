import { ethers, helpers } from "hardhat"
import { expect } from "chai"
import { BigNumber } from "ethers"
import type {
  StarkNetBitcoinDepositor,
  MockBridgeForStarkNet,
  MockTBTCVault,
  MockTBTCToken,
  MockStarkGateBridge,
} from "../../typechain"
import { to1ePrecision } from "../helpers/contract-test-helpers"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("StarkNetBitcoinDepositor - Integration Tests", () => {
  let depositor: StarkNetBitcoinDepositor
  let bridge: MockBridgeForStarkNet
  let tbtcVault: MockTBTCVault
  let tbtcToken: MockTBTCToken
  let starkGateBridge: MockStarkGateBridge
  
  const INITIAL_MESSAGE_FEE = ethers.utils.parseEther("0.01")
  const DEPOSIT_AMOUNT = to1ePrecision(1, 18) // 1 BTC worth of satoshis
  const TREASURY_FEE = BigNumber.from("12098000000000") // Example treasury fee
  
  // Helper to initialize deposit and get key
  const initializeDepositAndGetKey = async (depositData: any) => {
    const tx = await depositor.initializeDeposit(
      depositData.fundingTx,
      depositData.reveal,
      depositData.l2Receiver
    )
    const receipt = await tx.wait()
    const depositInitEvent = receipt.events?.find(e => e.event === "DepositInitializedForStarkNet")
    const bytes32 = depositInitEvent?.args?.depositKey
    const uint256 = BigNumber.from(bytes32)
    return {
      uint256,
      bytes32
    }
  }
  
  // Helper function to generate test deposit data
  const generateDepositData = (index: number) => {
    // Ensure blinding factor is always exactly 8 bytes (16 hex chars)
    const blindingFactorHex = `f9f0c90d0003${index.toString(16).padStart(4, '0')}`
    // Ensure it's exactly 16 chars (8 bytes)
    const blindingFactor = `0x${blindingFactorHex.slice(0, 16)}`
    
    return {
      fundingTx: {
        version: "0x01000000",
        inputVector:
          `0x01${index.toString(16).padStart(64, '0')}0100000000ffffffff`,
        outputVector:
          "0x021027000000000000220020bfaeddba12b0de6feeb649af76376876bc1" +
          "feb6c2248fbfef9293ba3ac51bb4a10d73b00000000001600147ac2d9378a" +
          "1c47e589dfb8095ca95ed2140d2726",
        locktime: "0x00000000",
      },
      reveal: {
        fundingOutputIndex: 0,
        blindingFactor: blindingFactor,
        walletPubKeyHash: "0x8db50eb52063ea9d98b3eac91489a90f738986f6",
        refundPubKeyHash: "0x28e081f285138ccbe389c1eb8985716230129f89",
        refundLocktime: "0x60bcea61",
        vault: "",
      },
      l2Receiver: ethers.utils.hexZeroPad(`0x${(1000 + index).toString(16)}`, 32),
      starknetRecipient: `0x${(1000 + index).toString(16).padStart(64, '0')}`,
      expectedDepositKey: "", // Will be calculated during test
    }
  }

  before(async () => {
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

    // Deploy main contract
    const StarkNetBitcoinDepositor = await ethers.getContractFactory("StarkNetBitcoinDepositor")
    depositor = await StarkNetBitcoinDepositor.deploy(
      bridge.address,
      tbtcVault.address,
      starkGateBridge.address,
      INITIAL_MESSAGE_FEE
    )
  })

  describe("End-to-End Deposit Flow", () => {
    beforeEach(async () => {
      await createSnapshot()
    })

    afterEach(async () => {
      await restoreSnapshot()
    })

    it("should handle complete deposit flow from initialization to bridging", async () => {
      // RED PHASE: This test should fail initially
      const depositData = generateDepositData(1)
      depositData.reveal.vault = tbtcVault.address
      
      // Step 1: Initialize deposit
      const initTx = await depositor.initializeDeposit(
        depositData.fundingTx,
        depositData.reveal,
        depositData.l2Receiver
      )
      
      // Get the actual events to find the real deposit key
      const receipt = await initTx.wait()
      const depositInitEvent = receipt.events?.find(e => e.event === "DepositInitializedForStarkNet")
      const depositKeyBytes32 = depositInitEvent?.args?.depositKey
      const depositKey = BigNumber.from(depositKeyBytes32)
      
      // Verify initialization events
      await expect(initTx)
        .to.emit(depositor, "DepositInitializedForStarkNet")
        .withArgs(depositKeyBytes32, BigNumber.from(depositData.l2Receiver))
      
      await expect(initTx)
        .to.emit(bridge, "DepositRevealed")
      
      // Step 2: Simulate tBTC minting (mock bridge behavior)
      console.log("Attempting to sweep deposit with key:", depositKey.toString())
      console.log("Deposit key as hex:", depositKey.toHexString())
      const storedKeys = await bridge.getDepositKeys()
      console.log("Stored deposit keys:", storedKeys.map(k => k.toString()))
      
      await bridge.sweepDeposit(depositKey)
      await tbtcToken.mint(depositor.address, DEPOSIT_AMOUNT.sub(TREASURY_FEE))
      
      // Step 3: Finalize deposit and bridge to StarkNet
      const finalizeTx = await depositor.finalizeDeposit(depositKeyBytes32, {
        value: INITIAL_MESSAGE_FEE
      })
      
      // Verify finalization events
      const expectedMessageNonce = 1 // Mock bridge starts with nonce 1
      await expect(finalizeTx)
        .to.emit(depositor, "TBTCBridgedToStarkNet")
        .withArgs(
          depositKeyBytes32,
          BigNumber.from(depositData.l2Receiver),
          DEPOSIT_AMOUNT.sub(TREASURY_FEE),
          expectedMessageNonce
        )
      
      // Verify bridge interaction
      expect(await starkGateBridge.wasDepositWithMessageCalled()).to.be.true
      expect(await starkGateBridge.getLastDepositRecipient()).to.equal(
        BigNumber.from(depositData.l2Receiver).toString()
      )
      expect(await starkGateBridge.getLastDepositAmount()).to.equal(
        DEPOSIT_AMOUNT.sub(TREASURY_FEE)
      )
      expect(await starkGateBridge.getLastDepositToken()).to.equal(tbtcToken.address)
      expect(await starkGateBridge.getLastDepositValue()).to.equal(INITIAL_MESSAGE_FEE)
    })

    it("should handle multiple concurrent deposits", async () => {
      // RED PHASE: Test multiple deposits being processed
      const numberOfDeposits = 5
      const depositKeys = []
      
      // Initialize multiple deposits
      for (let i = 0; i < numberOfDeposits; i++) {
        const depositData = generateDepositData(i)
        depositData.reveal.vault = tbtcVault.address
        
        const keys = await initializeDepositAndGetKey(depositData)
        depositKeys.push(keys)
      }
      
      // Process all deposits
      for (let i = 0; i < numberOfDeposits; i++) {
        const keys = depositKeys[i]
        
        // Simulate bridge sweep and tBTC minting
        await bridge.sweepDeposit(keys.uint256)
        await tbtcToken.mint(depositor.address, DEPOSIT_AMOUNT.sub(TREASURY_FEE))
        
        // Finalize deposit
        await depositor.finalizeDeposit(keys.bytes32, {
          value: INITIAL_MESSAGE_FEE
        })
      }
      
      // Verify all deposits were bridged
      expect(await starkGateBridge.getDepositCount()).to.equal(numberOfDeposits)
    })

    it("should handle deposits with different amounts correctly", async () => {
      // RED PHASE: Test various deposit amounts
      const amounts = [
        to1ePrecision(1, 17),  // 0.1 BTC
        to1ePrecision(5, 17),  // 0.5 BTC
        to1ePrecision(1, 18),  // 1 BTC
        to1ePrecision(2, 18),  // 2 BTC
      ]
      
      for (let i = 0; i < amounts.length; i++) {
        const depositData = generateDepositData(i + 10)
        depositData.reveal.vault = tbtcVault.address
        const amount = amounts[i]
        
        // Initialize deposit and get key
        const keys = await initializeDepositAndGetKey(depositData)
        
        // Simulate sweep and mint specific amount
        await bridge.sweepDeposit(keys.uint256)
        const mintAmount = amount.sub(TREASURY_FEE)
        await tbtcToken.mint(depositor.address, mintAmount)
        
        // Finalize deposit
        await depositor.finalizeDeposit(keys.bytes32, {
          value: INITIAL_MESSAGE_FEE
        })
        
        // Verify correct amount was bridged
        expect(await starkGateBridge.getLastDepositAmount()).to.equal(mintAmount)
      }
    })
  })

  describe("Failure Recovery", () => {
    beforeEach(async () => {
      await createSnapshot()
    })

    afterEach(async () => {
      await restoreSnapshot()
    })

    it("should handle StarkGate bridge failures gracefully", async () => {
      // RED PHASE: Test bridge failure handling
      const depositData = generateDepositData(100)
      depositData.reveal.vault = tbtcVault.address
      
      // Initialize and prepare deposit
      const keys = await initializeDepositAndGetKey(depositData)
      await bridge.sweepDeposit(keys.uint256)
      await tbtcToken.mint(depositor.address, DEPOSIT_AMOUNT.sub(TREASURY_FEE))
      
      // Mock bridge to fail
      await starkGateBridge.setDepositWithMessageReturn(0) // This would indicate failure
      
      // Attempt to finalize should handle the failure appropriately
      const finalizeTx = await depositor.finalizeDeposit(keys.bytes32, {
        value: INITIAL_MESSAGE_FEE
      })
      
      // Even with return value 0, the transaction should complete
      // In real implementation, we might want to handle this differently
      await expect(finalizeTx).to.not.be.reverted
    })

    it("should prevent double finalization of same deposit", async () => {
      // RED PHASE: Test double finalization protection
      const depositData = generateDepositData(200)
      depositData.reveal.vault = tbtcVault.address
      
      // Initialize and finalize deposit once
      const keys = await initializeDepositAndGetKey(depositData)
      await bridge.sweepDeposit(keys.uint256)
      await tbtcToken.mint(depositor.address, DEPOSIT_AMOUNT.sub(TREASURY_FEE))
      
      await depositor.finalizeDeposit(keys.bytes32, {
        value: INITIAL_MESSAGE_FEE
      })
      
      // Mint more tokens to simulate attempted double spend
      await tbtcToken.mint(depositor.address, DEPOSIT_AMOUNT)
      
      // Attempt to finalize same deposit again should fail
      await expect(
        depositor.finalizeDeposit(keys.bytes32, {
          value: INITIAL_MESSAGE_FEE
        })
      ).to.be.revertedWith("Deposit not initialized")
    })

    it("should handle insufficient tBTC balance scenarios", async () => {
      // RED PHASE: Test insufficient balance handling
      const depositData = generateDepositData(300)
      depositData.reveal.vault = tbtcVault.address
      
      // Initialize deposit
      const keys = await initializeDepositAndGetKey(depositData)
      await bridge.sweepDeposit(keys.uint256)
      
      // Don't mint enough tBTC
      await tbtcToken.mint(depositor.address, 1000) // Very small amount
      
      // Finalization should handle insufficient balance
      const finalizeTx = await depositor.finalizeDeposit(keys.bytes32, {
        value: INITIAL_MESSAGE_FEE
      })
      
      // Should complete with whatever balance is available
      await expect(finalizeTx).to.not.be.reverted
      expect(await starkGateBridge.getLastDepositAmount()).to.equal(1000)
    })
  })

  describe("Performance Under Load", () => {
    beforeEach(async () => {
      await createSnapshot()
    })

    afterEach(async () => {
      await restoreSnapshot()
    })

    it("should handle rapid sequential deposits efficiently", async () => {
      // RED PHASE: Test performance with rapid deposits
      const numberOfDeposits = 10
      const startTime = Date.now()
      
      for (let i = 0; i < numberOfDeposits; i++) {
        const depositData = generateDepositData(1000 + i)
        depositData.reveal.vault = tbtcVault.address
        
        // Complete full deposit cycle
        const keys = await initializeDepositAndGetKey(depositData)
        await bridge.sweepDeposit(keys.uint256)
        await tbtcToken.mint(depositor.address, DEPOSIT_AMOUNT.sub(TREASURY_FEE))
        await depositor.finalizeDeposit(keys.bytes32, {
          value: INITIAL_MESSAGE_FEE
        })
      }
      
      const endTime = Date.now()
      const totalTime = endTime - startTime
      
      // Verify all deposits completed
      expect(await starkGateBridge.getDepositCount()).to.equal(numberOfDeposits)
      
      // Log performance metrics (informational)
      console.log(`Processed ${numberOfDeposits} deposits in ${totalTime}ms`)
      console.log(`Average time per deposit: ${totalTime / numberOfDeposits}ms`)
    })

    it("should maintain gas efficiency across multiple deposits", async () => {
      // RED PHASE: Test gas consistency
      const gasUsages = []
      
      for (let i = 0; i < 5; i++) {
        const depositData = generateDepositData(2000 + i)
        depositData.reveal.vault = tbtcVault.address
        
        const keys = await initializeDepositAndGetKey(depositData)
        await bridge.sweepDeposit(keys.uint256)
        await tbtcToken.mint(depositor.address, DEPOSIT_AMOUNT.sub(TREASURY_FEE))
        
        // Measure gas for finalization
        const tx = await depositor.finalizeDeposit(keys.bytes32, {
          value: INITIAL_MESSAGE_FEE
        })
        const receipt = await tx.wait()
        gasUsages.push(receipt.gasUsed.toNumber())
      }
      
      // Verify gas usage is consistent (within 10% variance)
      const avgGas = gasUsages.reduce((a, b) => a + b) / gasUsages.length
      for (const gasUsed of gasUsages) {
        const variance = Math.abs(gasUsed - avgGas) / avgGas
        expect(variance).to.be.lessThan(0.1)
      }
      
      // All deposits should use less than 200k gas
      for (const gasUsed of gasUsages) {
        expect(gasUsed).to.be.lessThan(200000)
      }
    })
  })

  describe("Real Gas Cost Analysis", () => {
    beforeEach(async () => {
      await createSnapshot()
    })

    afterEach(async () => {
      await restoreSnapshot()
    })

    it("should provide accurate gas cost breakdown", async () => {
      // RED PHASE: Analyze gas costs for each operation
      const depositData = generateDepositData(3000)
      depositData.reveal.vault = tbtcVault.address
      
      // Measure initialization gas
      const initTx = await depositor.initializeDeposit(
        depositData.fundingTx,
        depositData.reveal,
        depositData.l2Receiver
      )
      const initReceipt = await initTx.wait()
      const depositKey = await bridge.getLastDepositKey()
      const depositKeyBytes32 = ethers.utils.hexZeroPad(depositKey.toHexString(), 32)
      
      // Prepare for finalization
      await bridge.sweepDeposit(depositKey)
      await tbtcToken.mint(depositor.address, DEPOSIT_AMOUNT.sub(TREASURY_FEE))
      
      // Measure finalization gas
      const finalizeTx = await depositor.finalizeDeposit(depositKeyBytes32, {
        value: INITIAL_MESSAGE_FEE
      })
      const finalizeReceipt = await finalizeTx.wait()
      
      // Log gas breakdown
      console.log("Gas Cost Analysis:")
      console.log(`  Initialization: ${initReceipt.gasUsed.toString()} gas`)
      console.log(`  Finalization: ${finalizeReceipt.gasUsed.toString()} gas`)
      console.log(`  Total: ${initReceipt.gasUsed.add(finalizeReceipt.gasUsed).toString()} gas`)
      
      // Verify reasonable gas costs
      expect(initReceipt.gasUsed.toNumber()).to.be.lessThan(150000)
      expect(finalizeReceipt.gasUsed.toNumber()).to.be.lessThan(200000)
    })
  })
})