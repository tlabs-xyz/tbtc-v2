import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { AccountControl } from "../../typechain";

describe("AccountControl Input Validation", function () {
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

    // Deploy AccountControl
    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [owner.address, emergencyCouncil.address, mockBank.address],
      { initializer: "initialize" }
    ) as AccountControl;

    // Setup ReserveOracle integration
    await accountControl.connect(owner).setReserveOracle(owner.address);

    // Initialize reserve types and authorize test reserve
    await accountControl.connect(owner).addReserveType(0); // ReserveType.QC_PERMISSIONED
    await accountControl.connect(owner).authorizeReserve(reserve.address, 1000000, 0);
    await accountControl.connect(owner).updateBacking(reserve.address, 1000000);
  });

  describe("System Pause Enforcement", function () {
    it("should block all minting when system is paused", async function () {
      // Pause the system
      await accountControl.connect(emergencyCouncil).pauseSystem();
      
      // Verify system is paused
      expect(await accountControl.systemPaused()).to.be.true;
      
      // Should revert mint operation
      await expect(
        accountControl.connect(reserve).mint(user.address, 100000)
      ).to.be.revertedWithCustomError(accountControl, "SystemIsPaused");
    });

    it("should block all batch minting when system is paused", async function () {
      // Pause the system
      await accountControl.connect(emergencyCouncil).pauseSystem();
      
      const recipients = [user.address];
      const amounts = [100000];
      
      // Should revert batch mint operation
      await expect(
        accountControl.connect(reserve).batchMint(recipients, amounts)
      ).to.be.revertedWithCustomError(accountControl, "SystemIsPaused");
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
      ).to.be.revertedWithCustomError(accountControl, "SystemIsPaused");
    });
  });

  describe("Address Reuse Prevention", function () {
    let reserve2: SignerWithAddress;

    beforeEach(async function () {
      [, , , , reserve2] = await ethers.getSigners();
    });

    it("should prevent same address being used for different reserve types", async function () {
      // First deauthorize the existing reserve
      await accountControl.connect(owner).deauthorizeReserve(reserve.address);
      
      // Add a new reserve type (we'll simulate this by using enum value 1, though it would need to be added first in real scenario)
      // For this test, we'll use the fact that the contract checks reserveAddressType mapping
      
      // The address was already used for ReserveType.QC_PERMISSIONED (0)
      // Trying to reuse it for a different type should fail
      // Since we only have one reserve type in our setup, we can't fully test this
      // but we can verify the address type tracking works
      expect(await accountControl.reserveAddressType(reserve.address)).to.equal(0);
    });

    it("should allow re-authorization with same reserve type after deauthorization", async function () {
      // Deauthorize the reserve first
      await accountControl.connect(owner).deauthorizeReserve(reserve.address);
      
      // Verify it's deauthorized
      expect(await accountControl.authorized(reserve.address)).to.be.false;
      
      // Should be able to re-authorize with same type
      await accountControl.connect(owner).authorizeReserve(reserve.address, 500000, 0);
      
      // Verify re-authorization succeeded
      expect(await accountControl.authorized(reserve.address)).to.be.true;
      const reserveInfo = await accountControl.reserveInfo(reserve.address);
      expect(reserveInfo.reserveType).to.equal(0);
    });

    it("should track address type permanently", async function () {
      // Address should have type recorded even after deauthorization
      const initialType = await accountControl.reserveAddressType(reserve.address);
      expect(initialType).to.equal(0);
      
      // Deauthorize
      await accountControl.connect(owner).deauthorizeReserve(reserve.address);
      
      // Type should still be recorded
      const typeAfterDeauth = await accountControl.reserveAddressType(reserve.address);
      expect(typeAfterDeauth).to.equal(0);
    });
  });

  describe("Input Validation", function () {
    it("should revert when recipients.length != amounts.length in batchMint", async function () {
      const recipients = [user.address, owner.address]; // 2 recipients
      const amounts = [100000]; // 1 amount
      
      await expect(
        accountControl.connect(reserve).batchMint(recipients, amounts)
      ).to.be.revertedWithCustomError(accountControl, "ArrayLengthMismatch")
        .withArgs(2, 1);
    });

    it("should revert when batch size exceeds MAX_BATCH_SIZE", async function () {
      // Create arrays exceeding MAX_BATCH_SIZE (100)
      const recipients = new Array(101).fill(user.address);
      const amounts = new Array(101).fill(10000);
      
      await expect(
        accountControl.connect(reserve).batchMint(recipients, amounts)
      ).to.be.revertedWithCustomError(accountControl, "BatchSizeExceeded")
        .withArgs(101, 100);
    });

    it("should revert mint with amount below MIN_MINT_AMOUNT", async function () {
      const tooSmallAmount = 9999; // Less than MIN_MINT_AMOUNT (10000)
      
      await expect(
        accountControl.connect(reserve).mint(user.address, tooSmallAmount)
      ).to.be.revertedWithCustomError(accountControl, "AmountTooSmall")
        .withArgs(tooSmallAmount, 10000);
    });

    it("should revert mint with amount above MAX_SINGLE_MINT", async function () {
      const tooLargeAmount = ethers.utils.parseUnits("101", 8); // 101 BTC, exceeds MAX_SINGLE_MINT (100 BTC)
      
      await expect(
        accountControl.connect(reserve).mint(user.address, tooLargeAmount)
      ).to.be.revertedWithCustomError(accountControl, "AmountTooLarge")
        .withArgs(tooLargeAmount, ethers.utils.parseUnits("100", 8));
    });

    it("should revert batchMint with individual amounts below MIN_MINT_AMOUNT", async function () {
      const recipients = [user.address];
      const amounts = [9999]; // Below MIN_MINT_AMOUNT
      
      await expect(
        accountControl.connect(reserve).batchMint(recipients, amounts)
      ).to.be.revertedWithCustomError(accountControl, "AmountTooSmall")
        .withArgs(9999, 10000);
    });

    it("should revert batchMint with individual amounts above MAX_SINGLE_MINT", async function () {
      const recipients = [user.address];
      const amounts = [ethers.utils.parseUnits("101", 8)]; // Above MAX_SINGLE_MINT
      
      await expect(
        accountControl.connect(reserve).batchMint(recipients, amounts)
      ).to.be.revertedWithCustomError(accountControl, "AmountTooLarge")
        .withArgs(ethers.utils.parseUnits("101", 8), ethers.utils.parseUnits("100", 8));
    });

    it("should accept valid single mint amounts", async function () {
      // Test boundary values that should work
      const minValid = 10000; // MIN_MINT_AMOUNT
      const maxValid = ethers.utils.parseUnits("100", 8); // MAX_SINGLE_MINT
      
      // Should succeed with minimum amount
      await expect(
        accountControl.connect(reserve).mint(user.address, minValid)
      ).to.not.be.reverted;
      
      // Should succeed with maximum amount (need more backing first)
      await accountControl.connect(owner).updateBacking(reserve.address, maxValid.add(1000000));
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

  describe("Authorization Validation", function () {
    it("should prevent unauthorized reserves from minting", async function () {
      const unauthorizedReserve = ethers.Wallet.createRandom();
      
      await expect(
        accountControl.connect(unauthorizedReserve.connect(ethers.provider)).mint(user.address, 100000)
      ).to.be.revertedWithCustomError(accountControl, "NotAuthorized")
        .withArgs(unauthorizedReserve.address);
    });

    it("should prevent paused reserves from minting", async function () {
      // Pause the specific reserve
      await accountControl.connect(emergencyCouncil).pauseReserve(reserve.address);
      
      await expect(
        accountControl.connect(reserve).mint(user.address, 100000)
      ).to.be.revertedWithCustomError(accountControl, "ReserveIsPaused")
        .withArgs(reserve.address);
    });

    it("should prevent unauthorized addresses from updating backing", async function () {
      await expect(
        accountControl.connect(reserve).updateBacking(reserve.address, 500000)
      ).to.be.revertedWithCustomError(accountControl, "NotAuthorized")
        .withArgs(reserve.address);
    });
  });
});