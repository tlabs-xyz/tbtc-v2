import { ethers, deployments, getNamedAccounts } from "hardhat"
import { expect } from "chai"
import type { QCMintHelper, QCMinter, Bank, TBTCVault, TBTC, QCData, SystemState, QCManager } from "../../typechain"

describe("QCMintHelper", () => {
  let qcMintHelper: QCMintHelper
  let qcMinter: QCMinter
  let bank: Bank
  let tbtcVault: TBTCVault
  let tbtc: TBTC
  let qcData: QCData
  let systemState: SystemState
  let qcManager: QCManager

  let deployer: string
  let governance: string
  let qc: string
  let user: string

  const SATOSHI_MULTIPLIER = ethers.BigNumber.from("10000000000") // 1e10

  before(async () => {
    await deployments.fixture()
    
    const accounts = await getNamedAccounts()
    deployer = accounts.deployer
    governance = accounts.governance || accounts.deployer
    
    const signers = await ethers.getSigners()
    qc = signers[1].address
    user = signers[2].address

    // Get deployed contracts
    bank = await ethers.getContract("Bank")
    tbtcVault = await ethers.getContract("TBTCVault")
    tbtc = await ethers.getContract("TBTC")
    qcData = await ethers.getContract("QCData")
    systemState = await ethers.getContract("SystemState")
    qcManager = await ethers.getContract("QCManager")
    qcMinter = await ethers.getContract("QCMinter")

    // Deploy QCMintHelper
    const QCMintHelperFactory = await ethers.getContractFactory("QCMintHelper")
    qcMintHelper = await QCMintHelperFactory.deploy(
      bank.address,
      tbtcVault.address,
      tbtc.address,
      qcMinter.address
    )
    await qcMintHelper.deployed()

    // Set up QCMinter with helper
    const governanceSigner = await ethers.getSigner(governance)
    await qcMinter.connect(governanceSigner).setMintHelper(qcMintHelper.address)
  })

  describe("Deployment", () => {
    it("should set correct immutable addresses", async () => {
      expect(await qcMintHelper.bank()).to.equal(bank.address)
      expect(await qcMintHelper.tbtcVault()).to.equal(tbtcVault.address)
      expect(await qcMintHelper.tbtc()).to.equal(tbtc.address)
      expect(await qcMintHelper.qcMinter()).to.equal(qcMinter.address)
    })

    it("should have correct SATOSHI_MULTIPLIER", async () => {
      expect(await qcMintHelper.SATOSHI_MULTIPLIER()).to.equal(SATOSHI_MULTIPLIER)
    })
  })

  describe("Access Control", () => {
    it("should only allow QCMinter to call autoMint", async () => {
      const userSigner = await ethers.getSigner(user)
      
      await expect(
        qcMintHelper.connect(userSigner).autoMint(user, 1000, "0x")
      ).to.be.revertedWithCustomError(qcMintHelper, "InvalidQCMinter")
    })
  })

  describe("Helper Functions", () => {
    it("should calculate correct tBTC amount from satoshis", async () => {
      const satoshis = ethers.BigNumber.from("100000000") // 1 BTC in satoshis
      const expectedTBTC = satoshis.mul(SATOSHI_MULTIPLIER) // 1 tBTC in wei
      
      expect(await qcMintHelper.getSatoshiToTBTCAmount(satoshis)).to.equal(expectedTBTC)
    })

    it("should check mint eligibility correctly", async () => {
      const result = await qcMintHelper.checkMintEligibility(user)
      expect(result.hasBalance).to.equal(false) // User has no Bank balance initially
      expect(result.hasAllowance).to.equal(false) // User hasn't approved helper
      expect(result.balance).to.equal(0)
      expect(result.allowance).to.equal(0)
    })
  })

  describe("Manual Minting", () => {
    it("should revert when user has no balance", async () => {
      await expect(
        qcMintHelper.manualMint(user)
      ).to.be.revertedWithCustomError(qcMintHelper, "ZeroAmount")
    })

    it("should revert with zero address", async () => {
      await expect(
        qcMintHelper.manualMint(ethers.constants.AddressZero)
      ).to.be.revertedWithCustomError(qcMintHelper, "InvalidUser")
    })
  })

  // Note: Full integration tests would require setting up QC registration,
  // Bank authorization, and proper role configurations which is complex
  // for a unit test. Those should be covered in integration tests.
})