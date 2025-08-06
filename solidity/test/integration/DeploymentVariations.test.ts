import { ethers, deployments, helpers } from "hardhat"
import { expect } from "chai"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { Contract } from "ethers"

describe("Deployment Variations Tests (V1.1 only vs V1.1 + V1.2)", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress

  beforeEach(async () => {
    ;({ deployer, governance } = await helpers.signers.getNamedSigners())
  })

  describe("V1.1 Only Deployment", () => {
    beforeEach(async () => {
      // Deploy only up to script 99 (V1.1 system)
      await deployments.fixture(["AccountControl"])
    })

    it("should have V1.1 core contracts deployed", async () => {
      // Core Account Control contracts
      const qcManager = await deployments.get("QCManager")
      expect(qcManager.address).to.not.equal(ethers.constants.AddressZero)

      const qcQCReserveLedger = await deployments.get("QCReserveLedger")
      expect(qcQCReserveLedger.address).to.not.equal(ethers.constants.AddressZero)

      const qcRedeemer = await deployments.get("QCRedeemer")
      expect(qcRedeemer.address).to.not.equal(ethers.constants.AddressZero)

      // Watchdog contracts
      const watchdogMonitor = await deployments.get("WatchdogMonitor")
      expect(watchdogMonitor.address).to.not.equal(ethers.constants.AddressZero)

      const watchdogConsensusManager = await deployments.get("WatchdogConsensusManager")
      expect(watchdogConsensusManager.address).to.not.equal(ethers.constants.AddressZero)

      // System state
      const systemState = await deployments.get("SystemState")
      expect(systemState.address).to.not.equal(ethers.constants.AddressZero)

      // Policies
      const mintingPolicy = await deployments.get("BasicMintingPolicy")
      expect(mintingPolicy.address).to.not.equal(ethers.constants.AddressZero)

      const redemptionPolicy = await deployments.get("BasicRedemptionPolicy")
      expect(redemptionPolicy.address).to.not.equal(ethers.constants.AddressZero)
    })

    it("should NOT have V1.2 contracts deployed", async () => {
      // V1.2 contracts should not exist
      await expect(deployments.get("WatchdogAutomatedEnforcement"))
        .to.be.rejectedWith("No deployment found")

      await expect(deployments.get("WatchdogThresholdActions"))
        .to.be.rejectedWith("No deployment found")

      await expect(deployments.get("WatchdogDAOEscalation"))
        .to.be.rejectedWith("No deployment found")
    })

    it("should have proper V1.1 service registrations", async () => {
      const qcManager = await helpers.contracts.getContract("QCManager")
      const systemState = await helpers.contracts.getContract("SystemState")

      // Check service registrations
      const registeredLedger = await qcManager.reserveLedger()
      const ledgerDeployment = await deployments.get("QCReserveLedger")
      expect(registeredLedger).to.equal(ledgerDeployment.address)

      const registeredRedeemer = await qcManager.redeemer()
      const redeemerDeployment = await deployments.get("QCRedeemer")
      expect(registeredRedeemer).to.equal(redeemerDeployment.address)

      // SystemState should be registered with various contracts
      const qcRedeemer = await helpers.contracts.getContract("QCRedeemer")
      const redeemerSystemState = await qcRedeemer.systemState()
      expect(redeemerSystemState).to.equal(systemState.address)
    })

    it("should support basic V1.1 operations", async () => {
      const [watchdog1, qc1] = await helpers.signers.getUnnamedSigners()
      
      // Deploy a QCWatchdog instance
      const QCWatchdog = await ethers.getContractFactory("QCWatchdog")
      const qcManager = await helpers.contracts.getContract("QCManager")
      const qcQCReserveLedger = await helpers.contracts.getContract("QCReserveLedger")
      const qcRedeemer = await helpers.contracts.getContract("QCRedeemer")
      const systemState = await helpers.contracts.getContract("SystemState")

      const qcWatchdog = await QCWatchdog.deploy(
        qcManager.address,
        qcQCReserveLedger.address,
        qcRedeemer.address,
        systemState.address
      )

      // Grant role and register
      await qcWatchdog.grantRole(
        await qcWatchdog.WATCHDOG_OPERATOR_ROLE(),
        watchdog1.address
      )

      const watchdogMonitor = await helpers.contracts.getContract("WatchdogMonitor")
      await watchdogMonitor.connect(governance).registerWatchdog(
        qcWatchdog.address,
        "Test Watchdog"
      )

      // Register QC
      await qcManager.connect(governance).registerQC(qc1.address, "Test QC")

      // Perform basic operation
      await expect(
        qcWatchdog.connect(watchdog1).attestReserves(
          qc1.address,
          ethers.utils.parseEther("100")
        )
      ).to.emit(qcQCReserveLedger, "ReservesAttested")
    })
  })

  describe("V1.1 + V1.2 Full Deployment", () => {
    beforeEach(async () => {
      // Deploy all contracts including V1.2
      await deployments.fixture(["AccountControl", "AutomatedDecisionFramework"])
    })

    it("should have both V1.1 and V1.2 contracts deployed", async () => {
      // V1.1 contracts
      const qcManager = await deployments.get("QCManager")
      expect(qcManager.address).to.not.equal(ethers.constants.AddressZero)

      const watchdogMonitor = await deployments.get("WatchdogMonitor")
      expect(watchdogMonitor.address).to.not.equal(ethers.constants.AddressZero)

      // V1.2 contracts
      const automatedEnforcement = await deployments.get("WatchdogAutomatedEnforcement")
      expect(automatedEnforcement.address).to.not.equal(ethers.constants.AddressZero)

      const thresholdActions = await deployments.get("WatchdogThresholdActions")
      expect(thresholdActions.address).to.not.equal(ethers.constants.AddressZero)

      const daoEscalation = await deployments.get("WatchdogDAOEscalation")
      expect(daoEscalation.address).to.not.equal(ethers.constants.AddressZero)
    })

    it("should have V1.2 contracts properly integrated with V1.1", async () => {
      const automatedEnforcement = await helpers.contracts.getContract("WatchdogAutomatedEnforcement")
      const thresholdActions = await helpers.contracts.getContract("WatchdogThresholdActions")
      const daoEscalation = await helpers.contracts.getContract("WatchdogDAOEscalation")

      // Check integrations
      const qcManager = await helpers.contracts.getContract("QCManager")
      const systemState = await helpers.contracts.getContract("SystemState")

      // V1.2 contracts should have proper addresses set
      const enforcementQCManager = await automatedEnforcement.qcManager()
      expect(enforcementQCManager).to.equal(qcManager.address)

      const enforcementSystemState = await automatedEnforcement.systemState()
      expect(enforcementSystemState).to.equal(systemState.address)

      // Threshold actions should be linked
      const thresholdQCManager = await thresholdActions.qcManager()
      expect(thresholdQCManager).to.equal(qcManager.address)

      // DAO escalation should be linked
      const daoQCManager = await daoEscalation.qcManager()
      expect(daoQCManager).to.equal(qcManager.address)
    })

    it("should have proper role configurations for V1.2", async () => {
      const automatedEnforcement = await helpers.contracts.getContract("WatchdogAutomatedEnforcement")
      const daoEscalation = await helpers.contracts.getContract("WatchdogDAOEscalation")

      // Check admin roles
      const hasAdminRole = await automatedEnforcement.hasRole(
        await automatedEnforcement.DEFAULT_ADMIN_ROLE(),
        governance.address
      )
      expect(hasAdminRole).to.be.true

      // Check DAO role exists
      const daoRole = await daoEscalation.DAO_ROLE()
      expect(daoRole).to.not.equal(ethers.constants.HashZero)
    })

    it("should support V1.2 automated operations", async () => {
      const [watchdog1, qc1] = await helpers.signers.getUnnamedSigners()
      const automatedEnforcement = await helpers.contracts.getContract("WatchdogAutomatedEnforcement")
      const qcManager = await helpers.contracts.getContract("QCManager")

      // Register QC first
      await qcManager.connect(governance).registerQC(qc1.address, "Test QC")

      // Configure automated rule
      await automatedEnforcement.connect(governance).configureRule(
        0, // Reserve ratio rule
        true,
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "uint256"],
          [95, 100]
        )
      )

      // Trigger automated check
      await expect(
        automatedEnforcement.checkReserveRatio(
          qc1.address,
          90, // Below threshold
          95
        )
      ).to.emit(automatedEnforcement, "RuleTriggered")
    })
  })

  describe("Migration Path Testing", () => {
    it("should allow V1.2 deployment on top of existing V1.1", async () => {
      // First deploy V1.1 only
      await deployments.fixture(["AccountControl"])

      // Verify V1.1 is deployed
      const v1Contracts = [
        "QCManager",
        "QCReserveLedger",
        "QCRedeemer",
        "WatchdogMonitor",
        "WatchdogConsensusManager"
      ]

      for (const contractName of v1Contracts) {
        const deployment = await deployments.get(contractName)
        expect(deployment.address).to.not.equal(ethers.constants.AddressZero)
      }

      // Now deploy V1.2 on top
      await deployments.fixture(["AutomatedDecisionFramework"])

      // Verify V1.2 is now deployed
      const v2Contracts = [
        "WatchdogAutomatedEnforcement",
        "WatchdogThresholdActions",
        "WatchdogDAOEscalation"
      ]

      for (const contractName of v2Contracts) {
        const deployment = await deployments.get(contractName)
        expect(deployment.address).to.not.equal(ethers.constants.AddressZero)
      }

      // Verify V1.1 contracts are unchanged
      const qcManager = await helpers.contracts.getContract("QCManager")
      const originalDeployment = await deployments.get("QCManager")
      expect(qcManager.address).to.equal(originalDeployment.address)
    })

    it("should maintain V1.1 functionality after V1.2 deployment", async () => {
      // Deploy V1.1
      await deployments.fixture(["AccountControl"])
      
      const [watchdog1, qc1] = await helpers.signers.getUnnamedSigners()
      const qcManager = await helpers.contracts.getContract("QCManager")
      
      // Register QC in V1.1
      await qcManager.connect(governance).registerQC(qc1.address, "Test QC V1.1")
      
      // Deploy V1.2
      await deployments.fixture(["AutomatedDecisionFramework"])
      
      // V1.1 operations should still work
      const qcData = await qcManager.qcs(qc1.address)
      expect(qcData.name).to.equal("Test QC V1.1")
      expect(qcData.isActive).to.be.true
      
      // Can still perform V1.1 operations
      const qcQCReserveLedger = await helpers.contracts.getContract("QCReserveLedger")
      const QCWatchdog = await ethers.getContractFactory("QCWatchdog")
      const qcRedeemer = await helpers.contracts.getContract("QCRedeemer")
      const systemState = await helpers.contracts.getContract("SystemState")
      
      const qcWatchdog = await QCWatchdog.deploy(
        qcManager.address,
        qcQCReserveLedger.address,
        qcRedeemer.address,
        systemState.address
      )
      
      await qcWatchdog.grantRole(
        await qcWatchdog.WATCHDOG_OPERATOR_ROLE(),
        watchdog1.address
      )
      
      // Attest reserves
      await expect(
        qcWatchdog.connect(watchdog1).attestReserves(
          qc1.address,
          ethers.utils.parseEther("100")
        )
      ).to.emit(qcQCReserveLedger, "ReservesAttested")
    })
  })

  describe("Configuration Flexibility", () => {
    it("should support disabling V1.2 features even when deployed", async () => {
      // Deploy full system
      await deployments.fixture(["AccountControl", "AutomatedDecisionFramework"])
      
      const automatedEnforcement = await helpers.contracts.getContract("WatchdogAutomatedEnforcement")
      
      // Disable all rules
      for (let i = 0; i < 5; i++) {
        await automatedEnforcement.connect(governance).configureRule(
          i,
          false, // disabled
          "0x"
        )
      }
      
      // Verify rules are disabled
      const rule0 = await automatedEnforcement.rules(0)
      expect(rule0.enabled).to.be.false
    })

    it("should allow selective V1.2 feature enablement", async () => {
      await deployments.fixture(["AccountControl", "AutomatedDecisionFramework"])
      
      const automatedEnforcement = await helpers.contracts.getContract("WatchdogAutomatedEnforcement")
      const thresholdActions = await helpers.contracts.getContract("WatchdogThresholdActions")
      
      // Enable only specific automated rules
      await automatedEnforcement.connect(governance).configureRule(
        0, // Reserve ratio
        true,
        ethers.utils.defaultAbiCoder.encode(["uint256", "uint256"], [95, 100])
      )
      
      // Configure only specific threshold actions
      await thresholdActions.connect(governance).configureThreshold(
        "CRITICAL_ISSUE",
        3,
        3600,
        0
      )
      
      // Other features remain unconfigured/disabled
      const rule1 = await automatedEnforcement.rules(1)
      expect(rule1.enabled).to.be.false
    })
  })

  describe("Deployment Script Validation", () => {
    it("should verify deployment script dependencies", async () => {
      // Scripts 95-99 should deploy without 100-101
      const v1Scripts = [
        "95_deploy_account_control_core",
        "96_deploy_account_control_state", 
        "97_deploy_account_control_policies",
        "98_deploy_account_control_watchdog",
        "99_configure_account_control_system"
      ]
      
      // Deploy V1.1 only
      await deployments.fixture(["AccountControl"])
      
      // Check all V1.1 contracts exist
      const v1Deployments = await deployments.all()
      const v1ContractNames = Object.keys(v1Deployments)
      
      expect(v1ContractNames).to.include.members([
        "QCManager",
        "QCReserveLedger",
        "QCRedeemer",
        "SystemState",
        "WatchdogMonitor",
        "WatchdogConsensusManager",
        "BasicMintingPolicy",
        "BasicRedemptionPolicy"
      ])
      
      // V1.2 contracts should not exist
      expect(v1ContractNames).to.not.include.members([
        "WatchdogAutomatedEnforcement",
        "WatchdogThresholdActions",
        "WatchdogDAOEscalation"
      ])
    })

    it("should verify V1.2 deployment scripts add to V1.1", async () => {
      // Deploy everything
      await deployments.fixture(["AccountControl", "AutomatedDecisionFramework"])
      
      const allDeployments = await deployments.all()
      const allContractNames = Object.keys(allDeployments)
      
      // Should have both V1.1 and V1.2 contracts
      const expectedContracts = [
        // V1.1
        "QCManager",
        "QCReserveLedger", 
        "QCRedeemer",
        "SystemState",
        "WatchdogMonitor",
        "WatchdogConsensusManager",
        "BasicMintingPolicy",
        "BasicRedemptionPolicy",
        // V1.2
        "WatchdogAutomatedEnforcement",
        "WatchdogThresholdActions",
        "WatchdogDAOEscalation"
      ]
      
      expect(allContractNames).to.include.members(expectedContracts)
    })
  })
})