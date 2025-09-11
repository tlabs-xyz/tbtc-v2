import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { AccountControl } from "../../typechain";

describe("Reserve Type System", function () {
  let accountControl: AccountControl;
  let owner: SignerWithAddress;
  let emergencyCouncil: SignerWithAddress;
  let mockBank: any;
  let qc1: SignerWithAddress;
  let qc2: SignerWithAddress;
  let l2Bridge: SignerWithAddress;
  let mockReserveOracle: any;

  beforeEach(async function () {
    [owner, emergencyCouncil, qc1, qc2, l2Bridge] = await ethers.getSigners();

    // Deploy MockBank
    const MockBankFactory = await ethers.getContractFactory("MockBankEnhanced");
    mockBank = await MockBankFactory.deploy();

    // Deploy MockReserveOracle
    const MockReserveOracleFactory = await ethers.getContractFactory("MockReserveOracle");
    mockReserveOracle = await MockReserveOracleFactory.deploy();

    const AccountControlFactory = await ethers.getContractFactory("AccountControl");
    accountControl = await upgrades.deployProxy(
      AccountControlFactory,
      [owner.address, emergencyCouncil.address, mockBank.address],
      { initializer: "initialize" }
    ) as AccountControl;

    // Setup ReserveOracle integration
    await accountControl.connect(owner).setReserveOracle(mockReserveOracle.address);
    await mockReserveOracle.setAccountControl(accountControl.address);

    // Initialize reserve types
    await accountControl.connect(owner).addReserveType("qc");
    await accountControl.connect(owner).addReserveType("allowlisted");
    await accountControl.connect(owner).addReserveType("l2-bridge");
  });

  describe("Reserve Type Management", function () {
    it("should allow adding new reserve types", async function () {
      await expect(
        accountControl.connect(owner).addReserveType("defi-protocol")
      ).to.emit(accountControl, "ReserveTypeAdded").withArgs("defi-protocol");

      expect(await accountControl.validReserveTypes("defi-protocol")).to.be.true;
      expect(await accountControl.getReserveTypeCount()).to.equal(4);
    });

    it("should prevent adding duplicate reserve types", async function () {
      await expect(
        accountControl.connect(owner).addReserveType("qc")
      ).to.be.revertedWith("ReserveTypeExists");
    });

    it("should prevent empty reserve type strings", async function () {
      await expect(
        accountControl.connect(owner).addReserveType("")
      ).to.be.revertedWith("ZeroAddress"); // Reusing error
    });
  });

  describe("Reserve Authorization with Types", function () {
    it("should authorize reserves with correct types", async function () {
      await accountControl.connect(owner).authorizeReserve(qc1.address, 1000000, "qc");
      await accountControl.connect(owner).authorizeReserve(qc2.address, 2000000, "qc");
      await accountControl.connect(owner).authorizeReserve(l2Bridge.address, 5000000, "l2-bridge");

      const qc1Info = await accountControl.reserveInfo(qc1.address);
      const qc2Info = await accountControl.reserveInfo(qc2.address);
      const bridgeInfo = await accountControl.reserveInfo(l2Bridge.address);

      expect(qc1Info.reserveType).to.equal("qc");
      expect(qc1Info.mintingCap).to.equal(1000000);

      expect(qc2Info.reserveType).to.equal("qc");
      expect(qc2Info.mintingCap).to.equal(2000000);

      expect(bridgeInfo.reserveType).to.equal("l2-bridge");
      expect(bridgeInfo.mintingCap).to.equal(5000000);
    });

    it("should prevent authorizing with invalid reserve types", async function () {
      await expect(
        accountControl.connect(owner).authorizeReserve(qc1.address, 1000000, "invalid-type")
      ).to.be.revertedWith("InvalidReserveType");
    });

    it("should allow changing reserve types", async function () {
      await accountControl.connect(owner).authorizeReserve(qc1.address, 1000000, "qc");
      
      await expect(
        accountControl.connect(owner).setReserveType(qc1.address, "allowlisted")
      ).to.emit(accountControl, "ReserveTypeChanged").withArgs(qc1.address, "qc", "allowlisted");

      const info = await accountControl.reserveInfo(qc1.address);
      expect(info.reserveType).to.equal("allowlisted");
    });
  });

  describe("Reserve Analytics and Queries", function () {
    beforeEach(async function () {
      // Setup test reserves
      await accountControl.connect(owner).authorizeReserve(qc1.address, 1000000, "qc");
      await accountControl.connect(owner).authorizeReserve(qc2.address, 2000000, "qc");
      await accountControl.connect(owner).authorizeReserve(l2Bridge.address, 5000000, "l2-bridge");
      
      // Set backing and mint some tokens for analytics
      await mockReserveOracle.mockConsensusBackingUpdate(qc1.address, 1000000);
      await mockReserveOracle.mockConsensusBackingUpdate(qc2.address, 2000000);
      await mockReserveOracle.mockConsensusBackingUpdate(l2Bridge.address, 5000000);
      
      await accountControl.connect(qc1).mint(owner.address, 500000);
      await accountControl.connect(qc2).mint(owner.address, 1000000);
      await accountControl.connect(l2Bridge).mint(owner.address, 2000000);
    });

    it("should return reserves by type", async function () {
      const qcReserves = await accountControl.getReservesByType("qc");
      const bridgeReserves = await accountControl.getReservesByType("l2-bridge");

      expect(qcReserves.length).to.equal(2);
      expect(qcReserves).to.include(qc1.address);
      expect(qcReserves).to.include(qc2.address);

      expect(bridgeReserves.length).to.equal(1);
      expect(bridgeReserves[0]).to.equal(l2Bridge.address);
    });

    it("should provide reserve type statistics", async function () {
      const [types, counts, totalMinted] = await accountControl.getReserveTypeStats();

      // Find QC stats
      const qcIndex = types.findIndex((t: string) => t === "qc");
      expect(qcIndex).to.not.equal(-1);
      expect(counts[qcIndex]).to.equal(2); // 2 QC reserves
      expect(totalMinted[qcIndex]).to.equal(1500000); // 500k + 1000k minted by QCs

      // Find L2 bridge stats  
      const bridgeIndex = types.findIndex((t: string) => t === "l2-bridge");
      expect(bridgeIndex).to.not.equal(-1);
      expect(counts[bridgeIndex]).to.equal(1); // 1 bridge reserve
      expect(totalMinted[bridgeIndex]).to.equal(2000000); // 2000k minted by bridge
    });

    it("should include reserve type in reserve stats", async function () {
      const stats = await accountControl.getReserveStats(qc1.address);
      
      expect(stats.isAuthorized).to.be.true;
      expect(stats.reserveType).to.equal("qc");
      expect(stats.mintingCap).to.equal(1000000);
      expect(stats.mintedAmount).to.equal(500000);
      expect(stats.availableToMint).to.equal(500000); // backing - minted
    });
  });

  describe("Integration with Existing Systems", function () {
    it("should work with QCManager integration", async function () {
      // This simulates how QCManager would call AccountControl
      await accountControl.connect(owner).authorizeReserve(qc1.address, 1000000, "qc");
      
      const info = await accountControl.reserveInfo(qc1.address);
      expect(info.reserveType).to.equal("qc");
      expect(await accountControl.authorized(qc1.address)).to.be.true;
    });

    it("should support deauthorization with type cleanup", async function () {
      await accountControl.connect(owner).authorizeReserve(qc1.address, 1000000, "qc");
      
      await accountControl.connect(owner).deauthorizeReserve(qc1.address);
      
      const info = await accountControl.reserveInfo(qc1.address);
      expect(info.mintingCap).to.equal(0);
      expect(info.reserveType).to.equal(""); // Cleared on deauthorization
    });
  });
});