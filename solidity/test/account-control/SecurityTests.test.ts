import { ethers, helpers, waffle } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { Contract } from "ethers"
import { smock } from "@defi-wonderland/smock"
import type { FakeContract } from "@defi-wonderland/smock"

const { loadFixture } = waffle

describe("V1.1 Security Tests", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let watchdog4: SignerWithAddress
  let watchdog5: SignerWithAddress
  let attacker: SignerWithAddress

  let consensus: Contract
  let adapter: Contract
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
  const WATCHDOG_OPERATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("WATCHDOG_OPERATOR_ROLE"))

  // Service keys
  const OPERATION_EXECUTOR_KEY = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("OPERATION_EXECUTOR"))
  const QC_RESERVE_LEDGER_KEY = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_RESERVE_LEDGER"))

  async function fixture() {
    ;[deployer, governance, watchdog1, watchdog2, watchdog3, watchdog4, watchdog5, attacker] = 
      await ethers.getSigners()

    // Deploy mock protocol registry
    protocolRegistry = await smock.fake("ProtocolRegistry")
    
    // Deploy mock operation executor
    operationExecutor = await smock.fake("IWatchdogOperation")
    operationExecutor.executeOperation.returns(true)

    // Set up protocol registry
    protocolRegistry.getService.whenCalledWith(OPERATION_EXECUTOR_KEY).returns(operationExecutor.address)

    // Deploy OptimisticWatchdogConsensus
    const OptimisticWatchdogConsensus = await ethers.getContractFactory("OptimisticWatchdogConsensus")
    consensus = await OptimisticWatchdogConsensus.deploy(protocolRegistry.address)
    await consensus.deployed()

    // Deploy WatchdogAdapter
    const WatchdogAdapter = await ethers.getContractFactory("WatchdogAdapter")
    adapter = await WatchdogAdapter.deploy(protocolRegistry.address, consensus.address)
    await adapter.deployed()

    // Setup roles
    await consensus.grantRole(DEFAULT_ADMIN_ROLE, governance.address)
    await consensus.grantRole(EMERGENCY_ROLE, governance.address)
    await consensus.grantRole(MANAGER_ROLE, governance.address)

    // Add watchdogs
    await consensus.connect(governance).addWatchdog(watchdog1.address)
    await consensus.connect(governance).addWatchdog(watchdog2.address)
    await consensus.connect(governance).addWatchdog(watchdog3.address)
    await consensus.connect(governance).addWatchdog(watchdog4.address)
    await consensus.connect(governance).addWatchdog(watchdog5.address)

    // Setup adapter roles
    await adapter.grantRole(WATCHDOG_OPERATOR_ROLE, watchdog1.address)
    await adapter.grantRole(WATCHDOG_OPERATOR_ROLE, watchdog2.address)
    await adapter.grantRole(WATCHDOG_OPERATOR_ROLE, watchdog3.address)

    return {
      consensus,
      adapter,
      protocolRegistry,
      operationExecutor,
      deployer,
      governance,
      watchdog1,
      watchdog2,
      watchdog3,
      watchdog4,
      watchdog5,
      attacker,
    }
  }

  beforeEach(async () => {
    const loadedFixture = await loadFixture(fixture)
    Object.assign(this, loadedFixture)
    consensus = loadedFixture.consensus
    adapter = loadedFixture.adapter
    protocolRegistry = loadedFixture.protocolRegistry
    operationExecutor = loadedFixture.operationExecutor
    deployer = loadedFixture.deployer
    governance = loadedFixture.governance
    watchdog1 = loadedFixture.watchdog1
    watchdog2 = loadedFixture.watchdog2
    watchdog3 = loadedFixture.watchdog3
    watchdog4 = loadedFixture.watchdog4
    watchdog5 = loadedFixture.watchdog5
    attacker = loadedFixture.attacker
  })

  describe("MEV Resistance Tests", () => {
    it("should be resistant to block number manipulation", async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      // Test selection across different blocks
      const selections = new Map<string, number>()
      
      for (let i = 0; i < 50; i++) {
        const validator = await consensus.calculatePrimaryValidator(
          RESERVE_ATTESTATION,
          operationData
        )
        selections.set(validator, (selections.get(validator) || 0) + 1)
        
        // Mine a block to change the selection
        await helpers.mine()
      }

      // Should have good distribution (no single validator dominates)
      const maxSelections = Math.max(...selections.values())
      const totalSelections = [...selections.values()].reduce((a, b) => a + b, 0)
      expect(maxSelections / totalSelections).to.be.lt(0.4) // No validator should have >40%
    })

    it("should handle blockhash edge cases", async () => {
      // Mine >256 blocks to test blockhash(0) fallback
      for (let i = 0; i < 260; i++) {
        await helpers.mine()
      }

      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      // Should still work with blockhash fallback
      const validator = await consensus.calculatePrimaryValidator(
        RESERVE_ATTESTATION,
        operationData
      )
      expect(validator).to.be.properAddress
    })

    it("should emit PrimaryValidatorSelected events", async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      await expect(consensus.calculatePrimaryValidator(RESERVE_ATTESTATION, operationData))
        .to.emit(consensus, "PrimaryValidatorSelected")
    })
  })

  describe("Consensus Verification Tests", () => {
    let operationId: string

    beforeEach(async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      // Submit operation
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

    it("should require approvals for high objection operations", async () => {
      // Challenge operation multiple times to trigger approval requirement
      const evidence = ethers.utils.formatBytes32String("Invalid")
      
      await consensus.connect(watchdog2).challengeOperation(operationId, evidence)
      await consensus.connect(watchdog3).challengeOperation(operationId, evidence)
      await consensus.connect(watchdog4).challengeOperation(operationId, evidence)

      // Fast forward past challenge period
      await helpers.time.increase(43200 + 1) // 12 hours + 1 second

      // Should not be able to execute without approvals
      await expect(
        consensus.executeOperation(operationId)
      ).to.be.revertedWith("Insufficient approvals for disputed operation")
    })

    it("should allow execution after sufficient approvals", async () => {
      // Challenge operation to trigger approval requirement
      const evidence = ethers.utils.formatBytes32String("Invalid")
      
      await consensus.connect(watchdog2).challengeOperation(operationId, evidence)
      await consensus.connect(watchdog3).challengeOperation(operationId, evidence)
      await consensus.connect(watchdog4).challengeOperation(operationId, evidence)

      // Fast forward past challenge period
      await helpers.time.increase(43200 + 1) // 12 hours + 1 second

      // Get required approvals (should be 3 for 5 watchdogs)
      await consensus.connect(watchdog1).approveOperation(operationId)
      await consensus.connect(watchdog2).approveOperation(operationId)
      await consensus.connect(watchdog3).approveOperation(operationId)

      // Should now be able to execute
      await expect(consensus.executeOperation(operationId))
        .to.emit(consensus, "OperationExecuted")
        .withArgs(operationId, deployer.address, true)
    })

    it("should prevent double approval", async () => {
      // Challenge operation to make it disputed
      const evidence = ethers.utils.formatBytes32String("Invalid")
      await consensus.connect(watchdog2).challengeOperation(operationId, evidence)

      // Fast forward past challenge period
      await helpers.time.increase(3601)

      // First approval should succeed
      await consensus.connect(watchdog1).approveOperation(operationId)

      // Second approval should fail
      await expect(
        consensus.connect(watchdog1).approveOperation(operationId)
      ).to.be.revertedWith("Already approved")
    })

    it("should emit OperationApproved events", async () => {
      // Challenge operation to make it disputed
      const evidence = ethers.utils.formatBytes32String("Invalid")
      await consensus.connect(watchdog2).challengeOperation(operationId, evidence)

      // Fast forward past challenge period
      await helpers.time.increase(3601)

      await expect(consensus.connect(watchdog1).approveOperation(operationId))
        .to.emit(consensus, "OperationApproved")
        .withArgs(operationId, watchdog1.address, 1)
    })
  })

  describe("Reentrancy Tests", () => {
    it("should prevent reentrancy in executeOperation", async () => {
      // Deploy a malicious contract that tries to reenter
      const MaliciousExecutor = await ethers.getContractFactory("MaliciousExecutor")
      const maliciousExecutor = await MaliciousExecutor.deploy()
      
      // Point protocol registry to malicious executor
      protocolRegistry.getService.whenCalledWith(OPERATION_EXECUTOR_KEY).returns(maliciousExecutor.address)

      // Submit operation
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
      const operationId = receipt.events?.find(e => e.event === "OperationSubmitted")?.args?.operationId

      // Fast forward past challenge period
      await helpers.time.increase(3601)

      // Set up malicious executor to attempt reentrancy
      await maliciousExecutor.setTarget(consensus.address)
      await maliciousExecutor.setOperationId(operationId)

      // Execution should fail due to reentrancy guard
      await expect(
        consensus.executeOperation(operationId)
      ).to.be.revertedWith("ReentrancyGuard: reentrant call")
    })
  })

  describe("Gas Limit Tests", () => {
    it("should handle maximum watchdog count without gas issues", async () => {
      // Add watchdogs up to maximum
      for (let i = 5; i < 20; i++) {
        const wallet = ethers.Wallet.createRandom()
        await consensus.connect(governance).addWatchdog(wallet.address)
      }

      expect(await consensus.activeWatchdogsList(19)).to.be.properAddress
    })

    it("should remove watchdogs efficiently with O(1) operation", async () => {
      const reason = ethers.utils.formatBytes32String("Test")
      
      // Measure gas for removal
      const tx = await consensus.connect(governance).removeWatchdog(watchdog5.address, reason)
      const receipt = await tx.wait()
      
      // Should use reasonable gas (< 100k)
      expect(receipt.gasUsed).to.be.lt(100000)
    })
  })

  describe("Access Control Tests", () => {
    it("should prevent unauthorized primary validator submission", async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      // Non-primary validator should not be able to submit
      await expect(
        consensus.connect(watchdog2).submitOptimisticOperation(
          RESERVE_ATTESTATION,
          operationData
        )
      ).to.be.revertedWith("NotPrimaryValidator()")
    })

    it("should prevent non-watchdog from challenging", async () => {
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
      const operationId = receipt.events?.find(e => e.event === "OperationSubmitted")?.args?.operationId

      const evidence = ethers.utils.formatBytes32String("Invalid")
      
      await expect(
        consensus.connect(attacker).challengeOperation(operationId, evidence)
      ).to.be.revertedWith("NotActiveWatchdog()")
    })

    it("should restrict emergency override to emergency role", async () => {
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
      const operationId = receipt.events?.find(e => e.event === "OperationSubmitted")?.args?.operationId

      const reason = ethers.utils.formatBytes32String("Emergency")
      
      await expect(
        consensus.connect(attacker).emergencyOverride(operationId, reason)
      ).to.be.reverted
    })
  })

  describe("Event Coverage Tests", () => {
    it("should emit DirectExecutionPerformed for adapter direct execution", async () => {
      // Setup mocks for adapter
      const mockLedger = await smock.fake("QCReserveLedger")
      protocolRegistry.getService.whenCalledWith(QC_RESERVE_LEDGER_KEY).returns(mockLedger.address)
      protocolRegistry.hasService.whenCalledWith(QC_RESERVE_LEDGER_KEY).returns(true)

      const qc = ethers.Wallet.createRandom().address
      const balance = ethers.utils.parseEther("100")

      await expect(
        adapter.connect(watchdog3).attestReserves(qc, balance)
      ).to.emit(adapter, "DirectExecutionPerformed")
    })
  })

  describe("Edge Case Tests", () => {
    it("should handle zero active watchdogs gracefully", async () => {
      // Remove all watchdogs except minimum
      const reason = ethers.utils.formatBytes32String("Test")
      await consensus.connect(governance).removeWatchdog(watchdog4.address, reason)
      await consensus.connect(governance).removeWatchdog(watchdog5.address, reason)

      // Try to remove below minimum
      await expect(
        consensus.connect(governance).removeWatchdog(watchdog3.address, reason)
      ).to.be.revertedWith("InsufficientWatchdogs()")
    })

    it("should handle operation with no data", async () => {
      const operationData = "0x"
      
      await expect(
        consensus.calculatePrimaryValidator(RESERVE_ATTESTATION, operationData)
      ).to.not.be.reverted
    })

    it("should handle maximum objection count", async () => {
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
      const operationId = receipt.events?.find(e => e.event === "OperationSubmitted")?.args?.operationId

      // Challenge with all other watchdogs
      const evidence = ethers.utils.formatBytes32String("Invalid")
      for (const watchdog of signers) {
        if (watchdog.address !== primaryValidator.address) {
          await consensus.connect(watchdog).challengeOperation(operationId, evidence)
        }
      }

      const operation = await consensus.getOperation(operationId)
      expect(operation.objectionCount).to.equal(4)
    })
  })
})

// Helper contract for reentrancy testing
contract MaliciousExecutor {
  address public target;
  bytes32 public operationId;
  
  function setTarget(address _target) external {
    target = _target;
  }
  
  function setOperationId(bytes32 _operationId) external {
    operationId = _operationId;
  }
  
  function executeOperation(bytes32, bytes calldata) external {
    // Attempt reentrancy
    IOptimisticWatchdogConsensus(target).executeOperation(operationId);
  }
}

interface IOptimisticWatchdogConsensus {
  function executeOperation(bytes32 operationId) external;
}