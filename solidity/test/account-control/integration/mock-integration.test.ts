import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import {
  AccountControl,
  MockReserve,
  MockBank,
  MockTBTCToken,
  MockTBTCVault
} from "../../../typechain"
import { setupTestEnvironment } from "../fixtures/base-setup"

/**
 * Mock-Based Integration Tests
 *
 * Tests direct backing management with mock reserves, batch minting operations,
 * and Bank integration through mock contracts.
 *
 * Consolidated from:
 * - MockReserveIntegration.test.ts (complete mock reserve integration scenarios)
 */
describe("Mock-Based Integration Tests", () => {
  let accountControl: AccountControl
  let mockReserve: MockReserve
  let mockReserve2: MockReserve
  let mockBank: MockBank
  let mockTbtcToken: MockTBTCToken
  let mockTbtcVault: MockTBTCVault

  let owner: SignerWithAddress
  let emergencyCouncil: SignerWithAddress
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let user3: SignerWithAddress
  let attacker: SignerWithAddress

  // Constants
  const ONE_BTC = ethers.utils.parseUnits("100000000", 0) // 1 BTC = 100,000,000 satoshis
  const HALF_BTC = ONE_BTC.div(2)
  const TEN_BTC = ONE_BTC.mul(10)

  beforeEach(async () => {
    [owner, emergencyCouncil, user1, user2, user3, attacker] = await ethers.getSigners()

    // Deploy mock contracts
    const MockBankFactory = await ethers.getContractFactory("MockBank")
    mockBank = await MockBankFactory.deploy() as MockBank

    const MockTBTCTokenFactory = await ethers.getContractFactory("MockTBTCToken")
    mockTbtcToken = await MockTBTCTokenFactory.deploy() as MockTBTCToken

    const MockTBTCVaultFactory = await ethers.getContractFactory("contracts/test/MockTBTCVault.sol:MockTBTCVault")
    mockTbtcVault = await MockTBTCVaultFactory.deploy() as MockTBTCVault

    // Deploy AccountControl
    const AccountControlFactory = await ethers.getContractFactory("AccountControl")
    accountControl = await AccountControlFactory.deploy()
    await accountControl.initialize(owner.address, emergencyCouncil.address, mockBank.address)

    // Authorize AccountControl to call MockBank functions
    await mockBank.authorizeBalanceIncreaser(accountControl.address)

    // Deploy MockReserves
    const MockReserveFactory = await ethers.getContractFactory("MockReserve")
    mockReserve = await MockReserveFactory.deploy(accountControl.address) as MockReserve
    mockReserve2 = await MockReserveFactory.deploy(accountControl.address) as MockReserve
  })

  describe("Reserve Authorization & Setup", () => {
    it("should authorize MOCK_RESERVE with minting cap", async () => {
      const mintingCap = TEN_BTC

      await expect(
        accountControl.connect(owner).authorizeReserve(mockReserve.address, mintingCap)
      ).to.emit(accountControl, "ReserveAuthorized")
        .withArgs(mockReserve.address, mintingCap)

      expect(await accountControl.isReserveAuthorized(mockReserve.address)).to.be.true
    })

    it("should initialize with zero backing and zero minted", async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC)

      expect(await accountControl.backing(mockReserve.address)).to.equal(0)
      expect(await accountControl.reserveMinted(mockReserve.address)).to.equal(0)
    })

    it("should assign correct minting cap", async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC)

      const mintingCap = await accountControl.mintingCaps(mockReserve.address)
      expect(mintingCap).to.equal(TEN_BTC)
    })

    it("should emit ReserveAuthorized event", async () => {
      await expect(
        accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC)
      ).to.emit(accountControl, "ReserveAuthorized")
        .withArgs(mockReserve.address, TEN_BTC)
    })
  })

  describe("Direct Backing Management (Federated Model)", () => {
    beforeEach(async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC)
    })

    it("should allow reserve to update its own backing", async () => {
      const newBacking = ONE_BTC

      await mockReserve.setBacking(newBacking)

      expect(await accountControl.backing(mockReserve.address)).to.equal(newBacking)
      expect(await mockReserve.reserveBacking()).to.equal(newBacking)
    })

    it("should emit BackingUpdated event with old and new values", async () => {
      const oldBacking = 0
      const newBacking = ONE_BTC

      await expect(mockReserve.setBacking(newBacking))
        .to.emit(mockReserve, "BackingChanged")
        .withArgs(oldBacking, newBacking)
    })

    it("should allow backing increases and decreases", async () => {
      // Increase backing
      await mockReserve.setBacking(TEN_BTC)
      expect(await accountControl.backing(mockReserve.address)).to.equal(TEN_BTC)

      // Decrease backing
      await mockReserve.setBacking(ONE_BTC)
      expect(await accountControl.backing(mockReserve.address)).to.equal(ONE_BTC)

      // Increase again
      await mockReserve.increaseBacking(HALF_BTC)
      expect(await accountControl.backing(mockReserve.address)).to.equal(ONE_BTC.add(HALF_BTC))
    })

    it("should handle zero backing scenarios", async () => {
      // Set to non-zero first
      await mockReserve.setBacking(ONE_BTC)
      expect(await accountControl.backing(mockReserve.address)).to.equal(ONE_BTC)

      // Set to zero
      await mockReserve.setBacking(0)
      expect(await accountControl.backing(mockReserve.address)).to.equal(0)

      // Should not be able to mint with zero backing
      const mintAmount = ethers.utils.parseEther("0.01") // Small amount to test
      await expect(
        mockReserve.mintTokens(user1.address, mintAmount)
      ).to.be.revertedWith("Insufficient backing")
    })

    it("should track backing history for transparency", async () => {
      const updates = [ONE_BTC, TEN_BTC, HALF_BTC, 0, ONE_BTC]

      for (const backing of updates) {
        await mockReserve.setBacking(backing)
        expect(await accountControl.backing(mockReserve.address)).to.equal(backing)
      }

      expect(await mockReserve.updateCount()).to.equal(updates.length)
    })
  })

  describe("Minting Operations via Bank Integration", () => {
    beforeEach(async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC)
      await mockReserve.setBacking(ONE_BTC)
    })

    it("should mint through Bank.increaseBalance() chain", async () => {
      const mintAmount = HALF_BTC

      // Check initial balance
      const initialBalance = await mockBank.balances(user1.address)

      await expect(mockReserve.mintTokens(user1.address, mintAmount))
        .to.emit(accountControl, "MintExecuted")
        .withArgs(mockReserve.address, user1.address, mintAmount)

      // Verify balance increased
      const finalBalance = await mockBank.balances(user1.address)
      expect(finalBalance.sub(initialBalance)).to.equal(mintAmount)
    })

    it("should enforce backing >= minted + amount invariant", async () => {
      const backing = ONE_BTC
      await mockReserve.setBacking(backing)

      // Mint up to backing limit
      await mockReserve.mintTokens(user1.address, backing)

      // Try to mint beyond backing - should fail
      await expect(
        mockReserve.mintTokens(user2.address, 1)
      ).to.be.revertedWith("Insufficient backing")
    })

    it("should support minting to different target addresses", async () => {
      const mintAmount = ethers.utils.parseEther("0.001")

      // Mint to multiple users
      await mockReserve.mintTokens(user1.address, mintAmount)
      await mockReserve.mintTokens(user2.address, mintAmount)
      await mockReserve.mintTokens(user3.address, mintAmount)

      // Verify balances
      expect(await mockBank.balances(user1.address)).to.equal(mintAmount)
      expect(await mockBank.balances(user2.address)).to.equal(mintAmount)
      expect(await mockBank.balances(user3.address)).to.equal(mintAmount)

      // Verify total minted tracking
      const totalMinted = await accountControl.totalMinted()
      const reserveMinted = await accountControl.reserveMinted(mockReserve.address)
      expect(totalMinted).to.equal(mintAmount.mul(3))
      expect(reserveMinted).to.equal(mintAmount.mul(3))
    })

    it("should update both reserve minted and total minted", async () => {
      const mintAmount = HALF_BTC

      const initialTotalMinted = await accountControl.totalMinted()
      const initialReserveMinted = await accountControl.reserveMinted(mockReserve.address)

      await mockReserve.mintTokens(user1.address, mintAmount)

      const finalTotalMinted = await accountControl.totalMinted()
      const finalReserveMinted = await accountControl.reserveMinted(mockReserve.address)

      expect(finalTotalMinted.sub(initialTotalMinted)).to.equal(mintAmount)
      expect(finalReserveMinted.sub(initialReserveMinted)).to.equal(mintAmount)
    })

    it("should revert on insufficient backing", async () => {
      const backing = HALF_BTC
      const excessiveMintAmount = ONE_BTC

      await mockReserve.setBacking(backing)

      await expect(
        mockReserve.mintTokens(user1.address, excessiveMintAmount)
      ).to.be.revertedWith("Insufficient backing")
    })

    it("should emit MintExecuted event", async () => {
      const mintAmount = HALF_BTC

      await expect(mockReserve.mintTokens(user1.address, mintAmount))
        .to.emit(accountControl, "MintExecuted")
        .withArgs(mockReserve.address, user1.address, mintAmount)
    })
  })

  describe("Batch Minting Optimization", () => {
    beforeEach(async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC)
      await mockReserve.setBacking(TEN_BTC)
    })

    it("should process batch mints in single transaction", async () => {
      const recipients = [user1.address, user2.address, user3.address]
      const amounts = [ONE_BTC, HALF_BTC, ONE_BTC.div(4)]

      await expect(mockReserve.batchMint(recipients, amounts))
        .to.emit(mockReserve, "BatchMintExecuted")
        .withArgs(recipients.length, amounts.reduce((sum, amount) => sum.add(amount), ethers.BigNumber.from(0)))

      // Verify all recipients received tokens
      expect(await mockBank.balances(user1.address)).to.equal(amounts[0])
      expect(await mockBank.balances(user2.address)).to.equal(amounts[1])
      expect(await mockBank.balances(user3.address)).to.equal(amounts[2])
    })

    it("should validate total amount against backing once", async () => {
      const recipients = [user1.address, user2.address]
      const amounts = [ONE_BTC.mul(6), ONE_BTC.mul(5)] // Total exceeds backing

      await expect(
        mockReserve.batchMint(recipients, amounts)
      ).to.be.revertedWith("Insufficient backing for batch mint")
    })

    it("should achieve gas savings for multiple operations", async () => {
      const recipients = [user1.address, user2.address, user3.address]
      const amounts = [ONE_BTC, ONE_BTC, ONE_BTC]

      // Perform batch mint
      const batchTx = await mockReserve.batchMint(recipients, amounts)
      const batchReceipt = await batchTx.wait()

      // Compare with individual mints (simulate)
      const individualMintEstimate = 50000 * recipients.length // Rough estimate per mint

      console.log(`Batch mint gas used: ${batchReceipt.gasUsed}`)
      console.log(`Estimated individual mints gas: ${individualMintEstimate}`)

      // Batch should be more efficient
      expect(batchReceipt.gasUsed.toNumber()).to.be.lessThan(individualMintEstimate)
    })

    it("should maintain accounting accuracy in batch operations", async () => {
      const recipients = [user1.address, user2.address, user3.address, user1.address] // user1 twice
      const amounts = [ONE_BTC, HALF_BTC, ONE_BTC.div(4), ONE_BTC.div(8)]
      const totalAmount = amounts.reduce((sum, amount) => sum.add(amount), ethers.BigNumber.from(0))

      await mockReserve.batchMint(recipients, amounts)

      // Verify total minted tracking
      const totalMinted = await accountControl.totalMinted()
      const reserveMinted = await accountControl.reserveMinted(mockReserve.address)
      expect(totalMinted).to.equal(totalAmount)
      expect(reserveMinted).to.equal(totalAmount)

      // Verify individual balances (user1 should have sum of their mints)
      const expectedUser1Balance = amounts[0].add(amounts[3])
      expect(await mockBank.balances(user1.address)).to.equal(expectedUser1Balance)
      expect(await mockBank.balances(user2.address)).to.equal(amounts[1])
      expect(await mockBank.balances(user3.address)).to.equal(amounts[2])
    })
  })

  describe("Multi-Reserve Scenarios", () => {
    beforeEach(async () => {
      // Authorize both reserves
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC)
      await accountControl.connect(owner).authorizeReserve(mockReserve2.address, TEN_BTC)

      // Set backing for both
      await mockReserve.setBacking(ONE_BTC.mul(5))
      await mockReserve2.setBacking(ONE_BTC.mul(3))
    })

    it("should handle independent minting from multiple reserves", async () => {
      const amount1 = ONE_BTC
      const amount2 = HALF_BTC

      // Mint from first reserve
      await mockReserve.mintTokens(user1.address, amount1)

      // Mint from second reserve
      await mockReserve2.mintTokens(user2.address, amount2)

      // Verify independent tracking
      expect(await accountControl.reserveMinted(mockReserve.address)).to.equal(amount1)
      expect(await accountControl.reserveMinted(mockReserve2.address)).to.equal(amount2)
      expect(await accountControl.totalMinted()).to.equal(amount1.add(amount2))

      // Verify user balances
      expect(await mockBank.balances(user1.address)).to.equal(amount1)
      expect(await mockBank.balances(user2.address)).to.equal(amount2)
    })

    it("should enforce individual reserve backing limits", async () => {
      // Try to mint more than first reserve backing
      await expect(
        mockReserve.mintTokens(user1.address, ONE_BTC.mul(6))
      ).to.be.revertedWith("Insufficient backing")

      // Try to mint more than second reserve backing
      await expect(
        mockReserve2.mintTokens(user2.address, ONE_BTC.mul(4))
      ).to.be.revertedWith("Insufficient backing")

      // Valid mints should still work
      await mockReserve.mintTokens(user1.address, ONE_BTC.mul(2))
      await mockReserve2.mintTokens(user2.address, ONE_BTC)

      expect(await mockBank.balances(user1.address)).to.equal(ONE_BTC.mul(2))
      expect(await mockBank.balances(user2.address)).to.equal(ONE_BTC)
    })

    it("should handle concurrent operations from multiple reserves", async () => {
      const amount = ONE_BTC

      // Concurrent mints to same user from different reserves
      await Promise.all([
        mockReserve.mintTokens(user1.address, amount),
        mockReserve2.mintTokens(user1.address, amount)
      ])

      // User should have tokens from both reserves
      expect(await mockBank.balances(user1.address)).to.equal(amount.mul(2))

      // Reserves should track independently
      expect(await accountControl.reserveMinted(mockReserve.address)).to.equal(amount)
      expect(await accountControl.reserveMinted(mockReserve2.address)).to.equal(amount)
      expect(await accountControl.totalMinted()).to.equal(amount.mul(2))
    })
  })

  describe("Integration with Redemption Scenarios", () => {
    beforeEach(async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC)
      await mockReserve.setBacking(ONE_BTC.mul(5))

      // Mint some tokens first
      await mockReserve.mintTokens(user1.address, ONE_BTC.mul(2))
    })

    it("should handle redemption notifications from external systems", async () => {
      const redeemAmount = ONE_BTC

      // Simulate redemption (would normally come from QCRedeemer)
      await expect(
        accountControl.connect(mockReserve.address).notifyRedemption(
          mockReserve.address,
          user1.address,
          redeemAmount
        )
      ).to.emit(accountControl, "RedemptionExecuted")
        .withArgs(mockReserve.address, user1.address, redeemAmount)

      // Verify minted amounts decreased
      expect(await accountControl.reserveMinted(mockReserve.address)).to.equal(ONE_BTC)
      expect(await accountControl.totalMinted()).to.equal(ONE_BTC)
    })

    it("should prevent over-redemption", async () => {
      const excessiveRedeemAmount = ONE_BTC.mul(3) // More than minted

      await expect(
        accountControl.connect(mockReserve.address).notifyRedemption(
          mockReserve.address,
          user1.address,
          excessiveRedeemAmount
        )
      ).to.be.revertedWith("Insufficient minted amount for redemption")
    })

    it("should maintain backing after redemptions", async () => {
      const redeemAmount = ONE_BTC

      // Check backing before redemption
      const backingBefore = await accountControl.backing(mockReserve.address)

      // Execute redemption
      await accountControl.connect(mockReserve.address).notifyRedemption(
        mockReserve.address,
        user1.address,
        redeemAmount
      )

      // Backing should remain unchanged
      const backingAfter = await accountControl.backing(mockReserve.address)
      expect(backingAfter).to.equal(backingBefore)

      // But minted amount should decrease
      expect(await accountControl.reserveMinted(mockReserve.address)).to.equal(ONE_BTC)
    })
  })

  describe("Error Handling and Edge Cases", () => {
    beforeEach(async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC)
      await mockReserve.setBacking(ONE_BTC)
    })

    it("should handle zero amount minting attempts", async () => {
      await expect(
        mockReserve.mintTokens(user1.address, 0)
      ).to.be.revertedWith("Amount must be greater than zero")
    })

    it("should handle minting to zero address", async () => {
      await expect(
        mockReserve.mintTokens(ethers.constants.AddressZero, ONE_BTC)
      ).to.be.revertedWith("Cannot mint to zero address")
    })

    it("should handle unauthorized reserve attempts", async () => {
      // Deploy unauthorized reserve
      const MockReserveFactory = await ethers.getContractFactory("MockReserve")
      const unauthorizedReserve = await MockReserveFactory.deploy(accountControl.address)

      await expect(
        unauthorizedReserve.mintTokens(user1.address, ONE_BTC)
      ).to.be.revertedWith("Reserve not authorized")
    })

    it("should handle malicious attempts to exceed caps", async () => {
      // Set backing exactly at cap
      await mockReserve.setBacking(TEN_BTC)

      // Mint up to cap
      await mockReserve.mintTokens(user1.address, TEN_BTC)

      // Try to exceed through backing manipulation (should fail due to minting cap)
      await mockReserve.setBacking(TEN_BTC.mul(2))

      await expect(
        mockReserve.mintTokens(user2.address, 1)
      ).to.be.revertedWith("Minting cap exceeded")
    })
  })
})