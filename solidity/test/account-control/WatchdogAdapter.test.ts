import { ethers, helpers, waffle } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { Contract, ContractFactory, BigNumber } from "ethers"
import { smock } from "@defi-wonderland/smock"
import type { FakeContract } from "@defi-wonderland/smock"
import { QCStatusStruct } from "../../typechain/QCData"

const { loadFixture } = waffle
const { deployMockContract } = waffle

describe("WatchdogAdapter", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let nonWatchdog: SignerWithAddress

  let adapter: Contract
  let consensus: FakeContract<Contract>
  let protocolRegistry: FakeContract<Contract>
  let qcManager: FakeContract<Contract>
  let qcData: FakeContract<Contract>
  let qcReserveLedger: FakeContract<Contract>
  let qcRedeemer: FakeContract<Contract>
  let spvValidator: FakeContract<Contract>

  // Role constants
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
  const WATCHDOG_OPERATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("WATCHDOG_OPERATOR_ROLE"))

  // Service key constants
  const QC_MANAGER_KEY = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_MANAGER"))
  const QC_DATA_KEY = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_DATA"))
  const QC_RESERVE_LEDGER_KEY = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_RESERVE_LEDGER"))
  const QC_REDEEMER_KEY = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_REDEEMER"))
  const SPV_VALIDATOR_KEY = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("SPV_VALIDATOR"))
  const CONSENSUS_KEY = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("WATCHDOG_CONSENSUS"))

  // Operation type constants
  const RESERVE_ATTESTATION = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("RESERVE_ATTESTATION"))
  const WALLET_REGISTRATION = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("WALLET_REGISTRATION"))
  const STATUS_CHANGE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("STATUS_CHANGE"))
  const REDEMPTION_FULFILLMENT = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("REDEMPTION_FULFILLMENT"))

  // QC Status enum
  enum QCStatus {
    Active = 0,
    Suspended = 1,
    Terminated = 2
  }

  // Sample data
  const sampleQC = "0x1234567890123456789012345678901234567890"
  const sampleBtcAddress = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
  const sampleChallengeHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("challenge"))
  const sampleRedemptionId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("redemption123"))

  async function fixture() {
    ;[deployer, governance, watchdog1, watchdog2, watchdog3, nonWatchdog] = 
      await ethers.getSigners()

    // Deploy mocks
    protocolRegistry = await smock.fake("ProtocolRegistry")
    consensus = await smock.fake("IOptimisticWatchdogConsensus")
    qcManager = await smock.fake("QCManager")
    qcData = await smock.fake("QCData")
    qcReserveLedger = await smock.fake("QCReserveLedger")
    qcRedeemer = await smock.fake("QCRedeemer")
    spvValidator = await smock.fake("ISPVValidator")

    // Set up protocol registry responses
    protocolRegistry.getService.whenCalledWith(QC_MANAGER_KEY).returns(qcManager.address)
    protocolRegistry.getService.whenCalledWith(QC_DATA_KEY).returns(qcData.address)
    protocolRegistry.getService.whenCalledWith(QC_RESERVE_LEDGER_KEY).returns(qcReserveLedger.address)
    protocolRegistry.getService.whenCalledWith(QC_REDEEMER_KEY).returns(qcRedeemer.address)
    protocolRegistry.getService.whenCalledWith(SPV_VALIDATOR_KEY).returns(spvValidator.address)
    protocolRegistry.getService.whenCalledWith(CONSENSUS_KEY).returns(consensus.address)
    
    protocolRegistry.hasService.whenCalledWith(QC_MANAGER_KEY).returns(true)
    protocolRegistry.hasService.whenCalledWith(QC_DATA_KEY).returns(true)
    protocolRegistry.hasService.whenCalledWith(QC_RESERVE_LEDGER_KEY).returns(true)
    protocolRegistry.hasService.whenCalledWith(QC_REDEEMER_KEY).returns(true)
    protocolRegistry.hasService.whenCalledWith(SPV_VALIDATOR_KEY).returns(true)
    protocolRegistry.hasService.whenCalledWith(CONSENSUS_KEY).returns(true)

    // Set up consensus operation types
    consensus.RESERVE_ATTESTATION.returns(RESERVE_ATTESTATION)
    consensus.WALLET_REGISTRATION.returns(WALLET_REGISTRATION)
    consensus.STATUS_CHANGE.returns(STATUS_CHANGE)
    consensus.REDEMPTION_FULFILLMENT.returns(REDEMPTION_FULFILLMENT)

    // Set up role constants on mocks
    qcReserveLedger.ATTESTER_ROLE.returns(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ATTESTER_ROLE")))
    qcManager.REGISTRAR_ROLE.returns(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("REGISTRAR_ROLE")))
    qcManager.ARBITER_ROLE.returns(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ARBITER_ROLE")))
    qcRedeemer.ARBITER_ROLE.returns(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ARBITER_ROLE")))

    // Deploy WatchdogAdapter
    const WatchdogAdapter = await ethers.getContractFactory("WatchdogAdapter")
    adapter = await WatchdogAdapter.deploy(protocolRegistry.address, consensus.address)
    await adapter.deployed()

    // Grant roles
    await adapter.grantRole(DEFAULT_ADMIN_ROLE, governance.address)
    await adapter.grantRole(WATCHDOG_OPERATOR_ROLE, watchdog1.address)
    await adapter.grantRole(WATCHDOG_OPERATOR_ROLE, watchdog2.address)
    await adapter.grantRole(WATCHDOG_OPERATOR_ROLE, watchdog3.address)

    // Set up consensus to recognize watchdogs
    consensus.isActiveWatchdog.whenCalledWith(watchdog1.address).returns(true)
    consensus.isActiveWatchdog.whenCalledWith(watchdog2.address).returns(true)
    consensus.isActiveWatchdog.whenCalledWith(watchdog3.address).returns(false) // Not in consensus
    consensus.isActiveWatchdog.whenCalledWith(nonWatchdog.address).returns(false)

    // Default mock returns
    consensus.submitOptimisticOperation.returns(ethers.utils.formatBytes32String("op123"))
    spvValidator.verifyWalletControl.returns(true)
    
    return {
      adapter,
      consensus,
      protocolRegistry,
      qcManager,
      qcData,
      qcReserveLedger,
      qcRedeemer,
      spvValidator,
      deployer,
      governance,
      watchdog1,
      watchdog2,
      watchdog3,
      nonWatchdog,
    }
  }

  beforeEach(async () => {
    const loadedFixture = await loadFixture(fixture)
    adapter = loadedFixture.adapter
    consensus = loadedFixture.consensus
    protocolRegistry = loadedFixture.protocolRegistry
    qcManager = loadedFixture.qcManager
    qcData = loadedFixture.qcData
    qcReserveLedger = loadedFixture.qcReserveLedger
    qcRedeemer = loadedFixture.qcRedeemer
    spvValidator = loadedFixture.spvValidator
    deployer = loadedFixture.deployer
    governance = loadedFixture.governance
    watchdog1 = loadedFixture.watchdog1
    watchdog2 = loadedFixture.watchdog2
    watchdog3 = loadedFixture.watchdog3
    nonWatchdog = loadedFixture.nonWatchdog
  })

  describe("Deployment", () => {
    it("should initialize with correct parameters", async () => {
      expect(await adapter.protocolRegistry()).to.equal(protocolRegistry.address)
      expect(await adapter.consensus()).to.equal(consensus.address)
    })

    it("should grant roles correctly", async () => {
      expect(await adapter.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true
      expect(await adapter.hasRole(DEFAULT_ADMIN_ROLE, governance.address)).to.be.true
      expect(await adapter.hasRole(WATCHDOG_OPERATOR_ROLE, watchdog1.address)).to.be.true
      expect(await adapter.hasRole(WATCHDOG_OPERATOR_ROLE, watchdog2.address)).to.be.true
      expect(await adapter.hasRole(WATCHDOG_OPERATOR_ROLE, watchdog3.address)).to.be.true
    })
  })

  describe("Reserve Attestation", () => {
    const balance = ethers.utils.parseEther("100")

    describe("attestReserves", () => {
      it("should route through consensus for active watchdog", async () => {
        await adapter.connect(watchdog1).attestReserves(sampleQC, balance)

        // Verify consensus was called
        expect(consensus.submitOptimisticOperation).to.have.been.calledOnce
        const [operationType, operationData] = consensus.submitOptimisticOperation.getCall(0).args
        
        expect(operationType).to.equal(RESERVE_ATTESTATION)
        
        // Decode and verify operation data
        const decoded = ethers.utils.defaultAbiCoder.decode(
          ["address", "uint256"],
          operationData
        )
        expect(decoded[0]).to.equal(sampleQC)
        expect(decoded[1]).to.equal(balance)
      })

      it("should execute directly for non-consensus watchdog", async () => {
        await adapter.connect(watchdog3).attestReserves(sampleQC, balance)

        // Verify consensus was NOT called
        expect(consensus.submitOptimisticOperation).to.not.have.been.called
        
        // Verify direct execution
        expect(qcReserveLedger.submitReserveAttestation).to.have.been.calledOnceWith(
          sampleQC,
          balance
        )
      })

      it("should update tracking data", async () => {
        await adapter.connect(watchdog3).attestReserves(sampleQC, balance)

        expect(await adapter.lastAttestationTime(sampleQC)).to.be.gt(0)
        expect(await adapter.attestationCount(sampleQC)).to.equal(1)
      })

      it("should emit WatchdogReserveAttestation event", async () => {
        await expect(adapter.connect(watchdog3).attestReserves(sampleQC, balance))
          .to.emit(adapter, "WatchdogReserveAttestation")
          .withArgs(sampleQC, balance, 0, watchdog3.address, await getBlockTimestamp())
      })

      it("should revert if called by non-operator", async () => {
        await expect(
          adapter.connect(nonWatchdog).attestReserves(sampleQC, balance)
        ).to.be.reverted
      })

      it("should revert with invalid QC address", async () => {
        await expect(
          adapter.connect(watchdog1).attestReserves(ethers.constants.AddressZero, balance)
        ).to.be.revertedWith("InvalidQCAddress()")
      })
    })

    describe("executeReserveAttestation", () => {
      it("should execute attestation when called by consensus", async () => {
        await adapter.connect(consensus.wallet).executeReserveAttestation(sampleQC, balance)

        expect(qcReserveLedger.submitReserveAttestation).to.have.been.calledOnceWith(
          sampleQC,
          balance
        )
      })

      it("should revert if called by unauthorized address", async () => {
        await expect(
          adapter.connect(nonWatchdog).executeReserveAttestation(sampleQC, balance)
        ).to.be.revertedWith("Unauthorized")
      })
    })
  })

  describe("Wallet Registration", () => {
    let txInfo: any
    let proof: any
    let spvProofData: string

    beforeEach(() => {
      // Create sample Bitcoin transaction structures
      txInfo = {
        version: ethers.utils.formatBytes32String("version"),
        inputVector: ethers.utils.formatBytes32String("inputs"),
        outputVector: ethers.utils.formatBytes32String("outputs"),
        locktime: ethers.utils.formatBytes32String("locktime")
      }

      proof = {
        merkleProof: ethers.utils.formatBytes32String("merkle"),
        txIndexInBlock: 5,
        bitcoinHeaders: ethers.utils.formatBytes32String("headers")
      }

      spvProofData = ethers.utils.defaultAbiCoder.encode(
        [
          "tuple(bytes32,bytes32,bytes32,bytes32)",
          "tuple(bytes32,uint256,bytes32)"
        ],
        [txInfo, proof]
      )
    })

    describe("registerWalletWithProof", () => {
      it("should route through consensus for active watchdog", async () => {
        await adapter.connect(watchdog1).registerWalletWithProof(
          sampleQC,
          sampleBtcAddress,
          spvProofData,
          sampleChallengeHash
        )

        // Verify consensus was called
        expect(consensus.submitOptimisticOperation).to.have.been.calledOnce
        const [operationType, operationData] = consensus.submitOptimisticOperation.getCall(0).args
        
        expect(operationType).to.equal(WALLET_REGISTRATION)
      })

      it("should execute directly for non-consensus watchdog", async () => {
        await adapter.connect(watchdog3).registerWalletWithProof(
          sampleQC,
          sampleBtcAddress,
          spvProofData,
          sampleChallengeHash
        )

        // Verify SPV validation
        expect(spvValidator.verifyWalletControl).to.have.been.called

        // Verify direct execution
        expect(qcManager.registerWallet).to.have.been.called
      })

      it("should update tracking data", async () => {
        await adapter.connect(watchdog3).registerWalletWithProof(
          sampleQC,
          sampleBtcAddress,
          spvProofData,
          sampleChallengeHash
        )

        expect(await adapter.walletRegistrationTime(sampleBtcAddress)).to.be.gt(0)
      })

      it("should emit WatchdogWalletRegistration event", async () => {
        await expect(
          adapter.connect(watchdog3).registerWalletWithProof(
            sampleQC,
            sampleBtcAddress,
            spvProofData,
            sampleChallengeHash
          )
        )
          .to.emit(adapter, "WatchdogWalletRegistration")
          .withArgs(sampleQC, sampleBtcAddress, sampleChallengeHash)
      })

      it("should revert with invalid parameters", async () => {
        await expect(
          adapter.connect(watchdog1).registerWalletWithProof(
            ethers.constants.AddressZero,
            sampleBtcAddress,
            spvProofData,
            sampleChallengeHash
          )
        ).to.be.revertedWith("InvalidQCAddress()")

        await expect(
          adapter.connect(watchdog1).registerWalletWithProof(
            sampleQC,
            "",
            spvProofData,
            sampleChallengeHash
          )
        ).to.be.revertedWith("InvalidWalletAddress()")

        await expect(
          adapter.connect(watchdog1).registerWalletWithProof(
            sampleQC,
            sampleBtcAddress,
            "0x",
            sampleChallengeHash
          )
        ).to.be.revertedWith("SPVProofRequired()")

        await expect(
          adapter.connect(watchdog1).registerWalletWithProof(
            sampleQC,
            sampleBtcAddress,
            spvProofData,
            ethers.constants.HashZero
          )
        ).to.be.revertedWith("ChallengeHashRequired()")
      })

      it("should revert if SPV verification fails", async () => {
        spvValidator.verifyWalletControl.returns(false)

        await expect(
          adapter.connect(watchdog3).registerWalletWithProof(
            sampleQC,
            sampleBtcAddress,
            spvProofData,
            sampleChallengeHash
          )
        ).to.be.revertedWith("SPVVerificationFailed()")
      })
    })
  })

  describe("Status Change", () => {
    const reason = ethers.utils.formatBytes32String("Suspended for review")

    describe("changeQCStatus", () => {
      it("should route through consensus for active watchdog", async () => {
        await adapter.connect(watchdog1).changeQCStatus(sampleQC, QCStatus.Suspended, reason)

        // Verify consensus was called
        expect(consensus.submitOptimisticOperation).to.have.been.calledOnce
        const [operationType, operationData] = consensus.submitOptimisticOperation.getCall(0).args
        
        expect(operationType).to.equal(STATUS_CHANGE)
      })

      it("should execute directly for non-consensus watchdog", async () => {
        await adapter.connect(watchdog3).changeQCStatus(sampleQC, QCStatus.Suspended, reason)

        // Verify direct execution
        expect(qcManager.setQCStatus).to.have.been.calledOnceWith(
          sampleQC,
          QCStatus.Suspended,
          reason
        )
      })

      it("should emit WatchdogQCStatusChange event", async () => {
        await expect(
          adapter.connect(watchdog3).changeQCStatus(sampleQC, QCStatus.Suspended, reason)
        )
          .to.emit(adapter, "WatchdogQCStatusChange")
          .withArgs(sampleQC, QCStatus.Suspended, reason, watchdog3.address, await getBlockTimestamp())
      })

      it("should revert with invalid parameters", async () => {
        await expect(
          adapter.connect(watchdog1).changeQCStatus(
            ethers.constants.AddressZero,
            QCStatus.Suspended,
            reason
          )
        ).to.be.revertedWith("InvalidQCAddress()")

        await expect(
          adapter.connect(watchdog1).changeQCStatus(
            sampleQC,
            QCStatus.Suspended,
            ethers.constants.HashZero
          )
        ).to.be.revertedWith("ReasonRequired()")
      })
    })
  })

  describe("Redemption Fulfillment", () => {
    let txInfo: any
    let proof: any
    const expectedAmount = BigNumber.from("1000000") // 0.01 BTC in satoshis

    beforeEach(() => {
      txInfo = {
        version: ethers.utils.formatBytes32String("version"),
        inputVector: ethers.utils.formatBytes32String("inputs"),
        outputVector: ethers.utils.formatBytes32String("outputs"),
        locktime: ethers.utils.formatBytes32String("locktime")
      }

      proof = {
        merkleProof: ethers.utils.formatBytes32String("merkle"),
        txIndexInBlock: 5,
        bitcoinHeaders: ethers.utils.formatBytes32String("headers")
      }
    })

    describe("recordRedemptionFulfillment", () => {
      it("should route through consensus for active watchdog", async () => {
        await adapter.connect(watchdog1).recordRedemptionFulfillment(
          sampleRedemptionId,
          sampleBtcAddress,
          expectedAmount,
          txInfo,
          proof
        )

        // Verify consensus was called
        expect(consensus.submitOptimisticOperation).to.have.been.calledOnce
        const [operationType, operationData] = consensus.submitOptimisticOperation.getCall(0).args
        
        expect(operationType).to.equal(REDEMPTION_FULFILLMENT)
      })

      it("should execute directly for non-consensus watchdog", async () => {
        await adapter.connect(watchdog3).recordRedemptionFulfillment(
          sampleRedemptionId,
          sampleBtcAddress,
          expectedAmount,
          txInfo,
          proof
        )

        // Verify direct execution
        expect(qcRedeemer.recordRedemptionFulfillment).to.have.been.called
      })

      it("should update tracking data", async () => {
        await adapter.connect(watchdog3).recordRedemptionFulfillment(
          sampleRedemptionId,
          sampleBtcAddress,
          expectedAmount,
          txInfo,
          proof
        )

        expect(await adapter.redemptionHandlingTime(sampleRedemptionId)).to.be.gt(0)
      })

      it("should emit WatchdogRedemptionAction event", async () => {
        await expect(
          adapter.connect(watchdog3).recordRedemptionFulfillment(
            sampleRedemptionId,
            sampleBtcAddress,
            expectedAmount,
            txInfo,
            proof
          )
        )
          .to.emit(adapter, "WatchdogRedemptionAction")
          .withArgs(
            sampleRedemptionId,
            "FULFILLED",
            ethers.constants.HashZero,
            watchdog3.address,
            await getBlockTimestamp()
          )
      })

      it("should revert with invalid parameters", async () => {
        await expect(
          adapter.connect(watchdog1).recordRedemptionFulfillment(
            ethers.constants.HashZero,
            sampleBtcAddress,
            expectedAmount,
            txInfo,
            proof
          )
        ).to.be.revertedWith("InvalidRedemptionId()")

        await expect(
          adapter.connect(watchdog1).recordRedemptionFulfillment(
            sampleRedemptionId,
            "",
            expectedAmount,
            txInfo,
            proof
          )
        ).to.be.revertedWith("BitcoinAddressRequired()")
      })
    })

    describe("flagRedemptionDefault", () => {
      const defaultReason = ethers.utils.formatBytes32String("Timeout")

      it("should route through consensus for active watchdog", async () => {
        await adapter.connect(watchdog1).flagRedemptionDefault(sampleRedemptionId, defaultReason)

        // Verify consensus was called
        expect(consensus.submitOptimisticOperation).to.have.been.calledOnce
        const [operationType, operationData] = consensus.submitOptimisticOperation.getCall(0).args
        
        expect(operationType).to.equal(REDEMPTION_FULFILLMENT)
      })

      it("should execute directly for non-consensus watchdog", async () => {
        await adapter.connect(watchdog3).flagRedemptionDefault(sampleRedemptionId, defaultReason)

        // Verify direct execution
        expect(qcRedeemer.flagDefaultedRedemption).to.have.been.calledOnceWith(
          sampleRedemptionId,
          defaultReason
        )
      })

      it("should emit WatchdogRedemptionAction event", async () => {
        await expect(
          adapter.connect(watchdog3).flagRedemptionDefault(sampleRedemptionId, defaultReason)
        )
          .to.emit(adapter, "WatchdogRedemptionAction")
          .withArgs(
            sampleRedemptionId,
            "DEFAULTED",
            defaultReason,
            watchdog3.address,
            await getBlockTimestamp()
          )
      })

      it("should revert with invalid parameters", async () => {
        await expect(
          adapter.connect(watchdog1).flagRedemptionDefault(
            ethers.constants.HashZero,
            defaultReason
          )
        ).to.be.revertedWith("InvalidRedemptionId()")

        await expect(
          adapter.connect(watchdog1).flagRedemptionDefault(
            sampleRedemptionId,
            ethers.constants.HashZero
          )
        ).to.be.revertedWith("ReasonRequired()")
      })
    })
  })

  describe("Operation Execution from Consensus", () => {
    it("should execute reserve attestation", async () => {
      const balance = ethers.utils.parseEther("100")
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [sampleQC, balance]
      )

      await adapter.connect(consensus.wallet).executeOperation(RESERVE_ATTESTATION, operationData)

      expect(qcReserveLedger.submitReserveAttestation).to.have.been.calledOnceWith(
        sampleQC,
        balance
      )
    })

    it("should execute wallet registration", async () => {
      const txInfo = {
        version: ethers.utils.formatBytes32String("version"),
        inputVector: ethers.utils.formatBytes32String("inputs"),
        outputVector: ethers.utils.formatBytes32String("outputs"),
        locktime: ethers.utils.formatBytes32String("locktime")
      }

      const proof = {
        merkleProof: ethers.utils.formatBytes32String("merkle"),
        txIndexInBlock: 5,
        bitcoinHeaders: ethers.utils.formatBytes32String("headers")
      }

      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "string", "bytes32", "tuple(bytes32,bytes32,bytes32,bytes32)", "tuple(bytes32,uint256,bytes32)"],
        [sampleQC, sampleBtcAddress, sampleChallengeHash, txInfo, proof]
      )

      await adapter.connect(consensus.wallet).executeOperation(WALLET_REGISTRATION, operationData)

      expect(qcManager.registerWallet).to.have.been.called
    })

    it("should execute status change", async () => {
      const reason = ethers.utils.formatBytes32String("Suspended")
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint8", "bytes32"],
        [sampleQC, QCStatus.Suspended, reason]
      )

      await adapter.connect(consensus.wallet).executeOperation(STATUS_CHANGE, operationData)

      expect(qcManager.setQCStatus).to.have.been.calledOnceWith(
        sampleQC,
        QCStatus.Suspended,
        reason
      )
    })

    it("should execute redemption fulfillment", async () => {
      const txInfo = {
        version: ethers.utils.formatBytes32String("version"),
        inputVector: ethers.utils.formatBytes32String("inputs"),
        outputVector: ethers.utils.formatBytes32String("outputs"),
        locktime: ethers.utils.formatBytes32String("locktime")
      }

      const proof = {
        merkleProof: ethers.utils.formatBytes32String("merkle"),
        txIndexInBlock: 5,
        bitcoinHeaders: ethers.utils.formatBytes32String("headers")
      }

      const expectedAmount = BigNumber.from("1000000")
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "string", "uint64", "tuple(bytes32,bytes32,bytes32,bytes32)", "tuple(bytes32,uint256,bytes32)"],
        [sampleRedemptionId, sampleBtcAddress, expectedAmount, txInfo, proof]
      )

      await adapter.connect(consensus.wallet).executeOperation(REDEMPTION_FULFILLMENT, operationData)

      expect(qcRedeemer.recordRedemptionFulfillment).to.have.been.called
    })

    it("should execute redemption default", async () => {
      const reason = ethers.utils.formatBytes32String("Timeout")
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "bytes32"],
        [sampleRedemptionId, reason]
      )

      await adapter.connect(consensus.wallet).executeOperation(REDEMPTION_FULFILLMENT, operationData)

      expect(qcRedeemer.flagDefaultedRedemption).to.have.been.calledOnceWith(
        sampleRedemptionId,
        reason
      )
    })

    it("should revert if called by unauthorized address", async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [sampleQC, ethers.utils.parseEther("100")]
      )

      await expect(
        adapter.connect(nonWatchdog).executeOperation(RESERVE_ATTESTATION, operationData)
      ).to.be.revertedWith("Unauthorized")
    })
  })

  describe("Compatibility Functions", () => {
    describe("isWatchdogOperational", () => {
      it("should return true when all services are available", async () => {
        qcReserveLedger.hasRole.returns(true)
        
        expect(await adapter.isWatchdogOperational()).to.be.true
      })

      it("should return false if consensus not set", async () => {
        // Deploy adapter without consensus
        const WatchdogAdapter = await ethers.getContractFactory("WatchdogAdapter")
        const brokenAdapter = await WatchdogAdapter.deploy(
          protocolRegistry.address,
          ethers.constants.AddressZero
        )
        
        expect(await brokenAdapter.isWatchdogOperational()).to.be.false
      })

      it("should return false if services missing", async () => {
        protocolRegistry.hasService.whenCalledWith(QC_RESERVE_LEDGER_KEY).returns(false)
        
        expect(await adapter.isWatchdogOperational()).to.be.false
      })

      it("should return false if roles not granted", async () => {
        qcReserveLedger.hasRole.returns(false)
        
        expect(await adapter.isWatchdogOperational()).to.be.false
      })
    })

    describe("getWatchdogStats", () => {
      it("should return watchdog statistics", async () => {
        // Perform some operations
        await adapter.connect(watchdog3).attestReserves(sampleQC, ethers.utils.parseEther("100"))
        
        const stats = await adapter.connect(watchdog1).getWatchdogStats(sampleQC)
        
        expect(stats[0]).to.be.gt(0) // lastAttestationTime
        expect(stats[1]).to.equal(1) // attestationCount
        expect(stats[2]).to.equal(1) // hasRole (watchdog1 has operator role)
      })

      it("should return 0 for hasRole if caller is not operator", async () => {
        const stats = await adapter.connect(nonWatchdog).getWatchdogStats(sampleQC)
        expect(stats[2]).to.equal(0)
      })
    })

    describe("setupWatchdogRoles", () => {
      it("should grant all required roles", async () => {
        await adapter.connect(governance).setupWatchdogRoles()

        // Verify all role grant calls
        expect(qcReserveLedger.grantRole).to.have.been.called
        expect(qcManager.grantRole).to.have.been.calledTwice // REGISTRAR and ARBITER
        expect(qcRedeemer.grantRole).to.have.been.called
      })

      it("should revert if called by non-admin", async () => {
        await expect(
          adapter.connect(watchdog1).setupWatchdogRoles()
        ).to.be.reverted
      })
    })
  })

  describe("Encoding/Decoding Functions", () => {
    it("should encode and decode reserve attestation", async () => {
      const balance = ethers.utils.parseEther("100")
      
      const encoded = await adapter.encodeReserveAttestation(sampleQC, balance)
      const [decodedQC, decodedBalance] = await adapter.decodeReserveAttestation(encoded)
      
      expect(decodedQC).to.equal(sampleQC)
      expect(decodedBalance).to.equal(balance)
    })

    it("should encode and decode wallet registration", async () => {
      const txInfo = {
        version: ethers.utils.formatBytes32String("version"),
        inputVector: ethers.utils.formatBytes32String("inputs"),
        outputVector: ethers.utils.formatBytes32String("outputs"),
        locktime: ethers.utils.formatBytes32String("locktime")
      }

      const proof = {
        merkleProof: ethers.utils.formatBytes32String("merkle"),
        txIndexInBlock: 5,
        bitcoinHeaders: ethers.utils.formatBytes32String("headers")
      }

      const encoded = await adapter.encodeWalletRegistration(
        sampleQC,
        sampleBtcAddress,
        sampleChallengeHash,
        txInfo,
        proof
      )

      const decoded = await adapter.decodeWalletRegistration(encoded)
      
      expect(decoded.qc).to.equal(sampleQC)
      expect(decoded.btcAddress).to.equal(sampleBtcAddress)
      expect(decoded.challengeHash).to.equal(sampleChallengeHash)
    })

    it("should encode and decode status change", async () => {
      const reason = ethers.utils.formatBytes32String("Suspended")
      
      const encoded = await adapter.encodeStatusChange(sampleQC, QCStatus.Suspended, reason)
      const [decodedQC, decodedStatus, decodedReason] = await adapter.decodeStatusChange(encoded)
      
      expect(decodedQC).to.equal(sampleQC)
      expect(decodedStatus).to.equal(QCStatus.Suspended)
      expect(decodedReason).to.equal(reason)
    })

    it("should encode and decode redemption fulfillment", async () => {
      const txInfo = {
        version: ethers.utils.formatBytes32String("version"),
        inputVector: ethers.utils.formatBytes32String("inputs"),
        outputVector: ethers.utils.formatBytes32String("outputs"),
        locktime: ethers.utils.formatBytes32String("locktime")
      }

      const proof = {
        merkleProof: ethers.utils.formatBytes32String("merkle"),
        txIndexInBlock: 5,
        bitcoinHeaders: ethers.utils.formatBytes32String("headers")
      }

      const expectedAmount = BigNumber.from("1000000")

      const encoded = await adapter.encodeRedemptionFulfillment(
        sampleRedemptionId,
        sampleBtcAddress,
        expectedAmount,
        txInfo,
        proof
      )

      const decoded = await adapter.decodeRedemptionFulfillment(encoded)
      
      expect(decoded.redemptionId).to.equal(sampleRedemptionId)
      expect(decoded.userBtcAddress).to.equal(sampleBtcAddress)
      expect(decoded.expectedAmount).to.equal(expectedAmount)
    })

    it("should encode and decode redemption default", async () => {
      const reason = ethers.utils.formatBytes32String("Timeout")
      
      const encoded = await adapter.encodeRedemptionDefault(sampleRedemptionId, reason)
      const [decodedId, decodedReason] = await adapter.decodeRedemptionDefault(encoded)
      
      expect(decodedId).to.equal(sampleRedemptionId)
      expect(decodedReason).to.equal(reason)
    })
  })

  // Helper function
  async function getBlockTimestamp(): Promise<number> {
    const block = await ethers.provider.getBlock("latest")
    return block.timestamp
  }
})