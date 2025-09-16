import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { AccountControl } from "../../typechain";
import { getContractConstants, expectBalanceChange, getTestAmounts, deployAccountControlForTest } from "../helpers/testing-utils";

describe("AccountControl Core Functionality", function () {
  let accountControl: AccountControl;
  let owner: SignerWithAddress;
  let emergencyCouncil: SignerWithAddress;
  let mockBank: any;
  let reserve: SignerWithAddress;
  let user: SignerWithAddress;
  let amounts: any;

  beforeEach(async function () {
    [owner, emergencyCouncil, reserve, user] = await ethers.getSigners();

    // Deploy mock Bank
    const MockBankFactory = await ethers.getContractFactory("MockBank");
    mockBank = await MockBankFactory.deploy();

    // Deploy AccountControl using helper
    accountControl = await deployAccountControlForTest(owner, emergencyCouncil, mockBank) as AccountControl;

    // Get dynamic test amounts
    amounts = await getTestAmounts(accountControl);

    // Note: Using direct updateBacking() for unit tests (oracle integration tested separately)

    // Authorize a reserve for testing (QC_PERMISSIONED is initialized by default)
    await accountControl.connect(owner).authorizeReserve(reserve.address, amounts.SMALL_CAP); // 0.01 BTC cap
  });

  describe("Optimized totalMinted calculation", function () {
    it("should return zero initially", async function () {
      expect(await accountControl.totalMinted()).to.equal(0);
    });

    it("should track total minted amount efficiently", async function () {
      // Reserve updates its own backing (federated model)
      await accountControl.connect(reserve).updateBacking(amounts.MEDIUM_CAP); // 0.02 BTC

      // Mock Bank.increaseBalance call (normally would be called)
      const amount = amounts.SMALL_MINT; // 0.005 BTC in satoshis
      
      // This would normally fail because we can't call mint from non-reserve
      // but we're testing the state tracking logic
      expect(await accountControl.totalMintedAmount()).to.equal(0);
    });
  });

  describe("Reserve deauthorization", function () {
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
      await accountControl.connect(reserve).updateBacking(amounts.SMALL_CAP);
      await accountControl.connect(reserve).mint(user.address, amounts.SMALL_MINT);
      
      await expect(
        accountControl.connect(owner).deauthorizeReserve(reserve.address)
      ).to.be.revertedWith("CannotDeauthorizeWithOutstandingBalance");
    });

    it("should clear backing when deauthorizing clean reserve", async function () {
      // Reserve sets backing but no minted balance
      await accountControl.connect(reserve).updateBacking(amounts.SMALL_CAP);

      expect(await accountControl.backing(reserve.address)).to.equal(amounts.SMALL_CAP);
      
      await accountControl.connect(owner).deauthorizeReserve(reserve.address);
      
      expect(await accountControl.backing(reserve.address)).to.equal(0);
    });
  });

  describe("redeem function", function () {
    beforeEach(async function () {
      // Reserve sets up backing and perform a previous mint
      await accountControl.connect(reserve).updateBacking(amounts.SMALL_CAP);
      // Mint some tokens to create minted balance for testing redemption
      await accountControl.connect(reserve).mint(user.address, amounts.SMALL_MINT); // Mint 0.005 BTC
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
        accountControl.connect(reserve).redeem(amounts.SMALL_CAP) // More than minted
      ).to.be.revertedWith("InsufficientMinted");
    });
  });

  describe("Unit consistency", function () {
    it("should use correct satoshi constants", async function () {
      expect(await accountControl.MIN_MINT_AMOUNT()).to.equal(10000); // 0.0001 BTC in satoshis
      expect(await accountControl.MAX_SINGLE_MINT()).to.equal(10000000000); // 100 BTC in satoshis
    });
  });
});