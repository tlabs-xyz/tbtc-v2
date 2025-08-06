import { expect } from "chai"
import { ethers, deployments, getNamedAccounts } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { QCReserveLedger } from "../../typechain"

describe("QCReserveLedger", () => {
  let deployer: SignerWithAddress
  let attester1: SignerWithAddress
  let attester2: SignerWithAddress
  let attester3: SignerWithAddress
  let attester4: SignerWithAddress
  let qcAddress: SignerWithAddress
  let qcManager: SignerWithAddress
  let reserveLedger: QCReserveLedger

  const ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE")
  const MANAGER_ROLE = ethers.utils.id("MANAGER_ROLE")
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero

  beforeEach(async () => {
    await deployments.fixture(["QCReserveLedger"])
    
    const accounts = await getNamedAccounts()
    deployer = await ethers.getSigner(accounts.deployer)
    
    const signers = await ethers.getSigners()
    attester1 = signers[1]
    attester2 = signers[2]
    attester3 = signers[3]
    attester4 = signers[4]
    qcAddress = signers[5]
    qcManager = signers[6]
    
    const QCReserveLedgerDeployment = await deployments.get("QCReserveLedger")
    reserveLedger = await ethers.getContractAt(
      "QCReserveLedger",
      QCReserveLedgerDeployment.address
    ) as QCReserveLedger
    
    // Grant roles
    await reserveLedger.connect(deployer).grantRole(ATTESTER_ROLE, attester1.address)
    await reserveLedger.connect(deployer).grantRole(ATTESTER_ROLE, attester2.address)
    await reserveLedger.connect(deployer).grantRole(ATTESTER_ROLE, attester3.address)
    await reserveLedger.connect(deployer).grantRole(ATTESTER_ROLE, attester4.address)
    await reserveLedger.connect(deployer).grantRole(MANAGER_ROLE, qcManager.address)
  })

  describe("Initialization", () => {
    it("should set correct initial values", async () => {
      expect(await reserveLedger.consensusThreshold()).to.equal(3)
      expect(await reserveLedger.attestationTimeout()).to.equal(21600) // 6 hours
      expect(await reserveLedger.maxStaleness()).to.equal(86400) // 24 hours
      expect(await reserveLedger.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true
      expect(await reserveLedger.hasRole(MANAGER_ROLE, deployer.address)).to.be.true
    })
  })

  describe("submitAttestation", () => {
    it("should allow attester to submit attestation", async () => {
      const balance = ethers.utils.parseEther("100")
      
      await expect(
        reserveLedger.connect(attester1).submitAttestation(qcAddress.address, balance)
      ).to.emit(reserveLedger, "AttestationSubmitted")
        .withArgs(qcAddress.address, attester1.address, balance, await getBlockTimestamp())
      
      const attestation = await reserveLedger.pendingAttestations(qcAddress.address, attester1.address)
      expect(attestation.balance).to.equal(balance)
      expect(attestation.attester).to.equal(attester1.address)
    })
    
    it("should revert if not attester", async () => {
      const balance = ethers.utils.parseEther("100")
      
      await expect(
        reserveLedger.connect(qcAddress).submitAttestation(qcAddress.address, balance)
      ).to.be.revertedWith(`AccessControl: account ${qcAddress.address.toLowerCase()} is missing role ${ATTESTER_ROLE}`)
    })
    
    it("should revert if balance is zero", async () => {
      await expect(
        reserveLedger.connect(attester1).submitAttestation(qcAddress.address, 0)
      ).to.be.revertedWith("InvalidBalance")
    })
  })

  describe("Consensus mechanism", () => {
    it("should reach consensus with 3 matching attestations", async () => {
      const balance = ethers.utils.parseEther("100")
      
      // Submit 3 attestations with same balance
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, balance)
      await reserveLedger.connect(attester2).submitAttestation(qcAddress.address, balance)
      
      // Third attestation should trigger consensus
      await expect(
        reserveLedger.connect(attester3).submitAttestation(qcAddress.address, balance)
      ).to.emit(reserveLedger, "ConsensusReached")
        .withArgs(qcAddress.address, balance, 3, await getBlockTimestamp())
      
      // Check that reserve was updated
      const [reserveBalance, isStale] = await reserveLedger.getReserveBalanceAndStaleness(qcAddress.address)
      expect(reserveBalance).to.equal(balance)
      expect(isStale).to.be.false
    })
    
    it("should calculate median for different values", async () => {
      // Submit 3 different attestations
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, ethers.utils.parseEther("90"))
      await reserveLedger.connect(attester2).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      
      // Third attestation should trigger consensus with median value
      await expect(
        reserveLedger.connect(attester3).submitAttestation(qcAddress.address, ethers.utils.parseEther("110"))
      ).to.emit(reserveLedger, "ConsensusReached")
        .withArgs(qcAddress.address, ethers.utils.parseEther("100"), 3, await getBlockTimestamp())
      
      const [reserveBalance] = await reserveLedger.getReserveBalanceAndStaleness(qcAddress.address)
      expect(reserveBalance).to.equal(ethers.utils.parseEther("100"))
    })
    
    it("should handle even number of attestations", async () => {
      // Update threshold to 4
      await reserveLedger.connect(deployer).setConsensusThreshold(4)
      
      // Submit 4 attestations
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, ethers.utils.parseEther("80"))
      await reserveLedger.connect(attester2).submitAttestation(qcAddress.address, ethers.utils.parseEther("90"))
      await reserveLedger.connect(attester3).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      
      // Fourth attestation triggers consensus
      await expect(
        reserveLedger.connect(attester4).submitAttestation(qcAddress.address, ethers.utils.parseEther("110"))
      ).to.emit(reserveLedger, "ConsensusReached")
      
      // Median of [80, 90, 100, 110] = (90 + 100) / 2 = 95
      const [reserveBalance] = await reserveLedger.getReserveBalanceAndStaleness(qcAddress.address)
      expect(reserveBalance).to.equal(ethers.utils.parseEther("95"))
    })
    
    it("should not reach consensus with insufficient attestations", async () => {
      const balance = ethers.utils.parseEther("100")
      
      // Submit only 2 attestations (threshold is 3)
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, balance)
      await expect(
        reserveLedger.connect(attester2).submitAttestation(qcAddress.address, balance)
      ).to.not.emit(reserveLedger, "ConsensusReached")
      
      // Check that reserve was not updated
      const [reserveBalance] = await reserveLedger.getReserveBalanceAndStaleness(qcAddress.address)
      expect(reserveBalance).to.equal(0)
    })
    
    it("should clear pending attestations after consensus", async () => {
      const balance = ethers.utils.parseEther("100")
      
      // Reach consensus
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, balance)
      await reserveLedger.connect(attester2).submitAttestation(qcAddress.address, balance)
      await reserveLedger.connect(attester3).submitAttestation(qcAddress.address, balance)
      
      // Check that pending attestations were cleared
      const attestation1 = await reserveLedger.pendingAttestations(qcAddress.address, attester1.address)
      expect(attestation1.balance).to.equal(0)
      expect(attestation1.timestamp).to.equal(0)
    })
  })

  describe("getReserveBalanceAndStaleness", () => {
    beforeEach(async () => {
      // Set up a reserve balance
      const balance = ethers.utils.parseEther("100")
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, balance)
      await reserveLedger.connect(attester2).submitAttestation(qcAddress.address, balance)
      await reserveLedger.connect(attester3).submitAttestation(qcAddress.address, balance)
    })
    
    it("should return correct balance and freshness", async () => {
      const [balance, isStale] = await reserveLedger.getReserveBalanceAndStaleness(qcAddress.address)
      expect(balance).to.equal(ethers.utils.parseEther("100"))
      expect(isStale).to.be.false
    })
    
    it("should mark as stale after timeout", async () => {
      // Advance time beyond timeout
      await ethers.provider.send("evm_increaseTime", [3601]) // 1 hour + 1 second
      await ethers.provider.send("evm_mine", [])
      
      const [balance, isStale] = await reserveLedger.getReserveBalanceAndStaleness(qcAddress.address)
      expect(balance).to.equal(ethers.utils.parseEther("100"))
      expect(isStale).to.be.true
    })
  })

  describe("updateReserveBalance (admin function)", () => {
    beforeEach(async () => {
      // Grant MANAGER_ROLE to qcManager
      await reserveLedger.connect(deployer).grantRole(MANAGER_ROLE, qcManager.address)
    })
    
    it("should allow manager to directly update balance", async () => {
      const balance = ethers.utils.parseEther("200")
      
      await expect(
        reserveLedger.connect(qcManager).updateReserveBalance(qcAddress.address, balance)
      ).to.emit(reserveLedger, "ReserveUpdated")
        .withArgs(qcAddress.address, 0, balance, await getBlockTimestamp())
      
      // Check that reserve was immediately updated
      const [reserveBalance, isStale] = await reserveLedger.getReserveBalanceAndStaleness(qcAddress.address)
      expect(reserveBalance).to.equal(balance)
      expect(isStale).to.be.false
    })
    
    it("should revert if not manager", async () => {
      const balance = ethers.utils.parseEther("200")
      
      await expect(
        reserveLedger.connect(attester1).updateReserveBalance(qcAddress.address, balance)
      ).to.be.revertedWith(`AccessControl: account ${attester1.address.toLowerCase()} is missing role ${MANAGER_ROLE}`)
    })
    
    it("should revert if balance is zero", async () => {
      await expect(
        reserveLedger.connect(qcManager).updateReserveBalance(qcAddress.address, 0)
      ).to.be.revertedWith("InvalidBalance")
    })
  })

  describe("Configuration", () => {
    describe("setConsensusThreshold", () => {
      it("should allow manager to update threshold", async () => {
        await expect(
          reserveLedger.connect(deployer).setConsensusThreshold(5)
        ).to.emit(reserveLedger, "ConsensusThresholdUpdated")
          .withArgs(3, 5)
        
        expect(await reserveLedger.consensusThreshold()).to.equal(5)
      })
      
      it("should revert if not manager", async () => {
        await expect(
          reserveLedger.connect(attester1).setConsensusThreshold(5)
        ).to.be.revertedWith(`AccessControl: account ${attester1.address.toLowerCase()} is missing role ${MANAGER_ROLE}`)
      })
      
      it("should revert if threshold is zero", async () => {
        await expect(
          reserveLedger.connect(deployer).setConsensusThreshold(0)
        ).to.be.revertedWith("InvalidThreshold")
      })
    })
    
    describe("setAttestationTimeout", () => {
      it("should allow manager to update timeout", async () => {
        await expect(
          reserveLedger.connect(deployer).setAttestationTimeout(7200)
        ).to.emit(reserveLedger, "AttestationTimeoutUpdated")
          .withArgs(21600, 7200)
        
        expect(await reserveLedger.attestationTimeout()).to.equal(7200)
      })
      
      it("should revert if not manager", async () => {
        await expect(
          reserveLedger.connect(attester1).setAttestationTimeout(7200)
        ).to.be.revertedWith(`AccessControl: account ${attester1.address.toLowerCase()} is missing role ${MANAGER_ROLE}`)
      })
      
      it("should revert if timeout is zero", async () => {
        await expect(
          reserveLedger.connect(deployer).setAttestationTimeout(0)
        ).to.be.revertedWith("InvalidTimeout")
      })
    })
    
    describe("setMaxStaleness", () => {
      it("should allow manager to update max staleness", async () => {
        await expect(
          reserveLedger.connect(deployer).setMaxStaleness(172800) // 48 hours
        ).to.emit(reserveLedger, "MaxStalenessUpdated")
          .withArgs(86400, 172800)
        
        expect(await reserveLedger.maxStaleness()).to.equal(172800)
      })
      
      it("should revert if staleness is zero", async () => {
        await expect(
          reserveLedger.connect(deployer).setMaxStaleness(0)
        ).to.be.revertedWith("InvalidTimeout")
      })
      
      it("should revert if not manager", async () => {
        await expect(
          reserveLedger.connect(attester1).setMaxStaleness(172800)
        ).to.be.revertedWith(`AccessControl: account ${attester1.address.toLowerCase()} is missing role ${MANAGER_ROLE}`)
      })
    })
  })

  describe("Staleness Tracking", () => {
    it("should detect stale reserve data", async () => {
      // Initially stale (never updated)
      let [isStale, timeSinceUpdate] = await reserveLedger.isReserveStale(qcAddress.address)
      expect(isStale).to.be.true
      expect(timeSinceUpdate).to.equal(ethers.constants.MaxUint256)
      
      // Submit consensus
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveLedger.connect(attester2).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveLedger.connect(attester3).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      
      // Should be fresh now
      ;[isStale, timeSinceUpdate] = await reserveLedger.isReserveStale(qcAddress.address)
      expect(isStale).to.be.false
      expect(timeSinceUpdate).to.be.lt(10) // Less than 10 seconds
      
      // Advance time beyond maxStaleness (24 hours)
      await ethers.provider.send("evm_increaseTime", [86401])
      await ethers.provider.send("evm_mine", [])
      
      // Should be stale now
      ;[isStale, timeSinceUpdate] = await reserveLedger.isReserveStale(qcAddress.address)
      expect(isStale).to.be.true
      expect(timeSinceUpdate).to.be.gt(86400)
    })
    
    it("should report staleness in getReserveBalanceAndStaleness", async () => {
      // Submit consensus
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveLedger.connect(attester2).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveLedger.connect(attester3).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      
      // Should be fresh
      let [balance, isStale] = await reserveLedger.getReserveBalanceAndStaleness(qcAddress.address)
      expect(balance).to.equal(ethers.utils.parseEther("100"))
      expect(isStale).to.be.false
      
      // Advance time beyond maxStaleness
      await ethers.provider.send("evm_increaseTime", [86401])
      await ethers.provider.send("evm_mine", [])
      
      // Should be stale but balance preserved
      ;[balance, isStale] = await reserveLedger.getReserveBalanceAndStaleness(qcAddress.address)
      expect(balance).to.equal(ethers.utils.parseEther("100"))
      expect(isStale).to.be.true
    })
  })

  describe("Edge cases", () => {
    it("should handle attester updating their attestation", async () => {
      // First attestation
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      
      // Update attestation
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, ethers.utils.parseEther("150"))
      
      // Check that attestation was updated
      const attestation = await reserveLedger.pendingAttestations(qcAddress.address, attester1.address)
      expect(attestation.balance).to.equal(ethers.utils.parseEther("150"))
    })
    
    it("should ignore expired attestations when calculating consensus", async () => {
      // Submit first attestation
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      
      // Advance time beyond attestation timeout (6 hours)
      await ethers.provider.send("evm_increaseTime", [21601])
      await ethers.provider.send("evm_mine", [])
      
      // Submit two more attestations
      await reserveLedger.connect(attester2).submitAttestation(qcAddress.address, ethers.utils.parseEther("200"))
      
      // This should not trigger consensus because first attestation is expired
      await expect(
        reserveLedger.connect(attester3).submitAttestation(qcAddress.address, ethers.utils.parseEther("200"))
      ).to.not.emit(reserveLedger, "ConsensusReached")
      
      // Add fourth attestation to reach consensus with only fresh attestations
      await expect(
        reserveLedger.connect(attester4).submitAttestation(qcAddress.address, ethers.utils.parseEther("200"))
      ).to.emit(reserveLedger, "ConsensusReached")
        .withArgs(qcAddress.address, ethers.utils.parseEther("200"), 3, await getBlockTimestamp())
    })
  })

  // Helper function to get current block timestamp
  async function getBlockTimestamp(): Promise<number> {
    const block = await ethers.provider.getBlock("latest")
    return block.timestamp
  }
})