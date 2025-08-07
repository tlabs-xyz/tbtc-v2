import { ethers, deployments, helpers } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber } from "ethers"
import {
  QCWatchdog,
  QCManager,
  QCReserveLedger,
  QCRedeemer,
  WatchdogMonitor,
  WatchdogConsensusManager,
  SystemState,
  Bank,
  BasicMintingPolicy,
  BasicRedemptionPolicy,
} from "../../typechain"

const HOUR = 3600
const DAY = 86400
const WEEK = 604800

describe("QCWatchdog Integration Tests", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let watchdog1: SignerWithAddress
  let watchdog2: SignerWithAddress
  let watchdog3: SignerWithAddress
  let watchdog4: SignerWithAddress
  let watchdog5: SignerWithAddress
  let qc1: SignerWithAddress
  let qc2: SignerWithAddress
  let user: SignerWithAddress
  let arbiter: SignerWithAddress

  let qcWatchdog1: QCWatchdog
  let qcWatchdog2: QCWatchdog
  let qcWatchdog3: QCWatchdog
  let qcManager: QCManager
  let qcQCReserveLedger: QCReserveLedger
  let qcRedeemer: QCRedeemer
  let watchdogMonitor: WatchdogMonitor
  let watchdogConsensusManager: WatchdogConsensusManager
  let systemState: SystemState
  let bank: Bank
  let mintingPolicy: BasicMintingPolicy
  let redemptionPolicy: BasicRedemptionPolicy

  const validLegacyBtc = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT"
  const validBech32Btc = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
  const p2shBtc = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"

  beforeEach(async () => {
    await deployments.fixture(["AccountControl"])
    ;({ deployer, governance } = await helpers.signers.getNamedSigners())
    ;[watchdog1, watchdog2, watchdog3, watchdog4, watchdog5, qc1, qc2, user, arbiter] = 
      await helpers.signers.getUnnamedSigners()

    // Get deployed contracts
    qcManager = await helpers.contracts.getContract("QCManager")
    qcQCReserveLedger = await helpers.contracts.getContract("QCReserveLedger") 
    qcRedeemer = await helpers.contracts.getContract("QCRedeemer")
    watchdogMonitor = await helpers.contracts.getContract("WatchdogMonitor")
    watchdogConsensusManager = await helpers.contracts.getContract("WatchdogConsensusManager")
    systemState = await helpers.contracts.getContract("SystemState")
    bank = await helpers.contracts.getContract("Bank")
    mintingPolicy = await helpers.contracts.getContract("BasicMintingPolicy")
    redemptionPolicy = await helpers.contracts.getContract("BasicRedemptionPolicy")

    // Deploy individual watchdog instances
    const QCWatchdog = await ethers.getContractFactory("QCWatchdog")
    qcWatchdog1 = await QCWatchdog.deploy(
      qcManager.address,
      qcQCReserveLedger.address,
      qcRedeemer.address,
      systemState.address
    )
    qcWatchdog2 = await QCWatchdog.deploy(
      qcManager.address,
      qcQCReserveLedger.address,
      qcRedeemer.address,
      systemState.address
    )
    qcWatchdog3 = await QCWatchdog.deploy(
      qcManager.address,
      qcQCReserveLedger.address,
      qcRedeemer.address,
      systemState.address
    )

    // Grant roles
    await qcWatchdog1.connect(deployer).grantRole(
      await qcWatchdog1.WATCHDOG_OPERATOR_ROLE(),
      watchdog1.address
    )
    await qcWatchdog2.connect(deployer).grantRole(
      await qcWatchdog2.WATCHDOG_OPERATOR_ROLE(),
      watchdog2.address
    )
    await qcWatchdog3.connect(deployer).grantRole(
      await qcWatchdog3.WATCHDOG_OPERATOR_ROLE(),
      watchdog3.address
    )

    // Register watchdogs with monitor
    await watchdogMonitor.connect(governance).registerWatchdog(
      qcWatchdog1.address,
      "Watchdog 1"
    )
    await watchdogMonitor.connect(governance).registerWatchdog(
      qcWatchdog2.address,
      "Watchdog 2"
    )
    await watchdogMonitor.connect(governance).registerWatchdog(
      qcWatchdog3.address,
      "Watchdog 3"
    )

    // Register watchdogs with consensus manager
    await watchdogConsensusManager.connect(governance).addWatchdog(watchdog1.address)
    await watchdogConsensusManager.connect(governance).addWatchdog(watchdog2.address)
    await watchdogConsensusManager.connect(governance).addWatchdog(watchdog3.address)
    await watchdogConsensusManager.connect(governance).addWatchdog(watchdog4.address)
    await watchdogConsensusManager.connect(governance).addWatchdog(watchdog5.address)

    // Grant arbiter role
    await qcRedeemer.connect(governance).grantRole(
      await qcRedeemer.ARBITER_ROLE(),
      arbiter.address
    )

    // Register QCs
    await qcManager.connect(governance).registerQC(qc1.address, "QC1")
    await qcManager.connect(governance).registerQC(qc2.address, "QC2")
  })

  describe("QCWatchdog → QCManager Integration", () => {
    it("should handle complete wallet registration flow", async () => {
      const walletPubKey = "0x" + "aa".repeat(20)
      const btcAddress = validLegacyBtc
      const proofData = ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "uint256", "bytes", "bytes", "uint256"],
        [ethers.utils.keccak256("0x1234"), 100, "0x", "0x", 0]
      )

      // Register wallet through watchdog
      await expect(
        qcWatchdog1.connect(watchdog1).registerQCWallet(
          qc1.address,
          walletPubKey,
          btcAddress,
          proofData
        )
      )
        .to.emit(qcManager, "WalletRegistered")
        .withArgs(qc1.address, walletPubKey, btcAddress)

      // Verify wallet is registered
      const isRegistered = await qcManager.isWalletRegistered(qc1.address, walletPubKey)
      expect(isRegistered).to.be.true

      // Verify wallet details
      const walletInfo = await qcManager.qcWallets(qc1.address, walletPubKey)
      expect(walletInfo.btcAddress).to.equal(btcAddress)
      expect(walletInfo.isActive).to.be.true
    })

    it("should respect paused state for operations", async () => {
      // Pause registrations
      await systemState.connect(governance).pauseRegistrations()

      const walletPubKey = "0x" + "bb".repeat(20)
      const proofData = ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "uint256", "bytes", "bytes", "uint256"],
        [ethers.utils.keccak256("0x1234"), 100, "0x", "0x", 0]
      )

      // Attempt registration while paused
      await expect(
        qcWatchdog1.connect(watchdog1).registerQCWallet(
          qc1.address,
          walletPubKey,
          validLegacyBtc,
          proofData
        )
      ).to.be.revertedWith("System paused")

      // Unpause and retry
      await systemState.connect(governance).unpauseRegistrations()
      
      await expect(
        qcWatchdog1.connect(watchdog1).registerQCWallet(
          qc1.address,
          walletPubKey,
          validLegacyBtc,
          proofData
        )
      ).to.emit(qcManager, "WalletRegistered")
    })

    it("should handle reserve attestation with staleness checks", async () => {
      const reserves = ethers.utils.parseEther("100")
      
      // First attestation
      await expect(
        qcWatchdog1.connect(watchdog1).attestReserves(qc1.address, reserves)
      )
        .to.emit(qcQCReserveLedger, "ReservesAttested")
        .withArgs(qc1.address, reserves)

      // Check current reserves
      const currentReserves = await qcQCReserveLedger.getCurrentReserves(qc1.address)
      expect(currentReserves).to.equal(reserves)

      // Fast forward past staleness period
      await helpers.time.increaseTime(WEEK + 1)

      // Reserves should now be stale
      await expect(
        qcQCReserveLedger.getCurrentReserves(qc1.address)
      ).to.be.revertedWith("Reserves attestation is stale")

      // Fresh attestation
      const newReserves = ethers.utils.parseEther("150")
      await qcWatchdog2.connect(watchdog2).attestReserves(qc1.address, newReserves)

      // Should work again
      const updatedReserves = await qcQCReserveLedger.getCurrentReserves(qc1.address)
      expect(updatedReserves).to.equal(newReserves)
    })
  })

  describe("QCWatchdog → QCRedeemer Integration", () => {
    let redemptionId: string

    beforeEach(async () => {
      // Setup: Register wallet and attest reserves
      const walletPubKey = "0x" + "cc".repeat(20)
      const proofData = ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "uint256", "bytes", "bytes", "uint256"],
        [ethers.utils.keccak256("0x1234"), 100, "0x", "0x", 0]
      )

      await qcWatchdog1.connect(watchdog1).registerQCWallet(
        qc1.address,
        walletPubKey,
        validLegacyBtc,
        proofData
      )

      await qcWatchdog1.connect(watchdog1).attestReserves(
        qc1.address,
        ethers.utils.parseEther("1000")
      )

      // Give bank some balance
      await bank.connect(deployer).increaseBalance(
        qc1.address,
        ethers.utils.parseEther("100")
      )
    })

    it("should handle complete redemption lifecycle", async () => {
      const amount = ethers.utils.parseEther("10")
      const btcAddress = validBech32Btc

      // Initiate redemption
      const tx = await qcRedeemer.connect(qc1).initiateRedemption(
        amount,
        btcAddress,
        btcAddress
      )
      const receipt = await tx.wait()
      const event = receipt.events?.find(e => e.event === "RedemptionInitiated")
      redemptionId = event?.args?.redemptionId

      // Fulfill redemption through watchdog
      const btcTxHash = "0x" + "dd".repeat(32)
      await expect(
        qcWatchdog1.connect(watchdog1).fulfillRedemption(
          redemptionId,
          btcTxHash
        )
      )
        .to.emit(qcRedeemer, "RedemptionFulfilled")
        .withArgs(redemptionId, btcTxHash)

      // Verify redemption state
      const redemption = await qcRedeemer.redemptions(redemptionId)
      expect(redemption.status).to.equal(2) // Fulfilled
    })

    it("should handle redemption timeout and default", async () => {
      const amount = ethers.utils.parseEther("10")

      // Initiate redemption
      const tx = await qcRedeemer.connect(qc1).initiateRedemption(
        amount,
        validLegacyBtc,
        validLegacyBtc
      )
      const receipt = await tx.wait()
      const event = receipt.events?.find(e => e.event === "RedemptionInitiated")
      redemptionId = event?.args?.redemptionId

      // Fast forward past timeout
      await helpers.time.increaseTime(2 * DAY + 1)

      // Should be defaultable
      await expect(
        qcRedeemer.connect(arbiter).defaultRedemption(redemptionId)
      )
        .to.emit(qcRedeemer, "RedemptionDefaulted")
        .withArgs(redemptionId)

      // Verify state
      const redemption = await qcRedeemer.redemptions(redemptionId)
      expect(redemption.status).to.equal(3) // Defaulted
    })
  })

  describe("Cross-Contract State Consistency", () => {
    it("should maintain consistent state across QCManager and QCReserveLedger", async () => {
      // Register QC in manager
      const qc3 = await helpers.signers.getUnnamedSigners().then(s => s[10])
      await qcManager.connect(governance).registerQC(qc3.address, "QC3")

      // Verify QC is active in manager
      const qcData = await qcManager.qcs(qc3.address)
      expect(qcData.isActive).to.be.true

      // Attest reserves through watchdog
      const reserves = ethers.utils.parseEther("500")
      await qcWatchdog1.connect(watchdog1).attestReserves(qc3.address, reserves)

      // Verify reserves in ledger
      const currentReserves = await qcQCReserveLedger.getCurrentReserves(qc3.address)
      expect(currentReserves).to.equal(reserves)

      // Deactivate QC
      await qcManager.connect(governance).deactivateQC(qc3.address)

      // Should still be able to read reserves (but QC is inactive)
      const reservesAfter = await qcQCReserveLedger.getCurrentReserves(qc3.address)
      expect(reservesAfter).to.equal(reserves)

      // But new operations should fail
      await expect(
        qcWatchdog1.connect(watchdog1).attestReserves(
          qc3.address,
          ethers.utils.parseEther("600")
        )
      ).to.be.revertedWith("QC not active")
    })

    it("should handle policy integration correctly", async () => {
      // Setup: Register wallet and attest reserves
      const walletPubKey = "0x" + "dd".repeat(20)
      const proofData = ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "uint256", "bytes", "bytes", "uint256"],
        [ethers.utils.keccak256("0x1234"), 100, "0x", "0x", 0]
      )

      await qcWatchdog1.connect(watchdog1).registerQCWallet(
        qc1.address,
        walletPubKey,
        validLegacyBtc,
        proofData
      )

      const reserves = ethers.utils.parseEther("1000")
      await qcWatchdog1.connect(watchdog1).attestReserves(qc1.address, reserves)

      // Grant minter role to policy
      await bank.connect(governance).grantRole(
        await bank.MINTER_ROLE(),
        mintingPolicy.address
      )

      // Mint through policy (simulating the flow)
      const mintAmount = ethers.utils.parseEther("100")
      
      // Policy would check reserves and call bank.increaseBalanceAndCall
      // For testing, we'll verify the policy can interact correctly
      const canMint = await mintingPolicy.canMint(qc1.address, mintAmount)
      expect(canMint).to.be.true

      // Verify reserve ratio would be maintained
      const totalSupply = await bank.balanceOf(qc1.address)
      const ratio = reserves.mul(100).div(totalSupply.add(mintAmount))
      expect(ratio).to.be.gte(100) // At least 100% collateralized
    })
  })

  describe("Concurrent Operations", () => {
    it("should handle multiple watchdogs attesting reserves simultaneously", async () => {
      const reserves1 = ethers.utils.parseEther("100")
      const reserves2 = ethers.utils.parseEther("150")
      const reserves3 = ethers.utils.parseEther("200")

      // All watchdogs attest different values
      const tx1 = qcWatchdog1.connect(watchdog1).attestReserves(qc1.address, reserves1)
      const tx2 = qcWatchdog2.connect(watchdog2).attestReserves(qc1.address, reserves2)
      const tx3 = qcWatchdog3.connect(watchdog3).attestReserves(qc1.address, reserves3)

      // Wait for all transactions
      await Promise.all([tx1, tx2, tx3])

      // The last successful attestation should be the current value
      const currentReserves = await qcQCReserveLedger.getCurrentReserves(qc1.address)
      expect([reserves1, reserves2, reserves3]).to.include(currentReserves)
    })

    it("should handle race conditions in wallet registration", async () => {
      const walletPubKey = "0x" + "ee".repeat(20)
      const proofData = ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "uint256", "bytes", "bytes", "uint256"],
        [ethers.utils.keccak256("0x1234"), 100, "0x", "0x", 0]
      )

      // Two watchdogs try to register the same wallet
      const tx1 = qcWatchdog1.connect(watchdog1).registerQCWallet(
        qc1.address,
        walletPubKey,
        validLegacyBtc,
        proofData
      )
      const tx2 = qcWatchdog2.connect(watchdog2).registerQCWallet(
        qc1.address,
        walletPubKey,
        validLegacyBtc,
        proofData
      )

      // One should succeed, one should fail
      const results = await Promise.allSettled([tx1, tx2])
      const successes = results.filter(r => r.status === "fulfilled").length
      const failures = results.filter(r => r.status === "rejected").length

      expect(successes).to.equal(1)
      expect(failures).to.equal(1)

      // Wallet should be registered exactly once
      const isRegistered = await qcManager.isWalletRegistered(qc1.address, walletPubKey)
      expect(isRegistered).to.be.true
    })
  })

  describe("Role-Based Access Control", () => {
    it("should enforce watchdog operator permissions", async () => {
      const unauthorizedSigner = await helpers.signers.getUnnamedSigners().then(s => s[11])

      // Attempt operations without role
      await expect(
        qcWatchdog1.connect(unauthorizedSigner).attestReserves(
          qc1.address,
          ethers.utils.parseEther("100")
        )
      ).to.be.revertedWith("AccessControl: account")

      await expect(
        qcWatchdog1.connect(unauthorizedSigner).registerQCWallet(
          qc1.address,
          "0x" + "ff".repeat(20),
          validLegacyBtc,
          "0x"
        )
      ).to.be.revertedWith("AccessControl: account")
    })

    it("should enforce governance permissions on critical operations", async () => {
      const unauthorizedSigner = await helpers.signers.getUnnamedSigners().then(s => s[12])

      // Attempt QC registration without governance role
      await expect(
        qcManager.connect(unauthorizedSigner).registerQC(
          unauthorizedSigner.address,
          "Unauthorized QC"
        )
      ).to.be.revertedWith("AccessControl: account")

      // Attempt to pause system without role
      await expect(
        systemState.connect(unauthorizedSigner).pauseAll()
      ).to.be.revertedWith("AccessControl: account")
    })
  })

  describe("Edge Cases and Error Handling", () => {
    it("should handle invalid Bitcoin addresses", async () => {
      const walletPubKey = "0x" + "ab".repeat(20)
      const invalidBtcAddress = "invalid_btc_address"
      const proofData = "0x"

      await expect(
        qcWatchdog1.connect(watchdog1).registerQCWallet(
          qc1.address,
          walletPubKey,
          invalidBtcAddress,
          proofData
        )
      ).to.be.revertedWith("Invalid Bitcoin address format")
    })

    it("should handle zero reserve attestations", async () => {
      await expect(
        qcWatchdog1.connect(watchdog1).attestReserves(qc1.address, 0)
      ).to.be.revertedWith("Reserves must be greater than 0")
    })

    it("should handle redemptions exceeding bank balance", async () => {
      // Give QC small balance
      await bank.connect(deployer).increaseBalance(
        qc1.address,
        ethers.utils.parseEther("1")
      )

      // Try to redeem more than balance
      await expect(
        qcRedeemer.connect(qc1).initiateRedemption(
          ethers.utils.parseEther("10"),
          validLegacyBtc,
          validLegacyBtc
        )
      ).to.be.revertedWith("Insufficient balance")
    })
  })
})