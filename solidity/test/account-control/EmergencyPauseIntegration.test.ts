import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import { 
  QCMinter,
  QCRedeemer,
  BasicMintingPolicy,
  BasicRedemptionPolicy,
  SystemState,
  ProtocolRegistry,
  QCData,
  QCManager,
  TBTC,
  Bank,
  TBTCVault,
  IMintingPolicy,
  IRedemptionPolicy
} from "../../typechain"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("Emergency Pause Integration", () => {
  let deployer: SignerWithAddress
  let user: SignerWithAddress
  let qcAddress: SignerWithAddress
  let pauser: SignerWithAddress
  let thirdParty: SignerWithAddress

  let qcMinter: QCMinter
  let qcRedeemer: QCRedeemer
  let basicMintingPolicy: BasicMintingPolicy
  let basicRedemptionPolicy: BasicRedemptionPolicy
  let systemState: SystemState
  let protocolRegistry: ProtocolRegistry
  
  // Mock contracts
  let mockQcData: FakeContract<QCData>
  let mockTbtc: FakeContract<TBTC>
  let mockBank: FakeContract<Bank>
  let mockTbtcVault: FakeContract<TBTCVault>

  // Role constants
  let PAUSER_ROLE: string
  let MINTER_ROLE: string
  let REDEEMER_ROLE: string
  
  // Service keys
  let SYSTEM_STATE_KEY: string
  let MINTING_POLICY_KEY: string
  let REDEMPTION_POLICY_KEY: string
  let QC_DATA_KEY: string
  let TBTC_TOKEN_KEY: string
  let BANK_KEY: string
  let TBTC_VAULT_KEY: string

  // Test data
  const mintAmount = ethers.utils.parseEther("5")
  const emergencyReason = ethers.utils.id("SECURITY_INCIDENT")

  before(async () => {
    const signers = await ethers.getSigners()
    deployer = signers[0]
    user = signers[1]
    qcAddress = signers[2]
    pauser = signers[3]
    thirdParty = signers[4]

    // Generate role constants
    PAUSER_ROLE = ethers.utils.id("PAUSER_ROLE")
    MINTER_ROLE = ethers.utils.id("MINTER_ROLE") 
    REDEEMER_ROLE = ethers.utils.id("REDEEMER_ROLE")
    
    // Generate service keys
    SYSTEM_STATE_KEY = ethers.utils.id("SYSTEM_STATE")
    MINTING_POLICY_KEY = ethers.utils.id("MINTING_POLICY")
    REDEMPTION_POLICY_KEY = ethers.utils.id("REDEMPTION_POLICY")
    QC_DATA_KEY = ethers.utils.id("QC_DATA")
    TBTC_TOKEN_KEY = ethers.utils.id("TBTC_TOKEN")
    BANK_KEY = ethers.utils.id("BANK")
    TBTC_VAULT_KEY = ethers.utils.id("TBTC_VAULT")
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy ProtocolRegistry
    const ProtocolRegistryFactory = await ethers.getContractFactory("ProtocolRegistry")
    protocolRegistry = await ProtocolRegistryFactory.deploy()
    await protocolRegistry.deployed()

    // Deploy SystemState
    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy()
    await systemState.deployed()
    
    // Grant PAUSER_ROLE to pauser
    await systemState.grantRole(PAUSER_ROLE, pauser.address)

    // Create mock contracts
    mockQcData = await smock.fake<QCData>("QCData")
    mockTbtc = await smock.fake<TBTC>("TBTC")
    mockBank = await smock.fake<Bank>("Bank")
    mockTbtcVault = await smock.fake<TBTCVault>("TBTCVault")

    // Deploy BasicMintingPolicy 
    const BasicMintingPolicyFactory = await ethers.getContractFactory("BasicMintingPolicy")
    basicMintingPolicy = await BasicMintingPolicyFactory.deploy(
      protocolRegistry.address,
      mockBank.address,
      mockTbtcVault.address,
      mockTbtc.address
    )
    await basicMintingPolicy.deployed()

    // Deploy BasicRedemptionPolicy
    const BasicRedemptionPolicyFactory = await ethers.getContractFactory("BasicRedemptionPolicy")
    basicRedemptionPolicy = await BasicRedemptionPolicyFactory.deploy(
      protocolRegistry.address
    )
    await basicRedemptionPolicy.deployed()

    // Deploy QCMinter
    const QCMinterFactory = await ethers.getContractFactory("QCMinter")
    qcMinter = await QCMinterFactory.deploy(protocolRegistry.address)
    await qcMinter.deployed()
    
    // Grant MINTER_ROLE to user for testing
    await qcMinter.grantRole(MINTER_ROLE, user.address)
    await basicMintingPolicy.grantRole(MINTER_ROLE, qcMinter.address)

    // Deploy QCRedeemer
    const QCRedeemerFactory = await ethers.getContractFactory("QCRedeemer")
    qcRedeemer = await QCRedeemerFactory.deploy(protocolRegistry.address)
    await qcRedeemer.deployed()
    
    // Grant REDEEMER_ROLE for testing
    await basicRedemptionPolicy.grantRole(REDEEMER_ROLE, qcRedeemer.address)

    // Register services in ProtocolRegistry
    await protocolRegistry.registerService(SYSTEM_STATE_KEY, systemState.address)
    await protocolRegistry.registerService(MINTING_POLICY_KEY, basicMintingPolicy.address)
    await protocolRegistry.registerService(REDEMPTION_POLICY_KEY, basicRedemptionPolicy.address)
    await protocolRegistry.registerService(QC_DATA_KEY, mockQcData.address)
    await protocolRegistry.registerService(TBTC_TOKEN_KEY, mockTbtc.address)
    await protocolRegistry.registerService(BANK_KEY, mockBank.address)
    await protocolRegistry.registerService(TBTC_VAULT_KEY, mockTbtcVault.address)

    // Set up basic mock responses for successful operations
    mockQcData.isQCRegistered.returns(true)
    mockQcData.getQCStatus.returns(0) // Active
    mockTbtc.balanceOf.returns(mintAmount.mul(2))
    mockBank.hasRole.returns(true)
    mockTbtcVault.mint.returns(ethers.utils.id("mint_result"))
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("QCMinter Emergency Pause Integration", () => {
    it("should allow minting when QC is not emergency paused", async () => {
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be.false

      await expect(
        qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
      ).to.not.be.reverted
    })

    it("should block minting when QC is emergency paused", async () => {
      // Emergency pause the QC
      await systemState.connect(pauser).emergencyPauseQC(qcAddress.address, emergencyReason)
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be.true

      // Attempt to mint should revert
      await expect(
        qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
      ).to.be.revertedWith("QCIsEmergencyPaused")
    })

    it("should allow minting after emergency unpause", async () => {
      // Emergency pause then unpause the QC
      await systemState.connect(pauser).emergencyPauseQC(qcAddress.address, emergencyReason)
      await systemState.connect(pauser).emergencyUnpauseQC(qcAddress.address)
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be.false

      // Should be able to mint again
      await expect(
        qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
      ).to.not.be.reverted
    })
  })

  describe("QCRedeemer Emergency Pause Integration", () => {
    const userBtcAddress = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"

    it("should allow redemption when QC is not emergency paused", async () => {
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be.false

      await expect(
        qcRedeemer.initiateRedemption(qcAddress.address, mintAmount, userBtcAddress)
      ).to.not.be.reverted
    })

    it("should block redemption when QC is emergency paused", async () => {
      // Emergency pause the QC
      await systemState.connect(pauser).emergencyPauseQC(qcAddress.address, emergencyReason)
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be.true

      // Attempt to redeem should revert
      await expect(
        qcRedeemer.initiateRedemption(qcAddress.address, mintAmount, userBtcAddress)
      ).to.be.revertedWith("QCIsEmergencyPaused")
    })

    it("should allow redemption after emergency unpause", async () => {
      // Emergency pause then unpause the QC
      await systemState.connect(pauser).emergencyPauseQC(qcAddress.address, emergencyReason)
      await systemState.connect(pauser).emergencyUnpauseQC(qcAddress.address)
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be.false

      // Should be able to redeem again
      await expect(
        qcRedeemer.initiateRedemption(qcAddress.address, mintAmount, userBtcAddress)
      ).to.not.be.reverted
    })
  })

  describe("BasicMintingPolicy Emergency Pause Integration", () => {
    beforeEach(async () => {
      // Grant MINTER_ROLE to user for direct policy testing
      await basicMintingPolicy.grantRole(MINTER_ROLE, user.address)
    })

    it("should approve minting when QC is not emergency paused", async () => {
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be.false

      await expect(
        basicMintingPolicy.connect(user).requestMint(qcAddress.address, user.address, mintAmount)
      ).to.not.be.reverted
    })

    it("should reject minting when QC is emergency paused", async () => {
      // Emergency pause the QC
      await systemState.connect(pauser).emergencyPauseQC(qcAddress.address, emergencyReason)
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be.true

      // Attempt to mint should revert
      await expect(
        basicMintingPolicy.connect(user).requestMint(qcAddress.address, user.address, mintAmount)
      ).to.be.revertedWith("QCIsEmergencyPaused")
    })

    it("should emit MintRejected event when QC is emergency paused", async () => {
      // Emergency pause the QC
      await systemState.connect(pauser).emergencyPauseQC(qcAddress.address, emergencyReason)

      // Should emit rejection event
      await expect(
        basicMintingPolicy.connect(user).requestMint(qcAddress.address, user.address, mintAmount)
      ).to.emit(basicMintingPolicy, "MintRejected")
        .withArgs(qcAddress.address, user.address, mintAmount, "QC emergency paused", user.address, anyValue)
    })
  })

  describe("BasicRedemptionPolicy Emergency Pause Integration", () => {
    const redemptionId = ethers.utils.id("test_redemption")
    const userBtcAddress = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"

    beforeEach(async () => {
      // Grant REDEEMER_ROLE to user for direct policy testing
      await basicRedemptionPolicy.grantRole(REDEEMER_ROLE, user.address)
    })

    it("should validate redemption when QC is not emergency paused", async () => {
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be.false

      expect(await basicRedemptionPolicy.validateRedemptionRequest(
        user.address, 
        qcAddress.address, 
        mintAmount
      )).to.be.true
    })

    it("should reject redemption validation when QC is emergency paused", async () => {
      // Emergency pause the QC
      await systemState.connect(pauser).emergencyPauseQC(qcAddress.address, emergencyReason)
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be.true

      // Validation should return false
      expect(await basicRedemptionPolicy.validateRedemptionRequest(
        user.address, 
        qcAddress.address, 
        mintAmount
      )).to.be.false
    })

    it("should reject redemption request when QC is emergency paused", async () => {
      // Emergency pause the QC
      await systemState.connect(pauser).emergencyPauseQC(qcAddress.address, emergencyReason)
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be.true

      // Request should revert due to validation failure
      await expect(
        basicRedemptionPolicy.connect(user).requestRedemption(
          redemptionId,
          qcAddress.address,
          user.address,
          mintAmount,
          userBtcAddress
        )
      ).to.be.revertedWith("ValidationFailed")
    })
  })

  describe("Cross-Contract Emergency Pause Flow", () => {
    const userBtcAddress = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"

    it("should block all operations for a specific QC when emergency paused", async () => {
      // Verify normal operations work initially
      await expect(
        qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
      ).to.not.be.reverted
      
      await expect(
        qcRedeemer.initiateRedemption(qcAddress.address, mintAmount, userBtcAddress)
      ).to.not.be.reverted

      // Emergency pause the QC
      await systemState.connect(pauser).emergencyPauseQC(qcAddress.address, emergencyReason)
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be.true

      // All operations should now be blocked
      await expect(
        qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
      ).to.be.revertedWith("QCIsEmergencyPaused")

      await expect(
        qcRedeemer.initiateRedemption(qcAddress.address, mintAmount, userBtcAddress)
      ).to.be.revertedWith("QCIsEmergencyPaused")

      expect(await basicRedemptionPolicy.validateRedemptionRequest(
        user.address, 
        qcAddress.address, 
        mintAmount
      )).to.be.false
    })

    it("should only affect the specific emergency paused QC, not others", async () => {
      const [, , , anotherQC] = await ethers.getSigners()

      // Emergency pause only one QC
      await systemState.connect(pauser).emergencyPauseQC(qcAddress.address, emergencyReason)
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be.true
      expect(await systemState.isQCEmergencyPaused(anotherQC.address)).to.be.false

      // Operations should be blocked for paused QC
      await expect(
        qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
      ).to.be.revertedWith("QCIsEmergencyPaused")

      // Operations should still work for non-paused QC
      await expect(
        qcMinter.connect(user).requestQCMint(anotherQC.address, mintAmount)
      ).to.not.be.reverted
    })

    it("should restore all operations after emergency unpause", async () => {
      // Emergency pause then unpause the QC
      await systemState.connect(pauser).emergencyPauseQC(qcAddress.address, emergencyReason)
      await systemState.connect(pauser).emergencyUnpauseQC(qcAddress.address)
      expect(await systemState.isQCEmergencyPaused(qcAddress.address)).to.be.false

      // All operations should work again
      await expect(
        qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
      ).to.not.be.reverted

      await expect(
        qcRedeemer.initiateRedemption(qcAddress.address, mintAmount, userBtcAddress)
      ).to.not.be.reverted

      expect(await basicRedemptionPolicy.validateRedemptionRequest(
        user.address, 
        qcAddress.address, 
        mintAmount
      )).to.be.true
    })
  })

  describe("Emergency Pause Authority", () => {
    it("should only allow PAUSER_ROLE to emergency pause QCs", async () => {
      // Non-pauser should not be able to pause
      await expect(
        systemState.connect(thirdParty).emergencyPauseQC(qcAddress.address, emergencyReason)
      ).to.be.revertedWith(`AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${PAUSER_ROLE}`)

      // Pauser should be able to pause
      await expect(
        systemState.connect(pauser).emergencyPauseQC(qcAddress.address, emergencyReason)
      ).to.not.be.reverted
    })

    it("should only allow PAUSER_ROLE to emergency unpause QCs", async () => {
      // First pause the QC
      await systemState.connect(pauser).emergencyPauseQC(qcAddress.address, emergencyReason)

      // Non-pauser should not be able to unpause
      await expect(
        systemState.connect(thirdParty).emergencyUnpauseQC(qcAddress.address)
      ).to.be.revertedWith(`AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${PAUSER_ROLE}`)

      // Pauser should be able to unpause
      await expect(
        systemState.connect(pauser).emergencyUnpauseQC(qcAddress.address)
      ).to.not.be.reverted
    })
  })
})

// Helper function for testing events with dynamic timestamps
function anyValue() {
  return chai.Assertion.prototype.property("any")
}