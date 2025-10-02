import { ethers, helpers, waffle } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { SystemState } from "../../../typechain"
import {
  createBaseTestEnvironment,
  restoreBaseTestEnvironment,
  TestSigners,
} from "../fixtures/base-setup"

const { loadFixture } = waffle
const { createSnapshot } = helpers.snapshot

describe("SystemState Security Tests", () => {
  let signers: TestSigners
  let pauser: SignerWithAddress
  let paramAdmin: SignerWithAddress
  let attacker: SignerWithAddress
  let attacker2: SignerWithAddress
  let emergencyCouncil: SignerWithAddress

  let systemState: SystemState

  // Role constants
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero

  const OPERATIONS_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("OPERATIONS_ROLE")
  )

  const EMERGENCY_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("EMERGENCY_ROLE")
  )

  async function fixture() {
    const testEnv = await createBaseTestEnvironment()
    signers = testEnv.signers

    const allSigners = await ethers.getSigners()
    // Use signers from TestSigners interface, plus additional security-focused signers
    pauser = allSigners[6]
    paramAdmin = allSigners[7]
    attacker = allSigners[8]
    attacker2 = allSigners[9]
    emergencyCouncil = allSigners[10]

    const SystemState = await ethers.getContractFactory("SystemState")
    systemState = await SystemState.deploy()

    // Setup roles with security-focused assignments
    await systemState.grantRole(DEFAULT_ADMIN_ROLE, signers.governance.address)
    await systemState.grantRole(EMERGENCY_ROLE, pauser.address)
    await systemState.grantRole(OPERATIONS_ROLE, paramAdmin.address)

    return {
      signers,
      pauser,
      paramAdmin,
      attacker,
      attacker2,
      emergencyCouncil,
      systemState,
    }
  }

  beforeEach(async () => {
    await createSnapshot()
  })

  afterEach(async () => {
    await restoreBaseTestEnvironment()
  })

  before(async () => {
    const contracts = await loadFixture(fixture)
    Object.assign(this, contracts)
  })

  describe("Pause Mechanism Security", () => {
    describe("Access Control", () => {
      it("should only allow EMERGENCY_ROLE to pause operations", async () => {
        // Attacker cannot pause
        await expect(
          systemState.connect(attacker).pauseMinting()
        ).to.be.revertedWith(
          `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${EMERGENCY_ROLE}`
        )

        // Pauser can pause
        const pauseTx = await systemState.connect(pauser).pauseMinting()
        const receipt = await pauseTx.wait()
        const block = await ethers.provider.getBlock(receipt.blockNumber)
        await expect(pauseTx)
          .to.emit(systemState, "MintingPaused")
          .withArgs(pauser.address, block.timestamp)
      })

      it("should only allow EMERGENCY_ROLE to unpause operations", async () => {
        await systemState.connect(pauser).pauseMinting()

        // Attacker cannot unpause
        await expect(
          systemState.connect(attacker).unpauseMinting()
        ).to.be.revertedWith(
          `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${EMERGENCY_ROLE}`
        )

        // Pauser can unpause
        const unpauseTx = await systemState.connect(pauser).unpauseMinting()
        const receipt = await unpauseTx.wait()
        const block = await ethers.provider.getBlock(receipt.blockNumber)
        await expect(unpauseTx)
          .to.emit(systemState, "MintingUnpaused")
          .withArgs(pauser.address, block.timestamp)
      })
    })

    describe("Pause State Management", () => {
      it("should prevent double pausing", async () => {
        await systemState.connect(pauser).pauseMinting()
        await expect(
          systemState.connect(pauser).pauseMinting()
        ).to.be.revertedWith("MintingAlreadyPaused")
      })

      it("should prevent unpausing when not paused", async () => {
        await expect(
          systemState.connect(pauser).unpauseMinting()
        ).to.be.revertedWith("MintingNotPaused")
      })

      it("should track pause timestamps", async () => {
        // Pause minting to set the timestamp
        const tx = await systemState.connect(pauser).pauseMinting()
        const receipt = await tx.wait()
        const block = await ethers.provider.getBlock(receipt.blockNumber)
        const pauseTime = block.timestamp

        const mintingPauseKey = ethers.utils.keccak256(
          ethers.utils.toUtf8Bytes("minting")
        )

        expect(await systemState.pauseTimestamps(mintingPauseKey)).to.equal(
          pauseTime
        )
      })

      it("should handle multiple pause types independently", async () => {
        // Pause different operations
        await systemState.connect(pauser).pauseMinting()
        expect(await systemState.isMintingPaused()).to.be.true
        expect(await systemState.isRedemptionPaused()).to.be.false

        await systemState.connect(pauser).pauseRedemption()
        expect(await systemState.isMintingPaused()).to.be.true
        expect(await systemState.isRedemptionPaused()).to.be.true

        // Unpause one doesn't affect the other
        await systemState.connect(pauser).unpauseMinting()
        expect(await systemState.isMintingPaused()).to.be.false
        expect(await systemState.isRedemptionPaused()).to.be.true
      })
    })

    describe("Emergency Pause Duration", () => {
      it("should enforce emergency pause duration limits", async () => {
        const maxDuration = 30 * 24 * 60 * 60 // 30 days
        await expect(
          systemState
            .connect(paramAdmin)
            .setEmergencyPauseDuration(maxDuration + 1)
        ).to.be.revertedWith("DurationTooLong")
      })

      it("should track pause duration for monitoring", async () => {
        await systemState.connect(pauser).pauseMinting()
        const block = await ethers.provider.getBlock("latest")
        const pauseTime = block.timestamp

        // Advance time
        await helpers.time.increaseTime(60 * 60) // 1 hour
        await ethers.provider.send("evm_mine", [])

        // Pause timestamp should be accessible for duration calculation
        const mintingPauseKey = ethers.utils.keccak256(
          ethers.utils.toUtf8Bytes("minting")
        )

        const pauseTimestamp = await systemState.pauseTimestamps(
          mintingPauseKey
        )

        expect(pauseTimestamp).to.equal(pauseTime)
      })
    })

    describe("Concurrent Pause Attempts", () => {
      it("should handle concurrent pause attempts safely", async () => {
        // Grant EMERGENCY_ROLE to multiple addresses
        await systemState
          .connect(signers.governance)
          .grantRole(EMERGENCY_ROLE, emergencyCouncil.address)

        // First pause succeeds
        await systemState.connect(pauser).pauseMinting()

        // Second pause attempt fails
        await expect(
          systemState.connect(emergencyCouncil).pauseMinting()
        ).to.be.revertedWith("MintingAlreadyPaused")
      })
    })
  })

  describe("Parameter Validation", () => {
    describe("Mint Amount Parameters", () => {
      it("should validate min/max relationship", async () => {
        await systemState
          .connect(paramAdmin)
          .setMaxMintAmount(ethers.utils.parseEther("1000"))

        // Cannot set min > max
        await expect(
          systemState
            .connect(paramAdmin)
            .setMinMintAmount(ethers.utils.parseEther("2000"))
        ).to.be.revertedWith("MinAmountExceedsMax")
      })

      it("should validate max >= min when setting max", async () => {
        await systemState
          .connect(paramAdmin)
          .setMinMintAmount(ethers.utils.parseEther("100"))

        // Cannot set max < min
        await expect(
          systemState
            .connect(paramAdmin)
            .setMaxMintAmount(ethers.utils.parseEther("50"))
        ).to.be.revertedWith("MaxAmountBelowMin")
      })

      it("should prevent zero amounts", async () => {
        await expect(
          systemState.connect(paramAdmin).setMinMintAmount(0)
        ).to.be.revertedWith("InvalidAmount")
      })
    })

    describe("Timeout Parameters", () => {
      it("should enforce redemption timeout limits", async () => {
        const maxTimeout = 30 * 24 * 60 * 60 // 30 days
        await expect(
          systemState.connect(paramAdmin).setRedemptionTimeout(maxTimeout + 1)
        ).to.be.revertedWith("TimeoutTooLong")
      })

      it("should prevent zero timeout", async () => {
        await expect(
          systemState.connect(paramAdmin).setRedemptionTimeout(0)
        ).to.be.revertedWith("InvalidTimeout")
      })
    })

    describe("Threshold Parameters", () => {
      it("should enforce stale threshold limits", async () => {
        const maxThreshold = 7 * 24 * 60 * 60 // 7 days
        await expect(
          systemState.connect(paramAdmin).setStaleThreshold(maxThreshold + 1)
        ).to.be.revertedWith("ThresholdTooLong")
      })

      it("should validate failure threshold", async () => {
        await expect(
          systemState.connect(paramAdmin).setFailureThreshold(0)
        ).to.be.revertedWith("InvalidThreshold")
      })
    })

    describe("Collateral Ratio", () => {
      it("should enforce collateral ratio bounds", async () => {
        // Cannot set below 100%
        await expect(
          systemState.connect(paramAdmin).setMinCollateralRatio(99)
        ).to.be.revertedWith("InvalidAmount")

        // Cannot set above 200%
        await expect(
          systemState.connect(paramAdmin).setMinCollateralRatio(201)
        ).to.be.revertedWith("InvalidAmount")
      })
    })
  })

  describe("Emergency Council", () => {
    it("should only allow PARAMETER_ADMIN to set emergency council", async () => {
      await expect(
        systemState
          .connect(attacker)
          .setEmergencyCouncil(emergencyCouncil.address)
      ).to.be.revertedWith(
        `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
      )
    })

    it("should prevent setting zero address as emergency council", async () => {
      await expect(
        systemState
          .connect(signers.governance)
          .setEmergencyCouncil(ethers.constants.AddressZero)
      ).to.be.revertedWith("InvalidCouncilAddress")
    })

    it("should emit event when setting emergency council", async () => {
      await expect(
        systemState
          .connect(signers.governance)
          .setEmergencyCouncil(emergencyCouncil.address)
      )
        .to.emit(systemState, "EmergencyCouncilUpdated")
        .withArgs(
          ethers.constants.AddressZero,
          emergencyCouncil.address,
          signers.governance.address
        )
    })
  })

  describe("Parameter Update Edge Cases", () => {
    it("should handle parameter updates at boundaries", async () => {
      // Set at minimum allowed
      await systemState.connect(paramAdmin).setMinCollateralRatio(100)
      expect(await systemState.minCollateralRatio()).to.equal(100)

      // Set at maximum allowed
      await systemState.connect(paramAdmin).setMinCollateralRatio(200)
      expect(await systemState.minCollateralRatio()).to.equal(200)
    })

    it("should handle rapid parameter updates", async () => {
      // Multiple updates in sequence
      for (let i = 100; i <= 150; i += 10) {
        await systemState.connect(paramAdmin).setMinCollateralRatio(i)
        expect(await systemState.minCollateralRatio()).to.equal(i)
      }
    })

    it("should maintain parameter consistency across updates", async () => {
      // Set initial parameters
      await systemState
        .connect(paramAdmin)
        .setMinMintAmount(ethers.utils.parseEther("10"))
      await systemState
        .connect(paramAdmin)
        .setMaxMintAmount(ethers.utils.parseEther("1000"))

      // Update min - should maintain relationship
      await systemState
        .connect(paramAdmin)
        .setMinMintAmount(ethers.utils.parseEther("100"))
      expect(await systemState.minMintAmount()).to.equal(
        ethers.utils.parseEther("100")
      )
      expect(await systemState.maxMintAmount()).to.equal(
        ethers.utils.parseEther("1000")
      )
    })
  })

  describe("View Function Security", () => {
    it("should properly expose pause state", async () => {
      expect(await systemState.isMintingPaused()).to.be.false
      await systemState.connect(pauser).pauseMinting()
      expect(await systemState.isMintingPaused()).to.be.true
    })

    it("should revert operations when paused", async () => {
      await systemState.connect(pauser).pauseMinting()

      // This tests the modifier behavior
      await expect(systemState.requireMintingNotPaused()).to.be.revertedWith(
        "MintingIsPaused"
      )
    })

    it("should expose all parameters correctly", async () => {
      // Set various parameters
      await systemState
        .connect(paramAdmin)
        .setMinMintAmount(ethers.utils.parseEther("10"))
      await systemState.connect(paramAdmin).setRedemptionTimeout(48 * 60 * 60)
      await systemState.connect(paramAdmin).setMinCollateralRatio(100)

      // Verify all are readable
      expect(await systemState.minMintAmount()).to.equal(
        ethers.utils.parseEther("10")
      )
      expect(await systemState.redemptionTimeout()).to.equal(48 * 60 * 60)
      expect(await systemState.minCollateralRatio()).to.equal(100)
    })
  })

  describe("Initialization Security", () => {
    it("should initialize with secure defaults", async () => {
      const freshSystemState = await (
        await ethers.getContractFactory("SystemState")
      ).deploy()

      // Check default values are sensible
      expect(await freshSystemState.minMintAmount()).to.equal(
        ethers.utils.parseEther("0.001")
      )
      expect(await freshSystemState.maxMintAmount()).to.equal(
        ethers.utils.parseEther("1000")
      )
      expect(await freshSystemState.redemptionTimeout()).to.equal(
        7 * 24 * 60 * 60
      ) // 7 days
      expect(await freshSystemState.staleThreshold()).to.equal(24 * 60 * 60) // 24 hours
      expect(await freshSystemState.minCollateralRatio()).to.equal(100) // 100%
    })

    it("should not be paused on deployment", async () => {
      const freshSystemState = await (
        await ethers.getContractFactory("SystemState")
      ).deploy()

      expect(await freshSystemState.isMintingPaused()).to.be.false
      expect(await freshSystemState.isRedemptionPaused()).to.be.false
      expect(await freshSystemState.isWalletRegistrationPaused()).to.be.false
    })
  })

  describe("Security Pattern Validation", () => {
    describe("Multi-Attacker Scenarios", () => {
      it("should resist coordinated attacks from multiple accounts", async () => {
        // Both attackers try to gain unauthorized access
        await expect(
          systemState.connect(attacker).pauseMinting()
        ).to.be.revertedWith(
          `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${EMERGENCY_ROLE}`
        )

        await expect(
          systemState.connect(attacker2).pauseMinting()
        ).to.be.revertedWith(
          `AccessControl: account ${attacker2.address.toLowerCase()} is missing role ${EMERGENCY_ROLE}`
        )
      })

      it("should prevent privilege escalation attempts", async () => {
        // Attacker tries to grant themselves roles
        await expect(
          systemState
            .connect(attacker)
            .grantRole(EMERGENCY_ROLE, attacker.address)
        ).to.be.revertedWith(
          `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
        )

        // Another attacker tries different role
        await expect(
          systemState
            .connect(attacker2)
            .grantRole(OPERATIONS_ROLE, attacker2.address)
        ).to.be.revertedWith(
          `AccessControl: account ${attacker2.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
        )
      })
    })

    describe("Role Hierarchy Protection", () => {
      it("should maintain strict role separation", async () => {
        // Parameter admin cannot pause (different role)
        await expect(
          systemState.connect(paramAdmin).pauseMinting()
        ).to.be.revertedWith(
          `AccessControl: account ${paramAdmin.address.toLowerCase()} is missing role ${EMERGENCY_ROLE}`
        )

        // Pauser cannot modify parameters (different role)
        await expect(
          systemState
            .connect(pauser)
            .setMinMintAmount(ethers.utils.parseEther("100"))
        ).to.be.revertedWith(
          `AccessControl: account ${pauser.address.toLowerCase()} is missing role ${OPERATIONS_ROLE}`
        )
      })
    })

    describe("Input Validation Security", () => {
      it("should validate all input parameters comprehensively", async () => {
        // Test boundary conditions that could cause overflows or underflows
        const maxUint256 = ethers.constants.MaxUint256

        // These should fail with proper validation
        await expect(
          systemState.connect(paramAdmin).setMinMintAmount(maxUint256)
        ).to.be.reverted

        await expect(
          systemState.connect(paramAdmin).setRedemptionTimeout(maxUint256)
        ).to.be.reverted
      })
    })
  })
})
