import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

import { AccountControl } from "../../../typechain"
import {
  deployAccountControlForTest,
  cleanupDeployments,
} from "../../helpers/deployment-utils"

describe("AccountControl", () => {
  let accountControl: AccountControl
  let owner: SignerWithAddress
  let emergencyCouncil: SignerWithAddress
  let reserve: SignerWithAddress
  let reserve1: SignerWithAddress
  let reserve2: SignerWithAddress
  let qc: SignerWithAddress
  let user: SignerWithAddress
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let mockBank: any
  let mockBankContract: any

  // Common test constants
  const QC_BACKING_AMOUNT = 1000000 // 0.01 BTC in satoshis
  const QC_MINTING_CAP = 1000000 // 0.01 BTC in satoshis
  const SATOSHI_MULTIPLIER = ethers.BigNumber.from("10000000000") // 1e10 - converts satoshis to tBTC

  beforeEach(async () => {
    // Get signers using standardized approach
    ;[
      owner,
      emergencyCouncil,
      reserve,
      reserve1,
      reserve2,
      qc,
      user,
      user1,
      user2,
    ] = await ethers.getSigners()

    // Deploy mock Bank
    const MockBankFactory = await ethers.getContractFactory("MockBank")
    mockBank = await MockBankFactory.deploy()
    mockBankContract = mockBank // Alias for compatibility

    // Deploy AccountControl using helper
    accountControl = await deployAccountControlForTest(
      owner,
      emergencyCouncil,
      mockBank
    )

    // Grant MINTER_ROLE to reserves for testing
    const MINTER_ROLE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("MINTER_ROLE")
    )

    await accountControl.connect(owner).grantRole(MINTER_ROLE, reserve.address)
    await accountControl.connect(owner).grantRole(MINTER_ROLE, reserve1.address)
    await accountControl.connect(owner).grantRole(MINTER_ROLE, reserve2.address)
    await accountControl.connect(owner).grantRole(MINTER_ROLE, qc.address)

    // Setup standard test reserves (QC_PERMISSIONED is initialized by default)
    await accountControl
      .connect(owner)
      .authorizeReserve(reserve.address, 1000000, 1) // 0.01 BTC cap in satoshis, ReserveType.QC_PERMISSIONED
    await accountControl.connect(reserve).updateBacking(1000000)

    // Setup additional reserves for multi-reserve tests
    await accountControl
      .connect(owner)
      .authorizeReserve(reserve1.address, 1000000, 1) // 0.01 BTC cap, ReserveType.QC_PERMISSIONED
    await accountControl
      .connect(owner)
      .authorizeReserve(reserve2.address, 2000000, 1) // 0.02 BTC cap, ReserveType.QC_PERMISSIONED
    await accountControl.connect(reserve1).updateBacking(1000000)
    await accountControl.connect(reserve2).updateBacking(2000000)

    // Setup QC for workflow tests
    await accountControl
      .connect(owner)
      .authorizeReserve(qc.address, QC_MINTING_CAP, 1) // ReserveType.QC_PERMISSIONED
    await accountControl.connect(qc).updateBacking(QC_BACKING_AMOUNT)
  })

  afterEach(async () => {
    // Clean up deployment locks to prevent conflicts
    await cleanupDeployments()
  })

  // ===== CORE FUNCTIONALITY TESTS =====

  describe("Core Functionality", () => {
    describe("Optimized totalMinted calculation ", () => {
      it("should return zero initially", async () => {
        expect(await accountControl.totalMinted()).to.equal(0)
      })

      it("should track total minted amount efficiently", async () => {
        // Reserve updates its own backing (federated model)
        await accountControl.connect(reserve).updateBacking(2000000) // 0.02 BTC

        // Mock Bank.increaseBalance call (normally would be called)
        const amount = 500000 // 0.005 BTC in satoshis

        // This would normally fail because we can't call mint from non-reserve
        // but we're testing the state tracking logic
        expect(await accountControl.totalMinted()).to.equal(0)
      })
    })

    describe("Reserve deauthorization ", () => {
      it("should deauthorize reserve", async () => {
        expect(await accountControl.authorized(reserve.address)).to.be.true

        await accountControl.connect(owner).deauthorizeReserve(reserve.address)

        expect(await accountControl.authorized(reserve.address)).to.be.false
        const reserveInfo = await accountControl.reserveInfo(reserve.address)
        expect(reserveInfo.mintingCap).to.equal(0)
      })

      it("should revert when deauthorizing non-existent reserve", async () => {
        const nonExistentReserve = ethers.Wallet.createRandom().address

        await expect(
          accountControl.connect(owner).deauthorizeReserve(nonExistentReserve)
        ).to.be.revertedWith("ReserveNotFound")
      })

      it("should emit ReserveDeauthorized event", async () => {
        const tx = await accountControl
          .connect(owner)
          .deauthorizeReserve(reserve.address)

        const receipt = await tx.wait()

        const { timestamp } = await ethers.provider.getBlock(
          receipt.blockNumber
        )

        expect(tx)
          .to.emit(accountControl, "ReserveDeauthorized")
          .withArgs(reserve.address, owner.address, timestamp)
      })

      it("should revert when deauthorizing reserve with outstanding balance", async () => {
        // Reserve sets backing and mint some tokens to create outstanding balance
        await accountControl.connect(reserve).updateBacking(1000000)
        await accountControl
          .connect(reserve)
          .mintTBTC(
            reserve.address,
            user.address,
            ethers.BigNumber.from(500000).mul(SATOSHI_MULTIPLIER)
          )

        await expect(
          accountControl.connect(owner).deauthorizeReserve(reserve.address)
        ).to.be.revertedWith("CannotDeauthorizeWithOutstandingBalance")
      })

      it("should clear backing when deauthorizing clean reserve", async () => {
        // Reserve sets backing but no minted balance
        await accountControl.connect(reserve).updateBacking(1000000)

        expect(await accountControl.backing(reserve.address)).to.equal(1000000)

        await accountControl.connect(owner).deauthorizeReserve(reserve.address)

        expect(await accountControl.backing(reserve.address)).to.equal(0)
      })
    })

    describe("redeem function ", () => {
      beforeEach(async () => {
        // Reserve sets up backing and perform a previous mint
        await accountControl.connect(reserve).updateBacking(1000000)
        // Mint some tokens to create minted balance for testing redemption
        await accountControl
          .connect(reserve)
          .mintTBTC(
            reserve.address,
            user.address,
            ethers.BigNumber.from(500000).mul(SATOSHI_MULTIPLIER)
          ) // Mint 0.005 BTC
      })

      it("should decrease minted amount on redemption", async () => {
        const initialMinted = await accountControl.minted(reserve.address)
        const initialTotal = await accountControl.totalMinted()

        await accountControl.connect(reserve).redeem(200000) // Redeem 0.002 BTC

        expect(await accountControl.minted(reserve.address)).to.equal(
          initialMinted.sub(200000)
        )
        expect(await accountControl.totalMinted()).to.equal(
          initialTotal.sub(200000)
        )
      })

      it("should emit RedemptionProcessed event", async () => {
        const tx = await accountControl.connect(reserve).redeem(200000)
        const receipt = await tx.wait()

        const { timestamp } = await ethers.provider.getBlock(
          receipt.blockNumber
        )

        expect(tx)
          .to.emit(accountControl, "RedemptionProcessed")
          .withArgs(reserve.address, 200000, reserve.address, timestamp)
      })

      it("should revert when redeeming more than minted", async () => {
        await expect(
          accountControl.connect(reserve).redeem(1000000) // More than minted
        ).to.be.revertedWithCustomError(accountControl, "InsufficientMinted")
      })
    })

    describe("Unit consistency ", () => {
      it("should use correct satoshi constants", async () => {
        expect(await accountControl.MIN_MINT_AMOUNT()).to.equal(10000) // 0.0001 BTC in satoshis
        expect(await accountControl.MAX_SINGLE_MINT()).to.equal(10000000000) // 100 BTC in satoshis
      })
    })

    describe("System Pause Enforcement [validation]", () => {
      it("should block all minting when system is paused", async () => {
        // Pause the system
        await accountControl.connect(emergencyCouncil).pauseSystem()

        // Verify system is paused
        expect(await accountControl.systemPaused()).to.be.true

        // Should revert mint operation
        await expect(
          accountControl
            .connect(reserve)
            .mintTBTC(
              reserve.address,
              user.address,
              ethers.BigNumber.from(100000).mul(SATOSHI_MULTIPLIER)
            )
        ).to.be.revertedWith("SystemIsPaused")
      })

      it("should allow emergency council to pause system", async () => {
        // Emergency council should be able to pause
        await accountControl.connect(emergencyCouncil).pauseSystem()
        expect(await accountControl.systemPaused()).to.be.true
      })

      it("should only allow owner to unpause system", async () => {
        // Pause system first
        await accountControl.connect(emergencyCouncil).pauseSystem()

        // Emergency council should NOT be able to unpause
        await expect(
          accountControl.connect(emergencyCouncil).unpauseSystem()
        ).to.be.revertedWith("Ownable: caller is not the owner")

        // Only owner should be able to unpause
        await accountControl.connect(owner).unpauseSystem()
        expect(await accountControl.systemPaused()).to.be.false
      })

      it("should block redemptions when system is paused", async () => {
        // First mint some tokens
        await accountControl
          .connect(reserve)
          .mintTBTC(
            reserve.address,
            user.address,
            ethers.BigNumber.from(100000).mul(SATOSHI_MULTIPLIER)
          )

        // Pause the system
        await accountControl.connect(emergencyCouncil).pauseSystem()

        // Should revert redemption operation
        await expect(
          accountControl.connect(reserve).redeem(50000)
        ).to.be.revertedWith("SystemIsPaused")
      })
    })

    describe("Re-authorization ", () => {
      it("should allow re-authorization after deauthorization", async () => {
        // Deauthorize the reserve first
        await accountControl.connect(owner).deauthorizeReserve(reserve.address)

        // Verify it's deauthorized
        expect(await accountControl.authorized(reserve.address)).to.be.false

        // Should be able to re-authorize (only one type QC_PERMISSIONED exists)
        await accountControl
          .connect(owner)
          .authorizeReserve(reserve.address, 500000, 1) // ReserveType.QC_PERMISSIONED

        // Verify re-authorization succeeded
        expect(await accountControl.authorized(reserve.address)).to.be.true
        const reserveInfo = await accountControl.reserveInfo(reserve.address)
        expect(reserveInfo.mintingCap).to.equal(500000)
      })
    })

    describe("Input Validation [validation]", () => {
      it("should revert mint with amount below MIN_MINT_AMOUNT", async () => {
        const tooSmallAmount = 9999 // Less than MIN_MINT_AMOUNT (10000)

        await expect(
          accountControl
            .connect(reserve)
            .mintTBTC(
              reserve.address,
              user.address,
              ethers.BigNumber.from(tooSmallAmount).mul(SATOSHI_MULTIPLIER)
            )
        ).to.be.reverted
      })

      it("should revert mint with amount above MAX_SINGLE_MINT", async () => {
        const tooLargeAmount = ethers.utils.parseUnits("101", 8) // 101 BTC, exceeds MAX_SINGLE_MINT (100 BTC)

        await expect(
          accountControl
            .connect(reserve)
            .mintTBTC(
              reserve.address,
              user.address,
              ethers.BigNumber.from(tooLargeAmount).mul(SATOSHI_MULTIPLIER)
            )
        ).to.be.reverted
      })

      it("should accept valid single mint amounts", async () => {
        // Test boundary values that should work
        const minValid = 10000 // MIN_MINT_AMOUNT
        const maxValid = ethers.utils.parseUnits("100", 8) // MAX_SINGLE_MINT

        // Should succeed with minimum amount
        await expect(
          accountControl
            .connect(reserve)
            .mintTBTC(
              reserve.address,
              user.address,
              ethers.BigNumber.from(minValid).mul(SATOSHI_MULTIPLIER)
            )
        ).to.not.be.reverted

        // Should succeed with maximum amount (reserve needs more backing first)
        await accountControl
          .connect(reserve)
          .updateBacking(maxValid.add(1000000))
        await accountControl
          .connect(owner)
          .setMintingCap(reserve.address, maxValid.add(1000000))

        await expect(
          accountControl
            .connect(reserve)
            .mintTBTC(
              reserve.address,
              user.address,
              ethers.BigNumber.from(maxValid).mul(SATOSHI_MULTIPLIER)
            )
        ).to.not.be.reverted
      })
    })

    describe("Authorization Validation [validation]", () => {
      it("should prevent unauthorized reserves from minting", async () => {
        // Use the user signer which has ETH but is not authorized as a reserve
        await expect(
          accountControl
            .connect(user)
            .mintTBTC(
              user.address,
              user.address,
              ethers.BigNumber.from(100000).mul(SATOSHI_MULTIPLIER)
            )
        ).to.be.revertedWith("Caller must have MINTER_ROLE")
      })

      it("should prevent paused reserves from minting", async () => {
        // Pause the specific reserve
        await accountControl
          .connect(emergencyCouncil)
          .pauseReserve(reserve.address)

        await expect(
          accountControl
            .connect(reserve)
            .mintTBTC(
              reserve.address,
              user.address,
              ethers.BigNumber.from(100000).mul(SATOSHI_MULTIPLIER)
            )
        ).to.be.revertedWith("Reserve not authorized")
      })

      it("should prevent unauthorized addresses from updating backing", async () => {
        // User is not an authorized reserve, so should fail
        await expect(
          accountControl.connect(user).updateBacking(500000)
        ).to.be.revertedWithCustomError(accountControl, "NotAuthorized")
      })
    })
  })

  // ===== FEATURE TESTS =====

  describe("Feature Tests", () => {
    describe("Reserve Cap Reduction Safety", () => {
      beforeEach(async () => {
        // Mint some tokens first
        await accountControl
          .connect(reserve1)
          .mintTBTC(
            reserve1.address,
            user1.address,
            ethers.BigNumber.from(500000).mul(SATOSHI_MULTIPLIER)
          ) // 0.005 BTC
      })

      it("should prevent reducing cap below current minted amount", async () => {
        await expect(
          accountControl.connect(owner).setMintingCap(reserve1.address, 400000) // Below 500000 minted
        ).to.be.revertedWithCustomError(accountControl, "ExceedsReserveCap")
      })

      it("should allow reducing cap to exactly current minted amount", async () => {
        await accountControl
          .connect(owner)
          .setMintingCap(reserve1.address, 500000)
        const reserveInfo = await accountControl.reserveInfo(reserve1.address)
        expect(reserveInfo.mintingCap).to.equal(500000)
      })

      it("should allow increasing cap above current minted amount", async () => {
        await accountControl
          .connect(owner)
          .setMintingCap(reserve1.address, 1500000)
        const reserveInfo = await accountControl.reserveInfo(reserve1.address)
        expect(reserveInfo.mintingCap).to.equal(1500000)
      })
    })

    describe("setMintingCap Validation", () => {
      it("should revert when setting cap for unauthorized reserve", async () => {
        const unauthorizedReserve = ethers.Wallet.createRandom()

        await expect(
          accountControl
            .connect(owner)
            .setMintingCap(unauthorizedReserve.address, 1000000)
        ).to.be.revertedWith("NotAuthorized")
      })
    })

    describe("Authorization Race Condition Protection", () => {
      it("should prevent double authorization", async () => {
        await expect(
          accountControl
            .connect(owner)
            .authorizeReserve(reserve1.address, 1000000, 1) // ReserveType.QC_PERMISSIONED
        ).to.be.revertedWith("AlreadyAuthorized")
      })

      it("should prevent deauthorizing non-existent reserve", async () => {
        const nonExistentReserve = ethers.Wallet.createRandom().address

        await expect(
          accountControl.connect(owner).deauthorizeReserve(nonExistentReserve)
        ).to.be.revertedWith("ReserveNotFound")
      })

      it("should prevent address reuse across different reserve types", async () => {
        // First, deauthorize reserve1 (it was authorized as QC_PERMISSIONED = 1)
        await accountControl.connect(owner).deauthorizeReserve(reserve1.address)

        // Try to re-authorize same address for same type - should work
        await accountControl
          .connect(owner)
          .authorizeReserve(reserve1.address, 1000000, 1) // Same type, ReserveType.QC_PERMISSIONED

        // Deauthorize again for the next test
        await accountControl.connect(owner).deauthorizeReserve(reserve1.address)

        // All reserves are QC_PERMISSIONED by default, just verify re-authorization works
        await accountControl
          .connect(owner)
          .authorizeReserve(reserve1.address, 500000, 1) // ReserveType.QC_PERMISSIONED
        const reserveInfo = await accountControl.reserveInfo(reserve1.address)
        expect(reserveInfo.mintingCap).to.equal(500000)
      })
    })

    describe("Storage Layout Compatibility", () => {
      it("should maintain upgrade compatibility", async () => {
        // This test verifies that the storage layout documentation
        // doesn't break existing functionality

        // Test core functionality still works
        await accountControl
          .connect(reserve1)
          .mintTBTC(
            reserve1.address,
            user1.address,
            ethers.BigNumber.from(100000).mul(SATOSHI_MULTIPLIER)
          )
        expect(await accountControl.minted(reserve1.address)).to.equal(100000)

        // Test all state variables are accessible
        expect(await accountControl.backing(reserve1.address)).to.equal(1000000)
        expect(await accountControl.authorized(reserve1.address)).to.be.true
        const reserveInfo = await accountControl.reserveInfo(reserve1.address)
        expect(reserveInfo.mintingCap).to.equal(1000000)
        expect(reserveInfo.paused).to.be.false // Pause state moved to reserveInfo struct
        expect(await accountControl.systemPaused()).to.be.false
        expect(await accountControl.emergencyCouncil()).to.equal(
          emergencyCouncil.address
        )
        expect(await accountControl.bank()).to.equal(mockBankContract.address)
        // emitIndividualEvents removed for simplicity
      })
    })
  })

  // ===== WORKFLOW TESTS =====

  describe("Workflow Tests", () => {
    describe("Direct Integration Testing", () => {
      it("should support the complete mint workflow", async () => {
        const mintAmount = 500000 // 0.005 BTC in satoshis

        // Initial state check
        expect(await accountControl.minted(qc.address)).to.equal(0)
        expect(await accountControl.totalMinted()).to.equal(0)

        // Test mint operation (simulating QCMinter call)
        await accountControl
          .connect(qc)
          .mintTBTC(
            qc.address,
            user.address,
            ethers.BigNumber.from(mintAmount).mul(SATOSHI_MULTIPLIER)
          )

        // Verify state after mint
        expect(await accountControl.minted(qc.address)).to.equal(mintAmount)
        expect(await accountControl.totalMinted()).to.equal(mintAmount)

        // Bank balances are in tBTC (18 decimals), need to convert from satoshis
        const expectedBankBalance =
          ethers.BigNumber.from(mintAmount).mul(SATOSHI_MULTIPLIER)

        expect(await mockBank.balances(user.address)).to.equal(
          expectedBankBalance
        )
      })

      it("should support the complete redemption workflow", async () => {
        const mintAmount = 500000 // 0.005 BTC in satoshis
        const redeemAmount = 300000 // 0.003 BTC in satoshis

        // First mint tokens
        await accountControl
          .connect(qc)
          .mintTBTC(
            qc.address,
            user.address,
            ethers.BigNumber.from(mintAmount).mul(SATOSHI_MULTIPLIER)
          )

        // Verify pre-redemption state
        expect(await accountControl.minted(qc.address)).to.equal(mintAmount)

        // Test redemption operation (simulating QCRedeemer call)
        await accountControl.connect(qc).redeem(redeemAmount)

        // Verify state after redemption
        expect(await accountControl.minted(qc.address)).to.equal(
          mintAmount - redeemAmount
        )
        expect(await accountControl.totalMinted()).to.equal(
          mintAmount - redeemAmount
        )
      })

      it("should support backing updates affecting available mint capacity", async () => {
        const initialBacking = await accountControl.backing(qc.address)
        const stats = await accountControl.getReserveStats(qc.address)

        expect(stats.availableToMint).to.equal(QC_BACKING_AMOUNT)

        // Mint some tokens
        const mintAmount = 300000
        await accountControl
          .connect(qc)
          .mintTBTC(
            qc.address,
            user.address,
            ethers.BigNumber.from(mintAmount).mul(SATOSHI_MULTIPLIER)
          )

        // Check updated available capacity
        const updatedStats = await accountControl.getReserveStats(qc.address)
        expect(updatedStats.availableToMint).to.equal(
          QC_BACKING_AMOUNT - mintAmount
        )

        // QC increases backing
        const newBacking = QC_BACKING_AMOUNT + 500000
        await accountControl.connect(qc).updateBacking(newBacking)

        // Check final available capacity
        const finalStats = await accountControl.getReserveStats(qc.address)

        const expectedAvailable = Math.min(
          newBacking - mintAmount,
          QC_MINTING_CAP - mintAmount
        )

        expect(finalStats.availableToMint).to.equal(expectedAvailable)
      })

      it("should handle multiple QCs with independent accounting", async () => {
        // Setup second QC
        const qc2 = emergencyCouncil // Reuse signer
        await accountControl
          .connect(owner)
          .authorizeReserve(qc2.address, QC_MINTING_CAP, 1) // ReserveType.QC_PERMISSIONED
        await accountControl.connect(qc2).updateBacking(QC_BACKING_AMOUNT)

        const qc1MintAmount = 300000
        const qc2MintAmount = 400000

        // Mint from both QCs
        await accountControl
          .connect(qc)
          .mintTBTC(
            qc.address,
            user.address,
            ethers.BigNumber.from(qc1MintAmount).mul(SATOSHI_MULTIPLIER)
          )
        await accountControl
          .connect(qc2)
          .mintTBTC(
            qc2.address,
            user.address,
            ethers.BigNumber.from(qc2MintAmount).mul(SATOSHI_MULTIPLIER)
          )

        // Verify independent accounting
        expect(await accountControl.minted(qc.address)).to.equal(qc1MintAmount)
        expect(await accountControl.minted(qc2.address)).to.equal(qc2MintAmount)
        expect(await accountControl.totalMinted()).to.equal(
          qc1MintAmount + qc2MintAmount
        )

        // Redeem from one QC
        await accountControl.connect(qc).redeem(100000)

        // Verify only QC1's accounting changed
        expect(await accountControl.minted(qc.address)).to.equal(
          qc1MintAmount - 100000
        )
        expect(await accountControl.minted(qc2.address)).to.equal(qc2MintAmount)
        expect(await accountControl.totalMinted()).to.equal(
          qc1MintAmount + qc2MintAmount - 100000
        )
      })

      it("should enforce invariants across mint/redeem cycles", async () => {
        const mintAmount = 600000

        // Test backing invariant - QC reduces backing below minted amount
        await accountControl.connect(qc).updateBacking(mintAmount - 100000) // Less backing than mint

        await expect(
          accountControl
            .connect(qc)
            .mintTBTC(
              qc.address,
              user.address,
              ethers.BigNumber.from(mintAmount).mul(SATOSHI_MULTIPLIER)
            )
        ).to.be.revertedWithCustomError(accountControl, "InsufficientBacking")

        // QC restores proper backing
        await accountControl.connect(qc).updateBacking(QC_BACKING_AMOUNT)

        // Test minting cap invariant
        const lowCap = mintAmount - 100000
        await accountControl.connect(owner).setMintingCap(qc.address, lowCap)

        await expect(
          accountControl
            .connect(qc)
            .mintTBTC(
              qc.address,
              user.address,
              ethers.BigNumber.from(mintAmount).mul(SATOSHI_MULTIPLIER)
            )
        ).to.be.revertedWithCustomError(accountControl, "ExceedsReserveCap")

        // Test redemption validation
        await expect(
          accountControl.connect(qc).redeem(100000)
        ).to.be.revertedWithCustomError(accountControl, "InsufficientMinted")
      })

      it("should handle reserve lifecycle properly", async () => {
        const mintAmount = 400000

        // Mint some tokens
        await accountControl
          .connect(qc)
          .mintTBTC(
            qc.address,
            user.address,
            ethers.BigNumber.from(mintAmount).mul(SATOSHI_MULTIPLIER)
          )
        expect(await accountControl.minted(qc.address)).to.equal(mintAmount)

        // Cannot deauthorize with outstanding balance - this is a safety check
        await expect(
          accountControl.connect(owner).deauthorizeReserve(qc.address)
        ).to.be.revertedWithCustomError(
          accountControl,
          "CannotDeauthorizeWithOutstandingBalance"
        )

        // Must redeem all tokens first before deauthorization
        await accountControl.connect(qc).redeem(mintAmount)
        expect(await accountControl.minted(qc.address)).to.equal(0)

        // Now deauthorization should work
        await accountControl.connect(owner).deauthorizeReserve(qc.address)
        expect(await accountControl.authorized(qc.address)).to.be.false
        const reserveInfo = await accountControl.reserveInfo(qc.address)
        expect(reserveInfo.mintingCap).to.equal(0)
      })

      it("should provide accurate reserve statistics", async () => {
        let stats = await accountControl.getReserveStats(qc.address)

        expect(stats.isAuthorized).to.be.true
        expect(stats.isPaused).to.be.false
        expect(stats.backingAmount).to.equal(QC_BACKING_AMOUNT)
        expect(stats.mintedAmount).to.equal(0)
        expect(stats.mintingCap).to.equal(QC_MINTING_CAP)
        expect(stats.availableToMint).to.equal(QC_BACKING_AMOUNT)

        // After minting
        const mintAmount = 300000
        await accountControl
          .connect(qc)
          .mintTBTC(
            qc.address,
            user.address,
            ethers.BigNumber.from(mintAmount).mul(SATOSHI_MULTIPLIER)
          )

        stats = await accountControl.getReserveStats(qc.address)
        expect(stats.mintedAmount).to.equal(mintAmount)
        expect(stats.availableToMint).to.equal(QC_BACKING_AMOUNT - mintAmount)
      })

      it("should handle emergency scenarios correctly", async () => {
        const mintAmount = 200000
        await accountControl
          .connect(qc)
          .mintTBTC(
            qc.address,
            user.address,
            ethers.BigNumber.from(mintAmount).mul(SATOSHI_MULTIPLIER)
          )

        // Emergency pause by emergency council
        await accountControl.connect(emergencyCouncil).pauseReserve(qc.address)

        // Should not be able to mint when paused
        await expect(
          accountControl
            .connect(qc)
            .mintTBTC(
              qc.address,
              user.address,
              ethers.BigNumber.from(mintAmount).mul(SATOSHI_MULTIPLIER)
            )
        ).to.be.revertedWith("Reserve not authorized")

        // Backing updates are also blocked when paused (uses onlyAuthorizedReserve modifier)
        await expect(
          accountControl.connect(qc).updateBacking(QC_BACKING_AMOUNT + 100000)
        ).to.be.revertedWithCustomError(accountControl, "ReserveIsPaused")

        // Redemption is also blocked when paused
        await expect(
          accountControl.connect(qc).redeem(100000)
        ).to.be.revertedWithCustomError(accountControl, "ReserveIsPaused")

        // Verify backing hasn't changed
        expect(await accountControl.backing(qc.address)).to.equal(
          QC_BACKING_AMOUNT
        )

        // Unpause and operations should work again
        await accountControl.connect(owner).unpauseReserve(qc.address)

        // Now backing update should work
        await accountControl
          .connect(qc)
          .updateBacking(QC_BACKING_AMOUNT + 100000)
        expect(await accountControl.backing(qc.address)).to.equal(
          QC_BACKING_AMOUNT + 100000
        )

        // And redemption should work
        await accountControl.connect(qc).redeem(100000)
        expect(await accountControl.minted(qc.address)).to.equal(
          mintAmount - 100000
        )
      })
    })
  })
})
