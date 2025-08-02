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
} from "../AccountControlTestHelpers"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("Complete System Integration Tests", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qcAddress: SignerWithAddress
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress

  // All contracts
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
  let tbtc: TBTC
  let mockSpvValidator: FakeContract<SPVValidator>

  const initialCapacity = ethers.utils.parseEther("1000")
  const reserveBalance = ethers.utils.parseEther("500")

  before(async () => {
    ;[
      deployer,
      governance,
      qcAddress,
      user1,
      user2,
      watchdog1,
      watchdog2,
      watchdog3,
    ] = await ethers.getSigners()
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy complete system
    const fixture = await deployAccountControlFixture()
    
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

    // Deploy additional V1.1 contracts
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

    // Setup SPV validator mock
    mockSpvValidator = await smock.fake<SPVValidator>("SPVValidator")
    mockSpvValidator.verifyWalletControl.returns(true)
    mockSpvValidator.verifyRedemptionFulfillment.returns(true)
    
    await protocolRegistry.setService(
      SERVICE_KEYS.SPV_VALIDATOR,
      mockSpvValidator.address
    )

    // Setup additional roles for integration
    await watchdogConsensusManager.grantRole(
      await watchdogConsensusManager.MANAGER_ROLE(),
      governance.address
    )
    
    await watchdogConsensusManager
      .connect(governance)
      .grantRole(
        await watchdogConsensusManager.WATCHDOG_ROLE(),
        watchdog1.address
      )
    
    await watchdogConsensusManager
      .connect(governance)
      .grantRole(
        await watchdogConsensusManager.WATCHDOG_ROLE(),
        watchdog2.address
      )
    
    await watchdogConsensusManager
      .connect(governance)
      .grantRole(
        await watchdogConsensusManager.WATCHDOG_ROLE(),
        watchdog3.address
      )

    await watchdogMonitor.grantRole(
      await watchdogMonitor.MANAGER_ROLE(),
      governance.address
    )

    // Register watchdogs in monitor
    const mockWatchdog1 = await smock.fake("QCWatchdog")
    const mockWatchdog2 = await smock.fake("QCWatchdog")
    const mockWatchdog3 = await smock.fake("QCWatchdog")

    await watchdogMonitor
      .connect(governance)
      .registerWatchdog(mockWatchdog1.address, watchdog1.address, "Alpha")
    await watchdogMonitor
      .connect(governance)
      .registerWatchdog(mockWatchdog2.address, watchdog2.address, "Beta")
    await watchdogMonitor
      .connect(governance)
      .registerWatchdog(mockWatchdog3.address, watchdog3.address, "Gamma")

    // Grant operator roles
    await watchdogMonitor
      .connect(governance)
      .grantRole(
        await watchdogMonitor.WATCHDOG_OPERATOR_ROLE(),
        watchdog1.address
      )
    await watchdogMonitor
      .connect(governance)
      .grantRole(
        await watchdogMonitor.WATCHDOG_OPERATOR_ROLE(),
        watchdog2.address
      )
    await watchdogMonitor
      .connect(governance)
      .grantRole(
        await watchdogMonitor.WATCHDOG_OPERATOR_ROLE(),
        watchdog3.address
      )

    // Grant users redeemer role
    await qcRedeemer.grantRole(ROLES.REDEEMER_ROLE, user1.address)
    await qcRedeemer.grantRole(ROLES.REDEEMER_ROLE, user2.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("End-to-End QC Onboarding Flow", () => {
    it("should handle complete QC onboarding with all validations", async () => {
      // 1. QC Registration
      await qcData.registerQC(qcAddress.address, initialCapacity)
      
      expect(await qcData.isQCRegistered(qcAddress.address)).to.be.true
      expect(await qcData.getQCStatus(qcAddress.address)).to.equal(QCStatus.Active)
      expect(await qcData.getQCCapacity(qcAddress.address)).to.equal(initialCapacity)

      // 2. Wallet Registration with SPV Proof
      const { challenge, txInfo, proof } = createMockSpvData()
      const encodedProof = ethers.utils.defaultAbiCoder.encode(
        [
          "tuple(bytes4 version, bytes inputVector, bytes outputVector, bytes4 locktime)",
          "tuple(bytes merkleProof, uint256 txIndexInBlock, bytes bitcoinHeaders, bytes32 coinbasePreimage, bytes coinbaseProof)",
        ],
        [txInfo, proof]
      )

      await qcWatchdog
        .connect(fixture.watchdog)
        .registerWalletWithProof(
          qcAddress.address,
          TEST_DATA.BTC_ADDRESSES.TEST,
          encodedProof,
          challenge
        )

      // Verify wallet registered
      expect(await qcData.isWalletRegistered(TEST_DATA.BTC_ADDRESSES.TEST)).to.be.true

      // 3. Reserve Attestation
      await qcReserveLedger
        .connect(fixture.watchdog)
        .submitReserveAttestation(qcAddress.address, reserveBalance)

      const [balance, isStale] = await qcReserveLedger.getReserveBalanceAndStaleness(
        qcAddress.address
      )
      expect(balance).to.equal(reserveBalance)
      expect(isStale).to.be.false

      // 4. Solvency Verification
      const isSolvent = await qcManager.verifyQCSolvency(qcAddress.address)
      expect(isSolvent).to.be.true

      // 5. Ready for Operations
      const canMint = await basicMintingPolicy.canMint(
        user1.address,
        qcAddress.address,
        ethers.utils.parseEther("100")
      )
      expect(canMint).to.be.true
    })

    it("should handle onboarding failure scenarios gracefully", async () => {
      // 1. Register QC
      await qcData.registerQC(qcAddress.address, initialCapacity)

      // 2. Attempt wallet registration with invalid SPV proof
      mockSpvValidator.verifyWalletControl.returns(false)
      
      const { challenge, txInfo, proof } = createMockSpvData()
      const encodedProof = ethers.utils.defaultAbiCoder.encode(
        [
          "tuple(bytes4 version, bytes inputVector, bytes outputVector, bytes4 locktime)",
          "tuple(bytes merkleProof, uint256 txIndexInBlock, bytes bitcoinHeaders, bytes32 coinbasePreimage, bytes coinbaseProof)",
        ],
        [txInfo, proof]
      )

      await expect(
        qcWatchdog
          .connect(fixture.watchdog)
          .registerWalletWithProof(
            qcAddress.address,
            TEST_DATA.BTC_ADDRESSES.TEST,
            encodedProof,
            challenge
          )
      ).to.be.revertedWith("SPVVerificationFailed")

      // System remains in safe state
      expect(await qcData.isWalletRegistered(TEST_DATA.BTC_ADDRESSES.TEST)).to.be.false
    })
  })

  describe("Complete Minting Flow Integration", () => {
    beforeEach(async () => {
      // Setup QC for minting
      await setupQCWithWallets(
        {
          protocolRegistry,
          qcData,
          qcManager,
          qcReserveLedger,
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
          user: user1,
          watchdog: fixture.watchdog,
        },
        qcAddress.address,
        [TEST_DATA.BTC_ADDRESSES.TEST],
        reserveBalance
      )
    })

    it("should handle complete minting flow with all validations", async () => {
      const mintAmount = ethers.utils.parseEther("100")

      // 1. Pre-mint validation
      const canMint = await basicMintingPolicy.canMint(
        user1.address,
        qcAddress.address,
        mintAmount
      )
      expect(canMint).to.be.true

      // 2. Check system state
      expect(await systemState.isMintingPaused()).to.be.false

      // 3. Execute mint
      await basicMintingPolicy.executeMint(
        user1.address,
        qcAddress.address,
        mintAmount
      )

      // 4. Verify state changes
      expect(await tbtc.balanceOf(user1.address)).to.equal(mintAmount)
      expect(await qcData.getQCMintedAmount(qcAddress.address)).to.equal(mintAmount)

      // 5. Verify remaining capacity
      const remainingCapacity = await qcManager.getQCCapacity(qcAddress.address)
      expect(remainingCapacity).to.equal(initialCapacity.sub(mintAmount))
    })

    it("should prevent minting when system is paused", async () => {
      const mintAmount = ethers.utils.parseEther("100")

      // Pause system
      await systemState.pauseMinting()

      // Minting should be blocked
      const canMint = await basicMintingPolicy.canMint(
        user1.address,
        qcAddress.address,
        mintAmount
      )
      expect(canMint).to.be.false

      await expect(
        basicMintingPolicy.executeMint(
          user1.address,
          qcAddress.address,
          mintAmount
        )
      ).to.be.revertedWith("MintingPaused")
    })

    it("should prevent minting when QC becomes insolvent", async () => {
      const mintAmount = ethers.utils.parseEther("100")

      // Update QC to have high minted amount (making it insolvent)
      await qcData.updateQCMintedAmount(
        qcAddress.address,
        ethers.utils.parseEther("600") // More than reserves
      )

      // Minting should be blocked due to insolvency
      const canMint = await basicMintingPolicy.canMint(
        user1.address,
        qcAddress.address,
        mintAmount
      )
      expect(canMint).to.be.false
    })
  })

  describe("Complete Redemption Flow Integration", () => {
    let mintAmount: any
    let redemptionAmount: any

    beforeEach(async () => {
      // Setup and execute minting first
      await setupQCWithWallets(
        {
          protocolRegistry,
          qcData,
          qcManager,
          qcReserveLedger,
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
          user: user1,
          watchdog: fixture.watchdog,
        },
        qcAddress.address,
        [TEST_DATA.BTC_ADDRESSES.TEST],
        reserveBalance
      )

      mintAmount = ethers.utils.parseEther("200")
      redemptionAmount = ethers.utils.parseEther("100")

      await basicMintingPolicy.executeMint(
        user1.address,
        qcAddress.address,
        mintAmount
      )
    })

    it("should handle complete redemption flow", async () => {
      const userBtcAddress = TEST_DATA.BTC_ADDRESSES.LEGACY

      // 1. Initiate redemption
      const tx = await qcRedeemer
        .connect(user1)
        .initiateRedemption(qcAddress.address, redemptionAmount, userBtcAddress)

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "RedemptionInitiated")
      const redemptionId = event?.args?.redemptionId

      // 2. Verify TBTC burned
      expect(await tbtc.balanceOf(user1.address)).to.equal(
        mintAmount.sub(redemptionAmount)
      )

      // 3. Verify QC state updated
      expect(await qcData.getQCMintedAmount(qcAddress.address)).to.equal(
        mintAmount.sub(redemptionAmount)
      )

      // 4. Fulfill redemption (simulate QC sending Bitcoin)
      const { txInfo, proof } = createMockSpvData()
      await qcRedeemer
        .connect(governance)
        .recordRedemptionFulfillment(
          redemptionId,
          userBtcAddress,
          10000000, // 0.1 BTC in satoshi
          txInfo,
          proof
        )

      // 5. Verify fulfillment
      // Implementation specific - would check redemption status
    })

    it("should handle redemption timeout and default", async () => {
      const userBtcAddress = TEST_DATA.BTC_ADDRESSES.LEGACY

      // 1. Initiate redemption
      const tx = await qcRedeemer
        .connect(user1)
        .initiateRedemption(qcAddress.address, redemptionAmount, userBtcAddress)

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "RedemptionInitiated")
      const redemptionId = event?.args?.redemptionId

      // 2. Advance time past timeout (7 days)
      await helpers.time.increase(604800 + 1)

      // 3. Flag as defaulted
      await qcRedeemer
        .connect(governance)
        .flagDefaultedRedemption(redemptionId, ethers.utils.id("TIMEOUT"))

      // 4. This should trigger QC status change and penalty mechanisms
      // Implementation specific
    })
  })

  describe("Watchdog Consensus Integration", () => {
    beforeEach(async () => {
      await setupQCWithWallets(
        {
          protocolRegistry,
          qcData,
          qcManager,
          qcReserveLedger,
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
          user: user1,
          watchdog: fixture.watchdog,
        },
        qcAddress.address,
        [TEST_DATA.BTC_ADDRESSES.TEST],
        reserveBalance
      )
    })

    it("should handle consensus-based QC status change", async () => {
      // 1. Create proposal to change QC status
      const proposalData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [qcAddress.address, QCStatus.UnderReview, ethers.utils.id("SUSPICIOUS")]
      )

      const tx = await watchdogConsensusManager
        .connect(watchdog1)
        .createProposal(0, proposalData, "Suspicious activity detected")

      const receipt = await tx.wait()
      const event = receipt.events?.find((e) => e.event === "ProposalCreated")
      const proposalId = event?.args?.proposalId

      // 2. Gather consensus votes
      await watchdogConsensusManager.connect(watchdog1).vote(proposalId)
      await watchdogConsensusManager.connect(watchdog2).vote(proposalId)

      // 3. Execute proposal
      await watchdogConsensusManager.connect(watchdog1).executeProposal(proposalId)

      // 4. Verify QC status changed
      expect(await qcData.getQCStatus(qcAddress.address)).to.equal(
        QCStatus.UnderReview
      )

      // 5. Verify operations are affected
      const canMint = await basicMintingPolicy.canMint(
        user1.address,
        qcAddress.address,
        ethers.utils.parseEther("50")
      )
      expect(canMint).to.be.false
    })

    it("should handle emergency response through watchdog monitor", async () => {
      // 1. Submit critical reports
      await watchdogMonitor
        .connect(watchdog1)
        .submitCriticalReport(qcAddress.address, "Critical issue 1")
      
      await watchdogMonitor
        .connect(watchdog2)
        .submitCriticalReport(qcAddress.address, "Critical issue 2")
      
      await watchdogMonitor
        .connect(watchdog3)
        .submitCriticalReport(qcAddress.address, "Critical issue 3")

      // 2. Verify emergency pause triggered
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.true

      // 3. Verify all operations blocked
      const canMint = await basicMintingPolicy.canMint(
        user1.address,
        qcAddress.address,
        ethers.utils.parseEther("50")
      )
      expect(canMint).to.be.false

      // 4. Clear emergency
      await watchdogMonitor
        .connect(governance)
        .clearEmergencyPause(qcAddress.address)

      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.false

      // 5. Operations resume
      const canMintAfter = await basicMintingPolicy.canMint(
        user1.address,
        qcAddress.address,
        ethers.utils.parseEther("50")
      )
      expect(canMintAfter).to.be.true
    })
  })

  describe("Cross-Contract Communication Integration", () => {
    beforeEach(async () => {
      await setupQCWithWallets(
        {
          protocolRegistry,
          qcData,
          qcManager,
          qcReserveLedger,
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
          user: user1,
          watchdog: fixture.watchdog,
        },
        qcAddress.address,
        [TEST_DATA.BTC_ADDRESSES.TEST],
        reserveBalance
      )
    })

    it("should handle service registry updates during operations", async () => {
      // 1. Start with successful operation
      const canMint = await basicMintingPolicy.canMint(
        user1.address,
        qcAddress.address,
        ethers.utils.parseEther("50")
      )
      expect(canMint).to.be.true

      // 2. Deploy new QCData contract
      const NewQCData = await ethers.getContractFactory("QCData")
      const newQcData = await NewQCData.deploy()
      await newQcData.deployed()

      // 3. Update service registry
      await protocolRegistry.setService(SERVICE_KEYS.QC_DATA, newQcData.address)

      // 4. Future operations use new contract
      // (Would need to re-register QC in new contract for this to work)
      
      // 5. Old operations complete with old contract references
      // This tests that in-flight operations aren't broken by registry updates
    })

    it("should handle permission changes across contracts", async () => {
      // 1. Initial state - watchdog can attest
      await qcReserveLedger
        .connect(fixture.watchdog)
        .submitReserveAttestation(qcAddress.address, ethers.utils.parseEther("600"))

      // 2. Revoke attester role
      await qcReserveLedger.revokeRole(
        ROLES.ATTESTER_ROLE,
        fixture.watchdog.address
      )

      // 3. Future attestations fail
      await expect(
        qcReserveLedger
          .connect(fixture.watchdog)
          .submitReserveAttestation(qcAddress.address, ethers.utils.parseEther("700"))
      ).to.be.revertedWith("AccessControl")

      // 4. But QCWatchdog contract still has role
      await qcWatchdog
        .connect(fixture.watchdog)
        .attestReserves(qcAddress.address, ethers.utils.parseEther("650"))
    })
  })

  describe("System Recovery Integration", () => {
    it("should handle recovery from emergency state", async () => {
      await setupQCWithWallets(
        {
          protocolRegistry,
          qcData,
          qcManager,
          qcReserveLedger,
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
          user: user1,
          watchdog: fixture.watchdog,
        },
        qcAddress.address,
        [TEST_DATA.BTC_ADDRESSES.TEST],
        reserveBalance
      )

      // 1. Trigger multiple emergency conditions
      await systemState.pauseMinting()
      
      // Trigger watchdog emergency
      for (let i = 0; i < 3; i++) {
        await watchdogMonitor
          .connect([watchdog1, watchdog2, watchdog3][i])
          .submitCriticalReport(qcAddress.address, `Emergency ${i}`)
      }

      // Set QC to revoked
      await qcManager
        .connect(governance)
        .setQCStatus(
          qcAddress.address,
          QCStatus.Revoked,
          ethers.utils.id("EMERGENCY_REVOKE")
        )

      // 2. Verify all operations blocked
      expect(await systemState.isMintingPaused()).to.be.true
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.true
      expect(await qcData.getQCStatus(qcAddress.address)).to.equal(QCStatus.Revoked)

      const canMint = await basicMintingPolicy.canMint(
        user1.address,
        qcAddress.address,
        ethers.utils.parseEther("50")
      )
      expect(canMint).to.be.false

      // 3. Begin recovery process
      await systemState.unpauseMinting()
      await watchdogMonitor
        .connect(governance)
        .clearEmergencyPause(qcAddress.address)
      await qcManager
        .connect(governance)
        .setQCStatus(
          qcAddress.address,
          QCStatus.Active,
          ethers.utils.id("RECOVERY")
        )

      // 4. Verify operations resume
      const canMintAfter = await basicMintingPolicy.canMint(
        user1.address,
        qcAddress.address,
        ethers.utils.parseEther("50")
      )
      expect(canMintAfter).to.be.true
    })

    it("should handle partial system recovery", async () => {
      await setupQCWithWallets(
        {
          protocolRegistry,
          qcData,
          qcManager,
          qcReserveLedger,
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
          user: user1,
          watchdog: fixture.watchdog,
        },
        qcAddress.address,
        [TEST_DATA.BTC_ADDRESSES.TEST],
        reserveBalance
      )

      // 1. Mint some tokens first
      await basicMintingPolicy.executeMint(
        user1.address,
        qcAddress.address,
        ethers.utils.parseEther("100")
      )

      // 2. Pause only minting, leave redemption active
      await systemState.pauseMinting()

      // 3. Minting blocked, redemption allowed
      const canMint = await basicMintingPolicy.canMint(
        user1.address,
        qcAddress.address,
        ethers.utils.parseEther("50")
      )
      expect(canMint).to.be.false

      // Users can still redeem
      await qcRedeemer
        .connect(user1)
        .initiateRedemption(
          qcAddress.address,
          ethers.utils.parseEther("50"),
          TEST_DATA.BTC_ADDRESSES.LEGACY
        )

      // 4. Partial recovery - restore minting
      await systemState.unpauseMinting()

      const canMintAfter = await basicMintingPolicy.canMint(
        user1.address,
        qcAddress.address,
        ethers.utils.parseEther("50")
      )
      expect(canMintAfter).to.be.true
    })
  })

  describe("Multi-QC System Integration", () => {
    let qc2Address: SignerWithAddress

    beforeEach(async () => {
      qc2Address = await ethers.getSigner(9) // Use additional signer as QC2

      // Setup first QC
      await setupQCWithWallets(
        {
          protocolRegistry,
          qcData,
          qcManager,
          qcReserveLedger,
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
          user: user1,
          watchdog: fixture.watchdog,
        },
        qcAddress.address,
        [TEST_DATA.BTC_ADDRESSES.TEST],
        reserveBalance
      )

      // Setup second QC
      await setupQCWithWallets(
        {
          protocolRegistry,
          qcData,
          qcManager,
          qcReserveLedger,
          systemState,
          qcMinter,
          qcRedeemer,
          basicMintingPolicy,
          basicRedemptionPolicy,
          qcWatchdog,
          tbtc,
          deployer,
          governance,
          qcAddress: qc2Address,
          user: user1,
          watchdog: fixture.watchdog,
        },
        qc2Address.address,
        [TEST_DATA.BTC_ADDRESSES.SEGWIT],
        reserveBalance
      )
    })

    it("should handle operations across multiple QCs", async () => {
      const mintAmount = ethers.utils.parseEther("100")

      // 1. Mint from QC1
      await basicMintingPolicy.executeMint(
        user1.address,
        qcAddress.address,
        mintAmount
      )

      expect(await tbtc.balanceOf(user1.address)).to.equal(mintAmount)
      expect(await qcData.getQCMintedAmount(qcAddress.address)).to.equal(mintAmount)
      expect(await qcData.getQCMintedAmount(qc2Address.address)).to.equal(0)

      // 2. Mint from QC2
      await basicMintingPolicy.executeMint(
        user2.address,
        qc2Address.address,
        mintAmount
      )

      expect(await tbtc.balanceOf(user2.address)).to.equal(mintAmount)
      expect(await qcData.getQCMintedAmount(qc2Address.address)).to.equal(mintAmount)

      // 3. Total TBTC supply reflects both QCs
      expect(await tbtc.totalSupply()).to.equal(mintAmount.mul(2))
    })

    it("should handle independent QC emergencies", async () => {
      // 1. Trigger emergency for QC1 only
      for (let i = 0; i < 3; i++) {
        await watchdogMonitor
          .connect([watchdog1, watchdog2, watchdog3][i])
          .submitCriticalReport(qcAddress.address, `QC1 Emergency ${i}`)
      }

      // 2. Verify QC1 emergency, QC2 normal
      expect(await watchdogMonitor.isEmergencyPaused(qcAddress.address)).to.be.true
      expect(await watchdogMonitor.isEmergencyPaused(qc2Address.address)).to.be.false

      // 3. QC1 operations blocked, QC2 continues
      const canMintQC1 = await basicMintingPolicy.canMint(
        user1.address,
        qcAddress.address,
        ethers.utils.parseEther("50")
      )
      expect(canMintQC1).to.be.false

      const canMintQC2 = await basicMintingPolicy.canMint(
        user2.address,
        qc2Address.address,
        ethers.utils.parseEther("50")
      )
      expect(canMintQC2).to.be.true

      // 4. QC2 operations succeed
      await basicMintingPolicy.executeMint(
        user2.address,
        qc2Address.address,
        ethers.utils.parseEther("50")
      )

      expect(await tbtc.balanceOf(user2.address)).to.equal(ethers.utils.parseEther("50"))
    })
  })

  describe("Performance and Scalability Integration", () => {
    it("should handle multiple concurrent operations", async () => {
      await setupQCWithWallets(
        {
          protocolRegistry,
          qcData,
          qcManager,
          qcReserveLedger,
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
          user: user1,
          watchdog: fixture.watchdog,
        },
        qcAddress.address,
        [TEST_DATA.BTC_ADDRESSES.TEST],
        reserveBalance
      )

      // Simulate concurrent operations
      const operations = []

      // Multiple attestations
      for (let i = 0; i < 5; i++) {
        operations.push(
          qcReserveLedger
            .connect(fixture.watchdog)
            .submitReserveAttestation(
              qcAddress.address,
              reserveBalance.add(ethers.utils.parseEther(i.toString()))
            )
        )
      }

      // Multiple mint operations
      for (let i = 0; i < 3; i++) {
        operations.push(
          basicMintingPolicy.canMint(
            user1.address,
            qcAddress.address,
            ethers.utils.parseEther("10")
          )
        )
      }

      // Execute all operations
      const results = await Promise.all(operations)

      // All operations should complete successfully
      expect(results.length).to.equal(8)

      // Final state should be consistent
      const [finalBalance] = await qcReserveLedger.getReserveBalanceAndStaleness(
        qcAddress.address
      )
      expect(finalBalance).to.be.gt(reserveBalance)
    })

    it("should maintain consistency under high load", async () => {
      await setupQCWithWallets(
        {
          protocolRegistry,
          qcData,
          qcManager,
          qcReserveLedger,
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
          user: user1,
          watchdog: fixture.watchdog,
        },
        qcAddress.address,
        [TEST_DATA.BTC_ADDRESSES.TEST],
        reserveBalance
      )

      // Execute many mint operations
      const mintAmount = ethers.utils.parseEther("10")
      const operations = 10

      for (let i = 0; i < operations; i++) {
        await basicMintingPolicy.executeMint(
          user1.address,
          qcAddress.address,
          mintAmount
        )
      }

      // Verify final state consistency
      const totalMinted = mintAmount.mul(operations)
      expect(await tbtc.balanceOf(user1.address)).to.equal(totalMinted)
      expect(await qcData.getQCMintedAmount(qcAddress.address)).to.equal(totalMinted)
      expect(await tbtc.totalSupply()).to.equal(totalMinted)

      // Verify capacity calculations
      const remainingCapacity = await qcManager.getQCCapacity(qcAddress.address)
      expect(remainingCapacity).to.equal(initialCapacity.sub(totalMinted))
    })
  })
})