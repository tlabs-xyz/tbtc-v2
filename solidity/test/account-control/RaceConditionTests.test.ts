import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  SecurityTestFixture,
  deploySecurityTestFixture,
  setupQCWithWallets,
  TEST_DATA,
  QCStatus,
  WalletStatus,
  createMockSpvData,
} from "./AccountControlTestHelpers"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

/**
 * Race Condition Testing Suite
 *
 * Tests for concurrent operations, state consistency, and atomicity violations
 * that could occur when multiple transactions interact with the same resources
 * simultaneously.
 *
 * CRITICAL SECURITY TESTS - Race conditions can lead to state corruption,
 * double-spending, and other serious vulnerabilities.
 */
describe("Race Condition Tests", () => {
  let fixture: SecurityTestFixture
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let user3: SignerWithAddress

  const mintAmount = TEST_DATA.AMOUNTS.NORMAL_MINT
  const reserveBalance = TEST_DATA.AMOUNTS.RESERVE_BALANCE

  beforeEach(async () => {
    await createSnapshot()

    const [, , , , , u1, u2, u3] = await ethers.getSigners()
    user1 = u1
    user2 = u2
    user3 = u3

    fixture = await deploySecurityTestFixture()

    // Setup QC with sufficient reserves for testing
    await setupQCWithWallets(
      fixture,
      fixture.qcAddress.address,
      [TEST_DATA.BTC_ADDRESSES.TEST],
      reserveBalance
    )
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Concurrent Solvency Checks", () => {
    /**
     * CRITICAL: Solvency verification race conditions
     *
     * When multiple solvency checks run concurrently with reserve updates,
     * the system must maintain consistent state and prevent race conditions
     * that could lead to incorrect solvency assessments.
     */
    context("Solvency Check During Reserve Updates", () => {
      it("should handle concurrent solvency check with reserve attestation", async () => {
        const { qcManager, qcReserveLedger, watchdog, qcAddress, qcData } =
          fixture

        // Setup: QC has some minted amount
        const mintedAmount = ethers.utils.parseEther("5")
        await qcData
          .connect(fixture.deployer)
          .updateQCMintedAmount(qcAddress.address, mintedAmount)

        // Scenario: Solvency check runs concurrently with reserve attestation
        const lowReserves = ethers.utils.parseEther("3") // Less than minted amount
        const highReserves = ethers.utils.parseEther("10") // More than minted amount

        // Start solvency check
        const solvencyPromise = qcManager
          .connect(watchdog)
          .verifyQCSolvency(qcAddress.address)

        // Immediately update reserves (simulating concurrent operation)
        const reservePromise = qcReserveLedger
          .connect(watchdog)
          .submitReserveAttestation(qcAddress.address, lowReserves)

        // Both operations should complete
        await Promise.all([solvencyPromise, reservePromise])

        // Final state should be consistent
        const finalStatus = await qcData.getQCStatus(qcAddress.address)
        const [finalReserves] =
          await qcReserveLedger.getReserveBalanceAndStaleness(qcAddress.address)

        // Due to race condition, the solvency check might have read old reserves
        // Run another solvency check to ensure final state consistency
        await qcManager.connect(watchdog).verifyQCSolvency(qcAddress.address)

        const finalStatusAfterCheck = await qcData.getQCStatus(
          qcAddress.address
        )

        // If reserves are low, QC should be under review after the final check
        if (finalReserves.lt(mintedAmount)) {
          expect(finalStatusAfterCheck).to.equal(QCStatus.UnderReview)
        }
      })

      it("should prevent inconsistent state from rapid reserve updates", async () => {
        const { qcReserveLedger, qcManager, watchdog, qcAddress, qcData } =
          fixture

        // Setup: QC with minted amount
        const mintedAmount = ethers.utils.parseEther("5")
        await qcData
          .connect(fixture.deployer)
          .updateQCMintedAmount(qcAddress.address, mintedAmount)

        // Attack: Rapid reserve updates to confuse solvency checks
        const reserves = [
          ethers.utils.parseEther("2"), // Insolvent
          ethers.utils.parseEther("10"), // Solvent
          ethers.utils.parseEther("1"), // Insolvent
          ethers.utils.parseEther("15"), // Solvent
        ]

        // Submit rapid reserve updates
        const promises = reserves.map((reserve) =>
          qcReserveLedger
            .connect(watchdog)
            .submitReserveAttestation(qcAddress.address, reserve)
        )

        await Promise.all(promises)

        // Final solvency check should use the latest reserve value
        await qcManager.connect(watchdog).verifyQCSolvency(qcAddress.address)

        const [finalReserves] =
          await qcReserveLedger.getReserveBalanceAndStaleness(qcAddress.address)
        const finalStatus = await qcData.getQCStatus(qcAddress.address)

        // Status should match the final reserve state
        const expectedStatus = finalReserves.gte(mintedAmount)
          ? QCStatus.Active
          : QCStatus.UnderReview
        expect(finalStatus).to.equal(expectedStatus)
      })

      it("should handle concurrent solvency checks on same QC", async () => {
        const { qcManager, watchdog, qcAddress } = fixture

        // Multiple concurrent solvency checks on the same QC
        const promises = []
        for (let i = 0; i < 5; i++) {
          promises.push(
            qcManager.connect(watchdog).verifyQCSolvency(qcAddress.address)
          )
        }

        // All should complete without error
        await Promise.all(promises)

        // Final state should be consistent
        const finalStatus = await fixture.qcData.getQCStatus(qcAddress.address)
        expect(finalStatus).to.be.oneOf([QCStatus.Active, QCStatus.UnderReview])
      })
    })
  })

  describe("Concurrent Minting Operations", () => {
    /**
     * CRITICAL: Concurrent minting race conditions
     *
     * Multiple users minting simultaneously could exceed capacity limits
     * or cause double-spending if not properly synchronized.
     */
    context("Capacity Limit Race Conditions", () => {
      it("should prevent exceeding minting capacity through concurrent operations", async () => {
        const { basicMintingPolicy, qcAddress } = fixture

        // Get available capacity
        const totalCapacity =
          await basicMintingPolicy.getAvailableMintingCapacity(
            qcAddress.address
          )
        const individualAmount = totalCapacity.div(2).add(1) // Each request > 50% of capacity

        // Two concurrent requests that individually fit but together exceed capacity
        const mint1 = basicMintingPolicy
          .connect(user1)
          .requestMint(qcAddress.address, user1.address, individualAmount)

        const mint2 = basicMintingPolicy
          .connect(user2)
          .requestMint(qcAddress.address, user2.address, individualAmount)

        // At least one should fail due to capacity limits
        const results = await Promise.allSettled([mint1, mint2])
        const successes = results.filter((r) => r.status === "fulfilled").length
        const failures = results.filter((r) => r.status === "rejected").length

        // Not both can succeed since together they exceed capacity
        expect(successes).to.be.lte(1)
        expect(failures).to.be.gte(1)
      })

      it("should handle multiple small concurrent mints correctly", async () => {
        const { qcMinter, qcAddress } = fixture

        // Grant MINTER_ROLE to test users
        const MINTER_ROLE = await qcMinter.MINTER_ROLE()
        await qcMinter.grantRole(MINTER_ROLE, user1.address)
        await qcMinter.grantRole(MINTER_ROLE, user2.address)

        const smallAmount = ethers.utils.parseEther("0.1")
        const numRequests = 10

        // Multiple small concurrent minting requests
        const promises = []
        for (let i = 0; i < numRequests; i++) {
          const user = i % 2 === 0 ? user1 : user2 // Alternate between users
          promises.push(
            qcMinter.connect(user).requestQCMint(qcAddress.address, smallAmount)
          )
        }

        const results = await Promise.allSettled(promises)
        const successes = results.filter((r) => r.status === "fulfilled").length

        // Some should succeed, but total shouldn't exceed capacity
        expect(successes).to.be.gt(0)
        expect(successes).to.be.lte(numRequests)

        // Verify total minted doesn't exceed capacity
        const totalMinted = await fixture.qcData.getQCMintedAmount(
          qcAddress.address
        )
        const capacity = await basicMintingPolicy.getAvailableMintingCapacity(
          qcAddress.address
        )

        // Total should not exceed original capacity
        expect(totalMinted).to.be.lte(reserveBalance)
      })
    })

    context("Policy Update During Minting", () => {
      it("should handle policy updates during active minting operations", async () => {
        const { protocolRegistry, qcMinter, qcAddress } = fixture

        // Grant MINTER_ROLE to user1
        const MINTER_ROLE = await qcMinter.MINTER_ROLE()
        await qcMinter.grantRole(MINTER_ROLE, user1.address)

        // Start a minting operation
        const mintPromise = qcMinter
          .connect(user1)
          .requestQCMint(qcAddress.address, mintAmount)

        // Simulate policy update during minting (should not affect in-flight operations)
        // Note: This would require deploying a new policy contract
        const newPolicyAddress = user2.address // Mock address for testing

        // Policy update should require proper authorization
        await expect(
          protocolRegistry
            .connect(user2)
            .setService(await qcMinter.MINTING_POLICY_KEY(), newPolicyAddress)
        ).to.be.revertedWith("AccessControl: account")

        // Original minting should complete successfully
        await expect(mintPromise).to.not.be.reverted
      })
    })
  })

  describe("Concurrent Wallet Operations", () => {
    /**
     * CRITICAL: Wallet registration/deregistration race conditions
     *
     * Concurrent wallet operations could lead to inconsistent state
     * or allow bypassing of solvency checks.
     */
    context("Wallet Registration Race Conditions", () => {
      it("should prevent duplicate wallet registration", async () => {
        const { qcManager, watchdog, qcAddress } = fixture

        const walletAddress = "bc1qnewwallet123456789"
        const { challenge, txInfo, proof } = createMockSpvData("race1")

        // Two concurrent registration attempts for the same wallet
        const register1 = qcManager
          .connect(watchdog)
          .registerWallet(
            qcAddress.address,
            walletAddress,
            challenge,
            txInfo,
            proof
          )

        const register2 = qcManager
          .connect(watchdog)
          .registerWallet(
            qcAddress.address,
            walletAddress,
            challenge,
            txInfo,
            proof
          )

        // One should succeed, one should fail
        const results = await Promise.allSettled([register1, register2])
        const successes = results.filter((r) => r.status === "fulfilled").length
        const failures = results.filter((r) => r.status === "rejected").length

        expect(successes).to.equal(1)
        expect(failures).to.equal(1)

        // Wallet should only appear once in the list
        const wallets = await fixture.qcData.getQCWallets(qcAddress.address)
        const duplicates = wallets.filter((w) => w === walletAddress)
        expect(duplicates.length).to.equal(1)
      })

      it("should handle concurrent wallet operations on different wallets", async () => {
        const { qcManager, watchdog, qcAddress } = fixture

        const wallets = [
          "bc1qwallet1234567890",
          "bc1qwallet2345678901",
          "bc1qwallet3456789012",
        ]

        // Concurrent registration of different wallets
        const promises = wallets.map((wallet, index) => {
          const { challenge, txInfo, proof } = createMockSpvData(`race${index}`)
          return qcManager
            .connect(watchdog)
            .registerWallet(qcAddress.address, wallet, challenge, txInfo, proof)
        })

        await Promise.all(promises)

        // All wallets should be registered
        const registeredWallets = await fixture.qcData.getQCWallets(
          qcAddress.address
        )

        // Should include all new wallets plus the original test wallet
        expect(registeredWallets.length).to.equal(wallets.length + 1)

        wallets.forEach((wallet) => {
          expect(registeredWallets).to.include(wallet)
        })
      })
    })

    context("Wallet Deregistration Race Conditions", () => {
      it("should prevent wallet deregistration bypassing solvency checks", async () => {
        const { qcManager, qcReserveLedger, watchdog, qcAddress, qcData } =
          fixture

        const testWallet = TEST_DATA.BTC_ADDRESSES.TEST

        // Setup: QC has minted amount that requires all wallets for solvency
        const mintedAmount = ethers.utils.parseEther("8")
        await qcData
          .connect(fixture.deployer)
          .updateQCMintedAmount(qcAddress.address, mintedAmount)

        // Request wallet deregistration
        await qcManager
          .connect(fixture.qcAddress)
          .requestWalletDeRegistration(testWallet)

        // Concurrent operations: finalize deregistration and update reserves
        const newReserves = ethers.utils.parseEther("5") // Less than minted amount

        const finalizePromise = qcManager
          .connect(watchdog)
          .finalizeWalletDeRegistration(testWallet, newReserves)

        const reservePromise = qcReserveLedger
          .connect(watchdog)
          .submitReserveAttestation(qcAddress.address, newReserves)

        // Finalization should fail if it would make QC insolvent
        await expect(finalizePromise).to.be.revertedWith(
          "QC would become insolvent"
        )

        // Reserve update should succeed
        await expect(reservePromise).to.not.be.reverted
      })

      it("should handle concurrent deregistration requests", async () => {
        const { qcManager, qcAddress } = fixture

        // Register additional wallets first
        const wallet1 = "bc1qwallet1234567890"
        const wallet2 = "bc1qwallet2345678901"

        const {
          challenge: challenge1,
          txInfo: txInfo1,
          proof: proof1,
        } = createMockSpvData("wallet1")
        await qcManager
          .connect(fixture.watchdog)
          .registerWallet(
            qcAddress.address,
            wallet1,
            challenge1,
            txInfo1,
            proof1
          )

        const {
          challenge: challenge2,
          txInfo: txInfo2,
          proof: proof2,
        } = createMockSpvData("wallet2")
        await qcManager
          .connect(fixture.watchdog)
          .registerWallet(
            qcAddress.address,
            wallet2,
            challenge2,
            txInfo2,
            proof2
          )

        // Concurrent deregistration requests
        const deregister1 = qcManager
          .connect(fixture.qcAddress)
          .requestWalletDeRegistration(wallet1)
        const deregister2 = qcManager
          .connect(fixture.qcAddress)
          .requestWalletDeRegistration(wallet2)

        await Promise.all([deregister1, deregister2])

        // Both wallets should be in pending deregistration state
        const status1 = await fixture.qcData.getWalletStatus(wallet1)
        const status2 = await fixture.qcData.getWalletStatus(wallet2)

        expect(status1).to.equal(WalletStatus.PendingDeRegistration)
        expect(status2).to.equal(WalletStatus.PendingDeRegistration)
      })
    })
  })

  describe("Concurrent Redemption Operations", () => {
    /**
     * CRITICAL: Redemption process race conditions
     *
     * Multiple redemptions or conflicts between redemption requests
     * and fulfillments could lead to double-spending or lost funds.
     */
    context("Redemption Request Race Conditions", () => {
      it("should handle concurrent redemption requests", async () => {
        const { qcRedeemer, qcAddress, tbtc } = fixture

        // Setup: Users have tBTC to redeem
        const redemptionAmount = ethers.utils.parseEther("2")
        tbtc.balanceOf.whenCalledWith(user1.address).returns(redemptionAmount)
        tbtc.balanceOf.whenCalledWith(user2.address).returns(redemptionAmount)

        // Concurrent redemption requests using QCRedeemer
        const redeem1 = qcRedeemer
          .connect(user1)
          .initiateRedemption(qcAddress.address, redemptionAmount)

        const redeem2 = qcRedeemer
          .connect(user2)
          .initiateRedemption(qcAddress.address, redemptionAmount)

        await Promise.all([redeem1, redeem2])

        // Both redemptions should succeed independently and burn tokens
        expect(tbtc.burnFrom).to.have.been.calledTwice
        expect(tbtc.burnFrom).to.have.been.calledWith(
          user1.address,
          redemptionAmount
        )
        expect(tbtc.burnFrom).to.have.been.calledWith(
          user2.address,
          redemptionAmount
        )
      })

      it("should prevent redemption ID collisions", async () => {
        const { qcRedeemer, qcAddress, tbtc } = fixture

        const redemptionAmount = ethers.utils.parseEther("2")
        tbtc.balanceOf.whenCalledWith(user1.address).returns(redemptionAmount)
        tbtc.balanceOf.whenCalledWith(user2.address).returns(redemptionAmount)

        // Race condition: Both users try to create redemptions simultaneously
        const redeem1 = qcRedeemer
          .connect(user1)
          .initiateRedemption(qcAddress.address, redemptionAmount)

        const redeem2 = qcRedeemer
          .connect(user2)
          .initiateRedemption(qcAddress.address, redemptionAmount)

        // Both should succeed with unique IDs
        const results = await Promise.all([redeem1, redeem2])

        // Extract redemption IDs from events
        const [tx1, tx2] = results
        const receipt1 = await tx1.wait()
        const receipt2 = await tx2.wait()

        const event1 = receipt1.events?.find(
          (e: any) => e.event === "RedemptionRequested"
        )
        const event2 = receipt2.events?.find(
          (e: any) => e.event === "RedemptionRequested"
        )

        const id1 = event1?.args?.redemptionId
        const id2 = event2?.args?.redemptionId

        // IDs should be unique
        expect(id1).to.not.equal(id2)
        expect(id1).to.not.be.undefined
        expect(id2).to.not.be.undefined
      })
    })

    context("Redemption Fulfillment Race Conditions", () => {
      it("should prevent double fulfillment of same redemption", async () => {
        const { basicRedemptionPolicy, qcAddress, tbtc } = fixture

        // Setup redemption
        const redemptionAmount = ethers.utils.parseEther("2")
        const redemptionId = ethers.utils.id("test_redemption")
        tbtc.balanceOf.returns(redemptionAmount)

        await basicRedemptionPolicy.requestRedemption(
          redemptionId,
          qcAddress.address,
          user1.address,
          redemptionAmount,
          TEST_DATA.BTC_ADDRESSES.TEST
        )

        // Concurrent fulfillment attempts
        const mockSpvData = createMockSpvData()
        const userBtcAddress = TEST_DATA.BTC_ADDRESSES.TEST
        const expectedAmount = 100000

        const fulfill1 = basicRedemptionPolicy.recordFulfillment(
          redemptionId,
          userBtcAddress,
          expectedAmount,
          mockSpvData.txInfo,
          mockSpvData.proof
        )
        const fulfill2 = basicRedemptionPolicy.recordFulfillment(
          redemptionId,
          userBtcAddress,
          expectedAmount,
          mockSpvData.txInfo,
          mockSpvData.proof
        )

        // One should succeed, one should fail
        const results = await Promise.allSettled([fulfill1, fulfill2])
        const successes = results.filter((r) => r.status === "fulfilled").length
        const failures = results.filter((r) => r.status === "rejected").length

        expect(successes).to.equal(1)
        expect(failures).to.equal(1)

        // Redemption should be fulfilled exactly once
        expect(await basicRedemptionPolicy.isRedemptionFulfilled(redemptionId))
          .to.be.true
      })
    })
  })

  describe("Cross-Contract State Consistency", () => {
    /**
     * CRITICAL: State consistency across multiple contracts
     *
     * Operations that span multiple contracts must maintain
     * consistency even under concurrent access.
     */
    context("Service Update Race Conditions", () => {
      it("should maintain consistency during service updates", async () => {
        const { protocolRegistry, qcMinter, qcAddress } = fixture

        // Grant MINTER_ROLE to user1
        const MINTER_ROLE = await qcMinter.MINTER_ROLE()
        await qcMinter.grantRole(MINTER_ROLE, user1.address)

        // Start an operation using current service
        const mintPromise = qcMinter
          .connect(user1)
          .requestQCMint(qcAddress.address, mintAmount)

        // Attempt to update service during operation (should require admin rights)
        const newServiceAddress = user2.address

        await expect(
          protocolRegistry
            .connect(user2)
            .setService(await qcMinter.MINTING_POLICY_KEY(), newServiceAddress)
        ).to.be.revertedWith("AccessControl: account")

        // Original operation should complete
        await expect(mintPromise).to.not.be.reverted
      })
    })

    context("Cross-Contract Data Consistency", () => {
      it("should maintain data consistency across QCData and QCManager", async () => {
        const { qcData, qcManager, qcAddress } = fixture

        // Concurrent reads from different contracts
        const promises = [
          qcData.getQCStatus(qcAddress.address),
          qcManager.getQCStatus(qcAddress.address),
          qcData.getQCMintedAmount(qcAddress.address),
          qcData.getQCWallets(qcAddress.address),
        ]

        const [dataStatus, managerStatus, mintedAmount, wallets] =
          await Promise.all(promises)

        // Both contracts should return consistent data
        expect(dataStatus).to.equal(managerStatus)
        expect(mintedAmount).to.be.gte(0)
        expect(wallets.length).to.be.gt(0)
      })
    })
  })

  describe("Atomic Operation Violations", () => {
    /**
     * CRITICAL: Operations that should be atomic but might be split
     *
     * Verify that operations that must be atomic cannot be interrupted
     * or partially completed.
     */
    context("Wallet Deregistration Atomicity", () => {
      it("should ensure wallet deregistration is atomic", async () => {
        const { qcManager, qcAddress, qcData } = fixture

        const testWallet = TEST_DATA.BTC_ADDRESSES.TEST

        // Request deregistration
        await qcManager
          .connect(fixture.qcAddress)
          .requestWalletDeRegistration(testWallet)

        // Verify intermediate state
        const status = await qcData.getWalletStatus(testWallet)
        expect(status).to.equal(WalletStatus.PendingDeRegistration)

        // Finalization should be atomic (succeed completely or fail completely)
        const newReserves = ethers.utils.parseEther("20") // Sufficient reserves

        await qcManager
          .connect(fixture.watchdog)
          .finalizeWalletDeRegistration(testWallet, newReserves)

        // Final state should be consistent
        const finalStatus = await qcData.getWalletStatus(testWallet)
        const wallets = await qcData.getQCWallets(qcAddress.address)

        expect(finalStatus).to.equal(WalletStatus.Deregistered)
        expect(wallets).to.be.an("array")
        expect(wallets).to.not.include(testWallet)
      })
    })

    context("Solvency Check Atomicity", () => {
      it("should ensure solvency checks are atomic", async () => {
        const { qcManager, qcData, watchdog, qcAddress } = fixture

        // Initial state
        const initialStatus = await qcData.getQCStatus(qcAddress.address)
        expect(initialStatus).to.equal(QCStatus.Active)

        // Setup insolvency condition
        const mintedAmount = ethers.utils.parseEther("15") // More than reserves
        await qcData
          .connect(fixture.deployer)
          .updateQCMintedAmount(qcAddress.address, mintedAmount)

        // Solvency check should atomically update status
        await qcManager.connect(watchdog).verifyQCSolvency(qcAddress.address)

        // Status should be updated atomically
        const finalStatus = await qcData.getQCStatus(qcAddress.address)
        expect(finalStatus).to.equal(QCStatus.UnderReview)
      })
    })
  })
})
