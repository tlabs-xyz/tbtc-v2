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
  let thirdParty: SignerWithAddress

  let qcManager: QCManager
  let protocolRegistry: ProtocolRegistry
  let mockQcData: FakeContract<QCData>
  let mockSystemState: FakeContract<SystemState>
  let mockQcReserveLedger: FakeContract<QCReserveLedger>
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

  before(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;[deployer, governance, qcAddress, watchdog, thirdParty] =
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
    mockQcReserveLedger = await smock.fake<QCReserveLedger>("QCReserveLedger")
    mockSpvValidator = await smock.fake<SPVValidator>("SPVValidator")

    // Register services
    await protocolRegistry.setService(QC_DATA_KEY, mockQcData.address)
    await protocolRegistry.setService(SYSTEM_STATE_KEY, mockSystemState.address)
    await protocolRegistry.setService(
      QC_RESERVE_LEDGER_KEY,
      mockQcReserveLedger.address
    )
    await protocolRegistry.setService(
      SPV_VALIDATOR_KEY,
      mockSpvValidator.address
    )

    // Set up default mock behaviors
    mockSystemState.isFunctionPaused.returns(false)
    mockQcData.isQCRegistered.returns(false)
    mockQcData.getQCStatus.returns(0) // Active
    mockQcData.getWalletStatus.returns(1) // Active
    mockQcData.getWalletOwner.returns(qcAddress.address)
    mockQcData.getQCMintedAmount.returns(mintedAmount)
    mockQcData.getMaxMintingCapacity.returns(ethers.utils.parseEther("5000"))
    mockQcReserveLedger.getReserveBalanceAndStaleness.returns([
      reserveBalance,
      false,
    ])
    mockSpvValidator.verifyWalletControl.returns(true)

    // Grant roles
    await qcManager.grantRole(REGISTRAR_ROLE, watchdog.address)
    await qcManager.grantRole(ARBITER_ROLE, watchdog.address)
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
    })
  })

  describe("Role Constants", () => {
    it("should have correct role constants", async () => {
      expect(await qcManager.QC_ADMIN_ROLE()).to.equal(QC_ADMIN_ROLE)
      expect(await qcManager.REGISTRAR_ROLE()).to.equal(REGISTRAR_ROLE)
      expect(await qcManager.ARBITER_ROLE()).to.equal(ARBITER_ROLE)
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
        tx = await qcManager.registerQC(qcAddress.address)
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
          qcManager.registerQC(ethers.constants.AddressZero)
        ).to.be.revertedWith("InvalidQCAddress")
      })

      it("should revert when QC already registered", async () => {
        mockQcData.isQCRegistered.returns(true)

        await expect(
          qcManager.registerQC(qcAddress.address)
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
          qcManager.registerQC(qcAddress.address)
        ).to.be.revertedWith("Function is paused")
      })
    })

    context("when called by non-admin", () => {
      it("should revert", async () => {
        await expect(
          qcManager.connect(thirdParty).registerQC(qcAddress.address)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${QC_ADMIN_ROLE}`
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

      it("should update reserve ledger", async () => {
        const sufficientBalance = mintedAmount.add(ethers.utils.parseEther("1"))
        expect(
          mockQcReserveLedger.submitReserveAttestation
        ).to.have.been.calledWith(qcAddress.address, sufficientBalance)
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
        mockQcReserveLedger.getReserveBalanceAndStaleness.returns([
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
        mockQcReserveLedger.getReserveBalanceAndStaleness.returns([
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
        mockQcReserveLedger.getReserveBalanceAndStaleness.returns([
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
      mockQcReserveLedger.getReserveBalanceAndStaleness.returns([
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
        mockQcReserveLedger.getReserveBalanceAndStaleness.returns([
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

  describe("getQCStatus", () => {
    it("should delegate to QCData", async () => {
      mockQcData.getQCStatus.returns(1) // UnderReview

      const status = await qcManager.getQCStatus(qcAddress.address)

      expect(mockQcData.getQCStatus).to.have.been.calledWith(qcAddress.address)
      expect(status).to.equal(1)
    })
  })

  describe("getQCWallets", () => {
    const mockWallets = ["wallet1", "wallet2", "wallet3"]

    it("should delegate to QCData", async () => {
      mockQcData.getQCWallets.returns(mockWallets)

      const wallets = await qcManager.getQCWallets(qcAddress.address)

      expect(mockQcData.getQCWallets).to.have.been.calledWith(qcAddress.address)
      expect(wallets).to.deep.equal(mockWallets)
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
        await qcManager.registerQC(qcAddress.address)
        mockQcData.isQCRegistered.returns(true)
        mockQcData.getQCMintedAmount.returns(ethers.utils.parseEther("10"))
      })

      it("should be solvent when reserves exactly equal minted amount", async () => {
        mockQcReserveLedger.getReserveBalanceAndStaleness.returns([
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
        mockQcReserveLedger.getReserveBalanceAndStaleness.returns([
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
        await qcManager.registerQC(qcAddress.address)
        mockQcData.isQCRegistered.returns(true)
        mockQcData.getQCStatus.returns(1) // UnderReview
        mockQcData.getQCMintedAmount.returns(ethers.utils.parseEther("10"))
        mockQcReserveLedger.getReserveBalanceAndStaleness.returns([
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

  // =================== TIME-LOCKED GOVERNANCE TESTS ===================

  describe("Time-Locked Governance", () => {
    const TIME_LOCKED_ADMIN_ROLE = ethers.utils.id("TIME_LOCKED_ADMIN_ROLE")
    const GOVERNANCE_DELAY = 7 * 24 * 60 * 60 // 7 days in seconds
    const maxMintingCap = ethers.utils.parseEther("5000") // 5000 tBTC
    let timeLockedAdmin: SignerWithAddress

    beforeEach(async () => {
      timeLockedAdmin = thirdParty
      await qcManager.grantRole(TIME_LOCKED_ADMIN_ROLE, timeLockedAdmin.address)
    })

    describe("Role Constants", () => {
      it("should have correct TIME_LOCKED_ADMIN_ROLE constant", async () => {
        expect(await qcManager.TIME_LOCKED_ADMIN_ROLE()).to.equal(
          TIME_LOCKED_ADMIN_ROLE
        )
      })

      it("should have correct GOVERNANCE_DELAY constant", async () => {
        expect(await qcManager.GOVERNANCE_DELAY()).to.equal(GOVERNANCE_DELAY)
      })
    })

    describe("queueQCOnboarding", () => {
      context("when called by authorized admin", () => {
        let tx: any
        let actionHash: string

        beforeEach(async () => {
          actionHash = ethers.utils.keccak256(
            ethers.utils.solidityPack(
              ["string", "address", "uint256"],
              ["QC_ONBOARDING", qcAddress.address, maxMintingCap]
            )
          )
          tx = await qcManager
            .connect(timeLockedAdmin)
            .queueQCOnboarding(qcAddress.address, maxMintingCap)
        })

        it("should store pending action with correct parameters", async () => {
          const pendingAction = await qcManager.pendingActions(actionHash)
          expect(pendingAction.actionHash).to.equal(actionHash)
          expect(pendingAction.executed).to.be.false
        })

        it("should emit GovernanceActionQueued event", async () => {
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
          const expectedExecutionTime = ethers.BigNumber.from(
            currentBlock.timestamp + GOVERNANCE_DELAY
          )
          await expect(tx)
            .to.emit(qcManager, "GovernanceActionQueued")
            .withArgs(
              actionHash,
              expectedExecutionTime,
              "QC_ONBOARDING",
              timeLockedAdmin.address,
              currentBlock.timestamp
            )
        })

        it("should set correct execution time", async () => {
          const pendingAction = await qcManager.pendingActions(actionHash)
          const currentBlock = await ethers.provider.getBlock("latest")
          const expectedExecutionTime = ethers.BigNumber.from(
            currentBlock.timestamp + GOVERNANCE_DELAY
          )
          expect(pendingAction.executeAfter).to.be.closeTo(
            expectedExecutionTime,
            10
          )
        })
      })

      context("when called with invalid parameters", () => {
        it("should revert with zero address", async () => {
          await expect(
            qcManager
              .connect(timeLockedAdmin)
              .queueQCOnboarding(ethers.constants.AddressZero, maxMintingCap)
          ).to.be.revertedWith("InvalidQCAddress")
        })

        it("should revert with zero minting capacity", async () => {
          await expect(
            qcManager
              .connect(timeLockedAdmin)
              .queueQCOnboarding(qcAddress.address, 0)
          ).to.be.revertedWith("InvalidMintingCapacity")
        })

        it("should revert when QC already registered", async () => {
          mockQcData.isQCRegistered.returns(true)
          await expect(
            qcManager
              .connect(timeLockedAdmin)
              .queueQCOnboarding(qcAddress.address, maxMintingCap)
          ).to.be.revertedWith("QCAlreadyRegistered")
        })

        it("should revert when action already queued", async () => {
          await qcManager
            .connect(timeLockedAdmin)
            .queueQCOnboarding(qcAddress.address, maxMintingCap)

          await expect(
            qcManager
              .connect(timeLockedAdmin)
              .queueQCOnboarding(qcAddress.address, maxMintingCap)
          ).to.be.revertedWith("ActionAlreadyQueued")
        })
      })

      context("when called by unauthorized account", () => {
        it("should revert", async () => {
          await expect(
            qcManager
              .connect(governance)
              .queueQCOnboarding(qcAddress.address, maxMintingCap)
          ).to.be.revertedWith(
            `AccessControl: account ${governance.address.toLowerCase()} is missing role ${TIME_LOCKED_ADMIN_ROLE}`
          )
        })
      })
    })

    describe("executeQCOnboarding", () => {
      let actionHash: string

      beforeEach(async () => {
        actionHash = ethers.utils.keccak256(
          ethers.utils.solidityPack(
            ["string", "address", "uint256"],
            ["QC_ONBOARDING", qcAddress.address, maxMintingCap]
          )
        )
        await qcManager
          .connect(timeLockedAdmin)
          .queueQCOnboarding(qcAddress.address, maxMintingCap)
      })

      context("when delay period has elapsed", () => {
        let tx: any

        beforeEach(async () => {
          // Fast forward time past governance delay
          await network.provider.send("evm_increaseTime", [
            GOVERNANCE_DELAY + 1,
          ])
          await network.provider.send("evm_mine")

          tx = await qcManager
            .connect(timeLockedAdmin)
            .executeQCOnboarding(qcAddress.address, maxMintingCap)
        })

        it("should call QCData registerQC", async () => {
          expect(mockQcData.registerQC).to.have.been.calledWith(
            qcAddress.address,
            maxMintingCap
          )
        })

        it("should mark action as executed", async () => {
          const pendingAction = await qcManager.pendingActions(actionHash)
          expect(pendingAction.executed).to.be.true
        })

        it("should emit GovernanceActionExecuted event", async () => {
          const receipt = await tx.wait()
          const { timestamp } = await ethers.provider.getBlock(
            receipt.blockNumber
          )
          await expect(tx)
            .to.emit(qcManager, "GovernanceActionExecuted")
            .withArgs(
              actionHash,
              "QC_ONBOARDING",
              timeLockedAdmin.address,
              timestamp
            )
        })

        it("should emit QCOnboarded event", async () => {
          const receipt = await tx.wait()
          const { timestamp } = await ethers.provider.getBlock(
            receipt.blockNumber
          )
          await expect(tx)
            .to.emit(qcManager, "QCOnboarded")
            .withArgs(
              qcAddress.address,
              maxMintingCap,
              timeLockedAdmin.address,
              timestamp
            )
        })

        it("should emit QCRegistrationInitiated event", async () => {
          const receipt = await tx.wait()
          const { timestamp } = await ethers.provider.getBlock(
            receipt.blockNumber
          )
          await expect(tx)
            .to.emit(qcManager, "QCRegistrationInitiated")
            .withArgs(qcAddress.address, timeLockedAdmin.address, timestamp)
        })
      })

      context("when delay period has not elapsed", () => {
        it("should revert", async () => {
          await expect(
            qcManager
              .connect(timeLockedAdmin)
              .executeQCOnboarding(qcAddress.address, maxMintingCap)
          ).to.be.revertedWith("DelayPeriodNotElapsed")
        })
      })

      context("when action not queued", () => {
        it("should revert", async () => {
          const differentActionHash = ethers.utils.keccak256(
            ethers.utils.solidityPack(
              ["string", "address", "uint256"],
              ["QC_ONBOARDING", thirdParty.address, maxMintingCap] // Different QC address
            )
          )

          await expect(
            qcManager
              .connect(timeLockedAdmin)
              .executeQCOnboarding(thirdParty.address, maxMintingCap)
          ).to.be.revertedWith("ActionNotQueued")
        })
      })

      context("when action already executed", () => {
        beforeEach(async () => {
          await network.provider.send("evm_increaseTime", [
            GOVERNANCE_DELAY + 1,
          ])
          await network.provider.send("evm_mine")
          await qcManager
            .connect(timeLockedAdmin)
            .executeQCOnboarding(qcAddress.address, maxMintingCap)
        })

        it("should revert", async () => {
          await expect(
            qcManager
              .connect(timeLockedAdmin)
              .executeQCOnboarding(qcAddress.address, maxMintingCap)
          ).to.be.revertedWith("ActionAlreadyExecuted")
        })
      })

      context("when called by unauthorized account", () => {
        it("should revert", async () => {
          await network.provider.send("evm_increaseTime", [
            GOVERNANCE_DELAY + 1,
          ])
          await network.provider.send("evm_mine")

          await expect(
            qcManager
              .connect(governance)
              .executeQCOnboarding(qcAddress.address, maxMintingCap)
          ).to.be.revertedWith(
            `AccessControl: account ${governance.address.toLowerCase()} is missing role ${TIME_LOCKED_ADMIN_ROLE}`
          )
        })
      })
    })

    describe("queueMintingCapIncrease", () => {
      const newCap = ethers.utils.parseEther("10000") // 10000 tBTC
      const currentCap = ethers.utils.parseEther("5000") // 5000 tBTC

      beforeEach(async () => {
        mockQcData.isQCRegistered.returns(true)
        mockQcData.getMaxMintingCapacity.returns(currentCap)
      })

      context("when called by authorized admin", () => {
        let tx: any
        let actionHash: string

        beforeEach(async () => {
          actionHash = ethers.utils.keccak256(
            ethers.utils.solidityPack(
              ["string", "address", "uint256"],
              ["MINTING_CAP_INCREASE", qcAddress.address, newCap]
            )
          )
          tx = await qcManager
            .connect(timeLockedAdmin)
            .queueMintingCapIncrease(qcAddress.address, newCap)
        })

        it("should store pending action with correct parameters", async () => {
          const pendingAction = await qcManager.pendingActions(actionHash)
          expect(pendingAction.actionHash).to.equal(actionHash)
          expect(pendingAction.executed).to.be.false
        })

        it("should emit GovernanceActionQueued event", async () => {
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
          const expectedExecutionTime = ethers.BigNumber.from(
            currentBlock.timestamp + GOVERNANCE_DELAY
          )
          await expect(tx)
            .to.emit(qcManager, "GovernanceActionQueued")
            .withArgs(
              actionHash,
              expectedExecutionTime,
              "MINTING_CAP_INCREASE",
              timeLockedAdmin.address,
              currentBlock.timestamp
            )
        })
      })

      context("when called with invalid parameters", () => {
        it("should revert with zero address", async () => {
          await expect(
            qcManager
              .connect(timeLockedAdmin)
              .queueMintingCapIncrease(ethers.constants.AddressZero, newCap)
          ).to.be.revertedWith("InvalidQCAddress")
        })

        it("should revert with zero minting capacity", async () => {
          await expect(
            qcManager
              .connect(timeLockedAdmin)
              .queueMintingCapIncrease(qcAddress.address, 0)
          ).to.be.revertedWith("InvalidMintingCapacity")
        })

        it("should revert when QC not registered", async () => {
          mockQcData.isQCRegistered.returns(false)
          await expect(
            qcManager
              .connect(timeLockedAdmin)
              .queueMintingCapIncrease(qcAddress.address, newCap)
          ).to.be.revertedWith("QCNotRegistered")
        })

        it("should revert when new cap is not higher than current", async () => {
          const lowerCap = ethers.utils.parseEther("3000") // Lower than current 5000
          await expect(
            qcManager
              .connect(timeLockedAdmin)
              .queueMintingCapIncrease(qcAddress.address, lowerCap)
          ).to.be.revertedWith("NewCapMustBeHigher")
        })
      })
    })

    describe("executeMintingCapIncrease", () => {
      const newCap = ethers.utils.parseEther("10000") // 10000 tBTC
      const currentCap = ethers.utils.parseEther("5000") // 5000 tBTC
      let actionHash: string

      beforeEach(async () => {
        mockQcData.isQCRegistered.returns(true)
        mockQcData.getMaxMintingCapacity.returns(currentCap)

        actionHash = ethers.utils.keccak256(
          ethers.utils.solidityPack(
            ["string", "address", "uint256"],
            ["MINTING_CAP_INCREASE", qcAddress.address, newCap]
          )
        )
        await qcManager
          .connect(timeLockedAdmin)
          .queueMintingCapIncrease(qcAddress.address, newCap)
      })

      context("when delay period has elapsed", () => {
        let tx: any

        beforeEach(async () => {
          await network.provider.send("evm_increaseTime", [
            GOVERNANCE_DELAY + 1,
          ])
          await network.provider.send("evm_mine")

          tx = await qcManager
            .connect(timeLockedAdmin)
            .executeMintingCapIncrease(qcAddress.address, newCap)
        })

        it("should call QCData updateMaxMintingCapacity", async () => {
          expect(mockQcData.updateMaxMintingCapacity).to.have.been.calledWith(
            qcAddress.address,
            newCap
          )
        })

        it("should mark action as executed", async () => {
          const pendingAction = await qcManager.pendingActions(actionHash)
          expect(pendingAction.executed).to.be.true
        })

        it("should emit GovernanceActionExecuted event", async () => {
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
          await expect(tx)
            .to.emit(qcManager, "GovernanceActionExecuted")
            .withArgs(
              actionHash,
              "MINTING_CAP_INCREASE",
              timeLockedAdmin.address,
              currentBlock.timestamp
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
              timeLockedAdmin.address,
              currentBlock.timestamp
            )
        })
      })

      context("when delay period has not elapsed", () => {
        it("should revert", async () => {
          await expect(
            qcManager
              .connect(timeLockedAdmin)
              .executeMintingCapIncrease(qcAddress.address, newCap)
          ).to.be.revertedWith("DelayPeriodNotElapsed")
        })
      })
    })

    describe("emergencyPauseQC", () => {
      const emergencyReason = ethers.utils.id("SECURITY_BREACH")

      beforeEach(async () => {
        mockQcData.isQCRegistered.returns(true)
        mockQcData.getQCStatus.returns(0) // Active
      })

      context("when called by arbiter", () => {
        let tx: any

        beforeEach(async () => {
          tx = await qcManager
            .connect(watchdog)
            .emergencyPauseQC(qcAddress.address, emergencyReason)
        })

        it("should call QCData setQCStatus to UnderReview", async () => {
          expect(mockQcData.setQCStatus).to.have.been.calledWith(
            qcAddress.address,
            1, // UnderReview
            emergencyReason
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
              emergencyReason,
              watchdog.address,
              currentBlock.timestamp
            )
        })

        it("should emit QCEmergencyPaused event", async () => {
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
          await expect(tx)
            .to.emit(qcManager, "QCEmergencyPaused")
            .withArgs(
              qcAddress.address,
              emergencyReason,
              watchdog.address,
              currentBlock.timestamp
            )
        })
      })

      context("when called with invalid parameters", () => {
        it("should revert with zero address", async () => {
          await expect(
            qcManager
              .connect(watchdog)
              .emergencyPauseQC(ethers.constants.AddressZero, emergencyReason)
          ).to.be.revertedWith("InvalidQCAddress")
        })

        it("should revert with empty reason", async () => {
          await expect(
            qcManager
              .connect(watchdog)
              .emergencyPauseQC(qcAddress.address, ethers.constants.HashZero)
          ).to.be.revertedWith("ReasonRequired")
        })

        it("should revert when QC not registered", async () => {
          mockQcData.isQCRegistered.returns(false)
          await expect(
            qcManager
              .connect(watchdog)
              .emergencyPauseQC(qcAddress.address, emergencyReason)
          ).to.be.revertedWith("QCNotRegistered")
        })
      })

      context("when QC is already Revoked", () => {
        beforeEach(async () => {
          mockQcData.getQCStatus.returns(2) // Revoked
        })

        it("should not change status", async () => {
          await qcManager
            .connect(watchdog)
            .emergencyPauseQC(qcAddress.address, emergencyReason)

          // Status change should not be called for Revoked QCs
          expect(mockQcData.setQCStatus).to.not.have.been.called
        })
      })

      context("when called by non-arbiter", () => {
        it("should revert", async () => {
          await expect(
            qcManager
              .connect(thirdParty)
              .emergencyPauseQC(qcAddress.address, emergencyReason)
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
              .emergencyPauseQC(qcAddress.address, emergencyReason)
          ).to.be.revertedWith("Function is paused")
        })
      })
    })

    describe("Governance Workflow Integration", () => {
      const newMintingCap = ethers.utils.parseEther("15000")

      it("should complete full QC onboarding workflow", async () => {
        // Step 1: Queue QC onboarding
        const queueTx = await qcManager
          .connect(timeLockedAdmin)
          .queueQCOnboarding(qcAddress.address, newMintingCap)

        await expect(queueTx).to.emit(qcManager, "GovernanceActionQueued")

        // Step 2: Fast forward time
        await network.provider.send("evm_increaseTime", [GOVERNANCE_DELAY + 1])
        await network.provider.send("evm_mine")

        // Step 3: Execute QC onboarding
        const executeTx = await qcManager
          .connect(timeLockedAdmin)
          .executeQCOnboarding(qcAddress.address, newMintingCap)

        await expect(executeTx)
          .to.emit(qcManager, "GovernanceActionExecuted")
          .and.to.emit(qcManager, "QCOnboarded")
          .and.to.emit(qcManager, "QCRegistrationInitiated")
      })

      it("should complete full minting cap increase workflow", async () => {
        const currentCap = ethers.utils.parseEther("5000")
        const increasedCap = ethers.utils.parseEther("10000")

        mockQcData.isQCRegistered.returns(true)
        mockQcData.getMaxMintingCapacity.returns(currentCap)

        // Step 1: Queue minting cap increase
        const queueTx = await qcManager
          .connect(timeLockedAdmin)
          .queueMintingCapIncrease(qcAddress.address, increasedCap)

        await expect(queueTx).to.emit(qcManager, "GovernanceActionQueued")

        // Step 2: Fast forward time
        await network.provider.send("evm_increaseTime", [GOVERNANCE_DELAY + 1])
        await network.provider.send("evm_mine")

        // Step 3: Execute minting cap increase
        const executeTx = await qcManager
          .connect(timeLockedAdmin)
          .executeMintingCapIncrease(qcAddress.address, increasedCap)

        const executeBlock = await ethers.provider.getBlock(
          executeTx.blockNumber
        )
        await expect(executeTx)
          .to.emit(qcManager, "GovernanceActionExecuted")
          .and.to.emit(qcManager, "MintingCapIncreased")
          .withArgs(
            qcAddress.address,
            currentCap,
            increasedCap,
            timeLockedAdmin.address,
            executeBlock.timestamp
          )
      })

      it("should allow emergency pause without delay", async () => {
        const emergencyReason = ethers.utils.id("CRITICAL_SECURITY_ISSUE")
        mockQcData.isQCRegistered.returns(true)
        mockQcData.getQCStatus.returns(0) // Active

        // Emergency pause should work immediately
        const emergencyTx = await qcManager
          .connect(watchdog)
          .emergencyPauseQC(qcAddress.address, emergencyReason)

        const emergencyBlock = await ethers.provider.getBlock(
          emergencyTx.blockNumber
        )
        await expect(emergencyTx)
          .to.emit(qcManager, "QCEmergencyPaused")
          .withArgs(
            qcAddress.address,
            emergencyReason,
            watchdog.address,
            emergencyBlock.timestamp
          )
      })
    })
  })
})
