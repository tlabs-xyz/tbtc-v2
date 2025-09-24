import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { AccountControl } from "../../typechain";
import { getContractConstants, expectBalanceChange, getTestAmounts, deployAccountControlForTest } from "../helpers/testing-utils";

describe("AccountControl Separated Operations", function () {
  let accountControl: AccountControl;
  let owner: SignerWithAddress;
  let emergencyCouncil: SignerWithAddress;
  let mockBank: any;
  let reserve: SignerWithAddress;
  let user: SignerWithAddress;
  let amounts: any;

  beforeEach(async function () {
    [owner, emergencyCouncil, reserve, user] = await ethers.getSigners();

    // Deploy mock Bank with new functions
    const MockBankFactory = await ethers.getContractFactory("MockBankWithSeparatedOps");
    mockBank = await MockBankFactory.deploy();

    // Deploy AccountControl using helper
    accountControl = await deployAccountControlForTest(owner, emergencyCouncil, mockBank) as AccountControl;

    // Get dynamic test amounts
    amounts = await getTestAmounts(accountControl);

    // Authorize a reserve for testing
    await accountControl.connect(owner).authorizeReserve(reserve.address, amounts.SMALL_CAP);
  });

  describe("Pure Token Operations", function () {

    describe("mint(address, uint256)", function () {
      it("should mint tokens without updating accounting", async function () {
        // Setup backing
        await accountControl.connect(reserve).updateBacking(amounts.MEDIUM_CAP);

        const initialMinted = await accountControl.minted(reserve.address);

        // Call pure mint
        await accountControl.connect(reserve).mint(user.address, amounts.SMALL_MINT);

        // Verify: tokens minted via Bank.mint(), minted[reserve] unchanged
        expect(await mockBank.balanceOf(user.address)).to.equal(amounts.SMALL_MINT);
        expect(await accountControl.minted(reserve.address)).to.equal(initialMinted); // No accounting update
        expect(await accountControl.totalMintedAmount()).to.equal(initialMinted); // No change
      });

      it("should enforce backing requirements", async function () {
        // Don't set backing - should fail
        await expect(
          accountControl.connect(reserve).mint(user.address, amounts.SMALL_MINT)
        ).to.be.revertedWith("InsufficientBacking");
      });

      it("should check backing against existing minted amount", async function () {
        // Set backing and credit some minted amount
        await accountControl.connect(reserve).updateBacking(amounts.MEDIUM_CAP);
        await accountControl.connect(reserve).creditMinted(amounts.SMALL_CAP);

        // Try to mint more than remaining backing
        const remainingBacking = amounts.MEDIUM_CAP - amounts.SMALL_CAP;
        await expect(
          accountControl.connect(reserve).mint(user.address, remainingBacking + 1)
        ).to.be.revertedWith("InsufficientBacking");
      });

      it("should emit PureTokenMint event", async function () {
        await accountControl.connect(reserve).updateBacking(amounts.MEDIUM_CAP);

        await expect(
          accountControl.connect(reserve).mint(user.address, amounts.SMALL_MINT)
        ).to.emit(accountControl, "PureTokenMint")
         .withArgs(reserve.address, user.address, amounts.SMALL_MINT);
      });

      it("should require authorization", async function () {
        await expect(
          accountControl.connect(user).mint(user.address, amounts.SMALL_MINT)
        ).to.be.revertedWith("UnauthorizedReserve");
      });
    });

    describe("burn(uint256)", function () {
      beforeEach(async function () {
        // Setup: give user some tokens first
        await accountControl.connect(reserve).updateBacking(amounts.MEDIUM_CAP);
        await mockBank.mint(reserve.address, amounts.MEDIUM_CAP); // Give reserve tokens to burn
      });

      it("should burn tokens without updating accounting", async function () {
        // Setup accounting state
        await accountControl.connect(reserve).creditMinted(amounts.SMALL_MINT);
        const initialMinted = await accountControl.minted(reserve.address);
        const initialTotal = await accountControl.totalMintedAmount();

        // Call pure burn
        await accountControl.connect(reserve).burn(amounts.SMALL_MINT);

        // Verify: tokens burned, accounting unchanged
        expect(await mockBank.balanceOf(reserve.address)).to.equal(amounts.MEDIUM_CAP - amounts.SMALL_MINT);
        expect(await accountControl.minted(reserve.address)).to.equal(initialMinted); // No change
        expect(await accountControl.totalMintedAmount()).to.equal(initialTotal); // No change
      });

      it("should emit PureTokenBurn event", async function () {
        await expect(
          accountControl.connect(reserve).burn(amounts.SMALL_MINT)
        ).to.emit(accountControl, "PureTokenBurn")
         .withArgs(reserve.address, amounts.SMALL_MINT);
      });

      it("should require authorization", async function () {
        await expect(
          accountControl.connect(user).burn(amounts.SMALL_MINT)
        ).to.be.revertedWith("UnauthorizedReserve");
      });
    });
  });

  describe("Pure Accounting Operations", function () {

    describe("creditMinted(uint256)", function () {
      it("should update accounting without minting tokens", async function () {
        const initialBalance = await mockBank.balanceOf(user.address);

        // Call pure accounting credit
        await accountControl.connect(reserve).creditMinted(amounts.SMALL_MINT);

        // Verify: accounting updated, no tokens minted
        expect(await accountControl.minted(reserve.address)).to.equal(amounts.SMALL_MINT);
        expect(await accountControl.totalMintedAmount()).to.equal(amounts.SMALL_MINT);
        expect(await mockBank.balanceOf(user.address)).to.equal(initialBalance); // No tokens
      });

      it("should enforce minting caps", async function () {
        // Try to credit more than reserve cap
        await expect(
          accountControl.connect(reserve).creditMinted(amounts.SMALL_CAP + 1)
        ).to.be.revertedWith("ExceedsReserveCap");
      });

      it("should enforce global minting cap", async function () {
        // Set global cap
        await accountControl.connect(owner).setGlobalMintingCap(amounts.SMALL_MINT);

        await expect(
          accountControl.connect(reserve).creditMinted(amounts.SMALL_MINT + 1)
        ).to.be.revertedWith("ExceedsGlobalCap");
      });

      it("should emit AccountingCredit event", async function () {
        await expect(
          accountControl.connect(reserve).creditMinted(amounts.SMALL_MINT)
        ).to.emit(accountControl, "AccountingCredit")
         .withArgs(reserve.address, amounts.SMALL_MINT);
      });

      it("should require authorization", async function () {
        await expect(
          accountControl.connect(user).creditMinted(amounts.SMALL_MINT)
        ).to.be.revertedWith("UnauthorizedReserve");
      });
    });

    describe("debitMinted(uint256)", function () {
      it("should update accounting without burning tokens", async function () {
        // Setup: credit first
        await accountControl.connect(reserve).creditMinted(amounts.MEDIUM_CAP);
        const initialBalance = await mockBank.balanceOf(user.address);

        // Call pure accounting debit
        await accountControl.connect(reserve).debitMinted(amounts.SMALL_MINT);

        // Verify: accounting updated, no tokens burned
        expect(await accountControl.minted(reserve.address)).to.equal(amounts.MEDIUM_CAP - amounts.SMALL_MINT);
        expect(await accountControl.totalMintedAmount()).to.equal(amounts.MEDIUM_CAP - amounts.SMALL_MINT);
        expect(await mockBank.balanceOf(user.address)).to.equal(initialBalance); // No token change
      });

      it("should enforce sufficient minted balance", async function () {
        await expect(
          accountControl.connect(reserve).debitMinted(amounts.SMALL_MINT)
        ).to.be.revertedWith("InsufficientMinted");
      });

      it("should emit AccountingDebit event", async function () {
        // Setup
        await accountControl.connect(reserve).creditMinted(amounts.MEDIUM_CAP);

        await expect(
          accountControl.connect(reserve).debitMinted(amounts.SMALL_MINT)
        ).to.emit(accountControl, "AccountingDebit")
         .withArgs(reserve.address, amounts.SMALL_MINT);
      });

      it("should require authorization", async function () {
        await expect(
          accountControl.connect(user).debitMinted(amounts.SMALL_MINT)
        ).to.be.revertedWith("UnauthorizedReserve");
      });
    });
  });

  describe("Backward Compatibility", function () {

    describe("mintTBTC() using separated operations", function () {
      it("should work identically to current implementation", async function () {
        await accountControl.connect(reserve).updateBacking(amounts.MEDIUM_CAP);

        const tbtcAmount = ethers.utils.parseEther("0.005"); // 0.005 tBTC
        const expectedSatoshis = tbtcAmount.div(ethers.utils.parseUnits("1", 10)); // Convert to satoshis

        // Call existing mintTBTC function
        await accountControl.connect(reserve).mintTBTC(user.address, tbtcAmount);

        // Verify both token minting AND accounting occurred
        expect(await mockBank.balanceOf(user.address)).to.equal(expectedSatoshis);
        expect(await accountControl.minted(reserve.address)).to.equal(expectedSatoshis);
        expect(await accountControl.totalMintedAmount()).to.equal(expectedSatoshis);
      });

      it("should maintain same event emissions", async function () {
        await accountControl.connect(reserve).updateBacking(amounts.MEDIUM_CAP);
        const tbtcAmount = ethers.utils.parseEther("0.005");

        const tx = await accountControl.connect(reserve).mintTBTC(user.address, tbtcAmount);

        // Should emit both new events and original event for compatibility
        await expect(tx).to.emit(accountControl, "PureTokenMint");
        await expect(tx).to.emit(accountControl, "AccountingCredit");
        await expect(tx).to.emit(accountControl, "MintExecuted");
      });
    });

    describe("burnTBTC() new functionality", function () {
      it("should burn tokens and update accounting", async function () {
        // Setup: mint first
        await accountControl.connect(reserve).updateBacking(amounts.MEDIUM_CAP);
        await mockBank.mint(reserve.address, amounts.MEDIUM_CAP);
        await accountControl.connect(reserve).creditMinted(amounts.MEDIUM_CAP);

        const tbtcAmount = ethers.utils.parseEther("0.005");
        const expectedSatoshis = tbtcAmount.div(ethers.utils.parseUnits("1", 10));

        const initialBalance = await mockBank.balanceOf(reserve.address);
        const initialMinted = await accountControl.minted(reserve.address);

        // Call burnTBTC
        await accountControl.connect(reserve).burnTBTC(tbtcAmount);

        // Verify both token burning AND accounting occurred
        expect(await mockBank.balanceOf(reserve.address)).to.equal(initialBalance.sub(expectedSatoshis));
        expect(await accountControl.minted(reserve.address)).to.equal(initialMinted.sub(expectedSatoshis));
      });

      it("should emit separated operation events", async function () {
        // Setup
        await mockBank.mint(reserve.address, amounts.MEDIUM_CAP);
        await accountControl.connect(reserve).creditMinted(amounts.MEDIUM_CAP);

        const tbtcAmount = ethers.utils.parseEther("0.005");

        const tx = await accountControl.connect(reserve).burnTBTC(tbtcAmount);

        await expect(tx).to.emit(accountControl, "PureTokenBurn");
        await expect(tx).to.emit(accountControl, "AccountingDebit");
      });
    });
  });

  describe("CEX Vault Integration Scenarios", function () {

    describe("Strategy Loss Handling", function () {
      it("should handle proportional burns during strategy losses", async function () {
        // Setup: Normal mint operation
        await accountControl.connect(reserve).updateBacking(amounts.LARGE_CAP);
        await accountControl.connect(reserve).mintTBTC(user.address, ethers.utils.parseEther("0.01"));

        // Give reserve tokens to burn
        await mockBank.mint(reserve.address, amounts.SMALL_MINT);

        const initialMinted = await accountControl.minted(reserve.address);

        // Simulate strategy loss: burn 50% of tokens without accounting update
        const burnAmount = amounts.SMALL_MINT;
        await accountControl.connect(reserve).burn(burnAmount);

        // Verify: tokens burned, accounting unchanged (for loss absorption)
        expect(await mockBank.balanceOf(reserve.address)).to.equal(0);
        expect(await accountControl.minted(reserve.address)).to.equal(initialMinted); // No change

        // Later: Adjust accounting when loss is confirmed
        await accountControl.connect(reserve).debitMinted(burnAmount);
        expect(await accountControl.minted(reserve.address)).to.equal(initialMinted.sub(burnAmount));
      });

      it("should maintain system invariants during complex loss scenarios", async function () {
        await accountControl.connect(reserve).updateBacking(amounts.LARGE_CAP);

        // 1. Normal minting
        await accountControl.connect(reserve).mintTBTC(user.address, ethers.utils.parseEther("0.01"));
        await mockBank.mint(reserve.address, amounts.SMALL_MINT);

        // 2. Strategy detects potential loss - preemptively burn tokens
        await accountControl.connect(reserve).burn(amounts.SMALL_MINT);

        // 3. Loss confirmed - update accounting
        await accountControl.connect(reserve).debitMinted(amounts.SMALL_MINT);

        // 4. Strategy recovers - mint back without full accounting (gradual recovery)
        const partialRecovery = amounts.SMALL_MINT / 2;
        await accountControl.connect(reserve).mint(user.address, partialRecovery);

        // Verify system state consistency
        const finalMinted = await accountControl.minted(reserve.address);
        const finalTotalMinted = await accountControl.totalMintedAmount();
        const userBalance = await mockBank.balanceOf(user.address);

        // Invariants should hold
        expect(finalTotalMinted).to.be.gte(0);
        expect(finalMinted).to.be.lte(await accountControl.backing(reserve.address));
      });
    });

    describe("Recovery Scenarios", function () {
      it("should support gradual recovery from losses", async function () {
        // Setup loss state
        await accountControl.connect(reserve).updateBacking(amounts.LARGE_CAP);
        await accountControl.connect(reserve).mintTBTC(user.address, ethers.utils.parseEther("0.01"));
        await mockBank.mint(reserve.address, amounts.MEDIUM_CAP);

        // Simulate 75% loss
        const lossAmount = (amounts.SMALL_MINT * 3) / 4;
        await accountControl.connect(reserve).burn(lossAmount);
        await accountControl.connect(reserve).debitMinted(lossAmount);

        // Recovery: gradually mint back as strategy recovers
        const recoverySteps = 5;
        const stepAmount = Math.floor(lossAmount / recoverySteps);

        for (let i = 0; i < recoverySteps; i++) {
          await accountControl.connect(reserve).mint(user.address, stepAmount);
          await accountControl.connect(reserve).creditMinted(stepAmount);

          // Verify consistency at each step
          const currentMinted = await accountControl.minted(reserve.address);
          const currentBacking = await accountControl.backing(reserve.address);
          expect(currentMinted).to.be.lte(currentBacking);
        }
      });
    });
  });

  describe("Security & Edge Cases", function () {

    describe("Authorization", function () {
      it("should require authorization for all separated operations", async function () {
        await expect(
          accountControl.connect(user).mint(user.address, amounts.SMALL_MINT)
        ).to.be.revertedWith("UnauthorizedReserve");

        await expect(
          accountControl.connect(user).burn(amounts.SMALL_MINT)
        ).to.be.revertedWith("UnauthorizedReserve");

        await expect(
          accountControl.connect(user).creditMinted(amounts.SMALL_MINT)
        ).to.be.revertedWith("UnauthorizedReserve");

        await expect(
          accountControl.connect(user).debitMinted(amounts.SMALL_MINT)
        ).to.be.revertedWith("UnauthorizedReserve");
      });
    });

    describe("State Consistency", function () {
      it("should maintain backing invariant across operations", async function () {
        // Setup backing
        await accountControl.connect(reserve).updateBacking(amounts.MEDIUM_CAP);

        // Credit accounting beyond backing should work (for loss scenarios)
        await accountControl.connect(reserve).creditMinted(amounts.LARGE_CAP);

        // But minting tokens beyond backing should fail
        await expect(
          accountControl.connect(reserve).mint(user.address, amounts.SMALL_MINT)
        ).to.be.revertedWith("InsufficientBacking");
      });

      it("should handle zero amounts", async function () {
        // All functions should handle zero amounts gracefully
        await expect(accountControl.connect(reserve).mint(user.address, 0)).to.not.be.reverted;
        await expect(accountControl.connect(reserve).burn(0)).to.not.be.reverted;
        await expect(accountControl.connect(reserve).creditMinted(0)).to.not.be.reverted;
        await expect(accountControl.connect(reserve).debitMinted(0)).to.not.be.reverted;
      });
    });

    describe("Pausing", function () {
      it("should respect pause state for all operations", async function () {
        await accountControl.connect(owner).pauseReserve(reserve.address);

        await expect(
          accountControl.connect(reserve).mint(user.address, amounts.SMALL_MINT)
        ).to.be.revertedWith("ReservePaused");

        await expect(
          accountControl.connect(reserve).burn(amounts.SMALL_MINT)
        ).to.be.revertedWith("ReservePaused");

        await expect(
          accountControl.connect(reserve).creditMinted(amounts.SMALL_MINT)
        ).to.be.revertedWith("ReservePaused");

        await expect(
          accountControl.connect(reserve).debitMinted(amounts.SMALL_MINT)
        ).to.be.revertedWith("ReservePaused");
      });
    });
  });
});