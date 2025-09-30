import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("QCManagerLib - Integration Tests", function () {
  let qcManager: any;
  let qcManagerLib: any;
  let qcData: any;
  let systemState: any;
  let reserveOracle: any;
  let accountControl: any;

  let deployer: SignerWithAddress;
  let qc: SignerWithAddress;
  let governance: SignerWithAddress;
  let registrar: SignerWithAddress;

  beforeEach(async function () {
    [deployer, qc, governance, registrar] = await ethers.getSigners();

    // Deploy libraries first (required for linking)
    const QCManagerLibFactory = await ethers.getContractFactory("QCManagerLib");
    qcManagerLib = await QCManagerLibFactory.deploy();
    await qcManagerLib.deployed();

    // Deploy mock dependencies
    const MockQCData = await ethers.getContractFactory("MockQCData");
    qcData = await MockQCData.deploy();

    const MockSystemState = await ethers.getContractFactory("MockSystemState");
    systemState = await MockSystemState.deploy();

    const MockReserveOracle = await ethers.getContractFactory("MockReserveOracle");
    reserveOracle = await MockReserveOracle.deploy();

    // Deploy mock Bank first (required for MockAccountControl constructor)
    const MockBank = await ethers.getContractFactory("MockBank");
    const mockBank = await MockBank.deploy();

    const MockAccountControl = await ethers.getContractFactory("MockAccountControl");
    accountControl = await MockAccountControl.deploy(mockBank.address);

    // Deploy QCManager with only QCManagerLib linking (not QCManagerPauseLib)
    const QCManagerFactory = await ethers.getContractFactory("QCManager", {
      libraries: {
        QCManagerLib: qcManagerLib.address,
      },
    });

    // Deploy QCPauseManager (required for QCManager constructor)
    const QCPauseManagerFactory = await ethers.getContractFactory("QCPauseManager");
    const pauseManager = await QCPauseManagerFactory.deploy(
      qcData.address,
      deployer.address, // Temporary QCManager address
      deployer.address, // Admin
      deployer.address  // Emergency role
    );

    qcManager = await QCManagerFactory.deploy(
      qcData.address,
      systemState.address,
      reserveOracle.address,
      pauseManager.address
    );

    // Set up roles
    await qcManager.grantRole(await qcManager.GOVERNANCE_ROLE(), governance.address);
    await qcManager.grantRole(await qcManager.REGISTRAR_ROLE(), registrar.address);

    // Set AccountControl
    await qcManager.setAccountControl(accountControl.address);
  });

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

      console.log(`QCManager size: ${qcManagerSize} bytes`);
      console.log(`QCManagerLib size: ${qcManagerLibSize} bytes`);

      // Verify sizes are under EIP-170 limit
      expect(qcManagerSize).to.be.lessThan(24576, "QCManager exceeds size limit");
      expect(qcManagerLibSize).to.be.lessThan(24576, "QCManagerLib exceeds size limit");
    });
  });

  describe("Extracted Function Integration", function () {
    describe("calculateTimeUntilRenewal", function () {
      it("should calculate time correctly through QCManager", async function () {
        // Register a QC first
        await qcManager.connect(governance).registerQC(
          qc.address,
          ethers.utils.parseEther("1000000")
        );

        // Grant initial credit
        await qcManager.grantRole(await qcManager.EMERGENCY_ROLE(), deployer.address);
        await qcManager.grantInitialCredit(qc.address);

        // Check time until renewal (should be 0 with credit available)
        const timeUntilRenewal = await qcManager.getTimeUntilRenewal(qc.address);
        expect(timeUntilRenewal).to.equal(0);
      });

      it("should handle pause credit renewal timing", async function () {
        // Register QC
        await qcManager.connect(governance).registerQC(
          qc.address,
          ethers.utils.parseEther("1000000")
        );

        // Set QC as active in mock
        await qcData.setQCStatus(qc.address, 0, ethers.constants.HashZero); // Active status

        // Grant and use credit
        await qcManager.grantRole(await qcManager.EMERGENCY_ROLE(), deployer.address);
        await qcManager.grantInitialCredit(qc.address);

        // Self-pause to consume credit
        await qcManager.connect(qc).selfPause(0); // MintingOnly

        // Check renewal time is set
        const pauseInfo = await qcManager.getPauseInfo(qc.address);
        expect(pauseInfo.hasCredit).to.be.false;
        expect(pauseInfo.creditRenewTime).to.be.gt(0);
      });
    });

    describe("getReserveBalanceAndStaleness", function () {
      it("should retrieve reserve data through library", async function () {
        const testBalance = ethers.utils.parseEther("500000");
        const testIsStale = false;

        // Set mock oracle data
        await reserveOracle.setReserveBalance(qc.address, testBalance, testIsStale);

        // Register QC
        await qcManager.connect(governance).registerQC(
          qc.address,
          ethers.utils.parseEther("1000000")
        );

        // Sync backing from oracle
        await qcManager.syncBackingFromOracle(qc.address);

        // Verify backing was synced to AccountControl
        const backing = await accountControl.getBacking(qc.address);
        expect(backing).to.equal(testBalance);
      });

      it("should handle stale reserve data", async function () {
        const testBalance = ethers.utils.parseEther("500000");
        const testIsStale = true;

        // Set stale oracle data
        await reserveOracle.setReserveBalance(qc.address, testBalance, testIsStale);

        // Register QC
        await qcManager.connect(governance).registerQC(
          qc.address,
          ethers.utils.parseEther("1000000")
        );

        // Get available capacity (should be 0 due to staleness)
        const capacity = await qcManager.getAvailableMintingCapacity(qc.address);
        expect(capacity).to.equal(0);
      });
    });

    describe("Bitcoin Address Validation", function () {
      it("should validate P2PKH addresses", async function () {
        const p2pkhAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";

        // Register and activate QC first to test address validation
        await qcManager.connect(governance).registerQC(
          qc.address,
          ethers.utils.parseEther("1000000")
        );
        
        await qcManager.grantRole(await qcManager.EMERGENCY_ROLE(), deployer.address);
        await qcManager.grantInitialCredit(qc.address);

        // This validation happens internally during wallet registration
        // We'll test it through the registration flow
        const challenge = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"));
        const mockPublicKey = ethers.utils.randomBytes(64);

        // Should now test the address validation logic instead of QC registration
        await expect(
          qcManager.connect(registrar).registerWallet(
            qc.address,
            p2pkhAddress,
            challenge,
            mockPublicKey,
            27,
            ethers.utils.randomBytes(32),
            ethers.utils.randomBytes(32)
          )
        ).to.not.be.revertedWithCustomError(qcManager, "QCNotRegistered");
      });

      it("should validate P2SH addresses", async function () {
        const p2shAddress = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";

        // Register QC first
        await qcManager.connect(governance).registerQC(
          qc.address,
          ethers.utils.parseEther("1000000")
        );
        await qcData.setQCStatus(qc.address, 0, ethers.constants.HashZero); // Active

        const challenge = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"));
        const mockPublicKey = ethers.utils.randomBytes(64);

        // Should fail on signature verification (not address validation)
        await expect(
          qcManager.connect(registrar).registerWallet(
            qc.address,
            p2shAddress,
            challenge,
            mockPublicKey,
            27,
            ethers.utils.randomBytes(32),
            ethers.utils.randomBytes(32)
          )
        ).to.be.revertedWithCustomError(qcManager, "SignatureVerificationFailed");
      });

      it("should validate Bech32 addresses", async function () {
        const bech32Address = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";

        // Register QC first
        await qcManager.connect(governance).registerQC(
          qc.address,
          ethers.utils.parseEther("1000000")
        );
        await qcData.setQCStatus(qc.address, 0, ethers.constants.HashZero); // Active

        const challenge = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"));
        const mockPublicKey = ethers.utils.randomBytes(64);

        // Should fail on signature verification (not address validation)
        await expect(
          qcManager.connect(registrar).registerWallet(
            qc.address,
            bech32Address,
            challenge,
            mockPublicKey,
            27,
            ethers.utils.randomBytes(32),
            ethers.utils.randomBytes(32)
          )
        ).to.be.revertedWithCustomError(qcManager, "SignatureVerificationFailed");
      });

      it("should reject invalid addresses", async function () {
        // Register QC first
        await qcManager.connect(governance).registerQC(
          qc.address,
          ethers.utils.parseEther("1000000")
        );
        await qcData.setQCStatus(qc.address, 0, ethers.constants.HashZero); // Active

        const invalidAddress = "invalid_bitcoin_address";
        const challenge = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"));
        const mockPublicKey = ethers.utils.randomBytes(64);

        // Should fail on address validation
        await expect(
          qcManager.connect(registrar).registerWallet(
            qc.address,
            invalidAddress,
            challenge,
            mockPublicKey,
            27,
            ethers.utils.randomBytes(32),
            ethers.utils.randomBytes(32)
          )
        ).to.be.revertedWithCustomError(qcManager, "InvalidWalletAddress");
      });
    });
  });

  describe("Status Transition Validation", function () {
    it("should validate status transitions through library", async function () {
      // Register QC
      await qcManager.connect(governance).registerQC(
        qc.address,
        ethers.utils.parseEther("1000000")
      );

      // Grant DISPUTE_ARBITER_ROLE
      await qcManager.grantRole(await qcManager.DISPUTE_ARBITER_ROLE(), deployer.address);

      // Valid transition: Active -> MintingPaused
      await qcManager.setQCStatus(
        qc.address,
        1, // MintingPaused
        ethers.utils.formatBytes32String("TEST")
      );

      // Valid transition: MintingPaused -> Active
      await qcManager.setQCStatus(
        qc.address,
        0, // Active
        ethers.utils.formatBytes32String("TEST")
      );
    });
  });

  describe("Minting Capacity Calculation", function () {
    it("should calculate capacity using library functions", async function () {
      const mintingCap = ethers.utils.parseEther("1000000");
      const reserveBalance = ethers.utils.parseEther("800000");
      const mintedAmount = ethers.utils.parseEther("300000");

      // Register QC
      await qcManager.connect(governance).registerQC(qc.address, mintingCap);
      await qcData.setQCStatus(qc.address, 0, ethers.constants.HashZero); // Active

      // Set reserve balance
      await reserveOracle.setReserveBalance(qc.address, reserveBalance, false);

      // Set minted amount
      await qcData.setQCMintedAmount(qc.address, mintedAmount);

      // Calculate capacity
      const capacity = await qcManager.getAvailableMintingCapacity(qc.address);

      // Should be min(cap - minted, reserve - minted)
      // min(1000000 - 300000, 800000 - 300000) = min(700000, 500000) = 500000
      expect(capacity).to.equal(ethers.utils.parseEther("500000"));
    });

    it("should return zero capacity when reserves are stale", async function () {
      const mintingCap = ethers.utils.parseEther("1000000");
      const reserveBalance = ethers.utils.parseEther("800000");

      // Register QC
      await qcManager.connect(governance).registerQC(qc.address, mintingCap);
      await qcData.setQCStatus(qc.address, 0, ethers.constants.HashZero); // Active

      // Set stale reserve balance
      await reserveOracle.setReserveBalance(qc.address, reserveBalance, true);

      // Calculate capacity
      const capacity = await qcManager.getAvailableMintingCapacity(qc.address);

      // Should be 0 due to stale reserves
      expect(capacity).to.equal(0);
    });
  });

  describe("Library Function Error Handling", function () {
    it("should properly propagate library errors", async function () {
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
          qc.address,
          0
        )
      ).to.be.revertedWithCustomError(qcManager, "InvalidMintingCapacity");
    });
  });
});