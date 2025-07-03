import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  BasicMintingPolicy,
  ProtocolRegistry,
  QCManager,
  QCData,
  SystemState,
  TBTC,
} from "../../typechain"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("BasicMintingPolicy", () => {
  let deployer: SignerWithAddress
  let user: SignerWithAddress
  let qcAddress: SignerWithAddress

  let basicMintingPolicy: BasicMintingPolicy
  let protocolRegistry: ProtocolRegistry
  let mockQcManager: FakeContract<QCManager>
  let mockQcData: FakeContract<QCData>
  let mockSystemState: FakeContract<SystemState>
  let mockTbtc: FakeContract<TBTC>

  // Service keys
  let QC_MANAGER_KEY: string
  let QC_DATA_KEY: string
  let SYSTEM_STATE_KEY: string
  let QC_RESERVE_LEDGER_KEY: string
  let TBTC_TOKEN_KEY: string

  // Roles
  let MINTER_ROLE: string

  // Test amounts
  const minMintAmount = ethers.utils.parseEther("0.1")
  const maxMintAmount = ethers.utils.parseEther("100")
  const normalMintAmount = ethers.utils.parseEther("5")
  const availableCapacity = ethers.utils.parseEther("10")

  before(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;[deployer, user, qcAddress] = await ethers.getSigners()

    // Generate service keys
    QC_MANAGER_KEY = ethers.utils.id("QC_MANAGER")
    QC_DATA_KEY = ethers.utils.id("QC_DATA")
    SYSTEM_STATE_KEY = ethers.utils.id("SYSTEM_STATE")
    QC_RESERVE_LEDGER_KEY = ethers.utils.id("QC_RESERVE_LEDGER")
    TBTC_TOKEN_KEY = ethers.utils.id("TBTC_TOKEN")

    // Generate role hashes
    MINTER_ROLE = ethers.utils.id("MINTER_ROLE")
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy ProtocolRegistry
    const ProtocolRegistryFactory = await ethers.getContractFactory(
      "ProtocolRegistry"
    )
    protocolRegistry = await ProtocolRegistryFactory.deploy()
    await protocolRegistry.deployed()

    // Deploy BasicMintingPolicy
    const BasicMintingPolicyFactory = await ethers.getContractFactory(
      "BasicMintingPolicy"
    )
    basicMintingPolicy = await BasicMintingPolicyFactory.deploy(
      protocolRegistry.address
    )
    await basicMintingPolicy.deployed()

    // Create mock contracts
    mockQcManager = await smock.fake<QCManager>("QCManager")
    mockQcData = await smock.fake<QCData>("QCData")
    mockSystemState = await smock.fake<SystemState>("SystemState")
    mockTbtc = await smock.fake<TBTC>("TBTC")

    // Register services
    await protocolRegistry.setService(QC_MANAGER_KEY, mockQcManager.address)
    await protocolRegistry.setService(QC_DATA_KEY, mockQcData.address)
    await protocolRegistry.setService(SYSTEM_STATE_KEY, mockSystemState.address)
    await protocolRegistry.setService(TBTC_TOKEN_KEY, mockTbtc.address)

    // Set up default mock behaviors
    mockSystemState.isMintingPaused.returns(false)
    mockSystemState.minMintAmount.returns(minMintAmount)
    mockSystemState.maxMintAmount.returns(maxMintAmount)
    mockQcData.getQCStatus.returns(0) // Active
    mockQcData.getQCMintedAmount.returns(0)
    mockQcManager.getAvailableMintingCapacity.returns(availableCapacity)

    // Grant MINTER_ROLE to deployer for testing
    await basicMintingPolicy.grantRole(MINTER_ROLE, deployer.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment", () => {
    it("should set correct protocol registry", async () => {
      expect(await basicMintingPolicy.protocolRegistry()).to.equal(
        protocolRegistry.address
      )
    })

    it("should grant deployer admin role", async () => {
      const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
      expect(
        await basicMintingPolicy.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)
      ).to.be.true
    })
  })

  describe("Service Key Constants", () => {
    it("should have correct service key constants", async () => {
      expect(await basicMintingPolicy.QC_MANAGER_KEY()).to.equal(QC_MANAGER_KEY)
      expect(await basicMintingPolicy.QC_DATA_KEY()).to.equal(QC_DATA_KEY)
      expect(await basicMintingPolicy.SYSTEM_STATE_KEY()).to.equal(
        SYSTEM_STATE_KEY
      )
      expect(await basicMintingPolicy.QC_RESERVE_LEDGER_KEY()).to.equal(
        QC_RESERVE_LEDGER_KEY
      )
      expect(await basicMintingPolicy.TBTC_TOKEN_KEY()).to.equal(TBTC_TOKEN_KEY)
    })
  })

  describe("requestMint", () => {
    context("when called without MINTER_ROLE", () => {
      it("should revert", async () => {
        await expect(
          basicMintingPolicy
            .connect(user)
            .requestMint(qcAddress.address, user.address, normalMintAmount)
        ).to.be.revertedWith(
          `AccessControl: account ${user.address.toLowerCase()} is missing role ${MINTER_ROLE}`
        )
      })
    })

    context("when called with invalid parameters", () => {
      it("should revert with zero QC address", async () => {
        await expect(
          basicMintingPolicy.requestMint(
            ethers.constants.AddressZero,
            user.address,
            normalMintAmount
          )
        ).to.be.revertedWith("InvalidQCAddress")
      })

      it("should revert with zero user address", async () => {
        await expect(
          basicMintingPolicy.requestMint(
            qcAddress.address,
            ethers.constants.AddressZero,
            normalMintAmount
          )
        ).to.be.revertedWith("InvalidUserAddress")
      })

      it("should revert with zero amount", async () => {
        await expect(
          basicMintingPolicy.requestMint(qcAddress.address, user.address, 0)
        ).to.be.revertedWith("InvalidAmount")
      })
    })

    context("when system checks fail", () => {
      it("should revert when minting is paused", async () => {
        mockSystemState.isMintingPaused.returns(true)

        await expect(
          basicMintingPolicy.requestMint(
            qcAddress.address,
            user.address,
            normalMintAmount
          )
        ).to.be.revertedWith("MintingPaused")
      })

      it("should revert when amount is below minimum", async () => {
        const tooSmallAmount = minMintAmount.sub(1)

        await expect(
          basicMintingPolicy.requestMint(
            qcAddress.address,
            user.address,
            tooSmallAmount
          )
        ).to.be.revertedWith("AmountOutsideAllowedRange")
      })

      it("should revert when amount is above maximum", async () => {
        const tooLargeAmount = maxMintAmount.add(1)

        await expect(
          basicMintingPolicy.requestMint(
            qcAddress.address,
            user.address,
            tooLargeAmount
          )
        ).to.be.revertedWith("AmountOutsideAllowedRange")
      })
    })

    context("when QC status checks fail", () => {
      it("should revert when QC is not active", async () => {
        mockQcData.getQCStatus.returns(1) // UnderReview

        await expect(
          basicMintingPolicy.requestMint(
            qcAddress.address,
            user.address,
            normalMintAmount
          )
        ).to.be.revertedWith("QCNotActive")
      })
    })

    context("when capacity checks fail", () => {
      it("should revert when insufficient capacity", async () => {
        const insufficientCapacity = normalMintAmount.sub(1)
        mockQcManager.getAvailableMintingCapacity.returns(insufficientCapacity)

        await expect(
          basicMintingPolicy.requestMint(
            qcAddress.address,
            user.address,
            normalMintAmount
          )
        ).to.be.revertedWith("InsufficientMintingCapacity")
      })
    })

    context("when all validations pass", () => {
      let tx: any
      let mintId: string

      beforeEach(async () => {
        tx = await basicMintingPolicy.requestMint(
          qcAddress.address,
          user.address,
          normalMintAmount
        )
        const receipt = await tx.wait()
        const event = receipt.events?.find(
          (e: any) => e.event === "MintCompleted"
        )
        mintId = event?.args?.mintId
      })

      it("should call tBTC mint", async () => {
        expect(mockTbtc.mint).to.have.been.calledWith(
          user.address,
          normalMintAmount
        )
      })

      it("should update QC minted amount", async () => {
        expect(mockQcManager.updateQCMintedAmount).to.have.been.calledWith(
          qcAddress.address,
          normalMintAmount
        )
      })

      it("should mark mint as completed", async () => {
        expect(await basicMintingPolicy.isMintCompleted(mintId)).to.be.true
      })

      it("should emit MintCompleted event", async () => {
        await expect(tx)
          .to.emit(basicMintingPolicy, "MintCompleted")
          .withArgs(
            mintId,
            qcAddress.address,
            user.address,
            normalMintAmount,
            deployer.address, // completedBy - the address calling requestMint (has MINTER_ROLE)
            await ethers.provider
              .getBlock(tx.blockNumber)
              .then((b) => b.timestamp) // timestamp
          )
      })

      it("should return unique mint ID", async () => {
        const tx2 = await basicMintingPolicy.requestMint(
          qcAddress.address,
          user.address,
          normalMintAmount
        )
        const receipt2 = await tx2.wait()
        const event2 = receipt2.events?.find(
          (e: any) => e.event === "MintCompleted"
        )
        const mintId2 = event2?.args?.mintId

        expect(mintId).to.not.equal(mintId2)
      })
    })

    context("when QC has existing minted amount", () => {
      beforeEach(async () => {
        const existingMinted = ethers.utils.parseEther("3")
        mockQcData.getQCMintedAmount.returns(existingMinted)
      })

      it("should update minted amount correctly", async () => {
        await basicMintingPolicy.requestMint(
          qcAddress.address,
          user.address,
          normalMintAmount
        )

        const expectedTotal = ethers.utils.parseEther("8") // 3 + 5
        expect(mockQcManager.updateQCMintedAmount).to.have.been.calledWith(
          qcAddress.address,
          expectedTotal
        )
      })
    })
  })

  describe("getAvailableMintingCapacity", () => {
    it("should delegate to QCManager", async () => {
      const result = await basicMintingPolicy.getAvailableMintingCapacity(
        qcAddress.address
      )

      expect(mockQcManager.getAvailableMintingCapacity).to.have.been.calledWith(
        qcAddress.address
      )
      expect(result).to.equal(availableCapacity)
    })
  })

  describe("checkMintingEligibility", () => {
    context("when system is paused", () => {
      beforeEach(async () => {
        mockSystemState.isMintingPaused.returns(true)
      })

      it("should return false", async () => {
        const result = await basicMintingPolicy.checkMintingEligibility(
          qcAddress.address,
          normalMintAmount
        )
        expect(result).to.be.false
      })
    })

    context("when amount is outside allowed range", () => {
      it("should return false for amount below minimum", async () => {
        const tooSmallAmount = minMintAmount.sub(1)
        const result = await basicMintingPolicy.checkMintingEligibility(
          qcAddress.address,
          tooSmallAmount
        )
        expect(result).to.be.false
      })

      it("should return false for amount above maximum", async () => {
        const tooLargeAmount = maxMintAmount.add(1)
        const result = await basicMintingPolicy.checkMintingEligibility(
          qcAddress.address,
          tooLargeAmount
        )
        expect(result).to.be.false
      })
    })

    context("when QC is not active", () => {
      beforeEach(async () => {
        mockQcData.getQCStatus.returns(1) // UnderReview
      })

      it("should return false", async () => {
        const result = await basicMintingPolicy.checkMintingEligibility(
          qcAddress.address,
          normalMintAmount
        )
        expect(result).to.be.false
      })
    })

    context("when insufficient capacity", () => {
      beforeEach(async () => {
        const insufficientCapacity = normalMintAmount.sub(1)
        mockQcManager.getAvailableMintingCapacity.returns(insufficientCapacity)
      })

      it("should return false", async () => {
        const result = await basicMintingPolicy.checkMintingEligibility(
          qcAddress.address,
          normalMintAmount
        )
        expect(result).to.be.false
      })
    })

    context("when all conditions are met", () => {
      it("should return true", async () => {
        const result = await basicMintingPolicy.checkMintingEligibility(
          qcAddress.address,
          normalMintAmount
        )
        expect(result).to.be.true
      })
    })
  })

  describe("isMintCompleted", () => {
    it("should return false for non-existent mint", async () => {
      const nonExistentId = ethers.utils.id("non_existent")
      const result = await basicMintingPolicy.isMintCompleted(nonExistentId)
      expect(result).to.be.false
    })

    it("should return true for completed mint", async () => {
      const tx = await basicMintingPolicy.requestMint(
        qcAddress.address,
        user.address,
        normalMintAmount
      )
      const receipt = await tx.wait()
      const event = receipt.events?.find(
        (e: any) => e.event === "MintCompleted"
      )
      const mintId = event?.args?.mintId

      const result = await basicMintingPolicy.isMintCompleted(mintId)
      expect(result).to.be.true
    })

    it("should return false for an uncompleted mint", async () => {
      const uncompletedMintId = ethers.utils.randomBytes(32)
      expect(await basicMintingPolicy.isMintCompleted(uncompletedMintId)).to.be
        .false
    })
  })

  describe("Edge Cases", () => {
    context("when ProtocolRegistry services are not set", () => {
      it("should revert when trying to request mint", async () => {
        // Deploy a new protocol registry without services
        const EmptyRegistryFactory = await ethers.getContractFactory(
          "ProtocolRegistry"
        )
        const emptyRegistry = await EmptyRegistryFactory.deploy()
        await emptyRegistry.deployed()

        const BasicMintingPolicyFactory = await ethers.getContractFactory(
          "BasicMintingPolicy"
        )
        const policyWithEmptyRegistry = await BasicMintingPolicyFactory.deploy(
          emptyRegistry.address
        )
        await policyWithEmptyRegistry.deployed()

        await expect(
          policyWithEmptyRegistry.requestMint(
            qcAddress.address,
            user.address,
            normalMintAmount
          )
        ).to.be.reverted
      })
    })

    context("when service contracts change behavior", () => {
      it("should handle QCManager capacity changes", async () => {
        // First call succeeds
        await basicMintingPolicy.requestMint(
          qcAddress.address,
          user.address,
          normalMintAmount
        )

        // Change capacity to insufficient
        mockQcManager.getAvailableMintingCapacity.returns(
          normalMintAmount.sub(1)
        )

        // Second call should fail
        await expect(
          basicMintingPolicy.requestMint(
            qcAddress.address,
            user.address,
            normalMintAmount
          )
        ).to.be.revertedWith("InsufficientMintingCapacity")
      })

      it("should handle SystemState parameter changes", async () => {
        // First call succeeds
        await basicMintingPolicy.requestMint(
          qcAddress.address,
          user.address,
          normalMintAmount
        )

        // Change min amount to higher than current
        mockSystemState.minMintAmount.returns(normalMintAmount.add(1))

        // Second call should fail
        await expect(
          basicMintingPolicy.requestMint(
            qcAddress.address,
            user.address,
            normalMintAmount
          )
        ).to.be.revertedWith("AmountOutsideAllowedRange")
      })

      it("should handle QCData status changes", async () => {
        // First call succeeds
        await basicMintingPolicy.requestMint(
          qcAddress.address,
          user.address,
          normalMintAmount
        )

        // Change QC status to UnderReview
        mockQcData.getQCStatus.returns(1) // UnderReview

        // Second call should fail
        await expect(
          basicMintingPolicy.requestMint(
            qcAddress.address,
            user.address,
            normalMintAmount
          )
        ).to.be.revertedWith("QCNotActive")
      })
    })

    context("when exact capacity boundary conditions", () => {
      it("should succeed when amount equals available capacity", async () => {
        mockQcManager.getAvailableMintingCapacity.returns(normalMintAmount) // Exact match

        await expect(
          basicMintingPolicy.requestMint(
            qcAddress.address,
            user.address,
            normalMintAmount
          )
        ).to.not.be.reverted
      })

      it("should fail when amount exceeds capacity by 1 wei", async () => {
        mockQcManager.getAvailableMintingCapacity.returns(
          normalMintAmount.sub(1)
        ) // 1 wei less

        await expect(
          basicMintingPolicy.requestMint(
            qcAddress.address,
            user.address,
            normalMintAmount
          )
        ).to.be.revertedWith("InsufficientMintingCapacity")
      })
    })

    context("when amount boundary conditions", () => {
      it("should succeed when amount equals minimum", async () => {
        await expect(
          basicMintingPolicy.requestMint(
            qcAddress.address,
            user.address,
            minMintAmount
          )
        ).to.not.be.reverted
      })

      it("should succeed when amount equals maximum", async () => {
        mockQcManager.getAvailableMintingCapacity.returns(maxMintAmount) // Ensure capacity

        await expect(
          basicMintingPolicy.requestMint(
            qcAddress.address,
            user.address,
            maxMintAmount
          )
        ).to.not.be.reverted
      })
    })
  })
})
