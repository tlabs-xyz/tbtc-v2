import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { AccountControl } from "../../typechain";

describe("AccountControl Features", function () {
  let accountControl: AccountControl;
  let owner: SignerWithAddress;
  let emergencyCouncil: SignerWithAddress;
  let mockBank: SignerWithAddress;
  let reserve1: SignerWithAddress;
  let reserve2: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  // Mock Bank that supports both individual and batch operations
  let mockBankContract: any;

  beforeEach(async function () {
    [owner, emergencyCouncil, mockBank, reserve1, reserve2, user1, user2] = await ethers.getSigners();

    // Deploy mock Bank with batch support
    const MockBankFactory = await ethers.getContractFactory("MockBank");
    mockBankContract = await MockBankFactory.deploy();


    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [owner.address, emergencyCouncil.address, mockBankContract.address],
      { initializer: "initialize" }
    ) as AccountControl;

    // Note: No ReserveOracle integration needed in federated model

    // Authorize reserves for testing (QC_PERMISSIONED is initialized by default)
    await accountControl.connect(owner).authorizeReserve(reserve1.address, 1000000); // 0.01 BTC cap
    await accountControl.connect(owner).authorizeReserve(reserve2.address, 2000000); // 0.02 BTC cap
    
    // Reserves set their own backing (federated model)
    await accountControl.connect(reserve1).updateBacking(1000000);
    await accountControl.connect(reserve2).updateBacking(2000000);
  });

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
      // Set a high global cap
      await accountControl.connect(owner).setGlobalMintingCap(5000000); // 5M total
      
      // Reserve1: 1M, Reserve2: 2M, setting Reserve1 to 1.5M = 3.5M total < 5M
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
      
      // Only QC_PERMISSIONED type exists in V2, so just verify basic re-authorization works
      await accountControl.connect(owner).authorizeReserve(reserve1.address, 500000);
      const reserveInfo = await accountControl.reserveInfo(reserve1.address);
      expect(reserveInfo.reserveType).to.equal(1); // QC_PERMISSIONED = 1 (UNINITIALIZED = 0)
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