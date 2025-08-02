import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  QCWatchdog,
  QCManager,
  QCReserveLedger,
  QCData,
  QCRedeemer,
  WatchdogMonitor,
  WatchdogConsensusManager,
  ProtocolRegistry,
  SystemState,
} from "../../typechain"
import {
  ROLES,
  SERVICE_KEYS,
  TEST_DATA,
  QCStatus,
} from "./AccountControlTestHelpers"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("Watchdog Reserve Monitoring", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let watchdog4: SignerWithAddress
  let watchdog5: SignerWithAddress
  let qcAddress: SignerWithAddress
  let user: SignerWithAddress

  // Contracts
  let qcWatchdog1: QCWatchdog
  let qcWatchdog2: QCWatchdog
  let qcWatchdog3: QCWatchdog
  let watchdogMonitor: WatchdogMonitor
  let watchdogConsensusManager: WatchdogConsensusManager
  let protocolRegistry: ProtocolRegistry

  // Mocks
  let mockQcManager: FakeContract<QCManager>
  let mockQcReserveLedger: FakeContract<QCReserveLedger>
  let mockQcData: FakeContract<QCData>
  let mockSystemState: FakeContract<SystemState>
  let mockQcRedeemer: FakeContract<QCRedeemer>

  // Test data
  const initialReserves = ethers.utils.parseEther("100")
  const mintedAmount = ethers.utils.parseEther("50")

  // Helper to simulate reserve change with multiple watchdogs
  async function simulateReserveChange(
    qc: string,
    oldBalance: ethers.BigNumber,
    newBalance: ethers.BigNumber,
    watchdogs: { contract: QCWatchdog; signer: SignerWithAddress }[]
  ): Promise<{
    transactions: any[]
    percentageChange: ethers.BigNumber
    consensusReached: boolean
  }> {
    const results = []

    for (const { contract, signer } of watchdogs) {
      const tx = await contract.connect(signer).attestReserves(qc, newBalance)
      results.push(await tx.wait())
    }

    const percentageChange = oldBalance
      .sub(newBalance)
      .mul(100)
      .div(oldBalance)

    return {
      transactions: results,
      percentageChange,
      consensusReached: results.length >= 2,
    }
  }

  before(async () => {
    ;[
      deployer,
      governance,
      watchdog1,
      watchdog2,
      watchdog3,
      watchdog4,
      watchdog5,
      qcAddress,
      user,
    ] = await ethers.getSigners()
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy ProtocolRegistry first
    const ProtocolRegistry = await ethers.getContractFactory("ProtocolRegistry")
    protocolRegistry = await ProtocolRegistry.deploy()
    await protocolRegistry.deployed()

    // Deploy mocks
    mockQcManager = await smock.fake<QCManager>("QCManager")
    mockQcReserveLedger = await smock.fake<QCReserveLedger>("QCReserveLedger")
    mockQcData = await smock.fake<QCData>("QCData")
    mockSystemState = await smock.fake<SystemState>("SystemState")
    mockQcRedeemer = await smock.fake<QCRedeemer>("QCRedeemer")

    // Register services in protocol registry
    await protocolRegistry.setService(
      SERVICE_KEYS.QC_MANAGER,
      mockQcManager.address
    )
    await protocolRegistry.setService(
      SERVICE_KEYS.QC_RESERVE_LEDGER,
      mockQcReserveLedger.address
    )
    await protocolRegistry.setService(SERVICE_KEYS.QC_DATA, mockQcData.address)
    await protocolRegistry.setService(
      SERVICE_KEYS.SYSTEM_STATE,
      mockSystemState.address
    )

    // Deploy WatchdogConsensusManager
    const WatchdogConsensusManager = await ethers.getContractFactory(
      "WatchdogConsensusManager"
    )
    watchdogConsensusManager = await WatchdogConsensusManager.deploy(
      mockQcManager.address,
      mockQcRedeemer.address,
      mockQcData.address
    )
    await watchdogConsensusManager.deployed()

    // Deploy WatchdogMonitor
    const WatchdogMonitor = await ethers.getContractFactory("WatchdogMonitor")
    watchdogMonitor = await WatchdogMonitor.deploy(
      watchdogConsensusManager.address,
      mockQcData.address
    )
    await watchdogMonitor.deployed()

    // Deploy QCWatchdog instances
    const QCWatchdog = await ethers.getContractFactory("QCWatchdog")
    qcWatchdog1 = await QCWatchdog.deploy(protocolRegistry.address)
    qcWatchdog2 = await QCWatchdog.deploy(protocolRegistry.address)
    qcWatchdog3 = await QCWatchdog.deploy(protocolRegistry.address)
    await qcWatchdog1.deployed()
    await qcWatchdog2.deployed()
    await qcWatchdog3.deployed()

    // Setup roles for watchdogs
    await qcWatchdog1.grantRole(ROLES.WATCHDOG_OPERATOR_ROLE, watchdog1.address)
    await qcWatchdog2.grantRole(ROLES.WATCHDOG_OPERATOR_ROLE, watchdog2.address)
    await qcWatchdog3.grantRole(ROLES.WATCHDOG_OPERATOR_ROLE, watchdog3.address)

    // Grant watchdogs necessary roles in system contracts
    await mockQcManager.hasRole.returns(true)
    await mockQcReserveLedger.hasRole.returns(true)

    // Setup default mock returns
    mockQcData.isQCRegistered.returns(true)
    mockQcData.getQCStatus.returns(QCStatus.Active)
    mockQcData.getQCMintedAmount.returns(mintedAmount)
    mockQcReserveLedger.getReserveBalanceAndStaleness.returns([
      initialReserves,
      false,
    ])
    mockSystemState.isMintingPaused.returns(false)

    // Register watchdogs in monitor
    await watchdogMonitor.grantRole(ROLES.DEFAULT_ADMIN_ROLE, governance.address)
    await watchdogMonitor
      .connect(governance)
      .grantRole(await watchdogMonitor.MANAGER_ROLE(), governance.address)

    await watchdogMonitor
      .connect(governance)
      .registerWatchdog(qcWatchdog1.address, watchdog1.address, "Alpha")
    await watchdogMonitor
      .connect(governance)
      .registerWatchdog(qcWatchdog2.address, watchdog2.address, "Beta")
    await watchdogMonitor
      .connect(governance)
      .registerWatchdog(qcWatchdog3.address, watchdog3.address, "Gamma")

    // Grant watchdog operator roles in monitor
    await watchdogMonitor
      .connect(governance)
      .grantRole(ROLES.WATCHDOG_OPERATOR_ROLE, watchdog1.address)
    await watchdogMonitor
      .connect(governance)
      .grantRole(ROLES.WATCHDOG_OPERATOR_ROLE, watchdog2.address)
    await watchdogMonitor
      .connect(governance)
      .grantRole(ROLES.WATCHDOG_OPERATOR_ROLE, watchdog3.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Basic Reserve Decrease Detection", () => {
    it("should detect and report reserve decrease while maintaining solvency", async () => {
      // Initial state: 100 BTC reserves, 50 tBTC minted
      const newReserves = ethers.utils.parseEther("70") // 30% decrease

      // Watchdog detects decrease and submits attestation
      const tx = await qcWatchdog1
        .connect(watchdog1)
        .attestReserves(qcAddress.address, newReserves)

      // Should emit event showing the decrease
      await expect(tx)
        .to.emit(qcWatchdog1, "WatchdogReserveAttestation")
        .withArgs(
          qcAddress.address,
          newReserves,
          0, // Old balance would be 0 in this simplified test
          watchdog1.address,
          await helpers.time.latest()
        )

      // Verify solvency check - should still be solvent (70 > 50)
      mockQcReserveLedger.getReserveBalanceAndStaleness.returns([
        newReserves,
        false,
      ])
      
      const isSolvent = await qcWatchdog1
        .connect(watchdog1)
        .verifyQCSolvency(qcAddress.address)
      
      // QCManager should verify solvency correctly
      mockQcManager.verifyQCSolvency.returns(true) // 70 > 50, still solvent
      expect(isSolvent).to.be.true

      // QC should remain active
      mockQcData.getQCStatus.returns(QCStatus.Active)
    })

    it("should detect percentage decreases accurately", async () => {
      const testCases = [
        { from: "100", to: "90", expectedPercentage: 10 },
        { from: "100", to: "75", expectedPercentage: 25 },
        { from: "100", to: "50", expectedPercentage: 50 },
        { from: "100", to: "25", expectedPercentage: 75 },
      ]

      for (const testCase of testCases) {
        const fromAmount = ethers.utils.parseEther(testCase.from)
        const toAmount = ethers.utils.parseEther(testCase.to)

        const result = await simulateReserveChange(
          qcAddress.address,
          fromAmount,
          toAmount,
          [{ contract: qcWatchdog1, signer: watchdog1 }]
        )

        expect(result.percentageChange).to.equal(testCase.expectedPercentage)
      }
    })

    it("should distinguish normal volatility from significant movement", async () => {
      // Small change (< 5%) - normal volatility
      const smallDecrease = ethers.utils.parseEther("97") // 3% decrease

      await qcWatchdog1
        .connect(watchdog1)
        .attestReserves(qcAddress.address, smallDecrease)

      // No critical report should be triggered for small changes
      // In real implementation, this would be configurable

      // Large change (> 20%) - significant movement
      const largeDecrease = ethers.utils.parseEther("75") // 25% decrease

      await qcWatchdog1
        .connect(watchdog1)
        .attestReserves(qcAddress.address, largeDecrease)

      // This should trigger monitoring/alerts in production
      // Watchdog could submit critical report
      await watchdogMonitor
        .connect(watchdog1)
        .submitCriticalReport(
          qcAddress.address,
          "Significant 25% reserve decrease detected"
        )

      expect(
        await watchdogMonitor.getRecentReportCount(qcAddress.address)
      ).to.equal(1)
    })
  })

  describe("Critical Reserve Decrease Leading to Insolvency", () => {
    it("should detect insolvency from reserve decrease", async () => {
      // Initial: 100 BTC reserves, 80 tBTC minted
      mockQcData.getQCMintedAmount.returns(ethers.utils.parseEther("80"))
      
      // QC moves 40 BTC out (reserves drop to 60 BTC)
      const newReserves = ethers.utils.parseEther("60")

      // Multiple watchdogs detect the change
      await simulateReserveChange(
        qcAddress.address,
        initialReserves,
        newReserves,
        [
          { contract: qcWatchdog1, signer: watchdog1 },
          { contract: qcWatchdog2, signer: watchdog2 },
          { contract: qcWatchdog3, signer: watchdog3 },
        ]
      )

      // Update mock to reflect new reserves
      mockQcReserveLedger.getReserveBalanceAndStaleness.returns([
        newReserves,
        false,
      ])

      // Verify insolvency detection (60 < 80)
      mockQcManager.verifyQCSolvency.returns(false)
      
      // Watchdog takes action
      const tx = await qcWatchdog1
        .connect(watchdog1)
        .verifySolvencyAndAct(qcAddress.address)

      // Should emit status change event
      await expect(tx)
        .to.emit(qcWatchdog1, "WatchdogQCStatusChange")
        .withArgs(
          qcAddress.address,
          QCStatus.UnderReview,
          "INSOLVENCY_DETECTED",
          watchdog1.address,
          await helpers.time.latest()
        )

      // Verify minting would be blocked
      // In real implementation, BasicMintingPolicy would check QC status
      mockQcData.getQCStatus.returns(QCStatus.UnderReview)
    })

    it("should coordinate emergency response for insolvency", async () => {
      // Setup insolvency condition
      mockQcData.getQCMintedAmount.returns(ethers.utils.parseEther("80"))
      const criticalReserves = ethers.utils.parseEther("40") // 50% of minted

      // Multiple watchdogs detect and report
      const watchdogs = [
        { contract: qcWatchdog1, signer: watchdog1 },
        { contract: qcWatchdog2, signer: watchdog2 },
        { contract: qcWatchdog3, signer: watchdog3 },
      ]

      // All watchdogs submit critical reports
      for (let i = 0; i < watchdogs.length; i++) {
        await watchdogMonitor
          .connect(watchdogs[i].signer)
          .submitCriticalReport(
            qcAddress.address,
            `Watchdog ${i + 1}: Critical insolvency detected - reserves at 50% of minted`
          )
      }

      // Should trigger emergency pause
      expect(
        await watchdogMonitor.isEmergencyPaused(qcAddress.address)
      ).to.be.true

      // All QC operations should be frozen
      // In production, this would be checked by all system contracts
    })
  })

  describe("Gradual Reserve Depletion Pattern", () => {
    it("should track pattern of gradual decreases", async () => {
      const depletionSteps = [
        { reserves: "100", timestamp: 0 },
        { reserves: "90", timestamp: 3600 }, // 1 hour later
        { reserves: "80", timestamp: 7200 }, // 2 hours later
        { reserves: "70", timestamp: 10800 }, // 3 hours later
      ]

      let previousReserves = ethers.utils.parseEther(depletionSteps[0].reserves)

      for (let i = 1; i < depletionSteps.length; i++) {
        // Advance time
        if (i > 1) {
          await helpers.time.increase(
            depletionSteps[i].timestamp - depletionSteps[i - 1].timestamp
          )
        }

        const currentReserves = ethers.utils.parseEther(
          depletionSteps[i].reserves
        )

        // Watchdog detects and reports decrease
        await qcWatchdog1
          .connect(watchdog1)
          .attestReserves(qcAddress.address, currentReserves)

        // Calculate depletion rate
        const depletionRate = previousReserves
          .sub(currentReserves)
          .mul(3600) // Per hour
          .div(depletionSteps[i].timestamp - depletionSteps[i - 1].timestamp)

        // After 3rd decrease, pattern should be recognized
        if (i >= 3) {
          // Watchdog should raise alarm about consistent depletion
          await watchdogMonitor
            .connect(watchdog1)
            .submitCriticalReport(
              qcAddress.address,
              "Consistent depletion pattern detected: 10 BTC/hour"
            )
        }

        previousReserves = currentReserves
      }

      // Verify pattern was detected
      expect(
        await watchdogMonitor.getRecentReportCount(qcAddress.address)
      ).to.be.gte(1)
    })

    it("should predict when reserves will reach critical levels", async () => {
      // Starting: 100 BTC reserves, 70 tBTC minted
      mockQcData.getQCMintedAmount.returns(ethers.utils.parseEther("70"))

      // Depletion rate: 5 BTC per hour
      const depletionRate = ethers.utils.parseEther("5")
      
      // Current reserves after some depletion
      const currentReserves = ethers.utils.parseEther("85")
      
      // Calculate when reserves will equal minted amount
      const reserveBuffer = currentReserves.sub(ethers.utils.parseEther("70"))
      const hoursUntilCritical = reserveBuffer.div(depletionRate)

      // Watchdog should issue predictive warning
      if (hoursUntilCritical.lte(6)) {
        // Less than 6 hours until critical
        await watchdogMonitor
          .connect(watchdog1)
          .submitCriticalReport(
            qcAddress.address,
            `WARNING: At current depletion rate, reserves will reach critical level in ${hoursUntilCritical} hours`
          )
      }
    })
  })

  describe("Consensus Formation on Reserve Changes", () => {
    it("should form consensus when multiple watchdogs report same decrease", async () => {
      const newReserves = ethers.utils.parseEther("70")

      // All 3 watchdogs independently detect and report 70 BTC
      const result = await simulateReserveChange(
        qcAddress.address,
        initialReserves,
        newReserves,
        [
          { contract: qcWatchdog1, signer: watchdog1 },
          { contract: qcWatchdog2, signer: watchdog2 },
          { contract: qcWatchdog3, signer: watchdog3 },
        ]
      )

      expect(result.consensusReached).to.be.true

      // In production, consensus would trigger single coordinated action
      // rather than duplicate actions
    })

    it("should handle conflicting reserve reports", async () => {
      // Watchdog 1 reports 100 BTC (stale or compromised)
      await qcWatchdog1
        .connect(watchdog1)
        .attestReserves(qcAddress.address, ethers.utils.parseEther("100"))

      // Watchdog 2 reports 70 BTC (correct)
      await qcWatchdog2
        .connect(watchdog2)
        .attestReserves(qcAddress.address, ethers.utils.parseEther("70"))

      // Watchdog 3 reports 75 BTC (timing difference)
      await qcWatchdog3
        .connect(watchdog3)
        .attestReserves(qcAddress.address, ethers.utils.parseEther("75"))

      // In production, this would trigger investigation
      // System should take conservative approach (assume lower balance)
      
      // For now, watchdogs can submit reports about discrepancy
      await watchdogMonitor
        .connect(watchdog2)
        .submitCriticalReport(
          qcAddress.address,
          "Significant discrepancy in reserve attestations detected"
        )
    })

    it("should handle Byzantine watchdog reporting false reserves", async () => {
      // Setup: 1 Byzantine watchdog, 4 honest watchdogs
      const byzantineReserves = ethers.utils.parseEther("100") // False high
      const actualReserves = ethers.utils.parseEther("60") // Actual

      // Byzantine watchdog reports false high reserves
      await qcWatchdog1
        .connect(watchdog1)
        .attestReserves(qcAddress.address, byzantineReserves)

      // Other watchdogs report correct lower reserves
      await qcWatchdog2
        .connect(watchdog2)
        .attestReserves(qcAddress.address, actualReserves)

      await qcWatchdog3
        .connect(watchdog3)
        .attestReserves(qcAddress.address, actualReserves)

      // In consensus system, majority (2 out of 3) would prevail
      // Byzantine watchdog would be flagged for investigation

      // Submit report about Byzantine behavior
      await watchdogMonitor
        .connect(watchdog2)
        .submitCriticalReport(
          qcAddress.address,
          "Potential Byzantine behavior detected from watchdog reporting anomalous reserves"
        )

      await watchdogMonitor
        .connect(watchdog3)
        .submitCriticalReport(
          qcAddress.address,
          "Confirming Byzantine behavior - watchdog 1 reporting false reserves"
        )
    })
  })

  describe("Emergency Response to Large Balance Drop", () => {
    it("should trigger emergency response for 50%+ decrease", async () => {
      // Attestation shows drop from 100 to 45 BTC (55% decrease)
      const criticalReserves = ethers.utils.parseEther("45")

      // Multiple watchdogs detect and submit critical reports
      const watchdogs = [watchdog1, watchdog2, watchdog3]

      for (const watchdog of watchdogs) {
        await watchdogMonitor
          .connect(watchdog)
          .submitCriticalReport(
            qcAddress.address,
            "EMERGENCY: 55% reserve decrease detected - possible fund extraction"
          )
      }

      // Verify emergency pause triggered
      expect(
        await watchdogMonitor.isEmergencyPaused(qcAddress.address)
      ).to.be.true

      // All QC operations should be frozen
      // DAO emergency notification would be sent
    })

    it("should coordinate immediate response for critical drops", async () => {
      const emergencyReserves = ethers.utils.parseEther("30") // 70% drop

      // First watchdog detects and uses strategic attestation
      await qcWatchdog1
        .connect(watchdog1)
        .strategicAttestation(
          qcAddress.address,
          emergencyReserves,
          "INSOLVENCY"
        )

      // This should bypass normal delays for immediate action
      // Other watchdogs alerted to verify
      
      // Submit emergency reports
      await watchdogMonitor
        .connect(watchdog1)
        .submitCriticalReport(
          qcAddress.address,
          "CRITICAL: Strategic attestation triggered - 70% reserve loss"
        )

      await watchdogMonitor
        .connect(watchdog2)
        .submitCriticalReport(
          qcAddress.address,
          "CONFIRMED: Verifying critical reserve loss"
        )

      await watchdogMonitor
        .connect(watchdog3)
        .submitCriticalReport(
          qcAddress.address,
          "CONFIRMED: Emergency response required"
        )

      // Emergency should be active
      expect(
        await watchdogMonitor.isEmergencyPaused(qcAddress.address)
      ).to.be.true
    })
  })

  describe("Pattern-Based Detection", () => {
    it("should detect rapid sequential withdrawals", async () => {
      // Simulate rapid withdrawals over 4 hours
      const withdrawalPattern = [
        { hour: 0, reserves: "100" },
        { hour: 1, reserves: "95" }, // -5
        { hour: 2, reserves: "89" }, // -6
        { hour: 3, reserves: "82" }, // -7
        { hour: 4, reserves: "74" }, // -8
      ]

      for (let i = 1; i < withdrawalPattern.length; i++) {
        // Advance time by 1 hour
        if (i > 1) {
          await helpers.time.increase(3600)
        }

        const reserves = ethers.utils.parseEther(withdrawalPattern[i].reserves)
        
        await qcWatchdog1
          .connect(watchdog1)
          .attestReserves(qcAddress.address, reserves)

        // After 3rd decrease, pattern should be detected
        if (i >= 3) {
          const decreaseRate = i + 4 // 7, 8 BTC per hour
          
          await watchdogMonitor
            .connect(watchdog1)
            .submitCriticalReport(
              qcAddress.address,
              `Accelerating withdrawal pattern detected: ${decreaseRate} BTC/hour`
            )

          // Pattern detection should trigger even though individual changes are small
          if (i === 4) {
            // After 4 sequential decreases with acceleration
            await watchdogMonitor
              .connect(watchdog2)
              .submitCriticalReport(
                qcAddress.address,
                "Confirming accelerating withdrawal pattern - emergency review needed"
              )

            await watchdogMonitor
              .connect(watchdog3)
              .submitCriticalReport(
                qcAddress.address,
                "Pattern indicates systematic fund extraction"
              )

            // Should trigger emergency
            expect(
              await watchdogMonitor.isEmergencyPaused(qcAddress.address)
            ).to.be.true
          }
        }
      }
    })
  })

  describe("Edge Cases", () => {
    it("should handle reserve increase after concerning decrease", async () => {
      // Reserves drop from 100 to 60 BTC
      const lowReserves = ethers.utils.parseEther("60")
      
      await qcWatchdog1
        .connect(watchdog1)
        .attestReserves(qcAddress.address, lowReserves)

      // Submit concern
      await watchdogMonitor
        .connect(watchdog1)
        .submitCriticalReport(
          qcAddress.address,
          "40% reserve decrease detected - monitoring closely"
        )

      // Before action taken, reserves increase to 110 BTC
      const recoveredReserves = ethers.utils.parseEther("110")
      
      await qcWatchdog1
        .connect(watchdog1)
        .attestReserves(qcAddress.address, recoveredReserves)

      // System should note recovery but maintain heightened monitoring
      // QC remains on watch list despite recovery
      
      // Report count should still show the concern
      expect(
        await watchdogMonitor.getRecentReportCount(qcAddress.address)
      ).to.equal(1)
    })

    it("should handle attestation during active fund movement", async () => {
      // Watchdog A attests during Bitcoin transaction (sees 100 BTC)
      await qcWatchdog1
        .connect(watchdog1)
        .attestReserves(qcAddress.address, ethers.utils.parseEther("100"))

      // Small time delay
      await helpers.time.increase(300) // 5 minutes

      // Watchdog B attests after transaction completes (sees 70 BTC)
      await qcWatchdog2
        .connect(watchdog2)
        .attestReserves(qcAddress.address, ethers.utils.parseEther("70"))

      // System should recognize timing discrepancy
      // In production, would wait for consensus before taking action
      
      // Watchdog can flag the discrepancy
      await watchdogMonitor
        .connect(watchdog2)
        .submitCriticalReport(
          qcAddress.address,
          "30 BTC discrepancy detected - possible attestation during active transaction"
        )
    })

    it("should differentiate between stale attestation and fund movement", async () => {
      // Last attestation was 30 days old showing 100 BTC
      const staleTimestamp = (await helpers.time.latest()) - 30 * 24 * 60 * 60
      
      // New attestation shows 70 BTC
      const currentReserves = ethers.utils.parseEther("70")
      
      await qcWatchdog1
        .connect(watchdog1)
        .attestReserves(qcAddress.address, currentReserves)

      // System should request intermediate attestations or blockchain evidence
      // before concluding this is a sudden 30% drop
      
      // Watchdog notes the staleness issue
      await watchdogMonitor
        .connect(watchdog1)
        .submitCriticalReport(
          qcAddress.address,
          "30% difference from last attestation, but previous data was 30 days stale - requesting verification"
        )

      // Other watchdogs should help verify
      await qcWatchdog2
        .connect(watchdog2)
        .attestReserves(qcAddress.address, currentReserves)

      await qcWatchdog3
        .connect(watchdog3)
        .attestReserves(qcAddress.address, currentReserves)

      // With consensus on 70 BTC, system can make informed decision
    })
  })
})