import chai, { expect } from "chai"
import { ethers } from "hardhat"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  QCMinter,
  AccountControl,
  SystemState,
  QCData,
  QCManager,
} from "../../../typechain"
import {
  setupTestSigners,
  createBaseTestEnvironment,
  restoreBaseTestEnvironment,
  TestSigners,
} from "../fixtures/base-setup"

chai.use(smock.matchers)

describe("QCMinter", () => {
  let signers: TestSigners
  let qcMinter: QCMinter
  let mockSystemState: FakeContract<SystemState>
  let mockQCData: FakeContract<QCData>
  let mockQCManager: FakeContract<QCManager>
  let mockAccountControl: FakeContract<AccountControl>

  // Test data
  const satoshiAmount = ethers.utils.parseUnits("5", 8) // 5 BTC in satoshis
  const mintAmount = ethers.utils.parseEther("5") // 5 tBTC in wei
  const maxMintingCapacity = ethers.utils.parseEther("100") // 100 tBTC in wei

  before(async () => {
    signers = await setupTestSigners()
  })

  beforeEach(async () => {
    await createBaseTestEnvironment()

    // Create mocks using standardized patterns
    mockSystemState = await smock.fake<SystemState>("SystemState")
    mockQCData = await smock.fake<QCData>("QCData")
    mockQCManager = await smock.fake<QCManager>("QCManager")
    mockAccountControl = await smock.fake<AccountControl>("AccountControl")

    // Deploy QCMinter with correct arguments
    const QCMinterFactory = await ethers.getContractFactory("QCMinter")
    qcMinter = await QCMinterFactory.deploy(
      mockQCData.address,
      mockSystemState.address,
      mockQCManager.address,
      mockAccountControl.address
    )
    await qcMinter.deployed()

    // Grant MINTER_ROLE to users for minting functions
    const MINTER_ROLE = await qcMinter.MINTER_ROLE()
    await qcMinter.grantRole(MINTER_ROLE, signers.user.address)
    await qcMinter.grantRole(MINTER_ROLE, signers.deployer.address)

    // Setup default mock behaviors
    mockSystemState.isMintingPaused.returns(false)
    mockSystemState.isQCEmergencyPaused.returns(false)
    mockSystemState.minMintAmount.returns(ethers.utils.parseEther("0.01"))
    mockSystemState.maxMintAmount.returns(ethers.utils.parseEther("1000"))

    mockQCData.getQCStatus.returns(0) // Active status

    mockQCManager.getAvailableMintingCapacity.returns(maxMintingCapacity)
    mockQCManager.consumeMintCapacity.returns(true) // Mock atomic capacity consumption

    // Setup AccountControl mock to return satoshi amount for mintTBTC
    mockAccountControl.mintTBTC.returns(satoshiAmount)
  })

  afterEach(async () => {
    await restoreBaseTestEnvironment()
  })

  describe("Deployment", () => {
    it("should set correct qcData", async () => {
      expect(await qcMinter.qcData()).to.equal(mockQCData.address)
    })

    it("should set correct systemState", async () => {
      expect(await qcMinter.systemState()).to.equal(mockSystemState.address)
    })

    it("should set correct qcManager", async () => {
      expect(await qcMinter.qcManager()).to.equal(mockQCManager.address)
    })

    it("should set correct accountControl", async () => {
      expect(await qcMinter.accountControl()).to.equal(
        mockAccountControl.address
      )
    })

    it("should grant DEFAULT_ADMIN_ROLE to deployer", async () => {
      const DEFAULT_ADMIN_ROLE = await qcMinter.DEFAULT_ADMIN_ROLE()
      expect(
        await qcMinter.hasRole(DEFAULT_ADMIN_ROLE, signers.deployer.address)
      ).to.be.true
    })

    it("should grant MINTER_ROLE to deployer", async () => {
      const MINTER_ROLE = await qcMinter.MINTER_ROLE()
      expect(await qcMinter.hasRole(MINTER_ROLE, signers.deployer.address)).to
        .be.true
    })

    context("when deployed with invalid addresses", () => {
      it("should revert with zero qcData address", async () => {
        const QCMinterFactory = await ethers.getContractFactory("QCMinter")

        await expect(
          QCMinterFactory.deploy(
            ethers.constants.AddressZero,
            mockSystemState.address,
            mockQCManager.address,
            mockAccountControl.address
          )
        ).to.be.revertedWith("Invalid qcData address")
      })

      it("should revert with zero systemState address", async () => {
        const QCMinterFactory = await ethers.getContractFactory("QCMinter")

        await expect(
          QCMinterFactory.deploy(
            mockQCData.address,
            ethers.constants.AddressZero,
            mockQCManager.address,
            mockAccountControl.address
          )
        ).to.be.revertedWith("Invalid systemState address")
      })

      it("should revert with zero qcManager address", async () => {
        const QCMinterFactory = await ethers.getContractFactory("QCMinter")

        await expect(
          QCMinterFactory.deploy(
            mockQCData.address,
            mockSystemState.address,
            ethers.constants.AddressZero,
            mockAccountControl.address
          )
        ).to.be.revertedWith("Invalid qcManager address")
      })

      it("should revert with zero accountControl address", async () => {
        const QCMinterFactory = await ethers.getContractFactory("QCMinter")

        await expect(
          QCMinterFactory.deploy(
            mockQCData.address,
            mockSystemState.address,
            mockQCManager.address,
            ethers.constants.AddressZero
          )
        ).to.be.revertedWith("Invalid accountControl address")
      })
    })
  })

  describe("requestQCMint", () => {
    context("when called with valid parameters", () => {
      it("should check system state", async () => {
        await qcMinter
          .connect(signers.user)
          .requestQCMint(
            signers.qcAddress.address,
            signers.user.address,
            mintAmount
          )

        expect(mockSystemState.isMintingPaused).to.have.been.called
        expect(mockSystemState.isQCEmergencyPaused).to.have.been.calledWith(
          signers.qcAddress.address
        )
      })

      it("should verify QC status", async () => {
        await qcMinter
          .connect(signers.user)
          .requestQCMint(
            signers.qcAddress.address,
            signers.user.address,
            mintAmount
          )

        expect(mockQCData.getQCStatus).to.have.been.calledWith(
          signers.qcAddress.address
        )
      })

      it("should atomically consume minting capacity", async () => {
        await qcMinter
          .connect(signers.user)
          .requestQCMint(
            signers.qcAddress.address,
            signers.user.address,
            mintAmount
          )

        expect(mockQCManager.consumeMintCapacity).to.have.been.calledWith(
          signers.qcAddress.address,
          mintAmount
        )
      })

      it("should call AccountControl to mint TBTC", async () => {
        await qcMinter
          .connect(signers.user)
          .requestQCMint(
            signers.qcAddress.address,
            signers.user.address,
            mintAmount
          )

        // Verify AccountControl.mintTBTC was called with correct parameters
        expect(mockAccountControl.mintTBTC).to.have.been.calledWith(
          signers.qcAddress.address,
          signers.user.address,
          mintAmount
        )
      })

      it("should emit QCMintRequested event", async () => {
        const tx = await qcMinter
          .connect(signers.user)
          .requestQCMint(
            signers.qcAddress.address,
            signers.user.address,
            mintAmount
          )

        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
        const receipt = await tx.wait()

        // Find the QCMintRequested event
        const qcMintRequestedEvent = receipt.events?.find(
          (e) => e.event === "QCMintRequested"
        )

        expect(qcMintRequestedEvent).to.not.be.undefined

        // Check event parameters (mintId will be dynamically generated)
        expect(qcMintRequestedEvent?.args?.[0]).to.equal(
          signers.qcAddress.address
        ) // qc
        expect(qcMintRequestedEvent?.args?.[1]).to.equal(signers.user.address) // user
        expect(qcMintRequestedEvent?.args?.[2]).to.equal(mintAmount) // amount
        expect(qcMintRequestedEvent?.args?.[3]).to.not.equal(
          ethers.utils.hexZeroPad("0x", 32)
        ) // mintId should not be zero
        expect(qcMintRequestedEvent?.args?.[4]).to.equal(signers.user.address) // requestedBy
        expect(qcMintRequestedEvent?.args?.[5]).to.equal(
          ethers.BigNumber.from(currentBlock.timestamp)
        ) // timestamp
      })

      it("should emit MintCompleted event", async () => {
        const tx = await qcMinter
          .connect(signers.user)
          .requestQCMint(
            signers.qcAddress.address,
            signers.user.address,
            mintAmount
          )

        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)

        await expect(tx).to.emit(qcMinter, "MintCompleted")
      })
    })

    context("when called with invalid parameters", () => {
      it("should revert with zero QC address", async () => {
        await expect(
          qcMinter
            .connect(signers.user)
            .requestQCMint(
              ethers.constants.AddressZero,
              signers.user.address,
              mintAmount
            )
        ).to.be.revertedWithCustomError(qcMinter, "InvalidQCAddress")
      })

      it("should revert with zero amount", async () => {
        await expect(
          qcMinter
            .connect(signers.user)
            .requestQCMint(signers.qcAddress.address, signers.user.address, 0)
        ).to.be.revertedWithCustomError(qcMinter, "InvalidAmount")
      })

      it("should revert with zero user address", async () => {
        await expect(
          qcMinter
            .connect(signers.user)
            .requestQCMint(
              signers.qcAddress.address,
              ethers.constants.AddressZero,
              mintAmount
            )
        ).to.be.revertedWithCustomError(qcMinter, "InvalidUserAddress")
      })
    })

    context("when minting is paused", () => {
      beforeEach(async () => {
        mockSystemState.isMintingPaused.returns(true)
      })

      it("should revert", async () => {
        await expect(
          qcMinter
            .connect(signers.user)
            .requestQCMint(
              signers.qcAddress.address,
              signers.user.address,
              mintAmount
            )
        ).to.be.revertedWithCustomError(qcMinter, "MintingIsPaused")
      })
    })

    context("when QC is emergency paused", () => {
      beforeEach(async () => {
        mockSystemState.isQCEmergencyPaused
          .whenCalledWith(signers.qcAddress.address)
          .returns(true)
      })

      it("should revert", async () => {
        await expect(
          qcMinter
            .connect(signers.user)
            .requestQCMint(
              signers.qcAddress.address,
              signers.user.address,
              mintAmount
            )
        ).to.be.revertedWithCustomError(qcMinter, "QCIsEmergencyPaused")
      })
    })

    context("when QC is not active", () => {
      beforeEach(async () => {
        mockQCData.getQCStatus.returns(2) // Paused (not active)
      })

      it("should revert", async () => {
        await expect(
          qcMinter
            .connect(signers.user)
            .requestQCMint(
              signers.qcAddress.address,
              signers.user.address,
              mintAmount
            )
        ).to.be.revertedWithCustomError(qcMinter, "QCNotActive")
      })
    })

    context("when amount exceeds capacity", () => {
      beforeEach(async () => {
        mockQCManager.getAvailableMintingCapacity.returns(mintAmount.sub(1))
        mockQCManager.consumeMintCapacity.returns(false) // Atomic capacity check fails
      })

      it("should revert", async () => {
        await expect(
          qcMinter
            .connect(signers.user)
            .requestQCMint(
              signers.qcAddress.address,
              signers.user.address,
              mintAmount
            )
        ).to.be.revertedWithCustomError(qcMinter, "InsufficientMintingCapacity")
      })
    })

    context("when amount is outside allowed range", () => {
      it("should revert when amount is below minimum", async () => {
        mockSystemState.minMintAmount.returns(mintAmount.add(1))

        await expect(
          qcMinter
            .connect(signers.user)
            .requestQCMint(
              signers.qcAddress.address,
              signers.user.address,
              mintAmount
            )
        ).to.be.revertedWithCustomError(qcMinter, "AmountOutsideAllowedRange")
      })

      it("should revert when amount is above maximum", async () => {
        mockSystemState.maxMintAmount.returns(mintAmount.sub(1))

        await expect(
          qcMinter
            .connect(signers.user)
            .requestQCMint(
              signers.qcAddress.address,
              signers.user.address,
              mintAmount
            )
        ).to.be.revertedWithCustomError(qcMinter, "AmountOutsideAllowedRange")
      })
    })
  })

  describe("getAvailableMintingCapacity", () => {
    const availableCapacity = ethers.utils.parseEther("10")

    beforeEach(async () => {
      mockQCManager.getAvailableMintingCapacity
        .whenCalledWith(signers.qcAddress.address)
        .returns(availableCapacity)
    })

    it("should delegate to QCManager", async () => {
      const result = await qcMinter.getAvailableMintingCapacity(
        signers.qcAddress.address
      )

      expect(mockQCManager.getAvailableMintingCapacity).to.have.been.calledWith(
        signers.qcAddress.address
      )
      expect(result).to.equal(availableCapacity)
    })
  })

  describe("checkMintingEligibility", () => {
    beforeEach(async () => {
      mockQCManager.getAvailableMintingCapacity
        .whenCalledWith(signers.qcAddress.address)
        .returns(maxMintingCapacity)
    })

    context("when all checks pass", () => {
      it("should return true", async () => {
        const result = await qcMinter.checkMintingEligibility(
          signers.qcAddress.address,
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
          signers.qcAddress.address,
          mintAmount
        )

        expect(result).to.be.false
      })
    })

    context("when amount is out of range", () => {
      it("should return false for amount below minimum", async () => {
        mockSystemState.minMintAmount.returns(mintAmount.add(1))

        const result = await qcMinter.checkMintingEligibility(
          signers.qcAddress.address,
          mintAmount
        )

        expect(result).to.be.false
      })

      it("should return false for amount above maximum", async () => {
        mockSystemState.maxMintAmount.returns(mintAmount.sub(1))

        const result = await qcMinter.checkMintingEligibility(
          signers.qcAddress.address,
          mintAmount
        )

        expect(result).to.be.false
      })
    })

    context("when QC is not active", () => {
      beforeEach(async () => {
        mockQCData.getQCStatus.returns(2) // Paused (not active)
      })

      it("should return false", async () => {
        const result = await qcMinter.checkMintingEligibility(
          signers.qcAddress.address,
          mintAmount
        )

        expect(result).to.be.false
      })
    })

    context("when amount exceeds capacity", () => {
      beforeEach(async () => {
        mockQCManager.getAvailableMintingCapacity
          .whenCalledWith(signers.qcAddress.address)
          .returns(mintAmount.sub(1))
      })

      it("should return false", async () => {
        const result = await qcMinter.checkMintingEligibility(
          signers.qcAddress.address,
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
            .connect(signers.thirdParty)
            .requestQCMint(
              signers.qcAddress.address,
              signers.user.address,
              mintAmount
            )
        ).to.be.reverted
      })
    })

    context("when caller has MINTER_ROLE", () => {
      beforeEach(async () => {
        const MINTER_ROLE = await qcMinter.MINTER_ROLE()
        await qcMinter.grantRole(MINTER_ROLE, signers.thirdParty.address)
      })

      it("should allow requestQCMint", async () => {
        await expect(
          qcMinter
            .connect(signers.thirdParty)
            .requestQCMint(
              signers.qcAddress.address,
              signers.user.address,
              mintAmount
            )
        ).to.not.be.reverted
      })
    })
  })
})
