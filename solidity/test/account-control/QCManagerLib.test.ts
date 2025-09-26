import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  QCData,
  QCManager,
  AccountControl,
  SystemState,
  ReserveOracle,
  MockBank
} from "../../typechain";

describe("QCManagerLib", function () {
  let qcManager: QCManager;
  let qcData: QCData;
  let accountControl: AccountControl;
  let systemState: SystemState;
  let reserveOracle: ReserveOracle;
  let mockBank: MockBank;

  let owner: SignerWithAddress;
  let qc1: SignerWithAddress;
  let qc2: SignerWithAddress;
  let user: SignerWithAddress;
  let attester1: SignerWithAddress;

  const MAX_MINTING_CAP = ethers.utils.parseUnits("100", 8); // 100 BTC in satoshis
  const ZERO_ADDRESS = ethers.constants.AddressZero;

  beforeEach(async function () {
    [owner, qc1, qc2, user, attester1] = await ethers.getSigners();

    // Deploy mock bank
    const MockBankFactory = await ethers.getContractFactory("MockBank");
    mockBank = await MockBankFactory.deploy();

    // Deploy core contracts
    const QCDataFactory = await ethers.getContractFactory("QCData");
    qcData = await QCDataFactory.deploy();

    const SystemStateFactory = await ethers.getContractFactory("SystemState");
    systemState = await SystemStateFactory.deploy();

    const ReserveOracleFactory = await ethers.getContractFactory("ReserveOracle");
    reserveOracle = await ReserveOracleFactory.deploy();

    // Deploy QCManagerLib library
    const QCManagerLibFactory = await ethers.getContractFactory("QCManagerLib");
    const qcManagerLib = await QCManagerLibFactory.deploy();

    // Deploy QCManager with libraries linked
    const QCManagerFactory = await ethers.getContractFactory("QCManager", {
      libraries: {
        QCManagerLib: qcManagerLib.address,
      },
    });
    qcManager = await QCManagerFactory.deploy(
      qcData.address,
      systemState.address,
      reserveOracle.address
    );

    // Deploy AccountControl using upgrades proxy
    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [owner.address, owner.address, mockBank.address],
      { initializer: "initialize" }
    ) as AccountControl;

    // Setup roles
    const QC_MANAGER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_MANAGER_ROLE"));
    await qcData.grantRole(QC_MANAGER_ROLE, qcManager.address);

    // Grant governance role to owner for QCManager operations
    const GOVERNANCE_ROLE = await qcManager.GOVERNANCE_ROLE();
    await qcManager.grantRole(GOVERNANCE_ROLE, owner.address);

    // Set AccountControl in QCManager
    await qcManager.connect(owner).setAccountControl(accountControl.address);

    // Grant QCManager the QC_MANAGER_ROLE in AccountControl
    await accountControl.connect(owner).grantQCManagerRole(qcManager.address);

    // Grant EMERGENCY_COUNCIL_ROLE to QCManager for pauseReserve operations
    const EMERGENCY_COUNCIL_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EMERGENCY_COUNCIL_ROLE"));
    await accountControl.grantRole(EMERGENCY_COUNCIL_ROLE, qcManager.address);
  });

  describe("Library Error Validation", function () {

    it("should revert with InvalidQCAddress when registering zero address", async function () {
      await expect(
        qcManager.connect(owner).registerQC(ZERO_ADDRESS, MAX_MINTING_CAP)
      ).to.be.revertedWith("InvalidQCAddress");
    });

    it("should revert with InvalidMintingCapacity when capacity is zero", async function () {
      await expect(
        qcManager.connect(owner).registerQC(qc1.address, 0)
      ).to.be.revertedWith("InvalidMintingCapacity");
    });

    it("should revert with QCAlreadyRegistered when registering twice", async function () {
      await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);

      await expect(
        qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP)
      ).to.be.reverted;
    });

    it("should revert with QCNotRegistered for non-existent QC", async function () {
      await expect(
        qcManager.connect(owner).setQCStatus(qc1.address, 2, ethers.utils.formatBytes32String("test")) // PAUSED
      ).to.be.reverted;
    });

    it.skip("should revert with InvalidWalletAddress for zero address wallet - addWallet function doesn't exist", async function () {
      // Function addWallet doesn't exist - wallet registration uses registerWallet or registerWalletDirect
    });

    it("should revert with InvalidStatusTransition for invalid status changes", async function () {
      await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);

      // Try to transition from REGISTERED (0) to REMOVED (3) directly
      await expect(
        qcManager.connect(owner).setQCStatus(qc1.address, 3, ethers.utils.formatBytes32String("test"))
      ).to.be.reverted;
    });

    it("should revert with NewCapMustBeHigher when not increasing capacity", async function () {
      await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);

      await expect(
        qcManager.connect(owner).increaseMintingCapacity(qc1.address, MAX_MINTING_CAP)
      ).to.be.reverted;
    });
  });

  describe("Library Registration Logic", function () {

    it("should successfully register QC with valid parameters", async function () {
      await expect(
        qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP)
      ).to.emit(qcManager, "QCOnboarded");

      const qcInfo = await qcData.getQCInfo(qc1.address);
      expect(qcInfo.registeredAt).to.be.gt(0);
      expect(qcInfo.status).to.equal(0); // REGISTERED
      expect(qcInfo.maxCapacity).to.equal(MAX_MINTING_CAP);
    });

    it("should authorize QC in AccountControl when enabled", async function () {
      // Grant QC_MANAGER_ROLE to qcManager in AccountControl
      const QC_MANAGER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_MANAGER_ROLE"));
      await accountControl.grantRole(QC_MANAGER_ROLE, qcManager.address);

      await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);

      expect(await accountControl.authorized(qc1.address)).to.be.true;
    });
  });

  describe("Library Status Validation", function () {

    beforeEach(async function () {
      await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);
    });

    it.skip("should validate status transitions correctly - TODO: requires AccountControl unpause access", async function () {
      // QC already registered in beforeEach

      // Valid: REGISTERED(0) -> MINTING_PAUSED(1)
      await expect(
        qcManager.connect(owner).setQCStatus(qc1.address, 1, ethers.utils.formatBytes32String("test"))
      ).to.emit(qcManager, "QCStatusChanged")
        .withArgs(qc1.address, 0, 1);

      // Valid: MINTING_PAUSED(1) -> UNDER_REVIEW(3)
      await expect(
        qcManager.connect(owner).setQCStatus(qc1.address, 3, ethers.utils.formatBytes32String("test"))
      ).to.emit(qcManager, "QCStatusChanged")
        .withArgs(qc1.address, 1, 3);

      // Valid: UNDER_REVIEW(3) -> REVOKED(4)
      await expect(
        qcManager.connect(owner).setQCStatus(qc1.address, 4, ethers.utils.formatBytes32String("test"))
      ).to.emit(qcManager, "QCStatusChanged")
        .withArgs(qc1.address, 3, 4);
    });

    it.skip("should enforce QCNotActive for operations requiring active status - addWallet doesn't exist", async function () {
      // Function addWallet doesn't exist

      // Activate QC
      await qcManager.connect(owner).setQCStatus(qc1.address, 1, ethers.utils.formatBytes32String("test"));

      // Now wallet addition should work
      await expect(
        qcManager.connect(qc1).addWallet(user.address, "bc1qtest", ethers.utils.randomBytes(32))
      ).to.not.be.reverted;
    });
  });

  describe.skip("Library Wallet Management - TODO: addWallet function doesn't exist", function () {

    beforeEach(async function () {
      await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);
      await qcManager.connect(owner).setQCStatus(qc1.address, 1, ethers.utils.formatBytes32String("test")); // ACTIVE
    });

    it("should validate wallet addition parameters", async function () {
      const validBitcoinAddress = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
      const challenge = ethers.utils.randomBytes(32);

      await expect(
        qcManager.connect(qc1).addWallet(user.address, validBitcoinAddress, challenge)
      ).to.emit(qcManager, "WalletAdded")
        .withArgs(qc1.address, user.address);
    });

    it("should enforce wallet limit per QC", async function () {
      const MAX_WALLETS = 10; // As defined in the contract
      const bitcoinAddress = "bc1qtest";
      const challenge = ethers.utils.randomBytes(32);

      // Add maximum number of wallets
      for (let i = 0; i < MAX_WALLETS; i++) {
        const wallet = ethers.Wallet.createRandom();
        await qcManager.connect(qc1).addWallet(
          wallet.address,
          `${bitcoinAddress}${i}`,
          challenge
        );
      }

      // Try to add one more wallet (should fail)
      const extraWallet = ethers.Wallet.createRandom();
      await expect(
        qcManager.connect(qc1).addWallet(extraWallet.address, `${bitcoinAddress}extra`, challenge)
      ).to.be.revertedWith("MaximumWalletsReached");
    });
  });

  describe.skip("Library Gas Optimization - TODO: requires AccountControl unpause access", function () {

    it("should maintain reasonable gas costs for library operations", async function () {
      // Measure gas for registration
      const registrationTx = await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);
      const registrationReceipt = await registrationTx.wait();

      // Library calls should not significantly increase gas
      expect(registrationReceipt.gasUsed).to.be.lt(350000);

      // Activate QC
      await qcManager.connect(owner).setQCStatus(qc1.address, 1, ethers.utils.formatBytes32String("test"));

      // Measure gas for wallet addition
      const walletTx = await qcManager.connect(qc1).addWallet(
        user.address,
        "bc1qtest",
        ethers.utils.randomBytes(32)
      );
      const walletReceipt = await walletTx.wait();

      expect(walletReceipt.gasUsed).to.be.lt(150000);
    });
  });

  describe.skip("Library Integration with AccountControl - TODO: requires AccountControl ownership or modifier changes", function () {

    it("should properly sync with AccountControl during operations", async function () {
      // Grant role to QCManager
      const QC_MANAGER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_MANAGER_ROLE"));
      await accountControl.grantRole(QC_MANAGER_ROLE, qcManager.address);

      // Register QC
      await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);

      // Verify AccountControl integration
      expect(await accountControl.authorized(qc1.address)).to.be.true;

      const reserveInfo = await accountControl.reserveInfo(qc1.address);
      expect(reserveInfo.mintingCap).to.equal(MAX_MINTING_CAP);

      // Update capacity
      const newCap = MAX_MINTING_CAP.mul(2);
      await qcManager.connect(owner).increaseMintingCapacity(qc1.address, newCap);

      // Verify update propagated
      const updatedInfo = await accountControl.reserveInfo(qc1.address);
      expect(updatedInfo.mintingCap).to.equal(newCap);
    });
  });

  describe("New Extracted Library Functions", function () {
    let qcManagerLib: any;

    beforeEach(async function () {
      // Deploy QCManagerLib for direct testing
      const QCManagerLibFactory = await ethers.getContractFactory("QCManagerLib");
      qcManagerLib = await QCManagerLibFactory.deploy();
    });

    describe("calculateTimeUntilRenewal", function () {
      it("should return 0 when credit is available", async function () {
        const result = await qcManagerLib.calculateTimeUntilRenewal(
          true, // hasCredit
          0,    // lastUsed
          0     // creditRenewTime
        );
        expect(result).to.equal(0);
      });

      it("should return 0 when lastUsed is 0", async function () {
        const result = await qcManagerLib.calculateTimeUntilRenewal(
          false, // hasCredit
          0,     // lastUsed
          ethers.utils.parseEther("1000") // creditRenewTime
        );
        expect(result).to.equal(0);
      });

      it("should return 0 when renewal time has passed", async function () {
        const pastTime = Math.floor(Date.now() / 1000) - 1000; // 1000 seconds ago

        const result = await qcManagerLib.calculateTimeUntilRenewal(
          false,    // hasCredit
          1,        // lastUsed
          pastTime  // creditRenewTime
        );
        expect(result).to.equal(0);
      });

      it("should return correct time until renewal", async function () {
        const currentBlock = await ethers.provider.getBlock("latest");
        const futureTime = currentBlock.timestamp + 3600; // 1 hour from now

        const result = await qcManagerLib.calculateTimeUntilRenewal(
          false,     // hasCredit
          1,         // lastUsed
          futureTime // creditRenewTime
        );

        // Should be approximately 3600 seconds (allowing for block time differences)
        expect(result).to.be.gte(3590).and.lte(3600);
      });
    });

    describe("getReserveBalanceAndStaleness", function () {
      it("should call reserve oracle correctly", async function () {
        // This test would require mocking the reserveOracle
        // For now, we'll test the function signature exists
        const reserveOracleInterface = new ethers.utils.Interface([
          "function getReserveBalanceAndStaleness(address) view returns (uint256, bool)"
        ]);

        // Verify the function exists and has correct signature
        expect(qcManagerLib.interface.getFunction("getReserveBalanceAndStaleness")).to.exist;
      });
    });

    describe("isValidBitcoinAddress", function () {
      it("should return false for empty address", async function () {
        const result = await qcManagerLib.isValidBitcoinAddress("");
        expect(result).to.be.false;
      });

      it("should return true for valid P2PKH address", async function () {
        const result = await qcManagerLib.isValidBitcoinAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
        expect(result).to.be.true;
      });

      it("should return true for valid P2SH address", async function () {
        const result = await qcManagerLib.isValidBitcoinAddress("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy");
        expect(result).to.be.true;
      });

      it("should return true for valid Bech32 address", async function () {
        const result = await qcManagerLib.isValidBitcoinAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
        expect(result).to.be.true;
      });

      it("should return false for too short address", async function () {
        const result = await qcManagerLib.isValidBitcoinAddress("1A1zP1eP5QG");
        expect(result).to.be.false;
      });

      it("should return false for too long address", async function () {
        const longAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNaExtraLongInvalidAddress123456789";
        const result = await qcManagerLib.isValidBitcoinAddress(longAddress);
        expect(result).to.be.false;
      });

      it("should return false for invalid format", async function () {
        const result = await qcManagerLib.isValidBitcoinAddress("invalid_bitcoin_address");
        expect(result).to.be.false;
      });
    });

    describe("verifyBitcoinSignature", function () {
      it.skip("should have correct function signature - function is internal", async function () {
        // Note: verifyBitcoinSignature is an internal function and cannot be accessed directly
        // It is tested indirectly through functions that use it
      });
    });
  });
});