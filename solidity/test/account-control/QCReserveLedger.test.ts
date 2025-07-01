import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { QCReserveLedger, ProtocolRegistry, SystemState } from "../../typechain"

const { createSnapshot, restoreSnapshot } = helpers.snapshot
const { time } = helpers

describe("QCReserveLedger", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let attester: SignerWithAddress
  let qcAddress: SignerWithAddress
  let thirdParty: SignerWithAddress

  let qcReserveLedger: QCReserveLedger
  let protocolRegistry: ProtocolRegistry
  let systemState: SystemState

  // Roles
  let ATTESTER_ROLE: string

  // Test data
  const reserveBalance = ethers.utils.parseEther("10")
  const newReserveBalance = ethers.utils.parseEther("15")

  before(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;[deployer, governance, attester, qcAddress, thirdParty] =
      await ethers.getSigners()

    // Generate role hashes
    ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE")
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy ProtocolRegistry
    const ProtocolRegistryFactory = await ethers.getContractFactory(
      "ProtocolRegistry"
    )
    protocolRegistry = await ProtocolRegistryFactory.deploy()
    await protocolRegistry.deployed()

    // Deploy SystemState
    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy()
    await systemState.deployed()

    // Register SystemState in ProtocolRegistry
    const SYSTEM_STATE_KEY = ethers.utils.id("SYSTEM_STATE")
    await protocolRegistry.setService(SYSTEM_STATE_KEY, systemState.address)

    // Deploy QCReserveLedger
    const QCReserveLedgerFactory = await ethers.getContractFactory(
      "QCReserveLedger"
    )
    qcReserveLedger = await QCReserveLedgerFactory.deploy(
      protocolRegistry.address
    )
    await qcReserveLedger.deployed()

    // Grant roles
    await qcReserveLedger.grantRole(ATTESTER_ROLE, attester.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment", () => {
    it("should grant deployer all roles", async () => {
      const DEFAULT_ADMIN_ROLE = await qcReserveLedger.DEFAULT_ADMIN_ROLE()
      expect(
        await qcReserveLedger.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)
      ).to.be.true
      expect(await qcReserveLedger.hasRole(ATTESTER_ROLE, deployer.address)).to
        .be.true
    })

    it("should have correct role constants", async () => {
      expect(await qcReserveLedger.ATTESTER_ROLE()).to.equal(ATTESTER_ROLE)
    })
  })

  describe("Reserve Attestation", () => {
    context("when called by attester", () => {
      it("should submit attestation successfully", async () => {
        const tx = await qcReserveLedger
          .connect(attester)
          .submitReserveAttestation(qcAddress.address, reserveBalance)
        const block = await ethers.provider.getBlock(tx.blockNumber as number)
        const blockTimestamp = block.timestamp

        const attestation = await qcReserveLedger.getCurrentAttestation(
          qcAddress.address
        )
        expect(attestation.balance).to.equal(reserveBalance)
        expect(attestation.timestamp).to.equal(blockTimestamp)

        await expect(tx)
          .to.emit(qcReserveLedger, "ReserveAttestationSubmitted")
          .withArgs(
            attester.address,
            qcAddress.address,
            reserveBalance,
            blockTimestamp,
            tx.blockNumber
          )
      })

      it("should update existing attestation", async () => {
        await qcReserveLedger
          .connect(attester)
          .submitReserveAttestation(qcAddress.address, reserveBalance)

        // Move time forward
        await time.increaseTime(3600)

        const tx = await qcReserveLedger
          .connect(attester)
          .submitReserveAttestation(qcAddress.address, newReserveBalance)
        const block = await ethers.provider.getBlock(tx.blockNumber as number)
        const blockTimestamp = block.timestamp

        const attestation = await qcReserveLedger.getCurrentAttestation(
          qcAddress.address
        )
        expect(attestation.balance).to.equal(newReserveBalance)
        expect(attestation.timestamp).to.equal(blockTimestamp)

        await expect(tx)
          .to.emit(qcReserveLedger, "ReserveAttestationSubmitted")
          .withArgs(
            attester.address,
            qcAddress.address,
            newReserveBalance,
            blockTimestamp,
            tx.blockNumber
          )
      })

      it("should handle zero balance attestation", async () => {
        const tx = await qcReserveLedger
          .connect(attester)
          .submitReserveAttestation(qcAddress.address, 0)

        const attestation = await qcReserveLedger.getCurrentAttestation(
          qcAddress.address
        )
        expect(attestation.balance).to.equal(0)
        expect(attestation.timestamp).to.be.gt(0)

        await expect(tx).to.emit(qcReserveLedger, "ReserveAttestationSubmitted")
      })

      it("should handle maximum balance attestation", async () => {
        const maxBalance = ethers.constants.MaxUint256
        await qcReserveLedger
          .connect(attester)
          .submitReserveAttestation(qcAddress.address, maxBalance)

        const attestation = await qcReserveLedger.getCurrentAttestation(
          qcAddress.address
        )
        expect(attestation.balance).to.equal(maxBalance)
      })

      it("should revert with zero QC address", async () => {
        await expect(
          qcReserveLedger
            .connect(attester)
            .submitReserveAttestation(
              ethers.constants.AddressZero,
              reserveBalance
            )
        ).to.be.revertedWith("Invalid QC address")
      })
    })

    context("when called by non-attester", () => {
      it("should revert", async () => {
        await expect(
          qcReserveLedger
            .connect(thirdParty)
            .submitReserveAttestation(qcAddress.address, reserveBalance)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${ATTESTER_ROLE}`
        )
      })
    })
  })

  describe("Reserve Information Retrieval", () => {
    beforeEach(async () => {
      await qcReserveLedger
        .connect(attester)
        .submitReserveAttestation(qcAddress.address, reserveBalance)
    })

    describe("getCurrentAttestation", () => {
      it("should return correct attestation data", async () => {
        const tx = await qcReserveLedger
          .connect(attester)
          .submitReserveAttestation(qcAddress.address, reserveBalance)
        const block = await ethers.provider.getBlock(tx.blockNumber as number)
        const blockTimestamp = block.timestamp

        const attestation = await qcReserveLedger.getCurrentAttestation(
          qcAddress.address
        )

        expect(attestation.balance).to.equal(reserveBalance)
        expect(attestation.timestamp).to.equal(blockTimestamp)
        expect(attestation.attester).to.equal(attester.address)
        expect(attestation.isValid).to.be.true
      })

      it("should return empty attestation for non-existent QC", async () => {
        const attestation = await qcReserveLedger.getCurrentAttestation(
          thirdParty.address
        )

        expect(attestation.balance).to.equal(0)
        expect(attestation.timestamp).to.equal(0)
        expect(attestation.attester).to.equal(ethers.constants.AddressZero)
        expect(attestation.isValid).to.be.false
      })
    })

    describe("getReserveBalanceAndStaleness", () => {
      context("when attestation is fresh", () => {
        it("should return balance and false staleness", async () => {
          const [balance, isStale] =
            await qcReserveLedger.getReserveBalanceAndStaleness(
              qcAddress.address
            )
          expect(balance).to.equal(reserveBalance)
          expect(isStale).to.be.false
        })
      })

      context("when attestation is stale", () => {
        it("should return balance and true staleness", async () => {
          const staleThreshold = await systemState.staleThreshold()
          await time.increaseTime(staleThreshold.toNumber() + 1)

          const [balance, isStale] =
            await qcReserveLedger.getReserveBalanceAndStaleness(
              qcAddress.address
            )
          expect(balance).to.equal(reserveBalance)
          expect(isStale).to.be.true
        })
      })

      context("when attestation is invalid", () => {
        it("should return zero balance and true staleness", async () => {
          await qcReserveLedger.invalidateAttestation(
            qcAddress.address,
            ethers.utils.id("test")
          )

          const [balance, isStale] =
            await qcReserveLedger.getReserveBalanceAndStaleness(
              qcAddress.address
            )
          expect(balance).to.equal(0)
          expect(isStale).to.be.true
        })
      })

      context("when QC does not exist", () => {
        it("should return zero balance and true staleness", async () => {
          const [balance, isStale] =
            await qcReserveLedger.getReserveBalanceAndStaleness(
              thirdParty.address
            )
          expect(balance).to.equal(0)
          expect(isStale).to.be.true
        })
      })
    })

    describe("isAttestationStale", () => {
      it("should return false if attestation is fresh", async () => {
        expect(await qcReserveLedger.isAttestationStale(qcAddress.address)).to
          .be.false
      })

      it("should return true if attestation is stale", async () => {
        const staleThreshold = await systemState.staleThreshold()
        await time.increaseTime(staleThreshold.toNumber() + 1)
        expect(await qcReserveLedger.isAttestationStale(qcAddress.address)).to
          .be.true
      })

      it("should return true for non-existent QC", async () => {
        expect(await qcReserveLedger.isAttestationStale(thirdParty.address)).to
          .be.true
      })
    })

    describe("getTimeUntilStale", () => {
      it("should return correct time remaining", async () => {
        const staleThreshold = await systemState.staleThreshold()
        const timeUntilStale = await qcReserveLedger.getTimeUntilStale(
          qcAddress.address
        )
        expect(timeUntilStale).to.be.closeTo(staleThreshold, 1)
      })

      it("should return 0 if attestation is stale", async () => {
        const staleThreshold = await systemState.staleThreshold()
        await time.increaseTime(staleThreshold.toNumber() + 1)
        const timeUntilStale = await qcReserveLedger.getTimeUntilStale(
          qcAddress.address
        )
        expect(timeUntilStale).to.equal(0)
      })

      it("should return 0 for non-existent QC", async () => {
        const timeUntilStale = await qcReserveLedger.getTimeUntilStale(
          thirdParty.address
        )
        expect(timeUntilStale).to.equal(0)
      })
    })
  })

  describe("Attestation Invalidation", () => {
    beforeEach(async () => {
      await qcReserveLedger
        .connect(attester)
        .submitReserveAttestation(qcAddress.address, reserveBalance)
    })

    context("when called by admin", () => {
      it("should invalidate an attestation", async () => {
        const reason = ethers.utils.formatBytes32String("fraud")
        const tx = await qcReserveLedger.invalidateAttestation(
          qcAddress.address,
          reason
        )
        const block = await ethers.provider.getBlock(tx.blockNumber as number)
        const blockTimestamp = block.timestamp

        const attestation = await qcReserveLedger.getCurrentAttestation(
          qcAddress.address
        )
        expect(attestation.isValid).to.be.false

        await expect(tx)
          .to.emit(qcReserveLedger, "AttestationInvalidated")
          .withArgs(qcAddress.address, blockTimestamp, reason)
      })

      it("should revert for non-existent attestation", async () => {
        await expect(
          qcReserveLedger.invalidateAttestation(
            thirdParty.address,
            ethers.utils.formatBytes32String("test")
          )
        ).to.be.revertedWith("No attestation exists")
      })

      it("should revert with empty reason", async () => {
        await expect(
          qcReserveLedger.invalidateAttestation(
            qcAddress.address,
            ethers.constants.HashZero
          )
        ).to.be.revertedWith("Reason required")
      })
    })

    context("when called by non-admin", () => {
      it("should revert", async () => {
        const DEFAULT_ADMIN_ROLE = await qcReserveLedger.DEFAULT_ADMIN_ROLE()
        await expect(
          qcReserveLedger
            .connect(thirdParty)
            .invalidateAttestation(
              qcAddress.address,
              ethers.utils.formatBytes32String("test")
            )
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
        )
      })
    })
  })

  describe("Attestation History", () => {
    it("should return full attestation history", async () => {
      await qcReserveLedger
        .connect(attester)
        .submitReserveAttestation(qcAddress.address, reserveBalance)
      await qcReserveLedger
        .connect(attester)
        .submitReserveAttestation(qcAddress.address, newReserveBalance)

      const history = await qcReserveLedger.getAttestationHistory(
        qcAddress.address
      )
      expect(history.length).to.equal(2)
      expect(history[0].balance).to.equal(reserveBalance)
      expect(history[1].balance).to.equal(newReserveBalance)
    })

    it("should return paginated history", async () => {
      const attestationPromises = []
      for (let i = 0; i < 5; i++) {
        attestationPromises.push(
          qcReserveLedger
            .connect(attester)
            .submitReserveAttestation(qcAddress.address, reserveBalance.add(i))
        )
      }
      await Promise.all(attestationPromises)

      const history = await qcReserveLedger.getAttestationHistoryPaginated(
        qcAddress.address,
        1,
        2
      )
      expect(history.length).to.equal(2)
      expect(history[0].balance).to.equal(reserveBalance.add(1))
      expect(history[1].balance).to.equal(reserveBalance.add(2))
    })

    it("should return correct history count", async () => {
      await qcReserveLedger
        .connect(attester)
        .submitReserveAttestation(qcAddress.address, reserveBalance)
      expect(
        await qcReserveLedger.getAttestationHistoryCount(qcAddress.address)
      ).to.equal(1)
    })
  })

  describe("Access Control", () => {
    it("should allow admin to grant roles", async () => {
      await qcReserveLedger.grantRole(ATTESTER_ROLE, thirdParty.address)
      expect(await qcReserveLedger.hasRole(ATTESTER_ROLE, thirdParty.address))
        .to.be.true
    })

    it("should allow admin to revoke roles", async () => {
      await qcReserveLedger.grantRole(ATTESTER_ROLE, thirdParty.address)
      await qcReserveLedger.revokeRole(ATTESTER_ROLE, thirdParty.address)
      expect(await qcReserveLedger.hasRole(ATTESTER_ROLE, thirdParty.address))
        .to.be.false
    })

    it("should not allow non-admin to grant roles", async () => {
      const DEFAULT_ADMIN_ROLE = await qcReserveLedger.DEFAULT_ADMIN_ROLE()
      await expect(
        qcReserveLedger
          .connect(thirdParty)
          .grantRole(ATTESTER_ROLE, attester.address)
      ).to.be.revertedWith(
        `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
      )
    })
  })

  describe("Integration with SystemState", () => {
    it("should use updated stale threshold from SystemState", async () => {
      const PARAMETER_ADMIN_ROLE = await systemState.PARAMETER_ADMIN_ROLE()
      await systemState.grantRole(PARAMETER_ADMIN_ROLE, governance.address)
      const newStaleThreshold = 7200
      await systemState.connect(governance).setStaleThreshold(newStaleThreshold)

      await qcReserveLedger
        .connect(attester)
        .submitReserveAttestation(qcAddress.address, reserveBalance)

      await time.increaseTime(newStaleThreshold - 10)
      expect(await qcReserveLedger.isAttestationStale(qcAddress.address)).to.be
        .false

      await time.increaseTime(20)
      expect(await qcReserveLedger.isAttestationStale(qcAddress.address)).to.be
        .true
    })
  })

  describe("Edge cases", () => {
    it("should handle attestation for multiple QCs", async () => {
      const anotherQc = thirdParty
      await qcReserveLedger
        .connect(attester)
        .submitReserveAttestation(qcAddress.address, reserveBalance)
      await qcReserveLedger
        .connect(attester)
        .submitReserveAttestation(anotherQc.address, newReserveBalance)

      const [balance1, stale1] =
        await qcReserveLedger.getReserveBalanceAndStaleness(qcAddress.address)
      const [balance2, stale2] =
        await qcReserveLedger.getReserveBalanceAndStaleness(anotherQc.address)

      expect(balance1).to.equal(reserveBalance)
      expect(stale1).to.be.false
      expect(balance2).to.equal(newReserveBalance)
      expect(stale2).to.be.false
    })
  })
})
