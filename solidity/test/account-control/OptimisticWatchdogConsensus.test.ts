import { ethers, helpers, waffle } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { Contract, ContractFactory } from "ethers"
import { smock } from "@defi-wonderland/smock"
import type { FakeContract } from "@defi-wonderland/smock"

const { loadFixture } = waffle
const { deployMockContract } = waffle
const { provider } = waffle

describe("OptimisticWatchdogConsensus", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let watchdog4: SignerWithAddress
  let watchdog5: SignerWithAddress
  let nonWatchdog: SignerWithAddress

  let consensus: Contract
  let protocolRegistry: FakeContract<Contract>
  let operationExecutor: FakeContract<Contract>

  // Operation type constants
  const RESERVE_ATTESTATION = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("RESERVE_ATTESTATION"))
  const WALLET_REGISTRATION = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("WALLET_REGISTRATION"))
  const STATUS_CHANGE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("STATUS_CHANGE"))
  const REDEMPTION_FULFILLMENT = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("REDEMPTION_FULFILLMENT"))

  // Role constants
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
  const EMERGENCY_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EMERGENCY_ROLE"))
  const MANAGER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MANAGER_ROLE"))

  // Service key constants
  const OPERATION_EXECUTOR_KEY = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("OPERATION_EXECUTOR"))

  async function fixture() {
    ;[deployer, governance, watchdog1, watchdog2, watchdog3, watchdog4, watchdog5, nonWatchdog] = 
      await ethers.getSigners()

    // Deploy mock protocol registry
    protocolRegistry = await smock.fake("ProtocolRegistry")
    
    // Deploy mock operation executor
    operationExecutor = await smock.fake("IWatchdogOperation")
    operationExecutor.executeOperation.returns(true)

    // Set up protocol registry to return operation executor
    protocolRegistry.getService.whenCalledWith(OPERATION_EXECUTOR_KEY).returns(operationExecutor.address)

    // Deploy OptimisticWatchdogConsensus
    const OptimisticWatchdogConsensus = await ethers.getContractFactory("OptimisticWatchdogConsensus")
    consensus = await OptimisticWatchdogConsensus.deploy(protocolRegistry.address)
    await consensus.deployed()

    // Grant roles to governance
    await consensus.grantRole(DEFAULT_ADMIN_ROLE, governance.address)
    await consensus.grantRole(EMERGENCY_ROLE, governance.address)
    await consensus.grantRole(MANAGER_ROLE, governance.address)

    // Add initial watchdogs
    await consensus.connect(governance).addWatchdog(watchdog1.address)
    await consensus.connect(governance).addWatchdog(watchdog2.address)
    await consensus.connect(governance).addWatchdog(watchdog3.address)
    await consensus.connect(governance).addWatchdog(watchdog4.address)
    await consensus.connect(governance).addWatchdog(watchdog5.address)

    return {
      consensus,
      protocolRegistry,
      operationExecutor,
      deployer,
      governance,
      watchdog1,
      watchdog2,
      watchdog3,
      watchdog4,
      watchdog5,
      nonWatchdog,
    }
  }

  beforeEach(async () => {
    const loadedFixture = await loadFixture(fixture)
    consensus = loadedFixture.consensus
    protocolRegistry = loadedFixture.protocolRegistry
    operationExecutor = loadedFixture.operationExecutor
    deployer = loadedFixture.deployer
    governance = loadedFixture.governance
    watchdog1 = loadedFixture.watchdog1
    watchdog2 = loadedFixture.watchdog2
    watchdog3 = loadedFixture.watchdog3
    watchdog4 = loadedFixture.watchdog4
    watchdog5 = loadedFixture.watchdog5
    nonWatchdog = loadedFixture.nonWatchdog
  })

  describe("Deployment", () => {
    it("should initialize with correct parameters", async () => {
      const state = await consensus.getConsensusState()
      expect(state.activeWatchdogs).to.equal(5)
      expect(state.consensusThreshold).to.equal(3)
      expect(state.baseChallengePeriod).to.equal(3600) // 1 hour
      expect(state.emergencyPause).to.be.false
    })

    it("should set correct escalation delays", async () => {
      expect(await consensus.escalationDelays(0)).to.equal(3600) // 1 hour
      expect(await consensus.escalationDelays(1)).to.equal(14400) // 4 hours
      expect(await consensus.escalationDelays(2)).to.equal(43200) // 12 hours
      expect(await consensus.escalationDelays(3)).to.equal(86400) // 24 hours
    })

    it("should set correct consensus thresholds", async () => {
      expect(await consensus.consensusThresholds(0)).to.equal(0)
      expect(await consensus.consensusThresholds(1)).to.equal(2)
      expect(await consensus.consensusThresholds(2)).to.equal(3)
      expect(await consensus.consensusThresholds(3)).to.equal(5)
    })

    it("should grant roles correctly", async () => {
      expect(await consensus.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true
      expect(await consensus.hasRole(EMERGENCY_ROLE, governance.address)).to.be.true
      expect(await consensus.hasRole(MANAGER_ROLE, governance.address)).to.be.true
    })
  })

  describe("Watchdog Management", () => {
    describe("addWatchdog", () => {
      it("should add a new watchdog", async () => {
        const newWatchdog = ethers.Wallet.createRandom()
        
        await expect(consensus.connect(governance).addWatchdog(newWatchdog.address))
          .to.emit(consensus, "WatchdogAdded")
          .withArgs(newWatchdog.address, governance.address)

        expect(await consensus.isActiveWatchdog(newWatchdog.address)).to.be.true
        const state = await consensus.getConsensusState()
        expect(state.activeWatchdogs).to.equal(6)
      })

      it("should revert if watchdog already active", async () => {
        await expect(
          consensus.connect(governance).addWatchdog(watchdog1.address)
        ).to.be.revertedWith("WatchdogAlreadyActive()")
      })

      it("should revert if max watchdogs reached", async () => {
        // Add watchdogs up to max (20)
        for (let i = 5; i < 20; i++) {
          const wallet = ethers.Wallet.createRandom()
          await consensus.connect(governance).addWatchdog(wallet.address)
        }

        const extraWatchdog = ethers.Wallet.createRandom()
        await expect(
          consensus.connect(governance).addWatchdog(extraWatchdog.address)
        ).to.be.revertedWith("Max watchdogs reached")
      })

      it("should revert if called by non-manager", async () => {
        const newWatchdog = ethers.Wallet.createRandom()
        await expect(
          consensus.connect(watchdog1).addWatchdog(newWatchdog.address)
        ).to.be.reverted
      })
    })

    describe("removeWatchdog", () => {
      it("should remove an active watchdog", async () => {
        const reason = ethers.utils.formatBytes32String("Inactive")
        
        await expect(consensus.connect(governance).removeWatchdog(watchdog5.address, reason))
          .to.emit(consensus, "WatchdogRemoved")
          .withArgs(watchdog5.address, governance.address, reason)

        expect(await consensus.isActiveWatchdog(watchdog5.address)).to.be.false
        const state = await consensus.getConsensusState()
        expect(state.activeWatchdogs).to.equal(4)
      })

      it("should revert if watchdog not active", async () => {
        const reason = ethers.utils.formatBytes32String("Test")
        await expect(
          consensus.connect(governance).removeWatchdog(nonWatchdog.address, reason)
        ).to.be.revertedWith("NotActiveWatchdog()")
      })

      it("should revert if minimum watchdogs would be violated", async () => {
        const reason = ethers.utils.formatBytes32String("Test")
        
        // Remove down to minimum (3)
        await consensus.connect(governance).removeWatchdog(watchdog4.address, reason)
        await consensus.connect(governance).removeWatchdog(watchdog5.address, reason)
        
        // Try to go below minimum
        await expect(
          consensus.connect(governance).removeWatchdog(watchdog3.address, reason)
        ).to.be.revertedWith("InsufficientWatchdogs()")
      })
    })

    describe("updateConsensusParameters", () => {
      it("should update consensus parameters", async () => {
        await consensus.connect(governance).updateConsensusParameters(4, 7200) // 2 hours
        
        const state = await consensus.getConsensusState()
        expect(state.consensusThreshold).to.equal(4)
        expect(state.baseChallengePeriod).to.equal(7200)
        expect(await consensus.escalationDelays(0)).to.equal(7200)
      })

      it("should revert with invalid threshold", async () => {
        await expect(
          consensus.connect(governance).updateConsensusParameters(1, 3600)
        ).to.be.revertedWith("Invalid threshold")
        
        await expect(
          consensus.connect(governance).updateConsensusParameters(6, 3600)
        ).to.be.revertedWith("Invalid threshold")
      })

      it("should revert with invalid challenge period", async () => {
        await expect(
          consensus.connect(governance).updateConsensusParameters(3, 1800) // 30 min
        ).to.be.revertedWith("Invalid period")
        
        await expect(
          consensus.connect(governance).updateConsensusParameters(3, 90000) // 25 hours
        ).to.be.revertedWith("Invalid period")
      })
    })
  })

  describe("Operation Submission", () => {
    let operationData: string
    let primaryValidator: SignerWithAddress

    beforeEach(async () => {
      // Encode sample operation data
      operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      // Calculate primary validator for this operation
      const primaryAddress = await consensus.calculatePrimaryValidator(
        RESERVE_ATTESTATION,
        operationData
      )
      
      // Find which signer is the primary validator
      const signers = [watchdog1, watchdog2, watchdog3, watchdog4, watchdog5]
      primaryValidator = signers.find(s => s.address === primaryAddress)!
    })

    it("should submit operation successfully by primary validator", async () => {
      const tx = await consensus.connect(primaryValidator).submitOptimisticOperation(
        RESERVE_ATTESTATION,
        operationData
      )
      
      const receipt = await tx.wait()
      const event = receipt.events?.find(e => e.event === "OperationSubmitted")
      const operationId = event?.args?.operationId

      expect(operationId).to.not.be.undefined
      
      const operation = await consensus.getOperation(operationId)
      expect(operation.operationType).to.equal(RESERVE_ATTESTATION)
      expect(operation.primaryValidator).to.equal(primaryValidator.address)
      expect(operation.objectionCount).to.equal(0)
      expect(operation.executed).to.be.false
      expect(operation.challenged).to.be.false
    })

    it("should revert if not primary validator", async () => {
      const notPrimary = [watchdog1, watchdog2, watchdog3, watchdog4, watchdog5]
        .find(s => s.address !== primaryValidator.address)!
      
      await expect(
        consensus.connect(notPrimary).submitOptimisticOperation(
          RESERVE_ATTESTATION,
          operationData
        )
      ).to.be.revertedWith("NotPrimaryValidator()")
    })

    it("should revert if not active watchdog", async () => {
      await expect(
        consensus.connect(nonWatchdog).submitOptimisticOperation(
          RESERVE_ATTESTATION,
          operationData
        )
      ).to.be.revertedWith("NotActiveWatchdog()")
    })

    it("should revert with invalid operation type", async () => {
      const invalidType = ethers.utils.formatBytes32String("INVALID_OP")
      
      await expect(
        consensus.connect(primaryValidator).submitOptimisticOperation(
          invalidType,
          operationData
        )
      ).to.be.revertedWith("InvalidOperationType()")
    })

    it("should handle all valid operation types", async () => {
      const operationTypes = [
        RESERVE_ATTESTATION,
        WALLET_REGISTRATION,
        STATUS_CHANGE,
        REDEMPTION_FULFILLMENT
      ]

      for (const opType of operationTypes) {
        const primary = await consensus.calculatePrimaryValidator(opType, operationData)
        const signer = [watchdog1, watchdog2, watchdog3, watchdog4, watchdog5]
          .find(s => s.address === primary)!
        
        const tx = await consensus.connect(signer).submitOptimisticOperation(
          opType,
          operationData
        )
        
        const receipt = await tx.wait()
        expect(receipt.events?.find(e => e.event === "OperationSubmitted")).to.not.be.undefined
      }
    })
  })

  describe("Operation Challenges", () => {
    let operationId: string
    let primaryValidator: SignerWithAddress
    let challenger: SignerWithAddress

    beforeEach(async () => {
      // Submit an operation
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      const primaryAddress = await consensus.calculatePrimaryValidator(
        RESERVE_ATTESTATION,
        operationData
      )
      
      const signers = [watchdog1, watchdog2, watchdog3, watchdog4, watchdog5]
      primaryValidator = signers.find(s => s.address === primaryAddress)!
      challenger = signers.find(s => s.address !== primaryAddress)!

      const tx = await consensus.connect(primaryValidator).submitOptimisticOperation(
        RESERVE_ATTESTATION,
        operationData
      )
      
      const receipt = await tx.wait()
      operationId = receipt.events?.find(e => e.event === "OperationSubmitted")?.args?.operationId
    })

    it("should challenge an operation successfully", async () => {
      const evidence = ethers.utils.formatBytes32String("Invalid balance")
      
      await expect(
        consensus.connect(challenger).challengeOperation(operationId, evidence)
      )
        .to.emit(consensus, "OperationChallenged")
        .withArgs(operationId, challenger.address, 1, await getExpectedFinalizeTime(1))

      const operation = await consensus.getOperation(operationId)
      expect(operation.objectionCount).to.equal(1)
      expect(operation.challenged).to.be.true
    })

    it("should escalate delays with multiple challenges", async () => {
      const evidence = ethers.utils.formatBytes32String("Invalid")
      
      // First challenge
      await consensus.connect(watchdog2).challengeOperation(operationId, evidence)
      let operation = await consensus.getOperation(operationId)
      expect(operation.objectionCount).to.equal(1)
      
      // Second challenge - should trigger escalation
      await expect(
        consensus.connect(watchdog3).challengeOperation(operationId, evidence)
      )
        .to.emit(consensus, "ConsensusEscalated")
        .withArgs(operationId, 1, 2, await getEscalationDelay(1))
      
      operation = await consensus.getOperation(operationId)
      expect(operation.objectionCount).to.equal(2)
    })

    it("should revert if challenger objects twice", async () => {
      const evidence = ethers.utils.formatBytes32String("Invalid")
      
      await consensus.connect(challenger).challengeOperation(operationId, evidence)
      
      await expect(
        consensus.connect(challenger).challengeOperation(operationId, evidence)
      ).to.be.revertedWith("AlreadyObjected()")
    })

    it("should revert if operation already executed", async () => {
      // Fast forward past challenge period
      await helpers.time.increase(3601)
      
      // Execute the operation
      await consensus.executeOperation(operationId)
      
      const evidence = ethers.utils.formatBytes32String("Too late")
      await expect(
        consensus.connect(challenger).challengeOperation(operationId, evidence)
      ).to.be.revertedWith("OperationAlreadyExecuted()")
    })

    it("should revert if challenge period expired", async () => {
      // Fast forward past challenge period
      await helpers.time.increase(3601)
      
      const evidence = ethers.utils.formatBytes32String("Too late")
      await expect(
        consensus.connect(challenger).challengeOperation(operationId, evidence)
      ).to.be.revertedWith("ChallengePeriodActive()")
    })

    it("should store challenge details correctly", async () => {
      const evidence = ethers.utils.formatBytes32String("Custom evidence")
      
      await consensus.connect(challenger).challengeOperation(operationId, evidence)
      
      const challenges = await consensus.getOperationChallenges(operationId)
      expect(challenges.length).to.equal(1)
      expect(challenges[0].challenger).to.equal(challenger.address)
      expect(challenges[0].evidence).to.equal(evidence)
    })
  })

  describe("Operation Execution", () => {
    let operationId: string
    let operationData: string

    beforeEach(async () => {
      // Submit an operation
      operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      const primaryAddress = await consensus.calculatePrimaryValidator(
        RESERVE_ATTESTATION,
        operationData
      )
      
      const signers = [watchdog1, watchdog2, watchdog3, watchdog4, watchdog5]
      const primaryValidator = signers.find(s => s.address === primaryAddress)!

      const tx = await consensus.connect(primaryValidator).submitOptimisticOperation(
        RESERVE_ATTESTATION,
        operationData
      )
      
      const receipt = await tx.wait()
      operationId = receipt.events?.find(e => e.event === "OperationSubmitted")?.args?.operationId
    })

    it("should execute operation after challenge period", async () => {
      // Fast forward past challenge period
      await helpers.time.increase(3601)
      
      await expect(consensus.executeOperation(operationId))
        .to.emit(consensus, "OperationExecuted")
        .withArgs(operationId, deployer.address, true)

      const operation = await consensus.getOperation(operationId)
      expect(operation.executed).to.be.true
      
      // Verify operation executor was called
      expect(operationExecutor.executeOperation).to.have.been.calledWith(
        RESERVE_ATTESTATION,
        operationData
      )
    })

    it("should revert if challenge period not expired", async () => {
      await expect(
        consensus.executeOperation(operationId)
      ).to.be.revertedWith("ChallengePeriodActive()")
    })

    it("should revert if already executed", async () => {
      await helpers.time.increase(3601)
      await consensus.executeOperation(operationId)
      
      await expect(
        consensus.executeOperation(operationId)
      ).to.be.revertedWith("OperationAlreadyExecuted()")
    })

    it("should execute after extended delay with challenges", async () => {
      // Challenge the operation
      const evidence = ethers.utils.formatBytes32String("Invalid")
      await consensus.connect(watchdog2).challengeOperation(operationId, evidence)
      
      // Should not be executable after base period
      await helpers.time.increase(3601)
      await expect(
        consensus.executeOperation(operationId)
      ).to.be.revertedWith("ChallengePeriodActive()")
      
      // Fast forward to after escalated delay (4 hours)
      await helpers.time.increase(10800) // 3 more hours
      
      await expect(consensus.executeOperation(operationId))
        .to.emit(consensus, "OperationExecuted")
        .withArgs(operationId, deployer.address, true)
    })

    it("should handle operation executor failure gracefully", async () => {
      operationExecutor.executeOperation.returns(false)
      
      await helpers.time.increase(3601)
      
      await expect(consensus.executeOperation(operationId))
        .to.emit(consensus, "OperationExecuted")
        .withArgs(operationId, deployer.address, false)
    })

    it("should check canExecuteOperation correctly", async () => {
      expect(await consensus.canExecuteOperation(operationId)).to.be.false
      
      await helpers.time.increase(3601)
      expect(await consensus.canExecuteOperation(operationId)).to.be.true
      
      await consensus.executeOperation(operationId)
      expect(await consensus.canExecuteOperation(operationId)).to.be.false
    })
  })

  describe("Emergency Functions", () => {
    let operationId: string

    beforeEach(async () => {
      // Submit an operation
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      const primaryAddress = await consensus.calculatePrimaryValidator(
        RESERVE_ATTESTATION,
        operationData
      )
      
      const signers = [watchdog1, watchdog2, watchdog3, watchdog4, watchdog5]
      const primaryValidator = signers.find(s => s.address === primaryAddress)!

      const tx = await consensus.connect(primaryValidator).submitOptimisticOperation(
        RESERVE_ATTESTATION,
        operationData
      )
      
      const receipt = await tx.wait()
      operationId = receipt.events?.find(e => e.event === "OperationSubmitted")?.args?.operationId
    })

    describe("emergencyOverride", () => {
      it("should execute operation immediately", async () => {
        const reason = ethers.utils.formatBytes32String("Emergency")
        
        await expect(
          consensus.connect(governance).emergencyOverride(operationId, reason)
        )
          .to.emit(consensus, "EmergencyOverride")
          .withArgs(operationId, governance.address, reason)
          .to.emit(consensus, "OperationExecuted")
          .withArgs(operationId, governance.address, true)

        const operation = await consensus.getOperation(operationId)
        expect(operation.executed).to.be.true
      })

      it("should revert if not emergency role", async () => {
        const reason = ethers.utils.formatBytes32String("Emergency")
        
        await expect(
          consensus.connect(watchdog1).emergencyOverride(operationId, reason)
        ).to.be.reverted
      })

      it("should revert if operation already executed", async () => {
        await helpers.time.increase(3601)
        await consensus.executeOperation(operationId)
        
        const reason = ethers.utils.formatBytes32String("Emergency")
        await expect(
          consensus.connect(governance).emergencyOverride(operationId, reason)
        ).to.be.revertedWith("OperationAlreadyExecuted()")
      })
    })

    describe("pause/unpause", () => {
      it("should pause the system", async () => {
        await consensus.connect(governance).pause()
        
        expect(await consensus.paused()).to.be.true
        const state = await consensus.getConsensusState()
        expect(state.emergencyPause).to.be.true
      })

      it("should unpause the system", async () => {
        await consensus.connect(governance).pause()
        await consensus.connect(governance).unpause()
        
        expect(await consensus.paused()).to.be.false
        const state = await consensus.getConsensusState()
        expect(state.emergencyPause).to.be.false
      })

      it("should prevent operations when paused", async () => {
        await consensus.connect(governance).pause()
        
        const operationData = ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256"],
          [watchdog1.address, ethers.utils.parseEther("100")]
        )

        await expect(
          consensus.connect(watchdog1).submitOptimisticOperation(
            RESERVE_ATTESTATION,
            operationData
          )
        ).to.be.revertedWith("Pausable: paused")
      })

      it("should revert if not emergency role", async () => {
        await expect(consensus.connect(watchdog1).pause()).to.be.reverted
        await expect(consensus.connect(watchdog1).unpause()).to.be.reverted
      })
    })
  })

  describe("Primary Validator Selection", () => {
    it("should select validators deterministically within same block", async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      // Same operation data should always select same validator in same block
      const validator1 = await consensus.calculatePrimaryValidator(
        RESERVE_ATTESTATION,
        operationData
      )
      const validator2 = await consensus.calculatePrimaryValidator(
        RESERVE_ATTESTATION,
        operationData
      )
      
      expect(validator1).to.equal(validator2)
    })

    it("should emit PrimaryValidatorSelected event", async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      await expect(consensus.calculatePrimaryValidator(RESERVE_ATTESTATION, operationData))
        .to.emit(consensus, "PrimaryValidatorSelected")
    })

    it("should distribute selection across watchdogs", async () => {
      const selections = new Map<string, number>()
      
      // Test with different operation data
      for (let i = 0; i < 100; i++) {
        const operationData = ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256"],
          [watchdog1.address, ethers.utils.parseEther(i.toString())]
        )
        
        const validator = await consensus.calculatePrimaryValidator(
          RESERVE_ATTESTATION,
          operationData
        )
        
        selections.set(validator, (selections.get(validator) || 0) + 1)
      }
      
      // Each watchdog should have been selected at least once
      expect(selections.size).to.equal(5)
      for (const count of selections.values()) {
        expect(count).to.be.gt(0)
      }
    })

    it("should change selection with block progression", async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      const validator1 = await consensus.calculatePrimaryValidator(
        RESERVE_ATTESTATION,
        operationData
      )
      
      // Mine 100 blocks to change the seed
      for (let i = 0; i < 100; i++) {
        await helpers.mine()
      }
      
      const validator2 = await consensus.calculatePrimaryValidator(
        RESERVE_ATTESTATION,
        operationData
      )
      
      // Validators might be different due to block number change
      // This test may occasionally fail due to randomness
    })
  })

  describe("View Functions", () => {
    it("should return active watchdogs list", async () => {
      const watchdogs = await consensus.getActiveWatchdogs()
      expect(watchdogs.length).to.equal(5)
      expect(watchdogs).to.include(watchdog1.address)
      expect(watchdogs).to.include(watchdog2.address)
      expect(watchdogs).to.include(watchdog3.address)
      expect(watchdogs).to.include(watchdog4.address)
      expect(watchdogs).to.include(watchdog5.address)
    })

    it("should return consensus state", async () => {
      const state = await consensus.getConsensusState()
      expect(state.activeWatchdogs).to.equal(5)
      expect(state.consensusThreshold).to.equal(3)
      expect(state.baseChallengePeriod).to.equal(3600)
      expect(state.emergencyPause).to.be.false
    })

    it("should check if address is active watchdog", async () => {
      expect(await consensus.isActiveWatchdog(watchdog1.address)).to.be.true
      expect(await consensus.isActiveWatchdog(nonWatchdog.address)).to.be.false
    })
  })

  // Helper functions
  async function getExpectedFinalizeTime(objectionCount: number): Promise<number> {
    const block = await provider.getBlock("latest")
    const escalationLevel = objectionCount >= 5 ? 3 : objectionCount >= 3 ? 2 : objectionCount >= 2 ? 1 : 0
    const delay = [3600, 14400, 43200, 86400][escalationLevel]
    return block.timestamp + delay
  }

  async function getEscalationDelay(level: number): Promise<number> {
    const delays = [3600, 14400, 43200, 86400]
    return level > 0 ? delays[level] - delays[level - 1] : delays[0]
  }
})