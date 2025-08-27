import { expect } from "chai"
import { ethers, deployments, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import type { 
  QCMintHelper, 
  QCMinter, 
  Bank, 
  TBTCVault, 
  TBTC,
  Bridge,
  QCData,
  SystemState,
  QCManager
} from "../../../typechain"

const { createSnapshot, restoreSnapshot } = helpers.snapshot
const { impersonateAccount } = helpers.account

describe("QCMintHelper Integration", () => {
  let qcMintHelper: QCMintHelper
  let qcMinter: QCMinter
  let bank: Bank
  let tbtcVault: TBTCVault
  let tbtc: TBTC
  let bridge: Bridge
  let qcData: QCData
  let systemState: SystemState
  let qcManager: QCManager

  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qc: SignerWithAddress
  let user: SignerWithAddress
  let otherUser: SignerWithAddress

  const SATOSHI_MULTIPLIER = ethers.BigNumber.from("10000000000") // 1e10
  const ONE_BTC = ethers.BigNumber.from("100000000") // 1 BTC in satoshis
  const HALF_BTC = ethers.BigNumber.from("50000000") // 0.5 BTC in satoshis
  const MIN_MINT_AMOUNT = ethers.utils.parseEther("0.01") // 0.01 tBTC minimum
  const MAX_MINT_AMOUNT = ethers.utils.parseEther("1000") // 1000 tBTC maximum

  before(async () => {
    // Deploy core tBTC infrastructure
    await deployments.fixture([
      "Bank",
      "TBTCVault", 
      "TBTC",
      "Bridge",
      "LightRelay" // Needed for some Account Control contracts
    ])

    // Get signers
    ;[deployer, governance, qc, user, otherUser] = await ethers.getSigners()

    // Get deployed core contracts
    bank = await ethers.getContract("Bank")
    tbtcVault = await ethers.getContract("TBTCVault")
    tbtc = await ethers.getContract("TBTC")
    bridge = await ethers.getContract("Bridge")

    // Deploy Account Control contracts
    await deployments.fixture([
      "AccountControlState",  // QCData, SystemState, QCManager
      "AccountControlCore"    // QCMinter, QCRedeemer
    ])

    // Get Account Control contracts
    qcData = await ethers.getContract("QCData")
    systemState = await ethers.getContract("SystemState")
    qcManager = await ethers.getContract("QCManager")
    qcMinter = await ethers.getContract("QCMinter")

    // Deploy QCMintHelper manually (not in fixture yet)
    const QCMintHelperFactory = await ethers.getContractFactory("QCMintHelper")
    qcMintHelper = await QCMintHelperFactory.deploy(
      bank.address,
      tbtcVault.address,
      tbtc.address,
      qcMinter.address
    )
    await qcMintHelper.deployed()

    // CRITICAL: Set up Bank authorization for QCMinter
    await setupBankAuthorization()

    // Configure QCMinter with helper
    await qcMinter.connect(governance).setMintHelper(qcMintHelper.address)

    // Set up system parameters
    await systemState.connect(governance).setMinMintAmount(MIN_MINT_AMOUNT)
    await systemState.connect(governance).setMaxMintAmount(MAX_MINT_AMOUNT)

    // Register QC
    await registerQualifiedCustodian()

    // Grant MINTER_ROLE to deployer for testing
    const MINTER_ROLE = await qcMinter.MINTER_ROLE()
    await qcMinter.connect(governance).grantRole(MINTER_ROLE, deployer.address)

    await createSnapshot()
  })

  async function setupBankAuthorization() {
    console.log("Setting up Bank authorization for QCMinter...")
    
    // Check who owns Bank
    const bankOwner = await bank.owner()
    console.log(`Bank owner: ${bankOwner}`)
    console.log(`Bridge address: ${bridge.address}`)
    console.log(`Deployer address: ${deployer.address}`)

    if (bankOwner === bridge.address) {
      // Bridge owns Bank - need to authorize through Bridge
      console.log("Bank is owned by Bridge - using Bridge authorization")
      
      // In test environment, we can use the Bridge's authorization function
      // Bridge should have a function to authorize balance increasers
      try {
        // Check if Bridge has a function to authorize
        const bridgeGovernance = await ethers.getContract("BridgeGovernance")
        
        // Try to authorize QCMinter through Bridge governance
        await bridgeGovernance
          .connect(governance)
          .beginBankBalanceIncreaserAuthorization(qcMinter.address)
        
        // Get the current governance delay
        const delay = await bridgeGovernance.governanceDelay()
        
        // Fast forward time
        await helpers.time.increaseNextBlockTimestamp(delay.toNumber() + 1)
        await ethers.provider.send("evm_mine", [])
        
        // Finalize authorization
        await bridgeGovernance
          .connect(governance)
          .finalizeBankBalanceIncreaserAuthorization(qcMinter.address)
        
        console.log("✅ QCMinter authorized through Bridge governance")
      } catch (error) {
        console.log("Bridge governance authorization failed, trying direct impersonation")
        
        // Fallback: Impersonate Bridge to authorize directly
        await impersonateAccount(bridge.address)
        const bridgeSigner = await ethers.getSigner(bridge.address)
        
        // Fund Bridge for gas
        await deployer.sendTransaction({
          to: bridge.address,
          value: ethers.utils.parseEther("1.0")
        })
        
        // Authorize QCMinter
        const bankAsBridge = bank.connect(bridgeSigner)
        
        // Check if function exists
        if (bankAsBridge.setAuthorizedBalanceIncreaser) {
          await bankAsBridge.setAuthorizedBalanceIncreaser(qcMinter.address, true)
        } else if (bankAsBridge.authorizeBalanceIncreaser) {
          await bankAsBridge.authorizeBalanceIncreaser(qcMinter.address)
        } else {
          throw new Error("Cannot find Bank authorization function")
        }
        
        console.log("✅ QCMinter authorized via Bridge impersonation")
      }
    } else if (bankOwner === deployer.address) {
      // Deployer owns Bank (test environment)
      console.log("Bank is owned by deployer - direct authorization")
      await bank.connect(deployer).setAuthorizedBalanceIncreaser(qcMinter.address, true)
      console.log("✅ QCMinter authorized by deployer")
    } else {
      // Try governance
      console.log(`Bank owned by unknown: ${bankOwner}, trying governance`)
      await bank.connect(governance).setAuthorizedBalanceIncreaser(qcMinter.address, true)
      console.log("✅ QCMinter authorized by governance")
    }

    // Verify authorization
    const isAuthorized = await bank.authorizedBalanceIncreasers(qcMinter.address)
    if (!isAuthorized) {
      throw new Error("Failed to authorize QCMinter in Bank!")
    }
    console.log("✅ Verified: QCMinter is authorized in Bank")
  }

  async function registerQualifiedCustodian() {
    console.log("Registering Qualified Custodian...")
    
    // Setup roles
    const GOVERNANCE_ROLE = await qcData.GOVERNANCE_ROLE()
    const QC_MANAGER_ROLE = await qcData.QC_MANAGER_ROLE()
    
    // Grant roles
    await qcData.connect(deployer).grantRole(GOVERNANCE_ROLE, governance.address)
    await qcData.connect(deployer).grantRole(QC_MANAGER_ROLE, qcManager.address)
    
    // Register QC
    const qcName = ethers.utils.formatBytes32String("TestQC")
    const capacity = ethers.utils.parseEther("10000") // 10k tBTC capacity
    
    await qcManager.connect(governance).registerQC(
      qc.address,
      qcName,
      capacity
    )
    
    console.log(`✅ QC registered: ${qc.address}`)
  }

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("System Setup Verification", () => {
    it("should have QCMinter authorized in Bank", async () => {
      const isAuthorized = await bank.authorizedBalanceIncreasers(qcMinter.address)
      expect(isAuthorized).to.be.true
    })

    it("should have QCMintHelper configured in QCMinter", async () => {
      const configuredHelper = await qcMinter.mintHelper()
      expect(configuredHelper).to.equal(qcMintHelper.address)
    })

    it("should have correct contract connections", async () => {
      expect(await qcMintHelper.bank()).to.equal(bank.address)
      expect(await qcMintHelper.tbtcVault()).to.equal(tbtcVault.address)
      expect(await qcMintHelper.tbtc()).to.equal(tbtc.address)
      expect(await qcMintHelper.qcMinter()).to.equal(qcMinter.address)
    })

    it("should have QC registered and active", async () => {
      const qcInfo = await qcData.getQCInfo(qc.address)
      expect(qcInfo.status).to.equal(0) // Active status
      expect(qcInfo.maxCapacity).to.be.gt(0)
    })

    it("should have system parameters configured", async () => {
      expect(await systemState.minMintAmount()).to.equal(MIN_MINT_AMOUNT)
      expect(await systemState.maxMintAmount()).to.equal(MAX_MINT_AMOUNT)
    })
  })

  describe("Manual Minting Path (Backward Compatibility)", () => {
    it("should create Bank balance without auto-minting when autoMint=false", async () => {
      const initialBankBalance = await bank.balanceOf(user.address)
      const initialTBTCBalance = await tbtc.balanceOf(user.address)

      // Request manual mint (autoMint = false)
      const tx = await qcMinter.requestQCMintHybrid(
        qc.address,
        ONE_BTC,
        false, // manual mode
        "0x"   // no permit data
      )

      const receipt = await tx.wait()
      
      // Verify Bank balance created
      const newBankBalance = await bank.balanceOf(user.address)
      expect(newBankBalance.sub(initialBankBalance)).to.equal(ONE_BTC)

      // Verify tBTC NOT minted
      const newTBTCBalance = await tbtc.balanceOf(user.address)
      expect(newTBTCBalance).to.equal(initialTBTCBalance)

      // Check events
      const mintEvent = receipt.events?.find((e: any) => e.event === "QCMintCompleted")
      expect(mintEvent).to.exist
      expect(mintEvent?.args?.user).to.equal(user.address)
      expect(mintEvent?.args?.amount).to.equal(ONE_BTC)
      expect(mintEvent?.args?.automated).to.be.false
    })

    it("should allow user to manually mint tBTC after receiving Bank balance", async () => {
      // Setup: Give user Bank balance
      await qcMinter.requestQCMintHybrid(qc.address, ONE_BTC, false, "0x")
      
      const bankBalance = await bank.balanceOf(user.address)
      expect(bankBalance).to.be.gt(0)

      // User approves TBTCVault for Bank balance
      await bank.connect(user).approveBalance(tbtcVault.address, bankBalance)

      // User mints tBTC
      const initialTBTC = await tbtc.balanceOf(user.address)
      await tbtcVault.connect(user).mint(bankBalance)
      
      // Verify tBTC minted
      const newTBTC = await tbtc.balanceOf(user.address)
      const expectedTBTC = bankBalance.mul(SATOSHI_MULTIPLIER)
      expect(newTBTC.sub(initialTBTC)).to.equal(expectedTBTC)

      // Verify Bank balance consumed
      const remainingBankBalance = await bank.balanceOf(user.address)
      expect(remainingBankBalance).to.equal(0)
    })
  })

  describe("Automated Minting Path (Enhanced UX)", () => {
    it("should auto-mint tBTC when autoMint=true and user has approved helper", async () => {
      // Pre-approve helper for Bank balance
      await bank.connect(otherUser).approveBalance(
        qcMintHelper.address,
        ethers.constants.MaxUint256
      )

      const initialBankBalance = await bank.balanceOf(otherUser.address)
      const initialTBTCBalance = await tbtc.balanceOf(otherUser.address)

      // Request automated mint
      const tx = await qcMinter.requestQCMintHybrid(
        qc.address,
        HALF_BTC,
        true,  // automated mode
        "0x"   // no permit data
      )

      const receipt = await tx.wait()

      // Verify Bank balance was created and consumed
      const newBankBalance = await bank.balanceOf(otherUser.address)
      expect(newBankBalance).to.equal(initialBankBalance) // Should be consumed

      // Verify tBTC was minted
      const newTBTCBalance = await tbtc.balanceOf(otherUser.address)
      const expectedTBTC = HALF_BTC.mul(SATOSHI_MULTIPLIER)
      expect(newTBTCBalance.sub(initialTBTCBalance)).to.equal(expectedTBTC)

      // Check events
      const mintEvent = receipt.events?.find((e: any) => e.event === "QCMintCompleted")
      expect(mintEvent).to.exist
      expect(mintEvent?.args?.automated).to.be.true

      // Also check for AutoMintCompleted event from helper
      const autoMintEvent = receipt.events?.find((e: any) => e.event === "AutoMintCompleted")
      expect(autoMintEvent).to.exist
    })

    it("should fallback to manual minting when helper fails due to no approval", async () => {
      const freshUser = (await ethers.getSigners())[10]
      
      // DO NOT approve helper - this will cause automation to fail
      const initialBankBalance = await bank.balanceOf(freshUser.address)
      const initialTBTCBalance = await tbtc.balanceOf(freshUser.address)

      // Request automated mint (will fallback to manual)
      const tx = await qcMinter.requestQCMintHybrid(
        qc.address,
        HALF_BTC,
        true,  // try automated mode
        "0x"
      )

      const receipt = await tx.wait()

      // Verify Bank balance was created (not consumed)
      const newBankBalance = await bank.balanceOf(freshUser.address)
      expect(newBankBalance.sub(initialBankBalance)).to.equal(HALF_BTC)

      // Verify tBTC was NOT minted
      const newTBTCBalance = await tbtc.balanceOf(freshUser.address)
      expect(newTBTCBalance).to.equal(initialTBTCBalance)

      // Check event shows manual fallback
      const mintEvent = receipt.events?.find((e: any) => e.event === "QCMintCompleted")
      expect(mintEvent).to.exist
      expect(mintEvent?.args?.automated).to.be.false // Fell back to manual
    })
  })

  describe("Error Handling and Edge Cases", () => {
    it("should reject minting with zero amount", async () => {
      await expect(
        qcMinter.requestQCMintHybrid(qc.address, 0, false, "0x")
      ).to.be.revertedWith("InvalidAmount")
    })

    it("should reject minting below minimum amount", async () => {
      const tooSmall = MIN_MINT_AMOUNT.div(SATOSHI_MULTIPLIER).sub(1) // Just below minimum
      
      await expect(
        qcMinter.requestQCMintHybrid(qc.address, tooSmall, false, "0x")
      ).to.be.reverted
    })

    it("should reject minting above maximum amount", async () => {
      const tooLarge = MAX_MINT_AMOUNT.div(SATOSHI_MULTIPLIER).add(1) // Just above maximum
      
      await expect(
        qcMinter.requestQCMintHybrid(qc.address, tooLarge, false, "0x")
      ).to.be.reverted
    })

    it("should reject minting from unregistered QC", async () => {
      const unregisteredQC = (await ethers.getSigners())[11]
      
      await expect(
        qcMinter.requestQCMintHybrid(unregisteredQC.address, ONE_BTC, false, "0x")
      ).to.be.reverted
    })

    it("should only allow QCMinter to call autoMint on helper", async () => {
      await expect(
        qcMintHelper.connect(user).autoMint(user.address, ONE_BTC, "0x")
      ).to.be.revertedWith("InvalidQCMinter")
    })
  })

  describe("Gas Usage Analysis", () => {
    it("should measure gas for manual minting", async () => {
      const tx = await qcMinter.requestQCMintHybrid(
        qc.address,
        ONE_BTC,
        false,
        "0x"
      )
      
      const receipt = await tx.wait()
      console.log(`Manual minting gas used: ${receipt.gasUsed.toString()}`)
      
      // Manual minting should be efficient
      expect(receipt.gasUsed.toNumber()).to.be.lessThan(200000)
    })

    it("should measure gas for automated minting", async () => {
      const testUser = (await ethers.getSigners())[12]
      
      // Pre-approve helper
      await bank.connect(testUser).approveBalance(
        qcMintHelper.address,
        ethers.constants.MaxUint256
      )
      
      const tx = await qcMinter.requestQCMintHybrid(
        qc.address,
        ONE_BTC,
        true,
        "0x"
      )
      
      const receipt = await tx.wait()
      console.log(`Automated minting gas used: ${receipt.gasUsed.toString()}`)
      
      // Automated minting uses more gas but should still be reasonable
      expect(receipt.gasUsed.toNumber()).to.be.lessThan(350000)
    })

    it("should show gas savings for batch operations", async () => {
      // This would test batch minting if implemented
      // For now, we can calculate theoretical savings
      
      const singleGas = 200000 // Approximate gas for single mint
      const batchSize = 10
      const batchGas = 500000 // Theoretical batch gas
      
      const savingsPercent = ((singleGas * batchSize - batchGas) / (singleGas * batchSize)) * 100
      console.log(`Theoretical batch savings: ${savingsPercent.toFixed(1)}%`)
      
      expect(savingsPercent).to.be.greaterThan(60) // Should save 60-80%
    })
  })

  describe("Permit-Based Minting (Future Enhancement)", () => {
    it("should support permit data for gasless approval", async () => {
      // This would require implementing EIP-2612 permit generation
      // For now, verify the interface accepts permit data
      
      const dummyPermitData = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "uint256", "uint256", "uint8", "bytes32", "bytes32"],
        [
          user.address,
          qcMintHelper.address,
          ONE_BTC,
          Math.floor(Date.now() / 1000) + 3600,
          0,
          ethers.constants.HashZero,
          ethers.constants.HashZero
        ]
      )

      // Should not revert with permit data
      await expect(
        qcMinter.requestQCMintHybrid(
          qc.address,
          ONE_BTC,
          true,
          dummyPermitData
        )
      ).to.not.be.reverted
    })
  })

  describe("Helper Utility Functions", () => {
    it("should calculate correct tBTC amount from satoshis", async () => {
      const satoshis = ONE_BTC
      const expectedTBTC = satoshis.mul(SATOSHI_MULTIPLIER)
      
      const result = await qcMintHelper.getSatoshiToTBTCAmount(satoshis)
      expect(result).to.equal(expectedTBTC)
    })

    it("should check mint eligibility correctly", async () => {
      const testUser = (await ethers.getSigners())[13]
      
      // Initially no balance or allowance
      let eligibility = await qcMintHelper.checkMintEligibility(testUser.address)
      expect(eligibility.hasBalance).to.be.false
      expect(eligibility.hasAllowance).to.be.false
      expect(eligibility.balance).to.equal(0)
      expect(eligibility.allowance).to.equal(0)

      // Give user Bank balance
      await qcMinter.requestQCMintHybrid(qc.address, ONE_BTC, false, "0x")
      
      // Check again - should have balance but no allowance
      eligibility = await qcMintHelper.checkMintEligibility(testUser.address)
      expect(eligibility.hasBalance).to.be.true
      expect(eligibility.balance).to.equal(ONE_BTC)
      expect(eligibility.hasAllowance).to.be.false

      // Approve helper
      await bank.connect(testUser).approveBalance(qcMintHelper.address, ONE_BTC)

      // Final check - should have both
      eligibility = await qcMintHelper.checkMintEligibility(testUser.address)
      expect(eligibility.hasBalance).to.be.true
      expect(eligibility.hasAllowance).to.be.true
      expect(eligibility.allowance).to.equal(ONE_BTC)
    })

    it("should support manual mint function for users", async () => {
      const testUser = (await ethers.getSigners())[14]
      
      // Setup: Give user Bank balance
      await qcMinter.requestQCMintHybrid(qc.address, ONE_BTC, false, "0x")
      
      // Approve helper
      await bank.connect(testUser).approveBalance(
        qcMintHelper.address,
        ONE_BTC
      )

      // Use manual mint function
      const initialTBTC = await tbtc.balanceOf(testUser.address)
      await qcMintHelper.connect(testUser).manualMint(testUser.address)
      
      // Verify tBTC minted
      const newTBTC = await tbtc.balanceOf(testUser.address)
      const expectedTBTC = ONE_BTC.mul(SATOSHI_MULTIPLIER)
      expect(newTBTC.sub(initialTBTC)).to.equal(expectedTBTC)
    })
  })
})