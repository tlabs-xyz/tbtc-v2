import { ethers, getUnnamedAccounts, helpers, waffle } from "hardhat"
import { randomBytes } from "crypto"
import chai, { expect } from "chai"
import { FakeContract, smock } from "@defi-wonderland/smock"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber, ContractTransaction } from "ethers"
import {
  IL2WormholeGateway,
  L2TBTC,
  L2BTCRedeemerWormhole,
  TestERC20,
  TestBTCUtilsHelper,
} from "../../../typechain"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

// Returns hexString padded on the left with zeros to 32 bytes.
const toWormholeFormat = (address: string): string => {
  return ethers.utils.hexlify(ethers.utils.zeroPad(address, 32))
}

describe("L2BTCRedeemerWormhole", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let user: SignerWithAddress

  let l2BtcRedeemer: L2BTCRedeemerWormhole
  let tbtc: L2TBTC
  let gateway: FakeContract<IL2WormholeGateway>
  let testBTCUtilsHelper: TestBTCUtilsHelper

  const l1ChainId = 1
  const l1BtcRedeemerWormholeAddress =
    "0x0000000000000000000000000000000000000001"

  const exampleAmount = ethers.utils.parseUnits("1", 18)
  // Use a raw 25-byte P2PKH script structure, consistent with how L2BTCRedeemerWormhole uses BTCUtils.extractHashAt
  // prefix with 0x19 (25 bytes length)
  const exampleRedeemerOutputScript = "0x1976a9140102030405060708090a0b0c0d0e0f101112131488ac";
  const exampleNonce = 123

  const contractsFixture = async () => {
    const _signers = await ethers.getSigners()
    const _deployer = _signers[0]
    const _user = _signers[1]
    const _namedSigners = await helpers.signers.getNamedSigners()
    const _governance = _namedSigners.governance || _signers[2]

    const _gateway = await smock.fake<IL2WormholeGateway>("IL2WormholeGateway")

    // Deploy TestBTCUtilsHelper
    const TestBTCUtilsHelperFactory = await ethers.getContractFactory(
      "TestBTCUtilsHelper",
      _deployer
    )
    const _testBTCUtilsHelper =
      (await TestBTCUtilsHelperFactory.deploy()) as TestBTCUtilsHelper
    await _testBTCUtilsHelper.deployed()

    // Deploy L2TBTC using the project's deployProxy helper structure
    const tbtcDeployment = await helpers.upgrades.deployProxy(
      `L2TBTC_${randomBytes(8).toString("hex")}`,
      {
        contractName: "L2TBTC",
        initializerArgs: ["L2 TBTC", "L2TBTC"],
        factoryOpts: { signer: _deployer },
        proxyOpts: { kind: "transparent" },
      }
    )
    const _tbtc = tbtcDeployment[0] as L2TBTC

    // The deployer of L2TBTC is its owner. The owner needs to add itself as a minter.
    await _tbtc.connect(_deployer).addMinter(_deployer.address)

    // Deploy L2BTCRedeemerWormhole using the project's deployProxy helper structure
    const l2RedeemerDeployment = await helpers.upgrades.deployProxy(
      `L2BTCRedeemerWormhole_${randomBytes(8).toString("hex")}`,
      {
        contractName: "L2BTCRedeemerWormhole",
        initializerArgs: [
          _tbtc.address,
          _gateway.address,
          toWormholeFormat(l1BtcRedeemerWormholeAddress),
        ],
        factoryOpts: { signer: _deployer },
        proxyOpts: { kind: "transparent" },
      }
    )
    const _l2BtcRedeemer = l2RedeemerDeployment[0] as L2BTCRedeemerWormhole

    const currentOwner = await _l2BtcRedeemer.owner()
    console.log(`L2BTCRedeemerWormhole owner after deploy: ${currentOwner}, deployer: ${_deployer.address}`)

    // Transfer ownership from the deployer (initial owner) to governance
    await _l2BtcRedeemer.connect(_deployer).transferOwnership(_governance.address)

    return {
      deployer: _deployer,
      governance: _governance,
      user: _user,
      l2BtcRedeemer: _l2BtcRedeemer,
      tbtc: _tbtc,
      gateway: _gateway,
      testBTCUtilsHelper: _testBTCUtilsHelper,
      l1BtcRedeemerWormholeAddress,
      l1ChainId,
    }
  }

  before(async () => {
    await createSnapshot()
      ; ({
        deployer,
        governance,
        user,
        l2BtcRedeemer,
        tbtc,
        gateway,
        testBTCUtilsHelper,
      } = await waffle.loadFixture(contractsFixture))

    // Debug BTCUtils.extractHashAt
    const payload = await testBTCUtilsHelper.getScriptPayload(
      exampleRedeemerOutputScript
    )
    console.log(
      `[DEBUG] BTCUtils.extractHashAt payload length for '${exampleRedeemerOutputScript}': ${ethers.utils.arrayify(payload).length
      }`
    )
    console.log(
      `[DEBUG] BTCUtils.extractHashAt payload for '${exampleRedeemerOutputScript}': ${payload}`
    )
  })

  describe("initialization", () => {
    it("should set the tBTC token address", async () => {
      expect(await l2BtcRedeemer.tbtc()).to.equal(tbtc.address)
    })

    it("should set the gateway address", async () => {
      expect(await l2BtcRedeemer.gateway()).to.equal(gateway.address)
    })

    it("should set the L1 BTC Redeemer Wormhole address", async () => {
      expect(await l2BtcRedeemer.l1BtcRedeemerWormholeAddress()).to.equal(
        toWormholeFormat(l1BtcRedeemerWormholeAddress)
      )
    })

    it("should set the default minimum redemption amount", async () => {
      expect(await l2BtcRedeemer.minimumRedemptionAmount()).to.equal(
        ethers.BigNumber.from("10000000000000000")
      )
    })

    it("should set the owner to governance", async () => {
      expect(await l2BtcRedeemer.owner()).to.equal(governance.address)
    })
  })

  describe("updateMinimumRedemptionAmount", () => {
    const newMinAmount = ethers.utils.parseUnits("0.05", 18)

    context("when the caller is not the owner", () => {
      it("should revert", async () => {
        await expect(
          l2BtcRedeemer.connect(user).updateMinimumRedemptionAmount(newMinAmount)
        ).to.be.revertedWith("Ownable: caller is not the owner")
      })
    })

    context("when the new minimum amount is zero", () => {
      it("should revert", async () => {
        await expect(
          l2BtcRedeemer
            .connect(governance)
            .updateMinimumRedemptionAmount(ethers.constants.Zero)
        ).to.be.revertedWith("Minimum redemption amount must not be 0")
      })
    })

    context("when the caller is the owner and amount is valid", () => {
      let tx: ContractTransaction
      before(async () => {
        await createSnapshot()
        tx = await l2BtcRedeemer
          .connect(governance)
          .updateMinimumRedemptionAmount(newMinAmount)
      })

      after(async () => {
        await restoreSnapshot()
      })

      it("should update the minimumRedemptionAmount", async () => {
        expect(await l2BtcRedeemer.minimumRedemptionAmount()).to.equal(
          newMinAmount
        )
      })

      it("should emit MinimumRedemptionAmountUpdated event", async () => {
        await expect(tx)
          .to.emit(l2BtcRedeemer, "MinimumRedemptionAmountUpdated")
          .withArgs(newMinAmount)
      })
    })
  })

  describe("requestRedemption", () => {
    const SATOSHI_MULTIPLIER_PRECISION = 10;
    const normalizedExampleAmount = exampleAmount.div(BigNumber.from(10).pow(18 - SATOSHI_MULTIPLIER_PRECISION))

    beforeEach(async () => {
      gateway.sendTbtcWithPayloadToEthereum.reset()
      await tbtc.connect(user).approve(l2BtcRedeemer.address, ethers.constants.MaxUint256)
      await tbtc.connect(deployer).mint(user.address, exampleAmount.mul(2))

      await l2BtcRedeemer.connect(governance).updateMinimumRedemptionAmount(ethers.utils.parseUnits("0.001", 18))
    })

    context("when redemption is successful", () => {
      let tx: ContractTransaction
      const expectedGatewaySequence = BigNumber.from(789)

      beforeEach(async () => {
        await createSnapshot()
        gateway.sendTbtcWithPayloadToEthereum
          .whenCalledWith(
            exampleAmount,
            toWormholeFormat(l1BtcRedeemerWormholeAddress),
            exampleNonce,
            exampleRedeemerOutputScript
          )
          .returns(expectedGatewaySequence)

        tx = await l2BtcRedeemer
          .connect(user)
          .requestRedemption(
            exampleAmount,
            exampleRedeemerOutputScript,
            exampleNonce
          )
      })

      afterEach(async () => {
        await restoreSnapshot()
      })

      it("should transfer tBTC from user to L2BTCRedeemerWormhole contract", async () => {
        expect(await tbtc.balanceOf(user.address)).to.equal(exampleAmount)
        expect(await tbtc.balanceOf(l2BtcRedeemer.address)).to.equal(
          exampleAmount
        )
      })

      it("should approve L2WormholeGateway to spend tBTC from L2BTCRedeemerWormhole", async () => {
        const allowance = await tbtc.allowance(
          l2BtcRedeemer.address,
          gateway.address
        )
        expect(allowance).to.be.gte(exampleAmount)
      })

      it("should call gateway.sendTbtcWithPayloadToEthereum with correct parameters", async () => {
        expect(gateway.sendTbtcWithPayloadToEthereum).to.have.been.calledOnceWith(
          exampleAmount,
          toWormholeFormat(l1BtcRedeemerWormholeAddress),
          exampleNonce,
          exampleRedeemerOutputScript
        )
      })

      it("should emit RedemptionRequestedOnL2 event", async () => {
        await expect(tx)
          .to.emit(l2BtcRedeemer, "RedemptionRequestedOnL2")
          .withArgs(
            exampleAmount,
            exampleRedeemerOutputScript,
            exampleNonce
          )
      })

      it("should return the sequence number from the gateway", async () => {
        // Re-program mock for this specific static call test
        gateway.sendTbtcWithPayloadToEthereum
          .whenCalledWith(
            exampleAmount,
            toWormholeFormat(l1BtcRedeemerWormholeAddress),
            exampleNonce,
            exampleRedeemerOutputScript
          )
          .returns(expectedGatewaySequence)

        const sequence = await l2BtcRedeemer
          .connect(user)
          .callStatic.requestRedemption(
            exampleAmount,
            exampleRedeemerOutputScript,
            exampleNonce
          )
        expect(sequence).to.equal(expectedGatewaySequence)
      })

      it("should increase the redeemedAmount", async () => {
        expect(await l2BtcRedeemer.redeemedAmount()).to.equal(exampleAmount)
      })
    })

    context("when redeemerOutputScript is invalid (non-standard)", () => {
      it("should revert", async () => {
        const invalidScript = "0x00112233"
        await expect(
          l2BtcRedeemer
            .connect(user)
            .requestRedemption(exampleAmount, invalidScript, exampleNonce)
        ).to.be.revertedWith("Redeemer output script must be a standard type")
      })
    })

    context("when amount is less than minimumRedemptionAmount", () => {
      beforeEach(async () => {
        await l2BtcRedeemer
          .connect(governance)
          .updateMinimumRedemptionAmount(ethers.utils.parseUnits("2", 18))
      })
      it("should revert", async () => {
        await expect(
          l2BtcRedeemer
            .connect(user)
            .requestRedemption(
              exampleAmount,
              exampleRedeemerOutputScript,
              exampleNonce
            )
        ).to.be.revertedWith("Amount too low to redeem")
      })
    })

    context("when normalized amount is zero (dust)", () => {
      it("should revert", async () => {
        const dustAmount = BigNumber.from(100)
        await expect(
          l2BtcRedeemer
            .connect(user)
            .requestRedemption(
              dustAmount,
              exampleRedeemerOutputScript,
              exampleNonce
            )
        ).to.be.revertedWith("Amount too low to redeem")
      })
    })

    context("when user has insufficient tBTC balance", () => {
      it("should revert", async () => {
        const largeAmount = exampleAmount.mul(10)
        await expect(
          l2BtcRedeemer
            .connect(user)
            .requestRedemption(
              largeAmount,
              exampleRedeemerOutputScript,
              exampleNonce
            )
        ).to.be.reverted
      })
    })

    context("when user has not approved L2BTCRedeemerWormhole", () => {
      it("should revert", async () => {
        await tbtc.connect(user).approve(l2BtcRedeemer.address, 0)
        await expect(
          l2BtcRedeemer
            .connect(user)
            .requestRedemption(
              exampleAmount,
              exampleRedeemerOutputScript,
              exampleNonce
            )
        ).to.be.reverted // ERC20: transfer amount exceeds allowance
      })
    })

    context("when gateway.sendTbtcWithPayloadToEthereum reverts", () => {
      it("should revert", async () => {
        gateway.sendTbtcWithPayloadToEthereum
          .whenCalledWith(
            exampleAmount,
            toWormholeFormat(l1BtcRedeemerWormholeAddress),
            exampleNonce,
            exampleRedeemerOutputScript
          )
          .reverts("Gateway: transfer failed")

        await expect(
          l2BtcRedeemer
            .connect(user)
            .requestRedemption(
              exampleAmount,
              exampleRedeemerOutputScript,
              exampleNonce
            )
        ).to.be.revertedWith("Gateway: transfer failed")
      })
    })
  })
})
