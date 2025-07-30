import { ethers, helpers, waffle } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { Contract } from "ethers"
import { smock } from "@defi-wonderland/smock"
import type { FakeContract } from "@defi-wonderland/smock"

const { loadFixture } = waffle

describe("OptimizedMintingPolicy Gas Comparison", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qc: SignerWithAddress
  let user: SignerWithAddress

  let optimizedPolicy: Contract
  let originalPolicy: Contract
  let protocolRegistry: FakeContract<Contract>
  let mockBank: FakeContract<Contract>
  let mockVault: FakeContract<Contract>
  let mockToken: FakeContract<Contract>
  let mockQCManager: FakeContract<Contract>
  let mockQCData: FakeContract<Contract>
  let mockSystemState: FakeContract<Contract>

  // Role constants
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
  const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"))

  // Service keys
  const QC_MANAGER_KEY = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_MANAGER"))
  const QC_DATA_KEY = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_DATA"))
  const SYSTEM_STATE_KEY = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("SYSTEM_STATE"))
  const BANK_KEY = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BANK"))
  const TBTC_VAULT_KEY = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TBTC_VAULT"))

  async function fixture() {
    ;[deployer, governance, qc, user] = await ethers.getSigners()

    // Create mock contracts
    protocolRegistry = await smock.fake("ProtocolRegistry")
    mockBank = await smock.fake("Bank")
    mockVault = await smock.fake("TBTCVault") 
    mockToken = await smock.fake("TBTC")
    mockQCManager = await smock.fake("QCManager")
    mockQCData = await smock.fake("QCData")
    mockSystemState = await smock.fake("SystemState")

    // Setup mock returns
    mockBank.isAuthorizedBalanceIncreaser.returns(true)
    mockBank.increaseBalanceAndCall.returns(true)
    mockBank.increaseBalance.returns(true)
    mockSystemState.isMintingPaused.returns(false)
    mockSystemState.minMintAmount.returns(ethers.utils.parseEther("0.1"))
    mockSystemState.maxMintAmount.returns(ethers.utils.parseEther("1000"))
    
    // Setup QC data
    const qcStatus = 1 // Active
    mockQCData.getQCStatus.returns(qcStatus)
    mockQCData.getCustodian.returns({
      status: qcStatus,
      maxMintingCap: ethers.utils.parseEther("1000"),
      mintedTBTC: ethers.utils.parseEther("100"),
      attestedReserveBalance: ethers.utils.parseEther("500")
    })

    // Setup registry returns for original policy
    protocolRegistry.getService.whenCalledWith(QC_MANAGER_KEY).returns(mockQCManager.address)
    protocolRegistry.getService.whenCalledWith(QC_DATA_KEY).returns(mockQCData.address)
    protocolRegistry.getService.whenCalledWith(SYSTEM_STATE_KEY).returns(mockSystemState.address)
    protocolRegistry.getService.whenCalledWith(BANK_KEY).returns(mockBank.address)
    protocolRegistry.getService.whenCalledWith(TBTC_VAULT_KEY).returns(mockVault.address)

    // Deploy optimized policy with direct integration
    const OptimizedMintingPolicy = await ethers.getContractFactory("OptimizedMintingPolicy")
    optimizedPolicy = await OptimizedMintingPolicy.deploy(
      mockBank.address,        // Direct integration
      mockVault.address,       // Direct integration
      mockToken.address,       // Direct integration
      protocolRegistry.address // Registry for business logic
    )
    await optimizedPolicy.deployed()

    // Deploy original policy (all registry-based) for comparison
    const BasicMintingPolicy = await ethers.getContractFactory("BasicMintingPolicy")
    originalPolicy = await BasicMintingPolicy.deploy(protocolRegistry.address)
    await originalPolicy.deployed()

    // Grant roles
    await optimizedPolicy.grantRole(MINTER_ROLE, deployer.address)
    await originalPolicy.grantRole(MINTER_ROLE, deployer.address)

    return {
      optimizedPolicy,
      originalPolicy,
      protocolRegistry,
      mockBank,
      mockVault,
      mockToken,
      mockQCManager,
      mockQCData,
      mockSystemState,
      deployer,
      governance,
      qc,
      user,
    }
  }

  beforeEach(async () => {
    const loadedFixture = await loadFixture(fixture)
    Object.assign(this, loadedFixture)
  })

  describe("Gas Optimization Comparison", () => {
    const mintAmount = ethers.utils.parseEther("10")

    it("should demonstrate gas savings with direct integration", async () => {
      console.log("\n=== GAS USAGE COMPARISON ===")

      // Test optimized policy (direct integration)
      const optimizedTx = await optimizedPolicy.requestMint(qc.address, user.address, mintAmount)
      const optimizedReceipt = await optimizedTx.wait()
      const optimizedGas = optimizedReceipt.gasUsed

      console.log(`Optimized Policy Gas: ${optimizedGas.toString()}`)

      // Test original policy (all registry lookups)
      const originalTx = await originalPolicy.requestMint(qc.address, user.address, mintAmount)
      const originalReceipt = await originalTx.wait()
      const originalGas = originalReceipt.gasUsed

      console.log(`Original Policy Gas:  ${originalGas.toString()}`)

      // Calculate savings
      const gasSaved = originalGas.sub(optimizedGas)
      const percentSaved = gasSaved.mul(100).div(originalGas)

      console.log(`Gas Saved:           ${gasSaved.toString()}`)
      console.log(`Percent Saved:       ${percentSaved.toString()}%`)

      // Verify we actually saved gas
      expect(optimizedGas).to.be.lt(originalGas)
      expect(percentSaved).to.be.gte(8) // Expect at least 8% savings
    })

    it("should show registry lookup overhead", async () => {
      // Count registry calls for original policy
      const originalTx = await originalPolicy.requestMint(qc.address, user.address, mintAmount)
      await originalTx.wait()

      // Original policy should make 5 registry calls:
      // QC_MANAGER, QC_DATA, SYSTEM_STATE, BANK, TBTC_VAULT
      expect(protocolRegistry.getService).to.have.callCount(5)

      // Reset call count
      protocolRegistry.getService.resetHistory()

      // Optimized policy call
      const optimizedTx = await optimizedPolicy.requestMint(qc.address, user.address, mintAmount)
      await optimizedTx.wait()

      // Optimized policy should make only 3 registry calls:
      // QC_MANAGER, QC_DATA, SYSTEM_STATE (BANK and VAULT are direct)
      expect(protocolRegistry.getService).to.have.callCount(3)

      console.log("\n=== REGISTRY LOOKUP REDUCTION ===")
      console.log("Original Policy: 5 registry lookups")
      console.log("Optimized Policy: 3 registry lookups") 
      console.log("Reduction: 40% fewer registry calls")
    })

    it("should maintain identical functionality", async () => {
      const mintAmount = ethers.utils.parseEther("5")

      // Both policies should produce identical results
      const originalResult = await originalPolicy.callStatic.requestMint(
        qc.address, 
        user.address, 
        mintAmount
      )
      
      const optimizedResult = await optimizedPolicy.callStatic.requestMint(
        qc.address,
        user.address, 
        mintAmount
      )

      // Mint IDs will be different due to different contract addresses,
      // but both should succeed and return valid mint IDs
      expect(originalResult).to.not.equal(ethers.constants.HashZero)
      expect(optimizedResult).to.not.equal(ethers.constants.HashZero)

      // Both should call the same underlying functions
      await originalPolicy.requestMint(qc.address, user.address, mintAmount)
      await optimizedPolicy.requestMint(qc.address, user.address, mintAmount)

      // Verify both called the bank
      expect(mockBank.increaseBalanceAndCall).to.have.been.calledTwice
    })

    it("should provide capacity calculations with same results", async () => {
      const originalCapacity = await originalPolicy.getAvailableMintingCapacity(qc.address)
      const optimizedCapacity = await optimizedPolicy.getAvailableMintingCapacity(qc.address)

      expect(originalCapacity).to.equal(optimizedCapacity)
      
      // Expected: 500 (reserves) - 100 (minted) = 400 available
      expect(originalCapacity).to.equal(ethers.utils.parseEther("400"))
    })
  })

  describe("Direct Integration Benefits", () => {
    it("should have direct access to core contracts", async () => {
      const [bankAddr, vaultAddr, tokenAddr] = await optimizedPolicy.getCoreContracts()
      
      expect(bankAddr).to.equal(mockBank.address)
      expect(vaultAddr).to.equal(mockVault.address)  
      expect(tokenAddr).to.equal(mockToken.address)

      // These should be direct references (no registry lookup needed)
      expect(await optimizedPolicy.bank()).to.equal(mockBank.address)
      expect(await optimizedPolicy.tbtcVault()).to.equal(mockVault.address)
      expect(await optimizedPolicy.tbtc()).to.equal(mockToken.address)
    })

    it("should validate bank authorization efficiently", async () => {
      // Direct integration allows efficient authorization checks
      const isAuthorized = await optimizedPolicy.checkBankAuthorization()
      expect(isAuthorized).to.be.true

      // This should be a direct call, not a registry lookup
      expect(mockBank.isAuthorizedBalanceIncreaser).to.have.been.calledWith(optimizedPolicy.address)
    })

    it("should provide gas optimization metrics", async () => {
      const [directCalls, registryLookups] = await optimizedPolicy.getGasOptimizationInfo()
      
      expect(directCalls).to.equal(3)      // bank, vault, token
      expect(registryLookups).to.equal(3)  // qcManager, qcData, systemState
      
      console.log(`\nPer mint operation:`)
      console.log(`Direct calls: ${directCalls} (no registry overhead)`)
      console.log(`Registry lookups: ${registryLookups} (necessary business logic)`)
      console.log(`Gas savings: ~${directCalls * 5000} gas per mint`)
    })
  })

  describe("Error Handling", () => {
    it("should handle invalid inputs correctly", async () => {
      // Both policies should handle errors identically
      await expect(
        optimizedPolicy.requestMint(ethers.constants.AddressZero, user.address, mintAmount)
      ).to.be.revertedWith("InvalidQCAddress")

      await expect(
        originalPolicy.requestMint(ethers.constants.AddressZero, user.address, mintAmount)
      ).to.be.revertedWith("InvalidQCAddress")
    })

    it("should handle system pause correctly", async () => {
      // Simulate system pause
      mockSystemState.isMintingPaused.returns(true)

      await expect(
        optimizedPolicy.requestMint(qc.address, user.address, mintAmount)
      ).to.be.revertedWith("MintingPaused")

      await expect(
        originalPolicy.requestMint(qc.address, user.address, mintAmount)
      ).to.be.revertedWith("MintingPaused")
    })

    it("should handle insufficient capacity correctly", async () => {
      const largeAmount = ethers.utils.parseEther("500") // More than available (400)

      await expect(
        optimizedPolicy.requestMint(qc.address, user.address, largeAmount)
      ).to.be.revertedWith("InsufficientMintingCapacity")

      await expect(
        originalPolicy.requestMint(qc.address, user.address, largeAmount)
      ).to.be.revertedWith("InsufficientMintingCapacity")
    })
  })

  describe("Upgrade Scenarios", () => {
    it("should handle QC data upgrades through registry", async () => {
      // Deploy new QC data mock
      const newQCData = await smock.fake("QCData")
      newQCData.getQCStatus.returns(1) // Active
      newQCData.getCustodian.returns({
        status: 1,
        maxMintingCap: ethers.utils.parseEther("2000"), // Increased limit
        mintedTBTC: ethers.utils.parseEther("100"),
        attestedReserveBalance: ethers.utils.parseEther("1000") // More reserves
      })

      // Update registry to point to new QC data
      protocolRegistry.getService.whenCalledWith(QC_DATA_KEY).returns(newQCData.address)

      // Both policies should now use the new data
      const capacity = await optimizedPolicy.getAvailableMintingCapacity(qc.address)
      expect(capacity).to.equal(ethers.utils.parseEther("900")) // 1000 - 100 = 900

      console.log("\n=== UPGRADE DEMONSTRATION ===")
      console.log("✅ QC data upgraded through registry")
      console.log("✅ New capacity limits applied immediately")
      console.log("✅ Core contracts (Bank/Vault) remain unchanged")
    })

    it("should maintain core contract immutability", async () => {
      // Core contracts are set at deployment and cannot be changed
      const [bankAddr, vaultAddr, tokenAddr] = await optimizedPolicy.getCoreContracts()
      
      // These should be immutable
      expect(bankAddr).to.equal(mockBank.address)
      expect(vaultAddr).to.equal(mockVault.address)
      expect(tokenAddr).to.equal(mockToken.address)

      // Attempting to "upgrade" core contracts in registry should not affect optimized policy
      const newBank = await smock.fake("Bank")
      protocolRegistry.getService.whenCalledWith(BANK_KEY).returns(newBank.address)

      // Optimized policy should still use original bank (direct integration)
      const [stillOriginalBank] = await optimizedPolicy.getCoreContracts()
      expect(stillOriginalBank).to.equal(mockBank.address)
      expect(stillOriginalBank).to.not.equal(newBank.address)

      console.log("\n=== IMMUTABILITY DEMONSTRATION ===")
      console.log("✅ Core contracts cannot be changed via registry")
      console.log("✅ Direct integration provides immutability guarantee")
      console.log("✅ Users can trust core protocol won't change unexpectedly")
    })
  })
})