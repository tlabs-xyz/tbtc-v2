import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

import { AccountControl, MockBank } from "../../../typechain"
import {
  deployAccountControlForTest,
  cleanupDeployments,
} from "../../helpers/deployment-utils"

/**
 * AccountControl State Transition Tests
 *
 * Tests complex state transitions and emergency recovery scenarios for the
 * AccountControl contract, including:
 * - Emergency pause/unpause cycles
 * - Multi-reserve state transitions
 * - Complex lifecycle management
 * - State consistency validation
 */
describe("AccountControl - State Transitions", () => {
  let accountControl: AccountControl
  let mockBank: MockBank
  let owner: SignerWithAddress
  let emergencyCouncil: SignerWithAddress
  let newEmergencyCouncil: SignerWithAddress
  let reserve1: SignerWithAddress
  let reserve2: SignerWithAddress
  let reserve3: SignerWithAddress
  let user: SignerWithAddress
  let oracle: SignerWithAddress
  let redeemer: SignerWithAddress

  // Test constants
  const MINTING_CAP = ethers.utils.parseUnits("100", 8) // 100 BTC in satoshis
  const BACKING_AMOUNT = ethers.utils.parseUnits("50", 8) // 50 BTC in satoshis
  const MINT_AMOUNT_SATOSHIS = ethers.utils.parseUnits("1", 8) // 1 BTC in satoshis
  const SATOSHI_MULTIPLIER = ethers.BigNumber.from("10000000000") // 1e10

  // Role constants
  let MINTER_ROLE: string
  let ORACLE_ROLE: string
  let REDEEMER_ROLE: string

  beforeEach(async () => {
    ;[
      owner,
      emergencyCouncil,
      newEmergencyCouncil,
      reserve1,
      reserve2,
      reserve3,
      user,
      oracle,
      redeemer,
    ] = await ethers.getSigners()

    // Deploy mock Bank
    const MockBankFactory = await ethers.getContractFactory("MockBank")
    mockBank = await MockBankFactory.deploy()

    // Deploy AccountControl
    accountControl = await deployAccountControlForTest(
      owner,
      emergencyCouncil,
      mockBank
    )

    // Setup role constants
    MINTER_ROLE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("MINTER_ROLE")
    )
    ORACLE_ROLE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("ORACLE_ROLE")
    )
    REDEEMER_ROLE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("REDEEMER_ROLE")
    )

    // Grant necessary roles
    await accountControl.connect(owner).grantRole(MINTER_ROLE, reserve1.address)
    await accountControl.connect(owner).grantRole(MINTER_ROLE, reserve2.address)
    await accountControl.connect(owner).grantRole(MINTER_ROLE, reserve3.address)
    await accountControl.connect(owner).grantRole(ORACLE_ROLE, oracle.address)
    await accountControl
      .connect(owner)
      .grantRole(REDEEMER_ROLE, redeemer.address)

    // Setup initial reserves
    await setupTestReserves()
  })

  afterEach(async () => {
    await cleanupDeployments()
  })

  async function setupTestReserves() {
    // Authorize reserves
    await accountControl
      .connect(owner)
      .authorizeReserve(reserve1.address, MINTING_CAP, 1) // QC_PERMISSIONED
    await accountControl
      .connect(owner)
      .authorizeReserve(reserve2.address, MINTING_CAP, 1)
    await accountControl
      .connect(owner)
      .authorizeReserve(reserve3.address, MINTING_CAP, 1)

    // Set backing amounts
    await accountControl.connect(reserve1).updateBacking(BACKING_AMOUNT)
    await accountControl.connect(reserve2).updateBacking(BACKING_AMOUNT)
    await accountControl.connect(reserve3).updateBacking(BACKING_AMOUNT)
  }

  async function assertSystemState(expectedState: {
    systemPaused: boolean
    reserve1Paused: boolean
    reserve2Paused: boolean
    reserve3Paused: boolean
  }) {
    expect(await accountControl.systemPaused()).to.equal(
      expectedState.systemPaused
    )

    const reserve1Info = await accountControl.reserveInfo(reserve1.address)
    const reserve2Info = await accountControl.reserveInfo(reserve2.address)
    const reserve3Info = await accountControl.reserveInfo(reserve3.address)

    expect(reserve1Info.paused).to.equal(expectedState.reserve1Paused)
    expect(reserve2Info.paused).to.equal(expectedState.reserve2Paused)
    expect(reserve3Info.paused).to.equal(expectedState.reserve3Paused)
  }

  async function mintTokensForReserve(
    reserve: SignerWithAddress,
    amount: ethers.BigNumber
  ) {
    const tbtcAmount = amount.mul(SATOSHI_MULTIPLIER)
    await accountControl
      .connect(reserve)
      .mintTBTC(reserve.address, user.address, tbtcAmount)
  }

  describe("Emergency Recovery Scenarios", () => {
    it("should handle complete system pause and recovery cycle", async () => {
      // Initial state - all operational
      await assertSystemState({
        systemPaused: false,
        reserve1Paused: false,
        reserve2Paused: false,
        reserve3Paused: false,
      })

      // Mint some tokens to establish state
      await mintTokensForReserve(reserve1, MINT_AMOUNT_SATOSHIS)
      await mintTokensForReserve(reserve2, MINT_AMOUNT_SATOSHIS)

      const initialTotalMinted = await accountControl.totalMinted()
      expect(initialTotalMinted).to.equal(MINT_AMOUNT_SATOSHIS.mul(2))

      // Emergency Council pauses system
      await expect(accountControl.connect(emergencyCouncil).pauseSystem())
        .to.emit(accountControl, "SystemPaused")
        .withArgs(emergencyCouncil.address, await getCurrentTimestamp())

      // System is now paused
      await assertSystemState({
        systemPaused: true,
        reserve1Paused: false,
        reserve2Paused: false,
        reserve3Paused: false,
      })

      // All operations should fail when system is paused
      const tbtcAmount = MINT_AMOUNT_SATOSHIS.mul(SATOSHI_MULTIPLIER)
      await expect(
        accountControl
          .connect(reserve1)
          .mintTBTC(reserve1.address, user.address, tbtcAmount)
      ).to.be.revertedWith("System is paused")

      await expect(
        accountControl.connect(reserve1).updateBacking(BACKING_AMOUNT.mul(2))
      ).to.be.revertedWithCustomError(accountControl, "SystemIsPaused")

      await expect(
        accountControl.connect(reserve1).redeem(MINT_AMOUNT_SATOSHIS.div(2))
      ).to.be.revertedWithCustomError(accountControl, "SystemIsPaused")

      // Only owner can unpause system
      await expect(
        accountControl.connect(emergencyCouncil).unpauseSystem()
      ).to.be.revertedWith("Ownable: caller is not the owner")

      // Owner recovers system
      await expect(accountControl.connect(owner).unpauseSystem())
        .to.emit(accountControl, "SystemUnpaused")
        .withArgs(owner.address, await getCurrentTimestamp())

      // System is now operational again
      await assertSystemState({
        systemPaused: false,
        reserve1Paused: false,
        reserve2Paused: false,
        reserve3Paused: false,
      })

      // State should be preserved
      expect(await accountControl.totalMinted()).to.equal(initialTotalMinted)
      expect(await accountControl.minted(reserve1.address)).to.equal(
        MINT_AMOUNT_SATOSHIS
      )
      expect(await accountControl.minted(reserve2.address)).to.equal(
        MINT_AMOUNT_SATOSHIS
      )

      // Operations should work again
      await mintTokensForReserve(reserve3, MINT_AMOUNT_SATOSHIS)
      expect(await accountControl.totalMinted()).to.equal(
        MINT_AMOUNT_SATOSHIS.mul(3)
      )
    })

    it("should handle emergency council change during crisis", async () => {
      // Pause system with original emergency council
      await accountControl.connect(emergencyCouncil).pauseSystem()
      expect(await accountControl.systemPaused()).to.be.true

      // Change emergency council while system is paused
      await expect(
        accountControl
          .connect(owner)
          .setEmergencyCouncil(newEmergencyCouncil.address)
      )
        .to.emit(accountControl, "EmergencyCouncilUpdated")
        .withArgs(
          emergencyCouncil.address,
          newEmergencyCouncil.address,
          owner.address,
          await getCurrentTimestamp()
        )

      // Old council should no longer have power
      await expect(
        accountControl.connect(emergencyCouncil).pauseReserve(reserve1.address)
      ).to.be.revertedWithCustomError(accountControl, "NotOwnerOrCouncil")

      // New council should have power
      await expect(
        accountControl
          .connect(newEmergencyCouncil)
          .pauseReserve(reserve1.address)
      ).to.emit(accountControl, "ReservePaused")

      // Owner can still recover
      await accountControl.connect(owner).unpauseSystem()
      await accountControl.connect(owner).unpauseReserve(reserve1.address)

      expect(await accountControl.systemPaused()).to.be.false
      const reserve1Info = await accountControl.reserveInfo(reserve1.address)
      expect(reserve1Info.paused).to.be.false
    })

    it("should handle partial reserve pause during system operations", async () => {
      // Establish some minted state
      await mintTokensForReserve(reserve1, MINT_AMOUNT_SATOSHIS)
      await mintTokensForReserve(reserve2, MINT_AMOUNT_SATOSHIS)

      // Pause only reserve1
      await accountControl
        .connect(emergencyCouncil)
        .pauseReserve(reserve1.address)

      await assertSystemState({
        systemPaused: false,
        reserve1Paused: true,
        reserve2Paused: false,
        reserve3Paused: false,
      })

      // Reserve1 operations should fail
      const tbtcAmount = MINT_AMOUNT_SATOSHIS.mul(SATOSHI_MULTIPLIER)
      await expect(
        accountControl
          .connect(reserve1)
          .mintTBTC(reserve1.address, user.address, tbtcAmount)
      ).to.be.revertedWith("Reserve is paused")

      // Other reserves should still work
      await mintTokensForReserve(reserve2, MINT_AMOUNT_SATOSHIS)
      await mintTokensForReserve(reserve3, MINT_AMOUNT_SATOSHIS)

      // Oracle operations should still work for paused reserves
      await accountControl
        .connect(oracle)
        .setBacking(reserve1.address, BACKING_AMOUNT.mul(2))

      // Owner can unpause specific reserve
      await accountControl.connect(owner).unpauseReserve(reserve1.address)

      // Reserve1 should work again
      await mintTokensForReserve(reserve1, MINT_AMOUNT_SATOSHIS)

      expect(await accountControl.totalMinted()).to.equal(
        MINT_AMOUNT_SATOSHIS.mul(5)
      )
    })
  })

  describe("Multi-Reserve State Transitions", () => {
    it("should handle simultaneous multi-reserve deauthorization", async () => {
      // Establish state with minted tokens
      await mintTokensForReserve(reserve1, MINT_AMOUNT_SATOSHIS)
      await mintTokensForReserve(reserve2, MINT_AMOUNT_SATOSHIS)
      await mintTokensForReserve(reserve3, MINT_AMOUNT_SATOSHIS)

      const initialTotal = await accountControl.totalMinted()
      expect(initialTotal).to.equal(MINT_AMOUNT_SATOSHIS.mul(3))

      // Cannot deauthorize reserves with outstanding balances
      await expect(
        accountControl.connect(owner).deauthorizeReserve(reserve1.address)
      ).to.be.revertedWithCustomError(
        accountControl,
        "CannotDeauthorizeWithOutstandingBalance"
      )

      // Redeem all tokens to zero out balances
      await accountControl.connect(reserve1).redeem(MINT_AMOUNT_SATOSHIS)
      await accountControl.connect(reserve2).redeem(MINT_AMOUNT_SATOSHIS)
      await accountControl.connect(reserve3).redeem(MINT_AMOUNT_SATOSHIS)

      expect(await accountControl.totalMinted()).to.equal(0)

      // Now can deauthorize all reserves
      await expect(
        accountControl.connect(owner).deauthorizeReserve(reserve1.address)
      )
        .to.emit(accountControl, "ReserveDeauthorized")
        .withArgs(reserve1.address, owner.address, await getCurrentTimestamp())

      await expect(
        accountControl.connect(owner).deauthorizeReserve(reserve2.address)
      ).to.emit(accountControl, "ReserveDeauthorized")

      await expect(
        accountControl.connect(owner).deauthorizeReserve(reserve3.address)
      ).to.emit(accountControl, "ReserveDeauthorized")

      // Verify all reserves are deauthorized
      expect(await accountControl.isReserveAuthorized(reserve1.address)).to.be
        .false
      expect(await accountControl.isReserveAuthorized(reserve2.address)).to.be
        .false
      expect(await accountControl.isReserveAuthorized(reserve3.address)).to.be
        .false

      // Reserve list should be empty
      const reserveList = await accountControl.getReserveList()
      expect(reserveList.length).to.equal(0)
    })

    it("should handle cascading reserve operations during state changes", async () => {
      // Setup different backing amounts
      await accountControl.connect(reserve1).updateBacking(BACKING_AMOUNT)
      await accountControl
        .connect(reserve2)
        .updateBacking(BACKING_AMOUNT.mul(2))
      await accountControl
        .connect(reserve3)
        .updateBacking(BACKING_AMOUNT.mul(3))

      // Mint different amounts
      await mintTokensForReserve(reserve1, MINT_AMOUNT_SATOSHIS)
      await mintTokensForReserve(reserve2, MINT_AMOUNT_SATOSHIS.mul(2))
      await mintTokensForReserve(reserve3, MINT_AMOUNT_SATOSHIS.mul(3))

      const expectedTotal = MINT_AMOUNT_SATOSHIS.mul(6) // 1 + 2 + 3
      expect(await accountControl.totalMinted()).to.equal(expectedTotal)

      // Pause reserve2 in the middle
      await accountControl
        .connect(emergencyCouncil)
        .pauseReserve(reserve2.address)

      // Other reserves should continue working
      await mintTokensForReserve(reserve1, MINT_AMOUNT_SATOSHIS)
      await mintTokensForReserve(reserve3, MINT_AMOUNT_SATOSHIS)

      expect(await accountControl.totalMinted()).to.equal(
        expectedTotal.add(MINT_AMOUNT_SATOSHIS.mul(2))
      )

      // Reduce minting caps while operations are ongoing
      // Reserve1 already has 2 BTC minted, set cap to 2.5 BTC so next mint will exceed
      await accountControl
        .connect(owner)
        .setMintingCap(
          reserve1.address,
          MINT_AMOUNT_SATOSHIS.mul(2).add(MINT_AMOUNT_SATOSHIS.div(2))
        )
      await accountControl
        .connect(owner)
        .setMintingCap(reserve3.address, MINT_AMOUNT_SATOSHIS.mul(5))

      // Reserve1 should hit cap (trying to mint 1 BTC but only 0.5 BTC capacity left)
      const tbtcAmount = MINT_AMOUNT_SATOSHIS.mul(SATOSHI_MULTIPLIER)
      await expect(
        accountControl
          .connect(reserve1)
          .mintTBTC(reserve1.address, user.address, tbtcAmount)
      ).to.be.revertedWithCustomError(accountControl, "ExceedsReserveCap")

      // Reserve3 should still have capacity
      await mintTokensForReserve(reserve3, MINT_AMOUNT_SATOSHIS)
    })

    it("should handle oracle updates during various pause states", async () => {
      // Setup initial state
      await mintTokensForReserve(reserve1, MINT_AMOUNT_SATOSHIS)

      // Pause reserve1 but not system
      await accountControl
        .connect(emergencyCouncil)
        .pauseReserve(reserve1.address)

      // Oracle should still be able to update backing for paused reserves
      await expect(
        accountControl
          .connect(oracle)
          .setBacking(reserve1.address, BACKING_AMOUNT.mul(2))
      )
        .to.emit(accountControl, "BackingUpdated")
        .withArgs(
          reserve1.address,
          BACKING_AMOUNT,
          BACKING_AMOUNT.mul(2),
          oracle.address,
          await getCurrentTimestamp()
        )

      // Batch update should work with mixed pause states
      await accountControl
        .connect(emergencyCouncil)
        .pauseReserve(reserve2.address)

      const reserves = [reserve1.address, reserve2.address, reserve3.address]

      const newBackings = [
        BACKING_AMOUNT.mul(3),
        BACKING_AMOUNT.mul(4),
        BACKING_AMOUNT.mul(5),
      ]

      await accountControl
        .connect(oracle)
        .batchSetBacking(reserves, newBackings)

      expect(await accountControl.backing(reserve1.address)).to.equal(
        BACKING_AMOUNT.mul(3)
      )
      expect(await accountControl.backing(reserve2.address)).to.equal(
        BACKING_AMOUNT.mul(4)
      )
      expect(await accountControl.backing(reserve3.address)).to.equal(
        BACKING_AMOUNT.mul(5)
      )

      // Now pause entire system
      await accountControl.connect(emergencyCouncil).pauseSystem()

      // Oracle updates should still work during system pause
      await accountControl
        .connect(oracle)
        .setBacking(reserve1.address, BACKING_AMOUNT.mul(6))
      expect(await accountControl.backing(reserve1.address)).to.equal(
        BACKING_AMOUNT.mul(6)
      )
    })
  })

  describe("Complex Lifecycle Transitions", () => {
    it("should handle complete reserve lifecycle with state preservation", async () => {
      const newReserve = reserve1

      // 1. Authorization
      expect(await accountControl.isReserveAuthorized(newReserve.address)).to.be
        .true

      // 2. Initial operations
      await mintTokensForReserve(newReserve, MINT_AMOUNT_SATOSHIS)
      expect(await accountControl.minted(newReserve.address)).to.equal(
        MINT_AMOUNT_SATOSHIS
      )

      // 3. Pause
      await accountControl
        .connect(emergencyCouncil)
        .pauseReserve(newReserve.address)
      const reserveInfo = await accountControl.reserveInfo(newReserve.address)
      expect(reserveInfo.paused).to.be.true

      // State should be preserved during pause
      expect(await accountControl.minted(newReserve.address)).to.equal(
        MINT_AMOUNT_SATOSHIS
      )
      expect(await accountControl.backing(newReserve.address)).to.equal(
        BACKING_AMOUNT
      )

      // 4. Oracle updates during pause
      await accountControl
        .connect(oracle)
        .setBacking(newReserve.address, BACKING_AMOUNT.mul(2))

      // 5. Unpause
      await accountControl.connect(owner).unpauseReserve(newReserve.address)
      const unpausedInfo = await accountControl.reserveInfo(newReserve.address)
      expect(unpausedInfo.paused).to.be.false

      // 6. Resume operations
      await mintTokensForReserve(newReserve, MINT_AMOUNT_SATOSHIS)
      expect(await accountControl.minted(newReserve.address)).to.equal(
        MINT_AMOUNT_SATOSHIS.mul(2)
      )

      // 7. Wind down
      await accountControl
        .connect(newReserve)
        .redeem(MINT_AMOUNT_SATOSHIS.mul(2))
      expect(await accountControl.minted(newReserve.address)).to.equal(0)

      // 8. Deauthorization
      await accountControl.connect(owner).deauthorizeReserve(newReserve.address)
      expect(await accountControl.isReserveAuthorized(newReserve.address)).to.be
        .false

      // Backing should be cleared
      expect(await accountControl.backing(newReserve.address)).to.equal(0)
    })

    it("should handle role changes during active operations", async () => {
      // Setup active state
      await mintTokensForReserve(reserve1, MINT_AMOUNT_SATOSHIS)

      // Revoke and re-grant MINTER_ROLE
      await accountControl
        .connect(owner)
        .revokeRole(MINTER_ROLE, reserve1.address)

      const tbtcAmount = MINT_AMOUNT_SATOSHIS.mul(SATOSHI_MULTIPLIER)
      await expect(
        accountControl
          .connect(reserve1)
          .mintTBTC(reserve1.address, user.address, tbtcAmount)
      ).to.be.revertedWith("Caller must have MINTER_ROLE")

      // Re-grant role
      await accountControl
        .connect(owner)
        .grantRole(MINTER_ROLE, reserve1.address)

      // Should work again
      await mintTokensForReserve(reserve1, MINT_AMOUNT_SATOSHIS)
      expect(await accountControl.minted(reserve1.address)).to.equal(
        MINT_AMOUNT_SATOSHIS.mul(2)
      )

      // Change oracle role
      await accountControl
        .connect(owner)
        .revokeRole(ORACLE_ROLE, oracle.address)
      const newOracle = reserve3 // Use reserve3 as new oracle

      await accountControl
        .connect(owner)
        .grantRole(ORACLE_ROLE, newOracle.address)

      // Old oracle should fail
      await expect(
        accountControl
          .connect(oracle)
          .setBacking(reserve1.address, BACKING_AMOUNT.mul(2))
      ).to.be.revertedWith("Missing ORACLE_ROLE")

      // New oracle should work
      await accountControl
        .connect(newOracle)
        .setBacking(reserve1.address, BACKING_AMOUNT.mul(2))
      expect(await accountControl.backing(reserve1.address)).to.equal(
        BACKING_AMOUNT.mul(2)
      )
    })

    it("should maintain invariants during complex state transitions", async () => {
      // Setup complex initial state
      await mintTokensForReserve(reserve1, MINT_AMOUNT_SATOSHIS)
      await mintTokensForReserve(reserve2, MINT_AMOUNT_SATOSHIS.mul(2))
      await mintTokensForReserve(reserve3, MINT_AMOUNT_SATOSHIS.mul(3))

      const expectedTotal = MINT_AMOUNT_SATOSHIS.mul(6)
      await validateInvariants(expectedTotal)

      // Pause some reserves
      await accountControl
        .connect(emergencyCouncil)
        .pauseReserve(reserve1.address)
      await accountControl
        .connect(emergencyCouncil)
        .pauseReserve(reserve3.address)
      await validateInvariants(expectedTotal)

      // Oracle updates
      await accountControl
        .connect(oracle)
        .setBacking(reserve1.address, BACKING_AMOUNT.mul(2))
      await accountControl
        .connect(oracle)
        .setBacking(reserve2.address, BACKING_AMOUNT.mul(3))
      await validateInvariants(expectedTotal)

      // Partial redemptions
      await accountControl.connect(reserve2).redeem(MINT_AMOUNT_SATOSHIS)
      const newExpectedTotal = expectedTotal.sub(MINT_AMOUNT_SATOSHIS)
      await validateInvariants(newExpectedTotal)

      // System pause
      await accountControl.connect(emergencyCouncil).pauseSystem()
      await validateInvariants(newExpectedTotal)

      // System unpause
      await accountControl.connect(owner).unpauseSystem()
      await validateInvariants(newExpectedTotal)

      // Resume operations
      await accountControl.connect(owner).unpauseReserve(reserve1.address)
      await mintTokensForReserve(reserve2, MINT_AMOUNT_SATOSHIS)
      const finalExpectedTotal = newExpectedTotal.add(MINT_AMOUNT_SATOSHIS)
      await validateInvariants(finalExpectedTotal)
    })
  })

  // Helper functions
  async function getCurrentTimestamp(): Promise<number> {
    const block = await ethers.provider.getBlock("latest")
    return block.timestamp + 1 // Account for next block
  }

  async function validateInvariants(expectedTotalMinted: ethers.BigNumber) {
    // 1. Total minted should equal sum of individual reserve minted amounts
    const reserve1Minted = await accountControl.minted(reserve1.address)
    const reserve2Minted = await accountControl.minted(reserve2.address)
    const reserve3Minted = await accountControl.minted(reserve3.address)

    const calculatedTotal = reserve1Minted
      .add(reserve2Minted)
      .add(reserve3Minted)

    const actualTotal = await accountControl.totalMinted()
    expect(actualTotal).to.equal(
      calculatedTotal,
      "Total minted != sum of reserves"
    )
    expect(actualTotal).to.equal(
      expectedTotalMinted,
      "Total minted != expected"
    )

    // 2. Each reserve should have backing >= minted (if they have backing)
    for (const reserve of [reserve1, reserve2, reserve3]) {
      const backing = await accountControl.backing(reserve.address)
      const minted = await accountControl.minted(reserve.address)

      const isAuthorized = await accountControl.isReserveAuthorized(
        reserve.address
      )

      if (isAuthorized && backing.gt(0)) {
        expect(backing).to.be.gte(
          minted,
          `Reserve ${reserve.address}: backing < minted`
        )
      }
    }

    // 3. Minted amounts should not exceed caps
    for (const reserve of [reserve1, reserve2, reserve3]) {
      const minted = await accountControl.minted(reserve.address)

      const isAuthorized = await accountControl.isReserveAuthorized(
        reserve.address
      )

      if (isAuthorized) {
        const reserveInfo = await accountControl.reserveInfo(reserve.address)
        expect(minted).to.be.lte(
          reserveInfo.mintingCap,
          `Reserve ${reserve.address}: minted > cap`
        )
      }
    }
  }
})
