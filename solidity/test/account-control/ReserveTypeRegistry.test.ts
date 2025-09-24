import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { AccountControl } from "../../typechain";

describe("AccountControl Reserve Type Registry", function () {
  let accountControl: AccountControl;
  let owner: SignerWithAddress;
  let emergencyCouncil: SignerWithAddress;
  let governance: SignerWithAddress;
  let mockBank: any;
  let basicReserve: SignerWithAddress;
  let vaultReserve: SignerWithAddress;
  let user: SignerWithAddress;

  // Test amounts
  const SMALL_CAP = ethers.utils.parseUnits("5000000", 0); // 5M satoshis = 0.05 BTC
  const MEDIUM_CAP = ethers.utils.parseUnits("10000000", 0); // 10M satoshis = 0.1 BTC
  const SMALL_MINT = ethers.utils.parseUnits("500000", 0); // 500K satoshis = 0.005 BTC
  const MIN_VAULT_CAP = ethers.utils.parseUnits("1000000000", 0); // 1B satoshis = 10 BTC

  // Reserve types enum values
  enum ReserveType {
    UNINITIALIZED = 0,
    QC_PERMISSIONED = 1,
    QC_BASIC = 2,
    QC_VAULT_STRATEGY = 3,
    QC_RESTAKING = 4,
    QC_BRIDGE = 5
  }

  beforeEach(async function () {
    [owner, emergencyCouncil, governance, basicReserve, vaultReserve, user] = await ethers.getSigners();

    // Deploy mock Bank with separated operations support
    const MockBankFactory = await ethers.getContractFactory("MockBankWithSeparatedOps");
    mockBank = await MockBankFactory.deploy();

    // Deploy AccountControl
    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [owner.address, emergencyCouncil.address, mockBank.address],
      { initializer: "initialize" }
    ) as AccountControl;

    // Set governance role for type info updates
    await accountControl.connect(owner).transferOwnership(governance.address);
  });

  describe("Type Info Initialization", function () {
    it("should initialize default type info correctly", async function () {
      // Check QC_BASIC type info
      const basicInfo = await accountControl.typeInfo(ReserveType.QC_BASIC);
      expect(basicInfo.name).to.equal("QC Basic Reserve");
      expect(basicInfo.requiresBtcAddress).to.be.true;
      expect(basicInfo.supportsLosses).to.be.false;
      expect(basicInfo.requiresWrapper).to.be.false;
      expect(basicInfo.maxBackingRatio).to.equal(0); // unlimited

      // Check QC_VAULT_STRATEGY type info
      const vaultInfo = await accountControl.typeInfo(ReserveType.QC_VAULT_STRATEGY);
      expect(vaultInfo.name).to.equal("QC Vault Strategy");
      expect(vaultInfo.requiresBtcAddress).to.be.false;
      expect(vaultInfo.supportsLosses).to.be.true;
      expect(vaultInfo.requiresWrapper).to.be.true;
      expect(vaultInfo.maxBackingRatio).to.equal(ethers.utils.parseUnits("120", 16)); // 120%
    });
  });

  describe("Reserve Type Assignment", function () {
    it("should default new reserves to QC_BASIC type", async function () {
      // Authorize reserve without specifying type
      await accountControl.connect(governance).authorizeReserve(basicReserve.address, SMALL_CAP);

      const reserveType = await accountControl.getReserveType(basicReserve.address);
      expect(reserveType).to.equal(ReserveType.QC_BASIC);
    });

    it("should assign specified type when authorizing with type parameter", async function () {
      // Authorize reserve with QC_VAULT_STRATEGY type
      await accountControl.connect(governance).authorizeReserveWithType(
        vaultReserve.address,
        MIN_VAULT_CAP,
        ReserveType.QC_VAULT_STRATEGY
      );

      const reserveType = await accountControl.getReserveType(vaultReserve.address);
      expect(reserveType).to.equal(ReserveType.QC_VAULT_STRATEGY);
    });

    it("should enforce minimum cap for vault strategies", async function () {
      await expect(
        accountControl.connect(governance).authorizeReserveWithType(
          vaultReserve.address,
          SMALL_CAP, // Too small for vault
          ReserveType.QC_VAULT_STRATEGY
        )
      ).to.be.revertedWith("Vault cap too low");
    });

    it("should emit ReserveTypeUpdated event", async function () {
      await expect(
        accountControl.connect(governance).authorizeReserveWithType(
          vaultReserve.address,
          MIN_VAULT_CAP,
          ReserveType.QC_VAULT_STRATEGY
        )
      )
        .to.emit(accountControl, "ReserveTypeUpdated")
        .withArgs(vaultReserve.address, ReserveType.UNINITIALIZED, ReserveType.QC_VAULT_STRATEGY);
    });
  });

  describe("Type Update Operations", function () {
    beforeEach(async function () {
      // Authorize reserves with different types
      await accountControl.connect(governance).authorizeReserve(basicReserve.address, SMALL_CAP);
      await accountControl.connect(governance).authorizeReserveWithType(
        vaultReserve.address,
        MIN_VAULT_CAP,
        ReserveType.QC_VAULT_STRATEGY
      );
    });

    it("should update reserve type", async function () {
      // Update basic reserve to vault strategy type
      await accountControl.connect(governance).updateReserveType(
        basicReserve.address,
        ReserveType.QC_VAULT_STRATEGY
      );

      const newType = await accountControl.getReserveType(basicReserve.address);
      expect(newType).to.equal(ReserveType.QC_VAULT_STRATEGY);
    });

    it("should emit event when updating reserve type", async function () {
      await expect(
        accountControl.connect(governance).updateReserveType(
          basicReserve.address,
          ReserveType.QC_VAULT_STRATEGY
        )
      )
        .to.emit(accountControl, "ReserveTypeUpdated")
        .withArgs(basicReserve.address, ReserveType.QC_BASIC, ReserveType.QC_VAULT_STRATEGY);
    });

    it("should only allow owner to update reserve type", async function () {
      await expect(
        accountControl.connect(user).updateReserveType(
          basicReserve.address,
          ReserveType.QC_VAULT_STRATEGY
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Type-Specific Operation Validation", function () {
    beforeEach(async function () {
      // Authorize reserves with appropriate types
      await accountControl.connect(governance).authorizeReserve(basicReserve.address, MEDIUM_CAP);
      await accountControl.connect(governance).authorizeReserveWithType(
        vaultReserve.address,
        MIN_VAULT_CAP,
        ReserveType.QC_VAULT_STRATEGY
      );

      // Give reserves some backing
      await accountControl.connect(basicReserve).updateBacking(MEDIUM_CAP);
      await accountControl.connect(vaultReserve).updateBacking(MIN_VAULT_CAP);

      // Give reserves tokens to burn
      await mockBank.setBalance(basicReserve.address, SMALL_MINT);
      await mockBank.setBalance(vaultReserve.address, SMALL_MINT);
    });

    it("should prevent QC_BASIC reserves from burning tokens", async function () {
      await expect(
        accountControl.connect(basicReserve).burnTokens(SMALL_MINT)
      ).to.be.revertedWith("Reserve type cannot handle losses");
    });

    it("should allow QC_VAULT_STRATEGY reserves to burn tokens", async function () {
      const initialBalance = await mockBank.balanceOf(vaultReserve.address);

      await accountControl.connect(vaultReserve).burnTokens(SMALL_MINT);

      const finalBalance = await mockBank.balanceOf(vaultReserve.address);
      expect(finalBalance).to.equal(initialBalance.sub(SMALL_MINT));
    });

    it("should prevent QC_BASIC reserves from using burnTBTC", async function () {
      const tbtcAmount = ethers.utils.parseEther("0.005"); // 0.005 tBTC

      await expect(
        accountControl.connect(basicReserve).burnTBTC(tbtcAmount)
      ).to.be.revertedWith("Reserve type cannot handle losses");
    });

    it("should allow QC_VAULT_STRATEGY reserves to use burnTBTC", async function () {
      // First credit minted to have something to debit
      await accountControl.connect(vaultReserve).creditMinted(SMALL_MINT);

      const tbtcAmount = ethers.utils.parseEther("0.005");
      const expectedSatoshis = tbtcAmount.div(ethers.utils.parseUnits("1", 10));

      const initialBalance = await mockBank.balanceOf(vaultReserve.address);
      const initialMinted = await accountControl.minted(vaultReserve.address);

      await accountControl.connect(vaultReserve).burnTBTC(tbtcAmount);

      const finalBalance = await mockBank.balanceOf(vaultReserve.address);
      const finalMinted = await accountControl.minted(vaultReserve.address);

      expect(finalBalance).to.equal(initialBalance.sub(expectedSatoshis));
      expect(finalMinted).to.equal(initialMinted.sub(expectedSatoshis));
    });

    it("should allow QC_BASIC reserves to mint tokens", async function () {
      await accountControl.connect(basicReserve).mintTokens(user.address, SMALL_MINT);

      expect(await mockBank.balanceOf(user.address)).to.equal(SMALL_MINT);
    });

    it("should allow QC_BASIC reserves to use creditMinted", async function () {
      const initialMinted = await accountControl.minted(basicReserve.address);

      await accountControl.connect(basicReserve).creditMinted(SMALL_MINT);

      expect(await accountControl.minted(basicReserve.address)).to.equal(initialMinted.add(SMALL_MINT));
    });
  });

  describe("Type Info Management", function () {
    it("should allow governance to update type info", async function () {
      const newTypeInfo = {
        name: "Updated Vault Strategy",
        requiresBtcAddress: true,
        supportsLosses: true,
        requiresWrapper: false,
        maxBackingRatio: ethers.utils.parseUnits("150", 16) // 150%
      };

      await accountControl.connect(governance).setReserveTypeInfo(
        ReserveType.QC_VAULT_STRATEGY,
        newTypeInfo
      );

      const updatedInfo = await accountControl.typeInfo(ReserveType.QC_VAULT_STRATEGY);
      expect(updatedInfo.name).to.equal("Updated Vault Strategy");
      expect(updatedInfo.requiresBtcAddress).to.be.true;
      expect(updatedInfo.maxBackingRatio).to.equal(ethers.utils.parseUnits("150", 16));
    });

    it("should emit ReserveTypeInfoUpdated event", async function () {
      const newTypeInfo = {
        name: "Updated Basic Reserve",
        requiresBtcAddress: false,
        supportsLosses: false,
        requiresWrapper: false,
        maxBackingRatio: 0
      };

      await expect(
        accountControl.connect(governance).setReserveTypeInfo(
          ReserveType.QC_BASIC,
          newTypeInfo
        )
      )
        .to.emit(accountControl, "ReserveTypeInfoUpdated")
        .withArgs(ReserveType.QC_BASIC, "Updated Basic Reserve");
    });

    it("should only allow governance to set type info", async function () {
      const newTypeInfo = {
        name: "Unauthorized Update",
        requiresBtcAddress: false,
        supportsLosses: false,
        requiresWrapper: false,
        maxBackingRatio: 0
      };

      await expect(
        accountControl.connect(user).setReserveTypeInfo(
          ReserveType.QC_BASIC,
          newTypeInfo
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Backward Compatibility", function () {
    it("should maintain existing authorization function signature", async function () {
      // Original function should still work and default to QC_BASIC
      await accountControl.connect(governance).authorizeReserve(basicReserve.address, SMALL_CAP);

      expect(await accountControl.authorized(basicReserve.address)).to.be.true;
      expect(await accountControl.getReserveType(basicReserve.address)).to.equal(ReserveType.QC_BASIC);
    });

    it("should not affect existing mint operations for basic reserves", async function () {
      await accountControl.connect(governance).authorizeReserve(basicReserve.address, MEDIUM_CAP);
      await accountControl.connect(basicReserve).updateBacking(MEDIUM_CAP);

      // Traditional mint operation should work unchanged
      await accountControl.connect(basicReserve).mint(user.address, SMALL_MINT);

      expect(await mockBank.balanceOf(user.address)).to.equal(SMALL_MINT);
      expect(await accountControl.minted(basicReserve.address)).to.equal(SMALL_MINT);
    });

    it("should not affect existing mintTBTC for basic reserves", async function () {
      await accountControl.connect(governance).authorizeReserve(basicReserve.address, MEDIUM_CAP);
      await accountControl.connect(basicReserve).updateBacking(MEDIUM_CAP);

      const tbtcAmount = ethers.utils.parseEther("0.005");
      const expectedSatoshis = tbtcAmount.div(ethers.utils.parseUnits("1", 10));

      await accountControl.connect(basicReserve).mintTBTC(user.address, tbtcAmount);

      expect(await mockBank.balanceOf(user.address)).to.equal(expectedSatoshis);
      expect(await accountControl.minted(basicReserve.address)).to.equal(expectedSatoshis);
    });
  });

  describe("Edge Cases and Error Handling", function () {
    it("should handle uninitialized reserve types", async function () {
      // Direct check for non-existent reserve
      const randomAddress = ethers.Wallet.createRandom().address;
      const reserveType = await accountControl.getReserveType(randomAddress);
      expect(reserveType).to.equal(ReserveType.UNINITIALIZED);
    });

    it("should validate type when updating non-existent reserve", async function () {
      const randomAddress = ethers.Wallet.createRandom().address;

      await expect(
        accountControl.connect(governance).updateReserveType(
          randomAddress,
          ReserveType.QC_VAULT_STRATEGY
        )
      ).to.be.revertedWith("ReserveNotFound");
    });

    it("should handle type validation for debitMinted on vault reserves", async function () {
      await accountControl.connect(governance).authorizeReserveWithType(
        vaultReserve.address,
        MIN_VAULT_CAP,
        ReserveType.QC_VAULT_STRATEGY
      );

      // Credit first to have something to debit
      await accountControl.connect(vaultReserve).creditMinted(SMALL_MINT);

      // Vault reserves should be able to debit (for loss handling)
      await accountControl.connect(vaultReserve).debitMinted(SMALL_MINT);

      expect(await accountControl.minted(vaultReserve.address)).to.equal(0);
    });
  });

  describe("Integration with Separated Operations", function () {
    beforeEach(async function () {
      // Setup both reserve types
      await accountControl.connect(governance).authorizeReserve(basicReserve.address, MEDIUM_CAP);
      await accountControl.connect(governance).authorizeReserveWithType(
        vaultReserve.address,
        MIN_VAULT_CAP,
        ReserveType.QC_VAULT_STRATEGY
      );

      // Setup backing and tokens
      await accountControl.connect(basicReserve).updateBacking(MEDIUM_CAP);
      await accountControl.connect(vaultReserve).updateBacking(MIN_VAULT_CAP);
      await mockBank.setBalance(vaultReserve.address, SMALL_MINT);
    });

    it("should support vault loss workflow with type validation", async function () {
      // 1. Vault credits minted when depositing to strategy
      await accountControl.connect(vaultReserve).creditMinted(SMALL_MINT);

      // 2. Strategy incurs loss - vault burns tokens without accounting update
      const initialMinted = await accountControl.minted(vaultReserve.address);
      await accountControl.connect(vaultReserve).burnTokens(SMALL_MINT);

      // Verify tokens burned but accounting unchanged
      expect(await mockBank.balanceOf(vaultReserve.address)).to.equal(0);
      expect(await accountControl.minted(vaultReserve.address)).to.equal(initialMinted);

      // 3. Later, adjust accounting for confirmed loss
      await accountControl.connect(vaultReserve).debitMinted(SMALL_MINT);
      expect(await accountControl.minted(vaultReserve.address)).to.equal(0);
    });

    it("should prevent loss workflow for basic reserves", async function () {
      // Basic reserves cannot burn tokens (no loss support)
      await mockBank.setBalance(basicReserve.address, SMALL_MINT);

      await expect(
        accountControl.connect(basicReserve).burnTokens(SMALL_MINT)
      ).to.be.revertedWith("Reserve type cannot handle losses");
    });
  });
});