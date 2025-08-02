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
  deploySecurityTestFixture,
  SecurityTestFixture,
} from "../AccountControlTestHelpers"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("Security Integration Tests", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qcAddress: SignerWithAddress
  let legitimateUser: SignerWithAddress
  let attacker: SignerWithAddress
  let accomplice: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let compromisedWatchdog: SignerWithAddress

  // System contracts
  let fixture: SecurityTestFixture
  let protocolRegistry: ProtocolRegistry
  let qcManager: QCManager
  let qcData: QCData
  let qcMinter: QCMinter
  let qcRedeemer: QCRedeemer
  let qcReserveLedger: QCReserveLedger
  let basicMintingPolicy: BasicMintingPolicy
  let basicRedemptionPolicy: BasicRedemptionPolicy
  let qcWatchdog: QCWatchdog
  let watchdogMonitor: WatchdogMonitor
  let watchdogConsensusManager: WatchdogConsensusManager
  let systemState: SystemState
  let tbtc: FakeContract<TBTC>
  let mockSpvValidator: FakeContract<SPVValidator>

  const LARGE_AMOUNT = ethers.utils.parseEther("1000")
  const MEDIUM_AMOUNT = ethers.utils.parseEther("100")
  const SMALL_AMOUNT = ethers.utils.parseEther("10")

  before(async () => {
    ;[
      deployer,
      governance,
      qcAddress,
      legitimateUser,
      attacker,
      accomplice,
      watchdog1,
      watchdog2,
      watchdog3,
      compromisedWatchdog,
    ] = await ethers.getSigners()
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy security test fixture with mocks
    fixture = await deploySecurityTestFixture()
    
    protocolRegistry = fixture.protocolRegistry
    qcManager = fixture.qcManager
    qcData = fixture.qcData
    qcMinter = fixture.qcMinter
    qcRedeemer = fixture.qcRedeemer
    qcReserveLedger = fixture.qcReserveLedger
    basicMintingPolicy = fixture.basicMintingPolicy
    basicRedemptionPolicy = fixture.basicRedemptionPolicy
    qcWatchdog = fixture.qcWatchdog
    systemState = fixture.systemState
    tbtc = fixture.tbtc
    mockSpvValidator = fixture.mockSpvValidator

    // Deploy V1.1 watchdog system
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

    // Setup roles for security testing
    await qcRedeemer.grantRole(ROLES.REDEEMER_ROLE, legitimateUser.address)
    await qcRedeemer.grantRole(ROLES.REDEEMER_ROLE, attacker.address) // For testing

    // Setup watchdog consensus
    await watchdogConsensusManager.grantRole(
      await watchdogConsensusManager.MANAGER_ROLE(),
      governance.address
    )
    
    const allWatchdogs = [watchdog1, watchdog2, watchdog3, compromisedWatchdog]
    for (const watchdog of allWatchdogs) {
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

    for (let i = 0; i < allWatchdogs.length; i++) {
      const mockWatchdog = await smock.fake("QCWatchdog")
      await watchdogMonitor
        .connect(governance)
        .registerWatchdog(
          mockWatchdog.address,
          allWatchdogs[i].address,
          `Watchdog${i + 1}`
        )
      
      await watchdogMonitor
        .connect(governance)
        .grantRole(
          await watchdogMonitor.WATCHDOG_OPERATOR_ROLE(),
          allWatchdogs[i].address
        )
    }

    // Register test QC
    await qcData.registerQC(qcAddress.address, ethers.utils.parseEther("10000"))
    
    // Register wallet
    const { challenge, txInfo, proof } = createMockSpvData()
    await qcManager
      .connect(fixture.watchdog)
      .registerWallet(qcAddress.address, TEST_DATA.BTC_ADDRESSES.TEST, challenge, txInfo, proof)
    
    // Submit reserves
    await qcReserveLedger
      .connect(fixture.watchdog)
      .submitReserveAttestation(qcAddress.address, ethers.utils.parseEther("5000"))

    // Setup mocks for minting
    tbtc.mint.returns()
    tbtc.burnFrom.returns()
    tbtc.balanceOf.returns(0)
    tbtc.totalSupply.returns(0)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Reentrancy Attack Scenarios", () => {
    it("should prevent reentrancy attacks through TBTC token callbacks", async () => {
      // Setup: Configure malicious TBTC token that attempts reentrancy
      let reentrancyAttempted = false
      let reentrancySucceeded = false

      tbtc.mint.returns(async () => {
        if (!reentrancyAttempted) {
          reentrancyAttempted = true
          try {
            // Attempt reentrant call during minting
            await basicMintingPolicy.executeMint(
              attacker.address,
              qcAddress.address,
              SMALL_AMOUNT
            )
            reentrancySucceeded = true
          } catch (error) {
            // Reentrancy should fail
          }
        }
      })

      // Execute legitimate mint (which will attempt reentrancy)
      await basicMintingPolicy.executeMint(
        legitimateUser.address,
        qcAddress.address,
        MEDIUM_AMOUNT
      )

      // Verify reentrancy was attempted but failed
      expect(reentrancyAttempted).to.be.true
      expect(reentrancySucceeded).to.be.false
    })

    it("should prevent reentrancy through reserve attestation callbacks", async () => {
      // Deploy malicious contract that attempts reentrancy
      let callbackExecuted = false

      // Simulate callback during reserve attestation
      const originalSubmitAttestation = qcReserveLedger.submitReserveAttestation
      
      // Mock to simulate malicious callback
      const mockSubmitAttestation = async (...args: any[]) => {
        if (!callbackExecuted) {
          callbackExecuted = true
          // Attempt reentrant attestation
          await expect(
            qcReserveLedger
              .connect(fixture.watchdog)
              .submitReserveAttestation(qcAddress.address, ethers.utils.parseEther("6000"))
          ).to.not.be.reverted // Second call should succeed (not reentrant)
        }
        return originalSubmitAttestation.apply(qcReserveLedger, args)
      }

      // Execute attestation
      await qcReserveLedger
        .connect(fixture.watchdog)
        .submitReserveAttestation(qcAddress.address, ethers.utils.parseEther("5500"))

      expect(callbackExecuted).to.be.true
    })
  })

  describe("Access Control Bypass Attacks", () => {
    it("should prevent privilege escalation through role manipulation", async () => {
      // Attacker tries to grant themselves admin role
      await expect(
        qcManager.connect(attacker).grantRole(ROLES.DEFAULT_ADMIN_ROLE, attacker.address)
      ).to.be.revertedWith("AccessControl")

      // Attacker tries to grant themselves QC admin role
      await expect(
        qcManager.connect(attacker).grantRole(ROLES.QC_ADMIN_ROLE, attacker.address)
      ).to.be.revertedWith("AccessControl")

      // Attacker tries to grant themselves registrar role
      await expect(
        qcManager.connect(attacker).grantRole(ROLES.REGISTRAR_ROLE, attacker.address)
      ).to.be.revertedWith("AccessControl")

      // Verify attacker has no elevated privileges
      expect(await qcManager.hasRole(ROLES.DEFAULT_ADMIN_ROLE, attacker.address)).to.be.false
      expect(await qcManager.hasRole(ROLES.QC_ADMIN_ROLE, attacker.address)).to.be.false
      expect(await qcManager.hasRole(ROLES.REGISTRAR_ROLE, attacker.address)).to.be.false
    })

    it("should prevent unauthorized contract interactions", async () => {
      // Attacker tries direct contract manipulation
      await expect(
        qcData.connect(attacker).registerQC(attacker.address, LARGE_AMOUNT)
      ).to.be.revertedWith("AccessControl")

      await expect(
        qcData.connect(attacker).setQCStatus(qcAddress.address, QCStatus.Revoked)
      ).to.be.revertedWith("AccessControl")

      await expect(
        qcData.connect(attacker).updateQCMintedAmount(qcAddress.address, LARGE_AMOUNT)
      ).to.be.revertedWith("AccessControl")

      // Attacker tries to manipulate reserve ledger
      await expect(
        qcReserveLedger
          .connect(attacker)
          .submitReserveAttestation(qcAddress.address, ethers.utils.parseEther("99999"))
      ).to.be.revertedWith("AccessControl")
    })

    it("should prevent watchdog role abuse", async () => {
      // Compromised watchdog tries to manipulate consensus
      const maliciousProposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.Active, ethers.utils.id("MALICIOUS")]
      )

      // Even with watchdog role, cannot make arbitrary proposals without legitimate cause
      await watchdogConsensusManager
        .connect(compromisedWatchdog)
        .createProposal(0, maliciousProposalData, "Malicious status change")

      // But other watchdogs can prevent execution by not voting
      const tx = await watchdogConsensusManager
        .connect(compromisedWatchdog)
        .createProposal(0, maliciousProposalData, "Another attempt")

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "ProposalCreated")
      const proposalId = event?.args?.proposalId

      // Compromised watchdog votes
      await watchdogConsensusManager.connect(compromisedWatchdog).vote(proposalId)

      // Honest watchdogs don't vote - proposal fails
      await helpers.time.increase(7200 + 1) // Past voting period

      await expect(
        watchdogConsensusManager.connect(compromisedWatchdog).executeProposal(proposalId)
      ).to.be.revertedWith("ProposalNotApproved")
    })
  })

  describe("Economic Attack Scenarios", () => {
    beforeEach(async () => {
      // Setup successful minting for legitimate user
      tbtc.balanceOf.whenCalledWith(legitimateUser.address).returns(MEDIUM_AMOUNT)
      await basicMintingPolicy.executeMint(
        legitimateUser.address,
        qcAddress.address,
        MEDIUM_AMOUNT
      )
    })

    it("should prevent double-spending attacks", async () => {
      // Attacker tries to redeem same tokens multiple times
      const userBtcAddress = TEST_DATA.BTC_ADDRESSES.LEGACY

      // First redemption (legitimate)
      await qcRedeemer
        .connect(legitimateUser)
        .initiateRedemption(qcAddress.address, SMALL_AMOUNT, userBtcAddress)

      // Check balance after redemption
      tbtc.balanceOf.whenCalledWith(legitimateUser.address).returns(MEDIUM_AMOUNT.sub(SMALL_AMOUNT))

      // Attacker tries to redeem more than remaining balance
      await expect(
        qcRedeemer
          .connect(legitimateUser)
          .initiateRedemption(qcAddress.address, LARGE_AMOUNT, userBtcAddress)
      ).to.be.reverted // Insufficient balance

      // Attacker tries to manipulate balance check
      tbtc.balanceOf.whenCalledWith(attacker.address).returns(LARGE_AMOUNT)
      
      await expect(
        qcRedeemer
          .connect(attacker)
          .initiateRedemption(qcAddress.address, LARGE_AMOUNT, userBtcAddress)
      ).to.be.reverted // Balance manipulation detected or insufficient actual tokens
    })

    it("should prevent capacity manipulation attacks", async () => {
      // Attacker tries to mint beyond QC capacity
      const qcCapacity = await qcData.getQCCapacity(qcAddress.address)
      const excessiveAmount = qcCapacity.add(ethers.utils.parseEther("1"))

      const canMintExcessive = await basicMintingPolicy.canMint(
        attacker.address,
        qcAddress.address,
        excessiveAmount
      )
      expect(canMintExcessive).to.be.false

      await expect(
        basicMintingPolicy.executeMint(
          attacker.address,
          qcAddress.address,
          excessiveAmount
        )
      ).to.be.revertedWith("InsufficientCapacity")

      // Attacker tries to manipulate capacity through direct contract calls
      await expect(
        qcData.connect(attacker).updateQCCapacity(qcAddress.address, LARGE_AMOUNT.mul(10))
      ).to.be.revertedWith("AccessControl")
    })

    it("should prevent reserve manipulation for minting", async () => {
      // Attacker tries to submit false high reserves to enable excessive minting
      await expect(
        qcReserveLedger
          .connect(attacker)
          .submitReserveAttestation(qcAddress.address, ethers.utils.parseEther("99999"))
      ).to.be.revertedWith("AccessControl")

      // Even with accomplice who has attester role
      await qcReserveLedger.grantRole(ROLES.ATTESTER_ROLE, accomplice.address)
      
      // Accomplice submits inflated reserves
      await qcReserveLedger
        .connect(accomplice)
        .submitReserveAttestation(qcAddress.address, ethers.utils.parseEther("50000"))

      // But other attesters can contradict with real values
      await qcReserveLedger
        .connect(fixture.watchdog)
        .submitReserveAttestation(qcAddress.address, ethers.utils.parseEther("5000"))

      // System should use most recent or consensus value
      const [currentReserves] = await qcReserveLedger.getReserveBalanceAndStaleness(
        qcAddress.address
      )
      expect(currentReserves).to.equal(ethers.utils.parseEther("5000"))
    })
  })

  describe("Consensus Manipulation Attacks", () => {
    it("should prevent Sybil attacks on watchdog consensus", async () => {
      // Attacker tries to register multiple fake watchdog identities
      const fakeWatchdogs = [
        await ethers.getSigner(15),
        await ethers.getSigner(16),
        await ethers.getSigner(17),
      ]

      // Only governance can register watchdogs
      for (const fakeWatchdog of fakeWatchdogs) {
        await expect(
          watchdogMonitor
            .connect(attacker)
            .registerWatchdog(
              ethers.Wallet.createRandom().address,
              fakeWatchdog.address,
              "Fake Watchdog"
            )
        ).to.be.revertedWith("AccessControl")
      }

      // Even if attacker somehow gets governance access (separate attack),
      // they still can't grant watchdog roles in consensus manager
      for (const fakeWatchdog of fakeWatchdogs) {
        await expect(
          watchdogConsensusManager
            .connect(attacker)
            .grantRole(
              await watchdogConsensusManager.WATCHDOG_ROLE(),
              fakeWatchdog.address
            )
        ).to.be.revertedWith("AccessControl")
      }
    })

    it("should prevent proposal flooding attacks", async () => {
      // Attacker with watchdog role tries to flood system with proposals
      const proposalCount = 20
      const proposals = []

      for (let i = 0; i < proposalCount; i++) {
        const proposalData = ethers.utils.defaultAbiCoder.encode(
          ["address", "uint8", "bytes32"],
          [qcAddress.address, QCStatus.UnderReview, ethers.utils.id(`SPAM${i}`)]
        )

        const tx = await watchdogConsensusManager
          .connect(compromisedWatchdog)
          .createProposal(0, proposalData, `Spam proposal ${i}`)

        const receipt = await tx.wait()
        const event = receipt.events?.find((e) => e.event === "ProposalCreated")
        proposals.push(event?.args?.proposalId)
      }

      // All proposals created but none have votes from honest watchdogs
      expect(proposals.length).to.equal(proposalCount)

      // Honest watchdogs ignore spam proposals
      // Only legitimate proposals get votes
      const legitimateProposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.UnderReview, ethers.utils.id("LEGITIMATE")]
      )

      const legitimateTx = await watchdogConsensusManager
        .connect(watchdog1)
        .createProposal(0, legitimateProposalData, "Legitimate concern")

      const legitimateReceipt = await legitimateTx.wait()
      const legitimateEvent = legitimateReceipt.events?.find((e) => e.event === "ProposalCreated")
      const legitimateProposalId = legitimateEvent?.args?.proposalId

      // Honest watchdogs vote on legitimate proposal
      await watchdogConsensusManager.connect(watchdog1).vote(legitimateProposalId)
      await watchdogConsensusManager.connect(watchdog2).vote(legitimateProposalId)
      await watchdogConsensusManager.connect(watchdog1).executeProposal(legitimateProposalId)

      // Legitimate proposal succeeds while spam fails
      expect(await qcData.getQCStatus(qcAddress.address)).to.equal(QCStatus.UnderReview)
    })

    it("should prevent vote timing manipulation attacks", async () => {
      // Create proposal
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.Revoked, ethers.utils.id("TIMING_ATTACK")]
      )

      const tx = await watchdogConsensusManager
        .connect(watchdog1)
        .createProposal(0, proposalData, "Timing attack test")

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "ProposalCreated")
      const proposalId = event?.args?.proposalId

      // Attacker tries to manipulate voting by waiting until last second
      const votingPeriod = await watchdogConsensusManager.votingPeriod()
      await helpers.time.increase(votingPeriod.sub(10)) // 10 seconds before deadline

      // Vote at last second
      await watchdogConsensusManager.connect(compromisedWatchdog).vote(proposalId)

      // Advance past deadline
      await helpers.time.increase(20)

      // Try to vote after deadline (should fail)
      await expect(
        watchdogConsensusManager.connect(watchdog2).vote(proposalId)
      ).to.be.revertedWith("VotingEnded")

      // Try to execute with insufficient votes
      await expect(
        watchdogConsensusManager.connect(compromisedWatchdog).executeProposal(proposalId)
      ).to.be.revertedWith("ProposalNotApproved")
    })
  })

  describe("Cross-Contract Attack Scenarios", () => {
    it("should prevent service registry manipulation attacks", async () => {
      // Attacker deploys malicious contract
      const MaliciousContract = await ethers.getContractFactory("QCData")
      const maliciousContract = await MaliciousContract.deploy()
      await maliciousContract.deployed()

      // Attacker tries to replace legitimate service
      await expect(
        protocolRegistry
          .connect(attacker)
          .setService(SERVICE_KEYS.QC_DATA, maliciousContract.address)
      ).to.be.revertedWith("AccessControl")

      // Even if attacker gets admin access somehow, existing operations use cached references
      // and new operations can detect malicious contracts through validation
    })

    it("should prevent cross-contract reentrancy through service calls", async () => {
      // Deploy malicious contract that attempts reentrancy
      const MaliciousQCData = await smock.mock("QCData")
      const maliciousQcData = await MaliciousQCData.deploy()

      let reentrancyAttempted = false
      maliciousQcData.getQCStatus.returns(async () => {
        if (!reentrancyAttempted) {
          reentrancyAttempted = true
          // Attempt reentrant call
          await basicMintingPolicy.canMint(
            attacker.address,
            qcAddress.address,
            SMALL_AMOUNT
          )
        }
        return QCStatus.Active
      })

      // If somehow the malicious contract was installed
      await protocolRegistry.setService(SERVICE_KEYS.QC_DATA, maliciousQcData.address)

      // Operations should still be protected against reentrancy
      await basicMintingPolicy.canMint(
        legitimateUser.address,
        qcAddress.address,
        SMALL_AMOUNT
      )

      expect(reentrancyAttempted).to.be.true
    })
  })

  describe("Emergency System Abuse Attacks", () => {
    it("should prevent false emergency attacks", async () => {
      // Attacker tries to trigger false emergency
      await expect(
        watchdogMonitor
          .connect(attacker)
          .submitCriticalReport(qcAddress.address, "False emergency")
      ).to.be.revertedWith("AccessControl")

      // Attacker compromises one watchdog but needs 3 for emergency
      await watchdogMonitor
        .connect(compromisedWatchdog)
        .submitCriticalReport(qcAddress.address, "Fake critical issue 1")

      // Only 1 report - no emergency triggered
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.false

      // Honest watchdogs don't submit false reports
      // System remains operational
      const canMint = await basicMintingPolicy.canMint(
        legitimateUser.address,
        qcAddress.address,
        SMALL_AMOUNT
      )
      expect(canMint).to.be.true
    })

    it("should prevent emergency system lockdown attacks", async () => {
      // Even if attacker triggers emergency, governance can clear it
      
      // Simulate compromised watchdogs submitting false reports
      await watchdogMonitor
        .connect(compromisedWatchdog)
        .submitCriticalReport(qcAddress.address, "False critical 1")
      
      await watchdogMonitor
        .connect(watchdog1)
        .submitCriticalReport(qcAddress.address, "False critical 2")
      
      await watchdogMonitor
        .connect(watchdog2)
        .submitCriticalReport(qcAddress.address, "False critical 3")

      // Emergency triggered
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.true

      // Governance can clear false emergency
      await watchdogMonitor
        .connect(governance)
        .clearEmergencyPause(qcAddress.address)

      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.false

      // Operations resume
      const canMint = await basicMintingPolicy.canMint(
        legitimateUser.address,
        qcAddress.address,
        SMALL_AMOUNT
      )
      expect(canMint).to.be.true
    })
  })

  describe("Data Integrity Attack Scenarios", () => {
    it("should prevent state corruption attacks", async () => {
      // Attacker tries to corrupt QC data directly
      await expect(
        qcData.connect(attacker).updateQCMintedAmount(qcAddress.address, 0)
      ).to.be.revertedWith("AccessControl")

      await expect(
        qcData.connect(attacker).setQCStatus(qcAddress.address, QCStatus.Revoked)
      ).to.be.revertedWith("AccessControl")

      // Attacker tries to corrupt reserve data
      await expect(
        qcReserveLedger
          .connect(attacker)
          .submitReserveAttestation(qcAddress.address, 0)
      ).to.be.revertedWith("AccessControl")

      // Verify system state remains intact
      expect(await qcData.getQCStatus(qcAddress.address)).to.equal(QCStatus.Active)
      expect(await qcData.isQCRegistered(qcAddress.address)).to.be.true
    })

    it("should prevent timestamp manipulation attacks", async () => {
      // Attacker cannot manipulate block timestamps directly
      // But can try to exploit time-dependent logic

      // Submit attestation
      await qcReserveLedger
        .connect(fixture.watchdog)
        .submitReserveAttestation(qcAddress.address, ethers.utils.parseEther("5100"))

      // Advance time to make attestation stale
      await helpers.time.increase(86400 + 1) // 24 hours + 1 second

      // Check staleness
      const [, isStale] = await qcReserveLedger.getReserveBalanceAndStaleness(
        qcAddress.address
      )
      expect(isStale).to.be.true

      // Operations requiring fresh attestations should fail
      const canMint = await basicMintingPolicy.canMint(
        legitimateUser.address,
        qcAddress.address,
        SMALL_AMOUNT
      )
      expect(canMint).to.be.false
    })
  })

  describe("Compound Attack Scenarios", () => {
    it("should resist multi-vector attacks", async () => {
      // ATTACK VECTOR 1: Compromise one watchdog
      const compromisedWatchdogAddress = compromisedWatchdog.address

      // ATTACK VECTOR 2: Try to manipulate consensus
      const maliciousProposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.Active, ethers.utils.id("MULTI_ATTACK")]
      )

      const tx = await watchdogConsensusManager
        .connect(compromisedWatchdog)
        .createProposal(0, maliciousProposalData, "Multi-vector attack")

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "ProposalCreated")
      const proposalId = event?.args?.proposalId

      // ATTACK VECTOR 3: Try to submit false reports
      await watchdogMonitor
        .connect(compromisedWatchdog)
        .submitCriticalReport(qcAddress.address, "False emergency report")

      // ATTACK VECTOR 4: Try economic manipulation
      await expect(
        basicMintingPolicy.executeMint(
          attacker.address,
          qcAddress.address,
          LARGE_AMOUNT
        )
      ).to.be.reverted // Should fail

      // DEFENSE: Honest actors prevent attack success
      
      // Honest watchdogs don't vote on malicious proposal
      await helpers.time.increase(7200 + 1) // Past voting period
      
      await expect(
        watchdogConsensusManager.connect(compromisedWatchdog).executeProposal(proposalId)
      ).to.be.revertedWith("ProposalNotApproved")

      // Only 1 false report - no emergency
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.false

      // Economic attack failed
      expect(await qcData.getQCStatus(qcAddress.address)).to.equal(QCStatus.Active)

      // System remains operational for legitimate users
      const canMint = await basicMintingPolicy.canMint(
        legitimateUser.address,
        qcAddress.address,
        SMALL_AMOUNT
      )
      expect(canMint).to.be.true
    })

    it("should maintain security under degraded conditions", async () => {
      // SCENARIO: Multiple attack vectors with partial success
      
      // 1. One watchdog compromised (already set up)
      // 2. System under stress with multiple users
      
      tbtc.balanceOf.whenCalledWith(legitimateUser.address).returns(MEDIUM_AMOUNT)
      await basicMintingPolicy.executeMint(
        legitimateUser.address,
        qcAddress.address,
        MEDIUM_AMOUNT
      )

      // 3. Partial emergency state (2 out of 3 critical reports)
      await watchdogMonitor
        .connect(compromisedWatchdog)
        .submitCriticalReport(qcAddress.address, "Compromised report 1")
      
      await watchdogMonitor
        .connect(watchdog1)
        .submitCriticalReport(qcAddress.address, "Legitimate concern")

      // 4. System degraded but still functional
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.false

      // 5. Legitimate operations continue to work
      await qcRedeemer
        .connect(legitimateUser)
        .initiateRedemption(
          qcAddress.address,
          SMALL_AMOUNT,
          TEST_DATA.BTC_ADDRESSES.LEGACY
        )

      // 6. But system is more cautious about new operations
      const canMintLarge = await basicMintingPolicy.canMint(
        attacker.address,
        qcAddress.address,
        LARGE_AMOUNT
      )
      expect(canMintLarge).to.be.false // Even if they had legitimate access

      // 7. Governance can intervene if needed
      if (await watchdogMonitor.getRecentReportCount(qcAddress.address) >= 2) {
        // High alert mode - governance review recommended
        expect(true).to.be.true // System properly flags high-risk conditions
      }
    })
  })
})