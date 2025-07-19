// @ts-nocheck
import { deployments, helpers, ethers } from "hardhat"
import { expect } from "chai"

import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

import type {
  OptimismMintableUpgradableTBTC,
  OptimismMintableUpgradableERC20,
  ITransparentUpgradeableProxy,
} from "../typechain"

describe("BOBTBTC - Manual Upgrade Test", async () => {
  let deployer: SignerWithAddress
  let user: SignerWithAddress
  let admin: SignerWithAddress

  before(async () => {
    ;[deployer, user, admin] = await ethers.getSigners()
  })

  describe("Manual proxy upgrade flow", () => {
    let proxy: ITransparentUpgradeableProxy
    let implementation: OptimismMintableUpgradableERC20
    let newImplementation: OptimismMintableUpgradableTBTC
    let proxyAsV1: OptimismMintableUpgradableERC20
    let proxyAsV2: OptimismMintableUpgradableTBTC

    // Test values
    const L2_BRIDGE = "0x9fc3da866e7df3a1c57ade1a97c9f00a70f010c8"
    const L1_TBTC = "0x3151c5547d1dbcd52076bd3cbe56c79abd55b42f"
    const TOKEN_NAME = "BOB tBTC v2"
    const TOKEN_SYMBOL = "tBTC"
    const DECIMALS = 18

    before(async () => {
      // 1. Deploy V1 implementation
      const OptimismMintableUpgradableERC20Factory =
        await ethers.getContractFactory(
          "OptimismMintableUpgradableERC20",
          deployer
        )
      implementation = await OptimismMintableUpgradableERC20Factory.deploy()
      await implementation.deployed()
      console.log("V1 Implementation deployed at:", implementation.address)

      // 2. Deploy TransparentUpgradeableProxy
      const TransparentUpgradeableProxyFactory =
        await ethers.getContractFactory("TransparentUpgradeableProxy", deployer)

      // Encode the initialize function call
      const initializeData = implementation.interface.encodeFunctionData(
        "initialize",
        [L2_BRIDGE, L1_TBTC, TOKEN_NAME, TOKEN_SYMBOL, DECIMALS]
      )

      const proxyContract = await TransparentUpgradeableProxyFactory.deploy(
        implementation.address,
        admin.address,
        initializeData
      )
      await proxyContract.deployed()
      console.log("Proxy deployed at:", proxyContract.address)

      proxy = (await ethers.getContractAt(
        "ITransparentUpgradeableProxy",
        proxyContract.address
      )) as ITransparentUpgradeableProxy

      // 3. Get proxy as V1 contract
      proxyAsV1 = (await ethers.getContractAt(
        "OptimismMintableUpgradableERC20",
        proxy.address,
        user
      )) as OptimismMintableUpgradableERC20

      // Verify initialization worked
      expect(await proxyAsV1.name()).to.equal(TOKEN_NAME)
      expect(await proxyAsV1.symbol()).to.equal(TOKEN_SYMBOL)
      expect(await proxyAsV1.decimals()).to.equal(DECIMALS)
      expect((await proxyAsV1.l1Token()).toLowerCase()).to.equal(
        L1_TBTC.toLowerCase()
      )
      expect((await proxyAsV1.bridge()).toLowerCase()).to.equal(
        L2_BRIDGE.toLowerCase()
      )
    })

    describe("Upgrading to V2", () => {
      before(async () => {
        // 1. Deploy new implementation
        const OptimismMintableUpgradableTBTCFactory =
          await ethers.getContractFactory(
            "OptimismMintableUpgradableTBTC",
            deployer
          )
        newImplementation = await OptimismMintableUpgradableTBTCFactory.deploy()
        await newImplementation.deployed()
        console.log("V2 Implementation deployed at:", newImplementation.address)

        // 2. Perform the upgrade directly on the proxy using admin account
        await proxy.connect(admin).upgradeTo(newImplementation.address)
        console.log("Proxy upgraded to new implementation")

        // 3. Get proxy as V2 contract, connected as deployer
        proxyAsV2 = (await ethers.getContractAt(
          "OptimismMintableUpgradableTBTC",
          proxy.address,
          deployer
        )) as OptimismMintableUpgradableTBTC

        // 4. Call initializeV2. This makes deployer the owner.
        await proxyAsV2.initializeV2()
        console.log("InitializeV2 called successfully")
      })

      describe("State preservation", () => {
        it("should preserve name", async () => {
          expect(await proxyAsV2.name()).to.equal(TOKEN_NAME)
        })

        it("should preserve symbol", async () => {
          expect(await proxyAsV2.symbol()).to.equal(TOKEN_SYMBOL)
        })

        it("should preserve decimals", async () => {
          expect(await proxyAsV2.decimals()).to.equal(DECIMALS)
        })

        it("should preserve l1Token", async () => {
          expect((await proxyAsV2.l1Token()).toLowerCase()).to.equal(
            L1_TBTC.toLowerCase()
          )
        })

        it("should preserve bridge", async () => {
          expect((await proxyAsV2.bridge()).toLowerCase()).to.equal(
            L2_BRIDGE.toLowerCase()
          )
        })

        it("should preserve total supply", async () => {
          const totalSupply = await proxyAsV2.totalSupply()
          expect(totalSupply).to.equal(ethers.utils.parseEther("0"))
        })
      })

      describe("New V2 functionality", () => {
        it("should have correct owner", async () => {
          expect(await proxyAsV2.owner()).to.equal(deployer.address)
        })

        it("should not be paused", async () => {
          expect(await proxyAsV2.paused()).to.equal(false)
        })

        describe("Guardian functionality", () => {
          it("should add a guardian and confirm with isGuardian", async () => {
            await proxyAsV2.addGuardian(user.address)
            expect(await proxyAsV2.isGuardian(user.address)).to.be.true
          })

          it("should get the list of guardians", async () => {
            // This test depends on the previous one adding a guardian.
            const guardians = await proxyAsV2.getGuardians()
            expect(guardians).to.include(user.address)
          })
        })

        describe("Minter functionality", () => {
          it("should add a minter and confirm with isMinter", async () => {
            await proxyAsV2.addMinter(deployer.address)
            expect(await proxyAsV2.isMinter(deployer.address)).to.be.true
          })

          it("should get the list of minters", async () => {
            // This test depends on the previous one adding a minter.
            const minters = await proxyAsV2.getMinters()
            expect(minters).to.include(deployer.address)
          })
        })
      })

      describe("Re-initialization checks", () => {
        it("should not allow re-initialization with V1 initialize", async () => {
          await expect(
            proxyAsV2.initialize(L2_BRIDGE, L1_TBTC, "New Name", "NEW", 18)
          ).to.be.revertedWith("Initializable: contract is already initialized")
        })

        it("should not allow re-initialization with V2 initializeV2", async () => {
          await expect(proxyAsV2.initializeV2()).to.be.revertedWith(
            "Initializable: contract is already initialized"
          )
        })
      })

      describe("Storage layout verification", () => {
        it("should have the implementation slot pointing to V2", async () => {
          const IMPLEMENTATION_SLOT =
            "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
          const implementationStorage = await ethers.provider.getStorageAt(
            proxy.address,
            IMPLEMENTATION_SLOT
          )
          const implementationAddress = "0x" + implementationStorage.slice(26) // Remove padding

          expect(implementationAddress.toLowerCase()).to.equal(
            newImplementation.address.toLowerCase()
          )
          console.log(
            "Verified implementation slot points to V2:",
            implementationAddress
          )
        })
      })
    })
  })
})
