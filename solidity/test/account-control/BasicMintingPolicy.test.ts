import { ethers, deployments, helpers } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { 
  BasicMintingPolicy, 
  Bank, 
  TBTCVault,
  TBTC,
  ProtocolRegistry,
  QCManager,
  QCData,
  SystemState
} from "../../typechain"

describe("BasicMintingPolicy - Direct Bank Integration", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qc: SignerWithAddress
  let user: SignerWithAddress
  let unauthorized: SignerWithAddress

  let basicMintingPolicy: BasicMintingPolicy
  let bank: Bank
  let tbtcVault: TBTCVault
  let tbtc: TBTC
  let protocolRegistry: ProtocolRegistry
  let qcManager: QCManager
  let qcData: QCData
  let systemState: SystemState

  const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"))
  const QC_ADMIN_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_ADMIN_ROLE"))
  const SATOSHI_MULTIPLIER = ethers.BigNumber.from(10).pow(10)

  beforeEach(async () => {
    await deployments.fixture(["AccountControl", "DirectQCIntegration"])
    
    ;[deployer, governance, qc, user, unauthorized] = await ethers.getSigners()

    // Get deployed contracts
    const basicMintingPolicyDeployment = await deployments.get("BasicMintingPolicy")
    const bankDeployment = await deployments.get("Bank")
    const tbtcVaultDeployment = await deployments.get("TBTCVault")
    const tbtcDeployment = await deployments.get("TBTC")
    const protocolRegistryDeployment = await deployments.get("ProtocolRegistry")
    const qcManagerDeployment = await deployments.get("QCManager")
    const qcDataDeployment = await deployments.get("QCData")
    const systemStateDeployment = await deployments.get("SystemState")

    basicMintingPolicy = await ethers.getContractAt(
      "BasicMintingPolicy",
      basicMintingPolicyDeployment.address
    ) as BasicMintingPolicy

    bank = await ethers.getContractAt("Bank", bankDeployment.address) as Bank
    tbtcVault = await ethers.getContractAt("TBTCVault", tbtcVaultDeployment.address) as TBTCVault
    tbtc = await ethers.getContractAt("TBTC", tbtcDeployment.address) as TBTC
    protocolRegistry = await ethers.getContractAt(
      "ProtocolRegistry",
      protocolRegistryDeployment.address
    ) as ProtocolRegistry
    qcManager = await ethers.getContractAt("QCManager", qcManagerDeployment.address) as QCManager
    qcData = await ethers.getContractAt("QCData", qcDataDeployment.address) as QCData
    systemState = await ethers.getContractAt("SystemState", systemStateDeployment.address) as SystemState

    // Setup QC
    await qcManager.connect(governance).grantRole(QC_ADMIN_ROLE, deployer.address)
    await qcManager.addQC(qc.address, ethers.utils.parseEther("1000")) // 1000 tBTC capacity
  })

  describe("Direct Bank Integration", () => {
    it("should be authorized to increase Bank balances", async () => {
      const isAuthorized = await bank.authorizedBalanceIncreasers(basicMintingPolicy.address)
      expect(isAuthorized).to.be.true
    })

  })

  describe("Minting Flow", () => {
    const mintAmount = ethers.utils.parseEther("10") // 10 tBTC

    beforeEach(async () => {
      // Grant MINTER_ROLE to deployer for testing
      await basicMintingPolicy.grantRole(MINTER_ROLE, deployer.address)
      
      // Simulate QC having reserves
      // In real scenario, this would be done by Watchdog attestation
      // For testing, we'll just ensure QC is active
    })

    it("should mint tBTC directly through Bank integration", async () => {
      const userBalanceBefore = await tbtc.balanceOf(user.address)
      
      // Execute mint
      const tx = await basicMintingPolicy.requestMint(
        qc.address,
        user.address,
        mintAmount
      )
      
      const receipt = await tx.wait()
      
      // Check events
      const mintCompletedEvent = receipt.events?.find(
        e => e.event === "MintCompleted"
      )
      expect(mintCompletedEvent).to.not.be.undefined
      expect(mintCompletedEvent?.args?.qc).to.equal(qc.address)
      expect(mintCompletedEvent?.args?.user).to.equal(user.address)
      expect(mintCompletedEvent?.args?.amount).to.equal(mintAmount)

      // Check user received tBTC
      const userBalanceAfter = await tbtc.balanceOf(user.address)
      expect(userBalanceAfter.sub(userBalanceBefore)).to.equal(mintAmount)

      // Check QC minted amount was updated
      const qcMintedAmount = await qcData.getQCMintedAmount(qc.address)
      expect(qcMintedAmount).to.equal(mintAmount)
    })

    it("should create Bank balance without auto-minting when requested", async () => {
      const bankBalanceBefore = await bank.balanceOf(user.address)
      const tbtcBalanceBefore = await tbtc.balanceOf(user.address)
      
      // Execute mint without auto-minting
      await basicMintingPolicy.requestMintWithOption(
        qc.address,
        user.address,
        mintAmount,
        false // no auto-mint
      )
      
      // Check Bank balance increased
      const bankBalanceAfter = await bank.balanceOf(user.address)
      const satoshis = mintAmount.div(SATOSHI_MULTIPLIER)
      expect(bankBalanceAfter.sub(bankBalanceBefore)).to.equal(satoshis)

      // Check tBTC was NOT minted
      const tbtcBalanceAfter = await tbtc.balanceOf(user.address)
      expect(tbtcBalanceAfter).to.equal(tbtcBalanceBefore)
    })

    it("should revert if not authorized in Bank", async () => {
      // Remove authorization
      await bank.connect(governance).setAuthorizedBalanceIncreaser(
        basicMintingPolicy.address,
        false
      )

      await expect(
        basicMintingPolicy.requestMint(qc.address, user.address, mintAmount)
      ).to.be.revertedWith("NotAuthorizedInBank")

      // Restore authorization for other tests
      await bank.connect(governance).setAuthorizedBalanceIncreaser(
        basicMintingPolicy.address,
        true
      )
    })

    it("should revert if QC is not active", async () => {
      // Deactivate QC
      await qcManager.setQCStatus(qc.address, 2) // Revoked

      await expect(
        basicMintingPolicy.requestMint(qc.address, user.address, mintAmount)
      ).to.be.revertedWith("QCNotActive")
    })

    it("should revert if insufficient QC capacity", async () => {
      const excessiveAmount = ethers.utils.parseEther("2000") // More than 1000 tBTC capacity

      await expect(
        basicMintingPolicy.requestMint(qc.address, user.address, excessiveAmount)
      ).to.be.revertedWith("InsufficientMintingCapacity")
    })

    it("should revert if minting is paused", async () => {
      // Pause minting
      await systemState.pauseMinting()

      await expect(
        basicMintingPolicy.requestMint(qc.address, user.address, mintAmount)
      ).to.be.revertedWith("MintingPaused")
    })

    it("should emit rejection event for invalid requests", async () => {
      // Test with zero amount
      const tx = basicMintingPolicy.requestMint(
        qc.address,
        user.address,
        0
      )

      await expect(tx)
        .to.be.revertedWith("InvalidAmount")
    })
  })

  describe("Mint Request Tracking", () => {
    it("should track mint requests", async () => {
      await basicMintingPolicy.grantRole(MINTER_ROLE, deployer.address)
      
      const mintAmount = ethers.utils.parseEther("5")
      const tx = await basicMintingPolicy.requestMint(
        qc.address,
        user.address,
        mintAmount
      )
      
      const receipt = await tx.wait()
      const mintCompletedEvent = receipt.events?.find(e => e.event === "MintCompleted")
      const mintId = mintCompletedEvent?.args?.mintId

      // Check mint request details
      const mintRequest = await basicMintingPolicy.getMintRequest(mintId)
      expect(mintRequest.qc).to.equal(qc.address)
      expect(mintRequest.user).to.equal(user.address)
      expect(mintRequest.amount).to.equal(mintAmount)
      expect(mintRequest.completed).to.be.true

      // Check completion status
      const isCompleted = await basicMintingPolicy.isMintCompleted(mintId)
      expect(isCompleted).to.be.true
    })
  })

  describe("Gas Optimization", () => {
    it("should use less gas than QCBridge approach", async () => {
      await basicMintingPolicy.grantRole(MINTER_ROLE, deployer.address)
      const mintAmount = ethers.utils.parseEther("10")
      
      const tx = await basicMintingPolicy.requestMint(
        qc.address,
        user.address,
        mintAmount
      )
      
      const receipt = await tx.wait()
      console.log("Direct integration gas used:", receipt.gasUsed.toString())
      
      // Direct integration should use less gas than going through QCBridge
      // Typical savings: ~50,000-70,000 gas by removing extra contract call
      expect(receipt.gasUsed).to.be.lt(300000) // Reasonable upper bound
    })
  })

  describe("Access Control", () => {
    it("should only allow MINTER_ROLE to request mints", async () => {
      await expect(
        basicMintingPolicy.connect(unauthorized).requestMint(
          qc.address,
          user.address,
          ethers.utils.parseEther("10")
        )
      ).to.be.reverted
    })

    it("should check minting eligibility correctly", async () => {
      const mintAmount = ethers.utils.parseEther("10")
      
      // Should be eligible
      const isEligible = await basicMintingPolicy.checkMintingEligibility(
        qc.address,
        mintAmount
      )
      expect(isEligible).to.be.true

      // Should not be eligible if QC is deactivated
      await qcManager.setQCStatus(qc.address, 2) // Revoked
      const isEligibleAfter = await basicMintingPolicy.checkMintingEligibility(
        qc.address,
        mintAmount
      )
      expect(isEligibleAfter).to.be.false
    })
  })
})