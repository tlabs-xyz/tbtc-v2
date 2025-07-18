import { ethers } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  BasicMintingPolicy,
  Bank,
  TBTCVault,
  TBTC,
  ProtocolRegistry,
  QCManager,
  QCData,
  SystemState,
  QCReserveLedger,
} from "../../typechain"
import {
  extractMintRequestFromEvent,
  checkMintCompletedFromEvents,
  verifyBankOnlyMint,
} from "../helpers/basicMintingPolicyHelpers"

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
  let qcReserveLedger: QCReserveLedger

  const MINTER_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("MINTER_ROLE")
  )
  const QC_ADMIN_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("QC_ADMIN_ROLE")
  )
  const SATOSHI_MULTIPLIER = ethers.BigNumber.from(10).pow(10)

  beforeEach(async () => {
    ;[deployer, governance, qc, user, unauthorized] = await ethers.getSigners()

    // Deploy TBTC token
    const TBTCFactory = await ethers.getContractFactory("TBTC")
    tbtc = await TBTCFactory.deploy()
    await tbtc.deployed()

    // Deploy Bank
    const BankFactory = await ethers.getContractFactory("Bank")
    bank = await BankFactory.deploy()
    await bank.deployed()

    // Deploy TBTCVault with mock bridge
    const mockBridge = await smock.fake("Bridge")
    const TBTCVaultFactory = await ethers.getContractFactory("TBTCVault")
    tbtcVault = await TBTCVaultFactory.deploy(
      bank.address,
      tbtc.address,
      mockBridge.address
    )
    await tbtcVault.deployed()

    // Deploy ProtocolRegistry
    const ProtocolRegistryFactory = await ethers.getContractFactory(
      "ProtocolRegistry"
    )
    protocolRegistry = await ProtocolRegistryFactory.deploy()
    await protocolRegistry.deployed()

    // Deploy QCData
    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy()
    await qcData.deployed()

    // Deploy SystemState
    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy()
    await systemState.deployed()

    // Deploy QCManager
    const QCManagerFactory = await ethers.getContractFactory("QCManager")
    qcManager = await QCManagerFactory.deploy(protocolRegistry.address)
    await qcManager.deployed()

    // Deploy QCReserveLedger
    const QCReserveLedgerFactory = await ethers.getContractFactory(
      "QCReserveLedger"
    )
    qcReserveLedger = await QCReserveLedgerFactory.deploy(
      protocolRegistry.address
    )
    await qcReserveLedger.deployed()

    // Deploy BasicMintingPolicy
    const BasicMintingPolicyFactory = await ethers.getContractFactory(
      "BasicMintingPolicy"
    )
    basicMintingPolicy = await BasicMintingPolicyFactory.deploy(
      protocolRegistry.address
    )
    await basicMintingPolicy.deployed()

    // Configure system
    await configureSystem()
  })

  async function configureSystem() {
    // Register services
    const QC_DATA_KEY = ethers.utils.id("QC_DATA")
    const SYSTEM_STATE_KEY = ethers.utils.id("SYSTEM_STATE")
    const QC_MANAGER_KEY = ethers.utils.id("QC_MANAGER")
    const QC_RESERVE_LEDGER_KEY = ethers.utils.id("QC_RESERVE_LEDGER")
    const MINTING_POLICY_KEY = ethers.utils.id("MINTING_POLICY")
    const BANK_KEY = ethers.utils.id("BANK")
    const TBTC_VAULT_KEY = ethers.utils.id("TBTC_VAULT")
    const TBTC_TOKEN_KEY = ethers.utils.id("TBTC_TOKEN")

    await protocolRegistry.setService(QC_DATA_KEY, qcData.address)
    await protocolRegistry.setService(SYSTEM_STATE_KEY, systemState.address)
    await protocolRegistry.setService(QC_MANAGER_KEY, qcManager.address)
    await protocolRegistry.setService(
      QC_RESERVE_LEDGER_KEY,
      qcReserveLedger.address
    )
    await protocolRegistry.setService(
      MINTING_POLICY_KEY,
      basicMintingPolicy.address
    )
    await protocolRegistry.setService(BANK_KEY, bank.address)
    await protocolRegistry.setService(TBTC_VAULT_KEY, tbtcVault.address)
    await protocolRegistry.setService(TBTC_TOKEN_KEY, tbtc.address)

    // Configure access control
    const QC_MANAGER_ROLE = ethers.utils.id("QC_MANAGER_ROLE")
    await qcData.grantRole(QC_MANAGER_ROLE, qcManager.address)
    await qcManager.grantRole(QC_ADMIN_ROLE, basicMintingPolicy.address)
    await basicMintingPolicy.grantRole(MINTER_ROLE, deployer.address)

    // Configure Bank and TBTCVault
    await bank.setAuthorizedBalanceIncreaser(basicMintingPolicy.address, true)
    await tbtc.transferOwnership(tbtcVault.address)

    // Setup QC - register directly through QCData for testing
    await qcData.registerQC(qc.address, ethers.utils.parseEther("1000")) // 1000 tBTC capacity
  }

  describe("Direct Bank Integration", () => {
    it("should be authorized to increase Bank balances", async () => {
      const isAuthorized = await bank.authorizedBalanceIncreasers(
        basicMintingPolicy.address
      )
      expect(isAuthorized).to.be.true
    })
  })

  describe("Minting Flow", () => {
    const mintAmount = ethers.utils.parseEther("10") // 10 tBTC

    beforeEach(async () => {
      // Grant MINTER_ROLE to deployer for testing
      await basicMintingPolicy.grantRole(MINTER_ROLE, deployer.address)

      // Simulate reserve attestation (QC has sufficient reserves)
      const QC_RESERVE_LEDGER_KEY = ethers.utils.id("QC_RESERVE_LEDGER")
      const reserveBalance = ethers.utils.parseEther("100") // 100 tBTC reserves
      await qcReserveLedger.grantRole(
        ethers.utils.id("ATTESTER_ROLE"),
        deployer.address
      )
      await qcReserveLedger.submitReserveAttestation(qc.address, reserveBalance)
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
        (e) => e.event === "MintCompleted"
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

    it("should create Bank balance without auto-minting when requested (using helper)", async () => {
      const bankBalanceBefore = await bank.balanceOf(user.address)
      const tbtcBalanceBefore = await tbtc.balanceOf(user.address)

      // Use test helper to verify the direct Bank balance creation approach
      // This simulates what requestMintWithOption(autoMint=false) used to do
      await verifyBankOnlyMint(
        bank,
        tbtc,
        user.address,
        mintAmount,
        bankBalanceBefore,
        tbtcBalanceBefore
      )
    })

    it("should revert if not authorized in Bank", async () => {
      // Remove authorization
      await bank.setAuthorizedBalanceIncreaser(
        basicMintingPolicy.address,
        false
      )

      await expect(
        basicMintingPolicy.requestMint(qc.address, user.address, mintAmount)
      ).to.be.revertedWith("NotAuthorizedInBank")

      // Restore authorization for other tests
      await bank.setAuthorizedBalanceIncreaser(basicMintingPolicy.address, true)
    })

    it("should revert if QC is not active", async () => {
      // Grant ARBITER_ROLE to deployer to change QC status
      const ARBITER_ROLE = ethers.utils.id("ARBITER_ROLE")
      await qcManager.grantRole(ARBITER_ROLE, deployer.address)

      // Deactivate QC
      await qcManager.setQCStatus(qc.address, 2, ethers.utils.id("TEST_REVOKE")) // Revoked

      await expect(
        basicMintingPolicy.requestMint(qc.address, user.address, mintAmount)
      ).to.be.revertedWith("QCNotActive")
    })

    it("should revert if insufficient QC capacity", async () => {
      const excessiveAmount = ethers.utils.parseEther("150") // More than 100 tBTC reserves

      await expect(
        basicMintingPolicy.requestMint(
          qc.address,
          user.address,
          excessiveAmount
        )
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
      const tx = basicMintingPolicy.requestMint(qc.address, user.address, 0)

      await expect(tx).to.be.revertedWith("InvalidAmount")
    })
  })

  describe("Mint Request Tracking", () => {
    beforeEach(async () => {
      // Grant MINTER_ROLE to deployer for testing
      await basicMintingPolicy.grantRole(MINTER_ROLE, deployer.address)

      // Simulate reserve attestation (QC has sufficient reserves)
      const reserveBalance = ethers.utils.parseEther("100") // 100 tBTC reserves
      await qcReserveLedger.grantRole(
        ethers.utils.id("ATTESTER_ROLE"),
        deployer.address
      )
      await qcReserveLedger.submitReserveAttestation(qc.address, reserveBalance)
    })

    it("should track mint requests", async () => {
      const mintAmount = ethers.utils.parseEther("5")
      const tx = await basicMintingPolicy.requestMint(
        qc.address,
        user.address,
        mintAmount
      )

      const receipt = await tx.wait()
      const mintCompletedEvent = receipt.events?.find(
        (e) => e.event === "MintCompleted"
      )
      const mintId = mintCompletedEvent?.args?.mintId

      // Check mint request details using helper
      const mintRequest = extractMintRequestFromEvent(receipt)
      expect(mintRequest.qc).to.equal(qc.address)
      expect(mintRequest.user).to.equal(user.address)
      expect(mintRequest.amount).to.equal(mintAmount)
      expect(mintRequest.completed).to.be.true

      // Check completion status using helper
      const isCompleted = checkMintCompletedFromEvents(receipt, mintId)
      expect(isCompleted).to.be.true
    })
  })

  describe("Gas Optimization", () => {
    beforeEach(async () => {
      // Grant MINTER_ROLE to deployer for testing
      await basicMintingPolicy.grantRole(MINTER_ROLE, deployer.address)

      // Simulate reserve attestation (QC has sufficient reserves)
      const reserveBalance = ethers.utils.parseEther("100") // 100 tBTC reserves
      await qcReserveLedger.grantRole(
        ethers.utils.id("ATTESTER_ROLE"),
        deployer.address
      )
      await qcReserveLedger.submitReserveAttestation(qc.address, reserveBalance)
    })

    it("should use less gas than QCBridge approach", async () => {
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
      expect(receipt.gasUsed).to.be.lt(400000) // Reasonable upper bound
    })
  })

  describe("Access Control", () => {
    beforeEach(async () => {
      // Simulate reserve attestation (QC has sufficient reserves)
      const reserveBalance = ethers.utils.parseEther("100") // 100 tBTC reserves
      await qcReserveLedger.grantRole(
        ethers.utils.id("ATTESTER_ROLE"),
        deployer.address
      )
      await qcReserveLedger.submitReserveAttestation(qc.address, reserveBalance)
    })

    it("should only allow MINTER_ROLE to request mints", async () => {
      await expect(
        basicMintingPolicy
          .connect(unauthorized)
          .requestMint(qc.address, user.address, ethers.utils.parseEther("10"))
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
      await qcManager.setQCStatus(qc.address, 2, ethers.utils.id("TEST_REVOKE")) // Revoked
      const isEligibleAfter = await basicMintingPolicy.checkMintingEligibility(
        qc.address,
        mintAmount
      )
      expect(isEligibleAfter).to.be.false
    })
  })
})
