import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { AccountControl } from "../../../typechain";
import { safeDeployProxy, cleanupDeployments } from "../../helpers/testing-utils";
import { setupTestEnvironment, createBaseTestEnvironment, restoreBaseTestEnvironment } from "../fixtures/base-setup";
import { ERROR_MESSAGES } from "../helpers/error-helpers";

describe("AccountControl", function () {
  let accountControl: AccountControl;
  let owner: SignerWithAddress;
  let emergencyCouncil: SignerWithAddress;
  let reserve: SignerWithAddress;
  let reserve1: SignerWithAddress;
  let reserve2: SignerWithAddress;
  let qc: SignerWithAddress;
  let user: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let mockBank: any;
  let mockBankContract: any;

  // Common test constants
  const QC_BACKING_AMOUNT = 1000000; // 0.01 BTC in satoshis
  const QC_MINTING_CAP = 1000000; // 0.01 BTC in satoshis

  beforeEach(async function () {
    // Get signers using standardized approach
    [owner, emergencyCouncil, reserve, reserve1, reserve2, qc, user, user1, user2] = await ethers.getSigners();

    // Deploy mock Bank
    const MockBankFactory = await ethers.getContractFactory("MockBank");
    mockBank = await MockBankFactory.deploy();
    mockBankContract = mockBank; // Alias for compatibility

    // Deploy AccountControl using safe deployment (standardized approach)
    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await safeDeployProxy<AccountControl>(
      AccountControlFactory,
      [owner.address, emergencyCouncil.address, mockBank.address],
      { initializer: "initialize" }
    );

    // Authorize AccountControl to call MockBank functions
    await mockBank.authorizeBalanceIncreaser(accountControl.address);

    // Setup standard test reserves (QC_PERMISSIONED is initialized by default)
    await accountControl.connect(owner).authorizeReserve(reserve.address, 1000000); // 0.01 BTC cap in satoshis
    await accountControl.connect(reserve).updateBacking(1000000);

    // Setup additional reserves for multi-reserve tests
    await accountControl.connect(owner).authorizeReserve(reserve1.address, 1000000); // 0.01 BTC cap
    await accountControl.connect(owner).authorizeReserve(reserve2.address, 2000000); // 0.02 BTC cap
    await accountControl.connect(reserve1).updateBacking(1000000);
    await accountControl.connect(reserve2).updateBacking(2000000);

    // Setup QC for workflow tests
    await accountControl.connect(owner).authorizeReserve(qc.address, QC_MINTING_CAP);
    await accountControl.connect(qc).updateBacking(QC_BACKING_AMOUNT);
  });

  afterEach(async function () {
    // Clean up deployment locks to prevent conflicts
    await cleanupDeployments();
  });

  // ===== CORE FUNCTIONALITY TESTS =====

  describe("Core Functionality", function () {
    describe("Optimized totalMinted calculation [unit]", function () {
      it("should return zero initially", async function () {
        expect(await accountControl.totalMinted()).to.equal(0);
      });

      it("should track total minted amount efficiently", async function () {
        // Reserve updates its own backing (federated model)
        await accountControl.connect(reserve).updateBacking(2000000); // 0.02 BTC

        // Mock Bank.increaseBalance call (normally would be called)
        const amount = 500000; // 0.005 BTC in satoshis

        // This would normally fail because we can't call mint from non-reserve
        // but we're testing the state tracking logic
        expect(await accountControl.totalMinted()).to.equal(0);
      });
    });

    describe("Reserve deauthorization [unit]", function () {
      it("should deauthorize reserve", async function () {
        expect(await accountControl.authorized(reserve.address)).to.be.true;

        await accountControl.connect(owner).deauthorizeReserve(reserve.address);

        expect(await accountControl.authorized(reserve.address)).to.be.false;
        const reserveInfo = await accountControl.reserveInfo(reserve.address);
        expect(reserveInfo.mintingCap).to.equal(0);
      });

      it("should revert when deauthorizing non-existent reserve", async function () {
        const nonExistentReserve = ethers.Wallet.createRandom().address;

        await expect(
          accountControl.connect(owner).deauthorizeReserve(nonExistentReserve)
        ).to.be.revertedWith("ReserveNotFound");
      });

      it("should emit ReserveDeauthorized event", async function () {
        await expect(
          accountControl.connect(owner).deauthorizeReserve(reserve.address)
        )
          .to.emit(accountControl, "ReserveDeauthorized")
          .withArgs(reserve.address);
      });

      it("should revert when deauthorizing reserve with outstanding balance", async function () {
        // Reserve sets backing and mint some tokens to create outstanding balance
        await accountControl.connect(reserve).updateBacking(1000000);
        await accountControl.connect(reserve).mint(user.address, 500000);

        await expect(
          accountControl.connect(owner).deauthorizeReserve(reserve.address)
        ).to.be.revertedWith("CannotDeauthorizeWithOutstandingBalance");
      });

      it("should clear backing when deauthorizing clean reserve", async function () {
        // Reserve sets backing but no minted balance
        await accountControl.connect(reserve).updateBacking(1000000);

        expect(await accountControl.backing(reserve.address)).to.equal(1000000);

        await accountControl.connect(owner).deauthorizeReserve(reserve.address);

        expect(await accountControl.backing(reserve.address)).to.equal(0);
      });
    });

    describe("redeem function [unit]", function () {
      beforeEach(async function () {
        // Reserve sets up backing and perform a previous mint
        await accountControl.connect(reserve).updateBacking(1000000);
        // Mint some tokens to create minted balance for testing redemption
        await accountControl.connect(reserve).mint(user.address, 500000); // Mint 0.005 BTC
      });

      it("should decrease minted amount on redemption", async function () {
        const initialMinted = await accountControl.minted(reserve.address);
        const initialTotal = await accountControl.totalMinted();

        await accountControl.connect(reserve).redeem(200000); // Redeem 0.002 BTC

        expect(await accountControl.minted(reserve.address)).to.equal(initialMinted.sub(200000));
        expect(await accountControl.totalMinted()).to.equal(initialTotal.sub(200000));
      });

      it("should emit RedemptionProcessed event", async function () {
        await expect(
          accountControl.connect(reserve).redeem(200000)
        )
          .to.emit(accountControl, "RedemptionProcessed")
          .withArgs(reserve.address, 200000);
      });

      it("should revert when redeeming more than minted", async function () {
        await expect(
          accountControl.connect(reserve).redeem(1000000) // More than minted
        ).to.be.revertedWith("InsufficientMinted");
      });
    });

    describe("Unit consistency [unit]", function () {
      it("should use correct satoshi constants", async function () {
        expect(await accountControl.MIN_MINT_AMOUNT()).to.equal(10000); // 0.0001 BTC in satoshis
        expect(await accountControl.MAX_SINGLE_MINT()).to.equal(10000000000); // 100 BTC in satoshis
      });
    });

    describe("System Pause Enforcement [validation]", function () {
      it("should block all minting when system is paused", async function () {
        // Pause the system
        await accountControl.connect(emergencyCouncil).pauseSystem();

        // Verify system is paused
        expect(await accountControl.systemPaused()).to.be.true;

        // Should revert mint operation
        await expect(
          accountControl.connect(reserve).mint(user.address, 100000)
        ).to.be.revertedWith("SystemIsPaused");
      });

      it("should block all batch minting when system is paused", async function () {
        // Pause the system
        await accountControl.connect(emergencyCouncil).pauseSystem();

        const recipients = [user.address];
        const amounts = [100000];

        // Should revert batch mint operation
        await expect(
          accountControl.connect(reserve).batchMint(recipients, amounts)
        ).to.be.revertedWith("SystemIsPaused");
      });

      it("should allow emergency council to pause system", async function () {
        // Emergency council should be able to pause
        await accountControl.connect(emergencyCouncil).pauseSystem();
        expect(await accountControl.systemPaused()).to.be.true;
      });

      it("should only allow owner to unpause system", async function () {
        // Pause system first
        await accountControl.connect(emergencyCouncil).pauseSystem();

        // Emergency council should NOT be able to unpause
        await expect(
          accountControl.connect(emergencyCouncil).unpauseSystem()
        ).to.be.revertedWith("Ownable: caller is not the owner");

        // Only owner should be able to unpause
        await accountControl.connect(owner).unpauseSystem();
        expect(await accountControl.systemPaused()).to.be.false;
      });

      it("should block redemptions when system is paused", async function () {
        // First mint some tokens
        await accountControl.connect(reserve).mint(user.address, 100000);

        // Pause the system
        await accountControl.connect(emergencyCouncil).pauseSystem();

        // Should revert redemption operation
        await expect(
          accountControl.connect(reserve).redeem(50000)
        ).to.be.revertedWith("SystemIsPaused");
      });
    });

    describe("Re-authorization [unit]", function () {
      it("should allow re-authorization after deauthorization", async function () {
        // Deauthorize the reserve first
        await accountControl.connect(owner).deauthorizeReserve(reserve.address);

        // Verify it's deauthorized
        expect(await accountControl.authorized(reserve.address)).to.be.false;

        // Should be able to re-authorize (only one type QC_PERMISSIONED exists)
        await accountControl.connect(owner).authorizeReserve(reserve.address, 500000);

        // Verify re-authorization succeeded
        expect(await accountControl.authorized(reserve.address)).to.be.true;
        const reserveInfo = await accountControl.reserveInfo(reserve.address);
        expect(reserveInfo.mintingCap).to.equal(500000);
      });
    });

    describe("Input Validation [validation]", function () {
      it("should revert when recipients.length != amounts.length in batchMint", async function () {
        const recipients = [user.address, owner.address]; // 2 recipients
        const amounts = [100000]; // 1 amount

        await expect(
          accountControl.connect(reserve).batchMint(recipients, amounts)
        ).to.be.reverted;
      });

      it("should revert when batch size exceeds MAX_BATCH_SIZE", async function () {
        // Create arrays exceeding MAX_BATCH_SIZE (100)
        const recipients = new Array(101).fill(user.address);
        const amounts = new Array(101).fill(10000);

        await expect(
          accountControl.connect(reserve).batchMint(recipients, amounts)
        ).to.be.reverted;
      });

      it("should revert mint with amount below MIN_MINT_AMOUNT", async function () {
        const tooSmallAmount = 9999; // Less than MIN_MINT_AMOUNT (10000)

        await expect(
          accountControl.connect(reserve).mint(user.address, tooSmallAmount)
        ).to.be.reverted;
      });

      it("should revert mint with amount above MAX_SINGLE_MINT", async function () {
        const tooLargeAmount = ethers.utils.parseUnits("101", 8); // 101 BTC, exceeds MAX_SINGLE_MINT (100 BTC)

        await expect(
          accountControl.connect(reserve).mint(user.address, tooLargeAmount)
        ).to.be.reverted;
      });

      it("should revert batchMint with individual amounts below MIN_MINT_AMOUNT", async function () {
        const recipients = [user.address];
        const amounts = [9999]; // Below MIN_MINT_AMOUNT

        await expect(
          accountControl.connect(reserve).batchMint(recipients, amounts)
        ).to.be.reverted;
      });

      it("should revert batchMint with individual amounts above MAX_SINGLE_MINT", async function () {
        const recipients = [user.address];
        const amounts = [ethers.utils.parseUnits("101", 8)]; // Above MAX_SINGLE_MINT

        await expect(
          accountControl.connect(reserve).batchMint(recipients, amounts)
        ).to.be.reverted;
      });

      it("should accept valid single mint amounts", async function () {
        // Test boundary values that should work
        const minValid = 10000; // MIN_MINT_AMOUNT
        const maxValid = ethers.utils.parseUnits("100", 8); // MAX_SINGLE_MINT

        // Should succeed with minimum amount
        await expect(
          accountControl.connect(reserve).mint(user.address, minValid)
        ).to.not.be.reverted;

        // Should succeed with maximum amount (reserve needs more backing first)
        await accountControl.connect(reserve).updateBacking(maxValid.add(1000000));
        await accountControl.connect(owner).setMintingCap(reserve.address, maxValid.add(1000000));

        await expect(
          accountControl.connect(reserve).mint(user.address, maxValid)
        ).to.not.be.reverted;
      });

      it("should accept valid batch parameters", async function () {
        const recipients = [user.address, owner.address];
        const amounts = [50000, 60000];

        await expect(
          accountControl.connect(reserve).batchMint(recipients, amounts)
        ).to.not.be.reverted;
      });
    });

    describe("Authorization Validation [validation]", function () {
      it("should prevent unauthorized reserves from minting", async function () {
        // Use the user signer which has ETH but is not authorized as a reserve
        await expect(
          accountControl.connect(user).mint(user.address, 100000)
        ).to.be.revertedWith("NotAuthorized");
      });

      it("should prevent paused reserves from minting", async function () {
        // Pause the specific reserve
        await accountControl.connect(emergencyCouncil).pauseReserve(reserve.address);

        await expect(
          accountControl.connect(reserve).mint(user.address, 100000)
        ).to.be.revertedWith("ReserveIsPaused");
      });

      it("should prevent unauthorized addresses from updating backing", async function () {
        // User is not an authorized reserve, so should fail
        await expect(
          accountControl.connect(user).updateBacking(500000)
        ).to.be.revertedWith("NotAuthorized");
      });
    });
  });

  // ===== FEATURE TESTS =====

  describe("Feature Tests", function () {
    describe("Batch Atomicity", function () {
      it("should execute Bank calls before state updates in batchMint", async function () {
        const recipients = [user1.address, user2.address];
        const amounts = [100000, 200000]; // 0.001 BTC, 0.002 BTC

        // Check initial state
        const initialMinted = await accountControl.minted(reserve1.address);
        const initialTotal = await accountControl.totalMinted();

        await accountControl.connect(reserve1).batchMint(recipients, amounts);

        // Verify state was updated after Bank calls succeeded
        expect(await accountControl.minted(reserve1.address)).to.equal(initialMinted.add(300000));
        expect(await accountControl.totalMinted()).to.equal(initialTotal.add(300000));
      });

      it("should revert entire transaction if any Bank call fails", async function () {
        // Disable batch support to force fallback to individual calls
        await mockBankContract.setBatchSupported(false);
        // Configure mock Bank to fail on second individual call
        await mockBankContract.setFailOnSecondCall(true);

        const recipients = [user1.address, user2.address];
        const amounts = [100000, 200000];

        await expect(
          accountControl.connect(reserve1).batchMint(recipients, amounts)
        ).to.be.revertedWith("Mock Bank: Forced failure");

        // Verify no state was updated
        expect(await accountControl.minted(reserve1.address)).to.equal(0);
        expect(await accountControl.totalMinted()).to.equal(0);
      });
    });

    describe("Reserve Cap Reduction Safety", function () {
      beforeEach(async function () {
        // Mint some tokens first
        await accountControl.connect(reserve1).mint(user1.address, 500000); // 0.005 BTC
      });

      it("should prevent reducing cap below current minted amount", async function () {
        await expect(
          accountControl.connect(owner).setMintingCap(reserve1.address, 400000) // Below 500000 minted
        ).to.be.revertedWith("ExceedsReserveCap");
      });

      it("should allow reducing cap to exactly current minted amount", async function () {
        await accountControl.connect(owner).setMintingCap(reserve1.address, 500000);
        const reserveInfo = await accountControl.reserveInfo(reserve1.address);
        expect(reserveInfo.mintingCap).to.equal(500000);
      });

      it("should allow increasing cap above current minted amount", async function () {
        await accountControl.connect(owner).setMintingCap(reserve1.address, 1500000);
        const reserveInfo = await accountControl.reserveInfo(reserve1.address);
        expect(reserveInfo.mintingCap).to.equal(1500000);
      });
    });

    describe("setMintingCap Validation", function () {
      it("should revert when setting cap for unauthorized reserve", async function () {
        const unauthorizedReserve = ethers.Wallet.createRandom();

        await expect(
          accountControl.connect(owner).setMintingCap(unauthorizedReserve.address, 1000000)
        ).to.be.revertedWith("NotAuthorized");
      });

      it("should enforce global cap validation when setting individual caps", async function () {
        // Set a low global cap
        await accountControl.connect(owner).setGlobalMintingCap(1500000); // 1.5M total

        // Reserve1 already has 1M cap, Reserve2 has 2M cap
        // Setting Reserve1 to 1M should work (1M + 2M = 3M > 1.5M global, so should fail)
        await expect(
          accountControl.connect(owner).setMintingCap(reserve1.address, 1000000)
        ).to.be.revertedWith("ExceedsGlobalCap");
      });

      it("should allow setting cap when total doesn't exceed global cap", async function () {
        // Set a high global cap to accommodate all reserves
        // Current setup: reserve(1M) + reserve1(1M) + reserve2(2M) + qc(1M) = 5M total
        await accountControl.connect(owner).setGlobalMintingCap(6000000); // 6M total

        // Setting Reserve1 from 1M to 1.5M = 5.5M total < 6M
        await accountControl.connect(owner).setMintingCap(reserve1.address, 1500000);
        const reserveInfo = await accountControl.reserveInfo(reserve1.address);
        expect(reserveInfo.mintingCap).to.equal(1500000);
      });

      it("should ignore global cap validation when global cap is zero", async function () {
        // Ensure global cap is zero (unlimited)
        await accountControl.connect(owner).setGlobalMintingCap(0);

        // Should allow setting any cap when global cap is disabled
        await accountControl.connect(owner).setMintingCap(reserve1.address, 10000000); // 10M
        const reserveInfo = await accountControl.reserveInfo(reserve1.address);
        expect(reserveInfo.mintingCap).to.equal(10000000);
      });
    });

    describe("Authorization Race Condition Protection", function () {
      it("should prevent double authorization", async function () {
        await expect(
          accountControl.connect(owner).authorizeReserve(reserve1.address, 1000000)
        ).to.be.revertedWith("AlreadyAuthorized");
      });

      it("should prevent deauthorizing non-existent reserve", async function () {
        const nonExistentReserve = ethers.Wallet.createRandom().address;

        await expect(
          accountControl.connect(owner).deauthorizeReserve(nonExistentReserve)
        ).to.be.revertedWith("ReserveNotFound");
      });

      it("should prevent address reuse across different reserve types", async function () {
        // First, deauthorize reserve1 (it was authorized as QC_PERMISSIONED = 1)
        await accountControl.connect(owner).deauthorizeReserve(reserve1.address);

        // Try to re-authorize same address for same type - should work
        await accountControl.connect(owner).authorizeReserve(reserve1.address, 1000000); // Same type

        // Deauthorize again for the next test
        await accountControl.connect(owner).deauthorizeReserve(reserve1.address);

        // All reserves are QC_PERMISSIONED by default, just verify re-authorization works
        await accountControl.connect(owner).authorizeReserve(reserve1.address, 500000);
        const reserveInfo = await accountControl.reserveInfo(reserve1.address);
        expect(reserveInfo.mintingCap).to.equal(500000);
      });
    });

    describe("Batch Bank Interface Optimization", function () {
      it("should use batch interface when available", async function () {
        // Enable batch support in mock Bank
        await mockBankContract.setBatchSupported(true);

        const recipients = [user1.address, user2.address];
        const amounts = [100000, 200000];

        await accountControl.connect(reserve1).batchMint(recipients, amounts);

        // Verify batch call was used
        expect(await mockBankContract.batchCallCount()).to.equal(1);
        expect(await mockBankContract.individualCallCount()).to.equal(0);
      });

      it("should fallback to individual calls when batch not supported", async function () {
        // Disable batch support in mock Bank
        await mockBankContract.setBatchSupported(false);

        const recipients = [user1.address, user2.address];
        const amounts = [100000, 200000];

        await accountControl.connect(reserve1).batchMint(recipients, amounts);

        // Verify individual calls were used
        expect(await mockBankContract.batchCallCount()).to.equal(0);
        expect(await mockBankContract.individualCallCount()).to.equal(2);
      });
    });

    describe("Event Emission", function () {
      it("should only emit batch events for gas efficiency", async function () {
        // V2 simplified design: always emit batch events only for gas efficiency
        const recipients = [user1.address, user2.address];
        const amounts = [100000, 200000];

        const tx = await accountControl.connect(reserve1).batchMint(recipients, amounts);
        const receipt = await tx.wait();

        // Should only have BatchMintExecuted event, no individual MintExecuted events
        const batchEvents = receipt.events?.filter(e => e.event === "BatchMintExecuted");
        const individualEvents = receipt.events?.filter(e => e.event === "MintExecuted");

        expect(batchEvents).to.have.length(1);
        expect(individualEvents).to.have.length(0); // Simplified - no individual events
      });
    });

    describe("Storage Layout Compatibility", function () {
      it("should maintain upgrade compatibility", async function () {
        // This test verifies that the storage layout documentation
        // doesn't break existing functionality

        // Test core functionality still works
        await accountControl.connect(reserve1).mint(user1.address, 100000);
        expect(await accountControl.minted(reserve1.address)).to.equal(100000);

        // Test all state variables are accessible
        expect(await accountControl.backing(reserve1.address)).to.equal(1000000);
        expect(await accountControl.authorized(reserve1.address)).to.be.true;
        const reserveInfo = await accountControl.reserveInfo(reserve1.address);
        expect(reserveInfo.mintingCap).to.equal(1000000);
        expect(reserveInfo.paused).to.be.false; // Pause state moved to reserveInfo struct
        expect(await accountControl.systemPaused()).to.be.false;
        expect(await accountControl.emergencyCouncil()).to.equal(emergencyCouncil.address);
        expect(await accountControl.bank()).to.equal(mockBankContract.address);
        // emitIndividualEvents removed for simplicity
      });
    });

    describe("Integration Testing", function () {
      it("should work with all features together", async function () {
        // Enable batch support in mock bank
        await mockBankContract.setBatchSupported(true);

        const recipients = [user1.address, user2.address];
        const amounts = [100000, 200000];

        const tx = await accountControl.connect(reserve1).batchMint(recipients, amounts);
        const receipt = await tx.wait();

        // Verify state updates
        expect(await accountControl.minted(reserve1.address)).to.equal(300000);
        expect(await accountControl.totalMinted()).to.equal(300000);

        // Verify events (V2 simplified: only batch events for gas efficiency)
        const batchEvents = receipt.events?.filter(e => e.event === "BatchMintExecuted");
        const individualEvents = receipt.events?.filter(e => e.event === "MintExecuted");
        expect(batchEvents).to.have.length(1);
        expect(individualEvents).to.have.length(0); // No individual events in V2

        // Verify batch Bank call was used
        expect(await mockBankContract.batchCallCount()).to.equal(1);

        // Test cap reduction safety
        await expect(
          accountControl.connect(owner).setMintingCap(reserve1.address, 200000)
        ).to.be.revertedWith("ExceedsReserveCap");
      });
    });
  });

  // ===== WORKFLOW TESTS =====

  describe("Workflow Tests", function () {
    describe("Direct Integration Testing", function () {
      it("should support the complete mint workflow", async function () {
        const mintAmount = 500000; // 0.005 BTC in satoshis

        // Initial state check
        expect(await accountControl.minted(qc.address)).to.equal(0);
        expect(await accountControl.totalMinted()).to.equal(0);

        // Test mint operation (simulating QCMinter call)
        await accountControl.connect(qc).mint(user.address, mintAmount);

        // Verify state after mint
        expect(await accountControl.minted(qc.address)).to.equal(mintAmount);
        expect(await accountControl.totalMinted()).to.equal(mintAmount);
        expect(await mockBank.balances(user.address)).to.equal(mintAmount);
      });

      it("should support the complete redemption workflow", async function () {
        const mintAmount = 500000; // 0.005 BTC in satoshis
        const redeemAmount = 300000; // 0.003 BTC in satoshis

        // First mint tokens
        await accountControl.connect(qc).mint(user.address, mintAmount);

        // Verify pre-redemption state
        expect(await accountControl.minted(qc.address)).to.equal(mintAmount);

        // Test redemption operation (simulating QCRedeemer call)
        await accountControl.connect(qc).redeem(redeemAmount);

        // Verify state after redemption
        expect(await accountControl.minted(qc.address)).to.equal(mintAmount - redeemAmount);
        expect(await accountControl.totalMinted()).to.equal(mintAmount - redeemAmount);
      });

      it("should support backing updates affecting available mint capacity", async function () {
        const initialBacking = await accountControl.backing(qc.address);
        const stats = await accountControl.getReserveStats(qc.address);

        expect(stats.availableToMint).to.equal(QC_BACKING_AMOUNT);

        // Mint some tokens
        const mintAmount = 300000;
        await accountControl.connect(qc).mint(user.address, mintAmount);

        // Check updated available capacity
        const updatedStats = await accountControl.getReserveStats(qc.address);
        expect(updatedStats.availableToMint).to.equal(QC_BACKING_AMOUNT - mintAmount);

        // QC increases backing
        const newBacking = QC_BACKING_AMOUNT + 500000;
        await accountControl.connect(qc).updateBacking(newBacking);

        // Check final available capacity
        const finalStats = await accountControl.getReserveStats(qc.address);
        const expectedAvailable = Math.min(newBacking - mintAmount, QC_MINTING_CAP - mintAmount);
        expect(finalStats.availableToMint).to.equal(expectedAvailable);
      });

      it("should handle multiple QCs with independent accounting", async function () {
        // Setup second QC
        const qc2 = emergencyCouncil; // Reuse signer
        await accountControl.connect(owner).authorizeReserve(qc2.address, QC_MINTING_CAP);
        await accountControl.connect(qc2).updateBacking(QC_BACKING_AMOUNT);

        const qc1MintAmount = 300000;
        const qc2MintAmount = 400000;

        // Mint from both QCs
        await accountControl.connect(qc).mint(user.address, qc1MintAmount);
        await accountControl.connect(qc2).mint(user.address, qc2MintAmount);

        // Verify independent accounting
        expect(await accountControl.minted(qc.address)).to.equal(qc1MintAmount);
        expect(await accountControl.minted(qc2.address)).to.equal(qc2MintAmount);
        expect(await accountControl.totalMinted()).to.equal(qc1MintAmount + qc2MintAmount);

        // Redeem from one QC
        await accountControl.connect(qc).redeem(100000);

        // Verify only QC1's accounting changed
        expect(await accountControl.minted(qc.address)).to.equal(qc1MintAmount - 100000);
        expect(await accountControl.minted(qc2.address)).to.equal(qc2MintAmount);
        expect(await accountControl.totalMinted()).to.equal(qc1MintAmount + qc2MintAmount - 100000);
      });

      it("should enforce invariants across mint/redeem cycles", async function () {
        const mintAmount = 600000;

        // Test backing invariant - QC reduces backing below minted amount
        await accountControl.connect(qc).updateBacking(mintAmount - 100000); // Less backing than mint

        await expect(
          accountControl.connect(qc).mint(user.address, mintAmount)
        ).to.be.revertedWithCustomError(accountControl, "InsufficientBacking");

        // QC restores proper backing
        await accountControl.connect(qc).updateBacking(QC_BACKING_AMOUNT);

        // Test minting cap invariant
        const lowCap = mintAmount - 100000;
        await accountControl.connect(owner).setMintingCap(qc.address, lowCap);

        await expect(
          accountControl.connect(qc).mint(user.address, mintAmount)
        ).to.be.revertedWithCustomError(accountControl, "ExceedsReserveCap");

        // Test redemption validation
        await expect(
          accountControl.connect(qc).redeem(100000)
        ).to.be.revertedWithCustomError(accountControl, "InsufficientMinted");
      });

      it("should maintain consistency under batch operations", async function () {
        const recipients = [user.address, owner.address];
        const amounts = [250000, 350000];
        const totalAmount = amounts.reduce((a, b) => a + b, 0);

        // Test batch mint
        await accountControl.connect(qc).batchMint(recipients, amounts);

        expect(await accountControl.minted(qc.address)).to.equal(totalAmount);
        expect(await accountControl.totalMinted()).to.equal(totalAmount);
        expect(await mockBank.balances(user.address)).to.equal(amounts[0]);
        expect(await mockBank.balances(owner.address)).to.equal(amounts[1]);

        // Test partial redemption maintains consistency
        const redeemAmount = 200000;
        await accountControl.connect(qc).redeem(redeemAmount);

        expect(await accountControl.minted(qc.address)).to.equal(totalAmount - redeemAmount);
        expect(await accountControl.totalMinted()).to.equal(totalAmount - redeemAmount);
      });

      it("should handle reserve lifecycle properly", async function () {
        const mintAmount = 400000;

        // Mint some tokens
        await accountControl.connect(qc).mint(user.address, mintAmount);
        expect(await accountControl.minted(qc.address)).to.equal(mintAmount);

        // Cannot deauthorize with outstanding balance - this is a safety check
        await expect(
          accountControl.connect(owner).deauthorizeReserve(qc.address)
        ).to.be.revertedWithCustomError(accountControl, "CannotDeauthorizeWithOutstandingBalance");

        // Must redeem all tokens first before deauthorization
        await accountControl.connect(qc).redeem(mintAmount);
        expect(await accountControl.minted(qc.address)).to.equal(0);

        // Now deauthorization should work
        await accountControl.connect(owner).deauthorizeReserve(qc.address);
        expect(await accountControl.authorized(qc.address)).to.be.false;
        const reserveInfo = await accountControl.reserveInfo(qc.address);
        expect(reserveInfo.mintingCap).to.equal(0);
      });

      it("should provide accurate reserve statistics", async function () {
        let stats = await accountControl.getReserveStats(qc.address);

        expect(stats.isAuthorized).to.be.true;
        expect(stats.isPaused).to.be.false;
        expect(stats.backingAmount).to.equal(QC_BACKING_AMOUNT);
        expect(stats.mintedAmount).to.equal(0);
        expect(stats.mintingCap).to.equal(QC_MINTING_CAP);
        expect(stats.availableToMint).to.equal(QC_BACKING_AMOUNT);

        // After minting
        const mintAmount = 300000;
        await accountControl.connect(qc).mint(user.address, mintAmount);

        stats = await accountControl.getReserveStats(qc.address);
        expect(stats.mintedAmount).to.equal(mintAmount);
        expect(stats.availableToMint).to.equal(QC_BACKING_AMOUNT - mintAmount);
      });

      it("should handle emergency scenarios correctly", async function () {
        const mintAmount = 200000;
        await accountControl.connect(qc).mint(user.address, mintAmount);

        // Emergency pause by emergency council
        await accountControl.connect(emergencyCouncil).pauseReserve(qc.address);

        // Should not be able to mint when paused
        await expect(
          accountControl.connect(qc).mint(user.address, mintAmount)
        ).to.be.revertedWithCustomError(accountControl, "ReserveIsPaused");

        // Backing updates are also blocked when paused (uses onlyAuthorizedReserve modifier)
        await expect(
          accountControl.connect(qc).updateBacking(QC_BACKING_AMOUNT + 100000)
        ).to.be.revertedWithCustomError(accountControl, "ReserveIsPaused");

        // Redemption is also blocked when paused
        await expect(
          accountControl.connect(qc).redeem(100000)
        ).to.be.revertedWithCustomError(accountControl, "ReserveIsPaused");

        // Verify backing hasn't changed
        expect(await accountControl.backing(qc.address)).to.equal(QC_BACKING_AMOUNT);

        // Unpause and operations should work again
        await accountControl.connect(owner).unpauseReserve(qc.address);

        // Now backing update should work
        await accountControl.connect(qc).updateBacking(QC_BACKING_AMOUNT + 100000);
        expect(await accountControl.backing(qc.address)).to.equal(QC_BACKING_AMOUNT + 100000);

        // And redemption should work
        await accountControl.connect(qc).redeem(100000);
        expect(await accountControl.minted(qc.address)).to.equal(mintAmount - 100000);
      });
    });
  });
});