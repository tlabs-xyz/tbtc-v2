import { expect } from "chai";
import { ethers } from "hardhat";

describe("QCManagerLib - Extracted Functions", function () {
  let qcManagerLib: any;
  let qcManagerPauseLib: any;

  beforeEach(async function () {
    // Deploy QCManagerLib for direct testing
    const QCManagerLibFactory = await ethers.getContractFactory("QCManagerLib");
    qcManagerLib = await QCManagerLibFactory.deploy();
    
    // Deploy QCManagerPauseLib for calculateTimeUntilRenewal tests
    const QCManagerPauseLibFactory = await ethers.getContractFactory("QCManagerPauseLib");
    qcManagerPauseLib = await QCManagerPauseLibFactory.deploy();
  });

  // Note: calculateTimeUntilRenewal is an internal function in QCManagerPauseLib
  // It is tested indirectly through QCManager's getTimeUntilRenewal function
  // See QCManagerLib.Integration.test.ts for those tests

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