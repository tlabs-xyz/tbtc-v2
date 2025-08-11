import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  QCMinter,
  ProtocolRegistry,
  Bank,
  TBTCVault,
  TBTC,
  SystemState,
  QCData,
  QCManager,
} from "../../typechain"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCMinter", () => {
  let deployer: SignerWithAddress
  let user: SignerWithAddress
  let qcAddress: SignerWithAddress
  let thirdParty: SignerWithAddress

  let qcMinter: QCMinter
  let protocolRegistry: ProtocolRegistry
  let mockBank: FakeContract<Bank>
  let mockTBTCVault: FakeContract<TBTCVault>
  let mockTBTC: FakeContract<TBTC>
  let mockSystemState: FakeContract<SystemState>
  let mockQCData: FakeContract<QCData>
  let mockQCManager: FakeContract<QCManager>

  // Service keys
  let SYSTEM_STATE_KEY: string
  let QC_DATA_KEY: string
  let QC_MANAGER_KEY: string

  // Test data
  const mintAmount = ethers.utils.parseEther("5")
  const satoshis = mintAmount.div(ethers.BigNumber.from("10000000000")) // 1e10
  const maxMintingCapacity = ethers.utils.parseEther("100")

  before(async () => {
    const signers = await ethers.getSigners()
    deployer = signers[0]
    user = signers[1]
    qcAddress = signers[2]
    thirdParty = signers[3]

    // Generate service keys
    SYSTEM_STATE_KEY = ethers.utils.id("SYSTEM_STATE")
    QC_DATA_KEY = ethers.utils.id("QC_DATA")
    QC_MANAGER_KEY = ethers.utils.id("QC_MANAGER")
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy ProtocolRegistry
    const ProtocolRegistryFactory = await ethers.getContractFactory(
      "ProtocolRegistry"
    )
    protocolRegistry = await ProtocolRegistryFactory.deploy()
    await protocolRegistry.deployed()

    // Create mocks
    mockBank = await smock.fake<Bank>("Bank")
    mockTBTCVault = await smock.fake<TBTCVault>("TBTCVault")
    mockTBTC = await smock.fake<TBTC>("TBTC")
    mockSystemState = await smock.fake<SystemState>("SystemState")
    mockQCData = await smock.fake<QCData>("QCData")
    mockQCManager = await smock.fake<QCManager>("QCManager")

    // Register services
    await protocolRegistry.setService(SYSTEM_STATE_KEY, mockSystemState.address)
    await protocolRegistry.setService(QC_DATA_KEY, mockQCData.address)
    await protocolRegistry.setService(QC_MANAGER_KEY, mockQCManager.address)

    // Deploy QCMinter with direct dependencies
    const QCMinterFactory = await ethers.getContractFactory("QCMinter")
    qcMinter = await QCMinterFactory.deploy(
      mockBank.address,
      mockTBTCVault.address,
      mockTBTC.address,
      protocolRegistry.address
    )
    await qcMinter.deployed()

    // Grant MINTER_ROLE to user
    const MINTER_ROLE = await qcMinter.MINTER_ROLE()
    await qcMinter.grantRole(MINTER_ROLE, user.address)

    // Setup default mock behaviors
    mockSystemState.isMintingPaused.returns(false)
    mockSystemState.isQCEmergencyPaused.returns(false)
    mockSystemState.minMintAmount.returns(ethers.utils.parseEther("0.01"))
    mockSystemState.maxMintAmount.returns(ethers.utils.parseEther("1000"))

    mockQCData.getQCStatus.returns(1) // Active status
    mockQCData.getQCMintedAmount.returns(0)

    mockQCManager.getAvailableMintingCapacity.returns(maxMintingCapacity)
    mockQCManager.updateQCMintedAmount.returns()

    mockBank.authorizedBalanceIncreasers.returns(true)
    mockBank.increaseBalanceAndCall.returns()
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment", () => {
    it("should set correct protocol registry", async () => {
      expect(await qcMinter.protocolRegistry()).to.equal(
        protocolRegistry.address
      )
    })

    it("should set correct bank", async () => {
      expect(await qcMinter.bank()).to.equal(mockBank.address)
    })

    it("should set correct tbtc vault", async () => {
      expect(await qcMinter.tbtcVault()).to.equal(mockTBTCVault.address)
    })

    it("should set correct tbtc token", async () => {
      expect(await qcMinter.tbtc()).to.equal(mockTBTC.address)
    })
  })

  describe("requestQCMint", () => {
    context("when called with valid parameters", () => {
      it("should check system state", async () => {
        await qcMinter
          .connect(user)
          .requestQCMint(qcAddress.address, mintAmount)

        expect(mockSystemState.isMintingPaused).to.have.been.called
        expect(mockSystemState.isQCEmergencyPaused).to.have.been.calledWith(
          qcAddress.address
        )
      })

      it("should verify QC status", async () => {
        await qcMinter
          .connect(user)
          .requestQCMint(qcAddress.address, mintAmount)

        expect(mockQCData.getQCStatus).to.have.been.calledWith(
          qcAddress.address
        )
      })

      it("should check minting capacity", async () => {
        await qcMinter
          .connect(user)
          .requestQCMint(qcAddress.address, mintAmount)

        expect(
          mockQCManager.getAvailableMintingCapacity
        ).to.have.been.calledWith(qcAddress.address)
      })

      it("should increase balance in Bank", async () => {
        await qcMinter
          .connect(user)
          .requestQCMint(qcAddress.address, mintAmount)

        expect(mockBank.increaseBalanceAndCall).to.have.been.calledWith(
          mockTBTCVault.address,
          [user.address],
          [satoshis]
        )
      })

      it("should update QC minted amount", async () => {
        await qcMinter
          .connect(user)
          .requestQCMint(qcAddress.address, mintAmount)

        expect(mockQCManager.updateQCMintedAmount).to.have.been.calledWith(
          qcAddress.address,
          mintAmount
        )
      })

      it("should emit QCMintRequested event", async () => {
        const tx = await qcMinter
          .connect(user)
          .requestQCMint(qcAddress.address, mintAmount)
        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)

        await expect(tx).to.emit(qcMinter, "QCMintRequested").withArgs(
          qcAddress.address,
          user.address,
          mintAmount,
          ethers.utils.hexZeroPad("0x", 32), // mintId will be generated
          user.address,
          currentBlock.timestamp
        )
      })

      it("should emit MintCompleted event", async () => {
        const tx = await qcMinter
          .connect(user)
          .requestQCMint(qcAddress.address, mintAmount)
        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)

        await expect(tx).to.emit(qcMinter, "MintCompleted")
      })
    })

    context("when called with invalid parameters", () => {
      it("should revert with zero QC address", async () => {
        await expect(
          qcMinter
            .connect(user)
            .requestQCMint(ethers.constants.AddressZero, mintAmount)
        ).to.be.revertedWith("InvalidQCAddress")
      })

      it("should revert with zero amount", async () => {
        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, 0)
        ).to.be.revertedWith("InvalidAmount")
      })
    })

    context("when minting is paused", () => {
      beforeEach(async () => {
        mockSystemState.isMintingPaused.returns(true)
      })

      it("should revert", async () => {
        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
        ).to.be.revertedWith("MintingPaused")
      })
    })

    context("when QC is emergency paused", () => {
      beforeEach(async () => {
        mockSystemState.isQCEmergencyPaused
          .whenCalledWith(qcAddress.address)
          .returns(true)
      })

      it("should revert", async () => {
        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
        ).to.be.revertedWith("QCIsEmergencyPaused")
      })
    })

    context("when QC is not active", () => {
      beforeEach(async () => {
        mockQCData.getQCStatus.returns(0) // Not active
      })

      it("should revert", async () => {
        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
        ).to.be.revertedWith("QCNotActive")
      })
    })

    context("when amount exceeds capacity", () => {
      beforeEach(async () => {
        mockQCManager.getAvailableMintingCapacity.returns(mintAmount.sub(1))
      })

      it("should revert", async () => {
        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
        ).to.be.revertedWith("InsufficientMintingCapacity")
      })
    })

    context("when not authorized in Bank", () => {
      beforeEach(async () => {
        mockBank.authorizedBalanceIncreasers
          .whenCalledWith(qcMinter.address)
          .returns(false)
      })

      it("should revert", async () => {
        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
        ).to.be.revertedWith("NotAuthorizedInBank")
      })
    })
  })

  describe("getAvailableMintingCapacity", () => {
    const availableCapacity = ethers.utils.parseEther("10")

    beforeEach(async () => {
      mockQCManager.getAvailableMintingCapacity
        .whenCalledWith(qcAddress.address)
        .returns(availableCapacity)
    })

    it("should delegate to QCManager", async () => {
      const result = await qcMinter.getAvailableMintingCapacity(
        qcAddress.address
      )

      expect(mockQCManager.getAvailableMintingCapacity).to.have.been.calledWith(
        qcAddress.address
      )
      expect(result).to.equal(availableCapacity)
    })
  })

  describe("checkMintingEligibility", () => {
    beforeEach(async () => {
      mockQCManager.getAvailableMintingCapacity
        .whenCalledWith(qcAddress.address)
        .returns(maxMintingCapacity)
    })

    context("when all checks pass", () => {
      it("should return true", async () => {
        const result = await qcMinter.checkMintingEligibility(
          qcAddress.address,
          mintAmount
        )
        expect(result).to.be.true
      })
    })

    context("when minting is paused", () => {
      beforeEach(async () => {
        mockSystemState.isMintingPaused.returns(true)
      })

      it("should return false", async () => {
        const result = await qcMinter.checkMintingEligibility(
          qcAddress.address,
          mintAmount
        )
        expect(result).to.be.false
      })
    })

    context("when amount is out of range", () => {
      it("should return false for amount below minimum", async () => {
        mockSystemState.minMintAmount.returns(mintAmount.add(1))

        const result = await qcMinter.checkMintingEligibility(
          qcAddress.address,
          mintAmount
        )
        expect(result).to.be.false
      })

      it("should return false for amount above maximum", async () => {
        mockSystemState.maxMintAmount.returns(mintAmount.sub(1))

        const result = await qcMinter.checkMintingEligibility(
          qcAddress.address,
          mintAmount
        )
        expect(result).to.be.false
      })
    })

    context("when QC is not active", () => {
      beforeEach(async () => {
        mockQCData.getQCStatus.returns(0) // Not active
      })

      it("should return false", async () => {
        const result = await qcMinter.checkMintingEligibility(
          qcAddress.address,
          mintAmount
        )
        expect(result).to.be.false
      })
    })

    context("when amount exceeds capacity", () => {
      beforeEach(async () => {
        mockQCManager.getAvailableMintingCapacity.returns(mintAmount.sub(1))
      })

      it("should return false", async () => {
        const result = await qcMinter.checkMintingEligibility(
          qcAddress.address,
          mintAmount
        )
        expect(result).to.be.false
      })
    })
  })

  describe("Access Control", () => {
    context("when caller does not have MINTER_ROLE", () => {
      it("should revert requestQCMint", async () => {
        await expect(
          qcMinter
            .connect(thirdParty)
            .requestQCMint(qcAddress.address, mintAmount)
        ).to.be.reverted
      })
    })

    context("when caller has MINTER_ROLE", () => {
      beforeEach(async () => {
        const MINTER_ROLE = await qcMinter.MINTER_ROLE()
        await qcMinter.grantRole(MINTER_ROLE, thirdParty.address)
      })

      it("should allow requestQCMint", async () => {
        await expect(
          qcMinter
            .connect(thirdParty)
            .requestQCMint(qcAddress.address, mintAmount)
        ).to.not.be.reverted
      })
    })
  })
})
