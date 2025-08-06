import { ethers, helpers, waffle } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { SystemState } from "../../typechain"
import { time } from "@nomicfoundation/hardhat-network-helpers"

const { loadFixture } = waffle
const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("SystemState Security Tests", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let pauser: SignerWithAddress
  let paramAdmin: SignerWithAddress
  let attacker: SignerWithAddress
  let emergencyCouncil: SignerWithAddress

  let systemState: SystemState

  // Role constants
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
  const PARAMETER_ADMIN_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("PARAMETER_ADMIN_ROLE")
  )
  const PAUSER_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("PAUSER_ROLE")
  )

  async function fixture() {
    const signers = await ethers.getSigners()
    ;[deployer, governance, pauser, paramAdmin, attacker, emergencyCouncil] =
      signers

    const SystemState = await ethers.getContractFactory("SystemState")
    systemState = await SystemState.deploy()

    // Setup roles
    await systemState.grantRole(DEFAULT_ADMIN_ROLE, governance.address)
    await systemState.grantRole(PAUSER_ROLE, pauser.address)
    await systemState.grantRole(PARAMETER_ADMIN_ROLE, paramAdmin.address)

    return {
      deployer,
      governance,
      pauser,
      paramAdmin,
      attacker,
      emergencyCouncil,
      systemState,
    }
  }

  beforeEach(async () => {
    await createSnapshot()
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  before(async () => {
    const contracts = await loadFixture(fixture)
    Object.assign(this, contracts)
  })

  describe("Pause Mechanism Security", () => {
    describe("Access Control", () => {
      it("should only allow PAUSER_ROLE to pause operations", async () => {
        // Attacker cannot pause
        await expect(
          systemState.connect(attacker).pauseMinting()
        ).to.be.revertedWith(
          `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${PAUSER_ROLE}`
        )

        // Pauser can pause
        await expect(systemState.connect(pauser).pauseMinting())
          .to.emit(systemState, "MintingPaused")
          .withArgs(pauser.address)
      })

      it("should only allow PAUSER_ROLE to unpause operations", async () => {
        await systemState.connect(pauser).pauseMinting()

        // Attacker cannot unpause
        await expect(
          systemState.connect(attacker).unpauseMinting()
        ).to.be.revertedWith(
          `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${PAUSER_ROLE}`
        )

        // Pauser can unpause
        await expect(systemState.connect(pauser).unpauseMinting())
          .to.emit(systemState, "MintingUnpaused")
          .withArgs(pauser.address)
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
        const pauseTx = await systemState.connect(pauser).pauseMinting()
        const pauseTime = await time.latest()

        const mintingPauseKey = ethers.utils.keccak256(
          ethers.utils.toUtf8Bytes("MINTING_PAUSE")
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
        const pauseTime = await time.latest()

        // Advance time
        await time.increase(60 * 60) // 1 hour

        // Pause timestamp should be accessible for duration calculation
        const mintingPauseKey = ethers.utils.keccak256(
          ethers.utils.toUtf8Bytes("MINTING_PAUSE")
        )
        const pauseTimestamp = await systemState.pauseTimestamps(
          mintingPauseKey
        )
        expect(pauseTimestamp).to.equal(pauseTime)
      })
    })

    describe("Concurrent Pause Attempts", () => {
      it("should handle concurrent pause attempts safely", async () => {
        // Grant PAUSER_ROLE to multiple addresses
        await systemState
          .connect(governance)
          .grantRole(PAUSER_ROLE, emergencyCouncil.address)

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
        `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${PARAMETER_ADMIN_ROLE}`
      )
    })

    it("should prevent setting zero address as emergency council", async () => {
      await expect(
        systemState
          .connect(paramAdmin)
          .setEmergencyCouncil(ethers.constants.AddressZero)
      ).to.be.revertedWith("InvalidCouncilAddress")
    })

    it("should emit event when setting emergency council", async () => {
      await expect(
        systemState
          .connect(paramAdmin)
          .setEmergencyCouncil(emergencyCouncil.address)
      )
        .to.emit(systemState, "EmergencyCouncilUpdated")
        .withArgs(
          ethers.constants.AddressZero,
          emergencyCouncil.address,
          paramAdmin.address
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
        ethers.utils.parseEther("0.01")
      )
      expect(await freshSystemState.maxMintAmount()).to.equal(
        ethers.utils.parseEther("21000000")
      )
      expect(await freshSystemState.redemptionTimeout()).to.equal(48 * 60 * 60) // 48 hours
      expect(await freshSystemState.staleThreshold()).to.equal(24 * 60 * 60) // 24 hours
      expect(await freshSystemState.minCollateralRatio()).to.equal(100) // 100%
    })

    it("should not be paused on deployment", async () => {
      const freshSystemState = await (
        await ethers.getContractFactory("SystemState")
      ).deploy()

      expect(await freshSystemState.isMintingPaused()).to.be.false
      expect(await freshSystemState.isRedemptionPaused()).to.be.false
      expect(await freshSystemState.isRegistryPaused()).to.be.false
      expect(await freshSystemState.isWalletRegistrationPaused()).to.be.false
    })
  })
})
