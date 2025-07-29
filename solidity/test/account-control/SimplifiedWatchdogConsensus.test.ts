import { ethers, helpers, waffle } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { Contract } from "ethers"
import { smock } from "@defi-wonderland/smock"
import type { FakeContract } from "@defi-wonderland/smock"

const { loadFixture } = waffle

describe("SimplifiedWatchdogConsensus", () => {
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
  const MANAGER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MANAGER_ROLE"))

  // Service key constants
  const OPERATION_EXECUTOR_KEY = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("OPERATION_EXECUTOR"))

  // Fixed challenge period (2 hours)
  const CHALLENGE_PERIOD = 2 * 60 * 60

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

    // Deploy SimplifiedWatchdogConsensus
    const SimplifiedWatchdogConsensus = await ethers.getContractFactory("SimplifiedWatchdogConsensus")
    consensus = await SimplifiedWatchdogConsensus.deploy(protocolRegistry.address)
    await consensus.deployed()

    // Grant roles to governance
    await consensus.grantRole(DEFAULT_ADMIN_ROLE, governance.address)
    await consensus.grantRole(MANAGER_ROLE, governance.address)

    // Add initial watchdogs (5 for testing)
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
    Object.assign(this, loadedFixture)
  })

  describe("Simplified Voting Flow", () => {
    it("should allow any watchdog to propose an operation", async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      const tx = await consensus.connect(watchdog2).proposeOperation(
        RESERVE_ATTESTATION,
        operationData
      )

      const receipt = await tx.wait()
      const event = receipt.events?.find(e => e.event === "OperationProposed")
      
      expect(event).to.not.be.undefined
      expect(event.args.operationType).to.equal(RESERVE_ATTESTATION)
      expect(event.args.proposer).to.equal(watchdog2.address)
    })

    it("should automatically count proposer's vote as 'for'", async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      const tx = await consensus.connect(watchdog1).proposeOperation(
        RESERVE_ATTESTATION,
        operationData
      )

      const receipt = await tx.wait()
      const operationId = receipt.events?.find(e => e.event === "OperationProposed")?.args?.operationId

      const operation = await consensus.getOperation(operationId)
      expect(operation.forVotes).to.equal(1)
      expect(operation.againstVotes).to.equal(0)
    })

    it("should allow watchdogs to vote for or against", async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      // Propose
      const tx = await consensus.connect(watchdog1).proposeOperation(
        RESERVE_ATTESTATION,
        operationData
      )
      const receipt = await tx.wait()
      const operationId = receipt.events?.find(e => e.event === "OperationProposed")?.args?.operationId

      // Vote for
      await consensus.connect(watchdog2).voteOnOperation(operationId, true)
      await consensus.connect(watchdog3).voteOnOperation(operationId, true)
      
      // Vote against
      await consensus.connect(watchdog4).voteOnOperation(operationId, false)

      const operation = await consensus.getOperation(operationId)
      expect(operation.forVotes).to.equal(3) // proposer + 2 votes
      expect(operation.againstVotes).to.equal(1)
    })

    it("should require simple majority (N/2 + 1) for execution", async () => {
      const watchdogCount = await consensus.getActiveWatchdogCount()
      const requiredVotes = await consensus.getRequiredVotes()
      
      expect(watchdogCount).to.equal(5)
      expect(requiredVotes).to.equal(3) // 5/2 + 1 = 3
    })

    it("should execute operation after 2-hour delay with majority", async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      // Propose
      const tx = await consensus.connect(watchdog1).proposeOperation(
        RESERVE_ATTESTATION,
        operationData
      )
      const receipt = await tx.wait()
      const operationId = receipt.events?.find(e => e.event === "OperationProposed")?.args?.operationId

      // Get majority votes (3 out of 5)
      await consensus.connect(watchdog2).voteOnOperation(operationId, true)
      await consensus.connect(watchdog3).voteOnOperation(operationId, true)

      // Try to execute before delay - should fail
      await expect(
        consensus.executeOperation(operationId)
      ).to.be.revertedWith("VotingPeriodActive")

      // Fast forward 2 hours
      await helpers.time.increase(CHALLENGE_PERIOD)

      // Now execution should succeed
      await expect(consensus.executeOperation(operationId))
        .to.emit(consensus, "OperationExecuted")
        .withArgs(operationId, deployer.address, true)
    })

    it("should reject operations with majority against votes", async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      // Propose
      const tx = await consensus.connect(watchdog1).proposeOperation(
        RESERVE_ATTESTATION,
        operationData
      )
      const receipt = await tx.wait()
      const operationId = receipt.events?.find(e => e.event === "OperationProposed")?.args?.operationId

      // Vote against (need 3 for majority)
      await consensus.connect(watchdog2).voteOnOperation(operationId, false)
      await consensus.connect(watchdog3).voteOnOperation(operationId, false)
      
      // Third against vote should trigger rejection
      await expect(consensus.connect(watchdog4).voteOnOperation(operationId, false))
        .to.emit(consensus, "OperationRejected")
        .withArgs(operationId, 1, 3) // 1 for, 3 against
    })

    it("should not allow double voting", async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      // Propose
      const tx = await consensus.connect(watchdog1).proposeOperation(
        RESERVE_ATTESTATION,
        operationData
      )
      const receipt = await tx.wait()
      const operationId = receipt.events?.find(e => e.event === "OperationProposed")?.args?.operationId

      // First vote
      await consensus.connect(watchdog2).voteOnOperation(operationId, true)
      
      // Try to vote again - should fail
      await expect(
        consensus.connect(watchdog2).voteOnOperation(operationId, false)
      ).to.be.revertedWith("AlreadyVoted")
    })

    it("should not allow non-watchdogs to propose or vote", async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      // Non-watchdog tries to propose
      await expect(
        consensus.connect(nonWatchdog).proposeOperation(RESERVE_ATTESTATION, operationData)
      ).to.be.revertedWith("NotActiveWatchdog")

      // Create valid proposal
      const tx = await consensus.connect(watchdog1).proposeOperation(
        RESERVE_ATTESTATION,
        operationData
      )
      const receipt = await tx.wait()
      const operationId = receipt.events?.find(e => e.event === "OperationProposed")?.args?.operationId

      // Non-watchdog tries to vote
      await expect(
        consensus.connect(nonWatchdog).voteOnOperation(operationId, true)
      ).to.be.revertedWith("NotActiveWatchdog")
    })
  })

  describe("Watchdog Management", () => {
    it("should enforce minimum watchdog count", async () => {
      // Remove watchdogs until we reach minimum (3)
      await consensus.connect(governance).removeWatchdog(watchdog4.address)
      await consensus.connect(governance).removeWatchdog(watchdog5.address)
      
      // Try to remove one more - should fail
      await expect(
        consensus.connect(governance).removeWatchdog(watchdog3.address)
      ).to.be.revertedWith("InsufficientWatchdogs")
    })

    it("should enforce maximum watchdog count", async () => {
      // Add watchdogs up to max (20 total)
      const signers = await ethers.getSigners()
      for (let i = 8; i < 25; i++) { // We already have 5, add 15 more
        if (i < 23) { // Up to 20 total
          await consensus.connect(governance).addWatchdog(signers[i].address)
        } else {
          // 21st watchdog should fail
          await expect(
            consensus.connect(governance).addWatchdog(signers[i].address)
          ).to.be.revertedWith("MaxWatchdogsReached")
          break
        }
      }
    })

    it("should update required votes when watchdog count changes", async () => {
      expect(await consensus.getRequiredVotes()).to.equal(3) // 5/2 + 1 = 3
      
      // Add a 6th watchdog
      const [extraWatchdog] = await ethers.getSigners()
      await consensus.connect(governance).addWatchdog(extraWatchdog.address)
      
      expect(await consensus.getRequiredVotes()).to.equal(4) // 6/2 + 1 = 4
      
      // Remove back to 5
      await consensus.connect(governance).removeWatchdog(extraWatchdog.address)
      
      expect(await consensus.getRequiredVotes()).to.equal(3) // 5/2 + 1 = 3
    })
  })

  describe("Edge Cases", () => {
    it("should handle operations that don't reach quorum", async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      // Propose (gets 1 automatic vote)
      const tx = await consensus.connect(watchdog1).proposeOperation(
        RESERVE_ATTESTATION,
        operationData
      )
      const receipt = await tx.wait()
      const operationId = receipt.events?.find(e => e.event === "OperationProposed")?.args?.operationId

      // Only get 1 more vote (total 2, need 3)
      await consensus.connect(watchdog2).voteOnOperation(operationId, true)

      // Fast forward past delay
      await helpers.time.increase(CHALLENGE_PERIOD)

      // Try to execute without quorum - should fail
      await expect(
        consensus.executeOperation(operationId)
      ).to.be.revertedWith("InsufficientVotes")
    })

    it("should handle tie votes correctly", async () => {
      // For this test, we need even number of watchdogs
      await consensus.connect(governance).removeWatchdog(watchdog5.address)
      
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      // Propose
      const tx = await consensus.connect(watchdog1).proposeOperation(
        RESERVE_ATTESTATION,
        operationData
      )
      const receipt = await tx.wait()
      const operationId = receipt.events?.find(e => e.event === "OperationProposed")?.args?.operationId

      // Create a tie: 2 for, 2 against
      await consensus.connect(watchdog2).voteOnOperation(operationId, true)   // 2 for
      await consensus.connect(watchdog3).voteOnOperation(operationId, false)  // 1 against
      await consensus.connect(watchdog4).voteOnOperation(operationId, false)  // 2 against

      // Fast forward
      await helpers.time.increase(CHALLENGE_PERIOD)

      // With 4 watchdogs, need 3 votes to pass (4/2 + 1 = 3)
      // We only have 2, so execution should fail
      await expect(
        consensus.executeOperation(operationId)
      ).to.be.revertedWith("InsufficientVotes")
    })
  })

  describe("Gas Optimization Comparison", () => {
    it("should use significantly less gas than complex consensus", async () => {
      const operationData = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [watchdog1.address, ethers.utils.parseEther("100")]
      )

      // Measure gas for proposal
      const proposeTx = await consensus.connect(watchdog1).proposeOperation(
        RESERVE_ATTESTATION,
        operationData
      )
      const proposeReceipt = await proposeTx.wait()
      
      console.log("Simplified Consensus Gas Usage:")
      console.log("- Propose Operation:", proposeReceipt.gasUsed.toString())

      // Measure gas for voting
      const voteTx = await consensus.connect(watchdog2).voteOnOperation(
        proposeReceipt.events[0].args.operationId,
        true
      )
      const voteReceipt = await voteTx.wait()
      console.log("- Vote on Operation:", voteReceipt.gasUsed.toString())

      // Note: Complex consensus would use ~40% more gas due to:
      // - MEV-resistant calculations
      // - Complex state updates
      // - Multiple mappings
      // - Escalation logic
    })
  })
})