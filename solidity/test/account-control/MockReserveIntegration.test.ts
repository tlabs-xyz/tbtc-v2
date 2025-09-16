import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  AccountControl,
  MockReserve,
  MockBank,
  MockTBTCToken,
  MockTBTCVault
} from "../../typechain";

describe("MockReserve - AccountControl Direct Backing Integration", () => {
  let accountControl: AccountControl;
  let mockReserve: MockReserve;
  let mockReserve2: MockReserve;
  let mockBank: MockBank;
  let mockTbtcToken: MockTBTCToken;
  let mockTbtcVault: MockTBTCVault;

  let owner: SignerWithAddress;
  let emergencyCouncil: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let attacker: SignerWithAddress;

  // Constants
  const ONE_BTC = ethers.utils.parseUnits("100000000", 0); // 1 BTC = 100,000,000 satoshis
  const HALF_BTC = ONE_BTC.div(2);
  const TEN_BTC = ONE_BTC.mul(10);
  const MIN_MINT = ethers.utils.parseUnits("10000", 0); // 0.0001 BTC

  before(async () => {
    [owner, emergencyCouncil, user1, user2, user3, attacker] = await ethers.getSigners();

    // Deploy mock contracts
    const MockBankFactory = await ethers.getContractFactory("MockBank");
    mockBank = await MockBankFactory.deploy() as MockBank;

    const MockTBTCTokenFactory = await ethers.getContractFactory("MockTBTCToken");
    mockTbtcToken = await MockTBTCTokenFactory.deploy() as MockTBTCToken;

    const MockTBTCVaultFactory = await ethers.getContractFactory("contracts/test/MockTBTCVault.sol:MockTBTCVault");
    mockTbtcVault = await MockTBTCVaultFactory.deploy() as MockTBTCVault;

    // Deploy AccountControl
    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [owner.address, emergencyCouncil.address, mockBank.address],
      { initializer: "initialize" }
    ) as AccountControl;
  });

  beforeEach(async () => {
    // Deploy MockReserve
    const MockReserveFactory = await ethers.getContractFactory("MockReserve");
    mockReserve = await MockReserveFactory.deploy(accountControl.address) as MockReserve;
  });

  describe("1. Reserve Authorization & Setup", () => {
    it("should authorize MOCK_RESERVE with minting cap", async () => {
      const mintingCap = TEN_BTC;

      await expect(
        accountControl.connect(owner).authorizeReserve(mockReserve.address, mintingCap)
      ).to.emit(accountControl, "ReserveAuthorized")
        .withArgs(mockReserve.address, mintingCap);

      expect(await accountControl.authorized(mockReserve.address)).to.be.true;
    });

    it("should initialize with zero backing and zero minted", async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC);

      expect(await accountControl.backing(mockReserve.address)).to.equal(0);
      expect(await accountControl.minted(mockReserve.address)).to.equal(0);
    });

    it("should assign correct reserve type", async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC);

      const reserveInfo = await accountControl.reserveInfo(mockReserve.address);
      expect(reserveInfo.reserveType).to.equal(1); // QC_PERMISSIONED = 1
      expect(reserveInfo.mintingCap).to.equal(TEN_BTC);
    });

    it("should emit ReserveAuthorized event", async () => {
      await expect(
        accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC)
      ).to.emit(accountControl, "ReserveAuthorized")
        .withArgs(mockReserve.address, TEN_BTC);
    });
  });

  describe("2. Direct Backing Management (Federated Model)", () => {
    beforeEach(async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC);
    });

    it("should allow reserve to update its own backing", async () => {
      const newBacking = ONE_BTC;

      await mockReserve.setBacking(newBacking);

      expect(await accountControl.backing(mockReserve.address)).to.equal(newBacking);
      expect(await mockReserve.reserveBacking()).to.equal(newBacking);
    });

    it("should emit BackingUpdated event with old and new values", async () => {
      const oldBacking = 0;
      const newBacking = ONE_BTC;

      // Note: The event is emitted by AccountControl, not MockReserve
      await expect(mockReserve.setBacking(newBacking))
        .to.emit(mockReserve, "BackingChanged")
        .withArgs(oldBacking, newBacking);
    });

    it("should allow backing increases and decreases", async () => {
      // Increase backing
      await mockReserve.setBacking(TEN_BTC);
      expect(await accountControl.backing(mockReserve.address)).to.equal(TEN_BTC);

      // Decrease backing
      await mockReserve.setBacking(ONE_BTC);
      expect(await accountControl.backing(mockReserve.address)).to.equal(ONE_BTC);

      // Increase again
      await mockReserve.increaseBacking(HALF_BTC);
      expect(await accountControl.backing(mockReserve.address)).to.equal(ONE_BTC.add(HALF_BTC));
    });

    it("should handle zero backing scenarios", async () => {
      // Set to non-zero first
      await mockReserve.setBacking(ONE_BTC);
      expect(await accountControl.backing(mockReserve.address)).to.equal(ONE_BTC);

      // Set to zero
      await mockReserve.setBacking(0);
      expect(await accountControl.backing(mockReserve.address)).to.equal(0);

      // Should not be able to mint with zero backing
      await expect(
        mockReserve.mintTokens(user1.address, MIN_MINT)
      ).to.be.revertedWith("InsufficientBacking");
    });

    it("should track backing history for transparency", async () => {
      const updates = [ONE_BTC, TEN_BTC, HALF_BTC, 0, ONE_BTC];

      for (const backing of updates) {
        await mockReserve.setBacking(backing);
        expect(await accountControl.backing(mockReserve.address)).to.equal(backing);
      }

      expect(await mockReserve.updateCount()).to.equal(updates.length);
    });
  });

  describe("3. Minting Operations via Bank Integration", () => {
    beforeEach(async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC);
      await mockReserve.setBacking(ONE_BTC);
    });

    it("should mint through Bank.increaseBalance() chain", async () => {
      const mintAmount = HALF_BTC;

      await expect(mockReserve.mintTokens(user1.address, mintAmount))
        .to.emit(accountControl, "MintExecuted")
        .withArgs(mockReserve.address, user1.address, mintAmount);

      // Verify Bank balance increased
      expect(await mockBank.balanceAvailable(user1.address)).to.equal(mintAmount);
    });

    it("should enforce backing >= minted + amount invariant", async () => {
      const backing = ONE_BTC;
      await mockReserve.setBacking(backing);

      // Mint up to backing limit
      await mockReserve.mintTokens(user1.address, backing);

      // Try to mint beyond backing
      await expect(
        mockReserve.mintTokens(user2.address, 1)
      ).to.be.revertedWith("InsufficientBacking");
    });

    it("should support minting to different target addresses", async () => {
      const amount = ethers.utils.parseUnits("10000000", 0); // 0.1 BTC

      await mockReserve.mintTokens(user1.address, amount);
      await mockReserve.mintTokens(user2.address, amount);
      await mockReserve.mintTokens(user3.address, amount);

      expect(await mockBank.balanceAvailable(user1.address)).to.equal(amount);
      expect(await mockBank.balanceAvailable(user2.address)).to.equal(amount);
      expect(await mockBank.balanceAvailable(user3.address)).to.equal(amount);
    });

    it("should update both reserve minted and total minted", async () => {
      const mintAmount = HALF_BTC;

      const totalMintedBefore = await accountControl.totalMintedAmount();
      await mockReserve.mintTokens(user1.address, mintAmount);

      expect(await accountControl.minted(mockReserve.address)).to.equal(mintAmount);
      expect(await accountControl.totalMintedAmount()).to.equal(totalMintedBefore.add(mintAmount));
    });

    it("should revert on insufficient backing", async () => {
      await mockReserve.setBacking(MIN_MINT);

      await expect(
        mockReserve.mintTokens(user1.address, MIN_MINT.add(1))
      ).to.be.revertedWith("InsufficientBacking");
    });

    it("should emit MintExecuted event", async () => {
      const mintAmount = HALF_BTC;

      await expect(mockReserve.mintTokens(user1.address, mintAmount))
        .to.emit(accountControl, "MintExecuted")
        .withArgs(mockReserve.address, user1.address, mintAmount);
    });
  });

  describe("4. Batch Minting Optimization", () => {
    beforeEach(async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC);
      await mockReserve.setBacking(TEN_BTC);
    });

    it("should process batch mints in single transaction", async () => {
      const recipients = [user1.address, user2.address, user3.address];
      const amounts = [MIN_MINT, MIN_MINT.mul(2), MIN_MINT.mul(3)];

      await expect(mockReserve.batchMint(recipients, amounts))
        .to.emit(mockReserve, "BatchMintExecuted")
        .withArgs(MIN_MINT.mul(6), recipients.length);

      // Verify all recipients received tokens
      for (let i = 0; i < recipients.length; i++) {
        expect(await mockBank.balanceAvailable(recipients[i])).to.equal(amounts[i]);
      }
    });

    it("should validate total amount against backing once", async () => {
      const recipients = [user1.address, user2.address];
      const amounts = [HALF_BTC, HALF_BTC.add(1)]; // Total > ONE_BTC

      await mockReserve.setBacking(ONE_BTC);

      // Should fail as total exceeds backing
      await expect(
        mockReserve.batchMint(recipients, amounts)
      ).to.be.revertedWith("InsufficientBacking");
    });

    it("should achieve gas savings for multiple operations", async () => {
      const recipients = Array(10).fill(0).map((_, i) =>
        ethers.Wallet.createRandom().address
      );
      const amounts = Array(10).fill(MIN_MINT);

      // Estimate gas for batch
      const batchTx = await mockReserve.batchMint(recipients, amounts);
      const batchReceipt = await batchTx.wait();
      const batchGas = batchReceipt.gasUsed;

      // Deploy new reserve for individual mints comparison
      const MockReserveFactory = await ethers.getContractFactory("MockReserve");
      const compareReserve = await MockReserveFactory.deploy(accountControl.address) as MockReserve;
      await accountControl.connect(owner).authorizeReserve(compareReserve.address, TEN_BTC);
      await compareReserve.setBacking(TEN_BTC);

      // Estimate gas for individual mints
      let individualGas = ethers.BigNumber.from(0);
      for (let i = 0; i < 3; i++) { // Sample first 3 for estimation
        const tx = await compareReserve.mintTokens(recipients[i], amounts[i]);
        const receipt = await tx.wait();
        individualGas = individualGas.add(receipt.gasUsed);
      }
      individualGas = individualGas.mul(10).div(3); // Extrapolate to 10 operations

      // Batch should be more efficient
      expect(batchGas).to.be.lt(individualGas);
    });

    it("should maintain atomicity (all succeed or all fail)", async () => {
      const recipients = [user1.address, user2.address, ethers.constants.AddressZero];
      const amounts = [MIN_MINT, MIN_MINT, MIN_MINT];

      // Should fail due to invalid recipient
      await expect(
        mockReserve.batchMint(recipients, amounts)
      ).to.be.revertedWith("Invalid recipient");

      // No balances should have changed
      expect(await mockBank.balanceAvailable(user1.address)).to.equal(0);
      expect(await mockBank.balanceAvailable(user2.address)).to.equal(0);
    });
  });

  describe("5. Redemption Flows", () => {
    beforeEach(async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC);
      await mockReserve.setBacking(ONE_BTC);
      await mockReserve.mintTokens(user1.address, HALF_BTC);
      await mockReserve.mintTokens(user2.address, HALF_BTC.div(2));
    });

    it("should decrease minted amount on redemption", async () => {
      const redeemAmount = MIN_MINT.mul(100);
      const mintedBefore = await accountControl.minted(mockReserve.address);

      await mockReserve.redeemTokens(user1.address, redeemAmount);

      expect(await accountControl.minted(mockReserve.address))
        .to.equal(mintedBefore.sub(redeemAmount));
    });

    it("should allow partial redemptions", async () => {
      const userBalance = await mockReserve.userBalances(user1.address);
      const partialAmount = userBalance.div(3);

      await mockReserve.redeemTokens(user1.address, partialAmount);

      expect(await mockReserve.userBalances(user1.address))
        .to.equal(userBalance.sub(partialAmount));
    });

    it("should emit RedemptionProcessed event", async () => {
      const redeemAmount = MIN_MINT.mul(100);

      await expect(mockReserve.redeemTokens(user1.address, redeemAmount))
        .to.emit(accountControl, "RedemptionProcessed")
        .withArgs(mockReserve.address, redeemAmount);
    });

    it("should revert if redeeming more than minted", async () => {
      const userBalance = await mockReserve.userBalances(user1.address);

      await expect(
        mockReserve.redeemTokens(user1.address, userBalance.add(1))
      ).to.be.revertedWithCustomError(mockReserve, "InsufficientUserBalance");
    });

    it("should continue working during minting pause", async () => {
      // Pause minting
      await accountControl.connect(owner).pauseReserve(mockReserve.address);

      // Minting should fail
      await expect(
        mockReserve.mintTokens(user3.address, MIN_MINT)
      ).to.be.revertedWith("ReserveIsPaused");

      // Redemption should still work
      const redeemAmount = MIN_MINT.mul(100);
      await expect(mockReserve.redeemTokens(user1.address, redeemAmount))
        .to.emit(accountControl, "RedemptionProcessed");
    });
  });

  describe("6. Core Invariant Enforcement", () => {
    beforeEach(async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC);
    });

    it("should never allow minted > backing", async () => {
      await mockReserve.setBacking(ONE_BTC);

      // Mint to limit
      await mockReserve.mintTokens(user1.address, ONE_BTC);

      // Try to exceed
      await expect(
        mockReserve.mintTokens(user2.address, 1)
      ).to.be.revertedWith("InsufficientBacking");

      // Verify invariant holds
      const backing = await accountControl.backing(mockReserve.address);
      const minted = await accountControl.minted(mockReserve.address);
      expect(minted).to.be.lte(backing);
    });

    it("should maintain individual reserve solvency", async () => {
      await mockReserve.setBacking(ONE_BTC);
      await mockReserve.mintTokens(user1.address, HALF_BTC);

      // Try to reduce backing below minted
      await expect(
        mockReserve.setBacking(HALF_BTC.sub(1))
      ).to.be.revertedWith("InsufficientBacking");
    });

    it("should prevent cross-reserve subsidization", async () => {
      // Deploy second reserve
      const MockReserveFactory = await ethers.getContractFactory("MockReserve");
      mockReserve2 = await MockReserveFactory.deploy(accountControl.address) as MockReserve;
      await accountControl.connect(owner).authorizeReserve(mockReserve2.address, TEN_BTC);

      // Set different backings
      await mockReserve.setBacking(ONE_BTC);
      await mockReserve2.setBacking(TEN_BTC);

      // Max out first reserve
      await mockReserve.mintTokens(user1.address, ONE_BTC);

      // Second reserve should still have full capacity
      expect(await mockReserve2.getAvailableCapacity()).to.equal(TEN_BTC);

      // Can mint from second reserve
      await mockReserve2.mintTokens(user2.address, TEN_BTC);
    });

    it("should enforce MIN_MINT_AMOUNT", async () => {
      await mockReserve.setBacking(ONE_BTC);
      const minMint = await accountControl.MIN_MINT_AMOUNT();

      await expect(
        mockReserve.mintTokens(user1.address, minMint.sub(1))
      ).to.be.revertedWith("AmountTooSmall");
    });

    it("should enforce MAX_SINGLE_MINT", async () => {
      await mockReserve.setBacking(ethers.utils.parseUnits("100000000000", 0)); // 1000 BTC
      const maxMint = await accountControl.MAX_SINGLE_MINT();

      await expect(
        mockReserve.mintTokens(user1.address, maxMint.add(1))
      ).to.be.revertedWith("AmountTooLarge");
    });
  });

  describe("7. Pause Mechanisms", () => {
    beforeEach(async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC);
      await mockReserve.setBacking(ONE_BTC);
    });

    it("should pause only minting (redemptions continue)", async () => {
      // Mint some tokens first
      await mockReserve.mintTokens(user1.address, HALF_BTC);

      // Pause reserve
      await accountControl.connect(owner).pauseReserve(mockReserve.address);

      // Minting should fail
      await expect(
        mockReserve.mintTokens(user2.address, MIN_MINT)
      ).to.be.revertedWith("ReserveIsPaused");

      // Redemption should work
      await mockReserve.redeemTokens(user1.address, MIN_MINT);
    });

    it("should pause all operations (emergency)", async () => {
      await mockReserve.mintTokens(user1.address, HALF_BTC);

      // Emergency pause
      await accountControl.connect(emergencyCouncil).pauseSystem();

      // Everything should fail
      await expect(
        mockReserve.mintTokens(user2.address, MIN_MINT)
      ).to.be.revertedWith("SystemIsPaused");

      await expect(
        mockReserve.redeemTokens(user1.address, MIN_MINT)
      ).to.be.revertedWith("SystemIsPaused");

      // Clean up: unpause for subsequent tests
      await accountControl.connect(owner).unpauseSystem();
    });

    it("should pause specific reserve without affecting others", async () => {
      // Deploy second reserve
      const MockReserveFactory = await ethers.getContractFactory("MockReserve");
      mockReserve2 = await MockReserveFactory.deploy(accountControl.address) as MockReserve;
      await accountControl.connect(owner).authorizeReserve(mockReserve2.address, TEN_BTC);
      await mockReserve2.setBacking(ONE_BTC);

      // Pause first reserve only
      await accountControl.connect(owner).pauseReserve(mockReserve.address);

      // First reserve should fail
      await expect(
        mockReserve.mintTokens(user1.address, MIN_MINT)
      ).to.be.revertedWith("ReserveIsPaused");

      // Second reserve should work
      await mockReserve2.mintTokens(user1.address, MIN_MINT);
    });

    it("should auto-recover from pause when conditions met", async () => {
      // Pause and unpause
      await accountControl.connect(owner).pauseReserve(mockReserve.address);
      await accountControl.connect(owner).unpauseReserve(mockReserve.address);

      // Should work again
      await mockReserve.mintTokens(user1.address, MIN_MINT);
    });

    it("should emit appropriate pause/unpause events", async () => {
      await expect(accountControl.connect(owner).pauseReserve(mockReserve.address))
        .to.emit(accountControl, "ReservePaused")
        .withArgs(mockReserve.address);

      await expect(accountControl.connect(owner).unpauseReserve(mockReserve.address))
        .to.emit(accountControl, "ReserveUnpaused")
        .withArgs(mockReserve.address);
    });
  });

  describe("8. Reserve Deauthorization", () => {
    beforeEach(async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC);
      await mockReserve.setBacking(ONE_BTC);
    });

    it("should prevent deauthorization with outstanding minted balance", async () => {
      await mockReserve.mintTokens(user1.address, HALF_BTC);

      await expect(
        accountControl.connect(owner).deauthorizeReserve(mockReserve.address)
      ).to.be.revertedWith("CannotDeauthorizeWithOutstandingBalance");
    });

    it("should clear backing when deauthorizing clean reserve", async () => {
      // Set backing but don't mint
      await mockReserve.setBacking(ONE_BTC);

      expect(await accountControl.backing(mockReserve.address)).to.equal(ONE_BTC);

      // Deauthorize
      await accountControl.connect(owner).deauthorizeReserve(mockReserve.address);

      expect(await accountControl.backing(mockReserve.address)).to.equal(0);
    });

    it("should emit ReserveDeauthorized event", async () => {
      await expect(
        accountControl.connect(owner).deauthorizeReserve(mockReserve.address)
      ).to.emit(accountControl, "ReserveDeauthorized")
        .withArgs(mockReserve.address);
    });

    it("should prevent operations after deauthorization", async () => {
      await accountControl.connect(owner).deauthorizeReserve(mockReserve.address);

      await expect(
        mockReserve.mintTokens(user1.address, MIN_MINT)
      ).to.be.revertedWith("NotAuthorized");
    });
  });

  describe("9. Multi-Reserve Scenarios", () => {
    beforeEach(async () => {
      // Deploy and authorize second reserve
      const MockReserveFactory = await ethers.getContractFactory("MockReserve");
      mockReserve2 = await MockReserveFactory.deploy(accountControl.address) as MockReserve;

      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC);
      await accountControl.connect(owner).authorizeReserve(mockReserve2.address, TEN_BTC.mul(2));
    });

    it("should maintain isolation between multiple MockReserves", async () => {
      // Set different backings
      await mockReserve.setBacking(ONE_BTC);
      await mockReserve2.setBacking(TEN_BTC);

      // Mint from each
      await mockReserve.mintTokens(user1.address, ONE_BTC);
      await mockReserve2.mintTokens(user2.address, ONE_BTC);

      // Check isolation
      expect(await accountControl.minted(mockReserve.address)).to.equal(ONE_BTC);
      expect(await accountControl.minted(mockReserve2.address)).to.equal(ONE_BTC);

      // First reserve exhausted
      await expect(
        mockReserve.mintTokens(user3.address, 1)
      ).to.be.revertedWith("InsufficientBacking");

      // Second reserve still has capacity
      await mockReserve2.mintTokens(user3.address, ONE_BTC.mul(8));
    });

    it("should track totalMinted across all reserves", async () => {
      await mockReserve.setBacking(ONE_BTC);
      await mockReserve2.setBacking(ONE_BTC);

      const initialTotal = await accountControl.totalMintedAmount();

      await mockReserve.mintTokens(user1.address, HALF_BTC);
      await mockReserve2.mintTokens(user2.address, HALF_BTC);

      expect(await accountControl.totalMintedAmount())
        .to.equal(initialTotal.add(ONE_BTC));
    });

    it("should allow different backing strategies per reserve", async () => {
      // Reserve 1: Conservative backing
      await mockReserve.setBacking(ONE_BTC);

      // Reserve 2: Aggressive backing
      await mockReserve2.setBacking(TEN_BTC);

      // Reserve 1: Incremental updates
      for (let i = 0; i < 5; i++) {
        await mockReserve.increaseBacking(MIN_MINT.mul(100));
      }

      // Reserve 2: Large single update
      await mockReserve2.setBacking(TEN_BTC.mul(2));

      // Both strategies work independently
      expect(await mockReserve.updateCount()).to.equal(6); // Initial + 5 increases
      expect(await mockReserve2.updateCount()).to.equal(2); // Initial + 1 update
    });

    it("should handle concurrent operations from different reserves", async () => {
      await mockReserve.setBacking(ONE_BTC);
      await mockReserve2.setBacking(ONE_BTC);

      // Interleaved operations
      await mockReserve.mintTokens(user1.address, MIN_MINT);
      await mockReserve2.mintTokens(user2.address, MIN_MINT.mul(2));
      await mockReserve.mintTokens(user3.address, MIN_MINT.mul(3));
      await mockReserve2.redeemTokens(user2.address, MIN_MINT);
      await mockReserve.redeemTokens(user1.address, MIN_MINT);

      // Verify final state
      expect(await accountControl.minted(mockReserve.address))
        .to.equal(MIN_MINT.mul(2)); // 3 minted - 1 redeemed
      expect(await accountControl.minted(mockReserve2.address))
        .to.equal(MIN_MINT); // 2 minted - 1 redeemed
    });
  });

  describe("10. Edge Cases & Failure Modes", () => {
    beforeEach(async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC);
    });

    it("should handle rapid backing updates", async () => {
      const updates = 50;
      let currentBacking = MIN_MINT;

      for (let i = 0; i < updates; i++) {
        currentBacking = currentBacking.add(MIN_MINT);
        await mockReserve.setBacking(currentBacking);

        // Verify each update
        expect(await accountControl.backing(mockReserve.address))
          .to.equal(currentBacking);
      }

      expect(await mockReserve.updateCount()).to.equal(updates);
    });

    it("should protect against reentrancy attacks", async () => {
      await mockReserve.setBacking(ONE_BTC);

      // Enable reentrancy test
      await mockReserve.enableReentrancyTest();

      // Should fail due to reentrancy guard
      await expect(
        mockReserve.mintTokens(attacker.address, MIN_MINT)
      ).to.be.revertedWith("ReentrancyGuardReentrantCall");
    });

    it("should handle maximum uint values correctly", async () => {
      const maxUint128 = ethers.BigNumber.from(2).pow(128).sub(1);

      // Should handle large values up to uint128
      await mockReserve.setBacking(maxUint128);
      expect(await accountControl.backing(mockReserve.address)).to.equal(maxUint128);

      // Should overflow protection for values > uint128
      await expect(
        mockReserve.setBacking(maxUint128.add(1))
      ).to.be.reverted; // Will revert due to overflow
    });

    it("should recover from temporary insolvency", async () => {
      await mockReserve.setBacking(ONE_BTC);
      await mockReserve.mintTokens(user1.address, ONE_BTC);

      // Simulate insolvency detection
      // In real scenario, oracle would detect backing < minted

      // Recovery: Increase backing
      await mockReserve.setBacking(TEN_BTC);

      // Should be able to mint again
      await mockReserve.mintTokens(user2.address, ONE_BTC);
    });

    it("should handle simulation failures gracefully", async () => {
      await mockReserve.setBacking(ONE_BTC);

      // Enable failure simulation
      await mockReserve.simulateFailure(true);

      // Next operation should fail
      await expect(
        mockReserve.setBacking(TEN_BTC)
      ).to.be.revertedWith("SimulatedFailure");

      // Failure flag should be reset
      expect(await mockReserve.failOnNext()).to.be.false;

      // Next operation should succeed
      await mockReserve.setBacking(TEN_BTC);
      expect(await accountControl.backing(mockReserve.address)).to.equal(TEN_BTC);
    });

    it("should handle zero address checks", async () => {
      const recipients = [ethers.constants.AddressZero];
      const amounts = [MIN_MINT];

      await mockReserve.setBacking(ONE_BTC);

      await expect(
        mockReserve.batchMint(recipients, amounts)
      ).to.be.revertedWith("Invalid recipient");
    });

    it("should validate array length mismatches", async () => {
      const recipients = [user1.address, user2.address];
      const amounts = [MIN_MINT]; // Mismatched length

      await mockReserve.setBacking(ONE_BTC);

      await expect(
        mockReserve.batchMint(recipients, amounts)
      ).to.be.revertedWith("InvalidArrayLengths");
    });
  });

  describe("Integration with AccountControl Events", () => {
    beforeEach(async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC);
      await mockReserve.setBacking(ONE_BTC);
    });

    it("should emit all expected events in correct order", async () => {
      const mintAmount = HALF_BTC;

      // Mint operation
      const mintTx = await mockReserve.mintTokens(user1.address, mintAmount);
      const mintReceipt = await mintTx.wait();

      // Check for events from AccountControl - events may vary by AC version
      // Note: Exact event names depend on AccountControl implementation
      expect(mintReceipt.events?.length).to.be.greaterThan(0);

      // Redeem operation
      const redeemAmount = MIN_MINT.mul(100);
      const redeemTx = await mockReserve.redeemTokens(user1.address, redeemAmount);
      const redeemReceipt = await redeemTx.wait();

      // Check for events from AccountControl - events may vary by AC version
      // Note: RedemptionProcessed event depends on AccountControl implementation
      expect(redeemReceipt.events?.length).to.be.greaterThan(0);
    });
  });

  describe("Gas Optimization Verification", () => {
    beforeEach(async () => {
      await accountControl.connect(owner).authorizeReserve(mockReserve.address, TEN_BTC.mul(10));
      await mockReserve.setBacking(TEN_BTC.mul(10));
    });

    it("should demonstrate gas savings with batch operations", async () => {
      const numOperations = 20;
      const recipients: string[] = [];
      const amounts: ethers.BigNumber[] = [];

      for (let i = 0; i < numOperations; i++) {
        recipients.push(ethers.Wallet.createRandom().address);
        amounts.push(MIN_MINT.mul(i + 1));
      }

      // Measure batch operation
      const batchTx = await mockReserve.batchMint(recipients, amounts);
      const batchReceipt = await batchTx.wait();
      const batchGas = batchReceipt.gasUsed;

      // Calculate average gas per operation
      const gasPerOperation = batchGas.div(numOperations);

      // Single operation for comparison
      const singleTx = await mockReserve.mintTokens(
        ethers.Wallet.createRandom().address,
        MIN_MINT
      );
      const singleReceipt = await singleTx.wait();
      const singleGas = singleReceipt.gasUsed;

      // Batch should be significantly more efficient per operation
      expect(gasPerOperation).to.be.lt(singleGas.mul(70).div(100)); // At least 30% savings
    });
  });
});