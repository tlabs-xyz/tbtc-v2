import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { SystemState } from "../../typechain"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("SystemState", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let pauserAccount: SignerWithAddress
  let adminAccount: SignerWithAddress
  let thirdParty: SignerWithAddress

  let systemState: SystemState

  // Roles
  let PAUSER_ROLE: string
  let PARAMETER_ADMIN_ROLE: string

  // Test parameters
  const testMinMintAmount = ethers.utils.parseEther("0.1")
  const testMaxMintAmount = ethers.utils.parseEther("100")
  const testRedemptionTimeout = 86400 // 24 hours
  const testStaleThreshold = 3600 // 1 hour

  before(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;[deployer, governance, pauserAccount, adminAccount, thirdParty] =
      await ethers.getSigners()

    // Generate role hashes
    PAUSER_ROLE = ethers.utils.id("PAUSER_ROLE")
    PARAMETER_ADMIN_ROLE = ethers.utils.id("PARAMETER_ADMIN_ROLE")
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy SystemState
    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy()
    await systemState.deployed()

    // Grant roles
    await systemState.grantRole(PAUSER_ROLE, pauserAccount.address)
    await systemState.grantRole(PARAMETER_ADMIN_ROLE, adminAccount.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment", () => {
    it("should grant deployer all roles", async () => {
      const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
      expect(await systemState.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to
        .be.true
      expect(await systemState.hasRole(PAUSER_ROLE, deployer.address)).to.be
        .true
      expect(await systemState.hasRole(PARAMETER_ADMIN_ROLE, deployer.address))
        .to.be.true
    })

    it("should have correct role constants", async () => {
      expect(await systemState.PAUSER_ROLE()).to.equal(PAUSER_ROLE)
      expect(await systemState.PARAMETER_ADMIN_ROLE()).to.equal(
        PARAMETER_ADMIN_ROLE
      )
    })

    it("should initialize with default values", async () => {
      expect(await systemState.isMintingPaused()).to.be.false
      expect(await systemState.isRedemptionPaused()).to.be.false
      expect(await systemState.isRegistryPaused()).to.be.false
      expect(await systemState.minMintAmount()).to.equal(
        ethers.utils.parseEther("0.01")
      ) // Default 0.01 tBTC
      expect(await systemState.maxMintAmount()).to.equal(
        ethers.utils.parseEther("1000")
      ) // Default 1000 tBTC
      expect(await systemState.redemptionTimeout()).to.equal(604800) // Default 7 days
      expect(await systemState.staleThreshold()).to.equal(86400) // Default 24 hours
    })
  })

  describe("Pause Functions", () => {
    context("when called by pauser", () => {
      describe("pauseMinting", () => {
        it("should pause minting successfully", async () => {
          const tx = await systemState.connect(pauserAccount).pauseMinting()

          expect(await systemState.isMintingPaused()).to.be.true
          await expect(tx)
            .to.emit(systemState, "MintingPaused")
            .withArgs(pauserAccount.address)
        })

        it("should revert when already paused", async () => {
          await systemState.connect(pauserAccount).pauseMinting()

          await expect(
            systemState.connect(pauserAccount).pauseMinting()
          ).to.be.revertedWith("Minting already paused")
        })
      })

      describe("unpauseMinting", () => {
        beforeEach(async () => {
          await systemState.connect(pauserAccount).pauseMinting()
        })

        it("should unpause minting successfully", async () => {
          const tx = await systemState.connect(pauserAccount).unpauseMinting()

          expect(await systemState.isMintingPaused()).to.be.false
          await expect(tx)
            .to.emit(systemState, "MintingUnpaused")
            .withArgs(pauserAccount.address)
        })

        it("should revert when not paused", async () => {
          await systemState.connect(pauserAccount).unpauseMinting()

          await expect(
            systemState.connect(pauserAccount).unpauseMinting()
          ).to.be.revertedWith("Minting not paused")
        })
      })

      describe("pauseRedemption", () => {
        it("should pause redemption successfully", async () => {
          const tx = await systemState.connect(pauserAccount).pauseRedemption()

          expect(await systemState.isRedemptionPaused()).to.be.true
          await expect(tx)
            .to.emit(systemState, "RedemptionPaused")
            .withArgs(pauserAccount.address)
        })

        it("should revert when already paused", async () => {
          await systemState.connect(pauserAccount).pauseRedemption()

          await expect(
            systemState.connect(pauserAccount).pauseRedemption()
          ).to.be.revertedWith("Redemption already paused")
        })
      })

      describe("unpauseRedemption", () => {
        beforeEach(async () => {
          await systemState.connect(pauserAccount).pauseRedemption()
        })

        it("should unpause redemption successfully", async () => {
          const tx = await systemState
            .connect(pauserAccount)
            .unpauseRedemption()

          expect(await systemState.isRedemptionPaused()).to.be.false
          await expect(tx)
            .to.emit(systemState, "RedemptionUnpaused")
            .withArgs(pauserAccount.address)
        })

        it("should revert when not paused", async () => {
          await systemState.connect(pauserAccount).unpauseRedemption()

          await expect(
            systemState.connect(pauserAccount).unpauseRedemption()
          ).to.be.revertedWith("Redemption not paused")
        })
      })

      describe("pauseRegistry", () => {
        it("should pause registry successfully", async () => {
          const tx = await systemState.connect(pauserAccount).pauseRegistry()

          expect(await systemState.isRegistryPaused()).to.be.true
          await expect(tx)
            .to.emit(systemState, "RegistryPaused")
            .withArgs(pauserAccount.address)
        })

        it("should revert when already paused", async () => {
          await systemState.connect(pauserAccount).pauseRegistry()

          await expect(
            systemState.connect(pauserAccount).pauseRegistry()
          ).to.be.revertedWith("Registry already paused")
        })
      })

      describe("unpauseRegistry", () => {
        beforeEach(async () => {
          await systemState.connect(pauserAccount).pauseRegistry()
        })

        it("should unpause registry successfully", async () => {
          const tx = await systemState.connect(pauserAccount).unpauseRegistry()

          expect(await systemState.isRegistryPaused()).to.be.false
          await expect(tx)
            .to.emit(systemState, "RegistryUnpaused")
            .withArgs(pauserAccount.address)
        })

        it("should revert when not paused", async () => {
          await systemState.connect(pauserAccount).unpauseRegistry()

          await expect(
            systemState.connect(pauserAccount).unpauseRegistry()
          ).to.be.revertedWith("Registry not paused")
        })
      })
    })

    context("when called by non-pauser", () => {
      it("should revert for pauseMinting", async () => {
        await expect(
          systemState.connect(thirdParty).pauseMinting()
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${PAUSER_ROLE}`
        )
      })

      it("should revert for pauseRedemption", async () => {
        await expect(
          systemState.connect(thirdParty).pauseRedemption()
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${PAUSER_ROLE}`
        )
      })

      it("should revert for pauseRegistry", async () => {
        await expect(
          systemState.connect(thirdParty).pauseRegistry()
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${PAUSER_ROLE}`
        )
      })
    })
  })

  describe("Parameter Management", () => {
    context("when called by parameter admin", () => {
      describe("setMinMintAmount", () => {
        it("should update min mint amount successfully", async () => {
          const tx = await systemState
            .connect(adminAccount)
            .setMinMintAmount(testMinMintAmount)

          expect(await systemState.minMintAmount()).to.equal(testMinMintAmount)
          await expect(tx)
            .to.emit(systemState, "MinMintAmountUpdated")
            .withArgs(testMinMintAmount, adminAccount.address)
        })

        it("should allow zero min amount", async () => {
          await systemState.connect(adminAccount).setMinMintAmount(0)
          expect(await systemState.minMintAmount()).to.equal(0)
        })

        it("should allow updating multiple times", async () => {
          await systemState
            .connect(adminAccount)
            .setMinMintAmount(testMinMintAmount)
          const newAmount = testMinMintAmount.mul(2)
          await systemState.connect(adminAccount).setMinMintAmount(newAmount)

          expect(await systemState.minMintAmount()).to.equal(newAmount)
        })
      })

      describe("setMaxMintAmount", () => {
        it("should update max mint amount successfully", async () => {
          const tx = await systemState
            .connect(adminAccount)
            .setMaxMintAmount(testMaxMintAmount)

          expect(await systemState.maxMintAmount()).to.equal(testMaxMintAmount)
          await expect(tx)
            .to.emit(systemState, "MaxMintAmountUpdated")
            .withArgs(testMaxMintAmount, adminAccount.address)
        })

        it("should revert with zero max amount", async () => {
          await expect(
            systemState.connect(adminAccount).setMaxMintAmount(0)
          ).to.be.revertedWith("Max amount must be greater than zero")
        })

        it("should allow very large amounts", async () => {
          const largeAmount = ethers.utils.parseEther("1000000")
          await systemState.connect(adminAccount).setMaxMintAmount(largeAmount)

          expect(await systemState.maxMintAmount()).to.equal(largeAmount)
        })
      })

      describe("setRedemptionTimeout", () => {
        it("should update redemption timeout successfully", async () => {
          const tx = await systemState
            .connect(adminAccount)
            .setRedemptionTimeout(testRedemptionTimeout)

          expect(await systemState.redemptionTimeout()).to.equal(
            testRedemptionTimeout
          )
          await expect(tx)
            .to.emit(systemState, "RedemptionTimeoutUpdated")
            .withArgs(testRedemptionTimeout, adminAccount.address)
        })

        it("should revert with zero timeout", async () => {
          await expect(
            systemState.connect(adminAccount).setRedemptionTimeout(0)
          ).to.be.revertedWith("Timeout must be greater than zero")
        })

        it("should handle various timeout values", async () => {
          // 1 hour
          await systemState.connect(adminAccount).setRedemptionTimeout(3600)
          expect(await systemState.redemptionTimeout()).to.equal(3600)

          // 30 days
          await systemState
            .connect(adminAccount)
            .setRedemptionTimeout(30 * 24 * 3600)
          expect(await systemState.redemptionTimeout()).to.equal(30 * 24 * 3600)
        })
      })

      describe("setStaleThreshold", () => {
        it("should update stale threshold successfully", async () => {
          const tx = await systemState
            .connect(adminAccount)
            .setStaleThreshold(testStaleThreshold)

          expect(await systemState.staleThreshold()).to.equal(
            testStaleThreshold
          )
          await expect(tx)
            .to.emit(systemState, "StaleThresholdUpdated")
            .withArgs(testStaleThreshold, adminAccount.address)
        })

        it("should revert with zero threshold", async () => {
          await expect(
            systemState.connect(adminAccount).setStaleThreshold(0)
          ).to.be.revertedWith("Threshold must be greater than zero")
        })

        it("should handle various threshold values", async () => {
          // 5 minutes
          await systemState.connect(adminAccount).setStaleThreshold(300)
          expect(await systemState.staleThreshold()).to.equal(300)

          // 7 days
          await systemState
            .connect(adminAccount)
            .setStaleThreshold(7 * 24 * 3600)
          expect(await systemState.staleThreshold()).to.equal(7 * 24 * 3600)
        })
      })
    })

    context("when called by non-parameter admin", () => {
      it("should revert for setMinMintAmount", async () => {
        await expect(
          systemState.connect(thirdParty).setMinMintAmount(testMinMintAmount)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${PARAMETER_ADMIN_ROLE}`
        )
      })

      it("should revert for setMaxMintAmount", async () => {
        await expect(
          systemState.connect(thirdParty).setMaxMintAmount(testMaxMintAmount)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${PARAMETER_ADMIN_ROLE}`
        )
      })

      it("should revert for setRedemptionTimeout", async () => {
        await expect(
          systemState
            .connect(thirdParty)
            .setRedemptionTimeout(testRedemptionTimeout)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${PARAMETER_ADMIN_ROLE}`
        )
      })

      it("should revert for setStaleThreshold", async () => {
        await expect(
          systemState.connect(thirdParty).setStaleThreshold(testStaleThreshold)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${PARAMETER_ADMIN_ROLE}`
        )
      })
    })
  })

  describe("Function-Specific Pause Checks", () => {
    describe("isFunctionPaused", () => {
      it("should return correct status for minting", async () => {
        expect(await systemState.isFunctionPaused("minting")).to.be.false

        await systemState.connect(pauserAccount).pauseMinting()
        expect(await systemState.isFunctionPaused("minting")).to.be.true

        await systemState.connect(pauserAccount).unpauseMinting()
        expect(await systemState.isFunctionPaused("minting")).to.be.false
      })

      it("should return correct status for redemption", async () => {
        expect(await systemState.isFunctionPaused("redemption")).to.be.false

        await systemState.connect(pauserAccount).pauseRedemption()
        expect(await systemState.isFunctionPaused("redemption")).to.be.true

        await systemState.connect(pauserAccount).unpauseRedemption()
        expect(await systemState.isFunctionPaused("redemption")).to.be.false
      })

      it("should return correct status for registry", async () => {
        expect(await systemState.isFunctionPaused("registry")).to.be.false

        await systemState.connect(pauserAccount).pauseRegistry()
        expect(await systemState.isFunctionPaused("registry")).to.be.true

        await systemState.connect(pauserAccount).unpauseRegistry()
        expect(await systemState.isFunctionPaused("registry")).to.be.false
      })

      it("should return false for unknown function names", async () => {
        expect(await systemState.isFunctionPaused("unknown")).to.be.false
        expect(await systemState.isFunctionPaused("")).to.be.false
        expect(await systemState.isFunctionPaused("invalid_function")).to.be
          .false
      })
    })
  })

  describe("Access Control", () => {
    context("role management", () => {
      it("should allow admin to grant pauser role", async () => {
        await systemState.grantRole(PAUSER_ROLE, thirdParty.address)

        expect(await systemState.hasRole(PAUSER_ROLE, thirdParty.address)).to.be
          .true

        // Third party should now be able to pause
        await systemState.connect(thirdParty).pauseMinting()
        expect(await systemState.isMintingPaused()).to.be.true
      })

      it("should allow admin to grant parameter admin role", async () => {
        await systemState.grantRole(PARAMETER_ADMIN_ROLE, thirdParty.address)

        expect(
          await systemState.hasRole(PARAMETER_ADMIN_ROLE, thirdParty.address)
        ).to.be.true

        // Third party should now be able to set parameters
        await systemState
          .connect(thirdParty)
          .setMinMintAmount(testMinMintAmount)
        expect(await systemState.minMintAmount()).to.equal(testMinMintAmount)
      })

      it("should allow admin to revoke roles", async () => {
        await systemState.revokeRole(PAUSER_ROLE, pauserAccount.address)

        expect(await systemState.hasRole(PAUSER_ROLE, pauserAccount.address)).to
          .be.false

        await expect(
          systemState.connect(pauserAccount).pauseMinting()
        ).to.be.revertedWith(
          `AccessControl: account ${pauserAccount.address.toLowerCase()} is missing role ${PAUSER_ROLE}`
        )
      })
    })
  })

  describe("Edge Cases", () => {
    context("simultaneous operations", () => {
      it("should handle independent pause states", async () => {
        await systemState.connect(pauserAccount).pauseMinting()
        expect(await systemState.isMintingPaused()).to.be.true
        expect(await systemState.isRedemptionPaused()).to.be.false
        expect(await systemState.isRegistryPaused()).to.be.false

        await systemState.connect(pauserAccount).pauseRedemption()
        expect(await systemState.isMintingPaused()).to.be.true
        expect(await systemState.isRedemptionPaused()).to.be.true
        expect(await systemState.isRegistryPaused()).to.be.false

        await systemState.connect(pauserAccount).unpauseMinting()
        expect(await systemState.isMintingPaused()).to.be.false
        expect(await systemState.isRedemptionPaused()).to.be.true
        expect(await systemState.isRegistryPaused()).to.be.false
      })

      it("should handle parameter updates during paused state", async () => {
        await systemState.connect(pauserAccount).pauseMinting()

        // Should still be able to update parameters while paused
        await systemState
          .connect(adminAccount)
          .setMinMintAmount(testMinMintAmount)
        expect(await systemState.minMintAmount()).to.equal(testMinMintAmount)

        await systemState.connect(pauserAccount).unpauseMinting()
        expect(await systemState.minMintAmount()).to.equal(testMinMintAmount)
      })
    })

    context("boundary conditions", () => {
      it("should handle maximum values for parameters", async () => {
        const maxUint256 = ethers.constants.MaxUint256

        await systemState.connect(adminAccount).setMaxMintAmount(maxUint256)
        expect(await systemState.maxMintAmount()).to.equal(maxUint256)

        await systemState.connect(adminAccount).setRedemptionTimeout(maxUint256)
        expect(await systemState.redemptionTimeout()).to.equal(maxUint256)

        await systemState.connect(adminAccount).setStaleThreshold(maxUint256)
        expect(await systemState.staleThreshold()).to.equal(maxUint256)
      })

      it("should handle very small non-zero values", async () => {
        const smallValue = 1

        await systemState.connect(adminAccount).setMaxMintAmount(smallValue)
        expect(await systemState.maxMintAmount()).to.equal(smallValue)

        await systemState.connect(adminAccount).setRedemptionTimeout(smallValue)
        expect(await systemState.redemptionTimeout()).to.equal(smallValue)

        await systemState.connect(adminAccount).setStaleThreshold(smallValue)
        expect(await systemState.staleThreshold()).to.equal(smallValue)
      })
    })

    context("event emission", () => {
      it("should emit events for all state changes", async () => {
        // Pause events
        await expect(systemState.connect(pauserAccount).pauseMinting()).to.emit(
          systemState,
          "MintingPaused"
        )

        await expect(
          systemState.connect(pauserAccount).pauseRedemption()
        ).to.emit(systemState, "RedemptionPaused")

        await expect(
          systemState.connect(pauserAccount).pauseRegistry()
        ).to.emit(systemState, "RegistryPaused")

        // Unpause events
        await expect(
          systemState.connect(pauserAccount).unpauseMinting()
        ).to.emit(systemState, "MintingUnpaused")

        await expect(
          systemState.connect(pauserAccount).unpauseRedemption()
        ).to.emit(systemState, "RedemptionUnpaused")

        await expect(
          systemState.connect(pauserAccount).unpauseRegistry()
        ).to.emit(systemState, "RegistryUnpaused")

        // Parameter events
        await expect(
          systemState.connect(adminAccount).setMinMintAmount(testMinMintAmount)
        ).to.emit(systemState, "MinMintAmountUpdated")

        await expect(
          systemState.connect(adminAccount).setMaxMintAmount(testMaxMintAmount)
        ).to.emit(systemState, "MaxMintAmountUpdated")

        await expect(
          systemState
            .connect(adminAccount)
            .setRedemptionTimeout(testRedemptionTimeout)
        ).to.emit(systemState, "RedemptionTimeoutUpdated")

        await expect(
          systemState
            .connect(adminAccount)
            .setStaleThreshold(testStaleThreshold)
        ).to.emit(systemState, "StaleThresholdUpdated")
      })
    })
  })
})
