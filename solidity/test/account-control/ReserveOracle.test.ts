import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ReserveOracle } from "../../typechain"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("ReserveOracle", () => {
  let deployer: SignerWithAddress
  let attester1: SignerWithAddress
  let attester2: SignerWithAddress
  let attester3: SignerWithAddress
  let attester4: SignerWithAddress
  let qcAddress: SignerWithAddress
  let qcManager: SignerWithAddress
  let arbiter: SignerWithAddress
  let reserveOracle: ReserveOracle

  const ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE")
  const DISPUTE_ARBITER_ROLE = ethers.utils.id("DISPUTE_ARBITER_ROLE")
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero

  before(async () => {
    const [
      deployerSigner,
      attester1Signer,
      attester2Signer,
      attester3Signer,
      attester4Signer,
      qcAddressSigner,
      qcManagerSigner,
      arbiterSigner,
    ] = await ethers.getSigners()
    deployer = deployerSigner
    attester1 = attester1Signer
    attester2 = attester2Signer
    attester3 = attester3Signer
    attester4 = attester4Signer
    qcAddress = qcAddressSigner
    qcManager = qcManagerSigner
    arbiter = arbiterSigner
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy ReserveOracle
    const ReserveOracleFactory = await ethers.getContractFactory(
      "ReserveOracle"
    )
    reserveOracle = await ReserveOracleFactory.deploy()
    await reserveOracle.deployed()

    // Grant roles
    await reserveOracle
      .connect(deployer)
      .grantRole(ATTESTER_ROLE, attester1.address)
    await reserveOracle
      .connect(deployer)
      .grantRole(ATTESTER_ROLE, attester2.address)
    await reserveOracle
      .connect(deployer)
      .grantRole(ATTESTER_ROLE, attester3.address)
    await reserveOracle
      .connect(deployer)
      .grantRole(ATTESTER_ROLE, attester4.address)
    await reserveOracle
      .connect(deployer)
      .grantRole(DISPUTE_ARBITER_ROLE, arbiter.address)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Initialization", () => {
    it("should set correct initial values", async () => {
      expect(await reserveOracle.consensusThreshold()).to.equal(3)
      expect(await reserveOracle.attestationTimeout()).to.equal(21600) // 6 hours
      expect(await reserveOracle.maxStaleness()).to.equal(86400) // 24 hours
      expect(await reserveOracle.hasRole(DEFAULT_ADMIN_ROLE, deployer.address))
        .to.be.true
    })
  })

  describe("attestBalance", () => {
    it("should allow attester to submit single attestation", async () => {
      const balance = ethers.utils.parseEther("100")

      const tx = await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, balance)
      await expect(tx).to.emit(reserveOracle, "AttestationSubmitted")
      await expect(tx).to.emit(reserveOracle, "AttesterRegistered")

      const [attestedBalance, timestamp] =
        await reserveOracle.getPendingAttestation(
          qcAddress.address,
          attester1.address
        )
      expect(attestedBalance).to.equal(balance)
      expect(timestamp).to.be.gt(0)
    })

    it("should revert if not attester", async () => {
      const balance = ethers.utils.parseEther("100")

      await expect(
        reserveOracle
          .connect(qcAddress)
          .attestBalance(qcAddress.address, balance)
      ).to.be.revertedWith(
        `AccessControl: account ${qcAddress.address.toLowerCase()} is missing role ${ATTESTER_ROLE}`
      )
    })

    it("should allow zero balance attestations", async () => {
      const tx = await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, 0)
      await expect(tx).to.emit(reserveOracle, "AttestationSubmitted")

      const [attestedBalance] = await reserveOracle.getPendingAttestation(
        qcAddress.address,
        attester1.address
      )
      expect(attestedBalance).to.equal(0)
    })

    it("should revert if balance exceeds uint128 max", async () => {
      const maxUint128 = ethers.BigNumber.from(2).pow(128).sub(1)
      const overflowBalance = maxUint128.add(1)

      await expect(
        reserveOracle
          .connect(attester1)
          .attestBalance(qcAddress.address, overflowBalance)
      ).to.be.revertedWith("BalanceOverflow")
    })
  })

  describe("batchAttestBalances", () => {
    it("should allow attester to submit multiple attestations in batch", async () => {
      const qc1 = qcAddress.address
      const qc2 = attester4.address // Use as second QC
      const balance1 = ethers.utils.parseEther("100")
      const balance2 = ethers.utils.parseEther("200")

      const tx = await reserveOracle
        .connect(attester1)
        .batchAttestBalances([qc1, qc2], [balance1, balance2])

      await expect(tx).to.emit(reserveOracle, "BatchAttestationSubmitted")
      await expect(tx).to.emit(reserveOracle, "AttesterRegistered")

      // Check first QC attestation
      const [balance1Result] = await reserveOracle.getPendingAttestation(
        qc1,
        attester1.address
      )
      expect(balance1Result).to.equal(balance1)

      // Check second QC attestation
      const [balance2Result] = await reserveOracle.getPendingAttestation(
        qc2,
        attester1.address
      )
      expect(balance2Result).to.equal(balance2)
    })

    it("should revert with mismatched arrays", async () => {
      const qcs = [qcAddress.address]
      const balances = [
        ethers.utils.parseEther("100"),
        ethers.utils.parseEther("200"),
      ]

      await expect(
        reserveOracle.connect(attester1).batchAttestBalances(qcs, balances)
      ).to.be.revertedWith("MismatchedArrays")
    })

    it("should handle empty arrays as no-op", async () => {
      const tx = await reserveOracle
        .connect(attester1)
        .batchAttestBalances([], [])

      // Should not emit any events
      await expect(tx).to.not.emit(reserveOracle, "BatchAttestationSubmitted")
      await expect(tx).to.not.emit(reserveOracle, "AttestationSubmitted")
    })

    it("should trigger consensus for multiple QCs in single batch", async () => {
      const balance = ethers.utils.parseEther("100")
      const qc1 = qcAddress.address
      const qc2 = attester4.address

      // First two attesters submit for both QCs
      await reserveOracle
        .connect(attester1)
        .batchAttestBalances([qc1, qc2], [balance, balance])
      await reserveOracle
        .connect(attester2)
        .batchAttestBalances([qc1, qc2], [balance, balance])

      // Third attester should trigger consensus for both
      const tx = await reserveOracle
        .connect(attester3)
        .batchAttestBalances([qc1, qc2], [balance, balance])

      // Should emit 2 consensus events
      const receipt = await tx.wait()
      const consensusEvents = receipt.events?.filter(
        (e) => e.event === "ConsensusReached"
      )
      expect(consensusEvents).to.have.length(2)
    })

    it("should revert if any balance overflows uint128", async () => {
      const maxUint128 = ethers.BigNumber.from(2).pow(128).sub(1)
      const validBalance = ethers.utils.parseEther("100")
      const overflowBalance = maxUint128.add(1)

      await expect(
        reserveOracle
          .connect(attester1)
          .batchAttestBalances(
            [qcAddress.address, attester4.address],
            [validBalance, overflowBalance]
          )
      ).to.be.revertedWith("BalanceOverflow")
    })
  })

  describe("Consensus mechanism", () => {
    it("should reach consensus with 3 matching attestations", async () => {
      const balance = ethers.utils.parseEther("100")

      // Submit 3 attestations with same balance
      await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, balance)
      await reserveOracle
        .connect(attester2)
        .attestBalance(qcAddress.address, balance)

      // Third attestation should trigger consensus
      const tx = await reserveOracle
        .connect(attester3)
        .attestBalance(qcAddress.address, balance)
      await expect(tx).to.emit(reserveOracle, "ConsensusReached")

      // Check that reserve was updated
      const [reserveBalance, isStale] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(reserveBalance).to.equal(balance)
      expect(isStale).to.be.false
    })

    it("should calculate median for different values", async () => {
      // Submit 3 different attestations
      await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("90"))
      await reserveOracle
        .connect(attester2)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))

      // Third attestation should trigger consensus with median value
      const tx = await reserveOracle
        .connect(attester3)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("110"))
      await expect(tx).to.emit(reserveOracle, "ConsensusReached")

      // Verify median was calculated correctly (median of 90, 100, 110 is 100)
      const [reserveBalance] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(reserveBalance).to.equal(ethers.utils.parseEther("100"))
    })

    it("should handle even number of attestations", async () => {
      // Update threshold to 4
      await reserveOracle.connect(deployer).setConsensusThreshold(4)

      // Submit 4 attestations
      await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("80"))
      await reserveOracle
        .connect(attester2)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("90"))
      await reserveOracle
        .connect(attester3)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))

      // Fourth attestation triggers consensus
      await expect(
        reserveOracle
          .connect(attester4)
          .attestBalance(qcAddress.address, ethers.utils.parseEther("110"))
      ).to.emit(reserveOracle, "ConsensusReached")

      // Median of [80, 90, 100, 110] = (90 + 100) / 2 = 95
      const [reserveBalance] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(reserveBalance).to.equal(ethers.utils.parseEther("95"))
    })

    it("should not reach consensus with insufficient attestations", async () => {
      const balance = ethers.utils.parseEther("100")

      // Submit only 2 attestations (threshold is 3)
      await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, balance)
      await expect(
        reserveOracle
          .connect(attester2)
          .attestBalance(qcAddress.address, balance)
      ).to.not.emit(reserveOracle, "ConsensusReached")

      // Check that reserve was not updated
      const [reserveBalance] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(reserveBalance).to.equal(0)
    })

    it("should clear pending attestations after consensus", async () => {
      const balance = ethers.utils.parseEther("100")

      // Reach consensus
      await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, balance)
      await reserveOracle
        .connect(attester2)
        .attestBalance(qcAddress.address, balance)
      await reserveOracle
        .connect(attester3)
        .attestBalance(qcAddress.address, balance)

      // Check that pending attestations were cleared
      const attestation1 = await reserveOracle.pendingAttestations(
        qcAddress.address,
        attester1.address
      )
      expect(attestation1.balance).to.equal(0)
      expect(attestation1.timestamp).to.equal(0)
    })
  })

  describe("getReserveBalanceAndStaleness", () => {
    beforeEach(async () => {
      // Set up a reserve balance
      const balance = ethers.utils.parseEther("100")
      await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, balance)
      await reserveOracle
        .connect(attester2)
        .attestBalance(qcAddress.address, balance)
      await reserveOracle
        .connect(attester3)
        .attestBalance(qcAddress.address, balance)
    })

    it("should return correct balance and freshness", async () => {
      const [balance, isStale] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(balance).to.equal(ethers.utils.parseEther("100"))
      expect(isStale).to.be.false
    })

    it("should mark as stale after timeout", async () => {
      // Advance time beyond maxStaleness (24 hours)
      await ethers.provider.send("evm_increaseTime", [86401]) // 24 hours + 1 second
      await ethers.provider.send("evm_mine", [])

      const [balance, isStale] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(balance).to.equal(ethers.utils.parseEther("100"))
      expect(isStale).to.be.true
    })
  })

  // updateReserveBalance function doesn't exist in current contract

  describe("Configuration", () => {
    describe("setConsensusThreshold", () => {
      it("should allow admin to update threshold", async () => {
        await expect(reserveOracle.connect(deployer).setConsensusThreshold(5))
          .to.emit(reserveOracle, "ConsensusThresholdUpdated")
          .withArgs(3, 5)

        expect(await reserveOracle.consensusThreshold()).to.equal(5)
      })

      it("should revert if not admin", async () => {
        await expect(
          reserveOracle.connect(attester1).setConsensusThreshold(5)
        ).to.be.revertedWith(
          `AccessControl: account ${attester1.address.toLowerCase()} is missing role ${DISPUTE_ARBITER_ROLE}`
        )
      })

      it("should revert if threshold is zero", async () => {
        await expect(
          reserveOracle.connect(deployer).setConsensusThreshold(0)
        ).to.be.revertedWith("InvalidThreshold")
      })
    })

    describe("setAttestationTimeout", () => {
      it("should allow arbiter to update timeout", async () => {
        await expect(
          reserveOracle.connect(arbiter).setAttestationTimeout(7200)
        )
          .to.emit(reserveOracle, "AttestationTimeoutUpdated")
          .withArgs(21600, 7200)

        expect(await reserveOracle.attestationTimeout()).to.equal(7200)
      })

      it("should revert if not arbiter", async () => {
        await expect(
          reserveOracle.connect(attester1).setAttestationTimeout(7200)
        ).to.be.revertedWith(
          `AccessControl: account ${attester1.address.toLowerCase()} is missing role ${DISPUTE_ARBITER_ROLE}`
        )
      })

      it("should revert if timeout is zero", async () => {
        await expect(
          reserveOracle.connect(arbiter).setAttestationTimeout(0)
        ).to.be.revertedWith("InvalidTimeout")
      })
    })

    describe("setMaxStaleness", () => {
      it("should allow arbiter to update max staleness", async () => {
        await expect(
          reserveOracle.connect(arbiter).setMaxStaleness(172800) // 48 hours
        )
          .to.emit(reserveOracle, "MaxStalenessUpdated")
          .withArgs(86400, 172800)

        expect(await reserveOracle.maxStaleness()).to.equal(172800)
      })

      it("should revert if staleness is zero", async () => {
        await expect(
          reserveOracle.connect(arbiter).setMaxStaleness(0)
        ).to.be.revertedWith("InvalidStaleness")
      })

      it("should revert if not arbiter", async () => {
        await expect(
          reserveOracle.connect(attester1).setMaxStaleness(172800)
        ).to.be.revertedWith(
          `AccessControl: account ${attester1.address.toLowerCase()} is missing role ${DISPUTE_ARBITER_ROLE}`
        )
      })
    })
  })

  describe("Staleness Tracking", () => {
    // isReserveStale function doesn't exist in current contract
    /* it("should detect stale reserve data", async () => {
      // Initially stale (never updated)
      let [isStale, timeSinceUpdate] = await reserveOracle.isReserveStale(qcAddress.address)
      expect(isStale).to.be.true
      expect(timeSinceUpdate).to.equal(ethers.constants.MaxUint256)
      
      // Submit consensus
      await reserveOracle.connect(attester1).attestBalance(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveOracle.connect(attester2).attestBalance(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveOracle.connect(attester3).attestBalance(qcAddress.address, ethers.utils.parseEther("100"))
      
      // Should be fresh now
      ;[isStale, timeSinceUpdate] = await reserveOracle.isReserveStale(qcAddress.address)
      expect(isStale).to.be.false
      expect(timeSinceUpdate).to.be.lt(10) // Less than 10 seconds
      
      // Advance time beyond maxStaleness (24 hours)
      await ethers.provider.send("evm_increaseTime", [86401])
      await ethers.provider.send("evm_mine", [])
      
      // Should be stale now
      ;[isStale, timeSinceUpdate] = await reserveOracle.isReserveStale(qcAddress.address)
      expect(isStale).to.be.true
      expect(timeSinceUpdate).to.be.gt(86400)
    }) */

    it("should report staleness in getReserveBalanceAndStaleness", async () => {
      // Submit consensus
      await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveOracle
        .connect(attester2)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveOracle
        .connect(attester3)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))

      // Should be fresh
      let [balance, isStale] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(balance).to.equal(ethers.utils.parseEther("100"))
      expect(isStale).to.be.false

      // Advance time beyond maxStaleness
      await ethers.provider.send("evm_increaseTime", [86401])
      await ethers.provider.send("evm_mine", [])

      // Should be stale but balance preserved
      ;[balance, isStale] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )
      expect(balance).to.equal(ethers.utils.parseEther("100"))
      expect(isStale).to.be.true
    })
  })

  describe("Zero Balance Scenarios", () => {
    it("should reach consensus with zero balances", async () => {
      // Submit 3 attestations with zero balance
      await reserveOracle.connect(attester1).attestBalance(qcAddress.address, 0)
      await reserveOracle.connect(attester2).attestBalance(qcAddress.address, 0)

      // Third attestation should trigger consensus
      const tx = await reserveOracle
        .connect(attester3)
        .attestBalance(qcAddress.address, 0)
      await expect(tx).to.emit(reserveOracle, "ConsensusReached")

      // Check that reserve was updated to zero
      const [reserveBalance, isStale] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(reserveBalance).to.equal(0)
      expect(isStale).to.be.false
    })

    it("should handle median calculation with some zero values", async () => {
      // Submit attestations with mix of zero and non-zero values
      await reserveOracle.connect(attester1).attestBalance(qcAddress.address, 0)
      await reserveOracle
        .connect(attester2)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))

      // Third attestation should trigger consensus with median
      const tx = await reserveOracle
        .connect(attester3)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("50"))
      await expect(tx).to.emit(reserveOracle, "ConsensusReached")

      // Verify median was calculated correctly (median of 0, 50, 100 is 50)
      const [reserveBalance] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(reserveBalance).to.equal(ethers.utils.parseEther("50"))
    })

    it("should support QC lifecycle from zero to funded and back", async () => {
      // Start with zero balance (new QC)
      await reserveOracle.connect(attester1).attestBalance(qcAddress.address, 0)
      await reserveOracle.connect(attester2).attestBalance(qcAddress.address, 0)
      await reserveOracle.connect(attester3).attestBalance(qcAddress.address, 0)

      let [balance, isStale] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(balance).to.equal(0)
      expect(isStale).to.be.false

      // QC gets funded
      await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("1000"))
      await reserveOracle
        .connect(attester2)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("1000"))
      await reserveOracle
        .connect(attester3)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("1000"))
      ;[balance, isStale] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )
      expect(balance).to.equal(ethers.utils.parseEther("1000"))
      expect(isStale).to.be.false

      // QC winds down to zero (offboarding)
      await reserveOracle.connect(attester1).attestBalance(qcAddress.address, 0)
      await reserveOracle.connect(attester2).attestBalance(qcAddress.address, 0)
      await reserveOracle.connect(attester3).attestBalance(qcAddress.address, 0)
      ;[balance, isStale] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )
      expect(balance).to.equal(0)
      expect(isStale).to.be.false
    })

    it("should handle temporary zero balance between operations", async () => {
      // Start with funded QC
      await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("500"))
      await reserveOracle
        .connect(attester2)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("500"))
      await reserveOracle
        .connect(attester3)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("500"))

      // Temporary zero balance
      await reserveOracle.connect(attester1).attestBalance(qcAddress.address, 0)
      await reserveOracle.connect(attester2).attestBalance(qcAddress.address, 0)
      await reserveOracle.connect(attester3).attestBalance(qcAddress.address, 0)

      let [balance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )
      expect(balance).to.equal(0)

      // Refunded
      await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("300"))
      await reserveOracle
        .connect(attester2)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("300"))
      await reserveOracle
        .connect(attester3)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("300"))
      ;[balance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )
      expect(balance).to.equal(ethers.utils.parseEther("300"))
    })
  })

  describe("Edge cases", () => {
    it("should handle attester updating their attestation", async () => {
      // First attestation
      await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))

      // Update attestation
      await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("150"))

      // Check that attestation was updated
      const attestation = await reserveOracle.pendingAttestations(
        qcAddress.address,
        attester1.address
      )
      expect(attestation.balance).to.equal(ethers.utils.parseEther("150"))
    })

    it("should ignore expired attestations when calculating consensus", async () => {
      // Submit first attestation
      await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))

      // Advance time beyond attestation timeout (6 hours)
      await ethers.provider.send("evm_increaseTime", [21601])
      await ethers.provider.send("evm_mine", [])

      // Submit two more attestations
      await reserveOracle
        .connect(attester2)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("200"))

      // This should not trigger consensus because first attestation is expired
      await expect(
        reserveOracle
          .connect(attester3)
          .attestBalance(qcAddress.address, ethers.utils.parseEther("200"))
      ).to.not.emit(reserveOracle, "ConsensusReached")

      // Add fourth attestation to reach consensus with only fresh attestations
      const tx = await reserveOracle
        .connect(attester4)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("200"))
      await expect(tx).to.emit(reserveOracle, "ConsensusReached")
    })
  })

  describe("Attester registration", () => {
    it("should automatically register attesters", async () => {
      const tx = await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))

      await expect(tx).to.emit(reserveOracle, "AttesterRegistered")

      // Check attester was registered
      const attesterIndex = await reserveOracle.attesterToIndex(
        attester1.address
      )
      expect(attesterIndex).to.equal(1) // First attester gets index 1

      const indexToAttester = await reserveOracle.indexToAttester(1)
      expect(indexToAttester).to.equal(attester1.address)
    })

    it("should prevent duplicate attestations from same attester", async () => {
      // First attestation registers the attester
      await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))

      // Second attestation from same attester should be rejected
      await expect(
        reserveOracle
          .connect(attester1)
          .attestBalance(qcAddress.address, ethers.utils.parseEther("200"))
      ).to.be.revertedWith("AttesterAlreadySubmitted")

      // Index should remain the same
      const attesterIndex = await reserveOracle.attesterToIndex(
        attester1.address
      )
      expect(attesterIndex).to.equal(1)
    })

    it("should assign sequential indices to multiple attesters", async () => {
      await reserveOracle
        .connect(attester1)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveOracle
        .connect(attester2)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveOracle
        .connect(attester3)
        .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))

      expect(await reserveOracle.attesterToIndex(attester1.address)).to.equal(1)
      expect(await reserveOracle.attesterToIndex(attester2.address)).to.equal(2)
      expect(await reserveOracle.attesterToIndex(attester3.address)).to.equal(3)
      expect(await reserveOracle.nextAttesterIndex()).to.equal(4)
    })
  })

  describe("Emergency Functions", () => {
    describe("emergencySetReserve", () => {
      it("should allow arbiter to emergency set reserve balance", async () => {
        const newBalance = ethers.utils.parseEther("500")
        const oldBalance = await reserveOracle.getReserveBalance(
          qcAddress.address
        )

        const tx = await reserveOracle
          .connect(arbiter)
          .emergencySetReserve(qcAddress.address, newBalance)

        await expect(tx)
          .to.emit(reserveOracle, "ReserveBalanceUpdated")
          .withArgs(qcAddress.address, oldBalance, newBalance)

        // Verify balance was updated
        const [balance, isStale] =
          await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
        expect(balance).to.equal(newBalance)
        expect(isStale).to.be.false
      })

      it("should revert if not dispute arbiter", async () => {
        const newBalance = ethers.utils.parseEther("500")

        await expect(
          reserveOracle
            .connect(attester1)
            .emergencySetReserve(qcAddress.address, newBalance)
        ).to.be.revertedWith(
          `AccessControl: account ${attester1.address.toLowerCase()} is missing role ${DISPUTE_ARBITER_ROLE}`
        )
      })

      it("should clear pending attestations when setting emergency reserve", async () => {
        // Create some pending attestations
        await reserveOracle
          .connect(attester1)
          .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))
        await reserveOracle
          .connect(attester2)
          .attestBalance(qcAddress.address, ethers.utils.parseEther("150"))

        // Verify attestations are pending
        expect(
          await reserveOracle.getPendingAttestationCount(qcAddress.address)
        ).to.equal(2)

        // Emergency set reserve
        await reserveOracle
          .connect(arbiter)
          .emergencySetReserve(
            qcAddress.address,
            ethers.utils.parseEther("300")
          )

        // Verify pending attestations were cleared
        expect(
          await reserveOracle.getPendingAttestationCount(qcAddress.address)
        ).to.equal(0)

        const [attestedBalance1] = await reserveOracle.getPendingAttestation(
          qcAddress.address,
          attester1.address
        )
        expect(attestedBalance1).to.equal(0)
      })

      it("should update timestamp when setting emergency reserve", async () => {
        const newBalance = ethers.utils.parseEther("1000")

        const blockBefore = await ethers.provider.getBlock("latest")
        await reserveOracle
          .connect(arbiter)
          .emergencySetReserve(qcAddress.address, newBalance)
        const blockAfter = await ethers.provider.getBlock("latest")

        const reserveData = await reserveOracle.reserves(qcAddress.address)
        expect(reserveData.lastUpdateTimestamp).to.be.gte(blockBefore.timestamp)
        expect(reserveData.lastUpdateTimestamp).to.be.lte(blockAfter.timestamp)
      })

      it("should work with zero balance", async () => {
        // First set a non-zero balance
        await reserveOracle
          .connect(arbiter)
          .emergencySetReserve(
            qcAddress.address,
            ethers.utils.parseEther("100")
          )

        // Then set to zero
        const tx = await reserveOracle
          .connect(arbiter)
          .emergencySetReserve(qcAddress.address, 0)

        await expect(tx)
          .to.emit(reserveOracle, "ReserveBalanceUpdated")
          .withArgs(qcAddress.address, ethers.utils.parseEther("100"), 0)

        const [balance] = await reserveOracle.getReserveBalanceAndStaleness(
          qcAddress.address
        )
        expect(balance).to.equal(0)
      })
    })

    describe("resetConsensus", () => {
      it("should allow arbiter to reset consensus", async () => {
        // Create some pending attestations
        await reserveOracle
          .connect(attester1)
          .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))
        await reserveOracle
          .connect(attester2)
          .attestBalance(qcAddress.address, ethers.utils.parseEther("150"))

        // Verify attestations are pending
        expect(
          await reserveOracle.getPendingAttestationCount(qcAddress.address)
        ).to.equal(2)

        // Reset consensus
        await reserveOracle.connect(arbiter).resetConsensus(qcAddress.address)

        // Verify pending attestations were cleared
        expect(
          await reserveOracle.getPendingAttestationCount(qcAddress.address)
        ).to.equal(0)

        const [attestedBalance1] = await reserveOracle.getPendingAttestation(
          qcAddress.address,
          attester1.address
        )
        expect(attestedBalance1).to.equal(0)
      })

      it("should revert if not dispute arbiter", async () => {
        await expect(
          reserveOracle.connect(attester1).resetConsensus(qcAddress.address)
        ).to.be.revertedWith(
          `AccessControl: account ${attester1.address.toLowerCase()} is missing role ${DISPUTE_ARBITER_ROLE}`
        )
      })

      it("should work with no pending attestations", async () => {
        // Reset consensus with no pending attestations should not revert
        await expect(
          reserveOracle.connect(arbiter).resetConsensus(qcAddress.address)
        ).to.not.be.reverted

        expect(
          await reserveOracle.getPendingAttestationCount(qcAddress.address)
        ).to.equal(0)
      })

      it("should not affect existing reserve balance", async () => {
        // Set a reserve balance first
        await reserveOracle
          .connect(arbiter)
          .emergencySetReserve(
            qcAddress.address,
            ethers.utils.parseEther("500")
          )

        // Add pending attestations
        await reserveOracle
          .connect(attester1)
          .attestBalance(qcAddress.address, ethers.utils.parseEther("600"))

        // Reset consensus
        await reserveOracle.connect(arbiter).resetConsensus(qcAddress.address)

        // Balance should remain unchanged
        const [balance] = await reserveOracle.getReserveBalanceAndStaleness(
          qcAddress.address
        )
        expect(balance).to.equal(ethers.utils.parseEther("500"))
      })
    })

    describe("Emergency function edge cases", () => {
      it("should handle emergency set after partial consensus", async () => {
        // Submit 2 attestations (threshold is 3)
        await reserveOracle
          .connect(attester1)
          .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))
        await reserveOracle
          .connect(attester2)
          .attestBalance(qcAddress.address, ethers.utils.parseEther("100"))

        expect(
          await reserveOracle.getPendingAttestationCount(qcAddress.address)
        ).to.equal(2)

        // Emergency set should clear pending attestations and set balance
        await reserveOracle
          .connect(arbiter)
          .emergencySetReserve(
            qcAddress.address,
            ethers.utils.parseEther("200")
          )

        expect(
          await reserveOracle.getPendingAttestationCount(qcAddress.address)
        ).to.equal(0)
        const [balance] = await reserveOracle.getReserveBalanceAndStaleness(
          qcAddress.address
        )
        expect(balance).to.equal(ethers.utils.parseEther("200"))
      })

      it("should handle reset after emergency set", async () => {
        // Emergency set a balance
        await reserveOracle
          .connect(arbiter)
          .emergencySetReserve(
            qcAddress.address,
            ethers.utils.parseEther("300")
          )

        // Add new attestations
        await reserveOracle
          .connect(attester1)
          .attestBalance(qcAddress.address, ethers.utils.parseEther("400"))
        await reserveOracle
          .connect(attester2)
          .attestBalance(qcAddress.address, ethers.utils.parseEther("400"))

        // Reset should clear attestations but preserve emergency balance
        await reserveOracle.connect(arbiter).resetConsensus(qcAddress.address)

        expect(
          await reserveOracle.getPendingAttestationCount(qcAddress.address)
        ).to.equal(0)
        const [balance] = await reserveOracle.getReserveBalanceAndStaleness(
          qcAddress.address
        )
        expect(balance).to.equal(ethers.utils.parseEther("300"))
      })

      it("should handle multiple QC emergency operations", async () => {
        const qc2 = attester4.address

        // Set emergency balances for both QCs
        await reserveOracle
          .connect(arbiter)
          .emergencySetReserve(
            qcAddress.address,
            ethers.utils.parseEther("100")
          )
        await reserveOracle
          .connect(arbiter)
          .emergencySetReserve(qc2, ethers.utils.parseEther("200"))

        // Verify both balances
        expect(
          await reserveOracle.getReserveBalance(qcAddress.address)
        ).to.equal(ethers.utils.parseEther("100"))
        expect(await reserveOracle.getReserveBalance(qc2)).to.equal(
          ethers.utils.parseEther("200")
        )

        // Add attestations for both
        await reserveOracle
          .connect(attester1)
          .batchAttestBalances(
            [qcAddress.address, qc2],
            [ethers.utils.parseEther("300"), ethers.utils.parseEther("400")]
          )

        // Reset one QC
        await reserveOracle.connect(arbiter).resetConsensus(qcAddress.address)

        // Only first QC should have attestations cleared
        expect(
          await reserveOracle.getPendingAttestationCount(qcAddress.address)
        ).to.equal(0)
        expect(await reserveOracle.getPendingAttestationCount(qc2)).to.equal(1)
      })
    })
  })
})
