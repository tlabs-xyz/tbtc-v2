import { expect } from "chai"
import { ethers, deployments, getNamedAccounts } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ReserveLedger } from "../../typechain"

describe("ReserveLedger", () => {
  let deployer: SignerWithAddress
  let attester1: SignerWithAddress
  let attester2: SignerWithAddress
  let attester3: SignerWithAddress
  let attester4: SignerWithAddress
  let qcAddress: SignerWithAddress
  let qcManager: SignerWithAddress
  let reserveLedger: ReserveLedger

  const ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE")
  const MANAGER_ROLE = ethers.utils.id("MANAGER_ROLE")
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero

  beforeEach(async () => {
    await deployments.fixture(["ReserveLedger"])
    
    const accounts = await getNamedAccounts()
    deployer = await ethers.getSigner(accounts.deployer)
    
    const signers = await ethers.getSigners()
    attester1 = signers[1]
    attester2 = signers[2]
    attester3 = signers[3]
    attester4 = signers[4]
    qcAddress = signers[5]
    qcManager = signers[6]
    
    const ReserveLedgerDeployment = await deployments.get("ReserveLedger")
    reserveLedger = await ethers.getContractAt(
      "ReserveLedger",
      ReserveLedgerDeployment.address
    ) as ReserveLedger
    
    // Grant roles
    await reserveLedger.connect(deployer).grantRole(ATTESTER_ROLE, attester1.address)
    await reserveLedger.connect(deployer).grantRole(ATTESTER_ROLE, attester2.address)
    await reserveLedger.connect(deployer).grantRole(ATTESTER_ROLE, attester3.address)
    await reserveLedger.connect(deployer).grantRole(ATTESTER_ROLE, attester4.address)
  })

  describe("Initialization", () => {
    it("should set correct initial values", async () => {
      expect(await reserveLedger.consensusThreshold()).to.equal(3)
      expect(await reserveLedger.attestationTimeout()).to.equal(3600) // 1 hour
      expect(await reserveLedger.minReportingFrequency()).to.equal(1800) // 30 minutes
      expect(await reserveLedger.maxConsecutiveMisses()).to.equal(3)
      expect(await reserveLedger.freshnessBonus()).to.equal(300) // 5 minutes
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
      ).to.be.revertedWithCustomError(reserveLedger, "InvalidBalance")
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
      ).to.be.revertedWithCustomError(reserveLedger, "InvalidBalance")
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
        ).to.be.revertedWithCustomError(reserveLedger, "InvalidThreshold")
      })
    })
    
    describe("setAttestationTimeout", () => {
      it("should allow manager to update timeout", async () => {
        await expect(
          reserveLedger.connect(deployer).setAttestationTimeout(7200)
        ).to.emit(reserveLedger, "AttestationTimeoutUpdated")
          .withArgs(3600, 7200)
        
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
        ).to.be.revertedWithCustomError(reserveLedger, "InvalidTimeout")
      })
    })
    
    describe("setMinReportingFrequency", () => {
      it("should allow manager to update minimum reporting frequency", async () => {
        await expect(
          reserveLedger.connect(deployer).setMinReportingFrequency(900) // 15 minutes
        ).to.emit(reserveLedger, "MinReportingFrequencyUpdated")
          .withArgs(1800, 900)
        
        expect(await reserveLedger.minReportingFrequency()).to.equal(900)
      })
      
      it("should revert if frequency is zero", async () => {
        await expect(
          reserveLedger.connect(deployer).setMinReportingFrequency(0)
        ).to.be.revertedWithCustomError(reserveLedger, "InvalidTimeout")
      })
      
      it("should revert if frequency is too long", async () => {
        await expect(
          reserveLedger.connect(deployer).setMinReportingFrequency(3601) // > 1 hour
        ).to.be.revertedWithCustomError(reserveLedger, "InvalidTimeout")
      })
      
      it("should revert if not manager", async () => {
        await expect(
          reserveLedger.connect(attester1).setMinReportingFrequency(900)
        ).to.be.revertedWith(`AccessControl: account ${attester1.address.toLowerCase()} is missing role ${MANAGER_ROLE}`)
      })
    })
  })

  describe("Attester Activity Tracking", () => {
    it("should track attester activity correctly", async () => {
      // First submission - attester should be active
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      
      const [isActive, lastReport, missedReports] = await reserveLedger.getAttesterStatus(qcAddress.address, attester1.address)
      expect(isActive).to.be.true
      expect(missedReports).to.equal(0)
    })
    
    it("should track consecutive missed reports", async () => {
      // First submission
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      
      // Advance time by more than minReportingFrequency
      await ethers.provider.send("evm_increaseTime", [1801]) // 30 minutes + 1 second
      await ethers.provider.send("evm_mine", [])
      
      // Check missed reports before next submission
      await reserveLedger.updateInactiveAttesters(qcAddress.address)
      
      // Submit late
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      
      const [isActive, lastReport, missedReports] = await reserveLedger.getAttesterStatus(qcAddress.address, attester1.address)
      expect(isActive).to.be.true
      expect(missedReports).to.equal(0) // Reset because they reported
    })
    
    it("should mark attester as inactive after too many missed reports", async () => {
      // First submission
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      
      // Advance time by more than maxConsecutiveMisses * minReportingFrequency
      await ethers.provider.send("evm_increaseTime", [5401]) // 3 * 30 minutes + 1 second
      await ethers.provider.send("evm_mine", [])
      
      // Update inactive attesters
      await expect(
        reserveLedger.updateInactiveAttesters(qcAddress.address)
      ).to.emit(reserveLedger, "AttesterMarkedInactive")
        .withArgs(attester1.address, qcAddress.address, 3)
      
      const [isActive, lastReport, missedReports] = await reserveLedger.getAttesterStatus(qcAddress.address, attester1.address)
      expect(isActive).to.be.false
      expect(missedReports).to.equal(3)
    })
    
    it("should reactivate inactive attester when they report", async () => {
      // Setup: make attester inactive
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      await ethers.provider.send("evm_increaseTime", [5401])
      await ethers.provider.send("evm_mine", [])
      await reserveLedger.updateInactiveAttesters(qcAddress.address)
      
      // Verify inactive
      let [isActive] = await reserveLedger.getAttesterStatus(qcAddress.address, attester1.address)
      expect(isActive).to.be.false
      
      // Reactivate by submitting new attestation
      await expect(
        reserveLedger.connect(attester1).submitAttestation(qcAddress.address, ethers.utils.parseEther("110"))
      ).to.emit(reserveLedger, "AttesterReactivated")
        .withArgs(attester1.address, qcAddress.address)
      
      // Verify active again
      const result2 = await reserveLedger.getAttesterStatus(qcAddress.address, attester1.address)
      isActive = result2[0]
      expect(isActive).to.be.true
    })
    
    it("should only count active attesters for consensus", async () => {
      // Setup: 4 attesters submit
      await reserveLedger.connect(attester1).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveLedger.connect(attester2).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveLedger.connect(attester3).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      await reserveLedger.connect(attester4).submitAttestation(qcAddress.address, ethers.utils.parseEther("100"))
      
      // Make attester1 inactive
      await ethers.provider.send("evm_increaseTime", [5401])
      await ethers.provider.send("evm_mine", [])
      await reserveLedger.updateInactiveAttesters(qcAddress.address)
      
      // Attester2, 3, 4 submit fresh attestations
      await reserveLedger.connect(attester2).submitAttestation(qcAddress.address, ethers.utils.parseEther("110"))
      await reserveLedger.connect(attester3).submitAttestation(qcAddress.address, ethers.utils.parseEther("110"))
      
      // This should trigger consensus with only 2 active attesters (not enough)
      // So consensus should not be reached
      const [balance, isStale] = await reserveLedger.getReserveBalanceAndStaleness(qcAddress.address)
      expect(balance).to.equal(0) // No consensus yet
      
      // Now attester4 submits, reaching threshold
      await expect(
        reserveLedger.connect(attester4).submitAttestation(qcAddress.address, ethers.utils.parseEther("110"))
      ).to.emit(reserveLedger, "ConsensusReached")
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
      
      // Advance time beyond timeout
      await ethers.provider.send("evm_increaseTime", [3601])
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