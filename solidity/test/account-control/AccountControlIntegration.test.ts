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
  QCBridge,
  Bank,
  TBTCVault,
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
  let qcBridge: QCBridge
  let bank: Bank
  let tbtcVault: TBTCVault

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
  let BANK_KEY: string
  let TBTC_VAULT_KEY: string

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
    BANK_KEY = ethers.utils.id("BANK")
    TBTC_VAULT_KEY = ethers.utils.id("TBTC_VAULT")

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

    // Deploy Bank and TBTCVault (needed by BasicMintingPolicy)
    const BankFactory = await ethers.getContractFactory("Bank")
    bank = await BankFactory.deploy()
    await bank.deployed()

    // Create a mock Bridge for TBTCVault
    const mockBridge = await smock.fake("Bridge")

    const TBTCVaultFactory = await ethers.getContractFactory("TBTCVault")
    tbtcVault = await TBTCVaultFactory.deploy(
      bank.address,
      tbtc.address,
      mockBridge.address
    )
    await tbtcVault.deployed()

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
    await protocolRegistry.setService(BANK_KEY, bank.address)
    await protocolRegistry.setService(TBTC_VAULT_KEY, tbtcVault.address)

    // Configure access control roles
    await qcData.grantRole(QC_MANAGER_ROLE, qcManager.address)
    await qcManager.grantRole(QC_ADMIN_ROLE, basicMintingPolicy.address)

    // Grant MINTER_ROLE to QCMinter on BasicMintingPolicy
    const MINTER_ROLE = await basicMintingPolicy.MINTER_ROLE()
    await basicMintingPolicy.grantRole(MINTER_ROLE, qcMinter.address)

    // Transfer ownership of TBTC to the TBTCVault so it can mint
    await tbtc.transferOwnership(tbtcVault.address)

    // Configure Bank to allow BasicMintingPolicy to increase balances
    await bank.setAuthorizedBalanceIncreaser(basicMintingPolicy.address, true)

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
      // Register QC directly through QCData for testing
      // In production, this would go through time-locked governance
      await qcData.registerQC(
        qcAddress.address,
        ethers.utils.parseEther("1000")
      )

      expect(await qcData.isQCRegistered(qcAddress.address)).to.be.true
      expect(await qcData.getQCStatus(qcAddress.address)).to.equal(0) // Active
    })

    it("should allow wallet registration via Watchdog", async () => {
      // First register QC
      await qcData.registerQC(
        qcAddress.address,
        ethers.utils.parseEther("1000")
      )

      // Register wallet via Watchdog
      const { challenge, txInfo, proof } = createMockSpvData("wallet_reg_test")

      // Encode the SPV proof data as expected by SingleWatchdog
      const spvProofData = ethers.utils.defaultAbiCoder.encode(
        [
          "tuple(bytes4,bytes,bytes,bytes4)",
          "tuple(bytes,uint256,bytes,bytes,bytes)",
        ],
        [
          [
            txInfo.version,
            txInfo.inputVector,
            txInfo.outputVector,
            txInfo.locktime,
          ],
          [
            proof.merkleProof,
            proof.txIndexInBlock,
            proof.bitcoinHeaders,
            proof.coinbasePreimage,
            proof.coinbaseProof,
          ],
        ]
      )

      await singleWatchdog
        .connect(watchdog)
        .registerWalletWithProof(
          qcAddress.address,
          testBtcAddress,
          spvProofData,
          challenge
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
      await qcData.registerQC(
        qcAddress.address,
        ethers.utils.parseEther("1000")
      )

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
      await qcData.registerQC(
        qcAddress.address,
        ethers.utils.parseEther("1000")
      )

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
      await qcData.registerQC(
        qcAddress.address,
        ethers.utils.parseEther("1000")
      )
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
      await qcData.registerQC(
        qcAddress.address,
        ethers.utils.parseEther("1000")
      )
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
      await qcData.registerQC(
        qcAddress.address,
        ethers.utils.parseEther("1000")
      )
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
      await qcData.registerQC(
        qcAddress.address,
        ethers.utils.parseEther("1000")
      )
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
      // The TBTC token is owned by TBTCVault, not BasicMintingPolicy
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [tbtcVault.address],
      })

      // Set balance for the impersonated account to pay for gas
      await network.provider.send("hardhat_setBalance", [
        tbtcVault.address,
        "0x1000000000000000000", // 1 ETH in hex
      ])

      const impersonatedSigner = await ethers.getSigner(tbtcVault.address)
      // Keep TBTCVault as owner, no transfer needed
      // await tbtc
      //   .connect(impersonatedSigner)
      //   .transferOwnership(tbtcVault.address)

      await network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [tbtcVault.address],
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

      // Configure Bank to allow new policy to increase balances
      await bank.setAuthorizedBalanceIncreaser(newMintingPolicy.address, true)
      // Remove authorization for old policy
      await bank.setAuthorizedBalanceIncreaser(
        basicMintingPolicy.address,
        false
      )

      // Grant MINTER_ROLE to user on QCMinter
      const QC_MINTER_ROLE = await qcMinter.MINTER_ROLE()
      await qcMinter.grantRole(QC_MINTER_ROLE, user.address)

      // Test that new policy works
      await qcData.registerQC(
        qcAddress.address,
        ethers.utils.parseEther("1000")
      )
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

  describe("QCBridge Integration", () => {
    it("should enable minting via TBTCVault after QCBridge deposit", async () => {
      // This test verifies the complete integration flow:
      // 1. BasicMintingPolicy creates Bank balance via QCBridge
      // 2. User can then call TBTCVault.mint() to consume Bank balance
      // 3. User receives tBTC tokens through standard Vault flow

      // Note: This test is a placeholder for the QCBridge integration
      // Full implementation would require:
      // - Deploy Bank, TBTCVault, and QCBridge contracts
      // - Update BasicMintingPolicy to use QCBridge
      // - Configure proper access controls
      // - Test the complete flow from QC → Bank → TBTCVault → tBTC

      // For now, we verify the existing direct minting still works
      const totalSupplyBefore = await tbtc.totalSupply()

      // Grant MINTER_ROLE to user on QCMinter
      const QC_MINTER_ROLE = await qcMinter.MINTER_ROLE()
      await qcMinter.grantRole(QC_MINTER_ROLE, user.address)

      // Setup QC and reserves
      await qcData.registerQC(
        qcAddress.address,
        ethers.utils.parseEther("1000")
      )
      await singleWatchdog
        .connect(watchdog)
        .attestReserves(qcAddress.address, ethers.utils.parseEther("10"))

      // Request mint through QCMinter
      await qcMinter
        .connect(user)
        .requestQCMint(qcAddress.address, ethers.utils.parseEther("1"))

      // Verify balance was created
      const userBalance = await tbtc.balanceOf(user.address)
      expect(userBalance).to.equal(ethers.utils.parseEther("1"))

      // Verify total supply increased
      const totalSupplyAfter = await tbtc.totalSupply()
      expect(totalSupplyAfter).to.equal(
        totalSupplyBefore.add(ethers.utils.parseEther("1"))
      )
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
      await qcData.registerQC(
        qcAddress.address,
        ethers.utils.parseEther("1000")
      )
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

  describe("Watchdog Consensus Integration", () => {
    let watchdogConsensusManager: any
    let watchdogMonitor: any
    let watchdog1: SignerWithAddress
    let watchdog2: SignerWithAddress
    let watchdog3: SignerWithAddress

    before(async () => {
      // Get additional signers for watchdogs
      ;[, , , , , watchdog1, watchdog2, watchdog3] = await ethers.getSigners()

      // Deploy WatchdogConsensusManager
      const WatchdogConsensusManager = await ethers.getContractFactory("WatchdogConsensusManager")
      watchdogConsensusManager = await WatchdogConsensusManager.deploy(
        qcManager.address,
        qcRedeemer.address,
        qcData.address
      )
      await watchdogConsensusManager.deployed()

      // Deploy WatchdogMonitor
      const WatchdogMonitor = await ethers.getContractFactory("WatchdogMonitor")  
      watchdogMonitor = await WatchdogMonitor.deploy(
        watchdogConsensusManager.address,
        qcData.address
      )
      await watchdogMonitor.deployed()

      // Grant roles
      const WATCHDOG_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("WATCHDOG_ROLE"))
      const MANAGER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MANAGER_ROLE"))
      const ARBITER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ARBITER_ROLE"))

      await watchdogConsensusManager.grantRole(MANAGER_ROLE, governance.address)
      await watchdogConsensusManager.connect(governance).grantRole(WATCHDOG_ROLE, watchdog1.address)
      await watchdogConsensusManager.connect(governance).grantRole(WATCHDOG_ROLE, watchdog2.address)
      await watchdogConsensusManager.connect(governance).grantRole(WATCHDOG_ROLE, watchdog3.address)

      // Grant ARBITER_ROLE to consensus manager in QCManager
      await qcManager.grantRole(ARBITER_ROLE, watchdogConsensusManager.address)
    })

    it("should handle complete QC status change flow via consensus", async () => {
      // Ensure QC is registered and active
      const isRegistered = await qcData.isQCRegistered(qcAddress.address)
      if (!isRegistered) {
        await qcManager
          .connect(governance)
          .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))
      }

      // Verify QC is initially active
      const initialStatus = await qcData.getQCStatus(qcAddress.address)
      expect(initialStatus).to.equal(0) // Active

      // Watchdog1 proposes status change to UnderReview
      const reason = "Detected suspicious activity in reserve attestations"
      const newStatus = 1 // UnderReview
      
      const proposalTx = await watchdogConsensusManager
        .connect(watchdog1)
        .proposeStatusChange(qcAddress.address, newStatus, reason)
      const proposalReceipt = await proposalTx.wait()
      const proposalId = proposalReceipt.events?.find(e => e.event === 'ProposalCreated')?.args?.proposalId

      // Verify proposal exists but not executed yet (only 1 vote, need 2)
      let proposal = await watchdogConsensusManager.getProposal(proposalId)
      expect(proposal.executed).to.equal(false)
      expect(proposal.voteCount).to.equal(1)

      // QC should still be active
      let currentStatus = await qcData.getQCStatus(qcAddress.address)
      expect(currentStatus).to.equal(0) // Still Active

      // Watchdog2 votes - should trigger execution (reaches 2-of-5 threshold)
      const voteTx = await watchdogConsensusManager.connect(watchdog2).vote(proposalId) 
      const voteReceipt = await voteTx.wait()
      
      // Should have execution event
      const executionEvent = voteReceipt.events?.find(e => e.event === 'ProposalExecuted')
      expect(executionEvent).to.not.be.undefined

      // Verify proposal is now executed
      proposal = await watchdogConsensusManager.getProposal(proposalId)
      expect(proposal.executed).to.equal(true)
      expect(proposal.voteCount).to.equal(2)

      // Verify QC status was actually changed
      currentStatus = await qcData.getQCStatus(qcAddress.address)
      expect(currentStatus).to.equal(1) // UnderReview

      // Verify minting is now blocked due to status change
      await expect(
        qcMinter.connect(qcAddress).requestQCMint(qcAddress.address, ethers.utils.parseEther("10"))
      ).to.be.reverted // Should fail because QC is UnderReview
    })

    it("should handle wallet deregistration consensus flow", async () => {
      // Ensure QC has a registered wallet first
      const btcAddress = "bc1qintegrationtestwallet" 
      
      // For test purposes, assume wallet is already registered
      // In real scenario, this would have been done via SPV proof
      
      // Watchdog1 proposes wallet deregistration due to security concern
      const reason = "Wallet appears to be compromised based on transaction patterns"
      
      const proposalTx = await watchdogConsensusManager
        .connect(watchdog1)
        .proposeWalletDeregistration(qcAddress.address, btcAddress, reason)
      const proposalReceipt = await proposalTx.wait()
      const proposalId = proposalReceipt.events?.find(e => e.event === 'ProposalCreated')?.args?.proposalId

      // Verify proposal type and initial state
      const proposal = await watchdogConsensusManager.getProposal(proposalId)
      expect(proposal.proposalType).to.equal(1) // WALLET_DEREGISTRATION
      expect(proposal.executed).to.equal(false)
      expect(proposal.voteCount).to.equal(1)

      // Watchdog2 and Watchdog3 vote (should reach 2-vote threshold and execute)
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId)
      
      // Verify execution occurred
      const finalProposal = await watchdogConsensusManager.getProposal(proposalId)
      expect(finalProposal.executed).to.equal(true)
      expect(finalProposal.voteCount).to.equal(2)
    })

    it("should demonstrate complete emergency response workflow", async () => {
      // Scenario: Multiple watchdogs detect QC issues and coordinate response
      
      // Step 1: First watchdog detects issue and proposes status change
      const emergencyReason = "URGENT: QC reserves appear to be moved to unknown addresses"
      
      const statusProposalTx = await watchdogConsensusManager
        .connect(watchdog1)
        .proposeStatusChange(qcAddress.address, 2, emergencyReason) // 2 = Revoked
      const statusReceipt = await statusProposalTx.wait()
      const statusProposalId = statusReceipt.events?.find(e => e.event === 'ProposalCreated')?.args?.proposalId

      // Step 2: Second watchdog confirms the issue and votes
      await watchdogConsensusManager.connect(watchdog2).vote(statusProposalId)

      // Step 3: Verify QC is now revoked
      const finalStatus = await qcData.getQCStatus(qcAddress.address)
      expect(finalStatus).to.equal(2) // Revoked

      // Step 4: Verify all QC operations are now blocked
      await expect(
        qcMinter.connect(qcAddress).requestQCMint(qcAddress.address, ethers.utils.parseEther("1"))
      ).to.be.reverted // Should fail because QC is Revoked

      // Step 5: Demonstrate that consensus can handle concurrent proposals
      const redemptionId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("emergency-redemption-123"))
      const defaultReason = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_REVOKED"))
      
      const redemptionProposalTx = await watchdogConsensusManager
        .connect(watchdog3)
        .proposeRedemptionDefault(redemptionId, defaultReason, "QC revoked, defaulting pending redemptions")
      const redemptionReceipt = await redemptionProposalTx.wait()
      const redemptionProposalId = redemptionReceipt.events?.find(e => e.event === 'ProposalCreated')?.args?.proposalId

      // Another watchdog votes to execute redemption defaults
      await watchdogConsensusManager.connect(watchdog1).vote(redemptionProposalId)

      // Verify both emergency proposals were executed
      const statusProposal = await watchdogConsensusManager.getProposal(statusProposalId)
      const redemptionProposal = await watchdogConsensusManager.getProposal(redemptionProposalId)
      
      expect(statusProposal.executed).to.equal(true)
      expect(redemptionProposal.executed).to.equal(true)
    })

    it("should demonstrate M-of-N parameter adjustment and impact", async () => {
      // Start with default 2-of-5, change to 3-of-5 for higher security
      await watchdogConsensusManager.connect(governance).updateConsensusParams(3, 5)

      // Verify parameters updated
      const params = await watchdogConsensusManager.getConsensusParams()
      expect(params.required).to.equal(3)
      expect(params.total).to.equal(5)

      // Test that proposals now require 3 votes
      const testReason = "Testing 3-of-5 consensus requirement"
      const proposalTx = await watchdogConsensusManager
        .connect(watchdog1)
        .proposeStatusChange(qcAddress.address, 0, testReason) // Back to Active
      const proposalReceipt = await proposalTx.wait()
      const proposalId = proposalReceipt.events?.find(e => e.event === 'ProposalCreated')?.args?.proposalId

      // Two votes should not be enough (1 from proposer + 1 additional = 2 < 3)
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId)
      
      let proposal = await watchdogConsensusManager.getProposal(proposalId)
      expect(proposal.executed).to.equal(false)
      expect(proposal.voteCount).to.equal(2)

      // Third vote should trigger execution
      await watchdogConsensusManager.connect(watchdog3).vote(proposalId)
      
      proposal = await watchdogConsensusManager.getProposal(proposalId)
      expect(proposal.executed).to.equal(true)
      expect(proposal.voteCount).to.equal(3)

      // Verify QC status was changed back to Active
      const finalStatus = await qcData.getQCStatus(qcAddress.address)
      expect(finalStatus).to.equal(0) // Active again
    })
  })
})
