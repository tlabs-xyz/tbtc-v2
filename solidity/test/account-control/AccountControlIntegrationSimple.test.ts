import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

describe("Simple Integration Test", () => {
  let owner: SignerWithAddress
  
  before(async () => {
    [owner] = await ethers.getSigners()
  })
  
  it("should run a basic test", async () => {
    expect(owner.address).to.be.a("string")
    console.log("Basic test passed with owner:", owner.address)
  })
})