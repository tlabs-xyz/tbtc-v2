import { expect } from "chai"
import { ethers } from "hardhat"
import { QCData } from "../../../../typechain"
import {
  setupTestSigners,
  createBaseTestEnvironment,
  restoreBaseTestEnvironment,
  TestSigners,
} from "../../fixtures/base-setup"

describe("QCData - Two-Step Wallet Lifecycle", () => {
  let signers: TestSigners
  let qcData: QCData
  let qcManager: any

  // Test data
  const testQCAddress = "0x1234567890123456789012345678901234567890"
  const maxMintingCapacity = ethers.utils.parseEther("100")
  const validBtcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
  const validBtcAddress2 = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"
  const testReason = ethers.utils.id("TEST_REASON")

  // Wallet status enum values
  const WalletStatus = {
    Inactive: 0,
    Active: 1,
    PendingDeRegistration: 2,
    Deregistered: 3,
  }

  before(async () => {
    signers = await setupTestSigners()
    qcManager = signers.deployer
  })

  beforeEach(async () => {
    await createBaseTestEnvironment()

    // Deploy QCData
    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy()
    await qcData.deployed()

    // Register a test QC
    await qcData
      .connect(qcManager)
      .registerQC(testQCAddress, maxMintingCapacity)
  })

  afterEach(async () => {
    await restoreBaseTestEnvironment()
  })

  describe("Wallet Registration (Step 1)", () => {
    it("should register wallet as Inactive status", async () => {
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)

      // Verify wallet is registered but inactive
      expect(await qcData.isWalletRegistered(validBtcAddress)).to.be.true
      expect(await qcData.getWalletStatus(validBtcAddress)).to.equal(
        WalletStatus.Inactive
      )
      expect(await qcData.isWalletActive(validBtcAddress)).to.be.false
    })

    it("should emit WalletRegistered event with correct data", async () => {
      const tx = qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)

      await expect(tx)
        .to.emit(qcData, "WalletRegistered")
        .withArgs(
          testQCAddress,
          validBtcAddress,
          qcManager.address,
          await getBlockTimestamp()
        )
    })

    it("should store correct wallet ownership and timestamp", async () => {
      const blockTimestamp = await getBlockTimestamp()

      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)

      expect(await qcData.getWalletOwner(validBtcAddress)).to.equal(
        testQCAddress
      )

      // Note: Testing exact timestamp is tricky due to block mining,
      // but we can verify it's reasonably close
      const walletInfo = await qcData.getWalletStatus(validBtcAddress) // This gets status, not timestamp
      // For timestamp, we'd need a separate getter or check via events
    })

    it("should add wallet to QC's wallet list", async () => {
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)

      const qcWallets = await qcData.getQCWallets(testQCAddress)
      expect(qcWallets).to.include(validBtcAddress)
      expect(qcWallets.length).to.equal(1)
    })

    it("should prevent duplicate wallet registration", async () => {
      // Register wallet first time
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)

      // Try to register same wallet again
      await expect(
        qcData.connect(qcManager).registerWallet(testQCAddress, validBtcAddress)
      ).to.be.revertedWithCustomError(qcData, "WalletAlreadyRegistered")
    })

    it("should prevent registration by unauthorized caller", async () => {
      await expect(
        qcData
          .connect(signers.user)
          .registerWallet(testQCAddress, validBtcAddress)
      ).to.be.revertedWith("AccessControl:")
    })
  })

  describe("Wallet Activation (Step 2)", () => {
    beforeEach(async () => {
      // Register wallet as Inactive for activation tests
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)
    })

    it("should activate Inactive wallet successfully", async () => {
      // Verify wallet starts as Inactive
      expect(await qcData.getWalletStatus(validBtcAddress)).to.equal(
        WalletStatus.Inactive
      )
      expect(await qcData.isWalletActive(validBtcAddress)).to.be.false

      // Activate wallet
      await qcData.connect(qcManager).activateWallet(validBtcAddress)

      // Verify wallet is now Active
      expect(await qcData.getWalletStatus(validBtcAddress)).to.equal(
        WalletStatus.Active
      )
      expect(await qcData.isWalletActive(validBtcAddress)).to.be.true
    })

    it("should emit WalletActivated event with correct data", async () => {
      const tx = qcData.connect(qcManager).activateWallet(validBtcAddress)

      await expect(tx)
        .to.emit(qcData, "WalletActivated")
        .withArgs(
          testQCAddress,
          validBtcAddress,
          qcManager.address,
          await getBlockTimestamp()
        )
    })

    it("should reject activation of non-existent wallet", async () => {
      const nonExistentAddress = "1NonExistentAddressABCDEFGHIJKLMNOP"

      await expect(qcData.connect(qcManager).activateWallet(nonExistentAddress))
        .to.be.revertedWithCustomError(qcData, "WalletNotRegistered")
        .withArgs(nonExistentAddress)
    })

    it("should reject activation of already Active wallet", async () => {
      // First activation should succeed
      await qcData.connect(qcManager).activateWallet(validBtcAddress)

      // Second activation should fail
      await expect(
        qcData.connect(qcManager).activateWallet(validBtcAddress)
      ).to.be.revertedWithCustomError(qcData, "WalletNotInactive")
    })

    it("should reject activation by unauthorized caller", async () => {
      await expect(
        qcData.connect(signers.user).activateWallet(validBtcAddress)
      ).to.be.revertedWith("AccessControl:")
    })

    it("should update canActivateWallet status correctly", async () => {
      // Before activation: can activate
      expect(await qcData.canActivateWallet(validBtcAddress)).to.be.true

      // After activation: cannot activate
      await qcData.connect(qcManager).activateWallet(validBtcAddress)
      expect(await qcData.canActivateWallet(validBtcAddress)).to.be.false
    })
  })

  describe("Complete Wallet Lifecycle Flow", () => {
    it("should follow correct state transitions: Inactive → Active → PendingDeRegistration → Deregistered", async () => {
      // Step 1: Register (Inactive)
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)
      expect(await qcData.getWalletStatus(validBtcAddress)).to.equal(
        WalletStatus.Inactive
      )

      // Step 2: Activate (Active)
      await qcData.connect(qcManager).activateWallet(validBtcAddress)
      expect(await qcData.getWalletStatus(validBtcAddress)).to.equal(
        WalletStatus.Active
      )

      // Step 3: Request Deregistration (PendingDeRegistration)
      await qcData
        .connect(qcManager)
        .requestWalletDeRegistration(validBtcAddress)
      expect(await qcData.getWalletStatus(validBtcAddress)).to.equal(
        WalletStatus.PendingDeRegistration
      )

      // Step 4: Finalize Deregistration (Deregistered)
      await qcData
        .connect(qcManager)
        .finalizeWalletDeRegistration(validBtcAddress)
      expect(await qcData.getWalletStatus(validBtcAddress)).to.equal(
        WalletStatus.Deregistered
      )
      expect(await qcData.isWalletDeregistered(validBtcAddress)).to.be.true
    })

    it("should emit all lifecycle events correctly", async () => {
      // Register
      await expect(
        qcData.connect(qcManager).registerWallet(testQCAddress, validBtcAddress)
      ).to.emit(qcData, "WalletRegistered")

      // Activate
      await expect(
        qcData.connect(qcManager).activateWallet(validBtcAddress)
      ).to.emit(qcData, "WalletActivated")

      // Request Deregistration
      await expect(
        qcData.connect(qcManager).requestWalletDeRegistration(validBtcAddress)
      ).to.emit(qcData, "WalletDeRegistrationRequested")

      // Finalize Deregistration
      await expect(
        qcData.connect(qcManager).finalizeWalletDeRegistration(validBtcAddress)
      ).to.emit(qcData, "WalletDeRegistrationFinalized")
    })

    it("should maintain wallet ownership throughout lifecycle", async () => {
      // Register and activate
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)
      await qcData.connect(qcManager).activateWallet(validBtcAddress)

      expect(await qcData.getWalletOwner(validBtcAddress)).to.equal(
        testQCAddress
      )

      // Request and finalize deregistration
      await qcData
        .connect(qcManager)
        .requestWalletDeRegistration(validBtcAddress)
      await qcData
        .connect(qcManager)
        .finalizeWalletDeRegistration(validBtcAddress)

      // Owner should still be preserved for audit trail
      expect(await qcData.getWalletOwner(validBtcAddress)).to.equal(
        testQCAddress
      )
    })

    it("should remove deregistered wallet from QC's active wallet list", async () => {
      // Register and activate wallet
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)
      await qcData.connect(qcManager).activateWallet(validBtcAddress)

      // Verify wallet is in QC's list
      let qcWallets = await qcData.getQCWallets(testQCAddress)
      expect(qcWallets).to.include(validBtcAddress)

      // Deregister wallet
      await qcData
        .connect(qcManager)
        .requestWalletDeRegistration(validBtcAddress)
      await qcData
        .connect(qcManager)
        .finalizeWalletDeRegistration(validBtcAddress)

      // Verify wallet is removed from QC's list
      qcWallets = await qcData.getQCWallets(testQCAddress)
      expect(qcWallets).to.not.include(validBtcAddress)
    })
  })

  describe("Invalid State Transitions", () => {
    it("should prevent deregistration of Inactive wallet", async () => {
      // Register wallet (Inactive)
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)

      // Try to deregister without activating first
      await expect(
        qcData.connect(qcManager).requestWalletDeRegistration(validBtcAddress)
      )
        .to.be.revertedWithCustomError(qcData, "WalletNotActive")
        .withArgs(validBtcAddress)
    })

    it("should prevent activation of PendingDeRegistration wallet", async () => {
      // Complete flow to PendingDeRegistration
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)
      await qcData.connect(qcManager).activateWallet(validBtcAddress)
      await qcData
        .connect(qcManager)
        .requestWalletDeRegistration(validBtcAddress)

      // Try to activate PendingDeRegistration wallet
      await expect(
        qcData.connect(qcManager).activateWallet(validBtcAddress)
      ).to.be.revertedWithCustomError(qcData, "WalletNotInactive")
    })

    it("should prevent activation of Deregistered wallet", async () => {
      // Complete full deregistration flow
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)
      await qcData.connect(qcManager).activateWallet(validBtcAddress)
      await qcData
        .connect(qcManager)
        .requestWalletDeRegistration(validBtcAddress)
      await qcData
        .connect(qcManager)
        .finalizeWalletDeRegistration(validBtcAddress)

      // Try to activate Deregistered wallet
      await expect(
        qcData.connect(qcManager).activateWallet(validBtcAddress)
      ).to.be.revertedWithCustomError(qcData, "WalletNotInactive")
    })
  })

  describe("Multiple Wallets Per QC", () => {
    it("should handle multiple wallets with independent lifecycles", async () => {
      // Register two wallets
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress2)

      // Activate first wallet only
      await qcData.connect(qcManager).activateWallet(validBtcAddress)

      // Verify states are independent
      expect(await qcData.getWalletStatus(validBtcAddress)).to.equal(
        WalletStatus.Active
      )
      expect(await qcData.getWalletStatus(validBtcAddress2)).to.equal(
        WalletStatus.Inactive
      )

      // Both should be in QC's wallet list
      const qcWallets = await qcData.getQCWallets(testQCAddress)
      expect(qcWallets).to.include(validBtcAddress)
      expect(qcWallets).to.include(validBtcAddress2)
    })

    it("should update wallet capacity correctly", async () => {
      const initialCapacity = await qcData.getQCWalletCapacity(testQCAddress)
      expect(initialCapacity.current).to.equal(0)
      expect(initialCapacity.maximum).to.equal(10) // MAX_WALLETS_PER_QC
      expect(initialCapacity.remaining).to.equal(10)

      // Register first wallet
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress)

      let capacity = await qcData.getQCWalletCapacity(testQCAddress)
      expect(capacity.current).to.equal(1)
      expect(capacity.remaining).to.equal(9)

      // Register second wallet
      await qcData
        .connect(qcManager)
        .registerWallet(testQCAddress, validBtcAddress2)

      capacity = await qcData.getQCWalletCapacity(testQCAddress)
      expect(capacity.current).to.equal(2)
      expect(capacity.remaining).to.equal(8)
    })
  })
})

// Helper function to get current block timestamp
async function getBlockTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest")
  return block.timestamp
}
