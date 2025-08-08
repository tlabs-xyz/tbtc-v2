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
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)

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
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)

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
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)

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
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)

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

      describe("pauseRegistry", () => {
        it("should pause registry successfully", async () => {
          const tx = await systemState.connect(pauserAccount).pauseRegistry()
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)

          expect(await systemState.isRegistryPaused()).to.be.true
          await expect(tx)
            .to.emit(systemState, "RegistryPaused")
            .withArgs(pauserAccount.address, currentBlock.timestamp)
        })

        it("should revert when already paused", async () => {
          await systemState.connect(pauserAccount).pauseRegistry()

          await expect(
            systemState.connect(pauserAccount).pauseRegistry()
          ).to.be.revertedWith("RegistryAlreadyPaused")
        })
      })

      describe("unpauseRegistry", () => {
        beforeEach(async () => {
          await systemState.connect(pauserAccount).pauseRegistry()
        })

        it("should unpause registry successfully", async () => {
          const tx = await systemState.connect(pauserAccount).unpauseRegistry()
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)

          expect(await systemState.isRegistryPaused()).to.be.false
          await expect(tx)
            .to.emit(systemState, "RegistryUnpaused")
            .withArgs(pauserAccount.address, currentBlock.timestamp)
        })

        it("should revert when not paused", async () => {
          await systemState.connect(pauserAccount).unpauseRegistry()

          await expect(
            systemState.connect(pauserAccount).unpauseRegistry()
          ).to.be.revertedWith("RegistryNotPaused")
        })
      })

      describe("pauseWalletRegistration", () => {
        it("should pause wallet registration successfully", async () => {
          const tx = await systemState
            .connect(pauserAccount)
            .pauseWalletRegistration()
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)

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
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber)

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

      it("should revert for pauseWalletRegistration", async () => {
        await expect(
          systemState.connect(thirdParty).pauseWalletRegistration()
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
          const oldAmount = await systemState.minMintAmount()
          const tx = await systemState
            .connect(adminAccount)
            .setMinMintAmount(testMinMintAmount)

          expect(await systemState.minMintAmount()).to.equal(testMinMintAmount)
          await expect(tx)
            .to.emit(systemState, "MinMintAmountUpdated")
            .withArgs(oldAmount, testMinMintAmount, adminAccount.address)
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

          expect(await systemState.maxMintAmount()).to.equal(testMaxMintAmount)
          await expect(tx)
            .to.emit(systemState, "MaxMintAmountUpdated")
            .withArgs(oldAmount, testMaxMintAmount, adminAccount.address)
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
          ).to.be.revertedWith("InvalidThreshold")
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

      describe("setWalletRegistrationDelay", () => {
        it("should update wallet registration delay successfully", async () => {
          const newDelay = 2 * 3600 // 2 hours
          const oldDelay = await systemState.walletRegistrationDelay()
          const tx = await systemState
            .connect(adminAccount)
            .setWalletRegistrationDelay(newDelay)

          expect(await systemState.walletRegistrationDelay()).to.equal(newDelay)
          await expect(tx)
            .to.emit(systemState, "WalletRegistrationDelayUpdated")
            .withArgs(oldDelay, newDelay, adminAccount.address)
        })

        it("should allow zero delay", async () => {
          await systemState.connect(adminAccount).setWalletRegistrationDelay(0)
          expect(await systemState.walletRegistrationDelay()).to.equal(0)
        })

        it("should revert when delay exceeds 24 hours", async () => {
          const invalidDelay = 24 * 3600 + 1 // 24 hours + 1 second

          await expect(
            systemState
              .connect(adminAccount)
              .setWalletRegistrationDelay(invalidDelay)
          ).to.be.revertedWith("DelayTooLong")
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
            .connect(deployer)
            .setEmergencyCouncil(newCouncil.address)

          expect(await systemState.emergencyCouncil()).to.equal(
            newCouncil.address
          )
          await expect(tx)
            .to.emit(systemState, "EmergencyCouncilUpdated")
            .withArgs(oldCouncil, newCouncil.address, deployer.address)
        })

        it("should grant PAUSER_ROLE to new council", async () => {
          await systemState
            .connect(deployer)
            .setEmergencyCouncil(newCouncil.address)

          expect(await systemState.hasRole(PAUSER_ROLE, newCouncil.address)).to
            .be.true
        })

        it("should revoke PAUSER_ROLE from old council", async () => {
          // First set a council
          await systemState
            .connect(deployer)
            .setEmergencyCouncil(newCouncil.address)
          expect(await systemState.hasRole(PAUSER_ROLE, newCouncil.address)).to
            .be.true

          // Then change to another council
          const anotherCouncil = thirdParty
          await systemState
            .connect(deployer)
            .setEmergencyCouncil(anotherCouncil.address)

          expect(await systemState.hasRole(PAUSER_ROLE, newCouncil.address)).to
            .be.false
          expect(await systemState.hasRole(PAUSER_ROLE, anotherCouncil.address))
            .to.be.true
        })

        it("should revert with zero address", async () => {
          await expect(
            systemState
              .connect(deployer)
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

      it("should revert for setWalletRegistrationDelay", async () => {
        await expect(
          systemState.connect(thirdParty).setWalletRegistrationDelay(3600)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${PARAMETER_ADMIN_ROLE}`
        )
      })

      it("should revert for setEmergencyPauseDuration", async () => {
        await expect(
          systemState.connect(thirdParty).setEmergencyPauseDuration(86400)
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
        expect(await systemState.isWalletRegistrationPaused()).to.be.false

        await systemState.connect(pauserAccount).pauseRedemption()
        expect(await systemState.isMintingPaused()).to.be.true
        expect(await systemState.isRedemptionPaused()).to.be.true
        expect(await systemState.isRegistryPaused()).to.be.false
        expect(await systemState.isWalletRegistrationPaused()).to.be.false

        await systemState.connect(pauserAccount).pauseWalletRegistration()
        expect(await systemState.isMintingPaused()).to.be.true
        expect(await systemState.isRedemptionPaused()).to.be.true
        expect(await systemState.isRegistryPaused()).to.be.false
        expect(await systemState.isWalletRegistrationPaused()).to.be.true

        await systemState.connect(pauserAccount).unpauseMinting()
        expect(await systemState.isMintingPaused()).to.be.false
        expect(await systemState.isRedemptionPaused()).to.be.true
        expect(await systemState.isRegistryPaused()).to.be.false
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
          systemState.connect(adminAccount).setWalletRegistrationDelay(3600)
        ).to.emit(systemState, "WalletRegistrationDelayUpdated")

        await expect(
          systemState
            .connect(adminAccount)
            .setEmergencyPauseDuration(3 * 24 * 3600)
        ).to.emit(systemState, "EmergencyPauseDurationUpdated")

        await expect(
          systemState.connect(deployer).setEmergencyCouncil(thirdParty.address)
        ).to.emit(systemState, "EmergencyCouncilUpdated")
      })
    })
  })

  describe("Emergency QC Functions", () => {
    let testQC: string
    let testReason: string
    let invalidQC: string

    beforeEach(async () => {
      testQC = governance.address // Use governance address as test QC
      testReason = ethers.utils.id("INSUFFICIENT_COLLATERAL")
      invalidQC = ethers.constants.AddressZero
    })

    describe("emergencyPauseQC", () => {
      context("when called by pauser", () => {
        it("should pause QC successfully with correct reason", async () => {
          const tx = await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber!)

          // Verify state changes
          expect(await systemState.isQCEmergencyPaused(testQC)).to.be.true
          expect(await systemState.getQCPauseTimestamp(testQC)).to.equal(
            currentBlock.timestamp
          )

          // Verify events
          await expect(tx)
            .to.emit(systemState, "QCEmergencyPaused")
            .withArgs(testQC, pauserAccount.address, currentBlock.timestamp, testReason)

          await expect(tx)
            .to.emit(systemState, "EmergencyActionTaken")
            .withArgs(testQC, ethers.utils.formatBytes32String("QC_EMERGENCY_PAUSE"), pauserAccount.address, currentBlock.timestamp)
        })

        it("should handle different reason codes", async () => {
          const reasons = [
            ethers.utils.id("INSUFFICIENT_COLLATERAL"),
            ethers.utils.id("STALE_ATTESTATION"),
            ethers.utils.id("COMPLIANCE_VIOLATION"),
            ethers.utils.id("SECURITY_INCIDENT"),
            ethers.utils.id("TECHNICAL_FAILURE")
          ]

          for (const reason of reasons) {
            const qc = ethers.Wallet.createRandom().address
            
            const tx = await systemState.connect(pauserAccount).emergencyPauseQC(qc, reason)
            const currentBlock = await ethers.provider.getBlock(tx.blockNumber!)
            
            await expect(tx)
              .to.emit(systemState, "QCEmergencyPaused")
              .withArgs(qc, pauserAccount.address, currentBlock.timestamp, reason)

            expect(await systemState.isQCEmergencyPaused(qc)).to.be.true
          }
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
            systemState.connect(thirdParty).emergencyPauseQC(testQC, testReason)
          ).to.be.revertedWith("AccessControl: account")
        })
      })

      context("when called by admin", () => {
        it("should work if admin also has pauser role", async () => {
          await systemState.grantRole(PAUSER_ROLE, adminAccount.address)

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
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber!)

          // Verify state changes
          expect(await systemState.isQCEmergencyPaused(testQC)).to.be.false
          expect(await systemState.getQCPauseTimestamp(testQC)).to.equal(0)

          // Verify events
          await expect(tx)
            .to.emit(systemState, "QCEmergencyUnpaused")
            .withArgs(testQC, pauserAccount.address, currentBlock.timestamp)

          await expect(tx)
            .to.emit(systemState, "EmergencyActionTaken")
            .withArgs(testQC, ethers.utils.formatBytes32String("QC_EMERGENCY_UNPAUSE"), pauserAccount.address, currentBlock.timestamp)
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
            systemState.connect(thirdParty).emergencyUnpauseQC(testQC)
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
          expect(await systemState.isQCEmergencyPauseExpired(testQC)).to.be.false
        })

        it("should return false for recently paused QC", async () => {
          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)
          expect(await systemState.isQCEmergencyPauseExpired(testQC)).to.be.false
        })

        it("should return true after emergency pause duration", async () => {
          // Set a short emergency pause duration for testing
          await systemState
            .connect(adminAccount)
            .setEmergencyPauseDuration(1) // 1 second

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
          const currentBlock = await ethers.provider.getBlock(tx.blockNumber!)

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
        let testContract: any

        beforeEach(async () => {
          // Deploy a test contract that uses the modifier
          const TestContract = await ethers.getContractFactory("TestEmergencyIntegration")
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

          await expect(testContract.testFunction(testQC))
            .to.be.revertedWith("QCIsEmergencyPaused")
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
          const attacker = thirdParty
          
          await expect(
            systemState.connect(attacker).emergencyPauseQC(testQC, testReason)
          ).to.be.revertedWith("AccessControl: account")
        })

        it("should prevent parameter admin from pausing without pauser role", async () => {
          await expect(
            systemState.connect(adminAccount).emergencyPauseQC(testQC, testReason)
          ).to.be.revertedWith("AccessControl: account")
        })

        it("should allow emergency council to pause if granted pauser role", async () => {
          const emergencyCouncil = thirdParty
          await systemState.setEmergencyCouncil(emergencyCouncil.address)
          await systemState.grantRole(PAUSER_ROLE, emergencyCouncil.address)

          await expect(
            systemState.connect(emergencyCouncil).emergencyPauseQC(testQC, testReason)
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
            systemState.connect(thirdParty).emergencyUnpauseQC(testQC)
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
          await systemState
            .connect(adminAccount)
            .setEmergencyPauseDuration(2)

          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)

          // Check not expired initially
          expect(await systemState.isQCEmergencyPauseExpired(testQC)).to.be.false

          // Fast forward to exactly expiry time (should still not be expired)
          await helpers.time.increaseTime(2)
          expect(await systemState.isQCEmergencyPauseExpired(testQC)).to.be.false

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
            ethers.Wallet.createRandom().address
          ]

          // Pause all QCs
          for (const qc of qcs) {
            await systemState
              .connect(pauserAccount)
              .emergencyPauseQC(qc, testReason)
          }
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
          for (const qc of qcs) {
            await systemState.connect(pauserAccount).emergencyUnpauseQC(qc)
            expect(await systemState.isQCEmergencyPaused(qc)).to.be.false
          }
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
          const [newPauser] = await ethers.getSigners()

          await systemState
            .connect(pauserAccount)
            .emergencyPauseQC(testQC, testReason)

          // Grant pauser role to new account  
          await systemState.grantRole(PAUSER_ROLE, newPauser.address)

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
        const gasUsed1 = await systemState.estimateGas.isQCEmergencyPaused(testQC)
        const gasUsed2 = await systemState.estimateGas.getQCPauseTimestamp(testQC)
        const gasUsed3 = await systemState.estimateGas.isQCEmergencyPauseExpired(testQC)

        expect(gasUsed1).to.be.lt(30000)
        expect(gasUsed2).to.be.lt(30000)
        expect(gasUsed3).to.be.lt(30000)
      })
    })
  })
})
