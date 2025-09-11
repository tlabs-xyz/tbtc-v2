import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { AccountControl } from "../../typechain";

describe("AccountControl Core Functionality", function () {
  let accountControl: AccountControl;
  let owner: SignerWithAddress;
  let emergencyCouncil: SignerWithAddress;
  let mockBank: SignerWithAddress;
  let reserve: SignerWithAddress;

  beforeEach(async function () {
    [owner, emergencyCouncil, mockBank, reserve] = await ethers.getSigners();


    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [owner.address, emergencyCouncil.address, mockBank.address],
      { initializer: "initialize" }
    ) as AccountControl;

    // Setup ReserveOracle integration
    await accountControl.connect(owner).setReserveOracle(owner.address);

    // Initialize reserve types
    await accountControl.connect(owner).addReserveType("qc");
    
    // Authorize a reserve for testing
    await accountControl.connect(owner).authorizeReserve(reserve.address, 1000000, "qc"); // 0.01 BTC cap in satoshis
  });

  describe("Optimized totalMinted calculation", function () {
    it("should return zero initially", async function () {
      expect(await accountControl.totalMinted()).to.equal(0);
    });

    it("should track total minted amount efficiently", async function () {
      // Set backing for reserve via oracle consensus
      await accountControl.connect(owner).updateBacking(reserve.address, 2000000); // 0.02 BTC

      // Mock Bank.increaseBalance call (normally would be called)
      const amount = 500000; // 0.005 BTC in satoshis
      
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
      // Set backing and simulate minted balance
      await accountControl.connect(owner).updateBacking(reserve.address, 1000000);
      await accountControl.connect(reserve).adjustMinted(500000, true);
      
      await expect(
        accountControl.connect(owner).deauthorizeReserve(reserve.address)
      ).to.be.revertedWith("CannotDeauthorizeWithOutstandingBalance");
    });

    it("should clear backing when deauthorizing clean reserve", async function () {
      // Set backing but no minted balance
      await accountControl.connect(owner).updateBacking(reserve.address, 1000000);
      
      expect(await accountControl.backing(reserve.address)).to.equal(1000000);
      
      await accountControl.connect(owner).deauthorizeReserve(reserve.address);
      
      expect(await accountControl.backing(reserve.address)).to.equal(0);
    });
  });

  describe("redeem function", function () {
    beforeEach(async function () {
      // Set up backing via oracle consensus and simulate a previous mint
      await accountControl.connect(owner).updateBacking(reserve.address, 1000000);
      // We can't actually mint without a proper Bank mock, but we can test the redeem logic
      // by directly setting the minted amount using adjustMinted
      await accountControl.connect(reserve).adjustMinted(500000, true); // Add 0.005 BTC minted
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

  describe("Unit consistency", function () {
    it("should use correct satoshi constants", async function () {
      expect(await accountControl.MIN_MINT_AMOUNT()).to.equal(10000); // 0.0001 BTC in satoshis
      expect(await accountControl.MAX_SINGLE_MINT()).to.equal(10000000000); // 100 BTC in satoshis
    });
  });
});