import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  QCData,
  QCManager,
  QCPauseManager,
  AccountControl,
  SystemState,
  ReserveOracle,
  MockBank
} from "../../typechain";

describe("QCManagerLib - Consolidated Tests", function () {
  let qcManager: QCManager;
  let qcManagerLib: any;
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
  let governance: SignerWithAddress;
  let registrar: SignerWithAddress;

  const MAX_MINTING_CAP = ethers.utils.parseUnits("100", 8); // 100 BTC in satoshis
  const ZERO_ADDRESS = ethers.constants.AddressZero;

  beforeEach(async function () {
    [owner, qc1, qc2, user, attester1, governance, registrar] = await ethers.getSigners();

    // Deploy mock bank
    const MockBankFactory = await ethers.getContractFactory("MockBank");
    mockBank = await MockBankFactory.deploy();

    // Deploy core contracts
    const QCDataFactory = await ethers.getContractFactory("QCData");
    qcData = await QCDataFactory.deploy();

    const SystemStateFactory = await ethers.getContractFactory("SystemState");
    systemState = await SystemStateFactory.deploy();

    const MockReserveOracle = await ethers.getContractFactory("MockReserveOracle");
    reserveOracle = await MockReserveOracle.deploy();

    // Deploy QCManagerLib library
    const QCManagerLibFactory = await ethers.getContractFactory("QCManagerLib");
    qcManagerLib = await QCManagerLibFactory.deploy();

    // Deploy QCPauseManager first
    const QCPauseManagerFactory = await ethers.getContractFactory("QCPauseManager");
    const pauseManager = await QCPauseManagerFactory.deploy(
      qcData.address,
      owner.address, // Temporary QCManager address
      owner.address, // Admin
      owner.address  // Emergency role
    );

    // Deploy QCManager with libraries linked
    const QCManagerFactory = await ethers.getContractFactory("QCManager", {
      libraries: {
        QCManagerLib: qcManagerLib.address,
      },
    });
    qcManager = await QCManagerFactory.deploy(
      qcData.address,
      systemState.address,
      reserveOracle.address,
      pauseManager.address
    );

    // Grant QC_MANAGER_ROLE to the real QCManager
    const QC_MANAGER_ROLE = await pauseManager.QC_MANAGER_ROLE();
    await pauseManager.grantRole(QC_MANAGER_ROLE, qcManager.address);
    await pauseManager.revokeRole(QC_MANAGER_ROLE, owner.address);

    // Grant QCManager the emergency role for forwarding calls
    await pauseManager.grantRole(await pauseManager.EMERGENCY_ROLE(), qcManager.address);

    // Deploy AccountControl using upgrades proxy
    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [owner.address, owner.address, mockBank.address],
      { initializer: "initialize" }
    ) as AccountControl;

    // Setup roles for QCData
    const QC_MANAGER_ROLE_DATA = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_MANAGER_ROLE"));
    await qcData.grantRole(QC_MANAGER_ROLE_DATA, qcManager.address);

    // Grant governance role to owner for QCManager operations
    const GOVERNANCE_ROLE = await qcManager.GOVERNANCE_ROLE();
    await qcManager.grantRole(GOVERNANCE_ROLE, owner.address);
    await qcManager.grantRole(GOVERNANCE_ROLE, governance.address);

    // Grant registrar role
    const REGISTRAR_ROLE = await qcManager.REGISTRAR_ROLE();
    await qcManager.grantRole(REGISTRAR_ROLE, registrar.address);

    // Set AccountControl in QCManager
    await qcManager.connect(owner).setAccountControl(accountControl.address);

    // Grant QCManager the QC_MANAGER_ROLE in AccountControl
    await accountControl.connect(owner).grantQCManagerRole(qcManager.address);

    // Set QCManager as emergencyCouncil for pauseReserve operations
    await accountControl.connect(owner).setEmergencyCouncil(qcManager.address);
  });

  describe("Core Library Functions", function () {
    describe("Library Error Validation", function () {
      it("should revert with InvalidQCAddress when registering zero address", async function () {
        await expect(
          qcManager.connect(owner).registerQC(ZERO_ADDRESS, MAX_MINTING_CAP)
        ).to.be.revertedWithCustomError(qcManager, "InvalidQCAddress");
      });

      it("should revert with InvalidMintingCapacity when capacity is zero", async function () {
        await expect(
          qcManager.connect(owner).registerQC(qc1.address, 0)
        ).to.be.revertedWithCustomError(qcManager, "InvalidMintingCapacity");
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

      it("should revert with InvalidStatusTransition for invalid status changes", async function () {
        await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);

        // Grant DISPUTE_ARBITER_ROLE to owner for status transitions
        const DISPUTE_ARBITER_ROLE = await qcManager.DISPUTE_ARBITER_ROLE();
        await qcManager.grantRole(DISPUTE_ARBITER_ROLE, owner.address);
        
        // First set to UnderReview(3)
        await qcManager.connect(owner).setQCStatus(qc1.address, 3, ethers.utils.formatBytes32String("test"));
        
        // Try to transition from UnderReview(3) to MintingPaused(1) - this is invalid
        await expect(
          qcManager.connect(owner).setQCStatus(qc1.address, 1, ethers.utils.formatBytes32String("test"))
        ).to.be.revertedWithCustomError(qcManager, "InvalidStatusTransition");
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
        const QC_MANAGER_ROLE_AC = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_MANAGER_ROLE"));
        await accountControl.grantRole(QC_MANAGER_ROLE_AC, qcManager.address);

        await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);

        expect(await accountControl.authorized(qc1.address)).to.be.true;
      });
    });

    describe("Library Status Validation", function () {
      beforeEach(async function () {
        await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);
      });

      it("should validate status transitions correctly", async function () {
        // Grant DISPUTE_ARBITER_ROLE to owner for setQCStatus
        const DISPUTE_ARBITER_ROLE = await qcManager.DISPUTE_ARBITER_ROLE();
        await qcManager.grantRole(DISPUTE_ARBITER_ROLE, owner.address);

        // QC already registered in beforeEach with Active(0) status

        // Valid: Active(0) -> MintingPaused(1)
        const tx = await qcManager.connect(owner).setQCStatus(qc1.address, 1, ethers.utils.formatBytes32String("test"));
        const receipt = await tx.wait();
        
        // Find the QCStatusChanged event
        const event = receipt.events?.find(e => e.event === "QCStatusChanged");
        expect(event).to.not.be.undefined;
        expect(event?.args?.qc).to.equal(qc1.address);
        expect(event?.args?.oldStatus).to.equal(0);
        expect(event?.args?.newStatus).to.equal(1);

        // Valid: MintingPaused(1) -> UnderReview(3)
        await expect(
          qcManager.connect(owner).setQCStatus(qc1.address, 3, ethers.utils.formatBytes32String("test"))
        ).to.emit(qcManager, "QCStatusChanged");
      });
    });

    describe("Library Gas Optimization", function () {
      it("should maintain reasonable gas costs for library operations", async function () {
        // Measure gas for registration
        const registrationTx = await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP);
        const registrationReceipt = await registrationTx.wait();

        // Library calls should not significantly increase gas
        expect(registrationReceipt.gasUsed).to.be.lt(350000);

        // Grant DISPUTE_ARBITER_ROLE to owner for status transitions
        const DISPUTE_ARBITER_ROLE = await qcManager.DISPUTE_ARBITER_ROLE();
        await qcManager.grantRole(DISPUTE_ARBITER_ROLE, owner.address);

        // Measure gas for status change
        const statusChangeTx = await qcManager.connect(owner).setQCStatus(qc1.address, 1, ethers.utils.formatBytes32String("test"));
        const statusChangeReceipt = await statusChangeTx.wait();

        expect(statusChangeReceipt.gasUsed).to.be.lt(150000);
      });
    });

    describe("Library Integration with AccountControl", function () {
      it("should properly sync with AccountControl during operations", async function () {
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
  });

  describe("Integration Testing", function () {
    describe("Library Linking Verification", function () {
      it("should have QCManagerLib properly linked", async function () {
        // Verify library is deployed
        expect(qcManagerLib.address).to.not.equal(ethers.constants.AddressZero);

        // Verify QCManager can call library functions through delegatecall
        // This is implicit in the working of extracted functions
      });

      it("should verify contract sizes are within limits", async function () {
        // Get deployed bytecode size
        const qcManagerCode = await ethers.provider.getCode(qcManager.address);
        const qcManagerSize = (qcManagerCode.length - 2) / 2; // Remove 0x and divide by 2 for bytes

        const qcManagerLibCode = await ethers.provider.getCode(qcManagerLib.address);
        const qcManagerLibSize = (qcManagerLibCode.length - 2) / 2;

        // Uncomment to see contract sizes
        // console.log(`QCManager size: ${qcManagerSize} bytes`);
        // console.log(`QCManagerLib size: ${qcManagerLibSize} bytes`);

        // Verify sizes are under EIP-170 limit
        expect(qcManagerSize).to.be.lessThan(24576, "QCManager exceeds size limit");
        expect(qcManagerLibSize).to.be.lessThan(24576, "QCManagerLib exceeds size limit");
      });
    });

    describe("Basic Integration Tests", function () {
      it("should integrate with QCData for basic QC operations", async function () {
        const mintingCap = ethers.utils.parseEther("1000000");

        // Register QC
        await qcManager.connect(governance).registerQC(qc1.address, mintingCap);

        // Get QC info to verify integration
        const qcInfo = await qcData.getQCInfo(qc1.address);
        expect(qcInfo.maxCapacity).to.equal(mintingCap);
        expect(qcInfo.status).to.equal(0); // Active
      });

      it("should handle library error propagation", async function () {
        // Try to register QC with zero address
        await expect(
          qcManager.connect(governance).registerQC(
            ethers.constants.AddressZero,
            ethers.utils.parseEther("1000000")
          )
        ).to.be.revertedWithCustomError(qcManager, "InvalidQCAddress");

        // Try to register with zero capacity
        await expect(
          qcManager.connect(governance).registerQC(
            qc1.address,
            0
          )
        ).to.be.revertedWithCustomError(qcManager, "InvalidMintingCapacity");
      });
    });
  });

  describe("Extracted Functions", function () {
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

    describe("getReserveBalanceAndStaleness", function () {
      it("should have correct function signature", async function () {
        // Verify the function exists and has correct signature
        expect(qcManagerLib.interface.getFunction("getReserveBalanceAndStaleness")).to.exist;

        const func = qcManagerLib.interface.getFunction("getReserveBalanceAndStaleness");
        expect(func.inputs).to.have.length(2); // reserveOracle and qc
        expect(func.outputs).to.have.length(2); // balance and isStale
      });
    });

    describe("verifyBitcoinSignature", function () {
      // Note: verifyBitcoinSignature is an internal function and cannot be accessed directly
      // It is tested indirectly through functions that use it
    });
  });

});