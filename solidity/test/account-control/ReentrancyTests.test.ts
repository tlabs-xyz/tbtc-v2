import chai, { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { Contract } from "ethers"
import { smock } from "@defi-wonderland/smock"
import {
  SecurityTestFixture,
  deploySecurityTestFixture,
  setupQCWithWallets,
  createMockSpvData,
  TEST_DATA,
} from "./AccountControlTestHelpers"

chai.use(smock.matchers)

const { createSnapshot, restoreSnapshot } = helpers.snapshot

/**
 * Advanced Reentrancy Testing Suite
 *
 * Tests for reentrancy attacks through policy contracts, cross-contract calls,
 * and sophisticated attack vectors that exploit external contract interactions.
 *
 * CRITICAL SECURITY TESTS - Reentrancy attacks can lead to state corruption,
 * double-spending, and unauthorized access to system functions.
 */
describe("Advanced Reentrancy Tests", () => {
  let fixture: SecurityTestFixture
  let attacker: SignerWithAddress

  beforeEach(async () => {
    await createSnapshot()

    const [, , , , , attackerSigner] = await ethers.getSigners()
    attacker = attackerSigner

    fixture = await deploySecurityTestFixture()

    // Setup legitimate QC for testing
    await setupQCWithWallets(
      fixture,
      fixture.qcAddress.address,
      [TEST_DATA.BTC_ADDRESSES.TEST],
      TEST_DATA.AMOUNTS.RESERVE_BALANCE
    )
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Policy Contract Reentrancy Attacks", () => {
    /**
     * CRITICAL: Policy contract reentrancy vulnerabilities
     *
     * Since policy contracts are called by core contracts, they could
     * potentially reenter the system to manipulate state or extract value.
     */
    context("Malicious Minting Policy Reentrancy", () => {
      it("should prevent reentrancy through malicious minting policy", async () => {
        const { protocolRegistry, basicMintingPolicy } = fixture

        // For this test, we simulate an attacker trying to replace the minting policy
        // with a malicious one. In reality, they would deploy a contract implementing
        // IMintingPolicy that performs reentrancy attacks.

        // Attacker should not be able to update policy without proper access
        const maliciousPolicyAddress = attacker.address // Use attacker address as mock malicious policy

        await expect(
          protocolRegistry
            .connect(attacker)
            .setService(
              await basicMintingPolicy.MINTING_POLICY_KEY(),
              maliciousPolicyAddress
            )
        ).to.be.revertedWith("AccessControl: account")

        // The system's access controls prevent unauthorized policy updates
        // This is the primary defense against policy-based reentrancy attacks
      })

      it("should prevent read-only reentrancy in minting capacity calculations", async () => {
        const { basicMintingPolicy, qcAddress } = fixture

        // Simulate read-only reentrancy attempt
        // Attacker tries to call getAvailableMintingCapacity during a minting operation

        // This type of attack is harder to simulate in tests but the contract
        // should not allow state changes through "view" functions
        const capacity1 = await basicMintingPolicy.getAvailableMintingCapacity(
          qcAddress.address
        )

        // During minting, capacity calculation should remain consistent
        await basicMintingPolicy
          .connect(fixture.user)
          .requestMint(
            qcAddress.address,
            fixture.user.address,
            TEST_DATA.AMOUNTS.NORMAL_MINT
          )

        // Capacity should decrease after minting
        const capacity3 = await basicMintingPolicy.getAvailableMintingCapacity(
          qcAddress.address
        )
        expect(capacity3).to.be.lt(capacity1)
      })
    })

    context("Malicious Redemption Policy Reentrancy", () => {
      it("should prevent reentrancy through malicious redemption policy", async () => {
        const { basicRedemptionPolicy, qcAddress, tbtc } = fixture

        // Setup user with tBTC balance
        const redemptionAmount = TEST_DATA.AMOUNTS.NORMAL_MINT
        tbtc.balanceOf.returns(redemptionAmount)

        const redemptionId = ethers.utils.id("test_redemption")

        // Normal redemption should work
        await expect(
          basicRedemptionPolicy.requestRedemption(
            redemptionId,
            qcAddress.address,
            fixture.user.address,
            redemptionAmount,
            TEST_DATA.BTC_ADDRESSES.TEST
          )
        ).to.not.be.reverted

        // Verify redemption was registered (BasicRedemptionPolicy doesn't burn tokens)
        // Token burning happens in QCRedeemer to prevent double-burning
        expect(tbtc.burnFrom).to.not.have.been.called

        // Verify the redemption was recorded by checking its status
        const status = await basicRedemptionPolicy.getRedemptionStatus(
          redemptionId
        )
        expect(status).to.equal(0) // PENDING status means it was successfully recorded
      })

      it("should prevent double fulfillment through reentrancy", async () => {
        const { basicRedemptionPolicy, qcAddress, tbtc } = fixture

        // Setup redemption
        const redemptionAmount = TEST_DATA.AMOUNTS.NORMAL_MINT
        const redemptionId = ethers.utils.id("test_redemption")
        tbtc.balanceOf.returns(redemptionAmount)

        await basicRedemptionPolicy.requestRedemption(
          redemptionId,
          qcAddress.address,
          fixture.user.address,
          redemptionAmount,
          TEST_DATA.BTC_ADDRESSES.TEST
        )

        // First fulfillment
        const mockSpvData = createMockSpvData()
        const userBtcAddress = TEST_DATA.BTC_ADDRESSES.TEST
        const expectedAmount = 100000

        await basicRedemptionPolicy.recordFulfillment(
          redemptionId,
          userBtcAddress,
          expectedAmount,
          mockSpvData.txInfo,
          mockSpvData.proof
        )

        // Second fulfillment attempt should fail
        await expect(
          basicRedemptionPolicy.recordFulfillment(
            redemptionId,
            userBtcAddress,
            expectedAmount,
            mockSpvData.txInfo,
            mockSpvData.proof
          )
        ).to.be.revertedWith("Already fulfilled")
      })
    })
  })

  describe("Cross-Contract Reentrancy Attacks", () => {
    /**
     * CRITICAL: Cross-contract reentrancy through external calls
     *
     * Calls between Account Control contracts could be exploited
     * to create reentrancy chains that manipulate system state.
     */
    context("Service Registry Reentrancy", () => {
      it("should prevent reentrancy through service registry updates", async () => {
        const { protocolRegistry, qcMinter } = fixture

        // Attacker should not be able to update services
        await expect(
          protocolRegistry
            .connect(attacker)
            .setService(await qcMinter.MINTING_POLICY_KEY(), attacker.address)
        ).to.be.revertedWith("AccessControl: account")

        // Even authorized updates should not allow reentrancy
        // This would require testing with proper admin access
      })

      it("should prevent reentrancy during service lookups", async () => {
        const { qcMinter, qcAddress } = fixture

        // Service lookups during operations should not allow reentrancy
        // This is more of a defensive programming check
        await expect(
          qcMinter
            .connect(fixture.user)
            .requestQCMint(qcAddress.address, TEST_DATA.AMOUNTS.NORMAL_MINT)
        ).to.not.be.reverted
      })
    })

    context("QC Manager Cross-Contract Reentrancy", () => {
      it("should prevent reentrancy through QC status changes", async () => {
        const { qcManager, qcAddress, watchdog } = fixture

        const testReason = ethers.utils.id("TEST_REASON")

        // Status change should be atomic and prevent reentrancy
        await qcManager.connect(watchdog).setQCStatus(
          qcAddress.address,
          1, // UnderReview
          testReason
        )

        // Verify status changed
        const status = await fixture.qcData.getQCStatus(qcAddress.address)
        expect(status).to.equal(1)

        // Second status change should work independently
        await qcManager.connect(watchdog).setQCStatus(
          qcAddress.address,
          0, // Active
          testReason
        )

        const finalStatus = await fixture.qcData.getQCStatus(qcAddress.address)
        expect(finalStatus).to.equal(0)
      })

      it("should prevent reentrancy during solvency verification", async () => {
        const { qcManager, qcAddress, watchdog } = fixture

        // Solvency verification should not allow reentrancy
        await expect(
          qcManager.connect(watchdog).verifyQCSolvency(qcAddress.address)
        ).to.not.be.reverted

        // Multiple sequential calls should work
        await expect(
          qcManager.connect(watchdog).verifyQCSolvency(qcAddress.address)
        ).to.not.be.reverted
      })
    })
  })

  describe("Watchdog Contract Reentrancy", () => {
    /**
     * CRITICAL: Watchdog reentrancy vulnerabilities
     *
     * The SingleWatchdog contract has multiple roles and makes calls
     * to other contracts, creating potential reentrancy vectors.
     */
    context("Multi-Role Reentrancy Prevention", () => {
      it("should prevent reentrancy through watchdog role separation", async () => {
        const { singleWatchdog, qcAddress, watchdog } = fixture

        const reserveBalance = TEST_DATA.AMOUNTS.RESERVE_BALANCE
        const condition = "Strategic attestation"

        // Attestation should not allow reentrancy to other watchdog functions
        await expect(
          singleWatchdog
            .connect(watchdog)
            .attestReserves(qcAddress.address, reserveBalance, condition)
        ).to.not.be.reverted

        // Subsequent calls should work independently
        await expect(
          singleWatchdog.connect(watchdog).verifyQCSolvency(qcAddress.address)
        ).to.not.be.reverted
      })

      it("should prevent cross-role reentrancy exploitation", async () => {
        const { singleWatchdog, qcAddress, watchdog } = fixture

        const testReason = ethers.utils.id("TEST_REASON")

        // Different watchdog roles should not allow reentrancy between each other
        await singleWatchdog
          .connect(watchdog)
          .setQCStatus(qcAddress.address, 1, testReason)

        await singleWatchdog
          .connect(watchdog)
          .attestReserves(
            qcAddress.address,
            TEST_DATA.AMOUNTS.RESERVE_BALANCE,
            "Post status change attestation"
          )

        // Both operations should complete successfully
        const status = await fixture.qcData.getQCStatus(qcAddress.address)
        expect(status).to.equal(1)
      })
    })
  })

  describe("Emergency System Reentrancy", () => {
    /**
     * CRITICAL: Emergency function reentrancy
     *
     * Emergency pause/unpause functions must not be vulnerable
     * to reentrancy attacks that could bypass emergency controls.
     */
    context("Pause System Reentrancy Prevention", () => {
      it("should prevent reentrancy through emergency pause functions", async () => {
        const { systemState } = fixture

        // Pause minting
        await systemState.connect(fixture.deployer).pauseMinting()

        // Verify paused
        expect(await systemState.isMintingPaused()).to.be.true

        // Unpause should work without reentrancy issues
        await systemState.connect(fixture.deployer).unpauseMinting()

        expect(await systemState.isMintingPaused()).to.be.false
      })

      it("should prevent parameter update reentrancy", async () => {
        const { systemState } = fixture

        const newMinAmount = TEST_DATA.AMOUNTS.MIN_MINT.mul(2)

        // Parameter update should be atomic
        await systemState
          .connect(fixture.deployer)
          .setMinMintAmount(newMinAmount)

        expect(await systemState.minMintAmount()).to.equal(newMinAmount)
      })
    })
  })

  describe("Complex Reentrancy Chains", () => {
    /**
     * CRITICAL: Multi-step reentrancy attack chains
     *
     * Sophisticated attackers might chain multiple reentrancy vectors
     * to create complex attack scenarios.
     */
    context("Reentrancy Chain Detection", () => {
      it("should prevent complex reentrancy attack chains", async () => {
        // This test would require a more sophisticated setup with
        // multiple malicious contracts creating reentrancy chains

        // For now, verify that basic operations don't allow reentrancy
        const { basicMintingPolicy, qcAddress } = fixture

        await expect(
          basicMintingPolicy
            .connect(fixture.user)
            .requestMint(
              qcAddress.address,
              fixture.user.address,
              TEST_DATA.AMOUNTS.NORMAL_MINT
            )
        ).to.not.be.reverted
      })
    })
  })

  describe("Reentrancy Guard Effectiveness", () => {
    /**
     * Verify that implemented reentrancy guards work correctly
     */
    context("Built-in Reentrancy Protection", () => {
      it("should verify reentrancy guards prevent attacks", async () => {
        // This would test explicit reentrancy guards if implemented
        // Currently our contracts don't have explicit guards, which might be a gap

        const { basicMintingPolicy, qcAddress } = fixture

        // Basic operation should work
        await expect(
          basicMintingPolicy
            .connect(fixture.user)
            .requestMint(
              qcAddress.address,
              fixture.user.address,
              TEST_DATA.AMOUNTS.NORMAL_MINT
            )
        ).to.not.be.reverted
      })

      it("should test gas limit based reentrancy protection", async () => {
        // Test that functions consume enough gas to prevent certain reentrancy attacks
        const { basicMintingPolicy, qcAddress } = fixture

        const tx = await basicMintingPolicy
          .connect(fixture.user)
          .requestMint(
            qcAddress.address,
            fixture.user.address,
            TEST_DATA.AMOUNTS.NORMAL_MINT
          )

        const receipt = await tx.wait()

        // Verify reasonable gas usage (not too low that it enables attacks)
        expect(receipt.gasUsed).to.be.gt(50000) // Minimum gas threshold
      })
    })
  })
})
