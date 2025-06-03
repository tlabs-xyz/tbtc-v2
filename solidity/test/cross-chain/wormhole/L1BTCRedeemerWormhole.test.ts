import { ethers, getUnnamedAccounts, helpers, waffle } from "hardhat"
import { randomBytes } from "crypto"
import chai, { expect } from "chai"
import { FakeContract, smock } from "@defi-wonderland/smock"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber, ContractTransaction } from "ethers"
import {
  IBridge,
  IWormholeTokenBridge,
  L1BTCRedeemerWormhole,
  MockBank, // Using the MockBank we created
  ReimbursementPool,
  TestERC20, // For tbtcToken
} from "../../../typechain"
// Importing UTXOStruct directly from its defining type file
import { UTXOStruct } from "../../../typechain/L1BTCRedeemerWormhole";

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot
const { lastBlockTime } = helpers.time

// Arbitrary values
const l1ChainId = 10 // Example L1 chain ID for Wormhole context if needed by mocks

describe("L1BTCRedeemerWormhole", () => {
  const contractsFixture = async () => {
    const { deployer, governance } = await helpers.signers.getNamedSigners()
    const signers = await ethers.getSigners()
    const relayer = signers[0]
    const user = signers[1]

    const bridge = await smock.fake<IBridge>("IBridge")
    const tbtcToken = await (
      await ethers.getContractFactory("TestERC20")
    ).deploy()
    await tbtcToken.deployed()

    const MockBankFactory = await ethers.getContractFactory("MockBank")
    const bank = (await MockBankFactory.deploy()) as MockBank // Deploy our MockBank
    await bank.deployed()

    const wormholeTokenBridge = await smock.fake<IWormholeTokenBridge>(
      "IWormholeTokenBridge"
    )
    const reimbursementPool = await smock.fake<ReimbursementPool>(
      "ReimbursementPool"
    )

    const deployment = await helpers.upgrades.deployProxy(
      `L1BTCRedeemerWormhole_${randomBytes(8).toString("hex")}`,
      {
        contractName: "L1BTCRedeemerWormhole",
        initializerArgs: [
          bridge.address,
          wormholeTokenBridge.address,
          tbtcToken.address,
          bank.address,
        ],
        factoryOpts: { signer: deployer },
        proxyOpts: {
          kind: "transparent",
        },
      }
    )
    const l1BtcRedeemer = deployment[0] as L1BTCRedeemerWormhole

    await l1BtcRedeemer.connect(deployer).transferOwnership(governance.address)

    // Initialize Reimbursable if L1BTCRedeemerWormhole needs it directly
    // For now, assuming Reimbursable setup like `updateReimbursementPool` is handled by tests.

    return {
      deployer,
      governance,
      relayer,
      user,
      bridge,
      tbtcToken,
      bank,
      wormholeTokenBridge,
      reimbursementPool,
      l1BtcRedeemer,
    }
  }

  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let relayer: SignerWithAddress
  let user: SignerWithAddress

  let bridge: FakeContract<IBridge>
  let tbtcToken: TestERC20
  let bank: MockBank
  let wormholeTokenBridge: FakeContract<IWormholeTokenBridge>
  let reimbursementPool: FakeContract<ReimbursementPool>
  let l1BtcRedeemer: L1BTCRedeemerWormhole

  // Example UTXO for testing
  const exampleMainUtxo: UTXOStruct = {
    txHash: "0x" + "1".repeat(64),
    txOutputIndex: 0,
    txOutputValue: ethers.BigNumber.from(50 * 1e8), // 50 BTC in satoshis
  }
  const exampleWalletPkh = "0x" + "a".repeat(40)
  const exampleRedemptionOutputScript = "0x76a914" + "c".repeat(40) + "88ac" // P2PKH
  const exampleRedemptionOutputScriptBytes = ethers.utils.arrayify(exampleRedemptionOutputScript);
  const exampleEncodedVm = "0x010203" // Dummy VAA

  beforeEach(async () => {
    ({
      deployer,
      governance,
      relayer,
      user,
      bridge,
      tbtcToken,
      bank,
      wormholeTokenBridge,
      reimbursementPool,
      l1BtcRedeemer,
    } = await waffle.loadFixture(contractsFixture))
  })

  describe("initialization", () => {
    it("should set the bridge address", async () => {
      expect(await l1BtcRedeemer.thresholdBridge()).to.equal(bridge.address)
    })

    it("should set the tbtcToken address", async () => {
      expect(await l1BtcRedeemer.tbtcToken()).to.equal(tbtcToken.address)
    })

    it("should set the bank address", async () => {
      expect(await l1BtcRedeemer.bank()).to.equal(bank.address)
    })

    it("should set the wormholeTokenBridge address", async () => {
      expect(await l1BtcRedeemer.wormholeTokenBridge()).to.equal(
        wormholeTokenBridge.address
      )
    })

    it("should set default requestRedemptionGasOffset", async () => {
      expect(await l1BtcRedeemer.requestRedemptionGasOffset()).to.equal(60000)
    })

    it("should set owner to governance", async () => {
      // The fixture transfers ownership to governance after deployment by deployer
      expect(await l1BtcRedeemer.owner()).to.equal(governance.address)
    })
  })

  describe("updateGasOffsetParameters", () => {
    const newOffset = BigNumber.from(12345)
    context("when the caller is not the owner", () => {
      it("should revert", async () => {
        await expect(
          l1BtcRedeemer.connect(relayer).updateGasOffsetParameters(newOffset)
        ).to.be.revertedWith("Ownable: caller is not the owner")
      })
    })

    context("when the caller is the owner", () => {
      let tx: ContractTransaction
      beforeEach(async () => {
        await createSnapshot()
        tx = await l1BtcRedeemer
          .connect(governance)
          .updateGasOffsetParameters(newOffset)
      })

      afterEach(async () => {
        await restoreSnapshot()
      })

      it("should update the requestRedemptionGasOffset", async () => {
        expect(await l1BtcRedeemer.requestRedemptionGasOffset()).to.equal(
          newOffset
        )
      })

      it("should emit GasOffsetParametersUpdated event", async () => {
        await expect(tx)
          .to.emit(l1BtcRedeemer, "GasOffsetParametersUpdated")
          .withArgs(newOffset)
      })
    })
  })

  describe("updateReimbursementAuthorization", () => {
    context("when the caller is not the owner", () => {
      it("should revert", async () => {
        await expect(
          l1BtcRedeemer
            .connect(relayer)
            .updateReimbursementAuthorization(relayer.address, true)
        ).to.be.revertedWith("Ownable: caller is not the owner")
      })
    })

    context("when the caller is the owner", () => {
      let tx: ContractTransaction
      let targetAddress: string
      const authorizationStatus = true

      beforeEach(async () => {
        targetAddress = relayer.address
        await createSnapshot()
        tx = await l1BtcRedeemer
          .connect(governance)
          .updateReimbursementAuthorization(
            targetAddress,
            authorizationStatus
          )
      })

      afterEach(async () => {
        await restoreSnapshot()
      })

      it("should update reimbursementAuthorizations mapping", async () => {
        expect(
          await l1BtcRedeemer.reimbursementAuthorizations(targetAddress)
        ).to.equal(authorizationStatus)
      })

      it("should emit ReimbursementAuthorizationUpdated event", async () => {
        await expect(tx)
          .to.emit(l1BtcRedeemer, "ReimbursementAuthorizationUpdated")
          .withArgs(targetAddress, authorizationStatus)
      })
    })
  })

  describe("requestRedemption", () => {
    const SATOSHI_MULTIPLIER = BigNumber.from(10).pow(10)
    const amountToRedeemSat = BigNumber.from(1 * 1e8) // 1 BTC in satoshis
    const amountToRedeemTbtc = amountToRedeemSat.mul(SATOSHI_MULTIPLIER) // 1 tBTC (1e18)

    // Mocked values from AbstractBTCRedeemer._requestRedemption
    const expectedRedemptionKey = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("test-redemption-key")
    )
    // Example: (1 BTC sat - 0.5% treasury fee sat) - txMaxFee sat = (100,000,000 - 500,000) - 10,000 = 99,490,000 sat
    // This amount is then multiplied by SATOSHI_MULTIPLIER (10**10) in the contract.
    const calculatedTbtcAmountFromBridge = BigNumber.from(99490000).mul(
      SATOSHI_MULTIPLIER
    )

    beforeEach(async () => {
      // Reset mocks before each test in this describe block
      bridge.requestRedemption.reset()
      wormholeTokenBridge.completeTransferWithPayload.reset()
      wormholeTokenBridge.parseTransferWithPayload.reset()
      reimbursementPool.refund.reset()

      // Configure default success behavior for mocks
      wormholeTokenBridge.completeTransferWithPayload
        .whenCalledWith(exampleEncodedVm)
        .returns(exampleRedemptionOutputScriptBytes) // Use Uint8Array

      wormholeTokenBridge.parseTransferWithPayload
        .whenCalledWith(exampleRedemptionOutputScriptBytes) // Expect Uint8Array
        .returns({ // Mocked TransferWithPayload struct
          amount: amountToRedeemTbtc, // This is the amount transferred via wormhole
          sourceToken: ethers.constants.AddressZero, // Not strictly checked by L1BTCRedeemer contract
          sourceChain: 0,
          targetAddress: l1BtcRedeemer.address,
          targetChain: 0,
          payload: exampleRedemptionOutputScriptBytes, // Return Uint8Array
        })

      // Mock the internal _requestRedemption call (via IBridge and IBank)
      bridge.requestRedemption
        .whenCalledWith(
          exampleWalletPkh,
          exampleMainUtxo,
          exampleRedemptionOutputScript,
          amountToRedeemSat
        )
        .returns([expectedRedemptionKey, calculatedTbtcAmountFromBridge]) // [redemptionKey, tbtcAmount]

      // No explicit mock for bank.increaseBalanceAllowance as it's a real contract call
      // bank.increaseBalanceAllowance
      //   .whenCalledWith(bridge.address, amountToRedeemSat)
      //   .returns() // Removed: bank is a real contract, not a smock fake

      // Provide some tBTC to the L1BTCRedeemer contract to simulate receiving it from Wormhole
      await tbtcToken.mint(l1BtcRedeemer.address, amountToRedeemTbtc.mul(2)) // Mint more than needed
    })

    context("when redemption is successful", () => {
      let tx: ContractTransaction
      beforeEach(async () => {
        await createSnapshot() // Snapshot for this specific context
        tx = await l1BtcRedeemer
          .connect(relayer)
          .requestRedemption(
            exampleWalletPkh,
            exampleMainUtxo,
            exampleEncodedVm
          )
      })

      afterEach(async () => {
        await restoreSnapshot() // Restore snapshot for this specific context
      })

      it("should complete transfer with WormholeTokenBridge", async () => {
        expect(wormholeTokenBridge.completeTransferWithPayload).to.have.been
          .calledOnceWith(exampleEncodedVm)
      })

      it("should parse transfer payload from WormholeTokenBridge", async () => {
        expect(wormholeTokenBridge.parseTransferWithPayload).to.have.been
          .calledOnceWith(exampleRedemptionOutputScriptBytes) // Expect Uint8Array
      })

      it("should request redemption from the tBTC Bridge", async () => {
        expect(bridge.requestRedemption).to.have.been.calledOnceWith(
          exampleWalletPkh,
          exampleMainUtxo,
          exampleRedemptionOutputScript,
          amountToRedeemSat
        )
      })

      it("should increase bank allowance for the bridge", async () => {
        // We can't directly check smock's .calledOnceWith on the real MockBank instance in this way.
        // However, the successful call to bridge.requestRedemption implies this was successful
        // if the MockBank's increaseBalanceAllowance is implemented correctly (which it is).
        // For a more direct check, MockBank would need to emit an event or store last call data.
        // For now, we rely on the overall success of the redemption request.
        const allowance = await bank.getAllowance(l1BtcRedeemer.address, bridge.address)
        expect(allowance).to.equal(amountToRedeemSat)
      })

      it("should emit RedemptionRequested event", async () => {
        await expect(tx)
          .to.emit(l1BtcRedeemer, "RedemptionRequested")
          .withArgs(
            expectedRedemptionKey,
            exampleWalletPkh,
            // ethers V5 struct matching is a bit tricky, checking specific fields instead of deep equals
            (utxo: any) => utxo.txHash === exampleMainUtxo.txHash && utxo.txOutputIndex === exampleMainUtxo.txOutputIndex,
            exampleRedemptionOutputScript,
            amountToRedeemTbtc // The amount here is the tBTC value (1e18) from wormhole
          )
      })

      it("should not call reimbursement pool if not configured", async () => {
        expect(reimbursementPool.refund).to.not.have.been.called
      })
    })

    context("when WormholeTokenBridge.completeTransferWithPayload reverts", () => {
      beforeEach(async () => {
        wormholeTokenBridge.completeTransferWithPayload
          .whenCalledWith(exampleEncodedVm)
          .reverts("Wormhole: VAA already processed")
      })

      it("should revert", async () => {
        await expect(
          l1BtcRedeemer
            .connect(relayer)
            .requestRedemption(
              exampleWalletPkh,
              exampleMainUtxo,
              exampleEncodedVm
            )
        ).to.be.revertedWith("Wormhole: VAA already processed")
      })
    })

    context("when tBTC Bridge.requestRedemption reverts", () => {
      beforeEach(async () => {
        bridge.requestRedemption
          .whenCalledWith(
            exampleWalletPkh,
            exampleMainUtxo,
            exampleRedemptionOutputScript,
            amountToRedeemSat
          )
          .reverts("Bridge: Redemption already requested")
      })

      it("should revert", async () => {
        await expect(
          l1BtcRedeemer
            .connect(relayer)
            .requestRedemption(
              exampleWalletPkh,
              exampleMainUtxo,
              exampleEncodedVm
            )
        ).to.be.revertedWith("Bridge: Redemption already requested")
      })
    })
  })
}) 