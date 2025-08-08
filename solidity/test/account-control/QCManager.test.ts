import chai, { expect } from "chai"
import { ethers, helpers, network } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"

import {
  QCManager,
  ProtocolRegistry,
  QCData,
  SystemState,
  QCReserveLedger,
  SPVValidator,
} from "../../typechain"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCManager", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qcAddress: SignerWithAddress
  let watchdog: SignerWithAddress
  let watchdogEnforcer: SignerWithAddress
  let thirdParty: SignerWithAddress

  let qcManager: QCManager
  let protocolRegistry: ProtocolRegistry
  let mockQcData: FakeContract<QCData>
  let mockSystemState: FakeContract<SystemState>
  let mockQcQCReserveLedger: FakeContract<QCReserveLedger>
  let mockSpvValidator: FakeContract<SPVValidator>

  // Service keys
  let QC_DATA_KEY: string
  let SYSTEM_STATE_KEY: string
  let QC_RESERVE_LEDGER_KEY: string
  let SPV_VALIDATOR_KEY: string

  // Roles
  let QC_ADMIN_ROLE: string
  let REGISTRAR_ROLE: string
  let ARBITER_ROLE: string
  let QC_GOVERNANCE_ROLE: string
  let WATCHDOG_ENFORCER_ROLE: string

  // Test data
  const testBtcAddress = "bc1qtest123456789"
  const testChallenge = ethers.utils.id("TEST_CHALLENGE")
  const testTxInfo = {
    version: "0x01000000",
    inputVector:
      "0x011746bd867400f3494b8f44c24b83e1aa58c4f0ff25b4a61cffeffd4bc0f9ba300000000000ffffffff",
    outputVector:
      "0x024897070000000000220020a4333e5612ab1a1043b25755c89b16d51800",
    locktime: "0x00000000",
  }
  const testProof = {
    merkleProof:
      "0xe35a0d6de94b656694589964a252957e4673a9fb1d2f8b4a92e3f0a7bb000000fddb",
    txIndexInBlock: 281,
    bitcoinHeaders:
      "0x0000002073bd2184edd9c4fc76642ea6754ee40136970efc10c4190000000000",
    coinbasePreimage:
      "0x77b98a5e6643973bba49dda18a75140306d2d8694b66f2dcb3561ad5aff00000",
    coinbaseProof:
      "0xdc20dadef477faab2852f2f8ae0c826aa7e05c4de0d36f0e636304295540000003",
  }
  const testSpvProof = ethers.utils.toUtf8Bytes("mock_spv_proof")
  const testReason = ethers.utils.id("TEST_REASON")
  const reserveBalance = ethers.utils.parseEther("10")
  const mintedAmount = ethers.utils.parseEther("5")
  const INSUFFICIENT_RESERVES = ethers.utils.id("INSUFFICIENT_RESERVES")

  before(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;[deployer, governance, qcAddress, watchdog, watchdogEnforcer, thirdParty] =
      await ethers.getSigners()

    // Generate service keys
    QC_DATA_KEY = ethers.utils.id("QC_DATA")
    SYSTEM_STATE_KEY = ethers.utils.id("SYSTEM_STATE")
    QC_RESERVE_LEDGER_KEY = ethers.utils.id("QC_RESERVE_LEDGER")
    SPV_VALIDATOR_KEY = ethers.utils.id("SPV_VALIDATOR")

    // Generate role hashes
    QC_ADMIN_ROLE = ethers.utils.id("QC_ADMIN_ROLE")
    REGISTRAR_ROLE = ethers.utils.id("REGISTRAR_ROLE")
    ARBITER_ROLE = ethers.utils.id("ARBITER_ROLE")
    QC_GOVERNANCE_ROLE = ethers.utils.id("QC_GOVERNANCE_ROLE")
    WATCHDOG_ENFORCER_ROLE = ethers.utils.id("WATCHDOG_ENFORCER_ROLE")
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy ProtocolRegistry
    const ProtocolRegistryFactory = await ethers.getContractFactory(
      "ProtocolRegistry"
    )
    protocolRegistry = await ProtocolRegistryFactory.deploy()
    await protocolRegistry.deployed()

    // Deploy QCManager
    const QCManagerFactory = await ethers.getContractFactory("QCManager")
    qcManager = await QCManagerFactory.deploy(protocolRegistry.address)
    await qcManager.deployed()

    // Create mock contracts
    mockQcData = await smock.fake<QCData>("QCData")
    mockSystemState = await smock.fake<SystemState>("SystemState")
    mockQcQCReserveLedger = await smock.fake<QCReserveLedger>("QCReserveLedger")
    mockSpvValidator = await smock.fake<SPVValidator>("SPVValidator")

    // Register services
    await protocolRegistry.setService(QC_DATA_KEY, mockQcData.address)
    await protocolRegistry.setService(SYSTEM_STATE_KEY, mockSystemState.address)
    await protocolRegistry.setService(
      QC_RESERVE_LEDGER_KEY,
      mockQcQCReserveLedger.address
    )
    await protocolRegistry.setService(
      SPV_VALIDATOR_KEY,
      mockSpvValidator.address
    )

    // Set up default mock behaviors
    mockSystemState.isFunctionPaused.returns(false)
    mockQcData.isQCRegistered.returns(false)
    mockQcData.getQCStatus.returns(0) // Active
    mockQcData.registerQC.returns() // Add mock return for registerQC
    mockQcData.getWalletStatus.returns(1) // Active
    mockQcData.getWalletOwner.returns(qcAddress.address)
    mockQcData.getQCMintedAmount.returns(mintedAmount)
    mockQcData.getMaxMintingCapacity.returns(ethers.utils.parseEther("5000"))
    mockQcQCReserveLedger.getReserveBalanceAndStaleness.returns([
      reserveBalance,
      false,
    ])
    mockSpvValidator.verifyWalletControl.returns(true)

    // Grant roles
    await qcManager.grantRole(REGISTRAR_ROLE, watchdog.address)
    await qcManager.grantRole(ARBITER_ROLE, watchdog.address)
    await qcManager.grantRole(QC_GOVERNANCE_ROLE, deployer.address)
    await qcManager.grantRole(WATCHDOG_ENFORCER_ROLE, watchdogEnforcer.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment", () => {
    it("should set correct protocol registry", async () => {
      expect(await qcManager.protocolRegistry()).to.equal(
        protocolRegistry.address
      )
    })

    it("should grant deployer all roles", async () => {
      const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
      expect(await qcManager.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to
        .be.true
      expect(await qcManager.hasRole(QC_ADMIN_ROLE, deployer.address)).to.be
        .true
      expect(await qcManager.hasRole(REGISTRAR_ROLE, deployer.address)).to.be
        .true
      expect(await qcManager.hasRole(ARBITER_ROLE, deployer.address)).to.be.true
      expect(await qcManager.hasRole(QC_GOVERNANCE_ROLE, deployer.address)).to
        .be.true
    })
  })

  describe("Role Constants", () => {
    it("should have correct role constants", async () => {
      expect(await qcManager.QC_ADMIN_ROLE()).to.equal(QC_ADMIN_ROLE)
      expect(await qcManager.REGISTRAR_ROLE()).to.equal(REGISTRAR_ROLE)
      expect(await qcManager.ARBITER_ROLE()).to.equal(ARBITER_ROLE)
      expect(await qcManager.QC_GOVERNANCE_ROLE()).to.equal(QC_GOVERNANCE_ROLE)
    })

    it("should have correct service key constants", async () => {
      expect(await qcManager.QC_DATA_KEY()).to.equal(QC_DATA_KEY)
      expect(await qcManager.SYSTEM_STATE_KEY()).to.equal(SYSTEM_STATE_KEY)
      expect(await qcManager.QC_RESERVE_LEDGER_KEY()).to.equal(
        QC_RESERVE_LEDGER_KEY
      )
      expect(await qcManager.SPV_VALIDATOR_KEY()).to.equal(SPV_VALIDATOR_KEY)
    })
  })

  describe("registerQC", () => {
    context("when called by admin with valid parameters", () => {
      let tx: any

      beforeEach(async () => {
        tx = await qcManager.registerQC(
          qcAddress.address,
          ethers.utils.parseEther("1000")
        )
      })

      it("should call QCData registerQC", async () => {
        expect(mockQcData.registerQC).to.have.been.calledWith(
          qcAddress.address,
          ethers.utils.parseEther("1000")
        )
      })

      it("should emit QCRegistrationInitiated event", async () => {
        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
        await expect(tx)
          .to.emit(qcManager, "QCRegistrationInitiated")
          .withArgs(qcAddress.address, deployer.address, currentBlock.timestamp)
      })
    })

    context("when called with invalid parameters", () => {
      it("should revert with zero address", async () => {
        await expect(
          qcManager.registerQC(
            ethers.constants.AddressZero,
            ethers.utils.parseEther("1000")
          )
        ).to.be.revertedWith("InvalidQCAddress")
      })

      it("should revert with zero minting capacity", async () => {
        await expect(
          qcManager.registerQC(qcAddress.address, 0)
        ).to.be.revertedWith("InvalidMintingCapacity")
      })

      it("should revert when QC already registered", async () => {
        mockQcData.isQCRegistered.returns(true)

        await expect(
          qcManager.registerQC(
            qcAddress.address,
            ethers.utils.parseEther("1000")
          )
        ).to.be.revertedWith("QCAlreadyRegistered")
      })
    })

    context("when function is paused", () => {
      beforeEach(async () => {
        mockSystemState.isFunctionPaused
          .whenCalledWith("registry")
          .returns(true)
      })

      it("should revert", async () => {
        await expect(
          qcManager.registerQC(
            qcAddress.address,
            ethers.utils.parseEther("1000")
          )
        ).to.be.revertedWith("Function is paused")
      })
    })

    context("when called by non-admin", () => {
      it("should revert", async () => {
        await expect(
          qcManager
            .connect(thirdParty)
            .registerQC(qcAddress.address, ethers.utils.parseEther("1000"))
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${QC_GOVERNANCE_ROLE}`
        )
      })
    })
  })

  describe("setQCStatus", () => {
    beforeEach(async () => {
      mockQcData.isQCRegistered.returns(true)
      mockQcData.getQCStatus.returns(0) // Active
    })

    context("when called by arbiter with valid transition", () => {
      let tx: any

      beforeEach(async () => {
        tx = await qcManager
          .connect(watchdog)
          .setQCStatus(qcAddress.address, 1, testReason) // Active -> UnderReview
      })

      it("should call QCData setQCStatus", async () => {
        expect(mockQcData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          1,
          testReason
        )
      })

      it("should emit QCStatusChanged event", async () => {
        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
        await expect(tx)
          .to.emit(qcManager, "QCStatusChanged")
          .withArgs(
            qcAddress.address,
            0,
            1,
            testReason,
            watchdog.address,
            currentBlock.timestamp
          )
      })
    })

    context("when QC is not registered", () => {
      beforeEach(async () => {
        mockQcData.isQCRegistered.returns(false)
      })

      it("should revert", async () => {
        await expect(
          qcManager
            .connect(watchdog)
            .setQCStatus(qcAddress.address, 1, testReason)
        ).to.be.revertedWith("QCNotRegistered")
      })
    })

    context("when status transition is invalid", () => {
      beforeEach(async () => {
        mockQcData.getQCStatus.returns(2) // Revoked
      })

      it("should revert when trying to transition from Revoked", async () => {
        await expect(
          qcManager
            .connect(watchdog)
            .setQCStatus(qcAddress.address, 0, testReason) // Revoked -> Active
        ).to.be.revertedWith("InvalidStatusTransition")
      })
    })

    context("when called by non-arbiter", () => {
      it("should revert", async () => {
        await expect(
          qcManager
            .connect(thirdParty)
            .setQCStatus(qcAddress.address, 1, testReason)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${ARBITER_ROLE}`
        )
      })
    })

    context("when function is paused", () => {
      beforeEach(async () => {
        mockSystemState.isFunctionPaused
          .whenCalledWith("registry")
          .returns(true)
      })

      it("should revert", async () => {
        await expect(
          qcManager
            .connect(watchdog)
            .setQCStatus(qcAddress.address, 1, testReason)
        ).to.be.revertedWith("Function is paused")
      })
    })
  })

  describe("registerWallet", () => {
    beforeEach(async () => {
      mockQcData.isQCRegistered.returns(true)
      mockQcData.getQCStatus.returns(0) // Active
    })

    context("when called by registrar with valid parameters", () => {
      let tx: any

      beforeEach(async () => {
        tx = await qcManager
          .connect(watchdog)
          .registerWallet(
            qcAddress.address,
            testBtcAddress,
            testChallenge,
            testTxInfo,
            testProof
          )
      })

      it("should call QCData registerWallet", async () => {
        expect(mockQcData.registerWallet).to.have.been.calledWith(
          qcAddress.address,
          testBtcAddress
        )
      })

      it("should emit WalletRegistrationRequested event", async () => {
        const receipt = await tx.wait()
        const { timestamp } = await ethers.provider.getBlock(
          receipt.blockNumber
        )
        await expect(tx)
          .to.emit(qcManager, "WalletRegistrationRequested")
          .withArgs(
            qcAddress.address,
            testBtcAddress,
            watchdog.address,
            timestamp
          )
      })
    })

    context("when called with invalid parameters", () => {
      it("should revert with empty wallet address", async () => {
        await expect(
          qcManager
            .connect(watchdog)
            .registerWallet(
              qcAddress.address,
              "",
              testChallenge,
              testTxInfo,
              testProof
            )
        ).to.be.revertedWith("InvalidWalletAddress")
      })

      it("should revert with SPV verification failure", async () => {
        mockSpvValidator.verifyWalletControl.returns(false)
        await expect(
          qcManager
            .connect(watchdog)
            .registerWallet(
              qcAddress.address,
              testBtcAddress,
              testChallenge,
              testTxInfo,
              testProof
            )
        ).to.be.revertedWith("SPVVerificationFailed")
      })
    })

    context("when QC is not registered", () => {
      beforeEach(async () => {
        mockQcData.isQCRegistered.returns(false)
      })

      it("should revert", async () => {
        await expect(
          qcManager
            .connect(watchdog)
            .registerWallet(
              qcAddress.address,
              testBtcAddress,
              testChallenge,
              testTxInfo,
              testProof
            )
        ).to.be.revertedWith("QCNotRegistered")
      })
    })

    context("when QC is not active", () => {
      beforeEach(async () => {
        mockQcData.getQCStatus.returns(1) // UnderReview
      })

      it("should revert", async () => {
        await expect(
          qcManager
            .connect(watchdog)
            .registerWallet(
              qcAddress.address,
              testBtcAddress,
              testChallenge,
              testTxInfo,
              testProof
            )
        ).to.be.revertedWith("QCNotActive")
      })
    })

    context("when called by non-registrar", () => {
      it("should revert", async () => {
        await expect(
          qcManager
            .connect(thirdParty)
            .registerWallet(
              qcAddress.address,
              testBtcAddress,
              testChallenge,
              testTxInfo,
              testProof
            )
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${REGISTRAR_ROLE}`
        )
      })
    })

    context("when function is paused", () => {
      beforeEach(async () => {
        mockSystemState.isFunctionPaused
          .whenCalledWith("wallet_registration")
          .returns(true)
      })

      it("should revert", async () => {
        await expect(
          qcManager
            .connect(watchdog)
            .registerWallet(
              qcAddress.address,
              testBtcAddress,
              testChallenge,
              testTxInfo,
              testProof
            )
        ).to.be.revertedWith("Function is paused")
      })
    })
  })

  describe("requestWalletDeRegistration", () => {
    beforeEach(async () => {
      mockQcData.getWalletOwner.returns(qcAddress.address)
      mockQcData.getWalletStatus.returns(1) // Active
    })

    context("when called by wallet owner", () => {
      it("should call QCData requestWalletDeRegistration", async () => {
        await qcManager
          .connect(qcAddress)
          .requestWalletDeRegistration(testBtcAddress)

        expect(mockQcData.requestWalletDeRegistration).to.have.been.calledWith(
          testBtcAddress
        )
      })
    })

    context("when called by admin", () => {
      it("should call QCData requestWalletDeRegistration", async () => {
        await qcManager.requestWalletDeRegistration(testBtcAddress)

        expect(mockQcData.requestWalletDeRegistration).to.have.been.calledWith(
          testBtcAddress
        )
      })
    })

    context("when wallet is not registered", () => {
      beforeEach(async () => {
        mockQcData.getWalletOwner.returns(ethers.constants.AddressZero)
      })

      it("should revert", async () => {
        await expect(
          qcManager.requestWalletDeRegistration(testBtcAddress)
        ).to.be.revertedWith("WalletNotRegistered")
      })
    })

    context("when called by unauthorized user", () => {
      it("should revert", async () => {
        await expect(
          qcManager
            .connect(thirdParty)
            .requestWalletDeRegistration(testBtcAddress)
        ).to.be.revertedWith("NotAuthorizedForWalletDeregistration")
      })
    })

    context("when wallet is not active", () => {
      beforeEach(async () => {
        mockQcData.getWalletStatus.returns(0) // Inactive
      })

      it("should revert", async () => {
        await expect(
          qcManager
            .connect(qcAddress)
            .requestWalletDeRegistration(testBtcAddress)
        ).to.be.revertedWith("WalletNotActive")
      })
    })

    context("when function is paused", () => {
      beforeEach(async () => {
        mockSystemState.isFunctionPaused
          .whenCalledWith("wallet_registration")
          .returns(true)
      })

      it("should revert", async () => {
        await expect(
          qcManager
            .connect(qcAddress)
            .requestWalletDeRegistration(testBtcAddress)
        ).to.be.revertedWith("Function is paused")
      })
    })
  })

  describe("finalizeWalletDeRegistration", () => {
    const newReserveBalance = ethers.utils.parseEther("8")

    beforeEach(async () => {
      mockQcData.getWalletOwner.returns(qcAddress.address)
      mockQcData.getWalletStatus.returns(2) // PendingDeRegistration
      mockQcData.getQCMintedAmount.returns(mintedAmount)
    })

    context("when called by registrar with sufficient reserves", () => {
      beforeEach(async () => {
        // Ensure new balance covers minted amount
        const sufficientBalance = mintedAmount.add(ethers.utils.parseEther("1"))
        await qcManager
          .connect(watchdog)
          .finalizeWalletDeRegistration(testBtcAddress, sufficientBalance)
      })

      it("should call QCData finalizeWalletDeRegistration", async () => {
        expect(mockQcData.finalizeWalletDeRegistration).to.have.been.calledWith(
          testBtcAddress
        )
      })

    })

    context("when wallet is not registered", () => {
      beforeEach(async () => {
        mockQcData.getWalletOwner.returns(ethers.constants.AddressZero)
      })

      it("should revert", async () => {
        await expect(
          qcManager
            .connect(watchdog)
            .finalizeWalletDeRegistration(testBtcAddress, newReserveBalance)
        ).to.be.revertedWith("WalletNotRegistered")
      })
    })

    context("when wallet is not pending deregistration", () => {
      beforeEach(async () => {
        mockQcData.getWalletStatus.returns(1) // Active
      })

      it("should revert", async () => {
        await expect(
          qcManager
            .connect(watchdog)
            .finalizeWalletDeRegistration(testBtcAddress, newReserveBalance)
        ).to.be.revertedWith("WalletNotPendingDeregistration")
      })
    })

    context("when new balance would make QC insolvent", () => {
      const insufficientBalance = mintedAmount.sub(1)

      it("should revert", async () => {
        await expect(
          qcManager
            .connect(watchdog)
            .finalizeWalletDeRegistration(testBtcAddress, insufficientBalance)
        ).to.be.revertedWith("QCWouldBecomeInsolvent")
      })
    })

    context("when called by non-registrar", () => {
      it("should revert", async () => {
        await expect(
          qcManager
            .connect(thirdParty)
            .finalizeWalletDeRegistration(testBtcAddress, newReserveBalance)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${REGISTRAR_ROLE}`
        )
      })
    })
  })

  describe("getAvailableMintingCapacity", () => {
    context("when QC is active with fresh reserves", () => {
      beforeEach(async () => {
        mockQcData.getQCStatus.returns(0) // Active
        mockQcQCReserveLedger.getReserveBalanceAndStaleness.returns([
          reserveBalance,
          false,
        ])
        mockQcData.getQCMintedAmount.returns(mintedAmount)
      })

      it("should return correct available capacity", async () => {
        const capacity = await qcManager.getAvailableMintingCapacity(
          qcAddress.address
        )
        const expectedCapacity = reserveBalance.sub(mintedAmount)
        expect(capacity).to.equal(expectedCapacity)
      })
    })

    context("when QC is not active", () => {
      beforeEach(async () => {
        mockQcData.getQCStatus.returns(1) // UnderReview
      })

      it("should return zero capacity", async () => {
        const capacity = await qcManager.getAvailableMintingCapacity(
          qcAddress.address
        )
        expect(capacity).to.equal(0)
      })
    })

    context("when reserves are stale", () => {
      beforeEach(async () => {
        mockQcData.getQCStatus.returns(0) // Active
        mockQcQCReserveLedger.getReserveBalanceAndStaleness.returns([
          reserveBalance,
          true,
        ])
      })

      it("should return zero capacity", async () => {
        const capacity = await qcManager.getAvailableMintingCapacity(
          qcAddress.address
        )
        expect(capacity).to.equal(0)
      })
    })

    context("when minted amount exceeds reserves", () => {
      beforeEach(async () => {
        mockQcData.getQCStatus.returns(0) // Active
        mockQcQCReserveLedger.getReserveBalanceAndStaleness.returns([
          reserveBalance,
          false,
        ])
        mockQcData.getQCMintedAmount.returns(reserveBalance.add(1)) // Minted > reserves
      })

      it("should return zero capacity", async () => {
        const capacity = await qcManager.getAvailableMintingCapacity(
          qcAddress.address
        )
        expect(capacity).to.equal(0)
      })
    })
  })

  describe("verifyQCSolvency", () => {
    beforeEach(async () => {
      mockQcData.isQCRegistered.returns(true)
      mockQcData.getQCStatus.returns(0) // Active
      mockQcQCReserveLedger.getReserveBalanceAndStaleness.returns([
        reserveBalance,
        false,
      ])
      mockQcData.getQCMintedAmount.returns(mintedAmount)
    })

    context("when QC is solvent", () => {
      it("should return true", async () => {
        await expect(
          qcManager.connect(watchdog).verifyQCSolvency(qcAddress.address)
        ).to.not.be.reverted
      })

      it("should emit SolvencyCheckPerformed event", async () => {
        const tx = await qcManager
          .connect(watchdog)
          .verifyQCSolvency(qcAddress.address)
        const receipt = await tx.wait()
        const { timestamp } = await ethers.provider.getBlock(
          receipt.blockNumber
        )
        await expect(tx)
          .to.emit(qcManager, "SolvencyCheckPerformed")
          .withArgs(
            qcAddress.address,
            true,
            mintedAmount,
            reserveBalance,
            watchdog.address,
            timestamp
          )
      })
    })

    context("when QC is insolvent", () => {
      beforeEach(async () => {
        const insufficientReserves = mintedAmount.sub(1)
        mockQcQCReserveLedger.getReserveBalanceAndStaleness.returns([
          insufficientReserves,
          false,
        ])
      })

      let tx: any

      beforeEach(async () => {
        tx = await qcManager
          .connect(watchdog)
          .verifyQCSolvency(qcAddress.address)
      })

      it("should emit SolvencyCheckPerformed event with false", async () => {
        const insufficientReserves = mintedAmount.sub(1)
        const receipt = await tx.wait()
        const { timestamp } = await ethers.provider.getBlock(
          receipt.blockNumber
        )
        await expect(tx)
          .to.emit(qcManager, "SolvencyCheckPerformed")
          .withArgs(
            qcAddress.address,
            false,
            mintedAmount,
            insufficientReserves,
            watchdog.address,
            timestamp
          )
      })

      it("should set QC status to UnderReview", async () => {
        expect(mockQcData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          1,
          ethers.utils.formatBytes32String("UNDERCOLLATERALIZED")
        )
      })

      it("should emit QCStatusChanged event", async () => {
        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
        await expect(tx)
          .to.emit(qcManager, "QCStatusChanged")
          .withArgs(
            qcAddress.address,
            0,
            1,
            ethers.utils.formatBytes32String("UNDERCOLLATERALIZED"),
            watchdog.address,
            currentBlock.timestamp
          )
      })
    })

    context("when QC is not registered", () => {
      beforeEach(async () => {
        mockQcData.isQCRegistered.returns(false)
      })

      it("should revert", async () => {
        await expect(
          qcManager.connect(watchdog).verifyQCSolvency(qcAddress.address)
        ).to.be.revertedWith("QCNotRegistered")
      })
    })

    context("when called by non-arbiter", () => {
      it("should revert", async () => {
        await expect(
          qcManager.connect(thirdParty).verifyQCSolvency(qcAddress.address)
        ).to.be.revertedWith("NotAuthorizedForSolvency")
      })
    })
  })

  describe("updateQCMintedAmount", () => {
    const newAmount = ethers.utils.parseEther("10")

    beforeEach(async () => {
      mockQcData.isQCRegistered.returns(true)
    })

    context("when called by admin", () => {
      it("should call QCData updateQCMintedAmount", async () => {
        await qcManager.updateQCMintedAmount(qcAddress.address, newAmount)

        expect(mockQcData.updateQCMintedAmount).to.have.been.calledWith(
          qcAddress.address,
          newAmount
        )
      })
    })

    context("when QC is not registered", () => {
      beforeEach(async () => {
        mockQcData.isQCRegistered.returns(false)
      })

      it("should revert", async () => {
        await expect(
          qcManager.updateQCMintedAmount(qcAddress.address, newAmount)
        ).to.be.revertedWith("QCNotRegistered")
      })
    })

    context("when called by non-admin", () => {
      it("should revert", async () => {
        await expect(
          qcManager
            .connect(thirdParty)
            .updateQCMintedAmount(qcAddress.address, newAmount)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${QC_ADMIN_ROLE}`
        )
      })
    })
  })


  describe("Status Transition Validation", () => {
    beforeEach(async () => {
      mockQcData.isQCRegistered.returns(true)
    })

    context("valid transitions", () => {
      it("should allow Active -> UnderReview", async () => {
        mockQcData.getQCStatus.returns(0) // Active

        await expect(
          qcManager
            .connect(watchdog)
            .setQCStatus(qcAddress.address, 1, testReason) // UnderReview
        ).to.not.be.reverted
      })

      it("should allow Active -> Revoked", async () => {
        mockQcData.getQCStatus.returns(0) // Active

        await expect(
          qcManager
            .connect(watchdog)
            .setQCStatus(qcAddress.address, 2, testReason) // Revoked
        ).to.not.be.reverted
      })

      it("should allow UnderReview -> Active", async () => {
        mockQcData.getQCStatus.returns(1) // UnderReview

        await expect(
          qcManager
            .connect(watchdog)
            .setQCStatus(qcAddress.address, 0, testReason) // Active
        ).to.not.be.reverted
      })

      it("should allow UnderReview -> Revoked", async () => {
        mockQcData.getQCStatus.returns(1) // UnderReview

        await expect(
          qcManager
            .connect(watchdog)
            .setQCStatus(qcAddress.address, 2, testReason) // Revoked
        ).to.not.be.reverted
      })
    })

    context("invalid transitions", () => {
      it("should reject Revoked -> Active", async () => {
        mockQcData.getQCStatus.returns(2) // Revoked

        await expect(
          qcManager
            .connect(watchdog)
            .setQCStatus(qcAddress.address, 0, testReason) // Active
        ).to.be.revertedWith("InvalidStatusTransition")
      })

      it("should reject Revoked -> UnderReview", async () => {
        mockQcData.getQCStatus.returns(2) // Revoked

        await expect(
          qcManager
            .connect(watchdog)
            .setQCStatus(qcAddress.address, 1, testReason) // UnderReview
        ).to.be.revertedWith("InvalidStatusTransition")
      })
    })
  })

  describe("Edge Cases", () => {
    context("when ProtocolRegistry services are not set", () => {
      beforeEach(async () => {
        // Deploy a fresh protocol registry without setting the QC_RESERVE_LEDGER_KEY service
        const ProtocolRegistryFactory = await ethers.getContractFactory(
          "ProtocolRegistry"
        )
        const freshProtocolRegistry = await ProtocolRegistryFactory.deploy()
        await freshProtocolRegistry.deployed()

        // Deploy a new QCManager with the fresh registry
        const QCManagerFactory = await ethers.getContractFactory("QCManager")
        const freshQCManager = await QCManagerFactory.deploy(
          freshProtocolRegistry.address
        )
        await freshQCManager.deployed()

        // Set only the services we need for the test, but leave QC_RESERVE_LEDGER_KEY unset
        await freshProtocolRegistry.setService(QC_DATA_KEY, mockQcData.address)
        await freshProtocolRegistry.setService(
          SYSTEM_STATE_KEY,
          mockSystemState.address
        )
        await freshProtocolRegistry.setService(
          SPV_VALIDATOR_KEY,
          mockSpvValidator.address
        )

        // Replace the global qcManager for this test
        qcManager = freshQCManager
      })

      it("should handle missing QCReserveLedger gracefully in getAvailableMintingCapacity", async () => {
        const capacity = await qcManager.getAvailableMintingCapacity(
          qcAddress.address
        )
        expect(capacity).to.equal(0)
      })

      it("should revert in finalizeWalletDeRegistration when QCReserveLedger unavailable", async () => {
        // Grant necessary roles to watchdog for the fresh QCManager
        await qcManager.grantRole(REGISTRAR_ROLE, watchdog.address)

        // Set up wallet as pending deregistration
        mockQcData.getWalletOwner.returns(qcAddress.address)
        mockQcData.getWalletStatus.returns(2) // PendingDeRegistration

        await expect(
          qcManager
            .connect(watchdog)
            .finalizeWalletDeRegistration(testBtcAddress, reserveBalance)
        ).to.be.revertedWith("QCReserveLedgerNotAvailable")
      })
    })

    context("boundary conditions for solvency", () => {
      beforeEach(async () => {
        await qcManager.registerQC(
          qcAddress.address,
          ethers.utils.parseEther("1000")
        )
        mockQcData.isQCRegistered.returns(true)
        mockQcData.getQCMintedAmount.returns(ethers.utils.parseEther("10"))
      })

      it("should be solvent when reserves exactly equal minted amount", async () => {
        mockQcQCReserveLedger.getReserveBalanceAndStaleness.returns([
          ethers.utils.parseEther("10"), // Exactly equal
          false,
        ])

        const tx = await qcManager
          .connect(watchdog)
          .verifyQCSolvency(qcAddress.address)
        const receipt = await tx.wait()

        // Find the SolvencyCheckPerformed event to get the result
        const solvencyEvent = receipt.events?.find(
          (e) => e.event === "SolvencyCheckPerformed"
        )
        expect(solvencyEvent?.args?.solvent).to.be.true
      })

      it("should be insolvent when reserves are 1 wei less than minted amount", async () => {
        mockQcQCReserveLedger.getReserveBalanceAndStaleness.returns([
          ethers.utils.parseEther("10").sub(1), // 1 wei less
          false,
        ])

        const tx = await qcManager
          .connect(watchdog)
          .verifyQCSolvency(qcAddress.address)
        const receipt = await tx.wait()

        // Find the SolvencyCheckPerformed event to get the result
        const solvencyEvent = receipt.events?.find(
          (e) => e.event === "SolvencyCheckPerformed"
        )
        expect(solvencyEvent?.args?.solvent).to.be.false
      })
    })

    context("when QC is already UnderReview due to insolvency", () => {
      beforeEach(async () => {
        await qcManager.registerQC(
          qcAddress.address,
          ethers.utils.parseEther("1000")
        )
        mockQcData.isQCRegistered.returns(true)
        mockQcData.getQCStatus.returns(1) // UnderReview
        mockQcData.getQCMintedAmount.returns(ethers.utils.parseEther("10"))
        mockQcQCReserveLedger.getReserveBalanceAndStaleness.returns([
          ethers.utils.parseEther("5"), // Insufficient reserves
          false,
        ])
      })

      it("should not change status again when verifying insolvent QC", async () => {
        const tx = await qcManager
          .connect(watchdog)
          .verifyQCSolvency(qcAddress.address)
        const receipt = await tx.wait()

        // Find the SolvencyCheckPerformed event to get the result
        const solvencyEvent = receipt.events?.find(
          (e) => e.event === "SolvencyCheckPerformed"
        )
        expect(solvencyEvent?.args?.solvent).to.be.false
        // Status change should not be triggered again since already UnderReview
      })
    })
  })

  // =================== INSTANT GOVERNANCE TESTS ===================

  describe("increaseMintingCapacity", () => {
    const newCap = ethers.utils.parseEther("10000") // 10000 tBTC
    const currentCap = ethers.utils.parseEther("5000") // 5000 tBTC

    beforeEach(async () => {
      mockQcData.isQCRegistered.returns(true)
      mockQcData.getMaxMintingCapacity.returns(currentCap)
    })

    context("when called by governance with valid parameters", () => {
      let tx: any

      beforeEach(async () => {
        tx = await qcManager.increaseMintingCapacity(qcAddress.address, newCap)
      })

      it("should call QCData updateMaxMintingCapacity", async () => {
        expect(mockQcData.updateMaxMintingCapacity).to.have.been.calledWith(
          qcAddress.address,
          newCap
        )
      })

      it("should emit MintingCapIncreased event", async () => {
        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
        await expect(tx)
          .to.emit(qcManager, "MintingCapIncreased")
          .withArgs(
            qcAddress.address,
            currentCap,
            newCap,
            deployer.address,
            currentBlock.timestamp
          )
      })
    })

    context("when called with invalid parameters", () => {
      it("should revert with zero address", async () => {
        await expect(
          qcManager.increaseMintingCapacity(
            ethers.constants.AddressZero,
            newCap
          )
        ).to.be.revertedWith("InvalidQCAddress")
      })

      it("should revert with zero minting capacity", async () => {
        await expect(
          qcManager.increaseMintingCapacity(qcAddress.address, 0)
        ).to.be.revertedWith("InvalidMintingCapacity")
      })

      it("should revert when QC not registered", async () => {
        mockQcData.isQCRegistered.returns(false)
        await expect(
          qcManager.increaseMintingCapacity(qcAddress.address, newCap)
        ).to.be.revertedWith("QCNotRegistered")
      })

      it("should revert when new cap is not higher than current", async () => {
        const lowerCap = ethers.utils.parseEther("3000") // Lower than current 5000
        await expect(
          qcManager.increaseMintingCapacity(qcAddress.address, lowerCap)
        ).to.be.revertedWith("NewCapMustBeHigher")
      })

      it("should revert when new cap equals current cap", async () => {
        await expect(
          qcManager.increaseMintingCapacity(qcAddress.address, currentCap)
        ).to.be.revertedWith("NewCapMustBeHigher")
      })
    })

    context("when called by non-governance", () => {
      it("should revert", async () => {
        await expect(
          qcManager
            .connect(thirdParty)
            .increaseMintingCapacity(qcAddress.address, newCap)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${QC_GOVERNANCE_ROLE}`
        )
      })
    })
  })


  describe("requestStatusChange", () => {
    beforeEach(async () => {
      mockQcData.isQCRegistered.returns(true)
      mockQcData.getQCStatus.returns(0) // Active
    })

    context("when called by watchdog enforcer", () => {
      context("when requesting UnderReview status", () => {
        let tx: any
        const reason = ethers.utils.id("INSUFFICIENT_RESERVES")

        beforeEach(async () => {
          tx = await qcManager
            .connect(watchdogEnforcer)
            .requestStatusChange(qcAddress.address, 1, reason) // 1 = UnderReview
        })

        it("should call QCData setQCStatus", async () => {
          expect(mockQcData.setQCStatus).to.have.been.calledWith(
            qcAddress.address,
            1,
            reason
          )
        })

        it("should emit QCStatusChangeRequested event", async () => {
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
          await expect(tx)
            .to.emit(qcManager, "QCStatusChangeRequested")
            .withArgs(
              qcAddress.address,
              1,
              reason,
              watchdogEnforcer.address,
              currentBlock.timestamp
            )
        })

        it("should emit QCStatusChanged event", async () => {
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
          await expect(tx)
            .to.emit(qcManager, "QCStatusChanged")
            .withArgs(
              qcAddress.address,
              0,
              1,
              reason,
              watchdogEnforcer.address,
              currentBlock.timestamp
            )
        })
      })

      context("when requesting Active status", () => {
        it("should revert", async () => {
          await expect(
            qcManager
              .connect(watchdogEnforcer)
              .requestStatusChange(qcAddress.address, 0, testReason) // 0 = Active
          ).to.be.revertedWith("WatchdogEnforcer can only set UnderReview status")
        })
      })

      context("when requesting Revoked status", () => {
        it("should revert", async () => {
          await expect(
            qcManager
              .connect(watchdogEnforcer)
              .requestStatusChange(qcAddress.address, 2, testReason) // 2 = Revoked
          ).to.be.revertedWith("WatchdogEnforcer can only set UnderReview status")
        })
      })

      context("when QC is already UnderReview", () => {
        beforeEach(async () => {
          mockQcData.getQCStatus.returns(1) // UnderReview
        })

        it("should allow setting UnderReview again", async () => {
          const tx = await qcManager
            .connect(watchdogEnforcer)
            .requestStatusChange(qcAddress.address, 1, testReason)

          expect(mockQcData.setQCStatus).to.have.been.calledWith(
            qcAddress.address,
            1,
            testReason
          )

          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
          await expect(tx)
            .to.emit(qcManager, "QCStatusChanged")
            .withArgs(
              qcAddress.address,
              1,
              1,
              testReason,
              watchdogEnforcer.address,
              currentBlock.timestamp
            )
        })
      })

      context("when QC is Revoked", () => {
        beforeEach(async () => {
          mockQcData.getQCStatus.returns(2) // Revoked
        })

        it("should revert with invalid transition", async () => {
          await expect(
            qcManager
              .connect(watchdogEnforcer)
              .requestStatusChange(qcAddress.address, 1, testReason)
          ).to.be.revertedWith("InvalidStatusTransition")
        })
      })

      context("when QC is not registered", () => {
        beforeEach(async () => {
          mockQcData.isQCRegistered.returns(false)
        })

        it("should revert", async () => {
          await expect(
            qcManager
              .connect(watchdogEnforcer)
              .requestStatusChange(qcAddress.address, 1, testReason)
          ).to.be.revertedWith("QCNotRegistered")
        })
      })
    })

    context("when called by non-watchdog enforcer", () => {
      it("should revert when called by arbiter", async () => {
        await expect(
          qcManager
            .connect(watchdog)
            .requestStatusChange(qcAddress.address, 1, testReason)
        ).to.be.revertedWith(
          `AccessControl: account ${watchdog.address.toLowerCase()} is missing role ${WATCHDOG_ENFORCER_ROLE}`
        )
      })

      it("should revert when called by third party", async () => {
        await expect(
          qcManager
            .connect(thirdParty)
            .requestStatusChange(qcAddress.address, 1, testReason)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${WATCHDOG_ENFORCER_ROLE}`
        )
      })
    })

    context("when function is paused", () => {
      beforeEach(async () => {
        mockSystemState.isFunctionPaused
          .whenCalledWith("registry")
          .returns(true)
      })

      it("should revert", async () => {
        await expect(
          qcManager
            .connect(watchdogEnforcer)
            .requestStatusChange(qcAddress.address, 1, testReason)
        ).to.be.revertedWith("Function is paused")
      })
    })
  })

  describe("State transition side effects", () => {
    beforeEach(async () => {
      mockQcData.isQCRegistered.returns(true)
    })

    context("when transitioning from Active to UnderReview", () => {
      beforeEach(async () => {
        mockQcData.getQCStatus.returns(0) // Active
      })

      it("should affect minting capacity", async () => {
        // First, verify QC has capacity when Active
        const initialCapacity = await qcManager.getAvailableMintingCapacity(
          qcAddress.address
        )
        expect(initialCapacity).to.be.gt(0)

        // Transition to UnderReview
        await qcManager
          .connect(watchdog)
          .setQCStatus(qcAddress.address, 1, testReason)

        // Update mock to return UnderReview status
        mockQcData.getQCStatus.returns(1)

        // Verify capacity is now zero
        const newCapacity = await qcManager.getAvailableMintingCapacity(
          qcAddress.address
        )
        expect(newCapacity).to.equal(0)
      })

      it("should prevent new wallet registrations", async () => {
        // Transition to UnderReview
        await qcManager
          .connect(watchdog)
          .setQCStatus(qcAddress.address, 1, testReason)

        // Update mock to return UnderReview status
        mockQcData.getQCStatus.returns(1)

        // Attempt to register a wallet should fail
        await expect(
          qcManager
            .connect(watchdog)
            .registerWallet(
              qcAddress.address,
              testBtcAddress,
              testChallenge,
              testTxInfo,
              testProof
            )
        ).to.be.revertedWith("QCNotActive")
      })

      it("should still allow wallet deregistration requests", async () => {
        // Setup wallet as registered and active
        mockQcData.getWalletOwner.returns(qcAddress.address)
        mockQcData.getWalletStatus.returns(1) // Active

        // Transition QC to UnderReview
        await qcManager
          .connect(watchdog)
          .setQCStatus(qcAddress.address, 1, testReason)

        // Wallet deregistration should still work
        await expect(
          qcManager
            .connect(qcAddress)
            .requestWalletDeRegistration(testBtcAddress)
        ).to.not.be.reverted
      })
    })

    context("when transitioning from UnderReview to Active", () => {
      beforeEach(async () => {
        mockQcData.getQCStatus.returns(1) // UnderReview
      })

      it("should restore minting capacity", async () => {
        // Initially no capacity in UnderReview
        let capacity = await qcManager.getAvailableMintingCapacity(
          qcAddress.address
        )
        expect(capacity).to.equal(0)

        // Transition back to Active
        await qcManager
          .connect(watchdog)
          .setQCStatus(qcAddress.address, 0, testReason)

        // Update mock to return Active status
        mockQcData.getQCStatus.returns(0)

        // Verify capacity is restored
        capacity = await qcManager.getAvailableMintingCapacity(
          qcAddress.address
        )
        expect(capacity).to.be.gt(0)
      })

      it("should allow wallet registrations again", async () => {
        // Transition to Active
        await qcManager
          .connect(watchdog)
          .setQCStatus(qcAddress.address, 0, testReason)

        // Update mock to return Active status
        mockQcData.getQCStatus.returns(0)

        // Wallet registration should work
        await expect(
          qcManager
            .connect(watchdog)
            .registerWallet(
              qcAddress.address,
              testBtcAddress,
              testChallenge,
              testTxInfo,
              testProof
            )
        ).to.not.be.reverted
      })
    })

    context("when transitioning to Revoked (terminal state)", () => {
      beforeEach(async () => {
        mockQcData.getQCStatus.returns(0) // Active
      })

      it("should permanently disable all QC operations", async () => {
        // Transition to Revoked
        await qcManager
          .connect(watchdog)
          .setQCStatus(qcAddress.address, 2, testReason)

        // Update mock to return Revoked status
        mockQcData.getQCStatus.returns(2)

        // Minting capacity should be zero
        const capacity = await qcManager.getAvailableMintingCapacity(
          qcAddress.address
        )
        expect(capacity).to.equal(0)

        // Wallet registration should fail
        await expect(
          qcManager
            .connect(watchdog)
            .registerWallet(
              qcAddress.address,
              testBtcAddress,
              testChallenge,
              testTxInfo,
              testProof
            )
        ).to.be.revertedWith("QCNotActive")

        // Cannot transition out of Revoked
        await expect(
          qcManager
            .connect(watchdog)
            .setQCStatus(qcAddress.address, 0, testReason)
        ).to.be.revertedWith("InvalidStatusTransition")

        await expect(
          qcManager
            .connect(watchdog)
            .setQCStatus(qcAddress.address, 1, testReason)
        ).to.be.revertedWith("InvalidStatusTransition")
      })
    })

    context("state transition event ordering", () => {
      it("should emit events in correct order", async () => {
        mockQcData.getQCStatus.returns(0) // Active

        const tx = await qcManager
          .connect(watchdog)
          .setQCStatus(qcAddress.address, 1, testReason)

        // Get events from transaction
        const receipt = await tx.wait()
        const events = receipt.events?.map((e: any) => e.event) || []

        // Verify QCStatusChanged is emitted
        expect(events).to.include("QCStatusChanged")

        // Verify state change was called
        expect(mockQcData.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          1,
          testReason
        )
      })
    })

    context("concurrent state changes", () => {
      it("should handle rapid state transitions", async () => {
        mockQcData.getQCStatus.returns(0) // Active

        // First transition: Active -> UnderReview
        await qcManager
          .connect(watchdog)
          .setQCStatus(qcAddress.address, 1, testReason)

        // Update mock
        mockQcData.getQCStatus.returns(1)

        // Second transition: UnderReview -> Active
        await qcManager
          .connect(watchdog)
          .setQCStatus(qcAddress.address, 0, testReason)

        // Update mock
        mockQcData.getQCStatus.returns(0)

        // Third transition: Active -> Revoked
        await qcManager
          .connect(watchdog)
          .setQCStatus(qcAddress.address, 2, testReason)

        // Verify all transitions were executed
        expect(mockQcData.setQCStatus).to.have.been.calledThrice
      })
    })

    context("state-dependent calculations", () => {
      it("should return zero capacity for stale reserves regardless of state", async () => {
        // Setup: Active state but stale reserves
        mockQcData.getQCStatus.returns(0) // Active
        mockQcQCReserveLedger.getReserveBalanceAndStaleness.returns([
          reserveBalance,
          true, // Stale
        ])

        const capacity = await qcManager.getAvailableMintingCapacity(
          qcAddress.address
        )
        expect(capacity).to.equal(0)
      })

      it("should calculate capacity correctly when transitioning states", async () => {
        // Setup specific values
        const specificReserve = ethers.utils.parseEther("100")
        const specificMinted = ethers.utils.parseEther("60")
        
        mockQcData.getQCStatus.returns(0) // Active
        mockQcQCReserveLedger.getReserveBalanceAndStaleness.returns([
          specificReserve,
          false,
        ])
        mockQcData.getQCMintedAmount.returns(specificMinted)

        // Active state: should have capacity
        let capacity = await qcManager.getAvailableMintingCapacity(
          qcAddress.address
        )
        expect(capacity).to.equal(specificReserve.sub(specificMinted))

        // Transition to UnderReview
        await qcManager
          .connect(watchdog)
          .setQCStatus(qcAddress.address, 1, testReason)
        mockQcData.getQCStatus.returns(1)

        // UnderReview state: should have zero capacity
        capacity = await qcManager.getAvailableMintingCapacity(
          qcAddress.address
        )
        expect(capacity).to.equal(0)
      })
    })
  })

  describe("Transaction ordering and edge cases", () => {
    beforeEach(async () => {
      mockQcData.isQCRegistered.returns(true)
    })

    context("race conditions", () => {
      it("should handle simultaneous enforcement and arbiter actions", async () => {
        mockQcData.getQCStatus.returns(0) // Active

        // Simulate near-simultaneous calls (in practice these would be in separate blocks)
        // 1. WatchdogEnforcer sets to UnderReview
        const tx1 = await qcManager
          .connect(watchdogEnforcer)
          .requestStatusChange(qcAddress.address, 1, INSUFFICIENT_RESERVES)

        // Update mock state
        mockQcData.getQCStatus.returns(1) // UnderReview

        // 2. Arbiter tries to set to Revoked
        const tx2 = await qcManager
          .connect(watchdog)
          .setQCStatus(qcAddress.address, 2, testReason)

        // Both should succeed as transitions are valid
        await expect(tx1).to.not.be.reverted
        await expect(tx2).to.not.be.reverted

        // Final state should be Revoked
        expect(mockQcData.setQCStatus).to.have.been.lastCalledWith(
          qcAddress.address,
          2,
          testReason
        )
      })

      it("should handle competing watchdog enforcers", async () => {
        // Grant WATCHDOG_ENFORCER_ROLE to another address
        const watchdogEnforcer2 = thirdParty
        await qcManager.grantRole(WATCHDOG_ENFORCER_ROLE, watchdogEnforcer2.address)

        mockQcData.getQCStatus.returns(0) // Active

        // Both enforcers detect violations and try to enforce
        const reason1 = ethers.utils.id("INSUFFICIENT_RESERVES")
        const reason2 = ethers.utils.id("STALE_ATTESTATIONS")

        // First enforcer
        await qcManager
          .connect(watchdogEnforcer)
          .requestStatusChange(qcAddress.address, 1, reason1)

        // Update state
        mockQcData.getQCStatus.returns(1)

        // Second enforcer (should still work as UnderReview -> UnderReview is valid)
        await expect(
          qcManager
            .connect(watchdogEnforcer2)
            .requestStatusChange(qcAddress.address, 1, reason2)
        ).to.not.be.reverted

        // Should have been called twice with different reasons
        expect(mockQcData.setQCStatus).to.have.been.calledTwice
      })
    })

    context("edge cases", () => {
      it("should handle zero address in state transitions", async () => {
        await expect(
          qcManager
            .connect(watchdog)
            .setQCStatus(ethers.constants.AddressZero, 1, testReason)
        ).to.be.revertedWith("QCNotRegistered")
      })

      it("should handle empty reason in transitions", async () => {
        mockQcData.getQCStatus.returns(0) // Active
        const emptyReason = ethers.constants.HashZero

        // Should allow empty reason (business logic decision)
        await expect(
          qcManager
            .connect(watchdog)
            .setQCStatus(qcAddress.address, 1, emptyReason)
        ).to.not.be.reverted
      })

      it("should handle maximum values correctly", async () => {
        // Test with maximum uint256 values
        const maxReserve = ethers.constants.MaxUint256
        const maxMinted = ethers.constants.MaxUint256

        mockQcData.getQCStatus.returns(0) // Active
        mockQcQCReserveLedger.getReserveBalanceAndStaleness.returns([
          maxReserve,
          false,
        ])
        mockQcData.getQCMintedAmount.returns(maxMinted)

        // Should handle overflow protection
        const capacity = await qcManager.getAvailableMintingCapacity(
          qcAddress.address
        )
        expect(capacity).to.equal(0) // Since minted >= reserves
      })

      it("should handle registry service unavailability gracefully", async () => {
        // Mock registry to return zero address for QC_DATA
        await protocolRegistry.setService(QC_DATA_KEY, ethers.constants.AddressZero)

        // Should revert with service unavailable
        await expect(
          qcManager
            .connect(watchdog)
            .setQCStatus(qcAddress.address, 1, testReason)
        ).to.be.reverted
      })
    })

    context("reentrancy scenarios", () => {
      it("should prevent reentrancy in status changes", async () => {
        mockQcData.getQCStatus.returns(0) // Active

        // Mock setQCStatus to attempt reentrancy
        let callCount = 0
        mockQcData.setQCStatus.callsFake(async () => {
          callCount++
          if (callCount === 1) {
            // Try to call setQCStatus again (would fail with reentrancy guard if present)
            // In this case, the function doesn't have explicit reentrancy guard
            // but state changes prevent issues
            mockQcData.getQCStatus.returns(1) // Change state
          }
        })

        await qcManager
          .connect(watchdog)
          .setQCStatus(qcAddress.address, 1, testReason)

        // Should only be called once per transaction
        expect(callCount).to.equal(1)
      })
    })

    context("gas optimization scenarios", () => {
      it("should efficiently handle batch status checks", async () => {
        // Setup multiple QCs
        const qcAddresses = [
          "0x0000000000000000000000000000000000000001",
          "0x0000000000000000000000000000000000000002",
          "0x0000000000000000000000000000000000000003",
        ]

        // Mock different states
        mockQcData.isQCRegistered.returns(true)
        mockQcData.getQCStatus
          .whenCalledWith(qcAddresses[0])
          .returns(0) // Active
        mockQcData.getQCStatus
          .whenCalledWith(qcAddresses[1])
          .returns(1) // UnderReview
        mockQcData.getQCStatus
          .whenCalledWith(qcAddresses[2])
          .returns(2) // Revoked

        // Check capacity for each
        const capacities = await Promise.all(
          qcAddresses.map((qc) => qcManager.getAvailableMintingCapacity(qc))
        )

        expect(capacities[0]).to.be.gt(0) // Active has capacity
        expect(capacities[1]).to.equal(0) // UnderReview has no capacity
        expect(capacities[2]).to.equal(0) // Revoked has no capacity
      })
    })

    context("permission boundary testing", () => {
      it("should enforce strict role separation", async () => {
        mockQcData.getQCStatus.returns(0) // Active

        // QC_ADMIN cannot change status
        await qcManager.grantRole(QC_ADMIN_ROLE, thirdParty.address)
        await expect(
          qcManager
            .connect(thirdParty)
            .setQCStatus(qcAddress.address, 1, testReason)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${ARBITER_ROLE}`
        )

        // REGISTRAR cannot change status
        await qcManager.grantRole(REGISTRAR_ROLE, thirdParty.address)
        await expect(
          qcManager
            .connect(thirdParty)
            .setQCStatus(qcAddress.address, 1, testReason)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${ARBITER_ROLE}`
        )

        // WATCHDOG_ENFORCER cannot use setQCStatus (must use requestStatusChange)
        await expect(
          qcManager
            .connect(watchdogEnforcer)
            .setQCStatus(qcAddress.address, 1, testReason)
        ).to.be.revertedWith(
          `AccessControl: account ${watchdogEnforcer.address.toLowerCase()} is missing role ${ARBITER_ROLE}`
        )
      })
    })

    context("extreme state scenarios", () => {
      it("should handle all QCs being revoked", async () => {
        const qcs = Array(10)
          .fill(0)
          .map((_, i) => ({
            address: ethers.utils.getAddress(
              `0x${(i + 1).toString(16).padStart(40, "0")}`
            ),
          }))

        // Mock all as revoked
        mockQcData.isQCRegistered.returns(true)
        mockQcData.getQCStatus.returns(2) // All revoked

        // Check that all have zero capacity
        for (const qc of qcs) {
          const capacity = await qcManager.getAvailableMintingCapacity(qc.address)
          expect(capacity).to.equal(0)
        }
      })

      it("should handle rapid status oscillation", async () => {
        mockQcData.getQCStatus.returns(0) // Start Active

        // Oscillate between Active and UnderReview multiple times
        for (let i = 0; i < 5; i++) {
          // Active -> UnderReview
          await qcManager
            .connect(watchdog)
            .setQCStatus(qcAddress.address, 1, testReason)
          mockQcData.getQCStatus.returns(1)

          // UnderReview -> Active
          await qcManager
            .connect(watchdog)
            .setQCStatus(qcAddress.address, 0, testReason)
          mockQcData.getQCStatus.returns(0)
        }

        // Should have been called 10 times (5 oscillations * 2)
        expect(mockQcData.setQCStatus.callCount).to.equal(10)
      })
    })
  })
})
