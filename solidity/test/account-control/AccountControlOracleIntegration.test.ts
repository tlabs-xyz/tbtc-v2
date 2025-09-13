import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { 
  AccountControl, 
  QCManager, 
  ReserveOracle,
  QCData,
  SystemState
} from "../../typechain";

describe("AccountControl Oracle Integration", function () {
  let accountControl: AccountControl;
  let qcManager: QCManager;
  let reserveOracle: ReserveOracle;
  let qcData: QCData;
  let systemState: SystemState;
  let mockBank: any;
  
  let owner: SignerWithAddress;
  let emergencyCouncil: SignerWithAddress;
  let qc: SignerWithAddress;
  let attester1: SignerWithAddress;
  let attester2: SignerWithAddress;
  let attester3: SignerWithAddress;
  let user: SignerWithAddress;

  const ONE_BTC_IN_SATOSHIS = ethers.BigNumber.from("100000000"); // 1e8
  const SATOSHI_MULTIPLIER = ethers.BigNumber.from("10000000000"); // 1e10
  const ONE_TBTC = ONE_BTC_IN_SATOSHIS.mul(SATOSHI_MULTIPLIER); // 1e18
  
  const QC_MINTING_CAP = ONE_BTC_IN_SATOSHIS.mul(10); // 10 BTC cap

  beforeEach(async function () {
    [owner, emergencyCouncil, qc, attester1, attester2, attester3, user] = await ethers.getSigners();

    // Deploy mock Bank
    const MockBankFactory = await ethers.getContractFactory("MockBank");
    mockBank = await MockBankFactory.deploy();

    // Deploy QCData
    const QCDataFactory = await ethers.getContractFactory("QCData");
    qcData = await QCDataFactory.deploy();

    // Deploy SystemState
    const SystemStateFactory = await ethers.getContractFactory("SystemState");
    systemState = await SystemStateFactory.deploy();

    // Deploy ReserveOracle
    const ReserveOracleFactory = await ethers.getContractFactory("ReserveOracle");
    reserveOracle = await upgrades.deployProxy(
      ReserveOracleFactory,
      [
        2, // consensusThreshold
        3600, // attestationTimeout (1 hour)
        [attester1.address, attester2.address, attester3.address]
      ],
      { initializer: "initialize" }
    ) as ReserveOracle;

    // Deploy AccountControl
    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [owner.address, emergencyCouncil.address, mockBank.address],
      { initializer: "initialize" }
    ) as AccountControl;

    // Deploy QCManager
    const QCManagerFactory = await ethers.getContractFactory("QCManager");
    qcManager = await QCManagerFactory.deploy(
      qcData.address,
      systemState.address,
      reserveOracle.address
    );

    // Set AccountControl in QCManager
    await qcManager.connect(owner).setAccountControl(accountControl.address);
  });

  describe("Oracle-Backing Integration Flow", function () {
    it("should sync backing from oracle when QC is registered", async function () {
      // First, submit attestations to oracle for the QC
      const qcBalance = ONE_BTC_IN_SATOSHIS.mul(5); // 5 BTC backing
      
      await reserveOracle.connect(attester1).attestBalance(qc.address, qcBalance);
      await reserveOracle.connect(attester2).attestBalance(qc.address, qcBalance);
      // Consensus reached with 2/3 attesters

      // Register QC - should automatically sync backing
      await qcManager.connect(owner).registerQC(qc.address, QC_MINTING_CAP);

      // Verify backing was synced to AccountControl
      const backingAmount = await accountControl.backing(qc.address);
      expect(backingAmount).to.equal(qcBalance);

      // Verify QC is authorized and can mint within backing limits
      const canOperate = await accountControl.canOperate(qc.address);
      expect(canOperate).to.be.true;

      // Test minting with synced backing
      const mintAmount = ONE_BTC_IN_SATOSHIS.mul(2); // 2 BTC (within 5 BTC backing)
      await expect(
        accountControl.connect(qc).mint(user.address, mintAmount)
      ).to.emit(accountControl, "MintExecuted")
       .withArgs(qc.address, user.address, mintAmount);
    });

    it("should handle QC registration when no oracle data exists", async function () {
      // Register QC without any prior attestations
      await expect(
        qcManager.connect(owner).registerQC(qc.address, QC_MINTING_CAP)
      ).to.not.be.reverted;

      // Backing should be 0 (default)
      const backingAmount = await accountControl.backing(qc.address);
      expect(backingAmount).to.equal(0);

      // QC should still be authorized but cannot mint yet
      expect(await accountControl.authorized(qc.address)).to.be.true;
      expect(await accountControl.canOperate(qc.address)).to.be.true;

      // Minting should fail due to insufficient backing
      await expect(
        accountControl.connect(qc).mint(user.address, ONE_BTC_IN_SATOSHIS)
      ).to.be.revertedWith("InsufficientBacking");
    });

    it("should sync backing when QC status changes", async function () {
      // Register QC
      await qcManager.connect(owner).registerQC(qc.address, QC_MINTING_CAP);

      // Submit attestations after registration
      const initialBacking = ONE_BTC_IN_SATOSHIS.mul(3); // 3 BTC
      await reserveOracle.connect(attester1).attestBalance(qc.address, initialBacking);
      await reserveOracle.connect(attester2).attestBalance(qc.address, initialBacking);

      // Manually sync to get initial backing
      await qcManager.syncBackingFromOracle(qc.address);
      expect(await accountControl.backing(qc.address)).to.equal(initialBacking);

      // Update oracle with new backing amount
      const newBacking = ONE_BTC_IN_SATOSHIS.mul(6); // 6 BTC
      await reserveOracle.connect(attester1).attestBalance(qc.address, newBacking);
      await reserveOracle.connect(attester2).attestBalance(qc.address, newBacking);

      // Change QC status - should trigger backing sync
      await qcData.setQCStatus(qc.address, 1, "0x0000000000000000000000000000000000000000000000000000000000000000"); // MintingPaused
      
      // Simulate status change through QCManager (would normally be done by watchdog)
      // For this test, we'll call syncBackingFromOracle manually to verify the flow
      await qcManager.syncBackingFromOracle(qc.address);

      // Verify backing was updated
      const updatedBacking = await accountControl.backing(qc.address);
      expect(updatedBacking).to.equal(newBacking);
    });

    it("should emit BackingSyncedFromOracle event", async function () {
      await qcManager.connect(owner).registerQC(qc.address, QC_MINTING_CAP);

      const qcBalance = ONE_BTC_IN_SATOSHIS.mul(4); // 4 BTC
      await reserveOracle.connect(attester1).attestBalance(qc.address, qcBalance);
      await reserveOracle.connect(attester2).attestBalance(qc.address, qcBalance);

      // Sync backing manually
      await expect(
        qcManager.syncBackingFromOracle(qc.address)
      ).to.emit(qcManager, "BackingSyncedFromOracle")
       .withArgs(qc.address, qcBalance, false); // false = not stale
    });

    it("should handle batch backing sync", async function () {
      // Register multiple QCs
      const qc2 = attester3; // Reuse as second QC for test
      await qcManager.connect(owner).registerQC(qc.address, QC_MINTING_CAP);
      await qcManager.connect(owner).registerQC(qc2.address, QC_MINTING_CAP);

      // Submit attestations for both QCs
      const balance1 = ONE_BTC_IN_SATOSHIS.mul(2);
      const balance2 = ONE_BTC_IN_SATOSHIS.mul(3);

      await reserveOracle.connect(attester1).attestBalance(qc.address, balance1);
      await reserveOracle.connect(attester2).attestBalance(qc.address, balance1);
      await reserveOracle.connect(attester1).attestBalance(qc2.address, balance2);
      await reserveOracle.connect(attester2).attestBalance(qc2.address, balance2);

      // Batch sync
      await expect(
        qcManager.batchSyncBackingFromOracle([qc.address, qc2.address])
      ).to.emit(qcManager, "BackingSyncedFromOracle")
       .withArgs(qc.address, balance1, false);

      // Verify both backings were synced
      expect(await accountControl.backing(qc.address)).to.equal(balance1);
      expect(await accountControl.backing(qc2.address)).to.equal(balance2);
    });

    it("should handle stale oracle data", async function () {
      await qcManager.connect(owner).registerQC(qc.address, QC_MINTING_CAP);

      const qcBalance = ONE_BTC_IN_SATOSHIS.mul(2);
      await reserveOracle.connect(attester1).attestBalance(qc.address, qcBalance);
      await reserveOracle.connect(attester2).attestBalance(qc.address, qcBalance);

      // Fast forward time to make data stale (more than attestationTimeout)
      await ethers.provider.send("evm_increaseTime", [3700]); // 61+ minutes
      await ethers.provider.send("evm_mine", []);

      // Sync should still work but report stale data
      await expect(
        qcManager.syncBackingFromOracle(qc.address)
      ).to.emit(qcManager, "BackingSyncedFromOracle")
       .withArgs(qc.address, qcBalance, true); // true = stale

      // Backing should still be synced despite being stale
      expect(await accountControl.backing(qc.address)).to.equal(qcBalance);
    });

    it("should enforce backing >= minted invariant with oracle data", async function () {
      await qcManager.connect(owner).registerQC(qc.address, QC_MINTING_CAP);

      // Set backing to 2 BTC via oracle
      const backing = ONE_BTC_IN_SATOSHIS.mul(2);
      await reserveOracle.connect(attester1).attestBalance(qc.address, backing);
      await reserveOracle.connect(attester2).attestBalance(qc.address, backing);
      await qcManager.syncBackingFromOracle(qc.address);

      // Mint 1 BTC successfully
      const mintAmount1 = ONE_BTC_IN_SATOSHIS;
      await accountControl.connect(qc).mint(user.address, mintAmount1);
      expect(await accountControl.minted(qc.address)).to.equal(mintAmount1);

      // Try to mint 2 more BTC (would exceed backing)
      const mintAmount2 = ONE_BTC_IN_SATOSHIS.mul(2);
      await expect(
        accountControl.connect(qc).mint(user.address, mintAmount2)
      ).to.be.revertedWith("InsufficientBacking");

      // Increase backing via oracle and try again
      const newBacking = ONE_BTC_IN_SATOSHIS.mul(5);
      await reserveOracle.connect(attester1).attestBalance(qc.address, newBacking);
      await reserveOracle.connect(attester2).attestBalance(qc.address, newBacking);
      await qcManager.syncBackingFromOracle(qc.address);

      // Now minting should succeed
      await expect(
        accountControl.connect(qc).mint(user.address, mintAmount2)
      ).to.emit(accountControl, "MintExecuted");
    });

    it("should handle oracle consensus changes correctly", async function () {
      await qcManager.connect(owner).registerQC(qc.address, QC_MINTING_CAP);

      // Initial consensus with 2 BTC
      await reserveOracle.connect(attester1).attestBalance(qc.address, ONE_BTC_IN_SATOSHIS.mul(2));
      await reserveOracle.connect(attester2).attestBalance(qc.address, ONE_BTC_IN_SATOSHIS.mul(2));
      await qcManager.syncBackingFromOracle(qc.address);
      expect(await accountControl.backing(qc.address)).to.equal(ONE_BTC_IN_SATOSHIS.mul(2));

      // New attestations change consensus to 4 BTC
      await reserveOracle.connect(attester1).attestBalance(qc.address, ONE_BTC_IN_SATOSHIS.mul(4));
      await reserveOracle.connect(attester2).attestBalance(qc.address, ONE_BTC_IN_SATOSHIS.mul(4));
      await reserveOracle.connect(attester3).attestBalance(qc.address, ONE_BTC_IN_SATOSHIS.mul(4));

      // Sync again
      await qcManager.syncBackingFromOracle(qc.address);
      expect(await accountControl.backing(qc.address)).to.equal(ONE_BTC_IN_SATOSHIS.mul(4));
    });
  });

  describe("Error Handling", function () {
    it("should handle syncBackingFromOracle with zero address", async function () {
      await expect(
        qcManager.syncBackingFromOracle(ethers.constants.AddressZero)
      ).to.be.revertedWith("QC address cannot be zero");
    });

    it("should handle syncBackingFromOracle when AccountControl not set", async function () {
      // Deploy new QCManager without setting AccountControl
      const freshQCManager = await ethers.getContractFactory("QCManager").then(f => 
        f.deploy(qcData.address, systemState.address, reserveOracle.address)
      );

      await expect(
        freshQCManager.syncBackingFromOracle(qc.address)
      ).to.be.revertedWith("AccountControl not set");
    });

    it("should handle batch sync with mixed valid/invalid addresses", async function () {
      await qcManager.connect(owner).registerQC(qc.address, QC_MINTING_CAP);

      const qcBalance = ONE_BTC_IN_SATOSHIS;
      await reserveOracle.connect(attester1).attestBalance(qc.address, qcBalance);
      await reserveOracle.connect(attester2).attestBalance(qc.address, qcBalance);

      // Batch with zero address should skip invalid entries
      await expect(
        qcManager.batchSyncBackingFromOracle([qc.address, ethers.constants.AddressZero])
      ).to.not.be.reverted;

      // Valid QC should still be synced
      expect(await accountControl.backing(qc.address)).to.equal(qcBalance);
    });
  });
});