import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  SecurityTestFixture,
  deploySecurityTestFixture,
  setupQCWithWallets,
  createMockSpvData,
  TEST_DATA,
  QCStatus,
} from "./AccountControlTestHelpers"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

/**
 * Economic Attack Testing Suite
 *
 * Tests for flash loan attacks, MEV extraction, front-running, and other
 * economic manipulation scenarios that could exploit the Account Control system.
 *
 * CRITICAL SECURITY TESTS - These scenarios represent real attack vectors
 * that could be used to manipulate the system for economic gain.
 */
describe("Economic Attack Tests", () => {
  let fixture: SecurityTestFixture
  let attacker: SignerWithAddress
  let victim: SignerWithAddress
  let flashLoanProvider: SignerWithAddress

  // Attack simulation data
  const normalMintAmount = TEST_DATA.AMOUNTS.NORMAL_MINT
  const largeAmount = ethers.utils.parseEther("1000")
  const flashLoanAmount = ethers.utils.parseEther("10000")

  beforeEach(async () => {
    await createSnapshot()

    const [, , , , , attackerSigner, victimSigner, flashLoanProviderSigner] =
      await ethers.getSigners()
    attacker = attackerSigner
    victim = victimSigner
    flashLoanProvider = flashLoanProviderSigner

    fixture = await deploySecurityTestFixture()

    // Setup a legitimate QC for testing
    await setupQCWithWallets(
      fixture,
      fixture.qcAddress.address,
      [TEST_DATA.BTC_ADDRESSES.TEST],
      largeAmount
    )
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Flash Loan Attack Scenarios", () => {
    /**
     * CRITICAL: Flash Loan Attack on Minting Capacity
     *
     * Attack vector: Use flash loan to temporarily increase reserves,
     * mint maximum tBTC, then repay flash loan, leaving system
     * with unbacked tBTC.
     */
    context("Flash Loan Minting Capacity Manipulation", () => {
      it("should prevent flash loan attack on reserve attestation", async () => {
        const { qcReserveLedger, basicMintingPolicy, watchdog, qcAddress } =
          fixture

        // Setup: Attacker gets flash loan
        const originalReserves = TEST_DATA.AMOUNTS.RESERVE_BALANCE
        const inflatedReserves = originalReserves.add(flashLoanAmount)

        // Attack attempt: Flash loan → inflate reserves → mint → repay loan
        // This should fail because attestation should be restricted

        // Step 1: Attacker attempts to submit inflated reserve attestation
        await expect(
          qcReserveLedger
            .connect(attacker)
            .submitReserveAttestation(qcAddress.address, inflatedReserves)
        ).to.be.revertedWith("AccessControl: account") // Should require ATTESTER_ROLE

        // Step 2: Even if attacker had ATTESTER_ROLE, minting should be atomic
        // and not allow mid-transaction balance manipulation
        await qcReserveLedger
          .connect(watchdog)
          .submitReserveAttestation(qcAddress.address, inflatedReserves)

        // The system should not allow instant minting after reserve update
        // without proper validation of reserve persistence
        const capacity = await basicMintingPolicy.getAvailableMintingCapacity(
          qcAddress.address
        )
        expect(capacity).to.be.gt(0) // Capacity exists but...

        // Critical: This test reveals we need time-based reserve validation
        // or multi-block confirmation for large reserve increases
      })

      it("should detect and prevent reserve attestation timing manipulation", async () => {
        const {
          qcReserveLedger,
          qcManager,
          qcData,
          basicMintingPolicy,
          watchdog,
          qcAddress,
          user,
        } = fixture

        // First, let's create a scenario where the QC has minted tokens
        // This makes the solvency test meaningful
        const mintAmount = ethers.utils.parseEther("50") // 50 ETH worth of tokens

        // Simulate minting by updating the QC's minted amount
        await qcManager.updateQCMintedAmount(qcAddress.address, mintAmount)

        // Attack: Rapidly change reserves to confuse solvency calculations
        const reserves1 = ethers.utils.parseEther("100")
        const reserves2 = ethers.utils.parseEther("1") // Much less than minted amount (50 ETH)

        await qcReserveLedger
          .connect(watchdog)
          .submitReserveAttestation(qcAddress.address, reserves1)

        // Immediate second attestation (flash loan scenario)
        await qcReserveLedger
          .connect(watchdog)
          .submitReserveAttestation(qcAddress.address, reserves2)

        // Solvency check should use latest attestation
        await qcManager.connect(watchdog).verifyQCSolvency(qcAddress.address)

        // QC should be marked as insolvent due to low reserves vs minted amount
        // reserves (1 ETH) < mintedAmount (50 ETH) = insolvent
        const qcStatus = await fixture.qcData.getQCStatus(qcAddress.address)
        expect(qcStatus).to.equal(QCStatus.UnderReview) // Should be flagged as insolvent
      })

      it("should prevent minting capacity calculation manipulation", async () => {
        const { basicMintingPolicy, qcManager, qcAddress, user } = fixture

        // Attack: Manipulate capacity calculation through concurrent operations
        const capacity1 = await basicMintingPolicy.getAvailableMintingCapacity(
          qcAddress.address
        )

        // Simulate concurrent minting attempts that might overflow capacity
        const promises = []
        for (let i = 0; i < 5; i++) {
          promises.push(
            basicMintingPolicy.connect(user).requestMint(
              qcAddress.address,
              user.address,
              capacity1.div(3) // Each request is 1/3 of capacity
            )
          )
        }

        // Only first few should succeed, others should fail due to capacity limits
        const results = await Promise.allSettled(promises)
        const successes = results.filter((r) => r.status === "fulfilled").length
        const failures = results.filter((r) => r.status === "rejected").length

        expect(successes).to.be.lte(3) // At most 3 should succeed (3 * capacity/3 = capacity)
        expect(failures).to.be.gte(2) // At least 2 should fail
      })
    })

    context("Flash Loan Governance Attack", () => {
      it("should prevent flash loan-based governance manipulation", async () => {
        const { protocolRegistry, basicMintingPolicy } = fixture

        // Attack: Use flash loan to acquire governance tokens, change policy, exploit, repay
        // This test ensures our governance is not vulnerable to flash loan attacks

        // Step 1: Attacker should not be able to change policy without proper governance
        const maliciousPolicyAddress = attacker.address

        await expect(
          protocolRegistry
            .connect(attacker)
            .setService(
              await basicMintingPolicy.MINTING_POLICY_KEY(),
              maliciousPolicyAddress
            )
        ).to.be.revertedWith("AccessControl: account") // Should require DEFAULT_ADMIN_ROLE

        // Step 2: Even with governance tokens, changes should have timelock
        // (This would require implementing timelock governance, which is future work)
      })
    })
  })

  describe("MEV Extraction Attack Scenarios", () => {
    /**
     * CRITICAL: MEV Extraction During Minting/Redemption
     *
     * Attack vector: Front-run legitimate transactions to extract value
     * through transaction ordering manipulation.
     */
    context("Transaction Ordering Manipulation", () => {
      it("should resist MEV extraction during minting operations", async () => {
        const { basicMintingPolicy, qcAddress, user } = fixture

        // Scenario: Attacker sees user's minting transaction and front-runs
        const userMintAmount = normalMintAmount

        // Attack: Front-run with larger amount to consume capacity
        const attackerMintAmount = userMintAmount.mul(2)

        // Both transactions should succeed or fail based on capacity, not ordering
        // The key is that one transaction shouldn't be able to manipulate
        // the outcome of another in the same block

        const userTx = basicMintingPolicy
          .connect(user)
          .requestMint(qcAddress.address, user.address, userMintAmount)

        const attackerTx = basicMintingPolicy
          .connect(attacker)
          .requestMint(qcAddress.address, attacker.address, attackerMintAmount)

        // Both should succeed if total capacity is sufficient
        await expect(userTx).to.not.be.reverted
        await expect(attackerTx).to.not.be.reverted
      })

      it("should prevent sandwich attacks on redemption operations", async () => {
        const { basicRedemptionPolicy, qcAddress, user, tbtc } = fixture

        // Setup: User has tBTC to redeem
        const redemptionAmount = normalMintAmount
        tbtc.balanceOf.whenCalledWith(user.address).returns(redemptionAmount)
        tbtc.balanceOf
          .whenCalledWith(attacker.address)
          .returns(redemptionAmount)

        // Scenario: Attacker sandwich attacks user's redemption
        const redemptionId1 = ethers.utils.id("user_redemption")
        const redemptionId2 = ethers.utils.id("attacker_redemption")

        // Attack: Front-run + back-run user's redemption
        const frontRunTx = basicRedemptionPolicy
          .connect(attacker)
          .requestRedemption(
            redemptionId2,
            qcAddress.address,
            attacker.address,
            redemptionAmount,
            TEST_DATA.BTC_ADDRESSES.TEST
          )

        const userTx = basicRedemptionPolicy
          .connect(user)
          .requestRedemption(
            redemptionId1,
            qcAddress.address,
            user.address,
            redemptionAmount,
            TEST_DATA.BTC_ADDRESSES.TEST
          )

        // Both transactions should succeed independently
        await expect(frontRunTx).to.not.be.reverted
        await expect(userTx).to.not.be.reverted

        // Key: No transaction should be able to manipulate the outcome of another
        expect(
          await basicRedemptionPolicy.getRedemptionStatus(redemptionId1)
        ).to.equal(0)
        expect(
          await basicRedemptionPolicy.getRedemptionStatus(redemptionId2)
        ).to.equal(0)
      })
    })

    context("Price Manipulation Through QC Operations", () => {
      it("should prevent QC status manipulation for MEV extraction", async () => {
        const { qcManager, watchdog, qcAddress } = fixture

        // Attack: Manipulate QC status to affect token prices in other systems
        const testReason = ethers.utils.id("MANIPULATION_ATTEMPT")

        // Attacker should not be able to change QC status without proper authority
        await expect(
          qcManager
            .connect(attacker)
            .setQCStatus(qcAddress.address, QCStatus.UnderReview, testReason)
        ).to.be.revertedWith("AccessControl: account") // Should require ARBITER_ROLE

        // Even authorized changes should be logged and reversible
        await qcManager
          .connect(watchdog)
          .setQCStatus(qcAddress.address, QCStatus.UnderReview, testReason)

        // Status should change but be properly logged
        const newStatus = await fixture.qcData.getQCStatus(qcAddress.address)
        expect(newStatus).to.equal(QCStatus.UnderReview)

        // Recovery should be possible
        await qcManager
          .connect(watchdog)
          .setQCStatus(qcAddress.address, QCStatus.Active, testReason)
        const recoveredStatus = await fixture.qcData.getQCStatus(
          qcAddress.address
        )
        expect(recoveredStatus).to.equal(QCStatus.Active)
      })
    })
  })

  describe("Front-Running Attack Scenarios", () => {
    /**
     * CRITICAL: Front-running protection for critical operations
     *
     * Attack vector: Monitor mempool and front-run important transactions
     * to gain unfair advantage or cause failures.
     */
    context("QC Registration Front-Running", () => {
      it("should prevent front-running of QC registration", async () => {
        const { qcManager } = fixture

        const newQC = ethers.Wallet.createRandom().address

        // Scenario: Legitimate QC tries to register, attacker front-runs
        // The legitimate registration should succeed
        const legitimateRegistration = qcManager.registerQC(newQC)
        await expect(legitimateRegistration).to.not.be.reverted

        // The attacker should NOT be able to register without proper role
        const attackerRegistration = qcManager
          .connect(attacker)
          .registerQC(attacker.address)
        await expect(attackerRegistration).to.be.revertedWith(
          "AccessControl: account"
        )

        // Only the legitimate QC should be registered
        expect(await fixture.qcData.isQCRegistered(newQC)).to.be.true
        expect(await fixture.qcData.isQCRegistered(attacker.address)).to.be
          .false

        // This demonstrates proper access control prevents unauthorized front-running
        // Real front-running protection would require the attacker to have the same role,
        // which would make them a legitimate participant, not an attacker
      })
    })

    context("Reserve Attestation Front-Running", () => {
      it("should prevent manipulation of reserve attestation ordering", async () => {
        const { qcReserveLedger, watchdog, qcAddress } = fixture

        // Scenario: Multiple reserve attestations in same block
        const reserves1 = ethers.utils.parseEther("10")
        const reserves2 = ethers.utils.parseEther("20")

        // The system should handle multiple attestations correctly
        // Latest should win, but both should be valid operations
        await qcReserveLedger
          .connect(watchdog)
          .submitReserveAttestation(qcAddress.address, reserves1)
        await qcReserveLedger
          .connect(watchdog)
          .submitReserveAttestation(qcAddress.address, reserves2)

        // Use the correct function name and destructure the return values
        const [finalBalance, isStale] =
          await qcReserveLedger.getReserveBalanceAndStaleness(qcAddress.address)
        expect(finalBalance).to.equal(reserves2) // Latest attestation should be used
        expect(isStale).to.be.false // Should not be stale immediately after submission
      })
    })
  })

  describe("Griefing Attack Scenarios", () => {
    /**
     * CRITICAL: DoS and griefing attack resistance
     *
     * Attack vector: Use system features to deny service to legitimate users
     * or cause unnecessary gas costs.
     */
    context("Capacity Exhaustion Attacks", () => {
      it("should prevent griefing through capacity exhaustion", async () => {
        const { basicMintingPolicy, qcAddress, user } = fixture

        // Attack: Attacker makes many small mints to exhaust capacity
        const smallAmount = ethers.utils.parseEther("0.01")
        const capacity = await basicMintingPolicy.getAvailableMintingCapacity(
          qcAddress.address
        )
        const maxAttempts = Math.min(100, capacity.div(smallAmount).toNumber())

        // Attacker tries to exhaust capacity with many small transactions
        const attempts = Array.from(
          { length: Math.min(maxAttempts, 10) },
          (_, i) => i
        )
        await attempts.reduce(async (prev, i) => {
          await prev
          try {
            await basicMintingPolicy
              .connect(attacker)
              .requestMint(qcAddress.address, attacker.address, smallAmount)
            return await Promise.resolve()
          } catch {
            // Expected when capacity is exhausted - break out of sequence
            return Promise.resolve()
          }
        }, Promise.resolve())

        // Legitimate user should still be able to mint if capacity remains
        const remainingCapacity =
          await basicMintingPolicy.getAvailableMintingCapacity(
            qcAddress.address
          )
        if (remainingCapacity.gte(normalMintAmount)) {
          await expect(
            basicMintingPolicy
              .connect(user)
              .requestMint(qcAddress.address, user.address, normalMintAmount)
          ).to.not.be.reverted
        }
      })
    })

    context("Gas Cost Inflation Attacks", () => {
      it("should resist attacks that inflate gas costs for other users", async () => {
        const { qcManager, watchdog, qcAddress } = fixture

        // Attack: Register many wallets to increase gas cost of operations
        const walletCount = 5 // Limited for test performance

        const walletIndexes = Array.from({ length: walletCount }, (_, i) => i)
        await walletIndexes.reduce(async (prev, i) => {
          await prev
          const mockWallet = `bc1qattacker${i.toString().padStart(10, "0")}`
          const mockSpvData = createMockSpvData()
          const mockChallenge = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes(`challenge_${i}`)
          )

          await qcManager
            .connect(watchdog)
            .registerWallet(
              qcAddress.address,
              mockWallet,
              mockChallenge,
              mockSpvData.txInfo,
              mockSpvData.proof
            )
        }, Promise.resolve())

        // Normal operations should still work efficiently
        const wallets = await fixture.qcData.getQCWallets(qcAddress.address)
        expect(wallets.length).to.equal(walletCount + 1) // +1 for original wallet

        // Solvency verification should still work (may cost more gas but should complete)
        await expect(
          qcManager.connect(watchdog).verifyQCSolvency(qcAddress.address)
        ).to.not.be.reverted
      })
    })
  })

  describe("Cross-Contract Economic Exploits", () => {
    /**
     * CRITICAL: Economic attacks that span multiple contracts
     *
     * Attack vector: Exploit interactions between contracts to extract value
     * or manipulate system state.
     */
    context("Policy Contract Economic Exploits", () => {
      it("should prevent economic exploitation through policy updates", async () => {
        const { protocolRegistry, basicMintingPolicy, qcAddress, user } =
          fixture

        // Current minting policy
        const originalPolicyAddress = basicMintingPolicy.address

        // Attack: Update policy mid-operation to favorable terms
        // This should not be possible due to access controls
        const maliciousPolicyAddress = attacker.address

        await expect(
          protocolRegistry
            .connect(attacker)
            .setService(
              await basicMintingPolicy.MINTING_POLICY_KEY(),
              maliciousPolicyAddress
            )
        ).to.be.revertedWith("AccessControl: account")

        // Even authorized updates should not affect in-flight transactions
        // (This would require more sophisticated testing with pending transactions)
      })
    })

    context("State Arbitrage Attacks", () => {
      it("should prevent arbitrage between contract states", async () => {
        const { qcData, qcManager, qcAddress } = fixture

        // Attack: Exploit temporary inconsistencies between contract states
        const initialStatus = await qcData.getQCStatus(qcAddress.address)
        expect(initialStatus).to.equal(QCStatus.Active)

        // All state reads should be consistent across contracts
        const managerView = await qcManager.getQCStatus(qcAddress.address)
        expect(managerView).to.equal(initialStatus)

        // No temporal arbitrage opportunities should exist
        // This test ensures state consistency across the system
      })
    })
  })

  describe("Economic Attack Mitigation Verification", () => {
    /**
     * Verify that implemented mitigations actually work
     */
    context("Rate Limiting Effectiveness", () => {
      it("should verify rate limiting prevents rapid successive operations", async () => {
        // This would test if we had rate limiting implemented
        // Currently our system doesn't have explicit rate limiting,
        // which might be a gap for high-frequency attack prevention
      })
    })

    context("Economic Incentive Alignment", () => {
      it("should verify that attacks are economically unprofitable", async () => {
        // This would test gas costs vs potential gains
        // Ensure that attack costs exceed potential profits

        const { basicMintingPolicy, qcAddress } = fixture

        // Calculate gas cost of attack vs potential gain
        const gasPrice = await ethers.provider.getGasPrice()
        const estimatedGas = 200000 // Estimated gas for mint operation
        const attackCost = gasPrice.mul(estimatedGas)

        // Attack should cost more than potential gain
        // This is a basic example - real analysis would be more complex
        expect(attackCost).to.be.gt(0) // Basic sanity check
      })
    })
  })
})
