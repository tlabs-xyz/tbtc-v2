/**
 * Debug test to investigate AccountControl integration issues
 */

import chai, { expect } from "chai"
import { ethers } from "hardhat"
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers"

import { IntegrationTestFramework } from "../helpers/IntegrationTestFramework"

describe("Debug AccountControl Integration", () => {
  let framework: IntegrationTestFramework
  let owner: HardhatEthersSigner
  let user: HardhatEthersSigner
  let qcAddress: HardhatEthersSigner
  
  beforeEach(async () => {
    framework = new IntegrationTestFramework()
    await framework.deploySystem()
    
    owner = framework.signers.owner
    user = framework.signers.user
    qcAddress = framework.signers.qcAddress
  })

  it("should check AccountControl configuration", async () => {
    // Check if AccountControl mode is enabled
    const isEnabled = await framework.contracts.systemState.accountControlMode()
    console.log("AccountControl mode enabled:", isEnabled)
    
    // Check if QCMinter has AccountControl set
    const accountControlAddress = await framework.contracts.qcMinter.accountControl()
    console.log("QCMinter AccountControl address:", accountControlAddress)
    console.log("Actual AccountControl address:", framework.contracts.accountControl.address)
    
    // Check if they match
    expect(accountControlAddress).to.equal(framework.contracts.accountControl.address)
    
    // Check backing
    const backing = await framework.contracts.accountControl.backing(qcAddress.address)
    console.log("QC backing:", backing.toString())
    
    // Check minting cap
    const mintingCap = await framework.contracts.accountControl.mintingCap(qcAddress.address)
    console.log("QC minting cap:", mintingCap.toString())
    
    // Check if QCMinter can mint
    const minterRole = await framework.contracts.accountControl.MINTER_ROLE()
    const hasMinterRole = await framework.contracts.accountControl.hasRole(minterRole, framework.contracts.qcMinter.address)
    console.log("QCMinter has MINTER_ROLE:", hasMinterRole)
    
    // Check Bank authorizations
    const isBankAuthorized = await framework.contracts.mockBank.isBalanceIncreaserAuthorized(framework.contracts.accountControl.address)
    console.log("AccountControl authorized in Bank:", isBankAuthorized)
    
    const isQCMinterAuthorized = await framework.contracts.mockBank.isBalanceIncreaserAuthorized(framework.contracts.qcMinter.address)
    console.log("QCMinter authorized in Bank:", isQCMinterAuthorized)
  })

  it("should trace mint execution", async () => {
    // Enable AccountControl
    await framework.enableAccountControlMode()
    
    const mintAmount = framework.MINT_AMOUNT
    console.log("Attempting to mint:", mintAmount.toString())
    
    // Check initial state
    const initialMinted = await framework.contracts.accountControl.totalMinted()
    console.log("Initial total minted:", initialMinted.toString())
    
    try {
      // Execute mint
      console.log("Calling requestQCMint...")
      const tx = await framework.contracts.qcMinter.connect(owner).requestQCMint(
        qcAddress.address,
        user.address,
        mintAmount
      )
      console.log("Transaction hash:", tx.hash)
      
      const receipt = await tx.wait()
      console.log("Transaction mined in block:", receipt.blockNumber)
      console.log("Events emitted:", receipt.events?.map(e => e.event))
      
      // Check final state
      const finalMinted = await framework.contracts.accountControl.totalMinted()
      console.log("Final total minted:", finalMinted.toString())
      
      const bankBalance = await framework.contracts.mockBank.balances(user.address)
      console.log("User bank balance:", bankBalance.toString())
      
    } catch (error: any) {
      console.error("Mint failed with error:", error.reason || error.message)
      throw error
    }
  })
})