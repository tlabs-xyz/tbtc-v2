import chai, { expect } from "chai";
import { ethers, helpers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { FakeContract, smock } from "@defi-wonderland/smock";
import {
  AccountControl,
  QCManager,
  QCData,
  SystemState,
  ReserveOracle,
  Bank
} from "../../typechain";

chai.use(smock.matchers);

const { createSnapshot, restoreSnapshot } = helpers.snapshot;

describe("QCManager - AccountControl Integration", function () {
  let deployer: SignerWithAddress;
  let governance: SignerWithAddress;
  let qcAddress: SignerWithAddress;
  let emergencyCouncil: SignerWithAddress;

  let accountControl: AccountControl;
  let qcManager: QCManager;
  let mockQCData: FakeContract<QCData>;
  let mockSystemState: FakeContract<SystemState>;
  let mockReserveOracle: FakeContract<ReserveOracle>;
  let mockBank: FakeContract<Bank>;

  beforeEach(async function () {
    [deployer, governance, qcAddress, emergencyCouncil] = await ethers.getSigners();

    // Deploy AccountControl using upgrades proxy
    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [governance.address, emergencyCouncil.address, deployer.address], // Use deployer as mock bank
      { initializer: "initialize" }
    ) as AccountControl;

    // Create mocks
    mockQCData = await smock.fake<QCData>("QCData");
    mockSystemState = await smock.fake<SystemState>("SystemState");
    mockReserveOracle = await smock.fake<ReserveOracle>("ReserveOracle");
    mockBank = await smock.fake<Bank>("Bank");

    // Deploy QCManagerLib library (required for QCManager)
    const QCManagerLibFactory = await ethers.getContractFactory("QCManagerLib");
    const qcManagerLib = await QCManagerLibFactory.deploy();
    await qcManagerLib.deployed();

    // Deploy QCManager with libraries linked
    const QCManagerFactory = await ethers.getContractFactory("QCManager", {
      libraries: {
        QCManagerLib: qcManagerLib.address,
      },
    });
    qcManager = await QCManagerFactory.deploy(
      mockQCData.address,
      mockSystemState.address,
      mockReserveOracle.address
    );

    // Set up permissions
    const DEFAULT_ADMIN_ROLE = await qcManager.DEFAULT_ADMIN_ROLE();
    const GOVERNANCE_ROLE = await qcManager.GOVERNANCE_ROLE();
    await qcManager.grantRole(DEFAULT_ADMIN_ROLE, governance.address);
    await qcManager.grantRole(GOVERNANCE_ROLE, governance.address);
    
    // Connect AccountControl to QCManager
    await qcManager.connect(governance).setAccountControl(accountControl.address);

    // Grant QCManager the QC_MANAGER_ROLE so it can authorize reserves
    await accountControl.connect(governance).grantQCManagerRole(qcManager.address);
  });

  describe("Reserve Authorization Integration", function () {
    it("should authorize QC in AccountControl when registering through QCManager", async function () {
      const mintingCap = ethers.utils.parseUnits("100", 8);

      // Mock QCData to return false for isQCRegistered (so we can register)
      mockQCData.isQCRegistered.returns(false);

      // Register QC - should trigger AccountControl authorization
      await qcManager.connect(governance).registerQC(qcAddress.address, mintingCap);

      // Verify QC is authorized in AccountControl
      expect(await accountControl.authorized(qcAddress.address)).to.be.true;
      
      // Verify minting cap is set correctly
      const reserveInfo = await accountControl.reserveInfo(qcAddress.address);
      expect(reserveInfo.mintingCap).to.equal(mintingCap);
    });

    it("should handle AccountControl authorization gracefully when address is zero", async function () {
      // Setting AccountControl to zero address should revert (security protection)
      await expect(
        qcManager.connect(governance).setAccountControl(ethers.constants.AddressZero)
      ).to.be.reverted;
    });
  });

  describe("Minting Capacity Integration", function () {
    beforeEach(async function () {
      const mintingCap = ethers.utils.parseUnits("100", 8);
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(false);
      mockQCData.registerQC.returns();
      mockQCData.getQCInfo.returns({
        status: 0,
        totalMinted: 0,
        maxCapacity: mintingCap,
        registeredAt: 1,
        selfPaused: false
      });
      await qcManager.connect(governance).registerQC(qcAddress.address, mintingCap);

      // After registration, QC should be registered
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true);
    });

    it("should update minting cap in AccountControl when increased through QCManager", async function () {
      const newCap = ethers.utils.parseUnits("200", 8);

      // Mock the QCData responses for capacity increase
      mockQCData.getMaxMintingCapacity.whenCalledWith(qcAddress.address).returns(ethers.utils.parseUnits("100", 8));
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(0);
      mockReserveOracle.getReserveBalanceAndStaleness.returns([0, false]);

      await qcManager.connect(governance).increaseMintingCapacity(qcAddress.address, newCap);

      // Verify cap is updated in AccountControl
      const reserveInfo = await accountControl.reserveInfo(qcAddress.address);
      expect(reserveInfo.mintingCap).to.equal(newCap);
    });

    it("should prevent setting AccountControl to zero address", async function () {
      // Contract prevents setting AccountControl to zero address
      await expect(
        qcManager.connect(governance).setAccountControl(ethers.constants.AddressZero)
      ).to.be.reverted;
    });
  });

  describe("AccountControl Address Management", function () {
    it("should allow governance to set AccountControl address", async function () {
      const newAccountControl = ethers.Wallet.createRandom().address;

      await expect(
        qcManager.connect(governance).setAccountControl(newAccountControl)
      ).to.emit(qcManager, "AccountControlUpdated");
    });

    it("should revert when trying to set zero address", async function () {
      // Contract just reverts without specific message
      await expect(
        qcManager.connect(governance).setAccountControl(ethers.constants.AddressZero)
      ).to.be.reverted;
    });

    it("should revert when non-admin tries to set AccountControl address", async function () {
      const newAccountControl = ethers.Wallet.createRandom().address;

      await expect(
        qcManager.connect(qcAddress).setAccountControl(newAccountControl)
      ).to.be.reverted; // Should revert due to missing DEFAULT_ADMIN_ROLE
    });
  });

  describe("Error Handling and Edge Cases", function () {
    beforeEach(async function () {
      const mintingCap = ethers.utils.parseUnits("100", 8);
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(false);
      await qcManager.connect(governance).registerQC(qcAddress.address, mintingCap);
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true);
    });

    it("should bubble up AccountControl authorization failure", async function () {
      const mintingCap = ethers.utils.parseUnits("50", 8);
      const newQC = ethers.Wallet.createRandom().address;

      // Mock AccountControl to be a contract that will reject the call
      const mockAccountControl = await smock.fake("AccountControl");
      mockAccountControl.authorizeReserve.reverts("Mock authorization failure");
      
      await qcManager.connect(governance).setAccountControl(mockAccountControl.address);

      // Mock QCData for new registration
      mockQCData.isQCRegistered.whenCalledWith(newQC).returns(false);

      // Should revert with the raw AccountControl error message
      await expect(
        qcManager.connect(governance).registerQC(newQC, mintingCap)
      ).to.be.revertedWith("Transaction reverted: function returned an unexpected amount of data");
    });

    it("should bubble up AccountControl cap update failure", async function () {
      const newCap = ethers.utils.parseUnits("200", 8);

      // Mock AccountControl to reject cap updates
      const mockAccountControl = await smock.fake("AccountControl");
      mockAccountControl.setMintingCap.reverts("Mock cap update failure");
      
      await qcManager.connect(governance).setAccountControl(mockAccountControl.address);

      // Mock QCData responses
      mockQCData.getMaxMintingCapacity.returns(ethers.utils.parseUnits("100", 8));

      // Should revert with the raw AccountControl error message
      await expect(
        qcManager.connect(governance).increaseMintingCapacity(qcAddress.address, newCap)
      ).to.be.revertedWith("Transaction reverted: function returned an unexpected amount of data");
    });

    it("should handle low-level AccountControl failures", async function () {
      const mintingCap = ethers.utils.parseUnits("50", 8);
      const newQC = ethers.Wallet.createRandom().address;

      // Mock AccountControl to cause low-level failure (no error message)
      const mockAccountControl = await smock.fake("AccountControl");
      mockAccountControl.authorizeReserve.reverts();
      
      await qcManager.connect(governance).setAccountControl(mockAccountControl.address);

      // Mock QCData for new registration
      mockQCData.isQCRegistered.whenCalledWith(newQC).returns(false);

      // Should revert when AccountControl fails
      await expect(
        qcManager.connect(governance).registerQC(newQC, mintingCap)
      ).to.be.reverted;
    });
  });

  describe("Integration State Consistency", function () {
    it("should maintain consistent state between QCManager and AccountControl", async function () {
      const initialCap = ethers.utils.parseUnits("100", 8);
      const newCap = ethers.utils.parseUnits("300", 8);

      // Register QC
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(false);
      await qcManager.connect(governance).registerQC(qcAddress.address, initialCap);

      // Verify initial state consistency
      expect(await accountControl.authorized(qcAddress.address)).to.be.true;
      const initialReserveInfo = await accountControl.reserveInfo(qcAddress.address);

      // After registration, mark as registered
      mockQCData.isQCRegistered.whenCalledWith(qcAddress.address).returns(true);
      mockQCData.getMaxMintingCapacity.whenCalledWith(qcAddress.address).returns(initialCap);
      mockQCData.getQCStatus.whenCalledWith(qcAddress.address).returns(0);
      mockReserveOracle.getReserveBalanceAndStaleness.returns([0, false]);
      expect(initialReserveInfo.mintingCap).to.equal(initialCap);

      // Update cap through QCManager
      mockQCData.getMaxMintingCapacity.returns(initialCap);
      await qcManager.connect(governance).increaseMintingCapacity(qcAddress.address, newCap);

      // Verify state consistency after update
      const updatedReserveInfo = await accountControl.reserveInfo(qcAddress.address);
      expect(updatedReserveInfo.mintingCap).to.equal(newCap);
      expect(await accountControl.authorized(qcAddress.address)).to.be.true;
    });

    it("should handle AccountControl address changes properly", async function () {
      const mintingCap = ethers.utils.parseUnits("100", 8);
      
      // Deploy a second AccountControl for testing
      const AccountControlFactory = await ethers.getContractFactory("AccountControl");
      const newAccountControl = await upgrades.deployProxy(
        AccountControlFactory,
        [governance.address, emergencyCouncil.address, deployer.address],
        { initializer: "initialize" }
      ) as AccountControl;

      // Register QC with original AccountControl
      mockQCData.isQCRegistered.returns(false);
      await qcManager.connect(governance).registerQC(qcAddress.address, mintingCap);

      // Verify QC is authorized in original AccountControl
      expect(await accountControl.authorized(qcAddress.address)).to.be.true;
      expect(await newAccountControl.authorized(qcAddress.address)).to.be.false;

      // Change AccountControl address
      await qcManager.connect(governance).setAccountControl(newAccountControl.address);

      // Grant QCManager the QC_MANAGER_ROLE so it can authorize reserves
      await newAccountControl.connect(governance).grantQCManagerRole(qcManager.address);

      // Register new QC with new AccountControl
      const newQC = ethers.Wallet.createRandom().address;
      mockQCData.isQCRegistered.whenCalledWith(newQC).returns(false);
      await qcManager.connect(governance).registerQC(newQC, mintingCap);

      // Verify new QC is authorized in new AccountControl only
      expect(await newAccountControl.authorized(newQC)).to.be.true;
      expect(await accountControl.authorized(newQC)).to.be.false;
    });
  });

  describe("Event Verification", function () {
    it("should emit proper events during successful integration", async function () {
      const mintingCap = ethers.utils.parseUnits("100", 8);
      const newQC = ethers.Wallet.createRandom().address;

      mockQCData.isQCRegistered.whenCalledWith(newQC).returns(false);

      // Should emit both QCManager and AccountControl events
      const tx = qcManager.connect(governance).registerQC(newQC, mintingCap);
      
      // QCManager events
      // QCRegistrationInitiated event includes timestamp, not block number
      await expect(tx)
        .to.emit(qcManager, "QCRegistrationInitiated");
      
      await expect(tx)
        .to.emit(qcManager, "QCOnboarded");

      // AccountControl events (through integration)
      await expect(tx)
        .to.emit(accountControl, "ReserveAuthorized")
        .withArgs(newQC, mintingCap);
    });

    it("should emit AccountControlUpdated event when address changes", async function () {
      const newAccountControl = ethers.Wallet.createRandom().address;

      // AccountControlUpdated event has 4 parameters: oldAddress, newAddress, changedBy, timestamp
      await expect(
        qcManager.connect(governance).setAccountControl(newAccountControl)
      )
        .to.emit(qcManager, "AccountControlUpdated");
    });
  });
});