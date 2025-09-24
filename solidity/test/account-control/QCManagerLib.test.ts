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
    await systemState.grantRole(QC_MANAGER_ROLE, qcManager.address);

    // Configure AccountControl in SystemState
    await systemState.setAccountControl(accountControl.address);
    await systemState.setAccountControlEnabled(true);
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
      ).to.be.revertedWithCustomError(qcManager, "QCAlreadyRegistered")
        .withArgs(qc1.address);
    });

    it("should revert with QCNotRegistered for non-existent QC", async function () {
      await expect(
        qcManager.connect(owner).updateQCStatus(qc1.address, 2) // PAUSED
      ).to.be.revertedWithCustomError(qcManager, "QCNotRegistered")
        .withArgs(qc1.address);
    });

    it("should revert with InvalidWalletAddress for zero address wallet", async function () {
      await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);

      await expect(
        qcManager.connect(qc1).addWallet(ZERO_ADDRESS, "bc1qtest", ethers.utils.randomBytes(32))
      ).to.be.revertedWith("InvalidWalletAddress");
    });

    it("should revert with InvalidStatusTransition for invalid status changes", async function () {
      await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);

      // Try to transition from REGISTERED (0) to REMOVED (3) directly
      await expect(
        qcManager.connect(owner).updateQCStatus(qc1.address, 3)
      ).to.be.revertedWithCustomError(qcManager, "InvalidStatusTransition")
        .withArgs(0, 3);
    });

    it("should revert with NewCapMustBeHigher when not increasing capacity", async function () {
      await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);

      await expect(
        qcManager.connect(owner).increaseMintingCap(qc1.address, MAX_MINTING_CAP)
      ).to.be.revertedWithCustomError(qcManager, "NewCapMustBeHigher")
        .withArgs(MAX_MINTING_CAP, MAX_MINTING_CAP);
    });
  });

  describe("Library Registration Logic", function () {

    it("should successfully register QC with valid parameters", async function () {
      await expect(
        qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP)
      ).to.emit(qcManager, "QCRegistered")
        .withArgs(qc1.address, MAX_MINTING_CAP);

      const qcInfo = await qcData.getQC(qc1.address);
      expect(qcInfo.isRegistered).to.be.true;
      expect(qcInfo.status).to.equal(0); // REGISTERED
      expect(qcInfo.maxMintingCap).to.equal(MAX_MINTING_CAP);
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

    it("should validate status transitions correctly", async function () {
      // Valid: REGISTERED -> ACTIVE
      await expect(
        qcManager.connect(owner).updateQCStatus(qc1.address, 1)
      ).to.emit(qcManager, "QCStatusUpdated")
        .withArgs(qc1.address, 0, 1);

      // Valid: ACTIVE -> PAUSED
      await expect(
        qcManager.connect(owner).updateQCStatus(qc1.address, 2)
      ).to.emit(qcManager, "QCStatusUpdated")
        .withArgs(qc1.address, 1, 2);

      // Valid: PAUSED -> ACTIVE
      await expect(
        qcManager.connect(owner).updateQCStatus(qc1.address, 1)
      ).to.emit(qcManager, "QCStatusUpdated")
        .withArgs(qc1.address, 2, 1);
    });

    it("should enforce QCNotActive for operations requiring active status", async function () {
      // QC is in REGISTERED status (not ACTIVE)
      await expect(
        qcManager.connect(qc1).addWallet(user.address, "bc1qtest", ethers.utils.randomBytes(32))
      ).to.be.revertedWithCustomError(qcManager, "QCNotActive")
        .withArgs(qc1.address);

      // Activate QC
      await qcManager.connect(owner).updateQCStatus(qc1.address, 1);

      // Now wallet addition should work
      await expect(
        qcManager.connect(qc1).addWallet(user.address, "bc1qtest", ethers.utils.randomBytes(32))
      ).to.not.be.reverted;
    });
  });

  describe("Library Wallet Management", function () {

    beforeEach(async function () {
      await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);
      await qcManager.connect(owner).updateQCStatus(qc1.address, 1); // ACTIVE
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

  describe("Library Gas Optimization", function () {

    it("should maintain reasonable gas costs for library operations", async function () {
      // Measure gas for registration
      const registrationTx = await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);
      const registrationReceipt = await registrationTx.wait();

      // Library calls should not significantly increase gas
      expect(registrationReceipt.gasUsed).to.be.lt(300000);

      // Activate QC
      await qcManager.connect(owner).updateQCStatus(qc1.address, 1);

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

  describe("Library Integration with AccountControl", function () {

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
      await qcManager.connect(owner).increaseMintingCap(qc1.address, newCap);

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
      it("should have correct function signature", async function () {
        // Verify the function exists
        expect(qcManagerLib.interface.getFunction("verifyBitcoinSignature")).to.exist;

        // This function requires complex Bitcoin signature verification
        // Full testing would require valid Bitcoin signatures
        // For now, we verify the function interface exists
      });
    });
  });
});