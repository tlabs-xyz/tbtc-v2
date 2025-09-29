import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { AccountControl } from "../../typechain";
import { safeDeployProxy, cleanupDeployments } from "../helpers/testing-utils";

describe("AccountControl Workflows", function () {
  let accountControl: AccountControl;
  let owner: SignerWithAddress;
  let emergencyCouncil: SignerWithAddress;
  let qc: SignerWithAddress;
  let user: SignerWithAddress;
  
  let mockBank: any;

  const QC_BACKING_AMOUNT = 1000000; // 0.01 BTC in satoshis
  const QC_MINTING_CAP = 1000000; // 0.01 BTC in satoshis

  beforeEach(async function () {
    [owner, emergencyCouncil, qc, user] = await ethers.getSigners();

    // Deploy mock Bank
    const MockBankFactory = await ethers.getContractFactory("MockBank");
    mockBank = await MockBankFactory.deploy();

    // Deploy AccountControl using safe deployment
    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await safeDeployProxy<AccountControl>(
      AccountControlFactory,
      [owner.address, emergencyCouncil.address, mockBank.address],
      { initializer: "initialize" }
    );

    // Authorize AccountControl to call MockBank functions
    await mockBank.authorizeBalanceIncreaser(accountControl.address);

    // Note: Using direct updateBacking() for unit tests (oracle integration tested separately)

    // Setup AccountControl (QC_PERMISSIONED is initialized by default)
    await accountControl.connect(owner).authorizeReserve(qc.address, QC_MINTING_CAP);
    await accountControl.connect(qc).updateBacking(QC_BACKING_AMOUNT);
  });

  afterEach(async function () {
    // Clean up deployment locks to prevent conflicts
    await cleanupDeployments();
  });

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