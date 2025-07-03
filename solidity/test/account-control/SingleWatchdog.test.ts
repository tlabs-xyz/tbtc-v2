import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  SingleWatchdog,
  ProtocolRegistry,
  QCManager,
  QCReserveLedger,
  QCRedeemer,
  QCData,
  SPVValidator,
} from "../../typechain"
import { createMockSpvData } from "./AccountControlTestHelpers"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("SingleWatchdog", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let qcAddress: SignerWithAddress
  let thirdParty: SignerWithAddress

  let singleWatchdog: SingleWatchdog
  let protocolRegistry: ProtocolRegistry
  let mockQcManager: FakeContract<QCManager>
  let mockQcReserveLedger: FakeContract<QCReserveLedger>
  let mockQcRedeemer: FakeContract<QCRedeemer>
  let mockQcData: FakeContract<QCData>
  let mockSpvValidator: FakeContract<SPVValidator>

  // Service keys
  let QC_MANAGER_KEY: string
  let QC_RESERVE_LEDGER_KEY: string
  let QC_REDEEMER_KEY: string
  let QC_DATA_KEY: string
  let SPV_VALIDATOR_KEY: string

  // Roles
  let WATCHDOG_OPERATOR_ROLE: string

  // Test data
  const reserveBalance = ethers.utils.parseEther("10")
  const btcAddress = "bc1qtest123456789"
  const condition = "Regular attestation"
  const defaultReason = "Redemption timeout exceeded"
  const defaultReasonBytes32 = ethers.utils.formatBytes32String(defaultReason)
  const challengeHash = ethers.utils.id("challenge")

  // Create properly encoded SPV proof data for new implementation
  const createEncodedSpvProof = () => {
    const mockSpvData = createMockSpvData()
    return ethers.utils.defaultAbiCoder.encode(
      [
        "tuple(bytes4 version, bytes inputVector, bytes outputVector, bytes4 locktime)",
        "tuple(bytes merkleProof, uint256 txIndexInBlock, bytes bitcoinHeaders, bytes32 coinbasePreimage, bytes coinbaseProof)"
      ],
      [mockSpvData.txInfo, mockSpvData.proof]
    )
  }

  before(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;[deployer, governance, qcAddress, thirdParty] = await ethers.getSigners()

    // Generate service keys
    QC_MANAGER_KEY = ethers.utils.id("QC_MANAGER")
    QC_RESERVE_LEDGER_KEY = ethers.utils.id("QC_RESERVE_LEDGER")
    QC_REDEEMER_KEY = ethers.utils.id("QC_REDEEMER")
    QC_DATA_KEY = ethers.utils.id("QC_DATA")
    SPV_VALIDATOR_KEY = ethers.utils.id("SPV_VALIDATOR")

    // Generate role hashes
    WATCHDOG_OPERATOR_ROLE = ethers.utils.id("WATCHDOG_OPERATOR_ROLE")
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy ProtocolRegistry
    const ProtocolRegistryFactory = await ethers.getContractFactory(
      "ProtocolRegistry"
    )
    protocolRegistry = await ProtocolRegistryFactory.deploy()
    await protocolRegistry.deployed()

    // Deploy SingleWatchdog
    const SingleWatchdogFactory = await ethers.getContractFactory(
      "SingleWatchdog"
    )
    singleWatchdog = await SingleWatchdogFactory.deploy(
      protocolRegistry.address
    )
    await singleWatchdog.deployed()

    // Create mock contracts
    mockQcManager = await smock.fake<QCManager>("QCManager")
    mockQcReserveLedger = await smock.fake<QCReserveLedger>("QCReserveLedger")
    mockQcRedeemer = await smock.fake<QCRedeemer>("QCRedeemer")
    mockQcData = await smock.fake<QCData>("QCData")
    mockSpvValidator = await smock.fake<SPVValidator>("SPVValidator")

    // Register services
    await protocolRegistry.setService(QC_MANAGER_KEY, mockQcManager.address)
    await protocolRegistry.setService(
      QC_RESERVE_LEDGER_KEY,
      mockQcReserveLedger.address
    )
    await protocolRegistry.setService(QC_REDEEMER_KEY, mockQcRedeemer.address)
    await protocolRegistry.setService(QC_DATA_KEY, mockQcData.address)
    await protocolRegistry.setService(SPV_VALIDATOR_KEY, mockSpvValidator.address)

    // Grant roles
    await singleWatchdog.grantRole(WATCHDOG_OPERATOR_ROLE, deployer.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment", () => {
    it("should set correct protocol registry", async () => {
      expect(await singleWatchdog.protocolRegistry()).to.equal(
        protocolRegistry.address
      )
    })

    it("should grant deployer all Watchdog roles", async () => {
      const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
      const WATCHDOG_OPERATOR_ROLE =
        await singleWatchdog.WATCHDOG_OPERATOR_ROLE()
      expect(await singleWatchdog.hasRole(DEFAULT_ADMIN_ROLE, deployer.address))
        .to.be.true
      expect(
        await singleWatchdog.hasRole(WATCHDOG_OPERATOR_ROLE, deployer.address)
      ).to.be.true
    })

    it("should have correct role constants", async () => {
      expect(await singleWatchdog.WATCHDOG_OPERATOR_ROLE()).to.equal(
        WATCHDOG_OPERATOR_ROLE
      )
    })

    it("should have correct service key constants", async () => {
      expect(await singleWatchdog.QC_MANAGER_KEY()).to.equal(QC_MANAGER_KEY)
      expect(await singleWatchdog.QC_RESERVE_LEDGER_KEY()).to.equal(
        QC_RESERVE_LEDGER_KEY
      )
      expect(await singleWatchdog.QC_REDEEMER_KEY()).to.equal(QC_REDEEMER_KEY)
    })
  })

  describe("attestReserves", () => {
    context("when called by an operator", () => {
      it("should submit reserve attestation successfully", async () => {
        const tx = await singleWatchdog.attestReserves(
          qcAddress.address,
          reserveBalance
        )

        expect(
          mockQcReserveLedger.submitReserveAttestation
        ).to.have.been.calledWith(qcAddress.address, reserveBalance)

        await expect(tx)
          .to.emit(singleWatchdog, "WatchdogReserveAttestation")
          .withArgs(
            qcAddress.address,
            reserveBalance,
            0, // oldBalance
            deployer.address,
            (
              await ethers.provider.getBlock(tx.blockNumber)
            ).timestamp
          )
      })

      it("should revert with zero QC address", async () => {
        await expect(
          singleWatchdog.attestReserves(
            ethers.constants.AddressZero,
            reserveBalance
          )
        ).to.be.revertedWith("InvalidQCAddress")
      })
    })

    context("when called by a non-operator", () => {
      it("should revert", async () => {
        await expect(
          singleWatchdog
            .connect(thirdParty)
            .attestReserves(qcAddress.address, reserveBalance)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${WATCHDOG_OPERATOR_ROLE}`
        )
      })
    })
  })

  describe("registerWalletWithProof", () => {
    context("when called by an operator", () => {
      it("should register wallet successfully", async () => {
        // Ensure SPV validator returns true for this test
        mockSpvValidator.verifyWalletControl.returns(true)
        
        const encodedSpvProof = createEncodedSpvProof()
        
        const tx = await singleWatchdog.registerWalletWithProof(
          qcAddress.address,
          btcAddress,
          encodedSpvProof,
          challengeHash
        )

        // Verify SPV validation was called (with all 5 parameters)
        expect(mockSpvValidator.verifyWalletControl).to.have.been.called

        expect(mockQcManager.registerWallet).to.have.been.called
        const [qc, wallet, challenge, txInfo, proof] =
          mockQcManager.registerWallet.getCall(0).args
        expect(qc).to.equal(qcAddress.address)
        expect(wallet).to.equal(btcAddress)
        expect(challenge).to.equal(challengeHash)
        
        await expect(tx)
          .to.emit(singleWatchdog, "WatchdogWalletRegistration")
          .withArgs(qcAddress.address, btcAddress, challengeHash)
      })

      it("should revert with empty btc address", async () => {
        const encodedSpvProof = createEncodedSpvProof()
        
        await expect(
          singleWatchdog.registerWalletWithProof(
            qcAddress.address,
            "",
            encodedSpvProof,
            challengeHash
          )
        ).to.be.revertedWith("InvalidWalletAddress")
      })

      it("should revert when SPV validator is not available", async () => {
        const encodedSpvProof = createEncodedSpvProof()
        
        // Deploy a new registry without SPV validator to test the hasService check
        const ProtocolRegistryFactory = await ethers.getContractFactory(
          "ProtocolRegistry"
        )
        const newRegistry = await ProtocolRegistryFactory.deploy()
        
        const SingleWatchdogFactory = await ethers.getContractFactory(
          "SingleWatchdog"
        )
        const newWatchdog = await SingleWatchdogFactory.deploy(
          newRegistry.address
        )
        
        await newWatchdog.grantRole(WATCHDOG_OPERATOR_ROLE, deployer.address)
        
        await expect(
          newWatchdog.registerWalletWithProof(
            qcAddress.address,
            btcAddress,
            encodedSpvProof,
            challengeHash
          )
        ).to.be.revertedWith("ServiceNotRegistered")
      })

      it("should revert when SPV verification fails", async () => {
        const encodedSpvProof = createEncodedSpvProof()
        
        // Configure SPV validator to return false (verification failed)
        mockSpvValidator.verifyWalletControl.returns(false)
        
        await expect(
          singleWatchdog.registerWalletWithProof(
            qcAddress.address,
            btcAddress,
            encodedSpvProof,
            challengeHash
          )
        ).to.be.revertedWith("SPVVerificationFailed")
      })

      it("should revert with invalid SPV proof data", async () => {
        const invalidProofData = ethers.utils.toUtf8Bytes("invalid_proof_data")
        
        await expect(
          singleWatchdog.registerWalletWithProof(
            qcAddress.address,
            btcAddress,
            invalidProofData,
            challengeHash
          )
        ).to.be.revertedWith("InvalidSPVProofData")
      })
    })
  })

  describe("setQCStatus", () => {
    context("when called by an operator", () => {
      it("should set QC status successfully", async () => {
        const reason = ethers.utils.formatBytes32String("Under review")
        const tx = await singleWatchdog.setQCStatus(
          qcAddress.address,
          1,
          reason
        ) // UnderReview

        expect(mockQcManager.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          1, // UnderReview enum
          reason
        )

        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
        await expect(tx)
          .to.emit(singleWatchdog, "WatchdogQCStatusChange")
          .withArgs(
            qcAddress.address,
            1,
            reason,
            deployer.address,
            currentBlock.timestamp
          )
      })
    })
  })

  describe("verifyQCSolvency", () => {
    context("when called by an operator", () => {
      it("should verify solvency", async () => {
        mockQcManager.verifyQCSolvency.returns(true)
        const isSolvent = await singleWatchdog.callStatic.verifyQCSolvency(
          qcAddress.address
        )
        expect(isSolvent).to.be.true
      })
    })
  })

  describe("recordRedemptionFulfillment", () => {
    context("when called by an operator", () => {
      it("should record redemption fulfillment", async () => {
        const redemptionId = ethers.utils.id("redemption-1")
        const mockSpvData = createMockSpvData()
        const userBtcAddress = "bc1qtest123456789"
        const expectedAmount = 100000

        const tx = await singleWatchdog.recordRedemptionFulfillment(
          redemptionId,
          userBtcAddress,
          expectedAmount,
          mockSpvData.txInfo,
          mockSpvData.proof
        )

        expect(mockQcRedeemer.recordRedemptionFulfillment).to.have.been
          .calledOnce

        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
        await expect(tx)
          .to.emit(singleWatchdog, "WatchdogRedemptionAction")
          .withArgs(
            redemptionId,
            "FULFILLED",
            ethers.constants.HashZero,
            deployer.address,
            currentBlock.timestamp
          )
      })
    })
  })

  describe("flagRedemptionDefault", () => {
    context("when called by an operator", () => {
      it("should flag redemption default", async () => {
        const redemptionId = ethers.utils.id("redemption-1")
        const reason = ethers.utils.formatBytes32String("Timeout")
        const tx = await singleWatchdog.flagRedemptionDefault(
          redemptionId,
          reason
        )

        expect(mockQcRedeemer.flagDefaultedRedemption).to.have.been.calledWith(
          redemptionId,
          reason
        )

        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
        await expect(tx)
          .to.emit(singleWatchdog, "WatchdogRedemptionAction")
          .withArgs(
            redemptionId,
            "DEFAULTED",
            reason,
            deployer.address,
            currentBlock.timestamp
          )
      })
    })
  })

  describe("changeQCStatus", () => {
    context("when called by an operator", () => {
      it("should change QC status", async () => {
        const reason = ethers.utils.formatBytes32String("Revoked")
        // Enum QCStatus { Active, UnderReview, Revoked }
        const tx = await singleWatchdog.changeQCStatus(
          qcAddress.address,
          2,
          reason
        )

        expect(mockQcManager.setQCStatus).to.have.been.calledWith(
          qcAddress.address,
          2,
          reason
        )

        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
        await expect(tx)
          .to.emit(singleWatchdog, "WatchdogQCStatusChange")
          .withArgs(
            qcAddress.address,
            2,
            reason,
            deployer.address,
            currentBlock.timestamp
          )
      })
    })
  })

  describe("verifySolvencyAndAct", () => {
    context("when called by an operator", () => {
      it("should do nothing if solvent", async () => {
        mockQcManager.verifyQCSolvency.returns(true)
        const tx = await singleWatchdog.verifySolvencyAndAct(qcAddress.address)
        expect(mockQcManager.setQCStatus).to.not.have.been.called
        await expect(tx).to.not.emit(singleWatchdog, "WatchdogQCStatusChange")
      })

      it("should emit event if insolvent", async () => {
        mockQcManager.verifyQCSolvency.returns(false)
        const tx = await singleWatchdog.verifySolvencyAndAct(qcAddress.address)
        // Enum QCStatus { Active, UnderReview, Revoked }
        const currentBlock = await ethers.provider.getBlock(tx.blockNumber)
        await expect(tx)
          .to.emit(singleWatchdog, "WatchdogQCStatusChange")
          .withArgs(
            qcAddress.address,
            1,
            ethers.utils.formatBytes32String("INSOLVENCY_DETECTED"),
            deployer.address,
            currentBlock.timestamp
          )
      })
    })
  })

  describe("Access Control Management", () => {
    it("should allow admin to grant roles to other accounts", async () => {
      await singleWatchdog.grantRole(WATCHDOG_OPERATOR_ROLE, thirdParty.address)
      expect(
        await singleWatchdog.hasRole(WATCHDOG_OPERATOR_ROLE, thirdParty.address)
      ).to.be.true

      // Third party should now be able to attest reserves
      await singleWatchdog
        .connect(thirdParty)
        .attestReserves(qcAddress.address, reserveBalance)
      expect(
        mockQcReserveLedger.submitReserveAttestation
      ).to.have.been.calledWith(qcAddress.address, reserveBalance)
    })

    it("should allow admin to revoke roles from accounts", async () => {
      await singleWatchdog.revokeRole(WATCHDOG_OPERATOR_ROLE, deployer.address)
      expect(
        await singleWatchdog.hasRole(WATCHDOG_OPERATOR_ROLE, deployer.address)
      ).to.be.false

      await expect(
        singleWatchdog.attestReserves(qcAddress.address, reserveBalance)
      ).to.be.revertedWith(
        `AccessControl: account ${deployer.address.toLowerCase()} is missing role ${WATCHDOG_OPERATOR_ROLE}`
      )
    })
  })

  describe("Integration Scenarios", () => {
    context("when services are updated in registry", () => {
      let newQcManager: FakeContract<QCManager>
      let newQcReserveLedger: FakeContract<QCReserveLedger>

      beforeEach(async () => {
        newQcManager = await smock.fake<QCManager>("QCManager")
        newQcReserveLedger = await smock.fake<QCReserveLedger>(
          "QCReserveLedger"
        )

        // Update services in registry
        await protocolRegistry.setService(QC_MANAGER_KEY, newQcManager.address)
        await protocolRegistry.setService(
          QC_RESERVE_LEDGER_KEY,
          newQcReserveLedger.address
        )
      })

      it("should use updated services", async () => {
        // Ensure SPV validator returns true for this test
        mockSpvValidator.verifyWalletControl.returns(true)
        
        await singleWatchdog.attestReserves(qcAddress.address, reserveBalance)
        const encodedSpvProof = createEncodedSpvProof()
        
        await singleWatchdog.registerWalletWithProof(
          qcAddress.address,
          btcAddress,
          encodedSpvProof,
          challengeHash
        )

        expect(
          newQcReserveLedger.submitReserveAttestation
        ).to.have.been.calledWith(qcAddress.address, reserveBalance)
        expect(newQcManager.registerWallet).to.have.been.called
        const [qc, wallet, challenge, txInfo, proof] =
          newQcManager.registerWallet.getCall(0).args
        expect(qc).to.equal(qcAddress.address)
        expect(wallet).to.equal(btcAddress)
        expect(challenge).to.equal(challengeHash)

        // Old services should not be called
        expect(mockQcReserveLedger.submitReserveAttestation).to.not.have.been
          .called
        expect(mockQcManager.registerWallet).to.not.have.been.called
      })
    })
  })

  describe("Edge Cases", () => {
    context("error propagation", () => {
      it("should propagate QC Manager errors", async () => {
        mockQcManager.registerWallet.reverts("QC Manager error")
        const encodedSpvProof = createEncodedSpvProof()

        await expect(
          singleWatchdog.registerWalletWithProof(
            qcAddress.address,
            btcAddress,
            encodedSpvProof,
            challengeHash
          )
        ).to.be.reverted
      })

      it("should propagate QC Reserve Ledger errors", async () => {
        mockQcReserveLedger.submitReserveAttestation.reverts(
          "Reserve Ledger error"
        )

        await expect(
          singleWatchdog.attestReserves(qcAddress.address, reserveBalance)
        ).to.be.reverted
      })
    })
  })
})
