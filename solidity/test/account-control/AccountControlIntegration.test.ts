import { expect } from "chai"
import { ethers, network } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  ProtocolRegistry,
  QCMinter,
  QCRedeemer,
  QCData,
  SystemState,
  QCManager,
  QCReserveLedger,
  BasicMintingPolicy,
  BasicRedemptionPolicy,
  SingleWatchdog,
  TBTC,
  SPVValidator,
} from "../../typechain"
import { createMockSpvData } from "./AccountControlTestHelpers"

describe("Account Control System - Integration Test", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qcAddress: SignerWithAddress
  let user: SignerWithAddress
  let watchdog: SignerWithAddress

  // Core contracts
  let protocolRegistry: ProtocolRegistry
  let qcMinter: QCMinter
  let qcRedeemer: QCRedeemer
  let qcData: QCData
  let systemState: SystemState
  let qcManager: QCManager
  let qcReserveLedger: QCReserveLedger
  let basicMintingPolicy: BasicMintingPolicy
  let basicRedemptionPolicy: BasicRedemptionPolicy
  let singleWatchdog: SingleWatchdog
  let tbtc: TBTC
  let mockSpvValidator: FakeContract<SPVValidator>

  // Service keys (same as in contracts)
  let QC_DATA_KEY: string
  let SYSTEM_STATE_KEY: string
  let QC_MANAGER_KEY: string
  let QC_RESERVE_LEDGER_KEY: string
  let MINTING_POLICY_KEY: string
  let REDEMPTION_POLICY_KEY: string
  let QC_MINTER_KEY: string
  let QC_REDEEMER_KEY: string
  let TBTC_TOKEN_KEY: string
  let SPV_VALIDATOR_KEY: string

  // Roles
  let DATA_MANAGER_ROLE: string
  let QC_ADMIN_ROLE: string
  let QC_MANAGER_ROLE: string
  let ATTESTER_ROLE: string
  let REGISTRAR_ROLE: string
  let ARBITER_ROLE: string

  before(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;[deployer, governance, qcAddress, user, watchdog] =
      await ethers.getSigners()

    // Generate service keys
    QC_DATA_KEY = ethers.utils.id("QC_DATA")
    SYSTEM_STATE_KEY = ethers.utils.id("SYSTEM_STATE")
    QC_MANAGER_KEY = ethers.utils.id("QC_MANAGER")
    QC_RESERVE_LEDGER_KEY = ethers.utils.id("QC_RESERVE_LEDGER")
    MINTING_POLICY_KEY = ethers.utils.id("MINTING_POLICY")
    REDEMPTION_POLICY_KEY = ethers.utils.id("REDEMPTION_POLICY")
    QC_MINTER_KEY = ethers.utils.id("QC_MINTER")
    QC_REDEEMER_KEY = ethers.utils.id("QC_REDEEMER")
    TBTC_TOKEN_KEY = ethers.utils.id("TBTC_TOKEN")
    SPV_VALIDATOR_KEY = ethers.utils.id("SPV_VALIDATOR")

    // Generate role hashes
    DATA_MANAGER_ROLE = ethers.utils.id("DATA_MANAGER_ROLE")
    QC_ADMIN_ROLE = ethers.utils.id("QC_ADMIN_ROLE")
    QC_MANAGER_ROLE = ethers.utils.id("QC_MANAGER_ROLE")
    ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE")
    REGISTRAR_ROLE = ethers.utils.id("REGISTRAR_ROLE")
    ARBITER_ROLE = ethers.utils.id("ARBITER_ROLE")
  })

  beforeEach(async () => {
    // Deploy TBTC token first (simulating existing tBTC v2)
    const TBTCFactory = await ethers.getContractFactory("TBTC")
    tbtc = await TBTCFactory.deploy()
    await tbtc.deployed()

    // Deploy and configure SPV validator mock
    mockSpvValidator = await smock.fake<SPVValidator>("SPVValidator")
    mockSpvValidator.verifyWalletControl.returns(true)
    mockSpvValidator.verifyRedemptionFulfillment.returns(true)

    // Phase 1: Core Contract Layer
    const ProtocolRegistryFactory = await ethers.getContractFactory(
      "ProtocolRegistry"
    )
    protocolRegistry = await ProtocolRegistryFactory.deploy()
    await protocolRegistry.deployed()

    const QCMinterFactory = await ethers.getContractFactory("QCMinter")
    qcMinter = await QCMinterFactory.deploy(protocolRegistry.address)
    await qcMinter.deployed()

    const QCRedeemerFactory = await ethers.getContractFactory("QCRedeemer")
    qcRedeemer = await QCRedeemerFactory.deploy(protocolRegistry.address)
    await qcRedeemer.deployed()

    // Phase 2: State Management Layer
    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy()
    await qcData.deployed()

    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy()
    await systemState.deployed()

    const QCManagerFactory = await ethers.getContractFactory("QCManager")
    qcManager = await QCManagerFactory.deploy(protocolRegistry.address)
    await qcManager.deployed()

    // Phase 3: Policy Contract Layer
    const QCReserveLedgerFactory = await ethers.getContractFactory(
      "QCReserveLedger"
    )
    qcReserveLedger = await QCReserveLedgerFactory.deploy(
      protocolRegistry.address
    )
    await qcReserveLedger.deployed()

    const BasicMintingPolicyFactory = await ethers.getContractFactory(
      "BasicMintingPolicy"
    )
    basicMintingPolicy = await BasicMintingPolicyFactory.deploy(
      protocolRegistry.address
    )
    await basicMintingPolicy.deployed()

    const BasicRedemptionPolicyFactory = await ethers.getContractFactory(
      "BasicRedemptionPolicy"
    )
    basicRedemptionPolicy = await BasicRedemptionPolicyFactory.deploy(
      protocolRegistry.address
    )
    await basicRedemptionPolicy.deployed()

    // Phase 4: Watchdog Integration
    const SingleWatchdogFactory = await ethers.getContractFactory(
      "SingleWatchdog"
    )
    singleWatchdog = await SingleWatchdogFactory.deploy(
      protocolRegistry.address
    )
    await singleWatchdog.deployed()

    // Phase 5: System Configuration
    await configureSystem()
  })

  async function configureSystem() {
    // Register all services in ProtocolRegistry
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
    await protocolRegistry.setService(
      REDEMPTION_POLICY_KEY,
      basicRedemptionPolicy.address
    )
    await protocolRegistry.setService(QC_MINTER_KEY, qcMinter.address)
    await protocolRegistry.setService(QC_REDEEMER_KEY, qcRedeemer.address)
    await protocolRegistry.setService(TBTC_TOKEN_KEY, tbtc.address)
    await protocolRegistry.setService(
      SPV_VALIDATOR_KEY,
      mockSpvValidator.address
    )

    // Configure access control roles
    await qcData.grantRole(QC_MANAGER_ROLE, qcManager.address)
    await qcManager.grantRole(QC_ADMIN_ROLE, basicMintingPolicy.address)

    // Grant MINTER_ROLE to QCMinter on BasicMintingPolicy
    const MINTER_ROLE = await basicMintingPolicy.MINTER_ROLE()
    await basicMintingPolicy.grantRole(MINTER_ROLE, qcMinter.address)

    // Transfer ownership of TBTC to the minting policy so it can mint
    await tbtc.transferOwnership(basicMintingPolicy.address)

    // Setup Watchdog roles
    await qcReserveLedger.grantRole(ATTESTER_ROLE, singleWatchdog.address)
    await qcManager.grantRole(REGISTRAR_ROLE, singleWatchdog.address)
    await qcManager.grantRole(ARBITER_ROLE, singleWatchdog.address)
    await qcRedeemer.grantRole(ARBITER_ROLE, singleWatchdog.address)
    await basicRedemptionPolicy.grantRole(ARBITER_ROLE, singleWatchdog.address)

    // Grant QCRedeemer the ARBITER role in BasicRedemptionPolicy so it can record fulfillments
    await basicRedemptionPolicy.grantRole(ARBITER_ROLE, qcRedeemer.address)

    // Grant QCRedeemer the REDEEMER_ROLE in BasicRedemptionPolicy
    const REDEEMER_ROLE = await basicRedemptionPolicy.REDEEMER_ROLE()
    await basicRedemptionPolicy.grantRole(REDEEMER_ROLE, qcRedeemer.address)

    // Grant watchdog operator role
    await singleWatchdog.grantRole(
      await singleWatchdog.WATCHDOG_OPERATOR_ROLE(),
      watchdog.address
    )
  }

  describe("System Deployment and Configuration", () => {
    it("should deploy all contracts successfully", async () => {
      expect(protocolRegistry.address).to.be.properAddress
      expect(qcMinter.address).to.be.properAddress
      expect(qcRedeemer.address).to.be.properAddress
      expect(qcData.address).to.be.properAddress
      expect(systemState.address).to.be.properAddress
      expect(qcManager.address).to.be.properAddress
      expect(qcReserveLedger.address).to.be.properAddress
      expect(basicMintingPolicy.address).to.be.properAddress
      expect(basicRedemptionPolicy.address).to.be.properAddress
      expect(singleWatchdog.address).to.be.properAddress
    })

    it("should register all services correctly", async () => {
      expect(await protocolRegistry.getService(QC_DATA_KEY)).to.equal(
        qcData.address
      )
      expect(await protocolRegistry.getService(SYSTEM_STATE_KEY)).to.equal(
        systemState.address
      )
      expect(await protocolRegistry.getService(QC_MANAGER_KEY)).to.equal(
        qcManager.address
      )
      expect(await protocolRegistry.getService(QC_RESERVE_LEDGER_KEY)).to.equal(
        qcReserveLedger.address
      )
      expect(await protocolRegistry.getService(MINTING_POLICY_KEY)).to.equal(
        basicMintingPolicy.address
      )
      expect(await protocolRegistry.getService(REDEMPTION_POLICY_KEY)).to.equal(
        basicRedemptionPolicy.address
      )
    })

    it("should verify Watchdog has necessary roles", async () => {
      const hasAttesterRole = await qcReserveLedger.hasRole(
        ATTESTER_ROLE,
        singleWatchdog.address
      )
      const hasRegistrarRole = await qcManager.hasRole(
        REGISTRAR_ROLE,
        singleWatchdog.address
      )
      const hasArbiterRole = await qcManager.hasRole(
        ARBITER_ROLE,
        singleWatchdog.address
      )

      expect(hasAttesterRole).to.be.true
      expect(hasRegistrarRole).to.be.true
      expect(hasArbiterRole).to.be.true
    })
  })

  describe("QC Registration and Wallet Management", () => {
    const testBtcAddress = "bc1qtest123456789"

    it("should allow QC registration", async () => {
      await qcManager.registerQC(qcAddress.address)

      expect(await qcData.isQCRegistered(qcAddress.address)).to.be.true
      expect(await qcData.getQCStatus(qcAddress.address)).to.equal(0) // Active
    })

    it("should allow wallet registration via Watchdog", async () => {
      // First register QC
      await qcManager.registerQC(qcAddress.address)

      // Register wallet via Watchdog
      const spvProof = ethers.utils.toUtf8Bytes("mock_spv_proof")
      const challengeHash = ethers.utils.id("challenge_data")

      await singleWatchdog
        .connect(watchdog)
        .registerWalletWithProof(
          qcAddress.address,
          testBtcAddress,
          spvProof,
          challengeHash
        )

      const walletStatus = await qcData.getWalletStatus(testBtcAddress)
      expect(walletStatus).to.equal(1) // Active

      const walletOwner = await qcData.getWalletOwner(testBtcAddress)
      expect(walletOwner).to.equal(qcAddress.address)
    })
  })

  describe("Reserve Attestation System", () => {
    const initialReserveBalance = ethers.utils.parseEther("10") // 10 tBTC equivalent

    it("should allow Watchdog to attest reserves", async () => {
      await qcManager.registerQC(qcAddress.address)

      await singleWatchdog
        .connect(watchdog)
        .attestReserves(qcAddress.address, initialReserveBalance)

      const attestation = await qcReserveLedger.getCurrentAttestation(
        qcAddress.address
      )
      expect(attestation.balance).to.equal(initialReserveBalance)
      expect(attestation.isValid).to.be.true
      expect(attestation.attester).to.equal(singleWatchdog.address)
    })

    it("should detect stale attestations", async () => {
      await qcManager.registerQC(qcAddress.address)

      await singleWatchdog
        .connect(watchdog)
        .attestReserves(qcAddress.address, initialReserveBalance)

      // Initially not stale
      const isStale = await qcReserveLedger.isAttestationStale(
        qcAddress.address
      )
      expect(isStale).to.be.false
    })
  })

  describe("Minting Operations", () => {
    const initialReserveBalance = ethers.utils.parseEther("10") // 10 tBTC equivalent
    const mintAmount = ethers.utils.parseEther("5") // 5 tBTC

    it("should allow minting with sufficient reserves", async () => {
      // Setup QC with reserves
      await qcManager.registerQC(qcAddress.address)
      await singleWatchdog
        .connect(watchdog)
        .attestReserves(qcAddress.address, initialReserveBalance)

      // Check available capacity
      const mintCapacity = await qcManager.getAvailableMintingCapacity(
        qcAddress.address
      )
      expect(mintCapacity).to.equal(initialReserveBalance) // Full reserve available

      // Grant MINTER_ROLE to user
      const MINTER_ROLE = await qcMinter.MINTER_ROLE()
      await qcMinter.grantRole(MINTER_ROLE, user.address)

      // Request minting
      await qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)

      // Verify tBTC was minted
      const userBalance = await tbtc.balanceOf(user.address)
      expect(userBalance).to.equal(mintAmount)

      // Verify QC minted amount updated
      const qcMintedAmount = await qcData.getQCMintedAmount(qcAddress.address)
      expect(qcMintedAmount).to.equal(mintAmount)
    })

    it("should prevent minting when QC is not active", async () => {
      // Register QC and set to UnderReview
      await qcManager.registerQC(qcAddress.address)
      await qcManager.setQCStatus(
        qcAddress.address,
        1,
        ethers.utils.id("TEST_REVIEW")
      ) // UnderReview

      await singleWatchdog
        .connect(watchdog)
        .attestReserves(qcAddress.address, initialReserveBalance)

      // Should have zero capacity when UnderReview
      const mintCapacity = await qcManager.getAvailableMintingCapacity(
        qcAddress.address
      )
      expect(mintCapacity).to.equal(0)
    })
  })

  describe("Redemption Operations", () => {
    const initialReserveBalance = ethers.utils.parseEther("10") // 10 tBTC equivalent
    const mintAmount = ethers.utils.parseEther("5") // 5 tBTC

    it("should handle redemption lifecycle", async () => {
      // Setup QC and mint tokens
      await qcManager.registerQC(qcAddress.address)
      await singleWatchdog
        .connect(watchdog)
        .attestReserves(qcAddress.address, initialReserveBalance)

      // Grant MINTER_ROLE to user
      const MINTER_ROLE = await qcMinter.MINTER_ROLE()
      await qcMinter.grantRole(MINTER_ROLE, user.address)

      await qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)

      // User should have tBTC balance
      let userBalance = await tbtc.balanceOf(user.address)
      expect(userBalance).to.equal(mintAmount)

      // User must approve QCRedeemer to burn their tokens
      await tbtc.connect(user).approve(qcRedeemer.address, mintAmount)

      // Initiate redemption (this should burn the tokens)
      const userBtcAddress = "bc1quser123456789"
      const redemptionTx = await qcRedeemer
        .connect(user)
        .initiateRedemption(qcAddress.address, mintAmount, userBtcAddress)

      // Verify tokens were burned
      userBalance = await tbtc.balanceOf(user.address)
      expect(userBalance).to.equal(0)

      // Get redemption ID from event
      const receipt = await redemptionTx.wait()
      const redemptionEvent = receipt.events?.find(
        (e) => e.event === "RedemptionRequested"
      )
      const redemptionId = redemptionEvent?.args?.redemptionId

      // Verify redemption created
      const redemption = await qcRedeemer.getRedemption(redemptionId)
      expect(redemption.user).to.equal(user.address)
      expect(redemption.qc).to.equal(qcAddress.address)
      expect(redemption.amount).to.equal(mintAmount)
      expect(redemption.status).to.equal(1) // Pending

      // Fulfill redemption via Watchdog
      const mockSpvData = createMockSpvData()
      const expectedAmount = mintAmount.div(ethers.BigNumber.from(10).pow(10)) // Convert from 18 decimals to 8 decimals (satoshis)

      await singleWatchdog
        .connect(watchdog)
        .recordRedemptionFulfillment(
          redemptionId,
          userBtcAddress,
          expectedAmount,
          mockSpvData.txInfo,
          mockSpvData.proof
        )

      // Verify redemption fulfilled
      const updatedRedemption = await qcRedeemer.getRedemption(redemptionId)
      expect(updatedRedemption.status).to.equal(2) // Fulfilled
    })
  })

  describe("Emergency Controls", () => {
    it("should support granular pause functionality", async () => {
      // Grant MINTER_ROLE to user
      const MINTER_ROLE = await qcMinter.MINTER_ROLE()
      await qcMinter.grantRole(MINTER_ROLE, user.address)

      // Pause minting
      await systemState.pauseMinting()
      expect(await systemState.isMintingPaused()).to.be.true

      // Setup QC for testing
      await qcManager.registerQC(qcAddress.address)
      await singleWatchdog
        .connect(watchdog)
        .attestReserves(qcAddress.address, ethers.utils.parseEther("10"))

      // Minting should fail when paused
      await expect(
        qcMinter
          .connect(user)
          .requestQCMint(qcAddress.address, ethers.utils.parseEther("1"))
      ).to.be.reverted

      // Unpause minting
      await systemState.unpauseMinting()
      expect(await systemState.isMintingPaused()).to.be.false

      // Minting should work again
      await qcMinter
        .connect(user)
        .requestQCMint(qcAddress.address, ethers.utils.parseEther("1"))
      const userBalance = await tbtc.balanceOf(user.address)
      expect(userBalance).to.equal(ethers.utils.parseEther("1"))
    })
  })

  describe("Policy Upgrade System", () => {
    it("should support policy contract upgrades via ProtocolRegistry", async () => {
      // Deploy new minting policy
      const NewMintingPolicyFactory = await ethers.getContractFactory(
        "BasicMintingPolicy"
      )
      const newMintingPolicy = await NewMintingPolicyFactory.deploy(
        protocolRegistry.address
      )
      await newMintingPolicy.deployed()

      // Grant necessary role to new policy
      await qcManager.grantRole(QC_ADMIN_ROLE, newMintingPolicy.address)

      // Transfer TBTC ownership to new policy using impersonation
      // Since we removed transferTBTCOwnership from BasicMintingPolicy,
      // we need to call tbtc.transferOwnership directly from the current owner
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [basicMintingPolicy.address],
      })

      // Set balance for the impersonated account to pay for gas
      await network.provider.send("hardhat_setBalance", [
        basicMintingPolicy.address,
        "0x1000000000000000000", // 1 ETH in hex
      ])

      const impersonatedSigner = await ethers.getSigner(
        basicMintingPolicy.address
      )
      await tbtc
        .connect(impersonatedSigner)
        .transferOwnership(newMintingPolicy.address)

      await network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [basicMintingPolicy.address],
      })

      // Revoke role from old policy to complete the transition
      await qcManager.revokeRole(QC_ADMIN_ROLE, basicMintingPolicy.address)

      // Update policy in registry
      await protocolRegistry.setService(
        MINTING_POLICY_KEY,
        newMintingPolicy.address
      )

      // Verify policy updated
      const currentPolicy = await protocolRegistry.getService(
        MINTING_POLICY_KEY
      )
      expect(currentPolicy).to.equal(newMintingPolicy.address)

      // Grant MINTER_ROLE to QCMinter on new policy
      const MINTER_ROLE_NEW = await newMintingPolicy.MINTER_ROLE()
      await newMintingPolicy.grantRole(MINTER_ROLE_NEW, qcMinter.address)

      // Grant MINTER_ROLE to user on QCMinter
      const QC_MINTER_ROLE = await qcMinter.MINTER_ROLE()
      await qcMinter.grantRole(QC_MINTER_ROLE, user.address)

      // Test that new policy works
      await qcManager.registerQC(qcAddress.address)
      await singleWatchdog
        .connect(watchdog)
        .attestReserves(qcAddress.address, ethers.utils.parseEther("10"))

      // Should still be able to mint with new policy
      await qcMinter
        .connect(user)
        .requestQCMint(qcAddress.address, ethers.utils.parseEther("1"))

      const userBalance = await tbtc.balanceOf(user.address)
      expect(userBalance).to.equal(ethers.utils.parseEther("1"))
    })
  })

  describe("Integration with existing tBTC v2", () => {
    it("should not modify existing tBTC token functionality", async () => {
      // Test that existing tBTC functionality still works
      const totalSupplyBefore = await tbtc.totalSupply()

      // Grant MINTER_ROLE to user on QCMinter
      const QC_MINTER_ROLE = await qcMinter.MINTER_ROLE()
      await qcMinter.grantRole(QC_MINTER_ROLE, user.address)

      // Test basic transfer functionality (TBTC is ERC20)
      // First mint some tokens to test transfer
      await qcManager.registerQC(qcAddress.address)
      await singleWatchdog
        .connect(watchdog)
        .attestReserves(qcAddress.address, ethers.utils.parseEther("10"))
      await qcMinter
        .connect(user)
        .requestQCMint(qcAddress.address, ethers.utils.parseEther("5"))

      const userBalance = await tbtc.balanceOf(user.address)
      expect(userBalance).to.equal(ethers.utils.parseEther("5"))

      const totalSupplyAfter = await tbtc.totalSupply()
      expect(totalSupplyAfter).to.equal(
        totalSupplyBefore.add(ethers.utils.parseEther("5"))
      )

      // Verify token transfers still work
      await tbtc
        .connect(user)
        .transfer(deployer.address, ethers.utils.parseEther("1"))
      const deployerBalance = await tbtc.balanceOf(deployer.address)
      expect(deployerBalance).to.equal(ethers.utils.parseEther("1"))
    })
  })
})
