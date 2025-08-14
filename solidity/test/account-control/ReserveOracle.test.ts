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
  let reserveOracle: ReserveOracle

  const ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE")
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
    ] = await ethers.getSigners()
    deployer = deployerSigner
    attester1 = attester1Signer
    attester2 = attester2Signer
    attester3 = attester3Signer
    attester4 = attester4Signer
    qcAddress = qcAddressSigner
    qcManager = qcManagerSigner
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

  describe("submitAttestation", () => {
    it("should allow attester to submit attestation", async () => {
      const balance = ethers.utils.parseEther("100")

      const tx = await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, balance)
      await expect(tx).to.emit(reserveOracle, "AttestationSubmitted")

      const attestation = await reserveOracle.pendingAttestations(
        qcAddress.address,
        attester1.address
      )
      expect(attestation.balance).to.equal(balance)
      expect(attestation.attester).to.equal(attester1.address)
    })

    it("should revert if not attester", async () => {
      const balance = ethers.utils.parseEther("100")

      await expect(
        reserveOracle
          .connect(qcAddress)
          .submitAttestation(qcAddress.address, balance)
      ).to.be.revertedWith(
        `AccessControl: account ${qcAddress.address.toLowerCase()} is missing role ${ATTESTER_ROLE}`
      )
    })

    it("should allow zero balance attestations", async () => {
      const tx = await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, 0)
      await expect(tx).to.emit(reserveOracle, "AttestationSubmitted")

      const attestation = await reserveOracle.pendingAttestations(
        qcAddress.address,
        attester1.address
      )
      expect(attestation.balance).to.equal(0)
      expect(attestation.attester).to.equal(attester1.address)
    })
  })

  describe("Consensus mechanism", () => {
    it("should reach consensus with 3 matching attestations", async () => {
      const balance = ethers.utils.parseEther("100")

      // Submit 3 attestations with same balance
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, balance)
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, balance)

      // Third attestation should trigger consensus
      const tx = await reserveOracle
        .connect(attester3)
        .submitAttestation(qcAddress.address, balance)
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
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("90"))
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))

      // Third attestation should trigger consensus with median value
      const tx = await reserveOracle
        .connect(attester3)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("110"))
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
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("80"))
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("90"))
      await reserveOracle
        .connect(attester3)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))

      // Fourth attestation triggers consensus
      await expect(
        reserveOracle
          .connect(attester4)
          .submitAttestation(qcAddress.address, ethers.utils.parseEther("110"))
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
        .submitAttestation(qcAddress.address, balance)
      await expect(
        reserveOracle
          .connect(attester2)
          .submitAttestation(qcAddress.address, balance)
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
        .submitAttestation(qcAddress.address, balance)
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, balance)
      await reserveOracle
        .connect(attester3)
        .submitAttestation(qcAddress.address, balance)

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
        .submitAttestation(qcAddress.address, balance)
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, balance)
      await reserveOracle
        .connect(attester3)
        .submitAttestation(qcAddress.address, balance)
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
          `AccessControl: account ${attester1.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
        )
      })

      it("should revert if threshold is zero", async () => {
        await expect(
          reserveOracle.connect(deployer).setConsensusThreshold(0)
        ).to.be.revertedWith("InvalidThreshold")
      })
    })

    describe("setAttestationTimeout", () => {
      it("should allow admin to update timeout", async () => {
        await expect(
          reserveOracle.connect(deployer).setAttestationTimeout(7200)
        )
          .to.emit(reserveOracle, "AttestationTimeoutUpdated")
          .withArgs(21600, 7200)

        expect(await reserveOracle.attestationTimeout()).to.equal(7200)
      })

      it("should revert if not admin", async () => {
        await expect(
          reserveOracle.connect(attester1).setAttestationTimeout(7200)
        ).to.be.revertedWith(
          `AccessControl: account ${attester1.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
        )
      })

      it("should revert if timeout is zero", async () => {
        await expect(
          reserveOracle.connect(deployer).setAttestationTimeout(0)
        ).to.be.revertedWith("InvalidTimeout")
      })
    })

    describe("setMaxStaleness", () => {
      it("should allow admin to update max staleness", async () => {
        await expect(
          reserveOracle.connect(deployer).setMaxStaleness(172800) // 48 hours
        )
          .to.emit(reserveOracle, "MaxStalenessUpdated")
          .withArgs(86400, 172800)

        expect(await reserveOracle.maxStaleness()).to.equal(172800)
      })

      it("should revert if staleness is zero", async () => {
        await expect(
          reserveOracle.connect(deployer).setMaxStaleness(0)
        ).to.be.revertedWith("InvalidTimeout")
      })

      it("should revert if not admin", async () => {
        await expect(
          reserveOracle.connect(attester1).setMaxStaleness(172800)
        ).to.be.revertedWith(
          `AccessControl: account ${attester1.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
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
      await reserveOracle.connect(attester1).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveOracle.connect(attester2).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveOracle.connect(attester3).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      
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
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveOracle
        .connect(attester3)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))

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
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, 0)
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, 0)

      // Third attestation should trigger consensus
      const tx = await reserveOracle
        .connect(attester3)
        .submitAttestation(qcAddress.address, 0)
      await expect(tx).to.emit(reserveOracle, "ConsensusReached")

      // Check that reserve was updated to zero
      const [reserveBalance, isStale] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(reserveBalance).to.equal(0)
      expect(isStale).to.be.false
    })

    it("should handle median calculation with some zero values", async () => {
      // Submit attestations with mix of zero and non-zero values
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, 0)
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))

      // Third attestation should trigger consensus with median
      const tx = await reserveOracle
        .connect(attester3)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("50"))
      await expect(tx).to.emit(reserveOracle, "ConsensusReached")

      // Verify median was calculated correctly (median of 0, 50, 100 is 50)
      const [reserveBalance] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(reserveBalance).to.equal(ethers.utils.parseEther("50"))
    })

    it("should support QC lifecycle from zero to funded and back", async () => {
      // Start with zero balance (new QC)
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, 0)
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, 0)
      await reserveOracle
        .connect(attester3)
        .submitAttestation(qcAddress.address, 0)

      let [balance, isStale] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(balance).to.equal(0)
      expect(isStale).to.be.false

      // QC gets funded
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("1000"))
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("1000"))
      await reserveOracle
        .connect(attester3)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("1000"))
      ;[balance, isStale] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )
      expect(balance).to.equal(ethers.utils.parseEther("1000"))
      expect(isStale).to.be.false

      // QC winds down to zero (offboarding)
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, 0)
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, 0)
      await reserveOracle
        .connect(attester3)
        .submitAttestation(qcAddress.address, 0)
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
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("500"))
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("500"))
      await reserveOracle
        .connect(attester3)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("500"))

      // Temporary zero balance
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, 0)
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, 0)
      await reserveOracle
        .connect(attester3)
        .submitAttestation(qcAddress.address, 0)

      let [balance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )
      expect(balance).to.equal(0)

      // Refunded
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("300"))
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("300"))
      await reserveOracle
        .connect(attester3)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("300"))
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
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))

      // Update attestation
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("150"))

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
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))

      // Advance time beyond attestation timeout (6 hours)
      await ethers.provider.send("evm_increaseTime", [21601])
      await ethers.provider.send("evm_mine", [])

      // Submit two more attestations
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("200"))

      // This should not trigger consensus because first attestation is expired
      await expect(
        reserveOracle
          .connect(attester3)
          .submitAttestation(qcAddress.address, ethers.utils.parseEther("200"))
      ).to.not.emit(reserveOracle, "ConsensusReached")

      // Add fourth attestation to reach consensus with only fresh attestations
      const tx = await reserveOracle
        .connect(attester4)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("200"))
      await expect(tx).to.emit(reserveOracle, "ConsensusReached")
    })
  })

  describe("forceConsensus", () => {
    let arbiter: SignerWithAddress
    const ARBITER_ROLE = ethers.utils.id("ARBITER_ROLE")

    beforeEach(async () => {
      arbiter = deployer // deployer has ARBITER_ROLE by default
    })

    it("should allow arbiter to force consensus with one attestation", async () => {
      const balance = ethers.utils.parseEther("100")

      // Submit only one attestation (below threshold)
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, balance)

      // Force consensus
      const tx = await reserveOracle
        .connect(arbiter)
        .forceConsensus(qcAddress.address)
      await expect(tx)
        .to.emit(reserveOracle, "ForcedConsensusReached")
        .withArgs(
          qcAddress.address,
          balance,
          1,
          arbiter.address,
          [attester1.address],
          [balance]
        )
      await expect(tx).to.emit(reserveOracle, "ReserveUpdated")

      // Verify reserve was updated
      const [reserveBalance, isStale] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(reserveBalance).to.equal(balance)
      expect(isStale).to.be.false
    })

    it("should allow arbiter to force consensus with two attestations", async () => {
      // Submit two different attestations (below threshold)
      const balance1 = ethers.utils.parseEther("90")
      const balance2 = ethers.utils.parseEther("110")
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, balance1)
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, balance2)

      // Force consensus
      const tx = await reserveOracle
        .connect(arbiter)
        .forceConsensus(qcAddress.address)
      await expect(tx)
        .to.emit(reserveOracle, "ForcedConsensusReached")
        .withArgs(
          qcAddress.address,
          ethers.utils.parseEther("100"), // median of 90 and 110
          2,
          arbiter.address,
          [attester1.address, attester2.address],
          [balance1, balance2]
        )

      // Verify median was calculated (median of 90, 110 is 100)
      const [reserveBalance] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(reserveBalance).to.equal(ethers.utils.parseEther("100"))
    })

    it("should revert if no valid attestations", async () => {
      // No attestations submitted
      await expect(
        reserveOracle.connect(arbiter).forceConsensus(qcAddress.address)
      ).to.be.revertedWith("No valid attestations to force consensus")
    })

    it("should revert if not arbiter", async () => {
      // Submit attestation
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))

      // Try to force consensus without ARBITER_ROLE
      await expect(
        reserveOracle.connect(attester1).forceConsensus(qcAddress.address)
      ).to.be.revertedWith(
        `AccessControl: account ${attester1.address.toLowerCase()} is missing role ${ARBITER_ROLE}`
      )
    })

    it("should only use valid (non-expired) attestations", async () => {
      // Submit first attestation
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("50"))

      // Advance time beyond attestation timeout
      await ethers.provider.send("evm_increaseTime", [21601]) // 6 hours + 1 second
      await ethers.provider.send("evm_mine", [])

      // Submit fresh attestation
      const freshBalance = ethers.utils.parseEther("100")
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, freshBalance)

      // Force consensus should only use the fresh attestation
      const tx = await reserveOracle
        .connect(arbiter)
        .forceConsensus(qcAddress.address)
      await expect(tx)
        .to.emit(reserveOracle, "ForcedConsensusReached")
        .withArgs(
          qcAddress.address,
          freshBalance,
          1,
          arbiter.address,
          [attester2.address], // Only attester2's attestation is valid
          [freshBalance]
        )

      const [reserveBalance] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(reserveBalance).to.equal(freshBalance)
    })

    it("should clear pending attestations after forced consensus", async () => {
      // Submit attestations
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))

      // Force consensus
      await reserveOracle.connect(arbiter).forceConsensus(qcAddress.address)

      // Check that pending attestations were cleared
      const attestation1 = await reserveOracle.pendingAttestations(
        qcAddress.address,
        attester1.address
      )
      expect(attestation1.balance).to.equal(0)
      expect(attestation1.timestamp).to.equal(0)
    })

    it("should handle emergency scenario with stale reserves", async () => {
      // Set up initial reserve
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveOracle
        .connect(attester3)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))

      // Advance time to make reserves stale
      await ethers.provider.send("evm_increaseTime", [86401]) // 24 hours + 1 second
      await ethers.provider.send("evm_mine", [])

      // Verify reserves are stale
      let [balance, isStale] =
        await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)
      expect(isStale).to.be.true

      // Submit new attestation (but not enough for consensus)
      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, ethers.utils.parseEther("150"))

      // Arbiter forces consensus with available attestation
      await reserveOracle.connect(arbiter).forceConsensus(qcAddress.address)

      // Verify reserves are updated and no longer stale
      ;[balance, isStale] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )
      expect(balance).to.equal(ethers.utils.parseEther("150"))
      expect(isStale).to.be.false
    })

    it("should emit correct attester arrays with multiple attestations", async () => {
      // Submit multiple attestations with different values
      const balance1 = ethers.utils.parseEther("80")
      const balance2 = ethers.utils.parseEther("90")
      const balance3 = ethers.utils.parseEther("100")

      await reserveOracle
        .connect(attester1)
        .submitAttestation(qcAddress.address, balance1)
      await reserveOracle
        .connect(attester2)
        .submitAttestation(qcAddress.address, balance2)

      // Note: attesters are processed in the order they appear in pendingAttesters array
      // which is the order they first submitted attestations

      const tx = await reserveOracle
        .connect(arbiter)
        .forceConsensus(qcAddress.address)

      // Verify event includes all attesters and their balances
      await expect(tx)
        .to.emit(reserveOracle, "ForcedConsensusReached")
        .withArgs(
          qcAddress.address,
          ethers.utils.parseEther("85"), // median of 80 and 90
          2,
          arbiter.address,
          [attester1.address, attester2.address],
          [balance1, balance2]
        )
    })
  })
})
