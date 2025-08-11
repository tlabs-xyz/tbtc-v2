import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { QCData } from "../../typechain"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCData", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qcAddress: SignerWithAddress
  let qcManager: SignerWithAddress
  let thirdParty: SignerWithAddress

  let qcData: QCData

  // Test data
  const testBtcAddress = "bc1qtest123456789"
  const testBtcAddress2 = "bc1qtest987654321"
  const testReason = ethers.utils.id("TEST_REASON")
  const mintedAmount = ethers.utils.parseEther("5")

  before(async () => {
    const signers = await ethers.getSigners()
    deployer = signers[0]
    governance = signers[1]
    qcAddress = signers[2]
    qcManager = signers[3]
    thirdParty = signers[4]
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy QCData
    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy()
    await qcData.deployed()

    // Grant QC_MANAGER_ROLE to qcManager
    const QC_MANAGER_ROLE = await qcData.QC_MANAGER_ROLE()
    await qcData.grantRole(QC_MANAGER_ROLE, qcManager.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment", () => {
    it("should grant deployer default admin role", async () => {
      const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
      expect(await qcData.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be
        .true
    })

    it("should have correct role constants", async () => {
      const QC_MANAGER_ROLE = ethers.utils.id("QC_MANAGER_ROLE")
      expect(await qcData.QC_MANAGER_ROLE()).to.equal(QC_MANAGER_ROLE)
    })
  })

  describe("QC Registration", () => {
    context("when called by QC manager", () => {
      it("should register QC successfully", async () => {
        const tx = await qcData
          .connect(qcManager)
          .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))

        expect(await qcData.isQCRegistered(qcAddress.address)).to.be.true
        expect(await qcData.getQCStatus(qcAddress.address)).to.equal(0) // Active
        expect(await qcData.getQCMintedAmount(qcAddress.address)).to.equal(0)

        await expect(tx)
          .to.emit(qcData, "QCRegistered")
          .withArgs(
            qcAddress.address,
            qcManager.address,
            ethers.utils.parseEther("1000"),
            await ethers.provider
              .getBlock(tx.blockNumber!)
              .then((b) => b.timestamp)
          )
      })

      it("should revert when QC already registered", async () => {
        await qcData
          .connect(qcManager)
          .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))

        await expect(
          qcData
            .connect(qcManager)
            .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))
        ).to.be.revertedWith("QCAlreadyRegistered")
      })

      it("should revert with zero address", async () => {
        await expect(
          qcData
            .connect(qcManager)
            .registerQC(
              ethers.constants.AddressZero,
              ethers.utils.parseEther("1000")
            )
        ).to.be.revertedWith("InvalidQCAddress")
      })

      it("should revert with zero minting capacity", async () => {
        await expect(
          qcData.connect(qcManager).registerQC(qcAddress.address, 0)
        ).to.be.revertedWith("InvalidMintingCapacity")
      })
    })

    context("when called by non-manager", () => {
      it("should revert", async () => {
        const QC_MANAGER_ROLE = await qcData.QC_MANAGER_ROLE()
        await expect(
          qcData
            .connect(thirdParty)
            .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${QC_MANAGER_ROLE}`
        )
      })
    })
  })

  describe("QC Status Management", () => {
    beforeEach(async () => {
      await qcData
        .connect(qcManager)
        .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))
    })

    context("when called by QC manager", () => {
      it("should update QC status successfully", async () => {
        const tx = await qcData
          .connect(qcManager)
          .setQCStatus(qcAddress.address, 1, testReason) // Active -> UnderReview

        expect(await qcData.getQCStatus(qcAddress.address)).to.equal(1)

        await expect(tx)
          .to.emit(qcData, "QCStatusChanged")
          .withArgs(
            qcAddress.address,
            0,
            1,
            testReason,
            qcManager.address,
            await ethers.provider
              .getBlock(tx.blockNumber!)
              .then((b) => b.timestamp)
          )
      })

      it("should handle all valid status values", async () => {
        // Active (0)
        expect(await qcData.getQCStatus(qcAddress.address)).to.equal(0)

        // UnderReview (1)
        await qcData
          .connect(qcManager)
          .setQCStatus(qcAddress.address, 1, testReason)
        expect(await qcData.getQCStatus(qcAddress.address)).to.equal(1)

        // Revoked (2)
        await qcData
          .connect(qcManager)
          .setQCStatus(qcAddress.address, 2, testReason)
        expect(await qcData.getQCStatus(qcAddress.address)).to.equal(2)
      })

      it("should revert when QC not registered", async () => {
        await expect(
          qcData
            .connect(qcManager)
            .setQCStatus(thirdParty.address, 1, testReason)
        ).to.be.revertedWith("QCNotRegistered")
      })

      it("should update status to UnderReview", async () => {
        const tx = await qcData
          .connect(qcManager)
          .setQCStatus(qcAddress.address, 3, testReason) // UnderReview status

        expect(await qcData.getQCStatus(qcAddress.address)).to.equal(3)

        await expect(tx)
          .to.emit(qcData, "QCStatusChanged")
          .withArgs(
            qcAddress.address,
            0, // old status (Active)
            3, // new status (UnderReview)
            testReason,
            qcManager.address,
            await ethers.provider
              .getBlock(tx.blockNumber!)
              .then((b) => b.timestamp)
          )
      })
    })

    context("when called by non-manager", () => {
      it("should revert", async () => {
        const QC_MANAGER_ROLE = await qcData.QC_MANAGER_ROLE()
        await expect(
          qcData
            .connect(thirdParty)
            .setQCStatus(qcAddress.address, 1, testReason)
        ).to.be.revertedWith(
          "Caller must have QC_MANAGER_ROLE or STATE_MANAGER_ROLE"
        )
      })
    })
  })

  describe("Minted Amount Management", () => {
    beforeEach(async () => {
      await qcData
        .connect(qcManager)
        .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))
    })

    context("when called by QC manager", () => {
      it("should update minted amount successfully", async () => {
        const tx = await qcData
          .connect(qcManager)
          .updateQCMintedAmount(qcAddress.address, mintedAmount)

        expect(await qcData.getQCMintedAmount(qcAddress.address)).to.equal(
          mintedAmount
        )

        await expect(tx)
          .to.emit(qcData, "QCMintedAmountUpdated")
          .withArgs(
            qcAddress.address,
            0,
            mintedAmount,
            qcManager.address,
            await ethers.provider
              .getBlock(tx.blockNumber!)
              .then((b) => b.timestamp)
          )
      })

      it("should handle zero amount", async () => {
        await qcData
          .connect(qcManager)
          .updateQCMintedAmount(qcAddress.address, mintedAmount)
        await qcData
          .connect(qcManager)
          .updateQCMintedAmount(qcAddress.address, 0)

        expect(await qcData.getQCMintedAmount(qcAddress.address)).to.equal(0)
      })

      it("should handle large amounts", async () => {
        const largeAmount = ethers.utils.parseEther("1000000")
        await qcData
          .connect(qcManager)
          .updateQCMintedAmount(qcAddress.address, largeAmount)

        expect(await qcData.getQCMintedAmount(qcAddress.address)).to.equal(
          largeAmount
        )
      })

      it("should revert when QC not registered", async () => {
        await expect(
          qcData
            .connect(qcManager)
            .updateQCMintedAmount(thirdParty.address, mintedAmount)
        ).to.be.revertedWith("QCNotRegistered")
      })
    })

    context("when called by non-manager", () => {
      it("should revert", async () => {
        const QC_MANAGER_ROLE = await qcData.QC_MANAGER_ROLE()
        await expect(
          qcData
            .connect(thirdParty)
            .updateQCMintedAmount(qcAddress.address, mintedAmount)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${QC_MANAGER_ROLE}`
        )
      })
    })
  })

  describe("Wallet Registration", () => {
    beforeEach(async () => {
      await qcData
        .connect(qcManager)
        .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))
    })

    context("when called by QC manager", () => {
      it("should register wallet successfully", async () => {
        const tx = await qcData
          .connect(qcManager)
          .registerWallet(qcAddress.address, testBtcAddress)

        expect(await qcData.getWalletOwner(testBtcAddress)).to.equal(
          qcAddress.address
        )
        expect(await qcData.getWalletStatus(testBtcAddress)).to.equal(1) // Active

        const wallets = await qcData.getQCWallets(qcAddress.address)
        expect(wallets).to.include(testBtcAddress)

        await expect(tx)
          .to.emit(qcData, "WalletRegistered")
          .withArgs(
            qcAddress.address,
            testBtcAddress,
            qcManager.address,
            await ethers.provider
              .getBlock(tx.blockNumber!)
              .then((b) => b.timestamp)
          )
      })

      it("should register multiple wallets for same QC", async () => {
        await qcData
          .connect(qcManager)
          .registerWallet(qcAddress.address, testBtcAddress)
        await qcData
          .connect(qcManager)
          .registerWallet(qcAddress.address, testBtcAddress2)

        const wallets = await qcData.getQCWallets(qcAddress.address)
        expect(wallets).to.have.length(2)
        expect(wallets).to.include(testBtcAddress)
        expect(wallets).to.include(testBtcAddress2)
      })

      it("should revert when wallet already registered", async () => {
        await qcData
          .connect(qcManager)
          .registerWallet(qcAddress.address, testBtcAddress)

        await expect(
          qcData
            .connect(qcManager)
            .registerWallet(qcAddress.address, testBtcAddress)
        ).to.be.revertedWith("WalletAlreadyRegistered")
      })

      it("should revert when QC not registered", async () => {
        await expect(
          qcData
            .connect(qcManager)
            .registerWallet(thirdParty.address, testBtcAddress)
        ).to.be.revertedWith("QCNotRegistered")
      })

      it("should revert with empty wallet address", async () => {
        await expect(
          qcData.connect(qcManager).registerWallet(qcAddress.address, "")
        ).to.be.revertedWith("InvalidWalletAddress")
      })
    })

    context("when called by non-manager", () => {
      it("should revert", async () => {
        const QC_MANAGER_ROLE = await qcData.QC_MANAGER_ROLE()
        await expect(
          qcData
            .connect(thirdParty)
            .registerWallet(qcAddress.address, testBtcAddress)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${QC_MANAGER_ROLE}`
        )
      })
    })
  })

  describe("Wallet Deregistration", () => {
    beforeEach(async () => {
      await qcData
        .connect(qcManager)
        .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))
      await qcData
        .connect(qcManager)
        .registerWallet(qcAddress.address, testBtcAddress)
    })

    context("request deregistration", () => {
      it("should request deregistration successfully", async () => {
        const tx = await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)

        expect(await qcData.getWalletStatus(testBtcAddress)).to.equal(2) // PendingDeRegistration

        await expect(tx)
          .to.emit(qcData, "WalletDeRegistrationRequested")
          .withArgs(
            qcAddress.address,
            testBtcAddress,
            qcManager.address,
            await ethers.provider
              .getBlock(tx.blockNumber!)
              .then((b) => b.timestamp)
          )
      })

      it("should revert when wallet not registered", async () => {
        await expect(
          qcData.connect(qcManager).requestWalletDeRegistration(testBtcAddress2)
        ).to.be.revertedWith("WalletNotRegistered")
      })

      it("should revert when wallet not active", async () => {
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)

        await expect(
          qcData.connect(qcManager).requestWalletDeRegistration(testBtcAddress)
        ).to.be.revertedWith("WalletNotActive")
      })
    })

    context("finalize deregistration", () => {
      beforeEach(async () => {
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)
      })

      it("should finalize deregistration successfully", async () => {
        const tx = await qcData
          .connect(qcManager)
          .finalizeWalletDeRegistration(testBtcAddress)

        expect(await qcData.getWalletOwner(testBtcAddress)).to.equal(
          qcAddress.address // QC address preserved for audit trail
        )
        expect(await qcData.getWalletStatus(testBtcAddress)).to.equal(3) // Deregistered

        const wallets = await qcData.getQCWallets(qcAddress.address)
        expect(wallets).to.not.include(testBtcAddress)

        await expect(tx)
          .to.emit(qcData, "WalletDeRegistrationFinalized")
          .withArgs(
            qcAddress.address,
            testBtcAddress,
            qcManager.address,
            await ethers.provider
              .getBlock(tx.blockNumber!)
              .then((b) => b.timestamp)
          )
      })

      it("should revert when wallet not registered", async () => {
        await expect(
          qcData
            .connect(qcManager)
            .finalizeWalletDeRegistration(testBtcAddress2)
        ).to.be.revertedWith("WalletNotRegistered")
      })

      it("should revert when wallet not pending deregistration", async () => {
        await qcData
          .connect(qcManager)
          .finalizeWalletDeRegistration(testBtcAddress)

        await expect(
          qcData.connect(qcManager).finalizeWalletDeRegistration(testBtcAddress)
        ).to.be.revertedWith("WalletNotPendingDeregistration")
      })
    })
  })

  describe("View Functions", () => {
    beforeEach(async () => {
      await qcData
        .connect(qcManager)
        .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))
      await qcData
        .connect(qcManager)
        .registerWallet(qcAddress.address, testBtcAddress)
      await qcData
        .connect(qcManager)
        .registerWallet(qcAddress.address, testBtcAddress2)
    })

    describe("isQCRegistered", () => {
      it("should return true for registered QC", async () => {
        expect(await qcData.isQCRegistered(qcAddress.address)).to.be.true
      })

      it("should return false for unregistered QC", async () => {
        expect(await qcData.isQCRegistered(thirdParty.address)).to.be.false
      })
    })

    describe("getQCStatus", () => {
      it("should return correct status", async () => {
        expect(await qcData.getQCStatus(qcAddress.address)).to.equal(0) // Active

        await qcData
          .connect(qcManager)
          .setQCStatus(qcAddress.address, 1, testReason)
        expect(await qcData.getQCStatus(qcAddress.address)).to.equal(1) // UnderReview
      })

      it("should return 0 for unregistered QC", async () => {
        expect(await qcData.getQCStatus(thirdParty.address)).to.equal(0)
      })
    })

    describe("getQCMintedAmount", () => {
      it("should return correct minted amount", async () => {
        expect(await qcData.getQCMintedAmount(qcAddress.address)).to.equal(0)

        await qcData
          .connect(qcManager)
          .updateQCMintedAmount(qcAddress.address, mintedAmount)
        expect(await qcData.getQCMintedAmount(qcAddress.address)).to.equal(
          mintedAmount
        )
      })

      it("should return 0 for unregistered QC", async () => {
        expect(await qcData.getQCMintedAmount(thirdParty.address)).to.equal(0)
      })
    })

    describe("getQCWallets", () => {
      it("should return all registered wallets", async () => {
        const wallets = await qcData.getQCWallets(qcAddress.address)
        expect(wallets).to.have.length(2)
        expect(wallets).to.include(testBtcAddress)
        expect(wallets).to.include(testBtcAddress2)
      })

      it("should return empty array for unregistered QC", async () => {
        const wallets = await qcData.getQCWallets(thirdParty.address)
        expect(wallets).to.have.length(0)
      })

      it("should update when wallets are deregistered", async () => {
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)
        await qcData
          .connect(qcManager)
          .finalizeWalletDeRegistration(testBtcAddress)

        const wallets = await qcData.getQCWallets(qcAddress.address)
        expect(wallets).to.have.length(1)
        expect(wallets).to.include(testBtcAddress2)
        expect(wallets).to.not.include(testBtcAddress)
      })
    })

    describe("getWalletOwner", () => {
      it("should return correct owner", async () => {
        expect(await qcData.getWalletOwner(testBtcAddress)).to.equal(
          qcAddress.address
        )
      })

      it("should return zero address for unregistered wallet", async () => {
        expect(await qcData.getWalletOwner("bc1qunregistered")).to.equal(
          ethers.constants.AddressZero
        )
      })

      it("should preserve owner address for deregistered wallet", async () => {
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)
        await qcData
          .connect(qcManager)
          .finalizeWalletDeRegistration(testBtcAddress)

        expect(await qcData.getWalletOwner(testBtcAddress)).to.equal(
          qcAddress.address
        )
      })
    })

    describe("getWalletStatus", () => {
      it("should return correct status", async () => {
        expect(await qcData.getWalletStatus(testBtcAddress)).to.equal(1) // Active

        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)
        expect(await qcData.getWalletStatus(testBtcAddress)).to.equal(2) // PendingDeRegistration
      })

      it("should return 0 for unregistered wallet", async () => {
        expect(await qcData.getWalletStatus("bc1qunregistered")).to.equal(0) // Inactive
      })

      it("should return correct status after deregistration", async () => {
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)
        await qcData
          .connect(qcManager)
          .finalizeWalletDeRegistration(testBtcAddress)

        expect(await qcData.getWalletStatus(testBtcAddress)).to.equal(3) // Deregistered
      })
    })
  })

  describe("Edge Cases", () => {
    context("wallet status transitions", () => {
      beforeEach(async () => {
        await qcData
          .connect(qcManager)
          .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))
        await qcData
          .connect(qcManager)
          .registerWallet(qcAddress.address, testBtcAddress)
      })

      it("should handle complete deregistration cycle", async () => {
        // Initial: Active
        expect(await qcData.getWalletStatus(testBtcAddress)).to.equal(1)

        // Request deregistration: PendingDeRegistration
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)
        expect(await qcData.getWalletStatus(testBtcAddress)).to.equal(2)

        // Finalize deregistration: Deregistered
        await qcData
          .connect(qcManager)
          .finalizeWalletDeRegistration(testBtcAddress)
        expect(await qcData.getWalletStatus(testBtcAddress)).to.equal(3)
      })
    })

    context("multiple QCs with same wallet address", () => {
      it("should prevent registering same wallet to different QCs", async () => {
        const qc2 = governance.address

        await qcData
          .connect(qcManager)
          .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))
        await qcData
          .connect(qcManager)
          .registerQC(qc2, ethers.utils.parseEther("1000"))

        await qcData
          .connect(qcManager)
          .registerWallet(qcAddress.address, testBtcAddress)

        await expect(
          qcData.connect(qcManager).registerWallet(qc2, testBtcAddress)
        ).to.be.revertedWith("WalletAlreadyRegistered")
      })
    })

    context("boundary conditions", () => {
      it("should handle maximum length wallet addresses", async () => {
        await qcData
          .connect(qcManager)
          .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))

        const longWalletAddress = `bc1q${"a".repeat(60)}` // Very long but valid format
        await qcData
          .connect(qcManager)
          .registerWallet(qcAddress.address, longWalletAddress)

        expect(await qcData.getWalletOwner(longWalletAddress)).to.equal(
          qcAddress.address
        )
      })

      it("should handle maximum minted amounts", async () => {
        await qcData
          .connect(qcManager)
          .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))

        const maxAmount = ethers.constants.MaxUint256
        await qcData
          .connect(qcManager)
          .updateQCMintedAmount(qcAddress.address, maxAmount)

        expect(await qcData.getQCMintedAmount(qcAddress.address)).to.equal(
          maxAmount
        )
      })
    })
  })

  describe("New Utility Functions", () => {
    beforeEach(async () => {
      await qcData
        .connect(qcManager)
        .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))
      await qcData
        .connect(qcManager)
        .registerWallet(qcAddress.address, testBtcAddress)
    })

    describe("isWalletActive", () => {
      it("should return true for active wallet", async () => {
        expect(await qcData.isWalletActive(testBtcAddress)).to.be.true
      })

      it("should return false for pending deregistration wallet", async () => {
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)
        expect(await qcData.isWalletActive(testBtcAddress)).to.be.false
      })

      it("should return false for deregistered wallet", async () => {
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)
        await qcData
          .connect(qcManager)
          .finalizeWalletDeRegistration(testBtcAddress)
        expect(await qcData.isWalletActive(testBtcAddress)).to.be.false
      })

      it("should return false for unregistered wallet", async () => {
        expect(await qcData.isWalletActive("bc1qunregistered")).to.be.false
      })
    })

    describe("isWalletDeregistered", () => {
      it("should return false for active wallet", async () => {
        expect(await qcData.isWalletDeregistered(testBtcAddress)).to.be.false
      })

      it("should return false for pending deregistration wallet", async () => {
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)
        expect(await qcData.isWalletDeregistered(testBtcAddress)).to.be.false
      })

      it("should return true for deregistered wallet", async () => {
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)
        await qcData
          .connect(qcManager)
          .finalizeWalletDeRegistration(testBtcAddress)
        expect(await qcData.isWalletDeregistered(testBtcAddress)).to.be.true
      })

      it("should return false for unregistered wallet", async () => {
        expect(await qcData.isWalletDeregistered("bc1qunregistered")).to.be
          .false
      })
    })

    describe("canActivateWallet", () => {
      it("should return false for active wallet", async () => {
        expect(await qcData.canActivateWallet(testBtcAddress)).to.be.false
      })

      it("should return false for pending deregistration wallet", async () => {
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)
        expect(await qcData.canActivateWallet(testBtcAddress)).to.be.false
      })

      it("should return false for deregistered wallet", async () => {
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)
        await qcData
          .connect(qcManager)
          .finalizeWalletDeRegistration(testBtcAddress)
        expect(await qcData.canActivateWallet(testBtcAddress)).to.be.false
      })

      it("should return false for unregistered wallet", async () => {
        expect(await qcData.canActivateWallet("bc1qunregistered")).to.be.false
      })
    })
  })

  describe("Enhanced State Machine Tests", () => {
    beforeEach(async () => {
      await qcData
        .connect(qcManager)
        .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))
      await qcData
        .connect(qcManager)
        .registerWallet(qcAddress.address, testBtcAddress)
    })

    describe("comprehensive state transitions", () => {
      it("should handle full lifecycle: Active -> PendingDeRegistration -> Deregistered", async () => {
        // Start: Active
        expect(await qcData.getWalletStatus(testBtcAddress)).to.equal(1)
        expect(await qcData.isWalletActive(testBtcAddress)).to.be.true
        expect(await qcData.isWalletDeregistered(testBtcAddress)).to.be.false
        expect(await qcData.canActivateWallet(testBtcAddress)).to.be.false

        // Request deregistration: PendingDeRegistration
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)

        expect(await qcData.getWalletStatus(testBtcAddress)).to.equal(2)
        expect(await qcData.isWalletActive(testBtcAddress)).to.be.false
        expect(await qcData.isWalletDeregistered(testBtcAddress)).to.be.false
        expect(await qcData.canActivateWallet(testBtcAddress)).to.be.false

        // Finalize deregistration: Deregistered
        await qcData
          .connect(qcManager)
          .finalizeWalletDeRegistration(testBtcAddress)

        expect(await qcData.getWalletStatus(testBtcAddress)).to.equal(3)
        expect(await qcData.isWalletActive(testBtcAddress)).to.be.false
        expect(await qcData.isWalletDeregistered(testBtcAddress)).to.be.true
        expect(await qcData.canActivateWallet(testBtcAddress)).to.be.false

        // QC address should be preserved for audit trail
        expect(await qcData.getWalletOwner(testBtcAddress)).to.equal(
          qcAddress.address
        )
      })

      it("should prevent reactivation of deregistered wallet", async () => {
        // Complete deregistration
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)
        await qcData
          .connect(qcManager)
          .finalizeWalletDeRegistration(testBtcAddress)

        // Attempting to register the same wallet should fail
        await expect(
          qcData
            .connect(qcManager)
            .registerWallet(qcAddress.address, testBtcAddress)
        ).to.be.revertedWith("WalletAlreadyRegistered")
      })

      it("should prevent double deregistration request", async () => {
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)

        await expect(
          qcData.connect(qcManager).requestWalletDeRegistration(testBtcAddress)
        ).to.be.revertedWith("WalletNotActive")
      })

      it("should prevent direct finalization without request", async () => {
        await expect(
          qcData.connect(qcManager).finalizeWalletDeRegistration(testBtcAddress)
        ).to.be.revertedWith("WalletNotPendingDeregistration")
      })
    })

    describe("audit trail preservation", () => {
      it("should maintain complete audit trail after deregistration", async () => {
        const initialOwner = await qcData.getWalletOwner(testBtcAddress)
        const initialWallets = await qcData.getQCWallets(qcAddress.address)

        // Complete deregistration
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)
        await qcData
          .connect(qcManager)
          .finalizeWalletDeRegistration(testBtcAddress)

        // Owner address preserved for audit
        expect(await qcData.getWalletOwner(testBtcAddress)).to.equal(
          initialOwner
        )

        // Status clearly indicates deregistration
        expect(await qcData.getWalletStatus(testBtcAddress)).to.equal(3) // Deregistered

        // Wallet removed from active list
        const finalWallets = await qcData.getQCWallets(qcAddress.address)
        expect(finalWallets.length).to.equal(initialWallets.length - 1)
        expect(finalWallets).to.not.include(testBtcAddress)
      })
    })

    describe("state machine edge cases", () => {
      it("should handle rapid state transitions correctly", async () => {
        // Multiple rapid transitions should work correctly
        // eslint-disable-next-line no-await-in-loop
        for (let i = 0; i < 3; i++) {
          const wallet = `${testBtcAddress}${i}`
          // eslint-disable-next-line no-await-in-loop
          await qcData
            .connect(qcManager)
            .registerWallet(qcAddress.address, wallet)

          // eslint-disable-next-line no-await-in-loop
          expect(await qcData.getWalletStatus(wallet)).to.equal(1) // Active

          // eslint-disable-next-line no-await-in-loop
          await qcData.connect(qcManager).requestWalletDeRegistration(wallet)

          // eslint-disable-next-line no-await-in-loop
          expect(await qcData.getWalletStatus(wallet)).to.equal(2) // Pending

          // eslint-disable-next-line no-await-in-loop
          await qcData.connect(qcManager).finalizeWalletDeRegistration(wallet)

          // eslint-disable-next-line no-await-in-loop
          expect(await qcData.getWalletStatus(wallet)).to.equal(3) // Deregistered
        }
      })

      it("should maintain state consistency under concurrent operations", async () => {
        // Register multiple wallets
        await qcData
          .connect(qcManager)
          .registerWallet(qcAddress.address, testBtcAddress2)

        const wallet1Status = await qcData.getWalletStatus(testBtcAddress)
        const wallet2Status = await qcData.getWalletStatus(testBtcAddress2)

        expect(wallet1Status).to.equal(1) // Both should be Active
        expect(wallet2Status).to.equal(1)

        // Deregister one, check the other remains unaffected
        await qcData
          .connect(qcManager)
          .requestWalletDeRegistration(testBtcAddress)

        expect(await qcData.getWalletStatus(testBtcAddress)).to.equal(2) // Pending
        expect(await qcData.getWalletStatus(testBtcAddress2)).to.equal(1) // Still Active
      })
    })
  })

  describe("Role Management", () => {
    const QC_MANAGER_ROLE = ethers.utils.id("QC_MANAGER_ROLE")

    beforeEach(async () => {
      // Register a QC first
      await qcData
        .connect(qcManager)
        .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))
    })

    describe("grantQCManagerRole", () => {
      it("should grant QC_MANAGER_ROLE to valid address", async () => {
        const newManager = thirdParty

        const tx = await qcData.grantQCManagerRole(newManager.address)

        expect(await qcData.hasRole(QC_MANAGER_ROLE, newManager.address)).to.be
          .true

        const currentBlock = await ethers.provider.getBlock(tx.blockNumber!)
        await expect(tx)
          .to.emit(qcData, "RoleGranted")
          .withArgs(QC_MANAGER_ROLE, newManager.address, deployer.address)
      })

      it("should revert with zero address", async () => {
        await expect(
          qcData.grantQCManagerRole(ethers.constants.AddressZero)
        ).to.be.revertedWith("InvalidManagerAddress")
      })

      it("should allow multiple managers", async () => {
        const manager1 = thirdParty
        const manager2 = governance

        await qcData.grantQCManagerRole(manager1.address)
        await qcData.grantQCManagerRole(manager2.address)

        expect(await qcData.hasRole(QC_MANAGER_ROLE, manager1.address)).to.be
          .true
        expect(await qcData.hasRole(QC_MANAGER_ROLE, manager2.address)).to.be
          .true
      })

      it("should only be callable by admin", async () => {
        await expect(
          qcData.connect(thirdParty).grantQCManagerRole(governance.address)
        ).to.be.revertedWith("AccessControl: account")
      })
    })

    describe("revokeQCManagerRole", () => {
      beforeEach(async () => {
        // Grant role first
        await qcData.grantQCManagerRole(thirdParty.address)
      })

      it("should revoke QC_MANAGER_ROLE from address", async () => {
        const tx = await qcData.revokeQCManagerRole(thirdParty.address)

        expect(await qcData.hasRole(QC_MANAGER_ROLE, thirdParty.address)).to.be
          .false

        await expect(tx)
          .to.emit(qcData, "RoleRevoked")
          .withArgs(QC_MANAGER_ROLE, thirdParty.address, deployer.address)
      })

      it("should succeed with zero address (no validation)", async () => {
        // OpenZeppelin _revokeRole doesn't validate zero address
        await expect(qcData.revokeQCManagerRole(ethers.constants.AddressZero))
          .to.not.be.reverted
      })

      it("should succeed when role not granted (no validation)", async () => {
        // OpenZeppelin _revokeRole succeeds even if role not granted
        await expect(qcData.revokeQCManagerRole(governance.address)).to.not.be
          .reverted
      })

      it("should only be callable by admin", async () => {
        await expect(
          qcData.connect(thirdParty).revokeQCManagerRole(thirdParty.address)
        ).to.be.revertedWith("AccessControl: account")
      })
    })
  })

  describe("Minting Capacity Management", () => {
    const testCapacity = ethers.utils.parseEther("1000")
    const updatedCapacity = ethers.utils.parseEther("2000")

    beforeEach(async () => {
      // Register a QC first
      await qcData
        .connect(qcManager)
        .registerQC(qcAddress.address, testCapacity)
    })

    describe("updateMaxMintingCapacity", () => {
      it("should update max minting capacity and emit event", async () => {
        const tx = await qcData
          .connect(qcManager)
          .updateMaxMintingCapacity(qcAddress.address, testCapacity)

        expect(await qcData.getMaxMintingCapacity(qcAddress.address)).to.equal(
          testCapacity
        )

        const currentBlock = await ethers.provider.getBlock(tx.blockNumber!)
        await expect(tx)
          .to.emit(qcData, "QCMaxMintingCapacityUpdated")
          .withArgs(
            qcAddress.address,
            testCapacity, // oldCapacity (set in beforeEach)
            testCapacity, // newCapacity (same as testCapacity)
            qcManager.address,
            currentBlock.timestamp
          )
      })

      it("should allow updating capacity multiple times", async () => {
        await qcData
          .connect(qcManager)
          .updateMaxMintingCapacity(qcAddress.address, testCapacity)

        const tx = await qcData
          .connect(qcManager)
          .updateMaxMintingCapacity(qcAddress.address, updatedCapacity)

        expect(await qcData.getMaxMintingCapacity(qcAddress.address)).to.equal(
          updatedCapacity
        )

        const currentBlock = await ethers.provider.getBlock(tx.blockNumber!)
        await expect(tx)
          .to.emit(qcData, "QCMaxMintingCapacityUpdated")
          .withArgs(
            qcAddress.address,
            testCapacity, // oldCapacity (first capacity set)
            updatedCapacity, // newCapacity
            qcManager.address,
            currentBlock.timestamp
          )
      })

      it("should revert with zero capacity", async () => {
        await expect(
          qcData
            .connect(qcManager)
            .updateMaxMintingCapacity(qcAddress.address, 0)
        ).to.be.revertedWith("InvalidCapacity")
      })

      it("should revert if QC not registered", async () => {
        const unregisteredQC = governance.address

        await expect(
          qcData
            .connect(qcManager)
            .updateMaxMintingCapacity(unregisteredQC, testCapacity)
        ).to.be.revertedWith("QCNotRegistered")
      })

      it("should only be callable by QC manager", async () => {
        await expect(
          qcData
            .connect(thirdParty)
            .updateMaxMintingCapacity(qcAddress.address, testCapacity)
        ).to.be.revertedWith("AccessControl: account")
      })
    })

    describe("getMaxMintingCapacity", () => {
      it("should return correct capacity for registered QC", async () => {
        await qcData
          .connect(qcManager)
          .updateMaxMintingCapacity(qcAddress.address, testCapacity)

        const capacity = await qcData.getMaxMintingCapacity(qcAddress.address)
        expect(capacity).to.equal(testCapacity)
      })

      it("should return correct capacity for registered QC", async () => {
        const capacity = await qcData.getMaxMintingCapacity(qcAddress.address)
        expect(capacity).to.equal(testCapacity)
      })

      it("should return zero for unregistered QC", async () => {
        const unregisteredQC = governance.address
        const capacity = await qcData.getMaxMintingCapacity(unregisteredQC)
        expect(capacity).to.equal(0)
      })

      it("should be a view function with no gas cost", async () => {
        await qcData
          .connect(qcManager)
          .updateMaxMintingCapacity(qcAddress.address, testCapacity)

        const gasEstimate = await qcData.estimateGas.getMaxMintingCapacity(
          qcAddress.address
        )
        expect(gasEstimate).to.be.lt(30000) // Should be very cheap
      })
    })
  })
})
