import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import {
  QCManager,
  QCData,
  AccountControl,
  SystemState,
  MockReserveOracle,
  MockBank,
} from "../../../typechain"

describe("QCManagerLib - Financial Function Integration Tests", () => {
  let qcManager: QCManager
  let qcData: QCData
  let accountControl: AccountControl
  let systemState: SystemState
  let reserveOracle: MockReserveOracle
  let mockBank: MockBank

  let owner: SignerWithAddress
  let qc1: SignerWithAddress
  let qc2: SignerWithAddress
  let governance: SignerWithAddress

  // Test constants
  const INITIAL_CAP = ethers.utils.parseUnits("1000", 8) // 1000 BTC in satoshis
  const LARGE_CAP = ethers.utils.parseUnits("10000", 8) // 10000 BTC in satoshis
  const MAX_UINT256 = ethers.constants.MaxUint256
  const ZERO_ADDRESS = ethers.constants.AddressZero

  beforeEach(async () => {
    ;[owner, qc1, qc2, governance] = await ethers.getSigners()

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

    // Deploy QCManagerLib library
    const QCManagerLibFactory = await ethers.getContractFactory("QCManagerLib")
    const qcManagerLib = await QCManagerLibFactory.deploy()

    // Deploy QCPauseManager
    const QCPauseManagerFactory = await ethers.getContractFactory(
      "QCPauseManager"
    )

    const pauseManager = await QCPauseManagerFactory.deploy(
      qcData.address,
      owner.address,
      owner.address,
      owner.address
    )

    // Deploy MockQCWalletManager
    const MockQCWalletManagerFactory = await ethers.getContractFactory(
      "MockQCWalletManager"
    )

    const walletManager = await MockQCWalletManagerFactory.deploy()

    // Deploy AccountControl first (required for QCManager)
    const AccountControlFactory = await ethers.getContractFactory(
      "AccountControl"
    )

    accountControl = await AccountControlFactory.deploy(
      owner.address,
      owner.address,
      mockBank.address
    )

    // Deploy QCManager with library linked
    const QCManagerFactory = await ethers.getContractFactory("QCManager", {
      libraries: {
        QCManagerLib: qcManagerLib.address,
      },
    })

    qcManager = await QCManagerFactory.deploy(
      qcData.address,
      systemState.address,
      reserveOracle.address,
      accountControl.address,
      pauseManager.address,
      walletManager.address
    )

    // Setup roles for QCManager
    const QC_MANAGER_ROLE = await pauseManager.QC_MANAGER_ROLE()
    await pauseManager.grantRole(QC_MANAGER_ROLE, qcManager.address)
    await pauseManager.revokeRole(QC_MANAGER_ROLE, owner.address)

    // Setup roles for QCData
    const QC_MANAGER_ROLE_DATA = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("QC_MANAGER_ROLE")
    )

    await qcData.grantRole(QC_MANAGER_ROLE_DATA, qcManager.address)

    // Grant governance role
    const GOVERNANCE_ROLE = await qcManager.GOVERNANCE_ROLE()
    await qcManager.grantRole(GOVERNANCE_ROLE, owner.address)
    await qcManager.grantRole(GOVERNANCE_ROLE, governance.address)

    // Grant QCManager necessary roles in AccountControl
    await accountControl.connect(owner).grantReserveRole(qcManager.address)
    await accountControl.connect(owner).grantOracleRole(qcManager.address)
    await accountControl.connect(owner).setEmergencyCouncil(qcManager.address)

    // Register test QCs
    await qcManager.connect(owner).registerQC(qc1.address, INITIAL_CAP)
    await qcManager.connect(owner).registerQC(qc2.address, INITIAL_CAP)
  })

  describe("Minting Capacity Validation Integration", () => {
    describe("validateMintingCapacityUpdate via increaseMintingCapacity", () => {
      it("should successfully validate and update valid capacity increases", async () => {
        const newCap = INITIAL_CAP.mul(2)

        await expect(
          qcManager.connect(owner).increaseMintingCapacity(qc1.address, newCap)
        ).to.emit(qcManager, "BalanceUpdate")

        const updatedCap = await qcData.getMaxMintingCapacity(qc1.address)
        expect(updatedCap).to.equal(newCap)

        // Verify AccountControl is also updated
        const reserveInfo = await accountControl.reserveInfo(qc1.address)
        expect(reserveInfo.mintingCap).to.equal(newCap)
      })

      it("should revert when trying to decrease capacity", async () => {
        const smallerCap = INITIAL_CAP.div(2)

        await expect(
          qcManager
            .connect(owner)
            .increaseMintingCapacity(qc1.address, smallerCap)
        ).to.be.revertedWithCustomError(qcManager, "NewCapMustBeHigher")
      })

      it("should revert when trying to set same capacity", async () => {
        await expect(
          qcManager
            .connect(owner)
            .increaseMintingCapacity(qc1.address, INITIAL_CAP)
        ).to.be.revertedWithCustomError(qcManager, "NewCapMustBeHigher")
      })

      it("should handle maximum capacity values", async () => {
        // Test with very large capacity (21M BTC)
        const maxBitcoinCap = ethers.utils.parseUnits("21000000", 8)

        await expect(
          qcManager
            .connect(owner)
            .increaseMintingCapacity(qc1.address, maxBitcoinCap)
        ).to.not.be.reverted

        const finalCap = await qcData.getMaxMintingCapacity(qc1.address)
        expect(finalCap).to.equal(maxBitcoinCap)
      })

      it("should revert for unregistered QC", async () => {
        const unregisteredQC = ethers.Wallet.createRandom().address

        await expect(
          qcManager
            .connect(owner)
            .increaseMintingCapacity(unregisteredQC, LARGE_CAP)
        ).to.be.revertedWithCustomError(qcManager, "QCNotRegistered")
      })
    })
  })

  describe("Reserve Backing Synchronization Integration", () => {
    describe("syncBackingFromOracle integration", () => {
      it("should sync fresh backing data from oracle to AccountControl", async () => {
        const oracleBalance = ethers.utils.parseUnits("500", 8) // 500 BTC

        // Set oracle balance (fresh, not stale)
        await reserveOracle.setReserveBalance(qc1.address, oracleBalance, false)

        // Trigger sync by checking minting capacity (this calls sync internally)
        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        // Verify AccountControl was updated
        const reserveInfo = await accountControl.reserveInfo(qc1.address)
        expect(reserveInfo.backing).to.equal(oracleBalance)
      })

      it("should handle stale backing data appropriately", async () => {
        const oracleBalance = ethers.utils.parseUnits("800", 8)

        // Set oracle balance as stale
        await reserveOracle.setReserveBalance(qc1.address, oracleBalance, true)

        // With stale data, available capacity should be 0
        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        expect(capacity).to.equal(0)

        // But backing should still be synced to AccountControl
        const reserveInfo = await accountControl.reserveInfo(qc1.address)
        expect(reserveInfo.backing).to.equal(oracleBalance)
      })

      it("should handle oracle failures gracefully", async () => {
        // Set oracle to return balance 0 (simulating failure)
        await reserveOracle.setReserveBalance(qc1.address, 0, false)

        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        expect(capacity).to.equal(0) // No capacity when no backing
      })
    })
  })

  describe("Solvency Verification Integration", () => {
    describe("verifyQCSolvency through governance operations", () => {
      beforeEach(async () => {
        // Set some minted amount for testing
        const mintedAmount = ethers.utils.parseUnits("200", 8) // 200 BTC
        await qcData.setQCMintedAmount(qc1.address, mintedAmount)
      })

      it("should identify solvent QC correctly", async () => {
        const backing = ethers.utils.parseUnits("300", 8) // 300 BTC backing
        const minted = ethers.utils.parseUnits("200", 8) // 200 BTC minted

        await reserveOracle.setReserveBalance(qc1.address, backing, false)

        // QC should be solvent (backing > minted)
        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        // Available capacity should be the minimum of:
        // - Cap-based: INITIAL_CAP(1000) - minted(200) = 800
        // - Reserve-based: backing(300) - minted(200) = 100
        // So minimum is 100
        expect(capacity).to.equal(ethers.utils.parseUnits("100", 8))
      })

      it("should identify insolvent QC correctly", async () => {
        const backing = ethers.utils.parseUnits("150", 8) // 150 BTC backing
        const minted = ethers.utils.parseUnits("200", 8) // 200 BTC minted

        await reserveOracle.setReserveBalance(qc1.address, backing, false)

        // QC should be insolvent (backing < minted)
        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        expect(capacity).to.equal(0) // No capacity when reserves exhausted
      })

      it("should handle edge case where backing exactly equals minted", async () => {
        const amount = ethers.utils.parseUnits("200", 8) // 200 BTC both

        await reserveOracle.setReserveBalance(qc1.address, amount, false)

        // QC should be exactly solvent (backing == minted)
        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        expect(capacity).to.equal(0) // No additional capacity available
      })

      it("should handle zero minted amount correctly", async () => {
        // Reset to zero minted
        await qcData.setQCMintedAmount(qc1.address, 0)

        const backing = ethers.utils.parseUnits("500", 8)
        await reserveOracle.setReserveBalance(qc1.address, backing, false)

        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        // Capacity should be minimum of cap (1000) and backing (500)
        expect(capacity).to.equal(ethers.utils.parseUnits("500", 8))
      })
    })
  })

  describe("Available Minting Capacity Calculation Integration", () => {
    describe("calculateAvailableMintingCapacity via getAvailableMintingCapacity", () => {
      it("should return cap-based capacity when reserves are higher", async () => {
        const mintedAmount = ethers.utils.parseUnits("100", 8)
        const backing = ethers.utils.parseUnits("2000", 8) // Much higher than cap

        await qcData.setQCMintedAmount(qc1.address, mintedAmount)
        await reserveOracle.setReserveBalance(qc1.address, backing, false)

        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        // Should be limited by cap: INITIAL_CAP(1000) - minted(100) = 900
        expect(capacity).to.equal(ethers.utils.parseUnits("900", 8))
      })

      it("should return reserve-based capacity when cap is higher", async () => {
        const mintedAmount = ethers.utils.parseUnits("100", 8)
        const backing = ethers.utils.parseUnits("300", 8) // Lower than cap

        await qcData.setQCMintedAmount(qc1.address, mintedAmount)
        await reserveOracle.setReserveBalance(qc1.address, backing, false)

        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        // Should be limited by reserves: backing(300) - minted(100) = 200
        expect(capacity).to.equal(ethers.utils.parseUnits("200", 8))
      })

      it("should return 0 capacity for inactive QC", async () => {
        // Set QC to paused status
        const DISPUTE_ARBITER_ROLE = await qcManager.DISPUTE_ARBITER_ROLE()
        await qcManager.grantRole(DISPUTE_ARBITER_ROLE, owner.address)

        await qcManager.connect(owner).setQCStatus(
          qc1.address,
          1, // MintingPaused
          ethers.utils.formatBytes32String("paused")
        )

        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        expect(capacity).to.equal(0)
      })

      it("should return 0 capacity for stale reserves", async () => {
        const backing = ethers.utils.parseUnits("500", 8)

        // Set stale backing
        await reserveOracle.setReserveBalance(qc1.address, backing, true)

        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        expect(capacity).to.equal(0)
      })

      it("should handle mathematical edge cases", async () => {
        // Test capacity calculation with very large numbers
        await qcManager
          .connect(owner)
          .increaseMintingCapacity(qc1.address, MAX_UINT256)

        const largeBacking = ethers.utils.parseUnits("1000000", 8) // 1M BTC
        const largeMinted = ethers.utils.parseUnits("999999", 8) // 999,999 BTC

        await qcData.setQCMintedAmount(qc1.address, largeMinted)
        await reserveOracle.setReserveBalance(qc1.address, largeBacking, false)

        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        // Should be 1 BTC available (1M - 999,999)
        expect(capacity).to.equal(ethers.utils.parseUnits("1", 8))
      })

      it("should handle overflow/underflow scenarios safely", async () => {
        // Set minted amount higher than backing (underflow scenario)
        const backing = ethers.utils.parseUnits("100", 8)
        const minted = ethers.utils.parseUnits("200", 8)

        await qcData.setQCMintedAmount(qc1.address, minted)
        await reserveOracle.setReserveBalance(qc1.address, backing, false)

        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        expect(capacity).to.equal(0) // Should handle underflow gracefully
      })
    })
  })

  describe("Financial Function Cross-Integration", () => {
    it("should handle complex scenario with multiple operations", async () => {
      const initialMinted = ethers.utils.parseUnits("200", 8)
      const initialBacking = ethers.utils.parseUnits("300", 8)

      // Setup initial state
      await qcData.setQCMintedAmount(qc1.address, initialMinted)
      await reserveOracle.setReserveBalance(qc1.address, initialBacking, false)

      // Initial capacity check
      let capacity = await qcManager.getAvailableMintingCapacity(qc1.address)
      expect(capacity).to.equal(ethers.utils.parseUnits("100", 8)) // 300 - 200

      // Increase minting capacity
      const newCap = INITIAL_CAP.mul(3)
      await qcManager
        .connect(owner)
        .increaseMintingCapacity(qc1.address, newCap)

      // Capacity should still be reserve-limited
      capacity = await qcManager.getAvailableMintingCapacity(qc1.address)
      expect(capacity).to.equal(ethers.utils.parseUnits("100", 8))

      // Increase backing
      const newBacking = ethers.utils.parseUnits("1500", 8)
      await reserveOracle.setReserveBalance(qc1.address, newBacking, false)

      // Now capacity should be cap-limited
      capacity = await qcManager.getAvailableMintingCapacity(qc1.address)
      expect(capacity).to.equal(ethers.utils.parseUnits("2800", 8)) // 3000 - 200
    })

    it("should maintain consistency across all financial operations", async () => {
      // Test that all functions work together consistently
      const testScenarios = [
        { minted: "0", backing: "1000", expectedCap: "1000" },
        { minted: "500", backing: "1500", expectedCap: "500" },
        { minted: "800", backing: "900", expectedCap: "100" },
        { minted: "1000", backing: "1000", expectedCap: "0" },
      ]

      for (const scenario of testScenarios) {
        const minted = ethers.utils.parseUnits(scenario.minted, 8)
        const backing = ethers.utils.parseUnits(scenario.backing, 8)
        const expected = ethers.utils.parseUnits(scenario.expectedCap, 8)

        await qcData.setQCMintedAmount(qc1.address, minted)
        await reserveOracle.setReserveBalance(qc1.address, backing, false)

        const capacity = await qcManager.getAvailableMintingCapacity(
          qc1.address
        )

        expect(capacity).to.equal(
          expected,
          `Failed for scenario: minted=${scenario.minted}, backing=${scenario.backing}`
        )
      }
    })
  })

  describe("Gas Optimization for Financial Operations", () => {
    it("should maintain reasonable gas costs for financial calculations", async () => {
      const operations = []

      // Test capacity increase
      const capTx = await qcManager
        .connect(owner)
        .increaseMintingCapacity(qc1.address, INITIAL_CAP.mul(2))

      operations.push({ name: "Capacity Increase", tx: capTx, maxGas: 200000 })

      // Test capacity calculation (view function - estimate gas)
      const estimatedGas =
        await qcManager.estimateGas.getAvailableMintingCapacity(qc1.address)

      expect(estimatedGas.toNumber()).to.be.lt(
        100000,
        "Capacity calculation gas too high"
      )

      // Verify gas usage for all operations
      for (const op of operations) {
        const receipt = await op.tx.wait()
        expect(receipt.gasUsed.toNumber()).to.be.lt(
          op.maxGas,
          `${op.name} exceeded gas limit`
        )
      }
    })
  })
})
