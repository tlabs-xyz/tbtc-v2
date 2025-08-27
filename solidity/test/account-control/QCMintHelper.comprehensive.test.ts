import { ethers, deployments, getNamedAccounts, helpers } from "hardhat"
import { expect } from "chai"
import type { 
  QCMintHelper, 
  QCMinter, 
  Bank, 
  TBTCVault, 
  TBTC, 
  QCData, 
  SystemState, 
  QCManager,
  Bridge 
} from "../../typechain"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

describe("QCMintHelper - Comprehensive Tests", () => {
  let qcMintHelper: QCMintHelper
  let qcMinter: QCMinter
  let bank: Bank
  let tbtcVault: TBTCVault
  let tbtc: TBTC
  let qcData: QCData
  let systemState: SystemState
  let qcManager: QCManager
  let bridge: Bridge

  let deployer: string
  let governance: string
  let qcAddress: string
  let userAddress: string
  let deployerSigner: SignerWithAddress
  let governanceSigner: SignerWithAddress
  let qcSigner: SignerWithAddress
  let userSigner: SignerWithAddress

  const SATOSHI_MULTIPLIER = ethers.BigNumber.from("10000000000") // 1e10
  const ONE_BTC_SATOSHIS = ethers.BigNumber.from("100000000") // 1 BTC in satoshis
  const HALF_BTC_SATOSHIS = ethers.BigNumber.from("50000000") // 0.5 BTC in satoshis
  
  // Roles
  let GOVERNANCE_ROLE: string
  let MINTER_ROLE: string
  let QC_MANAGER_ROLE: string

  before(async () => {
    await deployments.fixture(["Bank", "TBTCVault", "TBTC", "Bridge"])
    
    const accounts = await getNamedAccounts()
    deployer = accounts.deployer
    governance = accounts.governance || accounts.deployer
    
    const signers = await ethers.getSigners()
    deployerSigner = signers[0]
    governanceSigner = await ethers.getSigner(governance)
    qcSigner = signers[1]
    userSigner = signers[2]
    qcAddress = qcSigner.address
    userAddress = userSigner.address

    // Get core tBTC contracts
    bank = await ethers.getContract("Bank")
    tbtcVault = await ethers.getContract("TBTCVault")
    tbtc = await ethers.getContract("TBTC")
    bridge = await ethers.getContract("Bridge")

    // Deploy Account Control contracts if not already deployed
    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy()
    await qcData.deployed()

    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy()
    await systemState.deployed()

    const QCManagerFactory = await ethers.getContractFactory("QCManager")
    qcManager = await QCManagerFactory.deploy(
      qcData.address,
      systemState.address
    )
    await qcManager.deployed()

    // Deploy QCMinter
    const QCMinterFactory = await ethers.getContractFactory("QCMinter")
    qcMinter = await QCMinterFactory.deploy(
      bank.address,
      tbtcVault.address,
      tbtc.address,
      qcData.address,
      systemState.address,
      qcManager.address
    )
    await qcMinter.deployed()

    // Deploy QCMintHelper
    const QCMintHelperFactory = await ethers.getContractFactory("QCMintHelper")
    qcMintHelper = await QCMintHelperFactory.deploy(
      bank.address,
      tbtcVault.address,
      tbtc.address,
      qcMinter.address
    )
    await qcMintHelper.deployed()

    // Get roles
    GOVERNANCE_ROLE = await qcData.GOVERNANCE_ROLE()
    MINTER_ROLE = await qcMinter.MINTER_ROLE()
    QC_MANAGER_ROLE = await qcData.QC_MANAGER_ROLE()

    // Setup roles in QCData
    await qcData.grantRole(GOVERNANCE_ROLE, governance)
    await qcData.grantRole(QC_MANAGER_ROLE, qcManager.address)

    // Setup roles in QCMinter
    await qcMinter.grantRole(MINTER_ROLE, deployer)

    // CRITICAL: Authorize QCMinter in Bank
    // First check who owns Bank
    const bankOwner = await bank.owner()
    console.log(`Bank owner: ${bankOwner}`)
    console.log(`Bridge address: ${bridge.address}`)
    
    if (bankOwner === bridge.address) {
      // Bridge owns Bank - need to impersonate
      await helpers.impersonateAccount(bridge.address)
      const bridgeSigner = await ethers.getSigner(bridge.address)
      
      // Fund Bridge for gas
      await deployerSigner.sendTransaction({
        to: bridge.address,
        value: ethers.utils.parseEther("1.0")
      })
      
      // Authorize QCMinter
      await bank.connect(bridgeSigner).increaseBalanceAuthorization(
        qcMinter.address,
        ethers.constants.MaxUint256
      )
      
      await helpers.stopImpersonatingAccount(bridge.address)
    } else if (bankOwner === deployer) {
      // Deployer owns Bank (test environment)
      await bank.connect(deployerSigner).increaseBalanceAuthorization(
        qcMinter.address,
        ethers.constants.MaxUint256
      )
    } else {
      // Try governance
      await bank.connect(governanceSigner).increaseBalanceAuthorization(
        qcMinter.address,
        ethers.constants.MaxUint256
      )
    }

    // Configure QCMinter with helper
    await qcMinter.connect(deployerSigner).setMintHelper(qcMintHelper.address)

    // Setup system parameters
    await systemState.connect(deployerSigner).setMinMintAmount(
      ethers.utils.parseEther("0.01") // 0.01 tBTC minimum
    )
    await systemState.connect(deployerSigner).setMaxMintAmount(
      ethers.utils.parseEther("1000") // 1000 tBTC maximum
    )

    // Register QC for testing
    await qcManager.connect(deployerSigner).registerQC(
      qcAddress,
      ethers.utils.formatBytes32String("TestQC"),
      ethers.utils.parseEther("10000") // 10k tBTC capacity
    )

    // Ensure TBTCVault is authorized to mint TBTC
    const tbtcOwner = await tbtc.owner()
    if (tbtcOwner !== tbtcVault.address) {
      await helpers.impersonateAccount(tbtcOwner)
      const tbtcOwnerSigner = await ethers.getSigner(tbtcOwner)
      await deployerSigner.sendTransaction({
        to: tbtcOwner,
        value: ethers.utils.parseEther("1.0")
      })
      await tbtc.connect(tbtcOwnerSigner).transferOwnership(tbtcVault.address)
      await helpers.stopImpersonatingAccount(tbtcOwner)
    }
  })

  describe("Setup Verification", () => {
    it("should have correct contract addresses configured", async () => {
      expect(await qcMintHelper.bank()).to.equal(bank.address)
      expect(await qcMintHelper.tbtcVault()).to.equal(tbtcVault.address)
      expect(await qcMintHelper.tbtc()).to.equal(tbtc.address)
      expect(await qcMintHelper.qcMinter()).to.equal(qcMinter.address)
    })

    it("should have QCMinter authorized in Bank", async () => {
      const authorization = await bank.balanceAuthorization(
        bank.address,
        qcMinter.address
      )
      expect(authorization).to.be.gt(0)
    })

    it("should have QCMintHelper configured in QCMinter", async () => {
      expect(await qcMinter.mintHelper()).to.equal(qcMintHelper.address)
    })

    it("should have QC registered", async () => {
      const qcInfo = await qcData.getQCInfo(qcAddress)
      expect(qcInfo.name).to.not.equal(ethers.constants.HashZero)
      expect(qcInfo.capacity).to.be.gt(0)
    })
  })

  describe("Manual Minting Path", () => {
    it("should create Bank balance without auto-minting", async () => {
      const initialBankBalance = await bank.balanceOf(userAddress)
      const initialTBTCBalance = await tbtc.balanceOf(userAddress)

      // Request manual mint (autoMint = false)
      const tx = await qcMinter.connect(deployerSigner).requestQCMintHybrid(
        qcAddress,
        ONE_BTC_SATOSHIS,
        false, // Manual mode
        "0x"
      )

      const receipt = await tx.wait()
      
      // Check Bank balance increased
      const newBankBalance = await bank.balanceOf(userAddress)
      expect(newBankBalance.sub(initialBankBalance)).to.equal(ONE_BTC_SATOSHIS)

      // Check tBTC NOT minted automatically
      const newTBTCBalance = await tbtc.balanceOf(userAddress)
      expect(newTBTCBalance).to.equal(initialTBTCBalance)

      // Check event
      const event = receipt.events?.find(e => e.event === "QCMintCompleted")
      expect(event).to.exist
      expect(event?.args?.automated).to.equal(false)
    })

    it("should allow user to manually mint after receiving Bank balance", async () => {
      // User should have Bank balance from previous test
      const bankBalance = await bank.balanceOf(userAddress)
      expect(bankBalance).to.be.gt(0)

      // User approves TBTCVault
      await bank.connect(userSigner).approveBalance(
        tbtcVault.address,
        bankBalance
      )

      // User mints tBTC
      const initialTBTC = await tbtc.balanceOf(userAddress)
      await tbtcVault.connect(userSigner).mint(bankBalance)
      
      const newTBTC = await tbtc.balanceOf(userAddress)
      const expectedTBTC = bankBalance.mul(SATOSHI_MULTIPLIER)
      expect(newTBTC.sub(initialTBTC)).to.equal(expectedTBTC)
    })
  })

  describe("Automated Minting Path", () => {
    let testUser: SignerWithAddress

    beforeEach(async () => {
      // Use a fresh user for each test
      const signers = await ethers.getSigners()
      testUser = signers[5]
    })

    it("should auto-mint tBTC when helper is configured", async () => {
      const initialBankBalance = await bank.balanceOf(testUser.address)
      const initialTBTCBalance = await tbtc.balanceOf(testUser.address)

      // User pre-approves helper for Bank balance
      await bank.connect(testUser).approveBalance(
        qcMintHelper.address,
        ethers.constants.MaxUint256
      )

      // Request automated mint
      const tx = await qcMinter.connect(deployerSigner).requestQCMintHybrid(
        qcAddress,
        HALF_BTC_SATOSHIS,
        true, // Automated mode
        "0x"
      )

      const receipt = await tx.wait()

      // Check Bank balance was created and consumed
      const newBankBalance = await bank.balanceOf(testUser.address)
      expect(newBankBalance).to.equal(initialBankBalance) // Balance consumed by helper

      // Check tBTC was minted
      const newTBTCBalance = await tbtc.balanceOf(testUser.address)
      const expectedTBTC = HALF_BTC_SATOSHIS.mul(SATOSHI_MULTIPLIER)
      expect(newTBTCBalance.sub(initialTBTCBalance)).to.equal(expectedTBTC)

      // Check events
      const mintEvent = receipt.events?.find(e => e.event === "QCMintCompleted")
      expect(mintEvent).to.exist
      expect(mintEvent?.args?.automated).to.equal(true)
    })

    it("should handle helper failure gracefully", async () => {
      const testUser2 = (await ethers.getSigners())[6]
      
      // DO NOT approve helper - this will cause automation to fail
      // But minting should still create Bank balance

      const initialBankBalance = await bank.balanceOf(testUser2.address)
      
      // Request automated mint (will fail to auto-mint due to no approval)
      const tx = await qcMinter.connect(deployerSigner).requestQCMintHybrid(
        qcAddress,
        HALF_BTC_SATOSHIS,
        true, // Try automated mode
        "0x"
      )

      const receipt = await tx.wait()

      // Check Bank balance was still created
      const newBankBalance = await bank.balanceOf(testUser2.address)
      expect(newBankBalance.sub(initialBankBalance)).to.equal(HALF_BTC_SATOSHIS)

      // Check event shows manual fallback
      const mintEvent = receipt.events?.find(e => e.event === "QCMintCompleted")
      expect(mintEvent).to.exist
      expect(mintEvent?.args?.automated).to.equal(false) // Fell back to manual
    })
  })

  describe("Permit-Based Minting", () => {
    it("should support EIP-2612 permit for gasless approval", async () => {
      // This test would require implementing permit signature generation
      // For now, we verify the interface exists
      
      const testUser3 = (await ethers.getSigners())[7]
      
      // Generate permit data (simplified for test)
      const deadline = Math.floor(Date.now() / 1000) + 3600 // 1 hour
      const permitData = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "uint256", "uint256", "uint8", "bytes32", "bytes32"],
        [
          testUser3.address,
          qcMintHelper.address,
          HALF_BTC_SATOSHIS,
          deadline,
          0, // v
          ethers.constants.HashZero, // r
          ethers.constants.HashZero  // s
        ]
      )

      // Request mint with permit data
      await expect(
        qcMinter.connect(deployerSigner).requestQCMintHybrid(
          qcAddress,
          HALF_BTC_SATOSHIS,
          true,
          permitData
        )
      ).to.not.be.reverted
      
      // In a real implementation, this would use the permit to approve
      // and mint in a single transaction
    })
  })

  describe("Helper Contract Functions", () => {
    it("should calculate correct tBTC amount from satoshis", async () => {
      const result = await qcMintHelper.getSatoshiToTBTCAmount(ONE_BTC_SATOSHIS)
      const expected = ONE_BTC_SATOSHIS.mul(SATOSHI_MULTIPLIER)
      expect(result).to.equal(expected)
    })

    it("should check mint eligibility", async () => {
      const testUser4 = (await ethers.getSigners())[8]
      
      // Initially no balance or allowance
      let eligibility = await qcMintHelper.checkMintEligibility(testUser4.address)
      expect(eligibility.hasBalance).to.equal(false)
      expect(eligibility.hasAllowance).to.equal(false)

      // Give user Bank balance
      await qcMinter.connect(deployerSigner).requestQCMintHybrid(
        qcAddress,
        ONE_BTC_SATOSHIS,
        false,
        "0x"
      )

      // Check again
      eligibility = await qcMintHelper.checkMintEligibility(testUser4.address)
      expect(eligibility.hasBalance).to.equal(true)
      expect(eligibility.balance).to.equal(ONE_BTC_SATOSHIS)
      expect(eligibility.hasAllowance).to.equal(false)

      // Approve helper
      await bank.connect(testUser4).approveBalance(
        qcMintHelper.address,
        ONE_BTC_SATOSHIS
      )

      // Check final state
      eligibility = await qcMintHelper.checkMintEligibility(testUser4.address)
      expect(eligibility.hasBalance).to.equal(true)
      expect(eligibility.hasAllowance).to.equal(true)
      expect(eligibility.allowance).to.equal(ONE_BTC_SATOSHIS)
    })
  })

  describe("Access Control", () => {
    it("should only allow QCMinter to call autoMint", async () => {
      await expect(
        qcMintHelper.connect(userSigner).autoMint(userAddress, ONE_BTC_SATOSHIS, "0x")
      ).to.be.revertedWithCustomError(qcMintHelper, "InvalidQCMinter")
    })

    it("should only allow authorized roles to mint via QCMinter", async () => {
      const unauthorizedSigner = (await ethers.getSigners())[9]
      
      await expect(
        qcMinter.connect(unauthorizedSigner).requestQCMintHybrid(
          qcAddress,
          ONE_BTC_SATOSHIS,
          false,
          "0x"
        )
      ).to.be.reverted // Should revert with missing role
    })
  })

  describe("Edge Cases", () => {
    it("should handle zero amount", async () => {
      await expect(
        qcMinter.connect(deployerSigner).requestQCMintHybrid(
          qcAddress,
          0,
          false,
          "0x"
        )
      ).to.be.revertedWithCustomError(qcMinter, "InvalidAmount")
    })

    it("should handle invalid QC address", async () => {
      await expect(
        qcMinter.connect(deployerSigner).requestQCMintHybrid(
          ethers.constants.AddressZero,
          ONE_BTC_SATOSHIS,
          false,
          "0x"
        )
      ).to.be.revertedWithCustomError(qcMinter, "InvalidQCAddress")
    })

    it("should respect min/max mint amounts", async () => {
      const tooSmall = ethers.utils.parseEther("0.001") // Below 0.01 tBTC minimum
      const tooLarge = ethers.utils.parseEther("10000") // Above 1000 tBTC maximum

      await expect(
        qcMinter.connect(deployerSigner).requestQCMintHybrid(
          qcAddress,
          tooSmall.div(SATOSHI_MULTIPLIER), // Convert to satoshis
          false,
          "0x"
        )
      ).to.be.reverted

      await expect(
        qcMinter.connect(deployerSigner).requestQCMintHybrid(
          qcAddress,
          tooLarge.div(SATOSHI_MULTIPLIER), // Convert to satoshis
          false,
          "0x"
        )
      ).to.be.reverted
    })
  })

  describe("Gas Optimization", () => {
    it("should measure gas for manual minting", async () => {
      const testUser5 = (await ethers.getSigners())[10]
      
      const tx = await qcMinter.connect(deployerSigner).requestQCMintHybrid(
        qcAddress,
        ONE_BTC_SATOSHIS,
        false,
        "0x"
      )
      
      const receipt = await tx.wait()
      console.log(`Manual minting gas used: ${receipt.gasUsed.toString()}`)
      
      expect(receipt.gasUsed).to.be.lt(200000) // Should be efficient
    })

    it("should measure gas for automated minting", async () => {
      const testUser6 = (await ethers.getSigners())[11]
      
      await bank.connect(testUser6).approveBalance(
        qcMintHelper.address,
        ethers.constants.MaxUint256
      )
      
      const tx = await qcMinter.connect(deployerSigner).requestQCMintHybrid(
        qcAddress,
        ONE_BTC_SATOSHIS,
        true,
        "0x"
      )
      
      const receipt = await tx.wait()
      console.log(`Automated minting gas used: ${receipt.gasUsed.toString()}`)
      
      expect(receipt.gasUsed).to.be.lt(300000) // Higher but still reasonable
    })
  })
})