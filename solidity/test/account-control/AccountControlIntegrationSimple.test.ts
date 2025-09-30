import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { IntegrationTestFramework } from "../helpers/IntegrationTestFramework"

describe("AccountControl Integration Test", () => {
  let framework: IntegrationTestFramework
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let qcAddress: SignerWithAddress
  let nonOwner: SignerWithAddress
  
  before(async () => {
    framework = new IntegrationTestFramework()
    await framework.deploySystem()
    
    owner = framework.signers.owner
    user = framework.signers.user
    qcAddress = framework.signers.qcAddress
    ;[, , , nonOwner] = await ethers.getSigners()
  })
  
  it("should deploy AccountControl contract and verify owner", async () => {
    const accountControl = framework.contracts.accountControl
    expect(accountControl.address).to.be.a("string")
    expect(accountControl.address).to.not.equal(ethers.constants.AddressZero)
    
    // Verify owner has DEFAULT_ADMIN_ROLE
    const adminRole = await accountControl.DEFAULT_ADMIN_ROLE()
    const hasAdminRole = await accountControl.hasRole(adminRole, owner.address)
    expect(hasAdminRole).to.be.true
  })
  
  it("should allow owner to change control mode and reject non-owner", async () => {
    const accountControl = framework.contracts.accountControl
    const systemState = framework.contracts.systemState
    
    // Initial state should be disabled
    const initialMode = await systemState.accountControlMode()
    expect(initialMode).to.be.false
    
    // Non-owner should not be able to change mode
    await expect(
      systemState.connect(nonOwner).setAccountControlMode(true)
    ).to.be.revertedWith("Ownable: caller is not the owner")
    
    // Owner should be able to change mode
    await systemState.connect(owner).setAccountControlMode(true)
    const newMode = await systemState.accountControlMode()
    expect(newMode).to.be.true
    
    // Reset for other tests
    await systemState.connect(owner).setAccountControlMode(false)
  })
  
  it("should handle authorization correctly", async () => {
    const accountControl = framework.contracts.accountControl
    const minterRole = await accountControl.MINTER_ROLE()
    
    // QCMinter should have minter role
    const hasMinterRole = await accountControl.hasRole(
      minterRole,
      framework.contracts.qcMinter.address
    )
    expect(hasMinterRole).to.be.true
    
    // Random address should not have minter role
    const randomHasMinterRole = await accountControl.hasRole(
      minterRole,
      nonOwner.address
    )
    expect(randomHasMinterRole).to.be.false
  })
  
  it("should track minted amounts correctly", async () => {
    await framework.enableAccountControlMode()
    
    const initialTotal = await framework.contracts.accountControl.totalMinted()
    const initialQCMinted = await framework.contracts.accountControl.qcMinted(qcAddress.address)
    
    // Execute a mint
    const mintAmount = ethers.utils.parseEther("1")
    await framework.contracts.qcMinter.connect(owner).requestQCMint(
      qcAddress.address,
      user.address,
      mintAmount
    )
    
    const finalTotal = await framework.contracts.accountControl.totalMinted()
    const finalQCMinted = await framework.contracts.accountControl.qcMinted(qcAddress.address)
    
    expect(finalTotal).to.equal(initialTotal.add(mintAmount))
    expect(finalQCMinted).to.equal(initialQCMinted.add(mintAmount))
  })
  
  it("should respect minting caps", async () => {
    const accountControl = framework.contracts.accountControl
    const qcMinter = framework.contracts.qcMinter
    
    // Set a low minting cap
    const lowCap = ethers.utils.parseEther("0.1")
    await accountControl.connect(owner).setMintingCap(qcAddress.address, lowCap)
    
    // Try to mint above the cap
    const exceedAmount = ethers.utils.parseEther("0.2")
    await expect(
      qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        exceedAmount
      )
    ).to.be.revertedWith("Minting cap exceeded")
    
    // Minting within cap should succeed
    const validAmount = ethers.utils.parseEther("0.05")
    await expect(
      qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        validAmount
      )
    ).to.not.be.reverted
  })
})