import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import {
  deployQCRedeemerFixture,
  createTestRedemption,
  TEST_CONSTANTS,
} from "../fixtures/account-control-fixtures"
import { expectCustomError } from "../helpers/error-helpers"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("QCRedeemer - Error Boundaries and Edge Cases", () => {
  describe("Invalid Redemption ID Handling", () => {
    it("should handle empty redemption IDs gracefully", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const emptyRedemptionId = ethers.constants.HashZero

      // Should revert with appropriate error for trusted fulfillment
      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(emptyRedemptionId, 1000000),
        qcRedeemer,
        "InvalidRedemptionId"
      )

      // Should revert with appropriate error for flagging default
      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .flagDefaultedRedemption(
            emptyRedemptionId,
            ethers.utils.formatBytes32String("INVALID")
          ),
        qcRedeemer,
        "InvalidRedemptionId"
      )
    })

    it("should handle non-existent redemption IDs", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const fakeRedemptionId = ethers.utils.id("non-existent-redemption")

      // Should revert indicating redemption was not requested
      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(fakeRedemptionId, 1000000),
        qcRedeemer,
        "RedemptionNotRequested"
      )

      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .flagDefaultedRedemption(
            fakeRedemptionId,
            ethers.utils.formatBytes32String("INVALID")
          ),
        qcRedeemer,
        "RedemptionNotRequested"
      )
    })

    it("should handle malformed redemption ID formats", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      // Test various malformed formats
      const malformedIds = [
        "0x123", // Too short
        ethers.utils.id("valid-but-non-existent"),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("another-fake")),
      ]

      for (const malformedId of malformedIds) {
        await expectCustomError(
          qcRedeemer
            .connect(watchdog)
            .recordRedemptionFulfillmentTrusted(malformedId, 1000000),
          qcRedeemer,
          "RedemptionNotRequested"
        )
      }
    })

    it("should validate redemption ID uniqueness", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer } = fixture

      // Create first redemption
      const { redemptionId: firstId } = await createTestRedemption(fixture)

      // Create second redemption with same parameters (should get different ID)
      const { redemptionId: secondId } = await createTestRedemption(fixture)

      // IDs should be different due to counter increment
      expect(firstId).to.not.equal(secondId)

      // Both should be valid
      const firstRedemption = await qcRedeemer.redemptions(firstId)
      const secondRedemption = await qcRedeemer.redemptions(secondId)

      expect(firstRedemption.status).to.equal(1) // Pending
      expect(secondRedemption.status).to.equal(1) // Pending
    })
  })

  describe("Bitcoin Address Format Edge Cases", () => {
    it("should reject addresses with invalid length", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress } = fixture

      await fixture.qcData.registerQC(
        qcAddress.address,
        TEST_CONSTANTS.LARGE_CAP
      )

      const amount = ethers.BigNumber.from(TEST_CONSTANTS.SMALL_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await fixture.tbtc.mint(user.address, amount)
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, amount)

      const invalidAddresses = [
        "", // Empty
        "1", // Too short
        "1".repeat(100), // Too long
        "3".repeat(100), // Too long P2SH-style
        `bc1${"q".repeat(100)}`, // Too long Bech32
      ]

      for (const invalidAddr of invalidAddresses) {
        if (invalidAddr === "") {
          // Empty address triggers specific error
          await expect(
            qcRedeemer
              .connect(user)
              .initiateRedemption(
                qcAddress.address,
                amount,
                invalidAddr,
                invalidAddr
              )
          ).to.be.revertedWithCustomError(qcRedeemer, "BitcoinAddressRequired")
        } else {
          await expectCustomError(
            qcRedeemer
              .connect(user)
              .initiateRedemption(
                qcAddress.address,
                amount,
                invalidAddr,
                invalidAddr
              ),
            qcRedeemer,
            "InvalidBitcoinAddressFormat"
          )
        }
      }
    })

    it("should reject addresses with invalid prefixes", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress } = fixture

      await fixture.qcData.registerQC(
        qcAddress.address,
        TEST_CONSTANTS.LARGE_CAP
      )

      const amount = ethers.BigNumber.from(TEST_CONSTANTS.SMALL_MINT).mul(
        ethers.BigNumber.from(10).pow(10)
      )

      await fixture.tbtc.mint(user.address, amount)
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, amount)

      const invalidPrefixes = [
        "2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Invalid prefix '2'
        "4A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Invalid prefix '4'
        "bc2qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Invalid bech32 prefix
        "tb2qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Invalid testnet prefix
        "ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Litecoin prefix
      ]

      for (const invalidAddr of invalidPrefixes) {
        await expectCustomError(
          qcRedeemer
            .connect(user)
            .initiateRedemption(
              qcAddress.address,
              amount,
              invalidAddr,
              TEST_CONSTANTS.VALID_LEGACY_BTC
            ),
          qcRedeemer,
          "InvalidBitcoinAddressFormat"
        )
      }
    })

    it("should accept all valid Bitcoin address formats", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress } = fixture

      await fixture.qcData.registerQC(
        qcAddress.address,
        TEST_CONSTANTS.LARGE_CAP
      )

      const validAddresses = [
        "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // P2PKH (Genesis block)
        "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", // P2PKH
        "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // P2SH
        "3QJmV3qfvL9SuYo34YihAf3sRCW3qSinyC", // P2SH
        "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080", // Bech32 P2WPKH
        "bc1qrp33g0554cgvn8t6rt0v2cyzgg6kz5z4vqx8v5w0c8z2jj8r6mjhqxnxnxj", // Bech32 P2WSH
        "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", // Testnet Bech32
        "tb1qrp33g0554cgvn8t6rt0v2cyzgg6kz5z4vqx8v5w0c8z2jj8r6mjhqy9fjqh", // Testnet Bech32 long
      ]

      for (let i = 0; i < validAddresses.length; i++) {
        const validAddr = validAddresses[i]

        const walletAddr =
          validAddresses[Math.min(i, validAddresses.length - 1)]

        // Register wallet for each test
        await fixture.qcData.registerWallet(qcAddress.address, walletAddr)

        const amount = ethers.BigNumber.from(TEST_CONSTANTS.SMALL_MINT).mul(
          ethers.BigNumber.from(10).pow(10)
        )

        await fixture.tbtc.mint(user.address, amount)
        await fixture.tbtc.connect(user).approve(qcRedeemer.address, amount)

        // Should not revert
        const tx = await qcRedeemer
          .connect(user)
          .initiateRedemption(qcAddress.address, amount, validAddr, walletAddr)

        await expect(tx).to.emit(qcRedeemer, "RedemptionRequested")
      }
    })

    it("should validate Bitcoin addresses using standalone function", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer } = fixture

      const testCases = [
        { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", expected: true },
        { address: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", expected: true },
        {
          address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
          expected: true,
        },
        {
          address: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
          expected: true,
        },
        { address: "invalid_address", expected: false },
        { address: "", expected: false },
        {
          address: "0x742d35cc6574d94532f6b3b49e0f2b6aa8b5cd7",
          expected: false,
        },
        { address: "2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", expected: false },
        {
          address: "bc2qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
          expected: false,
        },
      ]

      for (const testCase of testCases) {
        const result = await qcRedeemer.validateBitcoinAddress(testCase.address)
        expect(result).to.equal(
          testCase.expected,
          `Address ${testCase.address} validation failed`
        )
      }
    })
  })

  describe("Amount Conversion Edge Cases", () => {
    it("should handle minimum amount boundaries", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress } = fixture

      await fixture.qcData.registerQC(
        qcAddress.address,
        TEST_CONSTANTS.LARGE_CAP
      )
      const walletAddress = TEST_CONSTANTS.VALID_LEGACY_BTC
      await fixture.qcData.registerWallet(qcAddress.address, walletAddress)

      // Test exact minimum amount
      const minAmount = await fixture.systemState.minMintAmount()
      const minAmountWei = minAmount.mul(ethers.BigNumber.from(10).pow(10))

      await fixture.tbtc.mint(user.address, minAmountWei)
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, minAmountWei)

      // Should work with exact minimum
      const tx = await qcRedeemer
        .connect(user)
        .initiateRedemption(
          qcAddress.address,
          minAmountWei,
          TEST_CONSTANTS.VALID_LEGACY_BTC,
          walletAddress
        )

      await expect(tx).to.emit(qcRedeemer, "RedemptionRequested")

      // Test below minimum
      const belowMinWei = minAmountWei.sub(1)
      await fixture.tbtc.mint(user.address, belowMinWei)
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, belowMinWei)

      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            belowMinWei,
            TEST_CONSTANTS.VALID_LEGACY_BTC,
            walletAddress
          )
      ).to.be.reverted
    })

    it("should handle maximum uint256 amounts gracefully", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, user, qcAddress } = fixture

      await fixture.qcData.registerQC(
        qcAddress.address,
        TEST_CONSTANTS.LARGE_CAP
      )
      const walletAddress = TEST_CONSTANTS.VALID_LEGACY_BTC
      await fixture.qcData.registerWallet(qcAddress.address, walletAddress)

      const maxAmount = ethers.constants.MaxUint256
      await fixture.tbtc.mint(user.address, maxAmount)
      await fixture.tbtc.connect(user).approve(qcRedeemer.address, maxAmount)

      // Should revert due to validation (insufficient balance in mock or overflow)
      await expect(
        qcRedeemer
          .connect(user)
          .initiateRedemption(
            qcAddress.address,
            maxAmount,
            TEST_CONSTANTS.VALID_LEGACY_BTC,
            walletAddress
          )
      ).to.be.reverted
    })

    it("should handle precision in satoshi to wei conversions", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Test various satoshi amounts for fulfillment
      const satoshiAmounts = [
        1, // 1 satoshi
        100, // 100 satoshis
        1000000, // 0.01 BTC
        100000000, // 1 BTC
        2100000000000000, // 21M BTC in satoshis (near max supply)
      ]

      for (let i = 0; i < satoshiAmounts.length; i++) {
        // Create new redemption for each test
        if (i > 0) {
          const { redemptionId: newId } = await createTestRedemption(fixture)
          await qcRedeemer
            .connect(watchdog)
            .recordRedemptionFulfillmentTrusted(newId, satoshiAmounts[i])
        } else {
          await qcRedeemer
            .connect(watchdog)
            .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmounts[i])
        }
      }
    })

    it("should reject zero amounts in fulfillment", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId } = await createTestRedemption(fixture)

      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, 0),
        qcRedeemer,
        "InvalidAmount"
      )
    })

    it("should handle large satoshi amounts in fulfillment", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId } = await createTestRedemption(fixture)

      // Test maximum uint64 value
      const maxUint64 = ethers.BigNumber.from(2).pow(64).sub(1)

      // Should accept large but valid amounts
      const tx = await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(redemptionId, maxUint64)

      await expect(tx).to.emit(qcRedeemer, "RedemptionFulfilled")
    })
  })

  describe("State Validation Edge Cases", () => {
    it("should handle rapid state transitions", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Rapid fulfillment after creation should work
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))

      const tx = await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)

      await expect(tx).to.emit(qcRedeemer, "RedemptionFulfilled")

      // Immediate attempt to fulfill again should fail
      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount),
        qcRedeemer,
        "RedemptionNotPending"
      )
    })

    it("should prevent operations on defaulted redemptions", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Default the redemption
      const reason = ethers.utils.formatBytes32String("TEST_DEFAULT")
      await qcRedeemer
        .connect(watchdog)
        .flagDefaultedRedemption(redemptionId, reason)

      // Cannot fulfill defaulted redemption
      const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount),
        qcRedeemer,
        "RedemptionNotPending"
      )

      // Cannot default again
      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .flagDefaultedRedemption(redemptionId, reason),
        qcRedeemer,
        "RedemptionNotPending"
      )
    })

    it("should handle invalid reason parameters for defaults", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog } = fixture

      const { redemptionId } = await createTestRedemption(fixture)

      // Cannot default with empty reason
      await expectCustomError(
        qcRedeemer
          .connect(watchdog)
          .flagDefaultedRedemption(redemptionId, ethers.constants.HashZero),
        qcRedeemer,
        "InvalidReason"
      )
    })
  })

  describe("Access Control Edge Cases", () => {
    it("should handle role revocation scenarios", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog, deployer } = fixture

      const { redemptionId, amount } = await createTestRedemption(fixture)

      // Initially watchdog can fulfill
      let satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)

      // Create another redemption
      const { redemptionId: secondId, amount: secondAmount } =
        await createTestRedemption(fixture)

      // Revoke role from watchdog
      const disputeArbitrationRole = await qcRedeemer.DISPUTE_ARBITER_ROLE()
      await qcRedeemer
        .connect(deployer)
        .revokeRole(disputeArbitrationRole, watchdog.address)

      // Now watchdog cannot fulfill
      satoshiAmount = secondAmount.div(ethers.BigNumber.from(10).pow(10))
      await expect(
        qcRedeemer
          .connect(watchdog)
          .recordRedemptionFulfillmentTrusted(secondId, satoshiAmount)
      ).to.be.revertedWith(
        `AccessControl: account ${watchdog.address.toLowerCase()} is missing role`
      )
    })

    it("should handle multiple role holders", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog, user2, deployer } = fixture

      // Grant dispute arbiter role to another user
      const disputeArbitrationRole = await qcRedeemer.DISPUTE_ARBITER_ROLE()
      await qcRedeemer
        .connect(deployer)
        .grantRole(disputeArbitrationRole, user2.address)

      const { redemptionId: firstId, amount: firstAmount } =
        await createTestRedemption(fixture)

      const { redemptionId: secondId, amount: secondAmount } =
        await createTestRedemption(fixture)

      // Both should be able to fulfill
      let satoshiAmount = firstAmount.div(ethers.BigNumber.from(10).pow(10))
      await qcRedeemer
        .connect(watchdog)
        .recordRedemptionFulfillmentTrusted(firstId, satoshiAmount)

      satoshiAmount = secondAmount.div(ethers.BigNumber.from(10).pow(10))
      await qcRedeemer
        .connect(user2)
        .recordRedemptionFulfillmentTrusted(secondId, satoshiAmount)

      // Verify both redemptions are fulfilled
      expect((await qcRedeemer.redemptions(firstId)).status).to.equal(2)
      expect((await qcRedeemer.redemptions(secondId)).status).to.equal(2)
    })
  })

  describe("Data Integrity Edge Cases", () => {
    it("should maintain data consistency during concurrent operations", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, watchdog, qcAddress } = fixture

      // Create multiple redemptions
      const redemptions = []
      for (let i = 0; i < 5; i++) {
        const { redemptionId, amount } = await createTestRedemption(fixture)
        redemptions.push({ redemptionId, amount })
      }

      // Verify initial counts
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(5)

      // Fulfill some, default others in mixed order
      const operations = [
        { type: "fulfill", index: 1 },
        { type: "default", index: 3 },
        { type: "fulfill", index: 0 },
        { type: "default", index: 4 },
        { type: "fulfill", index: 2 },
      ]

      for (const op of operations) {
        const { redemptionId, amount } = redemptions[op.index]

        if (op.type === "fulfill") {
          const satoshiAmount = amount.div(ethers.BigNumber.from(10).pow(10))
          await qcRedeemer
            .connect(watchdog)
            .recordRedemptionFulfillmentTrusted(redemptionId, satoshiAmount)
        } else {
          await qcRedeemer
            .connect(watchdog)
            .flagDefaultedRedemption(
              redemptionId,
              ethers.utils.formatBytes32String(`DEFAULT_${op.index}`)
            )
        }
      }

      // Final count should be zero
      expect(
        await qcRedeemer.qcActiveRedemptionCount(qcAddress.address)
      ).to.equal(0)
      expect(await qcRedeemer.hasUnfulfilledRedemptions(qcAddress.address)).to
        .be.false
    })

    it("should handle array bounds correctly", async () => {
      const fixture = await loadFixture(deployQCRedeemerFixture)
      const { qcRedeemer, qcAddress } = fixture

      // Initially no redemptions
      const initialRedemptions = await qcRedeemer.getQCRedemptions(
        qcAddress.address
      )

      expect(initialRedemptions.length).to.equal(0)

      // Add one redemption
      const { redemptionId } = await createTestRedemption(fixture)

      const oneRedemption = await qcRedeemer.getQCRedemptions(qcAddress.address)
      expect(oneRedemption.length).to.equal(1)
      expect(oneRedemption[0]).to.equal(redemptionId)

      // Add many redemptions
      const manyRedemptions = []
      for (let i = 0; i < 10; i++) {
        const { redemptionId: newId } = await createTestRedemption(fixture)
        manyRedemptions.push(newId)
      }

      const allRedemptions = await qcRedeemer.getQCRedemptions(
        qcAddress.address
      )

      expect(allRedemptions.length).to.equal(11) // 1 + 10

      // Verify all IDs are present
      expect(allRedemptions).to.include(redemptionId)
      for (const id of manyRedemptions) {
        expect(allRedemptions).to.include(id)
      }
    })
  })
})
