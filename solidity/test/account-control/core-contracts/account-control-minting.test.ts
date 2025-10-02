import { expect } from "chai"
import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

import { AccountControl } from "../../../typechain"
import { setupAccountControlForTesting } from "../../helpers/role-setup-utils"

describe("AccountControl mintTBTC Functionality", () => {
  let accountControl: AccountControl
  let owner: SignerWithAddress
  let emergencyCouncil: SignerWithAddress
  let mockBank: any
  let reserve: SignerWithAddress
  let user: SignerWithAddress

  // Helper constants for wei amounts
  const ONE_SATOSHI_IN_WEI = ethers.BigNumber.from("10000000000") // 1e10 wei per satoshi
  const ONE_BTC_IN_SATOSHIS = ethers.BigNumber.from("100000000") // 1e8 satoshis per BTC
  const ONE_TBTC = ethers.utils.parseEther("1") // 1e18 wei (1 tBTC)

  beforeEach(async () => {
    ;[owner, emergencyCouncil, reserve, user] = await ethers.getSigners()

    // Deploy mock Bank
    const MockBankFactory = await ethers.getContractFactory("MockBank")
    mockBank = await MockBankFactory.deploy()

    const AccountControlFactory = await ethers.getContractFactory(
      "AccountControl"
    )

    accountControl = await AccountControlFactory.deploy(
      owner.address,
      emergencyCouncil.address,
      mockBank.address
    )

    // Authorize AccountControl to call MockBank functions
    await mockBank.authorizeBalanceIncreaser(accountControl.address)

    // Authorize a reserve with 10 BTC cap
    const mintingCap = ONE_BTC_IN_SATOSHIS.mul(10) // 10 BTC in satoshis
    await accountControl
      .connect(owner)
      .authorizeReserve(reserve.address, mintingCap, 1) // ReserveType.QC_PERMISSIONED

    // Set backing for the reserve (10 BTC)
    const backing = ONE_BTC_IN_SATOSHIS.mul(10) // 10 BTC in satoshis
    await accountControl.connect(reserve).updateBacking(backing)

    // Grant MINTER_ROLE to reserve for testing
    const MINTER_ROLE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("MINTER_ROLE")
    )

    await accountControl.connect(owner).grantRole(MINTER_ROLE, reserve.address)

    // Setup additional authorization for other test signers in case they're used
    const allSigners = await ethers.getSigners()
    await setupAccountControlForTesting(accountControl, allSigners, owner)
  })

  describe("mintTBTC return value", () => {
    it("should return satoshi amount after successful mint", async () => {
      const tbtcAmount = ONE_TBTC // 1 tBTC (1e18)
      const expectedSatoshis = ONE_BTC_IN_SATOSHIS // 1 BTC in satoshis (1e8)

      // Call mintTBTC and capture return value
      const returnedSatoshis = await accountControl
        .connect(reserve)
        .callStatic.mintTBTC(reserve.address, user.address, tbtcAmount)

      expect(returnedSatoshis).to.equal(expectedSatoshis)
    })

    it("should correctly convert and mint for various tBTC amounts", async () => {
      const testCases = [
        {
          tbtc: ONE_TBTC.div(10),
          expectedSatoshis: ONE_BTC_IN_SATOSHIS.div(10),
        }, // 0.1 tBTC -> 0.1 BTC in satoshis
        {
          tbtc: ONE_TBTC.div(100),
          expectedSatoshis: ONE_BTC_IN_SATOSHIS.div(100),
        }, // 0.01 tBTC -> 0.01 BTC in satoshis
        { tbtc: ONE_TBTC.mul(5), expectedSatoshis: ONE_BTC_IN_SATOSHIS.mul(5) }, // 5 tBTC -> 5 BTC in satoshis
      ]

      for (const testCase of testCases) {
        const returnedSatoshis = await accountControl
          .connect(reserve)
          .callStatic.mintTBTC(reserve.address, user.address, testCase.tbtc)

        expect(returnedSatoshis).to.equal(testCase.expectedSatoshis)
      }
    })

    it("should properly update minted amounts using satoshi amount", async () => {
      const tbtcAmount = ONE_TBTC.mul(2) // 2 tBTC
      const expectedSatoshis = ONE_BTC_IN_SATOSHIS.mul(2) // 2 BTC in satoshis

      // Get initial minted amount
      const initialMinted = await accountControl.minted(reserve.address)

      // Execute mintTBTC
      const _tx = await accountControl
        .connect(reserve)
        .mintTBTC(reserve.address, user.address, tbtcAmount)

      // Check that minted amount increased by satoshis
      const finalMinted = await accountControl.minted(reserve.address)
      expect(finalMinted.sub(initialMinted)).to.equal(expectedSatoshis)
    })

    it("should emit MintExecuted event with satoshi amount", async () => {
      const tbtcAmount = ONE_TBTC // 1 tBTC
      const expectedSatoshis = ONE_BTC_IN_SATOSHIS // 1 BTC in satoshis

      const tx = await accountControl
        .connect(reserve)
        .mintTBTC(reserve.address, user.address, tbtcAmount)

      const receipt = await tx.wait()
      const { timestamp } = await ethers.provider.getBlock(receipt.blockNumber)

      expect(tx)
        .to.emit(accountControl, "MintExecuted")
        .withArgs(
          reserve.address,
          user.address,
          expectedSatoshis,
          reserve.address,
          timestamp
        )
    })

    it("should enforce minimum mint amount", async () => {
      const MIN_MINT_AMOUNT = ethers.utils.parseEther("0.0001") // 0.0001 tBTC in wei

      // Try to mint less than minimum (0.00005 tBTC)
      const tooSmallAmount = MIN_MINT_AMOUNT.div(2)

      await expect(
        accountControl
          .connect(reserve)
          .mintTBTC(reserve.address, user.address, tooSmallAmount)
      ).to.be.revertedWithCustomError(accountControl, "AmountTooSmall")
    })

    it("should enforce maximum single mint", async () => {
      // First increase backing to allow large mint
      const largeBacking = ethers.utils.parseEther("200") // 200 tBTC
      await accountControl.connect(reserve).updateBacking(largeBacking)

      // Update minting cap to allow large mint
      await accountControl
        .connect(owner)
        .setMintingCap(reserve.address, largeBacking)

      const MAX_SINGLE_MINT = ethers.utils.parseEther("100") // 100 tBTC in wei

      // Try to mint more than maximum (101 tBTC)
      const tooLargeAmount = MAX_SINGLE_MINT.add(ethers.utils.parseEther("1"))

      await expect(
        accountControl
          .connect(reserve)
          .mintTBTC(reserve.address, user.address, tooLargeAmount)
      ).to.be.revertedWithCustomError(accountControl, "AmountTooLarge")
    })

    it("should check backing using satoshi amounts", async () => {
      // Set backing to 1 BTC in satoshis
      await accountControl.connect(reserve).updateBacking(ONE_BTC_IN_SATOSHIS)

      // Try to mint 2 tBTC (more than backing)
      const tbtcAmount = ONE_TBTC.mul(2)

      await expect(
        accountControl
          .connect(reserve)
          .mintTBTC(reserve.address, user.address, tbtcAmount)
      ).to.be.revertedWithCustomError(accountControl, "InsufficientBacking")
    })

    it("should reject amounts with precision loss", async () => {
      // Test with amount that would have precision loss in satoshi conversion
      // This should revert because it's not divisible by ONE_SATOSHI_IN_WEI (10^10)
      const fractionalTBTC = ethers.BigNumber.from("123456789000000000") // 0.123456789 tBTC

      await expect(
        accountControl
          .connect(reserve)
          .mintTBTC(reserve.address, user.address, fractionalTBTC)
      ).to.be.revertedWith("Bad precision")
    })
  })

  describe("mintTBTC integration with QCMinter", () => {
    it("should work correctly with QCMinter patterns", async () => {
      // This test validates that the return value can be used directly
      // by QCMinter for event emission

      const tbtcAmount = ONE_TBTC.mul(3) // 3 tBTC

      // Simulate what QCMinter does:
      // 1. Call mintTBTC and get satoshis back
      const satoshis = await accountControl
        .connect(reserve)
        .callStatic.mintTBTC(reserve.address, user.address, tbtcAmount)

      // 2. Use returned satoshi amount for event data
      expect(satoshis).to.equal(ONE_BTC_IN_SATOSHIS.mul(3))

      // 3. Verify the conversion from tBTC to satoshis
      expect(satoshis).to.equal(tbtcAmount.div(ONE_SATOSHI_IN_WEI))
    })
  })
})
