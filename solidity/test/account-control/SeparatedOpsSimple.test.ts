import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { AccountControl } from "../../typechain";

describe("AccountControl Separated Operations - Simple Test", function () {
  let accountControl: AccountControl;
  let owner: SignerWithAddress;
  let emergencyCouncil: SignerWithAddress;
  let mockBank: any;
  let reserve: SignerWithAddress;
  let user: SignerWithAddress;

  // Fixed test amounts
  const SMALL_CAP = ethers.utils.parseUnits("1000000", 0);   // 1M satoshis = 0.01 BTC
  const MEDIUM_CAP = ethers.utils.parseUnits("2000000", 0);  // 2M satoshis = 0.02 BTC
  const SMALL_MINT = ethers.utils.parseUnits("500000", 0);   // 500K satoshis = 0.005 BTC

  beforeEach(async function () {
    [owner, emergencyCouncil, reserve, user] = await ethers.getSigners();

    // Deploy mock Bank with new functions
    const MockBankFactory = await ethers.getContractFactory("MockBankWithSeparatedOps");
    mockBank = await MockBankFactory.deploy();

    // Deploy AccountControl
    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [owner.address, emergencyCouncil.address, mockBank.address],
      { initializer: "initialize" }
    ) as AccountControl;

    // Authorize a reserve for testing
    await accountControl.connect(owner).authorizeReserve(reserve.address, SMALL_CAP);
  });

  describe("Core Separated Operations", function () {

    it("should mint tokens without updating accounting", async function () {
      // Setup backing
      await accountControl.connect(reserve).updateBacking(MEDIUM_CAP);

      const initialMinted = await accountControl.minted(reserve.address);

      // Call pure mint
      await accountControl.connect(reserve).mint(user.address, SMALL_MINT);

      // Verify: tokens minted via Bank.mint(), minted[reserve] unchanged
      expect(await mockBank.balanceOf(user.address)).to.equal(SMALL_MINT);
      expect(await accountControl.minted(reserve.address)).to.equal(initialMinted); // No accounting update
    });

    it("should burn tokens without updating accounting", async function () {
      // Setup: give reserve some tokens first
      await mockBank.mint(reserve.address, MEDIUM_CAP);
      await accountControl.connect(reserve).creditMinted(SMALL_MINT);

      const initialMinted = await accountControl.minted(reserve.address);

      // Call pure burn
      await accountControl.connect(reserve).burn(SMALL_MINT);

      // Verify: tokens burned, accounting unchanged
      expect(await mockBank.balanceOf(reserve.address)).to.equal(MEDIUM_CAP.sub(SMALL_MINT));
      expect(await accountControl.minted(reserve.address)).to.equal(initialMinted); // No change
    });

    it("should update accounting without minting tokens", async function () {
      const initialBalance = await mockBank.balanceOf(user.address);

      // Call pure accounting credit
      await accountControl.connect(reserve).creditMinted(SMALL_MINT);

      // Verify: accounting updated, no tokens minted
      expect(await accountControl.minted(reserve.address)).to.equal(SMALL_MINT);
      expect(await mockBank.balanceOf(user.address)).to.equal(initialBalance); // No tokens
    });

    it("should update accounting without burning tokens", async function () {
      // Setup: credit first
      await accountControl.connect(reserve).creditMinted(MEDIUM_CAP);
      const initialBalance = await mockBank.balanceOf(user.address);

      // Call pure accounting debit
      await accountControl.connect(reserve).debitMinted(SMALL_MINT);

      // Verify: accounting updated, no tokens burned
      expect(await accountControl.minted(reserve.address)).to.equal(MEDIUM_CAP.sub(SMALL_MINT));
      expect(await mockBank.balanceOf(user.address)).to.equal(initialBalance); // No token change
    });

    it("should emit proper events", async function () {
      await accountControl.connect(reserve).updateBacking(MEDIUM_CAP);

      // Test pure mint event
      await expect(
        accountControl.connect(reserve).mint(user.address, SMALL_MINT)
      ).to.emit(accountControl, "PureTokenMint")
       .withArgs(reserve.address, user.address, SMALL_MINT);

      // Test accounting credit event
      await expect(
        accountControl.connect(reserve).creditMinted(SMALL_MINT)
      ).to.emit(accountControl, "AccountingCredit")
       .withArgs(reserve.address, SMALL_MINT);
    });
  });

  describe("Backward Compatibility", function () {

    it("should maintain mintTBTC functionality", async function () {
      await accountControl.connect(reserve).updateBacking(MEDIUM_CAP);

      const tbtcAmount = ethers.utils.parseEther("0.005"); // 0.005 tBTC
      const expectedSatoshis = tbtcAmount.div(ethers.utils.parseUnits("1", 10)); // Convert to satoshis

      // Call existing mintTBTC function
      await accountControl.connect(reserve).mintTBTC(user.address, tbtcAmount);

      // Verify both token minting AND accounting occurred
      expect(await mockBank.balanceOf(user.address)).to.equal(expectedSatoshis);
      expect(await accountControl.minted(reserve.address)).to.equal(expectedSatoshis);
    });

    it("should handle burnTBTC functionality", async function () {
      // Setup: mint first
      await accountControl.connect(reserve).updateBacking(MEDIUM_CAP);
      await mockBank.mint(reserve.address, MEDIUM_CAP);
      await accountControl.connect(reserve).creditMinted(MEDIUM_CAP);

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
  });

  describe("Authorization", function () {

    it("should require authorization for separated operations", async function () {
      await expect(
        accountControl.connect(user).mint(user.address, SMALL_MINT)
      ).to.be.revertedWith("NotAuthorized");

      await expect(
        accountControl.connect(user).burn(SMALL_MINT)
      ).to.be.revertedWith("NotAuthorized");

      await expect(
        accountControl.connect(user).creditMinted(SMALL_MINT)
      ).to.be.revertedWith("NotAuthorized");

      await expect(
        accountControl.connect(user).debitMinted(SMALL_MINT)
      ).to.be.revertedWith("NotAuthorized");
    });
  });

  describe("CEX Vault Loss Scenario", function () {

    it("should handle strategy loss through separated operations", async function () {
      // Setup: Normal mint operation
      await accountControl.connect(reserve).updateBacking(MEDIUM_CAP.mul(5));
      await accountControl.connect(reserve).mintTBTC(user.address, ethers.utils.parseEther("0.01"));

      // Give reserve tokens to burn
      await mockBank.mint(reserve.address, SMALL_MINT);

      const initialMinted = await accountControl.minted(reserve.address);

      // Simulate strategy loss: burn tokens without accounting update
      await accountControl.connect(reserve).burn(SMALL_MINT);

      // Verify: tokens burned, accounting unchanged (for loss absorption)
      expect(await mockBank.balanceOf(reserve.address)).to.equal(0);
      expect(await accountControl.minted(reserve.address)).to.equal(initialMinted); // No change

      // Later: Adjust accounting when loss is confirmed
      await accountControl.connect(reserve).debitMinted(SMALL_MINT);
      expect(await accountControl.minted(reserve.address)).to.equal(initialMinted.sub(SMALL_MINT));
    });
  });
});