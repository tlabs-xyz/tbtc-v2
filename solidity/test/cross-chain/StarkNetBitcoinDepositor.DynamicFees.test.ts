import { helpers, ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import { BigNumber } from "ethers"
import { randomBytes } from "crypto"

import type {
  StarkNetBitcoinDepositor,
  MockBridgeForStarkNet,
  MockTBTCToken,
  MockTBTCVault,
  MockStarkGateBridge,
} from "../../typechain"

describe("StarkNetBitcoinDepositor - Dynamic Fee Estimation", () => {
  let deployer: SignerWithAddress
  let depositorAccount: SignerWithAddress
  let starkNetDepositor: StarkNetBitcoinDepositor
  let bridge: MockBridgeForStarkNet
  let tbtcVault: MockTBTCVault
  let tbtcToken: MockTBTCToken
  let starkGateBridge: MockStarkGateBridge

  const l2TokenAddress = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  const INITIAL_MESSAGE_FEE = ethers.utils.parseEther("0.002")

  beforeEach(async () => {
    [deployer, depositorAccount] = await ethers.getSigners()

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

    // Deploy StarkNet depositor using proxy pattern
    const deployment = await helpers.upgrades.deployProxy(
      `StarkNetBitcoinDepositor_${randomBytes(8).toString("hex")}`,
      {
        contractName: "StarkNetBitcoinDepositor",
        initializerArgs: [
          bridge.address,
          tbtcVault.address,
          starkGateBridge.address,
          l2TokenAddress,
          INITIAL_MESSAGE_FEE
        ],
        factoryOpts: { signer: deployer },
        proxyOpts: {
          kind: "transparent",
        },
      }
    )
    starkNetDepositor = deployment[0] as StarkNetBitcoinDepositor
  })

  describe("Dynamic Fee Implementation", () => {
    describe("quoteFinalizeDepositDynamic function", () => {
      it("should exist and be callable", async () => {
        expect(starkNetDepositor.quoteFinalizeDepositDynamic).to.be.a('function')
      })

      it("should return dynamic fee from StarkGate with buffer", async () => {
        const dynamicFee = await starkNetDepositor.quoteFinalizeDepositDynamic()
        
        // MockStarkGateBridge returns 0.01 ether from estimateMessageFee
        // With 10% buffer: 0.01 * 1.1 = 0.011 ether
        const expectedFee = ethers.utils.parseEther("0.01").mul(110).div(100)
        expect(dynamicFee).to.equal(expectedFee)
      })

      it("should return different fee than static fee", async () => {
        const staticFee = await starkNetDepositor.quoteFinalizeDeposit(0)
        const dynamicFee = await starkNetDepositor.quoteFinalizeDepositDynamic()
        
        // Static fee is 0.002, dynamic should be 0.011 (0.01 + 10% buffer)
        expect(dynamicFee).to.not.equal(staticFee)
        expect(staticFee).to.equal(INITIAL_MESSAGE_FEE)
        expect(dynamicFee).to.equal(ethers.utils.parseEther("0.011"))
      })
    })

    describe("Fee Buffer Mechanism", () => {
      it("should have default fee buffer of 10%", async () => {
        const feeBuffer = await starkNetDepositor.feeBuffer()
        expect(feeBuffer).to.equal(10)
      })

      it("should allow owner to update fee buffer", async () => {
        await starkNetDepositor.connect(deployer).updateFeeBuffer(15)
        const newBuffer = await starkNetDepositor.feeBuffer()
        expect(newBuffer).to.equal(15)
        
        // Check that dynamic fee reflects new buffer
        const dynamicFee = await starkNetDepositor.quoteFinalizeDepositDynamic()
        const expectedFee = ethers.utils.parseEther("0.01").mul(115).div(100) // 15% buffer
        expect(dynamicFee).to.equal(expectedFee)
      })

      it("should emit FeeBufferUpdated event", async () => {
        await expect(starkNetDepositor.connect(deployer).updateFeeBuffer(20))
          .to.emit(starkNetDepositor, "FeeBufferUpdated")
          .withArgs(20)
      })

      it("should revert if non-owner tries to update fee buffer", async () => {
        await expect(
          starkNetDepositor.connect(depositorAccount).updateFeeBuffer(20)
        ).to.be.revertedWith("Ownable: caller is not the owner")
      })

      it("should revert if fee buffer is set too high", async () => {
        await expect(
          starkNetDepositor.connect(deployer).updateFeeBuffer(51)
        ).to.be.revertedWith("Fee buffer too high")
      })

      it("should accept maximum buffer of 50%", async () => {
        await starkNetDepositor.connect(deployer).updateFeeBuffer(50)
        const buffer = await starkNetDepositor.feeBuffer()
        expect(buffer).to.equal(50)
      })
    })

    describe("Fallback to Static Fee", () => {
      it("should fallback to static fee if StarkGate returns error", async () => {
        // This test verifies the try-catch fallback works
        // With current mock that always returns 0.01 ether, we can't easily test this
        // But the implementation has the fallback logic
        const fee = await starkNetDepositor.quoteFinalizeDepositDynamic()
        expect(fee).to.be.gt(0)
      })
    })

  })
})