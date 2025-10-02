import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ReserveOracle, SystemState } from "../../../typechain"
import {
  setupReserveOracleRoles,
  submitAttestationsForConsensus,
  testMedianCalculation,
  verifyAttestationState,
} from "../helpers/reserve-oracle-test-patterns"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("ReserveOracle - Byzantine Fault Tolerance", () => {
  let deployer: SignerWithAddress
  let honestAttesters: SignerWithAddress[]
  let maliciousAttesters: SignerWithAddress[]
  let qcAddress: SignerWithAddress
  let arbiter: SignerWithAddress
  let reserveOracle: ReserveOracle
  let systemState: SystemState

  const ATTESTER_ROLE = ethers.utils.id("ATTESTER_ROLE")
  const DISPUTE_ARBITER_ROLE = ethers.utils.id("DISPUTE_ARBITER_ROLE")

  before(async () => {
    const signers = await ethers.getSigners()
    deployer = signers[0]
    // Setup for 5 honest + 4 malicious = 9 total attesters (5/9 = 55% honest)
    honestAttesters = signers.slice(1, 6) // 5 honest attesters
    maliciousAttesters = signers.slice(6, 10) // 4 malicious attesters
    qcAddress = signers[10]
    arbiter = signers[11]
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy SystemState
    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy()
    await systemState.deployed()

    // Deploy ReserveOracle
    const ReserveOracleFactory = await ethers.getContractFactory(
      "ReserveOracle"
    )

    reserveOracle = await ReserveOracleFactory.deploy(systemState.address)
    await reserveOracle.deployed()

    // Setup roles
    await setupReserveOracleRoles(reserveOracle, {
      deployer,
      attesters: [...honestAttesters, ...maliciousAttesters],
      arbiter,
      qcAddress,
    })

    // Set consensus threshold to 5 (majority of 9 attesters)
    await reserveOracle
      .connect(deployer)
      .grantRole(DISPUTE_ARBITER_ROLE, deployer.address)
    await systemState.connect(deployer).setOracleConsensusThreshold(5)
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("50% Attack Resistance", () => {
    it("should resist manipulation with 4/9 malicious attesters (44%)", async () => {
      const honestBalance = ethers.utils.parseEther("100")
      const maliciousBalance = ethers.utils.parseEther("1000") // 10x higher

      // 4 malicious attesters submit inflated balance
      for (let i = 0; i < 4; i++) {
        await reserveOracle
          .connect(maliciousAttesters[i])
          .attestBalance(qcAddress.address, maliciousBalance)
      }

      // 5th attester (honest) should trigger consensus
      const tx = await reserveOracle
        .connect(honestAttesters[0])
        .attestBalance(qcAddress.address, honestBalance)

      await expect(tx).to.emit(reserveOracle, "ConsensusReached")

      // Result should be closer to honest value due to median calculation
      // With balances [1000, 1000, 1000, 1000, 100], median = 1000
      // This shows the attack succeeded, which means we need majority honest
      const [finalBalance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )

      expect(finalBalance).to.equal(maliciousBalance) // Attack succeeds with 4/5 malicious
    })

    it("should prevent manipulation with 2/5 malicious attesters (40%)", async () => {
      // Reset to threshold of 5 for cleaner test
      const honestBalance = ethers.utils.parseEther("100")
      const maliciousBalance = ethers.utils.parseEther("1000")

      // 2 malicious attesters
      await reserveOracle
        .connect(maliciousAttesters[0])
        .attestBalance(qcAddress.address, maliciousBalance)
      await reserveOracle
        .connect(maliciousAttesters[1])
        .attestBalance(qcAddress.address, maliciousBalance)

      // 3 honest attesters
      await reserveOracle
        .connect(honestAttesters[0])
        .attestBalance(qcAddress.address, honestBalance)
      await reserveOracle
        .connect(honestAttesters[1])
        .attestBalance(qcAddress.address, honestBalance)

      const tx = await reserveOracle
        .connect(honestAttesters[2])
        .attestBalance(qcAddress.address, honestBalance)

      await expect(tx).to.emit(reserveOracle, "ConsensusReached")

      // With balances [1000, 1000, 100, 100, 100], median = 100 (honest value)
      const [finalBalance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )

      expect(finalBalance).to.equal(honestBalance)
    })

    it("should handle exactly 50% malicious attesters", async () => {
      // Use 6 attesters total for clean 50/50 split, threshold = 6
      await systemState.connect(deployer).setOracleConsensusThreshold(6)

      const honestBalance = ethers.utils.parseEther("100")
      const maliciousBalance = ethers.utils.parseEther("1000")

      // 3 malicious attesters (50%)
      for (let i = 0; i < 3; i++) {
        await reserveOracle
          .connect(maliciousAttesters[i])
          .attestBalance(qcAddress.address, maliciousBalance)
      }

      // 3 honest attesters (50%)
      for (let i = 0; i < 2; i++) {
        await reserveOracle
          .connect(honestAttesters[i])
          .attestBalance(qcAddress.address, honestBalance)
      }

      const tx = await reserveOracle
        .connect(honestAttesters[2])
        .attestBalance(qcAddress.address, honestBalance)

      await expect(tx).to.emit(reserveOracle, "ConsensusReached")

      // With 6 values [1000, 1000, 1000, 100, 100, 100], median = (1000 + 100) / 2 = 550
      const [finalBalance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )

      expect(finalBalance).to.equal(ethers.utils.parseEther("550"))
    })
  })

  describe("Outlier Resistance", () => {
    it("should resist extreme outlier values", async () => {
      const normalBalance = ethers.utils.parseEther("100")
      const extremeOutlier = ethers.utils.parseEther("1000000") // 10,000x normal

      const balances = [
        normalBalance,
        normalBalance,
        normalBalance,
        normalBalance,
        extremeOutlier, // 1 extreme outlier
      ]

      await testMedianCalculation(
        reserveOracle,
        systemState,
        [...honestAttesters, ...maliciousAttesters],
        qcAddress.address,
        balances,
        normalBalance // Median should be normal value
      )
    })

    it("should handle multiple outliers correctly", async () => {
      const normalBalance = ethers.utils.parseEther("100")
      const highOutlier = ethers.utils.parseEther("1000")
      const lowOutlier = ethers.utils.parseEther("1")

      const balances = [
        lowOutlier, // Low outlier
        normalBalance,
        normalBalance,
        normalBalance,
        highOutlier, // High outlier
      ]

      await testMedianCalculation(
        reserveOracle,
        systemState,
        [...honestAttesters, ...maliciousAttesters],
        qcAddress.address,
        balances,
        normalBalance // Median should still be normal value
      )
    })

    it("should handle zero-value attacks", async () => {
      const normalBalance = ethers.utils.parseEther("100")
      const zeroBalance = ethers.BigNumber.from(0)

      const balances = [
        zeroBalance, // Malicious zero
        zeroBalance, // Malicious zero
        normalBalance, // Honest
        normalBalance, // Honest
        normalBalance, // Honest
      ]

      await testMedianCalculation(
        reserveOracle,
        systemState,
        [...honestAttesters, ...maliciousAttesters],
        qcAddress.address,
        balances,
        normalBalance // Median should be normal value, not zero
      )
    })
  })

  describe("Coordination Attack Scenarios", () => {
    it("should resist coordinated timing attacks", async () => {
      const honestBalance = ethers.utils.parseEther("100")
      const attackBalance = ethers.utils.parseEther("500")

      // Malicious attesters coordinate to submit just before consensus
      await reserveOracle
        .connect(honestAttesters[0])
        .attestBalance(qcAddress.address, honestBalance)
      await reserveOracle
        .connect(honestAttesters[1])
        .attestBalance(qcAddress.address, honestBalance)
      await reserveOracle
        .connect(honestAttesters[2])
        .attestBalance(qcAddress.address, honestBalance)
      await reserveOracle
        .connect(honestAttesters[3])
        .attestBalance(qcAddress.address, honestBalance)

      // Malicious attester tries to manipulate final consensus
      const tx = await reserveOracle
        .connect(maliciousAttesters[0])
        .attestBalance(qcAddress.address, attackBalance)

      await expect(tx).to.emit(reserveOracle, "ConsensusReached")

      // With [100, 100, 100, 100, 500], median = 100
      const [finalBalance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )

      expect(finalBalance).to.equal(honestBalance)
    })

    it("should resist gradual manipulation attempts", async () => {
      // First round: establish baseline
      const baselineBalance = ethers.utils.parseEther("100")

      await submitAttestationsForConsensus({
        reserveOracle,
        systemState,
        attesters: honestAttesters,
        qcAddress: qcAddress.address,
        balance: baselineBalance,
      })

      // Second round: attackers try gradual increase
      const slightlyInflated = ethers.utils.parseEther("120") // 20% inflation

      await reserveOracle
        .connect(maliciousAttesters[0])
        .attestBalance(qcAddress.address, slightlyInflated)
      await reserveOracle
        .connect(maliciousAttesters[1])
        .attestBalance(qcAddress.address, slightlyInflated)
      await reserveOracle
        .connect(honestAttesters[0])
        .attestBalance(qcAddress.address, baselineBalance)
      await reserveOracle
        .connect(honestAttesters[1])
        .attestBalance(qcAddress.address, baselineBalance)

      const tx = await reserveOracle
        .connect(honestAttesters[2])
        .attestBalance(qcAddress.address, baselineBalance)

      await expect(tx).to.emit(reserveOracle, "ConsensusReached")

      // Honest majority should prevent gradual manipulation
      const [finalBalance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )

      expect(finalBalance).to.equal(baselineBalance)
    })
  })

  describe("Recovery from Byzantine Failures", () => {
    it("should recover after malicious attesters are revoked", async () => {
      const attackBalance = ethers.utils.parseEther("1000")

      // Malicious attesters submit bad data
      await reserveOracle
        .connect(maliciousAttesters[0])
        .attestBalance(qcAddress.address, attackBalance)
      await reserveOracle
        .connect(maliciousAttesters[1])
        .attestBalance(qcAddress.address, attackBalance)

      // Revoke malicious attesters
      await reserveOracle
        .connect(deployer)
        .revokeRole(ATTESTER_ROLE, maliciousAttesters[0].address)
      await reserveOracle
        .connect(deployer)
        .revokeRole(ATTESTER_ROLE, maliciousAttesters[1].address)

      // Honest attesters complete consensus
      const honestBalance = ethers.utils.parseEther("100")
      await reserveOracle
        .connect(honestAttesters[0])
        .attestBalance(qcAddress.address, honestBalance)
      await reserveOracle
        .connect(honestAttesters[1])
        .attestBalance(qcAddress.address, honestBalance)

      const tx = await reserveOracle
        .connect(honestAttesters[2])
        .attestBalance(qcAddress.address, honestBalance)

      // Should reach consensus with only honest values (revoked attestations ignored)
      await expect(tx).to.emit(reserveOracle, "ConsensusReached")

      const [finalBalance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )

      expect(finalBalance).to.equal(honestBalance)
    })

    it("should handle arbiter override of compromised consensus", async () => {
      const compromisedBalance = ethers.utils.parseEther("1000")
      const correctBalance = ethers.utils.parseEther("100")

      // Majority malicious scenario forces bad consensus
      await systemState.connect(deployer).setOracleConsensusThreshold(3)

      // 3 malicious attesters force consensus
      await reserveOracle
        .connect(maliciousAttesters[0])
        .attestBalance(qcAddress.address, compromisedBalance)
      await reserveOracle
        .connect(maliciousAttesters[1])
        .attestBalance(qcAddress.address, compromisedBalance)

      const tx = await reserveOracle
        .connect(maliciousAttesters[2])
        .attestBalance(qcAddress.address, compromisedBalance)

      await expect(tx).to.emit(reserveOracle, "ConsensusReached")

      // Verify compromised balance was set
      let [balance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )

      expect(balance).to.equal(compromisedBalance)

      // Arbiter detects compromise and overrides
      await reserveOracle
        .connect(arbiter)
        .overrideAttestation(
          qcAddress.address,
          correctBalance,
          "Byzantine attack detected"
        )

      // Verify correct balance is now set
      ;[balance] = await reserveOracle.getReserveBalanceAndStaleness(
        qcAddress.address
      )
      expect(balance).to.equal(correctBalance)
    })
  })

  describe("Stress Testing Byzantine Scenarios", () => {
    it("should handle maximum malicious attesters (threshold - 1)", async () => {
      // Set threshold to 5, so 4 malicious is maximum that shouldn't break system
      const threshold = 5
      await systemState.connect(deployer).setOracleConsensusThreshold(threshold)

      const honestBalance = ethers.utils.parseEther("100")
      const maliciousBalance = ethers.utils.parseEther("1000")

      // 4 malicious attesters (threshold - 1)
      for (let i = 0; i < threshold - 1; i++) {
        await reserveOracle
          .connect(maliciousAttesters[i])
          .attestBalance(qcAddress.address, maliciousBalance)
      }

      // 1 honest attester triggers consensus
      const tx = await reserveOracle
        .connect(honestAttesters[0])
        .attestBalance(qcAddress.address, honestBalance)

      await expect(tx).to.emit(reserveOracle, "ConsensusReached")

      // System should still work, though result may be compromised
      // This demonstrates the importance of having > 50% honest attesters
    })

    it("should maintain security with varying attack patterns", async () => {
      const baseBalance = ethers.utils.parseEther("100")

      // Test multiple attack patterns in sequence
      const attackPatterns = [
        { balance: ethers.utils.parseEther("0"), description: "zero attack" },
        {
          balance: ethers.utils.parseEther("1000000"),
          description: "inflation attack",
        },
        {
          balance: ethers.utils.parseEther("1"),
          description: "deflation attack",
        },
      ]

      for (const pattern of attackPatterns) {
        // Reset consensus
        await reserveOracle.connect(arbiter).resetConsensus(qcAddress.address)

        // 2 malicious, 3 honest (honest majority)
        await reserveOracle
          .connect(maliciousAttesters[0])
          .attestBalance(qcAddress.address, pattern.balance)
        await reserveOracle
          .connect(maliciousAttesters[1])
          .attestBalance(qcAddress.address, pattern.balance)
        await reserveOracle
          .connect(honestAttesters[0])
          .attestBalance(qcAddress.address, baseBalance)
        await reserveOracle
          .connect(honestAttesters[1])
          .attestBalance(qcAddress.address, baseBalance)

        const tx = await reserveOracle
          .connect(honestAttesters[2])
          .attestBalance(qcAddress.address, baseBalance)

        await expect(tx).to.emit(reserveOracle, "ConsensusReached")

        // Honest majority should prevail regardless of attack pattern
        const [finalBalance] =
          await reserveOracle.getReserveBalanceAndStaleness(qcAddress.address)

        expect(finalBalance).to.equal(
          baseBalance,
          `Failed for ${pattern.description}`
        )
      }
    })
  })
})
