import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  ProtocolRegistry,
  QCManager,
  BasicRedemptionPolicy,
  SPVValidator,
  QCData,
  SystemState,
  QCReserveLedger,
  TBTC,
} from "../../typechain"

chai.use(smock.matchers)
const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("Service Lookup Error Handling", () => {
  let deployer: SignerWithAddress
  let watchdog: SignerWithAddress
  let user: SignerWithAddress
  let qcAddress: SignerWithAddress

  let protocolRegistry: ProtocolRegistry
  let qcManager: QCManager
  let redemptionPolicy: BasicRedemptionPolicy

  let mockSpvValidator: FakeContract<SPVValidator>
  let mockQcData: FakeContract<QCData>
  let mockSystemState: FakeContract<SystemState>
  let mockReserveLedger: FakeContract<QCReserveLedger>
  let mockTbtc: FakeContract<TBTC>

  const QC_MANAGER_KEY = ethers.utils.id("QC_MANAGER")
  const QC_DATA_KEY = ethers.utils.id("QC_DATA")
  const SYSTEM_STATE_KEY = ethers.utils.id("SYSTEM_STATE")
  const SPV_VALIDATOR_KEY = ethers.utils.id("SPV_VALIDATOR")
  const QC_RESERVE_LEDGER_KEY = ethers.utils.id("QC_RESERVE_LEDGER")
  const TBTC_TOKEN_KEY = ethers.utils.id("TBTC_TOKEN")

  beforeEach(async () => {
    ;[deployer, watchdog, user, qcAddress] = await ethers.getSigners()

    // Deploy Protocol Registry
    const ProtocolRegistryFactory = await ethers.getContractFactory(
      "ProtocolRegistry"
    )
    protocolRegistry = await ProtocolRegistryFactory.deploy()
    await protocolRegistry.deployed()

    // Deploy mock contracts
    mockSpvValidator = await smock.fake<SPVValidator>("SPVValidator")
    mockQcData = await smock.fake<QCData>("QCData")
    mockSystemState = await smock.fake<SystemState>("SystemState")
    mockReserveLedger = await smock.fake<QCReserveLedger>("QCReserveLedger")
    mockTbtc = await smock.fake<TBTC>("TBTC")

    // Register services
    await protocolRegistry.setService(QC_DATA_KEY, mockQcData.address)
    await protocolRegistry.setService(SYSTEM_STATE_KEY, mockSystemState.address)
    await protocolRegistry.setService(TBTC_TOKEN_KEY, mockTbtc.address)

    // Deploy QCManager
    const QCManagerFactory = await ethers.getContractFactory("QCManager")
    qcManager = await QCManagerFactory.deploy(protocolRegistry.address)
    await qcManager.deployed()

    // Deploy BasicRedemptionPolicy
    const BasicRedemptionPolicyFactory = await ethers.getContractFactory(
      "BasicRedemptionPolicy"
    )
    redemptionPolicy = await BasicRedemptionPolicyFactory.deploy(
      protocolRegistry.address
    )
    await redemptionPolicy.deployed()

    // Setup roles
    await qcManager.grantRole(
      await qcManager.REGISTRAR_ROLE(),
      watchdog.address
    )
    await qcManager.grantRole(await qcManager.ARBITER_ROLE(), watchdog.address)
    await redemptionPolicy.grantRole(
      await redemptionPolicy.REDEEMER_ROLE(),
      user.address
    )

    // Setup default mocks
    mockSystemState.isFunctionPaused.returns(false)
    mockSystemState.minMintAmount.returns(ethers.utils.parseEther("0.01"))
    mockSystemState.redemptionTimeout.returns(86400) // 1 day
    mockSystemState.isRedemptionPaused.returns(false)
    mockQcData.isQCRegistered.returns(true)
    mockQcData.getQCStatus.returns(0) // Active
    mockTbtc.balanceOf.returns(ethers.utils.parseEther("1"))
  })

  describe("SPV Validator Service Not Available", () => {
    describe("QCManager - registerWallet", () => {
      it("should revert with SPVValidatorNotAvailable when service is not registered", async () => {
        // SPV validator service is not registered

        const btcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
        const challenge = ethers.utils.id("challenge")
        const testTxInfo = {
          version: "0x01000000",
          inputVector: "0x00",
          outputVector: "0x00",
          locktime: "0x00000000",
        }
        const testProof = {
          merkleProof: "0x00",
          txIndexInBlock: 0,
          bitcoinHeaders: "0x00",
          coinbasePreimage: ethers.constants.HashZero,
          coinbaseProof: "0x00",
        }

        await expect(
          qcManager
            .connect(watchdog)
            .registerWallet(
              qcAddress.address,
              btcAddress,
              challenge,
              testTxInfo,
              testProof
            )
        ).to.be.revertedWith("SPVValidatorNotAvailable")
      })
    })

    describe("BasicRedemptionPolicy - recordFulfillment", () => {
      it("should revert with SPVValidatorNotAvailable when service is not registered", async () => {
        // SPV validator service is not registered

        const redemptionId = ethers.utils.id("redemption1")
        const userBtcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
        const expectedAmount = 100000000 // 1 BTC in satoshis
        const testTxInfo = {
          version: "0x01000000",
          inputVector: "0x00",
          outputVector: "0x00",
          locktime: "0x00000000",
        }
        const testProof = {
          merkleProof: "0x00",
          txIndexInBlock: 0,
          bitcoinHeaders: "0x00",
          coinbasePreimage: ethers.constants.HashZero,
          coinbaseProof: "0x00",
        }

        // First request a redemption to make it valid
        await redemptionPolicy
          .connect(user)
          .requestRedemption(
            redemptionId,
            qcAddress.address,
            user.address,
            ethers.utils.parseEther("1"),
            userBtcAddress
          )

        await expect(
          redemptionPolicy.recordFulfillment(
            redemptionId,
            userBtcAddress,
            expectedAmount,
            testTxInfo,
            testProof
          )
        ).to.be.revertedWith("SPVValidatorNotAvailable")
      })
    })
  })

  describe("Reserve Ledger Service Not Available", () => {
    describe("QCManager - getAvailableMintingCapacity", () => {
      it("should revert with QCReserveLedgerNotAvailable when service is not registered", async () => {
        // Reserve ledger service is not registered

        await expect(
          qcManager.getAvailableMintingCapacity(qcAddress.address)
        ).to.be.revertedWith("QCReserveLedgerNotAvailable")
      })
    })

    describe("QCManager - finalizeWalletDeRegistration", () => {
      it("should revert with QCReserveLedgerNotAvailable when service is not registered", async () => {
        // Reserve ledger service is not registered

        // Setup wallet registration first
        mockQcData.getWalletOwner.returns(qcAddress.address)
        mockQcData.getWalletStatus.returns(2) // PendingDeRegistration
        mockQcData.getQCMintedAmount.returns(ethers.utils.parseEther("50"))

        const btcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
        const newReserveBalance = ethers.utils.parseEther("100")

        await expect(
          qcManager
            .connect(watchdog)
            .finalizeWalletDeRegistration(btcAddress, newReserveBalance)
        ).to.be.revertedWith("QCReserveLedgerNotAvailable")
      })
    })
  })

  describe("Service Available - Normal Operation", () => {
    beforeEach(async () => {
      // Register SPV validator and reserve ledger services
      await protocolRegistry.setService(
        SPV_VALIDATOR_KEY,
        mockSpvValidator.address
      )
      await protocolRegistry.setService(
        QC_RESERVE_LEDGER_KEY,
        mockReserveLedger.address
      )

      // Setup SPV validator mock
      mockSpvValidator.verifyWalletControl.returns(true)
      mockSpvValidator.verifyRedemptionFulfillment.returns(true)

      // Setup reserve ledger mock
      mockReserveLedger.getReserveBalanceAndStaleness.returns([
        ethers.utils.parseEther("100"),
        false,
      ])
    })

    it("should work normally when all services are available", async () => {
      // Test wallet registration
      const btcAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
      const challenge = ethers.utils.id("challenge")
      const testTxInfo = {
        version: "0x01000000",
        inputVector: "0x00",
        outputVector: "0x00",
        locktime: "0x00000000",
      }
      const testProof = {
        merkleProof: "0x00",
        txIndexInBlock: 0,
        bitcoinHeaders: "0x00",
        coinbasePreimage: ethers.constants.HashZero,
        coinbaseProof: "0x00",
      }

      // This should succeed
      await expect(
        qcManager
          .connect(watchdog)
          .registerWallet(
            qcAddress.address,
            btcAddress,
            challenge,
            testTxInfo,
            testProof
          )
      ).to.emit(qcManager, "WalletRegistrationRequested")

      // Test available minting capacity
      const capacity = await qcManager.getAvailableMintingCapacity(
        qcAddress.address
      )
      expect(capacity).to.equal(ethers.utils.parseEther("100"))
    })
  })
})
