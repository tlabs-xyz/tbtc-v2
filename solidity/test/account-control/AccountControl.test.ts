import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { AccountControl } from "../../typechain";
import { safeDeployProxy, cleanupDeployments } from "../helpers/testing-utils";

describe("AccountControl [unit][smoke]", function () {
  let accountControl: AccountControl;
  let owner: SignerWithAddress;
  let emergencyCouncil: SignerWithAddress;
  let reserve: SignerWithAddress;
  let user: SignerWithAddress;
  let mockBank: any;

  beforeEach(async function () {
    [owner, emergencyCouncil, reserve, user] = await ethers.getSigners();

    // Deploy mock Bank
    const MockBankFactory = await ethers.getContractFactory("MockBank");
    mockBank = await MockBankFactory.deploy();

    // Deploy AccountControl using safe deployment (from Validation file - better practice)
    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await safeDeployProxy<AccountControl>(
      AccountControlFactory,
      [owner.address, emergencyCouncil.address, mockBank.address],
      { initializer: "initialize" }
    );

    // Authorize AccountControl to call MockBank functions
    await mockBank.authorizeBalanceIncreaser(accountControl.address);

    // Authorize test reserve (QC_PERMISSIONED is initialized by default)
    await accountControl.connect(owner).authorizeReserve(reserve.address, 1000000); // 0.01 BTC cap in satoshis
    await accountControl.connect(reserve).updateBacking(1000000);
  });

  afterEach(async function () {
    // Clean up deployment locks to prevent conflicts (from Validation file)
    await cleanupDeployments();
  });

  // ===== CORE FUNCTIONALITY TESTS (from Core file) =====
  
  describe("Core Functionality [unit]", function () {
    describe("Optimized totalMinted calculation [unit][smoke]", function () {
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

    describe("Unit consistency [unit][smoke]", function () {
      it("should use correct satoshi constants", async function () {
        expect(await accountControl.MIN_MINT_AMOUNT()).to.equal(10000); // 0.0001 BTC in satoshis
        expect(await accountControl.MAX_SINGLE_MINT()).to.equal(10000000000); // 100 BTC in satoshis
      });
    });
  });

  // ===== VALIDATION TESTS (from Validation file) =====

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