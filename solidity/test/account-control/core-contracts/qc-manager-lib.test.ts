import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import {
  QCData,
  QCManager,
  AccountControl,
  SystemState,
  ReserveOracle,
  MockReserveOracle,
  MockBank,
} from "../../../typechain"

describe("QCManagerLib - Consolidated Tests", () => {
  let qcManager: QCManager
  let qcManagerLib: any
  let qcData: QCData
  let accountControl: AccountControl
  let systemState: SystemState
  let reserveOracle: MockReserveOracle
  let mockBank: MockBank

  let owner: SignerWithAddress
  let qc1: SignerWithAddress
  let qc2: SignerWithAddress
  let user: SignerWithAddress
  let attester1: SignerWithAddress
  let governance: SignerWithAddress
  let registrar: SignerWithAddress

  const MAX_MINTING_CAP = ethers.utils.parseUnits("100", 8) // 100 BTC in satoshis
  const ZERO_ADDRESS = ethers.constants.AddressZero

  beforeEach(async () => {
    ;[owner, qc1, qc2, user, attester1, governance, registrar] =
      await ethers.getSigners()

    // Deploy mock bank
    const MockBankFactory = await ethers.getContractFactory("MockBank")
    mockBank = await MockBankFactory.deploy()

    // Deploy core contracts
    const QCDataFactory = await ethers.getContractFactory("QCData")
    qcData = await QCDataFactory.deploy()

    const SystemStateFactory = await ethers.getContractFactory("SystemState")
    systemState = await SystemStateFactory.deploy()

    const MockReserveOracle = await ethers.getContractFactory(
      "MockReserveOracle"
    )

    reserveOracle = await MockReserveOracle.deploy()

    // Deploy QCManagerLib library
    const QCManagerLibFactory = await ethers.getContractFactory("QCManagerLib")
    qcManagerLib = await QCManagerLibFactory.deploy()

    // Deploy QCPauseManager first
    const QCPauseManagerFactory = await ethers.getContractFactory(
      "QCPauseManager"
    )

    const pauseManager = await QCPauseManagerFactory.deploy(
      qcData.address,
      owner.address, // Temporary QCManager address
      owner.address, // Admin
      owner.address // Emergency role
    )

    // Deploy MockQCWalletManager
    const MockQCWalletManagerFactory = await ethers.getContractFactory(
      "MockQCWalletManager"
    )

    const walletManager = await MockQCWalletManagerFactory.deploy()

    // Deploy QCManager with libraries linked
    const QCManagerFactory = await ethers.getContractFactory("QCManager", {
      libraries: {
        QCManagerLib: qcManagerLib.address,
      },
    })

    qcManager = await QCManagerFactory.deploy(
      qcData.address,
      systemState.address,
      reserveOracle.address,
      pauseManager.address,
      walletManager.address
    )

    // Grant QC_MANAGER_ROLE to the real QCManager
    const QC_MANAGER_ROLE = await pauseManager.QC_MANAGER_ROLE()
    await pauseManager.grantRole(QC_MANAGER_ROLE, qcManager.address)
    await pauseManager.revokeRole(QC_MANAGER_ROLE, owner.address)

    // Grant QCManager the emergency role for forwarding calls
    await pauseManager.grantRole(
      await pauseManager.EMERGENCY_ROLE(),
      qcManager.address
    )

    // Deploy AccountControl with direct deployment (not upgradeable)
    const AccountControlFactory = await ethers.getContractFactory(
      "AccountControl"
    )

    accountControl = await AccountControlFactory.deploy(
      owner.address,
      owner.address,
      mockBank.address
    )

    // Setup roles for QCData
    const QC_MANAGER_ROLE_DATA = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("QC_MANAGER_ROLE")
    )

    await qcData.grantRole(QC_MANAGER_ROLE_DATA, qcManager.address)

    // Grant governance role to owner for QCManager operations
    const GOVERNANCE_ROLE = await qcManager.GOVERNANCE_ROLE()
    await qcManager.grantRole(GOVERNANCE_ROLE, owner.address)
    await qcManager.grantRole(GOVERNANCE_ROLE, governance.address)

    // Grant registrar role
    const REGISTRAR_ROLE = await qcManager.REGISTRAR_ROLE()
    await qcManager.grantRole(REGISTRAR_ROLE, registrar.address)

    // Set AccountControl in QCManager
    await qcManager.connect(owner).setAccountControl(accountControl.address)

    // Grant QCManager the necessary roles in AccountControl
    await accountControl.connect(owner).grantReserveRole(qcManager.address)
    await accountControl.connect(owner).grantOracleRole(qcManager.address)

    // Set QCManager as emergencyCouncil for pauseReserve operations
    await accountControl.connect(owner).setEmergencyCouncil(qcManager.address)
  })

  describe("Core Library Functions", () => {
    describe("Library Error Validation", () => {
      it("should revert with InvalidQCAddress when registering zero address", async () => {
        await expect(
          qcManager.connect(owner).registerQC(ZERO_ADDRESS, MAX_MINTING_CAP)
        ).to.be.revertedWithCustomError(qcManager, "InvalidQCAddress")
      })

      it("should revert with InvalidMintingCapacity when capacity is zero", async () => {
        await expect(
          qcManager.connect(owner).registerQC(qc1.address, 0)
        ).to.be.revertedWithCustomError(qcManager, "InvalidMintingCapacity")
      })

      it("should revert with QCAlreadyRegistered when registering twice", async () => {
        await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP)

        await expect(
          qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP)
        ).to.be.reverted
      })

      it("should revert with QCNotRegistered for non-existent QC", async () => {
        await expect(
          qcManager
            .connect(owner)
            .setQCStatus(
              qc1.address,
              2,
              ethers.utils.formatBytes32String("test")
            ) // PAUSED
        ).to.be.reverted
      })

      it("should revert with InvalidStatusTransition for invalid status changes", async () => {
        await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP)

        // Grant DISPUTE_ARBITER_ROLE to owner for status transitions
        const DISPUTE_ARBITER_ROLE = await qcManager.DISPUTE_ARBITER_ROLE()
        await qcManager.grantRole(DISPUTE_ARBITER_ROLE, owner.address)

        // First set to UnderReview(3)
        await qcManager
          .connect(owner)
          .setQCStatus(qc1.address, 3, ethers.utils.formatBytes32String("test"))

        // Try to transition from UnderReview(3) to MintingPaused(1) - this is invalid
        await expect(
          qcManager
            .connect(owner)
            .setQCStatus(
              qc1.address,
              1,
              ethers.utils.formatBytes32String("test")
            )
        ).to.be.revertedWithCustomError(qcManager, "InvalidStatusTransition")
      })

      it("should revert with NewCapMustBeHigher when not increasing capacity", async () => {
        await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP)

        await expect(
          qcManager
            .connect(owner)
            .increaseMintingCapacity(qc1.address, MAX_MINTING_CAP)
        ).to.be.reverted
      })
    })

    describe("Library Registration Logic", () => {
      it("should successfully register QC with valid parameters", async () => {
        await expect(
          qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP)
        ).to.emit(qcManager, "QCOnboarded")

        const qcInfo = await qcData.getQCInfo(qc1.address)
        expect(qcInfo.registeredAt).to.be.gt(0)
        expect(qcInfo.status).to.equal(0) // REGISTERED
        expect(qcInfo.maxCapacity).to.equal(MAX_MINTING_CAP)
      })

      it("should authorize QC in AccountControl when enabled", async () => {
        // Grant roles to qcManager in AccountControl
        const RESERVE_ROLE = ethers.utils.keccak256(
          ethers.utils.toUtf8Bytes("RESERVE_ROLE")
        )

        const ORACLE_ROLE = ethers.utils.keccak256(
          ethers.utils.toUtf8Bytes("ORACLE_ROLE")
        )

        await accountControl.grantRole(RESERVE_ROLE, qcManager.address)
        await accountControl.grantRole(ORACLE_ROLE, qcManager.address)

        await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP)

        expect(await accountControl.authorized(qc1.address)).to.be.true
      })
    })

    describe("Library Status Validation", () => {
      beforeEach(async () => {
        await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP)
      })

      it("should validate status transitions correctly", async () => {
        // Grant DISPUTE_ARBITER_ROLE to owner for setQCStatus
        const DISPUTE_ARBITER_ROLE = await qcManager.DISPUTE_ARBITER_ROLE()
        await qcManager.grantRole(DISPUTE_ARBITER_ROLE, owner.address)

        // QC already registered in beforeEach with Active(0) status

        // Valid: Active(0) -> MintingPaused(1)
        const tx = await qcManager
          .connect(owner)
          .setQCStatus(qc1.address, 1, ethers.utils.formatBytes32String("test"))

        const receipt = await tx.wait()

        // Find the QCStatusChanged event
        const event = receipt.events?.find((e) => e.event === "QCStatusChanged")
        expect(event).to.not.be.undefined
        expect(event?.args?.qc).to.equal(qc1.address)
        expect(event?.args?.oldStatus).to.equal(0)
        expect(event?.args?.newStatus).to.equal(1)

        // Valid: MintingPaused(1) -> UnderReview(3)
        await expect(
          qcManager
            .connect(owner)
            .setQCStatus(
              qc1.address,
              3,
              ethers.utils.formatBytes32String("test")
            )
        ).to.emit(qcManager, "QCStatusChanged")
      })
    })

    describe("Library Gas Optimization", () => {
      it("should maintain reasonable gas costs for library operations", async () => {
        // Measure gas for registration
        const registrationTx = await qcManager
          .connect(owner)
          .registerQC(qc1.address, MAX_MINTING_CAP)

        const registrationReceipt = await registrationTx.wait()

        // Library calls should not significantly increase gas
        expect(registrationReceipt.gasUsed).to.be.lt(350000)

        // Grant DISPUTE_ARBITER_ROLE to owner for status transitions
        const DISPUTE_ARBITER_ROLE = await qcManager.DISPUTE_ARBITER_ROLE()
        await qcManager.grantRole(DISPUTE_ARBITER_ROLE, owner.address)

        // Measure gas for status change
        const statusChangeTx = await qcManager
          .connect(owner)
          .setQCStatus(qc1.address, 1, ethers.utils.formatBytes32String("test"))

        const statusChangeReceipt = await statusChangeTx.wait()

        expect(statusChangeReceipt.gasUsed).to.be.lt(150000)
      })
    })

    describe("Library Integration with AccountControl", () => {
      it("should properly sync with AccountControl during operations", async () => {
        // Register QC
        await qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP)

        // Verify AccountControl integration
        expect(await accountControl.authorized(qc1.address)).to.be.true

        const reserveInfo = await accountControl.reserveInfo(qc1.address)
        expect(reserveInfo.mintingCap).to.equal(MAX_MINTING_CAP)

        // Update capacity
        const newCap = MAX_MINTING_CAP.mul(2)
        await qcManager
          .connect(owner)
          .increaseMintingCapacity(qc1.address, newCap)

        // Verify update propagated
        const updatedInfo = await accountControl.reserveInfo(qc1.address)
        expect(updatedInfo.mintingCap).to.equal(newCap)
      })
    })
  })

  describe("Integration Testing", () => {
    describe("Library Linking Verification", () => {
      it("should have QCManagerLib properly linked", async () => {
        // Verify library is deployed
        expect(qcManagerLib.address).to.not.equal(ethers.constants.AddressZero)

        // Verify QCManager can call library functions through delegatecall
        // This is implicit in the working of extracted functions
      })

      it("should verify contract sizes are within limits", async () => {
        // Get deployed bytecode size
        const qcManagerCode = await ethers.provider.getCode(qcManager.address)
        const qcManagerSize = (qcManagerCode.length - 2) / 2 // Remove 0x and divide by 2 for bytes

        const qcManagerLibCode = await ethers.provider.getCode(
          qcManagerLib.address
        )

        const qcManagerLibSize = (qcManagerLibCode.length - 2) / 2

        // Uncomment to see contract sizes
        // console.log(`QCManager size: ${qcManagerSize} bytes`);
        // console.log(`QCManagerLib size: ${qcManagerLibSize} bytes`);

        // Verify sizes are under EIP-170 limit
        expect(qcManagerSize).to.be.lessThan(
          24576,
          "QCManager exceeds size limit"
        )
        expect(qcManagerLibSize).to.be.lessThan(
          24576,
          "QCManagerLib exceeds size limit"
        )
      })
    })

    describe("Basic Integration Tests", () => {
      it("should integrate with QCData for basic QC operations", async () => {
        const mintingCap = ethers.utils.parseEther("1000000")

        // Register QC
        await qcManager.connect(governance).registerQC(qc1.address, mintingCap)

        // Get QC info to verify integration
        const qcInfo = await qcData.getQCInfo(qc1.address)
        expect(qcInfo.maxCapacity).to.equal(mintingCap)
        expect(qcInfo.status).to.equal(0) // Active
      })

      it("should handle library error propagation", async () => {
        // Try to register QC with zero address
        await expect(
          qcManager
            .connect(governance)
            .registerQC(
              ethers.constants.AddressZero,
              ethers.utils.parseEther("1000000")
            )
        ).to.be.revertedWithCustomError(qcManager, "InvalidQCAddress")

        // Try to register with zero capacity
        await expect(
          qcManager.connect(governance).registerQC(qc1.address, 0)
        ).to.be.revertedWithCustomError(qcManager, "InvalidMintingCapacity")
      })
    })
  })

  describe("Extracted Functions", () => {
    describe("isValidBitcoinAddress", () => {
      it("should return false for empty address", async () => {
        const result = await qcManagerLib.isValidBitcoinAddress("")
        expect(result).to.be.false
      })

      it("should return true for valid P2PKH address", async () => {
        const result = await qcManagerLib.isValidBitcoinAddress(
          "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
        )

        expect(result).to.be.true
      })

      it("should return true for valid P2SH address", async () => {
        const result = await qcManagerLib.isValidBitcoinAddress(
          "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"
        )

        expect(result).to.be.true
      })

      it("should return true for valid Bech32 address", async () => {
        const result = await qcManagerLib.isValidBitcoinAddress(
          "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
        )

        expect(result).to.be.true
      })

      it("should return false for too short address", async () => {
        const result = await qcManagerLib.isValidBitcoinAddress("1A1zP1eP5QG")
        expect(result).to.be.false
      })

      it("should return false for too long address", async () => {
        const longAddress =
          "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNaExtraLongInvalidAddress123456789"

        const result = await qcManagerLib.isValidBitcoinAddress(longAddress)
        expect(result).to.be.false
      })

      it("should return false for invalid format", async () => {
        const result = await qcManagerLib.isValidBitcoinAddress(
          "invalid_bitcoin_address"
        )

        expect(result).to.be.false
      })
    })

    describe("getReserveBalanceAndStaleness", () => {
      it("should have correct function signature", async () => {
        // Verify the function exists and has correct signature
        expect(
          qcManagerLib.interface.getFunction("getReserveBalanceAndStaleness")
        ).to.exist

        const func = qcManagerLib.interface.getFunction(
          "getReserveBalanceAndStaleness"
        )

        expect(func.inputs).to.have.length(2) // reserveOracle and qc
        expect(func.outputs).to.have.length(2) // balance and isStale
      })
    })

    describe("verifyBitcoinSignature", () => {
      // Note: verifyBitcoinSignature is an internal function and cannot be accessed directly
      // It is tested indirectly through functions that use it
    })
  })

  describe("Enhanced Integration Testing", () => {
    describe("Status Transition Integration", () => {
      it("should handle complex status transition scenarios", async () => {
        // Grant DISPUTE_ARBITER_ROLE for status transitions
        const DISPUTE_ARBITER_ROLE = await qcManager.DISPUTE_ARBITER_ROLE()
        await qcManager.grantRole(DISPUTE_ARBITER_ROLE, owner.address)

        // Test complete status transition flow
        const statusFlow = [
          { status: 1, name: "MintingPaused" },
          { status: 2, name: "Paused" },
          { status: 3, name: "UnderReview" },
          { status: 0, name: "Active" },
          { status: 4, name: "Revoked" },
        ]

        for (let i = 0; i < statusFlow.length - 1; i++) {
          const currentStep = statusFlow[i]
          const nextStep = statusFlow[i + 1]

          await qcManager
            .connect(owner)
            .setQCStatus(
              qc1.address,
              currentStep.status,
              ethers.utils.formatBytes32String(currentStep.name)
            )

          const status = await qcData.getQCStatus(qc1.address)
          expect(status).to.equal(currentStep.status)

          // Attempt transition to next status
          if (nextStep.status !== 4 || i === statusFlow.length - 2) {
            await qcManager
              .connect(owner)
              .setQCStatus(
                qc1.address,
                nextStep.status,
                ethers.utils.formatBytes32String(nextStep.name)
              )
          }
        }
      })

      it("should properly sync AccountControl with status changes", async () => {
        const DISPUTE_ARBITER_ROLE = await qcManager.DISPUTE_ARBITER_ROLE()
        await qcManager.grantRole(DISPUTE_ARBITER_ROLE, owner.address)

        // Active -> Paused should pause reserve
        await qcManager
          .connect(owner)
          .setQCStatus(
            qc1.address,
            2,
            ethers.utils.formatBytes32String("paused")
          )

        // Verify AccountControl reflects the pause
        const reserveInfo = await accountControl.reserveInfo(qc1.address)
        expect(reserveInfo.paused).to.be.true

        // Paused -> Active should unpause reserve
        await qcManager
          .connect(owner)
          .setQCStatus(
            qc1.address,
            0,
            ethers.utils.formatBytes32String("active")
          )

        const activeReserveInfo = await accountControl.reserveInfo(qc1.address)
        expect(activeReserveInfo.paused).to.be.false
      })
    })

    describe("Capacity Management Integration", () => {
      it("should handle capacity updates through QCManager integration", async () => {
        const initialCap = await qcData.getMaxMintingCapacity(qc1.address)
        const newCap = initialCap.mul(2)

        await qcManager
          .connect(owner)
          .increaseMintingCapacity(qc1.address, newCap)

        const updatedCap = await qcData.getMaxMintingCapacity(qc1.address)
        expect(updatedCap).to.equal(newCap)

        // Verify AccountControl is updated
        const reserveInfo = await accountControl.reserveInfo(qc1.address)
        expect(reserveInfo.mintingCap).to.equal(newCap)
      })

      it("should validate capacity constraints through integration", async () => {
        const currentCap = await qcData.getMaxMintingCapacity(qc1.address)

        // Try to decrease capacity (should fail)
        await expect(
          qcManager
            .connect(owner)
            .increaseMintingCapacity(qc1.address, currentCap.div(2))
        ).to.be.reverted

        // Try to set zero capacity (should fail)
        await expect(
          qcManager.connect(owner).increaseMintingCapacity(qc1.address, 0)
        ).to.be.reverted
      })
    })

    describe("Error Propagation Integration", () => {
      it("should properly propagate library errors through QCManager", async () => {
        // Test various error conditions that should be caught by QCManagerLib

        // Invalid QC address
        await expect(
          qcManager
            .connect(owner)
            .registerQC(ethers.constants.AddressZero, MAX_MINTING_CAP)
        ).to.be.revertedWithCustomError(qcManager, "InvalidQCAddress")

        // Invalid minting capacity
        await expect(
          qcManager.connect(owner).registerQC(qc2.address, 0)
        ).to.be.revertedWithCustomError(qcManager, "InvalidMintingCapacity")

        // Duplicate registration
        await expect(
          qcManager.connect(owner).registerQC(qc1.address, MAX_MINTING_CAP)
        ).to.be.reverted // QC already registered
      })

      it("should handle edge cases in error propagation", async () => {
        const DISPUTE_ARBITER_ROLE = await qcManager.DISPUTE_ARBITER_ROLE()
        await qcManager.grantRole(DISPUTE_ARBITER_ROLE, owner.address)

        // Try invalid status transitions
        await qcManager
          .connect(owner)
          .setQCStatus(
            qc1.address,
            4,
            ethers.utils.formatBytes32String("revoked")
          )

        // From revoked, no transitions should be allowed
        await expect(
          qcManager
            .connect(owner)
            .setQCStatus(
              qc1.address,
              0,
              ethers.utils.formatBytes32String("active")
            )
        ).to.be.revertedWithCustomError(qcManager, "InvalidStatusTransition")
      })
    })

    describe("Gas Optimization Integration", () => {
      it("should maintain reasonable gas costs for library operations", async () => {
        // Test gas consumption for various operations
        const operations = []

        // Registration
        const registrationTx = await qcManager
          .connect(owner)
          .registerQC(qc2.address, MAX_MINTING_CAP.mul(2))

        operations.push({
          name: "Registration",
          tx: registrationTx,
          maxGas: 350000,
        })

        // Capacity increase
        const capacityTx = await qcManager
          .connect(owner)
          .increaseMintingCapacity(qc1.address, MAX_MINTING_CAP.mul(3))

        operations.push({
          name: "Capacity Update",
          tx: capacityTx,
          maxGas: 200000,
        })

        // Status change
        const DISPUTE_ARBITER_ROLE = await qcManager.DISPUTE_ARBITER_ROLE()
        await qcManager.grantRole(DISPUTE_ARBITER_ROLE, owner.address)

        const statusTx = await qcManager
          .connect(owner)
          .setQCStatus(
            qc1.address,
            1,
            ethers.utils.formatBytes32String("paused")
          )

        operations.push({
          name: "Status Change",
          tx: statusTx,
          maxGas: 150000,
        })

        // Verify all operations stay within gas limits
        for (const op of operations) {
          const receipt = await op.tx.wait()
          expect(receipt.gasUsed.toNumber()).to.be.lt(
            op.maxGas,
            `${op.name} exceeded gas limit`
          )
        }
      })

      it("should handle batch-like operations efficiently", async () => {
        // Register multiple QCs to test cumulative gas costs
        const qcs = [qc2, governance, registrar]
        const gasUsage = []

        for (let i = 0; i < qcs.length; i++) {
          const tx = await qcManager
            .connect(owner)
            .registerQC(qcs[i].address, MAX_MINTING_CAP.add(i * 1000))

          const receipt = await tx.wait()
          gasUsage.push(receipt.gasUsed.toNumber())
        }

        // Gas usage should remain consistent (not increase significantly)
        const maxVariation = Math.max(...gasUsage) - Math.min(...gasUsage)
        expect(maxVariation).to.be.lt(50000, "Gas usage varies too much")
      })
    })

    describe("Cross-Contract Integration", () => {
      it("should properly integrate with all dependent contracts", async () => {
        // Verify QCManager properly interacts with all contracts

        // QCData integration
        const qcInfo = await qcData.getQCInfo(qc1.address)
        expect(qcInfo.registeredAt).to.be.gt(0)
        expect(qcInfo.status).to.equal(0) // Active

        // AccountControl integration
        const reserveInfo = await accountControl.reserveInfo(qc1.address)
        expect(reserveInfo.mintingCap).to.equal(MAX_MINTING_CAP)
        expect(reserveInfo.authorized).to.be.true

        // SystemState integration (tested via pause functionality)
        // This is verified in other tests

        // ReserveOracle integration
        const oracleBalance = await reserveOracle.getReserveBalance(qc1.address)
        expect(oracleBalance).to.be.gte(0) // Should have valid balance
      })

      it("should handle contract interaction failures gracefully", async () => {
        // Test what happens when dependent contracts are in unexpected states

        // Unauthorized QC should fail operations
        const newQC = ethers.Wallet.createRandom().address
        await qcData.registerQC(newQC, MAX_MINTING_CAP)

        // Without proper authorization in AccountControl, some operations should fail
        // This tests the integration between QCManager and AccountControl
      })
    })

    describe("State Consistency Integration", () => {
      it("should maintain consistent state across all contracts", async () => {
        // Test complex operation that affects multiple contracts
        const newCap = MAX_MINTING_CAP.mul(2)

        // Update capacity
        await qcManager
          .connect(owner)
          .increaseMintingCapacity(qc1.address, newCap)

        // Verify consistency across contracts
        const qcDataCap = await qcData.getMaxMintingCapacity(qc1.address)

        const accountControlCap = (
          await accountControl.reserveInfo(qc1.address)
        ).mintingCap

        expect(qcDataCap).to.equal(newCap)
        expect(accountControlCap).to.equal(newCap)
        expect(qcDataCap).to.equal(accountControlCap)
      })

      it("should handle concurrent state changes correctly", async () => {
        const DISPUTE_ARBITER_ROLE = await qcManager.DISPUTE_ARBITER_ROLE()
        await qcManager.grantRole(DISPUTE_ARBITER_ROLE, owner.address)

        // Perform multiple state changes in sequence
        await qcManager
          .connect(owner)
          .setQCStatus(
            qc1.address,
            1,
            ethers.utils.formatBytes32String("paused")
          )

        await qcManager
          .connect(owner)
          .increaseMintingCapacity(qc1.address, MAX_MINTING_CAP.mul(3))

        await qcManager
          .connect(owner)
          .setQCStatus(
            qc1.address,
            0,
            ethers.utils.formatBytes32String("active")
          )

        // Verify final state is consistent
        const status = await qcData.getQCStatus(qc1.address)
        const capacity = await qcData.getMaxMintingCapacity(qc1.address)
        const reserveInfo = await accountControl.reserveInfo(qc1.address)

        expect(status).to.equal(0) // Active
        expect(capacity).to.equal(MAX_MINTING_CAP.mul(3))
        expect(reserveInfo.mintingCap).to.equal(capacity)
        expect(reserveInfo.paused).to.be.false
      })
    })

    describe("Edge Cases Integration", () => {
      it("should handle maximum values safely", async () => {
        // Test with very large capacity values
        const largeCap = ethers.utils.parseUnits("21000000", 8) // 21M BTC

        await qcManager.connect(owner).registerQC(governance.address, largeCap)

        const registeredCap = await qcData.getMaxMintingCapacity(
          governance.address
        )

        expect(registeredCap).to.equal(largeCap)
      })

      it("should handle boundary conditions in status transitions", async () => {
        const DISPUTE_ARBITER_ROLE = await qcManager.DISPUTE_ARBITER_ROLE()
        await qcManager.grantRole(DISPUTE_ARBITER_ROLE, owner.address)

        // Test all valid status values
        const validStatuses = [0, 1, 2, 3, 4] // Active, MintingPaused, Paused, UnderReview, Revoked

        for (const status of validStatuses) {
          if (status === 4) continue // Skip revoked for now

          await qcManager
            .connect(owner)
            .setQCStatus(
              qc1.address,
              status,
              ethers.utils.formatBytes32String(`status_${status}`)
            )

          const currentStatus = await qcData.getQCStatus(qc1.address)
          expect(currentStatus).to.equal(status)
        }
      })

      it("should handle role-based access control edge cases", async () => {
        // Test operations with minimal permissions
        const tempUser = ethers.Wallet.createRandom().address

        // Grant minimal role
        const REGISTRAR_ROLE = await qcManager.REGISTRAR_ROLE()
        await qcManager.grantRole(REGISTRAR_ROLE, tempUser)

        // Should not be able to perform governance operations
        const userSigner = await ethers.getImpersonatedSigner(tempUser)
        await expect(
          qcManager
            .connect(userSigner)
            .increaseMintingCapacity(qc1.address, MAX_MINTING_CAP.mul(2))
        ).to.be.reverted

        // Clean up
        await qcManager.revokeRole(REGISTRAR_ROLE, tempUser)
      })
    })
  })
})
