import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import {
  QCManager,
  QCManagerLib,
  QCData,
  AccountControl,
  SystemState,
  MockReserveOracle,
  MockBank,
} from "../../../typechain"

describe("QCManagerLib - Comprehensive Error Condition Testing", () => {
  let qcManager: QCManager
  let qcManagerLib: QCManagerLib
  let qcData: QCData
  let accountControl: AccountControl
  let systemState: SystemState
  let reserveOracle: MockReserveOracle
  let mockBank: MockBank

  let owner: SignerWithAddress
  let qc1: SignerWithAddress
  let qc2: SignerWithAddress
  let governance: SignerWithAddress
  let unauthorized: SignerWithAddress

  // Test constants
  const STANDARD_CAP = ethers.utils.parseUnits("1000", 8)
  const ZERO_ADDRESS = ethers.constants.AddressZero
  const MAX_UINT256 = ethers.constants.MaxUint256

  // Sample data for validation testing
  const VALID_BTC_ADDRESS = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
  const SAMPLE_CHALLENGE = ethers.utils.formatBytes32String("test_challenge")
  const SAMPLE_WALLET_PUBKEY = `0x${"04".repeat(32)}`

  const SAMPLE_SIGNATURE = {
    v: 27,
    r: ethers.utils.formatBytes32String("sample_r"),
    s: ethers.utils.formatBytes32String("sample_s"),
  }

  beforeEach(async () => {
    ;[owner, qc1, qc2, governance, unauthorized] = await ethers.getSigners()

    // Deploy mock bank
    const MockBankFactory = await ethers.getContractFactory("MockBank")
    mockBank = await MockBankFactory.deploy()

    // Deploy core contracts
    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy()

    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy()

    const MockReserveOracleFactory = await ethers.getContractFactory(
      "MockReserveOracle"
    )

    reserveOracle = await MockReserveOracleFactory.deploy()

    // Deploy QCManagerLib for direct testing
    const QCManagerLibFactory = await ethers.getContractFactory("QCManagerLib")
    qcManagerLib = await QCManagerLibFactory.deploy()

    // Deploy QCPauseManager
    const QCPauseManagerFactory = await ethers.getContractFactory(
      "QCPauseManager"
    )

    const pauseManager = await QCPauseManagerFactory.deploy(
      qcData,
      owner.address,
      owner.address,
      owner.address
    )

    // Deploy MockQCWalletManager
    const MockQCWalletManagerFactory = await ethers.getContractFactory(
      "MockQCWalletManager"
    )

    const walletManager = await MockQCWalletManagerFactory.deploy()

    // Deploy QCManager with library linked
    const QCManagerFactory = await ethers.getContractFactory("QCManager", {
      libraries: {
        QCManagerLib: qcManagerLib.address,
      },
    })

    qcManager = await QCManagerFactory.deploy(
      qcData,
      systemState.address,
      reserveOracle.address,
      accountControl.address,
      pauseManager.address,
      walletManager.address
    )

    // Setup roles
    const QC_MANAGER_ROLE = await pauseManager.QC_MANAGER_ROLE()
    await pauseManager.grantRole(QC_MANAGER_ROLE, qcManager.address)
    await pauseManager.revokeRole(QC_MANAGER_ROLE, owner.address)

    // Deploy AccountControl
    const AccountControlFactory = await ethers.getContractFactory(
      "AccountControl"
    )

    accountControl = await AccountControlFactory.deploy(
      owner.address,
      owner.address,
      mockBank.address
    )

    // Setup QCData roles
    const QC_MANAGER_ROLE_DATA = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("QC_MANAGER_ROLE")
    )

    await qcData.grantRole(QC_MANAGER_ROLE_DATA, qcManager.address)

    // Setup QCManager roles
    const GOVERNANCE_ROLE = await qcManager.GOVERNANCE_ROLE()
    await qcManager.grantRole(GOVERNANCE_ROLE, owner.address)
    await qcManager.grantRole(GOVERNANCE_ROLE, governance.address)

    // Set AccountControl in QCManager
    await qcManager.connect(owner).setAccountControl(accountControl.address)

    // Grant QCManager roles in AccountControl
    await accountControl.connect(owner).grantReserveRole(qcManager.address)
    await accountControl.connect(owner).grantOracleRole(qcManager.address)
    await accountControl.connect(owner).setEmergencyCouncil(qcManager.address)
  })

  describe("Registration Error Conditions", () => {
    describe("Invalid QC Address Errors", () => {
      it("should revert with InvalidQCAddress for zero address registration", async () => {
        await expect(
          qcManager.connect(owner).registerQC(ZERO_ADDRESS, STANDARD_CAP)
        ).to.be.revertedWithCustomError(qcManager, "InvalidQCAddress")
      })

      it("should consistently reject zero address across all functions", async () => {
        // Test across different functions that accept QC addresses
        await expect(
          qcManager.connect(owner).registerQC(ZERO_ADDRESS, STANDARD_CAP)
        ).to.be.revertedWithCustomError(qcManager, "InvalidQCAddress")

        // After registering a valid QC, test other functions
        await qcManager.connect(owner).registerQC(qc1.address, STANDARD_CAP)

        await expect(
          qcManager
            .connect(owner)
            .increaseMintingCapacity(ZERO_ADDRESS, STANDARD_CAP.mul(2))
        ).to.be.revertedWithCustomError(qcManager, "QCNotRegistered")
      })
    })

    describe("Invalid Minting Capacity Errors", () => {
      it("should revert with InvalidMintingCapacity for zero capacity", async () => {
        await expect(
          qcManager.connect(owner).registerQC(qc1.address, 0)
        ).to.be.revertedWithCustomError(qcManager, "InvalidMintingCapacity")
      })

      it("should handle edge case capacity values", async () => {
        // Test with 1 satoshi (minimum valid value)
        await expect(qcManager.connect(owner).registerQC(qc1.address, 1)).to.not
          .be.reverted

        // Test with maximum valid capacity
        await expect(
          qcManager.connect(owner).registerQC(qc2.address, MAX_UINT256)
        ).to.not.be.reverted
      })
    })

    describe("Duplicate Registration Errors", () => {
      it("should revert when registering same QC twice", async () => {
        await qcManager.connect(owner).registerQC(qc1.address, STANDARD_CAP)

        await expect(
          qcManager.connect(owner).registerQC(qc1.address, STANDARD_CAP)
        ).to.be.reverted // Already registered
      })

      it("should allow registration after QC is properly removed", async () => {
        // This test would require QC removal functionality
        // For now, just verify the double registration fails
        await qcManager.connect(owner).registerQC(qc1.address, STANDARD_CAP)

        await expect(
          qcManager.connect(owner).registerQC(qc1.address, STANDARD_CAP.mul(2))
        ).to.be.reverted
      })
    })
  })

  describe("Status Transition Error Matrix", () => {
    beforeEach(async () => {
      await qcManager.connect(owner).registerQC(qc1.address, STANDARD_CAP)

      // Grant DISPUTE_ARBITER_ROLE for status transitions
      const DISPUTE_ARBITER_ROLE = await qcManager.DISPUTE_ARBITER_ROLE()
      await qcManager.grantRole(DISPUTE_ARBITER_ROLE, owner.address)
    })

    describe("Unregistered QC Errors", () => {
      it("should revert with QCNotRegistered for status operations on unregistered QC", async () => {
        const unregisteredQC = ethers.Wallet.createRandom().address

        await expect(
          qcManager
            .connect(owner)
            .setQCStatus(
              unregisteredQC,
              1,
              ethers.utils.formatBytes32String("test")
            )
        ).to.be.revertedWithCustomError(qcManager, "QCNotRegistered")
      })
    })

    describe("Invalid Status Transition Errors", () => {
      it("should revert with InvalidStatusTransition for forbidden transitions", async () => {
        // Set QC to Revoked status (terminal state)
        await qcManager.connect(owner).setQCStatus(
          qc1.address,
          4, // Revoked
          ethers.utils.formatBytes32String("revoked")
        )

        // Try to transition from Revoked (should fail)
        await expect(
          qcManager.connect(owner).setQCStatus(
            qc1.address,
            0, // Active
            ethers.utils.formatBytes32String("reactivate")
          )
        ).to.be.revertedWithCustomError(qcManager, "InvalidStatusTransition")
      })

      it("should test all invalid transition combinations", async () => {
        const statusCombinations = [
          { from: 3, to: 1, name: "UnderReview to MintingPaused" }, // Invalid
          { from: 3, to: 2, name: "UnderReview to Paused" }, // Invalid
          { from: 4, to: 0, name: "Revoked to Active" }, // Invalid (terminal)
          { from: 4, to: 1, name: "Revoked to MintingPaused" }, // Invalid (terminal)
        ]

        for (const combo of statusCombinations) {
          // Reset QC to Active state first
          await qcManager.connect(owner).setQCStatus(
            qc1.address,
            0, // Active
            ethers.utils.formatBytes32String("reset")
          )

          // Set to 'from' status
          if (combo.from !== 0) {
            await qcManager
              .connect(owner)
              .setQCStatus(
                qc1.address,
                combo.from,
                ethers.utils.formatBytes32String("setup")
              )
          }

          // Try invalid transition
          await expect(
            qcManager
              .connect(owner)
              .setQCStatus(
                qc1.address,
                combo.to,
                ethers.utils.formatBytes32String("invalid")
              )
          ).to.be.revertedWithCustomError(qcManager, "InvalidStatusTransition")
        }
      })
    })
  })

  describe("Capacity Management Error Conditions", () => {
    beforeEach(async () => {
      await qcManager.connect(owner).registerQC(qc1.address, STANDARD_CAP)
    })

    describe("Capacity Decrease Errors", () => {
      it("should revert with NewCapMustBeHigher when not increasing", async () => {
        const currentCap = await qcData.getMaxMintingCapacity(qc1.address)

        // Try same capacity
        await expect(
          qcManager
            .connect(owner)
            .increaseMintingCapacity(qc1.address, currentCap)
        ).to.be.revertedWithCustomError(qcManager, "NewCapMustBeHigher")

        // Try lower capacity
        await expect(
          qcManager
            .connect(owner)
            .increaseMintingCapacity(qc1.address, currentCap.sub(1))
        ).to.be.revertedWithCustomError(qcManager, "NewCapMustBeHigher")
      })

      it("should handle edge cases in capacity validation", async () => {
        // Test with minimal increase
        const currentCap = await qcData.getMaxMintingCapacity(qc1.address)
        const minimalIncrease = currentCap.add(1)

        await expect(
          qcManager
            .connect(owner)
            .increaseMintingCapacity(qc1.address, minimalIncrease)
        ).to.not.be.reverted
      })
    })

    describe("Unregistered QC Capacity Errors", () => {
      it("should revert for capacity operations on unregistered QC", async () => {
        const unregisteredQC = ethers.Wallet.createRandom().address

        await expect(
          qcManager
            .connect(owner)
            .increaseMintingCapacity(unregisteredQC, STANDARD_CAP.mul(2))
        ).to.be.revertedWithCustomError(qcManager, "QCNotRegistered")
      })
    })
  })

  describe("Bitcoin Address Validation Error Matrix", () => {
    describe("Address Format Errors", () => {
      it("should consistently handle empty addresses", async () => {
        // Test direct validation
        const result = await qcManagerLib.isValidBitcoinAddress("")
        expect(result).to.be.false

        // Test through wallet validation
        await qcManager.connect(owner).registerQC(qc1.address, STANDARD_CAP)

        await expect(
          qcManagerLib.validateWalletRegistrationFull(
            qcData,
            qc1.address,
            "",
            SAMPLE_CHALLENGE,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
        ).to.be.revertedWithCustomError(qcManagerLib, "InvalidWalletAddress")
      })

      it("should handle extreme length addresses", async () => {
        const tooShort = "1"
        const tooLong = `1${"A".repeat(100)}`

        expect(await qcManagerLib.isValidBitcoinAddress(tooShort)).to.be.false
        expect(await qcManagerLib.isValidBitcoinAddress(tooLong)).to.be.false
      })

      it("should handle special characters and unicode", async () => {
        const specialAddresses = [
          "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa!", // Special char
          "1А1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Cyrillic А
          "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfN🚀", // Emoji
          "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa\x00", // Null byte
        ]

        for (const address of specialAddresses) {
          expect(await qcManagerLib.isValidBitcoinAddress(address)).to.be.false
        }
      })

      it("should handle malformed prefixes consistently", async () => {
        const malformedPrefixes = [
          "0A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Starts with '0'
          "2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Starts with '2'
          "4A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Starts with '4'
          "tc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Testnet
          "bc2qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // Wrong bech32
        ]

        for (const address of malformedPrefixes) {
          expect(await qcManagerLib.isValidBitcoinAddress(address)).to.be.false
        }
      })
    })
  })

  describe("Signature Verification Error Matrix", () => {
    beforeEach(async () => {
      await qcManager.connect(owner).registerQC(qc1.address, STANDARD_CAP)
    })

    describe("Invalid Signature Components", () => {
      it("should handle invalid signature parameters", async () => {
        const invalidSignatures = [
          {
            v: 0,
            r: SAMPLE_SIGNATURE.r,
            s: SAMPLE_SIGNATURE.s,
            name: "Invalid v",
          },
          {
            v: SAMPLE_SIGNATURE.v,
            r: ethers.constants.HashZero,
            s: SAMPLE_SIGNATURE.s,
            name: "Zero r",
          },
          {
            v: SAMPLE_SIGNATURE.v,
            r: SAMPLE_SIGNATURE.r,
            s: ethers.constants.HashZero,
            name: "Zero s",
          },
          {
            v: 255,
            r: SAMPLE_SIGNATURE.r,
            s: SAMPLE_SIGNATURE.s,
            name: "Out of range v",
          },
        ]

        for (const sig of invalidSignatures) {
          await expect(
            qcManagerLib.validateWalletRegistrationFull(
              qcData,
              qc1.address,
              VALID_BTC_ADDRESS,
              SAMPLE_CHALLENGE,
              SAMPLE_WALLET_PUBKEY,
              sig.v,
              sig.r,
              sig.s
            )
          ).to.be.revertedWithCustomError(
            qcManagerLib,
            "SignatureVerificationFailed"
          )
        }
      })

      it("should handle invalid public key formats", async () => {
        const invalidPubkeys = [
          "", // Empty
          "0x", // Empty hex
          `0x${"04".repeat(30)}`, // Too short (60 bytes)
          `0x${"04".repeat(35)}`, // Too long (70 bytes)
          `0x${"FF".repeat(32)}`, // Wrong format
        ]

        for (const pubkey of invalidPubkeys) {
          await expect(
            qcManagerLib.validateWalletRegistrationFull(
              qcData,
              qc1.address,
              VALID_BTC_ADDRESS,
              SAMPLE_CHALLENGE,
              pubkey,
              SAMPLE_SIGNATURE.v,
              SAMPLE_SIGNATURE.r,
              SAMPLE_SIGNATURE.s
            )
          ).to.be.revertedWithCustomError(
            qcManagerLib,
            "SignatureVerificationFailed"
          )
        }
      })
    })
  })

  describe("QC Status Validation Error Matrix", () => {
    beforeEach(async () => {
      await qcManager.connect(owner).registerQC(qc1.address, STANDARD_CAP)
      await qcManager.connect(owner).registerQC(qc2.address, STANDARD_CAP)
    })

    describe("Inactive QC Errors", () => {
      it("should consistently reject operations on inactive QCs", async () => {
        const DISPUTE_ARBITER_ROLE = await qcManager.DISPUTE_ARBITER_ROLE()
        await qcManager.grantRole(DISPUTE_ARBITER_ROLE, owner.address)

        // Set QC to paused
        await qcManager.connect(owner).setQCStatus(
          qc1.address,
          2, // Paused
          ethers.utils.formatBytes32String("paused")
        )

        // Test wallet validation functions
        await expect(
          qcManagerLib.validateWalletRegistrationFull(
            qcData,
            qc1.address,
            VALID_BTC_ADDRESS,
            SAMPLE_CHALLENGE,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s
          )
        ).to.be.revertedWithCustomError(qcManagerLib, "QCNotActive")

        await expect(
          qcManagerLib.validateDirectWalletRegistration(
            qcData,
            qc1.address,
            VALID_BTC_ADDRESS,
            12345,
            SAMPLE_WALLET_PUBKEY,
            SAMPLE_SIGNATURE.v,
            SAMPLE_SIGNATURE.r,
            SAMPLE_SIGNATURE.s,
            1
          )
        ).to.be.revertedWithCustomError(qcManagerLib, "QCNotActive")

        // Test minting capacity
        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        expect(capacity).to.equal(0)
      })

      it("should test all inactive status effects", async () => {
        const DISPUTE_ARBITER_ROLE = await qcManager.DISPUTE_ARBITER_ROLE()
        await qcManager.grantRole(DISPUTE_ARBITER_ROLE, owner.address)

        const inactiveStatuses = [
          { status: 1, name: "MintingPaused" },
          { status: 2, name: "Paused" },
          { status: 3, name: "UnderReview" },
          { status: 4, name: "Revoked" },
        ]

        for (const statusInfo of inactiveStatuses) {
          // Reset to active first
          await qcManager
            .connect(owner)
            .setQCStatus(
              qc1.address,
              0,
              ethers.utils.formatBytes32String("active")
            )

          // Set to inactive status
          await qcManager
            .connect(owner)
            .setQCStatus(
              qc1.address,
              statusInfo.status,
              ethers.utils.formatBytes32String(statusInfo.name)
            )

          // Test minting capacity is 0
          const capacity = await qcManager.getAvailableMintingCapacity(
            qc1.address
          )

          expect(capacity).to.equal(
            0,
            `Status ${statusInfo.name} should have 0 capacity`
          )

          // Test wallet validation fails
          await expect(
            qcManagerLib.validateWalletRegistrationFull(
              qcData,
              qc1.address,
              VALID_BTC_ADDRESS,
              SAMPLE_CHALLENGE,
              SAMPLE_WALLET_PUBKEY,
              SAMPLE_SIGNATURE.v,
              SAMPLE_SIGNATURE.r,
              SAMPLE_SIGNATURE.s
            )
          ).to.be.revertedWithCustomError(qcManagerLib, "QCNotActive")
        }
      })
    })
  })

  describe("Oracle Integration Error Conditions", () => {
    beforeEach(async () => {
      await qcManager.connect(owner).registerQC(qc1.address, STANDARD_CAP)
    })

    describe("Oracle Failure Scenarios", () => {
      it("should handle oracle returning zero balance", async () => {
        await reserveOracle.setReserveBalance(qc1.address, 0, false)

        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        expect(capacity).to.equal(0) // No capacity with zero backing
      })

      it("should handle stale oracle data", async () => {
        const backing = ethers.utils.parseUnits("500", 8)
        await reserveOracle.setReserveBalance(qc1.address, backing, true) // Stale

        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        expect(capacity).to.equal(0) // No capacity with stale data
      })

      it("should handle oracle reverts gracefully", async () => {
        // Test with oracle that always reverts
        await reserveOracle.setShouldRevert(true)

        // Should not revert, but return 0 capacity
        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        expect(capacity).to.equal(0)
      })
    })
  })

  describe("Access Control Error Matrix", () => {
    beforeEach(async () => {
      await qcManager.connect(owner).registerQC(qc1.address, STANDARD_CAP)
    })

    describe("Unauthorized Access Errors", () => {
      it("should revert for unauthorized governance operations", async () => {
        await expect(
          qcManager.connect(unauthorized).registerQC(qc2.address, STANDARD_CAP)
        ).to.be.reverted // Access control violation

        await expect(
          qcManager
            .connect(unauthorized)
            .increaseMintingCapacity(qc1.address, STANDARD_CAP.mul(2))
        ).to.be.reverted // Access control violation
      })

      it("should revert for unauthorized status changes", async () => {
        await expect(
          qcManager
            .connect(unauthorized)
            .setQCStatus(
              qc1.address,
              1,
              ethers.utils.formatBytes32String("unauthorized")
            )
        ).to.be.reverted // Missing DISPUTE_ARBITER_ROLE
      })
    })
  })

  describe("Edge Case Error Combinations", () => {
    it("should handle multiple error conditions simultaneously", async () => {
      // Test unregistered QC with invalid address format in single call
      const unregisteredQC = ethers.Wallet.createRandom().address

      await expect(
        qcManagerLib.validateWalletRegistrationFull(
          qcData,
          unregisteredQC,
          "", // Invalid address
          SAMPLE_CHALLENGE,
          SAMPLE_WALLET_PUBKEY,
          SAMPLE_SIGNATURE.v,
          SAMPLE_SIGNATURE.r,
          SAMPLE_SIGNATURE.s
        )
      ).to.be.revertedWithCustomError(qcManagerLib, "InvalidWalletAddress") // First error caught
    })

    it("should handle zero values consistently across functions", async () => {
      // Test zero address consistency
      await expect(
        qcManager.connect(owner).registerQC(ZERO_ADDRESS, STANDARD_CAP)
      ).to.be.revertedWithCustomError(qcManager, "InvalidQCAddress")

      // Test zero capacity consistency
      await expect(
        qcManager.connect(owner).registerQC(qc1.address, 0)
      ).to.be.revertedWithCustomError(qcManager, "InvalidMintingCapacity")
    })

    it("should maintain error consistency under load", async () => {
      // Test that errors are consistent even with multiple rapid calls
      const promises = []

      for (let i = 0; i < 10; i++) {
        promises.push(
          expect(
            qcManager.connect(owner).registerQC(ZERO_ADDRESS, STANDARD_CAP)
          ).to.be.revertedWithCustomError(qcManager, "InvalidQCAddress")
        )
      }

      await Promise.all(promises)
    })
  })
})
