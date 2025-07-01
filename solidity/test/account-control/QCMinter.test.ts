import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import { QCMinter, ProtocolRegistry, IMintingPolicy } from "../../typechain"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCMinter", () => {
  let deployer: SignerWithAddress
  let user: SignerWithAddress
  let qcAddress: SignerWithAddress
  let thirdParty: SignerWithAddress

  let qcMinter: QCMinter
  let protocolRegistry: ProtocolRegistry
  let mockMintingPolicy: FakeContract<IMintingPolicy>

  // Service keys
  let MINTING_POLICY_KEY: string

  // Test data
  const mintAmount = ethers.utils.parseEther("5")
  const mintId = ethers.utils.id("test_mint_id")

  before(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;[deployer, user, qcAddress, thirdParty] = await ethers.getSigners()

    // Generate service keys
    MINTING_POLICY_KEY = ethers.utils.id("MINTING_POLICY")
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy ProtocolRegistry
    const ProtocolRegistryFactory = await ethers.getContractFactory(
      "ProtocolRegistry"
    )
    protocolRegistry = await ProtocolRegistryFactory.deploy()
    await protocolRegistry.deployed()

    // Deploy QCMinter
    const QCMinterFactory = await ethers.getContractFactory("QCMinter")
    qcMinter = await QCMinterFactory.deploy(protocolRegistry.address)
    await qcMinter.deployed()

    // Create mock minting policy
    mockMintingPolicy = await smock.fake<IMintingPolicy>("IMintingPolicy")

    // Register minting policy service
    await protocolRegistry.setService(
      MINTING_POLICY_KEY,
      mockMintingPolicy.address
    )
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment", () => {
    it("should set correct protocol registry", async () => {
      expect(await qcMinter.protocolRegistry()).to.equal(
        protocolRegistry.address
      )
    })

    it("should have correct service key constant", async () => {
      expect(await qcMinter.MINTING_POLICY_KEY()).to.equal(MINTING_POLICY_KEY)
    })
  })

  describe("requestQCMint", () => {
    context("when called with valid parameters", () => {
      it("should delegate to minting policy", async () => {
        mockMintingPolicy.requestMint.returns(mintId)
        await qcMinter
          .connect(user)
          .requestQCMint(qcAddress.address, mintAmount)

        expect(mockMintingPolicy.requestMint).to.have.been.calledWith(
          qcAddress.address,
          user.address,
          mintAmount
        )
      })

      it("should emit QCMintRequested event", async () => {
        mockMintingPolicy.requestMint.returns(mintId)
        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
        )
          .to.emit(qcMinter, "QCMintRequested")
          .withArgs(qcAddress.address, user.address, mintAmount, mintId)
      })
    })

    context("when called with invalid parameters", () => {
      it("should revert with zero QC address", async () => {
        await expect(
          qcMinter
            .connect(user)
            .requestQCMint(ethers.constants.AddressZero, mintAmount)
        ).to.be.revertedWith("Invalid QC address")
      })

      it("should revert with zero amount", async () => {
        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, 0)
        ).to.be.revertedWith("Amount must be greater than zero")
      })
    })

    context("when minting policy is not set", () => {
      beforeEach(async () => {
        // Deploy new registry without minting policy
        const EmptyRegistryFactory = await ethers.getContractFactory(
          "ProtocolRegistry"
        )
        const emptyRegistry = await EmptyRegistryFactory.deploy()
        await emptyRegistry.deployed()

        const QCMinterFactory = await ethers.getContractFactory("QCMinter")
        const minterWithEmptyRegistry = await QCMinterFactory.deploy(
          emptyRegistry.address
        )
        await minterWithEmptyRegistry.deployed()

        qcMinter = minterWithEmptyRegistry
      })

      it("should revert", async () => {
        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
        ).to.be.revertedWith("Service not registered")
      })
    })

    context("when minting policy reverts", () => {
      it("should propagate the revert", async () => {
        mockMintingPolicy.requestMint
          .whenCalledWith(qcAddress.address, user.address, mintAmount)
          .reverts("Policy validation failed")

        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
        ).to.be.reverted
      })
    })
  })

  describe("getAvailableMintingCapacity", () => {
    const availableCapacity = ethers.utils.parseEther("10")

    beforeEach(async () => {
      mockMintingPolicy.getAvailableMintingCapacity
        .whenCalledWith(qcAddress.address)
        .returns(availableCapacity)
    })

    it("should delegate to minting policy", async () => {
      const result = await qcMinter.getAvailableMintingCapacity(
        qcAddress.address
      )

      expect(
        mockMintingPolicy.getAvailableMintingCapacity
      ).to.have.been.calledWith(qcAddress.address)
      expect(result).to.equal(availableCapacity)
    })

    context("when minting policy is not set", () => {
      beforeEach(async () => {
        // Deploy new registry without minting policy
        const EmptyRegistryFactory = await ethers.getContractFactory(
          "ProtocolRegistry"
        )
        const emptyRegistry = await EmptyRegistryFactory.deploy()
        await emptyRegistry.deployed()

        const QCMinterFactory = await ethers.getContractFactory("QCMinter")
        const minterWithEmptyRegistry = await QCMinterFactory.deploy(
          emptyRegistry.address
        )
        await minterWithEmptyRegistry.deployed()

        qcMinter = minterWithEmptyRegistry
      })

      it("should revert", async () => {
        await expect(
          qcMinter.getAvailableMintingCapacity(qcAddress.address)
        ).to.be.revertedWith("Service not registered")
      })
    })

    context("when minting policy reverts", () => {
      beforeEach(async () => {
        mockMintingPolicy.getAvailableMintingCapacity
          .whenCalledWith(qcAddress.address)
          .reverts()
      })

      it("should propagate the revert", async () => {
        await expect(qcMinter.getAvailableMintingCapacity(qcAddress.address)).to
          .be.reverted
      })
    })
  })

  describe("checkMintingEligibility", () => {
    beforeEach(async () => {
      mockMintingPolicy.checkMintingEligibility.returns(true)
    })

    it("should delegate to minting policy", async () => {
      const result = await qcMinter.checkMintingEligibility(
        qcAddress.address,
        mintAmount
      )

      expect(mockMintingPolicy.checkMintingEligibility).to.have.been.calledWith(
        qcAddress.address,
        mintAmount
      )
      expect(result).to.be.true
    })

    context("when minting policy returns false", () => {
      beforeEach(async () => {
        mockMintingPolicy.checkMintingEligibility.returns(false)
      })

      it("should return false", async () => {
        const result = await qcMinter.checkMintingEligibility(
          qcAddress.address,
          mintAmount
        )
        expect(result).to.be.false
      })
    })

    context("when minting policy is not set", () => {
      beforeEach(async () => {
        // Deploy new registry without minting policy
        const EmptyRegistryFactory = await ethers.getContractFactory(
          "ProtocolRegistry"
        )
        const emptyRegistry = await EmptyRegistryFactory.deploy()
        await emptyRegistry.deployed()

        const QCMinterFactory = await ethers.getContractFactory("QCMinter")
        const minterWithEmptyRegistry = await QCMinterFactory.deploy(
          emptyRegistry.address
        )
        await minterWithEmptyRegistry.deployed()

        qcMinter = minterWithEmptyRegistry
      })

      it("should revert", async () => {
        await expect(
          qcMinter.checkMintingEligibility(qcAddress.address, mintAmount)
        ).to.be.revertedWith("Service not registered")
      })
    })

    context("when multiple users mint from same QC", () => {
      let user2: SignerWithAddress
      const mintId2 = ethers.utils.id("test_mint_id_2")

      beforeEach(async () => {
        user2 = thirdParty
        mockMintingPolicy.requestMint
          .whenCalledWith(qcAddress.address, user.address, mintAmount)
          .returns(mintId)
        mockMintingPolicy.requestMint
          .whenCalledWith(qcAddress.address, user2.address, mintAmount)
          .returns(mintId2)
      })

      it("should handle multiple concurrent mints", async () => {
        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
        )
          .to.emit(qcMinter, "QCMintRequested")
          .withArgs(qcAddress.address, user.address, mintAmount, mintId)

        await expect(
          qcMinter.connect(user2).requestQCMint(qcAddress.address, mintAmount)
        )
          .to.emit(qcMinter, "QCMintRequested")
          .withArgs(qcAddress.address, user2.address, mintAmount, mintId2)
      })
    })

    context("when same user mints multiple times", () => {
      const mintId2 = ethers.utils.id("test_mint_id_2")

      it("should handle multiple mints from same user", async () => {
        mockMintingPolicy.requestMint
          .whenCalledWith(qcAddress.address, user.address, mintAmount)
          .returns(mintId)
        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
        )
          .to.emit(qcMinter, "QCMintRequested")
          .withArgs(qcAddress.address, user.address, mintAmount, mintId)

        mockMintingPolicy.requestMint
          .whenCalledWith(qcAddress.address, user.address, mintAmount)
          .returns(mintId2)
        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
        )
          .to.emit(qcMinter, "QCMintRequested")
          .withArgs(qcAddress.address, user.address, mintAmount, mintId2)
      })
    })

    context("when protocol registry service is updated", () => {
      let newMintingPolicy: FakeContract<IMintingPolicy>
      const newMintId = ethers.utils.id("new_mint_id")

      beforeEach(async () => {
        newMintingPolicy = await smock.fake<IMintingPolicy>("IMintingPolicy")
        newMintingPolicy.requestMint.returns(newMintId)

        await protocolRegistry.setService(
          MINTING_POLICY_KEY,
          newMintingPolicy.address
        )
      })

      it("should use updated minting policy", async () => {
        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
        )
          .to.emit(qcMinter, "QCMintRequested")
          .withArgs(qcAddress.address, user.address, mintAmount, newMintId)

        expect(newMintingPolicy.requestMint).to.have.been.calledWith(
          qcAddress.address,
          user.address,
          mintAmount
        )
      })
    })

    context("when policy contract is malicious", () => {
      let maliciousPolicy: FakeContract<IMintingPolicy>

      beforeEach(async () => {
        maliciousPolicy = await smock.fake<IMintingPolicy>("IMintingPolicy")
        await protocolRegistry.setService(
          MINTING_POLICY_KEY,
          maliciousPolicy.address
        )
      })

      it("should revert with appropriate error for requestQCMint", async () => {
        maliciousPolicy.requestMint.reverts() // Generic revert

        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
        ).to.be.reverted
      })

      it("should handle view function calls gracefully", async () => {
        maliciousPolicy.getAvailableMintingCapacity.reverts()

        await expect(qcMinter.getAvailableMintingCapacity(qcAddress.address)).to
          .be.reverted
      })
    })
  })

  describe("Edge Cases", () => {
    context("boundary conditions", () => {
      it("should handle maximum mint amount", async () => {
        const maxMintAmount = ethers.constants.MaxUint256
        mockMintingPolicy.requestMint.returns(mintId)
        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, maxMintAmount)
        )
          .to.emit(qcMinter, "QCMintRequested")
          .withArgs(qcAddress.address, user.address, maxMintAmount, mintId)
      })

      it("should handle minimum mint amount", async () => {
        const minMintAmount = ethers.BigNumber.from(1)
        mockMintingPolicy.requestMint.returns(mintId)
        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, minMintAmount)
        )
          .to.emit(qcMinter, "QCMintRequested")
          .withArgs(qcAddress.address, user.address, minMintAmount, mintId)
      })
    })

    context("when policy contract is malicious", () => {
      let maliciousPolicy: FakeContract<IMintingPolicy>

      beforeEach(async () => {
        maliciousPolicy = await smock.fake<IMintingPolicy>("IMintingPolicy")
        await protocolRegistry.setService(
          MINTING_POLICY_KEY,
          maliciousPolicy.address
        )
      })

      it("should revert with appropriate error for requestQCMint", async () => {
        maliciousPolicy.requestMint.reverts() // Generic revert

        await expect(
          qcMinter.connect(user).requestQCMint(qcAddress.address, mintAmount)
        ).to.be.reverted
      })

      it("should handle view function calls gracefully", async () => {
        maliciousPolicy.getAvailableMintingCapacity.reverts()

        await expect(qcMinter.getAvailableMintingCapacity(qcAddress.address)).to
          .be.reverted
      })
    })
  })
})
