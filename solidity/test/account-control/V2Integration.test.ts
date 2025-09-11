import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { AccountControl, QCMinter, QCRedeemer, QCManager } from "../../typechain";

describe("V2 Integration Tests", function () {
  let accountControl: AccountControl;
  let qcMinter: QCMinter;
  let qcRedeemer: QCRedeemer;
  let qcManager: QCManager;
  
  let owner: SignerWithAddress;
  let emergencyCouncil: SignerWithAddress;
  let qc: SignerWithAddress;
  let user: SignerWithAddress;
  let minter: SignerWithAddress;
  
  let mockBank: any;
  let mockTbtcToken: any;
  let mockSystemState: any;
  let mockTbtcVault: any;
  let mockQcData: any;
  let mockQcManager: any;
  let mockRelay: any;

  const SATOSHI_MULTIPLIER = ethers.utils.parseEther("0.00000001"); // 1e10
  const QC_BACKING_AMOUNT = 1000000; // 0.01 BTC in satoshis
  const QC_MINTING_CAP = 1000000; // 0.01 BTC in satoshis
  const MINT_AMOUNT = ethers.utils.parseEther("0.005"); // 0.005 tBTC

  beforeEach(async function () {
    [owner, emergencyCouncil, qc, user, minter] = await ethers.getSigners();

    // Deploy mock contracts
    const MockBankFactory = await ethers.getContractFactory("MockBankEnhanced");
    mockBank = await MockBankFactory.deploy();

    const MockTbtcTokenFactory = await ethers.getContractFactory("MockTBTCToken");
    mockTbtcToken = await MockTbtcTokenFactory.deploy();

    const MockSystemStateFactory = await ethers.getContractFactory("MockSystemState");
    mockSystemState = await MockSystemStateFactory.deploy();

    // Deploy minimal mock contracts for QCMinter requirements
    const MockTBTCVaultFactory = await ethers.getContractFactory("MockTBTCVault");
    mockTbtcVault = await MockTBTCVaultFactory.deploy();

    // Deploy AccountControl first
    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [owner.address, emergencyCouncil.address, mockBank.address],
      { initializer: "initialize" }
    ) as AccountControl;

    // Create simple mock addresses for contracts we don't need to interact with
    mockQcData = user; // Reuse existing signer as mock
    mockQcManager = emergencyCouncil; // Reuse existing signer as mock  
    mockRelay = owner; // Reuse existing signer as mock

    // Deploy QCMinter with constructor (not upgradeable)
    const QCMinterFactory = await ethers.getContractFactory("QCMinter");
    qcMinter = await QCMinterFactory.deploy(
      mockBank.address,
      mockTbtcVault.address,
      mockTbtcToken.address,
      mockQcData.address,
      mockSystemState.address,
      mockQcManager.address
    ) as QCMinter;

    // Deploy QCRedeemer with constructor (not upgradeable)
    const QCRedeemerFactory = await ethers.getContractFactory("QCRedeemer");
    qcRedeemer = await QCRedeemerFactory.deploy(
      mockTbtcToken.address,
      mockQcData.address,
      mockSystemState.address,
      mockRelay.address,
      100 // txProofDifficultyFactor
    ) as QCRedeemer;

    // Setup AccountControl
    await accountControl.connect(owner).authorizeReserve(qc.address, QC_MINTING_CAP);
    await accountControl.connect(qc).updateBacking(QC_BACKING_AMOUNT);

    // Grant necessary roles
    const MINTER_ROLE = await qcMinter.MINTER_ROLE();
    await qcMinter.connect(owner).grantRole(MINTER_ROLE, minter.address);

    // Enable V2 mode in contracts
    await qcMinter.connect(owner).setV2Mode(true);
    await qcRedeemer.connect(owner).setV2Mode(true);

    // Mint tokens to user for redemption tests
    await mockTbtcToken.mint(user.address, MINT_AMOUNT);
    await mockTbtcToken.connect(user).approve(qcRedeemer.address, MINT_AMOUNT);
  });

  describe("QCMinter V2 Integration", function () {
    it("should route minting through AccountControl when V2 enabled", async function () {
      const initialMinted = await accountControl.minted(qc.address);
      const initialTotal = await accountControl.totalMinted();
      
      // Request mint through QCMinter
      const tx = await qcMinter.connect(minter).requestQCMint(qc.address, MINT_AMOUNT);
      const receipt = await tx.wait();
      
      // Get mintId from event
      const event = receipt.events?.find(e => e.event === "QCMintRequested");
      const mintId = event?.args?.mintId;
      
      // Execute the mint
      await qcMinter.connect(qc).executeQCMint(mintId, user.address);
      
      // Verify AccountControl state was updated
      const expectedSatoshis = MINT_AMOUNT.div(SATOSHI_MULTIPLIER);
      expect(await accountControl.minted(qc.address)).to.equal(initialMinted.add(expectedSatoshis));
      expect(await accountControl.totalMinted()).to.equal(initialTotal.add(expectedSatoshis));
      
      // Verify Bank balance was created
      expect(await mockBank.balances(user.address)).to.equal(expectedSatoshis);
    });

    it("should bypass AccountControl when V2 disabled", async function () {
      // Disable V2 mode
      await qcMinter.connect(owner).setV2Mode(false);
      
      const initialMinted = await accountControl.minted(qc.address);
      
      // Request and execute mint
      const tx = await qcMinter.connect(minter).requestQCMint(qc.address, MINT_AMOUNT);
      const receipt = await tx.wait();
      const mintId = receipt.events?.find(e => e.event === "QCMintRequested")?.args?.mintId;
      
      await qcMinter.connect(qc).executeQCMint(mintId, user.address);
      
      // Verify AccountControl state was NOT updated
      expect(await accountControl.minted(qc.address)).to.equal(initialMinted);
      
      // But Bank balance was still created
      const expectedSatoshis = MINT_AMOUNT.div(SATOSHI_MULTIPLIER);
      expect(await mockBank.balances(user.address)).to.equal(expectedSatoshis);
    });

    it("should enforce AccountControl backing invariant in V2 mode", async function () {
      // Set backing lower than mint amount
      await accountControl.connect(qc).updateBacking(100000); // 0.001 BTC
      
      const tx = await qcMinter.connect(minter).requestQCMint(qc.address, MINT_AMOUNT);
      const receipt = await tx.wait();
      const mintId = receipt.events?.find(e => e.event === "QCMintRequested")?.args?.mintId;
      
      // Should revert due to insufficient backing
      await expect(
        qcMinter.connect(qc).executeQCMint(mintId, user.address)
      ).to.be.revertedWith("InsufficientBacking");
    });

    it("should enforce AccountControl minting cap in V2 mode", async function () {
      // Set a very low minting cap
      await accountControl.connect(owner).setMintingCap(qc.address, 100000); // 0.001 BTC
      
      const tx = await qcMinter.connect(minter).requestQCMint(qc.address, MINT_AMOUNT);
      const receipt = await tx.wait();
      const mintId = receipt.events?.find(e => e.event === "QCMintRequested")?.args?.mintId;
      
      // Should revert due to cap exceeded
      await expect(
        qcMinter.connect(qc).executeQCMint(mintId, user.address)
      ).to.be.revertedWith("ExceedsReserveCap");
    });
  });

  describe("QCRedeemer V2 Integration", function () {
    beforeEach(async function () {
      // First mint some tokens through the system
      const tx = await qcMinter.connect(minter).requestQCMint(qc.address, MINT_AMOUNT);
      const receipt = await tx.wait();
      const mintId = receipt.events?.find(e => e.event === "QCMintRequested")?.args?.mintId;
      await qcMinter.connect(qc).executeQCMint(mintId, user.address);
      
      // Setup redemption timeout
      await mockSystemState.setRedemptionTimeout(86400); // 24 hours
    });

    it("should notify AccountControl of redemption when V2 enabled", async function () {
      const initialMinted = await accountControl.minted(qc.address);
      const initialTotal = await accountControl.totalMinted();
      
      // Request redemption
      const redemptionAmount = MINT_AMOUNT.div(2); // Redeem half
      await qcRedeemer.connect(user).requestQCRedemption(
        qc.address,
        redemptionAmount,
        "0x1234" // Bitcoin address
      );
      
      // Verify AccountControl state was updated
      const expectedSatoshis = redemptionAmount.div(SATOSHI_MULTIPLIER);
      expect(await accountControl.minted(qc.address)).to.equal(initialMinted.sub(expectedSatoshis));
      expect(await accountControl.totalMinted()).to.equal(initialTotal.sub(expectedSatoshis));
      
      // Verify tokens were burned
      expect(await mockTbtcToken.balanceOf(user.address)).to.equal(MINT_AMOUNT.sub(redemptionAmount));
    });

    it("should bypass AccountControl when V2 disabled", async function () {
      // Disable V2 mode
      await qcRedeemer.connect(owner).setV2Mode(false);
      
      const initialMinted = await accountControl.minted(qc.address);
      
      // Request redemption
      const redemptionAmount = MINT_AMOUNT.div(2);
      await qcRedeemer.connect(user).requestQCRedemption(
        qc.address,
        redemptionAmount,
        "0x1234"
      );
      
      // Verify AccountControl state was NOT updated
      expect(await accountControl.minted(qc.address)).to.equal(initialMinted);
      
      // But tokens were still burned
      expect(await mockTbtcToken.balanceOf(user.address)).to.equal(MINT_AMOUNT.sub(redemptionAmount));
    });

    it("should prevent over-redemption in V2 mode", async function () {
      // Try to redeem more than was minted
      const excessiveAmount = MINT_AMOUNT.mul(2);
      
      await mockTbtcToken.mint(user.address, excessiveAmount);
      await mockTbtcToken.connect(user).approve(qcRedeemer.address, excessiveAmount);
      
      await expect(
        qcRedeemer.connect(user).requestQCRedemption(
          qc.address,
          excessiveAmount,
          "0x1234"
        )
      ).to.be.revertedWith("InsufficientMinted");
    });
  });

  describe("V2 Mode Toggle Scenarios", function () {
    it("should handle V2 mode toggling mid-operation", async function () {
      // Mint with V2 enabled
      let tx = await qcMinter.connect(minter).requestQCMint(qc.address, MINT_AMOUNT);
      let receipt = await tx.wait();
      let mintId = receipt.events?.find(e => e.event === "QCMintRequested")?.args?.mintId;
      await qcMinter.connect(qc).executeQCMint(mintId, user.address);
      
      const initialMinted = await accountControl.minted(qc.address);
      
      // Disable V2 mode
      await qcMinter.connect(owner).setV2Mode(false);
      
      // Mint again with V2 disabled
      tx = await qcMinter.connect(minter).requestQCMint(qc.address, MINT_AMOUNT);
      receipt = await tx.wait();
      mintId = receipt.events?.find(e => e.event === "QCMintRequested")?.args?.mintId;
      await qcMinter.connect(qc).executeQCMint(mintId, user.address);
      
      // V2 state should not change
      expect(await accountControl.minted(qc.address)).to.equal(initialMinted);
      
      // Re-enable V2 mode  
      await qcMinter.connect(owner).setV2Mode(true);
      
      // Mint again with V2 re-enabled
      tx = await qcMinter.connect(minter).requestQCMint(qc.address, MINT_AMOUNT);
      receipt = await tx.wait();
      mintId = receipt.events?.find(e => e.event === "QCMintRequested")?.args?.mintId;
      await qcMinter.connect(qc).executeQCMint(mintId, user.address);
      
      // V2 state should update again
      const expectedSatoshis = MINT_AMOUNT.div(SATOSHI_MULTIPLIER);
      expect(await accountControl.minted(qc.address)).to.equal(initialMinted.add(expectedSatoshis));
    });
  });

  describe("Cross-Contract Interaction Validation", function () {
    it("should maintain consistent state across all V2 contracts", async function () {
      const mintAmount = MINT_AMOUNT;
      
      // Execute mint through QCMinter
      let tx = await qcMinter.connect(minter).requestQCMint(qc.address, mintAmount);
      let receipt = await tx.wait();
      let mintId = receipt.events?.find(e => e.event === "QCMintRequested")?.args?.mintId;
      await qcMinter.connect(qc).executeQCMint(mintId, user.address);
      
      const expectedSatoshis = mintAmount.div(SATOSHI_MULTIPLIER);
      
      // Verify AccountControl state
      expect(await accountControl.minted(qc.address)).to.equal(expectedSatoshis);
      expect(await accountControl.backing(qc.address)).to.equal(QC_BACKING_AMOUNT);
      
      // Execute partial redemption
      const redeemAmount = mintAmount.div(2);
      await qcRedeemer.connect(user).requestQCRedemption(
        qc.address,
        redeemAmount,
        "0x1234"
      );
      
      const remainingSatoshis = expectedSatoshis.sub(redeemAmount.div(SATOSHI_MULTIPLIER));
      
      // Verify final state consistency
      expect(await accountControl.minted(qc.address)).to.equal(remainingSatoshis);
      expect(await mockTbtcToken.balanceOf(user.address)).to.equal(redeemAmount);
      expect(await mockBank.balances(user.address)).to.equal(expectedSatoshis);
    });

    it("should handle multiple QCs operating simultaneously", async function () {
      // Setup second QC
      const qc2 = emergencyCouncil; // Reuse signer
      await accountControl.connect(owner).authorizeReserve(qc2.address, QC_MINTING_CAP);
      await accountControl.connect(qc2).updateBacking(QC_BACKING_AMOUNT);
      
      // Mint from both QCs
      let tx1 = await qcMinter.connect(minter).requestQCMint(qc.address, MINT_AMOUNT);
      let receipt1 = await tx1.wait();
      let mintId1 = receipt1.events?.find(e => e.event === "QCMintRequested")?.args?.mintId;
      
      let tx2 = await qcMinter.connect(minter).requestQCMint(qc2.address, MINT_AMOUNT);
      let receipt2 = await tx2.wait();
      let mintId2 = receipt2.events?.find(e => e.event === "QCMintRequested")?.args?.mintId;
      
      await qcMinter.connect(qc).executeQCMint(mintId1, user.address);
      await qcMinter.connect(qc2).executeQCMint(mintId2, user.address);
      
      const expectedSatoshis = MINT_AMOUNT.div(SATOSHI_MULTIPLIER);
      
      // Verify separate QC accounting
      expect(await accountControl.minted(qc.address)).to.equal(expectedSatoshis);
      expect(await accountControl.minted(qc2.address)).to.equal(expectedSatoshis);
      expect(await accountControl.totalMinted()).to.equal(expectedSatoshis.mul(2));
    });
  });

  describe("End-to-End V2 Workflow", function () {
    it("should complete full mint-redeem cycle with proper state management", async function () {
      // Initial state
      expect(await accountControl.totalMinted()).to.equal(0);
      expect(await mockTbtcToken.totalSupply()).to.equal(MINT_AMOUNT); // From beforeEach setup
      
      // 1. Request and execute mint
      let tx = await qcMinter.connect(minter).requestQCMint(qc.address, MINT_AMOUNT);
      let receipt = await tx.wait();
      let mintId = receipt.events?.find(e => e.event === "QCMintRequested")?.args?.mintId;
      await qcMinter.connect(qc).executeQCMint(mintId, user.address);
      
      const expectedSatoshis = MINT_AMOUNT.div(SATOSHI_MULTIPLIER);
      
      // 2. Verify mint state
      expect(await accountControl.minted(qc.address)).to.equal(expectedSatoshis);
      expect(await accountControl.totalMinted()).to.equal(expectedSatoshis);
      expect(await mockBank.balances(user.address)).to.equal(expectedSatoshis);
      
      // 3. Execute redemption
      await qcRedeemer.connect(user).requestQCRedemption(
        qc.address,
        MINT_AMOUNT,
        "0x1234"
      );
      
      // 4. Verify final state - everything should be back to zero
      expect(await accountControl.minted(qc.address)).to.equal(0);
      expect(await accountControl.totalMinted()).to.equal(0);
      expect(await mockTbtcToken.balanceOf(user.address)).to.equal(0);
      
      // Bank balance remains (doesn't get decremented in redemption)
      expect(await mockBank.balances(user.address)).to.equal(expectedSatoshis);
    });
  });
});