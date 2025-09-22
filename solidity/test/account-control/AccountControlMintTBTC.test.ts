import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { AccountControl } from "../../typechain";
import { setupAccountControlForTesting } from "../helpers/testSetupHelpers";

describe("AccountControl mintTBTC Functionality", function () {
  let accountControl: AccountControl;
  let owner: SignerWithAddress;
  let emergencyCouncil: SignerWithAddress;
  let mockBank: any;
  let reserve: SignerWithAddress;
  let user: SignerWithAddress;

  const SATOSHI_MULTIPLIER = ethers.BigNumber.from("10000000000"); // 1e10
  const ONE_BTC_IN_SATOSHIS = ethers.BigNumber.from("100000000"); // 1e8
  const ONE_TBTC = ONE_BTC_IN_SATOSHIS.mul(SATOSHI_MULTIPLIER); // 1e18

  beforeEach(async function () {
    [owner, emergencyCouncil, reserve, user] = await ethers.getSigners();

    // Deploy mock Bank
    const MockBankFactory = await ethers.getContractFactory("MockBank");
    mockBank = await MockBankFactory.deploy();

    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [owner.address, emergencyCouncil.address, mockBank.address],
      { initializer: "initialize" }
    ) as AccountControl;

    // Authorize a reserve with 10 BTC cap
    const mintingCap = ONE_BTC_IN_SATOSHIS.mul(10); // 10 BTC in satoshis
    await accountControl.connect(owner).authorizeReserve(reserve.address, mintingCap);

    // Set backing for the reserve (10 BTC)
    const backing = ONE_BTC_IN_SATOSHIS.mul(10); // 10 BTC in satoshis
    await accountControl.connect(reserve).updateBacking(backing);

    // Setup additional authorization for other test signers in case they're used
    const allSigners = await ethers.getSigners();
    await setupAccountControlForTesting(accountControl, allSigners, owner);
  });

  describe("mintTBTC return value", function () {
    it("should return satoshis amount after successful mint", async function () {
      const tbtcAmount = ONE_TBTC; // 1 tBTC (1e18)
      const expectedSatoshis = ONE_BTC_IN_SATOSHIS; // 1 BTC in satoshis (1e8)
      
      // Call mintTBTC and capture return value
      const returnedSatoshis = await accountControl
        .connect(reserve)
        .callStatic
        .mintTBTC(user.address, tbtcAmount);
      
      expect(returnedSatoshis).to.equal(expectedSatoshis);
    });

    it("should correctly convert and mint for various tBTC amounts", async function () {
      const testCases = [
        { tbtc: ONE_TBTC.div(10), expectedSatoshis: ONE_BTC_IN_SATOSHIS.div(10) }, // 0.1 tBTC
        { tbtc: ONE_TBTC.div(100), expectedSatoshis: ONE_BTC_IN_SATOSHIS.div(100) }, // 0.01 tBTC
        { tbtc: ONE_TBTC.mul(5), expectedSatoshis: ONE_BTC_IN_SATOSHIS.mul(5) }, // 5 tBTC
      ];

      for (const testCase of testCases) {
        const returnedSatoshis = await accountControl
          .connect(reserve)
          .callStatic
          .mintTBTC(user.address, testCase.tbtc);
        
        expect(returnedSatoshis).to.equal(testCase.expectedSatoshis);
      }
    });

    it("should properly update minted amounts using returned satoshis", async function () {
      const tbtcAmount = ONE_TBTC.mul(2); // 2 tBTC
      const expectedSatoshis = ONE_BTC_IN_SATOSHIS.mul(2); // 2 BTC in satoshis
      
      // Get initial minted amount
      const initialMinted = await accountControl.minted(reserve.address);
      
      // Execute mintTBTC
      const tx = await accountControl
        .connect(reserve)
        .mintTBTC(user.address, tbtcAmount);
      
      // Check that minted amount increased by the satoshi amount
      const finalMinted = await accountControl.minted(reserve.address);
      expect(finalMinted.sub(initialMinted)).to.equal(expectedSatoshis);
    });

    it("should emit MintExecuted event with satoshi amount", async function () {
      const tbtcAmount = ONE_TBTC; // 1 tBTC
      const expectedSatoshis = ONE_BTC_IN_SATOSHIS; // 1 BTC in satoshis
      
      await expect(
        accountControl.connect(reserve).mintTBTC(user.address, tbtcAmount)
      )
        .to.emit(accountControl, "MintExecuted")
        .withArgs(reserve.address, user.address, expectedSatoshis);
    });

    it("should enforce minimum mint amount in satoshis", async function () {
      const MIN_MINT_AMOUNT = ethers.BigNumber.from("10000"); // 0.0001 BTC in satoshis
      
      // Try to mint less than minimum (0.00005 BTC)
      const tooSmallAmount = MIN_MINT_AMOUNT.div(2).mul(SATOSHI_MULTIPLIER);
      
      await expect(
        accountControl.connect(reserve).mintTBTC(user.address, tooSmallAmount)
      ).to.be.revertedWith("AmountTooSmall");
    });

    it("should enforce maximum single mint in satoshis", async function () {
      // First increase backing to allow large mint
      const largeBacking = ONE_BTC_IN_SATOSHIS.mul(200); // 200 BTC
      await accountControl.connect(reserve).updateBacking(largeBacking);
      
      // Update minting cap to allow large mint
      await accountControl.connect(owner).setMintingCap(reserve.address, largeBacking);
      
      const MAX_SINGLE_MINT = ONE_BTC_IN_SATOSHIS.mul(100); // 100 BTC in satoshis
      
      // Try to mint more than maximum (101 BTC)
      const tooLargeAmount = MAX_SINGLE_MINT.add(ONE_BTC_IN_SATOSHIS).mul(SATOSHI_MULTIPLIER);
      
      await expect(
        accountControl.connect(reserve).mintTBTC(user.address, tooLargeAmount)
      ).to.be.revertedWith("AmountTooLarge");
    });

    it("should check backing using satoshi amounts", async function () {
      // Set backing to 1 BTC
      await accountControl.connect(reserve).updateBacking(ONE_BTC_IN_SATOSHIS);
      
      // Try to mint 2 tBTC (more than backing)
      const tbtcAmount = ONE_TBTC.mul(2);
      
      await expect(
        accountControl.connect(reserve).mintTBTC(user.address, tbtcAmount)
      ).to.be.revertedWith("InsufficientBacking");
    });

    it("should handle precision correctly for fractional tBTC amounts", async function () {
      // Test with 0.123456789 tBTC (has 9 decimal places in satoshi terms)
      const fractionalTBTC = ethers.BigNumber.from("123456789000000000"); // 0.123456789 tBTC
      const expectedSatoshis = ethers.BigNumber.from("12345678"); // 0.12345678 BTC in satoshis (truncated)
      
      const returnedSatoshis = await accountControl
        .connect(reserve)
        .callStatic
        .mintTBTC(user.address, fractionalTBTC);
      
      expect(returnedSatoshis).to.equal(expectedSatoshis);
    });
  });

  describe("mintTBTC integration with QCMinter", function () {
    it("should work correctly with QCMinter conversion patterns", async function () {
      // This test validates that the return value can be used directly
      // by QCMinter for event emission without redundant conversion
      
      const tbtcAmount = ONE_TBTC.mul(3); // 3 tBTC
      
      // Simulate what QCMinter does:
      // 1. Call mintTBTC and get satoshis back
      const satoshis = await accountControl
        .connect(reserve)
        .callStatic
        .mintTBTC(user.address, tbtcAmount);
      
      // 2. Use returned satoshis directly for event data (no conversion needed)
      expect(satoshis).to.equal(ONE_BTC_IN_SATOSHIS.mul(3));
      
      // 3. Verify the value matches what manual conversion would give
      const manualConversion = tbtcAmount.div(SATOSHI_MULTIPLIER);
      expect(satoshis).to.equal(manualConversion);
    });
  });
});