/**
 * Simple SPV Proof Test - Isolate the encoding issue
 */

import { expect } from "chai"
import { ethers } from "hardhat"
import { SPVTestHelpers } from "../helpers/SPVTestData"

describe("SPV Proof Generation Test", () => {
  it("should generate valid SPV proof structure without encoding errors", async () => {
    // Generate SPV proof structure
    const structures = SPVTestHelpers.generateBitcoinTxStructures()
    
    console.log("Generated SPV structures:", {
      txInfo: structures.txInfo,
      proof: structures.proof
    })
    
    // Validate all fields are defined
    expect(structures.txInfo.version).to.not.be.undefined
    expect(structures.txInfo.inputVector).to.not.be.undefined
    expect(structures.txInfo.outputVector).to.not.be.undefined
    expect(structures.txInfo.locktime).to.not.be.undefined
    
    expect(structures.proof.merkleProof).to.not.be.undefined
    expect(structures.proof.txIndexInBlock).to.not.be.undefined
    expect(structures.proof.bitcoinHeaders).to.not.be.undefined
    expect(structures.proof.coinbasePreimage).to.not.be.undefined
    
    // Log each field individually to check for undefined values
    console.log("Individual field check:")
    console.log("txInfo.version:", structures.txInfo.version)
    console.log("txInfo.inputVector:", structures.txInfo.inputVector)
    console.log("txInfo.outputVector:", structures.txInfo.outputVector) 
    console.log("txInfo.locktime:", structures.txInfo.locktime)
    console.log("proof.merkleProof:", structures.proof.merkleProof)
    console.log("proof.txIndexInBlock:", structures.proof.txIndexInBlock)
    console.log("proof.bitcoinHeaders:", structures.proof.bitcoinHeaders)
    console.log("proof.coinbasePreimage:", structures.proof.coinbasePreimage)
    
    // Try to encode the structures (this is where the error should occur if there's an issue)
    const encoded = ethers.utils.defaultAbiCoder.encode(
      [
        "tuple(bytes4,bytes,bytes,bytes4)",  // BitcoinTx.Info
        "tuple(bytes,uint256,bytes,bytes32)" // BitcoinTx.Proof  
      ],
      [
        [
          structures.txInfo.version,
          structures.txInfo.inputVector,
          structures.txInfo.outputVector,
          structures.txInfo.locktime
        ],
        [
          structures.proof.merkleProof,
          structures.proof.txIndexInBlock, 
          structures.proof.bitcoinHeaders,
          structures.proof.coinbasePreimage
        ]
      ]
    )
    
    console.log("ABI encoding successful! Length:", encoded.length)
    expect(encoded).to.not.be.undefined
    expect(encoded.length).to.be.greaterThan(0)
  })
})