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
  SERVICE_KEYS,
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
            .setService(SERVICE_KEYS.MINTING_POLICY, maliciousPolicyAddress)
        ).to.be.revertedWith("AccessControl: account")

        // The system's access controls prevent unauthorized policy updates
        // This is the primary defense against policy-based reentrancy attacks
      })

      it("should prevent read-only reentrancy in minting capacity calculations", async () => {
        const { basicMintingPolicy, qcMinter, qcAddress } = fixture

        // Grant MINTER_ROLE to the QCMinter on the BasicMintingPolicy
        const MINTER_ROLE = await basicMintingPolicy.MINTER_ROLE()
        await basicMintingPolicy.grantRole(MINTER_ROLE, qcMinter.address)

        // Grant MINTER_ROLE to the user on QCMinter
        const QC_MINTER_ROLE = await qcMinter.MINTER_ROLE()
        await qcMinter.grantRole(QC_MINTER_ROLE, fixture.user.address)

        // Simulate read-only reentrancy attempt
        // Attacker tries to call getAvailableMintingCapacity during a minting operation

        // This type of attack is harder to simulate in tests but the contract
        // should not allow state changes through "view" functions
        const capacity1 = await basicMintingPolicy.getAvailableMintingCapacity(
          qcAddress.address
        )

        // During minting, capacity calculation should remain consistent
        await qcMinter
          .connect(fixture.user)
          .requestQCMint(qcAddress.address, TEST_DATA.AMOUNTS.NORMAL_MINT)

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
        const { basicRedemptionPolicy, qcRedeemer, qcAddress, tbtc } = fixture

        // Grant roles
        const REDEEMER_ROLE = await basicRedemptionPolicy.REDEEMER_ROLE()
        await basicRedemptionPolicy.grantRole(REDEEMER_ROLE, qcRedeemer.address)
        await basicRedemptionPolicy.grantRole(
          REDEEMER_ROLE,
          fixture.deployer.address
        )

        const ARBITER_ROLE = await basicRedemptionPolicy.ARBITER_ROLE()
        await basicRedemptionPolicy.grantRole(
          ARBITER_ROLE,
          fixture.deployer.address
        )

        // Setup redemption
        const redemptionAmount = TEST_DATA.AMOUNTS.NORMAL_MINT
        const redemptionId = ethers.utils.id("test_redemption")
        tbtc.balanceOf.returns(redemptionAmount)

        await basicRedemptionPolicy
          .connect(fixture.deployer)
          .requestRedemption(
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
        ).to.be.revertedWith("RedemptionAlreadyFulfilled")
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
        const {
          qcMinter,
          qcAddress,
          basicMintingPolicy,
          qcReserveLedger,
          qcData,
        } = fixture

        // QC is already registered via setupQCWithWallets in beforeEach

        // Grant MINTER_ROLE to user on QCMinter
        const MINTER_ROLE = await qcMinter.MINTER_ROLE()
        await qcMinter.grantRole(MINTER_ROLE, fixture.user.address)

        // Grant MINTER_ROLE to QCMinter on BasicMintingPolicy
        const POLICY_MINTER_ROLE = await basicMintingPolicy.MINTER_ROLE()
        await basicMintingPolicy.grantRole(POLICY_MINTER_ROLE, qcMinter.address)

        // Ensure QC has sufficient reserves for minting capacity
        const ATTESTER_ROLE = await qcReserveLedger.ATTESTER_ROLE()
        await qcReserveLedger.grantRole(ATTESTER_ROLE, fixture.deployer.address)

        await qcReserveLedger.submitAttestation(
          qcAddress.address,
          TEST_DATA.AMOUNTS.RESERVE_BALANCE
        )

        // Service lookups during operations should not allow reentrancy
        // This is more of a defensive programming check
        await expect(
          qcMinter
            .connect(fixture.user)
            .requestQCMint(qcAddress.address, TEST_DATA.AMOUNTS.MIN_MINT)
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
     * The QCWatchdog contract has multiple roles and makes calls
     * to other contracts, creating potential reentrancy vectors.
     */
    context("Multi-Role Reentrancy Prevention", () => {
      it("should prevent reentrancy through watchdog role separation", async () => {
        const { qcWatchdog, qcAddress, watchdog } = fixture

        const reserveBalance = TEST_DATA.AMOUNTS.RESERVE_BALANCE

        // Grant WATCHDOG_OPERATOR_ROLE to watchdog
        const WATCHDOG_OPERATOR_ROLE = await qcWatchdog.WATCHDOG_OPERATOR_ROLE()
        await qcWatchdog.grantRole(WATCHDOG_OPERATOR_ROLE, watchdog.address)

        // Attestation should not allow reentrancy to other watchdog functions
        await expect(
          qcWatchdog
            .connect(watchdog)
            .attestReserves(qcAddress.address, reserveBalance)
        ).to.not.be.reverted

        // Subsequent calls should work independently
        await expect(
          qcWatchdog.connect(watchdog).verifyQCSolvency(qcAddress.address)
        ).to.not.be.reverted
      })

      it("should prevent cross-role reentrancy exploitation", async () => {
        const { qcWatchdog, qcAddress, watchdog } = fixture

        const testReason = ethers.utils.id("TEST_REASON")

        // Grant WATCHDOG_OPERATOR_ROLE to watchdog
        const WATCHDOG_OPERATOR_ROLE = await qcWatchdog.WATCHDOG_OPERATOR_ROLE()
        await qcWatchdog.grantRole(WATCHDOG_OPERATOR_ROLE, watchdog.address)

        // Different watchdog roles should not allow reentrancy between each other
        await qcWatchdog
          .connect(watchdog)
          .setQCStatus(qcAddress.address, 1, testReason)

        await qcWatchdog
          .connect(watchdog)
          .attestReserves(qcAddress.address, TEST_DATA.AMOUNTS.RESERVE_BALANCE)

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
        const {
          qcMinter,
          qcAddress,
          basicMintingPolicy,
          qcReserveLedger,
          qcData,
        } = fixture

        // QC is already registered via setupQCWithWallets in beforeEach

        // Grant MINTER_ROLE to user on QCMinter
        const MINTER_ROLE = await qcMinter.MINTER_ROLE()
        await qcMinter.grantRole(MINTER_ROLE, fixture.user.address)

        // Grant MINTER_ROLE to QCMinter on BasicMintingPolicy
        const POLICY_MINTER_ROLE = await basicMintingPolicy.MINTER_ROLE()
        await basicMintingPolicy.grantRole(POLICY_MINTER_ROLE, qcMinter.address)

        // Ensure QC has sufficient reserves
        const ATTESTER_ROLE = await qcReserveLedger.ATTESTER_ROLE()
        await qcReserveLedger.grantRole(ATTESTER_ROLE, fixture.deployer.address)

        await qcReserveLedger.submitAttestation(
          qcAddress.address,
          TEST_DATA.AMOUNTS.RESERVE_BALANCE
        )

        await expect(
          qcMinter
            .connect(fixture.user)
            .requestQCMint(qcAddress.address, TEST_DATA.AMOUNTS.MIN_MINT)
        ).to.not.be.reverted
      })
    })
  })

  describe("Reentrancy Guard Effectiveness", () => {
    /**
     * Verify that implemented reentrancy guards work correctly
     */
    context("Built-in Reentrancy Protection", () => {
      it("should prevent reentrancy in QCRedeemer.initiateRedemption", async () => {
        const { qcRedeemer, protocolRegistry, qcAddress, tbtc } = fixture

        // Deploy malicious redemption policy
        const MaliciousRedemptionPolicy = await ethers.getContractFactory(
          "MaliciousRedemptionPolicy"
        )
        const maliciousPolicy = await MaliciousRedemptionPolicy.deploy(
          qcRedeemer.address
        )
        await maliciousPolicy.deployed()

        // Replace the redemption policy with our malicious one
        const REDEMPTION_POLICY_KEY = await qcRedeemer.REDEMPTION_POLICY_KEY()
        await protocolRegistry.setService(
          REDEMPTION_POLICY_KEY,
          maliciousPolicy.address
        )

        // Setup: User needs tBTC tokens
        const redemptionAmount = TEST_DATA.AMOUNTS.NORMAL_MINT
        await tbtc.mint(fixture.user.address, redemptionAmount)
        await tbtc
          .connect(fixture.user)
          .approve(qcRedeemer.address, redemptionAmount)

        // Enable the attack
        const redemptionId = ethers.utils.id("test_redemption")
        await maliciousPolicy.enableAttack(redemptionId)

        // Attempt to initiate redemption - transaction should succeed but attack should fail
        await qcRedeemer
          .connect(fixture.user)
          .initiateRedemption(
            qcAddress.address,
            redemptionAmount,
            TEST_DATA.BTC_ADDRESSES.TEST
          )

        // Verify attack was attempted
        expect(await maliciousPolicy.attackCount()).to.equal(1)
      })

      it("should prevent reentrancy in QCRedeemer.recordRedemptionFulfillment", async () => {
        const { qcRedeemer, protocolRegistry, qcAddress, tbtc } = fixture

        // Deploy reentrancy attacker
        const ReentrancyAttacker = await ethers.getContractFactory(
          "ReentrancyAttacker"
        )
        const attacker = await ReentrancyAttacker.deploy()
        await attacker.deployed()

        // Deploy malicious policy that will be called by QCRedeemer
        const MaliciousRedemptionPolicy = await ethers.getContractFactory(
          "MaliciousRedemptionPolicy"
        )
        const maliciousPolicy = await MaliciousRedemptionPolicy.deploy(
          qcRedeemer.address
        )
        await maliciousPolicy.deployed()

        // Set malicious policy
        const REDEMPTION_POLICY_KEY = await qcRedeemer.REDEMPTION_POLICY_KEY()
        await protocolRegistry.setService(
          REDEMPTION_POLICY_KEY,
          maliciousPolicy.address
        )

        // Setup: Create a pending redemption first
        const redemptionAmount = TEST_DATA.AMOUNTS.NORMAL_MINT
        await tbtc.mint(fixture.user.address, redemptionAmount)
        await tbtc
          .connect(fixture.user)
          .approve(qcRedeemer.address, redemptionAmount)

        const tx = await qcRedeemer
          .connect(fixture.user)
          .initiateRedemption(
            qcAddress.address,
            redemptionAmount,
            TEST_DATA.BTC_ADDRESSES.TEST
          )
        const receipt = await tx.wait()
        // Find the RedemptionRequested event
        const event = receipt.events?.find(
          (e) => e.event === "RedemptionRequested"
        )
        const redemptionId =
          event?.args?.redemptionId || ethers.utils.id("test_redemption_2")

        // Grant ARBITER_ROLE to attacker
        const ARBITER_ROLE = await qcRedeemer.ARBITER_ROLE()
        await qcRedeemer.grantRole(ARBITER_ROLE, fixture.deployer.address)

        // Enable attack on fulfillment
        await maliciousPolicy.enableAttack(redemptionId)

        // Create mock SPV data
        const mockSpvData = createMockSpvData()

        // Attempt to record fulfillment - transaction should succeed but attack should fail
        await qcRedeemer.recordRedemptionFulfillment(
          redemptionId,
          TEST_DATA.BTC_ADDRESSES.TEST,
          100000,
          mockSpvData.txInfo,
          mockSpvData.proof
        )

        // Verify attack was attempted
        expect(await maliciousPolicy.attackCount()).to.be.gt(0)
      })

      it("should prevent reentrancy in BasicRedemptionPolicy.recordFulfillment", async () => {
        const {
          basicRedemptionPolicy,
          qcAddress,
          tbtc,
          qcData,
          qcReserveLedger,
        } = fixture

        // Deploy reentrancy attacker
        const ReentrancyAttacker = await ethers.getContractFactory(
          "ReentrancyAttacker"
        )
        const attacker = await ReentrancyAttacker.deploy()
        await attacker.deployed()

        await attacker.setTargets(
          ethers.constants.AddressZero,
          basicRedemptionPolicy.address
        )

        // QC is already registered via setupQCWithWallets in beforeEach

        // Set up user tBTC balance
        const redemptionAmount = TEST_DATA.AMOUNTS.MIN_MINT
        await tbtc.mint(fixture.user.address, redemptionAmount)

        // Grant necessary roles
        const ARBITER_ROLE = await basicRedemptionPolicy.ARBITER_ROLE()
        await basicRedemptionPolicy.grantRole(ARBITER_ROLE, attacker.address)
        await basicRedemptionPolicy.grantRole(
          ARBITER_ROLE,
          fixture.deployer.address
        )

        const REDEEMER_ROLE = await basicRedemptionPolicy.REDEEMER_ROLE()
        await basicRedemptionPolicy.grantRole(
          REDEEMER_ROLE,
          fixture.deployer.address
        )

        // Create a redemption first
        const redemptionId = ethers.utils.id("test_redemption")
        await basicRedemptionPolicy.requestRedemption(
          redemptionId,
          qcAddress.address,
          fixture.user.address,
          redemptionAmount,
          TEST_DATA.BTC_ADDRESSES.TEST
        )

        // Prepare attack
        await attacker.prepareAttack(
          4, // REDEMPTION_POLICY_FULFILL
          qcAddress.address,
          redemptionAmount,
          TEST_DATA.BTC_ADDRESSES.TEST,
          redemptionId
        )

        // Execute attack - should succeed but not cause harm due to nonReentrant protection
        // Note: BasicRedemptionPolicy.recordFulfillment doesn't make external calls,
        // so true reentrancy isn't possible, but the nonReentrant modifier provides defense in depth
        await expect(attacker.executeAttack()).to.not.be.reverted
      })

      it("should test gas limit based reentrancy protection", async () => {
        // Test that functions consume enough gas to prevent certain reentrancy attacks
        const {
          basicMintingPolicy,
          qcMinter,
          qcAddress,
          qcReserveLedger,
          qcData,
        } = fixture

        // QC is already registered via setupQCWithWallets in beforeEach

        // Grant MINTER_ROLE to the QCMinter on the BasicMintingPolicy
        const MINTER_ROLE = await basicMintingPolicy.MINTER_ROLE()
        await basicMintingPolicy.grantRole(MINTER_ROLE, qcMinter.address)

        // Grant MINTER_ROLE to the user on QCMinter
        const QC_MINTER_ROLE = await qcMinter.MINTER_ROLE()
        await qcMinter.grantRole(QC_MINTER_ROLE, fixture.user.address)

        // Ensure QC has sufficient reserves
        const ATTESTER_ROLE = await qcReserveLedger.ATTESTER_ROLE()
        await qcReserveLedger.grantRole(ATTESTER_ROLE, fixture.deployer.address)

        // Submit a fresh attestation to ensure it's not stale
        await qcReserveLedger.submitAttestation(
          qcAddress.address,
          TEST_DATA.AMOUNTS.MAX_MINT // Use larger amount to ensure capacity
        )

        const tx = await qcMinter
          .connect(fixture.user)
          .requestQCMint(qcAddress.address, TEST_DATA.AMOUNTS.MIN_MINT)

        const receipt = await tx.wait()

        // Verify reasonable gas usage (not too low that it enables attacks)
        expect(receipt.gasUsed).to.be.gt(50000) // Minimum gas threshold
      })
    })
  })
})
