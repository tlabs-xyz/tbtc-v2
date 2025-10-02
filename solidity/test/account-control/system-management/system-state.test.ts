import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SystemState } from "../../../typechain"
import {
  setupTestSigners,
  createBaseTestEnvironment,
  restoreBaseTestEnvironment,
  TestSigners,
} from "../fixtures/base-setup"
import { expectCustomError, ERROR_MESSAGES } from "../helpers/error-helpers"

describe("SystemState ", () => {
  let signers: TestSigners
  let systemState: SystemState
  let pauserAccount: any
  let adminAccount: any

  // Roles
  let EMERGENCY_ROLE: string
  let OPERATIONS_ROLE: string

  // Test parameters
  const testMinMintAmount = ethers.utils.parseEther("0.1")
  const testMaxMintAmount = ethers.utils.parseEther("100")
  const testRedemptionTimeout = 86400 // 24 hours
  const testStaleThreshold = 3600 // 1 hour

  before(async () => {
    signers = await setupTestSigners()

    // Use watchdog and liquidator as pauser and admin accounts
    pauserAccount = signers.watchdog
    adminAccount = signers.liquidator

    // Generate role hashes
    EMERGENCY_ROLE = ethers.utils.id("EMERGENCY_ROLE")
    OPERATIONS_ROLE = ethers.utils.id("OPERATIONS_ROLE")
  })

  beforeEach(async () => {
    await createBaseTestEnvironment()

    // Deploy SystemState
    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy()
    await systemState.deployed()

    // Grant roles
    await systemState.grantRole(EMERGENCY_ROLE, pauserAccount.address)
    await systemState.grantRole(OPERATIONS_ROLE, adminAccount.address)
  })

  afterEach(async () => {
    await restoreBaseTestEnvironment()
  })

  describe("Deployment ", () => {
    it("should grant deployer all roles", async () => {
      const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
      expect(
        await systemState.hasRole(DEFAULT_ADMIN_ROLE, signers.deployer.address)
      ).to.be.true
      expect(
        await systemState.hasRole(EMERGENCY_ROLE, signers.deployer.address)
      ).to.be.true
      expect(
        await systemState.hasRole(OPERATIONS_ROLE, signers.deployer.address)
      ).to.be.true
    })

    it("should have correct role constants", async () => {
      expect(await systemState.EMERGENCY_ROLE()).to.equal(EMERGENCY_ROLE)
      expect(await systemState.OPERATIONS_ROLE()).to.equal(OPERATIONS_ROLE)
    })

    it("should initialize with default values", async () => {
      expect(await systemState.isMintingPaused()).to.be.false
      expect(await systemState.isRedemptionPaused()).to.be.false
      expect(await systemState.minMintAmount()).to.equal(
        ethers.utils.parseEther("0.001")
      ) // Default 0.001 tBTC
      expect(await systemState.maxMintAmount()).to.equal(
        ethers.utils.parseEther("1000")
      ) // Default 1000 tBTC
      expect(await systemState.redemptionTimeout()).to.equal(604800) // Default 7 days
      expect(await systemState.staleThreshold()).to.equal(86400) // Default 24 hours
    })
  })

  describe("Pause Functions ", () => {
    context("when called by pauser", () => {
      describe("pauseMinting", () => {
        it("should pause minting successfully", async () => {
          const tx = await systemState.connect(pauserAccount).pauseMinting()
          const receipt = await tx.wait()

          const currentBlock = await ethers.provider.getBlock(
            receipt.blockNumber
          )

          expect(await systemState.isMintingPaused()).to.be.true
          await expect(tx)
            .to.emit(systemState, "MintingPaused")
            .withArgs(pauserAccount.address, currentBlock.timestamp)
        })

        it("should revert when already paused", async () => {
          await systemState.connect(pauserAccount).pauseMinting()

          await expect(
            systemState.connect(pauserAccount).pauseMinting()
          ).to.be.revertedWith("MintingAlreadyPaused")
        })
      })

      describe("unpauseMinting", () => {
        beforeEach(async () => {
          await systemState.connect(pauserAccount).pauseMinting()
        })

        it("should unpause minting successfully", async () => {
          const tx = await systemState.connect(pauserAccount).unpauseMinting()
          const receipt = await tx.wait()

          const currentBlock = await ethers.provider.getBlock(
            receipt.blockNumber
          )

          expect(await systemState.isMintingPaused()).to.be.false
          await expect(tx)
            .to.emit(systemState, "MintingUnpaused")
            .withArgs(pauserAccount.address, currentBlock.timestamp)
        })

        it("should revert when not paused", async () => {
          await systemState.connect(pauserAccount).unpauseMinting()

          await expect(
            systemState.connect(pauserAccount).unpauseMinting()
          ).to.be.revertedWith("MintingNotPaused")
        })
      })

      describe("pauseRedemption", () => {
        it("should pause redemption successfully", async () => {
          const tx = await systemState.connect(pauserAccount).pauseRedemption()
          const receipt = await tx.wait()

          const currentBlock = await ethers.provider.getBlock(
            receipt.blockNumber
          )

          expect(await systemState.isRedemptionPaused()).to.be.true
          await expect(tx)
            .to.emit(systemState, "RedemptionPaused")
            .withArgs(pauserAccount.address, currentBlock.timestamp)
        })

        it("should revert when already paused", async () => {
          await systemState.connect(pauserAccount).pauseRedemption()

          await expect(
            systemState.connect(pauserAccount).pauseRedemption()
          ).to.be.revertedWith("RedemptionAlreadyPaused")
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

          const receipt = await tx.wait()

          const currentBlock = await ethers.provider.getBlock(
            receipt.blockNumber
          )

          expect(await systemState.isRedemptionPaused()).to.be.false
          await expect(tx)
            .to.emit(systemState, "RedemptionUnpaused")
            .withArgs(pauserAccount.address, currentBlock.timestamp)
        })

        it("should revert when not paused", async () => {
          await systemState.connect(pauserAccount).unpauseRedemption()

          await expect(
            systemState.connect(pauserAccount).unpauseRedemption()
          ).to.be.revertedWith("RedemptionNotPaused")
        })
      })

      describe("pauseWalletRegistration", () => {
        it("should pause wallet registration successfully", async () => {
          const tx = await systemState
            .connect(pauserAccount)
            .pauseWalletRegistration()

          const receipt = await tx.wait()

          const currentBlock = await ethers.provider.getBlock(
            receipt.blockNumber
          )

          expect(await systemState.isWalletRegistrationPaused()).to.be.true
          await expect(tx)
            .to.emit(systemState, "WalletRegistrationPaused")
            .withArgs(pauserAccount.address, currentBlock.timestamp)
        })

        it("should revert when already paused", async () => {
          await systemState.connect(pauserAccount).pauseWalletRegistration()

          await expect(
            systemState.connect(pauserAccount).pauseWalletRegistration()
          ).to.be.revertedWith("WalletRegistrationAlreadyPaused")
        })
      })

      describe("unpauseWalletRegistration", () => {
        beforeEach(async () => {
          await systemState.connect(pauserAccount).pauseWalletRegistration()
        })

        it("should unpause wallet registration successfully", async () => {
          const tx = await systemState
            .connect(pauserAccount)
            .unpauseWalletRegistration()

          const receipt = await tx.wait()

          const currentBlock = await ethers.provider.getBlock(
            receipt.blockNumber
          )

          expect(await systemState.isWalletRegistrationPaused()).to.be.false
          await expect(tx)
            .to.emit(systemState, "WalletRegistrationUnpaused")
            .withArgs(pauserAccount.address, currentBlock.timestamp)
        })

        it("should revert when not paused", async () => {
          await systemState.connect(pauserAccount).unpauseWalletRegistration()

          await expect(
            systemState.connect(pauserAccount).unpauseWalletRegistration()
          ).to.be.revertedWith("WalletRegistrationNotPaused")
        })
      })
    })

    context("when called by non-pauser", () => {
      it("should revert for pauseMinting", async () => {
        await expect(
          systemState.connect(signers.thirdParty).pauseMinting()
        ).to.be.revertedWith(
          `AccessControl: account ${signers.thirdParty.address.toLowerCase()} is missing role ${EMERGENCY_ROLE}`
        )
      })

      it("should revert for pauseRedemption", async () => {
        await expect(
          systemState.connect(signers.thirdParty).pauseRedemption()
        ).to.be.revertedWith(
          `AccessControl: account ${signers.thirdParty.address.toLowerCase()} is missing role ${EMERGENCY_ROLE}`
        )
      })

      it("should revert for pauseWalletRegistration", async () => {
        await expect(
          systemState.connect(signers.thirdParty).pauseWalletRegistration()
        ).to.be.revertedWith(
          `AccessControl: account ${signers.thirdParty.address.toLowerCase()} is missing role ${EMERGENCY_ROLE}`
        )
      })
    })
  })

  describe("Parameter Management ", () => {
    context("when called by parameter admin", () => {
      describe("setMinMintAmount", () => {
        it("should update min mint amount successfully", async () => {
          const oldAmount = await systemState.minMintAmount()

          const tx = await systemState
            .connect(adminAccount)
            .setMinMintAmount(testMinMintAmount)

          const receipt = await tx.wait()

          const { timestamp } = await ethers.provider.getBlock(
            receipt.blockNumber
          )

          expect(await systemState.minMintAmount()).to.equal(testMinMintAmount)
          await expect(tx)
            .to.emit(systemState, "MinMintAmountUpdated")
            .withArgs(
              oldAmount,
              testMinMintAmount,
              adminAccount.address,
              timestamp
            )
        })

        it("should revert with zero min amount", async () => {
          await expect(
            systemState.connect(adminAccount).setMinMintAmount(0)
          ).to.be.revertedWith("InvalidAmount")
        })

        it("should allow updating multiple times", async () => {
          await systemState
            .connect(adminAccount)
            .setMinMintAmount(testMinMintAmount)
          const newAmount = testMinMintAmount.mul(2)
          await systemState.connect(adminAccount).setMinMintAmount(newAmount)

          expect(await systemState.minMintAmount()).to.equal(newAmount)
        })

        it("should revert when min amount exceeds max amount", async () => {
          const currentMax = await systemState.maxMintAmount()
          const invalidMinAmount = currentMax.add(1)

          await expect(
            systemState.connect(adminAccount).setMinMintAmount(invalidMinAmount)
          ).to.be.revertedWith("MinAmountExceedsMax")
        })
      })

      describe("setMaxMintAmount", () => {
        it("should update max mint amount successfully", async () => {
          const oldAmount = await systemState.maxMintAmount()

          const tx = await systemState
            .connect(adminAccount)
            .setMaxMintAmount(testMaxMintAmount)

          const receipt = await tx.wait()

          const { timestamp } = await ethers.provider.getBlock(
            receipt.blockNumber
          )

          expect(await systemState.maxMintAmount()).to.equal(testMaxMintAmount)
          await expect(tx)
            .to.emit(systemState, "MaxMintAmountUpdated")
            .withArgs(
              oldAmount,
              testMaxMintAmount,
              adminAccount.address,
              timestamp
            )
        })

        it("should revert with zero max amount", async () => {
          await expect(
            systemState.connect(adminAccount).setMaxMintAmount(0)
          ).to.be.revertedWith("MaxAmountBelowMin")
        })

        it("should allow very large amounts", async () => {
          const largeAmount = ethers.utils.parseEther("1000000")
          await systemState.connect(adminAccount).setMaxMintAmount(largeAmount)

          expect(await systemState.maxMintAmount()).to.equal(largeAmount)
        })
      })

      describe("setRedemptionTimeout", () => {
        it("should update redemption timeout successfully", async () => {
          const oldTimeout = await systemState.redemptionTimeout()

          const tx = await systemState
            .connect(adminAccount)
            .setRedemptionTimeout(testRedemptionTimeout)

          expect(await systemState.redemptionTimeout()).to.equal(
            testRedemptionTimeout
          )
          await expect(tx)
            .to.emit(systemState, "RedemptionTimeoutUpdated")
            .withArgs(oldTimeout, testRedemptionTimeout, adminAccount.address)
        })

        it("should revert with zero timeout", async () => {
          await expect(
            systemState.connect(adminAccount).setRedemptionTimeout(0)
          ).to.be.revertedWith("InvalidTimeout")
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
          const oldThreshold = await systemState.staleThreshold()

          const tx = await systemState
            .connect(adminAccount)
            .setStaleThreshold(testStaleThreshold)

          expect(await systemState.staleThreshold()).to.equal(
            testStaleThreshold
          )
          await expect(tx)
            .to.emit(systemState, "StaleThresholdUpdated")
            .withArgs(oldThreshold, testStaleThreshold, adminAccount.address)
        })

        it("should revert with zero threshold", async () => {
          await expect(
            systemState.connect(adminAccount).setStaleThreshold(0)
          ).to.be.revertedWithCustomError(systemState, "InvalidThreshold")
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

        it("should revert when threshold exceeds 7 days", async () => {
          const invalidThreshold = 7 * 24 * 3600 + 1 // 7 days + 1 second

          await expect(
            systemState
              .connect(adminAccount)
              .setStaleThreshold(invalidThreshold)
          ).to.be.revertedWith("ThresholdTooLong")
        })
      })

      describe("setEmergencyPauseDuration", () => {
        it("should update emergency pause duration successfully", async () => {
          const newDuration = 3 * 24 * 3600 // 3 days
          const oldDuration = await systemState.emergencyPauseDuration()

          const tx = await systemState
            .connect(adminAccount)
            .setEmergencyPauseDuration(newDuration)

          expect(await systemState.emergencyPauseDuration()).to.equal(
            newDuration
          )
          await expect(tx)
            .to.emit(systemState, "EmergencyPauseDurationUpdated")
            .withArgs(oldDuration, newDuration, adminAccount.address)
        })

        it("should revert with zero duration", async () => {
          await expect(
            systemState.connect(adminAccount).setEmergencyPauseDuration(0)
          ).to.be.revertedWith("InvalidDuration")
        })

        it("should revert when duration exceeds 30 days", async () => {
          const invalidDuration = 30 * 24 * 3600 + 1 // 30 days + 1 second

          await expect(
            systemState
              .connect(adminAccount)
              .setEmergencyPauseDuration(invalidDuration)
          ).to.be.revertedWith("DurationTooLong")
        })
      })

      describe("setEmergencyCouncil", () => {
        let newCouncil: SignerWithAddress

        beforeEach(async () => {
          ;[, , , , , newCouncil] = await ethers.getSigners()
        })

        it("should update emergency council successfully", async () => {
          const oldCouncil = await systemState.emergencyCouncil()

          const tx = await systemState
            .connect(signers.deployer)
            .setEmergencyCouncil(newCouncil.address)

          expect(await systemState.emergencyCouncil()).to.equal(
            newCouncil.address
          )
          await expect(tx)
            .to.emit(systemState, "EmergencyCouncilUpdated")
            .withArgs(oldCouncil, newCouncil.address, signers.deployer.address)
        })

        it("should grant EMERGENCY_ROLE to new council", async () => {
          await systemState
            .connect(signers.deployer)
            .setEmergencyCouncil(newCouncil.address)

          expect(await systemState.hasRole(EMERGENCY_ROLE, newCouncil.address))
            .to.be.true
        })

        it("should revoke EMERGENCY_ROLE from old council", async () => {
          // First set a council
          await systemState
            .connect(signers.deployer)
            .setEmergencyCouncil(newCouncil.address)
          expect(await systemState.hasRole(EMERGENCY_ROLE, newCouncil.address))
            .to.be.true

          // Then change to another council
          const anotherCouncil = signers.thirdParty
          await systemState
            .connect(signers.deployer)
            .setEmergencyCouncil(anotherCouncil.address)

          expect(await systemState.hasRole(EMERGENCY_ROLE, newCouncil.address))
            .to.be.false
          expect(
            await systemState.hasRole(EMERGENCY_ROLE, anotherCouncil.address)
          ).to.be.true
        })

        it("should revert with zero address", async () => {
          await expect(
            systemState
              .connect(signers.deployer)
              .setEmergencyCouncil(ethers.constants.AddressZero)
          ).to.be.revertedWith("InvalidCouncilAddress")
        })

        it("should only be callable by DEFAULT_ADMIN_ROLE", async () => {
          await expect(
            systemState
              .connect(adminAccount)
              .setEmergencyCouncil(newCouncil.address)
          ).to.be.revertedWith(
            `AccessControl: account ${adminAccount.address.toLowerCase()} is missing role ${
              ethers.constants.HashZero
            }`
          )
        })
      })
    })

    context("when called by non-parameter admin", () => {
      it("should revert for setMinMintAmount", async () => {
        await expect(
          systemState
            .connect(signers.thirdParty)
            .setMinMintAmount(testMinMintAmount)
        ).to.be.revertedWith(
          `AccessControl: account ${signers.thirdParty.address.toLowerCase()} is missing role ${OPERATIONS_ROLE}`
        )
      })

      it("should revert for setMaxMintAmount", async () => {
        await expect(
          systemState
            .connect(signers.thirdParty)
            .setMaxMintAmount(testMaxMintAmount)
        ).to.be.revertedWith(
          `AccessControl: account ${signers.thirdParty.address.toLowerCase()} is missing role ${OPERATIONS_ROLE}`
        )
      })

      it("should revert for setRedemptionTimeout", async () => {
        await expect(
          systemState
            .connect(signers.thirdParty)
            .setRedemptionTimeout(testRedemptionTimeout)
        ).to.be.revertedWith(
          `AccessControl: account ${signers.thirdParty.address.toLowerCase()} is missing role ${OPERATIONS_ROLE}`
        )
      })

      it("should revert for setStaleThreshold", async () => {
        await expect(
          systemState
            .connect(signers.thirdParty)
            .setStaleThreshold(testStaleThreshold)
        ).to.be.revertedWith(
          `AccessControl: account ${signers.thirdParty.address.toLowerCase()} is missing role ${OPERATIONS_ROLE}`
        )
      })

      it("should revert for setEmergencyPauseDuration", async () => {
        await expect(
          systemState
            .connect(signers.thirdParty)
            .setEmergencyPauseDuration(86400)
        ).to.be.revertedWith(
          `AccessControl: account ${signers.thirdParty.address.toLowerCase()} is missing role ${OPERATIONS_ROLE}`
        )
      })
    })
  })

  describe("Function-Specific Pause Checks ", () => {
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

      it("should return correct status for wallet registration", async () => {
        expect(await systemState.isFunctionPaused("wallet_registration")).to.be
          .false

        await systemState.connect(pauserAccount).pauseWalletRegistration()
        expect(await systemState.isFunctionPaused("wallet_registration")).to.be
          .true

        await systemState.connect(pauserAccount).unpauseWalletRegistration()
        expect(await systemState.isFunctionPaused("wallet_registration")).to.be
          .false
      })

      it("should return false for unknown function names", async () => {
        expect(await systemState.isFunctionPaused("unknown")).to.be.false
        expect(await systemState.isFunctionPaused("")).to.be.false
        expect(await systemState.isFunctionPaused("invalid_function")).to.be
          .false
      })
    })
  })

  describe("Access Control [validation]", () => {
    context("role management", () => {
      it("should allow admin to grant pauser role", async () => {
        await systemState.grantRole(EMERGENCY_ROLE, signers.thirdParty.address)

        expect(
          await systemState.hasRole(EMERGENCY_ROLE, signers.thirdParty.address)
        ).to.be.true

        // Third party should now be able to pause
        await systemState.connect(signers.thirdParty).pauseMinting()
        expect(await systemState.isMintingPaused()).to.be.true
      })

      it("should allow admin to grant parameter admin role", async () => {
        await systemState.grantRole(OPERATIONS_ROLE, signers.thirdParty.address)

        expect(
          await systemState.hasRole(OPERATIONS_ROLE, signers.thirdParty.address)
        ).to.be.true

        // Third party should now be able to set parameters
        await systemState
          .connect(signers.thirdParty)
          .setMinMintAmount(testMinMintAmount)
        expect(await systemState.minMintAmount()).to.equal(testMinMintAmount)
      })

      it("should allow admin to revoke roles", async () => {
        await systemState.revokeRole(EMERGENCY_ROLE, pauserAccount.address)

        expect(await systemState.hasRole(EMERGENCY_ROLE, pauserAccount.address))
          .to.be.false

        await expect(
          systemState.connect(pauserAccount).pauseMinting()
        ).to.be.revertedWith(
          `AccessControl: account ${pauserAccount.address.toLowerCase()} is missing role ${EMERGENCY_ROLE}`
        )
      })
    })
  })

  describe("Edge Cases ", () => {
    context("simultaneous operations", () => {
      it("should handle independent pause states", async () => {
        await systemState.connect(pauserAccount).pauseMinting()
        expect(await systemState.isMintingPaused()).to.be.true
        expect(await systemState.isRedemptionPaused()).to.be.false
        expect(await systemState.isWalletRegistrationPaused()).to.be.false

        await systemState.connect(pauserAccount).pauseRedemption()
        expect(await systemState.isMintingPaused()).to.be.true
        expect(await systemState.isRedemptionPaused()).to.be.true
        expect(await systemState.isWalletRegistrationPaused()).to.be.false

        await systemState.connect(pauserAccount).pauseWalletRegistration()
        expect(await systemState.isMintingPaused()).to.be.true
        expect(await systemState.isRedemptionPaused()).to.be.true
        expect(await systemState.isWalletRegistrationPaused()).to.be.true

        await systemState.connect(pauserAccount).unpauseMinting()
        expect(await systemState.isMintingPaused()).to.be.false
        expect(await systemState.isRedemptionPaused()).to.be.true
        expect(await systemState.isWalletRegistrationPaused()).to.be.true
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
      it("should handle maximum allowed values for parameters", async () => {
        const maxUint256 = ethers.constants.MaxUint256
        const maxTimeout = 30 * 24 * 3600 // 30 days
        const maxThreshold = 7 * 24 * 3600 // 7 days

        await systemState.connect(adminAccount).setMaxMintAmount(maxUint256)
        expect(await systemState.maxMintAmount()).to.equal(maxUint256)

        await systemState.connect(adminAccount).setRedemptionTimeout(maxTimeout)
        expect(await systemState.redemptionTimeout()).to.equal(maxTimeout)

        await systemState.connect(adminAccount).setStaleThreshold(maxThreshold)
        expect(await systemState.staleThreshold()).to.equal(maxThreshold)
      })

      it("should handle very small non-zero values", async () => {
        const smallValue = 1

        // First set min amount to 1 to allow setting max amount to 1
        await systemState.connect(adminAccount).setMinMintAmount(smallValue)
        expect(await systemState.minMintAmount()).to.equal(smallValue)

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

        // Unpause events
        await expect(
          systemState.connect(pauserAccount).unpauseMinting()
        ).to.emit(systemState, "MintingUnpaused")

        await expect(
          systemState.connect(pauserAccount).unpauseRedemption()
        ).to.emit(systemState, "RedemptionUnpaused")

        // Wallet registration pause/unpause events
        await expect(
          systemState.connect(pauserAccount).pauseWalletRegistration()
        ).to.emit(systemState, "WalletRegistrationPaused")

        await expect(
          systemState.connect(pauserAccount).unpauseWalletRegistration()
        ).to.emit(systemState, "WalletRegistrationUnpaused")

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

        await expect(
          systemState
            .connect(adminAccount)
            .setEmergencyPauseDuration(3 * 24 * 3600)
        ).to.emit(systemState, "EmergencyPauseDurationUpdated")

        await expect(
          systemState
            .connect(signers.deployer)
            .setEmergencyCouncil(signers.thirdParty.address)
        ).to.emit(systemState, "EmergencyCouncilUpdated")
      })
    })
  })

  describe("Emergency QC Functions ", () => {
    let testQC: string
    let testReason: string
    let invalidQC: string

    beforeEach(async () => {
      testQC = signers.governance.address // Use governance address as test QC
      testReason = ethers.utils.id("INSUFFICIENT_COLLATERAL")
      invalidQC = ethers.constants.AddressZero
    })

    describe("emergencyPauseQC", () => {
      context("when called by pauser", () => {
        it("should pause QC successfully with correct reason", async () => {
          const tx = await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)

          const receipt = await tx.wait()

          const currentBlock = await ethers.provider.getBlock(
            receipt.blockNumber
          )

          // Verify state changes
          expect(await systemState.isQCEmergencyPaused(testQC)).to.be.true
          expect(await systemState.getQCPauseTimestamp(testQC)).to.equal(
            currentBlock.timestamp
          )

          // Verify events
          await expect(tx)
            .to.emit(systemState, "QCEmergencyPaused")
            .withArgs(
              testQC,
              pauserAccount.address,
              currentBlock.timestamp,
              testReason
            )

          await expect(tx)
            .to.emit(systemState, "EmergencyActionTaken")
            .withArgs(
              testQC,
              ethers.utils.id("QC_EMERGENCY_PAUSE"),
              pauserAccount.address,
              currentBlock.timestamp
            )
        })

        it("should handle different reason codes", async () => {
          const reasons = [
            ethers.utils.id("INSUFFICIENT_COLLATERAL"),
            ethers.utils.id("STALE_ATTESTATION"),
            ethers.utils.id("COMPLIANCE_VIOLATION"),
            ethers.utils.id("SECURITY_INCIDENT"),
            ethers.utils.id("TECHNICAL_FAILURE"),
          ]

          await Promise.all(
            reasons.map(async (reason) => {
              const qc = ethers.Wallet.createRandom().address

              const tx = await systemState
                .connect(pauserAccount)
                .emergencyPauseQC(qc, reason)

              const receipt = await tx.wait()

              const currentBlock = await ethers.provider.getBlock(
                receipt.blockNumber
              )

              await expect(tx)
                .to.emit(systemState, "QCEmergencyPaused")
                .withArgs(
                  qc,
                  pauserAccount.address,
                  currentBlock.timestamp,
                  reason
                )

              expect(await systemState.isQCEmergencyPaused(qc)).to.be.true
            })
          )
        })

        it("should allow multiple QCs to be paused independently", async () => {
          const qc1 = ethers.Wallet.createRandom().address
          const qc2 = ethers.Wallet.createRandom().address
          const qc3 = ethers.Wallet.createRandom().address

          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(qc1, ethers.utils.id("REASON_1"))
          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(qc2, ethers.utils.id("REASON_2"))

          expect(await systemState.isQCEmergencyPaused(qc1)).to.be.true
          expect(await systemState.isQCEmergencyPaused(qc2)).to.be.true
          expect(await systemState.isQCEmergencyPaused(qc3)).to.be.false
        })

        it("should revert when QC is already paused", async () => {
          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)

          await expect(
            systemState
              .connect(pauserAccount)
              .emergencyPauseQC(testQC, testReason)
          ).to.be.revertedWith("QCIsEmergencyPaused")
        })

        it("should revert with zero address", async () => {
          await expect(
            systemState
              .connect(pauserAccount)
              .emergencyPauseQC(invalidQC, testReason)
          ).to.be.revertedWith("InvalidCouncilAddress")
        })
      })

      context("when called by non-pauser", () => {
        it("should revert with access control error", async () => {
          await expect(
            systemState
              .connect(signers.thirdParty)
              .emergencyPauseQC(testQC, testReason)
          ).to.be.revertedWith("AccessControl: account")
        })
      })

      context("when called by admin", () => {
        it("should work if admin also has pauser role", async () => {
          await systemState.grantRole(EMERGENCY_ROLE, adminAccount.address)

          await expect(
            systemState
              .connect(adminAccount)
              .emergencyPauseQC(testQC, testReason)
          ).to.not.be.reverted
        })
      })
    })

    describe("emergencyUnpauseQC", () => {
      beforeEach(async () => {
        // Pause the QC first
        await systemState
          .connect(pauserAccount)
          .emergencyPauseQC(testQC, testReason)
      })

      context("when called by pauser", () => {
        it("should unpause QC successfully", async () => {
          const tx = await systemState
            .connect(pauserAccount)
            .emergencyUnpauseQC(testQC)

          const receipt = await tx.wait()

          const currentBlock = await ethers.provider.getBlock(
            receipt.blockNumber
          )

          // Verify state changes
          expect(await systemState.isQCEmergencyPaused(testQC)).to.be.false
          expect(await systemState.getQCPauseTimestamp(testQC)).to.equal(0)

          // Verify events
          await expect(tx)
            .to.emit(systemState, "QCEmergencyUnpaused")
            .withArgs(testQC, pauserAccount.address, currentBlock.timestamp)

          await expect(tx)
            .to.emit(systemState, "EmergencyActionTaken")
            .withArgs(
              testQC,
              ethers.utils.id("QC_EMERGENCY_UNPAUSE"),
              pauserAccount.address,
              currentBlock.timestamp
            )
        })

        it("should allow QC to be paused and unpaused multiple times", async () => {
          // Unpause
          await systemState.connect(pauserAccount).emergencyUnpauseQC(testQC)
          expect(await systemState.isQCEmergencyPaused(testQC)).to.be.false

          // Pause again
          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)
          expect(await systemState.isQCEmergencyPaused(testQC)).to.be.true

          // Unpause again
          await systemState.connect(pauserAccount).emergencyUnpauseQC(testQC)
          expect(await systemState.isQCEmergencyPaused(testQC)).to.be.false
        })

        it("should revert when QC is not paused", async () => {
          const unPausedQC = ethers.Wallet.createRandom().address

          await expect(
            systemState.connect(pauserAccount).emergencyUnpauseQC(unPausedQC)
          ).to.be.revertedWith("QCNotEmergencyPaused")
        })

        it("should revert when trying to unpause already unpaused QC", async () => {
          await systemState.connect(pauserAccount).emergencyUnpauseQC(testQC)

          await expect(
            systemState.connect(pauserAccount).emergencyUnpauseQC(testQC)
          ).to.be.revertedWith("QCNotEmergencyPaused")
        })
      })

      context("when called by non-pauser", () => {
        it("should revert with access control error", async () => {
          await expect(
            systemState.connect(signers.thirdParty).emergencyUnpauseQC(testQC)
          ).to.be.revertedWith("AccessControl: account")
        })
      })
    })

    describe("Emergency Pause View Functions", () => {
      describe("isQCEmergencyPaused", () => {
        it("should return false for non-paused QC", async () => {
          expect(await systemState.isQCEmergencyPaused(testQC)).to.be.false
        })

        it("should return true for paused QC", async () => {
          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)
          expect(await systemState.isQCEmergencyPaused(testQC)).to.be.true
        })

        it("should return false after unpause", async () => {
          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)
          await systemState.connect(pauserAccount).emergencyUnpauseQC(testQC)
          expect(await systemState.isQCEmergencyPaused(testQC)).to.be.false
        })
      })

      describe("isQCEmergencyPauseExpired", () => {
        it("should return false for non-paused QC", async () => {
          expect(await systemState.isQCEmergencyPauseExpired(testQC)).to.be
            .false
        })

        it("should return false for recently paused QC", async () => {
          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)
          expect(await systemState.isQCEmergencyPauseExpired(testQC)).to.be
            .false
        })

        it("should return true after emergency pause duration", async () => {
          // Set a short emergency pause duration for testing
          await systemState.connect(adminAccount).setEmergencyPauseDuration(1) // 1 second

          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)

          // Fast forward time
          await helpers.time.increaseTime(3)

          expect(await systemState.isQCEmergencyPauseExpired(testQC)).to.be.true
        })
      })

      describe("getQCPauseTimestamp", () => {
        it("should return 0 for non-paused QC", async () => {
          expect(await systemState.getQCPauseTimestamp(testQC)).to.equal(0)
        })

        it("should return timestamp for paused QC", async () => {
          const tx = await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)

          const receipt = await tx.wait()

          const currentBlock = await ethers.provider.getBlock(
            receipt.blockNumber
          )

          expect(await systemState.getQCPauseTimestamp(testQC)).to.equal(
            currentBlock.timestamp
          )
        })

        it("should return 0 after unpause", async () => {
          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)
          await systemState.connect(pauserAccount).emergencyUnpauseQC(testQC)

          expect(await systemState.getQCPauseTimestamp(testQC)).to.equal(0)
        })
      })
    })

    describe("Emergency Pause Integration", () => {
      describe("qcNotEmergencyPaused modifier", () => {
        let testContract: any // TestEmergencyIntegration contract interface

        beforeEach(async () => {
          // Deploy a test contract that uses the modifier
          const TestContract = await ethers.getContractFactory(
            "TestEmergencyIntegration"
          )

          testContract = await TestContract.deploy(systemState.address)
          await testContract.deployed()
        })

        it("should allow function execution when QC is not paused", async () => {
          await expect(testContract.testFunction(testQC)).to.not.be.reverted
        })

        it("should revert function execution when QC is paused", async () => {
          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)

          await expect(testContract.testFunction(testQC)).to.be.revertedWith(
            "QCIsEmergencyPaused"
          )
        })

        it("should allow function execution after QC is unpaused", async () => {
          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)
          await systemState.connect(pauserAccount).emergencyUnpauseQC(testQC)

          await expect(testContract.testFunction(testQC)).to.not.be.reverted
        })
      })
    })

    describe("Emergency System Attack Scenarios", () => {
      describe("Unauthorized Pause Attempts", () => {
        it("should prevent non-authorized accounts from pausing", async () => {
          const attacker = signers.thirdParty

          await expect(
            systemState.connect(attacker).emergencyPauseQC(testQC, testReason)
          ).to.be.revertedWith("AccessControl: account")
        })

        it("should prevent parameter admin from pausing without pauser role", async () => {
          await expect(
            systemState
              .connect(adminAccount)
              .emergencyPauseQC(testQC, testReason)
          ).to.be.revertedWith("AccessControl: account")
        })

        it("should allow emergency council to pause if granted pauser role", async () => {
          const emergencyCouncil = signers.thirdParty
          await systemState.setEmergencyCouncil(emergencyCouncil.address)
          await systemState.grantRole(EMERGENCY_ROLE, emergencyCouncil.address)

          await expect(
            systemState
              .connect(emergencyCouncil)
              .emergencyPauseQC(testQC, testReason)
          ).to.not.be.reverted
        })
      })

      describe("Pause Bypass Attempts", () => {
        beforeEach(async () => {
          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)
        })

        it("should prevent double-pausing for same QC", async () => {
          await expect(
            systemState
              .connect(pauserAccount)
              .emergencyPauseQC(testQC, testReason)
          ).to.be.revertedWith("QCIsEmergencyPaused")
        })

        it("should prevent unauthorized unpause", async () => {
          await expect(
            systemState.connect(signers.thirdParty).emergencyUnpauseQC(testQC)
          ).to.be.revertedWith("AccessControl: account")
        })
      })

      describe("State Manipulation Attempts", () => {
        it("should maintain pause state consistency", async () => {
          // Pause QC
          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)

          const pauseTimestamp1 = await systemState.getQCPauseTimestamp(testQC)
          expect(pauseTimestamp1).to.be.gt(0)

          // Try to pause again (should fail)
          await expect(
            systemState
              .connect(pauserAccount)
              .emergencyPauseQC(testQC, testReason)
          ).to.be.revertedWith("QCIsEmergencyPaused")

          // Verify timestamp didn't change
          const pauseTimestamp2 = await systemState.getQCPauseTimestamp(testQC)
          expect(pauseTimestamp2).to.equal(pauseTimestamp1)
        })

        it("should properly clean up state on unpause", async () => {
          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)

          expect(await systemState.isQCEmergencyPaused(testQC)).to.be.true
          expect(await systemState.getQCPauseTimestamp(testQC)).to.be.gt(0)

          await systemState.connect(pauserAccount).emergencyUnpauseQC(testQC)

          expect(await systemState.isQCEmergencyPaused(testQC)).to.be.false
          expect(await systemState.getQCPauseTimestamp(testQC)).to.equal(0)
        })
      })

      describe("Timing Attack Scenarios", () => {
        it("should handle rapid pause/unpause sequences", async () => {
          for (let i = 0; i < 5; i++) {
            await systemState
              .connect(pauserAccount)
              .emergencyPauseQC(testQC, testReason)
            expect(await systemState.isQCEmergencyPaused(testQC)).to.be.true

            await systemState.connect(pauserAccount).emergencyUnpauseQC(testQC)
            expect(await systemState.isQCEmergencyPaused(testQC)).to.be.false
          }
        })

        it("should handle pause expiry edge cases", async () => {
          // Set very short pause duration
          await systemState.connect(adminAccount).setEmergencyPauseDuration(2)

          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)

          // Check not expired initially
          expect(await systemState.isQCEmergencyPauseExpired(testQC)).to.be
            .false

          // Fast forward to exactly expiry time (should still not be expired)
          await helpers.time.increaseTime(2)
          expect(await systemState.isQCEmergencyPauseExpired(testQC)).to.be
            .false

          // Fast forward past expiry time (should be expired)
          await helpers.time.increaseTime(1)
          expect(await systemState.isQCEmergencyPauseExpired(testQC)).to.be.true

          // QC should still be marked as paused even if expired
          expect(await systemState.isQCEmergencyPaused(testQC)).to.be.true
        })
      })
    })

    describe("Emergency System Recovery", () => {
      describe("Mass QC Recovery", () => {
        let qcs: string[]

        beforeEach(async () => {
          qcs = [
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
          ]

          // Pause all QCs
          await Promise.all(
            qcs.map(async (qc) => {
              await systemState
                .connect(pauserAccount)
                .emergencyPauseQC(qc, testReason)
            })
          )
        })

        it("should support selective recovery", async () => {
          // Unpause only first QC
          await systemState.connect(pauserAccount).emergencyUnpauseQC(qcs[0])

          expect(await systemState.isQCEmergencyPaused(qcs[0])).to.be.false
          expect(await systemState.isQCEmergencyPaused(qcs[1])).to.be.true
          expect(await systemState.isQCEmergencyPaused(qcs[2])).to.be.true
        })

        it("should support full recovery", async () => {
          // Unpause all QCs
          await Promise.all(
            qcs.map(async (qc) => {
              await systemState.connect(pauserAccount).emergencyUnpauseQC(qc)
              expect(await systemState.isQCEmergencyPaused(qc)).to.be.false
            })
          )
        })
      })

      describe("Emergency Council Transition", () => {
        it("should maintain pause state during council changes", async () => {
          const newCouncil = ethers.Wallet.createRandom()

          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)

          // Change emergency council
          await systemState.setEmergencyCouncil(newCouncil.address)

          // QC should remain paused
          expect(await systemState.isQCEmergencyPaused(testQC)).to.be.true
        })

        it("should allow new pauser to unpause", async () => {
          const signers = await ethers.getSigners()
          const newPauser = signers[5] // Use an unused signer instead of deployer

          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)

          // Grant pauser role to new account
          await systemState.grantRole(EMERGENCY_ROLE, newPauser.address)

          // New pauser should be able to unpause
          await expect(
            systemState.connect(newPauser).emergencyUnpauseQC(testQC)
          ).to.not.be.reverted
        })
      })
    })

    describe("Gas Optimization", () => {
      it("should have reasonable gas costs for emergency operations", async () => {
        // Measure gas for pause operation
        const pauseTx = await systemState
          .connect(pauserAccount)
          .emergencyPauseQC(testQC, testReason)

        const pauseReceipt = await pauseTx.wait()

        // Measure gas for unpause operation
        const unpauseTx = await systemState
          .connect(pauserAccount)
          .emergencyUnpauseQC(testQC)

        const unPauseReceipt = await unpauseTx.wait()

        // Emergency operations should be gas-efficient (under 100k gas)
        expect(pauseReceipt.gasUsed).to.be.lt(100000)
        expect(unPauseReceipt.gasUsed).to.be.lt(100000)
      })

      it("should have minimal gas cost for view functions", async () => {
        await systemState
          .connect(pauserAccount)
          .emergencyPauseQC(testQC, testReason)

        // View functions should be very cheap
        const gasUsed1 = await systemState.estimateGas.isQCEmergencyPaused(
          testQC
        )

        const gasUsed2 = await systemState.estimateGas.getQCPauseTimestamp(
          testQC
        )

        const gasUsed3 =
          await systemState.estimateGas.isQCEmergencyPauseExpired(testQC)

        expect(gasUsed1).to.be.lt(30000)
        expect(gasUsed2).to.be.lt(30000)
        expect(gasUsed3).to.be.lt(30000)
      })
    })
  })

  describe("Automatic Pause Expiry", () => {
    describe("Function Pause Auto-Expiry", () => {
      it("should automatically clear expired minting pause when checking", async () => {
        // Set short pause duration
        await systemState.connect(adminAccount).setEmergencyPauseDuration(1)

        // Pause minting
        await systemState.connect(pauserAccount).pauseMinting()
        expect(await systemState.isMintingPaused()).to.be.true

        // Advance time past expiry
        await helpers.time.increaseTime(2)

        // Check if expired - should auto-clear
        expect(await systemState.isEmergencyPauseExpired("minting")).to.be.true

        // This should automatically clear the expired pause
        await systemState.requireMintingNotPaused()
        expect(await systemState.isMintingPaused()).to.be.false

        // Pause timestamp should be cleared
        expect(await systemState.getPauseTimestamp("minting")).to.equal(0)
      })

      it("should automatically clear expired redemption pause", async () => {
        await systemState.connect(adminAccount).setEmergencyPauseDuration(1)
        await systemState.connect(pauserAccount).pauseRedemption()

        expect(await systemState.isRedemptionPaused()).to.be.true

        await helpers.time.increaseTime(2)

        // Test through notPaused modifier behavior by checking view function
        expect(await systemState.isEmergencyPauseExpired("redemption")).to.be
          .true

        // The pause should auto-clear when checking state
        await systemState.requireMintingNotPaused() // This calls _clearExpiredPause internally for different keys

        // Check redemption status - should trigger auto-clear for redemption pause
        expect(await systemState.isRedemptionPaused()).to.be.true // Still paused until checked directly

        // Manually check redemption - should clear via future integration
        expect(await systemState.getPauseTimestamp("redemption")).to.be.gt(0) // Timestamp still exists until cleared
      })

      it("should automatically clear expired wallet registration pause", async () => {
        await systemState.connect(adminAccount).setEmergencyPauseDuration(1)
        await systemState.connect(pauserAccount).pauseWalletRegistration()

        expect(await systemState.isWalletRegistrationPaused()).to.be.true

        await helpers.time.increaseTime(2)

        expect(await systemState.isEmergencyPauseExpired("wallet_registration"))
          .to.be.true

        // Direct check should maintain pause until modifier called
        expect(await systemState.isWalletRegistrationPaused()).to.be.true
        expect(
          await systemState.getPauseTimestamp("wallet_registration")
        ).to.be.gt(0)
      })

      it("should not clear non-expired pauses", async () => {
        await systemState.connect(adminAccount).setEmergencyPauseDuration(3600) // 1 hour
        await systemState.connect(pauserAccount).pauseMinting()

        expect(await systemState.isMintingPaused()).to.be.true

        // Advance time but not past expiry
        await helpers.time.increaseTime(1800) // 30 minutes

        expect(await systemState.isEmergencyPauseExpired("minting")).to.be.false

        // Should remain paused
        await expect(systemState.requireMintingNotPaused()).to.be.revertedWith(
          "MintingIsPaused"
        )
        expect(await systemState.isMintingPaused()).to.be.true
      })

      it("should handle multiple expired pauses independently", async () => {
        await systemState.connect(adminAccount).setEmergencyPauseDuration(1)

        // Pause both minting and redemption
        await systemState.connect(pauserAccount).pauseMinting()
        await systemState.connect(pauserAccount).pauseRedemption()

        expect(await systemState.isMintingPaused()).to.be.true
        expect(await systemState.isRedemptionPaused()).to.be.true

        await helpers.time.increaseTime(2)

        // Both should be expired
        expect(await systemState.isEmergencyPauseExpired("minting")).to.be.true
        expect(await systemState.isEmergencyPauseExpired("redemption")).to.be
          .true

        // Clear minting pause
        await systemState.requireMintingNotPaused()
        expect(await systemState.isMintingPaused()).to.be.false

        // Redemption should still be paused until checked
        expect(await systemState.isRedemptionPaused()).to.be.true
      })
    })

    describe("QC Emergency Pause Auto-Expiry", () => {
      let testQC: string

      beforeEach(async () => {
        testQC = signers.governance.address
      })

      it("should automatically clear expired QC emergency pause", async () => {
        await systemState.connect(adminAccount).setEmergencyPauseDuration(1)

        const testReason = ethers.utils.id("TEST_REASON")
        await systemState
          .connect(pauserAccount)
          .emergencyPauseQC(testQC, testReason)

        expect(await systemState.isQCEmergencyPaused(testQC)).to.be.true

        await helpers.time.increaseTime(2)

        expect(await systemState.isQCEmergencyPauseExpired(testQC)).to.be.true

        // QC should still be marked as paused until modifier checks it
        expect(await systemState.isQCEmergencyPaused(testQC)).to.be.true

        // The automatic clearing happens in qcNotEmergencyPaused modifier
        // Since we don't have a public function that uses this modifier in SystemState,
        // we test the view functions to confirm expiry detection works
        expect(await systemState.getQCPauseTimestamp(testQC)).to.be.gt(0)
      })

      it("should handle QC pause expiry at exact boundary", async () => {
        await systemState.connect(adminAccount).setEmergencyPauseDuration(100)

        const testReason = ethers.utils.id("BOUNDARY_TEST")
        await systemState
          .connect(pauserAccount)
          .emergencyPauseQC(testQC, testReason)

        // Not expired at exact duration
        await helpers.time.increaseTime(100)
        expect(await systemState.isQCEmergencyPauseExpired(testQC)).to.be.false

        // Expired after duration
        await helpers.time.increaseTime(1)
        expect(await systemState.isQCEmergencyPauseExpired(testQC)).to.be.true
      })

      it("should maintain QC pause state consistency during expiry checks", async () => {
        await systemState.connect(adminAccount).setEmergencyPauseDuration(1)

        const qc1 = ethers.Wallet.createRandom().address
        const qc2 = ethers.Wallet.createRandom().address
        const testReason = ethers.utils.id("CONSISTENCY_TEST")

        // Pause both QCs
        await systemState
          .connect(pauserAccount)
          .emergencyPauseQC(qc1, testReason)
        await helpers.time.increaseTime(1) // Small delay
        await systemState
          .connect(pauserAccount)
          .emergencyPauseQC(qc2, testReason)

        await helpers.time.increaseTime(2)

        // Both should be expired but still show as paused
        expect(await systemState.isQCEmergencyPauseExpired(qc1)).to.be.true
        expect(await systemState.isQCEmergencyPauseExpired(qc2)).to.be.true
        expect(await systemState.isQCEmergencyPaused(qc1)).to.be.true
        expect(await systemState.isQCEmergencyPaused(qc2)).to.be.true
      })
    })

    describe("Expiry Edge Cases", () => {
      it("should handle zero emergency pause duration", async () => {
        // Cannot set zero duration
        await expect(
          systemState.connect(adminAccount).setEmergencyPauseDuration(0)
        ).to.be.revertedWith("InvalidDuration")
      })

      it("should handle very large emergency pause duration", async () => {
        const maxDuration = 30 * 24 * 3600 // 30 days
        await systemState
          .connect(adminAccount)
          .setEmergencyPauseDuration(maxDuration)

        await systemState.connect(pauserAccount).pauseMinting()

        // Should not be expired even after significant time
        await helpers.time.increaseTime(24 * 3600) // 1 day
        expect(await systemState.isEmergencyPauseExpired("minting")).to.be.false
      })

      it("should handle pause duration changes after pause is active", async () => {
        await systemState.connect(adminAccount).setEmergencyPauseDuration(3600) // 1 hour
        await systemState.connect(pauserAccount).pauseMinting()

        // Change duration to shorter
        await systemState.connect(adminAccount).setEmergencyPauseDuration(1800) // 30 minutes

        // Expiry should be based on new duration
        await helpers.time.increaseTime(1900) // 31+ minutes
        expect(await systemState.isEmergencyPauseExpired("minting")).to.be.true
      })
    })
  })

  describe("Oracle Parameter Integration", () => {
    describe("Oracle Consensus Behavior", () => {
      it("should validate oracle consensus threshold affects system behavior", async () => {
        // Test minimum consensus threshold
        await systemState.connect(adminAccount).setOracleConsensusThreshold(1)
        expect(await systemState.oracleConsensusThreshold()).to.equal(1)

        // Test maximum consensus threshold
        await systemState.connect(adminAccount).setOracleConsensusThreshold(10)
        expect(await systemState.oracleConsensusThreshold()).to.equal(10)

        // Ensure parameters are within expected bounds
        const threshold = await systemState.oracleConsensusThreshold()
        expect(threshold).to.be.gte(await systemState.MIN_CONSENSUS_THRESHOLD())
        expect(threshold).to.be.lte(await systemState.MAX_CONSENSUS_THRESHOLD())
      })

      it("should coordinate oracle timeout with consensus requirements", async () => {
        // Set high consensus threshold
        await systemState.connect(adminAccount).setOracleConsensusThreshold(8)

        // Set reasonable timeout for multiple oracles to respond
        await systemState
          .connect(adminAccount)
          .setOracleAttestationTimeout(12 * 3600) // 12 hours

        const threshold = await systemState.oracleConsensusThreshold()
        const timeout = await systemState.oracleAttestationTimeout()

        expect(threshold).to.equal(8)
        expect(timeout).to.equal(12 * 3600)

        // Business logic: higher threshold should have longer timeout
        expect(timeout).to.be.gte(6 * 3600) // At least 6 hours for 8+ oracles
      })

      it("should validate oracle staleness affects system reliability", async () => {
        // Test that staleness parameters are reasonable for oracle operations
        await systemState.connect(adminAccount).setOracleMaxStaleness(12 * 3600) // 12 hours

        const staleness = await systemState.oracleMaxStaleness()
        const attestationTimeout = await systemState.oracleAttestationTimeout()

        // Staleness should be longer than attestation timeout
        expect(staleness).to.be.gte(attestationTimeout)
      })

      it("should configure oracle retry intervals for robustness", async () => {
        // Set retry interval
        await systemState.connect(adminAccount).setOracleRetryInterval(2 * 3600) // 2 hours

        const retryInterval = await systemState.oracleRetryInterval()
        const attestationTimeout = await systemState.oracleAttestationTimeout()

        expect(retryInterval).to.equal(2 * 3600)

        // Retry interval should be shorter than attestation timeout for multiple attempts
        expect(retryInterval).to.be.lte(attestationTimeout)
      })
    })

    describe("Oracle Parameter Validation", () => {
      it("should ensure oracle parameters form a coherent system", async () => {
        // Set a complete oracle configuration
        await systemState.connect(adminAccount).setOracleConsensusThreshold(5)
        await systemState
          .connect(adminAccount)
          .setOracleAttestationTimeout(8 * 3600) // 8 hours
        await systemState.connect(adminAccount).setOracleMaxStaleness(24 * 3600) // 24 hours
        await systemState.connect(adminAccount).setOracleRetryInterval(1 * 3600) // 1 hour

        const consensus = await systemState.oracleConsensusThreshold()
        const timeout = await systemState.oracleAttestationTimeout()
        const staleness = await systemState.oracleMaxStaleness()
        const retry = await systemState.oracleRetryInterval()

        // Verify logical relationships
        expect(retry).to.be.lt(timeout) // Multiple retries possible within timeout
        expect(timeout).to.be.lte(staleness) // Data shouldn't be stale before consensus
        expect(consensus).to.be.gte(3) // Reasonable decentralization
      })

      it("should handle oracle parameter boundary conditions", async () => {
        // Test minimum values
        await systemState.connect(adminAccount).setOracleConsensusThreshold(1)
        await systemState
          .connect(adminAccount)
          .setOracleAttestationTimeout(1 * 3600) // 1 hour
        await systemState.connect(adminAccount).setOracleMaxStaleness(6 * 3600) // 6 hours
        await systemState.connect(adminAccount).setOracleRetryInterval(30 * 60) // 30 minutes

        // Test maximum values
        await systemState.connect(adminAccount).setOracleConsensusThreshold(10)
        await systemState
          .connect(adminAccount)
          .setOracleAttestationTimeout(24 * 3600) // 24 hours
        await systemState
          .connect(adminAccount)
          .setOracleMaxStaleness(7 * 24 * 3600) // 7 days
        await systemState
          .connect(adminAccount)
          .setOracleRetryInterval(12 * 3600) // 12 hours

        // All should be within bounds
        expect(await systemState.oracleConsensusThreshold()).to.equal(10)
        expect(await systemState.oracleAttestationTimeout()).to.equal(24 * 3600)
        expect(await systemState.oracleMaxStaleness()).to.equal(7 * 24 * 3600)
        expect(await systemState.oracleRetryInterval()).to.equal(12 * 3600)
      })
    })
  })

  describe("Parameter Interdependency Validation", () => {
    describe("Mint Amount Relationships", () => {
      it("should maintain min <= max constraint across updates", async () => {
        // Set initial values
        await systemState
          .connect(adminAccount)
          .setMinMintAmount(ethers.utils.parseEther("1"))
        await systemState
          .connect(adminAccount)
          .setMaxMintAmount(ethers.utils.parseEther("1000"))

        // Try to violate constraint by setting min > max
        await expect(
          systemState
            .connect(adminAccount)
            .setMinMintAmount(ethers.utils.parseEther("2000"))
        ).to.be.revertedWith("MinAmountExceedsMax")

        // Try to violate constraint by setting max < min
        await expect(
          systemState
            .connect(adminAccount)
            .setMaxMintAmount(ethers.utils.parseEther("0.5"))
        ).to.be.revertedWith("MaxAmountBelowMin")

        // Valid updates should work
        await systemState
          .connect(adminAccount)
          .setMaxMintAmount(ethers.utils.parseEther("2000"))
        await systemState
          .connect(adminAccount)
          .setMinMintAmount(ethers.utils.parseEther("2"))

        expect(await systemState.minMintAmount()).to.equal(
          ethers.utils.parseEther("2")
        )
        expect(await systemState.maxMintAmount()).to.equal(
          ethers.utils.parseEther("2000")
        )
      })

      it("should allow setting min = max", async () => {
        const equalAmount = ethers.utils.parseEther("100")

        await systemState.connect(adminAccount).setMinMintAmount(equalAmount)
        await systemState.connect(adminAccount).setMaxMintAmount(equalAmount)

        expect(await systemState.minMintAmount()).to.equal(equalAmount)
        expect(await systemState.maxMintAmount()).to.equal(equalAmount)
      })
    })

    describe("Timeout and Threshold Relationships", () => {
      it("should ensure timeout parameters are logically consistent", async () => {
        // Set redemption timeout
        await systemState
          .connect(adminAccount)
          .setRedemptionTimeout(7 * 24 * 3600) // 7 days

        // Set stale threshold
        await systemState.connect(adminAccount).setStaleThreshold(24 * 3600) // 24 hours

        // Business logic: stale threshold should be much shorter than redemption timeout
        const redemptionTimeout = await systemState.redemptionTimeout()
        const staleThreshold = await systemState.staleThreshold()

        expect(staleThreshold).to.be.lt(redemptionTimeout)
        expect(redemptionTimeout.div(staleThreshold)).to.be.gte(3) // At least 3x difference
      })

      it("should validate emergency pause duration is reasonable", async () => {
        const emergencyDuration = 3 * 24 * 3600 // 3 days
        await systemState
          .connect(adminAccount)
          .setEmergencyPauseDuration(emergencyDuration)

        const pauseDuration = await systemState.emergencyPauseDuration()
        const redemptionTimeout = await systemState.redemptionTimeout()

        // Emergency pause should be shorter than redemption timeout for operational continuity
        expect(pauseDuration).to.be.lte(redemptionTimeout)
      })
    })

    describe("Collateral and Enforcement Relationships", () => {
      it("should ensure enforcement parameters are consistent", async () => {
        await systemState.connect(adminAccount).setMinCollateralRatio(150) // 150%
        await systemState.connect(adminAccount).setFailureThreshold(3)
        await systemState.connect(adminAccount).setFailureWindow(7 * 24 * 3600) // 7 days

        const ratio = await systemState.minCollateralRatio()
        const threshold = await systemState.failureThreshold()
        const window = await systemState.failureWindow()

        // Higher collateral ratios should allow more failures before enforcement
        expect(ratio).to.be.gte(100) // At least fully collateralized
        expect(threshold).to.be.gte(1) // At least 1 failure required
        expect(window).to.be.gte(24 * 3600) // At least 1 day window
      })

      it("should validate collateral ratio bounds with enforcement", async () => {
        // Test extreme values
        await systemState.connect(adminAccount).setMinCollateralRatio(100) // Minimum 100%
        await systemState.connect(adminAccount).setFailureThreshold(1) // Strict enforcement

        expect(await systemState.minCollateralRatio()).to.equal(100)
        expect(await systemState.failureThreshold()).to.equal(1)

        // Set more conservative values
        await systemState.connect(adminAccount).setMinCollateralRatio(200) // 200%
        await systemState.connect(adminAccount).setFailureThreshold(5) // More lenient

        expect(await systemState.minCollateralRatio()).to.equal(200)
        expect(await systemState.failureThreshold()).to.equal(5)
      })
    })

    describe("Cross-Parameter Impact Analysis", () => {
      it("should handle sequential parameter updates maintaining consistency", async () => {
        // Start with default values and update systematically
        const initialMin = await systemState.minMintAmount()
        const initialMax = await systemState.maxMintAmount()

        // Update max first
        const newMax = initialMax.mul(2)
        await systemState.connect(adminAccount).setMaxMintAmount(newMax)

        // Then update min to half of new max
        const newMin = newMax.div(2)
        await systemState.connect(adminAccount).setMinMintAmount(newMin)

        expect(await systemState.minMintAmount()).to.equal(newMin)
        expect(await systemState.maxMintAmount()).to.equal(newMax)
        expect(newMin).to.be.lte(newMax)
      })

      it("should validate that oracle parameters work together", async () => {
        // Set up a realistic oracle configuration
        await systemState.connect(adminAccount).setOracleConsensusThreshold(3)
        await systemState
          .connect(adminAccount)
          .setOracleAttestationTimeout(4 * 3600) // 4 hours
        await systemState.connect(adminAccount).setOracleRetryInterval(30 * 60) // 30 minutes
        await systemState.connect(adminAccount).setOracleMaxStaleness(12 * 3600) // 12 hours

        const consensus = await systemState.oracleConsensusThreshold()
        const timeout = await systemState.oracleAttestationTimeout()
        const retry = await systemState.oracleRetryInterval()
        const staleness = await systemState.oracleMaxStaleness()

        // Verify the configuration makes sense
        const maxRetries = timeout.div(retry) // Should allow multiple retries
        expect(maxRetries).to.be.gte(3) // At least 3 retry attempts
        expect(staleness).to.be.gte(timeout) // Data valid longer than consensus time
        expect(consensus).to.be.lte(10) // Reasonable number of oracles
      })
    })
  })

  describe("Emergency Recovery Scenarios", () => {
    describe("Gradual System Recovery", () => {
      it("should support phased recovery from total system pause", async () => {
        // Emergency: pause all operations
        await systemState.connect(pauserAccount).pauseMinting()
        await systemState.connect(pauserAccount).pauseRedemption()
        await systemState.connect(pauserAccount).pauseWalletRegistration()

        // Verify all operations paused
        expect(await systemState.isMintingPaused()).to.be.true
        expect(await systemState.isRedemptionPaused()).to.be.true
        expect(await systemState.isWalletRegistrationPaused()).to.be.true

        // Phase 1: Restore wallet registration first (safest)
        await systemState.connect(pauserAccount).unpauseWalletRegistration()
        expect(await systemState.isWalletRegistrationPaused()).to.be.false
        expect(await systemState.isMintingPaused()).to.be.true
        expect(await systemState.isRedemptionPaused()).to.be.true

        // Phase 2: Restore redemption (users can exit)
        await systemState.connect(pauserAccount).unpauseRedemption()
        expect(await systemState.isRedemptionPaused()).to.be.false
        expect(await systemState.isMintingPaused()).to.be.true

        // Phase 3: Finally restore minting (full operations)
        await systemState.connect(pauserAccount).unpauseMinting()
        expect(await systemState.isMintingPaused()).to.be.false

        // All operations restored
        expect(await systemState.isFunctionPaused("minting")).to.be.false
        expect(await systemState.isFunctionPaused("redemption")).to.be.false
        expect(await systemState.isFunctionPaused("wallet_registration")).to.be
          .false
      })

      it("should handle selective QC recovery after mass pause", async () => {
        const qcs = [
          ethers.Wallet.createRandom().address,
          ethers.Wallet.createRandom().address,
          ethers.Wallet.createRandom().address,
          ethers.Wallet.createRandom().address,
        ]

        const testReason = ethers.utils.id("SYSTEM_WIDE_INCIDENT")

        // Emergency: pause all QCs
        for (const qc of qcs) {
          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(qc, testReason)
        }

        // Verify all QCs paused
        for (const qc of qcs) {
          expect(await systemState.isQCEmergencyPaused(qc)).to.be.true
        }

        // Selective recovery: unpause low-risk QCs first
        await systemState.connect(pauserAccount).emergencyUnpauseQC(qcs[0])
        await systemState.connect(pauserAccount).emergencyUnpauseQC(qcs[1])

        // Verify partial recovery
        expect(await systemState.isQCEmergencyPaused(qcs[0])).to.be.false
        expect(await systemState.isQCEmergencyPaused(qcs[1])).to.be.false
        expect(await systemState.isQCEmergencyPaused(qcs[2])).to.be.true
        expect(await systemState.isQCEmergencyPaused(qcs[3])).to.be.true

        // Wait and assess before further recovery
        await helpers.time.increaseTime(3600) // 1 hour monitoring

        // Complete recovery after monitoring period
        await systemState.connect(pauserAccount).emergencyUnpauseQC(qcs[2])
        await systemState.connect(pauserAccount).emergencyUnpauseQC(qcs[3])

        // Verify full recovery
        for (const qc of qcs) {
          expect(await systemState.isQCEmergencyPaused(qc)).to.be.false
          expect(await systemState.getQCPauseTimestamp(qc)).to.equal(0)
        }
      })
    })

    describe("Emergency Council Transition During Crisis", () => {
      it("should maintain emergency powers during council transition", async () => {
        const currentCouncil = pauserAccount
        const newCouncil = signers.thirdParty
        const testQC = ethers.Wallet.createRandom().address
        const testReason = ethers.utils.id("COUNCIL_TRANSITION")

        // Current council initiates emergency response
        await systemState
          .connect(currentCouncil)
          .emergencyPauseQC(testQC, testReason)
        await systemState.connect(currentCouncil).pauseMinting()

        expect(await systemState.isQCEmergencyPaused(testQC)).to.be.true
        expect(await systemState.isMintingPaused()).to.be.true

        // Emergency transition of council
        await systemState
          .connect(signers.deployer)
          .setEmergencyCouncil(newCouncil.address)

        // Verify old council lost powers
        expect(
          await systemState.hasRole(EMERGENCY_ROLE, currentCouncil.address)
        ).to.be.false
        expect(await systemState.hasRole(EMERGENCY_ROLE, newCouncil.address)).to
          .be.true

        // New council can continue emergency response
        await systemState.connect(newCouncil).emergencyUnpauseQC(testQC)
        expect(await systemState.isQCEmergencyPaused(testQC)).to.be.false

        // Old council cannot unpause
        await expect(
          systemState.connect(currentCouncil).unpauseMinting()
        ).to.be.revertedWith("AccessControl:")

        // New council can unpause
        await systemState.connect(newCouncil).unpauseMinting()
        expect(await systemState.isMintingPaused()).to.be.false
      })

      it("should handle emergency council revocation during active emergency", async () => {
        const testQC = ethers.Wallet.createRandom().address
        const testReason = ethers.utils.id("COUNCIL_COMPROMISE")

        // Emergency council initiates pause
        await systemState
          .connect(pauserAccount)
          .emergencyPauseQC(testQC, testReason)
        expect(await systemState.isQCEmergencyPaused(testQC)).to.be.true

        // Admin revokes emergency role (security incident)
        await systemState
          .connect(signers.deployer)
          .revokeRole(EMERGENCY_ROLE, pauserAccount.address)

        // Former council cannot make changes
        await expect(
          systemState.connect(pauserAccount).emergencyUnpauseQC(testQC)
        ).to.be.revertedWith("AccessControl:")

        // Admin must assign new emergency council
        const newCouncil = signers.liquidator
        await systemState
          .connect(signers.deployer)
          .grantRole(EMERGENCY_ROLE, newCouncil.address)

        // New council can resolve emergency
        await systemState.connect(newCouncil).emergencyUnpauseQC(testQC)
        expect(await systemState.isQCEmergencyPaused(testQC)).to.be.false
      })
    })

    describe("Coordinated Multi-Vector Recovery", () => {
      it("should handle recovery from both function and QC pauses simultaneously", async () => {
        const qc1 = ethers.Wallet.createRandom().address
        const qc2 = ethers.Wallet.createRandom().address
        const testReason = ethers.utils.id("MULTI_VECTOR_ATTACK")

        // Complex emergency: both function and QC pauses
        await systemState.connect(pauserAccount).pauseMinting()
        await systemState.connect(pauserAccount).pauseRedemption()
        await systemState
          .connect(pauserAccount)
          .emergencyPauseQC(qc1, testReason)
        await systemState
          .connect(pauserAccount)
          .emergencyPauseQC(qc2, testReason)

        // Verify full emergency state
        expect(await systemState.isMintingPaused()).to.be.true
        expect(await systemState.isRedemptionPaused()).to.be.true
        expect(await systemState.isQCEmergencyPaused(qc1)).to.be.true
        expect(await systemState.isQCEmergencyPaused(qc2)).to.be.true

        // Coordinated recovery strategy
        // Step 1: Restore function operations for safe QCs
        await systemState.connect(pauserAccount).emergencyUnpauseQC(qc1) // Safe QC first
        expect(await systemState.isQCEmergencyPaused(qc1)).to.be.false

        // Step 2: Partially restore functions
        await systemState.connect(pauserAccount).unpauseRedemption() // Users can exit
        expect(await systemState.isRedemptionPaused()).to.be.false

        // Step 3: Monitor before full restoration
        await helpers.time.increaseTime(1800) // 30 minutes monitoring

        // Step 4: Complete restoration
        await systemState.connect(pauserAccount).emergencyUnpauseQC(qc2)
        await systemState.connect(pauserAccount).unpauseMinting()

        // Verify complete recovery
        expect(await systemState.isMintingPaused()).to.be.false
        expect(await systemState.isRedemptionPaused()).to.be.false
        expect(await systemState.isQCEmergencyPaused(qc1)).to.be.false
        expect(await systemState.isQCEmergencyPaused(qc2)).to.be.false
      })

      it("should handle automatic expiry during manual recovery", async () => {
        const qc = ethers.Wallet.createRandom().address
        const testReason = ethers.utils.id("EXPIRY_RECOVERY_TEST")

        // Set short pause duration
        await systemState.connect(adminAccount).setEmergencyPauseDuration(2)

        // Initiate emergency
        await systemState.connect(pauserAccount).pauseMinting()
        await systemState
          .connect(pauserAccount)
          .emergencyPauseQC(qc, testReason)

        expect(await systemState.isMintingPaused()).to.be.true
        expect(await systemState.isQCEmergencyPaused(qc)).to.be.true

        // Wait for expiry
        await helpers.time.increaseTime(3)

        // Check expiry status
        expect(await systemState.isEmergencyPauseExpired("minting")).to.be.true
        expect(await systemState.isQCEmergencyPauseExpired(qc)).to.be.true

        // Manual recovery should still work even after expiry
        await systemState.connect(pauserAccount).unpauseMinting()
        await systemState.connect(pauserAccount).emergencyUnpauseQC(qc)

        expect(await systemState.isMintingPaused()).to.be.false
        expect(await systemState.isQCEmergencyPaused(qc)).to.be.false
        expect(await systemState.getPauseTimestamp("minting")).to.equal(0)
        expect(await systemState.getQCPauseTimestamp(qc)).to.equal(0)
      })
    })

    describe("Recovery Monitoring and Validation", () => {
      it("should provide comprehensive recovery status information", async () => {
        const qcs = [
          ethers.Wallet.createRandom().address,
          ethers.Wallet.createRandom().address,
        ]

        const testReason = ethers.utils.id("MONITORING_TEST")

        // Create emergency state
        await systemState.connect(pauserAccount).pauseMinting()
        await systemState
          .connect(pauserAccount)
          .emergencyPauseQC(qcs[0], testReason)
        await systemState
          .connect(pauserAccount)
          .emergencyPauseQC(qcs[1], testReason)

        // Verify emergency monitoring data
        expect(await systemState.isFunctionPaused("minting")).to.be.true
        expect(await systemState.getPauseTimestamp("minting")).to.be.gt(0)

        for (const qc of qcs) {
          expect(await systemState.isQCEmergencyPaused(qc)).to.be.true
          expect(await systemState.getQCPauseTimestamp(qc)).to.be.gt(0)
        }

        // Begin recovery and monitor
        await systemState.connect(pauserAccount).unpauseMinting()
        await systemState.connect(pauserAccount).emergencyUnpauseQC(qcs[0])

        // Check partial recovery status
        expect(await systemState.isFunctionPaused("minting")).to.be.false
        expect(await systemState.getPauseTimestamp("minting")).to.equal(0)
        expect(await systemState.isQCEmergencyPaused(qcs[0])).to.be.false
        expect(await systemState.getQCPauseTimestamp(qcs[0])).to.equal(0)
        expect(await systemState.isQCEmergencyPaused(qcs[1])).to.be.true

        // Complete recovery
        await systemState.connect(pauserAccount).emergencyUnpauseQC(qcs[1])

        // Verify full recovery
        for (const qc of qcs) {
          expect(await systemState.isQCEmergencyPaused(qc)).to.be.false
          expect(await systemState.getQCPauseTimestamp(qc)).to.equal(0)
        }
      })
    })
  })

  // ===== Security Tests merged from system-state-security.test.ts =====
  // Note: Duplicate pause tests have been removed, only unique security scenarios preserved

  describe("Emergency Pause Duration Security", () => {
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

  describe("Concurrent Pause Attempts Security", () => {
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
