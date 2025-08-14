const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Debug MockTBTCToken", () => {
  it("should deploy MockTBTCToken without arguments", async () => {
    console.log("Getting MockTBTCToken factory...");
    const MockTBTC = await ethers.getContractFactory("MockTBTCToken");
    console.log("Factory obtained");
    
    console.log("Calling deploy with no arguments...");
    const mockTBTC = await MockTBTC.deploy();
    console.log("MockTBTCToken deployed to:", mockTBTC.address);
    
    expect(mockTBTC.address).to.not.equal(ethers.constants.AddressZero);
  });
});
