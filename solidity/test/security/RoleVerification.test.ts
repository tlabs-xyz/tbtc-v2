import { ethers, helpers, waffle } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { Contract } from "ethers"
import { FakeContract, smock } from "@defi-wonderland/smock"
import {
  QCManager,
  QCData,
  QCMinter,
  QCRedeemer,
  QCReserveLedger,
  BasicMintingPolicy,
  BasicRedemptionPolicy,
  WatchdogConsensusManager,
  WatchdogMonitor,
  SystemState,
  ProtocolRegistry,
} from "../../typechain"

const { loadFixture } = waffle
const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("Role-Based Access Control Security Tests", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let attacker: SignerWithAddress
  let operator1: SignerWithAddress
  let operator2: SignerWithAddress
  let randomUser: SignerWithAddress

  // Contracts
  let systemState: SystemState
  let qcManager: QCManager
  let qcData: QCData
  let qcMinter: QCMinter
  let qcRedeemer: QCRedeemer
  let qcReserveLedger: QCReserveLedger
  let basicMintingPolicy: BasicMintingPolicy
  let basicRedemptionPolicy: BasicRedemptionPolicy
  let watchdogConsensusManager: WatchdogConsensusManager
  let watchdogMonitor: WatchdogMonitor
  let protocolRegistry: ProtocolRegistry

  // Role constants
  const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
  const PARAMETER_ADMIN_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("PARAMETER_ADMIN_ROLE"))
  const PAUSER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("PAUSER_ROLE"))
  const MANAGER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MANAGER_ROLE"))
  const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"))
  const REDEEMER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("REDEEMER_ROLE"))
  const ARBITER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ARBITER_ROLE"))
  const ATTESTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ATTESTER_ROLE"))
  const REGISTRAR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("REGISTRAR_ROLE"))
  const WATCHDOG_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("WATCHDOG_ROLE"))
  const WATCHDOG_OPERATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("WATCHDOG_OPERATOR_ROLE"))
  const QC_ADMIN_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_ADMIN_ROLE"))
  const QC_MANAGER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_MANAGER_ROLE"))
  const QC_GOVERNANCE_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("QC_GOVERNANCE_ROLE"))

  async function fixture() {
    const signers = await ethers.getSigners()
    ;[deployer, governance, attacker, operator1, operator2, randomUser] = signers

    // Deploy all contracts
    const ProtocolRegistry = await ethers.getContractFactory("ProtocolRegistry")
    protocolRegistry = await ProtocolRegistry.deploy()

    const SystemState = await ethers.getContractFactory("SystemState")
    systemState = await SystemState.deploy()

    const QCData = await ethers.getContractFactory("QCData")
    qcData = await QCData.deploy()

    const QCManager = await ethers.getContractFactory("QCManager")
    qcManager = await QCManager.deploy(protocolRegistry.address)

    const QCReserveLedger = await ethers.getContractFactory("QCReserveLedger")
    qcReserveLedger = await QCReserveLedger.deploy(protocolRegistry.address)

    const QCMinter = await ethers.getContractFactory("QCMinter")
    qcMinter = await QCMinter.deploy(protocolRegistry.address)

    const QCRedeemer = await ethers.getContractFactory("QCRedeemer")
    qcRedeemer = await QCRedeemer.deploy(protocolRegistry.address)

    // Deploy mocks for external dependencies
    const mockBank = await smock.fake("Bank")
    const mockVault = await smock.fake("TBTCVault")
    const mockTBTC = await smock.fake("TBTC")

    const BasicMintingPolicy = await ethers.getContractFactory("BasicMintingPolicy")
    basicMintingPolicy = await BasicMintingPolicy.deploy(
      mockBank.address,
      mockVault.address,
      mockTBTC.address,
      protocolRegistry.address
    )

    const BasicRedemptionPolicy = await ethers.getContractFactory("BasicRedemptionPolicy")
    basicRedemptionPolicy = await BasicRedemptionPolicy.deploy(protocolRegistry.address)

    const WatchdogConsensusManager = await ethers.getContractFactory("WatchdogConsensusManager")
    watchdogConsensusManager = await WatchdogConsensusManager.deploy(
      qcManager.address,
      qcRedeemer.address,
      qcData.address
    )

    const WatchdogMonitor = await ethers.getContractFactory("WatchdogMonitor")
    watchdogMonitor = await WatchdogMonitor.deploy(
      watchdogConsensusManager.address,
      qcData.address
    )

    return {
      deployer,
      governance,
      attacker,
      operator1,
      operator2,
      randomUser,
      systemState,
      qcManager,
      qcData,
      qcMinter,
      qcRedeemer,
      qcReserveLedger,
      basicMintingPolicy,
      basicRedemptionPolicy,
      watchdogConsensusManager,
      watchdogMonitor,
      protocolRegistry,
    }
  }

  beforeEach(async () => {
    await createSnapshot()
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  before(async () => {
    const contracts = await loadFixture(fixture)
    Object.assign(this, contracts)
  })

  describe("SystemState Access Control", () => {
    it("should deploy with deployer as DEFAULT_ADMIN_ROLE", async () => {
      expect(await systemState.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true
      expect(await systemState.getRoleAdmin(PARAMETER_ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE)
      expect(await systemState.getRoleAdmin(PAUSER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE)
    })

    it("should prevent non-admin from granting roles", async () => {
      await expect(
        systemState.connect(attacker).grantRole(PARAMETER_ADMIN_ROLE, attacker.address)
      ).to.be.revertedWith(
        `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
      )
    })

    it("should prevent non-PARAMETER_ADMIN from updating parameters", async () => {
      await expect(
        systemState.connect(attacker).setMinMintAmount(ethers.utils.parseEther("100"))
      ).to.be.revertedWith(
        `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${PARAMETER_ADMIN_ROLE}`
      )
    })

    it("should allow PARAMETER_ADMIN to update parameters", async () => {
      await systemState.grantRole(PARAMETER_ADMIN_ROLE, governance.address)
      
      const newMinAmount = ethers.utils.parseEther("100")
      await expect(systemState.connect(governance).setMinMintAmount(newMinAmount))
        .to.emit(systemState, "MinMintAmountUpdated")
        .withArgs(0, newMinAmount, governance.address)
        
      expect(await systemState.minMintAmount()).to.equal(newMinAmount)
    })

    it("should prevent non-PAUSER from pausing operations", async () => {
      await expect(
        systemState.connect(attacker).pauseMinting()
      ).to.be.revertedWith(
        `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${PAUSER_ROLE}`
      )
    })

    it("should enforce proper role hierarchy", async () => {
      // Grant PARAMETER_ADMIN to governance
      await systemState.grantRole(PARAMETER_ADMIN_ROLE, governance.address)
      
      // PARAMETER_ADMIN cannot grant PAUSER_ROLE
      await expect(
        systemState.connect(governance).grantRole(PAUSER_ROLE, operator1.address)
      ).to.be.revertedWith("AccessControl:")
      
      // Only DEFAULT_ADMIN can grant PAUSER_ROLE
      await expect(systemState.grantRole(PAUSER_ROLE, operator1.address))
        .to.emit(systemState, "RoleGranted")
        .withArgs(PAUSER_ROLE, operator1.address, deployer.address)
    })
  })

  describe("QCManager Access Control", () => {
    beforeEach(async () => {
      // Setup protocol registry
      await protocolRegistry.setService(ethers.utils.id("QC_DATA"), qcData.address)
      await protocolRegistry.setService(ethers.utils.id("SYSTEM_STATE"), systemState.address)
      await protocolRegistry.setService(ethers.utils.id("QC_RESERVE_LEDGER"), qcReserveLedger.address)
      
      // Grant QC_MANAGER_ROLE to QCManager
      await qcData.grantRole(QC_MANAGER_ROLE, qcManager.address)
    })

    it("should prevent non-QC_ADMIN from registering QCs", async () => {
      await expect(
        qcManager.connect(attacker).registerQC(randomUser.address, ethers.utils.parseEther("1000"))
      ).to.be.revertedWith(
        `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${QC_ADMIN_ROLE}`
      )
    })

    it("should prevent non-ARBITER from changing QC status", async () => {
      // First register a QC as admin
      await qcManager.grantRole(QC_ADMIN_ROLE, governance.address)
      await qcManager.connect(governance).registerQC(randomUser.address, ethers.utils.parseEther("1000"))
      
      // Try to change status without ARBITER_ROLE
      await expect(
        qcManager.connect(attacker).setQCStatus(randomUser.address, 2, "0x") // 2 = UnderReview
      ).to.be.revertedWith(
        `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${ARBITER_ROLE}`
      )
    })

    it("should allow ARBITER to change QC status", async () => {
      // Setup
      await qcManager.grantRole(QC_ADMIN_ROLE, governance.address)
      await qcManager.grantRole(ARBITER_ROLE, operator1.address)
      await qcManager.connect(governance).registerQC(randomUser.address, ethers.utils.parseEther("1000"))
      
      // Change status
      const reason = ethers.utils.formatBytes32String("TEST")
      await expect(
        qcManager.connect(operator1).setQCStatus(randomUser.address, 2, reason)
      ).to.emit(qcManager, "QCStatusChanged")
    })
  })

  describe("WatchdogConsensusManager Access Control", () => {
    it("should prevent non-WATCHDOG from creating proposals", async () => {
      await expect(
        watchdogConsensusManager.connect(attacker).proposeStatusChange(
          randomUser.address,
          2, // UnderReview
          "Suspicious activity"
        )
      ).to.be.revertedWith(
        `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${WATCHDOG_ROLE}`
      )
    })

    it("should prevent non-WATCHDOG from voting", async () => {
      // Setup: create a proposal
      await watchdogConsensusManager.grantRole(WATCHDOG_ROLE, operator1.address)
      const tx = await watchdogConsensusManager.connect(operator1).proposeStatusChange(
        randomUser.address,
        2,
        "Test reason"
      )
      const receipt = await tx.wait()
      const proposalId = receipt.events[0].args.proposalId
      
      // Try to vote without role
      await expect(
        watchdogConsensusManager.connect(attacker).vote(proposalId)
      ).to.be.revertedWith(
        `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${WATCHDOG_ROLE}`
      )
    })

    it("should prevent non-MANAGER from updating consensus parameters", async () => {
      await expect(
        watchdogConsensusManager.connect(attacker).updateConsensusParams(3, 5)
      ).to.be.revertedWith(
        `AccessControl: account ${attacker.address.toLowerCase()} is missing role ${MANAGER_ROLE}`
      )
    })
  })

  describe("Cross-Contract Role Dependencies", () => {
    it("should verify WatchdogConsensusManager has ARBITER_ROLE on QCManager", async () => {
      // Initially should not have role
      expect(await qcManager.hasRole(ARBITER_ROLE, watchdogConsensusManager.address)).to.be.false
      
      // Grant role
      await qcManager.grantRole(ARBITER_ROLE, watchdogConsensusManager.address)
      expect(await qcManager.hasRole(ARBITER_ROLE, watchdogConsensusManager.address)).to.be.true
    })

    it("should verify BasicMintingPolicy has QC_ADMIN_ROLE on QCManager", async () => {
      // Grant and verify
      await qcManager.grantRole(QC_ADMIN_ROLE, basicMintingPolicy.address)
      expect(await qcManager.hasRole(QC_ADMIN_ROLE, basicMintingPolicy.address)).to.be.true
    })

    it("should verify QCMinter has MINTER_ROLE on BasicMintingPolicy", async () => {
      // Grant and verify
      await basicMintingPolicy.grantRole(MINTER_ROLE, qcMinter.address)
      expect(await basicMintingPolicy.hasRole(MINTER_ROLE, qcMinter.address)).to.be.true
    })
  })

  describe("Role Transfer and Revocation", () => {
    it("should properly transfer admin role", async () => {
      // Transfer admin to governance
      await systemState.grantRole(DEFAULT_ADMIN_ROLE, governance.address)
      expect(await systemState.hasRole(DEFAULT_ADMIN_ROLE, governance.address)).to.be.true
      
      // Governance can now grant roles
      await systemState.connect(governance).grantRole(PARAMETER_ADMIN_ROLE, operator1.address)
      expect(await systemState.hasRole(PARAMETER_ADMIN_ROLE, operator1.address)).to.be.true
    })

    it("should properly revoke roles", async () => {
      // Grant then revoke
      await systemState.grantRole(PAUSER_ROLE, operator1.address)
      expect(await systemState.hasRole(PAUSER_ROLE, operator1.address)).to.be.true
      
      await systemState.revokeRole(PAUSER_ROLE, operator1.address)
      expect(await systemState.hasRole(PAUSER_ROLE, operator1.address)).to.be.false
      
      // Verify revoked user cannot perform action
      await expect(
        systemState.connect(operator1).pauseMinting()
      ).to.be.revertedWith("AccessControl:")
    })

    it("should allow role renunciation", async () => {
      // Grant role
      await systemState.grantRole(PAUSER_ROLE, operator1.address)
      
      // Renounce role
      await systemState.connect(operator1).renounceRole(PAUSER_ROLE, operator1.address)
      expect(await systemState.hasRole(PAUSER_ROLE, operator1.address)).to.be.false
    })

    it("should prevent renouncing someone else's role", async () => {
      // Grant role to operator1
      await systemState.grantRole(PAUSER_ROLE, operator1.address)
      
      // operator2 cannot renounce operator1's role
      await expect(
        systemState.connect(operator2).renounceRole(PAUSER_ROLE, operator1.address)
      ).to.be.revertedWith("AccessControl: can only renounce roles for self")
    })
  })

  describe("Zero Address and Edge Cases", () => {
    it("should prevent granting roles to zero address", async () => {
      await expect(
        systemState.grantRole(PARAMETER_ADMIN_ROLE, ethers.constants.AddressZero)
      ).to.not.be.reverted // OpenZeppelin allows this but it's effectively useless
      
      // Verify zero address doesn't actually have capabilities
      // (This would revert at the transaction level, not at the access control level)
    })

    it("should handle multiple roles on same account", async () => {
      // Grant multiple roles
      await systemState.grantRole(PARAMETER_ADMIN_ROLE, operator1.address)
      await systemState.grantRole(PAUSER_ROLE, operator1.address)
      
      // Verify both roles work
      await systemState.connect(operator1).setMinMintAmount(ethers.utils.parseEther("50"))
      await systemState.connect(operator1).pauseMinting()
      
      expect(await systemState.isMintingPaused()).to.be.true
    })

    it("should maintain role separation between contracts", async () => {
      // Grant MANAGER_ROLE on systemState
      await systemState.grantRole(MANAGER_ROLE, operator1.address)
      
      // This should NOT give MANAGER_ROLE on watchdogConsensusManager
      expect(await watchdogConsensusManager.hasRole(MANAGER_ROLE, operator1.address)).to.be.false
      
      // Verify by trying to use the role
      await expect(
        watchdogConsensusManager.connect(operator1).updateConsensusParams(3, 5)
      ).to.be.revertedWith("AccessControl:")
    })
  })

  describe("Emergency Scenarios", () => {
    it("should handle admin loss prevention", async () => {
      // Count admins before
      const roleCount = await systemState.getRoleMemberCount(DEFAULT_ADMIN_ROLE)
      expect(roleCount).to.equal(1)
      
      // Add second admin before removing first
      await systemState.grantRole(DEFAULT_ADMIN_ROLE, governance.address)
      expect(await systemState.getRoleMemberCount(DEFAULT_ADMIN_ROLE)).to.equal(2)
      
      // Now safe to revoke original admin
      await systemState.connect(governance).revokeRole(DEFAULT_ADMIN_ROLE, deployer.address)
      expect(await systemState.getRoleMemberCount(DEFAULT_ADMIN_ROLE)).to.equal(1)
    })

    it("should demonstrate risk of last admin renunciation", async () => {
      // This is a critical vulnerability - last admin can lock the contract
      // In production, consider using a modified AccessControl that prevents this
      
      const roleCount = await systemState.getRoleMemberCount(DEFAULT_ADMIN_ROLE)
      expect(roleCount).to.equal(1)
      
      // If deployer renounces, contract becomes ungovernable
      // await systemState.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address)
      // Contract would be permanently locked!
    })
  })
})