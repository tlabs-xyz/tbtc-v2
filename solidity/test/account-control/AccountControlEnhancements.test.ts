import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { AccountControl } from "../../typechain";

describe("AccountControl Enhancements", function () {
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
    const MockBankFactory = await ethers.getContractFactory("MockBankEnhanced");
    mockBankContract = await MockBankFactory.deploy();

    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [owner.address, emergencyCouncil.address, mockBankContract.address],
      { initializer: "initialize" }
    ) as AccountControl;

    // Authorize reserves for testing
    await accountControl.connect(owner).authorizeReserve(reserve1.address, 1000000); // 0.01 BTC cap
    await accountControl.connect(owner).authorizeReserve(reserve2.address, 2000000); // 0.02 BTC cap
    
    // Set backing for reserves
    await accountControl.connect(reserve1).updateBacking(1000000);
    await accountControl.connect(reserve2).updateBacking(2000000);
  });

  describe("Enhancement 1: Batch Atomicity", function () {
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

  describe("Enhancement 2: Reserve Cap Reduction Safety", function () {
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
      expect(await accountControl.mintingCaps(reserve1.address)).to.equal(500000);
    });

    it("should allow increasing cap above current minted amount", async function () {
      await accountControl.connect(owner).setMintingCap(reserve1.address, 1500000);
      expect(await accountControl.mintingCaps(reserve1.address)).to.equal(1500000);
    });
  });

  describe("Enhancement 3: Authorization Race Condition Protection", function () {
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
  });

  describe("Enhancement 4: Batch Bank Interface Optimization", function () {
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

  describe("Enhancement 7: Event Emission Optimization", function () {
    it("should not emit individual events by default", async function () {
      const recipients = [user1.address, user2.address];
      const amounts = [100000, 200000];

      const tx = await accountControl.connect(reserve1).batchMint(recipients, amounts);
      const receipt = await tx.wait();

      // Should only have BatchMintExecuted event, no individual MintExecuted events
      const batchEvents = receipt.events?.filter(e => e.event === "BatchMintExecuted");
      const individualEvents = receipt.events?.filter(e => e.event === "MintExecuted");

      expect(batchEvents).to.have.length(1);
      expect(individualEvents).to.have.length(0);
    });

    it("should emit individual events when enabled", async function () {
      // Enable individual event emission
      await accountControl.connect(owner).setIndividualEventEmission(true);

      const recipients = [user1.address, user2.address];
      const amounts = [100000, 200000];

      const tx = await accountControl.connect(reserve1).batchMint(recipients, amounts);
      const receipt = await tx.wait();

      // Should have both BatchMintExecuted and individual MintExecuted events
      const batchEvents = receipt.events?.filter(e => e.event === "BatchMintExecuted");
      const individualEvents = receipt.events?.filter(e => e.event === "MintExecuted");

      expect(batchEvents).to.have.length(1);
      expect(individualEvents).to.have.length(2);
    });

    it("should toggle individual event emission", async function () {
      expect(await accountControl.emitIndividualEvents()).to.be.false;

      await accountControl.connect(owner).setIndividualEventEmission(true);
      expect(await accountControl.emitIndividualEvents()).to.be.true;

      await accountControl.connect(owner).setIndividualEventEmission(false);
      expect(await accountControl.emitIndividualEvents()).to.be.false;
    });

    it("should only allow owner to toggle individual event emission", async function () {
      await expect(
        accountControl.connect(reserve1).setIndividualEventEmission(true)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Enhancement 8: Storage Layout Documentation", function () {
    it("should maintain upgrade compatibility", async function () {
      // This test verifies that the storage layout documentation
      // doesn't break existing functionality
      
      // Test core functionality still works
      await accountControl.connect(reserve1).mint(user1.address, 100000);
      expect(await accountControl.minted(reserve1.address)).to.equal(100000);
      
      // Test all state variables are accessible
      expect(await accountControl.backing(reserve1.address)).to.equal(1000000);
      expect(await accountControl.authorized(reserve1.address)).to.be.true;
      expect(await accountControl.mintingCaps(reserve1.address)).to.equal(1000000);
      expect(await accountControl.paused(reserve1.address)).to.be.false;
      expect(await accountControl.systemPaused()).to.be.false;
      expect(await accountControl.emergencyCouncil()).to.equal(emergencyCouncil.address);
      expect(await accountControl.bank()).to.equal(mockBankContract.address);
      expect(await accountControl.emitIndividualEvents()).to.be.false;
    });
  });

  describe("Integration Testing", function () {
    it("should work with all enhancements together", async function () {
      // Enable individual events
      await accountControl.connect(owner).setIndividualEventEmission(true);
      
      // Enable batch support
      await mockBankContract.setBatchSupported(true);

      const recipients = [user1.address, user2.address];
      const amounts = [100000, 200000];

      const tx = await accountControl.connect(reserve1).batchMint(recipients, amounts);
      const receipt = await tx.wait();

      // Verify state updates
      expect(await accountControl.minted(reserve1.address)).to.equal(300000);
      expect(await accountControl.totalMinted()).to.equal(300000);

      // Verify events
      const batchEvents = receipt.events?.filter(e => e.event === "BatchMintExecuted");
      const individualEvents = receipt.events?.filter(e => e.event === "MintExecuted");
      expect(batchEvents).to.have.length(1);
      expect(individualEvents).to.have.length(2);

      // Verify batch Bank call was used
      expect(await mockBankContract.batchCallCount()).to.equal(1);

      // Test cap reduction safety
      await expect(
        accountControl.connect(owner).setMintingCap(reserve1.address, 200000)
      ).to.be.revertedWith("ExceedsReserveCap");
    });
  });
});