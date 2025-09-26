import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  QCMinter,
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
  let mockBank: FakeContract<Bank>
  let mockTBTCVault: FakeContract<TBTCVault>
  let mockTBTC: FakeContract<TBTC>
  let mockSystemState: FakeContract<SystemState>
  let mockQCData: FakeContract<QCData>
  let mockQCManager: FakeContract<QCManager>

  // Test data
  const mintAmount = ethers.utils.parseEther("5")
  const satoshis = mintAmount.div(ethers.BigNumber.from("10000000000")) // 1e10
  const maxMintingCapacity = ethers.utils.parseEther("100")

  before(async () => {
    const [deployerSigner, userSigner, qcAddressSigner, thirdPartySigner] =
      await ethers.getSigners()
    deployer = deployerSigner
    user = userSigner
    qcAddress = qcAddressSigner
    thirdParty = thirdPartySigner
  })

  beforeEach(async () => {
    await createSnapshot()

    // Create mocks
    mockBank = await smock.fake<Bank>("Bank")
    mockTBTCVault = await smock.fake<TBTCVault>("TBTCVault")
    mockTBTC = await smock.fake<TBTC>("TBTC")
    mockSystemState = await smock.fake<SystemState>("SystemState")
    mockQCData = await smock.fake<QCData>("QCData")
    mockQCManager = await smock.fake<QCManager>("QCManager")

    // Deploy QCMinter with direct integration pattern
    const QCMinterFactory = await ethers.getContractFactory("QCMinter")
    qcMinter = await QCMinterFactory.deploy(
      mockBank.address,
      mockTBTCVault.address,
      mockTBTC.address,
      mockQCData.address,
      mockSystemState.address,
      mockQCManager.address
    )
    await qcMinter.deployed()

    // Grant MINTER_ROLE to user
    const MINTER_ROLE = await qcMinter.MINTER_ROLE()
    await qcMinter.grantRole(MINTER_ROLE, user.address)
    
    // Grant GOVERNANCE_ROLE to deployer for governance functions
    const GOVERNANCE_ROLE = await qcMinter.GOVERNANCE_ROLE()
    await qcMinter.grantRole(GOVERNANCE_ROLE, deployer.address)

    // Setup default mock behaviors
    mockSystemState.isMintingPaused.returns(false)
    mockSystemState.isQCEmergencyPaused.returns(false)
    mockSystemState.minMintAmount.returns(ethers.utils.parseEther("0.01"))
    mockSystemState.maxMintAmount.returns(ethers.utils.parseEther("1000"))

    mockQCData.getQCStatus.returns(0) // Active status
    mockQCData.getQCMintedAmount.returns(0)

    mockQCManager.getAvailableMintingCapacity.returns(maxMintingCapacity)
    mockQCManager.updateQCMintedAmount.returns()

    mockBank.authorizedBalanceIncreasers.returns(true)
    mockBank.increaseBalance.returns()
    mockBank.balanceOf.returns(satoshis)
    mockBank.transferBalanceFrom.returns()
    
    // Setup mocks for manualMint
    mockTBTCVault.mint.returns()
    mockTBTC.transfer.returns(true)

    // Deploy and configure AccountControl for QCMinter
    const MockAccountControl = await ethers.getContractFactory("MockAccountControl")
    const mockAccountControl = await MockAccountControl.deploy()
    await mockAccountControl.deployed()

    // Set the AccountControl address in QCMinter
    await qcMinter.setAccountControl(mockAccountControl.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment", () => {
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

      it("should call AccountControl to mint TBTC", async () => {
        const MockAccountControl = await ethers.getContractFactory("MockAccountControl")
        const mockAccountControl = MockAccountControl.attach(
          await qcMinter.accountControl()
        )

        const tx = await qcMinter
          .connect(user)
          .requestQCMint(qcAddress.address, mintAmount)

        // Verify AccountControl.mintTBTC was called via event
        await expect(tx)
          .to.emit(mockAccountControl, "TBTCMinted")
          .withArgs(user.address, mintAmount, satoshis)
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
        const receipt = await tx.wait()

        // Find the QCMintRequested event
        const qcMintRequestedEvent = receipt.events?.find(
          e => e.event === "QCMintRequested"
        )
        expect(qcMintRequestedEvent).to.not.be.undefined

        // Check event parameters (mintId will be dynamically generated)
        expect(qcMintRequestedEvent?.args?.[0]).to.equal(qcAddress.address) // qc
        expect(qcMintRequestedEvent?.args?.[1]).to.equal(user.address) // user
        expect(qcMintRequestedEvent?.args?.[2]).to.equal(mintAmount) // amount
        expect(qcMintRequestedEvent?.args?.[3]).to.not.equal(ethers.utils.hexZeroPad("0x", 32)) // mintId should not be zero
        expect(qcMintRequestedEvent?.args?.[4]).to.equal(user.address) // requestedBy
        expect(qcMintRequestedEvent?.args?.[5]).to.equal(currentBlock.timestamp) // timestamp
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
        mockQCData.getQCStatus.returns(2) // Paused (not active)
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
        mockQCData.getQCStatus.returns(2) // Paused (not active)
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
        mockQCManager.getAvailableMintingCapacity.whenCalledWith(qcAddress.address).returns(mintAmount.sub(1))
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

  describe("Auto-minting functionality", () => {
    describe("setAutoMintEnabled", () => {
      it("should set auto-minting enabled", async () => {
        await qcMinter.setAutoMintEnabled(true)
        expect(await qcMinter.autoMintEnabled()).to.be.true
      })

      it("should set auto-minting disabled", async () => {
        await qcMinter.setAutoMintEnabled(false)
        expect(await qcMinter.autoMintEnabled()).to.be.false
      })

      it("should emit AutoMintToggled event", async () => {
        await expect(qcMinter.setAutoMintEnabled(true))
          .to.emit(qcMinter, "AutoMintToggled")
          .withArgs(true)
      })

      it("should revert when called by non-governance", async () => {
        await expect(
          qcMinter.connect(user).setAutoMintEnabled(true)
        ).to.be.reverted
      })
    })

    describe("manualMint", () => {
      beforeEach(async () => {
        // Set up mocks for manual minting
        mockBank.balanceOf.returns(satoshis)
        mockBank.allowance.returns(satoshis)
        mockBank.transferBalanceFrom.returns()
        mockTBTCVault.mint.returns()
        mockTBTC.transfer.returns(true)
      })

      it("should check user has Bank balance", async () => {
        await qcMinter.connect(user).manualMint(user.address)
        
        expect(mockBank.balanceOf).to.have.been.calledWith(user.address)
      })

      it("should check user has sufficient allowance", async () => {
        await qcMinter.connect(user).manualMint(user.address)
        
        // The allowance check is implicit in transferBalanceFrom call
        expect(mockBank.transferBalanceFrom).to.have.been.calledWith(
          user.address,
          qcMinter.address,
          satoshis
        )
      })

      it("should transfer balance from user", async () => {
        await qcMinter.connect(user).manualMint(user.address)
        
        expect(mockBank.transferBalanceFrom).to.have.been.calledWith(
          user.address,
          qcMinter.address,
          satoshis
        )
      })

      it("should mint tBTC", async () => {
        await qcMinter.connect(user).manualMint(user.address)
        
        expect(mockTBTCVault.mint).to.have.been.calledWith(mintAmount)
      })

      it("should transfer tBTC to user", async () => {
        await qcMinter.connect(user).manualMint(user.address)
        
        expect(mockTBTC.transfer).to.have.been.calledWith(
          user.address,
          mintAmount
        )
      })

      it("should emit ManualMintCompleted event", async () => {
        await expect(qcMinter.connect(user).manualMint(user.address))
          .to.emit(qcMinter, "ManualMintCompleted")
          .withArgs(user.address, satoshis, mintAmount)
      })

      it("should revert when user has no balance", async () => {
        mockBank.balanceOf.returns(0)
        
        await expect(
          qcMinter.connect(user).manualMint(user.address)
        ).to.be.revertedWith("ZeroAmount")
      })

      it("should revert when user has insufficient allowance", async () => {
        // Set up: user has balance but insufficient allowance
        mockBank.balanceOf.returns(satoshis)
        mockBank.allowance.returns(satoshis.sub(1)) // Allowance less than required amount

        // Configure transferBalanceFrom to revert when allowance is insufficient
        mockBank.transferBalanceFrom.reverts()

        await expect(
          qcMinter.connect(user).manualMint(user.address)
        ).to.be.reverted
      })
    })

    describe("checkMintEligibility (Bank balance)", () => {
      beforeEach(async () => {
        mockBank.balanceOf.returns(satoshis)
        mockBank.allowance.returns(satoshis)
      })

      it("should return balance and allowance info", async () => {
        const result = await qcMinter.checkMintEligibility(user.address)
        
        expect(result.hasBalance).to.be.true
        expect(result.hasAllowance).to.be.true
        expect(result.balance).to.equal(satoshis)
        expect(result.allowance).to.equal(satoshis)
      })

      it("should return false when no balance", async () => {
        mockBank.balanceOf.returns(0)
        
        const result = await qcMinter.checkMintEligibility(user.address)
        
        expect(result.hasBalance).to.be.false
        expect(result.balance).to.equal(0)
      })

      it("should return false when insufficient allowance", async () => {
        mockBank.allowance.returns(0)
        
        const result = await qcMinter.checkMintEligibility(user.address)
        
        expect(result.hasAllowance).to.be.false
        expect(result.allowance).to.equal(0)
      })
    })

    describe("getSatoshiToTBTCAmount", () => {
      it("should convert satoshis to tBTC amount", async () => {
        const result = await qcMinter.getSatoshiToTBTCAmount(satoshis)
        
        expect(result).to.equal(mintAmount)
      })

      it("should handle zero satoshis", async () => {
        const result = await qcMinter.getSatoshiToTBTCAmount(0)
        
        expect(result).to.equal(0)
      })

      it("should handle large amounts", async () => {
        const largeSatoshis = ethers.utils.parseUnits("1", 8) // 1 BTC
        const expectedTBTC = ethers.utils.parseEther("1") // 1 tBTC
        
        const result = await qcMinter.getSatoshiToTBTCAmount(largeSatoshis)
        
        expect(result).to.equal(expectedTBTC)
      })
    })

    describe("requestQCMintHybrid with auto-minting", () => {
      beforeEach(async () => {
        // Enable auto-minting
        await qcMinter.setAutoMintEnabled(true)
        
        // Set up mocks for auto-minting
        mockBank.allowance.returns(satoshis)
        mockBank.transferBalanceFrom.returns()
        mockTBTCVault.mint.returns()
        mockTBTC.transfer.returns(true)
      })

      it("should perform auto-mint when enabled and requested", async () => {
        const permitData = "0x" // Empty permit data

        const MockAccountControl = await ethers.getContractFactory("MockAccountControl")
        const mockAccountControl = MockAccountControl.attach(
          await qcMinter.accountControl()
        )

        const tx = await qcMinter
          .connect(user)
          .requestQCMintHybrid(qcAddress.address, mintAmount, true, permitData)

        // Should call AccountControl.mintTBTC via event
        await expect(tx)
          .to.emit(mockAccountControl, "TBTCMinted")
          .withArgs(user.address, mintAmount, satoshis)
        
        // Should also call auto-mint flow
        expect(mockBank.transferBalanceFrom).to.have.been.calledWith(
          user.address,
          qcMinter.address,
          satoshis
        )
        expect(mockTBTCVault.mint).to.have.been.calledWith(mintAmount)
        expect(mockTBTC.transfer).to.have.been.calledWith(
          user.address,
          mintAmount
        )
      })

      it("should emit AutoMintCompleted when auto-mint succeeds", async () => {
        const permitData = "0x"
        
        await expect(
          qcMinter
            .connect(user)
            .requestQCMintHybrid(qcAddress.address, mintAmount, true, permitData)
        ).to.emit(qcMinter, "AutoMintCompleted")
          .withArgs(user.address, satoshis, mintAmount)
      })

      it("should not auto-mint when autoMint flag is false", async () => {
        const permitData = "0x"

        const MockAccountControl = await ethers.getContractFactory("MockAccountControl")
        const mockAccountControl = MockAccountControl.attach(
          await qcMinter.accountControl()
        )

        const tx = await qcMinter
          .connect(user)
          .requestQCMintHybrid(qcAddress.address, mintAmount, false, permitData)

        // Should call AccountControl.mintTBTC
        await expect(tx)
          .to.emit(mockAccountControl, "TBTCMinted")
          .withArgs(user.address, mintAmount, satoshis)
        
        // Should NOT call auto-mint flow
        expect(mockBank.transferBalanceFrom).to.not.have.been.called
        expect(mockTBTCVault.mint).to.not.have.been.called
        expect(mockTBTC.transfer).to.not.have.been.called
      })

      it("should not auto-mint when auto-minting is disabled", async () => {
        await qcMinter.setAutoMintEnabled(false)
        const permitData = "0x"

        const MockAccountControl = await ethers.getContractFactory("MockAccountControl")
        const mockAccountControl = MockAccountControl.attach(
          await qcMinter.accountControl()
        )

        const tx = await qcMinter
          .connect(user)
          .requestQCMintHybrid(qcAddress.address, mintAmount, true, permitData)

        // Should call AccountControl.mintTBTC
        await expect(tx)
          .to.emit(mockAccountControl, "TBTCMinted")
          .withArgs(user.address, mintAmount, satoshis)
        
        // Should NOT call auto-mint flow
        expect(mockBank.transferBalanceFrom).to.not.have.been.called
      })

      it("should revert when insufficient allowance for auto-mint", async () => {
        mockBank.allowance.returns(satoshis.sub(1))
        const permitData = "0x"
        
        await expect(
          qcMinter
            .connect(user)
            .requestQCMintHybrid(qcAddress.address, mintAmount, true, permitData)
        ).to.be.revertedWith("InsufficientBalance")
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
