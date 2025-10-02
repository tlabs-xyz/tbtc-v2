import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { AccountControl, MockBank } from "../../../typechain"

describe("AccountControl - Role Management", () => {
  let accountControl: AccountControl
  let mockBank: MockBank
  let owner: SignerWithAddress
  let emergencyCouncil: SignerWithAddress
  let qcManager: SignerWithAddress
  let oracle: SignerWithAddress
  let redeemer: SignerWithAddress
  let reserve: SignerWithAddress
  let other: SignerWithAddress

  beforeEach(async () => {
    ;[owner, emergencyCouncil, qcManager, oracle, redeemer, reserve, other] =
      await ethers.getSigners()

    // Deploy mock bank
    const MockBankFactory = await ethers.getContractFactory("MockBank")
    mockBank = await MockBankFactory.deploy()

    // Deploy AccountControl
    const AccountControlFactory = await ethers.getContractFactory(
      "AccountControl"
    )

    accountControl = await AccountControlFactory.deploy(
      owner.address,
      emergencyCouncil.address,
      mockBank.address
    )

    // Authorize AccountControl to mint/burn tokens in the Bank
    await mockBank.authorizeBalanceIncreaser(accountControl.address)
  })

  describe("Role Constants", () => {
    it("should have correct role identifiers", async () => {
      expect(await accountControl.RESERVE_ROLE()).to.equal(
        ethers.utils.id("RESERVE_ROLE")
      )
      expect(await accountControl.ORACLE_ROLE()).to.equal(
        ethers.utils.id("ORACLE_ROLE")
      )
      expect(await accountControl.REDEEMER_ROLE()).to.equal(
        ethers.utils.id("REDEEMER_ROLE")
      )
    })
  })

  describe("RESERVE_ROLE Management", () => {
    it("should allow owner to grant RESERVE_ROLE", async () => {
      await accountControl.connect(owner).grantReserveRole(qcManager.address)

      const RESERVE_ROLE = await accountControl.RESERVE_ROLE()
      expect(await accountControl.hasRole(RESERVE_ROLE, qcManager.address)).to
        .be.true
    })

    it("should allow owner to revoke RESERVE_ROLE", async () => {
      await accountControl.connect(owner).grantReserveRole(qcManager.address)
      await accountControl.connect(owner).revokeReserveRole(qcManager.address)

      const RESERVE_ROLE = await accountControl.RESERVE_ROLE()
      expect(await accountControl.hasRole(RESERVE_ROLE, qcManager.address)).to
        .be.false
    })

    it("should prevent non-owner from granting RESERVE_ROLE", async () => {
      await expect(
        accountControl.connect(other).grantReserveRole(qcManager.address)
      ).to.be.revertedWith("Ownable: caller is not the owner")
    })

    it("should allow RESERVE_ROLE holder to authorize reserves", async () => {
      await accountControl.connect(owner).grantReserveRole(qcManager.address)

      await accountControl.connect(qcManager).authorizeReserve(
        reserve.address,
        ethers.utils.parseUnits("10", 8), // 10 BTC
        1 // ReserveType.QC_PERMISSIONED
      )

      expect(await accountControl.isReserveAuthorized(reserve.address)).to.be
        .true
    })

    it("should allow RESERVE_ROLE holder to set minting caps", async () => {
      // First authorize the reserve
      await accountControl
        .connect(owner)
        .authorizeReserve(reserve.address, ethers.utils.parseUnits("10", 8), 1)

      await accountControl.connect(owner).grantReserveRole(qcManager.address)
      await accountControl
        .connect(qcManager)
        .setMintingCap(reserve.address, ethers.utils.parseUnits("20", 8))

      expect(await accountControl.mintingCaps(reserve.address)).to.equal(
        ethers.utils.parseUnits("20", 8)
      )
    })
  })

  describe("ORACLE_ROLE Management", () => {
    it("should allow owner to grant ORACLE_ROLE", async () => {
      await accountControl.connect(owner).grantOracleRole(oracle.address)

      const ORACLE_ROLE = await accountControl.ORACLE_ROLE()
      expect(await accountControl.hasRole(ORACLE_ROLE, oracle.address)).to.be
        .true
    })

    it("should allow owner to revoke ORACLE_ROLE", async () => {
      await accountControl.connect(owner).grantOracleRole(oracle.address)
      await accountControl.connect(owner).revokeOracleRole(oracle.address)

      const ORACLE_ROLE = await accountControl.ORACLE_ROLE()
      expect(await accountControl.hasRole(ORACLE_ROLE, oracle.address)).to.be
        .false
    })

    it("should allow ORACLE_ROLE holder to set backing", async () => {
      // First authorize a reserve
      await accountControl
        .connect(owner)
        .authorizeReserve(reserve.address, ethers.utils.parseUnits("10", 8), 1)

      await accountControl.connect(owner).grantOracleRole(oracle.address)
      await accountControl
        .connect(oracle)
        .setBacking(reserve.address, ethers.utils.parseUnits("5", 8))

      expect(await accountControl.backing(reserve.address)).to.equal(
        ethers.utils.parseUnits("5", 8)
      )
    })

    it("should prevent non-ORACLE_ROLE holder from setting backing", async () => {
      await accountControl
        .connect(owner)
        .authorizeReserve(reserve.address, ethers.utils.parseUnits("10", 8), 1)

      await expect(
        accountControl
          .connect(other)
          .setBacking(reserve.address, ethers.utils.parseUnits("5", 8))
      ).to.be.revertedWith("Missing ORACLE_ROLE")
    })
  })

  describe("REDEEMER_ROLE Management", () => {
    it("should allow owner to grant REDEEMER_ROLE", async () => {
      await accountControl.connect(owner).grantRedeemerRole(redeemer.address)

      const REDEEMER_ROLE = await accountControl.REDEEMER_ROLE()
      expect(await accountControl.hasRole(REDEEMER_ROLE, redeemer.address)).to
        .be.true
    })

    it("should allow owner to revoke REDEEMER_ROLE", async () => {
      await accountControl.connect(owner).grantRedeemerRole(redeemer.address)
      await accountControl.connect(owner).revokeRedeemerRole(redeemer.address)

      const REDEEMER_ROLE = await accountControl.REDEEMER_ROLE()
      expect(await accountControl.hasRole(REDEEMER_ROLE, redeemer.address)).to
        .be.false
    })

    it("should allow REDEEMER_ROLE holder to notify redemptions", async () => {
      // Setup reserve with backing and minted amount
      await accountControl
        .connect(owner)
        .authorizeReserve(reserve.address, ethers.utils.parseUnits("10", 8), 1)

      // Grant oracle role to set backing
      await accountControl.connect(owner).grantOracleRole(owner.address)
      await accountControl
        .connect(owner)
        .setBacking(reserve.address, ethers.utils.parseUnits("10", 8))

      // Mint some tokens first
      await accountControl
        .connect(reserve)
        .mintTBTC(other.address, ethers.utils.parseUnits("1", 18))

      // Grant redeemer role and notify redemption
      await accountControl.connect(owner).grantRedeemerRole(redeemer.address)
      await accountControl
        .connect(redeemer)
        .notifyRedemption(reserve.address, ethers.utils.parseUnits("0.5", 8))

      expect(await accountControl.minted(reserve.address)).to.equal(
        ethers.utils.parseUnits("0.5", 8)
      )
    })
  })

  describe("Role Interactions", () => {
    it("should allow multiple roles on same address", async () => {
      await accountControl.connect(owner).grantReserveRole(qcManager.address)
      await accountControl.connect(owner).grantOracleRole(qcManager.address)

      const RESERVE_ROLE = await accountControl.RESERVE_ROLE()
      const ORACLE_ROLE = await accountControl.ORACLE_ROLE()

      expect(await accountControl.hasRole(RESERVE_ROLE, qcManager.address)).to
        .be.true
      expect(await accountControl.hasRole(ORACLE_ROLE, qcManager.address)).to.be
        .true
    })

    it("should maintain role separation", async () => {
      await accountControl.connect(owner).grantOracleRole(oracle.address)

      // Oracle should NOT be able to authorize reserves (requires RESERVE_ROLE)
      await expect(
        accountControl
          .connect(oracle)
          .authorizeReserve(
            reserve.address,
            ethers.utils.parseUnits("10", 8),
            1
          )
      ).to.be.revertedWithCustomError(accountControl, "NotAuthorized")
    })
  })

  describe("Emergency Council", () => {
    it("should allow emergency council to pause reserves", async () => {
      await accountControl
        .connect(owner)
        .authorizeReserve(reserve.address, ethers.utils.parseUnits("10", 8), 1)

      await accountControl
        .connect(emergencyCouncil)
        .pauseReserve(reserve.address)

      const reserveInfo = await accountControl.reserveInfo(reserve.address)
      expect(reserveInfo.paused).to.be.true
    })

    it("should not allow emergency council to unpause reserves", async () => {
      await accountControl
        .connect(owner)
        .authorizeReserve(reserve.address, ethers.utils.parseUnits("10", 8), 1)

      await accountControl
        .connect(emergencyCouncil)
        .pauseReserve(reserve.address)

      await expect(
        accountControl.connect(emergencyCouncil).unpauseReserve(reserve.address)
      ).to.be.revertedWith("Ownable: caller is not the owner")
    })
  })
})
