import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  QCManager,
  QCData,
  QCMinter,
  QCRedeemer,
  QCReserveLedger,
  BasicMintingPolicy,
  BasicRedemptionPolicy,
  QCWatchdog,
  WatchdogMonitor,
  WatchdogConsensusManager,
  SystemState,
  ProtocolRegistry,
  TBTC,
  SPVValidator,
} from "../../../typechain"
import {
  SERVICE_KEYS,
  ROLES,
  TEST_DATA,
  QCStatus,
  createMockSpvData,
  deployAccountControlFixture,
  setupQCWithWallets,
  generateRedemptionId,
} from "../AccountControlTestHelpers"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("End-to-End User Journeys", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qcAddress: SignerWithAddress
  let bitcoinUser: SignerWithAddress
  let institutionalUser: SignerWithAddress
  let retailUser: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let maliciousActor: SignerWithAddress

  // Complete system contracts
  let protocolRegistry: ProtocolRegistry
  let qcManager: QCManager
  let qcData: QCData
  let qcMinter: QCMinter
  let qcRedeemer: QCRedeemer
  let qcQCReserveLedger: QCReserveLedger
  let basicMintingPolicy: BasicMintingPolicy
  let basicRedemptionPolicy: BasicRedemptionPolicy
  let qcWatchdog: QCWatchdog
  let watchdogMonitor: WatchdogMonitor
  let watchdogConsensusManager: WatchdogConsensusManager
  let systemState: SystemState
  let tbtc: TBTC
  let mockSpvValidator: FakeContract<SPVValidator>

  // Test constants
  const QC_INITIAL_CAPACITY = ethers.utils.parseEther("10000") // 10,000 tBTC
  const QC_RESERVE_BALANCE = ethers.utils.parseEther("5000")   // 5,000 BTC
  const LARGE_MINT_AMOUNT = ethers.utils.parseEther("1000")    // 1,000 tBTC
  const MEDIUM_MINT_AMOUNT = ethers.utils.parseEther("100")    // 100 tBTC
  const SMALL_MINT_AMOUNT = ethers.utils.parseEther("1")       // 1 tBTC

  before(async () => {
    ;[
      deployer,
      governance,
      qcAddress,
      bitcoinUser,
      institutionalUser,
      retailUser,
      watchdog1,
      watchdog2,
      watchdog3,
      maliciousActor,
    ] = await ethers.getSigners()
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy complete fixture
    const fixture = await deployAccountControlFixture()
    
    protocolRegistry = fixture.protocolRegistry
    qcManager = fixture.qcManager
    qcData = fixture.qcData
    qcMinter = fixture.qcMinter
    qcRedeemer = fixture.qcRedeemer
    qcQCReserveLedger = fixture.qcQCReserveLedger
    basicMintingPolicy = fixture.basicMintingPolicy
    basicRedemptionPolicy = fixture.basicRedemptionPolicy
    qcWatchdog = fixture.qcWatchdog
    systemState = fixture.systemState
    tbtc = fixture.tbtc

    // Deploy v1 consensus contracts
    const WatchdogConsensusManagerFactory = await ethers.getContractFactory(
      "WatchdogConsensusManager"
    )
    watchdogConsensusManager = await WatchdogConsensusManagerFactory.deploy(
      qcManager.address,
      qcRedeemer.address,
      qcData.address
    )
    await watchdogConsensusManager.deployed()

    const WatchdogMonitorFactory = await ethers.getContractFactory(
      "WatchdogMonitor"
    )
    watchdogMonitor = await WatchdogMonitorFactory.deploy(
      watchdogConsensusManager.address,
      qcData.address
    )
    await watchdogMonitor.deployed()

    // Setup SPV validator
    mockSpvValidator = await smock.fake<SPVValidator>("SPVValidator")
    mockSpvValidator.verifyWalletControl.returns(true)
    mockSpvValidator.verifyRedemptionFulfillment.returns(true)
    
    await protocolRegistry.setService(
      SERVICE_KEYS.SPV_VALIDATOR,
      mockSpvValidator.address
    )

    // Setup roles for all users
    await qcRedeemer.grantRole(ROLES.REDEEMER_ROLE, bitcoinUser.address)
    await qcRedeemer.grantRole(ROLES.REDEEMER_ROLE, institutionalUser.address)
    await qcRedeemer.grantRole(ROLES.REDEEMER_ROLE, retailUser.address)

    // Setup watchdog consensus
    await watchdogConsensusManager.grantRole(
      await watchdogConsensusManager.MANAGER_ROLE(),
      governance.address
    )
    
    const watchdogs = [watchdog1, watchdog2, watchdog3]
    for (const watchdog of watchdogs) {
      await watchdogConsensusManager
        .connect(governance)
        .grantRole(
          await watchdogConsensusManager.WATCHDOG_ROLE(),
          watchdog.address
        )
    }

    // Setup watchdog monitor
    await watchdogMonitor.grantRole(
      await watchdogMonitor.MANAGER_ROLE(),
      governance.address
    )

    for (let i = 0; i < watchdogs.length; i++) {
      const mockWatchdog = await smock.fake("QCWatchdog")
      await watchdogMonitor
        .connect(governance)
        .registerWatchdog(
          mockWatchdog.address,
          watchdogs[i].address,
          `Watchdog${i + 1}`
        )
      
      await watchdogMonitor
        .connect(governance)
        .grantRole(
          await watchdogMonitor.WATCHDOG_OPERATOR_ROLE(),
          watchdogs[i].address
        )
    }

    // Setup QC with high capacity for user journey tests
    await setupQCWithWallets(
      {
        protocolRegistry,
        qcData,
        qcManager,
        qcQCReserveLedger,
        systemState,
        qcMinter,
        qcRedeemer,
        basicMintingPolicy,
        basicRedemptionPolicy,
        qcWatchdog,
        tbtc,
        deployer,
        governance,
        qcAddress,
        user: bitcoinUser,
        watchdog: fixture.watchdog,
      },
      qcAddress.address,
      [TEST_DATA.BTC_ADDRESSES.TEST, TEST_DATA.BTC_ADDRESSES.SEGWIT],
      QC_RESERVE_BALANCE
    )

    // Set high capacity for this QC
    await qcData.updateQCCapacity(qcAddress.address, QC_INITIAL_CAPACITY)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Happy Path: Institutional User Journey", () => {
    it("should handle complete institutional minting and redemption flow", async () => {
      // PHASE 1: Large-scale minting for institutional user
      console.log("Phase 1: Institutional Minting")
      
      // 1.1 Check initial state
      expect(await tbtc.balanceOf(institutionalUser.address)).to.equal(0)
      expect(await qcData.getQCMintedAmount(qcAddress.address)).to.equal(0)
      
      // 1.2 Institutional user mints 1000 tBTC
      const canMint = await basicMintingPolicy.canMint(
        institutionalUser.address,
        qcAddress.address,
        LARGE_MINT_AMOUNT
      )
      expect(canMint).to.be.true

      await basicMintingPolicy.executeMint(
        institutionalUser.address,
        qcAddress.address,
        LARGE_MINT_AMOUNT
      )

      // 1.3 Verify minting success
      expect(await tbtc.balanceOf(institutionalUser.address)).to.equal(LARGE_MINT_AMOUNT)
      expect(await qcData.getQCMintedAmount(qcAddress.address)).to.equal(LARGE_MINT_AMOUNT)
      expect(await tbtc.totalSupply()).to.equal(LARGE_MINT_AMOUNT)

      // PHASE 2: Risk monitoring and attestation updates
      console.log("Phase 2: Risk Monitoring")
      
      // 2.1 Watchdog updates reserve attestation (simulate BTC price movement)
      const updatedReserves = QC_RESERVE_BALANCE.add(ethers.utils.parseEther("500"))
      await qcQCReserveLedger
        .connect(fixture.watchdog)
        .submitReserveAttestation(qcAddress.address, updatedReserves)

      // 2.2 Verify system remains healthy
      const isSolvent = await qcManager.verifyQCSolvency(qcAddress.address)
      expect(isSolvent).to.be.true

      // PHASE 3: Partial redemption
      console.log("Phase 3: Partial Redemption")
      
      // 3.1 Institutional user redeems 25% of holdings
      const redemptionAmount = LARGE_MINT_AMOUNT.div(4) // 250 tBTC
      const userBtcAddress = TEST_DATA.BTC_ADDRESSES.LEGACY

      const tx = await qcRedeemer
        .connect(institutionalUser)
        .initiateRedemption(qcAddress.address, redemptionAmount, userBtcAddress)

      // 3.2 Verify immediate effects
      expect(await tbtc.balanceOf(institutionalUser.address)).to.equal(
        LARGE_MINT_AMOUNT.sub(redemptionAmount)
      )
      expect(await qcData.getQCMintedAmount(qcAddress.address)).to.equal(
        LARGE_MINT_AMOUNT.sub(redemptionAmount)
      )

      // 3.3 QC fulfills redemption
      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "RedemptionInitiated")
      const redemptionId = event?.args?.redemptionId

      const { txInfo, proof } = createMockSpvData()
      await qcRedeemer
        .connect(governance)
        .recordRedemptionFulfillment(
          redemptionId,
          userBtcAddress,
          25000000, // 0.25 BTC in satoshi
          txInfo,
          proof
        )

      // PHASE 4: Continued operations
      console.log("Phase 4: Continued Operations")
      
      // 4.1 User can continue minting
      const canMintMore = await basicMintingPolicy.canMint(
        institutionalUser.address,
        qcAddress.address,
        MEDIUM_MINT_AMOUNT
      )
      expect(canMintMore).to.be.true

      // 4.2 Execute additional mint
      await basicMintingPolicy.executeMint(
        institutionalUser.address,
        qcAddress.address,
        MEDIUM_MINT_AMOUNT
      )

      // 4.3 Final verification
      const finalBalance = LARGE_MINT_AMOUNT.sub(redemptionAmount).add(MEDIUM_MINT_AMOUNT)
      expect(await tbtc.balanceOf(institutionalUser.address)).to.equal(finalBalance)
    })
  })

  describe("Retail User Journey: Small Transactions", () => {
    it("should handle retail user minting and redemption with small amounts", async () => {
      // SETUP: Institutional user already has minted to establish liquidity
      await basicMintingPolicy.executeMint(
        institutionalUser.address,
        qcAddress.address,
        LARGE_MINT_AMOUNT
      )

      // PHASE 1: Retail minting
      console.log("Phase 1: Retail Minting")
      
      // 1.1 Multiple small mints
      const retailAmounts = [
        ethers.utils.parseEther("0.1"),  // 0.1 tBTC
        ethers.utils.parseEther("0.5"),  // 0.5 tBTC
        ethers.utils.parseEther("1.0"),  // 1.0 tBTC
      ]

      let totalRetailMinted = ethers.constants.Zero
      for (const amount of retailAmounts) {
        await basicMintingPolicy.executeMint(
          retailUser.address,
          qcAddress.address,
          amount
        )
        totalRetailMinted = totalRetailMinted.add(amount)
      }

      expect(await tbtc.balanceOf(retailUser.address)).to.equal(totalRetailMinted)

      // PHASE 2: DeFi interaction simulation
      console.log("Phase 2: DeFi Interactions")
      
      // 2.1 User transfers to another address (simulate DeFi deposit)
      const defiAmount = ethers.utils.parseEther("0.8")
      await tbtc.connect(retailUser).transfer(bitcoinUser.address, defiAmount)

      expect(await tbtc.balanceOf(retailUser.address)).to.equal(
        totalRetailMinted.sub(defiAmount)
      )
      expect(await tbtc.balanceOf(bitcoinUser.address)).to.equal(defiAmount)

      // PHASE 3: Redemption by another user
      console.log("Phase 3: Cross-User Redemption")
      
      // 3.1 Bitcoin user redeems the received tokens
      const redemptionAmount = defiAmount.div(2) // Redeem half
      const userBtcAddress = TEST_DATA.BTC_ADDRESSES.SEGWIT

      await qcRedeemer
        .connect(bitcoinUser)
        .initiateRedemption(qcAddress.address, redemptionAmount, userBtcAddress)

      expect(await tbtc.balanceOf(bitcoinUser.address)).to.equal(
        defiAmount.sub(redemptionAmount)
      )

      // 3.2 Total supply correctly decreases
      const expectedTotalSupply = LARGE_MINT_AMOUNT
        .add(totalRetailMinted)
        .sub(redemptionAmount)
      
      expect(await tbtc.totalSupply()).to.equal(expectedTotalSupply)
    })
  })

  describe("Crisis Scenario: QC Under Investigation", () => {
    beforeEach(async () => {
      // Setup: Multiple users have minted tokens
      await basicMintingPolicy.executeMint(
        institutionalUser.address,
        qcAddress.address,
        LARGE_MINT_AMOUNT
      )
      
      await basicMintingPolicy.executeMint(
        retailUser.address,
        qcAddress.address,
        MEDIUM_MINT_AMOUNT
      )
    })

    it("should handle QC investigation and recovery process", async () => {
      // PHASE 1: Initial suspicious activity detected
      console.log("Phase 1: Suspicious Activity Detection")
      
      // 1.1 Watchdog detects unusual reserve movement
      await watchdogMonitor
        .connect(watchdog1)
        .submitCriticalReport(
          qcAddress.address,
          "Unusual 30% reserve decrease detected in 1 hour"
        )

      // 1.2 Additional watchdogs confirm
      await watchdogMonitor
        .connect(watchdog2)
        .submitCriticalReport(
          qcAddress.address,
          "Confirming significant reserve movement - investigating"
        )

      // System still operational with 2 reports
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.false

      // PHASE 2: Emergency threshold reached
      console.log("Phase 2: Emergency Response")
      
      // 2.1 Third watchdog report triggers emergency
      await watchdogMonitor
        .connect(watchdog3)
        .submitCriticalReport(
          qcAddress.address,
          "CRITICAL: Potential unauthorized access to QC reserves"
        )

      // 2.2 Emergency state activated
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.true

      // 2.3 All new minting blocked
      const canMint = await basicMintingPolicy.canMint(
        retailUser.address,
        qcAddress.address,
        SMALL_MINT_AMOUNT
      )
      expect(canMint).to.be.false

      // 2.4 Existing token holders can still transfer and redeem
      await tbtc
        .connect(institutionalUser)
        .transfer(retailUser.address, ethers.utils.parseEther("10"))

      await qcRedeemer
        .connect(institutionalUser)
        .initiateRedemption(
          qcAddress.address,
          ethers.utils.parseEther("50"),
          TEST_DATA.BTC_ADDRESSES.LEGACY
        )

      // PHASE 3: Investigation and consensus action
      console.log("Phase 3: Consensus Investigation")
      
      // 3.1 Watchdog consensus initiates formal investigation
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [
          qcAddress.address,
          QCStatus.UnderReview,
          ethers.utils.id("EMERGENCY_INVESTIGATION"),
        ]
      )

      const tx = await watchdogConsensusManager
        .connect(watchdog1)
        .createProposal(
          0,
          proposalData,
          "Emergency investigation - suspicious reserve activity"
        )

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "ProposalCreated")
      const proposalId = event?.args?.proposalId

      // 3.2 Consensus reached to place under review
      await watchdogConsensusManager.connect(watchdog1).vote(proposalId)
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId)
      await watchdogConsensusManager.connect(watchdog1).executeProposal(proposalId)

      expect(await qcData.getQCStatus(qcAddress.address)).to.equal(
        QCStatus.UnderReview
      )

      // PHASE 4: Investigation outcome and recovery
      console.log("Phase 4: Recovery Process")
      
      // 4.1 Investigation reveals false alarm - QC cleared
      await helpers.time.increase(86400) // 24 hours later

      // 4.2 Governance clears emergency and restores status
      await watchdogMonitor
        .connect(governance)
        .clearEmergencyPause(qcAddress.address)

      const recoveryProposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.Active, ethers.utils.id("INVESTIGATION_CLEARED")]
      )

      const recoveryTx = await watchdogConsensusManager
        .connect(watchdog2)
        .createProposal(
          0,
          recoveryProposalData,
          "Investigation complete - QC cleared for operation"
        )

      const recoveryReceipt = await recoveryTx.wait()
      const recoveryEvent = recoveryReceipt.events?.find((e) => e.event === "ProposalCreated")
      const recoveryProposalId = recoveryEvent?.args?.proposalId

      await watchdogConsensusManager.connect(watchdog1).vote(recoveryProposalId)
      await watchdogConsensusManager.connect(watchdog2).vote(recoveryProposalId)
      await watchdogConsensusManager.connect(watchdog1).executeProposal(recoveryProposalId)

      // 4.3 System fully operational again
      expect(await qcData.getQCStatus(qcAddress.address)).to.equal(QCStatus.Active)
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.false

      const canMintAfterRecovery = await basicMintingPolicy.canMint(
        retailUser.address,
        qcAddress.address,
        SMALL_MINT_AMOUNT
      )
      expect(canMintAfterRecovery).to.be.true

      // 4.4 Users resume normal operations
      await basicMintingPolicy.executeMint(
        retailUser.address,
        qcAddress.address,
        SMALL_MINT_AMOUNT
      )
    })
  })

  describe("Worst Case Scenario: QC Insolvency and Revocation", () => {
    beforeEach(async () => {
      // Setup significant token issuance
      await basicMintingPolicy.executeMint(
        institutionalUser.address,
        qcAddress.address,
        LARGE_MINT_AMOUNT
      )
      
      await basicMintingPolicy.executeMint(
        retailUser.address,
        qcAddress.address,
        MEDIUM_MINT_AMOUNT
      )
      
      await basicMintingPolicy.executeMint(
        bitcoinUser.address,
        qcAddress.address,
        MEDIUM_MINT_AMOUNT
      )
    })

    it("should handle QC insolvency detection and revocation process", async () => {
      const totalMinted = LARGE_MINT_AMOUNT.add(MEDIUM_MINT_AMOUNT).add(MEDIUM_MINT_AMOUNT)
      
      // PHASE 1: Insolvency discovered
      console.log("Phase 1: Insolvency Detection")
      
      // 1.1 QC reserves drop dramatically (simulate major loss)
      const criticalReserves = ethers.utils.parseEther("800") // Below total minted
      await qcQCReserveLedger
        .connect(fixture.watchdog)
        .submitReserveAttestation(qcAddress.address, criticalReserves)

      // 1.2 Solvency check fails
      const isSolvent = await qcManager.verifyQCSolvency(qcAddress.address)
      expect(isSolvent).to.be.false

      // 1.3 Watchdog detects and reports insolvency
      await qcWatchdog
        .connect(fixture.watchdog)
        .verifySolvencyAndAct(qcAddress.address)

      // Status automatically changed to UnderReview
      expect(await qcData.getQCStatus(qcAddress.address)).to.equal(
        QCStatus.UnderReview
      )

      // PHASE 2: Emergency response and user impact
      console.log("Phase 2: Emergency Response")
      
      // 2.1 Multiple watchdogs report critical insolvency
      for (let i = 0; i < 3; i++) {
        await watchdogMonitor
          .connect([watchdog1, watchdog2, watchdog3][i])
          .submitCriticalReport(
            qcAddress.address,
            `CRITICAL INSOLVENCY: Reserves ${criticalReserves.div(ethers.utils.parseEther("1"))} BTC vs Minted ${totalMinted.div(ethers.utils.parseEther("1"))} tBTC`
          )
      }

      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.true

      // 2.2 New minting completely blocked
      const canMint = await basicMintingPolicy.canMint(
        retailUser.address,
        qcAddress.address,
        SMALL_MINT_AMOUNT
      )
      expect(canMint).to.be.false

      // 2.3 Users can still redeem but at potential loss
      await qcRedeemer
        .connect(institutionalUser)
        .initiateRedemption(
          qcAddress.address,
          ethers.utils.parseEther("100"),
          TEST_DATA.BTC_ADDRESSES.LEGACY
        )

      // PHASE 3: Formal revocation process
      console.log("Phase 3: QC Revocation")
      
      // 3.1 Consensus decides to revoke QC license
      const revocationProposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.Revoked, ethers.utils.id("INSOLVENCY_REVOCATION")]
      )

      const revocationTx = await watchdogConsensusManager
        .connect(watchdog1)
        .createProposal(
          0,
          revocationProposalData,
          "QC revocation due to confirmed insolvency"
        )

      const revocationReceipt = await revocationTx.wait()
      const revocationEvent = revocationReceipt.events?.find((e) => e.event === "ProposalCreated")
      const revocationProposalId = revocationEvent?.args?.proposalId

      await watchdogConsensusManager.connect(watchdog1).vote(revocationProposalId)
      await watchdogConsensusManager.connect(watchdog2).vote(revocationProposalId)
      await watchdogConsensusManager.connect(watchdog3).vote(revocationProposalId)
      await watchdogConsensusManager.connect(watchdog1).executeProposal(revocationProposalId)

      expect(await qcData.getQCStatus(qcAddress.address)).to.equal(QCStatus.Revoked)

      // PHASE 4: System protection and user recovery
      console.log("Phase 4: System Protection")
      
      // 4.1 All QC operations permanently blocked
      const canMintRevoked = await basicMintingPolicy.canMint(
        retailUser.address,
        qcAddress.address,
        SMALL_MINT_AMOUNT
      )
      expect(canMintRevoked).to.be.false

      // 4.2 Existing tokens still transferable (debt instruments)
      await tbtc
        .connect(retailUser)
        .transfer(bitcoinUser.address, ethers.utils.parseEther("10"))

      // 4.3 System tracks total exposure to revoked QC
      const revokedQCMinted = await qcData.getQCMintedAmount(qcAddress.address)
      expect(revokedQCMinted).to.be.gt(0)

      // 4.4 Emergency governance can clear pause to allow other QCs to operate
      await watchdogMonitor
        .connect(governance)
        .clearEmergencyPause(qcAddress.address)

      // Other QCs (if any) would remain unaffected
      // This QC specifically remains revoked but emergency state cleared
      expect(await qcData.getQCStatus(qcAddress.address)).to.equal(QCStatus.Revoked)
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.false
    })
  })

  describe("Multi-User Concurrent Operations", () => {
    it("should handle concurrent operations from multiple user types", async () => {
      // SETUP: Stagger user operations to simulate real-world usage
      
      // Wave 1: Institutional user starts large mint
      const institutionalPromise = basicMintingPolicy.executeMint(
        institutionalUser.address,
        qcAddress.address,
        LARGE_MINT_AMOUNT
      )

      // Wave 2: Multiple retail users mint concurrently
      const retailPromises = []
      for (let i = 0; i < 5; i++) {
        retailPromises.push(
          basicMintingPolicy.executeMint(
            retailUser.address,
            qcAddress.address,
            ethers.utils.parseEther((i + 1).toString()) // 1, 2, 3, 4, 5 tBTC
          )
        )
      }

      // Wave 3: Watchdog updates reserves during user operations
      const attestationPromise = qcQCReserveLedger
        .connect(fixture.watchdog)
        .submitReserveAttestation(
          qcAddress.address,
          QC_RESERVE_BALANCE.add(ethers.utils.parseEther("200"))
        )

      // Execute all operations concurrently
      await Promise.all([
        institutionalPromise,
        ...retailPromises,
        attestationPromise
      ])

      // Verify all operations completed successfully
      expect(await tbtc.balanceOf(institutionalUser.address)).to.equal(LARGE_MINT_AMOUNT)
      
      const expectedRetailTotal = ethers.utils.parseEther("15") // 1+2+3+4+5
      expect(await tbtc.balanceOf(retailUser.address)).to.equal(expectedRetailTotal)

      const totalMinted = LARGE_MINT_AMOUNT.add(expectedRetailTotal)
      expect(await tbtc.totalSupply()).to.equal(totalMinted)
      expect(await qcData.getQCMintedAmount(qcAddress.address)).to.equal(totalMinted)

      // System remains consistent
      const [currentReserves] = await qcQCReserveLedger.getReserveBalanceAndStaleness(
        qcAddress.address
      )
      expect(currentReserves).to.equal(
        QC_RESERVE_BALANCE.add(ethers.utils.parseEther("200"))
      )
    })
  })

  describe("Attack Scenario: Malicious Actor Attempts", () => {
    beforeEach(async () => {
      // Normal users have established positions
      await basicMintingPolicy.executeMint(
        institutionalUser.address,
        qcAddress.address,
        LARGE_MINT_AMOUNT
      )
    })

    it("should prevent malicious actor from exploiting the system", async () => {
      // ATTACK 1: Unauthorized minting attempt
      console.log("Attack 1: Unauthorized Minting")
      
      // Malicious actor tries to mint without proper authorization
      await expect(
        basicMintingPolicy.executeMint(
          maliciousActor.address,
          qcAddress.address,
          LARGE_MINT_AMOUNT
        )
      ).to.be.reverted // No redeemer role

      // ATTACK 2: Fake reserve attestation
      console.log("Attack 2: Fake Reserve Attestation")
      
      // Malicious actor tries to submit false reserve attestation
      await expect(
        qcQCReserveLedger
          .connect(maliciousActor)
          .submitReserveAttestation(
            qcAddress.address,
            ethers.utils.parseEther("99999") // Fake high reserves
          )
      ).to.be.revertedWith("AccessControl")

      // ATTACK 3: Unauthorized QC status change
      console.log("Attack 3: Unauthorized Status Change")
      
      // Malicious actor tries to change QC status
      await expect(
        qcManager
          .connect(maliciousActor)
          .setQCStatus(
            qcAddress.address,
            QCStatus.Active,
            ethers.utils.id("FAKE_APPROVAL")
          )
      ).to.be.revertedWith("AccessControl")

      // ATTACK 4: Unauthorized watchdog consensus manipulation
      console.log("Attack 4: Consensus Manipulation")
      
      // Malicious actor tries to create fraudulent proposal
      const maliciousProposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.Active, ethers.utils.id("MALICIOUS")]
      )

      await expect(
        watchdogConsensusManager
          .connect(maliciousActor)
          .createProposal(0, maliciousProposalData, "Malicious proposal")
      ).to.be.revertedWith("AccessControl")

      // ATTACK 5: Emergency system abuse
      console.log("Attack 5: Emergency System Abuse")
      
      // Malicious actor tries to trigger false emergency
      await expect(
        watchdogMonitor
          .connect(maliciousActor)
          .submitCriticalReport(qcAddress.address, "False emergency")
      ).to.be.revertedWith("AccessControl")

      // VERIFICATION: System integrity maintained
      console.log("Verification: System Integrity")
      
      // All legitimate operations still work
      const canMint = await basicMintingPolicy.canMint(
        retailUser.address,
        qcAddress.address,
        MEDIUM_MINT_AMOUNT
      )
      expect(canMint).to.be.true

      await basicMintingPolicy.executeMint(
        retailUser.address,
        qcAddress.address,
        MEDIUM_MINT_AMOUNT
      )

      // System state remains correct
      expect(await qcData.getQCStatus(qcAddress.address)).to.equal(QCStatus.Active)
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.false
      
      const expectedSupply = LARGE_MINT_AMOUNT.add(MEDIUM_MINT_AMOUNT)
      expect(await tbtc.totalSupply()).to.equal(expectedSupply)
    })
  })

  describe("System Upgrade and Migration Journey", () => {
    it("should handle system upgrades while maintaining user operations", async () => {
      // SETUP: Users have active positions
      await basicMintingPolicy.executeMint(
        institutionalUser.address,
        qcAddress.address,
        LARGE_MINT_AMOUNT
      )
      
      await basicMintingPolicy.executeMint(
        retailUser.address,
        qcAddress.address,
        MEDIUM_MINT_AMOUNT
      )

      // PHASE 1: Pre-upgrade state
      console.log("Phase 1: Pre-Upgrade Operations")
      
      const totalSupplyBefore = await tbtc.totalSupply()
      expect(totalSupplyBefore).to.equal(LARGE_MINT_AMOUNT.add(MEDIUM_MINT_AMOUNT))

      // Users can redeem normally
      await qcRedeemer
        .connect(retailUser)
        .initiateRedemption(
          qcAddress.address,
          ethers.utils.parseEther("50"),
          TEST_DATA.BTC_ADDRESSES.LEGACY
        )

      // PHASE 2: Upgrade preparation
      console.log("Phase 2: Upgrade Preparation")
      
      // System pause for upgrade (governance action)
      await systemState.pauseMinting()
      await systemState.pauseRedemption()

      // Verify operations blocked during upgrade
      const canMintDuringUpgrade = await basicMintingPolicy.canMint(
        retailUser.address,
        qcAddress.address,
        SMALL_MINT_AMOUNT
      )
      expect(canMintDuringUpgrade).to.be.false

      // PHASE 3: Simulate upgrade (deploy new contracts)
      console.log("Phase 3: Contract Upgrade")
      
      // Deploy new policy contract (example)
      const NewMintingPolicy = await ethers.getContractFactory("BasicMintingPolicy")
      const newMintingPolicy = await NewMintingPolicy.deploy(protocolRegistry.address)
      await newMintingPolicy.deployed()

      // Grant necessary roles to new contract
      await qcManager.grantRole(ROLES.QC_ADMIN_ROLE, newMintingPolicy.address)
      await tbtc.transferOwnership(newMintingPolicy.address)

      // Update service registry
      await protocolRegistry.setService(
        SERVICE_KEYS.MINTING_POLICY,
        newMintingPolicy.address
      )

      // PHASE 4: Post-upgrade operations
      console.log("Phase 4: Post-Upgrade Operations")
      
      // Resume operations
      await systemState.unpauseMinting()
      await systemState.unpauseRedemption()

      // Verify operations work with new contracts
      const canMintAfterUpgrade = await newMintingPolicy.canMint(
        retailUser.address,
        qcAddress.address,
        SMALL_MINT_AMOUNT
      )
      expect(canMintAfterUpgrade).to.be.true

      await newMintingPolicy.executeMint(
        retailUser.address,
        qcAddress.address,
        SMALL_MINT_AMOUNT
      )

      // PHASE 5: State consistency verification
      console.log("Phase 5: State Consistency Check")
      
      // All user balances preserved
      expect(await tbtc.balanceOf(institutionalUser.address)).to.equal(LARGE_MINT_AMOUNT)
      expect(await tbtc.balanceOf(retailUser.address)).to.be.gt(MEDIUM_MINT_AMOUNT) // Includes new mint

      // QC state preserved
      expect(await qcData.getQCStatus(qcAddress.address)).to.equal(QCStatus.Active)
      expect(await qcData.isQCRegistered(qcAddress.address)).to.be.true

      // Total supply consistency maintained
      const totalSupplyAfter = await tbtc.totalSupply()
      expect(totalSupplyAfter).to.be.gt(totalSupplyBefore) // Increased by new mint minus redemption
    })
  })
})